/**
 * src/hydra-sync/crawler_meta_reconciliation.ts
 * 
 * Módulo de Reconciliação Bidirecional do Mapa de Metas (Pré e Pós-Crawl)
 * e Geração Oficial do PDF em Layout A4 Paisagem.
 * Spec: hydra-mapa-metas-reconcile-and-clean-dispatch
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  EMPRESAS_MAP,
  LOJAS_OPERACIONAIS_SLUGS,
  type StoreRevenueSnapshot,
  type MapaMetasReconciliationSnapshot,
  type ReconcileDeltaResult
} from './types/meta_reconciliation_contract.js';

/**
 * Normaliza e formata uma data para o padrão de nomenclatura canônica DD-MM-AAAA.
 * Ex: "2026-10-08" -> "08-10-2026"
 */
export function formatarDataNomeArquivo(dateInput?: Date | string): string {
  let d: Date;
  if (!dateInput) {
    d = new Date();
  } else if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === 'string') {
    if (dateInput.includes('/')) {
      const parts = dateInput.trim().split('/');
      if (parts.length === 3) {
        return `${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[2]}`;
      }
    }
    const isoParts = dateInput.trim().split('T')[0].split('-');
    if (isoParts.length === 3) {
      return `${isoParts[2].padStart(2, '0')}-${isoParts[1].padStart(2, '0')}-${isoParts[0]}`;
    }
    d = new Date(dateInput);
  } else {
    d = new Date();
  }

  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  return `${dia}-${mes}-${ano}`;
}

/**
 * Retorna os nomes canônicos e elegantes dos 3 arquivos diários oficiais.
 */
export function gerarNomesArquivosOficiais(dateInput?: Date | string): {
  jurosRede: string;
  carrosPatio: string;
  mapaMetas: string;
  dataTag: string;
} {
  const dataTag = formatarDataNomeArquivo(dateInput);
  return {
    jurosRede: `Juros Rede - ${dataTag}.xlsx`,
    carrosPatio: `Carros em Patio - ${dataTag}.xlsx`,
    mapaMetas: `Mapa de Metas - ${dataTag}.pdf`,
    dataTag
  };
}

/**
 * Extrai valor monetário float a partir de string formatada em pt-BR.
 */
export function parseMoedaBRL(txt: string): number {
  if (!txt) return 0;
  const clean = txt.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Number(num.toFixed(2));
}

/**
 * Captura o snapshot completo do Mapa de Metas no ERP Oficina Inteligente.
 * - Navega para wfMapaDeMeta.aspx
 * - Clica em "Todas as Empresas"
 * - Desmarca a Loja Master (regra anti-master)
 * - Clica em "Gerar"
 * - Lê o faturamento total da rede a partir do XPath oficial //*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]
 * - Lê o faturamento individual de cada loja
 */
export async function capturarSnapshotMapaMetas(
  page: Page,
  baseUrl: string = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br'
): Promise<MapaMetasReconciliationSnapshot> {
  const targetUrl = `${baseUrl}/wfMapaDeMeta.aspx`;
  console.log(`[Reconciliação Metas] Navegando para ${targetUrl}...`);

  await page.goto(targetUrl, { waitUntil: 'load', timeout: 35000 });
  await page.waitForTimeout(1500);

  // 1. Clicar em "Todas as Empresas"
  console.log('[Reconciliação Metas] Selecionando Todas as Empresas...');
  const btnTodas = page.locator('#ctl00_cph_ucMapaDeMeta_btnEmpresaTodas');
  await btnTodas.waitFor({ state: 'visible', timeout: 15000 });
  await btnTodas.click();
  await page.waitForTimeout(800);

  // 2. Regra Anti-Master: Desmarcar sumariamente a Loja Master
  console.log('[Reconciliação Metas] Desmarcando Loja Master...');
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    for (const lbl of labels) {
      if (lbl.textContent && lbl.textContent.toLowerCase().includes('master')) {
        const inputId = lbl.getAttribute('for');
        if (inputId) {
          const chk = document.getElementById(inputId) as HTMLInputElement | null;
          if (chk && chk.checked) {
            chk.click();
          }
        }
      }
    }
  });
  await page.waitForTimeout(500);

  // 3. Clicar em "Gerar"
  console.log('[Reconciliação Metas] Clicando em Gerar...');
  const btnGerar = page.locator('#btnGerar, input[id*="btnGerar"]');
  await btnGerar.first().click();

  await page.waitForLoadState('load');
  await page.waitForTimeout(2500);

  // 4. Ler o Faturamento Total Oficial via XPath/Seletor indicado pelo usuário
  let faturamentoTotalRede = 0;
  try {
    // 4.1 Tentativa com o XPath exato fornecido pelo usuário
    const locatorXPath = page.locator('xpath=//*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]');
    if (await locatorXPath.count() > 0 && await locatorXPath.first().isVisible()) {
      const txtTotal = (await locatorXPath.first().textContent()) || '';
      faturamentoTotalRede = parseMoedaBRL(txtTotal);
      console.log(`[Reconciliação Metas] Total capturado via XPath ctl13_lblTotalFaturamento: R$ ${faturamentoTotalRede.toFixed(2)}`);
    }
  } catch (errXPath: unknown) {
    const msg = errXPath instanceof Error ? errXPath.message : String(errXPath);
    console.warn(`[Reconciliação Metas] Falha no XPath ctl13: ${msg}`);
  }

  // 4.2 Fallback para qualquer elemento com ID contendo lblTotalFaturamento
  if (faturamentoTotalRede === 0) {
    try {
      const fallbackTotalLoc = page.locator('span[id*="lblTotalFaturamento"]');
      if (await fallbackTotalLoc.count() > 0) {
        const txtFallback = (await fallbackTotalLoc.first().textContent()) || '';
        faturamentoTotalRede = parseMoedaBRL(txtFallback);
        console.log(`[Reconciliação Metas] Total capturado via fallback span[lblTotalFaturamento]: R$ ${faturamentoTotalRede.toFixed(2)}`);
      }
    } catch {}
  }

  // 5. Parsear as linhas individuais de cada loja na tabela #ctl00_cph_ucMapaDeMeta_grd
  const storesSnapshot: Record<string, StoreRevenueSnapshot> = {};
  let totalOsRede = 0;

  try {
    const tableData = await page.evaluate(() => {
      const table = document.querySelector('#ctl00_cph_ucMapaDeMeta_grd') as HTMLTableElement | null;
      if (!table) return null;

      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2) return null;

      // Localizar índice da coluna 'Total'
      const headers = Array.from(rows[0].querySelectorAll('th, td')).map(c => (c.textContent || '').trim().toLowerCase());
      let totalIdx = headers.findIndex(h => h === 'total');
      if (totalIdx === -1) totalIdx = 12; // Fallback estrutural
      const vIdx = totalIdx + 1;
      const metaIdx = headers.findIndex(h => h === 'meta');

      const extracted: Array<{
        sigla: string;
        totalStr: string;
        vStr: string;
        metaStr: string;
        isLastRow: boolean;
      }> = [];

      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td')).map(c => (c.textContent || '').trim());
        if (cells.length < 3) continue;

        const isLastRow = i === rows.length - 1;
        extracted.push({
          sigla: cells[1] || '',
          totalStr: cells[totalIdx] || '0',
          vStr: cells[vIdx] || '0',
          metaStr: (metaIdx !== -1 && cells[metaIdx]) ? cells[metaIdx] : '0',
          isLastRow
        });
      }

      return extracted;
    });

    if (tableData && Array.isArray(tableData)) {
      for (const item of tableData) {
        const fat = parseMoedaBRL(item.totalStr);
        const v = parseInt(item.vStr.replace(/\D/g, ''), 10) || 0;
        const meta = parseMoedaBRL(item.metaStr);

        if (item.isLastRow || !item.sigla) {
          if (faturamentoTotalRede === 0) faturamentoTotalRede = fat;
          totalOsRede = v;
        } else {
          const sigla = item.sigla.trim();
          if (sigla.toLowerCase().includes('master')) continue; // Expurgo Master

          const tk = v > 0 ? Number((fat / v).toFixed(2)) : 0;
          const nome = EMPRESAS_MAP[sigla] || sigla;

          storesSnapshot[sigla] = {
            slug: sigla,
            nome,
            faturamentoTotal: fat,
            volumeOS: v,
            ticketMedio: tk,
            meta
          };
        }
      }
    }
  } catch (errTable: unknown) {
    const msg = errTable instanceof Error ? errTable.message : String(errTable);
    console.error(`[Reconciliação Metas] Erro ao extrair lojas da tabela: ${msg}`);
  }

  // Se o total geral da rede não tiver vindo de label específico, soma as lojas
  if (faturamentoTotalRede === 0 && Object.keys(storesSnapshot).length > 0) {
    faturamentoTotalRede = Number(
      Object.values(storesSnapshot).reduce((acc, s) => acc + s.faturamentoTotal, 0).toFixed(2)
    );
  }

  const snapshot: MapaMetasReconciliationSnapshot = {
    capturedAt: new Date().toISOString(),
    faturamentoTotalRede,
    totalOSsRede: totalOsRede,
    stores: storesSnapshot,
    sourceXPath: '//*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]',
    masterExcluded: true
  };

  console.log(`[Reconciliação Metas] ✓ Snapshot capturado: Total R$ ${faturamentoTotalRede.toFixed(2)} | ${Object.keys(storesSnapshot).length} lojas.`);
  return snapshot;
}

/**
 * Compara o snapshot inicial (pré-crawl) com o snapshot final (pós-crawl).
 * Detecta se o total mudou e isola cirurgicamente as lojas que tiveram alteração de faturamento.
 */
export function compararSnapshotsMetas(
  inicial: MapaMetasReconciliationSnapshot,
  final: MapaMetasReconciliationSnapshot
): ReconcileDeltaResult {
  const deltaTotal = Number(Math.abs(final.faturamentoTotalRede - inicial.faturamentoTotalRede).toFixed(2));
  const hasChanged = deltaTotal > 0.05; // Tolerância de R$ 0,05 para arredondamentos

  const divergentStores: string[] = [];
  const storeDeltas: Record<string, { initial: number; final: number; delta: number }> = {};

  // Verifica tanto os slugs do catálogo oficial quanto os presentes nos snapshots
  const allSlugs = Array.from(new Set([
    ...LOJAS_OPERACIONAIS_SLUGS,
    ...Object.keys(inicial.stores),
    ...Object.keys(final.stores)
  ]));

  for (const slug of allSlugs) {
    const fatInicial = inicial.stores[slug]?.faturamentoTotal || 0;
    const fatFinal = final.stores[slug]?.faturamentoTotal || 0;
    const deltaLoja = Number(Math.abs(fatFinal - fatInicial).toFixed(2));

    if (deltaLoja > 0.05) {
      divergentStores.push(slug);
      storeDeltas[slug] = {
        initial: fatInicial,
        final: fatFinal,
        delta: deltaLoja
      };
    }
  }

  return {
    hasChanged,
    initialTotal: inicial.faturamentoTotalRede,
    finalTotal: final.faturamentoTotalRede,
    deltaAmount: deltaTotal,
    divergentStores,
    storeDeltas
  };
}

/**
 * Gera o PDF oficial do Mapa de Metas na página atual do Playwright em layout A4 Paisagem.
 */
export async function gerarPdfMapaMetas(
  page: Page,
  outputPath: string
): Promise<string> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log(`[Reconciliação Metas] Formatando página para impressão do PDF: ${outputPath}...`);

  // Aplica estilos visuais no DOM para visualização executiva nítida em A4 Paisagem
  await page.addStyleTag({
    content: `
      @page {
        size: A4 landscape;
        margin: 8mm 6mm;
      }
      body {
        zoom: 82% !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      /* Oculta barras de rolagem e elementos irrelevantes na impressão */
      header, footer, nav, #divHeader, .noprint, input[type="button"], button {
        display: none !important;
      }
      table {
        width: 100% !important;
        border-collapse: collapse !important;
      }
    `
  }).catch(() => {});

  await page.waitForTimeout(600);

  // Gera o PDF oficial
  await page.pdf({
    path: outputPath,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: {
      top: '8mm',
      bottom: '8mm',
      left: '6mm',
      right: '6mm'
    }
  });

  console.log(`[Reconciliação Metas] ✓ PDF do Mapa de Metas gerado com sucesso em: ${outputPath}`);
  return outputPath;
}
