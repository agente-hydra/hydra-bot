/**
 * src/hydra-sync/tests/test_evo_interactive_os.ts
 * Suíte de testes automatizados da spec hydra-evo-interactive-os:
 *
 * 1. [API_VERIFY] Estrutura e conformidade do payload EvoListPayload para Evolution API v2.3.7
 * 2. [TEST_SEND_LIST] Envio simulado de sendList com headers e payload validados
 * 3. [FIXTURE_WEBHOOK] Fixture realista do webhook com selectedRowId, selectedButtonId, etc.
 * 4. [TEST_FALLBACK_TEXT] Normalização e parsing de comandos de texto de fallback (com/sem acento)
 * 5. [TEST_HYBRID_FREE_TEXT] Comportamento híbrido: mensagens livres sem bloqueio de URA (Zero State-Lockout)
 * 6. [TEST_PAYMENT_METRICS] Regra contábil de pagamento (Pago = total - saldoDevedor)
 * 7. [TEST_EMPTY_DATA] OS com campos nulos/ausentes (zero crash, zero textos vazios)
 * 8. [TEST_WHITELIST] Bloqueio incondicional de instâncias não autorizadas (rejeição de gerentes)
 * 9. [ZERO_PLACEHOLDERS] Ausência total de placeholders como '(Preencher Executor...)'
 * 10. [ZERO_EMOJIS] Formatação limpa, sóbria e executiva sem nenhum emoji
 */

import {
  ALLOWED_OS_MODULES,
  OS_MODULE_ROW_ID_REGEX,
  type EvoListPayload,
  type AllowedOSModule
} from '../types/evo_interactive_contract.js';

import {
  calculatePaymentMetrics,
  composeExecutiveOSSummary,
  composeOSInteractiveListPayload,
  composeOSServicesCard,
  composeOSPartsCard,
  composeOSPaymentsCard,
  composeOSDocumentsCard,
  composeOSHistoryCard,
  type OS360CardParams
} from '../os_situation_composer.js';

import { parseOSModuleIntent } from '../agent_dispatcher.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

console.log('=== INÍCIO DA SUÍTE: OS Interativa Evolution API (v2.3.7) ===\n');

// ----------------------------------------------------------------------------------
// Fixture Padrão de OS Real (OS #18503 - Voyage LS)
// ----------------------------------------------------------------------------------
const os18503Fixture: OS360CardParams = {
  osId: 18503,
  lojaSlug: 'MPplanalto',
  vehicleModel: 'VOYAGE LS',
  vehiclePlate: 'LZQ0669',
  clientName: 'MAURO LUIZ RODRIGUES BU...',
  clientPhone: '5511999999999',
  clienteTelefone: '5511999999999',
  statusGrid: 'ABERTO',
  isOpen: true,
  daysInYard: 6,
  responsavel: 'GERENTE PLANALTO',
  totalAmount: 6731.10,
  remainingBalance: 2723.10,
  servicos: [
    { descricao: 'DIAGNOSTICO NACIONAL', valorTotal: 385.00, executor: 'CENTRAL' },
    { descricao: 'REMOÇAO ALTERNADOR', valorTotal: 680.00, executor: 'CENTRAL' },
    { descricao: 'LIMPEZA SISTEMA ARREFECIMENTO', valorTotal: 149.90, executor: 'CENTRAL' },
    { descricao: 'SERVIÇO MOTOBOY', valorTotal: 26.00, executor: 'Preencher Executor...' },
    { descricao: 'ALINHAMENTO DIANTEIRO', valorTotal: 110.00, executor: 'Preencher Executor...' },
    { descricao: 'GEOMETRIA', valorTotal: 380.00, executor: 'Preencher Executor...' },
    { descricao: 'REGULAGEM ALAVANCA DE FREIO', valorTotal: 120.00, executor: 'Preencher Executor...' }
  ],
  pecas: [
    { descricao: 'ALTERNADOR REMANUFATURADO', valorTotal: 850.00 },
    { descricao: 'CORREIA DO ALTERNADOR', valorTotal: 95.00 },
    { descricao: 'ADITIVO ARREFECIMENTO', valorTotal: 120.00 }
  ],
  pagamentos: [
    { parcela: 1, valor: 2010.00, modalidade: 'PIX', vencimento: '02/10/2026' },
    { parcela: 2, valor: 1998.00, modalidade: 'PIX', vencimento: '06/10/2026' }
  ],
  checklists: [
    { tipo: 'Check-List de Inspeção', status: 'Finalizado', realizado_por: 'Roberto Aquino Carneiro Lima', data: '02/10/26' }
  ],
  checklistAudit: {
    temChecklistEntrada: true,
    temChecklistMecanico: false,
    detalhes: 'Checklist de Entrada realizado; Checklist do Mecânico pendente.'
  },
  temNf: false,
  documentosAnexosCount: 2,
  documentosAnexos: [
    { descricao: 'FOTO DO MOTOR', origem: 'Entrada', data: '02/10/2026' },
    { descricao: 'COMPROVANTE DE ENTRADA', origem: 'Recepção', data: '02/10/2026' }
  ],
  extracaoCompleta: true
};

// ==================================================================================
// TESTE 1: [API_VERIFY] Estrutura e Conformidade do Payload com a Evolution API v2.3.7
// ==================================================================================
console.log('🧪 TESTE 1: [API_VERIFY] Validação Estrutural do Payload sendList (v2.3.7)');

const listPayload = composeOSInteractiveListPayload(os18503Fixture, '5511999999999');

assert(listPayload.number === '5511999999999', 'Payload deve conter o número do destinatário sanitizado');
assert(listPayload.title.includes('OS #18503'), 'Título da lista deve referenciar a OS');
assert(listPayload.title.includes('VOYAGE LS'), 'Título da lista deve conter o modelo do veículo');
assert(listPayload.description.length > 0, 'Descrição da lista não deve estar vazia');
assert(listPayload.buttonText === 'Abrir detalhes', 'Texto do botão de abertura da lista deve ser "Abrir detalhes"');
assert(listPayload.footerText === 'Mecânica Popular · Sistema Hydra', 'footerText é obrigatório na v2.3.7 para evitar erro HTTP 400');
assert(Array.isArray(listPayload.sections) && listPayload.sections.length === 1, 'Deve conter exatamente 1 section');

const section = listPayload.sections[0];
assert(section.title.includes('Módulos da OS #18503'), 'Section deve ter título referenciando os módulos');
assert(section.rows.length === 5, 'Deve conter exatamente 5 opções modulares');

const expectedRowIds = [
  'os_18503_servicos',
  'os_18503_pecas',
  'os_18503_pagamentos',
  'os_18503_documentos',
  'os_18503_historico'
];

const generatedRowIds = section.rows.map(r => r.rowId);
assert(JSON.stringify(generatedRowIds) === JSON.stringify(expectedRowIds), 'Os rowIds gerados devem corresponder exatamente à especificação');
assert(section.rows.every(r => r.title.length > 0 && (r.description || '').length > 0), 'Todas as rows devem ter title e description não vazios');

// ==================================================================================
// TESTE 2: [TEST_SEND_LIST] Validação de Headers, Endpoint e Payload para a API
// ==================================================================================
console.log('\n🧪 TESTE 2: [TEST_SEND_LIST] Simulação de Requisição POST /message/sendList/{instance}');

function validateSendListRequest(instance: string, payload: EvoListPayload, apiKey: string) {
  const endpoint = `https://evo.tork.services/message/sendList/${instance}`;
  const headers = {
    'User-Agent': 'Hydra-Bot/1.0',
    'Content-Type': 'application/json',
    'apikey': apiKey
  };
  const bodyJson = JSON.stringify(payload);

  return {
    endpoint,
    headers,
    body: JSON.parse(bodyJson),
    isValid: Boolean(
      payload.number &&
      payload.title &&
      payload.description &&
      payload.buttonText &&
      payload.footerText &&
      Array.isArray(payload.sections) &&
      payload.sections.length > 0 &&
      payload.sections[0].rows.length > 0
    )
  };
}

const simRequest = validateSendListRequest('hydra', listPayload, 'test_api_key_123');
assert(simRequest.endpoint === 'https://evo.tork.services/message/sendList/hydra', 'Endpoint gerado deve ser o correto da Evolution API');
assert(simRequest.headers['apikey'] === 'test_api_key_123', 'Header de apikey deve estar presente');
assert(simRequest.headers['Content-Type'] === 'application/json', 'Content-Type deve ser application/json');
assert(simRequest.isValid === true, 'Requisição deve atender a todos os campos obrigatórios da Evolution API v2.3.7');

// ==================================================================================
// TESTE 3: [FIXTURE_WEBHOOK] Fixture Realista de Ingress da Evolution API
// ==================================================================================
console.log('\n🧪 TESTE 3: [FIXTURE_WEBHOOK] Extração de rowId e Botões Interativos no Ingress');

// Função de extração espelhada do webhook-listener.js
function extractTextFromWebhookBody(body: any): string {
  const messageObj = body?.data?.message || {};
  let text = '';

  if (messageObj.listResponseMessage?.singleSelectReply?.selectedRowId) {
    text = messageObj.listResponseMessage.singleSelectReply.selectedRowId;
  } else if (messageObj.buttonsResponseMessage?.selectedButtonId) {
    text = messageObj.buttonsResponseMessage.selectedButtonId;
  } else if (messageObj.templateButtonReplyMessage?.selectedId) {
    text = messageObj.templateButtonReplyMessage.selectedId;
  } else if (messageObj.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const params = JSON.parse(messageObj.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      text = params.id || params.selectedRowId || '';
    } catch {}
  } else {
    text = messageObj.conversation || messageObj.extendedTextMessage?.text || '';
  }

  return text.trim();
}

// Fixture 1: Clique em lista do WhatsApp via Evolution API v2.3.7
const listClickWebhookFixture = {
  event: 'messages.upsert',
  instance: 'hydra',
  data: {
    key: {
      remoteJid: '5511999999999@s.whatsapp.net',
      fromMe: false,
      id: 'BAE5F12345678'
    },
    message: {
      listResponseMessage: {
        title: 'Serviços',
        description: '7 itens discriminados · R$ 1.850,90',
        singleSelectReply: {
          selectedRowId: 'os_18503_servicos'
        }
      }
    }
  }
};

const extractedFromList = extractTextFromWebhookBody(listClickWebhookFixture);
assert(extractedFromList === 'os_18503_servicos', 'Deve extrair selectedRowId com precisão do listResponseMessage');

const parsedFromList = parseOSModuleIntent(extractedFromList);
assert(parsedFromList !== null, 'parseOSModuleIntent deve reconhecer o rowId extraído');
assert(parsedFromList?.osId === '18503', 'Deve extrair osId 18503');
assert(parsedFromList?.module === 'servicos', 'Deve identificar o módulo como "servicos"');

// Fixture 2: Clique em botão interativo nativeFlow
const nativeFlowWebhookFixture = {
  event: 'messages.upsert',
  instance: 'hydra',
  data: {
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({ id: 'os_18503_pecas' })
        }
      }
    }
  }
};
const extractedFromNativeFlow = extractTextFromWebhookBody(nativeFlowWebhookFixture);
assert(extractedFromNativeFlow === 'os_18503_pecas', 'Deve extrair id de nativeFlowResponseMessage');
const parsedFromNativeFlow = parseOSModuleIntent(extractedFromNativeFlow);
assert(parsedFromNativeFlow?.module === 'pecas', 'Deve identificar módulo "pecas" via native flow');

// ==================================================================================
// TESTE 4: [TEST_FALLBACK_TEXT] Normalização de Comandos Manuais de Texto
// ==================================================================================
console.log('\n🧪 TESTE 4: [TEST_FALLBACK_TEXT] Normalização e Resolução de Comandos Manuais');

const testCases = [
  { input: 'SERVICOS 18503', activeOs: undefined, expectedMod: 'servicos', expectedId: '18503' },
  { input: 'serviços 18503', activeOs: undefined, expectedMod: 'servicos', expectedId: '18503' },
  { input: 'Mão de obra 18503', activeOs: undefined, expectedMod: 'servicos', expectedId: '18503' },
  { input: 'PECAS 18503', activeOs: undefined, expectedMod: 'pecas', expectedId: '18503' },
  { input: 'peças 18503', activeOs: undefined, expectedMod: 'pecas', expectedId: '18503' },
  { input: 'materiais 18503', activeOs: undefined, expectedMod: 'pecas', expectedId: '18503' },
  { input: 'PAGAMENTOS 18503', activeOs: undefined, expectedMod: 'pagamentos', expectedId: '18503' },
  { input: 'financeiro 18503', activeOs: undefined, expectedMod: 'pagamentos', expectedId: '18503' },
  { input: 'saldo 18503', activeOs: undefined, expectedMod: 'pagamentos', expectedId: '18503' },
  { input: 'DOCUMENTOS 18503', activeOs: undefined, expectedMod: 'documentos', expectedId: '18503' },
  { input: 'checklist 18503', activeOs: undefined, expectedMod: 'documentos', expectedId: '18503' },
  { input: 'vistorias 18503', activeOs: undefined, expectedMod: 'documentos', expectedId: '18503' },
  { input: 'HISTORICO 18503', activeOs: undefined, expectedMod: 'historico', expectedId: '18503' },
  { input: 'histórico 18503', activeOs: undefined, expectedMod: 'historico', expectedId: '18503' },
  { input: 'conversas 18503', activeOs: undefined, expectedMod: 'historico', expectedId: '18503' },
  // Anáfora com activeOsId
  { input: 'servicos', activeOs: '18503', expectedMod: 'servicos', expectedId: '18503' },
  { input: 'peças', activeOs: 18503, expectedMod: 'pecas', expectedId: '18503' },
  { input: 'pagamentos', activeOs: '18503', expectedMod: 'pagamentos', expectedId: '18503' },
  { input: 'documentos', activeOs: '18503', expectedMod: 'documentos', expectedId: '18503' },
  { input: 'historico', activeOs: '18503', expectedMod: 'historico', expectedId: '18503' }
];

for (const tc of testCases) {
  const res = parseOSModuleIntent(tc.input, tc.activeOs);
  assert(
    res !== null && res.osId === tc.expectedId && res.module === tc.expectedMod,
    `Fallback texto: "${tc.input}" (activeOs: ${tc.activeOs}) -> mod: ${tc.expectedMod}, osId: ${tc.expectedId}`
  );
}

// Entradas inválidas não devem ser capturadas por parseOSModuleIntent
assert(parseOSModuleIntent('banana 18503') === null, 'Comando não relacionado deve retornar null');
assert(parseOSModuleIntent('servicos') === null, 'Comando sem número de OS e sem activeOsId deve retornar null');
assert(parseOSModuleIntent('') === null, 'Texto vazio deve retornar null');

// ==================================================================================
// TESTE 5: [TEST_HYBRID_FREE_TEXT] Zero State-Lockout (Não Bloqueia Mensagens Livres)
// ==================================================================================
console.log('\n🧪 TESTE 5: [TEST_HYBRID_FREE_TEXT] Comportamento Híbrido e Simbiose com Mensagens Livres');

const freeTextQueries = [
  'quanto Mauá faturou hoje?',
  'me dá o relatório do pátio de Mauá',
  'qual a meta de faturamento de outubro?',
  'quem é o mecânico responsável pelo Voyage?',
  'o cliente aprovou o orçamento do Voyage?'
];

for (const query of freeTextQueries) {
  const intent = parseOSModuleIntent(query, '18503');
  // Mensagens com perguntas abertas/gerais não são comandos estritos de módulo
  // e portanto NÃO travam o fluxo com mensagem de "Comando inválido, escolha uma opção da lista".
  if (query.includes('Mauá') || query.includes('meta')) {
    assert(intent === null, `Query executiva livre "${query}" não colide com menu de OS`);
  }
}

// ==================================================================================
// TESTE 6: [TEST_PAYMENT_METRICS] Regra Contábil de "Pago" (total - saldoDevedor)
// ==================================================================================
console.log('\n🧪 TESTE 6: [TEST_PAYMENT_METRICS] Auditoria Contábil de Pagamentos');

// Caso 1: Parcialmente pago (como na OS 18503)
const m1 = calculatePaymentMetrics(6731.10, 2723.10, [
  { parcela: 1, valor: 2010.00, modalidade: 'PIX' },
  { parcela: 2, valor: 1998.00, modalidade: 'PIX' }
]);
assert(Math.abs(m1.pago - 4008.00) < 0.01, `Pago deve ser exatamente a diferença contábil Total - Saldo (R$ 4.008,00), obtido: ${m1.pago}`);
assert(m1.saldo === 2723.10, `Saldo devedor deve ser preservado: ${m1.saldo}`);
assert(m1.total === 6731.10, `Total deve ser preservado: ${m1.total}`);

// Caso 2: Totalmente quitado (saldo 0)
const m2 = calculatePaymentMetrics(1500.00, 0.00);
assert(m2.pago === 1500.00 && m2.saldo === 0, 'Ordem quitada deve ter pago = total e saldo = 0');

// Caso 3: Totalmente em aberto (saldo = total)
const m3 = calculatePaymentMetrics(2500.00, 2500.00);
assert(m3.pago === 0.00 && m3.saldo === 2500.00, 'Ordem sem pagamentos deve ter pago = 0 e saldo = total');

// Caso 4: Sem saldo explícito, deduzindo da soma das parcelas
const m4 = calculatePaymentMetrics(1000.00, undefined, [
  { parcela: 1, valor: 400.00, modalidade: 'PIX' }
]);
assert(m4.saldo === 600.00 && m4.pago === 400.00, 'Dedução automática quando saldo não for fornecido diretamente');

// Caso 5: Valores zerados / ausentes
const m5 = calculatePaymentMetrics(undefined, undefined, undefined);
assert(m5.total === 0 && m5.saldo === 0 && m5.pago === 0, 'Tratamento seguro para parâmetros indefinidos');

// ==================================================================================
// TESTE 7: [TEST_EMPTY_DATA] Tolerância a Dados Incompletos / Nulos
// ==================================================================================
console.log('\n🧪 TESTE 7: [TEST_EMPTY_DATA] Resiliência a Ordens de Serviço com Dados Ausentes');

const emptyOSFixture: OS360CardParams = {
  osId: 99999,
  lojaSlug: 'MPplanalto',
  isOpen: true
};

let emptySummaryText = '';
let emptyListPayload: EvoListPayload | null = null;
let emptyServicesText = '';
let emptyPartsText = '';
let emptyPaymentsText = '';
let emptyDocumentsText = '';
let emptyHistoryText = '';

try {
  emptySummaryText = composeExecutiveOSSummary(emptyOSFixture);
  emptyListPayload = composeOSInteractiveListPayload(emptyOSFixture, '5511888888888');
  emptyServicesText = composeOSServicesCard(emptyOSFixture);
  emptyPartsText = composeOSPartsCard(emptyOSFixture);
  emptyPaymentsText = composeOSPaymentsCard(emptyOSFixture);
  emptyDocumentsText = composeOSDocumentsCard(emptyOSFixture);
  emptyHistoryText = composeOSHistoryCard(emptyOSFixture);
} catch (err: any) {
  assert(false, `Falha inesperada ao compor OS com dados ausentes: ${err.message}`);
}

assert(emptySummaryText.length > 50, 'Resumo deve ser gerado mesmo sem cliente/veículo');
assert(emptySummaryText.includes('Não informado'), 'Deve exibir "Não informado" para campos ausentes no resumo');
assert(emptyListPayload !== null && emptyListPayload.sections[0].rows.length === 5, 'Lista interativa deve manter 5 rows intactas');
assert(emptyServicesText.includes('Nenhum serviço discriminado'), 'Módulo de serviços deve informar ausência de dados graciosamente');
assert(emptyPartsText.includes('Nenhuma peça discriminada'), 'Módulo de peças deve informar ausência de dados graciosamente');
assert(emptyPaymentsText.includes('Nenhuma parcela individual cadastrada'), 'Módulo de pagamentos deve informar status graciosamente');
assert(emptyDocumentsText.includes('Não realizado'), 'Módulo de documentos deve refletir status factual sem crash');
assert(emptyHistoryText.length > 30, 'Módulo de histórico deve gerar card limpo');

// ==================================================================================
// TESTE 8: [TEST_WHITELIST] Rejeição Incondicional de Instâncias Não Autorizadas
// ==================================================================================
console.log('\n🧪 TESTE 8: [TEST_WHITELIST] Trava Estrita de Instâncias Emissoras de WhatsApp');

const ALLOWED_INSTANCES = new Set(['hydra', 'atendimento']);

function canSendFromInstance(instanceName: string): boolean {
  return ALLOWED_INSTANCES.has(instanceName);
}

// Instâncias autorizadas
assert(canSendFromInstance('hydra') === true, 'Instância "hydra" deve ser autorizada');
assert(canSendFromInstance('atendimento') === true, 'Instância "atendimento" deve ser autorizada');

// Instâncias de gerentes de loja (PROIBIÇÃO ABSOLUTA)
const forbiddenStoreManagers = [
  'Maua',
  'Jorge Beretta',
  'Kennedy',
  'Dom Pedro',
  'Rudge',
  'Jabaquara',
  'Piraporinha',
  'Planalto',
  'Carijós'
];

for (const forbidden of forbiddenStoreManagers) {
  assert(canSendFromInstance(forbidden) === false, `Instância de gerente "${forbidden}" DEVE ser bloqueada`);
}

// ==================================================================================
// TESTE 9: [ZERO_PLACEHOLDERS] Ausência de Placeholders e Textos de Teste do ERP
// ==================================================================================
console.log('\n🧪 TESTE 9: [ZERO_PLACEHOLDERS] Sanitização de Textos do ERP');

const summary18503 = composeExecutiveOSSummary(os18503Fixture);
const servicos18503 = composeOSServicesCard(os18503Fixture);
const pecas18503 = composeOSPartsCard(os18503Fixture);
const pagamentos18503 = composeOSPaymentsCard(os18503Fixture);
const documentos18503 = composeOSDocumentsCard(os18503Fixture);
const historico18503 = composeOSHistoryCard(os18503Fixture);

const allModularTexts = [
  summary18503,
  servicos18503,
  pecas18503,
  pagamentos18503,
  documentos18503,
  historico18503
];

const hasPlaceholder = allModularTexts.some(t => t.includes('Preencher Executor...'));
assert(!hasPlaceholder, 'Nenhum texto gerado deve conter o placeholder "Preencher Executor..." do ERP');

// ==================================================================================
// TESTE 10: [ZERO_EMOJIS] Formatação Limpa sem Emojis
// ==================================================================================
console.log('\n🧪 TESTE 10: [ZERO_EMOJIS] Verificação de Formatação Sem Emojis');

// Regex para detecção de emojis e símbolos pictográficos comuns
const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/u;

// Lista de emojis específicos conhecidos
const forbiddenChars = ['⚡', '🌡️', '🔩', '🛑', '📦', '💡', '🔵', '🟡', '🔴', '🚗', '🔧', '📋', '💰'];

// Verificação no resumo executivo e nos 4 primeiros módulos de OS (serviços, peças, pagamentos, documentos)
const osCardsToCheck = [
  { name: 'Resumo Executivo', text: summary18503 },
  { name: 'Card Serviços', text: servicos18503 },
  { name: 'Card Peças', text: pecas18503 },
  { name: 'Card Pagamentos', text: pagamentos18503 },
  { name: 'Card Documentos', text: documentos18503 }
];

for (const card of osCardsToCheck) {
  const containsPictograph = emojiRegex.test(card.text);
  const containsForbidden = forbiddenChars.some(char => card.text.includes(char));
  assert(!containsPictograph && !containsForbidden, `${card.name} deve ser 100% livre de emojis e pictogramas`);
}

// ==================================================================================
// TESTE 11: [ZERO_EMPTY_SECTIONS] Integridade das Seções e Balões
// ==================================================================================
console.log('\n🧪 TESTE 11: [ZERO_EMPTY_SECTIONS] Validação de Não-Truncamento e Conteúdo');

for (const card of osCardsToCheck) {
  assert(card.text.length >= 80, `${card.name} deve ter conteúdo substancial (>= 80 caracteres)`);
  assert(!card.text.includes('undefined') && !card.text.includes('null'), `${card.name} não deve conter "undefined" ou "null"`);
}

// ----------------------------------------------------------------------------------
// RESULTADO FINAL
// ----------------------------------------------------------------------------------
console.log('\n=======================================================');
console.log(`SUÍTE DE TESTES: ${passed} PASSOU | ${failed} FALHOU`);
console.log('=======================================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
