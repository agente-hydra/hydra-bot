# Guia de Conexão — Hydra Manager Leads MCP Server

## 1. Dados de Conexão MCP (Ficha Cadastral)

| Campo | Valor para Preenchimento |
| :--- | :--- |
| **Informe a URL do Servidor MCP** | `https://bot.tork.services/mcp/sse` |
| **Informe o nome (input)** | `hydra-manager-leads-mcp` |
| **Descrição (input)** | `Servidor MCP para notificações instantâneas aos gerentes das 10 lojas físicas sobre agendamentos e cancelamentos de leads via WhatsApp da Central de Atendimento.` |
| **Autenticação** | `Bearer` (ou `API Key`) |
| **(input) Cabeçalhos Customizados** | `Authorization: Bearer hydra-mcp-leads-2026-sec!` |

> **Nota sobre Cabeçalho Alternativo:** Se a plataforma de bots solicitar cabeçalho de API Key simples em vez de Bearer, utilize:  
> `x-api-key: hydra-mcp-leads-2026-sec!`

---

## 2. Emissor WhatsApp e Espelhamento

- **Instância Emissora Oficial:** `"atendimento"` (`ownerJid: 5511917698769@s.whatsapp.net`).
- **Espelhamento:** Registrado em tempo real no Chatwoot (`https://chat.tork.services`, conta 1, Inbox Atendimento).
- **Trava de Segurança Ativa para Testes:**  
  `MCP_FORCE_RECIPIENT=5511996242812`  
  *Nenhum gerente real receberá mensagens durante a fase de homologação. Todas as mensagens disparadas pelo bot de conversão serão entregues estritamente para `11996242812` com o banner explicativo no topo.*

---

## 3. Ferramentas Disponíveis (MCP Tools)

### `list_store_managers`
- **Descrição:** Lista as 10 lojas físicas ativas, seus nomes oficiais e se o canal do gerente está habilitado.
- **Parâmetros:** Nenhum (`{}`).

### `notify_manager_lead_scheduled`
- **Descrição:** Envia notificação estruturada de agendamento de lead ao gerente da loja indicada.
- **Parâmetros:**
  - `loja` (string, obrigatório): Nome ou slug da loja (ex: `"Jorge Beretta"`, `"Kennedy"`, `"Dom Pedro"`).
  - `cliente_nome` (string, obrigatório): Nome do cliente agendado.
  - `cliente_telefone` (string, obrigatório): WhatsApp/telefone do cliente com DDD.
  - `data_agendamento` (string, obrigatório): Data agendada (ex: `"08/10/2026"`).
  - `horario_agendamento` (string, obrigatório): Horário (ex: `"10:00"`).
  - `veiculo` (string, opcional): Modelo, ano ou placa do veículo.
  - `servico_pretendido` (string, opcional): Serviço desejado.
  - `origem_lead` (string, opcional): Canal de entrada (ex: `"Google Ads"`, `"Instagram"`).
  - `observacoes` (string, opcional): Notas de agendamento.
  - `id_externo` (string, opcional): ID único no CRM para garantia de envio único e idempotência em 24h.

### `notify_manager_lead_cancelled`
- **Descrição:** Notifica o cancelamento de agendamento ao gerente para liberação do box no pátio.
- **Parâmetros:**
  - `loja` (string, obrigatório)
  - `cliente_nome` (string, obrigatório)
  - `cliente_telefone` (string, obrigatório)
  - `data_agendamento` (string, obrigatório)
  - `horario_agendamento` (string, obrigatório)
  - `motivo_cancelamento` (string, opcional)
  - `reagendamento_pretendido` (boolean, opcional)
  - `veiculo` (string, opcional)
  - `observacoes` (string, opcional)
  - `id_externo` (string, opcional)

---

## 4. Mapeamento Auditado de Gerentes por Loja

| Loja | Slug Oficial | Instância WhatsApp | Telefone Gerente (Produção) |
| :--- | :--- | :--- | :--- |
| **Jorge Beretta** | `MPJorgeBeretta` | `Jorge Beretta` | `5511998874158` |
| **Kennedy** | `MPkennedy` | `Kennedy` | `5511984926600` |
| **Dom Pedro I** | `MPdompedro1` | `Dom Pedro` | `5511963717410` |
| **Rudge Ramos** | `MPrudge` | `Rudge` | `5511947439443` |
| **Jabaquara** | `MPJabaquara` | `Jabaquara` | `5511933733131` |
| **Piraporinha** | `MPpiraporinha` | `Piraporinha` | `5511983012850` |
| **Planalto** | `MPplanalto` | `Planalto` | `5511984325302` |
| **Rei do Óleo Mauá** | `ReiDoOleoMaua` | `Maua` | `5511984324928` |
| **Santo André** | `MPSantoAndre` | `Carijós` | `5511917698769` (Central / Fallback) |
| **Rei do Módulo** | `ReiDoModulo` | `REI DO MODULO` | `5511917698769` (Central / Fallback) |
