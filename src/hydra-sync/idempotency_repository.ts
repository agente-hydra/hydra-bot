import type Database from 'better-sqlite3';

export type MessageProcessingStatus = 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';

export interface InboxMessageRecord {
  messageId: string;
  phone: string;
  conversationId?: string;
  messageText: string;
  status: MessageProcessingStatus;
  responsePayload?: string; // JSON array com as mensagens de resposta
  replyText?: string;
  toolsCalled?: string[];
  motorUsed?: string;
  latenciaMs?: number;
  errorMessage?: string;
  receivedAt: string;
  completedAt?: string;
}

export interface RegisterMessageResult {
  isDuplicate: boolean;
  status: MessageProcessingStatus;
  existingRecord?: InboxMessageRecord;
}

/**
 * Garante a exist?ncia da tabela de controle at?mico de idempot?ncia e auditoria.
 */
export function ensureInboxTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_inbox_messages (
        message_id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        conversation_id TEXT,
        message_text TEXT NOT NULL,
        status TEXT NOT NULL, -- 'IN_FLIGHT' | 'COMPLETED' | 'FAILED'
        response_payload TEXT,
        reply_text TEXT,
        tools_called TEXT,
        motor_used TEXT,
        latencia_ms INTEGER,
        error_message TEXT,
        received_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_phone_received ON hydra_inbox_messages(phone, received_at);
      CREATE INDEX IF NOT EXISTS idx_inbox_status ON hydra_inbox_messages(status);
    `);
  } catch (err: any) {
    console.error('[IDEMPOTENCY] Erro ao criar tabela hydra_inbox_messages:', err?.message || err);
  }
}

/**
 * Registra at?mica e deterministicamente o recebimento de uma mensagem.
 * Trata IDs como strings opacas.
 * Distingue duplicata (COMPLETED), em andamento (IN_FLIGHT) e permite retentativa em FAILED.
 */
export function registerIncomingMessage(
  db: Database.Database,
  params: {
    messageId: string;
    phone: string;
    conversationId?: string;
    text: string;
  }
): RegisterMessageResult {
  ensureInboxTable(db);
  const msgId = String(params.messageId || '').trim();
  const phone = String(params.phone || '').replace(/\D/g, '');
  const convId = params.conversationId ? String(params.conversationId) : null;
  const text = String(params.text || '').trim();
  const nowIso = new Date().toISOString();

  if (!msgId) {
    // Se n?o tiver ID (cen?rio extremo), gera um aleat?rio e n?o bloqueia
    return { isDuplicate: false, status: 'IN_FLIGHT' };
  }

  try {
    // Tentativa at?mica de inser??o como IN_FLIGHT
    db.prepare(`
      INSERT INTO hydra_inbox_messages (
        message_id, phone, conversation_id, message_text, status, received_at
      ) VALUES (?, ?, ?, ?, 'IN_FLIGHT', ?)
    `).run(msgId, phone, convId, text, nowIso);

    return { isDuplicate: false, status: 'IN_FLIGHT' };
  } catch (err: any) {
    // Falha por UNIQUE constraint em message_id: Mensagem j? registrada
    try {
      const row = db.prepare(`
        SELECT message_id, phone, conversation_id, message_text, status,
               response_payload, reply_text, tools_called, motor_used, latencia_ms,
               error_message, received_at, completed_at
        FROM hydra_inbox_messages
        WHERE message_id = ?
      `).get(msgId) as any;

      if (!row) {
        return { isDuplicate: false, status: 'IN_FLIGHT' };
      }

      let tools: string[] = [];
      if (row.tools_called) {
        try { tools = JSON.parse(row.tools_called); } catch {}
      }

      const record: InboxMessageRecord = {
        messageId: row.message_id,
        phone: row.phone,
        conversationId: row.conversation_id || undefined,
        messageText: row.message_text,
        status: row.status as MessageProcessingStatus,
        responsePayload: row.response_payload || undefined,
        replyText: row.reply_text || undefined,
        toolsCalled: tools,
        motorUsed: row.motor_used || undefined,
        latenciaMs: row.latencia_ms != null ? Number(row.latencia_ms) : undefined,
        errorMessage: row.error_message || undefined,
        receivedAt: row.received_at,
        completedAt: row.completed_at || undefined
      };

      if (record.status === 'COMPLETED' || record.status === 'IN_FLIGHT') {
        return { isDuplicate: true, status: record.status, existingRecord: record };
      }

      // Se estava FAILED, permite reprocessar reabrindo como IN_FLIGHT
      if (record.status === 'FAILED') {
        db.prepare(`
          UPDATE hydra_inbox_messages
          SET status = 'IN_FLIGHT', error_message = NULL, received_at = ?
          WHERE message_id = ?
        `).run(nowIso, msgId);
        return { isDuplicate: false, status: 'IN_FLIGHT', existingRecord: record };
      }

      return { isDuplicate: true, status: record.status, existingRecord: record };
    } catch (readErr: any) {
      console.error('[IDEMPOTENCY] Erro ao consultar mensagem duplicada:', readErr?.message || readErr);
      return { isDuplicate: false, status: 'IN_FLIGHT' };
    }
  }
}

/**
 * Marca a mensagem como conclu?da com sucesso e persiste a resposta e telemetria.
 */
export function markMessageCompleted(
  db: Database.Database,
  messageId: string,
  result: {
    messages: string[];
    replyText: string;
    toolsCalled?: string[];
    motorUsed?: string;
    latenciaMs?: number;
  }
): void {
  ensureInboxTable(db);
  const msgId = String(messageId || '').trim();
  if (!msgId) return;

  const nowIso = new Date().toISOString();
  const payloadJson = JSON.stringify(result.messages || []);
  const toolsJson = JSON.stringify(result.toolsCalled || []);

  try {
    db.prepare(`
      UPDATE hydra_inbox_messages
      SET status = 'COMPLETED',
          response_payload = ?,
          reply_text = ?,
          tools_called = ?,
          motor_used = ?,
          latencia_ms = ?,
          completed_at = ?
      WHERE message_id = ?
    `).run(
      payloadJson,
      result.replyText || '',
      toolsJson,
      result.motorUsed || null,
      result.latenciaMs || null,
      nowIso,
      msgId
    );
  } catch (err: any) {
    console.error('[IDEMPOTENCY] Erro ao marcar mensagem como conclu?da:', err?.message || err);
  }
}

/**
 * Marca a mensagem como falha para auditoria e poss?vel retentativa.
 */
export function markMessageFailed(
  db: Database.Database,
  messageId: string,
  errorMessage: string
): void {
  ensureInboxTable(db);
  const msgId = String(messageId || '').trim();
  if (!msgId) return;

  const nowIso = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE hydra_inbox_messages
      SET status = 'FAILED',
          error_message = ?,
          completed_at = ?
      WHERE message_id = ?
    `).run(errorMessage.slice(0, 500), nowIso, msgId);
  } catch (err: any) {
    console.error('[IDEMPOTENCY] Erro ao marcar mensagem como falha:', err?.message || err);
  }
}

/**
 * Limpa mensagens antigas da tabela de idempot?ncia para manter tabela leve (TTL retention)
 */
export function purgeOldInboxMessages(db: Database.Database, daysToKeep: number = 7): void {
  ensureInboxTable(db);
  try {
    db.prepare(`
      DELETE FROM hydra_inbox_messages
      WHERE received_at < datetime('now', '-' || ? || ' days')
    `).run(daysToKeep);
  } catch {}
}
