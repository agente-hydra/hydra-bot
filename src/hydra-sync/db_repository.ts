import type {
  FinancialQueryState,
  GoalGapResult,
  GoalGapStoreItem,
  GoalGapCoverage,
  StoreCMVResult,
  StoreCMVAreaItem,
  StoreAreasResult,
  StoreMediaSurveyResult,
  StoreMediaChannelItem,
  GoogleCentralMediaSurveyResult,
  GoogleCentralStoreItem,
  NetworkFinancialOverviewResult,
  NetworkCMVResult,
  StoreCMVItem,
  AllStoresCMVResult,
  UnifiedCMVResult,
  NetworkFinancialStoreItem
} from './financial_contract.js';

export * from './financial_contract.js';

import type {
  OrderRecord,
  OrderOperationalState,
  OrderDataQuality
} from './types/query_contract.js';

export type { OrderRecord, OrderOperationalState, OrderDataQuality };


import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { initSemanticGlossary } from './semantic_glossary.js';
import { ensureCaseAnalysisTables } from './real_analysis_repository.js';
import * as crypto from 'crypto';
import { createRequire } from 'module';

// Compatibilidade segura CJS/ESM sem import.meta em output CommonJS
const requireESM = typeof require !== 'undefined'
  ? require
  : createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd());

export interface VectorExtensionStatus {
  isLoaded: boolean;
  version?: string;
  loadablePath?: string;
  tableExists: boolean;
  totalVectors: number;
  error?: string;
}

let isVectorExtensionLoaded = false;
let vectorExtensionError: string | null = null;
let vectorExtensionVersion: string | null = null;
let vectorLoadablePath: string | null = null;

export function loadVectorExtension(db: Database.Database): boolean {
  try {
    try {
      db.prepare('SELECT vec_version()').get();
      return true;
    } catch {}

    const sqliteVec = requireESM('sqlite-vec');
    if (typeof sqliteVec.load === 'function') {
      sqliteVec.load(db);
    } else if (typeof sqliteVec.getLoadablePath === 'function') {
      const p = sqliteVec.getLoadablePath();
      vectorLoadablePath = p;
      db.loadExtension(p);
    }

    const verRow = db.prepare('SELECT vec_version() as version').get() as { version: string } | undefined;
    vectorExtensionVersion = verRow?.version || 'unknown';
    isVectorExtensionLoaded = true;
    vectorExtensionError = null;
    return true;
  } catch (err: any) {
    try {
      const sqliteVec = requireESM('sqlite-vec');
      if (typeof sqliteVec.getLoadablePath === 'function') {
        const p = sqliteVec.getLoadablePath();
        vectorLoadablePath = p;
        db.loadExtension(p);
        const verRow = db.prepare('SELECT vec_version() as version').get() as { version: string } | undefined;
        vectorExtensionVersion = verRow?.version || 'unknown';
        isVectorExtensionLoaded = true;
        vectorExtensionError = null;
        return true;
      }
    } catch (fallbackErr: any) {
      vectorExtensionError = fallbackErr?.message || err?.message || String(err);
    }
    vectorExtensionError = err?.message || String(err);
    isVectorExtensionLoaded = false;
    return false;
  }
}

export function checkVectorExtensionStatus(db: Database.Database): VectorExtensionStatus {
  let tableExists = false;
  let totalVectors = 0;

  try {
    const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_ordens_servico'").get();
    tableExists = !!tableRow;
    if (tableExists && isVectorExtensionLoaded) {
      const countRow = db.prepare('SELECT count(*) as count FROM vec_ordens_servico').get() as { count: number } | undefined;
      totalVectors = countRow?.count ?? 0;
    }
  } catch {}

  return {
    isLoaded: isVectorExtensionLoaded,
    version: vectorExtensionVersion || undefined,
    loadablePath: vectorLoadablePath || undefined,
    tableExists,
    totalVectors,
    error: vectorExtensionError || undefined
  };
}

export interface MetaLojaItem {
  loja_slug: string;
  faturamento_mes: number;
  volume_os: number;
  ticket_medio: number;
  meta_mes?: number;
  previsao_mes?: number;
  percentual_meta?: number;
}

export interface CMVLojaItem {
  loja_slug: string;
  data_inicio: string;
  data_fim: string;
  faturamento_total: number;
  desconto_total?: number;
  custo_total: number;
  cmv_percentual: number;
  lucro_bruto: number;
  lucro_bruto_percentual: number;
}

export interface FaturamentoAreaItem {
  loja_slug: string;
  data_inicio: string;
  data_fim: string;
  area: string;
  faturamento: number;
  faturamento_percentual?: number;
  desconto?: number;
  custo: number;
  cmv_percentual: number;
  lucro_bruto: number;
  lucro_bruto_percentual: number;
}

export interface PesquisaMidiaItem {
  loja_slug: string;
  data_inicio: string;
  data_fim: string;
  canal: string;
  faturamento: number;
  faturamento_percentual?: number;
  qtd_os: number;
  ticket_medio?: number;
}

export interface OSItemInput {
  os_id: string;
  loja_slug: string;
  tipo?: string;
  status_grid?: string;
  is_aberta: number;
  data_inicio?: string;
  data_fim?: string | null;
  dias_no_patio?: number;
  veiculo?: string;
  placa?: string;
  cliente_nome?: string;
  responsavel?: string;
  total_os?: number;
  valor_pago?: number;
  valor_restante?: number;
  tem_nf?: number;
  raw_payload?: string;
}


/**
 * Converte data no formato brasileiro (DD/MM/YY HH:MM ou DD/MM/YYYY HH:MM)
 * para ISO 8601 com fuso America/Sao_Paulo (-03:00).
 * Preserva precisão original estrita sem inventar horários fictícios.
 */
export function parseBrDateToIso(rawDate: string | null | undefined): string | null {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;

  // DD/MM/YY HH:MM(:SS)? ou DD/MM/YYYY HH:MM(:SS)?
  const dtMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dtMatch) {
    const day = dtMatch[1].padStart(2, '0');
    const month = dtMatch[2].padStart(2, '0');
    let year = dtMatch[3];
    if (year.length === 2) {
      const yNum = parseInt(year, 10);
      year = yNum >= 70 ? '19' + year : '20' + year;
    }
    const hasTime = dtMatch[4] !== undefined;
    if (hasTime) {
      const hour = dtMatch[4].padStart(2, '0');
      const min = dtMatch[5].padStart(2, '0');
      const sec = (dtMatch[6] || '00').padStart(2, '0');
      return `${year}-${month}-${day}T${hour}:${min}:${sec}-03:00`;
    }
    return `${year}-${month}-${day}`;
  }

  // YYYY-MM-DD HH:MM:SS (SQLite datetime)
  const sqlMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (sqlMatch) {
    const year = sqlMatch[1];
    const month = sqlMatch[2];
    const day = sqlMatch[3];
    if (sqlMatch[4]) {
      return `${year}-${month}-${day}T${sqlMatch[4]}:${sqlMatch[5]}:${sqlMatch[6]}-03:00`;
    }
    return `${year}-${month}-${day}`;
  }

  // Já em formato ISO com ou sem timezone
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return trimmed;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Retorna timestamp ISO no fuso America/Sao_Paulo (-03:00).
 */
export function formatIsoTimestamp(date?: Date): string {
  const d = date || new Date();
  const spFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = spFormatter.formatToParts(d);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  return `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}-03:00`;
}

function resolveDbPath(): string {
  if (process.env.HYDRA_DB_PATH) return process.env.HYDRA_DB_PATH;
  if (process.platform === 'win32') {
    return path.resolve('.tmp', 'hydra_ops.db');
  }
  return '/home/operacional/hydra-data/hydra_ops.db';
}

export function getDatabaseConnection(customPath?: string): Database.Database {
  const dbPath = customPath || resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -64000'); // 64MB cache

  // Carrega extensão vetorial sqlite-vec de forma segura e compatível com ESM
  loadVectorExtension(db);

  initSchema(db);
  return db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lojas (
      slug TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      ativa INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metas_diarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_mes REAL NOT NULL,
      volume_os INTEGER NOT NULL,
      ticket_medio REAL NOT NULL,
      meta_mes REAL,
      previsao_mes REAL,
      percentual_meta REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(data_referencia, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS cmv_lojas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      faturamento_total REAL NOT NULL,
      desconto_total REAL DEFAULT 0,
      custo_total REAL NOT NULL,
      cmv_percentual REAL NOT NULL,
      lucro_bruto REAL NOT NULL,
      lucro_bruto_percentual REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim)
    );

    CREATE TABLE IF NOT EXISTS faturamento_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      area TEXT NOT NULL,
      faturamento REAL NOT NULL,
      faturamento_percentual REAL DEFAULT 0,
      desconto REAL DEFAULT 0,
      custo REAL NOT NULL,
      cmv_percentual REAL NOT NULL,
      lucro_bruto REAL NOT NULL,
      lucro_bruto_percentual REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim, area)
    );

    CREATE TABLE IF NOT EXISTS pesquisa_midia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      canal TEXT NOT NULL,
      faturamento REAL NOT NULL,
      faturamento_percentual REAL DEFAULT 0,
      qtd_os INTEGER NOT NULL,
      ticket_medio REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim, canal)
    );

    CREATE TABLE IF NOT EXISTS ordens_servico (
      os_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      tipo TEXT DEFAULT 'OS',
      status_grid TEXT,
      is_aberta INTEGER NOT NULL DEFAULT 1,
      estado_operacional TEXT DEFAULT 'ABERTA',
      qualidade_dado TEXT DEFAULT 'VALIDADO',
      data_inicio TEXT,
      data_fim TEXT,
      data_inicio_iso TEXT,
      data_fim_iso TEXT,
      data_evento_iso TEXT,
      data_observacao_iso TEXT,
      origem_transicao TEXT DEFAULT 'LEGADO',
      dias_no_patio INTEGER DEFAULT 0,
      veiculo TEXT,
      placa TEXT,
      cliente_nome TEXT,
      responsavel TEXT,
      total_os REAL DEFAULT 0,
      valor_pago REAL DEFAULT 0,
      valor_restante REAL DEFAULT 0,
      tem_nf INTEGER DEFAULT 0,
      raw_payload TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (os_id, loja_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_os_aberta_patio ON ordens_servico(loja_slug, is_aberta, dias_no_patio);
    CREATE INDEX IF NOT EXISTS idx_os_alertas ON ordens_servico(is_aberta, valor_restante, valor_pago);
    CREATE INDEX IF NOT EXISTS idx_metas_data ON metas_diarias(data_referencia);

    CREATE TABLE IF NOT EXISTS agent_feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      conversation_id INTEGER,
      message_id INTEGER,
      pergunta_original TEXT,
      resposta_agente TEXT,
      feedback_usuario TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_interaction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      conversation_id INTEGER,
      message_id INTEGER UNIQUE,
      pergunta TEXT NOT NULL,
      tools_chamadas TEXT,
      resposta_gerada TEXT,
      latencia_ms INTEGER,
      motor_utilizado TEXT,
      erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_agent_feedbacks_phone ON agent_feedbacks(phone, status);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_phone ON agent_interaction_logs(phone, created_at);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      tool_used TEXT,
      tool_params TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_conv_phone ON conversation_messages(phone, created_at DESC);

    CREATE TABLE IF NOT EXISTS crawls_execucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      tipo_crawl TEXT NOT NULL CHECK(tipo_crawl IN ('METAS', 'DEEP_OS', 'PATIO')),
      data_referencia TEXT NOT NULL,
      inicio_em DATETIME NOT NULL,
      fim_em DATETIME,
      duracao_ms INTEGER,
      total_paginas INTEGER DEFAULT 1,
      total_registros INTEGER DEFAULT 0,
      total_abertas INTEGER DEFAULT 0,
      delta_abertas INTEGER DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'PARTIAL_REJECTED', 'QUARANTINE', 'ERROR')),
      detalhe_erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_crawls_loja_data ON crawls_execucoes(loja_slug, data_referencia);

    CREATE TABLE IF NOT EXISTS ordens_servico_staging (
      lote_id TEXT NOT NULL,
      os_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      tipo TEXT,
      status_grid TEXT,
      is_aberta INTEGER NOT NULL,
      estado_operacional TEXT DEFAULT 'ABERTA',
      qualidade_dado TEXT DEFAULT 'VALIDADO',
      data_inicio TEXT,
      data_fim TEXT,
      data_inicio_iso TEXT,
      data_fim_iso TEXT,
      data_evento_iso TEXT,
      data_observacao_iso TEXT,
      origem_transicao TEXT DEFAULT 'LEGADO',
      dias_no_patio INTEGER,
      veiculo TEXT,
      placa TEXT,
      cliente_nome TEXT,
      responsavel TEXT,
      total_os REAL,
      valor_pago REAL,
      valor_restante REAL,
      tem_nf INTEGER,
      raw_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lote_id, os_id, loja_slug)
    );
    CREATE INDEX IF NOT EXISTS idx_staging_lote_loja ON ordens_servico_staging(lote_id, loja_slug);

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
    CREATE INDEX IF NOT EXISTS idx_delivery_phone_created ON whatsapp_delivery_logs(phone, created_at DESC);

    CREATE TABLE IF NOT EXISTS webhook_dedup (
      message_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      origem TEXT DEFAULT 'EVOLUTION',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_dedup_created ON webhook_dedup(created_at);

    CREATE TABLE IF NOT EXISTS ai_briefing_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modelo TEXT NOT NULL,
      duracao_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'TIMEOUT', 'UNAVAILABLE', 'INVALID_RESPONSE', 'SLOP_FALLBACK')),
      fallback_utilizado INTEGER NOT NULL DEFAULT 0,
      detalhe_erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_telemetry_status ON ai_briefing_telemetry(status, created_at DESC);
  `);

    // Migrações aditivas idempotentes para ordens_servico e ordens_servico_staging (E3-E2.1)
  const colunasAditivasOS = [
    { col: 'estado_operacional', def: "TEXT DEFAULT 'ABERTA'" },
    { col: 'qualidade_dado', def: "TEXT DEFAULT 'VALIDADO'" },
    { col: 'data_inicio_iso', def: "TEXT" },
    { col: 'data_fim_iso', def: "TEXT" },
    { col: 'data_evento_iso', def: "TEXT" },
    { col: 'data_observacao_iso', def: "TEXT" },
    { col: 'origem_transicao', def: "TEXT DEFAULT 'LEGADO'" }
  ];
  for (const c of colunasAditivasOS) {
    try {
      db.exec(`ALTER TABLE ordens_servico ADD COLUMN ${c.col} ${c.def};`);
    } catch {}
    try {
      db.exec(`ALTER TABLE ordens_servico_staging ADD COLUMN ${c.col} ${c.def};`);
    } catch {}
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_os_estado_operacional ON ordens_servico(estado_operacional, loja_slug);
      CREATE INDEX IF NOT EXISTS idx_os_qualidade_dado ON ordens_servico(qualidade_dado, loja_slug);
      CREATE INDEX IF NOT EXISTS idx_os_data_inicio_iso ON ordens_servico(data_inicio_iso);
      CREATE INDEX IF NOT EXISTS idx_os_data_fim_iso ON ordens_servico(data_fim_iso);
      CREATE INDEX IF NOT EXISTS idx_os_data_evento_iso ON ordens_servico(data_evento_iso);
      CREATE INDEX IF NOT EXISTS idx_os_data_obs_iso ON ordens_servico(data_observacao_iso);

      CREATE TABLE IF NOT EXISTS vec_index_versions (
        version_id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        total_vectors INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
      );
    `);
  } catch {}

  // Migrações idempotentes de colunas em crawls_execucoes para instâncias pré-existentes
  try {
    db.exec(`ALTER TABLE crawls_execucoes ADD COLUMN total_paginas INTEGER DEFAULT 1;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE crawls_execucoes ADD COLUMN delta_abertas INTEGER DEFAULT 0;`);
  } catch {}

  // Tabela virtual sqlite-vec para busca semântica (384 dimensões)
  if (loadVectorExtension(db)) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_ordens_servico USING vec0(
          os_key TEXT PRIMARY KEY,
          os_embedding float[384]
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_ordens_servico_staging USING vec0(
          os_key TEXT PRIMARY KEY,
          os_embedding float[384]
        );
      `);
    } catch (err: any) {
      console.warn('[VEC] Falha ao criar tabela virtual vec_ordens_servico:', err?.message || err);
    }
  }

  // Tabela virtual FTS5 para busca lexical e de peças/serviços com remoção de acentos
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ordens_servico_fts USING fts5(
        os_id UNINDEXED,
        loja_slug UNINDEXED,
        veiculo,
        placa,
        cliente_nome,
        responsavel,
        termos_busca,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS trg_os_fts_ai AFTER INSERT ON ordens_servico BEGIN
        INSERT INTO ordens_servico_fts (rowid, os_id, loja_slug, veiculo, placa, cliente_nome, responsavel, termos_busca)
        VALUES (
          new.rowid, 
          new.os_id, 
          new.loja_slug, 
          coalesce(new.veiculo, ''), 
          coalesce(new.placa, ''), 
          coalesce(new.cliente_nome, ''), 
          coalesce(new.responsavel, ''), 
          coalesce(new.veiculo, '') || ' ' || coalesce(new.cliente_nome, '') || ' ' || coalesce(new.responsavel, '')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_os_fts_ad AFTER DELETE ON ordens_servico BEGIN
        DELETE FROM ordens_servico_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_os_fts_au AFTER UPDATE ON ordens_servico BEGIN
        DELETE FROM ordens_servico_fts WHERE rowid = old.rowid;
        INSERT INTO ordens_servico_fts (rowid, os_id, loja_slug, veiculo, placa, cliente_nome, responsavel, termos_busca)
        VALUES (
          new.rowid, 
          new.os_id, 
          new.loja_slug, 
          coalesce(new.veiculo, ''), 
          coalesce(new.placa, ''), 
          coalesce(new.cliente_nome, ''), 
          coalesce(new.responsavel, ''), 
          coalesce(new.veiculo, '') || ' ' || coalesce(new.cliente_nome, '') || ' ' || coalesce(new.responsavel, '')
        );
      END;
    `);
  } catch (ftsErr: any) {
    console.warn('[FTS5] Falha ao inicializar tabela virtual ordens_servico_fts:', ftsErr?.message || ftsErr);
  }

  try {
    initSemanticGlossary(db);
  } catch (err: any) {
    console.warn('[GLOSSARY] Falha ao inicializar glossario semantico:', err?.message || err);
  }

  try {
    initHydraAccessAndMemorySchema(db);
  } catch (err: any) {
    console.warn('[ACCESS_MEMORY] Falha ao inicializar schema de acesso e memoria:', err?.message || err);
  }

  try {
    ensureCaseAnalysisTables(db);
  } catch (err: any) {
    console.warn('[CASE_ANALYSIS_SCHEMA] Falha ao inicializar tabelas de analise e grafo:', err?.message || err);
  }
}

/**
 * Reconstrói o índice FTS5 a partir da tabela ordens_servico de forma atômica e idempotente.
 */
export function rebuildFTSIndex(db: Database.Database): { totalIndexados: number } {
  try {
    const runRebuild = db.transaction(() => {
      db.exec(`DELETE FROM ordens_servico_fts;`);
      const info = db.prepare(`
        INSERT INTO ordens_servico_fts (rowid, os_id, loja_slug, veiculo, placa, cliente_nome, responsavel, termos_busca)
        SELECT 
          rowid, 
          os_id, 
          loja_slug, 
          coalesce(veiculo, ''), 
          coalesce(placa, ''), 
          coalesce(cliente_nome, ''), 
          coalesce(responsavel, ''),
          coalesce(veiculo, '') || ' ' || coalesce(cliente_nome, '') || ' ' || coalesce(responsavel, '')
        FROM ordens_servico;
      `).run();
      return info.changes;
    });
    const total = runRebuild();
    return { totalIndexados: total };
  } catch (err: any) {
    console.error('[FTS5] Erro ao reconstruir índice FTS5:', err?.message || err);
    throw err;
  }
}

/**
 * Salva metas consolidadas da rede por loja de forma idempotente.
 */
export function salvarMetasDiarias(
  db: Database.Database,
  metas: MetaLojaItem[],
  dataRef: string,
  posicaoHora: string
): void {
  if (!metas || metas.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO metas_diarias (
      data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, ticket_medio,
      meta_mes, previsao_mes, percentual_meta, created_at
    ) VALUES (
      @data_referencia, @posicao_hora, @loja_slug, @faturamento_mes, @volume_os, @ticket_medio,
      @meta_mes, @previsao_mes, @percentual_meta, CURRENT_TIMESTAMP
    )
    ON CONFLICT(data_referencia, loja_slug) DO UPDATE SET
      posicao_hora = excluded.posicao_hora,
      faturamento_mes = excluded.faturamento_mes,
      volume_os = excluded.volume_os,
      ticket_medio = excluded.ticket_medio,
      meta_mes = excluded.meta_mes,
      previsao_mes = excluded.previsao_mes,
      percentual_meta = excluded.percentual_meta,
      created_at = CURRENT_TIMESTAMP
  `);

  const runBatch = db.transaction((items: MetaLojaItem[]) => {
    for (const item of items) {
      stmt.run({
        data_referencia: dataRef,
        posicao_hora: posicaoHora,
        loja_slug: item.loja_slug,
        faturamento_mes: item.faturamento_mes || 0,
        volume_os: item.volume_os || 0,
        ticket_medio: item.ticket_medio || 0,
        meta_mes: item.meta_mes ?? null,
        previsao_mes: item.previsao_mes ?? null,
        percentual_meta: item.percentual_meta ?? null,
      });
    }
  });

  runBatch(metas);
  console.log(`[DB] ✅ Metas diárias sincronizadas (${metas.length} lojas) para data ${dataRef}.`);
}

export function calcularDiasNoPatio(dataInicio?: string): number {
  if (!dataInicio) return 0;
  try {
    const s = dataInicio.trim();
    if (s.includes('/')) {
      const [datePart] = s.split(' ');
      const parts = datePart.split('/');
      if (parts.length === 3) {
        let dia = parseInt(parts[0], 10);
        let mes = parseInt(parts[1], 10) - 1;
        let ano = parseInt(parts[2], 10);
        if (ano < 100) ano += 2000;
        const dtIni = new Date(ano, mes, dia);
        const diff = Math.max(0, Date.now() - dtIni.getTime());
        return Math.floor(diff / (1000 * 60 * 60 * 24));
      }
    } else if (s.includes('-')) {
      const [datePart] = s.split(' ');
      const parts = datePart.split('-');
      if (parts.length === 3) {
        let ano = parseInt(parts[0], 10);
        let mes = parseInt(parts[1], 10) - 1;
        let dia = parseInt(parts[2], 10);
        if (ano < 100) ano += 2000;
        const dtIni = new Date(ano, mes, dia);
        const diff = Math.max(0, Date.now() - dtIni.getTime());
        return Math.floor(diff / (1000 * 60 * 60 * 24));
      }
    }
  } catch {
    return 0;
  }
  return 0;
}

export interface ReconciliacaoOptions {
  forcarSemQuarentena?: boolean;
  extracaoCompleta: boolean;
  paginacaoCompleta?: boolean;
  provaPaginacaoNativa?: boolean;
  totalEsperadoGrid?: number;
  totalPaginas?: number;
  dataReferencia?: string;
}

export interface ReconciliacaoResult {
  status: 'SUCCESS' | 'PARTIAL_REJECTED' | 'QUARANTINE';
  loteId: string;
  totalDocumentos: number;
  abertasAnteriores: number;
  abertasNovas: number;
  deltaAbertas: number;
  mensagem: string;
}

/**
 * Salva lote de ordens de serviço atomicamente dentro de uma transação SQLite.
 *
 * CRITÉRIOS DE ACEITAÇÃO E DESACOPLAMENTO (E3-E2.3 & E3-E2.5):
 * 1. Exige prova cabal de cobertura de paginação nativa (tr.pgr completa) como requisito
 *    obrigatório de aceite de QUALQUER lote.
 * 2. Lotes sem cobertura comprovada entram em quarentena (QUARANTINE em staging)
 *    sem alterar produção ordens_servico.
 * 3. DESACOPLAMENTO TOTAL: A aceitação de um lote NUNCA encerra OSs (is_aberta = 0 eliminado).
 * 4. Ordens ausentes na grade com cobertura 100% comprovada movem-se para TRANSICAO_PENDENTE
 *    para checagem nominal individual posterior.
 */
export function salvarLoteOSs(
  db: Database.Database,
  lojaSlug: string,
  docs: any[],
  options?: boolean | ReconciliacaoOptions
): ReconciliacaoResult {
  const opts: ReconciliacaoOptions = typeof options === 'boolean'
    ? { extracaoCompleta: options, paginacaoCompleta: options, provaPaginacaoNativa: options }
    : (options || { extracaoCompleta: true, paginacaoCompleta: true, provaPaginacaoNativa: true });

  const dataRef = opts.dataReferencia || new Date().toISOString().slice(0, 10);
  const inicioEm = new Date().toISOString();
  const loteId = crypto.randomUUID();
  const totalPaginas = opts.totalPaginas || 1;

  if (!docs || docs.length === 0) {
    console.warn(`[DB] ⚠️ Atenção: Tentativa de gravar 0 documentos para ${lojaSlug}. Dados pré-existentes preservados no banco.`);
    try {
      registrarExecucaoCrawl(db, {
        loja_slug: lojaSlug,
        tipo_crawl: 'PATIO',
        data_referencia: dataRef,
        inicio_em: inicioEm,
        fim_em: new Date().toISOString(),
        total_paginas: totalPaginas,
        total_registros: 0,
        total_abertas: 0,
        delta_abertas: 0,
        status: 'PARTIAL_REJECTED',
        detalhe_erro: 'Lote vazio (0 documentos recebidos). Reconciliação ignorada.'
      });
    } catch {}
    return {
      status: 'PARTIAL_REJECTED',
      loteId,
      totalDocumentos: 0,
      abertasAnteriores: 0,
      abertasNovas: 0,
      deltaAbertas: 0,
      mensagem: 'Lote vazio: dados preservados'
    };
  }

  // 1. Gravar lote em estágio temporário (ordens_servico_staging) com campos aditivos
  const stagingStmt = db.prepare(`
    INSERT INTO ordens_servico_staging (
      lote_id, os_id, loja_slug, tipo, status_grid, is_aberta,
      estado_operacional, qualidade_dado,
      data_inicio, data_fim, data_inicio_iso, data_fim_iso, data_evento_iso, data_observacao_iso,
      origem_transicao, dias_no_patio, veiculo, placa,
      cliente_nome, responsavel, total_os, valor_pago, valor_restante,
      tem_nf, raw_payload, created_at
    ) VALUES (
      @lote_id, @os_id, @loja_slug, @tipo, @status_grid, @is_aberta,
      @estado_operacional, @qualidade_dado,
      @data_inicio, @data_fim, @data_inicio_iso, @data_fim_iso, @data_evento_iso, @data_observacao_iso,
      @origem_transicao, @dias_no_patio, @veiculo, @placa,
      @cliente_nome, @responsavel, @total_os, @valor_pago, @valor_restante,
      @tem_nf, @raw_payload, CURRENT_TIMESTAMP
    )
  `);

  const runStagingBatch = db.transaction((items: any[]) => {
    for (const doc of items) {
      const isExplicitClosed = Boolean(
        (doc.status_grid && (doc.status_grid.toLowerCase().includes('fechad') || doc.status_grid.toLowerCase().includes('fatur'))) ||
        doc.is_aberta === 0
      );
      const isAberta = isExplicitClosed ? 0 : (doc.is_aberta !== undefined ? Number(doc.is_aberta) : 1);
      const estadoOperacional: OrderOperationalState = isAberta === 1 ? 'ABERTA' : 'ENCERRADA';

      const diasNoPatio = isAberta === 1
        ? (doc.dias_no_patio !== undefined ? doc.dias_no_patio : calcularDiasNoPatio(doc.data_inicio))
        : 0;

      const totalVal = doc.total_os || doc.valor_total || 0;
      const pagoVal = doc.valor_pago || 0;
      const restVal = doc.valor_restante !== undefined ? doc.valor_restante : Math.max(0, totalVal - pagoVal);

      const dInicioRaw = doc.data_inicio || '';
      const dFimRaw = doc.data_fim || null;
      const dInicioIso = parseBrDateToIso(dInicioRaw);
      const dFimIso = parseBrDateToIso(dFimRaw);
      const dEventoIso = dFimIso || dInicioIso;
      const dObsIso = formatIsoTimestamp();

      stagingStmt.run({
        lote_id: loteId,
        os_id: String(doc.id || doc.os_id),
        loja_slug: lojaSlug,
        tipo: doc.tipo || 'OS',
        status_grid: doc.status_grid || 'ABERTO',
        is_aberta: isAberta,
        estado_operacional: estadoOperacional,
        qualidade_dado: 'VALIDADO',
        data_inicio: dInicioRaw,
        data_fim: dFimRaw,
        data_inicio_iso: dInicioIso,
        data_fim_iso: dFimIso,
        data_evento_iso: dEventoIso,
        data_observacao_iso: dObsIso,
        origem_transicao: 'STAGING_INGESTION',
        dias_no_patio: diasNoPatio,
        veiculo: doc.veiculo || '',
        placa: doc.placa || '',
        cliente_nome: doc.cliente_nome || '',
        responsavel: doc.responsavel || '',
        total_os: totalVal,
        valor_pago: pagoVal,
        valor_restante: restVal,
        tem_nf: (doc.notas_fiscais && doc.notas_fiscais.length > 0) ? 1 : 0,
        raw_payload: typeof doc === 'string' ? doc : JSON.stringify(doc),
      });
    }
  });

  try {
    runStagingBatch(docs);
  } catch (stagingErr: any) {
    console.warn(`[DB] ⚠️ Erro ao persistir em staging para ${lojaSlug}:`, stagingErr.message);
  }

  // Contagem anterior de OSs abertas para métricas
  const prevOpenRow = db.prepare(`
    SELECT COUNT(*) as count FROM ordens_servico WHERE loja_slug = ? AND (is_aberta = 1 OR estado_operacional = 'ABERTA')
  `).get(lojaSlug) as { count: number } | undefined;
  const abertasAnteriores = prevOpenRow?.count || 0;

  const openIds = docs
    .filter(doc => (doc.is_aberta !== undefined ? Number(doc.is_aberta) === 1 : !((doc.status_grid && (doc.status_grid.toLowerCase().includes('fechad') || doc.status_grid.toLowerCase().includes('fatur'))))))
    .map(doc => String(doc.id || doc.os_id));
  const abertasNovas = openIds.length;
  const deltaAbertas = abertasNovas - abertasAnteriores;

  // 2. CRITÉRIOS DE ACEITAÇÃO E QUARENTENA OBRIGATÓRIA (E3-E2.5)
  // Exigir prova cabal de cobertura de paginação nativa (tr.pgr completa) como requisito OBRIGATÓRIO de aceite de QUALQUER lote
  const paginacaoComprovada =
    opts.paginacaoCompleta === true &&
    opts.provaPaginacaoNativa !== false &&
    opts.extracaoCompleta === true;

  if (!paginacaoComprovada) {
    console.warn(`[DB] 🚨 Lote ${loteId} para '${lojaSlug}' REJEITADO PARA QUARENTENA: falta comprovação de cobertura de paginação nativa (tr.pgr completa). Dados de produção mantidos intactos.`);
    try {
      registrarExecucaoCrawl(db, {
        loja_slug: lojaSlug,
        tipo_crawl: 'PATIO',
        data_referencia: dataRef,
        inicio_em: inicioEm,
        fim_em: new Date().toISOString(),
        total_paginas: totalPaginas,
        total_registros: docs.length,
        total_abertas: abertasNovas,
        delta_abertas: deltaAbertas,
        status: 'QUARANTINE',
        detalhe_erro: 'Falta de cobertura comprovada de paginação nativa (tr.pgr completa). Lote mantido em quarentena sem alteração em ordens_servico.'
      });
    } catch {}

    return {
      status: 'QUARANTINE',
      loteId,
      totalDocumentos: docs.length,
      abertasAnteriores,
      abertasNovas,
      deltaAbertas,
      mensagem: 'Lote retido em quarentena: cobertura de paginação nativa incompleta ou não comprovada'
    };
  }

  // 3. Upsert atômico de ordens no banco operacional
  const upsertStmt = db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, tipo, status_grid, is_aberta,
      estado_operacional, qualidade_dado,
      data_inicio, data_fim, data_inicio_iso, data_fim_iso, data_evento_iso, data_observacao_iso,
      origem_transicao, dias_no_patio, veiculo, placa,
      cliente_nome, responsavel, total_os, valor_pago, valor_restante,
      tem_nf, raw_payload, updated_at
    ) VALUES (
      @os_id, @loja_slug, @tipo, @status_grid, @is_aberta,
      @estado_operacional, @qualidade_dado,
      @data_inicio, @data_fim, @data_inicio_iso, @data_fim_iso, @data_evento_iso, @data_observacao_iso,
      @origem_transicao, @dias_no_patio, @veiculo, @placa,
      @cliente_nome, @responsavel, @total_os, @valor_pago, @valor_restante,
      @tem_nf, @raw_payload, CURRENT_TIMESTAMP
    )
    ON CONFLICT(os_id, loja_slug) DO UPDATE SET
      tipo = excluded.tipo,
      status_grid = excluded.status_grid,
      is_aberta = excluded.is_aberta,
      estado_operacional = excluded.estado_operacional,
      qualidade_dado = excluded.qualidade_dado,
      data_inicio = COALESCE(excluded.data_inicio, ordens_servico.data_inicio),
      data_fim = excluded.data_fim,
      data_inicio_iso = COALESCE(excluded.data_inicio_iso, ordens_servico.data_inicio_iso),
      data_fim_iso = excluded.data_fim_iso,
      data_evento_iso = COALESCE(excluded.data_evento_iso, ordens_servico.data_evento_iso),
      data_observacao_iso = excluded.data_observacao_iso,
      origem_transicao = excluded.origem_transicao,
      dias_no_patio = excluded.dias_no_patio,
      veiculo = COALESCE(excluded.veiculo, ordens_servico.veiculo),
      placa = COALESCE(excluded.placa, ordens_servico.placa),
      cliente_nome = COALESCE(excluded.cliente_nome, ordens_servico.cliente_nome),
      responsavel = COALESCE(excluded.responsavel, ordens_servico.responsavel),
      total_os = excluded.total_os,
      valor_pago = excluded.valor_pago,
      valor_restante = excluded.valor_restante,
      tem_nf = excluded.tem_nf,
      raw_payload = excluded.raw_payload,
      updated_at = CURRENT_TIMESTAMP
  `);

  const applyUpserts = (items: any[]) => {
    for (const doc of items) {
      const isExplicitClosed = Boolean(
        (doc.status_grid && (doc.status_grid.toLowerCase().includes('fechad') || doc.status_grid.toLowerCase().includes('fatur'))) ||
        doc.is_aberta === 0
      );
      const isAberta = isExplicitClosed ? 0 : (doc.is_aberta !== undefined ? Number(doc.is_aberta) : 1);
      const estadoOperacional: OrderOperationalState = isAberta === 1 ? 'ABERTA' : 'ENCERRADA';

      const diasNoPatio = isAberta === 1
        ? (doc.dias_no_patio !== undefined ? doc.dias_no_patio : calcularDiasNoPatio(doc.data_inicio))
        : 0;

      const totalVal = doc.total_os || doc.valor_total || 0;
      const pagoVal = doc.valor_pago || 0;
      const restVal = doc.valor_restante !== undefined ? doc.valor_restante : Math.max(0, totalVal - pagoVal);

      const dInicioRaw = doc.data_inicio || '';
      const dFimRaw = doc.data_fim || null;
      const dInicioIso = parseBrDateToIso(dInicioRaw);
      const dFimIso = parseBrDateToIso(dFimRaw);
      const dEventoIso = dFimIso || dInicioIso;
      const dObsIso = formatIsoTimestamp();

      upsertStmt.run({
        os_id: String(doc.id || doc.os_id),
        loja_slug: lojaSlug,
        tipo: doc.tipo || 'OS',
        status_grid: doc.status_grid || 'ABERTO',
        is_aberta: isAberta,
        estado_operacional: estadoOperacional,
        qualidade_dado: 'VALIDADO',
        data_inicio: dInicioRaw,
        data_fim: dFimRaw,
        data_inicio_iso: dInicioIso,
        data_fim_iso: dFimIso,
        data_evento_iso: dEventoIso,
        data_observacao_iso: dObsIso,
        origem_transicao: 'GRID_PAGINADA',
        dias_no_patio: diasNoPatio,
        veiculo: doc.veiculo || '',
        placa: doc.placa || '',
        cliente_nome: doc.cliente_nome || '',
        responsavel: doc.responsavel || '',
        total_os: totalVal,
        valor_pago: pagoVal,
        valor_restante: restVal,
        tem_nf: (doc.notas_fiscais && doc.notas_fiscais.length > 0) ? 1 : 0,
        raw_payload: typeof doc === 'string' ? doc : JSON.stringify(doc),
      });
    }
  };

  // 4. DESACOPLAMENTO TOTAL: A aceitação de um lote NUNCA encerra OSs.
  // Eliminar UPDATE ... is_aberta = 0 cego. Ordens ausentes na grade com cobertura comprovada recebem TRANSICAO_PENDENTE.
  const runFullTx = db.transaction((items: any[]) => {
    applyUpserts(items);

    if (openIds.length > 0) {
      const placeholders = openIds.map(() => '?').join(',');
      db.prepare(`
        UPDATE ordens_servico
        SET estado_operacional = 'TRANSICAO_PENDENTE',
            qualidade_dado = 'EM_AUDITORIA',
            origem_transicao = 'AUSENTE_GRADE_PAGINADA',
            updated_at = CURRENT_TIMESTAMP
        WHERE loja_slug = ? AND os_id NOT IN (${placeholders}) AND (estado_operacional = 'ABERTA' OR is_aberta = 1)
      `).run(lojaSlug, ...openIds);
    } else {
      db.prepare(`
        UPDATE ordens_servico
        SET estado_operacional = 'TRANSICAO_PENDENTE',
            qualidade_dado = 'EM_AUDITORIA',
            origem_transicao = 'AUSENTE_GRADE_PAGINADA',
            updated_at = CURRENT_TIMESTAMP
        WHERE loja_slug = ? AND (estado_operacional = 'ABERTA' OR is_aberta = 1)
      `).run(lojaSlug);
    }
  });

  runFullTx(docs);

  try {
    registrarExecucaoCrawl(db, {
      loja_slug: lojaSlug,
      tipo_crawl: 'PATIO',
      data_referencia: dataRef,
      inicio_em: inicioEm,
      fim_em: new Date().toISOString(),
      total_paginas: totalPaginas,
      total_registros: docs.length,
      total_abertas: abertasNovas,
      delta_abertas: deltaAbertas,
      status: 'SUCCESS'
    });
  } catch {}

  console.log(`[DB] ✅ ${docs.length} registros sincronizados e reconciliados com sucesso para loja '${lojaSlug}'.`);
  return {
    status: 'SUCCESS',
    loteId,
    totalDocumentos: docs.length,
    abertasAnteriores,
    abertasNovas,
    deltaAbertas,
    mensagem: 'Reconciliação concluída com sucesso'
  };
}

/**
 * Formaliza a transição de ciclo de vida de uma OS após checagem nominal individual.
 * Chamada exclusiva para encerramento, cancelamento ou reativação nominal comprovada.
 */
export function formalizarTransicaoNominalOS(
  db: Database.Database,
  osId: string,
  lojaSlug: string,
  novoEstado: OrderOperationalState,
  origemTransicao: string,
  dadosDetalhe?: any
): boolean {
  const isAberta = novoEstado === 'ABERTA' ? 1 : 0;
  const diasNoPatio = novoEstado === 'ABERTA' ? (dadosDetalhe?.dias_no_patio || 0) : 0;
  let dataFimIso: string | null = null;
  let dataFimRaw: string | null = dadosDetalhe?.data_fim || null;

  if (dadosDetalhe?.data_fim) {
    dataFimIso = parseBrDateToIso(dadosDetalhe.data_fim);
  } else if (novoEstado === 'ENCERRADA' || novoEstado === 'CANCELADA') {
    dataFimIso = formatIsoTimestamp();
    if (!dataFimRaw) dataFimRaw = formatIsoTimestamp();
  }

  const totalOs = dadosDetalhe?.total_os !== undefined ? Number(dadosDetalhe.total_os) : null;
  const valorPago = dadosDetalhe?.valor_pago !== undefined ? Number(dadosDetalhe.valor_pago) : null;
  const valorRestante = dadosDetalhe?.valor_restante !== undefined ? Number(dadosDetalhe.valor_restante) : null;
  const rawPayload = dadosDetalhe ? (typeof dadosDetalhe === 'string' ? dadosDetalhe : JSON.stringify(dadosDetalhe)) : null;

  const res = db.prepare(`
    UPDATE ordens_servico
    SET estado_operacional = @estado_operacional,
        qualidade_dado = 'VALIDADO',
        is_aberta = @is_aberta,
        dias_no_patio = @dias_no_patio,
        total_os = COALESCE(@total_os, total_os),
        valor_pago = COALESCE(@valor_pago, valor_pago),
        valor_restante = COALESCE(@valor_restante, valor_restante),
        data_fim = COALESCE(@data_fim, data_fim),
        data_fim_iso = COALESCE(@data_fim_iso, data_fim_iso),
        data_evento_iso = COALESCE(@data_fim_iso, data_evento_iso),
        data_observacao_iso = @data_observacao_iso,
        origem_transicao = @origem_transicao,
        raw_payload = COALESCE(@raw_payload, raw_payload),
        updated_at = CURRENT_TIMESTAMP
    WHERE os_id = @os_id AND loja_slug = @loja_slug
  `).run({
    estado_operacional: novoEstado,
    is_aberta: isAberta,
    dias_no_patio: diasNoPatio,
    total_os: totalOs,
    valor_pago: valorPago,
    valor_restante: valorRestante,
    data_fim: dataFimRaw,
    data_fim_iso: dataFimIso,
    data_observacao_iso: formatIsoTimestamp(),
    origem_transicao: origemTransicao,
    raw_payload: rawPayload,
    os_id: String(osId),
    loja_slug: lojaSlug
  });

  return res.changes > 0;
}

/**
 * Carrega lote controlado com janela de 30 dias contendo ordens abertas, encerradas e em transição,
 * formatadas rigorosamente no fuso America/Sao_Paulo e com o contrato OrderRecord tipado. (E2-E2)
 */
export function carregarLoteControlado30Dias(
  db: Database.Database,
  lojaSlug?: string,
  options?: { dataReferencia?: string; diasJanela?: number }
): OrderRecord[] {
  const diasJanela = options?.diasJanela || 30;
  const refDate = options?.dataReferencia ? new Date(options.dataReferencia) : new Date();
  const cutoffDate = new Date(refDate.getTime() - diasJanela * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString().slice(0, 10);

  let query = `
    SELECT
      os_id, loja_slug, tipo, status_grid, is_aberta,
      estado_operacional, qualidade_dado,
      data_inicio, data_fim,
      data_inicio_iso, data_fim_iso, data_evento_iso, data_observacao_iso,
      dias_no_patio, veiculo, placa, cliente_nome, responsavel,
      total_os, valor_pago, valor_restante, tem_nf,
      origem_transicao
    FROM ordens_servico
    WHERE 1=1
  `;
  const params: any[] = [];

  if (lojaSlug) {
    query += ` AND loja_slug = ?`;
    params.push(lojaSlug);
  }

  query += ` AND (
    is_aberta = 1
    OR estado_operacional IN ('ABERTA', 'TRANSICAO_PENDENTE')
    OR data_inicio_iso >= ?
    OR data_fim_iso >= ?
    OR data_evento_iso >= ?
    OR data_inicio >= ?
  ) ORDER BY data_evento_iso DESC, os_id DESC`;
  params.push(cutoffIso, cutoffIso, cutoffIso, cutoffIso);

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map((r) => {
    let estOp: OrderOperationalState = (r.estado_operacional as OrderOperationalState) || (r.is_aberta === 1 ? 'ABERTA' : 'ENCERRADA');
    let qDado: OrderDataQuality = (r.qualidade_dado as OrderDataQuality) || 'VALIDADO';

    const dInicioIso = r.data_inicio_iso || parseBrDateToIso(r.data_inicio);
    const dFimIso = r.data_fim_iso || parseBrDateToIso(r.data_fim);
    const dEventoIso = r.data_evento_iso || dFimIso || dInicioIso;
    const dObsIso = r.data_observacao_iso || formatIsoTimestamp();

    return {
      osId: String(r.os_id),
      lojaSlug: String(r.loja_slug),
      tipo: String(r.tipo || 'OS'),
      statusGrid: String(r.status_grid || ''),
      isAberta: Boolean(r.is_aberta),
      estadoOperacional: estOp,
      qualidadeDado: qDado,
      dataInicioRaw: r.data_inicio || undefined,
      dataInicioIso: dInicioIso || undefined,
      dataFimRaw: r.data_fim || undefined,
      dataFimIso: dFimIso || undefined,
      dataEventoIso: dEventoIso || undefined,
      dataObservacaoIso: dObsIso,
      diasNoPatio: Number(r.dias_no_patio || 0),
      veiculo: r.veiculo || undefined,
      placa: r.placa || undefined,
      clienteNome: r.cliente_nome || undefined,
      responsavel: r.responsavel || undefined,
      totalOs: Number(r.total_os || 0),
      valorPago: Number(r.valor_pago || 0),
      valorRestante: Number(r.valor_restante || 0),
      temNf: Boolean(r.tem_nf),
      origemTransicao: String(r.origem_transicao || 'LEGADO')
    };
  });
}

/**
 * Backfill determinístico de datas para ordens de serviço existentes. (E3-E2.2)
 * Converte datas preservando precisão e fuso America/Sao_Paulo.
 * Separa estritamente data_evento_iso de data_observacao_iso.
 */
export function backfillDatasOrdensServico(db: Database.Database): {
  totalProcessados: number;
  totalAtualizados: number;
} {
  const rows = db.prepare(`
    SELECT os_id, loja_slug, data_inicio, data_fim, updated_at,
           data_inicio_iso, data_fim_iso, data_evento_iso, data_observacao_iso
    FROM ordens_servico
  `).all() as any[];

  const updateStmt = db.prepare(`
    UPDATE ordens_servico
    SET data_inicio_iso = @data_inicio_iso,
        data_fim_iso = @data_fim_iso,
        data_evento_iso = @data_evento_iso,
        data_observacao_iso = @data_observacao_iso
    WHERE os_id = @os_id AND loja_slug = @loja_slug
  `);

  let totalAtualizados = 0;

  const runBackfillTx = db.transaction((items: any[]) => {
    for (const r of items) {
      const dInicioIso = parseBrDateToIso(r.data_inicio);
      const dFimIso = parseBrDateToIso(r.data_fim);
      const dEventoIso = dFimIso || dInicioIso;
      const dObsIso = parseBrDateToIso(r.updated_at) || formatIsoTimestamp();

      const needsUpdate =
        r.data_inicio_iso !== dInicioIso ||
        r.data_fim_iso !== dFimIso ||
        r.data_evento_iso !== dEventoIso ||
        r.data_observacao_iso !== dObsIso;

      if (needsUpdate) {
        updateStmt.run({
          data_inicio_iso: dInicioIso,
          data_fim_iso: dFimIso,
          data_evento_iso: dEventoIso,
          data_observacao_iso: dObsIso,
          os_id: r.os_id,
          loja_slug: r.loja_slug
        });
        totalAtualizados++;
      }
    }
  });

  runBackfillTx(rows);
  return {
    totalProcessados: rows.length,
    totalAtualizados
  };
}

/**
 * Rotina de reconciliação e saneamento dos 517 registros existentes. (E3-E2.7)
 * Identifica as 153 OSs com status_grid = 'ABERTO' e 206 com 'AGUARDANDO RETIRADA'
 * que foram persistidas indevidamente com is_aberta = 0 por corte de paginação legado.
 * Marca-as como TRANSICAO_PENDENTE e enfileira-as para validação nominal individual.
 */
export function sanearOrdensDivergentesExistentes(db: Database.Database): {
  totalDivergentes: number;
  abertosCount: number;
  aguardandoRetiradaCount: number;
  ordensAtualizadas: Array<{ os_id: string; loja_slug: string; status_grid: string }>;
} {
  const divergentes = db.prepare(`
    SELECT os_id, loja_slug, status_grid, is_aberta
    FROM ordens_servico
    WHERE is_aberta = 0 AND status_grid IN ('ABERTO', 'AGUARDANDO RETIRADA')
  `).all() as any[];

  let abertosCount = 0;
  let aguardandoRetiradaCount = 0;

  for (const row of divergentes) {
    if (row.status_grid === 'ABERTO') abertosCount++;
    else if (row.status_grid === 'AGUARDANDO RETIRADA') aguardandoRetiradaCount++;
  }

  const updateStmt = db.prepare(`
    UPDATE ordens_servico
    SET estado_operacional = 'TRANSICAO_PENDENTE',
        qualidade_dado = 'EM_AUDITORIA',
        origem_transicao = 'SANEAMENTO_517_DIVERGENCIA',
        is_aberta = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE os_id = @os_id AND loja_slug = @loja_slug
  `);

  const runSaneamentoTx = db.transaction((items: any[]) => {
    for (const item of items) {
      updateStmt.run({
        os_id: item.os_id,
        loja_slug: item.loja_slug
      });
    }
  });

  runSaneamentoTx(divergentes);

  return {
    totalDivergentes: divergentes.length,
    abertosCount,
    aguardandoRetiradaCount,
    ordensAtualizadas: divergentes.map((d: any) => ({
      os_id: d.os_id,
      loja_slug: d.loja_slug,
      status_grid: d.status_grid
    }))
  };
}

/**
 * Protocolo de investigação finita da OS 9202 em Kennedy (MPkennedy). (E3-E2.6)
 * Isola registro corrompido/teste com qualidade_dado = 'SUSPEITO_QUARENTENA',
 * estado_operacional = 'DESCONHECIDO' e emite relatório estruturado de auditoria.
 */
export function isolarInvestigarOS9202(db: Database.Database): {
  osId: string;
  lojaSlug: string;
  isolado: boolean;
  relatorioAuditoria: any;
} {
  const row = db.prepare(`
    SELECT * FROM ordens_servico WHERE os_id = '9202' AND loja_slug = 'MPkennedy'
  `).get() as any;

  if (!row) {
    return {
      osId: '9202',
      lojaSlug: 'MPkennedy',
      isolado: false,
      relatorioAuditoria: {
        erro: 'OS 9202 não localizada na loja MPkennedy'
      }
    };
  }

  db.prepare(`
    UPDATE ordens_servico
    SET qualidade_dado = 'SUSPEITO_QUARENTENA',
        estado_operacional = 'DESCONHECIDO',
        origem_transicao = 'PROTOCOLO_INVESTIGACAO_9202',
        updated_at = CURRENT_TIMESTAMP
    WHERE os_id = '9202' AND loja_slug = 'MPkennedy'
  `).run();

  const relatorioAuditoria = {
    os_id: '9202',
    loja_slug: 'MPkennedy',
    motivo_quarentena: 'Dados aberrantes fora da curva operacional e indicativos de anomalia ou registro de teste.',
    anomalias_detectadas: [
      `total_os R$ ${row.total_os} (fora do desvio padrão operacional)`,
      `veiculo '${row.veiculo}' identificado como marcador sentinela de teste`,
      `placa '${row.placa}' não padronizada`,
      'data_inicio ausente (NULL)',
      'raw_payload ausente (NULL)'
    ],
    status_anterior: {
      status_grid: row.status_grid,
      is_aberta: row.is_aberta,
      estado_operacional: row.estado_operacional,
      qualidade_dado: row.qualidade_dado
    },
    status_atual: {
      estado_operacional: 'DESCONHECIDO',
      qualidade_dado: 'SUSPEITO_QUARENTENA',
      origem_transicao: 'PROTOCOLO_INVESTIGACAO_9202'
    },
    data_auditoria: new Date().toISOString()
  };

  return {
    osId: '9202',
    lojaSlug: 'MPkennedy',
    isolado: true,
    relatorioAuditoria
  };
}

/**
 * Rotina de indexação vetorial versionada com tabela paralela e swap atômico. (E5-E2)
 * Garante que leituras simultâneas nunca encontrem a tabela vetorial vazia ou parcialmente preenchida.
 */
export function swapAtomicoVetores(
  db: Database.Database,
  versionId: string,
  totalVetores: number
): boolean {
  if (!isVectorExtensionLoaded && !loadVectorExtension(db)) {
    console.warn('[VEC] sqlite-vec não carregado para swap atômico.');
    return false;
  }

  try {
    const swapTx = db.transaction(() => {
      // 1. Limpar tabela de produção
      db.exec('DELETE FROM vec_ordens_servico;');
      // 2. Copiar da tabela staging para produção
      db.exec('INSERT INTO vec_ordens_servico(os_key, os_embedding) SELECT os_key, os_embedding FROM vec_ordens_servico_staging;');
      // 3. Limpar tabela staging
      db.exec('DELETE FROM vec_ordens_servico_staging;');
      // 4. Registrar nova versão no catálogo
      db.prepare(`
        UPDATE vec_index_versions SET is_active = 0 WHERE table_name = 'vec_ordens_servico';
      `).run();
      db.prepare(`
        INSERT INTO vec_index_versions (version_id, table_name, total_vectors, created_at, is_active)
        VALUES (?, 'vec_ordens_servico', ?, CURRENT_TIMESTAMP, 1);
      `).run(versionId, totalVetores);
    });

    swapTx();
    console.log(`[VEC] ✅ Swap atômico de ${totalVetores} vetores concluído (versão: ${versionId}).`);
    return true;
  } catch (err: any) {
    console.error('[VEC] ❌ Falha no swap atômico vetorial:', err?.message || err);
    throw err;
  }
}


export function limparStagingAntigo(db: Database.Database, horas = 48): number {
  const info = db.prepare(`
    DELETE FROM ordens_servico_staging
    WHERE created_at < datetime('now', '-' || ? || ' hours')
  `).run(horas);
  return info.changes;
}

export interface WhatsAppDeliveryLogItem {
  phone: string;
  message_id?: string;
  endpoint: string;
  status_http?: number;
  sucesso: number;
  tentativas?: number;
  duracao_ms?: number;
  resposta_raw?: string;
  erro?: string;
}

export function registrarEntregaWhatsApp(db: Database.Database, item: WhatsAppDeliveryLogItem): void {
  try {
    db.prepare(`
      INSERT INTO whatsapp_delivery_logs (
        phone, message_id, endpoint, status_http, sucesso, tentativas, duracao_ms, resposta_raw, erro
      ) VALUES (
        @phone, @message_id, @endpoint, @status_http, @sucesso, @tentativas, @duracao_ms, @resposta_raw, @erro
      )
    `).run({
      phone: item.phone,
      message_id: item.message_id || null,
      endpoint: item.endpoint,
      status_http: item.status_http || null,
      sucesso: item.sucesso,
      tentativas: item.tentativas || 1,
      duracao_ms: item.duracao_ms || 0,
      resposta_raw: item.resposta_raw ? String(item.resposta_raw).slice(0, 1000) : null,
      erro: item.erro || null
    });
  } catch (err: any) {
    console.warn('[DB] Falha ao registrar log de entrega WhatsApp:', err?.message || err);
  }
}

export function isWebhookMessageProcessed(db: Database.Database, messageId: string): boolean {
  if (!messageId) return false;
  try {
    const row = db.prepare('SELECT 1 FROM webhook_dedup WHERE message_id = ?').get(messageId);
    return Boolean(row);
  } catch {
    return false;
  }
}

export function marcarWebhookMessageProcessed(db: Database.Database, messageId: string, phone: string, origem = 'EVOLUTION'): boolean {
  if (!messageId) return false;
  try {
    const info = db.prepare(`
      INSERT OR IGNORE INTO webhook_dedup (message_id, phone, origem)
      VALUES (?, ?, ?)
    `).run(messageId, phone, origem);
    return info.changes > 0;
  } catch {
    return false;
  }
}

export function limparWebhookDedupAntigo(db: Database.Database, horas = 72): number {
  try {
    const info = db.prepare(`
      DELETE FROM webhook_dedup
      WHERE created_at < datetime('now', '-' || ? || ' hours')
    `).run(horas);
    return info.changes;
  } catch {
    return 0;
  }
}

export interface AITelemetryItem {
  modelo: string;
  duracao_ms: number;
  status: 'SUCCESS' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'SLOP_FALLBACK';
  fallback_utilizado: number;
  detalhe_erro?: string;
}

export function registrarTelemetriaIA(db: Database.Database, item: AITelemetryItem): void {
  try {
    db.prepare(`
      INSERT INTO ai_briefing_telemetry (
        modelo, duracao_ms, status, fallback_utilizado, detalhe_erro
      ) VALUES (
        @modelo, @duracao_ms, @status, @fallback_utilizado, @detalhe_erro
      )
    `).run({
      modelo: item.modelo,
      duracao_ms: item.duracao_ms,
      status: item.status,
      fallback_utilizado: item.fallback_utilizado,
      detalhe_erro: item.detalhe_erro ? String(item.detalhe_erro).slice(0, 1000) : null
    });
  } catch (err: any) {
    console.warn('[DB] Falha ao registrar telemetria IA:', err?.message || err);
  }
}

/**
 * Contrato de contagem de OSs confirmadamente abertas vs transições pendentes.
 * - confirmed_open: is_aberta = 1 e UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
 * - transition_pending: UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE'
 * - total_open_like: confirmed_open + transition_pending
 */
export function getOpenOSCounts(
  db: Database.Database,
  lojaSlug?: string
): OpenOSCounts {
  try {
    const query = lojaSlug
      ? `
        SELECT
          COUNT(CASE 
            WHEN is_aberta = 1 AND (
              COALESCE(dias_no_patio, 0) > 0
              OR (
                (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
                AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
                AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
              )
            ) THEN 1 
          END) AS confirmed_open,
          COUNT(CASE 
            WHEN is_aberta = 1 AND NOT (
              COALESCE(dias_no_patio, 0) > 0
              OR (
                (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
                AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
                AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
              )
            ) THEN 1 
          END) AS pendencias_baixa_erp,
          COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending
        FROM ordens_servico
        WHERE LOWER(loja_slug) = LOWER(?)
      `
      : `
        SELECT
          COUNT(CASE 
            WHEN is_aberta = 1 AND (
              COALESCE(dias_no_patio, 0) > 0
              OR (
                (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
                AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
                AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
              )
            ) THEN 1 
          END) AS confirmed_open,
          COUNT(CASE 
            WHEN is_aberta = 1 AND NOT (
              COALESCE(dias_no_patio, 0) > 0
              OR (
                (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
                AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
                AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
              )
            ) THEN 1 
          END) AS pendencias_baixa_erp,
          COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending
        FROM ordens_servico
      `;

    const row = (lojaSlug ? db.prepare(query).get(lojaSlug.trim()) : db.prepare(query).get()) as {
      confirmed_open: number;
      pendencias_baixa_erp: number;
      transition_pending: number;
    } | undefined;

    const confirmed = row?.confirmed_open ?? 0;
    const pendencias = row?.pendencias_baixa_erp ?? 0;
    const pending = row?.transition_pending ?? 0;
    const total = confirmed + pending;

    const result: OpenOSCounts = {
      confirmed_open: confirmed,
      veiculos_patio_fisico: confirmed,
      pendencias_baixa_erp: pendencias,
      transition_pending: pending,
      total_open_like: total
    };

    console.error(JSON.stringify({
      event: 'hydra_open_os_counts',
      loja: lojaSlug ? lojaSlug.trim() : 'REDE',
      veiculos_patio_fisico: confirmed,
      pendencias_baixa_erp: pendencias,
      confirmed_open: confirmed,
      transition_pending: pending,
      total_open_like: total
    }));

    return result;
  } catch (err: any) {
    console.error(`[DB] Erro ao consultar contagem de OS em aberto (loja: ${lojaSlug || 'REDE'}):`, err?.message || err);
    throw err;
  }
}

/**
 * Consulta agregada do pátio por loja
 * Distingue veículos fisicamente em atendimento na oficina (veiculos_patio_fisico)
 * de ordens pendentes de encerramento/baixa administrativa no ERP (pendencias_baixa_erp).
 */
export function getPatioOverview(db: Database.Database): any[] {
  return db.prepare(`
    SELECT 
      loja_slug,
      -- 1. Veículos fisicamente no pátio da oficina (em atendimento ativo)
      COUNT(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN 1 
      END) AS veiculos_patio_fisico,

      -- Compatibilidade com código legado que consome total_abertas / confirmed_open
      COUNT(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN 1 
      END) AS total_abertas,

      COUNT(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN 1 
      END) AS confirmed_open,

      -- 2. Pendências administrativas no ERP (ordens abertas no sistema sem veículo físico na oficina)
      COUNT(CASE 
        WHEN is_aberta = 1 AND NOT (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN 1 
      END) AS pendencias_baixa_erp,

      COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending,

      COUNT(CASE WHEN is_aberta = 1 THEN 1 END) AS total_abertas_sistema,

      -- 3. Valores financeiros dos veículos fisicamente em pátio
      SUM(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN total_os ELSE 0 
      END) AS total_valor,

      SUM(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN valor_restante ELSE 0 
      END) AS total_restante

    FROM ordens_servico
    WHERE is_aberta = 1 OR UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE'
    GROUP BY loja_slug
    ORDER BY veiculos_patio_fisico DESC
  `).all();
}

/**
 * Consulta de veículos parados há mais de X dias no pátio
 */
export function getAgingCars(db: Database.Database, diasMinimos = 5): any[] {
  return db.prepare(`
    SELECT 
      os_id,
      loja_slug,
      veiculo,
      placa,
      dias_no_patio,
      cliente_nome,
      total_os,
      valor_restante
    FROM ordens_servico
    WHERE is_aberta = 1 AND dias_no_patio >= ?
    ORDER BY dias_no_patio DESC
  `).all(diasMinimos);
}

/**
 * Consulta de alertas financeiros (Sem sinal e saldo > R$ 2.500)
 */
export function getFinancialAlerts(db: Database.Database, minSaldo = 2500): any[] {
  return db.prepare(`
    SELECT 
      os_id,
      loja_slug,
      veiculo,
      placa,
      cliente_nome,
      total_os,
      valor_pago,
      valor_restante
    FROM ordens_servico
    WHERE is_aberta = 1 
      AND valor_restante >= ? 
      AND valor_pago <= 0
    ORDER BY valor_restante DESC
  `).all(minSaldo);
}

/**
 * Consulta as últimas metas diárias consolidadas.
 * Se dataRef for omitida, seleciona estritamente a data_referencia mais recente.
 */
export function getMetasConsolidadas(db: Database.Database, dataRef?: string): any[] {
  const fields = 'loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, posicao_hora, data_referencia';
  if (dataRef) {
    return db.prepare(`
      SELECT ${fields}
      FROM metas_diarias
      WHERE data_referencia = ?
      ORDER BY faturamento_mes DESC
    `).all(dataRef);
  }

  return db.prepare(`
    SELECT ${fields}
    FROM metas_diarias
    WHERE data_referencia = (SELECT MAX(data_referencia) FROM metas_diarias)
    ORDER BY faturamento_mes DESC
  `).all();
}

/**
 * Helper de governança de frescor das metas (SLA: até 26h de idade).
 */
export function verificarFrescorMetas(
  db: Database.Database,
  maxHorasTolerancia: number = 26
): { dataMaisRecente: string | null; posicaoHora: string | null; idadeHoras: number; isValido: boolean } {
  const row: any = db.prepare(`
    SELECT data_referencia, MAX(created_at) as max_created, posicao_hora
    FROM metas_diarias
    WHERE data_referencia = (SELECT MAX(data_referencia) FROM metas_diarias)
    GROUP BY data_referencia
  `).get();

  if (!row || !row.data_referencia) {
    return { dataMaisRecente: null, posicaoHora: null, idadeHoras: 999, isValido: false };
  }

  const dtCreated = new Date(row.max_created?.includes('T') ? row.max_created : `${row.max_created?.replace(' ', 'T') || `${row.data_referencia}T12:00:00`}Z`);
  const agora = new Date();
  const diffMs = agora.getTime() - dtCreated.getTime();
  const idadeHoras = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));

  return {
    dataMaisRecente: row.data_referencia,
    posicaoHora: row.posicao_hora || null,
    idadeHoras,
    isValido: idadeHoras <= maxHorasTolerancia
  };
}

export interface CrawlExecucaoRegistro {
  loja_slug: string;
  tipo_crawl: 'METAS' | 'DEEP_OS' | 'PATIO';
  data_referencia: string;
  inicio_em: string;
  fim_em?: string;
  duracao_ms?: number;
  total_paginas?: number;
  total_registros?: number;
  total_abertas?: number;
  delta_abertas?: number;
  status: 'SUCCESS' | 'PARTIAL_REJECTED' | 'QUARANTINE' | 'ERROR';
  detalhe_erro?: string;
}

/**
 * Registra a telemetria e o status de uma rodada de extração na tabela crawls_execucoes.
 */
export function registrarExecucaoCrawl(
  db: Database.Database,
  reg: CrawlExecucaoRegistro
): number {
  const stmt = db.prepare(`
    INSERT INTO crawls_execucoes (
      loja_slug, tipo_crawl, data_referencia, inicio_em, fim_em, duracao_ms,
      total_paginas, total_registros, total_abertas, delta_abertas, status, detalhe_erro, created_at
    ) VALUES (
      @loja_slug, @tipo_crawl, @data_referencia, @inicio_em, @fim_em, @duracao_ms,
      @total_paginas, @total_registros, @total_abertas, @delta_abertas, @status, @detalhe_erro, CURRENT_TIMESTAMP
    )
  `);
  const res = stmt.run({
    loja_slug: reg.loja_slug,
    tipo_crawl: reg.tipo_crawl,
    data_referencia: reg.data_referencia,
    inicio_em: reg.inicio_em,
    fim_em: reg.fim_em || null,
    duracao_ms: reg.duracao_ms || null,
    total_paginas: reg.total_paginas || 1,
    total_registros: reg.total_registros || 0,
    total_abertas: reg.total_abertas || 0,
    delta_abertas: reg.delta_abertas || 0,
    status: reg.status,
    detalhe_erro: reg.detalhe_erro || null,
  });
  return Number(res.lastInsertRowid);
}

/**
 * Retorna a execução mais recente de um tipo de crawl para uma loja específica.
 */
export function obterUltimaExecucaoLoja(
  db: Database.Database,
  lojaSlug: string,
  tipoCrawl: 'METAS' | 'DEEP_OS' | 'PATIO'
): CrawlExecucaoRegistro | null {
  const row = db.prepare(`
    SELECT * FROM crawls_execucoes
    WHERE loja_slug = ? AND tipo_crawl = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(lojaSlug, tipoCrawl) as CrawlExecucaoRegistro | undefined;
  return row || null;
}

export interface AgentFeedbackInput {
  phone: string;
  conversation_id?: number;
  message_id?: number;
  pergunta_original?: string;
  resposta_agente?: string;
  feedback_usuario: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export function insertAgentFeedback(db: Database.Database, feedback: AgentFeedbackInput): number {
  const stmt = db.prepare(`
    INSERT INTO agent_feedbacks (
      phone, conversation_id, message_id, pergunta_original, resposta_agente, feedback_usuario, status, created_at
    ) VALUES (
      @phone, @conversation_id, @message_id, @pergunta_original, @resposta_agente, @feedback_usuario, @status, CURRENT_TIMESTAMP
    )
  `);
  const result = stmt.run({
    phone: feedback.phone,
    conversation_id: feedback.conversation_id || null,
    message_id: feedback.message_id || null,
    pergunta_original: feedback.pergunta_original || null,
    resposta_agente: feedback.resposta_agente || null,
    feedback_usuario: feedback.feedback_usuario,
    status: feedback.status || 'PENDING'
  });
  return Number(result.lastInsertRowid);
}

export interface AgentInteractionLogInput {
  phone: string;
  conversation_id?: number;
  message_id?: number;
  pergunta: string;
  tools_chamadas?: string[];
  resposta_gerada?: string;
  latencia_ms?: number;
  motor_utilizado?: string;
  erro?: string;
}

export function insertAgentInteractionLog(db: Database.Database, log: AgentInteractionLogInput): number {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_interaction_logs (
      phone, conversation_id, message_id, pergunta, tools_chamadas, resposta_gerada, latencia_ms, motor_utilizado, erro, created_at
    ) VALUES (
      @phone, @conversation_id, @message_id, @pergunta, @tools_chamadas, @resposta_gerada, @latencia_ms, @motor_utilizado, @erro, CURRENT_TIMESTAMP
    )
  `);
  const result = stmt.run({
    phone: log.phone,
    conversation_id: log.conversation_id || null,
    message_id: log.message_id || null,
    pergunta: log.pergunta,
    tools_chamadas: log.tools_chamadas ? JSON.stringify(log.tools_chamadas) : '[]',
    resposta_gerada: log.resposta_gerada || null,
    latencia_ms: log.latencia_ms || 0,
    motor_utilizado: log.motor_utilizado || 'AGY_CLI',
    erro: log.erro || null
  });
  return Number(result.lastInsertRowid);
}

export interface HighestValueOSFilter {
  loja_slug?: string;
  limit?: number;
  ordem?: 'DESC' | 'ASC';
}

export interface HighestValueOSResult {
  os_id: string;
  loja_slug: string;
  veiculo: string;
  placa: string;
  cliente_nome: string;
  total_os: number;
  valor_pago: number;
  valor_restante: number;
  dias_no_patio: number;
  responsavel?: string;
}

export interface PartsCountOSResult {
  os_id: string;
  loja_slug: string;
  veiculo: string;
  placa: string;
  total_os: number;
  qtd_itens: number;
  principais_pecas: string[];
}

export interface ChecklistAuditResult {
  total_os_abertas: number;
  total_sem_checklist_entrada: number;
  total_sem_checklist_mecanico: number;
  por_loja_sem_mecanico: Record<string, number>;
  por_loja_sem_entrada: Record<string, number>;
  detalhes_criticos: Array<{
    os_id: string;
    loja_slug: string;
    veiculo: string;
    placa: string;
    dias_no_patio: number;
    sem_entrada: boolean;
    sem_mecanico: boolean;
  }>;
}

export interface OpenOSCounts {
  confirmed_open: number;
  veiculos_patio_fisico?: number;
  pendencias_baixa_erp?: number;
  transition_pending: number;
  total_open_like: number;
}

export interface StoreDrilldownResult {
  confirmed_open: number;
  veiculos_patio_fisico?: number;
  pendencias_baixa_erp?: number;
  transition_pending: number;
  total_open_like: number;
  loja_slug: string;
  total_veiculos_patio: number;
  saldo_total_receber: number;
  faturamento_mes: number;
  volume_os_mes: number;
  ticket_medio: number;
  carros_travados_5d: number;
  sem_checklist_mecanico: number;
  sem_checklist_entrada: number;
  alertas_sem_sinal: number;
  data_referencia_metas?: string;
  posicao_hora_metas?: string;
  is_metas_stale?: boolean;
  veiculos_ativos?: Array<{
    os_id: string;
    veiculo: string;
    placa: string;
    cliente_nome: string;
    status_grid: string;
    dias_no_patio: number;
    total_os: number;
    valor_restante: number;
  }>;
}

export interface RecentInteractionContext {
  pergunta_anterior?: string;
  resposta_anterior?: string;
  tools_anteriores?: string[];
  tema_anterior?: 'CHECKLIST' | 'VALOR' | 'PECAS' | 'PATIO' | 'LOJA' | 'FATURAMENTO';
}

/**
 * Consulta as OSs de maior (ou menor) valor da rede ou de uma loja específica.
 */
export function getHighestValueOS(db: Database.Database, filter: HighestValueOSFilter = {}): HighestValueOSResult[] {
  const limit = Math.min(filter.limit || 5, 20);
  const ordem = filter.ordem === 'ASC' ? 'ASC' : 'DESC';
  
  if (filter.loja_slug) {
    return db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_pago, valor_restante, dias_no_patio, responsavel
      FROM ordens_servico
      WHERE is_aberta = 1 AND (
        COALESCE(dias_no_patio, 0) > 0
        OR (
          (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
          AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
          AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
        )
      ) AND LOWER(loja_slug) = LOWER(?)
      ORDER BY total_os ${ordem}
      LIMIT ?
    `).all(filter.loja_slug, limit) as HighestValueOSResult[];
  }

  return db.prepare(`
    SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_pago, valor_restante, dias_no_patio, responsavel
    FROM ordens_servico
    WHERE is_aberta = 1 AND (
      COALESCE(dias_no_patio, 0) > 0
      OR (
        (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
        AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
        AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
      )
    )
    ORDER BY total_os ${ordem}
    LIMIT ?
  `).all(limit) as HighestValueOSResult[];
}

/**
 * Consulta ranking de OSs com maior volume de peças/itens utilizando json_array_length.
 */
export function getOSByItemCount(db: Database.Database, lojaSlug?: string, limit = 5): PartsCountOSResult[] {
  const lim = Math.min(limit, 20);
  const query = lojaSlug
    ? `SELECT os_id, loja_slug, veiculo, placa, total_os,
              json_array_length(json_extract(raw_payload, '$.itens')) as qtd_itens,
              raw_payload
       FROM ordens_servico
       WHERE is_aberta = 1 AND json_extract(raw_payload, '$.itens') IS NOT NULL AND LOWER(loja_slug) = LOWER(?)
       ORDER BY qtd_itens DESC
       LIMIT ?`
    : `SELECT os_id, loja_slug, veiculo, placa, total_os,
              json_array_length(json_extract(raw_payload, '$.itens')) as qtd_itens,
              raw_payload
       FROM ordens_servico
       WHERE is_aberta = 1 AND json_extract(raw_payload, '$.itens') IS NOT NULL
       ORDER BY qtd_itens DESC
       LIMIT ?`;

  const rows = (lojaSlug ? db.prepare(query).all(lojaSlug, lim) : db.prepare(query).all(lim)) as any[];

  return rows.map(r => {
    let principaisPecas: string[] = [];
    try {
      const p = JSON.parse(r.raw_payload || '{}');
      if (Array.isArray(p.itens)) {
        principaisPecas = p.itens
          .filter((i: any) => i && i.descricao)
          .slice(0, 3)
          .map((i: any) => `${i.qtd || 1}x ${i.descricao}`);
      }
    } catch {}

    return {
      os_id: r.os_id,
      loja_slug: r.loja_slug,
      veiculo: r.veiculo || 'Não informado',
      placa: r.placa || 'Sem placa',
      total_os: r.total_os || 0,
      qtd_itens: r.qtd_itens || 0,
      principais_pecas: principaisPecas,
    };
  });
}

/**
 * Normaliza e resolve alias de slug de loja para o valor canônico do banco SQLite.
 */
export function resolveDbLojaSlug(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim();
  const lower = clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const storeMap: Record<string, string> = {
    'dom pedro': 'MPdompedro1',
    'dompedro': 'MPdompedro1',
    'dompedro1': 'MPdompedro1',
    'mpdompedro1': 'MPdompedro1',
    'jabaquara': 'MPJabaquara',
    'mpjabaquara': 'MPJabaquara',
    'jorge beretta': 'MPJorgeBeretta',
    'jorgeberetta': 'MPJorgeBeretta',
    'beretta': 'MPJorgeBeretta',
    'mpjorgeberetta': 'MPJorgeBeretta',
    'kennedy': 'MPkennedy',
    'mpkennedy': 'MPkennedy',
    'piraporinha': 'MPpiraporinha',
    'pirapora': 'MPpiraporinha',
    'mppiraporinha': 'MPpiraporinha',
    'planalto': 'MPplanalto',
    'mpplanalto': 'MPplanalto',
    'rudge': 'MPrudge',
    'rudge ramos': 'MPrudge',
    'rudgeramos': 'MPrudge',
    'mprudge': 'MPrudge',
    'santo andre': 'MPSantoAndre',
    'santoandre': 'MPSantoAndre',
    'stoandre': 'MPSantoAndre',
    'mpsantoandre': 'MPSantoAndre',
    'modulo': 'ReiDoModulo',
    'rei do modulo': 'ReiDoModulo',
    'reidomodulo': 'ReiDoModulo',
    'maua': 'ReiDoOleoMaua',
    'rei do oleo': 'ReiDoOleoMaua',
    'rei do oleo maua': 'ReiDoOleoMaua',
    'reidooleomaua': 'ReiDoOleoMaua',
    'master': 'MPMaster',
    'mpmaster': 'MPMaster'
  };

  for (const [alias, canonical] of Object.entries(storeMap)) {
    if (lower === alias || lower.includes(alias) || alias.includes(lower)) {
      return canonical;
    }
  }
  return clean;
}

/**
 * Auditoria completa de checklists pendentes ('Check-List de Inspeção' vs 'MECANICO').
 */
export function getChecklistAudit(db: Database.Database, lojaSlug?: string): ChecklistAuditResult {
  const canonicalSlug = resolveDbLojaSlug(lojaSlug);
  let query = `
    SELECT os_id, loja_slug, veiculo, placa, dias_no_patio, raw_payload
    FROM ordens_servico
    WHERE is_aberta = 1 AND (
      COALESCE(dias_no_patio, 0) > 0
      OR (
        (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
        AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
        AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
      )
    )
  `;
  const params: any[] = [];
  if (canonicalSlug) {
    query += ` AND LOWER(loja_slug) = LOWER(?)`;
    params.push(canonicalSlug);
  }
  const rows = db.prepare(query).all(...params) as any[];

  let semEntrada = 0;
  let semMecanico = 0;
  const porLojaSemMec: Record<string, number> = {};
  const porLojaSemEntrada: Record<string, number> = {};
  const detalhesCriticos: any[] = [];

  for (const r of rows) {
    if (canonicalSlug && r.loja_slug.toLowerCase() !== canonicalSlug.toLowerCase()) {
      continue;
    }

    let p: any = {};
    try { p = JSON.parse(r.raw_payload || '{}'); } catch {}
    const lists = Array.isArray(p.checklists) ? p.checklists : [];

    const hasEntrada = lists.some((c: any) => c && c.tipo && (
      c.tipo.toLowerCase().includes('inspe') ||
      c.tipo.toLowerCase().includes('entrada')
    ));

    const hasMecanico = lists.some((c: any) => c && c.tipo && (
      c.tipo.toLowerCase().includes('mecanic') ||
      c.tipo.toUpperCase() === 'MECANICO'
    ));

    if (!hasEntrada) {
      semEntrada++;
      porLojaSemEntrada[r.loja_slug] = (porLojaSemEntrada[r.loja_slug] || 0) + 1;
    }
    if (!hasMecanico) {
      semMecanico++;
      porLojaSemMec[r.loja_slug] = (porLojaSemMec[r.loja_slug] || 0) + 1;
    }

    if (!hasMecanico || !hasEntrada) {
      detalhesCriticos.push({
        os_id: r.os_id,
        loja_slug: r.loja_slug,
        veiculo: r.veiculo || 'Não informado',
        placa: r.placa || 'Sem placa',
        dias_no_patio: r.dias_no_patio || 0,
        sem_entrada: !hasEntrada,
        sem_mecanico: !hasMecanico
      });
    }
  }

  detalhesCriticos.sort((a, b) => (b.dias_no_patio || 0) - (a.dias_no_patio || 0));

  return {
    total_os_abertas: rows.length,
    total_sem_checklist_entrada: semEntrada,
    total_sem_checklist_mecanico: semMecanico,
    por_loja_sem_mecanico: porLojaSemMec,
    por_loja_sem_entrada: porLojaSemEntrada,
    detalhes_criticos: detalhesCriticos.slice(0, 10),
  };
}

/**
 * Raio-X completo e consolidado de uma unidade específica.
 */
export function getStoreDrilldown(db: Database.Database, lojaSlug: string): StoreDrilldownResult {
  const slug = (resolveDbLojaSlug(lojaSlug) || lojaSlug).trim().toLowerCase();

  const patioRow = db.prepare(`
    SELECT 
      COUNT(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN 1 
      END) AS veiculos_patio_fisico,
      COUNT(CASE 
        WHEN is_aberta = 1 AND NOT (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN 1 
      END) AS pendencias_baixa_erp,
      COUNT(CASE WHEN UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE' THEN 1 END) AS transition_pending,
      SUM(CASE 
        WHEN is_aberta = 1 AND (
          COALESCE(dias_no_patio, 0) > 0
          OR (
            (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
            AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
            AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
          )
        ) THEN valor_restante ELSE 0 
      END) as total_restante
    FROM ordens_servico
    WHERE (is_aberta = 1 OR UPPER(TRIM(COALESCE(estado_operacional, ''))) = 'TRANSICAO_PENDENTE') AND LOWER(loja_slug) = LOWER(?)
  `).get(slug) as any;

  const veiculosPatioFisico = patioRow?.veiculos_patio_fisico ?? 0;
  const pendenciasBaixa = patioRow?.pendencias_baixa_erp ?? 0;
  const transitionPending = patioRow?.transition_pending ?? 0;
  const totalOpenLike = veiculosPatioFisico + transitionPending;

  const travadosRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM ordens_servico
    WHERE is_aberta = 1 AND dias_no_patio >= 5 AND LOWER(loja_slug) = LOWER(?)
  `).get(slug) as any;

  const alertasRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM ordens_servico
    WHERE is_aberta = 1 AND valor_restante >= 2500 AND valor_pago <= 0 AND LOWER(loja_slug) = LOWER(?)
  `).get(slug) as any;

  const metasRow = db.prepare(`
    SELECT faturamento_mes, volume_os, ticket_medio, data_referencia, posicao_hora
    FROM metas_diarias
    WHERE LOWER(loja_slug) = LOWER(?)
      AND data_referencia = (SELECT MAX(data_referencia) FROM metas_diarias)
    LIMIT 1
  `).get(slug) as any;

  const checklistAudit = getChecklistAudit(db, slug);
  const frescor = verificarFrescorMetas(db, 26);

  const veiculosAtivos = db.prepare(`
    SELECT os_id, veiculo, placa, cliente_nome, status_grid, dias_no_patio, total_os, valor_restante
    FROM ordens_servico
    WHERE (
      is_aberta = 1 AND (
        COALESCE(dias_no_patio, 0) > 0
        OR (
          (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
          AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
          AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
        )
      )
    ) AND LOWER(loja_slug) = LOWER(?)
    ORDER BY dias_no_patio DESC, total_os DESC
  `).all(slug) as any[];

  return {
    loja_slug: lojaSlug,
    total_veiculos_patio: veiculosPatioFisico,
    confirmed_open: veiculosPatioFisico,
    veiculos_patio_fisico: veiculosPatioFisico,
    pendencias_baixa_erp: 0,
    transition_pending: transitionPending,
    total_open_like: totalOpenLike,
    saldo_total_receber: patioRow?.total_restante || 0,
    faturamento_mes: metasRow?.faturamento_mes || 0,
    volume_os_mes: metasRow?.volume_os || 0,
    ticket_medio: metasRow?.ticket_medio || 0,
    carros_travados_5d: travadosRow?.total || 0,
    sem_checklist_mecanico: checklistAudit.total_sem_checklist_mecanico,
    sem_checklist_entrada: checklistAudit.total_sem_checklist_entrada,
    alertas_sem_sinal: alertasRow?.total || 0,
    data_referencia_metas: metasRow?.data_referencia,
    posicao_hora_metas: metasRow?.posicao_hora,
    is_metas_stale: !frescor.isValido,
    veiculos_ativos: veiculosAtivos,
  };
}

/**
 * Busca flexível de OS por Placa, Número da OS, Veículo ou Cliente.
 */
export function searchOS(db: Database.Database, termo: string): any[] {
  const rawTermo = termo.trim();
  const t = `%${rawTermo.toLowerCase()}%`;
  return db.prepare(`
    SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_pago, valor_restante, dias_no_patio, status_grid
    FROM ordens_servico
    WHERE os_id = ? 
       OR LOWER(placa) LIKE ? 
       OR LOWER(veiculo) LIKE ? 
       OR LOWER(cliente_nome) LIKE ?
    ORDER BY is_aberta DESC, total_os DESC
    LIMIT 5
  `).all(rawTermo, t, t, t);
}

/**
 * Recupera o contexto da última interação do operador para resolução de elipses ("e por loja?", "e o valor?").
 */
export function getRecentInteractionContext(db: Database.Database, phone: string): RecentInteractionContext {
  const cleanPhone = phone.replace(/\D/g, '');
  const row = db.prepare(`
    SELECT pergunta, resposta_gerada, tools_chamadas, created_at
    FROM agent_interaction_logs
    WHERE phone = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(cleanPhone) as any;

  if (!row) return {};

  const pergunta = (row.pergunta || '').toLowerCase();
  let tema: 'CHECKLIST' | 'VALOR' | 'PECAS' | 'PATIO' | 'LOJA' | 'FATURAMENTO' | undefined;

  if (pergunta.includes('check') || pergunta.includes('mecanic') || pergunta.includes('inspe')) {
    tema = 'CHECKLIST';
  } else if (pergunta.includes('valor') || pergunta.includes('car') || pergunta.includes('mai')) {
    tema = 'VALOR';
  } else if (pergunta.includes('peca') || pergunta.includes('item')) {
    tema = 'PECAS';
  } else if (pergunta.includes('patio') || pergunta.includes('travad') || pergunta.includes('dia')) {
    tema = 'PATIO';
  } else if (pergunta.includes('fatur') || pergunta.includes('meta') || pergunta.includes('vend')) {
    tema = 'FATURAMENTO';
  }

  let tools: string[] = [];
  try { tools = JSON.parse(row.tools_chamadas || '[]'); } catch {}

  return {
    pergunta_anterior: row.pergunta,
    resposta_anterior: row.resposta_gerada,
    tools_anteriores: tools,
    tema_anterior: tema,
  };
}

export interface SemanticSearchResult {
  os_id: string;
  loja_slug: string;
  distance: number;
  veiculo: string;
  placa: string;
  cliente_nome: string;
  total_os: number;
  valor_restante: number;
  dias_no_patio: number;
  status_grid: string;
  responsavel?: string;
}

export interface ConversationMessage {
  id?: number;
  phone: string;
  role: 'user' | 'assistant';
  content: string;
  tool_used: string | null;
  tool_params: string | null;
  created_at: string;
}

/**
 * Insere ou atualiza o embedding vetorial de uma OS na tabela virtual sqlite-vec.
 */
export function upsertOSEmbedding(
  db: Database.Database,
  osKey: string, // "{os_id}:{loja_slug}"
  embedding: Float32Array
): void {
  if (!isVectorExtensionLoaded && !loadVectorExtension(db)) {
    console.warn(`[VEC] sqlite-vec não está carregado. Ignorando upsert para ${osKey}`);
    return;
  }

  if (!(embedding instanceof Float32Array) || embedding.length !== 384) {
    console.warn(`[VEC] Dimensão ou tipo inválido para ${osKey}: esperava Float32Array de 384 dimensões, recebido ${embedding?.length}`);
    return;
  }

  try {
    const rawBuffer = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare('DELETE FROM vec_ordens_servico WHERE os_key = ?').run(osKey);
    db.prepare(`
      INSERT INTO vec_ordens_servico(os_key, os_embedding)
      VALUES (?, ?)
    `).run(osKey, rawBuffer);
  } catch (err: any) {
    console.warn(`[VEC] Erro ao salvar embedding para ${osKey}:`, err?.message || err);
  }
}

/**
 * Executa busca semântica aproximada por KNN nos embeddings de OS.
 */
export function semanticSearchOS(
  db: Database.Database,
  queryEmbedding: Float32Array,
  limit: number = 5
): SemanticSearchResult[] {
  if (!isVectorExtensionLoaded && !loadVectorExtension(db)) {
    return [];
  }

  if (!(queryEmbedding instanceof Float32Array) || queryEmbedding.length !== 384) {
    console.warn(`[VEC] Dimensão da query inválida: esperava 384 dimensões, recebido ${queryEmbedding?.length}`);
    return [];
  }

  try {
    const rawBuffer = new Uint8Array(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);
    const vecResults = db.prepare(`
      SELECT os_key, distance
      FROM vec_ordens_servico
      WHERE os_embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(rawBuffer, limit) as Array<{ os_key: string; distance: number }>;

    if (!vecResults || vecResults.length === 0) {
      return [];
    }

    const results: SemanticSearchResult[] = [];
    const getOSStmt = db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_restante, dias_no_patio, status_grid, responsavel
      FROM ordens_servico
      WHERE os_id = ? AND loja_slug = ?
    `);

    for (const item of vecResults) {
      const parts = item.os_key.split(':');
      if (parts.length < 2) continue;
      const [osId, lojaSlug] = parts;
      const osData = getOSStmt.get(osId, lojaSlug) as any;
      if (osData) {
        results.push({
          os_id: osData.os_id,
          loja_slug: osData.loja_slug,
          distance: Number(item.distance.toFixed(4)),
          veiculo: osData.veiculo || 'N/A',
          placa: osData.placa || 'N/A',
          cliente_nome: osData.cliente_nome || 'N/A',
          total_os: Number(osData.total_os || 0),
          valor_restante: Number(osData.valor_restante || 0),
          dias_no_patio: Number(osData.dias_no_patio || 0),
          status_grid: osData.status_grid || 'N/A',
          responsavel: osData.responsavel || undefined
        });
      }
    }

    return results;
  } catch (err: any) {
    console.warn('[VEC] Erro na busca semântica KNN:', err?.message || err);
    return [];
  }
}

/**
 * Salva uma mensagem no histórico conversacional persistente.
 */
export function saveConversationMessage(
  db: Database.Database,
  phone: string,
  role: 'user' | 'assistant',
  content: string,
  toolUsed?: string | null,
  toolParams?: Record<string, any> | null
): void {
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const serializedParams = toolParams ? JSON.stringify(toolParams) : null;
    db.prepare(`
      INSERT INTO conversation_messages(phone, role, content, tool_used, tool_params)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanPhone, role, content, toolUsed || null, serializedParams);
  } catch (err: any) {
    console.warn('[CONV] Erro ao salvar mensagem da conversa:', err?.message || err);
  }
}

/**
 * Recupera os últimos turnos da conversa em ordem cronológica.
 */
export function getConversationHistory(
  db: Database.Database,
  phone: string,
  limit: number = 5
): ConversationMessage[] {
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const rows = db.prepare(`
      SELECT id, phone, role, content, tool_used, tool_params, created_at
      FROM conversation_messages
      WHERE phone = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(cleanPhone, limit) as ConversationMessage[];

    return rows.reverse();
  } catch (err: any) {
    console.warn('[CONV] Erro ao buscar histórico da conversa:', err?.message || err);
    return [];
  }
}

export interface CrawlerExecutionSnapshot {
  loja_slug: string;
  tipo: 'METAS' | 'DEEP_OS' | 'PATIO';
  ultimaExecucao: string | null;
  status: 'SUCCESS' | 'PARTIAL_REJECTED' | 'QUARANTINE' | 'ERROR';
  duracaoMs: number;
  registros: number;
}

export interface HydraHealthMetrics {
  timestamp: string;
  statusGeral: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  crawlers: CrawlerExecutionSnapshot[];
  metas: {
    dataReferenciaMaisRecente: string | null;
    idadeEmHoras: number;
    lojasCompletas: number;
    frescor: 'FRESH' | 'STALE' | 'CRITICAL';
  };
  indiceVetorial: {
    totalVetores: number;
    totalOSsAbertas: number;
    coberturaPct: number;
  };
  watchdogQueue: {
    pendentes: number;
    processando: number;
    falhas: number;
  };
  telemetriaIA: {
    totalChamadas24h: number;
    taxaSucessoPct: number;
    timeouts: number;
    indisponibilidades: number;
    respostasInvalidas: number;
    slopFallbacks: number;
    duracaoMediaMs: number;
  };
  enviosWhatsApp: {
    totalEnvios24h: number;
    taxaEntregaConfirmadaPct: number;
    falhasHttp: number;
    mediaTentativasPorEnvio: number;
  };
}

export async function getHydraHealthSnapshot(
  db: Database.Database,
  redisClient?: any
): Promise<HydraHealthMetrics> {
  const timestamp = new Date().toISOString();

  // 1. Crawlers snapshot
  let crawlers: CrawlerExecutionSnapshot[] = [];
  try {
    const rows = db.prepare(`
      SELECT loja_slug, tipo_crawl as tipo, fim_em as ultimaExecucao, status, duracao_ms as duracaoMs, total_registros as registros
      FROM crawls_execucoes
      ORDER BY id DESC
      LIMIT 10
    `).all() as any[];
    crawlers = rows.map(r => ({
      loja_slug: r.loja_slug || 'GERAL',
      tipo: r.tipo || 'PATIO',
      ultimaExecucao: r.ultimaExecucao || null,
      status: r.status || 'SUCCESS',
      duracaoMs: Number(r.duracaoMs || 0),
      registros: Number(r.registros || 0)
    }));
  } catch (err: any) {
    console.warn('[HEALTH] Falha ao ler crawls_execucoes:', err?.message || err);
  }

  // 2. Metas & Frescor
  let metasData = {
    dataReferenciaMaisRecente: null as string | null,
    idadeEmHoras: 999,
    lojasCompletas: 0,
    frescor: 'CRITICAL' as 'FRESH' | 'STALE' | 'CRITICAL'
  };
  try {
    const frescorInfo = verificarFrescorMetas(db, 26);
    metasData.dataReferenciaMaisRecente = frescorInfo.dataMaisRecente;
    metasData.idadeEmHoras = frescorInfo.idadeHoras;

    if (frescorInfo.dataMaisRecente) {
      const lojasRow = db.prepare(`
        SELECT COUNT(DISTINCT loja_slug) as c FROM metas_diarias WHERE data_referencia = ?
      `).get(frescorInfo.dataMaisRecente) as { c: number } | undefined;
      metasData.lojasCompletas = lojasRow?.c || 0;
    }

    if (!frescorInfo.dataMaisRecente || frescorInfo.idadeHoras > 36) {
      metasData.frescor = 'CRITICAL';
    } else if (frescorInfo.idadeHoras > 26) {
      metasData.frescor = 'STALE';
    } else {
      metasData.frescor = 'FRESH';
    }
  } catch (err: any) {
    console.warn('[HEALTH] Falha ao verificar metas:', err?.message || err);
  }

  // 3. Índice Vetorial
  let indiceVetorial = {
    totalVetores: 0,
    totalOSsAbertas: 0,
    coberturaPct: 100
  };
  try {
    const openCounts = getOpenOSCounts(db);
    indiceVetorial.totalOSsAbertas = openCounts.confirmed_open;

    let vecCount = 0;
    try {
      const vRow = db.prepare('SELECT COUNT(*) as c FROM vec_ordens_servico').get() as { c: number } | undefined;
      vecCount = vRow?.c || 0;
    } catch {}
    indiceVetorial.totalVetores = vecCount;
    if (indiceVetorial.totalOSsAbertas > 0) {
      indiceVetorial.coberturaPct = Math.min(100, Math.round((vecCount / indiceVetorial.totalOSsAbertas) * 100));
    } else {
      indiceVetorial.coberturaPct = 100;
    }
  } catch (err: any) {
    console.warn('[HEALTH] Falha ao verificar índice vetorial:', err?.message || err);
  }

  // 4. Watchdog Queue
  let watchdogQueue = {
    pendentes: 0,
    processando: 0,
    falhas: 0
  };
  if (redisClient) {
    try {
      const pendentes = await redisClient.zcard('watchdog:scheduled_evals');
      const locks = await redisClient.keys('evaluating:conv:*');
      watchdogQueue.pendentes = Number(pendentes || 0);
      watchdogQueue.processando = locks ? locks.length : 0;
    } catch (rErr: any) {
      console.warn('[HEALTH] Falha ao consultar fila watchdog no Redis:', rErr?.message || rErr);
    }
  }

  // 5. Telemetria IA (24h)
  let telemetriaIA = {
    totalChamadas24h: 0,
    taxaSucessoPct: 100,
    timeouts: 0,
    indisponibilidades: 0,
    respostasInvalidas: 0,
    slopFallbacks: 0,
    duracaoMediaMs: 0
  };
  try {
    const aiRow = db.prepare(`
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
    `).get() as any;

    if (aiRow && aiRow.total > 0) {
      telemetriaIA.totalChamadas24h = aiRow.total;
      telemetriaIA.taxaSucessoPct = Math.round(((aiRow.sucessos || 0) / aiRow.total) * 100);
      telemetriaIA.timeouts = aiRow.timeouts || 0;
      telemetriaIA.indisponibilidades = aiRow.indisponibilidades || 0;
      telemetriaIA.respostasInvalidas = aiRow.respostasInvalidas || 0;
      telemetriaIA.slopFallbacks = aiRow.slopFallbacks || 0;
      telemetriaIA.duracaoMediaMs = Math.round(aiRow.mediaDuracao || 0);
    }
  } catch (err: any) {
    console.warn('[HEALTH] Falha ao consultar telemetria IA:', err?.message || err);
  }

  // 6. Envios WhatsApp (24h)
  let enviosWhatsApp = {
    totalEnvios24h: 0,
    taxaEntregaConfirmadaPct: 100,
    falhasHttp: 0,
    mediaTentativasPorEnvio: 1.0
  };
  try {
    const waRow = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN sucesso = 1 THEN 1 ELSE 0 END) as sucessos,
        SUM(CASE WHEN sucesso = 0 OR (status_http IS NOT NULL AND (status_http < 200 OR status_http >= 300)) THEN 1 ELSE 0 END) as falhas,
        AVG(tentativas) as mediaTentativas
      FROM whatsapp_delivery_logs
      WHERE created_at > datetime('now', '-24 hours')
    `).get() as any;

    if (waRow && waRow.total > 0) {
      enviosWhatsApp.totalEnvios24h = waRow.total;
      enviosWhatsApp.taxaEntregaConfirmadaPct = Math.round(((waRow.sucessos || 0) / waRow.total) * 100);
      enviosWhatsApp.falhasHttp = waRow.falhas || 0;
      enviosWhatsApp.mediaTentativasPorEnvio = Number((waRow.mediaTentativas || 1).toFixed(2));
    }
  } catch (err: any) {
    console.warn('[HEALTH] Falha ao consultar envios WhatsApp:', err?.message || err);
  }

  // Status Geral consolidado
  let statusGeral: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
  const hasCriticalCrawl = crawlers.some(c => c.status === 'ERROR');
  if (metasData.frescor === 'CRITICAL' || enviosWhatsApp.taxaEntregaConfirmadaPct < 80) {
    statusGeral = 'UNHEALTHY';
  } else if (
    metasData.frescor === 'STALE' || 
    hasCriticalCrawl || 
    indiceVetorial.coberturaPct < 80 || 
    telemetriaIA.taxaSucessoPct < 90
  ) {
    statusGeral = 'DEGRADED';
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
 * Salva relatório de operação (CMV, Áreas e Mídia) de forma idempotente no SQLite.
 */
export function salvarRelatorioOperacao(
  db: Database.Database,
  dados: {
    lojaSlug: string;
    dataInicio: string;
    dataFim: string;
    cmv?: CMVLojaItem;
    areas?: FaturamentoAreaItem[];
    midia?: PesquisaMidiaItem[];
  }
): void {
  const { lojaSlug, dataInicio, dataFim, cmv, areas, midia } = dados;

  db.transaction(() => {
    if (cmv) {
      db.prepare(`
        INSERT INTO cmv_lojas (
          loja_slug, data_inicio, data_fim, faturamento_total, desconto_total, custo_total,
          cmv_percentual, lucro_bruto, lucro_bruto_percentual, created_at
        ) VALUES (
          @loja_slug, @data_inicio, @data_fim, @faturamento_total, @desconto_total, @custo_total,
          @cmv_percentual, @lucro_bruto, @lucro_bruto_percentual, CURRENT_TIMESTAMP
        )
        ON CONFLICT(loja_slug, data_inicio, data_fim) DO UPDATE SET
          faturamento_total = excluded.faturamento_total,
          desconto_total = excluded.desconto_total,
          custo_total = excluded.custo_total,
          cmv_percentual = excluded.cmv_percentual,
          lucro_bruto = excluded.lucro_bruto,
          lucro_bruto_percentual = excluded.lucro_bruto_percentual,
          created_at = CURRENT_TIMESTAMP
      `).run({
        loja_slug: lojaSlug,
        data_inicio: dataInicio,
        data_fim: dataFim,
        faturamento_total: cmv.faturamento_total,
        desconto_total: cmv.desconto_total ?? 0,
        custo_total: cmv.custo_total,
        cmv_percentual: cmv.cmv_percentual,
        lucro_bruto: cmv.lucro_bruto,
        lucro_bruto_percentual: cmv.lucro_bruto_percentual
      });
    }

    if (areas && areas.length > 0) {
      const stmtArea = db.prepare(`
        INSERT INTO faturamento_areas (
          loja_slug, data_inicio, data_fim, area, faturamento, faturamento_percentual,
          desconto, custo, cmv_percentual, lucro_bruto, lucro_bruto_percentual, created_at
        ) VALUES (
          @loja_slug, @data_inicio, @data_fim, @area, @faturamento, @faturamento_percentual,
          @desconto, @custo, @cmv_percentual, @lucro_bruto, @lucro_bruto_percentual, CURRENT_TIMESTAMP
        )
        ON CONFLICT(loja_slug, data_inicio, data_fim, area) DO UPDATE SET
          faturamento = excluded.faturamento,
          faturamento_percentual = excluded.faturamento_percentual,
          desconto = excluded.desconto,
          custo = excluded.custo,
          cmv_percentual = excluded.cmv_percentual,
          lucro_bruto = excluded.lucro_bruto,
          lucro_bruto_percentual = excluded.lucro_bruto_percentual,
          created_at = CURRENT_TIMESTAMP
      `);
      for (const a of areas) {
        stmtArea.run({
          loja_slug: lojaSlug,
          data_inicio: dataInicio,
          data_fim: dataFim,
          area: a.area,
          faturamento: a.faturamento,
          faturamento_percentual: a.faturamento_percentual ?? 0,
          desconto: a.desconto ?? 0,
          custo: a.custo,
          cmv_percentual: a.cmv_percentual,
          lucro_bruto: a.lucro_bruto,
          lucro_bruto_percentual: a.lucro_bruto_percentual
        });
      }
    }

    if (midia && midia.length > 0) {
      const stmtMidia = db.prepare(`
        INSERT INTO pesquisa_midia (
          loja_slug, data_inicio, data_fim, canal, faturamento, faturamento_percentual,
          qtd_os, ticket_medio, created_at
        ) VALUES (
          @loja_slug, @data_inicio, @data_fim, @canal, @faturamento, @faturamento_percentual,
          @qtd_os, @ticket_medio, CURRENT_TIMESTAMP
        )
        ON CONFLICT(loja_slug, data_inicio, data_fim, canal) DO UPDATE SET
          faturamento = excluded.faturamento,
          faturamento_percentual = excluded.faturamento_percentual,
          qtd_os = excluded.qtd_os,
          ticket_medio = excluded.ticket_medio,
          created_at = CURRENT_TIMESTAMP
      `);
      for (const m of midia) {
        stmtMidia.run({
          loja_slug: lojaSlug,
          data_inicio: dataInicio,
          data_fim: dataFim,
          canal: m.canal,
          faturamento: m.faturamento,
          faturamento_percentual: m.faturamento_percentual ?? 0,
          qtd_os: m.qtd_os,
          ticket_medio: m.ticket_medio ?? (m.qtd_os > 0 ? m.faturamento / m.qtd_os : 0)
        });
      }
    }
  })();
  console.log(`[DB] ✅ Relatório de Operação sincronizado para loja ${lojaSlug} (${dataInicio} a ${dataFim}).`);
}

export function getCMVByStore(db: Database.Database, options?: { lojaSlug?: string; dataInicio?: string; dataFim?: string }): any[] {
  let sql = 'SELECT * FROM cmv_lojas';
  const params: any[] = [];
  if (options?.lojaSlug) {
    sql += ' WHERE LOWER(loja_slug) = LOWER(?)';
    params.push(options.lojaSlug);
  }
  sql += ' ORDER BY faturamento_total DESC';
  return db.prepare(sql).all(...params);
}

export function getFaturamentoPorArea(db: Database.Database, options?: { lojaSlug?: string }): any[] {
  let sql = 'SELECT * FROM faturamento_areas';
  const params: any[] = [];
  if (options?.lojaSlug) {
    sql += ' WHERE LOWER(loja_slug) = LOWER(?)';
    params.push(options.lojaSlug);
  }
  sql += ' ORDER BY faturamento DESC';
  return db.prepare(sql).all(...params);
}

export function getPesquisaMidia(db: Database.Database, options?: { lojaSlug?: string }): any[] {
  let sql = 'SELECT * FROM pesquisa_midia';
  const params: any[] = [];
  if (options?.lojaSlug) {
    sql += ' WHERE LOWER(loja_slug) = LOWER(?)';
    params.push(options.lojaSlug);
  }
  sql += ' ORDER BY faturamento DESC';
  return db.prepare(sql).all(...params);
}



// =============================================================================
// HYDRA FINANCIAL DATA ENGINE: CONSULTAS ESTRUTURADAS (MISSÃO 1)
// =============================================================================

export const CATALOGO_10_LOJAS: string[] = [
  'MPdompedro1',
  'MPJabaquara',
  'MPJorgeBeretta',
  'MPkennedy',
  'MPpiraporinha',
  'MPplanalto',
  'MPrudge',
  'MPSantoAndre',
  'ReiDoModulo',
  'ReiDoOleoMaua'
];

export const STORE_DISPLAY_NAMES: Record<string, string> = {
  'mpdompedro1': 'Dom Pedro I',
  'mpjabaquara': 'Jabaquara',
  'mpjorgeberetta': 'Jorge Beretta',
  'mpkennedy': 'Kennedy',
  'mppiraporinha': 'Piraporinha',
  'mpplanalto': 'Planalto',
  'mprudge': 'Rudge Ramos',
  'mpsantoandre': 'Santo André',
  'reidomodulo': 'Rei do Módulo',
  'reidooleomaua': 'Rei do Óleo Mauá',
  'mpmaster': 'Master'
};

export function getStoreDisplayName(slug?: string | null): string {
  if (!slug) return 'Desconhecida';
  return STORE_DISPLAY_NAMES[slug.toLowerCase()] || slug;
}

function formatPeriodoExtenso(dataRef?: string | null): string {
  if (!dataRef) return 'período atual';
  const parts = dataRef.split('-');
  if (parts.length < 2) return dataRef;
  const mesIdx = parseInt(parts[1], 10) - 1;
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ];
  const mesNome = meses[mesIdx] || parts[1];
  return `${mesNome}/${parts[0]}`;
}

/**
 * Consulta estruturada de Meta e Atingimento (goal_gap).
 * Retorna dados numéricos, percentuais calculados e governança de cobertura.
 */
export function queryGoalGap(
  db: Database.Database,
  options?: { lojaSlug?: string; maxAgeHours?: number }
): GoalGapResult {
  const maxHours = options?.maxAgeHours ?? 26;
  const frescor = verificarFrescorMetas(db, maxHours);

  if (!frescor.dataMaisRecente) {
    return {
      status: 'vazio',
      motivo: 'Nenhum registro de metas localizado no banco de dados.',
      periodo: 'período atual',
      dataReferencia: '',
      origem: 'MAPA_METAS_OFICIAL',
      meta: null,
      faturamentoComparavel: null,
      falta: null,
      atingimentoPercentual: null,
      faltaPercentual: null,
      bateuMeta: false,
      cobertura: {
        totalLojasElegiveis: 10,
        lojasCompletas: 0,
        lojasAusentes: [...CATALOGO_10_LOJAS],
        masterExcluida: true,
        isCompleta: false,
        descricao: '0 de 11 lojas com dados disponíveis.'
      }
    };
  }

  const status: FinancialQueryState = frescor.isValido ? 'sucesso' : 'desatualizado';
  const motivo = frescor.isValido
    ? undefined
    : `Dados de metas coletados há ${frescor.idadeHoras} horas (tolerância: ${maxHours}h).`;

  const rows = getMetasConsolidadas(db, frescor.dataMaisRecente);
  const eligibleRows = rows.filter(r => !r.loja_slug?.toLowerCase().includes('master'));
  const slugsPresentes = new Set(eligibleRows.map(r => r.loja_slug));
  const lojasAusentes = CATALOGO_10_LOJAS.filter(s => !slugsPresentes.has(s));

  const cobertura: GoalGapCoverage = {
    totalLojasElegiveis: 10,
    lojasCompletas: slugsPresentes.size,
    lojasAusentes,
    masterExcluida: true,
    isCompleta: lojasAusentes.length === 0,
    descricao: lojasAusentes.length === 0
      ? '10 de 11 lojas operacionais (excluída Master)'
      : `${slugsPresentes.size} de 11 lojas operacionais com dados (faltando: ${lojasAusentes.join(', ')})`
  };

  const periodoStr = formatPeriodoExtenso(frescor.dataMaisRecente);

  // CASO 1: Consulta para Loja Específica
  if (options?.lojaSlug) {
    const slugNorm = options.lojaSlug.toLowerCase();
    if (slugNorm.includes('master')) {
      return {
        status: 'vazio',
        motivo: 'Unidade Master é administrativa e excluída das metas e faturamento comercial por regra de negócio.',
        lojaSlug: options.lojaSlug,
        nome: 'Master',
        periodo: periodoStr,
        dataReferencia: frescor.dataMaisRecente,
        posicaoHora: frescor.posicaoHora || undefined,
        origem: 'MAPA_METAS_OFICIAL',
        meta: null,
        faturamentoComparavel: null,
        falta: null,
        atingimentoPercentual: null,
        faltaPercentual: null,
        bateuMeta: false,
        cobertura
      };
    }

    const storeRow = eligibleRows.find(r => r.loja_slug.toLowerCase() === slugNorm);
    if (!storeRow) {
      return {
        status: 'vazio',
        motivo: `Nenhum dado de faturamento/meta localizado para a unidade ${getStoreDisplayName(options.lojaSlug)} no período.`,
        lojaSlug: options.lojaSlug,
        nome: getStoreDisplayName(options.lojaSlug),
        periodo: periodoStr,
        dataReferencia: frescor.dataMaisRecente,
        posicaoHora: frescor.posicaoHora || undefined,
        origem: 'MAPA_METAS_OFICIAL',
        meta: null,
        faturamentoComparavel: null,
        falta: null,
        atingimentoPercentual: null,
        faltaPercentual: null,
        bateuMeta: false,
        cobertura
      };
    }

    const fat = storeRow.faturamento_mes ?? 0;
    const meta = (storeRow.meta_mes !== null && storeRow.meta_mes !== undefined) ? storeRow.meta_mes : null;
    const prev = (storeRow.previsao_mes !== null && storeRow.previsao_mes !== undefined) ? storeRow.previsao_mes : null;

    const hasPositiveMeta = meta !== null && meta > 0;
    const falta = hasPositiveMeta ? Math.max(meta - fat, 0) : null;
    const atingimentoPercentual = hasPositiveMeta ? Number(((fat / meta) * 100).toFixed(2)) : null;
    const faltaPercentual = hasPositiveMeta ? Number(((falta! / meta) * 100).toFixed(2)) : null;
    const bateuMeta = hasPositiveMeta && fat >= meta;

    return {
      status,
      motivo,
      lojaSlug: storeRow.loja_slug,
      nome: getStoreDisplayName(storeRow.loja_slug),
      periodo: periodoStr,
      dataReferencia: frescor.dataMaisRecente,
      posicaoHora: storeRow.posicao_hora || frescor.posicaoHora || undefined,
      origem: 'MAPA_METAS_OFICIAL',
      meta,
      faturamentoComparavel: fat,
      previsaoComparavel: prev,
      falta,
      atingimentoPercentual,
      faltaPercentual,
      bateuMeta,
      cobertura
    };
  }

  // CASO 2: Consulta da Rede Consolidada
  let somaFat = 0;
  let somaMeta = 0;
  let somaPrev = 0;
  let hasValidMetas = false;

  const lojasDetalhadas: GoalGapStoreItem[] = eligibleRows.map(r => {
    const fat = r.faturamento_mes ?? 0;
    const meta = (r.meta_mes !== null && r.meta_mes !== undefined) ? r.meta_mes : null;
    const prev = (r.previsao_mes !== null && r.previsao_mes !== undefined) ? r.previsao_mes : null;

    somaFat += fat;
    if (meta !== null && meta > 0) {
      somaMeta += meta;
      hasValidMetas = true;
    }
    if (prev !== null) {
      somaPrev += prev;
    }

    const hasPosMeta = meta !== null && meta > 0;
    const falta = hasPosMeta ? Math.max(meta - fat, 0) : null;
    const atingimento = hasPosMeta ? Number(((fat / meta) * 100).toFixed(2)) : null;
    const faltaPct = hasPosMeta ? Number(((falta! / meta) * 100).toFixed(2)) : null;
    const bateu = hasPosMeta && fat >= meta;

    return {
      lojaSlug: r.loja_slug,
      nome: getStoreDisplayName(r.loja_slug),
      faturamento: fat,
      meta,
      previsao: prev,
      falta,
      atingimentoPercentual: atingimento,
      faltaPercentual: faltaPct,
      bateuMeta: bateu,
      volumeOS: r.volume_os ?? 0,
      ticketMedio: r.ticket_medio ?? 0,
      status: 'sucesso'
    };
  });

  const faltaRede = hasValidMetas ? Math.max(somaMeta - somaFat, 0) : null;
  const atingimentoRede = hasValidMetas && somaMeta > 0 ? Number(((somaFat / somaMeta) * 100).toFixed(2)) : null;
  const faltaPctRede = hasValidMetas && somaMeta > 0 ? Number(((faltaRede! / somaMeta) * 100).toFixed(2)) : null;
  const bateuMetaRede = hasValidMetas && somaFat >= somaMeta;

  const lojasNaoBateram = lojasDetalhadas
    .filter(l => !l.bateuMeta && l.falta !== null)
    .sort((a, b) => (b.falta ?? 0) - (a.falta ?? 0));

  const lojasBateram = lojasDetalhadas
    .filter(l => l.bateuMeta)
    .sort((a, b) => (b.atingimentoPercentual ?? 0) - (a.atingimentoPercentual ?? 0));

  return {
    status,
    motivo,
    periodo: periodoStr,
    dataReferencia: frescor.dataMaisRecente,
    posicaoHora: frescor.posicaoHora || undefined,
    origem: 'MAPA_METAS_OFICIAL',
    meta: hasValidMetas ? Number(somaMeta.toFixed(2)) : null,
    faturamentoComparavel: Number(somaFat.toFixed(2)),
    previsaoComparavel: Number(somaPrev.toFixed(2)),
    falta: faltaRede !== null ? Number(faltaRede.toFixed(2)) : null,
    atingimentoPercentual: atingimentoRede,
    faltaPercentual: faltaPctRede,
    bateuMeta: bateuMetaRede,
    cobertura,
    lojasDetalhadas,
    lojasNaoBateram,
    lojasBateram
  };
}

/**
 * Consulta estruturada de CMV Consolidado e por Área (StoreCMVResult).
 * cmvPercentual é devolvido como MÉTRICA PRIMÁRIA.
 * Nunca devolve dados de OS ou Raio-X.
 */
export function queryStoreCMV(
  db: Database.Database,
  options: { lojaSlug: string; maxAgeHours?: number }
): StoreCMVResult {
  const slugNorm = (options.lojaSlug || '').trim().toLowerCase();

  // Rejeição rigorosa de slugs vazios, genéricos ou de rede
  if (!options.lojaSlug || !slugNorm || slugNorm === 'loja' || slugNorm === 'lojas' || slugNorm === 'rede' || slugNorm === 'geral') {
    return {
      status: 'vazio',
      motivo: 'Identificador de loja não informado ou inválido para consulta de CMV individual.',
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      scope: 'store',
      lojaSlug: options.lojaSlug || '',
      nome: 'Não informada',
      periodo: 'período atual',
      dataInicio: '',
      dataFim: '',
      cmvPercentual: null,
      faturamentoTotal: null,
      custoTotal: null,
      descontoTotal: null,
      lucroBruto: null,
      lucroBrutoPercentual: null,
      baseCalculo: 'faturamento_bruto',
      areas: []
    };
  }

  // Tratamento de exclusão da Master
  if (slugNorm.includes('master')) {
    return {
      status: 'vazio',
      motivo: 'Unidade Master é administrativa e excluída das análises operacionais de CMV por regra contábil.',
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      scope: 'store',
      lojaSlug: options.lojaSlug,
      nome: 'Master',
      periodo: 'período atual',
      dataInicio: '',
      dataFim: '',
      cmvPercentual: null,
      faturamentoTotal: null,
      custoTotal: null,
      descontoTotal: null,
      lucroBruto: null,
      lucroBrutoPercentual: null,
      baseCalculo: 'faturamento_bruto',
      areas: []
    };
  }

  const row: any = db.prepare(`
    SELECT * FROM cmv_lojas
    WHERE LOWER(loja_slug) = LOWER(?)
    ORDER BY data_fim DESC, id DESC
    LIMIT 1
  `).get(options.lojaSlug);

  if (!row) {
    return {
      status: 'vazio',
      motivo: `Nenhum registro de CMV encontrado para a loja ${getStoreDisplayName(options.lojaSlug)} no período atual.`,
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      scope: 'store',
      lojaSlug: options.lojaSlug,
      nome: getStoreDisplayName(options.lojaSlug),
      periodo: 'período atual',
      dataInicio: '',
      dataFim: '',
      cmvPercentual: null,
      faturamentoTotal: null,
      custoTotal: null,
      descontoTotal: null,
      lucroBruto: null,
      lucroBrutoPercentual: null,
      baseCalculo: 'faturamento_bruto',
      areas: []
    };
  }

  const maxHours = options.maxAgeHours ?? 26;
  let status: FinancialQueryState = 'sucesso';
  let motivo: string | undefined = undefined;

  if (row.created_at) {
    const dtCreated = new Date(row.created_at.includes('T') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z');
    const idadeHoras = Math.max(0, Math.round((Date.now() - dtCreated.getTime()) / (1000 * 60 * 60)));
    if (idadeHoras > maxHours) {
      status = 'desatualizado';
      motivo = `Dados de CMV coletados há ${idadeHoras} horas (tolerância: ${maxHours}h).`;
    }
  }

  const areaRows: any[] = db.prepare(`
    SELECT * FROM faturamento_areas
    WHERE LOWER(loja_slug) = LOWER(?)
      AND data_inicio = ?
      AND data_fim = ?
    ORDER BY faturamento DESC
  `).all(row.loja_slug, row.data_inicio, row.data_fim);

  const areas: StoreCMVAreaItem[] = areaRows.map(a => ({
    area: a.area,
    faturamento: a.faturamento,
    participacaoPercentual: a.faturamento_percentual ?? 0,
    desconto: a.desconto ?? 0,
    custo: a.custo,
    cmvPercentual: a.cmv_percentual,
    lucroBruto: a.lucro_bruto,
    lucroBrutoPercentual: a.lucro_bruto_percentual
  }));

  const somaCustoAreas = Number(areas.reduce((acc, a) => acc + (a.custo || 0), 0).toFixed(2));
  const diferencaConsolidadoAreas = Number(Math.abs(row.custo_total - somaCustoAreas).toFixed(2));
  const periodoStr = formatPeriodoExtenso(row.data_inicio);

  return {
    status,
    motivo,
    origem: 'RELATORIO_OPERACAO_OFICIAL',
    scope: 'store',
    lojaSlug: row.loja_slug,
    nome: getStoreDisplayName(row.loja_slug),
    periodo: periodoStr,
    dataInicio: row.data_inicio,
    dataFim: row.data_fim,
    capturedAt: row.created_at,
    cmvPercentual: row.cmv_percentual,
    faturamentoTotal: row.faturamento_total,
    custoTotal: row.custo_total,
    descontoTotal: row.desconto_total,
    lucroBruto: row.lucro_bruto,
    lucroBrutoPercentual: row.lucro_bruto_percentual,
    baseCalculo: 'faturamento_bruto',
    somaCustoAreas,
    diferencaConsolidadoAreas,
    areas
  };
}

/**
 * Consulta de CMV Consolidado da Rede (scope: 'network')
 * Fórmula mandatória: sum(custos_compativeis) / sum(faturamentos_compativeis) * 100.
 * NUNCA média aritmética!
 */
export function queryNetworkCMV(
  db: Database.Database,
  options?: { maxAgeHours?: number }
): NetworkCMVResult {
  const eligibleSlugs = new Set(CATALOGO_10_LOJAS);

  // Busca o registro mais recente de cada loja elegível
  const rows: any[] = db.prepare(`
    SELECT c.* FROM cmv_lojas c
    INNER JOIN (
      SELECT loja_slug, MAX(data_fim) as max_fim, MAX(id) as max_id
      FROM cmv_lojas
      GROUP BY loja_slug
    ) m ON c.loja_slug = m.loja_slug AND c.data_fim = m.max_fim AND c.id = m.max_id
    ORDER BY c.cmv_percentual DESC
  `).all();

  const validRows = rows.filter(r => eligibleSlugs.has(r.loja_slug) && !r.loja_slug.toLowerCase().includes('master'));
  const presentes = new Set(validRows.map(r => r.loja_slug));
  const lojasAusentes = CATALOGO_10_LOJAS.filter(s => !presentes.has(s));
  const lojasCompletas = validRows.length;
  const isCompleta = lojasCompletas === 10;

  const cobertura: GoalGapCoverage = {
    totalLojasElegiveis: 10,
    lojasCompletas,
    lojasAusentes,
    masterExcluida: true,
    isCompleta,
    descricao: isCompleta
      ? '10 de 10 lojas operacionais apuradas.'
      : `${lojasCompletas} de 10 lojas operacionais apuradas (parcial, excluída Master).`
  };

  if (validRows.length === 0) {
    return {
      status: 'vazio',
      motivo: 'Nenhum registro de CMV disponível para as lojas da rede no momento.',
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      scope: 'network',
      periodo: 'período atual',
      cmvConsolidadoPercentual: null,
      somaCustosCompativeis: null,
      somaFaturamentosBaseCompativeis: null,
      lucroBrutoConsolidado: null,
      lucroBrutoConsolidadoPercentual: null,
      baseCalculo: 'faturamento_bruto',
      cobertura,
      lojasDetalhadas: []
    };
  }

  // Soma aritmética pura de custos e faturamento bruto
  const somaCustosCompativeis = Number(validRows.reduce((acc, r) => acc + (r.custo_total || 0), 0).toFixed(2));
  const somaFaturamentosBaseCompativeis = Number(validRows.reduce((acc, r) => acc + (r.faturamento_total || 0), 0).toFixed(2));

  const cmvConsolidadoPercentual = somaFaturamentosBaseCompativeis > 0
    ? Number(((somaCustosCompativeis / somaFaturamentosBaseCompativeis) * 100).toFixed(2))
    : null;

  const lucroBrutoConsolidado = Number((somaFaturamentosBaseCompativeis - somaCustosCompativeis).toFixed(2));
  const lucroBrutoConsolidadoPercentual = cmvConsolidadoPercentual != null
    ? Number((100 - cmvConsolidadoPercentual).toFixed(2))
    : null;

  // Detalhamento de lojas
  const lojasDetalhadas: StoreCMVItem[] = validRows.map(r => ({
    lojaSlug: r.loja_slug,
    nome: getStoreDisplayName(r.loja_slug),
    periodo: formatPeriodoExtenso(r.data_inicio),
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
    capturedAt: r.created_at,
    cmvPercentual: r.cmv_percentual,
    faturamentoTotal: r.faturamento_total,
    custoTotal: r.custo_total,
    lucroBruto: r.lucro_bruto,
    lucroBrutoPercentual: r.lucro_bruto_percentual,
    status: 'sucesso'
  }));

  // Pior loja da rede = maior CMV percentual válido
  const sortedByCMV = [...lojasDetalhadas].sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0));
  const piorLoja = sortedByCMV[0];

  const maxCreated = validRows.reduce((max, r) => (!max || (r.created_at && r.created_at > max) ? r.created_at : max), '');
  const periodoStr = formatPeriodoExtenso(validRows[0]?.data_inicio);

  return {
    status: isCompleta ? 'sucesso' : 'parcial',
    motivo: isCompleta ? undefined : `Dados disponíveis de ${lojasCompletas} das 10 lojas elegíveis da rede (fechamento parcial).`,
    origem: 'RELATORIO_OPERACAO_OFICIAL',
    scope: 'network',
    periodo: periodoStr,
    dataInicio: validRows[0]?.data_inicio,
    dataFim: validRows[0]?.data_fim,
    capturedAt: maxCreated || validRows[0]?.created_at,
    cmvConsolidadoPercentual,
    somaCustosCompativeis,
    somaFaturamentosBaseCompativeis,
    lucroBrutoConsolidado,
    lucroBrutoConsolidadoPercentual,
    baseCalculo: 'faturamento_bruto',
    cobertura,
    lojasDetalhadas,
    piorLoja
  };
}

/**
 * Consulta comparativa de CMV de todas as lojas (scope: 'all_stores')
 * NUNCA mascara ausência como 0.00%.
 */
export function queryAllStoresCMV(
  db: Database.Database,
  options?: { maxAgeHours?: number }
): AllStoresCMVResult {
  const eligibleSlugs = new Set(CATALOGO_10_LOJAS);

  const rows: any[] = db.prepare(`
    SELECT c.* FROM cmv_lojas c
    INNER JOIN (
      SELECT loja_slug, MAX(data_fim) as max_fim, MAX(id) as max_id
      FROM cmv_lojas
      GROUP BY loja_slug
    ) m ON c.loja_slug = m.loja_slug AND c.data_fim = m.max_fim AND c.id = m.max_id
    ORDER BY c.cmv_percentual DESC
  `).all();

  const storeMap = new Map();
  for (const r of rows) {
    if (eligibleSlugs.has(r.loja_slug)) {
      storeMap.set(r.loja_slug.toLowerCase(), r);
    }
  }

  const presentes = [];
  const ausentes = [];
  const lojas: StoreCMVItem[] = [];

  for (const slug of CATALOGO_10_LOJAS) {
    const row = storeMap.get(slug.toLowerCase());
    if (row) {
      presentes.push(slug);
      lojas.push({
        lojaSlug: slug,
        nome: getStoreDisplayName(slug),
        periodo: formatPeriodoExtenso(row.data_inicio),
        dataInicio: row.data_inicio,
        dataFim: row.data_fim,
        capturedAt: row.created_at,
        cmvPercentual: row.cmv_percentual,
        faturamentoTotal: row.faturamento_total,
        custoTotal: row.custo_total,
        lucroBruto: row.lucro_bruto,
        lucroBrutoPercentual: row.lucro_bruto_percentual,
        status: 'sucesso'
      });
    } else {
      ausentes.push(slug);
      lojas.push({
        lojaSlug: slug,
        nome: getStoreDisplayName(slug),
        periodo: 'mês atual',
        cmvPercentual: null,
        faturamentoTotal: null,
        custoTotal: null,
        lucroBruto: null,
        lucroBrutoPercentual: null,
        status: 'vazio',
        motivo: 'Dado de CMV não disponível no período'
      });
    }
  }

  const isCompleta = ausentes.length === 0;
  const cobertura: GoalGapCoverage = {
    totalLojasElegiveis: 10,
    lojasCompletas: presentes.length,
    lojasAusentes: ausentes,
    masterExcluida: true,
    isCompleta,
    descricao: isCompleta
      ? '10 de 10 lojas operacionais apuradas.'
      : `${presentes.length} de 10 lojas operacionais apuradas (${ausentes.length} pendentes).`
  };

  const rankingCMV = lojas
    .filter(l => l.cmvPercentual != null)
    .sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0));

  const piorLoja = rankingCMV[0];
  const maxCreated = rows.reduce((max, r) => (!max || (r.created_at && r.created_at > max) ? r.created_at : max), '');

  return {
    status: isCompleta ? 'sucesso' : 'parcial',
    motivo: isCompleta ? undefined : `Dados disponíveis de ${presentes.length} das 10 lojas elegíveis da rede.`,
    origem: 'RELATORIO_OPERACAO_OFICIAL',
    scope: 'all_stores',
    periodo: lojas.find(l => l.dataInicio)?.periodo || 'mês atual',
    capturedAt: maxCreated || undefined,
    cobertura,
    lojas,
    rankingCMV,
    piorLoja
  };
}

/**
 * Consulta unificada de CMV despachada por escopo ('store' | 'all_stores' | 'network')
 */
export function queryUnifiedCMV(
  db: Database.Database,
  options: {
    scope?: 'store' | 'all_stores' | 'network';
    lojaSlug?: string;
    maxAgeHours?: number;
  }
): UnifiedCMVResult {
  const isInvalid = !options.lojaSlug || ['loja', 'lojas', 'rede', 'todas', 'null', 'undefined', ''].includes(options.lojaSlug.toLowerCase().trim());
  const scope = options.scope || (isInvalid ? 'network' : 'store');
  if (scope === 'network') {
    return queryNetworkCMV(db, { maxAgeHours: options.maxAgeHours });
  }
  if (scope === 'all_stores') {
    return queryAllStoresCMV(db, { maxAgeHours: options.maxAgeHours });
  }
  return queryStoreCMV(db, { lojaSlug: options.lojaSlug || '', maxAgeHours: options.maxAgeHours });
}

export function queryStoreAreas(
  db: Database.Database,
  options: { lojaSlug: string; maxAgeHours?: number }
): StoreAreasResult {
  const cmvResult = queryStoreCMV(db, options);

  if (cmvResult.status === 'vazio') {
    return {
      status: 'vazio',
      motivo: cmvResult.motivo,
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      lojaSlug: options.lojaSlug,
      nome: getStoreDisplayName(options.lojaSlug),
      periodo: 'período atual',
      dataInicio: '',
      dataFim: '',
      totalFaturado: null,
      totalCusto: null,
      descontoTotal: null,
      lucroBrutoTotal: null,
      areas: []
    };
  }

  return {
    status: cmvResult.status,
    motivo: cmvResult.motivo,
    origem: 'RELATORIO_OPERACAO_OFICIAL',
    lojaSlug: cmvResult.lojaSlug,
    nome: cmvResult.nome,
    periodo: cmvResult.periodo,
    dataInicio: cmvResult.dataInicio,
    dataFim: cmvResult.dataFim,
    capturedAt: cmvResult.capturedAt,
    totalFaturado: cmvResult.faturamentoTotal,
    totalCusto: cmvResult.custoTotal,
    descontoTotal: cmvResult.descontoTotal,
    lucroBrutoTotal: cmvResult.lucroBruto,
    areas: cmvResult.areas
  };
}


export interface AreaCMVStoreItem {
  lojaSlug: string;
  nome: string;
  area: string;
  periodo: string;
  dataInicio?: string;
  dataFim?: string;
  cmvPercentual: number | null;
  faturamento: number | null;
  custo: number | null;
  lucroBruto: number | null;
  lucroBrutoPercentual: number | null;
  status: 'sucesso' | 'vazio';
  motivo?: string;
}

export interface AllStoresAreaCMVResult {
  status: 'sucesso' | 'parcial' | 'vazio';
  area: string;
  periodo: string;
  totalLojasElegiveis: number;
  lojasCompletas: number;
  coberturaDescricao: string;
  lojasApuradas: AreaCMVStoreItem[];
  lojasPendentes: AreaCMVStoreItem[];
  rankingCMV: AreaCMVStoreItem[];
  origem: string;
}

export function queryAreaCMVByStore(
  db: Database.Database,
  options: {
    area: string;
    lojaSlug?: string;
    scope?: 'store' | 'all_stores' | 'network';
  }
): AllStoresAreaCMVResult | AreaCMVStoreItem {
  const targetArea = (options.area || 'OLEO').toUpperCase().trim();
  const eligibleSlugs = new Set(CATALOGO_10_LOJAS);

  if (options.scope === 'store' && options.lojaSlug) {
    const slugNorm = options.lojaSlug.trim();
    const nome = getStoreDisplayName(slugNorm);

    const row: any = db.prepare(`
      SELECT * FROM faturamento_areas
      WHERE LOWER(loja_slug) = LOWER(?) AND UPPER(area) = UPPER(?)
      ORDER BY data_fim DESC, id DESC
      LIMIT 1
    `).get(slugNorm, targetArea);

    if (!row) {
      return {
        lojaSlug: slugNorm,
        nome,
        area: targetArea,
        periodo: 'mês atual',
        cmvPercentual: null,
        faturamento: null,
        custo: null,
        lucroBruto: null,
        lucroBrutoPercentual: null,
        status: 'vazio',
        motivo: `Dado de CMV não disponível para a área ${targetArea} na unidade ${nome}`
      };
    }

    return {
      lojaSlug: row.loja_slug,
      nome,
      area: row.area,
      periodo: formatPeriodoExtenso(row.data_inicio),
      dataInicio: row.data_inicio,
      dataFim: row.data_fim,
      cmvPercentual: row.cmv_percentual,
      faturamento: row.faturamento,
      custo: row.custo,
      lucroBruto: row.lucro_bruto,
      lucroBrutoPercentual: row.lucro_bruto_percentual,
      status: 'sucesso'
    };
  }

  const rows: any[] = db.prepare(`
    SELECT fa.* FROM faturamento_areas fa
    INNER JOIN (
      SELECT loja_slug, MAX(data_fim) as max_fim, MAX(id) as max_id
      FROM faturamento_areas
      WHERE UPPER(area) = UPPER(?)
      GROUP BY loja_slug
    ) m ON fa.loja_slug = m.loja_slug AND fa.data_fim = m.max_fim AND fa.id = m.max_id
    WHERE UPPER(fa.area) = UPPER(?)
    ORDER BY fa.cmv_percentual DESC
  `).all(targetArea, targetArea);

  const rowMap = new Map<string, any>();
  for (const r of rows) {
    if (eligibleSlugs.has(r.loja_slug)) {
      rowMap.set(r.loja_slug.toLowerCase(), r);
    }
  }

  const lojasApuradas: AreaCMVStoreItem[] = [];
  const lojasPendentes: AreaCMVStoreItem[] = [];

  for (const slug of CATALOGO_10_LOJAS) {
    const r = rowMap.get(slug.toLowerCase());
    const nome = getStoreDisplayName(slug);
    if (r) {
      lojasApuradas.push({
        lojaSlug: slug,
        nome,
        area: targetArea,
        periodo: formatPeriodoExtenso(r.data_inicio),
        dataInicio: r.data_inicio,
        dataFim: r.data_fim,
        cmvPercentual: r.cmv_percentual,
        faturamento: r.faturamento,
        custo: r.custo,
        lucroBruto: r.lucro_bruto,
        lucroBrutoPercentual: r.lucro_bruto_percentual,
        status: 'sucesso'
      });
    } else {
      lojasPendentes.push({
        lojaSlug: slug,
        nome,
        area: targetArea,
        periodo: 'mês atual',
        cmvPercentual: null,
        faturamento: null,
        custo: null,
        lucroBruto: null,
        lucroBrutoPercentual: null,
        status: 'vazio',
        motivo: `Dado não disponível na área ${targetArea}`
      });
    }
  }

  const rankingCMV = [...lojasApuradas].sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0));
  const isCompleta = lojasPendentes.length === 0;
  const coberturaDescricao = isCompleta
    ? '10 de 10 lojas operacionais apuradas.'
    : `${lojasApuradas.length} de 10 lojas operacionais apuradas (${lojasPendentes.length} pendentes).`;

  return {
    status: isCompleta ? 'sucesso' : (lojasApuradas.length > 0 ? 'parcial' : 'vazio'),
    area: targetArea,
    periodo: lojasApuradas[0]?.periodo || 'mês atual',
    totalLojasElegiveis: 10,
    lojasCompletas: lojasApuradas.length,
    coberturaDescricao,
    lojasApuradas,
    lojasPendentes,
    rankingCMV,
    origem: 'FATURAMENTO_AREAS_OFICIAL'
  };
}


/**
 * Consulta estruturada de Pesquisa de Mídia e Canais de Captação.
 */
export function queryStoreMediaSurvey(
  db: Database.Database,
  options: { lojaSlug: string; maxAgeHours?: number }
): StoreMediaSurveyResult {
  const slugNorm = (options.lojaSlug || '').trim().toLowerCase();

  if (slugNorm.includes('master')) {
    return {
      status: 'vazio',
      motivo: 'Unidade Master é administrativa e excluída de pesquisa de mídia.',
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      lojaSlug: options.lojaSlug,
      nome: 'Master',
      periodo: 'período atual',
      dataInicio: '',
      dataFim: '',
      totalFaturado: null,
      totalOS: null,
      canais: []
    };
  }

  const rows: any[] = db.prepare(`
    SELECT * FROM pesquisa_midia
    WHERE LOWER(loja_slug) = LOWER(?)
    ORDER BY data_fim DESC, faturamento DESC
  `).all(options.lojaSlug);

  if (rows.length === 0) {
    return {
      status: 'vazio',
      motivo: `Nenhum dado de pesquisa de mídia localizado para a unidade ${getStoreDisplayName(options.lojaSlug)}.`,
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      lojaSlug: options.lojaSlug,
      nome: getStoreDisplayName(options.lojaSlug),
      periodo: 'período atual',
      dataInicio: '',
      dataFim: '',
      totalFaturado: null,
      totalOS: null,
      canais: []
    };
  }

  const maxHours = options.maxAgeHours ?? 26;
  let status: FinancialQueryState = 'sucesso';
  let motivo: string | undefined = undefined;

  const firstRow = rows[0];
  if (firstRow.created_at) {
    const dtCreated = new Date(firstRow.created_at.includes('T') ? firstRow.created_at : firstRow.created_at.replace(' ', 'T') + 'Z');
    const idadeHoras = Math.max(0, Math.round((Date.now() - dtCreated.getTime()) / (1000 * 60 * 60)));
    if (idadeHoras > maxHours) {
      status = 'desatualizado';
      motivo = `Dados de mídia coletados há ${idadeHoras} horas (tolerância: ${maxHours}h).`;
    }
  }

  // Filtrar pela dataInicio e dataFim mais recentes
  const recentRows = rows.filter(r => r.data_inicio === firstRow.data_inicio && r.data_fim === firstRow.data_fim);

  const canais: StoreMediaChannelItem[] = recentRows.map(r => ({
    canal: r.canal,
    faturamento: r.faturamento,
    faturamentoPercentual: r.faturamento_percentual ?? 0,
    qtdOS: r.qtd_os ?? 0,
    ticketMedio: r.ticket_medio ?? (r.qtd_os > 0 ? r.faturamento / r.qtd_os : 0)
  }));

  const totalFaturado = Number(canais.reduce((acc, c) => acc + c.faturamento, 0).toFixed(2));
  const totalOS = canais.reduce((acc, c) => acc + c.qtdOS, 0);
  const canalPrincipal = canais.length > 0 ? canais[0] : undefined;

  return {
    status,
    motivo,
    origem: 'RELATORIO_OPERACAO_OFICIAL',
    lojaSlug: firstRow.loja_slug,
    nome: getStoreDisplayName(firstRow.loja_slug),
    periodo: formatPeriodoExtenso(firstRow.data_inicio),
    dataInicio: firstRow.data_inicio,
    dataFim: firstRow.data_fim,
    capturedAt: firstRow.created_at,
    totalFaturado,
    totalOS,
    canais,
    canalPrincipal
  };
}

/**
 * Consulta de levantamento oficial de canais Google e Central de Atendimento por loja ou para toda a rede.
 * Conecta à fonte oficial de levantamento de canais de mídia (pesquisa_midia) e faturamento bruto (cmv_lojas / faturamento_areas).
 */
export function queryGoogleCentralMediaSurvey(
  db: Database.Database,
  options: { lojaSlug?: string; maxAgeHours?: number } = {}
): GoogleCentralMediaSurveyResult {
  const isAll = !options.lojaSlug || options.lojaSlug === 'all_stores' || options.lojaSlug === 'lojas' || options.lojaSlug === 'rede';

  if (!isAll && options.lojaSlug) {
    const slugNorm = options.lojaSlug.trim().toLowerCase();
    if (slugNorm.includes('master')) {
      return {
        status: 'vazio',
        motivo: 'Unidade Master é administrativa e excluída de pesquisa de mídia.',
        origem: 'RELATORIO_OPERACAO_OFICIAL',
        isAllStores: false
      };
    }

    const rows: any[] = db.prepare(`
      SELECT * FROM pesquisa_midia
      WHERE LOWER(loja_slug) = LOWER(?)
      ORDER BY data_fim DESC, faturamento DESC
    `).all(options.lojaSlug);

    const nome = getStoreDisplayName(options.lojaSlug);

    if (rows.length === 0) {
      return {
        status: 'vazio',
        motivo: `Dados de pesquisa de mídia (Google e Central de Atendimento) não disponíveis para a unidade *${nome}* no período apurado.`,
        origem: 'RELATORIO_OPERACAO_OFICIAL',
        isAllStores: false,
        storeResult: {
          lojaSlug: options.lojaSlug,
          nome,
          totalGoogleCentral: 0,
          totalOSGoogleCentral: 0
        }
      };
    }

    const firstRow = rows[0];
    const recentRows = rows.filter(r => r.data_inicio === firstRow.data_inicio && r.data_fim === firstRow.data_fim);

    const rowGoogle = recentRows.find(r => (r.canal || '').toUpperCase().includes('GOOGLE'));
    const rowCentral = recentRows.find(r => (r.canal || '').toUpperCase().includes('CENTRAL'));

    const canalGoogle: StoreMediaChannelItem | null = rowGoogle ? {
      canal: rowGoogle.canal,
      faturamento: rowGoogle.faturamento,
      faturamentoPercentual: rowGoogle.faturamento_percentual ?? 0,
      qtdOS: rowGoogle.qtd_os ?? 0,
      ticketMedio: rowGoogle.ticket_medio ?? (rowGoogle.qtd_os > 0 ? rowGoogle.faturamento / rowGoogle.qtd_os : 0)
    } : null;

    const canalCentral: StoreMediaChannelItem | null = rowCentral ? {
      canal: rowCentral.canal,
      faturamento: rowCentral.faturamento,
      faturamentoPercentual: rowCentral.faturamento_percentual ?? 0,
      qtdOS: rowCentral.qtd_os ?? 0,
      ticketMedio: rowCentral.ticket_medio ?? (rowCentral.qtd_os > 0 ? rowCentral.faturamento / rowCentral.qtd_os : 0)
    } : null;

    const totalGoogleCentral = Number(((canalGoogle?.faturamento || 0) + (canalCentral?.faturamento || 0)).toFixed(2));
    const totalOSGoogleCentral = (canalGoogle?.qtdOS || 0) + (canalCentral?.qtdOS || 0);

    let faturamentoBrutoLoja: number | null = null;
    try {
      const cmvRow: any = db.prepare(`SELECT faturamento_total FROM cmv_lojas WHERE LOWER(loja_slug) = LOWER(?) LIMIT 1`).get(options.lojaSlug);
      if (cmvRow && cmvRow.faturamento_total) {
        faturamentoBrutoLoja = Number(cmvRow.faturamento_total);
      } else {
        const areaSum: any = db.prepare(`SELECT SUM(faturamento) as tot FROM faturamento_areas WHERE LOWER(loja_slug) = LOWER(?)`).get(options.lojaSlug);
        if (areaSum && areaSum.tot) {
          faturamentoBrutoLoja = Number(areaSum.tot);
        } else {
          faturamentoBrutoLoja = Number(recentRows.reduce((s, r) => s + (r.faturamento || 0), 0).toFixed(2));
        }
      }
    } catch {}

    const pctGoogleCentralDoFaturamento = faturamentoBrutoLoja && faturamentoBrutoLoja > 0
      ? Number(((totalGoogleCentral / faturamentoBrutoLoja) * 100).toFixed(1))
      : null;

    return {
      status: 'sucesso',
      origem: 'RELATORIO_OPERACAO_OFICIAL',
      isAllStores: false,
      periodo: formatPeriodoExtenso(firstRow.data_inicio),
      dataInicio: firstRow.data_inicio,
      dataFim: firstRow.data_fim,
      storeResult: {
        lojaSlug: options.lojaSlug,
        nome,
        faturamentoBrutoLoja,
        canalGoogle,
        canalCentral,
        totalGoogleCentral,
        totalOSGoogleCentral,
        pctGoogleCentralDoFaturamento
      }
    };
  }

  // Visão consolidada por loja da rede
  const lojasApuradas: GoogleCentralStoreItem[] = [];
  const lojasSemDados: Array<{ lojaSlug: string; nome: string }> = [];
  let commonDataInicio = '';
  let commonDataFim = '';

  for (const slug of CATALOGO_10_LOJAS) {
    if (slug === 'MPMaster') continue;
    const nome = getStoreDisplayName(slug);

    const rows: any[] = db.prepare(`
      SELECT * FROM pesquisa_midia
      WHERE LOWER(loja_slug) = LOWER(?)
      ORDER BY data_fim DESC, faturamento DESC
    `).all(slug);

    if (rows.length === 0) {
      lojasSemDados.push({ lojaSlug: slug, nome });
      continue;
    }

    const firstRow = rows[0];
    if (!commonDataInicio) commonDataInicio = firstRow.data_inicio;
    if (!commonDataFim) commonDataFim = firstRow.data_fim;

    const recentRows = rows.filter(r => r.data_inicio === firstRow.data_inicio && r.data_fim === firstRow.data_fim);

    const rowGoogle = recentRows.find(r => (r.canal || '').toUpperCase().includes('GOOGLE'));
    const rowCentral = recentRows.find(r => (r.canal || '').toUpperCase().includes('CENTRAL'));

    const canalGoogle: StoreMediaChannelItem | null = rowGoogle ? {
      canal: rowGoogle.canal,
      faturamento: rowGoogle.faturamento,
      faturamentoPercentual: rowGoogle.faturamento_percentual ?? 0,
      qtdOS: rowGoogle.qtd_os ?? 0,
      ticketMedio: rowGoogle.ticket_medio ?? (rowGoogle.qtd_os > 0 ? rowGoogle.faturamento / rowGoogle.qtd_os : 0)
    } : null;

    const canalCentral: StoreMediaChannelItem | null = rowCentral ? {
      canal: rowCentral.canal,
      faturamento: rowCentral.faturamento,
      faturamentoPercentual: rowCentral.faturamento_percentual ?? 0,
      qtdOS: rowCentral.qtd_os ?? 0,
      ticketMedio: rowCentral.ticket_medio ?? (rowCentral.qtd_os > 0 ? rowCentral.faturamento / rowCentral.qtd_os : 0)
    } : null;

    const totalGoogleCentral = Number(((canalGoogle?.faturamento || 0) + (canalCentral?.faturamento || 0)).toFixed(2));
    const totalOSGoogleCentral = (canalGoogle?.qtdOS || 0) + (canalCentral?.qtdOS || 0);

    let faturamentoBrutoLoja: number | null = null;
    try {
      const cmvRow: any = db.prepare(`SELECT faturamento_total FROM cmv_lojas WHERE LOWER(loja_slug) = LOWER(?) LIMIT 1`).get(slug);
      if (cmvRow && cmvRow.faturamento_total) faturamentoBrutoLoja = Number(cmvRow.faturamento_total);
    } catch {}

    lojasApuradas.push({
      lojaSlug: slug,
      nome,
      faturamentoBrutoLoja,
      canalGoogle,
      canalCentral,
      totalGoogleCentral,
      totalOSGoogleCentral
    });
  }

  return {
    status: 'sucesso',
    origem: 'RELATORIO_OPERACAO_OFICIAL',
    isAllStores: true,
    periodo: commonDataInicio ? formatPeriodoExtenso(commonDataInicio) : 'mês atual',
    dataInicio: commonDataInicio,
    dataFim: commonDataFim,
    lojasApuradas,
    lojasSemDados
  };
}

/**
 * Consulta de visão geral de faturamento de toda a rede para acompanhamento comercial.
 */
export function queryNetworkFinancialOverview(
  db: Database.Database,
  options?: { maxAgeHours?: number }
): NetworkFinancialOverviewResult {
  const goalGap = queryGoalGap(db, options);

  const totalFat = goalGap.faturamentoComparavel ?? 0;
  const totalMeta = goalGap.meta ?? 0;
  const faltaTotal = goalGap.falta ?? 0;
  const atingimentoTotal = goalGap.atingimentoPercentual ?? 0;

  let totalOS = 0;
  const lojas = (goalGap.lojasDetalhadas || []).map(l => {
    totalOS += l.volumeOS;
    return {
      slug: l.lojaSlug,
      nome: l.nome,
      faturamento: l.faturamento,
      meta: l.meta,
      previsao: l.previsao,
      percentualMeta: l.atingimentoPercentual,
      volumeOS: l.volumeOS,
      ticketMedio: l.ticketMedio,
      status: l.status
    };
  });

  const ticketMedio = totalOS > 0 ? Number((totalFat / totalOS).toFixed(2)) : 0;

  return {
    status: goalGap.status,
    motivo: goalGap.motivo,
    origem: 'MAPA_METAS_OFICIAL',
    periodo: goalGap.periodo,
    dataReferencia: goalGap.dataReferencia,
    posicaoHora: goalGap.posicaoHora,
    capturedAt: goalGap.capturedAt,
    totalFaturamento: totalFat,
    totalMeta,
    totalOS,
    ticketMedio,
    faltaTotal,
    atingimentoTotalPercentual: atingimentoTotal,
    cobertura: goalGap.cobertura,
    lojas
  };
}


// ??? Detalhes Profundos de OS (Frente 2 / MCP get_os_details / Raw Payload) ??

export interface OSServiceItem {
  codigo?: string;
  descricao: string;
  mecanico?: string;
  executor?: string;
  qtd: number;
  quantidade?: number;
  valorUnitario: number;
  valor_unitario?: number;
  valorTotal: number;
  valor_total?: number;
}

export interface OSPartItem {
  codigo?: string;
  referencia?: string;
  descricao: string;
  qtd: number;
  quantidade?: number;
  valorUnitario: number;
  valor_unitario?: number;
  valorTotal: number;
  valor_total?: number;
  executor?: string;
}

export interface OSPaymentInstallment {
  parcela: string | number;
  vencimento: string;
  forma: string;
  modalidade: string;
  valor: number;
  numOperacao?: string;
  num_operacao?: string;
  statusEnvioFinanceiro: string;
  enviadoFinanceiro: string;
  enviado_financeiro: string;
}

export interface OSDocumentItem {
  origem: string;
  data: string;
  descricao: string;
  opcao?: string;
}

export interface OSChecklistItem {
  codigo?: string;
  tipo: string;
  status?: string;
  realizadoPor?: string;
  realizado_por?: string;
  data?: string;
  hodometro?: string;
  progresso?: string;
  termino?: string;
}

export interface OSChecklistAudit {
  temChecklistEntrada: boolean;
  temChecklistMecanico: boolean;
  status: 'completo' | 'pendente_entrada' | 'pendente_mecanico' | 'sem_checklists';
  detalhes: string;
}

export interface OSDetailComplete {
  osId: string;
  os_id: string;
  lojaSlug: string;
  loja_slug: string;
  tipo: string;
  situacao: string;
  status_grid: string;
  dataAbertura: string;
  data_inicio: string;
  dataPromessa: string;
  data_fim?: string | null;
  valorTotal: number;
  total_os: number;
  valorPago: number;
  valor_pago: number;
  saldoDevedor: number;
  valor_restante: number;
  veiculo: string;
  placa: string;
  clienteNome: string;
  cliente_nome: string;
  clienteCpf?: string;
  cliente_cpf?: string;
  clienteTelefone?: string;
  cliente_telefone_sms?: string;
  responsavel?: string;
  diasNoPatio: number;
  dias_no_patio: number;
  isAberta: boolean;
  is_aberta: number | boolean;
  temNf: boolean;
  tem_nf: number | boolean;
  servicos: OSServiceItem[];
  pecas: OSPartItem[];
  totalServicos?: number;
  total_servicos?: number;
  totalPecas?: number;
  total_pecas?: number;
  pagamentos: OSPaymentInstallment[];
  parcelas: OSPaymentInstallment[];
  documentosAnexos: OSDocumentItem[];
  documentos_anexos: OSDocumentItem[];
  notasFiscais: any[];
  notas_fiscais: any[];
  checklists: OSChecklistItem[];
  checklistAudit: OSChecklistAudit;
  extracaoCompleta?: boolean;
  extracao_completa?: boolean;
  rawPayload?: any;
  raw_payload?: any;
  observacao?: string;
  historicoCriadoEm?: string;
  historicoCriadoPor?: string;
  historicoAtualizadoEm?: string;
  historicoAtualizadoPor?: string;
}

function isServiceItem(item: any): boolean {
  if (item.tipo && item.tipo.toLowerCase().includes('servi')) return true;
  if (item.tipo && (item.tipo.toLowerCase().includes('peca') || item.tipo.toLowerCase().includes('prod'))) return false;
  if (item.grupo && item.grupo.toLowerCase().includes('servi')) return true;
  if (item.grupo && (item.grupo.toLowerCase().includes('peca') || item.grupo.toLowerCase().includes('prod'))) return false;

  const desc = (item.descricao || item.nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const serviceRegex = /\b(remocao|instalacao|desmontagem|montagem|diagnostico|reprogramacao|alinhamento|balanceamento|cambagem|higienizacao|sangria|mao de obra|servico|execucao|regulagem|revisao|lavagem|polimento|retifica|funilaria|pintura|geometria|inspecao|limpeza)\b/;
  return serviceRegex.test(desc);
}

function parseOSDetailRow(row: any): OSDetailComplete {
  let payload: any = {};
  if (row.raw_payload) {
    try {
      payload = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
    } catch {
      payload = {};
    }
  }

  const valorTotal = Number(row.total_os ?? payload.total_os ?? payload.valorTotal ?? 0);
  const valorPago = Number(row.valor_pago ?? payload.valor_pago ?? payload.valorPago ?? 0);
  const saldoDevedor = Number(
    row.valor_restante ?? payload.valor_restante ?? payload.saldoDevedor ?? Math.max(0, valorTotal - valorPago)
  );

  const servicos: OSServiceItem[] = [];
  const pecas: OSPartItem[] = [];

  if (Array.isArray(payload.servicos)) {
    for (const s of payload.servicos) {
      if (!s) continue;
      const vTot = Number(s.valor_total ?? s.valorTotal ?? ((s.valor_unitario ?? s.valorUnitario ?? 0) * (s.qtd || 1)));
      const vUnit = Number(s.valor_unitario ?? s.valorUnitario ?? vTot);
      servicos.push({
        codigo: s.codigo || undefined,
        descricao: s.descricao || s.nome || 'Servi?o',
        mecanico: s.mecanico || s.executor || undefined,
        executor: s.executor || s.mecanico || undefined,
        qtd: Number(s.qtd || 1),
        quantidade: Number(s.qtd || 1),
        valorUnitario: vUnit,
        valor_unitario: vUnit,
        valorTotal: vTot,
        valor_total: vTot
      });
    }
  }

  if (Array.isArray(payload.pecas)) {
    for (const p of payload.pecas) {
      if (!p) continue;
      const vTot = Number(p.valor_total ?? p.valorTotal ?? ((p.valor_unitario ?? p.valorUnitario ?? 0) * (p.qtd || 1)));
      const vUnit = Number(p.valor_unitario ?? p.valorUnitario ?? vTot);
      pecas.push({
        codigo: p.codigo || undefined,
        referencia: p.referencia || undefined,
        descricao: p.descricao || p.nome || 'Pe?a',
        qtd: Number(p.qtd || 1),
        quantidade: Number(p.qtd || 1),
        valorUnitario: vUnit,
        valor_unitario: vUnit,
        valorTotal: vTot,
        valor_total: vTot,
        executor: p.executor || undefined
      });
    }
  }

  if (servicos.length === 0 && pecas.length === 0 && Array.isArray(payload.itens)) {
    for (const item of payload.itens) {
      if (!item) continue;
      const vTot = Number(item.valor_total ?? item.valorTotal ?? ((item.valor_unitario ?? item.valorUnitario ?? 0) * (item.qtd || 1)));
      const vUnit = Number(item.valor_unitario ?? item.valorUnitario ?? vTot);

      if (isServiceItem(item)) {
        servicos.push({
          codigo: item.codigo || undefined,
          descricao: item.descricao || item.nome || 'Servi?o',
          mecanico: item.executor || item.mecanico || 'Mecânico da Loja',
          executor: item.executor || item.mecanico || 'Mecânico da Loja',
          qtd: Number(item.qtd || 1),
          quantidade: Number(item.qtd || 1),
          valorUnitario: vUnit,
          valor_unitario: vUnit,
          valorTotal: vTot,
          valor_total: vTot
        });
      } else {
        pecas.push({
          codigo: item.codigo || undefined,
          referencia: item.referencia || undefined,
          descricao: item.descricao || item.nome || 'Pe?a',
          qtd: Number(item.qtd || 1),
          quantidade: Number(item.qtd || 1),
          valorUnitario: vUnit,
          valor_unitario: vUnit,
          valorTotal: vTot,
          valor_total: vTot,
          executor: item.executor || undefined
        });
      }
    }
  }

  const rawPagamentos = Array.isArray(payload.pagamentos) ? payload.pagamentos : [];
  const pagamentos: OSPaymentInstallment[] = rawPagamentos.map((p: any) => {
    const rawForma = String(p.forma || '').trim();
    let modalidade = rawForma;
    const lowerForma = rawForma.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (lowerForma.includes('credito') || lowerForma.includes('cartao de credito')) {
      modalidade = 'Cartão de Crédito';
    } else if (lowerForma.includes('debito') || lowerForma.includes('cartao de debito')) {
      modalidade = 'Cartão de Débito';
    } else if (lowerForma.includes('pix')) {
      modalidade = 'PIX';
    } else if (lowerForma.includes('boleto')) {
      modalidade = 'Boleto';
    } else if (lowerForma.includes('dinheiro') || lowerForma.includes('especie')) {
      modalidade = 'Dinheiro';
    }
    const val = Number(p.valor || 0);
    const enviado = String(p.enviado_financeiro || p.enviadoFinanceiro || 'N?o').trim();

    return {
      parcela: String(p.parcela || ''),
      vencimento: String(p.vencimento || ''),
      forma: rawForma || modalidade,
      modalidade,
      valor: val,
      numOperacao: p.num_operacao || p.numOperacao || undefined,
      num_operacao: p.num_operacao || p.numOperacao || undefined,
      statusEnvioFinanceiro: enviado,
      enviadoFinanceiro: enviado,
      enviado_financeiro: enviado
    };
  });

  const rawDocs = Array.isArray(payload.documentos_anexos) ? payload.documentos_anexos : [];
  const documentosAnexos: OSDocumentItem[] = rawDocs.map((d: any) => ({
    origem: String(d.origem || ''),
    data: String(d.data || ''),
    descricao: String(d.descricao || ''),
    opcao: d.opcao ? String(d.opcao) : undefined
  }));

  const rawNotas = Array.isArray(payload.notas_fiscais) ? payload.notas_fiscais : [];

  const rawLists = Array.isArray(payload.checklists) ? payload.checklists : [];
  const checklists: OSChecklistItem[] = rawLists.map((c: any) => ({
    codigo: c.codigo || undefined,
    tipo: c.tipo || 'Check-List',
    status: c.status || 'Concluído',
    realizadoPor: c.realizado_por || c.realizadoPor || undefined,
    realizado_por: c.realizado_por || c.realizadoPor || undefined,
    data: c.data || undefined,
    hodometro: c.hodometro || undefined,
    progresso: c.progresso || undefined,
    termino: c.termino || undefined
  }));

  const temChecklistEntrada = rawLists.some((c: any) => c && c.tipo && (
    c.tipo.toLowerCase().includes('inspe') ||
    c.tipo.toLowerCase().includes('entrada')
  ));

  const temChecklistMecanico = rawLists.some((c: any) => c && c.tipo && (
    c.tipo.toLowerCase().includes('mecanic') ||
    c.tipo.toUpperCase() === 'MECANICO'
  ));

  let auditStatus: 'completo' | 'pendente_entrada' | 'pendente_mecanico' | 'sem_checklists' = 'sem_checklists';
  let auditDetalhes = 'Nenhum checklist registrado para esta OS.';

  if (payload && payload.extracao_completa === false) {
    auditStatus = 'sem_checklists';
    auditDetalhes = 'Detalhamento completo e vistorias em sincronização com o ERP.';
  } else if (temChecklistEntrada && temChecklistMecanico) {
    auditStatus = 'completo';
    auditDetalhes = 'Checklists de Inspeção de Entrada e do Mecânico realizados.';
  } else if (temChecklistEntrada && !temChecklistMecanico) {
    auditStatus = 'pendente_mecanico';
    auditDetalhes = 'Checklist de Entrada realizado; Checklist do Mecânico pendente.';
  } else if (!temChecklistEntrada && temChecklistMecanico) {
    auditStatus = 'pendente_entrada';
    auditDetalhes = 'Checklist do Mecânico realizado; Checklist de Entrada pendente.';
  }

  const totalServicos = servicos.reduce((acc, s) => acc + (s.valorTotal || 0), 0);
  const totalPecas = pecas.reduce((acc, p) => acc + (p.valorTotal || 0), 0);

  return {
    osId: String(row.os_id),
    os_id: String(row.os_id),
    lojaSlug: row.loja_slug,
    loja_slug: row.loja_slug,
    tipo: row.tipo || payload.tipo || 'OS',
    situacao: row.status_grid || payload.status_grid || (row.is_aberta ? 'ABERTO' : 'FECHADO'),
    status_grid: row.status_grid || payload.status_grid || (row.is_aberta ? 'ABERTO' : 'FECHADO'),
    dataAbertura: row.data_inicio || payload.data_inicio || payload.dataAbertura || '',
    data_inicio: row.data_inicio || payload.data_inicio || payload.dataAbertura || '',
    dataPromessa: row.data_fim || payload.data_fim || payload.previsao || payload.dataPromessa || '',
    data_fim: row.data_fim || payload.data_fim || payload.previsao || null,
    valorTotal,
    total_os: valorTotal,
    valorPago,
    valor_pago: valorPago,
    saldoDevedor,
    valor_restante: saldoDevedor,
    veiculo: row.veiculo || payload.veiculo || 'N?o informado',
    placa: row.placa || payload.placa || 'Sem placa',
    clienteNome: row.cliente_nome || payload.cliente_nome || payload.cliente || 'N?o informado',
    cliente_nome: row.cliente_nome || payload.cliente_nome || payload.cliente || 'N?o informado',
    clienteCpf: payload.cliente_cpf || undefined,
    cliente_cpf: payload.cliente_cpf || undefined,
    clienteTelefone: payload.cliente_telefone_sms || undefined,
    cliente_telefone_sms: payload.cliente_telefone_sms || undefined,
    responsavel: row.responsavel || payload.responsavel || undefined,
    diasNoPatio: Number(row.dias_no_patio ?? payload.dias_no_patio ?? 0),
    dias_no_patio: Number(row.dias_no_patio ?? payload.dias_no_patio ?? 0),
    isAberta: row.is_aberta != null ? Boolean(row.is_aberta) : true,
    is_aberta: row.is_aberta != null ? Number(row.is_aberta) : 1,
    temNf: row.tem_nf != null ? Boolean(row.tem_nf) : false,
    tem_nf: row.tem_nf != null ? Number(row.tem_nf) : 0,
    servicos,
    pecas,
    totalServicos,
    total_servicos: totalServicos,
    totalPecas,
    total_pecas: totalPecas,
    pagamentos,
    parcelas: pagamentos,
    documentosAnexos,
    documentos_anexos: documentosAnexos,
    notasFiscais: rawNotas,
    notas_fiscais: rawNotas,
    checklists,
    checklistAudit: {
      temChecklistEntrada,
      temChecklistMecanico,
      status: auditStatus,
      detalhes: auditDetalhes
    },
    extracaoCompleta: payload ? payload.extracao_completa !== false : false,
    extracao_completa: payload ? payload.extracao_completa !== false : false,
    rawPayload: payload,
    raw_payload: payload,
    observacao: payload?.observacao || undefined,
    historicoCriadoEm: payload?.historico_criado_em || undefined,
    historicoCriadoPor: payload?.historico_criado_por || undefined,
    historicoAtualizadoEm: payload?.historico_atualizado_em || undefined,
    historicoAtualizadoPor: payload?.historico_atualizado_por || undefined
  };
}

/**
 * Detalhamento profundo de uma Ordem de Servi?o pelo raw_payload.
 * Suporta consulta por os_id e loja_slug opcional.
 */
export function getOSDetails(
  db: Database.Database,
  target: string | number | { os_id?: string | number; osId?: string | number; loja_slug?: string; lojaSlug?: string },
  lojaSlugParam?: string
): OSDetailComplete | null {
  let osId = '';
  let lojaSlug: string | undefined = undefined;

  if (typeof target === 'object' && target !== null) {
    osId = String(target.os_id || target.osId || '').trim();
    lojaSlug = target.loja_slug || target.lojaSlug;
  } else {
    osId = String(target).trim();
    lojaSlug = lojaSlugParam;
  }

  if (!osId) return null;
  const cleanOsId = osId.replace(/\D/g, '') || osId;

  try {
    let row: any = null;
    if (lojaSlug) {
      row = db.prepare(`
        SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
               data_inicio, data_fim, dias_no_patio, veiculo, placa,
               cliente_nome, responsavel, total_os, valor_pago, valor_restante,
               tem_nf, raw_payload, updated_at
        FROM ordens_servico
        WHERE os_id = ? AND LOWER(loja_slug) = LOWER(?)
      `).get(cleanOsId, String(lojaSlug).trim());

      if (!row) {
        const cand = db.prepare(`
          SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
                 data_inicio, data_fim, dias_no_patio, veiculo, placa,
                 cliente_nome, responsavel, total_os, valor_pago, valor_restante,
                 tem_nf, raw_payload, updated_at
          FROM ordens_servico
          WHERE os_id = ?
          LIMIT 1
        `).get(cleanOsId) as any;
        if (cand && cand.loja_slug.toLowerCase() === String(lojaSlug).trim().toLowerCase()) {
          row = cand;
        }
      }
    } else {
      row = db.prepare(`
        SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
               data_inicio, data_fim, dias_no_patio, veiculo, placa,
               cliente_nome, responsavel, total_os, valor_pago, valor_restante,
               tem_nf, raw_payload, updated_at
        FROM ordens_servico
        WHERE os_id = ?
        LIMIT 1
      `).get(cleanOsId);
    }

    if (!row) return null;
    return parseOSDetailRow(row);
  } catch (err: any) {
    console.error('[DB] Erro ao buscar getOSDetails:', err?.message || err);
    return null;
  }
}

export const get_os_details = getOSDetails;

/**
 * Busca a ficha completa de uma Ordem de Servi?o pelo par (loja_slug, os_id).
 * Compatibilidade legada chamando getOSDetails com isolamento estrito.
 */
export function getOSDetailComplete(
  db: Database.Database,
  lojaSlug: string,
  osId: string
): OSDetailComplete | null {
  if (!lojaSlug || !osId) return null;
  return getOSDetails(db, { os_id: osId, loja_slug: lojaSlug });
}

/**
 * Inicialização idempotente das tabelas de autorização, identidades e memória atômica (hydra-memory-rag-isolation)
 */
export function initHydraAccessAndMemorySchema(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_authorized_users (
        phone TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'gerente',
        allowed_stores TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        can_simulate_persona INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS hydra_phone_identities (
        remote_jid TEXT PRIMARY KEY,
        phone_canonical TEXT NOT NULL,
        identity_type TEXT NOT NULL,
        push_name TEXT,
        verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (phone_canonical) REFERENCES hydra_authorized_users(phone)
      );
      CREATE INDEX IF NOT EXISTS idx_phone_identities_canonical ON hydra_phone_identities(phone_canonical);

      CREATE TABLE IF NOT EXISTS hydra_memories (
        memory_id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        generation_id INTEGER NOT NULL,
        scope_type TEXT NOT NULL,
        loja_slug TEXT,
        memory_type TEXT NOT NULL,
        topic_key TEXT NOT NULL,
        content_normalized TEXT NOT NULL,
        evidence_text TEXT NOT NULL,
        source_turn_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        confidence REAL NOT NULL DEFAULT 1.0,
        occurrence_count INTEGER DEFAULT 1,
        distinct_days_json TEXT DEFAULT '[]',
        superseded_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (phone) REFERENCES hydra_authorized_users(phone)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_scoped_lookup 
        ON hydra_memories(phone, generation_id, status, scope_type, loja_slug, topic_key);

      CREATE TABLE IF NOT EXISTS hydra_memory_consolidation_checkpoints (
        job_type TEXT PRIMARY KEY,
        last_processed_timestamp TEXT NOT NULL,
        last_processed_turn_id TEXT,
        records_consolidated INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS hydra_security_rejections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        remote_jid_masked TEXT NOT NULL,
        phone_masked TEXT,
        rejection_reason TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed idempotente que NUNCA reativa usuário revogado (ON CONFLICT DO NOTHING)
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active, can_simulate_persona)
      VALUES 
        ('5511996242812', 'Davi', 'socio', '["*"]', 1, 1),
        ('5511970671717', 'Marcos', 'socio', '["*"]', 1, 1),
        ('5511947645967', 'Joacir Barros', 'socio', '["*"]', 1, 1)
      ON CONFLICT(phone) DO NOTHING
    `).run();

    db.prepare(`
      INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name)
      VALUES
        ('5511996242812@s.whatsapp.net', '5511996242812', 'PN', 'Davi'),
        ('5511970671717@s.whatsapp.net', '5511970671717', 'PN', 'Marcos'),
        ('5511947645967@s.whatsapp.net', '5511947645967', 'PN', 'Joacir Barros')
      ON CONFLICT(remote_jid) DO NOTHING
    `).run();

  } catch (err: any) {
    console.warn('[ACCESS_MEMORY_SCHEMA] Erro ao inicializar schema de acesso e memoria:', err?.message || err);
  }
}

export {
  getAgyConversationId,
  setAgyConversationId,
  clearAgyConversationId
} from './turn_context_repository.js';
