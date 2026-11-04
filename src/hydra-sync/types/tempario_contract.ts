/**
 * src/hydra-sync/types/tempario_contract.ts
 * Contratos Estritos do Subsistema de Tempário Híbrido Automotivo (Spec 054).
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import type { SecurityContext } from './conversation_context_contract.js';

export type TemparioEvidenceStatus =
  | 'HOMOLOGADO_OEM'
  | 'HISTORICO_OS_REDE'
  | 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO';

export type TemparioSourceType =
  | 'MANUAL_OEM'
  | 'BOLETIM_TSB'
  | 'HISTORICO_OS_REDE'
  | 'ESTIMATIVA_EXTERNA';

export type ExecutionPhase =
  | 'PRE_REQUISITO'
  | 'DESMONTAGEM'
  | 'ACESSO'
  | 'EXECUCAO'
  | 'REMONTAGEM'
  | 'TESTE_AJUSTE'
  | 'FINALIZACAO';

export type TemparioRelationType =
  | 'TEM_SUBOP'
  | 'DEPENDE_ACESSO'
  | 'USAR_FERRAMENTA'
  | 'VARIA_POR_MOTOR'
  | 'FONTE_EVIDENCIA'
  | 'POS_REQUISITO';

export type TemparioDifficulty = 'BAIXO' | 'MEDIO' | 'ALTO' | 'ESPECIALISTA';

export interface TemparioVehicleRecord {
  readonly vehicleId: string;
  readonly marca: string;
  readonly modelo: string;
  readonly geracao?: string;
  readonly anoInicio: number;
  readonly anoFim: number;
  readonly categoria: 'PASSEIO' | 'SUV' | 'UTILITARIO' | 'PREMIUM';
}

export interface TemparioEngineRecord {
  readonly engineId: string;
  readonly vehicleId: string;
  readonly codigoMotor: string;
  readonly cilindrada: string;
  readonly descricaoComercial: string;
  readonly combustivel: 'FLEX' | 'GASOLINA' | 'DIESEL' | 'HIBRIDO' | 'ELETRICO';
  readonly aspiracao: 'ASPIRADO' | 'TURBO' | 'BITURBO' | 'SUPERCHARGED';
  readonly valvulas: number;
}

export interface TemparioEvidenceSourceRecord {
  readonly sourceId: string;
  readonly tipoFonte: TemparioSourceType;
  readonly statusEvidencia: TemparioEvidenceStatus;
  readonly nomeDocumento: string;
  readonly versaoRevisao?: string;
  readonly capituloSecao?: string;
  readonly paginaTabela?: string;
  readonly homologadoPor?: string;
}

export interface TemparioSubOperationStep {
  readonly ordemExecucaoFinal: number;
  readonly subopId: string;
  readonly codigoEtapa: string;
  readonly titulo: string;
  readonly descricaoTecnica: string;
  readonly faseExecucao: ExecutionPhase;
  readonly tempoHoras: number;
  readonly tempoMinutos: number;
  readonly ferramentas: readonly string[];
  readonly torqueEspecificado?: string;
  readonly isAcessoCompartilhado: boolean;
  readonly qtdServicosCompartilhando: number;
  readonly operacoesOrigemIds: readonly string[];
}

export interface TemparioOperationRecord {
  readonly operationId: string;
  readonly codigoOperacaoOem: string;
  readonly vehicleId: string;
  readonly engineId?: string;
  readonly titulo: string;
  readonly categoriaServico: string;
  readonly tempoPadraoBrutoHoras: number;
  readonly fatorVariacaoMotor: number;
  readonly grauDificuldade: TemparioDifficulty;
  readonly sourceId: string;
  readonly statusEvidencia: TemparioEvidenceStatus;
}

export const DEFAULT_HOURLY_RATE = 270.00;

export interface TemparioPartItem {
  readonly partItemId?: string;
  readonly operationId?: string;
  readonly nomePeca: string;
  readonly codigoReferencia?: string;
  readonly quantidade: number;
  readonly unidade: string; // 'UN', 'L', 'JG', 'PAR', 'KIT'
  readonly obrigatoria: boolean; // true = substituição obrigatória, false = preventiva/recomendada
  readonly especificacaoTecnica?: string; // 'G13', 'DOT4', 'Dexos 1 Gen 3', etc.
  readonly observacao?: string;
}

export interface DeduplicatedGraphChainResult {
  readonly steps: readonly TemparioSubOperationStep[];
  readonly pecasNecessarias?: readonly TemparioPartItem[];
  readonly ferramentasNecessarias?: readonly string[];
  readonly torquesEspecificados?: readonly string[];
  readonly tempoLiquidoTotalHoras: number;
  readonly tempoLiquidoTotalMinutos: number;
  readonly tempoBrutoTotalHoras: number;
  readonly tempoEconomizadoDeduplicacaoHoras: number;
  readonly tempoEconomizadoDeduplicacaoMinutos: number;
  readonly possuiDeduplicacaoAtiva: boolean;
  readonly taxaHorariaPadrao: number; // Padrão R$ 270,00/h
  readonly valorMaoDeObraSugerido: number; // tempoLiquidoTotalHoras * taxaHorariaPadrao
  readonly valorMaoDeObraBrutoSemAssociativa: number; // tempoBrutoTotalHoras * taxaHorariaPadrao
  readonly economiaMaoDeObraReais: number; // tempoEconomizadoDeduplicacaoHoras * taxaHorariaPadrao
}

export interface StoreYardServiceSample {
  readonly lojaSlug: string;
  readonly qtdOsEncerradas: number;
  readonly tempoMedioExecucaoHoras: number;
  readonly leadTimeMedioPatioDias: number;
}

export interface YardRealTimeComparison {
  readonly temHistoricoRede: boolean;
  readonly escopoAplicado: 'REDE_10_LOJAS' | 'LOJA_ISOLADA';
  readonly lojaFiltroSlug?: string;
  readonly totalOsAnalisadas: number;
  readonly tempoMedioExecucaoHoras: number | null;
  readonly tempoMedioExecucaoMinutos: number | null;
  readonly medianaExecucaoHoras: number | null;
  readonly leadTimeMedioPatioDias: number | null;
  readonly desvioContraTabeladoPct: number | null;
  readonly gargalosFatuaisComprovados: readonly string[];
  readonly declaracaoLimitacaoFactual: string;
  readonly distribuicaoPorLoja: readonly StoreYardServiceSample[];
}

export interface TemparioHybridQueryInput {
  readonly rawQuery: string;
  readonly veiculoMarcaModelo: string;
  readonly ano?: number;
  readonly motorTexto?: string;
  readonly placa?: string;
  readonly osId?: string;
  readonly servicosSolicitados: readonly string[];
  readonly securityContext: SecurityContext;
  readonly targetLojaSlug?: string;
  readonly turnId?: string;
  readonly generationId?: number;
}

export interface TemparioHybridQueryResponse {
  readonly queryId: string;
  readonly isCacheHit: boolean;
  readonly latencyMs: number;
  readonly confidenceScore: number;
  readonly retrievalMethod: 'CACHE_L1' | 'HYBRID_RRF_GRAPH' | 'FTS5_GRAPH_FALLBACK' | 'ASSISTED_EXTERNAL_ESTIMATE';
  readonly veiculo: TemparioVehicleRecord | null;
  readonly motor: TemparioEngineRecord | null;
  readonly operacoesResolvidas: readonly TemparioOperationRecord[];
  readonly cadeiaExecucao: DeduplicatedGraphChainResult;
  readonly comparativoPatio: YardRealTimeComparison;
  readonly evidenciasFontes: readonly TemparioEvidenceSourceRecord[];
  readonly statusEvidenciaGlobal: TemparioEvidenceStatus;
  readonly avisoQuarentena?: string;
  readonly diagnosticoPlaca?: string;
  readonly isEstimativaReferencia?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATOS DE TEMPÁRIO HÍBRIDO ABERTO & PROGRESSIVE DISCLOSURE (SPEC 063)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdaptiveTemparioExtraction {
  readonly isTemparioQuery: boolean;
  readonly veiculo?: string;
  readonly motor?: string;
  readonly ano?: number;
  readonly placa?: string;
  readonly osId?: string;
  readonly componentes: readonly string[];
  readonly acaoMecanica?: string;
  readonly promptOriginal: string;
}

export interface LearnedTemparioPackage {
  readonly veiculoMarca: string;
  readonly veiculoModelo: string;
  readonly anoInicio: number;
  readonly anoFim: number;
  readonly geracaoNome?: string;
  readonly motorNome?: string;
  readonly operacaoNome: string;
  readonly tempoPadraoHoras: number;
  readonly passos: readonly {
    readonly ordem: number;
    readonly titulo: string;
    readonly fase: ExecutionPhase;
    readonly tempoHoras: number;
    readonly ferramentas: readonly string[];
    readonly torque?: string;
  }[];
  readonly pecas: readonly TemparioPartItem[];
  readonly ferramentas: readonly string[];
  readonly torques: readonly string[];
  readonly fonteUrlOuNome: string;
}

export type TemparioDetailChoice =
  | 'PECAS'
  | 'FERRAMENTAS'
  | 'PASSOS'
  | 'COMPLETO';

export interface TemparioPendingContext {
  readonly tipo: 'TEMPARIO_DISCLOSURE' | 'TEMPARIO_AWAITING_VEHICLE_FOR_PLATE';
  readonly veiculo: string;
  readonly motor?: string;
  readonly ano?: number;
  readonly placa?: string;
  readonly servicos: readonly string[];
  readonly queryResponse?: TemparioHybridQueryResponse;
  readonly createdAt: string;
}

export interface TemparioPresentationOptions {
  readonly includePecasDirectly?: boolean;
  readonly includeFerramentasDirectly?: boolean;
  readonly includePassosDirectly?: boolean;
  readonly placaConsultada?: string;
}

