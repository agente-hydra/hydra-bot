/**
 * src/hydra-sync/tests/test_executor1_interpretation.ts
 * 
 * Bateria de Testes do Executor 1 (Interpretação, Catálogo, Contexto e Entrada do Hydra):
 * 1. Invalidação atômica de cursores e contexto pós /reset e troca de persona (/socio, /{loja}).
 * 2. Descarte estrito de buscas e anáforas de outras lojas na troca de escopo.
 * 3. Expiração de cursores por TTL (> 120 min).
 * 4. Mapeamento de "OS dos últimos 30 dias" para CAP-OS-LIST com inclusão declarada de ordens encerradas.
 * 5. Declaração obrigatória de ausência de prova de pátio físico em perguntas de presença.
 * 6. Decomposição de pedidos em QueryPlan e QueryComponent (pedidos simples e compostos).
 * 7. Registro e deduplicação de lacunas em hydra_query_gaps com sanitização de dados pessoais (PII).
 * 8. Catálogo operacional verificado e comprovado no prompt do revisor crítico.
 */

import Database from 'better-sqlite3';
import {
  ensureTurnContextTable,
  saveTurnState,
  getLatestTurnState,
  clearTurnState,
  saveTurnCursor,
  getTurnCursor,
  invalidateTurnCursors,
  invalidateTurnContextAndCursors,
  invalidateContextOnPersonaSwitch,
  resolveTurnContinuity,
  expireStaleOSFocus,
  type TurnCursor,
  type TurnState
} from '../turn_context_repository.js';
import {
  rewriteIntent,
  decomposeIntoQueryPlan,
  recordQueryGap,
  ensureQueryGapsTable,
  sanitizeQueryText,
  computeGapKey,
  getCivilDateRange30Days,
  composeOrdersLast30DaysDeclaration,
  isPhysicalYardPresenceQuery,
  getPhysicalYardDisclaimer
} from '../intent_rewriter.js';
import {
  OPERATIONAL_CAPABILITIES_CATALOG,
  CRITICAL_REVIEWER_RULES,
  NO_PHYSICAL_YARD_DISCLAIMER
} from '../semantic_prompt.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runExecutor1InterpretationTests() {
  console.log('🚀 Iniciando Suíte de Testes do Executor 1: Interpretação, Catálogo e Contexto...\n');
  const db = new Database(':memory:');

  // =========================================================================
  // BLOCO 1: INVALIDAÇÃO ATÔMICA DE CONTEXTO E CURSORES PÓS /RESET E PERSONA
  // =========================================================================
  console.log('--- [1] Testando Invalidação de Contexto e Cursores pós /reset e Persona ---');
  ensureTurnContextTable(db);
  const testPhone = '5511999990001';

  // 1.1 Injeta contexto ativo de turno com OS e cursor ativo em MPJabaquara
  const initialTime = new Date().toISOString();
  saveTurnState(db, {
    phone: testPhone,
    lastTurnId: 'turn_jab_1',
    lastIntent: 'os_detail',
    lojaSlug: 'MPJabaquara',
    osId: '1128',
    placa: 'ABC1D23',
    filters: { isOSSpecific: true },
    updatedAt: initialTime
  });

  const cursorJab: TurnCursor = {
    cursorId: 'cursor_jab_page1',
    phone: testPhone,
    lojaSlug: 'MPJabaquara',
    queryHash: 'hash_jab_os_all',
    snapshotTime: initialTime,
    lastDataInicioIso: '2026-09-28 10:00:00',
    lastOsId: '1128',
    pageNumber: 1,
    pageSize: 20,
    cursorToken: 'tok_jab_123',
    createdAt: initialTime,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  };
  saveTurnCursor(db, cursorJab);

  // Confirma existência prévia
  const stateBeforeSwitch = getLatestTurnState(db, testPhone, 120);
  assert(stateBeforeSwitch !== null, 'Estado inicial deve existir');
  assert(stateBeforeSwitch?.lojaSlug === 'MPJabaquara', 'Loja inicial deve ser MPJabaquara');
  assert(stateBeforeSwitch?.osId === '1128', 'OS inicial deve ser 1128');
  assert(stateBeforeSwitch?.activeCursor === 'tok_jab_123', 'Cursor inicial deve estar ativo');

  const cursorRecup = getTurnCursor(db, testPhone, 'tok_jab_123');
  assert(cursorRecup !== null, 'Cursor inicial deve ser recuperado com sucesso');
  console.log('  ✅ Estado inicial e cursor de paginação persistidos com sucesso.');

  // 1.2 Alternância de Persona para Sócio (/socio)
  // Requisito: Invalidação atômica de cursores e contexto
  invalidateContextOnPersonaSwitch(db, testPhone, 'socio');

  const stateAfterSocio = getLatestTurnState(db, testPhone, 120);
  assert(stateAfterSocio !== null, 'Estado após /socio deve existir');
  assert(stateAfterSocio?.lojaSlug === undefined, 'Loja deve ser anulada para sócio (visão de rede)');
  assert(stateAfterSocio?.osId === undefined, 'OS da loja deve ser expurgada no modo sócio');
  assert(stateAfterSocio?.placa === undefined, 'Placa da loja deve ser expurgada no modo sócio');
  assert(stateAfterSocio?.activeCursor === undefined, 'activeCursor deve ser anulado no modo sócio');

  const cursorAfterSocio = getTurnCursor(db, testPhone, 'tok_jab_123');
  assert(cursorAfterSocio === null, 'Cursor da loja anterior DEVE ser invalidado ao virar sócio');
  console.log('  ✅ [PASS] Invalidação atômica ao alternar para Sócio (/socio).');

  // 1.3 Alternância de Persona para Gerente de outra loja (/kennedy)
  invalidateContextOnPersonaSwitch(db, testPhone, 'gerente', 'MPkennedy');
  const stateAfterKennedy = getLatestTurnState(db, testPhone, 120);
  assert(stateAfterKennedy?.lojaSlug === 'MPkennedy', 'Loja deve ser travada em MPkennedy');
  assert(stateAfterKennedy?.osId === undefined, 'OS da loja antiga não pode vazar para Kennedy');
  assert(stateAfterKennedy?.filters.scope === 'store', 'Escopo deve ser store');

  // Salva novo cursor em Kennedy
  const cursorKen: TurnCursor = {
    cursorId: 'cursor_ken_page1',
    phone: testPhone,
    lojaSlug: 'MPkennedy',
    queryHash: 'hash_ken_os_all',
    snapshotTime: new Date().toISOString(),
    lastDataInicioIso: '2026-09-30 14:00:00',
    lastOsId: '9202',
    pageNumber: 1,
    pageSize: 20,
    cursorToken: 'tok_ken_456',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  };
  saveTurnCursor(db, cursorKen);
  assert(getTurnCursor(db, testPhone, 'tok_ken_456') !== null, 'Cursor da Kennedy deve existir');

  // 1.4 Comando /reset
  // Requisito: Invalidação atômica completa de cursores e contexto
  clearTurnState(db, testPhone);
  assert(getLatestTurnState(db, testPhone, 120) === null, 'Contexto após /reset deve ser nulo');
  assert(getTurnCursor(db, testPhone, 'tok_ken_456') === null, 'Cursor da Kennedy deve ser destruído após /reset');
  console.log('  ✅ [PASS] Invalidação atômica completa após comando /reset.');

  // =========================================================================
  // BLOCO 2: DESCARTE DE BUSCAS E ANÁFORAS DE OUTRAS LOJAS
  // =========================================================================
  console.log('\n--- [2] Testando Descarte de Buscas e Anáforas Cross-Store ---');
  // Simula estado ativo em Jabaquara com OS 1128
  saveTurnState(db, {
    phone: testPhone,
    lastTurnId: 'turn_jab_os',
    lastIntent: 'os_detail',
    lojaSlug: 'MPJabaquara',
    osId: '1128',
    placa: 'ABC1D23',
    filters: {},
    updatedAt: new Date().toISOString()
  });
  const stateJaba = getLatestTurnState(db, testPhone, 120);

  // 2.1 Anáfora legítima dentro da mesma loja: "Quero os detalhes dela"
  const continuitySameStore = resolveTurnContinuity('Quero os detalhes dela', stateJaba, 'MPJabaquara');
  assert(continuitySameStore.isContinuation === true, 'Deve ser continuação legítima na mesma loja');
  assert(continuitySameStore.osId === '1128', 'OS 1128 deve ser preservada na mesma loja');
  console.log('  ✅ Anáfora intra-loja preservada com sucesso.');

  // 2.2 Anáfora enviada para outra loja: "E em Santo André, quais os detalhes dela?"
  const continuityOtherStore = resolveTurnContinuity('E em Santo André, quais os detalhes dela?', stateJaba, 'MPSantoAndre');
  assert(continuityOtherStore.isContinuation === false, 'NÃO pode ser continuação quando o escopo muda de loja');
  assert(continuityOtherStore.osId === undefined, 'OS 1128 do Jabaquara NÃO pode vazar para Santo André');
  assert(continuityOtherStore.isTopicShift === true, 'Deve ser classificado como mudança de assunto');

  // 2.3 Troca de loja em saveTurnState purga osId anterior
  saveTurnState(db, {
    phone: testPhone,
    lastTurnId: 'turn_switch_sto',
    lastIntent: 'store_overview',
    lojaSlug: 'MPSantoAndre', // Mudança explícita de loja
    filters: {},
    updatedAt: new Date().toISOString()
  });
  const stateAfterStoreChange = getLatestTurnState(db, testPhone, 120);
  assert(stateAfterStoreChange?.lojaSlug === 'MPSantoAndre', 'Loja deve ser Santo André');
  assert(stateAfterStoreChange?.osId === undefined, 'os_id da loja anterior DEVE ser purgado ao mudar loja');
  assert(stateAfterStoreChange?.placa === undefined, 'placa da loja anterior DEVE ser purgada ao mudar loja');
  console.log('  ✅ [PASS] Barreira de contexto cross-store descarta buscas e anáforas de outras lojas.');

  // =========================================================================
  // BLOCO 3: EXPIRAÇÃO DE TTL E LIMPEZA DE CURSORES
  // =========================================================================
  console.log('\n--- [3] Testando Expiração de TTL e Limpeza de Cursores ---');
  const staleTime = new Date(Date.now() - 150 * 60 * 1000).toISOString(); // 150 min atrás (TTL = 120 min)
  saveTurnState(db, {
    phone: testPhone,
    lastTurnId: 'stale_turn',
    lastIntent: 'store_overview',
    lojaSlug: 'MPJabaquara',
    osId: '9999',
    filters: {},
    updatedAt: staleTime
  });

  const staleCursor: TurnCursor = {
    cursorId: 'stale_cur_1',
    phone: testPhone,
    lojaSlug: 'MPJabaquara',
    queryHash: 'stale_hash',
    snapshotTime: staleTime,
    pageNumber: 1,
    pageSize: 20,
    cursorToken: 'tok_stale_999',
    createdAt: staleTime,
    expiresAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() // Já expirou
  };
  saveTurnCursor(db, staleCursor);

  const expiredState = getLatestTurnState(db, testPhone, 120);
  assert(expiredState === null, 'Contexto com mais de 120 minutos DEVE retornar null por TTL');
  const expiredCursor = getTurnCursor(db, testPhone, 'tok_stale_999');
  assert(expiredCursor === null, 'Cursor expirado DEVE retornar null e ser purgado da tabela');
  console.log('  ✅ [PASS] Expiração por TTL descarta contexto e cursores pontualmente.');

  // =========================================================================
  // BLOCO 4: OS DOS ÚLTIMOS 30 DIAS (CAP-OS-LIST COM ORDENS ENCERRADAS)
  // =========================================================================
  console.log('\n--- [4] Testando Mapeamento e Declaração de "OS dos últimos 30 dias" ---');
  const range30d = getCivilDateRange30Days();
  console.log('  Intervalo de 30 dias calculado:', range30d.startDDMM, 'até', range30d.endDDMM);
  console.log('  Declaração padrão obrigatória:', range30d.declaration);
  assert(range30d.declaration.includes('Ordens abertas entre'), 'Declaração deve conter "Ordens abertas entre"');
  assert(range30d.declaration.includes('(inclui as já encerradas).'), 'Declaração DEVE explicitar "(inclui as já encerradas)."');

  // Testa rewriteIntent para "OS dos últimos 30 dias da Kennedy"
  const intent30d = rewriteIntent('OS dos últimos 30 dias da Kennedy');
  assert(intent30d.intent === 'list_os', 'Intenção deve ser list_os');
  assert(intent30d.lojaSlug === 'MPkennedy', 'Loja deve ser MPkennedy');
  assert(intent30d.onlyOpen === false, 'onlyOpen deve ser false para incluir encerradas');
  assert(intent30d.declaration !== undefined, 'Declaração deve ser gerada');
  assert(intent30d.declaration!.includes('(inclui as já encerradas).'), 'Balão deve declarar inclusão de encerradas');
  assert(intent30d.contract?.period?.type === 'ultimos_30d', 'Período no contrato deve ser ultimos_30d');
  console.log('  ✅ [PASS] Intenção de 30 dias mapeada para CAP-OS-LIST com declaração obrigatória.');

  // =========================================================================
  // BLOCO 5: DECLARAÇÃO DE AUSÊNCIA DE PROVA DE PÁTIO FÍSICO
  // =========================================================================
  console.log('\n--- [5] Testando Declaração de Ausência de Prova de Pátio Físico ---');
  assert(NO_PHYSICAL_YARD_DISCLAIMER === 'Tenho a posição de OS abertas no sistema; ela não confirma quais veículos estão fisicamente no pátio.', 'Ressalva padrão deve ser exata');

  // Pergunta sobre presença física
  assert(isPhysicalYardPresenceQuery('quantos carros estão no pátio agora?') === true, 'Deve identificar pergunta de pátio');
  assert(isPhysicalYardPresenceQuery('quais veículos estão fisicamente no pátio?') === true, 'Deve identificar pergunta física');
  assert(isPhysicalYardPresenceQuery('quem está no pátio?') === true, 'Deve identificar indagação de presença');
  assert(isPhysicalYardPresenceQuery('carros parados há mais de 5 dias no pátio') === false, 'Aging cars não é presença pura');

  const intentPatio = rewriteIntent('quantos carros estão no pátio da Kennedy?');
  assert(intentPatio.lacksPhysicalYardEvidence === true, 'lacksPhysicalYardEvidence deve ser true');
  assert(intentPatio.declaration === NO_PHYSICAL_YARD_DISCLAIMER, 'Declaração deve ser a ressalva padrão');
  console.log('  ✅ [PASS] Pergunta de presença gera resposta padrão declarando ausência de prova de pátio.');

  // =========================================================================
  // BLOCO 6: DECOMPOSIÇÃO EM QUERYPLAN E QUERYCOMPONENT
  // =========================================================================
  console.log('\n--- [6] Testando Decomposição em QueryPlan e QueryComponent ---');

  // 6.1 Pedido Composto: "Faturamento e OS de hoje da Kennedy"
  const planComposto = decomposeIntoQueryPlan({
    text: 'Faturamento e OS de hoje da Kennedy',
    phone: testPhone,
    effectivePersona: 'gerente',
    activeLojaSlug: 'MPkennedy',
    db
  });

  assert(planComposto.planId.startsWith('plan_'), 'planId deve ser gerado');
  assert(planComposto.activeLojaSlug === 'MPkennedy', 'Loja deve ser MPkennedy');
  assert(planComposto.components.length === 2, 'Deve decompor em exatamente 2 componentes');

  const compFat = planComposto.components.find(c => c.capabilityId === 'CAP-REVENUE-DAY');
  const compOS = planComposto.components.find(c => c.capabilityId === 'CAP-OS-LIST');

  assert(compFat !== undefined, 'Deve conter componente CAP-REVENUE-DAY');
  assert(compOS !== undefined, 'Deve conter componente CAP-OS-LIST');
  assert(compFat?.priority === 1, 'Faturamento deve ter prioridade 1 (veio primeiro)');
  assert(compOS?.priority === 2, 'OS deve ter prioridade 2');
  assert(compFat?.status === 'PENDING', 'Status inicial deve ser PENDING');
  console.log('  ✅ [PASS] "Faturamento e OS de hoje" decomposto em CAP-REVENUE-DAY e CAP-OS-LIST.');

  // 6.2 Pedido Composto Invertido: "OS e CMV de Santo André"
  const planInvertido = decomposeIntoQueryPlan({
    text: 'OS e CMV de Santo André',
    phone: testPhone,
    activeLojaSlug: 'MPSantoAndre'
  });
  assert(planInvertido.components.length === 2, 'Deve decompor em 2 componentes');
  assert(planInvertido.components[0].capabilityId === 'CAP-OS-LIST', 'Primeiro deve ser OS');
  assert(planInvertido.components[1].capabilityId === 'CAP-CMV-STORE', 'Segundo deve ser CMV');
  console.log('  ✅ [PASS] "OS e CMV" preserva ordem natural do operador.');

  // 6.3 Pedido com Detalhe de OS: "Detalhes da OS 1128"
  const planDetail = decomposeIntoQueryPlan({
    text: 'Detalhes da OS 1128 da Dom Pedro',
    activeLojaSlug: 'MPdompedro1'
  });
  assert(planDetail.components.length === 1, 'Deve conter 1 componente');
  assert(planDetail.components[0].capabilityId === 'CAP-OS-DETAIL', 'Deve ser CAP-OS-DETAIL');
  assert(planDetail.components[0].params.osId === '1128', 'osId deve ser 1128');
  console.log('  ✅ [PASS] Detalhe de OS pontual mapeado para CAP-OS-DETAIL.');

  // =========================================================================
  // BLOCO 7: REGISTRO E DEDUPLICAÇÃO DE LACUNAS EM HYDRA_QUERY_GAPS
  // =========================================================================
  console.log('\n--- [7] Testando Registro e Deduplicação de Lacunas (hydra_query_gaps) ---');
  ensureQueryGapsTable(db);

  // 7.1 Sanitização de PII
  const rawPII = 'Qual o estoque de pneus do carro ABC-1D23 do cliente 11988887777 com CPF 123.456.789-00 na OS 1128 por R$ 500,00?';
  const sanitized = sanitizeQueryText(rawPII);
  console.log('  Texto original com PII:', rawPII);
  console.log('  Texto sanitizado:', sanitized);

  assert(!sanitized.includes('ABC-1D23'), 'Placa não pode vazar');
  assert(!sanitized.includes('11988887777'), 'Telefone não pode vazar');
  assert(!sanitized.includes('123.456.789-00'), 'CPF não pode vazar');
  assert(!sanitized.includes('1128'), 'Número de OS não pode vazar');
  assert(!sanitized.includes('500,00'), 'Valor monetário não pode vazar');
  assert(sanitized.includes('[PLACA]'), 'Deve conter marcador [PLACA]');
  assert(sanitized.includes('[TELEFONE]'), 'Deve conter marcador [TELEFONE]');
  assert(sanitized.includes('[CPF]'), 'Deve conter marcador [CPF]');
  console.log('  ✅ Sanitização de PII rigorosa comprovada.');

  // 7.2 Registro da 1ª ocorrência
  const gap1 = recordQueryGap(db, {
    category: 'UNSUPPORTED_FIELD',
    rawText: 'Como está o estoque de pneus do carro ABC-1234?'
  });
  assert(gap1.occurrenceCount === 1, '1ª ocorrência deve ter contagem 1');
  assert(gap1.category === 'UNSUPPORTED_FIELD', 'Categoria deve ser UNSUPPORTED_FIELD');
  assert(gap1.status === 'NEW', 'Status deve ser NEW');
  assert(gap1.gapKey.length === 64, 'gapKey deve ser hash SHA-256');

  // 7.3 Registro da 2ª ocorrência com veículo diferente (mesma estrutura semântica)
  const gap2 = recordQueryGap(db, {
    category: 'UNSUPPORTED_FIELD',
    rawText: 'Como está o estoque de pneus do carro XYZ-9876?'
  });
  assert(gap2.gapKey === gap1.gapKey, 'gapKey DEVE ser idêntico após sanitização');
  assert(gap2.occurrenceCount === 2, 'Contador de ocorrência DEVE incrementar para 2');

  // Verifica no SQLite diretamente
  const rowDb = db.prepare('SELECT occurrence_count, sanitized_example FROM hydra_query_gaps WHERE gap_key = ?').get(gap1.gapKey) as any;
  assert(Number(rowDb.occurrence_count) === 2, 'SQLite deve conter 2 ocorrências');
  console.log('  ✅ [PASS] Deduplicação por hash SHA-256 e incremento de ocorrência comprovados.');

  // =========================================================================
  // BLOCO 8: CATÁLOGO OFICIAL COMPROVADO NO PROMPT DO REVISOR
  // =========================================================================
  console.log('\n--- [8] Testando Catálogo Operacional no Prompt do Revisor Crítico ---');
  assert(OPERATIONAL_CAPABILITIES_CATALOG.includes('CAP-REVENUE-DAY'), 'Deve conter CAP-REVENUE-DAY');
  assert(OPERATIONAL_CAPABILITIES_CATALOG.includes('CAP-REVENUE-MONTH'), 'Deve conter CAP-REVENUE-MONTH');
  assert(OPERATIONAL_CAPABILITIES_CATALOG.includes('CAP-CMV-STORE'), 'Deve conter CAP-CMV-STORE');
  assert(OPERATIONAL_CAPABILITIES_CATALOG.includes('CAP-OS-LIST'), 'Deve conter CAP-OS-LIST');
  assert(OPERATIONAL_CAPABILITIES_CATALOG.includes('CAP-OS-DETAIL'), 'Deve conter CAP-OS-DETAIL');
  assert(CRITICAL_REVIEWER_RULES.includes(NO_PHYSICAL_YARD_DISCLAIMER), 'Prompt do revisor deve conter a regra de pátio físico');
  console.log('  ✅ [PASS] Catálogo operacional restrito a capacidades reais comprovadas.');

  console.log('\n🎉 =================================================================');
  console.log('   SUCESSO TOTAL! TODOS OS 8 BLOCOS DO EXECUTOR 1 PASSARAM (100% PASS)');
  console.log('   =================================================================\n');
}

runExecutor1InterpretationTests().catch(err => {
  console.error('\n❌ Falha na suíte do Executor 1:', err);
  process.exit(1);
});
