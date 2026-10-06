/**
 * src/hydra-sync/tests/test_harness_linea_repair.ts
 * Su?te Integrada de Testes de Aceite R01 a R18 para a Spec hydra-linea-runtime-repair.
 * Executor 3: Dispatcher, Fallback Seguro, Coordena??o Operacional e Harness Integrado.
 */

import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { getDatabaseConnection } from '../db_repository.js';
import {
  clearTurnState,
  getLatestTurnState,
  saveTurnState
} from '../turn_context_repository.js';
import { dispatchMessage } from '../agent_dispatcher.js';
import {
  resolveVehicleTarget,
  getCaseContext,
  formatVehicleSituation,
  isDelayReasonQuery,
  isIndividualVehicleQuery,
  isProductionEnvironment
} from '../hybrid_os_coordinator.js';
import { executeOperationalQuery } from '../operational_adapter.js';
import { assertNoDoubleAsterisks } from '../format_utils.js';
import { validateAndSanitizePublicResponse } from '../public_response_guard.js';
import type { CandidateOrder } from '../types/conversation_context_contract.js';

let passed = 0;
let failed = 0;

async function runTest(id: string, name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    passed++;
    console.log(`[PASS] ${id}: ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`[FAIL] ${id}: ${name}`);
    console.error(`       Erro: ${err?.message || err}`);
  }
}

async function main() {
  console.log("=== INICIANDO HARNESS DE TESTES INTEGRADOS (R01 A R18) ===\n");
  const db = getDatabaseConnection();

  // R01: Consulta de ve?culo individual sem desvio para p?tio agregado
  await runTest('R01', 'Consulta de ve?culo individual sem desvio para p?tio agregado', async () => {
    const phone = '5511999991001';
    clearTurnState(db, phone);
    const res = await dispatchMessage({
      db,
      phone,
      message: 'Caso do Linea / por que esta parado'
    });
    assert.strictEqual(res.toolsCalled.includes('get_aging_cars'), false, 'N?o deve chamar get_aging_cars');
    assert.strictEqual(res.replyText.includes('Ve?culos Retidos no P?tio'), false, 'N?o deve retornar card de p?tio agregado');
    assert.match(res.replyText, /linea/i, 'Deve conter refer?ncia ao Linea');
  });

  // R02: Corre??o "nao foi isso que perguntei cara" preservando foco sem cair em hist?rico
  await runTest('R02', 'Corre??o "nao foi isso que perguntei cara" preservando foco sem cair em hist?rico', async () => {
    const phone = '5511999991002';
    clearTurnState(db, phone);
    await dispatchMessage({ db, phone, message: 'Caso do Linea / por que esta parado' });
    const res = await dispatchMessage({ db, phone, message: 'nao foi isso que perguntei cara' });
    assert.strictEqual(res.toolsCalled.includes('conversation_history'), false, 'N?o deve acionar conversation_history');
    assert.strictEqual(res.toolsCalled.includes('conversation_correction'), true, 'Deve acionar conversation_correction');
    assert.match(res.replyText, /LINEA/i, 'Deve manter o Linea no foco da resposta');
    const state = getLatestTurnState(db, phone);
    assert.strictEqual(state?.filters?.vehicleModel, 'linea', 'Deve preservar vehicleModel no estado');
  });

  // R03: Desambigua??o estrita de hist?rico
  await runTest('R03', 'Desambigua??o estrita de hist?rico', async () => {
    const phone = '5511999991003';
    clearTurnState(db, phone);
    const resCorr = await dispatchMessage({ db, phone, message: 'nao foi isso que perguntei cara' });
    assert.strictEqual(resCorr.toolsCalled.includes('conversation_history'), false, 'Corre??o n?o deve virar hist?rico');

    const resHist = await dispatchMessage({ db, phone, message: 'qual foi minha primeira pergunta hoje?' });
    assert.strictEqual(resHist.toolsCalled.includes('conversation_history'), true, 'Pergunta expl?cita deve chamar hist?rico');
  });

  // R04: "nao entendi" explicando alvo recente em vez de menu est?tico
  await runTest('R04', '"nao entendi" explicando alvo recente em vez de menu est?tico', async () => {
    const phone = '5511999991004';
    clearTurnState(db, phone);
    await dispatchMessage({ db, phone, message: 'Caso do Linea / por que esta parado' });
    const res = await dispatchMessage({ db, phone, message: 'nao entendi' });
    assert.strictEqual(res.toolsCalled.includes('explain_turn_target'), true, 'Deve acionar explain_turn_target');
    assert.match(res.replyText, /LINEA/i, 'Deve explicar o alvo do Linea');
    assert.strictEqual(res.replyText.includes('Posso consultar m?tricas operacionais'), false, 'N?o deve exibir menu gen?rico');
  });

  // R05: Disponibilidade "ia ta ativa?" sem perder pedido pendente
  await runTest('R05', 'Disponibilidade "ia ta ativa?" sem perder pedido pendente', async () => {
    const phone = '5511999991005';
    clearTurnState(db, phone);
    await dispatchMessage({ db, phone, message: 'Caso do Linea / por que esta parado' });
    const res = await dispatchMessage({ db, phone, message: 'ia ta ativa?' });
    assert.strictEqual(res.toolsCalled.includes('availability_check'), true, 'Deve acionar availability_check');
    assert.match(res.replyText, /Sim, estou ativa/i, 'Deve confirmar presen?a');
    const state = getLatestTurnState(db, phone);
    assert.strictEqual(state?.filters?.pendingRequest?.targetModel, 'linea', 'Deve manter pendingRequest ?ntegro');
  });

  // R06: Repeti??o de pedido recuperando alvo do turno
  await runTest('R06', 'Repeti??o de pedido recuperando alvo do turno', async () => {
    const phone = '5511999991006';
    clearTurnState(db, phone);
    await dispatchMessage({ db, phone, message: 'Caso do Linea / por que esta parado' });
    await dispatchMessage({ db, phone, message: 'ia ta ativa?' });
    const res = await dispatchMessage({ db, phone, message: 'por favor quero saber do linea por favor' });
    assert.strictEqual(res.toolsCalled.includes('resolve_vehicle_target'), true, 'Deve recuperar alvo do Linea');
    assert.match(res.replyText, /linea/i, 'Deve responder sobre o Linea');
    assert.strictEqual(res.replyText.includes('Ordens de Servi?o Abertas: Rede'), false, 'N?o pode listar 5 OSs gen?ricas');
  });

  // R07: Corre??o com g?ria "nn foi isso que pedi" sem virar sauda??o
  await runTest('R07', 'Corre??o com g?ria "nn foi isso que pedi" sem virar sauda??o', async () => {
    const phone = '5511999991007';
    clearTurnState(db, phone);
    const res = await dispatchMessage({ db, phone, message: 'nn foi isso que pedi' });
    assert.strictEqual(res.toolsCalled.includes('conversation_correction'), true, 'Deve classificar como corre??o');
    assert.strictEqual(res.replyText.includes('Ol?! Como posso ajudar hoje?'), false, 'N?o pode virar sauda??o');
  });

  // R08: Busca por modelo parametrizada no ERP
  await runTest('R08', 'Busca por modelo parametrizada no ERP', () => {
    const res = resolveVehicleTarget(db, { model: 'LINEA' });
    assert.ok(res.status === 'AMBIGUOUS_VEHICLE' || res.status === 'RESOLVED', 'Deve consultar ordens_servico no banco');
    if (res.status === 'AMBIGUOUS_VEHICLE') {
      assert.strictEqual(res.candidates.length >= 2, true, 'Deve encontrar os ve?culos Linea no banco');
    }
  });

  // R09: Ambiguidade com 2 ve?culos gerando esclarecimento com placas
  await runTest('R09', 'Ambiguidade com 2 ve?culos gerando esclarecimento com placas', () => {
    const res = resolveVehicleTarget(db, { model: 'LINEA' });
    assert.strictEqual(res.status, 'AMBIGUOUS_VEHICLE', 'Deve ser amb?guo para modelo sem placa/loja');
    if (res.status === 'AMBIGUOUS_VEHICLE') {
      assert.strictEqual(res.candidates.length, 2, 'Deve encontrar 2 Lineas no banco');
      const plates = res.candidates.map(c => c.plate);
      assert.ok(plates.includes('EUO4H07'), 'Deve conter placa EUO4H07');
      assert.ok(plates.includes('FQD1582'), 'Deve conter placa FQD1582');
      assert.match(res.clarificationPrompt, /EUO4H07/, 'Prompt deve citar EUO4H07');
      assert.match(res.clarificationPrompt, /FQD1582/, 'Prompt deve citar FQD1582');
    }
  });

  // R10: OS resolvida com leitura de an?lise can?nica
  await runTest('R10', 'OS resolvida com leitura de an?lise can?nica', () => {
    const res = resolveVehicleTarget(db, { osId: '439' });
    assert.strictEqual(res.status, 'RESOLVED', 'OS 439 deve ser resolvida');
    if (res.status === 'RESOLVED') {
      assert.strictEqual(res.activeOrder.osId, '439');
      assert.strictEqual(res.activeOrder.storeSlug, 'MPJabaquara');
      const caseCtx = getCaseContext(db, res.activeOrder);
      assert.ok(caseCtx, 'Deve gerar CaseContextResult');
      assert.strictEqual(caseCtx.order.osId, '439');
    }
  });

  // R11: Motivo documentado de demora exibido com clareza
  await runTest('R11', 'Motivo documentado de demora exibido com clareza', () => {
    const fakeOrder: CandidateOrder = {
      osId: '9999',
      storeSlug: 'MPJabaquara',
      plate: 'ABC1234',
      vehicleModel: 'LINEA',
      statusGrid: 'AGUARDANDO PE?AS',
      isOpen: true,
      daysInYard: 15,
      totalAmount: 5000,
      remainingBalance: 2000
    };
    const caseCtx = {
      order: fakeOrder,
      coverage: 'FULL' as const,
      documentedDelayReason: "Aguardando pe\u00e7a da concession\u00e1ria",
      nextPromisedStep: "Instala\u00e7\u00e3o prevista para amanh\u00e3",
      evidenceOrigin: 'CANONICAL_ANALYSIS' as const,
      isLimitationDeclared: false
    };
    const resolution = {
      status: 'RESOLVED' as const,
      vehicle: {
        plate: 'ABC1234',
        model: 'LINEA',
        storeSlug: 'MPJabaquara',
        lastActiveOsId: '9999'
      },
      activeOrder: fakeOrder
    };
    const formatted = formatVehicleSituation(resolution, caseCtx, 'DELAY_REASON');
    assert.match(formatted, /Aguardando pe[c\u00e7]a da concession[a\u00e1]ria/i, "Deve exibir motivo documentado");
    assert.match(formatted, /Instala[c\u00e7][a\u00e3]o prevista para amanh[a\u00e3]/i, "Deve exibir pr\u00f3ximo passo");
  });

  // R12: OS sem an?lise documentada declarando limita??o factual honesta
  await runTest('R12', 'OS sem an?lise documentada declarando limita??o factual honesta', () => {
    const res = resolveVehicleTarget(db, { osId: '439' });
    assert.strictEqual(res.status, 'RESOLVED');
    if (res.status === 'RESOLVED') {
      const caseCtx = getCaseContext(db, res.activeOrder);
      assert.strictEqual(caseCtx.isLimitationDeclared, true, 'Deve declarar limita??o factual');
      const formatted = formatVehicleSituation(res, caseCtx, 'DELAY_REASON');
      assert.match(formatted, /N[a\u00e3]o h[a\u00e1] motivo de atraso formalmente documentado/i, "Deve declarar aus\u00eancia de an\u00e1lise formal");
      assert.match(formatted, /NA FILA PARA EXECU[C\u00c7][A\u00c3]O/i, "Deve apresentar status honesto do ERP");
    }
  });

  // R13: Remo??o do default hardcoded 'linea'
  await runTest('R13', 'Remo??o do default hardcoded "linea"', () => {
    const resEmpty = resolveVehicleTarget(db, {});
    assert.strictEqual(resEmpty.status, 'NO_MATCH', 'Par?metros vazios n?o podem retornar Linea');

    const resCivic = resolveVehicleTarget(db, { model: 'CIVIC' });
    if (resCivic.status === 'RESOLVED') {
      assert.match(resCivic.vehicle.model, /CIVIC/i, 'N?o pode retornar Linea');
    }
  });

  // R14: Remo??o de fixtures em produ??o
  await runTest('R14', 'Remo??o de fixtures em produ??o', () => {
    assert.strictEqual(isProductionEnvironment(), true, 'Deve operar em ambiente de produ??o');
    const resNonExistent = resolveVehicleTarget(db, { model: 'VEICULO_INEXISTENTE_XYZ_999' });
    assert.strictEqual(resNonExistent.status, 'NO_MATCH', 'Ve?culo inexistente deve retornar NO_MATCH');
  });

  // R15: Bloqueio estrito de get_aging_cars em ve?culo individual
  await runTest('R15', 'Bloqueio estrito de get_aging_cars em ve?culo individual', async () => {
    const opResult = await executeOperationalQuery(db, {
      turnId: 'test_r15',
      canonicalQuestion: 'Caso do Linea / por que esta parado',
      intent: 'aging_cars'
    } as any);
    assert.strictEqual(opResult.toolsCalled.includes('get_aging_cars'), false, 'N?o pode chamar get_aging_cars');
    assert.strictEqual(opResult.replyText.includes('Ve?culos Retidos no P?tio'), false, 'N?o pode conter card de p?tio agregado');
  });

  // R16: Fallback de retrieve_operational_data focado no ve?culo
  await runTest('R16', 'Fallback de retrieve_operational_data focado no ve?culo', async () => {
    const opResult = await executeOperationalQuery(db, {
      turnId: 'test_r16',
      canonicalQuestion: 'por favor quero saber do linea por favor',
      intent: 'other',
    } as any);
    assert.strictEqual(opResult.toolsCalled.includes('retrieve_operational_data'), true);
    assert.strictEqual(opResult.replyText.includes('Ordens de Servi?o Abertas: Rede'), false, 'Proibida listagem cega das 5 primeiras OSs da rede');
  });

  // R17: Formata??o nativa WhatsApp (zero asteriscos duplos, zero tabelas)
  await runTest('R17', 'Formata??o nativa WhatsApp (zero asteriscos duplos, zero tabelas)', () => {
    const dirtyText = '> *Situa??o Operacional: LINEA (FQD1582)*\n- **OS:** **#439** (MPJabaquara)\n| Coluna 1 | Coluna 2 |\n| Valor 1 | Valor 2 |';
    const sanitized = validateAndSanitizePublicResponse(dirtyText);
    assertNoDoubleAsterisks(sanitized.cleanText);
    assert.strictEqual(sanitized.cleanText.includes('|'), false, 'N?o pode conter tabelas com pipes');
  });

  // R18: Sequ?ncia encadeada completa T1->T2->T3->T4->T5->T6 em sess?o ?nica
  await runTest('R18', 'Sequ?ncia encadeada completa T1->T2->T3->T4->T5->T6 em sess?o ?nica', async () => {
    const phone = '5511999991018';
    clearTurnState(db, phone);

    // T1: 'Caso do Linea / por que esta parado'
    const t1 = await dispatchMessage({ db, phone, message: 'Caso do Linea / por que esta parado' });
    assert.strictEqual(t1.toolsCalled.includes('get_aging_cars'), false, 'T1 n?o pode chamar get_aging_cars');
    assert.match(t1.replyText, /linea/i, 'T1 deve conter Linea');
    let s1 = getLatestTurnState(db, phone);
    assert.strictEqual(s1?.filters?.pendingRequest?.targetModel, 'linea', 'T1 deve registrar pendingRequest para Linea');

    // T2: 'nao foi isso que perguntei cara'
    const t2 = await dispatchMessage({ db, phone, message: 'nao foi isso que perguntei cara' });
    assert.strictEqual(t2.toolsCalled.includes('conversation_correction'), true, 'T2 deve ser corre??o');
    assert.strictEqual(t2.toolsCalled.includes('conversation_history'), false, 'T2 n?o pode ser hist?rico');
    assert.match(t2.replyText, /LINEA/i, 'T2 deve manter Linea em foco');

    // T3: 'nao entendi'
    const t3 = await dispatchMessage({ db, phone, message: 'nao entendi' });
    assert.strictEqual(t3.toolsCalled.includes('explain_turn_target'), true, 'T3 deve explicar alvo pendente');
    assert.match(t3.replyText, /LINEA/i, 'T3 deve citar o Linea');
    assert.strictEqual(t3.replyText.includes('Posso consultar m?tricas operacionais'), false, 'T3 n?o pode ser menu gen?rico');

    // T4: 'ia ta ativa?'
    const t4 = await dispatchMessage({ db, phone, message: 'ia ta ativa?' });
    assert.strictEqual(t4.toolsCalled.includes('availability_check'), true, 'T4 deve ser disponibilidade');
    assert.match(t4.replyText, /Sim, estou ativa/i, 'T4 deve responder afirma??o de presen?a');
    let s4 = getLatestTurnState(db, phone);
    assert.strictEqual(s4?.filters?.pendingRequest?.targetModel, 'linea', 'T4 deve preservar pendingRequest');

    // T5: 'o do jabaquara' (esclarece a unidade do Linea solicitada em T1)
    const t5 = await dispatchMessage({ db, phone, message: 'o do jabaquara' });
    assert.strictEqual(t5.toolsCalled.includes('resolve_vehicle_target'), true, 'T5 deve resolver ve?culo');
    assert.match(t5.replyText, /FQD1582/, 'T5 deve resolver placa FQD1582');
    assert.match(t5.replyText, /MPJabaquara/, 'T5 deve resolver unidade MPJabaquara');
    assert.match(t5.replyText, /N[a\u00e3]o h[a\u00e1] motivo de atraso formalmente documentado/i, "T5 deve declarar limita\u00e7\u00e3o honesta");

    // T6: 'nn foi isso que pedi'
    const t6 = await dispatchMessage({ db, phone, message: 'nn foi isso que pedi' });
    assert.strictEqual(t6.toolsCalled.includes('conversation_correction'), true, 'T6 deve ser corre??o');
    assert.strictEqual(t6.replyText.includes('Ol?! Como posso ajudar hoje?'), false, 'T6 n?o pode ser sauda??o');
    assert.match(t6.replyText, /LINEA/i, 'T6 deve manter contexto do ve?culo');
  });

  console.log(`\n=== RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Erro fatal na execu??o do harness:", err);
  process.exit(1);
});
