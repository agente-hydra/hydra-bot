// src/hydra-sync/db_repository.ts
import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

// src/hydra-sync/semantic_glossary.ts
var SEED_GLOSSARY = [
  // Áreas Oficiais
  { categoria: "area", termo: "oleo", termo_canonico: "OLEO", descricao: "\xD3leo e lubrificantes" },
  { categoria: "area", termo: "\xF3leo", termo_canonico: "OLEO", descricao: "\xD3leo e lubrificantes" },
  { categoria: "area", termo: "oleos", termo_canonico: "OLEO", descricao: "\xD3leo e lubrificantes" },
  { categoria: "area", termo: "\xF3leos", termo_canonico: "OLEO", descricao: "\xD3leo e lubrificantes" },
  { categoria: "area", termo: "troca de oleo", termo_canonico: "OLEO", descricao: "Servi\xE7o e produto de troca de \xF3leo" },
  { categoria: "area", termo: "troca de \xF3leo", termo_canonico: "OLEO", descricao: "Servi\xE7o e produto de troca de \xF3leo" },
  { categoria: "area", termo: "lubrificante", termo_canonico: "OLEO", descricao: "Lubrificantes automotivos" },
  { categoria: "area", termo: "lubrificantes", termo_canonico: "OLEO", descricao: "Lubrificantes automotivos" },
  { categoria: "area", termo: "oleo motor", termo_canonico: "OLEO", descricao: "\xD3leo de motor" },
  { categoria: "area", termo: "oleo de motor", termo_canonico: "OLEO", descricao: "\xD3leo de motor" },
  { categoria: "area", termo: "fluido", termo_canonico: "OLEO", descricao: "Fluidos e \xF3leos" },
  { categoria: "area", termo: "filtro", termo_canonico: "FILTRO", descricao: "Filtros em geral" },
  { categoria: "area", termo: "filtros", termo_canonico: "FILTRO", descricao: "Filtros em geral" },
  { categoria: "area", termo: "filtro de oleo", termo_canonico: "FILTRO", descricao: "Filtro de \xF3leo" },
  { categoria: "area", termo: "filtro de ar", termo_canonico: "FILTRO", descricao: "Filtro de ar" },
  { categoria: "area", termo: "mecanica", termo_canonico: "MECANICA", descricao: "Mec\xE2nica geral" },
  { categoria: "area", termo: "mec\xE2nica", termo_canonico: "MECANICA", descricao: "Mec\xE2nica geral" },
  { categoria: "area", termo: "mecanica geral", termo_canonico: "MECANICA", descricao: "Mec\xE2nica geral" },
  { categoria: "area", termo: "pecas", termo_canonico: "MECANICA", descricao: "Pe\xE7as mec\xE2nicas" },
  { categoria: "area", termo: "pe\xE7as", termo_canonico: "MECANICA", descricao: "Pe\xE7as mec\xE2nicas" },
  { categoria: "area", termo: "terceirizado", termo_canonico: "TERCEIRIZADO", descricao: "Servi\xE7os terceirizados" },
  { categoria: "area", termo: "retifica", termo_canonico: "TERCEIRIZADO", descricao: "Ret\xEDfica terceirizada" },
  { categoria: "area", termo: "acessorio", termo_canonico: "ACESSORIO / DIVERSOS", descricao: "Acess\xF3rios e diversos" },
  { categoria: "area", termo: "acessorios", termo_canonico: "ACESSORIO / DIVERSOS", descricao: "Acess\xF3rios e diversos" },
  { categoria: "area", termo: "diversos", termo_canonico: "ACESSORIO / DIVERSOS", descricao: "Acess\xF3rios e diversos" },
  { categoria: "area", termo: "acessorio / diversos", termo_canonico: "ACESSORIO / DIVERSOS", descricao: "Acess\xF3rios e diversos" },
  { categoria: "area", termo: "servico prestado", termo_canonico: "SERVI\xC7O PRESTADO", descricao: "Servi\xE7os e m\xE3o de obra" },
  { categoria: "area", termo: "servi\xE7o prestado", termo_canonico: "SERVI\xC7O PRESTADO", descricao: "Servi\xE7os e m\xE3o de obra" },
  { categoria: "area", termo: "mao de obra", termo_canonico: "SERVI\xC7O PRESTADO", descricao: "M\xE3o de obra da oficina" },
  { categoria: "area", termo: "m\xE3o de obra", termo_canonico: "SERVI\xC7O PRESTADO", descricao: "M\xE3o de obra da oficina" },
  // Métricas
  { categoria: "metrica", termo: "cmv", termo_canonico: "cmv", descricao: "Custo de Mercadoria Vendida percentual" },
  { categoria: "metrica", termo: "custo de mercadoria", termo_canonico: "cmv", descricao: "Custo de Mercadoria Vendida" },
  { categoria: "metrica", termo: "custo de mercadorias", termo_canonico: "cmv", descricao: "Custo de Mercadoria Vendida" },
  { categoria: "metrica", termo: "margem", termo_canonico: "lucro_bruto_percentual", descricao: "Margem bruta percentual" },
  { categoria: "metrica", termo: "faturamento", termo_canonico: "faturamento", descricao: "Faturamento bruto da opera\xE7\xE3o" },
  { categoria: "metrica", termo: "lucro bruto", termo_canonico: "lucro_bruto", descricao: "Lucro bruto em reais" },
  { categoria: "metrica", termo: "atingimento", termo_canonico: "percentual_atingimento", descricao: "Percentual de atingimento da meta" },
  { categoria: "metrica", termo: "quanto falta", termo_canonico: "falta_para_meta", descricao: "Valor em reais faltante para bater a meta" },
  // Lojas canônicas
  { categoria: "loja", termo: "jorge beretta", termo_canonico: "MPJorgeBeretta", descricao: "Unidade Jorge Beretta" },
  { categoria: "loja", termo: "santo andre", termo_canonico: "MPSantoAndre", descricao: "Unidade Santo Andr\xE9" },
  { categoria: "loja", termo: "dom pedro", termo_canonico: "MPdompedro1", descricao: "Unidade Dom Pedro I" },
  { categoria: "loja", termo: "jabaquara", termo_canonico: "MPJabaquara", descricao: "Unidade Jabaquara" },
  { categoria: "loja", termo: "kennedy", termo_canonico: "MPkennedy", descricao: "Unidade Kennedy" },
  { categoria: "loja", termo: "piraporinha", termo_canonico: "MPpiraporinha", descricao: "Unidade Piraporinha" },
  { categoria: "loja", termo: "planalto", termo_canonico: "MPplanalto", descricao: "Unidade Planalto" },
  { categoria: "loja", termo: "rudge ramos", termo_canonico: "MPrudge", descricao: "Unidade Rudge Ramos" },
  { categoria: "loja", termo: "rei do modulo", termo_canonico: "ReiDoModulo", descricao: "Unidade Rei do M\xF3dulo" },
  { categoria: "loja", termo: "rei do oleo maua", termo_canonico: "ReiDoOleoMaua", descricao: "Unidade Rei do \xD3leo Mau\xE1" },
  // Sinônimos Operacionais
  { categoria: "sinonimo", termo: "os", termo_canonico: "list_os", descricao: "Ordens de servi\xE7o" },
  { categoria: "sinonimo", termo: "ordem de servico", termo_canonico: "list_os", descricao: "Ordem de servi\xE7o" },
  { categoria: "sinonimo", termo: "sem sinal", termo_canonico: "no_deposit", descricao: "Entrada zero / pagamento pendente" },
  { categoria: "sinonimo", termo: "retido", termo_canonico: "aging_cars", descricao: "Ve\xEDculos parados no p\xE1tio" },
  { categoria: "sinonimo", termo: "checklist", termo_canonico: "checklist_audit", descricao: "Auditoria de checklists" },
  // Regras
  { categoria: "regra", termo: "excluir_master", termo_canonico: "MASTER_EXCLUDED", descricao: "A unidade MPMaster \xE9 administrativa e deve ser expurgada de comparativos e m\xE9dias." },
  { categoria: "regra", termo: "cmv_area_isolado", termo_canonico: "ISOLATED_AREA_CMV", descricao: "O CMV de \xE1rea espec\xEDfica (ex: OLEO) deve ser calculado exclusivamente sobre faturamento_areas, sem fallback para o CMV geral da loja." },
  { categoria: "regra", termo: "orcamento_turno_50s", termo_canonico: "GLOBAL_TURN_BUDGET_50S", descricao: "O or\xE7amento total de espera do turno \xE9 de 50s distribu\xEDdo entre prim\xE1rio e secund\xE1rio." }
];
function initSemanticGlossary(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_semantic_glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria TEXT NOT NULL,
      termo TEXT NOT NULL,
      termo_canonico TEXT NOT NULL,
      descricao TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(categoria, termo)
    );

    CREATE INDEX IF NOT EXISTS idx_glossary_cat_termo ON hydra_semantic_glossary(categoria, termo);
    CREATE INDEX IF NOT EXISTS idx_glossary_canonico ON hydra_semantic_glossary(termo_canonico);

    CREATE VIRTUAL TABLE IF NOT EXISTS hydra_semantic_glossary_fts USING fts5(
      termo,
      termo_canonico,
      categoria,
      descricao,
      content='hydra_semantic_glossary',
      content_rowid='id'
    );
  `);
  const countRow = db.prepare("SELECT COUNT(*) as count FROM hydra_semantic_glossary").get();
  if (!countRow || countRow.count === 0) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO hydra_semantic_glossary (categoria, termo, termo_canonico, descricao)
      VALUES (?, ?, ?, ?)
    `);
    const insertFtsStmt = db.prepare(`
      INSERT OR IGNORE INTO hydra_semantic_glossary_fts (rowid, termo, termo_canonico, categoria, descricao)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertTx = db.transaction(() => {
      for (const entry of SEED_GLOSSARY) {
        const info = insertStmt.run(entry.categoria, entry.termo, entry.termo_canonico, entry.descricao || null);
        if (info.lastInsertRowid) {
          try {
            insertFtsStmt.run(info.lastInsertRowid, entry.termo, entry.termo_canonico, entry.categoria, entry.descricao || null);
          } catch {
          }
        }
      }
    });
    insertTx();
  }
}

// src/hydra-sync/db_repository.ts
import * as crypto from "crypto";
import { createRequire } from "module";
var requireESM = createRequire(import.meta.url);
var isVectorExtensionLoaded = false;
var vectorExtensionError = null;
var vectorExtensionVersion = null;
var vectorLoadablePath = null;
function loadVectorExtension(db) {
  try {
    try {
      db.prepare("SELECT vec_version()").get();
      return true;
    } catch {
    }
    const sqliteVec = requireESM("sqlite-vec");
    if (typeof sqliteVec.load === "function") {
      sqliteVec.load(db);
    } else if (typeof sqliteVec.getLoadablePath === "function") {
      const p = sqliteVec.getLoadablePath();
      vectorLoadablePath = p;
      db.loadExtension(p);
    }
    const verRow = db.prepare("SELECT vec_version() as version").get();
    vectorExtensionVersion = verRow?.version || "unknown";
    isVectorExtensionLoaded = true;
    vectorExtensionError = null;
    return true;
  } catch (err) {
    try {
      const sqliteVec = requireESM("sqlite-vec");
      if (typeof sqliteVec.getLoadablePath === "function") {
        const p = sqliteVec.getLoadablePath();
        vectorLoadablePath = p;
        db.loadExtension(p);
        const verRow = db.prepare("SELECT vec_version() as version").get();
        vectorExtensionVersion = verRow?.version || "unknown";
        isVectorExtensionLoaded = true;
        vectorExtensionError = null;
        return true;
      }
    } catch (fallbackErr) {
      vectorExtensionError = fallbackErr?.message || err?.message || String(err);
    }
    vectorExtensionError = err?.message || String(err);
    isVectorExtensionLoaded = false;
    return false;
  }
}
function checkVectorExtensionStatus(db) {
  let tableExists = false;
  let totalVectors = 0;
  try {
    const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_ordens_servico'").get();
    tableExists = !!tableRow;
    if (tableExists && isVectorExtensionLoaded) {
      const countRow = db.prepare("SELECT count(*) as count FROM vec_ordens_servico").get();
      totalVectors = countRow?.count ?? 0;
    }
  } catch {
  }
  return {
    isLoaded: isVectorExtensionLoaded,
    version: vectorExtensionVersion || void 0,
    loadablePath: vectorLoadablePath || void 0,
    tableExists,
    totalVectors,
    error: vectorExtensionError || void 0
  };
}
function parseBrDateToIso(rawDate) {
  if (!rawDate || typeof rawDate !== "string") return null;
  const trimmed = rawDate.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  const dtMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dtMatch) {
    const day = dtMatch[1].padStart(2, "0");
    const month = dtMatch[2].padStart(2, "0");
    let year = dtMatch[3];
    if (year.length === 2) {
      const yNum = parseInt(year, 10);
      year = yNum >= 70 ? "19" + year : "20" + year;
    }
    const hasTime = dtMatch[4] !== void 0;
    if (hasTime) {
      const hour = dtMatch[4].padStart(2, "0");
      const min = dtMatch[5].padStart(2, "0");
      const sec = (dtMatch[6] || "00").padStart(2, "0");
      return `${year}-${month}-${day}T${hour}:${min}:${sec}-03:00`;
    }
    return `${year}-${month}-${day}`;
  }
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
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}
function formatIsoTimestamp(date) {
  const d = date || /* @__PURE__ */ new Date();
  const spFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = spFormatter.formatToParts(d);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  return `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}-03:00`;
}
function resolveDbPath() {
  if (process.env.HYDRA_DB_PATH) return process.env.HYDRA_DB_PATH;
  if (process.platform === "win32") {
    return path.resolve(".tmp", "hydra_ops.db");
  }
  return "/home/operacional/hydra-data/hydra_ops.db";
}
function getDatabaseConnection(customPath) {
  const dbPath = customPath || resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -64000");
  loadVectorExtension(db);
  initSchema(db);
  return db;
}
function initSchema(db) {
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
  const colunasAditivasOS = [
    { col: "estado_operacional", def: "TEXT DEFAULT 'ABERTA'" },
    { col: "qualidade_dado", def: "TEXT DEFAULT 'VALIDADO'" },
    { col: "data_inicio_iso", def: "TEXT" },
    { col: "data_fim_iso", def: "TEXT" },
    { col: "data_evento_iso", def: "TEXT" },
    { col: "data_observacao_iso", def: "TEXT" },
    { col: "origem_transicao", def: "TEXT DEFAULT 'LEGADO'" }
  ];
  for (const c of colunasAditivasOS) {
    try {
      db.exec(`ALTER TABLE ordens_servico ADD COLUMN ${c.col} ${c.def};`);
    } catch {
    }
    try {
      db.exec(`ALTER TABLE ordens_servico_staging ADD COLUMN ${c.col} ${c.def};`);
    } catch {
    }
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
  } catch {
  }
  try {
    db.exec(`ALTER TABLE crawls_execucoes ADD COLUMN total_paginas INTEGER DEFAULT 1;`);
  } catch {
  }
  try {
    db.exec(`ALTER TABLE crawls_execucoes ADD COLUMN delta_abertas INTEGER DEFAULT 0;`);
  } catch {
  }
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
    } catch (err) {
      console.warn("[VEC] Falha ao criar tabela virtual vec_ordens_servico:", err?.message || err);
    }
  }
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
  } catch (ftsErr) {
    console.warn("[FTS5] Falha ao inicializar tabela virtual ordens_servico_fts:", ftsErr?.message || ftsErr);
  }
  try {
    initSemanticGlossary(db);
  } catch (err) {
    console.warn("[GLOSSARY] Falha ao inicializar glossario semantico:", err?.message || err);
  }
  try {
    initHydraAccessAndMemorySchema(db);
  } catch (err) {
    console.warn("[ACCESS_MEMORY] Falha ao inicializar schema de acesso e memoria:", err?.message || err);
  }
}
function rebuildFTSIndex(db) {
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
  } catch (err) {
    console.error("[FTS5] Erro ao reconstruir \xEDndice FTS5:", err?.message || err);
    throw err;
  }
}
function salvarMetasDiarias(db, metas, dataRef, posicaoHora) {
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
  const runBatch = db.transaction((items) => {
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
        percentual_meta: item.percentual_meta ?? null
      });
    }
  });
  runBatch(metas);
  console.log(`[DB] \u2705 Metas di\xE1rias sincronizadas (${metas.length} lojas) para data ${dataRef}.`);
}
function calcularDiasNoPatio(dataInicio) {
  if (!dataInicio) return 0;
  try {
    const s = dataInicio.trim();
    if (s.includes("/")) {
      const [datePart] = s.split(" ");
      const parts = datePart.split("/");
      if (parts.length === 3) {
        let dia = parseInt(parts[0], 10);
        let mes = parseInt(parts[1], 10) - 1;
        let ano = parseInt(parts[2], 10);
        if (ano < 100) ano += 2e3;
        const dtIni = new Date(ano, mes, dia);
        const diff = Math.max(0, Date.now() - dtIni.getTime());
        return Math.floor(diff / (1e3 * 60 * 60 * 24));
      }
    } else if (s.includes("-")) {
      const [datePart] = s.split(" ");
      const parts = datePart.split("-");
      if (parts.length === 3) {
        let ano = parseInt(parts[0], 10);
        let mes = parseInt(parts[1], 10) - 1;
        let dia = parseInt(parts[2], 10);
        if (ano < 100) ano += 2e3;
        const dtIni = new Date(ano, mes, dia);
        const diff = Math.max(0, Date.now() - dtIni.getTime());
        return Math.floor(diff / (1e3 * 60 * 60 * 24));
      }
    }
  } catch {
    return 0;
  }
  return 0;
}
function salvarLoteOSs(db, lojaSlug, docs, options) {
  const opts = typeof options === "boolean" ? { extracaoCompleta: options, paginacaoCompleta: options, provaPaginacaoNativa: options } : options || { extracaoCompleta: true, paginacaoCompleta: true, provaPaginacaoNativa: true };
  const dataRef = opts.dataReferencia || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const inicioEm = (/* @__PURE__ */ new Date()).toISOString();
  const loteId = crypto.randomUUID();
  const totalPaginas = opts.totalPaginas || 1;
  if (!docs || docs.length === 0) {
    console.warn(`[DB] \u26A0\uFE0F Aten\xE7\xE3o: Tentativa de gravar 0 documentos para ${lojaSlug}. Dados pr\xE9-existentes preservados no banco.`);
    try {
      registrarExecucaoCrawl(db, {
        loja_slug: lojaSlug,
        tipo_crawl: "PATIO",
        data_referencia: dataRef,
        inicio_em: inicioEm,
        fim_em: (/* @__PURE__ */ new Date()).toISOString(),
        total_paginas: totalPaginas,
        total_registros: 0,
        total_abertas: 0,
        delta_abertas: 0,
        status: "PARTIAL_REJECTED",
        detalhe_erro: "Lote vazio (0 documentos recebidos). Reconcilia\xE7\xE3o ignorada."
      });
    } catch {
    }
    return {
      status: "PARTIAL_REJECTED",
      loteId,
      totalDocumentos: 0,
      abertasAnteriores: 0,
      abertasNovas: 0,
      deltaAbertas: 0,
      mensagem: "Lote vazio: dados preservados"
    };
  }
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
  const runStagingBatch = db.transaction((items) => {
    for (const doc of items) {
      const isExplicitClosed = Boolean(
        doc.status_grid && (doc.status_grid.toLowerCase().includes("fechad") || doc.status_grid.toLowerCase().includes("fatur")) || doc.is_aberta === 0
      );
      const isAberta = isExplicitClosed ? 0 : doc.is_aberta !== void 0 ? Number(doc.is_aberta) : 1;
      const estadoOperacional = isAberta === 1 ? "ABERTA" : "ENCERRADA";
      const diasNoPatio = isAberta === 1 ? doc.dias_no_patio !== void 0 ? doc.dias_no_patio : calcularDiasNoPatio(doc.data_inicio) : 0;
      const totalVal = doc.total_os || doc.valor_total || 0;
      const pagoVal = doc.valor_pago || 0;
      const restVal = doc.valor_restante !== void 0 ? doc.valor_restante : Math.max(0, totalVal - pagoVal);
      const dInicioRaw = doc.data_inicio || "";
      const dFimRaw = doc.data_fim || null;
      const dInicioIso = parseBrDateToIso(dInicioRaw);
      const dFimIso = parseBrDateToIso(dFimRaw);
      const dEventoIso = dFimIso || dInicioIso;
      const dObsIso = formatIsoTimestamp();
      stagingStmt.run({
        lote_id: loteId,
        os_id: String(doc.id || doc.os_id),
        loja_slug: lojaSlug,
        tipo: doc.tipo || "OS",
        status_grid: doc.status_grid || "ABERTO",
        is_aberta: isAberta,
        estado_operacional: estadoOperacional,
        qualidade_dado: "VALIDADO",
        data_inicio: dInicioRaw,
        data_fim: dFimRaw,
        data_inicio_iso: dInicioIso,
        data_fim_iso: dFimIso,
        data_evento_iso: dEventoIso,
        data_observacao_iso: dObsIso,
        origem_transicao: "STAGING_INGESTION",
        dias_no_patio: diasNoPatio,
        veiculo: doc.veiculo || "",
        placa: doc.placa || "",
        cliente_nome: doc.cliente_nome || "",
        responsavel: doc.responsavel || "",
        total_os: totalVal,
        valor_pago: pagoVal,
        valor_restante: restVal,
        tem_nf: doc.notas_fiscais && doc.notas_fiscais.length > 0 ? 1 : 0,
        raw_payload: typeof doc === "string" ? doc : JSON.stringify(doc)
      });
    }
  });
  try {
    runStagingBatch(docs);
  } catch (stagingErr) {
    console.warn(`[DB] \u26A0\uFE0F Erro ao persistir em staging para ${lojaSlug}:`, stagingErr.message);
  }
  const prevOpenRow = db.prepare(`
    SELECT COUNT(*) as count FROM ordens_servico WHERE loja_slug = ? AND (is_aberta = 1 OR estado_operacional = 'ABERTA')
  `).get(lojaSlug);
  const abertasAnteriores = prevOpenRow?.count || 0;
  const openIds = docs.filter((doc) => doc.is_aberta !== void 0 ? Number(doc.is_aberta) === 1 : !(doc.status_grid && (doc.status_grid.toLowerCase().includes("fechad") || doc.status_grid.toLowerCase().includes("fatur")))).map((doc) => String(doc.id || doc.os_id));
  const abertasNovas = openIds.length;
  const deltaAbertas = abertasNovas - abertasAnteriores;
  const paginacaoComprovada = opts.paginacaoCompleta === true && opts.provaPaginacaoNativa !== false && opts.extracaoCompleta === true;
  if (!paginacaoComprovada) {
    console.warn(`[DB] \u{1F6A8} Lote ${loteId} para '${lojaSlug}' REJEITADO PARA QUARENTENA: falta comprova\xE7\xE3o de cobertura de pagina\xE7\xE3o nativa (tr.pgr completa). Dados de produ\xE7\xE3o mantidos intactos.`);
    try {
      registrarExecucaoCrawl(db, {
        loja_slug: lojaSlug,
        tipo_crawl: "PATIO",
        data_referencia: dataRef,
        inicio_em: inicioEm,
        fim_em: (/* @__PURE__ */ new Date()).toISOString(),
        total_paginas: totalPaginas,
        total_registros: docs.length,
        total_abertas: abertasNovas,
        delta_abertas: deltaAbertas,
        status: "QUARANTINE",
        detalhe_erro: "Falta de cobertura comprovada de pagina\xE7\xE3o nativa (tr.pgr completa). Lote mantido em quarentena sem altera\xE7\xE3o em ordens_servico."
      });
    } catch {
    }
    return {
      status: "QUARANTINE",
      loteId,
      totalDocumentos: docs.length,
      abertasAnteriores,
      abertasNovas,
      deltaAbertas,
      mensagem: "Lote retido em quarentena: cobertura de pagina\xE7\xE3o nativa incompleta ou n\xE3o comprovada"
    };
  }
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
  const applyUpserts = (items) => {
    for (const doc of items) {
      const isExplicitClosed = Boolean(
        doc.status_grid && (doc.status_grid.toLowerCase().includes("fechad") || doc.status_grid.toLowerCase().includes("fatur")) || doc.is_aberta === 0
      );
      const isAberta = isExplicitClosed ? 0 : doc.is_aberta !== void 0 ? Number(doc.is_aberta) : 1;
      const estadoOperacional = isAberta === 1 ? "ABERTA" : "ENCERRADA";
      const diasNoPatio = isAberta === 1 ? doc.dias_no_patio !== void 0 ? doc.dias_no_patio : calcularDiasNoPatio(doc.data_inicio) : 0;
      const totalVal = doc.total_os || doc.valor_total || 0;
      const pagoVal = doc.valor_pago || 0;
      const restVal = doc.valor_restante !== void 0 ? doc.valor_restante : Math.max(0, totalVal - pagoVal);
      const dInicioRaw = doc.data_inicio || "";
      const dFimRaw = doc.data_fim || null;
      const dInicioIso = parseBrDateToIso(dInicioRaw);
      const dFimIso = parseBrDateToIso(dFimRaw);
      const dEventoIso = dFimIso || dInicioIso;
      const dObsIso = formatIsoTimestamp();
      upsertStmt.run({
        os_id: String(doc.id || doc.os_id),
        loja_slug: lojaSlug,
        tipo: doc.tipo || "OS",
        status_grid: doc.status_grid || "ABERTO",
        is_aberta: isAberta,
        estado_operacional: estadoOperacional,
        qualidade_dado: "VALIDADO",
        data_inicio: dInicioRaw,
        data_fim: dFimRaw,
        data_inicio_iso: dInicioIso,
        data_fim_iso: dFimIso,
        data_evento_iso: dEventoIso,
        data_observacao_iso: dObsIso,
        origem_transicao: "GRID_PAGINADA",
        dias_no_patio: diasNoPatio,
        veiculo: doc.veiculo || "",
        placa: doc.placa || "",
        cliente_nome: doc.cliente_nome || "",
        responsavel: doc.responsavel || "",
        total_os: totalVal,
        valor_pago: pagoVal,
        valor_restante: restVal,
        tem_nf: doc.notas_fiscais && doc.notas_fiscais.length > 0 ? 1 : 0,
        raw_payload: typeof doc === "string" ? doc : JSON.stringify(doc)
      });
    }
  };
  const runFullTx = db.transaction((items) => {
    applyUpserts(items);
    if (openIds.length > 0) {
      const placeholders = openIds.map(() => "?").join(",");
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
      tipo_crawl: "PATIO",
      data_referencia: dataRef,
      inicio_em: inicioEm,
      fim_em: (/* @__PURE__ */ new Date()).toISOString(),
      total_paginas: totalPaginas,
      total_registros: docs.length,
      total_abertas: abertasNovas,
      delta_abertas: deltaAbertas,
      status: "SUCCESS"
    });
  } catch {
  }
  console.log(`[DB] \u2705 ${docs.length} registros sincronizados e reconciliados com sucesso para loja '${lojaSlug}'.`);
  return {
    status: "SUCCESS",
    loteId,
    totalDocumentos: docs.length,
    abertasAnteriores,
    abertasNovas,
    deltaAbertas,
    mensagem: "Reconcilia\xE7\xE3o conclu\xEDda com sucesso"
  };
}
function formalizarTransicaoNominalOS(db, osId, lojaSlug, novoEstado, origemTransicao, dadosDetalhe) {
  const isAberta = novoEstado === "ABERTA" ? 1 : 0;
  const diasNoPatio = novoEstado === "ABERTA" ? dadosDetalhe?.dias_no_patio || 0 : 0;
  let dataFimIso = null;
  if (dadosDetalhe?.data_fim) {
    dataFimIso = parseBrDateToIso(dadosDetalhe.data_fim);
  } else if (novoEstado === "ENCERRADA" || novoEstado === "CANCELADA") {
    dataFimIso = formatIsoTimestamp();
  }
  const res = db.prepare(`
    UPDATE ordens_servico
    SET estado_operacional = @estado_operacional,
        qualidade_dado = 'VALIDADO',
        is_aberta = @is_aberta,
        dias_no_patio = @dias_no_patio,
        data_fim_iso = COALESCE(@data_fim_iso, data_fim_iso),
        data_evento_iso = COALESCE(@data_fim_iso, data_evento_iso),
        data_observacao_iso = @data_observacao_iso,
        origem_transicao = @origem_transicao,
        updated_at = CURRENT_TIMESTAMP
    WHERE os_id = @os_id AND loja_slug = @loja_slug
  `).run({
    estado_operacional: novoEstado,
    is_aberta: isAberta,
    dias_no_patio: diasNoPatio,
    data_fim_iso: dataFimIso,
    data_observacao_iso: formatIsoTimestamp(),
    origem_transicao: origemTransicao,
    os_id: String(osId),
    loja_slug: lojaSlug
  });
  return res.changes > 0;
}
function carregarLoteControlado30Dias(db, lojaSlug, options) {
  const diasJanela = options?.diasJanela || 30;
  const refDate = options?.dataReferencia ? new Date(options.dataReferencia) : /* @__PURE__ */ new Date();
  const cutoffDate = new Date(refDate.getTime() - diasJanela * 24 * 60 * 60 * 1e3);
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
  const params = [];
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
  const rows = db.prepare(query).all(...params);
  return rows.map((r) => {
    let estOp = r.estado_operacional || (r.is_aberta === 1 ? "ABERTA" : "ENCERRADA");
    let qDado = r.qualidade_dado || "VALIDADO";
    const dInicioIso = r.data_inicio_iso || parseBrDateToIso(r.data_inicio);
    const dFimIso = r.data_fim_iso || parseBrDateToIso(r.data_fim);
    const dEventoIso = r.data_evento_iso || dFimIso || dInicioIso;
    const dObsIso = r.data_observacao_iso || formatIsoTimestamp();
    return {
      osId: String(r.os_id),
      lojaSlug: String(r.loja_slug),
      tipo: String(r.tipo || "OS"),
      statusGrid: String(r.status_grid || ""),
      isAberta: Boolean(r.is_aberta),
      estadoOperacional: estOp,
      qualidadeDado: qDado,
      dataInicioRaw: r.data_inicio || void 0,
      dataInicioIso: dInicioIso || void 0,
      dataFimRaw: r.data_fim || void 0,
      dataFimIso: dFimIso || void 0,
      dataEventoIso: dEventoIso || void 0,
      dataObservacaoIso: dObsIso,
      diasNoPatio: Number(r.dias_no_patio || 0),
      veiculo: r.veiculo || void 0,
      placa: r.placa || void 0,
      clienteNome: r.cliente_nome || void 0,
      responsavel: r.responsavel || void 0,
      totalOs: Number(r.total_os || 0),
      valorPago: Number(r.valor_pago || 0),
      valorRestante: Number(r.valor_restante || 0),
      temNf: Boolean(r.tem_nf),
      origemTransicao: String(r.origem_transicao || "LEGADO")
    };
  });
}
function backfillDatasOrdensServico(db) {
  const rows = db.prepare(`
    SELECT os_id, loja_slug, data_inicio, data_fim, updated_at,
           data_inicio_iso, data_fim_iso, data_evento_iso, data_observacao_iso
    FROM ordens_servico
  `).all();
  const updateStmt = db.prepare(`
    UPDATE ordens_servico
    SET data_inicio_iso = @data_inicio_iso,
        data_fim_iso = @data_fim_iso,
        data_evento_iso = @data_evento_iso,
        data_observacao_iso = @data_observacao_iso
    WHERE os_id = @os_id AND loja_slug = @loja_slug
  `);
  let totalAtualizados = 0;
  const runBackfillTx = db.transaction((items) => {
    for (const r of items) {
      const dInicioIso = parseBrDateToIso(r.data_inicio);
      const dFimIso = parseBrDateToIso(r.data_fim);
      const dEventoIso = dFimIso || dInicioIso;
      const dObsIso = parseBrDateToIso(r.updated_at) || formatIsoTimestamp();
      const needsUpdate = r.data_inicio_iso !== dInicioIso || r.data_fim_iso !== dFimIso || r.data_evento_iso !== dEventoIso || r.data_observacao_iso !== dObsIso;
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
function sanearOrdensDivergentesExistentes(db) {
  const divergentes = db.prepare(`
    SELECT os_id, loja_slug, status_grid, is_aberta
    FROM ordens_servico
    WHERE is_aberta = 0 AND status_grid IN ('ABERTO', 'AGUARDANDO RETIRADA')
  `).all();
  let abertosCount = 0;
  let aguardandoRetiradaCount = 0;
  for (const row of divergentes) {
    if (row.status_grid === "ABERTO") abertosCount++;
    else if (row.status_grid === "AGUARDANDO RETIRADA") aguardandoRetiradaCount++;
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
  const runSaneamentoTx = db.transaction((items) => {
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
    ordensAtualizadas: divergentes.map((d) => ({
      os_id: d.os_id,
      loja_slug: d.loja_slug,
      status_grid: d.status_grid
    }))
  };
}
function isolarInvestigarOS9202(db) {
  const row = db.prepare(`
    SELECT * FROM ordens_servico WHERE os_id = '9202' AND loja_slug = 'MPkennedy'
  `).get();
  if (!row) {
    return {
      osId: "9202",
      lojaSlug: "MPkennedy",
      isolado: false,
      relatorioAuditoria: {
        erro: "OS 9202 n\xE3o localizada na loja MPkennedy"
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
    os_id: "9202",
    loja_slug: "MPkennedy",
    motivo_quarentena: "Dados aberrantes fora da curva operacional e indicativos de anomalia ou registro de teste.",
    anomalias_detectadas: [
      `total_os R$ ${row.total_os} (fora do desvio padr\xE3o operacional)`,
      `veiculo '${row.veiculo}' identificado como marcador sentinela de teste`,
      `placa '${row.placa}' n\xE3o padronizada`,
      "data_inicio ausente (NULL)",
      "raw_payload ausente (NULL)"
    ],
    status_anterior: {
      status_grid: row.status_grid,
      is_aberta: row.is_aberta,
      estado_operacional: row.estado_operacional,
      qualidade_dado: row.qualidade_dado
    },
    status_atual: {
      estado_operacional: "DESCONHECIDO",
      qualidade_dado: "SUSPEITO_QUARENTENA",
      origem_transicao: "PROTOCOLO_INVESTIGACAO_9202"
    },
    data_auditoria: (/* @__PURE__ */ new Date()).toISOString()
  };
  return {
    osId: "9202",
    lojaSlug: "MPkennedy",
    isolado: true,
    relatorioAuditoria
  };
}
function swapAtomicoVetores(db, versionId, totalVetores) {
  if (!isVectorExtensionLoaded && !loadVectorExtension(db)) {
    console.warn("[VEC] sqlite-vec n\xE3o carregado para swap at\xF4mico.");
    return false;
  }
  try {
    const swapTx = db.transaction(() => {
      db.exec("DELETE FROM vec_ordens_servico;");
      db.exec("INSERT INTO vec_ordens_servico(os_key, os_embedding) SELECT os_key, os_embedding FROM vec_ordens_servico_staging;");
      db.exec("DELETE FROM vec_ordens_servico_staging;");
      db.prepare(`
        UPDATE vec_index_versions SET is_active = 0 WHERE table_name = 'vec_ordens_servico';
      `).run();
      db.prepare(`
        INSERT INTO vec_index_versions (version_id, table_name, total_vectors, created_at, is_active)
        VALUES (?, 'vec_ordens_servico', ?, CURRENT_TIMESTAMP, 1);
      `).run(versionId, totalVetores);
    });
    swapTx();
    console.log(`[VEC] \u2705 Swap at\xF4mico de ${totalVetores} vetores conclu\xEDdo (vers\xE3o: ${versionId}).`);
    return true;
  } catch (err) {
    console.error("[VEC] \u274C Falha no swap at\xF4mico vetorial:", err?.message || err);
    throw err;
  }
}
function limparStagingAntigo(db, horas = 48) {
  const info = db.prepare(`
    DELETE FROM ordens_servico_staging
    WHERE created_at < datetime('now', '-' || ? || ' hours')
  `).run(horas);
  return info.changes;
}
function registrarEntregaWhatsApp(db, item) {
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
      resposta_raw: item.resposta_raw ? String(item.resposta_raw).slice(0, 1e3) : null,
      erro: item.erro || null
    });
  } catch (err) {
    console.warn("[DB] Falha ao registrar log de entrega WhatsApp:", err?.message || err);
  }
}
function isWebhookMessageProcessed(db, messageId) {
  if (!messageId) return false;
  try {
    const row = db.prepare("SELECT 1 FROM webhook_dedup WHERE message_id = ?").get(messageId);
    return Boolean(row);
  } catch {
    return false;
  }
}
function marcarWebhookMessageProcessed(db, messageId, phone, origem = "EVOLUTION") {
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
function limparWebhookDedupAntigo(db, horas = 72) {
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
function registrarTelemetriaIA(db, item) {
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
      detalhe_erro: item.detalhe_erro ? String(item.detalhe_erro).slice(0, 1e3) : null
    });
  } catch (err) {
    console.warn("[DB] Falha ao registrar telemetria IA:", err?.message || err);
  }
}
function getPatioOverview(db) {
  return db.prepare(`
    SELECT 
      loja_slug,
      COUNT(*) AS total_abertas,
      SUM(total_os) AS total_valor,
      SUM(valor_restante) AS total_restante
    FROM ordens_servico
    WHERE is_aberta = 1
    GROUP BY loja_slug
    ORDER BY total_abertas DESC
  `).all();
}
function getAgingCars(db, diasMinimos = 5) {
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
function getFinancialAlerts(db, minSaldo = 2500) {
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
function getMetasConsolidadas(db, dataRef) {
  const fields = "loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, posicao_hora, data_referencia";
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
function verificarFrescorMetas(db, maxHorasTolerancia = 26) {
  const row = db.prepare(`
    SELECT data_referencia, MAX(created_at) as max_created, posicao_hora
    FROM metas_diarias
    WHERE data_referencia = (SELECT MAX(data_referencia) FROM metas_diarias)
    GROUP BY data_referencia
  `).get();
  if (!row || !row.data_referencia) {
    return { dataMaisRecente: null, posicaoHora: null, idadeHoras: 999, isValido: false };
  }
  const dtCreated = new Date(row.max_created?.includes("T") ? row.max_created : `${row.max_created?.replace(" ", "T") || `${row.data_referencia}T12:00:00`}Z`);
  const agora = /* @__PURE__ */ new Date();
  const diffMs = agora.getTime() - dtCreated.getTime();
  const idadeHoras = Math.max(0, Math.round(diffMs / (1e3 * 60 * 60)));
  return {
    dataMaisRecente: row.data_referencia,
    posicaoHora: row.posicao_hora || null,
    idadeHoras,
    isValido: idadeHoras <= maxHorasTolerancia
  };
}
function registrarExecucaoCrawl(db, reg) {
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
    detalhe_erro: reg.detalhe_erro || null
  });
  return Number(res.lastInsertRowid);
}
function obterUltimaExecucaoLoja(db, lojaSlug, tipoCrawl) {
  const row = db.prepare(`
    SELECT * FROM crawls_execucoes
    WHERE loja_slug = ? AND tipo_crawl = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(lojaSlug, tipoCrawl);
  return row || null;
}
function insertAgentFeedback(db, feedback) {
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
    status: feedback.status || "PENDING"
  });
  return Number(result.lastInsertRowid);
}
function insertAgentInteractionLog(db, log) {
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
    tools_chamadas: log.tools_chamadas ? JSON.stringify(log.tools_chamadas) : "[]",
    resposta_gerada: log.resposta_gerada || null,
    latencia_ms: log.latencia_ms || 0,
    motor_utilizado: log.motor_utilizado || "AGY_CLI",
    erro: log.erro || null
  });
  return Number(result.lastInsertRowid);
}
function getHighestValueOS(db, filter = {}) {
  const limit = Math.min(filter.limit || 5, 20);
  const ordem = filter.ordem === "ASC" ? "ASC" : "DESC";
  if (filter.loja_slug) {
    return db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_pago, valor_restante, dias_no_patio, responsavel
      FROM ordens_servico
      WHERE is_aberta = 1 AND LOWER(loja_slug) = LOWER(?)
      ORDER BY total_os ${ordem}
      LIMIT ?
    `).all(filter.loja_slug, limit);
  }
  return db.prepare(`
    SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_pago, valor_restante, dias_no_patio, responsavel
    FROM ordens_servico
    WHERE is_aberta = 1
    ORDER BY total_os ${ordem}
    LIMIT ?
  `).all(limit);
}
function getOSByItemCount(db, lojaSlug, limit = 5) {
  const lim = Math.min(limit, 20);
  const query = lojaSlug ? `SELECT os_id, loja_slug, veiculo, placa, total_os,
              json_array_length(json_extract(raw_payload, '$.itens')) as qtd_itens,
              raw_payload
       FROM ordens_servico
       WHERE is_aberta = 1 AND json_extract(raw_payload, '$.itens') IS NOT NULL AND LOWER(loja_slug) = LOWER(?)
       ORDER BY qtd_itens DESC
       LIMIT ?` : `SELECT os_id, loja_slug, veiculo, placa, total_os,
              json_array_length(json_extract(raw_payload, '$.itens')) as qtd_itens,
              raw_payload
       FROM ordens_servico
       WHERE is_aberta = 1 AND json_extract(raw_payload, '$.itens') IS NOT NULL
       ORDER BY qtd_itens DESC
       LIMIT ?`;
  const rows = lojaSlug ? db.prepare(query).all(lojaSlug, lim) : db.prepare(query).all(lim);
  return rows.map((r) => {
    let principaisPecas = [];
    try {
      const p = JSON.parse(r.raw_payload || "{}");
      if (Array.isArray(p.itens)) {
        principaisPecas = p.itens.filter((i) => i && i.descricao).slice(0, 3).map((i) => `${i.qtd || 1}x ${i.descricao}`);
      }
    } catch {
    }
    return {
      os_id: r.os_id,
      loja_slug: r.loja_slug,
      veiculo: r.veiculo || "N\xE3o informado",
      placa: r.placa || "Sem placa",
      total_os: r.total_os || 0,
      qtd_itens: r.qtd_itens || 0,
      principais_pecas: principaisPecas
    };
  });
}
function getChecklistAudit(db, lojaSlug) {
  const rows = db.prepare(`
    SELECT os_id, loja_slug, veiculo, placa, dias_no_patio, raw_payload
    FROM ordens_servico
    WHERE is_aberta = 1
  `).all();
  let semEntrada = 0;
  let semMecanico = 0;
  const porLojaSemMec = {};
  const porLojaSemEntrada = {};
  const detalhesCriticos = [];
  for (const r of rows) {
    if (lojaSlug && r.loja_slug.toLowerCase() !== lojaSlug.toLowerCase()) {
      continue;
    }
    let p = {};
    try {
      p = JSON.parse(r.raw_payload || "{}");
    } catch {
    }
    const lists = Array.isArray(p.checklists) ? p.checklists : [];
    const hasEntrada = lists.some((c) => c && c.tipo && (c.tipo.toLowerCase().includes("inspe") || c.tipo.toLowerCase().includes("entrada")));
    const hasMecanico = lists.some((c) => c && c.tipo && (c.tipo.toLowerCase().includes("mecanic") || c.tipo.toUpperCase() === "MECANICO"));
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
        veiculo: r.veiculo || "N\xE3o informado",
        placa: r.placa || "Sem placa",
        dias_no_patio: r.dias_no_patio || 0,
        sem_entrada: !hasEntrada,
        sem_mecanico: !hasMecanico
      });
    }
  }
  detalhesCriticos.sort((a, b) => (b.dias_no_patio || 0) - (a.dias_no_patio || 0));
  return {
    total_os_abertas: lojaSlug ? rows.filter((r) => r.loja_slug.toLowerCase() === lojaSlug.toLowerCase()).length : rows.length,
    total_sem_checklist_entrada: semEntrada,
    total_sem_checklist_mecanico: semMecanico,
    por_loja_sem_mecanico: porLojaSemMec,
    por_loja_sem_entrada: porLojaSemEntrada,
    detalhes_criticos: detalhesCriticos.slice(0, 10)
  };
}
function getStoreDrilldown(db, lojaSlug) {
  const slug = lojaSlug.trim().toLowerCase();
  const patioRow = db.prepare(`
    SELECT COUNT(*) as total_abertas, SUM(valor_restante) as total_restante
    FROM ordens_servico
    WHERE is_aberta = 1 AND LOWER(loja_slug) = LOWER(?)
  `).get(slug);
  const travadosRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM ordens_servico
    WHERE is_aberta = 1 AND dias_no_patio >= 5 AND LOWER(loja_slug) = LOWER(?)
  `).get(slug);
  const alertasRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM ordens_servico
    WHERE is_aberta = 1 AND valor_restante >= 2500 AND valor_pago <= 0 AND LOWER(loja_slug) = LOWER(?)
  `).get(slug);
  const metasRow = db.prepare(`
    SELECT faturamento_mes, volume_os, ticket_medio, data_referencia, posicao_hora
    FROM metas_diarias
    WHERE LOWER(loja_slug) = LOWER(?)
      AND data_referencia = (SELECT MAX(data_referencia) FROM metas_diarias)
    LIMIT 1
  `).get(slug);
  const checklistAudit = getChecklistAudit(db, slug);
  const frescor = verificarFrescorMetas(db, 26);
  return {
    loja_slug: lojaSlug,
    total_veiculos_patio: patioRow?.total_abertas || 0,
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
    is_metas_stale: !frescor.isValido
  };
}
function searchOS(db, termo) {
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
function getRecentInteractionContext(db, phone) {
  const cleanPhone = phone.replace(/\D/g, "");
  const row = db.prepare(`
    SELECT pergunta, resposta_gerada, tools_chamadas, created_at
    FROM agent_interaction_logs
    WHERE phone = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(cleanPhone);
  if (!row) return {};
  const pergunta = (row.pergunta || "").toLowerCase();
  let tema;
  if (pergunta.includes("check") || pergunta.includes("mecanic") || pergunta.includes("inspe")) {
    tema = "CHECKLIST";
  } else if (pergunta.includes("valor") || pergunta.includes("car") || pergunta.includes("mai")) {
    tema = "VALOR";
  } else if (pergunta.includes("peca") || pergunta.includes("item")) {
    tema = "PECAS";
  } else if (pergunta.includes("patio") || pergunta.includes("travad") || pergunta.includes("dia")) {
    tema = "PATIO";
  } else if (pergunta.includes("fatur") || pergunta.includes("meta") || pergunta.includes("vend")) {
    tema = "FATURAMENTO";
  }
  let tools = [];
  try {
    tools = JSON.parse(row.tools_chamadas || "[]");
  } catch {
  }
  return {
    pergunta_anterior: row.pergunta,
    resposta_anterior: row.resposta_gerada,
    tools_anteriores: tools,
    tema_anterior: tema
  };
}
function upsertOSEmbedding(db, osKey, embedding) {
  if (!isVectorExtensionLoaded && !loadVectorExtension(db)) {
    console.warn(`[VEC] sqlite-vec n\xE3o est\xE1 carregado. Ignorando upsert para ${osKey}`);
    return;
  }
  if (!(embedding instanceof Float32Array) || embedding.length !== 384) {
    console.warn(`[VEC] Dimens\xE3o ou tipo inv\xE1lido para ${osKey}: esperava Float32Array de 384 dimens\xF5es, recebido ${embedding?.length}`);
    return;
  }
  try {
    const rawBuffer = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare("DELETE FROM vec_ordens_servico WHERE os_key = ?").run(osKey);
    db.prepare(`
      INSERT INTO vec_ordens_servico(os_key, os_embedding)
      VALUES (?, ?)
    `).run(osKey, rawBuffer);
  } catch (err) {
    console.warn(`[VEC] Erro ao salvar embedding para ${osKey}:`, err?.message || err);
  }
}
function semanticSearchOS(db, queryEmbedding, limit = 5) {
  if (!isVectorExtensionLoaded && !loadVectorExtension(db)) {
    return [];
  }
  if (!(queryEmbedding instanceof Float32Array) || queryEmbedding.length !== 384) {
    console.warn(`[VEC] Dimens\xE3o da query inv\xE1lida: esperava 384 dimens\xF5es, recebido ${queryEmbedding?.length}`);
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
    `).all(rawBuffer, limit);
    if (!vecResults || vecResults.length === 0) {
      return [];
    }
    const results = [];
    const getOSStmt = db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, total_os, valor_restante, dias_no_patio, status_grid, responsavel
      FROM ordens_servico
      WHERE os_id = ? AND loja_slug = ?
    `);
    for (const item of vecResults) {
      const parts = item.os_key.split(":");
      if (parts.length < 2) continue;
      const [osId, lojaSlug] = parts;
      const osData = getOSStmt.get(osId, lojaSlug);
      if (osData) {
        results.push({
          os_id: osData.os_id,
          loja_slug: osData.loja_slug,
          distance: Number(item.distance.toFixed(4)),
          veiculo: osData.veiculo || "N/A",
          placa: osData.placa || "N/A",
          cliente_nome: osData.cliente_nome || "N/A",
          total_os: Number(osData.total_os || 0),
          valor_restante: Number(osData.valor_restante || 0),
          dias_no_patio: Number(osData.dias_no_patio || 0),
          status_grid: osData.status_grid || "N/A",
          responsavel: osData.responsavel || void 0
        });
      }
    }
    return results;
  } catch (err) {
    console.warn("[VEC] Erro na busca sem\xE2ntica KNN:", err?.message || err);
    return [];
  }
}
function saveConversationMessage(db, phone, role, content, toolUsed, toolParams) {
  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const serializedParams = toolParams ? JSON.stringify(toolParams) : null;
    db.prepare(`
      INSERT INTO conversation_messages(phone, role, content, tool_used, tool_params)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanPhone, role, content, toolUsed || null, serializedParams);
  } catch (err) {
    console.warn("[CONV] Erro ao salvar mensagem da conversa:", err?.message || err);
  }
}
function getConversationHistory(db, phone, limit = 5) {
  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const rows = db.prepare(`
      SELECT id, phone, role, content, tool_used, tool_params, created_at
      FROM conversation_messages
      WHERE phone = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(cleanPhone, limit);
    return rows.reverse();
  } catch (err) {
    console.warn("[CONV] Erro ao buscar hist\xF3rico da conversa:", err?.message || err);
    return [];
  }
}
async function getHydraHealthSnapshot(db, redisClient) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  let crawlers = [];
  try {
    const rows = db.prepare(`
      SELECT loja_slug, tipo_crawl as tipo, fim_em as ultimaExecucao, status, duracao_ms as duracaoMs, total_registros as registros
      FROM crawls_execucoes
      ORDER BY id DESC
      LIMIT 10
    `).all();
    crawlers = rows.map((r) => ({
      loja_slug: r.loja_slug || "GERAL",
      tipo: r.tipo || "PATIO",
      ultimaExecucao: r.ultimaExecucao || null,
      status: r.status || "SUCCESS",
      duracaoMs: Number(r.duracaoMs || 0),
      registros: Number(r.registros || 0)
    }));
  } catch (err) {
    console.warn("[HEALTH] Falha ao ler crawls_execucoes:", err?.message || err);
  }
  let metasData = {
    dataReferenciaMaisRecente: null,
    idadeEmHoras: 999,
    lojasCompletas: 0,
    frescor: "CRITICAL"
  };
  try {
    const frescorInfo = verificarFrescorMetas(db, 26);
    metasData.dataReferenciaMaisRecente = frescorInfo.dataMaisRecente;
    metasData.idadeEmHoras = frescorInfo.idadeHoras;
    if (frescorInfo.dataMaisRecente) {
      const lojasRow = db.prepare(`
        SELECT COUNT(DISTINCT loja_slug) as c FROM metas_diarias WHERE data_referencia = ?
      `).get(frescorInfo.dataMaisRecente);
      metasData.lojasCompletas = lojasRow?.c || 0;
    }
    if (!frescorInfo.dataMaisRecente || frescorInfo.idadeHoras > 36) {
      metasData.frescor = "CRITICAL";
    } else if (frescorInfo.idadeHoras > 26) {
      metasData.frescor = "STALE";
    } else {
      metasData.frescor = "FRESH";
    }
  } catch (err) {
    console.warn("[HEALTH] Falha ao verificar metas:", err?.message || err);
  }
  let indiceVetorial = {
    totalVetores: 0,
    totalOSsAbertas: 0,
    coberturaPct: 100
  };
  try {
    const osRow = db.prepare("SELECT COUNT(*) as c FROM ordens_servico WHERE is_aberta = 1").get();
    indiceVetorial.totalOSsAbertas = osRow?.c || 0;
    let vecCount = 0;
    try {
      const vRow = db.prepare("SELECT COUNT(*) as c FROM vec_ordens_servico").get();
      vecCount = vRow?.c || 0;
    } catch {
    }
    indiceVetorial.totalVetores = vecCount;
    if (indiceVetorial.totalOSsAbertas > 0) {
      indiceVetorial.coberturaPct = Math.min(100, Math.round(vecCount / indiceVetorial.totalOSsAbertas * 100));
    } else {
      indiceVetorial.coberturaPct = 100;
    }
  } catch (err) {
    console.warn("[HEALTH] Falha ao verificar \xEDndice vetorial:", err?.message || err);
  }
  let watchdogQueue = {
    pendentes: 0,
    processando: 0,
    falhas: 0
  };
  if (redisClient) {
    try {
      const pendentes = await redisClient.zcard("watchdog:scheduled_evals");
      const locks = await redisClient.keys("evaluating:conv:*");
      watchdogQueue.pendentes = Number(pendentes || 0);
      watchdogQueue.processando = locks ? locks.length : 0;
    } catch (rErr) {
      console.warn("[HEALTH] Falha ao consultar fila watchdog no Redis:", rErr?.message || rErr);
    }
  }
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
    `).get();
    if (aiRow && aiRow.total > 0) {
      telemetriaIA.totalChamadas24h = aiRow.total;
      telemetriaIA.taxaSucessoPct = Math.round((aiRow.sucessos || 0) / aiRow.total * 100);
      telemetriaIA.timeouts = aiRow.timeouts || 0;
      telemetriaIA.indisponibilidades = aiRow.indisponibilidades || 0;
      telemetriaIA.respostasInvalidas = aiRow.respostasInvalidas || 0;
      telemetriaIA.slopFallbacks = aiRow.slopFallbacks || 0;
      telemetriaIA.duracaoMediaMs = Math.round(aiRow.mediaDuracao || 0);
    }
  } catch (err) {
    console.warn("[HEALTH] Falha ao consultar telemetria IA:", err?.message || err);
  }
  let enviosWhatsApp = {
    totalEnvios24h: 0,
    taxaEntregaConfirmadaPct: 100,
    falhasHttp: 0,
    mediaTentativasPorEnvio: 1
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
    `).get();
    if (waRow && waRow.total > 0) {
      enviosWhatsApp.totalEnvios24h = waRow.total;
      enviosWhatsApp.taxaEntregaConfirmadaPct = Math.round((waRow.sucessos || 0) / waRow.total * 100);
      enviosWhatsApp.falhasHttp = waRow.falhas || 0;
      enviosWhatsApp.mediaTentativasPorEnvio = Number((waRow.mediaTentativas || 1).toFixed(2));
    }
  } catch (err) {
    console.warn("[HEALTH] Falha ao consultar envios WhatsApp:", err?.message || err);
  }
  let statusGeral = "HEALTHY";
  const hasCriticalCrawl = crawlers.some((c) => c.status === "ERROR");
  if (metasData.frescor === "CRITICAL" || enviosWhatsApp.taxaEntregaConfirmadaPct < 80) {
    statusGeral = "UNHEALTHY";
  } else if (metasData.frescor === "STALE" || hasCriticalCrawl || indiceVetorial.coberturaPct < 80 || telemetriaIA.taxaSucessoPct < 90) {
    statusGeral = "DEGRADED";
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
function salvarRelatorioOperacao(db, dados) {
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
  console.log(`[DB] \u2705 Relat\xF3rio de Opera\xE7\xE3o sincronizado para loja ${lojaSlug} (${dataInicio} a ${dataFim}).`);
}
function getCMVByStore(db, options) {
  let sql = "SELECT * FROM cmv_lojas";
  const params = [];
  if (options?.lojaSlug) {
    sql += " WHERE LOWER(loja_slug) = LOWER(?)";
    params.push(options.lojaSlug);
  }
  sql += " ORDER BY faturamento_total DESC";
  return db.prepare(sql).all(...params);
}
function getFaturamentoPorArea(db, options) {
  let sql = "SELECT * FROM faturamento_areas";
  const params = [];
  if (options?.lojaSlug) {
    sql += " WHERE LOWER(loja_slug) = LOWER(?)";
    params.push(options.lojaSlug);
  }
  sql += " ORDER BY faturamento DESC";
  return db.prepare(sql).all(...params);
}
function getPesquisaMidia(db, options) {
  let sql = "SELECT * FROM pesquisa_midia";
  const params = [];
  if (options?.lojaSlug) {
    sql += " WHERE LOWER(loja_slug) = LOWER(?)";
    params.push(options.lojaSlug);
  }
  sql += " ORDER BY faturamento DESC";
  return db.prepare(sql).all(...params);
}
var CATALOGO_10_LOJAS = [
  "MPdompedro1",
  "MPJabaquara",
  "MPJorgeBeretta",
  "MPkennedy",
  "MPpiraporinha",
  "MPplanalto",
  "MPrudge",
  "MPSantoAndre",
  "ReiDoModulo",
  "ReiDoOleoMaua"
];
var STORE_DISPLAY_NAMES = {
  "mpdompedro1": "Dom Pedro I",
  "mpjabaquara": "Jabaquara",
  "mpjorgeberetta": "Jorge Beretta",
  "mpkennedy": "Kennedy",
  "mppiraporinha": "Piraporinha",
  "mpplanalto": "Planalto",
  "mprudge": "Rudge Ramos",
  "mpsantoandre": "Santo Andr\xE9",
  "reidomodulo": "Rei do M\xF3dulo",
  "reidooleomaua": "Rei do \xD3leo Mau\xE1",
  "mpmaster": "Master"
};
function getStoreDisplayName(slug) {
  if (!slug) return "Desconhecida";
  return STORE_DISPLAY_NAMES[slug.toLowerCase()] || slug;
}
function formatPeriodoExtenso(dataRef) {
  if (!dataRef) return "per\xEDodo atual";
  const parts = dataRef.split("-");
  if (parts.length < 2) return dataRef;
  const mesIdx = parseInt(parts[1], 10) - 1;
  const meses = [
    "janeiro",
    "fevereiro",
    "mar\xE7o",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro"
  ];
  const mesNome = meses[mesIdx] || parts[1];
  return `${mesNome}/${parts[0]}`;
}
function queryGoalGap(db, options) {
  const maxHours = options?.maxAgeHours ?? 26;
  const frescor = verificarFrescorMetas(db, maxHours);
  if (!frescor.dataMaisRecente) {
    return {
      status: "vazio",
      motivo: "Nenhum registro de metas localizado no banco de dados.",
      periodo: "per\xEDodo atual",
      dataReferencia: "",
      origem: "MAPA_METAS_OFICIAL",
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
        descricao: "0 de 11 lojas com dados dispon\xEDveis."
      }
    };
  }
  const status = frescor.isValido ? "sucesso" : "desatualizado";
  const motivo = frescor.isValido ? void 0 : `Dados de metas coletados h\xE1 ${frescor.idadeHoras} horas (toler\xE2ncia: ${maxHours}h).`;
  const rows = getMetasConsolidadas(db, frescor.dataMaisRecente);
  const eligibleRows = rows.filter((r) => !r.loja_slug?.toLowerCase().includes("master"));
  const slugsPresentes = new Set(eligibleRows.map((r) => r.loja_slug));
  const lojasAusentes = CATALOGO_10_LOJAS.filter((s) => !slugsPresentes.has(s));
  const cobertura = {
    totalLojasElegiveis: 10,
    lojasCompletas: slugsPresentes.size,
    lojasAusentes,
    masterExcluida: true,
    isCompleta: lojasAusentes.length === 0,
    descricao: lojasAusentes.length === 0 ? "10 de 11 lojas operacionais (exclu\xEDda Master)" : `${slugsPresentes.size} de 11 lojas operacionais com dados (faltando: ${lojasAusentes.join(", ")})`
  };
  const periodoStr = formatPeriodoExtenso(frescor.dataMaisRecente);
  if (options?.lojaSlug) {
    const slugNorm = options.lojaSlug.toLowerCase();
    if (slugNorm.includes("master")) {
      return {
        status: "vazio",
        motivo: "Unidade Master \xE9 administrativa e exclu\xEDda das metas e faturamento comercial por regra de neg\xF3cio.",
        lojaSlug: options.lojaSlug,
        nome: "Master",
        periodo: periodoStr,
        dataReferencia: frescor.dataMaisRecente,
        posicaoHora: frescor.posicaoHora || void 0,
        origem: "MAPA_METAS_OFICIAL",
        meta: null,
        faturamentoComparavel: null,
        falta: null,
        atingimentoPercentual: null,
        faltaPercentual: null,
        bateuMeta: false,
        cobertura
      };
    }
    const storeRow = eligibleRows.find((r) => r.loja_slug.toLowerCase() === slugNorm);
    if (!storeRow) {
      return {
        status: "vazio",
        motivo: `Nenhum dado de faturamento/meta localizado para a unidade ${getStoreDisplayName(options.lojaSlug)} no per\xEDodo.`,
        lojaSlug: options.lojaSlug,
        nome: getStoreDisplayName(options.lojaSlug),
        periodo: periodoStr,
        dataReferencia: frescor.dataMaisRecente,
        posicaoHora: frescor.posicaoHora || void 0,
        origem: "MAPA_METAS_OFICIAL",
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
    const meta = storeRow.meta_mes !== null && storeRow.meta_mes !== void 0 ? storeRow.meta_mes : null;
    const prev = storeRow.previsao_mes !== null && storeRow.previsao_mes !== void 0 ? storeRow.previsao_mes : null;
    const hasPositiveMeta = meta !== null && meta > 0;
    const falta = hasPositiveMeta ? Math.max(meta - fat, 0) : null;
    const atingimentoPercentual = hasPositiveMeta ? Number((fat / meta * 100).toFixed(2)) : null;
    const faltaPercentual = hasPositiveMeta ? Number((falta / meta * 100).toFixed(2)) : null;
    const bateuMeta = hasPositiveMeta && fat >= meta;
    return {
      status,
      motivo,
      lojaSlug: storeRow.loja_slug,
      nome: getStoreDisplayName(storeRow.loja_slug),
      periodo: periodoStr,
      dataReferencia: frescor.dataMaisRecente,
      posicaoHora: storeRow.posicao_hora || frescor.posicaoHora || void 0,
      origem: "MAPA_METAS_OFICIAL",
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
  let somaFat = 0;
  let somaMeta = 0;
  let somaPrev = 0;
  let hasValidMetas = false;
  const lojasDetalhadas = eligibleRows.map((r) => {
    const fat = r.faturamento_mes ?? 0;
    const meta = r.meta_mes !== null && r.meta_mes !== void 0 ? r.meta_mes : null;
    const prev = r.previsao_mes !== null && r.previsao_mes !== void 0 ? r.previsao_mes : null;
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
    const atingimento = hasPosMeta ? Number((fat / meta * 100).toFixed(2)) : null;
    const faltaPct = hasPosMeta ? Number((falta / meta * 100).toFixed(2)) : null;
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
      status: "sucesso"
    };
  });
  const faltaRede = hasValidMetas ? Math.max(somaMeta - somaFat, 0) : null;
  const atingimentoRede = hasValidMetas && somaMeta > 0 ? Number((somaFat / somaMeta * 100).toFixed(2)) : null;
  const faltaPctRede = hasValidMetas && somaMeta > 0 ? Number((faltaRede / somaMeta * 100).toFixed(2)) : null;
  const bateuMetaRede = hasValidMetas && somaFat >= somaMeta;
  const lojasNaoBateram = lojasDetalhadas.filter((l) => !l.bateuMeta && l.falta !== null).sort((a, b) => (b.falta ?? 0) - (a.falta ?? 0));
  const lojasBateram = lojasDetalhadas.filter((l) => l.bateuMeta).sort((a, b) => (b.atingimentoPercentual ?? 0) - (a.atingimentoPercentual ?? 0));
  return {
    status,
    motivo,
    periodo: periodoStr,
    dataReferencia: frescor.dataMaisRecente,
    posicaoHora: frescor.posicaoHora || void 0,
    origem: "MAPA_METAS_OFICIAL",
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
function queryStoreCMV(db, options) {
  const slugNorm = (options.lojaSlug || "").trim().toLowerCase();
  if (!options.lojaSlug || !slugNorm || slugNorm === "loja" || slugNorm === "lojas" || slugNorm === "rede" || slugNorm === "geral") {
    return {
      status: "vazio",
      motivo: "Identificador de loja n\xE3o informado ou inv\xE1lido para consulta de CMV individual.",
      origem: "RELATORIO_OPERACAO_OFICIAL",
      scope: "store",
      lojaSlug: options.lojaSlug || "",
      nome: "N\xE3o informada",
      periodo: "per\xEDodo atual",
      dataInicio: "",
      dataFim: "",
      cmvPercentual: null,
      faturamentoTotal: null,
      custoTotal: null,
      descontoTotal: null,
      lucroBruto: null,
      lucroBrutoPercentual: null,
      baseCalculo: "faturamento_bruto",
      areas: []
    };
  }
  if (slugNorm.includes("master")) {
    return {
      status: "vazio",
      motivo: "Unidade Master \xE9 administrativa e exclu\xEDda das an\xE1lises operacionais de CMV por regra cont\xE1bil.",
      origem: "RELATORIO_OPERACAO_OFICIAL",
      scope: "store",
      lojaSlug: options.lojaSlug,
      nome: "Master",
      periodo: "per\xEDodo atual",
      dataInicio: "",
      dataFim: "",
      cmvPercentual: null,
      faturamentoTotal: null,
      custoTotal: null,
      descontoTotal: null,
      lucroBruto: null,
      lucroBrutoPercentual: null,
      baseCalculo: "faturamento_bruto",
      areas: []
    };
  }
  const row = db.prepare(`
    SELECT * FROM cmv_lojas
    WHERE LOWER(loja_slug) = LOWER(?)
    ORDER BY data_fim DESC, id DESC
    LIMIT 1
  `).get(options.lojaSlug);
  if (!row) {
    return {
      status: "vazio",
      motivo: `Nenhum registro de CMV encontrado para a loja ${getStoreDisplayName(options.lojaSlug)} no per\xEDodo atual.`,
      origem: "RELATORIO_OPERACAO_OFICIAL",
      scope: "store",
      lojaSlug: options.lojaSlug,
      nome: getStoreDisplayName(options.lojaSlug),
      periodo: "per\xEDodo atual",
      dataInicio: "",
      dataFim: "",
      cmvPercentual: null,
      faturamentoTotal: null,
      custoTotal: null,
      descontoTotal: null,
      lucroBruto: null,
      lucroBrutoPercentual: null,
      baseCalculo: "faturamento_bruto",
      areas: []
    };
  }
  const maxHours = options.maxAgeHours ?? 26;
  let status = "sucesso";
  let motivo = void 0;
  if (row.created_at) {
    const dtCreated = new Date(row.created_at.includes("T") ? row.created_at : row.created_at.replace(" ", "T") + "Z");
    const idadeHoras = Math.max(0, Math.round((Date.now() - dtCreated.getTime()) / (1e3 * 60 * 60)));
    if (idadeHoras > maxHours) {
      status = "desatualizado";
      motivo = `Dados de CMV coletados h\xE1 ${idadeHoras} horas (toler\xE2ncia: ${maxHours}h).`;
    }
  }
  const areaRows = db.prepare(`
    SELECT * FROM faturamento_areas
    WHERE LOWER(loja_slug) = LOWER(?)
      AND data_inicio = ?
      AND data_fim = ?
    ORDER BY faturamento DESC
  `).all(row.loja_slug, row.data_inicio, row.data_fim);
  const areas = areaRows.map((a) => ({
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
    origem: "RELATORIO_OPERACAO_OFICIAL",
    scope: "store",
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
    baseCalculo: "faturamento_bruto",
    somaCustoAreas,
    diferencaConsolidadoAreas,
    areas
  };
}
function queryNetworkCMV(db, options) {
  const eligibleSlugs = new Set(CATALOGO_10_LOJAS);
  const rows = db.prepare(`
    SELECT c.* FROM cmv_lojas c
    INNER JOIN (
      SELECT loja_slug, MAX(data_fim) as max_fim, MAX(id) as max_id
      FROM cmv_lojas
      GROUP BY loja_slug
    ) m ON c.loja_slug = m.loja_slug AND c.data_fim = m.max_fim AND c.id = m.max_id
    ORDER BY c.cmv_percentual DESC
  `).all();
  const validRows = rows.filter((r) => eligibleSlugs.has(r.loja_slug) && !r.loja_slug.toLowerCase().includes("master"));
  const presentes = new Set(validRows.map((r) => r.loja_slug));
  const lojasAusentes = CATALOGO_10_LOJAS.filter((s) => !presentes.has(s));
  const lojasCompletas = validRows.length;
  const isCompleta = lojasCompletas === 10;
  const cobertura = {
    totalLojasElegiveis: 10,
    lojasCompletas,
    lojasAusentes,
    masterExcluida: true,
    isCompleta,
    descricao: isCompleta ? "10 de 10 lojas operacionais apuradas." : `${lojasCompletas} de 10 lojas operacionais apuradas (parcial, exclu\xEDda Master).`
  };
  if (validRows.length === 0) {
    return {
      status: "vazio",
      motivo: "Nenhum registro de CMV dispon\xEDvel para as lojas da rede no momento.",
      origem: "RELATORIO_OPERACAO_OFICIAL",
      scope: "network",
      periodo: "per\xEDodo atual",
      cmvConsolidadoPercentual: null,
      somaCustosCompativeis: null,
      somaFaturamentosBaseCompativeis: null,
      lucroBrutoConsolidado: null,
      lucroBrutoConsolidadoPercentual: null,
      baseCalculo: "faturamento_bruto",
      cobertura,
      lojasDetalhadas: []
    };
  }
  const somaCustosCompativeis = Number(validRows.reduce((acc, r) => acc + (r.custo_total || 0), 0).toFixed(2));
  const somaFaturamentosBaseCompativeis = Number(validRows.reduce((acc, r) => acc + (r.faturamento_total || 0), 0).toFixed(2));
  const cmvConsolidadoPercentual = somaFaturamentosBaseCompativeis > 0 ? Number((somaCustosCompativeis / somaFaturamentosBaseCompativeis * 100).toFixed(2)) : null;
  const lucroBrutoConsolidado = Number((somaFaturamentosBaseCompativeis - somaCustosCompativeis).toFixed(2));
  const lucroBrutoConsolidadoPercentual = cmvConsolidadoPercentual != null ? Number((100 - cmvConsolidadoPercentual).toFixed(2)) : null;
  const lojasDetalhadas = validRows.map((r) => ({
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
    status: "sucesso"
  }));
  const sortedByCMV = [...lojasDetalhadas].sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0));
  const piorLoja = sortedByCMV[0];
  const maxCreated = validRows.reduce((max, r) => !max || r.created_at && r.created_at > max ? r.created_at : max, "");
  const periodoStr = formatPeriodoExtenso(validRows[0]?.data_inicio);
  return {
    status: isCompleta ? "sucesso" : "parcial",
    motivo: isCompleta ? void 0 : `Dados dispon\xEDveis de ${lojasCompletas} das 10 lojas eleg\xEDveis da rede (fechamento parcial).`,
    origem: "RELATORIO_OPERACAO_OFICIAL",
    scope: "network",
    periodo: periodoStr,
    dataInicio: validRows[0]?.data_inicio,
    dataFim: validRows[0]?.data_fim,
    capturedAt: maxCreated || validRows[0]?.created_at,
    cmvConsolidadoPercentual,
    somaCustosCompativeis,
    somaFaturamentosBaseCompativeis,
    lucroBrutoConsolidado,
    lucroBrutoConsolidadoPercentual,
    baseCalculo: "faturamento_bruto",
    cobertura,
    lojasDetalhadas,
    piorLoja
  };
}
function queryAllStoresCMV(db, options) {
  const eligibleSlugs = new Set(CATALOGO_10_LOJAS);
  const rows = db.prepare(`
    SELECT c.* FROM cmv_lojas c
    INNER JOIN (
      SELECT loja_slug, MAX(data_fim) as max_fim, MAX(id) as max_id
      FROM cmv_lojas
      GROUP BY loja_slug
    ) m ON c.loja_slug = m.loja_slug AND c.data_fim = m.max_fim AND c.id = m.max_id
    ORDER BY c.cmv_percentual DESC
  `).all();
  const storeMap = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (eligibleSlugs.has(r.loja_slug)) {
      storeMap.set(r.loja_slug.toLowerCase(), r);
    }
  }
  const presentes = [];
  const ausentes = [];
  const lojas = [];
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
        status: "sucesso"
      });
    } else {
      ausentes.push(slug);
      lojas.push({
        lojaSlug: slug,
        nome: getStoreDisplayName(slug),
        periodo: "m\xEAs atual",
        cmvPercentual: null,
        faturamentoTotal: null,
        custoTotal: null,
        lucroBruto: null,
        lucroBrutoPercentual: null,
        status: "vazio",
        motivo: "Dado de CMV n\xE3o dispon\xEDvel no per\xEDodo"
      });
    }
  }
  const isCompleta = ausentes.length === 0;
  const cobertura = {
    totalLojasElegiveis: 10,
    lojasCompletas: presentes.length,
    lojasAusentes: ausentes,
    masterExcluida: true,
    isCompleta,
    descricao: isCompleta ? "10 de 10 lojas operacionais apuradas." : `${presentes.length} de 10 lojas operacionais apuradas (${ausentes.length} pendentes).`
  };
  const rankingCMV = lojas.filter((l) => l.cmvPercentual != null).sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0));
  const piorLoja = rankingCMV[0];
  const maxCreated = rows.reduce((max, r) => !max || r.created_at && r.created_at > max ? r.created_at : max, "");
  return {
    status: isCompleta ? "sucesso" : "parcial",
    motivo: isCompleta ? void 0 : `Dados dispon\xEDveis de ${presentes.length} das 10 lojas eleg\xEDveis da rede.`,
    origem: "RELATORIO_OPERACAO_OFICIAL",
    scope: "all_stores",
    periodo: lojas.find((l) => l.dataInicio)?.periodo || "m\xEAs atual",
    capturedAt: maxCreated || void 0,
    cobertura,
    lojas,
    rankingCMV,
    piorLoja
  };
}
function queryUnifiedCMV(db, options) {
  const isInvalid = !options.lojaSlug || ["loja", "lojas", "rede", "todas", "null", "undefined", ""].includes(options.lojaSlug.toLowerCase().trim());
  const scope = options.scope || (isInvalid ? "network" : "store");
  if (scope === "network") {
    return queryNetworkCMV(db, { maxAgeHours: options.maxAgeHours });
  }
  if (scope === "all_stores") {
    return queryAllStoresCMV(db, { maxAgeHours: options.maxAgeHours });
  }
  return queryStoreCMV(db, { lojaSlug: options.lojaSlug || "", maxAgeHours: options.maxAgeHours });
}
function queryStoreAreas(db, options) {
  const cmvResult = queryStoreCMV(db, options);
  if (cmvResult.status === "vazio") {
    return {
      status: "vazio",
      motivo: cmvResult.motivo,
      origem: "RELATORIO_OPERACAO_OFICIAL",
      lojaSlug: options.lojaSlug,
      nome: getStoreDisplayName(options.lojaSlug),
      periodo: "per\xEDodo atual",
      dataInicio: "",
      dataFim: "",
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
    origem: "RELATORIO_OPERACAO_OFICIAL",
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
function queryAreaCMVByStore(db, options) {
  const targetArea = (options.area || "OLEO").toUpperCase().trim();
  const eligibleSlugs = new Set(CATALOGO_10_LOJAS);
  if (options.scope === "store" && options.lojaSlug) {
    const slugNorm = options.lojaSlug.trim();
    const nome = getStoreDisplayName(slugNorm);
    const row = db.prepare(`
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
        periodo: "m\xEAs atual",
        cmvPercentual: null,
        faturamento: null,
        custo: null,
        lucroBruto: null,
        lucroBrutoPercentual: null,
        status: "vazio",
        motivo: `Dado de CMV n\xE3o dispon\xEDvel para a \xE1rea ${targetArea} na unidade ${nome}`
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
      status: "sucesso"
    };
  }
  const rows = db.prepare(`
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
  const rowMap = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (eligibleSlugs.has(r.loja_slug)) {
      rowMap.set(r.loja_slug.toLowerCase(), r);
    }
  }
  const lojasApuradas = [];
  const lojasPendentes = [];
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
        status: "sucesso"
      });
    } else {
      lojasPendentes.push({
        lojaSlug: slug,
        nome,
        area: targetArea,
        periodo: "m\xEAs atual",
        cmvPercentual: null,
        faturamento: null,
        custo: null,
        lucroBruto: null,
        lucroBrutoPercentual: null,
        status: "vazio",
        motivo: `Dado n\xE3o dispon\xEDvel na \xE1rea ${targetArea}`
      });
    }
  }
  const rankingCMV = [...lojasApuradas].sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0));
  const isCompleta = lojasPendentes.length === 0;
  const coberturaDescricao = isCompleta ? "10 de 10 lojas operacionais apuradas." : `${lojasApuradas.length} de 10 lojas operacionais apuradas (${lojasPendentes.length} pendentes).`;
  return {
    status: isCompleta ? "sucesso" : lojasApuradas.length > 0 ? "parcial" : "vazio",
    area: targetArea,
    periodo: lojasApuradas[0]?.periodo || "m\xEAs atual",
    totalLojasElegiveis: 10,
    lojasCompletas: lojasApuradas.length,
    coberturaDescricao,
    lojasApuradas,
    lojasPendentes,
    rankingCMV,
    origem: "FATURAMENTO_AREAS_OFICIAL"
  };
}
function queryStoreMediaSurvey(db, options) {
  const slugNorm = (options.lojaSlug || "").trim().toLowerCase();
  if (slugNorm.includes("master")) {
    return {
      status: "vazio",
      motivo: "Unidade Master \xE9 administrativa e exclu\xEDda de pesquisa de m\xEDdia.",
      origem: "RELATORIO_OPERACAO_OFICIAL",
      lojaSlug: options.lojaSlug,
      nome: "Master",
      periodo: "per\xEDodo atual",
      dataInicio: "",
      dataFim: "",
      totalFaturado: null,
      totalOS: null,
      canais: []
    };
  }
  const rows = db.prepare(`
    SELECT * FROM pesquisa_midia
    WHERE LOWER(loja_slug) = LOWER(?)
    ORDER BY data_fim DESC, faturamento DESC
  `).all(options.lojaSlug);
  if (rows.length === 0) {
    return {
      status: "vazio",
      motivo: `Nenhum dado de pesquisa de m\xEDdia localizado para a unidade ${getStoreDisplayName(options.lojaSlug)}.`,
      origem: "RELATORIO_OPERACAO_OFICIAL",
      lojaSlug: options.lojaSlug,
      nome: getStoreDisplayName(options.lojaSlug),
      periodo: "per\xEDodo atual",
      dataInicio: "",
      dataFim: "",
      totalFaturado: null,
      totalOS: null,
      canais: []
    };
  }
  const maxHours = options.maxAgeHours ?? 26;
  let status = "sucesso";
  let motivo = void 0;
  const firstRow = rows[0];
  if (firstRow.created_at) {
    const dtCreated = new Date(firstRow.created_at.includes("T") ? firstRow.created_at : firstRow.created_at.replace(" ", "T") + "Z");
    const idadeHoras = Math.max(0, Math.round((Date.now() - dtCreated.getTime()) / (1e3 * 60 * 60)));
    if (idadeHoras > maxHours) {
      status = "desatualizado";
      motivo = `Dados de m\xEDdia coletados h\xE1 ${idadeHoras} horas (toler\xE2ncia: ${maxHours}h).`;
    }
  }
  const recentRows = rows.filter((r) => r.data_inicio === firstRow.data_inicio && r.data_fim === firstRow.data_fim);
  const canais = recentRows.map((r) => ({
    canal: r.canal,
    faturamento: r.faturamento,
    faturamentoPercentual: r.faturamento_percentual ?? 0,
    qtdOS: r.qtd_os ?? 0,
    ticketMedio: r.ticket_medio ?? (r.qtd_os > 0 ? r.faturamento / r.qtd_os : 0)
  }));
  const totalFaturado = Number(canais.reduce((acc, c) => acc + c.faturamento, 0).toFixed(2));
  const totalOS = canais.reduce((acc, c) => acc + c.qtdOS, 0);
  const canalPrincipal = canais.length > 0 ? canais[0] : void 0;
  return {
    status,
    motivo,
    origem: "RELATORIO_OPERACAO_OFICIAL",
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
function queryGoogleCentralMediaSurvey(db, options = {}) {
  const isAll = !options.lojaSlug || options.lojaSlug === "all_stores" || options.lojaSlug === "lojas" || options.lojaSlug === "rede";
  if (!isAll && options.lojaSlug) {
    const slugNorm = options.lojaSlug.trim().toLowerCase();
    if (slugNorm.includes("master")) {
      return {
        status: "vazio",
        motivo: "Unidade Master \xE9 administrativa e exclu\xEDda de pesquisa de m\xEDdia.",
        origem: "RELATORIO_OPERACAO_OFICIAL",
        isAllStores: false
      };
    }
    const rows = db.prepare(`
      SELECT * FROM pesquisa_midia
      WHERE LOWER(loja_slug) = LOWER(?)
      ORDER BY data_fim DESC, faturamento DESC
    `).all(options.lojaSlug);
    const nome = getStoreDisplayName(options.lojaSlug);
    if (rows.length === 0) {
      return {
        status: "vazio",
        motivo: `Dados de pesquisa de m\xEDdia (Google e Central de Atendimento) n\xE3o dispon\xEDveis para a unidade *${nome}* no per\xEDodo apurado.`,
        origem: "RELATORIO_OPERACAO_OFICIAL",
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
    const recentRows = rows.filter((r) => r.data_inicio === firstRow.data_inicio && r.data_fim === firstRow.data_fim);
    const rowGoogle = recentRows.find((r) => (r.canal || "").toUpperCase().includes("GOOGLE"));
    const rowCentral = recentRows.find((r) => (r.canal || "").toUpperCase().includes("CENTRAL"));
    const canalGoogle = rowGoogle ? {
      canal: rowGoogle.canal,
      faturamento: rowGoogle.faturamento,
      faturamentoPercentual: rowGoogle.faturamento_percentual ?? 0,
      qtdOS: rowGoogle.qtd_os ?? 0,
      ticketMedio: rowGoogle.ticket_medio ?? (rowGoogle.qtd_os > 0 ? rowGoogle.faturamento / rowGoogle.qtd_os : 0)
    } : null;
    const canalCentral = rowCentral ? {
      canal: rowCentral.canal,
      faturamento: rowCentral.faturamento,
      faturamentoPercentual: rowCentral.faturamento_percentual ?? 0,
      qtdOS: rowCentral.qtd_os ?? 0,
      ticketMedio: rowCentral.ticket_medio ?? (rowCentral.qtd_os > 0 ? rowCentral.faturamento / rowCentral.qtd_os : 0)
    } : null;
    const totalGoogleCentral = Number(((canalGoogle?.faturamento || 0) + (canalCentral?.faturamento || 0)).toFixed(2));
    const totalOSGoogleCentral = (canalGoogle?.qtdOS || 0) + (canalCentral?.qtdOS || 0);
    let faturamentoBrutoLoja = null;
    try {
      const cmvRow = db.prepare(`SELECT faturamento_total FROM cmv_lojas WHERE LOWER(loja_slug) = LOWER(?) LIMIT 1`).get(options.lojaSlug);
      if (cmvRow && cmvRow.faturamento_total) {
        faturamentoBrutoLoja = Number(cmvRow.faturamento_total);
      } else {
        const areaSum = db.prepare(`SELECT SUM(faturamento) as tot FROM faturamento_areas WHERE LOWER(loja_slug) = LOWER(?)`).get(options.lojaSlug);
        if (areaSum && areaSum.tot) {
          faturamentoBrutoLoja = Number(areaSum.tot);
        } else {
          faturamentoBrutoLoja = Number(recentRows.reduce((s, r) => s + (r.faturamento || 0), 0).toFixed(2));
        }
      }
    } catch {
    }
    const pctGoogleCentralDoFaturamento = faturamentoBrutoLoja && faturamentoBrutoLoja > 0 ? Number((totalGoogleCentral / faturamentoBrutoLoja * 100).toFixed(1)) : null;
    return {
      status: "sucesso",
      origem: "RELATORIO_OPERACAO_OFICIAL",
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
  const lojasApuradas = [];
  const lojasSemDados = [];
  let commonDataInicio = "";
  let commonDataFim = "";
  for (const slug of CATALOGO_10_LOJAS) {
    if (slug === "MPMaster") continue;
    const nome = getStoreDisplayName(slug);
    const rows = db.prepare(`
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
    const recentRows = rows.filter((r) => r.data_inicio === firstRow.data_inicio && r.data_fim === firstRow.data_fim);
    const rowGoogle = recentRows.find((r) => (r.canal || "").toUpperCase().includes("GOOGLE"));
    const rowCentral = recentRows.find((r) => (r.canal || "").toUpperCase().includes("CENTRAL"));
    const canalGoogle = rowGoogle ? {
      canal: rowGoogle.canal,
      faturamento: rowGoogle.faturamento,
      faturamentoPercentual: rowGoogle.faturamento_percentual ?? 0,
      qtdOS: rowGoogle.qtd_os ?? 0,
      ticketMedio: rowGoogle.ticket_medio ?? (rowGoogle.qtd_os > 0 ? rowGoogle.faturamento / rowGoogle.qtd_os : 0)
    } : null;
    const canalCentral = rowCentral ? {
      canal: rowCentral.canal,
      faturamento: rowCentral.faturamento,
      faturamentoPercentual: rowCentral.faturamento_percentual ?? 0,
      qtdOS: rowCentral.qtd_os ?? 0,
      ticketMedio: rowCentral.ticket_medio ?? (rowCentral.qtd_os > 0 ? rowCentral.faturamento / rowCentral.qtd_os : 0)
    } : null;
    const totalGoogleCentral = Number(((canalGoogle?.faturamento || 0) + (canalCentral?.faturamento || 0)).toFixed(2));
    const totalOSGoogleCentral = (canalGoogle?.qtdOS || 0) + (canalCentral?.qtdOS || 0);
    let faturamentoBrutoLoja = null;
    try {
      const cmvRow = db.prepare(`SELECT faturamento_total FROM cmv_lojas WHERE LOWER(loja_slug) = LOWER(?) LIMIT 1`).get(slug);
      if (cmvRow && cmvRow.faturamento_total) faturamentoBrutoLoja = Number(cmvRow.faturamento_total);
    } catch {
    }
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
    status: "sucesso",
    origem: "RELATORIO_OPERACAO_OFICIAL",
    isAllStores: true,
    periodo: commonDataInicio ? formatPeriodoExtenso(commonDataInicio) : "m\xEAs atual",
    dataInicio: commonDataInicio,
    dataFim: commonDataFim,
    lojasApuradas,
    lojasSemDados
  };
}
function queryNetworkFinancialOverview(db, options) {
  const goalGap = queryGoalGap(db, options);
  const totalFat = goalGap.faturamentoComparavel ?? 0;
  const totalMeta = goalGap.meta ?? 0;
  const faltaTotal = goalGap.falta ?? 0;
  const atingimentoTotal = goalGap.atingimentoPercentual ?? 0;
  let totalOS = 0;
  const lojas = (goalGap.lojasDetalhadas || []).map((l) => {
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
    origem: "MAPA_METAS_OFICIAL",
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
function parseOSDetailRow(row) {
  let payload = {};
  if (row.raw_payload) {
    try {
      payload = typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload;
    } catch {
      payload = {};
    }
  }
  const valorTotal = Number(row.total_os ?? payload.total_os ?? payload.valorTotal ?? 0);
  const valorPago = Number(row.valor_pago ?? payload.valor_pago ?? payload.valorPago ?? 0);
  const saldoDevedor = Number(
    row.valor_restante ?? payload.valor_restante ?? payload.saldoDevedor ?? Math.max(0, valorTotal - valorPago)
  );
  const servicos = [];
  const pecas = [];
  if (Array.isArray(payload.servicos)) {
    for (const s of payload.servicos) {
      if (!s) continue;
      servicos.push({
        codigo: s.codigo || void 0,
        descricao: s.descricao || s.nome || "Servi\xE7o",
        mecanico: s.mecanico || s.executor || void 0,
        executor: s.executor || s.mecanico || void 0,
        qtd: Number(s.qtd || 1),
        valorUnitario: Number(s.valor_unitario ?? s.valorUnitario ?? 0),
        valorTotal: Number(s.valor_total ?? s.valorTotal ?? 0)
      });
    }
  }
  if (Array.isArray(payload.pecas)) {
    for (const p of payload.pecas) {
      if (!p) continue;
      pecas.push({
        codigo: p.codigo || void 0,
        referencia: p.referencia || void 0,
        descricao: p.descricao || p.nome || "Pe\xE7a",
        qtd: Number(p.qtd || 1),
        valorUnitario: Number(p.valor_unitario ?? p.valorUnitario ?? 0),
        valorTotal: Number(p.valor_total ?? p.valorTotal ?? 0)
      });
    }
  }
  if (servicos.length === 0 && pecas.length === 0 && Array.isArray(payload.itens)) {
    for (const item of payload.itens) {
      if (!item) continue;
      const isService = Boolean(
        item.executor || item.mecanico || item.tipo && item.tipo.toLowerCase().includes("servi") || item.grupo && item.grupo.toLowerCase().includes("servi")
      );
      if (isService) {
        servicos.push({
          codigo: item.codigo || void 0,
          descricao: item.descricao || "Servi\xE7o",
          mecanico: item.executor || item.mecanico || "Mec\xE2nico da Loja",
          executor: item.executor || item.mecanico || "Mec\xE2nico da Loja",
          qtd: Number(item.qtd || 1),
          valorUnitario: Number(item.valor_unitario ?? item.valorUnitario ?? 0),
          valorTotal: Number(item.valor_total ?? item.valorTotal ?? 0)
        });
      } else {
        pecas.push({
          codigo: item.codigo || void 0,
          referencia: item.referencia || void 0,
          descricao: item.descricao || "Pe\xE7a",
          qtd: Number(item.qtd || 1),
          valorUnitario: Number(item.valor_unitario ?? item.valorUnitario ?? 0),
          valorTotal: Number(item.valor_total ?? item.valorTotal ?? 0)
        });
      }
    }
  }
  const rawLists = Array.isArray(payload.checklists) ? payload.checklists : [];
  const checklists = rawLists.map((c) => ({
    codigo: c.codigo || void 0,
    tipo: c.tipo || "Check-List",
    status: c.status || "Conclu\xEDdo",
    realizadoPor: c.realizado_por || c.realizadoPor || void 0,
    data: c.data || void 0,
    hodometro: c.hodometro || void 0,
    progresso: c.progresso || void 0
  }));
  const temChecklistEntrada = rawLists.some((c) => c && c.tipo && (c.tipo.toLowerCase().includes("inspe") || c.tipo.toLowerCase().includes("entrada")));
  const temChecklistMecanico = rawLists.some((c) => c && c.tipo && (c.tipo.toLowerCase().includes("mecanic") || c.tipo.toUpperCase() === "MECANICO"));
  let auditStatus = "sem_checklists";
  let auditDetalhes = "Nenhum checklist registrado para esta OS.";
  if (temChecklistEntrada && temChecklistMecanico) {
    auditStatus = "completo";
    auditDetalhes = "Checklists de Inspe\xE7\xE3o de Entrada e do Mec\xE2nico realizados.";
  } else if (temChecklistEntrada && !temChecklistMecanico) {
    auditStatus = "pendente_mecanico";
    auditDetalhes = "Checklist de Entrada realizado; Checklist do Mec\xE2nico pendente.";
  } else if (!temChecklistEntrada && temChecklistMecanico) {
    auditStatus = "pendente_entrada";
    auditDetalhes = "Checklist do Mec\xE2nico realizado; Checklist de Entrada pendente.";
  }
  return {
    osId: String(row.os_id),
    lojaSlug: row.loja_slug,
    tipo: row.tipo || payload.tipo || "OS",
    situacao: row.status_grid || payload.status_grid || (row.is_aberta ? "ABERTO" : "FECHADO"),
    dataAbertura: row.data_inicio || payload.data_inicio || payload.dataAbertura || "",
    dataPromessa: row.data_fim || payload.data_fim || payload.previsao || payload.dataPromessa || "",
    valorTotal,
    valorPago,
    saldoDevedor,
    veiculo: row.veiculo || payload.veiculo || "N\xE3o informado",
    placa: row.placa || payload.placa || "Sem placa",
    clienteNome: row.cliente_nome || payload.cliente_nome || payload.cliente || "N\xE3o informado",
    responsavel: row.responsavel || payload.responsavel || void 0,
    diasNoPatio: Number(row.dias_no_patio ?? payload.dias_no_patio ?? 0),
    isAberta: row.is_aberta != null ? Boolean(row.is_aberta) : true,
    temNf: row.tem_nf != null ? Boolean(row.tem_nf) : false,
    servicos,
    pecas,
    checklists,
    checklistAudit: {
      temChecklistEntrada,
      temChecklistMecanico,
      status: auditStatus,
      detalhes: auditDetalhes
    },
    rawPayload: payload
  };
}
function getOSDetailComplete(db, lojaSlug, osId) {
  if (!lojaSlug || !osId) return null;
  try {
    const row = db.prepare(`
      SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
             data_inicio, data_fim, dias_no_patio, veiculo, placa,
             cliente_nome, responsavel, total_os, valor_pago, valor_restante,
             tem_nf, raw_payload, updated_at
      FROM ordens_servico
      WHERE os_id = ? AND LOWER(loja_slug) = LOWER(?)
    `).get(String(osId).trim(), String(lojaSlug).trim());
    if (!row) {
      const fallbackRow = db.prepare(`
        SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
               data_inicio, data_fim, dias_no_patio, veiculo, placa,
               cliente_nome, responsavel, total_os, valor_pago, valor_restante,
               tem_nf, raw_payload, updated_at
        FROM ordens_servico
        WHERE os_id = ?
        LIMIT 1
      `).get(String(osId).trim());
      if (fallbackRow && fallbackRow.loja_slug.toLowerCase() === lojaSlug.toLowerCase()) {
        return parseOSDetailRow(fallbackRow);
      }
      return null;
    }
    return parseOSDetailRow(row);
  } catch (err) {
    console.error("[DB] Erro ao buscar getOSDetailComplete:", err?.message || err);
    return null;
  }
}
function initHydraAccessAndMemorySchema(db) {
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
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active, can_simulate_persona)
      VALUES 
        ('5511996242812', 'Davi', 'socio', '["*"]', 1, 1),
        ('5511970671717', 'Marcos', 'socio', '["*"]', 1, 1)
      ON CONFLICT(phone) DO NOTHING
    `).run();
    db.prepare(`
      INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name)
      VALUES
        ('5511996242812@s.whatsapp.net', '5511996242812', 'PN', 'Davi'),
        ('5511970671717@s.whatsapp.net', '5511970671717', 'PN', 'Marcos')
      ON CONFLICT(remote_jid) DO NOTHING
    `).run();
  } catch (err) {
    console.warn("[ACCESS_MEMORY_SCHEMA] Erro ao inicializar schema de acesso e memoria:", err?.message || err);
  }
}
export {
  CATALOGO_10_LOJAS,
  STORE_DISPLAY_NAMES,
  backfillDatasOrdensServico,
  calcularDiasNoPatio,
  carregarLoteControlado30Dias,
  checkVectorExtensionStatus,
  formalizarTransicaoNominalOS,
  formatIsoTimestamp,
  getAgingCars,
  getCMVByStore,
  getChecklistAudit,
  getConversationHistory,
  getDatabaseConnection,
  getFaturamentoPorArea,
  getFinancialAlerts,
  getHighestValueOS,
  getHydraHealthSnapshot,
  getMetasConsolidadas,
  getOSByItemCount,
  getOSDetailComplete,
  getPatioOverview,
  getPesquisaMidia,
  getRecentInteractionContext,
  getStoreDisplayName,
  getStoreDrilldown,
  initHydraAccessAndMemorySchema,
  initSchema,
  insertAgentFeedback,
  insertAgentInteractionLog,
  isWebhookMessageProcessed,
  isolarInvestigarOS9202,
  limparStagingAntigo,
  limparWebhookDedupAntigo,
  loadVectorExtension,
  marcarWebhookMessageProcessed,
  obterUltimaExecucaoLoja,
  parseBrDateToIso,
  queryAllStoresCMV,
  queryAreaCMVByStore,
  queryGoalGap,
  queryGoogleCentralMediaSurvey,
  queryNetworkCMV,
  queryNetworkFinancialOverview,
  queryStoreAreas,
  queryStoreCMV,
  queryStoreMediaSurvey,
  queryUnifiedCMV,
  rebuildFTSIndex,
  registrarEntregaWhatsApp,
  registrarExecucaoCrawl,
  registrarTelemetriaIA,
  salvarLoteOSs,
  salvarMetasDiarias,
  salvarRelatorioOperacao,
  sanearOrdensDivergentesExistentes,
  saveConversationMessage,
  searchOS,
  semanticSearchOS,
  swapAtomicoVetores,
  upsertOSEmbedding,
  verificarFrescorMetas
};
