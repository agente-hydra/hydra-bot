/**
 * Test Harness - Camada A: Banco Fict?cio + Contratos (Spec Integrada)
 * Valida:
 * 1. Sequ?ncia anaf?rica: sem sinal -> maior dessas -> maior de Santo Andr? -> e a mais antiga
 * 2. Busca por modelo de ve?culo e tempo de p?tio ("o Fiesta t? h? quanto tempo na loja?")
 * 3. Busca por OS e tempo de p?tio ("OS 8770 quanto tempo na loja?")
 * 4. Auditoria de checklist completo ("quais est?o sem checklist? completo")
 * 5. Faturamento consolidado ("faturamento das lojas")
 * 6. Duas lojas com o mesmo n?mero de OS (desambigua??o obrigat?ria da OS #5555)
 * 7. Recusa de fora de escopo (receita e futebol) sem consultar banco
 * 8. Recusa de link externo de Chatwoot sem consultar banco
 * 9. Conformidade 100% estrita de Formata??o Nativa WhatsApp (> *, - *, zero **)
 */

import { createTestFixtureDatabase, TEST_DB_PATH } from '../../../fixtures/setup_test_db.js';
import { executeOperationalQuery } from '../operational_adapter.js';
import { rewriteIntent } from '../intent_rewriter.js';
import { clearTurnState, saveTurnState, getLatestTurnState, type TurnState } from '../turn_context_repository.js';
import { assertWhatsAppNativeFormat, assertNoDoubleAsterisks } from '../format_utils.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ? [PASS] ${testName}`);
  } else {
    console.error(`  ? [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
    process.exitCode = 1;
  }
}

async function runLayerATests() {
  console.log('?? Iniciando TEST HARNESS ? CAMADA A: Banco Fict?cio + Contratos...\n');

  // Inicializa o banco de testes fict?cio isolado
  const db = createTestFixtureDatabase();
  const testPhone = '5511999991111';
  clearTurnState(db, testPhone);

  // ???????????????????????????????????????????????????????????????????????????
  // TESTE 1: Sequ?ncia Can?nica Completa (Crit?rio de Aceita??o Principal)
  // ???????????????????????????????????????????????????????????????????????????
  console.log('--- Teste 1: Sequ?ncia Cr?tica: sem sinal -> maior dessas -> maior de Sto Andr? -> mais antiga ---');

  // Passo 1.1: "quais OS est?o sem sinal no jabaquara?"
  const turn1Intent = rewriteIntent('quais OS est?o sem sinal no jabaquara?', null);
  assert(turn1Intent.intent === 'list_os', '1.1: Intent deve ser list_os');
  assert(turn1Intent.lojaSlug === 'MPJabaquara', '1.1: Loja resolvida deve ser MPJabaquara');
  assert(turn1Intent.noDeposit === true, '1.1: Filtro noDeposit deve ser true');
  assert(turn1Intent.onlyOpen === true, '1.1: Filtro onlyOpen deve ser true');

  const turn1Exec = await executeOperationalQuery(db, turn1Intent);
  assert(turn1Exec.records.length === 2, '1.1: Jabaquara tem 2 OSs sem sinal (101 e 102)', `Qtd: ${turn1Exec.records.length}`);
  assert(assertWhatsAppNativeFormat(turn1Exec.replyText), '1.1: Resposta no padr?o WhatsApp nativo');

  // Salva estado do turno 1
  const stateTurn1: TurnState = {
    phone: testPhone,
    lastTurnId: 't1',
    lastIntent: 'list_os',
    lojaSlug: 'MPJabaquara',
    filters: { onlyOpen: true, noDeposit: true },
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, stateTurn1);

  // Passo 1.2: "qual a maior dessas?" (An?fora expl?cita "dessas")
  const turn2Intent = rewriteIntent('qual a maior dessas?', stateTurn1);
  assert(turn2Intent.intent === 'list_os', '1.2: Intent deve ser list_os');
  assert(turn2Intent.lojaSlug === 'MPJabaquara', '1.2: Deve herdar loja MPJabaquara');
  assert(turn2Intent.noDeposit === true, '1.2: Deve PRESERVAR filtro noDeposit=true atrav?s da an?fora "dessas"');
  assert(turn2Intent.sort?.field === 'valor_total' && turn2Intent.sort?.limit === 1, '1.2: Deve ordenar por valor_total DESC limit 1');

  const turn2Exec = await executeOperationalQuery(db, turn2Intent);
  assert(turn2Exec.records.length === 1, '1.2: Retorna exatamente 1 OS campe?');
  assert(turn2Exec.records[0].os_id === '102', '1.2: A maior OS sem sinal do Jabaquara ? a #102 (R$ 25.000,00)', `Retornou: OS #${turn2Exec.records[0]?.os_id}`);
  assert(turn2Exec.replyText.includes('25.000,00'), '1.2: Texto inclui o valor R$ 25.000,00');
  assert(assertWhatsAppNativeFormat(turn2Exec.replyText), '1.2: Resposta no padr?o WhatsApp nativo');

  // Salva estado do turno 2
  const stateTurn2: TurnState = {
    phone: testPhone,
    lastTurnId: 't2',
    lastIntent: 'list_os',
    lojaSlug: 'MPJabaquara',
    filters: { onlyOpen: true, noDeposit: true, sort: turn2Intent.sort },
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, stateTurn2);

  // Passo 1.3: "qual a maior OS em aberto de sto andre?" (Nova consulta autossuficiente)
  const turn3Intent = rewriteIntent('qual a maior OS em aberto de sto andre?', stateTurn2);
  assert(turn3Intent.lojaSlug === 'MPSantoAndre', '1.3: Deve substituir loja para MPSantoAndre');
  assert(turn3Intent.noDeposit === undefined, '1.3: Deve REMOVER o filtro noDeposit anterior (n?o mencionado)');
  assert(turn3Intent.sort?.field === 'valor_total' && turn3Intent.sort?.limit === 1, '1.3: Ordena??o por valor_total DESC limit 1');

  const turn3Exec = await executeOperationalQuery(db, turn3Intent);
  assert(turn3Exec.records.length === 1, '1.3: Retorna 1 OS campe? de Santo Andr?');
  assert(turn3Exec.records[0].os_id === '201', '1.3: Maior OS em aberto de Santo Andr? ? a #201 (R$ 42.000,00)', `Retornou: OS #${turn3Exec.records[0]?.os_id}`);
  assert(turn3Exec.replyText.includes('42.000,00'), '1.3: Texto inclui o valor R$ 42.000,00');
  assert(assertWhatsAppNativeFormat(turn3Exec.replyText), '1.3: Resposta no padr?o WhatsApp nativo');

  // Salva estado do turno 3
  const stateTurn3: TurnState = {
    phone: testPhone,
    lastTurnId: 't3',
    lastIntent: 'list_os',
    lojaSlug: 'MPSantoAndre',
    filters: { onlyOpen: true, sort: turn3Intent.sort },
    updatedAt: new Date().toISOString()
  };
  saveTurnState(db, stateTurn3);

  // Passo 1.4: "e a mais antiga?" (Elipse de ordena??o mantendo loja)
  const turn4Intent = rewriteIntent('e a mais antiga?', stateTurn3);
  assert(turn4Intent.lojaSlug === 'MPSantoAndre', '1.4: Deve MANTER loja MPSantoAndre do turno 3');
  assert(turn4Intent.sort?.field === 'dias_no_patio' && turn4Intent.sort?.limit === 1, '1.4: Ordena??o por dias_no_patio DESC limit 1');

  const turn4Exec = await executeOperationalQuery(db, turn4Intent);
  assert(turn4Exec.records.length === 1, '1.4: Retorna 1 OS mais antiga');
  assert(turn4Exec.records[0].os_id === '202', '1.4: OS mais antiga de Santo Andr? ? a #202 (22 dias)', `Retornou: OS #${turn4Exec.records[0]?.os_id}`);
  assert(turn4Exec.records[0].dias_no_patio === 22, '1.4: Dias no p?tio deve ser 22');
  assert(assertWhatsAppNativeFormat(turn4Exec.replyText), '1.4: Resposta no padr?o WhatsApp nativo');

  // ???????????????????????????????????????????????????????????????????????????
  // TESTE 2: Cen?rios Problem?ticos Obrigat?rios
  // ???????????????????????????????????????????????????????????????????????????
  console.log('\n--- Teste 2: Cen?rios Problem?ticos do Dom?nio ---');

  // Cen?rio 2.1: "o Fiesta t? h? quanto tempo na loja?"
  const fiestaIntent = rewriteIntent('o Fiesta t? h? quanto tempo na loja?', null);
  assert(fiestaIntent.veiculo === 'Fiesta', '2.1: Deve extrair modelo Fiesta');
  const fiestaExec = await executeOperationalQuery(db, fiestaIntent);
  assert(fiestaExec.records.length > 0, '2.1: Encontra ordem do Fiesta');
  assert(fiestaExec.records[0].os_id === '101', '2.1: OS do Fiesta ? #101');
  assert(fiestaExec.replyText.includes('14 dias'), '2.1: Resposta informa expressamente os 14 dias no p?tio');
  assert(assertWhatsAppNativeFormat(fiestaExec.replyText), '2.1: Formata??o WhatsApp nativa no Fiesta');

  // Cen?rio 2.2: "OS 8770 quanto tempo na loja?"
  const os8770Intent = rewriteIntent('OS 8770 quanto tempo na loja?', null);
  assert(os8770Intent.osId === '8770', '2.2: Deve extrair OS #8770');
  const os8770Exec = await executeOperationalQuery(db, os8770Intent);
  assert(os8770Exec.records.length > 0, '2.2: Encontra OS #8770');
  assert(os8770Exec.replyText.includes('8 dias'), '2.2: Resposta informa os 8 dias no p?tio');
  assert(assertWhatsAppNativeFormat(os8770Exec.replyText), '2.2: Formata??o WhatsApp nativa na OS 8770');

  // Cen?rio 2.3: "quais est?o sem checklist? completo"
  const checkCompletoIntent = rewriteIntent('quais est?o sem checklist? completo', null);
  assert(Boolean(checkCompletoIntent.serviceTerms?.includes('checklist')), '2.3: Termos cont?m checklist');
  const checkExec = await executeOperationalQuery(db, checkCompletoIntent);
  assert(checkExec.toolsCalled.includes('get_checklist_audit'), '2.3: Dispara auditoria de checklist');
  assert(assertWhatsAppNativeFormat(checkExec.replyText), '2.3: Formata??o nativa no checklist completo');

  // Cen?rio 2.4: "faturamento das lojas"
  const fatIntent = rewriteIntent('faturamento das lojas', null);
  assert(fatIntent.intent === 'financial_alerts', '2.4: Intent deve ser financial_alerts');
  const fatExec = await executeOperationalQuery(db, fatIntent);
  assert(fatExec.replyText.includes('Faturamento acumulado'), '2.4: Resposta inclui faturamento acumulado');
  assert(assertWhatsAppNativeFormat(fatExec.replyText), '2.4: Formata??o nativa no faturamento');

  // Cen?rio 2.5: Conflito de OS Duplicada em Lojas Diferentes (OS #5555)
  const dupIntent = rewriteIntent('OS 5555', null);
  assert(dupIntent.osId === '5555', '2.5: Identifica OS #5555');
  const dupExec = await executeOperationalQuery(db, dupIntent);
  assert(dupExec.toolsCalled.includes('search_os_disambiguation'), '2.5: Ativa motor de desambigua??o de m?ltiplas lojas');
  assert(dupExec.records.length === 2, '2.5: Retorna ambas as ocorr?ncias (Dom Pedro I e Santo Andr?)');
  assert(dupExec.replyText.includes('MPdompedro1') && dupExec.replyText.includes('MPSantoAndre'), '2.5: Exibe claramente as duas lojas sem colapso');
  assert(assertWhatsAppNativeFormat(dupExec.replyText), '2.5: Formata??o nativa na desambigua??o');

  // Cen?rio 2.6: Fora de Escopo - Receita Culin?ria
  const receitaIntent = rewriteIntent('como fazer bolo de cenoura com calda de chocolate?', null);
  assert(receitaIntent.needsClarification === true, '2.6: Fora de escopo receita ativa recusa/esclarecimento');
  assert(receitaIntent.contract?.decision === 'out_of_scope', '2.6: Contrato decision = out_of_scope');
  const receitaExec = await executeOperationalQuery(db, receitaIntent);
  assert(receitaExec.source === 'NONE', '2.6: ZERO chamadas ao banco de OS');
  assert(receitaExec.replyText.includes('Mecânica Popular'), '2.6: Mensagem institucional de foco operacional');

  // Cen?rio 2.7: Fora de Escopo - Futebol / Jogo
  const futebolIntent = rewriteIntent('quem ganhou o jogo do Corinthians ontem?', null);
  assert(futebolIntent.needsClarification === true, '2.7: Fora de escopo futebol ativa recusa');
  assert(futebolIntent.contract?.decision === 'out_of_scope', '2.7: Contrato decision = out_of_scope');
  const futebolExec = await executeOperationalQuery(db, futebolIntent);
  assert(futebolExec.source === 'NONE', '2.7: ZERO chamadas ao banco de OS');

  // Cen?rio 2.8: Capacidade Indispon?vel - Link de Conversa Externo
  const linkIntent = rewriteIntent('olha essa conversa https://chat.tork.services/app/accounts/1/conversations/1234', null);
  assert(linkIntent.needsClarification === true, '2.8: Link externo ativa recusa');
  assert(linkIntent.contract?.decision === 'unsupported_capability', '2.8: Contrato decision = unsupported_capability');
  const linkExec = await executeOperationalQuery(db, linkIntent);
  assert(linkExec.source === 'NONE', '2.8: ZERO chamadas ao banco de OS');
  assert(linkExec.replyText.includes('Chatwoot'), '2.8: Informa que n?o acessa links do Chatwoot');

  // ???????????????????????????????????????????????????????????????????????????
    // ---------------------------------------------------------------------------
  // TESTE 3: Metas e Relatórios Financeiros (Proposta WhatsApp)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 3: Metas e Relatórios Financeiros (Anti-Slop / Native WhatsApp) ---');

  // 3.1: "falta mt pra bater a meta?" (Rede inteira)
  const goalGapNetIntent = rewriteIntent('falta mt pra bater a meta?', null);
  assert(goalGapNetIntent.intent === 'financial_alerts', '3.1: Intent deve ser financial_alerts');
  assert(goalGapNetIntent.subIntent === 'goal_gap', '3.1: SubIntent deve ser goal_gap');
  const goalGapNetExec = await executeOperationalQuery(db, goalGapNetIntent);
  assert(goalGapNetExec.replyText.includes('Falta para bater:'), '3.1: Responde diretamente quanto falta para bater a meta');
  assert(goalGapNetExec.replyText.includes('10 de 11 lojas'), '3.1: Ressalva clara sobre 10 de 11 lojas elegíveis');
  assert(assertWhatsAppNativeFormat(goalGapNetExec.replyText), '3.1: Padrão estrito WhatsApp nativo');

  // 3.2: "falta quanto pra meta de Santo André?" (Loja específica)
  const goalGapStoreIntent = rewriteIntent('falta quanto pra meta de Santo André?', null);
  assert(goalGapStoreIntent.intent === 'financial_alerts', '3.2: Intent deve ser financial_alerts');
  assert(goalGapStoreIntent.subIntent === 'goal_gap', '3.2: SubIntent deve ser goal_gap');
  assert(goalGapStoreIntent.lojaSlug === 'MPSantoAndre', '3.2: Loja deve ser MPSantoAndre');
  const goalGapStoreExec = await executeOperationalQuery(db, goalGapStoreIntent);
  assert(goalGapStoreExec.replyText.includes('Santo André'), '3.2: Identifica loja Santo André');
  assert(goalGapStoreExec.replyText.includes('Falta para bater:'), '3.2: Informa quanto falta diretamente');
  assert(goalGapStoreExec.replyText.includes('96.7%'), '3.2: Informa percentual de atingimento');
  assert(assertWhatsAppNativeFormat(goalGapStoreExec.replyText), '3.2: Padrão estrito WhatsApp nativo');

  // 3.3: "faturamento das lojas" (Listagem completa das 10 lojas em blocos de 5)
  const fatAllIntent = rewriteIntent('faturamento das lojas', null);
  const fatAllExec = await executeOperationalQuery(db, fatAllIntent);
  assert(fatAllExec.replyText.includes('Total da rede:'), '3.3: Total da rede informado');
  assert(fatAllExec.replyText.includes('10 de 11 lojas, excluída Master'), '3.3: Cobertura explícita de 10 de 11 lojas');
  assert(fatAllExec.replyText.includes('---BLOCK---'), '3.3: Divide em blocos seguros de até 5 lojas');
  assert(assertWhatsAppNativeFormat(fatAllExec.replyText.replace(/---BLOCK---/g, '')), '3.3: Padrão estrito WhatsApp nativo sem tabelas');

  // 3.4: "qual o CMV de Santo André?"
  const cmvIntent = rewriteIntent('qual o CMV de Santo André?', null);
  assert(cmvIntent.intent === 'store_cmv', '3.4: Intent deve ser store_cmv');
  assert(cmvIntent.lojaSlug === 'MPSantoAndre', '3.4: Loja deve ser MPSantoAndre');
  const cmvExec = await executeOperationalQuery(db, cmvIntent);
  assert(cmvExec.toolsCalled.includes('get_store_cmv'), '3.4: Chama ferramenta get_store_cmv');
  assert(cmvExec.replyText.includes('30.00%'), '3.4: Informa CMV percentual correto');
  assert(cmvExec.replyText.includes('Lucro bruto:'), '3.4: Informa lucro bruto');
  assert(assertWhatsAppNativeFormat(cmvExec.replyText), '3.4: Padrão estrito WhatsApp nativo');

  // 3.5: "faturamento por área de Santo André"
  const areasIntent = rewriteIntent('faturamento por área de Santo André', null);
  assert(areasIntent.intent === 'store_areas', '3.5: Intent deve ser store_areas');
  assert(areasIntent.lojaSlug === 'MPSantoAndre', '3.5: Loja deve ser MPSantoAndre');
  const areasExec = await executeOperationalQuery(db, areasIntent);
  assert(areasExec.toolsCalled.includes('get_store_areas'), '3.5: Chama ferramenta get_store_areas');
  assert(areasExec.replyText.includes('Mecânica Geral'), '3.5: Lista área de Mecânica Geral');
  assert(assertWhatsAppNativeFormat(areasExec.replyText), '3.5: Padrão estrito WhatsApp nativo');

  // 3.6: "pesquisa de mídia de Santo André"
  const midiaIntent = rewriteIntent('pesquisa de mídia de Santo André', null);
  assert(midiaIntent.intent === 'media_survey', '3.6: Intent deve ser media_survey');
  assert(midiaIntent.lojaSlug === 'MPSantoAndre', '3.6: Loja deve ser MPSantoAndre');
  const midiaExec = await executeOperationalQuery(db, midiaIntent);
  assert(midiaExec.toolsCalled.includes('get_media_survey'), '3.6: Chama ferramenta get_media_survey');
  assert(midiaExec.replyText.includes('Google / Internet'), '3.6: Lista canal Google');
  assert(midiaExec.replyText.includes('Conclusão:'), '3.6: Inclui conclusão acionável do canal campeão');
  assert(assertWhatsAppNativeFormat(midiaExec.replyText), '3.6: Padrão estrito WhatsApp nativo');

// RESULTADO FINAL DA CAMADA A
  // ???????????????????????????????????????????????????????????????????????????
  console.log('\n========================================================');
  console.log(`?? RESULTADO CAMADA A: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('========================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runLayerATests().catch(err => {
  console.error('? Falha na bateria de testes da Camada A:', err);
  process.exit(1);
});
