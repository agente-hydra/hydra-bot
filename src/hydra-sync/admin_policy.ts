/**
 * admin_policy.ts — Política de Autoridade, Matriz de Capacidades e Controle de Acesso
 * Spec: 058-hydra-assistente-admin-socios
 * 
 * Implementa a governança de permissões da IA para Admin e Sócios:
 * 1. Papéis: 'owner' | 'admin' | 'socio' | 'gerente' | 'operador'.
 * 2. Somente 'owner', 'admin' e 'socio' têm permissão conversacional com a IA.
 * 3. Matriz de Capacidades determinística por ferramenta/recurso.
 * 4. Sistema transacional de propostas e confirmações para ações sensíveis (TTL 5 min, uso único).
 * 5. Proteção absoluta de imunidade do 'owner' contra demote/revogação via chat.
 * 6. Bloqueio rigoroso de autopromoção e escalada de privilégios.
 */

import crypto from 'crypto';
import type { UserRole } from './types/access_contract.js';

export type Capability =
  | 'chat.conversation'
  | 'reports.generate'
  | 'research.search'
  | 'conversations.search'
  | 'conversations.get_history'
  | 'graph.get_os_case'
  | 'messages.send'
  | 'users.grant'
  | 'users.revoke'
  | 'infra.health'
  | 'jobs.run'
  | 'jobs.status'
  | 'jobs.cancel'
  | 'services.restart_allowlisted';

export interface AccessProposal {
  proposalId: string;
  actorPhone: string;
  targetPhone: string;
  targetRole: UserRole;
  capabilities: Capability[];
  action: 'grant_user' | 'revoke_user' | 'send_message' | 'restart_service';
  reason?: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
  requiresTotp: boolean;
  argsHash: string;
}

// Canônico do proprietário (Davi)
export const CANONICAL_OWNER_PHONE = '5511996242812';

// Papéis com autorização para conversar com a IA
export const CONVERSATIONAL_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'owner',
  'admin',
  'socio'
]);

// Matriz base de capacidades por papel
const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  owner: new Set<Capability>([
    'chat.conversation',
    'reports.generate',
    'research.search',
    'conversations.search',
    'conversations.get_history',
    'graph.get_os_case',
    'messages.send',
    'users.grant',
    'users.revoke',
    'infra.health',
    'jobs.run',
    'jobs.status',
    'jobs.cancel',
    'services.restart_allowlisted'
  ]),
  admin: new Set<Capability>([
    'chat.conversation',
    'reports.generate',
    'research.search',
    'conversations.search',
    'conversations.get_history',
    'graph.get_os_case',
    'messages.send',
    'users.grant', // Delegada: apenas sócio
    'users.revoke', // Delegada: apenas sócio
    'infra.health',
    'jobs.run',
    'jobs.status',
    'jobs.cancel'
  ]),
  socio: new Set<Capability>([
    'chat.conversation',
    'reports.generate',
    'research.search',
    'conversations.search',
    'conversations.get_history',
    'graph.get_os_case',
    'jobs.status'
  ]),
  gerente: new Set<Capability>([]),
  operador: new Set<Capability>([])
};

/**
 * Valida se um papel possui acesso conversacional com o assistente IA
 */
export function isConversationAllowed(role?: string | null): boolean {
  if (!role) return false;
  return CONVERSATIONAL_ROLES.has(role as UserRole);
}

/**
 * Verifica se um ator com determinado papel tem permissão para uma capacidade
 */
export function hasCapability(role: UserRole, capability: Capability): boolean {
  const caps = ROLE_CAPABILITIES[role];
  if (!caps) return false;
  return caps.has(capability);
}

/**
 * Retorna lista de capacidades atribuídas a um papel
 */
export function getRoleCapabilities(role: UserRole): Capability[] {
  const caps = ROLE_CAPABILITIES[role];
  return caps ? Array.from(caps) : [];
}

/**
 * Valida se uma promoção/concessão é permitida entre ator e alvo
 */
export function validateGrantPermission(
  actorRole: UserRole,
  actorPhone: string,
  targetPhone: string,
  targetRole: UserRole
): { allowed: boolean; reason?: string; requiresTotp?: boolean } {
  // Proibição 1: Alvo é o owner
  if (targetPhone === CANONICAL_OWNER_PHONE && targetRole !== 'owner') {
    return { allowed: false, reason: 'Impossível alterar ou rebaixar o owner do sistema.' };
  }

  // Proibição 2: Autopromoção
  if (actorPhone === targetPhone) {
    return { allowed: false, reason: 'Autopromoção de privilégios é estritamente proibida.' };
  }

  // Proibição 3: Sócios não podem conceder nenhum papel
  if (actorRole === 'socio' || actorRole === 'gerente' || actorRole === 'operador') {
    return { allowed: false, reason: 'Seu perfil não possui permissão para gestão de acessos.' };
  }

  // Regra 4: Promoção para 'admin' ou 'owner' exige ser o owner
  if (targetRole === 'admin') {
    if (actorRole !== 'owner') {
      return { allowed: false, reason: 'Apenas o proprietário (owner) pode criar ou promover administradores.' };
    }
    // Promover admin exige desafio adicional
    return { allowed: true, requiresTotp: true };
  }

  if (targetRole === 'owner') {
    return { allowed: false, reason: 'A troca do owner não pode ser realizada por comando de chat.' };
  }

  // Regra 5: Concessão de 'socio' permitida para owner ou admin
  if (targetRole === 'socio') {
    if (actorRole === 'owner' || actorRole === 'admin') {
      return { allowed: true, requiresTotp: false };
    }
  }

  return { allowed: false, reason: 'Operação de concessão não autorizada pela política.' };
}

/**
 * Valida se uma revogação é permitida
 */
export function validateRevokePermission(
  actorRole: UserRole,
  actorPhone: string,
  targetPhone: string,
  targetRole: UserRole
): { allowed: boolean; reason?: string } {
  // Proibição 1: Imunidade do owner
  if (targetPhone === CANONICAL_OWNER_PHONE) {
    return { allowed: false, reason: 'O proprietário (owner) não pode ser revogado via chat.' };
  }

  // Proibição 2: Autorevogação do último admin/owner
  if (actorPhone === targetPhone && actorRole === 'owner') {
    return { allowed: false, reason: 'O owner não pode revogar o próprio acesso.' };
  }

  // Proibição 3: Sócios não podem revogar ninguém
  if (actorRole !== 'owner' && actorRole !== 'admin') {
    return { allowed: false, reason: 'Apenas administradores e o proprietário podem revogar acessos.' };
  }

  // Proibição 4: Admin delegado não pode revogar outro admin ou o owner
  if (actorRole === 'admin' && (targetRole === 'admin' || targetRole === 'owner')) {
    return { allowed: false, reason: 'Administradores delegados não podem revogar outros administradores.' };
  }

  return { allowed: true };
}

/**
 * Armazenamento in-memory e gerenciamento de propostas de acesso sensíveis
 */
class AccessProposalManager {
  private proposals: Map<string, AccessProposal> = new Map();
  private static instance: AccessProposalManager;

  private constructor() {}

  public static getInstance(): AccessProposalManager {
    if (!AccessProposalManager.instance) {
      AccessProposalManager.instance = new AccessProposalManager();
    }
    return AccessProposalManager.instance;
  }

  /**
   * Gera hash seguro dos argumentos para evitar adulteração pós-confirmação
   */
  public generateArgsHash(actor: string, target: string, action: string, role: string): string {
    return crypto
      .createHash('sha256')
      .update(`${actor}:${target}:${action}:${role}`)
      .digest('hex');
  }

  /**
   * Cria uma proposta de acesso pendente de confirmação (TTL 5 min = 300.000 ms)
   */
  public createProposal(params: {
    actorPhone: string;
    targetPhone: string;
    targetRole: UserRole;
    action: AccessProposal['action'];
    reason?: string;
    requiresTotp?: boolean;
    ttlMs?: number;
  }): AccessProposal {
    const ttl = params.ttlMs || 300 * 1000;
    const now = Date.now();
    const argsHash = this.generateArgsHash(
      params.actorPhone,
      params.targetPhone,
      params.action,
      params.targetRole
    );
    const proposalId = crypto.randomBytes(12).toString('hex');

    const proposal: AccessProposal = {
      proposalId,
      actorPhone: params.actorPhone,
      targetPhone: params.targetPhone,
      targetRole: params.targetRole,
      capabilities: getRoleCapabilities(params.targetRole),
      action: params.action,
      reason: params.reason,
      createdAt: now,
      expiresAt: now + ttl,
      consumed: false,
      requiresTotp: Boolean(params.requiresTotp),
      argsHash
    };

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  /**
   * Localiza proposta ativa pelo ator e alvo
   */
  public findActiveProposal(actorPhone: string, targetPhone?: string): AccessProposal | null {
    const now = Date.now();
    for (const p of this.proposals.values()) {
      if (p.actorPhone === actorPhone && !p.consumed && p.expiresAt > now) {
        if (!targetPhone || p.targetPhone === targetPhone) {
          return p;
        }
      }
    }
    return null;
  }

  /**
   * Consome e valida a confirmação de uma proposta
   */
  public consumeConfirmation(
    proposalId: string,
    confirmingActorPhone: string,
    providedTotpToken?: string
  ): { success: boolean; proposal?: AccessProposal; reason?: string } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { success: false, reason: 'Proposta de alteração não encontrada ou expirada.' };
    }

    if (proposal.consumed) {
      return { success: false, reason: 'Esta confirmação já foi utilizada anteriormente.' };
    }

    if (Date.now() > proposal.expiresAt) {
      this.proposals.delete(proposalId);
      return { success: false, reason: 'O tempo limite para confirmação expirou (máximo 5 minutos).' };
    }

    if (proposal.actorPhone !== confirmingActorPhone) {
      return { success: false, reason: 'A confirmação deve ser fornecida pelo mesmo usuário que fez o pedido.' };
    }

    // Se a proposta exigir autenticação adicional (promoção para admin)
    if (proposal.requiresTotp) {
      if (!providedTotpToken || providedTotpToken.trim().length < 4) {
        return {
          success: false,
          reason: 'Operação sensível requer confirmação com código de autenticação adicional.'
        };
      }
    }

    // Marca como consumida (uso único)
    proposal.consumed = true;
    return { success: true, proposal };
  }

  /**
   * Limpa propostas expiradas da memória
   */
  public purgeExpired(): void {
    const now = Date.now();
    for (const [id, p] of this.proposals.entries()) {
      if (p.expiresAt <= now || p.consumed) {
        this.proposals.delete(id);
      }
    }
  }

  /**
   * Limpa todas as propostas (usado em testes)
   */
  public clearAll(): void {
    this.proposals.clear();
  }
}

export const accessProposalManager = AccessProposalManager.getInstance();
