import { Page } from 'playwright';
import { ensureCompany } from './core.js';

export async function handleConsultaCMVLoja(page: Page, params: any) {
  const { loja, data_inicio, data_fim } = params;

  if (!loja) throw new Error("Parâmetro 'loja' é obrigatório.");
  if (!data_inicio || !data_fim) throw new Error("Parâmetros 'data_inicio' e 'data_fim' são obrigatórios.");

  console.log(`[CMV Loja] Iniciando consulta para ${loja} de ${data_inicio} até ${data_fim}...`);

  // 1. Navegar para Busca de OS primeiro para garantir que o header está lá
  console.log(`[CMV Loja] Navegando para wfOrdemDeServicoBusca.aspx...`);
  await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });

  // 2. Troca de empresa usando a infra do core
  const oldHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  await ensureCompany(page, loja);
  const newHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  
  if (oldHeader !== newHeader) {
      await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });
  }

  // 3. Preencher filtros
  console.log(`[CMV Loja] Preenchendo datas e filtros de Fechadas...`);
  
  // Datas (formato esperado pelo Oficina normalmente é DD/MM/YYYY)
  const formatarData = (dt: string) => {
    if (dt.includes('-')) {
        const [y, m, d] = dt.split('-');
        return `${d}/${m}/${y}`;
    }
    return dt;
  };

  const dtInicio = formatarData(data_inicio);
  const dtFim = formatarData(data_fim);

  await page.locator('#ctl00_cph_txtDataInicial').fill(dtInicio);
  await page.locator('#ctl00_cph_txtDataFinal').fill(dtFim);

  // Marcar Apenas Fechadas (Faturadas)
  await page.locator('#ctl00_cph_chkExibirAberta').uncheck();
  await page.locator('#ctl00_cph_chkExibirFechada').check();

  // Buscar
  console.log(`[CMV Loja] Clicando em Buscar...`);
  await page.locator('#ctl00_cph_btnBuscar').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Dar tempo pro PostBack ASP.NET

  // 4. Extrair OSs da Grid
  console.log(`[CMV Loja] Lendo OSs encontradas...`);
  const osLinks = await page.locator('a[id*="lkbOrdemDeServicoID"]').all();
  
  const osIds: string[] = [];
  for (const link of osLinks) {
    const text = await link.textContent();
    if (text && text.trim()) osIds.push(text.trim());
  }

  console.log(`[CMV Loja] ${osIds.length} OSs faturadas encontradas. Lendo custos internos...`);

  let custoTotalPeriodo = 0;
  const detalheOS = [];

  // 5. Entrar em cada OS e ler o CMV (Custo)
  for (const osId of osIds) {
    console.log(`[CMV Loja] Lendo OS ${osId}...`);
    // Buscar OS específica pelo ID na busca (ou abrir direto se a URL suportar, mas vamos usar a busca por segurança)
    await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });
    
    // Limpar e buscar a OS específica
    await page.locator('#ctl00_cph_btnLimpar').click();
    await page.waitForLoadState('networkidle');
    await page.locator('#ctl00_cph_txtOrdemDeServicoID').fill(osId);
    await page.locator('#ctl00_cph_chkExibirFechada').check();
    await page.locator('#ctl00_cph_btnBuscar').click();
    await page.waitForLoadState('networkidle');

    // Clicar para abrir
    const linkParaOS = page.locator(`a[id*="lkbOrdemDeServicoID"]:has-text("${osId}")`).first();
    const existe = await linkParaOS.count();
    if (existe > 0) {
        await linkParaOS.click();
        await page.waitForLoadState('networkidle');

        // Ir para aba Produtos e Serviços
        const abaProdutos = page.locator('a:has-text("Produtos e Serviços"), span:has-text("Produtos e Serviços")').first();
        if (await abaProdutos.isVisible()) {
            await abaProdutos.click();
        }
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Ler a tabela de itens
        let custoDaOS = 0;
        
        // Mapeamento dinâmico pelo header da grid de produtos
        const headers = await page.locator('table[id*="tab_tapItem_ucOrdemDeServicoItem_grd"] th').allInnerTexts();
        const costIndex = headers.findIndex(h => h.toLowerCase().includes('custo'));
        
        if (costIndex !== -1) {
            const linhas = await page.locator('table[id*="tab_tapItem_ucOrdemDeServicoItem_grd"] tr:not(:first-child)').all(); // Pulando header
            for (const linha of linhas) {
                const tds = await linha.locator('td').all();
                if (tds.length > costIndex) {
                    const txtCusto = await tds[costIndex].textContent();
                    if (txtCusto) {
                        const vCusto = parseFloat(txtCusto.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0;
                        custoDaOS += vCusto;
                    }
                }
            }
        }

        custoTotalPeriodo += custoDaOS;
        detalheOS.push({
            os_id: osId,
            custo_produtos_centavos: Math.round(custoDaOS * 100)
        });
    }
  }

  return {
    loja,
    periodo: { data_inicio: dtInicio, data_fim: dtFim },
    total_os_faturadas: osIds.length,
    cmv_total_centavos: Math.round(custoTotalPeriodo * 100),
    detalhe_os: detalheOS
  };
}
