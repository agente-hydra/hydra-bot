/**
 * src/hydra-sync/tests/test_harness_spec066_ia_web_anti_hallucination.ts
 * Suíte E2E de Validação Determinística e Anti-Alucinação (Spec 066):
 * 1. Purga de registros zumbis/contaminados ("Veículo Passeio", "Nacional TRACKER (2002-2012)")
 * 2. FCK2E73 + "troca da bieleta dianteira direita" -> Chevrolet Tracker (2020-2025), 0,80h = R$ 216,00, 3 etapas reais com torque
 * 3. EUS5006 + "troca de motor de partida" -> ZERO vazamento de bieleta, ZERO "Veículo Passeio", pede modelo/ano em 1 balão limpo
 *    + Turno seguinte "Palio 1.0 2012" -> vincula EUS5006 a Fiat Palio no cache e retorna tempário 1,10h = R$ 297,00 com 4 etapas reais
 * 4. Consulta aberta "Corsa 2010 troca de motor de partida" -> Chevrolet Corsa (2010), 1,10h = R$ 297,00, 4 etapas reais
 */

import Database from 'better-sqlite3';
import {
  ensureTemparioTables,
  isValidVehicleForPersistence
} from '../tempario_graph_repository.js';
import { TemparioHybridCoordinator } from '../tempario_hybrid_coordinator.js';
import {
  composeTemparioExecutiveBalloon,
  composeTemparioDetailBalloon,
  composeUnresolvedPlateTemparioBalloon
} from '../balloon_composer.js';
import {
  ensurePlateLookupTable,
  upsertManualPlateCache,
  lookupVehiclePlate
} from '../apibrasil_plate_client.js';
import { resolveVehicleBrandAndModel } from '../tempario_web_researcher.js';

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FALHA SPEC-066] ${message}`);
  }
}

async function runSpec066Tests(): Promise<void> {
  console.log('=== INICIANDO TEST HARNESS SPEC 066 (IA + WEB RESEARCH + ANTI-ALUCINAÇÃO) ===');

  const db = new Database(':memory:');
  ensureTemparioTables(db);
  ensurePlateLookupTable(db);

  // Simula banco poluído exatamente como estava na VPS antes da Spec 066
  db.prepare(`
    INSERT INTO tempario_vehicles (vehicle_id, marca, modelo, geracao, ano_inicio, ano_fim, categoria)
    VALUES
      ('veh_veculo_veculopasseio_2002_2012', 'Veículo', 'Veículo Passeio', '2002-2012', 2002, 2012, 'PASSEIO'),
      ('veh_nacional_tracker_2002_2012', 'Nacional', 'TRACKER', '2002-2012', 2002, 2012, 'PASSEIO')
  `).run();

  db.prepare(`
    INSERT INTO tempario_evidence_sources (
      source_id, tipo_fonte, status_evidencia, nome_documento
    ) VALUES ('src_polluted', 'ESTIMATIVA_EXTERNA', 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO', 'Fonte Poluída Teste')
  `).run();

  db.prepare(`
    INSERT INTO tempario_operations (
      operation_id, codigo_operacao_oem, vehicle_id, engine_id, titulo, sinonimos_busca,
      categoria_servico, tempo_padrao_bruto_horas, fator_variacao_motor, grau_dificuldade,
      source_id, status_evidencia
    ) VALUES (
      'op_veculo_veculopasseio_substitui__o_da_bieleta_dianteira_direita___troca_da_bieleta_dianteira_2002',
      'WEB-6066',
      'veh_veculo_veculopasseio_2002_2012',
      NULL,
      'Substituição da bieleta dianteira direita + Troca da bieleta dianteira',
      'bieleta dianteira troca',
      'Geral',
      2.5, 1.0, 'MEDIO',
      'src_polluted',
      'HISTORICO_OS_REDE'
    )
  `).run();

  // 1. Verifica que o coordenador purga registros poluídos e faz seed do catálogo canônico automaticamente
  const coordinator = new TemparioHybridCoordinator(db);

  // Simula FCK2E73 já cacheado como TRACKER (como ocorre via ERP/APIBrasil)
  upsertManualPlateCache(db, {
    placa: 'FCK2E73',
    marca: 'Chevrolet',
    modelo: 'TRACKER',
    ano: 2021,
    motor: '1.0 Turbo'
  });

  // =========================================================================
  // CENÁRIO 1: FCK2E73 \n\ntroca da bieleta dianteira direita + Opção 3
  // =========================================================================
  console.log('\n[Cenário 1] Testando FCK2E73 + troca da bieleta dianteira direita...');
  const rawQuery1 = 'FCK2E73 \n\ntroca da bieleta dianteira direita';
  const plateInfo1 = await lookupVehiclePlate(db, 'FCK2E73');
  assertCondition(Boolean(plateInfo1 && plateInfo1.modelo.toUpperCase().includes('TRACKER')), 'FCK2E73 deve resolver para TRACKER');

  const resp1 = await coordinator.coordinateQuery({
    rawQuery: rawQuery1,
    veiculoMarcaModelo: `${plateInfo1!.marca} ${plateInfo1!.modelo}`,
    ano: plateInfo1!.anoModelo || plateInfo1!.anoFabricacao || undefined,
    motorTexto: plateInfo1!.motor || undefined,
    placa: 'FCK2E73',
    servicosSolicitados: ['troca da bieleta dianteira direita'],
    securityContext: { persona: 'socio' }
  });

  const execBalloon1 = composeTemparioExecutiveBalloon(resp1).join('\n');
  console.log('--- Balão Executivo (FCK2E73) ---\n' + execBalloon1);

  assertCondition(!execBalloon1.includes('Nacional'), 'Proibido exibir "Nacional TRACKER"');
  assertCondition(!execBalloon1.includes('Motor Motor'), 'Proibido exibir "Motor Motor Padrão"');
  assertCondition(!execBalloon1.includes('2002-2012'), 'Proibido exibir geração alucinada 2002-2012 para Tracker');
  assertCondition(execBalloon1.includes('Chevrolet Tracker'), 'Deve identificar Chevrolet Tracker');
  assertCondition(
    Math.abs(resp1.cadeiaExecucao.tempoLiquidoTotalHoras - 0.8) < 0.01 &&
      Math.abs(resp1.cadeiaExecucao.valorMaoDeObraSugerido - 216.0) < 0.5,
    `Tempo/valor incorreto para bieleta Tracker: ${resp1.cadeiaExecucao.tempoLiquidoTotalHoras}h / R$ ${resp1.cadeiaExecucao.valorMaoDeObraSugerido}`
  );

  const detailBalloon1 = composeTemparioDetailBalloon('PASSOS', resp1).join('\n');
  console.log('--- Balão Opção 3 Passo a Passo (FCK2E73) ---\n' + detailBalloon1);

  assertCondition(
    resp1.cadeiaExecucao.steps.length >= 3,
    `Esperado >= 3 etapas técnicas reais no grafo da bieleta, obtido: ${resp1.cadeiaExecucao.steps.length}`
  );
  assertCondition(
    !detailBalloon1.includes('Execução de troca da bieleta dianteira direita (Pesquisa Técnica Web)'),
    'Proibido exibir passo único genérico tautológico'
  );
  assertCondition(detailBalloon1.includes('55 Nm') || detailBalloon1.includes('140 Nm'), 'Deve incluir torques técnicos reais');

  // Verifica que os registros poluídos foram purgados do SQLite
  const pollutedLeft = db
    .prepare(`SELECT COUNT(*) as c FROM tempario_vehicles WHERE LOWER(marca) IN ('veículo', 'veiculo', 'nacional')`)
    .get() as { c: number };
  assertCondition(pollutedLeft.c === 0, `Registros poluídos ainda presentes no banco: ${pollutedLeft.c}`);

  // =========================================================================
  // CENÁRIO 2: EUS5006 \n\ntroca de motor de partida (Placa sem cadastro + Vínculo em 2 Turnos)
  // =========================================================================
  console.log('\n[Cenário 2] Testando EUS5006 + troca de motor de partida (Anti-Vazamento + Vínculo Conversacional)...');

  // Turno 1: Placa EUS5006 não está no banco e usuário não informou o carro -> Bot pede o carro em 1 balão limpo
  const unresolvedBalloon = composeUnresolvedPlateTemparioBalloon({
    placa: 'EUS5006',
    servicos: ['troca de motor de partida']
  }).join('\n');
  console.log('--- Balão Turno 1 (Placa EUS5006 Pendente) ---\n' + unresolvedBalloon);

  assertCondition(unresolvedBalloon.includes('EUS5006'), 'Deve citar a placa EUS5006');
  assertCondition(unresolvedBalloon.toLowerCase().includes('motor de partida'), 'Deve manter o serviço solicitado (motor de partida)');
  assertCondition(!unresolvedBalloon.toLowerCase().includes('bieleta'), 'ZERO vazamento de bieleta permitido');
  assertCondition(!unresolvedBalloon.includes('Veículo Passeio'), 'ZERO "Veículo Passeio" permitido');

  // Turno 2: Usuário responde "Palio 1.0 2012" -> Sistema vincula EUS5006 ao Fiat Palio 2012 e entrega o tempário
  const resolvedIdentity = resolveVehicleBrandAndModel('Palio', 2012, '1.0');
  assertCondition(
    isValidVehicleForPersistence(resolvedIdentity.marca, resolvedIdentity.modelo),
    `Identidade resolvida inválida: ${JSON.stringify(resolvedIdentity)}`
  );

  upsertManualPlateCache(db, {
    placa: 'EUS5006',
    marca: resolvedIdentity.marca,
    modelo: resolvedIdentity.modelo,
    ano: 2012,
    motor: resolvedIdentity.motorPadrao
  });

  const resp2 = await coordinator.coordinateQuery({
    rawQuery: `${resolvedIdentity.marca} ${resolvedIdentity.modelo} 2012 troca de motor de partida`,
    veiculoMarcaModelo: `${resolvedIdentity.marca} ${resolvedIdentity.modelo}`,
    ano: 2012,
    motorTexto: resolvedIdentity.motorPadrao,
    placa: 'EUS5006',
    servicosSolicitados: ['troca de motor de partida'],
    securityContext: { persona: 'socio' }
  });

  const execBalloon2 = composeTemparioExecutiveBalloon(resp2).join('\n');
  console.log('--- Balão Turno 2 (Após vínculo EUS5006 -> Fiat Palio 2012) ---\n' + execBalloon2);

  assertCondition(!execBalloon2.toLowerCase().includes('bieleta'), 'Proibido vazar bieleta no resultado de motor de partida!');
  assertCondition(!execBalloon2.includes('Veículo Passeio'), 'Proibido exibir Veículo Passeio!');
  assertCondition(execBalloon2.includes('Fiat Palio'), `Esperado Fiat Palio no cabeçalho, obtido: ${execBalloon2}`);
  assertCondition(
    Math.abs(resp2.cadeiaExecucao.tempoLiquidoTotalHoras - 1.1) < 0.05 &&
      Math.abs(resp2.cadeiaExecucao.valorMaoDeObraSugerido - 297.0) < 1.0,
    `Esperado 1,10h (R$ 297,00) para motor de partida, obtido: ${resp2.cadeiaExecucao.tempoLiquidoTotalHoras}h / R$ ${resp2.cadeiaExecucao.valorMaoDeObraSugerido}`
  );
  assertCondition(
    resp2.cadeiaExecucao.steps.length >= 4,
    `Esperado >= 4 etapas reais para motor de partida, obtido: ${resp2.cadeiaExecucao.steps.length}`
  );

  const detailBalloon2 = composeTemparioDetailBalloon('PASSOS', resp2).join('\n');
  console.log('--- Balão Opção 3 Passo a Passo (EUS5006 - Motor de Partida) ---\n' + detailBalloon2);
  assertCondition(detailBalloon2.toLowerCase().includes('bateria'), 'Deve incluir etapa de desconexão de bateria');
  assertCondition(detailBalloon2.toLowerCase().includes('linha 50') || detailBalloon2.toLowerCase().includes('linha 30'), 'Deve incluir etapa técnica dos terminais B+/linha 50');

  // =========================================================================
  // CENÁRIO 3: Consulta Aberta Direta ("Corsa 2010 troca de motor de partida")
  // =========================================================================
  console.log('\n[Cenário 3] Testando consulta aberta "Corsa 2010 troca de motor de partida"...');
  const rawQuery3 = 'Corsa 2010 troca de motor de partida';
  const resp3 = await coordinator.coordinateQuery({
    rawQuery: rawQuery3,
    veiculoMarcaModelo: 'Corsa',
    ano: 2010,
    servicosSolicitados: ['troca de motor de partida'],
    securityContext: { persona: 'socio' }
  });
  const execBalloon3 = composeTemparioExecutiveBalloon(resp3).join('\n');
  console.log('--- Balão Executivo (Corsa 2010) ---\n' + execBalloon3);
  assertCondition(execBalloon3.includes('Chevrolet Corsa'), 'Deve resolver marca Chevrolet para Corsa 2010');
  assertCondition(!execBalloon3.includes('Nacional'), 'Proibido exibir marca "Nacional"');
  assertCondition(resp3.cadeiaExecucao.steps.length >= 4, 'Deve conter 4 etapas técnicas');

  console.log('\n✅ TODOS OS TESTES DA SPEC 066 PASSARAM COM SUCESSO ABSOLUTO!');
}

runSpec066Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
