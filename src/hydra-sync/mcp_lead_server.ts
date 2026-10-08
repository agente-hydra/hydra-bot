import { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

export const HYDRA_DEFAULT_MCP_KEY = 'hydra-mcp-leads-2026-sec!';

export function getMcpApiKey(): string {
  return process.env.HYDRA_MCP_API_KEY || process.env.MCP_API_KEY || HYDRA_DEFAULT_MCP_KEY;
}

/**
 * Validacao de credenciais Bearer ou x-api-key
 */
export function authenticateMcpRequest(req: IncomingMessage): boolean {
  const expectedKey = getMcpApiKey();
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['X-Api-Key'];

  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim() === expectedKey) {
    return true;
  }

  if (typeof authHeader === 'string') {
    const parts = authHeader.trim().split(' ');
    if (parts.length === 2 && /^bearer$/i.test(parts[0]) && parts[1] === expectedKey) {
      return true;
    }
    if (parts.length === 1 && parts[0] === expectedKey) {
      return true;
    }
  }

  return false;
}

/**
 * Callbacks para registro dinamico de ferramentas em novas instancias de Server
 */
export type McpServerInitCallback = (server: Server) => void;
const mcpServerInitCallbacks: McpServerInitCallback[] = [];

/**
 * Registra um configurador de tools/handlers chamado para o servidor padrao e para cada sessao SSE
 */
export function onMcpServerCreated(cb: McpServerInitCallback): void {
  mcpServerInitCallbacks.push(cb);
  cb(leadMcpServer);
}

/**
 * Cria uma nova instancia de Server com as tools registradas
 */
export function createLeadMcpServer(): Server {
  const server = new Server(
    {
      name: 'hydra-manager-leads-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  for (const cb of mcpServerInitCallbacks) {
    try {
      cb(server);
    } catch (err: any) {
      console.warn('[Hydra MCP] Erro ao aplicar callback de inicialização no server:', err?.message || err);
    }
  }

  return server;
}

/**
 * Instancia singleton do MCP Server (utilizada para testes em memoria e fallback)
 */
export const leadMcpServer = new Server(
  {
    name: 'hydra-manager-leads-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Gerenciamento de sessoes ativas SSE por sessionId
export const activeSseTransports = new Map<string, SSEServerTransport>();
export const activeSseServers = new Map<string, Server>();

/**
 * Roteador HTTP unificado para requisicoes MCP SSE
 * Retorna true se a requisicao foi consumida por uma rota MCP, ou false caso contrario
 */
export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  parsedBody?: unknown
): Promise<boolean> {
  const pathname = parsedUrl.pathname;

  // Rota de Health Check do MCP
  if (req.method === 'GET' && pathname === '/mcp/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'hydra-manager-leads-mcp',
      activeSessions: activeSseTransports.size,
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }));
    return true;
  }

  // Preflight CORS
  if (req.method === 'OPTIONS' && (pathname.startsWith('/mcp/'))) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    });
    res.end();
    return true;
  }

  // Rotas autenticadas do protocolo MCP
  if (pathname === '/mcp/sse' || pathname === '/mcp/messages') {
    if (!authenticateMcpRequest(req)) {
      console.warn('[Hydra MCP Auth] ⚠️ Falha de autenticação MCP! Auth:', req.headers['authorization'], 'X-Api-Key:', req.headers['x-api-key']);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: 'Unauthorized',
        message: 'Credenciais MCP invalidas ou ausentes. Envie Authorization: Bearer <TOKEN> ou x-api-key: <TOKEN>'
      }));
      return true;
    }

    // 1. GET /mcp/sse — Estabelece stream SSE isolada por cliente
    if (req.method === 'GET' && pathname === '/mcp/sse') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const transport = new SSEServerTransport('/mcp/messages', res);
      const sessionId = transport.sessionId;
      console.log('[Hydra MCP SSE] 🔑 Cliente MCP conectado via SSE! SessionId:', sessionId);
      
      const server = createLeadMcpServer();
      activeSseTransports.set(sessionId, transport);
      activeSseServers.set(sessionId, server);

      transport.onclose = async () => {
        console.log(`[Hydra MCP SSE] 🔌 Conexão SSE finalizada para sessionId: ${sessionId}`);
        activeSseTransports.delete(sessionId);
        const s = activeSseServers.get(sessionId);
        activeSseServers.delete(sessionId);
        if (s) {
          try {
            await s.close();
          } catch {}
        }
      };

      transport.onerror = async (err) => {
        console.warn(`[Hydra MCP SSE] Erro na sessao ${sessionId}:`, err?.message || err);
        activeSseTransports.delete(sessionId);
        const s = activeSseServers.get(sessionId);
        activeSseServers.delete(sessionId);
        if (s) {
          try {
            await s.close();
          } catch {}
        }
      };

      await server.connect(transport);
      return true;
    }

    // 2. POST /mcp/messages — Recebe mensagens/RPC do cliente MCP
    if (req.method === 'POST' && pathname === '/mcp/messages') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
        return true;
      }

      console.log('[Hydra MCP Messages] 📩 Chamada POST recebida para sessionId:', sessionId);
      const transport = activeSseTransports.get(sessionId);
      if (!transport) {
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
        return true;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      await transport.handlePostMessage(req, res, parsedBody);
      return true;
    }
  }

  return false;
}
