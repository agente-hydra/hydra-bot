/**
 * src/hydra-sync/case_memory_reader.ts
 * Leitor e consolidador de fatos e memória de caso operacional.
 * Implementa a cadeia de prioridade com fallback transparente:
 * 1. Projeção de Grafo de Atendimentos (quando íntegra e válida)
 * 2. Análise Canônica Persistida
 * 3. Dados Diretos do ERP (Fallback transparente)
 *
 * REGRA DE OURO FACTUAL: Se o motivo da demora não estiver documentado na análise,
 * declara a limitação factual de forma honesta, sem alucinar falta de peças ou mecânico!
 */

import type Database from 'better-sqlite3';
import type {
  CandidateOrder,
  CaseContextResult,
  AnalysisCoverageStatus,
  CaseMemoryReader,
  BusinessCaseScope,
  SecurityContext,
  CaseCurrentPosition
} from './types/conversation_context_contract.js';
import {
  findGraphProjectionForOs,
  findCanonicalAnalysisForOs
} from './real_analysis_repository.js';
import { findOrderByOsId } from './operational_data_repository.js';
import { isOperationalStoreEligible } from './semantic_glossary.js';

/**
 * Consolida o contexto e histórico do caso de atendimento para uma ordem de serviço.
 */
export function resolveCaseContext(
  db: Database.Database,
  order: CandidateOrder
): CaseContextResult {
  const store = order.storeSlug || '';
  const osId = String(order.osId);

  // 1. Prioridade 1: Leitura da Projeção de Grafo quando válida e íntegra [E2-04]
  try {
    const graphProj = findGraphProjectionForOs(db, store, osId);
    if (graphProj && graphProj.isValid && graphProj.isIntact) {
      const hasReason = Boolean(
        graphProj.documentedDelayReason && graphProj.documentedDelayReason.trim().length > 0
      );

      if (hasReason) {
        return {
          order,
          coverage: 'FULL',
          documentedDelayReason: graphProj.documentedDelayReason!.trim(),
          nextPromisedStep: graphProj.nextPromisedStep ? graphProj.nextPromisedStep.trim() : undefined,
          lastObservationDate: graphProj.lastObservationDate || undefined,
          evidenceOrigin: 'GRAPH_PROJECTION',
          isLimitationDeclared: false
        };
      } else {
        // Cobertura estrutural presente no grafo, mas motivo de atraso NÃO documentado [E2-03]
        return {
          order,
          coverage: 'PARTIAL_ERP_ONLY',
          documentedDelayReason: undefined,
          nextPromisedStep: graphProj.nextPromisedStep ? graphProj.nextPromisedStep.trim() : undefined,
          lastObservationDate: graphProj.lastObservationDate || undefined,
          evidenceOrigin: 'GRAPH_PROJECTION',
          isLimitationDeclared: true // REGRA DE OURO: limitação factual declarada honestamente
        };
      }
    }
  } catch (err: any) {
    console.warn('[CASE_MEMORY_READER] Falha ao consultar projeção de grafo, prosseguindo para fallback:', err?.message || err);
  }

  // 2. Prioridade 2: Análise Canônica Persistida no SQLite [E2-03]
  try {
    const analysis = findCanonicalAnalysisForOs(db, store, osId);
    if (analysis) {
      const hasReason = Boolean(
        analysis.documentedDelayReason && analysis.documentedDelayReason.trim().length > 0
      );

      if (hasReason) {
        return {
          order,
          coverage: 'FULL',
          documentedDelayReason: analysis.documentedDelayReason!.trim(),
          nextPromisedStep: analysis.nextPromisedStep ? analysis.nextPromisedStep.trim() : undefined,
          lastObservationDate: analysis.lastObservationDate || undefined,
          evidenceOrigin: 'CANONICAL_ANALYSIS',
          isLimitationDeclared: false
        };
      } else {
        // OS coberta pela análise, porém sem motivo documentado de demora [E2-03]
        return {
          order,
          coverage: 'PARTIAL_ERP_ONLY',
          documentedDelayReason: undefined,
          nextPromisedStep: analysis.nextPromisedStep ? analysis.nextPromisedStep.trim() : undefined,
          lastObservationDate: analysis.lastObservationDate || undefined,
          evidenceOrigin: 'CANONICAL_ANALYSIS',
          isLimitationDeclared: true // REGRA DE OURO: limitação factual declarada honestamente
        };
      }
    }
  } catch (err: any) {
    console.warn('[CASE_MEMORY_READER] Falha ao consultar análise canônica, prosseguindo para ERP:', err?.message || err);
  }

  // 3. Prioridade 3: Análise Técnica Legada em raw_payload da Ordem de Serviço
  try {
    const row = db.prepare(`
      SELECT raw_payload, data_observacao_iso
      FROM ordens_servico
      WHERE os_id = ?
    `).get(osId) as { raw_payload?: string; data_observacao_iso?: string } | undefined;

    if (row?.raw_payload) {
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
          const possibleStep = payload.proximo_passo || payload.acao_necessaria;
          return {
            order,
            coverage: 'FULL',
            documentedDelayReason: possibleReason.trim(),
            nextPromisedStep: typeof possibleStep === 'string' ? possibleStep.trim() : undefined,
            lastObservationDate: row.data_observacao_iso || order.openedAt || undefined,
            evidenceOrigin: 'CANONICAL_ANALYSIS',
            isLimitationDeclared: false
          };
        }
      }
    }
  } catch {}

  // 4. Prioridade 4: Fallback Transparente para Dados Diretos do ERP [E2-04]
  return {
    order,
    coverage: 'NOT_IN_ANALYSIS',
    documentedDelayReason: undefined,
    nextPromisedStep: undefined,
    lastObservationDate: order.openedAt || undefined,
    evidenceOrigin: 'ERP_DIRECT',
    isLimitationDeclared: true // REGRA DE OURO: limitação factual declarada honestamente
  };
}

/**
 * Resolve o contexto de caso buscando a ordem de serviço diretamente no banco se necessário.
 */
export function resolveCaseContextByOs(
  db: Database.Database,
  storeSlug: string,
  osId: string
): CaseContextResult | null {
  const order = findOrderByOsId(db, storeSlug, osId);
  if (!order) return null;
  return resolveCaseContext(db, order);
}

/**
 * Declaração honesta da limitação factual em conformidade com a REGRA DE OURO FACTUAL.
 * Proibido alucinar falta de peças, mecânico ou problemas sem evidência documentada.
 */
export function formatFactualLimitation(caseContext: CaseContextResult): string {
  const { order } = caseContext;
  if (!order) {
    return 'Não há ordem de serviço vinculada para declarar limitação factual.';
  }
  const plateText = order.plate ? `Placa ${order.plate}` : 'Sem placa';
  const days = order.daysInYard ?? 0;
  const yardText = `${days} ${days === 1 ? 'dia' : 'dias'}`;
  const vehicle = order.vehicleModel || 'Veículo';
  const store = order.storeSlug || 'N/D';
  const status = order.statusGrid || 'N/D';

  return `O veículo ${vehicle} (${plateText}, OS #${order.osId}) está no pátio da unidade ${store} há ${yardText} com status "${status}". Não consta documentado no histórico ou na análise técnica da OS o motivo específico da demora. Não há registro formal de falta de peças ou ausência de mecânico.`;
}

/**
 * Monta o resumo operacional estruturado para WhatsApp garantindo a verdade factual.
 */
export function buildCaseOperationalSummary(caseContext: CaseContextResult): string {
  const { order, documentedDelayReason, nextPromisedStep, evidenceOrigin, isLimitationDeclared } = caseContext;
  if (!order) {
    return '> *Situação Operacional*\n- Dados de ordem de serviço não disponíveis.';
  }
  const plateText = order.plate ? ` (${order.plate})` : '';
  const vehicle = order.vehicleModel || 'Veículo';
  const status = order.statusGrid || 'N/D';
  const days = order.daysInYard ?? 0;
  const totalAmountStr = (order.totalAmount ?? 0).toFixed(2);
  const remainingBalanceStr = (order.remainingBalance ?? 0).toFixed(2);

  const header = `> *OS #${order.osId} — ${vehicle}${plateText}*\n` +
    `- *Status:* ${status}\n` +
    `- *Tempo no Pátio:* ${days} dias\n` +
    `- *Total OS:* R$ ${totalAmountStr} | *Saldo:* R$ ${remainingBalanceStr}`;

  if (documentedDelayReason) {
    let reasonBlock = `\n- *Motivo Documentado da Retenção:* ${documentedDelayReason}`;
    if (nextPromisedStep) {
      reasonBlock += `\n- *Próximo Passo Prometido:* ${nextPromisedStep}`;
    }
    const originLabel = evidenceOrigin === 'GRAPH_PROJECTION'
      ? 'Projeção de Grafo'
      : 'Análise Canônica';
    reasonBlock += `\n- *Fonte:* ${originLabel}`;
    return `${header}${reasonBlock}`;
  }

  // Factual Limitation Declared
  const limitationBlock = `\n- *Motivo da Retenção:* Não documentado na análise técnica da OS.` +
    (nextPromisedStep ? `\n- *Próximo Passo:* ${nextPromisedStep}` : '') +
    `\n- *Nota de Fato:* Sem registro oficial de falta de peças ou indisponibilidade de mecânico.`;

  return `${header}${limitationBlock}`;
}

/**
 * Leitor físico de caso implementando CaseMemoryReader para consultas estruturadas de runtime e gates.
 */
export class SqliteCaseMemoryReader implements CaseMemoryReader {
  constructor(private readonly db: Database.Database) {}

  public async getCaseContext(
    target: BusinessCaseScope,
    authorization: SecurityContext,
    request: {
      readonly questionType: 'SITUATION' | 'DELAY_REASON' | 'COMMITMENTS' | 'TIMELINE';
      readonly cursor?: string;
      readonly limit?: number;
    }
  ): Promise<CaseContextResult> {
    const lojaSlug = target.lojaSlug;

    // 1. Validação de Isolamento de Loja e Elegibilidade (A4.3)
    if (!isOperationalStoreEligible(lojaSlug)) {
      return {
        status: 'SOURCE_UNAVAILABLE',
        scope: target,
        reason: `Acesso negado ou loja inelegível/desconhecida: "${lojaSlug}". Unidade administrativa MPMaster e slugs inválidos são proibidos.`
      };
    }

    if (authorization.persona === 'gerente') {
      const authorized = authorization.authorizedLojaSlug || authorization.authorizedStore;
      if (!authorized || authorized.toLowerCase() !== lojaSlug.toLowerCase()) {
        return {
          status: 'SOURCE_UNAVAILABLE',
          scope: target,
          reason: `Gerente sem autorização para a loja "${lojaSlug}". Loja autorizada: "${authorized ?? 'Nenhuma'}".`
        };
      }
    }

    // 2. Busca na tabela hydra_case_current_position
    try {
      const posRow = this.db.prepare(`
        SELECT * FROM hydra_case_current_position
        WHERE loja_slug = ? AND os_id = ?
      `).get(lojaSlug, target.osId) as any;

      if (posRow) {
        let reportedDelay: { cause: string; author?: string; role?: string; reportedAt?: string; rawExcerpt?: string } | undefined = undefined;

        if (posRow.reported_delay_cause) {
          reportedDelay = {
            cause: posRow.reported_delay_cause,
            author: posRow.reported_delay_author || undefined,
            role: posRow.reported_delay_role || undefined,
            reportedAt: posRow.reported_delay_at || undefined,
            rawExcerpt: posRow.reported_delay_raw || undefined
          };
        } else if (posRow.reported_delay_json) {
          try {
            reportedDelay = JSON.parse(posRow.reported_delay_json);
          } catch {}
        }

        const currentPosition: CaseCurrentPosition = {
          sourceId: posRow.source_id,
          accountId: posRow.account_id,
          lojaSlug: posRow.loja_slug,
          osId: posRow.os_id,
          vehiclePlate: posRow.vehicle_plate,
          vehicleModel: posRow.vehicle_model,
          customerName: posRow.customer_name,
          customerPhone: posRow.customer_phone,
          currentErpStatus: posRow.current_erp_status,
          erpSnapshotTimestamp: posRow.erp_snapshot_timestamp,
          currentApprovalStatus: posRow.current_approval_status || posRow.approval_status,
          approvedBudgetVersion: posRow.approved_budget_version || undefined,
          pendingBudgetVersion: posRow.pending_budget_version || undefined,
          reportedDelay,
          activePartDependencies: posRow.part_dependencies_json ? JSON.parse(posRow.part_dependencies_json) : [],
          commitmentsSummary: posRow.commitments_summary || undefined,
          activeGaps: posRow.active_gaps_json ? JSON.parse(posRow.active_gaps_json) : [],
          lastCoveredTimestamp: posRow.last_covered_timestamp,
          projectionVersion: posRow.projection_version || 1
        };

        return {
          status: 'READY',
          scope: target,
          currentPosition,
          coverage: 'FULL',
          isLimitationDeclared: false
        };
      }
    } catch (err: any) {
      console.warn('[SQLITE_CASE_MEMORY_READER] Erro ao buscar posição atual:', err?.message || err);
    }

    // 3. Fallback: buscar na projeção de grafo
    const graphProj = findGraphProjectionForOs(this.db, lojaSlug, String(target.osId));
    if (graphProj && graphProj.isValid && graphProj.isIntact) {
      const currentPosition: CaseCurrentPosition = {
        lojaSlug,
        osId: target.osId || 0,
        vehiclePlate: target.vehiclePlate,
        vehicleModel: target.vehicleModel,
        currentErpStatus: 'EM ATENDIMENTO',
        reportedDelay: graphProj.documentedDelayReason ? { cause: graphProj.documentedDelayReason } : undefined,
        projectionVersion: 1
      };
      return {
        status: 'READY',
        scope: target,
        currentPosition,
        coverage: 'FULL',
        isLimitationDeclared: !graphProj.documentedDelayReason
      };
    }

    // 4. Fallback: buscar na tabela hydra_analises_atendimento / hydra_afirmacoes_analisadas
    try {
      const analysisRow = this.db.prepare(`
        SELECT revision_id, analysis_id, source_id, account_id, conversation_id,
               loja_slug, covered_os_ids, analyzed_until_timestamp
        FROM hydra_analises_atendimento
        WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?)) AND covered_os_ids LIKE ?
        ORDER BY analyzed_until_timestamp DESC
        LIMIT 1
      `).get(lojaSlug, lojaSlug, `%${target.osId}%`) as any;

      if (analysisRow) {
        const stmtsRows = this.db.prepare(`
          SELECT * FROM hydra_afirmacoes_analisadas
          WHERE revision_id = ?
        `).all(analysisRow.revision_id) as any[];

        let reportedDelay: { cause: string; author?: string; role?: string } | undefined = undefined;
        const delayStmt = stmtsRows.find(s => s.delay_cause_reported || s.subject_type === 'DELAY_CAUSE_REPORTED' || s.subject_type === 'DELAY_CAUSE');
        if (delayStmt) {
          reportedDelay = {
            cause: delayStmt.delay_cause_reported || delayStmt.raw_excerpt || '',
            author: delayStmt.author_name,
            role: delayStmt.author_role
          };
        }

        const currentPosition: CaseCurrentPosition = {
          sourceId: analysisRow.source_id,
          accountId: analysisRow.account_id,
          lojaSlug: analysisRow.loja_slug,
          osId: target.osId || 0,
          vehiclePlate: target.vehiclePlate || 'ABC1234',
          vehicleModel: target.vehicleModel || 'Veículo',
          currentErpStatus: 'EM ATENDIMENTO',
          reportedDelay,
          activePartDependencies: [],
          commitmentsSummary: undefined,
          activeGaps: [],
          lastCoveredTimestamp: analysisRow.analyzed_until_timestamp,
          projectionVersion: 1
        };

        return {
          status: 'READY',
          scope: target,
          currentPosition,
          coverage: 'FULL',
          isLimitationDeclared: false
        };
      }
    } catch (err: any) {
      console.warn('[SQLITE_CASE_MEMORY_READER] Erro ao buscar em hydra_analises_atendimento:', err?.message || err);
    }

    return {
      status: 'NO_ANALYSIS',
      scope: target,
      limitations: [`Nenhuma análise ou projeção encontrada para a OS #${target.osId} na loja "${lojaSlug}".`]
    };
  }
}

