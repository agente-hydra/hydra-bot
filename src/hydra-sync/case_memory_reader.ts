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
  AnalysisCoverageStatus
} from './types/conversation_context_contract.js';
import {
  findGraphProjectionForOs,
  findCanonicalAnalysisForOs
} from './real_analysis_repository.js';
import { findOrderByOsId } from './operational_data_repository.js';

/**
 * Consolida o contexto e histórico do caso de atendimento para uma ordem de serviço.
 */
export function resolveCaseContext(
  db: Database.Database,
  order: CandidateOrder
): CaseContextResult {
  const store = order.storeSlug;
  const osId = order.osId;

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

  // 3. Prioridade 3: Fallback Transparente para Dados Diretos do ERP [E2-04]
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
  const plateText = order.plate ? `Placa ${order.plate}` : 'Sem placa';
  const yardText = `${order.daysInYard} ${order.daysInYard === 1 ? 'dia' : 'dias'}`;

  return `O veículo ${order.vehicleModel} (${plateText}, OS #${order.osId}) está no pátio da unidade ${order.storeSlug} há ${yardText} com status "${order.statusGrid}". Não consta documentado no histórico ou na análise técnica da OS o motivo específico da demora. Não há registro formal de falta de peças ou ausência de mecânico.`;
}

/**
 * Monta o resumo operacional estruturado para WhatsApp garantindo a verdade factual.
 */
export function buildCaseOperationalSummary(caseContext: CaseContextResult): string {
  const { order, documentedDelayReason, nextPromisedStep, evidenceOrigin, isLimitationDeclared } = caseContext;
  const plateText = order.plate ? ` (${order.plate})` : '';

  const header = `> *OS #${order.osId} — ${order.vehicleModel}${plateText}*\n` +
    `- *Status:* ${order.statusGrid}\n` +
    `- *Tempo no Pátio:* ${order.daysInYard} dias\n` +
    `- *Total OS:* R$ ${order.totalAmount.toFixed(2)} | *Saldo:* R$ ${order.remainingBalance.toFixed(2)}`;

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
