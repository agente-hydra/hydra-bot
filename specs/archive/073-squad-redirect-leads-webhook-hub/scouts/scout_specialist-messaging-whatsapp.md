---
specialistId: specialist-messaging-whatsapp
specId: 073-squad-redirect-leads-webhook-hub
complexity: MEDIA
anchors: ["projects/hydra-rede/src/reconnect_system/web_server.js:17", "projects/hydra-rede/src/reconnect_system/web_server.js:718", "projects/hydra-rede/src/reconnect_system/config.js:10", "projects/hydra-rede/src/sla_system/triage_regex_shield.js:25"]
---
Diagnóstico Técnico — Webhook Listener de Leads & Hub `/leads` (Squad Redirect + Cruzamento de Atendimento):
1. Superfície de Redirecionamento Squad (`https://mdhwevs80xtfv5np2u0b4mth.squadusercontent.com/`):
   - A página executa countdown de 5s e redireciona para `https://wa.me/5511996274141` (Central de Atendimento), injetando via `sdk.js` (`sab.analytics`) o sufixo `Código: XXXXXX` (`match_code` de 6 caracteres) na mensagem inicial do WhatsApp e disparando eventos `page_view`, `whatsapp_click`, `lead` e `page_leave`.
   - O listener HTTP (`POST /leads/api/webhook` e `POST /leads/webhook`) deve aceitar tanto JSON direto de eventos/formulários quanto envelopes `sab.analytics`, com suporte completo a CORS (`OPTIONS` 204 e `Access-Control-Allow-Origin`) para requisições cross-origin vindas de `*.squadusercontent.com`.
2. Motor de Batimento Silencioso com o Canal de Atendimento (3 Camadas):
   - Camada 1 (Determinística por `match_code`): Extrai `Código:\s*([A-Z0-9]{4,10})` das mensagens recebidas no canal da Central (`5511996274141`, Inboxes 1 e 16), vinculando 1:1 a sessão web ao telefone real e nome do lead no WhatsApp.
   - Camada 2 (Determinística por Telefone E.164): Normaliza `phone`/`telefone` enviado pelo form/JSON e cruza contra o remetente das conversas ativas.
   - Camada 3 (Correlação Temporal + Reconciliação Ativa): Vincula redirecionamentos recentes sem código que enviaram a saudação padrão da LP em janela <= 5 min, marcando como `PERDIDO` os redirecionados ou visitantes sem contato após o timeout.
3. Arquitetura Web (`/leads`) e Segurança (`/live` Apple Design):
   - Segue a estrutura HTTP enxuta de `web_server.js:718` combinada com o guardião criptográfico `auth_guard.js` (PIN `956076`, cookie `hydra_session` HMAC SHA-256) e estética Apple iOS Dark OLED (`#000000`, `frosted`, `tabular-nums`, Mobile-First) do `/live`.
4. Rastreamento de Conjuntos de Anúncios e Google Tag:
   - Extração e indexação nativa em SQLite WAL de `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (conjunto/criativo), `utm_term`, `gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid` e `fbclid`.
