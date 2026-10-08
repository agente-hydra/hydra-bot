import type Database from 'better-sqlite3';
import type { TurnContract, StructuredFilters } from './types/conversation_contract.js';
import type { TurnPendingRequest } from './types/conversation_context_contract.js';

export type IntentType =
  | 'list_os'
  | 'os_detail'
  | 'os_conversation'
  | 'store_overview'
  | 'financial_alerts'
  | 'service_search'
  | 'checklist_audit'
  | 'aging_cars'
  | 'store_cmv'
  | 'store_areas'
  | 'media_survey'
  | 'runtime_diagnostics'
  | 'conversation_history'
  | 'memory_preference'
  | 'conversation_correction'
  | 'vehicle_situation'
  | 'other';

export interface TurnFilters extends StructuredFilters {
  [key: string]: any;
}

export interface TurnCursor {
  cursorId: string;
  phone: string;
  lojaSlug: string;
  queryHash: string;
  snapshotTime: string;
  lastDataInicioIso?: string;
  lastOsId?: string;
  pageNumber: number;
  pageSize: number;
  cursorToken: string;
  filtersJson?: string;
  createdAt: string;
  expiresAt: string;
}

export interface TurnState {
  phone: string;
  lastTurnId: string;
  lastIntent: IntentType;
  lojaSlug?: string;
  placa?: string;
  osId?: string;
  activeCursor?: string;
  filters: TurnFilters;
  lastContract?: TurnContract;
  lastMessageId?: number;
  lastResponseText?: string;
  pendingRequest?: TurnPendingRequest;
  agyConversationId?: string;
  updatedAt: string; // ISO 8601
}

/**
 * Intents que indicam mudança de assunto para métricas agregadas da loja/rede,
 * onde o contexto cirúrgico de uma OS individual deve ser descartado com inteligência.
 */
const NON_OS_TOPIC_INTENTS: readonly IntentType[] = [
  'financial_alerts',
  'store_overview',
  'store_cmv',
  'store_areas',
  'media_survey'
];

/**
 * Garante a criação idempotente das tabelas hydra_turn_contexts e hydra_turn_cursors no SQLite.
 */
export function ensureTurnContextTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_turn_contexts (
        phone TEXT PRIMARY KEY,
        last_turn_id TEXT NOT NULL,
        last_intent TEXT NOT NULL,
        loja_slug TEXT,
        placa TEXT,
        os_id TEXT,
        filters_json TEXT,
        last_message_id INTEGER,
        last_response_text TEXT,
        active_cursor TEXT,
        pending_request_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_turn_contexts_updated ON hydra_turn_contexts(updated_at);

      CREATE TABLE IF NOT EXISTS hydra_turn_cursors (
        cursor_id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        loja_slug TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        snapshot_time TEXT NOT NULL,
        last_data_inicio_iso TEXT,
        last_os_id TEXT,
        page_number INTEGER DEFAULT 1,
        page_size INTEGER DEFAULT 20,
        cursor_token TEXT NOT NULL,
        filters_json TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_turn_cursors_phone ON hydra_turn_cursors(phone);
      CREATE INDEX IF NOT EXISTS idx_turn_cursors_loja ON hydra_turn_cursors(loja_slug);
      CREATE INDEX IF NOT EXISTS idx_turn_cursors_token ON hydra_turn_cursors(cursor_token);
    `);

    // Migration segura caso active_cursor não exista em tabela previamente criada
    try {
      db.prepare('ALTER TABLE hydra_turn_contexts ADD COLUMN active_cursor TEXT').run();
    } catch {}

    // Migration aditiva segura para pending_request_json (E2-01)
    try {
      db.prepare('ALTER TABLE hydra_turn_contexts ADD COLUMN pending_request_json TEXT').run();
    } catch {}

    // Migration aditiva segura para agy_conversation_id
    try {
      db.prepare('ALTER TABLE hydra_turn_contexts ADD COLUMN agy_conversation_id TEXT').run();
    } catch {}
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao criar tabelas de contexto/cursores:', err?.message || err);
  }
}

/**
 * Normaliza número de telefone (apenas dígitos).
 */
export function cleanPhone(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Recupera o último estado estruturado do turno para um telefone.
 * Se o estado for mais antigo que maxAgeMinutes (padrão: 120 min), retorna null (expirado)
 * e invalida automaticamente os cursores vinculados.
 */
export function getLatestTurnState(
  db: Database.Database,
  phone: string,
  maxAgeMinutes: number = 120
): TurnState | null {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return null;

  try {
    const row = db.prepare(`
      SELECT phone, last_turn_id, last_intent, loja_slug, placa, os_id, filters_json, last_message_id, last_response_text, active_cursor, pending_request_json, updated_at
      FROM hydra_turn_contexts
      WHERE phone = ?
    `).get(p) as any;

    if (!row) return null;

    // Verificação de Expiração por TTL
    const updatedAtMillis = new Date(row.updated_at).getTime();
    if (Number.isFinite(updatedAtMillis)) {
      const ageMs = Date.now() - updatedAtMillis;
      if (ageMs > maxAgeMinutes * 60 * 1000) {
        // Expiração atômica de contexto e cursores por TTL
        try {
          db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ?').run(p);
        } catch {}
        return null; // Contexto expirado
      }
    }

    let filters: TurnFilters = {};
    let lastContract: TurnContract | undefined = undefined;

    if (row.filters_json) {
      try {
        const parsed = JSON.parse(row.filters_json);
        if (parsed && typeof parsed === 'object') {
          if (parsed._contract) {
            lastContract = parsed._contract;
            const { _contract, ...restFilters } = parsed;
            filters = restFilters;
          } else {
            filters = parsed;
          }
        }
      } catch {
        filters = {};
      }
    }

    let pendingRequest: TurnPendingRequest | undefined = undefined;
    if (row.pending_request_json) {
      try {
        pendingRequest = JSON.parse(row.pending_request_json);
      } catch {}
    }

    return {
      phone: row.phone,
      lastTurnId: row.last_turn_id,
      lastIntent: row.last_intent as IntentType,
      lojaSlug: row.loja_slug || undefined,
      placa: row.placa || undefined,
      osId: row.os_id || undefined,
      activeCursor: row.active_cursor || undefined,
      filters,
      lastContract,
      lastMessageId: row.last_message_id != null ? Number(row.last_message_id) : undefined,
      lastResponseText: row.last_response_text || undefined,
      pendingRequest,
      updatedAt: row.updated_at
    };
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao recuperar estado do turno:', err?.message || err);
    return null;
  }
}

/**
 * Salva ou atualiza atomicamente o estado estruturado do turno para um telefone.
 * Aplica regra de descarte inteligente: se o usuário mudar de assunto (ex: faturamento do mês),
 * limpa o os_id e placa sem resetar o loja_slug.
 * Se houver troca explícita de loja, invalida imediatamente os cursores anteriores e descarta
 * qualquer anáfora ou identificador da loja anterior.
 */
export function saveTurnState(db: Database.Database, state: TurnState): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(state.phone);
  if (!p) return;

  try {
    // Busca estado existente para herança inteligente de lojaSlug se não explicitada
    const existing = db.prepare(`
      SELECT loja_slug, os_id, placa, pending_request_json FROM hydra_turn_contexts WHERE phone = ?
    `).get(p) as { loja_slug?: string; os_id?: string; placa?: string; pending_request_json?: string } | undefined;

    const hadActiveOS = Boolean(existing?.os_id);
    let targetLojaSlug = state.lojaSlug || null;
    let targetOsId: string | null = state.osId || null;
    let targetPlaca: string | null = state.placa || null;

    // Detecção de mudança de loja ou alternância para persona sócio
    const storeChanged = Boolean(existing?.loja_slug && targetLojaSlug && existing.loja_slug !== targetLojaSlug);
    const switchedToSocioWithoutStore = Boolean(existing?.loja_slug && !targetLojaSlug && state.lastIntent === 'store_overview');

    if (storeChanged || switchedToSocioWithoutStore) {
      // Invalidação atômica de cursores e descarte de buscas/anáforas da outra loja
      invalidateTurnCursors(db, p);
      if (storeChanged) {
        // Se a loja mudou, NUNCA herda nem preserva osId/placa da loja antiga
        targetOsId = state.osId || null;
        targetPlaca = state.placa || null;
      } else {
        targetOsId = null;
        targetPlaca = null;
      }
    }

    // Regra de Descarte Inteligente:
    // Se a conversa tinha uma OS em foco e a nova intenção for faturamento, metas, CMV ou visão geral da loja
    // (e NÃO for uma consulta específica de OS), expurga o os_id e a placa, preservando o loja_slug.
    const isTopicShiftFromOSToFinance = hadActiveOS &&
      NON_OS_TOPIC_INTENTS.includes(state.lastIntent) &&
      !state.filters?.isOSSpecific &&
      !state.filters?.explicitOS;

    if (isTopicShiftFromOSToFinance) {
      targetOsId = null;
      targetPlaca = null;
      if (!targetLojaSlug && existing?.loja_slug) {
        targetLojaSlug = existing.loja_slug;
      }
    }

    // Se a intenção for explicitamente sobre OS, garante a persistência dos identificadores
    if (state.lastIntent === 'os_detail' || state.filters?.isOSSpecific) {
      if (state.osId) targetOsId = state.osId;
      if (state.placa) targetPlaca = state.placa;
      if (!targetLojaSlug && existing?.loja_slug) {
        targetLojaSlug = existing.loja_slug;
      }
    }

    // Gerenciamento inteligente de Pedido Pendente (TurnPendingRequest) [E2-01]:
    // Limpar o pedido pendente em caso de mudança explícita de assunto ou troca de loja.
    let targetPendingRequestJson: string | null = null;
    if (isTopicShiftFromOSToFinance || storeChanged || switchedToSocioWithoutStore) {
      targetPendingRequestJson = null;
    } else if (state.pendingRequest !== undefined) {
      targetPendingRequestJson = state.pendingRequest ? JSON.stringify(state.pendingRequest) : null;
    } else {
      targetPendingRequestJson = existing?.pending_request_json || null;
    }

    const payloadFilters = {
      ...(state.filters || {}),
      ...(state.lastContract ? { _contract: state.lastContract } : {})
    };
    const filtersJson = JSON.stringify(payloadFilters);
    const nowIso = state.updatedAt || new Date().toISOString();

    db.prepare(`
      INSERT INTO hydra_turn_contexts (
        phone, last_turn_id, last_intent, loja_slug, placa, os_id,
        filters_json, last_message_id, last_response_text, active_cursor,
        pending_request_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        last_turn_id = excluded.last_turn_id,
        last_intent = excluded.last_intent,
        loja_slug = excluded.loja_slug,
        placa = excluded.placa,
        os_id = excluded.os_id,
        filters_json = excluded.filters_json,
        last_message_id = excluded.last_message_id,
        last_response_text = excluded.last_response_text,
        active_cursor = excluded.active_cursor,
        pending_request_json = excluded.pending_request_json,
        updated_at = excluded.updated_at
    `).run(
      p,
      state.lastTurnId,
      state.lastIntent,
      targetLojaSlug,
      targetPlaca,
      targetOsId,
      filtersJson,
      state.lastMessageId != null ? state.lastMessageId : null,
      state.lastResponseText || null,
      state.activeCursor || null,
      targetPendingRequestJson,
      nowIso
    );
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao salvar estado do turno:', err?.message || err);
  }
}

/**
 * Salva cursor de paginação determinística vinculado ao snapshot e queryHash.
 */

/**
 * Salva explicitamente o pedido operacional pendente de um operador [E2-01].
 */
export function saveTurnPendingRequest(
  db: Database.Database,
  phone: string,
  pendingRequest: TurnPendingRequest
): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;

  try {
    const nowIso = new Date().toISOString();
    const reqJson = JSON.stringify(pendingRequest);

    const existing = db.prepare('SELECT phone FROM hydra_turn_contexts WHERE phone = ?').get(p);
    if (existing) {
      db.prepare(`
        UPDATE hydra_turn_contexts
        SET pending_request_json = ?, updated_at = ?
        WHERE phone = ?
      `).run(reqJson, nowIso, p);
    } else {
      db.prepare(`
        INSERT INTO hydra_turn_contexts (
          phone, last_turn_id, last_intent, loja_slug, placa, os_id,
          filters_json, last_message_id, last_response_text, active_cursor,
          pending_request_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p,
        `turn_req_${Date.now()}`,
        'other',
        pendingRequest.targetLojaSlug || null,
        pendingRequest.targetPlate || null,
        pendingRequest.targetOsId || null,
        null,
        null,
        null,
        null,
        reqJson,
        nowIso
      );
    }
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao salvar pending request:', err?.message || err);
  }
}

/**
 * Recupera o pedido pendente do operador validando TTL (padrão: 120 min) [E2-01].
 */
export function getTurnPendingRequest(
  db: Database.Database,
  phone: string,
  maxAgeMinutes: number = 120
): TurnPendingRequest | null {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return null;

  try {
    const row = db.prepare(`
      SELECT pending_request_json, updated_at
      FROM hydra_turn_contexts
      WHERE phone = ?
    `).get(p) as { pending_request_json?: string; updated_at?: string } | undefined;

    if (!row || !row.pending_request_json) return null;

    if (row.updated_at) {
      const updatedAtMillis = new Date(row.updated_at).getTime();
      if (Number.isFinite(updatedAtMillis)) {
        const ageMs = Date.now() - updatedAtMillis;
        if (ageMs > maxAgeMinutes * 60 * 1000) {
          try {
            db.prepare('UPDATE hydra_turn_contexts SET pending_request_json = NULL WHERE phone = ?').run(p);
          } catch {}
          return null;
        }
      }
    }

    return JSON.parse(row.pending_request_json) as TurnPendingRequest;
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao recuperar pending request:', err?.message || err);
    return null;
  }
}

/**
 * Limpa o pedido pendente do operador explicitamente [E2-01].
 */
export function clearTurnPendingRequest(db: Database.Database, phone: string): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;

  try {
    db.prepare('UPDATE hydra_turn_contexts SET pending_request_json = NULL WHERE phone = ?').run(p);
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao limpar pending request:', err?.message || err);
  }
}

export function saveTurnCursor(db: Database.Database, cursor: TurnCursor): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(cursor.phone);
  if (!p) return;

  try {
    db.prepare(`
      INSERT INTO hydra_turn_cursors (
        cursor_id, phone, loja_slug, query_hash, snapshot_time,
        last_data_inicio_iso, last_os_id, page_number, page_size,
        cursor_token, filters_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cursor_id) DO UPDATE SET
        page_number = excluded.page_number,
        last_data_inicio_iso = excluded.last_data_inicio_iso,
        last_os_id = excluded.last_os_id,
        cursor_token = excluded.cursor_token,
        filters_json = excluded.filters_json,
        expires_at = excluded.expires_at
    `).run(
      cursor.cursorId,
      p,
      cursor.lojaSlug,
      cursor.queryHash,
      cursor.snapshotTime,
      cursor.lastDataInicioIso || null,
      cursor.lastOsId || null,
      cursor.pageNumber,
      cursor.pageSize || 20,
      cursor.cursorToken,
      cursor.filtersJson || null,
      cursor.createdAt || new Date().toISOString(),
      cursor.expiresAt
    );

    try {
      db.prepare('UPDATE hydra_turn_contexts SET active_cursor = ? WHERE phone = ?').run(
        cursor.cursorToken,
        p
      );
    } catch {}
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao salvar cursor de turno:', err?.message || err);
  }
}

/**
 * Recupera cursor de paginação determinística validando TTL e integridade.
 */
export function getTurnCursor(
  db: Database.Database,
  phone: string,
  cursorToken: string
): TurnCursor | null {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p || !cursorToken) return null;

  try {
    const nowIso = new Date().toISOString();
    const row = db.prepare(`
      SELECT cursor_id, phone, loja_slug, query_hash, snapshot_time,
             last_data_inicio_iso, last_os_id, page_number, page_size,
             cursor_token, filters_json, created_at, expires_at
      FROM hydra_turn_cursors
      WHERE phone = ? AND cursor_token = ?
    `).get(p, cursorToken) as any;

    if (!row) return null;

    if (row.expires_at && row.expires_at < nowIso) {
      db.prepare('DELETE FROM hydra_turn_cursors WHERE cursor_id = ?').run(row.cursor_id);
      return null;
    }

    return {
      cursorId: row.cursor_id,
      phone: row.phone,
      lojaSlug: row.loja_slug,
      queryHash: row.query_hash,
      snapshotTime: row.snapshot_time,
      lastDataInicioIso: row.last_data_inicio_iso || undefined,
      lastOsId: row.last_os_id || undefined,
      pageNumber: Number(row.page_number) || 1,
      pageSize: Number(row.page_size) || 20,
      cursorToken: row.cursor_token,
      filtersJson: row.filters_json || undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao recuperar cursor:', err?.message || err);
    return null;
  }
}

/**
 * Invalida cursores de paginação para um telefone, opcionalmente filtrando por loja.
 */
export function invalidateTurnCursors(
  db: Database.Database,
  phone: string,
  lojaSlug?: string
): number {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return 0;

  try {
    let res: any;
    if (lojaSlug) {
      res = db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ? AND loja_slug = ?').run(p, lojaSlug);
    } else {
      res = db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ?').run(p);
    }
    try {
      db.prepare('UPDATE hydra_turn_contexts SET active_cursor = NULL WHERE phone = ?').run(p);
    } catch {}
    return res.changes || 0;
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao invalidar cursores:', err?.message || err);
    return 0;
  }
}

/**
 * Invalidação atômica de contexto de turno e cursores (usado em /reset e sanitizações).
 */
export function invalidateTurnContextAndCursors(
  db: Database.Database,
  phone: string,
  reason: string = 'reset_or_persona_switch'
): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;

  try {
    db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ?').run(p);
    db.prepare('DELETE FROM hydra_turn_contexts WHERE phone = ?').run(p);
  } catch (err: any) {
    console.error(`[TURN_CONTEXT] Erro ao invalidar contexto e cursores (${reason}):`, err?.message || err);
  }
}

/**
 * Invalidação atômica ao alternar persona (/socio, /{loja}).
 * Garante que cursores, buscas e anáforas de outras lojas sejam sumariamente descartados.
 */
export function invalidateContextOnPersonaSwitch(
  db: Database.Database,
  phone: string,
  newPersona: 'socio' | 'gerente',
  newLojaSlug?: string
): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;

  try {
    // 1. Limpeza atômica de todos os cursores para este telefone
    db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ?').run(p);

    const nowIso = new Date().toISOString();
    const existing = getLatestTurnState(db, p, 1440);

    if (newPersona === 'socio') {
      db.prepare(`
        INSERT INTO hydra_turn_contexts (
          phone, last_turn_id, last_intent, loja_slug, placa, os_id,
          filters_json, last_message_id, last_response_text, active_cursor,
          pending_request_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          last_intent = excluded.last_intent,
          loja_slug = NULL,
          placa = NULL,
          os_id = NULL,
          filters_json = excluded.filters_json,
          active_cursor = NULL,
          pending_request_json = NULL,
          updated_at = excluded.updated_at
      `).run(
        p,
        existing?.lastTurnId || `switch_socio_${Date.now()}`,
        'store_overview',
        null,
        null,
        null,
        JSON.stringify({ scope: 'network' }),
        existing?.lastMessageId || null,
        existing?.lastResponseText || null,
        null,
        null,
        nowIso
      );
    } else {
      db.prepare(`
        INSERT INTO hydra_turn_contexts (
          phone, last_turn_id, last_intent, loja_slug, placa, os_id,
          filters_json, last_message_id, last_response_text, active_cursor,
          pending_request_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          last_intent = excluded.last_intent,
          loja_slug = excluded.loja_slug,
          placa = NULL,
          os_id = NULL,
          filters_json = excluded.filters_json,
          active_cursor = NULL,
          pending_request_json = NULL,
          updated_at = excluded.updated_at
      `).run(
        p,
        existing?.lastTurnId || `switch_store_${Date.now()}`,
        'store_overview',
        newLojaSlug || null,
        null,
        null,
        JSON.stringify({ scope: 'store', lojaSlug: newLojaSlug }),
        existing?.lastMessageId || null,
        existing?.lastResponseText || null,
        null,
        null,
        nowIso
      );
    }
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao alternar persona e invalidar contexto:', err?.message || err);
  }
}

/**
 * Resolve anáforas e continuações contextuais baseando-se no último estado do turno.
 * Ex.: 'Detalhes da 1128' seguido de 'Quero os detalhes', 'E o que falta nela?', 'Quais as peças?'.
 * Se a consulta atual pertencer a uma loja diferente da anterior, anáforas e continuações de OS
 * são terminantemente descartadas (proteção contra vazamento de contexto cross-store).
 */
export function resolveTurnContinuity(
  message: string,
  previousState?: TurnState | null,
  currentLojaSlug?: string
): {
  osId?: string;
  placa?: string;
  lojaSlug?: string;
  isContinuation: boolean;
  isTopicShift: boolean;
} {
  const norm = (message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Se o contexto atual é para uma loja diferente da anterior, descarta continuidade e anáforas de OS
  if (currentLojaSlug && previousState?.lojaSlug && currentLojaSlug !== previousState.lojaSlug) {
    return {
      lojaSlug: currentLojaSlug,
      isContinuation: false,
      isTopicShift: true
    };
  }

  // Detecta se a mensagem menciona explicitamente outra loja
  const hasStoreMention = /\b(jabaquara|dom\s*pedro|santo\s*andre|kennedy|jorge\s*beretta|rudge\s*ramos|saocarlos)\b/i.test(norm);
  if (hasStoreMention && previousState?.lojaSlug) {
    const prev = previousState.lojaSlug.toLowerCase();
    const isDifferent =
      (norm.includes('jabaquara') && !prev.includes('jabaquara')) ||
      (norm.includes('santo andre') && !prev.includes('santoandre')) ||
      (norm.includes('kennedy') && !prev.includes('kennedy')) ||
      (norm.includes('dom pedro') && !prev.includes('dompedro')) ||
      (norm.includes('jorge beretta') && !prev.includes('jorgeberetta')) ||
      (norm.includes('rudge ramos') && !prev.includes('rudgeramos'));

    if (isDifferent) {
      return {
        isContinuation: false,
        isTopicShift: true
      };
    }
  }

  // Detecta mudança explícita de assunto para finanças/metas
  const isFinanceTopic = /\b(faturamento|meta|metas|receita|quanto vendeu|vendeu|vendas|cmv|lucro)\b/i.test(norm);
  if (isFinanceTopic && !/\b(os|ordem|1128|\d{3,6})\b/i.test(norm)) {
    return {
      lojaSlug: previousState?.lojaSlug,
      isContinuation: false,
      isTopicShift: true
    };
  }

  // Detecta anáfora ou aprofundamento de OS
  const isAnaphora =
    /\b(detalhe|detalhes|quero os detalhes|ver detalhes|mais detalhes)\b/i.test(norm) ||
    /\b(nela|dela|dele|dessa os|nessa os|dessa ordem|nessa ordem|desse carro|deste carro)\b/i.test(norm) ||
    /\b(o que falta|o que falta nela|falta nela|pecas dela|servicos dela|situacao dela)\b/i.test(norm) ||
    norm === 'quero os detalhes' ||
    norm === 'detalhes' ||
    norm === 'mais detalhes' ||
    norm.startsWith('e o que falta') ||
    norm.startsWith('e nela');

  if (isAnaphora && previousState?.osId) {
    return {
      osId: previousState.osId,
      placa: previousState.placa,
      lojaSlug: previousState.lojaSlug,
      isContinuation: true,
      isTopicShift: false
    };
  }

  return {
    lojaSlug: previousState?.lojaSlug,
    isContinuation: false,
    isTopicShift: false
  };
}

/**
 * Expurgar cache de dados de rede ao alternar Sócio -> Gerente.
 * Limpa escopo de rede, rankings, cursores e referências globais do estado de turno,
 * travando o contexto estritamente na loja do gerente.
 */
export function purgeNetworkCacheOnRoleSwitch(
  db: Database.Database,
  phone: string,
  newLojaSlug?: string
): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;

  try {
    // Invalida cursores ao trocar papel
    invalidateTurnCursors(db, p);

    const existing = getLatestTurnState(db, p, 1440);
    const nowIso = new Date().toISOString();

    const cleanedFilters: TurnFilters = { ...(existing?.filters || {}) };
    delete cleanedFilters.scope;
    delete cleanedFilters.networkData;
    delete cleanedFilters.ranking;
    delete cleanedFilters.faturamentoRede;
    delete cleanedFilters.all_stores;
    delete cleanedFilters.focusWorst;

    if (newLojaSlug) {
      cleanedFilters.lojaSlug = newLojaSlug;
      cleanedFilters.scope = 'store';
    }

    db.prepare(`
      INSERT INTO hydra_turn_contexts (
        phone, last_turn_id, last_intent, loja_slug, placa, os_id,
        filters_json, last_message_id, last_response_text, active_cursor,
        pending_request_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        last_intent = excluded.last_intent,
        loja_slug = excluded.loja_slug,
        placa = excluded.placa,
        os_id = excluded.os_id,
        filters_json = excluded.filters_json,
        active_cursor = NULL,
        pending_request_json = NULL,
        updated_at = excluded.updated_at
    `).run(
      p,
      existing?.lastTurnId || `switch_${Date.now()}`,
      'store_overview',
      newLojaSlug || null,
      null, // limpa placa
      null, // limpa os_id
      JSON.stringify(cleanedFilters),
      existing?.lastMessageId || null,
      existing?.lastResponseText || null,
      null,
      null,
      nowIso
    );
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao expurgar cache de rede na troca de papel:', err?.message || err);
  }
}

/**
 * Verifica se a mensagem atual é uma duplicata (replay) por messageId idêntico.
 */
export function isReplayMessage(
  db: Database.Database,
  phone: string,
  messageId?: number
): boolean {
  if (messageId == null) return false;
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return false;

  try {
    const row = db.prepare(`
      SELECT last_message_id
      FROM hydra_turn_contexts
      WHERE phone = ?
    `).get(p) as { last_message_id: number | null } | undefined;

    if (!row || row.last_message_id == null) return false;
    return Number(row.last_message_id) === Number(messageId);
  } catch {
    return false;
  }
}

/**
 * Limpa o estado da conversa e os cursores (usado em /reset e testes intencionais).
 */
export function clearTurnState(db: Database.Database, phone: string): void {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;
  try {
    db.prepare('DELETE FROM hydra_turn_contexts WHERE phone = ?').run(p);
    db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ?').run(p);
  } catch {}
}

/**
 * Expira o foco de OS (os_id e placa) e cursores quando ultrapassado o TTL de 120 minutos,
 * preservando estritamente a identidade, permissão e preferências do operador.
 */
export function expireStaleOSFocus(
  db: Database.Database,
  phone: string,
  maxAgeMinutes: number = 120
): boolean {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return false;

  try {
    const row = db.prepare(`
      SELECT updated_at, os_id, placa FROM hydra_turn_contexts WHERE phone = ?
    `).get(p) as { updated_at: string; os_id?: string; placa?: string } | undefined;

    if (!row || !row.os_id) return false;

    const updatedAtMillis = new Date(row.updated_at).getTime();
    if (Number.isFinite(updatedAtMillis)) {
      const ageMs = Date.now() - updatedAtMillis;
      if (ageMs > maxAgeMinutes * 60 * 1000) {
        db.prepare(`
          UPDATE hydra_turn_contexts
          SET os_id = NULL, placa = NULL, active_cursor = NULL
          WHERE phone = ?
        `).run(p);
        db.prepare('DELETE FROM hydra_turn_cursors WHERE phone = ?').run(p);
        return true;
      }
    }
    return false;
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao expirar foco de OS:', err?.message || err);
    return false;
  }
}

/**
 * Recupera o agy_conversation_id persistido para o telefone do usuário.
 */
export function getAgyConversationId(db: Database.Database, phone: string): string | null {
  try {
    ensureTurnContextTable(db);
    const p = cleanPhone(phone);
    const row = db.prepare(
      'SELECT agy_conversation_id FROM hydra_turn_contexts WHERE phone = ?'
    ).get(p) as { agy_conversation_id?: string } | undefined;
    return row?.agy_conversation_id ?? null;
  } catch (err: any) {
    return null;
  }
}

/**
 * Persiste ou atualiza o agy_conversation_id associado ao telefone do usuário.
 */
export function setAgyConversationId(db: Database.Database, phone: string, conversationId: string): void {
  try {
    ensureTurnContextTable(db);
    const p = cleanPhone(phone);
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT phone FROM hydra_turn_contexts WHERE phone = ?').get(p);
    if (existing) {
      db.prepare(
        'UPDATE hydra_turn_contexts SET agy_conversation_id = ?, updated_at = ? WHERE phone = ?'
      ).run(conversationId, now, p);
    } else {
      db.prepare(`
        INSERT INTO hydra_turn_contexts (
          phone, last_turn_id, last_intent, updated_at, agy_conversation_id
        ) VALUES (?, 'init', 'other', ?, ?)
      `).run(p, now, conversationId);
    }
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao setar agy_conversation_id:', err?.message || err);
  }
}

/**
 * Limpa o agy_conversation_id do telefone do usuário (ex: em /reset).
 */
export function clearAgyConversationId(db: Database.Database, phone: string): void {
  try {
    ensureTurnContextTable(db);
    const p = cleanPhone(phone);
    db.prepare(
      'UPDATE hydra_turn_contexts SET agy_conversation_id = NULL WHERE phone = ?'
    ).run(p);
  } catch (err: any) {
    console.error('[TURN_CONTEXT] Erro ao limpar agy_conversation_id:', err?.message || err);
  }
}
