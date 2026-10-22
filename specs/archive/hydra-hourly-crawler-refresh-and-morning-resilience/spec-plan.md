# SDD Spec-Plan: Atualização Horária Unificada & Blindagem Matinal Hydra

Este plano define as tarefas atômicas a serem executadas na fase `/sdd-apply`.

## Metadados
- **ID:** `hydra-hourly-crawler-refresh-and-morning-resilience`
- **Ambiente:** VPS Linux (`operacional@100.126.50.101`)
- **Instância WhatsApp Autorizada:** Exclusivamente `hydra` (alertas apenas para DEV: `5511996242812`)

---

## Tarefas de Implementação

### Tarefa 1: Escalonamento do Crontab na VPS (Anti-Colisão de Locks)
- **Status:** `[ ] PENDENTE`
- **Alvo:** `crontab -l` do usuário `operacional` na VPS
- **Ações:**
  1. Escalonar jobs horários em minutos distintos:
     - `:05` -> `run-hydra-hourly-finance.sh` (Metas & CMV)
     - `:15` -> `run-hydra-hourly-patio.sh` (Pátio & OS Incremental)
     - `:25` -> `run-hourly-contas.sh` (Contas a Pagar Ingestão)
  2. Ajustar esteira noturna para horários de vale:
     - `23:30, 02:30, 05:30` -> `run-nightly-prep.sh`
  3. Adicionar pre-flight da manhã:
     - `06:45` -> `run-nightly-prep.sh` (garantia de Mapa de Metas PDF)
     - `07:05` -> `run-preflight-rede.sh` (extração antecipada da Rede)
  4. Manter despacho oficial estritamente às `07:45 AM` (Segunda a Sexta).

---

### Tarefa 2: Worker Horário de Pátio & OS (Zero Mensagens)
- **Status:** `[ ] PENDENTE`
- **Alvo:** `/home/operacional/hydra/scripts/run-hydra-hourly-patio.sh` e `/home/operacional/hydra/src/hydra-sync/`
- **Ações:**
  1. Criar rotina de sync incremental de pátio que atualiza as OSs abertas para o SQLite `hydra_ops.db` e atualiza o timestamp de frescor por loja.
  2. Garantir que a execução seja 100% headless, silenciosa e sem chamadas a clientes WhatsApp.
  3. Validar que o `[Adapter] ⛔ BLOQUEIO DE FRESCOR` nunca estoure 12h durante as manhãs.

---

### Tarefa 3: Expurgar o "Espelhamento Fantasma" de Relatórios Velhos
- **Status:** `[ ] PENDENTE`
- **Alvo:** `/home/operacional/hydra-rede/src/run_unified_morning_dispatch.js` e `run_nightly_prep.js`
- **Ações:**
  1. Remover completamente o trecho de código que copia a planilha mais recente do disco (`fs.copyFileSync(maisRecente, jurosHojePath)`).
  2. Substituir por validação estrita: se a planilha da data-alvo não foi gerada, o módulo falha de forma transparente, emitindo alerta para o Dev sem maquiar números nem contaminar a conciliação.
  3. Remover qualquer cópia fantasma residual em `run_nightly_prep.js`.

---

### Tarefa 4: Pre-Flight Matinal da Rede (07:05 AM)
- **Status:** `[ ] PENDENTE`
- **Alvo:** `/home/operacional/hydra-rede/scripts/run-preflight-rede.sh`
- **Ações:**
  1. Criar script de pre-flight que roda às 07:05 AM executando `node src/index.js --build-only --now`.
  2. O scraper roda com lock `/tmp/hydra_rede.lock`, headless e com retry de login de 30s.
  3. Às 07:45 AM, o orquestrador apenas encontra a planilha já pronta em `output/` e foca na validação rápida e despacho.

---

### Tarefa 5: Blindagem de Janela de Fins de Semana e Feriados
- **Status:** `[ ] PENDENTE`
- **Alvo:** `/home/operacional/hydra-rede/src/date_resolver.js` e `src/feriados_calendario.js`
- **Ações:**
  1. Na Segunda-feira, a janela de agregação de transações e OSs deve cobrir rigorosamente Sexta ($D-3$), Sábado ($D-2$) e Domingo ($D-1$).
  2. Rejeitar terminantemente inclusão de dados de Quinta-feira ($D-4$) ou datas anteriores.
  3. Manter os crawlers ativos no fim de semana para que na Segunda-feira às 07:00 AM os dados já estejam no banco.

---

### Tarefa 6: Validação End-to-End na VPS & Build Gate
- **Status:** `[ ] PENDENTE`
- **Alvo:** VPS Linux
- **Ações:**
  1. Validar sintaxe com `node --check` em todos os scripts modificados.
  2. Executar dry-run da esteira matinal com `--dry-run`.
  3. Confirmar que nenhum WhatsApp foi enviado e que o crontab foi salvo com sucesso.
