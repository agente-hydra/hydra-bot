/**
 * src/hydra-sync/types/vault_contract.ts
 * Contratos estritos para integração do Obsidian Vault, Diagnóstico de Runtime e Traces.
 */

export type VaultMemoryType = 'explicit_preference' | 'correction' | 'derived_interest';
export type VaultMemoryStatus = 'active' | 'candidate' | 'superseded' | 'revoked';
export type VaultScopeType = 'perfil_global' | 'rede' | 'loja';

export interface VaultFrontmatter {
  id: string;
  owner: string; // phone_canonical (ex: 5511999990001)
  generation_id: number;
  scope_type: VaultScopeType;
  loja_slug: string | null;
  topic_key: string;
  memory_type: VaultMemoryType;
  status: VaultMemoryStatus;
  version: number;
  confidence: number;
  evidence_text: string;
  source_turn_ids: string[];
  created_at: string; // ISO 8601 America/Sao_Paulo
  confirmed_at: string | null;
  expires_at: string | null;
  superseded_by: string | null;
}

export interface VaultNote {
  frontmatter: VaultFrontmatter;
  content: string;
  relativePath: string; // ex: preferencias/mem_...md
  absolutePath: string;
  fileHash: string; // SHA-256 do arquivo em disco
  updatedAt: string;
}

export interface VaultDiagnosticsResult {
  isVaultConfigured: boolean;
  vaultPath: string;
  isAccessible: boolean;
  totalUserNotes: number;
  activeNotesCount: number;
  memoryGeneration: number;
  indexVersion: number;
  pendingOperationsCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface RuntimeDiagnosticsPayload {
  vault: VaultDiagnosticsResult;
  memory: {
    totalActiveMemories: number;
    effectivePersona: 'socio' | 'gerente';
    activeLojaSlug: string | null;
    memoryGeneration: number;
    retrievalSource: 'vault_direct' | 'sqlite_index' | 'empty';
  };
  tools: {
    mcpAvailable: boolean;
    serverStatus: 'connected' | 'disconnected' | 'bypassed';
    registeredTools: string[];
  };
  serverTime: string; // ISO 8601 America/Sao_Paulo
}

export interface ConversationHistoryQuery {
  phone: string;
  generationId?: number;
  scope: 'today' | 'current_generation' | 'all_available';
  queryType: 'first_question' | 'recent_turns' | 'turn_count';
  limit?: number;
}

export interface ConversationHistoryResult {
  queryType: 'first_question' | 'recent_turns' | 'turn_count';
  found: boolean;
  firstQuestion?: {
    text: string;
    timestamp: string;
    turnId: string;
  };
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    turnId: string;
  }>;
  totalTurnCount?: number;
  explanation: string;
}

export interface ToolCallTrace {
  turnId: string;
  toolName: string;
  toolSource: 'mcp' | 'sqlite_adapter' | 'vault';
  inputParams: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  status: 'SUCCESS' | 'ERROR';
  errorMessage?: string;
}
