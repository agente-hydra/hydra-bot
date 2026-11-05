# Spec 075 — Central de Leads: Lista Paginada, Filtro por Intervalo de Datas, Alternância Lista/Grade & Cruzamento com OS (Oficina Inteligente)

## 1. Problema Detalhado
O Hub `/leads` (specs 073/074) mostra leads apenas como grade de cards (`renderLeadsGrid`, `index.html:1182`), sem paginação (`limit` fixo 250 em `getDashboardData`, `leads_db.js:632`), sem tabela densa e com filtro de tempo restrito a presets (`today`/`7d`/`30d`/`all`, `leads_db.js:636-642`). Além disso:
1. **Sem visão de lista operacional:** não há tabela com Nome, Telefone, Data de Entrada e Status clicável por linha para triagem rápida de volume.
2. **Filtro de tempo inflexível:** não existe intervalo "de X a Y".
3. **Leads isolados do faturamento:** `leads_funnel.db` não conversa com `hydra_ops.db`. Não é possível saber qual campanha/conjunto de anúncios/`gclid` virou OS e quanto faturou.
4. **Sem análise de dados:** faltam KPIs de receita, ROI-proxy e rankings de campanha com filtros combináveis.

## 2. Evidências (verificadas no código/VPS)
- `ordens_servico` (`src/hydra-sync/db_repository.ts:373`) tem `cliente_nome`, `placa`, `veiculo`, `total_os`, `valor_pago`, `data_inicio_iso`, `loja_slug`, `status_grid` — **mas NÃO tem coluna de telefone**.
- O telefone existe dentro de `raw_payload` JSON: `cliente_telefone`, `cliente_telefones[]`, `cliente_telefone_sms` (amostra real lida na VPS, read-only), além de `cliente_cpf`.
- Em `hydra_ops.db` (VPS `/home/operacional/hydra-data/`): 984 OS (2024-06-04 → 2026-11-04), R$ 3,34 mi somados; apenas 525 com `cliente_nome` preenchido → **o telefone via `raw_payload` é a chave primária de cruzamento; nome é fallback fuzzy**.
- `leads_sessions` já guarda `lead_phone` (E.164), `lead_name`, `lead_vehicle`, `utm_*`, `ad_group`, `gclid`, `entered_at`, `funnel_status` (`leads_db.js:87+`).

## 3. Solução Proposta
1. **Lista paginada (tabela) + Grade, com toggle Lista/Grade** persistido em `localStorage`. Tabela: Nome · Telefone · Entrada · Status. **Linha inteira clicável** (sem botão) abre o Bottom Sheet de detalhes já existente. Paginação servidor-side: página padrão 10, seletor 10/20/50/100, contador "x–y de N". A Grade reutiliza a mesma paginação.
2. **Filtro de período por intervalo de datas** (`from`/`to`, `YYYY-MM-DD`, fuso America/Sao_Paulo) + presets rápidos (Hoje/7d/30d/Tudo) que apenas preenchem o intervalo.
3. **Cruzamento Lead ↔ OS (somente leitura em `hydra_ops.db`)**: índice de telefones de OS construído a partir de `raw_payload`, normalizado E.164 com `normalizePhoneE164` (já exportado em `leads_db.js`). Camadas: (1) telefone exato, (2) nome normalizado + placa/veículo quando houver, (3) nome fuzzy **apenas sugerido** (`match_confidence`, nunca auto-confirmado). Tabela de vínculo própria `leads_os_links` em `leads_funnel.db` (nunca altera `hydra_ops.db`).
4. **Central de Análise**: nova aba **Análise** com KPIs (leads, conversas, leads→OS, taxa de conversão, faturamento atribuído `total_os`, ticket médio, pago vs restante) e rankings por campanha / conjunto de anúncios / `gclid` / origem, ordenáveis, com os mesmos filtros (período, status, campanha, loja, busca).
5. **Detalhe do lead** ganha seção "Ordens de Serviço vinculadas" (OS, loja, veículo, total, status, data).

## 4. Especialistas Envolvidos
`match_roster.mjs` retornou `k = 0` → **planejamento solo `[LEAD]`** com aviso de *roster-gap* (sem especialista de analytics/BI no roster).

## 5. Riscos e Mitigação
| Risco | Mitigação |
|---|---|
| Falso positivo no cruzamento por nome | Só telefone exato auto-vincula; nome vira sugestão com confiança e rótulo "provável"; KPIs de faturamento contam apenas vínculos `CONFIRMADO` (telefone) por padrão, com toggle para incluir prováveis. |
| `raw_payload` pesado/lento (100 MB DB) | Índice em memória reconstruído com TTL (ex.: 10 min) lendo `hydra_ops.db` em modo `readOnly`; nunca no caminho quente do request. |
| Escrita acidental em `hydra_ops.db` | Abertura exclusivamente `readOnly: true`; teste que falha se houver `INSERT/UPDATE/DELETE` contra a conexão. |
| LGPD (CPF/telefone) | Não expor CPF na UI; telefone apenas atrás do PIN existente; sem logs de PII. |
| Atribuição ≠ causalidade (OS pode ser de cliente antigo) | Considerar apenas OS com `data_inicio_iso >= entered_at` do lead; exibir "faturamento atribuído", não "gerado". |
| Regressão do swipe/anti-slop (spec 074) | Manter suíte `test_leads_system.js` verde + novos testes. |

## 6. Decisões em Aberto (padrão adotado se não houver objeção)
- Janela de atribuição lead→OS: **90 dias** após entrada.
- Prováveis (nome) fora do faturamento por padrão.
