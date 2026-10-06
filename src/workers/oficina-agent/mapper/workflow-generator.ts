import * as fs from 'fs';
import * as path from 'path';

export interface WorkflowGeneratorOptions {
    domain: string;
}

function slugify(text: string): string {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^\w\-]+/g, '')
        .replace(/\_\_+/g, '_')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

export async function runWorkflowGenerator(options: WorkflowGeneratorOptions): Promise<any> {
    const domainSlug = slugify(options.domain);
    const mapPath = path.resolve(`docs/app-map/${domainSlug}.partial.json`);
    const finalMapPath = path.resolve(`docs/app-map/${domainSlug}.json`);
    
    let sourcePath = mapPath;
    if (!fs.existsSync(sourcePath)) {
        if (fs.existsSync(finalMapPath)) {
            sourcePath = finalMapPath;
        } else {
             console.error(`[Workflow Generator] Nenhum mapa encontrado para o domínio ${options.domain}. Procurou em: ${mapPath} e ${finalMapPath}`);
             return { error: 'Map not found' };
        }
    }

    const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    let pages = data.pages || [];
    if (pages.length === 0 && data.app_map && data.app_map.pages) {
        pages = data.app_map.pages;
    }

    const outDir = path.resolve('docs/workflows');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    let generatedCount = 0;
    const generatedFiles: string[] = [];

    const DANGEROUS_TERMS = ['excluir', 'cancelar', 'deletar', 'remover', 'finalizar', 'estornar'];
    const MUTATION_TERMS = ['novo', 'nova', 'salvar', 'atualizar', 'confirmar', 'cadastrar', 'adicionar'];
    const EXPORT_TERMS = ['exportar', 'excel', 'csv', 'imprimir', 'pdf'];

    for (const page of pages) {
        // Verifica as actions da página
        const actions = page.actions || [];
        
        // Pega as labels para analisar a intenção da página
        const labels = actions.map((a: any) => a.label.toLowerCase());
        
        let action_type = 'query';
        let dangerous = false;

        const isDangerous = labels.some((l: string) => DANGEROUS_TERMS.some(t => l.includes(t)));
        const isMutation = labels.some((l: string) => MUTATION_TERMS.some(t => l.includes(t)));
        const isExport = labels.some((l: string) => EXPORT_TERMS.some(t => l.includes(t)));

        if (isDangerous) {
            action_type = 'mutation';
            dangerous = true;
        } else if (isMutation) {
            action_type = 'mutation';
        } else if (isExport) {
            action_type = 'export';
        }

        // Se a página não tiver filtros ou tabelas e nem actions expressivas, ignora
        if (actions.length === 0 && (!page.table_columns || page.table_columns.length === 0)) {
            continue;
        }

        const pageName = page.title.replace('Oficina Inteligente | Sistema de Gestão para Oficinas', '').replace('-', '').trim() || 'TBD';
        const pageSlug = slugify(pageName || path.basename(page.url, '.aspx'));
        if (!pageSlug) continue;

        const workflowId = `${domainSlug}.${pageSlug}`;
        const fileName = `${workflowId}.md`;
        const filePath = path.join(outDir, fileName);

        if (fs.existsSync(filePath)) {
            // Ignora se já existe para não sobrescrever aprovações manuais
            continue;
        }

        // Tentar inferir inputs a partir de actions ou URL ou colunas de tabela que parecem filtros
        const inputs = page.filters?.map((f:any) => f.label) || [];
        // Se não achou inputs explícitos, criar dummy
        if (inputs.length === 0) inputs.push('periodo_inicial', 'periodo_final');

        const outputs = [];
        if (page.table_columns && page.table_columns.length > 0) outputs.push('tabela_resultados');
        if (isExport) outputs.push('arquivo_exportado');
        if (action_type === 'mutation') outputs.push('sucesso_operacao', 'logs_auditoria');

        const mdContent = `---
id: ${workflowId}
domain: ${options.domain}
status: discovered
action_type: ${action_type}
dangerous: ${dangerous}
source_page: "${pageName}"
source_url_hint: "${page.url}"
inputs:
${inputs.map((i: string) => `  - ${slugify(i)}`).join('\n')}
outputs:
${outputs.map(o => `  - ${o}`).join('\n')}
evidence:
  - ${page.snapshot_ref || 'N/A'}
  - ${page.screenshot_ref || 'N/A'}
last_seen_at: "${new Date().toISOString()}"
context:
  empresa:
    type: "single"
    required: true
---

# Fluxo de Trabalho: ${pageName}

**Domínio:** ${options.domain}
**Ações Identificadas:**
${actions.map((a: any) => `- [${a.type}] ${a.label}`).join('\n')}

## Passos para Execução (Rascunho do Crawler)
1. Navegar até \`${page.url}\`.
2. Preencher os parâmetros identificados em \`inputs\`.
3. Executar a ação primária (Buscar/Exportar/Gravar).
4. Coletar os retornos listados em \`outputs\`.
`;

        fs.writeFileSync(filePath, mdContent, 'utf8');
        generatedCount++;
        generatedFiles.push(fileName);
    }

    console.log(`[Workflow Generator] Gerou ${generatedCount} workflows para o domínio ${options.domain}.`);
    return { generated_count: generatedCount, files: generatedFiles };
}
