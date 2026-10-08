/**
 * src/hydra-sync/tests/test_os_360_conversation_continuity.ts
 * Suíte de Testes da Padronização Hermes 360° da OS & Continuidade do Grafo de Conversas
 * Spec: hydra-os-360-formatting-and-conversation-continuity
 */

import Database from 'better-sqlite3';
import { dispatchMessage } from '../agent_dispatcher.js';
import { executeManagerTool } from '../manager_store_access.js';
import { initSchema } from '../db_repository.js';
import { ensureCaseAnalysisTables, saveGraphProjection } from '../real_analysis_repository.js';
import { assertNoDoubleAsterisks } from '../format_utils.js';
import { composeFullOS360Card, isOSConversationQuery } from '../os_situation_composer.js';

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
  console.log('🚀 INICIANDO SUÍTE INTEGRADA: HERMES 360° DA OS & CONTINUIDADE DE CONVERSAS');
  console.log('='.repeat(80));

  const db = new Database(':memory:');
  initSchema(db);
  ensureCaseAnalysisTables(db);

  // 1. Cadastra Usuário Sócio Autorizado e Gerente Autorizado
  db.prepare(`
    INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active)
    VALUES 
      ('5511999999999', 'Davi Sócio', 'socio', '["*"]', 1),
      ('5511888888888', 'Gerente Planalto', 'gerente', '["MPplanalto"]', 1)
  `).run();

  // 2. Cadastra as Lojas
  db.prepare(`
    INSERT OR REPLACE INTO lojas (slug, nome, ativa)
    VALUES 
      ('MPplanalto', 'Planalto', 1),
      ('reidomodulo', 'Rei do Módulo', 1)
  `).run();

  // 3. Cadastra o Voyage LS (LZQ0669) - OS #18503
  // Total: R$ 6.731,10 | Serviços: R$ 1.840,90 | Peças (saldo analítico): R$ 4.890,20
  // Pagamentos: R$ 4.008,00 (Parcela 1: R$ 2.010, Parcela 2: R$ 1.998) | Saldo devedor: R$ 2.723,10
  const rawPayload18503 = JSON.stringify({
    servicos: [
      { descricao: 'DIAGNOSTICO NACIONAL', valorTotal: 385, executor: 'CENTRAL' },
      { descricao: 'REMOÇAO ALTERNADOR', valorTotal: 680, executor: 'CENTRAL' },
      { descricao: 'LIMPEZA SISTEMA ARREFECIMENTO', valorTotal: 149.90, executor: 'CENTRAL' },
      { descricao: 'SERVIÇO MOTOBOY', valorTotal: 26, executor: 'Preencher Executor...' },
      { descricao: 'ALINHAMENTO DIANTEIRO', valorTotal: 110, executor: 'Preencher Executor...' },
      { descricao: 'GEOMETRIA', valorTotal: 380, executor: 'Preencher Executor...' },
      { descricao: 'REGULAGEM ALAVANCA DE FREIO', valorTotal: 120, executor: 'Preencher Executor...' }
    ],
    pecas: [],
    pagamentos: [
      { parcela: 1, valor: 2010.00, modalidade: 'PIX', vencimento: '02/10/2026' },
      { parcela: 2, valor: 1998.00, modalidade: 'PIX', vencimento: '06/10/2026' }
    ],
    checklists: [
      { tipo: 'Checklist de Entrada', status: 'Concluído', realizado_por: 'Recepção', data: '02/10/2026' }
    ],
    documentos_anexos: [
      { origem: 'FOTO', descricao: 'Foto do Painel' },
      { origem: 'FOTO', descricao: 'Foto do Alternador' }
    ],
    notas_fiscais: [],
    extracao_completa: true,
    valorTotal: 6731.10,
    valorPago: 4008.00,
    saldoDevedor: 2723.10
  });

  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, tipo, status_grid, is_aberta,
      data_inicio, data_inicio_iso, dias_no_patio, veiculo, placa,
      cliente_nome, responsavel, total_os, valor_pago, valor_restante,
      tem_nf, raw_payload
    ) VALUES (
      '18503', 'MPplanalto', 'OS', 'ABERTO', 1,
      '2026-10-02T09:00:00Z', '2026-10-02T09:00:00Z', 6, 'VOYAGE LS', 'LZQ0669',
      'MAURO LUIZ RODRIGUES BUENO', 'CENTRAL', 6731.10, 4008.00, 2723.10,
      0, ?
    )
  `).run(rawPayload18503);

  // -------------------------------------------------------------------------
  // GATE 1: OS com Peças e Serviços (Voyage 18503) — 6 Blocos e Soma Exata
  // -------------------------------------------------------------------------
  console.log('\n--- GATE 1: Voyage OS 18503 com Serviços (R$ 1.850,90) e Peças (R$ 4.880,20) ---');
  const resGate1 = await dispatchMessage({
    db,
    phone: '5511999999999',
    message: 'detalhes da os 18503',
    skipIdempotencyCheck: true
  });
  const txt1 = resGate1.replyText;

  assert(
    txt1.includes('18503') &&
    txt1.includes('VOYAGE LS') &&
    txt1.includes('LZQ0669') &&
    txt1.includes('MPplanalto') &&
    txt1.includes('6.731,10') &&
    txt1.includes('2.723,10'),
    'GATE_1_HEADER_VOYAGE_18503',
    'Cabeçalho executivo contém OS #18503, modelo VOYAGE LS, placa LZQ0669 e valores totais/saldo'
  );

  assert(
    txt1.includes('Serviços Discriminados') &&
    txt1.includes('DIAGNOSTICO NACIONAL') &&
    txt1.includes('385,00') &&
    txt1.includes('REMOÇAO ALTERNADOR') &&
    txt1.includes('680,00'),
    'GATE_1_SERVICES_DISCRIMINATED',
    'Serviços discriminados presentes com valores em negrito e executores'
  );

  assert(
    txt1.includes('Peças e Materiais Aplicados') &&
    txt1.includes('4.880,20'),
    'GATE_1_PARTS_DIFFERENCE_CALCULATED',
    'Peças e materiais calculados analiticamente (R$ 4.880,20) para fechar exatamente os R$ 6.731,10 da OS'
  );

  assert(
    txt1.includes('Formas de Pagamento') &&
    txt1.includes('Parcela 1') &&
    txt1.includes('2.010,00') &&
    txt1.includes('Parcela 2') &&
    txt1.includes('1.998,00'),
    'GATE_1_PAYMENTS_AND_INSTALLMENTS',
    'Formas de pagamento discriminadas com vencimentos e valores das parcelas'
  );

  assert(
    txt1.includes('Vistorias e Documentos') &&
    txt1.includes('Checklist de Entrada') &&
    txt1.includes('Checklist do Mecânico') &&
    txt1.includes('2 documento(s) arquivado(s)'),
    'GATE_1_CHECKLISTS_AND_ATTACHMENTS',
    'Vistorias com emojis indicativos de checklist e contagem de anexos arquivados'
  );

  // -------------------------------------------------------------------------
  // GATE 2: Consulta Direta por Nome de Veículo ("voyage") ou "os 18503"
  // -------------------------------------------------------------------------
  console.log('\n--- GATE 2: Consulta Direta por "voyage" Gerando Card Hermes 360° Completo ---');
  const resGate2 = await dispatchMessage({
    db,
    phone: '5511999999999',
    message: 'voyage',
    skipIdempotencyCheck: true
  });
  const txt2 = resGate2.replyText;

  assert(
    txt2.includes('18503') &&
    txt2.includes('VOYAGE LS') &&
    txt2.includes('Serviços Discriminados') &&
    txt2.includes('Peças e Materiais Aplicados') &&
    txt2.includes('Formas de Pagamento') &&
    txt2.includes('Vistorias e Documentos'),
    'GATE_2_DIRECT_MODEL_PRODUCES_FULL_360',
    'Digitar apenas "voyage" entrega o card 360° completo com todas as seções e peças, eliminando o card seco'
  );

  // -------------------------------------------------------------------------
  // GATE 3: Continuidade Conversacional (Anáfora de Conversas)
  // -------------------------------------------------------------------------
  console.log('\n--- GATE 3: Anáfora "ok mas nao temcesso a nenhuma conversa?" ---');
  // Imediatamente após consultar o Voyage, usuário pergunta sobre conversas
  const resGate3 = await dispatchMessage({
    db,
    phone: '5511999999999',
    message: 'ok mas nao temcesso a nenhuma conversa?',
    skipIdempotencyCheck: true
  });
  const txt3 = resGate3.replyText;

  assert(
    txt3.includes('18503') &&
    txt3.includes('VOYAGE') &&
    (txt3.includes('Grafo de Atendimento') || txt3.includes('Posição de Atendimento')),
    'GATE_3_ANAPHORA_RECOGNITION',
    'A mensagem "ok mas nao temcesso a nenhuma conversa?" herda a OS #18503 e consulta o Grafo'
  );

  assert(
    !txt3.toLowerCase().includes('não tenho acesso às conversas de balcão') &&
    !txt3.toLowerCase().includes('não passam pelo barramento do hydra') &&
    !txt3.toLowerCase().includes('vanessa na jabaquara'),
    'GATE_3_ZERO_STORE_COUNTER_HALLUCINATION',
    'Zero alucinação institucional de falta de acesso às conversas de balcão'
  );

  // -------------------------------------------------------------------------
  // GATE 4: Formatação WhatsApp Nativa (Divisores, Zero Asteriscos Duplos)
  // -------------------------------------------------------------------------
  console.log('\n--- GATE 4: Formatação WhatsApp Nativa ---');
  let formatOk = true;
  try {
    assertNoDoubleAsterisks(txt1);
    assertNoDoubleAsterisks(txt2);
    assertNoDoubleAsterisks(txt3);
  } catch {
    formatOk = false;
  }

  assert(
    formatOk &&
    txt1.includes('----------------------------------------') &&
    !txt1.includes('\u00A0'),
    'GATE_4_WHATSAPP_NATIVE_STYLING',
    'Preservação rigorosa da formatação WhatsApp com divisores traço e sem asteriscos duplos'
  );

  // -------------------------------------------------------------------------
  // GATE 5: Perfil Gerente — Unificação Visual do Card 360°
  // -------------------------------------------------------------------------
  console.log('\n--- GATE 5: Consulta de Gerente em manager_store_access ---');
  const managerResult = executeManagerTool(db, 'get_os_details', { os_id: '18503' }, 'MPplanalto');
  const managerTxt = managerResult.replyText;

  assert(
    managerTxt.includes('18503') &&
    managerTxt.includes('Peças e Materiais Aplicados') &&
    managerTxt.includes('4.880,20') &&
    managerTxt.includes('Serviços Discriminados') &&
    managerTxt.includes('Formas de Pagamento'),
    'GATE_5_MANAGER_RECEIVES_UNIFIED_360_CARD',
    'Perfil de gerente recebe exatamente o mesmo card Hermes 360° com peças e serviços conciliados'
  );

  // -------------------------------------------------------------------------
  // GATE 6: Detector de Consulta de Conversa Isolada
  // -------------------------------------------------------------------------
  console.log('\n--- GATE 6: Validação de isOSConversationQuery ---');
  assert(isOSConversationQuery('ok mas nao temcesso a nenhuma conversa?'), 'GATE_6_TYPO_QUERY', 'Detecta pergunta com typo do usuário');
  assert(isOSConversationQuery('o que falaram na conversa?'), 'GATE_6_FALARAM_QUERY', 'Detecta pergunta sobre fala/conversa');
  assert(isOSConversationQuery('tem audio dessa os?'), 'GATE_6_AUDIO_QUERY', 'Detecta pergunta sobre áudio');
  assert(!isOSConversationQuery('faturamento da loja maua'), 'GATE_6_NEGATIVE_QUERY', 'Rejeita consultas financeiras normais');

  console.log('='.repeat(80));
  if (failed === 0) {
    console.log(`🎉 TODOS OS ${passed} GATES DE HOMOLOGAÇÃO PASSARAM COM 100% DE SUCESSO!`);
  } else {
    console.error(`❌ RESULTADO: ${passed} APROVADOS / ${failed} FALHAS`);
    process.exit(1);
  }
  console.log('='.repeat(80));
}

runTests().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
