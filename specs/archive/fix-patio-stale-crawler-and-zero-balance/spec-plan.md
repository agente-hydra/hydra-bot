# Plano de Execução: Recuperação dos Dados de Pátio Zerados & Blindagem de Frescor do Deep Crawler

**Spec ID:** `fix-patio-stale-crawler-and-zero-balance`  
**Data:** 22/10/2026  
**Status:** Implementado (SDD Apply Concluído)  

---

## Tarefas de Implementação

- [x] [LOCK-DECOUPLING] **Desacoplar Locks de Concorrência do Deep Crawler**
  - Em `scripts/run-hydra-daily-full.sh`:
  - Migrar `LOCK_FILE` de `/tmp/hydra-data-refresh.lock` para `/tmp/hydra-deep-crawler.lock`.
  - Garantir que o worker de metas horárias (`run-hydra-hourly-finance.sh`) não bloqueie nem cancele a esteira noturna/matinal do Deep Crawler.

- [x] [DEEP-CRAWL-EXEC] **Executar Ingestão Factual do Deep Crawler para as 10 Lojas**
  - Na VPS Linux (`operacional@100.126.50.101`):
  - Executar `run-hydra-daily-full.sh` utilizando o binário compilado do `tsx` em `node_modules/tsx/dist/cli.mjs`.
  - Extrair as 10 lojas ativas: Planalto, Piraporinha, Mauá, Kennedy, Rudge Ramos, Santo André, Rei do Módulo, Jorge Beretta, Dom Pedro I e Jabaquara.
  - Verificar ingestão de pagamentos de 21/10/2026 e 22/10/2026 no SQLite `hydra_ops.db` e geração dos 10 arquivos `os_store_<slug>.json` em `/home/operacional/hydra-data/crawls/`.

- [x] [LEDGER-REPROCESS] **Reprocessar Ledger Mensal de Pátio com Dados Frescos**
  - Em `projects/hydra-rede`:
  - Reprocessar o ciclo D-1 de `21/10/2026` no `patio_ledger_engine.js`.
  - Atualizar `data/patio_ledger_2026-10.json` com os pagamentos de cartão, débito e PIX identificados nas OSs de 21/10 (R$ 46.035,82 arrecadados, 17 OSs fechadas).

- [x] [PATIO-EXCEL-REGEN] **Regenerar Planilha Oficial de Carros em Pátio**
  - Executar `node src/run_patio_daily.js --build-only --no-sync` para `22-10-2026`.
  - Validar inspeção via Node/xlsx:
    - Aba `Resumo Pátio`: conferir valores reais em `Recebido Ontem (R$)` para todas as 10 unidades.
    - Aba `OS`: certificar que a coluna `PAGAMENTOS:` exibe as modalidades e parcelas reais (sem `"—"` generalizado).

- [x] [CONCILIACAO-REGEN] **Regenerar e Reconciliar Pátio x Rede (8 Abas)**
  - Executar `node src/run_conciliacao_daily.js --date=2026-10-22` para `22-10-2026`.
  - Validar que as transações de Rede que antes estavam em *"Sobrando na Rede (Sem OS)"* agora conciliam:
    - Kennedy (R$ 13.617,63 conciliados — 100% acurácia).
    - Dom Pedro I (R$ 6.234,90 conciliados — 100% acurácia).
    - Santo André, Rudge Ramos, Mauá, Rei do Módulo, Jorge Beretta e Planalto (todas 100% conciliadas).
  - Confirmar salto do índice de acurácia global de **14% para 97,5%** (R$ 38.755,74 conciliados de R$ 39.755,74).

- [x] [GUARD-ANTI-STALE] **Implementar Trava Anti-Disparo Stale e Alerta de Vacuidade**
  - Em `projects/hydra-rede/src/run_unified_morning_dispatch.js`:
  - Bloquear envio matinal para diretoria/financeiro caso o índice de acurácia da conciliação seja `< 20%` com a Rede faturando mais de R$ 5.000,00 ou >= 4 lojas com Pátio zerado.
  - Reter o despacho e disparar alerta forense prioritário para o Dev (`11996242812`).

- [x] [AUDIT-AND-DELIVERY] **Auditoria e Entrega dos Relatórios Corrigidos**
  - Disparar a Conciliação e o Pátio regenerados com os dados reais para o Davi (`11996242812`) via instância autorizada `hydra`.
