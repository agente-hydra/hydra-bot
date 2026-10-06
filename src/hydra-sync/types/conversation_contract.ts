/**
 * Contrato Compartilhado de Conversação e Interpretação Semântica (v1.1.0)
 * 
 * Define o protocolo padronizado entre:
 * - Agente 1 (Normalizador de Mídia Multimodal: Áudio, Imagem, Vídeo, Documentos)
 * - Agente 2 (Compreensão de Linguagem Natural, Intent Rewriter, Agrupador de Mensagens e Sessão)
 * - Agente 3 (Recuperação Híbrida, FTS5, SQL e Banco de Dados)
 * - Despachante e Camada de Execução Operacional
 */

export * from './multimodal_contract.js';
import type { InboundPart, MediaEvidence } from './multimodal_contract.js';

export const CONVERSATION_CONTRACT_VERSION = '1.1.0';
export const CAPABILITIES_VERSION = '1.1.0';

/**
 * Decisão de alto nível tomada pelo componente de interpretação
 */
export type ExecutionDecision =
  | 'execute'                 // Consulta válida e pronta para execução
  | 'clarify'                 // Pergunta ambígua ou incompleta que exige desambiguação amigável
  | 'out_of_scope'            // Solicitação fora do domínio da rede de oficinas (futebol, receitas, etc.)
  | 'unsupported'             // Solicitação operacional não suportada
  | 'unavailable'             // Recurso temporariamente indisponível (ex: sem dados ou offline)
  | 'unsupported_capability'; // Alias para compatibilidade retroativa

/**
 * Escopo espacial da consulta
 */
export type QueryScope = 'store' | 'all_stores' | 'network' | 'unspecified';

/**
 * Catálogo de operações operacionais reais suportadas
 */
export type OperationType =
  | 'list_os'                 // Listar OSs (com ou sem filtros de loja, status, sinal, retenção)
  | 'os_detail'               // Obter ficha detalhada de uma OS específica
  | 'store_overview'          // Raio-X completo e situação de uma loja
  | 'financial_alerts'        // Alertas financeiros, metas e faturamento acumulado
  | 'checklist_audit'         // Auditoria de checklists de entrada e do mecânico
  | 'aging_cars'              // Veículos retidos no pátio há muitos dias (> 5 dias)
  | 'service_search'          // Busca por termo de serviço, placa ou termo livre
  | 'store_cmv'               // Custo de Mercadoria Vendida (CMV) e margem por loja
  | 'store_areas'             // Faturamento e margem por área/setor da loja
  | 'media_survey'            // Pesquisa de mídia e canais de captação de clientes
  | 'runtime_diagnostics'     // Diagnóstico factual de runtime, Obsidian Vault e integridade da memória
  | 'conversation_history'    // Consulta factual de histórico de conversa e turnos
  | 'memory_preference'       // Registro e gestão de preferências operacionais do usuário
  | 'conversation_correction' // Correção de rumo conversacional
  | 'general_query'           // Consulta de informação geral ou ajuda operacional
  | 'delay_reason'            // Motivo de atraso de veículo individual
  | 'vehicle_count'           // Contagem de veículos por modelo
  | 'vehicle_list';           // Listagem de veículos por modelo

/**
 * Relação do turno atual com a sessão anterior
 */
export type TurnRelationType =
  | 'new_query'               // Nova consulta independente (reseta filtros não redefinidos)
  | 'refine'                  // Refinamento direto do conjunto anterior ("dessas", "só as sem sinal", etc.)
  | 'continue';               // Continuação com troca pontual de parâmetro ("e no jabaquara?", "e a mais antiga?")

/**
 * Loja canônica resolvida contra o catálogo oficial
 */
export interface ResolvedStore {
  raw: string;                // Termo exato digitado pelo usuário (ex: "sto andre", "jaba")
  slug: string;               // Slug oficial no banco (ex: "MPSantoAndre", "MPJabaquara")
  name: string;               // Nome amigável de exibição (ex: "Santo André", "Jabaquara")
  prep: string;               // Preposição correta para frases em pt-BR (ex: "de", "do", "da")
  confidence: number;         // Índice de confiança (0.0 a 1.0)
}

/**
 * Entidades operacionais resolvidas
 */
export interface ResolvedEntities {
  loja?: ResolvedStore;
  osId?: string;
  placa?: string;
  veiculo?: string;
}

/**
 * Filtros estruturados para execução da consulta.
 * REGRA CRÍTICA: Filtro ausente (undefined) significa "não filtrar".
 * NUNCA confundir ausência com false!
 */
export interface StructuredFilters {
  /**
   * Filtrar por status de abertura.
   * true = apenas abertas (is_aberta = 1).
   * false = apenas fechadas/finalizadas.
   * undefined = não filtrar por status.
   */
  onlyOpen?: boolean;

  /**
   * Filtrar OS sem sinal / entrada zero (valor_pago <= 0 e valor_restante > 0).
   * true = apenas sem sinal.
   * undefined = não filtrar por sinal.
   */
  noDeposit?: boolean;

  /**
   * Saldo pendente mínimo em reais.
   */
  minSaldo?: number;

  /**
   * Quantidade mínima de dias no pátio.
   */
  minDiasPatio?: number;

  /**
   * Escopo de auditoria de checklist.
   */
  checklistScope?: 'MECANICO' | 'ENTRADA' | 'TODOS';

  /**
   * Termos específicos de serviço ou peças.
   */
  serviceTerms?: string[];

  /**
   * Termo genérico de busca textual.
   */
  searchTerm?: string;

  /**
   * Sub-intenção de metas ou apresentação financeira
   */
  subIntent?: 'goal_gap' | 'store_list' | 'single_store' | 'general' | 'worst_store' | 'worst_area';

  /**
   * Foco na área de pior desempenho (maior CMV percentual)
   */
  focusWorst?: boolean;

  /**
   * Escopo de consulta financeira
   */
  scope?: QueryScope;

  /**
   * Área de operação canônica (ex: 'OLEO', 'FILTRO', 'MECANICA')
   */
  area?: string;

  /**
   * Flag indicando se a consulta é especificamente sobre a primeira pergunta da conversa
   */
  isFirstQuestionQuery?: boolean;

  /**
   * Texto literal da preferência operacional informada pelo usuário
   */
  delayReasonFocus?: boolean;
  isCountQuery?: boolean;
  preferenceText?: string;
}

/**
 * Configuração de ordenação e paginação/limite
 */
export interface SortConfig {
  field?: 'valor_total' | 'valor_restante' | 'dias_no_patio' | 'data_inicio' | 'cmv_percentual';
  direction?: 'ASC' | 'DESC';
  limit?: number;
}

/**
 * Agrupamento de dados solicitado
 */
export type GroupingType = 'por_loja' | 'por_status' | 'por_responsavel' | 'nenhum';

/**
 * Período temporal da consulta
 */
export interface PeriodConfig {
  type: 'mes_atual' | 'ultimos_30d' | 'hoje' | 'personalizado';
  start?: string;
  end?: string;
  label?: string;
}

/**
 * Registro de rastreabilidade de herança e substituição de filtros entre turnos
 */
export interface TurnRelation {
  type: TurnRelationType;
  referenceTerm?: string;      // Palavra âncora usada (ex: "dessas", "destas", "e a...")
  inheritedFilters: string[];  // Filtros mantidos do turno anterior
  overriddenFilters: string[]; // Filtros cujo valor foi substituído
  removedFilters: string[];    // Filtros do turno anterior descartados por irrelevância
}

/**
 * Resolução de ambiguidades detectadas
 */
export interface AmbiguityResolution {
  isAmbiguous: boolean;
  clarificationQuestion?: string;
  candidates?: string[];
  reason?: string;
}

/**
 * Requisito atômico de resposta para validação pré-envio
 */
export interface AnswerRequirement {
  id: string;
  description: string;
  targetMetric: string;
  targetScope: 'store' | 'all_stores' | 'network';
  targetLojaSlug?: string;
  targetArea?: string;
  fulfilled: boolean;
  sourceTable?: string;
  missingReason?: string;
}

/**
 * Contrato de Interpretação Semântica e Raciocínio Operacional
 */
export interface InterpretationContract {
  intents: string[];
  metric: string;
  dimensions: string[];
  scope: QueryScope;
  period: PeriodConfig | string;
  filters: StructuredFilters | Record<string, any>;
  entities: ResolvedEntities;
  source: string;
  confidence: number;
  missingInformation?: string[];
  answerRequirements: AnswerRequirement[];
}

/**
 * Plano de Execução estruturado e validado, pronto para o adaptador/SQL
 */
export interface ExecutionPlan {
  operation: OperationType;
  scope?: QueryScope;
  entities: ResolvedEntities;
  filters: StructuredFilters;
  sort?: SortConfig;
  grouping?: GroupingType;
  period?: PeriodConfig;
  targetLojaSlug?: string;     // SEMPRE validado contra o catálogo oficial. Proibido '', 'LOJA', 'lojas'.
  targetArea?: string;
  mediaEvidence?: MediaEvidence[];
  answerRequirements?: AnswerRequirement[];
}

/**
 * Objeto completo do Contrato de Turno Reunido entregue aos outros componentes
 */
export interface TurnContract {
  version: string;             // Sempre '1.1.0'
  turnId: string;
  conversationKey?: string;     // Chave da conversa (ex: telefone)
  messageIds?: string[];        // Todos os IDs de mensagem que compõem este turno
  originalTexts?: string[];     // Textos originais e legendas em ordem de chegada
  parts?: InboundPart[];       // Partes brutas recebidas
  mediaEvidence?: MediaEvidence[]; // Evidências multimodais vinculadas aos messageIds
  timestamp: string;           // ISO 8601
  decision: ExecutionDecision;
  operation: OperationType;
  scope?: QueryScope;           // Escopo: 'store' | 'all_stores' | 'network' | 'unspecified'
  entities: ResolvedEntities;
  filters: StructuredFilters;
  sort?: SortConfig;
  grouping?: GroupingType;
  period?: PeriodConfig;
  turnRelation: TurnRelation;
  ambiguity: AmbiguityResolution;
  canonicalQuestion: string;   // Pergunta expandida em pt-BR formal para auditoria
  explanation?: string;        // Justificativa semântica da interpretação
  rejectionReason?: string;    // Justificativa em caso de recusa / fora de escopo
  plan: ExecutionPlan;         // Plano executável
  interpretation?: InterpretationContract;
  answerRequirements?: AnswerRequirement[];
}