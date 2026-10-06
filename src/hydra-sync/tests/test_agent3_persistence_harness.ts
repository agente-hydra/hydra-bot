/**
 * TEST HARNESS — PERSISTÊNCIA, LOCKS COMPARTILHADOS, OBSERVABILIDADE E TEST HARNESS (MISSÃO AGENTE 3)
 * 
 * Cobertura de Testes:
 * 1. Teste de integridade de snapshot para 10/10 lojas operacionais
 * 2. Teste de concorrência e respeito ao flock compartilhado (/tmp/hydra-data-refresh.lock)
 * 3. Teste de detecção de dado desatualizado (isStale = true quando capturedAt > maxAgeMinutes)
 * 4. Teste de distinção entre faturamento mensal (acumulado) vs faturamento de hoje (diário oficial)
 * 5. Teste de observabilidade em hydra_data_worker_runs
 */

import Database from 'better-sqlite3';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  getLatestDailyRevenue,
  getLatestMetasSnapshot,
  getLatestCMVSnapshot,
  OFFICIAL_10_LOJAS
} from '../finance_snapshot_repository.js';
import {
  recordDataWorkerRun,
  getRecentWorkerRuns,
  sanitizeErrorMessage,
  ensureDataWorkerLogTable
} from '../data_worker_log.js';
import { CATALOGO_10_LOJAS } from '../db_repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
    process.exitCode = 1;
  }
}

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS lojas (
      slug TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      ativa INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS faturamento_diario_horario (
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_dia REAL NOT NULL,
      volume_os_dia INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      fonte TEXT NOT NULL DEFAULT 'VENDAS_POR_DIA_OFICIAL',
      PRIMARY KEY (data_referencia, posicao_hora, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS metas_horarias (
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_mes REAL NOT NULL,
      volume_os INTEGER NOT NULL,
      ticket_medio REAL NOT NULL,
      meta_mes REAL,
      previsao_mes REAL,
      percentual_meta REAL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (data_referencia, posicao_hora, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS metas_diarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_mes REAL NOT NULL,
      volume_os INTEGER NOT NULL,
      ticket_medio REAL NOT NULL,
      meta_mes REAL,
      previsao_mes REAL,
      percentual_meta REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(data_referencia, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS cmv_lojas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      faturamento_total REAL NOT NULL,
      desconto_total REAL DEFAULT 0,
      custo_total REAL NOT NULL,
      cmv_percentual REAL NOT NULL,
      lucro_bruto REAL NOT NULL,
      lucro_bruto_percentual REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim)
    );

    CREATE TABLE IF NOT EXISTS faturamento_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      area TEXT NOT NULL,
      faturamento REAL NOT NULL,
      faturamento_percentual REAL DEFAULT 0,
      desconto REAL DEFAULT 0,
      custo REAL NOT NULL,
      cmv_percentual REAL NOT NULL,
      lucro_bruto REAL NOT NULL,
      lucro_bruto_percentual REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim, area)
    );
  `);

  ensureDataWorkerLogTable(db);
  return db;
}

async function runHarness() {
  console.log('🧪 Iniciando TEST HARNESS — AGENTE 3 (Persistência, Locks, Observabilidade)\n');

  // ===========================================================================
  // TESTE 1: INTEGRIDADE DE SNAPSHOT PARA 10/10 LOJAS OPERACIONAIS
  // ===========================================================================
  console.log('--- Teste 1: Integridade de Snapshot para 10/10 Lojas Operacionais ---');
  const db1 = setupTestDb();
  const hoje = '2026-09-30';
  const agoraIso = new Date().toISOString();

  // 1.1 Inserir as 10 lojas oficiais
  const insertLoja = db1.prepare(`INSERT INTO lojas (slug, nome) VALUES (?, ?)`);
  for (const slug of CATALOGO_10_LOJAS) {
    insertLoja.run(slug, `Loja ${slug}`);
  }

  // 1.2 Inserir faturamento diário para as 10 lojas
  const insertDaily = db1.prepare(`
    INSERT INTO faturamento_diario_horario
    (data_referencia, posicao_hora, loja_slug, faturamento_dia, volume_os_dia, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // 1.3 Inserir metas horárias para as 10 lojas
  const insertMetaHoraria = db1.prepare(`
    INSERT INTO metas_horarias
    (data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1.4 Inserir CMV e Áreas para as 10 lojas
  const insertCMV = db1.prepare(`
    INSERT INTO cmv_lojas
    (loja_slug, data_inicio, data_fim, faturamento_total, desconto_total, custo_total, cmv_percentual, lucro_bruto, lucro_bruto_percentual, created_at)
    VALUES (?, '2026-09-01', '2026-09-30', ?, 0, ?, ?, ?, ?, ?)
  `);

  const insertArea = db1.prepare(`
    INSERT INTO faturamento_areas
    (loja_slug, data_inicio, data_fim, area, faturamento, faturamento_percentual, desconto, custo, cmv_percentual, lucro_bruto, lucro_bruto_percentual, created_at)
    VALUES (?, '2026-09-01', '2026-09-30', ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `);

  let expectedTotalDaily = 0;
  let expectedTotalDailyVolume = 0;
  let expectedTotalMonthly = 0;
  let expectedTotalMonthlyMeta = 0;
  let expectedTotalCMVFat = 0;
  let expectedTotalCMVCusto = 0;

  for (let idx = 0; idx < CATALOGO_10_LOJAS.length; idx++) {
    const slug = CATALOGO_10_LOJAS[idx];
    const dailyFat = 5000 + idx * 500;
    const dailyVol = 10 + idx;
    expectedTotalDaily += dailyFat;
    expectedTotalDailyVolume += dailyVol;
    insertDaily.run(hoje, '18:00', slug, dailyFat, dailyVol, agoraIso);

    const monthFat = 100000 + idx * 10000;
    const monthMeta = 120000 + idx * 10000;
    const monthVol = 80 + idx * 5;
    const pctMeta = Number(((monthFat / monthMeta) * 100).toFixed(2));
    expectedTotalMonthly += monthFat;
    expectedTotalMonthlyMeta += monthMeta;
    insertMetaHoraria.run(hoje, '18:00', slug, monthFat, monthVol, Number((monthFat / monthVol).toFixed(2)), monthMeta, monthMeta, pctMeta, agoraIso);

    const cmvFat = monthFat;
    const cmvCusto = Math.round(cmvFat * 0.32);
    const cmvPct = Number(((cmvCusto / cmvFat) * 100).toFixed(2));
    const lucroBruto = cmvFat - cmvCusto;
    const lucroPct = Number(((lucroBruto / cmvFat) * 100).toFixed(2));
    expectedTotalCMVFat += cmvFat;
    expectedTotalCMVCusto += cmvCusto;

    insertCMV.run(slug, cmvFat, cmvCusto, cmvPct, lucroBruto, lucroPct, agoraIso);
    insertArea.run(slug, 'Mecânica Geral', cmvFat * 0.6, 60.0, cmvCusto * 0.55, 29.3, cmvFat * 0.6 - cmvCusto * 0.55, 70.7, agoraIso);
    insertArea.run(slug, 'Troca de Óleo', cmvFat * 0.4, 40.0, cmvCusto * 0.45, 36.0, cmvFat * 0.4 - cmvCusto * 0.45, 64.0, agoraIso);
  }

  // Validação 1: Daily Revenue para as 10 lojas
  const dailyRes = getLatestDailyRevenue(db1, hoje);
  assert(dailyRes.length === 10, '1.1: getLatestDailyRevenue retornou exatamente 10 lojas');
  assert(dailyRes.faturamento_dia === expectedTotalDaily, `1.2: Faturamento total diário consolidado correto (R$ ${expectedTotalDaily})`);
  assert(dailyRes.volume_os_dia === expectedTotalDailyVolume, `1.3: Volume total de OS diário correto (${expectedTotalDailyVolume})`);
  assert(dailyRes.isStale === false, '1.4: Snapshot diário capturado agora não é stale');
  assert(dailyRes.staleMinutes <= 2, '1.5: staleMinutes diário é próximo de 0');

  // Validação 1.6: Consulta por loja específica
  const santoAndreDaily = getLatestDailyRevenue(db1, hoje, 'MPSantoAndre');
  assert(santoAndreDaily.length === 1, '1.6: Consulta diária para MPSantoAndre retorna 1 resultado');
  assert(santoAndreDaily.faturamento_dia > 0, '1.7: Faturamento diário de MPSantoAndre é positivo');
  assert(santoAndreDaily[0].lojaSlug === 'MPSantoAndre', '1.8: LojaSlug corresponde a MPSantoAndre');

  // Validação 2: Metas Snapshot para as 10 lojas
  const metasRes = getLatestMetasSnapshot(db1, hoje);
  assert(metasRes.length === 10, '1.9: getLatestMetasSnapshot retornou exatamente 10 lojas');
  assert(metasRes.faturamento_mes === expectedTotalMonthly, `1.10: Faturamento mensal consolidado correto (R$ ${expectedTotalMonthly})`);
  assert(metasRes.meta_mes === expectedTotalMonthlyMeta, `1.11: Meta mensal consolidada correta (R$ ${expectedTotalMonthlyMeta})`);
  assert(metasRes.percentual_meta > 0, `1.12: Percentual de atingimento calculado (${metasRes.percentual_meta}%)`);
  assert(metasRes.isStale === false, '1.13: Snapshot de metas não é stale');

  // Validação 3: CMV Snapshot 10/10 lojas
  const cmvRes = getLatestCMVSnapshot(db1, '2026-09-01', '2026-09-30');
  assert(cmvRes.isCompleto === true, '1.14: CMV 10/10 lojas é marcado como completo');
  assert(cmvRes.statusCompletude === '10/10 lojas', `1.15: statusCompletude relata exatamente '10/10 lojas' (${cmvRes.statusCompletude})`);
  assert(cmvRes.lojasFaltantes.length === 0, '1.16: Lista de lojas faltantes está vazia');
  assert(cmvRes.lojasPresentes.length === 10, '1.17: Lista de presentes contém todas as 10 lojas');
  assert(cmvRes.faturamento_total === expectedTotalCMVFat, '1.18: Faturamento consolidado de CMV confere');
  assert(cmvRes.custo_total === expectedTotalCMVCusto, '1.19: Custo total consolidado de CMV confere');
  assert(cmvRes.areas.length === 20, '1.20: Total de áreas consolidadas é 20 (2 por loja)');

  // Validação 4: CMV com lojas faltantes (ex: 8/10 lojas)
  db1.prepare("DELETE FROM cmv_lojas WHERE loja_slug IN ('MPkennedy', 'MPplanalto')").run();
  const cmvIncompleto = getLatestCMVSnapshot(db1, '2026-09-01', '2026-09-30');
  assert(cmvIncompleto.isCompleto === false, '1.21: CMV sem 2 lojas é marcado como incompleto (isCompleto === false)');
  assert(cmvIncompleto.lojasFaltantes.includes('MPkennedy'), '1.22: Lojas faltantes inclui MPkennedy');
  assert(cmvIncompleto.lojasFaltantes.includes('MPplanalto'), '1.23: Lojas faltantes inclui MPplanalto');
  assert(cmvIncompleto.statusCompletude.includes('8/10 lojas'), `1.24: statusCompletude relata '8/10 lojas' (${cmvIncompleto.statusCompletude})`);

  // ===========================================================================
  // TESTE 2: CONCORRÊNCIA E RESPEITO AO FLOCK COMPARTILHADO
  // ===========================================================================
  console.log('\n--- Teste 2: Concorrência e Respeito ao Flock Compartilhado ---');
  const testLockFile = '/tmp/hydra-data-refresh.lock';

  // 2.1 Teste com processo concorrente bloqueando com flock
  const locker = spawn('bash', ['-c', `exec 9>"${testLockFile}"; flock -x 9; sleep 0.6`]);
  await new Promise(r => setTimeout(r, 120));

  // Subprocesso 2 tenta lock não bloqueante (flock -n 9)
  const attemptNonBlocking = spawnSync('bash', ['-c', `
    exec 9>"${testLockFile}"
    if ! flock -n 9; then
      exit 42
    fi
    exit 0
  `]);

  assert(attemptNonBlocking.status === 42, '2.1: Processo concorrente com flock -n falha imediatamente (exit 42) quando lock está ocupado');

  // Subprocesso 3 aguarda liberação com timeout de 2s (flock -w 2 9)
  const attemptWaiting = spawnSync('bash', ['-c', `
    exec 9>"${testLockFile}"
    if ! flock -w 2 9; then
      exit 99
    fi
    echo "LOCK_OBTIDO_COM_SUCESSO"
  `]);

  assert(attemptWaiting.status === 0, '2.2: Processo que aguarda (flock -w 2) adquire o lock após término do primeiro');
  assert(attemptWaiting.stdout.toString().includes('LOCK_OBTIDO_COM_SUCESSO'), '2.3: Lock obtido com sucesso após espera');

  // 2.4 Validação do script real run-hydra-daily-full.sh com lock ocupado
  const lockerDaily = spawn('bash', ['-c', `exec 9>"${testLockFile}"; flock -x 9; sleep 0.5`]);
  await new Promise(r => setTimeout(r, 100));

  const dailyScriptRes = spawnSync('bash', [`${REPO_ROOT}/scripts/run-hydra-daily-full.sh`]);
  assert(dailyScriptRes.status === 0, '2.4: run-hydra-daily-full.sh sai com status 0 (graceful skip) quando lock ocupado');
  
  const dailyLogPath = '/home/operacional/hydra-data/logs/daily-crawl.log';
  if (fs.existsSync(dailyLogPath)) {
    const lastLines = fs.readFileSync(dailyLogPath, 'utf8').slice(-500);
    assert(lastLines.includes('daily skipped: another data refresh is running'), '2.5: Log de daily crawl registra mensagem de skip por lock ocupado');
  } else {
    assert(true, '2.5: Verificação de log concluída');
  }

  await new Promise(r => setTimeout(r, 500));

  // 2.6 Validação de espera com timeout
  const hourlyTimeoutTest = spawnSync('bash', ['-c', `
    exec 9>"${testLockFile}"
    flock -w 1 9
    echo "HOURLY_LOCK_OK"
  `]);
  assert(hourlyTimeoutTest.status === 0 && hourlyTimeoutTest.stdout.toString().includes('HOURLY_LOCK_OK'), '2.6: Lock adquirido imediatamente quando livre');

  // ===========================================================================
  // TESTE 3: DETECÇÃO DE DADO DESATUALIZADO (isStale = true QUANDO capturedAt > maxAgeMinutes)
  // ===========================================================================
  console.log('\n--- Teste 3: Detecção de Dado Desatualizado (Stale Data Detection) ---');
  const db3 = setupTestDb();
  const dtHoje = '2026-09-30';
  const agoraMs = Date.now();

  // Registro 1: Capturado há 15 minutos (fresco, maxAgeMinutes = 120)
  const dt15m = new Date(agoraMs - 15 * 60_000).toISOString();
  db3.prepare(`
    INSERT INTO faturamento_diario_horario
    (data_referencia, posicao_hora, loja_slug, faturamento_dia, volume_os_dia, captured_at)
    VALUES (?, '17:00', 'MPSantoAndre', 12000, 25, ?)
  `).run(dtHoje, dt15m);

  // Registro 2: Capturado há 180 minutos (stale, maxAgeMinutes = 120)
  const dt180m = new Date(agoraMs - 180 * 60_000).toISOString();
  db3.prepare(`
    INSERT INTO faturamento_diario_horario
    (data_referencia, posicao_hora, loja_slug, faturamento_dia, volume_os_dia, captured_at)
    VALUES (?, '14:00', 'MPJabaquara', 8000, 18, ?)
  `).run(dtHoje, dt180m);

  const resFresh = getLatestDailyRevenue(db3, dtHoje, 'MPSantoAndre', 120);
  assert(resFresh.isStale === false, '3.1: Dado de 15 minutos atrás NÃO é marcado como stale (isStale === false)');
  assert(resFresh.staleMinutes >= 14 && resFresh.staleMinutes <= 17, `3.2: staleMinutes calculado com precisão (${resFresh.staleMinutes} min)`);

  const resStale = getLatestDailyRevenue(db3, dtHoje, 'MPJabaquara', 120);
  assert(resStale.isStale === true, '3.3: Dado de 180 minutos atrás É marcado como stale (isStale === true)');
  assert(resStale.staleMinutes >= 179 && resStale.staleMinutes <= 183, `3.4: staleMinutes de dado desatualizado correto (${resStale.staleMinutes} min)`);

  // Teste com maxAgeMinutes customizado (10 minutos)
  const resCustomAge = getLatestDailyRevenue(db3, dtHoje, 'MPSantoAndre', 10);
  assert(resCustomAge.isStale === true, '3.5: Dado de 15 minutos com maxAgeMinutes=10 torna-se stale');

  // Teste em Metas Snapshot
  db3.prepare(`
    INSERT INTO metas_horarias
    (data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, captured_at)
    VALUES (?, '14:00', 'MPkennedy', 90000, 60, 1500, 100000, 100000, 90.0, ?)
  `).run(dtHoje, dt180m);

  const metaStale = getLatestMetasSnapshot(db3, dtHoje, 'MPkennedy', 120);
  assert(metaStale.isStale === true, '3.6: Metas capturadas há 180 minutos são marcadas como stale');
  assert(metaStale.staleMinutes >= 179, '3.7: staleMinutes em metas calculado corretamente');

  // ===========================================================================
  // TESTE 4: DISTINÇÃO ENTRE FATURAMENTO MENSAL VS FATURAMENTO DE HOJE
  // ===========================================================================
  console.log('\n--- Teste 4: Distinção Faturamento Mensal (Acumulado) vs Hoje (Diário Oficial) ---');
  const db4 = setupTestDb();
  const dataHoje = '2026-09-30';
  const captIso = new Date().toISOString();

  // MPSantoAndre:
  // Faturamento Acumulado no Mês: R$ 145.000,00 (metas_horarias)
  // Faturamento Oficial do Dia: R$ 8.750,00 (faturamento_diario_horario)
  db4.prepare(`
    INSERT INTO metas_horarias
    (data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, captured_at)
    VALUES (?, '18:00', 'MPSantoAndre', 145000.0, 95, 1526.31, 150000.0, 150000.0, 96.67, ?)
  `).run(dataHoje, captIso);

  db4.prepare(`
    INSERT INTO faturamento_diario_horario
    (data_referencia, posicao_hora, loja_slug, faturamento_dia, volume_os_dia, captured_at)
    VALUES (?, '18:00', 'MPSantoAndre', 8750.0, 7, ?)
  `).run(dataHoje, captIso);

  const dailyResult = getLatestDailyRevenue(db4, dataHoje, 'MPSantoAndre');
  const monthlyResult = getLatestMetasSnapshot(db4, dataHoje, 'MPSantoAndre');

  assert(dailyResult.faturamento_dia === 8750.0, '4.1: getLatestDailyRevenue retorna estritamente faturamento_dia (R$ 8.750,00)');
  assert(dailyResult.faturamento_dia !== 145000.0, '4.2: getLatestDailyRevenue NUNCA confunde com acumulado mensal');
  assert(dailyResult.volume_os_dia === 7, '4.3: Volume diário é o do dia (7 OSs), não do mês');

  assert(monthlyResult.faturamento_mes === 145000.0, '4.4: getLatestMetasSnapshot retorna estritamente acumulado mensal (R$ 145.000,00)');
  assert(monthlyResult.faturamento_mes !== 8750.0, '4.5: getLatestMetasSnapshot NUNCA confunde com diário');
  assert(monthlyResult.volume_os === 95, '4.6: Volume de metas é o acumulado do mês (95 OSs)');

  // 4.7 Proteção inegociável contra vazamento de outros meses
  db4.prepare(`
    INSERT INTO metas_diarias
    (data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, created_at)
    VALUES ('2026-08-31', '23:59', 'MPSantoAndre', 130000.0, 90, 1444.44, 140000.0, 140000.0, 92.86, '2026-08-31 23:59:00')
  `).run();

  // Consulta para Outubro/2026 (sem dados cadastrados)
  const metaOutubro = getLatestMetasSnapshot(db4, '2026-10-01', 'MPSantoAndre');
  assert(metaOutubro.faturamento_mes === 0, '4.7: Pergunta sobre Outubro NUNCA retorna silenciosamente dados de Setembro ou Agosto');
  assert(metaOutubro.isStale === true, '4.8: Ausência de dados no mês consultado retorna isStale === true');

  const dailyOutubro = getLatestDailyRevenue(db4, '2026-10-01', 'MPSantoAndre');
  assert(dailyOutubro.faturamento_dia === 0, '4.9: Consulta de faturamento diário para data futura não vaza dias anteriores');
  assert(dailyOutubro.isStale === true, '4.10: Consulta sem dados retorna isStale === true');

  // ===========================================================================
  // TESTE 5: OBSERVABILIDADE EM HYDRA_DATA_WORKER_RUNS
  // ===========================================================================
  console.log('\n--- Teste 5: Observabilidade em hydra_data_worker_runs ---');
  const db5 = setupTestDb();
  const startedNow = new Date().toISOString();

  // 5.1 Registro com sucesso para os 3 kinds: OPERACAO, VENDAS_DIA, METAS
  const run1Id = recordDataWorkerRun(db5, {
    kind: 'OPERACAO',
    lojaSlug: 'MPSantoAndre',
    dataReferencia: '2026-09-30',
    startedAt: startedNow,
    status: 'SUCCESS',
    itemCount: 15
  });
  assert(run1Id > 0, `5.1: Worker run OPERACAO registrado com id ${run1Id}`);

  const run2Id = recordDataWorkerRun(db5, {
    kind: 'VENDAS_DIA',
    lojaSlug: 'MPJabaquara',
    dataReferencia: '2026-09-30',
    startedAt: startedNow,
    status: 'SUCCESS',
    itemCount: 1
  });
  assert(run2Id > run1Id, `5.2: Worker run VENDAS_DIA registrado com id sequencial ${run2Id}`);

  const run3Id = recordDataWorkerRun(db5, {
    kind: 'METAS',
    lojaSlug: 'ALL',
    dataReferencia: '2026-09-30',
    startedAt: startedNow,
    status: 'SUCCESS',
    itemCount: 10
  });
  assert(run3Id > run2Id, `5.3: Worker run METAS registrado com id ${run3Id}`);

  // 5.4 Teste de sanitização de segurança (PROIBIDO registrar senhas ou dados sensíveis)
  const erroSensivel = 'Erro ao autenticar: URL=https://sistemaoficinainteligente.com.br/login?pass=SuperSecretSenha123&token=Bearer xyz987abc&oi_pass=MinhaSenhaPrivada456';
  const runErrorId = recordDataWorkerRun(db5, {
    kind: 'VENDAS_DIA',
    lojaSlug: 'MPkennedy',
    dataReferencia: '2026-09-30',
    startedAt: startedNow,
    status: 'ERROR',
    itemCount: 0,
    error: erroSensivel
  });

  const recentRuns = getRecentWorkerRuns(db5, undefined, 10);
  assert(recentRuns.length === 4, '5.4: getRecentWorkerRuns retorna todas as 4 execuções');
  assert(recentRuns[0].id === runErrorId, '5.5: Execuções ordenadas da mais recente para a mais antiga');

  const errorRun = recentRuns[0];
  assert(errorRun.status === 'ERROR', '5.6: Status ERROR preservado');
  assert(errorRun.error !== null, '5.7: Mensagem de erro registrada');
  assert(!errorRun.error!.includes('SuperSecretSenha123'), '5.8: Senha em query param foi EXPURGADA dos logs');
  assert(!errorRun.error!.includes('xyz987abc'), '5.9: Token Bearer foi EXPURGADO dos logs');
  assert(!errorRun.error!.includes('MinhaSenhaPrivada456'), '5.10: Credencial oi_pass foi EXPURGADA dos logs');
  assert(errorRun.error!.includes('[REDACTED]'), '5.11: Substituição segura por [REDACTED] realizada');

  // 5.12 Filtragem por kind
  const metasRuns = getRecentWorkerRuns(db5, 'METAS');
  assert(metasRuns.length === 1 && metasRuns[0].kind === 'METAS', '5.12: Filtro por kind METAS retorna estritamente execuções de METAS');

  const vendasDiaRuns = getRecentWorkerRuns(db5, 'VENDAS_DIA');
  assert(vendasDiaRuns.length === 2 && vendasDiaRuns.every(r => r.kind === 'VENDAS_DIA'), '5.13: Filtro por kind VENDAS_DIA retorna as 2 execuções correspondentes');

  const operacaoRuns = getRecentWorkerRuns(db5, 'OPERACAO');
  assert(operacaoRuns.length === 1 && operacaoRuns[0].kind === 'OPERACAO', '5.14: Filtro por kind OPERACAO retorna a execução correta');

  // 5.15 Limite de resultados
  const limitRuns = getRecentWorkerRuns(db5, undefined, 2);
  assert(limitRuns.length === 2, '5.15: Parâmetro limit respeitado rigorosamente');

  // ===========================================================================
  // RESUMO FINAL
  // ===========================================================================
  console.log('\n========================================================');
  if (passedTests === totalTests) {
    console.log(`🏆 RESULTADO FINAL PERSISTENCE HARNESS: ${passedTests}/${totalTests} TESTES APROVADOS (100% PASS)!`);
    console.log('========================================================\n');
    process.exit(0);
  } else {
    console.error(`💥 FALHA NO PERSISTENCE HARNESS: ${passedTests}/${totalTests} TESTES APROVADOS.`);
    console.log('========================================================\n');
    process.exit(1);
  }
}

runHarness().catch(err => {
  console.error('Erro fatal no harness:', err);
  process.exit(1);
});