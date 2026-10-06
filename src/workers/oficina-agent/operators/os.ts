import { Page } from 'playwright';
import { BusinessOperator, WorkflowResult } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import { ensureCompany } from '../playwright/actions/core.js';
import { setDateRange, exportToExcel } from '../playwright/utils/ux.js';
import { parseWebFormsExcel } from '../playwright/utils/parsing.js';

function parseWorkflowYaml(content: string) {
    const sourcePageMatch = content.match(/source_page:\s*"([^"]+)"/);
    const reportModeMatch = content.match(/report_mode:\s*"([^"]+)"/);
    const groupByMatch = content.match(/group_by:\s*"([^"]+)"/);
    
    // Simple state machine for status_groups
    const statusGroups: Record<string, string[]> = {
        abertas: [],
        fechadas: [],
        canceladas: []
    };
    
    // Column mapping for os_detalhada / os_mecanico
    const colMap: Record<string, number> = {};

    let currentGroup = '';
    let inFields = false;
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.startsWith('status_groups:')) {
            currentGroup = 'root';
            inFields = false;
            continue;
        }
        if (line.startsWith('fields:')) {
            inFields = true;
            currentGroup = '';
            continue;
        }
        if (inFields) {
            const colMatch = line.match(/^\s+col_(\w+):\s*(\d+)/);
            if (colMatch) {
                colMap[colMatch[1]] = parseInt(colMatch[2], 10);
            } else if (line.trim() !== '' && !line.startsWith(' ')) {
                inFields = false;
            }
        }
        if (currentGroup) {
            const groupMatch = line.match(/^  ([a-z]+):/);
            if (groupMatch) {
                currentGroup = groupMatch[1];
                if (!statusGroups[currentGroup]) statusGroups[currentGroup] = [];
            } else if (line.trim().startsWith('-')) {
                const statusStr = line.match(/-\s*"([^"]+)"/);
                if (statusStr && statusGroups[currentGroup]) {
                    statusGroups[currentGroup].push(statusStr[1].toUpperCase());
                }
            } else if (!line.trim().startsWith(' ') && line.trim() !== '') {
                currentGroup = ''; // end of block
            }
        }
    }

    return {
        source_page: sourcePageMatch ? sourcePageMatch[1] : null,
        report_mode: reportModeMatch ? reportModeMatch[1] : null,
        group_by: groupByMatch ? groupByMatch[1] : null,
        statusGroups,
        colMap
    };
}

export const os_handler: BusinessOperator = async (page: Page, params: any): Promise<WorkflowResult> => {
    const startTime = Date.now();
    // Default to status_snapshot if not provided (T7)
    const workflowId = params.workflow_id || params._workflowId || 'os.status_snapshot'; 
    const wfPath = path.resolve(`docs/workflows/${workflowId}.md`);

    if (!fs.existsSync(wfPath)) {
        throw new Error(`Workflow não encontrado: ${workflowId}`);
    }

    const mdContent = fs.readFileSync(wfPath, 'utf8');
    const config = parseWorkflowYaml(mdContent);

    console.log(`[Operador OS Debug] params.workflow_id: ${params.workflow_id}`);
    console.log(`[Operador OS Debug] workflowId usado: ${workflowId}`);
    console.log(`[Operador OS Debug] wfPath lido: ${wfPath}`);
    console.log(`[Operador OS Debug] config.report_mode parseado: ${config.report_mode}`);

    if (!config.source_page) {
        throw new Error(`YAML do workflow ${workflowId} não define source_page.`);
    }

    let status: 'success' | 'partial' | 'failed' | 'needs_clarification' = 'success';
    let result: any = null;
    let evidence: any = {};
    let meta: any = {
        duration_ms: 0,
        source_session: 'oficina-ondemand-profile',
        executor: `os.${config.report_mode}`,
        sanity_check: {}
    };

    try {
        const url = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
        console.log(`[Operador OS] Acessando ${config.source_page}`);
        await page.goto(`${url}/${config.source_page}`, { waitUntil: 'networkidle' });
        
        if (params.empresa) {
            await ensureCompany(page, params.empresa);
        }

        // UX Helper: Set dates and close calendar popups
        // Para o fluxo diário, usamos parâmetros específicos date_ontem e date_hoje no YAML? 
        // O teste T8 manda date_ontem e date_hoje, e T7 manda date_from e date_to.
        // O wfOrdemDeServicoBusca normalmente tem txtDataInicial e txtDataFinal que filtram a busca.
        if (config.report_mode === 'os_fluxo') {
            await setDateRange(page, params.date_ontem, params.date_hoje);
        } else {
            await setDateRange(page, params.date_from, params.date_to);
        }

        // Buscar para atualizar o HTML da grid!
        console.log(`[Operador OS] Clicando em Buscar para carregar a grid...`);
        await page.click('#ctl00_cph_btnBuscar', { force: true });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000); // Give grid time to render
        
        // Sanity Check: Contar as linhas da tabela renderizada na UI
        const rowsLocator = page.locator('#ctl00_cph_grd tbody tr:not(:first-child)');
        const rowCountHtml = await rowsLocator.count();
        meta.sanity_check.html_rows_count = rowCountHtml;
        console.log(`[Sanity] Encontradas ${rowCountHtml} linhas no HTML.`);

        // Substituindo a exportação de Excel por leitura direta do DOM
        // (Já que wfOrdemDeServicoBusca não possui botão de exportação)
        meta.sanity_check.excel_rows_count = rowCountHtml; 
        
        const rowsData = await rowsLocator.evaluateAll(trs => 
            trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
        );

        const statusColIdx = 10; // 'Status'
        const dataColIdx = 1;    // 'Data' (16/07/26 qui)

        if (config.report_mode === 'os_status') {
            let abertas = 0;
            let fechadas = 0;
            let canceladas = 0;

            for (const row of rowsData) {
                if (!row || row.length <= statusColIdx) continue;
                const rowStatus = String(row[statusColIdx] || '').toUpperCase().trim();
                
                if (config.statusGroups.abertas.includes(rowStatus)) abertas++;
                else if (config.statusGroups.fechadas.includes(rowStatus)) fechadas++;
                else if (config.statusGroups.canceladas.includes(rowStatus)) canceladas++;
            }

            result = {
                os_abertas: abertas,
                os_fechadas: fechadas,
                os_canceladas: canceladas
            };
        } else if (config.report_mode === 'os_fluxo') {
            let os_novas_ontem = 0;
            let os_novas_hoje = 0;

            // Converter date_ontem (YYYY-MM-DD) para formato da grid (DD/MM/YY)
            const fmtDate = (d: string) => {
                if (!d) return '';
                const parts = d.split('-');
                if (parts.length < 3) return '';
                return `${parts[2]}/${parts[1]}/${parts[0].substring(2)}`;
            };
            const strOntem = fmtDate(params.date_ontem);
            const strHoje = fmtDate(params.date_hoje);

            for (const row of rowsData) {
                if (!row || row.length <= dataColIdx) continue;
                const cellData = String(row[dataColIdx] || '').trim(); // ex: "16/07/26 qui"
                
                if (strOntem && cellData.startsWith(strOntem)) os_novas_ontem++;
                if (strHoje && cellData.startsWith(strHoje)) os_novas_hoje++;
            }

            result = {
                os_novas_ontem,
                os_novas_hoje
            };
        } else if (config.report_mode === 'os_detalhada' || config.report_mode === 'os_mecanico') {
            // Coluna defaults (caso o YAML não defina colMap)
            const cm = config.colMap;
            const cCodigo   = cm.codigo   ?? 0;
            const cVeiculo  = cm.veiculo  ?? 4;
            const cPlaca    = cm.placa    ?? 5;
            const cCliente  = cm.cliente  ?? 6;
            const cMecanico = cm.mecanico ?? 8;
            const cStatus   = cm.status   ?? 10;

            const osList: Array<Record<string, string>> = [];

            for (const row of rowsData) {
                if (!row || row.length < 3) continue; // pular linhas de paginação/vazias
                const codigo = String(row[cCodigo] || '').trim();
                if (!codigo || !/^\d+$/.test(codigo)) continue; // só linhas com código numérico

                osList.push({
                    codigo,
                    veiculo:  String(row[cVeiculo]  || '').trim(),
                    placa:    String(row[cPlaca]    || '').trim(),
                    cliente:  String(row[cCliente]  || '').trim(),
                    mecanico: String(row[cMecanico] || '').trim(),
                    status:   String(row[cStatus]   || '').trim(),
                });
            }

            if (config.report_mode === 'os_detalhada') {
                result = { os: osList };
            } else {
                // os_mecanico: agrupa por responsável
                const grouped: Record<string, number> = {};
                for (const entry of osList) {
                    const nome = entry.mecanico || 'SEM RESPONSÁVEL';
                    grouped[nome] = (grouped[nome] || 0) + 1;
                }
                const resumo_por_mecanico = Object.entries(grouped)
                    .sort((a, b) => b[1] - a[1])
                    .map(([mecanico, quantidade_os]) => ({ mecanico, quantidade_os }));

                result = { resumo_por_mecanico };
            }
        }

        meta.duration_ms = Date.now() - startTime;

        return {
            status,
            workflow_id: workflowId,
            source: 'oficina_ui_export',
            params,
            result,
            evidence,
            meta,
            freshness: { last_sync_at: new Date().toISOString(), is_current_enough: true }
        };

    } catch (e: any) {
        console.error(`[Operador OS] Erro na execução:`, e);
        meta.duration_ms = Date.now() - startTime;
        return {
            status: 'failed',
            workflow_id: workflowId,
            source: 'oficina_ui_export',
            params,
            result: null,
            evidence,
            meta,
            freshness: { last_sync_at: new Date().toISOString(), is_current_enough: false }
        };
    }
};
