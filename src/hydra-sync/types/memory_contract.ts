/**
 * Contrato de Memória Atômica Estruturada e RAG do Hydra
 */

export type MemoryType = 'explicit_preference' | 'correction' | 'derived_interest';
export type MemoryScopeType = 'perfil_global' | 'rede' | 'loja';
export type MemoryStatus = 'candidate' | 'active' | 'superseded' | 'expired' | 'invalidated';

export interface MemoryRecord {
  memoryId: string;
  phone: string;
  generationId: number;
  scopeType: MemoryScopeType; // 'perfil_global' para apresentação; 'rede' para sócio; 'loja' para gerente
  lojaSlug: string | null; // Loja vinculada ou null para rede/perfil_global
  memoryType: MemoryType;
  topicKey: string; // Chave semântica (ex: 'cmv_display_unit', 'alias_retidos')
  contentNormalized: string; // Conteúdo normalizado da preferência/regra
  evidenceText: string; // Citação do turno do usuário
  sourceTurnIds: string[]; // IDs de mensagens/turnos de origem para deduplicação idempotente
  status: MemoryStatus;
  confidence: number; // 0.0 a 1.0
  occurrenceCount: number; // Frequência de confirmações
  distinctDays: string[]; // Datas distintas no fuso America/Sao_Paulo (ex: ['2026-09-28', '2026-09-30'])
  supersededBy?: string; // ID da memória sucessora se status === 'superseded'
  createdAt: string; // ISO 8601
  confirmedAt: string; // Data da última confirmação
  expiresAt?: string; // Data de expiração por TTL
}

export interface MemoryCandidate {
  memoryType: MemoryType;
  scopeType: MemoryScopeType;
  lojaSlug?: string;
  topicKey: string;
  contentNormalized: string;
  evidenceText: string;
  confidence?: number;
}

export interface MemoryRetrievalFilter {
  phone: string;
  generationId: number;
  effectivePersona: 'socio' | 'gerente';
  activeLojaSlug?: string | null;
  topicKey?: string; // Para getMemoriesByTopic
  maxItems?: number; // Padrão: 3
}

export interface MemoryRetrievalResult {
  memories: MemoryRecord[];
  formattedContext: string; // Bloco formatado para o prompt (<150 tokens)
  source: 'structured_direct' | 'hybrid_vector' | 'fallback_empty';
  latencyMs: number;
}
