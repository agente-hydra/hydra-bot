# Plano de Execução — Arquitetura LLM-First

**Spec:** `hydra-llm-first-architecture`  
**Data:** 06/10/2026  
**Status:** Planejado para Implementação

---

## Tasks

### Fase 1: Calibração do Dispatcher e Inversão de Precedência (LLM-First)
- [x] `[DISPATCHER]` Inverter o fluxo em `src/hydra-sync/agent_dispatcher.ts` para que a invocação do AGY CLI ocorra com a mensagem real do operador antes de qualquer reescrita semântica.
- [x] `[DISPATCHER]` Enriquecer o prompt do AGY CLI com o histórico real dos últimos turnos e o contexto da loja ativa (`previousState?.lojaSlug`) sem amarras coercivas de canonicalQuestion.
- [x] `[DISPATCHER]` Isolar `rewriteIntent` e `executeOperationalQuery` exclusivamente dentro do bloco `catch` de contingência (quando o router reportar falha, timeout ou cota).

### Fase 2: Calibração de Timeouts e Router Dual-Worker
- [x] `[ROUTER]` Ajustar o timeout primário em `src/hydra-sync/dual_worker_router.ts` de 40s para 15s para eliminar a latência de 60s–90s observada no WhatsApp.
- [x] `[ROUTER]` Garantir que a invocação do binário `/home/operacional/.local/bin/agy` preserve o carregamento do servidor MCP `hydra-ops` via stdio.

### Fase 3: Higienização e Correções Pontuais do Fallback
- [x] `[ADAPTER]` Corrigir caracteres corrompidos (`?`) em `src/hydra-sync/operational_adapter.ts` (`Ordens de Serviço`, `veículo`, `•`).
- [x] `[REWRITER]` Incluir `idea` e `ideia` na lista de modelos e permitir herança de loja em consultas curtas ("em aberto") caso o fallback venha a ser acionado.

### Fase 4: Validação Operacional e Staging
- [x] `[STAGING]` Sincronizar alterações com `/home/operacional/hydra-staging/` e `/opt/bots/`.
- [x] `[SMOKE]` Testar a sequência exata de diálogos que falhou anteriormente ("como ta jabaquara?", "em aberto por favoor", "esse ideia qq ta acontecndo?").
- [x] `[GATE]` Validar que o build gate passe sem erros (`npm run typecheck:hydra`) e reiniciar bot no PM2.
