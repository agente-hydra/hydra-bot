import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { executeManagerStoreQuery, isOutsideManagerStore } from '../manager_store_access.js';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE metas_diarias (id INTEGER PRIMARY KEY, loja_slug TEXT, data_referencia TEXT, posicao_hora TEXT, faturamento_mes REAL, volume_os INTEGER, ticket_medio REAL, meta_mes REAL, percentual_meta REAL);
  CREATE TABLE cmv_lojas (id INTEGER PRIMARY KEY, loja_slug TEXT, data_inicio TEXT, data_fim TEXT, cmv_percentual REAL, faturamento_total REAL, custo_total REAL);
  CREATE TABLE faturamento_areas (id INTEGER PRIMARY KEY, loja_slug TEXT, area TEXT, data_inicio TEXT, data_fim TEXT, cmv_percentual REAL, faturamento REAL, custo REAL);
  CREATE TABLE ordens_servico (os_id TEXT, loja_slug TEXT, placa TEXT, veiculo TEXT, status_grid TEXT, is_aberta INTEGER, total_os REAL, valor_restante REAL, dias_no_patio INTEGER);
  INSERT INTO metas_diarias VALUES (1, 'MPdompedro1', '2026-09-30', '11:31', 100, 2, 50, 200, 50);
  INSERT INTO metas_diarias VALUES (2, 'MPkennedy', '2026-09-30', '11:31', 999999, 4, 249999, 1000000, 99);
  INSERT INTO cmv_lojas VALUES (1, 'MPdompedro1', '2026-09-01', '2026-09-30', 20, 100, 20);
  INSERT INTO cmv_lojas VALUES (2, 'MPkennedy', '2026-09-01', '2026-09-30', 99, 999999, 999998);
  INSERT INTO faturamento_areas VALUES (1, 'MPdompedro1', 'OLEO', '2026-09-01', '2026-09-30', 21, 50, 10);
  INSERT INTO faturamento_areas VALUES (2, 'MPkennedy', 'OLEO', '2026-09-01', '2026-09-30', 98, 999999, 999998);
  INSERT INTO ordens_servico VALUES ('101', 'MPdompedro1', 'AAA1111', 'Carro local', 'Aberta', 1, 100, 50, 2);
  INSERT INTO ordens_servico VALUES ('202', 'MPkennedy', 'BBB2222', 'SEGREDO_EXTERNO', 'Aberta', 1, 999999, 999999, 9);
`);

const local = 'MPdompedro1';
for (const text of ['faturamento da rede', 'faturamento das lojas', 'faturamento da Kennedy', 'OS de Kennedy.', 'CMV da unidade Master', 'ranking de faturamento']) {
  assert.equal(isOutsideManagerStore(text, local), true, text);
  const result = executeManagerStoreQuery(db, text, { intent: 'financial_alerts' } as any, local);
  assert.equal(result.allowed, false);
  assert.equal(result.toolsCalled[0], 'manager_scope_denied');
}

for (const [text, intent] of [
  ['faturamento da minha loja', { intent: 'financial_alerts' }],
  ['CMV de óleo da minha loja', { intent: 'store_cmv', targetArea: 'OLEO' }],
  ['quais OS estão abertas?', { intent: 'list_os' }],
  ['OS 202', { intent: 'os_detail', osId: '202' }],
] as const) {
  const result = executeManagerStoreQuery(db, text, intent as any, local);
  assert.equal(result.allowed, true, text);
  assert.doesNotMatch(result.replyText, /999999|SEGREDO_EXTERNO|Kennedy|BBB2222/);
}

assert.match(executeManagerStoreQuery(db, 'faturamento da minha loja', { intent: 'financial_alerts' } as any, local).replyText, /R\$\s*100,00/);
assert.match(executeManagerStoreQuery(db, 'OS abertas', { intent: 'list_os' } as any, local).replyText, /Carro local/);
assert.match(executeManagerStoreQuery(db, 'OS 202', { intent: 'os_detail', osId: '202' } as any, local).replyText, /Nenhuma OS encontrada/);
assert.equal(executeManagerStoreQuery(db, 'dados', { intent: 'checklist_audit' } as any, local).allowed, false);
console.log('manager store access: PASS');
