import { Page } from 'playwright';
import { ensureCompany } from './core.js';

export async function handleConsultaOSUltimaLoja(page: Page, params: any) {
  const { loja, data_inicio, data_fim } = params;

  if (!loja) throw new Error("Parâmetro 'loja' é obrigatório.");

  console.log(`[Última OS] Iniciando consulta para ${loja}...`);

  // 1. Navegar para Busca de OS primeiro para garantir que o header está lá
  console.log(`[Última OS] Navegando para wfOrdemDeServicoBusca.aspx...`);
  await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });

  // 2. Troca de empresa usando a infra do core
  const oldHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  await ensureCompany(page, loja);
  const newHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  
  if (oldHeader !== newHeader) {
      await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });
  }

  // 3. Limpar e Preencher filtros
  console.log(`[Última OS] Limpando filtros e preenchendo datas...`);
  await page.locator('#ctl00_cph_btnLimpar').click();
  await page.waitForLoadState('networkidle');

  const formatarData = (dt: string) => {
    if (dt && dt.includes('-')) {
        const [y, m, d] = dt.split('-');
        return `${d}/${m}/${y}`;
    }
    return dt;
  };

  if (data_inicio) await page.locator('#ctl00_cph_txtDataInicial').fill(formatarData(data_inicio));
  if (data_fim) await page.locator('#ctl00_cph_txtDataFinal').fill(formatarData(data_fim));

  // Exibir Abertas e Fechadas para pegar o movimento real (a última de fato)
  await page.locator('#ctl00_cph_chkExibirAberta').check();
  await page.locator('#ctl00_cph_chkExibirFechada').check();
  
  // Buscar
  console.log(`[Última OS] Clicando em Buscar...`);
  await page.locator('#ctl00_cph_btnBuscar').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Margem ASP.NET

  // 4. Lendo resultados da Grid Principal (apenas a primeira)
  console.log(`[Última OS] Lendo topo da grid...`);
  
  // Pegamos todos os links de OS na grid
  const osLinks = page.locator('table[id*="grd"] a[id*="lkbOrdemDeServicoID"]');
  const count = await osLinks.count();
  
  if (count === 0) {
      console.log(`[Última OS] Nenhuma OS encontrada.`);
      return { loja, tem_os: false };
  }
  
  // A primeira linha da tabela que tem link da OS:
  const primeiroLink = osLinks.first();
  const os_codigo = await primeiroLink.textContent().catch(() => '');
  
  // Pegar a linha tr inteira que contém esse link
  const row = primeiroLink.locator('xpath=./ancestor::tr');
  
  const veiculo = await row.locator('a[id*="lkbNomeDoVeiculo"]').textContent().catch(() => '');
  const placa = await row.locator('a[id*="lkbPlacaDoVeiculo"]').textContent().catch(() => '');
  const cliente = await row.locator('a[id*="lkbClienteNome"]').textContent().catch(() => '');
  const statusGrid = await row.locator('span[id*="lblSigla"]').getAttribute('title').catch(() => '');

  // 5. Entrar no detalhe da última OS
  console.log(`[Última OS] Abrindo detalhe da OS ${os_codigo}...`);
  
  const popupPromise = page.waitForEvent('popup', { timeout: 7000 }).catch(() => null);
  await primeiroLink.click();
  const detalhePage = await popupPromise || page;
  
  if (!popupPromise) {
      await detalhePage.waitForLoadState('networkidle');
  }

  let valorTotal = 0;
  let totalPago = 0;
  let percentualPago = 0;
  let statusDetalhe = statusGrid;

  try {
      // Ler status atual no detalhe, se for mais preciso
      const labelStatus = await detalhePage.locator('#ctl00_cph_lblStatus').textContent().catch(() => '');
      if (labelStatus) statusDetalhe = labelStatus;

      // Clicar na aba Produtos e Serviços
      const abaItens = detalhePage.locator('a:has-text("Produtos e Serviços"), span:has-text("Produtos e Serviços")').first();
      if (await abaItens.isVisible()) await abaItens.click();
      await detalhePage.waitForTimeout(1000); 

      // Somar Valores da Grid de Itens 
      const valorCells = detalhePage.locator('table[id*="ucOrdemDeServicoItem_grd"] tr td:nth-child(6)'); // R$ Total costuma ser col 6
      const countCells = await valorCells.count();
      for (let c = 1; c < countCells; c++) {
          const valText = await valorCells.nth(c).innerText();
          const valClean = valText.replace('R$', '').replace('.', '').replace(',', '.').trim();
          valorTotal += parseFloat(valClean) || 0;
      }

      // Aba Pagamentos
      const abaPagamento = detalhePage.locator('a:has-text("Pagamentos"), span:has-text("Pagamentos")').first();
      if (await abaPagamento.isVisible()) {
          await abaPagamento.click();
          await detalhePage.waitForTimeout(1500); 

          const pagCells = detalhePage.locator('table[id*="ucOrdemDeServicoPagamento_grd"] tr td:nth-child(4)'); // Coluna Valor
          const countPag = await pagCells.count();
          for (let c = 1; c < countPag; c++) {
              const pagText = await pagCells.nth(c).innerText();
              const pagClean = pagText.replace('R$', '').replace('.', '').replace(',', '.').trim();
              totalPago += parseFloat(pagClean) || 0;
          }
      }

      if (valorTotal > 0) {
          percentualPago = (totalPago / valorTotal) * 100;
      }
      
  } catch (e: any) {
      console.log(`[Última OS] Erro lendo detalhes da OS ${os_codigo}:`, e.message);
  } finally {
      if (popupPromise) {
          await detalhePage.close();
      } else {
          await page.goBack();
          await page.waitForLoadState('networkidle');
      }
  }

  console.log(`[Última OS] Leitura finalizada.`);

  return {
      loja,
      tem_os: true,
      os_codigo: os_codigo ? os_codigo.trim() : '',
      cliente: cliente ? cliente.trim() : '',
      placa: placa ? placa.trim() : '',
      veiculo: veiculo ? veiculo.trim() : '',
      status: statusDetalhe ? statusDetalhe.trim() : '',
      valor_total_centavos: Math.round(valorTotal * 100),
      total_pago_centavos: Math.round(totalPago * 100),
      percentual_pago: Math.round(percentualPago)
  };
}
