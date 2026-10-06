/**
 * src/hydra-sync/tests/test_executor1_interpretation_repair.ts
 *
 * Suíte de Testes do Executor 1 (Fase E1 - Interpretação Semântica e Reparação de Turnos)
 *
 * Cobertura Obrigatória (Spec hydra-linea-runtime-repair):
 * [E1-01] A colisão exata de "nao foi isso que perguntei cara":
 *   - Descartar "cara" como busca/consulta e NÃO cair em historico
 * [E1-02] Variantes de gírias:
 *   - "nn foi isso que pedi", "n foi isso", "nao era isso", "desculpe nn foi isso"
 *   - Descarte de fillers ("cara", "mano", "por favor", "pfv", "velho", "amigo")
 * [E1-03] Preservação de alvo e geração de TurnPendingRequest:
 *   - Rastreabilidade de geraçãoId e deliveryStatus ('MISUNDERSTOOD', 'DELIVERED')
 * [E1-04] Desambiguação estrita de histórico:
 *   - "o que eu perguntei", "minha pergunta anterior", "resumo das perguntas"
 *   - "isso que perguntei" NUNCA ativa histórico
 * [E1-05] Diferenciação entre consulta individual e agregação:
 *   - "quantos Linea temos?" -> VEHICLE_COUNT
 *   - "liste os Linea" -> VEHICLE_LIST
 *   - "como está o Jabaquara hoje?" -> STORE_SUMMARY
 *   - "Caso do Linea / por que esta parado" -> DELAY_REASON
 *   - Perguntas elípticas ("e por que ele está parado?", "por que ta parado?") herdando pendingRequest
 */

import assert from 'node:assert/strict';
import {
  rewriteIntent,
  extrairVeiculoExplicitamente,
  normalizarTexto
} from '../intent_rewriter.js';
import {
  stripFillerWords,
  isCorrectionMessage,
  extractStrippedCorrection,
  isConversationHistoryStrict,
  isDelayReasonQuery,
  isVehicleCountQuery,
  isVehicleListQuery,
  isStoreSummaryQuery
} from '../conversation_semantic_resolver.js';
import type {
  ExtendedTurnState,
  TurnPendingRequest
} from '../types/conversation_context_contract.js';

let totalTests = 0;
let passedTests = 0;

async function it(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

async function runInterpretationRepairTests() {
  console.log('🚀 Iniciando Suíte de Testes do Executor 1: Interpretação, Reparação e Semântica...\n');

  // =========================================================================
  // BLOCO 1: COLISÃO EXATA DE "nao foi isso que perguntei cara" E FILLERS
  // =========================================================================
  console.log('--- [BLOCO 1] Colisão de Correção vs Histórico e Descarte de Fillers ---');

  await it('1.1. "nao foi isso que perguntei cara" NÃO ativa histórico de conversa', () => {
    const input = 'nao foi isso que perguntei cara';
    const norm = normalizarTexto(input);
    const isHistory = isConversationHistoryStrict(norm);
    assert.equal(isHistory, false, 'Não deve ser classificado como histórico');

    const result = rewriteIntent(input);
    assert.notEqual(result.intent, 'conversation_history', 'Intent não pode ser conversation_history');
    assert.notEqual(result.operation, 'CONVERSATION_HISTORY', 'Operation não pode ser CONVERSATION_HISTORY');
  });

  await it('1.2. "nao foi isso que perguntei cara" descarta "cara" como consulta substantiva', () => {
    const norm = normalizarTexto('nao foi isso que perguntei cara');
    const { stripped, substantive, hasSubstantiveQuery } = extractStrippedCorrection(norm);
    assert.equal(stripped, 'cara', 'Stripped deve conter apenas cara');
    assert.equal(substantive, '', 'Substantive deve estar vazio após stripFillerWords');
    assert.equal(hasSubstantiveQuery, false, 'hasSubstantiveQuery deve ser falso');
  });

  await it('1.3. "nao foi isso que perguntei cara" classifica como conversation_correction e CONVERSATION_REPAIR', () => {
    const result = rewriteIntent('nao foi isso que perguntei cara');
    assert.equal(result.intent, 'conversation_correction');
    assert.equal(result.operation, 'CONVERSATION_REPAIR');
    assert.equal(result.operationType, 'CONVERSATION_REPAIR');
  });

  await it('1.4. Descarte de múltiplos fillers ("mano", "por favor", "pfv", "velho", "amigo")', () => {
    assert.equal(stripFillerWords('cara'), '');
    assert.equal(stripFillerWords('mano'), '');
    assert.equal(stripFillerWords('por favor'), '');
    assert.equal(stripFillerWords('pfv'), '');
    assert.equal(stripFillerWords('velho'), '');
    assert.equal(stripFillerWords('amigo'), '');
    assert.equal(stripFillerWords('mano por favor'), '');
    assert.equal(stripFillerWords('cara pfv amigo'), '');

    // Quando há termo substantivo junto com fillers
    assert.equal(stripFillerWords('cara, quero saber do faturamento'), 'quero saber do faturamento');
    assert.equal(stripFillerWords('por favor quero as ordens de hoje'), 'quero as ordens de hoje');
  });

  await it('1.5. Correção substantiva retificada com filler mantém termo substantivo', () => {
    const result = rewriteIntent('nao foi isso cara, quanto faturou o Jabaquara hoje?');
    assert.equal(result.intent, 'financial_alerts');
    assert(result.lojaSlug === 'MPJabaquara' || result.lojaSlug === 'jabaquara');
  });

  // =========================================================================
  // BLOCO 2: VARIANTES DE CORREÇÃO E GÍRIAS (nn, n, nao era isso, etc.)
  // =========================================================================
  console.log('\n--- [BLOCO 2] Variantes de Correção e Gírias (nn, n, etc.) ---');

  await it('2.1. "nn foi isso que pedi" reconhecido como correção conversacional', () => {
    const result = rewriteIntent('nn foi isso que pedi');
    assert.equal(result.intent, 'conversation_correction');
    assert.equal(result.operation, 'CONVERSATION_REPAIR');
  });

  await it('2.2. "n foi isso" reconhecido como correção conversacional', () => {
    const result = rewriteIntent('n foi isso');
    assert.equal(result.intent, 'conversation_correction');
    assert.equal(result.operation, 'CONVERSATION_REPAIR');
  });

  await it('2.3. "nao era isso" reconhecido como correção conversacional', () => {
    const result = rewriteIntent('nao era isso');
    assert.equal(result.intent, 'conversation_correction');
    assert.equal(result.operation, 'CONVERSATION_REPAIR');
  });

  await it('2.4. "desculpe nn foi isso" reconhecido como correção conversacional', () => {
    const result = rewriteIntent('desculpe nn foi isso');
    assert.equal(result.intent, 'conversation_correction');
    assert.equal(result.operation, 'CONVERSATION_REPAIR');
  });

  await it('2.5. "perdao n foi isso" e "nn era isso" reconhecidos como correção', () => {
    const r1 = rewriteIntent('perdao n foi isso');
    assert.equal(r1.intent, 'conversation_correction');
    assert.equal(r1.operation, 'CONVERSATION_REPAIR');

    const r2 = rewriteIntent('nn era isso');
    assert.equal(r2.intent, 'conversation_correction');
    assert.equal(r2.operation, 'CONVERSATION_REPAIR');
  });

  await it('2.6. "nn foi isso que pedi" NÃO cai em falso positivo de saudação (subterfúgio oi/foi)', () => {
    const norm = normalizarTexto('nn foi isso que pedi');
    const isCorr = isCorrectionMessage(norm);
    assert.equal(isCorr, true, 'isCorrectionMessage deve ser verdadeiro para nn');

    const result = rewriteIntent('nn foi isso que pedi');
    assert.equal(result.intent, 'conversation_correction');
    assert.notEqual(result.intent, 'other');
  });

  // =========================================================================
  // BLOCO 3: PRESERVAÇÃO DO ALVO E GERAÇÃO DE TurnPendingRequest
  // =========================================================================
  console.log('\n--- [BLOCO 3] Preservação de Alvo e TurnPendingRequest ---');

  await it('3.1. Turno 1 ("Caso do Linea") gera TurnPendingRequest com VEHICLE_SITUATION', () => {
    const result = rewriteIntent('Caso do Linea');
    assert.equal(result.operation, 'VEHICLE_SITUATION');
    assert.equal(result.veiculo, 'Linea');
    assert.equal(result.vehicleModel, 'Linea');
    assert.ok(result.pendingRequest, 'pendingRequest deve estar presente');
    assert.equal(result.pendingRequest?.operation, 'VEHICLE_SITUATION');
    assert.equal(result.pendingRequest?.targetModel, 'Linea');
    assert.equal(result.pendingRequest?.deliveryStatus, 'DELIVERED');
    assert.equal(result.pendingRequest?.generationId, 1);
  });

  await it('3.2. Turno 2 de correção preserva alvo Linea e marca MISUNDERSTOOD', () => {
    const turn1Pending: TurnPendingRequest = {
      originalUserPrompt: 'Caso do Linea',
      operation: 'VEHICLE_SITUATION',
      targetModel: 'Linea',
      targetLojaSlug: 'MPJabaquara',
      generationId: 1,
      requestedAt: new Date().toISOString(),
      deliveryStatus: 'DELIVERED'
    };

    const previousState: ExtendedTurnState = {
      phone: '5511999998888',
      lastTurnId: 'turn_1',
      lastIntent: 'service_search',
      lojaSlug: 'MPJabaquara',
      vehicleModel: 'Linea',
      pendingRequest: turn1Pending,
      updatedAt: new Date().toISOString()
    };

    const result = rewriteIntent('nao foi isso que perguntei cara', previousState);
    assert.equal(result.intent, 'conversation_correction');
    assert.equal(result.operation, 'CONVERSATION_REPAIR');
    assert.equal(result.vehicleModel, 'Linea', 'Deve preservar vehicleModel Linea');
    assert.equal(result.lojaSlug, 'MPJabaquara', 'Deve preservar lojaSlug MPJabaquara');
    assert.ok(result.pendingRequest, 'pendingRequest deve estar presente');
    assert.equal(result.pendingRequest?.targetModel, 'Linea');
    assert.equal(result.pendingRequest?.targetLojaSlug, 'MPJabaquara');
    assert.equal(result.pendingRequest?.deliveryStatus, 'MISUNDERSTOOD', 'Status deve ser MISUNDERSTOOD');
    assert.equal(result.pendingRequest?.generationId, 2, 'generationId deve ser incrementado para 2');
  });

  // =========================================================================
  // BLOCO 4: DESAMBIGUAÇÃO ESTRITA DE HISTÓRICO
  // =========================================================================
  console.log('\n--- [BLOCO 4] Desambiguação Estrita de Histórico ---');

  await it('4.1. Consultas legítimas de histórico ativam CONVERSATION_HISTORY', () => {
    const queries = [
      'o que eu perguntei',
      'minha pergunta anterior',
      'resumo das perguntas',
      'o que te perguntei',
      'o que eu perguntei antes'
    ];

    for (const q of queries) {
      const norm = normalizarTexto(q);
      assert.equal(isConversationHistoryStrict(norm), true, `Deveria ser histórico: "${q}"`);
      const res = rewriteIntent(q);
      assert.equal(res.intent, 'conversation_history', `Intent de "${q}" deve ser conversation_history`);
      assert.equal(res.operation, 'CONVERSATION_HISTORY', `Operation de "${q}" deve ser CONVERSATION_HISTORY`);
    }
  });

  await it('4.2. Expressões com "isso que perguntei" JAMAIS ativam histórico', () => {
    const antiQueries = [
      'nao foi isso que perguntei cara',
      'isso que perguntei',
      'nn foi isso que perguntei',
      'n foi isso que perguntei',
      'nao era isso que perguntei'
    ];

    for (const q of antiQueries) {
      const norm = normalizarTexto(q);
      assert.equal(isConversationHistoryStrict(norm), false, `NÃO pode ser histórico: "${q}"`);
      const res = rewriteIntent(q);
      assert.notEqual(res.intent, 'conversation_history', `Intent de "${q}" NÃO pode ser conversation_history`);
      assert.notEqual(res.operation, 'CONVERSATION_HISTORY', `Operation de "${q}" NÃO pode ser CONVERSATION_HISTORY`);
    }
  });

  // =========================================================================
  // BLOCO 5: DIFERENCIAÇÃO ENTRE CONSULTA INDIVIDUAL E AGREGAÇÃO
  // =========================================================================
  console.log('\n--- [BLOCO 5] Consulta Individual vs Agregação Legítima ---');

  await it('5.1. Agregação VEHICLE_COUNT: "quantos Linea temos?"', () => {
    const result = rewriteIntent('quantos Linea temos?');
    assert.equal(result.operation, 'VEHICLE_COUNT');
    assert.equal(result.vehicleModel, 'Linea');
    assert.equal(result.intent, 'list_os');
    assert.ok(result.pendingRequest);
    assert.equal(result.pendingRequest?.operation, 'VEHICLE_COUNT');
    assert.equal(result.pendingRequest?.targetModel, 'Linea');
  });

  await it('5.2. Agregação VEHICLE_LIST: "liste os Linea"', () => {
    const result = rewriteIntent('liste os Linea');
    assert.equal(result.operation, 'VEHICLE_LIST');
    assert.equal(result.vehicleModel, 'Linea');
    assert.equal(result.intent, 'list_os');
    assert.ok(result.pendingRequest);
    assert.equal(result.pendingRequest?.operation, 'VEHICLE_LIST');
    assert.equal(result.pendingRequest?.targetModel, 'Linea');
  });

  await it('5.3. Agregação STORE_SUMMARY: "como está o Jabaquara hoje?"', () => {
    const result = rewriteIntent('como está o Jabaquara hoje?');
    assert.equal(result.intent, 'store_overview');
    assert.equal(result.operation, 'STORE_SUMMARY');
    assert(result.lojaSlug === 'MPJabaquara' || result.lojaSlug === 'jabaquara');
    assert.ok(result.pendingRequest);
    assert.equal(result.pendingRequest?.operation, 'STORE_SUMMARY');
  });

  await it('5.4. Consulta individual direta DELAY_REASON: "Caso do Linea / por que esta parado"', () => {
    const result = rewriteIntent('Caso do Linea / por que esta parado');
    assert.equal(result.operation, 'DELAY_REASON');
    assert.equal(result.vehicleModel, 'Linea');
    assert.notEqual(result.intent, 'aging_cars');
    assert.ok(result.pendingRequest);
    assert.equal(result.pendingRequest?.operation, 'DELAY_REASON');
    assert.equal(result.pendingRequest?.targetModel, 'Linea');
  });

  await it('5.5. Consulta elíptica de seguimento herdando pendingRequest: "e por que ele está parado?"', () => {
    const turn1Pending: TurnPendingRequest = {
      originalUserPrompt: 'Caso do Linea',
      operation: 'VEHICLE_SITUATION',
      targetModel: 'Linea',
      targetLojaSlug: 'MPJabaquara',
      generationId: 1,
      requestedAt: new Date().toISOString(),
      deliveryStatus: 'DELIVERED'
    };

    const previousState: ExtendedTurnState = {
      phone: '5511999998888',
      lastTurnId: 'turn_1',
      lastIntent: 'service_search',
      lojaSlug: 'MPJabaquara',
      vehicleModel: 'Linea',
      pendingRequest: turn1Pending,
      updatedAt: new Date().toISOString()
    };

    const result = rewriteIntent('e por que ele está parado?', previousState);
    assert.equal(result.operation, 'DELAY_REASON', 'Operação deve ser DELAY_REASON');
    assert.equal(result.vehicleModel, 'Linea', 'Deve herdar Linea do pendingRequest');
    assert.equal(result.lojaSlug, 'MPJabaquara', 'Deve herdar MPJabaquara do pendingRequest');
    assert.ok(result.pendingRequest);
    assert.equal(result.pendingRequest?.operation, 'DELAY_REASON');
    assert.equal(result.pendingRequest?.targetModel, 'Linea');
    assert.equal(result.pendingRequest?.generationId, 2);
  });

  await it('5.6. Consulta elíptica "por que ta parado?" herdando contexto', () => {
    const turn1Pending: TurnPendingRequest = {
      originalUserPrompt: 'Caso do Linea',
      operation: 'VEHICLE_SITUATION',
      targetModel: 'Linea',
      targetLojaSlug: 'MPJabaquara',
      generationId: 1,
      requestedAt: new Date().toISOString(),
      deliveryStatus: 'DELIVERED'
    };

    const previousState: ExtendedTurnState = {
      phone: '5511999998888',
      lastTurnId: 'turn_1',
      lastIntent: 'service_search',
      lojaSlug: 'MPJabaquara',
      vehicleModel: 'Linea',
      pendingRequest: turn1Pending,
      updatedAt: new Date().toISOString()
    };

    const result = rewriteIntent('por que ta parado?', previousState);
    assert.equal(result.operation, 'DELAY_REASON');
    assert.equal(result.vehicleModel, 'Linea');
    assert.equal(result.lojaSlug, 'MPJabaquara');
  });

  console.log(`\n===============================================================================`);
  console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS! (100% PASS)`);
  console.log(`===============================================================================\n`);
}

runInterpretationRepairTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
