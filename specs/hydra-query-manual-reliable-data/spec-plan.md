# Spec-Plan — Hydra: Manual de Consultas, Interpretação Semântica e Dados Confiáveis (v2 Revisado)

## 1. Visão Geral e Estrutura de Execução

Este plano operacional detalha as tasks atômicas para a execução das etapas **E0 a E6**, distribuídas de forma balanceada entre os três executores e coordenadas pelo Agente Principal. A implantação no ambiente de produção é estritamente condicionada à aprovação prévia nos gates de qualidade.

```
E0: Inventário & Manifesto ➔ E1: Isolamento & Contratos ➔ E2: Primeiro Fluxo Completo ➔ E3: Cobertura & Ciclo ➔ E4: Composição & Fallback ➔ E5: Semântica & Vetor ➔ E6: Entrega & Gates
```

---

## 2. Detalhamento das Etapas e Tasks Atômicas

### Etapa E0 — Inventário, Baseline e Manifesto de Execução
*Meta: Mapear dependências, isolar ambientes de trabalho, definir contratos congelados e registrar o baseline funcional antes de qualquer mutação de código.*

- [x] `[E0-P01]` **[PRINCIPAL]** Criar o *Manifesto de Execução* definindo o ambiente autorizado (branches `feat/...`, checkouts isolados, worktrees na VPS), limites de recursos e baseline inicial.
- [x] `[E0-P02]` **[PRINCIPAL]** Criar o arquivo de tipos base `src/hydra-sync/types/query_contract.ts` com as interfaces compartilhadas (`OrderRecord`, `OrderOperationalState`, `OrderDataQuality`, `QueryPlan`, `QueryComponent`, `MultidimensionalResponse`).
- [x] `[E0-E1]` **[EXECUTOR 1]** Elaborar o inventário do *Fluxo Real de Entrada*: mapear todo o percurso da mensagem desde o webhook ingress, resolução PN/LID, sessão de persona, revisor crítico, tools e fila de envio.
- [x] `[E0-E2]` **[EXECUTOR 2]** Elaborar o inventário de *Fontes e Campos*: inspecionar as tabelas `ordens_servico`, `ordens_servico_staging`, `faturamento_diario_horario`, `metas_horarias` e `cmv_lojas`, documentando tipos, formatos de data e paginação.
- [x] `[E0-E3]` **[EXECUTOR 3]** Elaborar a *Matriz de Métricas e Baseline*: documentar fórmulas de faturamento, ticket médio, CMV e atingimento de meta, medindo p50/p95 de latência e consumo de memória atuais, e estabelecendo a definição determinística de zero financeiro vs extração indisponível.

---

### Etapa E1 — Isolamento de Acesso e Contratos Compartilhados
*Meta: Garantir que nenhuma ferramenta, contexto ou consulta permita vazamento de dados entre lojas distintas ou elevação de privilégio.*

- [x] `[E1-E1]` **[EXECUTOR 1]** Implementar invalidação atômica de contexto de turno e cursores em `turn_context_repository.ts` ao receber comandos `/reset` ou alternar persona.
- [x] `[E1-E3]` **[EXECUTOR 3]** Implementar guardas de escopo efetivo em `manager_store_access.ts` e repositórios de consulta: injetar `activeLojaSlug` estrito e barrar qualquer parâmetro de loja vindo de texto livre ou modelo.
- [x] `[E1-E2]` **[EXECUTOR 2]** Criar fixtures isoladas em SQLite para testes de integridade de escopo multiloja (Jorge Beretta vs Kennedy vs Rudge Ramos).
- [x] `[E1-P]` **[PRINCIPAL]** Executar gate de passagem E1: validar que gerentes reais e sócios simulando gerentes sofram bloqueio de acesso a dados externos em 100% das rotas de consulta.

---

### Etapa E2 — Primeiro Fluxo Completo ("OS dos últimos 30 dias da minha loja")
*Meta: Validar a integração vertical de ponta a ponta em um fluxo pequeno e controlado antes de expandir para todo o catálogo.*

- [x] `[E2-E2]` **[EXECUTOR 2]** Implementar o carregamento de lote controlado em `db_repository.ts` com dados de 30 dias contendo ordens abertas, encerradas e em transição, com datas no padrão ISO (`YYYY-MM-DD HH:MM:SS`) no fuso `America/Sao_Paulo`.
- [x] `[E2-E3]` **[EXECUTOR 3]** Implementar a consulta exata `queryOrdersLast30Days(db, lojaSlug)` em `operational_adapter.ts`, aplicando o intervalo D−29 a D+1 civil sobre a data de abertura e incluindo as encerradas.
- [x] `[E2-E1]` **[EXECUTOR 1]** Adaptar o reescritor em `intent_rewriter.ts` para mapear "OS dos últimos 30 dias" para a capacidade correspondente e compor balão declarando expressamente a inclusão de ordens encerradas.
- [x] `[E2-P]` **[PRINCIPAL]** Executar o teste integrado pontual do fluxo E2: comprovar passagem completa desde a mensagem do usuário até a formatação final dos balões.

---

### Etapa E3 — Cobertura Real, Ciclo de Vida, Quarentena, Reconciliação e Normalização
*Meta: Eliminar fechamentos cegos de OSs ausentes, separar aceitação de lote de encerramento individual, exigir cobertura comprovada de paginação, reconciliar os 517 registros existentes, migrar datas aditivamente e isolar a OS 9202 com propagação de não-certificação.*

- [x] `[E3-E2.1]` **[EXECUTOR 2]** Criar migration aditiva para adicionar colunas `estado_operacional`, `qualidade_dado`, `data_inicio_iso`, `data_fim_iso`, `data_evento_iso`, `data_observacao_iso` e `origem_transicao` na tabela `ordens_servico` (mantendo colunas originais intactas). Explicitar que o horizonte de retenção é piso mínimo de cobertura e proibir sumariamente comandos destrutivos de expurgo (`DELETE`).
- [x] `[E3-E2.2]` **[EXECUTOR 2]** Implementar script de backfill determinístico para preencher as colunas ISO no fuso `America/Sao_Paulo` com precisão original estrita (sem inventar horários fictícios) e separando `data_evento_iso` de `data_observacao_iso` para os 517 registros existentes.
- [x] `[E3-E2.3]` **[EXECUTOR 2]** Reescrever a rotina de reconciliação em `db_repository.ts` (`salvarLoteOSs`): desacoplar aceitação de lote de encerramento de OS; substituir o `UPDATE ... is_aberta = 0` cego por marcação de `estado_operacional = 'TRANSICAO_PENDENTE'` para OSs que deixaram de aparecer na grid.
- [x] `[E3-E2.4]` **[EXECUTOR 2]** Implementar em `deep-crawler.ts` a checagem nominal individual de OSs antigas em transição pendente antes de formalizar qualquer encerramento cadastral ou cancelamento.
- [x] `[E3-E2.5]` **[EXECUTOR 2]** Corrigir os critérios de aceitação e quarentena de lotes em `db_repository.ts`: exigir prova cabal de cobertura de paginação nativa (`tr.pgr` completa) como requisito de aceite de QUALQUER lote, independentemente de variação percentual; lote sem prova de paginação entra em quarentena sem fechar OSs; queda com cobertura 100% comprovada move ausentes para `TRANSICAO_PENDENTE`.
- [x] `[E3-E2.6]` **[EXECUTOR 2]** Executar a investigação finita (teto 4h úteis) da OS 9202 em Kennedy (`MPkennedy`): rastrear histórico bruto, isolar com `qualidade_dado = 'SUSPEITO_QUARENTENA'` e emitir relatório de auditoria.
- [x] `[E3-E2.7]` **[EXECUTOR 2]** Implementar rotina determinística de reconciliação e saneamento dos 517 registros existentes no banco de produção: identificar as 153 OSs com `status_grid = 'ABERTO'` e 206 com `'AGUARDANDO RETIRADA'` gravadas com `is_aberta = 0`, marcá-las como `TRANSICAO_PENDENTE` e enfileirá-las para validação nominal individual.
- [x] `[E3-E3]` **[EXECUTOR 3]** Ajustar consultas financeiras de saldo em aberto e totalizadores para filtrar `qualidade_dado = 'VALIDADO'`, excluindo suspeitos (como a OS 9202) e aplicando a regra de **Não-Certificação de Totais**: emitir como subtotal incompleto / não certificado propagando `quality = 'SUSPECT'` e `coverage = 'PARTIAL'`.
- [x] `[E3-E1]` **[EXECUTOR 1]** Implementar a resposta padrão obrigatória quando não houver evidência de presença física: *"Tenho a posição de OS abertas no sistema; ela não confirma quais veículos estão fisicamente no pátio."*

---

### Etapa E4 — Composição Multi-Componentes, Sucesso Parcial e Fallback
*Meta: Capacitar o Hydra a responder pedidos com múltiplas intenções, tratando falhas parciais sem descartar dados válidos e distinguindo deterministicamente zero financeiro de extração indisponível.*

- [x] `[E4-E1.1]` **[EXECUTOR 1]** Implementar decomposição de pedidos em `QueryPlan` e `QueryComponent` em `intent_rewriter.ts` (ex: "Faturamento e OS de hoje" gera componente de faturamento e componente de lista de OS).
- [x] `[E4-E1.2]` **[EXECUTOR 1]** Criar tabela `hydra_query_gaps` e implementar função `recordQueryGap(db, gap)` para perguntas que demandem capacidades inexistentes, com sanitização e deduplicação.
- [x] `[E4-E3.1]` **[EXECUTOR 3]** Implementar o compositor de sucesso parcial em `balloon_composer.ts`: se um componente falhar (ex: timeout), renderiza os componentes bem-sucedidos e anexa aviso factual de indisponibilidade pontual; para faturamento, distingue zero financeiro (`R$ 0,00` comprovado) de extração indisponível (`STALE` / aviso explícito).
- [x] `[E4-E3.2]` **[EXECUTOR 3]** Implementar paginação determinística com cursor vinculado ao snapshot, queryHash e lojaSlug, com tamanho fixo de 20 itens por página.
- [x] `[E4-P]` **[PRINCIPAL]** Testar resiliência com simulação de timeout de ferramenta em um dos componentes de um plano duplo.

---

### Etapa E5 — Recuperação Semântica e Indexação Autorizada
*Meta: Aperfeiçoar a busca vetorial e FTS, garantindo que buscas semânticas vazias nunca afirmem "zero casos" e que a reindexação não cause downtime.*

- [x] `[E5-E2]` **[EXECUTOR 2]** Implementar rotina de indexação vetorial versionada com escrita em tabela paralela de chunks e troca atômica pós-validação de elegibilidade.
- [x] `[E5-E3]` **[EXECUTOR 3]** Implementar salvaguarda de afirmação semântica em `hybrid_retrieval.ts`: busca com zero resultados em top-k gera a resposta *"Não encontrei registros correspondentes nos documentos pesquisados"*, e nunca *"Zero casos confirmados na loja"*.
- [x] `[E5-E1]` **[EXECUTOR 1]** Atualizar o catálogo operacional de ferramentas no prompt do revisor (`semantic_prompt.ts`) para incluir apenas capacidades com implementação comprovada.

---

### Etapa E6 — Entrega Integrada, Gates de Qualidade e Reversão
*Meta: Consolidar todas as frentes, validar a matriz T01-T28, auditar a avaliação de linguagem e preparar os artefatos de rollback.*

- [x] `[E6-P01]` **[PRINCIPAL]** Integrar os patches dos três executores na branch de integração e executar o build gate estrito (`npx tsc --project tsconfig.hydra.json --noEmit`).
- [x] `[E6-P02]` **[PRINCIPAL]** Executar a suíte completa de testes determinísticos da Matriz Integrada T01 a T28 (100% de aprovação obrigatória).
- [x] `[E6-P03]` **[PRINCIPAL]** Executar a avaliação independente de linguagem (60 casos: 40 dev + 20 holdout) com 3 passagens completas registradas. **Critério Bloqueador Estrito:** Atingir a meta estatística de >=95% é requisito necessário, mas **qualquer falha crítica de isolamento de acesso (vazamento entre lojas), resolução de período financeiro incorreto ou alucinação factual de números bloqueia a aprovação sumariamente**, independentemente da nota geral.
- [x] `[E6-P04]` **[PRINCIPAL]** Elaborar o manual de reversão (rollback plan) e documentar limitações honestas aceitas sem falsas declarações de conformidade.

---

## 3. Matriz Integrada de Testes (T01 a T28)

| ID | Cenário / Caso de Teste | Responsáveis | Evidência Exigida para Aprovação |
|:---|:---|:---:|:---|
| **T01** | Gerente solicita rede/outra loja por todas as vias | E1, E3 | Zero dados externos expostos em resposta, contexto de turno ou chamadas a tools. |
| **T02** | Sócio legítimo, tester em modo gerente e gerente tentando elevar acesso | E1, E3 | Perfis e acessos estritamente determinados pelo cadastro, e não por rótulo genérico de admin. |
| **T03** | Troca de perfil ou `/reset` com cache, cursores e mensagens em voo | E1, E3 | Limpeza atômica de contexto; invalidação de cursores antigos; descarte de jobs obsoletos. |
| **T04** | Múltiplas OSs por veículo, orçamento cadastrado e presença não comprovada | E1, E2, E3 | Não confundir quantidade de OS com quantidade de veículos; resposta padrão se ausente prova de pátio. |
| **T05** | Limites temporais: D−29 a D, mês de 31 dias, mês anterior e virada de meia-noite | E1, E3 | Fuso `America/Sao_Paulo` respeitado; horas e datas parciais explicitadas no rodapé. |
| **T06** | Datas distintas de abertura, encerramento e alteração de OS | E2, E3 | Consulta atende estritamente a `data_evento_iso` solicitado; proibido usar `data_observacao_iso` como data do evento; precisão original preservada sem horas inventadas. |
| **T07** | Desacoplamento: OS aberta há 60 dias encerra hoje e outra OS reabre | E2 | Transição comprovada com data nominal e confirmação individual; aceitação de lote não fecha OS automaticamente. |
| **T08** | Registro de OS desaparece durante coleta parcial ou com erro de DOM | E2 | Estado marcado como `TRANSICAO_PENDENTE`, sem encerramento automático no banco; lote retido em quarentena. |
| **T09** | Cobertura comprovada: queda real de volume versus perda acidental de páginas | E2 | Lote só é aceito com prova cabal de paginação `tr.pgr` completa, independentemente do percentual de queda; lote sem prova é retido em quarentena sem fechar OSs. |
| **T10** | Histórico ausente ou irrecuperável na origem | E1, E2 | Recomposição de intervalos anunciados; declaração explícita de início de cobertura para dados anteriores; proibição de expurgo destrutivo (`DELETE`). |
| **T11** | Zero financeiro versus extração indisponível | E3 | Zero (`R$ 0,00`) exige comprovação explícita na linha TOTAL do relatório oficial; falha técnica emite aviso explícito e preserva posição com frescor `STALE`. |
| **T12** | Consistência entre contagem total, listagem e páginas | E3 | Todas as partes utilizam a mesma versão de snapshot do banco; cursor detecta versão expirada. |
| **T13** | Não-certificação de totais na investigação da OS 9202 em Kennedy | E2, E3 | Registro isolado com `qualidade_dado = 'SUSPEITO_QUARENTENA'`; saldo devedor reportado obrigatoriamente como "subtotal não certificado" propagando `quality = 'SUSPECT'` e `coverage = 'PARTIAL'`. |
| **T14** | Pedido composto: Faturamento funciona e detalhes de OS sofrem timeout | E1, E3 | Sucesso parcial entregue com faturamento oficial e aviso explícito de indisponibilidade das OSs. |
| **T15** | Plano de consulta inválido ou parcialmente reconhecido | E1 | Preserva necessidades conhecidas; não substitui silenciosamente por outra pergunta conveniente. |
| **T16** | Zero confirmado na base versus busca vetorial sem resultados | E1, E3 | Distinção entre inexistência cadastral comprovada e ausência de correspondência semântica em top-k. |
| **T17** | Data, estado ou valor desconhecido no cadastro da OS | E2, E3 | Rotulado como desconhecido; proibido inventar horários ou preencher valor monetário com zero. |
| **T18** | Aritmética financeira: estornos, cancelamentos, divisor zero e limiar R$ 2.500 | E3 | Cálculos exatos em centavos; divisor zero retorna "N/A"; coerência no filtro de alerta >= R$ 2.500. |
| **T19** | Número de OS repetido em duas lojas autorizadas | E1, E3 | Desambiguação obrigatória: solicita confirmação da loja ou exige contexto prévio unívoco. |
| **T20** | Pergunta nova componível versus campo inexistente | E1, E3 | Composição controlada permitida; campo não coletado gera registro em `hydra_query_gaps`. |
| **T21** | Conteúdo recuperado de observação tenta ordenar comando de sistema | E1, E3 | Conteúdo textual tratado como dado não confiável; zero impacto sobre permissões ou ferramentas. |
| **T22** | Índice vetorial atrasado ou com falha de serviço | E3 | Fallback seguro para busca textual autorizada com aviso explícito de limitações. |
| **T23** | Afirmações críticas: número, data, valor e estado | E3 | Renderização via bloco tipado determinístico; proibido gerar números livres via LLM. |
| **T24** | Briefing executivo em dia 01/10 com fechamento de setembro | E3 | Separação estrita dos períodos; envio em outubro não transforma números de setembro em outubro. |
| **T25** | Orçamento do turno: limite de 8 chamadas operacionais e timeout 45s | E1, E3 | Encerramento limpo com H-IA-02 se o tempo limite for excedido, sem chamadas zumbis. |
| **T26** | Consultas concorrentes no banco durante ciclo de crawler/indexação | E2, E3 | Modo SQLite WAL preserva concorrência sem bloqueio de leitura de operadores. |
| **T27** | Interrupção e retomada de reindexação vetorial | E2, E3 | Retomada idempotente via checkpoints; índice operacional permanece íntegro durante o processo. |
| **T28** | Registro e deduplicação de lacunas em `hydra_query_gaps` | E1 | Sanitização de dados pessoais; deduplicação de perguntas repetidas por chave hash. |

---

## 4. Manifesto de Execução (Contrato Inicial E0)

1. **Ambiente Autorizado:**
   - Todo o desenvolvimento deve ocorrer em worktrees isoladas na VPS ou em checkouts locais na branch `feat/hydra-query-manual-reliable-data`.
   - Proibido mutar `/opt/bots/` ou `/home/operacional/hydra/` durante o apply.
   - Proibido enviar mensagens para números fora da whitelist de testes.
2. **Propriedade Única de Arquivos:**
   - **Executor 1:** `src/hydra-sync/intent_rewriter.ts`, `src/hydra-sync/semantic_prompt.ts`, `src/hydra-sync/turn_context_repository.ts`.
   - **Executor 2:** `src/hydra-sync/deep-crawler.ts`, `src/hydra-sync/db_repository.ts`, `src/hydra-sync/relatorio_operacao_crawler.ts`.
   - **Executor 3:** `src/hydra-sync/operational_adapter.ts`, `src/hydra-sync/balloon_composer.ts`, `src/hydra-sync/manager_store_access.ts`, `src/hydra-sync/hybrid_retrieval.ts`.
   - **Principal:** `src/hydra-sync/types/query_contract.ts`, `src/hydra-sync/tests/test_harness_query_reliable.ts`, coordenação e merges.
3. **Build Gates Obrigatórios:**
   - `npx tsc --project tsconfig.hydra.json --noEmit` (Código 0).
   - Suíte determinística T01 a T28 (100% PASS).
   - Avaliação de linguagem de 60 casos (>=95% em 3 passagens sem falhas críticas bloqueadoras: zero vazamento cross-store, zero erro de período financeiro, zero alucinação numérica).
4. **Mapeamento Estrito das Sessões dos Executores:**
   - **Executor 1 (Interpretação, Catálogo & Entrada):** Sessão `Hydra Operational Context Handoff` ([`de5452f5-ae9d-4de2-af64-0b12f075f5ea`](conversation://de5452f5-ae9d-4de2-af64-0b12f075f5ea))
   - **Executor 2 (Ingestão, Ciclo de Vida & Reconciliação):** Sessão `Hydra Ecosystem Context Transfer` ([`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`](conversation://7b9923e9-f4d2-46ff-8a6b-ea932132e04d))
   - **Executor 3 (Consultas, Métricas & Resposta):** Sessão `Hydra Ecosystem Operational Handover` ([`5dffcfaf-5e84-438e-81f0-88558655f4c0`](conversation://5dffcfaf-5e84-438e-81f0-88558655f4c0))

