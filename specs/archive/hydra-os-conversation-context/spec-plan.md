# Plano de Execução: Hydra — Auditoria e Correção do Incidente Linea/Jabaquara

**ID da Spec:** `hydra-os-conversation-context`  
**Data:** 05/10/2026  
# Plano de Execução: Hydra — Auditoria e Correção do Incidente Linea/Jabaquara

**ID da Spec:** `hydra-os-conversation-context`  
**Data:** 05/10/2026  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA (VERSÃO 2.1 HOMOLOGADA) / CIRCUIT BREAKER ATIVO (AGUARDANDO `/vibe-archive hydra-os-conversation-context`)  
**Designação de Donos Únicos:**  
- **Principal:** Orquestrador Central, Congelamento de Contratos, Verificação de Runtime e Gates G01 a G15.  
- **Executor 1:** Sessão `de5452f5-ae9d-4de2-af64-0b12f075f5ea` (Dono de `conversation_semantic_resolver.ts`, `intent_rewriter.ts` e `os_situation_composer.ts`).  
- **Executor 2:** Sessão `7b9923e9-f4d2-46ff-8a6b-ea932132e04d` (Dono de `real_analysis_repository.ts`, `summary_evidence_adapter.ts`, `operational_adapter.ts` e mapeamento SQL).  
- **Executor 3:** Sessão `5dffcfaf-5e84-438e-81f0-88558655f4c0` (Dono de `hybrid_os_coordinator.ts`, `agent_dispatcher.ts`, `conversation_cache_manager.ts` e testes integrados).  

---

> [!IMPORTANT]
> **CIRCUIT BREAKER DE SDD — HARD STOP ATIVO (PÓS-APPLY):**
> A implementação da revisão v2.1 foi concluída com 100% PASS em todos os 23 Gates/Testes Integrados e zero erros no Build Gate TypeScript strict (`npx tsc --noEmit`).
> Conforme as Regras de Operação v7: **PARE. Não commite. Aguarde `/vibe-archive hydra-os-conversation-context`.**

---

## Fase 0 (E0): Congelamento de Contratos e Tipos Compartilhados (Principal)

- [x] [PRINCIPAL] Atualizar `src/hydra-sync/types/conversation_context_contract.ts`:
  - [x] Tornar `SecurityContext` mandatório em `UnifiedRewriteContext` e `IOperationalDataRepository` (proibir `persona` ou `lojaSlug` opcionais na barreira).
  - [x] Dissociar entidades: definir `CandidateVehicle` (o carro físico) e `CandidateOrder` (o atendimento/OS específico).
  - [x] Definir união discriminada `VehicleResolutionResult` com estados tipados: `RESOLVED`, `AMBIGUOUS_VEHICLE`, `AMBIGUOUS_ORDER`, `NO_MATCH`, `UNAVAILABLE`.
  - [x] Tipar `IOperationalDataRepository` com contexto de segurança obrigatório e paginação.
  - [x] Garantir compilação TypeScript strict (zero `any`, zero `@ts-ignore`).

---

## Fase 1 (E1): Executor 1 — Parser de Modelo, Operações e Reparações Conversacionais

- [x] [EXECUTOR 1] Atualizar `src/hydra-sync/conversation_semantic_resolver.ts`:
  - [x] Extrair modelo do veículo a partir do catálogo real da base e aliases normalizados, mantendo o termo original quando for modelo não catalogado.
  - [x] **Segregação de Operações:** Diferenciar semanticamente `VEHICLE_SITUATION` (*"como tá o Linea"*, *"qq ta acontecendo"*) de `COUNT_VEHICLES` (*"quantos Linea temos?"*), `LIST_VEHICLES` (*"liste os Linea"*) e `FINANCIAL_BY_MODEL` (*"faturamento do Linea"*).
  - [x] **Detector de Reparação:** Reconhecer marcadores de correção (*"não foi isso que eu te pedi"*, *"quero entender o carro"*), desativando a herança de agregações de turnos anteriores.
- [x] [EXECUTOR 1] Atualizar `src/hydra-sync/intent_rewriter.ts`:
  - [x] Unificar assinatura de `rewriteIntent` aceitando `UnifiedRewriteContext` com `securityScope` obrigatório.
  - [x] Preservar o filtro de modelo em planos agregados (contagem, listagem) e individuais, impedindo que a presença da loja apague o veículo.
- [x] [EXECUTOR 1] Atualizar `src/hydra-sync/os_situation_composer.ts`:
  - [x] Compor balão nativo para `AMBIGUOUS_VEHICLE` (múltiplas placas de Linea na loja, sem inventar ano).
  - [x] Compor balão nativo para `AMBIGUOUS_ORDER` (mesmo Linea com múltiplas OSs abertas/histórico).
  - [x] Compor balão nativo para `NO_MATCH` (*"Não encontrei uma ordem de serviço correspondente para o veículo X na unidade Y"*).
  - [x] Compor balão nativo para `UNAVAILABLE` (*"Não foi possível consultar os dados da oficina neste momento (tempo limite)... O pedido foi preservado"*).

---

## Fase 2 (E2): Executor 2 — Busca Operacional Real, Vínculo Estrito e Dimensão de Modelo

- [x] [EXECUTOR 2] Atualizar `src/hydra-sync/operational_data_repository.ts` e repositórios operacionais:
  - [x] Implementar `searchVehiclesByModel` no SQLite real com query parametrizada (`veiculo LIKE ?`), paginação e contagem segura (sem limitar a `rows[0]`).
  - [x] Validar `SecurityContext` antes de qualquer execução SQL (gerente restrito à loja ativa; ausência de contexto lança erro imediato).
  - [x] Manter integridade temporal: não excluir OSs abertas com mais de 30 dias nem OSs encerradas quando solicitadas.
- [x] [EXECUTOR 2] Atualizar `src/hydra-sync/real_analysis_repository.ts` e `summary_evidence_adapter.ts`:
  - [x] Mapear persistência real das análises existentes produzidas pelo Watchdog/IA.
  - [x] **Validação Estrita de Vínculo:** Exigir validação de `lojaSlug`, `coveredOsIds` e período. Se a análise contiver `conversationId` mas não cobrir a OS solicitada, registrar `ConversationGap` do tipo `NOT_IN_ANALYSIS` (zero conclusões sem evidência).

---

## Fase 3 (E3): Executor 3 — Orquestração no Dispatcher, Coordinator e Cache

- [x] [EXECUTOR 3] Atualizar `src/hydra-sync/hybrid_os_coordinator.ts`:
  - [x] Implementar método `inspectVehicle(input, securityScope)` integrando busca de candidatos, desambiguação e união com análises.
  - [x] Implementar busca segura desacoplada de fixtures e integração com `IOperationalDataRepository`.
- [x] [EXECUTOR 3] Integrar no `src/hydra-sync/agent_dispatcher.ts`:
  - [x] Aplicar barreira antecipada de segurança: se gerente tentar acessar outra loja, bloquear imediatamente pré-SQL.
  - [x] Interceptar intenções de veículo individual antes de qualquer rota genérica e despachar para `inspectVehicle`.
  - [x] **Bloqueio Absoluto de Fallback:** Se a busca retornar `NO_MATCH` ou falha técnica, responder através do compositor; **proibido terminantemente emitir raio-X agregado**.
- [x] [EXECUTOR 3] Atualizar `src/hydra-sync/conversation_cache_manager.ts`:
  - [x] Chave de cache segregada por placa e OS: `hydra:os_ctx:v2.1:${lojaSlug}:${osId}:${vehiclePlate}:${persona}:${generationId}:${analysisVersion}:${erpUpdatedAt}`.
  - [x] Invalidar cache do usuário imediatamente após reparação conversacional ou comando `/reset`.
  - [x] Zero chamadas de mensageria incremental no modo padrão.

---

## Fase 4 (E4): Homologação dos Gates de Aceite (G01 a G15) e Regressões

- [x] [GATES] Suíte de testes integrados `src/hydra-sync/tests/test_linea_jabaquara_gates.ts` (23/23 PASS - 100%):
  - [x] **G01:** Primeira frase do incidente (*"fala sobre o linea do jabaquara..."*) responde sobre o veículo; nunca raio-X agregado.
  - [x] **G02:** Correção do incidente (*"uaai nao foi isso..."*) anula contexto anterior e recupera o alvo individual.
  - [x] **G03:** Pergunta subsequente (*"E o que combinaram com ele?"*) usa análise do mesmo veículo/OS.
  - [x] **G04:** Dois Linea na mesma loja apresenta balão de desambiguação com placas; não escolhe `rows[0]`.
  - [x] **G05:** Veículo de outra loja não é exposto para gerente da loja ativa.
  - [x] **G06:** Múltiplas OSs do mesmo veículo ou vários veículos por contato mantém segregação estrita.
  - [x] **G07:** OS aberta há mais de 30 dias ou OS encerrada em histórico não é excluída indevidamente.
  - [x] **G08:** Análise persistida válida sem `registerLink` manual aproveita a análise com vínculo real comprovado.
  - [x] **G09:** Base de análises vazia ou sem dado da OS entrega dados do ERP e declara limitação; zero agregado substituto.
  - [x] **G10:** Modo padrão com análise existente realiza zero chamadas brutas a mensageria e zero reanálises.
  - [x] **G11:** Consulta de resumo da loja (*"Como tá o Jabaquara hoje?"*) continua funcionando normalmente como agregação.
  - [x] **G12:** Typecheck e execução pelo entrypoint real do `agent_dispatcher.ts`.
  - [x] **G13 (Restaurado):** Comprovação da versão realmente carregada no runtime via SHA-256 de integridade.
  - [x] **G14:** `/reset` seguido da frase de correção como primeira consulta funciona sem exigir histórico.
  - [x] **G15:** Novo turno pós-reset não reutiliza cache ou estado da geração anterior.
  - [x] **Testes da Revisão v2.1:**
    - [x] `T_SEC_01A/B/C`: Bloqueio antecipado para gerente sem contexto / contexto ausente recusa acesso.
    - [x] `T_LINK_01`: Análise com `conversationId` incompatível gera `NOT_IN_ANALYSIS` sem atribuir fatos falsos.
    - [x] `T_ERR_01`: Timeout ou erro de banco gera mensagem técnica de indisponibilidade, sem falso "não encontrado".
    - [x] `T_SEM_01`: Contagem (*"quantos Linea"*) e listagem (*"liste Linea"*) mantêm modelo em operações distintas.
    - [x] `T_MODEL_01`: Modelo fora da lista popular preserva termo original e resolve contra base autorizada.
    - [x] `T_AMB_01`: Desambiguação de veículos vs desambiguação de atendimentos.
    - [x] `T_CACHE_01`: Dois Linea com placas distintas residem em chaves independentes de cache sem colisão.
    - [x] `T_SQL_01`: Compilação e execução da query SQL parametrizada com o filtro de modelo.
- [x] [REGRESSÕES] 100% PASS nas suítes unitárias e fases anteriores:
  - [x] `test_os_conversation_context.ts` (20/20 PASS).
  - [x] `test_executor1_semantic_resolver.ts` (18/18 PASS).
  - [x] `test_executor2_sources_evidence.ts` (51/51 PASS).
  - [x] `test_executor3_cache_orchestration.ts` (28/28 PASS).
  - [x] `test_semantic_compiler.ts` (12/12 PASS).

---

## Fase 5 (E5): Build Gate Strict e Manifesto de Release (Principal)

- [x] [BUILD] Validação de compilação: `cmd.exe /c "npx tsc --noEmit"` (Exit Code 0, zero erros, TypeScript strict sem `any`).
- [x] [MANIFESTO] Manifesto de runtime v2.1 gerado com integridade SHA-256 rastreada para todos os 10 módulos core.

---

## Circuit Breaker — Hard Stop

> [!CAUTION]
> **PARADA OBRIGATÓRIA (SDD APPLY CONCLUÍDO):**
> A implementação da spec `hydra-os-conversation-context` (Versão 2.1 — Incidente Linea/Jabaquara) está 100% concluída e homologada.
> Conforme as Regras de Operação v7: **PARE. Não commite.**
> Aguarde o comando de consolidação do usuário:
> ```bash
> /vibe-archive hydra-os-conversation-context
> ```
