# Plano de Execução — Spec 066: Tempário Híbrido com IA + MCP, Pesquisa Técnica Web Real e Blindagem Anti-Alucinação

**Status:** CONCLUÍDO (HARD STOP — AGUARDANDO /sdd-archive)

---

## Fase 1: Expurgo de Poluição no SQLite, Seed Idempotente e Persistência Multi-Etapa
- [x] [LEAD] **T1.1:** Implementar `purgePollutedTemparioCatalog(db)` e `isValidVehicleForPersistence(marca, modelo)` em `src/hydra-sync/tempario_graph_repository.ts` para expurgar imediatamente registros fantasma (`veh_veculo_veculopasseio_2002_2012`, `veh_nacional_veculo_2002_2012`, `veh_nacional_tracker_2002_2012`, `veh_nacional_corsa_2002_2012` e operações órfãs/1-step `WEB-EST-01`) e bloquear qualquer persistência futura de veículos genéricos.
- [x] [LEAD] **T1.2:** Corrigir o gatilho de seed no construtor de `TemparioHybridCoordinator` (`src/hydra-sync/tempario_hybrid_coordinator.ts`), removendo a trava falha `if (opCount.c === 0)` e garantindo que `purgePollutedTemparioCatalog` + `seedCanonicalTemparioCatalog` rodem na inicialização do processo para sincronizar `gm_tracker_2020_2025` e novas operações OEM no `hydra_ops.db` da VPS.
- [x] [LEAD] **T1.3:** Atualizar `persistLearnedTemparioCatalog` em `src/hydra-sync/tempario_graph_repository.ts` para persistir todas as sub-operações (`tempario_suboperations`), arestas de ordem (`tempario_dependencies_edges`) e peças (`tempario_operation_parts`) geradas pela pesquisa IA/Web, além de adicionar as operações canônicas de **Substituição do Motor de Partida (Arranque)**.

## Fase 2: Extrator Híbrido Aberto, Fim do Sequestro por Stopword e Vínculo de Placa em 2 Turnos
- [x] [LEAD] **T2.1:** Refatorar `extractAdaptiveTemparioQuery` e `extractTemparioEntitiesFromText` em `src/hydra-sync/intent_rewriter.ts` para:
  1. Separar e remover a placa/OS antes de extrair a frase limpa do serviço (nunca injetando `EUS5006 \n\n` no nome do serviço).
  2. Suportar extração aberta de qualquer serviço mecânico ou elétrico (`motor de partida`, `motor de arranque`, `arranque`, `alternador`, `bomba de combustivel`, `caixa de direcao`, `junta do cabecote`, `bieleta`, etc.) sem engessar em listas fechadas.
- [x] [LEAD] **T2.2:** Eliminar o sequestro de operações por stopwords em `TemparioHybridCoordinator.coordinateQuery` (`src/hydra-sync/tempario_hybrid_coordinator.ts` linhas 346-382): filtrar verbos/termos genéricos (`troca`, `trocar`, `substituicao`, `servico`, `motor` isolado) e exigir match do componente técnico nuclear solicitado pelo usuário.
- [x] [LEAD] **T2.3:** Implementar em `src/hydra-sync/apibrasil_plate_client.ts`, `src/hydra-sync/turn_context_repository.ts` e `src/hydra-sync/agent_dispatcher.ts` o fluxo de **Placa Não Resolvida (`TEMPARIO_AWAITING_VEHICLE_FOR_PLATE`)**:
  1. Tentativa de resolução em `ordens_servico` -> `placa_lookup_cache` -> APIBrasil -> busca web pública da placa.
  2. Se a placa não existir em nenhuma base (ex: `EUS5006`), salvar o serviço pendente e perguntar em 1 balão limpo qual é o modelo/ano do veículo (proibido assumir `"Veículo Passeio"`).
  3. Quando o operador responder o modelo no turno seguinte (ex: `"Palio 1.0 2012"`), gravar `EUS5006 -> Fiat Palio 1.0 2012` em `placa_lookup_cache` e disparar imediatamente o card de tempário do serviço que aguardava!

## Fase 3: Agente de Pesquisa Técnica Web + Síntese Multi-Etapa com IA e Tool MCP
- [x] [LEAD] **T3.1:** Reformular `src/hydra-sync/tempario_web_researcher.ts` e sua integração com `src/hydra-sync/tempario_hybrid_coordinator.ts` e `src/hydra-sync/balloon_composer.ts`:
  1. Busca web ativa de manuais/portais técnicos + síntese estruturada (via IA / decompositor de engenharia automotiva) gerando sempre **3 a 5 etapas reais de execução** (`DESMONTAGEM`, `ACESSO`, `EXECUCAO`, `FINALIZACAO`) com ferramentas específicas, peças e torques em Nm.
  2. Proibição absoluta de gerar etapa única genérica `"1. Execução de ... (Pesquisa Técnica Web)"` ou cabeçalho `"Nacional [modelo] (2002-2012) · Motor Motor Padrão"`.
  3. Cálculo estrito e determinístico da mão de obra pela taxa fixa da rede (**R$ 270,00/h**).
- [x] [LEAD] **T3.2:** Atualizar a tool MCP `consultar_tempario_hibrido` em `src/hydra-sync/mcp_server.ts` para aceitar `placa` e `os_id` opcionais e expor o pipeline completo ao agente MCP.

## Fase 4: Bateria de Testes E2E, Build Gate, Saneamento da VPS e Deploy
- [x] [LEAD] **T4.1:** Criar suíte de testes `src/hydra-sync/tests/test_harness_spec066_ia_web_anti_hallucination.ts` validando:
  1. `FCK2E73 \n\ntroca da bieleta dianteira direita` -> retorna `Chevrolet Tracker (2020-2025)`, `0,80h = R$ 216,00`, e a opção `3` retorna os 3 passos técnicos reais com torques (55 Nm e 120 Nm), sem rastro de `TRACKER (2002-2012)`.
  2. Sequência imediata `EUS5006 \n\ntroca de motor de partida` -> ZERO contaminação de `bieleta`, ZERO `"Veículo Passeio"`, solicita o modelo da placa `EUS5006` e, ao receber `"Palio 1.0 2012"`, vincula a placa no cache e retorna o tempário de **Motor de Partida** a R$ 270,00/h com 4 etapas reais de oficina.
  3. Consulta aberta de modelo e serviço não catalogados (ex: `"Corsa 2010 troca de motor de partida"`) retornando marca/ano reais, etapas completas e taxa de R$ 270,00/h.
- [x] [LEAD] **T4.2:** Executar Build Gate (`npx tsc -p tsconfig.tempario.json --noEmit`) com ZERO erros.
- [x] [LEAD] **T4.3:** Executar expurgo no SQLite da VPS (`100.126.50.101`), sincronizar artefatos, recompilar `balloon_composer.js`, reiniciar PM2 (`hydra-bot`) e validar diretamente no banco e runtime de produção.
