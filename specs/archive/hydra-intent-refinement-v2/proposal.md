# Proposal — hydra-intent-refinement-v2 (revisão arquitetural)

**ID:** hydra-intent-refinement-v2  
**Data:** 07/10/2026  
**Revisão:** 2.0 — Substituição de heurísticas de contexto por conversa persistente no AGY CLI  
**Status:** DRAFT

---

## O Problema Real

O sistema atual usa `agy -p "<prompt>"` como chamada **stateless** a cada mensagem. Para compensar isso, foi construída toda uma camada de heurística:

- `turn_context_repository.ts` → SQLite com `lojaSlug`, `lastIntent`, `osId`, `placa` do turno anterior  
- `intent_rewriter.ts` → 4000+ linhas de regex + stems tentando deduzir contexto  
- Construção manual de `historyBlock` no `agent_dispatcher.ts` injetando os últimos 4 turnos como string no prompt  
- Herança de loja via `isElipsePrefix`, `mentionsAgingOrRetained`, etc.

**Resultado:** frágil, difícil de manter, e produz erros exatamente como os do dia 07/10 — porque nenhum regex captura "travas" sem stem, e nenhuma heurística substitui contexto real.

---

## A Solução

O AGY CLI suporta `--conversation <ID>` nativamente. Isso significa que cada sessão WhatsApp pode ter seu próprio `conversationId` persistido no AGY, e cada mensagem subsequente envia **só o texto novo** — o AGY mantém o histórico completo e a LLM entende contexto naturalmente.

```
# Primeira mensagem da sessão (ou após /reset):
agy -p "cmv das lojas" --dangerously-skip-permissions --model gemini-3.8-flash-low
→ cria conversa, retorna conversationId (ex: abc123)

# Segunda mensagem (mesmo usuário):
agy --conversation abc123 -p "travas" --dangerously-skip-permissions --model gemini-3.8-flash-low
→ AGY já sabe que antes falamos de CMV e lojas, entende "travas" no contexto certo
```

Sem regex. Sem stems. Sem `lojaSlug` herdado. Sem `turn_context_repository`.

---

## O que muda

### O que SOME (pode ser deletado):

| Artefato | O que é | Por que some |
|----------|---------|-------------|
| `intent_rewriter.ts` | 4000+ linhas de regex/heurística de intenção | A LLM com histórico real não precisa |
| `turn_context_repository.ts` | SQLite de estado `lojaSlug`/`lastIntent` entre turnos | Contexto vive no AGY |
| `conversation_semantic_resolver.ts` | Resolver semântico de contexto de loja | Idem |
| Construção de `historyBlock` manual em `agent_dispatcher.ts` | Injeção de últimos 4 turnos como string | AGY mantém histórico |
| `currentFocusStore` / `currentFocusVehicle` injetados no prompt | Heurística de loja/veículo atual | Contexto real substitui |

### O que FICA:

| Artefato | O que é | Por que fica |
|----------|---------|-------------|
| `dual_worker_router.ts` | Circuit breaker + failover primário/secundário | Continua necessário para resiliência |
| `operational_adapter.ts` | Formatação das respostas operacionais | Formatação de saída ainda é necessária (Fix 3 do bug de CMV permanece) |
| `db_repository.ts` | Acesso ao SQLite operacional | Dados operacionais vêm daqui |
| `mcp_server.ts` | Ferramentas MCP que a LLM usa | A LLM chama via MCP para buscar dados reais |
| `idempotency_repository.ts` | Deduplicação de mensagens recebidas | Proteção de duplicatas no webhook |
| `command_interceptor.ts` | `/reset`, `/perfil`, `/help` | Comandos explícitos continuam |

### O que MUDA:

| Artefato | Mudança |
|----------|---------|
| `dual_worker_router.ts` → `executeCliWorker` | Adicionar suporte a `--conversation <id>` nos args do AGY CLI |
| `agent_dispatcher.ts` | Remover construção de `historyBlock`, `currentFocusStore`, `currentFocusVehicle`; passar `conversationId` do usuário para o router |
| SQLite (`db_repository.ts`) | Nova coluna `agy_conversation_id TEXT` na tabela de perfis/sessões de usuário |
| `command_interceptor.ts` — handler de `/reset` | Ao resetar, deletar `agy_conversation_id` → próxima mensagem cria nova conversa |
| `dual_worker_router.ts` → `routeRequest` | Aceitar `conversationId?: string` opcional; se presente, passa `--conversation <id>` |

---

## Como funciona o fluxo novo

```
WhatsApp → webhook_service → agent_dispatcher
                                 ↓
                    Busca agy_conversation_id do usuário no SQLite
                                 ↓
               [não existe]              [existe]
                    ↓                        ↓
         agy -p "<mensagem>"     agy --conversation <id> -p "<mensagem>"
         → cria nova conversa    → continua conversa existente
         → captura conversationId
         → salva no SQLite
                    ↓
              LLM chama MCP tools se precisar de dados operacionais
                    ↓
              Resposta formatada → WhatsApp
```

---

## Como capturar o conversationId criado

O AGY CLI, ao criar nova conversa, imprime o `conversationId` no stderr ou em arquivo de log. Precisamos validar o mecanismo exato durante a implementação:

**Hipótese A:** `agy` logar a conversa em `~/.gemini/antigravity-cli/brain/<uuid>/` → extrair o UUID do diretório mais recente após a chamada.  
**Hipótese B:** Usar `agy --output-format json -p "..."` e parsear o JSON de saída.  
**Hipótese C:** Usar a flag `--remote-control` ou `--project` para controlar sessões nomeadas.

> **A task T2 do spec-plan deve validar qual hipótese funciona antes de implementar.**

---

## O que muda no `/reset`

Quando o usuário manda `/reset`:
1. `command_interceptor.ts` já limpa `memoryGeneration`, `pendingRequest`, etc.
2. **Novo:** também limpa `agy_conversation_id` do perfil no SQLite.
3. Próxima mensagem cria nova conversa no AGY → contexto zerado.

---

## Fix que permanece do v1 (sem heurística)

**Bug 3 — CMV Comparativo: `*Período:*` sem prefixo `>`** — este é um bug de formatação pura em `operational_adapter.ts`, independente de arquitetura. Continua no escopo.

---

## Critérios de Aceite

- [ ] "quais as travas" após conversa sobre lojas → LLM entende "travas" = veículos retidos, sem regex
- [ ] "OSs jorge beretta" → LLM chama `getStoreDrilldown` ou `searchOS` com loja certa naturalmente
- [ ] `/reset` cria nova conversa AGY → contexto zerado de verdade
- [ ] CMV Comparativo: linha `*Período:*` com prefixo `>` 
- [ ] `npm run typecheck:hydra` passa com 0 erros
- [ ] Testes `test_agent2_finance_worker.ts` e `test_user_memory_briefing.ts` continuam 100% verdes

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| AGY CLI não expõe `conversationId` capturável via stdout | Validar na T2 antes de implementar; fallback: usar `--continue` com processo persistente por usuário |
| Latência maior (AGY carrega histórico do disco a cada turno) | Monitorar; o histórico de 10-20 turnos no AGY é O(1) de leitura de arquivo — aceitável |
| MCP tools não cobertas por tipo de consulta novo | O sistema de prompt do AGY já descreve todas as tools disponíveis; sem mudança necessária |
| `intent_rewriter.ts` deletado quebra imports em outros arquivos | Varredura de dependências na T1 antes de remover |
