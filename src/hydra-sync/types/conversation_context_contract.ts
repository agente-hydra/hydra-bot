/**
 * src/hydra-sync/types/conversation_context_contract.ts
 * Contratos estritos para resolucao de veiculos, reparacao de turno e historico de caso.
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
 * Candidato a veiculo fisico identificado no ERP.
 */
export interface CandidateVehicle {
  readonly plate: string;
  readonly model: string;
  readonly clientName?: string;
  readonly storeSlug: string;
  readonly lastActiveOsId: string;
}

/**
 * Candidato a atendimento (Ordem de Servico) do veiculo.
 */
export interface CandidateOrder {
  readonly osId: string;
  readonly storeSlug: string;
  readonly plate: string;
  readonly vehicleModel: string;
  readonly clientName?: string;
  readonly statusGrid: string;
  readonly isOpen: boolean;
  readonly daysInYard: number;
  readonly totalAmount: number;
  readonly remainingBalance: number;
  readonly openedAt?: string;
}

/**
 * Resultado discriminado da resolucao do alvo na oficina.
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
 * Fatos consolidados da situacao e historico de atendimento.
 */
export interface CaseContextResult {
  readonly order: CandidateOrder;
  readonly coverage: AnalysisCoverageStatus;
  readonly documentedDelayReason?: string;
  readonly nextPromisedStep?: string;
  readonly lastObservationDate?: string;
  readonly evidenceOrigin: 'GRAPH_PROJECTION' | 'CANONICAL_ANALYSIS' | 'ERP_DIRECT';
  readonly isLimitationDeclared: boolean;
}

/**
 * Extensao do TurnState para manter rastreabilidade de reparacao.
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
