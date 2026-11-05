# Spec 073 — Webhook Listener de Leads (Squad Redirect) & Hub Analytics `/leads`

## 1. Problema Detalhado
A operação está implantando uma página de redirecionamento e captura (`https://mdhwevs80xtfv5np2u0b4mth.squadusercontent.com/`) voltada ao atendimento no WhatsApp com IA (`5511996274141`). Atualmente existem três lacunas operacionais críticas:
1. **Ausência de Receptor de Eventos/Leads:** Não há um endpoint webhook dedicado na infraestrutura (`bot.tork.services`) para receber em JSON os eventos da página de redirect (`page_view`, `whatsapp_redirect` / clique no CTA, submissão de formulário, códigos de match `Código: XXXXXX`, parâmetros de conjunto de anúncios e tags do Google).
2. **Ponto Cego entre Clique e Mensagem Real:** Quando o visitante entra na página de redirect ou clica em "Abrir WhatsApp agora", não há visibilidade consolidada de quantos efetivamente enviaram mensagem no WhatsApp versus quantos desistiram no meio do caminho (**Perdidos**).
3. **Visibilidade de Mídia (Conjunto de Anúncios e Google Tag):** Os gestores precisam acompanhar em tempo real (em interface Mobile-First com o mesmo padrão Apple OLED e mesma senha PIN do `/live`) o funil completo (**Entraram na Página → Redirecionados → Mandaram Mensagem → Perdidos**), inspecionar cada lead individualmente e auditar a performance por **Conjunto de Anúncios** e **Dados da Google Tag** (`gclid`, `gad_source`, `utm_campaign`, `utm_content`, `utm_term`).

---

## 2. Solução Proposta

### Pilar 1: Webhook Listener Universal de Leads (`POST /leads/api/webhook` & `POST /leads/webhook`)
- Endpoint HTTP público de baixa latência (<10ms) com suporte completo a CORS (`Access-Control-Allow-Origin`, `OPTIONS 204`) para receber chamadas diretas do browser ou backend a partir de `https://mdhwevs80xtfv5np2u0b4mth.squadusercontent.com/` (via `fetch`, `navigator.sendBeacon` ou webhook).
- **Polimorfismo de Payload JSON:**
  1. **Envelope Nativo `sab.analytics` (`/_s/sdk.js`):** Processa lotes `events[]` (`page_view`, `whatsapp_click` com `match_code`, `lead`, `form_submit`, `page_leave`), extraindo URL, referrer, `visitId` e parâmetros de mídia.
  2. **JSON Direto de Formulário / Redirect:** Aceita objetos planos ou aninhados com `{ event, visit_id, match_code, name/nome, phone/telefone, vehicle/veiculo, store/loja, utm_*, gclid, gad_source, gad_campaignid, adset/conjunto }`.
- Persistência em banco SQLite WAL dedicado (`/home/operacional/hydra-data/leads_funnel.db`) com tabelas `leads_sessions` e `leads_events`.

### Pilar 2: Motor Silencioso de Batimento de Mensagens (3 Camadas)
- Verifica automaticamente se o lead que passou pela página de redirect efetivamente entrou em contato no WhatsApp (cruzando nos bastidores com o barramento de mensagens recebidas na Central `5511996274141`, sem expor nomenclatura interna na interface):
  1. **Match Exato por Código (`match_code`):** Captura o padrão `Código: XXXXXX` presente na primeira mensagem enviada pelo lead no WhatsApp e vincula instantaneamente à sessão web que gerou aquele código, enriquecendo o registro do lead com o **Telefone Real** e **Nome do Perfil WhatsApp**.
  2. **Match por Telefone Normalizado (`E.164`):** Quando o lead informa o telefone antes do redirect, cruza os dígitos canônicos contra novas mensagens recebidas.
  3. **Correlação Temporal de Saudação + Reconciliador Ativo:** Quando o lead apaga o código mas envia a frase padrão da LP (`"Olá! Estou com um problema no carro e quero agendar um diagnóstico."`) dentro da janela de 5 minutos após o redirect, vincula à sessão redirecionada correspondente e marca como **Mandou Mensagem**.
- **Classificação Automática de Perdidos (`PERDIDO`):**
  - Visitantes que saíram sem redirecionar (`page_leave` ou inativos > 2 min sem redirect) e visitantes redirecionados que não enviaram mensagem no WhatsApp após a janela de tolerância são marcados como **Perdidos (Não entrou em contato)**.

### Pilar 3: Dashboard Executivo `https://bot.tork.services/leads` (Padrão Apple `/live` + Segurança PIN)
- **Segurança Idêntica ao `/live`:** Protegido pelo mesmo PIN Mestre (`956076`), tela de bloqueio estilo iOS Keypad, proteção contra brute-force e compartilhamento do cookie HttpOnly `hydra_session` (`Path=/`).
- **4 Cards de Topo do Funil (Tabular Nums):**
  1. **Entraram na Página:** Total de visitantes únicos no período.
  2. **Redirecionados:** Total encaminhado ao WhatsApp (+ taxa de clique/redirect `%`).
  3. **Mandaram Mensagem:** Total confirmado que enviou mensagem no WhatsApp (+ taxa de conversão real `%`).
  4. **Perdidos (Sem Contato):** Total que abandonou na página ou abriu o WhatsApp mas não enviou mensagem (+ taxa de perda `%`).
- **3 Visões Mobile-First (iOS Segmented Control / Bottom Bar):**
  - **Leads (Lista Individual):** Cards por lead exibindo status (`🟢 Mandou Mensagem`, `🔴 Perdido / Sem Contato`, `🟡 Redirecionado`, `⚪ Na Página`), Nome, Telefone (com botão rápido `wa.me`), horário, tempo até mandar mensagem, `match_code`, Conjunto de Anúncios e tags Google.
  - **Anúncios & Google Tag:** Tabela/cards agrupados por **Conjunto de Anúncios / Campanha** (`utm_content`, `utm_term`, `utm_campaign`, `gad_campaignid`) mostrando funil completo por conjunto, além de painel de saúde da **Google Tag** (`gclid`, `gbraid`, `wbraid`, `gad_source`, distribuição de origens).
  - **Integração / Webhook:** Endpoint pronto para cópia, snippet JS leve de 1 linha para injetar na página de redirect (caso deseje complementar o envio JSON) e inspetor ao vivo dos últimos payloads JSON recebidos.

---

## 3. Especialistas Envolvidos
- `specialist-messaging-whatsapp`: Implementação do motor de ingestão webhook JSON, normalização de parâmetros Google Tag/UTMs, persistência SQLite WAL e reconciliação silenciosa em 3 camadas com o fluxo de mensagens recebidas.
- `[LEAD]`: Construção da interface Apple iOS Dark OLED Mobile-First (`/leads`), integração com `auth_guard.js` do `/live`, roteamento reverso no Traefik (`dynamic_leads.yml`) e bateria de validação E2E.

---

## 4. Riscos e Mitigação
| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| **Bloqueio de CORS no Browser da Página Squad** | O navegador em `*.squadusercontent.com` bloquear o `POST` para `bot.tork.services/leads/api/webhook` | Responder `OPTIONS` com `204 No Content`, refletir `Origin` em `Access-Control-Allow-Origin`, aceitar `text/plain` (`sendBeacon`) e `application/json`. |
| **Visitante redirecionado sem preencher telefone no form** | O evento de redirect na web não traz o número de WhatsApp antes da mensagem | O `match_code` (`Código: XXXXXX`) e o reconciliador temporal enriquecem automaticamente o card do lead com o telefone e nome assim que a mensagem chega no WhatsApp. |
| **Exposição das rotas de leitura sem autenticação** | Dados de leads ficarem abertos publicamente | Apenas `POST /leads/api/webhook`, `POST /leads/webhook` e `POST /leads/api/auth/unlock` são públicos; todas as rotas de listagem e métricas exigem sessão válida (`hydra_session`). |
