# Plano de Execução — Spec 067: Diagnóstico da API de Placas (APIBrasil) e Estimativa Imediata de Tempário

**Status:** CONCLUÍDO (HARD STOP — AGUARDANDO VALIDAÇÃO DO USUÁRIO OU /vibe-archive)

---

## Fase 1: Diagnóstico Transparente da API de Placas (APIBrasil)
- [x] [LEAD] **T1.1:** Estender `src/hydra-sync/types/plate_lookup_contract.ts` com tipos de auditoria e status de diagnóstico (`PlateApiDiagnosticStatus`, `PlateResolutionAudit`).
- [x] [LEAD] **T1.2:** Implementar captura de status detalhado em `src/hydra-sync/apibrasil_plate_client.ts`:
  1. Identificar respostas HTTP 404 (`Plano ativo não encontrado`) e HTTP 402 (`Saldo insuficiente`), gravando o diagnóstico da conta (`mktfunil1@gmail.com`).
  2. Implementar fallback entre as rotas `/api/v2/vehicles/dados` e `/api/v2/consulta/veiculos/credits`.
  3. Exportar `getLastPlateDiagnostic(placa: string)` para consumo pelo despachante e compositor.

## Fase 2: Estimativa Operacional de Referência Imediata (Non-Blocking Quote)
- [x] [LEAD] **T2.1:** Atualizar `composeTemparioExecutiveBalloon` em `src/hydra-sync/balloon_composer.ts`:
  1. Quando uma placa for pesquisada sem modelo identificado no banco ou na API externa, formatar o card executivo como **Estimativa Operacional de Linha Passeio Padrão**, exibindo a placa, o serviço, a taxa padrão de R$ 270,00/h, o valor sugerido e a faixa de tolerância.
  2. Incluir a nota de diagnóstico transparente informando o status da conta APIBrasil quando a API externa retornar sem saldo/plano.
  3. Manter os botões de Progressive Disclosure (`1️⃣ Peças`, `2️⃣ Ferramentas`, `3️⃣ Passo a Passo`, `4️⃣ Completo`) e a instrução para refinar o modelo.
- [x] [LEAD] **T2.2:** Ajustar o fluxo 3.0.4 em `src/hydra-sync/agent_dispatcher.ts`:
  1. Quando `targetPlaca` não tiver veículo resolvido, não bloquear a resposta: disparar `coordinator.coordinateQuery` com `veiculoMarcaModelo: 'Linha Passeio (Referência Padrão)'`, passando a placa e os serviços.
  2. Salvar contexto com `tipo: 'TEMPARIO_DISCLOSURE'` e `placa: targetPlaca`.

## Fase 3: Navegação Técnica Imediata e Refinamento de Veículo no Próximo Turno
- [x] [LEAD] **T3.1:** Em `src/hydra-sync/agent_dispatcher.ts`:
  1. Se o usuário responder `1`, `2`, `3` ou `4`, `detectTemparioDetailChoice` entrega os detalhes da estimativa de referência sem travar.
  2. Se o usuário responder com modelo/ano (ex: `"Palio 1.0 2012"` ou `"Corsa 1.4"`), grava `placa -> modelo` em `placa_lookup_cache` (`origem_dados = 'MANUAL'`) e reemite o tempário refinado.

## Fase 4: Bateria de Testes E2E, Build Gate e Deploy na VPS
- [x] [LEAD] **T4.1:** Criar suíte de testes `src/hydra-sync/tests/test_harness_spec067_plate_resilience.ts` cobrindo:
  1. Entrada `EUS5006 \n\ntroca de motor de partida` -> entrega imediata do tempário de referência (`1,10h = R$ 297,00`), com aviso de diagnóstico da APIBrasil e opções 1 a 4 ativas.
  2. Entrada imediata de `3` -> entrega o passo a passo com torques e ferramentas da estimativa de referência.
  3. Entrada subsequente de `"Palio 1.0 2012"` -> vincula a placa no cache e atualiza o card para `Fiat Palio 1.0 2012`.
- [x] [LEAD] **T4.2:** Executar Build Gate TypeScript estrito (`npx tsc -p tsconfig.tempario.json --noEmit`) com ZERO erros.
- [x] [LEAD] **T4.3:** Realizar sincronização para a VPS (`100.126.50.101`), rodar a suíte no ambiente de produção e reiniciar `pm2 restart hydra-bot`.
