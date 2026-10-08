import { createServer } from "http";
import { execFile } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Conexão direta com SQLite WAL operacional
let db = null;
try {
  const Database = require("/opt/bots/node_modules/better-sqlite3");
  db = new Database("/home/operacional/hydra-data/hydra_ops.db");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  try {
    const sqliteVec = require("/opt/bots/node_modules/sqlite-vec");
    if (typeof sqliteVec.load === "function") {
      sqliteVec.load(db);
    }
  } catch (vecErr) {
    console.warn("[Hydra Webhook] Falha ao carregar extensão sqlite-vec:", vecErr?.message || vecErr);
  }
  console.log("[Hydra Webhook] Conectado ao SQLite WAL: /home/operacional/hydra-data/hydra_ops.db");

  // Inicialização idempotente das tabelas de auditoria e reação
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_dedup (
      message_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      origem TEXT DEFAULT 'EVOLUTION',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS whatsapp_delivery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      message_id TEXT,
      endpoint TEXT NOT NULL,
      status_http INTEGER,
      sucesso INTEGER NOT NULL,
      tentativas INTEGER DEFAULT 1,
      duracao_ms INTEGER,
      resposta_raw TEXT,
      erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      batch_id TEXT,
      state TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_lifecycle_msg_id ON message_lifecycle(message_id);

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT PRIMARY KEY,
      remote_jid TEXT NOT NULL,
      phone TEXT,
      reaction TEXT NOT NULL,
      status_http INTEGER,
      sucesso INTEGER NOT NULL,
      duracao_ms INTEGER,
      resposta_raw TEXT,
      erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
} catch (err) {
  console.error("[Hydra Webhook] ⚠️ Alerta: Falha ao abrir conexão direta com SQLite:", err?.message || err);
}

const EVOLUTION_URL = process.env.EVOLUTION_URL || "https://evo.tork.services";
const EVOLUTION_KEY = process.env.EVOLUTION_KEY || "TorkEvoApiKey2026Secure!";
const INSTANCE = process.env.EVOLUTION_INSTANCE || "hydra";

// 1. Whitelist estrita: somente Davi e Marcos
const WHITELIST = new Set([
  "5511996242812",
  "5511970671717"
]);

/**
 * Sanitizer defensivo de segunda camada para o protocolo WhatsApp (Idempotente)
 */
function sanitizeWhatsAppMarkdown(raw) {
  if (!raw) return "";
  let text = String(raw);

  // 1. Converte cabeçalhos Markdown (# Título) para Blockquotes do WhatsApp (> *Título*)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, p1) => {
    const trimmed = p1.trim();
    if (trimmed.startsWith("*") && trimmed.endsWith("*")) {
      return `> ${trimmed}`;
    }
    return `> *${trimmed}*`;
  });

  // 2. Remove separadores Markdown horizontais (---, ___, ***) que não sejam o delimitador ---BLOCK---
  text = text.replace(/^(?!---BLOCK---)[\t ]*[-*_]{3,}[\t ]*$/gm, "");

  // 3. Converte tabelas markdown em listas com marcadores nativos (- )
  text = text.replace(/^\|(.+)\|$/gm, (match) => {
    if (/^\|[\s\-:|]+\|$/.test(match)) return "";
    const cols = match.split("|").map(c => c.trim()).filter(Boolean);
    return cols.map(c => `- ${c}`).join("\n");
  });

  // 4. Converte negrito duplo (**) e asteriscos triplos (***) para negrito simples (*)
  text = text.replace(/\*\*\*+([^*\n]+?)\*\*\*+/g, "*$1*");
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "*$1*");

  // 5. Converte itálico duplo (__) para itálico simples (_)
  text = text.replace(/__([^_\n]+?)__/g, "_$1_");

  // 6. Normaliza marcadores de lista variados (•, +, ou * solto com espaço) para traço nativo (- )
  text = text.replace(/^[\t ]*[•+]\s+/gm, "- ");
  text = text.replace(/^[\t ]*\*\s+(?!\*)/gm, "- ");

  // 7. Garante que campos chave-valor em listas tenham a chave em negrito (- *Chave:* Valor)
  text = text.replace(/^([\t ]*-\s+)([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}:)\s+(?!\*)/gm, (_m, prefix, key) => {
    return `${prefix}*${key.trim()}* `;
  });

  // 8. Suprime emojis repetidos em série (> 2 repetições consecutivas)
  text = text.replace(/([\p{Emoji_Presentation}\p{Extended_Pictographic}])\1{2,}/gu, "$1");

  // 9. Remove tags HTML residuais
  text = text.replace(/<[^>]+>/g, "");

  // 10. Remove acúmulo excessivo de linhas em branco
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Registra entrega no SQLite para auditoria
 */
function logDelivery(phone, messageId, statusHttp, sucesso, tentativas, duracaoMs, respostaRaw, erro) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO whatsapp_delivery_logs (
        phone, message_id, endpoint, status_http, sucesso, tentativas, duracao_ms, resposta_raw, erro
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      phone,
      messageId || null,
      `${EVOLUTION_URL}/message/sendText/${INSTANCE}`,
      statusHttp || null,
      sucesso ? 1 : 0,
      tentativas || 1,
      duracaoMs || 0,
      respostaRaw ? String(respostaRaw).slice(0, 1000) : null,
      erro ? String(erro).slice(0, 500) : null
    );
  } catch (err) {
    console.warn("[Hydra Webhook] Falha ao gravar log de entrega:", err?.message || err);
  }
}

/**
 * Verificação e marcação de deduplicação durável em SQLite
 */
function isMessageProcessed(messageId) {
  if (!messageId) return false;
  if (!db) return false;
  try {
    const row = db.prepare("SELECT 1 FROM webhook_dedup WHERE message_id = ?").get(messageId);
    return Boolean(row);
  } catch {
    return false;
  }
}

function markMessageProcessed(messageId, phone) {
  if (!messageId || !db) return;
  try {
    db.prepare("INSERT OR IGNORE INTO webhook_dedup (message_id, phone, origem) VALUES (?, ?, 'EVOLUTION')")
      .run(messageId, phone);
  } catch (err) {
    console.warn("[Hydra Webhook] Falha ao marcar deduplicação no SQLite:", err?.message || err);
  }
}

/**
 * Idempotência e registro de reação 👀 vinculada ao messageId
 */
function hasMessageBeenReacted(messageId) {
  if (!messageId || !db) return false;
  try {
    const row = db.prepare("SELECT 1 FROM message_reactions WHERE message_id = ? AND sucesso = 1").get(messageId);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Registra estados determinísticos do ciclo de vida da mensagem:
 * evolution_received -> webhook_sent -> hydra_accepted -> batch_closed -> job_processing -> job_processed -> whatsapp_sent
 */
function recordLifecycleState(messageId, state, batchId = null, details = null) {
  if (!messageId || !db) return;
  try {
    db.prepare(`
      INSERT INTO message_lifecycle (message_id, batch_id, state, details)
      VALUES (?, ?, ?, ?)
    `).run(messageId, batchId || null, state, details ? String(details).slice(0, 300) : null);
    console.log(`[Lifecycle] #${messageId} -> ${state}${batchId ? ` (batch: ${batchId})` : ""}${details ? ` [${details}]` : ""}`);
  } catch (err) {
    console.warn(`[Lifecycle] Falha ao registrar estado ${state} para #${messageId}:`, err?.message || err);
  }
}

function recordMessageReaction(messageId, remoteJid, reaction, statusHttp, sucesso, duracaoMs, respostaRaw, erro) {
  if (!messageId || !db) return;
  try {
    const phone = remoteJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
    db.prepare(`
      INSERT OR REPLACE INTO message_reactions (
        message_id, remote_jid, phone, reaction, status_http, sucesso, duracao_ms, resposta_raw, erro
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      remoteJid,
      phone,
      reaction,
      statusHttp || null,
      sucesso ? 1 : 0,
      duracaoMs || 0,
      respostaRaw ? String(respostaRaw).slice(0, 1000) : null,
      erro ? String(erro).slice(0, 500) : null
    );
  } catch (err) {
    console.warn("[Hydra Webhook] Falha ao gravar auditoria de reação:", err?.message || err);
  }
}

/**
 * Envia reação 👀 para a mensagem recebida via Evolution API (Não-bloqueante e idempotente)
 */
async function sendReactionWhatsApp(remoteJid, messageId, emoji = "👀") {
  const cleanJid = String(remoteJid || "").trim();
  const cleanMsgId = String(messageId || "").trim();
  if (!cleanJid || !cleanMsgId) return { sucesso: false, erro: "Identificadores de mensagem ausentes" };

  // Idempotência estrita: se já reagiu com sucesso àquela mensagem, não duplica
  if (hasMessageBeenReacted(cleanMsgId)) {
    return { sucesso: true, skipped: true, motivo: "already_reacted" };
  }

  const endpoint = `${EVOLUTION_URL}/message/sendReaction/${INSTANCE}`;
  const payload = {
    key: {
      remoteJid: cleanJid,
      fromMe: false,
      id: cleanMsgId
    },
    reaction: emoji
  };

  const startTotal = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": "Hydra-Bot/1.0",
        "Content-Type": "application/json",
        "apikey": EVOLUTION_KEY
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });

    const statusHttp = response.status;
    const raw = await response.text();
    const duracaoMs = Date.now() - startTotal;
    const sucesso = response.ok;

    recordMessageReaction(cleanMsgId, cleanJid, emoji, statusHttp, sucesso, duracaoMs, raw, sucesso ? null : raw.slice(0, 300));
    return { sucesso, statusHttp, duracaoMs };
  } catch (err) {
    const duracaoMs = Date.now() - startTotal;
    const erroMsg = err?.name === "TimeoutError" ? "Timeout de 5s excedido" : (err?.message || String(err));
    recordMessageReaction(cleanMsgId, cleanJid, emoji, 0, false, duracaoMs, null, erroMsg);
    console.warn(`[Hydra Webhook] Falha não-bloqueante ao reagir com ${emoji} à mensagem ${cleanMsgId}:`, erroMsg);
    return { sucesso: false, erro: erroMsg };
  }
}

/**
 * Cliente HTTP Nativo Resiliente para Presence
 */
async function sendPresenceWhatsApp(phone, presence = "composing", delay = 4500) {
  try {
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone) return;

    await fetch(`${EVOLUTION_URL}/chat/sendPresence/${INSTANCE}`, {
      method: "POST",
      headers: {
        "User-Agent": "Hydra-Bot/1.0",
        "Content-Type": "application/json",
        "apikey": EVOLUTION_KEY
      },
      body: JSON.stringify({ number: cleanPhone, presence, delay }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    // Falha silenciosa de presence não interrompe o fluxo de mensagens
  }
}

/**
 * Gerenciador de Encavalamento de Mensagens (MessageBatcher)
 * Janela deslizante de 700ms por conversa com teto máximo de 2000ms.
 */
class MessageBatcher {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs ?? 700;
    this.maxWindowMs = options.maxWindowMs ?? 2000;
    this.db = options.db || null;
    this.activeBatches = new Map();
    this.seenMessageIds = new Set();

    if (this.db) {
      this.initBatchSchema(this.db);
    }
  }

  initBatchSchema(db) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hydra_message_batches (
          batch_id TEXT PRIMARY KEY,
          conversation_key TEXT NOT NULL,
          message_ids TEXT NOT NULL,
          combined_text TEXT NOT NULL,
          part_count INTEGER NOT NULL,
          status TEXT NOT NULL,
          first_received_at TEXT NOT NULL,
          closed_at TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS hydra_batch_messages (
          message_id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          text TEXT,
          media_type TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (err) {
      console.warn('[MessageBatcher] Falha ao inicializar schema de lotes:', err?.message || err);
    }
  }

  addMessage(part, evidence, onBatchReady) {
    if (this.seenMessageIds.has(part.messageId)) {
      return { isDuplicate: true, batchId: '' };
    }
    this.seenMessageIds.add(part.messageId);

    const key = part.conversationKey || String(part.messageId.split('@')[0] || part.messageId).replace(/\D/g, '') || 'default';
    const now = Date.now();

    let batch = this.activeBatches.get(key);

    if (!batch || batch.isClosed) {
      const batchId = `batch_${key}_${now}_${Math.random().toString(36).slice(2, 6)}`;
      batch = {
        batchId,
        conversationKey: key,
        messageIds: [part.messageId],
        originalTexts: part.text ? [part.text] : [],
        parts: [part],
        mediaEvidence: evidence ? [...evidence] : [],
        firstReceivedAt: now,
        lastReceivedAt: now,
        debounceTimer: null,
        maxCeilingTimer: null,
        isClosed: false,
        callback: onBatchReady
      };

      this.activeBatches.set(key, batch);

      batch.debounceTimer = setTimeout(() => {
        this.closeBatch(key);
      }, this.debounceMs);

      batch.maxCeilingTimer = setTimeout(() => {
        this.closeBatch(key);
      }, this.maxWindowMs);

      this.persistBatchState(batch, 'OPEN');
      return { isDuplicate: false, batchId };
    }

    batch.messageIds.push(part.messageId);
    if (part.text) {
      batch.originalTexts.push(part.text);
    }
    batch.parts.push(part);
    if (evidence) {
      batch.mediaEvidence.push(...evidence);
    }
    batch.lastReceivedAt = now;

    if (batch.debounceTimer) {
      clearTimeout(batch.debounceTimer);
    }

    const elapsed = now - batch.firstReceivedAt;
    const remainingToMax = this.maxWindowMs - elapsed;

    if (remainingToMax <= 0) {
      this.closeBatch(key);
    } else {
      const nextWindow = Math.min(this.debounceMs, remainingToMax);
      batch.debounceTimer = setTimeout(() => {
        this.closeBatch(key);
      }, nextWindow);
    }

    this.persistBatchState(batch, 'UPDATED');
    return { isDuplicate: false, batchId: batch.batchId };
  }

  closeBatch(conversationKey) {
    const batch = this.activeBatches.get(conversationKey);
    if (!batch || batch.isClosed) return null;

    batch.isClosed = true;
    if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
    if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    batch.debounceTimer = null;
    batch.maxCeilingTimer = null;

    this.activeBatches.delete(conversationKey);

    const combinedText = this.combineTexts(batch.originalTexts, batch.mediaEvidence);

    const payload = {
      batchId: batch.batchId,
      conversationKey: batch.conversationKey,
      messageIds: [...batch.messageIds],
      originalTexts: [...batch.originalTexts],
      parts: [...batch.parts],
      mediaEvidence: [...batch.mediaEvidence],
      combinedText,
      firstReceivedAt: batch.firstReceivedAt,
      lastReceivedAt: batch.lastReceivedAt,
      isClosed: true
    };

    this.persistBatchState(batch, 'CLOSED', combinedText);
    for (const mId of batch.messageIds) {
      recordLifecycleState(mId, 'batch_closed', batch.batchId);
    }

    Promise.resolve(batch.callback(payload)).catch(err => {
      console.error(`[MessageBatcher] Erro no processamento do lote #${batch.batchId}:`, err);
    });

    return payload;
  }

  combineTexts(texts, evidence = []) {
    const rawParts = [];

    for (const t of texts) {
      const clean = (t || '').trim();
      if (clean) rawParts.push(clean);
    }

    for (const ev of evidence) {
      if (ev.type === 'audio' && ev.transcription) {
        rawParts.push(ev.transcription.trim());
      }
    }

    if (rawParts.length === 0) return '';
    if (rawParts.length === 1) return rawParts[0];

    const lastPart = rawParts[rawParts.length - 1].toLowerCase();
    const isCorrection = 
      lastPart.startsWith('não,') || 
      lastPart.startsWith('nao,') || 
      lastPart.startsWith('esquece,') || 
      lastPart.startsWith('muda pra') ||
      lastPart.includes('não da ') ||
      lastPart.includes('nao da ') ||
      lastPart.includes(', não ');

    if (isCorrection) {
      const previous = rawParts.slice(0, -1).join(' ');
      const cleanLast = lastPart
        .replace(/^(não,|nao,|esquece,|muda pra)\s*/i, '')
        .trim();

      return `${previous} ${cleanLast}`;
    }

    return rawParts.join(' ');
  }

  persistBatchState(batch, status, combinedText) {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO hydra_message_batches (
          batch_id, conversation_key, message_ids, combined_text, part_count, status, first_received_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batch.batchId,
        batch.conversationKey,
        JSON.stringify(batch.messageIds),
        combinedText || batch.originalTexts.join(' '),
        batch.parts.length,
        status,
        new Date(batch.firstReceivedAt).toISOString(),
        batch.isClosed ? new Date().toISOString() : null
      );
    } catch {}
  }

  getMetrics() {
    return {
      activeBatchesCount: this.activeBatches.size
    };
  }

  destroy() {
    for (const [key, batch] of this.activeBatches.entries()) {
      if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
      if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    }
    this.activeBatches.clear();
  }
}

const messageBatcher = new MessageBatcher({ debounceMs: 700, maxWindowMs: 2000, db });

/**
 * Gerenciador Contínuo de Presença ("Digitando" com Heartbeat Renovável)
 */
class TypingManager {
  constructor(phone, intervalMs = 3500, delayMs = 4500, maxDurationMs = 65000) {
    this.phone = String(phone).replace(/\D/g, "");
    this.intervalMs = intervalMs;
    this.delayMs = delayMs;
    this.maxDurationMs = maxDurationMs;
    this.timer = null;
    this.maxTimer = null;
    this.active = false;
  }

  start() {
    if (this.active || !this.phone) return;
    this.active = true;

    // Dispara 'composing' imediatamente
    sendPresenceWhatsApp(this.phone, "composing", this.delayMs).catch(() => {});

    // Renova periodicamente antes do delay expirar no Baileys/Evolution
    this.timer = setInterval(() => {
      if (!this.active) return;
      sendPresenceWhatsApp(this.phone, "composing", this.delayMs).catch(() => {});
    }, this.intervalMs);

    // Teto de segurança para evitar qualquer timer órfão
    this.maxTimer = setTimeout(() => {
      this.stop().catch(() => {});
    }, this.maxDurationMs);
  }

  async stop() {
    if (!this.active) return;
    this.active = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }

    // Notifica encerramento explícito com 'paused'
    try {
      await sendPresenceWhatsApp(this.phone, "paused", 0);
    } catch {}
  }
}

/**
 * Envio Resiliente de Mensagens
 */
async function sendReplyWhatsApp(phone, text, maxRetries = 3) {
  const cleanPhone = String(phone).replace(/\D/g, "");
  const cleanText = sanitizeWhatsAppMarkdown(text);
  if (!cleanPhone || !cleanText) return { sucesso: false, erro: "Payload inválido" };

  const endpoint = `${EVOLUTION_URL}/message/sendText/${INSTANCE}`;
  const startTotal = Date.now();
  let lastStatus = 0;
  let lastError = null;
  let lastRaw = null;
  let capturedMsgId = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": "Hydra-Bot/1.0",
          "Content-Type": "application/json",
          "apikey": EVOLUTION_KEY
        },
        body: JSON.stringify({ number: cleanPhone, text: cleanText }),
        signal: AbortSignal.timeout(12000)
      });

      lastStatus = response.status;
      lastRaw = await response.text();

      try {
        const parsed = JSON.parse(lastRaw);
        capturedMsgId = parsed?.key?.id || parsed?.data?.key?.id || parsed?.id;
      } catch {}

      if (response.ok) {
        const duracaoMs = Date.now() - startTotal;
        logDelivery(cleanPhone, capturedMsgId, lastStatus, true, attempt, duracaoMs, lastRaw, null);
        return { sucesso: true, statusHttp: lastStatus, tentativas: attempt, duracaoMs, messageId: capturedMsgId };
      }

      // Falha 4xx de cliente não re-tenta
      if (lastStatus >= 400 && lastStatus < 429) {
        lastError = `HTTP ${lastStatus}: ${lastRaw.slice(0, 150)}`;
        break;
      }

      lastError = `HTTP ${lastStatus} Transitório: ${lastRaw.slice(0, 150)}`;
    } catch (err) {
      lastStatus = 0;
      lastError = err?.name === "TimeoutError" ? "Timeout de 12s excedido" : (err?.message || String(err));
    }

    if (attempt < maxRetries) {
      const backoff = 800 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(`[Hydra Webhook] Envio para ${cleanPhone} tentativa ${attempt}/${maxRetries} falhou (${lastError}). Backoff de ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  const duracaoMs = Date.now() - startTotal;
  logDelivery(cleanPhone, capturedMsgId, lastStatus, false, maxRetries, duracaoMs, lastRaw, lastError);
  console.error(`[Hydra Webhook] ❌ Falha definitiva no envio para ${cleanPhone}: ${lastError}`);
  return { sucesso: false, statusHttp: lastStatus, tentativas: maxRetries, duracaoMs, erro: lastError };
}

function extractDispatcherOutput(rawOutput) {
  const lines = rawOutput.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.messages || parsed.replyText) {
          return parsed;
        }
      } catch {}
    }
  }

  const match = rawOutput.match(/\{[\s\S]*"replyText"[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }

  throw new Error("Nenhum payload JSON reconhecido no output do dispatcher");
}

/**
 * Execução Assíncrona Não-Bloqueante do Dispatcher
 * Mantém o event loop livre para renovação pontual de presença e tratamento concorrente
 */
function runDispatcherAsync(phone, text, conversationId, messageId, batch) {
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        phone,
        message: text,
        conversationId: conversationId || undefined,
        messageId: messageId || undefined,
        batch: batch || undefined
      });

      execFile(
        "/usr/bin/node",
        ["/opt/bots/node_modules/tsx/dist/cli.mjs", "/opt/bots/src/hydra-sync/agent_dispatcher_cli.ts", payload],
        { timeout: 60000, encoding: "utf-8", cwd: "/opt/bots", maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            console.error("[Hydra Webhook] Erro no dispatcher:", error?.message || error, stderr);
            return resolve(["Não consegui consultar os dados agora devido a uma oscilação na conexão com o banco. Pode tentar novamente em instantes?"]);
          }

          try {
            const parsed = extractDispatcherOutput(stdout);
            if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
              return resolve(parsed.messages.map(m => sanitizeWhatsAppMarkdown(m)));
            }
            if (parsed.replyText) {
              return resolve([sanitizeWhatsAppMarkdown(parsed.replyText)]);
            }
            return resolve(["Não foi possível formular uma resposta."]);
          } catch (parseErr) {
            console.error("[Hydra Webhook] Erro ao parsear dispatcher output:", parseErr?.message || parseErr);
            return resolve(["Não consegui processar a resposta dos dados. Pode tentar novamente?"]);
          }
        }
      );
    } catch (err) {
      console.error("[Hydra Webhook] Falha ao invocar dispatcher:", err?.message || err);
      resolve(["Não consegui formular uma resposta no momento."]);
    }
  });
}

/**
 * Envio Sequencial dos Balões:
 * 1. O primeiro balão é despachado IMEDIATAMENTE (sem espera artificial de digitação, pois a presença já refletiu o trabalho real).
 * 2. Balões seguintes respeitam pequeno espaçamento de segurança (200ms) para preservar a ordem no WhatsApp.
 */
async function sendSequentialReplies(phone, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;

  for (let i = 0; i < messages.length; i++) {
    const text = messages[i];
    if (text && text.trim() !== "") {
      // Espaçamento mínimo apenas entre balões subsequentes para garantir ordenação estrita
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }
      await sendReplyWhatsApp(phone, text);
    }
  }
}

// ─── Filas Per-Chat Desacopladas (Isolamento entre conversas e ordem estrita FIFO) ───
const chatQueues = new Map(); // phone -> { queue: Job[], isProcessing: boolean, typing: TypingManager }

function getOrCreateChatQueue(phone) {
  if (!chatQueues.has(phone)) {
    chatQueues.set(phone, {
      queue: [],
      isProcessing: false,
      typing: new TypingManager(phone)
    });
  }
  return chatQueues.get(phone);
}

function getTotalQueueMetrics() {
  let totalPending = 0;
  let activeChats = 0;
  for (const chatQ of chatQueues.values()) {
    totalPending += chatQ.queue.length;
    if (chatQ.isProcessing) activeChats++;
  }
  return {
    queueSize: totalPending,
    activeChats,
    isProcessing: activeChats > 0
  };
}

async function processChatQueue(phone) {
  const chatQ = getOrCreateChatQueue(phone);
  if (chatQ.isProcessing) return;
  chatQ.isProcessing = true;

  try {
    while (chatQ.queue.length > 0) {
      const job = chatQ.queue.shift();
      if (!job) break;

      const timeStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      console.log(`[${timeStr}] 📩 [AsyncQueue] Processando job #${job.messageId} de ${job.phone}: "${job.text}"`);

      const targetMsgIds = job.messageIds && job.messageIds.length > 0 ? job.messageIds : [job.messageId];
      for (const mId of targetMsgIds) {
        recordLifecycleState(mId, 'job_processing', job.batch?.batchId);
      }

      // Inicia "digitando" contínuo exatamente quando a conversa chega à sua vez de execução
      chatQ.typing.start();

      try {
        const replies = await runDispatcherAsync(job.phone, job.text, job.conversationId, job.messageId, job.batch);

        // Encerra imediatamente o "digitando" antes de iniciar a entrega do primeiro balão
        await chatQ.typing.stop();

        for (const mId of targetMsgIds) {
          recordLifecycleState(mId, 'job_processed', job.batch?.batchId, `${replies.length} replies`);
        }

        console.log(`  ↳ [AsyncQueue] Despachando ${replies.length} balão(ões) para ${job.phone}...`);
        await sendSequentialReplies(job.phone, replies);
        console.log(`  ✓ [AsyncQueue] Envio concluído e auditado para ${job.phone}.`);

        for (const mId of targetMsgIds) {
          recordLifecycleState(mId, 'whatsapp_sent', job.batch?.batchId);
        }
      } catch (jobErr) {
        console.error(`[AsyncQueue] Erro ao processar job #${job.messageId}:`, jobErr);
        await chatQ.typing.stop();
        for (const mId of targetMsgIds) {
          recordLifecycleState(mId, 'job_failed', job.batch?.batchId, jobErr?.message);
        }
        await sendReplyWhatsApp(job.phone, "Ocorreu uma instabilidade momentânea ao processar sua mensagem. Por favor, tente novamente.");
      }
    }
  } finally {
    chatQ.isProcessing = false;
    await chatQ.typing.stop();
  }
}

function enqueueJob(job) {
  const chatQ = getOrCreateChatQueue(job.phone);
  chatQ.queue.push(job);
  setImmediate(() => processChatQueue(job.phone));
}

function computeHydraHealthMetrics(database) {
  const timestamp = new Date().toISOString();
  let crawlers = [];
  let metasData = {
    dataReferenciaMaisRecente: null,
    idadeEmHoras: 999,
    lojasCompletas: 0,
    frescor: "CRITICAL"
  };
  let indiceVetorial = {
    totalVetores: 0,
    totalOSsAbertas: 0,
    coberturaPct: 100
  };
  let watchdogQueue = {
    pendentes: 0,
    processando: 0,
    falhas: 0
  };
  let telemetriaIA = {
    totalChamadas24h: 0,
    taxaSucessoPct: 100,
    timeouts: 0,
    indisponibilidades: 0,
    respostasInvalidas: 0,
    slopFallbacks: 0,
    duracaoMediaMs: 0
  };
  let enviosWhatsApp = {
    totalEnvios24h: 0,
    taxaEntregaConfirmadaPct: 100,
    falhasHttp: 0,
    mediaTentativasPorEnvio: 1.0
  };

  if (database) {
    try {
      const rows = database.prepare(`
        SELECT loja_slug, tipo_crawl as tipo, fim_em as ultimaExecucao, status, duracao_ms as duracaoMs, total_registros as registros
        FROM crawls_execucoes
        ORDER BY id DESC
        LIMIT 10
      `).all();
      crawlers = rows.map(r => ({
        loja_slug: r.loja_slug || "GERAL",
        tipo: r.tipo || "PATIO",
        ultimaExecucao: r.ultimaExecucao || null,
        status: r.status || "SUCCESS",
        duracaoMs: Number(r.duracaoMs || 0),
        registros: Number(r.registros || 0)
      }));
    } catch {}

    try {
      const row = database.prepare(`
        SELECT data_referencia, MAX(created_at) as max_created, posicao_hora
        FROM metas_diarias
        WHERE data_referencia = (SELECT MAX(data_referencia) FROM metas_diarias)
        GROUP BY data_referencia
      `).get();

      if (row && row.data_referencia) {
        metasData.dataReferenciaMaisRecente = row.data_referencia;
        const dtCreated = new Date(row.max_created?.includes("T") ? row.max_created : `${row.max_created?.replace(" ", "T") || `${row.data_referencia}T12:00:00`}Z`);
        const agora = new Date();
        const diffMs = agora.getTime() - dtCreated.getTime();
        metasData.idadeEmHoras = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));

        const lojasRow = database.prepare(`
          SELECT COUNT(DISTINCT loja_slug) as c FROM metas_diarias WHERE data_referencia = ?
        `).get(row.data_referencia);
        metasData.lojasCompletas = lojasRow?.c || 0;

        if (metasData.idadeEmHoras > 36) {
          metasData.frescor = "CRITICAL";
        } else if (metasData.idadeEmHoras > 26) {
          metasData.frescor = "STALE";
        } else {
          metasData.frescor = "FRESH";
        }
      }
    } catch {}

    try {
      const osRow = database.prepare("SELECT COUNT(*) as c FROM ordens_servico WHERE is_aberta = 1").get();
      indiceVetorial.totalOSsAbertas = osRow?.c || 0;

      let vecCount = 0;
      try {
        const vRow = database.prepare("SELECT COUNT(*) as c FROM vec_ordens_servico").get();
        vecCount = vRow?.c || 0;
      } catch {}
      indiceVetorial.totalVetores = vecCount;
      if (indiceVetorial.totalOSsAbertas > 0) {
        indiceVetorial.coberturaPct = Math.min(100, Math.round((vecCount / indiceVetorial.totalOSsAbertas) * 100));
      } else {
        indiceVetorial.coberturaPct = 100;
      }
    } catch {}

    try {
      const aiRow = database.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as sucessos,
          SUM(CASE WHEN status = 'TIMEOUT' THEN 1 ELSE 0 END) as timeouts,
          SUM(CASE WHEN status = 'UNAVAILABLE' THEN 1 ELSE 0 END) as indisponibilidades,
          SUM(CASE WHEN status = 'INVALID_RESPONSE' THEN 1 ELSE 0 END) as respostasInvalidas,
          SUM(CASE WHEN status = 'SLOP_FALLBACK' THEN 1 ELSE 0 END) as slopFallbacks,
          AVG(duracao_ms) as mediaDuracao
        FROM ai_briefing_telemetry
        WHERE created_at > datetime('now', '-24 hours')
      `).get();

      if (aiRow && aiRow.total > 0) {
        telemetriaIA.totalChamadas24h = aiRow.total;
        telemetriaIA.taxaSucessoPct = Math.round(((aiRow.sucessos || 0) / aiRow.total) * 100);
        telemetriaIA.timeouts = aiRow.timeouts || 0;
        telemetriaIA.indisponibilidades = aiRow.indisponibilidades || 0;
        telemetriaIA.respostasInvalidas = aiRow.respostasInvalidas || 0;
        telemetriaIA.slopFallbacks = aiRow.slopFallbacks || 0;
        telemetriaIA.duracaoMediaMs = Math.round(aiRow.mediaDuracao || 0);
      }
    } catch {}

    try {
      const waRow = database.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN sucesso = 1 THEN 1 ELSE 0 END) as sucessos,
          SUM(CASE WHEN sucesso = 0 OR (status_http IS NOT NULL AND (status_http < 200 OR status_http >= 300)) THEN 1 ELSE 0 END) as falhas,
          AVG(tentativas) as mediaTentativas
        FROM whatsapp_delivery_logs
        WHERE created_at > datetime('now', '-24 hours')
      `).get();

      if (waRow && waRow.total > 0) {
        enviosWhatsApp.totalEnvios24h = waRow.total;
        enviosWhatsApp.taxaEntregaConfirmadaPct = Math.round(((waRow.sucessos || 0) / waRow.total) * 100);
        enviosWhatsApp.falhasHttp = waRow.falhas || 0;
        enviosWhatsApp.mediaTentativasPorEnvio = Number((waRow.mediaTentativas || 1).toFixed(2));
      }
    } catch {}
  }

  let statusGeral = "HEALTHY";
  const hasCriticalCrawl = crawlers.some(c => c.status === "ERROR");
  if (metasData.frescor === "CRITICAL" || enviosWhatsApp.taxaEntregaConfirmadaPct < 80) {
    statusGeral = "UNHEALTHY";
  } else if (
    metasData.frescor === "STALE" || 
    hasCriticalCrawl || 
    indiceVetorial.coberturaPct < 80 || 
    telemetriaIA.taxaSucessoPct < 90
  ) {
    statusGeral = "DEGRADED";
  }

  return {
    timestamp,
    statusGeral,
    crawlers,
    metas: metasData,
    indiceVetorial,
    watchdogQueue,
    telemetriaIA,
    enviosWhatsApp
  };
}

/**
 * Processamento Centralizado de Mensagens do Webhook (Testável e desacoplado)
 */
async function handleIncomingPayload(payload) {
  // 1. Proteção Anti-Loop: Ignora mensagens enviadas pelo próprio bot, updates e status@broadcast
  if (
    payload?.data?.key?.fromMe === true ||
    payload?.message_type === "outgoing" ||
    payload?.event === "messages.update" ||
    payload?.data?.key?.remoteJid === "status@broadcast"
  ) {
    return { statusCode: 200, body: { status: "ignored_outgoing_or_status" } };
  }

  // 2. Extração de Remetente (Suporte a Evolution API, WhatsApp LID e Chatwoot Webhook)
  const rawRemoteJid = String(payload?.data?.key?.remoteJid || "").trim();
  const remoteJidAlt = String(payload?.data?.key?.remoteJidAlt || "").trim();
  const participant = String(payload?.data?.key?.participant || "").trim();
  const senderPhone = String(payload?.sender?.phone_number || payload?.sender || "").trim();

  let rawPhone = "";
  if (remoteJidAlt.includes("@s.whatsapp.net")) {
    rawPhone = remoteJidAlt;
  } else if (participant.includes("@s.whatsapp.net")) {
    rawPhone = participant;
  } else if (senderPhone.includes("@s.whatsapp.net")) {
    rawPhone = senderPhone;
  } else if (rawRemoteJid && !rawRemoteJid.endsWith("@lid")) {
    rawPhone = rawRemoteJid;
  } else {
    rawPhone = remoteJidAlt || senderPhone || rawRemoteJid;
  }

  const phone = String(rawPhone).replace("@s.whatsapp.net", "").replace(/\D/g, "");

  if (!phone) {
    return { statusCode: 200, body: { status: "no_phone" } };
  }

  // 3. Validação de Whitelist Rígida (Somente números autorizados)
  if (!WHITELIST.has(phone)) {
    return { statusCode: 200, body: { status: "ignored_non_whitelist" } };
  }

  // 4. Extração de Conteúdo da Mensagem
  const text = (
    payload?.data?.message?.conversation ||
    payload?.data?.message?.extendedTextMessage?.text ||
    payload?.content ||
    ""
  ).trim();

  if (!text) {
    return { statusCode: 200, body: { status: "empty_text" } };
  }

  // 5. Identificação e Deduplicação Persistente em SQLite (Idempotência de Webhook)
  const rawMessageId = payload?.data?.key?.id || payload?.id;
  const messageId = String(rawMessageId || `${phone}_${Date.now()}`);

  if (isMessageProcessed(messageId)) {
    console.log(`[Hydra Webhook] 🔁 Mensagem duplicada ignorada: ${messageId} de ${phone}`);
    return { statusCode: 200, body: { status: "ignored_duplicate", messageId } };
  }

  // Marca imediatamente no SQLite para travar requisições concorrentes idênticas
  markMessageProcessed(messageId, phone);

  // 6. Confirmação Rápida de Recebimento via Reação 👀 vinculada ao messageId
  // Reage apenas a mensagens válidas de entrada com ID real da Evolution
  if (rawMessageId && !hasMessageBeenReacted(messageId)) {
    const targetJid = payload?.data?.key?.remoteJid || (rawRemoteJid.includes("@") ? rawRemoteJid : `${phone}@s.whatsapp.net`);
    // Dispara a reação de forma não-bloqueante; falha de reação não impede a resposta
    sendReactionWhatsApp(targetJid, messageId, "👀").catch(() => {});
  }

  const conversationId = payload?.conversation?.id;
  const chatQ = getOrCreateChatQueue(phone);
  const messageObj = payload?.data?.message;

  let mediaType = "text";
  if (messageObj?.audioMessage) mediaType = "audio";
  else if (messageObj?.imageMessage) mediaType = "image";
  else if (messageObj?.videoMessage) mediaType = "video";
  else if (messageObj?.documentMessage) mediaType = "document";

  const part = {
    partId: `part_${messageId}`,
    messageId,
    conversationKey: phone,
    kind: mediaType,
    type: mediaType,
    receivedAt: new Date().toISOString(),
    text,
    timestamp: Date.now()
  };

  // 6.1 Registro de estado de aceite no ciclo de vida
  recordLifecycleState(messageId, 'hydra_accepted', null);

  // 7. Adiciona à janela de encavalamento (debounce deslizante de 700ms por conversa)
  const batchRes = messageBatcher.addMessage(part, undefined, async (batch) => {
    // Quando o lote fecha (700ms de silêncio ou teto máximo de 2000ms):
    enqueueJob({
      phone,
      text: batch.combinedText,
      messageId: batch.batchId,
      messageIds: batch.messageIds,
      conversationId,
      batch,
      recebidoEm: batch.firstReceivedAt
    });
  });

  // 8. Resposta imediata (<15ms) desacoplando o recebimento do processamento
  return {
    statusCode: 200,
    body: {
      status: "queued",
      messageId,
      batchId: batchRes.batchId,
      isBatching: true,
      queuePosition: chatQ.queue.length
    }
  };
}

// ─── Servidor HTTP Ingress ───────────────────────────────────────────────────
const server = createServer((req, res) => {
  // Rota de Health Check Operacional
  if (req.method === "GET" && (req.url === "/health" || req.url === "/status")) {
    const healthSnapshot = computeHydraHealthMetrics(db);
    const qMetrics = getTotalQueueMetrics();
    const healthData = {
      ...healthSnapshot,
      listener: {
        status: "online",
        uptime: process.uptime(),
        queueSize: qMetrics.queueSize,
        activeChats: qMetrics.activeChats,
        isProcessing: qMetrics.isProcessing
      }
    };

    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(healthData, null, 2));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  let body = "";
  req.on("data", c => body += c);
  req.on("end", async () => {
    try {
      if (!body || body.trim() === "") {
        res.writeHead(200, { "Content-Type": "text/plain" }).end("empty_body");
        return;
      }

      const payload = JSON.parse(body);
      const result = await handleIncomingPayload(payload);
      res.writeHead(result.statusCode || 200, { "Content-Type": "application/json" }).end(JSON.stringify(result.body));
    } catch (err) {
      console.error("[Hydra Webhook] Erro no processamento do payload:", err);
      res.writeHead(500, { "Content-Type": "text/plain" }).end("internal_error");
    }
  });
});

server.listen(3333, () => {
  console.log("🐙 Hydra Webhook Listener v3 ativo na porta 3333");
  console.log("  ↳ Ingress Desacoplado (<15ms) | Cliente HTTP Nativo Resiliente | Deduplicação SQLite WAL | Rota /health");
}).on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.warn("[Hydra Webhook] Porta 3333 já em uso.");
  } else {
    console.error("[Hydra Webhook] Erro no servidor HTTP:", err);
  }
});

export {
  server,
  TypingManager,
  sendReactionWhatsApp,
  sendPresenceWhatsApp,
  sendReplyWhatsApp,
  runDispatcherAsync,
  sendSequentialReplies,
  handleIncomingPayload,
  chatQueues,
  isMessageProcessed,
  markMessageProcessed,
  hasMessageBeenReacted,
  recordMessageReaction,
  recordLifecycleState,
  sanitizeWhatsAppMarkdown,
  getTotalQueueMetrics,
  MessageBatcher,
  messageBatcher
};
