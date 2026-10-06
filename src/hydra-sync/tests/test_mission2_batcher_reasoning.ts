import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MessageBatcher } from '../message_batcher.js';
import { rewriteIntent } from '../intent_rewriter.js';
import {
  queryGoogleCentralMediaSurvey,
  type GoogleCentralMediaSurveyResult
} from '../db_repository.js';
import {
  executeOperationalQuery,
  formatGoogleCentralWhatsAppReply
} from '../operational_adapter.js';
import type { MessageBatchPayload } from '../types/multimodal_contract.js';
import type { InboundPart } from '../types/conversation_contract.js';

console.log('🧪 Iniciando TEST HARNESS DEDICADO: Missão 2 - Batcher, Concorrência, Negação & Google+Central...');

let passed = 0;
let failed = 0;

function ok(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runTests() {
  // =========================================================================
  // 1. CALIBRAÇÃO DA JANELA DO MESSAGEBATCHER
  // =========================================================================
  console.log('\n--- 1. Calibração da Janela do MessageBatcher (1.5s / 5s) ---');

  // 1.1 Configuração padrão
  const defaultBatcher = new MessageBatcher();
  ok(defaultBatcher.getDebounceMs() === 1500, '1.1: Debounce padrão calibrado em 1.500 ms');
  ok(defaultBatcher.getMaxWindowMs() === 5000, '1.1: Janela máxima padrão calibrada em 5.000 ms');

  // 1.2 Configuração via parâmetros do construtor
  const customBatcher = new MessageBatcher({ debounceMs: 2000, maxWindowMs: 6000 });
  ok(customBatcher.getDebounceMs() === 2000, '1.2: Debounce customizável via construtor');
  ok(customBatcher.getMaxWindowMs() === 6000, '1.2: Janela máxima customizável via construtor');

  // 1.3 Configuração via variáveis de ambiente
  process.env.HYDRA_BATCH_DEBOUNCE_MS = '1800';
  process.env.HYDRA_BATCH_MAX_WINDOW_MS = '5500';
  const envBatcher = new MessageBatcher();
  ok(envBatcher.getDebounceMs() === 1800, '1.3: Debounce customizável via env HYDRA_BATCH_DEBOUNCE_MS');
  ok(envBatcher.getMaxWindowMs() === 5500, '1.3: Janela máxima customizável via env HYDRA_BATCH_MAX_WINDOW_MS');
  delete process.env.HYDRA_BATCH_DEBOUNCE_MS;
  delete process.env.HYDRA_BATCH_MAX_WINDOW_MS;

  // 1.4 Agrupamento de 2 mensagens em janelas de 100-200ms
  let receivedBatch: MessageBatchPayload | null = null;
  const testBatcher = new MessageBatcher({
    debounceMs: 200,
    maxWindowMs: 800
  });

  const part1: InboundPart = {
    partId: 'p1',
    messageId: 'msg_001',
    conversationKey: '5511999990001',
    kind: 'text', type: 'text',
    receivedAt: new Date().toISOString(),
    text: 'qual o faturamento',
    timestamp: Date.now()
  };

  const part2: InboundPart = {
    partId: 'p2',
    messageId: 'msg_002',
    conversationKey: '5511999990001',
    kind: 'text', type: 'text',
    receivedAt: new Date().toISOString(),
    text: 'de santo andre?',
    timestamp: Date.now() + 50
  };

  testBatcher.addMessage(part1, undefined, async (b) => {
    receivedBatch = b;
  });

  // Mensagem 2 após 50ms (dentro da janela)
  await new Promise((r) => setTimeout(r, 50));
  testBatcher.addMessage(part2, undefined, async (b) => {
    receivedBatch = b;
  });

  // Aguarda disparo do lote (200ms após msg 2)
  await new Promise((r) => setTimeout(r, 300));
  ok(receivedBatch !== null, '1.4: Lote de 2 mensagens disparado após janela');
  ok((receivedBatch as any)?.messageIds?.length === 2, '1.4: Lote unificou exatamente 2 messageIds');
  ok((receivedBatch as any)?.combinedText === 'qual o faturamento de santo andre?', '1.4: Texto unificado corretamente');

  // =========================================================================
  // 2. CONCORRÊNCIA E COMPLEMENTO DURANTE GERAÇÃO ("DIGITANDO...")
  // =========================================================================
  console.log('\n--- 2. Concorrência e Complemento Durante Geração (Typing) ---');

  const chatKey = '5511999990002';
  let batchEvents: MessageBatchPayload[] = [];
  const complementBatcher = new MessageBatcher({
    debounceMs: 150,
    maxWindowMs: 800
  });

  const initPart: InboundPart = {
    partId: 'p_init',
    messageId: 'msg_init',
    conversationKey: chatKey,
    kind: 'text', type: 'text',
    receivedAt: new Date().toISOString(),
    text: 'qual o faturamento de jorge beretta',
    timestamp: Date.now()
  };

  complementBatcher.addMessage(initPart, undefined, async (payload) => {
    batchEvents.push(payload);
  });

  await new Promise((r) => setTimeout(r, 220));
  ok(batchEvents.length === 1, '2.1: Primeiro lote disparado');
  const firstBatch = batchEvents[0];
  const firstBatchId = firstBatch.batchId;

  // 2.2 Simula que a geração está em andamento (in-flight)
  complementBatcher.markInFlight(chatKey, firstBatch);
  ok(complementBatcher.isInFlight(chatKey), '2.2: Chat marcado em geração in-flight');
  ok(!complementBatcher.isBatchObsolete(firstBatchId), '2.2: Lote inicial ainda é válido');

  // 2.3 Enquanto gera, usuário manda retificação ("não, de santo andré")
  const correctPart: InboundPart = {
    partId: 'p_correct',
    messageId: 'msg_correct',
    conversationKey: chatKey,
    kind: 'text', type: 'text',
    receivedAt: new Date().toISOString(),
    text: 'não, de santo andré',
    timestamp: Date.now()
  };

  complementBatcher.addMessage(correctPart, undefined, async (payload) => {
    batchEvents.push(payload);
  });

  // Verifica que o lote anterior foi imediatamente invalidado
  ok(complementBatcher.isBatchObsolete(firstBatchId), '2.3: Lote inicial marcado como obsoleto');

  // Aguarda disparo do lote complemento
  await new Promise((r) => setTimeout(r, 250));
  ok(batchEvents.length === 2, '2.3: Segundo lote (complemento) gerado');
  const compBatch = batchEvents[1];
  ok(compBatch.isComplement === true, '2.3: Flag isComplement=true no lote substituto');
  ok(compBatch.supersededBatchId === firstBatchId, '2.3: Referência ao lote substituído preservada');
  ok(compBatch.messageIds.includes('msg_init') && compBatch.messageIds.includes('msg_correct'), '2.3: messageIds de ambos os lotes unificados');
  ok(!compBatch.combinedText.toLowerCase().includes('jorge beretta'), '2.3: Texto expurgou a loja rejeitada (Jorge Beretta)');
  ok(compBatch.combinedText.toLowerCase().includes('santo andré'), '2.3: Texto unificado contém a loja retificada (Santo André)');

  complementBatcher.clearInFlight(chatKey, firstBatchId);
  ok(!complementBatcher.isInFlight(chatKey), '2.4: In-flight limpo com sucesso');

  // =========================================================================
  // 3. RESOLUÇÃO DE NEGAÇÃO EXPLÍCITA E ESCOPO (MULTI-TURNO & INTRA-LOTE)
  // =========================================================================
  console.log('\n--- 3. Resolução de Negação Explícita e Escopo (Multi-turno & Intra-lote) ---');

  // 3.1 Multi-turno: Santo André -> "não, da rede"
  const previousStateSantoAndre = {
    turnId: 'turn_01',
    lastIntent: 'financial_alerts',
    lojaSlug: 'MPSantoAndre',
    lastContract: {
      version: '1.0.0',
      turnId: 'turn_01',
      timestamp: new Date().toISOString(),
      decision: 'execute' as const,
      operation: 'financial_alerts' as const,
      entities: {},
      filters: { subIntent: 'single_store' as const },
      turnRelation: { type: 'new_query' as const, inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: 'Consultar faturamento e metas de Santo André.'
    }
  };

  const rewrittenRede = rewriteIntent('não, da rede', previousStateSantoAndre as any);
  ok(rewrittenRede.intent === 'financial_alerts', '3.1: Mantém operação financial_alerts no turno');
  ok(rewrittenRede.lojaSlug === undefined, '3.1: lojaSlug foi desvinculado (undefined) sem contaminação');
  ok(rewrittenRede.canonicalQuestion.includes('rede'), '3.1: Questão canônica reflete escopo de rede');

  // 3.2 Multi-turno: Jorge Beretta -> "não, de Santo André"
  const previousStateJorge = {
    turnId: 'turn_02',
    lastIntent: 'financial_alerts',
    lojaSlug: 'MPJorgeBeretta',
    lastContract: {
      version: '1.0.0',
      turnId: 'turn_02',
      timestamp: new Date().toISOString(),
      decision: 'execute' as const,
      operation: 'financial_alerts' as const,
      entities: {},
      filters: { subIntent: 'single_store' as const },
      turnRelation: { type: 'new_query' as const, inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: 'Consultar faturamento e metas de Jorge Beretta.'
    }
  };

  const rewrittenStoAndre = rewriteIntent('não, de Santo André', previousStateJorge as any);
  ok(rewrittenStoAndre.intent === 'financial_alerts', '3.2: Mantém operação financial_alerts');
  ok(rewrittenStoAndre.lojaSlug === 'MPSantoAndre', '3.2: Loja corrigida com precisão para MPSantoAndre');
  ok(rewrittenStoAndre.canonicalQuestion.includes('Santo André'), '3.2: Questão canônica reflete Santo André');

  // 3.3 Intra-lote com retificação: "qual o faturamento de jorge beretta / não, de santo andré"
  const rewrittenIntra = rewriteIntent('qual o faturamento de jorge beretta não, de santo andré');
  ok(rewrittenIntra.lojaSlug === 'MPSantoAndre', '3.3: Intra-lote com negação direta resolve para MPSantoAndre');
  ok(rewrittenIntra.lojaSlug !== 'MPJorgeBeretta', '3.3: Intra-lote rejeitou expressamente MPJorgeBeretta');

  // 3.4 Multi-turno com CMV: CMV Santo André -> "não, da rede"
  const previousStateCMV = {
    turnId: 'turn_03',
    lastIntent: 'store_cmv',
    lojaSlug: 'MPSantoAndre',
    lastContract: {
      version: '1.0.0',
      turnId: 'turn_03',
      timestamp: new Date().toISOString(),
      decision: 'execute' as const,
      operation: 'store_cmv' as const,
      entities: {},
      filters: { subIntent: 'single_store' as const },
      turnRelation: { type: 'new_query' as const, inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: 'Consultar CMV e margem bruta de Santo André.'
    }
  };

  const rewrittenCMVRede = rewriteIntent('não, da rede', previousStateCMV as any);
  ok(rewrittenCMVRede.intent === 'store_cmv', '3.4: Operação de CMV mantida');
  ok(rewrittenCMVRede.scope === 'network', '3.4: Escopo corrigido para network');
  ok(rewrittenCMVRede.lojaSlug === undefined, '3.4: lojaSlug desvinculado (undefined)');

  // =========================================================================
  // 4. ROTEAMENTO DE INTENÇÃO: "GOOGLE + CENTRAL POR LOJA"
  // =========================================================================
  console.log('\n--- 4. Roteamento de Intenção: Google + Central por Loja ---');

  // 4.1 "Google + Central por Loja"
  const intentGC1 = rewriteIntent('Google + Central por Loja');
  ok(intentGC1.intent === 'media_survey', '4.1: "Google + Central por Loja" roteado para media_survey');
  ok(intentGC1.lojaSlug === undefined, '4.1: Escopo por loja deixa lojaSlug undefined para agregação comparativa');
  ok(intentGC1.canonicalQuestion.toLowerCase().includes('google'), '4.1: Questão canônica inclui Google');
  ok(intentGC1.canonicalQuestion.toLowerCase().includes('central'), '4.1: Questão canônica inclui Central');
  ok(intentGC1.canonicalQuestion.toLowerCase().includes('por loja'), '4.1: Questão canônica indica "por loja"');

  // 4.2 "google e central de atendimento de santo andre"
  const intentGC2 = rewriteIntent('google e central de atendimento de santo andre');
  ok(intentGC2.intent === 'media_survey', '4.2: Roteado para media_survey');
  ok(intentGC2.lojaSlug === 'MPSantoAndre', '4.2: Identificou MPSantoAndre');

  // 4.3 "pesquisa de midia google e central"
  const intentGC3 = rewriteIntent('pesquisa de midia google e central');
  ok(intentGC3.intent === 'media_survey', '4.3: Roteado para media_survey');

  // =========================================================================
  // 5. CONSULTA SQL E FORMATAÇÃO WHATSAPP DE GOOGLE & CENTRAL
  // =========================================================================
  console.log('\n--- 5. Consulta SQL e Formatação WhatsApp (Google x Central) ---');

  const db = new Database('fixtures/test_hydra.db');

  // 5.1 Consulta individual de loja com ambos os canais (Santo André)
  const gcSantoAndre = queryGoogleCentralMediaSurvey(db, { lojaSlug: 'MPSantoAndre' });
  ok(gcSantoAndre.status === 'sucesso', '5.1: Status de Santo André é sucesso');
  ok(gcSantoAndre.storeResult !== undefined, '5.1: storeResult retornado');
  ok(gcSantoAndre.storeResult?.canalGoogle !== null, '5.1: Canal Google identificado');
  ok(gcSantoAndre.storeResult?.canalCentral !== null, '5.1: Canal Central identificado');
  ok(gcSantoAndre.storeResult?.canalGoogle?.qtdOS === 40, '5.1: Quantidade de OS Google Santo André correta (40)');
  ok(gcSantoAndre.storeResult?.canalCentral?.qtdOS === 35, '5.1: Quantidade de OS Central Santo André correta (35)');

  // 5.2 Formatação WhatsApp individual
  const replySantoAndre = formatGoogleCentralWhatsAppReply({ result: gcSantoAndre, lojaSlug: 'MPSantoAndre' });
  ok(replySantoAndre.includes('*Google / Internet:*'), '5.2: Formatação inclui Google / Internet');
  ok(replySantoAndre.includes('*Central de Atendimento:*'), '5.2: Formatação inclui Central de Atendimento');
  ok(replySantoAndre.includes('TK R$'), '5.2: Informa ticket médio (TK)');
  ok(replySantoAndre.includes('OSs'), '5.2: Informa quantidade de OSs');
  ok(replySantoAndre.includes('Santo André'), '5.2: Nome amigável de Santo André exibido');

  // 5.3 Consulta comparativa da rede ("por loja")
  const gcRede = queryGoogleCentralMediaSurvey(db, { lojaSlug: undefined });
  ok(gcRede.status === 'sucesso', '5.3: Status comparativo é sucesso');
  ok((gcRede.lojasApuradas?.length || 0) >= 2, '5.3: Pelo menos 2 lojas apuradas');
  ok(gcRede.lojasSemDados !== undefined, '5.3: Lojas sem dados mapeadas');

  // 5.4 Formatação comparativa WhatsApp
  const replyRede = formatGoogleCentralWhatsAppReply({ result: gcRede, lojaSlug: undefined });
  ok(replyRede.includes('Google') && replyRede.includes('Central'), '5.4: Header comparativo menciona Google e Central');
  ok(replyRede.includes('Santo André'), '5.4: Lista Santo André no comparativo');
  ok(replyRede.includes('Jorge Beretta'), '5.4: Lista Jorge Beretta no comparativo');
  ok(replyRede.includes('Central: R$'), '5.4: Detalha faturamento da Central por loja');
  ok(replyRede.includes('Google: R$'), '5.4: Detalha faturamento do Google por loja');

  // 5.5 Tratamento de ausência transparente (loja sem Central)
  // Dom Pedro no fixtures não tem canal de mídia registrado
  const gcDomPedro = queryGoogleCentralMediaSurvey(db, { lojaSlug: 'MPdompedro1' });
  const replyDomPedro = formatGoogleCentralWhatsAppReply({ result: gcDomPedro, lojaSlug: 'MPdompedro1' });
  ok(replyDomPedro.includes('não disponíveis') || replyDomPedro.includes('Sem registros de captação') || replyDomPedro.includes('não há registros'), '5.5: Informa ausência de forma transparente sem simular R$ 0,00 ou quebrar');

  // 5.6 Integração ponta-a-ponta via executeOperationalQuery
  const execResult = await executeOperationalQuery(db, {
    turnId: 'turn_test_gc',
    canonicalQuestion: 'Consultar canais Google e Central de Atendimento por loja.',
    intent: 'media_survey',
    contract: {
      version: '1.0.0',
      turnId: 'turn_test_gc',
      timestamp: new Date().toISOString(),
      decision: 'execute',
      operation: 'media_survey',
      entities: {},
      filters: {},
      turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
      ambiguity: { isAmbiguous: false },
      canonicalQuestion: 'Consultar canais Google e Central de Atendimento por loja.',
      plan: {
        operation: 'media_survey',
        entities: {},
        filters: {}
      }
    }
  });

  ok(execResult.source === 'SQL_EXACT', '5.6: Fonte é SQL_EXACT');
  ok(execResult.toolsCalled.includes('get_media_survey'), '5.6: get_media_survey disparado');
  ok(execResult.replyText.includes('Google') && execResult.replyText.includes('Central'), '5.6: Resposta contém análise de Google e Central');

  console.log(`\n========================================================`);
  console.log(`🏆 RESULTADO FINAL MISSÃO 2 DEDICADO: ${passed}/${passed + failed} TESTES APROVADOS!`);
  console.log(`========================================================\n`);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
