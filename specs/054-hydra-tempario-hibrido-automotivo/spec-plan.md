# Spec 054 — Plano de Implementação Refinado: Tempário Híbrido Automotivo (RAG Vetorial + Grafo de Dependências + Tempo Real de Pátio)

**ID da Spec:** `054-hydra-tempario-hibrido-automotivo`  
**Versão:** 2.0 (Refinada)  
**Data:** 03/11/2026  
**Status:** CONCLUÍDO (HARD STOP — AGUARDANDO /vibe-archive)  
**Estratégia:** SDD Estrito com Execução em Batedores e Paralelismo Seguro Alethe  
**Suíte de Testes TDD:** `src/hydra-sync/tests/test_harness_tempario.ts`

---

## 1. Mapa de Módulos (Novos vs. Modificados)

| Caminho do Arquivo | Tipo | Responsabilidade |
| :--- | :---: | :--- |
| `src/hydra-sync/types/tempario_contract.ts` | **NOVO** | Interfaces TypeScript estritas (zero `any`, zero `@ts-ignore`). |
| `src/hydra-sync/tempario_graph_repository.ts` | **NOVO** | DDL das 8 tabelas SQLite, fixtures canônicas (VW Golf 1.4 TSI 2020, Onix, Civic) e query `WITH RECURSIVE` polimórfica com deduplicação `DEPENDE_ACESSO` e trava anti-ciclo. |
| `src/hydra-sync/tempario_vector.ts` | **NOVO** | Vetorização 384d via `embeddings.ts`, indexação em `vec_tempario_chunks` + `tempario_fts` e busca híbrida RRF ($k=60$). |
| `src/hydra-sync/tempario_hybrid_coordinator.ts` | **NOVO** | Orquestrador Cache-First (`ConversationCacheManager`), cruzamento de pátio e fallback anti-alucinação com quarentena em `tempario_external_estimates_staging`. |
| `src/hydra-sync/tests/test_harness_tempario.ts` | **NOVO** | Bateria TDD com 7 cenários determinísticos cobrindo grafo, RRF, pátio, anti-alucinação, colisão de ano/OS, isolamento de gerente e formatação Hermes. |
| `src/hydra-sync/db_repository.ts` | **MODIFICAR** | Invocar `ensureTemparioTables(db)` de forma idempotente no boot de `getDatabaseConnection()`. |
| `src/hydra-sync/hybrid_retrieval.ts` | **MODIFICAR** | Expor helper de integração RRF para chunks técnicos de tempário. |
| `src/hydra-sync/operational_data_repository.ts` | **MODIFICAR** | Implementar `getYardHistoricalServiceMetrics()` usando `data_inicio_iso`/`data_fim_iso` + cruzamento de gargalos via `EvidencePolicyManager`. |
| `src/hydra-sync/semantic_glossary.ts` | **MODIFICAR** | Registrar termos e sinônimos de tempário e operações mecânicas. |
| `src/hydra-sync/intent_rewriter.ts` | **MODIFICAR** | Detectar intenção `TEMPARIO_TEMPO_SERVICO` sem interferir em `isExplicitFinancialQuery` nem em consultas de OS por número. |
| `src/hydra-sync/agent_dispatcher.ts` | **MODIFICAR** | Proteger `parseOSModuleIntent()` contra falsos positivos de anos de veículos (ex: `2020`) em perguntas de mão de obra/tempário e despachar para o coordenador. |
| `src/hydra-sync/manager_store_access.ts` | **MODIFICAR** | Permitir `TEMPARIO_TEMPO_SERVICO` para a persona `gerente` mantendo o histórico de pátio estritamente filtrado por `activeLojaSlug`. |
| `src/hydra-sync/mcp_server.ts` | **MODIFICAR** | Registrar tool MCP `consultar_tempario_hibrido` com telemetria via `ToolExecutionTracker`. |
| `src/hydra-sync/balloon_composer.ts` | **MODIFICAR** | Adicionar `composeTemparioHermesBalloon()` sem emojis decorativos, sem tabelas Markdown e sem NBSP. |
| `src/hydra-sync/public_response_guard.ts` | **MODIFICAR** | Incluir `consultar_tempario_hibrido` em `toolPatterns` e tabelas `tempario_*` em `schemaPatterns`. |

---

## 2. Tarefas Atômicas de Implementação

### Fase 1: Contratos Estritos, Grafo Polimórfico e CTE Recursivo

- [x] `[PARALLEL: wt-tempario-core]` **Task 1.1: Criar Contratos TypeScript Estritos**
  - **Arquivo:** `src/hydra-sync/types/tempario_contract.ts`
  - **Descrição:** Implementar todos os tipos de domínio (`TemparioVehicleRecord`, `TemparioEngineRecord`, `TemparioOperationRecord`, `TemparioSubOperationStep`, `DeduplicatedGraphChainResult`, `YardRealTimeComparison`, `TemparioHybridQueryInput`, `TemparioHybridQueryResponse`, `TemparioEvidenceStatus`).
  - **Verificação:** `npx tsc --noEmit` com zero `any` e zero `@ts-ignore`.

- [x] `[PARALLEL: wt-tempario-core]` **Task 1.2: Implementar Repositório do Grafo e CTE Recursivo de Deduplicação**
  - **Arquivo:** `src/hydra-sync/tempario_graph_repository.ts`
  - **Descrição:**
    - Criar `ensureTemparioTables(db)` com as 8 tabelas relacionais/FTS5 e índices.
    - Criar `seedCanonicalTemparioCatalog(db)` populando o catálogo inicial homologado (incluindo *VW Golf 1.4 TSI 2020 — EA211* com operações de *Farol Dianteiro Esquerdo* e *Radiador de Arrefecimento*, encadeando sub-operações nas 4 fases: `DESMONTAGEM`, `EXECUCAO`, `REMONTAGEM`, `TESTE_AJUSTE`).
    - Implementar `resolveDeduplicatedServiceChain(db, operationIds, engineId)` com o `WITH RECURSIVE` polimórfico, prevenção de ciclo (`path_visited`) e cálculo exato de `tempoBrutoTotalHoras`, `tempoLiquidoTotalHoras` e `tempoEconomizadoDeduplicacaoHoras`.
  - **Verificação:** Consulta individual do Farol retorna 6 etapas (`1,40h`); consulta combinada Farol + Radiador deduplica a remoção (`0,40h`) e reinstalação (`0,35h`) do para-choque dianteiro, economizando `0,75h` (`45 min`).

- [x] `[LEAD]` **Task 1.3: Plugar Inicialização Idempotente no `db_repository.ts`**
  - **Arquivo:** `src/hydra-sync/db_repository.ts`
  - **Descrição:** Chamar `ensureTemparioTables(db)` e `ensureTemparioVectorTable(db)` dentro da inicialização de `getDatabaseConnection()`.
  - **Verificação:** Conexão SQLite inicializa sem erros em banco existente ou em memória (`:memory:`).

---

### Fase 2: Busca Híbrida Local (Vetor 384d + FTS5 + RRF)

- [x] `[PARALLEL: wt-tempario-rag]` **Task 2.1: Implementar Indexador e Buscador Vetorial/Léxico (`tempario_vector.ts`)**
  - **Arquivo:** `src/hydra-sync/tempario_vector.ts`
  - **Descrição:**
    - Implementar `indexTemparioProcedureChunks(db)` utilizando `getEmbedder()` de `./embeddings.js` (`Xenova/all-MiniLM-L6-v2`, 384d) para popular `vec_tempario_chunks` e `tempario_fts`.
    - Implementar `searchTemparioHybridRRF(db, query, filters)` combinando filtro SQL exato de veículo/ano/motor + FTS5 (`escapeFtsQuery`) + KNN vetorial com Reciprocal Rank Fusion ($k=60$).
    - Garantir fallback transparente para FTS5 + Grafo caso `sqlite-vec` não esteja carregado no ambiente.
  - **Verificação:** Buscas informais (*"quanto tempo leva pra trocar farol esquerdo do golf tsi 2020"*) retornam `op_vw_golf_14tsi_troca_farol_esq` no topo com `confidenceScore >= 0.75`.

- [x] `[PARALLEL: wt-tempario-rag]` **Task 2.2: Integrar Helper no `hybrid_retrieval.ts`**
  - **Arquivo:** `src/hydra-sync/hybrid_retrieval.ts`
  - **Descrição:** Exportar adaptador de fusão RRF para consultas de tempário mantendo compatibilidade total com `retrieveOperationalData()`.

---

### Fase 3: Cruzamento Factual com Tempo Real de Pátio (`ordens_servico`)

- [x] `[PARALLEL: wt-tempario-yard]` **Task 3.1: Implementar `getYardHistoricalServiceMetrics` em `operational_data_repository.ts`**
  - **Arquivo:** `src/hydra-sync/operational_data_repository.ts`
  - **Descrição:**
    - Consultar `ordens_servico` usando `data_inicio_iso` e `data_fim_iso` (normalizadas via `parseBrDateToIso`) e filtrando serviços no `raw_payload` (`isServiceItem`).
    - Aplicar isolamento estrito de segurança: quando `securityContext.persona === 'gerente'`, filtrar compulsoriamente por `loja_slug = securityContext.lojaSlug` (ou lançar `SecurityAccessDeniedError` se tentar acessar outra loja).
    - Cruzar OSs encontradas com `hydra_afirmacoes_analisadas` (`delay_cause_reported`) e validar via `EvidencePolicyManager.evaluateDelayCause()` para listar apenas gargalos factualmente comprovados.
  - **Verificação:** Retorna média/mediana real e gargalos auditados, sem nunca usar `julianday()` sobre strings `DD/MM/YYYY` e sem inventar motivos de atraso.

---

### Fase 4: Coordenador Cache-First e Guardião Anti-Alucinação

- [x] `[LEAD]` **Task 4.1: Implementar `TemparioHybridCoordinator` (`tempario_hybrid_coordinator.ts`)**
  - **Arquivo:** `src/hydra-sync/tempario_hybrid_coordinator.ts`
  - **Descrição:**
    - **Passo 1 (Cache L1):** Consultar/gravar em `ConversationCacheManager` com chave multi-fatorial segregada por veículo, motor, serviços ordenados, `persona`, `effectiveLojaSlug` e `generationId`.
    - **Passo 2 (Busca Híbrida + Grafo + Pátio):** Executar RRF $\rightarrow$ CTE Recursivo $\rightarrow$ Cruzamento de Pátio.
    - **Passo 3 (Fallback Anti-Alucinação):** Quando `confidenceScore < 0.75` ou veículo/serviço não constar no catálogo homologado:
      - Proibir geração de capítulos/páginas fictícias de manual OEM.
      - Marcar obrigatoriamente `statusEvidenciaGlobal: 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'`.
      - Gravar na tabela isolada `tempario_external_estimates_staging` e registrar evidência via `evidence_repository.ts`, preservando intactas as tabelas `HOMOLOGADO_OEM`.
  - **Verificação:** Cache hit retorna em $< 5\text{ms}$; estimativa não homologada vai para staging sem sujar `tempario_operations`.

---

### Fase 5: Roteamento Semântico Blindado, Tool MCP e Balões Hermes

- [x] `[PARALLEL: wt-tempario-routing]` **Task 5.1: Glossário, Rewriter, Dispatcher e Escopo de Gerente**
  - **Arquivos:** `src/hydra-sync/semantic_glossary.ts`, `src/hydra-sync/intent_rewriter.ts`, `src/hydra-sync/agent_dispatcher.ts`, `src/hydra-sync/manager_store_access.ts`
  - **Descrição:**
    - Adicionar vocabulário de tempário no `semantic_glossary.ts`.
    - Implementar `isTemparioTechnicalQuery()` e emissão de `TEMPARIO_TEMPO_SERVICO` em `intent_rewriter.ts`.
    - Em `agent_dispatcher.ts`, blindar `parseOSModuleIntent()` para que perguntas de tempário contendo anos de 4 dígitos (`2020`) + `"mão de obra"` NÃO sejam desviadas para busca da `OS #2020`.
    - Em `manager_store_access.ts`, incluir `'TEMPARIO_TEMPO_SERVICO'` em `allowedIntents` com filtro estrito de loja no comparativo de pátio.
  - **Verificação:** *"mão de obra pra trocar farol do golf 2020"* aciona o tempário e não `OS #2020`; *"qual o CMV de Mauá"* continua indo 100% para o motor financeiro.

- [x] `[PARALLEL: wt-tempario-mcp]` **Task 5.2: Registrar Tool `consultar_tempario_hibrido` no `mcp_server.ts`**
  - **Arquivo:** `src/hydra-sync/mcp_server.ts`
  - **Descrição:** Expor `consultar_tempario_hibrido` com schema JSON validado e rastreamento em `ToolExecutionTracker`.

- [x] `[LEAD]` **Task 5.3: Compositor Hermes e Regras do `public_response_guard.ts`**
  - **Arquivos:** `src/hydra-sync/balloon_composer.ts`, `src/hydra-sync/public_response_guard.ts`
  - **Descrição:**
    - Implementar `composeTemparioHermesBalloon(response: TemparioHybridQueryResponse): string[]` em `balloon_composer.ts` usando citações `> *Título*`, listas `- *Item:* Valor`, zero emojis decorativos, zero tabelas Markdown e zero NBSP.
    - Atualizar `public_response_guard.ts` para proteger os nomes das novas tabelas `tempario_*` e a tool `consultar_tempario_hibrido`.

---

### Fase 6: Suíte TDD Completa e Build Gate

- [x] `[LEAD]` **Task 6.1: Implementar e Executar `src/hydra-sync/tests/test_harness_tempario.ts`**
  - **Arquivo:** `src/hydra-sync/tests/test_harness_tempario.ts`
  - **7 Asserções Contratuais Obrigatórias:**
    1. **T01 (Travessia Ordenada CTE):** `Trocar Farol Esquerdo (VW Golf 1.4 TSI 2020)` resolve as 6 sub-operações na sequência exata (`DESMONTAGEM` $\rightarrow$ `EXECUCAO` $\rightarrow$ `REMONTAGEM` $\rightarrow$ `TESTE_AJUSTE`) em $< 5\text{ms}$.
    2. **T02 (Deduplicação `DEPENDE_ACESSO`):** `Trocar Farol Esquerdo + Trocar Radiador` contabiliza a remoção (`0,40h`) e reinstalação (`0,35h`) do para-choque apenas 1 vez, comprovando economia matemática exata de `0,75h` (`45 min`).
    3. **T03 (Cache L1 Multi-Fatorial):** Segunda consulta idêntica retorna `isCacheHit === true` em $< 5\text{ms}$, e invalida se mudar `persona` ou `lojaSlug`.
    4. **T04 (Cruzamento Pátio + Isolamento Gerente):** Sócio vê média das OSs da rede; Gerente vê apenas OSs da sua `activeLojaSlug` e recebe bloqueio (`SecurityAccessDeniedError` / `CROSS_STORE_FORBIDDEN`) se pedir outra unidade.
    5. **T05 (Anti-Alucinação & Quarentena):** Consulta de serviço não homologado retorna `statusEvidenciaGlobal === 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'`, não inventa seção/página OEM e grava apenas em `tempario_external_estimates_staging`.
    6. **T06 (Isolamento de Intenção e Anti-Colisão Ano/OS):** Frase *"qual o tempo de mão de obra pra trocar farol do golf 2020"* resolve `TEMPARIO_TEMPO_SERVICO` (e `parseOSModuleIntent` retorna `null`), enquanto *"qual o CMV da rede"* e *"detalhes da OS 1916"* permanecem intocados.
    7. **T07 (Padrão Hermes & PublicResponseGuard):** O balão composto passa em `validateAndSanitizePublicResponse()` com `isSafe === true`, zero emojis decorativos, zero `**`, zero `|---|` e zero `\u00A0`.

- [x] `[LEAD]` **Task 6.2: Build Gate Determinístico**
  - **Comandos:**
    - `npx tsc -p tsconfig.tempario.json` (validação de contratos e tipos dos módulos novos e modificados com zero erros)
    - `npx tsx src/hydra-sync/tests/test_harness_tempario.ts` (7/7 asserções aprovadas com exit code 0)
  - **Critério de Aceite:** Compilação limpa (exit code 0) e 7/7 testes passando.

---

## 3. Checklist de Segurança Pré-Deploy na VPS (`100.126.50.101`)

- [ ] **Zero Novos Containers:** Nenhum container Docker ou serviço externo adicionado.
- [ ] **Integridade da Release (`hydra-deploy`):** Nenhum arquivo `.bak*` deixado dentro da árvore de release gerenciada pelo `sync.py`.
- [ ] **Trava Inviolável de WhatsApp:** Qualquer envio em produção ou teste utiliza exclusivamente as instâncias `hydra` ou `atendimento` (jamais instâncias de gerentes de loja).
