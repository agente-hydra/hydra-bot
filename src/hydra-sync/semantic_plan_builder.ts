/**
 * src/hydra-sync/semantic_plan_builder.ts
 * Gerador de Plano Semantico de Negocio (SemanticQueryPlan) a partir de Linguagem Natural.
 * Regra Cardinal: TypeScript strict - ZERO any.
 */

import { randomUUID } from "node:crypto";

import type {
  SemanticQueryPlan,
  SemanticFilterNode,
  SemanticFilterCondition,
  SemanticAggregation,
  SemanticSort,
  SemanticPeriod,
  SecurityContext,
  PrimaryEntityType,
  FilterOperator
} from "./types/semantic_contract.js";

import {
  ONTOLOGY_VERSION,
  getOntologyMetric,
  getOntologyTerm,
  TERMS_CATALOG
} from "./ontology_catalog.js";

import {
  normalizeLexical,
  resolveStore,
  resolveSemanticArea,
  resolveMetrics,
  resolveDimensions,
  resolvePeriod,
  isPredictiveQuestion,
  isCausalQuestion,
  isSemanticSearchQuestion,
  isDrillDownQuestion,
  detectRelationalPredicates,
  detectAnaphoricReference,
  OFFICIAL_STORES
} from "./semantic_glossary.js";

export interface RewriteSemanticContext {
  previousPlan?: SemanticQueryPlan;
  securityScope?: SecurityContext;
  rawHistory?: string[];
}

function parseNumericValue(text: string): number | null {
  const norm = normalizeLexical(text);
  
  // Ex: "2,5 mil" ou "2.5 mil" ou "2 mil"
  const milMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*mil/);
  if (milMatch) {
    const base = parseFloat(milMatch[1].replace(',', '.'));
    return base * 1000;
  }

  // Número simples ou decimal brasileiro
  const numMatch = norm.match(/(\d+(?:[.,]\d+)?)/);
  if (numMatch) {
    return parseFloat(numMatch[1].replace(',', '.'));
  }

  return null;
}

/**
 * Construtor do SemanticQueryPlan a partir de uma pergunta em linguagem natural.
 */
export function buildSemanticQueryPlan(
  rawQuestion: string,
  context?: RewriteSemanticContext
): SemanticQueryPlan {
  const planId = `plan_${randomUUID().substring(0, 8)}`;
  const norm = normalizeLexical(rawQuestion);

  const securityScope: SecurityContext = context?.securityScope || {
    persona: 'socio',
    authorizedPhones: []
  };

  // 1. CASO PREDITIVO: Perguntas preditivas são explicitamente tratadas com executionMode: 'clarify'
  if (isPredictiveQuestion(norm)) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'meta_diaria',
      dimensions: ['loja_slug', 'data_referencia'],
      metrics: ['faturamento_bruto'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [{ metricId: 'faturamento_bruto', alias: 'faturamento_previsto' }],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'clarify',
      clarificationReason:
        "Pergunta preditiva não suportada ('quanto vamos faturar mês que vem?'). A camada semântica opera estritamente sobre dados históricos e posições factuais registradas no sistema, não possuindo modelo estatístico preditivo ou bola de cristal homologada."
    };
  }

  // 2. CASO CAUSAL: Perguntas do tipo "por que caiu?" exigem decomposição declarada
  if (isCausalQuestion(norm)) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'faturamento_area',
      dimensions: ['area', 'loja_slug'],
      metrics: ['cmv_percentual', 'faturamento_bruto', 'custo_total'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [
        { metricId: 'cmv_percentual', alias: 'cmv' },
        { metricId: 'faturamento_bruto', alias: 'receita' },
        { metricId: 'custo_total', alias: 'custo' }
      ],
      relationsRequired: ['loja_faturamento_areas'],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'clarify',
      causalDecomposition: true,
      clarificationReason:
        "Pergunta causal identificada ('por que caiu?'). A camada semântica não infere causalidade automática nem inventa motivos externos. Ela oferece decomposição factual dos componentes de receita (variação por loja, por área operacional, ou impacto de volume vs ticket médio)."
    };
  }

  // 3. CASO BUSCA SEMÂNTICA / VETORIAL (Amostras candidatas delimitadas)
  if (isSemanticSearchQuestion(norm)) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id', 'loja_slug', 'status_grid'],
      metrics: ['faturamento_bruto'],
      filters: {
        logic: 'AND',
        conditions: [
          { dimensionOrMetricId: 'status_grid', operator: 'IS_NOT_NULL' }
        ]
      },
      aggregations: [],
      relationsRequired: [],
      coverageRequired: 'partial_allowed',
      securityScope,
      executionMode: 'mcp_tool',
      searchSampleOnly: true,
      clarificationReason:
        'Casos parecidos recuperados via busca vetorial/lexical são tratados estritamente como amostras candidatas para inspeção, nunca como total exaustivo da população de ordens.'
    };
  }

  // 4. ANÁFORAS E CONTINUAÇÃO CONVERSACIONAL (ex: "Das anteriores, exclua as aguardando peça...")
  const anaphora = detectAnaphoricReference(norm);
  if (anaphora.isAnaphoric && context?.previousPlan) {
    const inheritedPlan = context.previousPlan;
    const inheritedConditions: (SemanticFilterCondition | SemanticFilterNode)[] = [
      ...inheritedPlan.filters.conditions
    ];

    // Exclusão com operador NOT ou NOT_EQUALS
    if (anaphora.excludes && anaphora.excludes.length > 0) {
      for (const exc of anaphora.excludes) {
        inheritedConditions.push({
          logic: 'NOT',
          conditions: [
            { dimensionOrMetricId: 'status_grid', operator: 'EQUALS', value: exc }
          ]
        });
      }
    }

    // Manutenção de responsável (ex: "só as do Marcelo")
    if (anaphora.maintains && anaphora.maintains.length > 0) {
      for (const m of anaphora.maintains) {
        inheritedConditions.push({
          dimensionOrMetricId: 'responsavel_fechamento',
          operator: 'LIKE',
          value: `%${m}%`
        });
      }
    }

    return {
      ...inheritedPlan,
      planId,
      filters: {
        logic: 'AND',
        conditions: inheritedConditions
      }
    };
  }

  // 5. CASO RELACIONAL COMPLEXO (ex: "Serviço de câmbio sem troca de óleo")
  const relational = detectRelationalPredicates(norm);
  if (relational.hasRelationalPredicate) {
    const relationalConditions: (SemanticFilterCondition | SemanticFilterNode)[] = [];

    if (relational.existsTerms) {
      for (const term of relational.existsTerms) {
        relationalConditions.push({
          dimensionOrMetricId: 'servico_descricao',
          operator: 'EXISTS',
          value: term,
          relationContext: 'os_servicos'
        });
      }
    }

    if (relational.notExistsTerms) {
      for (const term of relational.notExistsTerms) {
        relationalConditions.push({
          dimensionOrMetricId: 'servico_descricao',
          operator: 'NOT_EXISTS',
          value: term,
          relationContext: 'os_servicos'
        });
      }
    }

    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id', 'loja_slug', 'placa', 'status_grid'],
      metrics: ['faturamento_bruto'],
      filters: {
        logic: 'AND',
        conditions: relationalConditions
      },
      aggregations: [{ metricId: 'faturamento_bruto', alias: 'total_os' }],
      relationsRequired: ['os_servicos'],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql',
      executionStrategy: 'exists_subquery'
    };
  }

  // 6. CASO RECORRÊNCIA DE VEÍCULO (ex: "Quais clientes voltaram com o mesmo carro em até 30 dias?")
  if (
    norm.includes('voltaram com o mesmo carro') ||
    norm.includes('retorno de veiculo') ||
    (norm.includes('mesmo carro') && norm.includes('30 dias'))
  ) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'veiculo',
      dimensions: ['placa'],
      metrics: ['volume_os'],
      filters: {
        logic: 'AND',
        conditions: [
          { dimensionOrMetricId: 'dias_entre_os', operator: 'LESS_EQUAL', value: 30 }
        ]
      },
      aggregations: [{ metricId: 'volume_os', alias: 'visitas' }],
      groupBy: ['placa'],
      relationsRequired: ['os_veiculo'],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql',
      clarificationReason:
        'Sem inferir retrabalho: o retorno do veículo em até 30 dias indica recorrência de atendimento, não falha técnica comprovada.'
    };
  }

  // 7. CASO DRILL-DOWN CONCILIATÓRIO (ex: "Quais ordens explicam esse faturamento?")
  if (isDrillDownQuestion(norm)) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id', 'loja_slug', 'total_os', 'data_fechamento', 'responsavel_fechamento'],
      metrics: ['faturamento_bruto'],
      filters: {
        logic: 'AND',
        conditions: [
          { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: false }
        ]
      },
      aggregations: [{ metricId: 'faturamento_bruto', alias: 'faturamento_total' }],
      period: { type: 'mes_atual' },
      orderBy: [{ fieldId: 'total_os', direction: 'DESC' }],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql'
    };
  }

  // 8. CASO COMPARAÇÃO HOMÓLOGA DE QUEDA (ex: "Qual loja mais caiu contra o mesmo período do mês passado?")
  if (norm.includes('mais caiu') || (norm.includes('caiu') && norm.includes('mes passado'))) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'loja',
      dimensions: ['loja_slug'],
      metrics: ['faturamento_bruto'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [{ metricId: 'faturamento_bruto', alias: 'faturamento' }],
      groupBy: ['loja_slug'],
      period: {
        type: 'mes_atual',
        comparisonPeriod: {
          type: 'mes_anterior_homologo'
        }
      },
      orderBy: [{ fieldId: 'variacao_absoluta', direction: 'ASC' }],
      limit: 1,
      relationsRequired: ['loja_ordens'],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql'
    };
  }

  // 9. CASO AGRUPAMENTO POR RESPONSÁVEL COM MÚLTIPLAS MÉTRICAS (ex: "Agrupe por responsável: quantidade, valor das OS e recebido")
  if (norm.includes('agrupe por responsavel') || (norm.includes('por responsavel') && norm.includes('recebido'))) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'ordem_servico',
      dimensions: ['responsavel_fechamento'],
      metrics: ['volume_os', 'faturamento_bruto', 'valor_pago'],
      filters: { logic: 'AND', conditions: [] },
      aggregations: [
        { metricId: 'volume_os', alias: 'quantidade' },
        { metricId: 'faturamento_bruto', alias: 'valor_das_os' },
        { metricId: 'valor_pago', alias: 'recebido' }
      ],
      groupBy: ['responsavel_fechamento'],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql'
    };
  }

  // 10. CASO SUPERLATIVO DE TICKET MÉDIO (ex: "Quem teve maior ticket, só das faturadas neste mês?")
  if (norm.includes('maior ticket') || norm.includes('quem teve maior ticket')) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'ordem_servico',
      dimensions: ['responsavel_fechamento'],
      metrics: ['ticket_medio'],
      filters: {
        logic: 'AND',
        conditions: [
          { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: false }
        ]
      },
      aggregations: [{ metricId: 'ticket_medio', alias: 'ticket_medio' }],
      groupBy: ['responsavel_fechamento'],
      period: { type: 'mes_atual' },
      orderBy: [{ fieldId: 'ticket_medio', direction: 'DESC' }],
      limit: 1,
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql'
    };
  }

  // 11. CASO ENCERRADA COM SALDO RESTANTE (ex: "Tem encerrada com saldo restante?")
  if (norm.includes('encerrada com saldo') || norm.includes('fechada com saldo') || (norm.includes('encerrada') && norm.includes('saldo restante'))) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity: 'ordem_servico',
      dimensions: ['os_id', 'loja_slug', 'total_os', 'saldo_restante'],
      metrics: ['saldo_restante'],
      filters: {
        logic: 'AND',
        conditions: [
          { dimensionOrMetricId: 'is_aberta', operator: 'EQUALS', value: false },
          { dimensionOrMetricId: 'saldo_restante', operator: 'GREATER_THAN', value: 0 }
        ]
      },
      aggregations: [{ metricId: 'saldo_restante', alias: 'total_saldo_pendente' }],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'exact_sql'
    };
  }

  // 12. COMPOSIÇÃO GERAL DE PREDICADOS MÚLTIPLOS (ex: "Quais abertas há mais de 5 dias, acima de 2,5 mil e sem entrada?")
  const conditions: (SemanticFilterCondition | SemanticFilterNode)[] = [];
  const dimensions: string[] = ['os_id', 'loja_slug'];
  const metrics: string[] = [];
  const aggregations: SemanticAggregation[] = [];
  let primaryEntity: PrimaryEntityType = 'ordem_servico';

  // Resolução da Loja
  const storeResolution = resolveStore(norm);
  if (storeResolution.isAmbiguous) {
    return {
      planId,
      catalogVersion: ONTOLOGY_VERSION,
      primaryEntity,
      dimensions,
      metrics,
      filters: { logic: 'AND', conditions: [] },
      aggregations: [],
      relationsRequired: [],
      coverageRequired: 'full',
      securityScope,
      executionMode: 'clarify',
      clarificationReason: `O termo referente à unidade é ambíguo. Opções possíveis: ${storeResolution.ambiguousCandidates?.join(', ')}. Por favor, especifique qual loja deseja consultar.`
    };
  }

  // Injeção de Segurança de Loja para Persona Gerente
  if (securityScope.persona === 'gerente' && securityScope.authorizedLojaSlug) {
    conditions.push({
      dimensionOrMetricId: 'loja_slug',
      operator: 'EQUALS',
      value: securityScope.authorizedLojaSlug
    });
  } else if (storeResolution.storeSlug) {
    conditions.push({
      dimensionOrMetricId: 'loja_slug',
      operator: 'EQUALS',
      value: storeResolution.storeSlug
    });
  }

  // Predicado: Abertas vs Fechadas
  if (/\b(aberta|abertas|em aberto)\b/.test(norm)) {
    conditions.push({
      dimensionOrMetricId: 'is_aberta',
      operator: 'EQUALS',
      value: true
    });
  } else if (/\b(fechada|fechadas|encerrada|encerradas|faturada|faturadas)\b/.test(norm)) {
    conditions.push({
      dimensionOrMetricId: 'is_aberta',
      operator: 'EQUALS',
      value: false
    });
  }

  // Predicado: Dias no Pátio (ex: "há mais de 5 dias")
  const diasMatch = norm.match(/ha mais de (\d+) dias|mais de (\d+) dias|acima de (\d+) dias/);
  if (diasMatch) {
    const dias = parseInt(diasMatch[1] || diasMatch[2] || diasMatch[3], 10);
    conditions.push({
      dimensionOrMetricId: 'dias_no_patio',
      operator: 'GREATER_EQUAL',
      value: dias
    });
    dimensions.push('dias_no_patio');
  }

  // Predicado: Valor Monetário (ex: "acima de 2,5 mil", "acima de 2500")
  const valorMatch = norm.match(/acima de ([\d.,]+(?:\s*mil)?)|maior que ([\d.,]+(?:\s*mil)?)/);
  if (valorMatch) {
    const rawVal = valorMatch[1] || valorMatch[2];
    const parsedVal = parseNumericValue(rawVal);
    if (parsedVal !== null) {
      conditions.push({
        dimensionOrMetricId: 'total_os',
        operator: 'GREATER_EQUAL',
        value: parsedVal
      });
      dimensions.push('total_os');
    }
  }

  // Predicado: Sem Entrada / Sem Sinal
  if (/\b(sem entrada|sem sinal|sem adiantamento)\b/.test(norm)) {
    conditions.push({
      dimensionOrMetricId: 'valor_pago',
      operator: 'LESS_EQUAL',
      value: 0
    });
    dimensions.push('valor_pago');
  }

  // Predicado: Modelo do Veículo (ex: "quantos Linea", "liste os Linea", "como está o Linea")
  const modelMatch = norm.match(/\b(linea|palio|uno|gol|civic|corolla|onix|hb20|compass|renegade|strada|toro|argo|mobi|tucson|tracker|kicks|creta|kwid|virtus|polo|cronos|fiesta)\b/i);
  if (modelMatch) {
    const model = modelMatch[1].toLowerCase();
    conditions.push({
      dimensionOrMetricId: 'veiculo_modelo',
      operator: 'EQUALS',
      value: model
    });
    dimensions.push('veiculo_modelo');
  }

  // Resolução de Período
  const period = resolvePeriod(norm);

  // Resolução de Métricas Pedidas
  const detectedMetrics = resolveMetrics(norm);
  for (const m of detectedMetrics) {
    metrics.push(m.id);
    aggregations.push({ metricId: m.id, alias: m.id });
  }

  // Agregações para contagem de veículos
  if (/\b(quantos|quantas|quantidade|total\s+de)\b/.test(norm)) {
    if (!aggregations.some(a => a.metricId === 'volume_os')) {
      aggregations.push({ metricId: 'volume_os', alias: 'quantidade' });
      metrics.push('volume_os');
    }
  }

  // Agregações padrão para resumo de loja
  if (aggregations.length === 0) {
    if (
      norm.includes('como ta') ||
      norm.includes('como esta') ||
      norm.includes('resumo') ||
      norm.includes('hoje') ||
      norm.includes('panorama') ||
      storeResolution.storeSlug !== undefined
    ) {
      aggregations.push(
        { metricId: 'faturamento_bruto', alias: 'faturamento_bruto' },
        { metricId: 'volume_os', alias: 'volume_os' }
      );
      metrics.push('faturamento_bruto', 'volume_os');
    }
  }

  return {
    planId,
    catalogVersion: ONTOLOGY_VERSION,
    primaryEntity,
    dimensions,
    metrics,
    filters: {
      logic: 'AND',
      conditions
    },
    aggregations,
    period,
    relationsRequired: [],
    coverageRequired: 'full',
    securityScope,
    executionMode: 'exact_sql'
  };
}

/**
 * Função de interface com o pipeline de conversação legado e novo.
 */
