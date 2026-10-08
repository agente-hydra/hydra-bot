import Database from 'better-sqlite3';
import { getDatabaseConnection, registrarEntregaWhatsApp } from './db_repository.js';

export interface SendWhatsAppOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  presenceDelayMs?: number;
  customDb?: Database.Database;
}

export interface SendWhatsAppResult {
  sucesso: boolean;
  statusHttp: number;
  tentativas: number;
  duracaoMs: number;
  messageId?: string;
  respostaRaw?: string;
  erro?: string;
}

import { sanitizeWhatsAppMarkdown } from './format_utils.js';

export { sanitizeWhatsAppMarkdown };

export class WhatsAppClient {
  private baseUrl: string;
  private apiKey: string;
  private instance: string;
  private db?: Database.Database;

  constructor(config?: {
    baseUrl?: string;
    apiKey?: string;
    instance?: string;
    db?: Database.Database;
  }) {
    if (!process.env.EVOLUTION_API_KEY && !process.env.EVOLUTION_KEY && typeof (process as any).loadEnvFile === 'function') {
      try { (process as any).loadEnvFile('/home/operacional/hydra/.env'); } catch {}
    }
    this.baseUrl = config?.baseUrl || process.env.EVOLUTION_URL || 'https://evo.tork.services';
    this.apiKey = config?.apiKey || process.env.EVOLUTION_KEY || process.env.EVOLUTION_API_KEY || '';
    const rawInstance = config?.instance || process.env.EVOLUTION_INSTANCE || 'hydra';
    this.instance = (!config?.instance && rawInstance.toLowerCase() === 'atendimento') ? 'hydra' : rawInstance;
    this.db = config?.db;
  }

  private getDb(): Database.Database {
    if (this.db) return this.db;
    try {
      this.db = getDatabaseConnection();
      return this.db;
    } catch {
      // Retorna conexão sob demanda
      return getDatabaseConnection();
    }
  }

  /**
   * Dispara sinal de presença ("digitando..." ou "pausado")
   */
  async sendPresence(phone: string, presence: 'composing' | 'paused' = 'composing', delayMs = 1000): Promise<void> {
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) return;

    const endpoint = `${this.baseUrl}/chat/sendPresence/${this.instance}`;
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey
        },
        body: JSON.stringify({
          number: cleanPhone,
          presence,
          delay: delayMs
        }),
        signal: AbortSignal.timeout(5000)
      });
    } catch (err: any) {
      // Falha de presença não aborta fluxo
      console.warn(`[WhatsAppClient] Falha transitória ao enviar presence para ${cleanPhone}:`, err?.message || err);
    }
  }

  /**
   * Envia mensagem de texto com validação estrita de HTTP Status e retry exponencial
   */
  async sendText(phone: string, text: string, options?: SendWhatsAppOptions): Promise<SendWhatsAppResult> {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const cleanText = sanitizeWhatsAppMarkdown(text);

    if (!cleanPhone) {
      return {
        sucesso: false,
        statusHttp: 400,
        tentativas: 0,
        duracaoMs: 0,
        erro: 'Telefone inválido ou ausente'
      };
    }

    if (!cleanText) {
      return {
        sucesso: false,
        statusHttp: 400,
        tentativas: 0,
        duracaoMs: 0,
        erro: 'Texto da mensagem vazio após sanitização'
      };
    }

    const maxRetries = options?.maxRetries ?? 3;
    const timeoutMs = options?.timeoutMs ?? 12000;
    const baseDelayMs = options?.baseDelayMs ?? 800;
    const endpoint = `${this.baseUrl}/message/sendText/${this.instance}`;

    let lastStatus = 0;
    let lastError: string | undefined;
    let lastRawResponse: string | undefined;
    let capturedMessageId: string | undefined;
    const startTotal = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.apiKey
          },
          body: JSON.stringify({
            number: cleanPhone,
            text: cleanText
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });

        lastStatus = response.status;
        const rawText = await response.text();
        lastRawResponse = rawText;

        try {
          const parsed = JSON.parse(rawText);
          capturedMessageId = parsed?.key?.id || parsed?.data?.key?.id || parsed?.id;
        } catch {}

        if (response.ok) {
          const totalMs = Date.now() - startTotal;
          const result: SendWhatsAppResult = {
            sucesso: true,
            statusHttp: lastStatus,
            tentativas: attempt,
            duracaoMs: totalMs,
            messageId: capturedMessageId,
            respostaRaw: rawText
          };

          // Gravar auditoria no banco
          try {
            const db = options?.customDb || this.getDb();
            registrarEntregaWhatsApp(db, {
              phone: cleanPhone,
              message_id: capturedMessageId,
              endpoint,
              status_http: lastStatus,
              sucesso: 1,
              tentativas: attempt,
              duracao_ms: totalMs,
              resposta_raw: rawText
            });
          } catch {}

          return result;
        }

        // Falhas não recuperáveis por retry (ex: 400 Bad Request, 401 Unauthorized, 403 Forbidden)
        if (lastStatus >= 400 && lastStatus < 429) {
          lastError = `HTTP ${lastStatus} Cliente: ${rawText.slice(0, 200)}`;
          break;
        }

        // 429 ou 5xx: erro transitório que merece retry
        lastError = `HTTP ${lastStatus} Transitório: ${rawText.slice(0, 200)}`;
      } catch (err: any) {
        lastStatus = 0;
        lastError = err?.name === 'TimeoutError'
          ? `Timeout (${timeoutMs}ms) excedido`
          : (err?.message || String(err));
      }

      // Se ainda restarem tentativas, espera com backoff exponencial + jitter
      if (attempt < maxRetries) {
        const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
        console.warn(`[WhatsAppClient] Tentativa ${attempt}/${maxRetries} falhou (${lastError}). Aguardando ${backoff}ms para retry...`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    const totalMs = Date.now() - startTotal;
    const finalResult: SendWhatsAppResult = {
      sucesso: false,
      statusHttp: lastStatus,
      tentativas: maxRetries,
      duracaoMs: totalMs,
      messageId: capturedMessageId,
      respostaRaw: lastRawResponse,
      erro: lastError
    };

    // Gravar auditoria de falha no banco
    try {
      const db = options?.customDb || this.getDb();
      registrarEntregaWhatsApp(db, {
        phone: cleanPhone,
        message_id: capturedMessageId,
        endpoint,
        status_http: lastStatus,
        sucesso: 0,
        tentativas: maxRetries,
        duracao_ms: totalMs,
        resposta_raw: lastRawResponse,
        erro: lastError
      });
    } catch {}

    console.error(`[WhatsAppClient] ❌ Falha definitiva no envio para ${cleanPhone} após ${maxRetries} tentativas: ${lastError}`);
    return finalResult;
  }

  /**
   * Envia múltiplos balões de resposta de forma sequencial com typing delay natural
   */
  async sendSequentialMessages(phone: string, messages: string[], options?: SendWhatsAppOptions): Promise<SendWhatsAppResult[]> {
    const results: SendWhatsAppResult[] = [];
    const validMessages = messages.filter(m => m && m.trim().length > 0);

    for (let i = 0; i < validMessages.length; i++) {
      const text = validMessages[i];
      const typingDelay = Math.min(1500, Math.max(700, Math.floor(text.length * 18 + (Math.random() * 250))));

      await this.sendPresence(phone, 'composing', typingDelay);
      await new Promise(r => setTimeout(r, typingDelay));

      const sendRes = await this.sendText(phone, text, options);
      results.push(sendRes);

      // Transição natural entre balões
      if (i < validMessages.length - 1) {
        await new Promise(r => setTimeout(r, 350 + Math.floor(Math.random() * 200)));
      }
    }

    return results;
  }
}
