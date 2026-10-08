/**
 * src/hydra-sync/hybrid_os_coordinator.ts
 * Coordenador Operacional H?brido: Resolu??o Parametrizada de Ve?culos no ERP,
 * Leitura de An?lise Can?nica e Declara??o Factual Honesta de Limita??o.
 * Spec: hydra-linea-runtime-repair (Executor 3 ? Fase E3)
 */

import type Database from 'better-sqlite3';
import {
  OperationType,
  ResolutionStatus,
  AnalysisCoverageStatus,
  TurnPendingRequest,
  CandidateVehicle,
  CandidateOrder,
  VehicleResolutionResult,
  CaseContextResult,
  ExtendedTurnState,
  SecurityAccessDeniedError,
  type OSInspectionInput,
  type VehicleInspectionInput,
  type SecurityContext,
  type IOperationalDataRepository,
  type CombinedOSSituationReport,
  type ConversationAnalysisRecord,
  type OSConversationLink,
  type ExtractedStatement,
  type ConversationGap,
  type SanitizedMessage,
  type IAnalysisRepository
} from './types/conversation_context_contract.js';
import { ConversationSemanticResolver } from './conversation_semantic_resolver.js';
import { OSSituationComposer } from './os_situation_composer.js';
import { ConversationReaderSafe, type ConversationReaderSafeOptions } from './conversation_reader_safe.js';
import { ConversationCacheManager } from './conversation_cache_manager.js';
import { ConversationSourceAdapter } from './conversation_source_adapter.js';
import { SummaryEvidenceAdapter } from './summary_evidence_adapter.js';
import { FIXTURE_OS_CATALOG, type FixtureOSData } from './fixtures/conversation_context_fixtures.js';

export { SecurityAccessDeniedError };
import {
  getLatestTurnState,
  saveTurnState,
  type TurnState
} from './turn_context_repository.js';
import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks
} from './format_utils.js';
import { resolveCaseContext } from './case_memory_reader.js';

export function isProductionEnvironment(): boolean {
  return true;
}

export interface ResolveVehicleParams {
  model?: string;
  plate?: string;
  osId?: string;
  storeSlug?: string;
}

/**
 * Busca parametrizada de veículos no ERP (ordens_servico).
 * Proibido expressamente: default hardcoded 'linea' ou fixtures est?ticas em produ??o (R13, R14).
 */
export function resolveVehicleTarget(
  db: Database.Database,
  params: ResolveVehicleParams
): VehicleResolutionResult {
  const model = params.model?.trim();
  const plate = params.plate?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const osId = params.osId?.trim();
  const storeSlug = params.storeSlug?.trim();

  // R13: Se nenhum parâmetro for informado, JAMAIS assumir 'linea'
  if (!model && !plate && !osId) {
    return {
      status: 'NO_MATCH',
      reason: 'Nenhum identificador de veículo informado (placa, OS ou modelo).'
    };
  }

  // 1. Busca Direta por OS
  if (osId) {
    let query = `
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid,
             is_aberta, dias_no_patio, total_os, valor_restante, data_inicio
      FROM ordens_servico
      WHERE os_id = ?
    `;
    const sqlParams: any[] = [osId];
    if (storeSlug) {
      query += ` AND loja_slug = ?`;
      sqlParams.push(storeSlug);
    }
    const row = db.prepare(query).get(...sqlParams) as any;
    if (row) {
      const vehicle: CandidateVehicle = {
        plate: row.placa || '',
        model: row.veiculo || 'Não informado',
        clientName: row.cliente_nome || undefined,
        storeSlug: row.loja_slug,
        lastActiveOsId: String(row.os_id)
      };
      const activeOrder: CandidateOrder = {
        osId: String(row.os_id),
        storeSlug: row.loja_slug,
        plate: row.placa || '',
        vehicleModel: row.veiculo || 'Não informado',
        clientName: row.cliente_nome || undefined,
        statusGrid: row.status_grid || 'EM ANDAMENTO',
        isOpen: Boolean(row.is_aberta),
        daysInYard: Number(row.dias_no_patio) || 0,
        totalAmount: Number(row.total_os) || 0,
        remainingBalance: Number(row.valor_restante) || 0,
        openedAt: row.data_inicio || undefined
      };
      return { status: 'RESOLVED', vehicle, activeOrder };
    }
    return {
      status: 'NO_MATCH',
      searchedPlate: plate,
      searchedModel: model,
      searchedStoreSlug: storeSlug,
      reason: `Nenhuma ordem de serviço localizada com o número #${osId}.`
    };
  }

  // 2. Busca Direta por Placa
  if (plate) {
    let query = `
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid,
             is_aberta, dias_no_patio, total_os, valor_restante, data_inicio
      FROM ordens_servico
      WHERE REPLACE(UPPER(placa), '-', '') = ?
    `;
    const sqlParams: any[] = [plate];
    if (storeSlug) {
      query += ` AND loja_slug = ?`;
      sqlParams.push(storeSlug);
    }
    query += ` ORDER BY is_aberta DESC, data_inicio DESC LIMIT 1`;
    const row = db.prepare(query).get(...sqlParams) as any;
    if (row) {
      const vehicle: CandidateVehicle = {
        plate: row.placa || plate,
        model: row.veiculo || 'Não informado',
        clientName: row.cliente_nome || undefined,
        storeSlug: row.loja_slug,
        lastActiveOsId: String(row.os_id)
      };
      const activeOrder: CandidateOrder = {
        osId: String(row.os_id),
        storeSlug: row.loja_slug,
        plate: row.placa || plate,
        vehicleModel: row.veiculo || 'Não informado',
        clientName: row.cliente_nome || undefined,
        statusGrid: row.status_grid || 'EM ANDAMENTO',
        isOpen: Boolean(row.is_aberta),
        daysInYard: Number(row.dias_no_patio) || 0,
        totalAmount: Number(row.total_os) || 0,
        remainingBalance: Number(row.valor_restante) || 0,
        openedAt: row.data_inicio || undefined
      };
      return { status: 'RESOLVED', vehicle, activeOrder };
    }
    return {
      status: 'NO_MATCH',
      searchedPlate: plate,
      searchedModel: model,
      searchedStoreSlug: storeSlug,
      reason: `Nenhum veículo localizado para a placa "${plate}".`
    };
  }

  // 3. Busca Parametrizada por Modelo (R08)
  if (model) {
    let query = `
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid,
             is_aberta, dias_no_patio, total_os, valor_restante, data_inicio
      FROM ordens_servico
      WHERE UPPER(veiculo) LIKE UPPER(?)
    `;
    const sqlParams: any[] = [`%${model}%`];
    if (storeSlug) {
      query += ` AND loja_slug = ?`;
      sqlParams.push(storeSlug);
    }
    query += ` ORDER BY is_aberta DESC, data_inicio DESC`;

    const rows = db.prepare(query).all(...sqlParams) as any[];

    if (rows.length === 0) {
      return {
        status: 'NO_MATCH',
        searchedModel: model,
        searchedStoreSlug: storeSlug,
        reason: `Nenhum veículo encontrado com o modelo "${model}".`
      };
    }

    // Agrupa por veículo ?nico (placa distinta)
    const distinctVehicles = new Map<string, any>();
    for (const r of rows) {
      const p = (r.placa || '').toUpperCase().trim();
      const key = p || `${r.loja_slug}_${r.os_id}`;
      if (!distinctVehicles.has(key)) {
        distinctVehicles.set(key, r);
      }
    }

    const uniqueCandidates = Array.from(distinctVehicles.values());

    // Se houver mais de 1 veículo correspondente -> AMBIGUIDADE (R09)
    if (uniqueCandidates.length > 1) {
      const candidates: CandidateVehicle[] = uniqueCandidates.map(r => ({
        plate: r.placa || 'Sem Placa',
        model: r.veiculo || model,
        clientName: r.cliente_nome || undefined,
        storeSlug: r.loja_slug,
        lastActiveOsId: String(r.os_id)
      }));

      const candidateLines = candidates.map(c => 
        `- *${c.model}* (${c.plate}) ? *${c.storeSlug}* (OS #${c.lastActiveOsId})`
      ).join('\n');

      const clarificationPrompt = sanitizeWhatsAppMarkdown(
        `> *Veículos Localizados: ${model}*\n` +
        `Encontrei ${candidates.length} veículos correspondentes na rede:\n` +
        candidateLines +
        `\n\nPor favor, informe a placa ou a unidade para detalhar o atendimento.`
      );

      return {
        status: 'AMBIGUOUS_VEHICLE',
        candidates,
        clarificationPrompt
      };
    }

    // Exatamente 1 veículo ?nico correspondente
    const r = uniqueCandidates[0];
    const vehicle: CandidateVehicle = {
      plate: r.placa || 'Sem Placa',
      model: r.veiculo || model,
      clientName: r.cliente_nome || undefined,
      storeSlug: r.loja_slug,
      lastActiveOsId: String(r.os_id)
    };
    const activeOrder: CandidateOrder = {
      osId: String(r.os_id),
      storeSlug: r.loja_slug,
      plate: r.placa || 'Sem Placa',
      vehicleModel: r.veiculo || model,
      clientName: r.cliente_nome || undefined,
      statusGrid: r.status_grid || 'EM ANDAMENTO',
      isOpen: Boolean(r.is_aberta),
      daysInYard: Number(r.dias_no_patio) || 0,
      totalAmount: Number(r.total_os) || 0,
      remainingBalance: Number(r.valor_restante) || 0,
      openedAt: r.data_inicio || undefined
    };
    return { status: 'RESOLVED', vehicle, activeOrder };
  }

  return {
    status: 'NO_MATCH',
    reason: 'N?o foi poss?vel resolver o veículo.'
  };
}

/**
 * Recupera o contexto factual do caso e análise do Grafo de Atendimentos da OS (R10, R11, R12).
 * Prioridade 1: Projeção de Grafo íntegra
 * Prioridade 2: Análise Canônica persistida
 * Prioridade 3: Análise técnica em raw_payload
 * Prioridade 4: Declaração honesta de limitação factual
 */
export function getCaseContext(
  db: Database.Database,
  order: CandidateOrder
): CaseContextResult {
  return resolveCaseContext(db, order);
}

/**
 * Formata a resposta da situa??o do veículo no padr?o nativo do WhatsApp (R17).
 * Zero asteriscos duplos, zero tabelas.
 */
export function formatVehicleSituation(
  resolution: VehicleResolutionResult,
  caseContext?: CaseContextResult,
  operation: OperationType = 'VEHICLE_SITUATION'
): string {
  if (resolution.status === 'AMBIGUOUS_VEHICLE') {
    return resolution.clarificationPrompt;
  }

  if (resolution.status === 'AMBIGUOUS_ORDER') {
    return resolution.clarificationPrompt;
  }

  if (resolution.status === 'NO_MATCH') {
    return `> *Ve?culo n?o localizado*\n${resolution.reason}`;
  }

  if (resolution.status === 'UNAVAILABLE') {
    return `> *Consulta Indispon?vel*\n${resolution.technicalError}`;
  }

  // RESOLVED
  const { activeOrder } = resolution;
  const saldoFmt = (val?: number) => (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (operation === 'DELAY_REASON') {
    if (caseContext?.documentedDelayReason) {
      // R11: Motivo documentado de demora exibido com clareza
      const blocks = [
        `> *Situação Operacional: ${activeOrder.vehicleModel || 'Veículo'} (${activeOrder.plate || 'N/D'})*`,
        `- *OS:* #${activeOrder.osId} (${activeOrder.storeSlug})`,
        `- *Status:* *${activeOrder.statusGrid}* (${activeOrder.isOpen ? 'Em Aberto' : 'Finalizada'})`,
        `- *Permanência:* *${activeOrder.daysInYard} dias no pátio*`,
        `- *Motivo da Demora:* ${caseContext.documentedDelayReason}`,
        caseContext.nextPromisedStep ? `- *Próximo Passo:* ${caseContext.nextPromisedStep}` : null,
        `- *Valor:* *${saldoFmt(activeOrder.totalAmount)}*`
      ].filter(Boolean);
      return sanitizeWhatsAppMarkdown(blocks.join('\n'));
    } else {
      // R12: OS sem análise documentada declarando limitação factual honesta
      const blocks = [
        `> *Situação Operacional: ${activeOrder.vehicleModel || 'Veículo'} (${activeOrder.plate || 'N/D'})*`,
        `- *OS:* #${activeOrder.osId} (${activeOrder.storeSlug})`,
        `- *Status:* *${activeOrder.statusGrid}* (${activeOrder.isOpen ? 'Em Aberto' : 'Finalizada'})`,
        `- *Permanência:* *${activeOrder.daysInYard} dias no pátio*`,
        `- *Motivo da Demora:* Não há motivo de atraso formalmente documentado na análise técnica desta OS.`,
        `- *Posição do ERP:* O veículo está registrado na unidade *${activeOrder.storeSlug}* com status *${activeOrder.statusGrid}*.`,
        `- *Valor:* *${saldoFmt(activeOrder.totalAmount)}*`
      ];
      return sanitizeWhatsAppMarkdown(blocks.join('\n'));
    }
  }

  // VEHICLE_SITUATION normal
  const saldoTxt = (activeOrder.remainingBalance ?? 0) > 0
    ? ` (Saldo: *${saldoFmt(activeOrder.remainingBalance)}*)`
    : ' (Quitado)';

  const blocks = [
    `> *OS #${activeOrder.osId} — ${(activeOrder.vehicleModel || 'Veículo').toUpperCase()} (${activeOrder.plate || 'N/D'})*`,
    `- *Loja:* ${activeOrder.storeSlug}`,
    `- *Status:* *${activeOrder.statusGrid}* (${activeOrder.isOpen ? 'Em Aberto' : 'Finalizada'})`,
    `- *Permanência:* ${activeOrder.daysInYard} dia(s) no pátio`,
    `- *Cliente:* ${activeOrder.clientName || 'Não informado'}`,
    `- *Valor Total:* *${saldoFmt(activeOrder.totalAmount)}*${saldoTxt}`
  ];

  if (caseContext?.documentedDelayReason) {
    blocks.push(`- *Situação Operacional:* ${caseContext.documentedDelayReason}`);
  }
  if (caseContext?.nextPromisedStep) {
    blocks.push(`- *Próximo Passo:* ${caseContext.nextPromisedStep}`);
  }

  return sanitizeWhatsAppMarkdown(blocks.join('\n'));
}

/**
 * Mapeia estado do turno existente para ExtendedTurnState.
 */
export function getExtendedTurnState(
  db: Database.Database,
  phone: string,
  maxAgeMinutes: number = 120
): ExtendedTurnState | null {
  const s = getLatestTurnState(db, phone, maxAgeMinutes);
  if (!s) return null;
  return {
    phone: s.phone,
    lastTurnId: s.lastTurnId,
    lastIntent: s.lastIntent,
    lojaSlug: s.lojaSlug,
    vehicleModel: s.filters?.vehicleModel,
    placa: s.placa || s.filters?.placa,
    osId: s.osId || s.filters?.osId,
    pendingRequest: s.filters?.pendingRequest,
    memoryGeneration: s.filters?.memoryGeneration,
    updatedAt: s.updatedAt
  };
}

/**
 * Utilit?rio para verificar se texto expressa consulta sobre motivo de demora / parada.
 */
export function isDelayReasonQuery(text: string): boolean {
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    norm.includes('parado') ||
    norm.includes('demora') ||
    norm.includes('atraso') ||
    norm.includes('atrasado') ||
    norm.includes('travado') ||
    norm.includes('pq esta parado') ||
    norm.includes('por que esta parado') ||
    norm.includes('por que ta parado') ||
    norm.includes('motivo da demora') ||
    norm.includes('motivo do atraso')
  );
}

/**
 * Utilit?rio para verificar se texto expressa consulta sobre veículo individual.
 */
export function isIndividualVehicleQuery(text: string): boolean {
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasVehicleModel = /\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks|voyage|fox|c3|c4|sandero|clio|duster|logan|uno|siena|mobi|strada|saveiro|ka|ecosport|spin|prisma|cruze|fit|city|hr-v|etios|yaris|peugeot|208|308|408|celta|corsa|meriva|zafira|tucson|ix35|up|bravo|punto|amarok|hilux|ranger|s10|toro)\b/i.test(norm);
  const hasPlate = /\b[a-z]{3}-?\d[a-z0-9]\d{2}\b/i.test(norm);
  const hasOsNumber = /\b(?:os|ordem)\s*#?\s*\d+\b/i.test(norm);
  const hasCasePrefix = /\b(?:caso do|caso da|sobre o|sobre a|situacao do|situacao da|quero saber do|quero saber da)\b/i.test(norm);
  return hasVehicleModel || hasPlate || hasOsNumber || hasCasePrefix;
}

export interface HybridOSCoordinatorOptions {
  readonly readerOptions?: ConversationReaderSafeOptions;
  readonly cacheTtlMs?: number;
}

export class HybridOSCoordinator {
  private readonly semanticResolver: ConversationSemanticResolver;
  private readonly situationComposer: OSSituationComposer;
  private readonly readerSafe: ConversationReaderSafe;
  private readonly cacheManager: ConversationCacheManager;

  // Repositório de links para resolução
  private conversationLinks: Map<number, number> = new Map(); // osId -> conversationId

  constructor(
    private readonly sourceAdapter: ConversationSourceAdapter,
    private readonly summaryAdapter: SummaryEvidenceAdapter | IAnalysisRepository,
    private readonly osCatalog: Record<number, FixtureOSData> | IOperationalDataRepository = FIXTURE_OS_CATALOG,
    options?: HybridOSCoordinatorOptions
  ) {
    this.semanticResolver = new ConversationSemanticResolver();
    this.situationComposer = new OSSituationComposer();
    this.readerSafe = new ConversationReaderSafe(sourceAdapter, options?.readerOptions);
    this.cacheManager = new ConversationCacheManager(sourceAdapter, options?.cacheTtlMs);
  }

  public registerLink(osId: number, conversationId: number): void {
    this.conversationLinks.set(osId, conversationId);
  }

  public getCacheManager(): ConversationCacheManager {
    return this.cacheManager;
  }

  /**
   * Executa o fluxo de inspeção da OS cumprindo as diretrizes normativas da Versão 2.
   */
  public async inspectOS(
    input: OSInspectionInput & { securityScope?: SecurityContext }
  ): Promise<CombinedOSSituationReport> {
    const { osId, forceFresh = false, isComplementaryRequested = false } = input;
    const userPersona = input.userPersona || input.securityScope?.persona || 'socio';
    const requestedByLojaSlug = input.requestedByLojaSlug || input.securityScope?.authorizedLojaSlug || input.securityScope?.authorizedStore;

    // 1. Consulta Cadastral no ERP
    let osData: any = null;
    if (this.osCatalog && typeof (this.osCatalog as any).getOSById === 'function') {
      osData = await (this.osCatalog as IOperationalDataRepository).getOSById(osId, requestedByLojaSlug);
    } else if (this.osCatalog && typeof this.osCatalog === 'object') {
      osData = (this.osCatalog as Record<number, FixtureOSData>)[osId] || null;
    }

    if (!osData) {
      throw new Error(`OS_NOT_FOUND: Ordem de serviço ${osId} não localizada no sistema.`);
    }

    // 2. Gate de Segurança e Isolamento de Loja (T48)
    const userAuthorizedStore = (requestedByLojaSlug || input.securityScope?.authorizedLojaSlug || '').toLowerCase();
    if (userPersona === 'gerente') {
      if (!userAuthorizedStore || userAuthorizedStore !== osData.lojaSlug.toLowerCase()) {
        throw new SecurityAccessDeniedError(
          `ACESSO_NEGADO: Usuário com perfil de gerente da loja '${userAuthorizedStore || requestedByLojaSlug}' não tem permissão para acessar a OS ${osId} pertencente à loja '${osData.lojaSlug}'.`
        );
      }
    }

    // 3. Obtenção de Análise Existente para determinar a versão da análise
    let existingAnalysis: ConversationAnalysisRecord | null = null;
    if (this.summaryAdapter) {
      if ('getAnalysisByOS' in this.summaryAdapter && typeof (this.summaryAdapter as any).getAnalysisByOS === 'function') {
        existingAnalysis = await (this.summaryAdapter as any).getAnalysisByOS(osId, osData.lojaSlug);
      }
    }

    let conversationId = this.conversationLinks.get(osId);
    if (!conversationId && existingAnalysis?.conversationId) {
      conversationId = existingAnalysis.conversationId;
      this.conversationLinks.set(osId, conversationId);
    }

    if (!existingAnalysis && this.summaryAdapter && conversationId) {
      if (
        'getSummaryForConversation' in this.summaryAdapter &&
        typeof (this.summaryAdapter as any).getSummaryForConversation === 'function'
      ) {
        existingAnalysis = (this.summaryAdapter as any).getSummaryForConversation(conversationId);
      }
    }

    const analysisVersion = existingAnalysis?.analysisVersion ?? 'v1.0';
    const erpUpdatedAt = osData.updatedAt;

    // 4. Checagem de Cache Multi-Fatorial (F07 & Gate 4)
    if (!forceFresh) {
      const cached = await this.cacheManager.get(
        osData.lojaSlug,
        osId,
        userPersona,
        analysisVersion,
        erpUpdatedAt,
        conversationId,
        osData.vehiclePlate,
        0,
        isComplementaryRequested
      );
      if (cached) {
        return cached;
      }
    }

    // 5. Verificação de Ambiguidade de Contato (T42, F03 & Gate 3)
    let otherOSs: any[] = [];
    if (this.osCatalog && typeof (this.osCatalog as any).listActiveOSsByPhone === 'function') {
      if (osData.customerPhone) {
        const list = await (this.osCatalog as IOperationalDataRepository).listActiveOSsByPhone(osData.customerPhone, osData.lojaSlug);
        otherOSs = list.filter(other => other.osId !== osData.osId);
      }
    } else if (this.osCatalog && typeof this.osCatalog === 'object') {
      otherOSs = Object.values(this.osCatalog).filter(
        (other: any) => other && other.customerPhone === osData.customerPhone && other.osId !== osData.osId
      );
    }

    // CORREÇÃO F03 & GATE 3: Filtrar compulsoriamente candidatos de ambiguidade
    // pela loja autorizada ANTES de montar a lista de ambiguidade para perfil gerente.
    // Nenhuma placa ou OS de outra loja pode vazar para gerente.
    if (userPersona === 'gerente') {
      otherOSs = otherOSs.filter(
        other => other.lojaSlug.toLowerCase() === userAuthorizedStore
      );
    }

    // 6. Resolução de Vínculo e Gate de Veto (F04 & Gate 2)
    let confirmedLink: OSConversationLink | null = null;
    let serviceUnavailable = false;

    if (!conversationId) {
      // Sem conversa associada à OS: entrega dados do ERP com aviso explícito
      const reportNoLink = this.situationComposer.compose({
        osId: osData.osId,
        lojaSlug: osData.lojaSlug,
        vehiclePlate: osData.vehiclePlate,
        vehicleModel: osData.vehicleModel,
        erpState: {
          status: osData.status,
          totalValue: osData.totalValue,
          paidValue: osData.paidValue,
          pendingServices: osData.pendingServices,
          updatedAt: osData.updatedAt
        },
        noLinkConfirmed: true,
        linkInfo: null,
        cachedResponse: false
      });

      return {
        ...reportNoLink,
        approvalAttributed: false,
        linkInfo: null
      };
    }

    // Modo Padrão: se a análise existente já cobre formalmente esta OS, o vínculo é comprovado (Diretriz 5)
    if (existingAnalysis && existingAnalysis.coveredOsIds && existingAnalysis.coveredOsIds.includes(osId)) {
      confirmedLink = {
        linkId: `link_struct_${osId}_${conversationId}`,
        osId,
        lojaSlug: osData.lojaSlug,
        conversationId,
        inboxId: 1,
        linkMethod: 'STRUCTURAL_FIELD',
        confidence: 'STRUCTURAL_CERTAIN',
        evidence: {
          osNumberText: String(osId),
          periodMatch: true,
          matchedAt: existingAnalysis.generatedAt || new Date().toISOString()
        },
        status: 'ACTIVE'
      };
    }

    // Se o vínculo ainda não foi confirmado pela análise estrutural, avalia dinamicamente
    if (!confirmedLink) {
      let convMessagesSample: SanitizedMessage[] = [];
      try {
        convMessagesSample = await this.sourceAdapter.fetchMessages({ conversationId, limit: 10 });
      } catch {
        serviceUnavailable = true;
      }

      if (!serviceUnavailable) {
        const linkEval = this.semanticResolver.evaluateLink(
          {
            osId: osData.osId,
            lojaSlug: osData.lojaSlug,
            vehiclePlate: osData.vehiclePlate,
            customerPhone: osData.customerPhone,
            customerName: osData.customerName,
            openedAt: osData.openedAt
          },
          {
            conversationId,
            inboxId: 1,
            lojaSlug: osData.lojaSlug,
            contactPhone: osData.customerPhone,
            contactName: osData.customerName,
            messagesSample: convMessagesSample
          },
          otherOSs.map(o => ({
            osId: o.osId,
            lojaSlug: o.lojaSlug,
            vehiclePlate: o.vehiclePlate,
            customerPhone: o.customerPhone,
            customerName: o.customerName,
            openedAt: o.openedAt
          }))
        );

        // Tratamento de Ambiguidade: candidatos expostos NUNCA contêm veículos de outra loja (Gate 3)
        if (linkEval.isAmbiguous) {
          const ambiguityCandidates = [
            { osId: osData.osId, vehiclePlate: osData.vehiclePlate, description: `${osData.vehicleModel} - ${osData.status}` },
            ...otherOSs.map(o => ({ osId: o.osId, vehiclePlate: o.vehiclePlate, description: `${o.vehicleModel} - ${o.status}` }))
          ];

          const ambReport = this.situationComposer.compose({
            osId: osData.osId,
            lojaSlug: osData.lojaSlug,
            vehiclePlate: osData.vehiclePlate,
            vehicleModel: osData.vehicleModel,
            erpState: {
              status: osData.status,
              totalValue: osData.totalValue,
              paidValue: osData.paidValue,
              pendingServices: osData.pendingServices,
              updatedAt: osData.updatedAt
            },
            ambiguityCandidates
          });

          return {
            ...ambReport,
            otherStorePlateExposed: false,
            otherStoreOsExposed: false
          };
        }

        // CORREÇÃO F04 & GATE 2: Se resolver.evaluateLink() não confirmar vínculo Nível 1 ou 2,
        // ABORTAR incorporação de conversa. Entregar dados da oficina + aviso de ausência de vínculo.
        if (!linkEval.link || (linkEval.link.confidence !== 'STRUCTURAL_CERTAIN' && linkEval.link.confidence !== 'CONTEXTUAL_HIGH')) {
          const reportNoLink = this.situationComposer.compose({
            osId: osData.osId,
            lojaSlug: osData.lojaSlug,
            vehiclePlate: osData.vehiclePlate,
            vehicleModel: osData.vehicleModel,
            erpState: {
              status: osData.status,
              totalValue: osData.totalValue,
              paidValue: osData.paidValue,
              pendingServices: osData.pendingServices,
              updatedAt: osData.updatedAt
            },
            noLinkConfirmed: true,
            linkInfo: null,
            cachedResponse: false
          });

          return {
            ...reportNoLink,
            approvalAttributed: false,
            linkInfo: null
          };
        }

        confirmedLink = linkEval.link;
      }
    }

    // 7. Extração de Afirmações: Modo Padrão vs Modo Complementar
    let extractedStatements: ExtractedStatement[] = [];
    let detectedGaps: ConversationGap[] = [];
    let cursorLastMessageId = 0;
    let newMessagesInspectedCount = 0;
    let isStale = false;
    let truncationGapOccurred = false;
    let lastMessageRepresented = true;

    if (conversationId) {
      if (existingAnalysis && existingAnalysis.isValid) {
        // Modo Padrão: Reutiliza afirmações da análise existente (Diretriz 5)
        extractedStatements = existingAnalysis.statements ? [...existingAnalysis.statements.filter(s => s.targetOsId === osId)] : [];
        detectedGaps = existingAnalysis.gaps ? [...existingAnalysis.gaps] : [];
        cursorLastMessageId = existingAnalysis.analyzedUntilMessageId ?? existingAnalysis.cursorLastMessageId ?? 0;
      }

      // Modo Complementar (Acionado EXCLUSIVAMENTE sob demanda - Diretriz 5 & F06)
      if (isComplementaryRequested) {
        try {
          const compResult = await this.readerSafe.readComplementaryHistory({
            conversationId,
            limit: 20
          });

          newMessagesInspectedCount = compResult.totalInspectedCount;
          truncationGapOccurred = compResult.truncationGap;
          lastMessageRepresented = compResult.lastMessageRepresented;

          // Adiciona lacunas detectadas (incluindo TRUNCATED_HISTORY se > 20 msgs - Gate 5)
          detectedGaps.push(...compResult.gaps);

          if (compResult.messages.length > 0) {
            isStale = true;
            for (const msg of compResult.messages) {
              const stmt = this.semanticResolver.extractStatement(msg, osId, extractedStatements);
              if (stmt) {
                // Substituição por mensagem editada: descarta versão anterior com o mesmo messageId (Gate 4)
                extractedStatements = extractedStatements.filter(s => s.messageId !== msg.messageId);
                if (stmt.subject === 'CLIENT_REFUSAL') {
                  extractedStatements = extractedStatements.filter(s => s.subject !== 'CLIENT_APPROVAL');
                }
                extractedStatements.push(stmt);
              }
              if (msg.messageId > cursorLastMessageId) {
                cursorLastMessageId = msg.messageId;
              }
            }
          }
        } catch {
          serviceUnavailable = true;
        }
      }
    }

    // Fallback gracioso em caso de API de mensageria indisponível
    if (serviceUnavailable) {
      const fallbackReport = this.situationComposer.compose({
        osId: osData.osId,
        lojaSlug: osData.lojaSlug,
        vehiclePlate: osData.vehiclePlate,
        vehicleModel: osData.vehicleModel,
        erpState: {
          status: osData.status,
          totalValue: osData.totalValue,
          paidValue: osData.paidValue,
          pendingServices: osData.pendingServices,
          updatedAt: osData.updatedAt
        },
        linkInfo: confirmedLink,
        conversationServiceUnavailable: true,
        cachedResponse: false
      });

      return {
        ...fallbackReport,
        approvalAttributed: false
      };
    }

    // 8. Composição do Relatório e Balão WhatsApp Nativo
    const approvalAttributed = extractedStatements.some(s => s.subject === 'CLIENT_APPROVAL');

    const composed = this.situationComposer.compose({
      osId: osData.osId,
      lojaSlug: osData.lojaSlug,
      vehiclePlate: osData.vehiclePlate,
      vehicleModel: osData.vehicleModel,
      erpState: {
        status: osData.status,
        totalValue: osData.totalValue,
        paidValue: osData.paidValue,
        pendingServices: osData.pendingServices,
        updatedAt: osData.updatedAt
      },
      analysisState: existingAnalysis ? {
        analysisId: existingAnalysis.analysisId ?? existingAnalysis.summaryId ?? `ana_${osId}`,
        analysisVersion,
        analyzedUntilTimestamp: existingAnalysis.analyzedUntilTimestamp ?? existingAnalysis.messagesCoveredUntil ?? osData.updatedAt,
        statements: existingAnalysis.statements ?? [],
        gaps: existingAnalysis.gaps ?? []
      } : undefined,
      conversationState: conversationId ? {
        conversationId,
        lastMessageAt: osData.updatedAt,
        statements: extractedStatements,
        gaps: detectedGaps,
        isStale,
        newMessagesInspectedCount
      } : undefined,
      linkInfo: confirmedLink,
      conversationServiceUnavailable: false,
      cachedResponse: false
    });

    const report: CombinedOSSituationReport = {
      ...composed,
      approvalAttributed,
      linkInfo: confirmedLink,
      otherStorePlateExposed: false,
      otherStoreOsExposed: false,
      lastMessageRepresented
    };

    // 9. Persistência no Cache se o serviço executou com sucesso
    if (conversationId && confirmedLink) {
      this.cacheManager.set(
        osData.lojaSlug,
        osId,
        userPersona,
        analysisVersion,
        erpUpdatedAt,
        report,
        cursorLastMessageId,
        osData.vehiclePlate
      );
    }

    return report;
  }

  /**
   * Executa a inspeção de veículo físico com resolução discriminada,
   * suporte a ambiguidade de veículos/ordens e isolamento de segurança.
   */
  public async inspectVehicle(input: VehicleInspectionInput): Promise<CombinedOSSituationReport> {
    const {
      vehicleModel,
      vehiclePlate,
      osId,
      requestedByLojaSlug,
      securityScope,
      isComplementaryRequested = false,
      forceFresh = false
    } = input;

    if (!securityScope || typeof securityScope !== 'object' || !securityScope.persona) {
      throw new SecurityAccessDeniedError('Contexto de segurança obrigatório e não informado.');
    }

    const persona = securityScope.persona;
    const authorizedLoja = (securityScope.authorizedLojaSlug || securityScope.authorizedStore || '').toLowerCase();
    const targetLoja = (requestedByLojaSlug || '').toLowerCase();

    if (persona === 'gerente') {
      if (!authorizedLoja || (targetLoja && targetLoja !== authorizedLoja)) {
        throw new SecurityAccessDeniedError(
          `ACESSO_NEGADO: Usuário com perfil gerente tem permissão apenas para a unidade ${authorizedLoja || 'autorizada'}.`
        );
      }
    }

    if (osId) {
      return await this.inspectOS({
        osId,
        userPersona: persona,
        requestedByLojaSlug: targetLoja || authorizedLoja,
        securityScope,
        isComplementaryRequested,
        forceFresh
      });
    }

    // 1. Repositório Real ou Adaptador com searchVehiclesByModel
    if (this.osCatalog && typeof (this.osCatalog as any).searchVehiclesByModel === 'function') {
      const searchRes = await (this.osCatalog as any).searchVehiclesByModel(
        vehicleModel || vehiclePlate || '',
        securityScope,
        targetLoja || authorizedLoja
      );

      if (searchRes.type === 'UNAVAILABLE' || searchRes.status === 'UNAVAILABLE') {
        return this.situationComposer.compose({
          osId: 0,
          lojaSlug: targetLoja || authorizedLoja || 'loja',
          vehiclePlate: vehiclePlate || 'UNKNOWN',
          vehicleModel: vehicleModel || 'veículo',
          erpState: { status: 'Indisponível', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
          unavailable: { requestedModel: vehicleModel || 'veículo', lojaSlug: targetLoja || authorizedLoja, reason: searchRes.message || 'Falha técnica no banco de dados' }
        });
      }

      if (searchRes.type === 'NOT_FOUND' || searchRes.status === 'NO_MATCH') {
        return this.situationComposer.compose({
          osId: 0,
          lojaSlug: targetLoja || authorizedLoja || 'loja',
          vehiclePlate: vehiclePlate || 'UNKNOWN',
          vehicleModel: vehicleModel || 'veículo',
          erpState: { status: 'Não encontrado', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
          noMatch: { requestedModel: vehicleModel || vehiclePlate || 'veículo', lojaSlug: targetLoja || authorizedLoja }
        });
      }

      if (searchRes.status === 'AMBIGUOUS_VEHICLE' || (searchRes.candidates && searchRes.candidates.length > 1)) {
        return this.situationComposer.compose({
          osId: 0,
          lojaSlug: targetLoja || authorizedLoja,
          vehiclePlate: searchRes.candidates.map((c: any) => c.plate || c.vehiclePlate).join(', '),
          vehicleModel: vehicleModel || searchRes.candidates[0]?.model || '',
          erpState: { status: 'Ambiguidade', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
          ambiguousVehicles: searchRes.candidates
        });
      }

      if (searchRes.status === 'AMBIGUOUS_ORDER' || (searchRes.candidateOrders && searchRes.candidateOrders.length > 1)) {
        const vehicle = searchRes.vehicle || {
          plate: searchRes.candidateOrders[0]?.plate || searchRes.candidateOrders[0]?.vehiclePlate || '',
          model: searchRes.candidateOrders[0]?.model || searchRes.candidateOrders[0]?.vehicleModel || vehicleModel || '',
          storeSlug: targetLoja || authorizedLoja
        };
        return this.situationComposer.compose({
          osId: Number(searchRes.candidateOrders[0]?.osId) || 0,
          lojaSlug: targetLoja || authorizedLoja,
          vehiclePlate: vehicle.plate || '',
          vehicleModel: vehicle.model || '',
          erpState: { status: 'Ambiguidade', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
          ambiguousOrders: searchRes.candidateOrders
        });
      }

      if (searchRes.type === 'RESOLVED' || searchRes.status === 'RESOLVED') {
        const targetOsId = Number(searchRes.order?.osId || searchRes.activeOrder?.osId);
        return await this.inspectOS({
          osId: targetOsId,
          userPersona: persona,
          requestedByLojaSlug: targetLoja || authorizedLoja,
          securityScope,
          isComplementaryRequested,
          forceFresh
        });
      }
    }

    // 2. Consulta em Dicionário de Fixtures
    const storeToFilter = targetLoja || authorizedLoja;
    let catalogItems = Object.values(this.osCatalog as Record<number, FixtureOSData>);
    if (storeToFilter) {
      catalogItems = catalogItems.filter(item => item && item.lojaSlug.toLowerCase() === storeToFilter);
    }

    if (vehiclePlate) {
      const cleanPlate = vehiclePlate.toUpperCase().replace(/[^A-Z0-9]/g, '');
      catalogItems = catalogItems.filter(item => {
        const itemPlate = (item.vehiclePlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return itemPlate === cleanPlate;
      });
    } else if (vehicleModel) {
      const cleanModel = vehicleModel.toLowerCase().trim();
      catalogItems = catalogItems.filter(item => {
        const itemModel = (item.vehicleModel || '').toLowerCase();
        return itemModel.includes(cleanModel);
      });
    }

    if (catalogItems.length === 0) {
      return this.situationComposer.compose({
        osId: 0,
        lojaSlug: storeToFilter || 'loja',
        vehiclePlate: vehiclePlate || 'UNKNOWN',
        vehicleModel: vehicleModel || 'veículo',
        erpState: { status: 'Não encontrado', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
        noMatch: { requestedModel: vehicleModel || vehiclePlate || 'veículo', lojaSlug: storeToFilter }
      });
    }

    // Agrupa por veículo físico (pela placa)
    const vehicleGroups = new Map<string, FixtureOSData[]>();
    for (const item of catalogItems) {
      const key = (item.vehiclePlate || '').trim().toUpperCase() || `NO_PLATE_${item.osId}`;
      const group = vehicleGroups.get(key) || [];
      group.push(item);
      vehicleGroups.set(key, group);
    }

    if (vehicleGroups.size > 1) {
      // AMBIGUOUS_VEHICLE
      const ambiguousVehicles: CandidateVehicle[] = Array.from(vehicleGroups.entries()).map(([plateKey, items]) => {
        const prime = items[0];
        return {
          plate: prime.vehiclePlate,
          vehiclePlate: prime.vehiclePlate,
          model: prime.vehicleModel,
          vehicleModel: prime.vehicleModel,
          clientName: prime.customerName,
          customerName: prime.customerName,
          storeSlug: prime.lojaSlug,
          lojaSlug: prime.lojaSlug,
          lastActiveOsId: prime.osId
        };
      });

      return this.situationComposer.compose({
        osId: 0,
        lojaSlug: storeToFilter || ambiguousVehicles[0]?.lojaSlug || '',
        vehiclePlate: ambiguousVehicles.map(v => v.plate).join(', '),
        vehicleModel: vehicleModel || ambiguousVehicles[0]?.model || '',
        erpState: { status: 'Ambiguidade', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
        ambiguousVehicles
      });
    }

    // Exatamente 1 veículo físico. Checar ordens:
    const [, primeItems] = Array.from(vehicleGroups.entries())[0];
    if (primeItems.length > 1) {
      // AMBIGUOUS_ORDER
      const prime = primeItems[0];
      const ambiguousOrders: CandidateOrder[] = primeItems.map(item => ({
        osId: item.osId,
        storeSlug: item.lojaSlug,
        lojaSlug: item.lojaSlug,
        plate: item.vehiclePlate,
        vehiclePlate: item.vehiclePlate,
        model: item.vehicleModel,
        vehicleModel: item.vehicleModel,
        clientName: item.customerName,
        customerName: item.customerName,
        status: item.status,
        statusGrid: item.status,
        isAberta: true,
        totalValue: item.totalValue,
        totalAmount: item.totalValue,
        paidValue: item.paidValue,
        remainingBalance: (item.totalValue || 0) - (item.paidValue || 0),
        openedAt: item.openedAt,
        updatedAt: item.updatedAt
      }));

      return this.situationComposer.compose({
        osId: prime.osId,
        lojaSlug: prime.lojaSlug,
        vehiclePlate: prime.vehiclePlate,
        vehicleModel: prime.vehicleModel,
        erpState: {
          status: prime.status,
          totalValue: prime.totalValue,
          paidValue: prime.paidValue,
          pendingServices: prime.pendingServices,
          updatedAt: prime.updatedAt
        },
        ambiguousOrders
      });
    }

    // Exatamente 1 veículo e 1 ordem: RESOLVED
    const singleOs = primeItems[0];
    return await this.inspectOS({
      osId: singleOs.osId,
      userPersona: persona,
      requestedByLojaSlug: storeToFilter || singleOs.lojaSlug,
      securityScope,
      isComplementaryRequested,
      forceFresh
    });
  }
}
