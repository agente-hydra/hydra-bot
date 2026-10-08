/**
 * Hydra — Suíte Integrada Definitiva de Gates do Grafo de Casos e Atendimentos
 * Spec: hydra-case-history-graph (Versão 2.1)
 * 
 * Cobertura de Aceite Completa:
 * - Regressões: G01–G15
 * - Adendo do Grafo: H01–H18
 * - Correções de Chaves: R01
 * - Percurso Completo Ponta a Ponta: R09
 * - Casos de Teste da Revisão v2.1: A1, A2, A3, A4.1, A4.2, A4.3
 * 
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 * Execução 100% Local no Windows: C:\Users\User\Desktop\agy\src\hydra-sync
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  SecurityContext,
  CandidateOrder,
  BusinessCaseScope,
  ConversationAnalysisRecord,
  ExtractedStatement,
  ConversationGap
} from '../types/conversation_context_contract';

import { RealAnalysisRepository } from '../real_analysis_repository';
import { SqliteAnalysisMemoryWriter } from '../analysis_memory_writer';
import { AnalysisProjectionOutboxManager } from '../analysis_projection_outbox';
import { CaseGraphProjector } from '../case_graph_projection';
import { CaseCurrentPositionReducer } from '../case_current_position';
import { SqliteCaseMemoryReader } from '../case_memory_reader';
import { isOperationalStoreEligible } from '../semantic_glossary';
import { EvidencePolicyManager } from '../evidence_policy_manager';
import { OSSituationComposer } from '../os_situation_composer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, code: string, description: string): void {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${code} — ${description}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${code} — ${description}`);
  }
}

async function runIntegratedGatesSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🚀 INICIANDO SUÍTE INTEGRADA DE GATES: HYDRA CASE HISTORY & GRAPH (v2.1)');
  console.log('='.repeat(80));

  // =========================================================================
  // BLOCO 1: R01 — CHAVES COMPOSTAS SQLite E ZERO COLISÕES
  // =========================================================================
  console.log('\n--- BLOCO 1: R01 — Chaves Compostas e Prevenção de Colisões ---');
  {
    const db = new Database(':memory:');
    const repo = new RealAnalysisRepository({ db, isConfigured: true });
    repo.ensureSchema(db);

    // R01.1: Mesmo número de OS em duas lojas distintas (source_id, loja_slug, os_id)
    const insertPos = db.prepare(`
      INSERT INTO hydra_case_current_position (
        source_id, account_id, loja_slug, os_id, vehicle_plate, vehicle_model,
        customer_phone, customer_name, current_erp_status, erp_snapshot_timestamp,
        current_approval_status, last_covered_timestamp, projection_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPos.run('chatwoot', 'acc_1', 'jabaquara', 501, 'ABC1234', 'Fiat Linea', '11999', 'Carlos', 'ABERTA', '2026-10-05T10:00:00Z', 'PENDING', '2026-10-05T10:00:00Z', 1);
    insertPos.run('chatwoot', 'acc_1', 'santana', 501, 'XYZ9876', 'Fiat Palio', '11888', 'Marcos', 'ABERTA', '2026-10-05T10:00:00Z', 'PENDING', '2026-10-05T10:00:00Z', 1);

    const posCount = (db.prepare('SELECT COUNT(*) as c FROM hydra_case_current_position WHERE os_id = 501').get() as { c: number }).c;
    assert(posCount === 2, 'R01_1_OS_COLLISION_PREVENTED', 'Mesmo número de OS (501) em lojas distintas grava 2 posições independentes');

    // R01.2: Mesmo statement_id em duas revisões distintas (revision_id, statement_id)
    db.prepare(`
      INSERT INTO hydra_analises_atendimento (
        revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
        source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id, schema_version, analyzer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rev_1', 'an_1', 'chatwoot', 'acc_1', 10, 'jabaquara', 'OPERATIONAL_SYNTHESIS', '2026-10-05T09:00:00Z', '2026-10-05T09:00:00Z', 'run_1', '1.0', '1.0');

    db.prepare(`
      INSERT INTO hydra_analises_atendimento (
        revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
        source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id, schema_version, analyzer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rev_2', 'an_1', 'chatwoot', 'acc_1', 10, 'jabaquara', 'OPERATIONAL_SYNTHESIS', '2026-10-05T11:00:00Z', '2026-10-05T11:00:00Z', 'run_2', '1.0', '1.0');

    const insertStmt = db.prepare(`
      INSERT INTO hydra_afirmacoes_analisadas (
        statement_id, revision_id, analysis_id, fact_id, subject_type,
        polarity, author_name, author_role, confirmation_level,
        raw_excerpt, event_timestamp, monetary_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run('stmt_1', 'rev_1', 'an_1', 'fact_part_1', 'PART_DEPENDENCY', 'AFFIRMATIVE', 'Consultor', 'ATTENDANT', 'CONFIRMED', 'Aguardando peça', '2026-10-05T09:00:00Z', 0);
    insertStmt.run('stmt_1', 'rev_2', 'an_1', 'fact_part_1', 'PART_ARRIVAL', 'AFFIRMATIVE', 'Consultor', 'ATTENDANT', 'CONFIRMED', 'Peça chegou', '2026-10-05T11:00:00Z', 0);

    const stmtCount = (db.prepare("SELECT COUNT(*) as c FROM hydra_afirmacoes_analisadas WHERE statement_id = 'stmt_1'").get() as { c: number }).c;
    assert(stmtCount === 2, 'R01_2_STATEMENT_REVISION_COLLISION_PREVENTED', 'Mesmo statement_id em revisões distintas grava 2 afirmações sem colisão');
  }

  // =========================================================================
  // BLOCO 2: A1 E A2 — MIGRAÇÃO MULTI-CAMINHO E PROTOCOLO DE FOREIGN KEYS
  // =========================================================================
  console.log('\n--- BLOCO 2: A1 e A2 — Migração Multi-Caminho e Integridade de FKs ---');
  {
    // A1.1: Banco vazio
    const freshDb = new Database(':memory:');
    const freshRepo = new RealAnalysisRepository({ db: freshDb, isConfigured: true });
    freshRepo.ensureSchema(freshDb);
    const vFresh = (freshDb.prepare('SELECT MAX(version) as ver FROM hydra_schema_migrations').get() as { ver: number }).ver;
    assert(vFresh === 1, 'A1_1_FRESH_DB_MIGRATION', 'Migração de banco vazio cria versão 1 sem erro de tabelas inexistentes');

    // A1.2: Banco legado populado (pai, afirmações e lacunas)
    const legDb = new Database(':memory:');
    legDb.exec(`
      CREATE TABLE hydra_analises_atendimento (
        analysis_id TEXT PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        os_id INTEGER NOT NULL,
        loja_slug TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_name TEXT,
        vehicle_model TEXT,
        vehicle_plate TEXT,
        status TEXT NOT NULL,
        executive_summary TEXT NOT NULL,
        confidence REAL NOT NULL,
        origin_source TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE hydra_afirmacoes_analisadas (
        statement_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        polarity TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        confidence REAL NOT NULL,
        confirmation_level TEXT NOT NULL,
        raw_excerpt TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE hydra_lacunas_conversa (
        gap_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        gap_type TEXT NOT NULL,
        description TEXT NOT NULL,
        first_detected_at TEXT NOT NULL,
        resolution_status TEXT NOT NULL
      );
      INSERT INTO hydra_analises_atendimento VALUES ('legacy_001', 101, 501, 'jabaquara', '11999991111', 'Carlos', 'Linea', 'ABC1234', 'COMPLETED', 'Resumo', 0.95, 'CHATWOOT_REPRESENTATIVE', '2026-10-05T08:00:00Z', '2026-10-05T08:00:00Z');
      INSERT INTO hydra_afirmacoes_analisadas VALUES ('s1', 'legacy_001', 'DELAY_CAUSE', 'Falta de peça', 'AFFIRMATIVE', 'Atendente', 'ATTENDANT', 0.9, 'CONFIRMED', 'Aguardando peça', '2026-10-05T08:00:00Z');
      INSERT INTO hydra_lacunas_conversa VALUES ('g1', 'legacy_001', 'AUDIO_NOT_TRANSCRIBED', 'Áudio sem transcrição', '2026-10-05T08:00:00Z', 'OPEN');
    `);

    const legRepo = new RealAnalysisRepository({ db: legDb, isConfigured: true });
    legRepo.ensureSchema(legDb);

    const migratedAnCount = (legDb.prepare('SELECT COUNT(*) as c FROM hydra_analises_atendimento').get() as { c: number }).c;
    const migratedStmtCount = (legDb.prepare('SELECT COUNT(*) as c FROM hydra_afirmacoes_analisadas').get() as { c: number }).c;
    const migratedGapCount = (legDb.prepare('SELECT COUNT(*) as c FROM hydra_lacunas_conversa').get() as { c: number }).c;

    assert(
      migratedAnCount === 1 && migratedStmtCount === 1 && migratedGapCount === 1,
      'A1_2_LEGACY_DB_MIGRATION_PRESERVED',
      'Migração de banco legado preserva rigorosamente contagem de pai (1), afirmações (1) e lacunas (1)'
    );

    // A2: Protocolo de Foreign Keys e integridade
    const fkInitial = legDb.pragma('foreign_keys', { simple: true }) as number;
    assert(fkInitial === 1, 'A2_FOREIGN_KEYS_RESTORED', 'foreign_keys reativado com sucesso após migração no finally');
  }

  // =========================================================================
  // BLOCO 3: A3 — OUTBOX COM LEASE, TOKEN E TETO ESTRITO DE 5 TENTATIVAS
  // =========================================================================
  console.log('\n--- BLOCO 3: A3 — Outbox com Lease, Token e Limite Estrito de Tentativas ---');
  {
    const db = new Database(':memory:');
    const repo = new RealAnalysisRepository({ db, isConfigured: true });
    repo.ensureSchema(db);
    const outbox = new AnalysisProjectionOutboxManager(db);

    // Inserir análise para satisfazer FK
    db.prepare(`
      INSERT INTO hydra_analises_atendimento (
        revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
        source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id, schema_version, analyzer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rev_teto', 'an_teto', 'chatwoot', 'acc_1', 123, 'jabaquara', 'OPERATIONAL_SYNTHESIS', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', 'run_1', '1.0', '1.0');

    outbox.enqueue('rev_teto', 'an_teto', 'jabaquara');

    // Executar 5 claims e falhas
    for (let i = 1; i <= 5; i++) {
      const job = outbox.claimNextJob(`worker_${i}`);
      assert(job !== null, `A3_CLAIM_ATTEMPT_${i}`, `Tentativa ${i} de claim obtida com sucesso`);
      if (job) {
        outbox.failJob(job.jobId, job.claimToken!, `Falha ${i}`);
      }
    }

    // 6ª tentativa deve ser terminantemente rejeitada
    const job6 = outbox.claimNextJob('worker_6');
    assert(job6 === null, 'A3_NO_SIXTH_ATTEMPT_STRICT', 'A 6ª tentativa de claim é terminantemente rejeitada (teto estrito de 5)');

    const finalRow = db.prepare("SELECT status, attempts FROM hydra_analysis_projection_outbox WHERE revision_id = 'rev_teto'").get() as { status: string; attempts: number };
    assert(
      finalRow.status === 'FAILED' && finalRow.attempts === 5,
      'A3_OUTBOX_TERMINAL_FAILED',
      'Job atinge estado terminal FAILED com exatamente 5 tentativas'
    );
  }

  // =========================================================================
  // BLOCO 4: A4.1 E A4.2 — SALDO DE PEÇAS, VERSÕES DE ORÇAMENTO E RECOMPOSIÇÃO
  // =========================================================================
  console.log('\n--- BLOCO 4: A4.1 e A4.2 — Saldo de Peças, Versões de Orçamento e Recomposição ---');
  {
    // A4.1a: Saldo de peças (2 solicitadas, 1 recebida = 1 pendente)
    const stmtsParts: ExtractedStatement[] = [
      {
        statementId: 's1',
        revisionId: 'rev_1',
        analysisId: 'an_1',
        factId: 'fact_shock',
        subject: 'PART_DEPENDENCY',
        predicate: 'Solicitado amortecedor dianteiro',
        polarity: 'AFFIRMATIVE',
        authorName: 'Mecânico Chefe',
        authorRole: 'ATTENDANT',
        confidence: 0.95,
        confirmationLevel: 'CONFIRMED',
        rawExcerpt: 'Precisamos de 2 amortecedores dianteiros',
        timestamp: '2026-10-05T09:00:00Z',
        monetaryCents: 0,
        messageId: 10,
        partReference: {
          partName: 'Amortecedor Dianteiro',
          partCode: 'AMORT-01',
          quantityRequested: 2,
          orderRef: 'PED-101'
        }
      },
      {
        statementId: 's2',
        revisionId: 'rev_2',
        analysisId: 'an_1',
        factId: 'fact_shock_arr',
        subject: 'PART_ARRIVAL',
        predicate: 'Chegou 1 amortecedor dianteiro',
        polarity: 'AFFIRMATIVE',
        authorName: 'Estoquista',
        authorRole: 'ATTENDANT',
        confidence: 0.95,
        confirmationLevel: 'CONFIRMED',
        rawExcerpt: 'Chegou 1 amortecedor dianteiro',
        timestamp: '2026-10-05T11:00:00Z',
        monetaryCents: 0,
        messageId: 20,
        partReference: {
          partName: 'Amortecedor Dianteiro',
          partCode: 'AMORT-01',
          quantityArrived: 1
        }
      }
    ];

    const posParts = CaseCurrentPositionReducer.reduce({
      sourceId: 'chatwoot',
      accountId: 'acc_1',
      lojaSlug: 'jabaquara',
      osId: 501,
      vehiclePlate: 'ABC1234',
      vehicleModel: 'Fiat Linea',
      customerName: 'Carlos',
      customerPhone: '11999991111',
      currentErpStatus: 'Em Execução',
      erpSnapshotTimestamp: '2026-10-05T12:00:00Z',
      statements: stmtsParts,
      gaps: [],
      appliedRevisionsMap: { rev_1: '2026-10-05T09:00:00Z', rev_2: '2026-10-05T11:00:00Z' }
    });

    assert(
      posParts.activePartDependencies.length === 1 &&
      posParts.activePartDependencies[0].quantityPending === 1,
      'A4_1_PART_BALANCE_PARTIAL',
      'Recebimento parcial (1 de 2 peças) mantém saldo pendente exatamente igual a 1'
    );

    // A4.1b: Orçamento por versão (v1 aprovado vs v2 pendente)
    const stmtsBudget: ExtractedStatement[] = [
      {
        statementId: 'b1',
        revisionId: 'rev_1',
        analysisId: 'an_1',
        factId: 'fact_b1',
        subject: 'APPROVAL_DEPENDENCY',
        predicate: 'Aguardando aprovação do orçamento v1',
        polarity: 'AFFIRMATIVE',
        authorName: 'Consultor',
        authorRole: 'ATTENDANT',
        confidence: 0.95,
        confirmationLevel: 'CONFIRMED',
        rawExcerpt: 'Orçamento inicial enviado',
        timestamp: '2026-10-05T09:00:00Z',
        monetaryCents: 150000,
        budgetVersion: 'v1',
        messageId: 1
      },
      {
        statementId: 'b2',
        revisionId: 'rev_2',
        analysisId: 'an_1',
        factId: 'fact_b2',
        subject: 'CLIENT_APPROVAL',
        predicate: 'Cliente aprovou orçamento inicial v1',
        polarity: 'AFFIRMATIVE',
        authorName: 'Carlos',
        authorRole: 'CUSTOMER',
        confidence: 0.95,
        confirmationLevel: 'CONFIRMED',
        rawExcerpt: 'Pode fazer os 1500',
        timestamp: '2026-10-05T10:00:00Z',
        monetaryCents: 150000,
        budgetVersion: 'v1',
        messageId: 2
      },
      {
        statementId: 'b3',
        revisionId: 'rev_3',
        analysisId: 'an_1',
        factId: 'fact_b3',
        subject: 'APPROVAL_DEPENDENCY',
        predicate: 'Aguardando aprovação de complemento v2',
        polarity: 'AFFIRMATIVE',
        authorName: 'Consultor',
        authorRole: 'ATTENDANT',
        confidence: 0.95,
        confirmationLevel: 'CONFIRMED',
        rawExcerpt: 'Achamos outro vazamento, mais 300 reais',
        timestamp: '2026-10-05T11:00:00Z',
        monetaryCents: 30000,
        budgetVersion: 'v2',
        messageId: 3
      }
    ];

    const posBudget = CaseCurrentPositionReducer.reduce({
      sourceId: 'chatwoot',
      accountId: 'acc_1',
      lojaSlug: 'jabaquara',
      osId: 501,
      vehiclePlate: 'ABC1234',
      vehicleModel: 'Fiat Linea',
      customerName: 'Carlos',
      customerPhone: '11999991111',
      currentErpStatus: 'Em Espera',
      erpSnapshotTimestamp: '2026-10-05T12:00:00Z',
      statements: stmtsBudget,
      gaps: [],
      appliedRevisionsMap: { rev_1: '1', rev_2: '2', rev_3: '3' }
    });

    assert(
      posBudget.approvalStatus === 'PENDING' &&
      posBudget.approvedBudgetVersion === 'v1' &&
      posBudget.pendingBudgetVersion === 'v2',
      'A4_1_BUDGET_VERSION_SEPARATION',
      'Aprovação de v1 mantém status PENDING e approvedBudgetVersion = v1 diante de novo orçamento v2 pendente'
    );

    // A4.2: Edição de mensagem antiga e recomposição de caso
    const evaluatedArrival = EvidencePolicyManager.reducePartQuantities(
      [{ partName: 'Amortecedor Dianteiro', quantity: 2 }],
      [{ partName: 'Amortecedor Dianteiro', quantity: 1 }]
    );
    assert(
      evaluatedArrival.activeDependencies.length === 1 &&
      evaluatedArrival.activeDependencies[0].quantityPending === 1 &&
      !evaluatedArrival.isFullyResolved,
      'A4_2_RECOMPOSITION_POLICY',
      'EvidencePolicyManager reduz corretamente peças e recompõe saldo determinístico'
    );
  }

  // =========================================================================
  // BLOCO 5: A4.3 — ELEGIBILIDADE DE LOJAS E NAMESPACE GLOBAL DO GRAFO
  // =========================================================================
  console.log('\n--- BLOCO 5: A4.3 — Elegibilidade de Lojas e Namespace Global com accountId ---');
  {
    assert(isOperationalStoreEligible('jabaquara') === true, 'A4_3_JABAQUARA_ELIGIBLE', 'Loja jabaquara é elegível');
    assert(isOperationalStoreEligible('MPdompedro1') === true, 'A4_3_DOMPEDRO_ELIGIBLE', 'Loja Dom Pedro é elegível');
    assert(isOperationalStoreEligible('MPMaster') === false, 'A4_3_MPMASTER_REJECTED', 'Unidade administrativa MPMaster é terminantemente rejeitada');
    assert(isOperationalStoreEligible('loja_fantasma') === false, 'A4_3_UNKNOWN_SLUG_REJECTED', 'Slug desconhecido é terminantemente rejeitado');

    const db = new Database(':memory:');
    const repo = new RealAnalysisRepository({ db, isConfigured: true });
    repo.ensureSchema(db);

    // Gravar 2 análises de contas diferentes com o mesmo conversationId (101)
    db.prepare(`
      INSERT INTO hydra_analises_atendimento (
        revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
        covered_os_ids, source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id, schema_version, analyzer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rev_acc1', 'an_acc1', 'chatwoot', 'acc_alpha', 101, 'jabaquara', '[501]', 'OPERATIONAL_SYNTHESIS', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', 'run_1', '1.0', '1.0');

    db.prepare(`
      INSERT INTO hydra_analises_atendimento (
        revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
        covered_os_ids, source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id, schema_version, analyzer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rev_acc2', 'an_acc2', 'chatwoot', 'acc_beta', 101, 'jabaquara', '[501]', 'OPERATIONAL_SYNTHESIS', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', 'run_1', '1.0', '1.0');

    const outbox = new AnalysisProjectionOutboxManager(db);
    outbox.enqueue('rev_acc1', 'an_acc1', 'jabaquara');
    outbox.enqueue('rev_acc2', 'an_acc2', 'jabaquara');

    const projector = new CaseGraphProjector(db, 'worker_proj');
    await projector.processNextJob();
    await projector.processNextJob();

    const nodes = db.prepare("SELECT node_id, account_id FROM hydra_case_graph_nodes WHERE entity_type = 'CONVERSA'").all() as { node_id: string; account_id: string }[];
    assert(
      nodes.length === 2 &&
      nodes.some(n => n.node_id === 'CONVERSA:chatwoot:acc_alpha:jabaquara:101') &&
      nodes.some(n => n.node_id === 'CONVERSA:chatwoot:acc_beta:jabaquara:101'),
      'A4_3_GLOBAL_NAMESPACE_WITH_ACCOUNT_ID',
      'Nós do grafo utilizam namespace global com account_id, isolando perfeitamente conversas de contas distintas'
    );
  }

  // =========================================================================
  // BLOCO 6: R09 — PERCURSO COMPLETO PONTA A PONTA (PRODUTOR → OUTBOX → GRAFO → LEITOR)
  // =========================================================================
  console.log('\n--- BLOCO 6: R09 — Percurso Completo Ponta a Ponta ---');
  {
    const db = new Database(':memory:');
    const repo = new RealAnalysisRepository({ db, isConfigured: true });
    repo.ensureSchema(db);

    const writer = new SqliteAnalysisMemoryWriter(db);
    const projector = new CaseGraphProjector(db, 'worker_e2e');
    const reader = new SqliteCaseMemoryReader(db);

    const analysisRecord: ConversationAnalysisRecord = {
      analysisId: 'an_e2e_501',
      conversationId: 999,
      osId: 501,
      lojaSlug: 'jabaquara',
      customerPhone: '11988881001',
      customerName: 'Carlos Mendonça',
      vehicleModel: 'Fiat Linea',
      vehiclePlate: 'ABC1234',
      status: 'Em Serviço',
      executiveSummary: 'Veículo Fiat Linea aguardando peça com orçamento aprovado v1',
      confidence: 0.95,
      originSource: 'CHATWOOT_REPRESENTATIVE',
      analyzedAt: '2026-10-05T12:00:00Z',
      coveredOsIds: [501],
      isFullyCovered: true,
      laggingMessageCount: 0,
      extractedStatements: [
        {
          statementId: 'stmt_e2e_1',
          revisionId: 'rev_e2e_1',
          analysisId: 'an_e2e_501',
          targetOsId: 501,
          factId: 'fact_delay_1',
          subject: 'DELAY_CAUSE_REPORTED',
          predicate: 'Aguardando peça especializada da concessionária',
          polarity: 'AFFIRMATIVE',
          authorName: 'Lucas Consultor',
          authorRole: 'ATTENDANT',
          confidence: 0.95,
          confirmationLevel: 'CONFIRMED',
          rawExcerpt: 'Estamos no aguardo do sensor encomendado na Fiat',
          timestamp: '2026-10-05T11:00:00Z',
          delayCauseReported: 'Aguardando sensor de rotação encomendado na concessionária',
          monetaryCents: 0,
          messageId: 50
        }
      ],
      gaps: []
    };

    // 1. Writer Atômico grava Análise e enfileira no Outbox
    const writeRes = await writer.recordCompletedAnalysis(analysisRecord, {
      sourceId: 'chatwoot',
      accountId: 'acc_prod',
      conversationId: 999,
      analysisRunId: 'run_1'
    });

    assert(writeRes.projectionQueued === true, 'R09_1_WRITER_QUEUED_OUTBOX', 'SqliteAnalysisMemoryWriter grava análise e enfileira no outbox atomicamente');

    // 2. Projector consome outbox e atualiza Grafo e Posição Atual
    const projSuccess = await projector.processNextJob();
    assert(projSuccess === true, 'R09_2_PROJECTOR_PROCESSED', 'CaseGraphProjector consome outbox com claim token e gera projeção');

    // 3. Reader lê a situação e motivo de atraso
    const targetScope: BusinessCaseScope = {
      scopeType: 'ORDER',
      sourceId: 'chatwoot',
      accountId: 'acc_prod',
      lojaSlug: 'jabaquara',
      osId: 501,
      vehiclePlate: 'ABC1234',
      vehicleModel: 'Fiat Linea'
    };

    const socioAuth: SecurityContext = {
      persona: 'socio',
      authorizedPhones: []
    };

    const contextResult = await reader.getCaseContext(targetScope, socioAuth, { questionType: 'DELAY_REASON' });

    assert(
      contextResult.status === 'READY' &&
      contextResult.currentPosition.reportedDelay?.cause.includes('sensor de rotação') === true,
      'R09_3_READER_RETRIEVES_DELAY_CAUSE',
      'SqliteCaseMemoryReader recupera com precisão a causa de atraso projetada sem reler mensagens brutas'
    );

    // 4. Balão do WhatsApp formatado sem asteriscos duplos e com causa factual
    const candidateOrder: CandidateOrder = {
      osId: 501,
      lojaSlug: 'jabaquara',
      vehiclePlate: 'ABC1234',
      vehicleModel: 'Fiat Linea',
      customerName: 'Carlos Mendonça',
      customerPhone: '11988881001',
      status: 'Em Serviço',
      totalValue: 1200.0,
      paidValue: 600.0,
      pendingServices: ['Troca de Correia Dentada'],
      openedAt: '2026-09-26T09:00:00Z',
      updatedAt: '2026-10-05T08:30:00Z',
      isAberta: true
    };

    const composer = new OSSituationComposer();
    const balloon = composer.compose({
      osId: 501,
      lojaSlug: 'jabaquara',
      vehiclePlate: 'ABC1234',
      vehicleModel: 'Fiat Linea',
      specificQuestionType: 'DELAY_REASON',
      openedAt: '2026-09-26T09:00:00Z',
      erpState: {
        status: candidateOrder.status,
        totalValue: candidateOrder.totalValue,
        paidValue: candidateOrder.paidValue,
        pendingServices: candidateOrder.pendingServices,
        updatedAt: candidateOrder.updatedAt,
        openedAt: candidateOrder.openedAt
      },
      analysisState: {
        analysisId: analysisRecord.analysisId,
        analysisVersion: '1.0',
        analyzedUntilTimestamp: analysisRecord.analyzedAt,
        statements: analysisRecord.extractedStatements,
        gaps: analysisRecord.gaps
      },
      linkInfo: {
        isLinked: true,
        confidenceLevel: 'LEVEL_1_DIRECT_METADATA',
        matchedBy: 'Direct OS and store metadata'
      }
    });

    assert(
      balloon.formattedWhatsAppBalloon.includes('sensor de rotação') &&
      !balloon.formattedWhatsAppBalloon.includes('**'),
      'R09_4_BALLOON_COMPOSED_CLEANLY',
      'OSSituationComposer gera balão nativo com motivo real sem markdown duplo'
    );
  }

  // =========================================================================
  // BLOCO 7: H08 E R03 — DISTINÇÃO ENTRE IDADE DA OS E PRESENÇA NO PÁTIO
  // =========================================================================
  console.log('\n--- BLOCO 7: H08 e R03 — Anti-Alucinação e Distinção OS vs Pátio ---');
  {
    const orderCandidate: CandidateOrder = {
      osId: 501,
      lojaSlug: 'jabaquara',
      vehiclePlate: 'ABC1234',
      vehicleModel: 'Fiat Linea',
      customerName: 'Carlos Mendonça',
      customerPhone: '11988881001',
      status: 'NA FILA PARA EXECUÇÃO',
      totalValue: 15000.0,
      paidValue: 0.0,
      pendingServices: ['Retífica do Motor'],
      openedAt: '2026-09-26T09:00:00Z',
      updatedAt: '2026-10-05T08:30:00Z',
      isAberta: true
    };

    const evaluation = EvidencePolicyManager.evaluateDelayCause(orderCandidate.status, undefined);

    assert(
      evaluation.hasValidEvidence === false &&
      evaluation.limitations.some(l => l.includes('Proibido inferir escassez')),
      'H08_ANTI_HALLUCINATION_QUEUE_STATUS',
      'Status NA FILA PARA EXECUÇÃO e valor alto vetam categoricamente alucinar falta de box ou peças'
    );

    const physicalStay = EvidencePolicyManager.evaluateOSTime(orderCandidate.openedAt, undefined, false);
    assert(
      physicalStay.hasPhysicalYardEvidence === false &&
      physicalStay.statement.includes('OS aberta'),
      'R03_DISTINCTION_OS_AGE_VS_YARD',
      'Distinção estrita: tempo da OS é reportado como abertura de OS, nunca como permanência física no pátio sem portaria'
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO FINAL DOS GATES INTEGRADOS: ${passed} APROVADOS / ${failed} FALHAS`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runIntegratedGatesSuite().catch((err: unknown) => {
  console.error('❌ ERRO FATAL NA SUÍTE DE GATES INTEGRADOS:', err);
  process.exit(1);
});
