# Spec Plan — Hydra: Plano de Ação em Frentes Especializadas

**Versão:** 1.0  
**Data:** 02 de Outubro de 2026  
**Status:** PLANO DE IMPLEMENTAÇÃO (SDD Plan)  
**ID da Spec:** `hydra-conversation-memory-protection`  
**Destinatários:** Agente Principal e os 3 Executores Especialistas Existentes

---

## 1. Atribuição de Arquivos e Dono Único

Para evitar conflitos de merge e sobrescritas de arquivos, a atribuição é rigorosamente segregada por módulo:

| Executor | Sessão Indicada | Arquivos Sob Sua Responsabilidade |
|---|---|---|
| **Executor 1** | `Hydra Operational Context Handoff` (`de5452f5-ae9d-4de2-af64-0b12f075f5ea`) | `src/hydra-sync/intent_rewriter.ts`<br>`src/hydra-sync/semantic_prompt.ts`<br>`src/hydra-sync/agent_dispatcher.ts` (lógica de prompt e intenções) |
| **Executor 2** | `Hydra Ecosystem Context Transfer` (`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`) | `src/hydra-sync/vault_manager.ts`<br>`src/hydra-sync/memory_repository.ts`<br>`src/hydra-sync/memory_retriever.ts`<br>`src/hydra-sync/memory_consolidator.ts` |
| **Executor 3** | `Hydra Ecosystem Operational Handover` (`5dffcfaf-5e84-438e-81f0-88558655f4c0`) | `src/hydra-sync/public_response_guard.ts` (NOVO)<br>`src/hydra-sync/balloon_composer.ts`<br>`src/hydra-sync/dual_worker_router.ts` (telemetria real)<br>`src/hydra-sync/tests/test_harness_conversation_memory.ts` |
| **Principal** | Integrador do Workspace | Coordenação dos patches, build gate TypeScript, reconciliação, testes integrados e deploy/reload controlado |

---

## 2. Tarefas Atômicas de Implementação

### Frente 1: Executor 1 — Intenção, Correção de Rumo e Desamordaçamento do Prompt
- [x] **[E1-01]** Corrigir `intent_rewriter.ts` para eliminar a verificação de substring `"dia"` (linha 1755). Adotar regex de gramática contextual estrita (`\b(patio|veiculos retidos|carros parados)\b`).
- [x] **[E1-02]** Corrigir `intent_rewriter.ts` para eliminar a armadilha de `conversa` contendo `ver` e a checagem cega de `chatwoot` (linhas 286-294). Exigir menção explícita a ticket externo + URL real.
- [x] **[E1-03]** Implementar reconhecimento de correções do operador (`intent = 'conversation_correction'`) para frases como *"não foi isso"*, *"estou falando da nossa conversa"*, cancelando filtros operacionais anteriores.
- [x] **[E1-04]** Ajustar `semantic_prompt.md` e `semantic_prompt.ts` para tom natural Hermes-Style: tratar saudações e comentários sem cobrar número de OS ou placa.
- [x] **[E1-05]** Desamordaçar o prompt em `agent_dispatcher.ts`: substituir a cláusula `# REGRA DE ISOLAMENTO DE TURNO: Responda EXCLUSIVAMENTE...` por instrução adaptativa que libera o diálogo em turnos conceituais e preserva o foco em consultas de loja.
- [x] **[E1-06]** Executar testes unitários de intenção e gerar patch `patch-executor1-conversation.diff`.

---

### Frente 2: Executor 2 — Diário Contínuo no Obsidian, Preferências e Recuperação
- [x] **[E2-01]** Implementar `appendConversationToDailyDiary` em `vault_manager.ts` para gravar continuamente cada turno em `vault/usuarios/<phone>/diario/YYYY-MM-DD.md`.
- [x] **[E2-02]** Adicionar cabeçalho frontmatter com metadados estritos (`date`, `owner`, `generation_id`, `version`, `stores_referenced`) e seções cronológicas com timestamp no fuso `America/Sao_Paulo`.
- [x] **[E2-03]** Implementar máscara automática para segredos ou credenciais que o operador colar na conversa antes de gravar no Markdown.
- [x] **[E2-04]** Implementar `getDailyDiaryContext` com paginação contextual dos últimos 2 dias, respeitando o teto de 2.000 caracteres (<350 tokens) e expurgando sessões de rede quando o operador estiver como gerente de loja.
- [x] **[E2-05]** Unificar extração e persistência de memórias (`validateAndPersistMemoryCandidates`) para que tanto Sócio quanto Gerente tenham preferências gravadas.
- [x] **[E2-06]** Garantir que `/reset` incremente `memory_generation`, invalidando o contexto ativo sem corromper o arquivo físico histórico de consultas autorizadas.
- [x] **[E2-07]** Executar testes unitários de persistência/recuperação do vault e gerar patch `patch-executor2-vault.diff`.

---

### Frente 3: Executor 3 — Barreira Pública, Telemetria Real e Matriz C01–C30
- [x] **[E3-01]** Criar `src/hydra-sync/public_response_guard.ts` implementando a barreira obrigatória de validação de todos os balões antes do envio.
- [x] **[E3-02]** Implementar sanitizador para redigir caminhos de disco (`/home/...`, `/opt/...`, etc.), arquivos (`.ts`, `.md`, `.json`), tabelas SQL, stack traces e nomes internos de tools (`get_aging_cars`, `mcp:hydra-ops`).
- [x] **[E3-03]** Implementar função `formatPublicMemoryStatus` retornando estados funcionais em linguagem natural (*recording_active*, *recording_pending*, *recording_unavailable*, *history_empty*), sem expor contadores técnicos ou paths.
- [x] **[E3-04]** Ajustar `dual_worker_router.ts` e `agent_dispatcher.ts` para instrumentar chamadas reais de ferramentas na fronteira MCP, eliminando a etiquetação sintética de `mcp:hydra-ops`.
- [x] **[E3-05]** Integrar a validação do `PublicResponseGuard` no fluxo de despacho final de `agent_dispatcher.ts` e `balloon_composer.ts`.
- [x] **[E3-06]** Construir a suíte de testes integrados `src/hydra-sync/tests/test_harness_conversation_memory.ts` cobrindo rigorosamente os cenários **C01 a C30**.
- [x] **[E3-07]** Executar e certificar 30/30 PASS (100%) e gerar patch `patch-executor3-guard-harness.diff`.

---

### Frente Principal: Integração, Build Gate e Promoção Segura
- [x] **[P-01]** Coleta e aplicação sequencial dos patches dos 3 executores na worktree `hydra-staging`.
- [x] **[P-02]** Execução do build gate estrito: `npx tsc --project tsconfig.hydra.json --noEmit` (0 erros tolerados).
- [x] **[P-03]** Execução da suíte completa C01–C30 em staging certificando zero regressão nas consultas operacionais anteriores (T01–T28).
- [x] **[P-04]** Backup preventivo de `/opt/bots/src/hydra-sync/`.
- [x] **[P-05]** Promoção controlada dos arquivos para produção em `/opt/bots/src/hydra-sync/`.
- [x] **[P-06]** Recarregamento sem downtime via PM2: `pm2 reload hydra-bot`.
- [x] **[P-07]** Teste ao vivo via CLI simulando os casos reais dos logs 844, 849, 850, 851 e 853 para validação em produção.
- [x] **[P-08]** Emissão do relatório consolidado de encerramento da spec.

---

## 3. Conclusão da Implementação

> **[HARD STOP — IMPLEMENTAÇÃO CONCLUÍDA]**  
> Todas as tarefas das Frentes 1, 2, 3 e Principal foram implementadas, homologadas nas worktrees isoladas pelos 3 executores e promovidas para o ambiente de produção via PM2 (`hydra-bot`).  
> O bot agora opera em modo conversacional livre Hermes-Style, com proteção pública anti-vazamento ativa e registro contínuo de conversas no Obsidian Vault.
