import Database from 'better-sqlite3';
import {
  ensureUserMemoryTable,
  getUserMemory,
  recordDailyTopic,
  calculateDecayedPreferences,
  consolidateWeeklyMemory,
  getUserPersonalizationSummary,
  resetUserMemory,
  setUserPersona,
  setDefaultLojaSlug,
  cleanPhone,
  WeeklyPreferenceItem
} from '../user_memory_repository.js';
import {
  ensureBriefingDispatchesTable,
  recordBriefingDispatch,
  getBriefingDispatch,
  isBriefingAlreadyDispatched,
  executarAuditoriaEBriefing,
  DESTINATARIOS
} from '../hydra_auditor_service.js';
import { ConsolidadoRede } from '../hydra_audit_engine.js';

// Desativa chamadas reais a binários LLM externos nos testes para garantir rapidez e determinismo
process.env.AGY_BIN_OVERRIDE = '/bin/false';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FALHA: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✅ ${message}`);
}

function createMockConsolidadoRede(dataReferencia: string = '2026-09-30'): ConsolidadoRede {
  return {
    dataReferencia,
    posicaoHora: '11:00',
    faturamentoTotal: 1046562.05,
    totalOSs: 421,
    ticketMedioRede: 2485.90,
    totalPatioAtivo: 45,
    alertasFinanceiros: [
      { loja: 'Rei Do Modulo', osId: '101', valorTotal: 8000, saldoAReceber: 6600 },
      { loja: 'MPJabaquara', osId: '102', valorTotal: 6000, saldoAReceber: 5040 }
    ],
    carrosTravados: [
      { loja: 'MPdompedro1', osId: '201', diasNoPatio: 7 },
      { loja: 'MPJabaquara', osId: '202', diasNoPatio: 6 },
      { loja: 'MPSantoAndre', osId: '203', diasNoPatio: 8 }
    ],
    conciliacaoPorLoja: {},
    patioPorLoja: [],
    raioXLojas: [
      {
        slug: 'MPSantoAndre',
        nome: 'Santo Andre',
        faturamentoMes: 163642.53,
        volumeOsMes: 65,
        ticketMedio: 2517.57,
        osEmAberto: 5
      },
      {
        slug: 'ReiDoModulo',
        nome: 'Rei Do Modulo',
        faturamentoMes: 149232.50,
        volumeOsMes: 58,
        ticketMedio: 2573.00,
        osEmAberto: 4
      }
    ],
    ambienteOperacionalVerificado: true
  };
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 HYDRA FRENTE B — BATERIA DE TESTES DE MEMÓRIA E BRIEFINGS');
  console.log('================================================================\n');

  // Inicializa banco SQLite isolado em memória
  const db = new Database(':memory:');
  ensureUserMemoryTable(db);
  ensureBriefingDispatchesTable(db);

  // ---------------------------------------------------------------------------
  // TESTE 1: Gravação e leitura de memória diária e semanal com decaimento
  // ---------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TESTE 1: Gravação e Leitura de Memória Diária e Semanal com Decaimento');
  console.log('----------------------------------------------------------------');

  const testPhone = '5511999990001';

  // 1.1 Gravação no dia 1
  recordDailyTopic(db, testPhone, 'cmv_oleo', {
    date: '2026-09-25',
    granularity: 'detalhado',
    lojaSlug: 'jabaquara'
  });

  const memD1 = getUserMemory(db, testPhone);
  const dailyD1 = JSON.parse(memD1.daily_topics_json);
  assert(dailyD1.topics['cmv_oleo'] !== undefined, 'Tópico cmv_oleo registrado na memória diária');
  assert(dailyD1.topics['cmv_oleo'].count === 1, 'Contador de aparição diária igual a 1');
  assert(dailyD1.topics['cmv_oleo'].lojaSlug === 'jabaquara', 'Metadado de loja associado ao tópico');

  // REGRA CRÍTICA: Valores operacionais NUNCA salvos na memória
  const rawDaily = memD1.daily_topics_json;
  const rawWeekly = memD1.weekly_preferences_json;
  assert(!rawDaily.includes('1046562') && !rawDaily.includes('R$'), 'Memória diária não contém números operacionais estáticos');
  assert(!rawWeekly.includes('1046562') && !rawWeekly.includes('R$'), 'Memória semanal não contém números operacionais estáticos');

  // 1.2 Transição de dia e consolidação semanal (Dia 2)
  recordDailyTopic(db, testPhone, 'cmv_oleo', {
    date: '2026-09-26',
    granularity: 'detalhado',
    lojaSlug: 'jabaquara'
  });

  const memD2 = getUserMemory(db, testPhone);
  const weeklyD2: WeeklyPreferenceItem[] = JSON.parse(memD2.weekly_preferences_json);
  const cmvWeeklyItem = weeklyD2.find(w => w.topic === 'cmv_oleo');
  assert(cmvWeeklyItem !== undefined, 'Tópico cmv_oleo consolidado na memória semanal');
  assert((cmvWeeklyItem?.distinctDays || []).length >= 2, 'Tópico consolidado em dias distintos (2026-09-25 e 2026-09-26)');
  assert((cmvWeeklyItem?.confidence || 0) >= 0.6, 'Confiança cresce com consistência em dias distintos (>= 0.6)');

  // 1.3 Decaimento temporal por avanço de dias sem confirmação
  const initialConfidence = cmvWeeklyItem!.confidence;
  // Avança 3 dias sem confirmação (fator: 0.85^3 = ~0.614)
  const decayedAfter3Days = calculateDecayedPreferences(weeklyD2, '2026-09-29');
  const decayedItem = decayedAfter3Days.find(w => w.topic === 'cmv_oleo');
  const expectedScore = Number((initialConfidence * Math.pow(0.85, 3)).toFixed(3));
  assert(decayedItem !== undefined, 'Item localizado na lista decaída');
  assert(Math.abs(decayedItem!.decayScore - expectedScore) < 0.01, `Decaimento temporal aplicado com taxa 0.85/dia (score: ${decayedItem?.decayScore})`);

  // 1.4 Elegibilidade com decaimento no resumo de personalização
  const summaryFresh = getUserPersonalizationSummary(db, testPhone, '2026-09-26');
  assert(summaryFresh.topPersonalizedTopics.includes('cmv_oleo'), 'Tópico recente incluído no top de personalização');

  // Avança 15 dias sem confirmação (decaimento acentuado < 0.35)
  const summaryExpired = getUserPersonalizationSummary(db, testPhone, '2026-10-11');
  assert(!summaryExpired.topPersonalizedTopics.includes('cmv_oleo'), 'Tópico expirado por decaimento temporal removido do top');

  // ---------------------------------------------------------------------------
  // TESTE 2: Isolamento entre Números Distintos (Davi vs Marcos)
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('TESTE 2: Isolamento entre Números Distintos (Davi 5511996242812 vs Marcos 5511970671717)');
  console.log('----------------------------------------------------------------');

  const phoneDavi = '5511996242812';
  const phoneMarcos = '5511970671717';

  // Configuração de Davi: Sócio, foco em Jabaquara e CMV
  setUserPersona(db, phoneDavi, 'socio');
  setDefaultLojaSlug(db, phoneDavi, 'jabaquara');
  recordDailyTopic(db, phoneDavi, 'cmv_oleo', { date: '2026-09-28', lojaSlug: 'jabaquara' });
  recordDailyTopic(db, phoneDavi, 'cmv_oleo', { date: '2026-09-29', lojaSlug: 'jabaquara' });

  // Configuração de Marcos: Gerente Operacional, foco em Santo André e Carros Travados
  setUserPersona(db, phoneMarcos, 'gerente');
  setDefaultLojaSlug(db, phoneMarcos, 'santoandre');
  recordDailyTopic(db, phoneMarcos, 'carros_travados', { date: '2026-09-28', lojaSlug: 'santoandre' });
  recordDailyTopic(db, phoneMarcos, 'carros_travados', { date: '2026-09-29', lojaSlug: 'santoandre' });

  // Consulta e validação de isolamento estrito
  const summaryDavi = getUserPersonalizationSummary(db, phoneDavi, '2026-09-29');
  const summaryMarcos = getUserPersonalizationSummary(db, phoneMarcos, '2026-09-29');

  assert(summaryDavi.activePersona === 'socio', 'Davi possui persona socio');
  assert(summaryDavi.defaultLojaSlug === 'jabaquara', 'Davi possui loja jabaquara');
  assert(summaryDavi.topPersonalizedTopics.includes('cmv_oleo'), 'Davi possui tópico cmv_oleo');
  assert(!summaryDavi.topPersonalizedTopics.includes('carros_travados'), 'ISOLAMENTO: Perfil de Davi NÃO contém tópico carros_travados de Marcos');

  assert(summaryMarcos.activePersona === 'gerente', 'Marcos possui persona gerente');
  assert(summaryMarcos.defaultLojaSlug === 'santoandre', 'Marcos possui loja santoandre');
  assert(summaryMarcos.topPersonalizedTopics.includes('carros_travados'), 'Marcos possui tópico carros_travados');
  assert(!summaryMarcos.topPersonalizedTopics.includes('cmv_oleo'), 'ISOLAMENTO: Perfil de Marcos NÃO contém tópico cmv_oleo de Davi');

  // Teste de Reset isolado: resetar Davi não afeta Marcos
  resetUserMemory(db, phoneDavi);
  const summaryDaviAfterReset = getUserPersonalizationSummary(db, phoneDavi, '2026-09-29');
  const summaryMarcosAfterDaviReset = getUserPersonalizationSummary(db, phoneMarcos, '2026-09-29');

  assert(summaryDaviAfterReset.generationId === 2, 'Davi avançou para generation_id 2 após /reset');
  assert(summaryDaviAfterReset.topPersonalizedTopics.length === 0, 'Memória de tópicos de Davi purgada após reset');
  assert(summaryMarcosAfterDaviReset.generationId === 1, 'ISOLAMENTO: generation_id de Marcos permaneceu 1');
  assert(summaryMarcosAfterDaviReset.topPersonalizedTopics.includes('carros_travados'), 'ISOLAMENTO: Memória de Marcos permanece intacta');

  // Reconfigura Davi para os testes de briefing subsequentes
  recordDailyTopic(db, phoneDavi, 'cmv_oleo', { date: '2026-09-28', lojaSlug: 'jabaquara' });
  recordDailyTopic(db, phoneDavi, 'cmv_oleo', { date: '2026-09-29', lojaSlug: 'jabaquara' });

  // ---------------------------------------------------------------------------
  // TESTE 3: Execução do Briefing em Modo Preview (--preview)
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('TESTE 3: Execução do Briefing em Modo Preview (--preview)');
  console.log('----------------------------------------------------------------');

  const mockConsolidado = createMockConsolidadoRede('2026-09-30');
  let customSenderCalledCount = 0;

  const spySender = async (phone: string, text: string) => {
    customSenderCalledCount++;
    return { statusHttp: 201, sucesso: true };
  };

  const previewResults = await executarAuditoriaEBriefing({
    preview: true,
    db,
    destinatarios: [phoneDavi, phoneMarcos],
    consolidadoRede: mockConsolidado,
    customWhatsAppSender: spySender,
    dataReferencia: '2026-09-30'
  });

  assert(previewResults.length === 2, 'Retornou preview para os 2 destinatários');
  assert(previewResults[0].statusEnvio === 'preview', 'Destinatário 1 marcado com status preview');
  assert(previewResults[1].statusEnvio === 'preview', 'Destinatário 2 marcado com status preview');
  assert(previewResults[0].mensagem.length > 50, 'Mensagem formatada gerada no preview para Davi');
  assert(previewResults[1].mensagem.length > 50, 'Mensagem formatada gerada no preview para Marcos');
  assert(previewResults[0].payloadHash.length === 64, 'Hash SHA-256 do payload calculado com 64 chars');
  assert(customSenderCalledCount === 0, 'REGRA PREVIEW: Nenhuma mensagem foi disparada para WhatsApp/Evolution API');

  // Verifica personalização no briefing de Marcos (carros travados em santoandre)
  assert(previewResults[1].topicos.includes('carros_travados'), 'Briefing de Marcos inclui tópico personalizado carros_travados');
  assert(previewResults[1].mensagem.includes('Carros Travados (santoandre)'), 'Mensagem formatada de Marcos contém destaque personalizado');

  // Verifica que nada foi gravado como enviado na tabela de despachos
  const dispatchDaviPreview = getBriefingDispatch(db, '2026-09-30', phoneDavi, 'briefing_executivo');
  const dispatchMarcosPreview = getBriefingDispatch(db, '2026-09-30', phoneMarcos, 'briefing_executivo');
  assert(dispatchDaviPreview === null, 'Nenhum registro de despacho criado para Davi em preview');
  assert(dispatchMarcosPreview === null, 'Nenhum registro de despacho criado para Marcos em preview');

  // ---------------------------------------------------------------------------
  // TESTE 4: Idempotência de Despacho e REGRA DE OURO (HTTP 201)
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('TESTE 4: Idempotência de Despacho e REGRA DE OURO (HTTP 201)');
  console.log('----------------------------------------------------------------');

  const dataRef = '2026-09-30';
  const tipoRel = 'briefing_executivo';
  const phoneAuditoria = '5511996242812';

  // 4.1 Falha de envio (HTTP 500): DEVE gravar 'falha' e NÃO marcar enviado
  let sendAttempts = 0;
  const failSender = async (phone: string, text: string) => {
    sendAttempts++;
    return { statusHttp: 500, sucesso: false, error: 'Evolution API Timeout' };
  };

  const failResults = await executarAuditoriaEBriefing({
    preview: false,
    sendWhatsApp: true,
    autoYes: true,
    db,
    destinatarios: [phoneAuditoria],
    consolidadoRede: mockConsolidado,
    customWhatsAppSender: failSender,
    dataReferencia: dataRef
  });

  assert(failResults[0].statusEnvio === 'falha', 'Resultado do envio marcado como falha');
  const recordAposFalha = getBriefingDispatch(db, dataRef, phoneAuditoria, tipoRel);
  assert(recordAposFalha !== null, 'Registro de despacho criado na tabela');
  assert(recordAposFalha?.status_envio === 'falha', 'REGRA DE OURO: Falha gravada como "falha"');
  assert(!isBriefingAlreadyDispatched(db, dataRef, phoneAuditoria, tipoRel), 'isBriefingAlreadyDispatched retorna FALSE em caso de falha');

  // 4.2 Falha com HTTP 200 (não 201): Evolution API exige estritamente 201 Created
  const non201Sender = async (phone: string, text: string) => {
    sendAttempts++;
    return { statusHttp: 200, sucesso: true }; // HTTP 200 sem ser 201
  };

  await executarAuditoriaEBriefing({
    preview: false,
    sendWhatsApp: true,
    autoYes: true,
    db,
    destinatarios: [phoneAuditoria],
    consolidadoRede: mockConsolidado,
    customWhatsAppSender: non201Sender,
    dataReferencia: dataRef
  });

  const recordNon201 = getBriefingDispatch(db, dataRef, phoneAuditoria, tipoRel);
  assert(recordNon201?.status_envio === 'falha', 'REGRA DE OURO: HTTP 200 (não 201) é gravado como "falha"');

  // 4.3 Sucesso rigoroso pós-confirmação HTTP 201 Created: DEVE gravar 'enviado'
  let successAttempts = 0;
  const successSender = async (phone: string, text: string) => {
    successAttempts++;
    return { statusHttp: 201, sucesso: true };
  };

  const successResults = await executarAuditoriaEBriefing({
    preview: false,
    sendWhatsApp: true,
    autoYes: true,
    db,
    destinatarios: [phoneAuditoria],
    consolidadoRede: mockConsolidado,
    customWhatsAppSender: successSender,
    dataReferencia: dataRef
  });

  assert(successResults[0].statusEnvio === 'enviado', 'Resultado marcado como enviado');
  const recordAposSucesso = getBriefingDispatch(db, dataRef, phoneAuditoria, tipoRel);
  assert(recordAposSucesso?.status_envio === 'enviado', 'REGRA DE OURO: Status "enviado" gravado após HTTP 201');
  assert(recordAposSucesso?.payload_hash === successResults[0].payloadHash, 'Hash do payload gravado com precisão');
  assert(isBriefingAlreadyDispatched(db, dataRef, phoneAuditoria, tipoRel), 'isBriefingAlreadyDispatched retorna TRUE após HTTP 201');
  assert(successAttempts === 1, 'Disparador executado exatamente 1 vez');

  // 4.4 Idempotência Estrita no Rerun (Mesmo dia e tipo): DEVE suprimir envio
  const rerunResults = await executarAuditoriaEBriefing({
    preview: false,
    sendWhatsApp: true,
    autoYes: true,
    db,
    destinatarios: [phoneAuditoria],
    consolidadoRede: mockConsolidado,
    customWhatsAppSender: successSender, // Mesmo sender
    dataReferencia: dataRef
  });

  assert(rerunResults[0].puladoPorIdempotencia === true, 'IDEMPOTÊNCIA: Envio marcado como pulado por idempotência');
  assert(rerunResults[0].statusEnvio === 'enviado', 'Status permanece enviado');
  assert(successAttempts === 1, 'IDEMPOTÊNCIA: Disparador NÃO foi invocado no rerun (zero disparo duplicado)');

  // ---------------------------------------------------------------------------
  // FINALIZAÇÃO E SUMÁRIO
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🎉 RESULTADO FINAL: ${passedTests}/${totalTests} ASSERÇÕES PASSARAM COM SUCESSO!`);
  console.log('   100% PASS — Todas as especificações e regras de ouro cumpridas.');
  console.log('================================================================\n');
}

runAllTests().catch(err => {
  console.error('\n❌ ERRO FATAL NOS TESTES:', err);
  process.exit(1);
});
