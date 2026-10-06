import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat,
  splitIntoWhatsAppBlocks
} from '../format_utils.js';

console.log('🧪 Iniciando Suíte de Testes da Camada de Formatação Nativa do WhatsApp (Spec 007)...\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) console.error(`     Detalhe: ${details}`);
    process.exitCode = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 1: Exemplos Canônicos de Payload Final
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Teste 1: Exemplos Canônicos Exigidos ---');

// Exemplo 1: Card Operacional
const rawCard = `# Veículos retidos — Rei do Módulo
* Total: 26 veículos há mais de 5 dias
* Status: 3 OS aguardam peça
* Próxima ação: revisar as OS mais antigas`;

const blocksCard = splitIntoWhatsAppBlocks(rawCard);
assert(blocksCard.length === 1, 'Card operacional gera 1 balão');
assert(blocksCard[0].includes('> *Veículos retidos — Rei do Módulo*'), 'Cabeçalho convertido em blockquote com negrito');
assert(blocksCard[0].includes('- *Total:* 26 veículos há mais de 5 dias'), 'Itens de lista normalizados para traço -');
assert(assertWhatsAppNativeFormat(blocksCard[0]), 'Card está 100% em conformidade com WhatsApp Nativo');

// Exemplo 2: Alerta com Citação de Diálogo
const rawAlert = `> *Ponto crítico:* 26 veículos retidos há mais de 5 dias
- *Loja:* Jabaquara
- *Impacto:* prazo de entrega em risco

> Cliente: “Quando posso retirar o carro?”
> Gerente: “Ainda aguardamos a peça.”`;

const blocksAlert = splitIntoWhatsAppBlocks(rawAlert);
assert(blocksAlert.length >= 1, 'Alerta com citação processado com sucesso');
assert(blocksAlert[0].includes('> *Ponto crítico:*'), 'Preserva blockquote no ponto crítico');
assert(blocksAlert[0].includes('> Cliente: “Quando posso retirar o carro?”'), 'Preserva citação do cliente');
assert(blocksAlert[0].includes('> Gerente: “Ainda aguardamos a peça.”'), 'Preserva citação do gerente');
assert(assertWhatsAppNativeFormat(blocksAlert.join('\n\n')), 'Alerta e citações válidos em WhatsApp Nativo');

// Exemplo 3: Nuance Itálico vs Negrito
const rawNuance = `- *Status:* _estimativa_ sujeita a confirmação\n- *Valor:* *R$ 1.450,00* (*confirmado*)`;
const blocksNuance = splitIntoWhatsAppBlocks(rawNuance);
assert(blocksNuance[0].includes('_estimativa_'), 'Preserva itálico _estimativa_');
assert(blocksNuance[0].includes('*confirmado*'), 'Preserva negrito *confirmado*');
assert(assertNoDoubleAsterisks(blocksNuance[0]), 'Zero asteriscos duplos na nuance');

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 2: Preservação Estrita de Entidades de Negócio Literais
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Teste 2: Preservação de Entidades Literais (#OS, Placas, Moedas) ---');

const rawBusiness = `### Detalhe da OS #426 e OS #55555
Veículo: Chery Tiggo (Placa EXI3E09)
Cliente: Marcus Vinicius
Valor Total: R$ 18.000,00 (Quitado)`;

const blocksBusiness = splitIntoWhatsAppBlocks(rawBusiness);
assert(blocksBusiness[0].includes('#426'), 'Preserva identificador literal #426 sem converter em título');
assert(blocksBusiness[0].includes('#55555'), 'Preserva identificador literal #55555');
assert(blocksBusiness[0].includes('EXI3E09'), 'Preserva placa Mercosul EXI3E09');
assert(blocksBusiness[0].includes('R$ 18.000,00'), 'Preserva valor monetário R$ 18.000,00');

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 3: Casos Adversos & Higienização de Markdown Incompatível
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Teste 3: Casos Adversos & Limpeza de Markdown ---');

const toxicInput = `## Relatório Crítico
---
**Negrito duplo** e __itálico duplo__ e ***negrito triplo***
| Loja | Pátio | Saldo |
| --- | --- | --- |
| Jabaquara | 18 | R$ 42.150 |
| Mauá | 12 | R$ 15.000 |
---
🚨🚨🚨🚨🚨 ATENÇÃO: Falta sinal financeiro!
<script>alert(1)</script>`;

const sanitizedToxic = sanitizeWhatsAppMarkdown(toxicInput);
assert(!sanitizedToxic.includes('**'), 'Elimina todos os asteriscos duplos (**) ');
assert(!sanitizedToxic.includes('__'), 'Elimina todos os underscores duplos (__)');
assert(!sanitizedToxic.includes('---'), 'Elimina linhas separadoras Markdown');
assert(!sanitizedToxic.includes('<script>'), 'Elimina tags HTML');
assert(sanitizedToxic.includes('> *Relatório Crítico*'), 'Converte cabeçalho ## em blockquote > *...*');
  assert(sanitizedToxic.includes('*Jabaquara*') || sanitizedToxic.includes('- Jabaquara'), 'Converte tabela Markdown em lista com tra?o -');
assert(!sanitizedToxic.includes('🚨🚨🚨'), 'Comprime emojis repetidos em série');
assert(assertWhatsAppNativeFormat(sanitizedToxic), 'Saída adversa aprovada em assertWhatsAppNativeFormat');

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 4: Idempotência Total da Sanitização
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Teste 4: Idempotência Total (f(f(x)) === f(x)) ---');

const samples = [
  rawCard,
  rawAlert,
  rawNuance,
  rawBusiness,
  toxicInput
];

for (let i = 0; i < samples.length; i++) {
  const once = sanitizeWhatsAppMarkdown(samples[i]);
  const twice = sanitizeWhatsAppMarkdown(once);
  assert(once === twice, `Amostra ${i + 1} é estritamente idempotente`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 5: Card-Aware Chunking & Delimitador Platform Hint
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Teste 5: Card-Aware Chunking & Divisão de Balões ---');

// Com delimitador explícito ---BLOCK---
const splitExplicit = `Balão 1: Notificação inicial\n---BLOCK---\n> *Card 2: Detalhes*\n- *Item:* OK`;
const blocksExplicit = splitIntoWhatsAppBlocks(splitExplicit);
assert(blocksExplicit.length === 2, 'Divide exatamente no delimitador ---BLOCK---');
assert(blocksExplicit[0] === 'Balão 1: Notificação inicial', 'Balão 1 íntegro');
assert(blocksExplicit[1].startsWith('> *Card 2: Detalhes*'), 'Balão 2 íntegro');

// Balão curto (<180 chars)
const shortMsg = 'Olá! Tudo certo por aqui? Como posso te ajudar hoje?';
const shortBlocks = splitIntoWhatsAppBlocks(shortMsg);
assert(shortBlocks.length === 1, 'Mensagem curta permanece em balão único');

console.log(`\n========================================================`);
console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
console.log(`========================================================\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
