/**
 * src/hydra-sync/types/public_guard_contract.ts
 * Contratos estritos para a Barreira de Proteção Pública e Sanitização Anti-Vazamento.
 */

export type MemoryFunctionalStatus = 
  | 'recording_active'      // Salvamento confirmado e histórico disponível
  | 'recording_pending'     // Evento na fila durável, escrita pendente em disco
  | 'recording_unavailable' // Falha de disco/vault, indisponível no momento
  | 'history_empty';        // Vault acessível, mas sem histórico anterior nesta sessão

export interface PublicGuardPolicy {
  blockFilePaths: boolean;        // Bloqueia /home, /opt, /tmp, C:\, etc.
  blockInternalSchemas: boolean;   // Bloqueia SELECT, FROM hydra_, CREATE TABLE
  blockToolNames: boolean;         // Bloqueia nomes internos de tools (get_aging_cars, etc.)
  blockInternalPrompts: boolean;   // Bloqueia trechos literais de system_prompt.md
  blockInfrastructure: boolean;    // Bloqueia menções a VPS, PM2, portas, PIDs, Docker
  blockCredentials: boolean;       // Bloqueia tokens, apikeys, secrets, senhas
  maxSanitizationReplacements: number;
}

export interface PublicSanitizationResult {
  isSafe: boolean;
  cleanText: string;
  violationsFound: string[];
  redactedCategories: Array<'path' | 'schema' | 'tool' | 'prompt' | 'infra' | 'credential'>;
  fallbackApplied: boolean;
}

export interface PublicMemoryStatusReply {
  functionalStatus: MemoryFunctionalStatus;
  displayText: string;
  knownPreferences?: string[];
  canRecallHistory: boolean;
}
