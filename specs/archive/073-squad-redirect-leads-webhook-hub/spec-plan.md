# Plano de Execução — Spec 073: Webhook Listener & Hub Analytics `/leads`

## Estratégia de Execução
- **Especialistas Ativados:**
  - `specialist-messaging-whatsapp`: Construção do repositório SQLite WAL (`leads_db.js`), ingestão polimórfica de JSON (formato direto e `sab.analytics`), extração de conjunto de anúncios / Google Tag e motor de batimento silencioso em 3 camadas (`leads_matcher.js`).
  - `[LEAD]`: Servidor HTTP (`web_server.js`), autenticação compartilhada com `/live` (`auth_guard.js`), interface Apple iOS Dark OLED Mobile-First (`public/index.html`), deploy no PM2/Traefik da VPS (`https://bot.tork.services/leads`) e validação E2E.
- Cada tarefa só é marcada como `[x]` com comando de validação determinístico registrado em `evidence/t<n>.md`.

---

## Tasks

- [x] [SPECIALIST:specialist-messaging-whatsapp] **T1 — Repositório SQLite WAL & Ingestor Polimórfico de Webhook JSON (`leads_db.js`)**
  - Criar `projects/hydra-rede/src/leads_system/leads_db.js` com inicialização automática do banco `leads_funnel.db` (`leads_sessions` e `leads_events`).
  - Implementar parser polimórfico que aceita tanto envelopes `sab.analytics` (`page_view`, `whatsapp_click` com `match_code`, `lead`, `form_submit`, `page_leave`) quanto payloads JSON diretos enviados pela página `https://mdhwevs80xtfv5np2u0b4mth.squadusercontent.com/`.
  - Extrair automaticamente da URL e do JSON todos os metadados de conjunto de anúncios (`utm_campaign`, `utm_content`, `utm_term`, `ad_group`) e Google Tag (`gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid`, `fbclid`).
  - Implementar `sweepExpiredSessions()` para classificar automaticamente como `PERDIDO` os visitantes sem redirect ou redirecionados que não enviaram mensagem após o tempo limite, além das agregações de KPIs (Entraram, Redirecionados, Mandaram Mensagem, Perdidos).
  - **Aceite:** `node --check projects/hydra-rede/src/leads_system/leads_db.js` retorna exit code 0 e persiste eventos de teste corretamente.

- [x] [SPECIALIST:specialist-messaging-whatsapp] **T2 — Motor Silencioso de Batimento de Mensagens em 3 Camadas (`leads_matcher.js`)**
  - Criar `projects/hydra-rede/src/leads_system/leads_matcher.js` conectando as mensagens recebidas no canal de atendimento (`5511996274141`) às sessões do funil.
  - Implementar Camada 1 (Match por `Código: XXXXXX` extraído do texto da mensagem), Camada 2 (Match por telefone normalizado E.164) e Camada 3 (Correlação temporal `<= 5 min` após o redirect para mensagens com a saudação padrão da página Squad).
  - Enriquecer automaticamente a ficha do lead com o nome do contato no WhatsApp, telefone real, texto da 1ª mensagem e timestamp de conversão (`funnel_status = 'MANDOU_MENSAGEM'`).
  - Implementar reconciliador ativo que consulta as conversas recentes da Central para garantir zero perda de eventos.
  - **Aceite:** `node --check projects/hydra-rede/src/leads_system/leads_matcher.js` retorna exit code 0 e vincula leads por código, telefone e janela temporal.

- [x] [LEAD] **T3 — Servidor HTTP `/leads`, Segurança PIN (`/live`) & CORS Aberto no Webhook (`web_server.js` & `auth_guard.js`)**
  - Criar `projects/hydra-rede/src/leads_system/auth_guard.js` replicando a mesma senha PIN Mestre do `/live` (`956076`), rate-limiter anti-força-bruta e validação do cookie HttpOnly `hydra_session` (`Path=/`).
  - Criar `projects/hydra-rede/src/leads_system/web_server.js` na porta `4550` expondo:
    - Rotas públicas com CORS completo (`OPTIONS 204` e `Access-Control-Allow-Origin`): `POST /leads/api/webhook`, `POST /leads/webhook` e `POST /leads/api/internal/message-hook`.
    - Rotas de autenticação: `GET /leads/api/auth/status`, `POST /leads/api/auth/unlock`, `POST /leads/api/auth/lock`.
    - Rotas protegidas por PIN: `GET /leads/api/dashboard`, `POST /leads/api/sync` e `GET /leads`.
  - **Aceite:** `node --check projects/hydra-rede/src/leads_system/web_server.js` retorna exit code 0; webhook aceita POST cross-origin e rotas do painel exigem PIN válido.

- [x] [LEAD] **T4 — Interface Mobile-First Padrão Apple `/live` (`public/index.html`)**
  - Criar `projects/hydra-rede/src/leads_system/public/index.html` seguindo rigorosamente o design system Apple iOS Dark OLED do `/live` (`#000000` background, cards `#111113`, bordas hairline `0.5px`, `frosted` glassmorphism, tipografia `Inter` + `JetBrains Mono` com `tabular-nums` e Keypad iOS de desbloqueio).
  - Renderizar os **4 Cards de Topo do Funil**: Entraram na Página, Redirecionados, Mandaram Mensagem e Perdidos (Não entrou em contato).
  - Construir as 3 abas Mobile-First:
    1. **Leads ao Vivo:** Lista individual com filtros rápidos (Todos, Mandou Mensagem, Perdidos, Redirecionados), busca, badges de status (`🟢 Mandou Mensagem`, `🔴 Perdido / Sem Contato`, `🟡 Redirecionado`), dados do conjunto de anúncios, Google Tag (`gclid`) e botão direto `Abrir no WhatsApp`.
    2. **Anúncios & Google Tag:** Breakdown de conversão por Conjunto de Anúncios / Campanha (`utm_content`, `utm_term`, `utm_campaign`) e painel diagnóstico da Tag Google (`gclid`, `gad_source`, origens).
    3. **Webhook & Snippet:** URL do webhook pronta para uso, snippet JS opcional para injeção na página de redirect e log ao vivo dos últimos JSONs recebidos.
  - **Aceite:** Interface renderiza em `/leads` com tela de PIN estilo iOS e atualiza métricas em tempo real.

- [x] [LEAD] **T5 — Suíte de Testes E2E, Deploy VPS (PM2 + Traefik) & Integração em Tempo Real**
  - Criar e executar `projects/hydra-rede/src/leads_system/test_leads_system.js` validando o ciclo completo (Page View -> Redirect -> Match por Código/Telefone -> Expiração de Perdidos -> Agregação por Conjunto de Anúncios e Google Tag).
  - Publicar na VPS (`operacional@100.126.50.101`), configurar `/opt/tork-stack/traefik/dynamic_leads.yml` (`Host('bot.tork.services') && PathPrefix('/leads')` -> porta `4550`), subir serviço PM2 `hydra-leads-hub` e conectar o hook assíncrono no `watchdog-gateway`.
  - **Aceite:** `node projects/hydra-rede/src/leads_system/test_leads_system.js` passa 100% e `https://bot.tork.services/leads` responde HTTP 200 em produção.
