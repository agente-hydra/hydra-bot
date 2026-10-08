const Database = require('/opt/bots/node_modules/better-sqlite3');
const fs = require('fs');

const dbPath = '/home/operacional/hydra-data/hydra_ops.db';
console.log('--- AUDITORIA HYDRA BOT: BANCO, VETORES, GRAFO E MEMORIA ---');
console.log('Database Path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('Database does not exist at path!');
  process.exit(1);
}

const db = new Database(dbPath);

// Tenta carregar sqlite-vec se disponível
let vecLoaded = false;
try {
  const sqliteVec = require('/opt/bots/node_modules/sqlite-vec');
  sqliteVec.load(db);
  vecLoaded = true;
  console.log('sqlite-vec extension loaded: SUCCESS');
} catch (e) {
  console.log('sqlite-vec extension loaded: FAILED/NOT FOUND (' + e.message + ')');
}

// 1. TABELAS E CONTAGEM DE LINHAS
console.log('\n=== 1. TABELAS DO BANCO (SQLITE) ===');
const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

const tableStats = [];
for (const t of tables) {
  try {
    const countRow = db.prepare(`SELECT count(*) as total FROM "${t.name}"`).get();
    tableStats.push({ name: t.name, type: t.type, rows: countRow.total });
  } catch (err) {
    tableStats.push({ name: t.name, type: t.type, rows: 'ERROR: ' + err.message });
  }
}
console.table(tableStats);

// 2. VETORIZAÇÃO (VEC_ORDENS_SERVICO E AFINS)
console.log('\n=== 2. VETORIZAÇÃO (EMBEDDINGS / VEC) ===');
const vecTables = tables.filter(t => t.name.startsWith('vec_') || t.name.includes('vector') || t.name.includes('embedding'));
console.log('Tabelas com prefixo vec/vector:', vecTables.map(t => t.name));

for (const vt of vecTables) {
  try {
    const info = db.prepare(`SELECT count(*) as total FROM "${vt.name}"`).get();
    console.log(`- ${vt.name}: ${info.total} vetores indexados.`);
  } catch (e) {
    console.log(`- ${vt.name}: erro ao contar (${e.message})`);
  }
}

// Verifica schema de vec_ordens_servico se existir
try {
  const schemaVec = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_ordens_servico'").get();
  if (schemaVec) {
    console.log('\nSchema de vec_ordens_servico:');
    console.log(schemaVec.sql);
  }
} catch(e) {}

// 3. GRAFO DE ATENDIMENTOS E PROJEÇÕES
console.log('\n=== 3. GRAFO DE ATENDIMENTOS ===');
const graphTables = tables.filter(t => t.name.includes('grafo') || t.name.includes('case_') || t.name.includes('atendimento') || t.name.includes('projection'));
console.log('Tabelas de grafo/projeção identificadas:', graphTables.map(t => t.name));

for (const gt of graphTables) {
  try {
    const row = db.prepare(`SELECT count(*) as total FROM "${gt.name}"`).get();
    console.log(`- ${gt.name}: ${row.total} registros.`);
  } catch(e) {
    console.log(`- ${gt.name}: erro (${e.message})`);
  }
}

// 4. MEMÓRIA DE TURNO, CACHE E SESSÕES
console.log('\n=== 4. MEMÓRIA CONVERSACIONAL E TURNOS ===');
const memoryTables = tables.filter(t => t.name.includes('turn') || t.name.includes('memory') || t.name.includes('session') || t.name.includes('context') || t.name.includes('cache'));
console.log('Tabelas de memória/turnos:', memoryTables.map(t => t.name));

for (const mt of memoryTables) {
  try {
    const row = db.prepare(`SELECT count(*) as total FROM "${mt.name}"`).get();
    console.log(`- ${mt.name}: ${row.total} registros.`);
  } catch(e) {
    console.log(`- ${mt.name}: erro (${e.message})`);
  }
}

// 5. AMOSTRAS RECENTES DE ATENDIMENTO / MEMÓRIA
console.log('\n=== 5. AMOSTRA DE TURNOS / RECENT ACTIVITY ===');
try {
  if (tables.some(t => t.name === 'turn_contexts')) {
    const sample = db.prepare("SELECT phone, updated_at FROM turn_contexts ORDER BY updated_at DESC LIMIT 5").all();
    console.log('Últimos turn_contexts:', sample);
  }
} catch(e) {
  console.log('Erro ao ler turn_contexts:', e.message);
}

try {
  if (tables.some(t => t.name === 'hydra_turn_states')) {
    const sample = db.prepare("SELECT phone, updated_at, last_intent FROM hydra_turn_states ORDER BY updated_at DESC LIMIT 5").all();
    console.log('Últimos hydra_turn_states:', sample);
  }
} catch(e) {
  console.log('Erro ao ler hydra_turn_states:', e.message);
}

// 6. PRAGMAS DE INTEGRIDADE E PERFORMANCE
console.log('\n=== 6. INTEGRIDADE E PRAGMAS DO SQLITE ===');
const journalMode = db.prepare("PRAGMA journal_mode").get();
const synchronous = db.prepare("PRAGMA synchronous").get();
const foreignKeys = db.prepare("PRAGMA foreign_keys").get();
const integrity = db.prepare("PRAGMA integrity_check").get();

console.log('Journal Mode:', journalMode);
console.log('Synchronous:', synchronous);
console.log('Foreign Keys:', foreignKeys);
console.log('Integrity Check:', integrity);
