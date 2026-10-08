import assert from 'node:assert';
import Database from 'better-sqlite3';
import { getChecklistAudit } from '../db_repository.js';
import * as path from 'path';
import * as fs from 'fs';

console.log('[TEST] Iniciando teste de integridade da auditoria de checklists...');

const dbPath = process.env.HYDRA_DB_PATH || '/home/operacional/hydra-data/hydra_ops.db';

if (!fs.existsSync(dbPath)) {
  console.log(`[TEST SKIP] Banco não encontrado em ${dbPath}. Criando mock in-memory para teste.`);
  const memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE ordens_servico (
      os_id TEXT PRIMARY KEY,
      loja_slug TEXT,
      veiculo TEXT,
      placa TEXT,
      dias_no_patio INTEGER,
      data_inicio TEXT,
      status_grid TEXT,
      estado_operacional TEXT,
      is_aberta INTEGER,
      raw_payload TEXT
    );

    -- Veículo físico real em Santo André
    INSERT INTO ordens_servico VALUES ('OS_STO_1', 'MPSantoAndre', 'BMW 320i', 'GGR0E01', 3, '04/10/2026', 'EM EXECUÇÃO', 'PROCESSO', 1, '{"checklists":[]}');
    
    -- 22 Ordens antigas de Santo André (agosto/setembro) já finalizadas que continuavam como is_aberta=1 no ERP
    INSERT INTO ordens_servico VALUES ('OS_STO_OLD_1', 'MPSantoAndre', 'Celta', 'ABC1234', 0, '15/08/2026', 'ENCERRADA', 'CONCLUIDO', 1, '{"checklists":[]}');
    INSERT INTO ordens_servico VALUES ('OS_STO_OLD_2', 'MPSantoAndre', 'Gol', 'XYZ9876', 0, '20/09/2026', 'AGUARDANDO RETIRADA', 'CONCLUIDO', 1, '{"checklists":[]}');

    -- Veículos físicos reais em Rudge Ramos (6 carros)
    INSERT INTO ordens_servico VALUES ('OS_RUD_1', 'MPrudge', 'Focus', 'LLX5E81', 6, '01/10/2026', 'EM EXECUÇÃO', 'PROCESSO', 1, '{"checklists":[{"tipo":"inspecao"}]}');
    INSERT INTO ordens_servico VALUES ('OS_RUD_2', 'MPrudge', 'Tucson', 'GDZ7I78', 5, '02/10/2026', 'EM DIAGNOSTICO', 'PROCESSO', 1, '{"checklists":[]}');

    -- 20 Ordens antigas de Rudge Ramos
    INSERT INTO ordens_servico VALUES ('OS_RUD_OLD_1', 'MPrudge', 'Uno', 'UNO1111', 0, '10/08/2026', 'FINALIZADA', 'CONCLUIDO', 1, '{"checklists":[]}');
  `);

  const auditNetwork = getChecklistAudit(memDb);
  console.log('[TEST MOCK] Auditoria da Rede:', auditNetwork);
  assert.strictEqual(auditNetwork.total_os_abertas, 3, 'Deve auditar exatamente os 3 carros físicos reais');

  const auditStoAndre = getChecklistAudit(memDb, 'stoandre');
  console.log('[TEST MOCK] Auditoria Santo André:', auditStoAndre);
  assert.strictEqual(auditStoAndre.total_os_abertas, 1, 'Santo André deve ter apenas 1 carro auditado, não 3!');

  memDb.close();
  console.log('✅ [TEST SUCCESS] Teste em memória concluído com sucesso!');
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });

// 1. Auditoria consolidada da rede inteira
const auditRede = getChecklistAudit(db);
console.log(`[TEST REAL] Total de OSs auditadas na Rede: ${auditRede.total_os_abertas}`);
console.log(`[TEST REAL] Sem Checklist de Mecânico: ${auditRede.total_sem_checklist_mecanico}`);
console.log(`[TEST REAL] Sem Checklist de Entrada: ${auditRede.total_sem_checklist_entrada}`);

// Asserção: A rede tem ~30 a 40 carros físicos reais no pátio, NUNCA 179!
assert.ok(
  auditRede.total_os_abertas >= 25 && auditRede.total_os_abertas <= 50,
  `Total de veículos auditados na rede (${auditRede.total_os_abertas}) deve refletir o pátio físico (~30 a 40), não 179!`
);

// 2. Auditoria específica de Santo André
const auditStoAndre = getChecklistAudit(db, 'stoandre');
console.log(`[TEST REAL] Santo André auditado: ${auditStoAndre.total_os_abertas} carros.`);
assert.ok(
  auditStoAndre.total_os_abertas <= 2,
  `Santo André deve ter no máximo 1 a 2 veículos em pátio real auditados, não 23! (Obteve: ${auditStoAndre.total_os_abertas})`
);

// 3. Auditoria específica de Rudge Ramos
const auditRudge = getChecklistAudit(db, 'rudge');
console.log(`[TEST REAL] Rudge Ramos auditado: ${auditRudge.total_os_abertas} carros.`);
assert.ok(
  auditRudge.total_os_abertas <= 10,
  `Rudge Ramos deve ter no máximo ~6 veículos em pátio real auditados, não 30! (Obteve: ${auditRudge.total_os_abertas})`
);

db.close();
console.log('✅ [TEST SUCCESS] Validação contra banco SQLite real passou com louvor!');
