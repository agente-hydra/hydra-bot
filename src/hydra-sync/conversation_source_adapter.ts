/**
 * Hydra — Adaptador de Fontes de Conversas (Chatwoot & Evolution)
 * Spec: hydra-os-conversation-context
 * Responsabilidade: Executor 2 (Fontes, Dados e Evidências)
 */

import { SanitizedMessage } from './types/conversation_context_contract';

export interface ChatwootMessageRaw {
  readonly id: number;
  readonly content: string;
  readonly message_type: number; // 0 = incoming (contact), 1 = outgoing (agent), 2 = activity, 3 = template
  readonly private: boolean;
  readonly created_at: number | string;
  readonly updated_at?: number | string;
  readonly sender?: {
    readonly id: number;
    readonly name: string;
    readonly type: string;
  };
  readonly attachments?: readonly {
    readonly file_type: string;
    readonly data_url?: string;
  }[];
}

export interface EvolutionMessageRaw {
  readonly key: {
    readonly id: string;
    readonly fromMe: boolean;
    readonly remoteJid: string;
  };
  readonly pushName?: string;
  readonly message?: {
    readonly conversation?: string;
    readonly extendedTextMessage?: { readonly text: string };
    readonly audioMessage?: { readonly seconds?: number; readonly ptt?: boolean };
    readonly imageMessage?: { readonly caption?: string };
    readonly documentMessage?: { readonly fileName?: string };
  };
  readonly messageTimestamp: number | string;
}

export interface FetchMessagesOptions {
  readonly conversationId: number;
  readonly sinceMessageId?: number;
  readonly limit?: number;
  readonly includePrivateNotes?: boolean;
}

export class ConversationSourceAdapter {
  private inMemoryStore: Map<number, SanitizedMessage[]> = new Map();
  private markAsReadCallsCount = 0; // Monitor de segurança: DEVE permanecer zero

  /**
   * Registra mensagens mockadas para teste e simulação de store.
   */
  public seedMessages(conversationId: number, messages: SanitizedMessage[]): void {
    this.inMemoryStore.set(conversationId, [...messages]);
  }

  /**
   * Retorna o ID da mensagem mais recente da conversa para verificação rápida de novidade (Lag check).
   */
  public async getLatestMessageId(conversationId: number): Promise<number | null> {
    const msgs = this.inMemoryStore.get(conversationId) || [];
    if (msgs.length === 0) return null;
    return msgs[msgs.length - 1].messageId;
  }

  /**
   * Leitura de mensagens com paginação e filtro por cursor `sinceMessageId`.
   * REGRA PÉTREA: Estritamente não-intrusivo. Zero chamadas para marcar como lida.
   */
  public async fetchMessages(options: FetchMessagesOptions): Promise<SanitizedMessage[]> {
    const { conversationId, sinceMessageId = 0, limit = 20, includePrivateNotes = false } = options;

    const msgs = this.inMemoryStore.get(conversationId) || [];

    // Filtra mensagens posteriores ao cursor
    let filtered = msgs.filter(m => m.messageId > sinceMessageId);

    // Filtra mensagens privadas se não houver autorização explícita
    if (!includePrivateNotes) {
      filtered = filtered.filter(m => !m.isPrivate);
    }

    // Exclui mensagens marcadas como deletadas
    filtered = filtered.filter(m => !m.isDeleted);

    // Aplica limite de budget
    return filtered.slice(0, limit);
  }

  /**
   * Mapeamento de mensagem bruta do Chatwoot para o contrato canônico SanitizedMessage.
   */
  public adaptChatwootMessage(raw: ChatwootMessageRaw, conversationId: number): SanitizedMessage {
    let senderType: 'user' | 'contact' | 'agent' | 'bot' = 'contact';
    if (raw.message_type === 1) senderType = 'agent';
    else if (raw.message_type === 2) senderType = 'bot';
    else if (raw.sender?.type === 'user') senderType = 'agent';

    let attachmentType: 'image' | 'audio' | 'document' | 'other' | undefined = undefined;
    const hasAttachments = Boolean(raw.attachments && raw.attachments.length > 0);
    if (hasAttachments && raw.attachments && raw.attachments[0]) {
      const ft = raw.attachments[0].file_type.toLowerCase();
      if (ft.includes('audio')) attachmentType = 'audio';
      else if (ft.includes('image')) attachmentType = 'image';
      else if (ft.includes('pdf') || ft.includes('doc')) attachmentType = 'document';
      else attachmentType = 'other';
    }

    const createdAtIso = typeof raw.created_at === 'number'
      ? new Date(raw.created_at * 1000).toISOString()
      : new Date(raw.created_at).toISOString();

    return {
      messageId: raw.id,
      conversationId,
      senderType,
      senderName: raw.sender?.name || (senderType === 'agent' ? 'Atendente' : 'Cliente'),
      textContent: raw.content || '',
      isPrivate: Boolean(raw.private),
      createdAt: createdAtIso,
      updatedAt: raw.updated_at ? new Date(raw.updated_at).toISOString() : undefined,
      hasAttachments,
      attachmentType,
      isTranscribed: false
    };
  }

  /**
   * Mapeamento de mensagem bruta da Evolution API (WhatsApp) para o contrato canônico SanitizedMessage.
   */
  public adaptEvolutionMessage(raw: EvolutionMessageRaw, conversationId: number, numericId: number): SanitizedMessage {
    const isFromMe = raw.key.fromMe;
    const senderType = isFromMe ? 'agent' : 'contact';
    const senderName = isFromMe ? 'Oficina' : (raw.pushName || 'Cliente');

    let textContent = '';
    let hasAttachments = false;
    let attachmentType: 'image' | 'audio' | 'document' | 'other' | undefined = undefined;

    if (raw.message?.conversation) {
      textContent = raw.message.conversation;
    } else if (raw.message?.extendedTextMessage?.text) {
      textContent = raw.message.extendedTextMessage.text;
    } else if (raw.message?.audioMessage) {
      hasAttachments = true;
      attachmentType = 'audio';
      textContent = '[Áudio sem transcrição]';
    } else if (raw.message?.imageMessage) {
      hasAttachments = true;
      attachmentType = 'image';
      textContent = raw.message.imageMessage.caption || '[Imagem]';
    } else if (raw.message?.documentMessage) {
      hasAttachments = true;
      attachmentType = 'document';
      textContent = raw.message.documentMessage.fileName || '[Documento]';
    }

    const timestampNum = typeof raw.messageTimestamp === 'number'
      ? raw.messageTimestamp
      : parseInt(String(raw.messageTimestamp), 10);
    const createdAtIso = new Date(timestampNum * 1000).toISOString();

    return {
      messageId: numericId,
      conversationId,
      senderType,
      senderName,
      textContent,
      isPrivate: false,
      createdAt: createdAtIso,
      hasAttachments,
      attachmentType,
      isTranscribed: false
    };
  }

  /**
   * Auditoria de segurança: comprova que nenhum efeito colateral de escrita foi disparado.
   */
  public getWriteEffectSideCount(): number {
    return this.markAsReadCallsCount;
  }
}
