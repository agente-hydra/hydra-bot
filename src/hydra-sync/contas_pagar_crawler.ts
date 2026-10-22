/**
 * contas_pagar_crawler.ts
 *
 * Módulo especializado na extração automatizada do relatório PDF oficial de
 * Contas a Pagar (Contas Pagas) no ERP Oficina Inteligente.
 *
 * Tela Alvo: wfContaBuscaPagar.aspx
 * Regra de Filtro:
 * - Todas as empresas selecionadas via #chkEmpresaSelecao
 * - Filtro de data: Data de Pagamento (value: '3')
 * - Período:
 *   - Terça a Domingo: Ontem (D-1) a Ontem (D-1)
 *   - Segunda-feira: Sexta-feira anterior (D-3) a Ontem/Domingo (D-1)
 * - Impressão: Interceptação nativa do download de BuscaContasAPagar.pdf via #ctl00_cph_btnRelatorio
 */

import { type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { calcularJanelaAcumulada } from './feriados_calendario.js';

export interface ContasPagarDataRange {
  dataInicialFormatada: string; // "DD/MM/YYYY"
  dataFinalFormatada: string;   // "DD/MM/YYYY"
  filtroValor: string;          // '2' = Vencimento, '3' = Pagamento
  isSegundaFeira: boolean;
  diasCobertosDescricao: string;
}

export interface ContasPagarCrawlerOptions {
  baseUrl?: string;
  dataReferencia?: Date;
  timeoutMs?: number;
  desmarcarMaster?: boolean;
  modo?: 'vencimento_hoje' | 'pagamento_anterior';
}

export interface ContasPagarExtractionResult {
  sucesso: boolean;
  caminhoArquivoSalvo: string;
  tamanhoBytes: number;
  caminhoExcelSalvo?: string;
  tamanhoExcelBytes?: number;
  dataInicialUtilizada: string;
  dataFinalUtilizada: string;
  duracaoMs: number;
  mensagem?: string;
}

/**
 * Calcula o intervalo de datas para a consulta de Contas a Pagar:
 * - Padrão Diretor (vencimento_hoje): Contas a Vencer no dia atual (Hoje D)
 * - Modo alternativo (pagamento_anterior): filtro por Data de Pagamento do dia D-1
 */
export function calcularPeriodoContasPagar(
  dataRef: Date = new Date(),
  modo: 'vencimento_hoje' | 'pagamento_anterior' = 'vencimento_hoje'
): ContasPagarDataRange {
  const d = String(dataRef.getDate()).padStart(2, '0');
  const m = String(dataRef.getMonth() + 1).padStart(2, '0');
  const y = dataRef.getFullYear();
  const hojeBR = `${d}/${m}/${y}`;

  if (modo === 'vencimento_hoje') {
    return {
      dataInicialFormatada: hojeBR,
      dataFinalFormatada: hojeBR,
      filtroValor: '2', // Data de Vencimento
      isSegundaFeira: dataRef.getDay() === 1,
      diasCobertosDescricao: `Contas a Vencer no dia atual (${hojeBR})`
    };
  }

  const janela = calcularJanelaAcumulada(dataRef);
  return {
    dataInicialFormatada: janela.dataInicioBR,
    dataFinalFormatada: janela.dataFimBR,
    filtroValor: '3', // Data de Pagamento
    isSegundaFeira: janela.motivo === 'segunda_feira',
    diasCobertosDescricao: janela.descricao
  };
}

/**
 * Executa a navegação, preenchimento de filtros e extração do PDF de Contas a Pagar
 */
export async function gerarPdfContasPagar(
  page: Page,
  caminhoDestino: string,
  options: ContasPagarCrawlerOptions = {}
): Promise<ContasPagarExtractionResult> {
  const inicio = Date.now();
  const baseUrl = options.baseUrl || process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';
  const dataReferencia = options.dataReferencia || new Date();
  const timeoutMs = options.timeoutMs || 45000;
  const desmarcarMaster = options.desmarcarMaster !== false;

  const periodo = calcularPeriodoContasPagar(dataReferencia, options.modo || 'vencimento_hoje');
  console.log(`[Contas Pagar] Iniciando extração do PDF oficial...`);
  console.log(`[Contas Pagar] Período calculado: ${periodo.dataInicialFormatada} até ${periodo.dataFinalFormatada} (${periodo.diasCobertosDescricao})`);

  // Garante diretório de destino
  const pastaDestino = path.dirname(caminhoDestino);
  if (!fs.existsSync(pastaDestino)) {
    fs.mkdirSync(pastaDestino, { recursive: true });
  }

  const targetUrl = `${baseUrl}/wfContaBuscaPagar.aspx`;
  console.log(`[Contas Pagar] Navegando para ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'load', timeout: timeoutMs });
  await page.waitForTimeout(2000);

  // 1. Selecionar todas as empresas via checkbox nativo
  console.log(`[Contas Pagar] Selecionando todas as empresas (#chkEmpresaSelecao)...`);
  const chkEmpresa = page.locator('#chkEmpresaSelecao');
  await chkEmpresa.waitFor({ state: 'attached', timeout: 15000 });

  const isChecked = await chkEmpresa.isChecked().catch(() => false);
  if (!isChecked) {
    await chkEmpresa.click();
    await page.waitForTimeout(1000);
  }

  // 1.1 Regra Anti-Master: Desmarcar MPMaster se configurado
  if (desmarcarMaster) {
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
  }

  // 2. Filtro de Data: Selecionar Tipo de Data (opção '2' = Vencimento, '3' = Pagamento)
  console.log(`[Contas Pagar] Selecionando filtro (#ctl00_cph_rblFiltroData -> '${periodo.filtroValor}')...`);
  const selectFiltroData = page.locator('#ctl00_cph_rblFiltroData');
  await selectFiltroData.waitFor({ state: 'visible', timeout: 10000 });
  await selectFiltroData.selectOption(periodo.filtroValor);
  await page.waitForTimeout(500);

  // 3. Preencher datas
  console.log(`[Contas Pagar] Preenchendo datas: Inicial=${periodo.dataInicialFormatada} | Final=${periodo.dataFinalFormatada}...`);
  const inputDataIni = page.locator('#ctl00_cph_txtDataInicial');
  const inputDataFim = page.locator('#ctl00_cph_txtDataFinal');

  await inputDataIni.waitFor({ state: 'visible', timeout: 10000 });
  await inputDataIni.fill(periodo.dataInicialFormatada);
  await inputDataFim.fill(periodo.dataFinalFormatada);
  await page.waitForTimeout(500);

  // 4. Clicar em Buscar
  console.log(`[Contas Pagar] Clicando em Buscar (#ctl00_cph_btnBuscar)...`);
  const btnBuscar = page.locator('#ctl00_cph_btnBuscar');
  await btnBuscar.waitFor({ state: 'visible', timeout: 10000 });
  await btnBuscar.click();

  // Aguardar carregamento da busca
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);

  // 5. Clicar em Imprimir e capturar o download
  console.log(`[Contas Pagar] Clicando em Imprimir (#ctl00_cph_btnRelatorio) e aguardando download...`);
  const btnImprimir = page.locator('#ctl00_cph_btnRelatorio');
  await btnImprimir.waitFor({ state: 'visible', timeout: 15000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: timeoutMs }),
    btnImprimir.click()
  ]);

  console.log(`[Contas Pagar] Download PDF recebido: ${download.suggestedFilename()}`);
  await download.saveAs(caminhoDestino);

  if (!fs.existsSync(caminhoDestino)) {
    throw new Error(`Arquivo não foi salvo no destino esperado: ${caminhoDestino}`);
  }

  const stat = fs.statSync(caminhoDestino);
  if (stat.size < 1024) {
    throw new Error(`Arquivo gerado tem tamanho inválido: ${stat.size} bytes`);
  }

  console.log(`[Contas Pagar] ✅ PDF oficial gerado com sucesso em ${caminhoDestino} (${(stat.size / 1024).toFixed(1)} KB)`);

  // 6. Extrair também a versão Excel (#ctl00_cph_rblFormato_1)
  let caminhoExcelSalvo: string | undefined = undefined;
  let tamanhoExcelBytes: number | undefined = undefined;
  const caminhoExcelFinal = caminhoDestino.replace(/\.pdf$/i, '.xlsx');

  try {
    console.log(`[Contas Pagar] Selecionando formato Excel (#ctl00_cph_rblFormato_1)...`);
    const radioExcel = page.locator('#ctl00_cph_rblFormato_1');
    await radioExcel.waitFor({ state: 'attached', timeout: 5000 });
    await radioExcel.click();
    await page.waitForTimeout(500);

    console.log(`[Contas Pagar] Clicando em Imprimir para baixar Excel...`);
    const [downloadExcel] = await Promise.all([
      page.waitForEvent('download', { timeout: timeoutMs }),
      btnImprimir.click()
    ]);

    await downloadExcel.saveAs(caminhoExcelFinal);
    if (fs.existsSync(caminhoExcelFinal)) {
      const statExcel = fs.statSync(caminhoExcelFinal);
      caminhoExcelSalvo = caminhoExcelFinal;
      tamanhoExcelBytes = statExcel.size;
      console.log(`[Contas Pagar] ✅ Excel oficial gerado com sucesso em ${caminhoExcelFinal} (${(statExcel.size / 1024).toFixed(1)} KB)`);
    }
  } catch (errExcel: any) {
    console.warn(`[Contas Pagar] ⚠️ Falha ao baixar versão Excel (PDF mantido com sucesso): ${errExcel.message}`);
  }

  const duracaoMs = Date.now() - inicio;

  return {
    sucesso: true,
    caminhoArquivoSalvo: caminhoDestino,
    tamanhoBytes: stat.size,
    caminhoExcelSalvo,
    tamanhoExcelBytes,
    dataInicialUtilizada: periodo.dataInicialFormatada,
    dataFinalUtilizada: periodo.dataFinalFormatada,
    duracaoMs
  };
}
