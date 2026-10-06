/**
 * TEST HARNESS — MISSÃO 2: CONVERSA NATURAL, WHATSAPP E INTEGRAÇÃO HYDRA
 * 
 * Validação rigorosa dos 6 turnos conversacionais encadeados, anáfora, elipse,
 * quebra de escopo para rede, regressão de CMV vs Raio-X, ausência de dados
 * e conformidade com formatação nativa mobile do WhatsApp (Anti-Slop).
 */

import { createTestFixtureDatabase } from '../../../fixtures/setup_test_db.js';
import { rewriteIntent } from '../intent_rewriter.js';
import { executeOperationalQuery } from '../operational_adapter.js';
import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat,
  splitIntoWhatsAppBlocks
} from '../format_utils.js';
import type { TurnState } from '../turn_context_repository.js';

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

async function runNaturalConversationTests() {
  console.log('🧪 Iniciando TEST HARNESS — MISSÃO 2: Conversa Natural & WhatsApp...\n');

  const db = createTestFixtureDatabase();
  let state: TurnState | undefined = undefined;

  // ===========================================================================
  // TURNO 1: "Falta muito pra meta?"
  // Pergunta direta sobre meta da rede consolidada.
  // Responde primeiro com quanto falta e atingimento, sem despejar tabela.
  // ===========================================================================
  console.log('--- Turno 1: "Falta muito pra meta?" (Rede Consolidada) ---');
  const t1_intent = rewriteIntent('Falta muito pra meta?', state);

  assert(t1_intent.intent === 'financial_alerts', '1.1: Intent deve ser financial_alerts');
  assert(t1_intent.subIntent === 'goal_gap', '1.1: SubIntent deve ser goal_gap');
  assert(t1_intent.lojaSlug === undefined, '1.1: Loja deve ser undefined (escopo de rede)');
  assert(!t1_intent.needsClarification, '1.1: Não deve pedir clarificação');

  const t1_res = await executeOperationalQuery(db, t1_intent);
  assert(t1_res.replyText.includes('> *Meta da rede'), '1.2: Header do card da rede');
  assert(t1_res.replyText.includes('- *Falta para bater:*'), '1.2: Linha de falta presente');
  assert(t1_res.replyText.includes('- *Atingimento:*'), '1.2: Linha de atingimento presente');
  assert(t1_res.replyText.includes('10 de 11 lojas'), '1.2: Cobertura de 10 de 11 lojas');
  assert(t1_res.replyText.includes('excluída Master'), '1.2: Ressalva sobre Master excluída');
  assert(assertNoDoubleAsterisks(t1_res.replyText), '1.3: Zero asterisco duplo (Anti-Slop)');
  assert(assertWhatsAppNativeFormat(t1_res.replyText), '1.3: Formatação nativa WhatsApp');
  assert(!t1_res.replyText.includes('| --- |'), '1.3: Zero tabela markdown');

  // Verifica que Falta para bater e Atingimento vêm antes de faturamento
  const posFalta = t1_res.replyText.indexOf('- *Falta para bater:*');
  const posAting = t1_res.replyText.indexOf('- *Atingimento:*');
  const posFat = t1_res.replyText.indexOf('- *Faturamento até');
  assert(posFalta < posFat, '1.4: Falta para bater vem antes de faturamento');
  assert(posAting < posFat, '1.4: Atingimento vem antes de faturamento');

  // Atualiza estado
  state = {
    phone: '5511999999999',
    lastTurnId: t1_intent.turnId,
    lastIntent: t1_intent.intent,
    lojaSlug: t1_intent.lojaSlug,
    filters: {
      subIntent: t1_intent.subIntent
    },
    lastContract: t1_intent.contract,
    updatedAt: new Date().toISOString()
  };

  // ===========================================================================
  // TURNO 2: "E Santo André?"
  // Elipse de loja que deve herdar a mesma métrica (goal_gap), SEM cair em Raio-X!
  // ===========================================================================
  console.log('\n--- Turno 2: "E Santo André?" (Elipse mantendo métrica de meta) ---');
  const t2_intent = rewriteIntent('E Santo André?', state);

  assert(t2_intent.intent === 'financial_alerts', '2.1: Intent deve ser financial_alerts (NÃO store_overview)');
  assert(t2_intent.subIntent === 'goal_gap', '2.1: SubIntent deve permanecer goal_gap');
  assert(t2_intent.lojaSlug === 'MPSantoAndre', '2.1: Loja resolvida como Santo André');
  assert(t2_intent.contract?.operation === 'financial_alerts', '2.1: Operação do contrato é financial_alerts');

  const t2_res = await executeOperationalQuery(db, t2_intent);
  assert(t2_res.replyText.includes('> *Meta: Santo André'), '2.2: Header de meta de Santo André');
  assert(t2_res.replyText.includes('- *Falta para bater:*'), '2.2: Linha de falta para bater');
  assert(t2_res.replyText.includes('- *Atingimento:*'), '2.2: Linha de atingimento');
  assert(t2_res.replyText.includes('- *Faturamento até'), '2.2: Linha de faturamento');
  assert(!t2_res.replyText.includes('Sem checklist'), '2.3: Zero campo de checklist de Raio-X');
  assert(!t2_res.replyText.includes('Veículos retidos'), '2.3: Zero campo de pátio');
  assert(assertWhatsAppNativeFormat(t2_res.replyText), '2.3: Formatação nativa WhatsApp');

  state = {
    phone: '5511999999999',
    lastTurnId: t2_intent.turnId,
    lastIntent: t2_intent.intent,
    lojaSlug: t2_intent.lojaSlug,
    filters: {
      subIntent: t2_intent.subIntent
    },
    lastContract: t2_intent.contract,
    updatedAt: new Date().toISOString()
  };

  // ===========================================================================
  // TURNO 3: "E o CMV dela?"
  // Anáfora ("dela" -> Santo André) pedindo CMV.
  // Deve começar com CMV em % no primeiro campo.
  // ===========================================================================
  console.log('\n--- Turno 3: "E o CMV dela?" (Anáfora de Loja + CMV % no Topo) ---');
  const t3_intent = rewriteIntent('E o CMV dela?', state);

  assert(t3_intent.intent === 'store_cmv', '3.1: Intent deve ser store_cmv');
  assert(t3_intent.lojaSlug === 'MPSantoAndre', '3.1: Anáfora resolve loja como Santo André');

  const t3_res = await executeOperationalQuery(db, t3_intent);
  assert(t3_res.replyText.includes('> *CMV: Santo André*'), '3.2: Header de CMV de Santo André');
  assert(t3_res.replyText.includes('- *CMV:* 30.00%'), '3.2: CMV percentual exato');
  assert(t3_res.replyText.includes('- *Custo total:*'), '3.2: Custo total presente');
  assert(t3_res.replyText.includes('- *Faturamento base:*'), '3.2: Faturamento base presente');
  assert(t3_res.replyText.includes('- *Lucro bruto:*'), '3.2: Lucro bruto presente');

  // Verifica que CMV % vem no PRIMEIRO campo métrico
  const posCMV = t3_res.replyText.indexOf('- *CMV:*');
  const posCusto = t3_res.replyText.indexOf('- *Custo total:*');
  const posFatBase = t3_res.replyText.indexOf('- *Faturamento base:*');
  assert(posCMV < posCusto, '3.3: CMV % vem antes de custo total');
  assert(posCusto < posFatBase, '3.3: Custo total vem antes de faturamento base');
  assert(assertWhatsAppNativeFormat(t3_res.replyText), '3.3: Formatação nativa WhatsApp');

  state = {
    phone: '5511999999999',
    lastTurnId: t3_intent.turnId,
    lastIntent: t3_intent.intent,
    lojaSlug: t3_intent.lojaSlug,
    filters: {},
    lastContract: t3_intent.contract,
    updatedAt: new Date().toISOString()
  };

  // ===========================================================================
  // TURNO 4: "Qual área tá pior?"
  // Pergunta sobre a área mais crítica por CMV de Santo André.
  // Deve destacar a pior área (Troca de Óleo com 38.00% de CMV) no topo.
  // ===========================================================================
  console.log('\n--- Turno 4: "Qual área tá pior?" (Área Crítica por Maior CMV %) ---');
  const t4_intent = rewriteIntent('Qual área tá pior?', state);

  assert(t4_intent.intent === 'store_areas', '4.1: Intent deve ser store_areas');
  assert(t4_intent.focusWorst === true, '4.1: Flag focusWorst deve ser true');
  assert(t4_intent.lojaSlug === 'MPSantoAndre', '4.1: Mantém contexto de Santo André');

  const t4_res = await executeOperationalQuery(db, t4_intent);
  assert(t4_res.replyText.includes('> *Pior Área por CMV: Santo André*'), '4.2: Header destaca pior área');
  assert(t4_res.replyText.includes('- *Área mais crítica:* *Troca de Óleo*'), '4.2: Troca de Óleo identificada como pior área');
  assert(t4_res.replyText.includes('- *CMV:* 38.00%'), '4.2: CMV de 38.00% da pior área informado');
  assert(t4_res.replyText.includes('> *Demais áreas da unidade*'), '4.2: Bloco das demais áreas presente');
  assert(assertWhatsAppNativeFormat(t4_res.replyText), '4.3: Formatação nativa WhatsApp');

  state = {
    phone: '5511999999999',
    lastTurnId: t4_intent.turnId,
    lastIntent: t4_intent.intent,
    lojaSlug: t4_intent.lojaSlug,
    filters: { focusWorst: true },
    lastContract: t4_intent.contract,
    updatedAt: new Date().toISOString()
  };

  // ===========================================================================
  // TURNO 5: "E de onde vêm os clientes?"
  // Pesquisa de mídia mantendo a loja Santo André.
  // Destaca o canal principal (Google / Internet).
  // ===========================================================================
  console.log('\n--- Turno 5: "E de onde vêm os clientes?" (Pesquisa de Mídia da Loja) ---');
  const t5_intent = rewriteIntent('E de onde vêm os clientes?', state);

  assert(t5_intent.intent === 'media_survey', '5.1: Intent deve ser media_survey');
  assert(t5_intent.lojaSlug === 'MPSantoAndre', '5.1: Mantém contexto de Santo André');

  const t5_res = await executeOperationalQuery(db, t5_intent);
  assert(t5_res.replyText.includes('> *Origem dos Clientes: Santo André*'), '5.2: Header de mídia de Santo André');
  assert(t5_res.replyText.includes('Principal canal:') && t5_res.replyText.includes('Google / Internet'), '5.2: Google / Internet identificado como canal principal');
  assert(t5_res.replyText.includes('Canais de Captação') || t5_res.replyText.includes('Canais de captação'), '5.2: Lista de canais presente');
  assert(assertWhatsAppNativeFormat(t5_res.replyText), '5.3: Formatação nativa WhatsApp');

  state = {
    phone: '5511999999999',
    lastTurnId: t5_intent.turnId,
    lastIntent: t5_intent.intent,
    lojaSlug: t5_intent.lojaSlug,
    filters: {},
    lastContract: t5_intent.contract,
    updatedAt: new Date().toISOString()
  };

  // ===========================================================================
  // TURNO 6: "Agora o faturamento das lojas"
  // Quebra de escopo para a rede! NUNCA deve herdar Santo André.
  // Apresenta todas as lojas encontradas sem transformar em top 3.
  // ===========================================================================
  console.log('\n--- Turno 6: "Agora o faturamento das lojas" (Quebra de Escopo para a Rede) ---');
  const t6_intent = rewriteIntent('Agora o faturamento das lojas', state);

  assert(t6_intent.intent === 'financial_alerts', '6.1: Intent deve ser financial_alerts');
  assert(t6_intent.subIntent === 'store_list', '6.1: SubIntent deve ser store_list');
  assert(t6_intent.lojaSlug === undefined, '6.1: Loja DEVE ser undefined (NÃO herda Santo André!)');

  const t6_res = await executeOperationalQuery(db, t6_intent);
  assert(t6_res.replyText.includes('> *Faturamento acumulado das lojas*'), '6.2: Header de faturamento acumulado');
  assert(t6_res.replyText.includes('10 de 11 lojas'), '6.2: Cobertura de 10 de 11 lojas');
  assert(t6_res.replyText.includes('> *Santo André*'), '6.2: Santo André listada como uma das lojas da rede');
  assert(t6_res.replyText.includes('> *Jabaquara*'), '6.2: Jabaquara listada');
  assert(t6_res.replyText.includes('> *Jorge Beretta*'), '6.2: Jorge Beretta listada com nome amigável');
  assert(assertWhatsAppNativeFormat(t6_res.replyText), '6.3: Formatação nativa WhatsApp');

  // ===========================================================================
  // TESTE 7: Regressão 15:29 — "Qual o cmv da Jorge Beretta" após pergunta de OS
  // Garante plano store_cmv, percentual no 1º bloco, zero Raio-X / pátio / checklist.
  // ===========================================================================
  console.log('\n--- Teste 7: Regressão 15:29 ("Qual o cmv da Jorge Beretta") ---');
  const stateOS: TurnState = {
    phone: '5511999999999',
    lastTurnId: 't-os-1',
    lastIntent: 'list_os',
    lojaSlug: undefined,
    filters: { onlyOpen: true },
    updatedAt: new Date().toISOString()
  };

  const t7_intent = rewriteIntent('Qual o cmv da Jorge Beretta', stateOS);
  assert(t7_intent.intent === 'store_cmv', '7.1: Intent deve ser store_cmv');
  assert(t7_intent.lojaSlug === 'MPJorgeBeretta', '7.1: Loja resolvida como MPJorgeBeretta');

  const t7_res = await executeOperationalQuery(db, t7_intent);
  assert(t7_res.replyText.includes('> *CMV: Jorge Beretta*'), '7.2: Header amigável Jorge Beretta (nunca MPJorgeBeretta)');
  assert(t7_res.replyText.includes('- *CMV:* 19.66%'), '7.2: CMV percentual de 19.66%');
  assert(t7_res.replyText.includes('- *Custo total:*'), '7.2: Custo total');
  assert(t7_res.replyText.includes('- *Faturamento base:*'), '7.2: Faturamento base');
  assert(!t7_res.replyText.includes('Sem checklist'), '7.3: Zero campo de checklist');
  assert(!t7_res.replyText.includes('Veículos retidos'), '7.3: Zero campo de pátio');
  assert(!t7_res.replyText.includes('Ordens em aberto'), '7.3: Zero campo de ordens');

  // ===========================================================================
  // TESTE 8: Loja sem dados de CMV (Kennedy)
  // Não inventar dados nem fazer fallback para OSs aleatórias ou Raio-X!
  // ===========================================================================
  console.log('\n--- Teste 8: Loja sem dados de CMV (Kennedy) ---');
  const t8_intent = rewriteIntent('Qual o cmv da Kennedy?', undefined);
  assert(t8_intent.intent === 'store_cmv', '8.1: Intent store_cmv');
  assert(t8_intent.lojaSlug === 'MPkennedy', '8.1: Loja MPkennedy');

  const t8_res = await executeOperationalQuery(db, t8_intent);
  assert(t8_res.replyText.includes('Nenhum dado de CMV disponível para a unidade *Kennedy*'), '8.2: Resposta transparente de indisponibilidade');
  assert(!t8_res.replyText.includes('R$ 0,00'), '8.2: Não mascara ausência como R$ 0,00');
  assert(!t8_res.replyText.includes('Sem checklist'), '8.2: Zero fallback para Raio-X');

  // ===========================================================================
  // TESTE 9: Unidade Administrativa Master
  // Explica a regra contábil da Master sem inventar dados
  // ===========================================================================
  console.log('\n--- Teste 9: Unidade Master (Exclusão Administrativa) ---');
  const t9_intent = rewriteIntent('Qual o cmv da Master?', undefined);
  const t9_res = await executeOperationalQuery(db, t9_intent);
  assert(t9_res.replyText.includes('Master') && t9_res.replyText.includes('administrativa'), '9.1: Explica que Master é administrativa');

  // ===========================================================================
  // TESTE 10: "como tá o cmv..." não cai em store_overview
  // ===========================================================================
  console.log('\n--- Teste 10: "como tá o cmv..." Roteado para store_cmv ---');
  const t10_intent = rewriteIntent('como tá o cmv de santo andré?', undefined);
  assert(t10_intent.intent === 'store_cmv', '10.1: "como tá o cmv..." deve ser store_cmv (NÃO store_overview)');

  const t10_meta = rewriteIntent('como tá a meta de santo andré?', undefined);
  assert(t10_meta.intent === 'financial_alerts', '10.2: "como tá a meta..." deve ser financial_alerts (NÃO store_overview)');

  console.log('\n========================================================');
  console.log(`🏆 RESULTADO FINAL MISSÃO 2: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('========================================================\n');
}

runNaturalConversationTests().catch(err => {
  console.error('Erro na execução dos testes da Missão 2:', err);
  process.exit(1);
});
