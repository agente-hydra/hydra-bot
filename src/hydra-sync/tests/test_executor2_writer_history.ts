/**
 * Hydra — Teste Isolado do Executor 2: Migração Segura, Writer Atômico e Outbox
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 2 (Sessão 7b9923e9-f4d2-46ff-8a6b-ea932132e04d)
 * Stack: TypeScript Strict
 */

import assert from 'node:assert';
import Database from 'better-sqlite3';
import { RealAnalysisRepository } from '../real_analysis_repository';
import { SqliteAnalysisMemoryWriter } from '../analysis_memory_writer';
import { AnalysisProjectionOutboxManager } from '../analysis_projection_outbox';
import {
  ConversationAnalysisRecord,
  AnalysisRevisionIdentity
} from '../types/conversation_context_contract';

console.log('=== TESTES DO EXECUTOR 2: MIGRAÇÃO SEGURA, WRITER ATÔMICO E OUTBOX ===\n');

async function runExecutor2Tests() {

// ----------------------------------------------------------------------------
// Teste 1: Migração em Banco Vazio (A1)
// ----------------------------------------------------------------------------
console.log('Teste 1: Migração a partir de banco vazio (fresh install)...');
const emptyDb = new Database(':memory:');
const repoEmpty = new RealAnalysisRepository({ db: emptyDb });

assert.strictEqual(repoEmpty.isAvailable(), true);
const tablesEmpty = emptyDb.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[];
const tableNamesEmpty = new Set(tablesEmpty.map(t => t.name));

assert.ok(tableNamesEmpty.has('hydra_analises_atendimento'), 'Tabela de análises deve existir');
assert.ok(tableNamesEmpty.has('hydra_afirmacoes_analisadas'), 'Tabela de afirmações deve existir');
assert.ok(tableNamesEmpty.has('hydra_lacunas_conversa'), 'Tabela de lacunas deve existir');
assert.ok(tableNamesEmpty.has('hydra_analysis_projection_outbox'), 'Tabela de outbox deve existir');
assert.ok(tableNamesEmpty.has('hydra_case_current_position'), 'Tabela de posição atual deve existir');

// Valida integridade referencial
const fkCheckEmpty = emptyDb.pragma('foreign_key_check') as unknown[];
assert.strictEqual(fkCheckEmpty.length, 0, 'Zero violações de chave estrangeira');
console.log('✓ Teste 1 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 2: Migração a partir de Banco Legado com Dados (A1 e A2)
// ----------------------------------------------------------------------------
console.log('\nTeste 2: Migração a partir de banco legado populado (com análises, afirmações e lacunas)...');
const legacyDb = new Database(':memory:');

// 1. Criar o schema exatamente como era na v1 (sem revision_id e sem recorded_at)
legacyDb.pragma('foreign_keys = ON');
legacyDb.exec(`
  CREATE TABLE hydra_analises_atendimento (
    analysis_id TEXT PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    loja_slug TEXT NOT NULL,
    covered_os_ids TEXT NOT NULL,
    source_type TEXT NOT NULL,
    analyzed_until_message_id INTEGER NOT NULL,
    analyzed_until_timestamp TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    analysis_version TEXT NOT NULL,
    is_valid INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE hydra_afirmacoes_analisadas (
    statement_id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    target_os_id INTEGER NOT NULL,
    subject_type TEXT NOT NULL,
    polarity TEXT NOT NULL,
    author_role TEXT NOT NULL,
    author_name TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    event_timestamp TEXT NOT NULL,
    raw_excerpt TEXT NOT NULL,
    confirmation_level TEXT NOT NULL,
    service_scope TEXT,
    budget_version TEXT,
    monetary_value REAL,
    FOREIGN KEY (analysis_id) REFERENCES hydra_analises_atendimento(analysis_id) ON DELETE CASCADE
  );

  CREATE TABLE hydra_lacunas_conversa (
    gap_id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    gap_type TEXT NOT NULL,
    message_id INTEGER,
    event_timestamp TEXT NOT NULL,
    description TEXT NOT NULL,
    FOREIGN KEY (analysis_id) REFERENCES hydra_analises_atendimento(analysis_id) ON DELETE CASCADE
  );
`);

// 2. Inserir dados legados sintéticos
legacyDb.exec(`
  INSERT INTO hydra_analises_atendimento VALUES (
    'legacy_an_1', 1234, 'MPJabaquara', '[439]', 'OPERATIONAL_SYNTHESIS',
    50, '2026-09-23T11:00:00Z', '2026-09-23T11:05:00Z', '1.0', 1, '2026-09-23T11:05:00Z'
  );

  INSERT INTO hydra_afirmacoes_analisadas VALUES (
    'stmt_1', 'legacy_an_1', 439, 'CLIENT_APPROVAL', 'AFFIRMATIVE',
    'CLIENT', 'João', 45, '2026-09-23T10:45:00Z', 'Pode fazer',
    'EXPLICIT_CONFIRMED', 'Suspensão', 'v1', 1500.50
  );

  INSERT INTO hydra_lacunas_conversa VALUES (
    'gap_1', 'legacy_an_1', 1234, 'UNTRANSCRIBED_AUDIO', 42,
    '2026-09-23T10:30:00Z', 'Áudio de 15s'
  );
`);

// 3. Executar o repositório moderno que roda a migração
const repoLegacy = new RealAnalysisRepository({ db: legacyDb });
assert.strictEqual(repoLegacy.isAvailable(), true);

// 4. Validar preservação das contagens e conversão de chaves
const migratedAnalysis = legacyDb.prepare("SELECT * FROM hydra_analises_atendimento WHERE analysis_id = 'legacy_an_1'").get() as {
  revision_id: string;
  source_id: string;
  account_id: string;
  loja_slug: string;
};
assert.ok(migratedAnalysis, 'Análise legada deve existir');
assert.strictEqual(migratedAnalysis.revision_id, 'legacy:legacy_an_1');
assert.strictEqual(migratedAnalysis.loja_slug, 'MPJabaquara');

const migratedStmt = legacyDb.prepare("SELECT * FROM hydra_afirmacoes_analisadas WHERE statement_id = 'stmt_1'").get() as {
  revision_id: string;
  fact_id: string;
  monetary_cents: number;
};
assert.ok(migratedStmt, 'Afirmação legada deve existir');
assert.strictEqual(migratedStmt.revision_id, 'legacy:legacy_an_1');
assert.strictEqual(migratedStmt.fact_id, 'fact_stmt_1');
assert.strictEqual(migratedStmt.monetary_cents, 150050, 'Deve converter REAL para centavos inteiros (1500.50 -> 150050)');

const migratedGap = legacyDb.prepare("SELECT * FROM hydra_lacunas_conversa WHERE gap_id = 'gap_1'").get() as {
  revision_id: string;
};
assert.ok(migratedGap, 'Lacuna legada deve existir');
assert.strictEqual(migratedGap.revision_id, 'legacy:legacy_an_1');

// Integridade referencial após migração
const fkCheckLegacy = legacyDb.pragma('foreign_key_check') as unknown[];
assert.strictEqual(fkCheckLegacy.length, 0, 'Zero erros de FK após migração de legado');

// Estado das foreign keys deve ter sido restaurado para ON
const fkState = legacyDb.pragma('foreign_keys', { simple: true });
assert.strictEqual(fkState, 1, 'PRAGMA foreign_keys deve ter sido restaurado para ON fora da transação');
console.log('✓ Teste 2 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 3: Outbox Claim com Limite Estrito de Tentativas e Claim Token (A3)
// ----------------------------------------------------------------------------
console.log('\nTeste 3: Outbox Claim respeitando limite de tentativas e posse por token...');
const db = new Database(':memory:');
new RealAnalysisRepository({ db });
const outbox = new AnalysisProjectionOutboxManager(db);

// Inserir análise para satisfazer a FK de revision_id
db.prepare(`
  INSERT INTO hydra_analises_atendimento (
    revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
    source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id,
    schema_version, analyzer_version
  ) VALUES ('rev_test_1', 'an_test_1', 'chatwoot', 'acc1', 101, 'MPJabaquara', 'OPERATIONAL_SYNTHESIS', datetime('now'), datetime('now'), 'r1', '1.0', '1.0')
`).run();

const jobId = outbox.enqueue('rev_test_1', 'an_test_1', 'MPJabaquara');
assert.ok(jobId);

// Simular que o job já atingiu 5 tentativas (attempts = 5, max_attempts = 5)
db.prepare(`
  UPDATE hydra_analysis_projection_outbox
  SET attempts = 5, status = 'PROCESSING', lease_expires_at = datetime('now', '-10 seconds')
  WHERE job_id = ?
`).run(jobId);

// O worker tenta fazer claim do job expirado que já tem 5 tentativas
const claimed = outbox.claimNextJob('worker_1');
assert.strictEqual(claimed, null, 'NÃO pode conceder a 6ª tentativa');

// O job deve ter sido marcado como FAILED (estado terminal visível)
const failedJob = db.prepare('SELECT status, attempts FROM hydra_analysis_projection_outbox WHERE job_id = ?').get(jobId) as {
  status: string;
  attempts: number;
};
assert.strictEqual(failedJob.status, 'FAILED');
assert.strictEqual(failedJob.attempts, 5, 'Número de tentativas deve permanecer congelado em 5');
console.log('✓ Teste 3 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 4: Claim Token e Posse Exclusiva do Worker (A3)
// ----------------------------------------------------------------------------
console.log('\nTeste 4: Claim Token previne confirmação após expiração de lease...');
db.prepare(`
  INSERT INTO hydra_analises_atendimento (
    revision_id, analysis_id, source_id, account_id, conversation_id, loja_slug,
    source_type, analyzed_until_timestamp, analyzed_at, analysis_run_id,
    schema_version, analyzer_version
  ) VALUES ('rev_test_2', 'an_test_2', 'chatwoot', 'acc1', 102, 'MPJabaquara', 'OPERATIONAL_SYNTHESIS', datetime('now'), datetime('now'), 'r2', '1.0', '1.0')
`).run();

const job2Id = outbox.enqueue('rev_test_2', 'an_test_2', 'MPJabaquara');

// Worker A pega o job
const claimA = outbox.claimNextJob('worker_A', 1); // 1 segundo de lease
assert.ok(claimA);
assert.strictEqual(claimA.workerId, 'worker_A');
const tokenA = claimA.claimToken!;
assert.ok(tokenA);

// Simular expiração do lease de 1 segundo
db.prepare("UPDATE hydra_analysis_projection_outbox SET lease_expires_at = datetime('now', '-5 seconds') WHERE job_id = ?").run(job2Id);

// Worker B pega o job expirado com novo token
const claimB = outbox.claimNextJob('worker_B', 60);
assert.ok(claimB);
assert.strictEqual(claimB.workerId, 'worker_B');
const tokenB = claimB.claimToken!;
assert.notStrictEqual(tokenA, tokenB, 'Tokens de claim devem ser distintos');

// Worker A tenta completar o job com o token antigo (deve falhar)
const ackA = outbox.completeJob(job2Id, tokenA);
assert.strictEqual(ackA, false, 'Worker A não pode dar ack com token expirado');

// Worker B completa o job com o token válido
const ackB = outbox.completeJob(job2Id, tokenB);
assert.strictEqual(ackB, true, 'Worker B completa o job com sucesso');

const jobCompleted = db.prepare('SELECT status FROM hydra_analysis_projection_outbox WHERE job_id = ?').get(job2Id) as { status: string };
assert.strictEqual(jobCompleted.status, 'COMPLETED');
console.log('✓ Teste 4 passou com sucesso.');

// ----------------------------------------------------------------------------
// Teste 5: Writer Atômico e Suporte Pré-OS (H05 e R01)
// ----------------------------------------------------------------------------
console.log('\nTeste 5: SqliteAnalysisMemoryWriter com transação atômica e suporte pré-OS...');
const writer = new SqliteAnalysisMemoryWriter(db);

const preOrderAnalysis: ConversationAnalysisRecord = {
  analysisId: 'an_pre_1',
  conversationId: 9999,
  lojaSlug: 'MPJabaquara',
  coveredOsIds: [], // Atendimento pré-OS sem OS vinculada
  sourceType: 'OPERATIONAL_SYNTHESIS',
  analyzedUntilMessageId: 10,
  analyzedUntilTimestamp: '2026-10-05T12:00:00Z',
  generatedAt: '2026-10-05T12:05:00Z',
  analysisVersion: '1.0',
  isValid: true,
  statements: [
    {
      statementId: 'stmt_pre_1',
      factId: 'fact_pre_duvida',
      subject: 'REPORTED_ISSUE',
      polarity: 'AFFIRMATIVE',
      authorRole: 'CLIENT',
      authorName: 'Maria',
      messageId: 5,
      timestamp: '2026-10-05T11:50:00Z',
      rawExcerpt: 'Gostaria de saber o valor para trocar o óleo',
      confirmation: 'EXPLICIT_CONFIRMED'
    }
  ],
  gaps: []
};

const identityPre: AnalysisRevisionIdentity = {
  sourceId: 'chatwoot',
  accountId: 'instancia_1',
  conversationId: 9999,
  analysisRunId: 'run_1',
  revisionId: 'chatwoot:instancia_1:9999:run_1',
  schemaVersion: '1.0',
  analyzerVersion: '1.0'
};

const resultPre = await writer.recordCompletedAnalysis(preOrderAnalysis, identityPre);
assert.strictEqual(resultPre.projectionQueued, true);

// Conferir persistência do caso pré-OS
const savedPre = db.prepare('SELECT * FROM hydra_analises_atendimento WHERE revision_id = ?').get(identityPre.revisionId) as {
  loja_slug: string;
  covered_os_ids: string;
};
assert.strictEqual(savedPre.loja_slug, 'MPJabaquara');
assert.strictEqual(savedPre.covered_os_ids, '[]');

// Fato do mesmo ID em revisão subsequente (R01)
const identityRev2: AnalysisRevisionIdentity = {
  ...identityPre,
  analysisRunId: 'run_2',
  revisionId: 'chatwoot:instancia_1:9999:run_2'
};

const resultRev2 = await writer.recordCompletedAnalysis(preOrderAnalysis, identityRev2);
assert.strictEqual(resultRev2.projectionQueued, true);

// Fatos coexistem em revisões distintas sem colisão de chave primária (revision_id, statement_id)
const countStatements = (db.prepare("SELECT COUNT(*) as c FROM hydra_afirmacoes_analisadas WHERE statement_id = 'stmt_pre_1'").get() as { c: number }).c;
assert.strictEqual(countStatements, 2, 'Mesmo statement_id deve coexistir em revisões diferentes');
console.log('✓ Teste 5 passou com sucesso.');

  console.log('\n============================================================');
  console.log('TODOS OS TESTES DO EXECUTOR 2 PASSARAM COM 100% DE SUCESSO!');
  console.log('============================================================\n');
}

runExecutor2Tests().catch(err => {
  console.error('Falha nos testes do Executor 2:', err);
  process.exit(1);
});
