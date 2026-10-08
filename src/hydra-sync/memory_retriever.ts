/**
 * HYDRA MEMORY RETRIEVER (Frente 3 - hydra-memory-rag-isolation)
 * Recuperação RAG de Memórias Atômicas Estruturadas com Isolamento Estrito de Escopo.
 * 
 * Regras de Ouro:
 * 1. Escopo Efetivo:
 *    - Se effectivePersona === 'gerente': filtra estritamente por ((scope_type = 'loja' AND loja_slug = :activeLojaSlug) OR scope_type = 'perfil_global'). ZERO memórias de rede permitidas!
 *    - Se effectivePersona === 'socio': filtra por (scope_type = 'rede' OR scope_type = 'perfil_global').
 * 2. Pré-filtros SQL obrigatórios:
 *    phone = :phone, generation_id = :generationId, status = 'active', (expires_at IS NULL OR expires_at > datetime('now')).
 * 3. Precedência:
 *    correction (1) -> explicit_preference (2) -> derived_interest (3) -> confirmed_at DESC.
 * 4. Limite restrito: top-3 memórias mais relevantes (<150 tokens no prompt).
 * 5. Arquitetura Dual-Layer: SQLite indexado primário (<5ms) com fallback gracioso se busca vetorial falhar.
 */

import type Database from 'better-sqlite3';
import { cleanPhone } from './user_memory_repository.js';
import type {
  MemoryRecord,
  MemoryRetrievalFilter,
  MemoryRetrievalResult,
  MemoryType,
  MemoryScopeType,
  MemoryStatus
} from './types/memory_contract.js';

export {
  MemoryRecord,
  MemoryRetrievalFilter,
  MemoryRetrievalResult,
  MemoryType,
  MemoryScopeType,
  MemoryStatus
};

/**
 * Mapeia linha crua do SQLite para a interface canônica MemoryRecord.
 */
export function mapRowToMemoryRecord(row: any): MemoryRecord {
  let sourceTurnIds: string[] = [];
  try {
    sourceTurnIds = typeof row.source_turn_ids === 'string'
      ? JSON.parse(row.source_turn_ids)
      : (Array.isArray(row.source_turn_ids) ? row.source_turn_ids : []);
  } catch {
    sourceTurnIds = [];
  }

  let distinctDays: string[] = [];
  try {
    distinctDays = typeof row.distinct_days_json === 'string'
      ? JSON.parse(row.distinct_days_json)
      : (Array.isArray(row.distinct_days_json) ? row.distinct_days_json : []);
  } catch {
    distinctDays = [];
  }

  return {
    memoryId: String(row.memory_id),
    phone: String(row.phone),
    generationId: Number(row.generation_id),
    scopeType: row.scope_type as MemoryScopeType,
    lojaSlug: row.loja_slug ? String(row.loja_slug) : null,
    memoryType: row.memory_type as MemoryType,
    topicKey: String(row.topic_key),
    contentNormalized: String(row.content_normalized),
    evidenceText: String(row.evidence_text || ''),
    sourceTurnIds,
    status: (row.status || 'active') as MemoryStatus,
    confidence: Number(row.confidence ?? 1.0),
    occurrenceCount: Number(row.occurrence_count ?? 1),
    distinctDays,
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    createdAt: String(row.created_at),
    confirmedAt: String(row.confirmed_at || row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined
  };
}

/**
 * Converte tipo de memória para rótulo legível em português.
 */
export function formatMemoryTypeLabel(type: MemoryType): string {
  switch (type) {
    case 'correction':
      return 'Correção';
    case 'explicit_preference':
      return 'Preferência';
    case 'derived_interest':
      return 'Interesse';
    default:
      return type;
  }
}

/**
 * Converte timestamp/data para formato DD/MM/AAAA.
 */
export function formatMemoryDate(rawDate?: string): string {
  if (!rawDate) return '';
  try {
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) {
      const m = String(rawDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
      return String(rawDate);
    }
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return String(rawDate);
  }
}

/**
 * Formata lista de memórias para injeção concisa no prompt (<150 tokens).
 * Formato padrão:
 * # PREFERÊNCIAS E CORREÇÕES CONFIRMADAS DO OPERADOR (Geração X):
 * - [Tipo] Regra (Confirmado em DD/MM/AAAA)
 */
export function formatMemoriesForPrompt(memories: MemoryRecord[], generationId: number): string {
  if (!memories || memories.length === 0) {
    return '';
  }

  const lines = [
    `# PREFERÊNCIAS E CORREÇÕES CONFIRMADAS DO OPERADOR (Geração ${generationId}):`
  ];

  for (const m of memories) {
    const label = formatMemoryTypeLabel(m.memoryType);
    const dateFormatted = formatMemoryDate(m.confirmedAt || m.createdAt);
    const datePart = dateFormatted ? ` (Confirmado em ${dateFormatted})` : '';
    lines.push(`- [${label}] ${m.contentNormalized}${datePart}`);
  }

  return lines.join('\n');
}

/**
 * Validador em memória para checagem estrita de escopo.
 */
export function isMemoryAllowedInScope(memory: MemoryRecord, filter: MemoryRetrievalFilter): boolean {
  if (filter.effectivePersona === 'gerente') {
    if (memory.scopeType === 'perfil_global') return true;
    if (memory.scopeType === 'loja') {
      if (!filter.activeLojaSlug) return false;
      return (memory.lojaSlug || '').toLowerCase() === filter.activeLojaSlug.toLowerCase();
    }
    // NUNCA permite 'rede' para gerente
    return false;
  } else {
    // Sócio: permite apenas rede ou perfil_global
    return memory.scopeType === 'rede' || memory.scopeType === 'perfil_global';
  }
}

/**
 * Ordena memórias por precedência de tipo e data de confirmação.
 */
export function sortMemoriesByPrecedence(memories: MemoryRecord[]): MemoryRecord[] {
  const typeWeight: Record<MemoryType, number> = {
    correction: 1,
    explicit_preference: 2,
    derived_interest: 3
  };

  return [...memories].sort((a, b) => {
    const wa = typeWeight[a.memoryType] || 4;
    const wb = typeWeight[b.memoryType] || 4;
    if (wa !== wb) return wa - wb;
    return new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime();
  });
}

/**
 * Implementação síncrona de recuperação de memórias ativas com base no filtro e isolamento de escopo efetivo.
 * Primária indexada no SQLite (<5ms).
 */
export function retrieveActiveMemoriesSync(
  db: Database.Database,
  filter: MemoryRetrievalFilter
): MemoryRetrievalResult {
  const startTime = Date.now();
  const phoneClean = cleanPhone(filter.phone);
  const genId = Number(filter.generationId);
  const maxItems = filter.maxItems && filter.maxItems > 0 ? filter.maxItems : 3;
  const nowIso = new Date().toISOString();

  // Camada Primaria Deterministica: Busca Estruturada Direta Indexada (<5ms)
  // [E3-E2.3]: JOIN vetorial cego sem operador MATCH/KNN desativado para garantir retrieval deterministico <5ms
  const whereClauses: string[] = [
    `phone = ?`,
    `generation_id = ?`,
    `status = 'active'`,
    `(expires_at IS NULL OR expires_at > ?)`
  ];

  const params: any[] = [phoneClean, genId, nowIso];

  // REGRA DE OURO DO ESCOPO EFETIVO:
  if (filter.effectivePersona === 'gerente') {
    if (filter.activeLojaSlug && filter.activeLojaSlug.trim().length > 0) {
      whereClauses.push(`((scope_type = 'loja' AND LOWER(loja_slug) = LOWER(?)) OR scope_type = 'perfil_global')`);
      params.push(filter.activeLojaSlug.trim());
    } else {
      whereClauses.push(`scope_type = 'perfil_global'`);
    }
    // Proibição expressa: scope_type = 'rede' NUNCA passa para gerente
  } else {
    // Sócio / Diretoria: Apenas escopo de rede e perfil global
    whereClauses.push(`(scope_type = 'rede' OR scope_type = 'perfil_global')`);
  }

  // Filtro opcional por topicKey
  if (filter.topicKey) {
    whereClauses.push(`LOWER(topic_key) = LOWER(?)`);
    params.push(filter.topicKey.trim());
  }

  // Precedência obrigatória: correction (1) -> explicit_preference (2) -> derived_interest (3) -> confirmed_at DESC
  const sql = `
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
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY
      CASE memory_type
        WHEN 'correction' THEN 1
        WHEN 'explicit_preference' THEN 2
        WHEN 'derived_interest' THEN 3
        ELSE 4
      END ASC,
      confirmed_at DESC
    LIMIT ?
  `;

  params.push(maxItems);

  let rows: any[] = [];
  try {
    rows = db.prepare(sql).all(...params);
  } catch (err: any) {
    console.warn('[MEMORY_RETRIEVER] Erro na consulta de memórias ativas:', err?.message || err);
    rows = [];
  }

  const memories = rows.map(mapRowToMemoryRecord);
  const latencyMs = Math.max(1, Date.now() - startTime);
  const source = memories.length > 0 ? 'structured_direct' : 'fallback_empty';
  const formattedContext = formatMemoriesForPrompt(memories, genId);

  return {
    memories,
    formattedContext,
    source,
    latencyMs
  };
}

/**
 * Recupera memórias ativas com base no filtro e isolamento de escopo efetivo (Interface Assíncrona).
 */
export async function retrieveActiveMemories(
  db: Database.Database,
  filter: MemoryRetrievalFilter
): Promise<MemoryRetrievalResult> {
  return retrieveActiveMemoriesSync(db, filter);
}

/**
 * Busca memórias ativas filtradas por tópico semântico específico.
 */
export async function getMemoriesByTopic(
  db: Database.Database,
  filter: MemoryRetrievalFilter
): Promise<MemoryRecord[]> {
  const res = retrieveActiveMemoriesSync(db, filter);
  return res.memories;
}

/**
 * Salva ou atualiza um registro de memória atômica com garantia de campos obrigatórios.
 */
export function saveMemoryRecord(
  db: Database.Database,
  record: {
    memoryId: string;
    phone: string;
    generationId: number;
    scopeType: MemoryScopeType;
    lojaSlug?: string | null;
    memoryType: MemoryType;
    topicKey: string;
    contentNormalized: string;
    evidenceText: string;
    sourceTurnIds?: string[];
    status?: MemoryStatus;
    confidence?: number;
    occurrenceCount?: number;
    distinctDays?: string[];
    confirmedAt?: string;
    expiresAt?: string;
  }
): MemoryRecord {
  const phoneClean = cleanPhone(record.phone);
  const nowIso = new Date().toISOString();
  const turnIdsJson = JSON.stringify(record.sourceTurnIds || []);
  const daysJson = JSON.stringify(record.distinctDays || []);
  const confirmed = record.confirmedAt || nowIso;
  const status = record.status || 'active';
  const confidence = record.confidence ?? 1.0;
  const occurrence = record.occurrenceCount ?? 1;

  db.prepare(`
    INSERT INTO hydra_memories (
      memory_id, phone, generation_id, scope_type, loja_slug,
      memory_type, topic_key, content_normalized, evidence_text,
      source_turn_ids, status, confidence, occurrence_count,
      distinct_days_json, created_at, confirmed_at, expires_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
    ON CONFLICT(memory_id) DO UPDATE SET
      generation_id = excluded.generation_id,
      scope_type = excluded.scope_type,
      loja_slug = excluded.loja_slug,
      memory_type = excluded.memory_type,
      topic_key = excluded.topic_key,
      content_normalized = excluded.content_normalized,
      evidence_text = excluded.evidence_text,
      source_turn_ids = excluded.source_turn_ids,
      status = excluded.status,
      confidence = excluded.confidence,
      occurrence_count = excluded.occurrence_count,
      distinct_days_json = excluded.distinct_days_json,
      confirmed_at = excluded.confirmed_at,
      expires_at = excluded.expires_at
  `).run(
    record.memoryId,
    phoneClean,
    record.generationId,
    record.scopeType,
    record.lojaSlug || null,
    record.memoryType,
    record.topicKey,
    record.contentNormalized,
    record.evidenceText,
    turnIdsJson,
    status,
    confidence,
    occurrence,
    daysJson,
    nowIso,
    confirmed,
    record.expiresAt || null
  );

  return {
    memoryId: record.memoryId,
    phone: phoneClean,
    generationId: record.generationId,
    scopeType: record.scopeType,
    lojaSlug: record.lojaSlug || null,
    memoryType: record.memoryType,
    topicKey: record.topicKey,
    contentNormalized: record.contentNormalized,
    evidenceText: record.evidenceText,
    sourceTurnIds: record.sourceTurnIds || [],
    status,
    confidence,
    occurrenceCount: occurrence,
    distinctDays: record.distinctDays || [],
    createdAt: nowIso,
    confirmedAt: confirmed,
    expiresAt: record.expiresAt
  };
}

/**
 * Marca uma memória existente como 'superseded' e registra o ID da nova memória sucessora.
 */
export function supersedeMemory(
  db: Database.Database,
  oldMemoryId: string,
  newMemoryId: string
): void {
  db.prepare(`
    UPDATE hydra_memories
    SET status = 'superseded',
        superseded_by = ?
    WHERE memory_id = ?
  `).run(newMemoryId, oldMemoryId);
}

/**
 * Invalida uma memória (status = 'invalidated').
 */
export function invalidateMemory(
  db: Database.Database,
  memoryId: string
): void {
  db.prepare(`
    UPDATE hydra_memories
    SET status = 'invalidated'
    WHERE memory_id = ?
  `).run(memoryId);
}
