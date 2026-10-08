---
trigger: always_on
---

# Gestão de Contexto — Eficiência Obrigatória

## Progressive Depth (Regra de Ouro)
Sempre comece do mais leve para o mais pesado:
1. `list_dir` — Visão geral da estrutura
2. `grep_search` — Encontrar arquivo/linha exata
3. `view_file` com `StartLine`/`EndLine` — Ler só o trecho necessário

**Nunca** comece lendo um arquivo inteiro de 500 linhas quando precisa de 10.

## Context Budget
- Máx 3 arquivos de memória Obsidian por task
- Se já carregou >10 arquivos de código na sessão, pause e faça um resumo mental do que tem antes de carregar mais
- Prefira `grep_search` para encontrar informações pontuais

## Graphify-First para Dependências
Antes de abrir múltiplos arquivos para entender dependências:
- Use `graphify query "<termo>"` para mapear módulos relacionados
- Use `graphify explain "<modulo>"` para entender o grafo de dependências
- Só então abra os arquivos específicos necessários

## Lazy Loading de Imports
Quando precisa entender uma interface ou tipo:
- Use `grep_search` para encontrar a declaração (`export interface`, `export type`, `export function`)
- Leia APENAS a assinatura/interface, não a implementação inteira
- Isso reduz consumo de tokens em ~85% mantendo precisão total

## Anti-Flood
- Nunca carregue `node_modules/`, `.next/`, ou `dist/`
- Nunca leia arquivos de lock (`package-lock.json`, `yarn.lock`) inteiros — use `grep_search` para buscar pacotes específicos
- Nunca faça `find_by_name` sem filtros em diretórios grandes
