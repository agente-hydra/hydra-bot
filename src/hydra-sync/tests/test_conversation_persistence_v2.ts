/**
 * Suíte de Testes: Persistência de Conversas Nativas no AGY CLI e Formatação CMV
 * Spec: hydra-intent-refinement-v2
 */

import Database from 'better-sqlite3';
import {
  getAgyConversationId,
  setAgyConversationId,
  clearAgyConversationId
} from '../turn_context_repository.js';
import { executeResetCommand } from '../command_interceptor.js';
import { formatCMVWhatsAppReply } from '../operational_adapter.js';
import { DualWorkerRouter } from '../dual_worker_router.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, name: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } else {
    console.error(`  ❌ [FAIL] ${name}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('🧪 Iniciando Testes de Persistência AGY CLI & Formatação CMV...\n');

  const db = new Database(':memory:');
  const testPhone = '5511996242812';

  // 1. Teste de ciclo de vida do agy_conversation_id no SQLite
  console.log('--- 1. Ciclo de Vida do agy_conversation_id no SQLite ---');
  const initial = getAgyConversationId(db, testPhone);
  assert(initial === null, 'Inicialmente agy_conversation_id é nulo');

  setAgyConversationId(db, testPhone, 'conv-uuid-1111');
  const afterSet = getAgyConversationId(db, testPhone);
  assert(afterSet === 'conv-uuid-1111', 'setAgyConversationId persiste e recupera UUID');

  setAgyConversationId(db, testPhone, 'conv-uuid-2222');
  const afterUpdate = getAgyConversationId(db, testPhone);
  assert(afterUpdate === 'conv-uuid-2222', 'Atualização de agy_conversation_id sobrescreve com sucesso');

  clearAgyConversationId(db, testPhone);
  const afterClear = getAgyConversationId(db, testPhone);
  assert(afterClear === null, 'clearAgyConversationId redefine para nulo');

  // 2. Teste do /reset limpando agy_conversation_id
  console.log('\n--- 2. Comando /reset limpa agy_conversation_id ---');
  setAgyConversationId(db, testPhone, 'conv-active-session-999');
  assert(getAgyConversationId(db, testPhone) === 'conv-active-session-999', 'Sessão ativa criada');

  await executeResetCommand(testPhone, db);
  const afterReset = getAgyConversationId(db, testPhone);
  assert(afterReset === null, '/reset limpa agy_conversation_id compulsoriamente');

  // 3. Teste de formatação do CMV Comparativo das Lojas (prefixo > na linha Período)
  console.log('\n--- 3. Formatação do CMV Comparativo com prefixo > ---');
  const cmvMock = {
    scope: 'all_stores',
    periodo: 'outubro/2026',
    capturedAt: new Date().toISOString(),
    rankingCMV: [
      { nome: 'Santo André', cmvPercentual: 24.20, custoTotal: 4736.52, faturamentoTotal: 19571.10 },
      { nome: 'Jabaquara', cmvPercentual: 19.88, custoTotal: 6451.85, faturamentoTotal: 32452.54 }
    ],
    lojas: []
  };

  const cmvReply = formatCMVWhatsAppReply({ cmv: cmvMock as any });
  assert(cmvReply.includes('> *CMV Comparativo das Lojas*'), 'Contém cabeçalho > *CMV Comparativo das Lojas*');
  assert(cmvReply.includes('> *Período:* outubro/2026'), 'Linha Período possui prefixo > de blockquote WhatsApp');
  assert(!cmvReply.includes('\n*Período:* outubro/2026'), 'Linha Período NÃO está descolada sem prefixo >');

  // 4. Teste do DualWorkerRouter propagando conversationId
  console.log('\n--- 4. DualWorkerRouter propagando conversationId ---');
  let receivedConvId: string | undefined = undefined;
  const mockRouter = new DualWorkerRouter({
    primaryExecutorOverride: async (prompt, model, timeoutMs, conversationId) => {
      receivedConvId = conversationId;
      return {
        success: true,
        output: 'Resposta com contexto mantido',
        durationMs: 50,
        conversationId: conversationId || 'new-generated-uuid-777'
      };
    }
  });

  // 4a. Chamada inicial sem conversationId
  const res1 = await mockRouter.routeRequest('cmv das lojas');
  assert(res1.success === true, 'Chamada 1 realizada com sucesso');
  assert(receivedConvId === undefined, 'Chamada 1 não possuía conversationId prévio');
  assert(res1.newConversationId === 'new-generated-uuid-777', 'Chamada 1 retornou novo conversationId gerado');

  // 4b. Chamada seguinte com conversationId
  const res2 = await mockRouter.routeRequest('quais as travas', {
    conversationId: 'new-generated-uuid-777'
  });
  assert(res2.success === true, 'Chamada 2 realizada com sucesso');
  assert(receivedConvId === 'new-generated-uuid-777', 'Chamada 2 transmitiu conversationId existente ao executor');
  assert(res2.newConversationId === 'new-generated-uuid-777', 'Chamada 2 manteve conversationId preservado');

  console.log(`\n================================================================`);
  console.log(`🎉 RESULTADO: ${passed}/${total} TESTES PASSARAM!`);
  console.log(`================================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
