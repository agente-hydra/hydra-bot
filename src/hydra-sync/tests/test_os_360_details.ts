/**
 * src/hydra-sync/tests/test_os_360_details.ts
 * Suíte de Testes do Raio-X e Detalhes 360° da OS com Peças e Grafo de Atendimento Integrados
 * Spec: hydra-os-360-full-details
 */

import Database from 'better-sqlite3';
import { dispatchMessage } from '../agent_dispatcher.js';
import { initSchema } from '../db_repository.js';
import { ensureCaseAnalysisTables, saveGraphProjection } from '../real_analysis_repository.js';
import { assertNoDoubleAsterisks } from '../format_utils.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, id: string, desc: string): void {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${id} — ${desc}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${id} — ${desc}`);
  }
}

async function runTests(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🚀 INICIANDO SUÍTE INTEGRADA: RAIO-X 360° DA OS COM PEÇAS E GRAFO');
  console.log('='.repeat(80));

  const db = new Database(':memory:');
  initSchema(db);
  ensureCaseAnalysisTables(db);

  // 1. Cadastra Usuário Sócio Autorizado
  db.prepare(`
    INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active)
    VALUES ('5511999999999', 'Davi Sócio', 'socio', '["*"]', 1)
  `).run();

  // 2. Cadastra a Loja ReiDoModulo
  db.prepare(`
    INSERT OR REPLACE INTO lojas (slug, nome, ativa)
    VALUES ('reidomodulo', 'Rei do Módulo', 1)
  `).run();

  // 3. Cadastra a OS Real #1916 (HB20)
  // Valor Total: R$ 1.600,00 | Serviços: R$ 130,00 | Saldo em Peças/Bancada: R$ 1.470,00
  const rawPayload1916 = JSON.stringify({
    servicos: [
      { descricao: 'REPROGRAMAÇAO MODULO', valorTotal: 130, executor: 'RAPHAEL' }
    ],
    pecas: [],
    valorTotal: 1600,
    valorPago: 0,
    saldoDevedor: 1600
  });

  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, tipo, status_grid, is_aberta,
      data_inicio, data_inicio_iso, dias_no_patio, veiculo, placa,
      cliente_nome, responsavel, total_os, valor_pago, valor_restante,
      tem_nf, raw_payload
    ) VALUES (
      '1916', 'reidomodulo', 'OS', 'ABERTO', 1,
      '2026-10-06T08:00:00Z', '2026-10-06T08:00:00Z', 2, 'HB20 1,6 16V', 'PET7D45',
      'ERIC FERREIRA DE BARROS', 'RAPHAEL', 1600.0, 0.0, 1600.0,
      0, ?
    )
  `).run(rawPayload1916);

  // 4. Cadastra a Projeção de Grafo da OS #1916
  saveGraphProjection(db, {
    projectionId: 'proj_reidomodulo_1916',
    lojaSlug: 'reidomodulo',
    coveredOsIds: ['1916'],
    documentedDelayReason: 'Reparo avançado de bancada em módulo de injeção sem sinal financeiro registrado.',
    nextPromisedStep: 'Solicitar sinal financeiro antes da liberação do módulo reparado.',
    isValid: true,
    isIntact: true,
    lastObservationDate: '2026-10-08T09:00:00Z',
    createdAt: '2026-10-08T09:00:00Z',
    updatedAt: '2026-10-08T09:00:00Z'
  });

  // --- GATE 1: Detalhes da OS #1916 com Peças e Conciliação Financeira Completa ---
  console.log('\n--- GATE 1: Resolução de Detalhes da OS com Serviços e Peças ---');
  const res1 = await dispatchMessage({ db, phone: '5511999999999', message: 'detalhes da os 1916', skipIdempotencyCheck: true });
  const txt1 = res1.replyText;

  assert(
    txt1.includes('1916') &&
    txt1.includes('HB20') &&
    txt1.includes('REPROGRAMAÇAO MODULO') &&
    txt1.includes('130,00') &&
    txt1.includes('1.470,00') &&
    txt1.includes('1.600,00'),
    'GATE_1_OS_1916_FULL_FINANCIAL_COMPOSITION',
    'OS 1916 exibe tanto os serviços (R$ 130) quanto as peças/bancada (R$ 1.470), fechando o total de R$ 1.600'
  );

  // --- GATE 2: Tolerância a Typos no WhatsApp ("taio x da os 1916 por facor") ---
  console.log('\n--- GATE 2: Tolerância a Typos de Raio-X ---');
  const res2 = await dispatchMessage({ db, phone: '5511999999999', message: 'nao, taio x da os 1916 por facor', skipIdempotencyCheck: true });
  const txt2 = res2.replyText;

  assert(
    txt2.includes('1916') &&
    txt2.includes('1.600,00') &&
    txt2.includes('Serviços Discriminados') &&
    txt2.includes('Peças e Materiais'),
    'GATE_2_TYPO_TOLERANCE_RAIO_X',
    'Mensagem com typo "taio x" é perfeitamente interpretada como Raio-X 360° da OS'
  );

  // --- GATE 3: Integração Mandatória do Grafo (caseCtx) no Detalhamento ---
  console.log('\n--- GATE 3: Integração do Grafo de Atendimento ---');
  assert(
    txt1.includes('Situação e Atendimento') &&
    txt1.includes('Reparo avançado de bancada') &&
    txt1.includes('Solicitar sinal financeiro'),
    'GATE_3_GRAPH_CONTEXT_INCLUDED_IN_DETAILS',
    'Raio-X e detalhes da OS incluem o motivo operacional e próximo passo do Grafo de Atendimento'
  );

  // --- GATE 4: OS com Peças Discriminadas Individuais no ERP ---
  console.log('\n--- GATE 4: OS com Peças Físicas Individuais ---');
  const rawPayload1921 = JSON.stringify({
    servicos: [
      { descricao: 'Troca de Óleo e Filtros', valorTotal: 150, executor: 'CARLOS' }
    ],
    pecas: [
      { descricao: 'Filtro de Óleo Motor', qtd: 1, valorTotal: 50, codigo: 'FO-123' },
      { descricao: 'Óleo Sintético 5W30', qtd: 4, valorTotal: 200, codigo: 'OL-5W30' }
    ],
    valorTotal: 400,
    valorPago: 0,
    saldoDevedor: 400
  });

  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, tipo, status_grid, is_aberta,
      data_inicio, data_inicio_iso, dias_no_patio, veiculo, placa,
      cliente_nome, responsavel, total_os, valor_pago, valor_restante,
      tem_nf, raw_payload
    ) VALUES (
      '1921', 'reidomodulo', 'OS', 'ABERTO', 1,
      '2026-10-07T08:00:00Z', '2026-10-07T08:00:00Z', 1, 'ONIX 1.0 TURBO', 'ONX1020',
      'MARCOS LIMA', 'CARLOS', 400.0, 0.0, 400.0,
      0, ?
    )
  `).run(rawPayload1921);

  const res4 = await dispatchMessage({ db, phone: '5511999999999', message: 'raio x da os 1921', skipIdempotencyCheck: true });
  const txt4 = res4.replyText;

  assert(
    txt4.includes('Filtro de Óleo Motor') &&
    txt4.includes('Óleo Sintético 5W30') &&
    txt4.includes('FO-123') &&
    txt4.includes('400,00'),
    'GATE_4_INDIVIDUAL_PARTS_DISCRIMINATED',
    'OS 1921 discrimina individualmente as peças cadastradas com quantidade e código'
  );

  // --- GATE 5: Sanitização WhatsApp e Zero Asteriscos Duplos ---
  console.log('\n--- GATE 5: Sanitização WhatsApp Nativa ---');
  let cleanMarkdown = true;
  try {
    assertNoDoubleAsterisks(txt1);
    assertNoDoubleAsterisks(txt2);
    assertNoDoubleAsterisks(txt4);
  } catch {
    cleanMarkdown = false;
  }

  assert(
    cleanMarkdown && !txt1.includes('\u00A0') && !txt2.includes('\u00A0'),
    'GATE_5_WHATSAPP_NATIVE_FORMAT_COMPLIANCE',
    'Todas as respostas respeitam estritamente formatação nativa WhatsApp sem asteriscos duplos e sem NBSP'
  );

  console.log('='.repeat(80));
  if (failed === 0) {
    console.log(`🎉 TODOS OS ${passed} GATES DO RAIO-X 360° PASSARAM COM 100% DE SUCESSO!`);
  } else {
    console.error(`❌ RESULTADO: ${passed} APROVADOS / ${failed} FALHAS`);
    process.exit(1);
  }
  console.log('='.repeat(80));
}

runTests().catch(err => {
  console.error('Erro fatal ao rodar testes:', err);
  process.exit(1);
});
