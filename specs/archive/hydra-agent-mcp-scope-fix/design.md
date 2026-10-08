# Design Técnico: Correção de Escopo e Instrumentação de Auditoria MCP

## 1. Fluxo de Execução Comparado (O que aconteceu vs O que deve acontecer)

### O que ocorreu no Trace `agent-trace-e73ac2e2`:
```
[Chatbot e73ac2e2]
       │
       ├─── mcp_scope.raw: [ Servidor 1 (Hydra), Servidor 2 (Time), Servidor 3 (Attendance) ]
       │
       ├─── mcp_scope.scoped: [ Servidor 2, Servidor 3 ]  <-- Servidor Hydra NÃO foi selecionado!
       │
       ├─── tools_loaded: 12 tools (Time + Attendance)    <-- notify_manager_lead_scheduled ausente
       │
       ├─── Usuário: "isso" (Confirmação do agendamento)
       │
       ├─── LLM tenta agir, mas só possui get_attendance_stats
       │
       └─── Executa get_attendance_stats e responde textualmente sem notificar o WhatsApp!
```

### O que deve ocorrer após a ativação:
```
[Chatbot e73ac2e2]
       │
       ├─── mcp_scope.scoped: [ Servidor 1 (Hydra), Servidor 2, Servidor 3 ]
       │
       ├─── tools_loaded: 15 tools (incluindo notify_manager_lead_scheduled)
       │
       ├─── Usuário: "isso"
       │
       ├─── LLM executa: notify_manager_lead_scheduled({ loja: "Kennedy", ... })
       │
       └─── Servidor Hydra despacha WhatsApp via instância "atendimento" -> 11996242812 (Teste)!
```

## 2. Ajustes de Instrumentação no Servidor MCP (`mcp_lead_server.ts`)
Para garantir 100% de transparência e observabilidade quando o `chat-ui` conectar:
1. **Log de SSE Handshake:** Registrar no console quando um cliente SSE conectar, seu IP e SessionId.
2. **Log de Chamada de Tool:** Registrar no console quando `notify_manager_lead_scheduled` for acionada remotamente, com parâmetros recebidos e tempo de resposta.
3. **Log de Rejeição de Auth:** Se o `chat-ui` enviar token inválido, registrar `[MCP Auth] 401 Unauthorized` para alertar o operador imediatamente.
