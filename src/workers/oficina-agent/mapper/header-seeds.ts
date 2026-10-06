import * as fs from 'fs';
import * as path from 'path';
import { HeaderMenuNode, SubmenuNode } from './header-crawler.js';

export interface Seed {
    label: string;
    url_hint: string | null;
    postback_target_hint: string | null;
    domain: string;
}

export function loadHeaderMap(): HeaderMenuNode[] {
    const p = path.resolve('docs/app-map/header.json');
    if (!fs.existsSync(p)) return [];
    
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.menus || [];
    } catch (e) {
        console.error('[Header Seeds] Erro ao ler header.json', e);
        return [];
    }
}

export function extractSeedsFromHeader(domains?: string[]): Seed[] {
    const menus = loadHeaderMap();
    const seeds: Seed[] = [];

    const targetDomains = domains?.map(d => d.toLowerCase()) || [];

    for (const menu of menus) {
        if (targetDomains.length > 0) {
            if (!targetDomains.includes(menu.label.toLowerCase())) {
                continue;
            }
        }

        for (const child of menu.children) {
            // Se for link direto de navegação
            if (child.type === 'link' && child.url_hint && child.url_hint !== '#') {
                seeds.push({
                    label: child.label,
                    url_hint: child.url_hint,
                    postback_target_hint: null,
                    domain: menu.label
                });
            } 
            // Se for postback e tivermos a action (geralmente também um relatorio/tela)
            else if (child.type === 'postback' && child.postback_target_hint) {
                seeds.push({
                    label: child.label,
                    url_hint: null,
                    postback_target_hint: child.postback_target_hint,
                    domain: menu.label
                });
            }
        }
    }
    return seeds;
}
