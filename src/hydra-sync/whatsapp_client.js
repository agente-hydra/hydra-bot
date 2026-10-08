import { getDatabaseConnection, registrarEntregaWhatsApp } from "./db_repository.js";
function sanitizeWhatsAppMarkdown(raw) {
  if (!raw) return "";
  let text = String(raw);
  text = text.replace(/\*\*([^*]+?)\*\*/g, "*$1*");
  text = text.replace(/__([^_]+?)__/g, "_$1_");
  text = text.replace(/^\|(.+)\|$/gm, (match) => {
    if (/^\|[\s\-:|]+\|$/.test(match)) return "";
    const cols = match.split("|").map((c) => c.trim()).filter(Boolean);
    return cols.map((c) => `\u2022 ${c}`).join("\n");
  });
  text = text.replace(/\*\*\*+/g, "*");
  text = text.replace(/<[^>]+>/g, "");
  return text.trim();
}
class WhatsAppClient {
  baseUrl;
  apiKey;
  instance;
  db;
  constructor(config) {
    if (!process.env.EVOLUTION_API_KEY && !process.env.EVOLUTION_KEY && typeof process.loadEnvFile === "function") {
      try {
        process.loadEnvFile("/home/operacional/hydra/.env");
      } catch {
      }
    }
    this.baseUrl = config?.baseUrl || process.env.EVOLUTION_URL || "https://evo.tork.services";
    this.apiKey = config?.apiKey || process.env.EVOLUTION_KEY || process.env.EVOLUTION_API_KEY || "";
    const rawInstance = config?.instance || process.env.EVOLUTION_INSTANCE || "hydra";
    this.instance = (!config?.instance && rawInstance.toLowerCase() === "atendimento") ? "hydra" : rawInstance;
    this.db = config?.db;
  }
  getDb() {
    if (this.db) return this.db;
    try {
      this.db = getDatabaseConnection();
      return this.db;
    } catch {
      return getDatabaseConnection();
    }
  }
  /**
   * Dispara sinal de presença ("digitando..." ou "pausado")
   */
  async sendPresence(phone, presence = "composing", delayMs = 1e3) {
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone) return;
    const endpoint = `${this.baseUrl}/chat/sendPresence/${this.instance}`;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": this.apiKey
        },
        body: JSON.stringify({
          number: cleanPhone,
          presence,
          delay: delayMs
        }),
        signal: AbortSignal.timeout(5e3)
      });
    } catch (err) {
      console.warn(`[WhatsAppClient] Falha transit\xF3ria ao enviar presence para ${cleanPhone}:`, err?.message || err);
    }
  }
  /**
   * Envia mensagem de texto com validação estrita de HTTP Status e retry exponencial
   */
  async sendText(phone, text, options) {
    const cleanPhone = String(phone).replace(/\D/g, "");
    const cleanText = sanitizeWhatsAppMarkdown(text);
    if (!cleanPhone) {
      return {
        sucesso: false,
        statusHttp: 400,
        tentativas: 0,
        duracaoMs: 0,
        erro: "Telefone inv\xE1lido ou ausente"
      };
    }
    if (!cleanText) {
      return {
        sucesso: false,
        statusHttp: 400,
        tentativas: 0,
        duracaoMs: 0,
        erro: "Texto da mensagem vazio ap\xF3s sanitiza\xE7\xE3o"
      };
    }
    const maxRetries = options?.maxRetries ?? 3;
    const timeoutMs = options?.timeoutMs ?? 12e3;
    const baseDelayMs = options?.baseDelayMs ?? 800;
    const endpoint = `${this.baseUrl}/message/sendText/${this.instance}`;
    let lastStatus = 0;
    let lastError;
    let lastRawResponse;
    let capturedMessageId;
    const startTotal = Date.now();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": this.apiKey
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
        } catch {
        }
        if (response.ok) {
          const totalMs2 = Date.now() - startTotal;
          const result = {
            sucesso: true,
            statusHttp: lastStatus,
            tentativas: attempt,
            duracaoMs: totalMs2,
            messageId: capturedMessageId,
            respostaRaw: rawText
          };
          try {
            const db = options?.customDb || this.getDb();
            registrarEntregaWhatsApp(db, {
              phone: cleanPhone,
              message_id: capturedMessageId,
              endpoint,
              status_http: lastStatus,
              sucesso: 1,
              tentativas: attempt,
              duracao_ms: totalMs2,
              resposta_raw: rawText
            });
          } catch {
          }
          return result;
        }
        if (lastStatus >= 400 && lastStatus < 429) {
          lastError = `HTTP ${lastStatus} Cliente: ${rawText.slice(0, 200)}`;
          break;
        }
        lastError = `HTTP ${lastStatus} Transit\xF3rio: ${rawText.slice(0, 200)}`;
      } catch (err) {
        lastStatus = 0;
        lastError = err?.name === "TimeoutError" ? `Timeout (${timeoutMs}ms) excedido` : err?.message || String(err);
      }
      if (attempt < maxRetries) {
        const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
        console.warn(`[WhatsAppClient] Tentativa ${attempt}/${maxRetries} falhou (${lastError}). Aguardando ${backoff}ms para retry...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    const totalMs = Date.now() - startTotal;
    const finalResult = {
      sucesso: false,
      statusHttp: lastStatus,
      tentativas: maxRetries,
      duracaoMs: totalMs,
      messageId: capturedMessageId,
      respostaRaw: lastRawResponse,
      erro: lastError
    };
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
    } catch {
    }
    console.error(`[WhatsAppClient] \u274C Falha definitiva no envio para ${cleanPhone} ap\xF3s ${maxRetries} tentativas: ${lastError}`);
    return finalResult;
  }
  /**
   * Envia múltiplos balões de resposta de forma sequencial com typing delay natural
   */
  async sendSequentialMessages(phone, messages, options) {
    const results = [];
    const validMessages = messages.filter((m) => m && m.trim().length > 0);
    for (let i = 0; i < validMessages.length; i++) {
      const text = validMessages[i];
      const typingDelay = Math.min(1500, Math.max(700, Math.floor(text.length * 18 + Math.random() * 250)));
      await this.sendPresence(phone, "composing", typingDelay);
      await new Promise((r) => setTimeout(r, typingDelay));
      const sendRes = await this.sendText(phone, text, options);
      results.push(sendRes);
      if (i < validMessages.length - 1) {
        await new Promise((r) => setTimeout(r, 350 + Math.floor(Math.random() * 200)));
      }
    }
    return results;
  }
}
export {
  WhatsAppClient,
  sanitizeWhatsAppMarkdown
};
