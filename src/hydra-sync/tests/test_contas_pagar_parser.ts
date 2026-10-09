/**
 * test_contas_pagar_parser.ts
 *
 * Suíte de testes unitários do parser estruturado de Contas a Pagar.
 * Valida a extração real contra a fixture BuscaContasAPagar.xls baixada do ERP.
 */

import * as path from 'path';
import { parseContasPagarExcel, normalizarSlugLoja, converterDataExcel } from '../contas_pagar_parser';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

console.log('🧪 Iniciando testes do parser estruturado de Contas a Pagar...');

// 1. Teste de normalização de lojas
assert(normalizarSlugLoja('ReiDoOleoMaua') === 'maua', 'Normaliza Mauá');
assert(normalizarSlugLoja('MPrudge') === 'rudge_ramos', 'Normaliza Rudge Ramos');
assert(normalizarSlugLoja('MPSantoAndre') === 'santo_andre', 'Normaliza Santo André');
assert(normalizarSlugLoja('ReiDoModulo') === 'rei_do_modulo', 'Normaliza Rei do Módulo');
assert(normalizarSlugLoja('MPdompedro1') === 'dom_pedro', 'Normaliza Dom Pedro');
console.log('  ✅ [PASS] Normalização de slugs de lojas');

// 2. Teste de conversão de datas (serial Excel)
const dataConvertida = converterDataExcel(46303);
assert(dataConvertida === '2026-10-08', `Serial 46303 deve converter para 2026-10-08 (obtido: ${dataConvertida})`);
console.log('  ✅ [PASS] Conversão de serial Excel (46303 -> 2026-10-08)');

// 3. Teste de leitura da fixture real
const fixturePath = path.resolve(__dirname, '../fixtures/BuscaContasAPagar.xls');
const lancamentos = parseContasPagarExcel(fixturePath);

console.log(`  📊 Total de lançamentos extraídos da fixture: ${lancamentos.length}`);
assert(lancamentos.length > 0, 'Deve extrair pelo menos 1 lançamento da fixture real');

// Validar primeiro lançamento (ALLIANZ SEGUROS S/A - Mauá)
const primeiro = lancamentos[0];
console.log('  Primeiro lançamento:', JSON.stringify(primeiro, null, 2));

assert(primeiro.lojaSlug === 'maua', 'Loja do primeiro lançamento deve ser maua');
assert(primeiro.codigo === 21310, 'Código do primeiro lançamento deve ser 21310');
assert(primeiro.fornecedor.includes('ALLIANZ SEGUROS'), 'Fornecedor deve ser Allianz Seguros');
assert(primeiro.valorPago === 1266.5, 'Valor pago deve ser R$ 1266,50');
assert(primeiro.dataPagamento === '2026-10-08', 'Data de pagamento deve ser 2026-10-08');
assert(primeiro.id === 'maua:21310:1-1', 'ID canônico deve ser maua:21310:1-1');
assert(primeiro.textoSemantico.includes('ALLIANZ SEGUROS S/A'), 'Texto semântico deve conter fornecedor');
assert(primeiro.textoSemantico.includes('R$ 1266.50'), 'Texto semântico deve conter valor formatado');

console.log('  ✅ [PASS] Integridade de dados do primeiro lançamento');

// Validar soma de valores
const somaPago = lancamentos.reduce((acc, cur) => acc + cur.valorPago, 0);
console.log(`  💰 Soma total paga na fixture: R$ ${somaPago.toFixed(2)}`);
assert(somaPago > 0, 'Soma total de pagamentos deve ser maior que zero');

console.log('\n================================================================');
console.log('🎉 TODOS OS TESTES DO PARSER DE CONTAS A PAGAR PASSARAM COM SUCESSO!');
console.log('================================================================');
