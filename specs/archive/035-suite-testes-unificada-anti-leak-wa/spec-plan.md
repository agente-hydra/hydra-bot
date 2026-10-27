# Spec-Plan — 035: Suíte Unificada de Testes e Zero-Leak WhatsApp Guard

**ID:** `035-suite-testes-unificada-anti-leak-wa`  
**Estimativa:** 4 fases atômicas + validação

---

## Tasks Atômicas

### [MOCK-GUARD] Implementar Zero-Leak WhatsApp Guard em `whatsapp_patio_dispatcher.js`
- [x] `[MOCK-1]` Adicionar `isMockModeActive()` checando `HYDRA_TEST_MODE === '1'`, `EVO_DRY_RUN === '1'` ou `global.__HYDRA_MOCK_WA__ === true`.
- [x] `[MOCK-2]` Inicializar fila de auditoria em memória `global.__HYDRA_MOCKED_MESSAGES__`.
- [x] `[MOCK-3]` Injetar interceptor em `sendText()` retornando `{ ok: true, mocked: true, ... }` com log sem disparar requisição axios.
- [x] `[MOCK-4]` Injetar interceptor em `sendDocument()` retornando `{ ok: true, mocked: true, ... }` com log sem disparar requisição axios.
- [x] `[MOCK-5]` Exportar `isMockModeActive` no `module.exports`.

### [SUITE-RUNNER] Reestruturar `scripts/suite_testes_integridade.js` (8 Blocos)
- [x] `[SUITE-1]` Ativar `process.env.HYDRA_TEST_MODE = '1'` e `global.__HYDRA_MOCK_WA__ = true` antes de qualquer import.
- [x] `[SUITE-2]` Bloco 1: SQLite & Ops (PRAGMA integrity_check, WAL, tabelas essenciais incluindo `cmv_lojas` e `hydra_store_managers`).
- [x] `[SUITE-3]` Bloco 2: Oficina Integrada & Pátio (PM2 oi-sync, histórico de crawls, `check_patio_freshness.js`, extração de checklists de mecânico).
- [x] `[SUITE-4]` Bloco 3: Motor Rede & Pureza Contábil (resolução de datas, 10 lojas mapeadas, Cutoff Gate 19:30 BRT, **expurgo estrito de PIX**).
- [x] `[SUITE-5]` Bloco 4: Conciliação Pátio x Rede & Sanity Gate (`test_conciliacao_patio_rede.js` e auditoria de loja faturada no Pátio vs zerada na Rede).
- [x] `[SUITE-6]` Bloco 5: Watchdog 06:00 AM (execução em sandbox do `run_morning_watchdog_0600.js` com auditoria dos 5 arquivos e probe do WhatsApp).
- [x] `[SUITE-7]` Bloco 6: Balões Executivos (simulação em sandbox dos Balões 1, 2 full, 2 simplified e 3 closing).
- [x] `[SUITE-8]` Bloco 7: CMV KPI Alert por Gerente (Spec 034 — validação de faixas de KPI, pátio com/sem checklist, template executivo para os 10 gerentes).
- [x] `[SUITE-9]` Bloco 8: Segurança & Retenção Zero-Leak (teste de blocklist e verificação de que `global.__HYDRA_MOCKED_MESSAGES__` reteve 100% dos envios com 0 chamadas externas).

### [SCRIPTS-DEFENSE] Blindagem Defensiva dos Scripts de Teste
- [x] `[DEF-1]` Adicionar `process.env.HYDRA_TEST_MODE = '1';` no topo de `src/test_cmv_kpi_gerentes.js`, `src/test_whatsapp_patio.js`, `src/test_unified_morning_dispatch.js` e `src/test_dispatch_validation_phone.js`.
- [x] `[DEF-2]` Configurar `"test": "node scripts/suite_testes_integridade.js"` no `package.json` da VPS e local.

### [VALIDATION] Execução e Prova de Integridade
- [x] `[VAL-1]` Executar `npm test` na VPS e validar aprovação de 100% dos 8 blocos de teste.
- [x] `[VAL-2]` Comprovar no log que ZERO requisições HTTP foram enviadas para a Evolution API e que todas foram retidas pelo Mock Guard.
- [x] `[VAL-3]` Validar sintaxe (`node -c`) de todos os arquivos modificados.

### [SYNC] Sincronização Local
- [x] `[SYNC-1]` Espelhar arquivos atualizados em `projects/hydra-rede/` local.

---

## Critério de Conclusão

- [x] `npm test` na VPS executa os 8 blocos sem erros.
- [x] 0 mensagens disparadas para a Evolution API durante os testes.
- [x] 100% dos testes aprovados com relatório visual no terminal.
- [x] Testes de Watchdog 06:00 AM, Expurgo PIX, Cutoff 19:30, Sanity Gate e CMV por Gerente totalmente integrados à suíte.
