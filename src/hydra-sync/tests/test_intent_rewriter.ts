import { rewriteIntent } from '../intent_rewriter.js';
import type { TurnState } from '../turn_context_repository.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runIntentRewriterTests() {
  console.log('🚀 Iniciando testes unitários do intent_rewriter.ts...');

  // Cenário 1: Situação do Rei do Módulo -> "perfeito mas quais sao as oss que tem??"
  // Esperado: "Listar as OS abertas do Rei do Módulo."
  const stateReiDoModulo: TurnState = {
    phone: '5511999990001',
    lastTurnId: 't1',
    lastIntent: 'store_overview',
    lojaSlug: 'ReiDoModulo',
    filters: {},
    updatedAt: new Date().toISOString()
  };
  const intent1 = rewriteIntent('perfeito mas quais sao as oss que tem??', stateReiDoModulo);
  console.log('Cenário 1:', intent1.canonicalQuestion, '| Intent:', intent1.intent, '| Loja:', intent1.lojaSlug);
  assert(intent1.intent === 'list_os', 'Cenário 1: intent deve ser list_os');
  assert(intent1.lojaSlug === 'ReiDoModulo', 'Cenário 1: loja deve ser ReiDoModulo');
  assert(intent1.canonicalQuestion === 'Listar as OS abertas do Rei do Módulo.', `Cenário 1 falhou: ${intent1.canonicalQuestion}`);
  assert(intent1.onlyOpen === true, 'Cenário 1: onlyOpen deve ser true');

  // Cenário 2: OS abertas da rede -> "e no jabaquara?"
  // Esperado: "Listar as OS abertas do Jabaquara."
  const stateRedeOS: TurnState = {
    phone: '5511999990002',
    lastTurnId: 't2',
    lastIntent: 'list_os',
    lojaSlug: undefined,
    filters: { onlyOpen: true },
    updatedAt: new Date().toISOString()
  };
  const intent2 = rewriteIntent('e no jabaquara?', stateRedeOS);
  console.log('Cenário 2:', intent2.canonicalQuestion, '| Intent:', intent2.intent, '| Loja:', intent2.lojaSlug);
  assert(intent2.intent === 'list_os', 'Cenário 2: intent deve ser list_os');
  assert(intent2.lojaSlug === 'MPJabaquara', 'Cenário 2: loja deve ser MPJabaquara');
  assert(intent2.canonicalQuestion === 'Listar as OS abertas do Jabaquara.', `Cenário 2 falhou: ${intent2.canonicalQuestion}`);
  assert(intent2.onlyOpen === true, 'Cenário 2: onlyOpen deve ser true');

  // Cenário 3: OS abertas do Jabaquara -> "quais estão sem sinal?"
  // Esperado: "Listar as OS abertas do Jabaquara com valor pago zero e saldo pendente."
  const stateJabaquaraOS: TurnState = {
    phone: '5511999990003',
    lastTurnId: 't3',
    lastIntent: 'list_os',
    lojaSlug: 'MPJabaquara',
    filters: { onlyOpen: true },
    updatedAt: new Date().toISOString()
  };
  const intent3 = rewriteIntent('quais estão sem sinal?', stateJabaquaraOS);
  console.log('Cenário 3:', intent3.canonicalQuestion, '| Intent:', intent3.intent, '| Loja:', intent3.lojaSlug);
  assert(intent3.intent === 'list_os', 'Cenário 3: intent deve ser list_os');
  assert(intent3.lojaSlug === 'MPJabaquara', 'Cenário 3: loja deve ser MPJabaquara');
  assert(intent3.canonicalQuestion === 'Listar as OS abertas do Jabaquara com valor pago zero e saldo pendente.', `Cenário 3 falhou: ${intent3.canonicalQuestion}`);
  assert(intent3.noDeposit === true, 'Cenário 3: noDeposit deve ser true');

  // Cenário 4: Precedência explícita: OS do Rei do Módulo -> "e no Jabaquara?"
  // A loja explícita Jabaquara substitui Rei do Módulo
  const stateReiDoModuloList: TurnState = {
    phone: '5511999990004',
    lastTurnId: 't4',
    lastIntent: 'list_os',
    lojaSlug: 'ReiDoModulo',
    filters: { onlyOpen: true },
    updatedAt: new Date().toISOString()
  };
  const intent4 = rewriteIntent('e no Jabaquara?', stateReiDoModuloList);
  console.log('Cenário 4:', intent4.canonicalQuestion, '| Loja:', intent4.lojaSlug);
  assert(intent4.lojaSlug === 'MPJabaquara', 'Cenário 4: Loja deve ser substituída para MPJabaquara');
  assert(!intent4.canonicalQuestion.includes('Rei do Módulo'), 'Cenário 4: Pergunta canônica não pode ter Rei do Módulo');

  // Cenário 5: Busca por placa explícita descarta contexto de loja anterior
  const intent5 = rewriteIntent('buscar placa ABC1D23', stateReiDoModuloList);
  console.log('Cenário 5:', intent5.canonicalQuestion, '| Placa:', intent5.placa);
  assert(intent5.placa === 'ABC1D23', 'Cenário 5: Placa deve ser ABC1D23');
  assert(intent5.intent === 'service_search', 'Cenário 5: Intent deve ser service_search');

  // Cenário 6: Elipse vaga pede esclarecimento
  const intent6 = rewriteIntent('e agora?', stateRedeOS);
  console.log('Cenário 6: needsClarification =', intent6.needsClarification, '| msg =', intent6.clarificationMessage);
  assert(intent6.needsClarification === true, 'Cenário 6: Deve solicitar esclarecimento');

  console.log('\n🎉 SUCESSO! Todos os 6 cenários de reescrita de intenção foram validados!');
}

runIntentRewriterTests().catch(err => {
  console.error('❌ Falha nos testes de intent_rewriter:', err);
  process.exit(1);
});
