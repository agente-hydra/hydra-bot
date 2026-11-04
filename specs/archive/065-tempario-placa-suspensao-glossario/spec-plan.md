# Plano de Execução — Spec 065: Tempário Técnico por Placa, Expansão do Vocabulário de Suspensão e Roteamento Multiline

**Status:** CONCLUÍDO

---

## Fase 1: Expansão do Vocabulário Técnico Automotivo (Suspensão, Direção & Transmissão)
- [x] [LEAD] **T1.1:** Atualizar regex `mechanicalComponentPattern` em `src/hydra-sync/intent_rewriter.ts` incluindo `bieleta`, `estabilizadora`, `pivo`, `terminal`, `bandeja`, `homocinetica`, `semieixo`, `coxim`, `batente`, `bucha`, `bobina`, `valvula termostatica`, etc.
- [x] [LEAD] **T1.2:** Expandir `recognizedComponents` em `extractAdaptiveTemparioQuery` para mapear componentes de suspensão e direção com normalização semântica.
- [x] [LEAD] **T1.3:** Adicionar operações canônicas para bieletas (`SUSP_BIELETA_DIANT_01`), pivôs e terminais no catálogo canônico em `src/hydra-sync/tempario_graph_repository.ts`.

## Fase 2: Roteamento de Alta Prioridade: Placa + Serviço Mecânico (Multiline e Uniline)
- [x] [LEAD] **T2.1:** Implementar Caso D em `isTemparioTechnicalQuery`: detecção prioritária de `[PLACA] + [AÇÃO MECÂNICA OU COMPONENTE]` sem colisão com histórico de OS.
- [x] [LEAD] **T2.2:** Ajustar `_rewriteIntentCore` em `src/hydra-sync/intent_rewriter.ts` para que mensagens contendo placa e serviços novos não caiam em `service_search` quando a intenção for orçar ou saber tempo/valor.
- [x] [LEAD] **T2.3:** Aprimorar `resolveVehicleFromPlateOrOs` em `src/hydra-sync/tempario_hybrid_coordinator.ts` para normalizar nomes simples de veículos do ERP (ex: `TRACKER` -> `Chevrolet Tracker`).

## Fase 3: Higienização de Artefatos Compilados (.js Obsoletos)
- [x] [LEAD] **T3.1:** Remover ou arquivar arquivos `.js` legados da pasta `src/hydra-sync/` local e na VPS que causam colisão na resolução ESM do Node/TSX.
- [x] [LEAD] **T3.2:** Validar que `agent_dispatcher_cli.ts` e `webhook-listener.js` importem as versões mais recentes sem erros de símbolo ausente.

## Fase 4: Testes de Validação, Build Gate e Verificação em Produção
- [x] [LEAD] **T4.1:** Criar suíte de testes `src/hydra-sync/tests/test_harness_tempario_placa_bieleta.ts` cobrindo:
  1. Reconhecimento sintático da frase exata do Davi: `"FCK2E73 \n\ntroca da bieleta dianteira direita"`.
  2. Resolução do veículo Tracker via OS/L2 e L1 cache.
  3. Cálculo do valor com taxa estrita de R$ 270,00/h (0,80h = R$ 216,00).
  4. Apresentação do card executivo com menu de Progressive Disclosure.
  5. Teste de não-regressão para mensagens uniline ("troca correia onix", "quanto tempo farol golf", "placa EWB4J21").
- [x] [LEAD] **T4.2:** Executar Build Gate (`npx tsc -p tsconfig.tempario.json --noEmit`).
- [x] [LEAD] **T4.3:** Sincronizar arquivos para a VPS (`operacional@100.126.50.101`), reiniciar PM2 e validar live com a mensagem do Davi.
