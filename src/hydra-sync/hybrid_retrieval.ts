/**
 * Módulo de Recuperação Operacional Híbrida do Hydra (Agente 3)
 * Integração em 4 Camadas:
 * 1. SQL Parametrizado Exato (B-Tree) para Placas, OSs e Filtros Estruturados
 * 2. Busca Lexical FTS5 com remoção de diacríticos e sanitização anti-syntax error
 * 3. Busca Semântica Vetorial KNN (sqlite-vec 384d) com eliminação de órfãos
 * 4. Fusão Híbrida via Reciprocal Rank Fusion (RRF k=60) para consultas mistas
 */

import Database from 'better-sqlite3';
import { loadVectorExtension } from './db_repository.js';
import { getEmbedder } from './embeddings.js';

export type RetrievalSource = 'SQL_EXACT' | 'FTS5' | 'VEC_KNN' | 'HYBRID_RRF' | 'NONE';

export interface CanonicalIntent {
  turnId?: string;
  canonicalQuestion: string;
  intent: string;
  veiculo?: string;
  sortField?: 'valor_total' | 'valor_restante' | 'dias_no_patio' | 'data_inicio';
  sortDirection?: 'ASC' | 'DESC';
  limit?: number; // Ex: 'CONSULTA_PATIO' | 'CONSULTA_OS' | 'BUSCA_VEICULO' | 'BUSCA_SERVICO' | 'ALERTAS_FINANCEIROS' | 'METAS' | 'GERAL'
  lojaSlug?: string;
  placa?: string;
  osId?: string;
  onlyOpen?: boolean;
  noDeposit?: boolean;
  serviceTerms?: string;
  needsClarification?: boolean;
}

export interface OperationalRecord {
  os_id: string;
  loja_slug: string;
  tipo: string;
  status_grid: string;
  is_aberta: number;
  data_inicio: string;
  data_fim?: string | null;
  dias_no_patio: number;
  veiculo: string;
  placa: string;
  cliente_nome: string;
  responsavel?: string;
  total_os: number;
  valor_pago: number;
  valor_restante: number;
  tem_nf: number;
  score?: number;
}

export interface RetrievalResult {
  source: RetrievalSource;
  records: OperationalRecord[];
  filtersApplied: {
    lojaSlug?: string;
    placa?: string;
    osId?: string;
    onlyOpen?: boolean;
    noDeposit?: boolean;
  };
}

export interface RRFConfig {
  k: number;        // Constante de amortecimento (Padrão: 60)
  ftsWeight: number; // Peso FTS5 (Padrão: 1.0)
  vecWeight: number; // Peso Vetor (Padrão: 1.0)
  limit: number;    // Limite final (Padrão: 5)
}

const DEFAULT_RRF_CONFIG: RRFConfig = {
  k: 60,
  ftsWeight: 1.0,
  vecWeight: 1.0,
  limit: 5,
};

export const STORE_ALIASES: Record<string, string> = {
  'dom pedro': 'MPdompedro1',
  'dompedro': 'MPdompedro1',
  'rudge': 'MPrudge',
  'piraporinha': 'MPpiraporinha',
  'pirapora': 'MPpiraporinha',
  'jabaquara': 'MPJabaquara',
  'santo andre': 'MPSantoAndre',
  'santoandre': 'MPSantoAndre',
  'kennedy': 'MPkennedy',
  'maua': 'ReiDoOleoMaua',
  'rei do oleo': 'ReiDoOleoMaua',
  'planalto': 'MPplanalto',
  'master': 'MPMaster',
  'modulo': 'ReiDoModulo',
  'rei do modulo': 'ReiDoModulo',
  'beretta': 'MPJorgeBeretta',
  'jorge beretta': 'MPJorgeBeretta'
};

/**
 * Normaliza número de placa (remove hífens, espaços e padroniza em maiúsculas).
 */
export function normalizePlaca(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 5 || clean.length > 8) return undefined;
  return clean;
}

/**
 * Normaliza número de OS.
 */
export function normalizeOSId(raw?: string | number): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().replace(/^OS[-_#\s]*/i, '');
  const digits = s.replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}

/**
 * Normaliza e resolve slug canônico de loja a partir de alias ou nome.
 */
export function normalizeLojaSlug(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim();
  const lower = clean.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Match direto em valores oficiais
  const exactValues = Object.values(STORE_ALIASES);
  if (exactValues.includes(clean)) return clean;
  const matchValue = exactValues.find(v => v.toLowerCase() === lower);
  if (matchValue) return matchValue;

  // 2. Match em chaves de alias
  for (const [alias, canonical] of Object.entries(STORE_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return canonical;
    }
  }

  return clean;
}

/**
 * Sanitiza e escapa termos de busca para FTS5 com segurança absoluta contra injeção de operadores SQLite.
 */
export function escapeFtsQuery(rawTerm: string): string {
  if (!rawTerm) return '';
  // Extrai apenas tokens alfanuméricos preservando acentos
  const tokens = rawTerm
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1);

  if (tokens.length === 0) return '';
  // Formata cada token em aspas duplas com prefixo wildcard seguro
  return tokens.map(t => `"${t}"*`).join(' AND ');
}

/**
 * Tier 1: Recuperação por SQL Parametrizado Exato (B-Tree)
 */
export function executeExactSqlSearch(
  db: Database.Database,
  filters: {
    osId?: string;
    placa?: string;
    lojaSlug?: string;
    veiculo?: string;
    onlyOpen?: boolean;
    noDeposit?: boolean;
    sortField?: 'valor_total' | 'valor_restante' | 'dias_no_patio' | 'data_inicio';
    sortDirection?: 'ASC' | 'DESC';
    limit?: number;
  }
): OperationalRecord[] {
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (filters.osId) {
    whereClauses.push('os.os_id = ?');
    params.push(filters.osId);
  }

  if (filters.placa) {
    whereClauses.push("REPLACE(UPPER(os.placa), '-', '') = ?");
    params.push(filters.placa);
  }

  if (filters.lojaSlug) {
    whereClauses.push('os.loja_slug = ?');
    params.push(filters.lojaSlug);
  }

  if (filters.onlyOpen) {
    whereClauses.push('os.is_aberta = 1');
  }

  if (filters.noDeposit) {
    whereClauses.push('os.valor_pago <= 0 AND os.valor_restante > 0');
  }

  if (filters.veiculo) {
    whereClauses.push('(UPPER(os.veiculo) LIKE ? OR os.veiculo LIKE ?)');
    params.push('%' + filters.veiculo.toUpperCase() + '%', '%' + filters.veiculo + '%');
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limit = filters.limit || 10;

  const sql = `
    SELECT 
      os.os_id, os.loja_slug, os.tipo, os.status_grid, os.is_aberta,
      os.data_inicio, os.data_fim, os.dias_no_patio, os.veiculo, os.placa,
      os.cliente_nome, os.responsavel, os.total_os, os.valor_pago, os.valor_restante, os.tem_nf
    FROM ordens_servico os
    ${whereSql}
    ${filters.sortField === 'dias_no_patio'
      ? 'ORDER BY os.is_aberta DESC, os.dias_no_patio DESC, os.data_inicio ASC'
      : (filters.sortField === 'valor_restante'
        ? 'ORDER BY os.is_aberta DESC, os.valor_restante DESC'
        : (filters.sortField === 'data_inicio'
          ? 'ORDER BY os.is_aberta DESC, os.data_inicio ASC'
          : 'ORDER BY os.is_aberta DESC, os.total_os DESC'))}
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit) as OperationalRecord[];
}

/**
 * Tier 2: Recuperação Lexical FTS5
 */
export function executeFtsSearch(
  db: Database.Database,
  termo: string,
  filters: {
    lojaSlug?: string;
    veiculo?: string;
    onlyOpen?: boolean;
    noDeposit?: boolean;
    limit?: number;
  }
): OperationalRecord[] {
  const escapedQuery = escapeFtsQuery(termo);
  if (!escapedQuery) return [];

  const whereClauses: string[] = ['ordens_servico_fts MATCH ?'];
  const params: any[] = [escapedQuery];

  if (filters.lojaSlug) {
    whereClauses.push('os.loja_slug = ?');
    params.push(filters.lojaSlug);
  }

  if (filters.onlyOpen) {
    whereClauses.push('os.is_aberta = 1');
  }

  if (filters.noDeposit) {
    whereClauses.push('os.valor_pago <= 0 AND os.valor_restante > 0');
  }

  if (filters.veiculo) {
    whereClauses.push('(UPPER(os.veiculo) LIKE ? OR os.veiculo LIKE ?)');
    params.push('%' + filters.veiculo.toUpperCase() + '%', '%' + filters.veiculo + '%');
  }

  const limit = filters.limit || 5;

  const sql = `
    SELECT 
      os.os_id, os.loja_slug, os.tipo, os.status_grid, os.is_aberta,
      os.data_inicio, os.data_fim, os.dias_no_patio, os.veiculo, os.placa,
      os.cliente_nome, os.responsavel, os.total_os, os.valor_pago, os.valor_restante, os.tem_nf,
      bm25(ordens_servico_fts) as score
    FROM ordens_servico_fts fts
    JOIN ordens_servico os ON os.rowid = fts.rowid
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY bm25(ordens_servico_fts) ASC
    LIMIT ?
  `;

  try {
    return db.prepare(sql).all(...params, limit) as OperationalRecord[];
  } catch (err: any) {
    console.warn('[FTS5 Search] Falha ao executar consulta FTS5:', err?.message || err);
    return [];
  }
}

/**
 * Tier 3: Recuperação Vetorial KNN (sqlite-vec) com Eliminação Estrita de Órfãos
 */
export async function executeVectorSearch(
  db: Database.Database,
  queryText: string,
  filters: {
    lojaSlug?: string;
    onlyOpen?: boolean;
    noDeposit?: boolean;
    limit?: number;
  }
): Promise<OperationalRecord[]> {
  if (!queryText || queryText.trim() === '') return [];

  if (!loadVectorExtension(db)) {
    return [];
  }

  const embedder = await getEmbedder();
  if (!embedder) {
    return [];
  }

  let queryVector: Float32Array;
  try {
    queryVector = await embedder.embed(queryText);
  } catch {
    return [];
  }

  if (!(queryVector instanceof Float32Array) || queryVector.length !== 384) {
    return [];
  }

  try {
    const rawBuffer = new Uint8Array(queryVector.buffer, queryVector.byteOffset, queryVector.byteLength);
    // Busca até 20 vizinhos para compensar potenciais filtros de loja/status
    const candidateLimit = Math.max(15, (filters.limit || 5) * 3);
    const vecResults = db.prepare(`
      SELECT os_key, distance
      FROM vec_ordens_servico
      WHERE os_embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(rawBuffer, candidateLimit) as Array<{ os_key: string; distance: number }>;

    if (!vecResults || vecResults.length === 0) return [];

    const getOSStmt = db.prepare(`
      SELECT 
        os_id, loja_slug, tipo, status_grid, is_aberta,
        data_inicio, data_fim, dias_no_patio, veiculo, placa,
        cliente_nome, responsavel, total_os, valor_pago, valor_restante, tem_nf
      FROM ordens_servico
      WHERE os_id = ? AND loja_slug = ?
    `);

    const records: OperationalRecord[] = [];
    const maxResults = filters.limit || 5;

    for (const item of vecResults) {
      const parts = item.os_key.split(':');
      if (parts.length < 2) continue;
      const [osId, lojaSlug] = parts;

      // 1. Eliminação de Vetores Órfãos (registro precisa existir no ordens_servico)
      const os = getOSStmt.get(osId, lojaSlug) as OperationalRecord | undefined;
      if (!os) continue;

      // 2. Validação Rígida de Filtros Estruturados
      if (filters.lojaSlug && os.loja_slug !== filters.lojaSlug) continue;
      if (filters.onlyOpen && os.is_aberta !== 1) continue;
      if (filters.noDeposit && (os.valor_pago > 0 || os.valor_restante <= 0)) continue;

      os.score = Number(item.distance.toFixed(4));
      records.push(os);

      if (records.length >= maxResults) break;
    }

    return records;
  } catch (err: any) {
    console.warn('[VEC KNN Search] Falha ao executar busca vetorial:', err?.message || err);
    return [];
  }
}

/**
 * Tier 4: Fusão Híbrida via Reciprocal Rank Fusion (RRF k=60)
 */
export async function executeHybridRrfSearch(
  db: Database.Database,
  queryText: string,
  filters: {
    lojaSlug?: string;
    onlyOpen?: boolean;
    noDeposit?: boolean;
    limit?: number;
  },
  config: RRFConfig = DEFAULT_RRF_CONFIG
): Promise<OperationalRecord[]> {
  const ftsCandidates = executeFtsSearch(db, queryText, { ...filters, limit: 15 });
  const vecCandidates = await executeVectorSearch(db, queryText, { ...filters, limit: 15 });

  if (ftsCandidates.length === 0 && vecCandidates.length === 0) return [];
  if (ftsCandidates.length === 0) return vecCandidates.slice(0, config.limit);
  if (vecCandidates.length === 0) return ftsCandidates.slice(0, config.limit);

  const rrfMap = new Map<string, { record: OperationalRecord; rrfScore: number }>();

  // RRF(d) = sum( weight / (k + rank) )
  ftsCandidates.forEach((rec, idx) => {
    const key = `${rec.loja_slug}:${rec.os_id}`;
    const rank = idx + 1;
    const score = config.ftsWeight / (config.k + rank);
    rrfMap.set(key, { record: rec, rrfScore: score });
  });

  vecCandidates.forEach((rec, idx) => {
    const key = `${rec.loja_slug}:${rec.os_id}`;
    const rank = idx + 1;
    const score = config.vecWeight / (config.k + rank);
    const existing = rrfMap.get(key);
    if (existing) {
      existing.rrfScore += score;
    } else {
      rrfMap.set(key, { record: rec, rrfScore: score });
    }
  });

  const merged = Array.from(rrfMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, config.limit)
    .map(item => {
      const rec = item.record;
      rec.score = Number(item.rrfScore.toFixed(6));
      return rec;
    });

  return merged;
}

/**
 * Identifica se o texto contém termos de peças, modelos ou serviços lexicais.
 */
function hasPieceTerms(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    'amortecedor', 'suspensao', 'pastilha', 'disco', 'oleo', 'filtro',
    'correia', 'bomba', 'embreagem', 'pneu', 'bucha', 'radiador', 'vela',
    'freio', 'escapamento', 'coxim', 'alternador', 'bateria', 'alinhamento'
  ].some(t => lower.includes(t));
}

/**
 * Identifica se o texto contém sintomas, falhas ou condições abertas.
 */
function hasSymptomTerms(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    'barulho', 'falhando', 'vazando', 'chiado', 'trepidando', 'estalo',
    'fumaca', 'morrendo', 'quente', 'esquentando', 'estranho', 'fraco',
    'travado', 'vazamento', 'engasgando', 'batendo', 'apitando'
  ].some(t => lower.includes(t));
}

/**
 * Função Canônica Central do Hydra (Contrato de API Compartilhada com o Agente 2)
 */
export async function retrieveOperationalData(
  db: Database.Database,
  intent: CanonicalIntent
): Promise<RetrievalResult> {
  // 1. Caso de Clarificação: encerra imediatamente sem custo
  if (intent.needsClarification) {
    return {
      source: 'NONE',
      records: [],
      filtersApplied: {}
    };
  }

  // 2. Normalização de Entidades
  const normPlaca = normalizePlaca(intent.placa);
  const normOS = normalizeOSId(intent.osId);
  const normLoja = normalizeLojaSlug(intent.lojaSlug);
  const onlyOpen = intent.onlyOpen ?? true; // Default seguro: apenas abertas
  const noDeposit = Boolean(intent.noDeposit);

  const filtersApplied = {
    lojaSlug: normLoja,
    placa: normPlaca,
    osId: normOS,
    onlyOpen,
    noDeposit
  };

  // 3. TIER 1: Identificadores Rígidos (OS ou Placa) -> SQL Exato Obrigatório
  if (normOS || normPlaca) {
    const records = executeExactSqlSearch(db, {
      osId: normOS,
      placa: normPlaca,
      lojaSlug: normLoja,
      onlyOpen,
      noDeposit,
      limit: 5
    });

    return {
      source: 'SQL_EXACT',
      records,
      filtersApplied
    };
  }

  // 4. Consultas puramente relacionais sem texto livre (ex.: Pátio da Loja X, Alertas Financeiros)
  const queryText = (intent.serviceTerms || intent.canonicalQuestion || '').trim();
  const isPureRelational = !intent.serviceTerms && (
    intent.intent === 'CONSULTA_PATIO' ||
    intent.intent === 'ALERTAS_FINANCEIROS' ||
    intent.intent === 'METAS' ||
    intent.intent === 'list_os' ||
    queryText === ''
  );

  if (isPureRelational) {
    const records = executeExactSqlSearch(db, {
      lojaSlug: normLoja,
      veiculo: intent.veiculo,
      onlyOpen,
      noDeposit,
      sortField: intent.sortField,
      sortDirection: intent.sortDirection,
      limit: intent.limit || 10
    });

    return {
      source: 'SQL_EXACT',
      records,
      filtersApplied
    };
  }

  const isPiece = Boolean(intent.serviceTerms) || hasPieceTerms(queryText);
  const isSymptom = hasSymptomTerms(queryText);

  // 5. TIER 4: Consulta Mista (Peça/Modelo E Sintoma) -> HYBRID RRF
  if (isPiece && isSymptom) {
    try {
      const records = await executeHybridRrfSearch(db, queryText, {
        lojaSlug: normLoja,
        onlyOpen,
        noDeposit,
        limit: 5
      });
      return {
        source: 'HYBRID_RRF',
        records,
        filtersApplied
      };
    } catch {}
  }

  // 6. TIER 2: FTS5 Lexical (Peças, Modelos e Termos Textuais)
  if (isPiece && !isSymptom) {
    const ftsRecords = executeFtsSearch(db, queryText, {
      lojaSlug: normLoja,
      onlyOpen,
      noDeposit,
      limit: 5
    });

    return {
      source: 'FTS5',
      records: ftsRecords,
      filtersApplied
    };
  }

  // 7. TIER 3: Busca Vetorial Semântica (Sintomas e Falhas Conceituais Abertas)
  if (isSymptom && !isPiece) {
    const vecRecords = await executeVectorSearch(db, queryText, {
      lojaSlug: normLoja,
      onlyOpen,
      noDeposit,
      limit: 5
    });

    return {
      source: 'VEC_KNN',
      records: vecRecords,
      filtersApplied
    };
  }

  // 8. TIER 5: Fallback sequencial FTS5 -> VEC_KNN -> NONE
  const ftsFallback = executeFtsSearch(db, queryText, {
    lojaSlug: normLoja,
    onlyOpen,
    noDeposit,
    limit: 5
  });

  if (ftsFallback.length > 0) {
    return {
      source: 'FTS5',
      records: ftsFallback,
      filtersApplied
    };
  }

  const vecFallback = await executeVectorSearch(db, queryText, {
    lojaSlug: normLoja,
    onlyOpen,
    noDeposit,
    limit: 5
  });

  if (vecFallback.length > 0) {
    return {
      source: 'VEC_KNN',
      records: vecFallback,
      filtersApplied
    };
  }

  return {
    source: 'NONE',
    records: [],
    filtersApplied
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SALVAGUARDA DE AFIRMAÇÃO SEMÂNTICA (E5-E3)
// ─────────────────────────────────────────────────────────────────────────────

export const SEMANTIC_EMPTY_SEARCH_MESSAGE =
  'Não encontrei registros correspondentes nos documentos pesquisados.';

/**
 * Salvaguarda semântica: busca vetorial vazia gera
 * "Não encontrei registros correspondentes nos documentos pesquisados",
 * e NUNCA "Zero casos confirmados na loja".
 */
export function formatSemanticSearchResult(options: {
  records: OperationalRecord[];
  queryText?: string;
  lojaNome?: string;
  source?: RetrievalSource;
}): string {
  const { records, lojaNome } = options;
  if (!records || records.length === 0) {
    return `> *Pesquisa de Documentos*\n${SEMANTIC_EMPTY_SEARCH_MESSAGE}`;
  }
  const prefix = lojaNome ? `> *${lojaNome} — Resultados da Pesquisa*\n` : '> *Resultados da Pesquisa*\n';
  const lines = records.map(r => `- *OS #${r.os_id}:* ${r.veiculo} (${r.placa}) — ${r.status_grid || (r.is_aberta ? 'Aberta' : 'Fechada')}`);
  return `${prefix}${lines.join('\n')}`;
}

