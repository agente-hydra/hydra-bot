# Proposta de Arquitetura — Hydra Manager Leads MCP Server

> **ID da Spec:** `hydra-manager-leads-mcp`  
> **Data:** 06/10/2026 (Atualizado: Instância Atendimento & Chatwoot)  
> **Status:** PROPOSTA / AGUARDANDO APROVAÇÃO  
> **Executores:** E1 (MCP SSE & Auth Gateway), E2 (Gerentes & Auditoria SQLite), E3 (Disparo WhatsApp via Atendimento/Chatwoot & Notification Tools)

---

## 1. Contexto e Problema de Negócio

### 1.1. O Cenário
A rede automotiva opera com bots de atendimento / SDR / conversão de leads (WhatsApp, site, Google Ads) que qualificam e agendam clientes para as 10 oficinas operacionais. Quando um cliente confirma um agendamento ou cancela uma visita, o gerente da respectiva unidade física precisa ser avisado **imediatamente** via WhatsApp direto para organizar o pátio, os boxes e a equipe de mecânicos.

### 1.2. Decisão de Emissor: Instância "atendimento" & Chatwoot
Em alinhamento direto com a diretriz do projeto:
- O emissor oficial das mensagens de WhatsApp para os gerentes **NÃO será a instância interna do bot Hydra**, e sim a **instância oficial `"atendimento"`** (`Mecânica Popular`, número `5511917698769`).
- **Integração Nativa com o Chatwoot (`chat.tork.services`):** A instância `"atendimento"` já possui webhook e sincronização bi-direcional ativa com a Inbox "atendimento" do Chatwoot. Logo, todo disparo realizado pelo MCP fica **imediatamente visível no chat de atendimento**, permitindo que os operadores humanos acompanhem os avisos e eventuais respostas dos gerentes no painel unificado.

### 1.3. O Problema Resolvido
Atualmente, bots externos não têm acesso seguro nem conhecimento do mapeamento de números privados de cada gerente de loja. O Servidor MCP resolve:
1. **Roteamento Exato por Unidade:** Notifica o gerente da loja correta (ex: Jorge Beretta, Kennedy, Jabaquara) sem desvio cross-store.
2. **Canal Oficial Reconhecido:** O gerente recebe a mensagem no WhatsApp vinda do número oficial de Atendimento da rede (`Mecânica Popular`), com visual padronizado e profissional.
3. **Visibilidade Operacional no Chatwoot:** O histórico completo das notificações e respostas fica registrado na caixa de entrada do Chatwoot.
4. **Idempotência e Auditoria:** Chamadas repetidas pelo bot externo não duplicam mensagens no WhatsApp do gerente.

---

## 2. Solução Proposta: Servidor MCP do Hydra (Canal Atendimento)

Expor um **Servidor MCP (Model Context Protocol)** padrão SSE (Server-Sent Events) sobre HTTP, hospedado e gerenciado pelo ecossistema **Hydra**, permitindo que qualquer agente de IA ou bot externo autorizado invoque ferramentas especializadas de notificação.

### 2.1. Princípios Inegociáveis
1. **Disparo pela Instância "atendimento":** O envio WhatsApp é executado **estritamente pela instância `"atendimento"`** na Evolution API, usando o `WhatsAppClient` com controle de presença, sanitização de markdown e retry com backoff exponencial.
2. **Rastreabilidade no Chatwoot:** Cada disparo reflete em conversa aberta na Inbox `atendimento` (`accountId: 1`, `chat.tork.services`), garantindo observabilidade para a equipe comercial e de suporte.
3. **Resolução Determinística de Gerente:** O bot externo apenas informa a loja (`loja_slug` ou nome da loja) e os dados do lead. O sistema resolve internamente o número canônico do gerente daquela unidade específica a partir do catálogo validado e das instâncias da Evolution API (`ownerJid`).
4. **Idempotência por Chave Única (`lead_id` ou `agendamento_id`):** Notificações repetidas com a mesma chave dentro de 24 horas não geram mensagens duplicadas no WhatsApp do gerente.
5. **Auditoria Completa em SQLite:** Cada chamada MCP e cada mensagem despachada é registrada em `hydra_manager_notifications` com status (`PENDING`, `SENT`, `FAILED`, `DUPLICATE`), messageId da Evolution e tempo de resposta.
6. **Autenticação Rigorosa:** Acesso ao endpoint MCP protegido por API Key no cabeçalho HTTP (`Authorization: Bearer <TOKEN>` ou `x-api-key: <TOKEN>`).

---

## 3. Ferramentas MCP Expostas (Tools Catalog)

### Tool 1: `notify_manager_lead_scheduled`
Notifica o gerente da loja sobre um novo lead convertido e agendado.
- **Entrada:**
  - `loja` (string, obrigatório): Nome ou slug da loja (ex: `"Jorge Beretta"`, `"mpjorgeberetta"`, `"Kennedy"`, etc.).
  - `cliente_nome` (string, obrigatório): Nome do cliente.
  - `cliente_telefone` (string, obrigatório): Telefone/WhatsApp do cliente.
  - `data_agendamento` (string, obrigatório): Data agendada (ex: `"08/10/2026"`).
  - `horario_agendamento` (string, obrigatório): Horário agendado (ex: `"14:30"`).
  - `veiculo` (string, opcional): Marca/modelo/ano/placa do veículo.
  - `servico_pretendido` (string, opcional): Ex: `"Troca de óleo do câmbio automático"`.
  - `origem_lead` (string, opcional): Canal de conversão (ex: `"Google Ads"`, `"Instagram"`, `"Site"`).
  - `observacoes` (string, opcional): Observações e necessidades relatadas pelo cliente.
  - `id_externo` (string, opcional): ID único no CRM/bot externo para garantia de idempotência.
- **Saída:**
  - `status`: `"ENVIADO"`, `"DUPLICADO"` ou `"ERRO"`.
  - `loja_resolvida`: Nome canônico da loja.
  - `gerente_nome`: Nome do gerente que recebeu a mensagem.
  - `gerente_telefone_mascarado`: Telefone com máscara de privacidade (ex: `55119988****8`).
  - `instancia_emissora`: `"atendimento"`.
  - `whatsapp_message_id`: ID da mensagem entregue pela Evolution API.

### Tool 2: `notify_manager_lead_cancelled`
Notifica o gerente da loja sobre cancelamento ou desistência de agendamento.
- **Entrada:**
  - `loja` (string, obrigatório): Nome ou slug da loja.
  - `cliente_nome` (string, obrigatório): Nome do cliente.
  - `cliente_telefone` (string, obrigatório): Telefone do cliente.
  - `data_agendamento` (string, obrigatório): Data que estava agendada.
  - `horario_agendamento` (string, obrigatório): Horário que estava agendado.
  - `veiculo` (string, opcional): Veículo do cliente.
  - `motivo_cancelamento` (string, opcional): Motivo informado (ex: `"Imprevisto de trabalho"`, `"Vendeu o veículo"`).
  - `reagendamento_pretendido` (boolean, opcional): Se o cliente pediu para remarcar posteriormente.
  - `observacoes` (string, opcional): Informações complementares.
  - `id_externo` (string, opcional): ID único para idempotência.
- **Saída:**
  - `status`: `"ENVIADO"`, `"DUPLICADO"` ou `"ERRO"`.
  - `loja_resolvida`: Nome canônico da loja.
  - `gerente_nome`: Nome do gerente que recebeu a mensagem.
  - `gerente_telefone_mascarado`: Telefone com máscara.
  - `instancia_emissora`: `"atendimento"`.
  - `whatsapp_message_id`: ID da mensagem entregue.

### Tool 3: `list_store_managers`
Permite ao bot chamador inspecionar as lojas operacionais atendidas, seus nomes e se o canal do gerente está ativo.
- **Entrada:** Nenhuma.
- **Saída:** Lista de lojas com `slug`, `nome_exibicao` e `gerente_configurado` (booleano). Não expõe números brutos para agentes de IA para segurança.

---

## 4. Ficha de Conexão MCP (Para o Usuário/Cliente)

```yaml
# ─── FICHA DE CONFIGURAÇÃO DO SERVIDOR MCP ────────────────────────────────────

Informe a URL do Servidor MCP:
https://bot.tork.services/mcp/sse
(URL alternativa direta da VPS: http://100.126.50.101:3333/mcp/sse)

Informe o nome(input):
hydra-manager-leads-mcp

Descrição(input):
Servidor MCP para envio de notificações diretas no WhatsApp dos gerentes das lojas físicas através da instância oficial de Atendimento da Mecânica Popular (com sincronização ao vivo no Chatwoot), cobrindo agendamento, conversão e cancelamento de leads com prevenção de duplicidade.

Autenticação:
Bearer Token / API Key

(input)Cabeçalhos Customizados:
Authorization: Bearer hydra-mcp-leads-2026-sec!
x-api-key: hydra-mcp-leads-2026-sec!
```

---

## 5. Mitigação de Riscos e Circuit Breakers

1. **Risco de Spam ou Duplicação por Retry do Bot:**
   - O endpoint verifica `id_externo` na tabela `hydra_manager_notifications`. Se já foi enviado nos últimos 1440 minutos (24h), retorna sucesso imediato com `status: "DUPLICATE_ALREADY_SENT"`, sem disparar WhatsApp novamente.
2. **Risco de Loja Desconhecida:**
   - Normalizador com aliases (ex: "jorge", "beretta", "jorge beretta", "mpjorgeberetta" -> `MPJorgeBeretta`). Se não identificar com confiança mínima, rejeita com erro descritivo listando as 10 lojas válidas.
3. **Resiliência da Instância "atendimento":**
   - O `WhatsAppClient` instancia explicitamente `instance: 'atendimento'`. Se a instância estiver temporariamente desconectada, o erro é capturado e retornado de forma clara sem crash.
4. **Isolamento de Credenciais:**
   - O bot chamador não tem acesso a senhas da Evolution API, banco SQLite ou dados confidenciais de outras lojas.

---

## 6. Distribuição entre os Executores

- **E1 (Executor 1):** Infraestrutura de Transporte MCP (SSE), Middleware HTTP, Autenticação por Header, Roteador `/mcp/sse` e `/mcp/messages`.
- **E2 (Executor 2):** Resolução Determinística de Gerentes por Loja (`manager_registry.ts`), Tabela SQLite `hydra_manager_notifications` e controle de idempotência.
- **E3 (Executor 3):** Implementação das Tools MCP, Templates Visuais WhatsApp, Integração com `WhatsAppClient` via instância `"atendimento"` e Suíte de Testes Ponta a Ponta.
