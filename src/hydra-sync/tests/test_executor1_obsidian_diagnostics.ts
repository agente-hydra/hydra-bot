/**
 * src/hydra-sync/tests/test_executor1_obsidian_diagnostics.ts
 * Bateria de testes do Executor 1: Interpretação, Diagnóstico de Runtime e Prompt Seguro.
 * 
 * Cobre:
 * 1. Bug M01: "o seu obsidian ta funcionando? como tá sua memória?" aciona runtime_diagnostics e NUNCA cai em pátio/aging cars.
 * 2. Bug M02: Palavras com substring 'dia' (diagnóstico, diário, bom dia, dia a dia) não caem em pátio/aging cars.
 * 3. Gramática contextual estrita para pátio (aging cars exige termos inequívocos de retenção/pátio).
 * 4. Rota de intenção INTENT_CONVERSATION_HISTORY (primeira pergunta, turnos anteriores).
 * 5. Rota de intenção INTENT_MEMORY_PREFERENCE (preferências explícitas do operador).
 * 6. Inspeção factual de runtime_diagnostics (vault no disco, contagem de notas, SQLite, formatação de balão WhatsApp).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { rewriteIntent } from '../intent_rewriter.js';
import {
  buildRuntimeDiagnostics,
  formatRuntimeDiagnosticsBalloon,
  getSaoPauloIsoTimestamp
} from '../runtime_diagnostics.js';

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

console.log('--- INICIANDO TESTES DO EXECUTOR 1: OBSIDIAN DIAGNOSTICS & INTENT ROUTING ---\n');

// =========================================================================
// 1. CENÁRIOS M01: PERGUNTAS SOBRE OBSIDIAN / MEMÓRIA / RUNTIME
// =========================================================================
console.log('1. Validando M01 - Consultas de Obsidian, Memória e Runtime:');

test('M01.1 - "o seu obsidian ta funcionando?" aciona runtime_diagnostics e não pátio', () => {
  const result = rewriteIntent('o seu obsidian ta funcionando?');
  assert.equal(result.intent, 'runtime_diagnostics');
  assert.equal(result.contract?.operation, 'runtime_diagnostics');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

test('M01.2 - "como tá sua memória?" aciona runtime_diagnostics e não pátio', () => {
  const result = rewriteIntent('como tá sua memória?');
  assert.equal(result.intent, 'runtime_diagnostics');
  assert.equal(result.contract?.operation, 'runtime_diagnostics');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

test('M01.3 - "qual status do bot?" aciona runtime_diagnostics', () => {
  const result = rewriteIntent('qual status do bot?');
  assert.equal(result.intent, 'runtime_diagnostics');
  assert.equal(result.contract?.operation, 'runtime_diagnostics');
});

test('M01.4 - "como está o vault?" aciona runtime_diagnostics', () => {
  const result = rewriteIntent('como está o vault?');
  assert.equal(result.intent, 'runtime_diagnostics');
  assert.equal(result.contract?.operation, 'runtime_diagnostics');
});

test('M01.5 - "o que você tem na memória?" aciona runtime_diagnostics', () => {
  const result = rewriteIntent('o que você tem na memória?');
  assert.equal(result.intent, 'runtime_diagnostics');
  assert.equal(result.contract?.operation, 'runtime_diagnostics');
});

test('M01.6 - "diagnóstico de runtime" aciona runtime_diagnostics', () => {
  const result = rewriteIntent('diagnóstico de runtime');
  assert.equal(result.intent, 'runtime_diagnostics');
  assert.equal(result.contract?.operation, 'runtime_diagnostics');
});

// =========================================================================
// 2. CENÁRIOS M02: SUBSTRING 'DIA' SEM FALSO POSITIVO DE PÁTIO
// =========================================================================
console.log('\n2. Validando M02 - Substring "dia" sem desvio espúrio para pátio:');

test('M02.1 - "diagnóstico do sistema" aciona runtime_diagnostics e NÃO pátio', () => {
  const result = rewriteIntent('diagnóstico do sistema');
  assert.notEqual(result.contract?.operation, 'aging_cars');
  assert.equal(result.intent, 'runtime_diagnostics');
});

test('M02.2 - "bom dia" não aciona pátio', () => {
  const result = rewriteIntent('bom dia');
  assert.notEqual(result.contract?.operation, 'aging_cars');
  assert.notEqual(result.intent, 'aging_cars');
});

test('M02.3 - "como foi seu dia?" não aciona pátio', () => {
  const result = rewriteIntent('como foi seu dia?');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

test('M02.4 - "diário de bordo" não aciona pátio', () => {
  const result = rewriteIntent('diário de bordo');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

test('M02.5 - "bom dia, como tá o Jabaquara?" aciona store_overview e NÃO pátio', () => {
  const result = rewriteIntent('bom dia, como tá o Jabaquara?');
  assert.equal(result.lojaSlug, 'MPJabaquara');
  assert.equal(result.intent, 'store_overview');
  assert.notEqual(result.contract?.operation, 'aging_cars');
});

// =========================================================================
// 3. GRAMÁTICA CONTEXTUAL ESTRITA PARA PÁTIO / AGING CARS
// =========================================================================
console.log('\n3. Validando Gramática Contextual Estrita para Pátio / Aging Cars:');

test('3.1 - "carros parados a mais de 10 dias no jabaquara" cai em aging_cars', () => {
  const result = rewriteIntent('carros parados a mais de 10 dias no jabaquara');
  assert.equal(result.contract?.operation, 'aging_cars');
  assert.equal(result.lojaSlug, 'MPJabaquara');
});

test('3.2 - "veículos retidos no pátio" cai em aging_cars', () => {
  const result = rewriteIntent('veículos retidos no pátio');
  assert.equal(result.contract?.operation, 'aging_cars');
});

test('3.3 - "carros travados há mais de 15 dias" cai em aging_cars', () => {
  const result = rewriteIntent('carros travados há mais de 15 dias');
  assert.equal(result.contract?.operation, 'aging_cars');
});

test('3.4 - "veículos retidos" cai em aging_cars', () => {
  const result = rewriteIntent('veículos retidos');
  assert.equal(result.contract?.operation, 'aging_cars');
});

// =========================================================================
// 4. ROTA INTENT_CONVERSATION_HISTORY
// =========================================================================
console.log('\n4. Validando Rota INTENT_CONVERSATION_HISTORY:');

test('4.1 - "qual foi a primeira pergunta?" aciona conversation_history com flag isFirstQuestionQuery', () => {
  const result = rewriteIntent('qual foi a primeira pergunta?');
  assert.equal(result.intent, 'conversation_history');
  assert.equal(result.contract?.operation, 'conversation_history');
  assert.equal(result.contract?.filters?.isFirstQuestionQuery, true);
});

test('4.2 - "o que eu perguntei antes?" aciona conversation_history', () => {
  const result = rewriteIntent('o que eu perguntei antes?');
  assert.equal(result.intent, 'conversation_history');
  assert.equal(result.contract?.operation, 'conversation_history');
});

test('4.3 - "quantas perguntas eu fiz hoje?" aciona conversation_history', () => {
  const result = rewriteIntent('quantas perguntas eu fiz hoje?');
  assert.equal(result.intent, 'conversation_history');
  assert.equal(result.contract?.operation, 'conversation_history');
});

test('4.4 - "histórico da conversa" aciona conversation_history', () => {
  const result = rewriteIntent('histórico da conversa');
  assert.equal(result.intent, 'conversation_history');
  assert.equal(result.contract?.operation, 'conversation_history');
});

// =========================================================================
// 5. ROTA INTENT_MEMORY_PREFERENCE
// =========================================================================
console.log('\n5. Validando Rota INTENT_MEMORY_PREFERENCE:');

test('5.1 - "prefiro faturamento antes de OS" aciona memory_preference', () => {
  const result = rewriteIntent('prefiro faturamento antes de OS');
  assert.equal(result.intent, 'memory_preference');
  assert.equal(result.contract?.operation, 'memory_preference');
  assert.equal(result.contract?.filters?.preferenceText, 'prefiro faturamento antes de OS');
});

test('5.2 - "lembre-se que prefiro CMV em percentual" aciona memory_preference', () => {
  const result = rewriteIntent('lembre-se que prefiro CMV em percentual');
  assert.equal(result.intent, 'memory_preference');
  assert.equal(result.contract?.operation, 'memory_preference');
});

test('5.3 - "minha preferência é ver saldo antes da lista" aciona memory_preference', () => {
  const result = rewriteIntent('minha preferência é ver saldo antes da lista');
  assert.equal(result.intent, 'memory_preference');
  assert.equal(result.contract?.operation, 'memory_preference');
});

// =========================================================================
// 6. INSPEÇÃO FACTUAL E FORMATAÇÃO DE BALÃO WHATSAPP
// =========================================================================
console.log('\n6. Validando buildRuntimeDiagnostics e formatRuntimeDiagnosticsBalloon:');

test('6.1 - buildRuntimeDiagnostics inspeciona vault físico e SQLite', () => {
  // Cria diretório temporário para simular o Vault
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-test-vault-'));
  const userVaultDir = path.join(tempDir, 'usuarios', '5511999990001');
  fs.mkdirSync(userVaultDir, { recursive: true });

  // Nota ativa
  fs.writeFileSync(
    path.join(userVaultDir, 'pref_01.md'),
    `---
id: mem_01
status: active
---
Prefere CMV antes de faturamento.`
  );

  // Nota superseded
  fs.writeFileSync(
    path.join(userVaultDir, 'pref_02.md'),
    `---
id: mem_02
status: superseded
---
Regra antiga substituída.`
  );

  // Cria banco SQLite in-memory simulando schema do Hydra
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE hydra_user_profiles (
      phone TEXT PRIMARY KEY,
      memory_generation INTEGER DEFAULT 1
    );
    INSERT INTO hydra_user_profiles (phone, memory_generation) VALUES ('5511999990001', 2);

    CREATE TABLE hydra_memories (
      memory_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      generation_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO hydra_memories (memory_id, phone, generation_id, status) VALUES
      ('m1', '5511999990001', 2, 'active'),
      ('m2', '5511999990001', 2, 'active'),
      ('m3', '5511999990001', 2, 'active');
  `);

  const payload = buildRuntimeDiagnostics(db, '5511999990001', 'socio', 'MPJabaquara', {
    vaultPathOverride: tempDir
  });

  assert.equal(payload.vault.isAccessible, true);
  assert.equal(payload.vault.totalUserNotes, 2);
  assert.equal(payload.vault.activeNotesCount, 1);
  assert.equal(payload.vault.memoryGeneration, 2);
  assert.equal(payload.memory.totalActiveMemories, 3);
  assert.equal(payload.memory.retrievalSource, 'vault_direct');
  assert.equal(payload.memory.effectivePersona, 'socio');
  assert.equal(payload.memory.activeLojaSlug, 'MPJabaquara');
  assert.match(payload.serverTime, /T\d{2}:\d{2}:\d{2}-03:00/);

  // Limpeza
  fs.rmSync(tempDir, { recursive: true, force: true });
  db.close();
});

test('6.2 - formatRuntimeDiagnosticsBalloon gera formatação estrita para WhatsApp', () => {
  const dummyPayload = {
    vault: {
      isVaultConfigured: true,
      vaultPath: '/home/operacional/hydra-data/vault/usuarios/5511999990001',
      isAccessible: true,
      totalUserNotes: 5,
      activeNotesCount: 4,
      memoryGeneration: 2,
      indexVersion: 1,
      pendingOperationsCount: 0,
      lastSyncAt: '2026-10-02T10:55:00-03:00',
      lastError: null
    },
    memory: {
      totalActiveMemories: 4,
      effectivePersona: 'socio' as const,
      activeLojaSlug: 'MPJabaquara',
      memoryGeneration: 2,
      retrievalSource: 'vault_direct' as const
    },
    tools: {
      mcpAvailable: true,
      serverStatus: 'connected' as const,
      registeredTools: ['get_daily_revenue', 'runtime_diagnostics']
    },
    serverTime: '2026-10-02T11:00:00-03:00'
  };

  const balloon = formatRuntimeDiagnosticsBalloon(dummyPayload);

  // Validações de conteúdo
  assert.ok(balloon.includes('Diagnóstico de Runtime & Memória Hydra'));
  assert.ok(balloon.includes('Obsidian Vault (Armazenamento Factual)'));
  assert.ok(balloon.includes('Geração 2'));
  assert.ok(balloon.includes('Sócio'));
  assert.ok(balloon.includes('MPJabaquara'));

  // Validações de formatação WhatsApp Native
  assert.ok(balloon.includes('> *')); // Blockquotes nativos
  assert.ok(balloon.includes('- *')); // Lista com negrito nativo
  assert.ok(!balloon.includes('**')); // PROIBIDO CommonMark **
  assert.ok(!balloon.startsWith('#')); // PROIBIDO Markdown headers
});

console.log(`\n======================================================`);
console.log(`TODOS OS ${passedTests} TESTES PASSARAM COM 100% DE SUCESSO!`);
console.log(`======================================================\n`);
