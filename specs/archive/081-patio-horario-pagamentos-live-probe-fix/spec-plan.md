# Plano de Execução — Spec 081: Sincronização Horária de Pagamentos no Pátio Ativo e Correção da Sonda Live

- [x] [SPECIALIST:specialist-crawler-rede] **T1 — Corrigir fuso UTC, seletor de status, aba Pagamentos e persistência dual em `os_live_probe.js`**
  - Implementar `parseTimestampUtcMs` em `projects/hydra-rede/src/os_live_probe.js` tratando timestamps SQLite sem `'Z'` (`YYYY-MM-DD HH:MM:SS`) como UTC real e priorizando `financeiro_updated_at`.
  - Em `probeOSLive`, clicar explicitamente na aba `Pagamentos` (`[id*="tapPagamento"]`), somar parcelas de `ucOrdemDeServicoPagamento_grd` como fallback, ler `select[id*="ddlStatus"] option:checked` sem poluir `status_grid`, remover a inferência cega `valorPago = totalOs` quando `txtRestante` estiver vazio, e persistir em `ordens_servico` (com `financeiro_updated_at` ISO UTC) e em `os_store_<slug>.json`.
  - **Aceite:** `node --check projects/hydra-rede/src/os_live_probe.js` retorna exit 0 e teste unitário/real confirma `necessitaRevalidacao = true` para timestamps SQLite UTC com > 5 min.
  - **Aceite (E2E Obrigatório):** Na VPS (`operacional@100.126.50.101`), executar `probeOSLive('1159', 'MPJorgeBeretta')` contra o ERP real comprovando retorno `valor_pago: 12548.7`, `valor_restante: 0`, `status_grid` limpo (`"EM DIAGNOSTICO"` ou código da grade, sem `<option>` concatenadas) e atualização real em `hydra_ops.db` + `os_store_MPJorgeBeretta.json`.

- [x] [SPECIALIST:specialist-crawler-rede] **T2 — Versionar `patio_ativo_crawler.ts` com extração financeira de OSs abertas e sincronizar `hourly_finance_worker.ts`**
  - Trazer `src/hydra-sync/patio_ativo_crawler.ts` e o delta de `src/hydra-sync/hourly_finance_worker.ts` da VPS para o repositório Git, eliminando o drift.
  - Enriquecer `coletarPatioAtivoLoja` para abrir o detalhe de cada OS aberta na grade (~21 veículos na rede), ativar `tapPagamento`, extrair `total_os`, `valor_pago`, `valor_restante` e `pagamentos`, e fazer UPSERT completo em `os_store_<slug>.json` e `ordens_servico` (garantindo coluna `financeiro_updated_at` em ISO UTC `'Z'`).
  - **Aceite:** `npx tsc --noEmit` (ou validação estática dos módulos TS alterados) executa sem erros de tipagem nos arquivos tocados.
  - **Aceite (E2E Obrigatório):** Na VPS (`operacional@100.126.50.101`), executar coleta real de `coletarPatioAtivoLoja` para `MPJorgeBeretta` contra o ERP Oficina Inteligente vivo e comprovar em `hydra_ops.db` e `os_store_MPJorgeBeretta.json` que a OS `#1159` permanece com `valor_pago = 12548.7`, `valor_restante = 0` e `financeiro_updated_at` preenchido.

- [x] [SPECIALIST:specialist-messaging-whatsapp] **T3 — Corrigir Circuit Breaker UTC em `whatsapp_patio_dispatcher.js` e injetar totais vivos no Balão 1 em `run_group_balloon_dispatch.js`**
  - Em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`, incluir `financeiro_updated_at` na query de `carregarCarrosCriticosSinal` e aplicar `parseTimestampUtcMs` no cálculo de idade do Circuit Breaker.
  - Em `projects/hydra-rede/src/run_group_balloon_dispatch.js` (bloco `balloonType === '1'`), executar `carregarCarrosCriticosSinalAsync(2600, 0.50)` antes da montagem do resumo e atualizar `totalOSsAbertas`, `totalValorPatio` e `totalSaldoPendente` de `summaryData` via `recalcularSnapshotDiurno()`.
  - Criar suíte determinística `projects/hydra-rede/tests/test_patio_live_probe_and_balloon1.js`.
  - **Aceite:** `node projects/hydra-rede/tests/test_patio_live_probe_and_balloon1.js` retorna exit 0 com 100% dos testes aprovados.
  - **Aceite (E2E Obrigatório):** Na VPS, executar `node /home/operacional/hydra-rede/src/run_group_balloon_dispatch.js --balloon=1 --dry-run --force --target=dev` comprovando que a RANGER (`OS #1159` da Jorge Beretta) NÃO aparece mais como pendente sem sinal e que o `Saldo total pendente` do pátio ativo reflete a baixa de R$ 12.548,70 (zero envios reais em grupos).

- [x] [LEAD] **T4 — Deploy sincronizado na VPS, validação E2E integrada e higiene de repositório**
  - Sincronizar os arquivos validados em `/home/operacional/hydra-rede/src/`, `/home/operacional/hydra-deploy/current/src/hydra-sync/` e `/opt/bots/src/hydra-sync/` sem deixar arquivos `.bak` nas árvores ativas.
  - Executar a suíte de testes e o dry-run E2E completo na VPS validando logs, SQLite (`hydra_ops.db`), `os_store_MPJorgeBeretta.json` e integridade do Gatekeeper (`SEAL_BALAO_1_PATIO`).
  - **Aceite:** Todos os testes automatizados e checagens de sintaxe (`node --check` / `tsc`) aprovados com exit 0.
  - **Aceite (E2E Obrigatório):** Execução física real na VPS (`ssh operacional@100.126.50.101`) comprovando `OS #1159` com `valor_pago = 12548.7` no SQLite, `recalcularSnapshotDiurno()` com `status: 'SUCCESS'` (10/10 lojas) e simulação `--dry-run` do Balão 1 aprovada pelo Gatekeeper sem o falso positivo da Jorge Beretta.
