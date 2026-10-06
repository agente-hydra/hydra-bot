/**
 * src/hydra-sync/tests/test_executor2_case_data.ts
 * Suíte de testes automatizados do Executor 2 (Fase E2 da spec hydra-linea-runtime-repair).
 * 
 * Cobre:
 * 1. Persistência, recuperação, TTL e descarte de TurnPendingRequest [E2-01]
 * 2. Resolução discriminada de veículos (RESOLVED, AMBIGUOUS_VEHICLE, NO_MATCH, UNAVAILABLE) com proibição de rows[0] [E2-02]
 * 3. Leitura de análises canônicas e projeção de grafo de atendimentos [E2-03, E2-04]
 * 4. Cumprimento estrito da REGRA DE OURO FACTUAL (honestidade factual sem alucinar peças/mecânico)
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  ensureTurnContextTable,
  saveTurnState,
  getLatestTurnState,
  saveTurnPendingRequest,
  getTurnPendingRequest,
  clearTurnPendingRequest,
  clearTurnState,
  invalidateContextOnPersonaSwitch
} from '../turn_context_repository.js';

import {
  ensureOrdensServicoTable,
  findVehicleCandidates,
  findOrderByOsId,
  findVehicleByPlate,
  mapRowToCandidateOrder
} from '../operational_data_repository.js';

import {
  ensureCaseAnalysisTables,
  saveCanonicalAnalysis,
  getCanonicalAnalysis,
  findCanonicalAnalysisForOs,
  saveGraphProjection,
  getGraphProjection,
  findGraphProjectionForOs
} from '../real_analysis_repository.js';

import {
  resolveCaseContext,
  resolveCaseContextByOs,
  formatFactualLimitation,
  buildCaseOperationalSummary
} from '../case_memory_reader.js';

import type {
  TurnPendingRequest,
  CandidateOrder,
  CandidateVehicle
} from '../types/conversation_context_contract.js';

console.log('================================================================================');
console.log('🧪 INICIANDO SUÍTE DE TESTES EXECUTOR 2: ESTADO DE TURNO, DADOS ERP E MEMÓRIA');
console.log('================================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] Teste ${totalTests}: ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] Teste ${totalTests}: ${name}`);
    console.error(err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 1: Persistência e Recuperação de TurnPendingRequest [E2-01]
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- BLOCO 1: TurnPendingRequest (Persistência, TTL e Descarte) [E2-01] ---');

const dbTurn = new Database(':memory:');
ensureTurnContextTable(dbTurn);

const testPhone = '5511999887766';
const sampleRequest: TurnPendingRequest = {
  originalUserPrompt: 'por que o linea esta parado a tantos dias?',
  operation: 'DELAY_REASON',
  targetModel: 'Linea',
  targetPlate: 'ABC1234',
  targetOsId: '1050',
  targetLojaSlug: 'santoandre',
  generationId: 1,
  requestedAt: new Date().toISOString(),
  deliveryStatus: 'PENDING_CHOICE'
};

runTest('1.1: Salva TurnPendingRequest e recupera fielmente com tipagem completa', () => {
  saveTurnPendingRequest(dbTurn, testPhone, sampleRequest);
  const retrieved = getTurnPendingRequest(dbTurn, testPhone);

  assert.ok(retrieved, 'Deveria recuperar o pedido pendente');
  assert.equal(retrieved?.originalUserPrompt, sampleRequest.originalUserPrompt);
  assert.equal(retrieved?.operation, 'DELAY_REASON');
  assert.equal(retrieved?.targetModel, 'Linea');
  assert.equal(retrieved?.targetPlate, 'ABC1234');
  assert.equal(retrieved?.targetOsId, '1050');
  assert.equal(retrieved?.targetLojaSlug, 'santoandre');
  assert.equal(retrieved?.deliveryStatus, 'PENDING_CHOICE');
});

runTest('1.2: getLatestTurnState também expõe o pendingRequest hidratado', () => {
  const turnState = getLatestTurnState(dbTurn, testPhone);
  assert.ok(turnState, 'TurnState deve existir');
  assert.ok(turnState?.pendingRequest, 'TurnState deve conter pendingRequest');
  assert.equal(turnState?.pendingRequest?.targetModel, 'Linea');
});

runTest('1.3: getTurnPendingRequest expira após TTL configurado e limpa o campo', () => {
  // Salva com updated_at antigo (130 min atrás)
  const pastIso = new Date(Date.now() - 130 * 60 * 1000).toISOString();
  dbTurn.prepare('UPDATE hydra_turn_contexts SET updated_at = ? WHERE phone = ?').run(pastIso, testPhone);

  const expired = getTurnPendingRequest(dbTurn, testPhone, 120);
  assert.equal(expired, null, 'Pedido pendente com TTL expirado deve retornar null');

  // Verifica que limpou no banco
  const row = dbTurn.prepare('SELECT pending_request_json FROM hydra_turn_contexts WHERE phone = ?').get(testPhone) as any;
  assert.equal(row.pending_request_json, null);
});

runTest('1.4: clearTurnPendingRequest limpa explicitamente o pedido pendente', () => {
  saveTurnPendingRequest(dbTurn, testPhone, sampleRequest);
  assert.ok(getTurnPendingRequest(dbTurn, testPhone));

  clearTurnPendingRequest(dbTurn, testPhone);
  assert.equal(getTurnPendingRequest(dbTurn, testPhone), null);
});

runTest('1.5: clearTurnState (/reset) remove totalmente o contexto e pedidos pendentes', () => {
  saveTurnPendingRequest(dbTurn, testPhone, sampleRequest);
  clearTurnState(dbTurn, testPhone);

  assert.equal(getTurnPendingRequest(dbTurn, testPhone), null);
  assert.equal(getLatestTurnState(dbTurn, testPhone), null);
});

runTest('1.6: Mudança de assunto em saveTurnState (faturamento/metas) limpa o pedido pendente', () => {
  // Inicializa estado com OS ativa e pedido pendente
  saveTurnState(dbTurn, {
    phone: testPhone,
    lastTurnId: 'turn-1',
    lastIntent: 'os_detail',
    lojaSlug: 'santoandre',
    osId: '1050',
    placa: 'ABC1234',
    filters: { isOSSpecific: true },
    pendingRequest: sampleRequest,
    updatedAt: new Date().toISOString()
  });

  const stateBefore = getLatestTurnState(dbTurn, testPhone);
  assert.ok(stateBefore?.pendingRequest);

  // Operador muda de assunto explicitamente para faturamento
  saveTurnState(dbTurn, {
    phone: testPhone,
    lastTurnId: 'turn-2',
    lastIntent: 'financial_alerts',
    lojaSlug: 'santoandre',
    filters: {},
    updatedAt: new Date().toISOString()
  });

  const stateAfter = getLatestTurnState(dbTurn, testPhone);
  assert.equal(stateAfter?.pendingRequest, undefined, 'Mudança de assunto para finanças deve expurgar pendingRequest');
  assert.equal(stateAfter?.osId, undefined, 'Mudança de assunto para finanças deve expurgar osId');
  assert.equal(stateAfter?.lojaSlug, 'santoandre', 'Deve preservar lojaSlug da unidade');
});

runTest('1.7: Alternância de persona (invalidateContextOnPersonaSwitch) descarta pendingRequest', () => {
  saveTurnPendingRequest(dbTurn, testPhone, sampleRequest);
  invalidateContextOnPersonaSwitch(dbTurn, testPhone, 'socio');

  assert.equal(getTurnPendingRequest(dbTurn, testPhone), null);
  const state = getLatestTurnState(dbTurn, testPhone);
  assert.equal(state?.lojaSlug, undefined);
  assert.equal(state?.pendingRequest, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 2: Resolução Discriminada de Veículos no ERP [E2-02]
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- BLOCO 2: Resolução Discriminada de Veículos (Proibição de rows[0]) [E2-02] ---');

const dbErp = new Database(':memory:');
ensureOrdensServicoTable(dbErp);

// Popula dados para os testes
// Loja Santo André:
// - Carro 1: Fiat Linea Essence, Placa ABC-1234, OS 101 (aberta, 15 dias no patio)
// - Carro 2: Fiat Linea Absolute, Placa XYZ-9876, OS 102 (aberta, 4 dias no patio)
// - Carro 3: Chevrolet Onix, Placa ONX-5555, OS 201 (aberta, 2 dias no patio)
// Loja Jabaquara:
// - Carro 4: Fiat Linea HLX, Placa JAB-7777, OS 301 (aberta, 7 dias no patio)
dbErp.prepare(`
  INSERT INTO ordens_servico (os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio, data_inicio)
  VALUES
    ('101', 'santoandre', 'Fiat Linea Essence 1.8 16V', 'ABC-1234', 'Carlos Eduardo', 'AGUARDANDO_PECA', 1, 3500.0, 1500.0, 15, '2026-09-15'),
    ('102', 'santoandre', 'Fiat Linea Absolute Dualogic', 'XYZ-9876', 'Mariana Santos', 'EM_EXECUCAO', 1, 1800.0, 0.0, 4, '2026-09-26'),
    ('201', 'santoandre', 'Chevrolet Onix Plus 1.0', 'ONX-5555', 'Roberto Silva', 'DIAGNOSTICO', 1, 950.0, 950.0, 2, '2026-09-28'),
    ('301', 'jabaquara', 'Fiat Linea HLX 1.9', 'JAB-7777', 'Fernanda Lima', 'AGUARDANDO_AUTORIZACAO', 1, 4200.0, 2000.0, 7, '2026-09-23')
`).run();

runTest('2.1: Exatamente 1 carro retornado -> RESOLVED com vehicle e activeOrder', () => {
  const result = findVehicleCandidates(dbErp, 'santoandre', 'Onix');

  assert.equal(result.status, 'RESOLVED');
  if (result.status === 'RESOLVED') {
    assert.equal(result.vehicle.plate, 'ONX-5555');
    assert.equal(result.vehicle.model, 'Chevrolet Onix Plus 1.0');
    assert.equal(result.vehicle.clientName, 'Roberto Silva');
    assert.equal(result.activeOrder.osId, '201');
    assert.equal(result.activeOrder.isOpen, true);
    assert.equal(result.activeOrder.daysInYard, 2);
    assert.equal(result.activeOrder.totalAmount, 950.0);
  }
});

runTest('2.2: Mais de 1 carro retornado -> AMBIGUOUS_VEHICLE listando placas e OSs (PROIBIDO rows[0]!)', () => {
  // Em Santo André existem DOIS Lineas (ABC-1234 e XYZ-9876)
  const result = findVehicleCandidates(dbErp, 'santoandre', 'Linea');

  assert.equal(result.status, 'AMBIGUOUS_VEHICLE', 'Não pode resolver silenciosamente quando há 2 carros');
  if (result.status === 'AMBIGUOUS_VEHICLE') {
    assert.equal(result.candidates.length, 2, 'Deve identificar exatamente os 2 candidatos');
    const plates = result.candidates.map(c => c.plate);
    assert.ok(plates.includes('ABC-1234'));
    assert.ok(plates.includes('XYZ-9876'));

    // Verifica que o clarificationPrompt é claro e lista as placas
    assert.ok(result.clarificationPrompt.includes('ABC-1234'));
    assert.ok(result.clarificationPrompt.includes('XYZ-9876'));
    assert.ok(result.clarificationPrompt.includes('101'));
    assert.ok(result.clarificationPrompt.includes('102'));
  }
});

runTest('2.3: Zero carros encontrados -> NO_MATCH com motivo explicativo', () => {
  const result = findVehicleCandidates(dbErp, 'santoandre', 'Renegade');

  assert.equal(result.status, 'NO_MATCH');
  if (result.status === 'NO_MATCH') {
    assert.equal(result.searchedModel, 'Renegade');
    assert.equal(result.searchedStoreSlug, 'santoandre');
    assert.ok(result.reason.includes('Nenhum veículo encontrado'));
  }
});

runTest('2.4: Erro de banco de dados -> UNAVAILABLE com erro técnico', () => {
  const brokenDb = new Database(':memory:'); // Não tem tabela ordens_servico criada e vamos dropar
  brokenDb.exec('CREATE TABLE dummy (id INT)');
  
  // Força query em banco sem a tabela
  try {
    brokenDb.prepare('SELECT * FROM ordens_servico').all();
  } catch {}

  const result = findVehicleCandidates(brokenDb, 'santoandre', 'Linea');
  // brokenDb vai falhar no prepare se ordens_servico não existir e não puder ser criada
  // No nosso operational_data_repository ele chama ensureOrdensServicoTable. Vamos quebrar com db fechado:
  brokenDb.close();
  const unavailResult = findVehicleCandidates(brokenDb, 'santoandre', 'Linea');
  assert.equal(unavailResult.status, 'UNAVAILABLE');
  if (unavailResult.status === 'UNAVAILABLE') {
    assert.ok(unavailResult.technicalError.length > 0);
  }
});

runTest('2.5: Isolamento de Loja: Linea na Jabaquara retorna apenas o único carro daquela loja (RESOLVED)', () => {
  const result = findVehicleCandidates(dbErp, 'jabaquara', 'Linea');

  assert.equal(result.status, 'RESOLVED', 'Na Jabaquara só há 1 Linea, deve ser RESOLVED');
  if (result.status === 'RESOLVED') {
    assert.equal(result.vehicle.plate, 'JAB-7777');
    assert.equal(result.activeOrder.osId, '301');
  }
});

runTest('2.6: Múltiplas OSs para o MESMO veículo físico -> AMBIGUOUS_ORDER', () => {
  // Adiciona segunda OS aberta para o Onix
  dbErp.prepare(`
    INSERT INTO ordens_servico (os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio)
    VALUES ('202', 'santoandre', 'Chevrolet Onix Plus 1.0', 'ONX-5555', 'Roberto Silva', 'ELETRICA', 1, 450.0, 450.0, 1)
  `).run();

  const result = findVehicleCandidates(dbErp, 'santoandre', 'Onix');
  assert.equal(result.status, 'AMBIGUOUS_ORDER');
  if (result.status === 'AMBIGUOUS_ORDER') {
    assert.equal(result.candidateOrders.length, 2);
    assert.ok(result.clarificationPrompt.includes('OS #201'));
    assert.ok(result.clarificationPrompt.includes('OS #202'));
  }

  // Remove a OS duplicada para limpar estado
  dbErp.prepare("DELETE FROM ordens_servico WHERE os_id = '202'").run();
});

runTest('2.7: findVehicleByPlate resolve diretamente a placa mesmo com pontuação', () => {
  const result = findVehicleByPlate(dbErp, 'santoandre', 'abc1234');
  assert.equal(result.status, 'RESOLVED');
  if (result.status === 'RESOLVED') {
    assert.equal(result.vehicle.plate, 'ABC-1234');
    assert.equal(result.activeOrder.osId, '101');
  }
});

runTest('2.8: findOrderByOsId recupera a ordem específica por número de OS', () => {
  const order = findOrderByOsId(dbErp, 'santoandre', '101');
  assert.ok(order);
  assert.equal(order?.osId, '101');
  assert.equal(order?.vehicleModel, 'Fiat Linea Essence 1.8 16V');
  assert.equal(order?.isOpen, true);
  assert.equal(order?.daysInYard, 15);
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 3: Fatos de Demora, Memória Canônica e Grafo de Atendimentos [E2-03, E2-04]
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- BLOCO 3: Análises Canônicas, Grafo e Regra de Ouro Factual [E2-03, E2-04] ---');

const dbMem = new Database(':memory:');
ensureCaseAnalysisTables(dbMem);
ensureOrdensServicoTable(dbMem);

const orderLinea101: CandidateOrder = {
  osId: '101',
  storeSlug: 'santoandre',
  plate: 'ABC-1234',
  vehicleModel: 'Fiat Linea Essence 1.8',
  clientName: 'Carlos Eduardo',
  statusGrid: 'AGUARDANDO_PECA',
  isOpen: true,
  daysInYard: 15,
  totalAmount: 3500.0,
  remainingBalance: 1500.0,
  openedAt: '2026-09-15'
};

const orderLinea102: CandidateOrder = {
  osId: '102',
  storeSlug: 'santoandre',
  plate: 'XYZ-9876',
  vehicleModel: 'Fiat Linea Absolute',
  clientName: 'Mariana Santos',
  statusGrid: 'EM_EXECUCAO',
  isOpen: true,
  daysInYard: 4,
  totalAmount: 1800.0,
  remainingBalance: 0.0,
  openedAt: '2026-09-26'
};

runTest('3.1: Projeção de Grafo íntegra com motivo documentado -> FULL / GRAPH_PROJECTION', () => {
  saveGraphProjection(dbMem, {
    projectionId: 'proj-101',
    lojaSlug: 'santoandre',
    coveredOsIds: ['101'],
    documentedDelayReason: 'Câmbio Dualogic desmontado aguardando atuador hidráulico enviado pela concessionária Fiat.',
    nextPromisedStep: 'Instalar atuador e sangrar sistema amanhã pela manhã.',
    isValid: true,
    isIntact: true,
    lastObservationDate: '2026-09-29',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const context = resolveCaseContext(dbMem, orderLinea101);
  assert.equal(context.coverage, 'FULL');
  assert.equal(context.evidenceOrigin, 'GRAPH_PROJECTION');
  assert.equal(context.isLimitationDeclared, false);
  assert.ok(context.documentedDelayReason?.includes('atuador hidráulico'));
  assert.ok(context.nextPromisedStep?.includes('Instalar atuador'));
});

runTest('3.2: Projeção de Grafo SEM motivo documentado de demora -> REGRA DE OURO FACTUAL declarada', () => {
  saveGraphProjection(dbMem, {
    projectionId: 'proj-102',
    lojaSlug: 'santoandre',
    coveredOsIds: ['102'],
    documentedDelayReason: undefined, // Sem motivo documentado de demora!
    nextPromisedStep: 'Aguardar liberação do elevador 2',
    isValid: true,
    isIntact: true,
    lastObservationDate: '2026-09-29',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const context = resolveCaseContext(dbMem, orderLinea102);
  assert.equal(context.coverage, 'PARTIAL_ERP_ONLY');
  assert.equal(context.evidenceOrigin, 'GRAPH_PROJECTION');
  assert.equal(context.documentedDelayReason, undefined);
  assert.equal(context.isLimitationDeclared, true, 'Deve declarar honestamente a limitação factual');

  // Verifica que a limitação declarada é honesta e não inventa peças ou mecânico
  const limitation = formatFactualLimitation(context);
  assert.ok(limitation.toLowerCase().includes('não consta documentado no histórico ou na análise técnica'));
  assert.ok(limitation.toLowerCase().includes('não há registro formal de falta de peças ou ausência de mecânico'));
});

runTest('3.3: Projeção corrompida (isValid=false) -> Fallback transparente para Análise Canônica', () => {
  // Projeção inválida para OS 103
  saveGraphProjection(dbMem, {
    projectionId: 'proj-corrupt-103',
    lojaSlug: 'santoandre',
    coveredOsIds: ['103'],
    documentedDelayReason: 'Texto no grafo corrompido que não deve ser lido',
    isValid: false, // INVALIDA!
    isIntact: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Análise canônica íntegra correspondente
  saveCanonicalAnalysis(dbMem, {
    analysisId: 'canon-103',
    lojaSlug: 'santoandre',
    coveredOsIds: ['103'],
    title: 'Análise técnica da OS 103',
    documentedDelayReason: 'Retífica de cabeçote com prazo de entrega para quinta-feira.',
    nextPromisedStep: 'Receber cabeçote retificado e iniciar montagem com junta nova.',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const order103: CandidateOrder = {
    osId: '103',
    storeSlug: 'santoandre',
    plate: 'KLL-1122',
    vehicleModel: 'Fiat Bravo T-Jet',
    statusGrid: 'AGUARDANDO_RETIFICA',
    isOpen: true,
    daysInYard: 8,
    totalAmount: 4800.0,
    remainingBalance: 2400.0
  };

  const context = resolveCaseContext(dbMem, order103);
  assert.equal(context.evidenceOrigin, 'CANONICAL_ANALYSIS', 'Grafo inválido deve acionar fallback para Análise Canônica');
  assert.equal(context.coverage, 'FULL');
  assert.equal(context.isLimitationDeclared, false);
  assert.ok(context.documentedDelayReason?.includes('Retífica de cabeçote'));
});

runTest('3.4: Análise Canônica cobrindo a OS sem motivo de demora -> Limitação factual honesta', () => {
  saveCanonicalAnalysis(dbMem, {
    analysisId: 'canon-104',
    lojaSlug: 'santoandre',
    coveredOsIds: ['104'],
    title: 'Auditoria de rotina',
    documentedDelayReason: undefined, // Sem motivo documentado
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const order104: CandidateOrder = {
    osId: '104',
    storeSlug: 'santoandre',
    plate: 'TST-9900',
    vehicleModel: 'Fiat Mobi Like',
    statusGrid: 'EM_ANDAMENTO',
    isOpen: true,
    daysInYard: 3,
    totalAmount: 800.0,
    remainingBalance: 0.0
  };

  const context = resolveCaseContext(dbMem, order104);
  assert.equal(context.coverage, 'PARTIAL_ERP_ONLY');
  assert.equal(context.evidenceOrigin, 'CANONICAL_ANALYSIS');
  assert.equal(context.isLimitationDeclared, true);
  assert.equal(context.documentedDelayReason, undefined);
});

runTest('3.5: Análise de OUTRA loja não vaza contexto (Isolamento Cross-Store)', () => {
  saveCanonicalAnalysis(dbMem, {
    analysisId: 'canon-jabaquara-500',
    lojaSlug: 'jabaquara',
    coveredOsIds: ['500'],
    documentedDelayReason: 'Aguardando módulo de injeção na Jabaquara',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Tenta consultar a OS 500 no escopo da loja Santo André
  const order500SantoAndre: CandidateOrder = {
    osId: '500',
    storeSlug: 'santoandre',
    plate: 'OUT-1234',
    vehicleModel: 'Fiat Argo Trekking',
    statusGrid: 'ABERTA',
    isOpen: true,
    daysInYard: 1,
    totalAmount: 500.0,
    remainingBalance: 500.0
  };

  const context = resolveCaseContext(dbMem, order500SantoAndre);
  assert.equal(context.evidenceOrigin, 'ERP_DIRECT', 'Análise de outra loja NÃO pode ser herdada');
  assert.equal(context.coverage, 'NOT_IN_ANALYSIS');
  assert.equal(context.isLimitationDeclared, true);
});

runTest('3.6: OS não constante em nenhuma análise -> Fallback transparente para ERP_DIRECT', () => {
  const orderDirect: CandidateOrder = {
    osId: '999',
    storeSlug: 'santoandre',
    plate: 'ZZZ-9999',
    vehicleModel: 'Fiat Cronos Drive',
    statusGrid: 'PATIO_ENTRADA',
    isOpen: true,
    daysInYard: 1,
    totalAmount: 600.0,
    remainingBalance: 600.0
  };

  const context = resolveCaseContext(dbMem, orderDirect);
  assert.equal(context.coverage, 'NOT_IN_ANALYSIS');
  assert.equal(context.evidenceOrigin, 'ERP_DIRECT');
  assert.equal(context.documentedDelayReason, undefined);
  assert.equal(context.isLimitationDeclared, true);
});

runTest('3.7: buildCaseOperationalSummary formata resumo correto e factual para WhatsApp', () => {
  // Caso com motivo documentado
  const summaryComMotivo = buildCaseOperationalSummary({
    order: orderLinea101,
    coverage: 'FULL',
    documentedDelayReason: 'Câmbio aguardando peça do atuador',
    nextPromisedStep: 'Instalar amanhã',
    evidenceOrigin: 'GRAPH_PROJECTION',
    isLimitationDeclared: false
  });
  assert.ok(summaryComMotivo.includes('OS #101'));
  assert.ok(summaryComMotivo.includes('Motivo Documentado da Retenção'));
  assert.ok(summaryComMotivo.includes('Câmbio aguardando peça do atuador'));
  assert.ok(summaryComMotivo.includes('Próximo Passo Prometido'));
  assert.ok(summaryComMotivo.includes('Instalar amanhã'));

  // Caso sem motivo documentado
  const summarySemMotivo = buildCaseOperationalSummary({
    order: orderLinea102,
    coverage: 'PARTIAL_ERP_ONLY',
    evidenceOrigin: 'CANONICAL_ANALYSIS',
    isLimitationDeclared: true
  });
  assert.ok(summarySemMotivo.includes('OS #102'));
  assert.ok(summarySemMotivo.includes('Não documentado na análise técnica'));
  assert.ok(summarySemMotivo.includes('Sem registro oficial de falta de peças ou indisponibilidade de mecânico'));
});

console.log('\n================================================================================');
console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES EXECUTOR 2 PASSARAM COM SUCESSO (100% PASS)!`);
console.log('================================================================================');
