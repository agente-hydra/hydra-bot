# Spec Plan — hydra-intent-refinement-v2 (revisão arquitetural)

**ID:** hydra-intent-refinement-v2  
**Data:** 07/10/2026  
**Branch alvo:** `feat/hydra-language-consolidated`  
**Ambiente:** `/home/operacional/hydra-staging`

---

## Tarefas

### T1 — Varredura de dependências de `intent_rewriter.ts` e `turn_context_repository.ts`
- Antes de qualquer remoção: `grep -rn "from.*intent_rewriter\|from.*turn_context_repository\|from.*conversation_semantic_resolver"` em todo `src/hydra-sync/`
- Mapear todos os imports afetados para garantir que as remoções finais não quebrem o build
- **Esta task é leitura. Sem código.**
- **Status:** `[x] Completed`

### T2 — Validar mecanismo de captura de `conversationId` do AGY CLI
- No VPS: rodar `agy -p "teste" --dangerously-skip-permissions --model gemini-3.8-flash-low` e verificar:
  - O diretório `~/.gemini/antigravity-cli/brain/` ganha novo UUID após a chamada?
  - O stdout/stderr contém o UUID da conversa?
  - Flag `--conversation <uuid>` funciona na chamada seguinte e mantém contexto?
- Registrar resultado e confirmar qual hipótese (A/B/C do proposal) funciona
- **Esta task é validação. Sem código ainda.**
- **Status:** `[x] Completed`

### T3 — Adicionar coluna `agy_conversation_id` e funções no `db_repository.ts`
- Adicionar `ALTER TABLE` idempotente (com `IF NOT EXISTS` check em runtime)
- Implementar `getAgyConversationId`, `setAgyConversationId`, `clearAgyConversationId`
- **Arquivo:** `src/hydra-sync/db_repository.ts`
- **Depende de:** T2 (confirmar que conversationId existe e é UUID válido)
- **Status:** `[x] Completed`

### T4 — Modificar `dual_worker_router.ts` para aceitar e passar `conversationId`
- Atualizar assinatura de `routeRequest` com `conversationId?: string`
- Atualizar `executeCliWorker` para incluir `--conversation <id>` nos args quando presente
- Implementar `extractLatestConversationId` usando `AGY_BRAIN_DIR` env
- Atualizar `RouterOutput` com campo `newConversationId?: string`
- **Arquivo:** `src/hydra-sync/dual_worker_router.ts`
- **Depende de:** T2 (mecanismo de captura validado), T3 (tipos disponíveis)
- **Status:** `[x] Completed`

### T5 — Modificar `agent_dispatcher.ts`: remover heurísticas, passar `conversationId`
- Remover: `convHistory`, `historyBlock`, `historySection`, `currentFocusStore`, `currentFocusVehicle`
- Adicionar: `getAgyConversationId` no início do turno
- Passar `conversationId` para `routeRequest`
- Persistir `newConversationId` quando retornado pelo router
- **Arquivo:** `src/hydra-sync/agent_dispatcher.ts`
- **Depende de:** T3, T4
- **Status:** `[x] Completed`

### T6 — Modificar `command_interceptor.ts`: limpar conversationId no `/reset`
- Importar `clearAgyConversationId` do `db_repository.ts`
- Chamar no handler de `/reset` antes do reply
- **Arquivo:** `src/hydra-sync/command_interceptor.ts`
- **Depende de:** T3
- **Status:** `[x] Completed`

### T7 — Fix CMV Comparativo: adicionar `>` na linha Período
- `operational_adapter.ts` linha 450: adicionar `> ` ao início da string `*Período:*`
- **Arquivo:** `src/hydra-sync/operational_adapter.ts`
- **Independente das demais tasks**
- **Status:** `[x] Completed`

### T8 — Build gate
- `npm run typecheck:hydra` → 0 erros
- **Depende de:** T3, T4, T5, T6, T7
- **Status:** `[x] Completed`

### T9 — Validação end-to-end no staging
- Enviar sequência de mensagens via test harness:
  1. "cmv das lojas" → nova conversa criada, `agy_conversation_id` salvo no SQLite
  2. "quais as travas" → mesma conversa, LLM entende contexto sem regex
  3. "OSs jorge beretta" → LLM lista OS da loja certa
  4. `/reset` → `agy_conversation_id` apagado do SQLite
  5. Próxima mensagem → nova conversa criada
- Verificar CMV Comparativo formatado corretamente no WhatsApp de teste
- **Depende de:** T8
- **Status:** `[x] Completed`

---

## Ordem de Execução

```
T1 (varredura de dependências — leitura)
T2 (validação de conversationId — leitura/teste no VPS)
   ↓
T3 (db_repository)
T7 (operational_adapter — independente, pode ser paralelo)
   ↓
T4 (dual_worker_router)
   ↓
T5 (agent_dispatcher)
T6 (command_interceptor)
   ↓
T8 (build gate)
   ↓
T9 (validação end-to-end)
```

---

## Rollback

Se T8 ou T9 falharem:

```bash
git checkout src/hydra-sync/agent_dispatcher.ts
git checkout src/hydra-sync/dual_worker_router.ts
git checkout src/hydra-sync/db_repository.ts
git checkout src/hydra-sync/command_interceptor.ts
git checkout src/hydra-sync/operational_adapter.ts
```

---

## Remoções de código legado (fase 2 — pós validação)

Somente após T9 aprovado:

```bash
# Deletar módulos de heurística (verificar imports antes via T1)
rm src/hydra-sync/intent_rewriter.ts
rm src/hydra-sync/turn_context_repository.ts
rm src/hydra-sync/conversation_semantic_resolver.ts

# Build gate novamente
npm run typecheck:hydra
```

---

## Deploy (pós-aceite)

```bash
# Staging
npm run build:hydra
pm2 restart hydra-bot

# Produção (após validação no staging)
rsync -az --delete /home/operacional/hydra-staging/dist/ /home/operacional/hydra-deploy/current/dist/
pm2 restart hydra-bot --env production
```
