/**
 * src/hydra-sync/conversation_semantic_resolver.ts
 *
 * Módulo de Interpretação Semântica, Resolução de Operações e Reparação de Turnos (Fase E1).
 * Implementa resolução determinística para:
 * - CONVERSATION_REPAIR (reconhecimento de gírias nn/n, descarte de fillers, preservação de alvo)
 * - CONVERSATION_HISTORY (desambiguação estrita sem colisão com "isso que perguntei")
 * - DELAY_REASON (herança de alvo em elipses como "e por que ele está parado?")
 * - VEHICLE_COUNT / VEHICLE_LIST / STORE_SUMMARY (preservação de operações de agregação)
 * - VEHICLE_SITUATION / RUNTIME_DIAGNOSTICS
 */

import type {
  OperationType,
  TurnPendingRequest,
  ExtendedTurnState
} from './types/conversation_context_contract.js';
import type { TurnState } from './turn_context_repository.js';

export const FILLER_WORDS = [
  'cara',
  'mano',
  'por favor',
  'porfavor',
  'pfv',
  'pf',
  'velho',
  'amigo',
  'brother',
  'parceiro'
] as const;

/**
 * Remove preenchimentos vazios / gírias de tratamento do início ou fim do texto.
 */
export function stripFillerWords(text: string): string {
  if (!text) return '';
  return text
    .replace(/\b(por\s*favor|porfavor|pfv|pf|cara|mano|velho|amigo|brother|parceiro)\b/gi, '')
    .replace(/^[,\s.:;!?-]+|[,\s.:;!?-]+$/g, '')
    .trim();
}

/**
 * Expressão regular estrita para detectar frases de correção conversacional
 * incluindo abreviações como "nn", "n", "nao era isso", "nao foi isso que pedi", etc.
 */
export const CORRECTION_REGEX = 
  /\b(?:desculpe|perdao|opa)?[,\s]*(?:(?:nao|nn?)\s+(?:foi|era|e)\s+isso(?:\s+que\s+(?:perguntei|pedi))?|(?:nao|nn?)\s+(?:perguntei|pedi)\s+isso|(?:nao|nn?)\s+era\s+isso|(?:nao|nn?)\s+e\s+(?:nada\s+disso|isso)|estou falando da nossa conversa|da nossa conversa|nada a ver|errou|vc entendeu errado|voce entendeu errado|interpretou errado|(?:perdao|desculpe)\s+(?:nao|nn?)\s+(?:foi|era)\s+isso)\b/i;

export const CORRECTION_PREFIX_REGEX = 
  /^(?:(?:desculpe|perdao|opa)[,\s.:;-]*)?(?:(?:nao|nn?)\s+(?:foi|era|e)\s+isso(?:\s+que\s+(?:perguntei|pedi))?|(?:nao|nn?)\s+(?:perguntei|pedi)\s+isso|(?:nao|nn?)\s+era\s+isso|(?:nao|nn?)\s+e\s+(?:nada\s+disso|isso)|(?:nao|nn?)\s+e\s+isso|estou falando da nossa conversa|da nossa conversa|nada a ver|errou|vc entendeu errado|voce entendeu errado|interpretou errado|(?:perdao|desculpe)\s+(?:nao|nn?)\s+(?:foi|era)\s+isso)[,\s.:;-]*/i;

export function isCorrectionMessage(norm: string): boolean {
  return (
    CORRECTION_REGEX.test(norm) ||
    /^(?:desculpe|perdao|opa)?[,\s]*(?:nao|nn?)\s+(?:foi|era|e)\s+isso/i.test(norm) ||
    /^(?:nao|nn?)\s+(?:era|foi)\s+isso/i.test(norm) ||
    (norm.includes('nossa conversa') && (norm.includes('salvando') || norm.includes('gravando') || norm.includes('falando')))
  );
}

/**
 * Remove o prefixo de correção e descarta preenchimentos vazios.
 * Retorna se existe consulta substantiva real remanescente.
 */
export function extractStrippedCorrection(norm: string): {
  isCorrection: boolean;
  stripped: string;
  substantive: string;
  hasSubstantiveQuery: boolean;
} {
  const isCorr = isCorrectionMessage(norm);
  if (!isCorr) {
    return { isCorrection: false, stripped: norm, substantive: norm, hasSubstantiveQuery: false };
  }
  const stripped = norm.replace(CORRECTION_PREFIX_REGEX, '').trim();
  const substantive = stripFillerWords(stripped);
  const hasSubstantiveQuery = substantive.length > 3 && !substantive.startsWith('nao') && !substantive.startsWith('nn');
  return {
    isCorrection: true,
    stripped,
    substantive,
    hasSubstantiveQuery
  };
}

/**
 * Regex estrito de boundary para histórico de perguntas,
 * garantindo que "isso que perguntei" JAMAIS ative histórico.
 */
export const STRICT_HISTORY_REGEX = /\b(o que eu perguntei|minha pergunta anterior|resumo das perguntas|o que te perguntei)\b/i;

export function isConversationHistoryStrict(norm: string): boolean {
  if (norm.includes('isso que perguntei') || norm.includes('isso que pedi')) {
    return false;
  }
  const mentionsFirstQuestion =
    norm.includes('primeira pergunta') ||
    norm.includes('primeira coisa que perguntei') ||
    norm.includes('qual foi a 1 pergunta') ||
    norm.includes('qual foi a primeira') ||
    (norm.includes('primeira') && norm.includes('pergunt'));

  const mentionsTurnHistory =
    norm.includes('historico da conversa') ||
    norm.includes('historico de conversa') ||
    norm.includes('o que eu perguntei antes') ||
    STRICT_HISTORY_REGEX.test(norm) ||
    norm.includes('perguntas anteriores') ||
    norm.includes('quantas perguntas eu fiz') ||
    norm.includes('quantas perguntas ja fiz') ||
    norm.includes('quantos turnos') ||
    norm.includes('o que conversamos hoje') ||
    norm.includes('o que a gente conversou') ||
    norm.includes('resumo da conversa');

  return (mentionsFirstQuestion || mentionsTurnHistory) && !isCorrectionMessage(norm);
}

/**
 * Identifica se a consulta pergunta o motivo do atraso/retenção do veículo.
 */
export function isDelayReasonQuery(norm: string): boolean {
  return (
    /\b(por\s*que|pq|qual\s+(?:e\s+)?o\s+motivo|motivo|razao|porqual\s*motivo)\b.*\b(parado|retido|travado|atraso|atrasado|sem andar)\b/i.test(norm) ||
    /\b(por\s*que|pq)\s+(?:ele\s+)?(?:ta|esta|ficou)\s+(?:tao\s+)?(parado|retido|travado)\b/i.test(norm) ||
    /\b(por\s*que|pq)\s+(?:ta|esta)\s+parado\b/i.test(norm) ||
    /\bmotivo\s+(?:de\s+estar\s+)?(parado|retido|travado)\b/i.test(norm)
  );
}

export function isVehicleCountQuery(norm: string): boolean {
  return /\b(quantos|quantas|quantidade|total\s+de)\b/i.test(norm);
}

export function isVehicleListQuery(norm: string): boolean {
  return /\b(liste|listar|quais|relacione|relacionar|mostre|mostrar|ver|veja)\b/i.test(norm);
}

export function isStoreSummaryQuery(norm: string, explicitLoja?: string): boolean {
  const isSpecificDomainQuery = norm.includes('cmv') || norm.includes('custo') || norm.includes('meta') || 
    norm.includes('fatur') || norm.includes('receber') || norm.includes('area') || norm.includes('setor') || 
    norm.includes('midia') || norm.includes('cliente') || norm.includes('checklist') || norm.includes('chklist') || 
    norm.includes('patio') || norm.includes('parado') || norm.includes('travado');
  
  const hasSummaryTerm = 
    norm.includes('como esta') || norm.includes('como ta') ||
    norm.includes('situacao') || norm.includes('raio') ||
    norm.includes('resumo') || norm.includes('status') ||
    norm.includes('visao geral') || norm.includes('panorama');

  return Boolean(explicitLoja) && !isSpecificDomainQuery && hasSummaryTerm;
}

/**
 * Cria ou preserva o TurnPendingRequest garantindo rastreabilidade entre turnos.
 */
export function createOrPreservePendingRequest(params: {
  userPrompt: string;
  operation: OperationType;
  targetModel?: string;
  targetPlate?: string;
  targetOsId?: string;
  targetLojaSlug?: string;
  deliveryStatus?: 'DELIVERED' | 'FAILED_TECHNICAL' | 'MISUNDERSTOOD' | 'PENDING_CHOICE';
  previousPendingRequest?: TurnPendingRequest;
}): TurnPendingRequest {
  const prev = params.previousPendingRequest;
  const genId = (prev?.generationId || 0) + 1;

  const targetModel = params.targetModel || prev?.targetModel;
  const targetPlate = params.targetPlate || prev?.targetPlate;
  const targetOsId = params.targetOsId || prev?.targetOsId;
  const targetLojaSlug = params.targetLojaSlug || prev?.targetLojaSlug;

  return {
    originalUserPrompt: params.userPrompt,
    operation: params.operation,
    targetModel,
    targetPlate,
    targetOsId,
    targetLojaSlug,
    generationId: genId,
    requestedAt: new Date().toISOString(),
    deliveryStatus: params.deliveryStatus || 'DELIVERED'
  };
}
