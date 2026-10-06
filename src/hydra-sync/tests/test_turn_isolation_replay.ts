import { dispatchMessage } from '../agent_dispatcher.js';
import {
  getLatestTurnState,
  saveTurnState,
  clearTurnState
} from '../turn_context_repository.js';
import { getDatabaseConnection } from '../db_repository.js';

process.env.AGY_BIN_OVERRIDE = '/bin/false';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runTurnIsolationAndReplayTests() {
  console.log('🚀 Iniciando Teste de Isolamento de Turnos, Replay e TTL...');
  const db = getDatabaseConnection();
  const testPhone = '5511988880007';

  // Limpa estado anterior de testes
  clearTurnState(db, testPhone);
  try {
    db.prepare("DELETE FROM hydra_inbox_messages WHERE phone = ? OR message_id IN ('5001', '5002', '5003')").run(testPhone);
  } catch {}

  // 1. TESTE DE ISOLAMENTO DE SAÍDA (Turno 1 vs Turno 2)
  console.log('\n[1] Testando Isolamento Estrito de Turnos...');
  const res1 = await dispatchMessage({
    phone: testPhone,
    message: 'Como tá o Jabaquara?',
    conversationId: 7701,
    messageId: 5001
  });
  console.log('  Turno 1 - Mensagens geradas:', res1.messages.length);
  assert(res1.messages.length > 0, 'Turno 1 deve retornar mensagens');
  assert(res1.replyText.includes('Raio-X Operacional: MPJabaquara'), 'Turno 1 deve ser Raio-X do Jabaquara');

  const res2 = await dispatchMessage({
    phone: testPhone,
    message: 'quais estão sem sinal?',
    conversationId: 7701,
    messageId: 5002
  });
  console.log('  Turno 2 - Mensagens geradas:', res2.messages.length);
  assert(res2.messages.length > 0, 'Turno 2 deve retornar mensagens');
  // Validação Crítica de Isolamento: Turno 2 NÃO pode conter o Raio-X do Turno 1
  for (const msg of res2.messages) {
    assert(!msg.includes('Raio-X Operacional: MPJabaquara'), 'VIOLAÇÃO DE ISOLAMENTO: Turno 2 vazou conteúdo do Turno 1!');
  }
  console.log('  ✅ Turno 2 isolado com sucesso (zero contaminação de balões anteriores).');

  // 2. TESTE DE DEDUPLICAÇÃO & REPLAY (Mesmo messageId)
  console.log('\n[2] Testando Proteção contra Replay de Webhook (mesmo messageId)...');
  const resReplay = await dispatchMessage({
    phone: testPhone,
    message: 'quais estão sem sinal?',
    conversationId: 7701,
    messageId: 5002 // Mesmo messageId do turno anterior
  });
  console.log('  Replay detectado - Mensagens para envio:', resReplay.messages.length, '| Reply:', resReplay.replyText);
  assert(resReplay.messages.length === 0, 'Replay de mesmo messageId DEVE retornar 0 mensagens de envio');
  assert(resReplay.replyText === '(Replay ignorado)', 'Replay deve ser explicitamente ignorado');
  console.log('  ✅ Replay bloqueado com sucesso (zero envio duplicado).');

  // 3. TESTE DE MENSAGEM IDÊNTICA COM NOVO messageId (Novo Turno Legítimo)
  console.log('\n[3] Testando Mensagem Idêntica com Novo messageId...');
  const resNovoTurno = await dispatchMessage({
    phone: testPhone,
    message: 'quais estão sem sinal?',
    conversationId: 7701,
    messageId: 5003 // Novo messageId
  });
  console.log('  Novo Turno - Mensagens geradas:', resNovoTurno.messages.length);
  assert(resNovoTurno.messages.length > 0, 'Novo messageId deve processar novo turno normalmente');
  console.log('  ✅ Novo turno com mesmo texto executado com sucesso.');

  // 4. TESTE DE EXPIRAÇÃO POR TTL (> 120 min)
  console.log('\n[4] Testando Expiração de Contexto por TTL (> 120 min)...');
  const phoneExpirado = '5511977770008';
  clearTurnState(db, phoneExpirado);

  // Injeta um estado de 3 horas atrás (180 minutos)
  const dataAntigaIso = new Date(Date.now() - 180 * 60 * 1000).toISOString();
  saveTurnState(db, {
    phone: phoneExpirado,
    lastTurnId: 'old_turn_1',
    lastIntent: 'store_overview',
    lojaSlug: 'MPJabaquara',
    filters: {},
    lastMessageId: 9001,
    lastResponseText: 'Resposta antiga',
    updatedAt: dataAntigaIso
  });

  const estadoRecuperado = getLatestTurnState(db, phoneExpirado, 120);
  console.log('  Estado recuperado após 180 minutos:', estadoRecuperado);
  assert(estadoRecuperado === null, 'Contexto com mais de 120 minutos DEVE retornar null (expirado)');
  console.log('  ✅ Contexto expirado descartado com sucesso.');

  // 5. TESTE DE CONTEXTO DENTRO DA VALIDADE (< 120 min)
  console.log('\n[5] Testando Contexto Válido Dentro da Janela (< 120 min)...');
  const dataRecenteIso = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min atrás
  saveTurnState(db, {
    phone: phoneExpirado,
    lastTurnId: 'recent_turn_1',
    lastIntent: 'store_overview',
    lojaSlug: 'ReiDoModulo',
    filters: {},
    lastMessageId: 9002,
    lastResponseText: 'Resposta recente',
    updatedAt: dataRecenteIso
  });

  const estadoValido = getLatestTurnState(db, phoneExpirado, 120);
  console.log('  Estado recuperado após 10 minutos - Loja:', estadoValido?.lojaSlug);
  assert(estadoValido !== null, 'Contexto recente deve ser recuperado com sucesso');
  assert(estadoValido?.lojaSlug === 'ReiDoModulo', 'Loja recuperada deve ser ReiDoModulo');
  console.log('  ✅ Contexto recente recuperado com sucesso.');

  // Limpeza
  clearTurnState(db, testPhone);
  clearTurnState(db, phoneExpirado);

  console.log('\n🎉 ========================================================');
  console.log('   SUCESSO! TODOS OS TESTES DE ISOLAMENTO, REPLAY E TTL PASSARAM!');
  console.log('   ========================================================\n');
}

runTurnIsolationAndReplayTests().catch(err => {
  console.error('\n❌ Falha na bateria de testes de isolamento e replay:', err);
  process.exit(1);
});
