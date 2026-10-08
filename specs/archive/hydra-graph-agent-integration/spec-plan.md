# Plano de Execução: Integração do Grafo de Atendimentos nas Buscas do Hydra Agent & Presença Contínua WhatsApp

Spec ID: `hydra-graph-agent-integration`

## Tarefas de Implementação

- [x] [PRESENCE] **Criar Gerenciador de Presença Contínua (`PresenceHeartbeatKeeper`)**
  - Criar `src/hydra-sync/presence_heartbeat.ts` com singleton, ciclo de pulso a cada 4s, timeout de segurança de 60s e cancelamento atômico por telefone.
  - Integrar em `src/hydra-sync/webhook_service.ts`: iniciar heartbeat ao receber o job e interromper antes da entrega do primeiro balão ou em abort por `/reset`.
  - Integrar em `src/hydra-sync/queue_worker.ts`: manter presença contínua durante a execução do dispatcher e encerrar antes de enviar os balões.

- [x] [DB] **Migração Idempotente de Tabelas no Boot**
  - Em `src/hydra-sync/db_repository.ts`, adicionar a chamada `ensureCaseAnalysisTables(db)` na inicialização de schema (`initSchema`).
  - Garantir que `hydra_case_analyses` e `hydra_case_graph_projections` sejam criadas sem erro tanto em instâncias novas quanto legadas.

- [x] [COORDINATOR] **Conectar Fast-Path ao Leitor de Grafo**
  - Em `src/hydra-sync/hybrid_os_coordinator.ts`, atualizar `getCaseContext` para invocar `resolveCaseContext(db, order)` de `case_memory_reader.ts`.
  - Garantir fallback transparente e declaração honesta de limitação quando a OS não possuir análise.

- [x] [MCP] **Criar Ferramenta MCP `get_os_case_history`**
  - Em `src/hydra-sync/mcp_server.ts`, registrar a ferramenta `get_os_case_history` no `ListToolsRequestSchema` com parâmetros `os_id` e `loja_slug`.
  - Implementar o handler em `CallToolRequestSchema` invocando `resolveCaseContextByOs(db, loja_slug, os_id)` e formatando o payload JSON resumido.

- [x] [MCP] **Enriquecer Ferramenta Existente `get_os_details`**
  - Em `src/hydra-sync/mcp_server.ts`, dentro do handler de `get_os_details`, adicionar o nó `historico_atendimento` quando houver projeção de caso disponível.

- [x] [PROMPT] **Atualizar Instruções do Agente Autônomo**
  - Em `src/hydra-sync/agent_dispatcher.ts`, atualizar as diretrizes de MCP no prompt operacional para guiar a LLM a utilizar `get_os_case_history` diante de perguntas sobre atraso, promessas ao cliente e peças pendentes.

- [x] [TESTS] **Suíte Integrada de Testes de Busca de Grafo & Presença**
  - Criar `src/hydra-sync/tests/test_agent_graph_search.ts` com banco SQLite em memória.
  - Validar Gate 1 (Presença contínua com `PresenceHeartbeatKeeper`).
  - Validar Gate 2 (Fast-Path integrado com motivo factual de atraso).
  - Validar Gate 3 (Tool MCP `get_os_case_history` retornando JSON consistente).
  - Validar Gate 4 (Enriquecimento retrocompatível de `get_os_details`).
  - Validar Gate 5 (Regra de Ouro: limitação declarada sem alucinações para OS sem análise).
  - Validar Gate 6 (Bloqueio estrito de acesso cross-store para gerentes).
  - Executar os testes locais com `npx tsx` e garantir 100% PASS.
