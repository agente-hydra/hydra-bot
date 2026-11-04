# Plano de Execução — Spec 064: Consulta Veicular Direta por Placa (APIBrasil & Cache SQLite Nativo)

**Status:** CONCLUÍDO

---

## Fase 1: Contrato de Dados, Cliente HTTP e Tabela SQLite
- [x] [LEAD] **T1.1:** Criar contratos TypeScript em `src/hydra-sync/types/plate_lookup_contract.ts` (`ApiBrasilPlateResponse`, `VehiclePlateRecord`, `PlateLookupOptions`).
- [x] [LEAD] **T1.2:** Criar cliente desacoplado `src/hydra-sync/apibrasil_plate_client.ts` com:
  - Criação da tabela `placa_lookup_cache` e índices no SQLite.
  - Função `normalizePlate` para placas Mercosul e cinza.
  - Função `queryPlateFromApiBrasil` consumindo `https://gateway.apibrasil.io/api/v2/vehicles/dados`.
  - Função Cache-First `lookupVehiclePlate` (consulta cache local antes de gastar cota externa).

## Fase 2: Integração com o Tempário Técnico Híbrido
- [x] [LEAD] **T2.1:** Conectar `lookupVehiclePlate` em `resolveVehicleFromPlateOrOs` no arquivo `src/hydra-sync/tempario_hybrid_coordinator.ts`, permitindo que placas sem OS prévia resolvam modelo/ano/motor automaticamente.
- [x] [LEAD] **T2.2:** Testar injeção do veículo resolvido para o Fast-Path de cálculo de mão de obra (R$ 270,00/h).

## Fase 3: Apresentação Visual Hermes e Interceptor Direto de Placa
- [x] [LEAD] **T3.1:** Implementar formatador `composePlateVehicleBalloon` em `src/hydra-sync/balloon_composer.ts` no padrão nativo Hermes V2.
- [x] [LEAD] **T3.2:** Implementar detecção `isDirectPlateQuery` em `src/hydra-sync/intent_rewriter.ts` e interceptor de mensagens no início de `src/hydra-sync/agent_dispatcher.ts`.

## Fase 4: Testes de Validação, Build Gate e Deploy VPS
- [x] [LEAD] **T4.1:** Criar suíte de testes `src/hydra-sync/tests/test_harness_plate_lookup.ts` validando:
  1. Normalização de placas antigas e Mercosul.
  2. Cache hit local no SQLite (< 2ms) sem chamar API externa.
  3. Resolução de placa desconhecida acionando APIBrasil e persistindo em `placa_lookup_cache`.
  4. Fluxo E2E: Pergunta de tempário contendo apenas a placa ("quanto tempo pra trocar correia do FOE6I25") sem OS prévia.
  5. Consulta direta de placa retornando balão cadastral Hermes.
- [x] [LEAD] **T4.2:** Executar Build Gate (`npx tsc -p tsconfig.tempario.json --noEmit`) e testes de regressão.
- [x] [LEAD] **T4.3:** Sincronizar arquivos para a VPS (`operacional@100.126.50.101`), configurar tokens em `.env`, reiniciar `hydra-bot` no PM2 e validar a resposta live via CLI de produção.
