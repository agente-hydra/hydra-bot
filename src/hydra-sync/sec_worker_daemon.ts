/**
 * Secondary Worker HTTP Daemon (Port 3344)
 * 
 * Executa em segundo plano sob a identidade de servico 'hydra-sec'.
 * Fornece interface HTTP REST isolada para execucao do AGY CLI com o modelo gemini-3.8-flash-low.
 * Nenhuma credencial e exposta via rede ou log.
 */

import http from 'http';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PORT = parseInt(process.env.AGY_SEC_PORT || '3344', 10);
const HOST = '127.0.0.1';
const AGY_BIN = process.env.AGY_SEC_BIN || '/home/hydra-sec/.local/bin/agy';
const TOKEN_PATH = '/home/hydra-sec/.gemini/antigravity-cli/antigravity-oauth-token';

function isAuthenticated(): boolean {
  try {
    return fs.existsSync(TOKEN_PATH) && fs.statSync(TOKEN_PATH).size > 50;
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'online',
      worker: 'secondary',
      user: process.env.USER || 'hydra-sec',
      authenticated: isAuthenticated(),
      model: 'gemini-3.8-flash-low'
    }));
  }

  // Execucao de Prompt
  if (req.method === 'POST' && url.pathname === '/prompt') {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const prompt = payload.prompt;
        const model = payload.model || 'gemini-3.8-flash-low';

        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Campo prompt obrigatorio' }));
        }

        const start = Date.now();
        const proc = spawnSync(AGY_BIN, [
          '-p', prompt,
          '--dangerously-skip-permissions',
          '--model', model
        ], {
          timeout: 25000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            HOME: '/home/hydra-sec',
            USER: 'hydra-sec'
          }
        });

        const durationMs = Date.now() - start;
        const stdout = (proc.stdout || '').trim();
        const stderr = (proc.stderr || '').trim();
        const combined = `${stdout}\n${stderr}`.trim();

        if (proc.status === 0 && stdout && !stdout.startsWith('error:')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            output: stdout,
            durationMs
          }));
        }

        const isQuota = combined.includes('RESOURCE_EXHAUSTED') ||
                        combined.includes('code 429') ||
                        combined.includes('Individual quota reached');

        const statusCode = isQuota ? 429 : 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: combined || proc.error?.message || `Exit code ${proc.status}`,
          isQuotaExhausted: isQuota,
          durationMs
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: err.message
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint nao encontrado' }));
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[SEC_WORKER_DAEMON] Rodando em http://${HOST}:${PORT} sob usuario ${process.env.USER}`);
  });
}

export default server;