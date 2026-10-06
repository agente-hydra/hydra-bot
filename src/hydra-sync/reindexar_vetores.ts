/**
 * Reindexação Vetorial em Lote para SQLite-Vec
 * Processa ordens de serviço elegíveis (is_aberta = 1) em batches controlados.
 */

import { getDatabaseConnection, checkVectorExtensionStatus, upsertOSEmbedding, swapAtomicoVetores } from './db_repository.js';
import * as crypto from 'crypto';
import { getEmbedder } from './embeddings.js';

export interface ReindexacaoVetoresResult {
  totalElegiveis: number;
  vetorizadosComSucesso: number;
  falhas: number;
  tempoTotalMs: number;
  amostraIndices: Array<{ os_key: string; status: 'INDEXED' | 'FAILED'; erro?: string }>;
}

export function buildSemanticDescription(os: {
  os_id: string;
  loja_slug: string;
  veiculo?: string | null;
  placa?: string | null;
  cliente_nome?: string | null;
  status_grid?: string | null;
  total_os?: number | null;
  responsavel?: string | null;
}): string {
  const parts = [
    `OS #${os.os_id}`,
    `Loja: ${os.loja_slug}`,
    `Veículo: ${os.veiculo || 'N/A'}`,
    `Placa: ${os.placa || 'N/A'}`,
    `Cliente: ${os.cliente_nome || 'N/A'}`,
    `Status: ${os.status_grid || 'N/A'}`,
    `Total: R$ ${os.total_os || 0}`,
    os.responsavel ? `Responsável: ${os.responsavel}` : ''
  ].filter(Boolean);

  return parts.join(' | ');
}

export async function executarReindexacaoVetores(
  options: { batchSize?: number; apenasAbertas?: boolean } = {}
): Promise<ReindexacaoVetoresResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 25;
  const apenasAbertas = options.apenasAbertas !== false;

  const db = getDatabaseConnection();
  const status = checkVectorExtensionStatus(db);

  if (!status.isLoaded) {
    throw new Error(`sqlite-vec não está carregado. Impossível reindexar vetores: ${status.error || 'Extensão inoperante'}`);
  }

  const embedder = await getEmbedder();
  if (!embedder) {
    throw new Error('Pipeline local de embeddings (@huggingface/transformers) não pôde ser inicializado.');
  }

  const query = apenasAbertas
    ? 'SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, total_os, responsavel FROM ordens_servico WHERE is_aberta = 1'
    : 'SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, total_os, responsavel FROM ordens_servico';

  const rows = db.prepare(query).all() as Array<{
    os_id: string;
    loja_slug: string;
    veiculo?: string | null;
    placa?: string | null;
    cliente_nome?: string | null;
    status_grid?: string | null;
    total_os?: number | null;
    responsavel?: string | null;
  }>;

  const totalElegiveis = rows.length;
  let vetorizadosComSucesso = 0;
  let falhas = 0;
  const amostraIndices: Array<{ os_key: string; status: 'INDEXED' | 'FAILED'; erro?: string }> = [];

  console.log(`[REINDEX] Iniciando reindexação de ${totalElegiveis} OSs com tabela paralela e swap atômico (batchSize: ${batchSize})...`);
  try {
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vec_ordens_servico_staging USING vec0(os_key TEXT PRIMARY KEY, os_embedding float[384]);');
    db.exec('DELETE FROM vec_ordens_servico_staging;');
  } catch (stgInitErr: any) {
    console.warn('[REINDEX] ⚠️ Erro ao preparar tabela vec_ordens_servico_staging:', stgInitErr?.message || stgInitErr);
  }

  for (let i = 0; i < totalElegiveis; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const descriptions = chunk.map(os => buildSemanticDescription(os));

    try {
      const embeddings = await embedder.embedBatch(descriptions);

      for (let j = 0; j < chunk.length; j++) {
        const os = chunk[j];
        const osKey = `${os.os_id}:${os.loja_slug}`;
        const emb = embeddings[j];

        try {
          if (emb && emb.length === 384) {
            const rawBuffer = new Uint8Array(emb.buffer, emb.byteOffset, emb.byteLength);
            db.prepare('DELETE FROM vec_ordens_servico_staging WHERE os_key = ?').run(osKey);
            db.prepare('INSERT INTO vec_ordens_servico_staging(os_key, os_embedding) VALUES (?, ?)').run(osKey, rawBuffer);
            vetorizadosComSucesso++;
            if (amostraIndices.length < 5) {
              amostraIndices.push({ os_key: osKey, status: 'INDEXED' });
            }
          } else {
            falhas++;
            amostraIndices.push({ os_key: osKey, status: 'FAILED', erro: `Dimensão inválida: ${emb?.length}` });
          }
        } catch (insertErr: any) {
          falhas++;
          amostraIndices.push({ os_key: osKey, status: 'FAILED', erro: insertErr?.message || String(insertErr) });
        }
      }

      console.log(`[REINDEX] Progresso: ${Math.min(i + batchSize, totalElegiveis)}/${totalElegiveis} processadas.`);
    } catch (chunkErr: any) {
      console.error(`[REINDEX] Erro no lote ${i} - ${i + batchSize}:`, chunkErr?.message || chunkErr);
      for (const os of chunk) {
        falhas++;
        const osKey = `${os.os_id}:${os.loja_slug}`;
        amostraIndices.push({ os_key: osKey, status: 'FAILED', erro: chunkErr?.message || String(chunkErr) });
      }
    }
  }

  if (vetorizadosComSucesso > 0) {
    const versionId = crypto.randomUUID();
    console.log(`[REINDEX] 🔄 Executando swap atômico para versão ${versionId}...`);
    swapAtomicoVetores(db, versionId, vetorizadosComSucesso);
  }

  const tempoTotalMs = Date.now() - startTime;
  console.log(`[REINDEX] Concluído em ${tempoTotalMs}ms. Sucesso: ${vetorizadosComSucesso}, Falhas: ${falhas}.`);

  return {
    totalElegiveis,
    vetorizadosComSucesso,
    falhas,
    tempoTotalMs,
    amostraIndices
  };
}

if (process.argv[1] && process.argv[1].includes('reindexar_vetores')) {
  executarReindexacaoVetores()
    .then((res) => {
      console.log('Resultado da reindexação:', JSON.stringify(res, null, 2));
      process.exit(res.falhas === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Falha fatal na reindexação:', err);
      process.exit(1);
    });
}
