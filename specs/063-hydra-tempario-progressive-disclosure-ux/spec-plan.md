# Plano de Execução — Spec 063: Tempário Híbrido Aberto, Auto-Persistência e Progressive Disclosure

**Status:** CONCLUÍDO (100% IMPLEMENTADO E VALIDADO EM PRODUÇÃO)

---

## Fase 1: Extrator Adaptativo Aberto e Contratos de Aprendizado
- [x] [LEAD] **T1.1:** Criar contratos `AdaptiveTemparioExtraction`, `LearnedTemparioPackage`, `TemparioDetailChoice` e `TemparioPendingContext` em `src/hydra-sync/types/tempario_contract.ts`.
- [x] [LEAD] **T1.2:** Implementar `extractAdaptiveTemparioQuery` em `src/hydra-sync/intent_rewriter.ts` substituindo a regex estática de carros por um analisador aberto (Ação + Componente + Ano/Motor + Modelo livre) e atualizar `isTemparioTechnicalQuery`.

## Fase 2: Mecanismo de Auto-Persistência no SQLite
- [x] [LEAD] **T2.1:** Implementar `persistLearnedTemparioCatalog` em `src/hydra-sync/tempario_graph_repository.ts` para salvar veículos, motores, operações, peças e FTS em transação atômica quando um procedimento for aprendido da Web.
- [x] [LEAD] **T2.2:** Conectar a pesquisa web de `tempario_web_researcher.ts` com a auto-persistência em `tempario_hybrid_coordinator.ts`, garantindo indexação por ano/geração e taxa estrita de R$ 270,00/h.

## Fase 3: Apresentação Executiva e Interceptor de Comandos Multi-Turno
- [x] [LEAD] **T3.1:** Implementar `composeTemparioExecutiveBalloon` e `composeTemparioDetailBalloon` em `src/hydra-sync/balloon_composer.ts`.
- [x] [LEAD] **T3.2:** Implementar salvamento de `TemparioPendingContext` em `src/hydra-sync/turn_context_repository.ts` e o interceptor de comandos de menu (`1`, `2`, `3`, `4`, `peças`, `ferramentas`, etc.) no topo de `src/hydra-sync/agent_dispatcher.ts`.

## Fase 4: Testes de Validação, Build Gate e Deploy VPS
- [x] [LEAD] **T4.1:** Criar suíte de testes `src/hydra-sync/tests/test_harness_tempario_progressive_disclosure.ts` cobrindo:
  1. Modelo aberto não-semeado (ex: Corsa 2010 ou Tiggo 7 2023): pesquisa, auto-persiste e responde com taxa de R$ 270/h.
  2. Segunda chamada para o mesmo modelo: resolução instantânea via banco local (< 10ms).
  3. Diferenciação de anos/gerações (ex: Corsa 2000 vs Corsa 2010).
  4. Multi-turno: resposta executiva seguida de comando `"1"` / `"peças"` trazendo o detalhe correspondente.
- [x] [LEAD] **T4.2:** Executar Build Gate (`npx tsc -p tsconfig.tempario.json --noEmit`) e suítes de regressão.
- [x] [LEAD] **T4.3:** Sincronizar os arquivos para a VPS (`operacional@100.126.50.101`), reiniciar `hydra-bot` no PM2 e validar a resposta live via CLI de produção.
