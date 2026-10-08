/**
 * src/hydra-sync/tests/test_hermes_balloons_and_audit.ts
 * Suíte de testes de validação da spec hydra-hermes-balloons-and-os-audit:
 * - Gate 1: Balões Nativos com ---BLOCK---, sem corte de '... Ler mais', Title Case e categorias
 * - Gate 2: Hierarquia de checklists (Inspeção imediatamente abaixo de Entrada, antes de Mecânico)
 * - Gate 3: Card de auditoria factual do ERP para histórico e conversas da OS
 * - Gate 4: Zero asteriscos duplos (**) em todas as saídas
 * - Gate 5: Fallback gracioso do repositório para dados ausentes
 */

import Database from 'better-sqlite3';
import {
  composeFullOS360Card,
  composeOSConversationCard,
  toCleanTitleCase,
  isOSConversationQuery
} from '../os_situation_composer.js';
import { splitIntoWhatsAppBlocks } from '../format_utils.js';
import {
  OperationalDataRepository,
  ensureOrdensServicoTable,
  getOSDetails
} from '../operational_data_repository.js';

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

console.log('=== INÍCIO DA SUÍTE: Hermes Balões Executivos, Checklists e Auditoria ===\n');

// ----------------------------------------------------------------------------------
// GATE 1: Balões Nativos, Title Case, Categorias Semânticas e Sanitização
// ----------------------------------------------------------------------------------
console.log('🧪 TESTE 1: Gate 1 — Balões Nativos, Title Case e Categorias Semânticas (OS #18503)');

const os18503Servicos = [
  { descricao: 'DIAGNOSTICO NACIONAL', valorTotal: 385.00, executor: 'CENTRAL' },
  { descricao: 'REMOÇAO ALTERNADOR', valorTotal: 680.00, executor: 'CENTRAL' },
  { descricao: 'LIMPEZA SISTEMA ARREFECIMENTO', valorTotal: 149.90, executor: 'CENTRAL' },
  { descricao: 'SERVIÇO MOTOBOY', valorTotal: 26.00, executor: 'Preencher Executor...' },
  { descricao: 'ALINHAMENTO DIANTEIRO', valorTotal: 110.00, executor: 'Preencher Executor...' },
  { descricao: 'GEOMETRIA', valorTotal: 380.00, executor: 'Preencher Executor...' },
  { descricao: 'REGULAGEM ALAVANCA DE FREIO', valorTotal: 120.00, executor: 'Preencher Executor...' }
];

const os18503Pagamentos = [
  { parcela: 1, valor: 2010.00, modalidade: 'PIX', vencimento: '02/10/2026' },
  { parcela: 2, valor: 1998.00, modalidade: 'PIX', vencimento: '06/10/2026' }
];

const os18503Checklists = [
  { tipo: 'Check-List de Inspeção', status: 'Finalizado', realizado_por: 'Roberto Aquino Carneiro Lima', data: '02/10/26' }
];

const card360 = composeFullOS360Card({
  osId: 18503,
  lojaSlug: 'MPplanalto',
  vehicleModel: 'VOYAGE LS',
  vehiclePlate: 'LZQ0669',
  clientName: 'MAURO LUIZ RODRIGUES BU...',
  statusGrid: 'ABERTO',
  isOpen: true,
  daysInYard: 6,
  totalAmount: 6731.10,
  remainingBalance: 2723.10,
  servicos: os18503Servicos,
  pagamentos: os18503Pagamentos,
  checklists: os18503Checklists,
  checklistAudit: {
    temChecklistEntrada: true,
    temChecklistMecanico: false,
    detalhes: 'Checklist de Entrada realizado; Checklist do Mecânico pendente.'
  },
  temNf: false,
  documentosAnexosCount: 2,
  extracaoCompleta: true
});

const balloons = splitIntoWhatsAppBlocks(card360);

assert(balloons.length >= 3, `Deve gerar pelo menos 3 balões nativos para a OS 360 (gerou: ${balloons.length})`);
assert(balloons.every(b => b.length <= 900), 'Todos os balões devem ter <= 900 caracteres (evita corte de "... Ler mais")');
assert(!balloons.some(b => b.startsWith('---')), 'Nenhum balão deve iniciar com traços soltos de separador');

const servBalloon = balloons.find(b => b.includes('Serviços Discriminados')) || '';
assert(servBalloon.includes('*Elétrica & Ignição*'), 'Serviços devem categorizar grupo elétrico (Remoção Alternador)');
assert(servBalloon.includes('*Sistema de Arrefecimento*'), 'Serviços devem categorizar grupo arrefecimento (Limpeza Sistema Arrefecimento)');
assert(servBalloon.includes('*Suspensão, Direção & Rodagem*'), 'Serviços devem categorizar grupo suspensão/rodagem (Alinhamento / Geometria)');
assert(servBalloon.includes('*Sistema de Freios*'), 'Serviços devem categorizar grupo freios (Regulagem Alavanca)');
assert(servBalloon.includes('Diagnóstico Nacional'), 'Deve converter DIAGNOSTICO NACIONAL para Title Case limpo');
assert(servBalloon.includes('Remoção Alternador'), 'Deve converter REMOÇAO ALTERNADOR para Title Case limpo');
assert(!servBalloon.includes('Preencher Executor'), 'Deve suprimir o placeholder de Preencher Executor...');
assert(servBalloon.includes('(Central)'), 'Deve manter executor válido em Title Case');

// ----------------------------------------------------------------------------------
// GATE 2: Hierarquia de Checklists (Inspeção subordinado à Entrada, antes de Mecânico)
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: Gate 2 — Pareamento Hierárquico Estrito de Checklists');

const docBalloon = balloons.find(b => b.includes('Vistorias e Documentos')) || '';
const posEntrada = docBalloon.indexOf('*Checklist de Entrada:* Realizado');
const posInspecao = docBalloon.indexOf('Check-List de Inspeção');
const posMecanico = docBalloon.indexOf('*Checklist do Mecânico:* Pendente');

assert(posEntrada !== -1, 'Checklist de Entrada deve estar presente como Realizado');
assert(posInspecao !== -1, 'Check-List de Inspeção deve estar presente');
assert(posMecanico !== -1, 'Checklist do Mecânico deve estar presente como Pendente');
assert(posInspecao > posEntrada, 'Check-List de Inspeção deve aparecer APÓS Checklist de Entrada');
assert(posInspecao < posMecanico, 'Check-List de Inspeção deve aparecer ANTES de Checklist do Mecânico');
assert(docBalloon.includes('Roberto Aquino Carneiro Lima, 02/10/26'), 'Deve exibir o responsável e data da inspeção');

// ----------------------------------------------------------------------------------
// GATE 3: Card Factual de Histórico e Conversas da OS
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: Gate 3 — Card de Histórico e Conversas com Auditoria Factual do ERP');

assert(isOSConversationQuery('mas nao tem detalhes da conversa? e/ou historico cara'), 'Deve reconhecer pergunta de histórico e conversa');
assert(isOSConversationQuery('e conversas? nada?'), 'Deve reconhecer pergunta de conversas');

const convCard = composeOSConversationCard({
  osId: 18503,
  lojaSlug: 'MPplanalto',
  vehicleModel: 'VOYAGE LS',
  vehiclePlate: 'LZQ0669',
  clientName: 'MAURO LUIZ RODRIGUES BU...',
  clienteTelefone: '(11) 97444-3375',
  statusGrid: 'ABERTO',
  isOpen: true,
  daysInYard: 6,
  totalAmount: 6731.10,
  remainingBalance: 2723.10,
  observacao: '',
  historicoCriadoPor: 'Roberto Aquino Carneiro Lima',
  historicoCriadoEm: '02/10/2026 13:24',
  historicoAtualizadoPor: 'Marcos Vinycius',
  historicoAtualizadoEm: '06/10/2026 17:29',
  documentosAnexos: [
    { data: '06/10', descricao: 'DOCUMENTO' },
    { data: '07/10', descricao: 'CCI_001246.jpg' }
  ]
});

assert(convCard.includes('Auditoria Operacional no ERP'), 'Deve conter bloco de Auditoria Operacional no ERP');
assert(convCard.includes('Roberto Aquino Carneiro Lima em 02/10/2026 13:24'), 'Deve exibir criador e data de abertura do ERP');
assert(convCard.includes('Marcos Vinycius em 06/10/2026 17:29'), 'Deve exibir último atualizador e data no ERP');
assert(convCard.includes('Vazio (nenhuma anotação'), 'Deve explicar explicitamente que o campo observações da OS está em branco');
assert(convCard.includes('2 documento(s)'), 'Deve indicar os 2 anexos arquivados com descrição');
assert(convCard.includes('(11) 97444-3375'), 'Deve citar o telefone cadastrado e a ausência de chats espelhados');

// ----------------------------------------------------------------------------------
// GATE 4: Zero Asteriscos Duplos (**) em Todas as Saídas
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: Gate 4 — Regra de Ouro do WhatsApp: Zero Asteriscos Duplos');

assert(!card360.includes('**'), 'Card OS 360 não pode conter asteriscos duplos (**) em nenhum ponto');
assert(!convCard.includes('**'), 'Card de conversas não pode conter asteriscos duplos (**) em nenhum ponto');
assert(balloons.every(b => !b.includes('**')), 'Nenhum balão particionado pode conter asteriscos duplos (**)');

// ----------------------------------------------------------------------------------
// GATE 5: Repositório e Fallback Gracioso de Metadados
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 5: Gate 5 — Repositório de Dados Operacionais e Fallback Gracioso');

const testDb = new Database(':memory:');
ensureOrdensServicoTable(testDb);

// Ordem completa com auditoria
const rawFull = JSON.stringify({
  observacao: 'Cliente autorizou serviços via balcão.',
  historico_criado_em: '02/10/2026 10:00',
  historico_criado_por: 'Roberto Aquino',
  historico_atualizado_em: '05/10/2026 15:30',
  historico_atualizado_por: 'Marcos Vinycius',
  cliente_telefone_sms: '(11) 99999-8888',
  cliente_cpf: '123.456.789-00'
});

testDb.prepare(`
  INSERT INTO ordens_servico (
    os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, raw_payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('1001', 'mpplanalto', 'GOL 1.6', 'ABC1234', 'Cliente Teste', 'ABERTO', 1, 1500, rawFull);

// Ordem legada sem auditoria
testDb.prepare(`
  INSERT INTO ordens_servico (
    os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, raw_payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('1002', 'mpplanalto', 'FOX 1.0', 'XYZ9876', 'Cliente Legado', 'ABERTO', 1, 800, null);

const repo = new OperationalDataRepository({ db: testDb });

const orderFull = repo.getOSDetails(1001, 'mpplanalto');
assert(orderFull !== null, 'Deve encontrar OS 1001');
assert(orderFull?.observacao === 'Cliente autorizou serviços via balcão.', 'Deve extrair observacao');
assert(orderFull?.historicoCriadoPor === 'Roberto Aquino', 'Deve extrair historicoCriadoPor');
assert(orderFull?.historicoAtualizadoPor === 'Marcos Vinycius', 'Deve extrair historicoAtualizadoPor');

const orderLegacy = repo.getOSDetails(1002, 'mpplanalto');
assert(orderLegacy !== null, 'Deve encontrar OS 1002 legada');
assert(orderLegacy?.observacao === undefined, 'Ordem sem observacao deve retornar undefined');
assert(orderLegacy?.historicoCriadoPor === undefined, 'Ordem sem historicoCriadoPor deve retornar undefined');
assert(orderLegacy?.historicoAtualizadoPor === undefined, 'Ordem sem historicoAtualizadoPor deve retornar undefined');

// Teste em repo.getOSById
(async () => {
  const osByIdFull = await repo.getOSById(1001, 'mpplanalto');
  assert(osByIdFull?.observacao === 'Cliente autorizou serviços via balcão.', 'getOSById deve retornar observacao');
  assert(osByIdFull?.clienteCpf === '123.456.789-00', 'getOSById deve retornar clienteCpf');

  const osByIdLegacy = await repo.getOSById(1002, 'mpplanalto');
  assert(osByIdLegacy?.observacao === undefined, 'getOSById legado deve ter observacao undefined');

  console.log('\n=== RESULTADO DOS TESTES ===');
  console.log(`Total aprovados: ${passed}`);
  console.log(`Total falhas: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
    process.exit(0);
  }
})();
