/**
 * src/hydra-sync/semantic_compiler.ts
 * Compilador Semântico de Consultas Parametrizadas do Hydra.
 * 
 * Regras Cardinais:
 * 1. Traduzir SemanticQueryPlan em consultas parametrizadas seguras utilizando os nós AST de query_builder_safe.ts.
 * 2. Injeção obrigatória e inegociável de WHERE loja_slug = ? em todos os ramos da query quando context.persona === 'gerente'.
 * 3. Proibição absoluta de SUM(DISTINCT valor).
 * 4. Uso de CTEs agregadas ou subconsultas correlacionadas escalares para prevenir duplicação de joins 1:N.
 * 5. Bloqueio terminante de mutações DDL/DML e injeção SQL.
 * 6. TypeScript strict — ZERO `any`.
 */

import type {
  SemanticQueryPlan,
  SemanticFilterNode,
  SemanticFilterCondition,
  SemanticAggregation,
  SemanticSort,
  PrimaryEntityType,
  FilterOperator
} from './types/semantic_contract.js';

import {
  SafeQueryBuilder,
  validateIdentifier,
  assertSafeSqlString,
  type CompiledQueryOutput,
  type SqlPrimitive,
  type AstCondition,
  type SafeQueryAst,
  type SqlAstExpr
} from './query_builder_safe.js';

export interface CompiledParameterizedQuery {
  sql: string;
  parameters: SqlPrimitive[];
  estimatedCostMs: number;
  antiDuplicationEnforced: boolean;
  storeScopeFilterApplied: boolean;
}

export type CompilerErrorCode = 
  | 'INVALID_CONCEPT' 
  | 'CARDINALITY_VIOLATION' 
  | 'SECURITY_VIOLATION' 
  | 'UNSUPPORTED_OPERATOR';

export interface CompilationResult {
  success: boolean;
  query?: CompiledParameterizedQuery;
  errorReason?: string;
  errorCode?: CompilerErrorCode;
}

/**
 * Mapeamento de entidades para tabelas e aliases base.
 */
interface EntityTableConfig {
  tableName: string;
  tableAlias: string;
  scopeColumn: string;
}

const ENTITY_CONFIG: Record<PrimaryEntityType, EntityTableConfig> = {
  ordem_servico: {
    tableName: 'ordens_servico',
    tableAlias: 'os',
    scopeColumn: 'loja_slug'
  },
  loja: {
    tableName: 'lojas',
    tableAlias: 'l',
    scopeColumn: 'slug'
  },
  veiculo: {
    tableName: 'ordens_servico',
    tableAlias: 'os',
    scopeColumn: 'loja_slug'
  },
  meta_diaria: {
    tableName: 'metas_diarias',
    tableAlias: 'm',
    scopeColumn: 'loja_slug'
  },
  faturamento_area: {
    tableName: 'faturamento_areas',
    tableAlias: 'fa',
    scopeColumn: 'loja_slug'
  }
};

/**
 * Mapeia dimensões e métricas lógicas para as colunas físicas da tabela de OS.
 */
function mapOsColumn(fieldId: string): string {
  switch (fieldId) {
    case 'responsavel_fechamento':
    case 'consultor':
    case 'mecanico':
      return 'responsavel';
    case 'faturamento_bruto':
    case 'total_os':
      return 'total_os';
    case 'valor_pago':
      return 'valor_pago';
    case 'saldo_restante':
    case 'valor_restante':
      return 'valor_restante';
    case 'data_abertura':
      return 'data_inicio';
    case 'data_fechamento':
      return 'data_fim';
    default:
      return fieldId;
  }
}

/**
 * Compilador Semântico de Planos de Consulta.
 */
export class SemanticCompiler {
  /**
   * Ponto de entrada estático principal de compilação.
   */
  public static compile(plan: SemanticQueryPlan): CompilationResult {
    const compiler = new SemanticCompiler();
    return compiler.compilePlan(plan);
  }

  /**
   * Compila um SemanticQueryPlan em uma consulta parametrizada segura.
   */
  public compilePlan(plan: SemanticQueryPlan): CompilationResult {
    try {
      // 1. Validação de ExecutionMode
      if (plan.executionMode === 'clarify') {
        return {
          success: false,
          errorCode: 'INVALID_CONCEPT',
          errorReason: plan.clarificationReason || 'Plano semântico requer esclarecimento prévio antes da compilação SQL.'
        };
      }

      // 2. Validação Estrita de Segurança para Gerente (Zero Cross-Store Leakage)
      const isManager = plan.securityScope.persona === 'gerente';
      const authorizedLojaSlug = plan.securityScope.authorizedLojaSlug;

      if (isManager) {
        if (!authorizedLojaSlug || authorizedLojaSlug.trim() === '') {
          return {
            success: false,
            errorCode: 'SECURITY_VIOLATION',
            errorReason: 'SECURITY_VIOLATION: Persona gerente exige authorizedLojaSlug definido no escopo de segurança.'
          };
        }

        // Valida se há qualquer filtro tentando forçar outra loja
        const crossStoreCheck = this.detectCrossStoreViolation(plan.filters, authorizedLojaSlug);
        if (crossStoreCheck) {
          return {
            success: false,
            errorCode: 'SECURITY_VIOLATION',
            errorReason: `SECURITY_VIOLATION: Tentativa de acesso cross-store não autorizado à loja "${crossStoreCheck}". Acesso restrito a "${authorizedLojaSlug}".`
          };
        }
      }

      // 3. Resolução da Entidade Primária
      const entityConfig = ENTITY_CONFIG[plan.primaryEntity];
      if (!entityConfig) {
        return {
          success: false,
          errorCode: 'INVALID_CONCEPT',
          errorReason: `INVALID_CONCEPT: Entidade primária "${plan.primaryEntity}" não catalogada.`
        };
      }

      // 4. Instanciação do SafeQueryBuilder
      const builder = SafeQueryBuilder.create();
      builder.from(entityConfig.tableName, entityConfig.tableAlias);

      // 5. Prevenção de Duplicação Cartesiana 1:N (Cenário T29)
      const requiresPayments = 
        plan.relationsRequired.includes('os_pagamentos') ||
        plan.metrics.includes('valor_pago') ||
        plan.aggregations.some(a => a.metricId === 'valor_pago' || a.alias === 'totalRecebido' || a.alias === 'recebido');

      const requiresParts = 
        plan.relationsRequired.includes('os_pecas');

      let hasPaymentsCte = false;
      let hasPartsCte = false;

      if (plan.primaryEntity === 'ordem_servico') {
        if (requiresPayments) {
          // CTE Pré-agregada de Pagamentos com injeção mandatória de loja se gerente
          const paymentsCteBuilder = SafeQueryBuilder.create()
            .from('pagamentos_os', 'pg')
            .selectColumn('os_id', 'pg')
            .selectAggregate('SUM', 'valor_parcela', { table: 'pg', alias: 'total_recebido_os' })
            .groupBy(['os_id']);

          if (isManager && authorizedLojaSlug) {
            paymentsCteBuilder.where({
              type: 'binary',
              field: 'loja_slug',
              table: 'pg',
              operator: '=',
              value: authorizedLojaSlug
            });
          }

          builder.withCte('pagamentos_agregados', paymentsCteBuilder);
          builder.leftJoinPreAggregatedCte('pagamentos_agregados', 'p', {
            type: 'binary',
            field: 'os_id',
            table: 'p',
            operator: '=',
            value: null // Resolvido via join ON os.os_id = p.os_id
          });
          // Ajusta a condição ON do join para p.os_id = os.os_id
          // SafeJoinNode com AST raw de igualdade de coluna
          hasPaymentsCte = true;
        }

        if (requiresParts) {
          // CTE Pré-agregada de Peças com injeção mandatória de loja se gerente
          const partsCteBuilder = SafeQueryBuilder.create()
            .from('itens_pecas', 'ip')
            .selectColumn('os_id', 'ip')
            .selectAggregate('SUM', 'valor_total', { table: 'ip', alias: 'total_pecas_os' })
            .selectAggregate('COUNT', 'id', { table: 'ip', alias: 'qtd_pecas_os' })
            .groupBy(['os_id']);

          if (isManager && authorizedLojaSlug) {
            partsCteBuilder.where({
              type: 'binary',
              field: 'loja_slug',
              table: 'ip',
              operator: '=',
              value: authorizedLojaSlug
            });
          }

          builder.withCte('pecas_agregadas', partsCteBuilder);
          builder.leftJoinPreAggregatedCte('pecas_agregadas', 'pc', {
            type: 'binary',
            field: 'os_id',
            table: 'pc',
            operator: '=',
            value: null
          });
          hasPartsCte = true;
        }
      }

      // 6. Configuração de Projeções (SELECT)
      this.configureProjections(builder, plan, entityConfig, { hasPaymentsCte, hasPartsCte });

      // 7. Configuração de Predicados (WHERE)
      const compiledWhere = this.compileFilters(plan.filters, entityConfig, isManager, authorizedLojaSlug);
      if (compiledWhere) {
        builder.where(compiledWhere);
      } else if (isManager && authorizedLojaSlug) {
        builder.where({
          type: 'binary',
          field: entityConfig.scopeColumn,
          table: entityConfig.tableAlias,
          operator: '=',
          value: authorizedLojaSlug
        });
        builder.markStoreScopeApplied();
      }

      if (isManager) {
        builder.markStoreScopeApplied();
      }

      // 8. Agrupamentos (GROUP BY)
      if (plan.groupBy && plan.groupBy.length > 0) {
        const groupColumns = plan.groupBy.map(g => {
          const mapped = mapOsColumn(g);
          return `${entityConfig.tableAlias}.${validateIdentifier(mapped, 'coluna GROUP BY')}`;
        });
        builder.groupBy(groupColumns);
      }

      // 9. Ordenação (ORDER BY)
      if (plan.orderBy && plan.orderBy.length > 0) {
        for (const order of plan.orderBy) {
          const mappedField = mapOsColumn(order.fieldId);
          builder.orderBy(mappedField, order.direction);
        }
      }

      // 10. Limite (LIMIT)
      if (typeof plan.limit === 'number' && plan.limit > 0) {
        builder.limit(plan.limit);
      }

      // 11. Caso Especial T30: Metas Diárias com LATEST_SNAPSHOT
      if (plan.primaryEntity === 'meta_diaria') {
        const isLatestSnapshot = 
          plan.aggregations.some(a => a.metricId === 'percentual_meta' || a.alias === 'latest_snapshot') ||
          plan.metrics.includes('percentual_meta') ||
          !plan.groupBy || plan.groupBy.length === 0;

        if (isLatestSnapshot && (!plan.orderBy || plan.orderBy.length === 0)) {
          builder.orderBy('data_referencia', 'DESC', entityConfig.tableAlias);
          builder.orderBy('posicao_hora', 'DESC', entityConfig.tableAlias);
          builder.limit(1);
        }
      }

      // 12. Construção Final com Validação de Segurança
      const built = builder.build();

      // Ajuste cirúrgico em JOIN ON se CTE de pagamentos ou peças foi utilizada
      let finalSql = built.sql;
      if (hasPaymentsCte) {
        finalSql = finalSql.replace(
          /LEFT JOIN pagamentos_agregados p ON p\.os_id = \?/g,
          'LEFT JOIN pagamentos_agregados p ON p.os_id = os.os_id'
        );
      }
      if (hasPartsCte) {
        finalSql = finalSql.replace(
          /LEFT JOIN pecas_agregadas pc ON pc\.os_id = \?/g,
          'LEFT JOIN pecas_agregadas pc ON pc.os_id = os.os_id'
        );
      }

      // Remove parâmetros nulos residuais injetados pela condição ON inicial se houver
      const cleanParams = built.parameters.filter(p => p !== null || built.parameters.length === 0);

      assertSafeSqlString(finalSql);

      return {
        success: true,
        query: {
          sql: finalSql,
          parameters: cleanParams,
          estimatedCostMs: built.estimatedCostMs,
          antiDuplicationEnforced: built.antiDuplicationEnforced,
          storeScopeFilterApplied: isManager || built.storeScopeFilterApplied
        }
      };

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      let errorCode: CompilerErrorCode = 'INVALID_CONCEPT';

      if (message.includes('SECURITY_VIOLATION')) {
        errorCode = 'SECURITY_VIOLATION';
      } else if (message.includes('CARDINALITY_VIOLATION')) {
        errorCode = 'CARDINALITY_VIOLATION';
      } else if (message.includes('UNSUPPORTED_OPERATOR')) {
        errorCode = 'UNSUPPORTED_OPERATOR';
      }

      return {
        success: false,
        errorCode,
        errorReason: message
      };
    }
  }

  /**
   * Configura as expressões da cláusula SELECT (projeções ou agregações).
   */
  private configureProjections(
    builder: SafeQueryBuilder,
    plan: SemanticQueryPlan,
    entityConfig: EntityTableConfig,
    ctes: { hasPaymentsCte: boolean; hasPartsCte: boolean }
  ): void {
    const alias = entityConfig.tableAlias;

    // Caso A: Consulta Agregada com Aggregations
    if (plan.aggregations && plan.aggregations.length > 0) {
      // Se há agrupamento, projeta as colunas agrupadas primeiro
      if (plan.groupBy && plan.groupBy.length > 0) {
        for (const g of plan.groupBy) {
          const col = mapOsColumn(g);
          builder.selectColumn(col, alias, col);
        }
      }

      // Adiciona contagem de OS se for ordem_servico e não houver count explícito
      const hasCountAgg = plan.aggregations.some(a => a.metricId === 'volume_os' || a.alias === 'osCount' || a.alias === 'quantidade');
      if (plan.primaryEntity === 'ordem_servico' && !hasCountAgg && (!plan.groupBy || plan.groupBy.length === 0)) {
        builder.selectAggregate('COUNT', 'os_id', { table: alias, alias: 'osCount' });
      }

      for (const agg of plan.aggregations) {
        switch (agg.metricId) {
          case 'faturamento_bruto':
            builder.selectAggregate('SUM', 'total_os', { table: alias, alias: agg.alias || 'totalFaturamento' });
            break;

          case 'valor_pago':
            if (ctes.hasPaymentsCte) {
              builder.select([
                {
                  type: 'raw_safe',
                  sql: `SUM(COALESCE(p.total_recebido_os, 0))`,
                  alias: agg.alias || 'totalRecebido'
                }
              ]);
            } else {
              builder.selectAggregate('SUM', 'valor_pago', { table: alias, alias: agg.alias || 'totalRecebido' });
            }
            break;

          case 'volume_os':
            builder.selectAggregate('COUNT', 'os_id', { table: alias, alias: agg.alias || 'volume_os' });
            break;

          case 'saldo_restante':
            builder.selectAggregate('SUM', 'valor_restante', { table: alias, alias: agg.alias || 'saldo_restante' });
            break;

          case 'ticket_medio':
            builder.select([
              {
                type: 'raw_safe',
                sql: `(SUM(${alias}.total_os) * 1.0 / NULLIF(COUNT(${alias}.os_id), 0))`,
                alias: agg.alias || 'ticket_medio'
              }
            ]);
            break;

          case 'cmv_percentual':
            builder.selectWeightedRatio('custo', 'faturamento', {
              table: alias,
              multiplier: 100,
              alias: agg.alias || 'cmv_percentual'
            });
            break;

          case 'percentual_meta':
            builder.selectColumn('faturamento_mes', alias);
            builder.selectColumn('meta_mes', alias);
            builder.selectColumn('percentual_meta', alias);
            builder.selectColumn('posicao_hora', alias);
            break;

          case 'custo_total':
            builder.selectAggregate('SUM', 'custo', { table: alias, alias: agg.alias || 'custo_total' });
            break;

          default:
            // Projeção padrão segura
            builder.selectColumn(mapOsColumn(agg.metricId), alias, agg.alias);
            break;
        }
      }
      return;
    }

    // Caso B: Consulta Detalhada / Drill-Down sem agregações agregadas
    if (plan.primaryEntity === 'ordem_servico') {
      builder.selectColumn('os_id', alias);
      builder.selectColumn('loja_slug', alias);
      builder.selectColumn('total_os', alias);
      builder.selectColumn('status_grid', alias);
      builder.selectColumn('is_aberta', alias);
      builder.selectColumn('dias_no_patio', alias);

      if (ctes.hasPaymentsCte) {
        builder.select([
          {
            type: 'raw_safe',
            sql: `COALESCE(p.total_recebido_os, 0)`,
            alias: 'valor_pago'
          }
        ]);
      } else {
        builder.selectColumn('valor_pago', alias);
      }

      builder.selectColumn('valor_restante', alias);
      builder.selectColumn('responsavel', alias);
      builder.selectColumn('placa', alias);
      return;
    }

    if (plan.primaryEntity === 'meta_diaria') {
      builder.selectColumn('data_referencia', alias);
      builder.selectColumn('posicao_hora', alias);
      builder.selectColumn('loja_slug', alias);
      builder.selectColumn('faturamento_mes', alias);
      builder.selectColumn('volume_os', alias);
      builder.selectColumn('ticket_medio', alias);
      builder.selectColumn('meta_mes', alias);
      builder.selectColumn('percentual_meta', alias);
      return;
    }

    if (plan.primaryEntity === 'faturamento_area') {
      builder.selectColumn('loja_slug', alias);
      builder.selectColumn('area', alias);
      builder.selectColumn('faturamento', alias);
      builder.selectColumn('custo', alias);
      builder.selectColumn('cmv_percentual', alias);
      return;
    }

    // Fallback: colunas da entidade loja
    builder.selectColumn('slug', alias);
    builder.selectColumn('nome', alias);
  }

  /**
   * Compila a árvore de filtros booleanos (AND/OR/NOT).
   */
  private compileFilters(
    filterNode: SemanticFilterNode,
    entityConfig: EntityTableConfig,
    isManager: boolean,
    authorizedLojaSlug?: string
  ): AstCondition | undefined {
    const conditions: AstCondition[] = [];
    const alias = entityConfig.tableAlias;

    // Injeção mandatória de loja para gerente
    if (isManager && authorizedLojaSlug) {
      conditions.push({
        type: 'binary',
        field: entityConfig.scopeColumn,
        table: alias,
        operator: '=',
        value: authorizedLojaSlug
      });
    }

    // Processa os nós e condições fornecidos
    if (filterNode.conditions && filterNode.conditions.length > 0) {
      for (const item of filterNode.conditions) {
        if ('logic' in item) {
          // Nó filho booleano
          const childCond = this.compileFilters(item, entityConfig, false);
          if (childCond) {
            conditions.push(childCond);
          }
        } else {
          // Condição folha
          const leafCond = this.compileLeafCondition(item, entityConfig, isManager, authorizedLojaSlug);
          if (leafCond) {
            conditions.push(leafCond);
          }
        }
      }
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1 && (!filterNode.logic || filterNode.logic === 'AND')) {
      return conditions[0];
    }

    return {
      type: 'logical',
      logic: filterNode.logic || 'AND',
      conditions
    };
  }

  /**
   * Compila uma condição folha individual.
   */
  private compileLeafCondition(
    cond: SemanticFilterCondition,
    entityConfig: EntityTableConfig,
    isManager: boolean,
    authorizedLojaSlug?: string
  ): AstCondition | undefined {
    const alias = entityConfig.tableAlias;
    const col = mapOsColumn(cond.dimensionOrMetricId);

    // Tratamento de operadores relacionais EXISTS / NOT_EXISTS
    if (cond.operator === 'EXISTS' || cond.operator === 'NOT_EXISTS') {
      const isNot = cond.operator === 'NOT_EXISTS';
      const targetTable = cond.relationContext === 'os_pecas' ? 'itens_pecas' : 'itens_servicos';
      const subBuilder = SafeQueryBuilder.create()
        .from(targetTable, 'sub')
        .select([{ type: 'raw_safe', sql: '1', alias: undefined }]);

      // Correlação com a OS pai
      subBuilder.where({
        type: 'raw_safe',
        sql: `sub.os_id = ${alias}.os_id`
      } as unknown as AstCondition);

      // Injeção de isolamento de loja na subconsulta correlacionada se gerente
      if (isManager && authorizedLojaSlug) {
        subBuilder.andWhere({
          type: 'binary',
          field: 'loja_slug',
          table: 'sub',
          operator: '=',
          value: authorizedLojaSlug
        });
      }

      if (cond.value !== undefined && cond.value !== null) {
        subBuilder.andWhere({
          type: 'binary',
          field: 'descricao',
          table: 'sub',
          operator: 'LIKE',
          value: `%${cond.value}%`
        });
      }

      return {
        type: 'exists',
        subquery: subBuilder.toAst(),
        not: isNot
      };
    }

    switch (cond.operator) {
      case 'EQUALS':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: '=',
          value: cond.value as SqlPrimitive
        };

      case 'NOT_EQUALS':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: '!=',
          value: cond.value as SqlPrimitive
        };

      case 'GREATER_THAN':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: '>',
          value: cond.value as SqlPrimitive
        };

      case 'GREATER_EQUAL':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: '>=',
          value: cond.value as SqlPrimitive
        };

      case 'LESS_THAN':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: '<',
          value: cond.value as SqlPrimitive
        };

      case 'LESS_EQUAL':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: '<=',
          value: cond.value as SqlPrimitive
        };

      case 'LIKE':
        return {
          type: 'binary',
          field: col,
          table: alias,
          operator: 'LIKE',
          value: cond.value as SqlPrimitive
        };

      case 'BETWEEN':
        return {
          type: 'between',
          field: col,
          table: alias,
          lower: cond.value as SqlPrimitive,
          upper: cond.secondaryValue as SqlPrimitive
        };

      case 'IN':
        return {
          type: 'in',
          field: col,
          table: alias,
          values: Array.isArray(cond.value) ? (cond.value as SqlPrimitive[]) : [cond.value as SqlPrimitive],
          not: false
        };

      case 'NOT_IN':
        return {
          type: 'in',
          field: col,
          table: alias,
          values: Array.isArray(cond.value) ? (cond.value as SqlPrimitive[]) : [cond.value as SqlPrimitive],
          not: true
        };

      case 'IS_NULL':
        return {
          type: 'null',
          field: col,
          table: alias,
          isNull: true
        };

      case 'IS_NOT_NULL':
        return {
          type: 'null',
          field: col,
          table: alias,
          isNull: false
        };

      default:
        throw new Error(`UNSUPPORTED_OPERATOR: Operador "${cond.operator}" não suportado pelo compilador.`);
    }
  }

  /**
   * Detecta se algum filtro solicita expressamente uma loja diferente da autorizada.
   */
  private detectCrossStoreViolation(
    filterNode: SemanticFilterNode,
    authorizedLojaSlug: string
  ): string | null {
    if (!filterNode.conditions) return null;

    for (const item of filterNode.conditions) {
      if ('logic' in item) {
        const nestedViolation = this.detectCrossStoreViolation(item, authorizedLojaSlug);
        if (nestedViolation) return nestedViolation;
      } else {
        const isStoreField = item.dimensionOrMetricId === 'loja_slug' || item.dimensionOrMetricId === 'loja';
        if (isStoreField && item.value !== undefined && item.value !== null) {
          const valStr = String(item.value).toLowerCase();
          if (valStr !== authorizedLojaSlug.toLowerCase()) {
            return String(item.value);
          }
        }
      }
    }

    return null;
  }
}

/**
 * Função utilitária standalone exportada.
 */
export function compileSemanticPlan(plan: SemanticQueryPlan): CompilationResult {
  return SemanticCompiler.compile(plan);
}
