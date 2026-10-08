/**
 * src/hydra-sync/tests/test_semantic_interpretation.ts
 * Suíte de Testes de Interpretação Semântica e Amplitude Composicional do Hydra.
 * 
 * Cobre rigorosamente os 12 casos de teste de amplitude da spec hydra-semantic-layer:
 * 1. Múltiplos predicados em ordens abertas
 * 2. Anáfora e exclusão lógica contextual (NOT / Marcelo)
 * 3. Agrupamento por responsável e agregações de volume, valor e recebido
 * 4. Superlativo de ticket médio com filtro de faturadas no mês atual
 * 5. Comparação homóloga de queda entre lojas vs mês anterior
 * 6. Recorrência de veículo por placa em até 30 dias (sem inferir retrabalho)
 * 7. Interseção de OS encerrada com saldo pendente
 * 8. Predicado relacional com EXISTS e NOT_EXISTS em serviços
 * 9. Drill-down conciliatório de ordens que explicam faturamento
 * 10. Pergunta causal ("por que caiu?") com recusa de inferência causal
 * 11. Pergunta preditiva ("quanto vamos faturar?") com recusa de projeção
 * 12. Busca semântica vetorial com ressalva de amostras candidatas
 * 
 * + Testes adicionais de:
 * 13. Isolamento de escopo para persona 'gerente'
 * 14. Validação dos 8 elementos ontológicos e ponderação de métricas
 * 15. Árvore booleana aninhada (AND/OR/NOT)
 * 
 * Regra Cardinal: TypeScript strict — ZERO `any`.
 */

import assert from 'node:assert/strict';

import {
  buildSemanticQueryPlan,
  rewriteIntent
} from '../intent_rewriter.js';

import {
  ENTITIES_CATALOG,
  DIMENSIONS_CATALOG,
  METRICS_CATALOG,
  RELATIONS_CATALOG,
  TERMS_CATALOG,
  EVENTS_CATALOG,
  OPERATORS_CATALOG,
  AVAILABILITY_CATALOG,
  getOntologyMetric,
  getOntologyTerm
} from '../ontology_catalog.js';

import type {
  SemanticFilterCondition,
  SemanticFilterNode
} from '../types/semantic_contract.js';

let passed = 0;
let failed = 0;

function runTest(id: string, description: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`✅ [PASS] ${id} — ${description}`);
  } catch (err: unknown) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ [FAIL] ${id} — ${description}`);
    console.error(`         Erro: ${message}`);
  }
}

console.log('='.repeat(80));
console.log('🔬 HYDRA — SUÍTE DE TESTES DE INTERPRETAÇÃO E SEMÂNTICA DE NEGÓCIO');
console.log('='.repeat(80));

// ---------------------------------------------------------------------------
// TESTE 1: Múltiplos predicados em ordens abertas
// ---------------------------------------------------------------------------
runTest(
  'T01_MULTIPLE_PREDICATES',
  'Quais abertas há mais de 5 dias, acima de 2,5 mil e sem entrada?',
  () => {
    const question = 'Quais abertas há mais de 5 dias, acima de 2,5 mil e sem entrada?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.equal(plan.executionMode, 'exact_sql');
    assert.equal(plan.filters.logic, 'AND');

    const conds = plan.filters.conditions as SemanticFilterCondition[];

    // is_aberta = true
    const abertaCond = conds.find(c => c.dimensionOrMetricId === 'is_aberta');
    assert.ok(abertaCond, 'Deve conter filtro de is_aberta');
    assert.equal(abertaCond.operator, 'EQUALS');
    assert.equal(abertaCond.value, true);

    // dias_no_patio >= 5
    const diasCond = conds.find(c => c.dimensionOrMetricId === 'dias_no_patio');
    assert.ok(diasCond, 'Deve conter filtro de dias_no_patio');
    assert.equal(diasCond.operator, 'GREATER_EQUAL');
    assert.equal(diasCond.value, 5);

    // total_os >= 2500
    const valorCond = conds.find(c => c.dimensionOrMetricId === 'total_os');
    assert.ok(valorCond, 'Deve conter filtro de total_os');
    assert.equal(valorCond.operator, 'GREATER_EQUAL');
    assert.equal(valorCond.value, 2500);

    // valor_pago <= 0 (sem entrada)
    const entradaCond = conds.find(c => c.dimensionOrMetricId === 'valor_pago');
    assert.ok(entradaCond, 'Deve conter filtro de valor_pago');
    assert.equal(entradaCond.operator, 'LESS_EQUAL');
    assert.equal(entradaCond.value, 0);
  }
);

// ---------------------------------------------------------------------------
// TESTE 2: Anáfora contextual e exclusão lógica (NOT / Marcelo)
// ---------------------------------------------------------------------------
runTest(
  'T02_ANAPHORA_LOGICAL_EXCLUSION',
  'Das anteriores, exclua as aguardando peça e mantenha só as do Marcelo',
  () => {
    // 1o turno
    const prevPlan = buildSemanticQueryPlan('Quais abertas há mais de 5 dias, acima de 2,5 mil e sem entrada?');

    // 2o turno com referência anafórica
    const question = 'Das anteriores, exclua as aguardando peça e mantenha só as do Marcelo';
    const plan = buildSemanticQueryPlan(question, { previousPlan: prevPlan });

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.equal(plan.filters.logic, 'AND');

    // Deve herdar filtros anteriores
    const conds = plan.filters.conditions;
    const hasDias = conds.some(
      c => 'dimensionOrMetricId' in c && c.dimensionOrMetricId === 'dias_no_patio'
    );
    assert.ok(hasDias, 'Deve herdar filtro de dias_no_patio do turno anterior');

    // Deve conter nó NOT excluindo aguardando peça
    const notNode = conds.find(
      c => 'logic' in c && c.logic === 'NOT'
    ) as SemanticFilterNode | undefined;
    assert.ok(notNode, 'Deve conter nó NOT para exclusão');
    const innerCond = notNode.conditions[0] as SemanticFilterCondition;
    assert.equal(innerCond.dimensionOrMetricId, 'status_grid');
    assert.equal(innerCond.value, 'AGUARDANDO_PECA');

    // Deve conter filtro por Marcelo
    const marceloCond = conds.find(
      c => 'dimensionOrMetricId' in c && c.dimensionOrMetricId === 'responsavel_fechamento'
    ) as SemanticFilterCondition | undefined;
    assert.ok(marceloCond, 'Deve filtrar por responsável Marcelo');
    assert.equal(marceloCond.operator, 'LIKE');
    assert.match(String(marceloCond.value), /marcelo/i);
  }
);

// ---------------------------------------------------------------------------
// TESTE 3: Agrupamento por responsável com múltiplas métricas
// ---------------------------------------------------------------------------
runTest(
  'T03_GROUP_BY_RESPONSAVEL',
  'Agrupe por responsável: quantidade, valor das OS e recebido',
  () => {
    const question = 'Agrupe por responsável: quantidade, valor das OS e recebido';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.ok(plan.groupBy?.includes('responsavel_fechamento'), 'Deve agrupar por responsavel_fechamento');

    const aliases = plan.aggregations.map(a => a.alias);
    assert.ok(aliases.includes('quantidade'), 'Deve incluir agregação quantidade');
    assert.ok(aliases.includes('valor_das_os'), 'Deve incluir agregação valor_das_os');
    assert.ok(aliases.includes('recebido'), 'Deve incluir agregação recebido');

    // Relações que duplicariam não devem estar presentes
    assert.equal(plan.relationsRequired.length, 0, 'Não deve joinar tabelas 1:N de itens diretamente');
  }
);

// ---------------------------------------------------------------------------
// TESTE 4: Superlativo de ticket médio em faturadas no mês
// ---------------------------------------------------------------------------
runTest(
  'T04_HIGHEST_TICKET_MONTH',
  'Quem teve maior ticket, só das faturadas neste mês?',
  () => {
    const question = 'Quem teve maior ticket, só das faturadas neste mês?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.equal(plan.period?.type, 'mes_atual');

    // is_aberta = false
    const conds = plan.filters.conditions as SemanticFilterCondition[];
    const fechadaCond = conds.find(c => c.dimensionOrMetricId === 'is_aberta');
    assert.ok(fechadaCond, 'Deve filtrar apenas faturadas (is_aberta = false)');
    assert.equal(fechadaCond.value, false);

    // Métrica ticket médio com ordenação descendente e limite 1
    assert.ok(plan.metrics.includes('ticket_medio'));
    assert.equal(plan.orderBy?.[0].fieldId, 'ticket_medio');
    assert.equal(plan.orderBy?.[0].direction, 'DESC');
    assert.equal(plan.limit, 1);

    // Validação ontológica: ticket_medio exige agregação ponderada
    const metric = getOntologyMetric('ticket_medio');
    assert.ok(metric);
    assert.equal(metric.requiresWeightedAggregation, true);
  }
);

// ---------------------------------------------------------------------------
// TESTE 5: Comparação pareada homóloga entre lojas vs mês anterior
// ---------------------------------------------------------------------------
runTest(
  'T05_HOMOLOGOUS_COMPARISON_DROP',
  'Qual loja mais caiu contra o mesmo período do mês passado?',
  () => {
    const question = 'Qual loja mais caiu contra o mesmo período do mês passado?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'loja');
    assert.equal(plan.period?.type, 'mes_atual');
    assert.equal(plan.period?.comparisonPeriod?.type, 'mes_anterior_homologo');
    assert.ok(plan.groupBy?.includes('loja_slug'));
    assert.equal(plan.orderBy?.[0].fieldId, 'variacao_absoluta');
    assert.equal(plan.orderBy?.[0].direction, 'ASC');
    assert.equal(plan.limit, 1);
  }
);

// ---------------------------------------------------------------------------
// TESTE 6: Recorrência de veículo em até 30 dias (sem inferir retrabalho)
// ---------------------------------------------------------------------------
runTest(
  'T06_VEHICLE_RECURRENCY_30_DAYS',
  'Quais clientes voltaram com o mesmo carro em até 30 dias?',
  () => {
    const question = 'Quais clientes voltaram com o mesmo carro em até 30 dias?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'veiculo');
    assert.ok(plan.groupBy?.includes('placa'));
    assert.ok(plan.relationsRequired.includes('os_veiculo'));

    // Filtro de intervalo <= 30 dias
    const conds = plan.filters.conditions as SemanticFilterCondition[];
    const intervalCond = conds.find(c => c.dimensionOrMetricId === 'dias_entre_os');
    assert.ok(intervalCond);
    assert.equal(intervalCond.operator, 'LESS_EQUAL');
    assert.equal(intervalCond.value, 30);

    // Declaração expressa contra alucinação de retrabalho
    assert.match(
      plan.clarificationReason || '',
      /Sem inferir retrabalho/i,
      'Deve declarar explicitamente que não infere retrabalho'
    );
  }
);

// ---------------------------------------------------------------------------
// TESTE 7: OS encerrada com saldo restante
// ---------------------------------------------------------------------------
runTest(
  'T07_CLOSED_OS_WITH_REMAINING_BALANCE',
  'Tem encerrada com saldo restante?',
  () => {
    const question = 'Tem encerrada com saldo restante?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.equal(plan.filters.logic, 'AND');

    const conds = plan.filters.conditions as SemanticFilterCondition[];

    // is_aberta = false
    const abertaCond = conds.find(c => c.dimensionOrMetricId === 'is_aberta');
    assert.ok(abertaCond);
    assert.equal(abertaCond.value, false);

    // saldo_restante > 0
    const saldoCond = conds.find(c => c.dimensionOrMetricId === 'saldo_restante');
    assert.ok(saldoCond);
    assert.equal(saldoCond.operator, 'GREATER_THAN');
    assert.equal(saldoCond.value, 0);
  }
);

// ---------------------------------------------------------------------------
// TESTE 8: Predicado relacional com EXISTS e NOT_EXISTS em serviços
// ---------------------------------------------------------------------------
runTest(
  'T08_RELATIONAL_EXISTS_NOT_EXISTS',
  'Serviço de câmbio sem troca de óleo',
  () => {
    const question = 'Serviço de câmbio sem troca de óleo';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.ok(plan.relationsRequired.includes('os_servicos'));
    assert.equal(plan.executionStrategy, 'exists_subquery');

    const conds = plan.filters.conditions as SemanticFilterCondition[];

    // EXISTS cambio
    const existsCond = conds.find(c => c.operator === 'EXISTS');
    assert.ok(existsCond, 'Deve conter operador EXISTS');
    assert.equal(existsCond.value, 'cambio');

    // NOT_EXISTS oleo
    const notExistsCond = conds.find(c => c.operator === 'NOT_EXISTS');
    assert.ok(notExistsCond, 'Deve conter operador NOT_EXISTS');
    assert.equal(notExistsCond.value, 'oleo');
  }
);

// ---------------------------------------------------------------------------
// TESTE 9: Drill-down conciliatório de ordens que explicam faturamento
// ---------------------------------------------------------------------------
runTest(
  'T09_DRILL_DOWN_RECONCILIATION',
  'Quais ordens explicam esse faturamento?',
  () => {
    const question = 'Quais ordens explicam esse faturamento?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.primaryEntity, 'ordem_servico');
    assert.equal(plan.period?.type, 'mes_atual');
    assert.ok(plan.dimensions.includes('os_id'));
    assert.ok(plan.dimensions.includes('total_os'));
    assert.ok(plan.dimensions.includes('data_fechamento'));
    assert.equal(plan.orderBy?.[0].fieldId, 'total_os');
    assert.equal(plan.orderBy?.[0].direction, 'DESC');
  }
);

// ---------------------------------------------------------------------------
// TESTE 10: Pergunta causal ("por que caiu?") com recusa de causalidade
// ---------------------------------------------------------------------------
runTest(
  'T10_CAUSAL_QUESTION_HANDLING',
  'Por que caiu?',
  () => {
    const question = 'Por que caiu?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.executionMode, 'clarify');
    assert.equal(plan.causalDecomposition, true);
    assert.match(
      plan.clarificationReason || '',
      /Pergunta causal identificada.*não infere causalidade automática/i,
      'Deve declarar que não infere causalidade e oferecer decomposição factual'
    );
  }
);

// ---------------------------------------------------------------------------
// TESTE 11: Pergunta preditiva ("quanto vamos faturar mês que vem?")
// ---------------------------------------------------------------------------
runTest(
  'T11_PREDICTIVE_QUESTION_REFUSAL',
  'Quanto vamos faturar mês que vem?',
  () => {
    const question = 'Quanto vamos faturar mês que vem?';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.executionMode, 'clarify');
    assert.match(
      plan.clarificationReason || '',
      /Pergunta preditiva não suportada.*dados históricos/i,
      'Deve recusar categoricamente estimativas futuras'
    );
  }
);

// ---------------------------------------------------------------------------
// TESTE 12: Busca semântica vetorial (amostras candidatas)
// ---------------------------------------------------------------------------
runTest(
  'T12_SEMANTIC_SEARCH_SAMPLE_DISCLAIMER',
  'Casos parecidos com esse vazamento',
  () => {
    const question = 'Casos parecidos com esse vazamento';
    const plan = buildSemanticQueryPlan(question);

    assert.equal(plan.searchSampleOnly, true);
    assert.equal(plan.executionMode, 'mcp_tool');
    assert.match(
      plan.clarificationReason || '',
      /amostras candidatas.*nunca como total exaustivo/i,
      'Deve declarar que resultados são amostras candidatas'
    );
  }
);

// ---------------------------------------------------------------------------
// TESTE 13: Isolamento estrito de escopo de loja para Persona Gerente
// ---------------------------------------------------------------------------
runTest(
  'T13_SECURITY_SCOPE_MANAGER_INJECTION',
  'Injeção obrigatória de loja autorizada para persona gerente',
  () => {
    const question = 'Quais ordens abertas temos hoje?';
    const plan = buildSemanticQueryPlan(question, {
      securityScope: {
        persona: 'gerente',
        authorizedLojaSlug: 'MPSantoAndre',
        authorizedPhones: ['5511999999999']
      }
    });

    assert.equal(plan.securityScope.persona, 'gerente');
    assert.equal(plan.securityScope.authorizedLojaSlug, 'MPSantoAndre');

    const conds = plan.filters.conditions as SemanticFilterCondition[];
    const lojaCond = conds.find(c => c.dimensionOrMetricId === 'loja_slug');
    assert.ok(lojaCond, 'Deve conter filtro de loja_slug');
    assert.equal(lojaCond.value, 'MPSantoAndre');
  }
);

// ---------------------------------------------------------------------------
// TESTE 14: Integridade dos 8 elementos ontológicos e métricas ponderadas
// ---------------------------------------------------------------------------
runTest(
  'T14_ONTOLOGY_8_ELEMENTS_INTEGRITY',
  'Validação dos 8 elementos formais e flag requiresWeightedAggregation',
  () => {
    // 1. Entidades
    assert.ok(ENTITIES_CATALOG.loja);
    assert.ok(ENTITIES_CATALOG.ordem_servico);
    assert.ok(ENTITIES_CATALOG.veiculo);
    assert.ok(ENTITIES_CATALOG.meta_diaria);
    assert.ok(ENTITIES_CATALOG.faturamento_area);

    // 2. Dimensões
    assert.ok(DIMENSIONS_CATALOG.status_grid);
    assert.ok(DIMENSIONS_CATALOG.dias_no_patio);

    // 3. Métricas
    const cmv = getOntologyMetric('cmv_percentual');
    assert.ok(cmv);
    assert.equal(cmv.requiresWeightedAggregation, true, 'CMV deve exigir agregação ponderada');

    const ticket = getOntologyMetric('ticket_medio');
    assert.ok(ticket);
    assert.equal(ticket.requiresWeightedAggregation, true, 'Ticket Médio deve exigir agregação ponderada');

    const meta = getOntologyMetric('percentual_meta');
    assert.ok(meta);
    assert.equal(meta.requiresWeightedAggregation, true, 'Percentual de Meta deve exigir agregação ponderada');

    // 4. Relações com risco 1:N
    assert.equal(RELATIONS_CATALOG.os_pecas.multiplicationRisk, true);
    assert.equal(RELATIONS_CATALOG.os_pagamentos.multiplicationRisk, true);
    assert.equal(RELATIONS_CATALOG.os_servicos.multiplicationRisk, true);

    // 5. Termos rigorosos
    const semSinal = getOntologyTerm('sem_sinal');
    assert.ok(semSinal);
    assert.ok(semSinal.nonEquivalences.length > 0);
    assert.ok(semSinal.caveat);

    const parado = getOntologyTerm('parado');
    assert.ok(parado);
    assert.ok(parado.nonEquivalences.length > 0);

    const atrasado = getOntologyTerm('atrasado');
    assert.ok(atrasado);

    // 6. Eventos
    assert.ok(EVENTS_CATALOG.data_abertura);
    assert.ok(EVENTS_CATALOG.data_fechamento);

    // 7. Operadores
    assert.ok(OPERATORS_CATALOG.EQUALS);
    assert.ok(OPERATORS_CATALOG.EXISTS);
    assert.ok(OPERATORS_CATALOG.NOT_EXISTS);

    // 8. Disponibilidade
    assert.ok(AVAILABILITY_CATALOG.ordens_servico);
    assert.ok(AVAILABILITY_CATALOG.pagamentos_os);
  }
);

// ---------------------------------------------------------------------------
// TESTE 15: Precedência e Árvore Booleana Aninhada (AND/OR/NOT)
// ---------------------------------------------------------------------------
runTest(
  'T15_NESTED_BOOLEAN_TREE',
  'Construção e tipagem estrita de árvore booleana complexa',
  () => {
    const complexTree: SemanticFilterNode = {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: true },
        {
          logic: 'OR',
          conditions: [
            { dimensionOrMetricId: 'total_os', operator: 'GREATER_THAN', value: 2000 },
            {
              logic: 'NOT',
              conditions: [
                { dimensionOrMetricId: 'status_grid', operator: 'EQUALS', value: 'CANCELADA' }
              ]
            }
          ]
        }
      ]
    };

    assert.equal(complexTree.logic, 'AND');
    assert.equal(complexTree.conditions.length, 2);
    const orNode = complexTree.conditions[1] as SemanticFilterNode;
    assert.equal(orNode.logic, 'OR');
    const notNode = orNode.conditions[1] as SemanticFilterNode;
    assert.equal(notNode.logic, 'NOT');
  }
);

// ---------------------------------------------------------------------------
// TESTE 16: Desambiguação de Lojas ("rei" e "sbc")
// ---------------------------------------------------------------------------
runTest(
  'T16_STORE_AMBIGUITY_RESOLUTION',
  'Detecção de ambiguidade em termos genéricos de loja ("rei")',
  () => {
    const plan = buildSemanticQueryPlan('Como estão as vendas do Rei hoje?');
    assert.equal(plan.executionMode, 'clarify');
    assert.match(plan.clarificationReason || '', /ambíguo/i);
  }
);

// ---------------------------------------------------------------------------
// RESUMO FINAL
// ---------------------------------------------------------------------------
console.log('='.repeat(80));
console.log(`📊 RESULTADO FINAL: ${passed} APROVADOS / ${failed} FALHAS`);
if (failed === 0) {
  console.log('🎉 100% PASS — TODOS OS REQUISITOS SEMÂNTICOS ATENDIDOS COM SUCESSO!');
} else {
  console.error('⚠️ EXISTEM FALHAS A CORRIGIR!');
  process.exit(1);
}
console.log('='.repeat(80));
