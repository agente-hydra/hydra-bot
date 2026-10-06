import * as fs from 'fs';
import * as path from 'path';
import { Page, chromium } from 'playwright';
import { config as dotenvConfig } from 'dotenv';
import { ensureCompany } from '../workers/oficina-agent/playwright/actions/core.js';
import {
  getDatabaseConnection,
  salvarRelatorioOperacao,
  formatIsoTimestamp,
  type CMVLojaItem,
  type FaturamentoAreaItem,
  type PesquisaMidiaItem
} from './db_repository.js';
import { recordDataWorkerRun } from './data_worker_log.js';

dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();
const BASE = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

export const EMPRESAS_RELATORIO: Record<string, string> = {
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

export interface ExtracaoRelatorioLoja {
  lojaSlug: string;
  dataInicio: string;
  dataFim: string;
  cmv: CMVLojaItem;
  areas: FaturamentoAreaItem[];
  midia: PesquisaMidiaItem[];
  dataHoraCaptura: string;
}

export function parseMoeda(txt: string): number {
  if (!txt) return 0;
  const isNegative = txt.includes('-') || (txt.includes('(') && txt.includes(')'));
  const clean = txt.replace(/[R$\s\u00a0()\-]/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(clean) || 0;
  if (val === 0) return 0;
  return isNegative ? -val : val;
}

export function parsePercent(txt: string): number {
  if (!txt) return 0;
  const isNegative = txt.includes('-');
  const clean = txt.replace(/[%R$\s\u00a0\-]/g, '').replace(',', '.');
  const val = parseFloat(clean) || 0;
  if (val === 0) return 0;
  return isNegative ? -val : val;
}

export function parseIntBR(txt: string): number {
  if (!txt) return 0;
  return parseInt(txt.replace(/\D/g, ''), 10) || 0;
}

/**
 * Converte as matrizes brutas de strings extraidas das tabelas HTML em objetos tipados.
 */
export function parseTabelasRelatorio(
  raw: { rowsArea: string[][]; rowsMidia: string[][] },
  lojaSlug: string
): ExtracaoRelatorioLoja {
  const agora = new Date();
  const spDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
  const [ano, mes] = spDateStr.split('-');
  const dataInicio = `${ano}-${mes}-01`;
  const ultimoDia = new Date(parseInt(ano, 10), parseInt(mes, 10), 0).getDate();
  const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

  // 1. Faturamento por Area e Linha Totalizadora de CMV
  const areaRows = raw.rowsArea.slice(1);
  const areas: FaturamentoAreaItem[] = [];
  let cmv: CMVLojaItem | null = null;

  for (let i = 0; i < areaRows.length; i++) {
    const row = areaRows[i];
    if (row.length < 7) continue;

    const isTotalRow = i === areaRows.length - 1 || row[0] === '' || row[0].toLowerCase().includes('total');
    const nomeArea = row[0];
    const fat = parseMoeda(row[1]);
    const fatPct = parsePercent(row[2]);
    const desc = parseMoeda(row[3]);
    const custo = parseMoeda(row[5]);
    const cmvPct = parsePercent(row[6]);
    const lucroBruto = parseMoeda(row[7]);
    const lucroBrutoPct = parsePercent(row[8]);

    if (isTotalRow) {
      cmv = {
        loja_slug: lojaSlug,
        data_inicio: dataInicio,
        data_fim: dataFim,
        faturamento_total: fat,
        desconto_total: desc,
        custo_total: custo,
        cmv_percentual: cmvPct,
        lucro_bruto: lucroBruto,
        lucro_bruto_percentual: lucroBrutoPct
      };
    } else if (nomeArea) {
      areas.push({
        loja_slug: lojaSlug,
        data_inicio: dataInicio,
        data_fim: dataFim,
        area: nomeArea,
        faturamento: fat,
        faturamento_percentual: fatPct,
        desconto: desc,
        custo: custo,
        cmv_percentual: cmvPct,
        lucro_bruto: lucroBruto,
        lucro_bruto_percentual: lucroBrutoPct
      });
    }
  }

  // 2. Pesquisa de Midia
  const midiaRows = (raw.rowsMidia || []).slice(1);
  const midia: PesquisaMidiaItem[] = [];

  for (let i = 0; i < midiaRows.length; i++) {
    const row = midiaRows[i];
    if (row.length < 4) continue;
    const canal = row[0];
    const isTotal = i === midiaRows.length - 1 || canal === '' || canal.toLowerCase().includes('total');
    if (isTotal || !canal) continue;

    const fat = parseMoeda(row[1]);
    const fatPct = parsePercent(row[2]);
    const qtdOs = parseIntBR(row[3]);
    const tkMedio = row[4] ? parseMoeda(row[4]) : (qtdOs > 0 ? fat / qtdOs : 0);

    midia.push({
      loja_slug: lojaSlug,
      data_inicio: dataInicio,
      data_fim: dataFim,
      canal,
      faturamento: fat,
      faturamento_percentual: fatPct,
      qtd_os: qtdOs,
      ticket_medio: tkMedio
    });
  }

  return {
    lojaSlug,
    dataInicio,
    dataFim,
    cmv: cmv as CMVLojaItem,
    areas,
    midia,
    dataHoraCaptura: formatIsoTimestamp(agora)
  };
}

/**
 * Validacao estrita de integridade matematica e de dados antes da persistencia.
 */
export function validarIntegridadeRelatorioOperacao(
  extracao: ExtracaoRelatorioLoja | null,
  snapshotAnteriorExiste = false
): void {
  if (!extracao) {
    throw new Error('Falha na extracao: objeto de extracao nulo ou indefinido');
  }

  if (!extracao.areas || extracao.areas.length === 0) {
    throw new Error(`Falha na extracao: nenhuma area de faturamento localizada para ${extracao.lojaSlug}`);
  }

  if (!extracao.cmv) {
    throw new Error(`Falha na extracao: linha totalizadora de CMV nao localizada para ${extracao.lojaSlug}`);
  }

  if (!Number.isFinite(extracao.cmv.faturamento_total) || extracao.cmv.faturamento_total <= 0) {
    if (snapshotAnteriorExiste) {
      throw new Error(
        `faturamento_total nao positivo (${extracao.cmv.faturamento_total}) para ${extracao.lojaSlug}: preservando snapshot anterior valido contra corrupcao.`
      );
    }
    throw new Error(`faturamento_total invalido (${extracao.cmv.faturamento_total}) para ${extracao.lojaSlug}: deve ser numero finito e positivo`);
  }

  if (!Number.isFinite(extracao.cmv.cmv_percentual) || extracao.cmv.cmv_percentual <= 0) {
    throw new Error(`cmv_percentual invalido (${extracao.cmv.cmv_percentual}) para ${extracao.lojaSlug}: deve ser numero finito e positivo`);
  }

  const totalAreas = extracao.areas.reduce((sum, a) => sum + a.faturamento, 0);
  const diff = Math.abs(totalAreas - extracao.cmv.faturamento_total);
  if (diff > 1.00) {
    throw new Error(
      `Inconsistencia matematica em ${extracao.lojaSlug}: somatorio das areas (R$ ${totalAreas.toFixed(2)}) difere do totalizador oficial (R$ ${extracao.cmv.faturamento_total.toFixed(2)}) em R$ ${diff.toFixed(2)} (tolerancia max R$ 1,00)`
    );
  }
}

/**
 * Extrai as tabelas de Gestao Periodica (CMV por Area e Pesquisa de Midia) da pagina ativa.
 */
export async function extrairTabelasRelatorioOperacao(
  page: Page,
  lojaSlug: string
): Promise<ExtracaoRelatorioLoja | null> {
  const tableData = (await page.evaluate(`(() => {
    const getTableRows = (id) => {
      const t = document.getElementById(id);
      if (!t) return null;
      return Array.from(t.querySelectorAll('tr')).map(r => 
        Array.from(r.querySelectorAll('th, td')).map(c => (c.textContent || '').trim())
      );
    };

    const rowsArea = getTableRows('ctl00_cph_grdFaturamentoPorArea');
    const rowsMidia = getTableRows('ctl00_cph_grdPesquisaDeMidia');

    return { rowsArea, rowsMidia };
  })()`)) as { rowsArea: string[][] | null; rowsMidia: string[][] | null } | null;

  if (!tableData || tableData.rowsArea === null) {
    throw new Error(`Falha na extracao: grid #ctl00_cph_grdFaturamentoPorArea nao localizada no DOM para ${lojaSlug}`);
  }

  if (!tableData.rowsArea || tableData.rowsArea.length < 2) {
    throw new Error(`Falha na extracao: grid #ctl00_cph_grdFaturamentoPorArea vazia ou sem linhas de dados para ${lojaSlug}`);
  }

  return parseTabelasRelatorio({
    rowsArea: tableData.rowsArea,
    rowsMidia: tableData.rowsMidia || []
  }, lojaSlug);
}

/** Coleta e persiste uma loja usando a sessao ja autenticada do crawler de OS. */
export async function coletarRelatorioOperacaoLoja(
  page: Page,
  slug: string,
  db: ReturnType<typeof getDatabaseConnection>,
  outDir: string = '/home/operacional/hydra-data/crawls'
): Promise<ExtracaoRelatorioLoja> {
  if (!EMPRESAS_RELATORIO[slug]) {
    throw new Error(`Loja ${slug} nao pertence ao catalogo das 10 lojas operacionais elegiveis.`);
  }

  const inicio = new Date();
  const arquivoJson = path.join(outDir, `relatorio_operacao_${slug}.json`);
  const snapshotAnteriorExiste = fs.existsSync(arquivoJson);

  try {
    // 1. Garantir selecao e confirmacao da empresa
    await page.goto(`${BASE}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 30000 });
    await ensureCompany(page, slug);

    // 2. Navegar para Relatorio de Operacao
    await page.goto(`${BASE}/wfRelatorioOperacao.aspx`, { waitUntil: 'load', timeout: 30000 });

    // 3. Clicar em Gestao Periodica e aguardar carregamento da grid
    const btnGestao = page.locator('#ctl00_cph_btnGestaoPeriodica');
    await btnGestao.waitFor({ state: 'visible', timeout: 15000 });
    await btnGestao.click();

    await page.locator('#ctl00_cph_grdFaturamentoPorArea tr').nth(1).waitFor({ state: 'visible', timeout: 20000 });

    // 4. Extrair tabelas
    const extracao = await extrairTabelasRelatorioOperacao(page, slug);

    // 5. Validacao de integridade
    validarIntegridadeRelatorioOperacao(extracao, snapshotAnteriorExiste);

    if (!extracao) {
      throw new Error(`Extracao retornou vazio para ${slug}`);
    }

    // 6. Persistir no SQLite
    salvarRelatorioOperacao(db, {
      lojaSlug: slug,
      dataInicio: extracao.dataInicio,
      dataFim: extracao.dataFim,
      cmv: extracao.cmv,
      areas: extracao.areas,
      midia: extracao.midia
    });

    // 7. Gravacao atomica do snapshot JSON em disco
    fs.mkdirSync(outDir, { recursive: true });
    const arquivoTemp = `${arquivoJson}.${process.pid}.tmp`;
    fs.writeFileSync(arquivoTemp, JSON.stringify(extracao, null, 2), 'utf-8');
    fs.renameSync(arquivoTemp, arquivoJson);

    // 8. Log de execucao
    recordDataWorkerRun(db, {
      kind: 'OPERACAO',
      lojaSlug: slug,
      dataReferencia: extracao.dataHoraCaptura.slice(0, 10),
      startedAt: inicio.toISOString(),
      itemCount: extracao.areas.length + extracao.midia.length + 1,
      status: 'SUCCESS'
    });

    console.log(
      `[Relatorio Crawler] ? ${slug}: CMV ${extracao.cmv.cmv_percentual.toFixed(2)}% | Fat R$ ${extracao.cmv.faturamento_total.toFixed(2)} | ${extracao.areas.length} areas | ${extracao.midia.length} canais`
    );
    return extracao;
  } catch (err: any) {
    const errorMsg = String(err?.message || err);
    console.error(`[Relatorio Crawler] ? Erro ao coletar relatorio de ${slug}: ${errorMsg}`);

    try {
      recordDataWorkerRun(db, {
        kind: 'OPERACAO',
        lojaSlug: slug,
        dataReferencia: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
        startedAt: inicio.toISOString(),
        status: 'ERROR',
        error: errorMsg
      });
    } catch (logErr) {
      console.warn(`[Relatorio Crawler] Nao foi possivel registrar erro no worker log:`, logErr);
    }

    throw err;
  }
}

/**
 * Executa o crawler do Relatorio de Operacao para as 10 lojas elegiveis da rede.
 */
export async function executarCrawlerRelatorioOperacao(
  outDir: string = '/home/operacional/hydra-data/crawls',
  targetSlugs?: string[]
): Promise<Record<string, ExtracaoRelatorioLoja>> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const resultados: Record<string, ExtracaoRelatorioLoja> = {};

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript('window.__name = function(t, v) { return t; };');
    const page = await context.newPage();

    console.log('[Relatorio Crawler] Efetuando login...');
    await page.goto(`${BASE}/login`, { waitUntil: 'load' });

    const emailInput = page.locator('input[type=email], input[type=text], input[name=login]').first();
    const passInput = page.locator('input[type=password]').first();
    await emailInput.fill(process.env.OI_USER || '');
    await passInput.fill(process.env.OI_PASS || '');

    const btnSubmit = page.locator('button:has-text(Entrar), button:has-text(Login)').first();
    if (await btnSubmit.isVisible().catch(() => false)) {
      await btnSubmit.click();
    } else {
      await passInput.press('Enter');
    }
    await page.waitForTimeout(4000);

    const candidateSlugs = targetSlugs && targetSlugs.length > 0 ? targetSlugs : Object.keys(EMPRESAS_RELATORIO);
    const slugs = candidateSlugs.filter(slug => Boolean(EMPRESAS_RELATORIO[slug]));
    const db = getDatabaseConnection();

    for (const slug of slugs) {
      const nomeAmigavel = EMPRESAS_RELATORIO[slug] || slug;
      console.log(`\n[Relatorio Crawler] ====== Processando ${nomeAmigavel} (${slug}) ======`);

      try {
        resultados[slug] = await coletarRelatorioOperacaoLoja(page, slug, db, outDir);
      } catch (err: any) {
        console.error(`[Relatorio Crawler] ? Erro ao extrair relatorio de ${slug}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return resultados;
}

