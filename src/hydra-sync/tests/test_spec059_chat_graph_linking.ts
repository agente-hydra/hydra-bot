/**
 * test_spec059_chat_graph_linking.ts — Bateria de Testes Contratuais da Spec 059
 * 
 * Validação Contratual dos Cenários G01 a G10:
 * - G01: Inicialização do banco em schema vazio ou legado com idempotência garantida.
 * - G02: Leitura e sanitização de dados privados no conector Chatwoot.
 * - G03: Interligação OS <-> Conversa por Telefone do Cliente (Regra L1).
 * - G04: Interligação OS <-> Conversa por Placa de Veículo (Regra L2).
 * - G05: Interligação OS <-> Conversa por Menção Explícita de OS (Regra L3).
 * - G06: Ferramenta `conversations.search` chamada por Admin/Sócio.
 * - G07: Ferramenta `conversations.get_history` chamada por Admin/Sócio.
 * - G08: Ferramenta `graph.get_os_case` chamada por Admin/Sócio.
 * - G09: Gerente de loja ou operador tentando usar tools de chat/grafo (Barreira RBAC).
 * - G10: Desbloqueio de Chatwoot e atendimento no `IntentRewriter`.
 */

import assert from 'assert';
import Database from 'better-sqlite3';
import { ensureCaseAnalysisTables } from '../real_analysis_repository.js';
import { ChatwootConversationReader } from '../chatwoot_conversation_reader.js';
import { OsConversationGraphLinker } from '../os_conversation_graph_linker.js';
import { HydraActionExecutor, ActionExecutionContext } from '../hydra_action_executor.js';
import { rewriteIntent } from '../intent_rewriter.js';
import type { SanitizedChatMessage } from '../types/chatwoot_contract.js';

async function runSpec059Tests() {
  console.log('================================================================');
  console.log('TEST SUITE | Spec 059: Interligação Grafo OS <-> Chatwoot (G01-G10)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // Configuração dos contextos para testes de RBAC
  const adminContext: ActionExecutionContext = {
    actorPhone: '5511996242812',
    actorRole: 'owner',
    requestId: 'req_g01_admin',
    conversationId: 'conv_g01_admin',
    policyVersion: 'v1',
    idempotencyKey: 'idemp_g01_admin',
    deadlineMs: Date.now() + 30000
  };

  const socioContext: ActionExecutionContext = {
    actorPhone: '5511970671717',
    actorRole: 'socio',
    requestId: 'req_g01_socio',
    conversationId: 'conv_g01_socio',
    policyVersion: 'v1',
    idempotencyKey: 'idemp_g01_socio',
    deadlineMs: Date.now() + 30000
  };

  const managerContext: ActionExecutionContext = {
    actorPhone: '5511988881111',
    actorRole: 'gerente',
    requestId: 'req_g01_manager',
    conversationId: 'conv_g01_manager',
    policyVersion: 'v1',
    idempotencyKey: 'idemp_g01_manager',
    deadlineMs: Date.now() + 30000
  };

  // Mock Fetch para o Chatwoot
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(input);

    if (urlStr.includes('/messages')) {
      const payload = {
        payload: [
          {
            id: 1001,
            content: 'Olá, gostaria de saber se meu carro está pronto.',
            message_type: 0, // Inbound / Client
            sender: { id: 50, name: 'Carlos Silva', type: 'contact' },
            private: false,
            attachments: [],
            created_at: 1730000000
          },
          {
            id: 1002,
            content: 'Cartão de crédito 4111 2222 3333 4444 e senha: 12345 para pagamento',
            message_type: 0,
            sender: { id: 50, name: 'Carlos Silva', type: 'contact' },
            private: false,
            attachments: [],
            created_at: 1730000010
          },
          {
            id: 1003,
            content: 'Estamos aguardando a chegada da peça do fornecedor para a OS #4453.',
            message_type: 1, // Outbound / Agent
            sender: { id: 5, name: 'Atendente Mauá', type: 'user' },
            private: false,
            attachments: [],
            created_at: 1730000020
          }
        ]
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/conversations/101')) {
      const payload = {
        id: 101,
        inbox_id: 1,
        status: 'open',
        unread_count: 0,
        meta: {
          sender: {
            id: 50,
            name: 'Carlos Silva',
            phone_number: '+5511988887777'
          }
        }
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/contacts/search')) {
      const payload = {
        payload: [
          {
            id: 50,
            name: 'Carlos Silva',
            phone_number: '+5511988887777'
          }
        ]
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/contacts/50/conversations')) {
      const payload = {
        payload: [
          {
            id: 101,
            inbox_id: 1,
            status: 'open',
            unread_count: 0,
            meta: {
              sender: {
                id: 50,
                name: 'Carlos Silva',
                phone_number: '+5511988887777'
              }
            }
          }
        ]
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  };

  // ==========================================================================
  // CENÁRIO G01: Inicialização do banco em schema vazio ou legado
  // ==========================================================================
  await test('G01 — Inicialização do banco em schema vazio e garantia de idempotência', () => {
    const memDb = new Database(':memory:');
    
    // 1ª execução
    ensureCaseAnalysisTables(memDb);

    const tables = memDb.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map((r: any) => r.name);

    assert(tables.includes('hydra_case_graph_nodes'), 'hydra_case_graph_nodes deve existir');
    assert(tables.includes('hydra_case_graph_edges'), 'hydra_case_graph_edges deve existir');
    assert(tables.includes('hydra_case_current_position'), 'hydra_case_current_position deve existir');
    assert(tables.includes('hydra_conversation_os_links'), 'hydra_conversation_os_links deve existir');
    assert(tables.includes('hydra_case_analyses'), 'hydra_case_analyses deve existir');

    // 2ª execução (teste de idempotência)
    assert.doesNotThrow(() => {
      ensureCaseAnalysisTables(memDb);
    }, 'Reexecução de ensureCaseAnalysisTables não deve lançar erro');

    memDb.close();
  });

  // ==========================================================================
  // CENÁRIO G02: Leitura de conversa e sanitização de dados privados
  // ==========================================================================
  await test('G02 — Leitura de conversa e sanitização LGPD (cartões, senhas, CPFs)', async () => {
    // 1. Teste de sanitização pura
    const rawSensitive = 'Meu cartao 4111 2222 3333 4444 com cvv 123 e senha: superSecret e cpf 123.456.789-00';
    const sanitized = ChatwootConversationReader.sanitizeMessageText(rawSensitive);
    
    assert(!sanitized.includes('4111 2222 3333 4444'), 'Cartão não pode vazar');
    assert(sanitized.includes('[CARTAO_REDUZIDO]'), 'Cartão deve ser substituído por tag');
    assert(!sanitized.includes('123'), 'CVV não pode vazar');
    assert(sanitized.includes('[CVV_REDUZIDO]'), 'CVV deve ser substituído por tag');
    assert(!sanitized.includes('superSecret'), 'Senha não pode vazar');
    assert(sanitized.includes('[SENHA_REDUZIDA]'), 'Senha deve ser substituída por tag');
    assert(!sanitized.includes('123.456.789-00'), 'CPF não pode vazar');
    assert(sanitized.includes('[CPF_REDUZIDO]'), 'CPF deve ser substituído por tag');

    // 2. Leitura com mock do Chatwoot
    const reader = new ChatwootConversationReader({ fetchFn: mockFetch as any });
    const messages = await reader.getConversationMessages({ conversationId: 101, limit: 10 });
    
    assert.strictEqual(messages.length, 3, 'Deve carregar as 3 mensagens do mock');
    assert.strictEqual(messages[0].senderType, 'client', '1ª mensagem deve ser do cliente');
    assert.strictEqual(messages[2].senderType, 'agent', '3ª mensagem deve ser do atendente');
    assert(!messages[1].content.includes('4111'), 'Conteúdo retornado pelo reader deve estar sanitizado');
    assert(messages[1].content.includes('[CARTAO_REDUZIDO]'), 'Conteúdo sanitizado no leitor');
  });

  // ==========================================================================
  // CENÁRIO G03: Interligação OS <-> Conversa por Telefone do Cliente (Regra L1)
  // ==========================================================================
  await test('G03 — Interligação OS <-> Conversa por Telefone do Cliente (Regra L1)', () => {
    const memDb = new Database(':memory:');
    const linker = new OsConversationGraphLinker(memDb);

    const evalResult = OsConversationGraphLinker.evaluateLink({
      osId: 4453,
      lojaSlug: 'maua',
      customerPhone: '(11) 98888-7777',
      conversationId: 101,
      contactPhone: '5511988887777'
    });

    assert(evalResult.isLinked, 'Telefone coincidente deve gerar vínculo');
    assert.strictEqual(evalResult.linkMethod, 'PHONE_MATCH');
    assert.strictEqual(evalResult.confidence, 'HIGH');

    // Executa vinculação transacional
    const linkRes = linker.link({
      osId: 4453,
      lojaSlug: 'maua',
      plate: 'EUM1J34',
      vehicleModel: 'Onix',
      customerName: 'Carlos Silva',
      customerPhone: '5511988887777',
      erpStatus: 'ABERTO',
      conversationId: 101,
      contactPhone: '5511988887777',
      contactName: 'Carlos Silva'
    });

    assert(linkRes.isLinked);

    // Verifica persistência no banco
    const linkRow = memDb.prepare(`
      SELECT * FROM hydra_conversation_os_links WHERE conversation_id = 101 AND os_id = 4453
    `).get() as any;
    assert(linkRow, 'Deve ter gravado vínculo em hydra_conversation_os_links');
    assert.strictEqual(linkRow.link_method, 'PHONE_MATCH');

    const edges = memDb.prepare(`
      SELECT * FROM hydra_case_graph_edges WHERE from_node_id LIKE '%101'
    `).all() as any[];
    assert.strictEqual(edges.length, 1);
    assert.strictEqual(edges[0].relation_type, 'TREATS_ORDER');

    memDb.close();
  });

  // ==========================================================================
  // CENÁRIO G04: Interligação OS <-> Conversa por Placa de Veículo (Regra L2)
  // ==========================================================================
  await test('G04 — Interligação OS <-> Conversa por Placa de Veículo (Regra L2)', () => {
    const memDb = new Database(':memory:');
    const linker = new OsConversationGraphLinker(memDb);

    const messages: SanitizedChatMessage[] = [
      {
        messageId: 501,
        conversationId: 202,
        senderType: 'client',
        content: 'Boa tarde, o Fiesta da placa JSX-9E04 está pronto para retirada?',
        isPrivate: false,
        hasAttachments: false,
        createdAt: new Date().toISOString()
      }
    ];

    const evalResult = OsConversationGraphLinker.evaluateLink({
      osId: 1916,
      lojaSlug: 'jorge-beretta',
      plate: 'JSX9E04',
      conversationId: 202,
      messages
    });

    assert(evalResult.isLinked, 'Menção da placa no chat deve gerar vínculo');
    assert.strictEqual(evalResult.linkMethod, 'PLATE_MATCH');
    assert.strictEqual(evalResult.confidence, 'HIGH');

    linker.link({
      osId: 1916,
      lojaSlug: 'jorge-beretta',
      plate: 'JSX9E04',
      vehicleModel: 'Fiesta',
      conversationId: 202,
      messages
    });

    const vehEdge = memDb.prepare(`
      SELECT * FROM hydra_case_graph_edges WHERE relation_type = 'BELONGS_TO_VEHICLE'
    `).get() as any;
    assert(vehEdge, 'Deve ter criado aresta BELONGS_TO_VEHICLE');

    memDb.close();
  });

  // ==========================================================================
  // CENÁRIO G05: Interligação OS <-> Conversa por Menção Explícita de OS (Regra L3)
  // ==========================================================================
  await test('G05 — Interligação OS <-> Conversa por Menção Explícita de OS (Regra L3)', () => {
    const messages: SanitizedChatMessage[] = [
      {
        messageId: 601,
        conversationId: 303,
        senderType: 'agent',
        content: 'Verificando o andamento da OS #4453 com o chefe de oficina.',
        isPrivate: false,
        hasAttachments: false,
        createdAt: new Date().toISOString()
      }
    ];

    const evalResult = OsConversationGraphLinker.evaluateLink({
      osId: 4453,
      lojaSlug: 'maua',
      conversationId: 303,
      messages
    });

    assert(evalResult.isLinked, 'Citação da OS no chat deve gerar vínculo');
    assert.strictEqual(evalResult.linkMethod, 'OS_MENTION');
    assert.strictEqual(evalResult.confidence, 'HIGH');
  });

  // ==========================================================================
  // CENÁRIO G06: Ferramenta conversations.search chamada por Admin/Sócio
  // ==========================================================================
  await test('G06 — Ferramenta conversations.search chamada por Admin/Sócio', async () => {
    const memDb = new Database(':memory:');
    const reader = new ChatwootConversationReader({ fetchFn: mockFetch as any });
    const linker = new OsConversationGraphLinker(memDb);
    const executor = new HydraActionExecutor({ db: memDb, chatwootReader: reader, graphLinker: linker });

    // Pré-vincula conversa 101 à OS 4453
    linker.link({
      osId: 4453,
      lojaSlug: 'maua',
      customerPhone: '5511988887777',
      conversationId: 101,
      contactPhone: '5511988887777'
    });

    const result = await executor.executeTool(socioContext, 'conversations.search', {
      phone: '11988887777'
    });

    assert(result.success, 'Execução da ferramenta deve ter sucesso');
    assert.strictEqual(result.action, 'conversations.search');
    const data = result.data as any;
    assert(data.conversations && data.conversations.length > 0, 'Deve retornar ao menos 1 conversa');
    assert(data.conversations[0].chatwootUrl.includes('/conversations/101'), 'Deve conter link direto para o Chatwoot');
    assert(data.linkedOrders && data.linkedOrders.length > 0, 'Deve conter as ordens de serviço vinculadas');
    assert.strictEqual(data.linkedOrders[0].osId, 4453);

    memDb.close();
  });

  // ==========================================================================
  // CENÁRIO G07: Ferramenta conversations.get_history chamada por Admin/Sócio
  // ==========================================================================
  await test('G07 — Ferramenta conversations.get_history chamada por Admin/Sócio', async () => {
    const reader = new ChatwootConversationReader({ fetchFn: mockFetch as any });
    const executor = new HydraActionExecutor({ chatwootReader: reader });

    const result = await executor.executeTool(socioContext, 'conversations.get_history', {
      conversationId: 101,
      limit: 10
    });

    assert(result.success, 'Execução da ferramenta deve ter sucesso');
    assert.strictEqual(result.action, 'conversations.get_history');
    const data = result.data as any;
    assert.strictEqual(data.conversationId, 101);
    assert.strictEqual(data.messages.length, 3);
    assert(data.chatwootUrl.includes('101'), 'Deve ter o link do Chatwoot');
    assert(data.waLink.includes('wa.me/5511988887777'), 'Deve ter o link do WhatsApp');
    assert(data.limitationDeclared, 'Deve identificar declaração de atraso/peça');

    // Valida que dados sensíveis não vazaram nas mensagens retornadas
    assert(!JSON.stringify(data.messages).includes('4111 2222 3333 4444'), 'Dados de cartão não podem vazar');
  });

  // ==========================================================================
  // CENÁRIO G08: Ferramenta graph.get_os_case chamada por Admin/Sócio
  // ==========================================================================
  await test('G08 — Ferramenta graph.get_os_case chamada por Admin/Sócio', async () => {
    const memDb = new Database(':memory:');
    const linker = new OsConversationGraphLinker(memDb);
    const executor = new HydraActionExecutor({ db: memDb, graphLinker: linker });

    // Insere posição com motivo de atraso
    memDb.prepare(`
      INSERT INTO hydra_case_current_position (
        loja_slug, os_id, vehicle_plate, vehicle_model, customer_name,
        current_erp_status, reported_delay_cause, next_promised_step, updated_at
      ) VALUES ('maua', 4453, 'EUM1J34', 'Onix', 'Carlos Silva', 'ABERTO', 'Aguardando cabeçote retificado', 'Montagem final', datetime('now'))
    `).run();

    // Insere fato recente
    memDb.prepare(`
      INSERT INTO hydra_afirmacoes_analisadas (
        revision_id, statement_id, fact_id, analysis_id, target_os_id,
        subject_type, polarity, author_role, author_name, event_timestamp,
        raw_excerpt, confirmation_level
      ) VALUES (
        'rev_1', 'stmt_1', 'fact_1', 'an_1', 4453,
        'ATRASO', 'AFFIRMATIVE', 'ATTENDANT', 'Gerente Mauá', datetime('now'),
        'Cabeçote foi enviado para a retífica hoje cedo', 'EXPLICIT_CONFIRMED'
      )
    `).run();

    const result = await executor.executeTool(adminContext, 'graph.get_os_case', {
      osId: 4453,
      storeSlug: 'maua'
    });

    assert(result.success, 'Execução deve ter sucesso');
    const data = result.data as any;
    assert.strictEqual(data.osId, 4453);
    assert.strictEqual(data.lojaSlug, 'maua');
    assert.strictEqual(data.delayReason, 'Aguardando cabeçote retificado');
    assert.strictEqual(data.nextPromisedStep, 'Montagem final');
    assert(data.recentFacts && data.recentFacts.length > 0, 'Deve conter fatos recentes');
    assert.strictEqual(data.recentFacts[0].subject, 'ATRASO');

    memDb.close();
  });

  // ==========================================================================
  // CENÁRIO G09: Gerente de loja ou operador tentando usar tools de chat/grafo
  // ==========================================================================
  await test('G09 — Bloqueio RBAC para gerente/operador em ferramentas de chat e grafo', async () => {
    const memDb = new Database(':memory:');
    const executor = new HydraActionExecutor({ db: memDb });

    // 1. conversations.search
    const resSearch = await executor.executeTool(managerContext, 'conversations.search', { query: 'teste' });
    assert(!resSearch.success, 'Gerente não pode pesquisar conversas');
    assert.strictEqual(resSearch.errorCode, 'PERMISSION_DENIED');

    // 2. conversations.get_history
    const resHist = await executor.executeTool(managerContext, 'conversations.get_history', { conversationId: 101 });
    assert(!resHist.success, 'Gerente não pode ler histórico de conversas');
    assert.strictEqual(resHist.errorCode, 'PERMISSION_DENIED');

    // 3. graph.get_os_case
    const resGraph = await executor.executeTool(managerContext, 'graph.get_os_case', { osId: 4453, storeSlug: 'maua' });
    assert(!resGraph.success, 'Gerente não pode acessar o grafo da OS');
    assert.strictEqual(resGraph.errorCode, 'PERMISSION_DENIED');

    memDb.close();
  });

  // ==========================================================================
  // CENÁRIO G10: Desbloqueio no IntentRewriter (fim da recusa cega do Chatwoot)
  // ==========================================================================
  await test('G10 — IntentRewriter não emite mais recusa de Chatwoot e classifica os_conversation', () => {
    // 1. Pergunta sobre o que o cliente falou
    const res1 = rewriteIntent('o que o cliente do Ka falou no chat?');
    assert.strictEqual(res1.intent, 'os_conversation', 'Deve classificar como os_conversation');
    assert(!res1.needsClarification, 'Não pode cair em clarificação/recusa de capacidade indisponível');
    assert(!res1.clarificationMessage?.includes('Não tenho acesso à leitura de links externos ou histórico direto do Chatwoot'));

    // 2. Pergunta se tem conversa da OS
    const res2 = rewriteIntent('tem conversa da OS 4453 no chatwoot?');
    assert.strictEqual(res2.intent, 'os_conversation');
    assert.strictEqual(Number(res2.osId), 4453);
    assert(!res2.clarificationMessage?.includes('Não tenho acesso à leitura'));

    // 3. Link direto do Chatwoot
    const res3 = rewriteIntent('qual o link do chatwoot da OS 1916?');
    assert.strictEqual(res3.intent, 'os_conversation');
    assert.strictEqual(Number(res3.osId), 1916);

    // 4. Pergunta geral de tickets
    const res4 = rewriteIntent('ver tickets do chatwoot da loja de Mauá');
    assert.strictEqual(res4.intent, 'os_conversation');
    assert(res4.lojaSlug === 'ReiDoOleoMaua' || res4.lojaSlug === 'maua', 'Deve resolver para a loja de Mauá');
  });

  // ==========================================================================
  // RESUMO FINAL
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`RESUMO DA VALIDAÇÃO | Spec 059: ${passed} PASSADOS / ${failed} FALHADOS`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSpec059Tests().catch(err => {
  console.error('ERRO FATAL NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});
