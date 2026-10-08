import assert from 'node:assert/strict';
import { splitIntoWhatsAppBlocks, isSectionHeader } from '../format_utils.js';

console.log('=== TESTE DE DIVISÃO DE BALÕES POR TÍTULO (TITLE-AWARE CHUNKING) ===');

// 1. Teste de detecção de cabeçalhos
console.log('\n[1/4] Testando detector de cabeçalhos isSectionHeader...');
assert.equal(isSectionHeader('> 1. Gargalo de Volume de Pátio e Retenção Operacional'), true);
assert.equal(isSectionHeader('> *Diagnóstico de Gargalos Operacionais e Financeiros*'), true);
assert.equal(isSectionHeader('> *Ranking de Faturamento:*'), true);
assert.equal(isSectionHeader('*1. Gargalo de Volume*'), true);
assert.equal(isSectionHeader('- Rudge Ramos: 6 veículos em atendimento'), false);
assert.equal(isSectionHeader('Cruzando os dados de ocupação de pátio...'), false);
console.log('✅ isSectionHeader validado com sucesso.');

// 2. Teste de resposta curta (deve permanecer em 1 balão)
console.log('\n[2/4] Testando resposta curta (<600 chars)...');
const shortText = `> *Raio-X: MPSantoAndre*
- Veículos no pátio: 1
- Faturamento: R$ 19.571,10
- Ticket Médio: R$ 1.957,00`;
const shortBlocks = splitIntoWhatsAppBlocks(shortText);
assert.equal(shortBlocks.length, 1);
assert.ok(shortBlocks[0].includes('MPSantoAndre'));
console.log('✅ Resposta curta preservada em 1 balão.');

// 3. Teste do caso real de múltiplos gargalos com títulos
console.log('\n[3/4] Testando caso real de múltiplos gargalos do usuário...');
const realUserText = `> Diagnóstico de Gargalos Operacionais e Financeiros por Loja
- Posição: 07/10/2026 às 12:13
Cruzando os dados de ocupação de pátio, tempo de retenção (aging) e exposição financeira, identificamos os seguintes gargalos críticos hoje:

> 1. Gargalo de Volume de Pátio e Retenção Operacional
- Rudge Ramos: Maior pátio da rede com 30 OSs abertas (R$ 76.061 em serviço). Possui veículos travados há 6 dias (Focus LLX5E81 - R$ 12.206) e há 5 dias (Tucson GDZ7I78), além de 29 OSs sem checklist de entrada/mecânico preenchido.
- Dom Pedro I: Veículo com maior tempo de retenção da rede operacional: Peugeot 408 (FRI8G91, OS #578) travado há 29 dias no pátio.
- Rei do Óleo Mauá: 21 OSs em aberto, com veículos retidos há 6 dias aguardando liberação (Fox EBX8211 de R$ 15.605 e Sonic FQK6B71 de R$ 8.649).

> 2. Gargalo de Exposição Financeira (Saldo em Aberto sem Sinal/Entrada)
- Santo André: OS #2470 (BMW 320I GGR0E01) com R$ 7.000,00 em aberto e R$ 0,00 recebido/sinal registrado. A loja acumula R$ 7.339 a receber no pátio e está com ritmo de faturamento 37% abaixo da meta.
- Rei do Módulo: R$ 14.150,90 de saldo restante a receber no pátio (o maior volume da rede), com destaque para as OSs #1856 (Fusca Novo - R$ 4.000 zerada de pagamento) e #1918 (Up ELR9G20 - R$ 3.750 sem sinal).
- Jabaquara: OS #465 (Ka SE BXD6F52) com R$ 2.600 em aberto sem nenhum pagamento de entrada.

> 3. Gargalo de Processo e Compliance (Checklists Pendentes)
- Da rede como um todo, 112 OSs estão sem checklist de entrada e 169 sem checklist mecânico.
- Rudge Ramos e Rei do Módulo são as mais críticas em conformidade: praticamente 100% dos carros em pátio estão sem os registros de vistoria formalizados.

Quer que eu aprofunde em alguma unidade específica ou liste os detalhes de alguma dessas OSs retidas?`;

const blocks = splitIntoWhatsAppBlocks(realUserText);
console.log(`Gerou ${blocks.length} balões:`);
blocks.forEach((b, i) => {
  console.log(`\n--- BALÃO ${i + 1} (${b.length} chars) ---`);
  console.log(b.slice(0, 100) + '...');
  
  // NENHUM balão pode terminar com título órfão!
  const lastLine = b.trim().split('\n').pop()?.trim() || '';
  const isOrphan = isSectionHeader(lastLine);
  assert.equal(isOrphan, false, `Balão ${i + 1} terminou com título órfão: "${lastLine}"`);
});

// Verifica que o título do Gargalo 2 está no topo de um balão e tem seus carros juntos
const balaoGargalo2 = blocks.find(b => b.includes('2. Gargalo de Exposição Financeira'));
assert.ok(balaoGargalo2, 'Deve existir um balão contendo o Gargalo 2');
assert.ok(balaoGargalo2.includes('OS #2470'), 'O balão do Gargalo 2 deve conter o detalhamento da OS #2470 de Santo André junto dele');

console.log('✅ Caso real de múltiplos gargalos dividido perfeitamente por títulos sem órfãos.');

// 4. Teste de Platform Hint explícito (---BLOCK---)
console.log('\n[4/4] Testando delimitador explícito ---BLOCK---...');
const explicitText = `Bloco 1 com dados da loja.---BLOCK---Bloco 2 com alerta financeiro.---BLOCK---Bloco 3 com auditoria.`;
const explicitBlocks = splitIntoWhatsAppBlocks(explicitText);
assert.equal(explicitBlocks.length, 3);
assert.equal(explicitBlocks[0], 'Bloco 1 com dados da loja.');
assert.equal(explicitBlocks[1], 'Bloco 2 com alerta financeiro.');
assert.equal(explicitBlocks[2], 'Bloco 3 com auditoria.');
console.log('✅ Delimitador ---BLOCK--- validado.');

console.log('\n🎉 TODOS OS TESTES DE DIVISÃO DE BALÕES PASSARAM COM SUCESSO!\n');
