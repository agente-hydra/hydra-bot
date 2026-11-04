<!-- sdd:managed:begin id="specialist" -->
# Especialista: Especialista em Crawler & Rede
**ID:** `specialist-crawler-rede` | **Versão:** 1
**Papel:** Automação de Browser, Sessão Playwright & Scraping de Agendamentos

## Escopo e Padrões de Arquivo
- `src/hydra-sync/*crawler*`
- `src/hydra-sync/deep-crawler.ts`
- `src/hydra-sync/rede*`
- `src/hydra-sync/*session*`
- `src/hydra-sync/*modal*`
- `src/hydra-sync/*changebrand*`
- `src/hydra-sync/contas_pagar_crawler.ts`
- `src/hydra-sync/metas_crawler.ts`
- `src/hydra-sync/relatorio_operacao_crawler.ts`
- `src/hydra-sync/BuscaContasAPagar.xls`

## Palavras-Chave de Domínio
`crawler, playwright, rede, scraping, modal, changebrand, cookies, headless`

## Regras de Ouro
- **Execução estritamente headless para automações de browser** (origem: stack-default)

## Padrões Proibidos
- ⛔ Jamais abrir navegadores em modo interativo na VPS de produção

**Caminho de Memória:** `.agent/memory/specialists/specialist-crawler-rede.md`
<!-- sdd:managed:end id="specialist" -->
