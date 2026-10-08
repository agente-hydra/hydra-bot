import { Page } from 'playwright';
import { JobEntry, JobParams } from '../../types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { detectAccessDenied } from '../playwright/session.js';
import { ensureCompany } from '../playwright/actions/core.js';

interface MappedAction {
  label: string;
  type: string;
  id: string;
}

interface MappedFilter {
  name: string;
  type: string;
  id: string;
}

interface MappedGrid {
  id: string;
  columns: Array<{ index: number; name: string }>;
  has_pagination: boolean;
  notes?: string;
}

interface MappedExport {
  has_excel: boolean;
  has_pdf: boolean;
  buttons_found: string[];
}

interface ScreenMap {
  screen: string;
  title: string;
  domain: string;
  mapped_at: string;
  actions: MappedAction[];
  filters: MappedFilter[];
  grid: MappedGrid | null;
  export: MappedExport;
}

export async function runScreenMapping(page: Page, job: JobEntry, params: JobParams): Promise<any> {
    const domain = params.domain;
    if (!domain) {
        throw new Error("Parâmetro 'domain' é obrigatório para map_screens.");
    }

    const domainsFilePath = path.resolve('docs/mapping/domains.json');
    if (!fs.existsSync(domainsFilePath)) {
        throw new Error("Arquivo domains.json não encontrado.");
    }

    const domainsData = JSON.parse(fs.readFileSync(domainsFilePath, 'utf-8'));
    const domainConfig = domainsData[domain];

    if (!domainConfig || !domainConfig.priority_screens) {
        throw new Error(`Domínio '${domain}' não encontrado ou sem priority_screens em domains.json.`);
    }

    const screensToMap: string[] = domainConfig.priority_screens;
    const oiUrl = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
    
    // Garantir que estamos em uma página base com o cabeçalho para trocar empresa
    await page.goto(`${oiUrl}/wfPrincipal.aspx`, { waitUntil: 'networkidle' });
    if (await detectAccessDenied(page)) throw new Error('access_denied');
    if (page.url().includes('login')) throw new Error('session_expired');

    // Garantir que a empresa certa está selecionada se houver params.empresa
    if (params.empresa) {
        await ensureCompany(page, params.empresa);
    }

    const screensDir = path.resolve('docs/app-map/screens');
    if (!fs.existsSync(screensDir)) {
        fs.mkdirSync(screensDir, { recursive: true });
    }

    const mappedFiles: string[] = [];
    let screensMapped = 0;

    for (const screen of screensToMap) {
        console.log(`[Screen Mapper] Mapeando tela: ${screen} (Domínio: ${domain})`);
        
        try {
            await page.goto(`${oiUrl}/${screen}`, { waitUntil: 'networkidle' });
            if (await detectAccessDenied(page)) throw new Error('access_denied');
            if (page.url().includes('login')) throw new Error('session_expired');

            // Dar um tempo extra para grids e scripts ASP.NET renderizarem
            await page.waitForTimeout(2000);

            const title = await page.title().catch(() => 'Sem Título');
            
            // 1 & 2. Extrair Ações e Filtros via evaluate com JS puro (string) para evitar que o TSX transpile e injete __name no browser
            const extracted: any = await page.evaluate(`
                (() => {
                    const actionsData = [];
                    const actionEls = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
                    for (let i = 0; i < actionEls.length; i++) {
                        const el = actionEls[i];
                        if (!el) continue;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || el.getBoundingClientRect().width === 0) continue;
                        
                        const cleanText = (el.textContent || el.value || '').trim();
                        const id = el.id || '';
                        if (cleanText || id) {
                            actionsData.push({ label: cleanText, type: 'button', id });
                        }
                    }

                    const filtersData = [];
                    const filterEls = document.querySelectorAll('input[type="text"], select, input[type="checkbox"], input[type="radio"]');
                    for (let i = 0; i < filterEls.length; i++) {
                        const el = filterEls[i];
                        if (!el) continue;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || el.getBoundingClientRect().width === 0) continue;
                        
                        const id = el.id || '';
                        const type = el.type || el.tagName.toLowerCase();
                        
                        let name = '';
                        if (id) {
                            const label = document.querySelector('label[for="' + id + '"]');
                            if (label) name = label.textContent || '';
                        }
                        if (!name && el.parentElement) {
                            name = el.parentElement.innerText || '';
                        }
                        name = name.trim();

                        filtersData.push({
                            name: name || id,
                            type: type === 'select-one' || type === 'select-multiple' ? 'select' : type,
                            id
                        });
                    }

                    return { actions: actionsData, filters: filtersData };
                })()
            `);

            const actions: MappedAction[] = extracted.actions;
            const filters: MappedFilter[] = extracted.filters;

            // 3. Extrair Grid
            let gridInfo: MappedGrid | null = null;
            const gridLocators = await page.locator('table.grid, table[id*="grd"], table[id*="gv"]').all();
            if (gridLocators.length > 0) {
                 const mainGrid = gridLocators[0]; // Pega a primeira que costuma ser a principal
                 const gridId = await mainGrid.getAttribute('id').catch(() => '') || '';
                 
                 const columns: Array<{ index: number; name: string }> = [];
                 const ths = await mainGrid.locator('th').all();
                 let colIndex = 0;
                 for (const th of ths) {
                     const text = await th.textContent().catch(() => '');
                     const cleanText = (text || '').trim().replace(/\n/g, ' ');
                     if (cleanText) {
                         columns.push({ index: colIndex, name: cleanText });
                     }
                     colIndex++;
                 }

                 const hasPagination = await mainGrid.locator('tr.pager, tr.grid-pager, a[href*="Page$"]').count() > 0;
                 
                 let gridNotes = domainConfig[`_note_${screen.split('.')[0]}`] || domainConfig[`_note_${domain.toLowerCase()}`] || undefined;

                 gridInfo = {
                     id: gridId,
                     columns: columns,
                     has_pagination: hasPagination,
                     notes: gridNotes
                 };
            }

            // 4. Detectar Exports
            const exportButtonsFound = actions.filter(a => ['excel', 'pdf', 'exportar', 'baixar'].some(exp => a.label.toLowerCase().includes(exp) || a.id.toLowerCase().includes(exp)));
            const exportInfo: MappedExport = {
                has_excel: exportButtonsFound.some(a => a.label.toLowerCase().includes('excel') || a.id.toLowerCase().includes('excel')),
                has_pdf: exportButtonsFound.some(a => a.label.toLowerCase().includes('pdf') || a.id.toLowerCase().includes('pdf')),
                buttons_found: exportButtonsFound.map(a => a.id || a.label)
            };

            // Construir JSON final
            const screenMap: ScreenMap = {
                screen: screen,
                title: title,
                domain: domain,
                mapped_at: new Date().toISOString(),
                actions: actions,
                filters: filters,
                grid: gridInfo,
                export: exportInfo
            };

            const slug = screen.replace(/[^a-zA-Z0-9]/g, '_');
            const filePath = path.join(screensDir, `${slug}.json`);
            fs.writeFileSync(filePath, JSON.stringify(screenMap, null, 2));
            mappedFiles.push(filePath);
            screensMapped++;

        } catch (e: any) {
            console.error(`[Screen Mapper] Erro ao mapear tela ${screen}:`, e.message);
            if (e.message === 'session_expired' || e.message === 'access_denied') {
                throw e; // Interrompe mapeamento se for erro crítico de sessão
            }
        }
    }

    // FASE 2: Mapeamento de Telas de Detalhe (ex: wfOrdemDeServico.aspx)
    if (domainConfig.detail_screens && domainConfig.detail_screens.length > 0) {
        for (const detailScreen of domainConfig.detail_screens) {
            console.log(`[Screen Mapper] Mapeando tela de DETALHE: ${detailScreen} (Domínio: ${domain})`);
            
            try {
                if (detailScreen === 'wfOrdemDeServico.aspx') {
                    // 1. Ir para a tela de busca de OS
                    await page.goto(`${oiUrl}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'networkidle' });
                    if (await detectAccessDenied(page)) throw new Error('access_denied');
                    if (page.url().includes('login')) throw new Error('session_expired');
                    
                    // 2. Dar um tempo pra grid renderizar (fazer busca se necessário, mas o padrão geralmente já lista as recentes)
                    await page.waitForTimeout(3000);
                    
                    // Procurar botão de pesquisa para forçar trazer algo, ou link de OS diretamente
                    const lkbOrdem = page.locator('a[id*="lkbOrdemDeServicoID"]').first();
                    if (await lkbOrdem.count() === 0) {
                        const btnBuscar = page.locator('input[id*="btnBuscar"], a[id*="btnBuscar"], button[id*="btnBuscar"]').first();
                        if (await btnBuscar.count() > 0) {
                            await btnBuscar.click();
                            await page.waitForTimeout(4000);
                        }
                    }

                    if (await lkbOrdem.count() === 0) {
                        console.log(`[Screen Mapper] Nenhuma OS listada na busca para conseguir abrir o detalhe.`);
                        continue;
                    }

                    // 3. Preparar listener de popup e clicar na primeira OS
                    console.log(`[Screen Mapper] Clicando no link da OS para abrir o detalhe...`);
                    
                    let popupPage: Page = page; // fallback para a mesma pagina
                    let isPopup = false;
                    
                    try {
                        const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
                        await lkbOrdem.click();
                        popupPage = await popupPromise;
                        isPopup = true;
                    } catch (e) {
                        console.log(`[Screen Mapper] OS não abriu em popup, usando a aba atual.`);
                        await page.waitForLoadState('networkidle');
                    }
                    
                    // Aguardar o carregamento completo do detalhe
                    await popupPage.waitForLoadState('domcontentloaded');
                    await popupPage.waitForTimeout(3000); // tempo extra pra WebForms carregar as abas
                    
                    const title = await popupPage.title().catch(() => 'Sem Título');
                    
                    // 4. Executar extração de Header, Tabs, Grids e Actions
                    const extracted: any = await popupPage.evaluate(`
                        (() => {
                            // Extrair Header (IDs de campos prováveis)
                            const headerInfo = {};
                            const possibleHeaderIds = ['txtCliente', 'txtVeiculo', 'ddlStatus', 'txtCodigo', 'lblNumero'];
                            const allElements = document.querySelectorAll('input, select, span, div');
                            
                            for (let i = 0; i < allElements.length; i++) {
                                const el = allElements[i];
                                const id = el.id || '';
                                if (!id) continue;
                                
                                for (const key of possibleHeaderIds) {
                                    if (id.includes(key)) {
                                        headerInfo[key] = id;
                                    }
                                }
                            }

                            // Extrair Tabs
                            const tabsData = [];
                            // WebForms geralmente usa ul.ajax__tab_header ou botões/divs como abas
                            const tabHeaders = document.querySelectorAll('.ajax__tab_header span.ajax__tab_tab, [id*="TabPanel"] .ajax__tab_tab, .nav-tabs li a');
                            
                            if (tabHeaders.length > 0) {
                                for (let i = 0; i < tabHeaders.length; i++) {
                                    const el = tabHeaders[i];
                                    const label = (el.innerText || el.textContent || '').trim();
                                    const id = el.id || el.closest('[id]')?.id || '';
                                    if (label) {
                                        tabsData.push({ id, label });
                                    }
                                }
                            } else {
                                // Fallback: procurar fieldsets ou seções grandes se não houver abas reais
                                const fieldsets = document.querySelectorAll('fieldset legend');
                                for (let i = 0; i < fieldsets.length; i++) {
                                    const label = (fieldsets[i].innerText || fieldsets[i].textContent || '').trim();
                                    if (label) tabsData.push({ id: '', label });
                                }
                            }

                            // Extrair Grids Principais (Peças, Serviços, etc)
                            const gridsData = [];
                            const grids = document.querySelectorAll('table.grid, table[id*="grd"], table[id*="gv"]');
                            for (let i = 0; i < grids.length; i++) {
                                const mainGrid = grids[i];
                                const style = window.getComputedStyle(mainGrid);
                                // if (style.display === 'none' || style.visibility === 'hidden') continue; // Podemos querer mapear msm escondido em tabs
                                
                                const gridId = mainGrid.id || '';
                                const columns = [];
                                const ths = mainGrid.querySelectorAll('th');
                                let colIndex = 0;
                                for (let j = 0; j < ths.length; j++) {
                                    const th = ths[j];
                                    const cleanText = (th.innerText || th.textContent || '').trim().replace(/\\n/g, ' ');
                                    if (cleanText) {
                                        columns.push({ index: colIndex, name: cleanText });
                                    }
                                    colIndex++;
                                }
                                
                                if (columns.length > 0) {
                                    // Tentar adivinhar de qual tab essa grid pertence, vendo o pai
                                    const closestTab = mainGrid.closest('.ajax__tab_panel, .tab-pane, fieldset');
                                    const parentId = closestTab ? closestTab.id : '';
                                    gridsData.push({ id: gridId, columns, parentId });
                                }
                            }

                            // Extrair Actions
                            const actionsData = [];
                            const actionEls = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
                            for (let i = 0; i < actionEls.length; i++) {
                                const el = actionEls[i];
                                const style = window.getComputedStyle(el);
                                if (style.display === 'none' || style.visibility === 'hidden' || el.getBoundingClientRect().width === 0) continue;
                                
                                const cleanText = (el.textContent || el.value || '').trim();
                                const id = el.id || '';
                                if (cleanText || id) {
                                    actionsData.push({ label: cleanText, type: 'button', id });
                                }
                            }

                            return { header: headerInfo, tabs: tabsData, grids: gridsData, actions: actionsData };
                        })()
                    `);
                    
                    const screenMap = {
                        screen: detailScreen,
                        title: title,
                        domain: domain,
                        mapped_at: new Date().toISOString(),
                        header: extracted.header,
                        tabs: extracted.tabs,
                        grids: extracted.grids,
                        actions: extracted.actions
                    };

                    const slug = detailScreen.replace(/[^a-zA-Z0-9]/g, '_');
                    const filePath = path.join(screensDir, `${slug}.json`);
                    fs.writeFileSync(filePath, JSON.stringify(screenMap, null, 2));
                    mappedFiles.push(filePath);
                    screensMapped++;

                    // Fechar popup ou voltar
                    if (isPopup) {
                        await popupPage.close();
                    } else {
                        await page.goBack();
                    }
                } else {
                    console.log(`[Screen Mapper] Nenhuma lógica específica implementada para a tela de detalhe: ${detailScreen}`);
                }
            } catch (e: any) {
                console.error(`[Screen Mapper] Erro ao mapear tela de DETALHE ${detailScreen}:`, e.message);
                if (e.message === 'session_expired' || e.message === 'access_denied') {
                    throw e; 
                }
            }
        }
    }

    return {
        domain: domain,
        screens_mapped: screensMapped,
        files: mappedFiles
    };
}
