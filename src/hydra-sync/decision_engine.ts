export interface PontoDeAtencao {
  id: string;
  categoria: 'FINANCEIRO' | 'PATIO' | 'COMERCIAL';
  descricao: string;
  valorExposto?: number;
  lojaAlvo?: string;
}

export interface DecisaoAcao {
  id: string;
  regraOrigem: string;
  evidencia: string;
  prioridade: number; // 1 = Máxima prioridade
  textoAcao: string;
}

export interface ResultadoDecisao {
  pontosAtencao: PontoDeAtencao[];
  proximasAcoes: DecisaoAcao[]; // Estritamente de 0 a 3 itens, com evidência
}

function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Motor de Decisão Determinístico:
 * Processa métricas auditadas e gera exclusivamente pontos de atenção e ações
 * que possuam regras explícitas e sustentação matemática em dados reais.
 */
export function processarDecisaoAuditada(dados: {
  alertasFinanceiros?: Array<{ loja: string; osId: string; valorTotal: number; saldoAReceber: number }>;
  carrosTravados?: Array<{ loja: string; osId: string; diasNoPatio: number }>;
  totalPatioAtivo?: number;
  ticketMedioRede?: number;
  raioXLojas?: Array<{ slug: string; nome: string; faturamentoMes: number; volumeOsMes: number; ticketMedio: number }>;
}): ResultadoDecisao {
  const pontosAtencao: PontoDeAtencao[] = [];
  const proximasAcoes: DecisaoAcao[] = [];

  const alertasFinanceiros = dados.alertasFinanceiros || [];
  const carrosTravados = dados.carrosTravados || [];
  const totalPatioAtivo = dados.totalPatioAtivo || 0;
  const ticketMedioRede = dados.ticketMedioRede || 0;
  const raioXLojas = dados.raioXLojas || [];

  // ── REGRA 1: Risco de Caixa (OSs sem sinal > R$ 2.500) ──────────────────
  if (alertasFinanceiros.length > 0) {
    // Cálculo da soma EXATA das OSs em alerta para garantir integridade matemática
    const totalExposto = alertasFinanceiros.reduce((acc, a) => acc + (Number(a.saldoAReceber) || 0), 0);
    const lojaMaiorExposicao = alertasFinanceiros[0].loja;
    const osIdMaior = alertasFinanceiros[0].osId;

    pontosAtencao.push({
      id: 'alerta-caixa-sem-sinal',
      categoria: 'FINANCEIRO',
      descricao: `${alertasFinanceiros.length} OS estão sem sinal (> R$ 2.500).`,
      valorExposto: totalExposto,
      lojaAlvo: lojaMaiorExposicao,
    });

    pontosAtencao.push({
      id: 'alerta-valor-exposto',
      categoria: 'FINANCEIRO',
      descricao: `Valor exposto: ${fmtMoeda(totalExposto)} (soma exata das ${alertasFinanceiros.length} OS).`,
      valorExposto: totalExposto,
    });

    proximasAcoes.push({
      id: 'acao-cobrar-sinal',
      regraOrigem: 'SALDO_ACIMA_2500_SEM_ENTRADA',
      evidencia: `${alertasFinanceiros.length} OSs totalizando ${fmtMoeda(totalExposto)}; maior em ${lojaMaiorExposicao} (OS #${osIdMaior})`,
      prioridade: 1,
      textoAcao: `Verificar as OS sem sinal e cobrar entrada mínima das ordens acima de R$ 2.500 (foco em ${lojaMaiorExposicao}).`,
    });
  }

  // ── REGRA 2: Gargalo de Pátio (Carros parados há 5+ dias) ───────────────
  if (carrosTravados.length > 0) {
    // Identificar loja com maior retenção física
    const contagemPorLoja: Record<string, number> = {};
    for (const c of carrosTravados) {
      contagemPorLoja[c.loja] = (contagemPorLoja[c.loja] || 0) + 1;
    }
    const lojasOrdenadas = Object.entries(contagemPorLoja).sort((a, b) => b[1] - a[1]);
    const lojaLiderGargalo = lojasOrdenadas[0];

    const pctSobreAbertas = totalPatioAtivo > 0 
      ? Math.round((carrosTravados.length / totalPatioAtivo) * 100) 
      : 0;

    pontosAtencao.push({
      id: 'alerta-carros-travados',
      categoria: 'PATIO',
      descricao: `${carrosTravados.length} veículos estão abertos há mais de 5 dias (${pctSobreAbertas}% das OS abertas).`,
    });

    if (lojaLiderGargalo) {
      pontosAtencao.push({
        id: 'alerta-maior-retencao',
        categoria: 'PATIO',
        descricao: `Maior retenção: ${lojaLiderGargalo[0]}, com ${lojaLiderGargalo[1]} veículos.`,
        lojaAlvo: lojaLiderGargalo[0],
      });

      proximasAcoes.push({
        id: 'acao-destravar-patio',
        regraOrigem: 'RETENCAO_PATIO_MAIOR_5_DIAS',
        evidencia: `${carrosTravados.length} veículos retidos; ${lojaLiderGargalo[1]} na unidade ${lojaLiderGargalo[0]}`,
        prioridade: 2,
        textoAcao: `Priorizar a liberação dos veículos parados há mais de 5 dias na unidade ${lojaLiderGargalo[0]}.`,
      });
    }
  }

  // ── REGRA 3: Desvio Crítico de Conversão / Ticket Médio ──────────────────
  // Apenas gera ação se houver evidência de loja com mais de 20 OSs cujo ticket médio seja < 50% da média da rede
  if (raioXLojas.length > 0 && ticketMedioRede > 0) {
    const lojaComDesvio = raioXLojas.find(
      (l) => l.volumeOsMes >= 20 && l.ticketMedio < ticketMedioRede * 0.5
    );
    if (lojaComDesvio) {
      proximasAcoes.push({
        id: 'acao-desvio-ticket-medio',
        regraOrigem: 'TICKET_MEDIO_ABAIXO_50_PCT_REDE',
        evidencia: `Loja ${lojaComDesvio.nome} com TK ${fmtMoeda(lojaComDesvio.ticketMedio)} vs média rede ${fmtMoeda(ticketMedioRede)}`,
        prioridade: 3,
        textoAcao: `Avaliar ticket médio da unidade ${lojaComDesvio.nome} (${fmtMoeda(lojaComDesvio.ticketMedio)}).`,
      });
    }
  }

  return { pontosAtencao, proximasAcoes };
}
