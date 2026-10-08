/**
 * src/hydra-sync/types/conversation_context_contract.ts
 * Contratos estritos unificados para resolução de veículos, reparação de turno,
 * contexto de conversas e grafo histórico de atendimentos (Versões 2.0 e 2.1).
 */

export type OperationType =
  | 'VEHICLE_SITUATION'
  | 'DELAY_REASON'
  | 'VEHICLE_COUNT'
  | 'VEHICLE_LIST'
  | 'STORE_SUMMARY'
  | 'CONVERSATION_REPAIR'
  | 'CONVERSATION_HISTORY'
  | 'RUNTIME_DIAGNOSTICS'
  | 'delay_reason'
  | 'vehicle_count'
  | 'vehicle_list'
  | 'vehicle_situation'
  | 'conversation_correction';

export type ResolutionStatus =
  | 'RESOLVED'
  | 'AMBIGUOUS_VEHICLE'
  | 'AMBIGUOUS_ORDER'
  | 'NO_MATCH'
  | 'UNAVAILABLE';

export type AnalysisCoverageStatus =
  | 'FULL'
  | 'PARTIAL_ERP_ONLY'
  | 'NOT_IN_ANALYSIS'
  | 'STALE';

/**
 * Registro de pedido operacional pendente no contexto de turno.
 */
export interface TurnPendingRequest {
  readonly originalUserPrompt: string;
  readonly operation: OperationType;
  readonly targetModel?: string;
  readonly targetPlate?: string;
  readonly targetOsId?: string;
  readonly targetLojaSlug?: string;
  readonly generationId: number;
  readonly requestedAt: string;
  readonly deliveryStatus: 'DELIVERED' | 'FAILED_TECHNICAL' | 'MISUNDERSTOOD' | 'PENDING_CHOICE';
}

/**
 * Candidato a veículo físico identificado no ERP.
 */
export interface CandidateVehicle {
  readonly plate: string;
  readonly vehiclePlate?: string;
  readonly model: string;
  readonly vehicleModel?: string;
  readonly clientName?: string;
  readonly customerName?: string;
  readonly storeSlug: string;
  readonly lojaSlug?: string;
  readonly lastActiveOsId?: string | number;
  readonly activeOrdersCount?: number;
}

/**
 * Candidato a atendimento (Ordem de Serviço) do veículo.
 */
export interface CandidateOrder {
  readonly osId: string | number;
  readonly storeSlug?: string;
  readonly lojaSlug?: string;
  readonly plate?: string;
  readonly vehiclePlate?: string;
  readonly vehicleModel?: string;
  readonly model?: string;
  readonly clientName?: string;
  readonly customerName?: string;
  readonly customerPhone?: string;
  readonly statusGrid?: string;
  readonly status?: string;
  readonly isOpen?: boolean;
  readonly isAberta?: boolean;
  readonly daysInYard?: number;
  readonly totalAmount?: number;
  readonly totalValue?: number;
  readonly paidValue?: number;
  readonly remainingBalance?: number;
  readonly pendingServices?: readonly string[];
  readonly openedAt?: string;
  readonly updatedAt?: string;
}

/**
 * Resultado discriminado da resolução do alvo na oficina.
 */
export type VehicleResolutionResult =
  | {
      readonly status: 'RESOLVED';
      readonly vehicle: CandidateVehicle;
      readonly activeOrder: CandidateOrder;
    }
  | {
      readonly status: 'AMBIGUOUS_VEHICLE';
      readonly candidates: readonly CandidateVehicle[];
      readonly clarificationPrompt: string;
    }
  | {
      readonly status: 'AMBIGUOUS_ORDER';
      readonly vehicle: CandidateVehicle;
      readonly candidateOrders: readonly CandidateOrder[];
      readonly clarificationPrompt: string;
    }
  | {
      readonly status: 'NO_MATCH';
      readonly searchedModel?: string;
      readonly searchedPlate?: string;
      readonly searchedStoreSlug?: string;
      readonly reason: string;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly technicalError: string;
    };

/**
 * Interfaces de Repositórios Reais (Desacoplamento de Fixtures - F01)
 */
export interface IOperationalDataRepository {
  getOSById(osId: number, lojaSlug?: string): Promise<OperationalOSRecord | null>;
  listActiveOSsByPhone(phone: string, lojaSlug?: string): Promise<readonly OperationalOSRecord[]>;
}

export interface IAnalysisRepository {
  getAnalysisByConversation(conversationId: number, lojaSlug: string): Promise<ConversationAnalysisRecord | null>;
  getAnalysisByOS(osId: number, lojaSlug: string): Promise<ConversationAnalysisRecord | null>;
  listAnalysesByStore(lojaSlug: string): Promise<readonly ConversationAnalysisRecord[]>;
}

export interface OperationalOSRecord {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly vehiclePlate: string;
  readonly vehicleModel: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly status: string;
  readonly totalValue: number;
  readonly paidValue: number;
  readonly pendingServices: readonly string[];
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly clienteCpf?: string;
  readonly observacao?: string;
  readonly historicoCriadoEm?: string;
  readonly historicoCriadoPor?: string;
  readonly historicoAtualizadoEm?: string;
  readonly historicoAtualizadoPor?: string;
}

export type LinkMethod = 
  | 'STRUCTURAL_FIELD'               // Vínculo formal explícito no Chatwoot/ERP
  | 'CONTEXTUAL_MULTI_IDENTIFIER'   // Coincidência OS + Placa + Período + Loja
  | 'OPERATOR_MANUAL';              // Confirmação manual registrada

export type LinkConfidence = 
  | 'STRUCTURAL_CERTAIN'            // 100% de certeza estrutural
  | 'CONTEXTUAL_HIGH'               // Múltiplos identificadores conferidos
  | 'AMBIGUOUS'                     // Mais de 1 veículo/OS para o mesmo contato
  | 'UNVERIFIED';                   // Apenas indício textual sem comprovação

export type LinkStatus = 'ACTIVE' | 'INVALIDATED' | 'DISPUTED';

export interface OSConversationLink {
  readonly linkId: string;
  readonly osId: number;
  readonly lojaSlug: string;
  readonly conversationId: number;
  readonly inboxId: number;
  readonly linkMethod: LinkMethod;
  readonly confidence: LinkConfidence;
  readonly evidence: {
    readonly vehiclePlate?: string;
    readonly osNumberText?: string;
    readonly periodMatch: boolean;
    readonly matchedAt: string;
  };
  readonly status: LinkStatus;
}

export type StatementSubject = 
  | 'CLIENT_PROMISE'         // Promessa ou solicitação do cliente
  | 'CLIENT_APPROVAL'        // Aprovação expressa de orçamento/serviço
  | 'CLIENT_REFUSAL'         // Recusa explícita de orçamento/serviço (F05)
  | 'ATTENDANT_COMMITMENT'   // Prazo ou entrega acordada pelo atendente
  | 'PAYMENT_CLAIM'          // Alegação de pagamento feita pelo cliente
  | 'PAYMENT_REFUSAL'        // Declaração de não pagamento ("Ainda não fiz o Pix")
  | 'DOCUMENT_SUBMISSION'    // Envio de comprovante ou documento
  | 'WATCHDOG_FLAG'          // Alerta ou infração de atendimento do Watchdog
  | 'DELAY_CAUSE'            // Causa de atraso
  | 'DELAY_CAUSE_REPORTED'   // Relato de motivo de atraso
  | 'PART_DEPENDENCY'        // Dependência de peças
  | 'PART_ARRIVAL';          // Chegada de peças

export type StatementPolarity = 'AFFIRMATIVE' | 'NEGATIVE' | 'CONDITIONAL';

export type AuthorRole = 'CLIENT' | 'ATTENDANT' | 'SYSTEM' | 'UNKNOWN';

export type ConfirmationLevel = 
  | 'EXPLICIT_CONFIRMED'     // Texto inequívoco com versão e itens
  | 'CONFIRMED'              // Confirmação verificada
  | 'AMBIGUOUS_GENERIC'      // Ex: "Ok" solto sem referência de orçamento
  | 'CLAIM_UNCONFIRMED'      // Alegação não verificada no financeiro
  | 'REFUTED_SUPERSEDED';    // Mensagem posterior alterou a afirmação

export interface ExtractedStatement {
  readonly statementId: string;
  readonly revisionId?: string;
  readonly analysisId?: string;
  readonly factId?: string;
  readonly subject: StatementSubject | string;
  readonly subjectType?: string;
  readonly predicate?: string;
  readonly polarity: StatementPolarity | string;
  readonly authorRole: AuthorRole | string;
  readonly authorName: string;
  readonly messageId?: number;
  readonly timestamp?: string;
  readonly eventTimestamp?: string;
  readonly rawExcerpt: string;
  readonly targetOsId?: number;
  readonly serviceScope?: string;
  readonly budgetVersion?: string;
  readonly monetaryValue?: number;
  readonly monetaryCents?: number;
  readonly confidence?: number;
  readonly confirmation?: ConfirmationLevel | string;
  readonly confirmationLevel?: ConfirmationLevel | string;
  readonly delayCauseReported?: string;
  readonly partName?: string;
  readonly partCode?: string;
  readonly partQuantityRequested?: number;
  readonly partQuantityArrived?: number;
  readonly partReference?: { readonly partName: string; readonly partCode?: string; readonly quantity?: number };
  readonly orderRef?: string;
  readonly supersedesFactId?: string;
}

export type GapType = 
  | 'UNTRANSCRIBED_AUDIO'    // Áudio sem transcrição válida
  | 'UNREAD_MEDIA'           // Imagem/PDF não processado
  | 'DELETED_MESSAGE'        // Mensagem apagada no WhatsApp
  | 'TRUNCATED_HISTORY'      // Limite de paginação atingido (F06)
  | 'NOT_IN_ANALYSIS';       // Dado não contemplado na análise existente

export interface ConversationGap {
  readonly gapId: string;
  readonly revisionId?: string;
  readonly analysisId?: string;
  readonly messageId?: number;
  readonly conversationId: number;
  readonly gapType: GapType | string;
  readonly timestamp?: string;
  readonly eventTimestamp?: string;
  readonly description: string;
}

export type AnalysisSourceType = 
  | 'OPERATIONAL_SYNTHESIS'   // Resumo de atendimento com cobertura
  | 'WATCHDOG_EVAL'          // Análise de infração do Watchdog com campos operacionais
  | 'DAILY_DISPATCH'         // Síntese de fechamento do dia
  | 'CHATWOOT_REPRESENTATIVE';

export type SummarySourceType = AnalysisSourceType;

export interface ConversationAnalysisRecord {
  readonly analysisId: string;
  readonly summaryId?: string;
  readonly revisionId?: string;
  readonly sourceId?: string;
  readonly accountId?: string;
  readonly conversationId: number;
  readonly osId?: number;
  readonly lojaSlug: string;
  readonly coveredOsIds?: readonly (number | string)[];
  readonly sourceType: AnalysisSourceType | string;
  readonly analyzedUntilMessageId?: number;
  readonly cursorLastMessageId?: number;
  readonly analyzedUntilTimestamp?: string;
  readonly messagesCoveredUntil?: string;
  readonly occurredAt?: string;
  readonly analyzedAt?: string;
  readonly generatedAt?: string;
  readonly recordedAt?: string;
  readonly analysisRunId?: string;
  readonly schemaVersion?: string;
  readonly analyzerVersion?: string;
  readonly analysisVersion?: string;
  readonly customerPhone?: string;
  readonly customerName?: string;
  readonly vehicleModel?: string;
  readonly vehiclePlate?: string;
  readonly status?: string;
  readonly executiveSummary?: string;
  readonly operationalSummary?: string;
  readonly conductAlert?: string;
  readonly confidence?: number;
  readonly originSource?: string;
  readonly isFullyCovered?: boolean;
  readonly laggingMessageCount?: number;
  readonly statements?: readonly ExtractedStatement[];
  readonly extractedStatements?: readonly ExtractedStatement[];
  readonly gaps?: readonly ConversationGap[];
  readonly isValid?: boolean;
}

export type ConversationSummaryRecord = ConversationAnalysisRecord;

export interface SanitizedMessage {
  readonly messageId: number;
  readonly conversationId: number;
  readonly senderType: 'user' | 'contact' | 'agent' | 'bot' | string;
  readonly senderName: string;
  readonly textContent: string;
  readonly isPrivate: boolean;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly isDeleted?: boolean;
  readonly hasAttachments: boolean;
  readonly attachmentType?: 'image' | 'audio' | 'document' | 'other' | string;
  readonly isTranscribed?: boolean;
  readonly transcribedText?: string;
}

export type DiscrepancyType = 
  | 'STATUS_LAG'          // Conversa aprovou, ERP ainda aguarda
  | 'PAYMENT_PENDING'     // Cliente alegou pagamento, sem baixa no banco
  | 'BUDGET_MISMATCH'     // Valor acordado diverge do cadastro
  | 'DEADLINE_PROMISED';  // Atendente prometeu prazo menor que da OS

export interface DiscrepancyRecord {
  readonly discrepancyType: DiscrepancyType;
  readonly description: string;
  readonly erpPosition: string;
  readonly erpTimestamp: string;
  readonly conversationPosition: string;
  readonly conversationTimestamp: string;
}

export interface OSInspectionInput {
  readonly osId: number;
  readonly lojaSlug?: string;
  readonly userPersona: 'gerente' | 'socio' | 'admin' | 'atendente' | string;
  readonly requestedByLojaSlug?: string;
  readonly isComplementaryRequested?: boolean;
  readonly forceFresh?: boolean;
}

export interface VehicleInspectionInput {
  readonly vehicleModel?: string;
  readonly vehiclePlate?: string;
  readonly osId?: number;
  readonly requestedByLojaSlug?: string;
  readonly securityScope: SecurityContext;
  readonly isComplementaryRequested?: boolean;
  readonly forceFresh?: boolean;
}

export interface CacheContextKey {
  readonly lojaSlug: string;
  readonly osId: number;
  readonly userPersona: 'gerente' | 'socio' | 'admin' | 'atendente' | string;
  readonly analysisVersion: string;
  readonly erpUpdatedAt: string;
  readonly vehiclePlate?: string;
  readonly memoryGenerationId?: number;
}

export interface CombinedOSSituationReport {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly vehiclePlate: string;
  readonly vehicleModel: string;
  readonly timestampReport: string;
  readonly erpState: {
    readonly status: string;
    readonly totalValue: number;
    readonly paidValue: number;
    readonly pendingServices: readonly string[];
    readonly updatedAt: string;
  };
  readonly analysisState?: {
    readonly analysisId: string;
    readonly analysisVersion: string;
    readonly analyzedUntilTimestamp: string;
    readonly statements: readonly ExtractedStatement[];
    readonly gaps: readonly ConversationGap[];
  };
  readonly conversationState?: {
    readonly conversationId: number;
    readonly lastMessageAt: string;
    readonly statements: readonly ExtractedStatement[];
    readonly gaps: readonly ConversationGap[];
    readonly isStale: boolean;
    readonly newMessagesInspectedCount: number;
  };
  readonly linkInfo?: OSConversationLink | null;
  readonly ambiguityCandidates?: readonly {
    readonly osId: number;
    readonly vehiclePlate: string;
    readonly description: string;
  }[];
  readonly discrepancies: readonly DiscrepancyRecord[];
  readonly pendingActions: readonly string[];
  readonly limitations: readonly string[];
  readonly formattedWhatsAppBalloon: string;
  readonly cachedResponse: boolean;
  readonly approvalAttributed?: boolean;
  readonly otherStorePlateExposed?: boolean;
  readonly otherStoreOsExposed?: boolean;
  readonly lastMessageRepresented?: boolean;
}

export interface PartItemReference {
  readonly partName: string;
  readonly partCode?: string;
  readonly quantityRequested?: number;
  readonly quantityArrived?: number;
  readonly orderRef?: string;
}

export interface SecurityContext {
  readonly persona: 'socio' | 'gerente' | 'atendente' | 'admin' | string;
  readonly authorizedLojaSlug?: string;
  readonly authorizedStore?: string;
  readonly authorizedPhones?: readonly string[];
}

export class PhysicalDatabaseUnavailableError extends Error {
  constructor(message: string = 'Base física de persistência não configurada (F01).') {
    super(message);
    this.name = 'PhysicalDatabaseUnavailableError';
  }
}

export class SecurityAccessDeniedError extends Error {
  constructor(message: string = 'Acesso não autorizado para o escopo solicitado.') {
    super(message);
    this.name = 'SecurityAccessDeniedError';
  }
}

export interface BusinessCaseScope {
  readonly sourceId: string;
  readonly accountId?: string;
  readonly lojaSlug: string;
  readonly osId?: number;
  readonly vehiclePlate?: string;
  readonly vehicleModel?: string;
  readonly customerPhone?: string;
}

export interface AnalysisRevisionIdentity {
  readonly sourceId: string;
  readonly accountId: string;
  readonly conversationId: string | number;
  readonly analysisRunId: string;
  readonly revisionId?: string;
  readonly schemaVersion?: string;
  readonly analyzerVersion?: string;
}

export interface AnalysisMemoryWriter {
  recordCompletedAnalysis(
    analysis: ConversationAnalysisRecord,
    identity: AnalysisRevisionIdentity
  ): Promise<{ readonly revisionId: string; readonly projectionQueued: boolean }>;
}

export interface CaseCurrentPosition {
  readonly sourceId?: string;
  readonly accountId?: string;
  readonly lojaSlug: string;
  readonly osId: number | string;
  readonly vehiclePlate?: string;
  readonly vehicleModel?: string;
  readonly customerPhone?: string;
  readonly customerName?: string;
  readonly currentErpStatus?: string;
  readonly erpSnapshotTimestamp?: string;
  readonly currentApprovalStatus?: string;
  readonly approvedBudgetVersion?: string;
  readonly pendingBudgetVersion?: string;
  readonly reportedDelay?: {
    readonly cause: string;
    readonly author?: string;
    readonly role?: string;
    readonly reportedAt?: string;
    readonly rawExcerpt?: string;
  };
  readonly activePartDependencies?: readonly any[];
  readonly commitmentsSummary?: string;
  readonly activeGaps?: readonly any[];
  readonly lastCoveredTimestamp?: string;
  readonly projectionVersion?: number;
  readonly updatedAt?: string;
}

/**
 * Fatos consolidados da situação e histórico de atendimento.
 */
export interface CaseContextResult {
  readonly status?: 'AVAILABLE' | 'READY' | 'PARTIAL' | 'NO_ANALYSIS' | 'AMBIGUOUS_LINK' | 'OUTDATED' | 'SOURCE_UNAVAILABLE' | string;
  readonly scope?: BusinessCaseScope;
  readonly currentPosition?: CaseCurrentPosition | any;
  readonly timeline?: readonly any[];
  readonly appliedRevision?: string;
  readonly coverage?: AnalysisCoverageStatus | any;
  readonly limitations?: readonly string[];
  readonly candidates?: readonly any[];
  readonly reason?: string;
  readonly laggingMessageCount?: number;
  readonly order?: CandidateOrder;
  readonly documentedDelayReason?: string;
  readonly nextPromisedStep?: string;
  readonly lastObservationDate?: string;
  readonly conversationSummary?: string;
  readonly partsBalanceSummary?: string;
  readonly budgetStatus?: string;
  readonly evidenceOrigin?: 'GRAPH_PROJECTION' | 'CANONICAL_ANALYSIS' | 'ERP_DIRECT';
  readonly isLimitationDeclared?: boolean;
}

export interface CaseMemoryReader {
  getCaseContext(
    target: BusinessCaseScope,
    authorization: SecurityContext,
    request: {
      readonly questionType: 'SITUATION' | 'DELAY_REASON' | 'COMMITMENTS' | 'TIMELINE';
      readonly cursor?: string;
      readonly limit?: number;
    }
  ): Promise<CaseContextResult>;
}

/**
 * Extensão do TurnState para manter rastreabilidade de reparação.
 */
export interface ExtendedTurnState {
  readonly phone: string;
  readonly lastTurnId: string;
  readonly lastIntent: string;
  readonly lojaSlug?: string;
  readonly vehicleModel?: string;
  readonly placa?: string;
  readonly osId?: string;
  readonly activeCursor?: string;
  readonly filters?: any;
  readonly lastContract?: any;
  readonly lastMessageId?: any;
  readonly lastResponseText?: string;
  readonly pendingRequest?: TurnPendingRequest;
  readonly memoryGeneration?: number;
  readonly updatedAt: string;
}
