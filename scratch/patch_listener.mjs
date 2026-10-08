import fs from "fs";

// Read existing file and normalize newlines
let code = fs.readFileSync("C:/Users/User/Desktop/agy/scratch/remote_webhook_listener.js", "utf8");
code = code.replace(/\r\n/g, "\n");

function replaceStrict(search, replacement, label) {
  if (!code.includes(search)) {
    throw new Error(`Replacement failed for [${label}]: string not found!`);
  }
  code = code.replace(search, replacement);
  console.log(`✓ Applied [${label}]`);
}

// 1. Add message_lifecycle table in SQLite init
const tableSearch = `    CREATE TABLE IF NOT EXISTS message_reactions (`;
const tableReplace = `    CREATE TABLE IF NOT EXISTS message_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      batch_id TEXT,
      state TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_lifecycle_msg_id ON message_lifecycle(message_id);

    CREATE TABLE IF NOT EXISTS message_reactions (`;
replaceStrict(tableSearch, tableReplace, "Table message_lifecycle");

// 2. Add recordLifecycleState helper after recordMessageReaction
const funcSearch = `function recordMessageReaction(messageId, remoteJid, reaction, statusHttp, sucesso, duracaoMs, respostaRaw, erro) {`;
const funcReplace = `/**
 * Registra estados determinísticos do ciclo de vida da mensagem:
 * evolution_received -> webhook_sent -> hydra_accepted -> batch_closed -> job_processing -> job_processed -> whatsapp_sent
 */
function recordLifecycleState(messageId, state, batchId = null, details = null) {
  if (!messageId || !db) return;
  try {
    db.prepare(\`
      INSERT INTO message_lifecycle (message_id, batch_id, state, details)
      VALUES (?, ?, ?, ?)
    \`).run(messageId, batchId || null, state, details ? String(details).slice(0, 300) : null);
    console.log(\`[Lifecycle] #\${messageId} -> \${state}\${batchId ? \` (batch: \${batchId})\` : ""}\${details ? \` [\${details}]\` : ""}\`);
  } catch (err) {
    console.warn(\`[Lifecycle] Falha ao registrar estado \${state} para #\${messageId}:\`, err?.message || err);
  }
}

function recordMessageReaction(messageId, remoteJid, reaction, statusHttp, sucesso, duracaoMs, respostaRaw, erro) {`;
replaceStrict(funcSearch, funcReplace, "Helper recordLifecycleState");

// 3. Fix handleIncomingPayload anti-loop: remove payload?.data?.status
const badAntiLoop = `  // 1. Proteção Anti-Loop: Ignora mensagens enviadas pelo próprio bot ou de status
  if (
    payload?.data?.key?.fromMe === true ||
    payload?.message_type === "outgoing" ||
    payload?.event === "messages.update" ||
    payload?.data?.status
  ) {
    return { statusCode: 200, body: { status: "ignored_outgoing_or_status" } };
  }`;

const fixedAntiLoop = `  // 1. Proteção Anti-Loop: Ignora mensagens enviadas pelo próprio bot, updates e status@broadcast
  if (
    payload?.data?.key?.fromMe === true ||
    payload?.message_type === "outgoing" ||
    payload?.event === "messages.update" ||
    payload?.data?.key?.remoteJid === "status@broadcast"
  ) {
    return { statusCode: 200, body: { status: "ignored_outgoing_or_status" } };
  }`;
replaceStrict(badAntiLoop, fixedAntiLoop, "Fix Anti-Loop (Remove data.status)");

// 4. In closeBatch, record batch_closed for each messageId
const closeBatchSearch = `this.persistBatchState(batch, 'CLOSED', combinedText);`;
const closeBatchReplace = `this.persistBatchState(batch, 'CLOSED', combinedText);
    for (const mId of batch.messageIds) {
      recordLifecycleState(mId, 'batch_closed', batch.batchId);
    }`;
replaceStrict(closeBatchSearch, closeBatchReplace, "Record batch_closed");

// 5. In processChatQueue, record job_processing, job_processed, whatsapp_sent, job_failed
const queueJobSearch = `      const timeStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      console.log(\`[\${timeStr}] 📩 [AsyncQueue] Processando job #\${job.messageId} de \${job.phone}: "\${job.text}"\`);

      // Inicia "digitando" contínuo exatamente quando a conversa chega à sua vez de execução
      chatQ.typing.start();

      try {
        const replies = await runDispatcherAsync(job.phone, job.text, job.conversationId, job.messageId, job.batch);

        // Encerra imediatamente o "digitando" antes de iniciar a entrega do primeiro balão
        await chatQ.typing.stop();

        console.log(\`  ↳ [AsyncQueue] Despachando \${replies.length} balão(ões) para \${job.phone}...\`);
        await sendSequentialReplies(job.phone, replies);
        console.log(\`  ✓ [AsyncQueue] Envio concluído e auditado para \${job.phone}.\`);
      } catch (jobErr) {
        console.error(\`[AsyncQueue] Erro ao processar job #\${job.messageId}:\`, jobErr);
        await chatQ.typing.stop();
        await sendReplyWhatsApp(job.phone, "Ocorreu uma instabilidade momentânea ao processar sua mensagem. Por favor, tente novamente.");
      }`;

const queueJobReplace = `      const timeStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      console.log(\`[\${timeStr}] 📩 [AsyncQueue] Processando job #\${job.messageId} de \${job.phone}: "\${job.text}"\`);

      const targetMsgIds = job.messageIds && job.messageIds.length > 0 ? job.messageIds : [job.messageId];
      for (const mId of targetMsgIds) {
        recordLifecycleState(mId, 'job_processing', job.batch?.batchId);
      }

      // Inicia "digitando" contínuo exatamente quando a conversa chega à sua vez de execução
      chatQ.typing.start();

      try {
        const replies = await runDispatcherAsync(job.phone, job.text, job.conversationId, job.messageId, job.batch);

        // Encerra imediatamente o "digitando" antes de iniciar a entrega do primeiro balão
        await chatQ.typing.stop();

        for (const mId of targetMsgIds) {
          recordLifecycleState(mId, 'job_processed', job.batch?.batchId, \`\${replies.length} replies\`);
        }

        console.log(\`  ↳ [AsyncQueue] Despachando \${replies.length} balão(ões) para \${job.phone}...\`);
        await sendSequentialReplies(job.phone, replies);
        console.log(\`  ✓ [AsyncQueue] Envio concluído e auditado para \${job.phone}.\`);

        for (const mId of targetMsgIds) {
          recordLifecycleState(mId, 'whatsapp_sent', job.batch?.batchId);
        }
      } catch (jobErr) {
        console.error(\`[AsyncQueue] Erro ao processar job #\${job.messageId}:\`, jobErr);
        await chatQ.typing.stop();
        for (const mId of targetMsgIds) {
          recordLifecycleState(mId, 'job_failed', job.batch?.batchId, jobErr?.message);
        }
        await sendReplyWhatsApp(job.phone, "Ocorreu uma instabilidade momentânea ao processar sua mensagem. Por favor, tente novamente.");
      }`;
replaceStrict(queueJobSearch, queueJobReplace, "Record job_processing / processed / sent / failed");

// 6. In handleIncomingPayload, record hydra_accepted and ensure targetJid preserves LID
const acceptedSearch = `  // 7. Adiciona à janela de encavalamento (debounce deslizante de 700ms por conversa)
  const batchRes = messageBatcher.addMessage(part, undefined, async (batch) => {`;

const acceptedReplace = `  // 6.1 Registro de estado de aceite no ciclo de vida
  recordLifecycleState(messageId, 'hydra_accepted', null);

  // 7. Adiciona à janela de encavalamento (debounce deslizante de 700ms por conversa)
  const batchRes = messageBatcher.addMessage(part, undefined, async (batch) => {`;
replaceStrict(acceptedSearch, acceptedReplace, "Record hydra_accepted");

// Also update targetJid in step 6:
const reactionTargetSearch = `    const targetJid = rawRemoteJid.includes("@") ? rawRemoteJid : \`\${phone}@s.whatsapp.net\`;`;
const reactionTargetReplace = `    const targetJid = payload?.data?.key?.remoteJid || (rawRemoteJid.includes("@") ? rawRemoteJid : \`\${phone}@s.whatsapp.net\`);`;
replaceStrict(reactionTargetSearch, reactionTargetReplace, "Preserve LID in reaction targetJid");

// 7. Export recordLifecycleState
const exportSearch = `  recordMessageReaction,`;
const exportReplace = `  recordMessageReaction,
  recordLifecycleState,`;
replaceStrict(exportSearch, exportReplace, "Export recordLifecycleState");

fs.writeFileSync("C:/Users/User/Desktop/agy/scratch/updated_webhook_listener.js", code, "utf8");
console.log("All replacements verified strictly! File written. Size:", code.length);
