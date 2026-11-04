/**
 * src/hydra-sync/tests/test_harness_spec067_plate_resilience.ts
 * Suíte de Testes E2E da Spec 067:
 * - Diagnóstico Transparente da APIBrasil (HTTP 402/404)
 * - Estimativa Operacional de Linha Passeio Padrão Imediata (Non-Blocking)
 * - Navegação de Detalhamento Técnico (Opção 3 Passo a Passo)
 * - Vínculo Conversacional no Próximo Turno ("Palio 1.0 2012") e Cache L1
 */

import Database from 'better-sqlite3';
import {
  ensureTemparioTables,
  isValidVehicleForPersistence
} from '../tempario_graph_repository.js';
import { TemparioHybridCoordinator } from '../tempario_hybrid_coordinator.js';
import {
  composeTemparioExecutiveBalloon,
  composeTemparioDetailBalloon
} from '../balloon_composer.js';
import {
  ensurePlateLookupTable,
  lookupVehiclePlate,
  upsertManualPlateCache,
  recordPlateDiagnostic,
  getLastPlateDiagnostic
} from '../apibrasil_plate_client.js';
import { resolveVehicleBrandAndModel } from '../tempario_web_researcher.js';
import type { TemparioHybridQueryResponse } from '../types/tempario_contract.js';

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FALHA SPEC-067] ${message}`);
  }
}

async function runSpec067Tests(): Promise<void> {
  console.log('=== INICIANDO TEST HARNESS SPEC 067 (DIAGNÓSTICO APIBRASIL + ESTIMATIVA IMEDIATA) ===');

  const db = new Database(':memory:');
  ensureTemparioTables(db);
  ensurePlateLookupTable(db);

  const coordinator = new TemparioHybridCoordinator(db);

  // =========================================================================
  // CENÁRIO 1: Consulta com Placa sem Cadastro e APIBrasil sem Saldo (HTTP 402/404)
  // =========================================================================
  console.log('\n[Cenário 1] Testando EUS5006 + troca de motor de partida sem cadastro prévio...');
  const targetPlaca = 'EUS5006';
  const effectiveServices = ['troca de motor de partida'];

  // Simula diagnóstico registrado pelo cliente APIBrasil
  recordPlateDiagnostic({
    placa: targetPlaca,
    status: 'APIBRASIL_INSUFFICIENT_BALANCE',
    mensagemDiagnostico: 'Conta APIBrasil sem saldo para consulta de placas (R$ 0,00)',
    contaEmail: 'mktfunil1@gmail.com'
  });

  const lastAudit = getLastPlateDiagnostic(targetPlaca);
  assertCondition(lastAudit?.status === 'APIBRASIL_INSUFFICIENT_BALANCE', 'Diagnóstico deve ser APIBRASIL_INSUFFICIENT_BALANCE');

  let diagNotice = 'Placa sem histórico de OS no ERP da rede';
  if (lastAudit?.status === 'APIBRASIL_INSUFFICIENT_BALANCE') {
    diagNotice = 'Placa sem histórico no ERP (APIBrasil: conta sem saldo para busca automática — recarregue em app.apibrasil.io)';
  }

  // Gera tempário de referência para linha passeio
  const queryResp = await coordinator.coordinateQuery({
    rawQuery: `${effectiveServices.join(' ')} linha passeio`,
    veiculoMarcaModelo: 'Linha Passeio (Referência Padrão)',
    placa: targetPlaca,
    servicosSolicitados: effectiveServices,
    securityContext: { persona: 'socio' }
  });

  const enrichedResp: TemparioHybridQueryResponse = {
    ...queryResp,
    isEstimativaReferencia: true,
    diagnosticoPlaca: diagNotice
  };

  const balloons1 = composeTemparioExecutiveBalloon(enrichedResp, {
    placaConsultada: targetPlaca
  });
  const execCard = balloons1.join('\n');
  console.log('--- Balão Executivo Turno 1 (Estimativa Imediata) ---\n' + execCard);

  // Asserções Contratuais do Balão de Referência:
  assertCondition(execCard.includes('Placa EUS5006'), 'Deve citar a placa consultada');
  assertCondition(execCard.includes('Estimativa de Referência'), 'Deve indicar que se trata de estimativa de referência');
  assertCondition(execCard.includes('R$ 270,00/h'), 'Deve respeitar taxa da rede de R$ 270,00/h');
  assertCondition(execCard.includes('1,10h') || execCard.includes('1h 6 min'), 'Tempo sugerido de motor de partida deve ser 1,10h');
  assertCondition(execCard.includes('R$ 297,00'), 'Valor sugerido deve ser R$ 297,00');
  assertCondition(execCard.includes('APIBrasil: conta sem saldo'), 'Deve conter o diagnóstico transparente da APIBrasil');
  assertCondition(execCard.includes('1️⃣') && execCard.includes('4️⃣'), 'Deve conter os botões de Progressive Disclosure');
  assertCondition(execCard.includes('Para cravar o tempo exato'), 'Deve convidar o operador a informar o modelo e ano');

  // =========================================================================
  // CENÁRIO 2: Operador seleciona opção 3 (Passo a Passo) da Estimativa de Referência
  // =========================================================================
  console.log('\n[Cenário 2] Testando seleção imediata de opção 3 (Passo a Passo)...');
  const detailBalloons = composeTemparioDetailBalloon('PASSOS', enrichedResp);
  const detailCard = detailBalloons.join('\n');
  console.log('--- Balão Opção 3 Passo a Passo ---\n' + detailCard);

  assertCondition(detailCard.includes('Sequência Técnica de Execução'), 'Deve ser o card de sequência técnica');
  assertCondition(enrichedResp.cadeiaExecucao.steps.length >= 4, 'Deve conter 4 etapas técnicas reais');
  assertCondition(detailCard.toLowerCase().includes('bateria'), 'Deve conter etapa de segurança da bateria');
  assertCondition(detailCard.includes('35 Nm') || detailCard.includes('32 a 38 Nm'), 'Deve conter torques reais tabelados');

  // =========================================================================
  // CENÁRIO 3: Operador responde com modelo/ano no turno seguinte ("Palio 1.0 2012")
  // =========================================================================
  console.log('\n[Cenário 3] Testando resposta no turno seguinte com modelo/ano ("Palio 1.0 2012")...');
  const resolvedIdentity = resolveVehicleBrandAndModel('Palio', 2012, '1.0');
  assertCondition(
    isValidVehicleForPersistence(resolvedIdentity.marca, resolvedIdentity.modelo),
    'Fiat Palio deve ser veículo válido para persistência'
  );

  upsertManualPlateCache(db, {
    placa: targetPlaca,
    marca: resolvedIdentity.marca,
    modelo: resolvedIdentity.modelo,
    ano: 2012,
    motor: resolvedIdentity.motorPadrao
  });

  // Próxima consulta da mesma placa agora bate no cache L1!
  const cachedPlate = await lookupVehiclePlate(db, targetPlaca);
  assertCondition(Boolean(cachedPlate), 'Placa deve estar salva no cache SQLite');
  assertCondition(cachedPlate!.marca === 'Fiat' && cachedPlate!.modelo === 'Palio', 'Cache deve conter Fiat Palio');

  const refinedResp = await coordinator.coordinateQuery({
    rawQuery: `${cachedPlate!.modeloCompleto} 2012 troca de motor de partida`,
    veiculoMarcaModelo: cachedPlate!.modeloCompleto,
    ano: 2012,
    motorTexto: cachedPlate!.motor || resolvedIdentity.motorPadrao,
    placa: targetPlaca,
    servicosSolicitados: effectiveServices,
    securityContext: { persona: 'socio' }
  });

  const refinedBalloons = composeTemparioExecutiveBalloon(refinedResp, {
    placaConsultada: targetPlaca
  });
  const refinedCard = refinedBalloons.join('\n');
  console.log('--- Balão Refinado Turno 2 (Fiat Palio 2012) ---\n' + refinedCard);

  assertCondition(refinedCard.includes('Fiat Palio'), 'Deve exibir Fiat Palio no cabeçalho');
  assertCondition(!refinedCard.includes('Estimativa de Referência'), 'Card refinado não é mais apenas de referência');
  assertCondition(refinedCard.includes('1,10h') && refinedCard.includes('R$ 297,00'), 'Valor de mão de obra mantido em R$ 297,00');

  console.log('\n✅ TODOS OS TESTES DA SPEC 067 PASSARAM COM SUCESSO ABSOLUTO!');
}

runSpec067Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
