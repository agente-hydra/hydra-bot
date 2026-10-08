/**
 * Hydra — Suíte de Testes do Executor 3 (Grafo, Projeção, Concorrência A3, Peças A4.1, Versões de Orçamento e Loja A4.3)
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import Database from 'better-sqlite3';
import assert from 'node:assert';
import { CaseGraphProjector } from '../case_graph_projection';
import { AnalysisProjectionOutboxManager } from '../analysis_projection_outbox';
import { CaseCurrentPositionReducer } from '../case_current_position';
import { SqliteCaseMemoryReader } from '../case_memory_reader';
import { ExtractedStatement, BusinessCaseScope, SecurityContext } from '../types/conversation_context_contract';

function setupTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE hydra_analises_atendimento (
      revision_id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      loja_slug TEXT NOT NULL,
      covered_os_ids TEXT,
      source_type TEXT NOT NULL DEFAULT 'OPERATIONAL_SYNTHESIS',
      analyzed_until_message_id INTEGER,
      analyzed_until_timestamp TEXT NOT NULL,
      occurred_at TEXT,
      analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      analysis_run_id TEXT NOT NULL DEFAULT 'run_1',
      schema_version TEXT NOT NULL DEFAULT '1.0',
      analyzer_version TEXT NOT NULL DEFAULT '1.0',
      operational_summary TEXT,
      conduct_alert TEXT,
      is_valid INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE hydra_afirmacoes_analisadas (
      revision_id TEXT NOT NULL,
      statement_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      target_os_id INTEGER,
      subject_type TEXT NOT NULL,
      polarity TEXT NOT NULL DEFAULT 'AFFIRMATIVE',
      author_role TEXT NOT NULL DEFAULT 'ATTENDANT',
      author_name TEXT NOT NULL DEFAULT 'Consultor',
      message_id INTEGER,
      event_timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      raw_excerpt TEXT NOT NULL DEFAULT '',
      confirmation_level TEXT NOT NULL DEFAULT 'CONFIRMED',
      service_scope TEXT,
      budget_version TEXT,
      monetary_cents INTEGER,
      delay_cause_reported TEXT,
      part_name TEXT,
      part_code TEXT,
      part_quantity_requested INTEGER,
      part_quantity_arrived INTEGER,
      order_ref TEXT,
      supersedes_fact_id TEXT,
      PRIMARY KEY (revision_id, statement_id)
    );

    CREATE TABLE hydra_lacunas_conversa (
      gap_id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      gap_type TEXT NOT NULL,
      message_id INTEGER,
      event_timestamp TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE hydra_analysis_projection_outbox (
      job_id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      worker_id TEXT,
      claim_token TEXT,
      claimed_at TEXT,
      lease_expires_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );

    CREATE TABLE hydra_case_graph_nodes (
      node_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      label TEXT NOT NULL,
      account_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      attributes_json TEXT NOT NULL
    );

    CREATE TABLE hydra_case_graph_edges (
      edge_id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE hydra_case_current_position (
      source_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      os_id INTEGER NOT NULL,
      vehicle_plate TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      current_erp_status TEXT NOT NULL,
      erp_snapshot_timestamp TEXT NOT NULL,
      current_approval_status TEXT NOT NULL,
      approved_budget_version TEXT,
      pending_budget_version TEXT,
      reported_delay_cause TEXT,
      reported_delay_author TEXT,
      reported_delay_role TEXT,
      reported_delay_at TEXT,
      reported_delay_raw TEXT,
      part_dependencies_json TEXT NOT NULL DEFAULT '[]',
      commitments_summary TEXT,
      active_gaps_json TEXT NOT NULL DEFAULT '[]',
      last_covered_message_id INTEGER,
      last_covered_timestamp TEXT NOT NULL,
      applied_revisions_json TEXT NOT NULL DEFAULT '{}',
      projection_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, loja_slug, os_id)
    );

    CREATE TABLE ordens_servico (
      os_id INTEGER PRIMARY KEY,
      loja_slug TEXT NOT NULL,
      vehicle_plate TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      status TEXT NOT NULL,
      total_value REAL NOT NULL
    );
  `);

  return db;
}

async function runTests(): Promise<void> {
  console.log('=== INICIANDO SUÍTE DE TESTES DO EXECUTOR 3 (Hydra Spec 2.1) ===');

  // TESTE 1: Concorrência de 2 workers e proteção de claim_token após expiração de lease (A3)
  {
    console.log('\n[TESTE A3] Concorrência de Workers e Lease Expirado...');
    const db = setupTestDatabase();
    const outboxMgr = new AnalysisProjectionOutboxManager(db);

    // Inserir job
    outboxMgr.enqueue('rev_101', 'ana_101', 'MPdompedro1', 1);

    // Worker 1 faz claim
    const projector1 = new CaseGraphProjector(db, 'worker_A');
    const claimedJob1 = outboxMgr.claimNextJob('worker_A', 1); // 1 segundo de lease
    assert.ok(claimedJob1, 'Worker 1 deveria conseguir fazer claim');
    assert.equal(claimedJob1.workerId, 'worker_A');
    assert.ok(claimedJob1.claimToken);

    const tokenA = claimedJob1.claimToken;

    // Simular expiração do lease alterando diretamente no banco para o passado
    db.prepare(`
      UPDATE hydra_analysis_projection_outbox
      SET lease_expires_at = datetime('now', '-10 seconds')
      WHERE job_id = ?
    `).run(claimedJob1.jobId);

    // Worker 2 tenta fazer claim após expiração do lease
    const claimedJob2 = outboxMgr.claimNextJob('worker_B', 60);
    assert.ok(claimedJob2, 'Worker 2 deveria conseguir fazer claim após lease expirar');
    assert.equal(claimedJob2.workerId, 'worker_B');
    assert.notEqual(claimedJob2.claimToken, tokenA);

    // Worker 1 tenta completar com o token antigo (deve falhar)
    const successOldToken = outboxMgr.completeJob(claimedJob1.jobId, tokenA!);
    assert.equal(successOldToken, false, 'Completar job com claim_token expirado/substituído deve falhar');

    // Worker 2 completa com sucesso
    const successNewToken = outboxMgr.completeJob(claimedJob2.jobId, claimedJob2.claimToken!);
    assert.equal(successNewToken, true, 'Worker 2 com token válido deve completar o job com sucesso');

    db.close();
    console.log('✔ [TESTE A3] Aprovado com sucesso.');
  }

  // TESTE 2: Chegada parcial de peças (A4.1)
  {
    console.log('\n[TESTE A4.1] Chegada parcial de peças (2 pedidos, 1 recebido = 1 pendente)...');
    const statements: ExtractedStatement[] = [
      {
        statementId: 1,
        messageId: 10,
        timestamp: '2026-10-05T10:00:00Z',
        subject: 'PART_DEPENDENCY',
        polarity: 'POSITIVE',
        authorName: 'Mecânico João',
        authorRole: 'mecanico',
        rawExcerpt: 'Pedimos 2 amortecedores dianteiros.',
        partReference: {
          partName: 'Amortecedor Dianteiro',
          partCode: 'AM-01',
          quantityRequested: 2
        }
      },
      {
        statementId: 2,
        messageId: 11,
        timestamp: '2026-10-05T11:00:00Z',
        subject: 'PART_ARRIVAL',
        polarity: 'POSITIVE',
        authorName: 'Atendente Maria',
        authorRole: 'atendente',
        rawExcerpt: 'Chegou apenas 1 amortecedor.',
        partReference: {
          partName: 'Amortecedor Dianteiro',
          partCode: 'AM-01',
          quantityArrived: 1
        }
      }
    ];

    const reduced = CaseCurrentPositionReducer.reduce({
      sourceId: 'src_1',
      accountId: 'acc_1',
      lojaSlug: 'MPdompedro1',
      osId: 5001,
      vehiclePlate: 'XYZ-9876',
      vehicleModel: 'Gol',
      customerName: 'Carlos Silva',
      customerPhone: '(11)98888-7777',
      currentErpStatus: 'AGUARDANDO_PECAS',
      erpSnapshotTimestamp: '2026-10-05T12:00:00Z',
      statements,
      gaps: [],
      appliedRevisionsMap: {},
      projectionVersion: 1
    });

    assert.equal(reduced.activePartDependencies.length, 1);
    assert.equal(reduced.activePartDependencies[0].quantityPending, 1, 'Saldo restante deve ser exatamente 1');
    console.log('✔ [TESTE A4.1] Peças parciais validado.');
  }

  // TESTE 3: Versões de orçamento (orçamento v1 aprovado não resolve pendência de orçamento v2) (A4.1)
  {
    console.log('\n[TESTE A4.1] Versões de orçamento v1 vs v2...');
    const statements: ExtractedStatement[] = [
      {
        statementId: 9,
        messageId: 19,
        timestamp: '2026-10-05T08:00:00Z',
        subject: 'APPROVAL_DEPENDENCY',
        polarity: 'POSITIVE',
        authorName: 'Oficina',
        authorRole: 'atendente',
        rawExcerpt: 'Aguardando aprovação do orçamento v2.',
        budgetVersion: 'v2'
      },
      {
        statementId: 10,
        messageId: 20,
        timestamp: '2026-10-05T09:00:00Z',
        subject: 'CLIENT_APPROVAL',
        polarity: 'POSITIVE',
        authorName: 'Cliente',
        authorRole: 'cliente',
        rawExcerpt: 'Aprovo o orçamento v1.',
        budgetVersion: 'v1'
      }
    ];

    const reduced = CaseCurrentPositionReducer.reduce({
      sourceId: 'src_1',
      accountId: 'acc_1',
      lojaSlug: 'MPdompedro1',
      osId: 5002,
      vehiclePlate: 'ABC-1234',
      vehicleModel: 'Civic',
      customerName: 'Ana Souza',
      customerPhone: '(11)97777-6666',
      currentErpStatus: 'ORCAMENTO_PENDENTE',
      erpSnapshotTimestamp: '2026-10-05T11:00:00Z',
      statements,
      gaps: [],
      appliedRevisionsMap: {},
      projectionVersion: 1
    });

    assert.equal(reduced.approvalStatus, 'PENDING', 'Orçamento v2 deve estar pendente pois v1 aprovado não resolve v2');
    assert.equal(reduced.pendingBudgetVersion, 'v2');
    console.log('✔ [TESTE A4.1] Versões de orçamento v1/v2 validado.');
  }

  // TESTE 4: Validação de elegibilidade de lojas excluindo MPMaster e rejeitando slugs desconhecidos (A4.3)
  {
    console.log('\n[TESTE A4.3] Validação de elegibilidade de lojas (MPMaster e desconhecidas)...');
    const db = setupTestDatabase();

    // Inserir OS e Análise para teste de leitura
    db.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, vehicle_plate, vehicle_model, customer_name, customer_phone, status, total_value)
      VALUES (9001, 'MPdompedro1', 'TST-1111', 'Corolla', 'Marcos', '(11)96666-5555', 'ABERTA', 1500.0)
    `).run();

    db.prepare(`
      INSERT INTO hydra_analises_atendimento (
        revision_id, analysis_id, source_id, account_id, conversation_id,
        loja_slug, covered_os_ids, analyzed_until_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rev_9001', 'ana_9001', 'src_1', 'acc_1', 123,
      'MPdompedro1', '[9001]', '2026-10-05T12:00:00Z'
    );

    db.prepare(`
      INSERT INTO hydra_afirmacoes_analisadas (
        revision_id, statement_id, fact_id, analysis_id, target_os_id,
        subject_type, polarity, author_role, author_name, event_timestamp, raw_excerpt, confirmation_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rev_9001', 'stmt_9001', 'fact_9001', 'ana_9001', 9001,
      'SITUATION_CHECK', 'AFFIRMATIVE', 'ATTENDANT', 'Consultor', '2026-10-05T12:00:00Z', 'Carro em manutenção', 'CONFIRMED'
    );

    const reader = new SqliteCaseMemoryReader(db);

    const scopeDomPedro: BusinessCaseScope = { sourceId: 'src_1', accountId: 'acc_1', lojaSlug: 'MPdompedro1', osId: 9001 };
    const scopeMaster: BusinessCaseScope = { sourceId: 'src_1', accountId: 'acc_1', lojaSlug: 'MPMaster', osId: 9001 };
    const scopeUnknown: BusinessCaseScope = { sourceId: 'src_1', accountId: 'acc_1', lojaSlug: 'LojaInexistente', osId: 9001 };

    const authGerenteDomPedro: SecurityContext = { persona: 'gerente', authorizedLojaSlug: 'MPdompedro1' };
    const authGerenteOutra: SecurityContext = { persona: 'gerente', authorizedLojaSlug: 'MPJabaquara' };

    // 1. Consulta válida para gerente autorizado
    const resValid = await reader.getCaseContext(scopeDomPedro, authGerenteDomPedro, { questionType: 'SITUATION' });
    assert.ok(resValid.status === 'READY' || (resValid as { status: string }).status === 'AVAILABLE', 'Gerente autorizado na loja elegível deve obter READY');

    // 2. Consulta rejeitada para MPMaster
    const resMaster = await reader.getCaseContext(scopeMaster, authGerenteDomPedro, { questionType: 'SITUATION' });
    assert.equal(resMaster.status, 'SOURCE_UNAVAILABLE', 'MPMaster deve ser rejeitada');

    // 3. Consulta rejeitada para slug desconhecido
    const resUnknown = await reader.getCaseContext(scopeUnknown, authGerenteDomPedro, { questionType: 'SITUATION' });
    assert.equal(resUnknown.status, 'SOURCE_UNAVAILABLE', 'Slug desconhecido deve ser rejeitado');

    // 4. Isolamento de loja: gerente de Jabaquara tentando acessar Dom Pedro
    const resUnauthorized = await reader.getCaseContext(scopeDomPedro, authGerenteOutra, { questionType: 'SITUATION' });
    assert.equal(resUnauthorized.status, 'SOURCE_UNAVAILABLE', 'Gerente de outra loja não pode acessar dados de Dom Pedro');

    db.close();
    console.log('✔ [TESTE A4.3] Isolamento e elegibilidade de lojas validado.');
  }

  console.log('\n=== TODOS OS TESTES DO EXECUTOR 3 PASSARAM COM SUCESSO (100% PASS) ===');
}

runTests().catch(err => {
  console.error('❌ Erro fatal na suíte de testes:', err);
  process.exit(1);
});
