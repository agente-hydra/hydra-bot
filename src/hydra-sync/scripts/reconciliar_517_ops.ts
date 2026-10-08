import Database from 'better-sqlite3';
import {
  initSchema,
  loadVectorExtension,
  backfillDatasOrdensServico,
  sanearOrdensDivergentesExistentes,
  isolarInvestigarOS9202
} from '../db_repository.js';

const dbPath = '/home/operacional/hydra-data/hydra_ops.db';
console.log('--- Conectando ao banco operacional:', dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
loadVectorExtension(db);

// 1. Migration Aditiva
console.log('1. Executando migration aditiva...');
initSchema(db);

// 2. Backfill determinístico de datas
console.log('2. Executando backfill determinístico de datas...');
const resBackfill = backfillDatasOrdensServico(db);
console.log('   Backfill concluído:', JSON.stringify(resBackfill));

// 3. Saneamento dos 517 registros divergentes
console.log('3. Executando saneamento de divergências legadas...');
const resSaneamento = sanearOrdensDivergentesExistentes(db);
console.log('   Saneamento concluído:', JSON.stringify({
  totalDivergentes: resSaneamento.totalDivergentes,
  abertos: resSaneamento.abertosCount,
  aguardandoRetirada: resSaneamento.aguardandoRetiradaCount
}));

// 4. Isolamento da OS 9202 em Kennedy
console.log('4. Executando isolamento e protocolo de investigação da OS 9202...');
const res9202 = isolarInvestigarOS9202(db);
console.log('   OS 9202 isolada:', res9202.isolado);
console.log('   Relatório de Auditoria:', JSON.stringify(res9202.relatorioAuditoria, null, 2));

// 5. Validação de Sanidade Final
console.log('\n--- Validação Estatística Final ---');
const totalRows = (db.prepare('SELECT count(*) as c FROM ordens_servico').get() as any).c;
console.log('Total de registros em ordens_servico:', totalRows);

const distribuicao = db.prepare(`
  SELECT estado_operacional, qualidade_dado, is_aberta, count(*) as count
  FROM ordens_servico
  GROUP BY estado_operacional, qualidade_dado, is_aberta
`).all();
console.table(distribuicao);

const auditSample = db.prepare(`
  SELECT os_id, loja_slug, status_grid, is_aberta, estado_operacional, qualidade_dado, data_inicio, data_inicio_iso, data_evento_iso, data_observacao_iso
  FROM ordens_servico
  WHERE os_id IN ('397', '9202', '578')
`).all();
console.table(auditSample);