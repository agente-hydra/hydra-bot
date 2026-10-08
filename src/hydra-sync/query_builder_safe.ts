/**
 * src/hydra-sync/query_builder_safe.ts
 * Construtor Seguro de SQL Parametrizado baseado em nós AST (Frente 3 — Executor 3).
 * 
 * Regras Cardinais:
 * 1. Prevenção absoluta de duplicação cartesiana 1:N (CTEs pré-agregadas ou subconsultas correlacionadas).
 * 2. Proibição terminante de SUM(DISTINCT valor) para evitar corrupção por colisão de valores iguais.
 * 3. Bloqueio irrestrito de qualquer mutação DDL/DML (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE).
 * 4. 100% parametrizado com '?' (Zero interpolação de strings em predicados).
 * 5. TypeScript strict — Zero `any`.
 */

export type SqlPrimitive = string | number | boolean | null;

export type AggregateFunction = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';

export interface ColumnRef {
  type: 'column';
  table?: string;
  name: string;
  alias?: string;
}

export interface AggregateExpr {
  type: 'aggregate';
  fn: AggregateFunction;
  column: string;
  table?: string;
  distinct?: boolean;
  alias?: string;
}

export interface ScalarSubqueryExpr {
  type: 'scalar_subquery';
  subquery: SafeQueryAst;
  alias?: string;
}

export interface CoalesceExpr {
  type: 'coalesce';
  expr: SqlAstExpr;
  fallback: SqlPrimitive | ColumnRef;
  alias?: string;
}

export interface WeightedRatioExpr {
  type: 'weighted_ratio';
  numeratorColumn: string;
  denominatorColumn: string;
  table?: string;
  multiplier?: number; // Ex: 100 para percentual
  alias?: string;
}

export interface RawSafeExpr {
  type: 'raw_safe';
  sql: string;
  alias?: string;
}

export type SqlAstExpr = 
  | ColumnRef 
  | AggregateExpr 
  | ScalarSubqueryExpr 
  | CoalesceExpr 
  | WeightedRatioExpr 
  | RawSafeExpr;

export interface BinaryCondition {
  type: 'binary';
  field: string;
  table?: string;
  operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE';
  value: SqlPrimitive;
}

export interface InCondition {
  type: 'in';
  field: string;
  table?: string;
  values: SqlPrimitive[];
  not?: boolean;
}

export interface BetweenCondition {
  type: 'between';
  field: string;
  table?: string;
  lower: SqlPrimitive;
  upper: SqlPrimitive;
}

export interface NullCondition {
  type: 'null';
  field: string;
  table?: string;
  isNull: boolean; // true: IS NULL, false: IS NOT NULL
}

export interface ExistsCondition {
  type: 'exists';
  subquery: SafeQueryAst;
  not?: boolean;
}

export interface LogicalGroupCondition {
  type: 'logical';
  logic: 'AND' | 'OR' | 'NOT';
  conditions: AstCondition[];
}

export type AstCondition = 
  | BinaryCondition 
  | InCondition 
  | BetweenCondition 
  | NullCondition 
  | ExistsCondition 
  | LogicalGroupCondition;

export interface CteDefinition {
  name: string;
  query: SafeQueryAst;
}

export interface FromTable {
  name: string;
  alias?: string;
}

export interface SafeJoinNode {
  type: 'LEFT' | 'INNER';
  target: 
    | { type: 'table'; name: string }
    | { type: 'cte'; name: string }
    | { type: 'subquery'; query: SafeQueryAst };
  alias: string;
  on: AstCondition;
  multiplicationRisk?: boolean; // Se true, o alvo DEVE ser CTE agregada ou subquery
  isPreAggregated?: boolean;
}

export interface OrderByNode {
  field: string;
  table?: string;
  direction: 'ASC' | 'DESC';
}

export interface SafeQueryAst {
  ctes?: CteDefinition[];
  select: SqlAstExpr[];
  from: FromTable;
  joins?: SafeJoinNode[];
  where?: AstCondition;
  groupBy?: (ColumnRef | string)[];
  having?: AstCondition;
  orderBy?: OrderByNode[];
  limit?: number;
  offset?: number;
}

export interface CompiledQueryOutput {
  sql: string;
  parameters: SqlPrimitive[];
  antiDuplicationEnforced: boolean;
  storeScopeFilterApplied: boolean;
  estimatedCostMs: number;
}

// Lista negra estrita de palavras e padrões proibidos contra DDL/DML e injeção
const FORBIDDEN_SQL_MUTATION_REGEX = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|EXEC|EXECUTE)\b/i;
const SQL_INJECTION_TOKENS_REGEX = /(--|\/\*|\*\/|;)/;
const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Valida rigorosamente identificadores (tabelas, colunas, aliases).
 * Bloqueia qualquer caractere especial, espaço ou tentativa de injeção.
 */
export function validateIdentifier(identifier: string, context = 'identificador'): string {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error(`SECURITY_VIOLATION: ${context} inválido ou vazio.`);
  }
  const trimmed = identifier.trim();
  if (!SAFE_IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(`SECURITY_VIOLATION: ${context} "${identifier}" contém caracteres inválidos ou maliciosos.`);
  }
  if (FORBIDDEN_SQL_MUTATION_REGEX.test(trimmed)) {
    throw new Error(`SECURITY_VIOLATION: ${context} "${identifier}" contém palavra-chave de mutação bloqueada.`);
  }
  return trimmed;
}

/**
 * Validação terminante de segurança: bloqueia DDL/DML e tokens de escape de SQL.
 */
export function assertSafeSqlString(sql: string): void {
  if (FORBIDDEN_SQL_MUTATION_REGEX.test(sql)) {
    throw new Error('SECURITY_VIOLATION: DDL e DML são estritamente bloqueados. Apenas consultas SELECT são permitidas.');
  }
  const sqlWithoutTrailingSemicolon = sql.trim().replace(/;$/, '');
  if (SQL_INJECTION_TOKENS_REGEX.test(sqlWithoutTrailingSemicolon)) {
    throw new Error('SECURITY_VIOLATION: Caracteres de terminação ou comentários SQL (;, --, /*) são estritamente proibidos.');
  }
}

/**
 * Compila uma expressão individual do AST, validando regras de agregação e prevenção de corrupção.
 */
function compileExpr(
  expr: SqlAstExpr,
  params: SqlPrimitive[]
): string {
  switch (expr.type) {
    case 'column': {
      const col = validateIdentifier(expr.name, 'coluna');
      const tablePrefix = expr.table ? `${validateIdentifier(expr.table, 'tabela')}.` : '';
      const alias = expr.alias ? ` AS ${validateIdentifier(expr.alias, 'alias')}` : '';
      return `${tablePrefix}${col}${alias}`;
    }

    case 'aggregate': {
      // REGRA MANDATÓRIA 2: Proibição terminante de SUM(DISTINCT)
      if (expr.fn === 'SUM' && expr.distinct === true) {
        throw new Error(
          'CARDINALITY_VIOLATION: SUM(DISTINCT) é expressamente proibido no Hydra. ' +
          'A deduplicação por valor corrompe dados reais quando duas entidades possuem valores idênticos (Cenário T29).'
        );
      }

      const col = expr.column === '*' ? '*' : validateIdentifier(expr.column, 'coluna');
      const tablePrefix = expr.table && col !== '*' ? `${validateIdentifier(expr.table, 'tabela')}.` : '';
      const distinctStr = expr.distinct ? 'DISTINCT ' : '';
      const alias = expr.alias ? ` AS ${validateIdentifier(expr.alias, 'alias')}` : '';
      return `${expr.fn}(${distinctStr}${tablePrefix}${col})${alias}`;
    }

    case 'weighted_ratio': {
      // REGRA MANDATÓRIA 3: Ponderação obrigatória para índices (SUM(num) / NULLIF(SUM(den), 0))
      const numCol = validateIdentifier(expr.numeratorColumn, 'coluna numerador');
      const denCol = validateIdentifier(expr.denominatorColumn, 'coluna denominador');
      const tablePrefix = expr.table ? `${validateIdentifier(expr.table, 'tabela')}.` : '';
      const mult = expr.multiplier && expr.multiplier !== 1 ? ` * ${Number(expr.multiplier)}` : '';
      const alias = expr.alias ? ` AS ${validateIdentifier(expr.alias, 'alias')}` : '';
      return `(SUM(${tablePrefix}${numCol}) * 1.0 / NULLIF(SUM(${tablePrefix}${denCol}), 0))${mult}${alias}`;
    }

function isColumnRef(val: SqlPrimitive | ColumnRef): val is ColumnRef {
  return typeof val === 'object' && val !== null && 'type' in val && val.type === 'column';
}

    case 'coalesce': {
      const inner = compileExpr(expr.expr, params);
      let fallbackStr = '0';
      if (isColumnRef(expr.fallback)) {
        fallbackStr = compileExpr(expr.fallback, params);
      } else {
        fallbackStr = '?';
        params.push(expr.fallback);
      }
      const alias = expr.alias ? ` AS ${validateIdentifier(expr.alias, 'alias')}` : '';
      return `COALESCE(${inner}, ${fallbackStr})${alias}`;
    }

    case 'scalar_subquery': {
      const compiledSub = compileSafeAst(expr.subquery, params, true);
      const alias = expr.alias ? ` AS ${validateIdentifier(expr.alias, 'alias')}` : '';
      return `(${compiledSub})${alias}`;
    }

    case 'raw_safe': {
      assertSafeSqlString(expr.sql);
      if (/SUM\s*\(\s*DISTINCT\b/i.test(expr.sql)) {
        throw new Error('CARDINALITY_VIOLATION: SUM(DISTINCT) detectado em expressão SQL livre. Operação terminantemente proibida.');
      }
      const alias = expr.alias ? ` AS ${validateIdentifier(expr.alias, 'alias')}` : '';
      return `${expr.sql}${alias}`;
    }

    default:
      throw new Error(`INVALID_CONCEPT: Tipo de expressão AST desconhecido.`);
  }
}

/**
 * Compila nós de condição WHERE com tratamento de precedência booleana (AND/OR/NOT).
 */
function compileCondition(
  cond: AstCondition,
  params: SqlPrimitive[]
): string {
  switch (cond.type) {
    case 'binary': {
      const field = validateIdentifier(cond.field, 'campo de condição');
      const tablePrefix = cond.table ? `${validateIdentifier(cond.table, 'tabela')}.` : '';
      const op = cond.operator;
      params.push(cond.value);
      return `${tablePrefix}${field} ${op} ?`;
    }

    case 'in': {
      const field = validateIdentifier(cond.field, 'campo de condição IN');
      const tablePrefix = cond.table ? `${validateIdentifier(cond.table, 'tabela')}.` : '';
      if (!cond.values || cond.values.length === 0) {
        // IN vazio: 1 = 0 (falso determinístico)
        return cond.not ? '1 = 1' : '1 = 0';
      }
      const placeholders = cond.values.map(() => '?').join(', ');
      params.push(...cond.values);
      const notStr = cond.not ? 'NOT IN' : 'IN';
      return `${tablePrefix}${field} ${notStr} (${placeholders})`;
    }

    case 'between': {
      const field = validateIdentifier(cond.field, 'campo BETWEEN');
      const tablePrefix = cond.table ? `${validateIdentifier(cond.table, 'tabela')}.` : '';
      params.push(cond.lower, cond.upper);
      return `${tablePrefix}${field} BETWEEN ? AND ?`;
    }

    case 'null': {
      const field = validateIdentifier(cond.field, 'campo NULL');
      const tablePrefix = cond.table ? `${validateIdentifier(cond.table, 'tabela')}.` : '';
      return `${tablePrefix}${field} ${cond.isNull ? 'IS NULL' : 'IS NOT NULL'}`;
    }

    case 'exists': {
      const sub = compileSafeAst(cond.subquery, params, true);
      const notStr = cond.not ? 'NOT EXISTS' : 'EXISTS';
      return `${notStr} (${sub})`;
    }

    case 'logical': {
      if (!cond.conditions || cond.conditions.length === 0) {
        return '1 = 1';
      }

      if (cond.logic === 'NOT') {
        const inner = compileCondition(cond.conditions[0], params);
        return `NOT (${inner})`;
      }

      const compiledParts = cond.conditions.map(c => compileCondition(c, params));
      const glue = ` ${cond.logic} `;
      return `(${compiledParts.join(glue)})`;
    }

    default:
      throw new Error(`UNSUPPORTED_OPERATOR: Condição AST não suportada.`);
  }
}

/**
 * Compilador central de AST Seguro para SQL SQLite WAL.
 */
export function compileSafeAst(
  ast: SafeQueryAst,
  externalParams?: SqlPrimitive[],
  isSubquery = false
): string {
  const params: SqlPrimitive[] = externalParams ?? [];
  let antiDuplicationEnforced = false;

  // 1. Cláusulas CTE (WITH ...)
  const cteParts: string[] = [];
  if (ast.ctes && ast.ctes.length > 0) {
    for (const cte of ast.ctes) {
      const cteName = validateIdentifier(cte.name, 'nome da CTE');
      const cteSql = compileSafeAst(cte.query, params, true);
      cteParts.push(`${cteName} AS (\n  ${cteSql}\n)`);
      antiDuplicationEnforced = true;
    }
  }

  const withClause = cteParts.length > 0 ? `WITH ${cteParts.join(',\n')}\n` : '';

  // 2. SELECT
  if (!ast.select || ast.select.length === 0) {
    throw new Error('INVALID_CONCEPT: Consulta AST requer ao menos uma projeção no SELECT.');
  }
  const selectParts = ast.select.map(expr => compileExpr(expr, params));
  const selectClause = `SELECT\n  ${selectParts.join(',\n  ')}`;

  // 3. FROM
  const fromTable = validateIdentifier(ast.from.name, 'tabela FROM');
  const fromAlias = ast.from.alias ? ` ${validateIdentifier(ast.from.alias, 'alias FROM')}` : '';
  const fromClause = `\nFROM ${fromTable}${fromAlias}`;

  // 4. JOINS
  const joinParts: string[] = [];
  if (ast.joins && ast.joins.length > 0) {
    for (const join of ast.joins) {
      // REGRA MANDATÓRIA 1: Prevenção de duplicação cartesiana 1:N
      if (join.multiplicationRisk && join.target.type === 'table' && !join.isPreAggregated) {
        throw new Error(
          `CARDINALITY_VIOLATION: Junção 1:N direta com a tabela "${join.target.name}" é proibida. ` +
          `Multiplica registros e distorce faturamento/saldos. Use CTE pré-agregada ou subconsulta correlacionada.`
        );
      }

      let targetSql = '';
      if (join.target.type === 'table' || join.target.type === 'cte') {
        targetSql = validateIdentifier(join.target.name, 'alvo do JOIN');
      } else {
        const sub = compileSafeAst(join.target.query, params, true);
        targetSql = `(\n  ${sub}\n)`;
      }

      const joinAlias = validateIdentifier(join.alias, 'alias do JOIN');
      const onSql = compileCondition(join.on, params);
      joinParts.push(`\n${join.type} JOIN ${targetSql} ${joinAlias} ON ${onSql}`);
      antiDuplicationEnforced = true;
    }
  }

  // 5. WHERE
  let whereClause = '';
  if (ast.where) {
    const whereSql = compileCondition(ast.where, params);
    whereClause = `\nWHERE ${whereSql}`;
  }

  // 6. GROUP BY
  let groupByClause = '';
  if (ast.groupBy && ast.groupBy.length > 0) {
    const groupParts = ast.groupBy.map(g => {
      if (typeof g === 'string') {
        return validateIdentifier(g, 'coluna GROUP BY');
      }
      return compileExpr(g, params);
    });
    groupByClause = `\nGROUP BY ${groupParts.join(', ')}`;
  }

  // 7. HAVING
  let havingClause = '';
  if (ast.having) {
    havingClause = `\nHAVING ${compileCondition(ast.having, params)}`;
  }

  // 8. ORDER BY
  let orderByClause = '';
  if (ast.orderBy && ast.orderBy.length > 0) {
    const orderParts = ast.orderBy.map(o => {
      const field = validateIdentifier(o.field, 'campo ORDER BY');
      const tablePrefix = o.table ? `${validateIdentifier(o.table, 'tabela ORDER BY')}.` : '';
      return `${tablePrefix}${field} ${o.direction}`;
    });
    orderByClause = `\nORDER BY ${orderParts.join(', ')}`;
  }

  // 9. LIMIT & OFFSET
  let limitClause = '';
  if (typeof ast.limit === 'number') {
    if (ast.limit < 0 || !Number.isInteger(ast.limit)) {
      throw new Error('SECURITY_VIOLATION: LIMIT deve ser um inteiro não-negativo.');
    }
    limitClause = `\nLIMIT ${ast.limit}`;
    if (typeof ast.offset === 'number') {
      if (ast.offset < 0 || !Number.isInteger(ast.offset)) {
        throw new Error('SECURITY_VIOLATION: OFFSET deve ser um inteiro não-negativo.');
      }
      limitClause += ` OFFSET ${ast.offset}`;
    }
  }

  const terminator = isSubquery ? '' : ';';
  const finalSql = `${withClause}${selectClause}${fromClause}${joinParts.join('')}${whereClause}${groupByClause}${havingClause}${orderByClause}${limitClause}${terminator}`;
  assertSafeSqlString(finalSql);

  return finalSql;
}

/**
 * Construtor Fluente para Queries Seguras Parametrizadas.
 */
export class SafeQueryBuilder {
  private ctes: CteDefinition[] = [];
  private selectExprs: SqlAstExpr[] = [];
  private fromTable?: FromTable;
  private joins: SafeJoinNode[] = [];
  private whereCondition?: AstCondition;
  private groupByCols: (ColumnRef | string)[] = [];
  private havingCondition?: AstCondition;
  private orderByItems: OrderByNode[] = [];
  private queryLimit?: number;
  private queryOffset?: number;
  private storeScopeEnforced = false;
  private antiDuplicationActive = false;

  public static create(): SafeQueryBuilder {
    return new SafeQueryBuilder();
  }

  public withCte(name: string, queryOrBuilder: SafeQueryAst | SafeQueryBuilder): this {
    const query = queryOrBuilder instanceof SafeQueryBuilder ? queryOrBuilder.toAst() : queryOrBuilder;
    this.ctes.push({ name: validateIdentifier(name, 'nome CTE'), query });
    this.antiDuplicationActive = true;
    return this;
  }

  public select(expressions: SqlAstExpr[]): this {
    this.selectExprs.push(...expressions);
    return this;
  }

  public selectColumn(name: string, table?: string, alias?: string): this {
    this.selectExprs.push({
      type: 'column',
      name: validateIdentifier(name, 'coluna'),
      table: table ? validateIdentifier(table, 'tabela') : undefined,
      alias: alias ? validateIdentifier(alias, 'alias') : undefined
    });
    return this;
  }

  public selectAggregate(fn: AggregateFunction, column: string, options?: { table?: string; distinct?: boolean; alias?: string }): this {
    if (fn === 'SUM' && options?.distinct === true) {
      throw new Error(
        'CARDINALITY_VIOLATION: SUM(DISTINCT) é expressamente proibido no Hydra. ' +
        'A deduplicação por valor corrompe dados reais quando duas entidades possuem valores idênticos.'
      );
    }
    this.selectExprs.push({
      type: 'aggregate',
      fn,
      column,
      table: options?.table,
      distinct: options?.distinct,
      alias: options?.alias
    });
    return this;
  }

  public selectScalarSubquery(queryOrBuilder: SafeQueryAst | SafeQueryBuilder, alias?: string): this {
    const subquery = queryOrBuilder instanceof SafeQueryBuilder ? queryOrBuilder.toAst() : queryOrBuilder;
    this.selectExprs.push({
      type: 'scalar_subquery',
      subquery,
      alias: alias ? validateIdentifier(alias, 'alias') : undefined
    });
    this.antiDuplicationActive = true;
    return this;
  }

  public selectWeightedRatio(numeratorColumn: string, denominatorColumn: string, options?: { table?: string; multiplier?: number; alias?: string }): this {
    this.selectExprs.push({
      type: 'weighted_ratio',
      numeratorColumn,
      denominatorColumn,
      table: options?.table,
      multiplier: options?.multiplier,
      alias: options?.alias
    });
    return this;
  }

  public from(tableName: string, alias?: string): this {
    this.fromTable = {
      name: validateIdentifier(tableName, 'tabela FROM'),
      alias: alias ? validateIdentifier(alias, 'alias FROM') : undefined
    };
    return this;
  }

  public leftJoinPreAggregatedCte(cteName: string, alias: string, on: AstCondition): this {
    this.joins.push({
      type: 'LEFT',
      target: { type: 'cte', name: validateIdentifier(cteName, 'CTE alvo') },
      alias: validateIdentifier(alias, 'alias do JOIN'),
      on,
      multiplicationRisk: false,
      isPreAggregated: true
    });
    this.antiDuplicationActive = true;
    return this;
  }

  public join(joinNode: SafeJoinNode): this {
    if (joinNode.multiplicationRisk && !joinNode.isPreAggregated) {
      throw new Error(
        `CARDINALITY_VIOLATION: Tentativa de junção direta 1:N com risco de duplicação. ` +
        `Obrigatório pré-agregar em CTE ou subconsulta escalar.`
      );
    }
    this.joins.push(joinNode);
    return this;
  }

  public where(condition: AstCondition): this {
    this.whereCondition = condition;
    return this;
  }

  public andWhere(condition: AstCondition): this {
    if (!this.whereCondition) {
      this.whereCondition = condition;
    } else {
      this.whereCondition = {
        type: 'logical',
        logic: 'AND',
        conditions: [this.whereCondition, condition]
      };
    }
    return this;
  }

  public markStoreScopeApplied(): this {
    this.storeScopeEnforced = true;
    return this;
  }

  public groupBy(columns: (ColumnRef | string)[]): this {
    this.groupByCols.push(...columns);
    return this;
  }

  public having(condition: AstCondition): this {
    this.havingCondition = condition;
    return this;
  }

  public orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC', table?: string): this {
    this.orderByItems.push({
      field: validateIdentifier(field, 'campo ORDER BY'),
      direction,
      table: table ? validateIdentifier(table, 'tabela ORDER BY') : undefined
    });
    return this;
  }

  public limit(limit: number, offset?: number): this {
    this.queryLimit = limit;
    this.queryOffset = offset;
    return this;
  }

  public toAst(): SafeQueryAst {
    if (!this.fromTable) {
      throw new Error('INVALID_CONCEPT: Cláusula FROM é obrigatória.');
    }
    return {
      ctes: this.ctes.length > 0 ? this.ctes : undefined,
      select: this.selectExprs,
      from: this.fromTable,
      joins: this.joins.length > 0 ? this.joins : undefined,
      where: this.whereCondition,
      groupBy: this.groupByCols.length > 0 ? this.groupByCols : undefined,
      having: this.havingCondition,
      orderBy: this.orderByItems.length > 0 ? this.orderByItems : undefined,
      limit: this.queryLimit,
      offset: this.queryOffset
    };
  }

  public build(): CompiledQueryOutput {
    const ast = this.toAst();
    const params: SqlPrimitive[] = [];
    const sql = compileSafeAst(ast, params);

    // Estimativa determinística de custo baseada na complexidade do AST
    let estimatedCost = 5;
    if (ast.ctes && ast.ctes.length > 0) estimatedCost += ast.ctes.length * 8;
    if (ast.joins && ast.joins.length > 0) estimatedCost += ast.joins.length * 5;
    if (ast.groupBy && ast.groupBy.length > 0) estimatedCost += 10;

    return {
      sql,
      parameters: params,
      antiDuplicationEnforced: this.antiDuplicationActive || (ast.ctes !== undefined && ast.ctes.length > 0),
      storeScopeFilterApplied: this.storeScopeEnforced,
      estimatedCostMs: estimatedCost
    };
  }
}
