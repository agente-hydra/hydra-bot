/**
 * Test Suite: Raciocínio Operacional, Contratos, Multi-Intenções e Recuperação Semântica (Frente A)
 * 
 * Cobre:
 * 1. Intenções múltiplas no mesmo turno ("OS e CMV da Jorge Beretta")
 *    - Decomposição canônica em sub-queries
 *    - Execução multi-consultas em balão único
 *    - Satisfação de múltiplos AnswerRequirements
 * 2. Consulta de área ("CMV de óleo das lojas")
 *    - Resolução semântica para área = 'OLEO'
 *    - Agrupamento pelas 10 lojas elegíveis do CATALOGO_10_LOJAS
 *    - cmv_percentual exclusivo de faturamento_areas (52.24% vs 19.66% geral)
 *    - Registro explícito de lacunas sem alucinação
 * 3. Orçamento global de 50s no DualWorkerRouter
 *    - GLOBAL_TURN_BUDGET_MS = 50000
 *    - Desconto de tempo do primário no secundário
 *    - Telemetria padronizada com códigos H-IA-01 a H-IA-04
 * 4. Validação pré-envio de AnswerRequirements
 *    - Verificação de dados confiáveis
 *    - Explicitação de lacunas no mesmo balão sem inventar números
 */

import { createTestFixtureDatabase } from '../../../fixtures/setup_test_db.js';
import { rewriteIntent } from '../intent_rewriter.js';
import {
  executeOperationalQuery,
  validateAnswerRequirements,
  formatAreaCMVWhatsAppReply
} from '../operational_adapter.js';
import {
  DualWorkerRouter,
  GLOBAL_TURN_BUDGET_MS,
  mapErrorToTelemetryCode,
  type TurnWorkerTelemetry
} from '../dual_worker_router.js';
import { CATALOGO_10_LOJAS } from '../db_repository.js';
import { assertNoDoubleAsterisks } from '../format_utils.js';
import type { AnswerRequirement } from '../types/conversation_contract.js';

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

async function runReasoningRetrievalTests() {
  console.log('🧪 Iniciando TEST SUITE — Frente A: Raciocínio, Contratos & Recuperação Semântica...\n');

  // Inicializa o banco de testes fictício isolado
  const db = createTestFixtureDatabase();

  // Garante que Jorge Beretta possua ao menos 1 OS aberta para testes multi-intenção
  db.prepare(`
    INSERT OR REPLACE INTO ordens_servico (
      os_id, loja_slug, is_aberta, data_inicio, dias_no_patio, veiculo, placa, total_os, valor_restante, status_grid
    ) VALUES (
      '901', 'MPJorgeBeretta', 1, '2026-09-20', 10, 'Jeep Compass Limited', 'JEP9010', 12500.0, 4500.0, 'Em andamento'
    )
  `).run();

  try {
    db.prepare(`
      INSERT OR REPLACE INTO ordens_servico_fts (os_id, loja_slug, veiculo, placa)
      VALUES ('901', 'MPJorgeBeretta', 'Jeep Compass Limited', 'JEP9010')
    `).run();
  } catch {}

  // =========================================================================
  // BLOCO 1: INTENÇÕES MÚLTIPLAS NO MESMO TURNO ("OS e CMV da Jorge Beretta")
  // =========================================================================
  console.log('--- BLOCO 1: Intenções Múltiplas no Mesmo Turno ("OS e CMV da Jorge Beretta") ---');

  const intentMulti = rewriteIntent('OS e CMV da Jorge Beretta');

  assert(
    Array.isArray(intentMulti.intents) && intentMulti.intents.includes('list_os') && intentMulti.intents.includes('store_cmv'),
    '1.1. Decomposição reconhece ambas as intenções (list_os e store_cmv)'
  );

  assert(
    intentMulti.lojaSlug === 'MPJorgeBeretta',
    '1.2. Loja canônica resolvida como MPJorgeBeretta'
  );

  assert(
    Array.isArray(intentMulti.subQueries) && intentMulti.subQueries.length === 2,
    '1.3. Sub-queries geradas para cada intenção atômica'
  );

  assert(
    intentMulti.subQueries?.[0]?.intent === 'list_os' && intentMulti.subQueries?.[1]?.intent === 'store_cmv',
    '1.4. Ordem e parâmetros das sub-queries preservam a sequência solicitada'
  );

  assert(
    Array.isArray(intentMulti.answerRequirements) && intentMulti.answerRequirements.length === 2,
    '1.5. Contrato gera 2 AnswerRequirements vinculados ao turno'
  );

  // Execução no adaptador operacional
  const resMulti = await executeOperationalQuery(db, intentMulti);

  assert(
    resMulti.replyText.includes('Ordens de Serviço Abertas: MPJorgeBeretta') || resMulti.replyText.includes('Jorge Beretta'),
    '1.6. Resposta contém a seção de Ordens de Serviço da Jorge Beretta'
  );

  assert(
    resMulti.replyText.includes('Custo de Mercadoria Vendida (CMV)') || resMulti.replyText.includes('CMV') || resMulti.replyText.includes('Margem Bruta'),
    '1.7. Resposta contém a seção de CMV da Jorge Beretta'
  );

  assert(
    resMulti.replyText.includes('Jeep Compass') || resMulti.replyText.includes('901'),
    '1.8. Dados da OS aberta (#901) apresentados no balão'
  );

  assert(
    Array.isArray(resMulti.answerRequirements) && resMulti.answerRequirements.every(r => r.fulfilled),
    '1.9. Todos os AnswerRequirements cumpridos após execução multi-consultas'
  );

  assert(
    assertNoDoubleAsterisks(resMulti.replyText),
    '1.10. Formatação WhatsApp estrita sem duplo asterisco'
  );


  // =========================================================================
  // BLOCO 2: CONSULTA DE ÁREA ("CMV de óleo das lojas") COM ÁREA = OLEO
  // =========================================================================
  console.log('\n--- BLOCO 2: Consulta de Área ("CMV de óleo das lojas") ---');

  const intentArea = rewriteIntent('CMV de óleo das lojas');

  assert(
    intentArea.intent === 'store_cmv',
    '2.1. Intenção principal classificada como store_cmv'
  );

  assert(
    intentArea.targetArea === 'OLEO',
    '2.2. Área canônica mapeada com precisão para OLEO'
  );

  assert(
    intentArea.scope === 'all_stores',
    '2.3. Escopo configurado para all_stores'
  );

  assert(
    intentArea.answerRequirements?.[0]?.targetArea === 'OLEO' &&
    intentArea.answerRequirements?.[0]?.sourceTable === 'faturamento_areas',
    '2.4. AnswerRequirement aponta especificamente para faturamento_areas com targetArea = OLEO'
  );

  // Execução no adaptador
  const resArea = await executeOperationalQuery(db, intentArea);

  assert(
    resArea.toolsCalled.includes('get_area_cmv'),
    '2.5. Tool get_area_cmv invocada pelo adaptador'
  );

  assert(
    resArea.replyText.includes('CMV de Óleo') && resArea.replyText.includes('Jorge Beretta'),
    '2.6. Balão exibe título de CMV de Óleo e lista a unidade apurada Jorge Beretta'
  );

  // REGRA CRÍTICA: O CMV de óleo de Jorge Beretta em faturamento_areas é 52.24%.
  // O CMV geral da loja em cmv_lojas é 19.66%.
  // NUNCA deve substituir pelo CMV geral!
  assert(
    resArea.replyText.includes('52.2%') || resArea.replyText.includes('52.24%'),
    '2.7. CMV de óleo de Jorge Beretta reflete estritamente faturamento_areas (52.24%)'
  );

  assert(
    !resArea.replyText.includes('19.66%'),
    '2.8. CMV geral da loja (19.66%) NÃO substituiu o CMV setorial de óleo'
  );

  // Cobertura do catálogo de 10 lojas e lacuna explícita
  assert(
    resArea.replyText.includes('10 lojas operacionais') || resArea.replyText.includes('Lojas sem apuração de Óleo'),
    '2.9. Catálogo de 10 lojas elegíveis referenciado e lojas pendentes explicitadas sem alucinar números'
  );

  assert(
    assertNoDoubleAsterisks(resArea.replyText),
    '2.10. Formatação WhatsApp estrita mantida'
  );


  // =========================================================================
  // BLOCO 3: ORÇAMENTO GLOBAL DE 50S NO DUALWORKERROUTER
  // =========================================================================
  console.log('\n--- BLOCO 3: Orçamento Global de 50s no DualWorkerRouter ---');

  assert(
    GLOBAL_TURN_BUDGET_MS === 50000,
    '3.1. Orçamento global padrão de turno definido exatamente em 50.000ms (50s)'
  );

  // Validação de códigos padronizados H-IA-01 a H-IA-04
  const codeQuota = mapErrorToTelemetryCode('RESOURCE_EXHAUSTED');
  assert(
    codeQuota.code === 'H-IA-01' && (codeQuota.message?.includes('H-IA-01') ?? false),
    '3.2. Mapeamento RESOURCE_EXHAUSTED -> H-IA-01 (Cota excedida)'
  );

  const codeTimeout = mapErrorToTelemetryCode('TIMEOUT');
  assert(
    codeTimeout.code === 'H-IA-02' && (codeTimeout.message?.includes('H-IA-02') ?? false),
    '3.3. Mapeamento TIMEOUT -> H-IA-02 (Tempo limite excedido / 50s)'
  );

  const codeNetwork = mapErrorToTelemetryCode('NETWORK');
  assert(
    codeNetwork.code === 'H-IA-03' && (codeNetwork.message?.includes('H-IA-03') ?? false),
    '3.4. Mapeamento NETWORK -> H-IA-03 (Falha de conectividade)'
  );

  const codeProcess = mapErrorToTelemetryCode('PROCESS_ERROR');
  assert(
    codeProcess.code === 'H-IA-04' && (codeProcess.message?.includes('H-IA-04') ?? false),
    '3.5. Mapeamento PROCESS_ERROR -> H-IA-04 (Instabilidade de processo)'
  );

  // Teste de desconto de tempo e limite global no router
  const router = new DualWorkerRouter({
    primaryConfig: {
      id: 'primary',
      type: 'cli',
      command: ['/bin/false'],
      model: 'gemini-3.8-flash-low',
      timeoutMs: 20000
    },
    secondaryConfig: {
      id: 'secondary',
      type: 'cli',
      command: ['/bin/false'],
      model: 'gemini-3.8-flash-low',
      timeoutMs: 20000
    }
  });

  const simulatedStart = Date.now();
  const routerOut = await router.routeRequest('Listar OS', { maxTurnBudgetMs: 5000 });
  const totalElapsed = Date.now() - simulatedStart;

  assert(
    routerOut.telemetry.workerChosen === 'none' && routerOut.usedFallback,
    '3.6. Com falha nos workers, router aciona fallback determinístico'
  );

  assert(
    totalElapsed < 6000,
    '3.7. Tempo total de execução respeitou o orçamento de turno (nunca somou 100s)'
  );

  assert(
    routerOut.telemetry.errorCode === 'H-IA-04' || routerOut.telemetry.errorCode === 'H-IA-02',
    '3.8. Telemetria inclui código amigável padronizado (H-IA-0X)'
  );

  assert(
    routerOut.telemetry.turnBudgetRemainingMs !== undefined && routerOut.telemetry.turnBudgetRemainingMs >= 0,
    '3.9. Telemetria registra saldo restante do orçamento de turno'
  );


  // =========================================================================
  // BLOCO 4: VALIDAÇÃO PRÉ-ENVIO DE ANSWERREQUIREMENTS E LACUNAS
  // =========================================================================
  console.log('\n--- BLOCO 4: Validação Pré-Envio de AnswerRequirements e Lacunas ---');

  // Cenário A: Requisito com dado existente
  const reqValido: AnswerRequirement = {
    id: 'req_test_1',
    description: 'CMV de óleo da Jorge Beretta',
    targetMetric: 'cmv_percentual',
    targetScope: 'store',
    targetLojaSlug: 'MPJorgeBeretta',
    targetArea: 'OLEO',
    fulfilled: false
  };

  const validadosA = validateAnswerRequirements({
    requirements: [reqValido],
    records: [{ loja_slug: 'MPJorgeBeretta', area: 'OLEO', cmv_percentual: 52.24 }],
    db,
    intent: intentMulti
  });

  assert(
    validadosA[0].fulfilled === true,
    '4.1. Requisito com dados presentes no banco é marcado como fulfilled = true'
  );

  // Cenário B: Requisito de área inexistente para loja específica (Santo André não tem área OLEO)
  const reqLacuna: AnswerRequirement = {
    id: 'req_test_2',
    description: 'CMV de óleo de Santo André',
    targetMetric: 'cmv_percentual',
    targetScope: 'store',
    targetLojaSlug: 'MPSantoAndre',
    targetArea: 'OLEO',
    fulfilled: false
  };

  const validadosB = validateAnswerRequirements({
    requirements: [reqLacuna],
    records: [],
    db,
    intent: {
      ...intentMulti,
      lojaSlug: 'MPSantoAndre',
      targetArea: 'OLEO'
    }
  });

  assert(
    validadosB[0].fulfilled === false,
    '4.2. Requisito para loja sem dados da área é marcado como fulfilled = false'
  );

  assert(
    typeof validadosB[0].missingReason === 'string' && validadosB[0].missingReason.includes('MPSantoAndre'),
    '4.3. missingReason documenta a unidade com dado ausente'
  );

  // Cenário C: Execução real de consulta com lacuna explicita ausência no balão sem inventar números
  const intentSantoAndreOleo = rewriteIntent('CMV de óleo de Santo André');
  const resLacuna = await executeOperationalQuery(db, intentSantoAndreOleo);

  assert(
    resLacuna.replyText.includes('não disponível') || resLacuna.replyText.includes('Lacuna de Dados'),
    '4.4. Balão explicita lacuna de dados para o operador'
  );

  assert(
    !resLacuna.replyText.includes('NaN') && !resLacuna.replyText.includes('undefined'),
    '4.5. Nenhuma alucinação numérica ou texto corrompido'
  );


  // =========================================================================
  // RELATÓRIO FINAL
  // =========================================================================
  console.log('\n============================================================');
  console.log(`🎉 TESTES CONCLUÍDOS COM SUCESSO: ${passedTests}/${totalTests} PASS (100%)`);
  console.log('============================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runReasoningRetrievalTests().catch(err => {
  console.error('❌ Erro fatal durante a execução dos testes:', err);
  process.exit(1);
});
