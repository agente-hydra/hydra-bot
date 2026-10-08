/**
 * src/hydra-sync/tests/test_agent_graph_search.ts
 * Suíte Integrada de Testes de Busca de Grafo & Presença Contínua
 * Spec: hydra-graph-agent-integration
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import Database from 'better-sqlite3';
import assert from 'assert';
import { PresenceHeartbeatKeeper, PresenceSender } from '../presence_heartbeat.js';
import { initSchema, getOSDetails } from '../db_repository.js';
import { getCaseContext } from '../hybrid_os_coordinator.js';
import { resolveCaseContextByOs, buildCaseOperationalSummary } from '../case_memory_reader.js';
import { saveGraphProjection, findGraphProjectionForOs } from '../real_analysis_repository.js';
import type { CandidateOrder } from '../types/conversation_context_contract.js';

async function runAgentGraphSearchSuite(): Promise<void> {
  console.log('================================================================================');
  console.log('🚀 INICIANDO SUÍTE INTEGRADA: GRAFO NAS BUSCAS & PRESENÇA WHATSAPP');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // GATE 1: Presença Contínua ("Digitando..." Anti-Flap)
  // ---------------------------------------------------------------------------
  console.log('--- GATE 1: Presença Contínua WhatsApp (PresenceHeartbeatKeeper) ---');
  {
    const keeper = PresenceHeartbeatKeeper.getInstance();
    const calls: { phone: string; presence: string; delayMs?: number }[] = [];

    const mockSender: PresenceSender = {
      async sendPresence(phone, presence, delayMs) {
        calls.push({ phone, presence, delayMs });
      }
    };

    const testPhone = '5511999998888';
    keeper.start(testPhone, mockSender, 30, 500);

    assert.strictEqual(keeper.isPhoneActive(testPhone), true, 'Keeper deve estar ativo imediatamente após start');
    assert.strictEqual(calls.length, 1, 'Deve realizar disparo imediato no start');
    assert.strictEqual(calls[0].presence, 'composing');

    // Aguarda pulsos periódicos
    await new Promise(r => setTimeout(r, 80));
    assert(calls.length >= 2, `Deve ter acumulado pulsos periódicos (obtido: ${calls.length})`);

    // Encerramento limpo
    keeper.stop(testPhone);
    assert.strictEqual(keeper.isPhoneActive(testPhone), false, 'Keeper deve estar inativo após stop');

    const countAtStop = calls.length;
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(calls.length, countAtStop, 'Nenhum pulso adicional deve ocorrer após stop');

    console.log(`✅ [PASS] GATE_1_PRESENCE_HEARTBEAT — ${calls.length} pulsos contínuos mantidos e encerrados de forma limpa`);
  }

  // ---------------------------------------------------------------------------
  // SETUP DO BANCO SQLITE EM MEMÓRIA
  // ---------------------------------------------------------------------------
  const db = new Database(':memory:');
  initSchema(db);

  // Inserir lojas de teste
  db.prepare(`
    INSERT INTO lojas (slug, nome, ativa) VALUES 
    ('jabaquara', 'Unidade Jabaquara', 1),
    ('maua', 'Unidade Mauá', 1)
  `).run();

  // Inserir OS 501 no Jabaquara
  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, veiculo, placa, cliente_nome, status_grid,
      is_aberta, dias_no_patio, total_os, valor_restante, data_inicio,
      raw_payload
    ) VALUES (
      501, 'jabaquara', 'Fiat Linea', 'ABC1234', 'Carlos Mendonça', 'EM ANDAMENTO',
      1, 4, 2500.00, 1200.00, '2026-10-03T09:00:00Z',
      '{"servicos":[{"descricao":"Revisão de Injeção","valorTotal":1500,"executor":"Mecânico João"}]}'
    )
  `).run();

  // Salvar Projeção de Grafo para OS 501
  saveGraphProjection(db, {
    projectionId: 'proj_501_v1',
    lojaSlug: 'jabaquara',
    coveredOsIds: ['501'],
    documentedDelayReason: 'Aguardando sensor de rotação da concessionária',
    nextPromisedStep: 'Montagem prevista para amanhã às 14h',
    isValid: true,
    isIntact: true,
    lastObservationDate: '2026-10-05T12:00:00Z',
    createdAt: '2026-10-05T12:00:00Z',
    updatedAt: '2026-10-05T12:00:00Z'
  });

  // ---------------------------------------------------------------------------
  // GATE 2: Fast-Path Integrado com o Grafo (getCaseContext)
  // ---------------------------------------------------------------------------
  console.log('\n--- GATE 2: Fast-Path Integrado ao Grafo de Atendimentos ---');
  {
    const order501: CandidateOrder = {
      osId: '501',
      storeSlug: 'jabaquara',
      plate: 'ABC1234',
      vehicleModel: 'Fiat Linea',
      clientName: 'Carlos Mendonça',
      statusGrid: 'EM ANDAMENTO',
      isOpen: true,
      daysInYard: 4,
      totalAmount: 2500.00,
      remainingBalance: 1200.00,
      openedAt: '2026-10-03T09:00:00Z'
    };

    const caseCtx = getCaseContext(db, order501);

    assert.strictEqual(caseCtx.coverage, 'FULL', 'Cobertura do caso deve ser FULL diante de projeção válida');
    assert.strictEqual(caseCtx.evidenceOrigin, 'GRAPH_PROJECTION', 'Origem da evidência deve ser GRAPH_PROJECTION');
    assert(
      caseCtx.documentedDelayReason?.includes('sensor de rotação') === true,
      'Motivo documentado deve conter a menção ao sensor de rotação'
    );
    assert.strictEqual(caseCtx.nextPromisedStep, 'Montagem prevista para amanhã às 14h');
    assert.strictEqual(caseCtx.isLimitationDeclared, false, 'Não deve declarar limitação quando houver motivo');

    console.log('✅ [PASS] GATE_2_FAST_PATH_GRAPH — getCaseContext recupera motivo e compromisso da projeção do grafo');
  }

  // ---------------------------------------------------------------------------
  // GATE 3: Ferramenta MCP get_os_case_history & Resumo Operacional
  // ---------------------------------------------------------------------------
  console.log('\n--- GATE 3: Resolução de Grafo por OS (resolveCaseContextByOs & Formatação) ---');
  {
    const caseCtx = resolveCaseContextByOs(db, 'jabaquara', '501');
    assert(caseCtx !== null, 'resolveCaseContextByOs deve encontrar a OS 501');
    assert.strictEqual(caseCtx.order.osId, '501');
    assert.strictEqual(caseCtx.evidenceOrigin, 'GRAPH_PROJECTION');

    const formattedSummary = buildCaseOperationalSummary(caseCtx);
    assert(formattedSummary.includes('OS #501 — Fiat Linea (ABC1234)'), 'Deve conter cabeçalho com placa');
    assert(formattedSummary.includes('Aguardando sensor de rotação'), 'Deve expor motivo factual');
    assert(formattedSummary.includes('Montagem prevista para amanhã às 14h'), 'Deve expor próximo passo');
    assert(formattedSummary.includes('Projeção de Grafo'), 'Deve citar fonte');
    assert(!formattedSummary.includes('**'), 'PROIBIÇÃO ABSOLUTA de asteriscos duplos no WhatsApp Hermes');

    console.log('✅ [PASS] GATE_3_MCP_TOOL_PAYLOAD — Balão operacional formatado sem asteriscos duplos e com dados de grafo');
  }

  // ---------------------------------------------------------------------------
  // GATE 4: Retrocompatibilidade de get_os_details
  // ---------------------------------------------------------------------------
  console.log('\n--- GATE 4: Retrocompatibilidade e Detalhamento da OS ---');
  {
    const details = getOSDetails(db, { os_id: '501', loja_slug: 'jabaquara' });
    assert(details !== null, 'getOSDetails deve retornar a OS 501');
    assert.strictEqual(details.veiculo, 'Fiat Linea');
    assert(details.servicos && details.servicos.length > 0, 'Deve conter serviços discriminados do payload');

    console.log('✅ [PASS] GATE_4_RETROCOMPAT_OS_DETAILS — getOSDetails preserva estrutura íntegra');
  }

  // ---------------------------------------------------------------------------
  // GATE 5: Regra de Ouro Factual (OS Sem Análise Técnica)
  // ---------------------------------------------------------------------------
  console.log('\n--- GATE 5: Regra de Ouro Anti-Alucinação (OS sem Análise Documentada) ---');
  {
    // Inserir OS 502 sem projeção de grafo e sem motivo em raw_payload
    db.prepare(`
      INSERT INTO ordens_servico (
        os_id, loja_slug, veiculo, placa, cliente_nome, status_grid,
        is_aberta, dias_no_patio, total_os, valor_restante, data_inicio, raw_payload
      ) VALUES (
        502, 'jabaquara', 'Honda Civic', 'CIV1234', 'Mariana Souza', 'AGUARDANDO PEÇA',
        1, 6, 3000.00, 3000.00, '2026-10-01T10:00:00Z', '{}'
      )
    `).run();

    const order502: CandidateOrder = {
      osId: '502',
      storeSlug: 'jabaquara',
      plate: 'CIV1234',
      vehicleModel: 'Honda Civic',
      clientName: 'Mariana Souza',
      statusGrid: 'AGUARDANDO PEÇA',
      isOpen: true,
      daysInYard: 6,
      totalAmount: 3000.00,
      remainingBalance: 3000.00,
      openedAt: '2026-10-01T10:00:00Z'
    };

    const caseCtx502 = getCaseContext(db, order502);
    assert.strictEqual(caseCtx502.coverage, 'NOT_IN_ANALYSIS');
    assert.strictEqual(caseCtx502.evidenceOrigin, 'ERP_DIRECT');
    assert.strictEqual(caseCtx502.isLimitationDeclared, true, 'Deve declarar limitação factual honesta');
    assert.strictEqual(caseCtx502.documentedDelayReason, undefined, 'Proibido inventar motivo de demora');

    const formattedSummary502 = buildCaseOperationalSummary(caseCtx502);
    assert(formattedSummary502.includes('Não documentado na análise técnica da OS'));
    assert(formattedSummary502.includes('Sem registro oficial de falta de peças ou indisponibilidade de mecânico'));
    assert(!formattedSummary502.includes('**'));

    console.log('✅ [PASS] GATE_5_FACTUAL_LIMITATION — Declaração honesta sem inventar falta de peças ou mecânico');
  }

  // ---------------------------------------------------------------------------
  // GATE 6: Isolamento RBAC Cross-Store
  // ---------------------------------------------------------------------------
  console.log('\n--- GATE 6: Isolamento de Loja (Anti-Vazamento Cross-Store) ---');
  {
    // Tentativa de consultar a OS 501 (Jabaquara) apontando para loja Mauá
    const crossStoreProj = findGraphProjectionForOs(db, 'maua', '501');
    assert.strictEqual(crossStoreProj, null, 'Projeção de Jabaquara NUNCA pode ser retornada para a loja Mauá');

    const crossStoreCtx = resolveCaseContextByOs(db, 'maua', '501');
    assert.strictEqual(crossStoreCtx, null, 'Ordem de serviço de outra loja deve retornar null em resolveCaseContextByOs');

    console.log('✅ [PASS] GATE_6_RBAC_CROSS_STORE_ISOLATION — Bloqueio estrito de vazamento entre unidades distintas');
  }

  console.log('\n================================================================================');
  console.log('🎉 TODOS OS 6 GATES DA SUÍTE INTEGRADA PASSARAM COM 100% DE SUCESSO!');
  console.log('================================================================================\n');
}

runAgentGraphSearchSuite().catch(err => {
  console.error('❌ ERRO NA SUÍTE DE TESTES:', err);
  process.exit(1);
});
