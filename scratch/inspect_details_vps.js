const Database = require('/opt/bots/node_modules/better-sqlite3');
const db = new Database('/home/operacional/hydra-data/hydra_ops.db');

console.log('=== SCHEMA: hydra_user_memory ===');
console.table(db.prepare("PRAGMA table_info(hydra_user_memory)").all());
console.log('Conteúdo:', db.prepare("SELECT * FROM hydra_user_memory").all());

console.log('\n=== SCHEMA: hydra_turn_contexts ===');
console.table(db.prepare("PRAGMA table_info(hydra_turn_contexts)").all());

console.log('\n=== DETALHES DE OS POR LOJA: ordens_servico ===');
const osCountByStore = db.prepare("SELECT loja_slug, count(*) as total, sum(is_aberta) as abertas FROM ordens_servico GROUP BY loja_slug").all();
console.table(osCountByStore);

console.log('\n=== VEC_ORDENS_SERVICO AMOSTRA ===');
const vecSample = db.prepare("SELECT rowid, os_key FROM vec_ordens_servico LIMIT 5").all();
console.table(vecSample);
