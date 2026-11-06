# Plano de Execução — Spec 076: Redesign UI/UX Mobile Nível Apple iOS, Identificação de LP de Origem, Matriz Serviços × Campanha e Limpeza de Base

## Tarefas

- [x] [LEAD] **T1 — Taxonomia de Serviços, Resolução de LP (`resolveLandingPageInfo`), Inferência de `desired_service` e Extração de Itens das OSs (`os_crossref.js` + `leads_db.js`)**
  - Adicionar migração idempotente `desired_service TEXT` em `leads_sessions` (`leads_db.js`) e `os_items_json TEXT`, `os_service_categories TEXT`, `os_observacao TEXT` em `leads_os_links` (`os_crossref.js`).
  - Implementar `resolveLandingPageInfo(lead)` em `leads_db.js` para identificar exatamente de qual Landing Page o lead veio (promovendo `referrer` como domínio da LP pública quando `page_url` for um container `*.squadusercontent.com`, ex: `mecanicapopular.com.br`).
  - Implementar `classifyServiceCategory(text)` e `inferDesiredService(leadPayload)` cobrindo as 9 categorias automotivas canônicas (*Câmbio Automático*, *Suspensão & Direção*, *Freios*, *Revisão & Óleo*, *Motor & Injeção*, *Alinhamento & Pneus*, *Embreagem*, *Ar Condicionado*, *Elétrica & Diagnóstico*).
  - Implementar `extractServicesFromRawPayload(rawPayload)` em `os_crossref.js` para extrair `itens` (`codigo`, `descricao`, `qtd`, `valor_unitario`, `valor_total`, `executor`, `categoria`) do `raw_payload` do `hydra_ops.db` (sempre read-only).
  - **Aceite:** `node -e "const c = require('./projects/hydra-rede/src/leads_system/os_crossref'); const db = require('./projects/hydra-rede/src/leads_system/leads_db'); const r = c.extractServicesFromRawPayload(JSON.stringify({itens:[{descricao:'TROCA DE OLEO DE CAMBIO AUTOMATICO',qtd:1,valor_total:448}]})); const lp = db.resolveLandingPageInfo({page_url:'https://mdh.squadusercontent.com/',referrer:'https://mecanicapopular.com.br/'}); if (!r.categories.includes('Câmbio Automático') || !lp.lpLabel.includes('mecanicapopular.com.br')) process.exit(1); console.log('T1_OK');"`

- [x] [LEAD] **T2 — APIs de Serviço (`PATCH`), Exclusão de Testes (`DELETE` / `clearDemoLeads`) e Agregações `byService` / `serviceCampaignMatrix` / `byLandingPage`**
  - Implementar `updateLeadDesiredService(visitId, desiredService)` e `deleteLeadSession(visitId)` em `leads_db.js`, expondo `PATCH /leads/api/lead/:visitId/service` e `DELETE /leads/api/lead/:visitId` protegidos por PIN em `web_server.js`.
  - Expandir `clearDemoLeads` (`seed_demo_leads.js` e `POST /leads/api/demo/clear`) para limpar registros `demo_%`, sessões de preview do Squad (`referrer LIKE '%app.squad.com%'`), prefixos `test_%`/`smoke_%`, além de suportar expurgo total de testes (`purge_all`).
  - Expandir `getAnalyticsData()` em `leads_db.js` para retornar `byService`, `serviceCampaignMatrix` e `byLandingPage`.
  - **Aceite:** `node -e "const db = require('./projects/hydra-rede/src/leads_system/leads_db'); if (typeof db.updateLeadDesiredService !== 'function' || typeof db.deleteLeadSession !== 'function') process.exit(1); console.log('T2_OK');"`

- [x] [LEAD] **T3 — Redesign Nível Apple iOS do Sheet de Detalhes do Lead (`#sheetCard`), Card de LP de Origem (`#sheetLpOrigin`) e Seletor de Serviço 1-Toque**
  - Refatorar `openLeadDetail` e `#sheetCard` em `projects/hydra-rede/src/leads_system/public/index.html` no padrão **Apple iOS 18 Contact Sheet**:
    - Hero Header com monograma circular, nome em destaque, badge da **Landing Page de Origem**, badges de Status + Serviço e **Quick Action Bar (`#sheetQuickActions`)** (*Ligar*, *WhatsApp*, *Copiar*, *OS*, *Excluir Teste*).
    - **Card de Landing Page & Origem (`#sheetLpOrigin`)** destacando exatamente de qual LP o lead veio (`mecanicapopular.com.br`), URL completa clicável com botão de copiar, Referrer externo e parâmetros de campanha.
    - **Seletor Interativo de Serviço Desejado (`#sheetServicePicker`)** com chips táteis de 1 toque (`PATCH /leads/api/lead/:visitId/service`).
    - **Timeline da Jornada (`#sheetTimeline`)**, **Cards de OS Estilo Apple Wallet** listando cada item/serviço executado (`itens`) e `<details id="sheetTechDisclosure">` colapsado por padrão para os JSONs técnicos.
  - **Aceite:** `node -e "const fs = require('fs'); const h = fs.readFileSync('./projects/hydra-rede/src/leads_system/public/index.html','utf8'); for (const id of ['sheetQuickActions','sheetLpOrigin','sheetServicePicker','sheetTimeline','sheetTechDisclosure']) { if (!h.includes(id)) { console.error('Missing', id); process.exit(1); } } console.log('T3_OK');"`

- [x] [LEAD] **T4 — Apresentação Mobile-First na Lista de Leads (LP + Serviço) e Matriz "Serviços × Campanha" na Aba Análise**
  - Atualizar a tabela/lista de leads (`#leadsTableBody`) em `public/index.html` para exibir a **Landing Page de Origem** (`lpLabel`) e o badge de **Serviço** (`desired_service` ou serviço executado na OS) com layout mobile responsivo.
  - Adicionar na aba **Análise (`#tabAnalytics`)** a seção **"Serviços Executados × Campanha"** (`#analyticsServicesTable` e `#analyticsServiceCampaignTable`) com barras de proporção de receita, ticket médio por tipo de serviço e campanha líder.
  - **Aceite:** `node -e "const fs = require('fs'); const h = fs.readFileSync('./projects/hydra-rede/src/leads_system/public/index.html','utf8'); for (const id of ['analyticsServicesTable','analyticsServiceCampaignTable']) { if (!h.includes(id)) { console.error('Missing', id); process.exit(1); } } console.log('T4_OK');"`

- [x] [LEAD] **T5 — Suíte E2E Expandida (`test_leads_system.js`), Deploy na VPS e Limpeza da Base de Produção**
  - Adicionar testes automatizados em `test_leads_system.js` validando `resolveLandingPageInfo`, edição de `desired_service`, exclusão de lead/teste (`DELETE`), extração de itens da OS, matriz `byService`/`serviceCampaignMatrix` e elementos UI do Sheet Apple (`#sheetLpOrigin`, `#sheetServicePicker`).
  - Fazer deploy para a VPS (`100.126.50.101`), rodar a suíte E2E, **executar a limpeza dos registros de teste/demo no banco de produção `/home/operacional/hydra-data/leads_funnel.db`**, reiniciar `hydra-leads-hub` no PM2 e verificar a base limpa em `https://bot.tork.services/leads`.
  - **Aceite:** `node projects/hydra-rede/src/leads_system/test_leads_system.js`
