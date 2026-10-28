# Proposta de Mudança — Spec 043: Bateria Exaustiva de Testes de Caos, E2E e Resiliência da Dupla Verificação (Hydra Rede)

## 1. Contexto e Motivação
A Spec 042 introduziu o motor de **Dupla Verificação Anti-Cascata e Blindagem S3**, estabelecendo dois portões determinísticos de proteção (Gate 1 In-Flight e Gate 2 Global Pre-Dispatch) para eliminar definitivamente as trocas de arquivos entre lojas (`LOJA X LOJA`), divergências financeiras (`BRUTO X REDE` / `LÍQUIDO X REDE`) e consolidações parciais (`Faltou JB + DP`).

Para garantir que essa blindagem seja infalível sob qualquer adversidade e que nenhum falso-positivo ou regressão atinja a esteira de despacho matinal das 08:00 AM, faz-se necessária uma **suíte exaustiva de testes automatizados**, abrangendo:
1. Simulação de caos em rede e polling assíncrono na fila S3 da Rede via Playwright Route Mocking.
2. Extração híbrida e degradação controlada do resumo de vendas (API vs. DOM vs. Não-detectado).
3. Casos de borda matemáticos e contábeis (tolerância MDR de R$ 0,05, dias sem vendas, range acumulado e injeção de EC intruso).
4. Ciclo de vida do estado, invalidação seletiva de checkpoint e resume determinístico.
5. Preservação milimétrica de fórmulas da planilha consolidada.
6. Smoke test nos dados históricos reais da VPS (`100.126.50.101`).

---

## 2. Escopo dos 6 Pilares de Testes

### Pilar 1: Caos na Fila S3 e Interceptação Playwright (`exportarExcelBlindado`)
- **Anti-Fallback Cego:** Fila contendo item pré-existente (`DONE`) no baseline de `existingIds`. Prova que o scraper rejeita o item antigo e aguarda o novo ID gerado pós-clique.
- **Colisão de Loja Anterior Atrasada:** Item recém-concluído da loja anterior surge na fila da loja atual com `pvCode` incorreto ou omitido (`null`). O scraper rejeita e aguarda `pvCode === loja.ec`.
- **Resiliência de Baseline:** Simulação de 2 falhas HTTP transitórias (500/401) seguidas de 200 na consulta inicial de `downloads/queue`, recuperando o baseline com sucesso.
- **Janela Temporal:** Descarte de itens com timestamp de criação anterior ao clique (`createdAt < clickTimestamp - 15s`).

### Pilar 2: Extração Híbrida do Resumo da Rede (`navegarECapturarResumoRede`)
- **Cenário A (`API_REDE`):** Resposta JSON oficial interceptada (`/sales`, `/summary`) -> prioridade máxima para valores da API.
- **Cenário B (`DOM_REDE`):** API ausente ou sem dados; extração via regex em cards HTML do DOM formatados em padrão brasileiro (`R$ 14.520,80`).
- **Cenário C (`NAO_DETECTADO`):** Falha total de extração de totais externos -> sistema flexibiliza checagem externa mantendo estrita a validação de EC interno e SHA-256 sem aborto indevido.
- **Cenário D (Desincronização de Sessão):** Cabeçalho exibe EC da loja anterior -> detecção imediata via Intra-Page Guard e aborto antes de qualquer clique.

### Pilar 3: Casos de Borda Financeiros e de Negócio (`double_check_auditor.js`)
- **Tolerância Estrita de MDR:**
  - Desvio de R$ 0,04 e R$ 0,05 entre Excel e Rede -> **Aprovado**.
  - Desvio de R$ 0,06 -> **Reprovado** com registro explícito de divergência.
- **Compatibilidade Dual de Período (Range Acumulado vs. Dia Alvo):**
  - Excel com vendas de múltiplos dias (`totalBrutoArquivo = R$ 3.000,00`) e filtro de dia-alvo com `totalBruto = R$ 1.000,00`. Se o portal exibir R$ 3.000,00, o auditor valida pelo total do arquivo sem falso-positivo.
- **Feriados e Domingos (Multi-Lojas `SEM_VENDAS`):**
  - Lojas sem transações geram assinatura `SEM_VENDAS`. O Gate 2 não colide essas lojas, mas ainda proíbe que o mesmo arquivo binário (.xlsx idêntico) seja compartilhado.
- **Agulha no Palheiro (EC Intruso):**
  - Planilha com 200 linhas corretas da Loja 01 e 1 linha infiltrada da Loja 02 -> detecção cirúrgica e reprovação imediata.

### Pilar 4: Ciclo de Vida do Estado, Invalidação no Gate 2 e Resume (`state_manager.js`)
- **Invalidação Seletiva no Gate 2:**
  - 10 lojas passam no Gate 1 (`SUCCESS`), mas JB e DP colidem no Gate 2. O auditor invalida e marca `FAILED` no disco **apenas** para JB e DP. O `getPendingStores` subsequente retorna exatamente `[JB, DP]`, aproveitando as 8 lojas já extraídas.
- **Bloqueio Total de Consolidação Parcial:**
  - Tentativa de consolidação com 1 das 10 lojas em falha -> exceção imediata antes da geração de planilhas incompletas.

### Pilar 5: Integridade da Planilha Final e Preservação de Fórmulas
- Consolidação de cenário perfeito com as 10 lojas do catálogo oficial (`LOJAS`).
- Verificação de preservação de 100% das fórmulas da planilha (`contarFormulasPlanilha`).
- Verificação da cópia canônica oficial `Juros Rede - DD-MM-AAAA.xlsx`.

### Pilar 6: Smoke Test nos Dados Históricos Reais da VPS (`--audit-history`)
- Scanner automatizado que inspeciona downloads reais já salvos em `/home/operacional/hydra-rede/downloads/` e estados em `data/` na VPS (`100.126.50.101`), garantindo que o parser e o auditor processem os relatórios reais sem quebras de cabeçalho ou layout.

---

## 3. Critérios de Aceite
- [ ] Implementação de 4 suítes modulares de testes sob `projects/hydra-rede/tests/`:
  - `test_playwright_chaos_s3.js` (Pilares 1 e 2).
  - `test_financial_edge_cases.js` (Pilares 3 e 4).
  - `test_spreadsheet_integrity.js` (Pilar 5).
  - `test_smoke_vps_history.js` (Pilar 6).
- [ ] Criação do orquestrador unificado `projects/hydra-rede/tests/run_all_tests.js`.
- [ ] Adição do script `"test:all"` no `package.json`.
- [ ] 100% dos testes executados e aprovados tanto localmente quanto na VPS de produção (`operacional@100.126.50.101`).
- [ ] Emissão de relatório de cobertura de cenários ao término da execução.
