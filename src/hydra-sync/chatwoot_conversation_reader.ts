/**
 * src/hydra-sync/chatwoot_conversation_reader.ts
 * Leitor e Sanitizador Read-Only de Conversas do Chatwoot (Spec 059)
 * 
 * Funcionalidades:
 * 1. Consulta segura à API do Chatwoot (/conversations, /contacts/search, /messages).
 * 2. Sanitização estrita LGPD (redação automática de dados de cartões, CVV, senhas e CPFs).
 * 3. Cache LRU em memória (TTL padrão 5 minutos) para evitar requisições redundantes.
 * 4. Mapeamento determinístico de Inbox ID para Slugs de Loja da Rede.
 * 5. Geração de links rápidos de atendimento (Chatwoot Web e WhatsApp wa.me).
 * 
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`).
 */

import type {
  SanitizedChatMessage,
  ChatwootConversationSummary,
  ChatwootConversationReaderConfig,
  ConversationHistoryQueryOptions
} from './types/chatwoot_contract.js';

export const INBOX_TO_STORE_SLUG: Record<number, string> = {
  1: 'central',
  2: 'jorgeberetta',
  3: 'kennedy',
  4: 'dompedro',
  5: 'rudgeramos',
  6: 'jabaquara',
  7: 'piraporinha',
  8: 'planalto',
  9: 'maua',
  10: 'carijos',
  11: 'reidomodulo',
  16: 'central'
};

export const STORE_SLUG_TO_INBOX: Record<string, number> = {
  central: 1,
  jorgeberetta: 2,
  kennedy: 3,
  dompedro: 4,
  rudgeramos: 5,
  jabaquara: 6,
  piraporinha: 7,
  planalto: 8,
  maua: 9,
  carijos: 10,
  reidomodulo: 11
};

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export class ChatwootConversationReader {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly cacheTtlMs: number;
  private readonly fetchFn: typeof fetch;

  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(config: ChatwootConversationReaderConfig = {}) {
    this.baseUrl = (config.baseUrl || process.env.CHATWOOT_URL || 'https://chat.tork.services').replace(/\/+$/, '');
    this.apiToken = (config.apiToken || process.env.CHATWOOT_TOKEN || 'pQ44LMiCu1XS1VcBGCEPywTd').replace(/["']/g, '');
    this.accountId = config.accountId || process.env.CHATWOOT_ACCOUNT_ID || '1';
    this.cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutos
    this.fetchFn = config.fetchFn || fetch;
  }

  /**
   * Limpa dados privados sensíveis (cartões, senhas, CVVs e CPFs) antes de expor o texto.
   */
  public static sanitizeMessageText(rawText: string | null | undefined): string {
    if (!rawText) return '';

    let text = rawText;

    // 1. Redação de números de cartão (13 a 16 dígitos contínuos ou com espaços/traços)
    text = text.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARTAO_REDUZIDO]');

    // 2. Redação de CVV explícito
    text = text.replace(/\b(?:cvv|cvc|seguran[cç]a)\s*[:=]?\s*\d{3,4}\b/gi, '[CVV_REDUZIDO]');

    // 3. Redação de CPF (formato 000.000.000-00 ou 11 dígitos sequenciais)
    text = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF_REDUZIDO]');

    // 4. Redação de Senhas
    text = text.replace(/\b(?:senha|password|pin)\s*[:=]?\s*\S+\b/gi, '[SENHA_REDUZIDA]');

    return text.trim();
  }

  /**
   * Normaliza número telefônico para formato limpo internacional.
   */
  public static normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55')) return digits;
    return `55${digits}`;
  }

  /**
   * Gera o link web canônico do Chatwoot.
   */
  public buildChatwootUrl(conversationId: number): string {
    return `${this.baseUrl}/app/accounts/${this.accountId}/conversations/${conversationId}`;
  }

  /**
   * Gera o link de contato direto via WhatsApp (wa.me).
   */
  public static buildWaLink(phone: string | null | undefined): string | undefined {
    const clean = ChatwootConversationReader.normalizePhone(phone);
    if (!clean || clean.length < 10) return undefined;
    return `https://wa.me/${clean}`;
  }

  /**
   * Busca mensagens de uma conversa com paginação e higienização LGPD.
   */
  public async getConversationMessages(
    options: ConversationHistoryQueryOptions
  ): Promise<readonly SanitizedChatMessage[]> {
    const { conversationId, limit = 50, beforeMessageId, includePrivateNotes = false } = options;
    const cacheKey = `msgs:${conversationId}:${limit}:${beforeMessageId || 'latest'}:${includePrivateNotes}`;

    const cached = this.getFromCache<readonly SanitizedChatMessage[]>(cacheKey);
    if (cached) return cached;

    let url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;
    if (beforeMessageId) {
      url += `?before=${beforeMessageId}`;
    }

    try {
      const response = await this.fetchFn(url, {
        headers: {
          'api_access_token': this.apiToken,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Chatwoot API error: ${response.status} ${response.statusText}`);
      }

      const body = await response.json() as { payload?: unknown[] };
      const rawPayload = Array.isArray(body?.payload) ? body.payload : [];

      const sanitized: SanitizedChatMessage[] = [];

      for (const item of rawPayload) {
        if (!item || typeof item !== 'object') continue;
        const msg = item as Record<string, unknown>;

        const isPrivate = Boolean(msg.private);
        if (isPrivate && !includePrivateNotes) {
          continue; // Pula notas privadas não autorizadas
        }

        const msgType = Number(msg.message_type);
        let senderType: SanitizedChatMessage['senderType'] = 'client';
        if (msgType === 1) senderType = 'agent';
        else if (msgType === 2) senderType = 'system';
        else if (msgType === 3) senderType = 'bot';

        const sender = (msg.sender && typeof msg.sender === 'object')
          ? (msg.sender as Record<string, unknown>)
          : undefined;

        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        const attachmentUrls: string[] = [];
        for (const att of attachments) {
          if (att && typeof att === 'object' && typeof (att as Record<string, unknown>).data_url === 'string') {
            attachmentUrls.push((att as Record<string, unknown>).data_url as string);
          }
        }

        const rawContent = typeof msg.content === 'string' ? msg.content : '';

        sanitized.push({
          messageId: Number(msg.id) || 0,
          conversationId,
          senderType,
          senderName: typeof sender?.name === 'string' ? sender.name : undefined,
          content: ChatwootConversationReader.sanitizeMessageText(rawContent),
          isPrivate,
          hasAttachments: attachmentUrls.length > 0,
          attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
          createdAt: typeof msg.created_at === 'number'
            ? new Date(msg.created_at * 1000).toISOString()
            : (typeof msg.created_at === 'string' ? msg.created_at : new Date().toISOString())
        });
      }

      // Ordena cronologicamente crescente
      sanitized.sort((a, b) => a.messageId - b.messageId);
      const result = Object.freeze(sanitized.slice(-limit));

      this.setInCache(cacheKey, result);
      return result;
    } catch (err: unknown) {
      console.warn(`[CHATWOOT_READER] Falha ao consultar mensagens da conversa #${conversationId}:`, err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Busca resumo e metadados de uma conversa específica.
   */
  public async getConversationSummary(
    conversationId: number
  ): Promise<ChatwootConversationSummary | null> {
    const cacheKey = `summary:${conversationId}`;
    const cached = this.getFromCache<ChatwootConversationSummary>(cacheKey);
    if (cached) return cached;

    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}`;

    try {
      const response = await this.fetchFn(url, {
        headers: {
          'api_access_token': this.apiToken,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Chatwoot API error: ${response.status}`);
      }

      const conv = await response.json() as Record<string, unknown>;
      const inboxId = Number(conv.inbox_id) || 1;
      const storeSlug = INBOX_TO_STORE_SLUG[inboxId] || 'central';

      const meta = (conv.meta && typeof conv.meta === 'object')
        ? (conv.meta as Record<string, unknown>)
        : {};
      const sender = (meta.sender && typeof meta.sender === 'object')
        ? (meta.sender as Record<string, unknown>)
        : {};

      const contactPhone = typeof sender.phone_number === 'string'
        ? ChatwootConversationReader.normalizePhone(sender.phone_number)
        : undefined;

      const summary: ChatwootConversationSummary = {
        conversationId,
        inboxId,
        storeSlug,
        contactId: Number(sender.id) || 0,
        contactName: typeof sender.name === 'string' ? sender.name : 'Cliente',
        contactPhone,
        status: (conv.status === 'open' || conv.status === 'resolved' || conv.status === 'pending')
          ? conv.status
          : 'open',
        unreadCount: Number(conv.unread_count) || 0,
        lastMessageSnippet: undefined,
        lastMessageAt: typeof conv.last_activity_at === 'number'
          ? new Date(conv.last_activity_at * 1000).toISOString()
          : (typeof conv.last_activity_at === 'string' ? conv.last_activity_at : undefined),
        chatwootUrl: this.buildChatwootUrl(conversationId),
        waLink: ChatwootConversationReader.buildWaLink(contactPhone)
      };

      this.setInCache(cacheKey, summary);
      return summary;
    } catch (err: unknown) {
      console.warn(`[CHATWOOT_READER] Erro ao buscar resumo da conversa #${conversationId}:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Busca contatos no Chatwoot por nome, telefone ou placa e retorna suas conversas associadas.
   */
  public async searchConversations(
    query: string,
    limit = 10
  ): Promise<readonly ChatwootConversationSummary[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const cacheKey = `search:${cleanQuery}:${limit}`;
    const cached = this.getFromCache<readonly ChatwootConversationSummary[]>(cacheKey);
    if (cached) return cached;

    try {
      const searchUrl = `${this.baseUrl}/api/v1/accounts/${this.accountId}/contacts/search?q=${encodeURIComponent(cleanQuery)}`;
      const response = await this.fetchFn(searchUrl, {
        headers: {
          'api_access_token': this.apiToken,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Chatwoot API error: ${response.status}`);
      }

      const body = await response.json() as { payload?: unknown[] };
      const contacts = Array.isArray(body?.payload) ? body.payload : [];

      const summaries: ChatwootConversationSummary[] = [];

      for (const contactItem of contacts.slice(0, 5)) {
        if (!contactItem || typeof contactItem !== 'object') continue;
        const contact = contactItem as Record<string, unknown>;
        const contactId = Number(contact.id);
        if (!contactId) continue;

        const convs = await this.getContactConversations(contactId);
        summaries.push(...convs);
      }

      const result = Object.freeze(summaries.slice(0, limit));
      this.setInCache(cacheKey, result);
      return result;
    } catch (err: unknown) {
      console.warn(`[CHATWOOT_READER] Falha na busca por "${cleanQuery}":`, err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Busca todas as conversas ativas associadas a um contato específico.
   */
  public async getContactConversations(
    contactId: number
  ): Promise<readonly ChatwootConversationSummary[]> {
    const cacheKey = `contact_convs:${contactId}`;
    const cached = this.getFromCache<readonly ChatwootConversationSummary[]>(cacheKey);
    if (cached) return cached;

    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/contacts/${contactId}/conversations`;

    try {
      const response = await this.fetchFn(url, {
        headers: {
          'api_access_token': this.apiToken,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) return [];

      const body = await response.json() as { payload?: unknown[] };
      const rawConvs = Array.isArray(body?.payload) ? body.payload : [];

      const list: ChatwootConversationSummary[] = [];

      for (const item of rawConvs) {
        if (!item || typeof item !== 'object') continue;
        const conv = item as Record<string, unknown>;
        const convId = Number(conv.id);
        if (!convId) continue;

        const inboxId = Number(conv.inbox_id) || 1;
        const storeSlug = INBOX_TO_STORE_SLUG[inboxId] || 'central';

        const meta = (conv.meta && typeof conv.meta === 'object')
          ? (conv.meta as Record<string, unknown>)
          : {};
        const sender = (meta.sender && typeof meta.sender === 'object')
          ? (meta.sender as Record<string, unknown>)
          : {};

        const contactPhone = typeof sender.phone_number === 'string'
          ? ChatwootConversationReader.normalizePhone(sender.phone_number)
          : undefined;

        list.push({
          conversationId: convId,
          inboxId,
          storeSlug,
          contactId,
          contactName: typeof sender.name === 'string' ? sender.name : 'Cliente',
          contactPhone,
          status: (conv.status === 'open' || conv.status === 'resolved' || conv.status === 'pending')
            ? conv.status
            : 'open',
          unreadCount: Number(conv.unread_count) || 0,
          lastMessageAt: typeof conv.last_activity_at === 'number'
            ? new Date(conv.last_activity_at * 1000).toISOString()
            : undefined,
          chatwootUrl: this.buildChatwootUrl(convId),
          waLink: ChatwootConversationReader.buildWaLink(contactPhone)
        });
      }

      const result = Object.freeze(list);
      this.setInCache(cacheKey, result);
      return result;
    } catch {
      return [];
    }
  }

  // --- Gerenciamento Interno de Cache LRU ---
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setInCache<T>(key: string, value: T): void {
    if (this.cache.size > 200) {
      // Remove a chave mais antiga
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }
}
