/**
 * src/hydra-sync/types/semantic_contract.ts
 * Contrato formal tipado da Ontologia de Negócio e Plano Semântico do Hydra.
 * 
 * Regra Cardinal: TypeScript strict — ZERO `any`.
 * Referência: specs/hydra-semantic-layer/design.md & proposal.md
 */

export type ConceptCategory = 
  | 'entity' 
  | 'dimension' 
  | 'metric' 
  | 'relation' 
  | 'term' 
  | 'event' 
  | 'operator' 
  | 'availability';

export interface BusinessEntity {
  id: string; // Ex: 'loja', 'ordem_servico', 'veiculo', 'meta_diaria', 'faturamento_area'
  displayName: string;
  primaryKey: string;
  sourceTable: string;
  scopeField?: string; // Ex: 'loja_slug'
  description: string;
}

export interface BusinessDimension {
  id: string; // Ex: 'area', 'status_grid', 'responsavel_fechamento', 'is_aberta', 'dias_no_patio'
  entityId: string;
  dataType: 'string' | 'number' | 'boolean' | 'date';
  sourceColumn: string;
  allowedValues?: string[];
  nullable: boolean;
  description?: string;
}

export type MetricAggregationType = 
  | 'sum' 
  | 'count' 
  | 'avg' 
  | 'weighted_ratio' 
  | 'latest_snapshot' 
  | 'min' 
  | 'max';

export interface BusinessMetric {
  id: string; // Ex: 'cmv_percentual', 'faturamento_bruto', 'saldo_restante', 'ticket_medio'
  displayName: string;
  entityId: string;
  formula: string; // Ex: '(SUM(custo) / SUM(faturamento)) * 100'
  numeratorColumn?: string;
  denominatorColumn?: string;
  aggregation: MetricAggregationType;
  unit: 'BRL' | 'percent' | 'count' | 'days';
  requiresWeightedAggregation: boolean;
  description?: string;
}

export interface BusinessRelation {
  id: string; // Ex: 'loja_ordens', 'os_pecas', 'os_pagamentos', 'os_servicos', 'os_veiculo'
  parentEntityId: string;
  childEntityId: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'N:N';
  parentKey: string;
  childKey: string;
  multiplicationRisk: boolean; // Se true, compilador exige subconsultas correlacionadas ou CTE
  description?: string;
}

export type FilterOperator = 
  | 'EQUALS' 
  | 'NOT_EQUALS' 
  | 'GREATER_THAN' 
  | 'GREATER_EQUAL' 
  | 'LESS_THAN' 
  | 'LESS_EQUAL' 
  | 'BETWEEN' 
  | 'IN' 
  | 'NOT_IN' 
  | 'IS_NULL' 
  | 'IS_NOT_NULL' 
  | 'EXISTS' 
  | 'NOT_EXISTS' 
  | 'LIKE';

export type FilterValue = string | number | boolean | (string | number)[] | null;

export interface SemanticFilterCondition {
  dimensionOrMetricId: string;
  operator: FilterOperator;
  value?: FilterValue;
  secondaryValue?: string | number | null; // Usado para BETWEEN
  relationContext?: string; // Usado para EXISTS / NOT_EXISTS
}

export interface SemanticFilterNode {
  logic: 'AND' | 'OR' | 'NOT';
  conditions: (SemanticFilterCondition | SemanticFilterNode)[];
}

export interface BusinessTerm {
  term: string;
  canonicalMeaning: string;
  targetEntityId: string;
  filterCondition: SemanticFilterCondition | SemanticFilterNode;
  nonEquivalences: string[];
  caveat?: string;
}

export interface BusinessEvent {
  id: string;
  entityId: string;
  timestampColumn: string;
  eventDescription: string;
}

export interface BusinessOperator {
  id: FilterOperator;
  symbol: string;
  description: string;
  requiresSecondaryValue: boolean;
}

export interface BusinessAvailability {
  tableOrField: string;
  coverage: 'full' | 'partial' | 'unavailable';
  granularity: string;
  notes: string;
}

export interface SemanticAggregation {
  metricId: string;
  alias: string;
}

export interface SemanticSort {
  fieldId: string;
  direction: 'ASC' | 'DESC';
}

export interface SemanticPeriod {
  type: 'mes_atual' | 'mes_anterior' | 'ultimos_30d' | 'hoje' | 'custom';
  startDate?: string;
  endDate?: string;
  comparisonPeriod?: {
    type: 'mes_anterior_homologo' | 'ano_anterior' | 'periodo_anterior';
    startDate?: string;
    endDate?: string;
  };
}

export interface SecurityContext {
  persona: 'socio' | 'gerente';
  authorizedLojaSlug?: string;
  authorizedPhones?: string[];
}

export type PrimaryEntityType = 
  | 'loja' 
  | 'ordem_servico' 
  | 'veiculo' 
  | 'meta_diaria' 
  | 'faturamento_area';

export interface SemanticQueryPlan {
  planId: string;
  catalogVersion: string; // Ex: '1.2.0'
  primaryEntity: PrimaryEntityType;
  dimensions: string[];
  metrics: string[];
  filters: SemanticFilterNode;
  aggregations: SemanticAggregation[];
  groupBy?: string[];
  orderBy?: SemanticSort[];
  limit?: number;
  period?: SemanticPeriod;
  relationsRequired: string[];
  coverageRequired: 'full' | 'partial_allowed';
  securityScope: SecurityContext;
  missingRequirements?: string[];
  executionMode: 'exact_sql' | 'mcp_tool' | 'clarify';
  clarificationReason?: string;
  executionStrategy?: 'scalar_correlated' | 'exists_subquery' | 'pre_aggregated_cte';
  searchSampleOnly?: boolean;
  causalDecomposition?: boolean;
}
