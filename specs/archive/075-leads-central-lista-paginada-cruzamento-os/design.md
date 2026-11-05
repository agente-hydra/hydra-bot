# Design — Spec 075

## 1. Fluxo de Dados
```
Browser (/leads) ──GET /leads/api/dashboard?from&to&status&q&campaign&page&pageSize──► getDashboardData()
                                                                     │
        leads_funnel.db (rw)  ◄── leads_sessions, leads_events        │
              ▲  leads_os_links (novo)                               ▼
              │                                              os_crossref.js (novo)
              └────────── upsert vínculos ◄── índice telefones ◄── hydra_ops.db (readOnly)
                                                                  ordens_servico.raw_payload
Browser ──GET /leads/api/analytics?from&to&...──► getAnalyticsData() (KPIs + rankings)
```

## 2. Contratos (baseados no código real)
**Existente** (`leads_db.js:622`): `getDashboardData(filters = {}, options = {})`, filtros atuais `period|status|q|limit`; retorna `{ kpis, demoCount, adGroups, googleTagSummary, leads, recentEvents }`. `web_server.js:307-320` repassa `period,status,q,limit`.

**Novo/Alterado:**
- Filtros: `from`, `to` (`YYYY-MM-DD`, inclusivo, dia local America/Sao_Paulo → ISO UTC), `campaign`, `adGroup`, `page` (>=1), `pageSize` ∈ {10,20,50,100} (default 10; valor inválido → 10). `period` legado mantido como alias (preenche from/to).
- `getDashboardData` passa a retornar `pagination: { page, pageSize, total, totalPages }` e `leads` já paginado e ordenado por `entered_at DESC`; `kpis` calculados sobre o conjunto filtrado completo (não só a página).
- Cada lead retorna `os_summary: { count, total_os, confidence }` (join leve).
- `GET /leads/api/lead/:visit_id/os` → lista de OS vinculadas.
- `GET /leads/api/analytics` → `{ totals, rankings: { campaign[], adGroup[], gclid[], source[] }, series? }` com `{ key, leads, messaged, os_count, revenue, ticket, conv_rate }`.
- `POST /leads/api/crossref/rebuild` → reconstrói índice e vínculos (também automático com TTL).

**Tabela nova (`leads_funnel.db`):**
```sql
CREATE TABLE IF NOT EXISTS leads_os_links (
  visit_id TEXT NOT NULL, os_id TEXT NOT NULL, loja_slug TEXT NOT NULL,
  match_method TEXT NOT NULL,        -- PHONE_E164 | NAME_PLATE | NAME_FUZZY
  confidence REAL NOT NULL,          -- 1.0 telefone; <1 nome
  status TEXT NOT NULL DEFAULT 'CONFIRMADO', -- CONFIRMADO | PROVAVEL
  total_os REAL, valor_pago REAL, os_data_inicio_iso TEXT, created_at TEXT,
  PRIMARY KEY (visit_id, os_id, loja_slug));
```

## 3. Cruzamento (`os_crossref.js`)
1. Abrir `hydra_ops.db` com `new DatabaseSync(path, { readOnly: true })` (mesmo adapter node:sqlite/better-sqlite3 de `leads_db.js`).
2. Para cada OS: extrair `cliente_telefone`, `cliente_telefones[]`, `cliente_telefone_sms` de `raw_payload` → `normalizePhoneE164` → mapa `phone → [OS]`; mapa auxiliar por nome normalizado (sem acento, minúsculo) e placa.
3. Vincular lead→OS: telefone exato (`CONFIRMADO`, 1.0) → nome+placa/veículo (`PROVAVEL`, ~0.8) → nome fuzzy Dice ≥ 0.9 (`PROVAVEL`, valor da similaridade). Filtro temporal: `os.data_inicio_iso >= lead.entered_at` e ≤ 90 dias.
4. Demo (`visit_id LIKE 'demo_%'`) nunca cruza com OS reais.

## 4. Frontend (`public/index.html`)
- Toolbar: toggle Lista/Grade (ícones SVG stroke 1.5, sem emoji), seletor de data De/Até (`<input type="date">`) + presets, seletor tamanho de página, busca, filtros status/campanha.
- Tabela: `<table>` com `role="row"`, `tabindex=0`, Enter/Espaço e clique na `<tr>` abrem o sheet; hover/active sutil; colunas Nome (fallback "Visitante anônimo"), Telefone formatado, Entrada (`dd/mm/aaaa HH:mm`), Status (ponto óptico 6px + texto). Mobile: colunas secundárias colapsam, linha continua inteira clicável.
- Paginação: anterior/próxima, janela numérica, "x–y de N".
- Aba **Análise**: shell de KPIs (`.telemetry-shell`), rankings em tabela ordenável + barras proporcionais; pager de swipe (3→4 abas) deve atualizar `navLiquidPill`/`springToTab` para N abas.
- Estado de filtros na URL (`?from&to&page&size&view`) para link compartilhável.

## 5. Mapeamento de Arquivos
| Arquivo | Mudança |
|---|---|
| `projects/hydra-rede/src/leads_system/leads_db.js` | filtros from/to/campaign/page/pageSize, paginação, `leads_os_links`, `getAnalyticsData` |
| `projects/hydra-rede/src/leads_system/os_crossref.js` | **novo** — índice de telefones e vínculos |
| `projects/hydra-rede/src/leads_system/web_server.js` | novas rotas `/analytics`, `/lead/:id/os`, `/crossref/rebuild`, novos query params |
| `projects/hydra-rede/src/leads_system/public/index.html` | tabela, paginação, toggle, datas, aba Análise, seção OS no sheet |
| `projects/hydra-rede/src/leads_system/seed_demo_leads.js` | demos com OS fictícias vinculadas (`os_demo_*` em `leads_os_links`) para visualizar a Análise |
| `projects/hydra-rede/src/leads_system/test_leads_system.js` | testes de paginação, intervalo, cruzamento (DB fixture de OS), readOnly |
