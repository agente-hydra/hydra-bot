# Documento de Design — Hydra Manager Leads MCP Server

> **ID da Spec:** `hydra-manager-leads-mcp`  
> **Data:** 06/10/2026 (Atualizado: Instância Atendimento & Chatwoot)  
> **Status:** PROPOSTA / AGUARDANDO APROVAÇÃO

---

## 1. Visão Geral da Arquitetura

O sistema implementa uma camada de integração baseada no **Model Context Protocol (MCP)** sobre **Server-Sent Events (SSE)** em conformidade com o SDK `@modelcontextprotocol/sdk`.

O envio de mensagens WhatsApp para os gerentes ocorre **exclusivamente através da instância oficial `"atendimento"`** da Evolution API, que está conectada e sincronizada em tempo real com o **Chatwoot** (`chat.tork.services`, conta 1, inbox `atendimento`).

```
┌─────────────────────────────────┐
│     Bot Externo de Leads        │  (Agente de IA / CRM / SDR)
│   (Dify, Flowise, n8n, etc.)    │
└────────────────┬────────────────┘
                 │
                 │ HTTP POST / GET (SSE) com Header Authorization
                 ▼
┌─────────────────────────────────┐
│       Hydra MCP Gateway         │  (Porta 3333 ou Traefik /mcp)
│   - Validação de API Key/Bearer │
│   - SSEServerTransport MCP      │
└────────────────┬────────────────┘
                 │
                 │ Execução da Tool MCP
                 ▼
┌─────────────────────────────────┐
│    Manager Notification Core    │
│  1. Idempotência (id_externo)   │
│  2. Resolução de Loja / Gerente │
│  3. Formatação Template Oficial │
└────────┬───────────────┬────────┘
         │               │
         │ SQLite WAL    │ Disparo via instância 'atendimento'
         ▼               ▼
┌─────────────────┐  ┌──────────────────────────────────┐
│ hydra_ops.db    │  │ WhatsAppClient (Evolution API)   │
│ Auditoria       │  │ Instância: "atendimento"         │
│ e Idempotência  │  │ Destinatário: Telefone do Gerente│
└─────────────────┘  └─────────────────┬────────────────┘
                                       │
                                       │ Sincronização Automática
                                       ▼
                     ┌──────────────────────────────────┐
                     │ Chatwoot (chat.tork.services)    │
                     │ Inbox: "atendimento"             │
                     │ Visibilidade para atendentes     │
                     └──────────────────────────────────┘
```

---

## 2. Contratos de Dados e Tipos TypeScript

### 2.1. Interfaces de Entrada e Saída

```typescript
export interface LeadScheduleNotificationInput {
  loja: string;
  cliente_nome: string;
  cliente_telefone: string;
  data_agendamento: string;
  horario_agendamento: string;
  veiculo?: string;
  servico_pretendido?: string;
  origem_lead?: string;
  observacoes?: string;
  id_externo?: string;
}

export interface LeadCancellationNotificationInput {
  loja: string;
  cliente_nome: string;
  cliente_telefone: string;
  data_agendamento: string;
  horario_agendamento: string;
  veiculo?: string;
  motivo_cancelamento?: string;
  reagendamento_pretendido?: boolean;
  observacoes?: string;
  id_externo?: string;
}

export interface NotificationDispatchResult {
  sucesso: boolean;
  status: 'ENVIADO' | 'DUPLICADO' | 'ERRO_LOJA' | 'ERRO_GERENTE' | 'FALHA_ENVIO';
  mensagem_usuario: string;
  loja_resolvida?: string;
  loja_slug?: string;
  gerente_nome?: string;
  gerente_telefone_mascarado?: string;
  instancia_emissora: 'atendimento';
  whatsapp_message_id?: string;
  duracao_ms: number;
  erro_detalhe?: string;
}

export interface StoreManagerProfile {
  loja_slug: string;
  loja_nome: string;
  gerente_nome: string;
  gerente_telefone: string; // formato canônico: 5511...
  instance_evolution?: string;
  is_ativo: boolean;
}
```

---

## 3. Mapeamento Oficial de Gerentes por Loja

Com base na auditoria das instâncias reais conectadas na Evolution API e no `CATALOGO_10_LOJAS`:

| Loja Slug | Nome Oficial da Loja | Instância Evolution | Gerente / Responsável | Telefone Canônico |
|---|---|---|---|---|
| `mpjorgeberetta` | Jorge Beretta | `Jorge Beretta` | Gerente Jorge Beretta | `5511998874158` |
| `mpkennedy` | Kennedy | `Kennedy` | Gerente Kennedy | `5511984926600` |
| `mpdompedro1` | Dom Pedro I | `Dom Pedro` | Gerente Dom Pedro | `5511963717410` |
| `mprudge` | Rudge Ramos | `Rudge` | Gerente Rudge | `5511947439443` |
| `mpjabaquara` | Jabaquara | `Jabaquara` | Gerente Jabaquara | `5511933733131` |
| `mppiraporinha` | Piraporinha | `Piraporinha` | Gerente Piraporinha | `5511983012850` |
| `mpsantoandre` | Santo André (Carijós) | `Carijós` | Gerente Santo André | `5511917698769` *(fallback)* |
| `mpplanalto` | Planalto | `Planalto` | Gerente Planalto | `5511984325302` |
| `reidooleomaua` | Rei do Óleo Mauá | `Maua` | Gerente Mauá | `5511984324928` |
| `reidomodulo` | Rei do Módulo | `REI DO MODULO` | Gerente Rei do Módulo | `5511917698769` *(fallback)* |

---

## 4. Schemas das Ferramentas MCP (Tools Definition)

### 4.1. `notify_manager_lead_scheduled`

```json
{
  "name": "notify_manager_lead_scheduled",
  "description": "Envia notificação formal no WhatsApp do gerente da unidade física através da instância oficial de Atendimento, informando um novo lead agendado.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "loja": {
        "type": "string",
        "description": "Nome da loja ou slug (ex: 'Jorge Beretta', 'Kennedy', 'Jabaquara', 'Dom Pedro', 'Planalto', 'Mauá', 'Santo André', 'Rudge', 'Piraporinha', 'Rei do Módulo')."
      },
      "cliente_nome": {
        "type": "string",
        "description": "Nome completo ou primeiro nome do cliente agendado."
      },
      "cliente_telefone": {
        "type": "string",
        "description": "Telefone ou WhatsApp do cliente (com DDD)."
      },
      "data_agendamento": {
        "type": "string",
        "description": "Data agendada da visita (ex: '08/10/2026' ou 'Hoje')."
      },
      "horario_agendamento": {
        "type": "string",
        "description": "Horário agendado (ex: '10:00', '14:30')."
      },
      "veiculo": {
        "type": "string",
        "description": "Modelo do veículo, ano e placa se informados (ex: 'Honda Civic 2020')."
      },
      "servico_pretendido": {
        "type": "string",
        "description": "Serviço solicitado pelo cliente (ex: 'Troca de óleo de câmbio automático e filtro')."
      },
      "origem_lead": {
        "type": "string",
        "description": "Canal de conversão (ex: 'Google Ads', 'Instagram', 'Site', 'Central')."
      },
      "observacoes": {
        "type": "string",
        "description": "Observações relevantes relatadas pelo cliente ao bot."
      },
      "id_externo": {
        "type": "string",
        "description": "Identificador único do agendamento para garantia de envio único e idempotência."
      }
    },
    "required": ["loja", "cliente_nome", "cliente_telefone", "data_agendamento", "horario_agendamento"]
  }
}
```

### 4.2. `notify_manager_lead_cancelled`

```json
{
  "name": "notify_manager_lead_cancelled",
  "description": "Envia alerta formal no WhatsApp do gerente da unidade física através da instância de Atendimento, informando o cancelamento de um agendamento.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "loja": {
        "type": "string",
        "description": "Nome da loja ou slug onde o agendamento estava marcado."
      },
      "cliente_nome": {
        "type": "string",
        "description": "Nome do cliente que cancelou."
      },
      "cliente_telefone": {
        "type": "string",
        "description": "Telefone do cliente."
      },
      "data_agendamento": {
        "type": "string",
        "description": "Data que estava agendada."
      },
      "horario_agendamento": {
        "type": "string",
        "description": "Horário que estava agendado."
      },
      "veiculo": {
        "type": "string",
        "description": "Veículo associado ao agendamento, se houver."
      },
      "motivo_cancelamento": {
        "type": "string",
        "description": "Motivo da desistência informado pelo cliente."
      },
      "reagendamento_pretendido": {
        "type": "boolean",
        "description": "Verdadeiro se o cliente deseja reagendar futuramente."
      },
      "observacoes": {
        "type": "string",
        "description": "Detalhes complementares sobre o cancelamento."
      },
      "id_externo": {
        "type": "string",
        "description": "Identificador único do agendamento cancelado para idempotência."
      }
    },
    "required": ["loja", "cliente_nome", "cliente_telefone", "data_agendamento", "horario_agendamento"]
  }
}
```

---

## 5. Templates de Mensagem (Canal Central de Atendimento)

### 5.1. Template de Agendamento de Lead

```markdown
🚨 *NOVO LEAD AGENDADO — {NOME_LOJA}*

Olá, *{NOME_GERENTE}*! A Central de Atendimento confirmou um novo agendamento para a sua unidade:

• *Cliente:* {CLIENTE_NOME}
• *Telefone:* {CLIENTE_TELEFONE}
• *Data:* {DATA_AGENDAMENTO} às {HORARIO_AGENDAMENTO}
• *Veículo:* {VEICULO}
• *Serviço:* {SERVICO_PRETENDIDO}
• *Origem:* {ORIGEM_LEAD}

📝 *Observações:*
{OBSERVACOES}

_Central de Atendimento Mecânica Popular • Box reservado_
```

### 5.2. Template de Cancelamento de Agendamento

```markdown
⚠️ *CANCELAMENTO DE AGENDAMENTO — {NOME_LOJA}*

Atenção, *{NOME_GERENTE}*! Foi registrado o cancelamento de um agendamento na sua unidade:

• *Cliente:* {CLIENTE_NOME}
• *Telefone:* {CLIENTE_TELEFONE}
• *Data agendada:* {DATA_AGENDAMENTO} às {HORARIO_AGENDAMENTO}
• *Veículo:* {VEICULO}
• *Motivo:* {MOTIVO_CANCELAMENTO}
• *Pretende reagendar:* {REAGENDAMENTO_SIM_NAO}

📝 *Detalhes:*
{OBSERVACOES}

_Central de Atendimento Mecânica Popular • Vaga liberada no pátio_
```

---

## 6. Schema SQLite de Persistência e Auditoria

```sql
CREATE TABLE IF NOT EXISTS hydra_manager_notifications (
  id TEXT PRIMARY KEY,
  id_externo TEXT,
  tipo TEXT NOT NULL, -- 'LEAD_SCHEDULED' | 'LEAD_CANCELLED'
  loja_slug TEXT NOT NULL,
  gerente_phone TEXT NOT NULL,
  cliente_nome TEXT NOT NULL,
  cliente_phone TEXT NOT NULL,
  data_agendamento TEXT NOT NULL,
  horario_agendamento TEXT NOT NULL,
  instancia_emissora TEXT NOT NULL DEFAULT 'atendimento',
  payload_json TEXT NOT NULL,
  mensagem_texto TEXT NOT NULL,
  status TEXT NOT NULL, -- 'PENDING' | 'SENT' | 'FAILED' | 'DUPLICATE'
  evolution_message_id TEXT,
  status_http INTEGER,
  duracao_ms INTEGER,
  erro_detalhe TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mgr_notif_externo ON hydra_manager_notifications(id_externo, tipo);
CREATE INDEX IF NOT EXISTS idx_mgr_notif_loja ON hydra_manager_notifications(loja_slug, created_at);
```
