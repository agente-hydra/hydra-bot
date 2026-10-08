import { Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface HeaderMenuNode {
    label: string;
    role?: string;
    path_hint?: string;
    children: SubmenuNode[];
    notes?: string;
    aria_snapshot?: string;
}

export interface SubmenuNode {
    label: string;
    type: 'link' | 'postback' | 'button' | 'unknown';
    url_hint: string | null;
    postback_target_hint: string | null;
}

const KNOWN_TOP_LEVEL_MENUS = [
    'Visão Geral',
    'Financeiro',
    'Ordens de Serviço',
    'OS',
    'Agenda',
    'Estoque',
    'Relatórios',
    'Relatório',
    'Faturamento',
    'Configurações',
    'Configuração',
    'Clientes',
    'Parametrização',
    'Utilitários'
];

export async function runHeaderMapping(page: Page, job: any, params: any) {
    console.log(`[Header Crawler] Iniciando mapeamento do header na URL: ${page.url()}`);
    
    // Garantir que estamos numa página com menu principal (ex: wfRelatorioRede.aspx)
    if (!page.url().includes('wfRelatorioRede.aspx') && !page.url().toLowerCase().includes('dashboard')) {
        console.log(`[Header Crawler] Navegando para a dashboard para mapear o menu...`);
        await page.goto('https://sistemaoficinainteligente.com.br/wfRelatorioRede.aspx', { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000); // Aguardar menu renderizar completamente
    }

    const appMapDir = path.resolve('docs/app-map');
    if (!fs.existsSync(appMapDir)) fs.mkdirSync(appMapDir, { recursive: true });

    const menuTree: HeaderMenuNode[] = [];

    // Tentar localizar os itens de primeiro nível do menu
    for (const label of KNOWN_TOP_LEVEL_MENUS) {
        // Encontra o elemento mais profundo que contém exatamente o texto (geralmente a tag <a> ou <span>)
        const candidates = page.getByText(label, { exact: true });
        
        const count = await candidates.count();
        if (count === 0) continue;

        for (let i = 0; i < count; i++) {
            const innerEl = candidates.nth(i);
            
            // Verifica se está visível
            if (!await innerEl.isVisible().catch(() => false)) continue;

            // Se for um span ou a, tentamos pegar o pai (li) se ele for o verdadeiro contêiner com hover
            // Mas o hover no elemento de texto costuma ser suficiente
            const el = innerEl;

            const tagName = await el.evaluate(e => e.tagName.toLowerCase());
            const role = await el.getAttribute('role') || tagName;
            
            // O href pode estar no próprio elemento ou no pai se for <span> dentro de <a>
            let href = await el.getAttribute('href');
            if (!href && tagName !== 'a') {
                 href = await el.evaluate(e => e.closest('a')?.getAttribute('href') || null);
            }
            
            const menuNode: HeaderMenuNode = {
                label: label,
                role: role,
                path_hint: href || undefined,
                children: []
            };

            console.log(`[Header Crawler] Encontrou nó primário: ${label}. Fazendo hover...`);
            
            try {
                await el.hover({ force: true, timeout: 5000 });
                // Aguarda um tempo para animações CSS/JS abrirem o submenu
                await page.waitForTimeout(1500);

                // Busca elementos que recém ficaram visíveis (frequentemente listas ou divs de submenu)
                // Vamos extrair todos os links visíveis que não são o próprio menu principal
                // Para ser mais preciso, pegaremos <a> ou elementos com onclick que estejam visíveis agora.
                
                const submenuLinks = page.locator('a, [onclick*="__doPostBack"]');
                const linkCount = await submenuLinks.count();
                
                let foundChildren = false;

                for (let j = 0; j < linkCount; j++) {
                    const subEl = submenuLinks.nth(j);
                    if (!await subEl.isVisible().catch(() => false)) continue;

                    const subText = (await subEl.textContent() || '').trim();
                    if (!subText || subText.toLowerCase() === label.toLowerCase()) continue;

                    // Filtramos labels já conhecidas para não mapear outros top-levels como filhos acidentalmente
                    if (KNOWN_TOP_LEVEL_MENUS.some(k => subText.toLowerCase() === k.toLowerCase())) continue;

                    const subHref = await subEl.getAttribute('href');
                    const onclick = await subEl.getAttribute('onclick') || '';
                    
                    let type: 'link' | 'postback' | 'button' | 'unknown' = 'link';
                    let postbackTarget: string | null = null;

                    if (onclick.includes('__doPostBack')) {
                        type = 'postback';
                        const match = onclick.match(/__doPostBack\(['"]([^'"]+)['"]/);
                        if (match) postbackTarget = match[1];
                    } else if (!subHref || subHref === '#') {
                        type = 'button';
                    }

                    // Evitar duplicados (vários links com mesmo texto no DOM)
                    if (!menuNode.children.some(c => c.label === subText)) {
                        menuNode.children.push({
                            label: subText,
                            type: type,
                            url_hint: subHref,
                            postback_target_hint: postbackTarget
                        });
                        foundChildren = true;
                    }
                }

                if (!foundChildren) {
                    menuNode.notes = "submenu not visible on hover or empty";
                } else {
                    // Tentativa de snapshot ARIA da página/menu após o hover
                    try {
                        const snapshot = await page.accessibility.snapshot();
                        if (snapshot) {
                            menuNode.aria_snapshot = JSON.stringify(snapshot);
                        }
                    } catch (e) {
                        menuNode.notes = (menuNode.notes ? menuNode.notes + " | " : "") + "Failed to capture ARIA snapshot";
                    }
                }
            } catch (err: any) {
                console.error(`[Header Crawler] Falha ao fazer hover em ${label}:`, err.message);
                menuNode.notes = "hover failed";
            }

            // Move o mouse para fora para fechar o submenu antes do próximo
            await page.mouse.move(0, 0);
            await page.waitForTimeout(500);

            // Se for duplicado de label, ignorar ou agregar
            if (!menuTree.some(m => m.label === label)) {
                menuTree.push(menuNode);
            }
            break; // Só analisa o primeiro de cada label que estiver visível
        }
    }

    const outputJson = {
        generated_at: new Date().toISOString(),
        menus: menuTree
    };

    const targetPath = path.join(appMapDir, 'header.json');
    fs.writeFileSync(targetPath, JSON.stringify(outputJson, null, 2));
    
    console.log(`[Header Crawler] Mapeamento de header concluído: ${menuTree.length} menus encontrados. Salvo em ${targetPath}`);
    return outputJson;
}
