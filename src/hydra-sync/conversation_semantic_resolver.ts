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

export interface CandidateLinkInput {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly vehiclePlate: string;
  readonly customerPhone: string;
  readonly customerName: string;
  readonly openedAt: string;
}

export interface ConversationCandidateInput {
  readonly conversationId: number;
  readonly inboxId: number;
  readonly lojaSlug: string;
  readonly contactPhone: string;
  readonly contactName: string;
  readonly customAttributes?: Record<string, string>;
  readonly messagesSample: readonly any[];
}

export class ConversationSemanticResolver {
  public extractVehicleModel(text: string): string | undefined {
    const norm = (text || '').toLowerCase();
    const modelMatch = norm.match(/\b(linea|palio|uno|gol|civic|corolla|onix|hb20|compass|renegade|strada|toro|argo|mobi|tucson|tracker|kicks|creta|kwid|virtus|polo|cronos|fiesta)\b/i);
    return modelMatch ? modelMatch[1].toLowerCase() : undefined;
  }

  public resolveIntent(rawQuery: string): {
    readonly isOSSituationQuery: boolean;
    readonly isAggregatorQuery: boolean;
    readonly targetOSId?: number;
    readonly vehicleModel?: string;
    readonly requestedLojaSlug?: string;
    readonly specificQuestionType?: string;
    readonly operationType: OperationType | 'COUNT_VEHICLES' | 'LIST_VEHICLES' | 'STORE_SUMMARY' | 'VEHICLE_SITUATION';
    readonly isConversationalCorrection?: boolean;
    readonly isRawHistoryRequested?: boolean;
  } {
    const text = (rawQuery || '').trim().toLowerCase();
    const isConversationalCorrection = isCorrectionMessage(text) || text.includes('nao foi isso') || text.includes('nn foi isso') || text.includes('nao era isso');
    const isRawHistoryRequested = Boolean(
      text.includes('leia') ||
      text.includes('ler') ||
      text.includes('ultimas mensagens') ||
      text.includes('últimas mensagens') ||
      text.includes('historico') ||
      text.includes('histórico')
    );

    // Capacidades do assistente (H16)
    if (
      (text.includes('consulta') || text.includes('le') || text.includes('acessa') || text.includes('ve')) &&
      (text.includes('whatsapp') || text.includes('conversa'))
    ) {
      return {
        isOSSituationQuery: false,
        isAggregatorQuery: false,
        specificQuestionType: 'CAPABILITIES_EXPLANATION',
        operationType: 'RUNTIME_DIAGNOSTICS',
        isConversationalCorrection,
        isRawHistoryRequested
      };
    }

    // Detecção de pergunta agregadora
    if (
      text.includes('quais os') ||
      text.includes('quais ordens') ||
      text.includes('aguardando retorno') ||
      text.includes('aguardando cliente')
    ) {
      return {
        isOSSituationQuery: true,
        isAggregatorQuery: true,
        specificQuestionType: 'WAITING_CLIENT_LIST',
        operationType: 'STORE_SUMMARY',
        isConversationalCorrection,
        isRawHistoryRequested
      };
    }

    // Extração do número da OS
    const osMatch = text.match(/(?:os|ordem(?:\s+de\s+servi[çc]o)?)\s*(?:n[ºo°]?\s*)?#?(\d+)/i) 
      || text.match(/\b#?(\d{3,6})\b/);
    const targetOSId = osMatch ? parseInt(osMatch[1], 10) : undefined;

    // Extração de modelo de veículo conhecido (catálogo aberto e variantes)
    let vehicleModel: string | undefined = undefined;
    const modelMatch = text.match(/\b(linea|palio|uno|gol|civic|corolla|onix|hb20|compass|renegade|strada|toro|argo|mobi|tucson|tracker|kicks|creta|kwid|virtus|polo|cronos|fiesta)\b/i);
    if (modelMatch) {
      vehicleModel = modelMatch[1].toLowerCase();
    }

    // Extração de loja
    let requestedLojaSlug: string | undefined = undefined;
    const storeMatch = text.match(/\b(jabaquara|dompedro|dom\s*pedro|maua|santana|santoandre|santo\s*andre|saobernardo|sao\s*bernardo|sbc|sorocaba|campinas|osmar|diadema)\b/i);
    if (storeMatch) {
      const s = storeMatch[1].toLowerCase().replace(/\s+/g, '');
      requestedLojaSlug = s === 'dompedro' ? 'dompedro' : (s === 'sbc' ? 'saobernardo' : s);
    }

    let specificQuestionType = 'GENERAL_SITUATION';
    if (
      text.includes('por que') || text.includes('pq') || text.includes('qq ta acontecendo') ||
      text.includes('o que ta acontecendo') || text.includes('motivo') || text.includes('parado') ||
      text.includes('atrasado') || text.includes('retido')
    ) {
      specificQuestionType = 'DELAY_REASON';
    } else if (text.includes('aprovou') || text.includes('aprovação') || text.includes('autorizou')) {
      specificQuestionType = 'APPROVAL_STATUS';
    } else if (text.includes('combinamos') || text.includes('prometido') || text.includes('acordado')) {
      specificQuestionType = 'COMMITMENTS_MADE';
    } else if (text.includes('último posicionamento') || text.includes('última resposta') || text.includes('última mensagem')) {
      specificQuestionType = 'LATEST_POSITION';
    }

    let operationType: any = 'VEHICLE_SITUATION';
    if (isVehicleCountQuery(text)) {
      operationType = 'COUNT_VEHICLES';
    } else if (isVehicleListQuery(text)) {
      operationType = 'LIST_VEHICLES';
    } else if (
      isStoreSummaryQuery(text, requestedLojaSlug) ||
      (!vehicleModel && !targetOSId && requestedLojaSlug && (text.includes('como tá') || text.includes('como esta') || text.includes('hoje') || text.includes('resumo')))
    ) {
      operationType = 'STORE_SUMMARY';
    } else {
      operationType = 'VEHICLE_SITUATION';
    }

    const isAgg = operationType === 'COUNT_VEHICLES' || operationType === 'LIST_VEHICLES' || operationType === 'STORE_SUMMARY';

    return {
      isOSSituationQuery: (targetOSId !== undefined || Boolean(vehicleModel) || text.includes('situação da os') || specificQuestionType === 'DELAY_REASON') && !isAgg,
      isAggregatorQuery: isAgg,
      targetOSId,
      vehicleModel,
      requestedLojaSlug,
      specificQuestionType,
      operationType,
      isConversationalCorrection,
      isRawHistoryRequested
    };
  }

  public evaluateLink(
    os: CandidateLinkInput,
    conversation: ConversationCandidateInput,
    otherActiveOSsForContact: readonly CandidateLinkInput[] = []
  ): { link?: any; isAmbiguous: boolean; ambiguityDetails?: string } {
    if (conversation.lojaSlug !== os.lojaSlug) {
      return { isAmbiguous: false };
    }

    if (conversation.customAttributes && conversation.customAttributes['os_id'] === String(os.osId)) {
      const link = {
        linkId: `link_struct_${os.osId}_${conversation.conversationId}`,
        osId: os.osId,
        lojaSlug: os.lojaSlug,
        conversationId: conversation.conversationId,
        inboxId: conversation.inboxId,
        linkMethod: 'STRUCTURAL_FIELD',
        confidence: 'STRUCTURAL_CERTAIN',
        evidence: {
          osNumberText: String(os.osId),
          periodMatch: true,
          matchedAt: new Date().toISOString()
        },
        status: 'ACTIVE'
      };
      return { link, isAmbiguous: false };
    }

    const normalizedContactPhone = conversation.contactPhone.replace(/\D/g, '');
    const normalizedOSPhone = os.customerPhone.replace(/\D/g, '');
    const phoneMatches = normalizedContactPhone.endsWith(normalizedOSPhone) || normalizedOSPhone.endsWith(normalizedContactPhone);

    const conflictingOSs = otherActiveOSsForContact.filter(
      other => other.osId !== os.osId && other.customerPhone.replace(/\D/g, '') === normalizedOSPhone
    );

    const normalizedPlate = os.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    let plateFoundInMessages = false;
    let osNumberFoundInMessages = false;

    for (const msg of conversation.messagesSample) {
      const cleanText = (msg.textContent || '').toUpperCase();
      if (cleanText.includes(normalizedPlate)) {
        plateFoundInMessages = true;
      }
      if (cleanText.includes(String(os.osId))) {
        osNumberFoundInMessages = true;
      }
    }

    if (plateFoundInMessages && osNumberFoundInMessages) {
      const link = {
        linkId: `link_ctx_${os.osId}_${conversation.conversationId}`,
        osId: os.osId,
        lojaSlug: os.lojaSlug,
        conversationId: conversation.conversationId,
        inboxId: conversation.inboxId,
        linkMethod: 'CONTEXTUAL_MULTI_IDENTIFIER',
        confidence: 'CONTEXTUAL_HIGH',
        evidence: {
          vehiclePlate: os.vehiclePlate,
          osNumberText: String(os.osId),
          periodMatch: true,
          matchedAt: new Date().toISOString()
        },
        status: 'ACTIVE'
      };
      return { link, isAmbiguous: false };
    }

    if (phoneMatches && conflictingOSs.length > 0) {
      return {
        isAmbiguous: true,
        ambiguityDetails: `O contato ${conversation.contactName} possui múltiplas ordens ativas (${[os.osId, ...conflictingOSs.map(c => c.osId)].join(', ')}). Exige desambiguação.`
      };
    }

    if (phoneMatches && (plateFoundInMessages || osNumberFoundInMessages)) {
      const link = {
        linkId: `link_ctx_partial_${os.osId}_${conversation.conversationId}`,
        osId: os.osId,
        lojaSlug: os.lojaSlug,
        conversationId: conversation.conversationId,
        inboxId: conversation.inboxId,
        linkMethod: 'CONTEXTUAL_MULTI_IDENTIFIER',
        confidence: 'CONTEXTUAL_HIGH',
        evidence: {
          vehiclePlate: plateFoundInMessages ? os.vehiclePlate : undefined,
          osNumberText: osNumberFoundInMessages ? String(os.osId) : undefined,
          periodMatch: true,
          matchedAt: new Date().toISOString()
        },
        status: 'ACTIVE'
      };
      return { link, isAmbiguous: false };
    }

    return { isAmbiguous: false };
  }

  public extractStatement(
    msg: any,
    targetOsId: number,
    previousStatements: readonly any[] = []
  ): any | null {
    const raw = (msg.textContent || '').trim();
    const lower = raw.toLowerCase();
    const isClient = msg.senderType === 'contact' || msg.senderType === 'user';
    const isAttendant = msg.senderType === 'agent';

    if (isClient && (
      lower.includes('ainda não fiz') ||
      lower.includes('ainda nao fiz') ||
      lower.includes('não fiz o pix') ||
      lower.includes('nao fiz o pix') ||
      lower.includes('não fiz o pagamento') ||
      lower.includes('nao fiz o pagamento') ||
      lower.includes('não paguei') ||
      lower.includes('nao paguei') ||
      lower.includes('sem limite')
    )) {
      return {
        statementId: `stmt_payref_${msg.messageId}`,
        subject: 'PAYMENT_REFUSAL',
        polarity: 'NEGATIVE',
        authorRole: 'CLIENT',
        authorName: msg.senderName,
        messageId: msg.messageId,
        timestamp: msg.createdAt,
        rawExcerpt: raw,
        targetOsId,
        confirmation: 'EXPLICIT_CONFIRMED'
      };
    }

    if (isClient && (lower.includes('pix') || lower.includes('paguei') || lower.includes('comprovante') || lower.includes('transferi'))) {
      return {
        statementId: `stmt_pay_${msg.messageId}`,
        subject: lower.includes('comprovante') ? 'DOCUMENT_SUBMISSION' : 'PAYMENT_CLAIM',
        authorRole: 'CLIENT',
        authorName: msg.senderName,
        messageId: msg.messageId,
        timestamp: msg.createdAt,
        rawExcerpt: raw,
        targetOsId,
        confirmation: 'CLAIM_UNCONFIRMED'
      };
    }

    if (isClient && (
      lower.includes('cancela') ||
      lower.includes('não autorizo') ||
      lower.includes('nao autorizo') ||
      lower.includes('não aprovo') ||
      lower.includes('nao aprovo') ||
      lower.includes('recuso') ||
      lower.includes('não faz') ||
      lower.includes('nao faz')
    )) {
      return {
        statementId: `stmt_refusal_${msg.messageId}`,
        subject: 'CLIENT_REFUSAL',
        polarity: 'NEGATIVE',
        authorRole: 'CLIENT',
        authorName: msg.senderName,
        messageId: msg.messageId,
        timestamp: msg.createdAt,
        rawExcerpt: raw,
        targetOsId,
        confirmation: 'EXPLICIT_CONFIRMED'
      };
    }

    if (isClient && (
      lower.includes('pode fazer') || 
      lower.includes('aprovado') || 
      lower.includes('pode trocar') || 
      lower.includes('autorizo') ||
      lower.includes('fecha assim')
    )) {
      return {
        statementId: `stmt_appr_${msg.messageId}`,
        subject: 'CLIENT_APPROVAL',
        polarity: 'AFFIRMATIVE',
        authorRole: 'CLIENT',
        authorName: msg.senderName,
        messageId: msg.messageId,
        timestamp: msg.createdAt,
        rawExcerpt: raw,
        targetOsId,
        confirmation: 'EXPLICIT_CONFIRMED'
      };
    }

    if (isClient && (lower === 'ok' || lower === 'ok!' || lower === 'combinado' || lower === 'blz' || lower === 'beleza')) {
      return {
        statementId: `stmt_appr_amb_${msg.messageId}`,
        subject: 'CLIENT_APPROVAL',
        authorRole: 'CLIENT',
        authorName: msg.senderName,
        messageId: msg.messageId,
        timestamp: msg.createdAt,
        rawExcerpt: raw,
        targetOsId,
        confirmation: 'AMBIGUOUS_GENERIC'
      };
    }

    if (isAttendant && (lower.includes('fica pronto') || lower.includes('entregamos') || lower.includes('estamos montando') || lower.includes('previsão'))) {
      return {
        statementId: `stmt_att_${msg.messageId}`,
        subject: 'ATTENDANT_COMMITMENT',
        authorRole: 'ATTENDANT',
        authorName: msg.senderName,
        messageId: msg.messageId,
        timestamp: msg.createdAt,
        rawExcerpt: raw,
        targetOsId,
        confirmation: 'EXPLICIT_CONFIRMED'
      };
    }

    return null;
  }
}

