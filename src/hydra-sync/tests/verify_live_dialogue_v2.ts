/**
 * Validação ao vivo da sequência de diálogo reportada pelo operador:
 * Turno 1: "faturamento das lojas"
 * Turno 2: "quais as travas que estamos tendo"
 */

import Database from 'better-sqlite3';
import { dispatchMessage } from '../agent_dispatcher.js';
import { getAgyConversationId } from '../turn_context_repository.js';
import { initHydraAccessAndMemorySchema } from '../db_repository.js';
import { saveUserProfile } from '../command_interceptor.js';

async function runLiveVerification() {
  console.log('🚀 Iniciando verificação ao vivo da conversa...\n');

  const dbPath = process.env.HYDRA_DB_PATH || '/home/operacional/hydra-data/hydra_ops.db';
  const db = new Database(dbPath);
  initHydraAccessAndMemorySchema(db);

  const phone = '5511996242812';

  // Garante persona 'socio' (visão de rede completa)
  saveUserProfile(db, {
    phone,
    persona: 'socio',
    defaultScope: 'rede',
    memoryGeneration: 1,
    updatedAt: new Date().toISOString()
  });

  // Turno 1: "faturamento das lojas"
  console.log('--- Turno 1: Envio de "faturamento das lojas" ---');
  const t1 = Date.now();
  const res1 = await dispatchMessage({
    phone,
    message: 'faturamento das lojas',
    db
  });
  console.log(`⏱️ Turno 1 concluído em ${Date.now() - t1}ms`);
  console.log(`Resposta Turno 1:\n${res1.messages.join('\n---\n')}\n`);

  const convIdAfterT1 = getAgyConversationId(db, phone);
  console.log(`🔑 agy_conversation_id após Turno 1: ${convIdAfterT1}`);

  if (!convIdAfterT1) {
    console.warn('⚠️ Atenção: agy_conversation_id não foi registrado no SQLite após Turno 1');
  }

  // Turno 2: "quais as travas que estamos tendo"
  console.log('\n--- Turno 2: Envio de "quais as travas que estamos tendo" ---');
  const t2 = Date.now();
  const res2 = await dispatchMessage({
    phone,
    message: 'quais as travas que estamos tendo',
    db
  });
  console.log(`⏱️ Turno 2 concluído em ${Date.now() - t2}ms`);
  console.log(`Resposta Turno 2:\n${res2.messages.join('\n---\n')}\n`);

  // Turno 3: "OSs jorge beretta"
  console.log('\n--- Turno 3: Envio de "OSs jorge beretta" ---');
  const t3 = Date.now();
  const res3 = await dispatchMessage({
    phone,
    message: 'OSs jorge beretta',
    db
  });
  console.log(`⏱️ Turno 3 concluído em ${Date.now() - t3}ms`);
  console.log(`Resposta Turno 3:\n${res3.messages.join('\n---\n')}\n`);

  // Turno 4: "/reset"
  console.log('\n--- Turno 4: Envio de "/reset" ---');
  const res4 = await dispatchMessage({
    phone,
    message: '/reset',
    db
  });
  console.log(`Resposta Turno 4:\n${res4.messages.join('\n---\n')}\n`);
  // Turno 5: "cmv das lojas" (inicia uma nova conversa no AGY CLI com novo UUID)
  console.log('\n--- Turno 5: Envio de "cmv das lojas" (Nova Conversa) ---');
  const t5 = Date.now();
  const res5 = await dispatchMessage({
    phone,
    message: 'cmv das lojas',
    db
  });
  console.log(`⏱️ Turno 5 concluído em ${Date.now() - t5}ms`);
  console.log(`Resposta Turno 5:\n${res5.messages.join('\n---\n')}\n`);

  const convIdAfterT5 = getAgyConversationId(db, phone);
  console.log(`🔑 Novo agy_conversation_id após Turno 5: ${convIdAfterT5}`);

  if (convIdAfterT5 && convIdAfterT5 !== convIdAfterT1) {
    console.log(`✅ Novo UUID gerado com sucesso: ${convIdAfterT5} !== ${convIdAfterT1}`);
  } else {
    console.warn(`⚠️ Atenção: Novo UUID não diferiu ou não foi salvo: ${convIdAfterT5}`);
  }

  console.log('\n🏁 Verificação de todos os 5 turnos concluída com sucesso!');
}

runLiveVerification().catch((err) => {
  console.error('Erro na execução:', err);
  process.exit(1);
});
