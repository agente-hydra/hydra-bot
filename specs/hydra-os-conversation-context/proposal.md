# Proposta de Especificação: Hydra — Auditoria e Correção do Incidente Linea/Jabaquara

**ID da Spec:** `hydra-os-conversation-context`  
**Data:** 05/10/2026  
**Status:** PROPOSTA REVISADA (VERSÃO 2.1 — AUDITORIA INCIDENTE LINEA/JABAQUARA)  
**Destinatários:** Agente Principal, Executor 1, Executor 2 e Executor 3  

---

## 1. Contexto e Problema (Incidente Linea/Jabaquara)

### 1.1 O Pedido do Usuário que Falhou
No dia 05/10/2026, foi submetida a seguinte consulta em ambiente operacional:
> *"fala sobre o linea do jabaquara por favor, qq ta acontecendo?"*

O bot respondeu com um **Raio-X agregado de faturamento/metas da loja Jabaquara**, ignorando completamente o veículo. Em seguida, o usuário enviou uma correção explícita:
> *"uaai nao foi isso qu eeu te pedi mano, queor entender qq ta acontecendo com o carro linea do jabaquara"*

O bot persistiu no erro e retornou novamente o mesmo resumo financeiro/operacional agregado da unidade. Às 11:16, foi executado o comando `/reset` (confirmando perfil Sócio, memória #8 sem requisições pendentes) e a pergunta completa sobre o Linea foi reenviada; às 11:26, o bot retornou mais uma vez o raio-X agregado da loja.

### 1.2 Evidências Técnicas Diagnosticadas (F01 a F07)
1. **F01 — Resolvedor de conversas cego para modelo:** Em `conversation_semantic_resolver.ts:96`, a intenção `isOSSituationQuery` só é ativada se houver número explícito (`\d{3,6}`) ou o texto literal `"situação da os"`. Diante de *"fala sobre o linea... qq ta acontecendo"*, retorna `isOSSituationQuery: false`.
2. **F02 — Camada semântica perde o identificador principal:** Em `intent_rewriter.ts`, `buildSemanticQueryPlan` extrai a loja (`loja_slug = MPJabaquara`), mas não extrai o modelo do veículo (`linea`). O alvo individual é completamente descartado, resultando em um plano agregado da loja.
3. **F03 — Falta de integração com o entrypoint real e contratos incompatíveis:** `agent_dispatcher.ts` não consome `HybridOSCoordinator`. Há incompatibilidade de contratos: o dispatcher passa metadados de lote no 3º argumento de `rewriteIntent`, enquanto a assinatura esperava `SecurityContext`. O build gate não cobria o fluxo real do bot.
4. **F04 — Descarte de análise recuperada por ausência de link em memória:** Em `hybrid_os_coordinator.ts:146`, se `conversationId` não estiver registrado no `Map` volátil em memória (`conversationLinks`), o coordenador descarta a análise já recuperada e declara ausência de vínculo.
5. **F05 — Repositório novo sem consumo do produtor real:** `RealAnalysisRepository` cria tabelas próprias, mas não foi comprovado o consumo do banco onde o produtor do Watchdog/IA de conversas já gravou as análises existentes.
6. **F06 — Busca de veículo sem desambiguação e sem vínculo com conversas:** O caminho legado de `intent.veiculo` em `operational_adapter.ts` filtra apenas OSs abertas, limita a 5 e seleciona arbitrariamente `rows[0]`, sem resolver ambiguidades e sem cruzar com conversas.
7. **F07 — Dependência de fixtures em runtime:** `HybridOSCoordinator` utilizava `FIXTURE_OS_CATALOG` como catálogo default no construtor.

---

## 2. Solução Proposta e Diretrizes da Revisão v2.1

A correção deve implementar o percurso completo de consulta por veículo na camada semântica e orquestração híbrida, reconciliando os contratos com o `agent_dispatcher.ts` e garantindo que o usuário possa consultar a situação de qualquer veículo por modelo, placa ou OS sem cair em relatórios agregados indevidos.

### 2.1 Os 10 Ajustes Mandatórios da Revisão v2.1
1. **Autorização antes da busca:** O contexto de autorização (`SecurityContext`) é obrigatório, fortemente tipado e validado ANTES de qualquer consulta ao banco, cache, análise ou construção de candidatos. O perfil de gerente para outra loja é bloqueado na raiz. Nunca assumir perfil de sócio como fallback se o contexto for omitido.
2. **`conversationId` é pista, não prova suficiente de vínculo:** O `conversationId` recupera a análise sem exigir mapa em memória, mas o vínculo só é confirmado se a análise cobrir comprovadamente a OS solicitada (`analysis.coveredOsIds.includes(osId)`), a mesma loja e período válido. Se não cobrir, registra lacuna explícita `NOT_IN_ANALYSIS`.
3. **Diferenciação estrita entre falha técnica e ausência de resultado:** Timeout, fonte indisponível e coleta parcial geram mensagens claras de erro técnico e preservam o alvo para nova tentativa. Nunca responder "veículo não encontrado" em falha técnica. Nunca fazer fallback para raio-X agregado.
4. **Modelo é filtro de entidade, não sinônimo de situação individual:** Perguntas como *"quantos Linea temos?"*, *"liste os Linea abertos"* e *"faturamento das OS de Linea"* preservam o filtro de modelo em operações de contagem, lista ou finanças. Somente perguntas de estado (*"como tá o Linea"*, *"qq ta acontecendo"*) ativam o fluxo de situação individual.
5. **Catálogo de modelos além de lista popular:** A resolução de modelo consulta as descrições e modelos reais da base autorizada de OSs da oficina (com normalização léxica e aliases). Modelos fora de listas fixas produzem busca parametrizada e desambiguação sem converter a consulta em resumo da loja.
6. **Separação estrita entre Veículo e Atendimento (OS):** `CandidateVehicle` (carro: placa, modelo, cliente) é dissociado de `CandidateOrder` (atendimento: osId, status, valor, datas, serviços). Distingue-se ambiguidade de veículos (dois Linea diferentes) de ambiguidade de atendimentos (duas OSs do mesmo Linea). Não inventar campos não fornecidos pelo banco (ex: ano).
7. **Mapeamento real da dimensão de modelo:** O identificador ontológico `veiculo_modelo` deve possuir mapeamento SQL parametrizado real (ex: `os.veiculo LIKE ?`), testado até a execução física.
8. **Paginação, estados discriminados e cache estruturado:** `VehicleResolutionResult` com estados discriminados (`RESOLVED`, `AMBIGUOUS_VEHICLE`, `AMBIGUOUS_ORDER`, `NO_MATCH`, `UNAVAILABLE`). Cache de relatório indexado por OS resolvida, loja, persona, geração de memória e versões; dois Linea de placas diferentes nunca colidem em cache.
9. **Restauração do Gate G13 (Verificação de Runtime) e Preservação de Testes Anteriores:** Comprovação da versão realmente servida e funcionamento pelo entrypoint do bot em ambiente servido (quando autorizado deploy). Preservação integral de T41–T54 e dos 5 Gates Adversariais (negação, ausência de vínculo, isolamento cross-store, edição de mesmo ID e truncamento de histórico).
10. **Dono Único dos Arquivos Compartilhados:** Responsabilidades rigidamente delimitadas para evitar edições concorrentes.

### 2.2 Fluxo Obrigatório de Execução
```text
Mensagem + Contexto de Segurança Autenticado
  │
  ▼
1. Validação Antecipada de Autorização
  │  • Bloqueio pré-SQL se Gerente solicitar outra loja (Zero vazamento)
  │  • Sócio validado no seu escopo real (proibido default silencioso)
  │
  ▼
2. Reconhecimento de Intenção e Extração de Entidades (Modelo/Placa/OS/Loja)
  │  • Distingue operação (situação individual vs contagem vs listagem vs finanças)
  │  • Detecta reparação conversacional ("não foi isso") e anula contexto anterior
  │
  ▼
3. Resolução de Candidatos na Oficina (Banco Real Parametrizado)
  │  • Busca veículos por modelo ("linea") e unidade no escopo autorizado
  │  • Separa identidade do veículo e atendimentos (OSs)
  │
  ▼
4. Avaliação de Resultados da Busca
  ├── Falha Técnica / Timeout: mensagem de indisponibilidade técnica (preserva o alvo)
  ├── Zero Candidatos: declaração expressa ("Não encontrei OS para o veículo X na unidade Y")
  ├── Ambiguidade de Veículos: balão com placas dos veículos para escolha
  ├── Ambiguidade de Atendimentos: balão com as OSs do veículo para escolha
  └── Alvo Único Confirmado: prossegue com a OS resolvida
  │
  ▼
5. Vínculo e Recuperação de Análises Existentes
  │  • Recupera via conversationId da análise e valida cobertura da OS e loja
  │  • Sem cobertura comprovada: registra lacuna NOT_IN_ANALYSIS (não conclui sem evidência)
  │
  ▼
6. Composição WhatsApp Nativa (Fatos ERP + Análises Consolidadas)
  │  • Dados cadastrais da OS (status, serviços, valores)
  │  • Posição do atendimento (aprovações, recusas, promessas, pendências)
  │  • Declaração honesta de limitações (sem alucinar causa se faltar dado)
```

---

## 3. Divisão de Responsabilidades e Dono Único de Arquivos

| Executor / Papel | Sessão Atribuída | Arquivos de Domínio Exclusivo | Escopo de Trabalho |
|---|---|---|---|
| **Principal** | Central | `types/conversation_context_contract.ts`<br>`types/semantic_contract.ts` | Congelar contratos e interfaces; verificação em leitura do runtime; homologação dos 15 gates (G01 a G15); manifesto de entrega. |
| **Executor 1** (Interpretação e Semântica) | `de5452f5-ae9d-4de2-af64-0b12f075f5ea` | `conversation_semantic_resolver.ts`<br>`intent_rewriter.ts`<br>`os_situation_composer.ts` | Extração de entidades (modelo/placa/OS) a partir da base e aliases; separação de operação (situação vs contagem/lista); detecção de reparação conversacional (*"não foi isso"*); composição de balões nativos para desambiguação, falhas técnicas e ausência. |
| **Executor 2** (Dados e Repositório Real) | `7b9923e9-f4d2-46ff-8a6b-ea932132e04d` | `real_analysis_repository.ts`<br>`summary_evidence_adapter.ts`<br>`operational_adapter.ts`<br>`data_dictionary.ts` | Repositório de dados operacionais reais com busca parametrizada por modelo e loja (paginada, sem corte arbitrário em `rows[0]`); separação entre veículo e OS; validação estrita de cobertura da análise (loja, OS, evidência); mapeamento real da dimensão `veiculo_modelo`. |
| **Executor 3** (Dispatcher e Orquestração) | `5dffcfaf-5e84-438e-81f0-88558655f4c0` | `hybrid_os_coordinator.ts`<br>`agent_dispatcher.ts`<br>`conversation_cache_manager.ts` | Orquestração do método `inspectVehicle`; integração no `agent_dispatcher.ts` com barreira prévia de autorização; bloqueio absoluto de fallback para raio-X agregado; cache indexado por identidade confirmada, loja e geração de memória; suíte de testes de ponta a ponta. |

---

## 4. Matriz de Gates de Aceite (G01 a G15) e Testes Adicionais

| Gate | Cenário | Critério de Aceite Obrigatório |
|---|---|---|
| **G01** | *"fala sobre o linea do jabaquara por favor, qq ta acontecendo?"* | Mantém `linea` + `jabaquara`. Responde sobre o veículo ou desambigua. Proibido raio-X agregado. |
| **G02** | *"uaai nao foi isso qu eeu te pedi mano, queor entender qq ta acontecendo com o carro linea do jabaquara"* | Anula interpretação anterior; recupera o alvo individual. |
| **G03** | *"E o que combinaram com ele?"* após alvo confirmado | Usa análise do mesmo veículo/OS com autoria e cobertura validadas. |
| **G04** | Dois Linea na mesma loja | Apresenta candidatos de veículos com placas e solicita identificação. Proibido selecionar `rows[0]`. |
| **G05** | Modelo presente em outra loja, ausente na loja do gerente | Não vaza candidatos de outra loja para perfil gerente. |
| **G06** | Múltiplas OSs do mesmo veículo ou múltiplos veículos por contato | Segrega históricos; não mistura orçamentos de veículos distintos. |
| **G07** | OS aberta há mais de 30 dias / OS encerrada em histórico | Não exclui por filtros arbitrários de tempo ou status. |
| **G08** | Análise persistida válida sem `registerLink` em memória | Aproveita a análise recuperada e resolve vínculo real automaticamente. |
| **G09** | Base de análises vazia ou sem dado da OS | Entrega dados do ERP e declara limitação de análise; zero raio-X agregado substituto. |
| **G10** | Modo padrão com análise existente | Zero chamadas a mensagens brutas e zero reanálises. |
| **G11** | Consulta real de resumo de loja (*"Como tá o Jabaquara hoje?"*) | Continua funcionando normalmente como agregação. |
| **G12** | Typecheck e testes pelo `agent_dispatcher.ts` | Compilador TypeScript strict (Exit Code 0), incluindo arquivos de entrada. |
| **G13** | **Verificação em Runtime e Versão Servida** | Manifesto rastreado por commit SHA; se deploy for autorizado, comprovação da versão carregada e execução do percurso completo no bot servido. |
| **G14** | `/reset` seguido da frase de correção como primeira consulta | Funciona como turno zero sem exigir contexto anterior; nunca raio-X. |
| **G15** | Cache e telemetria pós-reset | Não reutiliza cache ou estado da geração anterior. |

### Testes Adicionais da Revisão v2.1
- **T_SEC_01:** Gerente solicita veículo de outra loja com contexto ausente -> Bloqueio antecipado pré-SQL; contexto ausente recusa acesso e nunca vira sócio.
- **T_LINK_01:** Análise recuperada com `conversationId`, mas sem cobertura da OS solicitada -> Fatos não são atribuídos ao alvo; gera lacuna `NOT_IN_ANALYSIS`.
- **T_ERR_01:** Falha técnica de banco ou timeout -> Resposta de indisponibilidade técnica preservando o alvo; nunca "veículo não encontrado".
- **T_OPER_01:** *"Quantos Linea temos no Jabaquara?"* e *"Liste os Linea"* -> Preservam modelo em operações de contagem/listagem, sem forçar situação individual e sem raio-X genérico.
- **T_CAT_01:** Modelo fora da lista popular (ex: *"Fiat Linea HLX 1.8"*, *"Tucson"*) -> Preserva referência e resolve contra a base autorizada.
- **T_AMB_01:** Um veículo com 2 OSs (histórico vs aberta) vs dois veículos de mesmo modelo -> Desambiguação distinta de veículos vs atendimentos.
- **T_CACHE_01:** Consultas subsequentes para dois Linea de placas distintas -> Chaves de cache segregadas por placa/OS; zero colisão.
- **T_SQL_01:** Compilação do filtro de modelo até a query SQL -> Mapeamento parametrizado verificado e executado sem injeção.
