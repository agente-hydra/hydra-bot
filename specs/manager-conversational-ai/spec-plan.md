# Plano de Implementação: Hydra Conversacional por Perfil, Continuidade e IA Efetiva

**ID da Spec:** `manager-conversational-ai`  
**Status:** PLANO DE TAREFAS ATÔMICAS  
**Comando de Execução:** `/vibe-apply manager-conversational-ai`  

---

## Estrutura de Delegação Paralela

O Agente Principal orquestra a execução delegando três frentes especializadas com propriedade exclusiva de arquivos, sem risco de conflito de escrita:

- **Frente 1 (Agente 1):** Compreensão Semântica por Perfil, Roteamento Dual Worker e Governança de Escopo.
- **Frente 2 (Agente 2):** Continuidade Contextual de Turno, Repositórios de Snapshots e Ficha Técnica de OS.
- **Frente 3 (Agente 3):** Qualidade de Resposta, Fórmulas Matemáticas de Metas e Test Harness dos 19 Cenários.
- **Integração Principal:** Merge em staging, Build Gate (`tsc --noEmit`), Bundle ESM com esbuild, Deploy no PM2 e Validação Real WhatsApp.

---

## Tarefas do Agente 1 — Compreensão por Perfil, Roteador e Revisor de IA

- [/] **[AGENTE-1-T1] Pré-carregamento de Perfil no Dispatcher:**
  - Em `agent_dispatcher.ts`, mover a leitura de `getUserProfile(db, phone)` para o início da execução, antes de montar prompts e antes da reescrita de intenção.
  - Injetar no payload do dispatcher a loja autorizada (`lojaSlug`), o nome da loja (`lojaNome`) e a `memoryGeneration`.
- [/] **[AGENTE-1-T2] Ciclo de Revisão Crítica Operacional da IA (AI Reviewer):**
  - Implementar no `agent_dispatcher.ts` o ciclo de revisão pré-envio:
    - O código realiza a busca determinística e gera a resposta candidata com os dados consultados (período e fonte).
    - Se o roteador inicial não entender a mensagem: encaminhar diretamente à IA sem inventar resposta candidata e sem emitir recusa genérica prematura.
    - O revisor de IA (`DualWorkerRouter` com `gemini-3.8-flash-low`) recebe: mensagem original, perfil/loja, contexto da conversa, resposta candidata e dados consultados.
    - A IA decide entre:
      * `APROVAR`: a resposta candidata atende plenamente ao pedido (revisão curta, reutiliza candidata).
      * `AJUSTAR`: os dados consultados são suficientes, mas a formulação precisa de correção ou melhor explicação. **Regra de Ouro:** `AJUSTAR` só pode usar dados já presentes em `dadosConsultados`. Proibido completar a resposta por suposição.
      * `CONSULTAR`: faltam dados ou houve falha de intenção. Em *“OS e CMV”*, se apenas o CMV foi consultado pelo fast-path, a decisão OBRIGATÓRIA é `CONSULTAR` para buscar as OSs. Em *“Detalhes da 1128”*, aciona `get_os_details` para obter a ficha técnica completa. Solicita ferramenta permitida no escopo da loja e conclui a resposta.
      * `ESCLARECER`: formula pergunta pontual apenas quando perfil, contexto e dados não resolverem uma ambiguidade real.
    - **Anti-Loop e Calibração dos Prazos com Evidências Reais:**
      * Timeout da chamada de revisão: **20.000 ms (20s)**.
      * Se `APROVAR` ou `AJUSTAR`: encerra em 1 chamada LLM (~5–16s).
      * Se `CONSULTAR`: ferramenta SQLite executa em <50ms. Nova chamada LLM para síntese só ocorre se o saldo restante do turno for `>= 15.000 ms`. Se o saldo for inferior a 15s, compõe a resposta diretamente via template factual determinístico para jamais ultrapassar o teto global de **50.000 ms**.
      * Teto de controle de loop: máximo de 1 replanejamento (`maxReplanAttempts = 1`), teto de 2 chamadas LLM por turno.
- [/] **[AGENTE-1-T3] Refinamento da Validação de Escopo em `manager_store_access.ts`:**
  - Ajustar `isOutsideManagerStore` para permitir expressões com qualificadores locais (ex.: *"todos os carros da minha loja"*, *"ranking das minhas ordens"*).
  - Bloquear menções a outras lojas (`STORE_NAMES`) ou pedidos amplos de rede, inclusive durante solicitações de ferramentas na revisão (`CONSULTAR`).
  - Padronizar a mensagem de recusa com citação da loja ativa e sugestão expressa de `/socio`.
- [/] **[AGENTE-1-T4] Telemetria de Turno e Contingência em Falhas:**
  - Registrar telemetria completa por turno: `correlationId`, `persona`, `lojaSlug`, `llmInvoked`, `workerChosen`, `reviewDecision`, `replanCount`, `latenciaMs`, `motor`, e tokens quando disponíveis.
  - Orçamento de turno global de 50s compartilhado. Em caso de falha de ambos os workers, encerrar via fallback determinístico com código padronizado `H-IA-02`, sem espera indefinida nem resposta aleatória.
- [/] **[AGENTE-1-T5] Validação Unitária da Frente 1:**
  - Criar e rodar testes unitários demonstrando o ciclo de revisão, decisão `APROVAR` curta, encaminhamento direto de mensagem não compreendida e bloqueio de escopo.

---

## Tarefas do Agente 2 — Continuidade, Resposta Candidata e Ferramentas Autorizadas

- [/] **[AGENTE-2-T1] Preservação de Entidades de Continuidade em `turn_context_repository.ts`:**
  - Garantir que `saveTurnState` grave `os_id`, `placa` e `loja_slug` quando uma OS for o foco da conversa.
  - Garantir que `getLatestTurnState` recupere `os_id` ativo para resolver continuações (ex.: *"Detalhes da 1128"* seguido de *"Quero os detalhes"*, *"E o checklist dela?"*), fornecendo o histórico limpo ao revisor.
  - Descarte inteligente: se mudar de assunto, limpar `os_id` sem resetar a `loja_slug`.
- [/] **[AGENTE-2-T2] Ficha Técnica Completa de OS em `db_repository.ts`:**
  - Implementar a função `getOSDetailComplete(db, lojaSlug, osId)` que realiza busca pelo par `(loja_slug, os_id)`.
  - Extrair situação, datas, total, pago, restante, serviços com mecânicos, peças e auditoria dos checklists de entrada e do mecânico.
- [/] **[AGENTE-2-T3] Geração de Resposta Candidata e Empacotamento de Dados Consultados:**
  - Em `operational_adapter.ts`, implementar `buildCandidateResponse(message, context, profile)`:
    - Realiza consultas rápidas nos repositórios oficiais e monta a resposta preliminar.
    - Empacota `dadosConsultados` (`ConsultedDataRecord[]`: fonte, período, lojaSlug, payload) para alimentar a revisão da IA.
- [/] **[AGENTE-2-T4] Conexão com Repositórios Oficiais de Snapshots:**
  - Conectar consultas de dados autorizados aos repositórios oficiais:
    - Vendas de hoje da loja: `faturamento_diario_horario`.
    - Metas e acumulado do mês: `metas_horarias`.
    - CMV geral e setorial de óleo: `cmv_lojas` e `faturamento_areas`.
- [/] **[AGENTE-2-T5] Execução de Ferramenta Autorizada pós-Revisão (`CONSULTAR`) e Consultas Compostas:**
  - Implementar o executor complementar para a decisão `CONSULTAR` do revisor, rodando ferramentas autorizadas (`get_os_details`, `get_cmv_loja`) com `lojaSlug` estrito.
  - Atender consultas compostas no mesmo turno (*"OS e CMV da minha loja"*), consolidando ambas as fontes.
  - Expurgar cache e dados de rede ao alternar Sócio -> Gerente.
- [/] **[AGENTE-2-T6] Validação Unitária da Frente 2:**
  - Testes de geração de candidata com dados empacotados, ficha completa de OS e atendimento de `CONSULTAR`.

---

## Tarefas do Agente 3 — Qualidade de Respostas, Indicadores e Test Harness de Evidências

- [/] **[AGENTE-3-T1] Correção Aritmética de Metas e Atingimento:**
  - Em `format_utils.ts` / `operational_adapter.ts`, corrigir a fórmula de atingimento:
    - `atingimento = (faturamento / meta) * 100` (ex: `84.613,61 / 124.900,00 * 100 = 67,75%`, nunca `-32,0%`).
    - `valorFaltante = Math.max(0, meta - faturamento)` (ex: `R$ 40.286,39`).
  - Tratar meta zerada ou ausente explicitamente.
- [/] **[AGENTE-3-T2] Correção de Encoding e Sanitização de Texto:**
  - Eliminar caracteres corrompidos em saídas e queries (ex.: *"Retidos há mais"*).
  - Assegurar que nenhum asterisco duplo (`**`) vaze para os balões de WhatsApp.
- [/] **[AGENTE-3-T3] Hierarquia Semântica no `balloon_composer.ts`:**
  - Garantir a ordem semântica dos balões: Resposta Direta -> Leitura dos Indicadores -> Detalhamento -> Rodapé com fonte e data/hora. Limite de 700 a 900 caracteres por balão.
- [/] **[AGENTE-3-T4] Criação da Suíte Integrada com Evidências Mandatórias:**
  - Criar `src/hydra-sync/tests/test_manager_ai_continuity.ts` cobrindo a matriz dos 20 cenários com destaque para as 6 evidências obrigatórias:
    1. **Evidência 1 (Revisão APROVAR):** Candidata correta sobre faturamento aprovada por chamada real à IA (`decisao = 'APROVAR'`).
    2. **Evidência 2 (Revisão AJUSTAR):** Resposta incompleta (*"OS e CMV da minha loja"*) corrigida pela revisão para atender a ambas as partes.
    3. **Evidência 3 (Revisão CONSULTAR):** Interpretação insuficiente (*"Detalhes da 1128"* retornando só resumo) percebida pela revisão, disparando consulta autorizada `get_os_details` com entrega da ficha completa.
    4. **Evidência 4 (Continuidade Preservada):** Mensagem seguinte *"Quero os detalhes"* após selecionar a 1128 preserva o `osId` e mantém o contexto.
    5. **Evidência 5 (Zero Vazamento Cross-Store):** Consulta à outra loja (*"Faturamento da Kennedy"*) bloqueada no escopo com recusa educada e sugestão `/socio`, inclusive se tentada em `CONSULTAR`.
    6. **Evidência 6 (Falha Graciosa dos Workers):** Simulação de indisponibilidade primária e secundária resultando em encerramento com código `H-IA-02`, sem espera indefinida nem resposta aleatória.
    7. *"Qual minha loja?"* -> identifica Jorge Beretta pelo perfil.
    8. *"Como estamos?"* -> IA chamada, resumo dos dados da loja.
    9. *"Consegue falar do fatuamento?"* -> entende typo e responde com dados.
    10. *"E hoje?"* após faturamento mensal -> consulta vendas de hoje.
    11. *"Quanto falta pra meta?"* -> cálculo correto (67,75% e R$ 40.286,39).
    12. *"Todos os carros da minha loja"* -> conjunto local sem falso bloqueio.
    13. Duas OSs possíveis sem seleção -> solicita esclarecimento curto (`ESCLARECER`).
    14. *"CMV de óleo"* -> busca setor OLEO específico da loja.
    15. Entrada por áudio -> equivalência funcional à pergunta textual.
    16. Complemento durante geração -> batcher descarta resposta obsoleta.
    17. Troca de perfil durante geração -> cancela turno em voo.
    18. Primário sem cota -> secundário atende com telemetria.
    19. Dado ausente/antigo -> explicação transparente.
    20. Retorno Sócio -> Gerente -> zero reaproveitamento de dados de rede.
- [/] **[AGENTE-3-T5] Execução da Suíte de Testes com 100% de Aprovação:**
  - Rodar `npx tsx src/hydra-sync/tests/test_manager_ai_continuity.ts` e certificar 20/20 PASS.

---

## Tarefas de Integração e Fechamento pelo Agente Principal

- [ ] **[INTEGRAÇÃO-1] Revisão e Merge dos Patches dos Subagentes em Staging:**
  - Aplicar sequencialmente os patches dos subagentes em `/home/operacional/hydra-staging/`.
- [ ] **[INTEGRAÇÃO-2] Build Gate do Compilador:**
  - Executar `npx tsc --project tsconfig.hydra.json --noEmit` garantindo zero erros de tipagem.
- [ ] **[INTEGRAÇÃO-3] Empacotamento de Bundles ESM com esbuild:**
  - Gerar `command_interceptor.js` e `balloon_composer.js` com `esbuild --bundle` para evitar quebras de importação no Node nativo.
- [ ] **[INTEGRAÇÃO-4] Implantação e Reload do PM2:**
  - Sincronizar staging para `/opt/bots/` e recarregar `pm2 reload hydra-bot`.
- [ ] **[INTEGRAÇÃO-5] Validação Operacional no WhatsApp Real:**
  - Disparar sequência de validação nos números de Davi (`5511996242812`) ou Marcos (`5511970671717`):
    - Ativação `/jorgeberetta`
    - Pergunta aberta *"Como estamos?"*
    - Erro de digitação *"Consegue me falar do fatuamento?"*
    - Detalhes de OS *"Detalhes da 1128"* e continuação *"Quero os detalhes"*
    - Bloqueio de outra loja *"Faturamento da Kennedy"* (com confirmação da recusa e sugestão `/socio`).
- [ ] **[INTEGRAÇÃO-6] Relatório Final de Conclusão:**
  - Consolidar relatório demonstrando commits, evidências de chamadas reais aos workers e fluxo no WhatsApp.
