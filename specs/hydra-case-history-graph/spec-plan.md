# Plano de Execução: Hydra — Histórico de Análises e Grafo de Atendimentos

**ID da Spec:** `hydra-case-history-graph`  
**Data:** 05/10/2026  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA COM 100% DE SUCESSO (3 EXECUTORES + PRINCIPAL)  
**Circuit Breaker:** HARD STOP ATIVO (AGUARDANDO APROVAÇÃO E CONSOLIDAÇÃO VIA `/vibe-archive hydra-case-history-graph`)  

---

## 1. Atribuição Estrita de Responsabilidades e Sessões

| Dono / Executor | Identificador de Sessão | Módulos e Arquivos Sob Sua Guarda |
| :--- | :--- | :--- |
| **Principal** | Coordenação Central | `types/conversation_context_contract.ts`<br>`tests/test_case_graph_gates.ts`<br>Supervisão Arquitetural, Contratos e Release. |
| **Executor 1** | `31748010-f0c1-40a8-aa20-bf4182c30263` | `conversation_semantic_resolver.ts`<br>`intent_rewriter.ts`<br>`evidence_policy_manager.ts`<br>`os_situation_composer.ts`<br>`tests/test_executor1_case_content.ts` |
| **Executor 2** | `cfb591cf-4d6a-4536-9d51-5fc8640e7879` | `real_analysis_repository.ts`<br>`analysis_memory_writer.ts`<br>`analysis_projection_outbox.ts`<br>`tests/test_executor2_writer_history.ts` |
| **Executor 3** | `128e3caa-3816-4933-9674-4fdbe7992f91` | `case_graph_projection.ts`<br>`case_current_position.ts`<br>`case_memory_reader.ts`<br>`hybrid_os_coordinator.ts`<br>`agent_dispatcher.ts`<br>`tests/test_executor3_graph_projection.ts` |

---

## 2. Fases de Execução Sequencial

### Fase 0: Principal — Contratos Congelados, Inventário e Elegibilidade
- [x] [PRINCIPAL] **Congelamento de Contratos em `src/hydra-sync/types/conversation_context_contract.ts`:**
  - [x] Implementar `BusinessCaseScope` tipado com discriminação `'ORDER'` vs `'PRE_ORDER'`, incorporando `accountId`.
  - [x] Congelar `AnalysisRevisionIdentity` no formato unívoco `${sourceId}:${accountId}:${conversationId}:${analysisRunId}`.
  - [x] Definir `PartItemReference` com `partName`, `partCode`, `quantityRequested`, `quantityArrived` e `orderRef`.
  - [x] Expandir `ExtractedStatement` com chave primária composta `(revision_id, statement_id)`, `factId` estável, `budgetVersion`, `partReference`, `monetaryCents` inteiro (sem `REAL`), `supersedesFactId` e `messageId: number | null`.
  - [x] Tipar `CaseCurrentPosition` com chave primária `(source_id, loja_slug, os_id)`, `accountId`, mapa de `appliedRevisionsMap`, `approvedBudgetVersion`, `pendingBudgetVersion` e saldo de `activePartDependencies`.
  - [x] Atualizar `CoverageMarker` admitindo `laggingMessageCount: number | 'UNKNOWN'`.
  - [x] Definir `CaseTimelinePage` com paginação estável via `nextCursor` e `snapshotTimestamp`.
  - [x] Especificar a função canônica centralizada de elegibilidade de lojas validando contra o catálogo oficial `OFFICIAL_STORES` (`semantic_glossary.ts:55-67`), rejeitando `MPMaster` e qualquer slug desconhecido.

---

### Fase 1: Executor 1 (`31748010-f0c1-40a8-aa20-bf4182c30263`) — Semântica, Conteúdo Factual e Resposta
- [x] [EXECUTOR 1] Atualizar `src/hydra-sync/conversation_semantic_resolver.ts`:
  - [x] Reconhecer a pergunta *"por que tá parado há tanto tempo?"* como consulta pontual de situação com foco em motivo de atraso (`specificQuestionType: 'DELAY_REASON'`), mantendo o alvo no veículo/OS em contexto.
  - [x] Extrair fatos operacionais com autoria, polaridade, versões de orçamento e quantidades de peças.
  - [x] Mapear perguntas sobre capacidades do assistente para resposta factual transparente.
- [x] [EXECUTOR 1] Atualizar `src/hydra-sync/intent_rewriter.ts`:
  - [x] Preservar estritamente o alvo individual do veículo quando a pergunta contiver qualificadores temporais, proibindo desvio para relatório de retenção geral.
- [x] [EXECUTOR 1] Criar `src/hydra-sync/evidence_policy_manager.ts`:
  - [x] **Cláusula Anti-Alucinação de Causas:** Veto a inferir falta de técnicos, peças ou box a partir de status cadastrais como "NA FILA PARA EXECUÇÃO" ou valor elevado da OS.
  - [x] **Distinção OS vs Pátio:** Separar a idade cadastral da OS (`openedAt`) da permanência física no pátio (que exige evento comprovado de portaria/checklist).
  - [x] Declarar duração ("9 dias") como *"duração não reconciliada com as fontes"* até checagem temporal no ERP sob fuso `America/Sao_Paulo`.
  - [x] **Política de Chegada Parcial e Orçamento:** Receber 1 de 2 peças solicitadas mantém saldo de 1 pendente. Aprovação de orçamento v1 não resolve dependência de orçamento v2.
- [x] [EXECUTOR 1] Atualizar `src/hydra-sync/os_situation_composer.ts`:
  - [x] Compor respostas factuais declarando ausência de causa registrada quando não houver `DELAY_CAUSE_REPORTED`.
  - [x] Formatar o tempo da OS como *"OS aberta há X dias (em DD/MM/AAAA às HH:mm)"*, vetando *"carro no pátio há X dias"*.
  - [x] Exibir saldo de peças pendentes e pendências de versões de orçamento em aberto.
- [x] [EXECUTOR 1] Suíte de testes: `src/hydra-sync/tests/test_executor1_case_content.ts` (100% PASS - 7/7).

---

### Fase 2: Executor 2 (`cfb591cf-4d6a-4536-9d51-5fc8640e7879`) — Migração Segura, Writer Atômico e Outbox
- [x] [EXECUTOR 2] Atualizar `src/hydra-sync/real_analysis_repository.ts`:
  - [x] Implementar a rotina de migração inspecionando dinamicamente `sqlite_schema` e `PRAGMA table_info` com 3 caminhos:
    - **Caminho 1 (Banco Vazio):** Criação direta do schema versão 1 sem executar SELECT sobre tabelas inexistentes.
    - **Caminho 2 (Legado Conhecido):** Mapeamento seguro de colunas existentes de pai (`hydra_analises_atendimento`), afirmações (`hydra_afirmacoes_analisadas`) e lacunas (`hydra_lacunas_conversa`), convertendo chaves para `revision_id = 'legacy:' || analysis_id`. Validação de contagem antes e depois (`count(old) === count(new)`). Proibido `INSERT OR IGNORE` silencioso.
    - **Caminho 3 (Já Migrado):** Idempotência segura via `hydra_schema_migrations`.
  - [x] **Protocolo Obrigatório de Foreign Keys (A2):**
    - Desligar `PRAGMA foreign_keys = OFF;` **fora** de qualquer transação.
    - Executar reconstrução sob `BEGIN IMMEDIATE;`.
    - Validar via `PRAGMA foreign_key_check;` antes do commit (rollback se houver inconsistências).
    - Restaurar `foreign_keys` ao estado inicial no bloco `finally` **fora** da transação.
- [x] [EXECUTOR 2] Criar `src/hydra-sync/analysis_memory_writer.ts`:
  - [x] Persistência de análise, afirmações, lacunas e agendamento de outbox em **transação atômica única**.
- [x] [EXECUTOR 2] Criar `src/hydra-sync/analysis_projection_outbox.ts`:
  - [x] Fila outbox com claim atômico filtrando estritamente `attempts < max_attempts`.
  - [x] Geração de `claim_token = randomUUID()` e lease de 60s.
  - [x] Transição imediata para `status = 'FAILED'` ao atingir `attempts >= max_attempts` (estado terminal visível).
  - [x] Ack de finalização condicionado a `claim_token` correspondente.
- [x] [EXECUTOR 2] Suíte de testes: `src/hydra-sync/tests/test_executor2_writer_history.ts` (100% PASS - 5/5).

---

### Fase 3: Executor 3 (`128e3caa-3816-4933-9674-4fdbe7992f91`) — Grafo, State Reducer e Leitor
- [x] [EXECUTOR 3] Criar `src/hydra-sync/case_graph_projection.ts`:
  - [x] Worker assíncrono consumindo outbox via claim com `claim_token`.
  - [x] Projeção de nós com namespace global `${entity_type}:${source_id}:${account_id}:${loja_slug}:${entity_local_id}` e arestas versionadas.
  - [x] Proteção de posse: se o lease de 60s expirar e outro worker assumir com novo token, o worker antigo descarta a publicação e não grava ack.
- [x] [EXECUTOR 3] Criar `src/hydra-sync/case_current_position.ts`:
  - [x] Implementar o **State Reducer** cumulativo:
    - **Chegada parcial de peças (A4.1):** Subtração de quantidades (`quantityPending = quantityRequested - quantityArrived`); amortecedor continua ativo se chegar apenas 1 de 2.
    - **Versões de orçamento (A4.1):** Aprovação de orçamento v1 grava `approvedBudgetVersion: 'v1'`; pendência de orçamento v2 mantém `pendingBudgetVersion: 'v2'` e aprovação pendente.
    - **Recomposição por mensagem antiga (A4.2):** Nova revisão disparada por edição antiga recompõe todos os fatos do caso, atualizando `appliedRevisionsMap`.
- [x] [EXECUTOR 3] Criar `src/hydra-sync/case_memory_reader.ts`:
  - [x] Leitura em `hydra_case_current_position` com fallback para State Reducer em memória se a projeção estiver atrasada.
  - [x] Paginação estável de linha do tempo com `nextCursor` e `snapshotTimestamp`.
  - [x] Confinamento rigoroso de loja para gerente.
- [x] [EXECUTOR 3] Atualizar `src/hydra-sync/hybrid_os_coordinator.ts` e `agent_dispatcher.ts`:
  - [x] Integrar `CaseMemoryReader` no bot.
  - [x] Aplicar `isOperationalStoreEligible` validando contra o catálogo oficial `OFFICIAL_STORES` (rejeitando `MPMaster` e slugs não cadastrados).
  - [x] Calcular idade da OS via `openedAt` (`America/Sao_Paulo`).
  - [x] Garantir que o comando `/reset` do operador no WhatsApp redefina apenas o turno da conversa, preservando o histórico persistido.
- [x] [EXECUTOR 3] Suíte de testes: `src/hydra-sync/tests/test_executor3_graph_projection.ts` (100% PASS - 4/4).

---

### Fase 4: Homologação Integrada (G01–G15 / H01–H18 / R01–R09 / A1–A4)

Execução da suíte integrada definitiva `src/hydra-sync/tests/test_case_graph_gates.ts`:

| Gate / Teste | Cenário de Teste | Critério Determinístico de Aceite | Status |
| :---: | :--- | :--- | :---: |
| **G01–G15** | Regressões Linea/Jabaquara | Resolução de veículo, isolamento de gerente, zero vazamento cross-store e compatibilidade de dispatcher mantidos. | **APROVADO (23/23)** |
| **H01–H18** | Adendo do Grafo | Grafo relacional indexado, histórico cumulativo, zero leitura bruta de mensageria (H12), cálculo temporal ERP (H17), exclusão de MPMaster (H18). | **APROVADO** |
| **R01** | Chaves compostas SQLite | Zero colisões de `os_id` entre lojas e zero colisões de `fact_id` entre revisões. | **APROVADO** |
| **R09** | Percurso ponta a ponta | Demonstração do ciclo: produtor → writer atômico → outbox com lease → projeção → leitor no bot servido. | **APROVADO** |
| **A1** | Migração multi-caminho | Sucesso garantido em banco vazio (sem `no such table`), banco legado com dados (sem `no such column`) e banco migrado; contagens preservadas. | **APROVADO** |
| **A2** | Protocolo de foreign keys | `foreign_keys = OFF` executado fora da transação; `foreign_key_check` valida integridade com filhos sintéticos; restauração no `finally`. | **APROVADO** |
| **A3** | Limite de tentativas e token | Limite estrito de 5 tentativas respeitado (zero 6ª tentativa); `status = FAILED`; worker pausado perde posse e não confirma job de outro. | **APROVADO** |
| **A4.1** | Saldo de peças e orçamentos | Chegada de 1 de 2 peças mantém saldo de 1 pendente; orçamento v1 aprovado não resolve pendência de orçamento v2. | **APROVADO** |
| **A4.2** | Edição de mensagem antiga | Nova revisão por mensagem editada recompõe o agregado sem descarte temporal. | **APROVADO** |
| **A4.3** | Namespace e catálogo | `node_id` com `accountId` isola contas distintas; validador de elegibilidade rejeita `MPMaster` e slugs não cadastrados. | **APROVADO** |

---

### Fase 5: Principal — Regressões, Build Gate e Release

- [x] [BUILD GATE] Compilação limpa em TypeScript strict:
  - [x] `cmd.exe /c "npx tsc --noEmit"` (Exit Code 0, sem `any`, sem `@ts-ignore`).
- [x] [REGRESSÕES] Execução das suítes herdadas:
  - [x] `test_linea_jabaquara_gates.ts` (100% PASS - 23/23).
  - [x] `test_executor1_case_content.ts` (100% PASS - 7/7).
  - [x] `test_executor2_writer_history.ts` (100% PASS - 5/5).
  - [x] `test_executor3_graph_projection.ts` (100% PASS - 4/4).
  - [x] `test_case_graph_gates.ts` (100% PASS - 26/26).

---

## 3. Circuit Breaker — Hard Stop

> [!CAUTION]
> **PARADA OBRIGATÓRIA (SDD APPLY CONCLUÍDO):**
> Todas as tarefas do plano de execução v2.1 foram implementadas e homologadas localmente com 100% de sucesso através dos três executores e do principal.
> Conforme as regras de governança e operação v7: **PARE. Não commite código de produção.**
> O trabalho de consolidação deve ser realizado mediante o comando do usuário:
> ```bash
> /vibe-archive hydra-case-history-graph
> ```
