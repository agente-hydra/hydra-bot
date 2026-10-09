# Plano de Implementação — Extração do Excel de Contas a Pagar, Retenção e Vetorização MCP (hydra-contas-pagar-excel-retention-vector)

**Spec ID:** `hydra-contas-pagar-excel-retention-vector`  
**Data:** 09/10/2026  
**Status:** Implementado & Homologado na VPS  
**Ambiente:** 100% VPS Linux (`operacional@100.126.50.101`)  

---

## Critérios Obrigatórios de Aceite

- [x] **[DUAL_EXTRACTION_PDF_EXCEL]** O módulo de extração baixa tanto o PDF oficial (`BuscaContasAPagar.pdf` -> `Contas a Pagar - DD-MM-AAAA.pdf`) quanto o Excel oficial (`BuscaContasAPagar.xls` -> `Contas a Pagar - DD-MM-AAAA.xlsx`) na mesma sessão/contexto sem necessidade de re-autenticação.
- [x] **[RETENTION_POLICY_2_DAYS]** Política de retenção configurada na VPS:
  - Arquivos Excel brutos são preservados por **pelo menos 2 dias completos** (48 horas).
  - Arquivos com mais de 2 dias são rotacionados/excluídos de forma segura.
  - Arquivos recentes (< 48h) nunca são excluídos.
- [x] **[STRUCTURED_SQL_INGESTION]** Criação e população da tabela `contas_pagar_lancamentos` no SQLite:
  - Extração de todas as 12 colunas do Excel com detecção dinâmica de índice de cabeçalho.
  - Conversão de datas seriais do Excel para strings ISO `YYYY-MM-DD`.
  - Tratamento de idempotência via chave primária `loja_slug:codigo:parcela`.
- [x] **[VECTOR_EMBEDDING_READY]** Geração de textos semânticos e indexação vetorial dos pagamentos no banco de vetores (`vec_contas_pagar` e `contas_pagar_fts`) via embedder all-MiniLM-L6-v2 e FTS5 unicode61.
- [x] **[MCP_TOOL_REGISTERED]** Criação da ferramenta MCP `consultar_contas_pagar` pronta para consumo por IA com busca textual, filtros relacionais e busca semântica vetorial.
- [x] **[AUTOMATED_TESTS_100_PASS]** Suíte de testes automatizados cobrindo parsing do Excel, cálculo de retenção e queries relacionais/vetoriais (100% PASS).

---

## Fase 1: Extração Dupla no Crawler (PDF + Excel)
- [x] **[TASK_DUAL_EXTRACTION]** Atualizar `src/hydra-sync/contas_pagar_crawler.ts` e `projects/hydra-rede/src/exportar_contas_pagar_cli.js`:
  - Após baixar o PDF, seleciona `#ctl00_cph_rblFormato_1` (Excel).
  - Clica em Imprimir e captura o download do arquivo `BuscaContasAPagar.xls`.
  - Salva em `/home/operacional/hydra-data/crawls/Contas a Pagar - DD-MM-AAAA.xlsx`. [CONCLUÍDO & TESTADO NA VPS]

---

## Fase 2: Parser Estruturado do Excel de Contas a Pagar
- [x] **[TASK_EXCEL_PARSER]** Criar `src/hydra-sync/contas_pagar_parser.ts`:
  - Leitura robusta de arquivos `.xls` e `.xlsx` via `xlsx` (SheetJS).
  - Mapeamento das 12 colunas oficiais (`Emp`, `Código`, `Parc`, `Cliente/Fornecedor`, `Descrição`, `Vl. Pago`...).
  - Conversão de números seriais de data do Excel para datas ISO.
  - Normalização de siglas de lojas para slugs canônicos da Hydra. [CONCLUÍDO]

---

## Fase 3: Persistência Relacional no SQLite
- [x] **[TASK_DB_SCHEMA_MIGRATION]** Atualizar `src/hydra-sync/db_repository.ts`:
  - Criar tabela `contas_pagar_lancamentos` com índices em `data_pagamento`, `loja_slug` e `fornecedor`.
  - Implementar função `upsertLoteContasPagar(db, lancamentos)` e `consultarContasPagarRelacional(db, filtros)`.
  - Criar tabelas virtuais `vec_contas_pagar` e `contas_pagar_fts`. [CONCLUÍDO]

---

## Fase 4: Vetorização Semântica (sqlite-vec / Embeddings)
- [x] **[TASK_VECTOR_INDEXING]** Criar `src/hydra-sync/contas_pagar_vector.ts`:
  - Gerador de textos semânticos estruturados para busca em linguagem natural.
  - Indexação vetorial na tabela `vec_contas_pagar` via `getEmbedder()`.
  - Fallback resiliente para FTS5 e SQL LIKE. [CONCLUÍDO]

---

## Fase 5: Serviço de Retenção e Expiração de Arquivos ($\ge$ 2 dias)
- [x] **[TASK_RETENTION_SERVICE]** Criar `projects/hydra-rede/src/contas_pagar_retention.js`:
  - Função `rotacionarArquivosExcel({ pastaCrawls, minHorasRetencao: 48, dryRun })`.
  - Validação estrita de `mtime`: ignora arquivos recentes (< 48h), remove apenas arquivos $\ge$ 48h.
  - Integrado no `exportar_contas_pagar_cli.js` e em `run_unified_morning_dispatch.js`. [CONCLUÍDO]

---

## Fase 6: Tool MCP para a IA
- [x] **[TASK_MCP_TOOL_INTERFACE]** Implementar handler da ferramenta MCP `consultar_contas_pagar`:
  - Criado `src/hydra-sync/mcp_contas_pagar.ts`.
  - Registrado em `src/hydra-sync/mcp_server.ts` sob `ListToolsRequestSchema` e `CallToolRequestSchema`.
  - Suporte a filtros relacionais: intervalo de datas, loja específica, nome do fornecedor.
  - Suporte a busca semântica por similaridade vetorial para perguntas livres. [CONCLUÍDO]

---

## Fase 7: Homologação e Testes na VPS
- [x] **[TASK_RUN_PARSER_UNIT_TESTS]** Executado teste unitário com o arquivo real `BuscaContasAPagar.xls` (28 lançamentos, R$ 28.147,98 - 100% PASS).
- [x] **[TASK_RUN_RETENTION_TEST]** Executado teste de retenção simulando arquivos com 12h, 36h (mantidos) e 50h, 100h (excluídos) - 100% PASS.
- [x] **[TASK_RUN_FULL_CYCLE_VPS]** Ciclo completo executado na VPS: extração de PDF (615.5 KB) + Excel (12.0 KB), ingestão de 28 lançamentos no SQLite WAL oficial e validação de retenção (100% SUCESSO).
