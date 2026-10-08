# Proposta: Reestruturação Visual e Formatação Nativa Hydra para Notificações de Gerentes

## 1. Contexto e Problema
O servidor MCP de Notificações de Gerentes (`hydra-manager-leads-mcp`) foi implementado com sucesso na porta 3333 e roteado via Cloudflare/Traefik em `https://bot.tork.services/mcp/sse`. No entanto, a formatação textual entregue nas mensagens de WhatsApp aos gerentes foi considerada visualmente poluída e artificial (uso excessivo de emojis gritantes como sirenes, repetição de asteriscos `• *Cliente:*`, quebras de linha duras e falta da elegância dos cards executivos nativos do Hydra).

## 2. Solução Proposta
Reutilizar o pipeline determinístico de formatação do Hydra (`src/hydra-sync/format_utils.ts` e `src/hydra-sync/balloon_composer.ts`) para os templates de notificação de leads agendados e cancelados:
1. **Padrão Card Executivo WhatsApp:** Título em caixa alta com separador visual discreto (`NOVO AGENDAMENTO • JORGE BERETTA`), seguido de data e horário em destaque.
2. **Hierarquia Limpa:** Pares chave-valor sem poluição de marcadores e sem asteriscos duplos vazados (`Cliente: Nome`, `WhatsApp: (11) 97777-8888`, `Veículo: Jeep Compass (BRA2E19)`).
3. **Máscara Automática de Dados:** Formatação determinística de telefones no padrão brasileiro `(XX) XXXXX-XXXX` e placas Mercosul/antigas.
4. **Política Zero Emojis Poluídos:** Eliminação de sirenes e emojis chamativos; uso estrito de marcadores tipográficos limpos.
5. **Trava de Teste Minimalista e Segura:** O cabeçalho de teste não grita, mantendo a clareza para homologação:
   `[TESTE] Alvo: Jorge Beretta / Gerente Jorge Beretta (5511998874158)`
   preservando o desvio estrito para `5511996242812`.
6. **Rodapé Oficial:** Assinatura temporal discreta no padrão Hydra (`_Central Mecânica Popular • DD/MM HH:mm_`).

## 3. Contratos e Retrocompatibilidade
- As 3 ferramentas MCP (`list_store_managers`, `notify_manager_lead_scheduled`, `notify_manager_lead_cancelled`) mantêm **100% de compatibilidade de parâmetros**, sem quebrar clientes externos.
- As respostas HTTP e JSON-RPC continuam estruturadas e auditadas em `hydra_ops.db`.

## 4. Risco Principal e Mitigação
- **Risco:** Envio acidental para números de gerentes reais durante a homologação.
- **Mitigação:** Trava `MCP_FORCE_RECIPIENT=5511996242812` mantida ativa em código e no ambiente do servidor.
