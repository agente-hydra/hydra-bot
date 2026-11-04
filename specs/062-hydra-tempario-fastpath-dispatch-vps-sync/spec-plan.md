# Plano de Execução — Spec 062: Fast-Path de Tempário, Extração Multi-Serviço, Placa->Veículo e Sync VPS

**Status:** CONCLUÍDO

---

## Fase 1: Tokenização de Serviços, FTS5 Multi-Componente e Resolução por Placa
- [x] [LEAD] **T1.1:** Implementar `extractTemparioEntitiesFromText` em `src/hydra-sync/intent_rewriter.ts` para extrair componentes mecânicos individuais (`['farol', 'radiador']`, `['correia', 'bomba']`, etc.), motor (`1.4 TSI`, `1.0 Turbo`, etc.), ano e placa, atualizando o bloco `2.8.9 Tempário Técnico Automotivo`.
- [x] [LEAD] **T1.2:** Implementar `buildTemparioFtsQuery` em `src/hydra-sync/tempario_vector.ts` removendo stopwords conversacionais e unindo componentes técnicos com `OR` no FTS5.
- [x] [LEAD] **T1.3:** Implementar `resolveVehicleFromPlateOrOs` e tokenização resiliente de `servicosSolicitados` + auto-seed idempotente em `src/hydra-sync/tempario_hybrid_coordinator.ts`.

## Fase 2: Fast-Path Determinístico no Dispatcher e Operational Adapter
- [x] [LEAD] **T2.1:** Adicionar o handler `TEMPARIO_TEMPO_SERVICO` no topo de `_executeOperationalQueryCore` em `src/hydra-sync/operational_adapter.ts` (antes da linha 1060 `if (intent.veiculo)` para impedir sequestro pela busca de permanência no pátio).
- [x] [LEAD] **T2.2:** Adicionar o bloco Fast-Path `3.0.4 TEMPÁRIO TÉCNICO HÍBRIDO AUTOMOTIVO` em `src/hydra-sync/agent_dispatcher.ts` com suporte a resolução por modelo e por placa (`FOE6I25`, `EMN3F05`, etc.), respeitando o escopo `socio` (`REDE_10_LOJAS`) e `gerente` (`LOJA_ISOLADA`).

## Fase 3: Testes End-to-End de Linguagem Natural (`dispatchTurn`)
- [x] [LEAD] **T3.1:** Adicionar testes de integração real chamando `dispatchTurn` com a frase exata do usuário (`"Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?"`) e com placa real (`"FOE6I25 quanto tempo e valor de mão de obra pra trocar farol e radiador?"`), validando que a resposta traz **3,05h**, **R$ 823,50 (a R$ 270/h)**, **6 peças** e **12 ferramentas** em < 100ms.
- [x] [LEAD] **T3.2:** Executar Build Gate (`npx tsc -p tsconfig.tempario.json --noEmit`) e suítes de regressão (`test_harness_tempario.ts` e `test_harness_tempario_stress.ts`).

## Fase 4: Sincronização e Ativação no `hydra-bot` da VPS
- [x] [LEAD] **T4.1:** Sincronizar os arquivos do Tempário e Dispatcher para `/home/operacional/hydra/src/hydra-sync/` e `/home/operacional/hydra-deploy/current/src/hydra-sync/` na VPS (`operacional@100.126.50.101`).
- [x] [LEAD] **T4.2:** Popular o catálogo canônico no banco de produção `/home/operacional/hydra-data/hydra_ops.db`, reiniciar `hydra-bot` no PM2 e validar `dispatchTurn` direto na VPS com a pergunta de Davi e com a placa real `FOE6I25` (Golf da `MPdompedro1`).
