<!-- sdd:managed:begin id="specialist" -->
# Especialista: Especialista em Mensageria WhatsApp & Ingress
**ID:** `specialist-messaging-whatsapp` | **Versão:** 1
**Papel:** Gateways Evolution API, Atendimento Conversacional e Webhook Ingress

## Escopo e Padrões de Arquivo
- `src/hydra-sync/*whatsapp*`
- `src/hydra-sync/*conversation*`
- `src/hydra-sync/*webhook*`
- `src/hydra-sync/*balloon*`
- `src/hydra-sync/*queue*`
- `src/hydra-sync/*inbound*`
- `src/hydra-sync/*presence*`
- `src/hydra-sync/*evo*`
- `src/hydra-sync/*chatwoot*`
- `src/hydra-sync/*message*`
- `src/hydra-sync/*media*`
- `src/hydra-sync/*multimodal*`
- `src/hydra-sync/*os_*`
- `webhook-listener.js`

## Palavras-Chave de Domínio
`whatsapp, evolution, chatwoot, webhook, conversation, ingress, balloon, queue`

## Regras de Ouro
- **Barreira antecipada no Ingress: rejeição silenciosa de remetentes não autorizados** (origem: memory)

## Padrões Proibidos
- ⛔ PROIBIÇÃO ABSOLUTA: Nunca enviar mensagens usando instâncias de gerentes de loja como remetente

**Caminho de Memória:** `.agent/memory/specialists/specialist-messaging-whatsapp.md`
<!-- sdd:managed:end id="specialist" -->
