/**
 * src/hydra-sync/types/language_contract.ts
 * Contratos tipados estritos para Linguagem, WhatsApp Nativo e Decisão Semântica.
 */

export type SemanticTone = 'executive_direct' | 'conversational_light' | 'clarification' | 'correction_ack';

export type RequiredComponentType = 
  | 'REVENUE_DAY'
  | 'REVENUE_MONTH'
  | 'METAS_SUMMARY'
  | 'STORE_CMV'
  | 'OS_LIST'
  | 'OS_DETAIL'
  | 'YARD_AGING'
  | 'RUNTIME_DIAGNOSTICS'
  | 'CONVERSATION_HISTORY'
  | 'MEMORY_PREFERENCE';

export interface ComponentExecutionStatus {
  component: RequiredComponentType;
  status: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE' | 'DENIED_SCOPE';
  sourceTable?: string;
  itemCount?: number;
  unavailabilityReason?: string;
}

export interface CompactSemanticDecision {
  turnId: string;
  canonicalIntent: string;
  primaryIntent?: string;
  topic: string;
  effectivePersona: 'socio' | 'gerente';
  allowedLojaSlug: string | null;
  lojaSlug?: string | null;
  entityType?: 'store' | 'order' | 'none';
  period: 'hoje' | 'ontem' | 'mes_atual' | 'mes_passado' | 'ultimos_30_dias' | 'custom';
  periodDates?: { startDate: string; endDate: string };
  selectedEntityId?: string;
  requestedComponents: RequiredComponentType[];
  componentStatuses: ComponentExecutionStatus[];
  isCompoundQuery: boolean;
  hasAmbiguity: boolean;
  clarificationPrompt?: string;
}

export interface PublicFormattingPolicy {
  allowEmojis: boolean;
  maxCriticalAlertEmojis: number;
  enforceBlockQuotes: boolean;
  enforceKeyValueLists: boolean;
  enforceItalicFooter: boolean;
  convertMarkdownTables: boolean;
  forbidDoubleAsterisks: boolean;
  forbidCommonMarkHeaders: boolean;
  forbidExcessiveInformality: boolean;
}

export interface TableParsedCell {
  header: string;
  value: string;
}

export interface TableParsedRow {
  rowIndex: number;
  cells: TableParsedCell[];
}

export interface TableToBlockResult {
  hasTable: boolean;
  originalTableText: string;
  convertedBlocksText: string;
  rowsProcessed: number;
  dataPreserved: boolean;
}

export interface BalloonBlockUnit {
  index: number;
  subjectTitle?: string;
  content: string;
  charCount: number;
  isTerminal: boolean;
  hasCriticalAlert: boolean;
}

export interface ComposedBalloonsResult {
  balloons: string[];
  totalChars: number;
  balloonCount: number;
  emojisCount: number;
  isStructuredCard: boolean;
  sanitized: boolean;
}
