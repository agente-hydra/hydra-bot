import { Page } from 'playwright';
import { JobParams } from '../../../types/index.js';
import { format } from 'date-fns';

export async function executeGetRevenue(page: Page, params: JobParams) {
  console.log(`[Action: get_revenue] Navegando para relatórios...`);

  // Exemplo de navegação para Dashboard Financeiro / Faturamento (Read-Only)
  // Como não temos certeza da tela exata sem o discovery profundo, 
  // simulamos a navegação de forma segura baseada nos seletores conhecidos.
  
  // Usando a mesma página de Gestão de Rede do script atual como base segura
  const url = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
  await page.goto(`${url}/wfRelatorioRede.aspx`, { waitUntil: 'networkidle' });

  // Garantir que a página carregou
  await page.waitForSelector('#chkEmpresaSelecao', { state: 'visible', timeout: 15000 });

  // Preencher datas se fornecido (usando MM/yyyy ou dd/MM/yyyy)
  // O input aceita dd/MM/yyyy
  const dataInicial = params.date_from ? format(new Date(params.date_from), 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy');
  const dataFinal = params.date_to ? format(new Date(params.date_to), 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy');

  await page.fill('#ctl00_cph_txtDataInicial', dataInicial).catch(() => {});
  await page.fill('#ctl00_cph_txtDataFinal', dataFinal).catch(() => {});

  // Em vez de baixar o Excel (que é lento e pesado), se a intenção é só consultar,
  // idealmente buscaríamos no Supabase (Fase 4). Mas como o Action de UI foi acionado,
  // vamos extrair um dado que esteja visível na tela (se existir o total em tabela).
  // Se não existir, deveríamos extrair o Excel. Para este template, vamos simular
  // uma leitura de um elemento de total na tela (se houvesse).

  const mockExtracted = {
    bruto: 0,
    normalizado: 0,
    moeda: 'BRL',
    periodo: `${dataInicial} - ${dataFinal}`,
    unidade: params.unit || 'Todas',
    fonte: 'oficina_ui_mock',
    qtd_os: 0,
    timestamp: new Date().toISOString()
  };

  return mockExtracted;
}
