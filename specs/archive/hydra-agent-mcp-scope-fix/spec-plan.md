# Plano de Ação: hydra-agent-mcp-scope-fix

- [x] [ANALYSIS] Apresentar ao usuário o diagnóstico exato baseado no trace `agent-trace-e73ac2e2` demonstrando por que a IA não chamou a ferramenta (servidor listado em `raw`, mas desmarcado em `scoped`).
- [x] [GUIDE] Fornecer o passo a passo exato para marcar/ativar o MCP `hydra-manager-leads-mcp` dentro das configurações do Chatbot no painel da plataforma.
- [x] [PROMPT] Disponibilizar a instrução recomendada para adicionar no prompt do chatbot garantindo que a IA chame a tool ao confirmar o agendamento.
- [x] [SERVER] Adicionar logs em tempo real no servidor Hydra MCP (`mcp_lead_server.ts`) para auditar no terminal assim que o chatbot do usuário fizer a requisição.
