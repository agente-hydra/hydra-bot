# Proposta de Engenharia: Hydra — Recorrência Linea: Runtime e Reparação Conversacional

**ID da Spec:** `hydra-linea-runtime-repair`  
**Data:** 05/10/2026  
**Status:** PROPOSTA FORMALIZADA (SDD Proposal)  
**Destinatários e Atribuição:**
- **Agente Principal (E0):** Coordenação central, inventário de release, baseline da VPS, congelamento de contratos estritos, harness isolado de reprodução da sequência e gate de release.
- **Executor 1 (E1):** Interpretação, desambiguação e reparação conversacional (`intent_rewriter.ts`, `conversation_semantic_resolver.ts`, contratos de linguagem/turno).
- **Executor 2 (E2):** Dados, estado e memória do caso (`turn_context_repository.ts`, `operational_data_repository.ts`, `real_analysis_repository.ts`, leitor/projeção de caso).
- **Executor 3 (E3):** Integração no bot, orquestração e blindagem de fallback (`agent_dispatcher.ts`, `agent_dispatcher_cli.ts`, `operational_adapter.ts`, `hybrid_os_coordinator.ts`, `public_response_guard.ts`).

---

## 1. Problema e Diagnóstico Factual

Durante testes operacionais em 05/10/2026 com o caso do veículo Fiat Linea na unidade Jabaquara, a sequência conversacional submetida ao bot em produção falhou repetidamente, degradando por rotas incorretas de fallback e colidindo com palavras-chave espúrias.

### 1.1 A VPS Atende por uma Árvore Diferente das Implementações Locais
O processo em execução na VPS (`/opt/bots/src/hydra-sync/`) atende via `agent_dispatcher_cli.ts` consumindo `agent_dispatcher.js` resolvido por `tsx`.
Na árvore servida na VPS **NÃO EXISTEM** os 7 módulos desenvolvidos na branch local de scratch (`manager-scope-fix`):
- `hybrid_os_coordinator.ts`
- `conversation_semantic_resolver.ts`
- `operational_data_repository.ts`
- `real_analysis_repository.ts`
- `analysis_memory_writer.ts`
- `case_memory_reader.ts`
- `case_graph_projection.ts`

O dispatcher servido na VPS não contém o método `inspectVehicle`.

### 1.2 Auditoria da Sequência Real que Falhou

| Turno | Mensagem do Operador | Motor Registrado | Ferramenta Chamada | Comportamento Observado | Causa Raiz Identificada |
|---|---|:---:|:---:|---|---|
| **T1** | *"Caso do Linea / por que está parado"* | `FALLBACK_API` | `get_aging_cars` | Retenção agregada da rede (> 5 dias) | `operational_adapter.ts:1328` ativa pátio agregado pela palavra `"parado"`, sem checar se é alvo individual. |
| **T2** | *"nao foi isso que perguntei cara"* | `FALLBACK_API` | `conversation_history` | Histórico de mensagens | `:1281` remove prefixo, sobra `"cara"`, considera substancial (>3 chars); `:1389` testa `norm.includes('o que perguntei')`, que dá match em *"iss**o que perguntei** cara"*. |
| **T3** | *"nao entendi"* | `FALLBACK_API` | Nenhuma | Menu de ajuda fixa da rede | `:436-442` desvia para capacidades estáticas **antes** da recuperação de estado de turno (`:489-495`). |
| **T4** | *"ia ta ativa?"* | `AGY_PRIMARY` | Nenhuma | Afirmação de disponibilidade | Pergunta sobre a ferramenta perde o foco do veículo anterior. |
| **T5** | *"por favor quero saber do linea por favor"* | `FALLBACK_API` | `retrieve_operational_data` | Lista geral de OSs da rede | `:1661-1664` recebe filtros vazios e `:1699` gera lista de OSs gerais da rede. |
| **T6** | *"nn foi isso que pedi"* | `FALLBACK_API` | Nenhuma | Saudação (*"Olá! Como posso ajudar hoje?"*) | Gíria `"nn"` (não) não é reconhecida; cai no bloco de saudação por tamanho curto. |

### 1.3 A Cópia Local Não É uma Correção Pronta
A inspeção da árvore local em `C:/Users/User/Documents/ChatGPT/hydra/manager-scope-fix/src/hydra-sync` revelou pendências que impedem cópia direta:
1. `agent_dispatcher.ts:528` usa `vehicleModel || 'linea'`: um default hardcoded indevido que converte qualquer busca por placa ou OS em busca de Linea.
2. `agent_dispatcher.ts:532-537` passa apenas modelo/loja e omite a dimensão `DELAY_REASON`.
3. `hybrid_os_coordinator.ts:58` usa catálogo de fixtures em memória como default no construtor.
4. `intent_rewriter.ts:713-751` declara `previousPlan` mas não recupera o contexto anterior.
5. O teste local `tests/test_linea_jabaquara_gates.ts:726-745` chama `inspectVehicle` diretamente com fixtures, sem passar por `dispatchMessage` nem pelo CLI servido.

---

## 2. Solução Proposta

Implementar uma **arquitetura de runtime robusta, reconciliada e com separação estrita de camadas**, integrando os módulos essenciais na árvore oficial da VPS sem quebras de contrato:

```text
Entrada WhatsApp (Texto / CLI)
  │
  ▼
[1. Autenticação & Escopo de Segurança]
  │  • Bloqueio antecipado de lojas não autorizadas
  │  • Preservação de geração de memória e TTL de 120min
  │
  ▼
[2. Orquestrador de Diálogo & Prioridade de Reparação]
  │  • Reparação Conversacional ("não foi isso", "nn foi isso") ANTES de histórico e saudação
  │  • "Não entendi" pós-erro reexecuta/explica o alvo pendente, sem menu genérico
  │  • Histórico de conversa exige pedido afirmativo ("qual foi a primeira pergunta")
  │
  ▼
[3. Interpretação Semântica & Resolução de Entidades]
  │  • Distingue: Situação Individual vs Contagem vs Listagem vs Resumo de Loja
  │  • Extrai: Modelo, Placa, OS, Loja (sem default hardcoded 'linea')
  │  • Reconhece intenção DELAY_REASON ("por que está parado?")
  │  • Fala de preenchimento ("cara", "mano", "por favor") não vira consulta nova
  │
  ▼
[4. Recuperação de Dados do Caso (ERP + Memória)]
  │  • Busca parametrizada por modelo/loja em `ordens_servico`
  │  • Desambiguação com lista mínima de placas se houver > 1 candidato (sem rows[0])
  │  • Consumo de análises persistidas pelo serviço real
  │  • Projeção de grafo com fallback para análise canônica e ERP se grafo ausente
  │
  ▼
[5. Composição de Resposta & Blindagem de Fallback]
  │  • Separação estrita: Fatos do ERP vs Motivo Documentado de Demora
  │  • Se motivo não documentado: declara limitação sem inventar falta de peça/mecânico
  │  • Fallback mantém intenção: "parado" em veículo individual NUNCA chama get_aging_cars
  │  • Sanitização de WhatsApp: zero asteriscos duplos, zero --BLOCK--
```

---

## 3. Contratos de Dados a Congelar

1. **`TurnPendingRequest`**: Registra no `turn_context_repository.ts` a pergunta original, a operação (`VEHICLE_SITUATION`, `DELAY_REASON`, etc.), os alvos solicitados e o status de entrega.
2. **`VehicleResolutionResult`**: Discriminador estrito (`RESOLVED`, `AMBIGUOUS_VEHICLE`, `AMBIGUOUS_ORDER`, `NO_MATCH`, `UNAVAILABLE`) que impede seleção cega de `rows[0]`.
3. **`CaseContextResult`**: Agrupa fatos cadastrais da OS e a posição consolidada do atendimento com indicação de cobertura (`FULL`, `PARTIAL_ERP_ONLY`, `NOT_IN_ANALYSIS`).
4. **`CanonicalIntent` & `TurnState`**: Reconciliação aditiva preservando compatibilidade com o schema SQLite existente em produção.

---

## 4. Riscos Principais e Mitigações

| Risco Principal | Impacto | Mitigação Obrigatória |
|---|---|---|
| **R1 — Regressão da Árvore de Produção** | Sobrescrita de arquivos funcionais na VPS por cópia cega do repositório local | Proibido copiar diretórios inteiros. Aplicação atômica por patch e revisão por tarefa com build gate. |
| **R2 — Falso Diagnóstico de Demora** | Inventar que o carro está aguardando peça ou mecânico sem prova documental | Regra de ouro: estado `NA FILA`, valor da OS ou falta de checklist NÃO comprovam falta de peça. Se não documentado na análise, emitir declaração de limitação. |
| **R3 — Colisão de Palavras-Chave no Fallback** | Fallback desviar para `get_aging_cars` ou lista geral de OSs | Desacoplar gatilhos de palavras soltas (`"parado"`). Exigir que a operação seja explicitamente agregada antes de consultar retenção geral. |
| **R4 — Ambiguidade de Múltiplos Veículos** | Retornar dados do carro errado quando houver dois Linea na mesma loja | `VehicleResolutionResult` detecta multiplicidade e emite balão objetivo com placas para desambiguação do operador. |
| **R5 — Perda de Foco em Perguntas Meta-Conversacionais** | *"ia ta ativa?"* apagar o veículo em atendimento | Perguntas sobre a disponibilidade do bot respondem o status sem sobrescrever o alvo operacional pendente no contexto. |

---

## 5. Próximo Passo

Submeter o documento de design técnico detalhado ([`design.md`](file:///C:/Users/User/Desktop/agy/specs/hydra-linea-runtime-repair/design.md)) e a matriz de tarefas atômicas ([`spec-plan.md`](file:///C:/Users/User/Desktop/agy/specs/hydra-linea-runtime-repair/spec-plan.md)).
