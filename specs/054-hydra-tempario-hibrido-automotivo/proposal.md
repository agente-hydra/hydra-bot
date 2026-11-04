# Spec 054 — Proposta Refinada: Tempário Híbrido Automotivo (RAG Vetorial + Grafo de Dependências + Tempo Real de Pátio)

**ID da Spec:** `054-hydra-tempario-hibrido-automotivo`  
**Versão:** 2.0 (Refinada após inspeção integral de 26 módulos de `src/hydra-sync/`)  
**Data:** 03/11/2026  
**Status:** PROPOSTA / RFC PRONTA PARA VALIDAÇÃO  
**Autores:** DeepMind Agentic Pair (Antigravity) & Engenharia Operacional Hydra  
**Repositório:** `hydra-bot` (`C:\Users\User\Desktop\agy`)  
**Stack:** TypeScript 5.x Strict (zero `any`, zero `@ts-ignore`), Node.js 22 LTS, `better-sqlite3` (WAL mode), `sqlite-vec` (384d), `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2`)  
**Host de Produção:** VPS Local On-Premise (`100.126.50.101` via Tailscale), Ubuntu 24.04 LTS

---

## 1. Contexto e Problema Operacional

A Rede Mecânica Popular opera 10 unidades físicas elegíveis (`MPdompedro1`, `MPJabaquara`, `MPJorgeBeretta`, `MPkennedy`, `ReiDoOleoMaua`, `MPpiraporinha`, `MPplanalto`, `ReiDoModulo`, `MPrudge`, `MPSantoAndre`, expurgando a unidade administrativa `MPMaster`). Diariamente, gerentes, consultores técnicos e sócios precisam dimensionar tempos de mão de obra (tempário) para orçamentos, programação de box e auditoria de produtividade.

A inspeção da arquitetura atual em `src/hydra-sync/` revelou quatro lacunas críticas que impedem consultas técnicas de tempário:

1. **Ausência de Catálogo Estruturado e Variação por Motorização:** Não existe no SQLite operacional (`hydra_ops.db`) modelagem de tempos padrões de reparação por veículo/motor/ano. Orçamentos de mão de obra dependem de estimativas verbais empíricas, gerando divergências de cobrança entre unidades da mesma rede para o mesmo serviço.
2. **Cálculo Cego sem Grafo de Acesso (`DEPENDE_ACESSO`):** Procedimentos mecânicos possuem cadeias de pré-requisitos físicos (desmontagem $\rightarrow$ intervenção $\rightarrow$ remontagem $\rightarrow$ calibração). Quando um cliente solicita dois serviços simultâneos no mesmo veículo — ex.: *Substituição do Farol Esquerdo* + *Substituição do Radiador* em um *VW Golf 1.4 TSI 2020* —, ambos exigem remover e reinstalar o para-choque dianteiro (`0,60h` desmontagem + `0,40h` remontagem). Sem resolução em grafo com deduplicação de nós compartilhados, o orçamento soma os dois tempos brutos e cobra o acesso em duplicidade.
3. **Desconexão entre Tempo Tabelado (OEM) e Tempo Real de Pátio (`ordens_servico`):** O banco operacional já coleta todas as Ordens de Serviço das 10 lojas via `os_deep_inspector.ts` (com `itens`, `data_inicio_iso`, `data_fim_iso`, `dias_no_patio`, `historico_criado_em`, `historico_atualizado_em`) e analisa causas reais de atraso em conversas (`hydra_case_current_position` e `hydra_afirmacoes_analisadas`). Contudo, não há cruzamento entre as horas teóricas de manual e o tempo real que o serviço leva nas oficinas da rede.
4. **Riscos Reais de Colisão no Roteador Atual (`agent_dispatcher.ts` e `intent_rewriter.ts`):**
   - Na linha 71 de `src/hydra-sync/agent_dispatcher.ts`, `parseOSModuleIntent()` captura qualquer número de 3 a 8 dígitos (`\b(\d{3,8})\b`) acompanhado de `/\b(servico|servicos|mao de obra)\b/` e o interpreta como consulta à aba de serviços de uma OS aberta. Uma pergunta como *"qual o tempo de mão de obra pra trocar farol do golf 2020?"* faria match no ano `2020` como se fosse a `OS #2020`!
   - Na linha 147 de `src/hydra-sync/manager_store_access.ts`, o conjunto `allowedIntents` para a persona `gerente` bloqueia qualquer intenção fora da lista fixa (`financial_alerts`, `store_overview`, `store_cmv`, `store_areas`, `list_os`, `os_detail`, `aging_cars`), barrando gerentes de consultarem o tempário se a nova intenção não for devidamente integrada.

---

## 2. Diretriz Arquitetural Inegociável: Zero Inchaço na VPS

Em respeito absoluto à infraestrutura local e às regras de `.agent/memory/infra.md`:
- ⛔ **PROIBIÇÃO CATEGÓRICA:** É terminantemente proibido introduzir Neo4j, Qdrant, Milvus, ChromaDB, Redis dedicado para cache de tempário, containers Docker extras, FastAPI ou microserviços Python.
- ✅ **100% NATIVO EM TYPESCRIPT / NODE.JS + SQLITE WAL:**
  - **Grafo Relacional Nativo:** Tabelas normalizadas no `db_repository.ts` com travessia multi-salto e deduplicação via `WITH RECURSIVE` nativo do SQLite 3.45+ (latência $< 5\text{ms}$).
  - **Busca Vetorial e Léxica Local:** Reaproveitamento direto do singleton `getEmbedder()` de `src/hydra-sync/embeddings.ts` (`Xenova/all-MiniLM-L6-v2`, 384 dimensões, quantizado, CPU-only), tabela virtual `sqlite-vec` (`vec_tempario_chunks`) nos moldes de `contas_pagar_vector.ts` + FTS5 (`tempario_fts` com `unicode61 remove_diacritics 2`) + fusão via Reciprocal Rank Fusion (RRF $k=60$) em `hybrid_retrieval.ts`.
  - **Swap Atômico em Reindexações:** Seguindo o padrão de `reindexar_vetores.ts`, atualizações em lote de embeddings de manuais utilizam tabela staging e transação atômica.

---

## 3. Solução Proposta: Os 6 Pilares Integrados

### Pilar 1: Grafo Automotivo Polimórfico e Deduplicação via CTE (`tempario_graph_repository.ts`)
- Modelagem de nós (`tempario_vehicles`, `tempario_engines`, `tempario_operations`, `tempario_suboperations`, `tempario_evidence_sources`) e arestas polimórficas (`tempario_dependencies_edges`) suportando relações:
  - `TEM_SUBOP`: Operação principal $\rightarrow$ Sub-operação etapa.
  - `DEPENDE_ACESSO`: Sub-operação/Operação $\rightarrow$ Sub-operação pré-requisito física (encadeável em múltiplos níveis com guarda anti-ciclo).
  - `USAR_FERRAMENTA`: Requisito de ferramental específico por etapa.
  - `VARIA_POR_MOTOR`: Especialização de tempo/etapa conforme código de motor (`EA211`, `EA888`, `CSSA`, etc.).
  - `FONTE_EVIDENCIA`: Vínculo auditável com o documento técnico de origem.
- O CTE recursivo resolve a árvore completa de dependências, separa fases (`DESMONTAGEM`, `EXECUCAO`, `REMONTAGEM`, `TESTE_AJUSTE`) e **deduplica por `subop_id`** quando múltiplos serviços são consultados para o mesmo veículo, calculando o **Tempo Tabelado Bruto**, o **Tempo Economizado por Acesso Compartilhado** e o **Tempo Tabelado Líquido**.

### Pilar 2: RAG Híbrido Local — Vetor + FTS5 + Grafo (`tempario_vector.ts` + `hybrid_retrieval.ts`)
- Indexação de chunks de manuais OEM, boletins de serviço (TSBs) e procedimentos homologados em `tempario_procedure_chunks`, `tempario_fts` e `vec_tempario_chunks`.
- Combinação de busca exata SQL (marca, modelo, ano, motor), busca lexical FTS5 (sanitizada via `escapeFtsQuery`) e busca semântica KNN (`sqlite-vec` 384d) unificadas por **Reciprocal Rank Fusion (RRF $k=60$)**.
- Degradação graciosa: se `sqlite-vec` ou o pipeline `@huggingface/transformers` estiver indisponível em algum ambiente de teste, o motor opera transparentemente via FTS5 + Grafo SQL sem quebrar a consulta.

### Pilar 3: Cruzamento Factual com Tempo Real de Pátio (`operational_data_repository.ts`)
- Integração com a tabela `ordens_servico` e com o grafo de casos (`hydra_case_current_position` / `hydra_afirmacoes_analisadas`):
  - **Tempo Tabelado Líquido (Manual/OEM):** Soma em horas e minutos das etapas deduplicadas de mão de obra.
  - **Métricas Reais de Oficina (Histórico OSs da Rede):**
    1. *Tempo de Execução Observado (quando houver timestamps intradiários em `raw_payload`)* e *Lead Time Médio de Pátio* (calculado de forma segura sobre `data_inicio_iso` e `data_fim_iso` via `parseBrDateToIso`, nunca aplicando `julianday()` direto em strings `DD/MM/YYYY`).
    2. *Gargalos Operacionais Comprovados:* Cruzamento com `delay_cause_reported` das análises de conversa daquelas OSs, respeitando a cláusula pétrea de `EvidencePolicyManager.evaluateDelayCause` (proibido supor falta de mecânico ou peça sem evidência registrada).

### Pilar 4: Orquestração Cache-First + Fallback Seguro Anti-Alucinação (`tempario_hybrid_coordinator.ts`)
- **Passo 1 (Cache L1 Multi-Fatorial):** Consulta a `ConversationCacheManager` com chave composta incluindo veículo, motor, lista ordenada de operações, escopo de loja (`persona` + `lojaSlug`), `generationId` e versão do catálogo. Hit responde em $< 5\text{ms}$.
- **Passo 2 (Busca Híbrida Local):** Se confiança combinada $\ge 0.75$ e houver operação `HOMOLOGADO_OEM` ou `HISTORICO_OS_REDE`, compõe resposta imediata com citação literal da fonte cadastrada.
- **Passo 3 (Fallback Controlado & Quarentena de Proveniência):** Se confiança $< 0.75$:
  - Aciona decomposição estruturada assistida com validação estrita via `EvidencePolicyManager`.
  - **Cláusula Anti-Alucinação:** É terminantemente proibido inventar códigos de manual OEM, números de seção, grupos Elwin/ElsaPro ou páginas inexistentes em `tempario_evidence_sources`.
  - O resultado recebe compulsoriamente `statusEvidencia: 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'` e é persistido em tabela segregada de quarentena (`tempario_external_estimates_staging`), além de registrar nota de curadoria no Vault (`vault_manager.ts`) e auditoria em `evidence_repository.ts`, **jamais contaminando** as tabelas homologadas.

### Pilar 5: Roteamento Semântico Blindado e Tool MCP (`intent_rewriter.ts`, `agent_dispatcher.ts`, `mcp_server.ts`)
- Registro de termos técnicos no `semantic_glossary.ts` e na ontologia (`ontology_catalog.ts`).
- Detecção da intenção `TEMPARIO_TEMPO_SERVICO` em `intent_rewriter.ts` e `semantic_plan_builder.ts`.
- **Trava Anti-Colisão em `agent_dispatcher.ts`:** A função `parseOSModuleIntent()` recebe guarda explícita `!isTemparioQuery(norm)` para que anos de veículos (`2018`, `2020`, `2024`) junto ao termo `"mão de obra"` jamais sejam confundidos com número de OS.
- **Isolamento contra Financeiro e Pátio:** Perguntas financeiras (`isExplicitFinancialQuery`: CMV, faturamento, metas, contas a pagar, juros Rede) mantêm precedência absoluta. Consultas de tempário são 100% read-only sobre o estado das OSs abertas.
- **Governança de Loja e Persona (`manager_store_access.ts` e `identity_access_guard.ts`):**
  - Sócios (`persona: 'socio'`) enxergam o tempo médio real consolidado das 10 lojas da rede (ou de uma loja específica se filtrada).
  - Gerentes (`persona: 'gerente'`) têm acesso liberado à consulta técnica do tempário OEM, mas o histórico comparativo de OSs de pátio é estritamente filtrado por `WHERE loja_slug = :activeLojaSlug` via `enforceManagerScope()`, impedindo vazamento cross-store.
- **Tool MCP (`mcp_server.ts`):** Nova ferramenta `consultar_tempario_hibrido` instrumentada com `ToolExecutionTracker`.

### Pilar 6: Formatação WhatsApp Nativa no Padrão Hermes (`balloon_composer.ts` + `whatsapp_formatter.ts` + `public_response_guard.ts`)
- Adequação rigorosa às regras já vigentes no repositório:
  - **Política Zero Emoji Decorativo (`purgeDecorativeEmojis` em `public_response_guard.ts`):** Zero emojis de enfeite (`🔧`, `🚗`, `⏱️`); uso exclusivo da gramática nativa do WhatsApp: citações de bloco (`> *Título*`), listas com hífen (`- *Campo:* Valor`) e negrito simples (`*texto*`).
  - **Zero Tabelas Markdown e Zero NBSP:** Proibido emitir tabelas `| col | col |`, asteriscos duplos `**` ou espaços não-quebráveis `\u00A0` / `\u202F`.
  - **Selo de Proveniência Humanizado:** Tradução de enums internos para rótulos executivos limpos antes de passar pelo `validateAndSanitizePublicResponse()`.

---

## 4. Escopo (In-Scope vs. Out-of-Scope)

| Em Escopo (In-Scope) | Fora de Escopo (Out-of-Scope) |
| :--- | :--- |
| Tabelas do Grafo Automotivo e CTE Recursivo de deduplicação no SQLite (`hydra_ops.db`) | Containers Docker externos (Neo4j, Qdrant, Milvus, Redis dedicado, FastAPI/Python) |
| Busca híbrida RRF (Vetor 384d `sqlite-vec` + FTS5 + SQL Exato) | Alteração ou criação de Ordens de Serviço no ERP Oficina Inteligente |
| Cruzamento com histórico de OSs encerradas (`ordens_servico`) e gargalos do grafo de conversas | Precificação automática de peças ou consulta externa a catálogos pagos em tempo real sem cache |
| Coordenador Cache-First + Quarentena `ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO` | Uso de instâncias WhatsApp de gerentes como remetentes (exclusivo `hydra` e `atendimento`) |
| Proteção anti-colisão em `agent_dispatcher.ts`, `intent_rewriter.ts` e escopo em `manager_store_access.ts` | Modificação nas rotinas de Juros Rede, Conciliação Pátio x Rede ou Contas a Pagar |

---

## 5. Riscos Principais e Mitigações

| Risco Identificado | Severidade | Mitigação Arquitetural |
| :--- | :---: | :--- |
| **R1. Colisão de Ano do Veículo com Número de OS em `parseOSModuleIntent`** (ex: "mão de obra farol golf 2020" interpretado como OS #2020) | ALTA | Guarda determinística `isTemparioIntentCandidate(text)` avaliada antes de `parseOSModuleIntent` em `agent_dispatcher.ts`, exigindo verbos/substantivos de tempário (`quanto tempo`, `tempário`, `horas de mão de obra`, `sub-operações`, `etapas para trocar`). |
| **R2. Ciclos Infinitos em Arestas `DEPENDE_ACESSO` no CTE Recursivo** | ALTA | Controle explícito de caminho visitado (`path_visited`) na cláusula `WHERE instr(sc.path_visited, '|' || e2.to_subop_id || '|') = 0` aliado a teto rígido `sc.profundidade < 12`. |
| **R3. `julianday()` Retornando `NULL` em Datas Brasileiras `DD/MM/YYYY`** | ALTA | Uso exclusivo das colunas ISO indexadas (`data_inicio_iso`, `data_fim_iso`) e do helper `parseBrDateToIso` já existente em `db_repository.ts`. |
| **R4. Contaminação de Dados Homologados OEM por Inferências Externas** | CRÍTICA | Persistência de inferências (`confiança < 0.75`) estritamente na tabela isolada `tempario_external_estimates_staging`, com proibição por constraint `CHECK` de promover para `HOMOLOGADO_OEM` sem revisão. |
| **R5. Bloqueio ou Redação Indevida pelo `public_response_guard.ts`** | MÉDIA | Formatação do balão sem emojis decorativos, sem nomes de tabelas SQLite e sem constantes internas cruas, registrando `consultar_tempario_hibrido` nas regras de sanitização. |

---

## 6. Critérios de Aceite Determinísticos

1. **[AC-01] Travessia e Ordenação Topológica via CTE:** Para `Trocar Farol Esquerdo (VW Golf 1.4 TSI 2020)`, o CTE recursivo retorna as 6 etapas na sequência física exata (Desmontagem $\rightarrow$ Execução $\rightarrow$ Remontagem $\rightarrow$ Ajuste) em $< 5\text{ms}$.
2. **[AC-02] Deduplicação Matemática de Acesso Compartilhado:** Na consulta combinada `Trocar Farol Esquerdo + Trocar Radiador (VW Golf 1.4 TSI 2020)`, as sub-operações compartilhadas de remoção (`0,60h`) e reinstalação (`0,40h`) do para-choque dianteiro são somadas uma única vez, reportando explicitamente a economia de `1,00h` (`60 min`).
3. **[AC-03] Busca Híbrida RRF (Vetor + FTS5 + Grafo):** Consultas em linguagem natural de oficina (*"quanto tempo leva pra trocar farol e radiador do golf tsi 2020"*) atingem score de confiança $\ge 0.75$ e resolvem os nós corretos.
4. **[AC-04] Cruzamento Factual com Pátio e Isolamento Cross-Store:** Retorna simultaneamente o Tempo Tabelado Líquido e a métrica histórica das OSs reais (filtrada por `activeLojaSlug` se `persona === 'gerente'`, ou consolidada das 10 lojas elegíveis se `persona === 'socio'`).
5. **[AC-05] Anti-Alucinação de Fonte:** Quando um serviço não possui fonte `HOMOLOGADO_OEM`, o coordenador jamas inventa seção/página de manual; marca como `ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO` e grava apenas em staging/quarentena.
6. **[AC-06] Isolamento Semântico Total:** Consultas de tempário não interceptam perguntas de CMV/Faturamento/Contas a Pagar nem disparam `parseOSModuleIntent` para anos de veículos (`2015`–`2026`).
7. **[AC-07] Conformidade Hermes & PublicResponseGuard:** Balões gerados passam em `validateAndSanitizePublicResponse()` com `isSafe === true`, zero emojis decorativos, zero tabelas Markdown (`|---|`), zero `**` e zero `\u00A0`.
