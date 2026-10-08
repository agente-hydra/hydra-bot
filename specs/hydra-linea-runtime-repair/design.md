# Design Técnico: Hydra — Recorrência Linea: Runtime e Reparação Conversacional

**ID da Spec:** `hydra-linea-runtime-repair`  
**Data:** 05/10/2026  
**Status:** DESIGN TÉCNICO FORMALIZADO (SDD Design)  

---

## 1. Fluxo de Dados e Ciclo de Vida da Requisição

```text
Mensagem de Entrada (WhatsApp Webhook / CLI)
  │
  ▼
[1. Ingress & Autenticação] (agent_dispatcher.ts)
  │  • Validação do remetente (authorized_users)
  │  • Recuperação do perfil ativo (Sócio vs Gerente)
  │  • Leitura do estado anterior: getLatestTurnState(db, phone, 120)
  │
  ▼
[2. Orquestração de Prioridades de Diálogo] (agent_dispatcher.ts)
  │
  ├── É comando administrativo? (/reset, /perfil, /socio, /{loja})
  │     └── Executa imediatamente (com cancelamento em voo se /reset)
  │
  ├── É reparação conversacional? ("não foi isso", "nn foi isso", "não era isso")
  │     └── [PRIORIDADE ALTA]: Retoma o Pedido Pendente (TurnPendingRequest)
  │           e reexecuta com contexto limpo sem desviar para histórico ou saudação.
  │
  ├── É dúvida de resposta anterior? ("não entendi", "como assim?")
  │     └── Verifica se há resposta anterior recente (< 5 min). Se sim, explica/detalha
  │           o alvo pendente. Se não houver, exibe guia operacional contextual.
  │
  ├── É pergunta de disponibilidade? ("ia ta ativa?", "você tá aí?")
  │     └── Responde status de operação PRESERVANDO o alvo pendente no TurnState.
  │
  └── Fluxo Normal de Reescrita Semântica
        │
        ▼
[3. Reescritor Semântico de Intenção] (intent_rewriter.ts / conversation_semantic_resolver.ts)
  │  • Extrai: vehicleModel, vehiclePlate, osId, lojaSlug, targetArea
  │  • Detecta operação:
  │      - VEHICLE_SITUATION: situação individual do carro ("como tá o linea?")
  │      - DELAY_REASON: motivo documentado da demora ("por que está parado?")
  │      - VEHICLE_COUNT: contagem agregada ("quantos Linea temos?")
  │      - VEHICLE_LIST: listagem de ordens ("liste os Linea")
  │      - STORE_SUMMARY: visão geral da unidade ("como tá o Jabaquara hoje?")
  │  • Fala de preenchimento ("cara", "mano", "por favor") é descartada
  │  • Substrings como "o que perguntei" em "isso que perguntei" NÃO ativam histórico
  │  • Histórico exige pedido afirmativo ("qual foi a primeira pergunta?")
  │
  ▼
[4. Resolução de Candidatos no ERP] (operational_data_repository.ts / operational_adapter.ts)
  │  • Busca parametrizada: SELECT ... FROM ordens_servico WHERE loja_slug = ? AND veiculo LIKE ?
  │  • Avaliação de multiplicidade:
  │      - 0 candidatos -> Retorna NO_MATCH ("Não encontrei OS para o veículo X na unidade Y")
  │      - 1 candidato -> Retorna RESOLVED com OS confirmada
  │      - > 1 candidatos -> Retorna AMBIGUOUS_VEHICLE com lista de placas (SEM rows[0])
  │
  ▼
[5. Consulta de Análises & Memória do Caso] (real_analysis_repository.ts / case_memory_reader.ts)
  │  • Busca análise canônica do atendimento no banco real do serviço
  │  • Verifica cobertura da OS solicitada (analysis.coveredOsIds.includes(osId))
  │  • Projeção do Grafo (se disponível e íntegra)
  │  • Fallback à análise canônica e ERP se grafo indisponível
  │  • Se motivo da demora não documentado: declara limitação honesta (sem alucinar falta de peça)
  │
  ▼
[6. Composição & Blindagem de Resposta] (hybrid_os_coordinator.ts / public_response_guard.ts)
  │  • Monta balão WhatsApp Nativo (> *Título*, - *Campo:* valor, _Dados atualizados em..._)
  │  • Zero asteriscos duplos (**), zero cabeçalhos Markdown (#), zero tags --BLOCK--
  │  • Fallback do operational_adapter: a palavra "parado" em consulta de veículo individual
  │      NUNCA desvia para get_aging_cars nem para lista geral de OSs da rede.
  │  • Persiste novo TurnState com TurnPendingRequest atualizado e idempotência gravada.
```

---

## 2. Contratos Tipados Compartilhados (Strict TypeScript)

Estes contratos devem ser congelados em `src/hydra-sync/types/conversation_context_contract.ts`:

```typescript
/**
 * src/hydra-sync/types/conversation_context_contract.ts
 * Contratos estritos para resolução de veículos, reparação de turno e histórico de caso.
 */

export type OperationType =
  | 'VEHICLE_SITUATION'
  | 'DELAY_REASON'
  | 'VEHICLE_COUNT'
  | 'VEHICLE_LIST'
  | 'STORE_SUMMARY'
  | 'CONVERSATION_REPAIR'
  | 'CONVERSATION_HISTORY'
  | 'RUNTIME_DIAGNOSTICS';

export type ResolutionStatus =
  | 'RESOLVED'
  | 'AMBIGUOUS_VEHICLE'
  | 'AMBIGUOUS_ORDER'
  | 'NO_MATCH'
  | 'UNAVAILABLE';

export type AnalysisCoverageStatus =
  | 'FULL'
  | 'PARTIAL_ERP_ONLY'
  | 'NOT_IN_ANALYSIS'
  | 'STALE';

/**
 * Registro de pedido operacional pendente no contexto de turno.
 */
export interface TurnPendingRequest {
  readonly originalUserPrompt: string;
  readonly operation: OperationType;
  readonly targetModel?: string;
  readonly targetPlate?: string;
  readonly targetOsId?: string;
  readonly targetLojaSlug?: string;
  readonly generationId: number;
  readonly requestedAt: string;
  readonly deliveryStatus: 'DELIVERED' | 'FAILED_TECHNICAL' | 'MISUNDERSTOOD' | 'PENDING_CHOICE';
}

/**
 * Candidato a veículo físico identificado no ERP.
 */
export interface CandidateVehicle {
  readonly plate: string;
  readonly model: string;
  readonly clientName?: string;
  readonly storeSlug: string;
  readonly lastActiveOsId: string;
}

/**
 * Candidato a atendimento (Ordem de Serviço) do veículo.
 */
export interface CandidateOrder {
  readonly osId: string;
  readonly storeSlug: string;
  readonly plate: string;
  readonly vehicleModel: string;
  readonly clientName?: string;
  readonly statusGrid: string;
  readonly isOpen: boolean;
  readonly daysInYard: number;
  readonly totalAmount: number;
  readonly remainingBalance: number;
  readonly openedAt?: string;
}

/**
 * Resultado discriminado da resolução do alvo na oficina.
 */
export type VehicleResolutionResult =
  | {
      readonly status: 'RESOLVED';
      readonly vehicle: CandidateVehicle;
      readonly activeOrder: CandidateOrder;
    }
  | {
      readonly status: 'AMBIGUOUS_VEHICLE';
      readonly candidates: readonly CandidateVehicle[];
      readonly clarificationPrompt: string;
    }
  | {
      readonly status: 'AMBIGUOUS_ORDER';
      readonly vehicle: CandidateVehicle;
      readonly candidateOrders: readonly CandidateOrder[];
      readonly clarificationPrompt: string;
    }
  | {
      readonly status: 'NO_MATCH';
      readonly searchedModel?: string;
      readonly searchedPlate?: string;
      readonly searchedStoreSlug?: string;
      readonly reason: string;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly technicalError: string;
    };

/**
 * Fatos consolidados da situação e histórico de atendimento.
 */
export interface CaseContextResult {
  readonly order: CandidateOrder;
  readonly coverage: AnalysisCoverageStatus;
  readonly documentedDelayReason?: string;
  readonly nextPromisedStep?: string;
  readonly lastObservationDate?: string;
  readonly evidenceOrigin: 'GRAPH_PROJECTION' | 'CANONICAL_ANALYSIS' | 'ERP_DIRECT';
  readonly isLimitationDeclared: boolean;
}

/**
 * Extensão do TurnState para manter rastreabilidade de reparação.
 */
export interface ExtendedTurnState {
  readonly phone: string;
  readonly lastTurnId: string;
  readonly lastIntent: string;
  readonly lojaSlug?: string;
  readonly vehicleModel?: string;
  readonly placa?: string;
  readonly osId?: string;
  readonly pendingRequest?: TurnPendingRequest;
  readonly memoryGeneration?: number;
  readonly updatedAt: string;
}
```

---

## 3. Módulos a Modificar e Integrar na VPS

### 3.1 Módulos a Modificar na Árvore Servida (`/opt/bots/src/hydra-sync/`)
1. **`turn_context_repository.ts`**:
   - Adicionar persistência aditiva de `pending_request_json` em `hydra_turn_contexts`.
   - Implementar `saveTurnPendingRequest` e `getTurnPendingRequest`.
   - Limpar ou invalidar o pedido pendente ao receber `/reset` ou troca explícita de assunto.
2. **`intent_rewriter.ts`**:
   - Ajustar detecção de correção conversacional: incluir variantes como `"nn foi isso que pedi"`, `"n foi isso"`, `"não era isso"`.
   - Descartar preenchimentos vazios (`"cara"`, `"mano"`, `"por favor"`): não promovê-los a nova consulta.
   - Corrigir substring `norm.includes('o que perguntei')`: usar boundary `/\b(o que eu perguntei|minha pergunta anterior)\b/` para evitar colisão com `"isso que perguntei"`.
   - Preservar `vehicleModel` e `DELAY_REASON` na continuidade contextual quando o operador perguntar *"por que ele está parado?"*.
3. **`agent_dispatcher.ts`**:
   - Reordenar pipeline de decisão:
     1. Comandos administrativos (`/reset`, `/perfil`, `/socio`, `/{loja}`).
     2. Recuperação de `TurnState` e `TurnPendingRequest`.
     3. Reparação de contexto (`isCorrection`): retoma o alvo pendente imediatamente.
     4. Tratamento de incompreensão (`isDuvida`): explica o alvo anterior se recente, em vez de cuspir menu genérico.
     5. Perguntas de disponibilidade (`isAvailabilityQuery`): responde status preservando o alvo pendente.
     6. Chamada de reescrita semântica e despacho operacional.
   - Remover default hardcoded `vehicleModel || 'linea'`.
   - Unificar idempotência, registro de interação e telemetria nos caminhos de sucesso e erro.
4. **`operational_adapter.ts`**:
   - Blindar o handler de `aging_cars`: a palavra `"parado"` só ativa retenção se a operação for expressamente agregada e NÃO houver veículo individual ou OS em foco.
   - No fallback de `retrieve_operational_data`: se `intent.veiculo` ou `intent.placa` estiverem presentes, executar busca direcionada por veículo, NUNCA listar as 5 primeiras OSs aleatórias da rede.
5. **`agent_dispatcher_cli.ts`**:
   - Atualizar interface de CLI para suportar chamadas com passagem de estado sintético para testes automatizados.

### 3.2 Módulos a Integrar de Forma Reconciliada
1. **`hybrid_os_coordinator.ts`**:
   - Remover dependência default de fixtures em memória no construtor.
   - Suportar busca real por modelo, placa e OS.
   - Encaminhar `DELAY_REASON` e compor o balão factual com indicação de cobertura.
2. **`operational_data_repository.ts`**:
   - Implementar consulta SQL parametrizada à tabela `ordens_servico` por modelo e loja.
   - Tratar multiplicidade retornando lista de placas para desambiguação (sem corte cego em `rows[0]`).
3. **`real_analysis_repository.ts`**:
   - Consumir análises reais do atendimento geradas pelos serviços existentes.
   - Validar estritamente a presença da OS em `coveredOsIds` e correspondência de loja.

---

## 4. Matriz de Aceite Obrigatória (Cenários R01 a R18)

| ID | Entrada / Condição | Comportamento Obrigatório | Anti-Pattern Proibido |
|:---:|---|---|---|
| **R01** | *"Caso do Linea / por que está parado"* | Identifica veículo individual + intenção `DELAY_REASON`. Busca no ERP e análises. | NUNCA chamar `get_aging_cars` nem listar retenção agregada da rede. |
| **R02** | *"nao foi isso que perguntei cara"* | Reconhece rejeição da resposta anterior e retoma a consulta do alvo pendente. | NUNCA ativar `conversation_history` nem listar mensagens anteriores. |
| **R03** | *"nao entendi"* (após erro anterior) | Explica e reexecuta com clareza o caso do veículo pendente. | NUNCA exibir menu estático de capacidades gerais da rede. |
| **R04** | *"ia ta ativa?"* seguido de *"quero saber do linea"* | Responde disponibilidade no 1º turno; no 2º turno atende o Linea preservando contexto. | NUNCA perder o foco do veículo nem inventar diagnóstico na resposta de disponibilidade. |
| **R05** | *"nn foi isso que pedi"* | Reconhece como correção conversacional e retoma a busca do veículo. | NUNCA responder com saudação (*"Olá! Como posso ajudar hoje?"*). |
| **R06** | *"e por que ele está parado?"* (continuidade) | Recupera o Linea/Jabaquara do turno anterior e busca motivo documentado de demora. | NUNCA perder o carro e desviar para pátio da rede. |
| **R07** | Placa ou OS explícita sem modelo (ex: *"OS 1128"*) | Consulta a referência exata fornecida. | NUNCA forçar default hardcoded `'linea'`. |
| **R08** | Dois veículos candidatos na mesma loja | Emite balão de desambiguação listando as placas encontradas para escolha. | NUNCA escolher arbitrariamente `rows[0]`. |
| **R09** | LLM indisponível (Simulação de Falha) | Fallback opera com a MESMA intenção factual e declara dados obtidos. | NUNCA desviar para relatório agregado aleatório. |
| **R10** | Análise ausente ou desatualizada | Retorna dados cadastrais do ERP e declara expressamente que motivo não está documentado. | NUNCA alucinar causa da demora (ex: falta de peça ou mecânico). |
| **R11** | Projeção do grafo indisponível com análise válida | Utiliza análise canônica com cobertura declarada. | NUNCA travar a resposta por falha do grafo. |
| **R12** | Gerente solicita veículo de outra loja | Bloqueio prévio de segurança com recusa educada e orientação `/perfil`. | NUNCA consultar nem vazar dados cross-store. |
| **R13** | `/reset` ou troca de perfil | Invalida foco e contexto antigo; incrementa geração de memória. | NUNCA reaproveitar alvo ou resposta da geração anterior. |
| **R14** | Pedido explícito de histórico (*"qual foi a 1ª pergunta?"*) | Retorna histórico limpo sem marcadores internos (`--BLOCK--`). | NUNCA vazar marcações técnicas para o usuário. |
| **R15** | *"quantos Linea temos?"* / *"liste os Linea"* | Executa contagem ou listagem preservando o filtro de modelo `linea`. | NUNCA converter em situação individual de um único carro. |
| **R16** | Mudança explícita para outro veículo ou faturamento | Substitui completamente o foco anterior pelo novo alvo solicitado. | NUNCA misturar dados do carro antigo com o novo assunto. |
| **R17** | Timestamps e fusos | Converte para `America/Sao_Paulo` declarando a data/hora da fonte. | NUNCA emitir datas UTC sem indicação de fuso. |
| **R18** | Loja administrativa `MPMaster` | Excluída de consultas de oficinas e veículos físicos operacionais. | NUNCA apresentar `MPMaster` como oficina com pátio de veículos. |

---

## 5. Sequência Integrada de Teste Obrigatória

A suíte de testes deve executar a sequência encadeada completa em uma única sessão persistida com o mesmo telefone:
```text
T1: "Caso do Linea / por que está parado"       -> R01 (Situação individual + DELAY_REASON)
T2: "nao foi isso que perguntei cara"           -> R02 (Reparação; sem histórico de mensagens)
T3: "nao entendi"                               -> R03 (Explicação do alvo; sem menu genérico)
T4: "ia ta ativa?"                              -> R04 (Afirmação de presença sem perder alvo)
T5: "por favor quero saber do linea por favor"  -> R05/R06 (Foco no Linea; sem lista geral da rede)
T6: "nn foi isso que pedi"                      -> R05 (Reparação; sem saudação)
```
Essa sequência deve rodar tanto com o worker primário disponível quanto em contingência de fallback, validando integridade ponta a ponta sem chamadas reais externas de mensageria WhatsApp.
