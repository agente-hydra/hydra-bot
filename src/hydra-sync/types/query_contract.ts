/**
 * src/hydra-sync/types/query_contract.ts
 * Contratos tipados compartilhados para o Manual de Consultas, Ciclo de Vida de OS,
 * Resposta Multidimensional e Decomposição de Planos de Consulta do Hydra.
 */

export type OrderOperationalState = 
  | 'ABERTA' 
  | 'ENCERRADA' 
  | 'CANCELADA' 
  | 'TRANSICAO_PENDENTE' 
  | 'DESCONHECIDO';

export type OrderDataQuality = 
  | 'VALIDADO' 
  | 'SUSPEITO_QUARENTENA' 
  | 'CONFLITO' 
  | 'EM_AUDITORIA';

export interface OrderRecord {
  osId: string;
  lojaSlug: string;
  tipo: string;
  statusGrid: string;
  isAberta: boolean;
  estadoOperacional: OrderOperationalState;
  qualidadeDado: OrderDataQuality;
  dataInicioRaw?: string;
  dataInicioIso?: string;
  dataFimRaw?: string;
  dataFimIso?: string;
  dataEventoIso?: string;
  dataObservacaoIso: string;
  diasNoPatio: number;
  veiculo?: string;
  placa?: string;
  clienteNome?: string;
  responsavel?: string;
  totalOs: number;
  valorPago: number;
  valorRestante: number;
  temNf: boolean;
  origemTransicao: string;
}

export interface MetricDefinition {
  metricId: string;
  name: string;
  authoritySource: string;
  scopeType: 'loja' | 'rede';
  formulaDescription: string;
  unit: 'BRL' | 'PERCENT' | 'COUNT';
  nullHandling: 'ZERO' | 'NOT_APPLICABLE' | 'UNKNOWN';
}

export interface GapRecord {
  gapKey: string;
  category: 'UNSUPPORTED_FIELD' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';
  sanitizedExample: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  status: 'NEW' | 'UNDER_REVIEW' | 'PLANNED' | 'WONT_FIX';
}

export interface QueryComponent {
  componentId: string;
  capabilityId: string;
  priority: number;
  params: Record<string, any>;
  status: 'PENDING' | 'SUCCESS' | 'PARTIAL' | 'TIMEOUT' | 'UNSUPPORTED' | 'DENIED';
  result?: any;
  errorMessage?: string;
}

export interface QueryPlan {
  planId: string;
  turnId: string;
  phone: string;
  effectivePersona: 'socio' | 'gerente';
  activeLojaSlug: string | null;
  components: QueryComponent[];
}

export interface MultidimensionalResponse {
  execution: 'SUCCESS' | 'PARTIAL' | 'TIMEOUT' | 'CANCELLED';
  access: 'AUTHORIZED' | 'DENIED' | 'DOWNGRADED';
  support: 'FULL' | 'LIMITED' | 'UNSUPPORTED';
  coverage: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  quality: 'RECONCILED' | 'CONFLICT' | 'SUSPECT' | 'UNASSESSED';
  payload: {
    itemsCount: number;
    totalProvenCount?: number;
    hasMore: boolean;
    data: any;
  };
  provenance: {
    source: string;
    capturedAt: string;
    periodApplied: string;
  };
  continuation?: {
    cursor?: string;
    nextPageAvailable: boolean;
  };
}
