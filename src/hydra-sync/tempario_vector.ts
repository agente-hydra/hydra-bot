/**
 * src/hydra-sync/tempario_vector.ts
 * Indexação e Busca Híbrida Local (Vetor 384d sqlite-vec + FTS5 + RRF).
 * Spec 054: Tempário Híbrido Automotivo (Versão 2.0).
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import type Database from 'better-sqlite3';
import { getEmbedder } from './embeddings.js';
import { ensureTemparioTables, ensureTemparioVectorTable } from './tempario_graph_repository.js';

const TEMPARIO_STOPWORDS = new Set([
  'quanto', 'quantos', 'quanta', 'quantas',
  'tempo', 'tempos', 'hora', 'horas',
  'valor', 'valores', 'preco', 'precos', 'custo', 'custos',
  'mao', 'obra', 'maodeobra',
  'pra', 'para', 'pro', 'pelo', 'pela',
  'trocar', 'troca', 'substituir', 'substituicao', 'fazer', 'remover', 'remocao', 'instalar', 'instalacao',
  'custa', 'cobrar', 'orcamento',
  'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em',
  'e', 'ou', 'um', 'uma', 'uns', 'umas',
  'com', 'sem', 'por', 'que', 'se', 'o', 'a', 'os', 'as',
  'me', 'te', 'lhe', 'nos', 'vos', 'lhes'
]);

/**
 * Constrói query FTS5 tolerante para tempário removendo stopwords conversacionais
 * e unindo componentes técnicos com OR, permitindo match multi-serviço simultâneo.
 */
export function buildTemparioFtsQuery(rawTerm: string): string {
  if (!rawTerm) return '';
  const tokens = rawTerm
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !TEMPARIO_STOPWORDS.has(t));

  if (tokens.length === 0) return '';
  return tokens.map(t => `"${t}"*`).join(' OR ');
}

export interface TemparioProcedureChunkRecord {
  readonly chunkId: string;
  readonly operationId: string;
  readonly vehicleId: string;
  readonly engineId?: string;
  readonly sourceId: string;
  readonly tituloContexto: string;
  readonly conteudoTexto: string;
  readonly metadadosJson: string;
}

export interface TemparioHybridSearchResult {
  readonly operationId: string;
  readonly vehicleId: string;
  readonly engineId?: string;
  readonly chunkId: string;
  readonly tituloContexto: string;
  readonly conteudoTexto: string;
  readonly rrfScore: number;
  readonly confidenceScore: number;
  readonly matchedSource: 'VEC_KNN' | 'FTS5' | 'HYBRID_RRF' | 'EXACT_FILTER';
}

export interface TemparioSearchFilters {
  readonly vehicleId?: string;
  readonly marca?: string;
  readonly modelo?: string;
  readonly ano?: number;
  readonly engineId?: string;
  readonly limit?: number;
}

/**
 * Insere ou atualiza o vetor de um chunk na tabela virtual sqlite-vec `vec_tempario_chunks`.
 */
export function upsertTemparioChunkEmbedding(
  db: Database.Database,
  chunkId: string,
  embedding: Float32Array
): boolean {
  if (!(embedding instanceof Float32Array) || embedding.length !== 384) {
    return false;
  }

  try {
    ensureTemparioVectorTable(db);
    const rawBuffer = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare('DELETE FROM vec_tempario_chunks WHERE chunk_id = ?').run(chunkId);
    db.prepare(`
      INSERT INTO vec_tempario_chunks (chunk_id, embedding)
      VALUES (?, ?)
    `).run(chunkId, rawBuffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Vetoriza todos os chunks de procedimento que ainda não foram indexados na tabela virtual vec_tempario_chunks.
 */
export async function indexPendingTemparioChunks(
  db: Database.Database
): Promise<{ totalIndexados: number; falhas: number }> {
  ensureTemparioTables(db);
  const vectorReady = ensureTemparioVectorTable(db);
  if (!vectorReady) {
    return { totalIndexados: 0, falhas: 0 };
  }

  const embedder = await getEmbedder();
  if (!embedder) {
    return { totalIndexados: 0, falhas: 0 };
  }

  const chunks = db.prepare(`
    SELECT c.chunk_id, c.titulo_contexto, c.conteudo_texto
    FROM tempario_procedure_chunks c
    LEFT JOIN vec_tempario_chunks v ON c.chunk_id = v.chunk_id
    WHERE v.chunk_id IS NULL
    LIMIT 200
  `).all() as Array<{
    chunk_id: string;
    titulo_contexto: string;
    conteudo_texto: string;
  }>;

  let totalIndexados = 0;
  let falhas = 0;

  for (const c of chunks) {
    try {
      const textToEmbed = `${c.titulo_contexto}. ${c.conteudo_texto}`.trim();
      const vec = await embedder.embed(textToEmbed);
      const success = upsertTemparioChunkEmbedding(db, c.chunk_id, vec);
      if (success) {
        totalIndexados++;
      } else {
        falhas++;
      }
    } catch {
      falhas++;
    }
  }

  return { totalIndexados, falhas };
}

/**
 * Executa busca híbrida de procedimentos técnicos combinando Filtro Exato, FTS5 e Vetor KNN via RRF (k=60).
 */
export async function searchTemparioHybridRRF(
  db: Database.Database,
  query: string,
  filters: TemparioSearchFilters = {}
): Promise<TemparioHybridSearchResult[]> {
  ensureTemparioTables(db);
  const limit = filters.limit || 5;
  const k = 60; // Constante padrão de amortecimento RRF

  const ranksFts = new Map<string, number>(); // chunkId -> rank (1-based)
  const ranksVec = new Map<string, number>(); // chunkId -> rank (1-based)

  // 1. Busca Lexical FTS5
  const cleanTerm = (query || '').trim();
  const ftsQuery = buildTemparioFtsQuery(cleanTerm);

  if (ftsQuery) {
    try {
      const ftsRows = db.prepare(`
        SELECT chunk_id, rank
        FROM tempario_fts
        WHERE tempario_fts MATCH ?
        ORDER BY rank
        LIMIT 25
      `).all(ftsQuery) as Array<{ chunk_id: string; rank: number }>;

      ftsRows.forEach((r, idx) => {
        ranksFts.set(r.chunk_id, idx + 1);
      });
    } catch {
      // Fallback seguro se FTS5 falhar
    }
  }

  // 2. Busca Semântica Vetorial KNN (sqlite-vec)
  const embedder = await getEmbedder();
  let hasVecMatches = false;

  if (embedder && cleanTerm) {
    try {
      const queryVec = await embedder.embed(cleanTerm);
      const rawBuffer = new Uint8Array(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);

      const vecRows = db.prepare(`
        SELECT chunk_id, distance
        FROM vec_tempario_chunks
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT 25
      `).all(rawBuffer) as Array<{ chunk_id: string; distance: number }>;

      if (vecRows && vecRows.length > 0) {
        hasVecMatches = true;
        vecRows.forEach((r, idx) => {
          ranksVec.set(r.chunk_id, idx + 1);
        });
      }
    } catch {
      // Fallback gracioso se sqlite-vec não estiver disponível
    }
  }

  // Se nenhum dos dois retornou (ex: query vazia ou sem match), tenta busca textual LIKE direta
  const allChunkIds = new Set<string>([...ranksFts.keys(), ...ranksVec.keys()]);

  if (allChunkIds.size === 0 && cleanTerm) {
    // Tenta primeiro com termos significativos isolados
    const tokens = cleanTerm
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 2 && !TEMPARIO_STOPWORDS.has(t));

    for (const t of tokens) {
      const likeRows = db.prepare(`
        SELECT chunk_id
        FROM tempario_procedure_chunks
        WHERE LOWER(titulo_contexto) LIKE ? OR LOWER(conteudo_texto) LIKE ?
        LIMIT 10
      `).all(`%${t}%`, `%${t}%`) as Array<{ chunk_id: string }>;

      likeRows.forEach((r, idx) => {
        if (!allChunkIds.has(r.chunk_id)) {
          ranksFts.set(r.chunk_id, idx + 1);
          allChunkIds.add(r.chunk_id);
        }
      });
    }

    if (allChunkIds.size === 0) {
      const fallbackRows = db.prepare(`
        SELECT chunk_id
        FROM tempario_procedure_chunks
        WHERE LOWER(titulo_contexto) LIKE ? OR LOWER(conteudo_texto) LIKE ?
        LIMIT 10
      `).all(`%${cleanTerm.toLowerCase()}%`, `%${cleanTerm.toLowerCase()}%`) as Array<{ chunk_id: string }>;

      fallbackRows.forEach((r, idx) => {
        ranksFts.set(r.chunk_id, idx + 1);
        allChunkIds.add(r.chunk_id);
      });
    }
  }

  if (allChunkIds.size === 0) {
    return [];
  }

  // 3. Carregar metadados dos chunks candidatos
  const placeholders = [...allChunkIds].map(() => '?').join(',');
  let sql = `
    SELECT c.chunk_id, c.operation_id, c.vehicle_id, c.engine_id, c.source_id,
           c.titulo_contexto, c.conteudo_texto, c.metadados_json,
           v.marca, v.modelo, v.ano_inicio, v.ano_fim
    FROM tempario_procedure_chunks c
    INNER JOIN tempario_vehicles v ON c.vehicle_id = v.vehicle_id
    WHERE c.chunk_id IN (${placeholders})
  `;
  const sqlParams: Array<string | number> = [...allChunkIds];

  if (filters.vehicleId) {
    sql += ' AND c.vehicle_id = ?';
    sqlParams.push(filters.vehicleId);
  }
  if (filters.engineId) {
    sql += ' AND (c.engine_id IS NULL OR c.engine_id = ?)';
    sqlParams.push(filters.engineId);
  }
  if (filters.ano) {
    sql += ' AND v.ano_inicio <= ? AND v.ano_fim >= ?';
    sqlParams.push(filters.ano, filters.ano);
  }

  const chunkRows = db.prepare(sql).all(...sqlParams) as Array<{
    chunk_id: string;
    operation_id: string;
    vehicle_id: string;
    engine_id?: string | null;
    source_id: string;
    titulo_contexto: string;
    conteudo_texto: string;
    metadados_json: string;
    marca: string;
    modelo: string;
    ano_inicio: number;
    ano_fim: number;
  }>;

  // 4. Calcular RRF Score e Confiança
  const scoredResults: TemparioHybridSearchResult[] = [];

  for (const row of chunkRows) {
    const rFts = ranksFts.get(row.chunk_id);
    const rVec = ranksVec.get(row.chunk_id);

    let scoreRrf = 0;
    let matchedSource: 'VEC_KNN' | 'FTS5' | 'HYBRID_RRF' | 'EXACT_FILTER' = 'EXACT_FILTER';

    if (rFts && rVec) {
      scoreRrf = (1.0 / (k + rFts)) + (1.0 / (k + rVec));
      matchedSource = 'HYBRID_RRF';
    } else if (rVec) {
      scoreRrf = (1.0 / (k + rVec));
      matchedSource = 'VEC_KNN';
    } else if (rFts) {
      scoreRrf = (1.0 / (k + rFts));
      matchedSource = 'FTS5';
    }

    // Bônus se houver match exato do modelo do veículo na query
    if (filters.modelo && row.modelo.toLowerCase() === filters.modelo.toLowerCase()) {
      scoreRrf += 0.015;
    }

    // Normalização da confiança: na fórmula RRF com k=60, o máximo de 2 matches rank 1 é ~0.0328
    // Normalizamos para a escala 0.0 a 1.0 (onde >= 0.75 indica alta certeza)
    const normalizedConfidence = Math.min(1.0, Math.max(0.2, scoreRrf / 0.030));

    scoredResults.push({
      operationId: row.operation_id,
      vehicleId: row.vehicle_id,
      engineId: row.engine_id || undefined,
      chunkId: row.chunk_id,
      tituloContexto: row.titulo_contexto,
      conteudoTexto: row.conteudo_texto,
      rrfScore: scoreRrf,
      confidenceScore: Math.round(normalizedConfidence * 100) / 100,
      matchedSource
    });
  }

  // 5. Ordenar por RRF Score decrescente e deduplicar por operationId
  scoredResults.sort((a, b) => b.rrfScore - a.rrfScore);

  const seenOps = new Set<string>();
  const finalResults: TemparioHybridSearchResult[] = [];

  for (const item of scoredResults) {
    if (!seenOps.has(item.operationId)) {
      seenOps.add(item.operationId);
      finalResults.push(item);
      if (finalResults.length >= limit) break;
    }
  }

  return finalResults;
}
