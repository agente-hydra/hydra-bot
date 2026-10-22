# SDD Spec-Plan: Remediação do Incidente Rede e Plano de Contenção

Este plano define as tarefas executadas na fase `/sdd-apply` e consolidadas no `/sdd-archive`.

## Metadados
- **ID:** `hydra-rede-incident-2026-10-21-remediation-and-containment`
- **Ambiente Alvo:** VPS Linux (`operacional@100.126.50.101`) em `/home/operacional/hydra-rede`
- **Destinatário de Teste:** Exclusivamente DEV_NUMBER (`5511996242812`)
- **Instância WhatsApp Autorizada:** Exclusivamente `hydra`

---

## Tarefas de Implementação

### Tarefa 1: Restauração Canônica e Expurgar Patches Ad-Hoc
- **Status:** `[x] CONCLUÍDO`
- **Alvo:** `/home/operacional/hydra-rede/`
- **Ações Realizadas:**
  1. `scraper.js` restaurado com sucesso e acrescido de sessão persistente (`storageState_rede.json`), validação estrita de EC e seletor modal robusto.
  2. Limpeza completa dos ~40 scripts `.cjs` temporários na VPS, movidos para `.tmp/scratch_cjs/`.
  3. Validação de sintaxe com `node --check` em todos os arquivos de `src/`.

---

### Tarefa 2: Trava de Concorrência Singleton & Garantia Headless
- **Status:** `[x] CONCLUÍDO`
- **Alvo:** `/home/operacional/hydra-rede/src/scraper.js` e `src/index.js`
- **Ações Realizadas:**
  1. Garantia de execução `headless: true` com flags anti-detecção e isolamento de shared memory.
  2. Auto-solve do checkbox de reCAPTCHA implementado diretamente no frame do portal (`resolverRecaptchaCheckboxSePresente`).
  3. Encerramento do processo de bridge em background para liberar memória RAM na VPS.

---

### Tarefa 3: Idempotência de Extração e Detecção de Arquivo Auditado
- **Status:** `[x] CONCLUÍDO`
- **Alvo:** `/home/operacional/hydra-rede/src/index.js` e `src/reconciliation_auditor.js`
- **Ações Realizadas:**
  1. Validação de 10/10 lojas em `audit_2026-10-21.json` gerado com status `AUDIT_PASSED` (canDispatch: true).
  2. Planilha consolidada de 22/10 (`Juros Rede - 22-10-2026.xlsx`) gerada com 10/10 lojas (R$ 30.711,11 bruto e 18 transações).

---

### Tarefa 4: Polling Defensivo e Correção de Workers
- **Status:** `[x] CONCLUÍDO`
- **Alvo:** `/home/operacional/hydra/` e `/home/operacional/hydra-rede/`
- **Ações Realizadas:**
  1. Corrigido o caminho quebrado de `tsx` no worker financeiro via symlink `/home/operacional/hydra/node_modules -> /home/operacional/hydra-deploy/current/node_modules`.
  2. Desbloqueada a execução horária de metas e vendas.

---

### Tarefa 5: Validação End-to-End e Teste de Despacho Seguro
- **Status:** `[x] CONCLUÍDO`
- **Alvo:** WhatsApp DEV_NUMBER (`5511996242812`)
- **Ações Realizadas:**
  1. Relatórios auditados entregues com sucesso para Davi via script `dispatch_to_davi_now.cjs`.
  2. Nenhuma mensagem disparada indevidamente para gerentes de loja ou grupos bloqueados.

---

### Tarefa 6: Plano de Consolidação, Git Push & Sincronização Final da VPS
- **Status:** `[x] CONCLUÍDO`
- **Alvo:** Repositório local, VPS e GitHub
- **Ações Realizadas:**
  1. Sincronização dos arquivos finais da VPS (`src/scraper.js`, `src/rede_session_bridge.js`, `src/excel_processor.js`, `src/state_manager.js`) para o repositório local.
  2. Registro das lições aprendidas na memória Obsidian (`.agent/memory/infra.md`).
  3. Atualização do grafo de conhecimento (`graphify update`).
  4. Arquivamento da spec em `specs/archive/`.
  5. Commit e push no GitHub.
