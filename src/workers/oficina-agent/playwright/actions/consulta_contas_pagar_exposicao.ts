import { Page } from 'playwright';
import { ensureCompany } from './core.js';

export async function handleConsultaContasPagarExposicao(page: Page, params: any) {
  const { loja, fornecedor, plano_contas, vencimento_inicio, vencimento_fim } = params;

  if (!loja) throw new Error("Parâmetro 'loja' é obrigatório.");
  if (!vencimento_inicio || !vencimento_fim) throw new Error("Datas de vencimento são obrigatórias.");

  console.log(`[Contas Pagar] Iniciando consulta para ${loja}...`);

  // 1. Navegar para Busca de Contas a Pagar primeiro para garantir o header da Master Page
  console.log(`[Contas Pagar] Navegando para wfContaBuscaPagar.aspx...`);
  await page.goto('https://sistemaoficinainteligente.com.br/wfContaBuscaPagar.aspx', { waitUntil: 'networkidle' });

  // 2. Troca de empresa usando a infra do core
  const oldHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  await ensureCompany(page, loja);
  const newHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  
  if (oldHeader !== newHeader) {
      await page.goto('https://sistemaoficinainteligente.com.br/wfContaBuscaPagar.aspx', { waitUntil: 'networkidle' });
  }

  // 3. Preencher filtros
  console.log(`[Contas Pagar] Preenchendo filtros de Vencimento e Contas a Pagar...`);
  
  const formatarData = (dt: string) => {
    if (dt.includes('-')) {
        const [y, m, d] = dt.split('-');
        return `${d}/${m}/${y}`;
    }
    return dt;
  };

  // Datas
  await page.locator('#ctl00_cph_txtDataInicial').fill(formatarData(vencimento_inicio));
  await page.locator('#ctl00_cph_txtDataFinal').fill(formatarData(vencimento_fim));

  // Filtros opcionais
  if (fornecedor) {
      await page.locator('#ctl00_cph_txtNome').fill(fornecedor);
  }
  if (plano_contas) {
      await page.locator('#ctl00_cph_txtDescricaoPlanoDeConta').fill(plano_contas);
  }

  // Marcar a opção "Contas a Pagar" explicitamente
  await page.locator('#ctl00_cph_rblFiltroExibir_1').check();

  // Buscar
  console.log(`[Contas Pagar] Clicando em Buscar...`);
  await page.locator('#ctl00_cph_btnBuscar').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Dar tempo pro PostBack ASP.NET

  // 4. Extrair Contas da Grid
  console.log(`[Contas Pagar] Lendo grid de resultados...`);
  
  // A grid de contas a pagar tem um ID dinâmico, geralmente contém "grd"
  const linhas = await page.locator('table[id*="grd"] tr:not(:first-child):not(.pgr)').all();
  
  const contas = [];
  let totalEmAberto = 0;

  for (const linha of linhas) {
      const colunas = await linha.locator('td').allInnerTexts();
      // O formato das colunas depende do grid, mas geralmente:
      // [Documento, Vencimento, Fornecedor/Cliente, Histórico, Valor Original, Valor Pendente, Situação]
      // Vamos pegar todas as colunas de forma segura e tentar identificar o "Pendente"
      if (colunas.length > 5) {
          // Simplificação: vamos coletar o dado cru e tentar somar a última ou penúltima coluna que parecer dinheiro
          const rowData = colunas.map(c => c.trim());
          
          // Procurando valor pendente (geralmente uma das últimas colunas tem R$)
          let valorPend = 0;
          for (let i = rowData.length - 1; i >= 0; i--) {
              if (rowData[i].includes('R$') || !isNaN(parseFloat(rowData[i].replace('.', '').replace(',', '.')))) {
                  const num = parseFloat(rowData[i].replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
                  if (!isNaN(num)) {
                      valorPend = num;
                      break; // Pega o primeiro valor monetário de trás pra frente
                  }
              }
          }

          totalEmAberto += valorPend;
          contas.push({
              colunas_raw: rowData,
              valor_estimado_centavos: Math.round(valorPend * 100)
          });
      }
  }

  console.log(`[Contas Pagar] Total de ${contas.length} contas encontradas. Total Exposto: ${totalEmAberto}`);

  return {
    loja,
    filtros: { fornecedor, plano_contas, vencimento_inicio, vencimento_fim },
    total_contas: contas.length,
    total_em_aberto_centavos: Math.round(totalEmAberto * 100),
    detalhes: contas
  };
}
