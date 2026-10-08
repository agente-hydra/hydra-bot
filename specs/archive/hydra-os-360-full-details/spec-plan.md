# Plano de Execução: Raio-X e Detalhes 360° da OS com Peças e Grafo de Atendimento Integrados

Spec ID: `hydra-os-360-full-details`  
Data: 08/10/2026  
Status: Concluído  

---

## Tarefas de Implementação

- [x] [PARSER] **Enriquecer `parseOSDetailRow` em `db_repository.ts`**
  - Adicionar cálculo de `totalServicos` (`SUM(servicos.valorTotal)`) e `totalPecas` (`SUM(pecas.valorTotal)`).
  - Atualizar a interface `OSDetailComplete` para incluir `totalServicos` e `totalPecas`.

- [x] [DISPATCHER] **Reconhecimento de Raio-X e Detalhes 360° em `agent_dispatcher.ts`**
  - Expandir expressões regulares com suporte a typos (`taio x`, `raio x`, `raiox`, `detalhes`, `tudo`, `ficha completa`).
  - Definir flag `wantsDeepDive = true` quando detectado pedido de detalhamento individual de OS.

- [x] [DISPATCHER] **Renderização de Peças e Materiais em `agent_dispatcher.ts`**
  - Implementar o bloco `> *Peças e Materiais Aplicados*` quando `osDetail.pecas` estiver populado.
  - Se a OS tiver saldo não explicado por serviços (`valorTotal > totalServicos`), incluir linha explicativa de componentes/reparo de bancada.

- [x] [DISPATCHER] **Integração Mandatória do Grafo (`caseCtx`) no Detalhamento da OS**
  - Implementar o bloco `> *Situação e Atendimento*` alimentado por `caseCtx` (motivo de demora, próximo passo, histórico).
  - Incluir a declaração factual de limitação quando a OS não possuir análise documentada nas conversas.

- [x] [COORDINATOR] **Atualização de `formatVehicleSituation` em `hybrid_os_coordinator.ts`**
  - Incorporar linhas resumo de situação e atendimento mesmo quando `operation === 'VEHICLE_SITUATION'`, eliminando respostas vazias de 6 linhas.

- [x] [TESTS] **Suíte Integrada de Testes do Raio-X 360° da OS**
  - Criar `src/hydra-sync/tests/test_os_360_details.ts`.
  - Gate 1: OS #1916 (HB20) com R$ 130 de serviços e R$ 1.470 de peças/bancada deve exibir ambos os blocos sem sumir com valor.
  - Gate 2: Reconhecimento de typos no WhatsApp (`taio x da os 1916` -> ativa modo raio-x completo).
  - Gate 3: Incorporação mandatória do Grafo (`caseCtx`) no relatório de detalhes.
  - Gate 4: OS com peças físicas individuais cadastradas com quantidade e código.
  - Gate 5: Formatação WhatsApp nativa sem asteriscos duplos e sem NBSP (`\u00A0`).
  - Não regressão nos 23 gates do Incidente Linea e na compilação estrita TypeScript (`npx tsc --noEmit`).
