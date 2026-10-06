import type Database from 'better-sqlite3';

export type DataWorkerKind = 'OPERACAO' | 'VENDAS_DIA' | 'METAS' | 'OS' | 'CICLO_UNIFICADO';
export type DataWorkerStatus = 'SUCCESS' | 'ERROR';

export interface RecordWorkerRunArgs {
  kind: DataWorkerKind;
  lojaSlug: string;
  dataReferencia: string;
  startedAt: string;
  finishedAt?: string;
  status: DataWorkerStatus;
  itemCount?: number;
  error?: string | null;
}

export interface DataWorkerRunRecord {
  id: number;
  kind: DataWorkerKind;
  loja_slug: string;
  lojaSlug: string;
  data_referencia: string;
  dataReferencia: string;
  started_at: string;
  startedAt: string;
  finished_at: string;
  finishedAt: string;
  status: DataWorkerStatus;
  item_count: number;
  itemCount: number;
  error: string | null;
  created_at?: string;
  createdAt?: string;
}

/**
 * Remove credenciais, senhas, tokens e chaves de mensagens de erro para
 * garantir conformidade de segurança e evitar vazamento em logs/banco.
 */
export function sanitizeErrorMessage(error?: string | null): string | null {
  if (!error) return null;
  let sanitized = error;

  // Sanitização de token com Bearer (ex: token=Bearer xyz... ou auth: Bearer xyz...)
  sanitized = sanitized.replace(/(token|authorization|auth)\s*[:=]\s*bearer\s+[^\s,;'"&]+/gi, '$1=[REDACTED]');
  // Sanitização de cabeçalho Bearer direto (ex: Bearer xyz...)
  sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  // Sanitização genérica de senhas, credenciais e chaves
  sanitized = sanitized.replace(/(password|passwd|pass|pwd|secret|token|apikey|api_key|auth|authorization)\s*[:=]\s*['"]?[^\s,;'"&]+/gi, '$1=[REDACTED]');
  // Sanitização específica do crawler OI
  sanitized = sanitized.replace(/(oi_pass|oi_user|oi_token)\s*[:=]\s*['"]?[^\s,;'"&]+/gi, '$1=[REDACTED]');

  // Limitação de tamanho para segurança de armazenamento
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 497) + '...';
  }
  return sanitized;
}

/**
 * Inicializa a tabela de observabilidade hydra_data_worker_runs
 */
export function ensureDataWorkerLogTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_data_worker_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      data_referencia TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_worker_runs_kind_started ON hydra_data_worker_runs(kind, started_at);
    CREATE INDEX IF NOT EXISTS idx_worker_runs_data_loja ON hydra_data_worker_runs(data_referencia, loja_slug);
  `);
}

/**
 * Registra a execução de um worker de dados (OPERACAO, VENDAS_DIA ou METAS)
 */
export function recordDataWorkerRun(db: Database.Database, args: RecordWorkerRunArgs): number {
  ensureDataWorkerLogTable(db);
  const finishedAt = args.finishedAt || new Date().toISOString();
  const sanitizedError = sanitizeErrorMessage(args.error);

  const stmt = db.prepare(`
    INSERT INTO hydra_data_worker_runs
      (kind, loja_slug, data_referencia, started_at, finished_at, status, item_count, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    args.kind,
    args.lojaSlug,
    args.dataReferencia,
    args.startedAt,
    finishedAt,
    args.status,
    args.itemCount || 0,
    sanitizedError
  );

  return Number(info.lastInsertRowid);
}

/**
 * Consulta as execuções recentes de workers com ordenação cronológica decrescente.
 */
export function getRecentWorkerRuns(
  db: Database.Database,
  kind?: DataWorkerKind,
  limit: number = 20
): DataWorkerRunRecord[] {
  ensureDataWorkerLogTable(db);

  let rows: Array<{
    id: number;
    kind: string;
    loja_slug: string;
    data_referencia: string;
    started_at: string;
    finished_at: string;
    status: string;
    item_count: number;
    error: string | null;
    created_at?: string;
  }>;

  if (kind) {
    rows = db.prepare(`
      SELECT id, kind, loja_slug, data_referencia, started_at, finished_at, status, item_count, error, created_at
      FROM hydra_data_worker_runs
      WHERE kind = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(kind, limit) as typeof rows;
  } else {
    rows = db.prepare(`
      SELECT id, kind, loja_slug, data_referencia, started_at, finished_at, status, item_count, error, created_at
      FROM hydra_data_worker_runs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as typeof rows;
  }

  return rows.map(r => ({
    id: r.id,
    kind: r.kind as DataWorkerKind,
    loja_slug: r.loja_slug,
    lojaSlug: r.loja_slug,
    data_referencia: r.data_referencia,
    dataReferencia: r.data_referencia,
    started_at: r.started_at,
    startedAt: r.started_at,
    finished_at: r.finished_at,
    finishedAt: r.finished_at,
    status: r.status as DataWorkerStatus,
    item_count: r.item_count,
    itemCount: r.item_count,
    error: r.error,
    created_at: r.created_at,
    createdAt: r.created_at
  }));
}