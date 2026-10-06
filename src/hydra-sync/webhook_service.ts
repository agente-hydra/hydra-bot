import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { dispatchMessage, DispatcherInput, DispatcherOutput } from './agent_dispatcher.js';
import { sanitizeWhatsAppMarkdown, splitIntoWhatsAppBlocks } from './format_utils.js';
import { PerConversationQueueManager } from './conversation_queue.js';
import {
  registerIncomingMessage,
  markMessageCompleted,
  markMessageFailed,
  ensureInboxTable
} from './idempotency_repository.js';
import { getDatabaseConnection } from './db_repository.js';
import type { InboundPart, MediaEvidence } from './types/multimodal_contract.js';
import { normalizeInboundMessage, isMultimodalKind } from './inbound_message_normalizer.js';
import { processInboundMultimodal } from './media_analyzer.js';
import {
  interceptCommand,
  isDeterministicCommand,
  isAuthorizedPhone,
  InFlightAbortRegistry
} from './command_interceptor.js';

export interface WebhookConfig {
  port?: number;
  evolutionUrl?: string;
  evolutionKey?: string;
  evolutionInstance?: string;
  whitelist?: Set<string>;
  maxConcurrentConversations?: number;
  jobTimeoutMs?: number;
  isSimulation?: boolean; // Modo de simulação para o Test Harness
}

export interface WebhookDeliveryResult {
  sucesso: boolean;
  statusHttp?: number;
  tentativas: number;
  duracaoMs: number;
  messageId?: string;
  erro?: string;
}

export interface WebhookJobPayload {
  phone: string;
  text: string;
  messageId: string;
  conversationId?: string;
  recebidoEm: number;
  remoteJid?: string;
  isLid?: boolean;
  inboundPart?: InboundPart;
  mediaEvidence?: MediaEvidence;
  rawPayload?: any;
  metadata?: Record<string, any>;
}

export interface WebhookJobResult {
  messageId: string;
  phone: string;
  messages: string[];
  replyText: string;
  dispatcherResult?: DispatcherOutput;
  deliveryResults: WebhookDeliveryResult[];
  timeToFirstBalloonMs: number;
  totalDurationMs: number;
}

/**
 * Serviço de Webhook do Hydra v4 (Arquitetura Persistente e Não-Bloqueante):
 * 1. Despachante Residente In-Memory (Zero overhead de execFileSync e recarga de TSX).
 * 2. Fila Assíncrona Particionada por Conversa (FIFO por telefone, paralelismo entre telefones).
 * 3. Idempotência Atômica em SQLite (Distingue COMPLETED, IN_FLIGHT e FAILED).
 * 4. Telemetria de Latência por Etapa (fila, reescrita, SQL, LLM, formatação, envio).
 * 5. Interceptação Determinística de Comandos no Ingress (Frente C: /menu, /perfil, /reset, /socio, /{loja}).
 */
export class HydraWebhookService {
  private config: Required<WebhookConfig>;
  private server: Server | null = null;
  private queueManager: PerConversationQueueManager<WebhookJobPayload, WebhookJobResult>;
  private db = getDatabaseConnection();
  private mockDeliverySink?: (phone: string, text: string, messageId: string) => Promise<WebhookDeliveryResult>;

  constructor(config?: WebhookConfig) {
    this.config = {
      port: config?.port ?? 3333,
      evolutionUrl: config?.evolutionUrl ?? (process.env.EVOLUTION_URL || 'https://evo.tork.services'),
      evolutionKey: config?.evolutionKey ?? (process.env.EVOLUTION_KEY || ''),
      evolutionInstance: config?.evolutionInstance ?? (process.env.EVOLUTION_INSTANCE || 'hydra'),
      whitelist: config?.whitelist ?? new Set(['5511996242812', '5511970671717']),
      maxConcurrentConversations: config?.maxConcurrentConversations ?? 5,
      jobTimeoutMs: config?.jobTimeoutMs ?? 45000,
      isSimulation: config?.isSimulation ?? false
    };

    ensureInboxTable(this.db);

    // Inicializa o gerenciador de filas particionado por conversa
    this.queueManager = new PerConversationQueueManager<WebhookJobPayload, WebhookJobResult>(
      (job, queueWaitMs) => this.processSingleJob(job, queueWaitMs),
      {
        maxConcurrentConversations: this.config.maxConcurrentConversations,
        jobTimeoutMs: this.config.jobTimeoutMs
      }
    );
  }

  /**
   * Permite injetar um sink de entrega simulada (usado no Test Harness)
   */
  public setMockDeliverySink(sink: (phone: string, text: string, messageId: string) => Promise<WebhookDeliveryResult>): void {
    this.mockDeliverySink = sink;
  }

  /**
   * Processador atômico de uma mensagem dentro da fila da conversa
   */
  private async processSingleJob(job: WebhookJobPayload, queueWaitMs: number): Promise<WebhookJobResult> {
    const jobStartTime = Date.now();
    const deliveryResults: WebhookDeliveryResult[] = [];
    let timeToFirstBalloonMs = 0;

    // Registra job em voo no abort registry para cancelamento imediato por /reset
    InFlightAbortRegistry.getInstance().register(job.phone, job.messageId);

    try {
      // 1. Sinaliza presença "digitando..." (somente se não for simulação)
      if (!this.config.isSimulation) {
        this.sendPresence(job.phone, 'composing', 1000).catch(() => {});
      }

      // Se houver mídia anexa, processa de forma assíncrona
      let mediaEvidence: MediaEvidence | undefined = job.mediaEvidence;
      if (!mediaEvidence && job.inboundPart && isMultimodalKind(job.inboundPart.kind) && !this.config.isSimulation) {
        try {
          const multiResult = await processInboundMultimodal(job.rawPayload, {
            tempDir: '/tmp/hydra-media',
            evolutionUrl: this.config.evolutionUrl,
            evolutionKey: this.config.evolutionKey,
            instanceName: this.config.evolutionInstance
          });
          mediaEvidence = multiResult.evidence;
          job.mediaEvidence = mediaEvidence;
        } catch (mErr: any) {
          console.warn(`[Hydra Webhook] Falha na análise sensorial multimodal: ${mErr?.message || mErr}`);
        }
      }

      // Tratamento de erro: áudio inaudível ou mídia ilegível
      if (mediaEvidence && (mediaEvidence.status === 'unreadable' || mediaEvidence.status === 'error')) {
        let friendlyReply = '';
        if (mediaEvidence.kind === 'audio') {
          friendlyReply = '> *Áudio Inaudível*\n- Não foi possível compreender a fala neste áudio (silêncio ou ruído excessivo).\n- Por favor, envie sua mensagem por texto ou grave novamente em um ambiente mais silencioso.';
        } else if (mediaEvidence.kind === 'image') {
          friendlyReply = '> *Imagem Ilegível*\n- A imagem enviada não pôde ser lida com nitidez.\n- Por favor, envie uma foto mais nítida ou digite a informação (placa ou OS) diretamente.';
        } else if (mediaEvidence.kind === 'document') {
          friendlyReply = '> *Documento Ilegível*\n- Não foi possível extrair o texto deste documento.\n- Por favor, envie o documento em PDF legível ou digite as informações.';
        } else if (mediaEvidence.kind === 'video') {
          friendlyReply = '> *Vídeo Não Processado*\n- ' + (mediaEvidence.limitations?.[0] || 'Não foi possível extrair dados claros do vídeo.') + '\n- Por favor, envie um vídeo de até 60s ou digite sua solicitação.';
        } else {
          friendlyReply = '> *Mídia Não Suportada*\n- Não foi possível processar este arquivo.\n- Por favor, envie sua mensagem em texto.';
        }

        const messagesToSend = splitIntoWhatsAppBlocks(friendlyReply);
        for (let i = 0; i < messagesToSend.length; i++) {
          const msgText = messagesToSend[i];
          if (!msgText || !msgText.trim()) continue;
          const delivery = await this.deliverMessage(job.phone, msgText, job.messageId);
          deliveryResults.push(delivery);
          if (i === 0) timeToFirstBalloonMs = Date.now() - job.recebidoEm;
        }

        const totalDurationMs = Date.now() - job.recebidoEm;
        markMessageCompleted(this.db, job.messageId, {
          messages: messagesToSend,
          replyText: friendlyReply,
          toolsCalled: ['multimodal_unreadable_fallback'],
          motorUsed: 'FALLBACK_API',
          latenciaMs: totalDurationMs
        });

        return {
          messageId: job.messageId,
          phone: job.phone,
          messages: messagesToSend,
          replyText: friendlyReply,
          deliveryResults,
          timeToFirstBalloonMs: timeToFirstBalloonMs || totalDurationMs,
          totalDurationMs
        };
      }

      // Se a mensagem for mídia e não possuía texto explicativo original, adota transcrição ou OCR
      let messageTextToDispatch = job.text;
      if (!messageTextToDispatch && mediaEvidence) {
        if (mediaEvidence.transcript) {
          messageTextToDispatch = mediaEvidence.transcript;
        } else if (mediaEvidence.ocrText) {
          messageTextToDispatch = mediaEvidence.ocrText;
        } else if (mediaEvidence.extractedPlates?.length) {
          messageTextToDispatch = `placa ${mediaEvidence.extractedPlates[0]}`;
        } else if (mediaEvidence.extractedOSs?.length) {
          messageTextToDispatch = `os ${mediaEvidence.extractedOSs[0]}`;
        }
      }

      // 2. Invoca o despachante residente na memória (não-bloqueante)
      const dispatcherResult = await dispatchMessage({
        phone: job.phone,
        message: messageTextToDispatch || '',
        conversationId: job.conversationId,
        messageId: job.messageId,
        queueWaitMs,
        skipIdempotencyCheck: true,
        remoteJid: job.remoteJid,
        metadata: job.metadata,
        attachments: job.inboundPart ? [job.inboundPart] : [],
        mediaEvidence: mediaEvidence ? [mediaEvidence] : []
      });

      // REGRA DE OURO: Verifica se o job foi abortado em voo por /reset
      if (InFlightAbortRegistry.getInstance().isAborted(job.phone, job.messageId)) {
        console.log(`[Hydra Webhook] 🛑 Resposta da mensagem #${job.messageId} descartada (abortada por /reset)`);
        return {
          messageId: job.messageId,
          phone: job.phone,
          messages: [],
          replyText: '[ABORTED_BY_RESET]',
          deliveryResults: [],
          timeToFirstBalloonMs: 0,
          totalDurationMs: Date.now() - job.recebidoEm
        };
      }

      // 3. Sanitiza e formata os balões finais
      const messagesToSend = dispatcherResult.messages || [];

      // 4. Envia os balões sequencialmente respeitando a ordem
      for (let i = 0; i < messagesToSend.length; i++) {
        // Verifica se abortou durante o envio sequencial
        if (InFlightAbortRegistry.getInstance().isAborted(job.phone, job.messageId)) {
          console.log(`[Hydra Webhook] 🛑 Envio interrompido para mensagem #${job.messageId} (abortada por /reset)`);
          break;
        }

        const msgText = messagesToSend[i];
        if (!msgText || !msgText.trim()) continue;

        const delivery = await this.deliverMessage(job.phone, msgText, job.messageId);
        deliveryResults.push(delivery);

        if (i === 0) {
          timeToFirstBalloonMs = Date.now() - job.recebidoEm;
        }

        // Intervalo natural entre balões consecutivos (reduzido no modo de teste)
        if (i < messagesToSend.length - 1 && !this.config.isSimulation) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      const totalDurationMs = Date.now() - job.recebidoEm;

      return {
        messageId: job.messageId,
        phone: job.phone,
        messages: messagesToSend,
        replyText: dispatcherResult.replyText,
        dispatcherResult,
        deliveryResults,
        timeToFirstBalloonMs: timeToFirstBalloonMs || totalDurationMs,
        totalDurationMs
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      markMessageFailed(this.db, job.messageId, errMsg);
      throw err;
    } finally {
      InFlightAbortRegistry.getInstance().clear(job.phone, job.messageId);
    }
  }

  /**
   * Envia uma mensagem para o destino via Evolution API ou Mock Sink
   */
  public async deliverMessage(phone: string, text: string, messageId: string, maxRetries = 3): Promise<WebhookDeliveryResult> {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const cleanText = sanitizeWhatsAppMarkdown(text);
    const startTotal = Date.now();
    let lastStatus = 0;
    let lastError: string | null = null;
    let capturedMsgId: string | undefined = undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.mockDeliverySink) {
        const res = await this.mockDeliverySink(cleanPhone, cleanText, messageId);
        if (res.sucesso) {
          return { ...res, tentativas: attempt, duracaoMs: Date.now() - startTotal };
        }
        lastStatus = res.statusHttp || 500;
        lastError = res.erro || 'Mock sink failure';
        if (attempt < maxRetries) {
          const backoff = 100 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return { ...res, tentativas: attempt, duracaoMs: Date.now() - startTotal };
      }

      if (this.config.isSimulation) {
        return { sucesso: true, statusHttp: 200, tentativas: 1, duracaoMs: 5, messageId: `mock_${Date.now()}` };
      }

      try {
        const response = await fetch(`${this.config.evolutionUrl}/message/sendText/${this.config.evolutionInstance}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.config.evolutionKey
          },
          body: JSON.stringify({
            number: cleanPhone,
            text: cleanText,
            options: {
              delay: 300,
              presence: 'composing'
            }
          }),
          signal: AbortSignal.timeout(12000)
        });

        lastStatus = response.status;
        const lastRaw = await response.text();

        try {
          const parsed = JSON.parse(lastRaw);
          capturedMsgId = parsed?.key?.id || parsed?.data?.key?.id || parsed?.id;
        } catch {}

        if (response.ok) {
          const duracaoMs = Date.now() - startTotal;
          return { sucesso: true, statusHttp: lastStatus, tentativas: attempt, duracaoMs, messageId: capturedMsgId };
        }

        if (lastStatus >= 400 && lastStatus < 429) {
          lastError = `HTTP ${lastStatus}: ${lastRaw.slice(0, 150)}`;
          break;
        }
        lastError = `HTTP ${lastStatus} Transitório: ${lastRaw.slice(0, 150)}`;
      } catch (err: any) {
        lastStatus = 0;
        lastError = err?.name === 'TimeoutError' ? 'Timeout de 12s excedido' : (err?.message || String(err));
      }

      if (attempt < maxRetries) {
        const backoff = 400 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    const duracaoMs = Date.now() - startTotal;
    return { sucesso: false, statusHttp: lastStatus, tentativas: maxRetries, duracaoMs, erro: lastError || 'Falha de entrega' };
  }

  /**
   * Envia sinal de presença digitando
   */
  public async sendPresence(phone: string, presence = 'composing', delay = 1000): Promise<void> {
    if (this.config.isSimulation) return;
    try {
      const cleanPhone = String(phone).replace(/\D/g, '');
      if (!cleanPhone) return;

      await fetch(`${this.config.evolutionUrl}/chat/sendPresence/${this.config.evolutionInstance}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.evolutionKey
        },
        body: JSON.stringify({ number: cleanPhone, presence, delay }),
        signal: AbortSignal.timeout(5000)
      });
    } catch {}
  }

  /**
   * Manipulador HTTP Ingress com resposta imediata (<15ms) e enfileiramento por conversa
   */
  public handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // Health Check
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/status')) {
      const metrics = this.queueManager.getMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        uptime: process.uptime(),
        queue: metrics
      }, null, 2));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        if (!body || !body.trim()) {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('empty_body');
          return;
        }

        const payload = JSON.parse(body);

        // Anti-Loop: ignora mensagens enviadas pelo bot
        if (payload?.data?.key?.fromMe === true || payload?.message_type === 'outgoing') {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ignored_outgoing');
          return;
        }

        // Normalização de entrada e suporte multimodal completo
        const inboundPart = normalizeInboundMessage(payload);

        // Extração robusta de remetente (suporta LID, participant e formato padrão)
        let rawPhone = inboundPart?.phone || payload?.data?.key?.remoteJid || payload?.sender?.phone_number || payload?.sender || '';
        let phone = String(rawPhone).replace('@s.whatsapp.net', '').replace(/\D/g, '');

        if (!phone && inboundPart?.conversationKey) {
          phone = String(inboundPart.conversationKey).replace(/\D/g, '');
        }

        if (!phone) {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('no_phone');
          return;
        }

        // Validação de Whitelist (se não for modo simulação)
        if (!this.config.isSimulation && !this.config.whitelist.has(phone)) {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ignored_non_whitelist');
          return;
        }

        const isMedia = inboundPart ? isMultimodalKind(inboundPart.kind) : false;

        // Extração do texto da mensagem ou legenda
        let text = (
          inboundPart?.text ||
          payload?.data?.message?.conversation ||
          payload?.data?.message?.extendedTextMessage?.text ||
          payload?.content ||
          payload?.text ||
          ''
        ).trim();

        // Se NÃO for mídia e texto estiver vazio, rejeita como empty_text
        // Mídias (áudio, imagem, vídeo, PDF) são aceitas mesmo sem texto!
        if (!text && !isMedia) {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('empty_text');
          return;
        }

        const messageId = String(inboundPart?.messageId || payload?.data?.key?.id || payload?.id || `${phone}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
        const conversationId = payload?.conversation?.id ? String(payload.conversation.id) : undefined;
        const conversationKey = inboundPart?.conversationKey || phone;

        // Idempotência atômica no recebimento
        const idemp = registerIncomingMessage(this.db, {
          messageId,
          phone,
          conversationId,
          text: text || (isMedia ? `[midia:${inboundPart?.kind}]` : '')
        });

        if (idemp.isDuplicate) {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            status: 'ignored_duplicate',
            messageId,
            existingStatus: idemp.status
          }));
          return;
        }

        // 5.1 Interceptação Determinística no Ingress antes do batcher e da IA (Frente C)
        if (!isMedia && isDeterministicCommand(text) && isAuthorizedPhone(phone)) {
          const cmdStartTime = Date.now();
          const cmdResult = await interceptCommand({
            phone,
            text,
            db: this.db,
            abortRegistry: InFlightAbortRegistry.getInstance(),
            presenceFn: (p, pres) => this.sendPresence(p, pres, 0)
          });

          if (cmdResult.handled) {
            for (let i = 0; i < cmdResult.messages.length; i++) {
              const msgText = cmdResult.messages[i];
              if (!msgText || !msgText.trim()) continue;
              await this.deliverMessage(phone, msgText, messageId);
              if (i < cmdResult.messages.length - 1 && !this.config.isSimulation) {
                await new Promise(r => setTimeout(r, 200));
              }
            }

            markMessageCompleted(this.db, messageId, {
              messages: cmdResult.messages,
              replyText: cmdResult.replyText || '',
              toolsCalled: [`command:${cmdResult.command}`],
              motorUsed: 'DETERMINISTIC_COMMAND',
              latenciaMs: Date.now() - cmdStartTime
            });

            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
              status: 'command_handled',
              command: cmdResult.command,
              messageId
            }));
            return;
          }
        }

        // Resposta imediata (<15ms) desacoplando o recebimento do processamento
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          status: 'queued',
          messageId,
          queueLength: this.queueManager.getQueueLength(conversationKey) + 1
        }));

        // Enfileira na fila dedicada deste telefone/conversa (FIFO)
        this.queueManager.enqueue(conversationKey, {
          phone,
          text,
          messageId,
          conversationId,
          recebidoEm: Date.now(),
          remoteJid: inboundPart?.remoteJid || payload?.data?.key?.remoteJid,
          isLid: inboundPart?.isLid,
          inboundPart: inboundPart || undefined,
          rawPayload: payload,
          metadata: inboundPart?.metadata
        }, messageId).catch(err => {
          console.error(`[Hydra Webhook] Erro ao processar mensagem #${messageId} de ${phone}:`, err);
        });

      } catch (err) {
        console.error('[Hydra Webhook] Erro no parsing do payload:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('internal_error');
      }
    });
  }

  /**
   * Inicia o servidor HTTP do webhook
   */
  public start(port?: number): Promise<number> {
    const listenPort = port ?? this.config.port;
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleHttpRequest(req, res));
      this.server.listen(listenPort, () => {
        resolve(listenPort);
      });
      this.server.on('error', reject);
    });
  }

  /**
   * Encerra o servidor e libera recursos
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Processa uma mensagem programaticamente (usado para testes do pipeline)
   */
  public getQueueMetrics() {
    return this.queueManager.getMetrics();
  }

  public async processDirectMessage(phone: string, text: string, messageId?: string, conversationId?: string): Promise<WebhookJobResult> {
    const msgId = messageId || `direct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    registerIncomingMessage(this.db, {
      messageId: msgId,
      phone,
      conversationId,
      text
    });

    return this.queueManager.enqueue(phone, {
      phone,
      text,
      messageId: msgId,
      conversationId,
      recebidoEm: Date.now()
    }, msgId);
  }
}
