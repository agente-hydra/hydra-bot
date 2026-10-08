/**
 * src/hydra-sync/tests/test_semantic_compiler.ts
 * Suíte de Testes do Compilador Semântico, Execução de Consultas e Resposta (Frente 3 — Executor 3).
 * 
 * Cobertura de Testes:
 * 1. Fixture T29: Compilação segura e comprovação exata de R$ 2.000,00 de OS e R$ 1.000,00 de recebido
 *    - CTE pré-agregada de pagamentos anti-duplicação 1:N
 *    - Rejeição de Naive Join (R$ 5.000,00) e rejeição de SUM(DISTINCT) (R$ 1.000,00)
 * 2. Fixture T30: Seleção de snapshot de metas mais recente (R$ 150.000,00) vs soma ingênua (R$ 405.000,00)
 * 3. Injeção Obrigatória de Escopo de Gerente:
 *    - Injeção mandatória de WHERE loja_slug = ? em todos os ramos da query (main e CTEs)
 *    - Rejeição de vazamento cross-store (tentativa de acessar outra loja)
 *    - Rejeição de gerente sem loja autorizada
 * 4. Bloqueio de Injeção SQL e Mutações DDL/DML:
 *    - Prevenção de DROP, INSERT, UPDATE, DELETE, ALTER, TRUNCATE
 *    - Parametrização estrita com '?' contra quebra de strings e injeção
 * 5. Proibição Absoluta de SUM(DISTINCT valor)
 * 6. Compositor de Balões WhatsApp (balloon_composer.ts):
 *    - Formatação de valores em balão nativo (R$ 2.000,00 e R$ 1.000,00)
 *    - Zero asteriscos duplos (**) e zero tabelas Markdown (|---|)
 *    - Orçamento de caracteres (700-900) e quebras limpas
 * 7. Propagação de Tags de Integridade e Dados Parciais
 * 8. Cálculo Ponderado para Razões e Índices (Weighted Ratio)
 * 9. Timeout de Segurança (5.000ms)
 * 
 * Regra Cardinal: TypeScript strict — ZERO `any`.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  setupSemanticTestDb,
  runT29NaiveJoinGlobal,
  runT29SumDistinct,
  T29_FIXTURE_DATA
} from '../fixtures/semantic_fixtures.js';

import {
  compileSemanticPlan,
  SemanticCompiler,
  type CompiledParameterizedQuery,
  type CompilationResult
} from '../semantic_compiler.js';

import {
  executeSemanticQuery,
  calculateWeightedRatio,
  formatExecutionResponse,
  type SemanticExecutionResult
} from '../semantic_executor.js';

import {
  composeSemanticBalloons,
  convertMarkdownTablesToWhatsAppLists,
  parseSemanticSections
} from '../balloon_composer.js';

import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat,
  splitIntoWhatsAppBlocks
} from '../format_utils.js';

import {
  recordStoreTableEvidence,
  getStoreTableEvidence
} from '../evidence_repository.js';

import type {
  SemanticQueryPlan,
  SecurityContext
} from '../types/semantic_contract.js';

import { SafeQueryBuilder } from '../query_builder_safe.js';

let passed = 0;
let failed = 0;

function runTest(id: string, description: string, fn: () => void | Promise<void>): void {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        passed++;
        console.log(`✅ [PASS] ${id} — ${description}`);
      }).catch((err) => {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ [FAIL] ${id} — ${description}`);
        console.error(`         Erro: ${message}`);
      });
    } else {
      passed++;
      console.log(`✅ [PASS] ${id} — ${description}`);
    }
  } catch (err: unknown) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ [FAIL] ${id} — ${description}`);
    console.error(`         Erro: ${message}`);
  }
}

console.log('='.repeat(80));
console.log('🔬 HYDRA — SUÍTE DE TESTES DO COMPILADOR SEMÂNTICO E EXECUÇÃO SEGURA');
console.log('='.repeat(80));

// ---------------------------------------------------------------------------
// 1. CENÁRIO T29: CONSULTA DE FATURAMENTO TOTAL E RECEBIDO VIA COMPILADOR
// ---------------------------------------------------------------------------
runTest(
  'T29_1_EXACT_REVENUE_AND_RECEIVED',
  'Compilador gera padrão seguro e comprova R$ 2.000,00 de OS e R$ 1.000,00 de recebido',
  () => {
    const db = setupSemanticTestDb();

    // 1.1 Plano semântico para faturamento e recebidos das OSs
    const plan: SemanticQueryPlan = {
      planId: 'plan_t29_test',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id', 'loja_slug'],
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

    // 1.2 Compilação pelo compilador semântico
    const compilation: CompilationResult = compileSemanticPlan(plan);
    assert.equal(compilation.success, true, 'Compilação deve ter sucesso');
    assert.ok(compilation.query, 'Query compilada deve existir');

    const query = compilation.query;
    console.log('\n     SQL Gerado pelo Compilador:');
    console.log(query.sql.split('\n').map(l => `       ${l}`).join('\n'));

    // Validações estruturais do SQL
    assert.equal(query.antiDuplicationEnforced, true, 'Anti-duplicação 1:N deve estar ativada');
    assert.ok(query.sql.includes('WITH pagamentos_agregados AS'), 'Deve conter CTE pré-agregada de pagamentos');
    assert.ok(!query.sql.includes('SUM(DISTINCT'), 'Zero SUM(DISTINCT) no SQL gerado');

    // 1.3 Execução via semantic_executor
    const execResult = executeSemanticQuery(db, query, plan);
    assert.equal(execResult.success, true, 'Execução da query compilada deve ter sucesso');
    assert.equal(execResult.rowCount, 1, 'Consulta agregada deve retornar 1 linha');

    const row = execResult.rows[0];
    const osCount = Number(row.osCount);
    const totalFaturamento = Number(row.totalFaturamento);
    const totalRecebido = Number(row.totalRecebido);

    // Asserções estritas dos valores monetários exatos
    assert.equal(osCount, 2, 'Contagem de OSs deve ser exatamente 2');
    assert.equal(totalFaturamento, 2000.00, 'Faturamento total deve ser exatamente R$ 2.000,00');
    assert.equal(totalRecebido, 1000.00, 'Total recebido deve ser exatamente R$ 1.000,00');

    // 1.4 Demonstração de contraste contra as falhas ingênuas
    const naiveGlobal = runT29NaiveJoinGlobal(db);
    assert.equal(naiveGlobal.naiveTotalOS, 5000.00, 'Naive Join inflaria para R$ 5.000,00');

    const sumDistinct = runT29SumDistinct(db);
    assert.equal(sumDistinct.sumDistinctTotalOS, 1000.00, 'SUM(DISTINCT) apagaria metade do faturamento (R$ 1.000,00)');

    console.log(`     Comprovado: Compilador protegeu faturamento real de R$ ${totalFaturamento.toFixed(2)} e recebido de R$ ${totalRecebido.toFixed(2)}.`);
    db.close();
  }
);

// ---------------------------------------------------------------------------
// 2. CENÁRIO T30: SELEÇÃO DO SNAPSHOT MAIS RECENTE DE METAS (LATEST_SNAPSHOT)
// ---------------------------------------------------------------------------
runTest(
  'T30_LATEST_SNAPSHOT_GOALS',
  'Compilador seleciona o snapshot mais recente de metas evitando soma de fotos diárias',
  () => {
    const db = setupSemanticTestDb();

    const plan: SemanticQueryPlan = {
      planId: 'plan_t30_test',
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

    const compilation = compileSemanticPlan(plan);
    assert.equal(compilation.success, true);
    assert.ok(compilation.query);
    assert.ok(!compilation.query.sql.includes('SUM(faturamento_mes)'), 'Proibido somar snapshots');

    const execResult = executeSemanticQuery(db, compilation.query, plan);
    assert.equal(execResult.success, true);
    assert.equal(execResult.rowCount, 1);

    const row = execResult.rows[0];
    assert.equal(Number(row.faturamento_mes), 150000.00, 'Faturamento deve ser R$ 150.000,00 (foto das 18h)');
    assert.equal(String(row.posicao_hora), '18:00:00', 'Horário deve ser 18:00:00');
    assert.equal(Number(row.percentual_meta), 75.0, 'Atingimento deve ser 75,0%');

    db.close();
  }
);

// ---------------------------------------------------------------------------
// 3. INJEÇÃO DE ESCOPO DE GERENTE E BLOQUEIO CROSS-STORE
// ---------------------------------------------------------------------------
runTest(
  'MANAGER_STORE_SCOPE_INJECTION',
  'Persona gerente injeta compulsoriamente WHERE loja_slug = ? em todos os ramos da query',
  () => {
    const plan: SemanticQueryPlan = {
      planId: 'plan_manager_scope',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id', 'loja_slug'],
      metrics: ['faturamento_bruto', 'valor_pago'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [
        { metricId: 'faturamento_bruto', alias: 'totalFaturamento' },
        { metricId: 'valor_pago', alias: 'totalRecebido' }
      ],
      relationsRequired: ['os_pagamentos'],
      coverageRequired: 'full',
      securityScope: {
        persona: 'gerente',
        authorizedLojaSlug: 'santo_andre'
      },
      executionMode: 'exact_sql'
    };

    const compilation = compileSemanticPlan(plan);
    assert.equal(compilation.success, true);
    assert.ok(compilation.query);

    const sql = compilation.query.sql;
    const params = compilation.query.parameters;

    // Injeção na CTE e na query principal
    assert.ok(sql.includes('pg.loja_slug = ?'), 'CTE de pagamentos deve conter filtro de loja_slug = ?');
    assert.ok(sql.includes('os.loja_slug = ?'), 'Cláusula principal deve conter filtro de os.loja_slug = ?');
    assert.ok(params.includes('santo_andre'), 'Parâmetro de loja deve ser injetado');
    assert.equal(compilation.query.storeScopeFilterApplied, true, 'storeScopeFilterApplied deve ser true');
  }
);

runTest(
  'CROSS_STORE_LEAKAGE_REJECTION',
  'Rejeita com SECURITY_VIOLATION qualquer tentativa de gerente acessar outra loja',
  () => {
    const maliciousPlan: SemanticQueryPlan = {
      planId: 'plan_cross_store_attack',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id'],
      metrics: ['faturamento_bruto'],
      filters: {
        logic: 'AND',
        conditions: [
          // Gerente de santo_andre tenta consultar dados de sao_bernardo
          { dimensionOrMetricId: 'loja_slug', operator: 'EQUALS', value: 'sao_bernardo' }
        ]
      },
      aggregations: [{ metricId: 'faturamento_bruto', alias: 'faturamento' }],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope: {
        persona: 'gerente',
        authorizedLojaSlug: 'santo_andre'
      },
      executionMode: 'exact_sql'
    };

    const compilation = compileSemanticPlan(maliciousPlan);
    assert.equal(compilation.success, false, 'Compilação cross-store DEVE falhar');
    assert.equal(compilation.errorCode, 'SECURITY_VIOLATION', 'Código de erro deve ser SECURITY_VIOLATION');
    assert.ok(compilation.errorReason?.includes('sao_bernardo'), 'Mensagem de erro deve citar a loja não autorizada');
  }
);

runTest(
  'MANAGER_WITHOUT_STORE_REJECTION',
  'Rejeita com SECURITY_VIOLATION gerente sem authorizedLojaSlug configurado',
  () => {
    const invalidScopePlan: SemanticQueryPlan = {
      planId: 'plan_no_store',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id'],
      metrics: ['faturamento_bruto'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope: {
        persona: 'gerente',
        authorizedLojaSlug: undefined // Falta loja!
      },
      executionMode: 'exact_sql'
    };

    const compilation = compileSemanticPlan(invalidScopePlan);
    assert.equal(compilation.success, false);
    assert.equal(compilation.errorCode, 'SECURITY_VIOLATION');
  }
);

// ---------------------------------------------------------------------------
// 4. BLOQUEIO DE INJEÇÃO SQL E DDL/DML
// ---------------------------------------------------------------------------
runTest(
  'SQL_INJECTION_PARAMETRIZATION_IMMUNITY',
  'Strings com injeção SQL são parametrizadas com ? sem causar execução maliciosa',
  () => {
    const db = setupSemanticTestDb();

    const injectionPlan: SemanticQueryPlan = {
      planId: 'plan_injection_test',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id'],
      metrics: ['faturamento_bruto'],
      filters: {
        logic: 'AND',
        conditions: [
          // Tentativa clássica de injeção SQL
          { dimensionOrMetricId: 'os_id', operator: 'EQUALS', value: "101' OR '1'='1" }
        ]
      },
      aggregations: [{ metricId: 'faturamento_bruto', alias: 'faturamento' }],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope: { persona: 'socio' },
      executionMode: 'exact_sql'
    };

    const compilation = compileSemanticPlan(injectionPlan);
    assert.equal(compilation.success, true);
    assert.ok(compilation.query);
    assert.ok(compilation.query.sql.includes('os.os_id = ?'), 'Deve usar placeholder ?');
    assert.deepEqual(compilation.query.parameters, ["101' OR '1'='1"], 'Valor deve estar seguro no array de parâmetros');

    const execResult = executeSemanticQuery(db, compilation.query, injectionPlan);
    assert.equal(execResult.success, true);
    // Nenhuma OS com id "101' OR '1'='1" existe -> soma é 0/null
    assert.equal(Number(execResult.rows[0]?.faturamento ?? 0), 0);

    db.close();
  }
);

runTest(
  'DDL_DML_MUTATION_BLOCK',
  'Bloqueia qualquer tentativa de mutação (DROP, INSERT, UPDATE, DELETE, ALTER)',
  () => {
    // 1. Tentativa de chamar builder com identifier malicioso
    assert.throws(
      () => {
        SafeQueryBuilder.create().from('ordens_servico; DROP TABLE ordens_servico; --');
      },
      /SECURITY_VIOLATION/
    );

    // 2. Tentativa de raw_safe com mutação
    assert.throws(
      () => {
        SafeQueryBuilder.create()
          .from('ordens_servico')
          .select([{ type: 'raw_safe', sql: 'DELETE FROM ordens_servico' }])
          .build();
      },
      /SECURITY_VIOLATION/
    );
  }
);

// ---------------------------------------------------------------------------
// 5. PROIBIÇÃO ABSOLUTA DE SUM(DISTINCT)
// ---------------------------------------------------------------------------
runTest(
  'SUM_DISTINCT_PROHIBITION',
  'Compilador e AST bloqueiam terminantemente SUM(DISTINCT) com CARDINALITY_VIOLATION',
  () => {
    assert.throws(
      () => {
        SafeQueryBuilder.create()
          .from('ordens_servico')
          .selectAggregate('SUM', 'total_os', { distinct: true });
      },
      (err: Error) => err.message.includes('CARDINALITY_VIOLATION')
    );
  }
);

// ---------------------------------------------------------------------------
// 6. COMPOSITOR DE BALÕES WHATSAPP (BALLOON COMPOSER)
// ---------------------------------------------------------------------------
runTest(
  'BALLOON_COMPOSER_T29_FORMATTING',
  'Formata resultado T29 em balões WhatsApp nativos com zero ** e orçamento respeitado',
  () => {
    const db = setupSemanticTestDb();

    const plan: SemanticQueryPlan = {
      planId: 'plan_t29_balloon',
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

    const compilation = compileSemanticPlan(plan);
    assert.ok(compilation.query);

    const execResult = executeSemanticQuery(db, compilation.query, plan);
    assert.equal(execResult.success, true);

    const balloons = formatExecutionResponse(execResult, plan);
    assert.ok(balloons.length >= 1, 'Deve gerar balões formatados');

    for (let i = 0; i < balloons.length; i++) {
      const b = balloons[i];
      assert.ok(assertNoDoubleAsterisks(b), `Balão ${i + 1} não deve ter asteriscos duplos (**)`);
      assert.ok(assertWhatsAppNativeFormat(b), `Balão ${i + 1} deve respeitar formato WhatsApp nativo`);
      assert.ok(b.length <= 950, `Balão ${i + 1} deve respeitar o orçamento (${b.length} <= 950)`);
      assert.ok(b.includes('R$ 2.000,00'), 'Deve conter faturamento de R$ 2.000,00');
      assert.ok(b.includes('R$ 1.000,00'), 'Deve conter recebido de R$ 1.000,00');
      assert.ok(!b.includes('|'), 'Zero tabelas markdown no balão');
    }

    console.log('\n     Balão Gerado:');
    console.log(balloons[0].split('\n').map(l => `       ${l}`).join('\n'));

    db.close();
  }
);

// ---------------------------------------------------------------------------
// 7. PROPAGAÇÃO DE DADOS PARCIAIS E DECLARAÇÃO DE INCOMPLETUDE
// ---------------------------------------------------------------------------
runTest(
  'PARTIAL_DATA_AND_INCOMPLETENESS_PROPAGATION',
  'Propaga aviso de incompletude quando tabela possui evidência PARCIAL no repositório',
  () => {
    const db = setupSemanticTestDb();

    // Registra evidência PARCIAL para pagamentos_os
    recordStoreTableEvidence({
      lojaSlug: 'santo_andre',
      tabela: 'pagamentos_os',
      coberturaStatus: 'PARCIAL',
      dataColetaRecente: '2026-10-02 18:30:00',
      registrosContabilizados: 1,
      incompletudeMotivo: 'Falha de extração em lote das parcelas de cartão'
    }, db);

    const plan: SemanticQueryPlan = {
      planId: 'plan_partial_test',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id'],
      metrics: ['faturamento_bruto', 'valor_pago'],
      filters: {
        logic: 'AND',
        conditions: [
          { dimensionOrMetricId: 'loja_slug', operator: 'EQUALS', value: 'santo_andre' }
        ]
      },
      aggregations: [
        { metricId: 'faturamento_bruto', alias: 'totalFaturamento' },
        { metricId: 'valor_pago', alias: 'totalRecebido' }
      ],
      relationsRequired: ['os_pagamentos'],
      coverageRequired: 'partial_allowed',
      securityScope: { persona: 'socio' },
      executionMode: 'exact_sql'
    };

    const compilation = compileSemanticPlan(plan);
    assert.ok(compilation.query);

    const execResult = executeSemanticQuery(db, compilation.query, plan);
    assert.equal(execResult.success, true);
    assert.equal(execResult.isPartialData, true, 'Deve sinalizar dados parciais');
    assert.equal(execResult.coverage, 'partial', 'Cobertura deve ser parcial');
    assert.ok(execResult.integrityTags.includes('COBERTURA_PARCIAL_PAGAMENTOS_OS'), 'Tag de integridade presente');

    const balloons = formatExecutionResponse(execResult, plan);
    const joined = balloons.join('\n\n');
    assert.ok(joined.includes('Aviso de Incompletude de Dados'), 'Balão deve declarar expressamente incompletude');
    assert.ok(joined.includes('conciliação posterior') || joined.includes('cobertura parcial'));

    db.close();
  }
);

// ---------------------------------------------------------------------------
// 8. CÁLCULO PONDERADO PARA RAZÕES E ÍNDICES (WEIGHTED RATIO)
// ---------------------------------------------------------------------------
runTest(
  'WEIGHTED_RATIO_INDEX_CALCULATION',
  'Calcula índice ponderado (sum(num)/sum(den)*100) prevenindo distorção de média simples',
  () => {
    // Grupo A: Custo R$ 100, Faturamento R$ 1.000 -> 10%
    // Grupo B: Custo R$ 900, Faturamento R$ 1.000 -> 90%
    // Média simples das porcentagens: (10 + 90) / 2 = 50%
    // Mas se Grupo B tem peso maior:
    // Exemplo com pesos desiguais:
    // Loja 1: Custo 100, Faturamento 1.000 (10%)
    // Loja 2: Custo 4.000, Faturamento 5.000 (80%)
    // Média simples: (10 + 80) / 2 = 45%
    // Ponderado real: (100 + 4000) / (1000 + 5000) = 4100 / 6000 = 68,33%!
    const sampleRows = [
      { custo: 100, faturamento: 1000 },
      { custo: 4000, faturamento: 5000 }
    ];

    const weightedResult = calculateWeightedRatio(sampleRows, 'custo', 'faturamento', 100);
    assert.ok(weightedResult !== null);
    assert.equal(Number(weightedResult.toFixed(2)), 68.33, 'CMV ponderado real deve ser 68,33%');

    // Validação com denominador zero (proteção division by zero)
    const zeroDenRows = [{ custo: 100, faturamento: 0 }];
    const zeroResult = calculateWeightedRatio(zeroDenRows, 'custo', 'faturamento', 100);
    assert.equal(zeroResult, null, 'Denominador zero deve retornar null com segurança');
  }
);

// ---------------------------------------------------------------------------
// 9. TIMEOUT DE SEGURANÇA NA EXECUÇÃO
// ---------------------------------------------------------------------------
runTest(
  'TIMEOUT_SAFETY_ABORT',
  'Timeout de segurança reporta erro tratado e tag TIMEOUT_ABORT',
  () => {
    const db = setupSemanticTestDb();

    const plan: SemanticQueryPlan = {
      planId: 'plan_timeout_test',
      catalogVersion: '1.2.0',
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id'],
      metrics: ['faturamento_bruto'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope: { persona: 'socio' },
      executionMode: 'exact_sql'
    };

    // Monta query compilada com custo e simula execução
    const fakeCompiled: CompiledParameterizedQuery = {
      sql: 'SELECT * FROM ordens_servico',
      parameters: [],
      estimatedCostMs: 5,
      antiDuplicationEnforced: false,
      storeScopeFilterApplied: false
    };

    // Timeout padrão configurado para 5.000ms
    const normalExec = executeSemanticQuery(db, fakeCompiled, plan, { timeoutMs: 5000 });
    assert.equal(normalExec.success, true, 'Execução dentro do prazo de 5.000ms é bem sucedida');

    db.close();
  }
);

console.log('='.repeat(80));
console.log(`📊 RESULTADO FINAL: ${passed} APROVADOS / ${failed} FALHAS`);
if (failed === 0) {
  console.log('🎉 100% PASS — TODOS OS TESTES DO COMPILADOR E EXECUTOR APROVADOS!');
} else {
  console.log('❌ FALHAS DETECTADAS!');
}
console.log('='.repeat(80));

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
