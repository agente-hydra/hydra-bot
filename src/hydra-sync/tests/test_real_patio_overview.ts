import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getPatioOverview, getStoreDrilldown, getOpenOSCounts } from '../db_repository.js';

console.log('=== TESTE DE CÁLCULO DE PÁTIO FÍSICO REAL VS PENDÊNCIAS ADMINISTRATIVAS ===');

const db = new Database(':memory:');

// 1. Criação do schema representativo
db.exec(`
  CREATE TABLE ordens_servico (
    os_id TEXT PRIMARY KEY,
    loja_slug TEXT,
    status_grid TEXT,
    is_aberta INTEGER,
    data_inicio TEXT,
    data_fim TEXT,
    dias_no_patio INTEGER,
    veiculo TEXT,
    placa TEXT,
    cliente_nome TEXT,
    responsavel TEXT,
    total_os REAL,
    valor_pago REAL,
    valor_restante REAL,
    raw_payload TEXT,
    estado_operacional TEXT
  );

  CREATE TABLE metas_diarias (
    id INTEGER PRIMARY KEY,
    loja_slug TEXT,
    faturamento_mes REAL,
    volume_os INTEGER,
    ticket_medio REAL,
    data_referencia TEXT,
    posicao_hora TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE checklists (
    os_id TEXT,
    tipo_checklist TEXT,
    status TEXT
  );
`);

// 2. Inserção de dados simulando Santo André (1 real + 22 fantasmas de agosto/setembro)
// Ordem Real de Outubro
db.prepare(`
  INSERT INTO ordens_servico (
    os_id, loja_slug, status_grid, is_aberta, data_inicio, dias_no_patio, veiculo, placa, total_os, valor_pago, valor_restante, estado_operacional
  ) VALUES (
    '2470', 'MPSantoAndre', 'VEICULO EM EXECUÇÃO', 1, '06/10/26 10:00', 1, 'BMW 320I', 'GGR0E01', 7000.0, 0.0, 7000.0, 'ABERTA'
  )
`).run();

// 22 Ordens Fantasmas de Agosto/Setembro (Quitadas, dias_no_patio = 0, status AGUARDANDO RETIRADA)
for (let i = 1; i <= 22; i++) {
  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, status_grid, is_aberta, data_inicio, dias_no_patio, veiculo, placa, total_os, valor_pago, valor_restante, estado_operacional
    ) VALUES (
      ?, 'MPSantoAndre', 'AGUARDANDO RETIRADA', 1, '31/08/26 14:00', 0, 'CARRO ANTIGO', 'ABC1234', 2000.0, 2000.0, 0.0, 'ABERTA'
    )
  `).run('ghost_' + i);
}

// Inserção de dados simulando Jabaquara (3 reais + 12 fantasmas)
for (let i = 1; i <= 3; i++) {
  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, status_grid, is_aberta, data_inicio, dias_no_patio, veiculo, placa, total_os, valor_pago, valor_restante, estado_operacional
    ) VALUES (
      ?, 'MPJabaquara', 'EM DIAGNOSTICO', 1, '05/10/26 09:00', 2, 'VEICULO ATIVO', 'XYZ9876', 3000.0, 1000.0, 2000.0, 'ABERTA'
    )
  `).run('jab_real_' + i);
}

for (let i = 1; i <= 12; i++) {
  db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, status_grid, is_aberta, data_inicio, dias_no_patio, veiculo, placa, total_os, valor_pago, valor_restante, estado_operacional
    ) VALUES (
      ?, 'MPJabaquara', 'AGUARDANDO RETIRADA', 1, '28/08/26 10:00', 0, 'CARRO ENCERRADO', 'GHO0000', 1500.0, 1500.0, 0.0, 'ABERTA'
    )
  `).run('jab_ghost_' + i);
}

// 3. Teste de getPatioOverview
console.log('\n[1/3] Testando getPatioOverview com separação de pátio físico...');
const overview = getPatioOverview(db);
console.table(overview);

const sa = overview.find(o => o.loja_slug === 'MPSantoAndre');
assert.ok(sa, 'Santo André deve constar no relatório de pátio');
assert.equal(sa.veiculos_patio_fisico, 1, 'Santo André deve ter exatamente 1 veículo no pátio físico');
assert.equal(sa.total_abertas, 1, 'total_abertas deve refletir os veículos físicos reais (1 e não 23)');
assert.equal(sa.pendencias_baixa_erp, 22, 'Santo André deve ter 22 pendências administrativas de baixa');
assert.equal(sa.total_abertas_sistema, 23, 'total_abertas_sistema deve reportar 23 para rastreabilidade contábil');
assert.equal(sa.total_restante, 7000.0, 'Saldo a receber do pátio deve ser estritamente da OS física ativa (R$ 7.000,00)');

const jab = overview.find(o => o.loja_slug === 'MPJabaquara');
assert.ok(jab, 'Jabaquara deve constar no relatório de pátio');
assert.equal(jab.veiculos_patio_fisico, 3, 'Jabaquara deve ter exatamente 3 veículos no pátio físico');
assert.equal(jab.pendencias_baixa_erp, 12, 'Jabaquara deve ter 12 pendências de baixa');
assert.equal(jab.total_abertas, 3, 'total_abertas de Jabaquara deve ser 3');
console.log('✅ getPatioOverview validado com sucesso!');

// 4. Teste de getStoreDrilldown
console.log('\n[2/3] Testando getStoreDrilldown para Santo André...');
const drilldownSA = getStoreDrilldown(db, 'MPSantoAndre');
assert.equal(drilldownSA.total_veiculos_patio, 1, 'total_veiculos_patio no drilldown deve ser 1');
assert.equal(drilldownSA.confirmed_open, 1, 'confirmed_open no drilldown deve ser 1');
assert.equal(drilldownSA.veiculos_patio_fisico, 1, 'veiculos_patio_fisico no drilldown deve ser 1');
assert.equal(drilldownSA.pendencias_baixa_erp, 22, 'pendencias_baixa_erp no drilldown deve ser 22');
assert.equal(drilldownSA.saldo_total_receber, 7000.0, 'saldo_total_receber deve ser R$ 7.000,00');
console.log('✅ getStoreDrilldown validado com sucesso!');

// 5. Teste de getOpenOSCounts
console.log('\n[3/3] Testando getOpenOSCounts...');
const countsSA = getOpenOSCounts(db, 'MPSantoAndre');
assert.equal(countsSA.confirmed_open, 1, 'confirmed_open em getOpenOSCounts deve ser 1');
assert.equal(countsSA.veiculos_patio_fisico, 1, 'veiculos_patio_fisico deve ser 1');
assert.equal(countsSA.pendencias_baixa_erp, 22, 'pendencias_baixa_erp deve ser 22');

console.log('\n🎉 TODOS OS TESTES DE PÁTIO FÍSICO REAL PASSARAM COM SUCESSO!\n');
