# Plano de Execução — Spec 069: Correção de ReferenceError e Escopo de Variáveis no Dispatcher em Produção

## Estratégia de Execução
Correção cirúrgica de imports, resolução de escopo de `activeProfile` e verificação ponta a ponta com `dispatchMessage`.

---

## Tasks

- [x] [LEAD] Task 1: Correção de Imports e Símbolos em `src/hydra-sync/agent_dispatcher.ts`
  - Importar `isValidVehicleForPersistence` de `./tempario_graph_repository.js`.
  - Promover `const activeProfile = userProfile || getUserProfile(db, phone);` para o início de `dispatchOperationalQuery`, eliminando a TDZ no bloco `0.2.1`.
  - Substituir `queryResp.veiculoIdentificado` pela resolução tipada em `queryResp.veiculo`.

- [x] [LEAD] Task 2: Criação da Suite de Integração E2E em `src/hydra-sync/tests/test_harness_spec069_dispatcher_e2e.ts`
  - Executar chamadas reais a `dispatchMessage` cobrindo:
    1. `"troca de laampadas traseiras tracker 2023"` (verificando `0,40h`, `R$ 108,00`, zero `ReferenceError`).
    2. `"EUS5006 \n\ntroca de motor de partida"` (verificando estimativa de referência a R$ 297,00).
    3. Turno 2 `"Palio 1.0 2012"` (verificando acesso a `activeProfile` e reemissão calibrada).
    4. Seleção da opção `"3"` (passo a passo de montagem).

- [x] [LEAD] Task 3: Build Gate e Validação Local
  - Compilar via `npx tsc -p tsconfig.tempario.json --noEmit`.
  - Executar `test_harness_spec069_dispatcher_e2e.ts` localmente com 100% de sucesso.

- [x] [LEAD] Task 4: Deploy na VPS e Validação em Produção
  - Enviar arquivos corrigidos para a VPS via SCP (`operacional@100.126.50.101`).
  - Executar a suite E2E na VPS.
  - Reiniciar PM2 `hydra-bot` e validar status online.
