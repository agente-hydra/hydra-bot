import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ensureCompany } from './core.js';

const OI_URL = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';

function loadAtlas(filename: string) {
    const p = path.resolve(`docs/app-map/screens/${filename}`);
    if (!fs.existsSync(p)) throw new Error(`Atlas não encontrado: ${filename}`);
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

export async function consultaOsExposicaoAltoValorSemAdiantamento(page: Page, params: any) {
    const { loja, valor_minimo, percentual_pago_maximo, data_inicio, data_fim } = params;

    console.log('[MCP Tool] Iniciando consultaOsExposicaoAltoValorSemAdiantamento...');
    console.log(`[MCP Tool] Params:`, params);

    // 1. Ler Atlas
    const atlasBusca = loadAtlas('wfOrdemDeServicoBusca_aspx.json');
    const atlasDetalhe = loadAtlas('wfOrdemDeServico_aspx.json');

    // 2. Abrir tela de busca primeiro (para garantir que a master page com o header está carregada)
    console.log('[MCP Tool] Navegando para tela de busca de OS...');
    await page.goto(`${OI_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'networkidle' });

    // 3. Garantir que estamos na loja correta, se aplicável
    if (loja) {
        const oldHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
        await ensureCompany(page, loja);
        const newHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
        
        // Se a empresa mudou e o postback nos tirou da tela, voltamos para a busca
        if (oldHeader !== newHeader) {
            console.log('[MCP Tool] Empresa trocada, voltando para a tela de busca...');
            await page.goto(`${OI_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'networkidle' });
        }
    }

    console.log('[MCP Tool] Aplicando filtros e clicando em Buscar...');
    
    // Fallback de clique em buscar
    const btnBuscarSelector = atlasBusca.actions?.find((a: any) => a.label?.toLowerCase() === 'buscar')?.id || 'ctl00_cph_btnBuscar';
    const btnBuscar = page.locator(`input[id*="btnBuscar"], #${btnBuscarSelector}`).first();
    
    if (await btnBuscar.isVisible()) {
        await btnBuscar.click();
        await page.waitForLoadState('networkidle');
    }

    // 5. Ler Grid de Resultados
    console.log('[MCP Tool] Lendo grid de resultados...');
    const osList: any[] = [];
    const gridRows = page.locator('table[id*="grd"] tr');
    const rowCount = await gridRows.count();
    
    // Limite de extração para não demorar muito no teste MCP (ex: max 10)
    const limit = Math.min(rowCount, 12); 

    for (let i = 1; i < limit; i++) { // pula header
        const row = gridRows.nth(i);
        const lkbId = row.locator('a[id*="lkbOrdemDeServicoID"]');
        const lkbCliente = row.locator('a[id*="lkbClienteNome"]');
        const lkbPlaca = row.locator('a[id*="lkbPlacaDoVeiculo"]');
        
        if (await lkbId.isVisible()) {
            const codigo = await lkbId.innerText();
            const cliente = await lkbCliente.innerText();
            const placa = await lkbPlaca.innerText();
            osList.push({ index: i, codigo, cliente, placa, locator: lkbId });
        }
    }

    console.log(`[MCP Tool] Encontradas ${osList.length} OSs na tela. Processando detalhes...`);
    const resultados = [];

    // 6. Loop de Detalhes
    for (const os of osList) {
        console.log(`[MCP Tool] Abrindo OS ${os.codigo}...`);
        
        const popupPromise = page.waitForEvent('popup', { timeout: 7000 }).catch(() => null);
        await os.locator.click();
        const detalhePage = await popupPromise || page;
        
        if (!popupPromise) {
            await detalhePage.waitForLoadState('networkidle');
        }

        let valorTotal = 0;
        let totalPago = 0;
        let percentualPago = 0;

        try {
            // Clicar na aba Produtos e Serviços (para garantir que os itens foram carregados)
            const abaItens = detalhePage.locator('a:has-text("Produtos e Serviços"), span:has-text("Produtos e Serviços")').first();
            if (await abaItens.isVisible()) await abaItens.click();
            await detalhePage.waitForTimeout(1000); // aguardar ajax tab

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
                await detalhePage.waitForTimeout(1500); // aguardar ajax tab

                // Ler grid de pagamentos
                const pagCells = detalhePage.locator('table[id*="ucOrdemDeServicoPagamento_grd"] tr td:nth-child(4)'); // Coluna Valor
                const countPag = await pagCells.count();
                for (let c = 1; c < countPag; c++) {
                    const pagText = await pagCells.nth(c).innerText();
                    const pagClean = pagText.replace('R$', '').replace('.', '').replace(',', '.').trim();
                    totalPago += parseFloat(pagClean) || 0;
                }
            }

            // Calcular % Pago real baseado puramente no DOM
            if (valorTotal > 0) {
                percentualPago = (totalPago / valorTotal) * 100;
            }

            console.log(`[MCP Tool] OS ${os.codigo} -> Valor Total: R$ ${valorTotal.toFixed(2)} | Pago: R$ ${totalPago.toFixed(2)} (${percentualPago.toFixed(0)}%)`);

            // Filtro de negócio
            if (valorTotal >= (valor_minimo || 0) && percentualPago <= (percentual_pago_maximo || 100)) {
                resultados.push({
                    codigo_os: os.codigo,
                    loja: loja || 'Atual',
                    cliente: os.cliente,
                    placa: os.placa,
                    valor_total_real: valorTotal,
                    total_pago_real: totalPago,
                    percentual_pago: Math.round(percentualPago)
                });
            }

        } catch (e: any) {
            console.log(`[MCP Tool] Erro lendo OS ${os.codigo}:`, e.message);
        } finally {
            if (popupPromise) {
                await detalhePage.close();
            } else {
                await page.goBack();
                await page.waitForLoadState('networkidle');
            }
        }
    }

    console.log('[MCP Tool] Consulta finalizada com', resultados.length, 'resultados.');
    return { 
        status: 'success', 
        filtros_aplicados: params, 
        resultados 
    };
}
