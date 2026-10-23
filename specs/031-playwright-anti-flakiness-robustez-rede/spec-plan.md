# Spec 031 — Plano de Tarefas: Anti-Flakiness & Robustez Playwright (v2 Hardened)

> **ID da Spec:** `031-playwright-anti-flakiness-robustez-rede`  
> **Status:** PROPOSTA ATUALIZADA (COM AUDITORIA DAS 5 TRAVAS TÉCNICAS)  
> **Data:** 2026-10-23  

---

## Track 1: [Agente 1: Playwright Core Engine Specialist]
- [x] **Task 1.1:** Eliminar todos os `page.waitForTimeout` estáticos de [`src/scraper.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/scraper.js), substituindo-os por auto-waiting locators, web-first assertions e `waitForLoadState('domcontentloaded'/'networkidle')`.
- [x] **Task 1.2:** Implementar o padrão de Reciclagem de Página (`page.close()` + `context.newPage()`) a cada loja para purga de nós de DOM e GC de memória RAM.
- [x] **Task 1.3:** Unificar a seleção de cabeçalho com `locator.or()`, removendo `{ force: true }` e encapsulando o clique do seletor em `expect().toPass({ timeout: 25000 })` para aguardar a hidratação Angular do modal.
- [x] **Task 1.4:** Integrar o Playwright Tracing por **Chunks** (`context.tracing.startChunk()` por loja e `context.tracing.stopChunk()` sem argumentos no sucesso), gravando `trace_${ec}_erro.zip` apenas em falhas reais.
- [x] **Task 1.5:** Implementar interceptação de rede no download S3 via `page.waitForResponse` para capturar a conclusão da fila diretamente sem depender de animações visuais.

---

## Track 2: [Agente 2: In-Flight Validation & Intra-Lógica Specialist]
- [x] **Task 2.1:** Criar o módulo [`src/intra_extraction_validator.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/intra_extraction_validator.js) com zero-byte check e validação da assinatura ZIP-XLSX (`PK\x03\x04`).
- [x] **Task 2.2:** Implementar o **EC Identity Guard**: leitura em memória das primeiras 15 linhas para certificar se o EC contido no arquivo bate estritamente com o EC esperado da loja.
- [x] **Task 2.3:** Implementar trava anti-duplicação condicional por hash SHA-256 (ativa exclusivamente quando `rows.length > 5` e EC divergente, prevenindo falso-positivo em lojas zeradas em feriados).
- [x] **Task 2.4:** Integrar o validador in-flight no loop principal de [`src/scraper.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/scraper.js), disparando descarte e retry imediato daquela loja antes de avançar.

---

## Track 3: [Agente 3: Burn-in Test & Stress Harness Specialist]
- [x] **Task 3.1:** Criar o script de estresse [`scripts/run_rede_burnin.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/scripts/run_rede_burnin.js) com suporte a flags `--cycles=10`, `--store=<slug>` e `--isolated-state`.
- [x] **Task 3.2:** Implementar coleta de telemetria em tempo real: latência por etapa de loja, latência de backend S3 e pico de consumo de memória RAM RSS.
- [x] **Task 3.3:** Adicionar relatório final formatado de Burn-in com índice de confiabilidade e diagnóstico de gargalos.

---

## Track 4: [Agente 4: Evening Heartbeat & Cron Orchestrator Specialist]
- [x] **Task 4.1:** Criar o orquestrador vespertino [`src/run_evening_heartbeat.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/run_evening_heartbeat.js).
- [x] **Task 4.2:** Implementar probe preventivo de sessão (`storageState_rede.json`) e pré-extração das 10 lojas às 19:15 PM para adiantar a carga noturna.
- [x] **Task 4.3:** Harmonizar o Stale Data Gate em [`src/run_unified_morning_dispatch.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/run_unified_morning_dispatch.js) e [`src/run_group_balloon_dispatch.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/run_group_balloon_dispatch.js) de 12h para 16h, impedindo retenção indevida às 07:45 AM.
- [x] **Task 4.4:** Blindar a nomenclatura de `state_YYYY-MM-DD.json` utilizando estritamente a data-alvo contábil (`targetDatesISO[0]`) do `date_resolver.js`, protegendo contra a virada da meia-noite.
- [x] **Task 4.5:** Configurar entrada no crontab da VPS para as 19:15 PM com log em `logs/heartbeat_YYYY-MM-DD.log`.

---

## Track 5: [Agente 5: Local Windows Emergency Runner Specialist]
- [x] **Task 5.1:** Criar o script Windows Desktop [`scripts/run_local_emergency.bat`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/scripts/run_local_emergency.bat).
- [x] **Task 5.2:** Criar o wrapper [`scripts/run_local_emergency.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/scripts/run_local_emergency.js) configurado para rodar com interface visível (`headless: false`) e canal nativo `chrome`.
- [x] **Task 5.3:** Implementar a **Sincronização Quádrupla via SCP**: envio obrigatório de `output/Juros*.xlsx`, `output/relatorios/Conciliacao*.xlsx`, `logs/audit_*.json` e `data/state_*.json` para a VPS.
- [x] **Task 5.4:** Adicionar gatilho pós-upload que destrava o Audit Gate e libera o despacho matinal imediatamente na VPS.

---

## Track 6: [Auditoria Cruzada, Build Gate & Documentação]
- [x] **Task 6.1:** Executar suite de Burn-in de 5 a 10 ciclos para certificar zero flakiness.
- [x] **Task 6.2:** Executar build gate de compilação e verificação de sintaxe.
- [x] **Task 6.3:** Sincronizar repositório Git na VPS (`master`) e atualizar a memória persistente Obsidian em [`.agent/memory/infra.md`](file:///C:/Users/User/Desktop/agy/.agent/memory/infra.md).
