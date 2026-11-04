/**
 * src/hydra-sync/tests/test_harness_spec069_dispatcher_e2e.ts
 * Suite de Integração E2E do Dispatcher — Spec 069: Correção de ReferenceError e Escopo de Variáveis
 */

import Database from 'better-sqlite3';
import { dispatchMessage } from '../agent_dispatcher.js';
import { getDatabaseConnection } from '../db_repository.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FALHA ASSERT]: ${message}`);
  }
}

async function runSuite(): Promise<void> {
  console.log('=== INICIANDO TEST HARNESS SPEC 069 (DISPATCHER E2E & RESILIÊNCIA DE ESCOPO) ===\n');

  const testPhone = '5511996242812';
  const db = getDatabaseConnection();

  // Limpeza de ambiente de teste para garantir idoneidade das asserções
  try {
    db.prepare('DELETE FROM placa_lookup_cache WHERE placa_limpa = ?').run('EUS5006');
    db.prepare('DELETE FROM hydra_turn_contexts WHERE phone = ?').run(testPhone);
  } catch (err: any) {
    console.warn('[SETUP] Aviso ao limpar registros de teste:', err?.message || err);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 1: Consulta Real de Davi ("troca de laampadas traseiras tracker 2023")
  // ───────────────────────────────────────────────────────────────────────────
  console.log('[Cenário 1] Testando dispatchMessage para "troca de laampadas traseiras tracker 2023"...');
  const res1 = await dispatchMessage({
    phone: testPhone,
    message: 'troca de laampadas traseiras tracker 2023'
  });

  console.log('  Qtd de balões retornados:', res1.messages.length);
  const msg1 = res1.messages[0] || '';
  console.log('--- Balão 1 Retornado ---');
  console.log(msg1);

  assert(!msg1.includes('Não consegui consultar os dados agora'), 'NUNCA deve retornar erro de oscilação de banco');
  assert(msg1.includes('HYDRA | Tempário Técnico & Mão de Obra'), 'Deve conter cabeçalho oficial do tempário');
  assert(msg1.includes('0,40h (24 min)'), 'Deve conter tempo líquido de 0,40h (24 min)');
  assert(msg1.includes('R$ 108,00'), 'Deve conter valor total de R$ 108,00');
  assert(msg1.includes('1️⃣ *Peças necessárias*'), 'Deve conter Progressive Disclosure opção 1');
  assert(msg1.includes('4️⃣ *Tudo completo*'), 'Deve conter Progressive Disclosure opção 4');

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 2: Placa sem histórico no ERP e sem saldo APIBrasil ("EUS5006 \n\ntroca de motor de partida")
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Cenário 2] Testando placa desconhecida sem cadastro prévio...');
  const res2 = await dispatchMessage({
    phone: testPhone,
    message: 'EUS5006 \n\ntroca de motor de partida'
  });

  const allMsg2 = res2.messages.join('\n\n');
  console.log('--- Balão Estimativa de Referência Completo ---');
  console.log(allMsg2);

  assert(!allMsg2.includes('Não consegui consultar os dados agora'), 'NUNCA deve retornar erro de oscilação de banco');
  assert(allMsg2.includes('Estimativa de Referência'), 'Deve retornar estimativa de referência imediata');
  assert(allMsg2.includes('R$ 297,00'), 'Deve conter total de mão de obra de R$ 297,00 (1,10h)');
  assert(allMsg2.includes('1️⃣ *Peças necessárias*'), 'Deve manter opções 1 a 4 ativas');

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 3: Turno 2 com Modelo/Ano ("Palio 1.0 2012") — Testando activeProfile sem TDZ
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Cenário 3] Testando follow-up conversacional "Palio 1.0 2012" (validação de escopo activeProfile)...');
  const res3 = await dispatchMessage({
    phone: testPhone,
    message: 'Palio 1.0 2012'
  });

  const msg3 = res3.messages[0] || '';
  console.log('--- Balão Refinado Turno 2 ---');
  console.log(msg3);

  assert(!msg3.includes('Não consegui consultar os dados agora'), 'NUNCA deve retornar erro de oscilação de banco');
  assert(msg3.includes('Fiat Palio (2012)'), 'Deve calibrar para Fiat Palio 2012');
  assert(msg3.includes('EUS5006'), 'Deve manter vínculo com placa EUS5006');
  assert(msg3.includes('R$ 297,00'), 'Deve manter cálculo exato da mão de obra');

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 4: Progressive Disclosure — Seleção de Opção 3 (Passo a Passo)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Cenário 4] Testando seleção de Opção 3 ("3")...');
  const res4 = await dispatchMessage({
    phone: testPhone,
    message: '3'
  });

  const allMsg4 = res4.messages.join('\n\n');
  console.log('--- Balão Sequência Técnica (Qtd msgs:', res4.messages.length, ') ---');
  console.log(allMsg4);

  assert(!allMsg4.includes('Não consegui consultar os dados agora'), 'NUNCA deve retornar erro de oscilação de banco');
  assert(allMsg4.includes('HYDRA | Sequência Técnica de Execução'), 'Deve entregar a sequência de execução');
  assert(allMsg4.includes('Passo a Passo') || allMsg4.includes('Execução') || allMsg4.includes('Desmontagem'), 'Deve conter passos da sequência');

  console.log('\n✅ TODOS OS TESTES DE INTEGRAÇÃO DA SPEC 069 PASSARAM COM 100% DE SUCESSO!');
}

runSuite().catch(err => {
  console.error('\n❌ ERRO NA EXECUÇÃO DO TEST HARNESS SPEC 069:', err);
  process.exit(1);
});
