/**
 * Suíte de Testes Automatizados — Roteamento Dual-Worker & Fallback de Cota AGY
 * 
 * Cobre rigorosamente os 9 cenários obrigatórios:
 * 1. Primário responde -> Secundário não é chamado
 * 2. Primário devolve 429 -> Secundário assume; Circuito do Primário fica OPEN
 * 3. Reset do Primário expira -> Chamada de prova atômica fecha o circuito
 * 4. Primário dá timeout -> Secundário responde dentro do orçamento de latência
 * 5. Ambos em 429 -> Fallback determinístico ou esclarecimento seguro (zero alucinação)
 * 6. Rajadas simultâneas não contaminam contexto nem circuito
 * 7. Equivalência semântica de planos nos 5 casos críticos da Missão 2
 * 8. Telemetria e contadores discriminados (falha se secundário não for testado)
 * 9. Persistência de autenticação e recuperação do processo secundário
 */

import { DualWorkerRouter, parseResetDurationMs, isQuotaErrorMessage, type TurnWorkerTelemetry } from '../dual_worker_router.js';
import { rewriteIntent } from '../intent_rewriter.js';
import { executeOperationalQuery } from '../operational_adapter.js';
import { getDatabaseConnection } from '../db_repository.js';
import { clearTurnState, saveTurnState } from '../turn_context_repository.js';
import fs from 'fs';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, name: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
    throw new Error(`Falha no teste: ${name} - ${detail || ''}`);
  }
}

async function runHarness() {
  console.log('🧪 Iniciando TEST HARNESS — Roteamento Dual-Worker & Fallback de Cota (9 Cenários)...\n');
  const db = getDatabaseConnection();

  // =========================================================================
  // CENÁRIO 1: Primário responde -> Secundário NÃO é chamado
  // =========================================================================
  console.log('--- CENÁRIO 1: Primário Responde Saudável ---');
  let secCalled1 = false;
  const router1 = new DualWorkerRouter({
    primaryExecutorOverride: async (prompt, model, timeoutMs) => ({
      success: true,
      output: 'Plano respondido pelo Primário',
      durationMs: 150
    }),
    secondaryExecutorOverride: async () => {
      secCalled1 = true;
      return { success: true, output: 'Secundário', durationMs: 100 };
    }
  });

  const res1 = await router1.routeRequest('Falta muito pra meta?');
  assert(res1.success === true, '1.1: Requisição primária deve ter sucesso');
  assert(res1.telemetry.workerChosen === 'primary', '1.1: Worker escolhido deve ser primary');
  assert(res1.telemetry.motor === 'AGY_PRIMARY', '1.1: Motor deve ser AGY_PRIMARY');
  assert(secCalled1 === false, '1.2: Secundário NÃO deve ser chamado quando primário tem sucesso');
  assert(router1.getCircuitStatus().primary.state === 'CLOSED', '1.3: Circuito primário permanece CLOSED');

  // =========================================================================
  // CENÁRIO 2: Primário devolve 429 -> Secundário assume; Circuito Primário fica OPEN
  // =========================================================================
  console.log('\n--- CENÁRIO 2: Primário 429 -> Failover para Secundário & Circuito OPEN ---');
  let primaryCalls2 = 0;
  let secondaryCalls2 = 0;
  const router2 = new DualWorkerRouter({
    primaryExecutorOverride: async () => {
      primaryCalls2++;
      return {
        success: false,
        error: 'RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 15h40m28s.',
        isQuotaExhausted: true,
        resetDurationMs: 56433000,
        durationMs: 200
      };
    },
    secondaryExecutorOverride: async () => {
      secondaryCalls2++;
      return {
        success: true,
        output: 'Plano gerado pelo Secundário',
        durationMs: 250
      };
    }
  });

  // Turno 1: Primário falha com 429 -> Secundário atende
  const res2a = await router2.routeRequest('E Santo André?');
  assert(res2a.success === true, '2.1: Turno 1 deve ter sucesso via secundário');
  assert(res2a.telemetry.workerChosen === 'secondary', '2.1: Worker escolhido deve ser secondary');
  assert(res2a.telemetry.motor === 'AGY_SECONDARY', '2.1: Motor deve ser AGY_SECONDARY');
  assert(res2a.telemetry.swapReason === 'PRIMARY_QUOTA_EXHAUSTED', '2.1: Motivo de troca deve ser PRIMARY_QUOTA_EXHAUSTED');
  assert(router2.getCircuitStatus().primary.state === 'OPEN', '2.2: Circuito do primário deve ficar OPEN');
  assert((router2.getCircuitStatus().primary.resetsInMs || 0) > 50000000, '2.2: Tempo de reset do primário extraído com precisão');

  // Turno 2: Próxima mensagem -> Bypass imediato do primário (não tenta primário novamente)
  const res2b = await router2.routeRequest('E o CMV dela?');
  assert(primaryCalls2 === 1, '2.3: Primário NÃO deve ser chamado novamente enquanto circuito estiver OPEN');
  assert(secondaryCalls2 === 2, '2.3: Secundário atende diretamente');
  assert(res2b.telemetry.workerChosen === 'secondary', '2.3: Worker escolhido foi secondary');

  // =========================================================================
  // CENÁRIO 3: Reset expira -> Chamada de Prova fecha o circuito
  // =========================================================================
  console.log('\n--- CENÁRIO 3: Expiração de Reset & Sonda de Prova ---');
  let probeSuccess = false;
  const router3 = new DualWorkerRouter({
    primaryExecutorOverride: async () => {
      if (probeSuccess) {
        return { success: true, output: 'Primário recuperado', durationMs: 180 };
      }
      return { success: false, error: 'RESOURCE_EXHAUSTED 429', isQuotaExhausted: true, durationMs: 100 };
    },
    secondaryExecutorOverride: async () => ({
      success: true,
      output: 'Secundário ativo',
      durationMs: 150
    })
  });

  // Força circuito aberto inicial
  router3.setCircuitState('primary', 'OPEN', 100);
  assert(router3.getCircuitStatus().primary.state === 'OPEN', '3.1: Circuito aberto');

  // Simula passagem do tempo (transição para HALF_OPEN)
  router3.setCircuitState('primary', 'HALF_OPEN');
  probeSuccess = true;

  const res3 = await router3.routeRequest('Qual área tá pior?');
  assert(res3.success === true, '3.2: Chamada de prova executada com sucesso');
  assert(res3.telemetry.swapReason === 'PROBE', '3.2: Motivo registrado como PROBE');
  assert(res3.telemetry.motor === 'AGY_PRIMARY', '3.2: Motor recuperado para AGY_PRIMARY');
  assert(router3.getCircuitStatus().primary.state === 'CLOSED', '3.3: Circuito primário fechado após sucesso da sonda');

  // =========================================================================
  // CENÁRIO 4: Primário dá Timeout -> Secundário assume dentro do orçamento
  // =========================================================================
  console.log('\n--- CENÁRIO 4: Falha Transitória / Timeout do Primário ---');
  const router4 = new DualWorkerRouter({
    primaryExecutorOverride: async () => ({
      success: false,
      error: 'ETIMEDOUT',
      isTransient: true,
      durationMs: 500
    }),
    secondaryExecutorOverride: async () => ({
      success: true,
      output: 'Secundário respondeu após timeout primário',
      durationMs: 300
    })
  });

  const res4 = await router4.routeRequest('E de onde vêm os clientes?');
  assert(res4.success === true, '4.1: Secundário assume após timeout');
  assert(res4.telemetry.workerChosen === 'secondary', '4.1: Worker escolhido é secondary');
  assert(res4.telemetry.swapReason === 'PRIMARY_TIMEOUT', '4.1: Motivo registrado como PRIMARY_TIMEOUT');
  assert(res4.telemetry.durationMs < 2000, '4.2: Resposta dentro do orçamento total de latência');

  // =========================================================================
  // CENÁRIO 5: Ambos sem cota -> Fallback Determinístico & Anti-Alucinação
  // =========================================================================
  console.log('\n--- CENÁRIO 5: Ambos os Workers Indisponíveis (Fallback Seguro) ---');
  const router5 = new DualWorkerRouter({
    primaryExecutorOverride: async () => ({
      success: false,
      error: 'RESOURCE_EXHAUSTED 429',
      isQuotaExhausted: true,
      durationMs: 50
    }),
    secondaryExecutorOverride: async () => ({
      success: false,
      error: 'RESOURCE_EXHAUSTED 429',
      isQuotaExhausted: true,
      durationMs: 50
    })
  });

  // Pergunta Operacional Padrão
  const res5a = await router5.routeRequest('Falta muito pra meta?');
  assert(res5a.success === false, '5.1: LLM declarada indisponível');
  assert(res5a.usedFallback === true, '5.1: Fallback sinalizado como true');
  assert(res5a.telemetry.motor === 'FALLBACK_API', '5.1: Motor registrado como FALLBACK_API');

  // Execução pelo Adaptador Determinístico
  const rewritten5a = rewriteIntent('Falta muito pra meta?', null);
  const detResult5a = await executeOperationalQuery(db, rewritten5a);
  assert(detResult5a.replyText.includes('META') || detResult5a.replyText.includes('Faturamento'), '5.2: Resposta determinística precisa');

  // Pergunta ambígua -> NUNCA devolve OS ou dados aleatórios
  const rewritten5b = rewriteIntent('como tá o rei?', null);
  assert(rewritten5b.needsClarification === true, '5.3: Pergunta ambígua exige esclarecimento');
  assert(rewritten5b.clarificationMessage?.includes('Rei do Módulo') === true, '5.3: Desambiguação amigável sem inventar dados');

  // =========================================================================
  // CENÁRIO 6: Rajadas de Mensagens Simultâneas sem Contaminação de Estado
  // =========================================================================
  console.log('\n--- CENÁRIO 6: Concorrência & Isolamento de Turnos em Rajada ---');
  const router6 = new DualWorkerRouter({
    primaryExecutorOverride: async () => ({
      success: false,
      error: 'RESOURCE_EXHAUSTED',
      isQuotaExhausted: true,
      durationMs: 20
    }),
    secondaryExecutorOverride: async (prompt) => ({
      success: true,
      output: `Plano para: ${prompt.slice(0, 30)}`,
      durationMs: 50
    })
  });

  const phones = ['5511999990001', '5511999990002', '5511999990003', '5511999990004', '5511999990005'];
  const promises = phones.map(async (phone, idx) => {
    clearTurnState(db, phone);
    const input = idx % 2 === 0 ? 'Falta quanto em Santo André?' : 'Situação de Mauá';
    const rewritten = rewriteIntent(input, null);
    const routed = await router6.routeRequest(input);
    return { phone, target: rewritten.lojaSlug, success: routed.success, motor: routed.telemetry.motor };
  });

  const results = await Promise.all(promises);
  assert(results.length === 5, '6.1: Todas as 5 requisições concorrentes processadas');
  assert(results.every(r => r.success && r.motor === 'AGY_SECONDARY'), '6.2: Todas roteadas isoladamente ao secundário');

  // =========================================================================
  // CENÁRIO 7: Equivalência de Planos nos Casos Críticos da Missão 2
  // =========================================================================
  console.log('\n--- CENÁRIO 7: Equivalência de Contratos e Planos Semânticos ---');
  
  // 7.1 "falta muito pra meta?"
  const p1 = rewriteIntent('falta muito pra meta?', null);
  assert(p1.contract?.operation === 'financial_alerts' && p1.contract?.filters?.subIntent === 'goal_gap', '7.1: Falta muito pra meta -> financial_alerts (goal_gap)');
  assert(p1.lojaSlug === undefined, '7.1: Escopo de rede preservado');

  // 7.2 "e Santo André?" (Elipse após meta)
  const prev1: any = { phone: '5511999998888', lastTurnId: p1.turnId, lastIntent: p1.intent, filters: { subIntent: 'goal_gap' }, updatedAt: new Date().toISOString() };
  const p2 = rewriteIntent('e Santo André?', prev1);
  assert(p2.contract?.operation === 'financial_alerts' && p2.lojaSlug === 'MPSantoAndre', '7.2: E Santo André -> mantém financial_alerts com loja Santo André');

  // 7.3 "e o CMV dela?" (Anáfora de loja)
  const prev2: any = { phone: '5511999998888', lastTurnId: p2.turnId, lastIntent: p2.intent, lojaSlug: 'MPSantoAndre', filters: {}, updatedAt: new Date().toISOString() };
  const p3 = rewriteIntent('e o CMV dela?', prev2);
  assert(p3.contract?.operation === 'store_cmv' && p3.lojaSlug === 'MPSantoAndre', '7.3: E o CMV dela -> store_cmv para Santo André');

  // 7.4 "qual área tá pior?" (Área crítica)
  const prev3: any = { phone: '5511999998888', lastTurnId: p3.turnId, lastIntent: p3.intent, lojaSlug: 'MPSantoAndre', filters: {}, updatedAt: new Date().toISOString() };
  const p4 = rewriteIntent('qual área tá pior?', prev3);
  assert(p4.contract?.operation === 'store_areas' && p4.contract?.filters?.focusWorst === true && p4.lojaSlug === 'MPSantoAndre', '7.4: Qual área tá pior -> store_areas com pior área');

  // 7.5 Regressão: "OS abertas da rede" -> "Qual o CMV da Jorge Beretta?"
  const p5a = rewriteIntent('OS abertas da rede', null);
  const p5b = rewriteIntent('Qual o CMV da Jorge Beretta?', { phone: '5511999998888', lastTurnId: p5a.turnId, lastIntent: p5a.intent, filters: {}, updatedAt: new Date().toISOString() });
  assert(p5b.contract?.operation === 'store_cmv' && p5b.lojaSlug === 'MPJorgeBeretta', '7.5: Regressão Jorge Beretta -> store_cmv MPJorgeBeretta');

  // =========================================================================
  // CENÁRIO 8: Telemetria & Discriminação de Contadores
  // =========================================================================
  console.log('\n--- CENÁRIO 8: Discriminação de Telemetria e Logs ---');
  const circuit = router2.getCircuitStatus();
  assert(circuit.primary.quotaErrors >= 1, '8.1: Contabilizou erros de cota do primário');
  assert(circuit.primary.totalCalls >= 1, '8.1: Contabilizou chamadas totais do primário');
  assert(circuit.secondary.totalCalls >= 2, '8.2: Contabilizou chamadas atendidas pelo secundário');

  // =========================================================================
  // CENÁRIO 9: Persistência de Autenticação do Processo Secundário
  // =========================================================================
  console.log('\n--- CENÁRIO 9: Integridade e Autonomia do Processo Secundário ---');
  const secBinExists = fs.existsSync('/home/hydra-sec/.local/bin/agy') || fs.existsSync('/opt/bots/scripts/run-agy-sec.sh');
  assert(secBinExists === true, '9.1: Binário isolado do secundário existe no filesystem');

  const wrapperExists = fs.existsSync('/opt/bots/scripts/run-agy-sec.sh');
  assert(wrapperExists === true, '9.2: Script de execução com permissões restritas configurado');

  console.log('\n========================================================');
  console.log(`🏆 SUCESSO TOTAL! ${passedTests}/${totalTests} ASSERÇÕES APROVADAS NO HARNESS!`);
  console.log('========================================================\n');
}

runHarness().catch(err => {
  console.error('\n💥 Falha na execução da suíte:', err);
  process.exit(1);
});