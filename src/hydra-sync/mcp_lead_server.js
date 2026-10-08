import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
const HYDRA_DEFAULT_MCP_KEY = "hydra-mcp-leads-2026-sec!";
function getMcpApiKey() {
  return process.env.HYDRA_MCP_API_KEY || process.env.MCP_API_KEY || HYDRA_DEFAULT_MCP_KEY;
}
function authenticateMcpRequest(req) {
  const expectedKey = getMcpApiKey();
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const apiKeyHeader = req.headers["x-api-key"] || req.headers["X-Api-Key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim() === expectedKey) {
    return true;
  }
  if (typeof authHeader === "string") {
    const parts = authHeader.trim().split(" ");
    if (parts.length === 2 && /^bearer$/i.test(parts[0]) && parts[1] === expectedKey) {
      return true;
    }
    if (parts.length === 1 && parts[0] === expectedKey) {
      return true;
    }
  }
  return false;
}
const mcpServerInitCallbacks = [];
function onMcpServerCreated(cb) {
  mcpServerInitCallbacks.push(cb);
  cb(leadMcpServer);
}
function createLeadMcpServer() {
  const server = new Server(
    {
      name: "hydra-manager-leads-mcp",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );
  for (const cb of mcpServerInitCallbacks) {
    try {
      cb(server);
    } catch (err) {
      console.warn("[Hydra MCP] Erro ao aplicar callback de inicializa\xE7\xE3o no server:", err?.message || err);
    }
  }
  return server;
}
const leadMcpServer = new Server(
  {
    name: "hydra-manager-leads-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);
const activeSseTransports = /* @__PURE__ */ new Map();
const activeSseServers = /* @__PURE__ */ new Map();
async function handleMcpHttpRequest(req, res, parsedUrl, parsedBody) {
  const pathname = parsedUrl.pathname;
  if (req.method === "GET" && pathname === "/mcp/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({
      status: "ok",
      service: "hydra-manager-leads-mcp",
      activeSessions: activeSseTransports.size,
      version: "1.0.0",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }));
    return true;
  }
  if (req.method === "OPTIONS" && pathname.startsWith("/mcp/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key"
    });
    res.end();
    return true;
  }
  if (pathname === "/mcp/sse" || pathname === "/mcp/messages") {
    if (!authenticateMcpRequest(req)) {
      console.warn("[Hydra MCP Auth] \u26A0\uFE0F Falha de autentica\xE7\xE3o MCP! Auth:", req.headers["authorization"], "X-Api-Key:", req.headers["x-api-key"]);
      res.writeHead(401, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({
        error: "Unauthorized",
        message: "Credenciais MCP invalidas ou ausentes. Envie Authorization: Bearer <TOKEN> ou x-api-key: <TOKEN>"
      }));
      return true;
    }
    if (req.method === "GET" && pathname === "/mcp/sse") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const transport = new SSEServerTransport("/mcp/messages", res);
      const sessionId = transport.sessionId;
      console.log("[Hydra MCP SSE] \u{1F511} Cliente MCP conectado via SSE! SessionId:", sessionId);
      const server = createLeadMcpServer();
      activeSseTransports.set(sessionId, transport);
      activeSseServers.set(sessionId, server);
      transport.onclose = async () => {
        console.log(`[Hydra MCP SSE] \u{1F50C} Conex\xE3o SSE finalizada para sessionId: ${sessionId}`);
        activeSseTransports.delete(sessionId);
        const s = activeSseServers.get(sessionId);
        activeSseServers.delete(sessionId);
        if (s) {
          try {
            await s.close();
          } catch {
          }
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
          } catch {
          }
        }
      };
      await server.connect(transport);
      return true;
    }
    if (req.method === "POST" && pathname === "/mcp/messages") {
      const sessionId = parsedUrl.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(JSON.stringify({ error: "Missing sessionId parameter" }));
        return true;
      }
      console.log("[Hydra MCP Messages] \u{1F4E9} Chamada POST recebida para sessionId:", sessionId);
      const transport = activeSseTransports.get(sessionId);
      if (!transport) {
        res.writeHead(404, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
        return true;
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      await transport.handlePostMessage(req, res, parsedBody);
      return true;
    }
  }
  return false;
}
export {
  HYDRA_DEFAULT_MCP_KEY,
  activeSseServers,
  activeSseTransports,
  authenticateMcpRequest,
  createLeadMcpServer,
  getMcpApiKey,
  handleMcpHttpRequest,
  leadMcpServer,
  onMcpServerCreated
};
