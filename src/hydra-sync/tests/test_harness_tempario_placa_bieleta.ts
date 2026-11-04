/**
 * src/hydra-sync/tests/test_harness_tempario_placa_bieleta.ts
 * Suíte de Testes da Spec 065: Tempário Técnico por Placa, Suspensão & Mensagem Multiline.
 *
 * Valida:
 * 1. Reconhecimento sintático da frase exata do Davi: "FCK2E73 \n\ntroca da bieleta dianteira direita".
 * 2. Mapeamento e enriquecimento do veículo a partir da OS no banco (TRACKER -> Chevrolet Tracker).
 * 3. Cálculo do tempo e mão de obra com taxa estrita da rede de R$ 270,00/h (0,80h = R$ 216,00).
 * 4. Apresentação do card executivo Hermes V2 com Progressive Disclosure.
 * 5. Fluxo E2E via dispatchMessage simulando WhatsApp real com disclosure interativo de Peças e Ferramentas.
 * 6. Não-regressão para consultas diretas de placa ("placa EWB4J21") e tempário comum ("troca farol corsa 2010").
 *
 * Regra Cardinal: TypeScript strict — ZERO any, ZERO @ts-ignore.
 */

import Database from 'better-sqlite3';
import {
  isTemparioTechnicalQuery,
  extractTemparioEntitiesFromText,
  rewriteIntent,
  isDirectPlateQuery
} from '../intent_rewriter.js';
import {
  ensureTemparioTables,
  seedCanonicalTemparioCatalog
} from '../tempario_graph_repository.js';
import {
  TemparioHybridCoordinator,
  resolveVehicleFromPlateOrOs
} from '../tempario_hybrid_coordinator.js';
import { ensurePlateLookupTable, savePlateRecord } from '../apibrasil_plate_client.js';
import { ensureOrdensServicoTable } from '../operational_data_repository.js';
import { dispatchMessage } from '../agent_dispatcher.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runBieletaSuite(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('HYDRA — BATERIA SPEC 065: TEMPÁRIO POR PLACA, SUSPENSÃO & MULTILINE');
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
      default_scope TEXT DEFAULT 'rede',
      memory_generation INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const userPhone = '5511996242812';
  db.prepare(`
    INSERT INTO hydra_user_profiles (phone, persona, loja_slug, loja_nome, default_scope)
    VALUES (?, 'socio', NULL, 'Rede', 'rede')
  `).run(userPhone);

  // Insere OS real do Tracker FCK2E73 no pátio do Rei do Óleo Mauá
  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, is_aberta, status_grid, veiculo, placa, total_os, valor_restante, raw_payload
    ) VALUES (
      '22664', 'ReiDoOleoMaua', 1, 'VEICULO EM EXECUÇÃO', 'TRACKER', 'FCK2E73', 1269.60, 1269.60,
      '{"veiculo":"TRACKER","itens":[{"descricao":"LIMPEZA SISTEMA FREIO"}]}'
    )
  `).run();

  const daviMessage = 'FCK2E73 \n\ntroca da bieleta dianteira direita';

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 1: Reconhecimento Sintático e Isolamento de Intenção
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[TEST 1] Validando classificação sintática da frase do Davi...');
  {
    const isDirectPlate = isDirectPlateQuery(daviMessage);
    assert(!isDirectPlate.isPlateQuery, 'Não deve ser classificada como consulta puramente cadastral de placa');

    const isTempario = isTemparioTechnicalQuery(daviMessage);
    assert(isTempario, 'Deve ser classificada como consulta técnica de tempário');

    const entities = extractTemparioEntitiesFromText(daviMessage);
    assert(entities.placa === 'FCK2E73', 'Deve extrair a placa FCK2E73 com precisão');
    assert(entities.serviceTerms.includes('bieleta'), 'Deve reconhecer "bieleta" nos termos de serviço');

    const rewritten = rewriteIntent(daviMessage, null);
    assert(rewritten.intent === 'TEMPARIO_TEMPO_SERVICO', 'Canonical intent deve ser TEMPARIO_TEMPO_SERVICO');
    console.log('✅ [PASS] TEST 1: Classificação sintática e reescrita de intenção aprovadas!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 2: Resolução e Enriquecimento do Veículo a partir da Placa/OS
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 2] Validando enriquecimento de "TRACKER" para "Chevrolet Tracker"...');
  {
    const resolved = await resolveVehicleFromPlateOrOs(db, { placa: 'FCK2E73' });
    assert(resolved !== null, 'Deve encontrar o veículo da placa FCK2E73 no banco');
    assert(resolved!.veiculo === 'Chevrolet Tracker', `Esperado "Chevrolet Tracker", obtido "${resolved?.veiculo}"`);
    console.log(`[TEST 2] Veículo resolvido: "${resolved!.veiculo}"`);
    console.log('✅ [PASS] TEST 2: Enriquecimento de modelo veicular validado com sucesso!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 3: Coordenação Híbrida e Grafo Canônico (Taxa R$ 270,00/h)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 3] Validando cálculo no Grafo Canônico (0,80h = R$ 216,00)...');
  {
    const coordinator = new TemparioHybridCoordinator(db);
    const queryResp = await coordinator.coordinateQuery({
      rawQuery: daviMessage,
      veiculoMarcaModelo: 'Chevrolet Tracker',
      placa: 'FCK2E73',
      servicosSolicitados: ['bieleta'],
      securityContext: {
        persona: 'socio',
        authorizedLojaSlug: undefined,
        authorizedStore: undefined
      }
    });

    assert(queryResp.statusEvidenciaGlobal === 'HOMOLOGADO_OEM', 'Deve vir do catálogo homologado OEM');
    assert(queryResp.cadeiaExecucao.tempoLiquidoTotalHoras === 0.80, `Tempo líquido deve ser 0.80h, obtido ${queryResp.cadeiaExecucao.tempoLiquidoTotalHoras}`);
    assert(queryResp.cadeiaExecucao.valorMaoDeObraSugerido === 216.00, `Mão de obra deve ser R$ 216,00, obtido ${queryResp.cadeiaExecucao.valorMaoDeObraSugerido}`);
    assert(queryResp.cadeiaExecucao.taxaHorariaPadrao === 270.00, 'Taxa horária deve ser rigorosamente R$ 270,00/h');

    // Valida presença de peças de bieleta
    const temBieletaPeca = queryResp.cadeiaExecucao.pecasNecessarias.some(p => p.nomePeca.toLowerCase().includes('bieleta'));
    assert(temBieletaPeca, 'Deve conter a peça bieleta da barra estabilizadora');

    // Valida ferramentas com torques
    const temTorque = queryResp.cadeiaExecucao.torquesEspecificados.some(t => t.toLowerCase().includes('55 nm'));
    assert(temTorque, 'Deve especificar o torque de 55 Nm nas porcas da bieleta');
    console.log('✅ [PASS] TEST 3: Grafo canônico de suspensão e valores validados com perfeição!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 4: Fluxo E2E via dispatchMessage (WhatsApp Real)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 4] Validando dispatchMessage E2E com a frase exata do Davi...');
  {
    const t0 = Date.now();
    const res = await dispatchMessage({
      phone: userPhone,
      message: daviMessage,
      db,
      skipIdempotencyCheck: true
    });
    const dur = Date.now() - t0;
    console.log(`[TEST 4] Duração: ${dur}ms | Motor: ${res.motor}`);
    console.log('[TEST 4] Resposta entregue:\n' + res.replyText + '\n');

    assert(res.motor === 'FALLBACK_API', 'Deve ser processado pelo Fast-Path (FALLBACK_API/determinístico)');
    assert(res.replyText.includes('Chevrolet Tracker') || res.replyText.includes('Tracker'), 'Deve citar o veículo Tracker');
    assert(res.replyText.includes('Bieleta') || res.replyText.includes('bieleta'), 'Deve citar o serviço de bieleta');
    assert(res.replyText.includes('0,80h') || res.replyText.includes('0.80h'), 'Deve conter tempo líquido de 0,80h');
    assert(res.replyText.includes('216,00'), 'Deve conter valor de mão de obra de R$ 216,00');
    assert(res.replyText.includes('270,00'), 'Deve explicitar taxa da rede de R$ 270,00/h');
    assert(res.replyText.includes('Deseja ver o detalhamento técnico?'), 'Deve conter o menu de Progressive Disclosure');
    console.log('✅ [PASS] TEST 4: Resposta executiva Hermes V2 aprovada!');

    // ─────────────────────────────────────────────────────────────────────────
    // TESTE 4.1: Interatividade — Usuário responde "1" (Peças)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[TEST 4.1] Simulando resposta "1" para ver peças...');
    const resPecas = await dispatchMessage({
      phone: userPhone,
      message: '1',
      db,
      skipIdempotencyCheck: true
    });
    console.log('[TEST 4.1] Resposta Peças:\n' + resPecas.replyText + '\n');
    assert(resPecas.replyText.includes('Peças Necessárias'), 'Deve conter cabeçalho de peças');
    assert(resPecas.replyText.includes('Bieleta da barra estabilizadora'), 'Deve listar as bieletas');
    assert(resPecas.replyText.includes('Porcas autotravantes'), 'Deve listar as porcas');
    console.log('✅ [PASS] TEST 4.1: Progressive Disclosure de Peças aprovado!');

    // ─────────────────────────────────────────────────────────────────────────
    // TESTE 4.2: Interatividade — Usuário responde "2" (Ferramentas e Torques)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[TEST 4.2] Simulando resposta "2" para ver ferramentas e torques...');
    const resFerr = await dispatchMessage({
      phone: userPhone,
      message: '2',
      db,
      skipIdempotencyCheck: true
    });
    console.log('[TEST 4.2] Resposta Ferramentas:\n' + resFerr.replyText + '\n');
    assert(resFerr.replyText.includes('Ferramental & Torques'), 'Deve conter cabeçalho de ferramentas');
    assert(resFerr.replyText.includes('Torquímetro'), 'Deve exigir torquímetro');
    assert(resFerr.replyText.includes('55 Nm'), 'Deve explicitar o torque de 55 Nm');
    console.log('✅ [PASS] TEST 4.2: Progressive Disclosure de Ferramentas aprovado!');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 5: Teste de Não-Regressão
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 5] Validando não-regressão de outras intenções...');
  {
    // 5.1 Consulta cadastral pura de placa
    savePlateRecord(db, {
      placaLimpa: 'EWB4J21',
      placaFormatada: 'EWB-4J21',
      marca: 'HONDA',
      modelo: 'CIVIC',
      modeloCompleto: 'Honda Civic Touring',
      origemDados: 'ORDENS_SERVICO_REDE',
      rawPayloadJson: '{}',
      createdAt: new Date().toISOString()
    });

    const resPlate = await dispatchMessage({
      phone: userPhone,
      message: 'placa EWB4J21',
      db,
      skipIdempotencyCheck: true
    });
    assert(resPlate.replyText.includes('Consulta Veicular por Placa'), 'Deve abrir o card cadastral da placa');
    assert(resPlate.replyText.includes('EWB-4J21'), 'Deve conter a placa formatada');

    // 5.2 Consulta direta de tempário de farol
    const resFarol = await dispatchMessage({
      phone: userPhone,
      message: 'troca farol corsa 2010',
      db,
      skipIdempotencyCheck: true
    });
    assert(resFarol.replyText.includes('Tempário Técnico & Mão de Obra'), 'Deve manter tempário de farol');
    assert(resFarol.replyText.includes('Corsa'), 'Deve identificar Corsa');

    console.log('✅ [PASS] TEST 5: Todas as rotas de não-regressão foram aprovadas!');
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('TODOS OS TESTES DA SPEC 065 FORAM APROVADOS COM 100% DE SUCESSO!');
  console.log('══════════════════════════════════════════════════════════════════════');
}

runBieletaSuite().catch((err: Error) => {
  console.error('\n❌ ERRO NA SUÍTE DE BIELETA:', err.message);
  console.error(err.stack);
  process.exit(1);
});
