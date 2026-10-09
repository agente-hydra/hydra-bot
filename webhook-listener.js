import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from "http";
import { execFile } from "child_process";
import { createRequire } from "module";
import { isDeterministicCommand, interceptCommand, InFlightAbortRegistry, STORE_COMMANDS } from "./src/hydra-sync/command_interceptor.js";
import { composeSemanticBalloons } from "./src/hydra-sync/balloon_composer.js";
import {
  authenticateWebhookRequest,
  resolveCanonicalIdentity,
  revalidateAuthorization,
  recordSecurityRejection,
  maskPhone,
  maskJid
} from "./src/hydra-sync/identity_access_guard.js";
import { initHydraAccessAndMemorySchema } from "./src/hydra-sync/db_repository.js";

const require = createRequire(import.meta.url);
const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

// Conexão direta com SQLite WAL operacional
let db = null;
try {
  const Database = require("better-sqlite3");
  db = new Database("/home/operacional/hydra-data/hydra_ops.db");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  try {
    const sqliteVec = require("sqlite-vec");
    if (typeof sqliteVec.load === "function") {
      sqliteVec.load(db);
    }
  } catch (vecErr) {
    console.warn("[Hydra Webhook] Falha ao carregar extensão sqlite-vec:", vecErr?.message || vecErr);
  }
  console.log("[Hydra Webhook] Conectado ao SQLite WAL: /home/operacional/hydra-data/hydra_ops.db");
  if (db) {
    try {
      initHydraAccessAndMemorySchema(db);
    } catch (e) {
      console.warn("[Hydra Webhook] Erro ao inicializar schema:", e?.message || e);
    }
  }

  // Inicialização idempotente das tabelas de auditoria, ciclo de vida e deduplicação
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
    CREATE INDEX IF NOT EXISTS idx_lifecycle_state ON message_lifecycle(state);
  `);

  // Migração/inicialização idempotente de message_reactions com PK composta (message_id, reaction) e coluna state
  try {
    const tableInfo = db.prepare("PRAGMA table_info(message_reactions)").all();
    if (tableInfo.length === 0) {
      db.exec(`
        CREATE TABLE message_reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          reaction TEXT NOT NULL,
          remote_jid TEXT NOT NULL,
          phone TEXT,
          state TEXT NOT NULL,
          status_http INTEGER,
          sucesso INTEGER NOT NULL,
          duracao_ms INTEGER,
          resposta_raw TEXT,
          erro TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, reaction)
        );
        CREATE INDEX IF NOT EXISTS idx_reactions_msg_id ON message_reactions(message_id);
        CREATE INDEX IF NOT EXISTS idx_reactions_state ON message_reactions(message_id, state);
      `);
    } else {
      const hasStateCol = tableInfo.some(c => c.name === "state");
      const pkCols = tableInfo.filter(c => c.pk > 0);
      const isOldPk = pkCols.length === 1 && pkCols[0].name === "message_id";

      if (!hasStateCol || isOldPk) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS message_reactions_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            reaction TEXT NOT NULL,
            remote_jid TEXT NOT NULL,
            phone TEXT,
            state TEXT NOT NULL,
            status_http INTEGER,
            sucesso INTEGER NOT NULL,
            duracao_ms INTEGER,
            resposta_raw TEXT,
            erro TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, reaction)
          );

          INSERT OR IGNORE INTO message_reactions_v2 (
            message_id, reaction, remote_jid, phone, state, status_http, sucesso, duracao_ms, resposta_raw, erro, created_at
          )
          SELECT 
            message_id, 
            reaction, 
            remote_jid, 
            phone, 
            CASE 
              WHEN reaction = '👀' THEN 'SENT_SEEN'
              WHEN reaction = '✅' THEN 'SENT_COMPLETED'
              WHEN reaction = '❌' THEN 'SENT_FAILED'
              ELSE 'SENT_' || reaction
            END as state,
            status_http, sucesso, duracao_ms, resposta_raw, erro, created_at
          FROM message_reactions;

          DROP TABLE message_reactions;
          ALTER TABLE message_reactions_v2 RENAME TO message_reactions;
          CREATE INDEX IF NOT EXISTS idx_reactions_msg_id ON message_reactions(message_id);
          CREATE INDEX IF NOT EXISTS idx_reactions_state ON message_reactions(message_id, state);
        `);
        console.log("[Hydra Webhook] Tabela message_reactions migrada com sucesso para PK composta e transição de estado");
      }
    }
  } catch (migErr) {
    console.warn("[Hydra Webhook] Aviso ao verificar schema de message_reactions:", migErr?.message || migErr);
  }
} catch (err) {
  console.error("[Hydra Webhook] ⚠️ Alerta: Falha ao abrir conexão direta com SQLite:", err?.message || err);
}

const EVOLUTION_URL = process.env.EVOLUTION_URL || "https://evo.tork.services";
const EVOLUTION_KEY = process.env.EVOLUTION_KEY || '';
const INSTANCE = process.env.EVOLUTION_INSTANCE || "hydra";

// 1. Whitelist estrita: somente Davi e Marcos
const WHITELIST = new Set([
  "5511996242812",
  "5511970671717"
]);

/**
 * Mascara telefone para conformidade com privacidade (ex: 5511996242812 -> 5511*****2812)
 */
/* maskPhone imported from identity_access_guard */

/**
 * Mascara Remote JID mantendo integridade do domínio WhatsApp (ex: 271077481652389@lid -> 2710*******2389@lid)
 */
/* maskJid imported from identity_access_guard */

/**
 * Sanitiza detalhes para gravação no SQLite, proibindo texto completo e credenciais
 */
function sanitizeLogDetails(details) {
  if (!details) return null;
  let str = typeof details === "object" ? JSON.stringify(details) : String(details);
  // Remove credenciais e chaves
  str = str.replace(/TorkEvoApiKey\w*/gi, "[REDACTED_KEY]");
  str = str.replace(/apikey\s*[:=]\s*["']?[^"',\s]+["']?/gi, 'apikey:"[REDACTED]"');
  str = str.replace(/Bearer\s+[\w\.-]+/gi, "Bearer [REDACTED]");
  // Trunca para evitar texto completo
  return str.slice(0, 300);
}

/**
 * Auditoria determinística dos marcos do ciclo de vida no SQLite (message_lifecycle)
 * Marcos: accepted, batch_closed, generating, sent_whatsapp, delivered, failed
 */
function recordLifecycle(messageId, state, batchId = null, details = null) {
  if (!messageId || !db) return;
  try {
    const cleanDetails = sanitizeLogDetails(details);
    db.prepare(`
      INSERT INTO message_lifecycle (message_id, batch_id, state, details)
      VALUES (?, ?, ?, ?)
    `).run(
      messageId,
      batchId || null,
      state,
      cleanDetails
    );
  } catch (err) {
    console.warn(`[Lifecycle] Falha ao registrar marco '${state}' para #${messageId}:`, err?.message || err);
  }
}

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

function getReactionState(emoji) {
  if (emoji === "👀") return "SENT_SEEN";
  if (emoji === "✅") return "SENT_COMPLETED";
  if (emoji === "❌") return "SENT_FAILED";
  return `SENT_${emoji}`;
}

/**
 * Idempotência flexível: verifica se a mensagem já recebeu a reação especificada com sucesso
 */
function hasMessageBeenReacted(messageId, reaction = "👀") {
  if (!messageId || !db) return false;
  try {
    const row = db.prepare(
      "SELECT 1 FROM message_reactions WHERE message_id = ? AND reaction = ? AND sucesso = 1"
    ).get(messageId, reaction);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Retorna o estado atual da reação da mensagem (ex: 'SENT_SEEN', 'SENT_COMPLETED', 'SENT_FAILED')
 */
function getMessageReactionState(messageId) {
  if (!messageId || !db) return null;
  try {
    const row = db.prepare(
      "SELECT state FROM message_reactions WHERE message_id = ? AND sucesso = 1 ORDER BY id DESC LIMIT 1"
    ).get(messageId);
    return row?.state || null;
  } catch {
    return null;
  }
}

function recordMessageReaction(messageId, remoteJid, reaction, statusHttp, sucesso, duracaoMs, respostaRaw, erro, customState = null) {
  if (!messageId || !db) return;
  try {
    const rawJid = String(remoteJid || "");
    const phone = rawJid.replace("@s.whatsapp.net", "").replace(/@lid$/, "").replace(/\D/g, "");
    const state = customState || getReactionState(reaction);

    db.prepare(`
      INSERT INTO message_reactions (
        message_id, reaction, remote_jid, phone, state, status_http, sucesso, duracao_ms, resposta_raw, erro
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, reaction) DO UPDATE SET
        remote_jid = excluded.remote_jid,
        phone = excluded.phone,
        state = excluded.state,
        status_http = excluded.status_http,
        sucesso = excluded.sucesso,
        duracao_ms = excluded.duracao_ms,
        resposta_raw = excluded.resposta_raw,
        erro = excluded.erro,
        created_at = CURRENT_TIMESTAMP
    `).run(
      messageId,
      reaction,
      rawJid,
      phone,
      state,
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
 * Envia reação (👀, ✅ ou ❌) para a mensagem recebida via Evolution API.
 * Preserva remoteJid nativo (incluindo @lid), é não-bloqueante e idempotente.
 */
async function sendReactionWhatsApp(remoteJid, messageId, emoji = "👀") {
  const cleanJid = String(remoteJid || "").trim();
  const cleanMsgId = String(messageId || "").trim();
  if (!cleanJid || !cleanMsgId) return { sucesso: false, erro: "Identificadores de mensagem ausentes" };

  // Idempotência estrita por (messageId, emoji): se já reagiu com sucesso àquela mensagem com esse emoji, não duplica
  if (hasMessageBeenReacted(cleanMsgId, emoji)) {
    return { sucesso: true, skipped: true, motivo: "already_reacted", reaction: emoji };
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
    return { sucesso, statusHttp, duracaoMs, reaction: emoji };
  } catch (err) {
    const duracaoMs = Date.now() - startTotal;
    const erroMsg = err?.name === "TimeoutError" ? "Timeout de 5s excedido" : (err?.message || String(err));
    recordMessageReaction(cleanMsgId, cleanJid, emoji, 0, false, duracaoMs, null, erroMsg);
    console.warn(`[Hydra Webhook] Falha não-bloqueante ao reagir com ${emoji} à mensagem ${cleanMsgId}:`, erroMsg);
    return { sucesso: false, erro: erroMsg, reaction: emoji };
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
    const envDebounce = process.env.HYDRA_BATCH_DEBOUNCE_MS ? parseInt(process.env.HYDRA_BATCH_DEBOUNCE_MS, 10) : undefined;
    const envMax = process.env.HYDRA_BATCH_MAX_WINDOW_MS ? parseInt(process.env.HYDRA_BATCH_MAX_WINDOW_MS, 10) : undefined;

    this.debounceMs = options.debounceMs ?? (envDebounce !== undefined && !isNaN(envDebounce) ? envDebounce : 1500);
    this.maxWindowMs = options.maxWindowMs ?? (envMax !== undefined && !isNaN(envMax) ? envMax : 5000);
    this.db = options.db || null;
    this.activeBatches = new Map();
    this.seenMessageIds = new Set();
    this.inFlightGenerations = new Map();
    this.obsoleteBatchIds = new Set();

    if (this.db) {
      this.initBatchSchema(this.db);
    }
  }

  getDebounceMs() {
    return this.debounceMs;
  }

  getMaxWindowMs() {
    return this.maxWindowMs;
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

  markInFlight(conversationKey, batch) {
    if (!conversationKey || !batch) return;
    this.inFlightGenerations.set(conversationKey, {
      batchId: batch.batchId,
      batch,
      isObsolete: false,
      startedAt: Date.now()
    });
  }

  clearInFlight(conversationKey, batchId) {
    if (!conversationKey) return;
    const current = this.inFlightGenerations.get(conversationKey);
    if (!current) return;
    if (!batchId || current.batchId === batchId) {
      this.inFlightGenerations.delete(conversationKey);
    }
  }

  isInFlight(conversationKey) {
    return this.inFlightGenerations.has(conversationKey);
  }

  getInFlight(conversationKey) {
    return this.inFlightGenerations.get(conversationKey);
  }

  markBatchObsolete(batchId) {
    if (!batchId) return;
    this.obsoleteBatchIds.add(batchId);
    for (const inFlight of this.inFlightGenerations.values()) {
      if (inFlight.batchId === batchId) {
        inFlight.isObsolete = true;
      }
    }
  }

  isBatchObsolete(batchId) {
    if (!batchId) return false;
    if (this.obsoleteBatchIds.has(batchId)) return true;
    for (const inFlight of this.inFlightGenerations.values()) {
      if (inFlight.batchId === batchId && inFlight.isObsolete) {
        return true;
      }
    }
    return false;
  }

  hasActiveBatch(conversationKey) {
    return this.activeBatches.has(conversationKey);
  }

  addMessage(part, evidence, onBatchReady) {
    if (this.seenMessageIds.has(part.messageId)) {
      return { isDuplicate: true, batchId: '' };
    }
    this.seenMessageIds.add(part.messageId);

    const key = part.conversationKey || String(part.messageId.split('@')[0] || part.messageId).replace(/\D/g, '') || 'default';
    const now = Date.now();

    let inFlightBaseBatch = undefined;
    const currentInFlight = this.inFlightGenerations.get(key);
    if (currentInFlight) {
      currentInFlight.isObsolete = true;
      this.obsoleteBatchIds.add(currentInFlight.batchId);
      inFlightBaseBatch = currentInFlight.batch;
    }

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
        callback: onBatchReady,
        inFlightBaseBatch
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
    batch.callback = onBatchReady;
    if (inFlightBaseBatch && !batch.inFlightBaseBatch) {
      batch.inFlightBaseBatch = inFlightBaseBatch;
    }

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

    let combinedText;
    let finalMessageIds = [...batch.messageIds];
    let finalParts = [...batch.parts];
    let finalEvidence = [...batch.mediaEvidence];
    let isComplement = false;
    let supersededBatchId = undefined;

    if (batch.inFlightBaseBatch) {
      isComplement = true;
      supersededBatchId = batch.inFlightBaseBatch.batchId;
      combinedText = this.combineTexts(
        [batch.inFlightBaseBatch.combinedText, ...batch.originalTexts],
        [...batch.inFlightBaseBatch.mediaEvidence, ...batch.mediaEvidence]
      );
      finalMessageIds = Array.from(new Set([...batch.inFlightBaseBatch.messageIds, ...batch.messageIds]));
      finalParts = [...batch.inFlightBaseBatch.parts, ...batch.parts];
      finalEvidence = [...batch.inFlightBaseBatch.mediaEvidence, ...batch.mediaEvidence];
    } else {
      combinedText = this.combineTexts(batch.originalTexts, batch.mediaEvidence);
    }

    const payload = {
      batchId: batch.batchId,
      conversationKey: batch.conversationKey,
      messageIds: finalMessageIds,
      originalTexts: [...batch.originalTexts],
      parts: finalParts,
      mediaEvidence: finalEvidence,
      combinedText,
      firstReceivedAt: batch.firstReceivedAt,
      lastReceivedAt: batch.lastReceivedAt,
      isClosed: true,
      isComplement,
      supersededBatchId
    };

    this.persistBatchState(batch, 'CLOSED', combinedText);

    if (typeof batch.callback === "function") {
      Promise.resolve(batch.callback(payload)).catch(err => {
      console.error(`[MessageBatcher] Erro no processamento do lote #${batch.batchId}:`, err);
      });
    }

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

    const lastPart = rawParts[rawParts.length - 1];
    const lastPartNorm = lastPart.toLowerCase().trim();
    const isCorrection = 
      lastPartNorm.startsWith('não,') || 
      lastPartNorm.startsWith('nao,') || 
      lastPartNorm.startsWith('esquece,') || 
      lastPartNorm.startsWith('muda pra') ||
      lastPartNorm.startsWith('troca pra') ||
      lastPartNorm.includes('não da ') ||
      lastPartNorm.includes('nao da ') ||
      lastPartNorm.includes('não de ') ||
      lastPartNorm.includes('nao de ') ||
      lastPartNorm.includes(', não ') ||
      lastPartNorm.includes(', nao ');

    if (isCorrection) {
      const cleanLast = lastPart
        .replace(/^(não,|nao,|esquece,|muda pra|troca pra)\s*/i, '')
        .trim();

      const storeAliases = [
        'jorge beretta', 'jorge', 'beretta',
        'santo andre', 'santo andré', 'sto andre',
        'dom pedro i', 'dom pedro 1', 'dom pedro',
        'piraporinha', 'pirapora',
        'jabaquara', 'jaba',
        'rudge ramos', 'rudge',
        'kennedy',
        'planalto',
        'rei do oleo maua', 'rei do oleo', 'oleo maua', 'maua',
        'rei do modulo', 'rei modulo', 'modulo',
        'master'
      ];

      let previous = rawParts.slice(0, -1).join(' ');
      for (const alias of storeAliases) {
        previous = previous.replace(new RegExp(`\\b(da|do|de|na|no|em)?\\s*${alias}\\b`, 'gi'), '');
      }
      previous = previous.trim().replace(/\s+/g, ' ');

      if (cleanLast.toLowerCase().includes('da rede') || cleanLast.toLowerCase().includes('na rede') || cleanLast.toLowerCase().includes('das lojas')) {
        return `${previous} ${cleanLast}`.trim().replace(/\s+/g, ' ');
      }

      return `${previous} ${cleanLast}`.trim().replace(/\s+/g, ' ');
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
      activeBatchesCount: this.activeBatches.size,
      inFlightCount: this.inFlightGenerations.size
    };
  }

  destroy() {
    for (const [key, batch] of this.activeBatches.entries()) {
      if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
      if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    }
    this.activeBatches.clear();
    this.inFlightGenerations.clear();
    this.obsoleteBatchIds.clear();
  }
}

const messageBatcher = new MessageBatcher({ db });

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
  if (process.env.HYDRA_TEST_MODE === "1") {
    return { sucesso: true, statusHttp: 200, tentativas: 1, duracaoMs: 1, messageId: `mock_${Date.now()}` };
  }
  const cleanPhone = String(phone).replace(/\D/g, "");
  const cleanText = sanitizeWhatsAppMarkdown(text);
  if (!cleanPhone || !cleanText) return { sucesso: false, erro: "Payload inválido" };

  // ─── BARREIRA 3: Revalidação no Envio Direto ───────────────────────────────
  if (db && !revalidateAuthorization(db, cleanPhone)) {
    console.warn(`[AccessGuard] 🛑 Envio bloqueado: usuário ${maskPhone(cleanPhone)} revogado.`);
    recordSecurityRejection(db, {
      remoteJidMasked: maskPhone(cleanPhone),
      phoneMasked: maskPhone(cleanPhone),
      reason: "revoked_user",
      endpoint: "message_egress",
      timestamp: new Date().toISOString()
    });
    return { sucesso: false, erro: "revoked_or_unauthorized" };
  }

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
        console.log(`[WhatsApp API] Envio aceito pela Evolution API: status HTTP ${lastStatus}, messageId: ${capturedMsgId} para ${maskPhone(cleanPhone)}`);
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
      console.warn(`[Hydra Webhook] Envio para ${maskPhone(cleanPhone)} tentativa ${attempt}/${maxRetries} falhou (${lastError}). Backoff de ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  const duracaoMs = Date.now() - startTotal;
  logDelivery(cleanPhone, capturedMsgId, lastStatus, false, maxRetries, duracaoMs, lastRaw, lastError);
  console.error(`[Hydra Webhook] ❌ Falha definitiva no envio para ${maskPhone(cleanPhone)}: ${lastError}`);
  return { sucesso: false, statusHttp: lastStatus, tentativas: maxRetries, duracaoMs, erro: lastError };
}

/**
 * Envia mensagem interativa de lista via Evolution API (POST /message/sendList/{instance}).
 * Aplica whitelist rigorosa de instâncias e revalidação de usuário no egress.
 */
async function sendWhatsAppList(phone, listPayload, maxRetries = 2) {
  const cleanPhone = String(phone).replace(/\D/g, "");
  if (!cleanPhone || !listPayload) return { sucesso: false, erro: "Parâmetros inválidos" };

  // ─── BARREIRA 1: Whitelist Estrita de Instâncias Emissoras Autorizadas ───
  const ALLOWED_INSTANCES = new Set(["hydra", "atendimento"]);
  if (!ALLOWED_INSTANCES.has(INSTANCE)) {
    console.error(`[Hydra Webhook] 🛑 Violação de Segurança: Tentativa de envio de lista por instância não autorizada (${INSTANCE}).`);
    return { sucesso: false, erro: "unauthorized_sender_instance" };
  }

  // ─── BARREIRA 2: Revalidação no Egress de Mensagens ────────────────────────
  if (db && !revalidateAuthorization(db, cleanPhone)) {
    console.warn(`[AccessGuard] 🛑 Envio de lista bloqueado: usuário ${maskPhone(cleanPhone)} revogado.`);
    recordSecurityRejection(db, {
      remoteJidMasked: maskPhone(cleanPhone),
      phoneMasked: maskPhone(cleanPhone),
      reason: "revoked_user",
      endpoint: "send_list_egress",
      timestamp: new Date().toISOString()
    });
    return { sucesso: false, erro: "revoked_or_unauthorized" };
  }

  const endpoint = `${EVOLUTION_URL}/message/sendList/${INSTANCE}`;
  const startTotal = Date.now();
  let lastStatus = 0;
  let lastError = null;
  let lastRaw = null;
  let capturedMsgId = null;

  const payloadToSend = {
    ...listPayload,
    number: cleanPhone,
    footerText: listPayload.footerText || "Mecânica Popular · Sistema Hydra"
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": "Hydra-Bot/1.0",
          "Content-Type": "application/json",
          "apikey": EVOLUTION_KEY
        },
        body: JSON.stringify(payloadToSend),
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
        console.log(`[WhatsApp API] Lista interativa aceita pela Evolution API: status HTTP ${lastStatus}, messageId: ${capturedMsgId} para ${maskPhone(cleanPhone)}`);
        return { sucesso: true, statusHttp: lastStatus, tentativas: attempt, duracaoMs, messageId: capturedMsgId };
      }

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
      const backoff = 1000;
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  const duracaoMs = Date.now() - startTotal;
  logDelivery(cleanPhone, capturedMsgId, lastStatus, false, maxRetries, duracaoMs, lastRaw, lastError);
  console.warn(`[Hydra Webhook] ⚠️ Falha no envio de lista interativa para ${maskPhone(cleanPhone)}: ${lastError}. Resumo de texto foi enviado como fallback.`);
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
        [join(CODE_ROOT, "node_modules/tsx/dist/cli.mjs"), join(CODE_ROOT, "src/hydra-sync/agent_dispatcher_cli.ts"), payload],
        { timeout: 120000, encoding: "utf-8", cwd: CODE_ROOT, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            console.error("[Hydra Webhook] Erro no dispatcher:", error?.message || error, stderr);
            return resolve({
              messages: ["Não consegui consultar os dados agora devido a uma oscilação na conexão com o banco. Pode tentar novamente em instantes?"],
              interactiveList: null
            });
          }

          try {
            const parsed = extractDispatcherOutput(stdout);
            const rawText = (Array.isArray(parsed.messages) && parsed.messages.length > 0)
              ? parsed.messages.join("\n\n")
              : (parsed.replyText || "");
            if (rawText) {
              const composed = composeSemanticBalloons(rawText);
              return resolve({
                messages: composed,
                interactiveList: parsed.interactiveList || null
              });
            }
            return resolve({
              messages: ["Não foi possível formular uma resposta."],
              interactiveList: null
            });
          } catch (parseErr) {
            console.error("[Hydra Webhook] Erro ao parsear dispatcher output:", parseErr?.message || parseErr);
            return resolve({
              messages: ["Não consegui processar a resposta dos dados. Pode tentar novamente?"],
              interactiveList: null
            });
          }
        }
      );
    } catch (err) {
      console.error("[Hydra Webhook] Falha ao invocar dispatcher:", err?.message || err);
      resolve({
        messages: ["Não consegui formular uma resposta no momento."],
        interactiveList: null
      });
    }
  });
}

/**
 * Envio Sequencial dos Balões:
 * 1. O primeiro balão é despachado IMEDIATAMENTE (sem espera artificial de digitação, pois a presença já refletiu o trabalho real).
 * 2. Balões seguintes respeitam pequeno espaçamento de segurança (200ms) para preservar a ordem no WhatsApp.
 */
async function sendSequentialReplies(phone, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return { sucesso: false, total: 0, enviados: 0 };

  const cleanPhone = String(phone).replace(/\D/g, "");
  // ─── BARREIRA 3: Revalidação no Egress de Mensagens ─────────────────────────
  if (db && !revalidateAuthorization(db, cleanPhone)) {
    console.warn(`[AccessGuard] 🛑 Envio sequencial bloqueado: usuário ${maskPhone(cleanPhone)} revogado.`);
    recordSecurityRejection(db, {
      remoteJidMasked: maskPhone(cleanPhone),
      phoneMasked: maskPhone(cleanPhone),
      reason: "revoked_user",
      endpoint: "message_egress",
      timestamp: new Date().toISOString()
    });
    return { sucesso: false, total: messages.length, enviados: 0, erro: "revoked_or_unauthorized" };
  }

  let allSuccess = true;
  let sentCount = 0;
  for (let i = 0; i < messages.length; i++) {
    const text = messages[i];
    if (text && text.trim() !== "") {
      // Espaçamento mínimo apenas entre balões subsequentes para garantir ordenação estrita
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }
      const res = await sendReplyWhatsApp(phone, text);
      if (res && res.sucesso) {
        sentCount++;
      } else {
        allSuccess = false;
      }
    }
  }
  return { sucesso: allSuccess && sentCount > 0, total: messages.length, enviados: sentCount };
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

      // ─── BARREIRA 2: Revalidação em Voo na Fila Assíncrona ─────────────────────
      if (db && !revalidateAuthorization(db, job.phone)) {
        console.warn(`[AsyncQueue] 🛑 Job #${job.messageId} descartado: usuário ${maskPhone(job.phone)} revogado na fila.`);
        recordSecurityRejection(db, {
          remoteJidMasked: maskJid(job.remoteJid),
          phoneMasked: maskPhone(job.phone),
          reason: "revoked_user",
          endpoint: "queue_consumer",
          timestamp: new Date().toISOString()
        });
        await chatQ.typing.stop();
        continue;
      }

      const timeStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      console.log(`[${timeStr}] 📩 [AsyncQueue] Processando job #${job.messageId} de ${maskPhone(job.phone)} (${job.text?.length || 0} chars)`);

      const targetMsgIds = (job.messageIds && job.messageIds.length > 0) ? job.messageIds : [job.messageId];

      // Marco: generating
      for (const mId of targetMsgIds) {
        recordLifecycle(mId, "generating", job.batch?.batchId, "dispatcher_start");
      }

      // Registra no AbortRegistry para cancelamento imediato em caso de /reset
      InFlightAbortRegistry.getInstance().register(job.phone, job.messageId);

      // Inicia "digitando" contínuo exatamente quando a conversa chega à sua vez de execução
      // Registra a geração ativa no MessageBatcher para detecção de concorrência e complementos
      if (job.batch) {
        messageBatcher.markInFlight(job.phone, job.batch);
      }

      chatQ.typing.start();

      try {
        const replies = await runDispatcherAsync(job.phone, job.text, job.conversationId, job.messageId, job.batch);

        // Verifica se o job foi abortado em voo por /reset
        if (InFlightAbortRegistry.getInstance().isAborted(job.phone, job.messageId)) {
          console.log(`  ↳ [AsyncQueue] Resposta do job #${job.messageId} descartada (abortada por /reset).`);
          messageBatcher.clearInFlight(job.phone, job.batch?.batchId);
          await chatQ.typing.stop();
          continue;
        }

        // Verifica se a resposta tornou-se obsoleta devido à chegada de complemento durante a geração
        const isObsolete = (job.batch && messageBatcher.isBatchObsolete(job.batch.batchId)) || job.isObsolete;

        if (isObsolete) {
          console.log(`  ↳ [AsyncQueue] Resposta do job #${job.messageId} descartada (obsoleta por complemento recebido durante geração).`);
          messageBatcher.clearInFlight(job.phone, job.batch?.batchId);
          if (chatQ.queue.length === 0 && !messageBatcher.hasActiveBatch(job.phone)) {
            await chatQ.typing.stop();
          }
          continue;
        }

        // Encerra imediatamente o "digitando" antes de iniciar a entrega do primeiro balão
        await chatQ.typing.stop();

        const replyMessages = Array.isArray(replies) ? replies : (replies?.messages || []);
        const interactiveList = (!Array.isArray(replies) && replies?.interactiveList) ? replies.interactiveList : null;

        console.log(`  ↳ [AsyncQueue] Despachando ${replyMessages.length} balão(ões) para ${maskPhone(job.phone)}...`);
        const replyRes = await sendSequentialReplies(job.phone, replyMessages);

        if (replyRes && replyRes.sucesso) {
          console.log(`  ✓ [AsyncQueue] Envio concluído e auditado para ${maskPhone(job.phone)}.`);

          // Se houver lista interativa da Evolution API, despacha logo após o texto
          if (interactiveList) {
            await new Promise(r => setTimeout(r, 300));
            await sendWhatsAppList(job.phone, interactiveList);
          }

          // Marco: sent_whatsapp
          for (const mId of targetMsgIds) {
            recordLifecycle(mId, "sent_whatsapp", job.batch?.batchId, `replies_count:${replyMessages.length}`);
          }

          // Blindagem: Reação ✅ disparada em TODOS os messageIds que compuseram o lote
          // Falha na API de reação JAMAIS pode travar ou atrasar o fluxo
          for (const mId of targetMsgIds) {
            const jid = job.batch?.messageJids?.[mId] || job.remoteJid || `${job.phone}@s.whatsapp.net`;
            sendReactionWhatsApp(jid, mId, "✅").catch(err => {
              console.warn(`[Hydra Webhook] Falha não-bloqueante ao reagir com ✅ para #${mId}:`, err?.message || err);
            });
          }
        } else {
          console.error(`  ❌ [AsyncQueue] Falha na entrega de balões para ${maskPhone(job.phone)}.`);
          for (const mId of targetMsgIds) {
            recordLifecycle(mId, "failed", job.batch?.batchId, "reply_delivery_failure");
            const jid = job.batch?.messageJids?.[mId] || job.remoteJid || `${job.phone}@s.whatsapp.net`;
            sendReactionWhatsApp(jid, mId, "❌").catch(() => {});
          }
        }
      } catch (jobErr) {
        console.error(`[AsyncQueue] Erro ao processar job #${job.messageId}:`, jobErr?.message || jobErr);
        await chatQ.typing.stop();

        // Marco: failed
        for (const mId of targetMsgIds) {
          recordLifecycle(mId, "failed", job.batch?.batchId, jobErr?.message || "unrecoverable_error");
          const jid = job.batch?.messageJids?.[mId] || job.remoteJid || `${job.phone}@s.whatsapp.net`;
          sendReactionWhatsApp(jid, mId, "❌").catch(() => {});
        }

        // Fallback calmo ao usuário
        await sendReplyWhatsApp(job.phone, "Ocorreu uma instabilidade momentânea ao processar sua mensagem. Por favor, tente novamente.");
      } finally {
        InFlightAbortRegistry.getInstance().clear(job.phone, job.messageId);
        if (job.batch) {
          messageBatcher.clearInFlight(job.phone, job.batch.batchId);
        }
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
async function handleIncomingPayload(payload, headers = {}, customDb = null) {
  const activeDb = customDb || db;
  // Trata atualizações de status / entrega de mensagens (SOMENTE quando o evento for messages.update)
  if (payload?.event === "messages.update") {
    const statusMsgId = payload?.data?.key?.id || payload?.data?.id || payload?.id;
    const statusVal = payload?.data?.status || payload?.data?.update?.status;
    if (statusMsgId && statusVal) {
      const isDelivered = 
        statusVal === "DELIVERY_ACK" || 
        statusVal === "DELIVERED" || 
        statusVal === "READ" || 
        statusVal === 3 || 
        statusVal === 4;
      if (isDelivered) {
        recordLifecycle(String(statusMsgId), "delivered", null, `status:${statusVal}`);
        console.log(`[WhatsApp Delivery] Status de entrega reportado: ${statusVal} para mensagem #${statusMsgId}`);
        return { statusCode: 200, body: { status: "delivered_recorded", messageId: String(statusMsgId) } };
      }
    }
    return { statusCode: 200, body: { status: "ignored_messages_update" } };
  }

  // 1. Proteção Anti-Loop: Ignora mensagens enviadas pelo próprio bot, updates e status@broadcast
  // ATENÇÃO: NUNCA verificar payload?.data?.status aqui, pois a Evolution injeta DELIVERY_ACK em mensagens normais de entrada!
  if (
    payload?.data?.key?.fromMe === true ||
    payload?.message_type === "outgoing" ||
    payload?.event === "messages.update" ||
    payload?.data?.key?.remoteJid === "status@broadcast"
  ) {
    return { statusCode: 200, body: { status: "ignored_outgoing_or_status" } };
  }

  // ─── BARREIRA 0: Autenticação de Secret do Webhook (Evolution API) ───────────
  if (!authenticateWebhookRequest(headers)) {
    const rawJid = String(payload?.data?.key?.remoteJid || payload?.remoteJid || "");
    if (activeDb) {
      recordSecurityRejection(activeDb, {
        remoteJidMasked: maskJid(rawJid),
        reason: "invalid_webhook_token",
        endpoint: "webhook_ingress",
        timestamp: new Date().toISOString()
      });
    }
    return { statusCode: 401, body: { status: "unauthorized_token" } };
  }

  // ─── BARREIRA 1: Resolução de Identidade Canônica e Autorização Rígida ────────
  // Se resolveCanonicalIdentity retornar null, retorna HTTP 200 { status: "ignored_unauthorized" } imediatamente.
  // Garante ZERO IA, ZERO download de mídia, ZERO transcrição, ZERO fila, ZERO presença e ZERO reação.
  const authContext = resolveCanonicalIdentity(activeDb, payload);
  if (!authContext) {
    return { statusCode: 200, body: { status: "ignored_unauthorized" } };
  }

  const phone = authContext.phone;
  const targetJid = authContext.remoteJid;
  const rawRemoteJid = targetJid;

  // Remetente e targetJid resolvidos na Barreira 1 (resolveCanonicalIdentity)

  // 4. Extração de Conteúdo da Mensagem e Detecção de Mídia Multimodal
  const messageObj = payload?.data?.message;
  let mediaType = "text";
  if (messageObj?.audioMessage) mediaType = "audio";
  else if (messageObj?.imageMessage) mediaType = "image";
  else if (messageObj?.videoMessage) mediaType = "video";
  else if (messageObj?.documentMessage || messageObj?.documentWithCaptionMessage) mediaType = "document";
  const hasMedia = mediaType !== "text";

  // Extração de mensagens interativas da Evolution API (Listas, Botões, Native Flows)
  let interactiveText = null;
  const listReply = messageObj?.listResponseMessage;
  if (listReply?.singleSelectReply?.selectedRowId) {
    interactiveText = String(listReply.singleSelectReply.selectedRowId).trim();
  } else if (messageObj?.buttonsResponseMessage?.selectedButtonId) {
    interactiveText = String(messageObj.buttonsResponseMessage.selectedButtonId).trim();
  } else if (messageObj?.templateButtonReplyMessage?.selectedId) {
    interactiveText = String(messageObj.templateButtonReplyMessage.selectedId).trim();
  } else if (messageObj?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const p = JSON.parse(messageObj.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      if (p?.id || p?.rowId) {
        interactiveText = String(p.id || p.rowId).trim();
      }
    } catch {}
  }

  // Injetor de Prompt Humano: Converte rowId técnico em pergunta conversacional para a IA
  if (interactiveText) {
    const osMatch = interactiveText.match(/^os_(\d{1,8})_(servicos|pecas|pagamentos|documentos|historico)$/i);
    if (osMatch) {
      const osId = osMatch[1];
      const mod = osMatch[2].toLowerCase();
      if (mod === "servicos") interactiveText = `Quais são os serviços discriminados da OS #${osId}?`;
      else if (mod === "pecas") interactiveText = `Quais são as peças e materiais aplicados na OS #${osId}?`;
      else if (mod === "pagamentos") interactiveText = `Quais são as formas de pagamento e parcelas da OS #${osId}?`;
      else if (mod === "documentos") interactiveText = `Mostre as vistorias, checklists e documentos da OS #${osId}.`;
      else if (mod === "historico") interactiveText = `Qual o histórico de atendimento, conversas e tratativas da OS #${osId}?`;
    }
  }

  let text = (
    interactiveText ||
    messageObj?.conversation ||
    messageObj?.extendedTextMessage?.text ||
    messageObj?.imageMessage?.caption ||
    messageObj?.videoMessage?.caption ||
    messageObj?.documentMessage?.caption ||
    messageObj?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    payload?.content ||
    ""
  ).trim();

  if (!text && !hasMedia) {
    return { statusCode: 200, body: { status: "empty_text" } };
  }

  if (!text && hasMedia) {
    text = mediaType === "audio" ? "[Áudio recebido]" : (mediaType === "image" ? "[Imagem recebida]" : (mediaType === "video" ? "[Vídeo recebido]" : "[Documento recebido]"));
  }

  // 5. Identificação e Deduplicação Persistente em SQLite (Idempotência de Webhook)
  const rawMessageId = payload?.data?.key?.id || payload?.id;
  const messageId = String(rawMessageId || `${phone}_${Date.now()}`);

  if (isMessageProcessed(messageId)) {
    console.log(`[Hydra Webhook] 🔁 Mensagem duplicada ignorada: ${messageId} de ${maskPhone(phone)}`);
    return { statusCode: 200, body: { status: "ignored_duplicate", messageId } };
  }

  // Marca imediatamente no SQLite para travar requisições concorrentes idênticas
  markMessageProcessed(messageId, phone);

  // remoteJid nativo (targetJid) já determinado na Barreira 1

  // Marco: accepted
  recordLifecycle(messageId, "accepted", null, `jid:${maskJid(targetJid)}`);

  // 6. Confirmação Rápida de Recebimento via Reação 👀 vinculada ao messageId
  // Reage apenas a mensagens válidas de entrada com ID real da Evolution
  if (rawMessageId && !hasMessageBeenReacted(messageId, "👀")) {
    // Dispara a reação de forma não-bloqueante; falha de reação não impede a resposta
    sendReactionWhatsApp(targetJid, messageId, "👀").catch(() => {});
  }

  // 6.1 Interceptação Determinística de Comandos no Ingress antes do batcher e da IA (Frente C)
  if (!hasMedia && isDeterministicCommand(text)) {
    console.log(`[Hydra Webhook] ⚡ Comando determinístico recebido de ${maskPhone(phone)}: "${text}"`);
    const commandToken = text.trim().split(/\s+/)[0].toLowerCase();

    // Regra de Ouro do Reset: aborta jobs em voo e encerra digitação imediatamente
    if (commandToken === "/reset") {
      const activeChatQ = getOrCreateChatQueue(phone);
      activeChatQ.queue = [];
      await activeChatQ.typing.stop();
      sendPresenceWhatsApp(targetJid, "paused").catch(() => {});
    }

    // Trocar de persona invalida respostas iniciadas sob o escopo anterior.
    if (commandToken === "/socio" || Object.hasOwn(STORE_COMMANDS, commandToken)) {
      const activeChatQ = getOrCreateChatQueue(phone);
      activeChatQ.queue = [];
      const previousBatch = messageBatcher.getInFlight(phone);
      if (previousBatch?.batchId) messageBatcher.markBatchObsolete(previousBatch.batchId);
      InFlightAbortRegistry.getInstance().abort(phone);
      await activeChatQ.typing.stop();
      sendPresenceWhatsApp(targetJid, "paused").catch(() => {});
    }

    const cmdResult = await interceptCommand({
      phone,
      text,
      db: activeDb,
      abortRegistry: InFlightAbortRegistry.getInstance(),
      presenceFn: (p, pres) => sendPresenceWhatsApp(targetJid, pres).catch(() => {})
    });

    if (cmdResult.handled) {
      if (cmdResult.messages && cmdResult.messages.length > 0) {
        await sendSequentialReplies(phone, cmdResult.messages);
      }

      if (rawMessageId) {
        sendReactionWhatsApp(targetJid, messageId, "✅").catch(() => {});
      }

      return {
        statusCode: 200,
        body: {
          status: "command_handled",
          command: cmdResult.command,
          messageId
        }
      };
    }
  }

  const conversationId = payload?.conversation?.id;
  const chatQ = getOrCreateChatQueue(phone);

  const part = {
    partId: `part_${messageId}`,
    messageId,
    conversationKey: phone,
    remoteJid: targetJid,
    kind: mediaType,
    type: mediaType,
    receivedAt: new Date().toISOString(),
    text,
    timestamp: Date.now()
  };

  // 7. Adiciona à janela de encavalamento (debounce deslizante de 700ms por conversa)
  const batchRes = messageBatcher.addMessage(part, undefined, async (batch) => {
    // Quando o lote fecha (700ms de silêncio ou teto máximo de 2000ms):
    const messageJids = {};
    for (const p of batch.parts) {
      if (p.messageId && p.remoteJid) {
        messageJids[p.messageId] = p.remoteJid;
      }
    }

    enqueueJob({
      phone,
      remoteJid: targetJid,
      text: batch.combinedText,
      messageId: batch.batchId,
      messageIds: batch.messageIds,
      conversationId,
      batch: {
        ...batch,
        messageJids
      },
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
      const result = await handleIncomingPayload(payload, req.headers);
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

function setWebhookDatabase(customDb) {
  db = customDb;
  if (db) {
    try {
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
        CREATE TABLE IF NOT EXISTS message_reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          reaction TEXT NOT NULL,
          remote_jid TEXT NOT NULL,
          phone TEXT,
          state TEXT NOT NULL,
          status_http INTEGER,
          sucesso INTEGER NOT NULL,
          duracao_ms INTEGER,
          resposta_raw TEXT,
          erro TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, reaction)
        );
      `);
      initHydraAccessAndMemorySchema(db);
    } catch {}
  }
}

export {
  setWebhookDatabase,
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
  getMessageReactionState,
  recordMessageReaction,
  recordLifecycle,
  maskPhone,
  maskJid,
  sanitizeWhatsAppMarkdown,
  getTotalQueueMetrics,
  MessageBatcher,
  messageBatcher
};
