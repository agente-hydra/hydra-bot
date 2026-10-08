/**
 * Contrato de Identidade, Acesso e Autorização Segregada do Hydra
 */

export type UserRole = 'socio' | 'gerente' | 'operador';

export interface AuthorizedUser {
  phone: string; // E.164 canônico: '5511996242812'
  name: string;
  role: UserRole;
  allowedStores: string[]; // ['*'] para rede completa, ou ['MPJorgeBeretta']
  isActive: boolean;
  canSimulatePersona: boolean; // Permissão exclusiva para /socio e /{loja}
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface PhoneIdentityMapping {
  remoteJid: string; // Ex: '271077481652389@lid' ou '5511996242812@s.whatsapp.net'
  phoneCanonical: string; // '5511996242812'
  identityType: 'PN' | 'LID';
  pushName?: string;
  verifiedAt: string;
}

export interface AuthorizedContext {
  phone: string;
  remoteJid: string;
  user: AuthorizedUser;
  effectivePersona: 'socio' | 'gerente';
  activeStoreSlug: string | null; // null para sócio/rede
  activeStoreName: string | null;
  memoryGeneration: number;
  scopeVersion: string;
  messageId: string;
  batchId?: string;
}

export interface SecurityRejectionLog {
  remoteJidMasked: string;
  phoneMasked?: string;
  reason: 'unauthorized_user' | 'unresolved_identity' | 'revoked_user' | 'invalid_webhook_token' | 'group_message_prohibited';
  endpoint: 'webhook_ingress' | 'queue_consumer' | 'tool_execution' | 'message_egress';
  timestamp: string;
}
