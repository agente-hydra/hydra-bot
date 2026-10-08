# Plano de Implementação (Spec Plan): Endurecimento do Harness do Agente Hydra

Este plano define a execução modular do projeto com delegação para subagentes especializados e verificação centralizada pelo Agente Orquestrador.

---

## Estratégia de Execução & Papéis

| Papel | Responsável | Escopo de Arquivos | Critério de Sucesso |
|---|---|---|---|
| **Subagente 1** | *Async Router Specialist* | `src/hydra-sync/dual_worker_router.ts`<br>`tests/test_async_spawn_router.ts` | `spawn` assíncrono com Promise; sem travamento do event loop |
| **Subagente 2** | *Semantic & Anaphora Specialist* | `src/hydra-sync/agent_dispatcher.ts`<br>`tests/test_vehicle_anaphora_resolution.ts` | Regex expandido; `"ka 465"` resolve para OS 465 e não OS 458 |
| **Subagente 3** | *Fast SQL Specialist* | `src/hydra-sync/agent_dispatcher.ts`<br>`src/hydra-sync/db_repository.ts`<br>`tests/test_fast_sql_dispatch.ts` | Consultas de checklist e pátio respondidas em <80ms via SQL direto |
| **Subagente 4** | *Webhook Ingress Specialist* | `webhook-listener.js`<br>`tests/test_webhook_bad_json.ts` | `SyntaxError` retorna HTTP 400 com JSON sem loop de retries |
| **Orquestrador** | *Antigravity (Principal)* | Todo o repositório + VPS Infra | Revisão de diffs, `tsc --noEmit`, deploy e validação no PM2 |

---

## Tarefas de Implementação

### - [/] [ASYNC-ROUTER] Tarefa 1: Refatoração Assíncrona de `dual_worker_router.ts`
- **Executor:** Subagente 1 (*Async Router Specialist*)
- **Arquivos:**
  - `src/hydra-sync/dual_worker_router.ts`
  - `src/hydra-sync/tests/test_async_spawn_router.ts`
- **Ações:**
  1. Criar helper `spawnCliAsync(bin, args, options)` utilizando `child_process.spawn`.
  2. Implementar controle de streaming de `stdout` e `stderr` com buffers.
  3. Implementar timeout defensivo com `setTimeout` acionando `SIGTERM` e, se necessário, `SIGKILL`.
  4. Substituir `spawnSync` em `executeCliWorker` pela versão assíncrona.
  5. Criar teste automatizado validando que o event loop do Node.js continua processando `setImmediate`/`setInterval` enquanto o processo filho roda.
- **Critério de Aceite:**
  - Nenhum `spawnSync` remanescente em `dual_worker_router.ts`.
  - Teste `test_async_spawn_router.ts` executado com sucesso na VPS.

---

### - [ ] [SEMANTIC-PARSER] Tarefa 2: Endurecimento do Parser de Veículo/OS e Resolução de Anáfora
- **Executor:** Subagente 2 (*Semantic & Anaphora Specialist*)
- **Arquivos:**
  - `src/hydra-sync/agent_dispatcher.ts`
  - `src/hydra-sync/tests/test_vehicle_anaphora_resolution.ts`
- **Ações:**
  1. Expandir regex de modelos (`ka`, `c3`, `c4`, `spin`, `etios`, `sandero`, `duster`, `tucson`, etc.).
  2. Adicionar parser pareado de modelo + número de OS (ex: `"ka 465"`, `"polo 22631"`).
  3. Bloquear herança de `prevOsId` ou `prevVehicleModel` quando o turno atual possui número ou modelo explícito.
  4. Criar teste de regressão validando:
     - Entrada `"detalhes do ka 465"` com histórico prévio de `"OS #458 — C3"` deve resolver para OS `465` e modelo `ka`.
     - Entrada `"e o valor dele?"` deve herdar o contexto do turno anterior normalmente.
- **Critério de Aceite:**
  - Teste de regressão passa com 100% de sucesso.

---

### - [ ] [FAST-SQL] Tarefa 3: Rotas Rápidas Determinísticas em SQL (Checklist & Pátio)
- **Executor:** Subagente 3 (*Fast SQL Specialist*)
- **Arquivos:**
  - `src/hydra-sync/agent_dispatcher.ts`
  - `src/hydra-sync/db_repository.ts`
  - `src/hydra-sync/tests/test_fast_sql_dispatch.ts`
- **Ações:**
  1. Adicionar interceptor semântico em `agent_dispatcher.ts` para capturar intenções de checklist pendente e pátio/aging.
  2. Conectar diretamente à função `getChecklistAudit` de `db_repository.ts`.
  3. Formatar blocos de resposta WhatsApp com quebra amigável e tempos de resposta inferiores a 80ms.
  4. Gravar o turno no banco (`saveConversationMessage` e `saveTurnState`) para manter histórico íntegro.
  5. Criar teste verificando execução direta em menos de 100ms sem acionar IA.
- **Critério de Aceite:**
  - Consultas de checklist respondem imediatamente sem consumir cota de IA nem gerar timeout de 90s.

---

### - [ ] [WEBHOOK-INGRESS] Tarefa 4: Higienização de Ingress HTTP no Webhook Listener
- **Executor:** Subagente 4 (*Webhook Ingress Specialist*)
- **Arquivos:**
  - `webhook-listener.js`
- **Ações:**
  1. No handler HTTP de entrada, capturar `SyntaxError` proveniente de `JSON.parse(body)`.
  2. Retornar status `HTTP 400 Bad Request` com cabeçalho `application/json` e payload estruturado `{ status: "bad_request", error: "Malformed JSON payload" }`.
  3. Garantir log de aviso claro no console com IP/origem sem poluir com stack traces de 500.
- **Critério de Aceite:**
  - Requisição com body `{ invalid json }` recebe HTTP 400 imediato.

---

### - [ ] [ORCHESTRATOR-DEPLOY] Tarefa 5: Orquestração Central, Build Gate e Deploy em Produção
- **Executor:** Agente Orquestrador (*Antigravity*)
- **Ações:**
  1. Inspecionar `git diff` de todos os arquivos modificados na staging da VPS.
  2. Executar build gate de TypeScript: `cd /opt/bots && npx tsc --project tsconfig.hydra.json --noEmit`.
  3. Rodar a bateria completa de testes de regressão (`test_async_spawn_router.ts`, `test_vehicle_anaphora_resolution.ts`, `test_fast_sql_dispatch.ts`, `test_real_checklist_audit.ts`).
  4. Executar `/home/operacional/deploy_to_prod.sh` para sincronizar `/opt/bots` e `/home/operacional/hydra/`.
  5. Verificar status do processo no PM2: `pm2 status hydra-bot` e consultar `/health`.
  6. Realizar commit e registrar aprendizados na memória do projeto.
- **Critério de Aceite:**
  - PM2 `hydra-bot` ativo com zero erros; healthcheck com status `HEALTHY`; sem regressões.

---

## Circuit Breakers e Travas de Segurança

1. **Hard Stop Obrigatório:** Nenhuma linha de código em produção é alterada nesta fase de proposta. A execução só se inicia com o comando `/sdd-apply`.
2. **Compiler Gate:** Se `npx tsc --noEmit` falhar, o deploy é abortado imediatamente.
3. **Trava de WhatsApp:** Nenhuma mensagem real é enviada usando instâncias de gerentes. Apenas instâncias autorizadas (`hydra` e `atendimento`).
