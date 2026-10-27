# Spec-Plan — 034: CMV KPI Alert por Gerente (Quarta e Sexta)

**ID:** `034-cmv-kpi-alerta-gerentes-quarta-sexta`  
**Estimativa:** 3-4 tasks críticas + 2 de validação

---

## Tasks Atômicas

### [DISPATCHER] Adicionar `formatarMsgCmvKpiGerente()` em `whatsapp_patio_dispatcher.js`
- [x] `[DISPATCHER-1]` Implementar `classifyKPI(cmvPct)` — retorna `{ label, emoji, faixa }` conforme faixas do usuário (≤21.99 BOM, 22-24.99 OBJ, 25-26.99 ALERTA, 27-29.99 FORA, ≥30 CRÍTICO)
- [x] `[DISPATCHER-2]` Implementar `carregarPatioChecklist(slug)` — lê `os_store_<slug>.json`, valida mtime (< 12h), conta `is_aberta=true` total, `comChecklist` (`.checklists.length > 0`), `semChecklist`, retorna `{ totalAbertas, comChecklist, semChecklist, stale: bool }`
- [x] `[DISPATCHER-3]` Implementar `formatarMsgCmvKpiGerente({ loja, cmvData, patioData, dateBR })` — monta a mensagem WA com template exato do design.md, fallbacks para stale e null
- [x] `[DISPATCHER-4]` Exportar `classifyKPI`, `carregarPatioChecklist`, `formatarMsgCmvKpiGerente` no `module.exports` do `whatsapp_patio_dispatcher.js`

### [ORQUESTRADOR] Criar `src/run_cmv_kpi_gerentes.js`
- [x] `[ORCH-1]` Setup: imports de `whatsapp_patio_dispatcher.js` (`sendText`, `carregarDadosCmvEMetas`, `formatarMsgCmvKpiGerente`, `carregarPatioChecklist`, `probeAndHealEvolutionInstance`, `DEV_NUMBER`), `feriados_calendario.js` (`verificarFeriado`), `better-sqlite3`
- [x] `[ORCH-2]` Suporte a args: `--dry-run`, `--immediate`, `--force`, `--date=YYYY-MM-DD`, `--target=<phone>` (override único, para testes)
- [x] `[ORCH-3]` Gate 1 — verificar feriado: se `verificarFeriado(today)` → log "feriado, abortando" e sair
- [x] `[ORCH-4]` Gate 2 — Pre-flight WhatsApp: `probeAndHealEvolutionInstance('hydra')`, se `!ok` → `enviarAlertaDev` + sair
- [x] `[ORCH-5]` Gate 3 — Idempotência por turno: lock em `/home/operacional/hydra-data/locks/cmv_kpi_gerentes_<date>.lock`, se existe e `!isForce` → sair sem erro
- [x] `[ORCH-6]` Carregar CMV: `carregarDadosCmvEMetas()` → `cmvData.lojas`
- [x] `[ORCH-7]` Carregar gerentes: query `hydra_ops.db` → `SELECT * FROM hydra_store_managers WHERE is_active=1`
- [x] `[ORCH-8]` Loop por gerente:
  - Cruzar `manager.loja_slug` com `cmvData.lojas` (matchStore)
  - Se `cmvPercentual === null` → log WARN + skip (sem envio)
  - `carregarPatioChecklist(manager.loja_slug)` → `patioData`
  - `formatarMsgCmvKpiGerente(...)` → `texto`
  - Se `!isDryRun` → `sendText(texto, manager.phone_canonical)`
  - Log resultado (ok/fail) por gerente
- [x] `[ORCH-9]` Resumo final: quantos enviados / falhas / skips, alerta Dev se falhas > 0
- [x] `[ORCH-10]` Criar lock após loop bem-sucedido

### [INFRA] Crontab VPS
- [x] `[INFRA-1]` Adicionar entrada no crontab da VPS:
  ```
  # 034 — CMV KPI Alert Individual por Gerente (Quarta e Sexta, 14:30 BRT)
  30 14 * * 3,5 /usr/bin/node /home/operacional/hydra-rede/src/run_cmv_kpi_gerentes.js --immediate >> /home/operacional/hydra-data/logs/cmv-kpi-gerentes.log 2>&1
  ```

### [TESTE] Validação
- [x] `[TESTE-1]` Criar `src/test_cmv_kpi_gerentes.js` — executa com `--dry-run` e verifica:
  - Todas as 10 lojas carregadas do CMV
  - Todos os gerentes com `is_active=1` cobertos
  - `classifyKPI` validado com valores de borda (21.99, 22.00, 24.99, 25.00, 26.99, 27.00, 29.99, 30.00)
  - Mensagens formatadas sem `undefined` ou campos vazios
- [x] `[TESTE-2]` Teste end-to-end `--target=5511996242812` (Dev) com uma loja real — confirmar recebimento no WhatsApp do Dev

### [SYNC] Sincronizar Local
- [x] `[SYNC-1]` Copiar `src/run_cmv_kpi_gerentes.js` e `src/test_cmv_kpi_gerentes.js` para `projects/hydra-rede/src/` local

---

## Critério de Conclusão

- [x] `--dry-run` sem erros, 10 lojas cobertas
- [x] Teste end-to-end `--target=dev` confirmado no WhatsApp
- [x] Lock de idempotência funcional
- [x] Cron injetado na VPS (`crontab -l` confirma)
- [x] `node -c src/run_cmv_kpi_gerentes.js` → sem erro de sintaxe

---

## Notas de Implementação

> [!IMPORTANT]
> A instância remetente é **sempre** `hydra` (via `EVO_INSTANCE` do `.env`). Os `phone_canonical` dos gerentes são **destinos**, nunca remetentes. A regra do AGENTS.md que proíbe gerentes refere-se a instâncias emisssoras (remetentes), não a números que recebem mensagens.

> [!NOTE]
> `carregarDadosCmvEMetas()` já retorna dados reais do `hydra_ops.db`. Hoje (27/10) confirmado com CMV real: Rudge 22,36%, Santo André 22,6%, Jabaquara 24,22%, Jorge Beretta 25,94%, Kennedy 14,89%.

> [!WARNING]
> A tabela `hydra_store_managers` tem `instance_evolution` com nomes de gerentes (ex: `"Jabaquara"`, `"Kennedy"`). **NÃO usar essa coluna para envio.** Remetente = instância `hydra`. Destinatário = `phone_canonical`.
