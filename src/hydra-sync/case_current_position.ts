/**
 * Hydra — Redutor de Estado da Posição Atual (State Reducer Cumulativo)
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 3 (Grafo e Projeção)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import {
  CaseCurrentPosition,
  ExtractedStatement,
  ConversationGap
} from './types/conversation_context_contract';
import { EvidencePolicyManager } from './evidence_policy_manager';

export interface ReducePositionInput {
  readonly sourceId: string;
  readonly accountId: string;
  readonly lojaSlug: string;
  readonly osId: number;
  readonly vehiclePlate: string;
  readonly vehicleModel: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly currentErpStatus: string;
  readonly erpSnapshotTimestamp: string;
  readonly statements: readonly ExtractedStatement[];
  readonly gaps: readonly ConversationGap[];
  readonly appliedRevisionsMap: Record<string, string>;
  readonly projectionVersion?: number;
}

export class CaseCurrentPositionReducer {
  /**
   * Deriva deterministicamente a posição atual a partir do histórico completo de fatos vigentes.
   * Aplica:
   * 1. Subtração de quantidades de peças recebidas (A4.1)
   * 2. Separação de aprovação por versão de orçamento (A4.1)
   * 3. Rastreamento de autoria de atraso e compromissos
   */
  public static reduce(input: ReducePositionInput): CaseCurrentPosition {
    // 1. Ordenar afirmações cronologicamente por timestamp do evento
    const sortedStmts = [...input.statements].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // 2. Mapa de fatos superseded
    const supersededFactIds = new Set<string>();
    for (const stmt of sortedStmts) {
      if (stmt.supersedesFactId) {
        supersededFactIds.add(stmt.supersedesFactId);
      }
    }

    // Filtrar apenas fatos ativos não superados
    const activeStmts = sortedStmts.filter(s => {
      const factId = s.factId || `fact_${s.statementId}`;
      return !supersededFactIds.has(factId);
    });

    // 3. Processar Peças com Rastreamento de Saldo de Quantidades (A4.1)
    interface PartState {
      factId: string;
      partName: string;
      partCode?: string;
      quantityPending: number;
      orderRef?: string;
      requestedAt: string;
    }

    const activePartsMap = new Map<string, PartState>();

    // 4. Estados de Aprovação e Orçamento (A4.1)
    let approvedBudgetVersion: string | undefined = undefined;
    let pendingBudgetVersion: string | undefined = undefined;
    let approvalStatus: 'PENDING' | 'APPROVED' | 'REFUSED' | 'UNKNOWN' = 'UNKNOWN';

    // 5. Demora e Compromissos
    let reportedDelay: CaseCurrentPosition['reportedDelay'] = undefined;
    const commitments: string[] = [];
    let lastCoveredMessageId: number | undefined = undefined;
    let lastCoveredTimestamp = input.erpSnapshotTimestamp;

    for (const stmt of activeStmts) {
      if (stmt.messageId !== null && (lastCoveredMessageId === undefined || stmt.messageId > lastCoveredMessageId)) {
        lastCoveredMessageId = stmt.messageId;
      }
      if (new Date(stmt.timestamp) > new Date(lastCoveredTimestamp)) {
        lastCoveredTimestamp = stmt.timestamp;
      }

      // 3a. Espera de Peça (PART_DEPENDENCY)
      if (stmt.subject === 'PART_DEPENDENCY') {
        const factId = stmt.factId || `fact_${stmt.statementId}`;
        const partName = stmt.partReference?.partName || 'Peça';
        const partCode = stmt.partReference?.partCode;
        const qtyRequested = stmt.partReference?.quantityRequested || 1;
        const key = partCode ? partCode.trim().toLowerCase() : partName.trim().toLowerCase();

        activePartsMap.set(key, {
          factId,
          partName,
          partCode,
          quantityPending: qtyRequested,
          orderRef: stmt.partReference?.orderRef,
          requestedAt: stmt.timestamp
        });
      }

      // 3b. Chegada de Peça (PART_ARRIVAL)
      if (stmt.subject === 'PART_ARRIVAL') {
        const partCode = stmt.partReference?.partCode;
        const partName = stmt.partReference?.partName || '';
        const qtyArrived = stmt.partReference?.quantityArrived || 1;
        const key = partCode ? partCode.trim().toLowerCase() : partName.trim().toLowerCase();

        const existing = activePartsMap.get(key);
        if (existing) {
          const remaining = Math.max(0, existing.quantityPending - qtyArrived);
          if (remaining === 0) {
            activePartsMap.delete(key);
          } else {
            activePartsMap.set(key, {
              ...existing,
              quantityPending: remaining
            });
          }
        }
      }

      // 4a. Dependência de Aprovação de Orçamento (APPROVAL_DEPENDENCY)
      if (stmt.subject === 'APPROVAL_DEPENDENCY') {
        pendingBudgetVersion = stmt.budgetVersion || 'v1';
        approvalStatus = 'PENDING';
      }

      // 4b. Aprovação do Cliente (CLIENT_APPROVAL)
      if (stmt.subject === 'CLIENT_APPROVAL') {
        const approvedVer = stmt.budgetVersion || 'v1';
        approvedBudgetVersion = approvedVer;

        // Se a versão aprovada confere com a versão pendente, encerra a pendência
        if (pendingBudgetVersion === approvedVer) {
          pendingBudgetVersion = undefined;
          approvalStatus = 'APPROVED';
        } else if (!pendingBudgetVersion) {
          approvalStatus = 'APPROVED';
        } else {
          // Há complemento de orçamento pendente de versão superior (A4.1)
          approvalStatus = 'PENDING';
        }
      }

      // 4c. Recusa do Cliente (CLIENT_REFUSAL)
      if (stmt.subject === 'CLIENT_REFUSAL') {
        approvalStatus = 'REFUSED';
      }

      // 5a. Causa de Demora (DELAY_CAUSE_REPORTED)
      if (stmt.subject === 'DELAY_CAUSE_REPORTED' || stmt.delayCauseReported) {
        reportedDelay = {
          cause: stmt.delayCauseReported || stmt.rawExcerpt,
          authorName: stmt.authorName,
          authorRole: stmt.authorRole,
          reportedAt: stmt.timestamp,
          rawExcerpt: stmt.rawExcerpt
        };
      }

      // 5b. Compromissos e Repactuações
      if (stmt.subject === 'ATTENDANT_COMMITMENT' || stmt.subject === 'DELIVERY_PROMISE_CHANGE') {
        commitments.push(`[${stmt.timestamp.substring(11, 16)}] ${stmt.rawExcerpt}`);
      }
    }

    const activePartDependencies = Array.from(activePartsMap.values()).map(p => ({
      factId: p.factId,
      partName: p.partName,
      partCode: p.partCode,
      quantityPending: p.quantityPending,
      orderRef: p.orderRef,
      requestedAt: p.requestedAt
    }));

    return {
      sourceId: input.sourceId,
      accountId: input.accountId,
      lojaSlug: input.lojaSlug,
      osId: input.osId,
      vehiclePlate: input.vehiclePlate,
      vehicleModel: input.vehicleModel,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      currentErpStatus: input.currentErpStatus,
      erpSnapshotTimestamp: input.erpSnapshotTimestamp,
      approvalStatus,
      approvedBudgetVersion,
      pendingBudgetVersion,
      reportedDelay,
      activePartDependencies,
      latestCommitments: commitments.slice(-3),
      activeGaps: input.gaps,
      lastCoveredTimestamp,
      appliedRevisionsMap: input.appliedRevisionsMap,
      projectionVersion: input.projectionVersion || 1
    };
  }
}
