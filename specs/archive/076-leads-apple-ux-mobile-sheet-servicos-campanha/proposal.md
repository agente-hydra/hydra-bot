# Proposta de Engenharia — Spec 076: Redesign UI/UX Mobile Nível Apple iOS, Identificação de LP de Origem, Matriz Serviços × Campanha e Limpeza de Base

## 1. Problema Detalhado

1. **Falta de Visibilidade da Landing Page (LP) de Origem nos Detalhes e na Lista:**
   - Quando um lead entra por uma Landing Page hospedada/embedada no Squad (ex: `https://mecanicapopular.com.br/` carregando o container `https://mdhwevs80xtfv5np2u0b4mth.squadusercontent.com/`), o domínio real da LP fica registrado em `referrer` ou `page_url`, mas **não é exibido em lugar nenhum do card de Detalhes do Lead** (`openLeadDetail` em `public/index.html:1837-1846`) nem na tabela principal. O usuário só conseguia descobrir de qual LP veio lendo o JSON bruto lá no fim do modal.

2. **Base de Produção Poluída com Leads de Demonstração e Cliques de Teste:**
   - O banco `/home/operacional/hydra-data/leads_funnel.db` na VPS contém registros demonstrativos (`demo_*`), testes de preview do editor (`referrer: https://app.squad.com/`) e cliques de teste de validação, sem uma opção de expurgo completo de testes ou exclusão unitária de um lead de teste direto pelo Sheet.

3. **Tela de Detalhes do Lead (`#leadDetailModal` / `#sheetCard`) com Visual Técnico Cru:**
   - Ao tocar em um lead no celular, o modal exibe um bloco `font-mono` genérico seguido de dois blocos `<pre>` abertos com JSON bruto (`gtag_data_json` e `raw_payload_json`).
   - Faltam ações rápidas nativas de uso mobile (botões circulares estilo iOS Contact Card para Ligar, chamar no WhatsApp, copiar telefone/código, excluir teste), linha do tempo visual da jornada do lead e agrupamento estilo **iOS Grouped Inset List**.

4. **Ausência do "Tipo de Serviço Desejado" no Lead e dos "Serviços Executados" nas OSs:**
   - O operador não consegue visualizar nem classificar qual serviço o lead procurava quando entrou (ex: *Câmbio Automático*, *Suspensão*, *Freios*, *Revisão/Óleo*, *Motor/Injeção*, *Alinhamento*).
   - Embora o banco operacional `hydra_ops.db` possua o array `itens` dentro de `ordens_servico.raw_payload` em 979 das 982 OSs (`[{"codigo","descricao","qtd","valor_unitario","valor_total","executor"}]`), o módulo `os_crossref.js` ainda não extrai esses itens nem classifica os serviços realizados.
   - Consequentemente, a aba **Análise** não apresenta o cruzamento **Serviços Executados × Campanha** nem **Desempenho por Landing Page (LP)**, e o card da OS dentro do detalhe do lead não lista os itens/serviços feitos no veículo.

5. **Apresentação de Dados e Tabelas em Telas Mobile (`< 640px`):**
   - Na visualização em lista e nos rankings da aba **Análise**, tabelas largas exigem rolagem horizontal (`overflow-x-auto`) em telas de celular, dificultando a leitura imediata de Nome, LP, Serviço, Status e Faturamento.

---

## 2. Solução Proposta

### 2.1. Identificação Inteligente da Landing Page (LP) de Origem (`resolveLandingPageInfo`)
- Adicionar resolução determinística de **Landing Page de Origem** (`lp_domain`, `lp_url`, `lp_path`, `traffic_referrer`) no backend (`leads_db.js`) e no frontend (`public/index.html`):
  - Se `page_url` for um container de iframe (`*.squadusercontent.com`) e `referrer` contiver o domínio público da LP (ex: `https://mecanicapopular.com.br/`), promove `referrer` como a **LP Principal (`mecanicapopular.com.br`)** e preserva a URL técnica do container.
  - Suportar também parâmetros explícitos `lp_name`, `lp_url`, `parent_url` na ingestão do webhook.
- Exibir a **Landing Page de Origem** com destaque:
  - No **Topo e Grupo de Origem do Sheet de Detalhes do Lead** (`#sheetLpOrigin`) com domínio, caminho completo, link clicável e botão de copiar URL.
  - Na **Tabela/Lista de Leads** (badge da LP abaixo da campanha/serviço).
  - Na **Aba Análise** (ranking/filtro por Landing Page).

### 2.2. Limpeza da Base de Produção e Exclusão de Testes em 1 Toque
- Expandir a rotina de limpeza (`clearTestAndDemoLeads` em `leads_db.js` + `POST /leads/api/demo/clear`) para remover registros `demo_%`, testes de preview do Squad (`referrer LIKE '%app.squad.com%'`), prefixos `test_%`/`smoke_%`, órfãos em `leads_events` e `leads_os_links`, além de suportar parâmetro `mode: 'all_tests'` ou limpeza total sob confirmação.
- Adicionar endpoint `DELETE /leads/api/lead/:visitId` (protegido por PIN) e botão **"Excluir Lead / Teste"** dentro do Sheet de Detalhes, permitindo apagar qualquer clique de teste individual em 1 toque.
- Executar expurgo completo dos dados de teste na base de produção da VPS durante o deploy, deixando a base limpa.

### 2.3. Tipo de Serviço no Lead (`desired_service`) + Inferência & Edição Rápida (1-Tap)
- Adicionar a coluna `desired_service TEXT` na tabela `leads_sessions` (`leads_db.js`) com migração idempotente (`ALTER TABLE`).
- **Auto-inferência na ingestão e backfill:** Detectar automaticamente a categoria de serviço a partir de `whatsapp_message_text`, `utm_term`, `utm_content`, `ad_group`, `utm_campaign`, `page_url`/`referrer` ou campo explícito `service`/`desired_service`.
- **Edição com 1 Toque no Detalhe do Lead:** Endpoint `PATCH /leads/api/lead/:visitId/service` permitindo selecionar/alterar instantaneamente o serviço desejado via pílulas interativas (iOS Action Chips) direto no Sheet do lead.

### 2.4. Extração de Itens/Serviços das OSs (`os_crossref.js`) e Cruzamento "Serviços × Campanha"
- Expandir `os_crossref.js` e a tabela `leads_os_links` com `os_items_json TEXT`, `os_service_categories TEXT` e `os_observacao TEXT`, extraindo de `ordens_servico.raw_payload.itens` cada serviço/peça (`descricao`, `qtd`, `valor_total`, `executor`) e classificando-os em categorias canônicas de oficina (*Câmbio Automático*, *Suspensão & Direção*, *Freios*, *Revisão & Óleo*, *Motor & Injeção*, *Alinhamento & Pneus*, *Ar Condicionado*, *Embreagem*, *Elétrica*, *Outros*).
- Expandir `getAnalyticsData()` (`leads_db.js`) para retornar `byService`, `serviceCampaignMatrix` e `byLandingPage`.

### 2.5. Redesign Nível Apple iOS 18 (Mobile-First, Sheet & Apresentação de Dados)
- **Apple Contact Sheet (`#sheetCard`):**
  - **Hero Header:** Avatar com monograma das iniciais, Nome em destaque, badge da **Landing Page de Origem** (`mecanicapopular.com.br`), badges de Status + Serviço Desejado, e **Quick Action Bar** (*Ligar*, *WhatsApp*, *Copiar Contato*, *Excluir Teste*).
  - **Seletor Rápido de Serviço Desejado (`#sheetServicePicker`):** Grade de chips tátil para classificar o serviço procurado pelo lead em 1 toque.
  - **Card Destacado de Origem & Landing Page (`#sheetLpOrigin`):** Domínio da LP, URL completa clicável, Origem/Mídia, Campanha, Conjunto e Termo pesquisado.
  - **Timeline da Jornada do Lead (`#sheetTimeline`):** Stepper com timestamps exatos (*Entrada na LP* → *Redirect WhatsApp* → *Mensagem Recebida* → *OS Aberta*).
  - **Cartões de OS Estilo Apple Wallet:** Exibição da Loja, Veículo, Placa padrão Mercosul, Valor Total e **lista detalhada dos serviços e peças executados na OS** (`itens`).
  - **Disclosure Técnico (`#sheetTechDisclosure`):** JSONs brutos recolhidos por padrão em um acordeão limpo.

---

## 3. Especialistas Envolvidos

- **Modo:** `solo` (`k = 0`, `hasRosterGap: true` reportado por `match_roster.mjs`).
- O **Agente Líder (`[LEAD]`)** conduzirá todas as tarefas com verificação determinística na suíte E2E.

---

## 4. Riscos e Mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| LP rodando em iframe do Squad (`*.squadusercontent.com`) esconder o domínio real em `page_url` | Operador ver apenas o hash do Squad em vez de `mecanicapopular.com.br` | Resolvedor `resolveLandingPageInfo()` que inspeciona `page_url`, `referrer` e `raw_payload_json`, priorizando o domínio público da LP quando `page_url` for `squadusercontent.com`. |
| Exclusão acidental de leads reais ao limpar testes | Perda de dados de tráfego | `clearDemoLeads` remove por padrão apenas prefixos de teste/demo (`demo_%`, `test_%`, `smoke_%`) e previews (`referrer LIKE '%app.squad.com%'`), enquanto exclusão individual exige confirmação e PIN. |
| Esquemas legados de `leads_sessions` e `leads_os_links` sem as novas colunas | Erro SQL ao consultar colunas novas | Migração automática idempotente via `PRAGMA table_info(...)` + `ALTER TABLE ADD COLUMN`. |
