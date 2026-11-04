/**
 * src/hydra-sync/tests/test_harness_spec068_lighting_and_typo.ts
 * Suite de Testes Automatizada — Spec 068: Tempário Técnico de Iluminação, Resiliência a Typos e Neutralização de Alucinação LLM
 */

import Database from 'better-sqlite3';
import {
  isTemparioTechnicalQuery,
  extractTemparioEntitiesFromText,
  normalizeMechanicalQueryText
} from '../intent_rewriter.js';
import { TemparioHybridCoordinator } from '../tempario_hybrid_coordinator.js';
import {
  composeTemparioExecutiveBalloon,
  composeTemparioDetailBalloon
} from '../balloon_composer.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FALHA ASSERT]: ${message}`);
  }
}

async function runSuite(): Promise<void> {
  console.log('=== INICIANDO TEST HARNESS SPEC 068 (ILUMINAÇÃO RÁPIDA + TYPO RESILIENCE) ===\n');

  const db = new Database(':memory:');
  const coordinator = new TemparioHybridCoordinator(db);

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 1: Caso Real do Usuário ("troca de laampadas traseiras tracker 2023")
  // ───────────────────────────────────────────────────────────────────────────
  console.log('[Cenário 1] Testando query com typo fonético "troca de laampadas traseiras tracker 2023"...');
  const qDavi = 'troca de laampadas traseiras tracker 2023';

  // 1.1 Normalização fonética
  const normalized = normalizeMechanicalQueryText(qDavi);
  console.log('  Normalized:', normalized);
  assert(normalized.includes('lampadas'), 'Normalização deve corrigir "laampadas" para "lampadas"');

  // 1.2 Detecção de Tempário
  const isTempario = isTemparioTechnicalQuery(qDavi);
  console.log('  isTemparioTechnicalQuery:', isTempario);
  assert(isTempario === true, 'Query de troca de lâmpadas traseiras com typo DEVE ser detectada como tempário');

  // 1.3 Extração adaptativa de entidades
  const extracted = extractTemparioEntitiesFromText(qDavi);
  console.log('  Extracted:', extracted);
  assert(extracted.veiculo === 'tracker', 'Deve extrair veículo "tracker"');
  assert(extracted.ano === 2023, 'Deve extrair ano 2023');
  assert(
    extracted.serviceTerms.some(s => s.includes('lampada') || s.includes('traseira')),
    'serviceTerms deve conter o termo de lâmpada e não o nome do carro ou ano'
  );
  assert(
    !extracted.serviceTerms[0].includes('tracker'),
    'serviceTerms NÃO deve vir poluído com o nome do veículo'
  );

  // 1.4 Resolução no Coordenador de Tempário
  const resp = await coordinator.coordinateQuery({
    rawQuery: qDavi,
    veiculoMarcaModelo: 'Chevrolet Tracker',
    ano: 2023,
    servicosSolicitados: extracted.serviceTerms,
    securityContext: {
      persona: 'socio' as const,
      authorizedLojaSlug: 'rede'
    }
  });

  console.log('  Tempo Líquido:', resp.cadeiaExecucao.tempoLiquidoTotalHoras, 'h');
  console.log('  Mão de Obra:', 'R$', resp.cadeiaExecucao.valorMaoDeObraSugerido);
  console.log('  Qtd Etapas:', resp.cadeiaExecucao.steps.length);

  assert(
    resp.cadeiaExecucao.tempoLiquidoTotalHoras === 0.40,
    `Tempo líquido de troca de lâmpadas deve ser 0.40h (24 min), recebido: ${resp.cadeiaExecucao.tempoLiquidoTotalHoras}`
  );
  assert(
    resp.cadeiaExecucao.valorMaoDeObraSugerido === 108.00,
    `Mão de obra deve ser R$ 108,00 (0.40h x R$ 270,00), recebido: ${resp.cadeiaExecucao.valorMaoDeObraSugerido}`
  );
  assert(
    resp.cadeiaExecucao.steps.length === 4,
    `Grafo de acesso de iluminação deve conter 4 etapas, recebido: ${resp.cadeiaExecucao.steps.length}`
  );

  // 1.5 Balão Executivo
  const baloes = composeTemparioExecutiveBalloon(resp);
  const textoBalao = baloes.join('\n\n');
  console.log('--- Balão Executivo Oficial ---');
  console.log(textoBalao);

  assert(textoBalao.includes('HYDRA | Tempário Técnico & Mão de Obra'), 'Deve conter cabeçalho oficial do tempário');
  assert(textoBalao.includes('0,40h (24 min)'), 'Deve conter tempo líquido formatado de 0,40h (24 min)');
  assert(textoBalao.includes('R$ 108,00'), 'Deve conter valor total de R$ 108,00');
  assert(!textoBalao.includes('Não informado / Pendente'), 'NUNCA deve conter "Não informado / Pendente"');
  assert(textoBalao.includes('1️⃣ *Peças necessárias*'), 'Deve conter opção 1');
  assert(textoBalao.includes('2️⃣ *Ferramentas de bancada e torques*'), 'Deve conter opção 2');
  assert(textoBalao.includes('3️⃣ *Passo a passo da montagem*'), 'Deve conter opção 3');
  assert(textoBalao.includes('4️⃣ *Tudo completo*'), 'Deve conter opção 4');

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 2: Progressive Disclosure — Seleção de Opção 3 (Passo a Passo)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Cenário 2] Testando seleção de Opção 3 (Passo a Passo)...');
  const baloesPassos = composeTemparioDetailBalloon('PASSOS', resp);
  const textoPassos = baloesPassos.join('\n\n');
  console.log('--- Balão Opção 3 ---');
  console.log(textoPassos);

  assert(textoPassos.includes('HYDRA | Sequência Técnica de Execução'), 'Deve conter cabeçalho da sequência técnica');
  assert(textoPassos.includes('3 Nm'), 'Deve conter torque especificado de 3 Nm nos fixadores');
  assert(textoPassos.includes('Chave Torx T20'), 'Deve conter ferramentas de bancada (Torx T20)');
  assert(textoPassos.includes('4. Remontagem'), 'Deve conter etapa 4 de remontagem e teste funcional');

  // ───────────────────────────────────────────────────────────────────────────
  // CENÁRIO 3: Variantes de Iluminação Rápida (Dianteira vs Traseira)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Cenário 3] Testando variantes de iluminação rápida...');

  // 3.1 Lâmpada de farol dianteiro (Onix 2021)
  const qOnix = 'trocar lampada do farol onix 2021';
  assert(isTemparioTechnicalQuery(qOnix), 'Troca de lâmpada do farol deve ser tempário');
  const respOnix = await coordinator.coordinateQuery({
    rawQuery: qOnix,
    veiculoMarcaModelo: 'Chevrolet Onix',
    ano: 2021,
    servicosSolicitados: ['trocar lampada do farol'],
    securityContext: { persona: 'socio' as const, authorizedLojaSlug: 'rede' }
  });
  assert(respOnix.cadeiaExecucao.tempoLiquidoTotalHoras === 0.40, 'Lâmpada do farol dianteiro deve ser 0.40h');
  assert(respOnix.cadeiaExecucao.valorMaoDeObraSugerido === 108.00, 'Lâmpada do farol deve ser R$ 108,00');

  // 3.2 Farol Dianteiro Completo (Golf 2020) — Não deve ser rebaixado para lâmpada
  const qGolf = 'troca de farol dianteiro golf 2020';
  assert(isTemparioTechnicalQuery(qGolf), 'Troca de farol dianteiro deve ser tempário');
  const respGolf = await coordinator.coordinateQuery({
    rawQuery: qGolf,
    veiculoMarcaModelo: 'Volkswagen Golf',
    ano: 2020,
    servicosSolicitados: ['troca de farol dianteiro'],
    securityContext: { persona: 'socio' as const, authorizedLojaSlug: 'rede' }
  });
  assert(
    respGolf.cadeiaExecucao.tempoLiquidoTotalHoras >= 1.00 && respGolf.cadeiaExecucao.tempoLiquidoTotalHoras <= 1.60,
    `Substituição do conjunto óptico completo com para-choque deve ser entre 1.00h e 1.60h, recebido: ${respGolf.cadeiaExecucao.tempoLiquidoTotalHoras}`
  );
  assert(
    respGolf.cadeiaExecucao.valorMaoDeObraSugerido >= 270.00,
    `Mão de obra do farol dianteiro completo deve ser >= R$ 270,00, recebido: ${respGolf.cadeiaExecucao.valorMaoDeObraSugerido}`
  );

  console.log('\n✅ TODOS OS TESTES DA SPEC 068 PASSARAM COM 100% DE SUCESSO!');
}

runSuite().catch(err => {
  console.error('\n❌ ERRO NA EXECUÇÃO DO TEST HARNESS SPEC 068:', err);
  process.exit(1);
});
