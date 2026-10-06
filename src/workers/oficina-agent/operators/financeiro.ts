import { Page } from 'playwright';
import { BusinessOperator, WorkflowResult } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';

export const faturamento_por_periodo: BusinessOperator = async (page: Page, params: any): Promise<WorkflowResult> => {
    const startTime = Date.now();
    const workflowId = 'financeiro.faturamento_rede';
    const wfPath = path.resolve(`docs/workflows/${workflowId}.md`);

    // Validação do Catálogo
    if (!fs.existsSync(wfPath)) {
        throw new Error(`Workflow não encontrado: ${workflowId}`);
    }

    const mdContent = fs.readFileSync(wfPath, 'utf8');
    if (!mdContent.includes('status: approved') && !mdContent.includes('status: validated')) {
        throw new Error(`Workflow ${workflowId} não está aprovado ou validado para execução.`);
    }

    const requiresEmpresa = mdContent.includes('empresa:') && mdContent.includes('required: true');
    const isNetworkParam = params.empresa === 'network';
    
    if (requiresEmpresa && !params.empresa) {
        return {
            status: 'needs_clarification',
            workflow_id: workflowId,
            source: 'oficina_ui_export',
            params,
            result: null,
            evidence: {},
            meta: {
                duration_ms: Date.now() - startTime,
                source_session: 'oficina-ondemand-profile',
                executor: 'financeiro.faturamento_por_periodo',
                reason: 'empresa_missing'
            }
        };
    }

    let status: 'success' | 'partial' | 'failed' | 'needs_clarification' = 'success';
    let result: any = null;
    let evidence: any = {};
    let isSupabase = false;

    try {
        if (!isSupabase) {
            console.log(`[Operador] Consultando dados na UI para ${workflowId}`);
            
            const url = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
            
            let faturamento = 0;
            let qtdOs = 0;
            let source_page = '';

            const tempDir = path.resolve('./temp-roi');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            if (isNetworkParam) {
                // FLUXO NETWORK: Mantém a extração via Relatório de Rede (Mídia)
                source_page = 'wfRelatorioRede.aspx';
                console.log(`[Operador] Acessando ${source_page}`);
                await page.goto(`${url}/${source_page}`, { waitUntil: 'networkidle' });
                
                await page.waitForSelector('#chkEmpresaSelecao', { state: 'visible', timeout: 15000 });
                const empresaMainCheckbox = page.locator('#chkEmpresaSelecao');
                if (await empresaMainCheckbox.isVisible() && !await empresaMainCheckbox.isChecked()) {
                  await empresaMainCheckbox.check({ force: true });
                  await page.waitForTimeout(1000);
                }

                const excelLabel = page.locator('label:has-text("excel")').first();
                if (await excelLabel.isVisible()) {
                  await excelLabel.click({ force: true });
                }

                if (params.date_from) await page.fill('#ctl00_cph_txtDataInicial', params.date_from.split('-').reverse().join('/'));
                if (params.date_to) await page.fill('#ctl00_cph_txtDataFinal', params.date_to.split('-').reverse().join('/'));

                console.log('[Operador] Aguardando download (Rede)...');
                const [download] = await Promise.all([
                  page.waitForEvent('download', { timeout: 45000 }),
                  page.click('#ctl00_cph_btnRedePesquisaDeMidia')
                ]);

                const filePath = path.join(tempDir, `operador_${Date.now()}.xls`);
                await download.saveAs(filePath);
                
                const workbook = xlsx.readFile(filePath);
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const headerRow = rows[1] as string[];
                const totalColIdx = headerRow.findIndex(h => String(h).toUpperCase() === 'TOTAL');
                const qtdOsColIdx = headerRow.findIndex(h => String(h).toLowerCase().includes('qtd'));
              
                for (const row of rows) {
                  const label = String(row[0] || '').toUpperCase().trim();
                  if (label.includes('CENTRAL DE ATENDIMENTO') || label.includes('GOOGLE')) {
                    const fat = parseFloat(String(row[totalColIdx]).replace(',', '.') || '0') || 0;
                    const os  = parseInt(String(row[qtdOsColIdx]).replace(',', '.') || '0', 10) || 0;
                    faturamento += fat;
                    qtdOs       += os;
                  }
                }
                
                fs.unlinkSync(filePath);
                evidence = { export_file: filePath };
            } else {
                // FLUXO SINGLE: Navega para Relatório de Operação e extrai "Vendas por Dia"
                source_page = 'wfRelatorioOperacao.aspx';
                console.log(`[Operador] Acessando ${source_page}`);
                await page.goto(`${url}/${source_page}`, { waitUntil: 'networkidle' });
                
                if (params.empresa) {
                    const { ensureCompany } = await import('../playwright/actions/core.js');
                    await ensureCompany(page, params.empresa);
                }

                if (params.date_from) await page.fill('#ctl00_cph_txtDataInicial', params.date_from.split('-').reverse().join('/'));
                if (params.date_to) await page.fill('#ctl00_cph_txtDataFinal', params.date_to.split('-').reverse().join('/'));
                await page.keyboard.press('Escape'); // Fechar calendário
                
                // Forçar exportação para excel
                const excelLabel = page.locator('label[for="ctl00_cph_rblFormato_1"]');
                if (await excelLabel.isVisible()) {
                  await excelLabel.click({ force: true });
                }

                console.log('[Operador] Aguardando download (Operacao)...');
                const [download] = await Promise.all([
                  page.waitForEvent('download', { timeout: 45000 }),
                  page.click('#ctl00_cph_btnVendasPorDia', { force: true })
                ]);

                const filePath = path.join(tempDir, `operador_single_${Date.now()}.xls`);
                await download.saveAs(filePath);
                
                const workbook = xlsx.readFile(filePath);
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                
                // Encontrar cabeçalho
                let headerIdx = -1;
                for (let i = 0; i < Math.min(10, rows.length); i++) {
                    if (rows[i].some(c => String(c).toUpperCase().includes('FATURAMENTO'))) {
                        headerIdx = i;
                        break;
                    }
                }
                
                if (headerIdx !== -1) {
                    const headers = rows[headerIdx].map(String);
                    const fatColIdx = headers.findIndex(h => h.toUpperCase().includes('FATURAMENTO'));
                    const osColIdx = headers.findIndex(h => h.toUpperCase().includes('QTD. DE OS') || h.toUpperCase().includes('QTD. DE OS'));
                    
                    // Procurar linha de total (Total do MÊS: ou Total 2ª Quinzena :)
                    let totalRow = null;
                    for (let i = rows.length - 1; i > headerIdx; i--) {
                        if (String(rows[i][1] || '').toUpperCase().includes('TOTAL')) {
                            totalRow = rows[i];
                            break;
                        }
                    }
                    
                    if (totalRow) {
                        faturamento = parseFloat(String(totalRow[fatColIdx]).replace(',', '.') || '0') || 0;
                        qtdOs = parseInt(String(totalRow[osColIdx]).replace(',', '.') || '0', 10) || 0;
                    }
                }

                fs.unlinkSync(filePath);
                evidence = { export_file: filePath };
            }

            result = {
                faturamento,
                quantidade_os: qtdOs,
                ticket_medio: qtdOs > 0 ? faturamento / qtdOs : 0,
            };

            // Metadado extra p/ debug (source_page e sanity info omitidos pois a tela n renderiza o html, vai direto p/ Excel/PDF)
            // Sanity Check será o próprio Excel!
        }

        return {
            status,
            workflow_id: workflowId,
            source: isSupabase ? 'supabase' : 'oficina_ui_export',
            params,
            result,
            evidence,
            meta: {
                duration_ms: Date.now() - startTime,
                source_session: 'oficina-ondemand-profile',
                executor: 'financeiro.faturamento_por_periodo'
            },
            freshness: {
                last_sync_at: new Date().toISOString(),
                is_current_enough: true 
            }
        };

    } catch (e: any) {
        console.error(`[Operador] Erro na execução do workflow ${workflowId}:`, e);
        return {
            status: 'failed',
            workflow_id: workflowId,
            source: 'oficina_ui_export',
            params,
            result: null,
            evidence: {},
            meta: {
                duration_ms: Date.now() - startTime,
                source_session: 'oficina-ondemand-profile',
                executor: 'financeiro.faturamento_por_periodo'
            },
            freshness: {
                last_sync_at: new Date().toISOString(),
                is_current_enough: false
            }
        };
    }
};
