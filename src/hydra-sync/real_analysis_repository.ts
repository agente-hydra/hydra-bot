/**
 * src/hydra-sync/real_analysis_repository.ts
 * Repositório de análises canônicas, projeções de grafo e histórico de atendimentos persistidos no SQLite.
 * Fornece recuperação estrita por OS ID e Loja com validação de cobertura e integridade.
 * Compatibilidade total:
 * - Funções funcionais para o Grafo de Atendimentos e Fast-Path (v2.1).
 * - Classe RealAnalysisRepository para persistência histórica, migrações e F01/F08.
 */

import type Database from 'better-sqlite3';
import {
  IAnalysisRepository,
  ConversationAnalysisRecord,
  ExtractedStatement,
  ConversationGap,
  AnalysisSourceType,
  StatementSubject,
  StatementPolarity,
  AuthorRole,
  ConfirmationLevel,
  GapType,
  PhysicalDatabaseUnavailableError
} from './types/conversation_context_contract.js';

export { PhysicalDatabaseUnavailableError };

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

export interface RealAnalysisRepositoryConfig {
  readonly db?: Database.Database;
  readonly isConfigured?: boolean;
}

export interface AnalysisAvailabilityStatus {
  readonly isAvailable: boolean;
  readonly status: 'AVAILABLE' | 'UNCONFIGURED' | 'DISCONNECTED';
  readonly reason?: string;
}

export interface AnalysisEvidenceEvaluation {
  readonly canUseAsBase: boolean;
  readonly isWatchdogInfractionOnly: boolean;
  readonly usableStatements: readonly ExtractedStatement[];
  readonly reason?: string;
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
 */
export function findCanonicalAnalysisForOs(
  db: Database.Database,
  storeSlug: string,
  osId: string | number
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
  osId: string | number
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

/**
 * Executa a migração segura de esquema do Grafo de Casos com suporte a fresh install e legado (A1 e A2).
 */
export function runCaseHistoryGraphMigration(db: Database.Database): void {
  const fkInitial = db.pragma('foreign_keys', { simple: true }) as number;

  try {
    // 1. Desativar verificação de foreign keys FORA da transação (A2)
    db.pragma('foreign_keys = OFF');

    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
        description TEXT NOT NULL
      );
    `);

    const currentVersionRow = db.prepare('SELECT MAX(version) as ver FROM hydra_schema_migrations').get() as { ver: number | null } | undefined;
    const currentVersion = currentVersionRow?.ver ?? 0;

    if (currentVersion >= 1) {
      return; // Já migrado (no-op idempotente)
    }

    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[];
    const tableNames = new Set(tables.map(t => t.name));

    function createFreshTables(database: Database.Database): void {
      database.exec(`
        CREATE TABLE IF NOT EXISTS hydra_analises_atendimento (
          revision_id TEXT PRIMARY KEY,
          analysis_id TEXT NOT NULL,
          source_id TEXT NOT NULL DEFAULT 'chatwoot',
          account_id TEXT NOT NULL DEFAULT 'acc_1',
          conversation_id INTEGER NOT NULL,
          loja_slug TEXT NOT NULL,
          covered_os_ids TEXT,
          source_type TEXT NOT NULL CHECK(source_type IN ('OPERATIONAL_SYNTHESIS', 'WATCHDOG_EVAL', 'DAILY_DISPATCH')) DEFAULT 'OPERATIONAL_SYNTHESIS',
          analyzed_until_message_id INTEGER,
          analyzed_until_timestamp TEXT NOT NULL,
          occurred_at TEXT,
          analyzed_at TEXT NOT NULL,
          recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
          analysis_run_id TEXT NOT NULL DEFAULT 'run_1',
          schema_version TEXT NOT NULL DEFAULT '1.0',
          analyzer_version TEXT NOT NULL DEFAULT '1.0',
          operational_summary TEXT,
          conduct_alert TEXT,
          candidate_contacts_json TEXT,
          candidate_vehicles_json TEXT,
          candidate_orders_json TEXT,
          is_valid INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS hydra_afirmacoes_analisadas (
          revision_id TEXT NOT NULL,
          statement_id TEXT NOT NULL,
          fact_id TEXT NOT NULL,
          analysis_id TEXT NOT NULL,
          target_os_id INTEGER,
          subject_type TEXT NOT NULL,
          polarity TEXT NOT NULL CHECK(polarity IN ('AFFIRMATIVE', 'NEGATIVE', 'CONDITIONAL')),
          author_role TEXT NOT NULL CHECK(author_role IN ('CLIENT', 'ATTENDANT', 'SYSTEM', 'UNKNOWN')),
          author_name TEXT NOT NULL,
          message_id INTEGER,
          event_timestamp TEXT NOT NULL,
          raw_excerpt TEXT NOT NULL,
          confirmation_level TEXT NOT NULL,
          service_scope TEXT,
          budget_version TEXT,
          monetary_cents INTEGER DEFAULT 0,
          delay_cause_reported TEXT,
          part_name TEXT,
          part_code TEXT,
          part_quantity_requested INTEGER,
          part_quantity_arrived INTEGER,
          order_ref TEXT,
          supersedes_fact_id TEXT,
          PRIMARY KEY (revision_id, statement_id),
          FOREIGN KEY (revision_id) REFERENCES hydra_analises_atendimento(revision_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hydra_lacunas_conversa (
          gap_id TEXT PRIMARY KEY,
          revision_id TEXT NOT NULL,
          analysis_id TEXT NOT NULL,
          conversation_id INTEGER NOT NULL,
          gap_type TEXT NOT NULL,
          message_id INTEGER,
          event_timestamp TEXT NOT NULL,
          description TEXT NOT NULL,
          FOREIGN KEY (revision_id) REFERENCES hydra_analises_atendimento(revision_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hydra_analysis_projection_outbox (
          job_id TEXT PRIMARY KEY,
          revision_id TEXT NOT NULL,
          analysis_id TEXT NOT NULL,
          loja_slug TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
          worker_id TEXT,
          claim_token TEXT,
          claimed_at TEXT,
          lease_expires_at TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          next_attempt_at TEXT,
          error_message TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          processed_at TEXT,
          FOREIGN KEY (revision_id) REFERENCES hydra_analises_atendimento(revision_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hydra_case_graph_nodes (
          node_id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('LOJA', 'CONTATO', 'CONVERSA', 'VEICULO', 'ORDEM_SERVICO', 'ANALISE', 'FATO', 'EVIDENCIA')),
          label TEXT NOT NULL,
          account_id TEXT NOT NULL,
          loja_slug TEXT NOT NULL,
          attributes_json TEXT NOT NULL,
          valid_from TEXT,
          valid_to TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS hydra_case_graph_edges (
          edge_id TEXT PRIMARY KEY,
          from_node_id TEXT NOT NULL,
          to_node_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          version INTEGER NOT NULL DEFAULT 1,
          link_method TEXT NOT NULL,
          confidence TEXT NOT NULL,
          loja_slug TEXT NOT NULL,
          evidence_ref TEXT NOT NULL,
          valid_from TEXT,
          valid_to TEXT,
          properties_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (from_node_id) REFERENCES hydra_case_graph_nodes(node_id) ON DELETE CASCADE,
          FOREIGN KEY (to_node_id) REFERENCES hydra_case_graph_nodes(node_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hydra_case_current_position (
          source_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          loja_slug TEXT NOT NULL,
          os_id INTEGER NOT NULL,
          vehicle_plate TEXT NOT NULL,
          vehicle_model TEXT NOT NULL,
          customer_phone TEXT NOT NULL,
          customer_name TEXT NOT NULL,
          current_erp_status TEXT NOT NULL,
          erp_snapshot_timestamp TEXT NOT NULL,
          current_approval_status TEXT NOT NULL,
          approved_budget_version TEXT,
          pending_budget_version TEXT,
          reported_delay_cause TEXT,
          reported_delay_author TEXT,
          reported_delay_role TEXT,
          reported_delay_at TEXT,
          reported_delay_raw TEXT,
          part_dependencies_json TEXT NOT NULL DEFAULT '[]',
          commitments_summary TEXT,
          active_gaps_json TEXT NOT NULL DEFAULT '[]',
          last_covered_message_id INTEGER,
          last_covered_timestamp TEXT NOT NULL,
          applied_revisions_json TEXT NOT NULL DEFAULT '{}',
          projection_version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source_id, loja_slug, os_id)
        );

        CREATE INDEX IF NOT EXISTS idx_analise_conv_loja ON hydra_analises_atendimento(conversation_id, loja_slug);
        CREATE INDEX IF NOT EXISTS idx_analise_loja ON hydra_analises_atendimento(loja_slug);
        CREATE INDEX IF NOT EXISTS idx_afirmacao_analysis ON hydra_afirmacoes_analisadas(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_afirmacao_os ON hydra_afirmacoes_analisadas(target_os_id);
        CREATE INDEX IF NOT EXISTS idx_lacuna_analysis ON hydra_lacunas_conversa(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_status ON hydra_analysis_projection_outbox(status, lease_expires_at);
        CREATE INDEX IF NOT EXISTS idx_case_pos_loja_os ON hydra_case_current_position(loja_slug, os_id);
      `);
    }

    if (!tableNames.has('hydra_analises_atendimento')) {
      // Caminho 1: Fresh install
      db.exec('BEGIN IMMEDIATE;');
      createFreshTables(db);
      db.prepare("INSERT INTO hydra_schema_migrations (version, description) VALUES (1, 'fresh_v1_install')").run();
      const fkCheck = db.pragma('foreign_key_check') as unknown[];
      if (fkCheck.length > 0) throw new Error('Foreign key check failed on fresh install');
      db.exec('COMMIT;');
      return;
    }

    // Caminho 2: Banco existente
    const cols = db.prepare("PRAGMA table_info(hydra_analises_atendimento)").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    if (colNames.has('revision_id')) {
      createFreshTables(db);
      db.exec('BEGIN IMMEDIATE;');
      db.prepare("INSERT OR IGNORE INTO hydra_schema_migrations (version, description) VALUES (1, 'already_has_revision_id')").run();
      db.exec('COMMIT;');
      return;
    }

    db.exec('BEGIN IMMEDIATE;');

    // Criar tabelas _new
    db.exec(`
      CREATE TABLE hydra_analises_atendimento_new (
        revision_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        source_id TEXT NOT NULL DEFAULT 'legacy_source',
        account_id TEXT NOT NULL DEFAULT 'legacy_account',
        conversation_id INTEGER NOT NULL,
        loja_slug TEXT NOT NULL,
        covered_os_ids TEXT,
        source_type TEXT NOT NULL CHECK(source_type IN ('OPERATIONAL_SYNTHESIS', 'WATCHDOG_EVAL', 'DAILY_DISPATCH')),
        analyzed_until_message_id INTEGER,
        analyzed_until_timestamp TEXT NOT NULL,
        occurred_at TEXT,
        analyzed_at TEXT NOT NULL,
        recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        analysis_run_id TEXT NOT NULL DEFAULT 'run_legacy',
        schema_version TEXT NOT NULL DEFAULT '1.0',
        analyzer_version TEXT NOT NULL DEFAULT '1.0',
        operational_summary TEXT,
        conduct_alert TEXT,
        candidate_contacts_json TEXT,
        candidate_vehicles_json TEXT,
        candidate_orders_json TEXT,
        is_valid INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE hydra_afirmacoes_analisadas_new (
        revision_id TEXT NOT NULL,
        statement_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        analysis_id TEXT NOT NULL,
        target_os_id INTEGER,
        subject_type TEXT NOT NULL,
        polarity TEXT NOT NULL CHECK(polarity IN ('AFFIRMATIVE', 'NEGATIVE', 'CONDITIONAL')),
        author_role TEXT NOT NULL CHECK(author_role IN ('CLIENT', 'ATTENDANT', 'SYSTEM', 'UNKNOWN')),
        author_name TEXT NOT NULL,
        message_id INTEGER,
        event_timestamp TEXT NOT NULL,
        raw_excerpt TEXT NOT NULL,
        confirmation_level TEXT NOT NULL,
        service_scope TEXT,
        budget_version TEXT,
        monetary_cents INTEGER DEFAULT 0,
        delay_cause_reported TEXT,
        part_name TEXT,
        part_code TEXT,
        part_quantity_requested INTEGER,
        part_quantity_arrived INTEGER,
        order_ref TEXT,
        supersedes_fact_id TEXT,
        PRIMARY KEY (revision_id, statement_id),
        FOREIGN KEY (revision_id) REFERENCES hydra_analises_atendimento_new(revision_id) ON DELETE CASCADE
      );

      CREATE TABLE hydra_lacunas_conversa_new (
        gap_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        analysis_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL,
        gap_type TEXT NOT NULL,
        message_id INTEGER,
        event_timestamp TEXT NOT NULL,
        description TEXT NOT NULL,
        FOREIGN KEY (revision_id) REFERENCES hydra_analises_atendimento_new(revision_id) ON DELETE CASCADE
      );
    `);

    const hasCoveredOsIds = colNames.has('covered_os_ids');
    const hasSourceType = colNames.has('source_type');
    const hasAnalyzedUntilMsg = colNames.has('analyzed_until_message_id');
    const hasAnalyzedUntilTs = colNames.has('analyzed_until_timestamp');
    const hasGeneratedAt = colNames.has('generated_at');
    const hasCreatedAt = colNames.has('created_at');
    const hasAnalyzedAt = colNames.has('analyzed_at');
    const hasExecSummary = colNames.has('executive_summary');
    const hasIsValid = colNames.has('is_valid');

    const totalOldAnalyses = (db.prepare("SELECT COUNT(*) as c FROM hydra_analises_atendimento").get() as { c: number }).c;

    const selectAnSql = `
      INSERT INTO hydra_analises_atendimento_new (
        revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
        covered_os_ids, source_type, analyzed_until_message_id, analyzed_until_timestamp,
        occurred_at, analyzed_at, recorded_at, analysis_run_id, schema_version, analyzer_version,
        operational_summary, is_valid
      )
      SELECT
        'legacy:' || analysis_id,
        analysis_id,
        'legacy_source',
        'legacy_account',
        conversation_id,
        loja_slug,
        ${hasCoveredOsIds ? 'covered_os_ids' : (colNames.has('os_id') ? "('[' || os_id || ']')" : "NULL")},
        ${hasSourceType ? 'source_type' : "'OPERATIONAL_SYNTHESIS'"},
        ${hasAnalyzedUntilMsg ? 'analyzed_until_message_id' : 'NULL'},
        ${hasAnalyzedUntilTs ? 'analyzed_until_timestamp' : (hasAnalyzedAt ? 'analyzed_at' : "datetime('now')")},
        ${hasGeneratedAt ? 'generated_at' : (hasAnalyzedAt ? 'analyzed_at' : "datetime('now')")},
        ${hasAnalyzedAt ? 'analyzed_at' : (hasGeneratedAt ? 'generated_at' : "datetime('now')")},
        ${hasCreatedAt ? 'created_at' : "datetime('now')"},
        'run_legacy',
        '1.0',
        '1.0',
        ${hasExecSummary ? 'executive_summary' : "NULL"},
        ${hasIsValid ? 'is_valid' : '1'}
      FROM hydra_analises_atendimento;
    `;
    db.exec(selectAnSql);

    const totalNewAnalyses = (db.prepare("SELECT COUNT(*) as c FROM hydra_analises_atendimento_new").get() as { c: number }).c;
    if (totalOldAnalyses !== totalNewAnalyses) {
      throw new Error(`Migration count mismatch: old=${totalOldAnalyses}, new=${totalNewAnalyses}`);
    }

    if (tableNames.has('hydra_afirmacoes_analisadas')) {
      const stmtCols = new Set((db.prepare("PRAGMA table_info(hydra_afirmacoes_analisadas)").all() as { name: string }[]).map(c => c.name));
      const totalOldStmts = (db.prepare("SELECT COUNT(*) as c FROM hydra_afirmacoes_analisadas").get() as { c: number }).c;

      const hasStmtSubjectType = stmtCols.has('subject_type');
      const hasStmtSubject = stmtCols.has('subject');
      const hasTargetOs = stmtCols.has('target_os_id');
      const hasMsgId = stmtCols.has('message_id');
      const hasEventTs = stmtCols.has('event_timestamp');
      const hasStmtCreatedAt = stmtCols.has('created_at');
      const hasMonetaryVal = stmtCols.has('monetary_value');
      const hasMonetaryCents = stmtCols.has('monetary_cents');
      const hasScope = stmtCols.has('service_scope');
      const hasBudget = stmtCols.has('budget_version');

      const selectStmtSql = `
        INSERT INTO hydra_afirmacoes_analisadas_new (
          revision_id, statement_id, fact_id, analysis_id, target_os_id, subject_type,
          polarity, author_role, author_name, message_id, event_timestamp, raw_excerpt,
          confirmation_level, service_scope, budget_version, monetary_cents
        )
        SELECT
          'legacy:' || analysis_id,
          statement_id,
          'fact_' || statement_id,
          analysis_id,
          ${hasTargetOs ? 'target_os_id' : 'NULL'},
          ${hasStmtSubjectType ? 'subject_type' : (hasStmtSubject ? 'subject' : "'OPERATIONAL'")},
          polarity,
          author_role,
          author_name,
          ${hasMsgId ? 'message_id' : 'NULL'},
          ${hasEventTs ? 'event_timestamp' : (hasStmtCreatedAt ? 'created_at' : "datetime('now')")},
          raw_excerpt,
          confirmation_level,
          ${hasScope ? 'service_scope' : 'NULL'},
          ${hasBudget ? 'budget_version' : 'NULL'},
          ${hasMonetaryCents ? 'monetary_cents' : (hasMonetaryVal ? 'CAST(ROUND(monetary_value * 100) AS INTEGER)' : '0')}
        FROM hydra_afirmacoes_analisadas;
      `;
      db.exec(selectStmtSql);

      const totalNewStmts = (db.prepare("SELECT COUNT(*) as c FROM hydra_afirmacoes_analisadas_new").get() as { c: number }).c;
      if (totalOldStmts !== totalNewStmts) {
        throw new Error(`Stmt count mismatch: old=${totalOldStmts}, new=${totalNewStmts}`);
      }
    }

    if (tableNames.has('hydra_lacunas_conversa')) {
      const gapCols = new Set((db.prepare("PRAGMA table_info(hydra_lacunas_conversa)").all() as { name: string }[]).map(c => c.name));
      const totalOldGaps = (db.prepare("SELECT COUNT(*) as c FROM hydra_lacunas_conversa").get() as { c: number }).c;

      const hasGapConv = gapCols.has('conversation_id');
      const hasGapMsg = gapCols.has('message_id');
      const hasGapEventTs = gapCols.has('event_timestamp');
      const hasGapDetectedAt = gapCols.has('first_detected_at');

      const selectGapSql = `
        INSERT INTO hydra_lacunas_conversa_new (
          gap_id, revision_id, analysis_id, conversation_id, gap_type, message_id, event_timestamp, description
        )
        SELECT
          gap_id,
          'legacy:' || analysis_id,
          analysis_id,
          ${hasGapConv ? 'conversation_id' : '0'},
          gap_type,
          ${hasGapMsg ? 'message_id' : 'NULL'},
          ${hasGapEventTs ? 'event_timestamp' : (hasGapDetectedAt ? 'first_detected_at' : "datetime('now')")},
          description
        FROM hydra_lacunas_conversa;
      `;
      db.exec(selectGapSql);

      const totalNewGaps = (db.prepare("SELECT COUNT(*) as c FROM hydra_lacunas_conversa_new").get() as { c: number }).c;
      if (totalOldGaps !== totalNewGaps) {
        throw new Error(`Gap count mismatch: old=${totalOldGaps}, new=${totalNewGaps}`);
      }
    }

    // Dropar antigas e Renomear novas
    db.exec(`
      DROP TABLE IF EXISTS hydra_lacunas_conversa;
      DROP TABLE IF EXISTS hydra_afirmacoes_analisadas;
      DROP TABLE IF EXISTS hydra_analises_atendimento;

      ALTER TABLE hydra_analises_atendimento_new RENAME TO hydra_analises_atendimento;
      ALTER TABLE hydra_afirmacoes_analisadas_new RENAME TO hydra_afirmacoes_analisadas;
      ALTER TABLE hydra_lacunas_conversa_new RENAME TO hydra_lacunas_conversa;
    `);

    // Criar tabelas auxiliares
    createFreshTables(db);

    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    if (fkErrors.length > 0) {
      throw new Error('Integrity check failed: invalid foreign keys after legacy migration');
    }

    db.prepare("INSERT INTO hydra_schema_migrations (version, description) VALUES (1, 'legacy_rebuild_complete')").run();
    db.exec('COMMIT;');
  } catch (err) {
    if (db.inTransaction) {
      db.exec('ROLLBACK;');
    }
    throw err;
  } finally {
    // 3. Restaurar foreign keys fora da transação
    db.pragma(`foreign_keys = ${fkInitial}`);
  }
}

/**
 * Classe RealAnalysisRepository: Implementa IAnalysisRepository com persistência SQLite real,
 * validação rigorosa de disponibilidade (F01) e aproveitamento de fatos de WATCHDOG_EVAL (F08).
 */
export class RealAnalysisRepository implements IAnalysisRepository {
  private readonly db?: Database.Database;
  private readonly configured: boolean;

  constructor(config?: RealAnalysisRepositoryConfig) {
    if (config?.db && config.isConfigured !== false) {
      this.db = config.db;
      this.configured = true;
      this.ensureSchema(this.db);
    } else {
      this.db = undefined;
      this.configured = false;
    }
  }

  public isAvailable(): boolean {
    return this.configured && Boolean(this.db);
  }

  public checkAvailability(): AnalysisAvailabilityStatus {
    if (!this.isAvailable()) {
      return {
        isAvailable: false,
        status: 'UNCONFIGURED',
        reason: 'Base física de persistência de análises não configurada. Injeção de mocks silenciosos em produção é expressamente vedada (F01).'
      };
    }
    return {
      isAvailable: true,
      status: 'AVAILABLE'
    };
  }

  public ensureSchema(db: Database.Database): void {
    runCaseHistoryGraphMigration(db);
    ensureCaseAnalysisTables(db);
  }

  public validateStrictOrderLink(
    analysis: ConversationAnalysisRecord,
    target: { osId: number; lojaSlug: string }
  ): { isValidLink: boolean; gap?: ConversationGap | { gapType: 'NOT_IN_ANALYSIS' | string; description?: string } } {
    if (!analysis || !analysis.isValid) {
      return {
        isValidLink: false,
        gap: {
          gapType: 'NOT_IN_ANALYSIS',
          description: 'Análise inválida ou inexistente.'
        }
      };
    }

    const sameStore = analysis.lojaSlug.toLowerCase() === target.lojaSlug.toLowerCase();
    const coversOs = Boolean(analysis.coveredOsIds && analysis.coveredOsIds.includes(target.osId));

    if (!sameStore || !coversOs) {
      return {
        isValidLink: false,
        gap: {
          gapType: 'NOT_IN_ANALYSIS',
          description: `Análise divergente: loja (${analysis.lojaSlug} vs ${target.lojaSlug}) ou OS não coberta.`
        }
      };
    }

    return {
      isValidLink: true
    };
  }

  public async getAnalysisForOrderWithStrictValidation(
    conversationId: number,
    target: { osId: number; lojaSlug: string }
  ): Promise<{
    analysis: ConversationAnalysisRecord | null;
    isValidLink: boolean;
    usableStatements: readonly ExtractedStatement[];
    gap?: ConversationGap | { gapType: string; description?: string };
  }> {
    const analysis = await this.getAnalysisByConversation(conversationId, target.lojaSlug);
    if (!analysis) {
      return {
        analysis: null,
        isValidLink: false,
        usableStatements: [],
        gap: { gapType: 'NOT_IN_ANALYSIS', description: 'Nenhuma análise encontrada para a conversa.' }
      };
    }
    const validation = this.validateStrictOrderLink(analysis, target);
    const usableStatements = validation.isValidLink
      ? (analysis.statements || []).filter(s => s.targetOsId === target.osId || !s.targetOsId)
      : [];
    return {
      analysis,
      isValidLink: validation.isValidLink,
      usableStatements,
      gap: validation.gap
    };
  }

  public async saveAnalysis(analysis: ConversationAnalysisRecord): Promise<void> {
    if (!this.db) {
      throw new PhysicalDatabaseUnavailableError();
    }

    this.ensureSchema(this.db);
    const nowIso = new Date().toISOString();

    const cols = (this.db.prepare("PRAGMA table_info(hydra_analises_atendimento)").all() as { name: string }[]).map(c => c.name);
    const hasRevisionId = cols.includes('revision_id');

    const transaction = this.db.transaction(() => {
      if (!this.db) throw new PhysicalDatabaseUnavailableError();

      if (hasRevisionId) {
        const revId = analysis.revisionId || ('rev_' + analysis.analysisId);
        this.db.prepare(`
          INSERT INTO hydra_analises_atendimento (
            revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
            covered_os_ids, source_type, analyzed_until_message_id, analyzed_until_timestamp,
            occurred_at, analyzed_at, recorded_at, analysis_run_id, schema_version, analyzer_version,
            operational_summary, is_valid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(revision_id) DO UPDATE SET
            covered_os_ids = excluded.covered_os_ids,
            source_type = excluded.source_type,
            analyzed_until_message_id = excluded.analyzed_until_message_id,
            analyzed_until_timestamp = excluded.analyzed_until_timestamp,
            analyzed_at = excluded.analyzed_at,
            operational_summary = excluded.operational_summary,
            is_valid = excluded.is_valid
        `).run(
          revId,
          analysis.analysisId,
          analysis.sourceId || 'chatwoot',
          analysis.accountId || 'acc_1',
          analysis.conversationId,
          analysis.lojaSlug,
          analysis.coveredOsIds ? JSON.stringify(analysis.coveredOsIds) : null,
          analysis.sourceType || 'OPERATIONAL_SYNTHESIS',
          analysis.analyzedUntilMessageId || null,
          analysis.analyzedUntilTimestamp || nowIso,
          analysis.occurredAt || nowIso,
          analysis.analyzedAt || nowIso,
          analysis.recordedAt || nowIso,
          analysis.analysisRunId || 'run_1',
          analysis.schemaVersion || '1.0',
          analysis.analyzerVersion || '1.0',
          analysis.operationalSummary || analysis.executiveSummary || null,
          analysis.isValid === false ? 0 : 1
        );

        this.db.prepare('DELETE FROM hydra_afirmacoes_analisadas WHERE revision_id = ?').run(revId);
        this.db.prepare('DELETE FROM hydra_lacunas_conversa WHERE revision_id = ?').run(revId);

        const stmts = analysis.statements || analysis.extractedStatements || [];
        for (const s of stmts) {
          this.db.prepare(`
            INSERT INTO hydra_afirmacoes_analisadas (
              revision_id, statement_id, fact_id, analysis_id, target_os_id, subject_type,
              polarity, author_role, author_name, message_id, event_timestamp, raw_excerpt,
              confirmation_level, service_scope, budget_version, monetary_cents, delay_cause_reported,
              part_name, part_code, part_quantity_requested, part_quantity_arrived, order_ref, supersedes_fact_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            revId,
            s.statementId,
            s.factId || ('fact_' + s.statementId),
            analysis.analysisId,
            s.targetOsId || null,
            s.subjectType || s.subject || 'OPERATIONAL',
            s.polarity || 'AFFIRMATIVE',
            s.authorRole || 'ATTENDANT',
            s.authorName || 'Desconhecido',
            s.messageId || null,
            s.eventTimestamp || s.timestamp || nowIso,
            s.rawExcerpt || '',
            s.confirmationLevel || s.confirmation || 'CONFIRMED',
            s.serviceScope || null,
            s.budgetVersion || null,
            s.monetaryCents !== undefined ? s.monetaryCents : (s.monetaryValue ? Math.round(s.monetaryValue * 100) : 0),
            s.delayCauseReported || null,
            s.partName || s.partReference?.partName || null,
            s.partCode || s.partReference?.partCode || null,
            s.partQuantityRequested !== undefined ? s.partQuantityRequested : (s.partReference?.quantity || null),
            s.partQuantityArrived || null,
            s.orderRef || null,
            s.supersedesFactId || null
          );
        }

        const gaps = analysis.gaps || [];
        for (const g of gaps) {
          this.db.prepare(`
            INSERT INTO hydra_lacunas_conversa (
              gap_id, revision_id, analysis_id, conversation_id, gap_type, message_id, event_timestamp, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            g.gapId,
            revId,
            analysis.analysisId,
            g.conversationId,
            g.gapType,
            g.messageId || null,
            g.eventTimestamp || g.timestamp || nowIso,
            g.description
          );
        }
      } else {
        // Fallback para schema sem revision_id se executado antes da migração
        this.db.prepare(`
          INSERT OR REPLACE INTO hydra_analises_atendimento (
            analysis_id, conversation_id, loja_slug, covered_os_ids,
            source_type, analyzed_until_message_id, analyzed_until_timestamp,
            generated_at, analysis_version, is_valid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          analysis.analysisId,
          analysis.conversationId,
          analysis.lojaSlug,
          JSON.stringify(analysis.coveredOsIds || []),
          analysis.sourceType,
          analysis.analyzedUntilMessageId || 0,
          analysis.analyzedUntilTimestamp || nowIso,
          analysis.generatedAt || nowIso,
          analysis.analysisVersion || '1.0',
          analysis.isValid === false ? 0 : 1
        );
      }
    });

    transaction();
  }

  public async getAnalysisByConversation(
    conversationId: number,
    lojaSlug: string
  ): Promise<ConversationAnalysisRecord | null> {
    if (!this.db) {
      throw new PhysicalDatabaseUnavailableError();
    }

    const row = this.db.prepare(`
      SELECT * FROM hydra_analises_atendimento 
      WHERE conversation_id = ? AND loja_slug = ? AND is_valid = 1
      ORDER BY analyzed_at DESC
      LIMIT 1
    `).get(conversationId, lojaSlug) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.hydrateAnalysis(row);
  }

  public async getAnalysisByOS(
    osId: number,
    lojaSlug: string
  ): Promise<ConversationAnalysisRecord | null> {
    if (!this.db) {
      throw new PhysicalDatabaseUnavailableError();
    }

    const rows = this.db.prepare(`
      SELECT * FROM hydra_analises_atendimento 
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?)) AND is_valid = 1
      ORDER BY analyzed_at DESC
    `).all(lojaSlug, lojaSlug) as Record<string, unknown>[];

    for (const row of rows) {
      if (row.covered_os_ids) {
        try {
          const coveredOsIds = JSON.parse(String(row.covered_os_ids));
          if (Array.isArray(coveredOsIds) && coveredOsIds.map(Number).includes(Number(osId))) {
            return this.hydrateAnalysis(row);
          }
        } catch {}
      }
    }

    return null;
  }

  public async listAnalysesByStore(
    lojaSlug: string
  ): Promise<readonly ConversationAnalysisRecord[]> {
    if (!this.db) {
      throw new PhysicalDatabaseUnavailableError();
    }

    const rows = this.db.prepare(`
      SELECT * FROM hydra_analises_atendimento 
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?)) AND is_valid = 1
      ORDER BY analyzed_at DESC
    `).all(lojaSlug, lojaSlug) as Record<string, unknown>[];

    return rows.map(r => this.hydrateAnalysis(r));
  }

  public evaluateAnalysisEvidence(analysis: ConversationAnalysisRecord): AnalysisEvidenceEvaluation {
    const stmts = analysis.statements || analysis.extractedStatements || [];
    if (analysis.sourceType === 'WATCHDOG_EVAL') {
      const operationalStatements = this.getOperationalStatements(analysis);
      if (operationalStatements.length === 0) {
        return {
          canUseAsBase: false,
          isWatchdogInfractionOnly: true,
          usableStatements: [],
          reason: 'Relatório do Watchdog trata apenas de infrações de conduta sem fatos operacionais da OS.'
        };
      }

      return {
        canUseAsBase: true,
        isWatchdogInfractionOnly: false,
        usableStatements: operationalStatements,
        reason: undefined
      };
    }

    const gaps = analysis.gaps || [];
    if (stmts.length === 0 && gaps.length === 0) {
      return {
        canUseAsBase: false,
        isWatchdogInfractionOnly: false,
        usableStatements: [],
        reason: 'Análise sem afirmações estruturadas ou metadados de cobertura.'
      };
    }

    return {
      canUseAsBase: true,
      isWatchdogInfractionOnly: false,
      usableStatements: stmts
    };
  }

  public getOperationalStatements(analysis: ConversationAnalysisRecord): readonly ExtractedStatement[] {
    const stmts = analysis.statements || analysis.extractedStatements || [];
    return stmts.filter(s => s.subject !== 'WATCHDOG_FLAG');
  }

  private hydrateAnalysis(row: Record<string, unknown>): ConversationAnalysisRecord {
    if (!this.db) throw new PhysicalDatabaseUnavailableError();

    const analysisId = String(row.analysis_id);
    const revisionId = row.revision_id ? String(row.revision_id) : undefined;

    const statementRows = revisionId
      ? (this.db.prepare('SELECT * FROM hydra_afirmacoes_analisadas WHERE revision_id = ?').all(revisionId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM hydra_afirmacoes_analisadas WHERE analysis_id = ?').all(analysisId) as Record<string, unknown>[]);

    const statements: ExtractedStatement[] = statementRows.map(r => ({
      statementId: String(r.statement_id),
      revisionId: r.revision_id ? String(r.revision_id) : undefined,
      analysisId: String(r.analysis_id),
      factId: r.fact_id ? String(r.fact_id) : undefined,
      targetOsId: r.target_os_id !== null && r.target_os_id !== undefined ? Number(r.target_os_id) : undefined,
      subject: String(r.subject_type || r.subject || 'OPERATIONAL') as StatementSubject,
      subjectType: r.subject_type ? String(r.subject_type) : undefined,
      polarity: String(r.polarity || 'AFFIRMATIVE') as StatementPolarity,
      authorRole: String(r.author_role || 'ATTENDANT') as AuthorRole,
      authorName: String(r.author_name || ''),
      messageId: r.message_id !== null && r.message_id !== undefined ? Number(r.message_id) : undefined,
      timestamp: String(r.event_timestamp || r.created_at || ''),
      eventTimestamp: r.event_timestamp ? String(r.event_timestamp) : undefined,
      rawExcerpt: String(r.raw_excerpt || ''),
      confirmation: String(r.confirmation_level || 'CONFIRMED') as ConfirmationLevel,
      confirmationLevel: r.confirmation_level ? (String(r.confirmation_level) as ConfirmationLevel) : undefined,
      serviceScope: r.service_scope ? String(r.service_scope) : undefined,
      budgetVersion: r.budget_version ? String(r.budget_version) : undefined,
      monetaryValue: r.monetary_cents !== null && r.monetary_cents !== undefined ? Number(r.monetary_cents) / 100 : (r.monetary_value !== null ? Number(r.monetary_value) : undefined),
      monetaryCents: r.monetary_cents !== null && r.monetary_cents !== undefined ? Number(r.monetary_cents) : undefined,
      delayCauseReported: r.delay_cause_reported ? String(r.delay_cause_reported) : undefined
    }));

    const gapRows = revisionId
      ? (this.db.prepare('SELECT * FROM hydra_lacunas_conversa WHERE revision_id = ?').all(revisionId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM hydra_lacunas_conversa WHERE analysis_id = ?').all(analysisId) as Record<string, unknown>[]);

    const gaps: ConversationGap[] = gapRows.map(r => ({
      gapId: String(r.gap_id),
      revisionId: r.revision_id ? String(r.revision_id) : undefined,
      analysisId: String(r.analysis_id),
      conversationId: Number(r.conversation_id),
      gapType: String(r.gap_type) as GapType,
      messageId: r.message_id !== null && r.message_id !== undefined ? Number(r.message_id) : undefined,
      timestamp: String(r.event_timestamp || ''),
      description: String(r.description)
    }));

    let coveredOsIds: number[] = [];
    if (row.covered_os_ids) {
      try {
        coveredOsIds = JSON.parse(String(row.covered_os_ids)).map(Number);
      } catch {}
    }

    return {
      analysisId,
      summaryId: analysisId,
      revisionId,
      sourceId: row.source_id ? String(row.source_id) : undefined,
      accountId: row.account_id ? String(row.account_id) : undefined,
      conversationId: Number(row.conversation_id),
      lojaSlug: String(row.loja_slug),
      coveredOsIds,
      sourceType: String(row.source_type || 'OPERATIONAL_SYNTHESIS') as AnalysisSourceType,
      analyzedUntilMessageId: row.analyzed_until_message_id !== null ? Number(row.analyzed_until_message_id) : undefined,
      cursorLastMessageId: row.analyzed_until_message_id !== null ? Number(row.analyzed_until_message_id) : undefined,
      analyzedUntilTimestamp: String(row.analyzed_until_timestamp || row.analyzed_at || ''),
      messagesCoveredUntil: String(row.analyzed_until_timestamp || row.analyzed_at || ''),
      generatedAt: String(row.generated_at || row.analyzed_at || ''),
      analyzedAt: String(row.analyzed_at || ''),
      recordedAt: row.recorded_at ? String(row.recorded_at) : undefined,
      analysisRunId: row.analysis_run_id ? String(row.analysis_run_id) : undefined,
      schemaVersion: row.schema_version ? String(row.schema_version) : undefined,
      analyzerVersion: row.analyzer_version ? String(row.analyzer_version) : undefined,
      analysisVersion: String(row.analysis_version || '1.0'),
      executiveSummary: row.operational_summary ? String(row.operational_summary) : undefined,
      operationalSummary: row.operational_summary ? String(row.operational_summary) : undefined,
      statements,
      extractedStatements: statements,
      gaps,
      isValid: Number(row.is_valid) === 1
    };
  }
}
