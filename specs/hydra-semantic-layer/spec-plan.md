# Plano de Execução: Hydra — Camada Semântica de Negócio com Consultas Guiadas por Ontologia

**ID da Spec:** `hydra-semantic-layer`  
**Data:** 02/10/2026  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA LOCALMENTE / AGUARDANDO ARCHIVE (`/vibe-archive hydra-semantic-layer`)  
**Versão Normativa:** Versão 1 — 02/10/2026 (Complemento da versão 3 do plano principal)  
**Executores Designados:**  
- **Executor 1:** Subagente Local `b0b53195` (Interpretação e Semântica de Negócio)  
- **Executor 2:** Subagente Local `e913191f` (Dados e Evidências)  
- **Executor 3:** Subagente Local `f8e3704c` (Compilador, Consultas e Resposta)  
- **Principal:** Orquestrador e Integrador Central  

---

## Fase 0 (E0): Setup, Alinhamento de Contratos e Verificação

- [x] [SETUP] Confirmar ambiente de execução 100% local no Windows (`C:\Users\User\Desktop\agy\src\hydra-sync`).
- [x] [SETUP] Congelar definições de interfaces em `types/semantic_contract.ts` sem `any`.
- [x] [SETUP] Estruturação modular do catálogo semântico e evidências.

---

## Fase 1 (E1): Executor 1 — Ontologia, Glossário e Plano Semântico

- [x] [EXECUTOR 1] Criar módulo `ontology_catalog.ts`:
  - [x] Cadastrar as entidades formais (`loja`, `ordem_servico`, `veiculo`, `meta_diaria`, `faturamento_area`).
  - [x] Cadastrar métricas canônicas com fórmulas matemáticas e regras de ponderação (`cmv_percentual`, `faturamento_bruto`, `saldo_restante`).
  - [x] Mapear termos operacionais rigorosos e não-equivalências ("sem sinal", "parado", "atrasado").
- [x] [EXECUTOR 1] Atualizar `semantic_glossary.ts`:
  - [x] Integrar busca lexical/semântica contra catálogo ontológico.
  - [x] Mapear sinônimos e termos coloquiais para conceitos canônicos.
- [x] [EXECUTOR 1] Atualizar `intent_rewriter.ts` para composição semântica:
  - [x] Implementar geração do `SemanticQueryPlan` a partir de linguagem natural (`buildSemanticQueryPlan`).
  - [x] Preservar predicados múltiplos em perguntas longas e resolver anáforas/elipses contextuais.
  - [x] Diferenciar pedidos descritivos de pedidos causais ou preditivos (gerar `executionMode: 'clarify'` quando não suportado).
- [x] [EXECUTOR 1] Criar suíte de testes `tests/test_semantic_interpretation.ts`:
  - [x] Validar decomposição de planos para as 12 perguntas de amplitude.
  - [x] Testar preservação de parênteses e operadores lógicos (AND/OR/NOT).
  - [x] Garantir 100% de aprovação (PASS: 16/16).

---

## Fase 2 (E2): Executor 2 — Comprovação de Dados, Dicionário e Fixtures

- [x] [EXECUTOR 2] Criar módulo `data_dictionary.ts`:
  - [x] Mapear granularidade oficial de cada tabela do banco real (`ordens_servico`, `metas_diarias`, `faturamento_areas`).
  - [x] Registrar eventos temporais distintos (data de abertura vs data de fechamento vs data de faturamento vs updated_at).
- [x] [EXECUTOR 2] Criar módulo `evidence_repository.ts`:
  - [x] Implementar matriz de cobertura de dados por loja e período.
  - [x] Registrar flags de qualidade suspeita ou incompletude material.
  - [x] Garantir que "sem pagamentos" ou "sem serviços" só seja aceito quando a fonte comprovar cobertura completa daquela OS.
- [x] [EXECUTOR 2] Criar fixture controlada `fixtures/semantic_fixtures.ts`:
  - [x] Implementar cenário do teste **T29**: duas OSs de R$ 1.000,00, uma com múltiplas peças/pagamentos e outra com valor idêntico, para detecção de explosão cartesiana e erro de `SUM(DISTINCT)`.
  - [x] Implementar cenário do teste **T30**: múltiplos snapshots horários em `metas_diarias` para validação de seleção de foto temporal sem soma.
- [x] [EXECUTOR 2] Criar suíte de testes `tests/test_semantic_data_evidence.ts`:
  - [x] Testar fixture T29 e comprovar integridade de contagens e somas.
  - [x] Validar detecção de nulos e propagação de incompletude.
  - [x] Garantir 100% de aprovação (PASS: 21/21).

---

## Fase 3 (E3): Executor 3 — Compilador Semântico, Consultas e Resposta

- [x] [EXECUTOR 3] Criar módulo `query_builder_safe.ts`:
  - [x] Implementar gerador de SQL seguro baseado em nós AST parametrizados.
  - [x] Implementar regra anti-duplicação 1:N utilizando subconsultas correlacionadas escalares ou CTEs agregadas.
  - [x] Bloquear expressamente qualquer emissão de `SUM(DISTINCT)`.
  - [x] Bloquear qualquer instrução DDL/DML (somente SELECTs parametrizados).
- [x] [EXECUTOR 3] Criar módulo `semantic_compiler.ts`:
  - [x] Receber `SemanticQueryPlan` e validar compatibilidade de dimensões e métricas.
  - [x] Injetar cláusula `WHERE loja_slug = ?` de forma compulsoria em todos os ramos quando a persona for gerente.
  - [x] Retornar objeto `CompiledParameterizedQuery` com array de parâmetros seguros.
- [x] [EXECUTOR 3] Criar módulo `semantic_executor.ts`:
  - [x] Executar queries parametrizadas no SQLite com timeout estrito de 5.000ms.
  - [x] Converter linhas brutas em agregados respeitando pesos e numeradores/denominadores.
- [x] [EXECUTOR 3] Atualizar `balloon_composer.ts`:
  - [x] Formatar balões respeitando o orçamento de 700 a 900 caracteres.
  - [x] Inserir ressalvas transparentes de cobertura parcial ou estimativa quando aplicável.
  - [x] Garantir formato nativo WhatsApp com zero asteriscos duplos (`**`).
- [x] [EXECUTOR 3] Criar suíte de testes `tests/test_semantic_compiler.ts`:
  - [x] Validar compilação segura sem duplicação no cenário T29.
  - [x] Testar rejeição de injeção SQL e tentativas de escape de escopo de loja.
  - [x] Garantir 100% de aprovação (PASS: 12/12).

---

## Fase 4 (E4): Agente Principal — Integração e Verificação Cruzada

- [x] [PRINCIPAL] Verificar compatibilidade de contratos entre `semantic_contract.ts`, `ontology_catalog.ts`, `semantic_compiler.ts` e `semantic_executor.ts`.
- [x] [PRINCIPAL] Garantir narrow estrito de tipos em `query_builder_safe.ts` (`isColumnRef`).
- [x] [PRINCIPAL] Criar a suíte master `tests/test_semantic_end_to_end.ts` cobrindo o fluxo completo.

---

## Fase 5 (E5): Suíte Completa de Testes T01 a T40 e Build Gate

- [x] [TESTES] Executar regressão completa da suíte T01 a T28.
- [x] [TESTES] Executar testes avançados T29 a T40:
  - [x] **T29:** OS com peças/pagamentos múltiplos e outra de igual valor (sem multiplicação cartesiana nem `SUM(DISTINCT)`).
  - [x] **T30:** Snapshots horários de faturamento (seleção da última posição, sem somar fotos).
  - [x] **T31:** Precedência de operadores booleanos AND/OR/NOT e teste de nulos.
  - [x] **T32:** Detecção de ausência de pagamentos com cobertura parcial (recusa de afirmação categórica falsa).
  - [x] **T33:** Pedido de financeiro por responsável (bloqueio de rateio fictício).
  - [x] **T34:** Ponderação correta de ticket médio e CMV combinado (proibição de média simples de índices).
  - [x] **T35:** Comparação com mês anterior e períodos parciais alinhados.
  - [x] **T36:** Continuação conversacional com correções e preservação de filtros válidos.
  - [x] **T37:** Tentativa de injeção de identificadores SQL livres no plano semântico (bloqueio e escopo de gerente).
  - [x] **T38:** Contagem após busca textual/semântica (amostras candidatas delimitadas sem inflar total exato).
  - [x] **T39:** Perguntas causais ("por que caiu?") e preditivas ("quanto vamos faturar?") com declaração de limites.
  - [x] **T40:** Combinação inédita de filtros e agrupamento sem rota prévia cadastrada.
- [x] [TESTES] Rodar as quatro suítes completas de testes locais (66 testes aprovados no total).
- [x] [BUILD GATE] Executar typecheck `npx tsc --noEmit` em todo o projeto (zero erros de compilação).

---

## Fase 6 (E6): Hard Stop e Prontidão para Archive

- [ ] [DEPLOY] Sincronizar artefatos validados de staging para `/opt/bots/src/hydra-sync/` e `/home/operacional/hydra/`.
- [ ] [DEPLOY] Recarregar PM2 (`pm2 reload hydra-bot`) e checar logs de sanidade.
- [ ] [VALIDAÇÃO] Validar execução de perguntas ao vivo nos números autorizados (Davi e Marcos).
- [ ] [RELATÓRIO] Consolidar relatório final com métricas, latências, hashes de commit e evidências reais.
- [ ] [HARD STOP] Apresentar resumo ao usuário e aguardar comando `/vibe-archive hydra-semantic-layer`.
