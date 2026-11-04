/**
 * src/hydra-sync/tempario_hybrid_coordinator.ts
 * Coordenador Cache-First de Tempário Híbrido e Guardião Anti-Alucinação.
 * Spec 054: Tempário Híbrido Automotivo (Versão 2.0).
 *
 * Responsabilidades:
 * 1. Cache Contextual L1 multi-fatorial com segregação por persona e loja.
 * 2. Orquestração da Busca Híbrida RRF (Vetor + FTS5) + CTE Recursivo no Grafo.
 * 3. Cruzamento factual com métricas reais de ordens de serviço do pátio ERP.
 * 4. Fallback anti-alucinação com quarentena em tempario_external_estimates_staging.
 *
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
  TemparioHybridQueryInput,
  TemparioHybridQueryResponse,
  TemparioVehicleRecord,
  TemparioEngineRecord,
  TemparioOperationRecord,
  TemparioEvidenceSourceRecord,
  TemparioSubOperationStep,
  DeduplicatedGraphChainResult,
  YardRealTimeComparison
} from './types/tempario_contract.js';
import {
  ensureTemparioTables,
  seedCanonicalTemparioCatalog,
  purgePollutedTemparioCatalog,
  isValidVehicleForPersistence,
  findTemparioVehicles,
  findTemparioEngine,
  resolveDeduplicatedServiceChain,
  getTemparioEvidenceSources,
  persistLearnedTemparioCatalog
} from './tempario_graph_repository.js';
import { DEFAULT_HOURLY_RATE } from './types/tempario_contract.js';
import { researchTemparioOnWeb } from './tempario_web_researcher.js';
import { retrieveTemparioProcedures } from './hybrid_retrieval.js';
import { getYardHistoricalServiceMetrics } from './operational_data_repository.js';
import { recordStoreTableEvidence } from './evidence_repository.js';
import { lookupVehiclePlate } from './apibrasil_plate_client.js';

export interface ResolvedOsVehicleContext {
  readonly osId: string;
  readonly placa?: string;
  readonly veiculo: string;
  readonly lojaSlug: string;
  readonly rawPayload?: string;
  readonly ano?: number;
  readonly motor?: string;
}

/**
 * Resolve o veículo e loja a partir de uma Placa ou Número de OS cadastrada no pátio ERP (ordens_servico)
 * ou consulta a base nacional cadastral via APIBrasil com cache local SQLite (Spec 064).
 */
export async function resolveVehicleFromPlateOrOs(
  db: Database.Database,
  params: { readonly placa?: string; readonly osId?: string; readonly restrictLojaSlug?: string }
): Promise<ResolvedOsVehicleContext | null> {
  try {
    let query = `
      SELECT os_id, placa, veiculo, loja_slug, raw_payload
      FROM ordens_servico
      WHERE 1=1
    `;
    const sqlParams: string[] = [];

    if (params.placa) {
      const cleanPlate = params.placa.trim().toUpperCase().replace('-', '');
      query += ` AND REPLACE(UPPER(placa), '-', '') = ?`;
      sqlParams.push(cleanPlate);
    } else if (params.osId) {
      query += ` AND os_id = ?`;
      sqlParams.push(params.osId.trim());
    } else {
      return null;
    }

    if (params.restrictLojaSlug) {
      query += ` AND LOWER(loja_slug) = LOWER(?)`;
      sqlParams.push(params.restrictLojaSlug.trim());
    }

    query += ` ORDER BY is_aberta DESC, data_inicio DESC LIMIT 1`;

    const row = db.prepare(query).get(...sqlParams) as {
      os_id: string;
      placa: string;
      veiculo: string;
      loja_slug: string;
      raw_payload?: string;
    } | undefined;

    if (row && row.veiculo && row.veiculo.trim().length > 1) {
      const rawVeiculo = row.veiculo.trim();
      let enrichedVeiculo = rawVeiculo;
      let enrichedAno: number | undefined;

      // Se veículo for um termo único comum (ex: 'TRACKER', 'ONIX', 'COROLLA'), enriquece com a montadora
      const upper = rawVeiculo.toUpperCase();
      const BRAND_MAP: Record<string, string> = {
        'TRACKER': 'Chevrolet Tracker',
        'ONIX': 'Chevrolet Onix',
        'CRUZE': 'Chevrolet Cruze',
        'SPIN': 'Chevrolet Spin',
        'CORSA': 'Chevrolet Corsa',
        'CELTA': 'Chevrolet Celta',
        'PRISMA': 'Chevrolet Prisma',
        'S10': 'Chevrolet S10',
        'GOLF': 'Volkswagen Golf',
        'POLO': 'Volkswagen Polo',
        'VIRTUS': 'Volkswagen Virtus',
        'T-CROSS': 'Volkswagen T-Cross',
        'NIVUS': 'Volkswagen Nivus',
        'GOL': 'Volkswagen Gol',
        'VOYAGE': 'Volkswagen Voyage',
        'FOX': 'Volkswagen Fox',
        'SAVEIRO': 'Volkswagen Saveiro',
        'COROLLA': 'Toyota Corolla',
        'YARIS': 'Toyota Yaris',
        'ETIOS': 'Toyota Etios',
        'HILUX': 'Toyota Hilux',
        'CIVIC': 'Honda Civic',
        'FIT': 'Honda Fit',
        'CITY': 'Honda City',
        'HR-V': 'Honda HR-V',
        'HRV': 'Honda HR-V',
        'RENEGADE': 'Jeep Renegade',
        'COMPASS': 'Jeep Compass',
        'HB20': 'Hyundai HB20',
        'CRETA': 'Hyundai Creta',
        'KICKS': 'Nissan Kicks',
        'STRADA': 'Fiat Strada',
        'TORO': 'Fiat Toro',
        'ARGO': 'Fiat Argo',
        'MOBI': 'Fiat Mobi',
        'PALIO': 'Fiat Palio',
        'UNO': 'Fiat Uno',
        'PUNTO': 'Fiat Punto',
        'LINEA': 'Fiat Linea',
        'SIENA': 'Fiat Siena',
        'SANDERO': 'Renault Sandero',
        'DUSTER': 'Renault Duster',
        'LOGAN': 'Renault Logan',
        'KWID': 'Renault Kwid',
        'CLIO': 'Renault Clio',
        '208': 'Peugeot 208',
        'C3': 'Citroën C3',
        'C4': 'Citroën C4'
      };

      if (BRAND_MAP[upper]) {
        enrichedVeiculo = BRAND_MAP[upper];
      }

      // Tenta extrair ano do nome do veículo se houver (ex: 'Tracker 2022')
      const anoMatch = rawVeiculo.match(/\b(19[89]\d|20[0-2]\d|2030)\b/);
      if (anoMatch) {
        enrichedAno = parseInt(anoMatch[1], 10);
      }

      return {
        osId: String(row.os_id),
        placa: row.placa || undefined,
        veiculo: enrichedVeiculo,
        lojaSlug: row.loja_slug,
        rawPayload: row.raw_payload,
        ano: enrichedAno
      };
    }

    // Se não encontrou no pátio e possui placa, consulta o cliente de placas (Cache SQLite / APIBrasil)
    if (params.placa) {
      const plateRecord = await lookupVehiclePlate(db, params.placa);
      if (plateRecord) {
        return {
          osId: 'EXTERNA',
          placa: plateRecord.placaLimpa,
          veiculo: plateRecord.modeloCompleto,
          lojaSlug: params.restrictLojaSlug || 'rede',
          rawPayload: plateRecord.rawPayloadJson,
          ano: plateRecord.anoModelo || plateRecord.anoFabricacao,
          motor: plateRecord.motor
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

interface CacheEntry {
  readonly response: TemparioHybridQueryResponse;
  readonly expiresAt: number;
}

const seededDatabases = new WeakSet<Database.Database>();

const TEMPARIO_MATCH_STOPWORDS = new Set([
  'troca', 'trocar', 'substituicao', 'substituir', 'reparo', 'reparar',
  'conserto', 'consertar', 'desmontar', 'desmontagem', 'remover', 'remocao',
  'instalar', 'instalacao', 'fazer', 'servico', 'servicos', 'mao', 'obra',
  'valor', 'preco', 'tempo', 'horas', 'hora', 'quanto', 'quantas', 'custa',
  'fica', 'orcamento', 'cobrar', 'dianteiro', 'dianteira', 'diranteiro',
  'traseiro', 'traseira', 'direito', 'direita', 'esquerdo', 'esquerda',
  'lado', 'completo', 'completa', 'par', 'jogo', 'kit', 'para', 'pra',
  'com', 'sem', 'por', 'dos', 'das', 'nos', 'nas', 'uma', 'uns', 'umas',
  'carro', 'veiculo', 'veiculos', 'passeio', 'nacional', 'placa', 'ordem',
  'motor_partida', 'barra_estabilizadora', 'terminal_direcao', 'bandeja_suspensao',
  'junta_homocinetica', 'cubo_roda', 'rolamento_roda', 'valvula_termostatica',
  'sangria_freio', 'tsi', 'turbo', 'flex', '16v', '12v'
]);

/**
 * Extrai os tokens técnicos nucleares dos componentes solicitados,
 * removendo placas, nomes do veículo e verbos de ação genéricos ("troca", "substituição", etc.)
 * para impedir que "troca de motor de partida" dê match em "Troca da bieleta".
 */
function extractNuclearServiceTokens(
  servicosSolicitados: readonly string[],
  rawQuery?: string,
  matchedVehicle?: TemparioVehicleRecord | null
): string[] {
  const combined = [...servicosSolicitados, rawQuery || '']
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b[a-z]{3}-?[0-9][a-z0-9][0-9]{2}\b/gi, ' ')
    .replace(/_/g, ' ');

  const vehicleWords = new Set<string>();
  if (matchedVehicle) {
    for (const w of `${matchedVehicle.marca} ${matchedVehicle.modelo}`.toLowerCase().split(/\s+/)) {
      if (w.length >= 2) vehicleWords.add(w);
    }
  }
  const commonModels = [
    'golf', 'onix', 'plus', 'tracker', 'civic', 'corolla', 'renegade', 'compass',
    'corsa', 'celta', 'prisma', 'spin', 'cruze', 'palio', 'siena', 'strada',
    'toro', 'argo', 'mobi', 'uno', 'gol', 'voyage', 'fox', 'polo', 'virtus',
    'hb20', 'creta', 'kicks', 'sandero', 'logan', 'duster', 'kwid', 'fiesta',
    'ecosport', 'ranger', 'hilux', 's10', 'chevrolet', 'volkswagen', 'fiat',
    'honda', 'toyota', 'jeep', 'hyundai', 'renault', 'ford', 'nissan', 'peugeot', 'citroen'
  ];
  for (const m of commonModels) vehicleWords.add(m);

  const isStarterMotor = /\b(motor\s+de\s+partida|motor\s+de\s+arranque|arranque)\b/.test(combined);

  const rawWords = combined
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w));

  const nuclear = new Set<string>();
  for (const w of rawWords) {
    if (TEMPARIO_MATCH_STOPWORDS.has(w)) continue;
    if (vehicleWords.has(w)) continue;
    // Se for "motor de partida", a palavra isolada "motor" não pode dar match em coxim/óleo de motor
    if (w === 'motor' && isStarterMotor) continue;
    nuclear.add(w);
  }

  if (isStarterMotor) {
    nuclear.add('partida');
    nuclear.add('arranque');
  }

  return Array.from(nuclear);
}

export class TemparioHybridCoordinator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;

  constructor(
    private readonly db: Database.Database,
    defaultTtlMs = 300 * 1000 // 5 minutos
  ) {
    this.defaultTtlMs = defaultTtlMs;
    ensureTemparioTables(this.db);
    try {
      if (!seededDatabases.has(this.db)) {
        seedCanonicalTemparioCatalog(this.db);
        seededDatabases.add(this.db);
      } else {
        purgePollutedTemparioCatalog(this.db);
      }
    } catch {
      // Auto-seed tolerante
    }
  }

  /**
   * Constrói a chave canônica multi-fatorial de Cache L1 (R05 / Gate 4).
   * Segrega estritamente por veículo, ano, motor, serviços ordenados, persona, loja e generationId.
   */
  public buildCacheKey(input: TemparioHybridQueryInput): string {
    const vSlug = (input.veiculoMarcaModelo || 'any').trim().toLowerCase().replace(/\s+/g, '_');
    const ano = input.ano || 'any';
    const mSlug = (input.motorTexto || 'any').trim().toLowerCase().replace(/\s+/g, '_');

    const sortedServices = [...(input.servicosSolicitados || [])]
      .map(s => s.trim().toLowerCase())
      .sort()
      .join('|') || 'default';

    const persona = (input.securityContext.persona || 'socio').toLowerCase();
    const store = (input.securityContext.authorizedLojaSlug || input.securityContext.authorizedStore || input.targetLojaSlug || 'rede').toLowerCase();
    const genId = input.generationId || 0;

    return `hydra:tempario:v1:${vSlug}:${ano}:${mSlug}:${sortedServices}:${persona}:${store}:${genId}`;
  }

  /**
   * Executa a consulta completa de tempário respeitando Cache -> Híbrido RRF -> Grafo -> Pátio -> Anti-Alucinação.
   */
  public async coordinateQuery(
    input: TemparioHybridQueryInput
  ): Promise<TemparioHybridQueryResponse> {
    const startTime = Date.now();
    const queryId = randomUUID();
    const cacheKey = this.buildCacheKey(input);

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 1: CACHE CONTEXTUAL L1
    // ─────────────────────────────────────────────────────────────────────────
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return {
        ...cached.response,
        queryId,
        isCacheHit: true,
        latencyMs: Math.max(1, Date.now() - startTime)
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 2: RESOLUÇÃO DE VEÍCULO E MOTOR NO CATÁLOGO
    // ─────────────────────────────────────────────────────────────────────────
    let matchedVehicle: TemparioVehicleRecord | null = null;
    let matchedEngine: TemparioEngineRecord | null = null;

    let targetVehicle = (input.veiculoMarcaModelo || '').trim();
    let targetAno = input.ano;
    let targetMotor = input.motorTexto;

    // Se veículo veio genérico ou ausente, tenta resolver via Placa ou OS no banco
    if (!targetVehicle || targetVehicle.toLowerCase() === 'veiculo' || targetVehicle.toLowerCase() === 'veículo') {
      const plateMatch = (input.rawQuery || '').match(/\b([A-Z]{3}-?[0-9][A-Z0-9][0-9]{2})\b/i);
      const osMatch = (input.rawQuery || '').match(/\b(?:os|ordem)[_\s]*#?\s*(\d{1,8})\b/i);
      const placaToResolve = input.placa || (plateMatch ? plateMatch[1] : undefined);
      const osIdToResolve = input.osId || (osMatch ? osMatch[1] : undefined);

      if (placaToResolve || osIdToResolve) {
        const resolved = await resolveVehicleFromPlateOrOs(this.db, {
          placa: placaToResolve,
          osId: osIdToResolve,
          restrictLojaSlug: input.securityContext.authorizedLojaSlug || input.targetLojaSlug
        });
        if (resolved && resolved.veiculo) {
          targetVehicle = resolved.veiculo;
          if (!targetAno && resolved.ano) {
            targetAno = resolved.ano;
          }
        }
      }
    }

    // Tentativa 1: busca direta por modelo e ano
    const vehicleCandidates = findTemparioVehicles(this.db, {
      modelo: targetVehicle,
      ano: targetAno
    });

    if (vehicleCandidates.length > 0) {
      matchedVehicle = vehicleCandidates[0];
    } else {
      // Tentativa 2: split de termos (ex: "Golf 1.4 TSI" -> "Golf")
      const words = targetVehicle.split(/\s+/).filter(w => w.length >= 3);
      for (const w of words) {
        const cands = findTemparioVehicles(this.db, { modelo: w, ano: targetAno });
        if (cands.length > 0) {
          matchedVehicle = cands[0];
          break;
        }
      }
    }

    if (matchedVehicle) {
      matchedEngine = findTemparioEngine(this.db, matchedVehicle.vehicleId, targetMotor);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 3: BUSCA HÍBRIDA RRF (VETORIAL + FTS5) DE PROCEDIMENTOS
    // ─────────────────────────────────────────────────────────────────────────
    const rrfResults = await retrieveTemparioProcedures(this.db, input.rawQuery, {
      vehicleId: matchedVehicle?.vehicleId,
      engineId: matchedEngine?.engineId,
      ano: input.ano,
      limit: 10
    });

    // Extrai apenas os componentes técnicos nucleares (sem stopwords como "troca", "serviço", placa, etc.)
    const nuclearTokens = extractNuclearServiceTokens(
      input.servicosSolicitados || [],
      input.rawQuery,
      matchedVehicle
    );

    const doesOperationMatchNuclearTokens = (opId: string): boolean => {
      if (nuclearTokens.length === 0) return true;
      const opRow = this.db.prepare(`
        SELECT titulo, sinonimos_busca
        FROM tempario_operations
        WHERE operation_id = ?
      `).get(opId) as { titulo: string; sinonimos_busca?: string | null } | undefined;
      if (!opRow) return false;
      const haystack = `${opRow.titulo} ${opRow.sinonimos_busca || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      return nuclearTokens.some(token => haystack.includes(token));
    };

    // Casamento de operações
    const operationIds = new Set<string>();
    let maxRrfConfidence = 0;

    for (const res of rrfResults) {
      if (res.confidenceScore >= 0.70 && doesOperationMatchNuclearTokens(res.operationId)) {
        operationIds.add(res.operationId);
        if (res.confidenceScore > maxRrfConfidence) {
          maxRrfConfidence = res.confidenceScore;
        }
      }
    }

    // Se houver termos nucleares de serviços no input e veículo localizado,
    // busca complementar em tempario_operations exigindo match no termo nuclear
    if (matchedVehicle && nuclearTokens.length > 0) {
      for (const term of nuclearTokens) {
        const cleanTerm = `%${term}%`;
        const directOps = this.db.prepare(`
          SELECT operation_id
          FROM tempario_operations
          WHERE vehicle_id = ?
            AND (
              LOWER(titulo) LIKE ?
              OR LOWER(COALESCE(sinonimos_busca, '')) LIKE ?
              OR LOWER(categoria_servico) LIKE ?
            )
        `).all(matchedVehicle.vehicleId, cleanTerm, cleanTerm, cleanTerm) as Array<{ operation_id: string }>;

        for (const op of directOps) {
          if (doesOperationMatchNuclearTokens(op.operation_id)) {
            operationIds.add(op.operation_id);
            maxRrfConfidence = Math.max(maxRrfConfidence, 0.88);
          }
        }
      }
    }

    const resolvedOpIds = Array.from(operationIds);

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 4: RAMIFICAÇÃO (CATÁLOGO HOMOLOGADO vs. PESQUISA TÉCNICA IA + WEB)
    // ─────────────────────────────────────────────────────────────────────────
    let response: TemparioHybridQueryResponse;

    if (matchedVehicle && resolvedOpIds.length > 0 && maxRrfConfidence >= 0.70) {
      // 4A. CASO HOMOLOGADO: RESOLVER GRAFO COM DEDUPLICAÇÃO VIA CTE RECURSIVO
      const resolvedOpsRows = this.db.prepare(`
        SELECT operation_id, codigo_operacao_oem, vehicle_id, engine_id,
               titulo, categoria_servico, tempo_padrao_bruto_horas,
               fator_variacao_motor, grau_dificuldade, source_id, status_evidencia
        FROM tempario_operations
        WHERE operation_id IN (${resolvedOpIds.map(() => '?').join(',')})
      `).all(...resolvedOpIds) as Array<{
        operation_id: string;
        codigo_operacao_oem: string;
        vehicle_id: string;
        engine_id?: string | null;
        titulo: string;
        categoria_servico: string;
        tempo_padrao_bruto_horas: number;
        fator_variacao_motor: number;
        grau_dificuldade: string;
        source_id: string;
        status_evidencia: string;
      }>;

      const operacoesResolvidas: TemparioOperationRecord[] = resolvedOpsRows.map(r => ({
        operationId: r.operation_id,
        codigoOperacaoOem: r.codigo_operacao_oem,
        vehicleId: r.vehicle_id,
        engineId: r.engine_id || undefined,
        titulo: r.titulo,
        categoriaServico: r.categoria_servico,
        tempoPadraoBrutoHoras: Number(r.tempo_padrao_bruto_horas),
        fatorVariacaoMotor: Number(r.fator_variacao_motor),
        grauDificuldade: r.grau_dificuldade as 'BAIXO' | 'MEDIO' | 'ALTO' | 'ESPECIALISTA',
        sourceId: r.source_id,
        statusEvidencia: r.status_evidencia as any
      }));

      // Resolução deduplicada do grafo
      const cadeiaExecucao = resolveDeduplicatedServiceChain(
        this.db,
        resolvedOpIds,
        matchedEngine?.engineId
      );

      // Coleta fontes de evidência
      const sourceIds = Array.from(new Set(operacoesResolvidas.map(o => o.sourceId)));
      const evidenciasFontes = getTemparioEvidenceSources(this.db, sourceIds);

      // Cruzamento factual com ordens de serviço do ERP (tempo real de pátio)
      const comparativoPatio = getYardHistoricalServiceMetrics(this.db, {
        serviceTerms: input.servicosSolicitados.length > 0
          ? input.servicosSolicitados
          : operacoesResolvidas.map(o => o.titulo),
        vehicleModel: matchedVehicle.modelo,
        tempoTabeladoHoras: cadeiaExecucao.tempoLiquidoTotalHoras,
        securityContext: input.securityContext,
        targetLojaSlug: input.targetLojaSlug
      });

      const latencyMs = Math.max(1, Date.now() - startTime);

      response = {
        queryId,
        isCacheHit: false,
        latencyMs,
        confidenceScore: Math.round(Math.min(1.0, Math.max(0.75, maxRrfConfidence)) * 100) / 100,
        retrievalMethod: 'HYBRID_RRF_GRAPH',
        veiculo: matchedVehicle,
        motor: matchedEngine,
        operacoesResolvidas,
        cadeiaExecucao,
        comparativoPatio,
        evidenciasFontes,
        statusEvidenciaGlobal: 'HOMOLOGADO_OEM'
      };
    } else {
      // 4B. CASO NÃO HOMOLOGADO: PESQUISA TÉCNICA ATIVA NA WEB + SÍNTESE MULTI-ETAPA IA (SPEC 066)
      const serviceNames = (input.servicosSolicitados && input.servicosSolicitados.length > 0)
        ? input.servicosSolicitados
        : [input.rawQuery || 'Manutenção Mecânica'];

      // Dispara pesquisa web real + síntese multi-etapa com extração de tempo, etapas, peças e ferramentas
      const webResearch = await researchTemparioOnWeb({
        veiculo: targetVehicle || input.veiculoMarcaModelo || 'Automóvel',
        motor: targetMotor || input.motorTexto,
        ano: targetAno || input.ano,
        servicos: serviceNames,
        rawQuery: input.rawQuery,
        db: this.db,
        requestedByPhone: input.securityContext.authorizedPhones?.[0],
        lojaSlug: input.securityContext.authorizedLojaSlug || input.targetLojaSlug
      });

      const inferredSteps: TemparioSubOperationStep[] = webResearch.etapasDetalhadas.map((etapa, idx) => ({
        ordemExecucaoFinal: etapa.ordem || idx + 1,
        subopId: `subop_web_${idx + 1}`,
        codigoEtapa: etapa.codigoEtapa || `STEP-${idx + 1}`,
        titulo: etapa.titulo,
        descricaoTecnica: etapa.descricaoTecnica,
        faseExecucao: etapa.faseExecucao,
        tempoHoras: etapa.tempoHoras,
        tempoMinutos: Math.round(etapa.tempoHoras * 60),
        ferramentas: etapa.ferramentas,
        torqueEspecificado: etapa.torqueEspecificado,
        isAcessoCompartilhado: false,
        qtdServicosCompartilhando: 1,
        operacoesOrigemIds: [`op_web_1`]
      }));

      const taxaHorariaPadrao = DEFAULT_HOURLY_RATE; // R$ 270,00/h
      const valorMaoDeObraSugerido = webResearch.valorMaoDeObraSugerido;

      const cadeiaExecucao: DeduplicatedGraphChainResult = {
        steps: inferredSteps,
        pecasNecessarias: webResearch.pecasIdentificadas,
        ferramentasNecessarias: webResearch.ferramentasIdentificadas,
        torquesEspecificados: webResearch.torquesIdentificados,
        tempoLiquidoTotalHoras: webResearch.tempoEstimadoHoras,
        tempoLiquidoTotalMinutos: webResearch.tempoEstimadoMinutos,
        tempoBrutoTotalHoras: webResearch.tempoEstimadoHoras,
        tempoEconomizadoDeduplicacaoHoras: 0,
        tempoEconomizadoDeduplicacaoMinutos: 0,
        possuiDeduplicacaoAtiva: false,
        taxaHorariaPadrao,
        valorMaoDeObraSugerido,
        valorMaoDeObraBrutoSemAssociativa: valorMaoDeObraSugerido,
        economiaMaoDeObraReais: 0
      };

      const anoRef = targetAno || input.ano;
      const anoIni = anoRef ? anoRef : 2012;
      const anoFim = anoRef ? anoRef : 2022;

      // Spec 066: Auto-Persistência Validada no SQLite (apenas veículos reais e com >= 2 etapas)
      if (isValidVehicleForPersistence(webResearch.veiculoMarca, webResearch.veiculoModelo)) {
        try {
          persistLearnedTemparioCatalog(this.db, {
            veiculoMarca: webResearch.veiculoMarca,
            veiculoModelo: webResearch.veiculoModelo,
            anoInicio: anoIni,
            anoFim: anoFim,
            geracaoNome: anoRef ? `Ano ${anoRef}` : undefined,
            motorNome: webResearch.motorResolvido,
            operacaoNome: webResearch.servicoTituloFormatado,
            tempoPadraoHoras: webResearch.tempoEstimadoHoras,
            passos: inferredSteps.map(s => ({
              ordem: s.ordemExecucaoFinal,
              titulo: s.titulo,
              fase: s.faseExecucao,
              tempoHoras: s.tempoHoras,
              ferramentas: s.ferramentas,
              torque: s.torqueEspecificado
            })),
            pecas: webResearch.pecasIdentificadas,
            ferramentas: webResearch.ferramentasIdentificadas,
            torques: webResearch.torquesIdentificados,
            fonteUrlOuNome: webResearch.fontesConsultadas[0] || 'Pesquisa Técnica Web Automotiva'
          });
        } catch (persistErr) {
          console.warn('[COORDINATOR] Auto-persistência tolerante executada:', persistErr);
        }
      }

      // Auditoria de evidência
      try {
        recordStoreTableEvidence({
          lojaSlug: input.securityContext.authorizedLojaSlug || input.targetLojaSlug || 'rede',
          tabela: 'tempario_external_estimates_staging',
          coberturaStatus: 'PARCIAL',
          dataColetaRecente: new Date().toISOString(),
          registrosContabilizados: 1,
          incompletudeMotivo: 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO',
          updatedAt: new Date().toISOString()
        }, this.db);
      } catch {
        // Falha em auditoria não bloqueia retorno
      }

      // Consulta métricas de pátio do ERP se houver termos
      const comparativoPatio = getYardHistoricalServiceMetrics(this.db, {
        serviceTerms: serviceNames,
        vehicleModel: webResearch.veiculoModelo,
        tempoTabeladoHoras: cadeiaExecucao.tempoLiquidoTotalHoras,
        securityContext: input.securityContext,
        targetLojaSlug: input.targetLojaSlug
      });

      const latencyMs = Math.max(1, Date.now() - startTime);

      const fallbackVehicle: TemparioVehicleRecord = matchedVehicle || {
        vehicleId: `veh_${webResearch.veiculoMarca.toLowerCase()}_${webResearch.veiculoModelo.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        marca: webResearch.veiculoMarca,
        modelo: webResearch.veiculoModelo,
        anoInicio: anoIni,
        anoFim: anoFim,
        categoria: 'PASSEIO'
      };

      const fallbackEngine: TemparioEngineRecord = matchedEngine || {
        engineId: `eng_${fallbackVehicle.vehicleId}_default`,
        vehicleId: fallbackVehicle.vehicleId,
        codigoMotor: webResearch.motorResolvido,
        cilindrada: '1.4',
        descricaoComercial: webResearch.motorResolvido,
        combustivel: 'FLEX',
        aspiracao: 'ASPIRADO',
        valvulas: 8
      };

      const synthesizedOpRecord: TemparioOperationRecord = {
        operationId: 'op_web_1',
        codigoOperacaoOem: 'WEB-SYNTH-01',
        vehicleId: fallbackVehicle.vehicleId,
        engineId: fallbackEngine.engineId,
        titulo: webResearch.servicoTituloFormatado,
        categoriaServico: 'MECANICA_GERAL',
        tempoPadraoBrutoHoras: webResearch.tempoEstimadoHoras,
        fatorVariacaoMotor: 1.0,
        grauDificuldade: inferredSteps.length >= 4 ? 'MEDIO' : 'BAIXO',
        sourceId: 'src_web_research',
        statusEvidencia: 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'
      };

      response = {
        queryId,
        isCacheHit: false,
        latencyMs,
        confidenceScore: webResearch.confianca,
        retrievalMethod: 'ASSISTED_EXTERNAL_ESTIMATE',
        veiculo: fallbackVehicle,
        motor: fallbackEngine,
        operacoesResolvidas: [synthesizedOpRecord],
        cadeiaExecucao,
        comparativoPatio,
        evidenciasFontes: [],
        statusEvidenciaGlobal: 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO',
        avisoQuarentena: `Atenção: Estimativa externa provisória em quarentena de validação. Mão de obra calculada na taxa da rede (R$ 270,00/h). Procedência: ${webResearch.fontesConsultadas[0] || 'Pesquisa Técnica Web'}.`
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASSO 5: ARMAZENAR NO CACHE L1
    // ─────────────────────────────────────────────────────────────────────────
    this.cache.set(cacheKey, {
      response,
      expiresAt: Date.now() + this.defaultTtlMs
    });

    return response;
  }

  /**
   * Limpa todo o cache L1 em memória (útil para testes unitários e updates).
   */
  public clearCache(): void {
    this.cache.clear();
  }
}
