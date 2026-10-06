/**
 * src/hydra-sync/tests/test_executor1_language_comprehension.ts
 *
 * Suíte de Testes da Frente 1: Voz, Tom e Interpretação Semântica (Hermes-Style)
 *
 * Cenários Cobertos:
 * [E1-01] Tom Executivo e Respostas Diretas:
 *   - Formalidade leve ("Entendi", "Faltam...", "Encontrei...", "Não consegui consultar...")
 *   - Resposta direta na 1ª frase
 *   - Eliminação de gírias ("bora", "desenrolar", "tô na escuta", "meu parceiro", "valeu pelo toque", "opa, tranquilo")
 * [E1-02] Eliminação de perguntas automáticas de encerramento ("Posso ajudar em mais alguma coisa?")
 * [E1-03] Reconhecimento Ágil de Correção:
 *   - Reconhecimento em 1 frase ("Entendido, peço desculpas pela confusão anterior.")
 *   - Resposta imediata à solicitação retificada
 * [E1-04] Decisão Semântica Compacta (CompactSemanticDecision):
 *   - Geração no intent_rewriter.ts
 *   - Intenção, entidade, loja, período e requestedComponents
 * [E1-05] Pedidos Compostos:
 *   - "faturamento e OS do mês da minha loja" -> REVENUE_MONTH e OS_LIST
 *   - "faturamento e CMV" -> REVENUE_DAY e STORE_CMV
 *   - Declaração transparente de pendências
 * [E1-06] Continuidade Elíptica:
 *   - "e ontem?", "dessa loja", "dessas ordens"
 *   - Recálculo civil (D-1 e mês anterior)
 *   - Desambiguação específica se loja não definida
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  rewriteIntent,
  getCivilYesterdayDate,
  getCivilLastMonthRange
} from '../intent_rewriter.js';
import {
  dispatchMessage
} from '../agent_dispatcher.js';
import {
  ensureUserProfileSchema,
  saveUserProfile
} from '../command_interceptor.js';
import {
  ensureTurnContextTable,
  saveTurnState,
  type TurnState
} from '../turn_context_repository.js';
import {
  CRITICAL_REVIEWER_RULES,
  buildSynthesisPrompt
} from '../semantic_prompt.js';
import {
  type CompactSemanticDecision
} from '../types/language_contract.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    process.exitCode = 1;
  }
}

function createPopulatedDb(): Database.Database {
  const db = new Database(':memory:');
  ensureUserProfileSchema(db);
  ensureTurnContextTable(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS metas_diarias (
      id INTEGER PRIMARY KEY, loja_slug TEXT, data_referencia TEXT, posicao_hora TEXT,
      faturamento_mes REAL, volume_os INTEGER, ticket_medio REAL, meta_mes REAL, percentual_meta REAL
    );
    CREATE TABLE IF NOT EXISTS cmv_lojas (
      id INTEGER PRIMARY KEY, loja_slug TEXT, data_inicio TEXT, data_fim TEXT,
      cmv_percentual REAL, faturamento_total REAL, custo_total REAL
    );
    CREATE TABLE IF NOT EXISTS ordens_servico (
      os_id TEXT, loja_slug TEXT, placa TEXT, veiculo TEXT, cliente_nome TEXT, responsavel TEXT,
      status_grid TEXT, is_aberta INTEGER, total_os REAL, valor_pago REAL, valor_restante REAL,
      dias_no_patio INTEGER, data_inicio TEXT, data_fim TEXT, PRIMARY KEY (os_id, loja_slug)
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, role TEXT, content TEXT,
      tool_used TEXT, tool_params TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_interaction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, conversation_id INTEGER,
      message_id INTEGER, pergunta TEXT, tools_chamadas TEXT, resposta_gerada TEXT,
      latencia_ms INTEGER, motor_utilizado TEXT, erro TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      message_id TEXT PRIMARY KEY, phone TEXT, status TEXT, response_payload TEXT,
      tools_called TEXT, motor_used TEXT, latencia_ms INTEGER, created_at DATETIME, updated_at DATETIME
    );

    INSERT INTO metas_diarias VALUES (1, 'MPdompedro1', '2026-09-30', '11:31', 115000, 85, 1352.94, 120000, 95.8);
    INSERT INTO metas_diarias VALUES (2, 'jabaquara', '2026-09-30', '11:31', 88000, 60, 1466.66, 95000, 92.6);
    INSERT INTO cmv_lojas VALUES (1, 'MPdompedro1', '2026-09-01', '2026-09-30', 20.0, 115000, 23000);
    INSERT INTO cmv_lojas VALUES (2, 'jabaquara', '2026-09-01', '2026-09-30', 18.5, 88000, 16280);
    INSERT INTO ordens_servico VALUES ('101', 'jabaquara', 'AAA1111', 'Civic', 'Joao Silva', 'Carlos', 'Aberta', 1, 100, 50, 50, 2, '2026-09-28', NULL);
    INSERT INTO ordens_servico VALUES ('102', 'jabaquara', 'BBB2222', 'Corolla', 'Maria Lima', 'Ana', 'Aberta', 1, 250, 100, 150, 4, '2026-09-27', NULL);
  `);

  saveUserProfile(db, {
    phone: '5511999990001',
    persona: 'socio',
    lojaSlug: 'jabaquara',
    lojaNome: 'Jabaquara',
    defaultScope: 'rede',
    memoryGeneration: 1,
    updatedAt: new Date().toISOString()
  });

  return db;
}

async function runLanguageComprehensionTests() {
  console.log('🚀 Iniciando Suíte de Testes da Frente 1: Voz, Tom e Interpretação Semântica...\n');

  const testPhone = '5511999990001';

  // =========================================================================
  // BLOCO 1: TOM EXECUTIVO E ELIMINAÇÃO DE GÍRIAS / ENCERRAMENTOS AUTOMÁTICOS
  // =========================================================================
  console.log('--- [BLOCO 1] Tom Executivo e Respostas Diretas (L01/L02) ---');

  await it('1.1. Saudação "olá" responde com tom executivo sem gírias e sem rodeios', async () => {
    const db = createPopulatedDb();
    const res = await dispatchMessage({
      db,
      phone: testPhone,
      message: 'olá',
      messageId: 1001
    });

    assert.equal(res.replyText, 'Olá! Como posso ajudar hoje?');
    const prohibitedWords = ['bora', 'desenrolar', 'tô na escuta', 'meu parceiro', 'valeu pelo toque', 'opa, tranquilo', 'Claro!', 'Com certeza!'];
    for (const w of prohibitedWords) {
      assert(!res.replyText.toLowerCase().includes(w.toLowerCase()), `Resposta não deve conter gíria: "${w}"`);
    }
    assert(!res.replyText.includes('Posso ajudar em mais alguma coisa?'), 'Não deve conter encerramento automático');
  });

  await it('1.2. Agradecimento "valeu, muito obrigado!" responde de forma cortês e direta', async () => {
    const db = createPopulatedDb();
    const res = await dispatchMessage({
      db,
      phone: testPhone,
      message: 'valeu, muito obrigado!',
      messageId: 1002
    });

    assert.equal(res.replyText, 'À disposição. Qualquer dúvida, estou por aqui.');
    assert(!res.replyText.includes('Posso ajudar em mais alguma coisa?'), 'Não deve conter encerramento automático');
  });

  await it('1.3. Regras executivas e anti-slop presentes nos prompts centrais', async () => {
    const promptTs = fs.readFileSync(path.resolve(__dirname, '../semantic_prompt.ts'), 'utf8');
    const promptMd = fs.readFileSync(path.resolve(__dirname, '../semantic_prompt.md'), 'utf8');
    const systemMd = fs.readFileSync(path.resolve(__dirname, '../system_prompt.md'), 'utf8');

    for (const content of [promptTs, promptMd, systemMd]) {
      assert(content.includes('Tom Executivo') || content.includes('TOM EXECUTIVO'), 'Deve conter diretriz de Tom Executivo');
      assert(content.includes('bora') && content.includes('desenrolar'), 'Deve listar gírias proibidas explicitamente');
      assert(content.includes('Posso ajudar em mais alguma coisa?'), 'Deve proibir pergunta mecânica de encerramento');
    }
  });

  // =========================================================================
  // BLOCO 2: RECONHECIMENTO ÁGIL DE CORREÇÃO CONVERSACIONAL (L03 / E1-03)
  // =========================================================================
  console.log('\n--- [BLOCO 2] Reconhecimento Ágil de Correção (L03 / E1-03) ---');

  await it('2.1. "não foi isso" reconhecido em 1 frase executiva e reseta filtros', async () => {
    const db = createPopulatedDb();
    // Simula estado anterior com filtros
    saveTurnState(db, {
      phone: testPhone,
      lastTurnId: 'turn_old_1',
      lastIntent: 'financial_alerts',
      lojaSlug: 'jabaquara',
      filters: { subIntent: 'single_store' },
      lastContract: {
        version: '1.0',
        turnId: 'turn_old_1',
        timestamp: new Date().toISOString(),
        decision: 'execute',
        operation: 'financial_alerts',
        entities: { loja: { raw: 'jabaquara', slug: 'jabaquara', name: 'Jabaquara', prep: 'de', confidence: 1.0 } },
        filters: {},
        turnRelation: { type: 'new_query', inheritedFilters: [], overriddenFilters: [], removedFilters: [] },
        ambiguity: { isAmbiguous: false },
        canonicalQuestion: 'Faturamento Jabaquara',
        plan: { operation: 'financial_alerts', entities: {}, filters: {} }
      },
      updatedAt: new Date().toISOString()
    });

    const rewrite = rewriteIntent('não foi isso', {
      phone: testPhone,
      lastTurnId: 'turn_old_1',
      lastIntent: 'financial_alerts',
      lojaSlug: 'jabaquara',
      filters: {},
      updatedAt: new Date().toISOString()
    });

    assert.equal(rewrite.intent, 'conversation_correction');
    assert.equal(rewrite.contract?.operation, 'conversation_correction');
    assert(rewrite.contract?.turnRelation?.removedFilters?.includes('lojaSlug'));

    // Teste dispatchMessage
    const res = await dispatchMessage({
      db,
      phone: testPhone,
      message: 'não foi isso',
      messageId: 1003
    });

    assert.equal(res.replyText, 'Entendido, peço desculpas pela confusão anterior.');
    assert.equal(res.toolsCalled[0], 'conversation_correction');
  });

  await it('2.2. Correção com solicitação substantiva retificada processa a nova consulta', async () => {
    const rewrite = rewriteIntent('não foi isso, quanto faturou o Jabaquara hoje?');
    assert.equal(rewrite.intent, 'financial_alerts');
    assert(rewrite.lojaSlug === 'MPJabaquara' || rewrite.lojaSlug === 'jabaquara');
    assert.equal(rewrite.compactDecision?.primaryIntent, 'financial_alerts');
    assert.equal(rewrite.compactDecision?.period, 'hoje');
  });

  // =========================================================================
  // BLOCO 3: DECISÃO SEMÂNTICA COMPACTA (CompactSemanticDecision) (L04 / E1-04)
  // =========================================================================
  console.log('\n--- [BLOCO 3] Decisão Semântica Compacta (L04 / E1-04) ---');

  await it('3.1. CompactSemanticDecision gerada para faturamento diário', async () => {
    const res = rewriteIntent('Quanto a Dom Pedro faturou hoje?');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar presente');
    assert.equal(res.compactDecision?.primaryIntent, 'financial_alerts');
    assert.equal(res.compactDecision?.entityType, 'store');
    assert.equal(res.compactDecision?.lojaSlug, 'MPdompedro1');
    assert.equal(res.compactDecision?.period, 'hoje');
    assert(res.compactDecision?.requestedComponents.includes('REVENUE_DAY'));
  });

  await it('3.2. CompactSemanticDecision gerada para listagem de OS', async () => {
    const res = rewriteIntent('Quais as ordens de serviço abertas no Jabaquara?');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar presente');
    assert.equal(res.compactDecision?.primaryIntent, 'list_os');
    assert(res.compactDecision?.lojaSlug === 'jabaquara' || res.compactDecision?.lojaSlug === 'MPJabaquara');
    assert(res.compactDecision?.requestedComponents.includes('OS_LIST'));
  });

  await it('3.3. CompactSemanticDecision gerada para CMV com loja', async () => {
    const res = rewriteIntent('Qual o CMV da Kennedy?');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar presente');
    assert.equal(res.compactDecision?.primaryIntent, 'store_cmv');
    assert.equal(res.compactDecision?.lojaSlug, 'MPkennedy');
    assert(res.compactDecision?.requestedComponents.includes('STORE_CMV'));
  });

  await it('3.4. CompactSemanticDecision preenche periodDates civis precisas para ontem', async () => {
    const y = getCivilYesterdayDate();
    const res = rewriteIntent('Quanto o Jabaquara faturou ontem?');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar presente');
    assert.equal(res.compactDecision?.period, 'ontem');
    assert.equal(res.compactDecision?.periodDates?.startDate, y.dateStr);
    assert.equal(res.compactDecision?.periodDates?.endDate, y.dateStr);
  });

  // =========================================================================
  // BLOCO 4: PEDIDOS COMPOSTOS E DECLARAÇÃO DE PENDÊNCIAS (L05 / E1-05)
  // =========================================================================
  console.log('\n--- [BLOCO 4] Pedidos Compostos (L05 / E1-05) ---');

  await it('4.1. "faturamento e OS do mês da minha loja" identifica REVENUE_MONTH e OS_LIST', async () => {
    const prevState: TurnState = {
      phone: testPhone,
      lastTurnId: 't_prev',
      lastIntent: 'financial_alerts',
      lojaSlug: 'jabaquara',
      filters: {},
      updatedAt: new Date().toISOString()
    };

    const res = rewriteIntent('faturamento e OS do mês da minha loja', prevState);
    assert(res.subQueries !== undefined && res.subQueries.length === 2, 'Deve decompor em 2 sub-queries');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar preenchida');
    assert.equal(res.compactDecision?.period, 'mes_atual');
    assert(res.compactDecision?.requestedComponents.includes('REVENUE_MONTH'), 'Deve requerer REVENUE_MONTH');
    assert(res.compactDecision?.requestedComponents.includes('OS_LIST'), 'Deve requerer OS_LIST');
    assert(res.compactDecision?.lojaSlug === 'jabaquara' || res.compactDecision?.lojaSlug === 'MPJabaquara');

    // Validação dos requisitos de resposta (AnswerRequirements)
    assert(res.answerRequirements !== undefined && res.answerRequirements.length >= 2);
    const fatReq = res.answerRequirements.find(r => r.targetMetric === 'faturamento_mensal' || r.targetMetric === 'faturamento');
    const osReq = res.answerRequirements.find(r => r.targetMetric === 'list_os');
    assert(fatReq !== undefined, 'Requisito de faturamento deve estar presente');
    assert(osReq !== undefined, 'Requisito de OS deve estar presente');
  });

  await it('4.2. "faturamento e CMV de hoje da Dom Pedro" identifica REVENUE_DAY e STORE_CMV', async () => {
    const res = rewriteIntent('Qual o faturamento e o CMV de hoje da Dom Pedro?');
    assert(res.subQueries !== undefined && res.subQueries.length === 2, 'Deve decompor em 2 sub-queries');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar preenchida');
    assert.equal(res.compactDecision?.period, 'hoje');
    assert(res.compactDecision?.requestedComponents.includes('REVENUE_DAY'));
    assert(res.compactDecision?.requestedComponents.includes('STORE_CMV'));
    assert.equal(res.compactDecision?.lojaSlug, 'MPdompedro1');
  });

  // =========================================================================
  // BLOCO 5: CONTINUIDADE ELÍPTICA E TEMPORAL (L06 / E1-06)
  // =========================================================================
  console.log('\n--- [BLOCO 5] Continuidade Elíptica e Temporal (L06 / E1-06) ---');

  await it('5.1. "e ontem?" herda loja e calcula D-1 civil', async () => {
    const prevState: TurnState = {
      phone: testPhone,
      lastTurnId: 'turn_fat_jab',
      lastIntent: 'financial_alerts',
      lojaSlug: 'jabaquara',
      filters: {},
      updatedAt: new Date().toISOString()
    };

    const y = getCivilYesterdayDate();
    const res = rewriteIntent('e ontem?', prevState);

    assert.equal(res.lojaSlug, 'jabaquara', 'Deve herdar a loja do turno anterior');
    assert.equal(res.intent, 'financial_alerts', 'Deve herdar intenção financeira');
    assert(res.compactDecision !== undefined, 'compactDecision deve estar preenchida');
    assert.equal(res.compactDecision?.period, 'ontem');
    assert.equal(res.compactDecision?.periodDates?.startDate, y.dateStr);
    assert.equal(res.compactDecision?.periodDates?.endDate, y.dateStr);

    // Rastreabilidade no TurnContract
    assert.equal(res.contract?.turnRelation?.type, 'continue');
    assert(res.contract?.turnRelation?.inheritedFilters.includes('lojaSlug'));
    assert(res.contract?.turnRelation?.overriddenFilters.includes('period'));
  });

  await it('5.2. "e mês passado?" herda loja e calcula período civil anterior', async () => {
    const prevState: TurnState = {
      phone: testPhone,
      lastTurnId: 'turn_fat_jab',
      lastIntent: 'financial_alerts',
      lojaSlug: 'jabaquara',
      filters: {},
      updatedAt: new Date().toISOString()
    };

    const m = getCivilLastMonthRange();
    const res = rewriteIntent('e mês passado?', prevState);

    assert.equal(res.lojaSlug, 'jabaquara');
    assert.equal(res.compactDecision?.period, 'mes_passado');
    assert.equal(res.compactDecision?.periodDates?.startDate, m.startDate);
    assert.equal(res.compactDecision?.periodDates?.endDate, m.endDate);
  });

  await it('5.3. "e ontem?" sem loja no contexto e sem loja no input gera desambiguação', async () => {
    const res = rewriteIntent('e ontem?', null); // sem estado anterior

    assert.equal(res.needsClarification, true, 'Deve solicitar desambiguação');
    assert.equal(res.contract?.decision, 'clarify');
    assert.equal(res.contract?.ambiguity?.isAmbiguous, true);
    assert.equal(res.contract?.ambiguity?.reason, 'store_ambiguity');
    assert(res.clarificationMessage?.includes('Por favor, indique para qual loja'));
  });

  // =========================================================================
  // BLOCO 6: ANÁFORAS DE CONTINUIDADE CONTEXTUAL (L07 / E1-06)
  // =========================================================================
  console.log('\n--- [BLOCO 6] Anáforas de Continuidade Contextual (L07 / E1-06) ---');

  await it('6.1. "dessa loja" e "desta loja" herdam contexto da loja ativa', async () => {
    const prevState: TurnState = {
      phone: testPhone,
      lastTurnId: 'turn_1',
      lastIntent: 'financial_alerts',
      lojaSlug: 'jabaquara',
      filters: {},
      updatedAt: new Date().toISOString()
    };

    const res1 = rewriteIntent('e o CMV dessa loja?', prevState);
    assert.equal(res1.lojaSlug, 'jabaquara', 'Deve resolver anáfora "dessa loja"');
    assert.equal(res1.intent, 'store_cmv');

    const res2 = rewriteIntent('quais as ordens desta loja?', prevState);
    assert.equal(res2.lojaSlug, 'jabaquara', 'Deve resolver anáfora "desta loja"');
    assert.equal(res2.intent, 'list_os');
  });

  await it('6.2. "dessas ordens" herda foco da lista de OS', async () => {
    const prevState: TurnState = {
      phone: testPhone,
      lastTurnId: 'turn_os_list',
      lastIntent: 'list_os',
      lojaSlug: 'jabaquara',
      filters: { onlyOpen: true },
      updatedAt: new Date().toISOString()
    };

    const res = rewriteIntent('dessas ordens, qual tem maior valor?', prevState);
    assert.equal(res.lojaSlug, 'jabaquara');
    assert.equal(res.intent, 'list_os');
    assert(res.contract?.turnRelation?.type === 'continue');
  });

  console.log('\n===============================================================================');
  console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS! (100% PASS)`);
  console.log('===============================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runLanguageComprehensionTests().catch(err => {
  console.error('Erro fatal ao rodar testes:', err);
  process.exit(1);
});
