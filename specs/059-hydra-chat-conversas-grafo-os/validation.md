# Spec 059 — Testes e Validação Contratual

**ID da Spec:** `059-hydra-chat-conversas-grafo-os`  
**Data:** 02/11/2026  
**Status:** MATRIZ DE TESTES CONTRATUAIS

---

## 1. Estratégia de Validação

Os testes cobrem:
1. Criação e idempotência das tabelas de grafo no SQLite (`hydra_ops.db`).
2. Conexão read-only e sanitização de mensagens do Chatwoot (prevenção de vazamento de dados sensíveis).
3. Motor de correlação (telefone, placa, número de OS) gerando nós e arestas íntegros.
4. Ferramentas tipadas no `HydraActionExecutor` respeitando o RBAC da Spec 058.
5. Fim da recusa cega no `IntentRewriter`.

---

## 2. Cenários Contratuais (G01–G10)

| ID | Cenário | Critério de Aceitação / Resultado Esperado |
|---|---|---|
| **G01** | Inicialização do banco em schema vazio ou legado | Tabelas `hydra_case_graph_nodes`, `hydra_case_graph_edges`, `hydra_case_current_position` e `hydra_conversation_os_links` criadas com sucesso e idempotência garantida. |
| **G02** | Leitura de conversa com mensagens de cliente e atendente | Mensagens são adaptadas para `SanitizedChatMessage`, identificando remetente (`client`, `agent`), e redigindo dados de cartão ou senhas. |
| **G03** | Interligação OS <-> Conversa por Telefone do Cliente | Quando o telefone E.164 da OS coincide com o telefone do contato no Chatwoot, aresta `TREATS_ORDER` é gerada com `linkMethod: 'PHONE_MATCH'`. |
| **G04** | Interligação OS <-> Conversa por Placa de Veículo | Quando a placa da OS (`JSX9E04`) é mencionada no texto de uma conversa da mesma loja/inbox, aresta `BELONGS_TO_VEHICLE` é criada com `linkMethod: 'PLATE_MATCH'`. |
| **G05** | Interligação OS <-> Conversa por Menção Explícita de OS | Menção de `"OS #4453"` vincula diretamente a conversa à OS 4453 com `confidence: 'HIGH'`. |
| **G06** | Ferramenta `conversations.search` chamada por Admin/Sócio | Retorna lista estruturada de conversas com link do Chatwoot, telefone, loja e OSs correlacionadas. |
| **G07** | Ferramenta `conversations.get_history` chamada por Admin/Sócio | Retorna histórico de mensagens em ordem cronológica, links de acesso rápido (`wa.me` e Chatwoot), sem dados sensíveis. |
| **G08** | Ferramenta `graph.get_os_case` chamada por Admin/Sócio | Retorna posição atual, motivo de atraso documentado, próximo passo prometido e lista de conversas correlacionadas. |
| **G09** | Gerente de loja ou operador tentando usar tools de chat/grafo | Bloqueio imediato (`PERMISSION_DENIED`) na Barreira de Execução, mantendo isolamento da Spec 058. |
| **G10** | Usuário pergunta "o que o cliente do Ka falou?" ou "tem conversa da OS 4453?" | O `IntentRewriter` não emite a mensagem antiga de recusa do Chatwoot; a intenção é resolvida e despachada para o assistente. |

---

## 3. Critérios de Liberação para Produção

- 10/10 cenários (G01–G10) aprovados em suite automatizada.
- Execução limpa via `npx tsx src/hydra-sync/tests/test_spec059_chat_graph_linking.ts`.
- Zero regressão nos 48 testes existentes da Spec 058.
- Nenhuma alteração destrutiva no banco existente da VPS.
