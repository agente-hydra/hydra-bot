/**
 * Hydra — Teste Isolado do Executor 1: Semântica, Conteúdo Factual e Resposta
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 1 (Sessão de5452f5-ae9d-4de2-af64-0b12f075f5ea)
 * Stack: TypeScript Strict
 */

import assert from 'node:assert';
import { ConversationSemanticResolver } from '../conversation_semantic_resolver';
import { EvidencePolicyManager } from '../evidence_policy_manager';
import { OSSituationComposer } from '../os_situation_composer';

console.log('=== TESTES DO EXECUTOR 1: SEMÂNTICA, CONTEÚDO FACTUAL E RESPOSTA ===\n');

const resolver = new ConversationSemanticResolver();
const composer = new OSSituationComposer();

// ----------------------------------------------------------------------------
// Teste 1: Reconhecimento de DELAY_REASON e Preservação de Alvo Individual
// ----------------------------------------------------------------------------
console.log('Teste 1: Intenção DELAY_REASON preservando modelo Linea e loja Jabaquara...');
const res1 = resolver.resolveIntent('fala sobre o linea do jabaquara por favor, qq ta acontecendo?');
assert.strictEqual(res1.isOSSituationQuery, true, 'Deve ser consulta de situação');
assert.strictEqual(res1.isAggregatorQuery, false, 'NÃO pode ser agregador geral de loja');
assert.strictEqual(res1.vehicleModel, 'linea', 'Deve extrair modelo Linea');
assert.strictEqual(res1.requestedLojaSlug, 'jabaquara', 'Deve extrair loja Jabaquara');
assert.strictEqual(res1.specificQuestionType, 'DELAY_REASON', 'Deve identificar pergunta de motivo/andamento');

const res1b = resolver.resolveIntent('por que tá parado há tanto tempo esse carro?');
assert.strictEqual(res1b.specificQuestionType, 'DELAY_REASON', 'Deve classificar como DELAY_REASON');
console.log('✓ Teste 1 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 2: Cláusula Anti-Alucinação de Causas (H08 e R03)
// ----------------------------------------------------------------------------
console.log('\nTeste 2: Anti-alucinação no status NA FILA PARA EXECUÇÃO sem causa comprovada...');
const delayEvalNoCause = EvidencePolicyManager.evaluateDelayCause('NA FILA PARA EXECUÇÃO', undefined);
assert.strictEqual(delayEvalNoCause.hasValidEvidence, false);
assert.strictEqual(delayEvalNoCause.isAttributedToPerson, false);
assert.match(delayEvalNoCause.statement, /Não consta nos registros consultados um motivo específico/);
assert.doesNotMatch(delayEvalNoCause.statement, /falta de mecânicos|falta de box|complexidade/);

// Causa com relato de atendente
const delayEvalWithCause = EvidencePolicyManager.evaluateDelayCause(
  'NA FILA PARA EXECUÇÃO',
  'Aguardando chegada do amortecedor da fábrica',
  'ATTENDANT',
  'Carlos (Atendente)'
);
assert.strictEqual(delayEvalWithCause.hasValidEvidence, true);
assert.strictEqual(delayEvalWithCause.isAttributedToPerson, true);
assert.match(delayEvalWithCause.statement, /Motivo informado por atendente \(Carlos \(Atendente\)\): "Aguardando chegada do amortecedor da fábrica"/);
console.log('✓ Teste 2 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 3: Distinção Factual entre Abertura da OS e Presença no Pátio (R03 e H17)
// ----------------------------------------------------------------------------
console.log('\nTeste 3: Distinção entre Abertura da OS e presença física no pátio...');
const openedAt = '2026-09-23T10:15:00.000Z';
const refTime = '2026-10-02T10:15:00.000Z'; // Exatamente 9 dias depois
const osTimeEval = EvidencePolicyManager.evaluateOSTime(openedAt, refTime, false);

assert.strictEqual(osTimeEval.daysOpen, 9);
assert.strictEqual(osTimeEval.hasPhysicalYardEvidence, false);
assert.match(osTimeEval.statement, /OS aberta há 9 dia\(s\)/);
assert.doesNotMatch(osTimeEval.statement, /carro no pátio há 9 dias/);
assert.match(osTimeEval.statement, /registro cadastral de sistema; presença física contínua no pátio depende de conferência presencial/);
console.log('✓ Teste 3 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 4: Chegada Parcial de Peças (A4.1 e H09)
// ----------------------------------------------------------------------------
console.log('\nTeste 4: Redução de quantidades em chegada parcial de peças...');
const requestedParts = [
  { partName: 'Amortecedor dianteiro', partCode: 'AMT100', quantity: 2, orderRef: 'PED_1' },
  { partName: 'Pastilha de freio', partCode: 'PST200', quantity: 1, orderRef: 'PED_2' }
];

// Chega apenas 1 amortecedor (saldo pendente deve ser 1 amortecedor e 1 pastilha)
const partialArrival1 = [{ partCode: 'AMT100', quantity: 1 }];
const red1 = EvidencePolicyManager.reducePartQuantities(requestedParts, partialArrival1);
assert.strictEqual(red1.isFullyResolved, false);
assert.strictEqual(red1.activeDependencies.length, 2);
assert.strictEqual(red1.activeDependencies[0].partCode, 'AMT100');
assert.strictEqual(red1.activeDependencies[0].quantityPending, 1, 'Deve restar 1 amortecedor pendente');
assert.strictEqual(red1.activeDependencies[1].partCode, 'PST200');
assert.strictEqual(red1.activeDependencies[1].quantityPending, 1, 'Pastilha continua pendente');

// Chegam o segundo amortecedor e a pastilha (tudo resolvido)
const totalArrival = [
  { partCode: 'AMT100', quantity: 2 },
  { partCode: 'PST200', quantity: 1 }
];
const red2 = EvidencePolicyManager.reducePartQuantities(requestedParts, totalArrival);
assert.strictEqual(red2.isFullyResolved, true);
assert.strictEqual(red2.activeDependencies.length, 0);
console.log('✓ Teste 4 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 5: Avaliação de Orçamento por Versão (A4.1)
// ----------------------------------------------------------------------------
console.log('\nTeste 5: Aprovação de orçamento v1 NÃO resolve dependência de v2...');
const budgetEval = EvidencePolicyManager.evaluateBudgetApproval('v1', 'v2');
assert.strictEqual(budgetEval.isApproved, false, 'Aprovação de v1 não pode aprovar v2');
assert.strictEqual(budgetEval.approvedVersion, 'v1');
assert.strictEqual(budgetEval.pendingVersion, 'v2');
assert.match(budgetEval.statement, /Orçamento v1 foi aprovado anteriormente, mas há complemento de orçamento v2 pendente de aprovação/);

const budgetEvalOk = EvidencePolicyManager.evaluateBudgetApproval('v2', 'v2');
assert.strictEqual(budgetEvalOk.isApproved, true);
console.log('✓ Teste 5 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 6: Pergunta de Capacidades do Assistente (H16)
// ----------------------------------------------------------------------------
console.log('\nTeste 6: Resposta sobre capacidades do assistente...');
const resCap = resolver.resolveIntent('você consulta as conversas do WhatsApp?');
assert.strictEqual(resCap.specificQuestionType, 'CAPABILITIES_EXPLANATION');

const balloonCap = composer.compose({
  osId: 501,
  lojaSlug: 'MPJabaquara',
  vehiclePlate: 'ABC1D23',
  vehicleModel: 'Linea',
  specificQuestionType: 'CAPABILITIES_EXPLANATION',
  erpState: {
    status: 'NA FILA PARA EXECUÇÃO',
    totalValue: 2000,
    paidValue: 0,
    pendingServices: [],
    updatedAt: new Date().toISOString()
  }
});
assert.match(balloonCap.formattedWhatsAppBalloon, /Consulta de Atendimento — Capacidades e Fontes de Dados/);
assert.match(balloonCap.formattedWhatsAppBalloon, /Consigo consultar as informações operacionais da oficina no ERP e as análises já registradas/);
assert.match(balloonCap.formattedWhatsAppBalloon, /No caminho padrão, utilizo os registros históricos consolidados/);
console.log('✓ Teste 6 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 7: Composição de Balão com DELAY_REASON sem causa alucinada (H08)
// ----------------------------------------------------------------------------
console.log('\nTeste 7: Composição do balão com DELAY_REASON factual...');
const balloonDelay = composer.compose({
  osId: 439,
  lojaSlug: 'MPJabaquara',
  vehiclePlate: 'LIN1234',
  vehicleModel: 'Linea',
  openedAt: '2026-09-23T10:15:00.000Z',
  specificQuestionType: 'DELAY_REASON',
  erpState: {
    status: 'NA FILA PARA EXECUÇÃO',
    totalValue: 1500,
    paidValue: 0,
    pendingServices: ['Troca de suspensão'],
    updatedAt: '2026-09-23T10:15:00.000Z',
    openedAt: '2026-09-23T10:15:00.000Z'
  },
  analysisState: {
    analysisId: 'an_439',
    analysisVersion: '1.0',
    analyzedUntilTimestamp: '2026-09-23T12:00:00.000Z',
    statements: [],
    gaps: []
  }
});

assert.match(balloonDelay.formattedWhatsAppBalloon, /OS aberta há \d+ dia\(s\)/);
assert.match(balloonDelay.formattedWhatsAppBalloon, /Não consta nos registros consultados um motivo específico/);
assert.match(balloonDelay.formattedWhatsAppBalloon, /sem evidência de falta de peças ou técnicos/);
assert.doesNotMatch(balloonDelay.formattedWhatsAppBalloon, /a demora decorre de|atraso causado por falta de box/i);
console.log('✓ Teste 7 passou com sucesso.');

console.log('\n============================================================');
console.log('TODOS OS TESTES DO EXECUTOR 1 PASSARAM COM 100% DE SUCESSO!');
console.log('============================================================\n');
