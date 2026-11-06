# Documento de Design — Spec 076: Redesign UI/UX Mobile Nível Apple iOS, Identificação de LP de Origem, Matriz Serviços × Campanha e Limpeza de Base

## 1. Arquitetura e Fluxo de Dados

```mermaid
flowchart LR
  subgraph Ingestão & Lead DB
    WH["Webhook / WhatsApp Sync"] --> INF["inferDesiredService() + resolveLandingPageInfo()"]
    INF --> LS["leads_sessions (desired_service, page_url, referrer)"]
    UI_PATCH["PATCH /leads/api/lead/:visitId/service"] --> LS
    UI_DEL["DELETE /leads/api/lead/:visitId & POST /demo/clear"] --> LS
  end

  subgraph Cruzamento Read-Only (Oficina Inteligente)
    OPS["hydra_ops.db (ordens_servico.raw_payload)"] --> EXT["extractServicesFromRawPayload()"]
    EXT --> LNK["leads_os_links (os_items_json, os_service_categories)"]
  end

  subgraph API & Front-End Apple iOS 18
    LS & LNK --> AN["GET /leads/api/analytics (byService, serviceCampaignMatrix, byLandingPage)"]
    LS & LNK --> OS_API["GET /leads/api/lead/:id/os (itens + categorias)"]
    AN --> TAB_AN["Aba Análise: Serviços Feitos x Campanha & LPs"]
    OS_API --> SHEET["Apple Contact Sheet: LP de Origem, Chips de Serviço, OS Wallet & Excluir Teste"]
  end
```

---

## 2. Contratos de Dados e Schema SQLite

### 2.1. Migração Idempotente em `leads_sessions` (`leads_db.js`)
Adição da coluna `desired_service`:
```sql
ALTER TABLE leads_sessions ADD COLUMN desired_service TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_desired_service ON leads_sessions(desired_service);
```

### 2.2. Resolução Determinística da Landing Page de Origem (`resolveLandingPageInfo`)
Quando uma Landing Page é servida via container Squad (`https://<id>.squadusercontent.com/`), a URL pública da LP onde o visitante está navegando chega em `referrer` (ex: `https://mecanicapopular.com.br/`), enquanto `page_url` armazena o host do container (`*.squadusercontent.com`).
A função `resolveLandingPageInfo(lead)` retorna:
```js
{
  lpLabel: 'mecanicapopular.com.br',          // Domínio + path limpo da LP pública
  lpFullUrl: 'https://mecanicapopular.com.br/', // URL clicável da LP
  containerUrl: 'https://mdhwevs80xtfv5np2u0b4mth.squadusercontent.com/', // se aplicável
  externalReferrer: 'https://www.google.com/', // Referrer externo (Google, Instagram, etc.)
  isSquadPreview: false                        // true se referrer for app.squad.com
}
```
Regras de prioridade:
1. Se `raw_payload_json` contiver `lp_url` / `parent_url` / `landing_page`, usa-o como `lpFullUrl`.
2. Se `page_url` contiver `squadusercontent.com` e `referrer` não for buscador/rede social (`google.`, `bing.`, `yahoo.`, `instagram.`, `facebook.`, `fb.`, `t.co`, `tiktok.`) nem `app.squad.com`, então `referrer` é a **Landing Page Pública** (`lpFullUrl = referrer`) e `page_url` é o `containerUrl`.
3. Se `referrer` for `app.squad.com`, rotula `lpLabel = 'Preview Squad Studio (Teste)'` (`isSquadPreview = true`).
4. Caso contrário, `page_url` é a própria `lpFullUrl` (extraindo `hostname + pathname` sem query string gigante de GCLID para o `lpLabel`) e `referrer` é o `externalReferrer`.

### 2.3. Taxonomia Canônica de Serviços Automotivos
Categorias padronizadas para classificação automática (tanto do interesse do lead quanto dos itens executados na OS):
1. `Câmbio Automático` — regex: `/c[aâ]mbio|atf|dexron|transmiss[aã]o\s*autom|dual\s*logic|cvt|dsg|al4|tf72|mecatr[oô]nica/i`
2. `Suspensão & Direção` — regex: `/suspens[aã]o|amortecedor|bandeja|bieleta|bucha|coxim|piv[oô]|terminal|dire[cç][aã]o|homocin[eé]tica|coifa|mola|rolamento\s*de\s*roda/i`
3. `Freios` — regex: `/freio|pastilha|disco\s*de\s*freio|fluido\s*de\s*freio|pin[cç]a|tambor|abs|cilindro\s*mestre/i`
4. `Revisão & Óleo` — regex: `/troca\s*de\s*[oó]leo|elaion|5w30|5w40|10w40|0w20|filtro\s*de\s*[oó]leo|filtro\s*de\s*ar|filtro\s*de\s*comb|revis[aã]o/i`
5. `Motor & Injeção` — regex: `/motor|cabe[cç]ote|correia\s*dentada|tensor|vela|bobina|bico\s*injetor|inje[cç][aã]o|tbi|bomba\s*d['\s]*[aá]gua|arrefecimento|radiador|v[aá]lvula\s*termost|junta|c[aá]rter/i`
6. `Alinhamento & Pneus` — regex: `/alinhamento|balanceamento|cambagem|pneu|geometria|rod[ií]zio/i`
7. `Embreagem` — regex: `/embreagem|plat[oô]|atuador\s*hidr|volante\s*bimassa/i`
8. `Ar Condicionado` — regex: `/ar\s*condicionado|higieniza[cç][aã]o|oxi[\s\-]*sanitiza|compressor\s*de\s*ar|g[aá]s\s*refrigerante|filtro\s*de\s*cabine/i`
9. `Elétrica & Diagnóstico` — regex: `/bateria|alternador|partida|scanner|diagn[oó]stico|el[eé]tric|chicote|sensor|m[oó]dulo/i`

### 2.4. Migração Idempotente em `leads_os_links` (`os_crossref.js`)
```sql
ALTER TABLE leads_os_links ADD COLUMN os_items_json TEXT;
ALTER TABLE leads_os_links ADD COLUMN os_service_categories TEXT;
ALTER TABLE leads_os_links ADD COLUMN os_observacao TEXT;
```

---

## 3. Contratos de API (`web_server.js`)

### 3.1. `PATCH /leads/api/lead/:visitId/service` (Protegido por PIN)
Atualiza o `desired_service` de um lead específico:
- **Request Body:** `{ "desired_service": "Câmbio Automático" }`
- **Response (`200 OK`):** `{ "ok": true, "visit_id": "...", "desired_service": "Câmbio Automático" }`

### 3.2. `DELETE /leads/api/lead/:visitId` (Protegido por PIN)
Remove cirurgicamente um lead específico (útil para apagar um clique de teste feito pelo próprio gestor) em `leads_sessions`, `leads_events` e `leads_os_links`:
- **Response (`200 OK`):** `{ "ok": true, "deleted_visit_id": "..." }`

### 3.3. Expansão de `POST /leads/api/demo/clear` (Limpeza de Testes e Demos)
Além de remover `visit_id LIKE 'demo_%'`, limpa também sessões de teste (`visit_id LIKE 'test_%'`, `visit_id LIKE 'smoke_%`, `referrer LIKE '%app.squad.com%'`, ou `mode === 'purge_all'` quando solicitado para zerar a base de testes), limpando em cascata `leads_events` e `leads_os_links` e invalidando o cache do crossref.

### 3.4. Expansão de `GET /leads/api/analytics`
Adiciona ao payload JSON retornado por `getAnalyticsData()`:
- `byService`: Ranking por categoria de serviço (leads, OSs, faturamento, ticket médio, campanha líder, taxa de conversão).
- `serviceCampaignMatrix`: Cruzamento detalhado `(service, campaign)` com faturamento, OSs e amostra dos serviços feitos (`itemsSample`).
- `byLandingPage`: Desempenho agrupado por Landing Page de Origem (`lpLabel`, leads, mensagens, OSs, receita atribuída).

---

## 4. Arquitetura UI/UX Nível Apple iOS 18 (`public/index.html`)

1. **Apple Contact Sheet (`#leadDetailModal` / `#sheetCard`):**
   - **Header estilo iOS Contact Card:**
     - Monograma circular (`w-14 h-14 rounded-full`) com anel semântico conforme `funnel_status`.
     - Nome principal (`text-lg font-semibold tracking-tight text-white`), badge da **Landing Page de Origem** (`mecanicapopular.com.br`) logo abaixo do nome, e código de vínculo.
     - **Quick Action Bar (`#sheetQuickActions`):** Botões circulares iOS (*Ligar*, *WhatsApp*, *Copiar*, *OS*, *Excluir Lead*).
   - **Card Destacado de Landing Page & Origem (`#sheetLpOrigin`):**
     - Exibe em destaque o domínio da **Landing Page (`lpLabel`)**, link clicável para abrir a URL exata da LP, URL completa com botão de copiar, Referrer externo e Campanha/Conjunto/Termo.
   - **Seção "Serviço Procurado pelo Lead" (`#sheetServicePicker`):**
     - Chips clicáveis com as 9 especialidades + opção personalizada em 1 toque, salvando via `PATCH /leads/api/lead/:visitId/service`.
   - **Jornada Temporal (`#sheetTimeline`):**
     - Stepper iOS exibindo os marcos com data/hora (`Entrou na LP`, `Redirecionou p/ WhatsApp`, `Mandou Mensagem`, `OS Vinculada`).
   - **Seção Ordens de Serviço (`#sheetOsSection`):**
     - Card estilo Apple Wallet com Loja + OS #, Placa Mercosul, Valor Total em `text-iosGreen`, e **lista detalhada de cada item/serviço executado (`itens`)**.
   - **Disclosure Técnico (`#sheetTechDisclosure`):**
     - `<details>` recolhido por padrão para `Google Tag` e `Payload JSON Original`.

2. **Lista de Leads & Aba Análise Mobile-First:**
   - Na tabela principal (`#leadsTableBody`): exibição da **Landing Page (`lpLabel`)** e do badge de **Serviço** (`desired_service` ou categoria da OS), com layout mobile responsivo de leitura imediata.
   - Na aba **Análise (`#tabAnalytics`)**: nova seção **Serviços Executados × Campanha** (`#analyticsServicesTable` e `#analyticsServiceCampaignTable`) com barras de proporção visual.

---

## 5. Mapeamento de Arquivos Afetados

| Arquivo | Tipo de Mudança |
|---|---|
| `projects/hydra-rede/src/leads_system/os_crossref.js` | Extração de `itens` e `observacao` do `raw_payload`, classificador de categorias de serviço e persistência em `leads_os_links`. |
| `projects/hydra-rede/src/leads_system/leads_db.js` | Coluna `desired_service`, `resolveLandingPageInfo()`, `inferDesiredService()`, `updateLeadDesiredService()`, `deleteLeadSession()`, limpeza expandida de testes e agregações `byService` / `serviceCampaignMatrix` / `byLandingPage`. |
| `projects/hydra-rede/src/leads_system/web_server.js` | Rotas `PATCH /leads/api/lead/:visitId/service` e `DELETE /leads/api/lead/:visitId` protegidas por PIN. |
| `projects/hydra-rede/src/leads_system/seed_demo_leads.js` | População de `desired_service`, `page_url` realista de LPs e `os_items_json` / `os_service_categories` nos seeds demo, além de limpeza expandida de testes. |
| `projects/hydra-rede/src/leads_system/public/index.html` | Redesign nível Apple iOS do Sheet de detalhes com Card de LP de Origem (`#sheetLpOrigin`), seletor de serviço 1-toque, botão de excluir lead/teste, lista de itens da OS e seção "Serviços × Campanha" na aba Análise. |
| `projects/hydra-rede/src/leads_system/test_leads_system.js` | Novos testes E2E cobrindo `resolveLandingPageInfo`, `desired_service`, exclusão de testes, extração de itens da OS e matriz `byService`/`serviceCampaignMatrix`. |
