import * as fs from 'fs';
import * as path from 'path';
import { parseDataBR } from './delta_storage.js';
import { obterMetasConsolidado, ResultadoMapaMetas } from './metas_crawler.js';
import {
  getDatabaseConnection,
  getPatioOverview,
  getAgingCars,
  getFinancialAlerts,
  getMetasConsolidadas,
} from './db_repository.js';
import { processarDecisaoAuditada, ResultadoDecisao } from './decision_engine.js';
import {
  formatarRelatorioExecutivo,
  formatarStatusCompacto,
  DadosRelatorioExecutivo,
} from './whatsapp_formatter.js';

// ─── Interfaces de Domínio (Especificações Oficiais v3.0) ────────────────────

export interface AlertaFinanceiro {
  loja: string;
  osId: string;
  valorTotal: number;
  saldoAReceber: number;
}

export interface CarroTravado {
  loja: string;
  osId: string;
  diasNoPatio: number;
}

export interface OSConciliacaoItem {
  osId: string;
  valorTotal: number;
  saldoAReceber: number;
}

export interface PatioLojaConsolidado {
  nome: string;
  slug: string;
  qtdAbertas: number;
  valorTotal: number;
  saldoRestante: number;
}

export interface RaioXLoja {
  slug: string;
  nome: string;
  faturamentoMes: number;
  volumeOsMes: number;
  ticketMedio: number;
  osEmAberto: number;
}

export interface BriefingTopicoPersonalizado {
  topico: string;
  titulo: string;
  detalhe: string;
  fonteAtualizada: boolean;
  lojaSlug?: string;
}

export interface BriefingIA {
  riscoFinanceiro?: string;
  gargaloPatio?: string;
  eficienciaComercial?: string;
  topicosPersonalizados?: BriefingTopicoPersonalizado[];
  destinatario?: string;
}

export interface ConsolidadoRede {
  dataReferencia: string;
  posicaoHora: string;
  faturamentoTotal: number;
  totalOSs: number;
  ticketMedioRede: number;
  totalPatioAtivo: number;
  alertasFinanceiros: AlertaFinanceiro[];
  carrosTravados: CarroTravado[];
  conciliacaoPorLoja: Record<string, OSConciliacaoItem[]>;
  patioPorLoja: PatioLojaConsolidado[];
  raioXLojas: RaioXLoja[];
  briefingIA?: BriefingIA;
  origemMetas?: 'MAPA_METAS_OFICIAL' | 'CONSOLIDADO_CRAWL_LOCAL';
  ambienteOperacionalVerificado?: boolean;
}

// ─── Regras de Negócio e Filtros de Governança ─────────────────────────────

/**
 * REGRA GLOBAL DE EXCEÇÃO:
 * A loja Master deve ser ignorada, removida e sumariamente desconsiderada de
 * todos os indicadores, relatórios, auditorias e somatórias.
 */
export function isLojaValida(slug: string, nome?: string): boolean {
  const s = (slug || '').toLowerCase().trim();
  const n = (nome || '').toLowerCase().trim();
  return !s.includes('master') && !n.includes('master');
}

/**
 * 2. VISÃO DE PÁTIO RIGOROSA (PDF-1):
 * Somar exclusivamente veículos com Status = "Em Aberto" em produção física.
 * Ordens de serviço já finalizadas, entregues, faturadas, canceladas ou quitadas
 * sem pendência são sumariamente expurgadas para eliminar falsos volumes.
 */
export function isStatusEmAbertoValido(doc: any): boolean {
  if (!doc) return false;

  // 1. Se tem data_fim preenchida, o serviço já foi concluído
  if (doc.data_fim && String(doc.data_fim).trim().length > 0) {
    return false;
  }

  // 2. Se quitada/paga integralmente (saldo restante 0 e valor pago > 0), veículo faturado/entregue
  const valorRestante = Number(doc.valor_restante) || 0;
  const valorPago = Number(doc.valor_pago) || 0;
  const totalOs = Number(doc.total_os) || 0;

  if (valorRestante === 0 && (valorPago > 0 || totalOs > 0)) {
    return false;
  }

  // 3. Se possui notas fiscais emitidas, a OS já foi faturada e emitida
  if (doc.notas_fiscais && Array.isArray(doc.notas_fiscais) && doc.notas_fiscais.length > 0) {
    return false;
  }

  // 4. Status textual explicitamente fechado ou cancelado
  const s = (doc.status_grid || '').trim().toLowerCase();
  const fechados = ['fechada', 'finalizada', 'entregue', 'faturada', 'cancelada', 'liberada', 'retorno'];
  if (fechados.some(f => s.includes(f))) {
    return false;
  }

  // 5. Anexos que comprovam entrega física do veículo
  const anexos = (doc.documentos_anexos || []).map((a: any) => (a.descricao || '').toLowerCase());
  if (anexos.some((a: string) => a.includes('entrega') || a.includes('declaracao de entrega'))) {
    return false;
  }

  return true;
}

/**
 * 4. ALERTAS FINANCEIROS E OPERACIONAIS:
 * Gatilho simultâneo: Saldo a Receber superior a R$ 2.500,00 E não possua nenhum sinal ou entrada (valorPago === 0).
 */
export function isAlertaFinanceiro(totalOs: number, valorPago: number): boolean {
  const saldoAReceber = totalOs - valorPago;
  return saldoAReceber > 2500 && valorPago === 0;
}

/**
 * 5. CARROS TRAVADOS NO PÁTIO (>= 5 DIAS):
 * Rastrear exclusivamente veículos com OS em aberto há 5 dias ou mais.
 */
export function isCarroTravado(diasNoPatio: number, isEmAberto: boolean): boolean {
  return isEmAberto && diasNoPatio >= 5;
}

// ─── Motor de Análise e Consolidação ────────────────────────────────────────

export function analisarAuditoriaRede(crawlsDir: string = '/home/operacional/hydra-data/crawls'): ConsolidadoRede {
  // 0. Tentar leitura de alta performance do SQLite WAL hydra_ops.db
  try {
    const db = getDatabaseConnection();
    const dbPatio = getPatioOverview(db);
    if (dbPatio && dbPatio.length > 0) {
      console.log(`[Audit Engine] 🚀 Leitura ultrarrápida do SQLite ativada (${dbPatio.length} lojas com dados).`);
      
      const dbAlerts = getFinancialAlerts(db, 2500);
      const dbAging = getAgingCars(db, 5);
      const dbMetas = getMetasConsolidadas(db);

      const EMPRESAS_NAMES: Record<string, string> = {
        'MPdompedro1': 'Dom Pedro',
        'MPJabaquara': 'Jabaquara',
        'MPJorgeBeretta': 'Jorge Beretta',
        'MPkennedy': 'Kennedy',
        'MPpiraporinha': 'Piraporinha',
        'MPplanalto': 'Planalto',
        'MPrudge': 'Rudge',
        'MPSantoAndre': 'Santo Andre',
        'ReiDoModulo': 'Rei Do Modulo',
        'ReiDoOleoMaua': 'Rei Do Oleo Maua'
      };

      const alertasFinanceiros: AlertaFinanceiro[] = dbAlerts
        .filter((a: any) => isLojaValida(a.loja_slug, EMPRESAS_NAMES[a.loja_slug] || a.loja_slug))
        .map((a: any) => ({
          loja: EMPRESAS_NAMES[a.loja_slug] || a.loja_slug,
          osId: String(a.os_id),
          valorTotal: a.total_os,
          saldoAReceber: a.valor_restante,
        }));

      const carrosTravados: CarroTravado[] = dbAging
        .filter((c: any) => isLojaValida(c.loja_slug, EMPRESAS_NAMES[c.loja_slug] || c.loja_slug))
        .map((c: any) => ({
          loja: EMPRESAS_NAMES[c.loja_slug] || c.loja_slug,
          osId: String(c.os_id),
          diasNoPatio: c.dias_no_patio,
        }));

      const patioPorLoja: PatioLojaConsolidado[] = [];
      const patioPorLojaMap: Record<string, PatioLojaConsolidado> = {};

      for (const p of dbPatio) {
        if (!isLojaValida(p.loja_slug, EMPRESAS_NAMES[p.loja_slug] || p.loja_slug)) continue;
        const nome = EMPRESAS_NAMES[p.loja_slug] || p.loja_slug;
        const item: PatioLojaConsolidado = {
          nome,
          slug: p.loja_slug,
          qtdAbertas: p.total_abertas || 0,
          valorTotal: p.total_valor || 0,
          saldoRestante: p.total_restante || 0,
        };
        patioPorLoja.push(item);
        patioPorLojaMap[p.loja_slug] = item;
        patioPorLojaMap[nome] = item;
      }

      // Priorizar Metas Oficiais do Mapa de Metas (JSON metas_rede.json ou SQLite metas_diarias)
      const metasOficial = obterMetasConsolidado(crawlsDir);
      const raioXLojas: RaioXLoja[] = [];
      let faturamentoFinal = 0;
      let totalOsFinal = 0;
      let ticketMedioRede = 0;
      let origemMetas: 'MAPA_METAS_OFICIAL' | 'CONSOLIDADO_CRAWL_LOCAL' = 'CONSOLIDADO_CRAWL_LOCAL';

      if (metasOficial && metasOficial.faturamentoTotal > 0) {
        faturamentoFinal = metasOficial.faturamentoTotal;
        totalOsFinal = metasOficial.totalOSs;
        ticketMedioRede = metasOficial.ticketMedioRede || (totalOsFinal > 0 ? faturamentoFinal / totalOsFinal : 0);
        origemMetas = 'MAPA_METAS_OFICIAL';

        for (const l of metasOficial.lojas) {
          if (!isLojaValida(l.slug, l.nome)) continue;
          const pInfo = patioPorLojaMap[l.nome] ?? patioPorLojaMap[l.slug] ?? {
            nome: l.nome,
            slug: l.slug,
            qtdAbertas: 0,
            valorTotal: 0,
            saldoRestante: 0
          };
          raioXLojas.push({
            slug: l.slug,
            nome: l.nome,
            faturamentoMes: l.faturamentoTotal,
            volumeOsMes: l.volumeOS,
            ticketMedio: l.ticketMedio || (l.volumeOS > 0 ? l.faturamentoTotal / l.volumeOS : 0),
            osEmAberto: pInfo.qtdAbertas
          });
        }
      } else if (dbMetas && dbMetas.length > 0) {
        origemMetas = 'MAPA_METAS_OFICIAL';
        for (const m of dbMetas) {
          if (!isLojaValida(m.loja_slug, EMPRESAS_NAMES[m.loja_slug])) continue;
          const nome = EMPRESAS_NAMES[m.loja_slug] || m.loja_slug;
          const pInfo = patioPorLojaMap[nome] ?? patioPorLojaMap[m.loja_slug] ?? {
            nome,
            slug: m.loja_slug,
            qtdAbertas: 0,
            valorTotal: 0,
            saldoRestante: 0
          };
          faturamentoFinal += m.faturamento_mes;
          totalOsFinal += m.volume_os;
          raioXLojas.push({
            slug: m.loja_slug,
            nome,
            faturamentoMes: m.faturamento_mes,
            volumeOsMes: m.volume_os,
            ticketMedio: m.ticket_medio || (m.volume_os > 0 ? m.faturamento_mes / m.volume_os : 0),
            osEmAberto: pInfo.qtdAbertas
          });
        }
        ticketMedioRede = totalOsFinal > 0 ? faturamentoFinal / totalOsFinal : 0;
      }

      // Ordenar
      alertasFinanceiros.sort((a, b) => b.saldoAReceber - a.saldoAReceber);
      carrosTravados.sort((a, b) => b.diasNoPatio - a.diasNoPatio);
      raioXLojas.sort((a, b) => b.faturamentoMes - a.faturamentoMes);
      patioPorLoja.sort((a, b) => b.qtdAbertas - a.qtdAbertas);

      const totalPatioAtivo = patioPorLoja.reduce((acc, p) => acc + p.qtdAbertas, 0);
      const agora = new Date();
      const horaStr = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

      return {
        dataReferencia: agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        posicaoHora: horaStr,
        faturamentoTotal: faturamentoFinal,
        totalOSs: totalOsFinal,
        ticketMedioRede,
        totalPatioAtivo,
        alertasFinanceiros,
        carrosTravados,
        conciliacaoPorLoja: {},
        patioPorLoja,
        raioXLojas,
        origemMetas
      };
    }
  } catch (sqliteErr: any) {
    console.warn(`[Audit Engine] SQLite não disponível ou sem dados (${sqliteErr.message}). Utilizando fallback para JSONs de crawl.`);
  }

  // 1. Obter os números oficiais do Mapa de Metas (wfMapaDeMeta.aspx)
  const metasOficial = obterMetasConsolidado(crawlsDir);

  // 2. Ler arquivos de crawl detalhado de cada loja (expurgando terminantemente Master)
  const files = fs.readdirSync(crawlsDir).filter(f => 
    f.startsWith('extracao_mes_') && 
    f.endsWith('.json') && 
    !f.includes('antigo') &&
    !f.toLowerCase().includes('master')
  );

  const alertasFinanceiros: AlertaFinanceiro[] = [];
  const carrosTravados: CarroTravado[] = [];
  const conciliacaoPorLoja: Record<string, OSConciliacaoItem[]> = {};
  const patioPorLojaMap: Record<string, PatioLojaConsolidado> = {};

  let faturamentoLocalFallback = 0;
  let totalOSsLocalFallback = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(crawlsDir, file), 'utf-8');
      const data = JSON.parse(content);
      const slugLoja = data.slug_loja || '';
      const lojaNome = data.nome_amigavel || slugLoja;

      // REFORÇO DA REGRA GLOBAL ANTI-MASTER
      if (!isLojaValida(slugLoja, lojaNome)) {
        continue;
      }

      let fatLojaLocal = 0;
      let abertasLoja = 0;
      let valorTotalPatio = 0;
      let saldoRestantePatio = 0;
      const conciliacaoLoja: OSConciliacaoItem[] = [];

      for (const doc of (data.documentos || [])) {
        const totalOs = Number(doc.total_os) || 0;
        const valorPago = Number(doc.valor_pago) || 0;
        const saldoAReceber = Math.max(0, totalOs - valorPago);
        
        fatLojaLocal += totalOs;

        // FILTRO RIGOROSO: Exclusivamente OSs realmente em aberto no pátio
        if (isStatusEmAbertoValido(doc)) {
          abertasLoja++;
          valorTotalPatio += totalOs;
          saldoRestantePatio += saldoAReceber;

          // Calcular dias no pátio a partir da data de abertura
          let diasNoPatio = 0;
          if (doc.data_inicio) {
            const dtIni = parseDataBR(doc.data_inicio);
            if (dtIni) {
              diasNoPatio = Math.max(0, Math.floor((Date.now() - dtIni.getTime()) / (1000 * 60 * 60 * 24)));
            }
          }

          // 3. CARROS TRAVADOS NO PÁTIO (>= 5 DIAS)
          if (isCarroTravado(diasNoPatio, true)) {
            carrosTravados.push({
              loja: lojaNome,
              osId: String(doc.id),
              diasNoPatio
            });
          }

          // 2. ALERTAS FINANCEIROS (Saldo > R$ 2.500 E Entrada = 0)
          if (isAlertaFinanceiro(totalOs, valorPago)) {
            alertasFinanceiros.push({
              loja: lojaNome,
              osId: String(doc.id),
              valorTotal: totalOs,
              saldoAReceber
            });
          }

          // Conciliação financeira por loja
          conciliacaoLoja.push({
            osId: String(doc.id),
            valorTotal: totalOs,
            saldoAReceber
          });
        }
      }

      patioPorLojaMap[lojaNome] = {
        nome: lojaNome,
        slug: slugLoja,
        qtdAbertas: abertasLoja,
        valorTotal: valorTotalPatio,
        saldoRestante: saldoRestantePatio
      };
      patioPorLojaMap[slugLoja] = patioPorLojaMap[lojaNome];

      faturamentoLocalFallback += fatLojaLocal;
      totalOSsLocalFallback += (data.documentos || []).length;

      if (conciliacaoLoja.length > 0) {
        conciliacaoPorLoja[lojaNome] = conciliacaoLoja;
      }
    } catch (e: any) {
      console.error(`Erro ao processar ${file}:`, e.message);
    }
  }

  // 5. Montagem do Raio-X das Lojas, Pátio Consolidado e Consolidação da Rede
  const raioXLojas: RaioXLoja[] = [];
  const patioPorLoja: PatioLojaConsolidado[] = [];
  let faturamentoFinal = faturamentoLocalFallback;
  let totalOsFinal = totalOSsLocalFallback;
  let ticketMedioRede = totalOSsLocalFallback > 0 ? faturamentoLocalFallback / totalOSsLocalFallback : 0;
  let origemMetas: 'MAPA_METAS_OFICIAL' | 'CONSOLIDADO_CRAWL_LOCAL' = 'CONSOLIDADO_CRAWL_LOCAL';

  if (metasOficial && metasOficial.faturamentoTotal > 0) {
    faturamentoFinal = metasOficial.faturamentoTotal;
    totalOsFinal = metasOficial.totalOSs;
    ticketMedioRede = metasOficial.ticketMedioRede || (metasOficial.totalOSs > 0 ? metasOficial.faturamentoTotal / metasOficial.totalOSs : 0);
    origemMetas = 'MAPA_METAS_OFICIAL';

    for (const l of metasOficial.lojas) {
      if (!isLojaValida(l.slug, l.nome)) continue;

      const pInfo = patioPorLojaMap[l.nome] ?? patioPorLojaMap[l.slug] ?? {
        nome: l.nome,
        slug: l.slug,
        qtdAbertas: 0,
        valorTotal: 0,
        saldoRestante: 0
      };

      raioXLojas.push({
        slug: l.slug,
        nome: l.nome,
        faturamentoMes: l.faturamentoTotal,
        volumeOsMes: l.volumeOS,
        ticketMedio: l.ticketMedio || (l.volumeOS > 0 ? l.faturamentoTotal / l.volumeOS : 0),
        osEmAberto: pInfo.qtdAbertas
      });

      patioPorLoja.push(pInfo);
    }
  } else {
    // Fallback caso não haja metas_rede.json
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(crawlsDir, file), 'utf-8');
        const data = JSON.parse(content);
        const slug = data.slug_loja || '';
        const nome = data.nome_amigavel || slug;
        if (!isLojaValida(slug, nome)) continue;

        let fat = 0;
        for (const doc of (data.documentos || [])) fat += Number(doc.total_os) || 0;
        const volume = (data.documentos || []).length;
        const pInfo = patioPorLojaMap[nome] || {
          nome,
          slug,
          qtdAbertas: 0,
          valorTotal: 0,
          saldoRestante: 0
        };

        raioXLojas.push({
          slug,
          nome,
          faturamentoMes: fat,
          volumeOsMes: volume,
          ticketMedio: volume > 0 ? fat / volume : 0,
          osEmAberto: pInfo.qtdAbertas
        });

        patioPorLoja.push(pInfo);
      } catch {}
    }
  }

  // A somatória do pátio da rede é a soma exata de carros em aberto das 10 lojas
  const totalPatioAtivoRede = patioPorLoja.reduce((acc, p) => acc + p.qtdAbertas, 0);

  // Ordenações para visualização executiva
  alertasFinanceiros.sort((a, b) => b.saldoAReceber - a.saldoAReceber);
  carrosTravados.sort((a, b) => b.diasNoPatio - a.diasNoPatio);
  raioXLojas.sort((a, b) => b.faturamentoMes - a.faturamentoMes);

  const agora = new Date();
  const horaStr = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  return {
    dataReferencia: agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    posicaoHora: horaStr,
    faturamentoTotal: faturamentoFinal,
    totalOSs: totalOsFinal,
    ticketMedioRede,
    totalPatioAtivo: totalPatioAtivoRede,
    alertasFinanceiros,
    carrosTravados,
    conciliacaoPorLoja,
    patioPorLoja,
    raioXLojas,
    origemMetas
  };
}

function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Formatador Oficial WhatsApp Anti-AI Slop ────────────────────────────────

export function formatarMensagemWhatsApp(dados: ConsolidadoRede, modo: 'padrao' | 'compacto' = 'padrao'): string {
  // Toggle de Fallback Legado acionável por variável de ambiente
  if (process.env.HYDRA_REPORT_FORMAT === 'legacy') {
    return formatarMensagemWhatsAppLegada(dados);
  }

  const decisao = processarDecisaoAuditada(dados);
  const lideresComerciais = (dados.raioXLojas || []).slice(0, 2).map(l => ({
    nome: l.nome,
    faturamento: l.faturamentoMes,
  }));

  const dadosExec: DadosRelatorioExecutivo = {
    dataReferencia: dados.dataReferencia,
    posicaoHora: dados.posicaoHora,
    faturamentoMes: dados.faturamentoTotal,
    totalOsMes: dados.totalOSs,
    veiculosAbertosSistema: dados.totalPatioAtivo,
    pontosAtencao: decisao.pontosAtencao,
    ticketMedioRede: dados.ticketMedioRede,
    lideresComerciais,
    proximasAcoes: decisao.proximasAcoes,
    ambienteOperacionalVerificado: dados.ambienteOperacionalVerificado,
    topicosPersonalizados: dados.briefingIA?.topicosPersonalizados?.map(t => ({
      titulo: t.titulo,
      detalhe: t.detalhe
    }))
  };

  if (modo === 'compacto') {
    return formatarStatusCompacto(dadosExec);
  }

  return formatarRelatorioExecutivo(dadosExec);
}

export function formatarMensagemWhatsAppLegada(dados: ConsolidadoRede): string {
  const agora = new Date();
  const dataExtensa = agora.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  let msg = `🐉 *HYDRA — RELATÓRIO DIÁRIO OPERACIONAL & FINANCEIRO*\n`;
  msg += `📅 *Posição das ${dados.posicaoHora}* | ${dataExtensa}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 🧠 DIAGNÓSTICO EXECUTIVO DA IA (Sem floreios, sem AI Slop)
  if (dados.briefingIA) {
    msg += `🧠 *DIAGNÓSTICO EXECUTIVO DA IA:*\n\n`;
    if (dados.briefingIA.riscoFinanceiro) {
      msg += `• 💰 *Risco de Caixa:* ${dados.briefingIA.riscoFinanceiro}\n\n`;
    }
    if (dados.briefingIA.gargaloPatio) {
      msg += `• ⏳ *Gargalo de Pátio:* ${dados.briefingIA.gargaloPatio}\n\n`;
    }
    if (dados.briefingIA.eficienciaComercial) {
      msg += `• ⚡ *Desempenho Comercial:* ${dados.briefingIA.eficienciaComercial}\n\n`;
    }
    if (dados.briefingIA.topicosPersonalizados && dados.briefingIA.topicosPersonalizados.length > 0) {
      msg += `🎯 *Destaques Personalizados:*\n`;
      for (const t of dados.briefingIA.topicosPersonalizados) {
        msg += `• *${t.titulo}:* ${t.detalhe}\n`;
      }
      msg += `\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  }

  // 1. CONSOLIDADO DA REDE (MÊS ATUAL)
  msg += `📊 *1. CONSOLIDADO DA REDE (MÊS ATUAL)*\n`;
  msg += `_(Tela Mapa de Metas)_\n\n`;
  msg += `• *Faturamento Mensal Acumulado:* ${fmtMoeda(dados.faturamentoTotal)}\n\n`;
  msg += `• *Total de OS no Mês:* ${dados.totalOSs} ordens\n\n`;
  msg += `• *Carros no Pátio (Abertas):* ${dados.totalPatioAtivo} veículos\n`;
  msg += `_(Soma do Pátio de Todas as Lojas — sem Master)_\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  // 2. ALERTAS FINANCEIROS E OPERACIONAIS
  msg += `🚨 *2. ALERTAS FINANCEIROS E OPERACIONAIS*\n`;
  msg += `_(Gatilho: Saldo a Receber > R$ 2.500,00 e Entrada = R$ 0,00)_\n\n`;

  if (dados.alertasFinanceiros.length > 0) {
    dados.alertasFinanceiros.slice(0, 10).forEach(al => {
      msg += `• *${al.loja}:* OS #${al.osId} — Total: ${fmtMoeda(al.valorTotal)} | *Saldo: ${fmtMoeda(al.saldoAReceber)}*\n`;
    });
    if (dados.alertasFinanceiros.length > 10) {
      msg += `... e mais ${dados.alertasFinanceiros.length - 10} ordens críticas em aberto.\n`;
    }
  } else {
    msg += `• *Nenhuma OS em risco:* Zero ordens acima de R$ 2.500 sem sinal no momento.\n`;
  }
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 3. RAIO-X DAS LOJAS DA REDE (Com TK Médio)
  msg += `🏪 *3. RAIO-X DAS LOJAS DA REDE*\n\n`;
  msg += `_(Dados extraídos estritamente do Mapa de Metas)_\n\n`;

  dados.raioXLojas.forEach((l, idx) => {
    msg += `${idx + 1}. *${l.nome}:* ${fmtMoeda(l.faturamentoMes)} | ${l.volumeOsMes} OSs no mês | *TK Médio:* ${fmtMoeda(l.ticketMedio)}\n`;
  });

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 4. CARROS TRAVADOS NO PÁTIO (>= 5 DIAS)
  msg += `⏳ *4. CARROS TRAVADOS NO PÁTIO (>= 5 DIAS)*\n`;
  msg += `_(Critério: Apenas veículos com OS aberta parados há 5 dias ou mais)_\n\n`;

  if (dados.carrosTravados.length > 0) {
    dados.carrosTravados.slice(0, 10).forEach(ct => {
      msg += `• *${ct.loja}:* OS #${ct.osId} — *${ct.diasNoPatio} dias no pátio*\n`;
    });
    if (dados.carrosTravados.length > 10) {
      msg += `... e mais ${dados.carrosTravados.length - 10} veículos retidos no pátio.\n`;
    }
  } else {
    msg += `• *Fluxo Regular:* Nenhum carro parado há 5 dias ou mais no pátio.\n`;
  }
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 5. PÁTIO DAS LOJAS (Consolidado por Loja: Qtd, Total e Saldo)
  msg += `📋 *5. PÁTIO DAS LOJAS*\n\n`;

  dados.patioPorLoja.forEach(p => {
    msg += `📍 *${p.nome.toUpperCase()}*\n\n`;
    msg += `• *OS's em Aberto:* ${p.qtdAbertas}\n`;
    msg += `• *Valor Total:* ${fmtMoeda(p.valorTotal)}\n`;
    msg += `• *Saldo Restante:* ${fmtMoeda(p.saldoRestante)}\n\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `✅ *Relatório emitido automaticamente pelo Hydra Auditor.*`;

  return msg;
}
