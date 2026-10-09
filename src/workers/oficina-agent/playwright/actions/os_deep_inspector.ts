import { Page } from 'playwright';
import { ensureCompany } from './core.js';
import {
  carregarStoreLoja,
  salvarStoreLoja,
  upsertCirurgicoOS,
  deveReextrairOS,
  expurgarOSsAntigas,
} from '../../../../hydra-sync/delta_storage.js';

// ─── Tipos Granulares ─────────────────────────────────────────────────────────

export interface ItemOS {
  codigo: string;
  referencia: string;
  descricao: string;
  qtd: number;
  valor_unitario: number;
  valor_total: number;
  executor: string;
}

export interface PagamentoOS {
  parcela: string;
  vencimento: string;
  forma: string;
  valor: number;
  num_operacao?: string;
  enviado_financeiro?: string;
}

export interface AnexoOS {
  origem: string;
  data: string;
  descricao: string;
  opcao?: string;
}

export interface CheckListOS {
  codigo: string;
  data: string;
  tipo: string;
  realizado_por: string;
  status: string;
  hodometro: string;
  progresso: string;
  termino: string;
}

export interface AgendamentoOS {
  data_hora: string;
  lembrete: string;
  funcionario: string;
}

export interface AlertaPreventivaOS {
  data_alerta: string;
  tipo_alerta: string;
}

export interface GarantiaOS {
  operacao: string;
  hodometro: string;
  entrada_estoque: string;
  descricao?: string;
}

export interface DocumentoAberto {
  id: string;
  tipo: 'OS' | 'OR';
  data_inicio: string;
  data_fim: string | null;
  veiculo: string;
  placa: string;
  cliente_nome: string;
  cliente_cpf?: string;
  cliente_telefone?: string;
  cliente_telefones?: string[];
  cliente_telefone_sms?: string;
  previsao: string;
  responsavel: string;
  pesquisa: string;
  status_grid: string;
  is_aberta?: number;
  is_bloqueada_fechada?: boolean;
  dias_no_patio?: number;

  empresa?: string;
  hodometro?: string;
  ano?: string;
  observacao?: string;
  observacao_cliente?: string;
  credito?: string;
  faturamento_data?: string;

  // Aba 1: Produtos e Serviços
  itens?: ItemOS[];
  total_os?: number;
  desconto_pct?: string;
  total_produtos_pct?: string;
  total_servicos_pct?: string;

  // Aba 2: Buscar Produtos e Serviços
  busca_produtos_servicos?: any[];

  // Aba 3: Pagamentos
  pagamentos?: PagamentoOS[];
  valor_pago?: number;
  valor_restante?: number;

  // Aba Documentos e Notas
  documentos_anexos?: AnexoOS[];
  notas_fiscais?: string[];

  // Aba Agendamentos
  agendamentos?: AgendamentoOS[];
  alertas_preventiva?: AlertaPreventivaOS[];

  // Aba Check-List
  checklists?: CheckListOS[];

  // Aba Garantias
  garantias?: GarantiaOS[];

  // Aba Histórico
  historico_criado_em?: string;
  historico_criado_por?: string;
  historico_atualizado_em?: string;
  historico_atualizado_por?: string;

  extracao_completa: boolean;
  erro?: string;
}

export interface ResultadoInspecaoOS {
  documentos: DocumentoAberto[];
  paginacaoCompleta: boolean;
  totalPaginas: number;
  totalAbertasNativo: number;
}

export interface RawOrder {
  id: string;
  tipo: 'OS' | 'OR';
  dataInicio: string;
  horaInicio: string;
  veiculo: string;
  placa: string;
  cliente: string;
  status: string;
  responsavel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMoeda(txt: string): number {
  if (!txt) return 0;
  return parseFloat(txt.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

export function getRolling30DayRange(): { dIni: string; dFim: string } {
  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const pad = (n: number) => String(n).padStart(2, '0');
  const dIni = `${pad(past30.getDate())}/${pad(past30.getMonth() + 1)}/${past30.getFullYear()}`;
  const dFim = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  return { dIni, dFim };
}

// ─── Extração Instantânea do Detalhe da OS no DOM (9 Abas) ────────────────────

export const SELETORES_ABAS_OS = [
  { nome: 'Produtos e Serviços',        selector: 'a:has-text("Produtos e Serviços"), span:has-text("Produtos e Serviços"), [id*="tapItem"]' },
  { nome: 'Buscar Produtos e Serviços', selector: 'a:has-text("Buscar Produtos"), span:has-text("Buscar Produtos"), [id*="tapBuscar"]' },
  { nome: 'Pagamentos',                 selector: 'a:has-text("Pagamentos"), span:has-text("Pagamentos"), [id*="tapPagamento"]' },
  { nome: 'Documentos',                 selector: 'a:has-text("Documentos"), span:has-text("Documentos"), [id*="tapDocumento"]' },
  { nome: 'Notas',                      selector: 'a:has-text("Notas"), span:has-text("Notas"), [id*="tapFiscal"]' },
  { nome: 'Agendamento(s)',             selector: 'a:has-text("Agendamento"), span:has-text("Agendamento"), [id*="tapAgenda"]' },
  { nome: 'Check-List',                 selector: 'a:has-text("Check-List"), span:has-text("Check-List"), [id*="tapCheckList"]' },
  { nome: 'Garantia(s)',                selector: 'a:has-text("Garantia"), span:has-text("Garantia"), [id*="tapGarantia"]' },
  { nome: 'Histórico',                  selector: 'a:has-text("Histórico"), span:has-text("Histórico"), [id*="tapHistorico"]' },
];

export async function ativarTodasAsAbas(detailPage: Page): Promise<void> {
  for (const aba of SELETORES_ABAS_OS) {
    try {
      const loc = detailPage.locator(aba.selector).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        await loc.click().catch(() => {});
        await detailPage.waitForTimeout(300);
      }
    } catch {}
  }
}

export async function extrairDetalheDaPagina(detailPage: Page): Promise<Partial<DocumentoAberto>> {
  await detailPage.evaluate('window.__name = function(t) { return t; };');

  // Ativação sequencial das 9 abas para forçar disparo dos UpdatePanels AJAX do ASP.NET WebForms
  await ativarTodasAsAbas(detailPage);

  const detalhe = await detailPage.evaluate(() => {
    const parseMoedaDOM = (txt: string) => {
      if (!txt) return 0;
      return parseFloat(txt.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    };

    const getVal = (selector: string): string => {
      const el = document.querySelector(selector) as any;
      if (!el) return '';
      if ('value' in el) return el.value.trim();
      return (el.textContent || '').trim();
    };

    const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    const is_bloqueada_fechada = /fechada\s+e\s+bloqueada/i.test(bodyText);

    // ─── 0. Cabeçalho Geral da OS ─────────────────────────
    const empresa = (document.querySelector('#ctl00_cph_ddlEmpresa option:checked')?.textContent || '').trim();
    const hodometro = getVal('#ctl00_cph_txtHodometro');
    const ano = getVal('#ctl00_cph_txtAno');
    const cpf = getVal('input[id*="txtCPF"]');
    const observacao = getVal('#ctl00_cph_txtObservacao');
    const observacao_cliente = getVal('#ctl00_cph_txtObservacaoCliente, textarea[id*="ObservacaoCliente"]');
    const credito = getVal('input[id*="Credito"], #ctl00_cph_txtCredito');
    const faturamento_data = getVal('#ctl00_cph_txtDataFaturamento');
    const veiculo = getVal('#ctl00_cph_txtVeiculo, span[id*="lblVeiculo"]');
    const placa = getVal('#ctl00_cph_txtPlaca, span[id*="lblPlaca"]');
    const cliente_nome = getVal('#ctl00_cph_txtCliente, span[id*="lblCliente"]');
    const responsavel = getVal('#ctl00_cph_txtResponsavel, span[id*="lblResponsavel"]');
    const telefone_sms = getVal('#txtTelefoneSMS, input[id*="TelefoneSMS"]');

    // Telefones do cliente extraídos no cabeçalho
    const cliente_telefones: string[] = [];
    const telMatches = bodyText.match(/\(\d{2}\)\s*\d{4,5}-?\d{4}/g);
    if (telMatches) {
      for (const t of telMatches) {
        if (!cliente_telefones.includes(t)) cliente_telefones.push(t);
      }
    }

    // Datas de Início e Fim
    let data_inicio = getVal('input[id*="txtDataInicio"], input[id*="txtDtInicio"], span[id*="lblDataInicio"]');
    if (!data_inicio) {
      const iniMatch = bodyText.match(/\bIn[íi]cio\s+([0-3]?\d\/[0-1]?\d\/\d{4}(?:\s+[0-2]?\d:[0-5]\d)?)/i);
      if (iniMatch) data_inicio = iniMatch[1].trim();
    }

    let data_fim: string | null = getVal('input[id*="txtDataFim"], input[id*="txtDtFim"], span[id*="lblDataFim"]');
    if (!data_fim) {
      const fimMatch = bodyText.match(/\bFim\s+([0-3]?\d\/[0-1]?\d\/\d{4}(?:\s+[0-2]?\d:[0-5]\d)?)/i);
      if (fimMatch) data_fim = fimMatch[1].trim();
    }
    if (!data_fim) data_fim = null;

    // Status da OS
    const statusSelect = document.querySelector('select[id*="ddlStatus"] option:checked') as any;
    const statusSelectTxt = (statusSelect?.textContent || '').trim();
    let status_grid = '';
    if (statusSelectTxt && !statusSelectTxt.toLowerCase().includes('selecione')) {
      status_grid = statusSelectTxt;
    } else if (is_bloqueada_fechada || Boolean(data_fim)) {
      status_grid = 'FECHADO';
    } else {
      status_grid = 'ABERTO';
    }

    // ─── Aba 1: Produtos e Serviços ───────────────────────
    const itens: any[] = [];
    const itemRows = document.querySelectorAll('table[id*="ucOrdemDeServicoItem_grd"] tr');
    for (let i = 1; i < itemRows.length; i++) {
      const tds = itemRows[i].querySelectorAll('td');
      if (tds.length >= 6) {
        itens.push({
          codigo: (tds[0].textContent || '').trim(),
          referencia: (tds[1].textContent || '').trim(),
          descricao: (tds[2].textContent || '').trim(),
          qtd: parseFloat((tds[3].textContent || '0').trim()) || 0,
          valor_unitario: parseMoedaDOM(tds[4].textContent || '0'),
          valor_total: parseMoedaDOM(tds[5].textContent || '0'),
          executor: tds.length > 6 ? (tds[6].textContent || '').trim() : '',
        });
      }
    }
    const totalValInput = getVal('#tab_tapItem_ucOrdemDeServicoItem_txtTotalValor');
    const descInput     = getVal('#tab_tapItem_ucOrdemDeServicoItem_txtDescontoAtual');
    const prodPctInput  = getVal('#tab_tapItem_ucOrdemDeServicoItem_txtTotalProduto');
    const servPctInput  = getVal('#tab_tapItem_ucOrdemDeServicoItem_txtTotalServico');
    const total_os = parseMoedaDOM(totalValInput) || itens.reduce((acc, it) => acc + it.valor_total, 0);

    // ─── Aba 2: Buscar Produtos e Serviços ─────────────────
    const busca_produtos_servicos: any[] = [];
    const buscaRows = document.querySelectorAll('table[id*="ucOrdemDeServicoBuscaItem_grd"], table[id*="tapBuscar_grd"] tr');
    for (let i = 1; i < buscaRows.length; i++) {
      const tds = buscaRows[i].querySelectorAll('td');
      if (tds.length >= 2) {
        busca_produtos_servicos.push({
          descricao: (tds[0].textContent || '').trim(),
          detalhe: (tds[1].textContent || '').trim(),
        });
      }
    }

    // ─── Aba 3: Pagamentos ────────────────────────────────
    const pagamentos: any[] = [];
    const pagRows = document.querySelectorAll('table[id*="ucOrdemDeServicoPagamento_grd"] tr');
    let somaParcelas = 0;
    for (let i = 1; i < pagRows.length; i++) {
      const tds = pagRows[i].querySelectorAll('td');
      if (tds.length >= 4) {
        const valParcela = parseMoedaDOM(tds[3].textContent || '0');
        somaParcelas += valParcela;
        pagamentos.push({
          parcela: (tds[0].textContent || '').trim(),
          vencimento: (tds[1].textContent || '').trim(),
          forma: (tds[2].textContent || '').trim(),
          valor: valParcela,
          num_operacao: tds.length > 4 ? (tds[4].textContent || '').trim() : '',
          enviado_financeiro: tds.length > 6 ? (tds[6].textContent || '').trim() : '',
        });
      }
    }
    const txtTotalPago = getVal('#tab_tapPagamento_ucOrdemDeServicoPagamento_txtTotalValor, input[id*="Pagamento_txtTotalValor"]');
    const txtRestante  = getVal('#tab_tapPagamento_ucOrdemDeServicoPagamento_txtRestante, input[id*="Pagamento_txtRestante"]');
    const valor_pago_input = parseMoedaDOM(txtTotalPago);
    const valor_restante_input = parseMoedaDOM(txtRestante);

    const valor_pago = valor_pago_input > 0 ? valor_pago_input : somaParcelas;
    let valor_restante = 0;
    if (txtRestante !== '') {
      valor_restante = valor_restante_input;
    } else {
      valor_restante = Math.max(0, total_os - valor_pago);
    }

    const is_aberta = (is_bloqueada_fechada || Boolean(data_fim) || (valor_restante === 0 && valor_pago >= total_os && total_os > 0)) ? 0 : 1;

    // ─── Aba 4: Documentos ────────────────────────────────
    const documentos_anexos: any[] = [];
    const docRows = document.querySelectorAll('table[id*="ucOrdemDeServicoDocumento_grd"] tr');
    for (let i = 1; i < docRows.length; i++) {
      const tds = docRows[i].querySelectorAll('td');
      if (tds.length >= 3) {
        documentos_anexos.push({
          origem: (tds[0].textContent || '').trim(),
          data: (tds[1].textContent || '').trim(),
          descricao: (tds[2].textContent || '').trim(),
          opcao: tds.length > 3 ? (tds[3].textContent || '').trim() : '',
        });
      }
    }

    // ─── Aba 5: Notas Fiscais ─────────────────────────────
    const notas_fiscais: string[] = [];
    const nfRows = document.querySelectorAll('table[id*="ucOrdemDeServicoFiscal_grd"] tr');
    for (let i = 0; i < nfRows.length; i++) {
      const txt = (nfRows[i].textContent || '').trim();
      if (txt && !txt.includes('Nenhuma Nota')) {
        notas_fiscais.push(txt);
      }
    }

    // ─── Aba 6: Agendamentos & Alertas ────────────────────
    const alertas_preventiva: any[] = [];
    const alertaRows = document.querySelectorAll('table[id*="ucPlacaDoVeiculoAlerta_grd"] tr');
    for (let i = 1; i < alertaRows.length; i++) {
      const tds = alertaRows[i].querySelectorAll('td');
      if (tds.length >= 2) {
        const txt = (tds[0].textContent || '').trim();
        if (!txt.includes('Sem Manutenções')) {
          alertas_preventiva.push({
            data_alerta: (tds[0].textContent || '').trim(),
            tipo_alerta: (tds[1].textContent || '').trim(),
          });
        }
      }
    }

    const agendamentos: any[] = [];
    const agendaRows = document.querySelectorAll('table[id*="ucPlacaDoVeiculoAgenda_grd"] tr');
    for (let i = 1; i < agendaRows.length; i++) {
      const tds = agendaRows[i].querySelectorAll('td');
      if (tds.length >= 3) {
        agendamentos.push({
          data_hora: (tds[0].textContent || '').trim(),
          lembrete: (tds[1].textContent || '').trim(),
          funcionario: (tds[2].textContent || '').trim(),
        });
      }
    }

    // ─── Aba 7: Check-list ────────────────────────────────
    const checklists: any[] = [];
    const clRows = document.querySelectorAll('table[id*="ucOrdemDeServicoCheckList_grdCheckList"] tr');
    for (let i = 1; i < clRows.length; i++) {
      const tds = clRows[i].querySelectorAll('td');
      if (tds.length >= 7) {
        checklists.push({
          codigo: (tds[0].textContent || '').trim(),
          data: (tds[1].textContent || '').trim(),
          tipo: (tds[2].textContent || '').trim(),
          realizado_por: (tds[3].textContent || '').trim(),
          status: (tds[4].textContent || '').trim(),
          hodometro: (tds[5].textContent || '').trim(),
          progresso: (tds[6].textContent || '').trim(),
          termino: tds.length > 7 ? (tds[7].textContent || '').trim() : '',
        });
      }
    }

    // ─── Aba 8: Garantias ─────────────────────────────────
    const garantias: any[] = [];
    const garRows = document.querySelectorAll('table[id*="ucOrdemDeServicoOperacaoEstoque_grdOperacaoEstoque"] tr');
    for (let i = 1; i < garRows.length; i++) {
      const tds = garRows[i].querySelectorAll('td');
      if (tds.length >= 3) {
        const txt = (tds[0].textContent || '').trim();
        if (!txt.includes('Nenhum processo')) {
          garantias.push({
            operacao: (tds[0].textContent || '').trim(),
            hodometro: (tds[1].textContent || '').trim(),
            entrada_estoque: (tds[2].textContent || '').trim(),
          });
        }
      }
    }

    // ─── Aba 9: Histórico ─────────────────────────────────
    const historico_criado_em = getVal('#tab_tapHistorico_txtDataDeCadastro');
    const historico_criado_por = getVal('#tab_tapHistorico_txtUsuarioCadastroNome');
    const historico_atualizado_em = getVal('#tab_tapHistorico_txtDataDeAtualizacao');
    const historico_atualizado_por = getVal('#tab_tapHistorico_txtUsuarioAtualizacaoNome');

    return {
      empresa,
      hodometro,
      ano,
      cliente_nome,
      cliente_cpf: cpf,
      cliente_telefone: cliente_telefones[0] || '',
      cliente_telefones,
      cliente_telefone_sms: telefone_sms,
      veiculo,
      placa,
      responsavel,
      observacao,
      observacao_cliente,
      credito,
      faturamento_data,
      data_inicio,
      data_fim,
      status_grid,
      is_aberta,
      is_bloqueada_fechada,
      itens,
      busca_produtos_servicos,
      total_os,
      desconto_pct: descInput,
      total_produtos_pct: prodPctInput,
      total_servicos_pct: servPctInput,
      pagamentos,
      valor_pago,
      valor_restante,
      documentos_anexos,
      notas_fiscais,
      agendamentos,
      alertas_preventiva,
      checklists,
      garantias,
      historico_criado_em,
      historico_criado_por,
      historico_atualizado_em,
      historico_atualizado_por,
      extracao_completa: true,
    };
  });

  return detalhe;
}

// ─── Extração do Detalhe da OS (Abre Popup e Extrai) ──────────────────────────

export async function extrairDetalhe(page: Page, osId: string, baseUrl: string): Promise<Partial<DocumentoAberto>> {
  try {
    const context = page.context();
    page.setDefaultTimeout(15000);

    await page.goto(`${baseUrl}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(300);

    // Buscar diretamente pelo ID da OS
    await page.locator('#ctl00_cph_btnLimpar').click().catch(() => {});
    await page.waitForTimeout(300);
    await page.locator('#ctl00_cph_txtOrdemDeServicoID').fill(osId).catch(() => {});
    await page.locator('#ctl00_cph_chkExibirFechada').check().catch(() => {});
    await page.locator('#ctl00_cph_chkExibirAberta').check().catch(() => {});

    await page.locator('#ctl00_cph_btnBuscar').click();
    await page.waitForLoadState('load');
    await page.waitForTimeout(600);

    // Abrir o popup da OS
    const link = page.locator(`a[id*="lkbOrdemDeServicoID"]:has-text("${osId}")`).first();
    if (await link.count() === 0) {
      console.log(`[Deep Inspector]     x Link OS #${osId} não encontrado na grade`);
      return { extracao_completa: false, erro: 'link_nao_encontrado' };
    }

    const [detailPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 12000 }).catch(() => null),
      link.click().catch(() => null)
    ]);

    if (!detailPage) {
      console.log(`[Deep Inspector]     x Popup da OS #${osId} não abriu`);
      return { extracao_completa: false, erro: 'popup_timeout' };
    }

    try {
      await detailPage.waitForLoadState('load', { timeout: 15000 });
      return await extrairDetalheDaPagina(detailPage);
    } finally {
      await detailPage.close().catch(() => {});
    }
  } catch (err: any) {
    return { extracao_completa: false, erro: err.message };
  }
}

// ─── Extração com Suporte a Paginação da Grade (ASP.NET GridView) ───────────────

export async function extrairGridComPaginacao(
  page: Page,
  loja: string
): Promise<{
  rawOrders: RawOrder[];
  totalPaginas: number;
  paginacaoCompleta: boolean;
  erro?: string;
}> {
  const rawOrders: RawOrder[] = [];
  let totalPaginas = 1;

  const lerLinhasPaginaAtual = async () => {
    const linhas = await page.locator('table[id*="grd"] tr:not(:first-child):not(.pgr)').all();
    for (const linha of linhas) {
      const id = (await linha.locator('[id*="lkbOrdemDeServicoID"]').textContent().catch(() => ''))?.trim();
      if (!id) continue;

      const cells = await linha.locator('td').all();
      if (cells.length < 5) continue;

      const allText = await Promise.all(cells.map(c => c.textContent().catch(() => '')));
      const dataCompleta = (allText[1] || '').trim();
      const dataInicio = dataCompleta.split(' ')[0];
      const horaInicio = (allText[2] || '').trim();
      const veiculo = await linha.locator('[id*="lkbNomeDoVeiculo"]').textContent().catch(() => (allText[4] || '').trim());
      const placa = await linha.locator('[id*="lkbPlacaDoVeiculo"]').textContent().catch(() => (allText[5] || '').trim());
      const cliente = await linha.locator('[id*="lkbClienteNome"]').textContent().catch(() => (allText[6] || '').trim());
      const responsavel = (allText[8] || '').trim();
      const statusEl = await linha.locator('[id*="lblSigla"]').getAttribute('title').catch(() => '');
      const status_grid = (statusEl || allText[10] || '').trim();

      rawOrders.push({
        id,
        tipo: id.startsWith('OR') ? 'OR' : 'OS',
        dataInicio,
        horaInicio,
        veiculo: (veiculo as string).trim(),
        placa: (placa as string).trim(),
        cliente: (cliente as string).trim(),
        status: status_grid,
        responsavel
      });
    }
  };

  try {
    await lerLinhasPaginaAtual();

    const pagerRow = page.locator('table[id*="grd"] tr.pgr');
    if (await pagerRow.count() > 0 && await pagerRow.first().isVisible().catch(() => false)) {
      const pageNumbers = await pagerRow.evaluate((el: HTMLElement) => {
        const cells = el.querySelectorAll('td');
        const numbers: number[] = [];
        cells.forEach(c => {
          const t = (c.textContent || '').trim();
          const n = parseInt(t, 10);
          if (!isNaN(n) && n > 0 && String(n) === t) {
            numbers.push(n);
          }
        });
        return numbers;
      });

      if (pageNumbers.length > 0) {
        totalPaginas = Math.max(...pageNumbers);
      }

      console.log(`[Deep Inspector] 📄 Paginação detectada para ${loja}: página 1 de ${totalPaginas}`);

      for (let p = 2; p <= totalPaginas; p++) {
        console.log(`[Deep Inspector]   ↳ Navegando para página ${p} de ${totalPaginas}...`);
        const clicked = await page.evaluate((targetPage: number) => {
          const pagerRow = document.querySelector('table[id*="grd"] tr.pgr');
          if (!pagerRow) return false;
          const links = pagerRow.querySelectorAll('a');
          for (let i = 0; i < links.length; i++) {
            const a = links[i];
            if ((a.textContent || '').trim() === String(targetPage) || a.getAttribute('href')?.includes(`Page$${targetPage}`)) {
              a.click();
              return true;
            }
          }
          return false;
        }, p);

        if (!clicked) {
          console.warn(`[Deep Inspector] ⚠️ Link para página ${p} não encontrado no pager.`);
          return { rawOrders, totalPaginas, paginacaoCompleta: false, erro: `link_pagina_${p}_nao_encontrado` };
        }

        await page.waitForLoadState('load').catch(() => {});
        await page.waitForTimeout(2000);

        const countBefore = rawOrders.length;
        await lerLinhasPaginaAtual();
        const readOnPage = rawOrders.length - countBefore;
        console.log(`[Deep Inspector]   ✅ Página ${p} lida (${readOnPage} ordens adicionadas).`);

        if (readOnPage === 0) {
          console.warn(`[Deep Inspector] ⚠️ Página ${p} não retornou novas ordens.`);
        }
      }
    }

    return {
      rawOrders,
      totalPaginas,
      paginacaoCompleta: true
    };
  } catch (err: any) {
    console.error(`[Deep Inspector] ❌ Erro durante paginação da grade em ${loja}: ${err.message}`);
    return {
      rawOrders,
      totalPaginas,
      paginacaoCompleta: false,
      erro: err.message
    };
  }
}

// ─── Função Principal Exportada ───────────────────────────────────────────────

export async function handleOSDeepInspector(page: Page, params: { loja: string }): Promise<ResultadoInspecaoOS> {
  const { loja } = params;
  const BASE_URL = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

  console.log(`[Deep Inspector] Iniciando extração do mês corrente para ${loja}...`);

  // 1. Garantir empresa correta
  await page.goto(`${BASE_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load' });
  await ensureCompany(page, loja);
  await page.goto(`${BASE_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load' });

  // 1.1 Captura determinística do pátio ativo oficial (#ctl00_cph_lkbOSEmAberto)
  const openOsIdsSet = new Set<string>();
  let totalAbertasNativo = 0;
  let abertasPaginacaoCompleta = true;

  try {
    const lkbAberta = page.locator('#ctl00_cph_lkbOSEmAberto');
    if (await lkbAberta.count() > 0) {
      const txt = (await lkbAberta.first().textContent().catch(() => '0')) || '0';
      totalAbertasNativo = parseInt(txt.trim(), 10) || 0;
      console.log(`[Deep Inspector] 📊 Contador oficial de pátio (#ctl00_cph_lkbOSEmAberto) em ${loja}: ${totalAbertasNativo} veículos`);

      if (totalAbertasNativo > 0) {
        console.log(`[Deep Inspector]   ↳ Filtrando grade nativa de abertas para mapear pátio real em ${loja}...`);
        await lkbAberta.first().click();
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);

        const lerIdsAbertas = async () => {
          const abertasRows = await page.locator('table[id*="grd"] tr:not(:first-child):not(.pgr)').all();
          for (const r of abertasRows) {
            const idEl = r.locator('[id*="lkbOrdemDeServicoID"]').first();
            if (await idEl.count() > 0) {
              const osId = (await idEl.textContent().catch(() => ''))?.trim();
              if (osId) openOsIdsSet.add(osId);
            }
          }
        };

        await lerIdsAbertas();

        // Checar paginação na grade de abertas
        const abertasPager = page.locator('table[id*="grd"] tr.pgr');
        if (await abertasPager.count() > 0 && await abertasPager.first().isVisible().catch(() => false)) {
          const abertasPageNumbers = await abertasPager.evaluate((el: HTMLElement) => {
            const cells = el.querySelectorAll('td');
            const numbers: number[] = [];
            cells.forEach(c => {
              const t = (c.textContent || '').trim();
              const n = parseInt(t, 10);
              if (!isNaN(n) && n > 0 && String(n) === t) numbers.push(n);
            });
            return numbers;
          });

          const maxP = abertasPageNumbers.length > 0 ? Math.max(...abertasPageNumbers) : 1;
          for (let p = 2; p <= maxP; p++) {
            const clicked = await page.evaluate((targetPage: number) => {
              const pagerRow = document.querySelector('table[id*="grd"] tr.pgr');
              if (!pagerRow) return false;
              const links = pagerRow.querySelectorAll('a');
              for (let i = 0; i < links.length; i++) {
                const a = links[i];
                if ((a.textContent || '').trim() === String(targetPage) || a.getAttribute('href')?.includes(`Page$${targetPage}`)) {
                  a.click();
                  return true;
                }
              }
              return false;
            }, p);

            if (clicked) {
              await page.waitForLoadState('load').catch(() => {});
              await page.waitForTimeout(2000);
              await lerIdsAbertas();
            } else {
              abertasPaginacaoCompleta = false;
            }
          }
        }

        console.log(`[Deep Inspector]   ✅ ${openOsIdsSet.size} OSs ativas mapeadas no pátio físico: [${Array.from(openOsIdsSet).join(', ')}]`);
        if (totalAbertasNativo > 0 && openOsIdsSet.size < totalAbertasNativo) {
          console.warn(`[Deep Inspector] ⚠️ Mapeamento de pátio capturou ${openOsIdsSet.size} de ${totalAbertasNativo} esperadas.`);
          abertasPaginacaoCompleta = false;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Deep Inspector]   ⚠️ Aviso ao capturar contador de pátio em ${loja}: ${err.message}`);
  }

  // 2. Limpar filtros para a busca completa da janela de 30 dias
  await page.locator('#ctl00_cph_btnLimpar').click().catch(() => {});
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);

  // 3. FILTRO DA JANELA MÓVEL DE 30 DIAS: Atribuir via evaluate diretamente no DOM para contornar calendar extender
  const { dIni, dFim } = getRolling30DayRange();
  console.log(`[Deep Inspector] Filtrando janela móvel de 30 dias: ${dIni} até ${dFim}`);

  await page.evaluate(({ dIni, dFim }) => {
    const elIni = document.getElementById('ctl00_cph_txtDataInicial') as HTMLInputElement;
    const elFim = document.getElementById('ctl00_cph_txtDataFinal') as HTMLInputElement;
    if (elIni) elIni.value = dIni;
    if (elFim) elFim.value = dFim;
  }, { dIni, dFim });

  // Garantir que ambas (Abertas e Fechadas) estejam marcadas
  const isAberta = await page.locator('#ctl00_cph_chkExibirAberta').isChecked().catch(() => false);
  if (!isAberta) {
    await page.locator('#ctl00_cph_chkExibirAberta').click();
  }
  const isFechada = await page.locator('#ctl00_cph_chkExibirFechada').isChecked().catch(() => false);
  if (!isFechada) {
    await page.locator('#ctl00_cph_chkExibirFechada').click();
  }

  // 4. Buscar
  await page.locator('#ctl00_cph_btnBuscar').click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(2500);

  // 5. Ler todas as OSs do mês na grade para memória desacoplada com paginação
  const gridRes = await extrairGridComPaginacao(page, loja);
  const rawOrders = gridRes.rawOrders;
  const paginacaoCompleta = gridRes.paginacaoCompleta && abertasPaginacaoCompleta;
  const totalPaginas = gridRes.totalPaginas;

  console.log(`[Deep Inspector] ${rawOrders.length} OSs encontradas na janela de 30 dias (${totalPaginas} páginas, completa=${paginacaoCompleta}).`);

  // 6. Carregar Store Delta da loja e expurgar registros > 30 dias
  const store = carregarStoreLoja(loja);
  expurgarOSsAntigas(store, 30);

  let atualizadas = 0;
  let reusadas = 0;

  // 7. Extrair detalhes pontualmente apenas do que for necessário
  for (let idx = 0; idx < rawOrders.length; idx++) {
    const item = rawOrders[idx];
    const precisaExtrair = deveReextrairOS(store, item);

    const isRealmenteAberta = openOsIdsSet.has(item.id) ? 1 : 0;

    const docBase: DocumentoAberto = {
      id: item.id,
      tipo: item.tipo,
      data_inicio: `${item.dataInicio} ${item.horaInicio}`.trim(),
      data_fim: null,
      veiculo: item.veiculo,
      placa: item.placa,
      cliente_nome: item.cliente,
      previsao: '',
      responsavel: item.responsavel,
      pesquisa: '',
      status_grid: item.status,
      extracao_completa: false,
      is_aberta: isRealmenteAberta,
    };

    if (precisaExtrair) {
      console.log(`[Deep Inspector]   -> [${idx + 1}/${rawOrders.length}] OS #${item.id} (${item.veiculo} - ${item.placa}) [EXTRAINDO DETALHES]`);
      const detalhe = await extrairDetalhe(page, item.id, BASE_URL);
      Object.assign(docBase, detalhe);
      docBase.is_aberta = isRealmenteAberta;
      upsertCirurgicoOS(store, docBase);
      atualizadas++;
    } else {
      console.log(`[Deep Inspector]   -> [${idx + 1}/${rawOrders.length}] OS #${item.id} (${item.veiculo}) [REUSADO DO STORE (0ms)]`);
      // Atualiza cirurgicamente dados da grade (status, responsável, is_aberta)
      upsertCirurgicoOS(store, {
        ...store.os_map[item.id],
        status_grid: item.status,
        responsavel: item.responsavel || store.os_map[item.id].responsavel,
        is_aberta: isRealmenteAberta,
      });
      reusadas++;
    }
  }

  // 8. Sincronizar status de pátio em todo o store para expurgar ordens que saíram
  for (const id of Object.keys(store.os_map)) {
    store.os_map[id].is_aberta = openOsIdsSet.has(id) ? 1 : 0;
  }

  // 9. Salvar store atualizado
  salvarStoreLoja(store);
  const documentos = Object.values(store.os_map);
  console.log(`[Deep Inspector] ${loja}: Concluído! Total: ${documentos.length} OSs (${atualizadas} extraídas, ${reusadas} do store, ${openOsIdsSet.size} no pátio ativo, páginas: ${totalPaginas}, completa: ${paginacaoCompleta}).`);
  return {
    documentos,
    paginacaoCompleta,
    totalPaginas,
    totalAbertasNativo,
  };
}
