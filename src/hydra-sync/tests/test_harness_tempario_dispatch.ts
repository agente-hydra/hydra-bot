/**
 * src/hydra-sync/tests/test_harness_tempario_dispatch.ts
 * Validação de Linguagem Natural End-to-End via dispatchMessage (Spec 062).
 *
 * Testa o pipeline completo:
 * 1. Frase real de Davi: "Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?"
 * 2. Resolução de Veículo por Placa real: "FOE6I25 quanto tempo e valor de mão de obra pra trocar farol e radiador?"
 * 3. Associativa de Onix 1.0 Turbo: "quanto tempo pra trocar correia banhada a oleo e bomba d'agua do onix 1.0 turbo?"
 *
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import Database from 'better-sqlite3';
import {
  ensureTemparioTables,
  seedCanonicalTemparioCatalog
} from '../tempario_graph_repository.js';
import { ensureOrdensServicoTable } from '../operational_data_repository.js';
import { dispatchMessage } from '../agent_dispatcher.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runDispatchTestSuite(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('HYDRA — BATERIA DE DISPATCH EM LINGUAGEM NATURAL END-TO-END (SPEC 062)');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const db = new Database(':memory:');
  ensureTemparioTables(db);
  seedCanonicalTemparioCatalog(db);
  ensureOrdensServicoTable(db);

  // Inicializa tabelas auxiliares necessárias para o despachante
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_used TEXT,
      tool_params TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_interaction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      conversation_id INTEGER,
      message_id INTEGER,
      pergunta TEXT,
      tools_chamadas TEXT,
      resposta_gerada TEXT,
      latencia_ms INTEGER,
      motor_utilizado TEXT,
      erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hydra_turn_contexts (
      phone TEXT PRIMARY KEY,
      last_turn_id TEXT,
      last_intent TEXT,
      loja_slug TEXT,
      placa TEXT,
      os_id TEXT,
      filters_json TEXT,
      last_message_id INTEGER,
      last_response_text TEXT,
      updated_at DATETIME,
      active_cursor TEXT,
      pending_request_json TEXT,
      agy_conversation_id TEXT
    );

    CREATE TABLE IF NOT EXISTS hydra_user_profiles (
      phone TEXT PRIMARY KEY,
      persona TEXT NOT NULL,
      loja_slug TEXT,
      loja_nome TEXT,
      memory_generation INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Configura perfil de sócio para o telefone de Davi (5511996242812)
  db.prepare(`
    INSERT INTO hydra_user_profiles (phone, persona, loja_slug, loja_nome)
    VALUES ('5511996242812', 'socio', NULL, 'Rede')
  `).run();

  // Insere OS #672 com a placa FOE6I25 (Golf 1.4 TSI da loja MPdompedro1)
  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, is_aberta, status_grid, veiculo, placa, total_os, valor_restante
    ) VALUES (
      '672', 'MPdompedro1', 1, 'Em Aberto', 'Golf 1.4 TSI', 'FOE6I25', 800.0, 800.0
    )
  `).run();

  // Popula 20 OSs de histórico da rede para ter dados de pátio
  const insertYard = db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, is_aberta, status_grid, data_inicio_iso, data_fim_iso, dias_no_patio, veiculo, raw_payload
    ) VALUES (?, ?, 0, 'FINALIZADA', ?, ?, ?, ?, ?)
  `);

  for (let i = 1; i <= 20; i++) {
    const store = i % 2 === 0 ? 'maua' : 'jabaquara';
    const hours = 3.2;
    const startIso = '2026-10-15T08:00:00.000Z';
    const endIso = new Date(new Date(startIso).getTime() + hours * 3600 * 1000).toISOString();
    const payload = JSON.stringify({ servicos: [{ descricao: 'Substituição do Farol' }] });
    insertYard.run(`yard_os_${i}`, store, startIso, endIso, 2, 'Golf 1.4 TSI', payload);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 1: Frase Real de Davi (Golf 1.4 TSI farol + radiador)
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('[TEST 1] Executando dispatchMessage com a frase exata de Davi...');
    const t0 = Date.now();
    const res = await dispatchMessage({
      phone: '5511996242812',
      message: 'Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?',
      db,
      skipIdempotencyCheck: true
    });
    const dur = Date.now() - t0;
    console.log(`[TEST 1] Duração: ${dur}ms | Motor: ${res.motor}`);
    console.log('[TEST 1] Resposta gerada:\n' + res.replyText + '\n');

    assert(dur < 200, `Latência deve ser < 200ms no Fast-Path, obtido ${dur}ms`);
    assert(res.replyText.includes('3,05') || res.replyText.includes('3.05'), 'Deve conter tempo líquido de 3,05h');
    assert(res.replyText.includes('823,50'), 'Deve conter mão de obra de R$ 823,50');
    assert(res.replyText.includes('270,00'), 'Deve explicitar a taxa da rede de R$ 270,00/h');
    assert(res.replyText.includes('Farol') && res.replyText.includes('Radiador'), 'Deve conter Farol e Radiador');
    assert(res.replyText.includes('Peças necessárias'), 'Deve oferecer menu de peças no Progressive Disclosure');
    assert(res.replyText.includes('Ferramentas de bancada'), 'Deve oferecer menu de ferramentas');
    console.log('✅ [PASS] TESTE 1: Resumo executivo aprovado com sucesso!');

    // TESTE 1.1: Multi-Turno — Escolha "2" (Ferramentas)
    console.log('\n[TEST 1.1] Enviando réplica "2" (Ferramentas de bancada)...');
    const tFerramentas = Date.now();
    const resFerramentas = await dispatchMessage({
      phone: '5511996242812',
      message: '2',
      db,
      skipIdempotencyCheck: true
    });
    const durFerramentas = Date.now() - tFerramentas;
    console.log(`[TEST 1.1] Duração: ${durFerramentas}ms | Motor: ${resFerramentas.motor}`);
    console.log('[TEST 1.1] Resposta gerada:\n' + resFerramentas.replyText + '\n');
    assert(resFerramentas.replyText.includes('Torx'), 'Deve conter ferramentas de bancada (Torx)');
    console.log('✅ [PASS] TESTE 1.1: Interceptor "2" (Ferramentas) aprovado com sucesso!');

    // TESTE 1.2: Multi-Turno — Escolha "1" (Peças)
    console.log('\n[TEST 1.2] Enviando réplica "peças"...');
    const resPecas = await dispatchMessage({
      phone: '5511996242812',
      message: 'peças',
      db,
      skipIdempotencyCheck: true
    });
    console.log('[TEST 1.2] Resposta gerada:\n' + resPecas.replyText + '\n');
    assert(resPecas.replyText.includes('G12') || resPecas.replyText.includes('G13') || resPecas.replyText.includes('Radiador'), 'Deve conter peças de arrefecimento');
    console.log('✅ [PASS] TESTE 1.2: Interceptor "peças" aprovado com sucesso!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 2: Resolução de Veículo por Placa Real (FOE6I25 -> Golf 1.4 TSI)
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('\n[TEST 2] Executando dispatchMessage usando apenas a placa real FOE6I25...');
    const t0 = Date.now();
    const res = await dispatchMessage({
      phone: '5511996242812',
      message: 'FOE6I25 quanto tempo e valor de mão de obra pra trocar farol e radiador?',
      db,
      skipIdempotencyCheck: true
    });
    const dur = Date.now() - t0;
    console.log(`[TEST 2] Duração: ${dur}ms | Motor: ${res.motor}`);

    assert(dur < 200, `Latência deve ser < 200ms, obtido ${dur}ms`);
    assert(res.replyText.includes('3,05') || res.replyText.includes('3.05'), 'Deve resolver o Golf e conter 3,05h');
    assert(res.replyText.includes('823,50'), 'Deve conter mão de obra de R$ 823,50');
    assert(res.replyText.includes('Farol') && res.replyText.includes('Radiador'), 'Deve conter as peças de farol e radiador');
    console.log('✅ [PASS] TESTE 2: Resolução por Placa FOE6I25 aprovada com sucesso!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 3: Associativa de Onix 1.0 Turbo (Correia Banhada + Bomba d'Água)
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('\n[TEST 3] Executando dispatchMessage para Onix 1.0 Turbo (Correia + Bomba)...');
    const t0 = Date.now();
    const res = await dispatchMessage({
      phone: '5511996242812',
      message: "quanto tempo pra trocar correia banhada a oleo e bomba d'agua do onix 1.0 turbo?",
      db,
      skipIdempotencyCheck: true
    });
    const dur = Date.now() - t0;
    console.log(`[TEST 3] Duração: ${dur}ms | Motor: ${res.motor}`);
    console.log('[TEST 3] Resposta gerada:\n' + res.replyText + '\n');

    assert(dur < 200, `Latência deve ser < 200ms, obtido ${dur}ms`);
    assert(res.replyText.includes('5,10') || res.replyText.includes('5.10'), 'Deve conter tempo líquido de 5,10h');
    assert(res.replyText.includes('1377,00') || res.replyText.includes('1.377,00'), 'Deve conter valor de mão de obra de R$ 1377,00');
    assert(res.replyText.includes('Peças necessárias'), 'Deve conter menu de detalhamento');

    console.log('[TEST 3.1] Enviando réplica "ferramentas" para o Onix...');
    const resOnixTools = await dispatchMessage({
      phone: '5511996242812',
      message: 'ferramentas',
      db,
      skipIdempotencyCheck: true
    });
    console.log('[TEST 3.1] Resposta gerada:\n' + resOnixTools.replyText + '\n');
    assert(resOnixTools.replyText.includes('Raven 131003'), 'Deve listar ferramenta de fasagem Raven 131003');
    console.log('✅ [PASS] TESTE 3: Onix 1.0 Turbo Correia + Bomba e detalhamento aprovados com sucesso!');
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('TODOS OS TESTES DE DISPATCH EM LINGUAGEM NATURAL PASSARAM COM SUCESSO!');
  console.log('══════════════════════════════════════════════════════════════════════');
}

runDispatchTestSuite().catch((err: Error) => {
  console.error('\n❌ ERRO NO TEST HARNESS:', err.message);
  console.error(err.stack);
  process.exit(1);
});
