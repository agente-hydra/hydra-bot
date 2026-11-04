# Spec 059 — Acesso a Conversas de Chat e Interligação de OS em Grafo

**ID da Spec:** `059-hydra-chat-conversas-grafo-os`  
**Data:** 02/11/2026  
**Status:** ESPECIFICAÇÃO DE PROPOSTA (SDD PROPOSAL)  
**Target:** Node.js 22 LTS / TypeScript Strict / SQLite WAL (`hydra_ops.db`) / Chatwoot API v1 / Evolution API v2 (`100.126.50.101`)

---

## 1. Problema e Diagnóstico Factual

O usuário solicitou que o Hydra Assistant (Admin e Sócios) tenha acesso às conversas de atendimento (chat) e que interligue as Ordens de Serviço (OS) com as conversas em um Grafo relacional, notando: *"já tem algo assim no código mas não está sendo utilizado, não sei por que"*.

### 1.1 Auditoria do Código e do Ambiente Real da VPS

A investigação empírica no código (`src/hydra-sync/`) e no banco de dados de produção da VPS (`/home/operacional/hydra-data/hydra_ops.db`) revelou os seguintes fatos:

1. **Código Existente Não Conectado:**
   - Existem módulos completos desenvolvidos em especificações anteriores (`specs/hydra-case-history-graph/` e `specs/hydra-os-conversation-context/`):
     - [`src/hydra-sync/case_graph_projection.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/case_graph_projection.ts): Define nós (`CONVERSA`, `ANALISE`, `FATO`, `ORDEM_SERVICO`) e arestas (`COVERS_SEGMENT`, `CONTAINS_STATEMENT`, `TREATS_ORDER`).
     - [`src/hydra-sync/case_current_position.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/case_current_position.ts): Redutor de estado de caso operacional.
     - [`src/hydra-sync/case_memory_reader.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/case_memory_reader.ts): Leitor e consolidador estruturado de contexto de caso (`resolveCaseContext`).
     - [`src/hydra-sync/conversation_source_adapter.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/conversation_source_adapter.ts): Normalizador de payloads brutos do Chatwoot (`ChatwootMessageRaw`) para `SanitizedMessage`.
   - **Causa Raiz 1 (Instanciação Restrita a Testes):** Esses módulos só são importados e executados em suites de testes unitários (`test_case_graph_gates.ts`, `test_executor3_graph_projection.ts`). Em nenhum momento do ciclo de vida de produção (`webhook-listener.js`, `agent_dispatcher.ts` ou cron) o `CaseGraphProjector` ou o sincronizador são instanciados.
   - **Causa Raiz 2 (Tabelas Vazias ou Inexistentes na VPS):** A auditoria via Python no `hydra_ops.db` revelou:
     - `hydra_case_analyses`: 0 registros.
     - `hydra_case_graph_projections`: 0 registros.
     - `hydra_case_graph_nodes`: Tabela inexistente.
     - `hydra_case_graph_edges`: Tabela inexistente.
     - `hydra_case_current_position`: Tabela inexistente.
   - **Causa Raiz 3 (Bloqueio Intencional no Intent Rewriter):** Em [`src/hydra-sync/intent_rewriter.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/intent_rewriter.ts) (L977–L983), qualquer menção a ticket, chatwoot ou ver conversa externa é interceptada e bloqueada com resposta fixa: *"Não tenho acesso à leitura de links externos ou histórico direto do Chatwoot..."*.
   - **Causa Raiz 4 (Sem Ferramentas no Executor do Assistente):** Em [`src/hydra-sync/hydra_action_executor.ts`](file:///C:/Users/User/Desktop/agy/src/hydra-sync/hydra_action_executor.ts) (Spec 058), há tools de relatórios, pesquisa web, envio de mensagem e gestão de usuários, mas nenhuma tool tipada para consulta de histórico de conversas ou inspeção do grafo de atendimentos.
   - **Causa Raiz 5 (Massa de Dados Existente Isolada):** O Chatwoot na VPS possui **4.275 conversas**, **3.932 contatos** e **211.920 mensagens**, porém desacopladas do SQLite do Hydra.

---

## 2. Solução Proposta

Implementar uma esteira de **Indexação, Interligação em Grafo e Consulta de Conversas** para o Hydra Assistente:

1. **Bootstrap Idempotente do Schema de Grafo no SQLite:**
   - Garantir a criação formal e indexação de `hydra_case_graph_nodes`, `hydra_case_graph_edges`, `hydra_analises_atendimento`, `hydra_afirmacoes_analisadas` e `hydra_case_current_position` no boot de `db_repository.ts`.
2. **Conector Read-Only de Conversas do Chatwoot (`ChatwootConversationReader`):**
   - Leitor seguro consumindo a API interna do Chatwoot (`https://chat.tork.services/api/v1/accounts/1/` com token em `.env`) e/ou espelho de mensagens sanitizadas.
   - Suporte a filtros: por ID da conversa, por telefone do cliente (E.164), por placa de veículo ou por texto.
   - Proteção de privacidade: Redação de números de cartão, CVV e dados sensíveis antes de disponibilizar para análise do modelo.
3. **Indexador e Interligador de Grafo OS <-> Conversa (`OsConversationGraphLinker`):**
   - Regras determinísticas de correlação:
     - **Regra L1 (Telefone):** Telefone do cliente na OS bate com contato no Chatwoot.
     - **Regra L2 (Placa do Veículo):** Placa identificada na OS (`ABC1234` / `ABC1D23`) mencionada no histórico da conversa da mesma loja/inbox.
     - **Regra L3 (Número de OS):** Número da OS citado explicitamente no chat (`OS 4453`, `OS #1916`).
   - Geração atômica dos nós (`CONVERSA`, `ORDEM_SERVICO`, `VEICULO`, `CLIENTE`) e arestas (`TREATS_ORDER`, `BELONGS_TO_VEHICLE`, `TALKS_TO_CLIENT`).
4. **Novas Ferramentas Seguras no `HydraActionExecutor`:**
   - `conversations.search`: Busca conversas por placa, telefone ou termo.
   - `conversations.get_history`: Retorna as últimas N mensagens sanitizadas de uma conversa específica.
   - `graph.get_os_case`: Consulta a posição atual do grafo e histórico interligado da OS.
5. **Desbloqueio e Roteamento no `IntentRewriter`:**
   - Eliminação da recusa cega de Chatwoot/tickets externos em `intent_rewriter.ts`.
   - Roteamento inteligente de perguntas sobre histórico de cliente, aprovações de orçamento no WhatsApp e andamento do atendimento.

---

## 3. Contratos de Dados Principais

```typescript
export interface LinkedConversationResult {
  readonly conversationId: number;
  readonly inboxId: number;
  readonly storeSlug: string;
  readonly customerName?: string;
  readonly customerPhone?: string;
  readonly linkedOsIds: number[];
  readonly vehiclePlate?: string;
  readonly vehicleModel?: string;
  readonly lastMessageAt?: string;
  readonly lastMessageSnippet?: string;
  readonly linkMethod: 'PHONE_MATCH' | 'PLATE_MATCH' | 'OS_MENTION';
  readonly confidence: 'HIGH' | 'MEDIUM';
}

export interface OsCaseGraphView {
  readonly osId: number;
  readonly storeSlug: string;
  readonly vehiclePlate?: string;
  readonly vehicleModel?: string;
  readonly currentStatus: string;
  readonly delayReason?: string;
  readonly nextPromisedStep?: string;
  readonly linkedConversations: LinkedConversationResult[];
  readonly recentFacts: Array<{
    readonly factId: string;
    readonly subject: string;
    readonly polarity: 'CONFIRMED' | 'DENIED' | 'PENDING';
    readonly authorRole: string;
    readonly rawExcerpt: string;
    readonly timestamp: string;
  }>;
}
```

---

## 4. Riscos Principais e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Sobrecarga do Chatwoot por polling contínuo | Degradação no atendimento ao vivo | Consultas ativas pontuais via cache LRU de 5 min; sem polling destrutivo. |
| Injeção de dados falsos em mensagens de clientes | Alucinação sobre aprovação de orçamento | Validação de autoria: apenas mensagens `outgoing` de atendentes ou áudios/mensagens explícitas de aprovação do cliente geram fatos confirmados. |
| Violação de privacidade (LGPD) | Vazamento de senhas ou dados bancários | Camada de higienização prévia (`sanitizeTranscriptForAi`) aplicando redação de dados sensíveis antes de entregar às ferramentas. |
| Falha de link por formato de telefone divergente | OS sem vínculo com conversa existente | Normalização para E.164 com variantes de busca (com e sem DDI 55). |

---

## 5. Critério de Conclusão

- Todas as 5 causas raízes identificadas sanadas.
- Schema de grafo migrado e operacional em SQLite.
- Novas tools de conversas e grafo implementadas, testadas e protegidas pelas permissões da Spec 058.
- Consultas conversacionais respondem com histórico real do chat e links de OS comprovados.
