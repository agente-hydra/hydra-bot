import * as fs from 'fs';
import * as path from 'path';
import { Page, chromium } from 'playwright';
import { config as dotenvConfig } from 'dotenv';
import type { MetaLojaItem } from './db_repository.ts';

dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();

export interface LinhaMetasLoja {
  slug: string;
  nome: string;
  faturamentoTotal: number;
  volumeOS: number;
  ticketMedio: number;
  meta: number;
  previsao?: number;
  percentualMeta?: number;
  mesAnterior?: number;
  anoAnterior?: number;
}

export interface ResultadoMapaMetas {
  faturamentoTotal: number;
  totalOSs: number;
  ticketMedioRede: number;
  metaTotalRede: number;
  faltaTotalRede: number;
  atingimentoTotalRede: number;
  posicaoDataHora: string;
  origem: 'MAPA_METAS_OFICIAL';
  lojas: LinhaMetasLoja[];
}

export const EMPRESAS_MAP: Record<string, string> = {
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

export const LOJAS_OPERACIONAIS_SLUGS = [
  'MPdompedro1',
  'MPJabaquara',
  'MPJorgeBeretta',
  'MPkennedy',
  'MPpiraporinha',
  'MPplanalto',
  'MPrudge',
  'MPSantoAndre',
  'ReiDoModulo',
  'ReiDoOleoMaua'
] as const;

/**
 * Extrai os dados consolidados e por loja da tela oficial "Mapa de Metas" (wfMapaDeMeta.aspx).
 * Aplica rigorosamente o expurgo da loja Master.
 */
export async function extrairMapaDeMetas(page: Page): Promise<ResultadoMapaMetas> {
  const BASE_URL = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

  console.log('[Metas Crawler] Navegando para wfMapaDeMeta.aspx...');
  await page.goto(`${BASE_URL}/wfMapaDeMeta.aspx`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // 1. Clicar em "Todas as Empresas"
  console.log('[Metas Crawler] Selecionando todas as empresas...');
  const btnTodas = page.locator('#ctl00_cph_ucMapaDeMeta_btnEmpresaTodas');
  await btnTodas.waitFor({ state: 'visible', timeout: 10000 });
  await btnTodas.click();
  await page.waitForTimeout(800);

  // 2. REGRA GLOBAL ANTI-MASTER: Desmarcar sumariamente a checkbox da Loja Master
  console.log('[Metas Crawler] Desmarcando Loja Master...');
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
  console.log('[Metas Crawler] Clicando em Gerar...');
  const btnGerar = page.locator('#btnGerar');
  await btnGerar.click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);

  // 4. Parsear tabela de metas do DOM
  console.log('[Metas Crawler] Parseando tabela de metas...');
  await page.evaluate('window.__name = function(t, v) { return t; };');
  const parsedData = await page.evaluate(() => {
    (window as any).__name = (window as any).__name || function(t: any) { return t; };
    const table = document.querySelector('#ctl00_cph_ucMapaDeMeta_grd') as HTMLTableElement | null;
    if (!table) {
      throw new Error('Tabela #ctl00_cph_ucMapaDeMeta_grd n?o encontrada no DOM');
    }

    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) {
      throw new Error('Tabela de metas sem linhas de dados');
    }

    // Identificar colunas no header
    const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map(c => (c.textContent || '').trim());
    let totalColIdx = -1;
    let vColIdx = -1;
    let tkColIdx = -1;
    let previsaoColIdx = -1;
    let mesAntColIdx = -1;
    let anoAntColIdx = -1;
    let metaColIdx = -1;
    let pctMetaColIdx = -1;

    headerCells.forEach((h, idx) => {
      const hLower = h.toLowerCase().trim();
      if (hLower === 'total' && totalColIdx === -1) {
        totalColIdx = idx;
        if (headerCells[idx + 1]?.toLowerCase().trim() === 'v') {
          vColIdx = idx + 1;
        }
      }
      if (hLower === 'tk' && tkColIdx === -1) {
        tkColIdx = idx;
      }
      if ((hLower === 'previs?o' || hLower === 'previsao') && previsaoColIdx === -1) {
        previsaoColIdx = idx;
      }
      if ((hLower === 'm?santerior' || hLower === 'mesanterior') && mesAntColIdx === -1) {
        mesAntColIdx = idx;
      }
      if (hLower === 'anoanterior' && anoAntColIdx === -1) {
        anoAntColIdx = idx;
      }
      if (hLower === 'meta' && metaColIdx === -1) {
        metaColIdx = idx;
      }
      if (hLower === '%meta' && pctMetaColIdx === -1) {
        pctMetaColIdx = idx;
      }
    });

    if (totalColIdx === -1) totalColIdx = 12; // Fallback baseado na estrutura observada
    if (vColIdx === -1) vColIdx = totalColIdx + 1;
    if (tkColIdx === -1) tkColIdx = vColIdx + 1;
    if (previsaoColIdx === -1) previsaoColIdx = 16;
    if (mesAntColIdx === -1) mesAntColIdx = 17;
    if (anoAntColIdx === -1) anoAntColIdx = 18;
    if (metaColIdx === -1) metaColIdx = 19;
    if (pctMetaColIdx === -1) pctMetaColIdx = 20;

    const rawRows = rows.slice(1).map(r => 
      Array.from(r.querySelectorAll('td')).map(c => (c.textContent || '').trim())
    );

    return {
      headers: headerCells,
      totalColIdx,
      vColIdx,
      tkColIdx,
      previsaoColIdx,
      mesAntColIdx,
      anoAntColIdx,
      metaColIdx,
      pctMetaColIdx,
      rawRows
    };
  });

  const lojas: LinhaMetasLoja[] = [];
  let faturamentoTotalRede = 0;
  let totalOsRede = 0;
  let metaTotalRede = 0;

  for (let i = 0; i < parsedData.rawRows.length; i++) {
    const cells = parsedData.rawRows[i];
    if (cells.length < 3) continue;

    const isLastRow = i === parsedData.rawRows.length - 1;
    const sigla = cells[1] || '';
    const colTotalStr = cells[parsedData.totalColIdx] || '0';
    const colVStr = cells[parsedData.vColIdx] || '0';
    const colTkStr = cells[parsedData.tkColIdx] || '';
    const colPrevisaoStr = cells[parsedData.previsaoColIdx] || '';
    const colMesAntStr = cells[parsedData.mesAntColIdx] || '';
    const colAnoAntStr = cells[parsedData.anoAntColIdx] || '';
    const colMetaStr = cells[parsedData.metaColIdx] || '';
    const colPctMetaStr = cells[parsedData.pctMetaColIdx] || '';

    const parseMoedaVal = (txt: string) => {
      return parseFloat(txt.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    };
    const parseIntVal = (txt: string) => {
      return parseInt(txt.replace(/\D/g, ''), 10) || 0;
    };
    const parseFloatBR = (txt: string) => {
      return parseFloat(txt.replace(/[R$%\s]/g, '').replace(',', '.')) || 0;
    };

    const fatVal = parseMoedaVal(colTotalStr);
    const vVal = parseIntVal(colVStr);
    let tkVal = parseMoedaVal(colTkStr);
    if (tkVal === 0 && vVal > 0) {
      tkVal = fatVal / vVal;
    }
    const metaVal = parseMoedaVal(colMetaStr);
    const prevVal = parseMoedaVal(colPrevisaoStr);
    const mesAntVal = parseMoedaVal(colMesAntStr);
    const anoAntVal = parseMoedaVal(colAnoAntStr);
    const pctMetaVal = parseFloatBR(colPctMetaStr);

    if (isLastRow || (!sigla && fatVal > 0)) {
      // Linha de totaliza??o consolidada da rede
      faturamentoTotalRede = fatVal;
      totalOsRede = vVal;
      metaTotalRede = metaVal;
    } else {
      // Linha de uma loja
      if (sigla.toLowerCase().includes('master')) {
        continue; // Expurgada sumariamente: loja administrativa MPMaster
      }

      const nomeAmigavel = EMPRESAS_MAP[sigla] || sigla;
      lojas.push({
        slug: sigla,
        nome: nomeAmigavel,
        faturamentoTotal: fatVal,
        volumeOS: vVal,
        ticketMedio: tkVal,
        meta: metaVal,
        previsao: prevVal,
        percentualMeta: pctMetaVal,
        mesAnterior: mesAntVal,
        anoAnterior: anoAntVal
      });
    }
  }

  // Se metaTotalRede n?o veio na ?ltima linha, calcula somando as 10 lojas eleg?veis
  if (metaTotalRede <= 0 && lojas.length > 0) {
    metaTotalRede = lojas.reduce((acc, l) => acc + (l.meta || 0), 0);
  }

  // Ordenar lojas pelo maior faturamento
  lojas.sort((a, b) => b.faturamentoTotal - a.faturamentoTotal);

  const agora = new Date();
  const ticketMedioRede = totalOsRede > 0 ? faturamentoTotalRede / totalOsRede : 0;
  const faltaTotalRede = Math.max(0, metaTotalRede - faturamentoTotalRede);
  const atingimentoTotalRede = metaTotalRede > 0 ? (faturamentoTotalRede / metaTotalRede) * 100 : 0;

  const resultado: ResultadoMapaMetas = {
    faturamentoTotal: faturamentoTotalRede,
    totalOSs: totalOsRede,
    ticketMedioRede,
    metaTotalRede,
    faltaTotalRede,
    atingimentoTotalRede,
    posicaoDataHora: agora.toISOString(),
    origem: 'MAPA_METAS_OFICIAL',
    lojas
  };

  return resultado;
}

export interface ValidacaoMetasResult {
  valido: boolean;
  motivo?: string;
  erros: string[];
  totalLojas: number;
  somaLojasFaturamento: number;
  faturamentoTotalRede: number;
}

/**
 * Validador rigoroso de integridade das metas extra?das antes de persistir em disco e SQLite.
 * Garante:
 * 1. Data/hora de refer?ncia v?lida
 * 2. Exatamente 10 lojas comerciais (sem MPMaster)
 * 3. Todas as 10 lojas operacionais obrigat?rias presentes
 * 4. Zero slugs duplicados
 * 5. Valores n?o-negativos, n?o corrompidos (sem NaN) e consist?ncia da soma (toler?ncia <= R$ 0,10)
 */
export function validarIntegridadeMetas(metas: ResultadoMapaMetas): ValidacaoMetasResult {
  const erros: string[] = [];

  if (!metas) {
    return {
      valido: false,
      motivo: 'Payload de metas nulo ou indefinido',
      erros: ['Payload nulo'],
      totalLojas: 0,
      somaLojasFaturamento: 0,
      faturamentoTotalRede: 0
    };
  }

  // 1. Validar data/hora de refer?ncia
  if (!metas.posicaoDataHora || isNaN(new Date(metas.posicaoDataHora).getTime())) {
    erros.push(`Data/hora de posi??o inv?lida: ${metas.posicaoDataHora}`);
  }

  if (!Array.isArray(metas.lojas)) {
    return {
      valido: false,
      motivo: 'Lista de lojas ausente ou inv?lida',
      erros: ['Lista de lojas ausente'],
      totalLojas: 0,
      somaLojasFaturamento: 0,
      faturamentoTotalRede: metas.faturamentoTotal || 0
    };
  }

  // 2. Rejei??o expl?cita se houver Master infiltrada no payload
  const temMaster = metas.lojas.some(l => 
    (l.slug && l.slug.toLowerCase().includes('master')) || 
    (l.nome && l.nome.toLowerCase().includes('master'))
  );
  if (temMaster) {
    erros.push('Loja administrativa MPMaster detectada indevidamente na lista de lojas operacionais');
  }

  // 3. Filtrar lojas eleg?veis (sem Master)
  const lojasComerciais = metas.lojas.filter(l => !l.slug.toLowerCase().includes('master'));

  // 4. Contagem exata de 10 lojas comerciais
  if (lojasComerciais.length !== 10) {
    erros.push(`Quantidade de lojas comerciais incorreta: esperado 10, obtido ${lojasComerciais.length}`);
  }

  // 5. Zero duplicatas de slug
  const slugs = lojasComerciais.map(l => l.slug.toLowerCase());
  const slugsUnicos = new Set(slugs);
  if (slugsUnicos.size !== slugs.length) {
    erros.push(`Slugs duplicados detectados: ${slugs.join(', ')}`);
  }

  // 6. Verificar se todas as 10 lojas operacionais obrigat?rias est?o presentes
  for (const slugObrigatorio of LOJAS_OPERACIONAIS_SLUGS) {
    if (!lojasComerciais.some(l => l.slug.toLowerCase() === slugObrigatorio.toLowerCase())) {
      erros.push(`Loja operacional obrigat?ria ausente: ${slugObrigatorio}`);
    }
  }

  // 7. Consist?ncia de valores e soma
  let somaFat = 0;
  let somaOS = 0;

  for (const loja of lojasComerciais) {
    if (typeof loja.faturamentoTotal !== 'number' || isNaN(loja.faturamentoTotal) || loja.faturamentoTotal < 0) {
      erros.push(`Loja ${loja.slug} possui faturamento inv?lido: ${loja.faturamentoTotal}`);
    } else {
      somaFat += loja.faturamentoTotal;
    }

    if (typeof loja.volumeOS !== 'number' || isNaN(loja.volumeOS) || loja.volumeOS < 0 || !Number.isInteger(loja.volumeOS)) {
      erros.push(`Loja ${loja.slug} possui volume de OS inv?lido: ${loja.volumeOS}`);
    } else {
      somaOS += loja.volumeOS;
    }

    if (typeof loja.ticketMedio !== 'number' || isNaN(loja.ticketMedio) || loja.ticketMedio < 0) {
      erros.push(`Loja ${loja.slug} possui ticket m?dio inv?lido: ${loja.ticketMedio}`);
    }

    if (loja.meta !== undefined && (typeof loja.meta !== 'number' || isNaN(loja.meta) || loja.meta < 0)) {
      erros.push(`Loja ${loja.slug} possui meta inv?lida: ${loja.meta}`);
    }

    if (loja.previsao !== undefined && (typeof loja.previsao !== 'number' || isNaN(loja.previsao) || loja.previsao < 0)) {
      erros.push(`Loja ${loja.slug} possui previs?o inv?lida: ${loja.previsao}`);
    }
  }

  // Valida??o do total da rede
  if (typeof metas.faturamentoTotal !== 'number' || isNaN(metas.faturamentoTotal) || metas.faturamentoTotal <= 0) {
    erros.push(`Faturamento total da rede zerado ou negativo: ${metas.faturamentoTotal}`);
  }

  if (typeof metas.totalOSs !== 'number' || isNaN(metas.totalOSs) || metas.totalOSs < 0 || !Number.isInteger(metas.totalOSs)) {
    erros.push(`Total de OSs da rede inv?lido: ${metas.totalOSs}`);
  }

  const diffFaturamento = Math.abs(somaFat - metas.faturamentoTotal);
  if (diffFaturamento > 0.10) {
    erros.push(`Soma dos faturamentos das lojas (R$ ${somaFat.toFixed(2)}) diverge do total da rede (R$ ${metas.faturamentoTotal.toFixed(2)}) em mais de R$ 0,10 (diff: R$ ${diffFaturamento.toFixed(2)})`);
  }

  const diffOS = Math.abs(somaOS - metas.totalOSs);
  if (diffOS > 1) {
    erros.push(`Soma dos volumes de OS das lojas (${somaOS}) diverge do total da rede (${metas.totalOSs})`);
  }

  const valido = erros.length === 0;

  return {
    valido,
    motivo: valido ? undefined : erros.join('; '),
    erros,
    totalLojas: lojasComerciais.length,
    somaLojasFaturamento: Number(somaFat.toFixed(2)),
    faturamentoTotalRede: metas.faturamentoTotal
  };
}

/**
 * Executa o fluxo completo do crawler do Mapa de Metas de ponta a ponta e persiste em disco.
 */
export async function executarCrawlerMetas(outDir: string = '/home/operacional/hydra-data/crawls'): Promise<ResultadoMapaMetas> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript('window.__name = function(t, v) { return t; };');
    const page = await context.newPage();

    const BASE = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';
    console.log('[Metas Crawler] Efetuando login...');
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

    const metas = await extrairMapaDeMetas(page);
    const validacao = validarIntegridadeMetas(metas);

    // Sincroniza??o Transacional no SQLite WAL protegida por valida??o
    try {
      const { getDatabaseConnection, salvarMetasDiarias, registrarExecucaoCrawl } = await import('./db_repository.ts');
      const db = getDatabaseConnection();
      const agora = new Date();
      const localParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(agora);
      const part = (type: string) => localParts.find(p => p.type === type)?.value || '';
      const dataRefIso = `${part('year')}-${part('month')}-${part('day')}`;
      const posicaoHora = agora.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
      });

      if (validacao.valido) {
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        const targetFile = path.join(outDir, 'metas_rede.json');
        fs.writeFileSync(targetFile, JSON.stringify(metas, null, 2));
        console.log(`[Metas Crawler] ? Metas oficiais salvas com sucesso em: ${targetFile}`);
        console.log(`- Faturamento Oficial Rede: R$ ${metas.faturamentoTotal.toFixed(2)}`);
        console.log(`- Total de OSs Oficial Rede: ${metas.totalOSs}`);
        console.log(`- Lojas extra?das: ${metas.lojas.length}`);

        const itemsParaSalvar: MetaLojaItem[] = metas.lojas.map(l => ({
          loja_slug: l.slug,
          faturamento_mes: l.faturamentoTotal,
          volume_os: l.volumeOS,
          ticket_medio: l.ticketMedio,
          meta_mes: l.meta,
          previsao_mes: l.previsao,
          percentual_meta: l.percentualMeta
        }));

        salvarMetasDiarias(db, itemsParaSalvar, dataRefIso, posicaoHora);
        registrarExecucaoCrawl(db, {
          loja_slug: 'REDE',
          tipo_crawl: 'METAS',
          data_referencia: dataRefIso,
          inicio_em: agora.toISOString(),
          fim_em: new Date().toISOString(),
          total_registros: metas.lojas.length,
          total_abertas: 0,
          status: 'SUCCESS'
        });
        console.log(`[Metas Crawler] ? Metas sincronizadas no SQLite (tabela metas_diarias, data_referencia: ${dataRefIso}).`);
      } else {
        console.warn(`[Metas Crawler] ?? Sincroniza??o e grava??o de JSON abortadas por falha de integridade: ${validacao.motivo}`);
        registrarExecucaoCrawl(db, {
          loja_slug: 'REDE',
          tipo_crawl: 'METAS',
          data_referencia: dataRefIso,
          inicio_em: agora.toISOString(),
          total_registros: metas.lojas?.length || 0,
          status: 'PARTIAL_REJECTED',
          detalhe_erro: validacao.motivo
        });
      }
    } catch (dbErr: any) {
      console.error(`[Metas Crawler] ? Erro ao salvar metas no SQLite: ${dbErr.message}`);
    }

    return metas;
  } finally {
    await browser.close();
  }
}

/**
 * L? os dados de metas consolidados j? salvos em disco.
 */
export function obterMetasConsolidado(crawlsDir: string = '/home/operacional/hydra-data/crawls'): ResultadoMapaMetas | null {
  const metasPath = path.join(crawlsDir, 'metas_rede.json');
  if (fs.existsSync(metasPath)) {
    try {
      const raw = fs.readFileSync(metasPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data.faturamentoTotal === 'number' && typeof data.totalOSs === 'number') {
        return data as ResultadoMapaMetas;
      }
    } catch (e: any) {
      console.warn(`[Metas] Erro ao ler metas_rede.json: ${e.message}`);
    }
  }
  return null;
}
