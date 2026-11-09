# Proposta Refinada — Spec 078: Restauração do Invisible Playwright Exclusivo (`origin/master`), Agendamento Único Pós-Clearing (05:00 AM), Frescor do Pátio e Validação Google Sheets

## 1. Diagnóstico Forense Profundo (Evidência Factual na VPS)

### 1.1 Por que o Rede sumiu na VPS e por que ainda havia agendamento noturno no Cron?
- **O que aconteceu no Git da VPS (`/home/operacional/hydra-rede`):**
  - Neste workspace (`projects/hydra-rede`), os últimos commits e pushes em `origin/master` (`57cabe4` / Spec 071 `9b78e61`) já haviam cravado o **Invisible Playwright 0.45.0** como **motor único e exclusivo** da Rede (`src/scraper.js`, `src/invisible_bridge_client.js`, `src/invisible/rede_invisible_worker.py`, `src/invisible/session_guard.py`, `src/batch_audit_guard.js`), inclusive com trava explícita em `src/scraper.js:24`:
    > `throw new Error('Execução de Meu Rede via Chromium descontinuada. O Portal Rede opera exclusivamente via Invisible Playwright.');`
  - Contudo, na VPS (`/home/operacional/hydra-rede`), foi feito checkout da branch `backup-state-pre-deploy-0511` (`97c65b6`, vinda de outro workspace `REDE-BOT`), que:
    1. **Sobrescreveu `src/scraper.js` e `src/reconnect_system/rede_live_auth_hub.js` de volta para Chromium (`stealth_browser_provider.js`)** — que cai no CAPTCHA da Rede!
    2. **Apagou do disco da VPS toda a stack do Invisible Playwright** (`src/invisible/*`, `src/invisible_bridge_client.js`, `src/batch_audit_guard.js`, `deploy/setup_invisible_env.sh`, `deploy/invisible_manifest.json`) e mais de 30 scripts/módulos de `origin/master` (`scripts/run-nightly-prep.sh`, `scripts/run-unified-morning.sh`, `src/run_morning_watchdog_0600.js`, `src/exportar_contas_pagar_cli.js`, `src/sanity_gate_patio_rede.js`, `src/patio_hydra_bot_adapter.js`, etc.).
- **O que estava errado no Crontab da VPS:**
  - O `crontab` da VPS ainda mantinha agendamentos noturnos legados:
    - `0 23 * * * /home/operacional/hydra-rede/scripts/run-nightly-prep.sh`
    - `0 1,3,5,7 * * * /home/operacional/hydra-rede/scripts/run-nightly-prep.sh`
  - **Regra Operacional Inegociável:** O Rede **NÃO roda à noite (`23:00`, `01:00`, `03:00`)**! Rodar à noite pega transações pré-clearing (`-`) e queima a sessão/cai em CAPTCHA. Tem que existir **UM ÚNICO agendamento de extração pós-clearing na manhã (`05:00 AM`, `0 5 * * 1-5`)** e **exclusivamente via Invisible Playwright**.
  - **Verificação de Binários na VPS:** Os binários `/home/operacional/.local/bin/invisible-playwright` e `/home/operacional/.local/bin/invisible-core` já estão instalados na VPS; basta restaurar os arquivos de `origin/master` (`57cabe4`) e garantir o `.venv-invisible` via `deploy/setup_invisible_env.sh`.

---

### 1.2 Pátio / Financeiro: Por que o ciclo das 21h45 fechou 10/10, mas o Frescor do Pátio ficou preso em sexta-feira (06/11)?
- **Status do Timeout de Santo André:**
  - No ciclo das 20h houve timeout pontual em Santo André (9/10), mas no ciclo das **21h45** (`hourly-finance.log` às 21:47) Santo André já recuperou sozinho e fechou **Mapa de Metas (10/10) e Vendas do Dia (10/10) com 0 falhas**.
- **Causa Raiz do `oldestSourceCapturedAt` preso em `2026-11-06T11:17:26.149Z`:**
  - Em `src/patio_ledger_engine.js` (`recalcularSnapshotDiurno`, linhas 846–908):
    1. O `patio_ativo_crawler.ts` roda de hora em hora e grava `/home/operacional/hydra-data/crawls/os_store_<slug>.json` com `"ultima_atualizacao": "2026-11-09T00:46:33.149Z"` (< 2 min).
    2. Porém, `recalcularSnapshotDiurno()` consulta apenas `SELECT loja_slug, MAX(fim_em) FROM crawls_execucoes` (tabela que só é alimentada pelo `deep-crawler.ts` de dias úteis, cuja última execução foi sexta 06/11), ignorando `os_store_<slug>.json -> ultima_atualizacao`.
    3. Além disso, OSs novas abertas após sexta-feira existem em `os_store_<slug>.json` (`is_aberta: 1`), mas não entram na contagem SQLite de `recalcularSnapshotDiurno()`.

---

### 1.3 Google Sheets × OS: Por que o Webhook devolveu HTML às 07:00 AM e saiu com código 0?
- **Causa Raiz Extraída do HTML do Google Apps Script:**
  - O webhook (`AKfycbz...`) está online, mas ao tentar gravar a Linha 15 (`OS #40454 Piraporinha | R$ 450.00`), o Apps Script executa `range.setValues(values)` na aba inteira (`NOVEMBRO 2026`) e o Google Sheets aborta com erro de validação de dados na **célula D8** (devolvido em HTML):
    > `Erro: Os dados inseridos na célula D8 violam o respectivo conjunto de regras de validação de dados. Insira um destes valores: MENSAGEM INICIAL, Cansado de passar por diversas oficinas...`
  - Na Linha 8 (`["Camila","3/11","Google","-","MUNIZ","(11) 94831-8033","Virtus 2020"]`), foi digitado `"-"` na coluna D (`MENSAGEM INICIAL`), violando o dropdown da planilha.
  - Adicionalmente, `sync_sheets_os_worker.js:274` retorna `{ ok: true }` incondicionalmente mesmo quando `webhookResult.ok === false`, encerrando com `exit 0`.

---

## 2. Solução Proposta

### Pilar 1 — Restauração do Invisible Playwright Exclusivo (`origin/master` `57cabe4`) e Árvore Completa na VPS
1. Criar branch de backup `backup-vps-20261108-pre-spec078` na VPS.
2. **Sobrescrever obrigatoriamente com a versão de `origin/master` (`57cabe4` / Spec 071 `9b78e61`) toda a stack da Rede e Conciliação:**
   - `src/scraper.js` (motor **exclusivo Invisible Playwright**, zero Chromium)
   - `src/invisible_bridge_client.js`
   - `src/invisible/rede_invisible_worker.py`, `src/invisible/session_guard.py`, `src/invisible/manifest_tracker.py`, `src/invisible/xlsx_helper.py`
   - `src/batch_audit_guard.js`
   - `src/reconnect_system/rede_live_auth_hub.js`
   - `src/reconciliation_patio_rede_engine.js`, `src/patio_ledger_engine.js`
   - `src/leads_system/*` (versão Apple Floating Island de `57cabe4`)
   - `deploy/setup_invisible_env.sh`, `deploy/invisible_manifest.json`
3. Restaurar de `origin/master` (`57cabe4`) todos os scripts e módulos ausentes no disco da VPS (`scripts/run-nightly-prep.sh`, `scripts/run-unified-morning.sh`, `scripts/run-patio.sh`, `src/run_morning_watchdog_0600.js`, `src/exportar_contas_pagar_cli.js`, `src/ai_crawler_healing_hook.js`, `src/hydra_network_watchdog.js`, `src/sanity_gate_patio_rede.js`, `src/contas_pagar_retention.js`, `src/patio_hydra_bot_adapter.js`, `src/excel_patio_builder.js`, `src/crawler_patio_oi.js`, `src/patio_xls_parser.js`, `src/excel_conciliacao_builder.js`, `src/excel_conciliacao_updater.js`, `src/servico_prestado_antispam_gate.js`).
4. Validar/provisionar `.venv-invisible` via `deploy/setup_invisible_env.sh` e testar o `InvisibleBridgeClient` (`--smoke` / `--dry-run`).

### Pilar 2 — Crontab Limpo: ZERO Execução Noturna da Rede + Execução Única às `05:00 AM`
1. Atualizar o `crontab` de `operacional` na VPS:
   - **REMOVER** `0 23 * * * /home/operacional/hydra-rede/scripts/run-nightly-prep.sh`
   - **REMOVER** `0 1,3,5,7 * * * /home/operacional/hydra-rede/scripts/run-nightly-prep.sh`
   - **DEFINIR AGENDAMENTO ÚNICO PÓS-CLEARING ÀS 05:00 AM:**
     ```cron
     0 5 * * 1-5 /home/operacional/hydra-rede/scripts/run-nightly-prep.sh >> /home/operacional/hydra-data/logs/cron_morning_prep.log 2>&1
     ```
   - Manter a sequência matinal ordenada:
     - `0 5 * * 1-5`: Extração única (Invisible Playwright) e preparação dos 5 relatórios (`run-nightly-prep.sh`)
     - `0 6 * * 1-5`: Watchdog das 06:00 AM (`src/run_morning_watchdog_0600.js`)
     - `0 7 * * 1-5`: Auditor pré-despacho das 07:00 AM (`src/run_agy_auditor_worker.js`)
     - `45 7 * * 1-5`: Despacho matinal unificado (`scripts/run-unified-morning.sh`)

### Pilar 3 — Correção do Frescor de 15 min e Contagem de Veículos no `patio_ledger_engine.js`
1. Em `recalcularSnapshotDiurno()` (`src/patio_ledger_engine.js`), ler `/home/operacional/hydra-data/crawls/os_store_${slug}.json`:
   - Resolver `sourceCapturedAt` como o maior timestamp entre `crawls_execucoes.fim_em`, `MAX(ordens_servico.updated_at)` e `os_store_${slug}.json -> ultima_atualizacao`.
   - Sincronizar OSs com `is_aberta === 1` de `os_store_${slug}.json` para que o consolidado diurno reflita o crawl horário real (< 15 min).

### Pilar 4 — Diagnóstico HTML (Célula D8) e Exit Code Real no `GoogleSheetsClient` & `sync_sheets_os_worker.js`
1. Em `src/lib/google_sheets_client.js`, detectar resposta HTML antes do `JSON.parse` e extrair a mensagem exata de violação de regra de validação (`célula D8`), além de alinhar `parseCsv()`.
2. Em `src/sync_sheets_os_worker.js`, propagar `ok: false` (`process.exit(1)`) quando o webhook falhar.

---

## 3. Especialistas Envolvidos (Roster)
- **`specialist-crawler-rede`**: Restauração do Invisible Playwright (`origin/master` `57cabe4`), corte do cron noturno para agendamento único às `05:00 AM` e correção de `patio_ledger_engine.js`.
- **`specialist-messaging-whatsapp`**: Diagnóstico HTML do Google Sheets e exit code em `sync_sheets_os_worker.js`.
- **Líder (Integração & Build Gate)**: Validação do `.venv-invisible`, grafo `require.resolve()` e crontab na VPS.
