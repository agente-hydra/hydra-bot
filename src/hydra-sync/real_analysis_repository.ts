/**
 * src/hydra-sync/real_analysis_repository.ts
 * Repositório de análises canônicas e projeções de grafo persistidas no SQLite.
 * Fornece recuperação estrita por OS ID e Loja com validação de cobertura e integridade.
 */

import type Database from 'better-sqlite3';

export interface CanonicalAnalysis {
  readonly analysisId: string;
  readonly lojaSlug: string;
  readonly coveredOsIds: readonly string[];
  readonly title?: string;
  readonly analysisText?: string;
  readonly documentedDelayReason?: string;
  readonly nextPromisedStep?: string;
  readonly lastObservationDate?: string;
  readonly status: 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED';
  readonly metadata?: Record<string, any>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GraphProjection {
  readonly projectionId: string;
  readonly lojaSlug: string;
  readonly coveredOsIds: readonly string[];
  readonly nodes?: readonly any[];
  readonly edges?: readonly any[];
  readonly documentedDelayReason?: string;
  readonly nextPromisedStep?: string;
  readonly isValid: boolean;
  readonly isIntact: boolean;
  readonly lastObservationDate?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Garante a criação idempotente das tabelas hydra_case_analyses e hydra_case_graph_projections.
 */
export function ensureCaseAnalysisTables(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_case_analyses (
        analysis_id TEXT PRIMARY KEY,
        loja_slug TEXT NOT NULL,
        covered_os_ids_json TEXT NOT NULL,
        title TEXT,
        analysis_text TEXT,
        documented_delay_reason TEXT,
        next_promised_step TEXT,
        last_observation_date TEXT,
        status TEXT DEFAULT 'ACTIVE',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_case_analyses_loja ON hydra_case_analyses(loja_slug);
      CREATE INDEX IF NOT EXISTS idx_case_analyses_status ON hydra_case_analyses(status);

      CREATE TABLE IF NOT EXISTS hydra_case_graph_projections (
        projection_id TEXT PRIMARY KEY,
        loja_slug TEXT NOT NULL,
        covered_os_ids_json TEXT NOT NULL,
        nodes_json TEXT,
        edges_json TEXT,
        documented_delay_reason TEXT,
        next_promised_step TEXT,
        is_valid INTEGER DEFAULT 1,
        is_intact INTEGER DEFAULT 1,
        last_observation_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_graph_projections_loja ON hydra_case_graph_projections(loja_slug);
      CREATE INDEX IF NOT EXISTS idx_graph_projections_valid ON hydra_case_graph_projections(is_valid, is_intact);
    `);
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao criar tabelas de análise de caso:', err?.message || err);
  }
}

/**
 * Salva ou atualiza uma análise canônica no SQLite.
 */
export function saveCanonicalAnalysis(db: Database.Database, analysis: CanonicalAnalysis): void {
  ensureCaseAnalysisTables(db);
  const nowIso = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO hydra_case_analyses (
        analysis_id, loja_slug, covered_os_ids_json, title, analysis_text,
        documented_delay_reason, next_promised_step, last_observation_date,
        status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(analysis_id) DO UPDATE SET
        loja_slug = excluded.loja_slug,
        covered_os_ids_json = excluded.covered_os_ids_json,
        title = excluded.title,
        analysis_text = excluded.analysis_text,
        documented_delay_reason = excluded.documented_delay_reason,
        next_promised_step = excluded.next_promised_step,
        last_observation_date = excluded.last_observation_date,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      analysis.analysisId,
      analysis.lojaSlug,
      JSON.stringify(analysis.coveredOsIds || []),
      analysis.title || null,
      analysis.analysisText || null,
      analysis.documentedDelayReason || null,
      analysis.nextPromisedStep || null,
      analysis.lastObservationDate || null,
      analysis.status || 'ACTIVE',
      analysis.metadata ? JSON.stringify(analysis.metadata) : null,
      analysis.createdAt || nowIso,
      analysis.updatedAt || nowIso
    );
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao salvar análise canônica:', err?.message || err);
  }
}

/**
 * Recupera uma análise canônica por ID.
 */
export function getCanonicalAnalysis(db: Database.Database, analysisId: string): CanonicalAnalysis | null {
  ensureCaseAnalysisTables(db);
  try {
    const row = db.prepare(`
      SELECT analysis_id, loja_slug, covered_os_ids_json, title, analysis_text,
             documented_delay_reason, next_promised_step, last_observation_date,
             status, metadata_json, created_at, updated_at
      FROM hydra_case_analyses
      WHERE analysis_id = ?
    `).get(analysisId) as any;

    if (!row) return null;

    let coveredOsIds: string[] = [];
    try {
      coveredOsIds = JSON.parse(row.covered_os_ids_json);
    } catch {}

    return {
      analysisId: row.analysis_id,
      lojaSlug: row.loja_slug,
      coveredOsIds,
      title: row.title || undefined,
      analysisText: row.analysis_text || undefined,
      documentedDelayReason: row.documented_delay_reason || undefined,
      nextPromisedStep: row.next_promised_step || undefined,
      lastObservationDate: row.last_observation_date || undefined,
      status: row.status,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao buscar análise por ID:', err?.message || err);
    return null;
  }
}

/**
 * Busca análise canônica que cubra a OS e loja solicitada [E2-03].
 * Valida estritamente se a loja é idêntica e se a OS está presente em coveredOsIds.
 */
export function findCanonicalAnalysisForOs(
  db: Database.Database,
  storeSlug: string,
  osId: string
): CanonicalAnalysis | null {
  if (!storeSlug || !osId) return null;
  ensureCaseAnalysisTables(db);

  const cleanStore = storeSlug.trim().toLowerCase();
  const cleanOsId = String(osId).trim();

  try {
    const rows = db.prepare(`
      SELECT analysis_id, loja_slug, covered_os_ids_json, title, analysis_text,
             documented_delay_reason, next_promised_step, last_observation_date,
             status, metadata_json, created_at, updated_at
      FROM hydra_case_analyses
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?)) AND status = 'ACTIVE'
      ORDER BY updated_at DESC
    `).all(cleanStore, cleanStore) as any[];

    for (const row of rows) {
      if (String(row.loja_slug).toLowerCase() !== cleanStore) {
        continue; // Rejeição estrita cross-store
      }

      let coveredOsIds: string[] = [];
      try {
        coveredOsIds = JSON.parse(row.covered_os_ids_json);
      } catch {
        continue;
      }

      const covers = Array.isArray(coveredOsIds) && coveredOsIds.some(id => String(id).trim() === cleanOsId);
      if (covers) {
        return {
          analysisId: row.analysis_id,
          lojaSlug: row.loja_slug,
          coveredOsIds,
          title: row.title || undefined,
          analysisText: row.analysis_text || undefined,
          documentedDelayReason: row.documented_delay_reason ? String(row.documented_delay_reason).trim() : undefined,
          nextPromisedStep: row.next_promised_step ? String(row.next_promised_step).trim() : undefined,
          lastObservationDate: row.last_observation_date || undefined,
          status: row.status,
          metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      }
    }

    return null;
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao buscar análise para OS:', err?.message || err);
    return null;
  }
}

/**
 * Salva ou atualiza uma projeção de grafo de atendimentos [E2-04].
 */
export function saveGraphProjection(db: Database.Database, projection: GraphProjection): void {
  ensureCaseAnalysisTables(db);
  const nowIso = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO hydra_case_graph_projections (
        projection_id, loja_slug, covered_os_ids_json, nodes_json, edges_json,
        documented_delay_reason, next_promised_step, is_valid, is_intact,
        last_observation_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(projection_id) DO UPDATE SET
        loja_slug = excluded.loja_slug,
        covered_os_ids_json = excluded.covered_os_ids_json,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        documented_delay_reason = excluded.documented_delay_reason,
        next_promised_step = excluded.next_promised_step,
        is_valid = excluded.is_valid,
        is_intact = excluded.is_intact,
        last_observation_date = excluded.last_observation_date,
        updated_at = excluded.updated_at
    `).run(
      projection.projectionId,
      projection.lojaSlug,
      JSON.stringify(projection.coveredOsIds || []),
      projection.nodes ? JSON.stringify(projection.nodes) : null,
      projection.edges ? JSON.stringify(projection.edges) : null,
      projection.documentedDelayReason || null,
      projection.nextPromisedStep || null,
      projection.isValid ? 1 : 0,
      projection.isIntact ? 1 : 0,
      projection.lastObservationDate || null,
      projection.createdAt || nowIso,
      projection.updatedAt || nowIso
    );
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao salvar projeção de grafo:', err?.message || err);
  }
}

/**
 * Recupera projeção de grafo por ID.
 */
export function getGraphProjection(db: Database.Database, projectionId: string): GraphProjection | null {
  ensureCaseAnalysisTables(db);
  try {
    const row = db.prepare(`
      SELECT projection_id, loja_slug, covered_os_ids_json, nodes_json, edges_json,
             documented_delay_reason, next_promised_step, is_valid, is_intact,
             last_observation_date, created_at, updated_at
      FROM hydra_case_graph_projections
      WHERE projection_id = ?
    `).get(projectionId) as any;

    if (!row) return null;

    let coveredOsIds: string[] = [];
    try {
      coveredOsIds = JSON.parse(row.covered_os_ids_json);
    } catch {}

    let nodes: any[] | undefined = undefined;
    let edges: any[] | undefined = undefined;
    try {
      if (row.nodes_json) nodes = JSON.parse(row.nodes_json);
      if (row.edges_json) edges = JSON.parse(row.edges_json);
    } catch {}

    return {
      projectionId: row.projection_id,
      lojaSlug: row.loja_slug,
      coveredOsIds,
      nodes,
      edges,
      documentedDelayReason: row.documented_delay_reason || undefined,
      nextPromisedStep: row.next_promised_step || undefined,
      isValid: Boolean(row.is_valid === 1),
      isIntact: Boolean(row.is_intact === 1),
      lastObservationDate: row.last_observation_date || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao buscar projeção de grafo por ID:', err?.message || err);
    return null;
  }
}

/**
 * Busca projeção de grafo de atendimentos quando válida e íntegra para a OS e loja [E2-04].
 */
export function findGraphProjectionForOs(
  db: Database.Database,
  storeSlug: string,
  osId: string
): GraphProjection | null {
  if (!storeSlug || !osId) return null;
  ensureCaseAnalysisTables(db);

  const cleanStore = storeSlug.trim().toLowerCase();
  const cleanOsId = String(osId).trim();

  try {
    const rows = db.prepare(`
      SELECT projection_id, loja_slug, covered_os_ids_json, nodes_json, edges_json,
             documented_delay_reason, next_promised_step, is_valid, is_intact,
             last_observation_date, created_at, updated_at
      FROM hydra_case_graph_projections
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?))
        AND is_valid = 1
        AND is_intact = 1
      ORDER BY updated_at DESC
    `).all(cleanStore, cleanStore) as any[];

    for (const row of rows) {
      if (String(row.loja_slug).toLowerCase() !== cleanStore) {
        continue;
      }

      let coveredOsIds: string[] = [];
      try {
        coveredOsIds = JSON.parse(row.covered_os_ids_json);
      } catch {
        continue;
      }

      const covers = Array.isArray(coveredOsIds) && coveredOsIds.some(id => String(id).trim() === cleanOsId);
      if (covers) {
        let nodes: any[] | undefined = undefined;
        let edges: any[] | undefined = undefined;
        try {
          if (row.nodes_json) nodes = JSON.parse(row.nodes_json);
          if (row.edges_json) edges = JSON.parse(row.edges_json);
        } catch {}

        return {
          projectionId: row.projection_id,
          lojaSlug: row.loja_slug,
          coveredOsIds,
          nodes,
          edges,
          documentedDelayReason: row.documented_delay_reason ? String(row.documented_delay_reason).trim() : undefined,
          nextPromisedStep: row.next_promised_step ? String(row.next_promised_step).trim() : undefined,
          isValid: Boolean(row.is_valid === 1),
          isIntact: Boolean(row.is_intact === 1),
          lastObservationDate: row.last_observation_date || undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      }
    }

    return null;
  } catch (err: any) {
    console.error('[REAL_ANALYSIS_REPO] Erro ao buscar projeção de grafo para OS:', err?.message || err);
    return null;
  }
}
