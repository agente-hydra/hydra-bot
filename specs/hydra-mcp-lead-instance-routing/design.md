# Design Técnico: hydra-mcp-lead-instance-routing

## 1. Arquitetura de Roteamento de Instâncias Evolution

```
[Chatbot Externo / MCP Client]
            │
            ▼
    POST /mcp/messages (notify_manager_lead_scheduled)
            │
            ▼
    [mcp_lead_tools.ts]
            │
            ├──► Consulta EVOLUTION_LEAD_INSTANCE (.env)
            │      ↳ Exemplo: 'hydra' ou 'atendimento'
            │
            ▼
    [WhatsAppClient({ instance: leadInstance })]
            │
            ▼
    POST https://evo.tork.services/message/sendText/{leadInstance}
            │
            ▼
    Gerente da Loja Física (ou 11996242812 no modo de teste)
```

## 2. Mudanças nos Arquivos

### A. `src/hydra-sync/mcp_lead_tools.ts`
Substituir o hardcode `'atendimento'` por uma função auxiliar que respeita o ambiente:
```typescript
export function getLeadNotificationInstance(): string {
  return (process.env.EVOLUTION_LEAD_INSTANCE || 'atendimento').trim();
}
```
Nas chamadas de envio:
```typescript
const leadInstance = getLeadNotificationInstance();
const client = new WhatsAppClient({ instance: leadInstance });
```
E no registro de auditoria no SQLite:
```typescript
instancia_emissora: leadInstance,
```

### B. `src/hydra-sync/whatsapp_client.ts`
1. Trava Programática de Segurança:
```typescript
export const ALLOWED_SENDER_INSTANCES: ReadonlySet<string> = new Set(['hydra', 'atendimento']);

export function assertAllowedSenderInstance(instance: string): void {
  const normalized = (instance || '').trim().toLowerCase();
  if (!ALLOWED_SENDER_INSTANCES.has(normalized)) {
    throw new Error(
      `[SECURITY FATAL] TENTATIVA DE DISPARO BLOQUEADA: Instância "${instance}" não autorizada! ` +
      `É terminantemente proibido disparar mensagens a partir de instâncias de gerentes ou instâncias não autorizadas.`
    );
  }
}
```
2. Garantir que a instância configurada seja validada no construtor e antes de cada chamada `sendText` e `sendPresence`:
```typescript
this.instance = config?.instance || process.env.EVOLUTION_INSTANCE || 'hydra';
assertAllowedSenderInstance(this.instance);
```

### C. Configuração no `.env`
Definir claramente no `/home/operacional/hydra/.env`:
```env
# Instância do Bot Operacional Interno
EVOLUTION_INSTANCE=hydra

# Instância Emissora das Notificações para Gerentes via MCP
EVOLUTION_LEAD_INSTANCE=hydra  # ou atendimento, conforme decisão do usuário
```

