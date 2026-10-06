import Database from 'better-sqlite3';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import {
  initSchema,
  loadVectorExtension,
  salvarLoteOSs,
  formalizarTransicaoNominalOS,
  carregarLoteControlado30Dias,
  backfillDatasOrdensServico,
  sanearOrdensDivergentesExistentes,
  isolarInvestigarOS9202,
  swapAtomicoVetores,
  parseBrDateToIso,
  formatIsoTimestamp,
  type OrderRecord,
  type OrderOperationalState,
  type OrderDataQuality,
  type ReconciliacaoOptions,
  type ReconciliacaoResult
} from '../db_repository.js';

let passedTests = 0;
let totalTests = 0;

async function it(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/** Cria banco de dados SQLite isolado em memória com schema completo */
function createIsolatedTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  loadVectorExtension(db);
  initSchema(db);
  return db;
}

/** Popula dados fixtures para simulação de divergência histórica dos 517 registros */
function seed517DivergenceFixtures(db: Database.Database): void {
  const insertStmt = db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, tipo, status_grid, is_aberta,
      estado_operacional, qualidade_dado,
      data_inicio, data_fim, dias_no_patio, veiculo, placa,
      cliente_nome, responsavel, total_os, valor_pago, valor_restante,
      tem_nf, raw_payload, updated_at
    ) VALUES (
      @os_id, @loja_slug, @tipo, @status_grid, @is_aberta,
      @estado_operacional, @qualidade_dado,
      @data_inicio, @data_fim, @dias_no_patio, @veiculo, @placa,
      @cliente_nome, @responsavel, @total_os, @valor_pago, @valor_restante,
      @tem_nf, @raw_payload, @updated_at
    )
  `);

  const runSeedTx = db.transaction(() => {
    // 153 OSs com status 'ABERTO' e is_aberta = 0 (divergência histórica)
    for (let i = 1; i <= 153; i++) {
      insertStmt.run({
        os_id: `AB_${i}`,
        loja_slug: 'MPJabaquara',
        tipo: 'OS',
        status_grid: 'ABERTO',
        is_aberta: 0,
        estado_operacional: 'ABERTA',
        qualidade_dado: 'VALIDADO',
        data_inicio: '26/08/26 16:00',
        data_fim: null,
        dias_no_patio: 0,
        veiculo: 'ONIX',
        placa: `ABC${i.toString().padStart(4, '0')}`,
        cliente_nome: `Cliente Aberto ${i}`,
        responsavel: 'Vanessa',
        total_os: 500,
        valor_pago: 200,
        valor_restante: 300,
        tem_nf: 0,
        raw_payload: JSON.stringify({ id: `AB_${i}`, status_grid: 'ABERTO' }),
        updated_at: '2026-09-28 13:45:37'
      });
    }

    // 206 OSs com status 'AGUARDANDO RETIRADA' e is_aberta = 0 (divergência histórica)
    for (let i = 1; i <= 206; i++) {
      insertStmt.run({
        os_id: `AR_${i}`,
        loja_slug: 'MPdompedro1',
        tipo: 'OS',
        status_grid: 'AGUARDANDO RETIRADA',
        is_aberta: 0,
        estado_operacional: 'ABERTA',
        qualidade_dado: 'VALIDADO',
        data_inicio: '28/08/26 10:30',
        data_fim: null,
        dias_no_patio: 0,
        veiculo: 'COROLLA',
        placa: `RET${i.toString().padStart(4, '0')}`,
        cliente_nome: `Cliente Retirada ${i}`,
        responsavel: 'Leandro',
        total_os: 1200,
        valor_pago: 1200,
        valor_restante: 0,
        tem_nf: 1,
        raw_payload: JSON.stringify({ id: `AR_${i}`, status_grid: 'AGUARDANDO RETIRADA' }),
        updated_at: '2026-09-29 11:00:00'
      });
    }

    // OS anômala 9202 em Kennedy
    insertStmt.run({
      os_id: '9202',
      loja_slug: 'MPkennedy',
      tipo: 'OS',
      status_grid: 'Aberta',
      is_aberta: 0,
      estado_operacional: 'ABERTA',
      qualidade_dado: 'VALIDADO',
      data_inicio: null,
      data_fim: null,
      dias_no_patio: 0,
      veiculo: 'SEGREDO_EXTERNO',
      placa: 'BBB2222',
      cliente_nome: null,
      responsavel: null,
      total_os: 999999,
      valor_pago: 0,
      valor_restante: 999999,
      tem_nf: 0,
      raw_payload: null,
      updated_at: '2026-10-02 06:08:00'
    });

    // 157 OSs normais para totalizar 517 registros
    for (let i = 1; i <= 157; i++) {
      insertStmt.run({
        os_id: `NORM_${i}`,
        loja_slug: 'MPSantoAndre',
        tipo: 'OS',
        status_grid: i % 2 === 0 ? 'ABERTO' : 'FECHADA',
        is_aberta: i % 2 === 0 ? 1 : 0,
        estado_operacional: i % 2 === 0 ? 'ABERTA' : 'ENCERRADA',
        qualidade_dado: 'VALIDADO',
        data_inicio: '01/09/26 14:00',
        data_fim: i % 2 === 0 ? null : '05/09/26 18:00',
        dias_no_patio: i % 2 === 0 ? 10 : 0,
        veiculo: 'HB20',
        placa: `NRM${i.toString().padStart(4, '0')}`,
        cliente_nome: `Cliente Normal ${i}`,
        responsavel: 'Carlos',
        total_os: 800,
        valor_pago: 800,
        valor_restante: 0,
        tem_nf: 1,
        raw_payload: JSON.stringify({ id: `NORM_${i}` }),
        updated_at: '2026-09-30 15:00:00'
      });
    }
  });

  runSeedTx();
}

async function runTests() {
  console.log('🚀 Iniciando Suíte de Testes Executor 2: Ciclo de Vida, Migração de Datas e Reconciliação\n');

  // =========================================================================
  // GRUPO 1: Migração Aditiva e Estrutura de Tabelas (E3-E2.1 & E0-E2)
  // =========================================================================
  console.log('--- Grupo 1: Migração Aditiva e Estrutura de Tabelas (E3-E2.1) ---');

  await it('1.1 - initSchema adiciona colunas de ciclo de vida e datas ISO mantendo colunas originais', () => {
    const db = createIsolatedTestDb();
    const columns = db.prepare("PRAGMA table_info(ordens_servico)").all() as Array<{ name: string }>;
    const colNames = columns.map(c => c.name);

    // Colunas originais preservadas intactas
    assert(colNames.includes('os_id'), 'Falta coluna os_id');
    assert(colNames.includes('loja_slug'), 'Falta coluna loja_slug');
    assert(colNames.includes('data_inicio'), 'Falta coluna data_inicio');
    assert(colNames.includes('data_fim'), 'Falta coluna data_fim');
    assert(colNames.includes('is_aberta'), 'Falta coluna is_aberta');
    assert(colNames.includes('status_grid'), 'Falta coluna status_grid');

    // Colunas aditivas do ciclo de vida e ISO
    assert(colNames.includes('estado_operacional'), 'Falta coluna estado_operacional');
    assert(colNames.includes('qualidade_dado'), 'Falta coluna qualidade_dado');
    assert(colNames.includes('data_inicio_iso'), 'Falta coluna data_inicio_iso');
    assert(colNames.includes('data_fim_iso'), 'Falta coluna data_fim_iso');
    assert(colNames.includes('data_evento_iso'), 'Falta coluna data_evento_iso');
    assert(colNames.includes('data_observacao_iso'), 'Falta coluna data_observacao_iso');
    assert(colNames.includes('origem_transicao'), 'Falta coluna origem_transicao');
  });

  await it('1.2 - initSchema cria índices específicos para consultas de ciclo de vida e performance', () => {
    const db = createIsolatedTestDb();
    const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    const indexNames = indices.map(i => i.name);

    assert(indexNames.includes('idx_os_estado_operacional'), 'Falta índice idx_os_estado_operacional');
    assert(indexNames.includes('idx_os_qualidade_dado'), 'Falta índice idx_os_qualidade_dado');
    assert(indexNames.includes('idx_os_data_inicio_iso'), 'Falta índice idx_os_data_inicio_iso');
    assert(indexNames.includes('idx_os_data_fim_iso'), 'Falta índice idx_os_data_fim_iso');
    assert(indexNames.includes('idx_os_data_evento_iso'), 'Falta índice idx_os_data_evento_iso');
    assert(indexNames.includes('idx_os_data_obs_iso'), 'Falta índice idx_os_data_obs_iso');
  });

  await it('1.3 - Regra de Retenção: Comandos DELETE em ordens_servico são proibidos e nunca utilizados', () => {
    const db = createIsolatedTestDb();
    seed517DivergenceFixtures(db);
    const countBefore = (db.prepare('SELECT count(*) as c FROM ordens_servico').get() as any).c;
    assert.strictEqual(countBefore, 517, 'Deve iniciar com 517 registros');

    // Executa operações de lote e saneamento
    sanearOrdensDivergentesExistentes(db);
    isolarInvestigarOS9202(db);
    backfillDatasOrdensServico(db);

    const countAfter = (db.prepare('SELECT count(*) as c FROM ordens_servico').get() as any).c;
    assert.strictEqual(countAfter, 517, 'Piso mínimo de cobertura violado: contagem diminuiu');
  });

  // =========================================================================
  // GRUPO 2: Parsing Determinístico de Datas e Fuso America/Sao_Paulo (E3-E2.2)
  // =========================================================================
  console.log('\n--- Grupo 2: Parsing Determinístico de Datas no fuso America/Sao_Paulo (E3-E2.2) ---');

  await it('2.1 - parseBrDateToIso converte DD/MM/YY HH:MM preservando fuso -03:00', () => {
    const res = parseBrDateToIso('26/08/26 16:00');
    assert.strictEqual(res, '2026-08-26T16:00:00-03:00', `Esperado 2026-08-26T16:00:00-03:00, recebido ${res}`);
  });

  await it('2.2 - parseBrDateToIso converte DD/MM/YYYY HH:MM:SS com segundos', () => {
    const res = parseBrDateToIso('05/09/2026 14:32:45');
    assert.strictEqual(res, '2026-09-05T14:32:45-03:00', `Esperado 2026-09-05T14:32:45-03:00, recebido ${res}`);
  });

  await it('2.3 - parseBrDateToIso preserva precisão estrita de data pura sem horários fictícios', () => {
    const res = parseBrDateToIso('01/09/2026');
    assert.strictEqual(res, '2026-09-01', `Esperado 2026-09-01, recebido ${res}`);
  });

  await it('2.4 - parseBrDateToIso suporta datetime padrão SQLite (YYYY-MM-DD HH:MM:SS)', () => {
    const res = parseBrDateToIso('2026-09-28 13:45:37');
    assert.strictEqual(res, '2026-09-28T13:45:37-03:00', `Esperado 2026-09-28T13:45:37-03:00, recebido ${res}`);
  });

  await it('2.5 - parseBrDateToIso trata null, strings vazias e sentinelas com segurança', () => {
    assert.strictEqual(parseBrDateToIso(null), null);
    assert.strictEqual(parseBrDateToIso(undefined), null);
    assert.strictEqual(parseBrDateToIso(''), null);
    assert.strictEqual(parseBrDateToIso('null'), null);
  });

  // =========================================================================
  // GRUPO 3: Backfill Determinístico e Separação Estrita de Datas (E3-E2.2)
  // =========================================================================
  console.log('\n--- Grupo 3: Backfill Determinístico e Separação de Datas (E3-E2.2) ---');

  await it('3.1 - backfillDatasOrdensServico popula datas ISO separando data_evento_iso de data_observacao_iso', () => {
    const db = createIsolatedTestDb();
    seed517DivergenceFixtures(db);

    const resBackfill = backfillDatasOrdensServico(db);
    assert.strictEqual(resBackfill.totalProcessados, 517);
    assert(resBackfill.totalAtualizados > 0, 'Deve ter atualizado registros');

    // Verificar uma OS de amostra
    const sample = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'AB_1'").get() as any;
    assert.strictEqual(sample.data_inicio, '26/08/26 16:00', 'data_inicio original não pode ter sido alterada');
    assert.strictEqual(sample.data_inicio_iso, '2026-08-26T16:00:00-03:00', 'data_inicio_iso incorreta');
    assert.strictEqual(sample.data_evento_iso, '2026-08-26T16:00:00-03:00', 'data_evento_iso deve ser o fato operacional');
    assert.strictEqual(sample.data_observacao_iso, '2026-09-28T13:45:37-03:00', 'data_observacao_iso deve ser a captura do crawler');
  });

  // =========================================================================
  // GRUPO 4: Critérios de Aceitação e Quarentena de Lotes (E3-E2.5)
  // =========================================================================
  console.log('\n--- Grupo 4: Critérios de Aceitação e Quarentena de Lotes (E3-E2.5) ---');

  await it('4.1 - Lote sem prova cabal de paginação nativa (paginacaoCompleta = false) é quarentenado', () => {
    const db = createIsolatedTestDb();
    const docs = [
      { id: '101', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 10:00', veiculo: 'GOL' }
    ];

    const res = salvarLoteOSs(db, 'MPJabaquara', docs, {
      extracaoCompleta: false,
      paginacaoCompleta: false,
      provaPaginacaoNativa: false
    });

    assert.strictEqual(res.status, 'QUARANTINE', 'Lote incompleto deve receber status QUARANTINE');

    // Produção NÃO deve ter recebido o registro
    const row = db.prepare("SELECT * FROM ordens_servico WHERE os_id = '101'").get();
    assert.strictEqual(row, undefined, 'Ordens de lote em quarentena não podem entrar em ordens_servico');

    // Staging deve ter retido o registro para auditoria
    const stagingRow = db.prepare("SELECT * FROM ordens_servico_staging WHERE os_id = '101'").get();
    assert(stagingRow !== undefined, 'Lote em quarentena deve ser retido em ordens_servico_staging');
  });

  await it('4.2 - Lote com prova cabal de paginação nativa (paginacaoCompleta = true) é aceito', () => {
    const db = createIsolatedTestDb();
    const docs = [
      { id: '202', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '02/09/26 11:30', veiculo: 'CIVIC' }
    ];

    const res = salvarLoteOSs(db, 'MPJabaquara', docs, {
      extracaoCompleta: true,
      paginacaoCompleta: true,
      provaPaginacaoNativa: true
    });

    assert.strictEqual(res.status, 'SUCCESS', 'Lote com cobertura comprovada deve ter sucesso');

    const row = db.prepare("SELECT * FROM ordens_servico WHERE os_id = '202'").get() as any;
    assert(row !== undefined, 'Ordem aceita deve estar em ordens_servico');
    assert.strictEqual(row.estado_operacional, 'ABERTA');
    assert.strictEqual(row.qualidade_dado, 'VALIDADO');
    assert.strictEqual(row.data_inicio_iso, '2026-09-02T11:30:00-03:00');
  });

  // =========================================================================
  // GRUPO 5: Desacoplamento Total e Transição Pendente (E3-E2.3)
  // =========================================================================
  console.log('\n--- Grupo 5: Desacoplamento Total e Transição Pendente (E3-E2.3) ---');

  await it('5.1 - Aceitação de novo lote NUNCA encerra OSs ausentes cegamente', () => {
    const db = createIsolatedTestDb();

    // Inserir 3 OSs abertas inicialmente
    const lote1 = [
      { id: 'OS_A', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 09:00' },
      { id: 'OS_B', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 09:15' },
      { id: 'OS_C', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 09:30' }
    ];
    salvarLoteOSs(db, 'MPdompedro1', lote1, { extracaoCompleta: true, paginacaoCompleta: true });

    // Novo lote traz apenas OS_A e OS_D (OS_B e OS_C desapareceram da grade)
    const lote2 = [
      { id: 'OS_A', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 09:00' },
      { id: 'OS_D', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '02/09/26 08:00' }
    ];
    salvarLoteOSs(db, 'MPdompedro1', lote2, { extracaoCompleta: true, paginacaoCompleta: true });

    // OS_B e OS_C NÃO foram fechadas cegamente: foram para TRANSICAO_PENDENTE com is_aberta = 1
    const osB = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'OS_B'").get() as any;
    const osC = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'OS_C'").get() as any;

    assert.strictEqual(osB.estado_operacional, 'TRANSICAO_PENDENTE', 'OS_B deve estar em TRANSICAO_PENDENTE');
    assert.strictEqual(osB.origem_transicao, 'AUSENTE_GRADE_PAGINADA', 'Origem de transição incorreta para OS_B');
    assert.strictEqual(osB.is_aberta, 1, 'is_aberta não pode ser zerado cegamente');

    assert.strictEqual(osC.estado_operacional, 'TRANSICAO_PENDENTE', 'OS_C deve estar em TRANSICAO_PENDENTE');
    assert.strictEqual(osC.origem_transicao, 'AUSENTE_GRADE_PAGINADA', 'Origem de transição incorreta para OS_C');
    assert.strictEqual(osC.is_aberta, 1, 'is_aberta não pode ser zerado cegamente');
  });

  // =========================================================================
  // GRUPO 6: Validação Nominal Individual de Ciclo de Vida (E3-E2.4)
  // =========================================================================
  console.log('\n--- Grupo 6: Validação Nominal Individual de Ciclo de Vida (E3-E2.4) ---');

  await it('6.1 - formalizarTransicaoNominalOS formaliza encerramento cadastral após validação nominal', () => {
    const db = createIsolatedTestDb();
    db.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, status_grid, is_aberta, estado_operacional)
      VALUES ('OS_PEND1', 'MPplanalto', 'ABERTO', 1, 'TRANSICAO_PENDENTE')
    `).run();

    const ok = formalizarTransicaoNominalOS(
      db,
      'OS_PEND1',
      'MPplanalto',
      'ENCERRADA',
      'VALIDACAO_NOMINAL_FECHADA',
      { data_fim: '03/09/26 17:00' }
    );
    assert(ok, 'Formalização deve retornar true');

    const updated = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'OS_PEND1'").get() as any;
    assert.strictEqual(updated.estado_operacional, 'ENCERRADA');
    assert.strictEqual(updated.is_aberta, 0);
    assert.strictEqual(updated.origem_transicao, 'VALIDACAO_NOMINAL_FECHADA');
    assert.strictEqual(updated.data_fim_iso, '2026-09-03T17:00:00-03:00');
  });

  await it('6.2 - formalizarTransicaoNominalOS formaliza cancelamento após validação nominal', () => {
    const db = createIsolatedTestDb();
    db.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, status_grid, is_aberta, estado_operacional)
      VALUES ('OS_CANC1', 'MPplanalto', 'ABERTO', 1, 'TRANSICAO_PENDENTE')
    `).run();

    const ok = formalizarTransicaoNominalOS(
      db,
      'OS_CANC1',
      'MPplanalto',
      'CANCELADA',
      'VALIDACAO_NOMINAL_CANCELADA'
    );
    assert(ok);

    const updated = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'OS_CANC1'").get() as any;
    assert.strictEqual(updated.estado_operacional, 'CANCELADA');
    assert.strictEqual(updated.is_aberta, 0);
    assert.strictEqual(updated.origem_transicao, 'VALIDACAO_NOMINAL_CANCELADA');
  });

  // =========================================================================
  // GRUPO 7: Protocolo de Investigação Finita da OS 9202 em Kennedy (E3-E2.6)
  // =========================================================================
  console.log('\n--- Grupo 7: Investigação Finita da OS 9202 em Kennedy (E3-E2.6) ---');

  await it('7.1 - isolarInvestigarOS9202 isola registro anômalo e gera relatório de auditoria', () => {
    const db = createIsolatedTestDb();
    seed517DivergenceFixtures(db);

    const res = isolarInvestigarOS9202(db);
    assert.strictEqual(res.osId, '9202');
    assert.strictEqual(res.lojaSlug, 'MPkennedy');
    assert.strictEqual(res.isolado, true);

    const row = db.prepare("SELECT * FROM ordens_servico WHERE os_id = '9202' AND loja_slug = 'MPkennedy'").get() as any;
    assert.strictEqual(row.qualidade_dado, 'SUSPEITO_QUARENTENA');
    assert.strictEqual(row.estado_operacional, 'DESCONHECIDO');
    assert.strictEqual(row.origem_transicao, 'PROTOCOLO_INVESTIGACAO_9202');

    assert(res.relatorioAuditoria.anomalias_detectadas.length >= 3, 'Relatório deve listar múltiplas anomalias');
  });

  // =========================================================================
  // GRUPO 8: Saneamento dos 517 Registros em Divergência (E3-E2.7)
  // =========================================================================
  console.log('\n--- Grupo 8: Saneamento dos 517 Registros em Divergência (E3-E2.7) ---');

  await it('8.1 - sanearOrdensDivergentesExistentes identifica e enfileira as 153 e 206 OSs divergentes', () => {
    const db = createIsolatedTestDb();
    seed517DivergenceFixtures(db);

    const resSaneamento = sanearOrdensDivergentesExistentes(db);
    assert.strictEqual(resSaneamento.abertosCount, 153, 'Deve encontrar exatamente 153 com status ABERTO');
    assert.strictEqual(resSaneamento.aguardandoRetiradaCount, 206, 'Deve encontrar exatamente 206 com AGUARDANDO RETIRADA');
    assert.strictEqual(resSaneamento.totalDivergentes, 359, 'Total de divergentes deve ser 359');

    // Verificar se foram marcadas para TRANSICAO_PENDENTE e EM_AUDITORIA com is_aberta = 1
    const checkAb = db.prepare("SELECT count(*) as c FROM ordens_servico WHERE status_grid = 'ABERTO' AND estado_operacional = 'TRANSICAO_PENDENTE' AND is_aberta = 1").get() as any;
    assert.strictEqual(checkAb.c, 153);

    const checkAr = db.prepare("SELECT count(*) as c FROM ordens_servico WHERE status_grid = 'AGUARDANDO RETIRADA' AND estado_operacional = 'TRANSICAO_PENDENTE' AND is_aberta = 1").get() as any;
    assert.strictEqual(checkAr.c, 206);
  });

  // =========================================================================
  // GRUPO 9: Carregamento de Lote Controlado de 30 Dias (E2-E2)
  // =========================================================================
  console.log('\n--- Grupo 9: Carregamento de Lote Controlado de 30 Dias (E2-E2) ---');

  await it('9.1 - carregarLoteControlado30Dias retorna instâncias do contrato OrderRecord tipado', () => {
    const db = createIsolatedTestDb();
    seed517DivergenceFixtures(db);
    backfillDatasOrdensServico(db);

    const ordens: OrderRecord[] = carregarLoteControlado30Dias(db, 'MPJabaquara');
    assert(ordens.length > 0, 'Deve retornar ordens da loja MPJabaquara');

    const sample = ordens[0];
    assert(typeof sample.osId === 'string', 'osId deve ser string');
    assert(typeof sample.lojaSlug === 'string', 'lojaSlug deve ser string');
    assert(typeof sample.isAberta === 'boolean', 'isAberta deve ser boolean');
    assert(['ABERTA', 'ENCERRADA', 'CANCELADA', 'TRANSICAO_PENDENTE', 'DESCONHECIDO'].includes(sample.estadoOperacional));
    assert(['VALIDADO', 'SUSPEITO_QUARENTENA', 'CONFLITO', 'EM_AUDITORIA'].includes(sample.qualidadeDado));
    assert(typeof sample.dataObservacaoIso === 'string', 'dataObservacaoIso obrigatória');
  });

  // =========================================================================
  // GRUPO 10: Concorrência Multiloja e Isolamento de Escopo (E1-E2)
  // =========================================================================
  console.log('\n--- Grupo 10: Concorrência Multiloja e Isolamento de Escopo (E1-E2) ---');

  await it('10.1 - Reconciliação concorrente em multiloja preserva isolamento entre lojas', () => {
    const db = createIsolatedTestDb();

    // Loja 1: MPdompedro1 com 3 OSs
    salvarLoteOSs(db, 'MPdompedro1', [
      { id: 'DP_1', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 10:00' },
      { id: 'DP_2', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 10:10' },
      { id: 'DP_3', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 10:20' }
    ], { extracaoCompleta: true, paginacaoCompleta: true });

    // Loja 2: MPSantoAndre com 2 OSs
    salvarLoteOSs(db, 'MPSantoAndre', [
      { id: 'SA_1', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 11:00' },
      { id: 'SA_2', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 11:10' }
    ], { extracaoCompleta: true, paginacaoCompleta: true });

    // Reconcilia Loja 1 trazendo apenas DP_1 (DP_2 e DP_3 vão para transição)
    salvarLoteOSs(db, 'MPdompedro1', [
      { id: 'DP_1', status_grid: 'ABERTO', is_aberta: 1, data_inicio: '01/09/26 10:00' }
    ], { extracaoCompleta: true, paginacaoCompleta: true });

    // Verificar se MPSantoAndre foi afetada: NÃO PODE TER SIDO
    const sa1 = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'SA_1'").get() as any;
    const sa2 = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'SA_2'").get() as any;

    assert.strictEqual(sa1.estado_operacional, 'ABERTA', 'Loja B não pode sofrer mutação por reconciliação da Loja A');
    assert.strictEqual(sa2.estado_operacional, 'ABERTA', 'Loja B não pode sofrer mutação por reconciliação da Loja A');

    // Verificar Loja 1
    const dp2 = db.prepare("SELECT * FROM ordens_servico WHERE os_id = 'DP_2'").get() as any;
    assert.strictEqual(dp2.estado_operacional, 'TRANSICAO_PENDENTE');
  });

  // =========================================================================
  // GRUPO 11: Indexação Vetorial Versionada com Swap Atômico (E5-E2)
  // =========================================================================
  console.log('\n--- Grupo 11: Indexação Vetorial Versionada com Swap Atômico (E5-E2) ---');

  await it('11.1 - swapAtomicoVetores executa cópia e troca atômica versionada', () => {
    const db = createIsolatedTestDb();
    const vecLoaded = loadVectorExtension(db);

    if (!vecLoaded) {
      console.log('    ℹ️ sqlite-vec não carregável no ambiente deste teste (ignorado gracefully)');
      return;
    }

    // Inserir dados na staging
    const dummyEmb = new Float32Array(384).fill(0.25);
    const rawBuffer = new Uint8Array(dummyEmb.buffer, dummyEmb.byteOffset, dummyEmb.byteLength);

    db.prepare('INSERT INTO vec_ordens_servico_staging(os_key, os_embedding) VALUES (?, ?)').run('os_100:MPJabaquara', rawBuffer);

    const versionId = crypto.randomUUID();
    const ok = swapAtomicoVetores(db, versionId, 1);
    assert(ok, 'Swap atômico deve retornar true');

    // Tabela vec_ordens_servico deve conter o registro
    const row = db.prepare("SELECT count(*) as c FROM vec_ordens_servico").get() as any;
    assert.strictEqual(row.c, 1, 'vec_ordens_servico deve conter 1 vetor');

    // Tabela staging deve estar limpa
    const stgRow = db.prepare("SELECT count(*) as c FROM vec_ordens_servico_staging").get() as any;
    assert.strictEqual(stgRow.c, 0, 'vec_ordens_servico_staging deve estar vazia após swap');

    // Versão registrada no catálogo
    const verRow = db.prepare("SELECT * FROM vec_index_versions WHERE version_id = ?").get(versionId) as any;
    assert(verRow !== undefined, 'Versão deve ser registrada');
    assert.strictEqual(verRow.total_vectors, 1);
    assert.strictEqual(verRow.is_active, 1);
  });

  // =========================================================================
  // RESUMO FINAL
  // =========================================================================
  console.log('\n======================================================');
  console.log(`🎯 RESULTADO FINAL DOS TESTES: ${passedTests}/${totalTests} PASSOS CONCLUÍDOS`);
  if (passedTests === totalTests) {
    console.log('🎉 100% DOS TESTES PASSARAM COM SUCESSO!');
    process.exit(0);
  } else {
    console.error(`❌ ${totalTests - passedTests} TESTES FALHARAM.`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Falha catastrófica na execução da suíte de testes:', err);
  process.exit(1);
});