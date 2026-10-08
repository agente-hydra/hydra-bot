/**
 * Consolidador Determinístico de Memória Sem LLM do Hydra
 * Implementação da Frente 2 (hydra-memory-rag-isolation)
 *
 * Princípios Inegociáveis:
 * 1. Zero chamadas a APIs de LLM e zero mensagens enviadas ao WhatsApp.
 * 2. Agrupamento quíntuplo: (phone, generation_id, scope_type, loja_slug, topic_key).
 * 3. Deduplicação estável e idempotente por source_turn_ids.
 * 4. Janelas completas com watermark no fuso America/Sao_Paulo.
 * 5. Blindagem pós-reset: descarta commits atrasados caso a geração ativa do perfil tenha mudado.
 */

import type Database from 'better-sqlite3';
import type {
  MemoryRecord,
  MemoryStatus,
  MemoryType,
  MemoryScopeType
} from './types/memory_contract.js';
import { initHydraAccessAndMemorySchema } from './db_repository.js';
import { getSaoPauloDate } from './memory_repository.js';

export interface DailyConsolidationResult {
  consolidatedCount: number;
  promotedCount: number;
  supersededCount: number;
  discardedResetCount: number;
  watermark: string;
}

export interface WeeklyConsolidationResult {
  evaluatedCount: number;
  promotedCount: number;
  decayedCount: number;
  expiredCount: number;
  discardedResetCount: number;
  watermark: string;
}

export interface CheckpointRecord {
  jobType: string;
  lastProcessedTimestamp: string;
  lastProcessedTurnId: string | null;
  recordsConsolidated: number;
  updatedAt: string;
}

function safeParseJson<T>(val: any, fallback: T): T {
  if (!val) return fallback;
  if (typeof val !== 'string') return (val as T) || fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

/**
 * Converte qualquer timestamp ISO/SQLite para a data YYYY-MM-DD no fuso America/Sao_Paulo.
 */
export function timestampToSaoPauloDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return getSaoPauloDate();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Consulta a geração ativa (memory_generation) do perfil do usuário.
 * Se o usuário executou /reset, a geração ativa estará incrementada.
 */
export function getActiveGeneration(db: Database.Database, phone: string): number {
  try {
    const row = db.prepare(`
      SELECT memory_generation FROM hydra_user_profiles WHERE phone = ?
    `).get(phone) as any;
    if (row && row.memory_generation != null) {
      return Number(row.memory_generation) || 1;
    }
  } catch {}
  return 1;
}

/**
 * Lê o checkpoint de consolidação para o tipo de job.
 */
export function getConsolidationCheckpoint(
  db: Database.Database,
  jobType: 'daily_consolidation' | 'weekly_consolidation'
): CheckpointRecord {
  initHydraAccessAndMemorySchema(db);

  const row = db.prepare(`
    SELECT job_type, last_processed_timestamp, last_processed_turn_id, records_consolidated, updated_at
    FROM hydra_memory_consolidation_checkpoints
    WHERE job_type = ?
  `).get(jobType) as any;

  if (row) {
    return {
      jobType: row.job_type,
      lastProcessedTimestamp: row.last_processed_timestamp,
      lastProcessedTurnId: row.last_processed_turn_id || null,
      recordsConsolidated: Number(row.records_consolidated) || 0,
      updatedAt: row.updated_at
    };
  }

  return {
    jobType,
    lastProcessedTimestamp: '1970-01-01T00:00:00.000Z',
    lastProcessedTurnId: null,
    recordsConsolidated: 0,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Atualiza o checkpoint de consolidação com novo watermark.
 */
export function updateConsolidationCheckpoint(
  db: Database.Database,
  jobType: 'daily_consolidation' | 'weekly_consolidation',
  lastProcessedTimestamp: string,
  recordsAdded: number,
  lastTurnId?: string | null
): void {
  initHydraAccessAndMemorySchema(db);

  db.prepare(`
    INSERT INTO hydra_memory_consolidation_checkpoints (
      job_type,
      last_processed_timestamp,
      last_processed_turn_id,
      records_consolidated,
      updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(job_type) DO UPDATE SET
      last_processed_timestamp = excluded.last_processed_timestamp,
      last_processed_turn_id = excluded.last_processed_turn_id,
      records_consolidated = hydra_memory_consolidation_checkpoints.records_consolidated + excluded.records_consolidated,
      updated_at = CURRENT_TIMESTAMP
  `).run(jobType, lastProcessedTimestamp, lastTurnId || null, recordsAdded);
}

/**
 * Chave de AGRUPAMENTO QUÍNTUPLO:
 * (phone, generation_id, scope_type, loja_slug, topic_key)
 * O mesmo tópico em lojas diferentes ou gerações diferentes nunca se misturam!
 */
export function buildQuintupleKey(record: {
  phone: string;
  generation_id?: number;
  generationId?: number;
  scope_type?: string;
  scopeType?: string;
  loja_slug?: string | null;
  lojaSlug?: string | null;
  topic_key?: string;
  topicKey?: string;
}): string {
  const phone = record.phone;
  const gen = record.generation_id ?? record.generationId ?? 1;
  const scope = record.scope_type ?? record.scopeType ?? 'perfil_global';
  const loja = (record.loja_slug ?? record.lojaSlug ?? 'NULL').toLowerCase();
  const topic = (record.topic_key ?? record.topicKey ?? '').trim();
  return `${phone}:::${gen}:::${scope}:::${loja}:::${topic}`;
}

/**
 * Executa a Consolidação Diária (runDailyConsolidation):
 * - Agrupa registros candidatos pelo agrupamento quíntuplo
 * - Aplica precedência de correções (superseded)
 * - Atualiza distinct_days_json e source_turn_ids de forma idempotente
 * - BLINDAGEM PÓS-RESET: descarta qualquer alteração se a geração do perfil foi incrementada
 * - Salva watermark em America/Sao_Paulo
 */
export function runDailyConsolidation(
  db: Database.Database,
  refDate?: string
): DailyConsolidationResult {
  initHydraAccessAndMemorySchema(db);

  const targetDate = refDate || getSaoPauloDate();
  const checkpoint = getConsolidationCheckpoint(db, 'daily_consolidation');
  const nowIso = new Date().toISOString();

  let consolidatedCount = 0;
  let promotedCount = 0;
  let supersededCount = 0;
  let discardedResetCount = 0;

  // 1. Precedência de Correção:
  // Se houver registros de tipo 'correction', garante que registros anteriores
  // com o mesmo topicKey sejam marcados como superseded.
  const corrections = db.prepare(`
    SELECT memory_id, phone, generation_id, topic_key, created_at
    FROM hydra_memories
    WHERE memory_type = 'correction'
      AND status = 'active'
    ORDER BY created_at ASC
  `).all() as any[];

  for (const corr of corrections) {
    const activeGen = getActiveGeneration(db, corr.phone);
    if (activeGen !== Number(corr.generation_id)) {
      discardedResetCount++;
      continue;
    }

    const superseded = db.prepare(`
      UPDATE hydra_memories
      SET status = 'superseded',
          superseded_by = ?,
          confirmed_at = CURRENT_TIMESTAMP
      WHERE phone = ?
        AND generation_id = ?
        AND topic_key = ?
        AND memory_id != ?
        AND status IN ('active', 'candidate')
    `).run(corr.memory_id, corr.phone, corr.generation_id, corr.topic_key, corr.memory_id);

    supersededCount += superseded.changes;
  }

  // 2. Busca todos os registros ativos e candidatos para agrupamento quíntuplo
  const allRows = db.prepare(`
    SELECT 
      memory_id,
      phone,
      generation_id,
      scope_type,
      loja_slug,
      memory_type,
      topic_key,
      content_normalized,
      evidence_text,
      source_turn_ids,
      status,
      confidence,
      occurrence_count,
      distinct_days_json,
      superseded_by,
      created_at,
      confirmed_at,
      expires_at
    FROM hydra_memories
    WHERE status IN ('candidate', 'active')
    ORDER BY confirmed_at ASC
  `).all() as any[];

  // Agrupamento quíntuplo em memória
  const grouped = new Map<string, any[]>();
  for (const row of allRows) {
    const key = buildQuintupleKey(row);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row);
  }

  // 3. Processa cada grupo quíntuplo de forma atômica
  for (const [key, rows] of grouped.entries()) {
    const primary = rows[0];
    const phone = primary.phone;
    const generationId = Number(primary.generation_id);

    // BLINDAGEM PÓS-RESET:
    // Verifica se generation_id ainda é igual à memory_generation ativa do perfil.
    // Se o usuário rodou /reset, descarta o commit com rollback/skip.
    const activeGen = getActiveGeneration(db, phone);
    if (activeGen !== generationId) {
      discardedResetCount += rows.length;
      continue;
    }

    // Coleta union estável de sourceTurnIds e distinctDays
    const allTurnIds = new Set<string>();
    const allDays = new Set<string>();
    let maxConfidence = 0;
    let latestConfirmedAt = primary.confirmed_at || primary.created_at;

    for (const r of rows) {
      const turnIds = safeParseJson<string[]>(r.source_turn_ids, []);
      for (const t of turnIds) {
        if (t && t.trim().length > 0) allTurnIds.add(t.trim());
      }

      const days = safeParseJson<string[]>(r.distinct_days_json, []);
      for (const d of days) {
        if (d && d.trim().length > 0) allDays.add(d.trim());
      }
      // Garante também o dia da confirmação/criação em America/Sao_Paulo
      allDays.add(timestampToSaoPauloDate(r.confirmed_at || r.created_at));

      if (Number(r.confidence) > maxConfidence) {
        maxConfidence = Number(r.confidence);
      }
      if (r.confirmed_at && r.confirmed_at > latestConfirmedAt) {
        latestConfirmedAt = r.confirmed_at;
      }
    }

    const uniqueTurnIds = Array.from(allTurnIds);
    const uniqueDays = Array.from(allDays).sort();
    const occurrenceCount = uniqueTurnIds.length > 0 ? uniqueTurnIds.length : 1;

    // Se houver mais de uma linha para o mesmo agrupamento quíntuplo,
    // consolida tudo na linha primária (mais recente) e deleta as redundâncias
    const targetRow = rows[rows.length - 1]; // linha mais recente
    const otherRows = rows.slice(0, rows.length - 1);

    // Executa em transação protegida contra reset
    try {
      db.transaction(() => {
        // Checagem interna atômica de reset imediatamente antes do commit
        const checkGen = getActiveGeneration(db, phone);
        if (checkGen !== generationId) {
          throw new Error('RESET_DETECTED');
        }

        // Atualiza a linha canônica
        db.prepare(`
          UPDATE hydra_memories
          SET source_turn_ids = ?,
              distinct_days_json = ?,
              occurrence_count = ?,
              confidence = ?,
              confirmed_at = ?
          WHERE memory_id = ?
        `).run(
          JSON.stringify(uniqueTurnIds),
          JSON.stringify(uniqueDays),
          occurrenceCount,
          maxConfidence,
          latestConfirmedAt,
          targetRow.memory_id
        );

        // Remove duplicatas redundantes do mesmo grupo
        for (const extra of otherRows) {
          db.prepare(`DELETE FROM hydra_memories WHERE memory_id = ?`).run(extra.memory_id);
        }
      })();

      consolidatedCount++;
    } catch (err: any) {
      if (err?.message === 'RESET_DETECTED') {
        discardedResetCount += rows.length;
      } else {
        console.error(`[CONSOLIDATOR] Erro ao consolidar grupo ${key}:`, err);
      }
    }
  }

  // 4. Atualiza watermark com o timestamp atual
  updateConsolidationCheckpoint(db, 'daily_consolidation', nowIso, consolidatedCount);

  return {
    consolidatedCount,
    promotedCount,
    supersededCount,
    discardedResetCount,
    watermark: nowIso
  };
}

/**
 * Executa a Consolidação Semanal (runWeeklyConsolidation):
 * - Avalia registros dos últimos 7 dias.
 * - Para 'derived_interest':
 *   * Exige no mínimo 2 dias distintos (distinctDays.length >= 2) para promoção a status 'active'.
 *   * Interesses com 1 único dia sofrem decaimento (confidence *= 0.5) e expiram em 14 dias se não reconfirmados.
 * - BLINDAGEM PÓS-RESET: descarta qualquer alteração se a geração do perfil mudou.
 * - Zero chamadas a APIs de LLM e zero mensagens enviadas ao WhatsApp.
 */
export function runWeeklyConsolidation(
  db: Database.Database,
  refDate?: string
): WeeklyConsolidationResult {
  initHydraAccessAndMemorySchema(db);

  const targetDate = refDate || getSaoPauloDate();
  const nowIso = new Date().toISOString();

  let evaluatedCount = 0;
  let promotedCount = 0;
  let decayedCount = 0;
  let expiredCount = 0;
  let discardedResetCount = 0;

  // Busca registros de derived_interest ativos ou candidatos
  const candidates = db.prepare(`
    SELECT 
      memory_id,
      phone,
      generation_id,
      scope_type,
      loja_slug,
      memory_type,
      topic_key,
      content_normalized,
      evidence_text,
      source_turn_ids,
      status,
      confidence,
      occurrence_count,
      distinct_days_json,
      created_at,
      confirmed_at,
      expires_at
    FROM hydra_memories
    WHERE memory_type = 'derived_interest'
      AND status IN ('candidate', 'active')
    ORDER BY confirmed_at ASC
  `).all() as any[];

  for (const record of candidates) {
    const phone = record.phone;
    const generationId = Number(record.generation_id);

    // BLINDAGEM PÓS-RESET:
    const activeGen = getActiveGeneration(db, phone);
    if (activeGen !== generationId) {
      discardedResetCount++;
      continue;
    }

    evaluatedCount++;
    const distinctDays = safeParseJson<string[]>(record.distinct_days_json, []);

    try {
      db.transaction(() => {
        const checkGen = getActiveGeneration(db, phone);
        if (checkGen !== generationId) {
          throw new Error('RESET_DETECTED');
        }

        // REGRA DE PROMOÇÃO SEMANAL:
        // Exige no mínimo 2 dias distintos para promoção a preferência ativa estável
        if (distinctDays.length >= 2) {
          const newConfidence = Math.min(1.0, Math.round(((Number(record.confidence) || 0.8) + 0.1) * 100) / 100);

          db.prepare(`
            UPDATE hydra_memories
            SET status = 'active',
                confidence = ?,
                confirmed_at = CURRENT_TIMESTAMP
            WHERE memory_id = ?
          `).run(newConfidence, record.memory_id);

          promotedCount++;
        } else {
          // Apenas 1 dia: sofre decaimento (confidence *= 0.5) e expira em 14 dias
          const decayedConfidence = Math.round((Number(record.confidence) || 0.8) * 0.5 * 100) / 100;

          // Calcula expiração em 14 dias a partir de targetDate
          const refEpoch = new Date(`${targetDate}T23:59:59-03:00`).getTime();
          const expiresAt = new Date(refEpoch + 14 * 86400000).toISOString();

          let newStatus: MemoryStatus = 'candidate';
          if (decayedConfidence < 0.1) {
            newStatus = 'expired';
            expiredCount++;
          } else {
            decayedCount++;
          }

          db.prepare(`
            UPDATE hydra_memories
            SET status = ?,
                confidence = ?,
                expires_at = ?,
                confirmed_at = CURRENT_TIMESTAMP
            WHERE memory_id = ?
          `).run(newStatus, decayedConfidence, expiresAt, record.memory_id);
        }
      })();
    } catch (err: any) {
      if (err?.message === 'RESET_DETECTED') {
        discardedResetCount++;
      } else {
        console.error(`[WEEKLY_CONSOLIDATOR] Erro ao consolidar record ${record.memory_id}:`, err);
      }
    }
  }

  // Atualiza watermark de consolidação semanal
  updateConsolidationCheckpoint(db, 'weekly_consolidation', nowIso, evaluatedCount);

  return {
    evaluatedCount,
    promotedCount,
    decayedCount,
    expiredCount,
    discardedResetCount,
    watermark: nowIso
  };
}

export interface ScheduledConsolidationResult {
  jobType: 'daily' | 'weekly';
  status: 'SUCCESS' | 'ERROR';
  checkpoint: CheckpointRecord;
  dailyResult?: DailyConsolidationResult;
  weeklyResult?: WeeklyConsolidationResult;
  executedAt: string;
}

/**
 * Agendamento observavel de consolidacao deterministica (Frente 2 / E5-E2).
 * - Executa consolidacao diaria ou semanal conforme jobType.
 * - Registra observabilidade em hydra_memory_consolidation_checkpoints.
 * - ZERO consumo de tokens LLM.
 * - ZERO envio de mensagens no WhatsApp.
 */
export function runScheduledConsolidation(
  db: Database.Database,
  jobType: 'daily' | 'weekly' | 'daily_consolidation' | 'weekly_consolidation',
  targetDate?: string
): ScheduledConsolidationResult {
  initHydraAccessAndMemorySchema(db);
  const nowIso = new Date().toISOString();
  const normalizedJobType = (jobType === 'weekly' || jobType === 'weekly_consolidation')
    ? 'weekly'
    : 'daily';

  if (normalizedJobType === 'weekly') {
    const weeklyResult = runWeeklyConsolidation(db, targetDate);
    const checkpoint = getConsolidationCheckpoint(db, 'weekly_consolidation');
    return {
      jobType: 'weekly',
      status: 'SUCCESS',
      checkpoint,
      weeklyResult,
      executedAt: nowIso
    };
  } else {
    const dailyResult = runDailyConsolidation(db, targetDate);
    const checkpoint = getConsolidationCheckpoint(db, 'daily_consolidation');
    return {
      jobType: 'daily',
      status: 'SUCCESS',
      checkpoint,
      dailyResult,
      executedAt: nowIso
    };
  }
}
