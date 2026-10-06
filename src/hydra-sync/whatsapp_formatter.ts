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
export function formatarRelatorioExecutivo(dados: DadosRelatorioExecutivo): string {
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

  // 6. O que fazer agora (Ações prioritárias acionáveis de 1 a 3 itens)
  if (dados.proximasAcoes && dados.proximasAcoes.length > 0) {
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
