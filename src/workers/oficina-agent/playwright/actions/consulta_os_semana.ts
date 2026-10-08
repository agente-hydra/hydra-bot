import { Page } from 'playwright';
import { ensureCompany } from './core.js';

export async function handleConsultaOSSemana(page: Page, params: any) {
  const { loja, status, data_inicio, data_fim } = params;

  if (!loja) throw new Error("Parâmetro 'loja' é obrigatório.");
  if (!data_inicio || !data_fim) throw new Error("Parâmetros 'data_inicio' e 'data_fim' são obrigatórios (para representar a semana).");

  console.log(`[OS da Semana] Iniciando consulta para ${loja} entre ${data_inicio} e ${data_fim}...`);

  // 1. Navegar para Busca de OS primeiro para garantir que o header está lá
  console.log(`[OS da Semana] Navegando para wfOrdemDeServicoBusca.aspx...`);
  await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });

  // 2. Troca de empresa usando a infra do core
  const oldHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  await ensureCompany(page, loja);
  const newHeader = await page.locator('#lblSiglaEmpresa').textContent().catch(() => '');
  
  if (oldHeader !== newHeader) {
      await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });
  }

  // 3. Limpar e Preencher filtros
  console.log(`[OS da Semana] Preenchendo datas e filtros...`);
  await page.locator('#ctl00_cph_btnLimpar').click();
  await page.waitForLoadState('networkidle');

  const formatarData = (dt: string) => {
    if (dt.includes('-')) {
        const [y, m, d] = dt.split('-');
        return `${d}/${m}/${y}`;
    }
    return dt;
  };

  await page.locator('#ctl00_cph_txtDataInicial').fill(formatarData(data_inicio));
  await page.locator('#ctl00_cph_txtDataFinal').fill(formatarData(data_fim));

  // Exibir Abertas e Fechadas para pegar o movimento real da semana, ou só o que estiver marcado?
  // O padrão do Oficina é vir com Abertas marcado. Vamos garantir as duas para movimento real.
  await page.locator('#ctl00_cph_chkExibirAberta').check();
  await page.locator('#ctl00_cph_chkExibirFechada').check();
  
  // Se houver status, o status no Oficina é uma lista de Checkboxes (EM DIAGNOSTICO, AGUARDANDO PEÇA, etc.)
  // Por simplicidade, vamos iterar as labels e marcar a que tiver o nome igual ou muito parecido.
  if (status) {
      console.log(`[OS da Semana] Marcando status: ${status}...`);
      const statusLabels = await page.locator('label[for^="ctl00_cph_cblStatusOrdemDeServico"]').all();
      for (const label of statusLabels) {
          const text = await label.textContent();
          if (text && text.trim().toUpperCase() === status.toUpperCase()) {
              const forAttr = await label.getAttribute('for');
              if (forAttr) {
                  await page.locator(`#${forAttr}`).check();
                  break;
              }
          }
      }
  }

  // Buscar
  console.log(`[OS da Semana] Clicando em Buscar...`);
  await page.locator('#ctl00_cph_btnBuscar').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Margem ASP.NET

  // 4. Lendo resultados da Grid Principal
  console.log(`[OS da Semana] Lendo grid de OS...`);
  const linhas = await page.locator('table[id*="grd"] tr:not(:first-child):not(.pgr)').all(); // Ignora header e paginação
  
  const ordens = [];
  let montanteTotal = 0;

  for (const linha of linhas) {
      // Lógica robusta baseada em IDs (que terminam com a string chave, pois o prefixo muda por linha)
      const os_id = await linha.locator('[id$="lkbOrdemDeServicoID"]').textContent().catch(() => '');
      if (os_id) {
          const data = await linha.locator('[id$="lblDataDeCadastro"]').textContent().catch(() => '');
          const veiculo = await linha.locator('[id$="lkbNomeDoVeiculo"]').textContent().catch(() => '');
          const placa = await linha.locator('[id$="lkbPlacaDoVeiculo"]').textContent().catch(() => '');
          const cliente = await linha.locator('[id$="lkbClienteNome"]').textContent().catch(() => '');
          const status_atual = await linha.locator('[id$="lblSigla"]').getAttribute('title').catch(() => status || '');
          
          ordens.push({
              os_id: os_id.trim(),
              data: data ? data.trim() : '',
              veiculo: veiculo ? veiculo.trim() : '',
              placa: placa ? placa.trim() : '',
              cliente: cliente ? cliente.trim() : '',
              status_atual: status_atual ? status_atual.trim() : ''
          });
      }
  }

  console.log(`[OS da Semana] Total de ${ordens.length} OSs encontradas.`);

  // Se o usuário pedir o montante parado, o subagente precisará usar a skill de detalhe da OS (ou abrimos o detalhe se o array for pequeno)
  // Por enquanto retornamos as infos estruturadas.

  return {
    loja,
    periodo: { data_inicio, data_fim },
    status_filtro: status || 'TODOS',
    total_os: ordens.length,
    detalhes: ordens,
    aviso: "O valor financeiro de cada OS exige entrar no detalhe. Use os IDs retornados para inspecionar os custos via CMV/Venda se necessário."
  };
}
