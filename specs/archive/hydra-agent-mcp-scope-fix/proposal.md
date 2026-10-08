# Proposta: Diagnóstico e Correção de Escopo de MCP no Agente (Trace e73ac2e2)

## 1. Evidência do Problema (Análise do Trace Real)
A inspeção detalhada do arquivo [`agent-trace-e73ac2e2-2026-10-06T18-14-17-111Z.json`](file:///C:/Users/User/Downloads/agent-trace-e73ac2e2-2026-10-06T18-14-17-111Z.json) revela com precisão matemática a causa raiz de a IA não ter enviado a mensagem ao gerente:

1. **A IA conversou normalmente até a confirmação do agendamento (Turnos 1 a 8):**
   - O lead informou: Civic 2020, barulho no motor, unidade Kennedy, quarta 07/10 às 10:00, David Silveira, 1199999999.
   - No Turno 8, o usuário confirmou: `"isso"`.
   - A IA respondeu: *"Combinado. Já encaminhei sua solicitação para a Kennedy SBC..."*, mas chamou a ferramenta errada (`get_attendance_stats`).

2. **A Causa Raiz Determinística (`mcp_scope` vs `tools_loaded`):**
   - Em todos os turnos do trace, o evento `mcp_scope` lista em `"raw"` 3 servidores MCP:
     - Servidor 1 (`d1a79267-8ea0-4190-9a55-1d4e4d91662f`): `list_store_managers`, `notify_manager_lead_scheduled`, `notify_manager_lead_cancelled` *(nosso servidor Hydra MCP)*.
     - Servidor 2 (`d43f418e-2624-4b38-9f12-22d053ce7dff`): `convertTimezones`, `mutateDate`, `currentDateTimeAndTimezone`.
     - Servidor 3 (`dd08f329-b344-4858-ac50-a8abf34c4667`): ferramentas de atendimento Chatwoot (`transfer_attendance`, `get_attendance_stats`, etc.).
   - Porém, a lista `"scoped"` e a lista `"tools_loaded"` contêm **EXATAMENTE 12 ferramentas** — apenas dos Servidores 2 e 3!
   - O Servidor 1 (`d1a79267-...`) **FOI EXCLUÍDO DO ESCOPO (`scoped`)** pela plataforma do chatbot (`chat-ui`).
   - Como a ferramenta `notify_manager_lead_scheduled` **NÃO foi carregada no prompt do modelo LLM**, a IA simplesmente **não tinha acesso à ferramenta para executá-la**!

3. **Status do Servidor Hydra MCP:**
   - O servidor MCP em `https://bot.tork.services/mcp/sse` está 100% online, saudável (`/mcp/health` 200 OK) e testado.
   - O cadastro do servidor na plataforma foi bem-sucedido (tanto que as ferramentas aparecem na lista `"raw"`).

## 2. Solução Proposta

### Ação 1: Ajuste de Configuração no Painel do Chatbot (`chat-ui`)
1. Abrir a edição do Chatbot (`chatbot_uuid: e73ac2e2-69c2-431c-90b7-6798a063f810`).
2. Acessar a aba **Ferramentas / Tools / MCP Servers**.
3. **Ativar / Habilitar explicitamente** o MCP `hydra-manager-leads-mcp` (ou marcar as ferramentas `notify_manager_lead_scheduled` e `list_store_managers`).
4. Verificar se os cabeçalhos de autenticação estão salvos corretamente no card do servidor:
   - `Authorization: Bearer hydra-mcp-leads-2026-sec!`
   - (ou `x-api-key: hydra-mcp-leads-2026-sec!`).

### Ação 2: Reforço no Prompt / Instruções do Chatbot
Garantir que o Prompt do Sistema do Chatbot contenha a diretriz explícita de disparo:
> *"Assim que o cliente confirmar o agendamento (nome, telefone, unidade, data e horário), você OBRIGATORIAMENTE deve chamar a ferramenta `notify_manager_lead_scheduled` passando a loja e os dados do lead para que o gerente seja notificado imediatamente no WhatsApp."*

### Ação 3: Validação de Log e Telemetria no Servidor Hydra
Adicionar log explícito de handshake e de execução de tools no PM2 para facilitar auditoria em tempo real de acessos externos.
