/**
 * src/hydra-sync/tests/test_semantic_data_evidence.ts
 * 
 * Suíte de Testes de Dados, Evidências e Metadados Semânticos do Hydra.
 * 
 * Cobre rigorosamente os requisitos da spec hydra-semantic-layer (Executor 2):
 * 1. Fixture T29:
 *    - Comprovação da falha de junção ingênua (Naive Join) que infla OS 101 para R$ 4.000 e global para R$ 5.000.
 *    - Comprovação da falha de SUM(DISTINCT) que apaga OSs legítimas com valores idênticos, resultando em R$ 1.000.
 *    - Validação do padrão compilado seguro gerando exatamente R$ 2.000 de OS e R$ 1.000 recebido.
 *    - Detecção de risco de explosão cartesiana 1:N no data dictionary.
 * 2. Fixture T30:
 *    - Proibição de soma ingênua de snapshots horários acumulados de metas (evitando inflar para R$ 405.000).
 *    - Validação de regras de agregação LATEST_SNAPSHOT no data dictionary.
 *    - Seleção correta do snapshot mais recente (R$ 150.000 na posição 18:00:00).
 * 3. Regras de Evidência e Cobertura (Cláusula Pétrea):
 *    - Ausência de filhos só comprova ausência se cobertura da fonte for COMPLETA.
 *    - Detecção e bloqueio de falsos zeros sob cobertura PARCIAL ou AUSENTE.
 *    - Expurgamento estrito da Loja Master do universo operacional das 10 lojas elegíveis.
 *    - Avaliação de cobertura da população (full / partial_warning / insufficient).
 *    - Rastreamento de anomalias de qualidade de dados.
 * 4. Granularidade e Eventos Temporais do Data Dictionary:
 *    - Granularidade nativa de cada tabela catalogada.
 *    - Distinção metodológica: Abertura != Fechamento != Faturamento != Coleta.
 *    - Bloqueio terminante de colunas técnicas de coleta como data de negócio.
 *    - Regras de agregação ponderada para métricas percentuais (CMV).
 * 
 * Regra Cardinal: TypeScript strict — ZERO `any`.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  DATA_DICTIONARY,
  getTableDefinition,
  listCatalogedTables,
  getTemporalEventMapping,
  assertValidTemporalUsage,
  validateAggregationRule,
  detectCartesianMultiplicationRisk
} from '../data_dictionary.js';

import {
  CATALOGO_10_LOJAS_ELEGIVEIS,
  isAuthorizedOperationalStore,
  ensureEvidenceSchema,
  recordStoreTableEvidence,
  getStoreTableEvidence,
  assessChildAbsenceEvidence,
  assessPaymentEvidence,
  recordQualityAnomaly,
  getQualityAnomaliesForOS,
  assessPopulationCoverage,
  clearInMemoryEvidenceStore
} from '../evidence_repository.js';

import {
  T29_FIXTURE_DATA,
  T30_FIXTURE_DATA,
  setupSemanticTestDb,
  runT29NaiveJoinOS101,
  runT29NaiveJoinGlobal,
  runT29SumDistinct,
  runT29SafeCompilerPattern,
  runT30NaiveSumSnapshots,
  runT30LatestSnapshot
} from '../fixtures/semantic_fixtures.js';

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
console.log('🔬 HYDRA — SUÍTE DE TESTES DE DADOS, EVIDÊNCIAS E CONSISTÊNCIA SEMÂNTICA');
console.log('='.repeat(80));

// ===========================================================================
// SEÇÃO 1: FIXTURE T29 — RISCOS CARTESIANOS 1:N E FALHA DO SUM(DISTINCT)
// ===========================================================================

runTest(
  'T29_1_NAIVE_JOIN_OS101_CARTESIAN_EXPLOSION',
  'Naive Join na OS 101 multiplica linhas para 4 e infla valor total para R$ 4.000,00',
  () => {
    const db = setupSemanticTestDb();
    try {
      const result = runT29NaiveJoinOS101(db);

      // OS 101 tem 2 peças e 2 pagamentos -> 1 x 2 x 2 = 4 linhas multiplicadas
      assert.equal(result.rowCount, 4, 'OS 101 sem pré-agregação deve produzir 4 linhas cartesianas');
      // Total de OS era R$ 1.000,00, mas a soma ingênua quadriplica para R$ 4.000,00
      assert.equal(result.naiveTotalOS, 4000.00, 'Soma ingênua deve demonstrar a falha cartesiana gerando R$ 4.000,00');
    } finally {
      db.close();
    }
  }
);

runTest(
  'T29_2_NAIVE_JOIN_GLOBAL_POPULATION_FAILURE',
  'Naive Join global na população gera 5 linhas e infla faturamento total para R$ 5.000,00',
  () => {
    const db = setupSemanticTestDb();
    try {
      const result = runT29NaiveJoinGlobal(db);

      // OS 101 gera 4 linhas e OS 102 gera 1 linha (1 peça x 1 pagamento) = 5 linhas
      assert.equal(result.rowCount, 5, 'População T29 sem pré-agregação deve produzir 5 linhas no join ingênuo');
      // Faturamento real é R$ 2.000,00, mas a junção ingênua gera R$ 5.000,00
      assert.equal(result.naiveTotalOS, 5000.00, 'Soma global ingênua deve gerar R$ 5.000,00 comprovando distorção de 150%');
    } finally {
      db.close();
    }
  }
);

runTest(
  'T29_3_SUM_DISTINCT_DELETION_FAILURE',
  'SUM(DISTINCT) deduplica por valor e apaga 50% do faturamento legítimo (gera R$ 1.000,00 em vez de R$ 2.000,00)',
  () => {
    const db = setupSemanticTestDb();
    try {
      const result = runT29SumDistinct(db);

      // Ambas as OSs 101 e 102 possuem valor total de R$ 1.000,00
      // SUM(DISTINCT total_os) elimina a segunda OS por ter o mesmo valor numérico
      assert.equal(result.sumDistinctTotalOS, 1000.00, 'SUM(DISTINCT) deve errar gravissimamente produzindo R$ 1.000,00');
    } finally {
      db.close();
    }
  }
);

runTest(
  'T29_4_PROHIBITION_OF_SUM_DISTINCT_IN_DICTIONARY',
  'Dicionário de dados proíbe expressamente SUM(DISTINCT) em qualquer coluna de valor',
  () => {
    const checkOS = validateAggregationRule('ordens_servico', 'SUM', 'DISTINCT total_os');
    assert.equal(checkOS.isAllowed, false, 'SUM(DISTINCT total_os) deve ser PROIBIDO');
    assert.match(checkOS.reason, /PROIBIDO/i, 'Motivo deve conter justificativa de proibição');

    const checkGeneric = validateAggregationRule('ordens_servico', 'SUM', 'DISTINCT valor_pago');
    assert.equal(checkGeneric.isAllowed, false, 'Qualquer variação de DISTINCT deve ser bloqueada');
  }
);

runTest(
  'T29_5_SAFE_COMPILER_PATTERN_VALIDATION',
  'Padrão compilado seguro (CTE pré-agregada) gera exatamente R$ 2.000,00 de OS e R$ 1.000,00 recebido',
  () => {
    const db = setupSemanticTestDb();
    try {
      const result = runT29SafeCompilerPattern(db);

      // Contagem correta de OSs
      assert.equal(result.osCount, 2, 'Total de OSs deve ser exatamente 2');
      // Faturamento real: R$ 1.000 (OS 101) + R$ 1.000 (OS 102) = R$ 2.000,00
      assert.equal(result.totalFaturamento, 2000.00, 'Total de OS faturado deve ser exatamente R$ 2.000,00');
      // Recebido real: R$ 300 + R$ 200 (OS 101) + R$ 500 (OS 102) = R$ 1.000,00
      assert.equal(result.totalRecebido, 1000.00, 'Total recebido deve ser exatamente R$ 1.000,00');
    } finally {
      db.close();
    }
  }
);

runTest(
  'T29_6_CARTESIAN_RISK_DETECTION_AND_MITIGATION',
  'Data dictionary detecta risco de multiplicação 1:N com peças e pagamentos e recomenda mitigações',
  () => {
    const pecasRisk = detectCartesianMultiplicationRisk('ordens_servico', 'itens_pecas');
    assert.equal(pecasRisk.hasRisk, true, 'Deve identificar risco 1:N para itens_pecas');
    assert.match(pecasRisk.recommendedMitigation || '', /PRE_AGGREGATED_CTE/i);

    const pagamentosRisk = detectCartesianMultiplicationRisk('ordens_servico', 'pagamentos_os');
    assert.equal(pagamentosRisk.hasRisk, true, 'Deve identificar risco 1:N para pagamentos_os');
    assert.match(pagamentosRisk.recommendedMitigation || '', /SCALAR_CORRELATED_SUBQUERY/i);

    const noRisk = detectCartesianMultiplicationRisk('ordens_servico', 'lojas');
    assert.equal(noRisk.hasRisk, false, 'Não deve haver risco cartesiano em relação 1:1 / N:1');
  }
);

// ===========================================================================
// SEÇÃO 2: FIXTURE T30 — SNAPSHOTS HORÁRIOS E ACÚMULO DE METAS
// ===========================================================================

runTest(
  'T30_1_NAIVE_SUM_SNAPSHOTS_MULTIPLICATION_ERROR',
  'Soma ingênua de snapshots horários resulta em R$ 405.000,00 (triplicação indevida de dados acumulados)',
  () => {
    const db = setupSemanticTestDb();
    try {
      const result = runT30NaiveSumSnapshots(db);

      // Soma de 120.000 (10h) + 135.000 (14h) + 150.000 (18h) = 405.000
      assert.equal(result.naiveSumFaturamento, 405000.00, 'Soma ingênua deve produzir R$ 405.000,00');
    } finally {
      db.close();
    }
  }
);

runTest(
  'T30_2_AGGREGATION_RULES_FORBIDDEN_SUM_ON_SNAPSHOTS',
  'Dicionário proíbe SUM em faturamento_mes e ticket_medio e exige LATEST_SNAPSHOT',
  () => {
    const sumFatCheck = validateAggregationRule('metas_diarias', 'SUM', 'faturamento_mes');
    assert.equal(sumFatCheck.isAllowed, false, 'SUM em faturamento_mes de metas_diarias deve ser PROIBIDO');
    assert.match(sumFatCheck.reason, /PROIBIDO/i);

    const sumTicketCheck = validateAggregationRule('metas_diarias', 'SUM', 'ticket_medio');
    assert.equal(sumTicketCheck.isAllowed, false, 'SUM em ticket_medio deve ser PROIBIDO');

    const latestCheck = validateAggregationRule('metas_diarias', 'LATEST_SNAPSHOT', 'faturamento_mes');
    assert.equal(latestCheck.isAllowed, true, 'LATEST_SNAPSHOT deve ser PERMITIDO');
  }
);

runTest(
  'T30_3_LATEST_SNAPSHOT_CORRECT_RESOLUTION',
  'Seleção correta LATEST_SNAPSHOT (ORDER BY posicao_hora DESC LIMIT 1) retorna exatamente R$ 150.000,00',
  () => {
    const db = setupSemanticTestDb();
    try {
      const result = runT30LatestSnapshot(db);

      assert.equal(result.faturamentoMes, 150000.00, 'Faturamento mais recente deve ser R$ 150.000,00');
      assert.equal(result.posicaoHora, '18:00:00', 'Horário da foto deve ser 18:00:00');
      assert.equal(result.percentualMeta, 75.0, 'Percentual atingido da meta deve ser 75.0%');
    } finally {
      db.close();
    }
  }
);

// ===========================================================================
// SEÇÃO 3: REGRAS DE EVIDÊNCIA E COBERTURA DE DADOS (CLÁUSULA PÉTREA)
// ===========================================================================

runTest(
  'T31_1_CONFIRMED_ZERO_WHEN_SOURCE_COVERAGE_FULL',
  'Ausência de filhos com cobertura COMPLETA confirma legitimamente ausência (isZeroConfirmed = true)',
  () => {
    clearInMemoryEvidenceStore();
    recordStoreTableEvidence({
      lojaSlug: 'santo_andre',
      tabela: 'pagamentos_os',
      coberturaStatus: 'COMPLETA',
      dataColetaRecente: '2026-10-02 18:00:00',
      registrosContabilizados: 10
    });

    const result = assessChildAbsenceEvidence({
      osId: '999',
      lojaSlug: 'santo_andre',
      childTable: 'pagamentos_os',
      childrenCountInDb: 0
    });

    assert.equal(result.isZeroConfirmed, true, 'Deve confirmar zero quando cobertura é COMPLETA');
    assert.equal(result.isUnknownOrPartial, false, 'Não deve ser desconhecido/parcial');
    assert.match(result.verdictText, /Comprovadamente sem registros/i);
    assert.equal(result.warning, undefined, 'Não deve emitir warning de falta de cobertura');
  }
);

runTest(
  'T31_2_BLOCKED_ZERO_WHEN_SOURCE_COVERAGE_PARTIAL',
  'Ausência de filhos com cobertura PARCIAL bloqueia afirmação de zero e classifica como desconhecido',
  () => {
    clearInMemoryEvidenceStore();
    recordStoreTableEvidence({
      lojaSlug: 'sao_bernardo',
      tabela: 'pagamentos_os',
      coberturaStatus: 'PARCIAL',
      dataColetaRecente: '2026-10-02 12:00:00',
      registrosContabilizados: 5,
      incompletudeMotivo: 'Falha intermitente na extração do módulo de pagamentos'
    });

    const result = assessPaymentEvidence({
      osId: '555',
      lojaSlug: 'sao_bernardo',
      paymentsCountInDb: 0
    });

    assert.equal(result.isZeroConfirmed, false, 'NÃO PODE confirmar zero sob cobertura parcial');
    assert.equal(result.isUnknownOrPartial, true, 'Deve ser marcado como isUnknownOrPartial = true');
    assert.match(result.verdictText, /não disponíveis/i);
    assert.ok(result.warning, 'Deve conter warning explícito');
    assert.match(result.warning || '', /PARCIAL/i);
    assert.match(result.warning || '', /Falha intermitente/i);
  }
);

runTest(
  'T31_3_BLOCKED_ZERO_WHEN_SOURCE_COVERAGE_MISSING',
  'Ausência de filhos com cobertura AUSENTE bloqueia afirmação de zero e emite aviso severo',
  () => {
    clearInMemoryEvidenceStore();
    // Nenhuma evidência registrada para diadema -> default 'AUSENTE'

    const result = assessChildAbsenceEvidence({
      osId: '777',
      lojaSlug: 'diadema',
      childTable: 'itens_pecas',
      childrenCountInDb: 0
    });

    assert.equal(result.isZeroConfirmed, false, 'NÃO PODE confirmar zero se cobertura é ausente');
    assert.equal(result.isUnknownOrPartial, true, 'Deve indicar desconhecido/parcial');
    assert.ok(result.warning, 'Deve emitir warning');
    assert.match(result.warning || '', /AUSENTE/i);
  }
);

runTest(
  'T31_4_CHILD_PRESENCE_WHEN_COUNT_GREATER_THAN_ZERO',
  'Quando registros filhos existem (> 0), relata presença normal independentemente do status',
  () => {
    const result = assessChildAbsenceEvidence({
      osId: '101',
      lojaSlug: 'santo_andre',
      childTable: 'itens_pecas',
      childrenCountInDb: 2
    });

    assert.equal(result.isZeroConfirmed, false);
    assert.equal(result.isUnknownOrPartial, false);
    assert.equal(result.childrenCountInDb, 2);
    assert.match(result.verdictText, /Possui 2 registros/i);
  }
);

runTest(
  'T31_5_MASTER_STORE_EXCLUSION_AND_CATALOG_CHECK',
  'Loja Master é estritamente expurgada do universo operacional das 10 lojas elegíveis',
  () => {
    assert.equal(isAuthorizedOperationalStore('master'), false, 'Loja master deve ser rejeitada');
    assert.equal(isAuthorizedOperationalStore('Master'), false, 'Case-insensitive: Master deve ser rejeitada');
    assert.equal(isAuthorizedOperationalStore('MASTER'), false, 'Case-insensitive: MASTER deve ser rejeitada');

    assert.equal(CATALOGO_10_LOJAS_ELEGIVEIS.length, 10, 'Devem existir exatamente 10 lojas operacionais elegíveis');
    for (const store of CATALOGO_10_LOJAS_ELEGIVEIS) {
      assert.equal(isAuthorizedOperationalStore(store), true, `Loja ${store} deve ser autorizada`);
    }

    assert.equal(isAuthorizedOperationalStore('loja_inexistente'), false, 'Loja fora do catálogo deve ser rejeitada');
  }
);

runTest(
  'T31_6_POPULATION_COVERAGE_ASSESSMENT_PROPAGATION',
  'Avaliação de população propaga status completo, parcial ou insuficiente e expurga Master',
  () => {
    clearInMemoryEvidenceStore();

    // Santo André: COMPLETA
    recordStoreTableEvidence({
      lojaSlug: 'santo_andre',
      tabela: 'ordens_servico',
      coberturaStatus: 'COMPLETA',
      dataColetaRecente: '2026-10-02 18:00:00',
      registrosContabilizados: 100
    });

    // São Bernardo: PARCIAL
    recordStoreTableEvidence({
      lojaSlug: 'sao_bernardo',
      tabela: 'ordens_servico',
      coberturaStatus: 'PARCIAL',
      dataColetaRecente: '2026-10-02 18:00:00',
      registrosContabilizados: 50,
      incompletudeMotivo: 'Coleta truncada'
    });

    // Consulta incluindo santo_andre, sao_bernardo e master
    const assessment = assessPopulationCoverage(
      ['santo_andre', 'sao_bernardo', 'master'],
      ['ordens_servico']
    );

    // Master foi expurgada -> eligibleStoresCount = 2
    assert.equal(assessment.eligibleStoresCount, 2, 'Apenas 2 lojas devem ser consideradas (Master expurgada)');
    assert.deepEqual(assessment.storesWithFullCoverage, ['santo_andre']);
    assert.deepEqual(assessment.storesWithPartialCoverage, ['sao_bernardo']);
    assert.equal(assessment.overallStatus, 'partial_warning', 'Status geral deve ser partial_warning');
    assert.ok(assessment.warnings.length > 0, 'Deve emitir warning para sao_bernardo');
  }
);

runTest(
  'T31_7_SQLITE_PERSISTENCE_FOR_EVIDENCE_REPOSITORY',
  'Persistência e recuperação de evidências via SQLite (tabela hydra_semantic_evidence)',
  () => {
    const db = new Database(':memory:');
    try {
      ensureEvidenceSchema(db);

      recordStoreTableEvidence({
        lojaSlug: 'sao_caetano',
        tabela: 'metas_diarias',
        coberturaStatus: 'COMPLETA',
        dataColetaRecente: '2026-10-02 19:00:00',
        registrosContabilizados: 24
      }, db);

      const recovered = getStoreTableEvidence('sao_caetano', 'metas_diarias', db);
      assert.ok(recovered, 'Evidência deve ser recuperada do SQLite');
      assert.equal(recovered.lojaSlug, 'sao_caetano');
      assert.equal(recovered.tabela, 'metas_diarias');
      assert.equal(recovered.coberturaStatus, 'COMPLETA');
      assert.equal(recovered.registrosContabilizados, 24);

      // Teste de UPSERT (atualização da evidência)
      recordStoreTableEvidence({
        lojaSlug: 'sao_caetano',
        tabela: 'metas_diarias',
        coberturaStatus: 'PARCIAL',
        dataColetaRecente: '2026-10-02 19:30:00',
        registrosContabilizados: 12,
        incompletudeMotivo: 'Snapshot das 18h ausente'
      }, db);

      const updated = getStoreTableEvidence('sao_caetano', 'metas_diarias', db);
      assert.ok(updated);
      assert.equal(updated.coberturaStatus, 'PARCIAL');
      assert.equal(updated.incompletudeMotivo, 'Snapshot das 18h ausente');
    } finally {
      db.close();
    }
  }
);

runTest(
  'T31_8_QUALITY_ANOMALY_TRACKING',
  'Registro e consulta de anomalias de qualidade por OS e loja',
  () => {
    clearInMemoryEvidenceStore();

    recordQualityAnomaly({
      anomalyId: 'ANOM-001',
      osId: '101',
      lojaSlug: 'santo_andre',
      tabela: 'ordens_servico',
      campoAfetado: 'total_os',
      motivo: 'Divergência entre soma de peças e total da OS',
      severidade: 'WARNING',
      dataIdentificacao: '2026-10-02T19:00:00Z'
    });

    const anomalies = getQualityAnomaliesForOS('101', 'santo_andre');
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].anomalyId, 'ANOM-001');
    assert.equal(anomalies[0].severidade, 'WARNING');

    const empty = getQualityAnomaliesForOS('999', 'santo_andre');
    assert.equal(empty.length, 0);
  }
);

// ===========================================================================
// SEÇÃO 4: GRANULARIDADE E EVENTOS TEMPORAIS DO DATA DICTIONARY
// ===========================================================================

runTest(
  'T32_1_CATALOGED_TABLES_GRANULARITY_INTEGRITY',
  'Integridade das tabelas catalogadas e suas granularidades e chaves primárias',
  () => {
    const tables = listCatalogedTables();
    assert.ok(tables.includes('ordens_servico'), 'Deve incluir ordens_servico');
    assert.ok(tables.includes('metas_diarias'), 'Deve incluir metas_diarias');
    assert.ok(tables.includes('faturamento_areas'), 'Deve incluir faturamento_areas');
    assert.ok(tables.includes('itens_pecas'), 'Deve incluir itens_pecas');
    assert.ok(tables.includes('pagamentos_os'), 'Deve incluir pagamentos_os');

    const osDef = getTableDefinition('ordens_servico');
    assert.ok(osDef);
    assert.equal(osDef.granularity, 'ONE_ROW_PER_OS_STORE');
    assert.deepEqual(osDef.primaryKey, ['os_id', 'loja_slug']);

    const metasDef = getTableDefinition('metas_diarias');
    assert.ok(metasDef);
    assert.equal(metasDef.granularity, 'ONE_ROW_PER_HOURLY_SNAPSHOT');

    const areasDef = getTableDefinition('faturamento_areas');
    assert.ok(areasDef);
    assert.equal(areasDef.granularity, 'ONE_ROW_PER_AREA_PERIOD');
  }
);

runTest(
  'T32_2_TEMPORAL_EVENTS_SEPARATION_ABERTURA_FECHAMENTO_FATURAMENTO',
  'Distinção estrita dos papéis temporais: Abertura != Fechamento != Faturamento != Coleta',
  () => {
    const osAbertura = getTemporalEventMapping('ordens_servico', 'ABERTURA');
    assert.ok(osAbertura);
    assert.equal(osAbertura.columnName, 'data_inicio');
    assert.ok(osAbertura.cannotSubstitute.includes('FECHAMENTO'));
    assert.ok(osAbertura.cannotSubstitute.includes('FATURAMENTO'));
    assert.ok(osAbertura.cannotSubstitute.includes('COLETA'));

    const osFechamento = getTemporalEventMapping('ordens_servico', 'FECHAMENTO');
    assert.ok(osFechamento);
    assert.equal(osFechamento.columnName, 'data_fim');
    assert.ok(osFechamento.cannotSubstitute.includes('ABERTURA'));

    const metasFaturamento = getTemporalEventMapping('metas_diarias', 'FATURAMENTO');
    assert.ok(metasFaturamento);
    assert.equal(metasFaturamento.columnName, 'data_referencia');

    const osColeta = getTemporalEventMapping('ordens_servico', 'COLETA');
    assert.ok(osColeta);
    assert.equal(osColeta.columnName, 'updated_at');
  }
);

runTest(
  'T32_3_STRICT_ASSERT_VALID_TEMPORAL_USAGE',
  'assertValidTemporalUsage bloqueia uso de carimbo de coleta como evento de negócio',
  () => {
    // Válido: Abertura usando data_inicio
    const validAbertura = assertValidTemporalUsage('ordens_servico', 'ABERTURA', 'data_inicio');
    assert.equal(validAbertura.isValid, true);

    // Válido: Fechamento usando data_fim
    const validFechamento = assertValidTemporalUsage('ordens_servico', 'FECHAMENTO', 'data_fim');
    assert.equal(validFechamento.isValid, true);

    // INVÁLIDO: Usar updated_at (COLETA) como data de ABERTURA
    const invalidColetaAbertura = assertValidTemporalUsage('ordens_servico', 'ABERTURA', 'updated_at');
    assert.equal(invalidColetaAbertura.isValid, false);
    assert.match(invalidColetaAbertura.violationReason || '', /VIOLAÇÃO METODOLÓGICA/i);

    // INVÁLIDO: Usar created_at (COLETA) como data de FATURAMENTO em metas_diarias
    const invalidColetaFaturamento = assertValidTemporalUsage('metas_diarias', 'FATURAMENTO', 'created_at');
    assert.equal(invalidColetaFaturamento.isValid, false);
    assert.match(invalidColetaFaturamento.violationReason || '', /VIOLAÇÃO METODOLÓGICA/i);

    // INVÁLIDO: Usar data_fim (FECHAMENTO) como data de ABERTURA
    const invalidSwap = assertValidTemporalUsage('ordens_servico', 'ABERTURA', 'data_fim');
    assert.equal(invalidSwap.isValid, false);
    assert.match(invalidSwap.violationReason || '', /Incompatibilidade de evento temporal/i);

    // INVÁLIDO: Coluna não mapeada
    const unmapped = assertValidTemporalUsage('ordens_servico', 'ABERTURA', 'veiculo');
    assert.equal(unmapped.isValid, false);
    assert.match(unmapped.violationReason || '', /não é um evento temporal mapeado/i);
  }
);

runTest(
  'T32_4_WEIGHTED_AVERAGE_RULES_FOR_AREAS_CMV',
  'Regras de agregação para faturamento_areas: SUM permitido para faturamento, média ponderada obrigatória para CMV',
  () => {
    const sumFat = validateAggregationRule('faturamento_areas', 'SUM', 'faturamento');
    assert.equal(sumFat.isAllowed, true, 'Soma de faturamento entre áreas deve ser permitida');

    const weightedCmv = validateAggregationRule('faturamento_areas', 'AVG_WEIGHTED', 'cmv_percentual');
    assert.equal(weightedCmv.isAllowed, true, 'Média ponderada de CMV deve ser permitida');

    const simpleCmv = validateAggregationRule('faturamento_areas', 'AVG', 'cmv_percentual');
    assert.equal(simpleCmv.isAllowed, false, 'Média aritmética simples de CMV percentual deve ser PROIBIDA');
    assert.match(simpleCmv.reason, /PROIBIDO/i);
  }
);

// ===========================================================================
// RESUMO FINAL
// ===========================================================================
console.log('='.repeat(80));
console.log(`📊 RESULTADO FINAL: ${passed} APROVADOS / ${failed} FALHAS`);
if (failed === 0) {
  console.log('🎉 100% PASS — TODOS OS REQUISITOS DE DADOS E EVIDÊNCIAS ATENDIDOS COM SUCESSO!');
} else {
  console.error('⚠️ EXISTEM FALHAS A CORRIGIR!');
  process.exit(1);
}
console.log('='.repeat(80));
