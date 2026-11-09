---
specialistId: specialist-ops-infra
specId: 081-patio-horario-pagamentos-live-probe-fix
complexity: medium
anchors: ["src/hydra-sync/hourly_finance_worker.ts:1", "src/hydra-sync/delta_storage.ts:1"]
---

## Diagnóstico
1. **Drift entre Git e VPS (`hourly_finance_worker.ts` + `patio_ativo_crawler.ts`):** Em produção (`/home/operacional/hydra-deploy/current/src/hydra-sync/` e `/opt/bots/src/hydra-sync/`), `hourly_finance_worker.ts` invoca `coletarPatioAtivoLoja` (`patio_ativo_crawler.ts`) e `recalcularSnapshotDiurno()` a cada hora (`45 8-22 * * *`), mas `patio_ativo_crawler.ts` não estava versionado no repositório Git (`src/hydra-sync/`).
2. **Orçamento de Tempo Horário:** Há apenas ~21 OSs abertas nas 10 lojas (~2,1 por loja). A extração financeira das OSs abertas dentro da sessão autenticada do `hourly_finance_worker.ts` adiciona ~25s ao ciclo total (~2m30s frente ao timeout de 20m em `run-hydra-hourly-finance.sh`), sem criar novo cron nem contenção de `/tmp/hydra-data-refresh.lock`.

## Recomendação
1. Versionar `src/hydra-sync/patio_ativo_crawler.ts` e sincronizar `src/hydra-sync/hourly_finance_worker.ts` no repositório `hydra-bot`, eliminando o drift com a VPS.
2. No deploy da VPS, validar sintaxe (`npx tsc --noEmit` e `node --check`), sincronizar os artefatos em `/home/operacional/hydra-deploy/current/src/hydra-sync/`, `/opt/bots/src/hydra-sync/` e `/home/operacional/hydra-rede/src/`, e executar probe real contra o ERP e SQLite vivo sem disparar mensagens em grupos.
