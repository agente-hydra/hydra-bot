/**
 * Repositório Atômico de Memória Estruturada do Hydra
 * Implementação da Frente 2 (hydra-memory-rag-isolation)
 *
 * Responsável por:
 * 1. Persistência atômica e versionamento de memórias (saveMemoryRecord, updateMemoryStatus)
 * 2. Recuperação com escopo estrito de persona (getMemoriesByTopic)
 * 3. Invalidação de gerações anteriores pós-reset (invalidateGenerationMemories)
 * 4. Validador balanceado anti-alucinação factual (validateAndPersistMemoryCandidates)
 * 5. Deduplicação idempotente por sourceTurnIds e precedência de correções
 */

import type Database from 'better-sqlite3';
import crypto from 'crypto';
import type {
  MemoryRecord,
  MemoryCandidate,
  MemoryRetrievalFilter,
  MemoryRetrievalResult,
  MemoryStatus,
  MemoryType,
  MemoryScopeType
} from './types/memory_contract.js';
import { initHydraAccessAndMemorySchema } from './db_repository.js';
import { saveVaultNoteWithGenerationCheck, getVaultRoot } from './vault_manager.js';
import type { VaultFrontmatter } from './types/vault_contract.js';

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
 * Retorna a data no fuso horário America/Sao_Paulo no formato YYYY-MM-DD
 */
export function getSaoPauloDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * Validador Factual Balanceado Anti-Alucinação:
 * - REJEITA fatos operacionais voláteis transitórios concretos (valores monetários R$,
 *   centavos, saldos de OSs específicas, placas de veículos, faturamentos de datas concretas).
 * - ACEITA preferências e regras legítimas contendo termos como "faturamento", "%" e números
 *   (ex: "prefiro faturamento antes de OS", "mostre CMV em % com duas casas", "retidos significa mais de 5 dias").
 */
export function isVolatileFactualCandidate(candidate: MemoryCandidate): { isVolatile: boolean; reason?: string } {
  const content = (candidate.contentNormalized || '').trim();
  const evidence = (candidate.evidenceText || '').trim();
  const combined = `${content} ${evidence}`;

  // 1. Valores monetários específicos com R$ ou menção direta de valores em reais
  if (/R\$\s*[\d.,]+/i.test(combined)) {
    return { isVolatile: true, reason: 'Contém valor monetário explícito (R$)' };
  }
  if (/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/.test(combined)) {
    return { isVolatile: true, reason: 'Contém formato numérico de centavos monetários' };
  }
  if (/\b\d+\s*(?:reais|mil\s*reais)\b/i.test(combined)) {
    return { isVolatile: true, reason: 'Contém valor monetário em reais' };
  }

  // 2. Saldos ou valores vinculados a Ordens de Serviço específicas
  if (
    /(?:saldo|total|devedor|pend[êe]ncia)\s+(?:da|de|na|em)?\s*(?:os|ordem)\s*#?\d+/i.test(combined) ||
    /(?:os|ordem)\s*#?\d+\s+.*(?:saldo|devedor|total|pend[êe]ncia)/i.test(combined) ||
    /(?:saldo|devedor)\s*[:=]\s*\d+/i.test(combined)
  ) {
    return { isVolatile: true, reason: 'Contém saldo ou pendência financeira de OS específica' };
  }

  // 3. Placas de veículos automotores (formato Mercosul ABC1D23 ou antigo ABC-1234 / ABC 1234)
  const platePattern = /\b[A-Za-z]{3}[-\s]?[0-9][A-Za-z0-9][0-9]{2}\b/;
  if (
    platePattern.test(combined) &&
    (/placa|ve[ií]culo|carro|auto/i.test(combined) || /\b[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}\b/.test(content))
  ) {
    return { isVolatile: true, reason: 'Contém placa de veículo específica' };
  }

  // 4. Faturamentos realizados ou métricas operacionais de datas concretas / períodos voláteis
  if (
    /(?:faturamento|faturou|vendas?|meta)\s+(?:realizad[oa]s?|fechad[oa]s?|atingid[oa]s?)\b/i.test(combined) ||
    /(?:faturamento|faturou|vendas?|meta)\s+(?:de|em|no dia|do dia)\s+(?:ontem|anteontem|hoje|\d{1,2}[\/\-]\d{1,2}|\d{4})\b/i.test(combined) ||
    /(?:faturamento|faturou|vendas?)\s+(?:de|em)\s+.*?\b(?:ontem|anteontem|\d{1,2}[\/\-]\d{1,2})\b/i.test(combined)
  ) {
    return { isVolatile: true, reason: 'Contém faturamento ou métrica realizada de data/período volátil' };
  }

  return { isVolatile: false };
}

/**
 * Salva ou atualiza um registro completo de memória no SQLite.
 */
export function saveMemoryRecord(db: Database.Database, record: MemoryRecord): void {
  initHydraAccessAndMemorySchema(db);

  const stmt = db.prepare(`
    INSERT INTO hydra_memories (
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
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      superseded_by = excluded.superseded_by,
      confirmed_at = excluded.confirmed_at,
      expires_at = excluded.expires_at
  `);

  stmt.run(
    record.memoryId,
    record.phone,
    record.generationId,
    record.scopeType,
    record.lojaSlug ?? null,
    record.memoryType,
    record.topicKey,
    record.contentNormalized,
    record.evidenceText,
    JSON.stringify(record.sourceTurnIds || []),
    record.status,
    record.confidence,
    record.occurrenceCount ?? 1,
    JSON.stringify(record.distinctDays || []),
    record.supersededBy ?? null,
    record.createdAt || new Date().toISOString(),
    record.confirmedAt || new Date().toISOString(),
    record.expiresAt ?? null
  );
}

/**
 * Atualiza o status de uma memória e opcionalmente o ponteiro de sucessão (supersededBy).
 */
export function updateMemoryStatus(
  db: Database.Database,
  memoryId: string,
  status: MemoryStatus,
  supersededBy?: string
): void {
  initHydraAccessAndMemorySchema(db);

  db.prepare(`
    UPDATE hydra_memories
    SET status = ?,
        superseded_by = COALESCE(?, superseded_by),
        confirmed_at = CURRENT_TIMESTAMP
    WHERE memory_id = ?
  `).run(status, supersededBy || null, memoryId);
}

/**
 * Recupera memórias ativas com APLICAÇÃO RIGOROSA DE ESCOPO EFETIVO:
 * - Se effectivePersona === 'gerente', NUNCA retorna memórias de scope_type = 'rede'!
 *   Apenas 'perfil_global' ou 'loja' associada a activeLojaSlug.
 * - Se effectivePersona === 'socio', retorna 'perfil_global' ou 'rede' (ou 'loja' específica se fornecida).
 */
export function getMemoriesByTopic(
  db: Database.Database,
  filter: MemoryRetrievalFilter
): MemoryRecord[] {
  initHydraAccessAndMemorySchema(db);

  const {
    phone,
    generationId,
    effectivePersona,
    activeLojaSlug,
    topicKey,
    maxItems = 3
  } = filter;

  const params: any[] = [phone, generationId];
  let scopeClause = '';

  if (effectivePersona === 'gerente') {
    // Isolamento absoluto: gerente NUNCA acessa scope_type = 'rede'
    if (activeLojaSlug && activeLojaSlug.trim().length > 0) {
      scopeClause = `AND (scope_type = 'perfil_global' OR (scope_type = 'loja' AND LOWER(loja_slug) = LOWER(?)))`;
      params.push(activeLojaSlug.trim());
    } else {
      scopeClause = `AND scope_type = 'perfil_global'`;
    }
  } else {
    // Sócio: rede ou perfil_global (ou loja se explicitamente filtrada)
    if (activeLojaSlug && activeLojaSlug.trim().length > 0) {
      scopeClause = `AND (scope_type = 'perfil_global' OR scope_type = 'rede' OR (scope_type = 'loja' AND LOWER(loja_slug) = LOWER(?)))`;
      params.push(activeLojaSlug.trim());
    } else {
      scopeClause = `AND (scope_type = 'perfil_global' OR scope_type = 'rede')`;
    }
  }

  let topicClause = '';
  if (topicKey && topicKey.trim().length > 0) {
    topicClause = `AND topic_key = ?`;
    params.push(topicKey.trim());
  }

  params.push(maxItems);

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
    WHERE phone = ?
      AND generation_id = ?
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      ${scopeClause}
      ${topicClause}
    ORDER BY confirmed_at DESC, confidence DESC, occurrence_count DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params) as any[];

  return rows.map(row => ({
    memoryId: row.memory_id,
    phone: row.phone,
    generationId: row.generation_id,
    scopeType: row.scope_type as MemoryScopeType,
    lojaSlug: row.loja_slug || null,
    memoryType: row.memory_type as MemoryType,
    topicKey: row.topic_key,
    contentNormalized: row.content_normalized,
    evidenceText: row.evidence_text,
    sourceTurnIds: safeParseJson<string[]>(row.source_turn_ids, []),
    status: row.status as MemoryStatus,
    confidence: Number(row.confidence),
    occurrenceCount: Number(row.occurrence_count),
    distinctDays: safeParseJson<string[]>(row.distinct_days_json, []),
    supersededBy: row.superseded_by || undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at || undefined
  }));
}

/**
 * Invalida todas as memórias de gerações anteriores de um usuário após comando /reset.
 */
export function invalidateGenerationMemories(
  db: Database.Database,
  phone: string,
  oldGenerationId: number
): void {
  initHydraAccessAndMemorySchema(db);

  db.prepare(`
    UPDATE hydra_memories
    SET status = 'invalidated',
        confirmed_at = CURRENT_TIMESTAMP
    WHERE phone = ?
      AND generation_id = ?
      AND status != 'invalidated'
  `).run(phone, oldGenerationId);
}

/**
 * Valida e persiste candidatos a memória emitidos em piggyback pelo revisor de IA.
 *
 * Regras:
 * - Rejeita fatos voláteis transitórios.
 * - Aceita preferências legítimas.
 * - REGRA DE OURO: derived_interest salva com status 'candidate' independentemente da confiança.
 * - Precedência de correção: se candidate for 'correction', marca versões anteriores como 'superseded'.
 * - Deduplicação estável por sourceTurnIds: turnos repetidos não incrementam occurrence_count.
 */
export function validateAndPersistMemoryCandidates(
  db: Database.Database,
  candidates: MemoryCandidate[],
  context: {
    phone: string;
    generationId: number;
    effectivePersona: 'socio' | 'gerente';
    activeLojaSlug?: string | null;
    turnId: string;
    rawUserMessage?: string;
    vaultRoot?: string;
  }
): { persistedCount: number; rejectedCount: number } {
  initHydraAccessAndMemorySchema(db);

  // BLINDAGEM P?S-RESET: descarta commits da gera??o antiga caso memory_generation tenha mudado
  try {
    const profile = db.prepare('SELECT memory_generation FROM hydra_user_profiles WHERE phone = ?').get(context.phone) as any;
    if (profile && profile.memory_generation != null && Number(profile.memory_generation) > context.generationId) {
      return { persistedCount: 0, rejectedCount: candidates.length };
    }
  } catch {}

  let persistedCount = 0;
  let rejectedCount = 0;

  const todayStr = getSaoPauloDate();
  const nowIso = new Date().toISOString();

  for (const candidate of candidates) {
    if (!candidate || !candidate.topicKey || !candidate.contentNormalized) {
      rejectedCount++;
      continue;
    }

    // 0. Valida??o de evid?ncia textual estrita [E3-E2.1 / M18]
    if (!candidate.evidenceText || typeof candidate.evidenceText !== 'string' || candidate.evidenceText.trim().length === 0) {
      rejectedCount++;
      continue;
    }
    const evidenceClean = candidate.evidenceText.trim().toLowerCase();

    let evidenceFound = false;
    if (context.rawUserMessage && typeof context.rawUserMessage === 'string') {
      if (context.rawUserMessage.toLowerCase().includes(evidenceClean)) {
        evidenceFound = true;
      }
    }

    if (!evidenceFound) {
      try {
        const hasConvTable = Boolean(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_messages'").get()
        );
        if (hasConvTable) {
          const userMsgCount = db.prepare(
            "SELECT count(*) as count FROM conversation_messages WHERE phone = ? AND role = 'user'"
          ).get(context.phone) as any;

          if (userMsgCount && userMsgCount.count > 0) {
            const match = db.prepare(
              "SELECT 1 FROM conversation_messages WHERE phone = ? AND role = 'user' AND LOWER(content) LIKE ? LIMIT 1"
            ).get(context.phone, '%' + evidenceClean + '%');
            if (match) {
              evidenceFound = true;
            }
          } else {
            if (context.rawUserMessage === undefined) {
              evidenceFound = true;
            }
          }
        } else {
          if (context.rawUserMessage === undefined) {
            evidenceFound = true;
          }
        }
      } catch {
        if (context.rawUserMessage === undefined) {
          evidenceFound = true;
        }
      }
    }

    if (!evidenceFound) {
      rejectedCount++;
      continue;
    }
    // 1. Validação de volatilidade factual
    const volatilityCheck = isVolatileFactualCandidate(candidate);
    if (volatilityCheck.isVolatile) {
      rejectedCount++;
      continue;
    }

    // 2. Normalização estrita de escopo
    let normalizedScope: MemoryScopeType = candidate.scopeType || 'perfil_global';
    let normalizedLojaSlug: string | null = null;

    if (context.effectivePersona === 'gerente') {
      // Gerente NUNCA pode gravar com scope_type = 'rede'!
      if (normalizedScope === 'rede') {
        normalizedScope = 'loja';
      }
      if (normalizedScope === 'loja') {
        normalizedLojaSlug = context.activeLojaSlug || candidate.lojaSlug || null;
      }
    } else {
      // Sócio
      if (normalizedScope === 'loja') {
        normalizedLojaSlug = candidate.lojaSlug || context.activeLojaSlug || null;
      }
    }

    // 3. REGRA DE OURO:
    // Confiança >= 0.8 do modelo NÃO promove inferência a preferência confirmada!
    // Se for 'derived_interest', status é SEMPRE 'candidate'.
    // Status 'active' SOMENTE para 'explicit_preference' ou 'correction'.
    let status: MemoryStatus = 'candidate';
    if (candidate.memoryType === 'explicit_preference' || candidate.memoryType === 'correction') {
      status = 'active';
    } else {
      status = 'candidate';
    }

    const confidence = typeof candidate.confidence === 'number'
      ? Math.max(0, Math.min(1, candidate.confidence))
      : (candidate.memoryType === 'derived_interest' ? 0.8 : 1.0);

    // 4. Precedência de Correção:
    // 4. Preced?ncia de Corre??o: filtro qu?ntuplo estrito [E3-E2.2 / M08]
    if (candidate.memoryType === 'correction') {
      const existingMemories = db.prepare(`
        SELECT memory_id
        FROM hydra_memories
        WHERE phone = ?
          AND generation_id = ?
          AND scope_type = ?
          AND (
            (loja_slug IS NULL AND ? IS NULL)
            OR (loja_slug IS NOT NULL AND ? IS NOT NULL AND LOWER(loja_slug) = LOWER(?))
          )
          AND topic_key = ?
          AND status IN ('active', 'candidate')
      `).all(
        context.phone,
        context.generationId,
        normalizedScope,
        normalizedLojaSlug,
        normalizedLojaSlug,
        normalizedLojaSlug,
        candidate.topicKey
      ) as any[];

      const newMemoryId = `mem_${context.phone}_gen${context.generationId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      for (const oldMem of existingMemories) {
        updateMemoryStatus(db, oldMem.memory_id, 'superseded', newMemoryId);
      }

      const newRecord: MemoryRecord = {
        memoryId: newMemoryId,
        phone: context.phone,
        generationId: context.generationId,
        scopeType: normalizedScope,
        lojaSlug: normalizedLojaSlug,
        memoryType: 'correction',
        topicKey: candidate.topicKey,
        contentNormalized: candidate.contentNormalized,
        evidenceText: candidate.evidenceText,
        sourceTurnIds: [context.turnId],
        status: 'active',
        confidence: 1.0,
        occurrenceCount: 1,
        distinctDays: [todayStr],
        createdAt: nowIso,
        confirmedAt: nowIso
      };

      saveMemoryRecord(db, newRecord);
      persistedCount++;

      // [E2-05]: Espelhamento imediato de corre??es ativas no Obsidian Vault
      try {
        const vaultRoot = context.vaultRoot || getVaultRoot();
        const fm: VaultFrontmatter = {
          id: candidate.topicKey,
          owner: context.phone,
          generation_id: context.generationId,
          scope_type: normalizedScope,
          loja_slug: normalizedLojaSlug,
          topic_key: candidate.topicKey,
          memory_type: 'correction',
          status: 'active',
          version: 1,
          confidence: 1.0,
          evidence_text: candidate.evidenceText,
          source_turn_ids: [context.turnId],
          created_at: nowIso,
          confirmed_at: nowIso,
          expires_at: null,
          superseded_by: null
        };
        saveVaultNoteWithGenerationCheck(
          db,
          context.phone,
          `correcoes/${candidate.topicKey}.md`,
          fm,
          candidate.contentNormalized,
          vaultRoot
        );
      } catch (err: any) {
        // Grava??o do vault n?o bloqueia SQLite
      }
      continue;
    }

    // 5. Agrupamento quíntuplo para explicit_preference ou derived_interest:
    // (phone, generation_id, scope_type, loja_slug, topic_key)
    const existing = db.prepare(`
      SELECT 
        memory_id,
        source_turn_ids,
        status,
        confidence,
        occurrence_count,
        distinct_days_json
      FROM hydra_memories
      WHERE phone = ?
        AND generation_id = ?
        AND scope_type = ?
        AND (
          (loja_slug IS NULL AND ? IS NULL)
          OR (loja_slug IS NOT NULL AND ? IS NOT NULL AND LOWER(loja_slug) = LOWER(?))
        )
        AND topic_key = ?
        AND status IN ('active', 'candidate')
      LIMIT 1
    `).get(
      context.phone,
      context.generationId,
      normalizedScope,
      normalizedLojaSlug,
      normalizedLojaSlug,
      normalizedLojaSlug,
      candidate.topicKey
    ) as any;

    if (existing) {
      const sourceTurnIds = safeParseJson<string[]>(existing.source_turn_ids, []);
      const distinctDays = safeParseJson<string[]>(existing.distinct_days_json, []);

      // DEDUPLICAÇÃO ESTÁVEL POR SOURCE_TURN_IDS
      const isDuplicateTurn = sourceTurnIds.includes(context.turnId);

      if (!isDuplicateTurn) {
        sourceTurnIds.push(context.turnId);
        if (!distinctDays.includes(todayStr)) {
          distinctDays.push(todayStr);
        }

        const newCount = (Number(existing.occurrence_count) || 1) + 1;
        const newConfidence = Math.max(Number(existing.confidence), confidence);

        db.prepare(`
          UPDATE hydra_memories
          SET source_turn_ids = ?,
              distinct_days_json = ?,
              occurrence_count = ?,
              confidence = ?,
              content_normalized = ?,
              evidence_text = ?,
              confirmed_at = ?
          WHERE memory_id = ?
        `).run(
          JSON.stringify(sourceTurnIds),
          JSON.stringify(distinctDays),
          newCount,
          newConfidence,
          candidate.contentNormalized,
          candidate.evidenceText,
          nowIso,
          existing.memory_id
        );
      }
      persistedCount++;
    } else {
      const newMemoryId = `mem_${context.phone}_gen${context.generationId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const record: MemoryRecord = {
        memoryId: newMemoryId,
        phone: context.phone,
        generationId: context.generationId,
        scopeType: normalizedScope,
        lojaSlug: normalizedLojaSlug,
        memoryType: candidate.memoryType,
        topicKey: candidate.topicKey,
        contentNormalized: candidate.contentNormalized,
        evidenceText: candidate.evidenceText,
        sourceTurnIds: [context.turnId],
        status,
        confidence,
        occurrenceCount: 1,
        distinctDays: [todayStr],
        createdAt: nowIso,
        confirmedAt: nowIso
      };

      saveMemoryRecord(db, record);
      persistedCount++;
    }

    // [E2-05]: Espelhamento de prefer?ncias expl?citas ativas no Obsidian Vault
    if (candidate.memoryType === 'explicit_preference' && status === 'active') {
      try {
        const vaultRoot = context.vaultRoot || getVaultRoot();
        const fm: VaultFrontmatter = {
          id: candidate.topicKey,
          owner: context.phone,
          generation_id: context.generationId,
          scope_type: normalizedScope,
          loja_slug: normalizedLojaSlug,
          topic_key: candidate.topicKey,
          memory_type: 'explicit_preference',
          status: 'active',
          version: 1,
          confidence: confidence,
          evidence_text: candidate.evidenceText,
          source_turn_ids: [context.turnId],
          created_at: nowIso,
          confirmed_at: nowIso,
          expires_at: null,
          superseded_by: null
        };
        saveVaultNoteWithGenerationCheck(
          db,
          context.phone,
          `preferencias/${candidate.topicKey}.md`,
          fm,
          candidate.contentNormalized,
          vaultRoot
        );
      } catch (err: any) {
        // Grava??o do vault n?o bloqueia SQLite
      }
    }
  }

  return { persistedCount, rejectedCount };
}

/**
 * Formata as memórias recuperadas para injeção concisa (<150 tokens) no prompt.
 */
export function formatMemoriesForPrompt(memories: MemoryRecord[]): string {
  if (!memories || memories.length === 0) return '';
  const lines = memories.map(m => {
    const scopeTag = m.scopeType === 'loja' && m.lojaSlug
      ? `[Loja: ${m.lojaSlug}]`
      : (m.scopeType === 'rede' ? `[Rede]` : `[Global]`);
    return `- ${scopeTag} ${m.topicKey}: ${m.contentNormalized}`;
  });
  return `# PREFERÊNCIAS E REGRAS MEMORIZADAS DO USUÁRIO:\n${lines.join('\n')}`;
}

/**
 * Recupera memórias e formata o contexto pronto para o prompt de forma atômica.
 */
export function getMemoriesForPrompt(
  db: Database.Database,
  filter: MemoryRetrievalFilter
): MemoryRetrievalResult {
  const start = Date.now();
  const memories = getMemoriesByTopic(db, filter);
  const formattedContext = formatMemoriesForPrompt(memories);
  return {
    memories,
    formattedContext,
    source: memories.length > 0 ? 'structured_direct' : 'fallback_empty',
    latencyMs: Date.now() - start
  };
}
