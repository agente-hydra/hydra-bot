---
specialistId: specialist-crawler-rede
specId: 079-rede-reparo-rapido-watchdog-invisible
complexity: high
anchors: ["projects/hydra-rede/src/ai_crawler_healing_hook.js:53", "projects/hydra-rede/src/run_morning_watchdog_0600.js:150", "projects/hydra-rede/src/sanity_gate_patio_rede.js:164", "projects/hydra-rede/src/invisible/rede_invisible_worker.py:128", "projects/hydra-rede/src/invisible/session_guard.py:101", "projects/hydra-rede/src/run_agy_auditor_worker.js:40"]
---

## Diagnóstico Forense (Incidente 09/11/2026)
1. **Ponto de Encaixe Existente:** `handleCrawlerIncident` (`projects/hydra-rede/src/ai_crawler_healing_hook.js:53`) apenas executa `retryFn` cega sem diagnóstico semântico do DOM ou catálogo de reparo. No Watchdog das 06:00 (`projects/hydra-rede/src/run_morning_watchdog_0600.js:150`), o Sanity Gate (`projects/hydra-rede/src/sanity_gate_patio_rede.js:164`) tenta `autoHealLojaZerada` via subprocesso isolado sem inspecionar tutoriais bloqueantes ou fila S3.
2. **Falhas Reais Observadas em 09/11:**
   - **Bloqueio de Tutorial (`joyride-backdrop`):** Na 1ª tentativa de extração de Piraporinha (`47712201`), o overlay `.joyride-backdrop` interceptou o clique no cabeçalho (`#nav-config` / `header-bar`), impedindo a abertura do modal de estabelecimentos.
   - **Erro de Código / Exportador Sintético:** `src/scraper.js` continha resquício de sintaxe na linha 921 e `EXPORT_STORES_BATCH` em `projects/hydra-rede/src/invisible/rede_invisible_worker.py:128` caía em `generate_binary_rede_xlsx` (sintético) quando o fluxo vivo não completava a coleta S3.
   - **Contingência Homologada:** A coleta real em `/tmp/rede-0911-4i31woz2/collect_live_v2.py` + `validate_live.cjs` provou 10/10 ECs reais via fila `/api/fl2/prd/v1/downloads/queue` (R$ 56.502,87 brutos, 30 transações) e destravou o envio das 08:00 AM.

## Recomendação Técnica
1. **Catálogo Fechado + Skill `rede-reparo-rapido`:** Integrar invocação read-only do AGY CLI (`projects/hydra-rede/src/run_agy_auditor_worker.js:40`) com log sanitizado, retornando exclusivamente `actionId` validado contra catálogo fechado (`DISMISS_TUTORIAL_AND_RETRY_CLICK`, `INSPECT_AND_CLICK_CANDIDATE`, `POLL_QUEUE_OR_RESUME_EXPORT`, `RECOVER_SESSION_INVISIBLE`, `RUN_HOMOLOGATED_CONTINGENCY`).
2. **Executor na Mesma Sessão Invisible:** Estender `rede_invisible_worker.py:128` e `session_guard.py:101` com ações RPC atômicas na sessão única do perfil Firefox, deduplicadas por `fluxo + período + EC + etapa` e limitadas a 2 ações por incidente com verificação objetiva pós-ação.
3. **Rotina de Contingência Homologada:** Versionar o coletor real (`collect_live_v2.py` + promotor `validate_live.cjs`) dentro do repositório para acionamento automático em caso de `SyntaxError`, módulo ausente ou detecção de planilha sintética.
