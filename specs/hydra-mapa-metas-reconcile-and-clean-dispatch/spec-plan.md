# Plano de Execução: Reconciliação Bidirecional do Mapa de Metas & Despacho Silencioso

**Spec ID:** `hydra-mapa-metas-reconcile-and-clean-dispatch`  
**Data:** 08/10/2026  
**Status:** Planejamento  

---

## Tarefas de Implementação

- [x] [TYPES] **Contratos de Tipos em `src/hydra-sync/types/meta_reconciliation_contract.ts`**
  - Declarar `StoreRevenueSnapshot`, `MapaMetasReconciliationSnapshot`, `ReconcileDeltaResult` e `UnifiedDailyReportsPayload`.
  - Tipagem 100% strict sem `any`.

- [x] [MODULE] **Módulo de Reconciliação em `src/hydra-sync/crawler_meta_reconciliation.ts`**
  - Implementar `capturarSnapshotMapaMetas(page)`:
    - Seleção de "Todas as Empresas" (`#ctl00_cph_ucMapaDeMeta_btnEmpresaTodas`).
    - Desmarcação sumária da Loja Master (regra anti-master).
    - Clique em "Gerar" (`#btnGerar`).
    - Extração do faturamento total via XPath `//*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]` e fallbacks.
    - Extração do faturamento individual das 10 lojas comerciais.
  - Implementar `compararSnapshotsMetas(inicial, final)` para isolar lojas com divergência.
  - Implementar `gerarPdfMapaMetas(page, outputPath)` com Playwright `page.pdf` em formato A4 Paisagem.

- [x] [CRAWLER] **Integração no Ciclo Principal em `src/hydra-sync/deep-crawler.ts`**
  - Capturar `initialSnapshot` logo após o login e antes de iterar pelas lojas.
  - Capturar `finalSnapshot` ao término da extração das 10 lojas.
  - Executar double-check: se houver diferença, acionar `handleOSDeepInspector` cirurgicamente apenas para as lojas divergentes.
  - Acionar `gerarPdfMapaMetas` salvando `Mapa de Metas - DD-MM-AAAA.pdf`.

- [x] [EXCEL] **Padronização da Nomenclatura das Planilhas Diárias**
  - Atualizar `projects/hydra-rede/src/excel_patio_builder.js` para salvar como `Carros em Patio - DD-MM-AAAA.xlsx`.
  - Atualizar `projects/hydra-rede/src/index.js` para salvar como `Juros Rede - DD-MM-AAAA.xlsx`.

- [x] [DISPATCHER] **Despachador Limpo Unificado via WhatsApp**
  - Criar `projects/hydra-rede/src/whatsapp_unified_dispatcher.js`:
    - Envio sequencial dos 3 documentos oficiais (`Juros Rede`, `Carros em Patio`, `Mapa de Metas`).
    - Modo silencioso: zero texto solto no chat da diretoria e sem caption longo.
    - MIME types corretos (`application/pdf` e `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
    - Preservação estrita dos alertas de erro/contingência para o desenvolvedor (`DEV_NUMBER`).
  - Atualizar `projects/hydra-rede/src/run_patio_daily.js` para suportar o despacho limpo unificado.

- [x] [TESTS] **Suíte Integrada de Testes de Reconciliação e Despacho**
  - Criar `src/hydra-sync/tests/test_meta_reconciliation_dispatch.ts`:
    - Gate 1: Captura e parsing do Snapshot do Mapa de Metas com seletor de faturamento total.
    - Gate 2: Algoritmo de conciliação de delta (identificação cirúrgica de lojas com alteração).
    - Gate 3: Geração de PDF em formato Paisagem A4 com nomenclatura de data.
    - Gate 4: Nomenclatura canônica dos 3 arquivos (`Juros Rede`, `Carros em Patio`, `Mapa de Metas`).
    - Gate 5: Despacho silencioso sem texto solto e conformidade de MIME types.
    - Verificação no compilador TypeScript estrito (`npx tsc --noEmit`).
