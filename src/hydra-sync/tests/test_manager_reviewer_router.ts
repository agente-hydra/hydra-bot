/**
 * TEST SUITE: REVISOR CRÍTICO DE IA, ROTEAMENTO, GOVERNANÇA E ESCOPO DE GERENTE (Frente 1)
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import {
  isOutsideManagerStore,
  mentionsOtherStore,
  executeManagerStoreQuery,
  executeManagerTool,
  composeFactualTemplate
} from '../manager_store_access.js';
import {
  buildCriticalReviewerPrompt,
  buildSynthesisPrompt,
  CRITICAL_REVIEWER_RULES
} from '../semantic_prompt.js';
import {
  DualWorkerRouter,
  hydraDualRouter,
  GLOBAL_TURN_BUDGET_MS,
  recordTurnTelemetry,
  getTurnTelemetry,
  ensureTurnTelemetryTable
} from '../dual_worker_router.js';
import {
  dispatchMessage,
  runManagerAiReviewer
} from '../agent_dispatcher.js';
import {
  ensureUserProfileSchema,
  saveUserProfile,
  getUserProfile,
  type UserProfile
} from '../command_interceptor.js';
import { ensureTurnContextTable } from '../turn_context_repository.js';
import { rewriteIntent } from '../intent_rewriter.js';

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
  ensureTurnTelemetryTable(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS metas_diarias (
      id INTEGER PRIMARY KEY, loja_slug TEXT, data_referencia TEXT, posicao_hora TEXT,
      faturamento_mes REAL, volume_os INTEGER, ticket_medio REAL, meta_mes REAL, percentual_meta REAL
    );
    CREATE TABLE IF NOT EXISTS cmv_lojas (
      id INTEGER PRIMARY KEY, loja_slug TEXT, data_inicio TEXT, data_fim TEXT,
      cmv_percentual REAL, faturamento_total REAL, custo_total REAL
    );
    CREATE TABLE IF NOT EXISTS faturamento_areas (
      id INTEGER PRIMARY KEY, loja_slug TEXT, area TEXT, data_inicio TEXT, data_fim TEXT,
      cmv_percentual REAL, faturamento REAL, custo REAL
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

    -- Dados oficiais da loja local Dom Pedro I (MPdompedro1)
    INSERT INTO metas_diarias VALUES (1, 'MPdompedro1', '2026-09-30', '11:31', 115000, 85, 1352.94, 120000, 95.8);
    INSERT INTO cmv_lojas VALUES (1, 'MPdompedro1', '2026-09-01', '2026-09-30', 20.0, 100, 20);
    INSERT INTO faturamento_areas VALUES (1, 'MPdompedro1', 'OLEO', '2026-09-01', '2026-09-30', 21.0, 50, 10);
    INSERT INTO ordens_servico VALUES ('101', 'MPdompedro1', 'AAA1111', 'Carro local', 'Joao Silva', 'Carlos', 'Aberta', 1, 100, 50, 50, 2, '2026-09-28', NULL);
    INSERT INTO ordens_servico VALUES ('1128', 'MPdompedro1', 'XYZ1128', 'Honda Civic 2.0', 'Carlos Gerente', 'Silvio', 'Em diagnóstico', 1, 12500, 5000, 7500, 6, '2026-09-24', NULL);

    -- Dados confidenciais de outra loja (MPkennedy)
    INSERT INTO metas_diarias VALUES (2, 'MPkennedy', '2026-09-30', '11:31', 999999, 400, 2499, 1000000, 99.9);
    INSERT INTO cmv_lojas VALUES (2, 'MPkennedy', '2026-09-01', '2026-09-30', 99.0, 999999, 999998);
    INSERT INTO ordens_servico VALUES ('202', 'MPkennedy', 'BBB2222', 'SEGREDO_EXTERNO_KENNEDY', 'Privado', 'Outro', 'Aberta', 1, 999999, 0, 999999, 9, '2026-09-20', NULL);
  `);

  saveUserProfile(db, {
    phone: '5511999990001',
    persona: 'gerente',
    lojaSlug: 'MPdompedro1',
    lojaNome: 'Dom Pedro I',
    defaultScope: 'loja',
    memoryGeneration: 1,
    updatedAt: new Date().toISOString()
  });

  return db;
}

async function runAllTests() {
  console.log('===============================================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: REVISOR CRÍTICO DE IA & GOVERNANÇA (FRENTE 1)');
  console.log('===============================================================================\n');

  // =========================================================================
  // BLOCO 1: EVIDÊNCIAS E CALIBRAÇÃO REAL COM O CLI AGY DA VPS
  // =========================================================================
  console.log('--- BLOCO 1: Evidências e Calibração Real com Workers da VPS (/home/operacional/.local/bin/agy) ---');

  await it('1.1. Chamada REAL para APROVAR: mede latência e resposta estrita em JSON', async () => {
    const prompt = buildCriticalReviewerPrompt({
      originalMessage: 'qual o faturamento da minha loja?',
      lojaSlug: 'MPdompedro1',
      lojaNome: 'Dom Pedro I',
      persona: 'gerente',
      respostaCandidata: '> *Dom Pedro I — Faturamento*\n- Faturamento: R$ 115.000,00\n- Meta: R$ 120.000,00\n- Atingimento: 95.8%\n- OSs no período: 85\n- Ticket médio: R$ 1.352,94',
      dadosConsultados: [{
        fonte: 'metas_diarias',
        periodo: '2026-09-30 11:31',
        dados: { faturamento_mes: 115000, meta_mes: 120000, percentual_meta: 95.8, volume_os: 85, ticket_medio: 1352.94 }
      }]
    });

    const start = Date.now();
    const res = spawnSync('/home/operacional/.local/bin/agy', [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--model', 'gemini-3.8-flash-low'
    ], { encoding: 'utf-8', timeout: 60000 });
    const durMs = Date.now() - start;

    console.log(`     ⏱️  Latência real APROVAR: ${durMs}ms`);
    assert.equal(res.status, 0, 'Execução real da AGY CLI deve ter status 0');
    assert(durMs > 1000 && durMs < 50000, 'Duração real deve ser mensurável e dentro do orçamento');

    let output = res.stdout.trim();
    if (output.includes('```json')) output = output.split('```json')[1].split('```')[0].trim();
    else if (output.includes('```')) output = output.split('```')[1].split('```')[0].trim();

    const parsed = JSON.parse(output);
    assert.equal(parsed.decisao, 'APROVAR', 'Decisão deve ser APROVAR para candidata completa e correta');
  });

  await it('1.2. Chamada REAL para AJUSTAR: garante Regra de Ouro (só dados existentes)', async () => {
    const prompt = buildCriticalReviewerPrompt({
      originalMessage: 'quanto bateu de meta até agora?',
      lojaSlug: 'MPdompedro1',
      lojaNome: 'Dom Pedro I',
      persona: 'gerente',
      respostaCandidata: 'Aqui esta a tabela interna de metas do sistema SQL: faturamento_mes=100 meta_mes=200 percentual_meta=50 posicao_hora=11:31',
      dadosConsultados: [{
        fonte: 'metas_diarias',
        periodo: '2026-09-30 11:31',
        dados: { faturamento_mes: 100, meta_mes: 200, percentual_meta: 50, posicao_hora: '11:31', volume_os: 2, ticket_medio: 50 }
      }]
    });

    const start = Date.now();
    const res = spawnSync('/home/operacional/.local/bin/agy', [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--model', 'gemini-3.8-flash-low'
    ], { encoding: 'utf-8', timeout: 60000 });
    const durMs = Date.now() - start;

    console.log(`     ⏱️  Latência real AJUSTAR: ${durMs}ms`);
    assert.equal(res.status, 0);

    let output = res.stdout.trim();
    if (output.includes('```json')) output = output.split('```json')[1].split('```')[0].trim();
    else if (output.includes('```')) output = output.split('```')[1].split('```')[0].trim();

    const parsed = JSON.parse(output);
    assert.equal(parsed.decisao, 'AJUSTAR', 'Decisão deve ser AJUSTAR para requisição com dados presentes mas formatação crua');
    assert(parsed.resposta && (parsed.resposta.includes('50%') || parsed.resposta.includes('100')), 'Texto ajustado deve preservar dados oficiais');
  });

  await it('1.3. Chamada REAL para CONSULTAR: obrigatoriedade em "OS e CMV" com falta de OS', async () => {
    const prompt = buildCriticalReviewerPrompt({
      originalMessage: 'como tá o CMV e as OSs abertas da minha loja?',
      lojaSlug: 'MPdompedro1',
      lojaNome: 'Dom Pedro I',
      persona: 'gerente',
      respostaCandidata: '> *Dom Pedro I — CMV*\n- CMV: 20.00%',
      dadosConsultados: [{
        fonte: 'cmv_lojas',
        periodo: '2026-09-01 a 2026-09-30',
        dados: { cmv_percentual: 20.0 }
      }]
    });

    const start = Date.now();
    const res = spawnSync('/home/operacional/.local/bin/agy', [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--model', 'gemini-3.8-flash-low'
    ], { encoding: 'utf-8', timeout: 60000 });
    const durMs = Date.now() - start;

    console.log(`     ⏱️  Latência real CONSULTAR (OS e CMV): ${durMs}ms`);
    assert.equal(res.status, 0);

    let output = res.stdout.trim();
    if (output.includes('```json')) output = output.split('```json')[1].split('```')[0].trim();
    else if (output.includes('```')) output = output.split('```')[1].split('```')[0].trim();

    const parsed = JSON.parse(output);
    assert.equal(parsed.decisao, 'CONSULTAR', 'Decisão OBRIGATÓRIA deve ser CONSULTAR quando faltam OSs');
    assert.equal(parsed.ferramenta, 'get_os_list', 'Ferramenta indicada deve ser get_os_list');
  });

  await it('1.4. Chamada REAL para CONSULTAR ("Detalhes da 1128"): aciona get_os_details', async () => {
    const prompt = buildCriticalReviewerPrompt({
      originalMessage: 'Detalhes da 1128',
      lojaSlug: 'MPdompedro1',
      lojaNome: 'Dom Pedro I',
      persona: 'gerente',
      respostaCandidata: null,
      dadosConsultados: []
    });

    const start = Date.now();
    const res = spawnSync('/home/operacional/.local/bin/agy', [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--model', 'gemini-3.8-flash-low'
    ], { encoding: 'utf-8', timeout: 60000 });
    const durMs = Date.now() - start;

    console.log(`     ⏱️  Latência real CONSULTAR (Detalhes da 1128): ${durMs}ms`);
    assert.equal(res.status, 0);

    let output = res.stdout.trim();
    if (output.includes('```json')) output = output.split('```json')[1].split('```')[0].trim();
    else if (output.includes('```')) output = output.split('```')[1].split('```')[0].trim();

    const parsed = JSON.parse(output);
    assert.equal(parsed.decisao, 'CONSULTAR', 'Deve ser CONSULTAR para ficha completa de OS');
    assert.equal(parsed.ferramenta, 'get_os_details', 'Ferramenta indicada deve ser get_os_details');
    assert.equal(parsed.parametros?.osId, '1128', 'Parâmetro osId deve ser 1128');
  });

  // =========================================================================
  // BLOCO 2: FLUXO INTEGRADO DO REVISOR CRÍTICO DE IA (AI REVIEWER)
  // =========================================================================
  console.log('\n--- BLOCO 2: Fluxo Integrado do Revisor Crítico de IA (AI Reviewer) ---');

  const db = createPopulatedDb();
  const testPhone = '5511999990001'; // Gerente Dom Pedro I

  await it('2.1. Teste de APROVAR para candidata correta (revisão em 1 chamada)', async () => {
    const routerMock = new DualWorkerRouter({
      primaryExecutorOverride: async () => ({
        success: true,
        output: JSON.stringify({
          decisao: 'APROVAR',
          motivo: 'Candidata 100% aderente aos dados de faturamento da Dom Pedro I',
          resposta: '> *Dom Pedro I — Faturamento*\n- Faturamento: R$ 115.000,00\n- Meta: R$ 120.000,00\n- Atingimento: 95.8%'
        }),
        durationMs: 850
      })
    });

    const canonical = rewriteIntent('faturamento da minha loja', null);
    const start = Date.now();
    const res = await runManagerAiReviewer({
      db,
      phone: testPhone,
      message: 'faturamento da minha loja',
      userProfile: getUserProfile(db, testPhone),
      canonical,
      startTime: start,
      rawMessageId: 'msg_aprovar_1',
      customRouter: routerMock
    });

    assert(res.replyText.includes('115.000,00'), 'Resposta aprovada deve conter faturamento');
    assert(res.replyText.includes('95.8%'), 'Resposta aprovada deve conter atingimento');
    assert(res.toolsCalled.includes('ai_reviewer_approve'), 'Ferramenta ai_reviewer_approve deve ser registrada');

    const tel = getTurnTelemetry(db, 'turn_msg_aprovar_1');
    assert.equal(tel?.reviewDecision, 'APROVAR');
    assert.equal(tel?.replanCount, 0, 'APROVAR encerra estritamente em 1 chamada');
    assert.equal(tel?.lojaSlug, 'MPdompedro1');
  });

  await it('2.2. Teste de AJUSTAR estrito (usa estritamente dados consultados)', async () => {
    const routerMock = new DualWorkerRouter({
      primaryExecutorOverride: async () => ({
        success: true,
        output: JSON.stringify({
          decisao: 'AJUSTAR',
          motivo: 'Polimento de texto para o WhatsApp com base nos dados consultados',
          resposta: 'Atingimento atual da Dom Pedro I é de 95.8%, acumulando R$ 115.000,00 da meta de R$ 120.000,00.'
        }),
        durationMs: 920
      })
    });

    const canonical = rewriteIntent('quanto bateu de meta?', null);
    const start = Date.now();
    const res = await runManagerAiReviewer({
      db,
      phone: testPhone,
      message: 'quanto bateu de meta?',
      userProfile: getUserProfile(db, testPhone),
      canonical,
      startTime: start,
      rawMessageId: 'msg_ajustar_1',
      customRouter: routerMock
    });

    assert(res.replyText.includes('95.8%'), 'Texto ajustado contém o dado oficial');
    assert(res.replyText.includes('115.000,00'), 'Texto ajustado contém o faturamento consultado');
    assert(res.toolsCalled.includes('ai_reviewer_adjust'), 'Ferramenta ai_reviewer_adjust registrada');

    const tel = getTurnTelemetry(db, 'turn_msg_ajustar_1');
    assert.equal(tel?.reviewDecision, 'AJUSTAR');
    assert.equal(tel?.replanCount, 0, 'AJUSTAR encerra estritamente em 1 chamada');
  });

  await it('2.3. Teste de CONSULTAR obrigatório para "OS e CMV" quando falta OS', async () => {
    let callIndex = 0;
    const routerMock = new DualWorkerRouter({
      primaryExecutorOverride: async () => {
        callIndex++;
        if (callIndex === 1) {
          return {
            success: true,
            output: JSON.stringify({
              decisao: 'CONSULTAR',
              motivo: 'Operador pediu OS e CMV, mas apenas CMV foi consultado. Obrigatório buscar OSs.',
              ferramenta: 'get_os_list',
              parametros: { limit: 5 }
            }),
            durationMs: 1200
          };
        } else {
          return {
            success: true,
            output: '> *Dom Pedro I — CMV e OSs*\n- CMV: 20.00% (Faturamento R$ 100,00 | Custo R$ 20,00)\n- OSs Abertas:\n  * OS #101: Carro local (AAA1111) — R$ 100,00\n  * OS #1128: Honda Civic 2.0 (XYZ1128) — R$ 12.500,00',
            durationMs: 1400
          };
        }
      }
    });

    const canonical = rewriteIntent('como ta o CMV e as OSs abertas?', null);
    const start = Date.now();
    const res = await runManagerAiReviewer({
      db,
      phone: testPhone,
      message: 'como ta o CMV e as OSs abertas?',
      userProfile: getUserProfile(db, testPhone),
      canonical,
      startTime: start,
      rawMessageId: 'msg_consultar_cmv_os',
      customRouter: routerMock
    });

    assert(res.toolsCalled.includes('get_os_list'), 'Deve ter executado a ferramenta get_os_list complementar');
    assert(res.replyText.includes('20.00%'), 'Resposta final deve conter o dado de CMV');
    assert(res.replyText.includes('101') || res.replyText.includes('Carro local'), 'Resposta final deve conter as OSs consultadas');

    const tel = getTurnTelemetry(db, 'turn_msg_consultar_cmv_os');
    assert.equal(tel?.reviewDecision, 'CONSULTAR');
    assert.equal(tel?.replanCount, 1, 'Replanejamento executado');
  });

  await it('2.4. Teste de mensagem não compreendida encaminhada à IA sem recusa falsa', async () => {
    const uncomprehendedMessage = 'como estão os trabalhos por aí hoje? me dê um resumo geral';
    const routerMock = new DualWorkerRouter({
      primaryExecutorOverride: async () => ({
        success: true,
        output: JSON.stringify({
          decisao: 'APROVAR',
          motivo: 'Mensagem conversacional compreendida e respondida com contexto da loja',
          resposta: 'Hoje a unidade Dom Pedro I está com a operação em andamento normal, meta atingindo 95.8% e 2 ordens no pátio.'
        }),
        durationMs: 950
      })
    });

    const canonical = rewriteIntent(uncomprehendedMessage, null);
    const start = Date.now();
    const res = await runManagerAiReviewer({
      db,
      phone: testPhone,
      message: uncomprehendedMessage,
      userProfile: getUserProfile(db, testPhone),
      canonical,
      startTime: start,
      rawMessageId: 'msg_unrec_1',
      customRouter: routerMock
    });

    assert.doesNotMatch(res.replyText, /Não consigo consultar esse assunto com segurança/i, 'Não pode emitir recusa genérica falsa');
    assert(res.replyText.includes('Dom Pedro I'), 'Resposta contextualizada na loja ativa');
  });

  await it('2.5. Teste de bloqueio de outra loja com sugestão /socio', async () => {
    const start = Date.now();
    const forbiddenMessage = 'qual o faturamento da Kennedy?';
    const canonical = rewriteIntent(forbiddenMessage, null);

    const res = await runManagerAiReviewer({
      db,
      phone: testPhone,
      message: forbiddenMessage,
      userProfile: getUserProfile(db, testPhone),
      canonical,
      startTime: start,
      rawMessageId: 'msg_block_other'
    });

    assert(res.toolsCalled.includes('manager_scope_denied'), 'Deve conter ferramenta manager_scope_denied');
    assert(res.replyText.includes('/socio'), 'Recusa educada DEVE orientar expressamente a usar /socio');
    assert.doesNotMatch(res.replyText, /999999|SEGREDO_EXTERNO_KENNEDY/, 'Zero vazamento de dados de outra loja');

    const tel = getTurnTelemetry(db, 'turn_msg_block_other');
    assert.equal(tel?.reviewDecision, 'BLOCKED_SCOPE');
    assert.equal(tel?.status, 'BLOCKED');
  });

  await it('2.6. Teste de orçamento de 50s com contingência H-IA-02', async () => {
    const routerMock = new DualWorkerRouter({
      primaryExecutorOverride: async () => {
        return { success: false, error: 'ETIMEDOUT: timeout excedido', isTransient: true, durationMs: 20000 };
      },
      secondaryExecutorOverride: async () => {
        return { success: false, error: 'ETIMEDOUT: timeout excedido', isTransient: true, durationMs: 20000 };
      }
    });

    const canonical = rewriteIntent('faturamento da minha loja', null);
    const start = Date.now();
    const res = await runManagerAiReviewer({
      db,
      phone: testPhone,
      message: 'faturamento da minha loja',
      userProfile: getUserProfile(db, testPhone),
      canonical,
      startTime: start,
      rawMessageId: 'msg_timeout_hia02',
      customRouter: routerMock
    });

    assert(res.replyText.includes('H-IA-02'), 'Resposta deve conter o código padronizado H-IA-02');
    assert(res.toolsCalled.includes('timeout_h_ia_02'), 'Ferramenta timeout_h_ia_02 registrada');

    const tel = getTurnTelemetry(db, 'turn_msg_timeout_hia02');
    assert.equal(tel?.errorCode, 'H-IA-02');
    assert.equal(tel?.status, 'TIMEOUT');
  });

  // =========================================================================
  // BLOCO 3: QUALIFICADORES LOCAIS EM isOutsideManagerStore
  // =========================================================================
  console.log('\n--- BLOCO 3: Refinamento de isOutsideManagerStore com Qualificadores Locais ---');

  await it('3.1. Qualificadores locais permitidos (não são barrados)', () => {
    const local = 'MPdompedro1';
    assert.equal(isOutsideManagerStore('todos os carros da minha loja', local), false, 'todos os carros da minha loja deve ser PERMITIDO');
    assert.equal(isOutsideManagerStore('ranking das minhas ordens', local), false, 'ranking das minhas ordens deve ser PERMITIDO');
    assert.equal(isOutsideManagerStore('todas as ordens da minha loja', local), false, 'todas as ordens da minha loja deve ser PERMITIDO');
    assert.equal(isOutsideManagerStore('meus carros do patio', local), false, 'meus carros do patio deve ser PERMITIDO');
    assert.equal(isOutsideManagerStore('carros travados daqui', local), false, 'carros travados daqui deve ser PERMITIDO');
  });

  await it('3.2. Termos de escopo de rede e outras lojas bloqueados', () => {
    const local = 'MPdompedro1';
    assert.equal(isOutsideManagerStore('faturamento da rede', local), true, 'rede deve ser BARRADO');
    assert.equal(isOutsideManagerStore('faturamento das lojas', local), true, 'das lojas deve ser BARRADO');
    assert.equal(isOutsideManagerStore('ranking de faturamento', local), true, 'ranking de faturamento deve ser BARRADO');
    assert.equal(isOutsideManagerStore('faturamento da Kennedy', local), true, 'Kennedy deve ser BARRADO');
    assert.equal(isOutsideManagerStore('OS de Kennedy.', local), true, 'OS de Kennedy deve ser BARRADO');
    assert.equal(isOutsideManagerStore('CMV da unidade Master', local), true, 'Master deve ser BARRADO');
  });

  // =========================================================================
  // BLOCO 4: ISOLAMENTO ESTREITO DE LOJA AUTORIZADA EM CONSULTAS E FERRAMENTAS
  // =========================================================================
  console.log('\n--- BLOCO 4: Isolamento Estrito de Loja Autorizada na Execução de Ferramentas ---');

  await it('4.1. get_os_details não acessa OS de outra loja mesmo se solicitada', () => {
    const toolRes = executeManagerTool(db, 'get_os_details', { osId: '202' }, 'MPdompedro1');
    assert(toolRes.replyText.includes('Nenhuma OS #202 localizada'), 'OS #202 pertence à Kennedy e não deve aparecer na Dom Pedro');
    assert.equal(toolRes.dados?.found, false);
  });

  await it('4.2. get_os_details traz ficha completa para OS da loja autorizada', () => {
    const toolRes = executeManagerTool(db, 'get_os_details', { osId: '1128' }, 'MPdompedro1');
    assert(toolRes.replyText.includes('Honda Civic 2.0'), 'Ficha deve conter veículo');
    assert(toolRes.replyText.includes('XYZ1128'), 'Ficha deve conter placa');
    assert(toolRes.replyText.includes('Carlos Gerente'), 'Ficha deve conter cliente');
    assert(toolRes.replyText.includes('Silvio'), 'Ficha deve conter responsável');
    assert(toolRes.replyText.includes('12.500,00'), 'Ficha deve conter valor total');
    assert.equal(toolRes.dados?.os_id, '1128');
  });

  await it('4.3. get_cmv e get_os_list respeitam estritamente a loja autorizada', () => {
    const cmvRes = executeManagerTool(db, 'get_cmv', {}, 'MPdompedro1');
    assert(cmvRes.replyText.includes('20.00%'), 'CMV da Dom Pedro deve ser 20%');

    const osListRes = executeManagerTool(db, 'get_os_list', { limit: 5 }, 'MPdompedro1');
    assert(osListRes.replyText.includes('Carro local'), 'Lista de OS deve conter carros da Dom Pedro');
    assert.doesNotMatch(osListRes.replyText, /SEGREDO_EXTERNO_KENNEDY/, 'Zero vazamento da Kennedy');
  });

  // =========================================================================
  // BLOCO 5: END-TO-END VIA DISPATCHMESSAGE COM INJEÇÃO DE PERFIL
  // =========================================================================
  console.log('\n--- BLOCO 5: End-to-End via dispatchMessage com Injeção de Perfil ---');

  await it('5.1. dispatchMessage pré-carrega perfil de gerente e roteia com AI Reviewer', async () => {
    hydraDualRouter.setExecutorOverrides({
      primary: async () => ({
        success: true,
        output: JSON.stringify({
          decisao: 'APROVAR',
          motivo: 'Faturamento oficial aprovado',
          resposta: '> *Dom Pedro I — Faturamento*\n- Faturamento: R$ 115.000,00\n- Meta: R$ 120.000,00\n- Atingimento: 95.8%'
        }),
        durationMs: 780
      })
    });

    const res = await dispatchMessage({
      db,
      phone: testPhone,
      message: 'faturamento da minha loja',
      messageId: 991122
    });

    hydraDualRouter.clearExecutorOverrides();

    assert(res.replyText.includes('115.000,00'), 'dispatchMessage deve responder faturamento da loja');
    assert.equal(res.isFeedback, false);
  });

  console.log('\n===============================================================================');
  console.log(`🎯 RESULTADO FINAL DA SUÍTE: ${passedTests}/${totalTests} TESTES APROVADOS! (100% PASS)`);
  console.log('===============================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('\n❌ Erro fatal na suíte de testes:', err);
  process.exit(1);
});