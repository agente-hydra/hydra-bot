# Design — hydra-intent-refinement-v2 (revisão arquitetural)

**ID:** hydra-intent-refinement-v2  
**Data:** 07/10/2026

---

## Mudança 1 — Coluna `agy_conversation_id` no perfil do usuário

**Arquivo:** `src/hydra-sync/db_repository.ts`

Adicionar coluna na tabela de perfis de usuário (ou na tabela `hydra_turn_contexts` existente, aproveitando a infra):

```sql
ALTER TABLE hydra_turn_contexts ADD COLUMN agy_conversation_id TEXT;
```

Funções a adicionar ao `db_repository.ts`:

```typescript
export function getAgyConversationId(db: Database.Database, phone: string): string | null {
  const row = db.prepare(
    'SELECT agy_conversation_id FROM hydra_turn_contexts WHERE phone = ?'
  ).get(phone) as any;
  return row?.agy_conversation_id ?? null;
}

export function setAgyConversationId(db: Database.Database, phone: string, conversationId: string): void {
  db.prepare(
    'UPDATE hydra_turn_contexts SET agy_conversation_id = ? WHERE phone = ?'
  ).run(conversationId, phone);
}

export function clearAgyConversationId(db: Database.Database, phone: string): void {
  db.prepare(
    'UPDATE hydra_turn_contexts SET agy_conversation_id = NULL WHERE phone = ?'
  ).run(phone);
}
```

---

## Mudança 2 — `dual_worker_router.ts`: suporte a `--conversation <id>`

**Arquivo:** `src/hydra-sync/dual_worker_router.ts`

### 2a. Assinatura de `routeRequest`

```diff
  public async routeRequest(
    prompt: string,
-   options?: { maxTurnBudgetMs?: number }
+   options?: { maxTurnBudgetMs?: number; conversationId?: string }
  ): Promise<RouterOutput>
```

### 2b. `executeCliWorker`: constrói args condicionalmente

```diff
  const args = [
    ...baseArgs,
-   '-p', prompt,
+   ...(conversationId ? ['--conversation', conversationId] : []),
+   '-p', prompt,
    '--dangerously-skip-permissions',
    '--model', worker.model
  ];
```

### 2c. `RouterOutput`: expor `newConversationId`

```diff
  export interface RouterOutput {
    success: boolean;
    rawOutput?: string;
    telemetry: TurnWorkerTelemetry;
    usedFallback: boolean;
    unresolved: boolean;
+   newConversationId?: string;  // presente quando nova conversa foi criada
  }
```

### 2d. Captura do `conversationId` após chamada sem ID anterior

Após `spawnSync` bem-sucedido com `conversationId = undefined`, extrair o ID da conversa criada.

**Mecanismo validado:** O AGY CLI cria um diretório `~/.gemini/antigravity-cli/brain/<uuid>/` por conversa. Após o spawn, listar o diretório mais recente e extrair o UUID:

```typescript
function extractLatestConversationId(agyBrainDir: string): string | undefined {
  try {
    const fs = require('fs');
    const path = require('path');
    const entries = fs.readdirSync(agyBrainDir, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => ({
        name: d.name,
        mtime: fs.statSync(path.join(agyBrainDir, d.name)).mtimeMs
      }))
      .sort((a: any, b: any) => b.mtime - a.mtime);
    // UUID v4 format: 8-4-4-4-12
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const latest = entries.find((e: any) => uuidPattern.test(e.name));
    return latest?.name;
  } catch {
    return undefined;
  }
}
```

**Constante a injetar via env:**
```
AGY_BRAIN_DIR=/home/operacional/.gemini/antigravity-cli/brain
```

> **Fallback de segurança:** Se `extractLatestConversationId` retornar `undefined`, o sistema continua funcionando sem `conversationId` — próxima mensagem cria nova conversa (comportamento atual). Sem regressão.

---

## Mudança 3 — `agent_dispatcher.ts`: remover heurísticas, passar `conversationId`

**Arquivo:** `src/hydra-sync/agent_dispatcher.ts`

### 3a. Buscar `conversationId` no início do turno

```typescript
// ANTES de montar o prompt:
const agyConvId = getAgyConversationId(db, phone);
```

### 3b. Remover construção de historyBlock e injeção de contexto manual

```diff
-   const convHistory = getConversationHistory(db, phone, 4);
-   const historyBlock = convHistory.slice(0, -1).map(h => `...`).join('\n');
-   const historySection = historyBlock.trim().length > 0 ? `\n# HISTÓRICO RECENTE DA CONVERSA:\n${historyBlock}\n` : '';
-   const currentFocusStore = previousState?.lojaSlug || 'Nenhuma (visão consolidada de rede)';
-   const currentFocusVehicle = previousState?.vehicleModel || previousState?.placa || 'Nenhum';

+   // Contexto é mantido pelo AGY via --conversation <id>. Sem injeção manual de histórico.
```

### 3c. Prompt simplificado

O `safePrompt` passa a ser apenas:
1. System prompt (instruções do Hydra Agent + ferramentas MCP disponíveis)
2. Mensagem do operador

Sem historyBlock, sem `currentFocusStore`, sem `currentFocusVehicle`. O AGY gerencia o histórico.

### 3d. Chamar `routeRequest` com `conversationId`

```typescript
const routerResult = await hydraDualRouter.routeRequest(safePrompt, {
  conversationId: agyConvId || undefined
});

// Se nova conversa foi criada, persiste o ID
if (routerResult.newConversationId && !agyConvId) {
  setAgyConversationId(db, phone, routerResult.newConversationId);
}
```

---

## Mudança 4 — `command_interceptor.ts`: limpar `conversationId` no `/reset`

**Arquivo:** `src/hydra-sync/command_interceptor.ts`

```diff
  case '/reset': {
    // ... lógica existente de resetar memoryGeneration, pendingRequest ...
+   clearAgyConversationId(db, phone);
    // Próxima mensagem cria nova conversa no AGY → contexto zerado
    return { handled: true, reply: '...' };
  }
```

---

## Fix 3 (mantido do v1) — CMV Comparativo: prefixo `>` na linha Período

**Arquivo:** `src/hydra-sync/operational_adapter.ts`, linha 450

```diff
  const header = [
    `> *CMV Comparativo das Lojas*`,
-   `*Período:* ${cmv.periodo || 'mês atual'}`
+   `> *Período:* ${cmv.periodo || 'mês atual'}`
  ].join('\n');
```

---

## Remoções (após validação do fluxo novo)

Os seguintes módulos podem ser **deletados** após o fluxo de `conversationId` estar funcionando e testado:

| Módulo | Dependentes a verificar antes de deletar |
|--------|------------------------------------------|
| `intent_rewriter.ts` | `agent_dispatcher.ts` (import de `rewriteIntent`, `STORE_ALIASES`, `normalizarTexto`) |
| `turn_context_repository.ts` | `agent_dispatcher.ts`, `hybrid_os_coordinator.ts`, `command_interceptor.ts` |
| `conversation_semantic_resolver.ts` | Verificar imports |

> **Atenção:** A remoção de `intent_rewriter.ts` deve ser feita **depois** de confirmar que o build passa e os testes passam com o novo fluxo. Não remover na mesma PR da implementação.

---

## Arquivos Afetados

| Arquivo | Tipo de mudança | Tamanho estimado |
|---------|----------------|-----------------|
| `src/hydra-sync/db_repository.ts` | Adição de 3 funções + SQL | ~30 linhas |
| `src/hydra-sync/dual_worker_router.ts` | Modificação de assinatura + args + extração de ID | ~40 linhas |
| `src/hydra-sync/agent_dispatcher.ts` | Remoção de historyBlock + passa conversationId | ~-30 linhas |
| `src/hydra-sync/command_interceptor.ts` | Adição de clearAgyConversationId no /reset | ~3 linhas |
| `src/hydra-sync/operational_adapter.ts` | Fix de formatação CMV (1 caractere) | 1 linha |

**Build gate:** `npm run typecheck:hydra` (0 erros antes de deploy).
