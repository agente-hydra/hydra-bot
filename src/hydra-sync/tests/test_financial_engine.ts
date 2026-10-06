/**
 * TEST HARNESS — FINANCIAL DATA ENGINE (MISSÃO 1)
 * Validação rigorosa dos dados financeiros, contratos tipados, fontes e persistência SQLite.
 * 
 * Cobertura de Testes:
 * 1. Meta da rede e atingimento (goal_gap), cálculo de falta = max(meta - fat, 0)
 * 2. Meta por loja individual com cálculo de atingimento % e meta ausente (null)
 * 3. Exclusão mandatória da Loja Master (status: vazio)
 * 4. Consulta de CMV com cmvPercentual como MÉTRICA PRIMÁRIA e base 'faturamento_bruto'
 * 5. Resolução da REGRESSÃO das 15:29 de 29/09/2026: Jorge Beretta isolada após consulta de OS
 * 6. Loja sem dados de CMV (Kennedy): status vazio, cmvPercentual null, zero raio-X
 * 7. Fonte de CMV desatualizada (> 26h): status desatualizado com motivo verificável
 * 8. Período divergente (mês anterior): dataInicio e dataFim identificados
 * 9. Diferença entre custos por área e consolidado (ajuste verificável)
 * 10. Consulta estruturada de Faturamento por Área
 * 11. Consulta estruturada de Pesquisa de Mídia e identificação do canal principal
 * 12. Visão geral comercial da rede com governança de cobertura (10 de 11)
 */

import { createTestFixtureDatabase } from '../../../fixtures/setup_test_db.js';
import {
  queryGoalGap,
  queryStoreCMV,
  queryStoreAreas,
  queryStoreMediaSurvey,
  queryNetworkFinancialOverview,
  CATALOGO_10_LOJAS
} from '../db_repository.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
    process.exitCode = 1;
  }
}

async function runFinancialEngineTests() {
  console.log('🧪 Iniciando TEST HARNESS — FINANCIAL DATA ENGINE (Missão 1)...\n');

  const db = createTestFixtureDatabase();

  // ===========================================================================
  // TESTE 1: Meta da Rede Consolidada e Cálculo de Falta / Atingimento
  // ===========================================================================
  console.log('--- Teste 1: Meta da Rede e Atingimento (goal_gap Consolidado) ---');
  const netGap = queryGoalGap(db);

  assert(netGap.status === 'sucesso', '1.1: Status da rede deve ser sucesso');
  assert(netGap.origem === 'MAPA_METAS_OFICIAL', '1.1: Origem deve ser MAPA_METAS_OFICIAL');
  assert(netGap.cobertura.totalLojasElegiveis === 10, '1.1: Exatamente 10 lojas elegíveis');
  assert(netGap.cobertura.masterExcluida === true, '1.1: Loja Master deve estar explicitamente excluída');
  assert(netGap.cobertura.isCompleta === true, '1.1: Cobertura completa das 10 lojas');
  assert(netGap.cobertura.descricao.includes('10 de 11 lojas operacionais (excluída Master)'), '1.1: Descrição de cobertura clara');

  assert(typeof netGap.faturamentoComparavel === 'number' && netGap.faturamentoComparavel > 0, '1.2: Faturamento consolidado presente');
  assert(typeof netGap.meta === 'number' && netGap.meta > 0, '1.2: Meta consolidada presente');
  assert(netGap.falta !== null && netGap.falta >= 0, '1.2: Falta calculada como max(meta - fat, 0)');
  assert(netGap.falta === Math.max((netGap.meta || 0) - (netGap.faturamentoComparavel || 0), 0), '1.2: Fórmula exata de falta satisfeita');

  const atingCalculado = Number((((netGap.faturamentoComparavel || 0) / (netGap.meta || 1)) * 100).toFixed(2));
  assert(netGap.atingimentoPercentual === atingCalculado, '1.3: Atingimento percentual exato');

  assert(Array.isArray(netGap.lojasNaoBateram) && netGap.lojasNaoBateram.length > 0, '1.4: Lista de lojas que não bateram meta presente');
  assert(Array.isArray(netGap.lojasBateram), '1.4: Lista de lojas que bateram meta presente');

  // ===========================================================================
  // TESTE 2: Meta por Loja Específica e Tratamento de Valor Ausente
  // ===========================================================================
  console.log('\n--- Teste 2: Meta por Loja Individual e Tratamento de Valor Ausente ---');
  
  // 2.1: Santo André (Com Meta e Faturamento)
  const stoGap = queryGoalGap(db, { lojaSlug: 'MPSantoAndre' });
  assert(stoGap.status === 'sucesso', '2.1: Santo André status sucesso');
  assert(stoGap.lojaSlug === 'MPSantoAndre', '2.1: LojaSlug Santo André');
  assert(stoGap.faturamentoComparavel === 145000.0, '2.1: Faturamento Santo André R$ 145.000,00');
  assert(stoGap.meta === 150000.0, '2.1: Meta Santo André R$ 150.000,00');
  assert(stoGap.falta === 5000.0, '2.1: Falta Santo André R$ 5.000,00');
  assert(stoGap.atingimentoPercentual === 96.67, '2.1: Atingimento Santo André 96.67%');
  assert(stoGap.bateuMeta === false, '2.1: Santo André ainda não bateu meta');

  // 2.2: Mauá (Meta Ausente / null)
  const mauaGap = queryGoalGap(db, { lojaSlug: 'ReiDoOleoMaua' });
  assert(mauaGap.status === 'sucesso', '2.2: Mauá status sucesso com faturamento registrado');
  assert(mauaGap.faturamentoComparavel === 85000.0, '2.2: Faturamento Mauá R$ 85.000,00');
  assert(mauaGap.meta === null, '2.2: Meta ausente é representada estritamente como null (NUNCA R$ 0,00)');
  assert(mauaGap.falta === null, '2.2: Falta é null quando não há meta válida');
  assert(mauaGap.atingimentoPercentual === null, '2.2: Atingimento percentual é null quando não há meta');
  assert(mauaGap.bateuMeta === false, '2.2: bateuMeta é false quando meta é nula');

  // ===========================================================================
  // TESTE 3: Exclusão Sumária da Loja Master
  // ===========================================================================
  console.log('\n--- Teste 3: Exclusão Sumária da Loja Master ---');
  const masterGap = queryGoalGap(db, { lojaSlug: 'MPMaster' });
  assert(masterGap.status === 'vazio', '3.1: Master retorna status vazio');
  assert(Boolean(masterGap.motivo?.includes('regra de negócio')), '3.1: Motivo explica regra contábil/administrativa da Master');
  assert(masterGap.meta === null && masterGap.faturamentoComparavel === null, '3.1: Valores de Master não são divulgados');

  const masterCMV = queryStoreCMV(db, { lojaSlug: 'MPMaster' });
  assert(masterCMV.status === 'vazio', '3.2: CMV da Master retorna status vazio');
  assert(masterCMV.cmvPercentual === null, '3.2: cmvPercentual da Master é estritamente null');
  assert(Boolean(masterCMV.motivo?.includes('regra contábil')), '3.2: Motivo explica regra contábil');

  // ===========================================================================
  // TESTE 4: Consulta de CMV com cmvPercentual como Métrica Primária
  // ===========================================================================
  console.log('\n--- Teste 4: Consulta de CMV (Métrica Primária cmvPercentual) ---');
  const stoCMV = queryStoreCMV(db, { lojaSlug: 'MPSantoAndre' });

  assert(stoCMV.status === 'sucesso', '4.1: Santo André CMV status sucesso');
  assert(stoCMV.origem === 'RELATORIO_OPERACAO_OFICIAL', '4.1: Origem RELATORIO_OPERACAO_OFICIAL');
  assert(stoCMV.cmvPercentual === 30.00, '4.1: cmvPercentual retornado como métrica primária (30.00%)');
  assert(stoCMV.baseCalculo === 'faturamento_bruto', '4.1: Base de cálculo informada como faturamento_bruto');
  assert(stoCMV.faturamentoTotal === 145000.0, '4.1: Faturamento total R$ 145.000,00');
  assert(stoCMV.custoTotal === 43500.0, '4.1: Custo total R$ 43.500,00');
  assert(stoCMV.lucroBruto === 101500.0, '4.1: Lucro bruto R$ 101.500,00');
  assert(stoCMV.lucroBrutoPercentual === 70.00, '4.1: Lucro bruto percentual 70.00%');
  assert((stoCMV.cmvPercentual || 0) + (stoCMV.lucroBrutoPercentual || 0) === 100.00, '4.1: CMV% + Margem Bruta% = 100.00%');
  assert(stoCMV.areas.length === 5, '4.2: Santo André possui 5 áreas de operação');
  assert(stoCMV.somaCustoAreas === 43500.0, '4.2: Soma dos custos das áreas igual ao custo consolidado');
  assert(stoCMV.diferencaConsolidadoAreas === 0.0, '4.2: Diferença entre consolidado e áreas é 0.00');

  // ===========================================================================
  // TESTE 5: REGRESSÃO DAS 15:29 DE 29/09/2026 — Jorge Beretta Isolada
  // ===========================================================================
  console.log('\n--- Teste 5: Regressão 15:29 (Jorge Beretta Isolada Após Consulta de OS) ---');

  // Simula consulta prévia de OS aberta da rede
  const previousOSs = db.prepare('SELECT os_id, loja_slug, veiculo FROM ordens_servico WHERE is_aberta = 1').all();
  assert(previousOSs.length > 0, '5.1: Simulação prévia executou consulta de OSs abertas');

  // Consulta inequívoca de CMV da Jorge Beretta
  const jbCMV = queryStoreCMV(db, { lojaSlug: 'MPJorgeBeretta' });

  assert(jbCMV.status === 'sucesso', '5.2: Jorge Beretta retorna status sucesso');
  assert(jbCMV.lojaSlug === 'MPJorgeBeretta', '5.2: Loja correta identificada');
  assert(jbCMV.nome === 'Jorge Beretta', '5.2: Nome amigável resolvido');
  assert(jbCMV.cmvPercentual === 19.66, '5.2: cmvPercentual da Jorge Beretta recuperado exatamente (19.66%)');
  assert(jbCMV.faturamentoTotal === 80779.88, '5.2: Faturamento total da Jorge Beretta R$ 80.779,88');
  assert(jbCMV.custoTotal === 15884.58, '5.2: Custo total da Jorge Beretta R$ 15.884,58');
  assert(jbCMV.baseCalculo === 'faturamento_bruto', '5.2: Base de cálculo faturamento_bruto');
  assert(jbCMV.areas.length === 6, '5.2: 6 áreas operacionais retornadas');

  // Prova de não-contaminação com Raio-X ou OSs
  const jbKeys = Object.keys(jbCMV);
  assert(!jbKeys.includes('ordens'), '5.3: Zero campo de ordens no resultado financeiro');
  assert(!jbKeys.includes('statusGrid'), '5.3: Zero campo de statusGrid no resultado financeiro');
  assert(!jbKeys.includes('checklist'), '5.3: Zero campo de checklist no resultado financeiro');
  assert(!jbKeys.includes('veiculosRetidos'), '5.3: Zero campo de veículos retidos no resultado financeiro');

  // ===========================================================================
  // TESTE 6: Loja Sem Dados de CMV (Kennedy) — Zero Raio-X
  // ===========================================================================
  console.log('\n--- Teste 6: Loja Sem Dados de CMV (Kennedy) ---');
  const kennedyCMV = queryStoreCMV(db, { lojaSlug: 'MPkennedy' });

  assert(kennedyCMV.status === 'vazio', '6.1: Kennedy retorna status vazio');
  assert(kennedyCMV.cmvPercentual === null, '6.1: cmvPercentual é estritamente null');
  assert(kennedyCMV.faturamentoTotal === null, '6.1: faturamentoTotal é null');
  assert(Boolean(kennedyCMV.motivo?.includes('Nenhum registro de CMV encontrado')), '6.1: Motivo explica ausência');
  assert(kennedyCMV.areas.length === 0, '6.1: Array de áreas vazio');

  // ===========================================================================
  // TESTE 7: Fonte Desatualizada (Piraporinha > 26h)
  // ===========================================================================
  console.log('\n--- Teste 7: Fonte de CMV Desatualizada (Piraporinha) ---');
  const piraCMV = queryStoreCMV(db, { lojaSlug: 'MPpiraporinha', maxAgeHours: 26 });

  assert(piraCMV.status === 'desatualizado', '7.1: Piraporinha status desatualizado');
  assert(piraCMV.cmvPercentual === 30.00, '7.1: cmvPercentual recuperado');
  assert(Boolean(piraCMV.motivo?.includes('Dados de CMV coletados há')), '7.1: Motivo informa idade da coleta');

  // ===========================================================================
  // TESTE 8: Período Divergente (Planalto — Mês Anterior)
  // ===========================================================================
  console.log('\n--- Teste 8: Período Divergente (Planalto) ---');
  const planaltoCMV = queryStoreCMV(db, { lojaSlug: 'MPplanalto' });

  assert(planaltoCMV.status === 'sucesso', '8.1: Planalto status sucesso');
  assert(planaltoCMV.dataInicio === '2026-08-01', '8.1: dataInicio identifica mês anterior');
  assert(planaltoCMV.dataFim === '2026-08-31', '8.1: dataFim identifica mês anterior');
  assert(planaltoCMV.periodo === 'agosto/2026', '8.1: Periodo formatado como agosto/2026');

  // ===========================================================================
  // TESTE 9: Diferença entre Custos por Área e Consolidado (Rei do Módulo)
  // ===========================================================================
  console.log('\n--- Teste 9: Ajuste Verificável de Custos (Rei do Módulo) ---');
  const moduloCMV = queryStoreCMV(db, { lojaSlug: 'ReiDoModulo' });

  assert(moduloCMV.custoTotal === 25000.0, '9.1: Custo consolidado R$ 25.000,00');
  assert(moduloCMV.somaCustoAreas === 24900.0, '9.1: Soma das áreas R$ 24.900,00');
  assert(moduloCMV.diferencaConsolidadoAreas === 100.0, '9.1: Diferença identificada e exposta como R$ 100,00');

  // ===========================================================================
  // TESTE 10: Faturamento por Área Estruturado
  // ===========================================================================
  console.log('\n--- Teste 10: Faturamento por Área Estruturado ---');
  const stoAreas = queryStoreAreas(db, { lojaSlug: 'MPSantoAndre' });

  assert(stoAreas.status === 'sucesso', '10.1: Áreas Santo André status sucesso');
  assert(stoAreas.totalFaturado === 145000.0, '10.1: Total faturado R$ 145.000,00');
  assert(stoAreas.areas.length === 5, '10.1: 5 áreas operacionais');
  assert(stoAreas.areas[0].area === 'Mecânica Geral', '10.1: Mecânica Geral é a área campeã');
  assert(stoAreas.areas[0].cmvPercentual === 28.50, '10.1: CMV da Mecânica Geral 28.50%');

  // ===========================================================================
  // TESTE 11: Pesquisa de Mídia Estruturada e Canal Principal
  // ===========================================================================
  console.log('\n--- Teste 11: Pesquisa de Mídia e Canal Principal ---');
  const stoMidia = queryStoreMediaSurvey(db, { lojaSlug: 'MPSantoAndre' });

  assert(stoMidia.status === 'sucesso', '11.1: Pesquisa de mídia status sucesso');
  assert(stoMidia.totalFaturado === 145000.0, '11.1: Total faturado R$ 145.000,00');
  assert(stoMidia.totalOS === 95, '11.1: Total de 95 OSs pesquisadas');
  assert(stoMidia.canais.length === 4, '11.1: 4 canais de captação');
  assert(stoMidia.canalPrincipal !== undefined, '11.2: Canal principal identificado');
  assert(stoMidia.canalPrincipal?.canal === 'Google / Internet', '11.2: Google / Internet é o canal principal');
  assert(stoMidia.canalPrincipal?.faturamento === 65000.0, '11.2: Faturamento do canal principal R$ 65.000,00');
  assert(stoMidia.canalPrincipal?.faturamentoPercentual === 44.83, '11.2: Participação do canal principal 44.83%');

  // ===========================================================================
  // TESTE 12: Visão Geral Comercial da Rede
  // ===========================================================================
  console.log('\n--- Teste 12: Visão Geral Comercial da Rede ---');
  const overview = queryNetworkFinancialOverview(db);

  assert(overview.status === 'sucesso', '12.1: Overview status sucesso');
  assert(overview.cobertura.totalLojasElegiveis === 10, '12.1: 10 lojas elegíveis na rede');
  assert(overview.cobertura.masterExcluida === true, '12.1: Master expurgada');
  assert(overview.lojas.length === 10, '12.1: Exatamente 10 lojas detalhadas');
  assert(overview.totalFaturamento > 0, '12.1: Faturamento total consolidado positivo');
  assert(overview.totalMeta > 0, '12.1: Meta total consolidada positiva');
  assert(overview.ticketMedio > 0, '12.1: Ticket médio da rede positivo');

  // ===========================================================================
  // RESULTADO FINAL
  // ===========================================================================
  console.log('\n========================================================');
  console.log(`🏆 RESULTADO FINAL FINANCIAL ENGINE: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('========================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runFinancialEngineTests().catch(err => {
  console.error('❌ Falha na bateria de testes do Financial Engine:', err);
  process.exit(1);
});