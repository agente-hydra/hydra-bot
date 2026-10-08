/**
 * src/hydra-sync/semantic_executor.ts
 * Executor Seguro de Consultas Semânticas no SQLite com Timeout, Ponderação e Propagação de Integridade.
 * 
 * Regras Cardinais:
 * 1. Timeout estrito de segurança (padrão 5.000ms) com cancelamento via db.interrupt().
 * 2. Cálculo ponderado obrigatório para razões e índices (ex: sum(custos) / sum(faturamento) * 100).
 * 3. Propagação de tags de integridade e dados parciais a partir do repositório de evidências.
 * 4. TypeScript strict — ZERO `any`.
 */

import Database from 'better-sqlite3';
import { performance } from 'node:perf_hooks';

import type {
  SemanticQueryPlan
} from './types/semantic_contract.js';

import type {
  CompiledParameterizedQuery
} from './semantic_compiler.js';

import {
  getStoreTableEvidence,
  type TableEvidenceRecord
} from './evidence_repository.js';

import {
  composeSemanticBalloons,
  formatCurrencyBRL,
  formatPercentBR,
  type SemanticReportSections
} from './balloon_composer.js';

export interface ExecutionOptions {
  timeoutMs?: number; // Padrão: 5.000ms
}

export interface SemanticExecutionResult {
  success: boolean;
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  compiledQuery: CompiledParameterizedQuery;
  coverage: 'full' | 'partial' | 'insufficient';
  isPartialData: boolean;
  partialDataWarning?: string;
  integrityTags: string[];
  metricsCalculated?: Record<string, number | null>;
  error?: string;
}

/**
 * Calcula a razão ponderada exata sobre uma coleção de registros.
 * Ex: CMV Ponderado = (SUM(custos) / SUM(faturamentos)) * 100
 */
export function calculateWeightedRatio(
  rows: Record<string, unknown>[],
  numeratorKey: string,
  denominatorKey: string,
  multiplier = 1
): number | null {
  if (!rows || rows.length === 0) return null;

  let sumNum = 0;
  let sumDen = 0;

  for (const row of rows) {
    const num = Number(row[numeratorKey]);
    const den = Number(row[denominatorKey]);

    if (!isNaN(num)) sumNum += num;
    if (!isNaN(den)) sumDen += den;
  }

  if (sumDen === 0) {
    return null;
  }

  return (sumNum / sumDen) * multiplier;
}

/**
 * Executa uma consulta compilada no SQLite WAL com timeout de segurança e rastreamento de evidências.
 */
export function executeSemanticQuery(
  db: Database.Database,
  compiled: CompiledParameterizedQuery,
  plan: SemanticQueryPlan,
  options?: ExecutionOptions
): SemanticExecutionResult {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const startTime = performance.now();
  const integrityTags: string[] = [];

  if (compiled.antiDuplicationEnforced) {
    integrityTags.push('ANTI_DUPLICACAO_1N_ENFORCED');
  }
  if (compiled.storeScopeFilterApplied) {
    integrityTags.push('STORE_SCOPE_APPLIED');
  }

  // 1. Armação do Timeout de Segurança com db.interrupt()
  let timerId: NodeJS.Timeout | null = null;
  let timedOut = false;

  timerId = setTimeout(() => {
    timedOut = true;
    try {
      const dbHandle = db as unknown as { interrupt?: () => void };
      if (typeof dbHandle.interrupt === 'function') {
        dbHandle.interrupt();
      }
    } catch {
      // Ignora erro se a conexão já estiver fechada
    }
  }, timeoutMs);

  try {
    const stmt = db.prepare(compiled.sql);
    const rows = stmt.all(...compiled.parameters) as Record<string, unknown>[];
    
    if (timerId) {
      clearTimeout(timerId);
    }

    const executionTimeMs = Number((performance.now() - startTime).toFixed(2));

    // 2. Avaliação de Evidências e Integridade das Tabelas Envolvidas
    const relevantTables = resolveRelevantTables(plan);
    const storeSlug = plan.securityScope.authorizedLojaSlug || extractStoreFromFilters(plan) || 'santo_andre';
    
    let isPartialData = false;
    let partialDataWarning: string | undefined = undefined;
    let coverage: 'full' | 'partial' | 'insufficient' = 'full';

    for (const table of relevantTables) {
      const evidence = getStoreTableEvidence(storeSlug, table, db);
      if (evidence) {
        if (evidence.coberturaStatus === 'PARCIAL') {
          isPartialData = true;
          coverage = 'partial';
          partialDataWarning = `Dados da tabela "${table}" possuem cobertura parcial para a unidade "${storeSlug}".`;
          integrityTags.push(`COBERTURA_PARCIAL_${table.toUpperCase()}`);
        } else if (evidence.coberturaStatus === 'AUSENTE') {
          isPartialData = true;
          coverage = 'insufficient';
          partialDataWarning = `Dados da tabela "${table}" estão ausentes no período para a unidade "${storeSlug}".`;
          integrityTags.push(`COBERTURA_AUSENTE_${table.toUpperCase()}`);
        }
      }
    }

    if (!isPartialData) {
      integrityTags.push('INTEGRIDADE_CONFIRMADA');
    }

    // 3. Cálculos Ponderados Pós-Consulta (se aplicável)
    const metricsCalculated: Record<string, number | null> = {};
    if (plan.metrics.includes('cmv_percentual') || plan.aggregations.some(a => a.metricId === 'cmv_percentual')) {
      const cmv = calculateWeightedRatio(rows, 'custo', 'faturamento', 100);
      metricsCalculated.cmv_percentual = cmv;
    }
    if (plan.metrics.includes('ticket_medio') || plan.aggregations.some(a => a.metricId === 'ticket_medio')) {
      const tm = calculateWeightedRatio(rows, 'total_os', 'volume_os', 1);
      metricsCalculated.ticket_medio = tm;
    }

    return {
      success: true,
      rows,
      rowCount: rows.length,
      executionTimeMs,
      compiledQuery: compiled,
      coverage,
      isPartialData,
      partialDataWarning,
      integrityTags,
      metricsCalculated
    };

  } catch (err: unknown) {
    if (timerId) {
      clearTimeout(timerId);
    }
    const executionTimeMs = Number((performance.now() - startTime).toFixed(2));
    const message = err instanceof Error ? err.message : String(err);

    if (timedOut || message.includes('interrupted')) {
      return {
        success: false,
        rows: [],
        rowCount: 0,
        executionTimeMs,
        compiledQuery: compiled,
        coverage: 'insufficient',
        isPartialData: true,
        error: `QUERY_TIMEOUT: Execução abortada pelo timeout de segurança (${timeoutMs}ms).`,
        integrityTags: ['TIMEOUT_ABORT']
      };
    }

    return {
      success: false,
      rows: [],
      rowCount: 0,
      executionTimeMs,
      compiledQuery: compiled,
      coverage: 'insufficient',
      isPartialData: true,
      error: `DATABASE_ERROR: ${message}`,
      integrityTags: ['EXECUTION_FAILED']
    };
  }
}

/**
 * Converte o resultado de execução semântica em balões nativos para o WhatsApp.
 */
export function formatExecutionResponse(
  result: SemanticExecutionResult,
  plan: SemanticQueryPlan
): string[] {
  if (!result.success) {
    const errorSection: SemanticReportSections = {
      directAnswer: `> *Não foi possível consultar os dados operacionais*\n- Motivo: ${result.error || 'Erro interno na camada de banco de dados.'}`,
      sourcePeriod: `_Tentativa em ${new Date().toLocaleTimeString('pt-BR')}._`
    };
    return composeSemanticBalloons(errorSection);
  }

  const rows = result.rows;
  const sections: SemanticReportSections = {};

  // Caso A: Consulta Agregada Simples (ex: Faturamento e Recebido do T29)
  if (rows.length === 1 && !plan.groupBy) {
    const row = rows[0];
    const totalFaturamento = Number(row.totalFaturamento ?? row.faturamento_bruto ?? row.total_os ?? 0);
    const totalRecebido = Number(row.totalRecebido ?? row.valor_pago ?? 0);
    const osCount = Number(row.osCount ?? row.volume_os ?? 0);

    const faturamentoStr = formatCurrencyBRL(totalFaturamento);
    const recebidoStr = formatCurrencyBRL(totalRecebido);

    sections.directAnswer = 
      `> *Resumo de Faturamento e Recebimentos*\n` +
      `- *Faturamento Total:* ${faturamentoStr} (${osCount} OSs)\n` +
      `- *Total Recebido:* ${recebidoStr}`;

    sections.resultReading = 
      `> *Leitura Operacional*\n` +
      `- ${osCount} ordens de serviço contabilizadas com integridade relacional garantida.`;

    // Se houver saldo restante
    const saldoRestante = totalFaturamento - totalRecebido;
    if (saldoRestante > 0) {
      sections.details = 
        `- *Saldo a Receber:* ${formatCurrencyBRL(saldoRestante)} pendente de quitação.`;
    }

    if (result.isPartialData && result.partialDataWarning) {
      sections.incompletenessDeclaration = 
        `> *Aviso de Incompletude de Dados*\n` +
        `- ${result.partialDataWarning}\n` +
        `- Os valores consolidados acima podem sofrer conciliação posterior.`;
    }

    sections.sourcePeriod = `> *Fonte:* Sistema Operacional Hydra • Tempo de resposta: ${result.executionTimeMs}ms`;
    return composeSemanticBalloons(sections);
  }

  // Caso B: Snapshot de Metas (T30)
  if (plan.primaryEntity === 'meta_diaria' && rows.length >= 1) {
    const row = rows[0];
    const faturamentoMes = Number(row.faturamento_mes ?? 0);
    const metaMes = Number(row.meta_mes ?? 0);
    const percentual = Number(row.percentual_meta ?? 0);
    const hora = String(row.posicao_hora ?? '');

    sections.directAnswer = 
      `> *Atingimento de Metas*\n` +
      `- *Faturamento Acumulado:* ${formatCurrencyBRL(faturamentoMes)}\n` +
      `- *Meta do Mês:* ${formatCurrencyBRL(metaMes)}\n` +
      `- *Atingimento:* ${formatPercentBR(percentual)}`;

    sections.resultReading = 
      `> *Posição da Captura*\n` +
      `- Foto apurada na posição das ${hora || 'última atualização'} sem soma acumulada de posições diárias.`;

    if (result.isPartialData) {
      sections.incompletenessDeclaration = 
        `> *Aviso de Incompletude*\n- Snapshot parcial da data de referência informada.`;
    }

    sections.sourcePeriod = `> *Fonte:* Registro Oficial de Metas Diárias`;
    return composeSemanticBalloons(sections);
  }

  // Caso C: Listagem de Itens / Agrupamentos
  const detailLines: string[] = [];
  for (const r of rows) {
    const label = String(r.responsavel ?? r.loja_slug ?? r.os_id ?? r.placa ?? 'Item');
    const valor = r.total_os !== undefined ? formatCurrencyBRL(Number(r.total_os)) : '';
    const recebido = r.totalRecebido !== undefined ? ` • Recebido: ${formatCurrencyBRL(Number(r.totalRecebido))}` : '';
    const qtd = r.osCount !== undefined || r.volume_os !== undefined ? ` • ${r.osCount ?? r.volume_os} OSs` : '';
    detailLines.push(`- *${label}:* ${valor}${qtd}${recebido}`);
  }

  sections.directAnswer = `> *Resultado da Consulta*\n- Encontrados ${rows.length} registros correspondentes.`;
  sections.details = detailLines.join('\n');

  if (result.isPartialData && result.partialDataWarning) {
    sections.incompletenessDeclaration = 
      `> *Declaração de Incompletude*\n- ${result.partialDataWarning}`;
  }

  sections.sourcePeriod = `> *Fonte:* Hydra WAL SQLite • Execução em ${result.executionTimeMs}ms`;
  return composeSemanticBalloons(sections);
}

/**
 * Identifica as tabelas envolvidas na consulta para checagem de evidência.
 */
function resolveRelevantTables(plan: SemanticQueryPlan): string[] {
  const tables: string[] = [];
  switch (plan.primaryEntity) {
    case 'ordem_servico':
      tables.push('ordens_servico');
      if (plan.relationsRequired.includes('os_pagamentos') || plan.metrics.includes('valor_pago')) {
        tables.push('pagamentos_os');
      }
      if (plan.relationsRequired.includes('os_pecas')) {
        tables.push('itens_pecas');
      }
      break;
    case 'meta_diaria':
      tables.push('metas_diarias');
      break;
    case 'faturamento_area':
      tables.push('faturamento_areas');
      break;
    case 'loja':
      tables.push('lojas');
      break;
    case 'veiculo':
      tables.push('ordens_servico');
      break;
  }
  return tables;
}

/**
 * Extrai loja especificada em filtros se houver.
 */
function extractStoreFromFilters(plan: SemanticQueryPlan): string | undefined {
  if (!plan.filters?.conditions) return undefined;
  for (const c of plan.filters.conditions) {
    if (!('logic' in c) && (c.dimensionOrMetricId === 'loja_slug' || c.dimensionOrMetricId === 'loja')) {
      if (typeof c.value === 'string') return c.value;
    }
  }
  return undefined;
}
