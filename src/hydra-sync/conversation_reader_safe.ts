/**
 * Hydra — Leitor Não-Intrusivo Seguro e Blindagem Anti-Injection
 * Spec: hydra-os-conversation-context (Versão 2)
 * Responsabilidade: Executor 3 (Compilador, Consultas e Orquestração)
 * Correção F06 & Gate 5: Registro de lacuna TRUNCATED_HISTORY quando histórico excede limite
 */

import { SanitizedMessage, ConversationGap } from './types/conversation_context_contract';
import { ConversationSourceAdapter, FetchMessagesOptions } from './conversation_source_adapter';

export interface ConversationReaderSafeOptions {
  readonly maxMessagesBudget?: number;
  readonly requestTimeoutMs?: number;
}

export interface ComplementaryReadResult {
  readonly messages: readonly SanitizedMessage[];
  readonly gaps: readonly ConversationGap[];
  readonly truncationGap: boolean;
  readonly lastMessageRepresented: boolean;
  readonly totalInspectedCount: number;
}

export class ConversationReaderSafe {
  private readonly maxMessagesBudget: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly sourceAdapter: ConversationSourceAdapter,
    options?: ConversationReaderSafeOptions
  ) {
    this.maxMessagesBudget = options?.maxMessagesBudget ?? 20;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 4000;
  }

  /**
   * Leitura do modo complementar com controle estrito de budget (teto de 20 msgs).
   * Se o histórico na fonte possuir mais mensagens além do teto solicitado/orçamento,
   * registra compulsoriamente ConversationGap do tipo 'TRUNCATED_HISTORY'.
   * Retorna flag truncationGap: true e lastMessageRepresented: false (Correção F06 & Gate 5).
   */
  public async readComplementaryHistory(options: FetchMessagesOptions): Promise<ComplementaryReadResult> {
    const effectiveLimit = Math.min(options.limit ?? this.maxMessagesBudget, this.maxMessagesBudget);
    const gaps: ConversationGap[] = [];

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<SanitizedMessage[]>((_, reject) => {
      timer = setTimeout(() => reject(new Error('TIMEOUT_CONVERSATION_SOURCE')), this.requestTimeoutMs);
    });

    try {
      // Requisita effectiveLimit + 1 para detecção determinística de excesso de histórico (truncamento)
      const rawMessages = await Promise.race([
        this.sourceAdapter.fetchMessages({
          ...options,
          limit: effectiveLimit + 1
        }),
        timeoutPromise
      ]);

      const hasMoreThanBudget = rawMessages.length > effectiveLimit;
      const cappedRaw = hasMoreThanBudget ? rawMessages.slice(0, effectiveLimit) : rawMessages;

      let truncationGap = false;
      let lastMessageRepresented = true;

      if (hasMoreThanBudget) {
        truncationGap = true;
        lastMessageRepresented = false;
        gaps.push({
          gapId: `gap_trunc_${options.conversationId}_${Date.now()}`,
          conversationId: options.conversationId,
          gapType: 'TRUNCATED_HISTORY',
          timestamp: new Date().toISOString(),
          description: `Histórico truncado no limite de ${effectiveLimit} mensagens; podem existir mensagens mais recentes não analisadas.`
        });
      }

      // Sanitização de todas as mensagens
      const sanitizedMessages = cappedRaw.map(msg => this.sanitize(msg));

      // Verificação de lacunas de mídia (ex: áudio não transcrito - T50)
      for (const msg of sanitizedMessages) {
        if (msg.hasAttachments && msg.attachmentType === 'audio' && !msg.isTranscribed) {
          gaps.push({
            gapId: `gap_audio_${msg.messageId}`,
            messageId: msg.messageId,
            conversationId: msg.conversationId,
            gapType: 'UNTRANSCRIBED_AUDIO',
            timestamp: msg.createdAt,
            description: 'Áudio enviado no atendimento sem transcrição textual disponível.'
          });
        }
      }

      return {
        messages: sanitizedMessages,
        gaps,
        truncationGap,
        lastMessageRepresented,
        totalInspectedCount: sanitizedMessages.length
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Executa a leitura paginada respeitando budget de mensagens e timeout.
   * Aplica sanitização prévia contra caracteres adversariais e delimitação de dados.
   */
  public async readMessagesSafely(options: FetchMessagesOptions): Promise<SanitizedMessage[]> {
    const result = await this.readComplementaryHistory(options);
    return [...result.messages];
  }

  /**
   * Leitura de mensagens recentes para modo complementar com suporte a budget,
   * cursor sinceMessageId e propagação explícita de gap de truncamento.
   */
  public async readRecentMessages(options: {
    conversationId: number;
    sinceMessageId?: number;
    budgetLimit?: number;
  }): Promise<{
    messages: SanitizedMessage[];
    lastMessageId: number;
    hasMore: boolean;
    truncationGap?: ConversationGap;
    gaps: ConversationGap[];
  }> {
    const limit = options.budgetLimit ?? this.maxMessagesBudget;
    const result = await this.readComplementaryHistory({
      conversationId: options.conversationId,
      sinceMessageId: options.sinceMessageId,
      limit
    });

    const lastMessageId = result.messages.length > 0
      ? Math.max(...result.messages.map(m => m.messageId))
      : (options.sinceMessageId ?? 0);

    const truncGap = result.gaps.find(g => g.gapType === 'TRUNCATED_HISTORY');

    return {
      messages: [...result.messages],
      lastMessageId,
      hasMore: !result.lastMessageRepresented,
      truncationGap: truncGap,
      gaps: [...result.gaps]
    };
  }

  /**
   * Sanitização e blindagem contra Prompt Injection:
   * Remove sequências de escape, tags de controle do modelo e normaliza strings.
   * O texto continua literal, mas neutralizado como comando.
   */
  public sanitize(msg: SanitizedMessage): SanitizedMessage {
    let cleanText = msg.textContent
      .replace(/<\|im_start\|>/gi, '')
      .replace(/<\|im_end\|>/gi, '')
      .replace(/<\|system\|>/gi, '')
      .replace(/<\|user\|>/gi, '')
      .replace(/<\|assistant\|>/gi, '')
      .replace(/\[SYSTEM\]/gi, '[USUARIO_TEXTO]')
      .replace(/\[INSTRUCTION\]/gi, '[TEXTO]');

    return {
      ...msg,
      textContent: cleanText
    };
  }
}
