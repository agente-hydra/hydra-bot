# Plano de Execução: Reestruturação do Motor de Carros em Pátio & OS

**Spec ID:** `hydra-patio-engine-reconstruction`  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO COMANDO APPLY  

---

## Checklist de Tarefas

- [x] **1. [ADAPTER] Validação de Crawl Fresco & Ingestão Nativa (`src/patio_hydra_bot_adapter.js`)**
  - [x] Implementar detecção de caminho local da VPS (`/home/operacional/hydra-data/crawls`) com fallback para `data/bot-crawls/`.
  - [x] Adicionar checagem de frescor dos arquivos `os_store_*.json` (validando que o crawl rodou e finalizou com sucesso).

- [/] **2. [LEDGER] Reestruturação do Motor de Conciliação D-1 (`src/patio_ledger_engine.js`)**
  - [/] Implementar filtro estrito de elegibilidade temporal:
    - Entrada $\le$ Referência D-1.
    - Aberta (sem data de finalização, inclusive de meses anteriores e saldo zero) OU Finalizada exatamente em D-1.
    - Descartar ordens finalizadas antes de D-1.
  - [/] Preservar saldo pendente informado pelo ERP (`restanteERP`) sem abater novamente os pagamentos do dia.
  - [/] Filtrar estritamente pagamentos cuja data de inclusão/vencimento seja exatamente D-1 (pagamentos antigos ficam em branco `—`).
  - [/] Classificar os tipos de destaque:
    - `YARD_EXIT`: OS finalizada em D-1 (saída de pátio).
    - `NEW_PAYMENT`: OS aberta que recebeu pagamento em D-1.
    - `NONE`: OS aberta sem pagamento em D-1.
  - [/] Unificar a ordenação de ponta a ponta por `osNumber DESC` (sem divisão por blocos de saldo).

- [ ] **3. [EXCEL] Calibração Visual dos Destaques na Planilha (`src/excel_patio_builder.js`)**
  - [ ] Implementar destaque de linha inteira (Colunas B..E) para ordens com status `YARD_EXIT` (fundo âmbar suave `#FEF3C7` + tag `[Finalizada em DD/MM]`).
  - [ ] Implementar destaque isolado somente na célula `E` (`PAGAMENTOS:`) para ordens com status `NEW_PAYMENT` (fundo azul suave `#E0F2FE`, borda `#7DD3FC`, texto `#0369A1` e badge `🔵`).
  - [ ] Manter células das ordens com status `NONE` no padrão normal (fundo branco/zebra `#F8FAFC` e pagamento `—`).
  - [ ] Renderizar todas as OSs da loja na sequência decrescente estrita de OS.

- [ ] **4. [DISPATCHER] Atualização do Resumo Executivo e WhatsApp (`src/whatsapp_patio_dispatcher.js` & `src/run_patio_daily.js`)**
  - [ ] Adequar o resumo executivo e a mensagem do WhatsApp para destacar:
    - Veículos em pátio ativo (OSs abertas com e sem saldo).
    - Veículos que saíram ontem (OSs finalizadas em D-1).
    - Total de saldo pendente real.
    - Total de recebimentos de ontem por modalidade (Pix, Crédito, Débito, Dinheiro).

- [ ] **5. [HOOK VPS] Encadeamento Automático pós-Crawler na VPS**
  - [ ] Adicionar gatilho no script diário da VPS (`run-hydra-daily-full.sh`) para chamar a rotina de Pátio assim que o crawler finalizar o ciclo com sucesso.

- [ ] **6. [TEST & VALIDATION] Validação com os Dados Reais Coletados Hoje (08/10/2026)**
  - [ ] Executar conciliação do dia com os dados reais de hoje (referência 07/10/2026).
  - [ ] Conferir os destaques visuais: linha inteira para finalizadas ontem vs. célula única para abertas com pagamento novo.
  - [ ] Validar a ausência de duplo desconto no saldo e a integridade da ordenação decrescente de OS.

---

## Circuit Breaker (SDD Hard Stop)
**PARE.** Proposta, design e plano de execução documentados em `specs/hydra-patio-engine-reconstruction/`. Nenhuma alteração no código de produção foi feita. Aguardando o comando de aprovação para iniciar a implementação.
