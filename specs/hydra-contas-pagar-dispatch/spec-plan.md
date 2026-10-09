# Plano de Implementação — Automação e Despacho de Contas a Pagar (hydra-contas-pagar-dispatch)

**Spec ID:** `hydra-contas-pagar-dispatch`  
**Data:** 09/10/2026  
**Status:** Implementado & Homologado com Sucesso  
**Ambiente:** 100% VPS Linux (`operacional@100.126.50.101`)  

---

## Critérios Obrigatórios de Aceite

- [x] **[CONTAS_PAGAR_CRAWLER_MODULAR]** Implementado módulo autônomo e reutilizável em Playwright para captura do PDF de Contas a Pagar em `wfContaBuscaPagar.aspx`.
- [x] **[EXACT_DATE_CALCULATION]** Regra temporal de datas validada:
  - Terça a Domingo: Data Inicial e Final = Ontem ($D-1$).
  - Segunda-feira: Data Inicial = Sexta-feira passada ($D-3$), Data Final = Ontem ($D-1$).
- [x] **[ALL_COMPANIES_SELECTION]** Seleção de todas as empresas comprovadamente efetuada via acionamento de `#chkEmpresaSelecao`.
- [x] **[PAYMENT_DATE_FILTER]** Seleção comprovada do filtro "Data de Pagamento" (`#ctl00_cph_rblFiltroData` = `'3'`).
- [x] **[SEARCH_AND_PRINT_INTERCEPT]** Busca executada com sucesso e download nativo de `BuscaContasAPagar.pdf` interceptado e salvo como `Contas a Pagar - DD-MM-AAAA.pdf`.
- [x] **[DEEP_CRAWLER_INTEGRATION]** Chamada do módulo de Contas a Pagar encadeada imediatamente após o término do Mapa de Metas no crawler da madrugada.
- [x] **[QUARTET_DISPATCHER]** O dispatcher do WhatsApp despacha os 4 relatórios oficiais em sequência:
  1. `Juros Rede - DD-MM-AAAA.xlsx`
  2. `Carros em Patio - DD-MM-AAAA.xlsx`
  3. `Mapa de Metas - DD-MM-AAAA.pdf`
  4. `Contas a Pagar - DD-MM-AAAA.pdf`
- [x] **[ZERO_TEXT_ZERO_CAPTION]** Todos os 4 arquivos enviados com `caption: ""` e nenhuma mensagem de texto no corpo da conversa.
- [x] **[SAFE_EXCLUSIVE_TARGET]** Envio estritamente para `5511996242812` (zero envio ao financeiro).
- [x] **[GATE_4_OF_4]** O orquestrador matinal só libera o envio às 08:00 AM se os 4/4 arquivos estiverem fisicamente íntegros no disco.

---

## Fase 1: Módulo Crawler de Contas a Pagar
- [x] **[TASK_CONTAS_CRAWLER_MODULE]** Criar `src/hydra-sync/contas_pagar_crawler.ts`:
  - Função pura `calcularPeriodoContasPagar(dataRef)`.
  - Função `gerarPdfContasPagar(page, caminhoDestino, options)`.
  - Tratamento de PostBack, seleção de empresas e download assíncrono. [CONCLUÍDO]
- [x] **[TASK_TEST_DATE_LOGIC]** Criar teste de unidade para validação matemática do cálculo de datas (segunda-feira vs dias úteis comuns). [CONCLUÍDO]

---

## Fase 2: Integração no Deep Crawler da Madrugada
- [x] **[TASK_INTEGRATE_DEEP_CRAWLER]** Modificar `src/hydra-sync/deep-crawler.ts`:
  - Importar `gerarPdfContasPagar`.
  - Chamar logo após `gerarPdfMapaMetas(page, caminhoPdf)` usando a mesma página e contexto.
  - Gravar `Contas a Pagar - DD-MM-AAAA.pdf` no diretório de crawls. [CONCLUÍDO]

---

## Fase 3: Script Utilitário Standalone CLI
- [x] **[TASK_CREATE_CLI_TOOL]** Criar `projects/hydra-rede/src/exportar_contas_pagar_cli.js`:
  - Permitir acionamento sob demanda ou contingência via terminal da VPS:
    `node src/exportar_contas_pagar_cli.js [--date=YYYY-MM-DD]`
  - Realizar login autônomo, calcular datas, exportar e salvar o PDF. [CONCLUÍDO]

---

## Fase 4: Suporte ao Quarteto no Dispatcher WhatsApp
- [x] **[TASK_UPDATE_UNIFIED_DISPATCHER]** Modificar `projects/hydra-rede/src/whatsapp_unified_dispatcher.js`:
  - Atualizar `resolverCaminhosPadraoRelatorios` para incluir `contasPagarPdfPath`.
  - Atualizar `dispararRelatoriosMatinaisSilenciosos` para enfileirar os 4 documentos.
  - Manter `caption: ""` em todos os envios. [CONCLUÍDO]

---

## Fase 5: Atualização do Orquestrador Matinal
- [x] **[TASK_UPDATE_ORCHESTRATOR]** Modificar `projects/hydra-rede/src/run_unified_morning_dispatch.js`:
  - Validar existência e tamanho dos 4 arquivos oficiais (Gate 4/4).
  - Incluir etapa de contingência: se `Contas a Pagar` não existir na pasta de crawls, executar o CLI gerador automaticamente antes do envio.
  - Manter o Timer Guard (08:00 AM) e o destino exclusivo (`5511996242812`). [CONCLUÍDO]

---

## Fase 6: Homologação e Teste na VPS
- [x] **[TASK_SYNC_FILES_VPS]** Sincronizar os novos arquivos para a VPS (`operacional@100.126.50.101`). [CONCLUÍDO]
- [x] **[TASK_RUN_UNIT_TESTS]** Executar suíte de testes de validação dos contratos e cálculo de datas. [CONCLUÍDO]
- [x] **[TASK_RUN_CRAWLER_TEST_VPS]** Executar teste do crawler na VPS gerando o PDF real de Contas a Pagar. [CONCLUÍDO]
- [x] **[TASK_RUN_DISPATCH_TEST_VPS]** Executar teste do orquestrador matinal (`--immediate --force`), comprovando a entrega dos 4 documentos limpos exclusivamente para `5511996242812`. [CONCLUÍDO]
