/**
 * Pipeline Local de Vetorização (Embeddings)
 * Modelo: Xenova/all-MiniLM-L6-v2 (384 dimensões, normalizado, CPU-only)
 */

export interface EmbeddingPipeline {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  dispose(): void;
}

let cachedPipeline: any = null;
let isLoading = false;
let loadFailed = false;

/**
 * Retorna a instância singleton do pipeline de embeddings.
 * Em caso de erro de memória (OOM) ou falha de inicialização,
 * retorna null de forma segura permitindo fallback gracioso.
 */
export async function getEmbedder(): Promise<EmbeddingPipeline | null> {
  if (loadFailed) {
    return null;
  }

  if (cachedPipeline) {
    return cachedPipeline;
  }

  if (isLoading) {
    // Aguarda conclusão se já houver load em andamento
    while (isLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return cachedPipeline;
  }

  isLoading = true;

  try {
    const { pipeline } = await import('@huggingface/transformers');
    
    console.warn('[Embeddings] Inicializando Xenova/all-MiniLM-L6-v2 (quantized: true, CPU)...');
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', ({ quantized: true } as any));

    const pipelineInstance: EmbeddingPipeline = {
      async embed(text: string): Promise<Float32Array> {
        if (!text || text.trim() === '') {
          return new Float32Array(384);
        }
        const output = await extractor(text.trim(), {
          pooling: 'mean',
          normalize: true
        });
        return new Float32Array(output.data);
      },

      async embedBatch(texts: string[]): Promise<Float32Array[]> {
        if (!texts || texts.length === 0) {
          return [];
        }
        const results: Float32Array[] = [];
        for (const t of texts) {
          const v = await this.embed(t);
          results.push(v);
        }
        return results;
      },

      dispose(): void {
        cachedPipeline = null;
      }
    };

    cachedPipeline = pipelineInstance;
    console.warn('[Embeddings] Pipeline de embeddings pronto (384-dim).');
    return cachedPipeline;
  } catch (err: any) {
    console.error('[Embeddings] Falha ao carregar pipeline local:', err?.message || err);
    loadFailed = true;
    return null;
  } finally {
    isLoading = false;
  }
}
