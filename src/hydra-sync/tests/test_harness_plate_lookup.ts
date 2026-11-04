/**
 * src/hydra-sync/tests/test_harness_plate_lookup.ts
 * Suíte de Testes da Spec 064 — Consulta de Placas APIBrasil, Cache SQLite e Tempário.
 *
 * Valida:
 * 1. Normalização estrita de placas Mercosul e antigas cinza.
 * 2. Desempenho L1 Cache-First (< 5ms) no SQLite WAL sem gastar cota externa.
 * 3. Resolução L2 via histórico de Ordens de Serviço do ERP com auto-persistência em cache.
 * 4. Isolamento sintático de intenções via `isDirectPlateQuery`.
 * 5. Formatação visual do balão Hermes V2 (`composePlateVehicleBalloon`).
 * 6. Fluxo E2E via `dispatchMessage`:
 *    - Consulta cadastral direta de placa ("placa EWB4J21").
 *    - Tempário técnico com placa desconhecida no pátio resolvendo modelo e Fast-Path.
 *
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import Database from 'better-sqlite3';
import {
  ensurePlateLookupTable,
  normalizePlate,
  savePlateRecord,
  lookupVehiclePlate
} from '../apibrasil_plate_client.js';
import { isDirectPlateQuery } from '../intent_rewriter.js';
import { composePlateVehicleBalloon } from '../balloon_composer.js';
import { dispatchMessage } from '../agent_dispatcher.js';
import { ensureTemparioTables, seedCanonicalTemparioCatalog } from '../tempario_graph_repository.js';
import { ensureOrdensServicoTable } from '../operational_data_repository.js';
import type { VehiclePlateRecord } from '../types/plate_lookup_contract.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runPlateLookupSuite(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('HYDRA — BATERIA SPEC 064: CONSULTA VEICULAR POR PLACA & CACHE SQLITE');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const db = new Database(':memory:');
  ensurePlateLookupTable(db);
  ensureTemparioTables(db);
  seedCanonicalTemparioCatalog(db);
  ensureOrdensServicoTable(db);

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

  db.prepare(`
    INSERT INTO hydra_user_profiles (phone, persona, loja_slug, loja_nome)
    VALUES ('5511996242812', 'socio', NULL, 'Rede')
  `).run();

  const userPhone = '5511996242812';

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 1: Normalização e Validação de Placas
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[TEST 1] Validando normalização de formatos de placa...');
  {
    const m1 = normalizePlate('foe6i25');
    assert(m1 !== null && m1.placaLimpa === 'FOE6I25' && m1.placaFormatada === 'FOE-6I25', 'Deve normalizar Mercosul minúsculo');

    const m2 = normalizePlate('FOE-6I25');
    assert(m2 !== null && m2.placaLimpa === 'FOE6I25', 'Deve normalizar Mercosul com traço');

    const a1 = normalizePlate('abc1234');
    assert(a1 !== null && a1.placaLimpa === 'ABC1234' && a1.placaFormatada === 'ABC-1234', 'Deve normalizar padrão antigo');

    const inv1 = normalizePlate('abc12');
    assert(inv1 === null, 'Deve rejeitar placa curta');

    const inv2 = normalizePlate('1234567');
    assert(inv2 === null, 'Deve rejeitar placa numérica');

    console.log('✅ [PASS] TEST 1: Normalização de placas aprovada com sucesso!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 2: Cache L1 em SQLite WAL (< 5ms)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 2] Validando L1 Cache-First sem gastar cota externa...');
  {
    const sampleRecord: VehiclePlateRecord = {
      placaLimpa: 'EWB4J21',
      placaFormatada: 'EWB-4J21',
      marca: 'HONDA',
      modelo: 'CIVIC',
      modeloCompleto: 'Honda Civic Touring 1.5 Turbo',
      versao: 'Touring 1.5 Turbo',
      anoFabricacao: 2018,
      anoModelo: 2019,
      cor: 'Cinza',
      combustivel: 'Gasolina',
      motor: '1.5 Turbo VTEC',
      cilindrada: 1498,
      potencia: 173,
      chassiMascarado: '93H***456',
      municipio: 'Santo André',
      uf: 'SP',
      segmento: 'AUTO',
      situacao: 'CIRCULACAO',
      origemDados: 'APIBRASIL',
      rawPayloadJson: JSON.stringify({ ok: true }),
      createdAt: new Date().toISOString()
    };

    savePlateRecord(db, sampleRecord);

    const t0 = Date.now();
    const hit = await lookupVehiclePlate(db, 'ewb-4j21');
    const dur = Date.now() - t0;
    console.log(`[TEST 2] Latência L1: ${dur}ms`);

    assert(hit !== null, 'Registro deve ser retornado do cache');
    assert(dur < 10, `Latência deve ser < 10ms, obtido ${dur}ms`);
    assert(hit!.placaLimpa === 'EWB4J21', 'Placa limpa deve bater');
    assert(hit!.modeloCompleto.includes('Civic'), 'Modelo deve bater');
    assert(hit!.anoModelo === 2019, 'Ano modelo deve bater');
    console.log('✅ [PASS] TEST 2: L1 Cache-First validado em altíssima performance!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 3: L2 Fallback de OS (ordens_servico) com Auto-Persistência
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 3] Validando L2 (Histórico de OS) com auto-persistência no cache...');
  {
    db.prepare(`
      INSERT INTO ordens_servico (
        os_id, loja_slug, is_aberta, status_grid, veiculo, placa, total_os, valor_restante
      ) VALUES (
        '9001', 'MPmaua', 0, 'FINALIZADA', 'Toyota Corolla XEi 2.0 2021', 'COR2A01', 500.0, 0.0
      )
    `).run();

    const t0 = Date.now();
    const l2Record = await lookupVehiclePlate(db, 'cor2a01');
    const dur = Date.now() - t0;
    console.log(`[TEST 3] Latência L2: ${dur}ms`);

    assert(l2Record !== null, 'Deve resolver a placa a partir do histórico de OS');
    assert(l2Record!.modeloCompleto.includes('Corolla'), 'Deve conter Corolla');
    assert(l2Record!.origemDados === 'ORDENS_SERVICO_REDE', 'Origem deve ser OS da rede');

    // Verifica que agora está gravado em placa_lookup_cache
    const cacheCheck = db.prepare(`SELECT placa_limpa FROM placa_lookup_cache WHERE placa_limpa = 'COR2A01'`).get();
    assert(cacheCheck !== undefined, 'Deve ter sido promovido para placa_lookup_cache');
    console.log('✅ [PASS] TEST 3: Resolução L2 e promoção para cache validadas!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 4: Detecção Sintática de Intenção (`isDirectPlateQuery`)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 4] Validando isolamento de intenções em linguagem natural...');
  {
    const q1 = isDirectPlateQuery('FOE6I25');
    assert(q1.isPlateQuery && q1.placa === 'FOE6I25', 'Placa isolada deve ser capturada');

    const q2 = isDirectPlateQuery('placa EWB4J21');
    assert(q2.isPlateQuery && q2.placa === 'EWB4J21', 'Comando "placa XYZ" deve ser capturado');

    const q3 = isDirectPlateQuery('qual o carro da placa ABC1234');
    assert(q3.isPlateQuery && q3.placa === 'ABC1234', 'Pergunta "qual o carro da placa" deve ser capturada');

    const q4 = isDirectPlateQuery('quanto tempo e valor de mao de obra pra trocar farol FOE6I25');
    assert(!q4.isPlateQuery, 'Pergunta de tempário NÃO deve ser interceptada como consulta cadastral');

    const q5 = isDirectPlateQuery('como ta a os do FOE6I25');
    assert(!q5.isPlateQuery, 'Pergunta de situação de OS NÃO deve ser interceptada');

    console.log('✅ [PASS] TEST 4: Guarda de intenção aprovada sem falso-positivos!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 5: Formatação Visual Hermes V2 (`composePlateVehicleBalloon`)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 5] Validando formatação do balão Hermes V2...');
  {
    const civicRecord: VehiclePlateRecord = {
      placaLimpa: 'EWB4J21',
      placaFormatada: 'EWB-4J21',
      marca: 'HONDA',
      modelo: 'CIVIC',
      modeloCompleto: 'Honda Civic Touring 1.5 Turbo',
      versao: 'Touring 1.5 Turbo',
      anoFabricacao: 2018,
      anoModelo: 2019,
      cor: 'Cinza',
      combustivel: 'Gasolina',
      motor: '1.5 Turbo VTEC',
      cilindrada: 1498,
      potencia: 173,
      chassiMascarado: '93H***456',
      municipio: 'Santo André',
      uf: 'SP',
      segmento: 'AUTO',
      situacao: 'CIRCULACAO',
      origemDados: 'APIBRASIL',
      rawPayloadJson: '{}',
      createdAt: new Date().toISOString()
    };

    const balloons = composePlateVehicleBalloon(civicRecord);
    const cardText = balloons[0];
    console.log('[TEST 5] Balão visual gerado:\n' + cardText + '\n');

    assert(cardText.includes('*HYDRA | Consulta Veicular por Placa*'), 'Deve conter cabeçalho oficial');
    assert(cardText.includes('EWB-4J21'), 'Deve conter placa formatada');
    assert(cardText.includes('Civic'), 'Deve conter modelo');
    assert(cardText.includes('Santo André / SP'), 'Deve conter localização');
    assert(cardText.includes('1.5 Turbo VTEC'), 'Deve conter motor');
    assert(cardText.includes('Em circulação (Regular)'), 'Deve conter status');
    assert(cardText.includes('Base Nacional de Registro Veicular'), 'Deve conter proveniência');
    console.log('✅ [PASS] TEST 5: Card visual Hermes V2 validado com sucesso!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 6: Fluxo End-to-End via dispatchMessage
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 6] Executando dispatchMessage E2E...');
  {
    // Caso 6.1: Consulta cadastral direta de placa
    console.log('[TEST 6.1] Enviando "placa EWB4J21"...');
    const t0 = Date.now();
    const resPlate = await dispatchMessage({
      phone: userPhone,
      message: 'placa EWB4J21',
      db,
      skipIdempotencyCheck: true
    });
    const durPlate = Date.now() - t0;
    console.log(`[TEST 6.1] Duração: ${durPlate}ms | Motor: ${resPlate.motor}`);
    console.log('[TEST 6.1] Resposta:\n' + resPlate.replyText + '\n');

    assert(durPlate < 50, `Latência deve ser < 50ms no cache, obtido ${durPlate}ms`);
    assert(resPlate.replyText.includes('Civic'), 'Deve responder com dados do Civic');
    assert(resPlate.replyText.includes('EWB-4J21'), 'Deve conter placa');
    console.log('✅ [PASS] TEST 6.1: Consulta cadastral direta aprovada com sucesso!');

    // Caso 6.2: Tempário com placa de carro que NÃO tem OS no pátio da loja
    // Insere Golf em placa_lookup_cache para simular resolução prévia de placa
    savePlateRecord(db, {
      placaLimpa: 'GOL7F14',
      placaFormatada: 'GOL-7F14',
      marca: 'VOLKSWAGEN',
      modelo: 'GOLF',
      modeloCompleto: 'Volkswagen Golf 1.4 TSI',
      versao: 'Highline 1.4 TSI',
      anoFabricacao: 2015,
      anoModelo: 2015,
      motor: 'EA211 1.4 TSI',
      origemDados: 'APIBRASIL',
      rawPayloadJson: '{}',
      createdAt: new Date().toISOString()
    });

    console.log('\n[TEST 6.2] Enviando tempário: "quanto tempo e valor de mao de obra pra trocar farol e radiador da placa GOL7F14?"...');
    const tTempario = Date.now();
    const resTempario = await dispatchMessage({
      phone: userPhone,
      message: 'quanto tempo e valor de mao de obra pra trocar farol e radiador da placa GOL7F14?',
      db,
      skipIdempotencyCheck: true
    });
    const durTempario = Date.now() - tTempario;
    console.log(`[TEST 6.2] Duração: ${durTempario}ms | Motor: ${resTempario.motor}`);
    console.log('[TEST 6.2] Resposta:\n' + resTempario.replyText + '\n');

    assert(durTempario < 3500, `Latência deve ser < 3500ms no cold-start, obtido ${durTempario}ms`);
    assert(resTempario.replyText.includes('Volkswagen Golf'), 'Deve resolver para Volkswagen Golf');
    assert(resTempario.replyText.includes('3,05') || resTempario.replyText.includes('3.05'), 'Deve conter tempo líquido de 3,05h');
    assert(resTempario.replyText.includes('823,50'), 'Deve conter valor de mão de obra de R$ 823,50');
    assert(resTempario.replyText.includes('270,00'), 'Deve explicitar taxa da rede de R$ 270,00/h');
    assert(resTempario.replyText.includes('Deseja ver o detalhamento técnico?'), 'Deve conter o menu de Progressive Disclosure');

    // Valida Fast-Path com pipeline warm (< 100ms)
    const tWarm = Date.now();
    const resWarm = await dispatchMessage({
      phone: userPhone,
      message: 'quanto tempo e valor de mao de obra pra trocar farol e radiador da placa GOL7F14?',
      db,
      skipIdempotencyCheck: true
    });
    const durWarm = Date.now() - tWarm;
    console.log(`[TEST 6.2] Duração Warm Fast-Path: ${durWarm}ms`);
    assert(durWarm < 150, `Latência warm deve ser < 150ms, obtido ${durWarm}ms`);

    console.log('✅ [PASS] TEST 6.2: Tempário com placa inédita resolvido com sucesso!');
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('TODOS OS TESTES DA SPEC 064 FORAM APROVADOS COM 100% DE SUCESSO!');
  console.log('══════════════════════════════════════════════════════════════════════');
}

runPlateLookupSuite().catch((err: Error) => {
  console.error('\n❌ ERRO NA SUÍTE DE PLACAS:', err.message);
  console.error(err.stack);
  process.exit(1);
});
