# Spec Plan — Hydra: Recorrência Linea: Runtime e Reparação Conversacional

**Versão:** 1.0  
**Data:** 05 de Outubro de 2026  
**Status:** PLANO DE IMPLEMENTAÇÃO (SDD Plan)  
**ID da Spec:** `hydra-linea-runtime-repair`  
**Destinatários:** Agente Principal (E0), Executor 1 (E1), Executor 2 (E2) e Executor 3 (E3)

---

## 1. Atribuição de Arquivos e Dono Único

Para assegurar isolamento estrito, evitar edições concorrentes e garantir rastreabilidade, a titularidade de cada arquivo é rigidamente distribuída:

| Executor / Papel | Worktree e Branch de Trabalho | Arquivos de Domínio Exclusivo | Escopo Principal |
|---|---|---|---|
| **E0 — Principal** (Coordenação) | Central (`hydra-staging`) | `src/hydra-sync/types/conversation_context_contract.ts`<br>`tests/repro_linea_failure_harness.ts` | Congelar contratos estritos; inventário do release; harness de reprodução isolada que comprova a falha antes da correção; gate de release. |
| **E1 — Executor 1** (Interpretação e Semântica) | `/home/operacional/hydra-query-e1`<br>`feat/linea-e1-interpretation` | `src/hydra-sync/intent_rewriter.ts`<br>`src/hydra-sync/conversation_semantic_resolver.ts`<br>`src/hydra-sync/tests/test_executor1_interpretation_repair.ts` | Reescrita de intenção, detecção de reparação conversacional (*"não foi isso"*, *"nn foi isso"*), eliminação de preenchimentos (*"cara"*, *"mano"*), desambiguação de histórico e preservação de `DELAY_REASON`. |
| **E2 — Executor 2** (Dados e Memória) | `/home/operacional/hydra-query-e2`<br>`feat/linea-e2-case-data` | `src/hydra-sync/turn_context_repository.ts`<br>`src/hydra-sync/operational_data_repository.ts`<br>`src/hydra-sync/real_analysis_repository.ts`<br>`src/hydra-sync/case_memory_reader.ts`<br>`src/hydra-sync/tests/test_executor2_case_data.ts` | Persistência aditiva de `TurnPendingRequest` no SQLite; busca SQL parametrizada de veículos por modelo e loja (sem corte em `rows[0]`); consumo de análises persistidas e fallback quando projeção de grafo ausente. |
| **E3 — Executor 3** (Dispatcher e Fallback) | `/home/operacional/hydra-query-e3`<br>`feat/linea-e3-dispatcher-fallback` | `src/hydra-sync/agent_dispatcher.ts`<br>`src/hydra-sync/agent_dispatcher_cli.ts`<br>`src/hydra-sync/operational_adapter.ts`<br>`src/hydra-sync/hybrid_os_coordinator.ts`<br>`src/hydra-sync/public_response_guard.ts`<br>`src/hydra-sync/tests/test_harness_linea_repair.ts` | Prioridade de reparação conversacional no dispatcher antes de histórico/saudação; remoção de default hardcoded `'linea'` e fixtures; blindagem de fallback contra pátio agregado; execução da suíte R01 a R18. |

---

## 2. Tarefas Atômicas de Implementação

### Fase E0: Agente Principal — Baseline, Contratos e Reprodução da Falha
- [x] **[E0-01]** Registrar o inventário de release da VPS (`/opt/bots/src/hydra-sync/`), identificando SHA-256 e resolução de runtime (.ts/.js por tsx).
- [x] **[E0-02]** Congelar o contrato compartilhado em `src/hydra-sync/types/conversation_context_contract.ts` contendo `TurnPendingRequest`, `VehicleResolutionResult`, `CandidateVehicle`, `CandidateOrder`, `CaseContextResult` e `ExtendedTurnState` (strict mode, zero `any`).
- [x] **[E0-03]** Criar o teste de reprodução isolada (`tests/repro_linea_failure_harness.ts`) reproduzindo comprovadamente as 6 falhas observadas na sequência real (T1 a T6) contra a árvore servida, sem envio de WhatsApp e sem escrita no banco operacional.

---

### Fase E1: Executor 1 — Interpretação, Reparação e Semântica
- [x] **[E1-01]** Escrever testes unitários em `src/hydra-sync/tests/test_executor1_interpretation_repair.ts` cobrindo a colisão exata de *"nao foi isso que perguntei cara"*, as variantes *"nn foi isso que pedi"*, *"não era isso"* e correções com novos alvos.
- [x] **[E1-02]** Em `intent_rewriter.ts`, aprimorar `isCorrection` e `correctionPrefixRegex`:
  - Reconhecer gírias como `"nn"`, `"n"`, `"nao era isso"`, `"nao foi isso que pedi"`.
  - Descartar preenchimentos vazios (`"cara"`, `"mano"`, `"por favor"`), impedindo que sejam tratados como nova consulta substantiva.
- [x] **[E1-03]** Em `intent_rewriter.ts`, corrigir a detecção de histórico (`isConversationHistory`):
  - Substituir `norm.includes('o que perguntei')` por boundary estrito de expressão completa (`/\b(o que eu perguntei|minha pergunta anterior|resumo das perguntas)\b/i`), eliminando a colisão com *"isso que perguntei"*.
- [x] **[E1-04]** Em `intent_rewriter.ts` e `conversation_semantic_resolver.ts`, implementar preservação do pedido pendente (`TurnPendingRequest`):
  - Em perguntas elípticas ou de seguimento (*"e por que ele está parado?"*), herdar o veículo e loja do turno pendente e classificar a operação como `DELAY_REASON`.
- [x] **[E1-05]** Preservar operações de agregação legítimas:
  - Garantir que *"quantos Linea temos?"* vire `VEHICLE_COUNT`, *"liste os Linea"* vire `VEHICLE_LIST` e *"como está o Jabaquara hoje?"* vire `STORE_SUMMARY`, sem converter modelo em situação individual de forma cega.
- [x] **[E1-06]** Executar os testes em `hydra-query-e1` comprovando 100% de aprovação e gerar o patch `patch-executor1-linea-interpretation.diff`.

---

### Fase E2: Executor 2 — Estado de Turno, Dados ERP e Memória do Caso
- [x] **[E2-01]** Em `turn_context_repository.ts`, implementar migração aditiva para `pending_request_json`:
  - Salvar e recuperar `TurnPendingRequest` vinculado ao telefone e geração ativa (`memory_generation`).
  - Limpar o pedido pendente em caso de comando `/reset` ou mudança explícita de assunto pelo operador.
- [x] **[E2-02]** Em `operational_data_repository.ts`, implementar busca SQL parametrizada de veículos:
  - Query: `SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio FROM ordens_servico WHERE loja_slug = ? AND veiculo LIKE ?`.
  - Discriminar explicitamente: `RESOLVED` (1 carro), `AMBIGUOUS_VEHICLE` (> 1 carro com retorno de placas), `NO_MATCH` (0 carros) e `UNAVAILABLE` (erro de banco). Proibido usar `rows[0]`.
- [x] **[E2-03]** Em `real_analysis_repository.ts` e `case_memory_reader.ts`, conectar a leitura de análises canônicas persistidas:
  - Validar se a OS consultada consta em `analysis.coveredOsIds` e se a loja é idêntica.
  - Se a análise cobrir a OS, extrair motivo documentado de demora (`documentedDelayReason`) e próximo passo.
  - Se não cobrir ou ausente, retornar `coverage = 'PARTIAL_ERP_ONLY'` ou `'NOT_IN_ANALYSIS'`.
- [x] **[E2-04]** Conectar a leitura da projeção de grafo de atendimentos quando válida e íntegra, com fallback transparente para a análise canônica e dados diretos do ERP.
- [x] **[E2-05]** Executar a suíte `src/hydra-sync/tests/test_executor2_case_data.ts` em `hydra-query-e2` comprovando 100% de aprovação e gerar o patch `patch-executor2-linea-data.diff`.

---

### Fase E3: Executor 3 — Dispatcher, Fallback Seguro e Matriz R01–R18
- [x] **[E3-01]** Em `agent_dispatcher.ts`, reestruturar a ordem de avaliação:
  - Posicionar a reparação de contexto (`isCorrection`) **antes** de histórico, saudação e ajuda genérica.
  - Ao detectar *"não entendi"*, verificar se há turno recente com falha ou ambiguidade para detalhar o alvo pendente, em vez de cuspir o menu genérico de capacidades da rede.
  - Ao detectar perguntas de disponibilidade (*"ia ta ativa?"*), responder afirmação de presença **sem** limpar nem sobrescrever o `TurnPendingRequest` do veículo em foco.
- [x] **[E3-02]** Em `agent_dispatcher.ts` e `hybrid_os_coordinator.ts`, retirar o default hardcoded `'linea'` (`vehicleModel || 'linea'`) e eliminar o catálogo de fixtures em produção. Se modelo não for informado, buscar pela placa ou OS real.
- [x] **[E3-03]** Em `agent_dispatcher.ts`, encaminhar `DELAY_REASON` e `questionType` ao coordenador e unificar a conclusão de turno com registro de telemetria, idempotência e gravação de histórico.
- [x] **[E3-04]** Em `operational_adapter.ts`, blindar os fallbacks de pátio e busca operacional:
  - A palavra `"parado"` só pode ativar `get_aging_cars` se a consulta for expressamente agregada e NÃO houver veículo individual ou OS em contexto.
  - O fallback de `retrieve_operational_data` com veículo em foco deve buscar o carro específico, proibindo a listagem cega das 5 primeiras OSs da rede.
- [x] **[E3-05]** Construir a suíte integrada `src/hydra-sync/tests/test_harness_linea_repair.ts` cobrindo rigorosamente todos os 18 cenários da **Matriz de Aceite R01 a R18**, incluindo a sequência encadeada completa T1→T2→T3→T4→T5→T6 em sessão única.
- [x] **[E3-06]** Executar testes na worktree `hydra-query-e3` comprovando 100% de aprovação e gerar o patch `patch-executor3-linea-dispatcher.diff`.

---

### Fase E4: Agente Principal — Consolidação, Build Gate e Promoção Segura
- [x] **[E4-01]** Aplicar os patches dos 3 executores na worktree de integração `hydra-staging`.
- [x] **[E4-02]** Executar o build gate estrito de TypeScript em staging: `npx tsc --project tsconfig.hydra.json --noEmit` (0 erros tolerados).
- [x] **[E4-03]** Executar a suíte integrada R01–R18 e os testes de regressão (L01–L25, T01–T28, M01–M18) em staging.
- [x] **[E4-04]** Criar backup timestamped em `/opt/bots/src/hydra-sync_backup_$(date +%Y%m%d_%H%M%S)`.
- [x] **[E4-05]** Promover os arquivos homologados para `/opt/bots/src/hydra-sync/` e recarregar o processo com `pm2 reload hydra-bot`.
- [x] **[E4-06]** Homologar via CLI servido na VPS a sequência real T1 a T6 com respostas factuais, ausência total de gírias e zero emojis espúrios.

---

## 3. Circuit Breaker & Hard Stop

> **[HARD STOP OBRIGATÓRIO — SDD PROPOSAL]**  
> A especificação técnica e o plano de implementação estão formalizados e prontos para distribuição nos três documentos:  
> - [`proposal.md`](file:///C:/Users/User/Desktop/agy/specs/hydra-linea-runtime-repair/proposal.md)  
> - [`design.md`](file:///C:/Users/User/Desktop/agy/specs/hydra-linea-runtime-repair/design.md)  
> - [`spec-plan.md`](file:///C:/Users/User/Desktop/agy/specs/hydra-linea-runtime-repair/spec-plan.md)  
>   
> Nenhum código da aplicação, banco de dados ou serviço em produção foi alterado nesta fase de proposta.  
> Conforme o protocolo do ciclo SDD e a sua orientação explícita, a execução será distribuída e executada pelos **três agentes especialistas existentes**.  
> Para autorizar e iniciar a implementação com os 3 executores, utilize o comando:  
> `/vibe-apply hydra-linea-runtime-repair`
