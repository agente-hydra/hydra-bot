import assert from 'node:assert';
import { splitIntoWhatsAppBlocks, sanitizeWhatsAppMarkdown } from '../format_utils.js';

console.log('[TEST] Iniciando validação de preservação de balões (Padrão Oficial Bot de Análise)...');

// 1. Simulação do formato oficial do bot de análise (espelho de whatsapp_formatter.ts / LOG #490)
const rawAnalysisOutput = `*HYDRA | Gargalos Operacionais*

07/10/2026 · 14:15

*Visão geral*
- Veículos em pátio físico: *33* carros na rede
- Retidos há mais de 5 dias: *9* carros (27% do pátio ativo)
- Saldo em aberto sem sinal: *R$ 17.350,00* (4 ordens críticas)

*Ponto crítico*
> Peugeot 408 (FRI8G91) travado há 29 dias em Dom Pedro I e 2 carros com mais de R$ 24k em serviço parados há 6 dias no Rei do Óleo Mauá.

*Gargalos de pátio (Aging > 5 dias)*
- Rudge Ramos: Focus LLX5E81 há 6 dias (*R$ 12.206*) e Tucson GDZ7I78 há 5 dias (*R$ 2.100*).
- Rei do Óleo Mauá: Fox EBX8211 e Sonic FQK6B71 retidos há 6 dias (*R$ 24.254* em serviços).
- Planalto: Voyage LS LZQ0669 há 5 dias (*R$ 6.731*).
- Jabaquara: C3 FHK2C07 há 5 dias (*R$ 4.300*).
---BLOCK---
*Risco financeiro (Saldo sem sinal)*
- Santo André: OS #2470 (BMW 320i) com *R$ 7.000,00* em aberto e R$ 0,00 pago.
- Rei do Módulo: OS #1856 (Fusca Novo - *R$ 4.000,00*) e OS #1918 (UP - *R$ 3.750,00*) sem entrada.
- Jabaquara: OS #465 (Ka SE) com *R$ 2.600,00* sem sinal.

*Compliance e vistorias*
- Checklists do mecânico: 30 de 33 veículos físicos sem preenchimento na rede.
- Rudge Ramos e Rei do Módulo operam sem nenhuma vistoria de entrada gravada.

*O que fazer agora*
1. Cobrar sinal mínimo na BMW de Santo André (R$ 7.000) e nas OSs do Rei do Módulo.
2. Agilizar liberação dos veículos de maior valor travados há 6 dias em Mauá e Rudge Ramos.

Quer detalhar alguma dessas ordens ou unidades?`;

// 2. O dispatcher divide via splitIntoWhatsAppBlocks
const messagesFromDispatcher = splitIntoWhatsAppBlocks(rawAnalysisOutput);

assert.strictEqual(messagesFromDispatcher.length, 2, `Esperava 2 balões estruturados, obteve ${messagesFromDispatcher.length}`);

// Balão 1: Cabeçalho institucional, Visão Geral, Ponto Crítico e Pátio
assert.ok(messagesFromDispatcher[0].startsWith('*HYDRA | Gargalos Operacionais*'), 'Balão 1 deve começar com o cabeçalho oficial *HYDRA | ...*');
assert.ok(messagesFromDispatcher[0].includes('07/10/2026 · 14:15'), 'Balão 1 deve conter data e hora com ponto central');
assert.ok(messagesFromDispatcher[0].includes('*Visão geral*'), 'Balão 1 deve conter seção *Visão geral*');
assert.ok(messagesFromDispatcher[0].includes('*Ponto crítico*\n> Peugeot 408'), 'Balão 1 deve conter *Ponto crítico* seguido de citação >');
assert.ok(messagesFromDispatcher[0].includes('*Gargalos de pátio (Aging > 5 dias)*'), 'Balão 1 deve conter seção de pátio');
assert.ok(!messagesFromDispatcher[0].includes('• '), 'Balão 1 NÃO deve conter marcadores • ');

console.log('BALAO 1:', messagesFromDispatcher[0]);
console.log('BALAO 2:', messagesFromDispatcher[1]);

// Balão 2: Risco financeiro, Compliance e O que fazer agora
assert.ok(messagesFromDispatcher[1].startsWith('*Risco financeiro (Saldo sem sinal)*'), 'Balão 2 deve começar com *Risco financeiro*');
assert.ok(messagesFromDispatcher[1].includes('Santo André'), 'Balão 2 deve conter item de Santo André');
assert.ok(messagesFromDispatcher[1].includes('*O que fazer agora*\n1. '), 'Balão 2 deve conter ações numeradas 1. e 2.');

// 3. Simulação da nova lógica do Webhook Listener (Passthrough Direto de parsed.messages)
function simulateWebhookResolution(parsed: { messages?: string[]; replyText?: string }): string[] {
  if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
    return parsed.messages;
  }
  if (parsed.replyText && parsed.replyText.trim()) {
    return splitIntoWhatsAppBlocks(parsed.replyText);
  }
  return ['Não foi possível formular uma resposta.'];
}

const resolvedMessages = simulateWebhookResolution({
  replyText: rawAnalysisOutput,
  messages: messagesFromDispatcher
});

assert.strictEqual(resolvedMessages.length, 2, 'O listener deve despachar exatamente 2 balões');
assert.deepStrictEqual(resolvedMessages, messagesFromDispatcher, 'Os balões despachados devem ser 100% idênticos aos gerados pelo dispatcher');

// Validar que nenhum balão contém asterisco desbalanceado
for (let i = 0; i < resolvedMessages.length; i++) {
  const m = resolvedMessages[i];
  const asteriskCount = (m.match(/\*/g) || []).length;
  assert.strictEqual(asteriskCount % 2, 0, `Balão ${i + 1} possui número ímpar de asteriscos (${asteriskCount})!`);
}

console.log('✅ [TEST SUCCESS] Todos os testes do formato oficial do bot de análise passaram!');
