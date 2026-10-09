import { PontoDeAtencao, DecisaoAcao } from './decision_engine.js';

export interface DadosRelatorioExecutivo {
  dataReferencia: string;
  posicaoHora: string;
  faturamentoMes: number;
  totalOsMes: number;
  veiculosAbertosSistema: number;
  pontosAtencao: PontoDeAtencao[];
  ticketMedioRede: number;
  lideresComerciais: Array<{ nome: string; faturamento: number }>;
  proximasAcoes: DecisaoAcao[];
  ambienteOperacionalVerificado?: boolean;
  topicosPersonalizados?: Array<{ titulo: string; detalhe: string }>;
}

export interface AlertaOperacionalInput {
  tipo: string; // Ex: "ORÇAMENTO", "SLA", "PENDÊNCIA"
  unidade: string;
  gerente?: string;
  veiculo?: string;
  descricaoFalha: string;
  evidencia?: string;
  acaoRecomendada: string;
  linkConversa?: string;
}

function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formatador Executivo Oficial para WhatsApp (V2 - Gramática Nativa):
 * Explora 100% dos recursos nativos do cliente WhatsApp:
 * - Citação em bloco (`> `) para destaque da barra vertical lateral no Ponto Crítico.
 * - Listas nativas (`- `) para recuo automático e marcadores padronizados.
 * - Negrito inline (`*valor*`) para números e valores chaves.
 * - Zero emojis decorativos, zero separadores artificiais (━━).
 */
export function formatarRelatorioExecutivo(dados: DadosRelatorioExecutivo, options?: { isGroup?: boolean }): string {
  const blocos: string[] = [];

  // 1. Cabeçalho limpo e institucional
  blocos.push(`*HYDRA | Operação*\n\n${dados.dataReferencia} · ${dados.posicaoHora}`);

  // 2. Visão geral (Métricas com listas nativas e números em negrito)
  const resumoLinhas: string[] = [
    `*Visão geral*`,
    `- Faturamento no mês: *${fmtMoeda(dados.faturamentoMes)}*`,
    `- Total de OS no mês: *${dados.totalOsMes}* ordens`,
    `- Veículos com OS aberta no sistema: *${dados.veiculosAbertosSistema}*`,
  ];
  blocos.push(resumoLinhas.join('\n'));

  // 3. Ponto Crítico & Outros Alertas
  if (dados.pontosAtencao && dados.pontosAtencao.length > 0) {
    // Prioriza identificar o ponto de maior impacto (ex: carros travados no pátio ou maior exposição)
    let criticoIdx = dados.pontosAtencao.findIndex(p => p.id === 'alerta-carros-travados');
    if (criticoIdx === -1) {
      criticoIdx = dados.pontosAtencao.findIndex(p => p.valorExposto !== undefined && p.valorExposto > 0);
    }
    if (criticoIdx === -1) {
      criticoIdx = 0;
    }

    const pontoCritico = dados.pontosAtencao[criticoIdx];
    const outrosPontos = dados.pontosAtencao.filter((_, idx) => idx !== criticoIdx);

    // Bloco de Citação Nativa WhatsApp (> ) com barra lateral vertical
    blocos.push(`*Ponto crítico*\n> ${pontoCritico.descricao}`);

    // Bloco de Outros Alertas em lista nativa (- )
    if (outrosPontos.length > 0) {
      const outrosLinhas: string[] = [`*Outros alertas*`];
      for (const pa of outrosPontos) {
        // Formatar valor exposto em negrito se aplicável
        if (pa.id === 'alerta-valor-exposto' && pa.valorExposto) {
          outrosLinhas.push(`- Valor exposto: *${fmtMoeda(pa.valorExposto)}* (soma exata das OS em risco)`);
        } else {
          outrosLinhas.push(`- ${pa.descricao}`);
        }
      }
      blocos.push(outrosLinhas.join('\n'));
    }
  }

  // 4. Desempenho comercial (Opcional - renderiza apenas se houver dados consistentes)
  const temComercial = dados.ticketMedioRede > 0 || (dados.lideresComerciais && dados.lideresComerciais.length > 0);
  if (temComercial) {
    const comercialLinhas: string[] = [`*Desempenho comercial*`];
    if (dados.ticketMedioRede > 0) {
      comercialLinhas.push(`- Ticket médio da rede: *${fmtMoeda(dados.ticketMedioRede)}*`);
    }
    if (dados.lideresComerciais && dados.lideresComerciais[0]) {
      comercialLinhas.push(`- Líder: ${dados.lideresComerciais[0].nome} — *${fmtMoeda(dados.lideresComerciais[0].faturamento)}*`);
    }
    if (dados.lideresComerciais && dados.lideresComerciais[1]) {
      comercialLinhas.push(`- Segundo: ${dados.lideresComerciais[1].nome} — *${fmtMoeda(dados.lideresComerciais[1].faturamento)}*`);
    }
    blocos.push(comercialLinhas.join('\n'));
  }

  // 5. Destaques Personalizados (opcional - conforme preferências e memória do destinatário)
  if (dados.topicosPersonalizados && dados.topicosPersonalizados.length > 0) {
    const customLinhas: string[] = [`*Destaques personalizados*`];
    for (const tp of dados.topicosPersonalizados) {
      customLinhas.push(`- *${tp.titulo}:* ${tp.detalhe}`);
    }
    blocos.push(customLinhas.join('\n'));
  }

  // 6. O que fazer agora (Ações prioritárias acionáveis de 1 a 3 itens) — ESTRITAMENTE SUPRIMIDO NO GRUPO
  if (!options?.isGroup && dados.proximasAcoes && dados.proximasAcoes.length > 0) {
    const acoesLinhas: string[] = [`*O que fazer agora*`];
    dados.proximasAcoes.forEach((a, idx) => {
      acoesLinhas.push(`${idx + 1}. ${a.textoAcao}`);
    });
    blocos.push(acoesLinhas.join('\n'));
  }

  // 7. Rodapé técnico condicionado exclusivamente a health check verificado
  if (dados.ambienteOperacionalVerificado === true) {
    blocos.push(`_Status do ambiente: operacional_`);
  }

  return blocos.join('\n\n');
}

/**
 * Formato Compacto para check-ins rápidos ao longo do dia (--compact)
 */
export function formatarStatusCompacto(dados: DadosRelatorioExecutivo): string {
  const blocos: string[] = [];

  blocos.push(`*HYDRA · STATUS ${dados.posicaoHora}*`);

  const operacaoLinhas: string[] = [
    `*Operação*`,
    `- *${dados.totalOsMes}* ordens no mês`,
    `- *${dados.veiculosAbertosSistema}* veículos com OS aberta`,
  ];
  const travados = dados.pontosAtencao ? dados.pontosAtencao.find(p => p.id === 'alerta-carros-travados') : null;
  if (travados) {
    operacaoLinhas.push(`> ${travados.descricao}`);
  }
  blocos.push(operacaoLinhas.join('\n'));

  const financeiroLinhas: string[] = [
    `*Financeiro*`,
    `- Faturamento: *${fmtMoeda(dados.faturamentoMes)}*`,
  ];
  const exposto = dados.pontosAtencao ? dados.pontosAtencao.find(p => p.valorExposto !== undefined) : null;
  if (exposto && exposto.valorExposto) {
    financeiroLinhas.push(`- Risco de caixa: *${fmtMoeda(exposto.valorExposto)}*`);
  }
  blocos.push(financeiroLinhas.join('\n'));

  if (dados.topicosPersonalizados && dados.topicosPersonalizados.length > 0) {
    const customLinhas: string[] = [`*Personalizado*`];
    for (const item of dados.topicosPersonalizados) {
      customLinhas.push(`- ${item.titulo}: *${item.detalhe}*`);
    }
    blocos.push(customLinhas.join('\n'));
  }

  if (dados.proximasAcoes && dados.proximasAcoes.length > 0) {
    blocos.push(`*Prioridade*\n> ${dados.proximasAcoes[0].textoAcao}`);
  }

  if (dados.ambienteOperacionalVerificado === true) {
    blocos.push(`_Status: operacional_`);
  }

  return blocos.join('\n\n');
}

/**
 * Formato Padronizado para Alertas Operacionais com Citação em Bloco
 */
export function formatarAlertaOperacional(alerta: AlertaOperacionalInput): string {
  const blocos: string[] = [];

  blocos.push(`*FALHA OPERACIONAL — ${alerta.tipo.toUpperCase()}*`);

  const metaLinhas: string[] = [`- Unidade: *${alerta.unidade}*`];
  if (alerta.gerente) metaLinhas.push(`- Gerente: *${alerta.gerente}*`);
  if (alerta.veiculo) metaLinhas.push(`- Veículo: *${alerta.veiculo}*`);
  blocos.push(metaLinhas.join('\n'));

  blocos.push(alerta.descricaoFalha);

  if (alerta.evidencia) {
    blocos.push(`*Evidência*\n> “${alerta.evidencia}”`);
  }

  blocos.push(`*Ação recomendada*\n${alerta.acaoRecomendada}`);

  if (alerta.linkConversa) {
    blocos.push(`[Ver conversa](${alerta.linkConversa})`);
  }

  return blocos.join('\n\n');
}

export interface DadosLojaFaturamentoECmv {
  nome: string;
  slug?: string;
  faturamento: number;
  cmvPercentual: number | null;
}

export interface DadosBalaoFaturamentoECmv {
  dataReferencia: string;
  lojas: DadosLojaFaturamentoECmv[];
  faturamentoTotal: number;
  cmvMedioRede: number | null;
}

/**
 * Balão 2 Dedicado: Faturamento & CMV por Unidade
 * Formatação canônica sem slop e com alinhamento visual oficial Hydra
 */
export function formatarBalaoFaturamentoECmv(dados: DadosBalaoFaturamentoECmv): string {
  const blocos: string[] = [];

  blocos.push(`*HYDRA | Faturamento & CMV por Unidade*\n\n${dados.dataReferencia} · Posição Mês`);

  if (dados.lojas && dados.lojas.length > 0) {
    const lojasBlocos: string[] = [];
    dados.lojas.forEach((l, idx) => {
      const cmvTxt = (l.cmvPercentual !== null && l.cmvPercentual !== undefined)
        ? `${Number(l.cmvPercentual).toFixed(1).replace('.', ',')}%`
        : 'N/D';
      lojasBlocos.push(`${idx + 1}. *${l.nome}*\n- Faturamento: *${fmtMoeda(l.faturamento)}*\n- CMV: *${cmvTxt}*`);
    });
    blocos.push(`*Desempenho por unidade*\n\n` + lojasBlocos.join('\n\n'));
  } else {
    blocos.push(`*Desempenho por unidade*\n- Nenhuma loja apurada no período.`);
  }

  const consolidadoLinhas: string[] = [
    `*Consolidado da rede*`,
    `- Faturamento acumulado no mês: *${fmtMoeda(dados.faturamentoTotal)}*`,
    `- CMV médio da rede: *${(dados.cmvMedioRede !== null && dados.cmvMedioRede !== undefined) ? Number(dados.cmvMedioRede).toFixed(1).replace('.', ',') + '%' : 'N/D'}*`
  ];
  blocos.push(consolidadoLinhas.join('\n'));

  // Destaques rápidos e diretos: maior CMV e menor faturamento
  if (dados.lojas && dados.lojas.length > 0) {
    const lojasComCmv = dados.lojas.filter(l => l.cmvPercentual !== null && l.cmvPercentual !== undefined);
    const piorCmv = [...lojasComCmv].sort((a, b) => (b.cmvPercentual || 0) - (a.cmvPercentual || 0))[0];

    const lojasComFat = dados.lojas.filter(l => l.faturamento > 0);
    const menorFat = [...(lojasComFat.length > 0 ? lojasComFat : dados.lojas)].sort((a, b) => a.faturamento - b.faturamento)[0];

    const destaquesLinhas: string[] = [];
    if (piorCmv) {
      const cmvVal = Number(piorCmv.cmvPercentual).toFixed(1).replace('.', ',');
      destaquesLinhas.push(`> Maior CMV da rede: *${piorCmv.nome}* (${cmvVal}%).`);
    }
    if (menorFat) {
      const fatVal = fmtMoeda(menorFat.faturamento);
      destaquesLinhas.push(`> Menor faturamento no mês: *${menorFat.nome}* (${fatVal}).`);
    }
    if (destaquesLinhas.length > 0) {
      blocos.push(destaquesLinhas.join('\n'));
    }
  }

  return blocos.join('\n\n');
}

export interface VeiculoSemSinal {
  osId: string | number;
  veiculo: string;
  placa?: string;
  saldo: number;
}

export interface LojaCarrosSemSinal {
  loja: string;
  slug?: string;
  totalValor: number;
  totalQtd: number;
  veiculos: VeiculoSemSinal[];
}

export interface DadosCarrosSemSinal {
  totalQtd: number;
  totalValor: number;
  totalLojas?: number;
  porLoja?: LojaCarrosSemSinal[];
  lista?: Array<VeiculoSemSinal & { loja: string }>;
}

/**
 * Formata o bloco de Carros em Pátio sem Sinal agrupado por Loja (sem pipes | e com estilo alinhado ao Faturamento & CMV)
 */
export function formatarCarrosSemSinalPorLoja(dados: DadosCarrosSemSinal): string {
  const blocos: string[] = [
    `*Carros em pátio sem sinal*\n- Total zerado de entrada: *${fmtMoeda(dados.totalValor)}* (${dados.totalQtd} ordens)`
  ];

  if (dados.porLoja && dados.porLoja.length > 0) {
    const lojasBlocos: string[] = [];
    dados.porLoja.forEach((l, idx) => {
      const linhasLoja = [
        `${idx + 1}. *${l.loja}*`,
        `- Total sem sinal: *${fmtMoeda(l.totalValor)}* (${l.totalQtd} ${l.totalQtd === 1 ? 'ordem' : 'ordens'})`
      ];
      l.veiculos.forEach(v => {
        linhasLoja.push(`- ${v.veiculo} (OS #${v.osId}): *${fmtMoeda(v.saldo)}*`);
      });
      lojasBlocos.push(linhasLoja.join('\n'));
    });
    blocos.push(lojasBlocos.join('\n\n'));
  } else if (dados.lista && dados.lista.length > 0) {
    const listaLinhas: string[] = [];
    dados.lista.forEach((c, idx) => {
      listaLinhas.push(`${idx + 1}. *${c.loja}:* ${c.veiculo} (OS #${c.osId}) - *${fmtMoeda(c.saldo)}*`);
    });
    blocos.push(listaLinhas.join('\n'));
  }

  return blocos.join('\n\n');
}

export interface VeiculoSinalCritico {
  osId: string | number;
  veiculo: string;
  placa?: string;
  totalOs: number;
  valorPago: number;
  saldoRestante: number;
  percentualPago: number;
  falta60: number;
}

export interface LojaSinalCritico {
  loja: string;
  slug?: string;
  totalValorRestante: number;
  totalQtd: number;
  veiculos: VeiculoSinalCritico[];
}

export interface DadosBlocoSinalCritico {
  totalQtd: number;
  totalValorRestante: number;
  totalLojas: number;
  lojas: LojaSinalCritico[];
}

/**
 * Formata o bloco de Carros Críticos sem Sinal (< 60% pago e pendência >= R$ 2.600)
 */
export function formatarCarrosCriticosSinal(dados: DadosBlocoSinalCritico): string {
  if (!dados.lojas || dados.lojas.length === 0) {
    return `*Carros críticos sem sinal de 60%*\n- Nenhuma ordem acima de R$ 2.600 sem o sinal mínimo de 60%.`;
  }

  const cabecalho = [
    `*Carros críticos sem sinal de 60%*`,
    `- Saldo em risco (pendência ≥ R$ 2.600): *${fmtMoeda(dados.totalValorRestante)}* (${dados.totalQtd} ordens em ${dados.totalLojas} lojas)`
  ];

  const lojasBlocos: string[] = [];
  dados.lojas.forEach((l, idx) => {
    const linhas: string[] = [`${idx + 1}. *${l.loja}*`];
    l.veiculos.forEach(v => {
      const pctTxt = `${Number(v.percentualPago).toFixed(0)}% pago`;
      linhas.push(`- ${v.veiculo} (OS #${v.osId}): *${fmtMoeda(v.saldoRestante)}* pendente (${pctTxt})`);
    });
    lojasBlocos.push(linhas.join('\n'));
  });

  return cabecalho.join('\n') + '\n\n' + lojasBlocos.join('\n\n');
}



