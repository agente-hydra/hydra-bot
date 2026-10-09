/**
 * contas_pagar_vector.ts
 *
 * Módulo de indexação vetorial e busca semântica para Contas a Pagar.
 * Utiliza o modelo local all-MiniLM-L6-v2 (384 dimensões) e a tabela sqlite-vec `vec_contas_pagar`.
 * Possui fallback transparente para FTS5 e busca relacional SQL.
 */

import Database from 'better-sqlite3';
import { getEmbedder } from './embeddings.js';
import { LancamentoContaPagar, consultarContasPagarRelacional } from './db_repository.js';

export interface ResultadoBuscaContasPagar extends LancamentoContaPagar {
  distance?: number;
  scoreMatch?: number;
}

/**
 * Insere ou atualiza o vetor de uma conta a pagar na tabela virtual sqlite-vec.
 */
export function upsertContaPagarEmbedding(
  db: Database.Database,
  id: string,
  embedding: Float32Array
): boolean {
  if (!(embedding instanceof Float32Array) || embedding.length !== 384) {
    console.warn(`[VEC_CP] Dimensão inválida para ${id}: esperado 384, recebido ${embedding?.length}`);
    return false;
  }

  try {
    const rawBuffer = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare('DELETE FROM vec_contas_pagar WHERE id = ?').run(id);
    db.prepare(`
      INSERT INTO vec_contas_pagar(id, embedding)
      VALUES (?, ?)
    `).run(id, rawBuffer);
    return true;
  } catch (err: any) {
    // Se a tabela virtual não existir ou a extensão não estiver carregada
    console.warn(`[VEC_CP] Erro ao persistir embedding de contas a pagar (${id}):`, err?.message || err);
    return false;
  }
}

/**
 * Vetoriza lançamentos pendentes ou fornecidos.
 */
export async function vetorizarLancamentosContasPagar(
  db: Database.Database,
  lancamentos?: LancamentoContaPagar[]
): Promise<{ vetorizados: number; total: number; erros: number }> {
  let alvos = lancamentos;

  // Se não foi fornecido um lote explícito, busca contas sem vetor indexado
  if (!alvos || alvos.length === 0) {
    try {
      const rows = db.prepare(`
        SELECT cp.*
        FROM contas_pagar_lancamentos cp
        LEFT JOIN vec_contas_pagar v ON cp.id = v.id
        WHERE v.id IS NULL
        LIMIT 200
      `).all() as any[];

      alvos = rows.map((r: any) => ({
        id: r.id,
        lojaSlug: r.loja_slug,
        lojaOriginal: r.loja_original,
        codigo: r.codigo,
        parcela: r.parcela,
        fornecedor: r.fornecedor,
        descricao: r.descricao,
        tipo: r.tipo,
        dataVencimento: r.data_vencimento,
        dataPrevisao: r.data_previsao,
        valorAPagar: r.valor_a_pagar,
        status: r.status,
        dataPagamento: r.data_pagamento,
        valorPago: r.valor_pago,
        dataExtracao: r.data_extracao,
        textoSemantico: `${r.data_pagamento} - ${r.loja_slug}: Pago R$ ${r.valor_pago.toFixed(2)} para ${r.fornecedor} (${r.descricao})`
      }));
    } catch {
      alvos = consultarContasPagarRelacional(db, { limite: 200 });
    }
  }

  if (!alvos || alvos.length === 0) {
    return { vetorizados: 0, total: 0, erros: 0 };
  }

  const embedder = await getEmbedder();
  if (!embedder) {
    console.warn('[VEC_CP] Embedder indisponível. Operação vetorial postergada.');
    return { vetorizados: 0, total: alvos.length, erros: alvos.length };
  }

  let vetorizados = 0;
  let erros = 0;

  for (const item of alvos) {
    try {
      const texto = item.textoSemantico || `${item.dataPagamento} - ${item.lojaSlug}: Pago R$ ${item.valorPago.toFixed(2)} para ${item.fornecedor} (${item.descricao})`;
      const vec = await embedder.embed(texto);
      const ok = upsertContaPagarEmbedding(db, item.id, vec);
      if (ok) {
        vetorizados++;
      } else {
        erros++;
      }
    } catch (err: any) {
      erros++;
      console.warn(`[VEC_CP] Falha ao vetorizar ${item.id}:`, err?.message || err);
    }
  }

  return { vetorizados, total: alvos.length, erros };
}

/**
 * Busca inteligente por similaridade semântica com fallback para FTS5 e SQL LIKE.
 */
export async function buscarContasPagarSemantica(
  db: Database.Database,
  query: string,
  limite: number = 10,
  filtros: { lojaSlug?: string; dataInicio?: string; dataFim?: string } = {}
): Promise<ResultadoBuscaContasPagar[]> {
  const embedder = await getEmbedder();

  // Tentativa 1: Busca vetorial via sqlite-vec KNN
  if (embedder && query && query.trim() !== '') {
    try {
      const queryVec = await embedder.embed(query.trim());
      const rawBuffer = new Uint8Array(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);

      const matches = db.prepare(`
        SELECT id, distance
        FROM vec_contas_pagar
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(rawBuffer, limite * 2) as Array<{ id: string; distance: number }>;

      if (matches && matches.length > 0) {
        const ids = matches.map(m => m.id);
        const distMap = new Map(matches.map(m => [m.id, m.distance]));

        const placeholders = ids.map(() => '?').join(',');
        let sql = `SELECT * FROM contas_pagar_lancamentos WHERE id IN (${placeholders})`;
        const params: any[] = [...ids];

        if (filtros.lojaSlug && filtros.lojaSlug !== '*' && filtros.lojaSlug !== 'todas') {
          sql += ' AND loja_slug = ?';
          params.push(filtros.lojaSlug);
        }
        if (filtros.dataInicio) {
          sql += ' AND data_pagamento >= ?';
          params.push(filtros.dataInicio);
        }
        if (filtros.dataFim) {
          sql += ' AND data_pagamento <= ?';
          params.push(filtros.dataFim);
        }

        const rows = db.prepare(sql).all(...params) as any[];

        const resultados: ResultadoBuscaContasPagar[] = rows.map((r: any) => ({
          id: r.id,
          lojaSlug: r.loja_slug,
          lojaOriginal: r.loja_original,
          codigo: r.codigo,
          parcela: r.parcela,
          fornecedor: r.fornecedor,
          descricao: r.descricao,
          tipo: r.tipo,
          dataVencimento: r.data_vencimento,
          dataPrevisao: r.data_previsao,
          valorAPagar: r.valor_a_pagar,
          status: r.status,
          dataPagamento: r.data_pagamento,
          valorPago: r.valor_pago,
          dataExtracao: r.data_extracao,
          textoSemantico: `${r.data_pagamento} - ${r.loja_slug}: Pago R$ ${r.valor_pago.toFixed(2)} para ${r.fornecedor} (${r.descricao})`,
          distance: distMap.get(r.id) !== undefined ? Number(distMap.get(r.id)!.toFixed(4)) : undefined
        }));

        // Ordena pela distância vetorial (menor = mais similar)
        resultados.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
        return resultados.slice(0, limite);
      }
    } catch (err: any) {
      console.warn('[VEC_CP] Busca vetorial indisponível, usando fallback FTS5:', err?.message || err);
    }
  }

  // Tentativa 2: Fallback FTS5
  try {
    const ftsMatches = db.prepare(`
      SELECT id FROM contas_pagar_fts
      WHERE contas_pagar_fts MATCH ?
      LIMIT ?
    `).all(query.trim(), limite) as Array<{ id: string }>;

    if (ftsMatches && ftsMatches.length > 0) {
      const ids = ftsMatches.map(m => m.id);
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM contas_pagar_lancamentos WHERE id IN (${placeholders})`).all(...ids) as any[];
      return rows.map((r: any) => ({
        id: r.id,
        lojaSlug: r.loja_slug,
        lojaOriginal: r.loja_original,
        codigo: r.codigo,
        parcela: r.parcela,
        fornecedor: r.fornecedor,
        descricao: r.descricao,
        tipo: r.tipo,
        dataVencimento: r.data_vencimento,
        dataPrevisao: r.data_previsao,
        valorAPagar: r.valor_a_pagar,
        status: r.status,
        dataPagamento: r.data_pagamento,
        valorPago: r.valor_pago,
        dataExtracao: r.data_extracao,
        textoSemantico: `${r.data_pagamento} - ${r.loja_slug}: Pago R$ ${r.valor_pago.toFixed(2)} para ${r.fornecedor} (${r.descricao})`
      }));
    }
  } catch {}

  // Tentativa 3: Fallback relacional SQL LIKE
  return consultarContasPagarRelacional(db, {
    termo: query,
    lojaSlug: filtros.lojaSlug,
    dataInicio: filtros.dataInicio,
    dataFim: filtros.dataFim,
    limite
  });
}
