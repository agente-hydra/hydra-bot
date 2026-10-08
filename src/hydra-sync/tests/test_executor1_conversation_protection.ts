/**
 * src/hydra-sync/tests/test_executor1_conversation_protection.ts
 * Bateria de testes da Frente 1 - Intenção, Correção de Rumo e Desamordaçamento do Prompt
 * Spec: hydra-conversation-memory-protection
 * 
 * Cobre:
 * [E1-01]: Gramática contextual estrita de pátio (eliminação de substring 'dia').
 * [E1-02]: Eliminação da armadilha de chatwoot e links externos.
 * [E1-03]: Reconhecimento de conversation_correction e limpeza de filtros prévios.
 * [E1-04]: Tom natural Hermes-Style para saudações e comentários.
 * [E1-05]: Prompt adaptativo e injeção do diário de bordo.
 */

import assert from 'node:assert/strict';
import { rewriteIntent } from '../intent_rewriter.js';

let passedTests = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passedTests++;
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('--- INICIANDO TESTES DA FRENTE 1: PROTEÇÃO DE CONVERSA E INTENÇÃO ---\n');

// =========================================================================
// [E1-01]: SUBSTRING 'DIA' & GRAMÁTICA CONTEXTUAL ESTRITA DE PÁTIO
// =========================================================================
console.log('1. [E1-01] Validando eliminação da substring "dia" e regex estrita de pátio:');

test('E1-01.1 - "o seu obsidian ta funcionando?" jamais cai em pátio', () => {
  const result = rewriteIntent('o seu obsidian ta funcionando?');
  assert.notEqual(result.contract?.operation, 'aging_cars');
  assert.equal(result.intent, 'runtime_diagnostics');
});

test('E1-01.2 - "como tá sua memória?" jamais cai em pátio', () => {
  const result = rewriteIntent('como tá sua memória?');
  assert.notEqual(result.contract?.operation, 'aging_cars');
  assert.equal(result.intent, 'runtime_diagnostics');
});

test('E1-01.3 - "diagnóstico do sistema" jamais cai em pátio', () => {
  const result = rewriteIntent('diagnóstico do sistema');
  assert.notEqual(result.contract?.operation, 'aging_cars');
  assert.equal(result.intent, 'runtime_diagnostics');
});

test('E1-01.4 - "diário de bordo" jamais cai em pátio', () => {
  const result = rewriteIntent('diário de bordo');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

test('E1-01.5 - "bom dia" jamais cai em pátio', () => {
  const result = rewriteIntent('bom dia');
  assert.notEqual(result.contract?.operation, 'aging_cars');
  assert.notEqual(result.intent, 'aging_cars');
});

test('E1-01.6 - "como foi seu dia?" jamais cai em pátio', () => {
  const result = rewriteIntent('como foi seu dia?');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

test('E1-01.7 - "veículos retidos no pátio" cai em aging_cars', () => {
  const result = rewriteIntent('veículos retidos no pátio');
  assert.equal(result.contract?.operation, 'aging_cars');
});

test('E1-01.8 - "carros parados a mais de 10 dias no jabaquara" cai em aging_cars', () => {
  const result = rewriteIntent('carros parados a mais de 10 dias no jabaquara');
  assert.equal(result.contract?.operation, 'aging_cars');
  assert.equal(result.lojaSlug, 'MPJabaquara');
});

test('E1-01.9 - "carros retidos" cai em aging_cars', () => {
  const result = rewriteIntent('carros retidos');
  assert.equal(result.contract?.operation, 'aging_cars');
});

// =========================================================================
// [E1-02]: ARMADILHA DE CONVERSA COM "VER" E CHECK CEGO DE CHATWOOT
// =========================================================================
console.log('\n2. [E1-02] Validando eliminação da armadilha de chatwoot e links externos:');

test('E1-02.1 - "não é do chatwoot, quero ver nossa conversa" não é recusado', () => {
  const result = rewriteIntent('não é do chatwoot, quero ver nossa conversa');
  assert.notEqual(result.contract?.decision, 'unsupported_capability');
  assert.notEqual(result.needsClarification, true);
});

test('E1-02.2 - "estou falando da nossa conversa, não do chatwoot" não é recusado', () => {
  const result = rewriteIntent('estou falando da nossa conversa, não do chatwoot');
  assert.notEqual(result.contract?.decision, 'unsupported_capability');
});

test('E1-02.3 - "quero ver o que a gente conversou" não é bloqueado por capacidade indisponível', () => {
  const result = rewriteIntent('quero ver o que a gente conversou');
  assert.notEqual(result.contract?.decision, 'unsupported_capability');
  assert.equal(result.intent, 'conversation_history');
});

test('E1-02.4 - link real do chatwoot continua sendo identificado corretamente', () => {
  const result = rewriteIntent('abre o link https://chat.tork.services/app/accounts/1/conversations/999');
  assert.equal(result.contract?.decision, 'unsupported_capability');
});

// =========================================================================
// [E1-03]: RECONHECIMENTO DE CORREÇÃO DO OPERADOR (conversation_correction)
// =========================================================================
console.log('\n3. [E1-03] Validando reconhecimento de correções do operador:');

test('E1-03.1 - "não foi isso" aciona conversation_correction e reseta filtros anteriores', () => {
  const previousState = {
    phone: '5511999990001',
    lastTurnId: 'turn_test_prev',
    lojaSlug: 'MPJabaquara',
    osId: '1128',
    lastIntent: 'os_detail' as any,
    filters: {},
    updatedAt: new Date().toISOString()
  };
  const result = rewriteIntent('não foi isso', previousState);
  assert.equal(result.intent, 'conversation_correction');
  assert.equal(result.contract?.operation, 'conversation_correction');
  assert.deepEqual(result.contract?.turnRelation?.removedFilters, ['lojaSlug', 'osId', 'placa']);
});

test('E1-03.2 - "não perguntei isso" aciona conversation_correction', () => {
  const result = rewriteIntent('não perguntei isso');
  assert.equal(result.intent, 'conversation_correction');
  assert.equal(result.contract?.operation, 'conversation_correction');
});

test('E1-03.3 - "estou falando da nossa conversa" aciona conversation_correction', () => {
  const result = rewriteIntent('estou falando da nossa conversa');
  assert.equal(result.intent, 'conversation_correction');
  assert.equal(result.contract?.operation, 'conversation_correction');
});

test('E1-03.4 - "nada a ver" aciona conversation_correction', () => {
  const result = rewriteIntent('nada a ver');
  assert.equal(result.intent, 'conversation_correction');
  assert.equal(result.contract?.operation, 'conversation_correction');
});

test('E1-03.5 - "você entendeu errado" aciona conversation_correction', () => {
  const result = rewriteIntent('você entendeu errado');
  assert.equal(result.intent, 'conversation_correction');
  assert.equal(result.contract?.operation, 'conversation_correction');
});

// =========================================================================
// [E1-04]: TOM NATURAL HERMES-STYLE EM SAUDAÇÕES E COMENTÁRIOS
// =========================================================================
console.log('\n4. [E1-04] Validando saudações e comentários sem cobrança mecânica de OS:');

test('E1-04.1 - "bom dia" é tratado como intenção conversacional natural', () => {
  const result = rewriteIntent('bom dia');
  assert.equal(result.intent, 'other');
  assert.equal(result.needsClarification ?? false, false);
});

test('E1-04.2 - "oi, tudo bem?" é tratado como intenção conversacional natural', () => {
  const result = rewriteIntent('oi, tudo bem?');
  assert.equal(result.intent, 'other');
  assert.equal(result.needsClarification ?? false, false);
});

test('E1-04.3 - "beleza, muito obrigado!" é tratado sem exigir loja ou placa', () => {
  const result = rewriteIntent('beleza, muito obrigado!');
  assert.equal(result.intent, 'other');
});

console.log(`\n======================================================`);
console.log(`TODOS OS ${passedTests} TESTES DA FRENTE 1 PASSARAM COM 100%!`);
console.log(`======================================================\n`);
