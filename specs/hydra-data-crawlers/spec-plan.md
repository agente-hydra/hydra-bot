# Plano de Execução — Atualização dos Dados do Hydra (Crawlers & Ingestão Operacional)

> **ID da Spec:** `hydra-data-crawlers`  
> **Status:** AGUARDANDO APROVAÇÃO (HARD STOP)  
> **Data:** 2026-09-30  
> **Base de Branch:** `bd26c7f` (`codex/manager-store-scope` em `hydra-staging`)  

---

## Matriz de Rastreabilidade das Tarefas

| ID | Fase | Responsável | Worktree / Diretório | Arquivos Afetados | Critério de Aceite |
|---|---|---|---|---|---|
| `TASK-01` | Setup | Principal | `/home/operacional/` | N/A (git worktrees) | `[x]` 3 worktrees criadas a partir de `bd26c7f` |
| `TASK-02` | Frente 1 | Agente 1 | `hydra-agent1-cmv` | `relatorio_operacao_crawler.ts` | `[x]` Extração de áreas, mídia e CMV com validação de totais |
| `TASK-03` | Frente 1 | Agente 1 | `hydra-agent1-cmv` | `deep-crawler.ts` | `[x]` Loop sequencial 10 lojas: OS -> Gestão Periódica na mesma passada |
| `TASK-04` | Frente 1 | Agente 1 | `hydra-agent1-cmv` | `tests/test_agent1_crawler_operacao.ts` | `[x]` 100% PASS em troca de empresa, falha parcial e idempotência |
| `TASK-05` | Frente 2 | Agente 2 | `hydra-agent2-finance` | `metas_crawler.ts` | `[x]` Coleta do Mapa de Metas para 10 lojas (excluindo MPMaster) |
| `TASK-06` | Frente 2 | Agente 2 | `hydra-agent2-finance` | `hourly_finance_worker.ts` | `[x]` Download oficial Vendas por Dia Excel + upsert de metas horárias |
| `TASK-07` | Frente 2 | Agente 2 | `hydra-agent2-finance` | `tests/test_agent2_finance_worker.ts` | `[x]` 100% PASS em parsing Excel, timezone SP e upsert horário |
| `TASK-08` | Frente 3 | Agente 3 | `hydra-agent3-harness` | `finance_snapshot_repository.ts` | `[x]` Consulta de último snapshot válido com detecção de stale |
| `TASK-09` | Frente 3 | Agente 3 | `hydra-agent3-harness` | `data_worker_log.ts` | `[x]` Registro e consulta de execuções em `hydra_data_worker_runs` |
| `TASK-10` | Frente 3 | Agente 3 | `hydra-agent3-harness` | `scripts/run-hydra-*.sh` | `[x]` Lock compartilhado flock (/tmp/hydra-data-refresh.lock) |
| `TASK-11` | Frente 3 | Agente 3 | `hydra-agent3-harness` | `tests/test_agent3_persistence_harness.ts` | `[x]` 100% PASS em lock de concorrência, stale check e 10/10 lojas |
| `TASK-12` | Integração | Principal | `hydra-staging` | Staging integrado | `[x]` Aplicação dos 3 patches sem conflito |
| `TASK-13` | Integração | Principal | `hydra-staging` | `operational_adapter.ts` | `[x]` Bot consultando novos snapshots oficiais com aviso amigável |
| `TASK-14` | Validação | Principal | VPS SQLite / Prod | `hydra_ops.db` | `[x]` 10/10 lojas com dados reais confirmados no SQLite |
| `TASK-15` | Conclusão | Principal | PM2 / Prod | N/A | `[x]` Build gate verde (tsc + 389 testes) e deploy seguro |

---

## Detalhamento das Fases

### Fase 0: Setup das Worktrees Isoladas (Executada pelo Agente Principal)
- Garantir que a branch de referência `codex/hourly-crawler` continue isolada apenas para consulta.
- Criar a partir de `bd26c7f`:
  1. `git worktree add /home/operacional/hydra-agent1-cmv -b feat/data-agent1-os-cmv bd26c7f`
  2. `git worktree add /home/operacional/hydra-agent2-finance -b feat/data-agent2-metas-vendasdia bd26c7f`
  3. `git worktree add /home/operacional/hydra-agent3-harness -b feat/data-agent3-persistence-harness bd26c7f`
- Copiar `/opt/bots/.env` e symlink de `node_modules` para cada worktree para garantir testes imediatos.

### Fase 1: Agente 1 — Ciclo OS → CMV por Loja (Operacional Diário)
- `TASK-02`: Inspecionar e implementar `relatorio_operacao_crawler.ts`:
  - Mapear `EMPRESAS_RELATORIO` contendo exclusivamente as 10 lojas operacionais.
  - Selecionar e confirmar a empresa com `ensureCompany`.
  - Extrair `faturamento_areas` e `pesquisa_midia` via DOM selector estável.
  - Validar linha totalizadora: `abs(sum(areas) - total) <= 1.00`.
- `TASK-03`: Em `deep-crawler.ts`:
  - Ciclo por loja sequencial: conclui OS da loja -> coleta CMV da mesma loja -> passa à próxima.
  - Circuit Breaker: falha em uma loja não cancela o crawl das demais lojas; preserva snapshots anteriores.
- `TASK-04`: Testes e Patch:
  - Rodar `npx tsx src/hydra-sync/tests/test_agent1_crawler_operacao.ts`.
  - Commitar na branch e exportar `/home/operacional/patch-agent1-crawler-operacao.diff`.

### Fase 2: Agente 2 — Coleta Financeira Horária (Metas e Vendas do Dia)
- `TASK-05`: Em `metas_crawler.ts`:
  - Coleta limpa para as 10 lojas operacionais com validação estrita.
- `TASK-06`: Em `hourly_finance_worker.ts`:
  - Criar tabelas `metas_horarias` e `faturamento_diario_horario`.
  - Configurar timezone `America/Sao_Paulo` (data YYYY-MM-DD e hora HH).
  - Implementar download oficial de **Vendas por Dia** em Excel (`wfRelatorioOperacao.aspx`), parsing das linhas e extração de faturamento e OSs de hoje.
  - Gravar `0.00` somente quando expressamente confirmado na planilha; em caso de falha de download, logar erro e manter ausência.
  - Upsert idempotente por `(data_referencia, posicao_hora, loja_slug)`.
- `TASK-07`: Testes e Patch:
  - Rodar `npx tsx src/hydra-sync/tests/test_agent2_finance_worker.ts`.
  - Commitar na branch e exportar `/home/operacional/patch-agent2-finance-worker.diff`.

### Fase 3: Agente 3 — Persistência, Concorrência de Locks e Test Harness
- `TASK-08`: Em `finance_snapshot_repository.ts`:
  - Funções de leitura de snapshot com flags de frescor (`isStale`, `staleMinutes`).
  - Proteção contra retorno de mês anterior em perguntas sobre hoje.
- `TASK-09`: Em `data_worker_log.ts`:
  - Registro de auditoria sem dados sensíveis em `hydra_data_worker_runs`.
- `TASK-10`: Em `scripts/run-hydra-daily-full.sh` e `scripts/run-hydra-hourly-finance.sh`:
  - Configuração do `flock` cooperativo no arquivo `/tmp/hydra-data-refresh.lock`.
  - Diário adquire lock exclusivo com timeout de 55m.
  - Horário aguarda lock compartilhado por até 3600s (`flock -w 3600 9`).
- `TASK-11`: Testes e Patch:
  - Rodar `npx tsx src/hydra-sync/tests/test_agent3_persistence_harness.ts`.
  - Commitar na branch e exportar `/home/operacional/patch-agent3-persistence-harness.diff`.

### Fase 4: Integração pelo Agente Principal (Integrador)
- `TASK-12`: Aplicar os 3 patches em `hydra-staging`:
  - `git apply /home/operacional/patch-agent1-crawler-operacao.diff`
  - `git apply /home/operacional/patch-agent2-finance-worker.diff`
  - `git apply /home/operacional/patch-agent3-persistence-harness.diff`
- `TASK-13`: Conectar os novos snapshots ao bot em `operational_adapter.ts`:
  - Faturamento mensal -> `metas_horarias` / `metas_diarias`.
  - Faturamento hoje -> `getLatestDailyRevenue` (`faturamento_diario_horario`).
  - CMV e áreas -> `cmv_lojas` e `faturamento_areas`.
  - Mensagens com dado antigo recebem sufixo amigável de idade.

### Fase 5: Validação no SQLite Real & Build Gate
- `TASK-14`: Verificar no banco real `hydra_ops.db` da VPS:
  - Contagem de lojas com CMV apurado: 10/10 lojas.
  - Contagem de lojas com metas horárias: 10/10 lojas.
  - Contagem de lojas com vendas de hoje: 10/10 lojas.
  - Total de lojas em `MPMaster`: 0 (expurgada de relatórios operacionais).
- `TASK-15`: Build gate:
  - `npx tsc --noEmit`
  - Execução da suíte completa de regressão (389+ testes).

---
# HARD STOP — O Agente Principal NÃO programa os worktrees e aguarda o comando /sdd-apply ou /vibe-apply para iniciar a Fase 0.
