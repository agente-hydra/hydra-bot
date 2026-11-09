---
specialistId: specialist-crawler-rede
specId: 078-rede-matinal-cron-restoration-patio-sheets
complexity: high
anchors: ["projects/hydra-rede/src/scraper.js:1", "projects/hydra-rede/src/invisible_bridge_client.js:1", "projects/hydra-rede/src/patio_ledger_engine.js:1"]
---
# Scout: Crawler Rede (Invisible Playwright Exclusivo + Crontab Único Matinal) & Frescor do Pátio

## Diagnóstico Refinado
1. **Regressão na VPS por Checkout da Branch `REDE-BOT` (`97c65b6`) sobre `origin/master` (`57cabe4`):** O último commit e push oficial deste workspace (`origin/master` = `57cabe4`, contendo Spec 071 `9b78e61`) já havia migrado o Meu Rede **exclusivamente para o Invisible Playwright 0.45.0** (`src/scraper.js`, `src/invisible_bridge_client.js`, `src/invisible/rede_invisible_worker.py`, `src/batch_audit_guard.js`) e bloqueado execução via Chromium. Porém, na VPS foi feito checkout da branch `backup-state-pre-deploy-0511` (`97c65b6`), que sobrescreveu `src/scraper.js` com Chromium (`stealth_browser_provider.js`) e removeu `src/invisible/*` e >35 módulos de `origin/master`.
2. **Proibição de Execução Noturna da Rede no Crontab:** O `crontab` da VPS ainda continha `0 23 * * *` e retries `0 1,3,5,7 * * *` para `run-nightly-prep.sh`. Bater no Meu Rede às 23h/01h/03h queima sessão em CAPTCHA e coleta vendas pré-clearing (`-`). Deve existir **apenas UM agendamento matinal pós-clearing às 05:00 AM** (`0 5 * * 1-5`).
3. **Frescor de 15 min no Pátio (`patio_ledger_diurno.json`):** `recalcularSnapshotDiurno` em `patio_ledger_engine.js:846` lê `sourceCapturedAt` apenas de `crawls_execucoes` (alimentada pelo deep-crawler de sexta 06/11), ignorando `os_store_<slug>.json -> ultima_atualizacao` atualizado de hora em hora.

## Recomendações
1. Restaurar na VPS `origin/master` (`57cabe4`) para toda a stack do **Invisible Playwright** (`src/scraper.js`, `src/invisible_bridge_client.js`, `src/invisible/*`, `src/batch_audit_guard.js`, `src/reconnect_system/rede_live_auth_hub.js`, `deploy/*`) e scripts/módulos ausentes.
2. Expurgar do `crontab` da VPS as entradas noturnas (`0 23 * * *` e `0 1,3,5,7 * * *`), mantendo **somente UMA execução às `05:00 AM`** (`0 5 * * 1-5 /home/operacional/hydra-rede/scripts/run-nightly-prep.sh`).
3. Atualizar `recalcularSnapshotDiurno` para considerar `ultima_atualizacao` e OSs abertas de `os_store_<slug>.json`.
