# Plano de Implementação: 100% LLM-First com Botões Interativos Injetores de Prompt

**Spec ID:** `hydra-query-routing-and-formatting-fix`  
**Status:** Planejamento  
**Dependências:** Nenhuma  

---

## Checklist de Execução

### Fase 1: Injetor de Prompts para Botões Interativos
- [x] Criar função helper `translateInteractiveRowToPrompt(rowId: string)` que mapeia `os_${id}_${module}` para perguntas conversacionais humanas ("Quais são os serviços discriminados da OS #445?").
- [x] Integrar o tradutor no `webhook-listener.js` para que qualquer clique em botão interativo chegue como mensagem natural do usuário.
- [x] Integrar o tradutor no início do `dispatchMessage` em `agent_dispatcher.ts` como salvaguarda defensiva.

### Fase 2: Desativação do Interceptor Determinístico em `agent_dispatcher.ts`
- [/] Desativar o retorno prematuro em `FALLBACK_API` no bloco de veículos (linhas 842–1179).
- [ ] Garantir que consultas de veículos, ordens, pátio e botões interativos sigam diretamente para `hydraDualRouter.routeRequest` (AGY CLI com MCP `hydra-ops`).
- [ ] Manter o adaptador determinístico estritamente na cláusula `catch` e em caso de `!routerResult.success` (Fallback de contingência).

### Fase 3: Detecção de Contexto de OS e Anexo de Botões Nativos
- [ ] Quando o LLM responder mencionando uma OS individual (ex: `#445`), enriquecer o retorno do dispatcher com o `interactiveList` nativo da Evolution API (`sendList`), permitindo toques nos botões na interface do WhatsApp.
- [ ] Remover definitivamente o rodapé de texto de URA de `composeExecutiveOSSummary` em `os_situation_composer.ts`.

### Fase 4: Testes e Validação na VPS
- [ ] Testar localmente com `npx tsx` a tradução de cliques em prompts.
- [ ] Testar roteamento direto para o LLM.
- [ ] Executar type check: `npm run typecheck:hydra` / `npx tsc --noEmit`.
- [ ] Sincronizar com a VPS (`operacional@100.126.50.101`).
- [ ] Reiniciar `hydra-bot` no PM2 e validar a resposta da IA para `"OSs do jabaquara"` e para o clique no botão de serviços.

---

## Hard Stop
Após atualização desta especificação, o agente deve **PARAR IMEDIATAMENTE** e aguardar a autorização do usuário via comando `/vibe-apply hydra-query-routing-and-formatting-fix`.
