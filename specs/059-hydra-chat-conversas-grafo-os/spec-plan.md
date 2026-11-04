# Spec 059 — Plano de Implementação por Fases

**ID da Spec:** `059-hydra-chat-conversas-grafo-os`  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA — 100% VALIDADO (10/10 CENÁRIOS G01–G10 PASS)

---

## Estratégia de Execução

As tarefas estão divididas em unidades atômicas seguindo a sequência: schema físico → conector de conversas → correlacionador em grafo → ferramentas do executor → roteamento no rewriter → testes de integração e carga.

---

## Fase 0 — Baseline e Verificação de Conectividade

- [x] [LEAD] Validar conectividade interna com a API do Chatwoot (`https://chat.tork.services`) a partir da VPS e inspecionar resposta de `/api/v1/accounts/1/contacts/search`.
- [x] [LEAD] Inspecionar dados das 10 lojas ativas em `ordens_servico` e avaliar cobertura de placas e nomes de clientes.
- [x] [LEAD] Confirmar segredos no `.env` do Hydra e Watchdog sem expor tokens nos artefatos.

---

## Fase 1 — Migração Idempotente do Schema de Grafo

Arquivos: `src/hydra-sync/db_repository.ts`, `src/hydra-sync/real_analysis_repository.ts`.

- [x] [LEAD] Injetar criação idempotente das tabelas `hydra_case_graph_nodes`, `hydra_case_graph_edges`, `hydra_case_current_position` e `hydra_conversation_os_links` na inicialização de `db_repository.ts`.
- [x] [LEAD] Criar índices de busca por `(entity_type, loja_slug)`, `(loja_slug, os_id)`, `vehicle_plate`, `customer_phone` e `(conversation_id, os_id)`.
- [x] [LEAD] Validar integridade e ausência de regressão em bancos existentes (`hydra_ops.db`).

---

## Fase 2 — Conector Seguro de Conversas Chatwoot

Arquivos: `src/hydra-sync/chatwoot_conversation_reader.ts`, `src/hydra-sync/types/chatwoot_contract.ts`.

- [x] [PARALLEL: ccr_adapter] Implementar `ChatwootConversationReader` com métodos `searchConversations`, `getConversationHistory` e `getContactConversations`.
- [x] [PARALLEL: ccr_adapter] Implementar sanitização obrigatória de mensagens (`SanitizedChatMessage`), redigindo números de cartão, senhas e CPFs.
- [x] [PARALLEL: ccr_adapter] Implementar cache LRU em memória (TTL 5 min) para evitar requisições redundantes à API do Chatwoot.
- [x] [PARALLEL: ccr_adapter] Adicionar suporte a geração de link direto do Chatwoot (`chatwootUrl`) e link direto WhatsApp (`waLink`).

---

## Fase 3 — Motor de Interligação em Grafo (OS <-> Conversa)

Arquivos: `src/hydra-sync/os_conversation_graph_linker.ts`, `src/hydra-sync/case_graph_projection.ts`.

- [x] [LEAD] Implementar motor de correlação `OsConversationGraphLinker` com as 3 regras:
  - Regra L1: Match de Telefone E.164 entre contato do Chatwoot e OS.
  - Regra L2: Match de Placa do veículo (Mercosul e padrão antigo) na conversa da mesma loja/inbox.
  - Regra L3: Match de menção explícita de número de OS no chat.
- [x] [LEAD] Integrar com `CaseGraphProjector` para gravar nós e arestas atômicos no SQLite.
- [x] [LEAD] Atualizar `hydra_case_current_position` com os fatos extraídos da conversa (motivo de demora documentado, próximo passo prometido).

---

## Fase 4 — Ferramentas Tipadas no `HydraActionExecutor`

Arquivos: `src/hydra-sync/hydra_action_executor.ts`.

- [x] [LEAD] Implementar ferramenta `conversations.search` (busca por placa, telefone ou termo) com validação de escopo de permissão.
- [x] [LEAD] Implementar ferramenta `conversations.get_history` (retorna as últimas N mensagens limpas de uma conversa com links).
- [x] [LEAD] Implementar ferramenta `graph.get_os_case` (retorna o raio-x operacional do grafo com conversas e fatos interligados).
- [x] [LEAD] Garantir aplicação estrita da política de acesso da Spec 058: gerentes bloqueados, sócios e admins autorizados a consultar.

---

## Fase 5 — Desbloqueio e Roteamento no `IntentRewriter`

Arquivos: `src/hydra-sync/intent_rewriter.ts`.

- [x] [LEAD] Remover o bloqueio cego L977–L983 que impedia consultas de Chatwoot/tickets externos.
- [x] [LEAD] Rotear intenções de histórico de atendimento do cliente e status de autorização de orçamento para o novo executor.
- [x] [LEAD] Formatar respostas no padrão nativo do WhatsApp com links rápidos (`wa.me` e Chatwoot).

---

## Fase 6 — Testes, Validação e Hard Stop

Arquivos: `src/hydra-sync/tests/test_spec059_chat_graph_linking.ts`.

- [x] [LEAD] Criar suite de testes com cenários cobrindo:
  - G01: Migração e idempotência do schema de grafo.
  - G02: Leitura e sanitização de mensagens do Chatwoot.
  - G03: Interligação OS <-> Conversa por telefone.
  - G04: Interligação OS <-> Conversa por placa.
  - G05: Interligação OS <-> Conversa por menção de OS.
  - G06: Ferramenta `conversations.search` no executor.
  - G07: Ferramenta `conversations.get_history` no executor com links.
  - G08: Ferramenta `graph.get_os_case` com dados do grafo.
  - G09: Bloqueio de gerente e permissão para admin/sócio.
  - G10: Zero recusa indevida no `IntentRewriter`.
- [x] [LEAD] Executar bateria completa via `npx tsx` e garantir 100% de aprovação.
- [x] [LEAD] Executar Hard Stop e aguardar autorização do usuário.
