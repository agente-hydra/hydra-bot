# Plano de Execução: Reestruturação do Motor de Carros em Pátio & OS

**Spec ID:** `hydra-patio-engine-reconstruction`  
**Status:** IMPLEMENTADO COM SUCESSO / AGUARDANDO /vibe-archive  

---

## Checklist de Tarefas

- [x] **1. [ADAPTER] Validação de Crawl Fresco & Ingestão Nativa (`src/patio_hydra_bot_adapter.js`)**
  - [x] Implementar detecção de caminho local da VPS (`/home/operacional/hydra-data/crawls`) com fallback para `data/bot-crawls/`.
  - [x] Adicionar checagem de frescor dos arquivos `os_store_*.json` (validando que o crawl rodou e finalizou com sucesso).

- [x] **2. [LEDGER] Reestruturação do Motor de Conciliação D-1 (`src/patio_ledger_engine.js`)**
  - [x] Implementar filtro estrito de elegibilidade temporal:
    - Entrada $\le$ Referência D-1.
    - Aberta (sem data de finalização, inclusive de meses anteriores e saldo zero) OU Finalizada exatamente em D-1.
    - Descartar ordens finalizadas antes de D-1.
  - [x] Preservar saldo pendente informado pelo ERP (`restanteERP`) sem abater novamente os pagamentos do dia.
  - [x] Filtrar estritamente pagamentos cuja data de inclusão/vencimento seja exatamente D-1 (pagamentos antigos ficam em branco `—`).
  - [x] Classificar os tipos de destaque:
    - `YARD_EXIT`: OS finalizada em D-1 (saída de pátio).
    - `NEW_PAYMENT`: OS aberta que recebeu pagamento em D-1.
    - `NONE`: OS aberta sem pagamento em D-1.
  - [x] Unificar a ordenação de ponta a ponta por `osNumber DESC` (sem divisão por blocos de saldo).

- [x] **3. [EXCEL] Calibração Visual dos Destaques na Planilha (`src/excel_patio_builder.js`)**
  - [x] Implementar destaque de linha inteira (Colunas B..E) para ordens com status `YARD_EXIT` (fundo âmbar suave `#FEF3C7`, borda `#FCD34D`, texto `#92400E` + tag `[Finalizada em DD/MM]`).
  - [x] Implementar destaque isolado somente na célula `E` (`PAGAMENTOS:`) para ordens com status `NEW_PAYMENT` (fundo azul suave `#E0F2FE`, borda `#7DD3FC`, texto `#0369A1` e badge `🔵`).
  - [x] Manter células das ordens com status `NONE` no padrão normal (fundo branco/zebra `#F8FAFC` e pagamento `—`).
  - [x] Renderizar todas as OSs da loja na sequência decrescente estrita de OS.

- [x] **4. [DISPATCHER] Atualização do Resumo Executivo e WhatsApp (`src/whatsapp_patio_dispatcher.js` & `src/run_patio_daily.js`)**
  - [x] Adequar o resumo executivo e a mensagem do WhatsApp para destacar:
    - Veículos em pátio ativo (29 OSs abertas com e sem saldo).
    - Veículos que saíram ontem (19 OSs finalizadas em D-1).
    - Total de saldo pendente real (R$ 39.889,65).
    - Total de recebimentos de ontem por modalidade (Pix: R$ 14.443,46, Crédito: R$ 36.931,82, Débito: R$ 2.007,60).

- [x] **5. [HOOK VPS] Encadeamento Automático pós-Crawler na VPS**
  - [x] Implantar código em `/home/operacional/hydra-rede/` na VPS com dependências de produção.
  - [x] Configurar encadeamento atômico no crontab da VPS (`15 3 * * * /home/operacional/hydra/scripts/run-hydra-daily-full.sh && /home/operacional/hydra-rede/scripts/run-patio.sh`).
  - [x] Garantir que a rotina captura os dados frescos do crawler imediatamente às ~03:45 AM, gera a planilha e agenda o disparo para 08:00 AM para a diretoria, com fallback de alerta para o Dev (+55 11 99624-2812).

- [x] **6. [TEST & VALIDATION] Validação com os Dados Reais Coletados Hoje (08/10/2026)**
  - [x] Executada conciliação real na VPS com os dados do crawler das 03:43 AM de hoje (referência 07/10/2026).
  - [x] Validados os destaques visuais: linha inteira âmbar para OS 8836 finalizada vs. célula única azul para OS 8832 e OS 8829 com pagamento novo.
  - [x] Validada a integridade dos saldos (sem duplo desconto) e ordenação decrescente de OS.
  - [x] Resumo e planilha entregues com sucesso via WhatsApp (`hydra`) para o número do Dev.

---

## Circuit Breaker (SDD Hard Stop)
**PARE.** Todas as 6 tarefas do plano foram implementadas, implantadas e testadas com dados reais na VPS Linux. Aguardando comando `/vibe-archive` para consolidar o ciclo.
