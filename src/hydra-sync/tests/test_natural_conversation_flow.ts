/**
 * Suíte de Testes da Missão de Compreensão de Linguagem Natural e Continuidade
 * 
 * Validação rigorosa dos Critérios de Aceitação:
 * 1. Sequência Canônica de 4 Passos (sem sinal -> qual a maior dessas -> maior de sto andre -> e a mais antiga)
 * 2. Herança, substituição e remoção estrita de filtros
 * 3. Resolução de abreviações e apelidos de lojas
 * 4. Desambiguação amigável para candidatos múltiplos (ex: "rei")
 * 5. Tratamento semântico de perguntas fora de escopo e capacidades indisponíveis
 * 6. Persistência e reidratação do contrato compartilhado via SQLite WAL
 */

import { rewriteIntent } from '../intent_rewriter.js';
import {
  getLatestTurnState,
  saveTurnState,
  clearTurnState,
  type TurnState
} from '../turn_context_repository.js';
import { getDatabaseConnection } from '../db_repository.js';

function checkCondition(condition: any, msg: string) {
  if (!condition) {
    throw new Error(`[FALHA NA ASSERÇÃO] ${msg}`);
  }
}

async function runNaturalFlowTests() {
  console.log('🚀 Iniciando Testes de Compreensão de Linguagem Natural & Continuidade (Contrato v1.0.0)...\n');
  const db = getDatabaseConnection();
  const testPhone = '5511999998888';
  clearTurnState(db, testPhone);

  // =========================================================================
  // PARTE 1: SEQUÊNCIA IDEAL (Passos 1 a 4 com persistência entre turnos)
  // =========================================================================

  console.log('---------------------------------------------------------');
  console.log('▶ [Passo 1] "quais OS estão sem sinal?"');
  console.log('---------------------------------------------------------');
  const t1Input = 'quais OS estão sem sinal?';
  const t1Res = rewriteIntent(t1Input, null);

  console.log('  Pergunta canônica:', t1Res.canonicalQuestion);
  console.log('  Decisão:', t1Res.contract?.decision, '| Operação:', t1Res.contract?.operation);
  console.log('  Filtros:', JSON.stringify(t1Res.contract?.filters));
  console.log('  Relação:', t1Res.contract?.turnRelation.type);

  checkCondition(t1Res.contract?.decision === 'execute', 'Passo 1: Decisão deve ser execute');
  checkCondition(t1Res.intent === 'list_os', 'Passo 1: Operação deve ser list_os');
  checkCondition(t1Res.onlyOpen === true, 'Passo 1: onlyOpen deve ser true');
  checkCondition(t1Res.noDeposit === true, 'Passo 1: noDeposit deve ser true');
  checkCondition(t1Res.lojaSlug === undefined, 'Passo 1: Nenhuma loja deve ser restrita (escopo rede)');
  checkCondition(t1Res.contract?.turnRelation.type === 'new_query', 'Passo 1: Relação deve ser new_query');
  checkCondition(t1Res.canonicalQuestion === 'Listar as OS abertas com valor pago zero e saldo pendente.', `Passo 1 falhou no texto: ${t1Res.canonicalQuestion}`);

  // Simula o despachante persistindo o turno 1
  const t1State: TurnState = {
    phone: testPhone,
    lastTurnId: t1Res.turnId,
    lastIntent: t1Res.intent,
    lojaSlug: t1Res.lojaSlug,
    filters: {
      onlyOpen: t1Res.onlyOpen,
      noDeposit: t1Res.noDeposit
    },
    lastContract: t1Res.contract,
    lastMessageId: 1001,
    lastResponseText: 'Lista de 3 OS sem sinal...',
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, t1State);
  console.log('  ✅ Passo 1 validado e persistido no SQLite.');

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Passo 2] "qual a maior dessas?"');
  console.log('---------------------------------------------------------');
  const t2Input = 'qual a maior dessas?';
  const t2State = getLatestTurnState(db, testPhone, 120);
  const t2Res = rewriteIntent(t2Input, t2State);

  console.log('  Pergunta canônica:', t2Res.canonicalQuestion);
  console.log('  Decisão:', t2Res.contract?.decision, '| Relação:', t2Res.contract?.turnRelation.type);
  console.log('  Filtros herdados:', t2Res.contract?.turnRelation.inheritedFilters);
  console.log('  Ordenação:', JSON.stringify(t2Res.contract?.sort));

  checkCondition(t2Res.contract?.decision === 'execute', 'Passo 2: Decisão deve ser execute');
  checkCondition(t2Res.intent === 'list_os', 'Passo 2: Operação deve ser list_os');
  checkCondition(t2Res.onlyOpen === true, 'Passo 2: Deve herdar onlyOpen === true');
  checkCondition(t2Res.noDeposit === true, 'Passo 2: Deve herdar noDeposit === true');
  checkCondition(t2Res.contract?.turnRelation.type === 'refine', 'Passo 2: Relação deve ser refine (anáfora "dessas")');
  checkCondition(t2Res.contract?.turnRelation.inheritedFilters.includes('onlyOpen'), 'Passo 2: Deve registrar herança de onlyOpen');
  checkCondition(t2Res.contract?.turnRelation.inheritedFilters.includes('noDeposit'), 'Passo 2: Deve registrar herança de noDeposit');
  checkCondition(t2Res.contract?.sort?.field === 'valor_total', 'Passo 2: Ordenação deve ser por valor_total');
  checkCondition(t2Res.contract?.sort?.direction === 'DESC', 'Passo 2: Direção de ordenação deve ser DESC');
  checkCondition(t2Res.contract?.sort?.limit === 1, 'Passo 2: Limite deve ser 1 ("a maior")');
  checkCondition(t2Res.canonicalQuestion.includes('maior valor total') && t2Res.canonicalQuestion.includes('sem sinal'), 'Passo 2: Pergunta canônica deve citar maior valor e sem sinal');

  // Simula persistência do turno 2
  const t2SaveState: TurnState = {
    phone: testPhone,
    lastTurnId: t2Res.turnId,
    lastIntent: t2Res.intent,
    lojaSlug: t2Res.lojaSlug,
    filters: {
      onlyOpen: t2Res.onlyOpen,
      noDeposit: t2Res.noDeposit,
      sort: t2Res.contract?.sort
    },
    lastContract: t2Res.contract,
    lastMessageId: 1002,
    lastResponseText: 'A maior OS sem sinal é a #634...',
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, t2SaveState);
  console.log('  ✅ Passo 2 validado e persistido no SQLite.');

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Passo 3] "ok qual a maior OS em aberto de sto andre?"');
  console.log('---------------------------------------------------------');
  const t3Input = 'ok qual a maior OS em aberto de sto andre?';
  const t3State = getLatestTurnState(db, testPhone, 120);
  const t3Res = rewriteIntent(t3Input, t3State);

  console.log('  Pergunta canônica:', t3Res.canonicalQuestion);
  console.log('  Loja resolvida:', t3Res.lojaSlug, '(', t3Res.contract?.entities.loja?.name, ')');
  console.log('  Filtros:', JSON.stringify(t3Res.contract?.filters));
  console.log('  Filtros removidos:', t3Res.contract?.turnRelation.removedFilters);

  checkCondition(t3Res.contract?.decision === 'execute', 'Passo 3: Decisão deve ser execute');
  checkCondition(t3Res.lojaSlug === 'MPSantoAndre', 'Passo 3: Loja deve ser resolvida para MPSantoAndre');
  checkCondition(t3Res.onlyOpen === true, 'Passo 3: onlyOpen deve ser true');
  // CRITÉRIO FUNDAMENTAL: "Remover o filtro 'sem sinal', pois a pergunta define uma nova consulta."
  checkCondition(t3Res.noDeposit === undefined, 'Passo 3: Filtro sem sinal (noDeposit) DEVE ser removido (undefined)');
  checkCondition(t3Res.contract?.turnRelation.type === 'new_query', 'Passo 3: Relação deve ser new_query (pergunta autossuficiente)');
  checkCondition(t3Res.contract?.turnRelation.removedFilters.includes('noDeposit'), 'Passo 3: removedFilters deve conter noDeposit');
  checkCondition(t3Res.contract?.sort?.field === 'valor_total', 'Passo 3: Ordenação deve ser por valor_total');
  checkCondition(t3Res.contract?.sort?.limit === 1, 'Passo 3: Limite deve ser 1');
  checkCondition(t3Res.canonicalQuestion === 'Identificar a OS aberta com maior valor total de Santo André.', `Passo 3 falhou no texto canônico: ${t3Res.canonicalQuestion}`);

  // Simula persistência do turno 3
  const t3SaveState: TurnState = {
    phone: testPhone,
    lastTurnId: t3Res.turnId,
    lastIntent: t3Res.intent,
    lojaSlug: t3Res.lojaSlug,
    filters: {
      onlyOpen: t3Res.onlyOpen,
      noDeposit: t3Res.noDeposit,
      sort: t3Res.contract?.sort
    },
    lastContract: t3Res.contract,
    lastMessageId: 1003,
    lastResponseText: 'A maior OS aberta em Santo André é a #880...',
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, t3SaveState);
  console.log('  ✅ Passo 3 validado e persistido no SQLite.');

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Passo 4] "e a mais antiga?"');
  console.log('---------------------------------------------------------');
  const t4Input = 'e a mais antiga?';
  const t4State = getLatestTurnState(db, testPhone, 120);
  const t4Res = rewriteIntent(t4Input, t4State);

  console.log('  Pergunta canônica:', t4Res.canonicalQuestion);
  console.log('  Loja herdada:', t4Res.lojaSlug);
  console.log('  Ordenação:', JSON.stringify(t4Res.contract?.sort));
  console.log('  Filtros herdados:', t4Res.contract?.turnRelation.inheritedFilters);

  checkCondition(t4Res.contract?.decision === 'execute', 'Passo 4: Decisão deve ser execute');
  checkCondition(t4Res.lojaSlug === 'MPSantoAndre', 'Passo 4: Deve preservar loja Santo André');
  checkCondition(t4Res.onlyOpen === true, 'Passo 4: Deve preservar abertas');
  checkCondition(t4Res.noDeposit === undefined, 'Passo 4: Sem sinal DEVE permanecer ausente (undefined)');
  checkCondition(t4Res.contract?.sort?.field === 'dias_no_patio', 'Passo 4: Ordenação deve ser por antiguidade/dias_no_patio');
  checkCondition(t4Res.contract?.sort?.direction === 'DESC', 'Passo 4: Direção deve ser DESC (mais dias no pátio primeiro)');
  checkCondition(t4Res.contract?.sort?.limit === 1, 'Passo 4: Limite deve ser 1');
  checkCondition(t4Res.contract?.turnRelation.type === 'continue', 'Passo 4: Relação deve ser continue');
  checkCondition(t4Res.canonicalQuestion === 'Identificar a OS aberta mais antiga de Santo André.', `Passo 4 falhou no texto canônico: ${t4Res.canonicalQuestion}`);

  // Simula persistência do turno 4
  const t4SaveState: TurnState = {
    phone: testPhone,
    lastTurnId: t4Res.turnId,
    lastIntent: t4Res.intent,
    lojaSlug: t4Res.lojaSlug,
    filters: {
      onlyOpen: t4Res.onlyOpen,
      sort: t4Res.contract?.sort
    },
    lastContract: t4Res.contract,
    lastMessageId: 1004,
    lastResponseText: 'A OS mais antiga de Santo André é a #450...',
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, t4SaveState);
  console.log('  ✅ Passo 4 validado e persistido no SQLite.');

  // =========================================================================
  // PARTE 2: TESTES DE CASOS DE BORDA, ABREVIAÇÕES E AMBIGUIDADES
  // =========================================================================

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Borda 1] Reconhecimento de abreviações e gírias de lojas');
  console.log('---------------------------------------------------------');
  const testAliases: Record<string, string> = {
    'como tá em jaba?': 'MPJabaquara',
    'situação de pira': 'MPpiraporinha',
    'como tá em mauá?': 'ReiDoOleoMaua',
    'status da dom pedro 1': 'MPdompedro1',
    'quais as os de sto andre': 'MPSantoAndre',
    'raio x do modulo': 'ReiDoModulo'
  };

  for (const [pergunta, expectedSlug] of Object.entries(testAliases)) {
    const res = rewriteIntent(pergunta, null);
    checkCondition(res.lojaSlug === expectedSlug, `Abreviação falhou para "${pergunta}": esperado ${expectedSlug}, obtido ${res.lojaSlug}`);
    console.log(`  ✓ "${pergunta}" -> ${res.lojaSlug}`);
  }

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Borda 2] Desambiguação Amigável para "Rei" (Módulo vs Óleo Mauá)');
  console.log('---------------------------------------------------------');
  const resAmbigua = rewriteIntent('como tá o rei?', null);
  console.log('  Decisão:', resAmbigua.contract?.decision);
  console.log('  Mensagem de esclarecimento:', resAmbigua.clarificationMessage);
  checkCondition(resAmbigua.needsClarification === true, 'Deve exigir esclarecimento para "rei"');
  checkCondition(resAmbigua.contract?.decision === 'clarify', 'Decisão deve ser clarify');
  checkCondition(resAmbigua.contract?.ambiguity.isAmbiguous === true, 'Deve marcar isAmbiguous === true');
  checkCondition(resAmbigua.contract?.ambiguity.candidates?.includes('ReiDoModulo') && resAmbigua.contract?.ambiguity.candidates?.includes('ReiDoOleoMaua'), 'Candidatos devem conter ambas as lojas');
  console.log('  ✅ Ambiguidade de "rei" tratada com desambiguação amigável.');

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Borda 3] Perguntas Fora do Escopo Operacional');
  console.log('---------------------------------------------------------');
  const foraEscopoTestes = [
    'receita de bolo de chocolate fofinho',
    'quanto foi o jogo do corinthians hoje?',
    'qual a previsão do tempo para amanhã?'
  ];

  for (const p of foraEscopoTestes) {
    const resFora = rewriteIntent(p, null);
    checkCondition(resFora.contract?.decision === 'out_of_scope', `Esperava out_of_scope para "${p}", obteve ${resFora.contract?.decision}`);
    checkCondition(resFora.needsClarification === true, `Deve acionar resposta amigável para fora de escopo: "${p}"`);
    console.log(`  ✓ "${p}" -> out_of_scope (${resFora.contract?.explanation})`);
  }

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Borda 4] Capacidades Indisponíveis (Não Suportadas)');
  console.log('---------------------------------------------------------');
  const naoSuportadas = [
    'emitir nota fiscal eletrônica para esta OS',
    'demitir o mecânico joão agora'
  ];

  for (const p of naoSuportadas) {
    const resNao = rewriteIntent(p, null);
    checkCondition(resNao.contract?.decision === 'unsupported_capability', `Esperava unsupported_capability para "${p}"`);
    checkCondition(resNao.needsClarification === true, `Deve notificar impossibilidade para "${p}"`);
    console.log(`  ✓ "${p}" -> unsupported_capability (${resNao.contract?.explanation})`);
  }

  console.log('\n---------------------------------------------------------');
  console.log('▶ [Borda 5] Reidratação de Contrato Estruturado do SQLite');
  console.log('---------------------------------------------------------');
  const estadoReidratado = getLatestTurnState(db, testPhone, 120);
  checkCondition(estadoReidratado !== null, 'Estado deve existir');
  checkCondition(estadoReidratado?.lastContract !== undefined, 'lastContract deve ser reidratado do filters_json');
  checkCondition(estadoReidratado?.lastContract?.version === '1.0.0', 'Versão do contrato deve ser 1.0.0');
  checkCondition(estadoReidratado?.lastContract?.canonicalQuestion === 'Identificar a OS aberta mais antiga de Santo André.', 'Pergunta canônica reidratada com perfeição');
  console.log('  ✅ Reidratação do TurnContract no SQLite comprovada.');

  // Limpeza final
  clearTurnState(db, testPhone);

  console.log('\n🎉 ========================================================');
  console.log('   SUCESSO TOTAL! TODOS OS CRITÉRIOS DE ACEITAÇÃO PASSARAM!');
  console.log('   ========================================================\n');
}

runNaturalFlowTests().catch(err => {
  console.error('\n❌ Falha na suíte de testes de fluxo natural:', err);
  process.exit(1);
});
