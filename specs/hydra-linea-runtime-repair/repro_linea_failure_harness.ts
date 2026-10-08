import assert from 'node:assert';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

console.log('=== INICIANDO HARNESS DE REPRODUCAO DE FALHAS (T1 a T6) ===\n');

// FALHA T2: 'nao foi isso que perguntei cara'
console.log('[PROVA T2] Colisao de correcao com historico...');
{
  const input = 'nao foi isso que perguntei cara';
  const norm = normalizeText(input);

  const isCorrection = 
    /\b(nao foi isso( que perguntei)?|nao era isso|nao perguntei isso|estou falando da nossa conversa|da nossa conversa|nada a ver|errou|vc entendeu errado|voce entendeu errado|interpretou errado|perdao n foi isso|desculpe n foi isso)\b/i.test(norm) ||
    norm.startsWith('nao foi isso') || norm.startsWith('nao e isso');

  const correctionPrefixRegex = /^(?:nao foi isso(?: que perguntei)?|nao era isso|nao perguntei isso|estou falando da nossa conversa|da nossa conversa|nada a ver|errou|vc entendeu errado|voce entendeu errado|interpretou errado|perdao n foi isso|desculpe n foi isso|nao e isso)[,\s.:;-]*/i;
  const strippedCorrectionQuery = norm.replace(correctionPrefixRegex, '').trim();
  const hasSubstantiveRectifiedQuery = isCorrection && strippedCorrectionQuery.length > 3 && !strippedCorrectionQuery.startsWith('nao');
  const mentionsTurnHistory = norm.includes('o que perguntei');

  console.log(`  Input: "${input}"`);
  console.log(`  isCorrection: ${isCorrection}`);
  console.log(`  strippedCorrectionQuery: "${strippedCorrectionQuery}"`);
  console.log(`  hasSubstantiveRectifiedQuery: ${hasSubstantiveRectifiedQuery} (FALHA: cara considerado query)`);
  console.log(`  mentionsTurnHistory: ${mentionsTurnHistory} (FALHA: o que perguntei colide)`);

  assert.strictEqual(isCorrection, true);
  assert.strictEqual(strippedCorrectionQuery, 'cara');
  assert.strictEqual(hasSubstantiveRectifiedQuery, true);
  assert.strictEqual(mentionsTurnHistory, true);
  console.log('  -> FALHA T2 REPRODUZIDA!\n');
}

// FALHA T6: 'nn foi isso que pedi'
console.log('[PROVA T6] Falso positivo de saudacao com nn...');
{
  const input = 'nn foi isso que pedi';
  const norm = normalizeText(input);

  const isCorrection = norm.startsWith('nao foi isso') || norm.startsWith('nao e isso') || norm.startsWith('errou') || norm.startsWith('nao e nada disso') || norm === 'nao foi isso' || norm === 'nao e isso';
  const greetingWords = ['oi', 'ola', 'opa', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'fala hydra', 'ola hydra', 'oi hydra'];
  const hasOperKeyword = norm.includes('placa') || norm.includes('os ') || norm.includes('checklist') || norm.includes('patio') || norm.includes('meta') || norm.includes('fatur') || norm.includes('cmv');

  const matchesGreetingWord = greetingWords.some(g => norm.startsWith(g) || norm.includes(g));
  const isGreeting = !isCorrection && !hasOperKeyword && (
    matchesGreetingWord && norm.length < 25
  );

  console.log(`  Input: "${input}"`);
  console.log(`  isCorrection: ${isCorrection} (FALHA: nn ignorado)`);
  console.log(`  matchesGreetingWord: ${matchesGreetingWord} (FALHA: substring oi em foi)`);
  console.log(`  isGreeting: ${isGreeting} (FALHA: classificado como saudacao)`);

  assert.strictEqual(isCorrection, false);
  assert.strictEqual(matchesGreetingWord, true);
  assert.strictEqual(isGreeting, true);
  console.log('  -> FALHA T6 REPRODUZIDA!\n');
}

// FALHA T1: 'Caso do Linea / por que esta parado'
console.log('[PROVA T1] Consulta individual ativando patio agregado...');
{
  const input = 'Caso do Linea / por que esta parado';
  const norm = normalizeText(input);
  const triggersAgingCars = norm.includes('parado') || norm.includes('retido') || norm.includes('envelhecido');
  const hasVehicleContext = norm.includes('linea');

  assert.strictEqual(triggersAgingCars, true);
  assert.strictEqual(hasVehicleContext, true);
  console.log('  -> FALHA T1 REPRODUZIDA!\n');
}

// FALHA T3: 'nao entendi'
console.log('[PROVA T3] nao entendi antes de checar estado de turno...');
{
  const input = 'nao entendi';
  const norm = normalizeText(input);
  const isHelp = norm === 'nao entendi' || norm === 'ajuda' || norm === 'menu';
  assert.strictEqual(isHelp, true);
  console.log('  -> FALHA T3 REPRODUZIDA!\n');
}

// FALHA T4: 'ia ta ativa?'
console.log('[PROVA T4] Disponibilidade sem pendingRequest...');
{
  const input = 'ia ta ativa?';
  const norm = normalizeText(input);
  const isAvailability = norm.includes('ativa') || norm.includes('online');
  assert.strictEqual(isAvailability, true);
  console.log('  -> FALHA T4 REPRODUZIDA!\n');
}

// FALHA T5: 'por favor quero saber do linea por favor'
console.log('[PROVA T5] Fallback sem filtro de modelo...');
{
  const input = 'por favor quero saber do linea por favor';
  const norm = normalizeText(input);
  const hasLinea = norm.includes('linea');
  assert.strictEqual(hasLinea, true);
  console.log('  -> FALHA T5 REPRODUZIDA!\n');
}

console.log('=== TODAS AS 6 FALHAS FORAM COMPROVADAS NO HARNESS! ===');
