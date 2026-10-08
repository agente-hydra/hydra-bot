# Plano de Execução: Padronização Hermes 360° da OS & Continuidade do Grafo de Conversas

**Spec ID:** `hydra-os-360-formatting-and-conversation-continuity`  
**Data:** 08/10/2026  
**Status:** Concluído (100% Homologado)  

---

## Tarefas de Implementação

- [x] [COMPOSER] **Formatador Canônico Hermes 360° em `src/hydra-sync/os_situation_composer.ts`**
  - Implementar `composeFullOS360Card(params: OS360CardParams): string`
  - Incluir os 6 blocos obrigatórios com separadores `----------------------------------------`:
    1. Cabeçalho Executivo (`> *OS #XXXX — MODELO (PLACA)*`)
    2. Situação e Atendimento (motivo operacional do Grafo, próximo passo prometido e resumo de peças)
    3. Serviços Discriminados (valores em negrito e executores)
    4. Peças e Materiais Aplicados (itens discriminados ou cálculo analítico de peças/bancada para fechar 100% o valor total)
    5. Formas de Pagamento e Parcelas (modalidades, vencimentos e saldo restante)
    6. Vistorias e Documentos (checklists de entrada e mecânico com emojis ✅/⚠️, NF e anexos)

- [x] [DISPATCHER] **Unificação do Card 360° no Dispatcher e Gerente**
  - Atualizar `src/hydra-sync/agent_dispatcher.ts` para que qualquer consulta de OS/veículo (mesmo quando o usuário digita apenas o modelo, placa ou "os XXXX") utilize o formatador canônico 360° completo.
  - Atualizar `src/hydra-sync/manager_store_access.ts` para usar a mesma função `composeFullOS360Card`, eliminando discrepâncias visuais entre perfis de sócio e gerente.

- [x] [ANAPHORA] **Continuidade Conversacional de Diálogos e Alinhamentos da OS**
  - Implementar em `agent_dispatcher.ts` a detecção de anáfora de conversas (`isOSConversationQuery`).
  - Se o operador perguntar sobre conversas/áudios após visualizar uma OS (ou mencionar a OS), resgatar o `osId` ativo no `TurnState`.
  - Consultar o Grafo de Atendimento (`getCaseContext` / `case_memory_reader`) e formatar a resposta factual com o que foi alinhado com o cliente ou declarar honestamente a ausência de conversas vinculadas àquela OS específica.

- [x] [PROMPT] **Blindagem Anti-Alucinação no Prompt do Sistema (`system_prompt.md`)**
  - Atualizar `src/hydra-sync/system_prompt.md` com a ferramenta `get_os_case_history` e a seção de diretrizes do Grafo.
  - Proibir expressamente qualquer resposta dizendo que o Hydra não tem acesso a conversas de clientes de oficina.

- [x] [TESTS] **Suíte Integrada de Testes de Homologação**
  - Criar `src/hydra-sync/tests/test_os_360_conversation_continuity.ts`:
    - Gate 1: OS com peças e serviços (ex: Voyage 18503 e HB20 1916) gera os 6 blocos canônicos com discriminação de peças e soma 100% exata.
    - Gate 2: Pergunta direta de OS ("os 18503" ou "voyage") exibe imediatamente o card 360° completo.
    - Gate 3: Continuidade conversacional: perguntar "ok mas não tem acesso a nenhuma conversa?" herda a OS do turno anterior e consulta o Grafo sem alucinar falta de acesso.
    - Gate 4: Formatação nativa WhatsApp sem `**`, sem tabelas e com divisores `----------------------------------------`.
    - Gate 5: Build gate TypeScript strict (`npx tsc --noEmit`).

