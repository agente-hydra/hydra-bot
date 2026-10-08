import { createServer, request } from 'node:http';
import {
  handleMcpHttpRequest,
  authenticateMcpRequest,
  HYDRA_DEFAULT_MCP_KEY,
  activeSseTransports
} from '../mcp_lead_server.js';

let failed = 0;
let passed = 0;

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
  console.log('Iniciando Suite E1: Teste de Gateway MCP SSE e Autenticacao');

  // 1. Testes Unitarios de Autenticacao
  const fakeReqNoAuth = { headers: {} } as any;
  assert(authenticateMcpRequest(fakeReqNoAuth) === false, 'Sem auth deve retornar false');

  const fakeReqBadAuth = { headers: { authorization: 'Bearer errado-123' } } as any;
  assert(authenticateMcpRequest(fakeReqBadAuth) === false, 'Auth invalido deve retornar false');

  const fakeReqBearer = { headers: { authorization: `Bearer ${HYDRA_DEFAULT_MCP_KEY}` } } as any;
  assert(authenticateMcpRequest(fakeReqBearer) === true, 'Bearer correto deve autenticar');

  const fakeReqApiKey = { headers: { 'x-api-key': HYDRA_DEFAULT_MCP_KEY } } as any;
  assert(authenticateMcpRequest(fakeReqApiKey) === true, 'x-api-key correta deve autenticar');

  // 2. Servidor HTTP de Teste
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const handled = await handleMcpHttpRequest(req, res, url);
    if (!handled) {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('normal_webhook_handled');
    }
  });

  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 3. Teste GET /mcp/health
  {
    const res = await fetch(`${baseUrl}/mcp/health`);
    assert(res.status === 200, 'GET /mcp/health deve responder 200');
    const data = await res.json() as any;
    assert(data.status === 'ok', 'Status da saude deve ser ok');
    assert(data.service === 'hydra-manager-leads-mcp', 'Nome do servico deve bater');
  }

  // 4. Teste Nao-MCP preservado (POST / deve cair no webhook normal)
  {
    const res = await fetch(`${baseUrl}/`, { method: 'POST', body: 'hello' });
    const text = await res.text();
    assert(res.status === 200, 'POST / deve responder 200');
    assert(text === 'normal_webhook_handled', 'POST / deve passar reto para o handler do webhook');
  }

  // 5. Teste Rejeicao 401 em /mcp/sse sem credenciais
  {
    const res = await fetch(`${baseUrl}/mcp/sse`);
    assert(res.status === 401, 'GET /mcp/sse sem credencial deve responder 401 Unauthorized');
  }

  // 6. Teste Handshake SSE com Bearer Token
  {
    let sessionIdCaptured: string | undefined;

    await new Promise<void>((resolve) => {
      const sseReq = request(`${baseUrl}/mcp/sse`, {
        headers: {
          'Authorization': `Bearer ${HYDRA_DEFAULT_MCP_KEY}`,
          'Accept': 'text/event-stream'
        }
      }, (res) => {
        assert(res.statusCode === 200, 'Handshake SSE com token valido deve retornar 200');
        assert(Boolean(res.headers['content-type']?.includes('text/event-stream')), 'Content-Type deve ser text/event-stream');

        res.on('data', (chunk) => {
          const str = chunk.toString();
          if (str.includes('/mcp/messages') && str.includes('sessionId=')) {
            const match = str.match(/sessionId=([a-zA-Z0-9_-]+)/);
            if (match) {
              sessionIdCaptured = match[1];
              assert(Boolean(sessionIdCaptured), `SessionId SSE capturado no handshake: ${sessionIdCaptured}`);
              assert(activeSseTransports.has(sessionIdCaptured!), 'Sessao deve estar registrada em activeSseTransports');
              sseReq.destroy();
              resolve();
            }
          }
        });
      });

      sseReq.on('error', () => {
        resolve();
      });

      sseReq.end();
    });

    // 7. Teste POST /mcp/messages com sessao inexistente
    {
      const res = await fetch(`${baseUrl}/mcp/messages?sessionId=fake-session-999`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HYDRA_DEFAULT_MCP_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      });
      assert(res.status === 404, 'POST com sessionId invalido deve retornar 404');
    }
  }

  server.close();

  console.log(`\n========================================`);
  console.log(`Resultado E1: ${passed} PASS, ${failed} FAIL`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Erro fatal no teste E1:', err);
  process.exit(1);
});