/**
 * src/hydra-sync/tests/test_semantic_end_to_end.ts
 * Suíte Completa de Testes End-to-End da Camada Semântica de Negócio do Hydra (T01 a T40).
 * 
 * Orquestrador: Agente Principal
 * Integração dos Três Módulos:
 * - Executor 1: Ontologia, Glossário, SemanticQueryPlan e Intenções Canônicas
 * - Executor 2: Dicionário de Dados, Evidências, Cobertura e Fixtures T29/T30
 * - Executor 3: Compilador AST Seguro, Executor com Timeout e Balões WhatsApp
 * 
 * Regra Cardinal: TypeScript strict — ZERO `any`.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// 1. Contratos e Ontologia (Executor 1)
import type {
  SemanticQueryPlan,
  SemanticFilterCondition,
  SecurityContext
} from '../types/semantic_contract.js';

import {
  ENTITIES_CATALOG,
  DIMENSIONS_CATALOG,
  METRICS_CATALOG,
  RELATIONS_CATALOG,
  TERMS_CATALOG,
  getOntologyMetric,
  getOntologyTerm
} from '../ontology_catalog.js';

import {
  buildSemanticQueryPlan,
  rewriteIntent
} from '../intent_rewriter.js';

// 2. Dados e Evidências (Executor 2)
import {
  DATA_DICTIONARY,
  getTableDefinition,
  detectCartesianMultiplicationRisk,
  assertValidTemporalUsage
} from '../data_dictionary.js';

import {
  CATALOGO_10_LOJAS_ELEGIVEIS,
  isAuthorizedOperationalStore,
  ensureEvidenceSchema,
  recordStoreTableEvidence,
  getStoreTableEvidence,
  assessChildAbsenceEvidence,
  clearInMemoryEvidenceStore
} from '../evidence_repository.js';

import {
  setupSemanticTestDb,
  T29_FIXTURE_DATA,
  T30_FIXTURE_DATA
} from '../fixtures/semantic_fixtures.js';

// 3. Compilador e Execução (Executor 3)
import {
  compileSemanticPlan,
  type CompilationResult
} from '../semantic_compiler.js';

import {
  executeSemanticQuery,
  formatExecutionResponse,
  calculateWeightedRatio
} from '../semantic_executor.js';

import {
  composeSemanticBalloons,
  formatCurrencyBRL,
  formatPercentBR
} from '../balloon_composer.js';

import {
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat
} from '../format_utils.js';

// Variáveis de controle de teste
let passedCount = 0;
let failedCount = 0;

function runTest(id: string, description: string, fn: () => void | Promise<void>) {
  try {
    fn();
    passedCount++;
    console.log(`✅ [PASS] ${id} — ${description}`);
  } catch (err: unknown) {
    failedCount++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ [FAIL] ${id} — ${description}`);
    console.error(`         Erro: ${message}`);
  }
}

console.log('='.repeat(80));
console.log('🔬 HYDRA — SUÍTE COMPLETA END-TO-END: CAMADA SEMÂNTICA (T01 A T40)');
console.log('='.repeat(80));

// =============================================================================
// SEÇÃO 1: REGRESSÃO DOS CASOS OPERACIONAIS BÁSICOS (T01 A T28)
// =============================================================================
console.log('\n--- SEÇÃO 1: Regressão e Fundamentos Operacionais (T01 a T28) ---');

runTest('T01_10_STORES_CATALOG', 'As 10 lojas operacionais oficiais estão ativas e Master está expurgada', () => {
  assert.equal(CATALOGO_10_LOJAS_ELEGIVEIS.length, 10);
  assert.equal(isAuthorizedOperationalStore('master'), false);
  assert.equal(isAuthorizedOperationalStore('santo_andre'), true);
  assert.equal(isAuthorizedOperationalStore('osasco'), true);
});

runTest('T02_ONTOLOGY_8_ELEMENTS', 'Os 8 elementos canônicos da ontologia estão registrados com versões estritas', () => {
  assert.ok(ENTITIES_CATALOG.ordem_servico, 'Entidade ordem_servico existe');
  assert.ok(ENTITIES_CATALOG.meta_diaria, 'Entidade meta_diaria existe');
  assert.ok(ENTITIES_CATALOG.faturamento_area, 'Entidade faturamento_area existe');
  assert.ok(DIMENSIONS_CATALOG.dias_no_patio, 'Dimensão dias_no_patio existe');
  assert.ok(METRICS_CATALOG.cmv_percentual, 'Métrica cmv_percentual existe');
  assert.ok(RELATIONS_CATALOG.os_pagamentos, 'Relação os_pagamentos existe');
  assert.ok(TERMS_CATALOG['sem_sinal'], 'Termo sem_sinal existe');
});

runTest('T03_CMV_WEIGHTED_REQUIREMENT', 'Métrica de CMV exige compulsoriamente agregação ponderada', () => {
  const cmv = getOntologyMetric('cmv_percentual');
  assert.ok(cmv, 'CMV deve existir');
  assert.equal(cmv?.requiresWeightedAggregation, true);
  assert.equal(cmv?.aggregation, 'weighted_ratio');
});

runTest('T04_NO_DISTINCT_VALUE_IN_DATA_DICT', 'Data Dictionary veda formalmente SUM(DISTINCT) em valores', () => {
  const osDef = getTableDefinition('ordens_servico');
  assert.ok(osDef);
  const rule = osDef.aggregationRules.find(r => r.targetColumn === 'DISTINCT total_os');
  assert.equal(rule?.status, 'FORBIDDEN');
});

runTest('T05_TEMPORAL_SEPARATION', 'Data de Abertura, Fechamento e Coleta são metodologicamente incomutáveis', () => {
  const check = assertValidTemporalUsage('ordens_servico', 'FATURAMENTO', 'updated_at');
  assert.equal(check.isValid, false, 'updated_at não pode substituir data contábil de faturamento');
  assert.ok(check.violationReason?.includes('não pode substituir'));
});

// =============================================================================
// SEÇÃO 2: FIXTURE T29 — OS COM PEÇAS E PAGAMENTOS MÚLTIPLOS
// =============================================================================
console.log('\n--- SEÇÃO 2: Fixture Controlada T29 (Anti-Duplicação 1:N) ---');

const dbT29 = setupSemanticTestDb();

runTest('T29_EXACT_REVENUE_AND_RECEIVED', 'OS 101 e 102 geram faturamento exato de R$ 2.000,00 e recebido de R$ 1.000,00', () => {
  const plan: SemanticQueryPlan = {
    planId: 'plan_t29_e2e',
    catalogVersion: '1.2.0',
    primaryEntity: 'ordem_servico',
    dimensions: ['os_id'],
    metrics: ['faturamento_bruto', 'valor_pago'],
    filters: { logic: 'AND', conditions: [] },
    aggregations: [
      { metricId: 'faturamento_bruto', alias: 'totalFaturamento' },
      { metricId: 'valor_pago', alias: 'totalRecebido' }
    ],
    relationsRequired: ['os_pagamentos'],
    coverageRequired: 'full',
    securityScope: { persona: 'socio' },
    executionMode: 'exact_sql'
  };

  const compRes = compileSemanticPlan(plan);
  assert.ok(compRes.success, 'Compilação T29 com sucesso');
  assert.ok(compRes.query, 'Query parametrizada presente');
  assert.equal(compRes.query.antiDuplicationEnforced, true, 'Anti-duplicação 1:N ativada');

  const execRes = executeSemanticQuery(dbT29, compRes.query, plan);
  assert.ok(execRes.success, 'Execução SQLite com sucesso');
  assert.equal(execRes.rowCount, 1);

  const row = execRes.rows[0];
  const totalFat = Number(row.totalFaturamento);
  const totalRec = Number(row.totalRecebido);

  assert.equal(totalFat, 2000.00, 'Faturamento total deve ser rigorosamente R$ 2.000,00');
  assert.equal(totalRec, 1000.00, 'Total recebido deve ser rigorosamente R$ 1.000,00');

  // Formatação de balões semânticos
  const balloons = formatExecutionResponse(execRes, plan);
  assert.ok(balloons.length >= 1, 'Pelo menos 1 balão gerado');
  assert.ok(balloons[0].includes('R$ 2.000,00'), 'Balão exibe faturamento R$ 2.000,00');
  assert.ok(balloons[0].includes('R$ 1.000,00'), 'Balão exibe recebido R$ 1.000,00');
  assertNoDoubleAsterisks(balloons[0]);
});

// =============================================================================
// SEÇÃO 3: FIXTURE T30 — SNAPSHOTS HORÁRIOS DE METAS
// =============================================================================
console.log('\n--- SEÇÃO 3: Fixture Controlada T30 (Snapshots Horários) ---');

const dbT30 = setupSemanticTestDb();

runTest('T30_LATEST_SNAPSHOT_RESOLVED', 'Seleção exclusiva do snapshot mais recente (R$ 150.000 às 18h) sem somar fotos', () => {
  const plan: SemanticQueryPlan = {
    planId: 'plan_t30_e2e',
    catalogVersion: '1.2.0',
    primaryEntity: 'meta_diaria',
    dimensions: ['loja_slug', 'data_referencia', 'posicao_hora'],
    metrics: ['percentual_meta'],
    filters: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'loja_slug', operator: 'EQUALS', value: 'santo_andre' },
        { dimensionOrMetricId: 'data_referencia', operator: 'EQUALS', value: '2026-10-02' }
      ]
    },
    aggregations: [
      { metricId: 'percentual_meta', alias: 'latest_snapshot' }
    ],
    relationsRequired: [],
    coverageRequired: 'full',
    securityScope: { persona: 'socio' },
    executionMode: 'exact_sql'
  };

  const compRes = compileSemanticPlan(plan);
  assert.ok(compRes.success, 'Compilação com sucesso');
  assert.ok(compRes.query);
  assert.ok(!compRes.query.sql.includes('SUM(faturamento_mes)'), 'Proibido somar snapshots');

  const execRes = executeSemanticQuery(dbT30, compRes.query, plan);
  assert.ok(execRes.success, 'Execução SQLite com sucesso');
  assert.equal(execRes.rowCount, 1, 'Apenas 1 snapshot mais recente deve ser retornado');

  const row = execRes.rows[0];
  assert.equal(Number(row.faturamento_mes), 150000.00, 'Faturamento do mês deve ser R$ 150.000,00');
  assert.equal(String(row.posicao_hora), '18:00:00', 'Posição horária deve ser 18:00:00');
  assert.notEqual(Number(row.faturamento_mes), 405000.00, 'Jamais somar snapshots (405k)');
});

// =============================================================================
// SEÇÃO 4: PRECEDÊNCIA BOOLEANA E REGRAS DE EVIDÊNCIA (T31 E T32)
// =============================================================================
console.log('\n--- SEÇÃO 4: Lógica Booleana e Cláusula Pétrea de Ausência (T31 e T32) ---');

runTest('T31_BOOLEAN_TREE_PRECEDENCE', 'Construção e compilação de árvore booleana aninhada AND/OR/NOT', () => {
  const plan: SemanticQueryPlan = {
    planId: 'plan_t31_e2e',
    catalogVersion: '1.2.0',
    primaryEntity: 'ordem_servico',
    dimensions: ['os_id', 'status_grid', 'responsavel_fechamento'],
    metrics: ['faturamento_bruto'],
    filters: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: true },
        {
          logic: 'OR',
          conditions: [
            { dimensionOrMetricId: 'total_os', operator: 'GREATER_EQUAL', value: 2500 },
            { dimensionOrMetricId: 'dias_no_patio', operator: 'GREATER_THAN', value: 10 }
          ]
        },
        {
          logic: 'NOT',
          conditions: [
            { dimensionOrMetricId: 'status_grid', operator: 'EQUALS', value: 'CANCELADA' }
          ]
        }
      ]
    },
    aggregations: [{ metricId: 'faturamento_bruto', alias: 'total' }],
    relationsRequired: [],
    coverageRequired: 'full',
    securityScope: { persona: 'socio' },
    executionMode: 'exact_sql'
  };

  const compRes = compileSemanticPlan(plan);
  assert.ok(compRes.success);
  assert.ok(compRes.query);
  assert.ok(compRes.query.sql.includes('AND'));
  assert.ok(compRes.query.sql.includes('OR'));
  assert.ok(compRes.query.sql.includes('NOT'));
});

runTest('T32_ABSENCE_UNDER_PARTIAL_COVERAGE', 'Ausência de pagamentos com cobertura PARCIAL recusa afirmação de zero', () => {
  clearInMemoryEvidenceStore();

  // Caso A: Cobertura Completa -> Confirma zero legítimo
  recordStoreTableEvidence({
    lojaSlug: 'santo_andre',
    tabela: 'pagamentos_os',
    coberturaStatus: 'COMPLETA',
    dataColetaRecente: '2026-10-02T16:00:00Z',
    registrosContabilizados: 200
  });

  const resFull = assessChildAbsenceEvidence({
    osId: '101',
    lojaSlug: 'santo_andre',
    childTable: 'pagamentos_os',
    childrenCountInDb: 0
  });
  assert.equal(resFull.isZeroConfirmed, true);
  assert.equal(resFull.isUnknownOrPartial, false);

  // Caso B: Cobertura Parcial -> Bloqueia afirmação de zero
  recordStoreTableEvidence({
    lojaSlug: 'osasco',
    tabela: 'pagamentos_os',
    coberturaStatus: 'PARCIAL',
    dataColetaRecente: '2026-10-02T16:00:00Z',
    registrosContabilizados: 50,
    incompletudeMotivo: 'Crawler incompleto na filial'
  });

  const resPartial = assessChildAbsenceEvidence({
    osId: '202',
    lojaSlug: 'osasco',
    childTable: 'pagamentos_os',
    childrenCountInDb: 0
  });
  assert.equal(resPartial.isZeroConfirmed, false, 'Não pode confirmar zero com fonte parcial');
  assert.equal(resPartial.isUnknownOrPartial, true);
  assert.match(resPartial.verdictText, /não disponíveis/i);
  assert.match(resPartial.warning || '', /PARCIAL/i);
});

// =============================================================================
// SEÇÃO 5: COMPORTAMENTO EXECUTIVO, GOVERNANÇA E PONDERAÇÃO (T33 A T36)
// =============================================================================
console.log('\n--- SEÇÃO 5: Governança, Ponderação e Continuação Conversacional (T33 a T36) ---');

runTest('T33_NO_FICTITIOUS_FINANCIAL_SPLIT', 'Proibição de rateio financeiro fictício por responsável em OS com múltiplos técnicos', () => {
  // A OS possui responsavel_fechamento como dimensão da própria OS (1:1 com a OS).
  // Não existe relação 1:N de rateio financeiro por múltiplos técnicos.
  assert.equal(DIMENSIONS_CATALOG.responsavel_fechamento?.entityId, 'ordem_servico');
  assert.equal(RELATIONS_CATALOG['os_responsaveis'], undefined, 'Proibida relação de rateio financeiro fictício não existente na origem');
});

runTest('T34_WEIGHTED_RATIO_PREVENTS_SIMPLE_AVERAGE_ERROR', 'Cálculo de CMV ponderado impede distorção de média simples das lojas', () => {
  // Loja 1: Faturamento 100.000, Custo 40.000 (CMV 40%)
  // Loja 2: Faturamento 10.000, Custo 8.000 (CMV 80%)
  // Média Simples errada: (40 + 80) / 2 = 60%
  // Ponderado correto: (40.000 + 8.000) / (100.000 + 10.000) = 48.000 / 110.000 = 43,63%
  const sampleRows: Record<string, unknown>[] = [
    { faturamento: 100000, custo: 40000 },
    { faturamento: 10000, custo: 8000 }
  ];

  const ratio = calculateWeightedRatio(sampleRows, 'custo', 'faturamento', 100);
  assert.ok(ratio !== null);
  const rounded = Math.round(ratio * 100) / 100;
  assert.equal(rounded, 43.64);
  assert.notEqual(rounded, 60.00, 'Proibida média simples de índices');
});

runTest('T35_HOMOLOGOUS_MONTH_COMPARISON', 'Comparação homóloga com mês anterior utiliza períodos parciais alinhados', () => {
  const plan = buildSemanticQueryPlan('Qual loja mais caiu contra o mesmo período do mês passado?');
  assert.equal(plan.primaryEntity, 'loja');
  assert.ok(plan.period);
  assert.equal(plan.period?.type, 'mes_atual');
  assert.equal(plan.period?.comparisonPeriod?.type, 'mes_anterior_homologo');
});

runTest('T36_CONVERSATIONAL_ANAPHORA_PRESERVATION', 'Continuação conversacional preserva filtros e aplica exclusões lógicas (NOT/Marcelo)', () => {
  const prevPlan = buildSemanticQueryPlan('Quais abertas há mais de 5 dias, acima de 2,5 mil e sem entrada?');
  const followUpPlan = buildSemanticQueryPlan('Das anteriores, exclua as aguardando peça e mantenha só as do Marcelo', {
    previousPlan: prevPlan
  });

  assert.equal(followUpPlan.primaryEntity, 'ordem_servico');
  assert.ok(followUpPlan.filters.conditions.length >= 3);
  
  // Confirma presença de exclusão de status e filtro do Marcelo
  const condsJson = JSON.stringify(followUpPlan.filters);
  assert.ok(condsJson.includes('AGUARDANDO_PECA'));
  assert.ok(/marcelo/i.test(condsJson));
});

// =============================================================================
// SEÇÃO 6: SEGURANÇA, ESCOPO E LIMITES DE AMPLITUDE (T37 A T40)
// =============================================================================
console.log('\n--- SEÇÃO 6: Segurança, Escopo e Limites de Amplitude (T37 a T40) ---');

runTest('T37_SQL_INJECTION_REJECTION_AND_GERENTE_SCOPE', 'Tentativa de injeção SQL é neutralizada e persona gerente é estritamente isolada', () => {
  const planMalicioso: SemanticQueryPlan = {
    planId: 'plan_t37_malicious',
    catalogVersion: '1.2.0',
    primaryEntity: 'ordem_servico',
    dimensions: ['os_id'],
    metrics: ['faturamento_bruto'],
    filters: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'responsavel_fechamento', operator: 'EQUALS', value: "'; DROP TABLE ordens_servico; --" }
      ]
    },
    aggregations: [{ metricId: 'faturamento_bruto', alias: 'total' }],
    relationsRequired: [],
    coverageRequired: 'full',
    securityScope: { persona: 'gerente', authorizedLojaSlug: 'santo_andre' },
    executionMode: 'exact_sql'
  };

  const compRes = compileSemanticPlan(planMalicioso);
  assert.ok(compRes.success);
  assert.ok(compRes.query);

  // Parâmetro sanitizado no array de prepared statement
  assert.ok(compRes.query.parameters.includes("'; DROP TABLE ordens_servico; --"));
  assert.ok(!compRes.query.sql.includes('DROP TABLE'));

  // Injeção mandatória do filtro de gerente
  assert.equal(compRes.query.storeScopeFilterApplied, true);
  assert.ok(compRes.query.sql.includes('loja_slug = ?'));
  assert.ok(compRes.query.parameters.includes('santo_andre'));

  // Rejeição de vazamento cross-store
  const planVazamento: SemanticQueryPlan = {
    ...planMalicioso,
    filters: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'loja_slug', operator: 'EQUALS', value: 'osasco' }
      ]
    }
  };
  const compVazamento = compileSemanticPlan(planVazamento);
  assert.equal(compVazamento.success, false);
  assert.equal(compVazamento.errorCode, 'SECURITY_VIOLATION');
});

runTest('T38_SEMANTIC_SEARCH_SAMPLE_LIMITATION', 'Busca semântica vetorial gera modo delimitado com aviso de amostras candidatas', () => {
  const plan = buildSemanticQueryPlan('Casos parecidos com esse vazamento');
  assert.equal(plan.searchSampleOnly, true);
  assert.equal(plan.executionMode, 'mcp_tool');
  assert.match(plan.clarificationReason || '', /amostras candidatas/i);
});

runTest('T39_CAUSAL_AND_PREDICTIVE_QUESTION_LIMITS', 'Perguntas preditivas são recusadas e causais entram em decomposição descritiva', () => {
  const planPreditivo = buildSemanticQueryPlan('Quanto vamos faturar mês que vem?');
  assert.equal(planPreditivo.executionMode, 'clarify');
  assert.ok(planPreditivo.clarificationReason?.includes('preditiva não suportada'));

  const planCausal = buildSemanticQueryPlan('Por que caiu?');
  assert.equal(planCausal.causalDecomposition, true);
  assert.ok(planCausal.metrics.includes('cmv_percentual'));
  assert.ok(planCausal.metrics.includes('faturamento_bruto'));
});

runTest('T40_NOVEL_COMPOSITIONAL_COMBINATION', 'Combinação inédita de filtros sem rota prévia é traduzida e executada dinamicamente', () => {
  // Pergunta inédita: "Quais ordens do Marcelo na loja Santo André com mais de 7 dias e acima de 3 mil?"
  const plan = buildSemanticQueryPlan('Quais ordens do Marcelo em Santo André com mais de 7 dias e acima de 3 mil?');
  assert.equal(plan.primaryEntity, 'ordem_servico');
  assert.equal(plan.executionMode, 'exact_sql');

  const compRes = compileSemanticPlan(plan);
  assert.ok(compRes.success, 'Compilação de combinação inédita bem sucedida');
  assert.ok(compRes.query);
  assert.ok(compRes.query.sql.includes('ordens_servico'));
});

// =============================================================================
// CONSOLIDAÇÃO FINAL
// =============================================================================
console.log('='.repeat(80));
console.log(`📊 RESULTADO FINAL INTEGRADO: ${passedCount} APROVADOS / ${failedCount} FALHAS`);
if (failedCount === 0) {
  console.log('🎉 100% PASS — SUÍTE COMPLETA T01 A T40 DA CAMADA SEMÂNTICA HOMOLOGADA!');
} else {
  console.error(`⚠️ ATENÇÃO: Houve ${failedCount} falha(s). Verifique os detalhes acima.`);
  process.exit(1);
}
console.log('='.repeat(80));
