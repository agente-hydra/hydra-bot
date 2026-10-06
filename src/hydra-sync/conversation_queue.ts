import { EventEmitter } from 'events';

export interface QueueJob<TInput, TOutput> {
  id: string;
  conversationKey: string; // phone ou conversationId
  input: TInput;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  resolve: (output: TOutput) => void;
  reject: (err: any) => void;
}

export interface ConversationQueueConfig {
  maxConcurrentConversations?: number; // Concorr?ncia m?xima entre conversas distintas
  jobTimeoutMs?: number; // Timeout m?ximo de execu??o por job
}

/**
 * Gerenciador de Filas Particionado por Conversa:
 * - Garante ordem estrita FIFO dentro da MESMA conversa (sem invers?o de bal?es).
 * - Permite concorr?ncia limitada entre conversas DISTINTAS (conversa lenta n?o trava as outras).
 * - Mede com precis?o o tempo de espera na fila (queueWaitMs) para telemetria.
 */
export class PerConversationQueueManager<TInput, TOutput> extends EventEmitter {
  private queues: Map<string, Array<QueueJob<TInput, TOutput>>> = new Map();
  private activeConversations: Set<string> = new Set();
  private maxConcurrentConversations: number;
  private jobTimeoutMs: number;
  private handler: (input: TInput, queueWaitMs: number) => Promise<TOutput>;

  constructor(
    handler: (input: TInput, queueWaitMs: number) => Promise<TOutput>,
    config?: ConversationQueueConfig
  ) {
    super();
    this.handler = handler;
    this.maxConcurrentConversations = config?.maxConcurrentConversations ?? 5;
    this.jobTimeoutMs = config?.jobTimeoutMs ?? 45000;
  }

  /**
   * Enfileira uma mensagem para processamento na fila da conversa espec?fica.
   */
  public enqueue(conversationKey: string, input: TInput, jobId?: string): Promise<TOutput> {
    const key = String(conversationKey || 'default').trim();
    const id = jobId || `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return new Promise<TOutput>((resolve, reject) => {
      const job: QueueJob<TInput, TOutput> = {
        id,
        conversationKey: key,
        input,
        enqueuedAt: Date.now(),
        resolve,
        reject
      };

      if (!this.queues.has(key)) {
        this.queues.set(key, []);
      }

      this.queues.get(key)!.push(job);
      this.emit('job_enqueued', { jobId: id, conversationKey: key, queueSize: this.getQueueLength(key) });

      // Dispara o processador de forma n?o-bloqueante
      this.triggerNext();
    });
  }

  /**
   * Retorna o tamanho da fila para uma conversa espec?fica
   */
  public getQueueLength(conversationKey: string): number {
    return this.queues.get(conversationKey)?.length || 0;
  }

  /**
   * Retorna o total de conversas ativas processando em paralelo
   */
  public getActiveCount(): number {
    return this.activeConversations.size;
  }

  /**
   * Retorna o status geral das filas para health check
   */
  public getMetrics() {
    let totalPending = 0;
    const perConv: Record<string, number> = {};
    for (const [key, list] of this.queues.entries()) {
      if (list.length > 0) {
        perConv[key] = list.length;
        totalPending += list.length;
      }
    }
    return {
      activeConversations: Array.from(this.activeConversations),
      activeCount: this.activeConversations.size,
      maxConcurrent: this.maxConcurrentConversations,
      totalPendingJobs: totalPending,
      pendingPerConversation: perConv
    };
  }

  /**
   * Analisa as filas eleg?veis e agenda os pr?ximos jobs respeitando os limites
   */
  private triggerNext(): void {
    if (this.activeConversations.size >= this.maxConcurrentConversations) {
      return; // Limite global de conversas simult?neas atingido
    }

    // Busca conversas que possuem jobs na fila e N?O est?o atualmente em execu??o
    for (const [convKey, jobList] of this.queues.entries()) {
      if (jobList.length === 0) {
        this.queues.delete(convKey);
        continue;
      }

      if (this.activeConversations.has(convKey)) {
        continue; // Esta conversa j? tem um job rodando (FIFO estrito garantido)
      }

      // Marca conversa como ativa e inicia o processamento do job do topo
      this.activeConversations.add(convKey);
      this.processConversationHead(convKey);

      if (this.activeConversations.size >= this.maxConcurrentConversations) {
        break;
      }
    }
  }

  /**
   * Executa o job da frente da fila para a conversa informada
   */
  private async processConversationHead(convKey: string): Promise<void> {
    const list = this.queues.get(convKey);
    if (!list || list.length === 0) {
      this.activeConversations.delete(convKey);
      this.queues.delete(convKey);
      this.triggerNext();
      return;
    }

    const job = list.shift()!;
    job.startedAt = Date.now();
    const queueWaitMs = Math.max(0, job.startedAt - job.enqueuedAt);

    let timeoutTimer: NodeJS.Timeout | null = null;
    let isSettled = false;

    try {
      const timeoutPromise = new Promise<never>((_, rej) => {
        timeoutTimer = setTimeout(() => {
          if (!isSettled) {
            rej(new Error(`Timeout de ${this.jobTimeoutMs}ms excedido na fila da conversa ${convKey}`));
          }
        }, this.jobTimeoutMs);
      });

      const executePromise = this.handler(job.input, queueWaitMs);
      const output = await Promise.race([executePromise, timeoutPromise]);

      isSettled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      job.completedAt = Date.now();
      job.resolve(output);
      this.emit('job_completed', { jobId: job.id, conversationKey: convKey, durationMs: job.completedAt - job.startedAt, queueWaitMs });
    } catch (err: any) {
      isSettled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      job.completedAt = Date.now();
      job.reject(err);
      this.emit('job_failed', { jobId: job.id, conversationKey: convKey, error: err?.message || String(err), queueWaitMs });
    } finally {
      // Libera a conversa atual
      this.activeConversations.delete(convKey);

      // Se ainda houver itens na fila desta mesma conversa, continua processando o pr?ximo
      const remaining = this.queues.get(convKey);
      if (remaining && remaining.length > 0) {
        this.activeConversations.add(convKey);
        setImmediate(() => this.processConversationHead(convKey));
      } else {
        this.queues.delete(convKey);
      }

      // Desperta outras conversas pendentes
      setImmediate(() => this.triggerNext());
    }
  }
}
