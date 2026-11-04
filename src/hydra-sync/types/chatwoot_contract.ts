/**
 * Contratos de Tipos para o Conector de Conversas do Chatwoot (Spec 059)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

export interface SanitizedChatMessage {
  readonly messageId: number;
  readonly conversationId: number;
  readonly senderType: 'client' | 'agent' | 'bot' | 'system';
  readonly senderName?: string;
  readonly content: string;
  readonly isPrivate: boolean;
  readonly hasAttachments: boolean;
  readonly attachmentUrls?: readonly string[];
  readonly createdAt: string;
}

export interface ChatwootConversationSummary {
  readonly conversationId: number;
  readonly inboxId: number;
  readonly storeSlug: string;
  readonly contactId: number;
  readonly contactName: string;
  readonly contactPhone?: string;
  readonly status: 'open' | 'resolved' | 'pending';
  readonly unreadCount: number;
  readonly lastMessageSnippet?: string;
  readonly lastMessageAt?: string;
  readonly chatwootUrl: string;
  readonly waLink?: string;
}

export interface ChatwootConversationReaderConfig {
  readonly baseUrl?: string;
  readonly apiToken?: string;
  readonly accountId?: string;
  readonly cacheTtlMs?: number;
  readonly fetchFn?: typeof fetch;
}

export interface ConversationHistoryQueryOptions {
  readonly conversationId: number;
  readonly limit?: number;
  readonly beforeMessageId?: number;
  readonly includePrivateNotes?: boolean;
}
