import * as fs from 'fs';
import * as path from 'path';
import { CrawlerState, AppMap } from './types.js';

export class AppMapBuilder {
  private domain: string;
  private partialPath: string;
  private finalPath: string;

  constructor(domain: string) {
    this.domain = domain;
    const baseDir = path.resolve('docs/app-map');
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    
    this.partialPath = path.join(baseDir, `${domain}.partial.json`);
    this.finalPath = path.join(baseDir, `${domain}.json`);
  }

  public loadPartialState(): CrawlerState | null {
    if (fs.existsSync(this.partialPath)) {
       try {
         const raw = fs.readFileSync(this.partialPath, 'utf8');
         return JSON.parse(raw) as CrawlerState;
       } catch (e) {
         console.warn(`[AppMapBuilder] Falha ao ler partial state de ${this.domain}.`);
         return null;
       }
    }
    return null;
  }

  public savePartialState(state: CrawlerState) {
    state.last_updated_at = new Date().toISOString();
    fs.writeFileSync(this.partialPath, JSON.stringify(state, null, 2));
    console.log(`[AppMapBuilder] Progresso incremental salvo em ${this.partialPath} (${state.visited_nodes.length} nós visitados)`);
  }

  public promoteToFinal(state: CrawlerState) {
    // 1. Grava o JSON final apenas com a visão limpa do AppMap
    const finalMap: AppMap = {
       domain: this.domain,
       generated_at: new Date().toISOString(),
       pages: state.app_map.pages
    };
    fs.writeFileSync(this.finalPath, JSON.stringify(finalMap, null, 2));
    console.log(`[AppMapBuilder] Mapeamento promovido com sucesso para ${this.finalPath}`);

    // 2. Remove o partial (ou renomeia para histórico)
    if (fs.existsSync(this.partialPath)) {
       const historyPath = path.resolve(`docs/app-map/${this.domain}.completed.json`);
       fs.renameSync(this.partialPath, historyPath);
    }
  }
}
