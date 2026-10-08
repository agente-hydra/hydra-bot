import type Database from 'better-sqlite3';
import { clearTurnState, getLatestTurnState, TurnState } from './turn_context_repository.js';

export interface DailyTopicEntry {
  count: number;
  lastSeen: string; // ISO 8601
  granularity?: string;
  lojaSlug?: string;
  corrections?: string[];
  metadata?: Record<string, any>;
}

export interface DailyMemoryRecord {
  date: string; // YYYY-MM-DD
  topics: Record<string, DailyTopicEntry>;
  preferredGranularity?: string;
  explicitCorrections?: string[];
}

export interface WeeklyPreferenceItem {
  topic: string; // Ex: 'cmv_oleo', 'metas', 'carros_travados'
  confidence: number; // 0.0 a 1.0
  evidenceCount: number;
  distinctDays: string[]; // ['2026-09-28', '2026-09-29', ...]
  lastConfirmed: string; // YYYY-MM-DD ou ISO
  decayScore: number; // Confiança decaída temporalmente
  preferredGranularity?: string;
  lojaSlug?: string;
}

export interface UserMemoryRow {
  phone: string;
  generation_id: number;
  active_persona: string;
  default_loja_slug: string | null;
  daily_topics_json: string;
  weekly_preferences_json: string;
  last_command: string | null;
  updated_at: string;
}

export interface UserPersonalizationSummary {
  phone: string;
  generationId: number;
  activePersona: string;
  defaultLojaSlug?: string;
  preferredGranularity?: string;
  topPersonalizedTopics: string[]; // No máximo 2 tópicos com forte evidência
  weeklyPreferences: WeeklyPreferenceItem[];
  dailyMemory: DailyMemoryRecord;
}

/**
 * Normaliza número de telefone (apenas dígitos).
 */
export function cleanPhone(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Retorna a data no formato YYYY-MM-DD no fuso de São Paulo.
 */
export function getTodayDateString(refDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(refDate);

  const year = parts.find(p => p.type === 'year')?.value || '2026';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

/**
 * Garante a criação idempotente da tabela hydra_user_memory no SQLite.
 */
export function ensureUserMemoryTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_user_memory (
        phone TEXT PRIMARY KEY,
        generation_id INTEGER NOT NULL DEFAULT 1,
        active_persona TEXT NOT NULL DEFAULT 'socio',
        default_loja_slug TEXT,
        daily_topics_json TEXT NOT NULL DEFAULT '{}',
        weekly_preferences_json TEXT NOT NULL DEFAULT '[]',
        last_command TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_memory_updated ON hydra_user_memory(updated_at);
    `);
  } catch (err: any) {
    console.error('[USER_MEMORY] Erro ao criar tabela hydra_user_memory:', err?.message || err);
  }
}

/**
 * Busca registro cru da memória do usuário. Se não existir, inicializa com valores default.
 */
export function getUserMemory(db: Database.Database, phone: string): UserMemoryRow {
  ensureUserMemoryTable(db);
  const p = cleanPhone(phone);
  if (!p) {
    throw new Error('[USER_MEMORY] Telefone inválido para consulta de memória');
  }

  const row = db.prepare(`
    SELECT phone, generation_id, active_persona, default_loja_slug,
           daily_topics_json, weekly_preferences_json, last_command, updated_at
    FROM hydra_user_memory
    WHERE phone = ?
  `).get(p) as UserMemoryRow | undefined;

  if (row) {
    return row;
  }

  // Cria registro inicial default
  const defaultRow: UserMemoryRow = {
    phone: p,
    generation_id: 1,
    active_persona: 'socio',
    default_loja_slug: null,
    daily_topics_json: '{}',
    weekly_preferences_json: '[]',
    last_command: null,
    updated_at: new Date().toISOString()
  };

  db.prepare(`
    INSERT INTO hydra_user_memory (
      phone, generation_id, active_persona, default_loja_slug,
      daily_topics_json, weekly_preferences_json, last_command, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaultRow.phone,
    defaultRow.generation_id,
    defaultRow.active_persona,
    defaultRow.default_loja_slug,
    defaultRow.daily_topics_json,
    defaultRow.weekly_preferences_json,
    defaultRow.last_command,
    defaultRow.updated_at
  );

  return defaultRow;
}

/**
 * Calcula o decaimento temporal de preferências semanais.
 * Taxa de decaimento padrão: 15% por dia sem confirmação (fator 0.85).
 */
export function calculateDecayedPreferences(
  preferences: WeeklyPreferenceItem[],
  referenceDate: string = getTodayDateString()
): WeeklyPreferenceItem[] {
  const refTime = new Date(`${referenceDate}T12:00:00Z`).getTime();

  return preferences.map(pref => {
    const lastDateStr = pref.lastConfirmed.includes('T')
      ? pref.lastConfirmed.split('T')[0]
      : pref.lastConfirmed;
    const lastTime = new Date(`${lastDateStr}T12:00:00Z`).getTime();
    const daysDiff = Number.isFinite(lastTime) && Number.isFinite(refTime)
      ? Math.max(0, Math.floor((refTime - lastTime) / (1000 * 60 * 60 * 24)))
      : 0;

    const decayFactor = Math.pow(0.85, daysDiff);
    const decayScore = Number((pref.confidence * decayFactor).toFixed(3));

    return {
      ...pref,
      decayScore
    };
  });
}

/**
 * Consolida tópicos diários na memória semanal com cálculo de confiança e decaimento.
 * Regra:
 * - Apenas preferências confirmadas em dias distintos atingem confiança alta (> 0.6).
 * - Números operacionais NÃO são salvos, apenas metadados de tópicos e preferências.
 */
export function consolidateWeeklyMemory(
  daily: DailyMemoryRecord,
  currentWeekly: WeeklyPreferenceItem[],
  referenceDate: string = getTodayDateString()
): WeeklyPreferenceItem[] {
  const decayedList = calculateDecayedPreferences(currentWeekly, referenceDate);
  const weeklyMap = new Map<string, WeeklyPreferenceItem>();

  for (const item of decayedList) {
    weeklyMap.set(item.topic, { ...item });
  }

  // Incorpora tópicos do registro diário
  if (daily && daily.topics) {
    const dayStr = daily.date || referenceDate;

    for (const [topicKey, topicData] of Object.entries(daily.topics)) {
      const existing = weeklyMap.get(topicKey);

      if (existing) {
        const distinctDaysSet = new Set(existing.distinctDays || []);
        distinctDaysSet.add(dayStr);
        const distinctDays = Array.from(distinctDaysSet).sort();
        const evidenceCount = (existing.evidenceCount || 0) + (topicData.count || 1);

        // Confiança cresce com consistência em dias distintos
        const baseConfidence = Math.min(1.0, 0.35 + distinctDays.length * 0.25);

        existing.distinctDays = distinctDays;
        existing.evidenceCount = evidenceCount;
        existing.lastConfirmed = dayStr;
        existing.confidence = Number(baseConfidence.toFixed(2));
        existing.decayScore = existing.confidence;
        if (topicData.granularity) existing.preferredGranularity = topicData.granularity;
        if (topicData.lojaSlug) existing.lojaSlug = topicData.lojaSlug;
      } else {
        // Primeira aparição na semana
        weeklyMap.set(topicKey, {
          topic: topicKey,
          confidence: 0.4,
          evidenceCount: topicData.count || 1,
          distinctDays: [dayStr],
          lastConfirmed: dayStr,
          decayScore: 0.4,
          preferredGranularity: topicData.granularity || daily.preferredGranularity,
          lojaSlug: topicData.lojaSlug
        });
      }
    }
  }

  // Filtra itens com decaimento excessivo (menos de 0.1 de relevância)
  return Array.from(weeklyMap.values())
    .filter(item => item.decayScore >= 0.1)
    .sort((a, b) => b.decayScore - a.decayScore);
}

/**
 * Registra um tópico consultado no nível de Memória Diária.
 * Se a data mudar, dispara automaticamente a consolidação semanal do dia anterior.
 */
export function recordDailyTopic(
  db: Database.Database,
  phone: string,
  topic: string,
  options?: {
    granularity?: string;
    lojaSlug?: string;
    correction?: string;
    metadata?: Record<string, any>;
    date?: string;
  }
): UserMemoryRow {
  const p = cleanPhone(phone);
  const row = getUserMemory(db, p);
  const today = options?.date || getTodayDateString();

  let daily: DailyMemoryRecord;
  try {
    daily = JSON.parse(row.daily_topics_json || '{}');
  } catch {
    daily = { date: today, topics: {} };
  }

  let weekly: WeeklyPreferenceItem[];
  try {
    weekly = JSON.parse(row.weekly_preferences_json || '[]');
  } catch {
    weekly = [];
  }

  // Se o registro diário for de um dia anterior, consolida na memória semanal antes de resetar o dia
  if (daily.date && daily.date !== today && Object.keys(daily.topics || {}).length > 0) {
    weekly = consolidateWeeklyMemory(daily, weekly, today);
    daily = {
      date: today,
      topics: {},
      preferredGranularity: options?.granularity || daily.preferredGranularity,
      explicitCorrections: []
    };
  }

  if (!daily.date) {
    daily.date = today;
  }
  if (!daily.topics) {
    daily.topics = {};
  }

  const topicNorm = topic.trim().toLowerCase();
  const existingTopic = daily.topics[topicNorm] || {
    count: 0,
    lastSeen: new Date().toISOString(),
    corrections: []
  };

  existingTopic.count += 1;
  existingTopic.lastSeen = new Date().toISOString();
  if (options?.granularity) existingTopic.granularity = options.granularity;
  if (options?.lojaSlug) existingTopic.lojaSlug = options.lojaSlug;
  if (options?.metadata) existingTopic.metadata = { ...(existingTopic.metadata || {}), ...options.metadata };
  if (options?.correction) {
    existingTopic.corrections = existingTopic.corrections || [];
    existingTopic.corrections.push(options.correction);
  }

  daily.topics[topicNorm] = existingTopic;

  if (options?.granularity) {
    daily.preferredGranularity = options.granularity;
  }
  if (options?.correction) {
    daily.explicitCorrections = daily.explicitCorrections || [];
    daily.explicitCorrections.push(options.correction);
  }

  // Também recalcula decaimento e atualiza preferências semanais em tempo real
  const updatedWeekly = consolidateWeeklyMemory(daily, weekly, today);

  const updatedDailyJson = JSON.stringify(daily);
  const updatedWeeklyJson = JSON.stringify(updatedWeekly);
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE hydra_user_memory
    SET daily_topics_json = ?,
        weekly_preferences_json = ?,
        updated_at = ?
    WHERE phone = ?
  `).run(updatedDailyJson, updatedWeeklyJson, nowIso, p);

  return {
    ...row,
    daily_topics_json: updatedDailyJson,
    weekly_preferences_json: updatedWeeklyJson,
    updated_at: nowIso
  };
}

/**
 * Registra correção explícita fornecida pelo usuário no dia.
 */
export function recordExplicitCorrection(
  db: Database.Database,
  phone: string,
  correction: string,
  date?: string
): UserMemoryRow {
  const p = cleanPhone(phone);
  const row = getUserMemory(db, p);
  const today = date || getTodayDateString();

  let daily: DailyMemoryRecord;
  try {
    daily = JSON.parse(row.daily_topics_json || '{}');
  } catch {
    daily = { date: today, topics: {} };
  }

  daily.date = daily.date || today;
  daily.explicitCorrections = daily.explicitCorrections || [];
  daily.explicitCorrections.push(correction);

  const updatedDailyJson = JSON.stringify(daily);
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE hydra_user_memory
    SET daily_topics_json = ?,
        updated_at = ?
    WHERE phone = ?
  `).run(updatedDailyJson, nowIso, p);

  return {
    ...row,
    daily_topics_json: updatedDailyJson,
    updated_at: nowIso
  };
}

/**
 * Consolida manualmente a memória semanal e aplica decaimento temporal.
 */
export function consolidateUserWeeklyPreferences(
  db: Database.Database,
  phone: string,
  referenceDate?: string
): WeeklyPreferenceItem[] {
  const p = cleanPhone(phone);
  const row = getUserMemory(db, p);
  const today = referenceDate || getTodayDateString();

  let daily: DailyMemoryRecord;
  try {
    daily = JSON.parse(row.daily_topics_json || '{}');
  } catch {
    daily = { date: today, topics: {} };
  }

  let weekly: WeeklyPreferenceItem[];
  try {
    weekly = JSON.parse(row.weekly_preferences_json || '[]');
  } catch {
    weekly = [];
  }

  const updatedWeekly = consolidateWeeklyMemory(daily, weekly, today);
  const updatedWeeklyJson = JSON.stringify(updatedWeekly);

  db.prepare(`
    UPDATE hydra_user_memory
    SET weekly_preferences_json = ?,
        updated_at = ?
    WHERE phone = ?
  `).run(updatedWeeklyJson, new Date().toISOString(), p);

  return updatedWeekly;
}

/**
 * Obtém o resumo de personalização do usuário:
 * - Filtra no máximo 2 tópicos recorrentes que possuam evidência consolidada
 *   (confiança >= 0.5 OU confirmação em múltiplos dias com decaimento >= 0.35).
 * - Identifica persona, loja default e granularidade preferida.
 */
export function getUserPersonalizationSummary(
  db: Database.Database,
  phone: string,
  referenceDate?: string
): UserPersonalizationSummary {
  const p = cleanPhone(phone);
  const row = getUserMemory(db, p);
  const today = referenceDate || getTodayDateString();

  let daily: DailyMemoryRecord;
  try {
    daily = JSON.parse(row.daily_topics_json || '{}');
  } catch {
    daily = { date: today, topics: {} };
  }

  let weekly: WeeklyPreferenceItem[];
  try {
    weekly = JSON.parse(row.weekly_preferences_json || '[]');
  } catch {
    weekly = [];
  }

  // Aplica decaimento temporal na consulta
  const activeWeekly = calculateDecayedPreferences(weekly, today);

  // Elegibilidade para Tópico Personalizado no Briefing Executivo:
  // Precisa ter confiança consolidada (score >= 0.35) e evidência em dias distintos ou alta repetição
  const eligibleWeekly = activeWeekly.filter(item => {
    const hasMultipleDays = (item.distinctDays || []).length >= 2;
    const hasHighCount = item.evidenceCount >= 3;
    return item.decayScore >= 0.35 && (hasMultipleDays || hasHighCount);
  });

  // Ordena por maior pontuação de decaimento
  eligibleWeekly.sort((a, b) => b.decayScore - a.decayScore);

  // Seleciona no MÁXIMO 2 tópicos personalizados com forte evidência
  const topPersonalizedTopics = eligibleWeekly.slice(0, 2).map(i => i.topic);

  return {
    phone: p,
    generationId: row.generation_id,
    activePersona: row.active_persona,
    defaultLojaSlug: row.default_loja_slug || undefined,
    preferredGranularity: daily.preferredGranularity || (eligibleWeekly[0]?.preferredGranularity) || undefined,
    topPersonalizedTopics,
    weeklyPreferences: activeWeekly,
    dailyMemory: daily
  };
}

/**
 * Executa o comando /reset para o telefone:
 * - Incrementa generation_id
 * - Limpa daily_topics_json para '{}'
 * - Limpa weekly_preferences_json para '[]'
 * - Marca last_command = '/reset'
 * - Limpa contexto de turno ativo em hydra_turn_contexts
 * Garante isolamento estrito: o histórico da geração anterior é purgado.
 */
export function resetUserMemory(db: Database.Database, phone: string): void {
  const p = cleanPhone(phone);
  if (!p) return;
  ensureUserMemoryTable(db);

  const row = getUserMemory(db, p);
  const nextGen = (row.generation_id || 1) + 1;
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE hydra_user_memory
    SET generation_id = ?,
        daily_topics_json = '{}',
        weekly_preferences_json = '[]',
        last_command = '/reset',
        updated_at = ?
    WHERE phone = ?
  `).run(nextGen, nowIso, p);

  // Limpa também o turno ativo existente
  clearTurnState(db, p);
}

/**
 * Atualiza persona do usuário ('socio', 'gerente', 'auditor').
 */
export function setUserPersona(db: Database.Database, phone: string, persona: string): void {
  const p = cleanPhone(phone);
  if (!p) return;
  ensureUserMemoryTable(db);

  db.prepare(`
    INSERT INTO hydra_user_memory (phone, active_persona, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      active_persona = excluded.active_persona,
      updated_at = excluded.updated_at
  `).run(p, persona, new Date().toISOString());
}

/**
 * Atualiza loja padrão preferida pelo usuário.
 */
export function setDefaultLojaSlug(db: Database.Database, phone: string, lojaSlug: string | null): void {
  const p = cleanPhone(phone);
  if (!p) return;
  ensureUserMemoryTable(db);

  db.prepare(`
    INSERT INTO hydra_user_memory (phone, default_loja_slug, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      default_loja_slug = excluded.default_loja_slug,
      updated_at = excluded.updated_at
  `).run(p, lojaSlug || null, new Date().toISOString());
}

/**
 * Consulta o nível de Turno Ativo (via hydra_turn_contexts).
 */
export function getActiveTurnLevel(db: Database.Database, phone: string): TurnState | null {
  return getLatestTurnState(db, phone);
}
