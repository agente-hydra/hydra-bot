# Plano de Implementação (Spec-Plan) — Hydra Manager Leads MCP Server

> **ID da Spec:** `hydra-manager-leads-mcp`  
> **Status:** PROPOSTA / AGUARDANDO APROVAÇÃO  
> **Comando de Execução Futura:** `/vibe-apply hydra-manager-leads-mcp`

---

## 1. Distribuição de Responsabilidades por Executor

| Executor | Área de Atuação | Branch / Escopo |
|---|---|---|
| **E1 (Executor 1)** | Gateway MCP SSE, Rotas `/mcp/sse` e `/mcp/messages`, Middleware de Autenticação | `feat/mcp-leads-e1-gateway` |
| **E2 (Executor 2)** | Catálogo e Resolução de Gerentes, Migrações SQLite, Idempotência e Auditoria | `feat/mcp-leads-e2-registry` |
| **E3 (Executor 3)** | Tools MCP, Templates WhatsApp, Disparo via Instância `"atendimento"` / Chatwoot e Test Harness | `feat/mcp-leads-e3-tools` |

---

## 2. Matriz de Tarefas Atômicas

### Fase E1: Gateway MCP SSE & Segurança (Executor 1)
- [x] **[E1-01] [GATEWAY]** Implementar `src/hydra-sync/mcp_lead_server.ts` configurando o servidor MCP com `@modelcontextprotocol/sdk` e transporte `SSEServerTransport`.
- [x] **[E1-02] [AUTH]** Implementar middleware de autenticação validando `Authorization: Bearer <TOKEN>` e `x-api-key: <TOKEN>` contra `HYDRA_MCP_API_KEY` (com fallback seguro).
- [x] **[E1-03] [HTTP]** Integrar rotas `GET /mcp/sse`, `POST /mcp/messages` e `GET /mcp/health` no servidor HTTP de `webhook-listener.js` sem interferir no ingress de mensagens WhatsApp.
- [x] **[E1-04] [TEST]** Criar suíte de testes `src/hydra-sync/tests/test_mcp_sse_gateway.ts` validando handshake SSE, rejeição 401 para token inválido e concorrência de sessões.

### Fase E2: Catálogo de Gerentes & Auditoria SQLite (Executor 2)
- [x] **[E2-01] [DB]** Criar migração SQLite para as tabelas `hydra_store_managers` e `hydra_manager_notifications` em `hydra_ops.db`.
- [x] **[E2-02] [REGISTRY]** Implementar `src/hydra-sync/manager_registry.ts` com seed das 10 lojas e seus números de gerentes canônicos.
- [x] **[E2-03] [RESOLVER]** Implementar função `resolveStoreAndManager(db, lojaInput: string)` com normalização fuzzy para mapear nomes informados ("Jorge Beretta", "beretta", "jabaquara", etc.) para o registro canônico.
- [x] **[E2-04] [IDEMPOTENCY]** Implementar verificação de idempotência `checkNotificationIdempotency(db, idExterno, tipo)` para evitar disparos duplicados dentro de 24 horas.
- [x] **[E2-05] [TEST]** Criar suíte `src/hydra-sync/tests/test_manager_registry.ts` validando resolução de lojas, tratamento de lojas desconhecidas e deduplicação no SQLite.

### Fase E3: Ferramentas MCP & Disparo WhatsApp via "atendimento" (Executor 3)
- [/] **[E3-01] [TOOLS]** Registrar as ferramentas `notify_manager_lead_scheduled`, `notify_manager_lead_cancelled` e `list_store_managers` no servidor MCP com schemas JSON estritos.
- [/] **[E3-02] [TEMPLATES]** Implementar geradores de mensagens formatadas da Central de Atendimento da Mecânica Popular (agendamento e cancelamento) sem markdown tables e sem asteriscos duplos.
- [/] **[E3-03] [DISPATCH]** Integrar execução do envio via `WhatsAppClient` configurado com `instance: 'atendimento'`, garantindo reflexão automática no Chatwoot (`chat.tork.services`), captura do `messageId` e registro de auditoria.
- [/] **[E3-04] [HARNESS]** Construir Test Harness integrado `src/hydra-sync/tests/test_mcp_leads_notifications.ts` cobrindo:
  - Notificação de lead agendado entregue com sucesso pela instância `"atendimento"` ao gerente correto da unidade.
  - Notificação de cancelamento com detalhes e motivo.
  - Bloqueio de duplicata quando `id_externo` for reutilizado.
  - Rejeição elegante quando a loja informada for inválida, listando as lojas válidas.
  - Listagem de lojas para o bot chamador.

---

## 3. Matriz de Cenários de Aceite (M01 – M08)

| ID | Cenário | Entrada | Comportamento Esperado |
|---|---|---|---|
| **M01** | Lead agendado para Jorge Beretta | `loja: "Jorge Beretta"`, cliente, data | Mensagem enviada para `5511998874158` via instância `atendimento` com status `ENVIADO`. |
| **M02** | Lead agendado com slug informal | `loja: "jabaquara"`, cliente, data | Mapeia para Jabaquara (`5511933733131`) e entrega via `atendimento`. |
| **M03** | Cancelamento de agendamento | `loja: "Kennedy"`, motivo: "Imprevisto" | Mensagem de cancelamento enviada para `5511984926600` via `atendimento` com status `ENVIADO`. |
| **M04** | Deduplicação por `id_externo` | Mesma tool call com `id_externo: "lead_123"` | Retorna `status: "DUPLICADO"`, zero novas mensagens disparadas no WhatsApp. |
| **M05** | Loja inexistente ou inválida | `loja: "Loja Inexistente XYZ"` | Retorna erro descritivo listando as 10 lojas operacionais válidas, zero disparos. |
| **M06** | Autenticação MCP inválida | Requisição sem Bearer ou token incorreto | Resposta HTTP `401 Unauthorized`, zero processamento. |
| **M07** | Listagem de gerentes/lojas | Chamada à tool `list_store_managers` | Retorna catálogo das 10 lojas com status de prontidão sem vazar telefones brutos. |
| **M08** | Falha transitória da Evolution API | Simulação de timeout HTTP | Executa retries exponenciais, grava `FAILED` em auditoria e retorna erro sanitizado. |

---

## 4. Gates de Validação Obrigatórios

1. **Gate 1 (Build):** `npm run build` ou `npx tsc --noEmit` sem nenhum erro (`0 errors`).
2. **Gate 2 (Harness de Testes):** Execução de `test_mcp_sse_gateway.ts`, `test_manager_registry.ts` e `test_mcp_leads_notifications.ts` com 100% PASS em staging.
3. **Gate 3 (Deploy & Observabilidade):** Reload no PM2 e teste de handshake SSE ao vivo na rota `/mcp/sse`.
