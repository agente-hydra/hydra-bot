# Plano de Execução: Correção do Envio Matinal da Rede, Lojas Zeradas e Expurgo de PIX

Este plano atômico será executado na fase `/sdd-apply`.

---

## Fase 1: Infraestrutura WhatsApp & Correção do Orquestrador Matinal

- [ ] `[INFRA/WHATSAPP]` Restabelecer conexão da instância `hydra` via Evolution API (`POST /instance/restart/hydra` ou `POST /instance/connect/hydra`) e validar estado `open`.
- [ ] `[CODE/ORCHESTRATOR]` Corrigir escopo léxico de `dispatchRes` em `/home/operacional/hydra-rede/src/run_unified_morning_dispatch.js` (linha 592 e 734) para eliminar `ReferenceError`.
- [ ] `[CODE/ORCHESTRATOR]` Implementar pre-flight check da instância `hydra` com auto-restart defensivo em `src/run_unified_morning_dispatch.js`.

---

## Fase 2: Expurgo de PIX & Stale Intraday Snapshot Gate

- [ ] `[CODE/EXCEL]` Modificar `/home/operacional/hydra-rede/src/excel_processor.js` para descartar transações com `isPix === true` do array de vendas de cartão e dos totais contábeis da planilha.
- [ ] `[CODE/STATE]` Modificar `/home/operacional/hydra-rede/src/state_manager.js` para ignorar downloads com `mtime < 18:30` ao consolidar fechamentos noturnos ou de dias anteriores (D-1).
- [ ] `[CODE/NIGHTLY]` Modificar `/home/operacional/hydra-rede/src/run_nightly_prep.js` para invalidar a planilha `JUROS_REDE` caso tenha sido gerada antes do fechamento das 20:00.

---

## Fase 3: Reprocessamento Retroativo do Dia 26/10/2026

- [ ] `[DATA/CLEANUP]` Purgar arquivos intradiários de 26/10 em `/home/operacional/hydra-rede/downloads/` e resetar o checkpoint `data/state_2026-10-26.json`.
- [ ] `[SCRAPER/RUN]` Executar o scraper da Rede (`node src/index.js --data=26/10/2026 --skip-wa`) para baixar o extrato fechado integral das 10 lojas credenciadas.
- [ ] `[EXCEL/BUILD]` Reconstruir a planilha oficial `output/Juros Rede - 26-10-2026.xlsx` e sincronizar com a cópia canônica.
- [ ] `[CONCILIACAO/BUILD]` Reexecutar a conciliação analítica (`node src/run_conciliacao_daily.js --data=27/10/2026`) gerando `output/relatorios/Conciliacao Patio x Rede - 27-10-2026.xlsx` com base nas vendas reais completas.

---

## Fase 4: Auditoria de Veracidade & Disparo Oficial

- [ ] `[AUDIT/VERIFY]` Inspecionar a planilha `Juros Rede - 26-10-2026.xlsx`: confirmar que Santo André possui vendas faturadas (> R$ 0,00) e que nenhuma linha de PIX está presente no relatório de juros.
- [ ] `[AUDIT/VERIFY]` Validar consistência do Quinteto Matinal no disco (5/5 arquivos íntegros > 1KB).
- [ ] `[DISPATCH/OFFICIAL]` Executar o disparo matinal em modo real para o Financeiro (`5511940667032`) e Diretoria (`5511996242812`).
- [ ] `[LOCK/REGISTER]` Registrar lock de idempotência diária para garantir rastreabilidade.
