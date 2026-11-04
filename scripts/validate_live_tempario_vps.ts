import Database from 'better-sqlite3';
import { dispatchMessage } from '../src/hydra-sync/agent_dispatcher.js';

async function main() {
  const dbPath = process.env.HYDRA_DB_PATH || '/home/operacional/hydra-data/hydra_ops.db';
  const db = new Database(dbPath);

  console.log('--- TESTE 1: Golf 1.4 TSI (Turno 1) ---');
  const r1 = await dispatchMessage({
    phone: '5511996242812',
    message: 'Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?',
    db,
    skipIdempotencyCheck: true
  });
  console.log(r1.replyText);

  console.log('\n--- TESTE 2: Turno 2 (Opção "1" - Peças) ---');
  const r2 = await dispatchMessage({
    phone: '5511996242812',
    message: '1',
    db,
    skipIdempotencyCheck: true
  });
  console.log(r2.replyText);

  console.log('\n--- TESTE 3: Corsa 2010 (Modelo Aberto) ---');
  const r3 = await dispatchMessage({
    phone: '5511996242812',
    message: 'troca farol diranteiro lado direito corsa 2010',
    db,
    skipIdempotencyCheck: true
  });
  console.log(r3.replyText);
}

main().catch(console.error);
