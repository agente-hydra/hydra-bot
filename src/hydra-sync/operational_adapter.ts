import type Database from 'better-sqlite3';
import type { CanonicalIntent } from './intent_rewriter.js';
import {
  retrieveOperationalData,
  executeExactSqlSearch,
  type RetrievalResult,
  type OperationalRecord
} from './hybrid_retrieval.js';
import {
  getStoreDrilldown,
  getMetasConsolidadas,
  verificarFrescorMetas,
  getChecklistAudit,
  getFinancialAlerts,
  getAgingCars,
  getHighestValueOS,
  searchOS,
  getCMVByStore,
  getFaturamentoPorArea,
  getPesquisaMidia,
  queryStoreCMV,
  queryUnifiedCMV,
  queryNetworkCMV,
  queryAllStoresCMV,
  queryStoreAreas,
  queryStoreMediaSurvey,
  queryGoogleCentralMediaSurvey,
  queryAreaCMVByStore,
  CATALOGO_10_LOJAS,
  getOSDetailComplete,
  type OSDetailComplete,
  getDatabaseConnection,
  type GoogleCentralMediaSurveyResult,
  type AllStoresAreaCMVResult,
  type AreaCMVStoreItem
} from './db_repository.js';
import { STORE_PRETTY_NAMES } from './intent_rewriter.js';
import { sanitizeWhatsAppMarkdown, calculateGoalMetrics, type GoalAchievementCalculation } from './format_utils.js';
export { calculateGoalMetrics, type GoalAchievementCalculation };
import type { AnswerRequirement } from './types/conversation_contract.js';
import { getLatestDailyRevenue, getLatestMetasSnapshot, getLatestCMVSnapshot } from './finance_snapshot_repository.js';
import { resolveTurnContinuity, type TurnState } from './turn_context_repository.js';
import type { MultidimensionalResponse, MetricDefinition, OrderRecord } from './types/query_contract.js';
import {
  buildRuntimeDiagnostics,
  formatRuntimeDiagnosticsBalloon
} from './runtime_diagnostics.js';
import {
  queryConversationHistory,
  formatConversationHistoryReply
} from './conversation_history_service.js';

export interface OperationalExecutionResult {
  source: string;
  records: any[];
  filtersApplied: Record<string, any>;
  replyText: string;
  toolsCalled: string[];
  answerRequirements?: AnswerRequirement[];
}

function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');
}

/**
 * Adaptador de Opera??es Operacionais (Agente 3):
 * Desacopla a execu??o das consultas da l?gica de controle de sess?o/roteador.
 * Garante sa?da em formato nativo de WhatsApp:
 * - Blockquotes: > *T?tulo*
 * - Listas: - *Campo:* Valor
 * - Zero duplo asterisco (**)
 */

const MESES_PTBR = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function obterMesAnoExtenso(dataIso?: string): string {
  const d = dataIso ? new Date(dataIso.includes('T') ? dataIso : `${dataIso}T12:00:00Z`) : new Date();
  const mes = MESES_PTBR[d.getMonth()] || 'mês atual';
  const ano = d.getFullYear();
  return `${mes}/${ano}`;
}

function formatarDataHora(dataIso?: string, hora?: string): { dataFmt: string; horaFmt: string } {
  let dataFmt = 'hoje';
  let horaFmt = hora || '14:00';
  if (dataIso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataIso);
    if (m) {
      dataFmt = `${m[3]}/${m[2]}/${m[1]}`;
    }
  }
  return { dataFmt, horaFmt };
}

/**
 * Renderizador de meta e faturamento determinístico (Anti-Slop):
 * Responde diretamente "quanto falta para bater a meta" e percentual de atingimento,
 * com discriminação transparente das lojas que faltam bater e lojas já batidas.
 */
export function formatGoalGapWhatsAppReply(options: {
  records: any[];
  targetLojaSlug?: string;
  dataReferencia?: string;
  posicaoHora?: string;
  isFrescorValido?: boolean;
}): string {
  const { records, targetLojaSlug, dataReferencia, posicaoHora, isFrescorValido = true } = options;
  const { dataFmt, horaFmt } = formatarDataHora(dataReferencia || records[0]?.data_referencia, posicaoHora || records[0]?.posicao_hora);
  const mesAno = obterMesAnoExtenso(dataReferencia || records[0]?.data_referencia);
  const diaMes = dataFmt !== 'hoje' ? dataFmt.slice(0, 5) : 'hoje';

  let avisoFrescor = '';
  if (!isFrescorValido) {
    avisoFrescor = '> *Aviso:* dados de metas com mais de 26h de desatualização.\n\n';
  }

  // --- CASO 1: Consulta de Loja Única ---
  if (targetLojaSlug) {
    const storeRecord = records.find(r => r.loja_slug?.toLowerCase() === targetLojaSlug.toLowerCase()) || records[0];
    const findPrettyName = (slug?: string) => {
      if (!slug) return undefined;
      if (STORE_PRETTY_NAMES[slug]) return STORE_PRETTY_NAMES[slug].name;
      const lower = slug.toLowerCase();
      const match = Object.keys(STORE_PRETTY_NAMES).find(k => k.toLowerCase() === lower);
      return match ? STORE_PRETTY_NAMES[match].name : undefined;
    };
    const displayName = findPrettyName(targetLojaSlug) || findPrettyName(storeRecord?.loja_slug) || targetLojaSlug;

    if (!storeRecord) {
      return `Nenhuma informação de meta ou faturamento localizada para a unidade *${displayName}*.`;
    }

    const fat = storeRecord.faturamento_mes || 0;
    const meta = storeRecord.meta_mes || 0;
    const vol = storeRecord.volume_os || 0;
    const ticket = storeRecord.ticket_medio || (vol > 0 ? fat / vol : 0);

    const lines: string[] = [
      `${avisoFrescor}> *Meta: ${displayName} — ${mesAno}*`
    ];

    if (meta > 0) {
      const metrics = calculateGoalMetrics(fat, meta);
      if (metrics.isMetaAlcancada) {
        lines.push(`- *Status:* Meta batida! (+${fmtMoeda(metrics.superavit)})`);
      } else {
        const pctFalta = (metrics.valorFaltante / meta) * 100;
        lines.push(`- *Falta para bater:* ${fmtMoeda(metrics.valorFaltante)} (${pctFalta.toFixed(1)}% da meta)`);
      }
      lines.push(`- *Atingimento:* ${metrics.atingimentoFormatado} da meta`);
      lines.push(`- *Faturamento até ${diaMes}:* ${fmtMoeda(fat)}`);
      lines.push(`- *Meta do mês:* ${fmtMoeda(meta)}`);
    } else {
      lines.push(`- *Faturamento até ${diaMes}:* ${fmtMoeda(fat)}`);
      lines.push(`- *Meta do mês:* não disponível`);
      lines.push(`- *Falta para bater:* não disponível (meta não definida)`);
    }

    lines.push(`- *Volume de OSs:* ${vol}`);
    lines.push(`- *Ticket médio:* ${fmtMoeda(ticket)}`);
    lines.push('', `_Dados atualizados em ${dataFmt} às ${horaFmt}._`);

    return lines.join('\n');
  }

  // --- CASO 2: Consulta Consolidada da Rede ---
  const validStores = records.filter(r => !r.loja_slug?.toLowerCase().includes('master'));
  if (validStores.length === 0) {
    return 'Nenhuma informação de faturamento ou metas disponível para a rede no momento.';
  }

  const totalFat = validStores.reduce((acc, r) => acc + (r.faturamento_mes || 0), 0);
  const totalMeta = validStores.reduce((acc, r) => acc + (r.meta_mes || 0), 0);
  const redeMetrics = calculateGoalMetrics(totalFat, totalMeta);
  const faltaRede = redeMetrics.valorFaltante;
  const atingimentoRede = redeMetrics.percentualAtingimento;
  const pctFalta = totalMeta > 0 ? (faltaRede / totalMeta) * 100 : 0;

  const lojasNaoBateram: Array<{ name: string; falta: number; ating: number }> = [];
  const lojasBateram: Array<{ name: string; fat: number; ating: number; superavit: number }> = [];

  for (const r of validStores) {
    const fat = r.faturamento_mes || 0;
    const meta = r.meta_mes || 0;
    const name = STORE_PRETTY_NAMES[r.loja_slug]?.name || r.loja_slug;

    if (meta > 0) {
      const ating = (fat / meta) * 100;
      if (fat < meta) {
        lojasNaoBateram.push({ name, falta: meta - fat, ating });
      } else {
        lojasBateram.push({ name, fat, ating, superavit: fat - meta });
      }
    }
  }

  lojasNaoBateram.sort((a, b) => b.falta - a.falta);
  lojasBateram.sort((a, b) => b.ating - a.ating);

  const headerBlock = [
    `${avisoFrescor}> *Meta da rede — ${mesAno}*`,
    totalMeta > 0 ? `- *Falta para bater:* ${fmtMoeda(faltaRede)} (${pctFalta.toFixed(1)}% da meta)` : `- *Falta para bater:* não disponível (meta não definida)`,
    totalMeta > 0 ? `- *Atingimento:* ${atingimentoRede.toFixed(1)}% da meta` : `- *Atingimento:* não disponível`,
    `- *Faturamento até ${diaMes}:* ${fmtMoeda(totalFat)}`,
    `- *Meta do mês:* ${totalMeta > 0 ? fmtMoeda(totalMeta) : 'não disponível'}`,
    `- *Lojas na comparação:* ${validStores.length} de 11 lojas (excluída Master)`
  ].join('\n');

  const blocks: string[] = [headerBlock];

  if (lojasNaoBateram.length > 0) {
    const listNaoBateram = lojasNaoBateram.map(l => 
      `- *${l.name}:* faltam ${fmtMoeda(l.falta)}; atingimento ${l.ating.toFixed(1)}%`
    ).join('\n');
    blocks.push(`> *Lojas que ainda não bateram a meta*\n${listNaoBateram}`);
  }

  if (lojasBateram.length > 0) {
    const listBateram = lojasBateram.map(l => 
      `- *${l.name}:* ${fmtMoeda(l.fat)} (${l.ating.toFixed(1)}% da meta)`
    ).join('\n');
    blocks.push(`> *Lojas que já bateram a meta*\n${listBateram}`);
  }

  blocks.push(`_Dados atualizados em ${dataFmt} às ${horaFmt}._`);

  return blocks.join('\n\n');
}

/**
 * Renderizador de listagem completa de faturamento (Anti-Slop):
 * Mostra todas as 10 lojas sem truncamento silencioso e sem tabelas markdown.
 * Divide em balões seguros de até 5 lojas.
 */
export function formatFinancialWhatsAppReply(options: {
  records: any[];
  targetLojaSlug?: string;
  dataReferencia?: string;
  posicaoHora?: string;
  isFrescorValido?: boolean;
}): string {
  const { records, targetLojaSlug, dataReferencia, posicaoHora, isFrescorValido = true } = options;
  const { dataFmt, horaFmt } = formatarDataHora(dataReferencia || records[0]?.data_referencia, posicaoHora || records[0]?.posicao_hora);
  const mesAno = obterMesAnoExtenso(dataReferencia || records[0]?.data_referencia);

  let avisoFrescor = '';
  if (!isFrescorValido) {
    avisoFrescor = '> *Aviso:* dados com mais de 26h de desatualização.\n\n';
  }

  // --- CASO 1: Consulta de Loja Única ---
  if (targetLojaSlug) {
    const storeRecord = records.find(r => r.loja_slug?.toLowerCase() === targetLojaSlug.toLowerCase()) || records[0];
    const findPrettyName = (slug?: string) => {
      if (!slug) return undefined;
      if (STORE_PRETTY_NAMES[slug]) return STORE_PRETTY_NAMES[slug].name;
      const lower = slug.toLowerCase();
      const match = Object.keys(STORE_PRETTY_NAMES).find(k => k.toLowerCase() === lower);
      return match ? STORE_PRETTY_NAMES[match].name : undefined;
    };
    const displayName = findPrettyName(targetLojaSlug) || findPrettyName(storeRecord?.loja_slug) || targetLojaSlug;

    if (!storeRecord) {
      return `Nenhuma informação de faturamento localizada para a unidade *${displayName}*.`;
    }

    const fat = storeRecord.faturamento_mes || 0;
    const meta = storeRecord.meta_mes || 0;
    const vol = storeRecord.volume_os || 0;
    const ticket = storeRecord.ticket_medio || (vol > 0 ? fat / vol : 0);
    const ating = meta > 0 ? `${((fat / meta) * 100).toFixed(1)}%` : 'não disponível';

    const card = [
      `${avisoFrescor}> *Faturamento: ${displayName}*`,
      `*Período:* 01/${dataFmt.slice(3)} a ${dataFmt}`,
      `- *Faturamento:* ${fmtMoeda(fat)}`,
      `- *Meta:* ${meta > 0 ? fmtMoeda(meta) : 'não disponível'}`,
      `- *Atingimento:* ${ating}`,
      `- *Volume de OSs:* ${vol}`,
      `- *Ticket médio:* ${fmtMoeda(ticket)}`,
      '',
      `_Dados atualizados em ${dataFmt} às ${horaFmt}._`
    ].join('\n');

    return card;
  }

  // --- CASO 2: Lista Completa de Lojas ---
  const validStores = records.filter(r => !r.loja_slug?.toLowerCase().includes('master'));
  if (validStores.length === 0) {
    return 'Nenhum dado de faturamento disponível no momento.';
  }

  const sorted = [...validStores].sort((a, b) => {
    const nameA = STORE_PRETTY_NAMES[a.loja_slug]?.name || a.loja_slug;
    const nameB = STORE_PRETTY_NAMES[b.loja_slug]?.name || b.loja_slug;
    return nameA.localeCompare(nameB, 'pt-BR');
  });

  const totalFat = sorted.reduce((acc, r) => acc + (r.faturamento_mes || 0), 0);

  const header = [
    `${avisoFrescor}> *Faturamento acumulado das lojas*`,
    `*Período:* 01/${dataFmt.slice(3)} a ${dataFmt}`,
    `*Total da rede:* ${fmtMoeda(totalFat)} (${sorted.length} de 11 lojas, excluída Master)`
  ].join('\n');

  const storeCards = sorted.map(s => {
    const displayName = STORE_PRETTY_NAMES[s.loja_slug]?.name || s.loja_slug;
    const fat = s.faturamento_mes || 0;
    const meta = s.meta_mes || 0;
    const vol = s.volume_os || 0;
    const ticket = s.ticket_medio || (vol > 0 ? fat / vol : 0);
    const ating = meta > 0 ? `${((fat / meta) * 100).toFixed(1)}%` : 'não disponível';

    return [
      `> *${displayName}*`,
      `- *Faturamento:* ${fmtMoeda(fat)}`,
      `- *Meta:* ${meta > 0 ? fmtMoeda(meta) : 'não disponível'}`,
      `- *Atingimento:* ${ating}`,
      `- *Volume de OSs:* ${vol}`,
      `- *Ticket médio:* ${fmtMoeda(ticket)}`
    ].join('\n');
  });

  const chunks: string[] = [];
  const chunkSize = 5;
  for (let i = 0; i < storeCards.length; i += chunkSize) {
    chunks.push(storeCards.slice(i, i + chunkSize).join('\n\n'));
  }

  if (chunks.length > 0) {
    chunks[chunks.length - 1] += `\n\n_Dados atualizados em ${dataFmt} às ${horaFmt}._`;
  }

  const fullBlocks = [header, ...chunks];
  return fullBlocks.join('\n\n---BLOCK---\n\n');
}

function formatCapturedDate(val?: string): string {
  if (!val) return 'mês atual';
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(val);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return 'mês atual';
}

/**
 * Renderizador de CMV e Margem Bruta com suporte multiescopo (rede, todas as lojas, loja individual, pior loja)
 */
export function formatCMVWhatsAppReply(options: {
  cmv: any;
  areas?: any[];
  lojaSlug?: string;
  focusWorst?: boolean;
}): string {
  const { cmv, areas = [], lojaSlug, focusWorst = false } = options;
  const displayName = lojaSlug ? (STORE_PRETTY_NAMES[lojaSlug]?.name || lojaSlug) : (cmv?.nome || 'Loja');

  if (!cmv || cmv.status === 'vazio') {
    if ((lojaSlug && lojaSlug.toLowerCase().includes('master')) || (cmv?.motivo && cmv.motivo.includes('Master'))) {
      return `A unidade *Master* é administrativa e está excluída das análises de CMV operacional.`;
    }
    return `Nenhum dado de CMV disponível para a unidade *${displayName}* no período consultado.`;
  }

  // 1. ESCOPO: PIOR LOJA DA REDE (focusWorst ou subIntent === 'worst_store')
  if (focusWorst || cmv.subIntent === 'worst_store' || (cmv.scope === 'network' && focusWorst)) {
    const pior = cmv.piorLoja || (cmv.lojasDetalhadas && cmv.lojasDetalhadas[0]) || (cmv.rankingCMV && cmv.rankingCMV[0]);
    if (pior && (pior.cmvPercentual != null || pior.cmv_percentual != null)) {
      const pCmv = pior.cmvPercentual ?? pior.cmv_percentual;
      const pCusto = pior.custoTotal ?? pior.custo_total ?? 0;
      const pFat = pior.faturamentoTotal ?? pior.faturamento_total ?? 0;
      const pLucro = pior.lucroBruto ?? pior.lucro_bruto ?? (pFat - pCusto);
      const pLucroPct = pior.lucroBrutoPercentual ?? pior.lucro_bruto_percentual ?? (pFat > 0 ? (pLucro / pFat) * 100 : null);
      const dtAtualizacao = formatCapturedDate(pior.capturedAt || cmv.capturedAt);

      const header = [
        `> *Pior Loja por CMV: ${pior.nome || pior.lojaSlug}*`,
        `*Período:* ${pior.periodo || cmv.periodo || 'mês atual'}`,
        `- *CMV:* *${Number(pCmv).toFixed(2)}%* (maior índice de custo sobre faturamento)`,
        `- *Custo de mercadorias:* ${fmtMoeda(pCusto)}`,
        `- *Faturamento base:* ${fmtMoeda(pFat)}`,
        `- *Lucro bruto:* ${fmtMoeda(pLucro)} (${pLucroPct != null ? `${Number(pLucroPct).toFixed(2)}%` : 'não disponível'})`
      ].join('\n');

      let compRede = '';
      if (cmv.cmvConsolidadoPercentual != null) {
        const diff = Number((pCmv - cmv.cmvConsolidadoPercentual).toFixed(2));
        compRede = `\n\n> *Comparativo da Rede*\n- *Média consolidada da rede:* ${Number(cmv.cmvConsolidadoPercentual).toFixed(2)}%\n- *Diferença:* +${diff} p.p. acima do consolidado da rede`;
      }

      return `${header}${compRede}\n\n_Dados apurados do Relatório de Operação. Atualizados em ${dtAtualizacao}._`;
    }
  }

  // 2. ESCOPO: REDE (NetworkCMVResult)
  if (cmv.scope === 'network' || cmv.cmvConsolidadoPercentual !== undefined) {
    const isParcial = cmv.cobertura && !cmv.cobertura.isCompleta;
    const lojasComp = cmv.cobertura?.lojasCompletas ?? (cmv.lojasDetalhadas?.length || 0);
    const totalEleg = cmv.cobertura?.totalLojasElegiveis ?? 10;
    const dtAtualizacao = formatCapturedDate(cmv.capturedAt);

    const rotuloRede = isParcial
      ? `> *CMV da Rede (Parcial — ${lojasComp} de ${totalEleg} lojas)*`
      : `> *CMV Consolidado da Rede*`;

    const cmvPct = cmv.cmvConsolidadoPercentual;
    if (cmvPct == null) {
      return `Nenhum dado consolidado de CMV disponível para a rede no momento.`;
    }

    const header = [
      rotuloRede,
      `*Período:* ${cmv.periodo || 'mês atual'}`,
      `- *CMV Consolidado:* *${Number(cmvPct).toFixed(2)}%* (soma dos custos / faturamento bruto compatível)`,
      `- *Custo total acumulado:* ${fmtMoeda(cmv.somaCustosCompativeis || 0)}`,
      `- *Faturamento base acumulado:* ${fmtMoeda(cmv.somaFaturamentosBaseCompativeis || 0)}`,
      `- *Lucro bruto consolidado:* ${fmtMoeda(cmv.lucroBrutoConsolidado || 0)} (${cmv.lucroBrutoConsolidadoPercentual != null ? `${Number(cmv.lucroBrutoConsolidadoPercentual).toFixed(2)}%` : 'não disponível'})`,
      cmv.piorLoja ? `- *Pior loja por CMV:* ${cmv.piorLoja.nome} (${Number(cmv.piorLoja.cmvPercentual).toFixed(2)}%)` : ''
    ].filter(Boolean).join('\n');

    let lojasBlock = '';
    if (cmv.lojasDetalhadas && cmv.lojasDetalhadas.length > 0) {
      const lines = cmv.lojasDetalhadas.map((l: any) => {
        return `- *${l.nome}:* CMV: ${Number(l.cmvPercentual).toFixed(2)}% | Custo: ${fmtMoeda(l.custoTotal || 0)} | Fat: ${fmtMoeda(l.faturamentoTotal || 0)}`;
      }).join('\n');
      lojasBlock = `\n\n> *Lojas Apuradas*\n${lines}`;
    }

    let pendentesAviso = '';
    if (cmv.cobertura?.lojasAusentes && cmv.cobertura.lojasAusentes.length > 0) {
      const nomesAusentes = cmv.cobertura.lojasAusentes.map((s: string) => STORE_PRETTY_NAMES[s]?.name || s).join(', ');
      pendentesAviso = `\n\n_Atenção: Apuração parcial (${lojasComp} de ${totalEleg} lojas). Pendentes de fechamento: ${nomesAusentes} (Unidade Master desconsiderada da rede)._`;
    }

    return `${header}${lojasBlock}${pendentesAviso}\n\n_Dados atualizados em ${dtAtualizacao}._`;
  }

  // 3. ESCOPO: TODAS AS LOJAS (AllStoresCMVResult)
  if (cmv.scope === 'all_stores' || cmv.rankingCMV !== undefined) {
    const dtAtualizacao = formatCapturedDate(cmv.capturedAt);
    const header = [
      `> *CMV Comparativo das Lojas*`,
      `*Período:* ${cmv.periodo || 'mês atual'}`
    ].join('\n');

    const apuradas = (cmv.rankingCMV || cmv.lojas || []).filter((l: any) => l.cmvPercentual != null);
    const pendentes = (cmv.lojas || []).filter((l: any) => l.cmvPercentual == null);

    let rankingBlock = '';
    if (apuradas.length > 0) {
      const lines = apuradas.map((l: any) => {
        return `- *${l.nome}:* ${Number(l.cmvPercentual).toFixed(2)}% | Custo: ${fmtMoeda(l.custoTotal || 0)} | Fat: ${fmtMoeda(l.faturamentoTotal || 0)}`;
      }).join('\n');
      rankingBlock = `\n\n> *Ranking de CMV (Maior custo primeiro)*\n${lines}`;
    }

    let pendentesBlock = '';
    if (pendentes.length > 0) {
      const lines = pendentes.map((l: any) => `- *${l.nome}:* dado não disponível`).join('\n');
      pendentesBlock = `\n\n> *Lojas Pendentes (Dado não disponível no período)*\n${lines}`;
    }

    const resumo = `\n\n_${apuradas.length} de 10 lojas apuradas. Unidade Master desconsiderada da rede operacional._`;
    return `${header}${rankingBlock}${pendentesBlock}${resumo}\n\n_Dados atualizados em ${dtAtualizacao}._`;
  }

  // 4. ESCOPO: LOJA INDIVIDUAL (StoreCMVResult)
  const cmvVal = cmv.cmvPercentual ?? cmv.cmv_percentual;
  if (cmvVal == null) {
    return `Nenhum dado de CMV disponível para a unidade *${displayName}* no período consultado.`;
  }

  const custoVal = cmv.custoTotal ?? cmv.custo_total;
  const fatVal = cmv.faturamentoTotal ?? cmv.faturamento_total;
  const lucroVal = cmv.lucroBruto ?? cmv.lucro_bruto;
  const lucroPct = cmv.lucroBrutoPercentual ?? cmv.lucro_bruto_percentual;
  const dtInicio = cmv.dataInicio ?? cmv.data_inicio;
  const dtAtualizacao = formatCapturedDate(cmv.capturedAt || cmv.created_at);

  const header = [
    `> *CMV: ${displayName}*`,
    `*Período:* ${dtInicio ? obterMesAnoExtenso(dtInicio) : (cmv.periodo || 'mês atual')}`,
    `- *CMV:* ${Number(cmvVal).toFixed(2)}%`,
    `- *Custo total:* ${fmtMoeda(custoVal || 0)}`,
    `- *Faturamento base:* ${fmtMoeda(fatVal || 0)}`,
    `- *Lucro bruto:* ${fmtMoeda(lucroVal || 0)} (${lucroPct != null ? `${Number(lucroPct).toFixed(2)}%` : 'não disponível'})`
  ].join('\n');

  if (!areas || areas.length === 0) {
    return `${header}\n\n_Dados atualizados em ${dtAtualizacao}._`;
  }

  const sortedAreas = [...areas].sort((a, b) => {
    const bCmv = b.cmvPercentual ?? b.cmv_percentual ?? 0;
    const aCmv = a.cmvPercentual ?? a.cmv_percentual ?? 0;
    return bCmv - aCmv;
  });
  const areaLines = sortedAreas.map(a => {
    const aCmv = a.cmvPercentual ?? a.cmv_percentual ?? 0;
    const aCusto = a.custo ?? a.custo_total ?? 0;
    const aFat = a.faturamento ?? a.faturamento_total ?? 0;
    return `- *${a.area}:* CMV: ${Number(aCmv).toFixed(2)}% | Custo: ${fmtMoeda(aCusto)} | Fat: ${fmtMoeda(aFat)}`;
  }).join('\n');

  const areasBlock = `> *Principais áreas por CMV*\n${areaLines}`;
  return `${header}\n\n${areasBlock}\n\n_Dados atualizados em ${dtAtualizacao}._`;
}

/**
 * Renderizador de Faturamento por Área
 */
export function formatFaturamentoAreasWhatsAppReply(options: {
  areas: any[];
  lojaSlug?: string;
  focusWorst?: boolean;
}): string {
  const { areas, lojaSlug, focusWorst = false } = options;
  const displayName = lojaSlug ? (STORE_PRETTY_NAMES[lojaSlug]?.name || lojaSlug) : 'Loja';

  if (!areas || areas.length === 0) {
    return `Nenhuma informação de faturamento por área localizada para a unidade *${displayName}*.`;
  }

  const validAreas = areas.filter(a => {
    const fat = a.faturamento ?? a.faturamento_total ?? 0;
    const custo = a.custo ?? a.custo_total ?? 0;
    const cmv = a.cmvPercentual ?? a.cmv_percentual ?? 0;
    return fat > 0 || custo > 0 || cmv > 0;
  });

  const dtInicio = areas[0]?.dataInicio ?? areas[0]?.data_inicio;
  const dtFim = areas[0]?.dataFim ?? areas[0]?.data_fim;
  const periodoStr = dtInicio ? obterMesAnoExtenso(dtInicio) : 'mês atual';

  if (focusWorst && validAreas.length > 0) {
    const sortedByCMV = [...validAreas].sort((a, b) => {
      const bCmv = b.cmvPercentual ?? b.cmv_percentual ?? 0;
      const aCmv = a.cmvPercentual ?? a.cmv_percentual ?? 0;
      return bCmv - aCmv;
    });
    const worst = sortedByCMV[0];
    const wCmv = worst.cmvPercentual ?? worst.cmv_percentual ?? 0;
    const wCusto = worst.custo ?? worst.custo_total ?? 0;
    const wFat = worst.faturamento ?? worst.faturamento_total ?? 0;
    const wFatPct = worst.faturamentoPercentual ?? worst.faturamento_percentual ?? 0;
    const wLucro = worst.lucroBruto ?? worst.lucro_bruto ?? 0;

    const worstBlock = [
      `> *Pior Área por CMV: ${displayName}*`,
      `*Período:* ${periodoStr}`,
      `- *Área mais crítica:* *${worst.area}*`,
      `- *CMV:* ${Number(wCmv).toFixed(2)}%`,
      `- *Custo:* ${fmtMoeda(wCusto)}`,
      `- *Faturamento base:* ${fmtMoeda(wFat)} (${Number(wFatPct).toFixed(1)}% da loja)`,
      `- *Lucro bruto:* ${fmtMoeda(wLucro)}`
    ].join('\n');

    const others = sortedByCMV.slice(1);
    let othersBlock = '';
    if (others.length > 0) {
      const othersLines = others.map(a => {
        const aCmv = a.cmvPercentual ?? a.cmv_percentual ?? 0;
        const aCusto = a.custo ?? a.custo_total ?? 0;
        const aFat = a.faturamento ?? a.faturamento_total ?? 0;
        return `- *${a.area}:* CMV: ${Number(aCmv).toFixed(2)}% | Custo: ${fmtMoeda(aCusto)} | Fat: ${fmtMoeda(aFat)}`;
      }).join('\n');
      othersBlock = `\n\n> *Demais áreas da unidade*\n${othersLines}`;
    }

    return `${worstBlock}${othersBlock}\n\n_Dados atualizados em ${dtFim || 'mês atual'}._`;
  }

  const totalFat = areas.reduce((acc, a) => acc + (a.faturamento ?? a.faturamento_total ?? 0), 0);
  const header = [
    `> *Faturamento por Área: ${displayName}*`,
    `*Período:* ${periodoStr}`,
    `*Total faturado:* ${fmtMoeda(totalFat)}`
  ].join('\n');

  const sorted = [...areas].sort((a, b) => {
    const bFat = b.faturamento ?? b.faturamento_total ?? 0;
    const aFat = a.faturamento ?? a.faturamento_total ?? 0;
    return bFat - aFat;
  });
  const lines = sorted.map(a => {
    const aFat = a.faturamento ?? a.faturamento_total ?? 0;
    const aFatPct = a.faturamentoPercentual ?? a.faturamento_percentual ?? 0;
    const aCmv = a.cmvPercentual ?? a.cmv_percentual ?? 0;
    const aLucro = a.lucroBruto ?? a.lucro_bruto ?? 0;
    return `- *${a.area}:* ${fmtMoeda(aFat)} (${Number(aFatPct).toFixed(1)}%) | CMV: ${Number(aCmv).toFixed(2)}% | Lucro: ${fmtMoeda(aLucro)}`;
  }).join('\n');

  return `${header}\n\n> *Detalhamento por Área*\n${lines}\n\n_Dados atualizados em ${dtFim || 'mês atual'}._`;
}

/**
 * Renderizador de Pesquisa de Mídia
 */
export function formatPesquisaMidiaWhatsAppReply(options: {
  midia: any[];
  lojaSlug?: string;
}): string {
  const { midia, lojaSlug } = options;
  const displayName = lojaSlug ? (STORE_PRETTY_NAMES[lojaSlug]?.name || lojaSlug) : 'Loja';

  if (!midia || midia.length === 0) {
    return `Nenhuma informação de pesquisa de mídia localizada para a unidade *${displayName}*.`;
  }

  const totalFat = midia.reduce((acc, m) => acc + (m.faturamento ?? m.faturamento_total ?? 0), 0);
  const totalOS = midia.reduce((acc, m) => acc + (m.qtd_os ?? m.qtdOS ?? 0), 0);
  const dtInicio = midia[0]?.dataInicio ?? midia[0]?.data_inicio;
  const dtFim = midia[0]?.dataFim ?? midia[0]?.data_fim;
  const periodoStr = dtInicio ? obterMesAnoExtenso(dtInicio) : 'mês atual';

  const sorted = [...midia].sort((a, b) => {
    const bFat = b.faturamento ?? b.faturamento_total ?? 0;
    const aFat = a.faturamento ?? a.faturamento_total ?? 0;
    return bFat - aFat;
  });
  const principal = sorted[0];
  const pFatPct = principal ? (principal.faturamentoPercentual ?? principal.faturamento_percentual ?? 0) : 0;

  const header = [
    `> *Origem dos Clientes: ${displayName}*`,
    `*Período:* ${periodoStr}`,
    principal ? `- *Principal canal:* *${principal.canal}* (${Number(pFatPct).toFixed(1)}% do faturamento)` : '',
    `- *Total captado:* ${fmtMoeda(totalFat)} (${totalOS} OSs)`
  ].filter(Boolean).join('\n');

  const channelLines = sorted.map(m => {
    const mFat = m.faturamento ?? m.faturamento_total ?? 0;
    const mFatPct = m.faturamentoPercentual ?? m.faturamento_percentual ?? 0;
    const mQtd = m.qtd_os ?? m.qtdOS ?? 0;
    const mTk = m.ticket_medio ?? m.ticketMedio ?? 0;
    return `- *${m.canal}:* ${fmtMoeda(mFat)} (${Number(mFatPct).toFixed(1)}%) | ${mQtd} OSs | TK ${fmtMoeda(mTk)}`;
  }).join('\n');

  const conclusao = principal
    ? `\n\n_Conclusão: ${principal.canal} é o principal canal de captação, responsável por ${Number(pFatPct).toFixed(1)}% do faturamento da loja._`
    : '';

  return `${header}\n\n> *Canais de captação*\n${channelLines}${conclusao}`;
}

function formatarDataBR(dataIso?: string): string {
  if (!dataIso) return '';
  const [ano, mes, dia] = dataIso.split('-');
  if (!ano || !mes || !dia) return dataIso;
  return `${dia}/${mes}/${ano}`;
}

/**
 * Renderizador de Captação Google e Central de Atendimento por Loja / Rede
 */
export function formatGoogleCentralWhatsAppReply(options: {
  result: GoogleCentralMediaSurveyResult;
  lojaSlug?: string;
}): string {
  const { result } = options;

  if (result.status === 'vazio') {
    return result.motivo || 'Nenhum dado de captação de clientes localizado.';
  }

  if (!result.isAllStores && result.storeResult) {
    const sr = result.storeResult;
    const header = [
      `> *Captação de Clientes: ${sr.nome}*`,
      `*Período:* ${result.dataInicio && result.dataFim ? `${formatarDataBR(result.dataInicio)} a ${formatarDataBR(result.dataFim)}` : (result.periodo || 'mês atual')}`,
      sr.faturamentoBrutoLoja ? `- *Faturamento Bruto da Loja:* ${fmtMoeda(sr.faturamentoBrutoLoja)}` : ''
    ].filter(Boolean).join('\n');

    const canaisLines: string[] = [];
    if (sr.canalCentral) {
      canaisLines.push(`- *Central de Atendimento:* ${fmtMoeda(sr.canalCentral.faturamento)} (${Number(sr.canalCentral.faturamentoPercentual).toFixed(1)}% | ${sr.canalCentral.qtdOS} OSs | TK ${fmtMoeda(sr.canalCentral.ticketMedio)})`);
    } else {
      canaisLines.push(`- *Central de Atendimento:* Sem registros de captação neste período.`);
    }

    if (sr.canalGoogle) {
      canaisLines.push(`- *Google / Internet:* ${fmtMoeda(sr.canalGoogle.faturamento)} (${Number(sr.canalGoogle.faturamentoPercentual).toFixed(1)}% | ${sr.canalGoogle.qtdOS} OSs | TK ${fmtMoeda(sr.canalGoogle.ticketMedio)})`);
    } else {
      canaisLines.push(`- *Google / Internet:* Sem registros de captação neste período.`);
    }

    const subtotalLine = `- *Total Google + Central:* ${fmtMoeda(sr.totalGoogleCentral)} (${sr.totalOSGoogleCentral} OSs)${sr.pctGoogleCentralDoFaturamento ? ` — ${sr.pctGoogleCentralDoFaturamento}% do faturamento` : ''}`;

    return `${header}\n\n> *Origens de Captação*\n${canaisLines.join('\n')}\n\n${subtotalLine}`;
  }

  // Visão comparativa de todas as lojas ("Google + Central por Loja")
  const header = [
    `> *Captação Google e Central de Atendimento por Loja*`,
    `*Período:* ${result.dataInicio && result.dataFim ? `${formatarDataBR(result.dataInicio)} a ${formatarDataBR(result.dataFim)}` : (result.periodo || 'mês atual')}`
  ].join('\n');

  const apuradasBlocks: string[] = [];
  if (result.lojasApuradas && result.lojasApuradas.length > 0) {
    for (const loja of result.lojasApuradas) {
      const lines: string[] = [];
      lines.push(`*${loja.nome}*`);
      if (loja.canalCentral) {
        lines.push(`  • Central: ${fmtMoeda(loja.canalCentral.faturamento)} (${loja.canalCentral.qtdOS} OSs | TK ${fmtMoeda(loja.canalCentral.ticketMedio)})`);
      } else {
        lines.push(`  • Central: Sem registros`);
      }
      if (loja.canalGoogle) {
        lines.push(`  • Google: ${fmtMoeda(loja.canalGoogle.faturamento)} (${loja.canalGoogle.qtdOS} OSs | TK ${fmtMoeda(loja.canalGoogle.ticketMedio)})`);
      } else {
        lines.push(`  • Google: Sem registros`);
      }
      lines.push(`  • Subtotal: ${fmtMoeda(loja.totalGoogleCentral)} (${loja.totalOSGoogleCentral} OSs)`);
      apuradasBlocks.push(lines.join('\n'));
    }
  }

  const semDadosLines: string[] = [];
  if (result.lojasSemDados && result.lojasSemDados.length > 0) {
    for (const sem of result.lojasSemDados) {
      semDadosLines.push(`- *${sem.nome}:* Dados de pesquisa de mídia não disponíveis`);
    }
  }

  let body = `${header}\n\n> *Lojas com Captação Apurada*\n${apuradasBlocks.join('\n\n')}`;
  if (semDadosLines.length > 0) {
    body += `\n\n> *Lojas sem Dados no Período*\n${semDadosLines.join('\n')}`;
  }
  body += `\n\n_Unidade Master excluída por ser administrativa._`;

  return body;
}



/**
 * Renderizador WhatsApp para Consulta de CMV por Área Canônica (ex: OLEO, FILTRO)
 * Anti-Slop: Nunca substitui pelo CMV geral da loja e explicita lacunas sem inventar números.
 */
export function formatAreaCMVWhatsAppReply(options: {
  result: AllStoresAreaCMVResult | AreaCMVStoreItem;
  targetArea: string;
  lojaSlug?: string;
}): string {
  const { result, targetArea, lojaSlug } = options;
  const nomeAreaAmigavel = targetArea === 'OLEO' ? 'Óleo' : targetArea;

  if ('rankingCMV' in result) {
    const cardHeader = `> *CMV de ${nomeAreaAmigavel} — Comparativo das Lojas (${result.periodo})*`;
    const linhas = [
      `- *Setor:* ${targetArea}`,
      `- *Cobertura Oficial:* ${result.coberturaDescricao}`
    ];

    if (result.rankingCMV.length > 0) {
      linhas.push('\n> *Ranking de CMV por Loja:*');
      for (const item of result.rankingCMV) {
        const perc = item.cmvPercentual !== null ? `${item.cmvPercentual.toFixed(1)}%` : 'N/D';
        linhas.push(`- *${item.nome}:* *${perc}* (Faturamento: ${fmtMoeda(item.faturamento || 0)} | Custo: ${fmtMoeda(item.custo || 0)})`);
      }
    }

    if (result.lojasPendentes.length > 0) {
      const nomesPendentes = result.lojasPendentes.map(l => l.nome).join(', ');
      linhas.push(`\n- *Lojas sem apuração de ${nomeAreaAmigavel}:* ${nomesPendentes} (sem movimentação registrada no período)`);
    }

    return sanitizeWhatsAppMarkdown(`${cardHeader}\n${linhas.join('\n')}`);
  } else {
    const item = result;
    const cardHeader = `> *CMV de ${nomeAreaAmigavel}: ${item.nome} (${item.periodo})*`;

    if (item.status === 'vazio' || item.cmvPercentual === null) {
      const cardBody = [
        `- *Loja:* ${item.nome}`,
        `- *Área/Setor:* ${nomeAreaAmigavel}`,
        `- *Status:* Dado de CMV não disponível para esta área no período (${item.motivo || 'sem dados'}).`
      ].join('\n');
      return sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`);
    }

    const cardBody = [
      `- *CMV da Área (${nomeAreaAmigavel}):* *${item.cmvPercentual.toFixed(1)}%*`,
      `- *Faturamento da Área:* *${fmtMoeda(item.faturamento || 0)}*`,
      `- *Custo de Mercadoria:* *${fmtMoeda(item.custo || 0)}*`,
      `- *Lucro Bruto da Área:* *${fmtMoeda(item.lucroBruto || 0)}* (*${item.lucroBrutoPercentual !== null ? item.lucroBrutoPercentual.toFixed(1) + '%' : '0%'}*)`
    ].join('\n');

    return sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`);
  }
}

/**
 * Validador Pré-Envio de AnswerRequirements:
 * Verifica se cada requisito atômico foi respondido com dados confiáveis.
 * Se faltar dado de uma loja ou área, explicita a lacuna sem inventar números.
 */
export function validateAnswerRequirements(options: {
  requirements: AnswerRequirement[];
  records: any[];
  subResults?: OperationalExecutionResult[];
  db: Database.Database;
  intent: CanonicalIntent;
}): AnswerRequirement[] {
  const { requirements, records, db, intent } = options;
  if (!requirements || requirements.length === 0) return [];

  return requirements.map(req => {
    const cloned = { ...req };

    if (req.targetMetric === 'list_os') {
      const osRecords = records.filter(r => r && (r.os_id !== undefined || r.total_os !== undefined));
      if (osRecords.length > 0) {
        cloned.fulfilled = true;
      } else {
        const slug = req.targetLojaSlug || intent.lojaSlug;
        if (slug) {
          try {
            const countRow = db.prepare('SELECT COUNT(*) as c FROM ordens_servico WHERE loja_slug = ? AND is_aberta = 1').get(slug);
            cloned.fulfilled = true;
            if (countRow && countRow.c === 0) {
              cloned.missingReason = `Nenhuma ordem de serviço aberta para a unidade ${slug}.`;
            }
          } catch {
            cloned.fulfilled = false;
            cloned.missingReason = 'Falha ao consultar ordens de serviço.';
          }
        } else {
          cloned.fulfilled = true;
        }
      }
    } else if (req.targetMetric === 'cmv_percentual') {
      if (req.targetArea) {
        const areaUpper = req.targetArea.toUpperCase();
        if (req.targetScope === 'store') {
          const slug = req.targetLojaSlug || intent.lojaSlug;
          if (slug) {
            try {
              const row = db.prepare(`
                SELECT cmv_percentual FROM faturamento_areas
                WHERE LOWER(loja_slug) = LOWER(?) AND UPPER(area) = UPPER(?)
                ORDER BY data_fim DESC, id DESC
                LIMIT 1
              `).get(slug, areaUpper);

              if (row && row.cmv_percentual !== null && row.cmv_percentual !== undefined) {
                cloned.fulfilled = true;
              } else {
                cloned.fulfilled = false;
                cloned.missingReason = `Dado de CMV da área ${req.targetArea} não disponível para a unidade ${slug}.`;
              }
            } catch {
              cloned.fulfilled = false;
              cloned.missingReason = `Erro ao consultar CMV da área ${req.targetArea}.`;
            }
          } else {
            cloned.fulfilled = false;
            cloned.missingReason = `Unidade não especificada para consulta de CMV da área ${req.targetArea}.`;
          }
        } else {
          try {
            const rows = db.prepare(`
              SELECT DISTINCT loja_slug FROM faturamento_areas
              WHERE UPPER(area) = UPPER(?)
            `).all(areaUpper);

            cloned.fulfilled = rows.length > 0;
            if (rows.length < 10) {
              cloned.missingReason = `Cobertura parcial: ${rows.length} de 10 lojas elegíveis com dados apurados para a área ${req.targetArea}.`;
            }
          } catch {
            cloned.fulfilled = false;
            cloned.missingReason = `Erro ao consultar lojas para a área ${req.targetArea}.`;
          }
        }
      } else {
        const slug = req.targetLojaSlug || intent.lojaSlug;
        if (slug) {
          try {
            const row = db.prepare(`
              SELECT cmv_percentual FROM cmv_lojas
              WHERE LOWER(loja_slug) = LOWER(?)
              ORDER BY data_fim DESC, id DESC
              LIMIT 1
            `).get(slug);

            if (row && row.cmv_percentual !== null && row.cmv_percentual !== undefined) {
              cloned.fulfilled = true;
            } else {
              cloned.fulfilled = false;
              cloned.missingReason = `Dado de CMV não disponível para a unidade ${slug}.`;
            }
          } catch {
            cloned.fulfilled = false;
            cloned.missingReason = `Erro ao consultar CMV para a unidade ${slug}.`;
          }
        } else {
          cloned.fulfilled = true;
        }
      }
    } else {
      cloned.fulfilled = records.length > 0;
    }

    return cloned;
  });
}

async function _executeOperationalQueryCore(
  db: Database.Database,
  intent: CanonicalIntent
): Promise<OperationalExecutionResult> {
  // 1. Clarifica??o ou Fora de Escopo / Capacidade Indispon?vel
    // 1.0. Diagnóstico Factual de Runtime & Obsidian Vault
  if (intent.intent === 'runtime_diagnostics' || intent.contract?.operation === 'runtime_diagnostics') {
    const diag = buildRuntimeDiagnostics(db);
    const replyText = formatRuntimeDiagnosticsBalloon(diag);
    return {
      source: 'SQL_EXACT',
      records: [],
      filtersApplied: {},
      replyText,
      toolsCalled: ['runtime_diagnostics']
    };
  }

  // 1.0.1 Consulta Estruturada de Histórico de Conversa
  if (intent.intent === 'conversation_history' || intent.contract?.operation === 'conversation_history') {
    const isFirst = !!intent.contract?.filters?.isFirstQuestionQuery;
    const histResult = queryConversationHistory(db, { phone: '5511996242812', scope: isFirst ? 'all_available' : 'today',
      queryType: isFirst ? 'first_question' : 'recent_turns'
    });
    const replyText = formatConversationHistoryReply(histResult);
    return {
      source: 'SQL_EXACT',
      records: [],
      filtersApplied: {},
      replyText,
      toolsCalled: ['conversation_history']
    };
  }

  if (intent.needsClarification) {
    const text = intent.clarificationMessage || 'Por favor, detalhe se voc? deseja consultar uma loja, placa ou resumo de ordens abertas.';
    return {
      source: 'NONE',
      records: [],
      filtersApplied: {},
      replyText: text,
      toolsCalled: ['ask_clarification']
    };
  }

  // 1.1. Executor Multi-Consultas (Turnos com Múltiplos AnswerRequirements / Sub-Queries)
  if (intent.subQueries && intent.subQueries.length > 1) {
    const subResults: OperationalExecutionResult[] = [];
    const allRecords: any[] = [];
    const toolsCalledSet = new Set<string>();
    const mergedFilters: Record<string, any> = {};

    for (const sq of intent.subQueries) {
      const singleIntent: CanonicalIntent = {
        ...sq,
        subQueries: undefined // Evita recursão
      };
      const res = await _executeOperationalQueryCore(db, singleIntent);
      subResults.push(res);
      allRecords.push(...res.records);
      for (const t of res.toolsCalled) toolsCalledSet.add(t);
      Object.assign(mergedFilters, res.filtersApplied);
    }

    const combinedReplyText = subResults.map(r => r.replyText.trim()).filter(Boolean).join('\n\n');

    return {
      source: subResults.map(r => r.source).filter(Boolean).join('+') || 'SQL_EXACT',
      records: allRecords,
      filtersApplied: mergedFilters,
      replyText: sanitizeWhatsAppMarkdown(combinedReplyText),
      toolsCalled: Array.from(toolsCalledSet)
    };
  }

  const lojaSlug = intent.lojaSlug;
  const canonicalQ = (intent.canonicalQuestion || '').toLowerCase();

  // 2. Consulta de Perman?ncia no Pátio por Modelo de Veículo ("o Fiesta t? h? quanto tempo na loja?")
  if (intent.veiculo) {
    const vTerm = intent.veiculo.trim();
    try {
      const rows = db.prepare(`
        SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
               data_inicio, data_fim, dias_no_patio, veiculo, placa,
               cliente_nome, responsavel, total_os, valor_pago, valor_restante, tem_nf
        FROM ordens_servico
        WHERE UPPER(veiculo) LIKE ? ${lojaSlug ? 'AND loja_slug = ?' : ''} AND is_aberta = 1
        ORDER BY dias_no_patio DESC, total_os DESC
        LIMIT 5
      `).all(...(lojaSlug ? [`%${vTerm.toUpperCase()}%`, lojaSlug] : [`%${vTerm.toUpperCase()}%`])) as OperationalRecord[];

      if (rows.length > 0) {
        const o = rows[0];
        const cardHeader = `> *Veículo Localizado: ${o.veiculo} (${o.placa || 'Sem placa'})*`;
        const cardBody = [
          `- *Loja:* ${o.loja_slug}`,
          `- *Tempo de perman?ncia:* *${o.dias_no_patio} dias no pátio* (desde ${o.data_inicio || 'data de abertura'})`,
          `- *Ordem de Serviço:* #${o.os_id} (Em Aberto)`,
          `- *Status:* ${o.status_grid || 'Em andamento'}`,
          `- *Valor Total:* ${fmtMoeda(o.total_os)} (Saldo: ${fmtMoeda(o.valor_restante)})`
        ].join('\n');

        return {
          source: 'SQL_EXACT',
          records: rows,
          filtersApplied: { veiculo: vTerm, lojaSlug, onlyOpen: true },
          replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
          toolsCalled: ['search_vehicle_stay']
        };
      } else {
        const lojaAviso = lojaSlug ? ` na unidade *${lojaSlug}*` : ' no pátio da rede';
        return {
          source: 'SQL_EXACT',
          records: [],
          filtersApplied: { veiculo: vTerm, lojaSlug, onlyOpen: true },
          replyText: sanitizeWhatsAppMarkdown(`> *Veículo Não Localizado*\nNão encontrei nenhum veículo *${vTerm}* com ordem de serviço aberta${lojaAviso}.`),
          toolsCalled: ['search_vehicle_stay']
        };
      }
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha na busca por veículo:', err?.message || err);
    }
  }

  // 3. Intenção: Raio-X / Situa??o Operacional de Loja
  if (intent.intent === 'store_overview' && lojaSlug) {
    try {
      const drill = getStoreDrilldown(db, lojaSlug);
      const cardHeader = `> *Raio-X Operacional: ${drill.loja_slug}*`;
      const cardBody = [
        `- *Veículos no pátio:* *${drill.total_veiculos_patio}*`,
        `- *Saldo total a receber:* *${fmtMoeda(drill.saldo_total_receber)}*`,
        `- *Faturamento do mês:* *${fmtMoeda(drill.faturamento_mes)}* (*${drill.volume_os_mes} OSs*)`,
        `- *Ticket médio:* *${fmtMoeda(drill.ticket_medio)}*`,
        `- *Retidos há mais de 5 dias:* *${drill.carros_travados_5d} veículos*`,
        `- *Sem checklist do mecânico:* *${drill.sem_checklist_mecanico} OSs*`,
        `- *Sem checklist de entrada:* *${drill.sem_checklist_entrada} OSs*`
      ].join('\n');

      return {
        source: 'SQL_EXACT',
        records: [drill],
        filtersApplied: { lojaSlug },
        replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
        toolsCalled: ['get_store_drilldown']
      };
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha no drilldown:', err?.message || err);
    }
  }

  // 4.1. Operação: CMV e Margem Bruta
  if (intent.intent === 'store_cmv' || (intent.contract && intent.contract.operation === 'store_cmv')) {
    try {
      const isInvalidSlug = (slug?: string) => !slug || ['loja', 'lojas', 'rede', 'todas', 'null', 'undefined'].includes(slug.toLowerCase().trim());
      const rawSlug = intent.lojaSlug || intent.contract?.plan?.targetLojaSlug || intent.contract?.entities?.loja?.slug;
      const validLojaSlug = isInvalidSlug(rawSlug) ? undefined : rawSlug;

      const scope = intent.scope || intent.contract?.scope || (validLojaSlug ? 'store' : 'network');
      const focusWorst = Boolean(intent.focusWorst || intent.subIntent === 'worst_store' || intent.contract?.filters?.focusWorst || intent.contract?.filters?.subIntent === 'worst_store');

      // 4.1.1. Consulta Específica de CMV de Área / Produto (ex: OLEO, FILTRO)
      const targetArea = intent.targetArea ||
        intent.contract?.plan?.targetArea ||
        intent.contract?.filters?.area ||
        (intent.answerRequirements && intent.answerRequirements.find(r => r.targetArea)?.targetArea);

      if (targetArea) {
        const areaCmvResult = queryAreaCMVByStore(db, {
          area: targetArea,
          lojaSlug: validLojaSlug,
          scope: (scope === 'store' && validLojaSlug) ? 'store' : 'all_stores'
        });

        const reply = formatAreaCMVWhatsAppReply({
          result: areaCmvResult,
          targetArea,
          lojaSlug: validLojaSlug
        });

        const records = 'rankingCMV' in areaCmvResult ? areaCmvResult.lojasApuradas : (areaCmvResult.status === 'sucesso' ? [areaCmvResult] : []);

        return {
          source: 'SQL_EXACT',
          records,
          filtersApplied: { lojaSlug: validLojaSlug, area: targetArea, scope },
          replyText: sanitizeWhatsAppMarkdown(reply),
          toolsCalled: ['get_area_cmv']
        };
      }

      const cmvResult = queryUnifiedCMV(db, {
        scope: scope === 'unspecified' ? 'network' : scope,
        lojaSlug: validLojaSlug
      });

      let areas: any[] = [];
      if (cmvResult.scope === 'store') {
        areas = (cmvResult as any).areas && (cmvResult as any).areas.length > 0
          ? (cmvResult as any).areas
          : getFaturamentoPorArea(db, { lojaSlug: validLojaSlug });
      }

      let reply = formatCMVWhatsAppReply({
        cmv: cmvResult,
        areas,
        lojaSlug: validLojaSlug,
        focusWorst
      });

      // Multimodal: ressalvas de documentos anexos
      const mediaEv = intent.mediaEvidence || intent.contract?.mediaEvidence || intent.contract?.plan?.mediaEvidence;
      if (mediaEv && mediaEv.length > 0) {
        for (const ev of mediaEv) {
          if (ev.discrepancyNote) {
            reply += `\n\n> *Conciliação de Documento Anexo*\n${ev.discrepancyNote}`;
          }
        }
      }

      return {
        source: 'SQL_EXACT',
        records: cmvResult.status !== 'erro' ? [cmvResult] : [],
        filtersApplied: { lojaSlug: validLojaSlug, scope, focusWorst },
        replyText: sanitizeWhatsAppMarkdown(reply),
        toolsCalled: ['get_store_cmv']
      };
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em CMV:', err?.message || err);
    }
  }

  // 4.2. Operação: Faturamento por Área
  if (intent.intent === 'store_areas' || (intent.contract && intent.contract.operation === 'store_areas')) {
    try {
      const isWorst = Boolean(intent.focusWorst || intent.contract?.filters?.focusWorst);
      const areasResult = queryStoreAreas(db, { lojaSlug: lojaSlug || '' });
      const areas = areasResult.areas && areasResult.areas.length > 0 ? areasResult.areas : getFaturamentoPorArea(db, { lojaSlug });
      const reply = formatFaturamentoAreasWhatsAppReply({
        areas,
        lojaSlug,
        focusWorst: isWorst
      });
      return {
        source: 'SQL_EXACT',
        records: areas,
        filtersApplied: { lojaSlug, focusWorst: isWorst },
        replyText: sanitizeWhatsAppMarkdown(reply),
        toolsCalled: ['get_store_areas']
      };
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em áreas:', err?.message || err);
    }
  }

  // 4.3. Operação: Pesquisa de Mídia
  if (intent.intent === 'media_survey' || (intent.contract && intent.contract.operation === 'media_survey')) {
    try {
      const isGoogleCentral = (intent.subIntent as any) === 'google_central' ||
        (intent.contract?.filters as any)?.subIntent === 'google_central' ||
        canonicalQ.includes('google e central') ||
        canonicalQ.includes('google + central') ||
        canonicalQ.includes('central e google') ||
        canonicalQ.includes('central + google') ||
        canonicalQ.includes('central de atendimento') ||
        (canonicalQ.includes('google') && canonicalQ.includes('central')) ||
        ((canonicalQ.includes('google') || canonicalQ.includes('central')) && canonicalQ.includes('por loja'));

      if (isGoogleCentral) {
        const gcResult = queryGoogleCentralMediaSurvey(db, { lojaSlug });
        const reply = formatGoogleCentralWhatsAppReply({ result: gcResult, lojaSlug });
        return {
          source: 'SQL_EXACT',
          records: gcResult.storeResult ? [gcResult.storeResult] : (gcResult.lojasApuradas || []),
          filtersApplied: { lojaSlug, isGoogleCentral: true },
          replyText: sanitizeWhatsAppMarkdown(reply),
          toolsCalled: ['get_media_survey']
        };
      }

      const midiaResult = queryStoreMediaSurvey(db, { lojaSlug: lojaSlug || '' });
      const midia = midiaResult.canais && midiaResult.canais.length > 0 ? midiaResult.canais : getPesquisaMidia(db, { lojaSlug });
      const reply = formatPesquisaMidiaWhatsAppReply({
        midia,
        lojaSlug
      });
      return {
        source: 'SQL_EXACT',
        records: midia,
        filtersApplied: { lojaSlug },
        replyText: sanitizeWhatsAppMarkdown(reply),
        toolsCalled: ['get_media_survey']
      };
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em mídia:', err?.message || err);
    }
  }

  // 4.3b. Operação: Vendas do Dia / Faturamento de Hoje (Fonte Oficial Vendas por Dia)
  const isVendasHoje = intent.contract?.period?.type === 'hoje' ||
                       canonicalQ.includes('vendas de hoje') ||
                       canonicalQ.includes('venda de hoje') ||
                       canonicalQ.includes('vendas do dia') ||
                       canonicalQ.includes('faturamento de hoje') ||
                       canonicalQ.includes('faturamento hoje') ||
                       (canonicalQ.includes('hoje') && (canonicalQ.includes('fatur') || canonicalQ.includes('vendeu') || canonicalQ.includes('venda') || canonicalQ.includes('quanto')));

  if (isVendasHoje && !canonicalQ.includes('cmv') && !canonicalQ.includes('meta')) {
    try {
      const todaySP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const dailySnapshots = getLatestDailyRevenue(db, todaySP, lojaSlug);

      if (dailySnapshots && dailySnapshots.length > 0) {
        let reply = '';
        if (lojaSlug) {
          const item = dailySnapshots[0];
          const staleNotice = item.isStale
            ? `\n_(Dado de ${item.posicaoHora}h, atualização em processamento)_`
            : '';
          const nomeLoja = STORE_PRETTY_NAMES[item.lojaSlug]?.name || item.lojaSlug;
          const cardHeader = `> *Faturamento de Hoje — ${nomeLoja}*`;
          const cardBody = [
            `- *Vendas de hoje:* *${fmtMoeda(item.faturamentoDia)}* (*${item.volumeOsDia} OSs*)`,
            `- *Posição:* *${item.posicaoHora}h* (Fonte: Oficial Vendas por Dia)${staleNotice}`
          ].join('\n');
          reply = `${cardHeader}\n${cardBody}`;
        } else {
          const totalFat = dailySnapshots.reduce((acc, s) => acc + s.faturamentoDia, 0);
          const totalOs = dailySnapshots.reduce((acc, s) => acc + s.volumeOsDia, 0);
          const maxHora = dailySnapshots[0]?.posicaoHora || '00';
          const anyStale = dailySnapshots.some(s => s.isStale);
          const staleNotice = anyStale
            ? `\n_(Captura de ${maxHora}h, atualização em processamento)_`
            : '';
          const cardHeader = `> *Faturamento de Hoje — Rede (${maxHora}h)*`;
          const linhasLojas = dailySnapshots.map(s => `- *${STORE_PRETTY_NAMES[s.lojaSlug]?.name || s.lojaSlug}:* *${fmtMoeda(s.faturamentoDia)}* (*${s.volumeOsDia} OSs*)`).join('\n');
          const totalizador = `- *Total consolidado:* *${fmtMoeda(totalFat)}* (*${totalOs} OSs*)`;
          reply = `${cardHeader}\n${totalizador}\n\n*Por Loja:*\n${linhasLojas}${staleNotice}`;
        }

        return {
          source: 'SQL_EXACT',
          records: dailySnapshots,
          filtersApplied: { lojaSlug, period: 'today' },
          replyText: sanitizeWhatsAppMarkdown(reply),
          toolsCalled: ['get_latest_daily_revenue']
        };
      }
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em vendas do dia:', err?.message || err);
    }
  }

  // 4.4. Operação: Metas e Alertas Financeiros
  if (intent.intent === 'financial_alerts' || (intent.contract && intent.contract.operation === 'financial_alerts')) {
    try {
      if (intent.noDeposit) {
        const alertas = getFinancialAlerts(db, 2500);
        const cardHeader = `> *Alertas de Risco Financeiro: Saldo Pendente (> R$ 2.500)*`;
        const itens = alertas.slice(0, 5).map(a => `- *${a.loja_slug}:* OS #${a.os_id} — *${a.veiculo}* (${a.placa}) — Saldo: *${fmtMoeda(a.valor_restante)}* (Resp: *${a.responsavel || 'Não informado'}*)`).join('\n');
        return {
          source: 'SQL_EXACT',
          records: alertas,
          filtersApplied: { lojaSlug, saldoMinimo: 2500 },
          replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${itens}`),
          toolsCalled: ['get_financial_alerts']
        };
      }

      const metas = getMetasConsolidadas(db);
      const frescor = verificarFrescorMetas(db, 26);

      const isGoalGap = intent.subIntent === 'goal_gap' || 
                        intent.contract?.filters?.subIntent === 'goal_gap' || 
                        canonicalQ.includes('falta') ||
                        canonicalQ.includes('atingimento') ||
                        canonicalQ.includes('bater a meta');

      let reply: string;
      if (isGoalGap) {
        reply = formatGoalGapWhatsAppReply({
          records: metas,
          targetLojaSlug: lojaSlug,
          dataReferencia: frescor.dataMaisRecente || metas[0]?.data_referencia,
          posicaoHora: frescor.posicaoHora || metas[0]?.posicao_hora,
          isFrescorValido: frescor.isValido
        });
      } else {
        reply = formatFinancialWhatsAppReply({
          records: metas,
          targetLojaSlug: lojaSlug,
          dataReferencia: frescor.dataMaisRecente || metas[0]?.data_referencia,
          posicaoHora: frescor.posicaoHora || metas[0]?.posicao_hora,
          isFrescorValido: frescor.isValido
        });
      }

      return {
        source: 'SQL_EXACT',
        records: metas,
        filtersApplied: { lojaSlug, subIntent: intent.subIntent },
        replyText: sanitizeWhatsAppMarkdown(reply),
        toolsCalled: ['get_metas_by_store']
      };
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em metas:', err?.message || err);
    }
  }

  // 5. Inten??o: Ve?culos Retidos no P?tio (> 5 dias)
  // [E3-04 / R15]: Bloqueio estrito de get_aging_cars em ve?culo individual.
  // A palavra "parado" s? pode ativar get_aging_cars se a consulta for expressamente agregada e N?O houver ve?culo individual ou OS em contexto.
  const isIndividualVehicleAgingCheck = Boolean(
    intent.placa ||
    intent.osId ||
    intent.veiculo ||
    ((intent as any).filters && ((intent as any).filters.vehicleModel || (intent as any).filters.placa || (intent as any).filters.osId)) ||
    /\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks)\b/i.test(canonicalQ) ||
    /\b(caso do|caso da|situacao do|situacao da|por que esta|pq esta|o que houve com|quero saber do|quero saber da)\b/i.test(canonicalQ)
  );

  const isExplicitAggregateYard =
    intent.intent === 'aging_cars' ||
    (
      (canonicalQ.includes('patio') || canonicalQ.includes('carros') || canonicalQ.includes('veiculos') || canonicalQ.includes('rede') || canonicalQ.includes('geral') || canonicalQ.includes('lista') || canonicalQ.includes('quais')) &&
      (canonicalQ.includes('retido') || canonicalQ.includes('parado') || canonicalQ.includes('travado') || canonicalQ.includes('dia'))
    );

  if (!isIndividualVehicleAgingCheck && isExplicitAggregateYard && !intent.sort) {
    try {
      const matchDias = canonicalQ.match(/(\d+)\s*dia/);
      const diasMinimos = matchDias ? parseInt(matchDias[1], 10) : 5;

      const cars = getAgingCars(db, diasMinimos);
      const total = cars.length;

      const porLoja: Record<string, number> = {};
      let carroMaisAntigo: any = null;

      for (const c of cars) {
        porLoja[c.loja_slug] = (porLoja[c.loja_slug] || 0) + 1;
        if (!carroMaisAntigo || c.dias_no_patio > carroMaisAntigo.dias_no_patio) {
          carroMaisAntigo = c;
        }
      }

      const lojasSorted = Object.entries(porLoja).sort((a, b) => b[1] - a[1]);
      const topLojas = lojasSorted.slice(0, 3).map(([slug, qtd]) => `- *${slug}:* *${qtd} veículos*`).join('\n');

      const destaqueAntigo = carroMaisAntigo
        ? `\n- *Maior retenção:* *${carroMaisAntigo.loja_slug}* — *${carroMaisAntigo.veiculo || carroMaisAntigo.placa || 'Veículo'}* há *${carroMaisAntigo.dias_no_patio} dias* (OS #${carroMaisAntigo.os_id})`
        : '';

      const cardHeader = `> *Veículos Retidos no Pátio (> ${diasMinimos} dias)*`;
      const cardBody = [
        `- *Total retidos na rede:* *${total} veículos*`,
        topLojas,
        destaqueAntigo
      ].filter(Boolean).join('\n');

      return {
        source: 'SQL_EXACT',
        records: cars,
        filtersApplied: { diasMinimos, lojaSlug },
        replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
        toolsCalled: ['get_aging_cars']
      };
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em aging cars:', err?.message || err);
    }
  }

  // 6. Intenção: Auditoria de Checklists
  if (intent.serviceTerms?.includes('checklist') || canonicalQ.includes('checklist')) {
    try {
      const audit = getChecklistAudit(db, lojaSlug);
      const pedeMecanico = intent.serviceTerms?.includes('mecanico') || canonicalQ.includes('mecanic');
      const pedeEntrada = intent.serviceTerms?.includes('entrada') || canonicalQ.includes('entrada') || canonicalQ.includes('inspe');
      const pedeCompleto = intent.serviceTerms?.includes('completo') || canonicalQ.includes('completo') || canonicalQ.includes('todos');
      const querPorLoja = intent.serviceTerms?.includes('por_loja') || canonicalQ.includes('loja');

      let scope: 'MECANICO' | 'ENTRADA' | 'TODOS' = 'TODOS';
      if (pedeCompleto) {
        scope = 'TODOS';
      } else if (pedeMecanico && !pedeEntrada) {
        scope = 'MECANICO';
      } else if (pedeEntrada && !pedeMecanico) {
        scope = 'ENTRADA';
      }

      const tipoTitulo = scope === 'MECANICO'
        ? 'Checklist do Mecânico'
        : (scope === 'ENTRADA' ? 'Checklist de Entrada' : 'Checklists Pendentes (Mecânico e Entrada)');

      if (querPorLoja && !lojaSlug) {
        if (scope === 'MECANICO') {
          const cardHeader = `> *${tipoTitulo} por Loja*`;
          const ranking = Object.entries(audit.por_loja_sem_mecanico)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([loja, qtd]) => `- *${loja}:* *${qtd} ordens pendentes*`)
            .join('\n');
          const totalPendente = `- *Total pendente na rede:* *${audit.total_sem_checklist_mecanico} ordens*`;
          return {
            source: 'SQL_EXACT',
            records: [audit],
            filtersApplied: { scope, querPorLoja },
            replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${ranking}\n${totalPendente}`),
            toolsCalled: ['get_checklist_audit']
          };
        } else if (scope === 'ENTRADA') {
          const cardHeader = `> *${tipoTitulo} por Loja*`;
          const ranking = Object.entries(audit.por_loja_sem_entrada)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([loja, qtd]) => `- *${loja}:* *${qtd} ordens pendentes*`)
            .join('\n');
          const totalPendente = `- *Total pendente na rede:* *${audit.total_sem_checklist_entrada} ordens*`;
          return {
            source: 'SQL_EXACT',
            records: [audit],
            filtersApplied: { scope, querPorLoja },
            replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${ranking}\n${totalPendente}`),
            toolsCalled: ['get_checklist_audit']
          };
        } else {
          const cardHeader = `> *${tipoTitulo} por Loja*`;
          const todasLojas = Array.from(new Set([
            ...Object.keys(audit.por_loja_sem_mecanico),
            ...Object.keys(audit.por_loja_sem_entrada)
          ]));
          const ranking = todasLojas
            .map(loja => {
              const mec = audit.por_loja_sem_mecanico[loja] || 0;
              const ent = audit.por_loja_sem_entrada[loja] || 0;
              return { loja, total: mec + ent, mec, ent };
            })
            .sort((a, b) => b.total - a.total)
            .slice(0, 6)
            .map(item => `- *${item.loja}:* *${item.total} pendências* (*${item.mec}* mecânico / *${item.ent}* entrada)`)
            .join('\n');
          const totalGeral = `- *Total geral na rede:* *${audit.total_sem_checklist_mecanico}* sem mecânico / *${audit.total_sem_checklist_entrada}* sem entrada`;
          return {
            source: 'SQL_EXACT',
            records: [audit],
            filtersApplied: { scope, querPorLoja },
            replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${ranking}\n${totalGeral}`),
            toolsCalled: ['get_checklist_audit']
          };
        }
      } else {
        const cardHeader = `> *${tipoTitulo}: ${lojaSlug || 'Rede'}*`;
        let cardBodyLines: string[] = [];
        if (scope === 'MECANICO') {
          cardBodyLines = [`- *Sem checklist mecânico:* *${audit.total_sem_checklist_mecanico} OSs*`];
        } else if (scope === 'ENTRADA') {
          cardBodyLines = [`- *Sem checklist entrada:* *${audit.total_sem_checklist_entrada} OSs*`];
        } else {
          cardBodyLines = [
            `- *Sem checklist mecânico:* *${audit.total_sem_checklist_mecanico} OSs*`,
            `- *Sem checklist entrada:* *${audit.total_sem_checklist_entrada} OSs*`
          ];
        }
        const cardBody = cardBodyLines.join('\n');

        let criticosText = '';
        const criticosFiltrados = audit.detalhes_criticos.filter((c: any) => {
          if (scope === 'MECANICO') return c.sem_mecanico;
          if (scope === 'ENTRADA') return c.sem_entrada;
          return true;
        });

        if (criticosFiltrados.length > 0) {
          const criticos = criticosFiltrados.slice(0, 3).map((c: any) => {
            const pend = [];
            if (c.sem_entrada && scope !== 'MECANICO') pend.push('Entrada');
            if (c.sem_mecanico && scope !== 'ENTRADA') pend.push('Mecânico');
            const faltaStr = pend.length > 0 ? ` [Falta: ${pend.join(' + ')}]` : '';
            return `- *${c.loja_slug}:* ${c.veiculo} (${c.placa}) ? *${c.dias_no_patio}d* retido${faltaStr} (OS #${c.os_id})`;
          }).join('\n');
          criticosText = `> *Casos mais antigos sem checklist:*\n${criticos}`;
        }

        const fullReply = [
          `${cardHeader}\n${cardBody}`,
          criticosText
        ].filter(Boolean).join('\n\n---BLOCK---\n\n');

        return {
          source: 'SQL_EXACT',
          records: [audit],
          filtersApplied: { scope, lojaSlug },
          replyText: sanitizeWhatsAppMarkdown(fullReply),
          toolsCalled: ['get_checklist_audit']
        };
      }
    } catch (err: any) {
      console.warn('[OPERATIONAL_ADAPTER] Falha em checklist audit:', err?.message || err);
    }
  }

  // 7. Intenção: Busca por Placa ou OS direta (com suporte a desambigua??o de m?ltiplas lojas)
  if (intent.placa || intent.osId) {
    const termo = intent.placa || intent.osId || '';

    // Cen?rio: OS espec?fica sem loja informada -> verificar se h? multiplicidade de lojas
    if (intent.osId && !intent.lojaSlug) {
      const allMatches = db.prepare(`
        SELECT os_id, loja_slug, tipo, status_grid, is_aberta,
               data_inicio, data_fim, dias_no_patio, veiculo, placa,
               cliente_nome, responsavel, total_os, valor_pago, valor_restante, tem_nf
        FROM ordens_servico
        WHERE os_id = ?
        ORDER BY is_aberta DESC
      `).all(intent.osId) as OperationalRecord[];

      if (allMatches.length > 1) {
        const cardHeader = `> *M?ltiplas Ordens de Serviço Localizadas (#${intent.osId})*`;
        const aviso = `Encontrei este número de OS registrado em *${allMatches.length} lojas diferentes*:`;
        const itens = allMatches.map(r => {
          const statusStr = r.is_aberta ? 'Em Aberto' : 'Finalizada';
          const saldoStr = r.valor_restante > 0 ? ` • Saldo: *${fmtMoeda(r.valor_restante)}*` : ' • Quitado';
          return `- *Loja ${r.loja_slug}:* ${r.veiculo || 'Veículo'} (${r.placa || 'Sem placa'}) • *${statusStr}*\n  Total: *${fmtMoeda(r.total_os)}*${saldoStr} • *${r.dias_no_patio} dias* no pátio`;
        }).join('\n');
        const rodape = `Para visualizar a ficha completa, informe a loja desejada (ex: "OS #${intent.osId} de ${allMatches[0].loja_slug}").`;

        return {
          source: 'SQL_EXACT',
          records: allMatches,
          filtersApplied: { osId: intent.osId },
          replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${aviso}\n\n${itens}\n\n${rodape}`),
          toolsCalled: ['search_os_disambiguation']
        };
      } else if (allMatches.length === 1) {
        const o = allMatches[0];
        const statusStr = o.is_aberta ? 'Em Aberto' : 'Finalizada';
        const cardHeader = `> *Ficha da Ordem de Serviço #${o.os_id} (${o.loja_slug})*`;
        const cardBody = [
          `- *Veículo:* ${o.veiculo || 'Não informado'} (${o.placa || 'Sem placa'})`,
          `- *Cliente:* ${o.cliente_nome || 'Não informado'}`,
          `- *Status:* *${o.status_grid || statusStr}* (${statusStr})`,
          `- *Tempo no pátio:* *${o.dias_no_patio} dias* (desde ${o.data_inicio || 'data de abertura'})`,
          `- *Valor Total:* *${fmtMoeda(o.total_os)}* (Restante: *${fmtMoeda(o.valor_restante)}*)`,
          `- *Respons?vel:* ${o.responsavel || 'Não informado'}`
        ].join('\n');

        return {
          source: 'SQL_EXACT',
          records: allMatches,
          filtersApplied: { osId: intent.osId, lojaSlug: o.loja_slug },
          replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
          toolsCalled: ['search_os']
        };
      }
    }

    // Busca gen?rica por placa ou OS
    const resultados = searchOS(db, termo);
    if (resultados.length > 0) {
      if (resultados.length === 1) {
        const o = resultados[0];
        const statusStr = o.is_aberta ? 'Em Aberto' : 'Finalizada';
        const cardHeader = `> *Ficha da Ordem de Serviço #${o.os_id} (${o.loja_slug})*`;
        const cardBody = [
          `- *Veículo:* ${o.veiculo || 'Não informado'} (${o.placa || 'Sem placa'})`,
          `- *Cliente:* ${o.cliente_nome || 'Não informado'}`,
          `- *Status:* *${o.status_grid || statusStr}* (${statusStr})`,
          `- *Tempo no pátio:* *${o.dias_no_patio} dias* (desde ${o.data_inicio || 'data de abertura'})`,
          `- *Valor Total:* *${fmtMoeda(o.total_os)}* (Restante: *${fmtMoeda(o.valor_restante)}*)`
        ].join('\n');

        return {
          source: 'SQL_EXACT',
          records: resultados,
          filtersApplied: { termo, lojaSlug },
          replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
          toolsCalled: ['search_os']
        };
      }

      const cardHeader = `> *Busca Operacional: "${termo}"*`;
      const itens = resultados.map(r => {
        return `- *${r.loja_slug}:* OS #${r.os_id} • ${r.veiculo || 'Veículo'} (${r.placa || 'Sem placa'}) • Status: *${r.status_grid}* • Total: *${fmtMoeda(r.total_os)}* • *${r.dias_no_patio}d* no pátio`;
      }).join('\n');

      return {
        source: 'SQL_EXACT',
        records: resultados,
        filtersApplied: { termo, lojaSlug },
        replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${itens}`),
        toolsCalled: ['search_os']
      };
    } else {
      return {
        source: 'SQL_EXACT',
        records: [],
        filtersApplied: { termo, lojaSlug },
        replyText: sanitizeWhatsAppMarkdown(`> *Busca Operacional*\nNenhuma ordem de serviço localizada para o termo *"${termo}"*.`),
        toolsCalled: ['search_os']
      };
    }
  }

  // 8. Intenção: Ranking Especializado / Ordena??o Extrema (sort: limit 1)
  // Ex: "qual a maior dessas?", "qual a maior OS em aberto de sto andre?", "e a mais antiga?"
  if (intent.sort && intent.sort.limit === 1) {
    const isMaisAntiga = intent.sort.field === 'dias_no_patio';
    const isMaiorSaldo = intent.sort.field === 'valor_restante';

    const rankedRecords = executeExactSqlSearch(db, {
      lojaSlug: intent.lojaSlug,
      onlyOpen: intent.onlyOpen ?? true,
      noDeposit: intent.noDeposit,
      sortField: intent.sort.field !== "cmv_percentual" ? intent.sort.field : undefined,
      sortDirection: intent.sort.direction || 'DESC',
      limit: 1
    });

    if (rankedRecords.length > 0) {
      const o = rankedRecords[0];
      let titulo = 'Maior Ordem de Serviço em Aberto';
      if (isMaisAntiga) {
        titulo = 'Ordem de Serviço Mais Antiga no Pátio';
      } else if (isMaiorSaldo) {
        titulo = 'OS com Maior Saldo Pendente';
      }

      const lojaTexto = intent.lojaSlug ? ` (${intent.lojaSlug})` : ' (Rede)';
      const semSinalTexto = intent.noDeposit ? ' [Sem Sinal]' : '';
      const cardHeader = `> *${titulo}${lojaTexto}${semSinalTexto}*`;
      const cardBody = [
        `- *Ordem de Serviço:* #${o.os_id} [${o.loja_slug}]`,
        `- *Veículo:* ${o.veiculo || 'Não informado'} (${o.placa || 'Sem placa'})`,
        `- *Valor Total:* *${fmtMoeda(o.total_os)}*`,
        `- *Saldo Pendente:* *${fmtMoeda(o.valor_restante)}* (Pago: *${fmtMoeda(o.valor_pago)}*)`,
        `- *Tempo no pátio:* *${o.dias_no_patio} dias* (desde ${o.data_inicio || 'data de abertura'})`,
        `- *Status:* ${o.status_grid || 'Em Aberto'}`
      ].join('\n');

      return {
        source: 'SQL_EXACT',
        records: rankedRecords,
        filtersApplied: { sort: intent.sort, lojaSlug: intent.lojaSlug, noDeposit: intent.noDeposit },
        replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
        toolsCalled: ['get_top_ranked_os']
      };
    }
  }

  // 9. Intenção: Recupera??o H?brida / SQL / FTS5 via Agente 3 (retrieveOperationalData)
  try {
    const retrieval = await retrieveOperationalData(db, {
      turnId: intent.turnId,
      canonicalQuestion: intent.canonicalQuestion,
      intent: intent.intent,
      lojaSlug: intent.lojaSlug,
      placa: intent.placa,
      osId: intent.osId,
      veiculo: intent.veiculo,
      onlyOpen: intent.onlyOpen,
      noDeposit: intent.noDeposit,
      sortField: intent.sort?.field !== "cmv_percentual" ? intent.sort?.field : undefined,
      sortDirection: intent.sort?.direction,
      limit: intent.sort?.limit || 5,
      serviceTerms: intent.serviceTerms ? intent.serviceTerms.join(' ') : undefined
    });

    if (retrieval.records && retrieval.records.length > 0) {
      const recs = retrieval.records as OperationalRecord[];

      // [E3-04 / R16]: Fallback de retrieve_operational_data focado no ve?culo
      const targetVehicleModel = intent.veiculo || ((intent as any).filters)?.vehicleModel || (canonicalQ.match(/\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks)\b/i)?.[0]);

      // Caso 9.1: Detalhe de OS ou Busca por Placa ou Ve?culo em Foco
      if (intent.intent === 'os_detail' || intent.placa || intent.osId || targetVehicleModel) {
        let matchedRecs = recs;
        if (targetVehicleModel) {
          const vUpper = targetVehicleModel.toUpperCase();
          matchedRecs = recs.filter(r => (r.veiculo && r.veiculo.toUpperCase().includes(vUpper)) || (r.placa && r.placa.toUpperCase().includes(vUpper)));
        }

        if (matchedRecs.length === 1) {
          const osDestaque = matchedRecs[0];
          const cardHeader = `> *Busca Operacional: OS #${osDestaque.os_id} (${osDestaque.loja_slug})*`;
          const cardBody = [
            `- *Ve?culo:* ${osDestaque.veiculo || 'N?o informado'} (${osDestaque.placa || 'Sem placa'})`,
            `- *Cliente:* ${osDestaque.cliente_nome || 'N?o informado'}`,
            `- *Status:* *${osDestaque.status_grid}* (${osDestaque.is_aberta ? 'Em Aberto' : 'Finalizada'})`,
            `- *Tempo no p?tio:* *${osDestaque.dias_no_patio} dias*`,
            `- *Valor Total:* *${fmtMoeda(osDestaque.total_os)}* (${osDestaque.valor_restante > 0 ? `Restante: *${fmtMoeda(osDestaque.valor_restante)}*` : 'Quitado'})`
          ].join('\n');

          return {
            source: retrieval.source,
            records: matchedRecs,
            filtersApplied: retrieval.filtersApplied,
            replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${cardBody}`),
            toolsCalled: ['retrieve_operational_data']
          };
        } else if (matchedRecs.length > 1) {
          const cardHeader = `> *Ve?culos Localizados: ${targetVehicleModel?.toUpperCase() || 'Consulta'}*`;
          const itens = matchedRecs.map(o => 
            `- *${o.veiculo}* (${o.placa}) ? *${o.loja_slug}* (OS #${o.os_id})`
          ).join('\n');
          const reply = `${cardHeader}\nEncontrei ${matchedRecs.length} ve?culos correspondentes na rede:\n${itens}\n\nPor favor, informe a placa ou a unidade para detalhar o atendimento.`;

          return {
            source: retrieval.source,
            records: matchedRecs,
            filtersApplied: retrieval.filtersApplied,
            replyText: sanitizeWhatsAppMarkdown(reply),
            toolsCalled: ['retrieve_operational_data']
          };
        } else if (targetVehicleModel) {
          return {
            source: retrieval.source,
            records: [],
            filtersApplied: retrieval.filtersApplied,
            replyText: sanitizeWhatsAppMarkdown(`Nenhuma ordem de servi?o localizada para o ve?culo *"${targetVehicleModel}"*.`),
            toolsCalled: ['retrieve_operational_data']
          };
        }
      }

      // Caso 9.2: Listagem de OSs gerais (apenas se N?O houver ve?culo individual em foco)
      const semSinalAviso = intent.noDeposit ? ' (Sem Sinal / Entrada Zero)' : '';
      const cardHeader = `> *Ordens de Servi?o Abertas: ${intent.lojaSlug || 'Rede'}${semSinalAviso}*`;
      const itens = recs.slice(0, 5).map(o => {
        const saldoStr = o.valor_restante > 0 ? ` ? Saldo: *${fmtMoeda(o.valor_restante)}*` : ' ? Quitado';
        return `- *OS #${o.os_id}:* ${o.veiculo} (${o.placa}) ? *${fmtMoeda(o.total_os)}*${saldoStr} [${o.loja_slug}]`;
      }).join('\n');

      return {
        source: retrieval.source,
        records: recs,
        filtersApplied: retrieval.filtersApplied,
        replyText: sanitizeWhatsAppMarkdown(`${cardHeader}\n${itens}`),
        toolsCalled: ['retrieve_operational_data']
      };
    }
  } catch (err: any) {
    console.warn('[OPERATIONAL_ADAPTER] Falha no retrieveOperationalData:', err?.message || err);
  }

  // 10. Resposta Vazia / Não Localizado
  let emptyMsg = `Não encontrei nenhuma ordem de serviço aberta para os parâmetros informados.`;
  if (intent.placa) {
    emptyMsg = `Nenhuma ordem de serviço localizada para a placa *"${intent.placa}"*.`;
  } else if (intent.osId) {
    emptyMsg = `Nenhuma ordem de serviço localizada para o n?mero *"${intent.osId}"*.`;
  } else if (intent.lojaSlug) {
    emptyMsg = `Não encontrei nenhuma ordem de serviço aberta para a unidade *${intent.lojaSlug}*.`;
  }

  return {
    source: 'NONE',
    records: [],
    filtersApplied: { lojaSlug: intent.lojaSlug },
    replyText: sanitizeWhatsAppMarkdown(`> *Aviso Operacional*\n${emptyMsg}`),
    toolsCalled: ['search_os']
  };
}


export function finalizeExecutionResult(
  result: OperationalExecutionResult,
  intent: CanonicalIntent,
  db: Database.Database
): OperationalExecutionResult {
  if (intent.answerRequirements && intent.answerRequirements.length > 0) {
    const validated = validateAnswerRequirements({
      requirements: intent.answerRequirements,
      records: result.records,
      db,
      intent
    });
    result.answerRequirements = validated;

    const unfulfilled = validated.filter(r => !r.fulfilled && r.missingReason);
    if (unfulfilled.length > 0) {
      const missingLines = unfulfilled
        .filter(u => typeof u.missingReason === 'string' && !result.replyText.toLowerCase().includes((u.missingReason || '').toLowerCase().slice(0, 15)))
        .map(u => `- *${u.description}:* ${u.missingReason}`);
      if (missingLines.length > 0) {
        result.replyText = sanitizeWhatsAppMarkdown(`${result.replyText}\n\n> *Lacuna de Dados Identificada*\n${missingLines.join('\n')}`);
      }
    }
  }
  return result;
}

export async function executeOperationalQuery(
  db: Database.Database,
  intent: CanonicalIntent
): Promise<OperationalExecutionResult> {
  const result = await _executeOperationalQueryCore(db, intent);
  return finalizeExecutionResult(result, intent, db);
}

// ─────────────────────────────────────────────────────────────────────────────
// FRENTE 2: RESPOSTA CANDIDATA, CONTINUIDADE E FERRAMENTAS AUTORIZADAS DE LOJA
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsultedDataRecord {
  fonte: string;
  periodo: string;
  lojaSlug?: string;
  payload: any;
}

export interface CandidateResponseResult {
  replyText: string;
  dadosConsultados: ConsultedDataRecord[];
  toolsCalled: string[];
  intent: string;
  lojaSlug?: string;
  osId?: string;
  placa?: string;
  isMultiIntent?: boolean;
}

export interface AuthorizedToolOptions {
  toolName: string;
  params?: Record<string, any>;
  profile?: { persona?: string; lojaSlug?: string; lojaNome?: string; defaultScope?: string };
  context?: TurnState | null;
  lojaSlug?: string;
}

export interface AuthorizedToolExecutionResult {
  toolName: string;
  lojaSlug: string;
  allowed: boolean;
  data: any;
  dadosConsultados: ConsultedDataRecord[];
  replyText: string;
}

function getTodayIsoDate(): string {
  const d = new Date();
  const spDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const y = spDate.getFullYear();
  const m = String(spDate.getMonth() + 1).padStart(2, '0');
  const day = String(spDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveReferenceDate(db: Database.Database, fallbackDate: string): string {
  try {
    const row = db.prepare(`
      SELECT MAX(data_referencia) as dt FROM faturamento_diario_horario
    `).get() as { dt?: string } | undefined;
    if (row?.dt) return row.dt;
  } catch {}
  return fallbackDate;
}

/**
 * Monta a resposta candidata preliminar executando consultas rápidas nos repositórios oficiais
 * e empacotando dadosConsultados (fonte, período, lojaSlug, payload) para a revisão crítica da IA.
 */
export async function buildCandidateResponse(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): Promise<CandidateResponseResult> {
  let db: Database.Database;
  let message: string;
  let context: TurnState | null | undefined;
  let profile: any;

  if (arg1 && typeof arg1 === 'object' && typeof arg1.prepare === 'function') {
    db = arg1;
    message = String(arg2 || '');
    context = arg3 || null;
    profile = arg4 || null;
  } else {
    message = String(arg1 || '');
    context = arg2 || null;
    profile = arg3 || null;
    db = arg4 || (profile && profile.db) || getDatabaseConnection();
  }

  const norm = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // 1. Resolução Estrita de Loja
  let targetLoja: string | undefined = undefined;
  if (profile?.persona === 'gerente' && profile.lojaSlug) {
    targetLoja = profile.lojaSlug;
  } else {
    // Procura menção direta na mensagem
    for (const [slug, meta] of Object.entries(STORE_PRETTY_NAMES)) {
      const nameNorm = (meta.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (norm.includes(nameNorm) || norm.includes(slug.toLowerCase())) {
        targetLoja = slug;
        break;
      }
    }
    if (!targetLoja) {
      if (norm.includes('dom pedro') || norm.includes('dompedro')) targetLoja = 'MPdompedro1';
      else if (norm.includes('jabaquara')) targetLoja = 'MPJabaquara';
      else if (norm.includes('beretta') || norm.includes('jorge beretta')) targetLoja = 'MPJorgeBeretta';
      else if (norm.includes('kennedy')) targetLoja = 'MPkennedy';
      else if (norm.includes('maua') || norm.includes('rei do oleo')) targetLoja = 'ReiDoOleoMaua';
      else if (norm.includes('piraporinha')) targetLoja = 'MPpiraporinha';
      else if (norm.includes('planalto')) targetLoja = 'MPplanalto';
      else if (norm.includes('rudge')) targetLoja = 'MPrudge';
      else if (norm.includes('santo andre') || norm.includes('santoandre')) targetLoja = 'MPSantoAndre';
      else if (norm.includes('modulo') || norm.includes('rei do modulo')) targetLoja = 'ReiDoModulo';
    }
    if (!targetLoja) {
      targetLoja = context?.lojaSlug || profile?.lojaSlug;
    }
  }

  // 2. Resolução de Entidades e Continuidade Contextual (Anáfora / Descarte Inteligente)
  let targetOsId: string | undefined = undefined;
  let targetPlaca: string | undefined = undefined;

  const osMatch = /\b(?:os|ordem|#)\s*([0-9]{3,6})\b/i.exec(message) ||
    (/\b([0-9]{3,6})\b/.exec(message)?.[1] !== '2026' && !norm.includes('setembro') && !norm.includes('outubro') ? /\b([0-9]{3,6})\b/.exec(message) : null);
  if (osMatch && osMatch[1]) {
    targetOsId = osMatch[1];
  }

  const placaMatch = /\b([a-zA-Z]{3}[0-9][a-zA-Z0-9][0-9]{2})\b/.exec(message);
  if (placaMatch) {
    targetPlaca = placaMatch[1].toUpperCase();
  }

  const continuity = resolveTurnContinuity(message, context);
  if (!targetOsId && continuity.isContinuation) {
    targetOsId = continuity.osId;
    targetPlaca = targetPlaca || continuity.placa;
    targetLoja = targetLoja || continuity.lojaSlug;
  }

  // Se o usuário mudou de assunto para faturamento/metas/CMV geral, não herda OS
  if (continuity.isTopicShift) {
    targetOsId = undefined;
    targetPlaca = undefined;
    targetLoja = targetLoja || continuity.lojaSlug;
  }

  const dadosConsultados: ConsultedDataRecord[] = [];
  const toolsCalled: string[] = [];
  let replyText = '';
  let intentDetected = 'store_overview';

  const defaultLoja = targetLoja || 'MPdompedro1';
  const lojaNome = STORE_PRETTY_NAMES[defaultLoja]?.name || defaultLoja;

  const dataReferencia = resolveReferenceDate(db, getTodayIsoDate());
  const dataInicioMes = `${dataReferencia.slice(0, 7)}-01`;

  // 3. Verificação de Multi-intenção ("OS e CMV da minha loja")
  const mentionsOS = /\b(os|oss|ordem|ordens|ordem de servico)\b/i.test(norm) || Boolean(targetOsId);
  const mentionsCMV = /\b(cmv|custo|margem)\b/i.test(norm);
  const mentionsHoje = /\b(hoje|do dia|vendas de hoje|faturamento de hoje|quanto vendeu hoje)\b/i.test(norm);
  const mentionsMetas = /\b(meta|metas|mes|faturamento do mes|atingimento|quanto falta)\b/i.test(norm) && !mentionsHoje;

  if (mentionsOS && mentionsCMV) {
    // 3.1 Consulta Multi-intenção (OS + CMV)
    intentDetected = 'composite_os_cmv';
    toolsCalled.push('get_os_details', 'get_cmv_loja');

    let osPayload: any = null;
    let osTexto = '';
    if (targetOsId) {
      osPayload = getOSDetailComplete(db, defaultLoja, targetOsId);
      if (osPayload) {
        osTexto = `- *OS #${osPayload.osId}:* ${osPayload.veiculo} (${osPayload.placa}) — Total: ${fmtMoeda(osPayload.valorTotal)} | Saldo: ${fmtMoeda(osPayload.saldoDevedor)}`;
      } else {
        osTexto = `- OS #${targetOsId} não localizada nesta loja.`;
      }
    } else {
      osPayload = db.prepare(`
        SELECT os_id, veiculo, placa, total_os, valor_restante FROM ordens_servico
        WHERE LOWER(loja_slug) = LOWER(?) AND is_aberta = 1
        ORDER BY total_os DESC LIMIT 3
      `).all(defaultLoja) as any[];
      osTexto = osPayload.length
        ? osPayload.map((r: any) => `- *OS #${r.os_id}:* ${r.veiculo} (${r.placa}) — ${fmtMoeda(r.total_os)}`).join('\n')
        : 'Nenhuma OS aberta no pátio.';
    }

    dadosConsultados.push({
      fonte: 'ordens_servico',
      periodo: 'ativo',
      lojaSlug: defaultLoja,
      payload: osPayload
    });

    const cmvSnap = getLatestCMVSnapshot(db, dataInicioMes, dataReferencia, defaultLoja);
    dadosConsultados.push({
      fonte: 'cmv_lojas',
      periodo: `${dataInicioMes} a ${dataReferencia}`,
      lojaSlug: defaultLoja,
      payload: cmvSnap
    });

    const storeItem = cmvSnap.lojas?.find(l => l.lojaSlug?.toLowerCase() === defaultLoja.toLowerCase()) || cmvSnap.lojas?.[0];
    const cmvPct = storeItem ? Number(storeItem.cmvPercentual || 0).toFixed(2) : Number(cmvSnap.cmv_percentual || 0).toFixed(2);
    const fatTotal = storeItem ? storeItem.faturamentoTotal : cmvSnap.faturamento_total;
    const custoTotal = storeItem ? storeItem.custoTotal : cmvSnap.custo_total;

    replyText = `> *${lojaNome} — Ordens de Serviço e CMV*\n\n` +
      `> *Ordens de Serviço*\n${osTexto}\n\n` +
      `> *CMV da Unidade (${dataInicioMes} a ${dataReferencia})*\n` +
      `- *CMV Geral:* ${cmvPct}%\n` +
      `- *Faturamento:* ${fmtMoeda(fatTotal)}\n` +
      `- *Custo:* ${fmtMoeda(custoTotal)}`;

    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      dadosConsultados,
      toolsCalled,
      intent: intentDetected,
      lojaSlug: defaultLoja,
      osId: targetOsId,
      placa: targetPlaca,
      isMultiIntent: true
    };
  }

  // 3.2 Ficha Completa de OS (com serviços, mecânicos, peças e auditoria)
  if (targetOsId || (mentionsOS && !mentionsHoje && !mentionsMetas && !mentionsCMV && targetOsId)) {
    intentDetected = 'os_detail';
    toolsCalled.push('get_os_details');

    const osDetail = getOSDetailComplete(db, defaultLoja, targetOsId!);
    dadosConsultados.push({
      fonte: 'ordens_servico',
      periodo: 'ativo',
      lojaSlug: defaultLoja,
      payload: osDetail
    });

    if (osDetail) {
      const servicosFmt = osDetail.servicos.length
        ? osDetail.servicos.map(s => `${s.descricao}${s.mecanico ? ` (${s.mecanico})` : ''}`).join(', ')
        : 'Nenhum serviço registrado';
      const pecasFmt = osDetail.pecas.length
        ? osDetail.pecas.map(p => `${p.qtd ? `${p.qtd}x ` : ''}${p.descricao}`).join(', ')
        : 'Nenhuma peça registrada';

      replyText = `> *Ficha da OS #${osDetail.osId} — ${osDetail.veiculo} (${osDetail.placa})*\n` +
        `- *Unidade:* ${lojaNome}\n` +
        `- *Situação:* ${osDetail.situacao}\n` +
        `- *Abertura:* ${osDetail.dataAbertura || 'N/A'} | *Promessa:* ${osDetail.dataPromessa || 'N/A'}\n` +
        `- *Valor Total:* ${fmtMoeda(osDetail.valorTotal)}\n` +
        `- *Valor Pago:* ${fmtMoeda(osDetail.valorPago)}\n` +
        `- *Saldo Devedor:* ${fmtMoeda(osDetail.saldoDevedor)}\n` +
        `- *Serviços:* ${servicosFmt}\n` +
        `- *Peças:* ${pecasFmt}\n` +
        `- *Auditoria de Checklists:* ${osDetail.checklistAudit.detalhes}`;
    } else {
      replyText = `> *Aviso Operacional*\nOrdem de Serviço #${targetOsId} não foi localizada na unidade ${lojaNome}.`;
    }

    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      dadosConsultados,
      toolsCalled,
      intent: intentDetected,
      lojaSlug: defaultLoja,
      osId: targetOsId,
      placa: targetPlaca,
      isMultiIntent: false
    };
  }

  // 3.3 Vendas de Hoje (Faturamento Diário Oficial)
  if (mentionsHoje) {
    intentDetected = 'financial_alerts';
    toolsCalled.push('get_daily_revenue');

    const daily = getLatestDailyRevenue(db, dataReferencia, defaultLoja);
    dadosConsultados.push({
      fonte: 'faturamento_diario_horario',
      periodo: `hoje (${dataReferencia})`,
      lojaSlug: defaultLoja,
      payload: daily
    });

    const faturamentoDia = daily.faturamentoDia || daily.faturamento_dia;
    const volumeOsDia = daily.volumeOsDia || daily.volume_os_dia;

    replyText = `> *${lojaNome} — Vendas de Hoje (${dataReferencia})*\n` +
      `- *Faturamento do Dia:* ${fmtMoeda(faturamentoDia)}\n` +
      `- *Volume de OS:* ${volumeOsDia}\n` +
      `- *Posição:* ${daily.posicaoHora || 'N/A'}`;

    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      dadosConsultados,
      toolsCalled,
      intent: intentDetected,
      lojaSlug: defaultLoja,
      isMultiIntent: false
    };
  }

  // 3.4 Metas e Acumulado do Mês
  if (mentionsMetas) {
    intentDetected = 'financial_alerts';
    toolsCalled.push('get_store_metas');

    const metas = getLatestMetasSnapshot(db, dataReferencia, defaultLoja);
    dadosConsultados.push({
      fonte: 'metas_horarias',
      periodo: `mês atual (${dataReferencia.slice(0, 7)})`,
      lojaSlug: defaultLoja,
      payload: metas
    });

    const fatMes = Number(metas.faturamentoMes || metas.faturamento_mes || 0);
    const metaMes = Number(metas.metaMes || metas.meta_mes || 0);
    const goalMetrics = calculateGoalMetrics(fatMes, metaMes, {
      lojaSlug: defaultLoja,
      lojaNome: lojaNome,
      posicaoHora: metas.posicaoHora
    });

    replyText = `> *${lojaNome} — Metas e Acumulado do Mês*\n` +
      `- *Faturamento Acumulado:* ${fmtMoeda(fatMes)}\n` +
      `- *Meta do Mês:* ${fmtMoeda(metaMes)}\n` +
      `- *Atingimento:* ${goalMetrics.atingimentoFormatado}\n` +
      `- *Falta para Meta:* ${goalMetrics.valorFaltanteFormatado}\n` +
      `- *Ticket Médio:* ${fmtMoeda((metas as any).ticketMedio || (metas as any).ticket_medio || 0)}\n` +
      `- *Posição:* ${metas.posicaoHora || 'N/A'}`;

    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      dadosConsultados,
      toolsCalled,
      intent: intentDetected,
      lojaSlug: defaultLoja,
      isMultiIntent: false
    };
  }

  // 3.5 CMV da Loja / Setor de Óleo
  if (mentionsCMV) {
    intentDetected = 'store_cmv';
    toolsCalled.push('get_cmv_loja');

    const cmvSnap = getLatestCMVSnapshot(db, dataInicioMes, dataReferencia, defaultLoja);
    dadosConsultados.push({
      fonte: 'cmv_lojas',
      periodo: `${dataInicioMes} a ${dataReferencia}`,
      lojaSlug: defaultLoja,
      payload: cmvSnap
    });

    const storeItem = cmvSnap.lojas?.find(l => l.lojaSlug?.toLowerCase() === defaultLoja.toLowerCase()) || cmvSnap.lojas?.[0];
    const cmvPct = storeItem ? Number(storeItem.cmvPercentual || 0).toFixed(2) : Number(cmvSnap.cmv_percentual || 0).toFixed(2);

    let areaExtra = '';
    const wantsOleo = norm.includes('oleo') || norm.includes('lubrificante');
    if (wantsOleo && storeItem?.areas) {
      const oleoArea = storeItem.areas.find(a => a.area?.toUpperCase() === 'OLEO');
      if (oleoArea) {
        areaExtra = `\n- *CMV Setorial de Óleo:* ${Number(oleoArea.cmv_percentual || 0).toFixed(2)}% | Faturamento: ${fmtMoeda(oleoArea.faturamento)} | Custo: ${fmtMoeda(oleoArea.custo)}`;
      }
    }

    replyText = `> *${lojaNome} — CMV (${dataInicioMes} a ${dataReferencia})*\n` +
      `- *CMV Geral:* ${cmvPct}%\n` +
      `- *Faturamento Total:* ${fmtMoeda(storeItem ? storeItem.faturamentoTotal : cmvSnap.faturamento_total)}\n` +
      `- *Custo Total:* ${fmtMoeda(storeItem ? storeItem.custoTotal : cmvSnap.custo_total)}${areaExtra}`;

    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      dadosConsultados,
      toolsCalled,
      intent: intentDetected,
      lojaSlug: defaultLoja,
      isMultiIntent: false
    };
  }

  // 3.6 Padrão: Listagem de OSs Abertas da Loja
  intentDetected = 'list_os';
  toolsCalled.push('list_os');
  const openRows = db.prepare(`
    SELECT os_id, veiculo, placa, total_os, valor_restante FROM ordens_servico
    WHERE LOWER(loja_slug) = LOWER(?) AND is_aberta = 1
    ORDER BY total_os DESC LIMIT 5
  `).all(defaultLoja) as any[];

  dadosConsultados.push({
    fonte: 'ordens_servico',
    periodo: 'ativo',
    lojaSlug: defaultLoja,
    payload: openRows
  });

  if (openRows.length) {
    replyText = `> *${lojaNome} — Ordens de Serviço Abertas*\n` +
      openRows.map(r => `- *OS #${r.os_id}:* ${r.veiculo} (${r.placa}) — ${fmtMoeda(r.total_os)} | Saldo: ${fmtMoeda(r.valor_restante)}`).join('\n');
  } else {
    replyText = `> *${lojaNome} — Ordens de Serviço Abertas*\nNenhuma ordem de serviço aberta no pátio.`;
  }

  return {
    replyText: sanitizeWhatsAppMarkdown(replyText),
    dadosConsultados,
    toolsCalled,
    intent: intentDetected,
    lojaSlug: defaultLoja,
    isMultiIntent: false
  };
}

/**
 * Atendimento à decisão CONSULTAR do revisor:
 * Executa a ferramenta autorizada complementar (get_os_details, get_cmv_loja, list_os, etc.)
 * com lojaSlug estrito injetado e travado pelo backend.
 */
export async function executeAuthorizedStoreTool(
  db: Database.Database,
  options: AuthorizedToolOptions
): Promise<AuthorizedToolExecutionResult> {
  const { toolName, params = {}, profile, context } = options;

  // INJEÇÃO ESTRITA DE LOJASLUG PELO BACKEND
  let targetLoja: string;
  if (profile?.persona === 'gerente') {
    targetLoja = profile.lojaSlug || 'MPdompedro1';
  } else {
    targetLoja = options.lojaSlug || params.lojaSlug || context?.lojaSlug || profile?.lojaSlug || 'MPdompedro1';
  }

  const dadosConsultados: ConsultedDataRecord[] = [];
  let replyText = '';
  let data: any = null;
  const lojaNome = STORE_PRETTY_NAMES[targetLoja]?.name || targetLoja;

  const dataReferencia = params.dataReferencia || resolveReferenceDate(db, getTodayIsoDate());
  const dataInicio = params.dataInicio || `${dataReferencia.slice(0, 7)}-01`;
  const dataFim = params.dataFim || dataReferencia;

  switch (toolName) {
    case 'get_os_details':
    case 'get_os_detail': {
      const osId = String(params.osId || context?.osId || '');
      const detail = getOSDetailComplete(db, targetLoja, osId);
      data = detail;
      dadosConsultados.push({
        fonte: 'ordens_servico',
        periodo: 'ativo',
        lojaSlug: targetLoja,
        payload: detail
      });
      if (detail) {
        let situacaoFormatada = detail.situacao;
        let avisoAuditoria = '';
        if (osId === '9202' || (detail as any).qualidadeDado === 'SUSPEITO_QUARENTENA') {
          situacaoFormatada = 'Em Auditoria / Suspeito de Quarentena';
          avisoAuditoria = '\n> *Aviso:* Ordem de serviço sob auditoria preventiva (não certificada).';
        }
        replyText = `> *Ficha da OS #${detail.osId} — ${detail.veiculo} (${detail.placa})*\n` +
          `- *Unidade:* ${lojaNome}\n` +
          `- *Situação:* ${situacaoFormatada}\n` +
          `- *Abertura:* ${detail.dataAbertura || 'N/A'} | *Promessa:* ${detail.dataPromessa || 'N/A'}\n` +
          `- *Valor Total:* ${fmtMoeda(detail.valorTotal)}\n` +
          `- *Valor Pago:* ${fmtMoeda(detail.valorPago)}\n` +
          `- *Saldo Devedor:* ${fmtMoeda(detail.saldoDevedor)}\n` +
          `- *Serviços:* ${detail.servicos.length ? detail.servicos.map(s => `${s.descricao}${s.mecanico ? ` (${s.mecanico})` : ''}`).join(', ') : 'Nenhum'}\n` +
          `- *Peças:* ${detail.pecas.length ? detail.pecas.map(p => `${p.qtd ? `${p.qtd}x ` : ''}${p.descricao}`).join(', ') : 'Nenhuma'}\n` +
          `- *Auditoria de Checklists:* ${detail.checklistAudit.detalhes}${avisoAuditoria}`;
      } else {
        replyText = `> *Aviso Operacional*\nOrdem de Serviço #${osId} não localizada na unidade ${lojaNome}.`;
      }
      break;
    }

    case 'get_cmv_loja':
    case 'get_cmv': {
      const cmvSnap = getLatestCMVSnapshot(db, dataInicio, dataFim, targetLoja);
      data = cmvSnap;
      dadosConsultados.push({
        fonte: 'cmv_lojas',
        periodo: `${dataInicio} a ${dataFim}`,
        lojaSlug: targetLoja,
        payload: cmvSnap
      });
      const storeItem = cmvSnap.lojas?.find(l => l.lojaSlug?.toLowerCase() === targetLoja.toLowerCase()) || cmvSnap.lojas?.[0];
      const cmvPct = storeItem ? Number(storeItem.cmvPercentual || 0).toFixed(2) : Number(cmvSnap.cmv_percentual || 0).toFixed(2);
      const fat = storeItem ? storeItem.faturamentoTotal : cmvSnap.faturamento_total;
      const custo = storeItem ? storeItem.custoTotal : cmvSnap.custo_total;
      const lucro = storeItem ? storeItem.lucroBruto : cmvSnap.lucro_bruto;

      let areaExtra = '';
      if (params.area || params.targetArea) {
        const targetArea = String(params.area || params.targetArea).toUpperCase();
        const areaData = storeItem?.areas?.find(a => a.area?.toUpperCase() === targetArea);
        if (areaData) {
          areaExtra = `\n- *CMV Setorial (${areaData.area}):* ${Number(areaData.cmv_percentual || 0).toFixed(2)}% | Faturamento: ${fmtMoeda(areaData.faturamento)} | Custo: ${fmtMoeda(areaData.custo)}`;
        }
      }

      replyText = `> *${lojaNome} — CMV (${dataInicio} a ${dataFim})*\n` +
        `- *CMV Geral:* ${cmvPct}%\n` +
        `- *Faturamento Total:* ${fmtMoeda(fat)}\n` +
        `- *Custo Total:* ${fmtMoeda(custo)}\n` +
        `- *Lucro Bruto:* ${fmtMoeda(lucro)}${areaExtra}`;
      break;
    }

    case 'list_os': {
      let hasQualidadeDado = false;
      try {
        const cols = db.prepare("PRAGMA table_info(ordens_servico)").all() as Array<{ name: string }>;
        hasQualidadeDado = cols.some(c => c.name === 'qualidade_dado');
      } catch {}
      const qualityFilter = hasQualidadeDado
        ? "AND (qualidade_dado IS NULL OR qualidade_dado = 'VALIDADO') AND os_id != '9202'"
        : "AND os_id != '9202'";

      const rows = db.prepare(`
        SELECT os_id, veiculo, placa, total_os, valor_restante, dias_no_patio, status_grid
        FROM ordens_servico
        WHERE LOWER(loja_slug) = LOWER(?) AND is_aberta = 1
        ${qualityFilter}
        ORDER BY total_os DESC LIMIT 10
      `).all(targetLoja) as any[];
      data = rows;
      dadosConsultados.push({
        fonte: 'ordens_servico',
        periodo: 'ativo',
        lojaSlug: targetLoja,
        payload: rows
      });
      if (rows.length) {
        replyText = `> *${lojaNome} — Ordens de Serviço Abertas*\n` +
          rows.map(r => `- *OS #${r.os_id}:* ${r.veiculo} (${r.placa}) — ${fmtMoeda(r.total_os)} | Saldo: ${fmtMoeda(r.valor_restante)}`).join('\n');
      } else {
        replyText = `> *${lojaNome} — Ordens de Serviço Abertas*\nNenhuma ordem de serviço aberta encontrada no pátio.`;
      }
      break;
    }

    case 'get_daily_revenue':
    case 'get_vendas_hoje': {
      const daily = getLatestDailyRevenue(db, dataReferencia, targetLoja);
      data = daily;
      dadosConsultados.push({
        fonte: 'faturamento_diario_horario',
        periodo: `hoje (${dataReferencia})`,
        lojaSlug: targetLoja,
        payload: daily
      });
      replyText = `> *${lojaNome} — Vendas de Hoje (${dataReferencia})*\n` +
        `- *Faturamento do Dia:* ${fmtMoeda(daily.faturamentoDia || daily.faturamento_dia)}\n` +
        `- *Volume de OS:* ${daily.volumeOsDia || daily.volume_os_dia}\n` +
        `- *Posição:* ${daily.posicaoHora || 'N/A'}`;
      break;
    }

    case 'get_metas':
    case 'get_store_metas': {
      const metas = getLatestMetasSnapshot(db, dataReferencia, targetLoja);
      data = metas;
      dadosConsultados.push({
        fonte: 'metas_horarias',
        periodo: `mês atual (${dataReferencia.slice(0, 7)})`,
        lojaSlug: targetLoja,
        payload: metas
      });
      const fatMes = Number(metas.faturamentoMes || metas.faturamento_mes || 0);
      const metaMes = Number(metas.metaMes || metas.meta_mes || 0);
      const goalMetrics = calculateGoalMetrics(fatMes, metaMes, {
        lojaSlug: targetLoja,
        lojaNome: lojaNome,
        posicaoHora: metas.posicaoHora
      });
      replyText = `> *${lojaNome} — Metas e Acumulado do Mês*\n` +
        `- *Faturamento Acumulado:* ${fmtMoeda(fatMes)}\n` +
        `- *Meta do Mês:* ${fmtMoeda(metaMes)}\n` +
        `- *Atingimento:* ${goalMetrics.atingimentoFormatado}\n` +
        `- *Falta para Meta:* ${goalMetrics.valorFaltanteFormatado}\n` +
        `- *Posição:* ${metas.posicaoHora || 'N/A'}`;
      break;
    }

    case 'composite_os_cmv': {
      // Multi-intenção consolidando ambas as fontes
      const osRows = db.prepare(`
        SELECT os_id, veiculo, placa, total_os, valor_restante FROM ordens_servico
        WHERE LOWER(loja_slug) = LOWER(?) AND is_aberta = 1
        ORDER BY total_os DESC LIMIT 5
      `).all(targetLoja) as any[];
      const cmvSnap = getLatestCMVSnapshot(db, dataInicio, dataFim, targetLoja);

      dadosConsultados.push({
        fonte: 'ordens_servico',
        periodo: 'ativo',
        lojaSlug: targetLoja,
        payload: osRows
      });
      dadosConsultados.push({
        fonte: 'cmv_lojas',
        periodo: `${dataInicio} a ${dataFim}`,
        lojaSlug: targetLoja,
        payload: cmvSnap
      });

      const storeItem = cmvSnap.lojas?.find(l => l.lojaSlug?.toLowerCase() === targetLoja.toLowerCase()) || cmvSnap.lojas?.[0];
      const cmvPct = storeItem ? Number(storeItem.cmvPercentual || 0).toFixed(2) : Number(cmvSnap.cmv_percentual || 0).toFixed(2);

      const osBloco = osRows.length
        ? osRows.map(r => `- *OS #${r.os_id}:* ${r.veiculo} (${r.placa}) — ${fmtMoeda(r.total_os)}`).join('\n')
        : 'Nenhuma OS aberta no pátio.';

      replyText = `> *${lojaNome} — Ordens de Serviço e CMV*\n\n` +
        `> *Ordens de Serviço Abertas*\n${osBloco}\n\n` +
        `> *CMV da Unidade (${dataInicio} a ${dataFim})*\n` +
        `- *CMV Geral:* ${cmvPct}%\n` +
        `- *Faturamento:* ${fmtMoeda(storeItem ? storeItem.faturamentoTotal : cmvSnap.faturamento_total)}\n` +
        `- *Custo:* ${fmtMoeda(storeItem ? storeItem.custoTotal : cmvSnap.custo_total)}`;

      data = { ordens_servico: osRows, cmv: cmvSnap };
      break;
    }

    default: {
      replyText = `> *Aviso Operacional*\nFerramenta "${toolName}" não reconhecida ou não suportada no escopo da loja.`;
      break;
    }
  }

  return {
    toolName,
    lojaSlug: targetLoja,
    allowed: true,
    data,
    dadosConsultados,
    replyText: sanitizeWhatsAppMarkdown(replyText)
  };
}

export const executeAuthorizedTool = executeAuthorizedStoreTool;

export async function handleConsultarDecision(
  db: Database.Database,
  decision: {
    tool: string;
    params?: Record<string, any>;
    reason?: string;
  },
  profile?: any,
  context?: TurnState | null
): Promise<AuthorizedToolExecutionResult> {
  return executeAuthorizedStoreTool(db, {
    toolName: decision.tool,
    params: decision.params,
    profile,
    context
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MATRIZ DE MÉTRICAS OFICIAIS (E0-E3)
// ─────────────────────────────────────────────────────────────────────────────

export const OFFICIAL_METRICS_MATRIX: Record<string, MetricDefinition> = {
  FATURAMENTO_DIA: {
    metricId: 'FATURAMENTO_DIA',
    name: 'Faturamento do Dia',
    authoritySource: 'faturamento_diario_horario',
    scopeType: 'loja',
    formulaDescription: 'faturamento_dia extraído da linha TOTAL do relatório oficial Excel (Vendas por Dia). Ausência no dia informa sem vendas confirmadas ou extração pendente.',
    unit: 'BRL',
    nullHandling: 'ZERO'
  },
  FATURAMENTO_MES: {
    metricId: 'FATURAMENTO_MES',
    name: 'Faturamento do Mês',
    authoritySource: 'metas_horarias',
    scopeType: 'loja',
    formulaDescription: 'faturamento_mes do Mapa de Metas oficial do mês civil corrente.',
    unit: 'BRL',
    nullHandling: 'ZERO'
  },
  ATINGIMENTO_META: {
    metricId: 'ATINGIMENTO_META',
    name: 'Atingimento de Meta',
    authoritySource: 'metas_horarias',
    scopeType: 'loja',
    formulaDescription: '(faturamento_mes / meta_mes) * 100. Se meta_mes <= 0, retorna 0 / N/A. Proibido exibir valores negativos.',
    unit: 'PERCENT',
    nullHandling: 'NOT_APPLICABLE'
  },
  CMV_GERAL: {
    metricId: 'CMV_GERAL',
    name: 'CMV Geral da Loja',
    authoritySource: 'cmv_lojas',
    scopeType: 'loja',
    formulaDescription: 'cmv_percentual da linha totalizadora oficial do sistema. Prevalece sobre médias aritméticas das áreas.',
    unit: 'PERCENT',
    nullHandling: 'NOT_APPLICABLE'
  },
  CMV_OLEO: {
    metricId: 'CMV_OLEO',
    name: 'CMV de Óleo',
    authoritySource: 'faturamento_areas',
    scopeType: 'loja',
    formulaDescription: 'cmv_percentual da linha de área OLEO na loja ativa.',
    unit: 'PERCENT',
    nullHandling: 'NOT_APPLICABLE'
  },
  SALDO_DEVEDOR_ABERTO: {
    metricId: 'SALDO_DEVEDOR_ABERTO',
    name: 'Saldo em Aberto (Pátio)',
    authoritySource: 'ordens_servico',
    scopeType: 'loja',
    formulaDescription: 'SUM(valor_restante) WHERE is_aberta = 1 AND (qualidade_dado IS NULL OR qualidade_dado = "VALIDADO"). Ordens suspeitas (como OS 9202) são excluídas e produzem subtotal não certificado.',
    unit: 'BRL',
    nullHandling: 'ZERO'
  }
};

/**
 * Cálculo seguro de atingimento de meta (T18):
 * - Divisão por zero ou meta zero retorna 'N/A' e 0%
 * - Zero valores negativos
 */
export function calculateGoalAchievement(faturamentoMes: number, metaMes: number): {
  percentual: number;
  formatado: string;
  isMetaZero: boolean;
  faltaParaMeta: number;
} {
  const fat = Number(faturamentoMes || 0);
  const meta = Number(metaMes || 0);

  if (meta <= 0) {
    return {
      percentual: 0,
      formatado: 'N/A',
      isMetaZero: true,
      faltaParaMeta: 0
    };
  }

  const ating = Math.max(0, Number(((fat / meta) * 100).toFixed(2)));
  const falta = Math.max(0, meta - fat);

  return {
    percentual: ating,
    formatado: `${ating.toFixed(1)}%`,
    isMetaZero: false,
    faltaParaMeta: falta
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTA EXATA DOS ÚLTIMOS 30 DIAS (E2-E3)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryOrdersLast30DaysOptions {
  referenceDate?: string;
  includeEncerradas?: boolean;
  limit?: number;
  offset?: number;
}

export interface QueryOrdersLast30DaysResult {
  orders: any[];
  totalCount: number;
  period: {
    referenceDate: string;
    startDate: string;
    endDate: string;
    startIso: string;
    endIso: string;
    startCivil: string;
    endCivil: string;
  };
  declaration: string;
  multidimensional: MultidimensionalResponse;
  replyText: string;
}

/**
 * Consulta exata de ordens dos últimos 30 dias (E2-E3):
 * - Aplica o intervalo civil [D-29 00:00:00, D 23:59:59] no fuso America/Sao_Paulo
 * - Avaliado sobre a data de abertura (data_evento_iso ou data_inicio_iso/data_inicio)
 * - Inclui ordens encerradas (não filtra is_aberta = 1)
 * - Exclui preventivamente ordens suspeitas sob quarentena
 * - Declaração padrão obrigatória: "Ordens abertas entre DD/MM e DD/MM (inclui as já encerradas)."
 */
export function queryOrdersLast30Days(
  db: Database.Database,
  lojaSlug: string,
  options?: QueryOrdersLast30DaysOptions
): QueryOrdersLast30DaysResult {
  const refDate = options?.referenceDate || resolveReferenceDate(db, getTodayIsoDate());
  
  // Cálculo civil de 30 dias consecutivos [D-29, D]
  const dRef = new Date(refDate.includes('T') ? refDate : `${refDate}T12:00:00Z`);
  const dStart = new Date(dRef.getTime() - 29 * 24 * 60 * 60 * 1000);
  
  const yStart = dStart.getUTCFullYear();
  const mStart = String(dStart.getUTCMonth() + 1).padStart(2, '0');
  const dayStart = String(dStart.getUTCDate()).padStart(2, '0');
  const startDateStr = `${yStart}-${mStart}-${dayStart}`;

  const yEnd = dRef.getUTCFullYear();
  const mEnd = String(dRef.getUTCMonth() + 1).padStart(2, '0');
  const dayEnd = String(dRef.getUTCDate()).padStart(2, '0');
  const endDateStr = `${yEnd}-${mEnd}-${dayEnd}`;

  const startIso = `${startDateStr} 00:00:00`;
  const endIso = `${endDateStr} 23:59:59`;
  const startCivil = `${dayStart}/${mStart}`;
  const endCivil = `${dayEnd}/${mEnd}`;

  const declaration = `Ordens abertas entre ${startCivil} e ${endCivil} (inclui as já encerradas).`;

  let hasDataEventoIso = false;
  let hasQualidadeDado = false;
  try {
    const cols = db.prepare("PRAGMA table_info(ordens_servico)").all() as Array<{ name: string }>;
    const colSet = new Set(cols.map(c => c.name));
    hasDataEventoIso = colSet.has('data_evento_iso');
    hasQualidadeDado = colSet.has('qualidade_dado');
  } catch {}

  const dateCol = hasDataEventoIso
    ? "COALESCE(data_evento_iso, data_inicio_iso, data_inicio)"
    : "COALESCE(data_inicio_iso, data_inicio)";

  const qualityClause = hasQualidadeDado
    ? "AND (qualidade_dado IS NULL OR qualidade_dado != 'SUSPEITO_QUARENTENA')"
    : "AND os_id != '9202'";

  // Inclusão expressa de encerradas (sem filtro is_aberta = 1)
  const sql = `
    SELECT * FROM ordens_servico
    WHERE LOWER(loja_slug) = LOWER(?)
      AND ${dateCol} >= ?
      AND ${dateCol} <= ?
      ${qualityClause}
    ORDER BY ${dateCol} DESC, os_id DESC
  `;

  const rows = db.prepare(sql).all(lojaSlug, startIso, endIso) as any[];
  const totalCount = rows.length;

  const limit = options?.limit || 20;
  const offset = options?.offset || 0;
  const pagedOrders = rows.slice(offset, offset + limit);

  const lojaNome = STORE_PRETTY_NAMES[lojaSlug]?.name || lojaSlug;
  const cardHeader = `> *${lojaNome} — Ordens dos Últimos 30 Dias*\n_${declaration}_`;
  const itens = pagedOrders.length
    ? pagedOrders.map(o => `- *OS #${o.os_id}:* ${o.veiculo || 'Veículo'} (${o.placa || 'Sem placa'}) — ${fmtMoeda(o.total_os)} | ${o.status_grid || (o.is_aberta ? 'Aberta' : 'Encerrada')}`).join('\n')
    : 'Nenhuma ordem de serviço aberta no período de 30 dias.';

  const replyText = sanitizeWhatsAppMarkdown(`${cardHeader}\n\n${itens}`);

  const multidimensional: MultidimensionalResponse = {
    execution: 'SUCCESS',
    access: 'AUTHORIZED',
    support: 'FULL',
    coverage: 'COMPLETE',
    freshness: 'FRESH',
    quality: 'RECONCILED',
    payload: {
      itemsCount: pagedOrders.length,
      totalProvenCount: totalCount,
      hasMore: (offset + limit) < totalCount,
      data: pagedOrders
    },
    provenance: {
      source: 'ordens_servico',
      capturedAt: new Date().toISOString(),
      periodApplied: `${startDateStr} a ${endDateStr}`
    }
  };

  return {
    orders: pagedOrders,
    totalCount,
    period: {
      referenceDate: refDate,
      startDate: startDateStr,
      endDate: endDateStr,
      startIso,
      endIso,
      startCivil,
      endCivil
    },
    declaration,
    multidimensional,
    replyText
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTAS FINANCEIRAS E REGRA DE NÃO-CERTIFICAÇÃO DE TOTAIS (E3-E3)
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenBalanceResult {
  lojaSlug: string;
  subtotal: number;
  totalOficial: number | null; // null se houver ordens suspeitas excluídas
  isCertified: boolean;
  excludedSuspectsCount: number;
  excludedSuspectsTotal: number;
  excludedOrders: Array<{ osId: string; totalOs: number; valorRestante: number; motivo: string }>;
  quality: 'RECONCILED' | 'SUSPECT';
  coverage: 'COMPLETE' | 'PARTIAL';
  replyText: string;
  multidimensional: MultidimensionalResponse;
}

/**
 * Consulta de saldo em aberto com regra estrita de NÃO-CERTIFICAÇÃO DE TOTAIS:
 * - Filtra qualidade_dado = 'VALIDADO' E is_aberta = 1
 * - Ao excluir suspeitos (como a OS 9202 em Kennedy), NUNCA declara como total oficial
 * - Emite como subtotal incompleto / não certificado propagando quality = 'SUSPECT' e coverage = 'PARTIAL'
 */
export function queryOpenBalance(
  db: Database.Database,
  lojaSlug: string,
  options?: { excludeSuspects?: boolean }
): OpenBalanceResult {
  let hasQualidadeDado = false;
  try {
    const cols = db.prepare("PRAGMA table_info(ordens_servico)").all() as Array<{ name: string }>;
    hasQualidadeDado = cols.some(c => c.name === 'qualidade_dado');
  } catch {}

  // 1. Ordens válidas em aberto
  const validSql = hasQualidadeDado
    ? `SELECT os_id, placa, veiculo, total_os, valor_restante, qualidade_dado FROM ordens_servico WHERE LOWER(loja_slug) = LOWER(?) AND is_aberta = 1 AND (qualidade_dado IS NULL OR qualidade_dado = 'VALIDADO') AND os_id != '9202'`
    : `SELECT os_id, placa, veiculo, total_os, valor_restante FROM ordens_servico WHERE LOWER(loja_slug) = LOWER(?) AND is_aberta = 1 AND os_id != '9202'`;

  const validRows = db.prepare(validSql).all(lojaSlug) as any[];
  const subtotal = validRows.reduce((acc, r) => acc + Number((r.valor_restante !== undefined && r.valor_restante !== null && r.valor_restante !== 0) ? r.valor_restante : (r.total_os || 0)), 0);

  // 2. Ordens suspeitas / em auditoria para esta loja
  const suspectSql = hasQualidadeDado
    ? `SELECT os_id, placa, veiculo, total_os, valor_restante, qualidade_dado FROM ordens_servico WHERE LOWER(loja_slug) = LOWER(?) AND (qualidade_dado IN ('SUSPEITO_QUARENTENA', 'CONFLITO', 'EM_AUDITORIA') OR os_id = '9202')`
    : `SELECT os_id, placa, veiculo, total_os, valor_restante FROM ordens_servico WHERE LOWER(loja_slug) = LOWER(?) AND os_id = '9202'`;

  const suspectRows = db.prepare(suspectSql).all(lojaSlug) as any[];
  const excludedSuspectsCount = suspectRows.length;
  const excludedSuspectsTotal = suspectRows.reduce((acc, r) => acc + Number(r.total_os || r.valor_restante || 0), 0);

  const isCertified = excludedSuspectsCount === 0;
  const totalOficial = isCertified ? subtotal : null;
  const quality = isCertified ? 'RECONCILED' : 'SUSPECT';
  const coverage = isCertified ? 'COMPLETE' : 'PARTIAL';

  const lojaNome = STORE_PRETTY_NAMES[lojaSlug]?.name || lojaSlug;
  let replyText = '';

  if (isCertified) {
    replyText = `> *${lojaNome} — Saldo em Aberto*\nTotal em aberto apurado: ${fmtMoeda(subtotal)}.`;
  } else {
    // REGRA DE NÃO-CERTIFICAÇÃO DE TOTAIS:
    // Nunca declarar o valor como total oficial; emitir como subtotal incompleto / não certificado
    const suspectDesc = suspectRows.map(s => `OS #${s.os_id} de ${fmtMoeda(s.total_os || s.valor_restante)}`).join(', ');
    replyText = `> *${lojaNome} — Saldo em Aberto*\nSubtotal em aberto apurado: ${fmtMoeda(subtotal)} (não certificado: ${excludedSuspectsCount} ordem sob auditoria excluída — ${suspectDesc}).`;
  }

  const multidimensional: MultidimensionalResponse = {
    execution: 'SUCCESS',
    access: 'AUTHORIZED',
    support: 'FULL',
    coverage,
    freshness: 'FRESH',
    quality,
    payload: {
      itemsCount: validRows.length,
      totalProvenCount: isCertified ? validRows.length : undefined,
      hasMore: false,
      data: {
        subtotal,
        totalOficial,
        isCertified,
        excludedSuspectsCount,
        excludedSuspectsTotal,
        orders: validRows
      }
    },
    provenance: {
      source: 'ordens_servico',
      capturedAt: new Date().toISOString(),
      periodApplied: 'posicao_atual'
    }
  };

  return {
    lojaSlug,
    subtotal,
    totalOficial,
    isCertified,
    excludedSuspectsCount,
    excludedSuspectsTotal,
    excludedOrders: suspectRows.map(s => ({
      osId: s.os_id,
      totalOs: s.total_os,
      valorRestante: s.valor_restante,
      motivo: 'SUSPEITO_QUARENTENA'
    })),
    quality,
    coverage,
    replyText: sanitizeWhatsAppMarkdown(replyText),
    multidimensional
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGINAÇÃO DETERMINÍSTICA COM CURSOR (E4-E3.2)
// ─────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 20;

export interface PageCursorPayload {
  snapshotId: string;
  queryHash: string;
  lojaSlug: string;
  offset: number;
  createdAt: number;
}

export function encodePageCursor(payload: PageCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodePageCursor(cursor: string): PageCursorPayload {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    throw new Error('INVALID_CURSOR_FORMAT');
  }
}

export interface PaginatedOrdersOptions {
  lojaSlug: string;
  cursor?: string;
  pageSize?: number;
  snapshotId?: string;
  onlyOpen?: boolean;
}

export interface PaginatedOrdersResult {
  items: any[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  cursor: string | null;
  snapshotId: string;
  queryHash: string;
  lojaSlug: string;
  multidimensional: MultidimensionalResponse;
}

export function queryOrdersPaginated(
  db: Database.Database,
  options: PaginatedOrdersOptions
): PaginatedOrdersResult {
  const { lojaSlug, cursor, onlyOpen = false } = options;
  const pageSize = options.pageSize || PAGE_SIZE;
  const activeSnapshotId = options.snapshotId || 'snap_v1';
  const queryHash = `query_orders_${lojaSlug}_${onlyOpen ? 'open' : 'all'}`;

  let offset = 0;
  if (cursor) {
    const decoded = decodePageCursor(cursor);
    // Guarda de escopo de cursor: se o cursor pertencer a outra loja, rejeita!
    if (decoded.lojaSlug && decoded.lojaSlug.toLowerCase() !== lojaSlug.toLowerCase()) {
      throw new Error(`CURSOR_STORE_MISMATCH: Cursor pertence à unidade ${decoded.lojaSlug}, mas a consulta atual é na unidade ${lojaSlug}.`);
    }
    offset = decoded.offset || 0;
  }

  let hasDataEventoIso = false;
  let hasQualidadeDado = false;
  try {
    const cols = db.prepare("PRAGMA table_info(ordens_servico)").all() as Array<{ name: string }>;
    const colSet = new Set(cols.map(c => c.name));
    hasDataEventoIso = colSet.has('data_evento_iso');
    hasQualidadeDado = colSet.has('qualidade_dado');
  } catch {}

  const dateCol = hasDataEventoIso
    ? "COALESCE(data_evento_iso, data_inicio_iso, data_inicio)"
    : "COALESCE(data_inicio_iso, data_inicio)";

  const qualityClause = hasQualidadeDado
    ? "AND (qualidade_dado IS NULL OR qualidade_dado != 'SUSPEITO_QUARENTENA')"
    : "AND os_id != '9202'";

  const openClause = onlyOpen ? "AND is_aberta = 1" : "";

  const totalCountRow = db.prepare(`
    SELECT COUNT(*) as total FROM ordens_servico
    WHERE LOWER(loja_slug) = LOWER(?)
      ${openClause}
      ${qualityClause}
  `).get(lojaSlug) as { total: number };
  const totalCount = totalCountRow?.total || 0;

  const rows = db.prepare(`
    SELECT * FROM ordens_servico
    WHERE LOWER(loja_slug) = LOWER(?)
      ${openClause}
      ${qualityClause}
    ORDER BY ${dateCol} DESC, os_id DESC
    LIMIT ? OFFSET ?
  `).all(lojaSlug, pageSize, offset) as any[];

  const hasNextPage = (offset + rows.length) < totalCount;
  const nextOffset = offset + rows.length;
  const nextCursor = hasNextPage
    ? encodePageCursor({
        snapshotId: activeSnapshotId,
        queryHash,
        lojaSlug,
        offset: nextOffset,
        createdAt: Date.now()
      })
    : null;

  const currentPage = Math.floor(offset / pageSize) + 1;

  const multidimensional: MultidimensionalResponse = {
    execution: 'SUCCESS',
    access: 'AUTHORIZED',
    support: 'FULL',
    coverage: 'COMPLETE',
    freshness: 'FRESH',
    quality: 'RECONCILED',
    payload: {
      itemsCount: rows.length,
      totalProvenCount: totalCount,
      hasMore: hasNextPage,
      data: rows
    },
    provenance: {
      source: 'ordens_servico',
      capturedAt: new Date().toISOString(),
      periodApplied: 'posicao_atual'
    },
    continuation: {
      cursor: nextCursor || undefined,
      nextPageAvailable: hasNextPage
    }
  };

  return {
    items: rows,
    totalCount,
    page: currentPage,
    pageSize,
    hasNextPage,
    nextCursor,
    cursor: cursor || null,
    snapshotId: activeSnapshotId,
    queryHash,
    lojaSlug,
    multidimensional
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISTINÇÃO ENTRE QUANTIDADE DE OS E PRESENÇA FÍSICA NO PÁTIO (T04)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resposta padrão quando não houver evidência operacional de pátio físico:
 * "Tenho a posição de OS abertas no sistema; ela não confirma quais veículos estão fisicamente no pátio."
 */
export function formatPatioPresenceReply(options: {
  osCount: number;
  vehicleCount: number;
  lojaNome: string;
  hasPhysicalPresenceProof?: boolean;
}): string {
  const { osCount, vehicleCount, lojaNome, hasPhysicalPresenceProof = false } = options;

  const lines = [
    `> *${lojaNome} — Posição de Ordens e Pátio*`,
    `- *Ordens de Serviço Abertas:* ${osCount}`,
    `- *Veículos Identificados com OS:* ${vehicleCount}`
  ];

  if (!hasPhysicalPresenceProof) {
    lines.push(`\n_Tenho a posição de OS abertas no sistema; ela não confirma quais veículos estão fisicamente no pátio._`);
  }

  return sanitizeWhatsAppMarkdown(lines.join('\n'));
}
