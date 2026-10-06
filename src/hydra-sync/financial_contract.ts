/**
 * HYDRA FINANCIAL DATA CONTRACT
 * Contrato tipado de entrega de dados financeiros para o Agente 2.
 * 
 * Regras do Contrato:
 * 1. Separação Estrita de Responsabilidades: este contrato fornece dados puros,
 *    métricas calculadas, estados de cobertura e frescor. Não formata texto WhatsApp.
 * 2. Métrica Primária de CMV: cmvPercentual é o primeiro campo retornado em consultas de CMV.
 * 3. Escopos de CMV:
 *    - 'store': CMV detalhado de uma loja única válida.
 *    - 'all_stores': lista comparativa de todas as lojas, sem converter ausência em 0.00%.
 *    - 'network': razão consolidada sum(custos) / sum(faturamentos) * 100. NUNCA média aritmética!
 * 4. Governança de Cobertura: 10 lojas operacionais elegíveis (Master estritamente excluída).
 *    Com menos de 10 lojas com dados, rotular expressamente como parcial com lojas ausentes.
 * 5. Estados Determinísticos: 'sucesso' | 'vazio' | 'desatualizado' | 'erro' | 'parcial'.
 *    Nunca devolve dados de OS ou Raio-X como substituto para consultas financeiras.
 */

export type FinancialQueryState = 'sucesso' | 'vazio' | 'desatualizado' | 'erro' | 'parcial';

export interface GoalGapStoreItem {
  lojaSlug: string;
  nome: string;
  faturamento: number;
  meta: number | null;
  previsao: number | null;
  falta: number | null;
  atingimentoPercentual: number | null;
  faltaPercentual: number | null;
  bateuMeta: boolean;
  volumeOS: number;
  ticketMedio: number;
  status: FinancialQueryState;
}

export interface GoalGapCoverage {
  totalLojasElegiveis: number; // 10
  lojasCompletas: number;
  lojasAusentes: string[];
  masterExcluida: true;
  isCompleta: boolean;
  descricao: string;
}

export interface GoalGapResult {
  status: FinancialQueryState;
  motivo?: string;
  lojaSlug?: string;
  nome?: string;
  periodo: string;
  dataReferencia: string;
  posicaoHora?: string;
  capturedAt?: string;
  origem: 'MAPA_METAS_OFICIAL';

  // Métricas Principais da Consulta
  meta: number | null;
  faturamentoComparavel: number | null;
  previsaoComparavel?: number | null;
  falta: number | null;
  atingimentoPercentual: number | null;
  faltaPercentual: number | null;
  bateuMeta: boolean;

  // Governança de Cobertura e Lojas
  cobertura: GoalGapCoverage;
  lojasDetalhadas?: GoalGapStoreItem[];
  lojasNaoBateram?: GoalGapStoreItem[];
  lojasBateram?: GoalGapStoreItem[];
}

export interface StoreCMVAreaItem {
  area: string;
  faturamento: number;
  participacaoPercentual: number;
  desconto: number;
  custo: number;
  cmvPercentual: number;
  lucroBruto: number;
  lucroBrutoPercentual: number;
}

export interface StoreCMVResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'RELATORIO_OPERACAO_OFICIAL';
  scope: 'store';

  lojaSlug: string;
  nome: string;
  periodo: string;
  dataInicio: string;
  dataFim: string;
  capturedAt?: string;

  // Métrica Primária Obrigatória
  cmvPercentual: number | null;

  // Valores que Sustentam a Métrica
  faturamentoTotal: number | null;
  custoTotal: number | null;
  descontoTotal: number | null;
  lucroBruto: number | null;
  lucroBrutoPercentual: number | null;
  baseCalculo: 'faturamento_bruto';

  // Rastreabilidade de Áreas e Ajustes
  somaCustoAreas?: number;
  diferencaConsolidadoAreas?: number;
  areas: StoreCMVAreaItem[];
}

export interface StoreCMVItem {
  lojaSlug: string;
  nome: string;
  periodo: string;
  dataInicio?: string;
  dataFim?: string;
  capturedAt?: string;
  cmvPercentual: number | null;
  faturamentoTotal: number | null;
  custoTotal: number | null;
  lucroBruto: number | null;
  lucroBrutoPercentual: number | null;
  status: FinancialQueryState;
  motivo?: string;
}

export interface NetworkCMVResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'RELATORIO_OPERACAO_OFICIAL';
  scope: 'network';

  periodo: string;
  dataInicio?: string;
  dataFim?: string;
  capturedAt?: string;

  // Métrica Primária: soma de custos compatíveis / soma de faturamento bruto compatível * 100
  cmvConsolidadoPercentual: number | null;
  somaCustosCompativeis: number | null;
  somaFaturamentosBaseCompativeis: number | null;
  lucroBrutoConsolidado: number | null;
  lucroBrutoConsolidadoPercentual: number | null;
  baseCalculo: 'faturamento_bruto';

  // Governança de Cobertura
  cobertura: GoalGapCoverage;
  lojasDetalhadas: StoreCMVItem[];
  piorLoja?: StoreCMVItem;
}

export interface AllStoresCMVResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'RELATORIO_OPERACAO_OFICIAL';
  scope: 'all_stores';

  periodo: string;
  capturedAt?: string;

  cobertura: GoalGapCoverage;
  lojas: StoreCMVItem[];
  rankingCMV: StoreCMVItem[]; // Ordenadas por cmvPercentual desc (maior/pior CMV primeiro)
  piorLoja?: StoreCMVItem;
}

export type UnifiedCMVResult = StoreCMVResult | NetworkCMVResult | AllStoresCMVResult;

export interface StoreAreasResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'RELATORIO_OPERACAO_OFICIAL';

  lojaSlug: string;
  nome: string;
  periodo: string;
  dataInicio: string;
  dataFim: string;
  capturedAt?: string;

  totalFaturado: number | null;
  totalCusto: number | null;
  descontoTotal: number | null;
  lucroBrutoTotal: number | null;
  areas: StoreCMVAreaItem[];
}

export interface StoreMediaChannelItem {
  canal: string;
  faturamento: number;
  faturamentoPercentual: number;
  qtdOS: number;
  ticketMedio: number;
}

export interface StoreMediaSurveyResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'RELATORIO_OPERACAO_OFICIAL';

  lojaSlug: string;
  nome: string;
  periodo: string;
  dataInicio: string;
  dataFim: string;
  capturedAt?: string;

  totalFaturado: number | null;
  totalOS: number | null;
  canais: StoreMediaChannelItem[];
  canalPrincipal?: StoreMediaChannelItem;
}

export interface GoogleCentralStoreItem {
  lojaSlug: string;
  nome: string;
  faturamentoBrutoLoja?: number | null;
  canalGoogle?: StoreMediaChannelItem | null;
  canalCentral?: StoreMediaChannelItem | null;
  totalGoogleCentral: number;
  totalOSGoogleCentral: number;
  pctGoogleCentralDoFaturamento?: number | null;
}

export interface GoogleCentralMediaSurveyResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'RELATORIO_OPERACAO_OFICIAL';
  isAllStores: boolean;
  periodo?: string;
  dataInicio?: string;
  dataFim?: string;
  storeResult?: GoogleCentralStoreItem;
  lojasApuradas?: GoogleCentralStoreItem[];
  lojasSemDados?: Array<{ lojaSlug: string; nome: string }>;
}

export interface NetworkFinancialStoreItem {
  slug: string;
  nome: string;
  faturamento: number;
  meta: number | null;
  previsao: number | null;
  percentualMeta: number | null;
  volumeOS: number;
  ticketMedio: number;
  status: FinancialQueryState;
}

export interface NetworkFinancialOverviewResult {
  status: FinancialQueryState;
  motivo?: string;
  origem: 'MAPA_METAS_OFICIAL';

  periodo: string;
  dataReferencia: string;
  posicaoHora?: string;
  capturedAt?: string;

  totalFaturamento: number;
  totalMeta: number;
  totalOS: number;
  ticketMedio: number;
  faltaTotal: number;
  atingimentoTotalPercentual: number;

  cobertura: GoalGapCoverage;
  lojas: NetworkFinancialStoreItem[];
}
