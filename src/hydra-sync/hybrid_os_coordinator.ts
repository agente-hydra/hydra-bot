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
  ExtendedTurnState
} from './types/conversation_context_contract.js';
import {
  getLatestTurnState,
  saveTurnState,
  type TurnState
} from './turn_context_repository.js';
import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks
} from './format_utils.js';

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
 * Recupera o contexto factual do caso e an?lise can?nica da OS (R10, R11, R12).
 * Se houver motivo documentado, exp?e claramente (R11).
 * Se n?o houver an?lise documentada, declara limita??o factual honesta (R12).
 */
export function getCaseContext(
  db: Database.Database,
  order: CandidateOrder
): CaseContextResult {
  try {
    const row = db.prepare(`
      SELECT raw_payload, estado_operacional, qualidade_dado, data_observacao_iso,
             origem_transicao
      FROM ordens_servico
      WHERE os_id = ?
    `).get(order.osId) as any;

    let documentedDelayReason: string | undefined;
    let nextPromisedStep: string | undefined;
    let lastObservationDate: string | undefined = row?.data_observacao_iso;
    let evidenceOrigin: 'GRAPH_PROJECTION' | 'CANONICAL_ANALYSIS' | 'ERP_DIRECT' = 'ERP_DIRECT';

    if (row?.raw_payload) {
      try {
        const payload = typeof row.raw_payload === 'string'
          ? JSON.parse(row.raw_payload)
          : row.raw_payload;

        if (payload && typeof payload === 'object') {
          const possibleReason = 
            payload.motivo_demora ||
            payload.motivo_atraso ||
            payload.analise_demora ||
            payload.parecer_tecnico ||
            payload.observacao ||
            payload.motivo;

          if (typeof possibleReason === 'string' && possibleReason.trim().length > 0) {
            documentedDelayReason = possibleReason.trim();
            evidenceOrigin = 'CANONICAL_ANALYSIS';
          }

          const possibleStep = payload.proximo_passo || payload.acao_necessaria;
          if (typeof possibleStep === 'string' && possibleStep.trim().length > 0) {
            nextPromisedStep = possibleStep.trim();
          }
        }
      } catch {}
    }

    if (documentedDelayReason) {
      return {
        order,
        coverage: 'FULL',
        documentedDelayReason,
        nextPromisedStep,
        lastObservationDate,
        evidenceOrigin,
        isLimitationDeclared: false
      };
    }

    // Sem motivo documentado formalmente na an?lise can?nica (R12)
    return {
      order,
      coverage: 'PARTIAL_ERP_ONLY',
      documentedDelayReason: undefined,
      nextPromisedStep: undefined,
      lastObservationDate,
      evidenceOrigin: 'ERP_DIRECT',
      isLimitationDeclared: true
    };
  } catch (err: any) {
    return {
      order,
      coverage: 'NOT_IN_ANALYSIS',
      documentedDelayReason: undefined,
      nextPromisedStep: undefined,
      lastObservationDate: undefined,
      evidenceOrigin: 'ERP_DIRECT',
      isLimitationDeclared: true
    };
  }
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
  const saldoFmt = (val: number) => (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (operation === 'DELAY_REASON') {
    if (caseContext?.documentedDelayReason) {
      // R11: Motivo documentado de demora exibido com clareza
      const blocks = [
        `> *Situação Operacional: ${activeOrder.vehicleModel} (${activeOrder.plate})*`,
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
        `> *Situação Operacional: ${activeOrder.vehicleModel} (${activeOrder.plate})*`,
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
  const saldoTxt = activeOrder.remainingBalance > 0
    ? ` (Saldo: *${saldoFmt(activeOrder.remainingBalance)}*)`
    : ' (Quitado)';

  const blocks = [
    `> *Situação Operacional: ${activeOrder.vehicleModel} (${activeOrder.plate})*`,
    `- *OS:* #${activeOrder.osId} (${activeOrder.storeSlug})`,
    `- *Status:* *${activeOrder.statusGrid}* (${activeOrder.isOpen ? 'Em Aberto' : 'Finalizada'})`,
    `- *Permanência:* *${activeOrder.daysInYard} dias no pátio*`,
    `- *Cliente:* ${activeOrder.clientName || 'Não informado'}`,
    `- *Valor Total:* *${saldoFmt(activeOrder.totalAmount)}*${saldoTxt}`
  ];

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
  const hasVehicleModel = /\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks)\b/i.test(norm);
  const hasPlate = /\b[a-z]{3}-?\d[a-z0-9]\d{2}\b/i.test(norm);
  const hasOsNumber = /\b(?:os|ordem)\s*#?\s*\d+\b/i.test(norm);
  const hasCasePrefix = /\b(?:caso do|caso da|sobre o|sobre a|situacao do|situacao da|quero saber do|quero saber da)\b/i.test(norm);
  return hasVehicleModel || hasPlate || hasOsNumber || hasCasePrefix;
}
