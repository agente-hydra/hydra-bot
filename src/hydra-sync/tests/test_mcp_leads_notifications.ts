import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { leadMcpServer } from '../mcp_lead_server.js';
import { initManagerRegistrySchema, TEST_OVERRIDE_PHONE } from '../manager_registry.js';
import { registerLeadNotificationTools } from '../mcp_lead_tools.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    failed++;
  } else {
    console.log(`[PASS] ${msg}`);
    passed++;
  }
}

async function run() {
  console.log('Iniciando Test Harness Integrado: Hydra Manager Leads MCP & Trava de Teste');

  const db = new Database(':memory:');
  initManagerRegistrySchema(db);

  // Spy de envios WhatsApp
  const sentMessages: Array<{ phone: string; text: string }> = [];

  const mockWhatsAppClient = {
    sendText: async (phone: string, text: string) => {
      sentMessages.push({ phone, text });
      return {
        sucesso: true,
        messageId: `wamid_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        statusHttp: 201,
        duracaoMs: 85
      };
    }
  };

  registerLeadNotificationTools({
    db,
    customWhatsAppClient: mockWhatsAppClient
  });

  // Conectar client MCP em memoria para testar as Tool Calls
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await leadMcpServer.connect(serverTransport);

  const client = new Client(
    { name: 'test-crm-bot', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(clientTransport);

  // Cenário 1: list_store_managers (M07)
  {
    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map(t => t.name);
    assert(toolNames.includes('list_store_managers'), 'Deve listar tool list_store_managers');
    assert(toolNames.includes('notify_manager_lead_scheduled'), 'Deve listar tool notify_manager_lead_scheduled');
    assert(toolNames.includes('notify_manager_lead_cancelled'), 'Deve listar tool notify_manager_lead_cancelled');

    const listRes = await client.callTool({
      name: 'list_store_managers',
      arguments: {}
    });
    const parsed = JSON.parse(((listRes as any).content[0]).text);
    assert(parsed.sucesso === true && parsed.totalLojas === 10, 'Deve retornar catálogo das 10 lojas operacionais');
  }

  // Cenário 2: M01 com Trava de Teste Obrigatória (11996242812)
  {
    process.env.MCP_FORCE_RECIPIENT = '5511996242812';
    sentMessages.length = 0;

    const res = await client.callTool({
      name: 'notify_manager_lead_scheduled',
      arguments: {
        loja: 'Jorge Beretta',
        cliente_nome: 'Marcos Vinicius',
        cliente_telefone: '11988887777',
        data_agendamento: '08/10/2026',
        horario_agendamento: '10:30',
        veiculo: 'Honda Civic 2021',
        servico_pretendido: 'Troca de óleo de câmbio CVT',
        origem_lead: 'Google Ads',
        observacoes: 'Cliente relatou leve tranco a frio',
        id_externo: 'crm_lead_001'
      }
    });

    const parsed = JSON.parse(((res as any).content[0]).text);
    assert(parsed.sucesso === true, 'M01: Deve retornar sucesso = true');
    assert(parsed.status === 'ENVIADO', 'M01: Status deve ser ENVIADO');
    assert(parsed.instanciaEmissora === 'atendimento', 'M01: Instância emissora deve ser atendimento');
    assert(sentMessages.length === 1, 'M01: Deve ter disparado exatamente 1 mensagem');

    // VERIFICACAO CRITICA DA TRAVA DO USUARIO:
    assert(sentMessages[0].phone === '5511996242812', `TRAVA DE SEGURANCA: Telefone enviado deve ser 5511996242812 (enviado para: ${sentMessages[0].phone})`);
    assert(sentMessages[0].text.includes('MODO DE TESTE — DESTINATÁRIO REAL: Jorge Beretta / Gerente Jorge Beretta (5511998874158)'), 'TRAVA: Deve avisar no corpo da mensagem quem era o destinatário real');
    assert(sentMessages[0].text.includes('Central de Atendimento Mecânica Popular'), 'Template: Deve conter assinatura da Central de Atendimento');

    // Verificar no SQLite
    const row = db.prepare('SELECT * FROM hydra_manager_notifications WHERE id_externo = ?').get('crm_lead_001') as any;
    assert(row.loja_slug === 'MPJorgeBeretta', 'SQLite: loja_slug gravado deve ser MPJorgeBeretta');
    assert(row.instancia_emissora === 'atendimento', 'SQLite: instancia_emissora deve ser atendimento');
    assert(row.gerente_phone === '5511998874158', 'SQLite: gerente_phone oficial preservado');
  }

  // Cenário 3: M04 (Idempotência por id_externo)
  {
    sentMessages.length = 0;
    const resDuplicado = await client.callTool({
      name: 'notify_manager_lead_scheduled',
      arguments: {
        loja: 'Jorge Beretta',
        cliente_nome: 'Marcos Vinicius',
        cliente_telefone: '11988887777',
        data_agendamento: '08/10/2026',
        horario_agendamento: '10:30',
        id_externo: 'crm_lead_001' // mesmo id
      }
    });

    const parsed = JSON.parse(((resDuplicado as any).content[0]).text);
    assert(parsed.status === 'DUPLICADO', 'M04: Deve retornar status DUPLICADO');
    assert(sentMessages.length === 0, 'M04: ZERO novas mensagens enviadas para duplicatas');
  }

  // Cenário 4: M02 (Slug informal: "jabaquara")
  {
    sentMessages.length = 0;
    const res = await client.callTool({
      name: 'notify_manager_lead_scheduled',
      arguments: {
        loja: 'jabaquara',
        cliente_nome: 'Ana Paula',
        cliente_telefone: '11977776666',
        data_agendamento: '09/10/2026',
        horario_agendamento: '14:00',
        id_externo: 'crm_lead_002'
      }
    });

    const parsed = JSON.parse(((res as any).content[0]).text);
    assert(parsed.sucesso === true && parsed.loja === 'Jabaquara', 'M02: Normaliza slug "jabaquara" para Jabaquara');
    assert(sentMessages.length === 1 && sentMessages[0].phone === '5511996242812', 'M02: Dispara para telefone de teste');
  }

  // Cenário 5: M03 (Cancelamento de Agendamento)
  {
    sentMessages.length = 0;
    const res = await client.callTool({
      name: 'notify_manager_lead_cancelled',
      arguments: {
        loja: 'Kennedy',
        cliente_nome: 'Roberto Santos',
        cliente_telefone: '11966665555',
        data_agendamento: '08/10/2026',
        horario_agendamento: '16:00',
        motivo_cancelamento: 'Vendeu o veículo hoje cedo',
        reagendamento_pretendido: false,
        id_externo: 'crm_cancel_001'
      }
    });

    const parsed = JSON.parse(((res as any).content[0]).text);
    assert(parsed.sucesso === true && parsed.status === 'ENVIADO', 'M03: Cancelamento enviado com sucesso');
    assert(sentMessages[0].text.includes('CANCELAMENTO DE AGENDAMENTO — KENNEDY'), 'M03: Template de cancelamento formatado');
    assert(sentMessages[0].text.includes('Vaga liberada no pátio'), 'M03: Rodapé de liberação de box');
  }

  // Cenário 6: M05 (Loja Inexistente)
  {
    const res = await client.callTool({
      name: 'notify_manager_lead_scheduled',
      arguments: {
        loja: 'Oficina Fantasma 999',
        cliente_nome: 'Teste',
        cliente_telefone: '11999999999',
        data_agendamento: '10/10/2026',
        horario_agendamento: '11:00'
      }
    });

    assert((res as any).isError === true, 'M05: Deve sinalizar isError = true');
    const parsed = JSON.parse(((res as any).content[0]).text);
    assert(parsed.status === 'ERRO_LOJA', 'M05: Status ERRO_LOJA');
    assert(Array.isArray(parsed.lojasValidas) && parsed.lojasValidas.length === 10, 'M05: Deve listar as 10 lojas válidas');
  }

  db.close();

  console.log(`\n========================================`);
  console.log(`Resultado E3: ${passed} PASS, ${failed} FAIL`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Erro fatal no teste E3:', err);
  process.exit(1);
});