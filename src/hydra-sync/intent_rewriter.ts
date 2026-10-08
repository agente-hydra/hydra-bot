import type {
  OperationType as ContextOperationType,
  TurnPendingRequest,
  ExtendedTurnState
} from './types/conversation_context_contract.js';
import {
  stripFillerWords,
  CORRECTION_REGEX,
  CORRECTION_PREFIX_REGEX,
  isCorrectionMessage,
  extractStrippedCorrection,
  STRICT_HISTORY_REGEX,
  isConversationHistoryStrict,
  isDelayReasonQuery,
  isVehicleCountQuery,
  isVehicleListQuery,
  isStoreSummaryQuery,
  createOrPreservePendingRequest
} from './conversation_semantic_resolver.js';
import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { TurnState, IntentType, TurnFilters } from './turn_context_repository.js';
import { CATALOGO_10_LOJAS } from './db_repository.js';
import type { QueryPlan, QueryComponent, GapRecord } from './types/query_contract.js';
import { NO_PHYSICAL_YARD_DISCLAIMER } from './semantic_prompt.js';
import { resolveSemanticArea, OFFICIAL_AREAS } from './semantic_glossary.js';
import {
  CONVERSATION_CONTRACT_VERSION,
  CAPABILITIES_VERSION,
  type QueryScope,
  type AnswerRequirement,
  type InterpretationContract,
  type InboundPart,
  type MediaEvidence,
  type MessageBatchPayload,
  type TurnContract,
  type ExecutionDecision,
  type OperationType,
  type TurnRelationType,
  type ResolvedEntities,
  type ResolvedStore,
  type StructuredFilters,
  type SortConfig,
  type AmbiguityResolution,
  type ExecutionPlan
} from './types/conversation_contract.js';
import type {
  CompactSemanticDecision,
  RequiredComponentType,
  ComponentExecutionStatus
} from './types/language_contract.js';

export interface CanonicalIntent {
  turnId: string;
  canonicalQuestion: string;
  intent: IntentType;
  operation?: ContextOperationType | string;
  operationType?: ContextOperationType;
  vehicleModel?: string;
  pendingRequest?: TurnPendingRequest;
  intents?: IntentType[];
  scope?: QueryScope;
  lojaSlug?: string;
  placa?: string;
  osId?: string;
  veiculo?: string;
  onlyOpen?: boolean;
  noDeposit?: boolean;
  serviceTerms?: string[];
  subIntent?: 'goal_gap' | 'store_list' | 'single_store' | 'general' | 'worst_store' | 'worst_area';
  parts?: InboundPart[];
  mediaEvidence?: MediaEvidence[];
  focusWorst?: boolean;
  sort?: SortConfig;
  needsClarification?: boolean;
  clarificationMessage?: string;
  contract?: TurnContract;
  interpretation?: InterpretationContract;
  targetArea?: string;
  answerRequirements?: AnswerRequirement[];
  subQueries?: CanonicalIntent[];
  queryPlan?: QueryPlan;
  declaration?: string;
  lacksPhysicalYardEvidence?: boolean;
  compactDecision?: CompactSemanticDecision;
}

/**
 * Catálogo Oficial de Lojas da Rede e seus Aliases / Abreviações
 */

/**
 * Retorna o intervalo civil exato de 30 datas consecutivas no fuso America/Sao_Paulo:
 * [Hoje - 29 dias 00:00:00, Hoje 23:59:59].
 * Declaração obrigatória expressa: 'Ordens abertas entre DD/MM e DD/MM (inclui as já encerradas).'
 */
export function getCivilDateRange30Days(nowDate: Date = new Date()): {
  startDateIso: string;
  endDateIso: string;
  startDDMM: string;
  endDDMM: string;
  declaration: string;
} {
  const spFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = spFormatter.formatToParts(nowDate);
  const dayStr = parts.find(p => p.type === 'day')?.value || '01';
  const monthStr = parts.find(p => p.type === 'month')?.value || '01';
  const yearStr = parts.find(p => p.type === 'year')?.value || '2026';

  const currentCivil = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 12, 0, 0));
  const startCivil = new Date(currentCivil.getTime() - 29 * 24 * 60 * 60 * 1000);

  const startDay = String(startCivil.getUTCDate()).padStart(2, '0');
  const startMonth = String(startCivil.getUTCMonth() + 1).padStart(2, '0');
  const startYear = String(startCivil.getUTCFullYear());

  const startDDMM = `${startDay}/${startMonth}`;
  const endDDMM = `${dayStr}/${monthStr}`;

  const startDateIso = `${startYear}-${startMonth}-${startDay} 00:00:00`;
  const endDateIso = `${yearStr}-${monthStr}-${dayStr} 23:59:59`;

  const declaration = `Ordens abertas entre ${startDDMM} e ${endDDMM} (inclui as já encerradas).`;

  return {
    startDateIso,
    endDateIso,
    startDDMM,
    endDDMM,
    declaration
  };
}

export function composeOrdersLast30DaysDeclaration(nowDate?: Date): string {
  return getCivilDateRange30Days(nowDate).declaration;
}

/**
 * Retorna o dia civil de ontem no fuso America/Sao_Paulo (D-1):
 * [Ontem 00:00:00, Ontem 23:59:59]
 */
export function getCivilYesterdayDate(nowDate: Date = new Date()): {
  dateStr: string;
  startDateIso: string;
  endDateIso: string;
  ddmm: string;
} {
  const spFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = spFormatter.formatToParts(nowDate);
  const dayStr = parts.find(p => p.type === 'day')?.value || '01';
  const monthStr = parts.find(p => p.type === 'month')?.value || '01';
  const yearStr = parts.find(p => p.type === 'year')?.value || '2026';

  const currentCivil = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 12, 0, 0));
  const yesterdayCivil = new Date(currentCivil.getTime() - 24 * 60 * 60 * 1000);

  const yDay = String(yesterdayCivil.getUTCDate()).padStart(2, '0');
  const yMonth = String(yesterdayCivil.getUTCMonth() + 1).padStart(2, '0');
  const yYear = String(yesterdayCivil.getUTCFullYear());

  const dateStr = `${yYear}-${yMonth}-${yDay}`;
  return {
    dateStr,
    startDateIso: `${dateStr} 00:00:00`,
    endDateIso: `${dateStr} 23:59:59`,
    ddmm: `${yDay}/${yMonth}`
  };
}

/**
 * Retorna o intervalo civil do mês anterior completo no fuso America/Sao_Paulo:
 * [01 do mês passado 00:00:00, Último dia do mês passado 23:59:59]
 */
export function getCivilLastMonthRange(nowDate: Date = new Date()): {
  startDate: string;
  endDate: string;
  startDateIso: string;
  endDateIso: string;
  monthName: string;
} {
  const spFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = spFormatter.formatToParts(nowDate);
  const monthStr = parts.find(p => p.type === 'month')?.value || '01';
  const yearStr = parts.find(p => p.type === 'year')?.value || '2026';

  let prevMonth = Number(monthStr) - 1;
  let prevYear = Number(yearStr);
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const mm = String(prevMonth).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');

  const startDate = `${prevYear}-${mm}-01`;
  const endDate = `${prevYear}-${mm}-${dd}`;

  return {
    startDate,
    endDate,
    startDateIso: `${startDate} 00:00:00`,
    endDateIso: `${endDate} 23:59:59`,
    monthName: `${mm}/${prevYear}`
  };
}

/**
 * Constrói a Decisão Semântica Compacta estruturada para conformidade estrita com o Contrato de Linguagem.
 */
export function buildCompactSemanticDecision(
  res: CanonicalIntent,
  rawText: string,
  previousState?: TurnState | ExtendedTurnState | null
): CompactSemanticDecision {
  const norm = (rawText || res.canonicalQuestion || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // 1. Determinação rigorosa de período civil
  let period: 'hoje' | 'ontem' | 'mes_atual' | 'mes_passado' | 'ultimos_30_dias' | 'custom' = 'hoje';
  let periodDates: { startDate: string; endDate: string } | undefined;

  const isOntem = /\b(ontem|d-1|dia anterior)\b/i.test(norm) || (res.contract?.period?.label === 'Ontem')  || (res.contract?.period?.type as string) === 'ontem';
  const is30Dias = /\b(30\s*dias|trinta\s*dias|ultimos\s*30\s*dias)\b/i.test(norm) || (res.contract?.period?.type === 'ultimos_30d');
  const isMesPassado = /\b(mes passado|ultimo mes|mes anterior)\b/i.test(norm) && !is30Dias;
  const isMesAtual = (/\b(mes|do mes|no mes|mensal|meta|metas|acumulado)\b/i.test(norm) && !isMesPassado && !is30Dias) || (res.contract?.period?.type === 'mes_atual');

  if (isOntem) {
    period = 'ontem';
    const yesterday = getCivilYesterdayDate();
    periodDates = { startDate: yesterday.dateStr, endDate: yesterday.dateStr };
  } else if (is30Dias) {
    period = 'ultimos_30_dias';
    const range30 = getCivilDateRange30Days();
    periodDates = { startDate: range30.startDateIso.split(' ')[0], endDate: range30.endDateIso.split(' ')[0] };
  } else if (isMesPassado) {
    period = 'mes_passado';
    const rangeMonth = getCivilLastMonthRange();
    periodDates = { startDate: rangeMonth.startDate, endDate: rangeMonth.endDate };
  } else if (isMesAtual) {
    period = 'mes_atual';
  } else {
    period = 'hoje';
  }

  // 2. Extração dos componentes requeridos
  const requestedComponents: RequiredComponentType[] = [];

  if (res.subQueries && res.subQueries.length > 0) {
    for (const sq of res.subQueries) {
      if (sq.intent === 'financial_alerts') {
        requestedComponents.push(period === 'mes_atual' ? 'REVENUE_MONTH' : 'REVENUE_DAY');
      } else if (sq.intent === 'list_os') {
        requestedComponents.push('OS_LIST');
      } else if (sq.intent === 'store_cmv') {
        requestedComponents.push('STORE_CMV');
      }
    }
  }

  if (requestedComponents.length === 0 && res.queryPlan?.components && res.queryPlan.components.length > 0) {
    for (const comp of res.queryPlan.components) {
      if (comp.capabilityId === 'CAP-REVENUE-DAY') requestedComponents.push('REVENUE_DAY');
      else if (comp.capabilityId === 'CAP-REVENUE-MONTH') requestedComponents.push('REVENUE_MONTH');
      else if (comp.capabilityId === 'CAP-CMV-STORE') requestedComponents.push('STORE_CMV');
      else if (comp.capabilityId === 'CAP-OS-LIST') requestedComponents.push('OS_LIST');
      else if (comp.capabilityId === 'CAP-OS-DETAIL') requestedComponents.push('OS_DETAIL');
    }
  }

  // Fallback baseado no intent e vocabulário semântico
  if (requestedComponents.length === 0) {
    if (res.intent === 'financial_alerts') {
      if (norm.includes('meta') || norm.includes('metas') || norm.includes('falta')) {
        requestedComponents.push('METAS_SUMMARY');
        requestedComponents.push('REVENUE_MONTH');
      } else {
        requestedComponents.push(period === 'mes_atual' ? 'REVENUE_MONTH' : 'REVENUE_DAY');
      }
    } else if (res.intent === 'list_os') {
      requestedComponents.push(res.osId ? 'OS_DETAIL' : 'OS_LIST');
    } else if (res.intent === 'store_cmv') {
      requestedComponents.push('STORE_CMV');
    } else if (res.intent === 'aging_cars') {
      requestedComponents.push('YARD_AGING');
    } else if (res.intent === 'runtime_diagnostics') {
      requestedComponents.push('RUNTIME_DIAGNOSTICS');
    } else if (res.intent === 'conversation_history') {
      requestedComponents.push('CONVERSATION_HISTORY');
    } else if (res.intent === 'memory_preference') {
      requestedComponents.push('MEMORY_PREFERENCE');
    }
  }

  // Garantir deduplicação mantendo a ordem estável
  const uniqueComponents = Array.from(new Set(requestedComponents));

  // 3. Status de execução de componentes
  const componentStatuses: ComponentExecutionStatus[] = uniqueComponents.map(c => {
    let sourceTable = 'ordens_servico';
    let status: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE' | 'DENIED_SCOPE' = 'AVAILABLE';
    let unavailabilityReason: string | undefined;

    if (c === 'REVENUE_DAY') {
      sourceTable = 'faturamento_diario_horario';
    } else if (c === 'REVENUE_MONTH' || c === 'METAS_SUMMARY') {
      sourceTable = 'metas_diarias';
    } else if (c === 'STORE_CMV') {
      sourceTable = 'cmv_lojas';
      if (period === 'hoje' && norm.includes('hoje')) {
        status = 'UNAVAILABLE';
        unavailabilityReason = 'Posição de CMV de hoje ainda não consolidada no sistema.';
      }
    } else if (c === 'RUNTIME_DIAGNOSTICS' || c === 'MEMORY_PREFERENCE') {
      sourceTable = 'hydra_memories';
    } else if (c === 'CONVERSATION_HISTORY') {
      sourceTable = 'hydra_turns';
    }

    return {
      component: c,
      status,
      sourceTable,
      unavailabilityReason
    };
  });

  const isCompound = uniqueComponents.length > 1;
  let topic = res.intent as string;
  if (isCompound) {
    topic = `compound_${uniqueComponents.map(c => c.toLowerCase()).join('_')}`;
  } else if (uniqueComponents.length === 1) {
    topic = uniqueComponents[0].toLowerCase();
  }

  const effectivePersona: 'socio' | 'gerente' = res.scope === 'network' ? 'socio' : (res.lojaSlug ? 'gerente' : 'socio');
  const allowedLojaSlug = res.lojaSlug || previousState?.lojaSlug || null;
  const hasAmbiguity = Boolean(res.needsClarification);
  const clarificationPrompt = res.clarificationMessage;

  return {
    turnId: res.turnId,
    canonicalIntent: res.intent,
    primaryIntent: res.intent,
    topic,
    effectivePersona,
    allowedLojaSlug,
    lojaSlug: allowedLojaSlug,
    entityType: allowedLojaSlug ? 'store' : (res.osId ? 'order' : 'none'),
    period,
    periodDates,
    selectedEntityId: res.osId || res.placa,
    requestedComponents: uniqueComponents,
    componentStatuses,
    isCompoundQuery: isCompound,
    hasAmbiguity,
    clarificationPrompt
  } as any;
}

/**
 * Detecta se a mensagem indaga especificamente sobre presença física de veículos na oficina / pátio.
 */
export function isPhysicalYardPresenceQuery(text: string): boolean {
  const norm = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Se pergunta sobre tempo ou dias de pátio (aging cars), não é pergunta de presença física pura
  if (/\b(mais de|ha mais|parado ha|travado ha|\d+\s*dias)\b/i.test(norm)) {
    return false;
  }

  const mentionsPhysicalOrPresence = /\b(fisicamente|presenca|presenca fisica|quem esta|quais estao|quantos estao|estao la|estao no patio|carros no patio|veiculos no patio|tem no patio)\b/i.test(norm);
  const mentionsYard = /\b(patio|oficina)\b/i.test(norm);

  return mentionsPhysicalOrPresence && mentionsYard;
}

export function getPhysicalYardDisclaimer(): string {
  return NO_PHYSICAL_YARD_DISCLAIMER;
}

/**
 * Garante a criação da tabela hydra_query_gaps no SQLite.
 */
export function ensureQueryGapsTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_query_gaps (
        gap_key TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        sanitized_example TEXT NOT NULL,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        occurrence_count INTEGER DEFAULT 1,
        status TEXT DEFAULT 'NEW'
      );
      CREATE INDEX IF NOT EXISTS idx_query_gaps_category ON hydra_query_gaps(category);
      CREATE INDEX IF NOT EXISTS idx_query_gaps_status ON hydra_query_gaps(status);
    `);
  } catch (err: any) {
    console.error('[QUERY_GAPS] Erro ao criar tabela hydra_query_gaps:', err?.message || err);
  }
}

/**
 * Sanitiza dados pessoais (placas, CPFs, telefones, números de OS, valores monetários).
 */
export function sanitizeQueryText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\b[A-Za-z]{3}-?[0-9][A-Za-z0-9][0-9]{2}\b/g, '[PLACA]')
    .replace(/\b[A-Za-z]{3}-[0-9]{4}\b/g, '[PLACA]')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/g, '[TELEFONE]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/\b(?:os\s*#?|ordem\s*#?)?\d{3,7}\b/gi, '[NUM_OS]')
    .replace(/R\$\s*[\d.,]+/gi, '[VALOR]')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gera hash SHA-256 de deduplicação a partir da pergunta sanitizada e normalizada.
 */
export function computeGapKey(sanitizedText: string, category: string): string {
  const norm = (sanitizedText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return createHash('sha256').update(`${category}:${norm}`).digest('hex');
}

/**
 * Registra ou incrementa ocorrência de lacuna operacional no hydra_query_gaps.
 */
export function recordQueryGap(
  db: Database.Database,
  gap: {
    category: 'UNSUPPORTED_FIELD' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';
    rawText: string;
    sanitizedExample?: string;
    status?: 'NEW' | 'UNDER_REVIEW' | 'PLANNED' | 'WONT_FIX';
  }
): GapRecord {
  ensureQueryGapsTable(db);
  const sanitized = gap.sanitizedExample || sanitizeQueryText(gap.rawText);
  const gapKey = computeGapKey(sanitized, gap.category);
  const nowIso = new Date().toISOString();
  const status = gap.status || 'NEW';

  try {
    const existing = db.prepare(`
      SELECT gap_key, category, sanitized_example, first_seen_at, last_seen_at, occurrence_count, status
      FROM hydra_query_gaps
      WHERE gap_key = ?
    `).get(gapKey) as any;

    if (existing) {
      const newCount = Number(existing.occurrence_count) + 1;
      db.prepare(`
        UPDATE hydra_query_gaps
        SET occurrence_count = ?, last_seen_at = ?, sanitized_example = ?
        WHERE gap_key = ?
      `).run(newCount, nowIso, sanitized, gapKey);

      return {
        gapKey,
        category: existing.category,
        sanitizedExample: sanitized,
        firstSeenAt: existing.first_seen_at,
        lastSeenAt: nowIso,
        occurrenceCount: newCount,
        status: existing.status
      };
    } else {
      db.prepare(`
        INSERT INTO hydra_query_gaps (
          gap_key, category, sanitized_example, first_seen_at, last_seen_at, occurrence_count, status
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(gapKey, gap.category, sanitized, nowIso, nowIso, status);

      return {
        gapKey,
        category: gap.category,
        sanitizedExample: sanitized,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        occurrenceCount: 1,
        status
      };
    }
  } catch (err: any) {
    console.error('[QUERY_GAPS] Erro ao registrar lacuna:', err?.message || err);
    return {
      gapKey,
      category: gap.category,
      sanitizedExample: sanitized,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      occurrenceCount: 1,
      status
    };
  }
}

/**
 * Decompõe um pedido de operador em QueryPlan estruturado com QueryComponent[].
 * Suporta pedidos compostos (ex: Faturamento e OS de hoje) mapeando para capacidades oficiais.
 */
export function decomposeIntoQueryPlan(options: {
  text: string;
  phone?: string;
  turnId?: string;
  effectivePersona?: 'socio' | 'gerente';
  activeLojaSlug?: string | null;
  previousState?: TurnState | ExtendedTurnState | null;
  db?: Database.Database;
}): QueryPlan {
  const { text, phone = '', turnId = `plan_${Date.now()}`, effectivePersona = 'gerente', activeLojaSlug = null, previousState, db } = options;
  const norm = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const components: QueryComponent[] = [];
  let nextPriority = 1;

  let targetLoja = activeLojaSlug || previousState?.lojaSlug || null;
  for (const [alias, slug] of Object.entries(STORE_ALIASES)) {
    if (norm.includes(alias)) {
      targetLoja = slug;
      break;
    }
  }

  const mentionsDailyRevenue = (
    /\b(faturamento|vendas|quanto vendeu|receita)\b/i.test(norm) &&
    /\b(hoje|do dia|no dia|diario)\b/i.test(norm)
  ) || (
    norm.includes('faturamento') && !norm.includes('mes') && !norm.includes('meta')
  );

  const mentionsMonthlyRevenue = (
    /\b(faturamento|meta|metas)\b/i.test(norm) &&
    /\b(mes|do mes|no mes|acumulado)\b/i.test(norm)
  ) || (
    norm.includes('meta') || norm.includes('metas')
  );

  const mentionsCMV = /\b(cmv|custo de mercadoria|custo total|margem)\b/i.test(norm);

  const osIdMatch = norm.match(/\b(?:os|ordem)\s*#?(\d{3,6})\b/i) || norm.match(/\b(\d{3,6})\b/);
  const asksDetail = /\b(detalhe|detalhes|ficha|situacao da os|pecas da os)\b/i.test(norm);
  const isOSDetail = Boolean(osIdMatch && (asksDetail || norm.includes('os') || norm.includes('ordem')));

  const mentions30Days = /\b(30\s*dias|trinta\s*dias|ultimos\s*30\s*dias|ultimos\s*trinta\s*dias|ultimo\s*mes)\b/i.test(norm);
  const mentionsOS = /\b(os|oss|ordem|ordens|carros|veiculos)\b/i.test(norm);
  const isOSList = (mentionsOS || mentions30Days) && !isOSDetail;

  const mentionsUnsupported = /\b(estoque|pneu|pneus|demitir|demissao|contratar|cotacao|comprar peca)\b/i.test(norm);

  type DetectedTopic = {
    cap: string;
    pos: number;
    builder: () => QueryComponent;
  };
  const candidates: DetectedTopic[] = [];

  if (isOSDetail && osIdMatch) {
    const pos = norm.indexOf(osIdMatch[0]);
    candidates.push({
      cap: 'CAP-OS-DETAIL',
      pos,
      builder: () => ({
        componentId: `comp_${nextPriority++}_os_detail`,
        capabilityId: 'CAP-OS-DETAIL',
        priority: 0,
        params: {
          lojaSlug: targetLoja,
          osId: osIdMatch[1]
        },
        status: 'PENDING'
      })
    });
  } else if (isOSList) {
    const idxOS = norm.search(/\b(os|oss|ordem|ordens|30\s*dias)\b/i);
    candidates.push({
      cap: 'CAP-OS-LIST',
      pos: idxOS >= 0 ? idxOS : 999,
      builder: () => {
        if (mentions30Days) {
          const range = getCivilDateRange30Days();
          return {
            componentId: `comp_${nextPriority++}_os_list_30d`,
            capabilityId: 'CAP-OS-LIST',
            priority: 0,
            params: {
              lojaSlug: targetLoja,
              periodo: 'ultimos_30_dias',
              startDateIso: range.startDateIso,
              endDateIso: range.endDateIso,
              startDDMM: range.startDDMM,
              endDDMM: range.endDDMM,
              includeClosed: true,
              estadoOperacional: 'TODOS',
              declaration: range.declaration
            },
            status: 'PENDING'
          };
        }
        return {
          componentId: `comp_${nextPriority++}_os_list`,
          capabilityId: 'CAP-OS-LIST',
          priority: 0,
          params: {
            lojaSlug: targetLoja,
            onlyOpen: true,
            estadoOperacional: 'ABERTA'
          },
          status: 'PENDING'
        };
      }
    });
  }

  if (mentionsCMV) {
    const idxCMV = norm.search(/\b(cmv|custo|margem)\b/i);
    candidates.push({
      cap: 'CAP-CMV-STORE',
      pos: idxCMV >= 0 ? idxCMV : 999,
      builder: () => ({
        componentId: `comp_${nextPriority++}_cmv_store`,
        capabilityId: 'CAP-CMV-STORE',
        priority: 0,
        params: {
          lojaSlug: targetLoja
        },
        status: 'PENDING'
      })
    });
  }

  if (mentionsDailyRevenue) {
    const idxDaily = norm.search(/\b(faturamento|vendas|receita)\b/i);
    candidates.push({
      cap: 'CAP-REVENUE-DAY',
      pos: idxDaily >= 0 ? idxDaily : 999,
      builder: () => ({
        componentId: `comp_${nextPriority++}_revenue_day`,
        capabilityId: 'CAP-REVENUE-DAY',
        priority: 0,
        params: {
          lojaSlug: targetLoja,
          dataReferencia: 'hoje'
        },
        status: 'PENDING'
      })
    });
  } else if (mentionsMonthlyRevenue) {
    const idxMonthly = norm.search(/\b(meta|metas|mes)\b/i);
    candidates.push({
      cap: 'CAP-REVENUE-MONTH',
      pos: idxMonthly >= 0 ? idxMonthly : 999,
      builder: () => ({
        componentId: `comp_${nextPriority++}_revenue_month`,
        capabilityId: 'CAP-REVENUE-MONTH',
        priority: 0,
        params: {
          lojaSlug: targetLoja,
          dataReferencia: 'mes_atual'
        },
        status: 'PENDING'
      })
    });
  }

  if (mentionsUnsupported) {
    const idxUnsup = norm.search(/\b(estoque|pneu|demitir|demissao|contratar)\b/i);
    candidates.push({
      cap: 'UNSUPPORTED',
      pos: idxUnsup >= 0 ? idxUnsup : 999,
      builder: () => {
        if (db) {
          recordQueryGap(db, {
            category: 'UNSUPPORTED_FIELD',
            rawText: text
          });
        }
        return {
          componentId: `comp_${nextPriority++}_unsupported`,
          capabilityId: 'UNSUPPORTED',
          priority: 0,
          params: { rawQuery: text },
          status: 'UNSUPPORTED',
          errorMessage: 'Campo ou capacidade não suportada pelo sistema operacional.'
        };
      }
    });
  }

  candidates.sort((a, b) => a.pos - b.pos);

  let pCounter = 1;
  for (const cand of candidates) {
    const comp = cand.builder();
    comp.priority = pCounter++;
    components.push(comp);
  }

  if (components.length === 0) {
    components.push({
      componentId: `comp_1_overview`,
      capabilityId: 'CAP-REVENUE-DAY',
      priority: 1,
      params: { lojaSlug: targetLoja, dataReferencia: 'hoje' },
      status: 'PENDING'
    });
  }

  return {
    planId: `plan_${Date.now()}`,
    turnId,
    phone,
    effectivePersona,
    activeLojaSlug: targetLoja,
    components
  };
}

export const STORE_ALIASES: Record<string, string> = {
  // Santo André
  'santo andre': 'MPSantoAndre',
  'santoandre': 'MPSantoAndre',
  'sto andre': 'MPSantoAndre',
  'sto andré': 'MPSantoAndre',
  'santo andré': 'MPSantoAndre',
  's. andre': 'MPSantoAndre',
  's. andré': 'MPSantoAndre',
  'sa': 'MPSantoAndre',

  // Dom Pedro
  'dom pedro': 'MPdompedro1',
  'dompedro': 'MPdompedro1',
  'dom pedro 1': 'MPdompedro1',
  'dompedro1': 'MPdompedro1',
  'd pedro': 'MPdompedro1',
  'dp': 'MPdompedro1',

  // Jabaquara
  'jabaquara': 'MPJabaquara',
  'jaba': 'MPJabaquara',
  'jbq': 'MPJabaquara',

  // Rudge Ramos
  'rudge': 'MPrudge',
  'rudge ramos': 'MPrudge',
  'ramos': 'MPrudge',
  'rr': 'MPrudge',

  // Piraporinha
  'piraporinha': 'MPpiraporinha',
  'pirapora': 'MPpiraporinha',
  'pira': 'MPpiraporinha',

  // Kennedy
  'kennedy': 'MPkennedy',
  'kenedy': 'MPkennedy',
  'pres kennedy': 'MPkennedy',
  'presidente kennedy': 'MPkennedy',

  // Mauá
  'maua': 'ReiDoOleoMaua',
  'mauá': 'ReiDoOleoMaua',
  'rei do oleo': 'ReiDoOleoMaua',
  'rei do óleo': 'ReiDoOleoMaua',
  'rei do oleo maua': 'ReiDoOleoMaua',
  'rei do óleo mauá': 'ReiDoOleoMaua',
  'ro maua': 'ReiDoOleoMaua',

  // Planalto
  'planalto': 'MPplanalto',
  'sao bernardo planalto': 'MPplanalto',

  // Rei do Módulo
  'modulo': 'ReiDoModulo',
  'módulo': 'ReiDoModulo',
  'rei do modulo': 'ReiDoModulo',
  'rei do módulo': 'ReiDoModulo',
  'rm': 'ReiDoModulo',

  // Jorge Beretta
  'beretta': 'MPJorgeBeretta',
  'jorge beretta': 'MPJorgeBeretta',
  'jb': 'MPJorgeBeretta',

  // Master
  'master': 'MPMaster',
  'loja master': 'MPMaster'
};

export const STORE_PRETTY_NAMES: Record<string, { name: string; prep: string }> = {
  'MPdompedro1': { name: 'Dom Pedro', prep: 'da' },
  'MPrudge': { name: 'Rudge Ramos', prep: 'do' },
  'MPpiraporinha': { name: 'Piraporinha', prep: 'de' },
  'MPJabaquara': { name: 'Jabaquara', prep: 'do' },
  'MPSantoAndre': { name: 'Santo André', prep: 'de' },
  'MPkennedy': { name: 'Kennedy', prep: 'da' },
  'ReiDoOleoMaua': { name: 'Mauá', prep: 'de' },
  'MPplanalto': { name: 'Planalto', prep: 'do' },
  'ReiDoModulo': { name: 'Rei do Módulo', prep: 'do' },
  'MPJorgeBeretta': { name: 'Jorge Beretta', prep: 'da' },
  'MPMaster': { name: 'Master', prep: 'da' }
};

export function normalizarTexto(txt: string): string {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Formata nome da loja com preposição adequada em português.
 * Se nenhuma loja for especificada, retorna string vazia.
 */
export function formatarNomeLojaComPreposicao(lojaSlug?: string): string {
  if (!lojaSlug) return '';
  const clean = lojaSlug.trim();
  const lower = clean.toLowerCase();
  if (lower === 'loja' || lower === 'lojas' || lower === 'rede' || lower === 'todas' || lower === 'null' || lower === 'undefined') {
    return '';
  }
  const meta = STORE_PRETTY_NAMES[clean];
  if (!meta) {
    if (CATALOGO_10_LOJAS.includes(clean)) {
      return `da unidade ${clean}`;
    }
    return '';
  }
  return `${meta.prep} ${meta.name}`;
}

export function comporTextoLoja(lojaSlug?: string, prefixoEspaco = true): string {
  const prep = formatarNomeLojaComPreposicao(lojaSlug);
  if (!prep) return '';
  return prefixoEspaco ? ` ${prep}` : prep;
}

/**
 * Resolução de Loja com detecção de ambiguidades reais
 */
export function resolverLojaComAmbiguidades(norm: string): {
  loja?: ResolvedStore;
  ambiguidade?: AmbiguityResolution;
} {
  // 1. Detecção de ambiguidades reais conhecidas
  // Caso "rei" solto sem módulo nem óleo
  if (/\brei\b/.test(norm) && !norm.includes('modulo') && !norm.includes('oleo')) {
    return {
      ambiguidade: {
        isAmbiguous: true,
        clarificationQuestion: 'Você gostaria de consultar o Rei do Módulo ou o Rei do Óleo Mauá?',
        candidates: ['ReiDoModulo', 'ReiDoOleoMaua'],
        reason: 'Termo "rei" corresponde a duas unidades distintas.'
      }
    };
  }

  // Caso "sao bernardo" ou "sbc" solto sem especificar unidade
  if (/\b(sao bernardo|sbc)\b/.test(norm) && !norm.includes('planalto') && !norm.includes('rudge') && !norm.includes('kennedy')) {
    return {
      ambiguidade: {
        isAmbiguous: true,
        clarificationQuestion: 'Em São Bernardo temos as unidades Rudge Ramos, Planalto e Kennedy. Qual delas você gostaria de consultar?',
        candidates: ['MPrudge', 'MPplanalto', 'MPkennedy'],
        reason: 'São Bernardo possui múltiplas lojas da rede.'
      }
    };
  }

  // 2. Extração ordenada por comprimento decrescente de alias
  const aliasesSorted = Object.keys(STORE_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliasesSorted) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(norm)) {
      const slug = STORE_ALIASES[alias];
      const pretty = STORE_PRETTY_NAMES[slug];
      return {
        loja: {
          raw: alias,
          slug,
          name: pretty ? pretty.name : slug,
          prep: pretty ? pretty.prep : 'de',
          confidence: 1.0
        }
      };
    }
  }

  return {};
}

/**
 * Extrai loja explicitamente mencionada no texto (wrapper compatível).
 */
export function extrairLojaExplicitamente(norm: string): string | undefined {
  const res = resolverLojaComAmbiguidades(norm);
  return res.loja?.slug;
}

/**
 * Extrai placa de veículo (padrão antigo ABC-1234 ou padrão Mercosul ABC1D23).
 */
export function extrairPlacaExplicitamente(texto: string): string | undefined {
  const match = texto.match(/\b([a-zA-Z]{3}[0-9][a-zA-Z0-9][0-9]{2})\b/i) ||
                texto.match(/\b([a-zA-Z]{3}-[0-9]{4})\b/i);
  return match ? match[1].replace('-', '').toUpperCase() : undefined;
}

/**
 * Extrai número de Ordem de Serviço (3 a 6 dígitos).
 */
export function extrairOSIdExplicitamente(texto: string, norm: string): string | undefined {
  const matchComPrefixo = texto.match(/\b(?:os|ordem|os#|os\s*#)\s*([0-9]{3,6})\b/i);
  if (matchComPrefixo) return matchComPrefixo[1];

  if (!norm.includes('dias') && !norm.includes('ano') && !norm.includes('r$') && !norm.includes('reais') && !norm.includes('hora')) {
    const matchNumeroSolto = texto.match(/\b([0-9]{3,6})\b/);
    if (matchNumeroSolto) return matchNumeroSolto[1];
  }

  return undefined;
}

/**
 * Verifica se a pergunta está manifestamente fora do escopo operacional da rede
 */
function verificarForaDeEscopo(norm: string): { fora: boolean; motivo?: string } {
  // Se for "receita" no sentido financeiro (receita da loja, receita bruta, receita do dia/mês), NÃO é culinária!
  const isReceitaFinanceira = norm.includes('receita') && 
    (norm.includes('loja') || norm.includes('oficina') || norm.includes('rede') || norm.includes('bruta') || norm.includes('mes') || norm.includes('dia') || norm.includes('hoje') || norm.includes('fatur') || norm.includes('quanto') || norm.includes('qual'));
  if (isReceitaFinanceira) {
    return { fora: false };
  }

  const temasFora = [
    { termos: ['receita de bolo', 'receita culinaria', 'fazer bolo', 'bolo', 'brigadeiro', 'cozinhar'], motivo: 'Culinária' },
    { termos: ['jogo do', 'corinthians', 'palmeiras', 'flamengo', 'futebol', 'campeonato', 'brasileirao'], motivo: 'Esportes' },
    { termos: ['previsao do tempo', 'temperatura', 'vai chover'], motivo: 'Clima' },
    { termos: ['calculadora em python', 'programar em', 'codigo python', 'javascript'], motivo: 'Programação de software' },
    { termos: ['conte uma piada', 'me conte uma piada'], motivo: 'Entretenimento' }
  ];

  for (const tema of temasFora) {
    if (tema.termos.some(t => norm.includes(t))) {
      return { fora: true, motivo: tema.motivo };
    }
  }

  return { fora: false };
}

/**
 * Verifica se a solicitação exige capacidades administrativas não suportadas
 */
function verificarCapacidadeIndisponivel(rawText: string, norm: string): { indisponivel: boolean; motivo?: string; mensagem?: string } {
  const temUrl = /https?:\/\/[^\s]+/i.test(rawText) || norm.includes('chat.tork.services');
  const pedeTicketExterno = (norm.includes('ticket') || norm.includes('chamado')) && (norm.includes('externo') || norm.includes('chatwoot') || norm.includes('tork.services')) && /\b(ver|olhar|acessar|abrir)\b/i.test(norm) && !norm.includes('nao e') && !norm.includes('nao estou');
  if (temUrl || pedeTicketExterno) {
    return {
      indisponivel: true,
      motivo: 'Visualização de links externos e conversas diretas do Chatwoot',
      mensagem: 'Não tenho acesso à leitura de links externos ou histórico direto do Chatwoot. Por favor, me informe a placa do veículo, o número da OS ou a oficina que você deseja consultar.'
    };
  }

  const capacidades = [
    { termos: ['emitir nota', 'emitir nf', 'gerar nota fiscal'], motivo: 'Emiss?o fiscal direta n?o suportada via bot' },
    { termos: ['demitir', 'contratar funcionario', 'admitir'], motivo: 'Gest?o de RH restrita' },
    { termos: ['comprar peca', 'fazer pedido no fornecedor'], motivo: 'Compras externas devem ser realizadas pelo sistema web' }
  ];

  for (const cap of capacidades) {
    if (cap.termos.some(t => norm.includes(t))) {
      return { indisponivel: true, motivo: cap.motivo };
    }
  }

  return { indisponivel: false };
}

/**
 * Extrai modelo de ve?culo comum no p?tio para consultas de tempo de perman?ncia
 */
export function extrairVeiculoExplicitamente(texto: string, norm: string): string | undefined {
  const MODELOS = [
    'fiesta', 'civic', 'idea', 'ideia', 'corolla', 'gol', 'palio', 'uno', 'onix', 'hb20',
    'fox', 'celta', 'sandero', 'duster', 'renegade', 'compass', 'ka', 'cruze',
    'fit', 'city', 'ecosport', 'prisma', 'voyage', 'siena', 'toro', 'creta',
    'tracker', 'kicks', 'argo', 'mobi', 'clio', 'strada', 'saveiro',
    'linea', 'punto', 'bravo', 'stilo', 'marea', 'tempra', 'cronos', 'pulse', 'fastback',
    'spin', 'cobalt', 'corsa', 'montana', 'astra', 'vectra', 'meriva', 'zafira',
    'polo', 'virtus', 'nivus', 't-cross', 'tcross', 'taos', 'jetta',
    'etios', 'yaris', 'hilux', 'sw4', 'rav4',
    'kwid', 'captur', 'logan', 'stepway'
  ];

  const words = (norm || '').toLowerCase().split(/[^a-z0-9]+/);
  for (const mod of MODELOS) {
    if (words.includes(mod)) {
      return mod.charAt(0).toUpperCase() + mod.slice(1);
    }
  }

  const matchCarro = norm.match(/(?:o|carro|veiculo)\s+([a-z0-9]{3,15})\s+(?:ta|esta|ficou|parado)/i);
  if (matchCarro && !['dia', 'tempo', 'patio', 'loja', 'que', 'qual', 'mais', 'menos'].includes(matchCarro[1])) {
    return matchCarro[1].charAt(0).toUpperCase() + matchCarro[1].slice(1);
  }

  const matchCaso = norm.match(/(?:caso\s+do|sobre\s+o)\s+([a-z0-9]{3,15})\b/i);
  if (matchCaso && !['dia', 'tempo', 'patio', 'loja', 'que', 'qual', 'mais', 'menos', 'cliente', 'servico'].includes(matchCaso[1])) {
    return matchCaso[1].charAt(0).toUpperCase() + matchCaso[1].slice(1);
  }

  return undefined;
}

/**
 * Motor Principal de Interpretação Semântica e Reescrita de Intenção do Hydra.
 */

function finalizeCanonicalIntent(
  res: CanonicalIntent,
  rawText?: string,
  previousState?: TurnState | ExtendedTurnState | null
): CanonicalIntent {
  if (!res.queryPlan) {
    res.queryPlan = decomposeIntoQueryPlan({
      text: rawText || res.canonicalQuestion || '',
      turnId: res.turnId,
      activeLojaSlug: res.lojaSlug || null
    });
  }

  if (!res.compactDecision) {
    res.compactDecision = buildCompactSemanticDecision(res, rawText || res.canonicalQuestion || '', previousState);
  }

  if (res.interpretation && res.answerRequirements) {
    if (res.contract) {
      res.contract.interpretation = res.interpretation;
      res.contract.answerRequirements = res.answerRequirements;
      if (res.contract.plan) {
        res.contract.plan.answerRequirements = res.answerRequirements;
        if (res.targetArea) res.contract.plan.targetArea = res.targetArea;
      }
    }
    return res;
  }

  const intents: IntentType[] = res.intents || [res.intent];
  let metric = 'general';
  let table = 'ordens_servico';
  if (res.intent === 'list_os' || res.intent === 'os_detail') {
    metric = 'list_os';
    table = 'ordens_servico';
  } else if (res.intent === 'store_cmv') {
    metric = 'cmv_percentual';
    table = res.targetArea ? 'faturamento_areas' : 'cmv_lojas';
  } else if (res.intent === 'financial_alerts') {
    metric = res.subIntent === 'goal_gap' ? 'goal_gap' : 'faturamento';
    table = 'metas_diarias';
  } else if (res.intent === 'store_areas') {
    metric = 'faturamento_area';
    table = 'faturamento_areas';
  } else if (res.intent === 'media_survey') {
    metric = 'pesquisa_midia';
    table = 'pesquisa_midia';
  } else if (res.intent === 'checklist_audit') {
    metric = 'checklist';
    table = 'ordens_servico';
  } else if (res.intent === 'aging_cars') {
    metric = 'dias_no_patio';
    table = 'ordens_servico';
  } else if (res.intent === 'runtime_diagnostics') {
    metric = 'runtime_diagnostics';
    table = 'hydra_memories';
  } else if (res.intent === 'conversation_history') {
    metric = 'conversation_history';
    table = 'hydra_turns';
  } else if (res.intent === 'memory_preference') {
    metric = 'memory_preference';
    table = 'hydra_memories';
  } else if (res.intent === 'conversation_correction') {
    metric = 'conversation_correction';
    table = 'hydra_turns';
  }

  const scope: QueryScope = res.scope || (res.lojaSlug ? 'store' : 'network');
  const answerRequirements: AnswerRequirement[] = [
    {
      id: `req_${res.turnId}_${res.intent}`,
      description: res.canonicalQuestion || 'Consulta operacional',
      targetMetric: metric,
      targetScope: scope === 'unspecified' ? 'network' : scope,
      targetLojaSlug: res.lojaSlug,
      targetArea: res.targetArea,
      fulfilled: false,
      sourceTable: table
    }
  ];

  const interpretation: InterpretationContract = {
    intents: intents as string[],
    metric,
    dimensions: res.lojaSlug ? ['loja'] : ['rede'],
    scope,
    period: 'mes_atual',
    filters: {
      onlyOpen: res.onlyOpen,
      noDeposit: res.noDeposit,
      serviceTerms: res.serviceTerms,
      subIntent: res.subIntent,
      focusWorst: res.focusWorst,
      scope: res.scope,
      area: res.targetArea
    },
    entities: res.contract?.entities || {},
    source: 'TEXT',
    confidence: 1.0,
    answerRequirements
  };

  res.intents = intents;
  res.interpretation = interpretation;
  res.answerRequirements = answerRequirements;

  if (res.contract) {
    res.contract.interpretation = interpretation;
    res.contract.answerRequirements = answerRequirements;
    if (res.contract.plan) {
      res.contract.plan.answerRequirements = answerRequirements;
      if (res.targetArea) res.contract.plan.targetArea = res.targetArea;
    }
  }

  if (!res.queryPlan) {
    res.queryPlan = decomposeIntoQueryPlan({
      text: res.canonicalQuestion || '',
      turnId: res.turnId,
      activeLojaSlug: res.lojaSlug || null
    });
  }

  if (!res.compactDecision) {
    res.compactDecision = buildCompactSemanticDecision(res, res.canonicalQuestion || '', undefined);
  }

  return res;
}

export interface RewriteIntentOptions {
  batch?: MessageBatchPayload;
  parts?: InboundPart[];
  mediaEvidence?: MediaEvidence[];
  securityScope?: {
    persona?: 'socio' | 'gerente';
    authorizedPhones?: readonly string[];
    userAuthorizedStore?: string;
  };
}

function _rewriteIntentCore(
  userText: string,
  previousState?: TurnState | ExtendedTurnState | null,
  options?: RewriteIntentOptions
): CanonicalIntent {
  const tId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const textoLimpo = (userText || '').trim();
  const norm = normalizarTexto(textoLimpo);

  const conversationKey = options?.batch?.conversationKey || previousState?.phone || 'default';
  const messageIds = options?.batch?.messageIds || (previousState?.lastMessageId ? [String(previousState.lastMessageId)] : [`msg_${Date.now()}`]);
  const originalTexts = options?.batch?.originalTexts || [textoLimpo];
  const parts = options?.parts || options?.batch?.parts;
  const mediaEvidence = options?.mediaEvidence || options?.batch?.mediaEvidence;

  // Verificação de Mídia Fora do Escopo
  if (mediaEvidence && mediaEvidence.some(ev => ev.isOutOfScope)) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      conversationKey,
      messageIds,
      originalTexts,
      parts,
      mediaEvidence,
      timestamp: new Date().toISOString(),
      decision: 'out_of_scope',
      operation: 'general_query',
      scope: 'unspecified',
      entities: {},
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: textoLimpo,
      explanation: 'Mídia identificada como fora do escopo operacional.',
      plan: {
        operation: 'general_query',
        entities: {},
        filters: {}
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: textoLimpo,
      intent: 'other',
      needsClarification: true,
      clarificationMessage: 'Sou o Hydra, assistente de inteligência operacional focado na gestão das oficinas Mecânica Popular. Posso te ajudar com ordens de serviço, pátio, faturamento, checklists e situação das lojas.',
      parts,
      mediaEvidence,
      contract
    };
  }

  // 1. Verificação de Fora do Escopo
  const foraEscopo = verificarForaDeEscopo(norm);
  if (foraEscopo.fora) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'out_of_scope',
      operation: 'general_query',
      entities: {},
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: textoLimpo,
      explanation: `Solicitação identificada como fora do escopo operacional (${foraEscopo.motivo}).`,
      plan: {
        operation: 'general_query',
        entities: {},
        filters: {}
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: textoLimpo,
      intent: 'other',
      needsClarification: true,
      clarificationMessage: 'Sou o Hydra, assistente de inteligência operacional focado na gestão das oficinas Mecânica Popular. Posso te ajudar com ordens de serviço, pátio, faturamento, checklists e situação das lojas.',
      contract
    };
  }

  // 2. Verificação de Capacidade Não Suportada
  const capIndisponivel = verificarCapacidadeIndisponivel(textoLimpo, norm);
  if (capIndisponivel.indisponivel) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'unsupported_capability',
      operation: 'general_query',
      entities: {},
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: textoLimpo,
      explanation: capIndisponivel.motivo,
      plan: {
        operation: 'general_query',
        entities: {},
        filters: {}
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: textoLimpo,
      intent: 'other',
      needsClarification: true,
      clarificationMessage: capIndisponivel.mensagem || `Essa funcionalidade (${capIndisponivel.motivo}) não pode ser executada automaticamente pelo WhatsApp. Por favor, acesse o sistema web da Oficina Inteligente.`,
      contract
    };
  }

    // 2.8. Correção Conversacional de Rumo (Operador aponta que a interpretação anterior foi incorreta)
  const isCorrection = isCorrectionMessage(norm);
  const strippedCorrectionQuery = norm.replace(CORRECTION_PREFIX_REGEX, '').trim();
  const substantiveCleanQuery = stripFillerWords(strippedCorrectionQuery);
  const hasSubstantiveRectifiedQuery = isCorrection && substantiveCleanQuery.length > 3 && !substantiveCleanQuery.startsWith('nao') && !substantiveCleanQuery.startsWith('nn');

  if (isCorrection && !norm.includes('obsidian') && !norm.includes('memoria') && !norm.includes('vault')) {
    if (!hasSubstantiveRectifiedQuery) {
      const canonicalQuestion = 'O operador corrigiu o rumo da conversa anterior. Reconheça a correção com cordialidade e retome o diálogo natural.';
      const pendingVehicle = (previousState as any)?.pendingRequest?.targetModel || (previousState as any)?.vehicleModel;
      const pendingLoja = (previousState as any)?.pendingRequest?.targetLojaSlug || previousState?.lojaSlug;
      const pendingPlate = (previousState as any)?.pendingRequest?.targetPlate || previousState?.placa;
      const pendingOsId = (previousState as any)?.pendingRequest?.targetOsId || previousState?.osId;

      const pendingRequest = createOrPreservePendingRequest({
        userPrompt: textoLimpo,
        operation: 'CONVERSATION_REPAIR',
        targetModel: pendingVehicle,
        targetLojaSlug: pendingLoja,
        targetPlate: pendingPlate,
        targetOsId: pendingOsId,
        deliveryStatus: 'MISUNDERSTOOD',
        previousPendingRequest: (previousState as any)?.pendingRequest
      });

      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'conversation_correction',
        entities: {
          veiculo: pendingVehicle,
          loja: pendingLoja ? {
            raw: pendingLoja,
            slug: pendingLoja,
            name: pendingLoja,
            prep: 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {},
        turnRelation: {
          type: 'new_query',
          inheritedFilters: [],
          overriddenFilters: [],
          removedFilters: ['lojaSlug', 'osId', 'placa']
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'conversation_correction',
          entities: {},
          filters: {}
        }
      };

      return finalizeCanonicalIntent({
        turnId: tId,
        canonicalQuestion,
        intent: 'conversation_correction',
        operation: 'CONVERSATION_REPAIR',
        operationType: 'CONVERSATION_REPAIR',
        veiculo: pendingVehicle,
        vehicleModel: pendingVehicle,
        lojaSlug: pendingLoja,
        placa: pendingPlate,
        osId: pendingOsId,
        pendingRequest,
        contract
      });
    }
  }

  // 2.9. Intenções Meta-Operacionais (Runtime Diagnostics, Conversation History, Memory Preference)

  // 2.9.1. Diagnóstico de Runtime, Obsidian Vault e Integridade da Memória
  const mentionsObsidian = norm.includes('obsidian') || norm.includes('vault');
  const mentionsMemoriaStatus =
    (norm.includes('memoria') || norm.includes('lembranca')) &&
    (norm.includes('status') || norm.includes('como ta') || norm.includes('como esta') || norm.includes('funcionando') || norm.includes('ativa') || norm.includes('ativo') || norm.includes('ta ok') || norm.includes('esta ok') || norm.includes('diagnostico') || norm.includes('integridade') || norm.includes('o que voce tem') || norm.includes('o que tem') || norm.includes('o que lembra') || norm.includes('funciona'));
  const mentionsBotStatus =
    (norm.includes('bot') || norm.includes('hydra') || norm.includes('sistema') || norm.includes('runtime')) &&
    (norm.includes('status') || norm.includes('diagnostico') || norm.includes('como ta') || norm.includes('como esta') || norm.includes('ta ativo') || norm.includes('esta ativo') || norm.includes('ta de pe') || norm.includes('saude') || norm.includes('health') || norm.includes('ta funcionando') || norm.includes('esta funcionando'));
  const isRuntimeDiagnostics =
    mentionsObsidian ||
    mentionsMemoriaStatus ||
    mentionsBotStatus ||
    norm === 'diagnostico' ||
    norm === 'status' ||
    norm === 'runtime' ||
    norm === 'healthcheck' ||
    norm.includes('diagnostico de runtime') ||
    norm.includes('status da memoria') ||
    norm.includes('status do sistema') ||
    norm.includes('diagnostico do sistema') ||
    (norm.includes('memoria') && (norm.includes('funcionando') || norm.includes('funciona')));

  if (isRuntimeDiagnostics) {
    const canonicalQuestion = 'Verificar status do Obsidian Vault, diagnóstico de runtime e integridade da memória.';
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'runtime_diagnostics',
      entities: {},
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'runtime_diagnostics',
        entities: {},
        filters: {}
      }
    };

    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'RUNTIME_DIAGNOSTICS',
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: 'runtime_diagnostics',
      operation: 'RUNTIME_DIAGNOSTICS',
      operationType: 'RUNTIME_DIAGNOSTICS',
      pendingRequest,
      contract
    });
  }

  // 2.9.2. Consulta a Histórico de Conversa e Turnos Anteriores
  const mentionsFirstQuestion =
    norm.includes('primeira pergunta') ||
    norm.includes('primeira coisa que perguntei') ||
    norm.includes('qual foi a 1 pergunta') ||
    norm.includes('qual foi a primeira') ||
    (norm.includes('primeira') && norm.includes('pergunt'));
  const isConversationHistory = isConversationHistoryStrict(norm);

  if (isConversationHistory) {
    const canonicalQuestion = mentionsFirstQuestion
      ? 'Consultar a primeira pergunta feita pelo operador na conversa.'
      : 'Consultar histórico recente e turnos da conversa do operador.';
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'conversation_history',
      entities: {},
      filters: {
        isFirstQuestionQuery: mentionsFirstQuestion
      },
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'conversation_history',
        entities: {},
        filters: {
          isFirstQuestionQuery: mentionsFirstQuestion
        }
      }
    };

    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'CONVERSATION_HISTORY',
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: 'conversation_history',
      operation: 'CONVERSATION_HISTORY',
      operationType: 'CONVERSATION_HISTORY',
      pendingRequest,
      contract
    });
  }

  // 2.9.3. Registro ou Atualização de Preferência Persistente de Memória
  const mentionsPrefiro =
    norm.startsWith('prefiro ') ||
    norm.includes(' prefiro ') ||
    norm.startsWith('minha preferencia') ||
    norm.includes('minha preferencia');
  const mentionsLembre =
    norm.startsWith('lembre-se ') ||
    norm.startsWith('lembre se ') ||
    norm.startsWith('lembre que ') ||
    norm.includes('lembre-se que ') ||
    norm.includes('lembre que ') ||
    norm.startsWith('guarde que ') ||
    norm.startsWith('grave que ') ||
    norm.startsWith('salve que ') ||
    norm.startsWith('registre que ') ||
    norm.includes('grave essa preferencia') ||
    norm.includes('guarde essa preferencia') ||
    norm.includes('salve essa preferencia');
  const isMemoryPreference = mentionsPrefiro || mentionsLembre;

  if (isMemoryPreference) {
    const canonicalQuestion = `Registrar preferência persistente do operador no Obsidian Vault: "${textoLimpo}".`;
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'memory_preference',
      entities: {},
      filters: {
        preferenceText: textoLimpo
      },
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'memory_preference',
        entities: {},
        filters: {
          preferenceText: textoLimpo
        }
      }
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: 'memory_preference',
      contract
    });
  }

  // 3. Resolução de Entidades Explícitas na Mensagem Atual
  const lojaResolution = resolverLojaComAmbiguidades(norm);

  // 3.1. Tratamento de Ambiguidade de Loja
  if (lojaResolution.ambiguidade?.isAmbiguous) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'clarify',
      operation: 'general_query',
      entities: {},
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: lojaResolution.ambiguidade,
      canonicalQuestion: textoLimpo,
      explanation: lojaResolution.ambiguidade.reason,
      plan: {
        operation: 'general_query',
        entities: {},
        filters: {}
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: textoLimpo,
      intent: 'other',
      needsClarification: true,
      clarificationMessage: lojaResolution.ambiguidade.clarificationQuestion,
      contract
    };
  }

  // Extração de candidatos multimodais (áudio/imagem/vídeo/documentos)
  let candidatePlacaFromMedia: string | undefined = undefined;
  let candidateOSFromMedia: string | undefined = undefined;
  if (mediaEvidence) {
    for (const ev of mediaEvidence) {
      if (!candidatePlacaFromMedia && ev.extractedPlates && ev.extractedPlates.length > 0) {
        candidatePlacaFromMedia = ev.extractedPlates[0];
      }
      if (!candidateOSFromMedia && ev.extractedOSs && ev.extractedOSs.length > 0) {
        candidateOSFromMedia = ev.extractedOSs[0];
      }
    }
  }

  // Detecção de correção explícita ("não, ...", "esquece, ...", "muda pra ...")
  const isCorrectionPrefix = /^(não,|nao,|esquece,|muda pra|troca pra)\s*/i.test(textoLimpo) || norm.startsWith('não ') || norm.startsWith('nao ');
  const correctionSplit = norm.split(/\b(?:nao,|não,|esquece,|muda pra|troca pra)\s*/i);

  // Resolução de correções para rede ("não, da rede" / "esquece, da rede")
  const hasNetworkCorrection = 
    norm.includes('nao, da rede') || 
    norm.includes('nao da rede') || 
    norm.includes('esquece, da rede') ||
    norm.includes('nao, rede') ||
    norm.endsWith('da rede') || 
    norm.endsWith('na rede');

  // Detecção de lojas negadas e lojas escolhidas na mensagem
  let negatedStoreSlug: string | undefined = undefined;
  let chosenStoreSlug: string | undefined = undefined;

  if (correctionSplit.length > 1) {
    const rejectedPart = correctionSplit[0];
    const correctivePart = correctionSplit.slice(1).join(' ');

    const rejectedRes = resolverLojaComAmbiguidades(rejectedPart);
    if (rejectedRes.loja) {
      negatedStoreSlug = rejectedRes.loja.slug;
    }

    const correctiveRes = resolverLojaComAmbiguidades(correctivePart);
    if (correctiveRes.loja) {
      chosenStoreSlug = correctiveRes.loja.slug;
    }
  }

  // Verifica negações diretas do tipo "não da Jorge", "esquece a Jorge", etc.
  for (const [alias, slug] of Object.entries(STORE_ALIASES)) {
    if (
      norm.includes(`nao da ${alias}`) ||
      norm.includes(`nao de ${alias}`) ||
      norm.includes(`nao do ${alias}`) ||
      norm.includes(`nao ${alias}`) ||
      norm.includes(`esquece ${alias}`) ||
      norm.includes(`esquece a ${alias}`) ||
      norm.includes(`esquece o ${alias}`)
    ) {
      negatedStoreSlug = slug;
    }
  }

  let explicitLoja: string | undefined = undefined;
  if (hasNetworkCorrection) {
    explicitLoja = undefined;
  } else if (chosenStoreSlug) {
    explicitLoja = chosenStoreSlug;
  } else if (lojaResolution.loja?.slug && lojaResolution.loja.slug !== negatedStoreSlug) {
    explicitLoja = lojaResolution.loja.slug;
  }

  if (explicitLoja && !CATALOGO_10_LOJAS.includes(explicitLoja) && explicitLoja !== 'MPMaster') {
    explicitLoja = undefined;
  }

  // Se o escopo anterior negado corresponder ao previousState.lojaSlug ou houver correção de rede, anula imediatamente
  const effectivePreviousLojaSlug = (negatedStoreSlug && previousState?.lojaSlug === negatedStoreSlug) || hasNetworkCorrection
    ? undefined
    : previousState?.lojaSlug;

  const explicitPlaca = extrairPlacaExplicitamente(textoLimpo) || candidatePlacaFromMedia;
  const explicitOSId = extrairOSIdExplicitamente(textoLimpo, norm) || candidateOSFromMedia;
  const explicitVeiculo = extrairVeiculoExplicitamente(textoLimpo, norm);

  // 4. Reconhecimento de Termos Semânticos de Negócio
  const mencionaAberta = norm.includes('aberta') || norm.includes('aberto') || norm.includes('patio') || norm.includes('sem sinal') || norm.includes('dessas');
  const mencionaSemSinal = norm.includes('sem sinal') || norm.includes('sem entrada') || norm.includes('sinal zero') || norm.includes('pagamento zero') || norm.includes('nao pagou');

  // Superlativos e Ordenação
  const pedeMaiorValor = norm.includes('maior') || norm.includes('mais cara') || norm.includes('mais alto') || norm.includes('top 1') || norm.includes('maior valor');
  const pedeMaiorSaldo = norm.includes('maior saldo') || norm.includes('maior divida') || norm.includes('maior pendencia');
  const pedeMaisAntiga = norm.includes('mais antiga') || norm.includes('mais velha') || norm.includes('mais tempo') || norm.includes('mais parada') || norm.includes('mais retid');
  const pedeMaisRecente = norm.includes('mais recente') || norm.includes('ultima') || norm.includes('mais nova');

  // Termos Anafóricos / Referência ao Turno Anterior ("dessas", "destas", "delas", "dessa loja", "dessas ordens")
  const isAnaphoraReference = /\b(dessas|destas|delas|desses|destes|dessas mesmas|dentre elas|dessas ordens|dessas os|desses veiculos|desses carros)\b/i.test(textoLimpo);
  const isStoreAnaphora = /\b(dela|dele|dessa loja|desta loja|daquela loja|nessa loja|nesta loja|da mesma|da unidade|na mesma|na unidade|dessa mesma loja|dessa unidade)\b/i.test(textoLimpo);
  const isAllStoresScope = /\b(das lojas|de todas as lojas|todas as lojas|todas lojas|loja por loja|de cada loja|por loja|todas as unidades|das unidades|ranking de cmv|ranking)\b/i.test(textoLimpo);
  const isNetworkScope = hasNetworkCorrection || /\b(da rede|na rede|geral|consolidado|consolidada|toda a rede|toda rede|na empresa)\b/i.test(textoLimpo);
  const isPiorStoreQuery = (norm.includes('pior') || norm.includes('critica') || norm.includes('critico')) && 
    (norm.includes('loja') || norm.includes('unidade') || (!norm.includes('area') && !norm.includes('setor') && (previousState?.lastIntent === 'store_cmv' || previousState?.lastContract?.operation === 'store_cmv' || previousState?.filters?.subIntent === 'worst_store' || previousState?.filters?.scope === 'network' || previousState?.filters?.scope === 'all_stores')));
  const isPiorAreaQuery = (norm.includes('area') || norm.includes('setor')) && (norm.includes('pior') || norm.includes('critica') || norm.includes('critico') || norm.includes('maior cmv') || norm.includes('mais critica'));
  const isElipsePrefix = norm.startsWith('e ') || norm.startsWith('e no ') || norm.startsWith('e na ') || norm.startsWith('e em ') || norm.startsWith('e a ') || norm.startsWith('e o ');

  // Continuidade de contexto de loja
  const isDeepening = norm.includes('quais') || norm.includes('quais sao') || norm.includes('quais estao') || norm.includes('lista') || norm.includes('mostrar');
  const isContinuation = isElipsePrefix || isStoreAnaphora || isAnaphoraReference || isDeepening || (previousState?.lojaSlug != null && (mencionaSemSinal || norm.includes('oss') || norm.includes('carros')));


  // 4.9.0. DECOMPOSIÇÃO DE FATURAMENTO + OS NO MESMO TURNO
  // Ex: "Faturamento e OS de hoje", "Qual o faturamento e as ordens abertas da Kennedy?"
  const hasCompoundSep = /\b(e|com|\+|além de|alem de|juntamente com|bem como|e também|e tambem)\b/i.test(norm);
  const mentionsOS = /\b(os|oss|ordem|ordens|ordem de servico|ordens de servico)\b/i.test(norm);
  const mentionsCMV = /\b(cmv|custo de mercadoria|custo de mercadorias|margem)\b/i.test(norm);
  const mentionsFaturamento = /\b(faturamento|vendas|quanto vendeu|receita)\b/i.test(norm);
  const detectedAreaForQuery = resolveSemanticArea(norm);

  if (!explicitPlaca && !explicitOSId && !explicitVeiculo && hasCompoundSep && mentionsOS && mentionsFaturamento) {
    const targetLoja = explicitLoja || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const idxOS = norm.search(/\b(os|oss|ordem|ordens)\b/i);
    const idxFat = norm.search(/\b(faturamento|vendas|quanto vendeu|receita)\b/i);
    const isOSFirst = idxOS <= idxFat;

    const intentOS: CanonicalIntent = {
      turnId: `${tId}_os`,
      canonicalQuestion: `Listar as OS abertas${lojaTexto}.`,
      intent: 'list_os',
      intents: ['list_os'],
      lojaSlug: targetLoja,
      onlyOpen: true,
      contract: {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: `${tId}_os`,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'list_os',
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { onlyOpen: true },
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: `Listar as OS abertas${lojaTexto}.`,
        plan: {
          operation: 'list_os',
          entities: { loja: lojaResolution.loja },
          filters: { onlyOpen: true },
          targetLojaSlug: targetLoja
        }
      }
    };

    const isMes = /\b(mes|do mes|no mes|mensal|meta|metas|acumulado)\b/i.test(norm) && !norm.includes('ultimos 30');
    const isOntem = /\b(ontem|d-1)\b/i.test(norm);
    const periodType: 'hoje' | 'ontem' | 'mes_atual' = isMes ? 'mes_atual' : (isOntem ? 'ontem' : 'hoje');
    const contractPeriodType: 'hoje' | 'mes_atual' | 'personalizado' = (periodType === 'ontem') ? 'personalizado' : periodType;
    const periodLabel = isMes ? 'Mês Atual' : (isOntem ? 'Ontem' : 'Hoje');
    const metricFat = isMes ? 'faturamento_mensal' : 'faturamento';
    const sourceTableFat = isMes ? 'metas_diarias' : 'faturamento_diario_horario';
    const fatQuestion = isMes
      ? `Consultar faturamento do mês${lojaTexto}.`
      : (isOntem ? `Consultar faturamento de ontem${lojaTexto}.` : `Consultar faturamento de hoje${lojaTexto}.`);

    const intentFat: CanonicalIntent = {
      turnId: `${tId}_fat`,
      canonicalQuestion: fatQuestion,
      intent: 'financial_alerts',
      intents: ['financial_alerts'],
      scope: targetLoja ? 'store' : 'network',
      lojaSlug: targetLoja,
      contract: {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: `${tId}_fat`,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'financial_alerts',
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { scope: targetLoja ? 'store' : 'network' },
        period: { type: contractPeriodType, label: periodLabel },
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: fatQuestion,
        plan: {
          operation: 'financial_alerts',
          scope: targetLoja ? 'store' : 'network',
          entities: { loja: lojaResolution.loja },
          filters: { scope: targetLoja ? 'store' : 'network' },
          period: { type: contractPeriodType, label: periodLabel },
          targetLojaSlug: targetLoja
        }
      }
    };

    const subQueries = isOSFirst ? [intentOS, intentFat] : [intentFat, intentOS];
    const orderedIntents: IntentType[] = isOSFirst ? ['list_os', 'financial_alerts'] : ['financial_alerts', 'list_os'];

    const reqOS: AnswerRequirement = {
      id: `req_${tId}_list_os`,
      description: `Listar as OS abertas${lojaTexto}`,
      targetMetric: 'list_os',
      targetScope: targetLoja ? 'store' : 'all_stores',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: 'ordens_servico'
    };

    const reqFat: AnswerRequirement = {
      id: `req_${tId}_revenue_component`,
      description: fatQuestion,
      targetMetric: metricFat,
      targetScope: targetLoja ? 'store' : 'network',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: sourceTableFat
    };

    const answerRequirements = isOSFirst ? [reqOS, reqFat] : [reqFat, reqOS];
    const primaryIntent = isOSFirst ? 'list_os' : 'financial_alerts';
    const canonicalQuestion = isOSFirst
      ? `Listar as OS abertas e ${fatQuestion.toLowerCase().replace('.', '')}${lojaTexto}.`
      : `${fatQuestion.replace('.', '')} e listar as OS abertas${lojaTexto}.`;

    const interpretation: InterpretationContract = {
      intents: orderedIntents as string[],
      metric: 'composite',
      dimensions: ['loja'],
      scope: targetLoja ? 'store' : 'network',
      period: periodType,
      filters: { onlyOpen: true },
      entities: { loja: lojaResolution.loja },
      source: 'TEXT',
      confidence: 1.0,
      answerRequirements
    };

    const compoundContract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: primaryIntent,
      scope: targetLoja ? 'store' : 'network',
      entities: { loja: lojaResolution.loja },
      filters: { onlyOpen: true },
      turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: 'Decomposição de intenções múltiplas no mesmo turno (Faturamento + OS).',
      plan: {
        operation: primaryIntent,
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { onlyOpen: true },
        targetLojaSlug: targetLoja,
        answerRequirements
      },
      interpretation,
      answerRequirements
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: primaryIntent,
      intents: orderedIntents,
      lojaSlug: targetLoja,
      onlyOpen: true,
      parts,
      mediaEvidence,
      contract: compoundContract,
      interpretation,
      answerRequirements,
      subQueries
    });
  }

  // 4.9.1. DECOMPOSIÇÃO DE FATURAMENTO + CMV NO MESMO TURNO (Cenários L04 / L05)
  // Ex: "Faturamento e CMV de hoje", "Qual o faturamento e o CMV da Dom Pedro?"
  if (!explicitPlaca && !explicitOSId && !explicitVeiculo && hasCompoundSep && mentionsFaturamento && mentionsCMV && !mentionsOS) {
    const targetLoja = explicitLoja || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const isMes = /\b(mes|do mes|no mes|mensal|meta|metas|acumulado)\b/i.test(norm) && !norm.includes('ultimos 30');
    const isOntem = /\b(ontem|d-1)\b/i.test(norm);
    const periodType: 'hoje' | 'ontem' | 'mes_atual' = isMes ? 'mes_atual' : (isOntem ? 'ontem' : 'hoje');
    const contractPeriodType: 'hoje' | 'mes_atual' | 'personalizado' = (periodType === 'ontem') ? 'personalizado' : periodType;
    const periodLabel = isMes ? 'Mês Atual' : (isOntem ? 'Ontem' : 'Hoje');

    const idxFat = norm.search(/\b(faturamento|vendas|quanto vendeu|receita)\b/i);
    const idxCMV = norm.search(/\b(cmv|custo|margem)\b/i);
    const isFatFirst = idxFat <= idxCMV;

    const fatQuestion = isMes
      ? `Consultar faturamento do mês${lojaTexto}.`
      : (isOntem ? `Consultar faturamento de ontem${lojaTexto}.` : `Consultar faturamento de hoje${lojaTexto}.`);

    const intentFat: CanonicalIntent = {
      turnId: `${tId}_fat`,
      canonicalQuestion: fatQuestion,
      intent: 'financial_alerts',
      intents: ['financial_alerts'],
      scope: targetLoja ? 'store' : 'network',
      lojaSlug: targetLoja,
      contract: {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: `${tId}_fat`,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'financial_alerts',
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { scope: targetLoja ? 'store' : 'network' },
        period: { type: contractPeriodType, label: periodLabel },
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: fatQuestion,
        plan: {
          operation: 'financial_alerts',
          scope: targetLoja ? 'store' : 'network',
          entities: { loja: lojaResolution.loja },
          filters: { scope: targetLoja ? 'store' : 'network' },
          period: { type: contractPeriodType, label: periodLabel },
          targetLojaSlug: targetLoja
        }
      }
    };

    const cmvQuestion = `Consultar CMV${lojaTexto}.`;
    const intentCMV: CanonicalIntent = {
      turnId: `${tId}_cmv`,
      canonicalQuestion: cmvQuestion,
      intent: 'store_cmv',
      intents: ['store_cmv'],
      lojaSlug: targetLoja,
      contract: {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: `${tId}_cmv`,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'store_cmv',
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: {},
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: cmvQuestion,
        plan: {
          operation: 'store_cmv',
          entities: { loja: lojaResolution.loja },
          filters: {},
          targetLojaSlug: targetLoja
        }
      }
    };

    const subQueries = isFatFirst ? [intentFat, intentCMV] : [intentCMV, intentFat];
    const orderedIntents: IntentType[] = isFatFirst ? ['financial_alerts', 'store_cmv'] : ['store_cmv', 'financial_alerts'];

    const reqFat: AnswerRequirement = {
      id: `req_${tId}_revenue_comp`,
      description: fatQuestion,
      targetMetric: isMes ? 'faturamento_mensal' : 'faturamento',
      targetScope: targetLoja ? 'store' : 'network',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: isMes ? 'metas_diarias' : 'faturamento_diario_horario'
    };

    const reqCMV: AnswerRequirement = {
      id: `req_${tId}_cmv_comp`,
      description: cmvQuestion,
      targetMetric: 'cmv',
      targetScope: targetLoja ? 'store' : 'all_stores',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: 'cmv_lojas'
    };

    const answerRequirements = isFatFirst ? [reqFat, reqCMV] : [reqCMV, reqFat];
    const primaryIntent = isFatFirst ? 'financial_alerts' : 'store_cmv';
    const canonicalQuestion = isFatFirst
      ? `${fatQuestion} e ${cmvQuestion}`
      : `${cmvQuestion} e ${fatQuestion}`;

    const interpretation: InterpretationContract = {
      intents: orderedIntents as string[],
      metric: 'composite',
      dimensions: ['loja'],
      scope: targetLoja ? 'store' : 'network',
      period: periodType,
      filters: {},
      entities: { loja: lojaResolution.loja },
      source: 'TEXT',
      confidence: 1.0,
      answerRequirements
    };

    const compoundContract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: primaryIntent,
      scope: targetLoja ? 'store' : 'network',
      entities: { loja: lojaResolution.loja },
      filters: {},
      turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: 'Decomposição de intenções múltiplas no mesmo turno (Faturamento + CMV).',
      plan: {
        operation: primaryIntent,
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: {},
        targetLojaSlug: targetLoja,
        answerRequirements
      },
      interpretation,
      answerRequirements
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: primaryIntent,
      intents: orderedIntents,
      lojaSlug: targetLoja,
      parts,
      mediaEvidence,
      contract: compoundContract,
      interpretation,
      answerRequirements,
      subQueries
    });
  }

  // 4.9.2. CONSULTA DE OS DOS ÚLTIMOS 30 DIAS (CAP-OS-LIST COM ORDENS ENCERRADAS)
  // Requisito E2-E1: Mapear para capacidade correspondente e compor balão com declaração obrigatória:
  // "Ordens abertas entre DD/MM e DD/MM (inclui as já encerradas)."
  const mentions30Dias = /\b(30\s*dias|trinta\s*dias|ultimos\s*30\s*dias|ultimos\s*trinta\s*dias|ultimo\s*mes)\b/i.test(norm);
  if (!explicitPlaca && !explicitOSId && !explicitVeiculo && mentionsOS && mentions30Dias) {
    const targetLoja = explicitLoja || (isContinuation ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);
    const dateRange = getCivilDateRange30Days();

    const canonicalQuestion = `Listar as OS dos últimos 30 dias${lojaTexto} (abertas entre ${dateRange.startDDMM} e ${dateRange.endDDMM}, incluindo as já encerradas).`;

    const reqOS30: AnswerRequirement = {
      id: `req_${tId}_os_30d`,
      description: `Listar as OS dos últimos 30 dias${lojaTexto}`,
      targetMetric: 'list_os',
      targetScope: targetLoja ? 'store' : 'all_stores',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: 'ordens_servico'
    };

    const interpretation: InterpretationContract = {
      intents: ['list_os'],
      metric: 'list_os',
      dimensions: ['loja'],
      scope: targetLoja ? 'store' : 'network',
      filters: {
        onlyOpen: false
      },
      period: {
        type: 'ultimos_30d',
        start: dateRange.startDateIso,
        end: dateRange.endDateIso,
        label: dateRange.declaration
      },
      entities: { loja: lojaResolution.loja },
      source: 'TEXT',
      confidence: 1.0,
      answerRequirements: [reqOS30]
    };

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      scope: targetLoja ? 'store' : 'network',
      entities: { loja: lojaResolution.loja },
      filters: {
        onlyOpen: false
      },
      period: {
        type: 'ultimos_30d',
        start: dateRange.startDateIso,
        end: dateRange.endDateIso,
        label: dateRange.declaration
      },
      turnRelation: {
        type: isContinuation ? 'continue' : 'new_query',
        inheritedFilters: isContinuation && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: dateRange.declaration,
      plan: {
        operation: 'list_os',
        entities: { loja: lojaResolution.loja },
        filters: {
          onlyOpen: false
        },
        period: {
          type: 'ultimos_30d',
          start: dateRange.startDateIso,
          end: dateRange.endDateIso,
          label: dateRange.declaration
        },
        targetLojaSlug: targetLoja,
        answerRequirements: [reqOS30]
      },
      interpretation,
      answerRequirements: [reqOS30]
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      intents: ['list_os'],
      lojaSlug: targetLoja,
      onlyOpen: false,
      declaration: dateRange.declaration,
      parts,
      mediaEvidence,
      contract,
      interpretation,
      answerRequirements: [reqOS30]
    });
  }

  // 4.9.3. CONSULTA DE PRESENÇA FÍSICA NO PÁTIO (E3-E1)
  // Requisito E3-E1: Resposta padrão obrigatória quando não houver evidência de presença física de veículo:
  // "Tenho a posição de OS abertas no sistema; ela não confirma quais veículos estão fisicamente no pátio."
  if (isPhysicalYardPresenceQuery(norm) && !norm.includes('faturamento') && !norm.includes('cmv') && !explicitOSId) {
    const targetLoja = explicitLoja || (isContinuation ? previousState?.lojaSlug : undefined);
    const lojaTexto = comporTextoLoja(targetLoja);
    const yardDisclaimer = NO_PHYSICAL_YARD_DISCLAIMER;

    const canonicalQuestion = `Consultar ordens abertas${lojaTexto} (ressalva: OS aberta não comprova presença física no pátio).`;

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      entities: { loja: lojaResolution.loja },
      filters: {
        onlyOpen: true
      },
      turnRelation: {
        type: isContinuation ? 'continue' : 'new_query',
        inheritedFilters: isContinuation && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: yardDisclaimer,
      plan: {
        operation: 'list_os',
        entities: { loja: lojaResolution.loja },
        filters: { onlyOpen: true },
        targetLojaSlug: targetLoja
      }
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: targetLoja,
      onlyOpen: true,
      lacksPhysicalYardEvidence: true,
      declaration: yardDisclaimer,
      contract
    });
  }

  // 4.9. DECOMPOSIÇÃO DE INTENÇÕES MÚLTIPLAS NO MESMO TURNO (OS + CMV)

  if (!explicitPlaca && !explicitOSId && !explicitVeiculo && hasCompoundSep && mentionsOS && mentionsCMV) {
    const targetLoja = explicitLoja || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const idxOS = norm.search(/\b(os|oss|ordem|ordens)\b/i);
    const idxCMV = norm.search(/\b(cmv|custo|margem)\b/i);
    const isOSFirst = idxOS <= idxCMV;

    const intentOS: CanonicalIntent = {
      turnId: `${tId}_os`,
      canonicalQuestion: `Listar as OS abertas${lojaTexto}.`,
      intent: 'list_os',
      intents: ['list_os'],
      lojaSlug: targetLoja,
      onlyOpen: true,
      contract: {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: `${tId}_os`,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'list_os',
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { onlyOpen: true },
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: `Listar as OS abertas${lojaTexto}.`,
        plan: {
          operation: 'list_os',
          entities: { loja: lojaResolution.loja },
          filters: { onlyOpen: true },
          targetLojaSlug: targetLoja
        }
      }
    };

    const intentCMV: CanonicalIntent = {
      turnId: `${tId}_cmv`,
      canonicalQuestion: `Consultar CMV (Custo de Mercadoria Vendida) e margem bruta${lojaTexto}.`,
      intent: 'store_cmv',
      intents: ['store_cmv'],
      scope: targetLoja ? 'store' : 'network',
      lojaSlug: targetLoja,
      contract: {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: `${tId}_cmv`,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'store_cmv',
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { scope: targetLoja ? 'store' : 'network' },
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: `Consultar CMV (Custo de Mercadoria Vendida) e margem bruta${lojaTexto}.`,
        plan: {
          operation: 'store_cmv',
          scope: targetLoja ? 'store' : 'network',
          entities: { loja: lojaResolution.loja },
          filters: { scope: targetLoja ? 'store' : 'network' },
          targetLojaSlug: targetLoja
        }
      }
    };

    const subQueries = isOSFirst ? [intentOS, intentCMV] : [intentCMV, intentOS];
    const orderedIntents: IntentType[] = isOSFirst ? ['list_os', 'store_cmv'] : ['store_cmv', 'list_os'];

    const reqOS: AnswerRequirement = {
      id: `req_${tId}_list_os`,
      description: `Listar as OS abertas${lojaTexto}`,
      targetMetric: 'list_os',
      targetScope: targetLoja ? 'store' : 'all_stores',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: 'ordens_servico'
    };

    const reqCMV: AnswerRequirement = {
      id: `req_${tId}_store_cmv`,
      description: `Consultar CMV e margem bruta${lojaTexto}`,
      targetMetric: 'cmv_percentual',
      targetScope: targetLoja ? 'store' : 'network',
      targetLojaSlug: targetLoja,
      fulfilled: false,
      sourceTable: 'cmv_lojas'
    };

    const answerRequirements = isOSFirst ? [reqOS, reqCMV] : [reqCMV, reqOS];
    const primaryIntent = isOSFirst ? 'list_os' : 'store_cmv';
    const canonicalQuestion = isOSFirst
      ? `Listar as OS abertas e consultar CMV e margem bruta${lojaTexto}.`
      : `Consultar CMV e margem bruta e listar as OS abertas${lojaTexto}.`;

    const interpretation: InterpretationContract = {
      intents: orderedIntents as string[],
      metric: 'composite',
      dimensions: ['loja'],
      scope: targetLoja ? 'store' : 'network',
      period: 'mes_atual',
      filters: { onlyOpen: true },
      entities: { loja: lojaResolution.loja },
      source: 'TEXT',
      confidence: 1.0,
      answerRequirements
    };

    const compoundContract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      conversationKey,
      messageIds,
      originalTexts,
      parts,
      mediaEvidence,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: primaryIntent,
      scope: targetLoja ? 'store' : 'network',
      entities: { loja: lojaResolution.loja },
      filters: { onlyOpen: true },
      turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: 'Decomposição de intenções múltiplas no mesmo turno (OS + CMV).',
      plan: {
        operation: primaryIntent,
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: { onlyOpen: true },
        targetLojaSlug: targetLoja,
        answerRequirements
      },
      interpretation,
      answerRequirements
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: primaryIntent,
      intents: orderedIntents,
      lojaSlug: targetLoja,
      onlyOpen: true,
      parts,
      mediaEvidence,
      contract: compoundContract,
      interpretation,
      answerRequirements,
      subQueries
    });
  }

  // 4.9.1. CONSULTA DE CMV DE PRODUTO / ÁREA CANÔNICA (ex: "CMV de óleo das lojas", "CMV de óleo da Jorge Beretta")
  if (!explicitPlaca && !explicitOSId && !explicitVeiculo && detectedAreaForQuery && mentionsCMV) {
    const targetArea = detectedAreaForQuery; // 'OLEO'
    let scope: QueryScope = 'all_stores';
    let targetLoja: string | undefined = undefined;

    if (explicitLoja) {
      scope = 'store';
      targetLoja = explicitLoja;
    } else if (isNetworkScope) {
      scope = 'network';
    } else if (isAllStoresScope || norm.includes('loja') || norm.includes('lojas')) {
      scope = 'all_stores';
    } else {
      scope = 'all_stores';
    }

    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    let canonicalQuestion = `Consultar comparativo de CMV da área ${targetArea} de todas as lojas da rede.`;
    if (scope === 'store' && targetLoja) {
      canonicalQuestion = `Consultar CMV da área ${targetArea}${lojaTexto}.`;
    } else if (scope === 'network') {
      canonicalQuestion = `Consultar CMV consolidado da área ${targetArea} da rede.`;
    } else {
      canonicalQuestion = `Consultar CMV de ${targetArea === 'OLEO' ? 'óleo' : targetArea} agrupado por loja para as 10 lojas elegíveis.`;
    }

    const reqAreaCMV: AnswerRequirement = {
      id: `req_${tId}_area_cmv_${targetArea.toLowerCase()}`,
      description: canonicalQuestion,
      targetMetric: 'cmv_percentual',
      targetScope: scope,
      targetLojaSlug: targetLoja,
      targetArea,
      fulfilled: false,
      sourceTable: 'faturamento_areas'
    };

    const answerRequirements = [reqAreaCMV];

    const interpretation: InterpretationContract = {
      intents: ['store_cmv'],
      metric: 'cmv_percentual',
      dimensions: ['loja', 'area'],
      scope,
      period: 'mes_atual',
      filters: { area: targetArea, scope },
      entities: { loja: lojaResolution.loja },
      source: 'TEXT',
      confidence: 1.0,
      answerRequirements
    };

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      conversationKey,
      messageIds,
      originalTexts,
      parts,
      mediaEvidence,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'store_cmv',
      scope,
      entities: { loja: lojaResolution.loja },
      filters: { area: targetArea, scope },
      turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: `Consulta de CMV específico para a área canônica ${targetArea} em faturamento_areas.`,
      plan: {
        operation: 'store_cmv',
        scope,
        entities: { loja: lojaResolution.loja },
        filters: { area: targetArea, scope },
        targetLojaSlug: targetLoja,
        targetArea,
        answerRequirements
      },
      interpretation,
      answerRequirements
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: 'store_cmv',
      intents: ['store_cmv'],
      scope,
      lojaSlug: targetLoja,
      targetArea,
      parts,
      mediaEvidence,
      contract,
      interpretation,
      answerRequirements
    });
  }

  // 5. IDENTIFICADORES INEQUÍVOCOS (Precedência Absoluta)
  if (explicitPlaca) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'service_search',
      entities: { placa: explicitPlaca, loja: lojaResolution.loja },
      filters: { onlyOpen: mencionaAberta ? true : undefined, searchTerm: explicitPlaca },
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: previousState?.placa ? ['placa'] : [],
        removedFilters: previousState?.lojaSlug ? ['lojaSlug'] : []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: `Buscar ordem de serviço do veículo com placa ${explicitPlaca}.`,
      plan: {
        operation: 'service_search',
        entities: { placa: explicitPlaca, loja: lojaResolution.loja },
        filters: { onlyOpen: mencionaAberta ? true : undefined, searchTerm: explicitPlaca }
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: contract.canonicalQuestion,
      intent: 'service_search',
      placa: explicitPlaca,
      lojaSlug: explicitLoja,
      onlyOpen: mencionaAberta ? true : undefined,
      contract
    };
  }

  if (explicitOSId && !norm.includes('lista') && !norm.includes('quais')) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'os_detail',
      entities: { osId: explicitOSId, loja: lojaResolution.loja },
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: previousState?.osId ? ['osId'] : [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: `Exibir detalhes da Ordem de Serviço #${explicitOSId}.`,
      plan: {
        operation: 'os_detail',
        entities: { osId: explicitOSId, loja: lojaResolution.loja },
        filters: {}
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: contract.canonicalQuestion,
      intent: 'os_detail',
      osId: explicitOSId,
      lojaSlug: explicitLoja,
      contract
    };
  }

  // 5.5. Veículo Específico / Operações de Veículo e Atraso (Fase E1)
  const pendingVehicle = (previousState as any)?.pendingRequest?.targetModel || (previousState as any)?.vehicleModel;
  const isDelayQuery = isDelayReasonQuery(norm);
  const targetVehicleForDelay = explicitVeiculo || pendingVehicle;

  // DELAY_REASON: quando pergunta por que está parado/retido (explícito ou elíptico herdado)
  if (isDelayQuery && targetVehicleForDelay) {
    const targetLoja = explicitLoja || (previousState as any)?.pendingRequest?.targetLojaSlug || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = `Consultar motivo do atraso e permanência do veículo ${targetVehicleForDelay}${lojaTexto}.`;
    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'DELAY_REASON',
      targetModel: targetVehicleForDelay,
      targetLojaSlug: targetLoja,
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'delay_reason',
      entities: {
        veiculo: targetVehicleForDelay,
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        onlyOpen: true,
        searchTerm: targetVehicleForDelay,
        delayReasonFocus: true
      },
      turnRelation: {
        type: 'continue',
        inheritedFilters: ['searchTerm', 'lojaSlug'],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'delay_reason',
        entities: {
          veiculo: targetVehicleForDelay,
          loja: targetLoja ? {
            raw: targetLoja,
            slug: targetLoja,
            name: targetLojaMeta?.name || targetLoja,
            prep: targetLojaMeta?.prep || 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {
          onlyOpen: true,
          searchTerm: targetVehicleForDelay,
          delayReasonFocus: true
        },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'vehicle_situation',
      operation: 'DELAY_REASON',
      operationType: 'DELAY_REASON',
      veiculo: targetVehicleForDelay,
      vehicleModel: targetVehicleForDelay ? targetVehicleForDelay.toLowerCase() : undefined,
      lojaSlug: targetLoja,
      onlyOpen: true,
      pendingRequest,
      contract
    };
  }

  // VEHICLE_COUNT: "quantos Linea temos?"
  if (explicitVeiculo && isVehicleCountQuery(norm)) {
    const targetLoja = explicitLoja || (isContinuation ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = `Consultar quantidade e contagem de veículos ${explicitVeiculo}${lojaTexto}.`;
    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'VEHICLE_COUNT',
      targetModel: explicitVeiculo,
      targetLojaSlug: targetLoja,
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'vehicle_count',
      entities: {
        veiculo: explicitVeiculo,
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        onlyOpen: true,
        searchTerm: explicitVeiculo,
        isCountQuery: true
      },
      turnRelation: {
        type: isContinuation ? 'continue' : 'new_query',
        inheritedFilters: isContinuation && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'vehicle_count',
        entities: {
          veiculo: explicitVeiculo,
          loja: targetLoja ? {
            raw: targetLoja,
            slug: targetLoja,
            name: targetLojaMeta?.name || targetLoja,
            prep: targetLojaMeta?.prep || 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {
          onlyOpen: true,
          searchTerm: explicitVeiculo,
          isCountQuery: true
        },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      operation: 'VEHICLE_COUNT',
      operationType: 'VEHICLE_COUNT',
      veiculo: explicitVeiculo,
      vehicleModel: explicitVeiculo,
      lojaSlug: targetLoja,
      onlyOpen: true,
      pendingRequest,
      contract
    };
  }

  // VEHICLE_LIST: "liste os Linea"
  if (explicitVeiculo && isVehicleListQuery(norm)) {
    const targetLoja = explicitLoja || (isContinuation ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = `Listar veículos do modelo ${explicitVeiculo}${lojaTexto}.`;
    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'VEHICLE_LIST',
      targetModel: explicitVeiculo,
      targetLojaSlug: targetLoja,
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'vehicle_list',
      entities: {
        veiculo: explicitVeiculo,
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        onlyOpen: true,
        searchTerm: explicitVeiculo
      },
      turnRelation: {
        type: isContinuation ? 'continue' : 'new_query',
        inheritedFilters: isContinuation && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'vehicle_list',
        entities: {
          veiculo: explicitVeiculo,
          loja: targetLoja ? {
            raw: targetLoja,
            slug: targetLoja,
            name: targetLojaMeta?.name || targetLoja,
            prep: targetLojaMeta?.prep || 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {
          onlyOpen: true,
          searchTerm: explicitVeiculo
        },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      operation: 'VEHICLE_LIST',
      operationType: 'VEHICLE_LIST',
      veiculo: explicitVeiculo,
      vehicleModel: explicitVeiculo,
      lojaSlug: targetLoja,
      onlyOpen: true,
      pendingRequest,
      contract
    };
  }

  // VEHICLE_SITUATION: situação individual do veículo
  if (explicitVeiculo) {
    const targetLoja = explicitLoja || (isContinuation ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = `Verificar tempo de permanência e situação do veículo ${explicitVeiculo}${lojaTexto}.`;
    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'VEHICLE_SITUATION',
      targetModel: explicitVeiculo,
      targetLojaSlug: targetLoja,
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'service_search',
      entities: {
        veiculo: explicitVeiculo,
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        onlyOpen: true,
        searchTerm: explicitVeiculo
      },
      turnRelation: {
        type: isContinuation ? 'continue' : 'new_query',
        inheritedFilters: isContinuation && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'service_search',
        entities: {
          veiculo: explicitVeiculo,
          loja: targetLoja ? {
            raw: targetLoja,
            slug: targetLoja,
            name: targetLojaMeta?.name || targetLoja,
            prep: targetLojaMeta?.prep || 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {
          onlyOpen: true,
          searchTerm: explicitVeiculo
        },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'vehicle_situation',
      operation: 'VEHICLE_SITUATION',
      operationType: 'VEHICLE_SITUATION',
      veiculo: explicitVeiculo,
      vehicleModel: explicitVeiculo ? explicitVeiculo.toLowerCase() : undefined,
      lojaSlug: targetLoja,
      onlyOpen: true,
      pendingRequest,
      contract
    };
  }

  // 6. RESOLUÇÃO DA SEQUÊNCIA IDEAL (Passos 1, 2, 3 e 4)

  // 6.1. Turno: "qual a maior dessas?" (Referência anafórica explícita ao conjunto anterior)
  if (isAnaphoraReference && (pedeMaiorValor || pedeMaiorSaldo || pedeMaisAntiga)) {
    const prevFilters = previousState?.filters || {};
    const targetLoja = explicitLoja || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const sortConfig: SortConfig = pedeMaiorSaldo
      ? { field: 'valor_restante', direction: 'DESC', limit: 1 }
      : (pedeMaisAntiga ? { field: 'dias_no_patio', direction: 'DESC', limit: 1 } : { field: 'valor_total', direction: 'DESC', limit: 1 });

    const inherited: string[] = [];
    if (prevFilters.onlyOpen) inherited.push('onlyOpen');
    if (prevFilters.noDeposit) inherited.push('noDeposit');
    if (previousState?.lojaSlug) inherited.push('lojaSlug');

    const descSemSinal = prevFilters.noDeposit ? ' dentre as sem sinal' : '';
    const descMetrica = pedeMaiorSaldo ? 'maior saldo pendente' : (pedeMaisAntiga ? 'mais antiga' : 'maior valor total');

    const canonicalQuestion = `Identificar a OS aberta com ${descMetrica}${lojaTexto}${descSemSinal}.`;

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        onlyOpen: true,
        noDeposit: prevFilters.noDeposit ? true : undefined
      },
      sort: sortConfig,
      turnRelation: {
        type: 'continue',
        referenceTerm: 'dessas',
        inheritedFilters: inherited,
        overriddenFilters: ['sort'],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: 'Refinamento do conjunto anterior preservando os filtros de sinal e selecionando a ordem solicitada.',
      plan: {
        operation: 'list_os',
        entities: {
          loja: targetLoja ? {
            raw: targetLoja,
            slug: targetLoja,
            name: targetLojaMeta?.name || targetLoja,
            prep: targetLojaMeta?.prep || 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {
          onlyOpen: true,
          noDeposit: prevFilters.noDeposit ? true : undefined
        },
        sort: sortConfig,
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: targetLoja,
      onlyOpen: true,
      noDeposit: prevFilters.noDeposit ? true : undefined,
      sort: sortConfig,
      contract
    };
  }

  // 6.2. Turno: "ok qual a maior OS em aberto de sto andre?" (Nova consulta autossuficiente)
  if (explicitLoja && (pedeMaiorValor || pedeMaiorSaldo || pedeMaisAntiga) && !isAnaphoraReference) {
    const lojaTexto = comporTextoLoja(explicitLoja);
    const sortConfig: SortConfig = pedeMaiorSaldo
      ? { field: 'valor_restante', direction: 'DESC', limit: 1 }
      : (pedeMaisAntiga ? { field: 'dias_no_patio', direction: 'DESC', limit: 1 } : { field: 'valor_total', direction: 'DESC', limit: 1 });

    const removed: string[] = [];
    if (previousState?.filters?.noDeposit && !mencionaSemSinal) {
      removed.push('noDeposit');
    }

    const overridden: string[] = [];
    if (previousState?.lojaSlug && previousState.lojaSlug !== explicitLoja) {
      overridden.push('lojaSlug');
    }
    overridden.push('sort');

    const descMetrica = pedeMaiorSaldo ? 'maior saldo pendente' : (pedeMaisAntiga ? 'mais antiga' : 'maior valor total');
    const canonicalQuestion = `Identificar a OS aberta com ${descMetrica}${lojaTexto}.`;

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      entities: { loja: lojaResolution.loja },
      filters: {
        onlyOpen: true,
        noDeposit: mencionaSemSinal ? true : undefined // Se não mencionou sem sinal, remove o filtro!
      },
      sort: sortConfig,
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: overridden,
        removedFilters: removed
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: 'Nova consulta autossuficiente com redefinição de loja e remoção do filtro de sem sinal anterior.',
      plan: {
        operation: 'list_os',
        entities: { loja: lojaResolution.loja },
        filters: {
          onlyOpen: true,
          noDeposit: mencionaSemSinal ? true : undefined
        },
        sort: sortConfig,
        targetLojaSlug: explicitLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: explicitLoja,
      onlyOpen: true,
      noDeposit: mencionaSemSinal ? true : undefined,
      sort: sortConfig,
      contract
    };
  }

  // 6.3. Turno: "e a mais antiga?" (Continuação elíptica com preservação de loja e troca de ordenação)
  if (pedeMaisAntiga && (isElipsePrefix || !explicitLoja)) {
    const targetLoja = explicitLoja || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const sortConfig: SortConfig = { field: 'dias_no_patio', direction: 'DESC', limit: 1 };
    const inherited: string[] = [];
    if (targetLoja && !explicitLoja) inherited.push('lojaSlug');
    if (previousState?.filters?.onlyOpen) inherited.push('onlyOpen');

    const canonicalQuestion = `Identificar a OS aberta mais antiga${lojaTexto}.`;

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        onlyOpen: true,
        noDeposit: undefined // Garante que sem sinal não é herdado se não foi pedido
      },
      sort: sortConfig,
      turnRelation: {
        type: 'continue',
        referenceTerm: 'e a mais antiga',
        inheritedFilters: inherited,
        overriddenFilters: ['sort'],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      explanation: 'Continuação elíptica preservando a loja anterior e alterando a ordenação para antiguidade.',
      plan: {
        operation: 'list_os',
        entities: {
          loja: targetLoja ? {
            raw: targetLoja,
            slug: targetLoja,
            name: targetLojaMeta?.name || targetLoja,
            prep: targetLojaMeta?.prep || 'de',
            confidence: 1.0
          } : undefined
        },
        filters: {
          onlyOpen: true
        },
        sort: sortConfig,
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: targetLoja,
      onlyOpen: true,
      sort: sortConfig,
      contract
    };
  }

  // 7. CONSULTAS OPERACIONAIS DIRETAS POR PALAVRA-CHAVE

  // 7.1. Raio-X / Situação de Loja ("como tá o Jabaquara?", "situação da Kennedy")
  const isSpecificDomainQuery = norm.includes('cmv') || norm.includes('custo') || norm.includes('meta') || 
    norm.includes('fatur') || norm.includes('receber') || norm.includes('area') || norm.includes('setor') || 
    norm.includes('midia') || norm.includes('cliente') || norm.includes('checklist') || norm.includes('chklist') || 
    norm.includes('patio') || norm.includes('parado') || norm.includes('travado');
  const isStoreOverviewQuery = !isSpecificDomainQuery && (
    norm.includes('como esta') || norm.includes('como ta') ||
    norm.includes('situacao') || norm.includes('raio') ||
    norm.includes('resumo') || norm.includes('status') ||
    norm.includes('visao geral') || norm.includes('panorama')
  );
  if (explicitLoja && isStoreOverviewQuery) {
    const lojaTexto = comporTextoLoja(explicitLoja);
    const pendingRequest = createOrPreservePendingRequest({
      userPrompt: textoLimpo,
      operation: 'STORE_SUMMARY',
      targetLojaSlug: explicitLoja,
      previousPendingRequest: (previousState as any)?.pendingRequest
    });

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'store_overview',
      entities: { loja: lojaResolution.loja },
      filters: {},
      turnRelation: {
        type: 'new_query',
        inheritedFilters: [],
        overriddenFilters: previousState?.lojaSlug ? ['lojaSlug'] : [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: `Exibir situação operacional e raio-x${lojaTexto}.`,
      plan: {
        operation: 'store_overview',
        entities: { loja: lojaResolution.loja },
        filters: {},
        targetLojaSlug: explicitLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: contract.canonicalQuestion,
      intent: 'store_overview',
      operation: 'STORE_SUMMARY',
      operationType: 'STORE_SUMMARY',
      lojaSlug: explicitLoja,
      pendingRequest,
      contract
    };
  }

  // 7.2. Auditoria de Checklists ("checklist por loja", "checklist mecânico")
  if (norm.includes('checklist') || norm.includes('chklist') || norm.includes('cheklist') || norm.includes('check list') || norm.includes('inspe') || norm.includes('mecanic')) {
    const targetLoja = explicitLoja || (isElipsePrefix ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const pedeMecanico = norm.includes('mecanic');
    const pedeEntrada = norm.includes('inspe') || norm.includes('entrada');
    const querPorLoja = norm.includes('loja');

    let scope: 'MECANICO' | 'ENTRADA' | 'TODOS' = 'TODOS';
    let desc = 'checklists';
    if (pedeMecanico && !pedeEntrada) {
      scope = 'MECANICO';
      desc = 'checklist mecânico';
    } else if (pedeEntrada && !pedeMecanico) {
      scope = 'ENTRADA';
      desc = 'checklist de entrada';
    } else if (querPorLoja) {
      desc = 'checklists por loja';
    }

    const serviceTerms = ['checklist'];
    if (pedeMecanico) serviceTerms.push('mecanico');
    if (pedeEntrada) serviceTerms.push('entrada');
    if (querPorLoja) serviceTerms.push('por_loja');

    const canonicalQuestion = `Consultar auditoria de ${desc}${lojaTexto}.`;
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'checklist_audit',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: { checklistScope: scope, serviceTerms },
      turnRelation: {
        type: isElipsePrefix ? 'continue' : 'new_query',
        inheritedFilters: isElipsePrefix && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: explicitLoja && previousState?.lojaSlug ? ['lojaSlug'] : [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'checklist_audit',
        entities: {},
        filters: { checklistScope: scope, serviceTerms },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'service_search',
      lojaSlug: targetLoja,
      serviceTerms,
      contract
    };
  }

  // 7.3.1. CMV (Custo de Mercadoria Vendida) e Margem
  if (
    norm.includes('cmv') || 
    norm.includes('custo de mercadoria') || 
    (norm.includes('margem') && !norm.includes('lucro de cada os')) ||
    (isPiorStoreQuery && (previousState?.lastIntent === 'store_cmv' || previousState?.lastContract?.operation === 'store_cmv'))
  ) {
    let scope: QueryScope = 'network';
    let targetLoja: string | undefined = undefined;
    let subIntent: 'worst_store' | 'store_list' | 'single_store' | 'general' = 'general';
    let focusWorst = false;

    if (isPiorStoreQuery) {
      scope = 'network';
      subIntent = 'worst_store';
      focusWorst = true;
    } else if (isAllStoresScope) {
      scope = 'all_stores';
      subIntent = 'store_list';
    } else if (isNetworkScope || (!explicitLoja && !previousState?.lojaSlug && !isStoreAnaphora && !isElipsePrefix)) {
      scope = 'network';
      subIntent = 'general';
    } else {
      const candidateLoja = explicitLoja || ((isElipsePrefix || isStoreAnaphora || previousState?.lojaSlug != null) ? (effectivePreviousLojaSlug || previousState?.lojaSlug) : undefined);
      const isKnownLoja = candidateLoja && (
        CATALOGO_10_LOJAS.includes(candidateLoja) || 
        candidateLoja === "MPMaster" || 
        STORE_ALIASES[candidateLoja.toLowerCase()] !== undefined ||
        STORE_PRETTY_NAMES[candidateLoja] !== undefined ||
        candidateLoja === 'jabaquara'
      );
      if (isKnownLoja) {
        scope = 'store';
        targetLoja = candidateLoja;
        subIntent = 'single_store';
      } else {
        scope = 'network';
        subIntent = 'general';
      }
    }

    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    let canonicalQuestion = `Consultar CMV (Custo de Mercadoria Vendida) consolidado da rede.`;
    if (subIntent === 'worst_store') {
      canonicalQuestion = `Consultar pior loja da rede por CMV (Custo de Mercadoria Vendida).`;
    } else if (subIntent === 'store_list') {
      canonicalQuestion = `Consultar comparativo de CMV (Custo de Mercadoria Vendida) de todas as lojas da rede.`;
    } else if (targetLoja) {
      canonicalQuestion = `Consultar CMV (Custo de Mercadoria Vendida) e margem bruta${lojaTexto}.`;
    }

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      conversationKey,
      messageIds,
      originalTexts,
      parts,
      mediaEvidence,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'store_cmv',
      scope,
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {
        subIntent,
        focusWorst: focusWorst || undefined,
        scope
      },
      turnRelation: {
        type: (isElipsePrefix || isStoreAnaphora) ? 'continue' : (isNetworkScope || isAllStoresScope ? 'new_query' : 'new_query'),
        inheritedFilters: (isElipsePrefix || isStoreAnaphora) && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: (isNetworkScope || isAllStoresScope) && previousState?.lojaSlug ? ['lojaSlug'] : [],
        removedFilters: (isNetworkScope || isAllStoresScope) && previousState?.lojaSlug ? ['lojaSlug'] : []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'store_cmv',
        scope,
        entities: {},
        filters: {
          subIntent,
          focusWorst: focusWorst || undefined,
          scope
        },
        targetLojaSlug: targetLoja,
        mediaEvidence
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'store_cmv',
      scope,
      lojaSlug: targetLoja,
      subIntent,
      focusWorst: focusWorst || undefined,
      parts,
      mediaEvidence,
      contract
    };
  }

  // 7.3.2. Faturamento e Margem por Área ("Qual área tá pior?", "faturamento por área")
  if (
    isPiorAreaQuery ||
    norm.includes('por area') ||
    norm.includes('por setor') ||
    norm.includes('faturamento por area') ||
    norm.includes('faturamento por setor') ||
    (norm.includes('area') && (norm.includes('fatur') || norm.includes('servico') || norm.includes('pior') || norm.includes('critica')))
  ) {
    const targetLoja = isNetworkScope ? undefined : (explicitLoja || ((isElipsePrefix || isStoreAnaphora || previousState?.lojaSlug != null) ? previousState?.lojaSlug : undefined));
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = isPiorAreaQuery
      ? `Consultar área operacional mais crítica por CMV${lojaTexto}.`
      : `Consultar faturamento e margem por área operacional${lojaTexto}.`;

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'store_areas',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: { focusWorst: isPiorAreaQuery || undefined },
      turnRelation: {
        type: (isElipsePrefix || isStoreAnaphora || !explicitLoja) ? 'continue' : 'new_query',
        inheritedFilters: (!explicitLoja && targetLoja === previousState?.lojaSlug) ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'store_areas',
        entities: {},
        filters: { focusWorst: isPiorAreaQuery || undefined },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'store_areas',
      lojaSlug: targetLoja,
      focusWorst: isPiorAreaQuery || undefined,
      contract
    };
  }

  // 7.3.3. Pesquisa de Mídia e Canais de Captação (incluindo Google + Central por Loja)
  const isGoogleCentralCandidate =
    (norm.includes('google') && (norm.includes('central') || norm.includes('atendimento'))) ||
    norm.includes('central de atendimento') ||
    ((norm.includes('google') || norm.includes('central')) && (norm.includes('midia') || norm.includes('captac') || norm.includes('por loja')));

  if (
    isGoogleCentralCandidate ||
    norm.includes('midia') ||
    norm.includes('pesquisa de midia') ||
    norm.includes('origem dos clientes') ||
    norm.includes('origem de cliente') ||
    norm.includes('canal de captacao') ||
    (norm.includes('de onde') && (norm.includes('cliente') || norm.includes('vem'))) ||
    (norm.includes('origem') && norm.includes('cliente')) ||
    (norm.includes('canal') && (norm.includes('cliente') || norm.includes('traz'))) ||
    (norm.includes('google') && norm.includes('cliente'))
  ) {
    const isPorLoja = norm.includes('por loja') || norm.includes('de cada loja') || isAllStoresScope;
    const targetLoja = (isNetworkScope || isPorLoja) ? undefined : (explicitLoja || ((isElipsePrefix || isStoreAnaphora || previousState?.lojaSlug != null) ? previousState?.lojaSlug : undefined));
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = isPorLoja ? ' por loja' : comporTextoLoja(targetLoja);

    const isGoogleCentral =
      isGoogleCentralCandidate ||
      (norm.includes('google') && (norm.includes('central') || norm.includes('atendimento'))) ||
      norm.includes('central de atendimento') ||
      ((norm.includes('google') || norm.includes('central')) && norm.includes('por loja'));

    const canonicalQuestion = isGoogleCentral
      ? (isPorLoja
          ? `Consultar captação de clientes via Google e Central de Atendimento por loja.`
          : `Consultar captação de clientes via Google e Central de Atendimento${lojaTexto}.`)
      : `Consultar pesquisa de mídia e canais de captação de clientes${lojaTexto}.`;

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'media_survey',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: {},
      turnRelation: {
        type: isElipsePrefix ? 'continue' : 'new_query',
        inheritedFilters: isElipsePrefix && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'media_survey',
        entities: {},
        filters: {},
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'media_survey',
      lojaSlug: targetLoja,
      contract
    };
  }

  // 7.3.4. Metas e Alertas Financeiros (Diferencia "falta quanto para a meta" de "faturamento das lojas")
  if (norm.includes('fatur') || norm.includes('meta') || norm.includes('financeir') || norm.includes('receber') || norm.includes('ticket') || norm.includes('venda') || norm.includes('receita')) {
    const isNetworkOrAllScope = isNetworkScope || isAllStoresScope;
    const targetLoja = isNetworkOrAllScope ? undefined : (explicitLoja || ((isElipsePrefix || isStoreAnaphora) ? previousState?.lojaSlug : undefined));
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const isGoalGap = norm.includes('falta') || norm.includes('bater') || norm.includes('atingi') || norm.includes('alcanc') || norm.includes('quanto falta') || norm.includes('pra bater');
    const subIntent: 'goal_gap' | 'single_store' | 'store_list' = isGoalGap
      ? 'goal_gap'
      : (targetLoja ? 'single_store' : 'store_list');

    const isOntem = /\b(ontem|d-1)\b/i.test(norm);
    const isVendasHoje = !isOntem && norm.includes('hoje') && (norm.includes('fatur') || norm.includes('venda') || norm.includes('vendeu') || norm.includes('quanto') || norm.includes('receita'));
    const canonicalQuestion = isGoalGap
      ? `Consultar atingimento e quanto falta para bater a meta${lojaTexto}.`
      : (isOntem
          ? (targetLoja ? `Consultar faturamento de ontem${lojaTexto}.` : `Consultar faturamento de ontem de todas as lojas da rede.`)
          : (isVendasHoje
              ? (targetLoja ? `Consultar faturamento e vendas de hoje${lojaTexto}.` : `Consultar faturamento e vendas de hoje de todas as lojas da rede.`)
              : (targetLoja ? `Consultar faturamento e metas${lojaTexto}.` : `Consultar faturamento acumulado de todas as lojas da rede.`)));

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'financial_alerts',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: { subIntent },
      turnRelation: {
        type: isNetworkScope ? 'new_query' : (isElipsePrefix ? 'continue' : 'new_query'),
        inheritedFilters: (!isNetworkScope && isElipsePrefix && targetLoja === previousState?.lojaSlug) ? ['lojaSlug'] : [],
        overriddenFilters: isNetworkScope && previousState?.lojaSlug ? ['lojaSlug'] : [],
        removedFilters: isNetworkScope && previousState?.lojaSlug ? ['lojaSlug'] : []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'financial_alerts',
        entities: {},
        filters: { subIntent },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'financial_alerts',
      lojaSlug: targetLoja,
      subIntent,
      contract
    };
  }

  const mentionsExplicitPatio = (norm.includes('patio') || norm.includes('oficina')) && 
    (norm.includes('veiculo') || norm.includes('carro') || norm.includes('retid') || norm.includes('parado') || norm.includes('travado') || norm.includes('situacao') || norm.includes('como ta') || norm.includes('lista') || norm.includes('quantos') || norm.includes('quem') || norm.includes('no patio') || norm.includes('do patio'));
  const mentionsAgingOrRetained =
    norm.includes('retid') ||
    norm.includes('travad') ||
    norm.includes('trava') ||
    norm.includes('emperra') ||
    norm.includes('pres') ||
    norm.includes('bloqueado') ||
    norm.includes('bloqueada') ||
    /\btravas?\b/i.test(norm);
  const mentionsParadoDias = (norm.includes('parado') || norm.includes('retid') || norm.includes('travad')) && /\b(\d+|muitos?|varios?|bastante|tempo)\s*dias?\b/i.test(norm);
  const mentionsDiasParado = /\b(\d+|muitos?|varios?)\s*dias?\s*(parados?|retidos?|no patio|travados?|sem mexer)\b/i.test(norm);
  const mentionsCarrosParados = /\b(carros?|veiculos?|oss?|ordens?)\s*(parados?|retidos?|travados?)\b/i.test(norm);
  const isAgingYardQuery = !isDelayQuery && (mentionsExplicitPatio || mentionsAgingOrRetained || mentionsParadoDias || mentionsDiasParado || mentionsCarrosParados || (norm.includes('patio') && !norm.includes('obsidian') && !norm.includes('memoria') && !norm.includes('diagnostico')));

  if (isAgingYardQuery) {
    const hasExplicitContinuity = /\b(tambem|dessa|nessa|nela|la|mesma|delas|deles)\b/i.test(norm);
    const targetLoja = explicitLoja || (isElipsePrefix && hasExplicitContinuity ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = `Listar veículos retidos no pátio${lojaTexto}.`;
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'aging_cars',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: { onlyOpen: true, minDiasPatio: 5 },
      turnRelation: {
        type: isElipsePrefix ? 'continue' : 'new_query',
        inheritedFilters: isElipsePrefix && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'aging_cars',
        entities: {},
        filters: { onlyOpen: true, minDiasPatio: 5 },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: targetLoja,
      onlyOpen: true,
      contract
    };
  }

  // 8. LISTAGEM GERAL DE OS (com ou sem filtro de sem sinal)
  if (mencionaSemSinal) {
    const targetLoja = explicitLoja || (isContinuation ? previousState?.lojaSlug : undefined);
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);

    const canonicalQuestion = `Listar as OS abertas${lojaTexto} com valor pago zero e saldo pendente.`;
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: { onlyOpen: true, noDeposit: true },
      turnRelation: {
        type: isContinuation ? 'continue' : 'new_query',
        inheritedFilters: isContinuation && targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'list_os',
        entities: {},
        filters: { onlyOpen: true, noDeposit: true },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: targetLoja,
      onlyOpen: true,
      noDeposit: true,
      contract
    };
  }

  // 8.1. Aprofundamento para listar OSs ("perfeito mas quais sao as oss que tem??")
  const pedeListaOS = (
    (norm.includes('oss') || norm.includes('ordens') || norm.includes('carros') || norm.includes('veiculos')) &&
    (norm.includes('quais') || norm.includes('tem') || norm.includes('lista') || norm.includes('aberta'))
  ) || (
    previousState?.lojaSlug != null && (norm.includes('aberta') || norm.includes('aberto')) && !norm.includes('loja') && !norm.includes('rede')
  ) || (
    explicitLoja != null &&
    (norm.includes('oss') || norm.includes('ordens') || /\bos\s+d[ao]/i.test(norm)) &&
    !isSpecificDomainQuery
  );

  if (pedeListaOS || (previousState?.lastIntent === 'store_overview' && (norm.includes('quais') || norm.includes('tem') || norm.includes('oss')))) {
    const targetLoja = explicitLoja || previousState?.lojaSlug;
    const targetLojaMeta = targetLoja ? STORE_PRETTY_NAMES[targetLoja] : undefined;
    const lojaTexto = comporTextoLoja(targetLoja);
    const noDeposit = previousState?.filters?.noDeposit || false;

    const canonicalQuestion = `Listar as OS abertas${lojaTexto}.`;
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'list_os',
      entities: {
        loja: targetLoja ? {
          raw: targetLoja,
          slug: targetLoja,
          name: targetLojaMeta?.name || targetLoja,
          prep: targetLojaMeta?.prep || 'de',
          confidence: 1.0
        } : undefined
      },
      filters: { onlyOpen: true, noDeposit: noDeposit || undefined },
      turnRelation: {
        type: 'refine',
        inheritedFilters: targetLoja === previousState?.lojaSlug ? ['lojaSlug'] : [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'list_os',
        entities: {},
        filters: { onlyOpen: true, noDeposit: noDeposit || undefined },
        targetLojaSlug: targetLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'list_os',
      lojaSlug: targetLoja,
      onlyOpen: true,
      noDeposit,
      contract
    };
  }

  // 8.1.5. Correção de Escopo para Rede ("não, da rede", "esquece, da rede")
  if (hasNetworkCorrection && previousState) {
    if (previousState.lastIntent === 'store_cmv' || previousState.lastContract?.operation === 'store_cmv') {
      const canonicalQuestion = `Consultar CMV (Custo de Mercadoria Vendida) consolidado da rede.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'store_cmv',
        scope: 'network',
        entities: {},
        filters: { subIntent: 'general', scope: 'network' },
        turnRelation: {
          type: 'continue',
          inheritedFilters: [],
          overriddenFilters: ['lojaSlug', 'scope'],
          removedFilters: ['lojaSlug']
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'store_cmv',
          scope: 'network',
          entities: {},
          filters: { subIntent: 'general', scope: 'network' }
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'store_cmv',
        scope: 'network',
        lojaSlug: undefined,
        subIntent: 'general',
        contract
      };
    }

    if (previousState.lastIntent === 'financial_alerts' || previousState.lastContract?.operation === 'financial_alerts') {
      const canonicalQuestion = `Consultar faturamento acumulado de todas as lojas da rede.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'financial_alerts',
        entities: {},
        filters: { subIntent: 'store_list' },
        turnRelation: {
          type: 'continue',
          inheritedFilters: [],
          overriddenFilters: ['lojaSlug'],
          removedFilters: ['lojaSlug']
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'financial_alerts',
          entities: {},
          filters: { subIntent: 'store_list' }
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'financial_alerts',
        lojaSlug: undefined,
        subIntent: 'store_list',
        contract
      };
    }

    if (previousState.lastIntent === 'store_areas' || previousState.lastContract?.operation === 'store_areas') {
      const canonicalQuestion = `Consultar faturamento e margem por área operacional da rede.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'store_areas',
        entities: {},
        filters: {},
        turnRelation: {
          type: 'continue',
          inheritedFilters: [],
          overriddenFilters: ['lojaSlug'],
          removedFilters: ['lojaSlug']
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'store_areas',
          entities: {},
          filters: {}
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'store_areas',
        lojaSlug: undefined,
        contract
      };
    }

    if (previousState.lastIntent === 'media_survey' || previousState.lastContract?.operation === 'media_survey') {
      const prevCanonical = (previousState.lastContract?.canonicalQuestion || '').toLowerCase();
      const isPrevGC = prevCanonical.includes('google') && prevCanonical.includes('central');
      const canonicalQuestion = isPrevGC
        ? `Consultar captação de clientes via Google e Central de Atendimento por loja.`
        : `Consultar pesquisa de mídia e canais de captação de clientes da rede.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'media_survey',
        entities: {},
        filters: {},
        turnRelation: {
          type: 'continue',
          inheritedFilters: [],
          overriddenFilters: ['lojaSlug'],
          removedFilters: ['lojaSlug']
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'media_survey',
          entities: {},
          filters: {}
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'media_survey',
        lojaSlug: undefined,
        contract
      };
    }
  }

  // 8.1.8. Elipse Temporal de Continuidade ("e ontem?", "quanto foi ontem?", "e no dia anterior?", "e mês passado?")
  const isTemporalElipse =
    /\b(e ontem|quanto foi ontem|como foi ontem|de ontem|no dia anterior|e no dia anterior|e ontem\?)\b/i.test(norm) ||
    norm === 'e ontem?' || norm === 'e ontem' || norm === 'ontem' || norm === 'ontem?' ||
    /\b(e mes passado|como foi mes passado|e no mes anterior|do mes passado)\b/i.test(norm) ||
    (isElipsePrefix && /\b(ontem|mes passado|ultimo mes)\b/i.test(norm));

  if (isTemporalElipse && !explicitOSId && !explicitPlaca) {
    const isOntem = /\b(ontem|dia anterior)\b/i.test(norm);
    const isMesPassado = /\b(mes passado|ultimo mes|mes anterior)\b/i.test(norm);
    const periodType: 'ontem' | 'mes_passado' = isMesPassado ? 'mes_passado' : 'ontem';
    const periodLabel = isMesPassado ? 'Mês Passado' : 'Ontem';

    const targetLoja = explicitLoja || previousState?.lojaSlug;

    // Desambiguação obrigatória se não houver loja definida e operador estiver em escopo aberto/rede
    if (!targetLoja && !explicitLoja) {
      const canonicalQuestion = `Solicitar desambiguação de loja para consulta de ${periodLabel.toLowerCase()}.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'clarify',
        operation: 'financial_alerts',
        scope: 'unspecified',
        entities: {},
        filters: {},
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: {
          isAmbiguous: true,
          clarificationQuestion: `Por favor, indique para qual loja deseja consultar as informações de ${periodLabel.toLowerCase()}.`,
          reason: 'store_ambiguity'
        },
        canonicalQuestion,
        plan: {
          operation: 'financial_alerts',
          entities: {},
          filters: {}
        }
      };

      return finalizeCanonicalIntent({
        turnId: tId,
        canonicalQuestion,
        intent: 'financial_alerts',
        needsClarification: true,
        clarificationMessage: `Por favor, indique para qual loja deseja consultar as informações de ${periodLabel.toLowerCase()}.`,
        contract
      });
    }

    const lojaTexto = comporTextoLoja(targetLoja);
    const prevIntent = previousState?.lastIntent || 'financial_alerts';
    const activeIntent: IntentType = (prevIntent === 'store_cmv' || prevIntent === 'list_os' || prevIntent === 'aging_cars')
      ? prevIntent
      : 'financial_alerts';

    let dateRange = { startDate: '', endDate: '' };
    if (isOntem) {
      const y = getCivilYesterdayDate();
      dateRange = { startDate: y.dateStr, endDate: y.dateStr };
    } else {
      const m = getCivilLastMonthRange();
      dateRange = { startDate: m.startDate, endDate: m.endDate };
    }

    let canonicalQuestion = `Consultar faturamento de ${periodLabel.toLowerCase()}${lojaTexto}.`;
    if (activeIntent === 'store_cmv') {
      canonicalQuestion = `Consultar CMV de ${periodLabel.toLowerCase()}${lojaTexto}.`;
    } else if (activeIntent === 'list_os') {
      canonicalQuestion = `Listar ordens de serviço de ${periodLabel.toLowerCase()}${lojaTexto}.`;
    }

    const contractPeriodType: 'hoje' | 'mes_atual' | 'personalizado' = (periodType === 'ontem' || periodType === 'mes_passado') ? 'personalizado' : 'hoje';

    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: activeIntent,
      scope: targetLoja ? 'store' : 'network',
      entities: { loja: lojaResolution.loja },
      filters: {},
      period: {
        type: contractPeriodType,
        label: periodLabel,
        start: dateRange.startDate,
        end: dateRange.endDate
      },
      turnRelation: {
        type: 'continue',
        inheritedFilters: ['lojaSlug'],
        overriddenFilters: ['period'],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: activeIntent,
        scope: targetLoja ? 'store' : 'network',
        entities: { loja: lojaResolution.loja },
        filters: {},
        period: {
          type: contractPeriodType,
          label: periodLabel,
          start: dateRange.startDate,
          end: dateRange.endDate
        },
        targetLojaSlug: targetLoja
      }
    };

    return finalizeCanonicalIntent({
      turnId: tId,
      canonicalQuestion,
      intent: activeIntent,
      lojaSlug: targetLoja,
      contract
    });
  }

  // 8.2. Elipse pura de Loja ("e no Jabaquara?", "e em Mauá?", "não, de Santo André")
  if (explicitLoja && (isElipsePrefix || isCorrectionPrefix || !isStoreOverviewQuery)) {
    const lojaTexto = comporTextoLoja(explicitLoja);

    // Se o turno anterior era metas/faturamento (financial_alerts)
    if (previousState?.lastIntent === 'financial_alerts' || previousState?.lastContract?.operation === 'financial_alerts') {
      const prevSubIntent = previousState?.filters?.subIntent || (previousState?.lastContract?.filters as any)?.subIntent || 'goal_gap';
      const isGoalGap = prevSubIntent === 'goal_gap';
      const subIntent = isGoalGap ? 'goal_gap' : 'single_store';
      const canonicalQuestion = isGoalGap
        ? `Consultar atingimento e quanto falta para bater a meta${lojaTexto}.`
        : `Consultar faturamento e metas${lojaTexto}.`;

      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'financial_alerts',
        entities: { loja: lojaResolution.loja },
        filters: { subIntent },
        turnRelation: {
          type: 'continue',
          inheritedFilters: ['subIntent'],
          overriddenFilters: ['lojaSlug'],
          removedFilters: []
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'financial_alerts',
          entities: { loja: lojaResolution.loja },
          filters: { subIntent },
          targetLojaSlug: explicitLoja
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'financial_alerts',
        lojaSlug: explicitLoja,
        subIntent,
        contract
      };
    }

    // Se o turno anterior era CMV
    if (previousState?.lastIntent === 'store_cmv' || previousState?.lastContract?.operation === 'store_cmv') {
      const canonicalQuestion = `Consultar CMV (Custo de Mercadoria Vendida) e margem bruta${lojaTexto}.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'store_cmv',
        entities: { loja: lojaResolution.loja },
        filters: {},
        turnRelation: {
          type: 'continue',
          inheritedFilters: [],
          overriddenFilters: ['lojaSlug'],
          removedFilters: []
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'store_cmv',
          entities: { loja: lojaResolution.loja },
          filters: {},
          targetLojaSlug: explicitLoja
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'store_cmv',
        lojaSlug: explicitLoja,
        contract
      };
    }

    // Se o turno anterior era Áreas
    if (previousState?.lastIntent === 'store_areas' || previousState?.lastContract?.operation === 'store_areas') {
      const focusWorst = Boolean(previousState?.filters?.focusWorst);
      const canonicalQuestion = focusWorst
        ? `Consultar área operacional mais crítica por CMV${lojaTexto}.`
        : `Consultar faturamento e margem por área operacional${lojaTexto}.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'store_areas',
        entities: { loja: lojaResolution.loja },
        filters: { focusWorst: focusWorst || undefined },
        turnRelation: {
          type: 'continue',
          inheritedFilters: focusWorst ? ['focusWorst'] : [],
          overriddenFilters: ['lojaSlug'],
          removedFilters: []
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'store_areas',
          entities: { loja: lojaResolution.loja },
          filters: { focusWorst: focusWorst || undefined },
          targetLojaSlug: explicitLoja
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'store_areas',
        lojaSlug: explicitLoja,
        focusWorst: focusWorst || undefined,
        contract
      };
    }

    // Se o turno anterior era Pesquisa de Mídia
    if (previousState?.lastIntent === 'media_survey' || previousState?.lastContract?.operation === 'media_survey') {
      const prevCanonical = (previousState?.lastContract?.canonicalQuestion || '').toLowerCase();
      const isPrevGC = prevCanonical.includes('google') && prevCanonical.includes('central');
      const canonicalQuestion = isPrevGC
        ? `Consultar captação de clientes via Google e Central de Atendimento${lojaTexto}.`
        : `Consultar pesquisa de mídia e canais de captação de clientes${lojaTexto}.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'media_survey',
        entities: { loja: lojaResolution.loja },
        filters: {},
        turnRelation: {
          type: 'continue',
          inheritedFilters: [],
          overriddenFilters: ['lojaSlug'],
          removedFilters: []
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'media_survey',
          entities: { loja: lojaResolution.loja },
          filters: {},
          targetLojaSlug: explicitLoja
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'media_survey',
        lojaSlug: explicitLoja,
        contract
      };
    }

    if (previousState?.lastIntent === 'list_os') {
      const prevNoDeposit = Boolean(previousState.filters?.noDeposit);
      const canonicalQuestion = prevNoDeposit
        ? `Listar as OS abertas${lojaTexto} com valor pago zero e saldo pendente.`
        : `Listar as OS abertas${lojaTexto}.`;

      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'list_os',
        entities: { loja: lojaResolution.loja },
        filters: { onlyOpen: true, noDeposit: prevNoDeposit || undefined },
        turnRelation: {
          type: 'continue',
          inheritedFilters: prevNoDeposit ? ['onlyOpen', 'noDeposit'] : ['onlyOpen'],
          overriddenFilters: ['lojaSlug'],
          removedFilters: []
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'list_os',
          entities: { loja: lojaResolution.loja },
          filters: { onlyOpen: true, noDeposit: prevNoDeposit || undefined },
          targetLojaSlug: explicitLoja
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'list_os',
        lojaSlug: explicitLoja,
        onlyOpen: true,
        noDeposit: prevNoDeposit,
        contract
      };
    }

    if (previousState?.lastIntent === 'service_search' || previousState?.filters?.serviceTerms?.includes('checklist')) {
      const canonicalQuestion = `Consultar auditoria de checklists${lojaTexto}.`;
      const contract: TurnContract = {
        version: CONVERSATION_CONTRACT_VERSION,
        turnId: tId,
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'checklist_audit',
        entities: { loja: lojaResolution.loja },
        filters: { checklistScope: 'TODOS', serviceTerms: ['checklist'] },
        turnRelation: {
          type: 'continue',
          inheritedFilters: ['serviceTerms'],
          overriddenFilters: ['lojaSlug'],
          removedFilters: []
        },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion,
        plan: {
          operation: 'checklist_audit',
          entities: { loja: lojaResolution.loja },
          filters: { checklistScope: 'TODOS', serviceTerms: ['checklist'] },
          targetLojaSlug: explicitLoja
        }
      };

      return {
        turnId: tId,
        canonicalQuestion,
        intent: 'service_search',
        lojaSlug: explicitLoja,
        serviceTerms: ['checklist'],
        contract
      };
    }

    // Default quando troca de loja sem histórico de lista
    const canonicalQuestion = `Exibir situação operacional e raio-x${lojaTexto}.`;
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'store_overview',
      entities: { loja: lojaResolution.loja },
      filters: {},
      turnRelation: {
        type: 'continue',
        inheritedFilters: [],
        overriddenFilters: ['lojaSlug'],
        removedFilters: []
      },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion,
      plan: {
        operation: 'store_overview',
        entities: { loja: lojaResolution.loja },
        filters: {},
        targetLojaSlug: explicitLoja
      }
    };

    return {
      turnId: tId,
      canonicalQuestion,
      intent: 'store_overview',
      lojaSlug: explicitLoja,
      contract
    };
  }

  // 8.3. Elipse Vaga ("e agora?", "e aí?")
  if (isElipsePrefix && !explicitLoja && !explicitPlaca && !explicitOSId && norm.length < 20) {
    const contract: TurnContract = {
      version: CONVERSATION_CONTRACT_VERSION,
      turnId: tId,
      timestamp: new Date().toISOString(),
      decision: 'clarify',
      operation: 'general_query',
      entities: {},
      filters: {},
      turnRelation: {
        type: 'continue',
        inheritedFilters: [],
        overriddenFilters: [],
        removedFilters: []
      },
      ambiguity: {
        isAmbiguous: true,
        clarificationQuestion: 'Você gostaria de consultar as ordens abertas, o raio-x de alguma loja específica ou dados de faturamento?',
        reason: 'Elipse vaga sem parâmetros operacionais.'
      },
      canonicalQuestion: textoLimpo,
      plan: {
        operation: 'general_query',
        entities: {},
        filters: {}
      }
    };

    return {
      turnId: tId,
      canonicalQuestion: textoLimpo,
      intent: 'other',
      needsClarification: true,
      clarificationMessage: contract.ambiguity.clarificationQuestion,
      contract
    };
  }

  // 9. Default / Consulta Geral
  const targetLoja = explicitLoja || (isElipsePrefix ? previousState?.lojaSlug : undefined);
  const contract: TurnContract = {
    version: CONVERSATION_CONTRACT_VERSION,
    turnId: tId,
    timestamp: new Date().toISOString(),
    decision: 'execute',
    operation: 'general_query',
    entities: { loja: lojaResolution.loja },
    filters: {},
    turnRelation: {
      type: 'new_query',
      inheritedFilters: [],
      overriddenFilters: [],
      removedFilters: []
    },
    ambiguity: { isAmbiguous: false },
    canonicalQuestion: textoLimpo,
    plan: {
      operation: 'general_query',
      entities: { loja: lojaResolution.loja },
      filters: {},
      targetLojaSlug: targetLoja
    }
  };

  return {
    turnId: tId,
    canonicalQuestion: textoLimpo,
    intent: 'other',
    lojaSlug: targetLoja,
    contract
  };
}


export function rewriteIntent(
  userText: string,
  previousState?: TurnState | ExtendedTurnState | null,
  options?: RewriteIntentOptions
): CanonicalIntent {
  const result = _rewriteIntentCore(userText, previousState, options);
  return finalizeCanonicalIntent(result, userText, previousState);
}

// Re-exportação da camada semântica ontológica
export {
  buildSemanticQueryPlan,
  type RewriteSemanticContext
} from './semantic_plan_builder.js';

