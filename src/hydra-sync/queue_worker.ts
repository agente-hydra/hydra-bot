import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import {
  getDatabaseConnection,
  isWebhookMessageProcessed,
  marcarWebhookMessageProcessed
} from './db_repository.js';
import { WhatsAppClient, sanitizeWhatsAppMarkdown } from './whatsapp_client.js';
import { PresenceHeartbeatKeeper } from './presence_heartbeat.js';

export interface WebhookJob {
  phone: string;
  text: string;
  messageId: string;
  conversationId?: number;
  recebidoEm: number;
}

export interface QueueStats {
  tamanhoFila: number;
  processando: boolean;
  totalProcessados: number;
  totalFalhas: number;
}

export function extractDispatcherOutput(rawOutput: string): { messages?: string[]; replyText?: string } {
  const lines = rawOutput.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.messages || parsed.replyText) {
          return parsed;
        }
      } catch {}
    }
  }

  const match = rawOutput.match(/\{[\s\S]*"replyText"[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }

  throw new Error('Nenhum payload JSON reconhecido no output do dispatcher');
}

export function runDispatcher(phone: string, text: string, conversationId?: number, messageId?: string): string[] {
  try {
    const payload = JSON.stringify({
      phone,
      message: text,
      conversationId: conversationId || undefined,
      messageId: messageId || undefined
    });

    const output = execFileSync(
      '/usr/bin/node',
      ['/opt/bots/node_modules/tsx/dist/cli.mjs', '/opt/bots/src/hydra-sync/agent_dispatcher_cli.ts', payload],
      { timeout: 60000, encoding: 'utf-8', cwd: '/opt/bots' }
    );

    const parsed = extractDispatcherOutput(output);
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return parsed.messages.map(m => sanitizeWhatsAppMarkdown(m));
    }
    if (parsed.replyText) {
      return [sanitizeWhatsAppMarkdown(parsed.replyText)];
    }
    return ['Não foi possível formular uma resposta.'];
  } catch (err: any) {
    console.error('[Hydra QueueWorker] Erro no dispatcher:', err?.message || err);
    return ['Não consegui consultar os dados agora devido a uma oscilação na conexão com o banco. Pode tentar novamente em instantes?'];
  }
}

export class AsyncWebhookQueue {
  private queue: WebhookJob[] = [];
  private isProcessing = false;
  private totalProcessados = 0;
  private totalFalhas = 0;
  private db: Database.Database;
  private client: WhatsAppClient;

  constructor(options?: { db?: Database.Database; client?: WhatsAppClient }) {
    this.db = options?.db || getDatabaseConnection();
    this.client = options?.client || new WhatsAppClient({ db: this.db });
  }

  /**
   * Adiciona o job à fila caso não seja duplicata persistida
   */
  async enqueue(job: WebhookJob): Promise<{ enqueued: boolean; reason?: string }> {
    // 1. Checagem de deduplicação durável no SQLite
    if (isWebhookMessageProcessed(this.db, job.messageId)) {
      return { enqueued: false, reason: 'duplicate_ignored' };
    }

    // 2. Marca como recebido imediatamente
    marcarWebhookMessageProcessed(this.db, job.messageId, job.phone);

    // 3. Adiciona à fila de background
    this.queue.push(job);

    // 4. Dispara processador assíncrono sem bloquear o caller
    setImmediate(() => this.processNext());

    return { enqueued: true };
  }

  /**
   * Processador sequencial de mensagens
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) break;

        const timeStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        console.log(`[${timeStr}] 📩 [Queue] Processando mensagem ${job.messageId} de ${job.phone}: "${job.text}"`);

        try {
          // 1. Sinaliza presença contínua "digitando"
          PresenceHeartbeatKeeper.getInstance().start(job.phone, this.client, 4000);

          // 2. Executa dispatcher de negócio
          const replies = runDispatcher(job.phone, job.text, job.conversationId, job.messageId);

          // Encerra pulso de presença antes de enviar os balões
          PresenceHeartbeatKeeper.getInstance().stop(job.phone);

          // 3. Envia balões sequenciais com confirmação estrita de entrega
          console.log(`  ↳ [Queue] Despachando ${replies.length} balão(ões) para ${job.phone}...`);
          const results = await this.client.sendSequentialMessages(job.phone, replies);

          const allSuccess = results.every(r => r.sucesso);
          if (allSuccess) {
            this.totalProcessados++;
            console.log(`  ✓ [Queue] Envio concluído e auditado para ${job.phone}.`);
          } else {
            this.totalFalhas++;
            console.warn(`  ⚠️ [Queue] Envio parcial ou falha para ${job.phone}.`);
          }
        } catch (jobErr: any) {
          PresenceHeartbeatKeeper.getInstance().stop(job.phone);
          this.totalFalhas++;
          console.error(`[Queue] Erro ao processar job ${job.messageId}:`, jobErr?.message || jobErr);
        } finally {
          PresenceHeartbeatKeeper.getInstance().stop(job.phone);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getStats(): QueueStats {
    return {
      tamanhoFila: this.queue.length,
      processando: this.isProcessing,
      totalProcessados: this.totalProcessados,
      totalFalhas: this.totalFalhas
    };
  }
}
