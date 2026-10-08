/**
 * src/hydra-sync/data_dictionary.ts
 * 
 * Dicionário de Dados e Metadados Semânticos do Hydra.
 * Mapeia a granularidade nativa das tabelas operacionais, os eventos temporais distintos,
 * os riscos de multiplicação cartesiana (1:N) e as regras rígidas de agregação.
 * 
 * Propriedade: Executor 2 (Dados e Evidências)
 * Spec: hydra-semantic-layer
 */

export type TableGranularity = 
  | 'ONE_ROW_PER_OS_STORE'           // ordens_servico: (os_id, loja_slug)
  | 'ONE_ROW_PER_HOURLY_SNAPSHOT'     // metas_diarias: (loja_slug, data_referencia, posicao_hora)
  | 'ONE_ROW_PER_AREA_PERIOD'         // faturamento_areas: (loja_slug, data_inicio, data_fim, area)
  | 'ONE_ROW_PER_STORE_PERIOD'        // cmv_lojas: (loja_slug, data_inicio, data_fim)
  | 'ONE_ROW_PER_MEDIA_CHANNEL'       // pesquisa_midia: (loja_slug, data_inicio, data_fim, canal)
  | 'ONE_ROW_PER_OS_PART_ITEM'        // itens_pecas: (id) -> FK (os_id, loja_slug)
  | 'ONE_ROW_PER_OS_SERVICE_ITEM'     // itens_servicos: (id) -> FK (os_id, loja_slug)
  | 'ONE_ROW_PER_OS_PAYMENT_INSTALLMENT' // pagamentos_os: (id) -> FK (os_id, loja_slug)
  | 'ONE_ROW_PER_STORE';              // lojas: (slug)

export type TemporalEventType = 
  | 'ABERTURA'      // Data/hora em que a OS ou transação foi iniciada
  | 'FECHAMENTO'    // Data/hora em que a OS foi concluída/fechada operacionalmente
  | 'FATURAMENTO'   // Período ou data contábil de competência do faturamento
  | 'COLETA';       // Carimbo técnico de ingestão/observação no SQLite (created_at/updated_at)

export interface TemporalEventMapping {
  eventType: TemporalEventType;
  columnName: string;
  dataType: 'DATE' | 'DATETIME' | 'TIME' | 'PERIOD_RANGE';
  description: string;
  cannotSubstitute: TemporalEventType[];
}

export interface ColumnDefinition {
  name: string;
  dataType: 'TEXT' | 'INTEGER' | 'REAL' | 'BOOLEAN' | 'DATETIME';
  isPrimaryKey: boolean;
  isForeignKey?: boolean;
  foreignTable?: string;
  foreignColumn?: string;
  nullable: boolean;
  temporalRole?: TemporalEventType;
  description: string;
}

export interface AggregationRule {
  operation: 'SUM' | 'COUNT' | 'AVG' | 'AVG_WEIGHTED' | 'LATEST_SNAPSHOT';
  targetColumn?: string;
  status: 'ALLOWED' | 'FORBIDDEN';
  reason: string;
}

export interface TableGranularityDefinition {
  tableName: string;
  displayName: string;
  description: string;
  granularity: TableGranularity;
  granularityDescription: string;
  primaryKey: string[];
  scope: string; // Ex: '10 Lojas Elegíveis (Expurgo de Loja Master)'
  temporalEvents: TemporalEventMapping[];
  columns: ColumnDefinition[];
  aggregationRules: AggregationRule[];
  oneToManyRelations: {
    childTable: string;
    foreignKey: string[];
    cartesianRisk: boolean;
    mitigationStrategy: 'PRE_AGGREGATED_CTE' | 'SCALAR_CORRELATED_SUBQUERY' | 'EXISTS_FILTER';
  }[];
}

/**
 * Catálogo Oficial do Dicionário de Dados
 */
export const DATA_DICTIONARY: Record<string, TableGranularityDefinition> = {
  ordens_servico: {
    tableName: 'ordens_servico',
    displayName: 'Ordens de Serviço',
    description: 'Registro central de movimentação veicular e orçamentos operacionais das lojas.',
    granularity: 'ONE_ROW_PER_OS_STORE',
    granularityDescription: 'Exatamente uma linha por Ordem de Serviço por Loja (chave composta: os_id, loja_slug).',
    primaryKey: ['os_id', 'loja_slug'],
    scope: 'Todas as lojas ativas da rede. Para análises de rede, expurgar Loja Master.',
    temporalEvents: [
      {
        eventType: 'ABERTURA',
        columnName: 'data_inicio',
        dataType: 'DATETIME',
        description: 'Data e hora oficial de abertura da OS pelo consultor.',
        cannotSubstitute: ['FECHAMENTO', 'FATURAMENTO', 'COLETA']
      },
      {
        eventType: 'FECHAMENTO',
        columnName: 'data_fim',
        dataType: 'DATETIME',
        description: 'Data e hora oficial de encerramento da OS. Nula se a OS estiver em aberto (is_aberta = 1).',
        cannotSubstitute: ['ABERTURA', 'FATURAMENTO', 'COLETA']
      },
      {
        eventType: 'COLETA',
        columnName: 'updated_at',
        dataType: 'DATETIME',
        description: 'Carimbo técnico da última atualização do registro pelo crawler no SQLite.',
        cannotSubstitute: ['ABERTURA', 'FECHAMENTO', 'FATURAMENTO']
      }
    ],
    columns: [
      { name: 'os_id', dataType: 'TEXT', isPrimaryKey: true, nullable: false, description: 'Número identificador da OS na loja' },
      { name: 'loja_slug', dataType: 'TEXT', isPrimaryKey: true, isForeignKey: true, foreignTable: 'lojas', foreignColumn: 'slug', nullable: false, description: 'Slug identificador da loja' },
      { name: 'tipo', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Tipo da OS (ex: OS, Orcamento)' },
      { name: 'status_grid', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Status visual da OS na grade operacional' },
      { name: 'is_aberta', dataType: 'INTEGER', isPrimaryKey: false, nullable: false, description: '1 se aberta/em andamento, 0 se fechada/encerrada' },
      { name: 'data_inicio', dataType: 'TEXT', isPrimaryKey: false, nullable: true, temporalRole: 'ABERTURA', description: 'Data/hora de abertura' },
      { name: 'data_fim', dataType: 'TEXT', isPrimaryKey: false, nullable: true, temporalRole: 'FECHAMENTO', description: 'Data/hora de fechamento' },
      { name: 'dias_no_patio', dataType: 'INTEGER', isPrimaryKey: false, nullable: false, description: 'Dias transcorridos desde a abertura sem fechamento' },
      { name: 'veiculo', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Modelo e marca do veículo' },
      { name: 'placa', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Placa do veículo atendido' },
      { name: 'cliente_nome', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Nome do cliente (não confiável como chave primária)' },
      { name: 'responsavel', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Consultor ou mecânico responsável' },
      { name: 'total_os', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Valor total orçado/faturado da OS' },
      { name: 'valor_pago', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Total recebido até o momento' },
      { name: 'valor_restante', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Saldo devedor restante da OS' },
      { name: 'tem_nf', dataType: 'INTEGER', isPrimaryKey: false, nullable: false, description: '1 se possui nota fiscal emitida, 0 caso contrário' },
      { name: 'raw_payload', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Payload JSON extraído da tela do sistema legado' },
      { name: 'updated_at', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'COLETA', description: 'Momento da coleta local' }
    ],
    aggregationRules: [
      {
        operation: 'SUM',
        targetColumn: 'total_os',
        status: 'ALLOWED',
        reason: 'Permitido somar total_os se agrupado pelo grão de OS ou sem joins 1:N multiplicadores.'
      },
      {
        operation: 'SUM',
        targetColumn: 'DISTINCT total_os',
        status: 'FORBIDDEN',
        reason: 'PROIBIDO: SUM(DISTINCT) deduplica por valor, eliminando OSs legítimas com valores idênticos (Cenário T29).'
      },
      {
        operation: 'COUNT',
        targetColumn: 'os_id',
        status: 'ALLOWED',
        reason: 'Contagem de ordens de serviço válidas.'
      }
    ],
    oneToManyRelations: [
      {
        childTable: 'itens_pecas',
        foreignKey: ['os_id', 'loja_slug'],
        cartesianRisk: true,
        mitigationStrategy: 'PRE_AGGREGATED_CTE'
      },
      {
        childTable: 'pagamentos_os',
        foreignKey: ['os_id', 'loja_slug'],
        cartesianRisk: true,
        mitigationStrategy: 'SCALAR_CORRELATED_SUBQUERY'
      }
    ]
  },

  metas_diarias: {
    tableName: 'metas_diarias',
    displayName: 'Metas Diárias e Snapshots de Faturamento',
    description: 'Fotos periódicas ao longo do dia com o faturamento acumulado do mês até aquela hora.',
    granularity: 'ONE_ROW_PER_HOURLY_SNAPSHOT',
    granularityDescription: 'Uma linha por snapshot horário por loja por data de referência.',
    primaryKey: ['id'],
    scope: 'Lojas operacionais ativas.',
    temporalEvents: [
      {
        eventType: 'FATURAMENTO',
        columnName: 'data_referencia',
        dataType: 'DATE',
        description: 'Dia civil do snapshot e mês de competência acumulado.',
        cannotSubstitute: ['ABERTURA', 'FECHAMENTO', 'COLETA']
      },
      {
        eventType: 'COLETA',
        columnName: 'posicao_hora',
        dataType: 'TIME',
        description: 'Horário do dia em que a foto de faturamento foi extraída (ex: 10:00:00, 18:00:00).',
        cannotSubstitute: ['FATURAMENTO', 'ABERTURA', 'FECHAMENTO']
      },
      {
        eventType: 'COLETA',
        columnName: 'created_at',
        dataType: 'DATETIME',
        description: 'Carimbo técnico de inserção no banco SQLite.',
        cannotSubstitute: ['FATURAMENTO', 'ABERTURA', 'FECHAMENTO']
      }
    ],
    columns: [
      { name: 'id', dataType: 'INTEGER', isPrimaryKey: true, nullable: false, description: 'ID autoincremento' },
      { name: 'data_referencia', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'FATURAMENTO', description: 'Data do snapshot (YYYY-MM-DD)' },
      { name: 'posicao_hora', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'COLETA', description: 'Horário da captura (HH:MM:SS)' },
      { name: 'loja_slug', dataType: 'TEXT', isPrimaryKey: false, isForeignKey: true, foreignTable: 'lojas', foreignColumn: 'slug', nullable: false, description: 'Slug da loja' },
      { name: 'faturamento_mes', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Faturamento acumulado no mês até esta posição' },
      { name: 'volume_os', dataType: 'INTEGER', isPrimaryKey: false, nullable: false, description: 'Volume total de OSs faturadas no mês até esta posição' },
      { name: 'ticket_medio', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Ticket médio acumulado no mês' },
      { name: 'meta_mes', dataType: 'REAL', isPrimaryKey: false, nullable: true, description: 'Meta financeira orçada para o mês' },
      { name: 'previsao_mes', dataType: 'REAL', isPrimaryKey: false, nullable: true, description: 'Projeção linear de faturamento para o fim do mês' },
      { name: 'percentual_meta', dataType: 'REAL', isPrimaryKey: false, nullable: true, description: 'Percentual atingido da meta mensal' },
      { name: 'created_at', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'COLETA', description: 'Data/hora de gravação no banco' }
    ],
    aggregationRules: [
      {
        operation: 'LATEST_SNAPSHOT',
        targetColumn: 'faturamento_mes',
        status: 'ALLOWED',
        reason: 'OBRIGATÓRIO: Selecionar a posição temporal mais recente do período (ORDER BY posicao_hora DESC LIMIT 1).'
      },
      {
        operation: 'SUM',
        targetColumn: 'faturamento_mes',
        status: 'FORBIDDEN',
        reason: 'PROIBIDO: Somar faturamento_mes ao longo do dia duplica/triplica o faturamento acumulado (Cenário T30).'
      },
      {
        operation: 'SUM',
        targetColumn: 'ticket_medio',
        status: 'FORBIDDEN',
        reason: 'PROIBIDO: Somar ou fazer média simples de tickets médios sem ponderação por volume de OS.'
      }
    ],
    oneToManyRelations: []
  },

  faturamento_areas: {
    tableName: 'faturamento_areas',
    displayName: 'Faturamento por Áreas Operacionais',
    description: 'Consolidação contábil do faturamento e custos por área de negócio (ex: OLEO, MECANICA, PNEUS).',
    granularity: 'ONE_ROW_PER_AREA_PERIOD',
    granularityDescription: 'Uma linha por área por loja por período consolidado (data_inicio a data_fim).',
    primaryKey: ['id'],
    scope: 'Lojas operacionais com fechamento contábil de áreas.',
    temporalEvents: [
      {
        eventType: 'FATURAMENTO',
        columnName: 'data_inicio',
        dataType: 'DATE',
        description: 'Início do período contábil de apuração da área.',
        cannotSubstitute: ['ABERTURA', 'FECHAMENTO', 'COLETA']
      },
      {
        eventType: 'FATURAMENTO',
        columnName: 'data_fim',
        dataType: 'DATE',
        description: 'Término do período contábil de apuração da área.',
        cannotSubstitute: ['ABERTURA', 'FECHAMENTO', 'COLETA']
      },
      {
        eventType: 'COLETA',
        columnName: 'created_at',
        dataType: 'DATETIME',
        description: 'Momento da gravação do fechamento contábil no banco.',
        cannotSubstitute: ['FATURAMENTO', 'ABERTURA', 'FECHAMENTO']
      }
    ],
    columns: [
      { name: 'id', dataType: 'INTEGER', isPrimaryKey: true, nullable: false, description: 'ID autoincremento' },
      { name: 'loja_slug', dataType: 'TEXT', isPrimaryKey: false, isForeignKey: true, foreignTable: 'lojas', foreignColumn: 'slug', nullable: false, description: 'Slug da loja' },
      { name: 'data_inicio', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'FATURAMENTO', description: 'Início do período (YYYY-MM-DD)' },
      { name: 'data_fim', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'FATURAMENTO', description: 'Fim do período (YYYY-MM-DD)' },
      { name: 'area', dataType: 'TEXT', isPrimaryKey: false, nullable: false, description: 'Nome da área de negócio (OLEO, FILTROS, SUSPENSAO, etc.)' },
      { name: 'faturamento', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Faturamento bruto da área no período' },
      { name: 'faturamento_percentual', dataType: 'REAL', isPrimaryKey: false, nullable: true, description: 'Representatividade da área no faturamento total' },
      { name: 'desconto', dataType: 'REAL', isPrimaryKey: false, nullable: true, description: 'Total de descontos concedidos' },
      { name: 'custo', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Custo direto das peças/materiais da área' },
      { name: 'cmv_percentual', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'CMV percentual apurado da área' },
      { name: 'lucro_bruto', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Faturamento menos custo' },
      { name: 'lucro_bruto_percentual', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Margem bruta percentual' },
      { name: 'created_at', dataType: 'TEXT', isPrimaryKey: false, nullable: false, temporalRole: 'COLETA', description: 'Data de registro' }
    ],
    aggregationRules: [
      {
        operation: 'SUM',
        targetColumn: 'faturamento',
        status: 'ALLOWED',
        reason: 'Permitido somar faturamento de diferentes áreas dentro do mesmo período contábil.'
      },
      {
        operation: 'AVG_WEIGHTED',
        targetColumn: 'cmv_percentual',
        status: 'ALLOWED',
        reason: 'CMV combinado deve usar fórmula ponderada: (SUM(custo) / SUM(faturamento)) * 100.'
      },
      {
        operation: 'AVG',
        targetColumn: 'cmv_percentual',
        status: 'FORBIDDEN',
        reason: 'PROIBIDO: Média aritmética simples de percentuais de CMV desconsidera volumes financeiros distintos.'
      }
    ],
    oneToManyRelations: []
  },

  itens_pecas: {
    tableName: 'itens_pecas',
    displayName: 'Itens e Peças de Ordem de Serviço',
    description: 'Relação 1:N contendo as peças vinculadas a cada OS.',
    granularity: 'ONE_ROW_PER_OS_PART_ITEM',
    granularityDescription: 'Uma linha por peça associada a uma OS.',
    primaryKey: ['id'],
    scope: 'Ordens de serviço com desmembramento de itens coletado.',
    temporalEvents: [
      {
        eventType: 'COLETA',
        columnName: 'created_at',
        dataType: 'DATETIME',
        description: 'Momento de inserção da peça no banco local.',
        cannotSubstitute: ['ABERTURA', 'FECHAMENTO', 'FATURAMENTO']
      }
    ],
    columns: [
      { name: 'id', dataType: 'TEXT', isPrimaryKey: true, nullable: false, description: 'Identificador único do item de peça' },
      { name: 'os_id', dataType: 'TEXT', isPrimaryKey: false, isForeignKey: true, foreignTable: 'ordens_servico', foreignColumn: 'os_id', nullable: false, description: 'ID da OS pai' },
      { name: 'loja_slug', dataType: 'TEXT', isPrimaryKey: false, isForeignKey: true, foreignTable: 'lojas', foreignColumn: 'slug', nullable: false, description: 'Slug da loja' },
      { name: 'descricao', dataType: 'TEXT', isPrimaryKey: false, nullable: false, description: 'Descrição da peça' },
      { name: 'quantidade', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Quantidade aplicada' },
      { name: 'valor_unitario', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Valor unitário da peça' },
      { name: 'valor_total', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Quantidade x Valor unitário' },
      { name: 'custo_peca', dataType: 'REAL', isPrimaryKey: false, nullable: true, description: 'Custo de aquisição da peça' }
    ],
    aggregationRules: [
      {
        operation: 'SUM',
        targetColumn: 'valor_total',
        status: 'ALLOWED',
        reason: 'Soma total de peças para uma OS pré-agregada.'
      }
    ],
    oneToManyRelations: []
  },

  pagamentos_os: {
    tableName: 'pagamentos_os',
    displayName: 'Pagamentos e Parcelas de OS',
    description: 'Relação 1:N contendo parcelas recebidas para cada OS.',
    granularity: 'ONE_ROW_PER_OS_PAYMENT_INSTALLMENT',
    granularityDescription: 'Uma linha por parcela de pagamento vinculada a uma OS.',
    primaryKey: ['id'],
    scope: 'Ordens de serviço com recebíveis detalhados.',
    temporalEvents: [
      {
        eventType: 'FATURAMENTO',
        columnName: 'data_pagamento',
        dataType: 'DATETIME',
        description: 'Data e hora em que a parcela foi liquidada.',
        cannotSubstitute: ['ABERTURA', 'FECHAMENTO', 'COLETA']
      }
    ],
    columns: [
      { name: 'id', dataType: 'TEXT', isPrimaryKey: true, nullable: false, description: 'Identificador único da parcela de pagamento' },
      { name: 'os_id', dataType: 'TEXT', isPrimaryKey: false, isForeignKey: true, foreignTable: 'ordens_servico', foreignColumn: 'os_id', nullable: false, description: 'ID da OS pai' },
      { name: 'loja_slug', dataType: 'TEXT', isPrimaryKey: false, isForeignKey: true, foreignTable: 'lojas', foreignColumn: 'slug', nullable: false, description: 'Slug da loja' },
      { name: 'valor_parcela', dataType: 'REAL', isPrimaryKey: false, nullable: false, description: 'Valor financeiro liquidado' },
      { name: 'forma_pagamento', dataType: 'TEXT', isPrimaryKey: false, nullable: true, description: 'Forma (PIX, Cartão Crédito, Dinheiro)' },
      { name: 'data_pagamento', dataType: 'TEXT', isPrimaryKey: false, nullable: true, temporalRole: 'FATURAMENTO', description: 'Data do pagamento' }
    ],
    aggregationRules: [
      {
        operation: 'SUM',
        targetColumn: 'valor_parcela',
        status: 'ALLOWED',
        reason: 'Soma do valor liquidado por OS pré-agregada.'
      }
    ],
    oneToManyRelations: []
  }
};

/**
 * Retorna a definição completa de granularidade e metadados de uma tabela.
 */
export function getTableDefinition(tableName: string): TableGranularityDefinition | undefined {
  return DATA_DICTIONARY[tableName];
}

/**
 * Retorna a lista de todas as tabelas catalogadas no dicionário.
 */
export function listCatalogedTables(): string[] {
  return Object.keys(DATA_DICTIONARY);
}

/**
 * Recupera o evento temporal oficial de uma tabela para evitar substituições indevidas.
 */
export function getTemporalEventMapping(
  tableName: string, 
  eventType: TemporalEventType
): TemporalEventMapping | undefined {
  const table = DATA_DICTIONARY[tableName];
  if (!table) return undefined;
  return table.temporalEvents.find(e => e.eventType === eventType);
}

/**
 * Validação rigorosa: Garante que a data de observação/coleta (created_at/updated_at)
 * NUNCA seja utilizada como substituta da data de abertura, fechamento ou faturamento.
 */
export function assertValidTemporalUsage(
  tableName: string,
  targetEvent: TemporalEventType,
  candidateColumn: string
): { isValid: boolean; violationReason?: string } {
  const table = DATA_DICTIONARY[tableName];
  if (!table) {
    return { isValid: false, violationReason: `Tabela '${tableName}' não existe no catálogo.` };
  }

  const mapped = table.temporalEvents.find(e => e.columnName === candidateColumn);
  if (!mapped) {
    return { 
      isValid: false, 
      violationReason: `Coluna '${candidateColumn}' não é um evento temporal mapeado na tabela '${tableName}'.` 
    };
  }

  if (mapped.eventType === 'COLETA' && targetEvent !== 'COLETA') {
    return {
      isValid: false,
      violationReason: `VIOLAÇÃO METODOLÓGICA: A coluna de coleta '${candidateColumn}' (${mapped.description}) ` +
        `não pode substituir o evento de '${targetEvent}' da OS/tabela.`
    };
  }

  if (mapped.eventType !== targetEvent) {
    return {
      isValid: false,
      violationReason: `Incompatibilidade de evento temporal: coluna '${candidateColumn}' representa ` +
        `'${mapped.eventType}', não '${targetEvent}'.`
    };
  }

  return { isValid: true };
}

/**
 * Valida se uma operação de agregação é expressamente permitida ou terminantemente proibida.
 */
export function validateAggregationRule(
  tableName: string,
  operation: AggregationRule['operation'],
  targetColumn?: string
): { isAllowed: boolean; reason: string } {
  const table = DATA_DICTIONARY[tableName];
  if (!table) {
    return { isAllowed: false, reason: `Tabela '${tableName}' não catalogada.` };
  }

  const matchingRule = table.aggregationRules.find(r => 
    r.operation === operation && (!r.targetColumn || r.targetColumn === targetColumn)
  );

  if (matchingRule) {
    return {
      isAllowed: matchingRule.status === 'ALLOWED',
      reason: matchingRule.reason
    };
  }

  // Regra padrão: SUM(DISTINCT) sempre proibido em qualquer tabela
  if (targetColumn && targetColumn.toUpperCase().includes('DISTINCT')) {
    return {
      isAllowed: false,
      reason: 'PROIBIDO: Deduplicação por SUM(DISTINCT) elimina valores idênticos legítimos.'
    };
  }

  return { isAllowed: true, reason: 'Operação padrão permitida.' };
}

/**
 * Detecta se a junção de duas tabelas possui risco de explosão cartesiana 1:N.
 */
export function detectCartesianMultiplicationRisk(
  parentTable: string, 
  childTable: string
): { hasRisk: boolean; recommendedMitigation?: string } {
  const parent = DATA_DICTIONARY[parentTable];
  if (!parent) return { hasRisk: false };

  const rel = parent.oneToManyRelations.find(r => r.childTable === childTable);
  if (rel && rel.cartesianRisk) {
    return {
      hasRisk: true,
      recommendedMitigation: `Relação 1:N detectada entre '${parentTable}' e '${childTable}'. ` +
        `O compilador deve utilizar estratégia '${rel.mitigationStrategy}' para evitar duplicação de totais.`
    };
  }

  return { hasRisk: false };
}
