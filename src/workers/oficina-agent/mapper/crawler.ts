import { Page } from 'playwright';
import { JobEntry, JobParams } from '../../types/index.js';
import { AppMapBuilder } from './app-map-builder.js';
import { capturePageEvidence } from './snapshot.js';
import { isBlockedAction, classifyPostBack, extractTableColumns } from './extractor.js';
import { detectAccessDenied } from '../playwright/session.js';
import { CrawlerState, PageNode, ActionInfo, FilterInfo } from './types.js';
import { extractSeedsFromHeader, Seed } from './header-seeds.js';
import * as crypto from 'crypto';

export async function runDomainMapping(page: Page, job: JobEntry, params: JobParams): Promise<any> {
    const seedUrls = params.seed_urls || ['/wfPainel.aspx'];
    const maxDepth = params.max_depth || 4;
    const maxPages = params.max_pages || 60;
    const resume = params.resume !== false;

    let domainName = 'app_root';
    let usedSeeds: Seed[] = [];

    if (params.use_header_seeds) {
        usedSeeds = extractSeedsFromHeader(params.domains);
        if (usedSeeds.length > 0) {
            console.log(`[Crawler] Sementes extraídas do header.json: ${usedSeeds.length}`);
            if (params.domains && params.domains.length > 0) {
                domainName = params.domains.join('_').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            } else {
                domainName = 'full_app';
            }
        } else {
            console.warn(`[Crawler] AVISO: use_header_seeds=true mas nenhuma semente encontrada para domínios: ${params.domains}`);
        }
    } else {
        domainName = seedUrls[0].replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
    }
    
    const builder = new AppMapBuilder(domainName);
    let state: CrawlerState = {
        domain: domainName,
        pending_queue: [],
        visited_nodes: [],
        depth_map: {},
        last_updated_at: new Date().toISOString(),
        app_map: { domain: domainName, generated_at: new Date().toISOString(), pages: [] }
    };

    if (resume) {
        const loaded = builder.loadPartialState();
        if (loaded) {
            state = loaded;
            console.log(`[Crawler] Retomando BFS. Fila pendente: ${state.pending_queue.length}, Visitados: ${state.visited_nodes.length}`);
        } else {
            if (usedSeeds.length > 0) {
                usedSeeds.forEach(s => state.pending_queue.push({ url: s.url_hint || '/wfRelatorioRede.aspx', postback_target: s.postback_target_hint, depth: 0 }));
            } else {
                seedUrls.forEach(url => state.pending_queue.push({ url, postback_target: null, depth: 0 }));
            }
        }
    } else {
        if (usedSeeds.length > 0) {
            usedSeeds.forEach(s => state.pending_queue.push({ url: s.url_hint || '/wfRelatorioRede.aspx', postback_target: s.postback_target_hint, depth: 0 }));
        } else {
            seedUrls.forEach(url => state.pending_queue.push({ url, postback_target: null, depth: 0 }));
        }
    }

    const oiUrl = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
    let pagesMapped = 0;
    let exportButtonsFound = 0;

    // BFS Loop Principal
    while (state.pending_queue.length > 0 && state.app_map.pages.length < maxPages) {
        const currentNode = state.pending_queue.shift()!;
        
        if (currentNode.depth > maxDepth) continue;

        try {
            console.log(`[Crawler] Visitando -> URL: ${currentNode.url} | PostBack: ${currentNode.postback_target || 'N/A'} | Depth: ${currentNode.depth}`);
            
            // Navega fisicamente para URL base e aguarda ASP.NET
            await page.goto(`${oiUrl}${currentNode.url.startsWith('/') ? '' : '/'}${currentNode.url}`, { waitUntil: 'networkidle' });
            
            if (await detectAccessDenied(page)) throw new Error('access_denied');
            if (page.url().includes('login')) throw new Error('session_expired');

            if (currentNode.postback_target) {
                const pbLocator = page.locator(`[href*="__doPostBack('${currentNode.postback_target}'"], [name="${currentNode.postback_target}"], #${currentNode.postback_target.replace(/\$/g, '\\$')}`).first();
                if (await pbLocator.isVisible()) {
                    await pbLocator.click();
                    await page.waitForTimeout(2000); 
                    await page.waitForLoadState('networkidle');
                } else {
                    console.log(`[Crawler] Ignorado: Alvo de postback não visível: ${currentNode.postback_target}`);
                    continue; 
                }
                if (await detectAccessDenied(page)) throw new Error('access_denied');
                if (page.url().includes('login')) throw new Error('session_expired');
            }

            const title = await page.title().catch(() => 'Sem Título');
            const hashId = crypto.createHash('md5').update(currentNode.url + (currentNode.postback_target||'') + title).digest('hex');
            
            if (state.visited_nodes.includes(hashId)) {
                continue; // Evita loop em postbacks que não alteram estado estrutural real
            }
            
            state.visited_nodes.push(hashId);
            state.depth_map[hashId] = currentNode.depth;

            // Extrair Evidência e Metadados DOM
            const evidence = await capturePageEvidence(page, job.id, currentNode.url, currentNode.postback_target);
            
            const tableColumns = await extractTableColumns(page);
            const linksDiscovered: string[] = [];
            const postbacksDiscovered: string[] = [];
            const actions: ActionInfo[] = [];
            let paginationDetected = false;
            let sortableColumns: string[] = [];

            const locators = await page.locator('a, button, input[type="button"], input[type="submit"]').all();
            for (const loc of locators) {
                const text = await loc.textContent().catch(() => '') || await loc.getAttribute('value').catch(() => '') || '';
                const cleanText = text.trim();
                const href = await loc.getAttribute('href').catch(() => '');
                
                const { blocked, requires_human_review } = await isBlockedAction(cleanText);

                if (href && href.includes('__doPostBack')) {
                    const match = href.match(/__doPostBack\('([^']+)'/);
                    if (match && match[1]) {
                        const target = match[1];
                        const classif = await classifyPostBack(loc, target, cleanText);
                        
                        if (classif === 'in_page_control') {
                            paginationDetected = true;
                            if (target.includes('Sort$')) sortableColumns.push(cleanText);
                        } else if (!blocked) {
                            postbacksDiscovered.push(target);
                            actions.push({ label: cleanText, type: 'postback', target, requires_human_review });
                            state.pending_queue.push({ url: currentNode.url, postback_target: target, depth: currentNode.depth + 1 });
                        }
                    }
                } else if (href && href.startsWith('/')) {
                    linksDiscovered.push(href);
                    state.pending_queue.push({ url: href, postback_target: null, depth: currentNode.depth + 1 });
                } else if (cleanText) {
                    const type = ['exportar', 'excel', 'csv'].some(x => cleanText.toLowerCase().includes(x)) ? 'export' : 'unknown';
                    if (type === 'export') exportButtonsFound++;
                    actions.push({ label: cleanText, type, requires_human_review: blocked || requires_human_review });
                }
            }

            const pageNode: PageNode = {
                url: currentNode.url,
                postback_target: currentNode.postback_target,
                title, breadcrumb: [], filters: [],
                table_columns: tableColumns,
                actions,
                links_discovered: [...new Set(linksDiscovered)],
                postbacks_discovered: [...new Set(postbacksDiscovered)],
                pagination_detected: paginationDetected,
                sortable_columns: [...new Set(sortableColumns)],
                snapshot_ref: evidence.snapshot_ref,
                screenshot_ref: evidence.screenshot_ref,
                confidence: 'discovered'
            };

            state.app_map.pages.push(pageNode);
            pagesMapped++;

            // Resiliência de longa duração
            if (pagesMapped % 5 === 0) {
                builder.savePartialState(state);
            }

        } catch (e: any) {
             if (e.message === 'session_expired') {
                 console.warn(`[Crawler] Sessão expirada no meio do BFS! Salvando partial...`);
                 builder.savePartialState(state);
                 job.status = 'partial'; 
                 throw e; 
             }
             console.error(`[Crawler] Erro processando nó:`, e);
        }
    }

    builder.promoteToFinal(state);
    
    return {
        pages_discovered: state.visited_nodes.length,
        pages_mapped: pagesMapped,
        new_export_buttons_found: exportButtonsFound,
        app_map_path: builder['finalPath'], // Accessor workaround
        reached_max_pages: state.app_map.pages.length >= maxPages,
        used_seeds: usedSeeds
    };
}
