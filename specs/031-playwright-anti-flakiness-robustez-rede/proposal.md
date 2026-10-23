# Spec 031 — Proposta de Arquitetura: Anti-Flakiness & Robustez Extrema do Scraper Playwright Rede (v2 Hardened)

> **ID da Spec:** `031-playwright-anti-flakiness-robustez-rede`  
> **Status:** PROPOSTA ATUALIZADA (COM AUDITORIA DAS 5 TRAVAS TÉCNICAS)  
> **Data:** 2026-10-23  
> **Base de Referência:** Análise r/Playwright (`1ptzhi6`), Documento Estratégico e Auditoria de Produção

---

## 1. Contexto e Diagnóstico da Causa Raiz

O portal Meu Rede (`meu.userede.com.br`) é uma Single Page Application (SPA) Angular/Enterprise pesada que atende 10 estabelecimentos comerciais (ECs) da Mecânica Popular.

Historicamente, o `src/scraper.js` sofria de intermitências crônicas (*flakiness*) mascaradas por retries cegos e dezenas de `page.waitForTimeout()` estáticos (com esperas de até 6 segundos). As causas raízes técnicas identificadas são:

1. **Hidratação Tardia e Cliques no Vazio:** Na transição entre lojas, o DOM renderiza o modal e os botões antes que o framework Angular anexe os event listeners e atualize o token de sessão do EC. O clique visual é registrado no ar com `{ force: true }`, mantendo ativa a loja anterior.
2. **Seletores Acoplados a Classes Voláteis:** O uso de IDs e seletores rígidos (`#nav-config`, `a.icon_usuario_perfil`) quebrava quando a Rede alternava entre o cabeçalho clássico e o novo SPA (`header-bar`).
3. **Dependência de UI para Polling S3:** O processo de exportação aguardava elementos visuais na tela para monitorar a fila de downloads, suscetível a congelamentos do frontend da Rede.
4. **Vazamento de Memória e Estado em Contexto Único:** Rodar as 10 lojas na mesma aba do Chromium acumula garbage collection, service workers e nós de DOM pendentes, degradando a performance a partir da 5ª loja.
5. **Falta de Tracing Automatizado:** Erros transitórios geravam apenas screenshots estáticos PNG, insuficientes para depurar condições de corrida em rede ou eventos assíncronos.

---

## 2. Os 5 Pilares de Estabilidade com Blindagem de Produção

### Pilar 1: Bateria de Burn-in Stress Test (`10 TESTES EXE [ ]`)
- Criação do orquestrador de teste de estresse `scripts/run_rede_burnin.js`.
- Executa de 5 a 10 ciclos consecutivos e controlados em modo `--test-mode` ou `--build-only` isolado.
- Monitora RSS de memória RAM na VPS, latência por loja e valida zero quebra antes de homologar alterações.

### Pilar 2: Dual-Layout Resiliente com `locator.or()` e `expect().toPass()`
- Eliminação de `if/else` com timeouts longos. Adoção do padrão nativo `locator.or()` para o cabeçalho moderno (`header-bar`, `.c-header__button`, drawer `#c-header-drawer`) e clássico (`#nav-config`).
- **Remoção de `{ force: true }`:** O clique agora aguarda a hidratação real dos event listeners. A abertura do seletor é garantida via `expect().toPass({ timeout: 25000, intervals: [1000, 2000, 3000] })`, verificando que o modal/drawer de estabelecimentos realmente abriu no DOM.

### Pilar 3: IA Intra-Lógica com Proteção contra Falsos-Positivos
- **EC & Date Identity Guard:** Leitura imediata do `.xlsx` baixado em `downloads/`. O bot inspeciona o cabeçalho e as linhas iniciais. Se o EC interno não corresponder estritamente ao EC esperado daquela loja, o arquivo é rejeitado no ato e a loja é repetida no loop.
- **Anti-Duplicação Inteligente (SHA-256):** A trava de colisão de hash só é disparada se o arquivo tiver dados (`transacoesCount > 0` / `rows.length > 5`) E se o `actualEC` for divergente. Lojas zeradas em domingos/feriados não disparam falso-positivo.

### Pilar 4: Heartbeat 19:15 PM com Harmonização de Stale Gate & Meia-Noite
- Execução diária às **19:15 PM** via `src/run_evening_heartbeat.js` (logo após o fechamento operacional e Balão 3).
- **Harmonização do Stale Data Gate:** Extensão da tolerância do gate de 12h para **16 horas** (ou atualização de `mtime` pela rotina das 23:00), impedindo que a extração das 19:15 seja bloqueada às 07:45/08:00 AM (12h30m depois).
- **Proteção da Virada de Meia-Noite:** O arquivo de estado `data/state_YYYY-MM-DD.json` é sempre nomeado pela **data-alvo contábil da venda** resolvida pelo `date_resolver.js`, nunca pelo `new Date()` do relógio da VPS.

### Pilar 5: Ambiente Controlado Fora da VPS com Sincronização Quádrupla
- Script `scripts/run_local_emergency.bat` e wrapper Node.js `scripts/run_local_emergency.js` para execução visível (`headless: false` / Chrome nativo).
- **SCP Reverso Completo:** Além das planilhas `Juros` e `Conciliação`, o script sincroniza compulsoriamente os checkpoints `logs/audit_*.json` e `data/state_*.json`, garantindo que a VPS reconheça o `status: SUCCESS` no Audit Gate matinal.

---

## 3. Divisão de Trabalho por Agentes Especializados (Teamwork Structure)

```mermaid
flowchart TD
    Lead["Lead Orchestrator (SDD)"] --> A1["Agente 1: Playwright Core Engine Specialist"]
    Lead --> A2["Agente 2: In-Flight Validation & Intra-Lógica"]
    Lead --> A3["Agente 3: Burn-in Test & Stress Harness"]
    Lead --> A4["Agente 4: Evening Heartbeat & Cron Orchestrator"]
    Lead --> A5["Agente 5: Local Windows Emergency Runner"]

    A1 -->|Refatoração Playwright + Page Recycling + Tracing Chunks| Engine["src/scraper.js"]
    A2 -->|EC Identity Guard + SHA-256 Condicional| Validator["src/intra_extraction_validator.js"]
    A3 -->|Suite 10x Burn-in Stress Test| Burnin["scripts/run_rede_burnin.js"]
    A4 -->|Heartbeat 19:15 PM + Stale Gate 16h + Data Contábil| Heartbeat["src/run_evening_heartbeat.js"]
    A5 -->|Desktop Chrome Visível + SCP Quádruplo (Excel+Audit+State)| Local["scripts/run_local_emergency.bat"]
```

### Agente 1: Playwright Core Engine Specialist
- **Responsabilidade:** Refatorar [`src/scraper.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/scraper.js).
- **Entregáveis:**
  - Banimento de todos os `page.waitForTimeout` estáticos.
  - Reciclagem de página por loja (`page.close()` + `context.newPage()`).
  - Tracing por Chunk (`context.tracing.startChunk()` / `stopChunk()` sem argumentos no sucesso e com `{ path }` em erros).
  - Remoção de `{ force: true }` e adoção de `expect().toPass()` para abertura confirmada do modal.
  - Padrão `locator.or()` cobrindo cabeçalhos moderno e clássico.

### Agente 2: In-Flight Validation & Intra-Lógica Specialist
- **Responsabilidade:** Criar [`src/intra_extraction_validator.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/intra_extraction_validator.js).
- **Entregáveis:**
  - Leitura síncrona do buffer XLSX com validação da assinatura ZIP (`PK\x03\x04`).
  - EC Identity Guard nas primeiras 15 linhas (cabeçalho e transações).
  - Trava anti-duplicação de SHA-256 restrita a arquivos com dados (`rows.length > 5`).

### Agente 3: Burn-in Test & Stress Harness Specialist
- **Responsabilidade:** Criar [`scripts/run_rede_burnin.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/scripts/run_rede_burnin.js).
- **Entregáveis:**
  - Suporte a `--cycles=10`, `--store=<slug>`, `--isolated-state`.
  - Coleta de telemetria: latência de troca de loja, S3 queue latency e memória RAM RSS.

### Agente 4: Evening Heartbeat & Cron Orchestrator Specialist
- **Responsabilidade:** Criar [`src/run_evening_heartbeat.js`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/src/run_evening_heartbeat.js) e ajustar crontab/gates.
- **Entregáveis:**
  - Probe rápido de sessão e pré-extração às 19:15 PM.
  - Extensão do Stale Data Gate para 16 horas em `run_unified_morning_dispatch.js` e `run_group_balloon_dispatch.js`.
  - Nomeação estrita de `state_YYYY-MM-DD.json` pela data contábil resolvida pelo `date_resolver.js`.

### Agente 5: Local Windows Emergency Runner Specialist
- **Responsabilidade:** Criar contingência Windows Desktop [`scripts/run_local_emergency.bat`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/scripts/run_local_emergency.bat).
- **Entregáveis:**
  - Execução Chrome visível (`headless: false`).
  - Sincronização quádrupla via SCP: `output/Juros*.xlsx`, `output/relatorios/Conciliacao*.xlsx`, `logs/audit_*.json` e `data/state_*.json`.

---

## 4. Matriz de Conflitos e Correções Blindadas

| Conflito Identificado | Risco de Produção | Correção Aplicada na Spec |
|---|---|---|
| **Stale Gate (12h) vs Heartbeat (19:15 PM)** | Bloqueio matinal do despacho (12h25m depois). | Stale gate estendido para **16 horas** nas checagens matinais. |
| **Falta de Audit/State no SCP Reverso** | VPS mantém `status: BLOCKED` mesmo após envio da planilha. | Inclusão de `logs/audit_*.json` e `data/state_*.json` no comando `scp`. |
| **`tracing.stop({ path: null })` e `force: true`** | Erro de tipagem no Playwright e clique no vazio antes da hidratação. | Uso de `startChunk()`/`stopChunk()` nativos e `expect().toPass()`. |
| **Falso-positivo de hash SHA-256 em lojas zeradas** | Bloqueio indevido de lojas sem vendas em domingos/feriados. | SHA-256 ativo somente quando `rows.length > 5` e EC divergente. |
| **Virada de Meia-Noite no State File** | Retries da madrugada criam um segundo state file desincronizado. | Nomenclatura baseada exclusivamente em `targetDatesISO[0]` do `date_resolver.js`. |
