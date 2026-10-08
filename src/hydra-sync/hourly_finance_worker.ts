import { chromium, type Page } from 'playwright';
import xlsx from 'xlsx';
import { config as dotenvConfig } from 'dotenv';
import type Database from 'better-sqlite3';
import {
  executarCrawlerMetas,
  validarIntegridadeMetas,
  type ResultadoMapaMetas,
  LOJAS_OPERACIONAIS_SLUGS
} from './metas_crawler.ts';
import { getDatabaseConnection } from './db_repository.ts';
import { ensureCompany } from '../workers/oficina-agent/playwright/actions/core.ts';
import { coletarRelatorioOperacaoLoja } from './relatorio_operacao_crawler.ts';

dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();

export const TIMEZONE = 'America/Sao_Paulo';
export const BASE_URL = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

export type DatabaseInstance = Database.Database;

/**
 * Retorna data (YYYY-MM-DD) e hora (HH) estritamente no fuso hor?rio de S?o Paulo (UTC-3).
 * Trata confiavelmente viradas de dia, m?s e ano.
 */
export function getSaoPauloDateParts(date: Date = new Date()): { day: string; hour: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(date);
  const findPart = (t: string) => parts.find(p => p.type === t)?.value || '';
  return {
    day: `${findPart('year')}-${findPart('month')}-${findPart('day')}`,
    hour: findPart('hour')
  };
}

/**
 * Garante que as tabelas financeiras hor?rias e de auditoria existam com o schema exato requerido.
 */
export function ensureSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metas_horarias (
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_mes REAL NOT NULL,
      volume_os INTEGER NOT NULL,
      ticket_medio REAL NOT NULL,
      meta_mes REAL,
      previsao_mes REAL,
      percentual_meta REAL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (data_referencia, posicao_hora, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS faturamento_diario_horario (
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_dia REAL NOT NULL,
      volume_os_dia INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      fonte TEXT NOT NULL DEFAULT 'VENDAS_POR_DIA_OFICIAL',
      PRIMARY KEY (data_referencia, posicao_hora, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS hydra_data_worker_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      data_referencia TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Converte valores brutos de c?lulas de planilhas Excel em n?meros v?lidos.
 * Lida com formata??o monet?ria brasileira (1.234,56), americana (1,234.56), s?mbolos R$, h?fens e vazios.
 */
export function parseExcelNumber(value: unknown): number {
  if (typeof value === 'number') {
    return isNaN(value) || !isFinite(value) ? 0 : value;
  }
  const raw = String(value ?? '').replace(/[R$\s]/g, '').trim();
  if (!raw || raw === '-') return 0;
  
  if (raw.includes(',') && raw.includes('.')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      // 1.234,56
      return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
    } else {
      // 1,234.56
      return Number(raw.replace(/,/g, '')) || 0;
    }
  } else if (raw.includes(',')) {
    return Number(raw.replace(',', '.')) || 0;
  }
  return Number(raw) || 0;
}

/**
 * Realiza o parsing determin?stico do arquivo Excel oficial de "Vendas por Dia".
 * Rejeita qualquer c?lculo por subtra??o de snapshots.
 * Loja com 0 vendas confirmadas no relat?rio retorna { revenue: 0, volume: 0 }.
 * Falhas na exporta??o ou estrutura lan?am Error, impedindo inser??o arbitr?ria de zero.
 */
export function parseVendasDoDiaWorkbook(workbook: xlsx.WorkBook): { revenue: number; volume: number } {
  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Planilha de Vendas por Dia inv?lida ou vazia');
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Aba '${sheetName}' n?o encontrada no arquivo`);
  }

  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (!rows || rows.length === 0) {
    throw new Error('Planilha Vendas por Dia sem linhas de conte?do');
  }

  // Localizar cabe?alho (busca nas primeiras 15 linhas)
  const headerIndex = rows.findIndex((row, idx) => 
    idx < 15 && Array.isArray(row) && row.some(cell => {
      const s = String(cell || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return s.includes('FATURAMENTO') || s.includes('VALOR TOTAL') || s.includes('VALOR LIQUIDO');
    })
  );

  if (headerIndex < 0) {
    throw new Error('Exporta??o Vendas por Dia sem cabe?alho de faturamento identificado');
  }

  const headerRow = rows[headerIndex].map(cell => 
    String(cell || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );

  let revenueCol = headerRow.findIndex(h => h.includes('FATURAMENTO'));
  if (revenueCol < 0) {
    revenueCol = headerRow.findIndex(h => h.includes('VALOR') && (h.includes('TOTAL') || h.includes('LIQ')));
  }
  if (revenueCol < 0) {
    revenueCol = headerRow.findIndex(h => h.includes('VALOR'));
  }

  let volumeCol = headerRow.findIndex(h => (h.includes('QTD') || h.includes('QTDE') || h.includes('QUANT')) && h.includes('OS'));
  if (volumeCol < 0) {
    volumeCol = headerRow.findIndex(h => h.includes('OS') && (h.includes('VOLUME') || h.includes('TOTAL')));
  }
  if (volumeCol < 0) {
    volumeCol = headerRow.findIndex(h => (h.includes('QTD') || h.includes('QTDE')) && !h.includes('PEC') && !h.includes('SER'));
  }

  if (revenueCol < 0 || volumeCol < 0) {
    throw new Error(`Exporta??o Vendas por Dia sem colunas obrigat?rias (revenueCol: ${revenueCol}, volumeCol: ${volumeCol})`);
  }

  // Localizar linha TOTAL (procura de baixo para cima nas linhas ap?s o cabe?alho)
  const candidateRows = rows.slice(headerIndex + 1);
  const totalRow = [...candidateRows].reverse().find(row => 
    Array.isArray(row) && row.some(cell => {
      const s = String(cell || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return s === 'TOTAL' || s.startsWith('TOTAL ') || s.endsWith(' TOTAL') || s === 'TOTAL GERAL';
    })
  );

  if (!totalRow) {
    throw new Error('Exporta??o Vendas por Dia sem linha de totalizador (TOTAL)');
  }

  const rawRevenue = totalRow[revenueCol];
  const rawVolume = totalRow[volumeCol];

  const revenue = Math.round(parseExcelNumber(rawRevenue) * 100) / 100;
  const volume = Math.round(parseExcelNumber(rawVolume));

  if (!Number.isFinite(revenue) || revenue < 0) {
    throw new Error(`Faturamento totalizador inv?lido: ${revenue}`);
  }
  if (!Number.isInteger(volume) || volume < 0) {
    throw new Error(`Volume de OS totalizador inv?lido: ${volume}`);
  }

  return { revenue, volume };
}

/**
 * Registra o hist?rico da execu??o de um worker na tabela hydra_data_worker_runs.
 */
export function recordDataWorkerRun(
  db: DatabaseInstance,
  args: {
    kind: 'VENDAS_DIA' | 'OPERACAO';
    lojaSlug: string;
    dataReferencia: string;
    startedAt: string;
    status: 'SUCCESS' | 'ERROR';
    itemCount?: number;
    error?: string;
  }
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_data_worker_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      data_referencia TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`
    INSERT INTO hydra_data_worker_runs
    (kind, loja_slug, data_referencia, started_at, finished_at, status, item_count, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    args.kind,
    args.lojaSlug,
    args.dataReferencia,
    args.startedAt,
    new Date().toISOString(),
    args.status,
    args.itemCount ?? 0,
    args.error?.slice(0, 500) || null
  );
}

/**
 * Realiza autentica??o na plataforma Oficina Inteligente.
 */
async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load' });
  const email = page.locator('input[type=email], input[type=text], input[name=login]').first();
  const pass = page.locator('input[type=password]').first();
  await email.waitFor({ state: 'visible', timeout: 20000 });
  await email.fill(process.env.OI_USER || '');
  await pass.fill(process.env.OI_PASS || '');
  const button = page.locator('button:has-text(Entrar), button:has-text(Login)').first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
  } else {
    await pass.press('Enter');
  }
  await page.waitForTimeout(3000);
}

/**
 * Coleta oficial de Vendas do Dia para uma loja espec?fica atrav?s da exporta??o Excel de wfRelatorioOperacao.aspx.
 */
export async function coletarVendasDoDia(page: Page, slug: string, day: string): Promise<{ revenue: number; volume: number }> {
  await page.goto(`${BASE_URL}/wfRelatorioOperacao.aspx`, { waitUntil: 'load' });
  await ensureCompany(page, slug);

  // Formato de data brasileiro DD/MM/YYYY
  const [year, month, dayStr] = day.split('-');
  const brDay = `${dayStr}/${month}/${year}`;

  const txtInicio = page.locator('#ctl00_cph_txtDataInicial');
  const txtFim = page.locator('#ctl00_cph_txtDataFinal');
  await txtInicio.waitFor({ state: 'visible', timeout: 15000 });
  await txtInicio.fill(brDay);
  await txtFim.fill(brDay);
  await page.keyboard.press('Escape');

  // Selecionar formato Excel
  const excelRadio = page.locator('#ctl00_cph_rblFormato_1, label[for="ctl00_cph_rblFormato_1"]').first();
  if (await excelRadio.isVisible().catch(() => false)) {
    await excelRadio.click({ force: true });
  }

  // Disparar download de Vendas por Dia
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    page.locator('#ctl00_cph_btnVendasPorDia').click({ force: true })
  ]);

  const filePath = await download.path();
  if (!filePath) {
    throw new Error(`Exporta??o Vendas por Dia sem arquivo baixado para a loja ${slug}`);
  }

  const workbook = xlsx.readFile(filePath);
  return parseVendasDoDiaWorkbook(workbook);
}

export interface AtualizarFinancasOptions {
  db?: DatabaseInstance;
  targetDate?: Date;
  metasResult?: ResultadoMapaMetas;
  crawlerMetasFn?: () => Promise<ResultadoMapaMetas>;
  coletorVendasFn?: (page: Page | any, slug: string, day: string) => Promise<{ revenue: number; volume: number }>;
  coletorCMVFn?: (page: Page | any, slug: string, db: DatabaseInstance) => Promise<any>;
  page?: any;
}

/**
 * Rotina orquestradora da coleta financeira hor?ria das 10 lojas operacionais.
 * 1. Obt?m e valida o Mapa de Metas (sem MPMaster, exatamente 10 lojas).
 * 2. Grava metas_horarias com upsert idempotente.
 * 3. Coleta Vendas do Dia oficiais via exporta??o Excel por loja.
 * 4. Grava faturamento_diario_horario com upsert idempotente e registra execu??o em hydra_data_worker_runs.
 * 5. Tolera falhas parciais (se 1 loja falhar, as outras 9 s?o salvas e a falha ? registrada).
 */
export async function atualizarFinancasHorarias(options: AtualizarFinancasOptions = {}): Promise<{
  metas: number;
  vendasDia: number;
  falhas: string[];
}> {
  const db = options.db || getDatabaseConnection();
  ensureSchema(db);

  // 1. Mapa de Metas
  const metas = options.metasResult || (options.crawlerMetasFn ? await options.crawlerMetasFn() : await executarCrawlerMetas());
  const validation = validarIntegridadeMetas(metas);
  if (!validation.valido) {
    throw new Error(`Mapa de Metas rejeitado: ${validation.motivo}`);
  }

  const capturedAt = options.targetDate || new Date();
  const { day, hour } = getSaoPauloDateParts(capturedAt);

  // Upsert idempotente por (data_referencia, posicao_hora, loja_slug) em metas_horarias
  const saveMap = db.prepare(`
    INSERT INTO metas_horarias
    (data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_referencia, posicao_hora, loja_slug) DO UPDATE SET
      faturamento_mes=excluded.faturamento_mes,
      volume_os=excluded.volume_os,
      ticket_medio=excluded.ticket_medio,
      meta_mes=excluded.meta_mes,
      previsao_mes=excluded.previsao_mes,
      percentual_meta=excluded.percentual_meta,
      captured_at=excluded.captured_at
  `);

  db.transaction(() => {
    for (const loja of metas.lojas) {
      saveMap.run(
        day,
        hour,
        loja.slug,
        loja.faturamentoTotal,
        loja.volumeOS,
        loja.ticketMedio,
        loja.meta ?? null,
        loja.previsao ?? null,
        loja.percentualMeta ?? null,
        capturedAt.toISOString()
      );
    }
  })();

  // 2. Vendas do Dia Oficial
  const saveDaily = db.prepare(`
    INSERT INTO faturamento_diario_horario
    (data_referencia, posicao_hora, loja_slug, faturamento_dia, volume_os_dia, captured_at, fonte)
    VALUES (?, ?, ?, ?, ?, ?, 'VENDAS_POR_DIA_OFICIAL')
    ON CONFLICT(data_referencia, posicao_hora, loja_slug) DO UPDATE SET
      faturamento_dia=excluded.faturamento_dia,
      volume_os_dia=excluded.volume_os_dia,
      captured_at=excluded.captured_at,
      fonte=excluded.fonte
  `);

  let successful = 0;
  const falhas: string[] = [];

  if (options.coletorVendasFn) {
    // Modo com coletor injetado (ex: testes unit?rios e de integra??o)
    for (const loja of metas.lojas) {
      const started = new Date();
      try {
        const { revenue, volume } = await options.coletorVendasFn(options.page, loja.slug, day);
        saveDaily.run(day, hour, loja.slug, revenue, volume, new Date().toISOString());
        successful++;
        recordDataWorkerRun(db, {
          kind: 'VENDAS_DIA',
          lojaSlug: loja.slug,
          dataReferencia: day,
          startedAt: started.toISOString(),
          itemCount: 1,
          status: 'SUCCESS'
        });
      } catch (err: any) {
        falhas.push(`${loja.slug}: ${err?.message || err}`);
        recordDataWorkerRun(db, {
          kind: 'VENDAS_DIA',
          lojaSlug: loja.slug,
          dataReferencia: day,
          startedAt: started.toISOString(),
          status: 'ERROR',
          error: String(err?.message || err)
        });
        console.error(`[Hourly Finance] Falha na coleta da loja ${loja.slug}: ${err?.message || err}`);
      }

      if (options.coletorCMVFn) {
        try {
          await options.coletorCMVFn(options.page, loja.slug, db);
        } catch (cmvErr: any) {
          console.error(`[Hourly Finance] Falha na coleta mock de CMV da loja ${loja.slug}: ${cmvErr?.message || cmvErr}`);
        }
      }
    }
  } else {
    // Modo de produ??o com automa??o Playwright real
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 }
      });
      const page = await context.newPage();
      await login(page);

      for (const loja of metas.lojas) {
        const started = new Date();
        try {
          const { revenue, volume } = await coletarVendasDoDia(page, loja.slug, day);
          saveDaily.run(day, hour, loja.slug, revenue, volume, new Date().toISOString());
          successful++;
          recordDataWorkerRun(db, {
            kind: 'VENDAS_DIA',
            lojaSlug: loja.slug,
            dataReferencia: day,
            startedAt: started.toISOString(),
            itemCount: 1,
            status: 'SUCCESS'
          });
        } catch (err: any) {
          falhas.push(`${loja.slug}: ${err?.message || err}`);
          recordDataWorkerRun(db, {
            kind: 'VENDAS_DIA',
            lojaSlug: loja.slug,
            dataReferencia: day,
            startedAt: started.toISOString(),
            status: 'ERROR',
            error: String(err?.message || err)
          });
          console.error(`[Hourly Finance] Falha na coleta da loja ${loja.slug}: ${err?.message || err}`);
        }

        // Extração horária de Gestão Periódica (CMV por Área e Pesquisa de Mídia)
        try {
          await coletarRelatorioOperacaoLoja(page, loja.slug, db);
        } catch (cmvErr: any) {
          console.error(`[Hourly Finance] Falha na coleta de CMV/Gestão Periódica da loja ${loja.slug}: ${cmvErr?.message || cmvErr}`);
        }
      }
    } finally {
      await browser.close();
    }
  }

  console.log(`[Hourly Finance] ${day} ${hour}h: Mapa de Metas (${metas.lojas.length}/10); Vendas do Dia (${successful}/10); Falhas (${falhas.length})`);
  return { metas: metas.lojas.length, vendasDia: successful, falhas };
}

if (process.argv[1]?.includes('hourly_finance_worker')) {
  atualizarFinancasHorarias().catch(err => {
    console.error('[Hourly Finance] Falha:', err?.message || err);
    process.exitCode = 1;
  });
}
