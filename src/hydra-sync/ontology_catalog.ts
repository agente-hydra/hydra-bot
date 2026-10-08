/**
 * src/hydra-sync/ontology_catalog.ts
 * Catálogo Canônico da Ontologia de Negócio do Hydra (Versão 1.2.0).
 * 
 * Modela os 8 elementos fundamentais:
 * 1. Entidade (BusinessEntity)
 * 2. Dimensão (BusinessDimension)
 * 3. Métrica (BusinessMetric)
 * 4. Relação (BusinessRelation)
 * 5. Termo (BusinessTerm)
 * 6. Evento (BusinessEvent)
 * 7. Operador (BusinessOperator)
 * 8. Disponibilidade (BusinessAvailability)
 * 
 * Regra Cardinal: TypeScript strict — ZERO `any`.
 */

import type {
  BusinessEntity,
  BusinessDimension,
  BusinessMetric,
  BusinessRelation,
  BusinessTerm,
  BusinessEvent,
  BusinessOperator,
  BusinessAvailability,
  FilterOperator,
  PrimaryEntityType
} from './types/semantic_contract.js';

export const ONTOLOGY_VERSION = '1.2.0';

// -------------------------------------------------------------------------
// 1. ENTIDADES
// -------------------------------------------------------------------------
export const ENTITIES_CATALOG: Record<PrimaryEntityType, BusinessEntity> = {
  loja: {
    id: 'loja',
    displayName: 'Loja / Unidade',
    primaryKey: 'loja_slug',
    sourceTable: 'lojas',
    scopeField: 'loja_slug',
    description: 'Unidade operacional da rede Mecânica Popular (10 lojas elegíveis).'
  },
  ordem_servico: {
    id: 'ordem_servico',
    displayName: 'Ordem de Serviço (OS)',
    primaryKey: 'os_id',
    sourceTable: 'ordens_servico',
    scopeField: 'loja_slug',
    description: 'Atendimento operacional e financeiro de veículo em oficina.'
  },
  veiculo: {
    id: 'veiculo',
    displayName: 'Veículo',
    primaryKey: 'placa',
    sourceTable: 'veiculos',
    description: 'Automóvel atendido identificado de forma estável pela placa Mercosul/antiga.'
  },
  meta_diaria: {
    id: 'meta_diaria',
    displayName: 'Meta Diária (Snapshot de Faturamento)',
    primaryKey: 'id',
    sourceTable: 'metas_diarias',
    scopeField: 'loja_slug',
    description: 'Foto pontual de faturamento mensal acumulado e meta da loja em determinado horário.'
  },
  faturamento_area: {
    id: 'faturamento_area',
    displayName: 'Faturamento por Área Operacional',
    primaryKey: 'id',
    sourceTable: 'faturamento_areas',
    scopeField: 'loja_slug',
    description: 'Consolidação mensal de receita, custo e CMV por área operacional da loja.'
  }
};

// -------------------------------------------------------------------------
// 2. DIMENSÕES
// -------------------------------------------------------------------------
export const DIMENSIONS_CATALOG: Record<string, BusinessDimension> = {
  loja_slug: {
    id: 'loja_slug',
    entityId: 'loja',
    dataType: 'string',
    sourceColumn: 'loja_slug',
    nullable: false,
    description: 'Identificador canônico da loja (ex: MPSantoAndre, MPdompedro1).'
  },
  os_id: {
    id: 'os_id',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'os_id',
    nullable: false,
    description: 'Número ou código de identificação da Ordem de Serviço.'
  },
  placa: {
    id: 'placa',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'placa',
    nullable: false,
    description: 'Placa do veículo atendido (7 caracteres sem hífen).'
  },
  veiculo_modelo: {
    id: 'veiculo_modelo',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'veiculo',
    nullable: true,
    description: 'Modelo ou descrição do veículo atendido na OS (ex: Fiat Linea, Onix).'
  },
  status_grid: {
    id: 'status_grid',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'status_grid',
    allowedValues: ['ABERTA', 'FECHADA', 'CANCELADA', 'AGUARDANDO_PECA', 'FINALIZADA'],
    nullable: false,
    description: 'Situação da OS na grade do sistema.'
  },
  is_aberta: {
    id: 'is_aberta',
    entityId: 'ordem_servico',
    dataType: 'boolean',
    sourceColumn: 'is_aberta',
    nullable: false,
    description: 'Flag booleana indicando se a OS está aberta (1) ou fechada (0).'
  },
  dias_no_patio: {
    id: 'dias_no_patio',
    entityId: 'ordem_servico',
    dataType: 'number',
    sourceColumn: 'dias_no_patio',
    nullable: false,
    description: 'Quantidade de dias corridos desde a data de abertura da OS.'
  },
  responsavel_fechamento: {
    id: 'responsavel_fechamento',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'responsavel_fechamento',
    nullable: true,
    description: 'Colaborador responsável pelo encerramento operacional/financeiro da OS.'
  },
  consultor: {
    id: 'consultor',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'consultor',
    nullable: true,
    description: 'Consultor técnico que abriu o atendimento da OS.'
  },
  mecanico: {
    id: 'mecanico',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'mecanico',
    nullable: true,
    description: 'Mecânico responsável pela execução dos serviços da OS.'
  },
  area: {
    id: 'area',
    entityId: 'faturamento_area',
    dataType: 'string',
    sourceColumn: 'area',
    allowedValues: ['OLEO', 'MECANICA', 'PNEUS', 'ALINHAMENTO', 'ELETRICA', 'AR_CONDICIONADO', 'GERAL'],
    nullable: false,
    description: 'Área operacional de prestação de serviços.'
  },
  data_abertura: {
    id: 'data_abertura',
    entityId: 'ordem_servico',
    dataType: 'date',
    sourceColumn: 'data_abertura',
    nullable: false,
    description: 'Data e hora da abertura formal da Ordem de Serviço.'
  },
  data_fechamento: {
    id: 'data_fechamento',
    entityId: 'ordem_servico',
    dataType: 'date',
    sourceColumn: 'data_fechamento',
    nullable: true,
    description: 'Data e hora do encerramento da Ordem de Serviço.'
  },
  data_referencia: {
    id: 'data_referencia',
    entityId: 'meta_diaria',
    dataType: 'date',
    sourceColumn: 'data_referencia',
    nullable: false,
    description: 'Data civil do registro de meta diária (YYYY-MM-DD).'
  },
  posicao_hora: {
    id: 'posicao_hora',
    entityId: 'meta_diaria',
    dataType: 'string',
    sourceColumn: 'posicao_hora',
    nullable: false,
    description: 'Horário do snapshot de vendas no dia (ex: 18:00).'
  },
  forma_pagamento: {
    id: 'forma_pagamento',
    entityId: 'ordem_servico',
    dataType: 'string',
    sourceColumn: 'forma_pagamento',
    nullable: true,
    description: 'Modalidade de pagamento utilizada na OS.'
  }
};

// -------------------------------------------------------------------------
// 3. MÉTRICAS (com requiresWeightedAggregation estrito)
// -------------------------------------------------------------------------
export const METRICS_CATALOG: Record<string, BusinessMetric> = {
  cmv_percentual: {
    id: 'cmv_percentual',
    displayName: 'CMV (%)',
    entityId: 'faturamento_area',
    formula: '(SUM(custo) / SUM(faturamento)) * 100',
    numeratorColumn: 'custo',
    denominatorColumn: 'faturamento',
    aggregation: 'weighted_ratio',
    unit: 'percent',
    requiresWeightedAggregation: true,
    description: 'Custo de Mercadoria Vendida ponderado em relação ao faturamento bruto. PROIBIDA média simples.'
  },
  ticket_medio: {
    id: 'ticket_medio',
    displayName: 'Ticket Médio',
    entityId: 'ordem_servico',
    formula: 'SUM(total_os) / COUNT(os_id)',
    numeratorColumn: 'total_os',
    denominatorColumn: 'os_id',
    aggregation: 'weighted_ratio',
    unit: 'BRL',
    requiresWeightedAggregation: true,
    description: 'Valor médio por OS concluída. Agrupamentos exigem soma de faturamento dividida pela soma de OSs.'
  },
  percentual_meta: {
    id: 'percentual_meta',
    displayName: 'Atingimento da Meta (%)',
    entityId: 'meta_diaria',
    formula: '(faturamento_mes / meta_mes) * 100',
    aggregation: 'latest_snapshot',
    unit: 'percent',
    requiresWeightedAggregation: true,
    description: 'Percentual atingido da meta do mês no snapshot mais recente. PROIBIDO somar snapshots.'
  },
  faturamento_bruto: {
    id: 'faturamento_bruto',
    displayName: 'Faturamento Bruto',
    entityId: 'ordem_servico',
    formula: 'SUM(total_os)',
    aggregation: 'sum',
    unit: 'BRL',
    requiresWeightedAggregation: false,
    description: 'Soma dos valores totais de OSs faturadas.'
  },
  valor_pago: {
    id: 'valor_pago',
    displayName: 'Valor Pago / Entrada',
    entityId: 'ordem_servico',
    formula: 'SUM(valor_pago)',
    aggregation: 'sum',
    unit: 'BRL',
    requiresWeightedAggregation: false,
    description: 'Total de adiantamentos e pagamentos recebidos da OS.'
  },
  saldo_restante: {
    id: 'saldo_restante',
    displayName: 'Saldo Restante',
    entityId: 'ordem_servico',
    formula: 'SUM(valor_restante)',
    aggregation: 'sum',
    unit: 'BRL',
    requiresWeightedAggregation: false,
    description: 'Saldo em aberto pendente de quitação na OS.'
  },
  volume_os: {
    id: 'volume_os',
    displayName: 'Volume de OS',
    entityId: 'ordem_servico',
    formula: 'COUNT(os_id)',
    aggregation: 'count',
    unit: 'count',
    requiresWeightedAggregation: false,
    description: 'Contagem exata de Ordens de Serviço.'
  },
  custo_total: {
    id: 'custo_total',
    displayName: 'Custo Total',
    entityId: 'faturamento_area',
    formula: 'SUM(custo)',
    aggregation: 'sum',
    unit: 'BRL',
    requiresWeightedAggregation: false,
    description: 'Soma de custos diretos de peças e materiais.'
  }
};

// -------------------------------------------------------------------------
// 4. RELAÇÕES (com declaração de risco de multiplicação 1:N)
// -------------------------------------------------------------------------
export const RELATIONS_CATALOG: Record<string, BusinessRelation> = {
  loja_ordens: {
    id: 'loja_ordens',
    parentEntityId: 'loja',
    childEntityId: 'ordem_servico',
    cardinality: '1:N',
    parentKey: 'loja_slug',
    childKey: 'loja_slug',
    multiplicationRisk: false,
    description: 'Uma loja possui múltiplas ordens de serviço.'
  },
  loja_metas: {
    id: 'loja_metas',
    parentEntityId: 'loja',
    childEntityId: 'meta_diaria',
    cardinality: '1:N',
    parentKey: 'loja_slug',
    childKey: 'loja_slug',
    multiplicationRisk: false,
    description: 'Uma loja possui múltiplos snapshots de metas ao longo do tempo.'
  },
  loja_faturamento_areas: {
    id: 'loja_faturamento_areas',
    parentEntityId: 'loja',
    childEntityId: 'faturamento_area',
    cardinality: '1:N',
    parentKey: 'loja_slug',
    childKey: 'loja_slug',
    multiplicationRisk: false,
    description: 'Uma loja possui registros mensais de faturamento por área.'
  },
  os_pecas: {
    id: 'os_pecas',
    parentEntityId: 'ordem_servico',
    childEntityId: 'item_peca',
    cardinality: '1:N',
    parentKey: 'os_id',
    childKey: 'os_id',
    multiplicationRisk: true,
    description: 'Uma OS possui múltiplas peças. RISCO: exige CTE agregada ou EXISTS para não duplicar totais.'
  },
  os_pagamentos: {
    id: 'os_pagamentos',
    parentEntityId: 'ordem_servico',
    childEntityId: 'pagamento_os',
    cardinality: '1:N',
    parentKey: 'os_id',
    childKey: 'os_id',
    multiplicationRisk: true,
    description: 'Uma OS possui múltiplas parcelas. RISCO: exige CTE pré-agregada ou subquery escalar.'
  },
  os_servicos: {
    id: 'os_servicos',
    parentEntityId: 'ordem_servico',
    childEntityId: 'item_servico',
    cardinality: '1:N',
    parentKey: 'os_id',
    childKey: 'os_id',
    multiplicationRisk: true,
    description: 'Uma OS possui múltiplos itens de serviço. RISCO: exige EXISTS ou subconsulta.'
  },
  os_veiculo: {
    id: 'os_veiculo',
    parentEntityId: 'ordem_servico',
    childEntityId: 'veiculo',
    cardinality: 'N:1',
    parentKey: 'placa',
    childKey: 'placa',
    multiplicationRisk: false,
    description: 'Múltiplas OSs podem atender ao mesmo veículo identificado pela placa.'
  }
};

// -------------------------------------------------------------------------
// 5. TERMOS RIGOROSOS E NÃO-EQUIVALÊNCIAS
// -------------------------------------------------------------------------
export const TERMS_CATALOG: Record<string, BusinessTerm> = {
  sem_sinal: {
    term: 'sem sinal',
    canonicalMeaning: 'OS com valor pago menor ou igual a zero e saldo restante pendente',
    targetEntityId: 'ordem_servico',
    filterCondition: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'valor_pago', operator: 'LESS_EQUAL', value: 0 },
        { dimensionOrMetricId: 'saldo_restante', operator: 'GREATER_THAN', value: 0 }
      ]
    },
    nonEquivalences: ['desconhecido', 'gratis', 'isento', 'sem_custo', 'sinal_nao_cadastrado'],
    caveat: 'Diferente de sinal desconhecido. Exige confirmação expressa de recebíveis registrados no sistema.'
  },
  parado: {
    term: 'parado',
    canonicalMeaning: 'OS com status aberta no sistema e com 5 ou mais dias de permanência no pátio',
    targetEntityId: 'ordem_servico',
    filterCondition: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: true },
        { dimensionOrMetricId: 'dias_no_patio', operator: 'GREATER_EQUAL', value: 5 }
      ]
    },
    nonEquivalences: ['presenca_fisica_sem_os', 'estacionado', 'abandonado', 'retencao_judicial'],
    caveat: 'OS aberta no sistema NÃO comprova presença física no pátio da oficina. Reflete apenas estado cadastral.'
  },
  atrasado: {
    term: 'atrasado',
    canonicalMeaning: 'OS aberta com tempo no pátio igual ou superior a 3 dias',
    targetEntityId: 'ordem_servico',
    filterCondition: {
      logic: 'AND',
      conditions: [
        { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: true },
        { dimensionOrMetricId: 'dias_no_patio', operator: 'GREATER_EQUAL', value: 3 }
      ]
    },
    nonEquivalences: ['inadimplencia_financeira', 'atraso_de_fornecedor', 'quebra_de_promessa_cliente'],
    caveat: 'Não inferir atraso de entrega ao cliente sem data de previsão gravada no sistema.'
  },
  sem_entrada: {
    term: 'sem entrada',
    canonicalMeaning: 'Sinônimo de sem sinal: valor pago menor ou igual a zero',
    targetEntityId: 'ordem_servico',
    filterCondition: {
      dimensionOrMetricId: 'valor_pago',
      operator: 'LESS_EQUAL',
      value: 0
    },
    nonEquivalences: ['entrada_cancelada', 'sem_orcamento'],
    caveat: 'Valores não pagos de entrada devem ser comprovados na base de pagamentos.'
  },
  perdendo_dinheiro: {
    term: 'perdendo dinheiro',
    canonicalMeaning: 'CMV percentual apurado acima da meta ou faturamento inferior aos custos',
    targetEntityId: 'faturamento_area',
    filterCondition: {
      dimensionOrMetricId: 'cmv_percentual',
      operator: 'GREATER_THAN',
      value: 40
    },
    nonEquivalences: ['faturamento_baixo', 'meta_nao_batida', 'baixo_fluxo_veiculos'],
    caveat: 'Exige CMV apurado acima da meta ou margem de contribuição negativa comprovada; faturamento baixo isolado não é prejuízo.'
  },
  encerrada: {
    term: 'encerrada',
    canonicalMeaning: 'Ordem de Serviço com status fechada/concluída (is_aberta = false)',
    targetEntityId: 'ordem_servico',
    filterCondition: {
      dimensionOrMetricId: 'is_aberta',
      operator: 'EQUALS',
      value: false
    },
    nonEquivalences: ['cancelada', 'em_andamento'],
    caveat: 'OS encerrada comprova conclusão cadastral, mas não atesta exatidão dos recebimentos sem verificação de pagamentos.'
  }
};

// -------------------------------------------------------------------------
// 6. EVENTOS TEMPORAIS
// -------------------------------------------------------------------------
export const EVENTS_CATALOG: Record<string, BusinessEvent> = {
  data_abertura: {
    id: 'data_abertura',
    entityId: 'ordem_servico',
    timestampColumn: 'data_abertura',
    eventDescription: 'Data e hora formal do registro de abertura da OS.'
  },
  data_fechamento: {
    id: 'data_fechamento',
    entityId: 'ordem_servico',
    timestampColumn: 'data_fechamento',
    eventDescription: 'Data e hora da baixa ou encerramento da OS.'
  },
  data_referencia: {
    id: 'data_referencia',
    entityId: 'meta_diaria',
    timestampColumn: 'data_referencia',
    eventDescription: 'Data civil de apuração das metas diárias.'
  },
  posicao_hora: {
    id: 'posicao_hora',
    entityId: 'meta_diaria',
    timestampColumn: 'posicao_hora',
    eventDescription: 'Horário do snapshot pontual de metas (nunca somar fotos).'
  },
  created_at: {
    id: 'created_at',
    entityId: 'ordem_servico',
    timestampColumn: 'created_at',
    eventDescription: 'Data/hora de coleta técnica pelo crawler. NUNCA utilizar como data de abertura ou fechamento.'
  }
};

// -------------------------------------------------------------------------
// 7. OPERADORES FORMAIS
// -------------------------------------------------------------------------
export const OPERATORS_CATALOG: Record<FilterOperator, BusinessOperator> = {
  EQUALS: { id: 'EQUALS', symbol: '=', description: 'Igualdade exata', requiresSecondaryValue: false },
  NOT_EQUALS: { id: 'NOT_EQUALS', symbol: '!=', description: 'Desigualdade', requiresSecondaryValue: false },
  GREATER_THAN: { id: 'GREATER_THAN', symbol: '>', description: 'Maior que estrito', requiresSecondaryValue: false },
  GREATER_EQUAL: { id: 'GREATER_EQUAL', symbol: '>=', description: 'Maior ou igual a', requiresSecondaryValue: false },
  LESS_THAN: { id: 'LESS_THAN', symbol: '<', description: 'Menor que estrito', requiresSecondaryValue: false },
  LESS_EQUAL: { id: 'LESS_EQUAL', symbol: '<=', description: 'Menor ou igual a', requiresSecondaryValue: false },
  BETWEEN: { id: 'BETWEEN', symbol: 'BETWEEN', description: 'Intervalo fechado [valor, secondaryValue]', requiresSecondaryValue: true },
  IN: { id: 'IN', symbol: 'IN', description: 'Pertencimento a conjunto de valores válidos', requiresSecondaryValue: false },
  NOT_IN: { id: 'NOT_IN', symbol: 'NOT IN', description: 'Não pertencimento a conjunto', requiresSecondaryValue: false },
  IS_NULL: { id: 'IS_NULL', symbol: 'IS NULL', description: 'Valor ausente ou nulo', requiresSecondaryValue: false },
  IS_NOT_NULL: { id: 'IS_NOT_NULL', symbol: 'IS NOT NULL', description: 'Valor preenchido / não nulo', requiresSecondaryValue: false },
  EXISTS: { id: 'EXISTS', symbol: 'EXISTS', description: 'Existência comprovada de relação 1:N', requiresSecondaryValue: false },
  NOT_EXISTS: { id: 'NOT_EXISTS', symbol: 'NOT EXISTS', description: 'Ausência comprovada de relação 1:N', requiresSecondaryValue: false },
  LIKE: { id: 'LIKE', symbol: 'LIKE', description: 'Casamento textual parcial seguro', requiresSecondaryValue: false }
};

// -------------------------------------------------------------------------
// 8. DISPONIBILIDADE E COBERTURA
// -------------------------------------------------------------------------
export const AVAILABILITY_CATALOG: Record<string, BusinessAvailability> = {
  ordens_servico: {
    tableOrField: 'ordens_servico',
    coverage: 'full',
    granularity: 'Ordem de Serviço individual (1 linha por OS)',
    notes: 'Base reconciliada com histórico de 30 dias a 12 meses.'
  },
  metas_diarias: {
    tableOrField: 'metas_diarias',
    coverage: 'full',
    granularity: 'Snapshot horário acumulado por loja (1 linha por horário/loja)',
    notes: 'Foto acumulada no mês até o horário; selecionar o snapshot mais recente, sem somar posições.'
  },
  faturamento_areas: {
    tableOrField: 'faturamento_areas',
    coverage: 'full',
    granularity: 'Consolidado mensal por área e loja',
    notes: 'Disponível para competências fechadas e mês atual em curso.'
  },
  pagamentos_os: {
    tableOrField: 'pagamentos_os',
    coverage: 'partial',
    granularity: 'Parcela de pagamento por OS',
    notes: 'Cobertura sujeita à conciliação da loja. Não declarar ausência categórica quando cobertura for parcial.'
  },
  itens_pecas: {
    tableOrField: 'itens_pecas',
    coverage: 'full',
    granularity: 'Item de peça individual por OS',
    notes: 'Extraído dos orçamentos e pedidos das OSs.'
  }
};

// -------------------------------------------------------------------------
// FUNÇÕES DE CONSULTA DO CATÁLOGO
// -------------------------------------------------------------------------
export function getOntologyEntity(id: string): BusinessEntity | undefined {
  if (id in ENTITIES_CATALOG) {
    return ENTITIES_CATALOG[id as PrimaryEntityType];
  }
  return undefined;
}

export function getOntologyDimension(id: string): BusinessDimension | undefined {
  return DIMENSIONS_CATALOG[id];
}

export function getOntologyMetric(id: string): BusinessMetric | undefined {
  return METRICS_CATALOG[id];
}

export function getOntologyRelation(id: string): BusinessRelation | undefined {
  return RELATIONS_CATALOG[id];
}

export function getOntologyTerm(termKey: string): BusinessTerm | undefined {
  return TERMS_CATALOG[termKey];
}

export function getOntologyOperator(op: FilterOperator): BusinessOperator | undefined {
  return OPERATORS_CATALOG[op];
}

export function getOntologyAvailability(key: string): BusinessAvailability | undefined {
  return AVAILABILITY_CATALOG[key];
}
