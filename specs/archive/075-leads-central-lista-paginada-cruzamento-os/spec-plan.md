# Plano de Execução — Spec 075: Central de Leads (Lista Paginada, Datas, Lista/Grade, Cruzamento OS & Análise)

## Estratégia de Execução
- **Modo:** `solo` (`[LEAD]`, `match_roster.mjs` k = 0, roster-gap registrado).
- Cada task só vira `[x]` após comando determinístico de aceite + evidência em `evidence/t<n>.md`.
- Sem commit durante apply; deploy VPS na T6.

---

## Tasks

- [x] [LEAD] **T1 — Backend: filtros por intervalo de datas, paginação servidor-side e filtros de campanha (`leads_db.js`, `web_server.js`)**
  - Params `from`,`to`,`campaign`,`adGroup`,`page`,`pageSize` ∈ {10,20,50,100} (default 10, inválido → 10); `period` legado como alias; retorno `pagination`; KPIs sobre o conjunto filtrado completo.
  - **Aceite:** `node --check` nos dois arquivos + script Node que semeia 35 leads em DB temporário e afirma: `pageSize=10` retorna 10 e `total=35`, `page=4` retorna 5, `pageSize=20/50/100` respeitados, `from/to` inclusivos filtram corretamente.

- [x] [LEAD] **T2 — Motor de cruzamento Lead ↔ OS read-only (`os_crossref.js` + tabela `leads_os_links`)**
  - Extrair telefones de `raw_payload`, normalizar E.164, camadas PHONE_E164 / NAME_PLATE / NAME_FUZZY, janela de 90 dias, TTL de índice, abertura `readOnly`, exclusão de `demo_%`.
  - **Aceite:** teste com `hydra_ops` fixture temporário (OS com telefone só no `raw_payload`): vínculo telefone = `CONFIRMADO`, nome fuzzy = `PROVAVEL`, OS anterior à entrada não vincula, e tentativa de escrita na conexão readOnly lança erro.

- [x] [LEAD] **T3 — API de Análise e detalhe de OS (`getAnalyticsData`, `/leads/api/analytics`, `/leads/api/lead/:id/os`, `/leads/api/crossref/rebuild`)**
  - Totais e rankings por campanha/conjunto/gclid/origem: leads, conversas, OS, faturamento atribuído (`CONFIRMADO` por padrão; `includeProbable=1` opcional), ticket, conversão; respeitam todos os filtros.
  - **Aceite:** teste E2E afirma valores exatos de receita/ticket/conversão sobre dataset fixture e que rotas sem PIN retornam 401.

- [x] [LEAD] **T4 — UI: tabela de leads com linha clicável, paginação, toggle Lista/Grade e filtro De/Até (`public/index.html`)**
  - Colunas Nome·Telefone·Entrada·Status; `<tr>` inteira clicável/teclável abre o sheet; seletor 10/20/50/100; "x–y de N"; toggle persistido; presets preenchem intervalo; estado em URL; zero emojis.
  - **Aceite:** script Node parseia scripts inline (`new Function`) e assere presença de `renderLeadsTable`, `pageSize`, `viewMode`, `input type="date"`, `tr` com `data-visit-id`, e ausência de emojis slop.

- [x] [LEAD] **T5 — UI: aba Análise (KPIs + rankings filtráveis), seção OS no detalhe e swipe para 4 abas**
  - Rankings ordenáveis com barras proporcionais; toggle "incluir prováveis"; `springToTab`/`navLiquidPill` generalizados para N abas; demos com OS fictícias.
  - **Aceite:** parse JS inline OK; HTML contém `renderAnalytics`, `rankingTable`, seção `sheetOsSection`; suíte E2E demo confirma Análise com dados semeados.

- [x] [LEAD] **T6 — Suíte E2E, deploy VPS e verificação em produção**
  - Estender `test_leads_system.js` (paginação, datas, cruzamento, análise, readOnly, regressão 073/074); `scp` para `/home/operacional/hydra-rede/src/leads_system/`; configurar `OPS_DB_PATH`/default `/home/operacional/hydra-data/hydra_ops.db`; `pm2 restart hydra-leads-hub`; rebuild do cruzamento; checar `https://bot.tork.services/leads` HTTP 200.
  - **Aceite:** `node projects/hydra-rede/src/leads_system/test_leads_system.js` exit 0 (local e VPS) + `curl` autenticado em `/leads/api/analytics` retornando JSON válido em produção.
