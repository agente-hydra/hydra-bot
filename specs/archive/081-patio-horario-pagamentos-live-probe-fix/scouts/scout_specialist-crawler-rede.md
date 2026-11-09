---
specialistId: specialist-crawler-rede
specId: 081-patio-horario-pagamentos-live-probe-fix
complexity: medium
anchors: ["projects/hydra-rede/src/os_live_probe.js:60", "projects/hydra-rede/src/os_live_probe.js:244", "src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts:306"]
---

## Diagnóstico
1. **Crawler Horário Raso (`patio_ativo_crawler.ts`):** Roda a cada 1h (`:45`), mas lê apenas a grade de busca (`wfOrdemDeServicoBusca.aspx`), que não contém colunas financeiras. Ele copia `existing.valor_pago` das 05:41 AM e grava `updated_at = CURRENT_TIMESTAMP`, mantendo pagamentos diurnos (como a RANGER OS #1159 da Jorge Beretta, quitada em 10x de R$ 1.254,87 = R$ 12.548,70) congelados em `0` o dia todo.
2. **Sonda Live Morta por Fuso UTC (`os_live_probe.js:60`):** O SQLite grava `CURRENT_TIMESTAMP` em UTC sem `'Z'` (`"2026-11-09 17:46:36"`). `new Date(ts)` em `America/Sao_Paulo` interpreta como 17:46 local (+2h46m no futuro), gerando idade negativa (`-9.993.000 ms < 300.000 ms`) e retornando `necessitaRevalidacao = false` em 100% dos disparos.
3. **Seletor de Status Corrompido (`os_live_probe.js:244`):** `[id*="Status"]` captura o `<select>` inteiro concatenando todas as `<option>` em `status_grid`.

## Recomendação
1. Enriquecer `patio_ativo_crawler.ts` para inspecionar o detalhe financeiro (`total_os`, `valor_pago`, `valor_restante`, `pagamentos`) das OSs abertas (~21 na rede) a cada ciclo horário, fazendo UPSERT completo em `ordens_servico` e `os_store_<slug>.json`, com coluna/campo explícito `financeiro_updated_at`.
2. Corrigir o parser de timestamp UTC do SQLite em `os_live_probe.js:60` (`parseSqliteUtcTimestamp`), baseando `necessitaRevalidacao` em `financeiro_updated_at` (e não em updates rasos de grade).
3. Em `probeOSLive`, ativar explicitamente a aba `tapPagamento`, ler `select[id*="ddlStatus"] option:checked`, somar parcelas de `ucOrdemDeServicoPagamento_grd` como fallback seguro e atualizar tanto SQLite quanto `os_store_<slug>.json`.
