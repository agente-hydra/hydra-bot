# Plano de Execução: Blindagem Sistêmica da Esteira Noturna e Sonda das 06:00 AM

Este plano atômico de engenharia será executado na fase `/sdd-apply`.

---

## Fase 1: Cutoff Gate de Fechamento Operacional (state_manager.js & run_nightly_prep.js)

- [x] `[CODE/STATE]` Implementar função `isDownloadFinalClosing(filePath, targetDateISO)` com cutoff de 19:30 BRT em `/home/operacional/hydra-rede/src/state_manager.js`.
- [x] `[CODE/STATE]` Atualizar `findExistingDownload` em `src/state_manager.js` para rejeitar downloads intradiários com `mtime < 19:30` quando executado em fechamentos noturnos ou de dias anteriores.
- [x] `[CODE/NIGHTLY]` Modificar `run_nightly_prep.js` para validar se a planilha `Juros Rede - *.xlsx` foi gerada após as 19:30; se for intradiária, marcá-la como `PENDENTE` forçando reextração completa.

---

## Fase 2: Criação do Watchdog das 06:00 AM (run_morning_watchdog_0600.js)

- [x] `[CODE/WATCHDOG]` Criar o orquestrador `/home/operacional/hydra-rede/src/run_morning_watchdog_0600.js` cobrindo a auditoria completa do Quinteto Oficial, Sanity Gate e Sonda de WhatsApp.
- [x] `[CRON/VPS]` Adicionar entrada no crontab da VPS para disparar `run_morning_watchdog_0600.js` pontualmente às `06:00:00 AM` (Segunda a Sexta).
- [x] `[ALERT/DEV]` Implementar roteamento de alerta antecipado para o Dev às 06:05 AM caso qualquer módulo não consiga ser auto-recuperado.

---

## Fase 3: Pre-Flight WhatsApp & Auto-Healing (Sonda 06:00 AM e 07:58 AM)

- [x] `[CODE/WATCHDOG]` Implementar função `probeAndHealEvolutionInstance('hydra')` com auto-restart na Evolution API e verificação de socket `open`.
- [x] `[CODE/ORCHESTRATOR]` Injetar pre-flight check rápido em `src/run_unified_morning_dispatch.js` às 07:58 AM antes de submeter os arquivos ao Financeiro.
- [x] `[CODE/FIX]` Corrigir escopo léxico de `let dispatchRes = null;` e proteger linha 734 contra `ReferenceError`.

---

## Fase 4: Sanity Gate Cruzado Pátio x Rede (sanity_gate_patio_rede.js)

- [x] `[CODE/SANITY]` Criar módulo `/home/operacional/hydra-rede/src/sanity_gate_patio_rede.js` com detecção de lojas que faturaram cartão no Pátio mas vieram R$ 0,00 na Rede.
- [x] `[CODE/INTEGRATION]` Integrar reextração cirúrgica automática via CLI (`node src/index.js --loja=<nome> --now --skip-wa`) acionada pelo Watchdog das 06:00 AM.

---

## Fase 5: Pureza Contábil (Expurgo de PIX)

- [x] `[CODE/EXCEL]` Garantir teste unitário para `continue;` no bloco `if (isPix)` de `/home/operacional/hydra-rede/src/excel_processor.js`.
- [x] `[TEST/UNIT]` Validar que o `Relatório de Juros` não contém transações de PIX e que os totais contábeis de cartão permanecem limpos.

---

## Fase 6: Testes Integrados e Homologação na VPS

- [x] `[TEST/INTEGRATION]` Executar simulação do Watchdog das 06:00 AM em modo `--dry-run` e validar logs.
- [x] `[DEPLOY/SYNC]` Validação em dry-run concluída com 100% de sucesso (preparado para `/vibe-archive 033-robustez-definitiva-esteira-rede`).
