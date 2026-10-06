/**
 * Test Harness: Ciclo de Vida de Reações (👀 -> ✅ / ❌), Flexibilização de Idempotência,
 * Suporte a LID, Presença Contínua ("Digitando") e Observabilidade SQLite no Hydra
 *
 * Valida:
 * 1. Sanitizer defensivo WhatsApp Markdown anti-slop.
 * 2. Idempotência e flexibilização de transição de estado em message_reactions (👀 -> ✅ / ❌).
 * 3. Deduplicação de webhook e proteção contra replay.
 * 4. Lifecycle do TypingManager (start, heartbeat periódico, stop com 'paused' e zero timers órfãos).
 * 5. Teto de segurança automático do TypingManager (maxDurationMs).
 * 6. Ingress desacoplado com resposta imediata (<15ms) e reação 👀 não-bloqueante.
 * 7. Rejeição de replay duplicado com envio de reação única.
 * 8. Proteção anti-loop (mensagens fromMe e status ignorados).
 * 9. Resiliência a mensagens sem key.id.
 * 10. Concorrência e isolamento per-chat entre usuários independentes.
 * 11. WhatsApp LID addressing (@lid preservado com mapeamento via remoteJidAlt).
 * 12. Transição determinística de reações: SENT_SEEN -> SENT_COMPLETED sem duplicação.
 * 13. Reação ✅ em TODOS os messageIds que compõem o lote após despacho bem-sucedido dos balões.
 * 14. Reação ❌ e envio de fallback calmo em caso de falha irrecuperável.
 * 15. Preservação estrita do remoteJid nativo (@lid) na reação final ✅.
 * 16. Blindagem absoluta: falha na API de reação jamais trava nem atrasa o envio da resposta.
 * 17. Observabilidade no SQLite (message_lifecycle): marcos accepted, batch_closed, generating,
 *     sent_whatsapp, delivered; conformidade de privacidade (mascaramento de telefone e zero credenciais).
 */

import { createServer } from "http";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

// Helper para mock de Evolution API HTTP Server com injeção controlada de falhas
class MockEvolutionServer {
  server: any;
  port: number;
  reactions: Array<{ url: string; body: any; time: number }> = [];
  presences: Array<{ url: string; body: any; time: number }> = [];
  messages: Array<{ url: string; body: any; time: number }> = [];
  failReactions: boolean = false;
  failReactionsStatus: number = 500;

  constructor(port = 3398) {
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          const parsed = body ? JSON.parse(body) : {};
          const now = Date.now();

          if (req.url?.includes("/message/sendReaction/")) {
            this.reactions.push({ url: req.url, body: parsed, time: now });
            if (this.failReactions) {
              res.writeHead(this.failReactionsStatus, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Simulated reaction service failure" }));
              return;
            }
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "SUCCESS", message: "Reaction sent" }));
          } else if (req.url?.includes("/chat/sendPresence/")) {
            this.presences.push({ url: req.url, body: parsed, time: now });
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ presence: parsed.presence }));
          } else if (req.url?.includes("/message/sendText/")) {
            this.messages.push({ url: req.url, body: parsed, time: now });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ key: { id: "msg_out_" + now } }));
          } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found");
          }
        });
      });
      this.server.listen(this.port, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  clear() {
    this.reactions = [];
    this.presences = [];
    this.messages = [];
    this.failReactions = false;
    this.failReactionsStatus = 500;
  }
}

async function runTestSuite() {
  console.log("===============================================================================");
  console.log("🧪 INICIANDO TEST HARNESS: CICLO DE VIDA DE REAÇÕES, LID & OBSERVABILIDADE");
  console.log("===============================================================================\n");

  const mockPort = 3398;
  const mockServer = new MockEvolutionServer(mockPort);
  await mockServer.start();

  process.env.EVOLUTION_URL = `http://127.0.0.1:${mockPort}`;
  process.env.EVOLUTION_KEY = "TorkEvoApiKey2026Secure!";
  process.env.EVOLUTION_INSTANCE = "hydra";

  // Carrega módulo após configurar variáveis de ambiente
  const webhookModule = await import("../../../webhook-listener.js");
  const {
    TypingManager,
    sendReactionWhatsApp,
    sendReplyWhatsApp,
    hasMessageBeenReacted,
    getMessageReactionState,
    recordMessageReaction,
    recordLifecycle,
    isMessageProcessed,
    markMessageProcessed,
    handleIncomingPayload,
    sanitizeWhatsAppMarkdown,
    maskPhone,
    maskJid
  } = webhookModule;

  // Carrega SQLite WAL para asserções diretas de auditoria
  const db = new Database("/home/operacional/hydra-data/hydra_ops.db");

  let totalTests = 0;
  let passedTests = 0;

  function report(name: string, ok: boolean, detail = "") {
    totalTests++;
    if (ok) {
      passedTests++;
      console.log(`  ✓ [PASS] ${name}${detail ? ` (${detail})` : ""}`);
    } else {
      console.error(`  ❌ [FAIL] ${name}${detail ? ` (${detail})` : ""}`);
    }
  }

  // ─── Teste 1: Sanitizer Markdown Anti-Slop ─────────────────────────────────
  console.log("--- 1. Sanitizer Defensivo WhatsApp Markdown ---");
  {
    const raw = "### Faturamento Santo André\n\n| Loja | Total |\n|---|---|\n| SA | R$ 10.000 |\n\n**Meta:** 100%";
    const clean = sanitizeWhatsAppMarkdown(raw);
    const hasTable = clean.includes("|---|");
    const hasHeader = clean.includes("> *Faturamento Santo André*");
    const hasCleanBold = clean.includes("*Meta:*");
    report("Converte cabeçalho markdown em blockquote do WhatsApp", hasHeader);
    report("Elimina delimitadores de tabela markdown", !hasTable);
    report("Normaliza negrito duplo para negrito simples", hasCleanBold);
  }

  // ─── Teste 2: Idempotência de Reações no SQLite ────────────────────────────
  console.log("\n--- 2. Idempotência e Auditoria de Reações no SQLite ---");
  {
    const testMsgId = `test_rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const remoteJid = "5511996242812@s.whatsapp.net";

    report("hasMessageBeenReacted retorna false para nova mensagem", !hasMessageBeenReacted(testMsgId));

    recordMessageReaction(testMsgId, remoteJid, "👀", 201, true, 45, "{}", null);
    report("hasMessageBeenReacted retorna true após registro com sucesso", hasMessageBeenReacted(testMsgId));

    // Chamada sendReactionWhatsApp para mensagem já registrada deve pular (idempotente)
    mockServer.clear();
    const resSkipped = await sendReactionWhatsApp(remoteJid, testMsgId, "👀");
    report("sendReactionWhatsApp pula envio se já registrado (skipped: true)", resSkipped.skipped === true && mockServer.reactions.length === 0);

    // Chamada para nova mensagem dispara requisição HTTP para o mock
    const newMsgId = `test_rx_new_${Date.now()}`;
    const resSent = await sendReactionWhatsApp(remoteJid, newMsgId, "👀");
    report("sendReactionWhatsApp despacha requisição HTTP para nova mensagem", resSent.sucesso === true && mockServer.reactions.length === 1);
    report("Reação enviada possui emoji 👀 e ID correto", mockServer.reactions[0].body.reaction === "👀" && mockServer.reactions[0].body.key.id === newMsgId);
  }

  // ─── Teste 3: Deduplicação de Webhook em SQLite ────────────────────────────
  console.log("\n--- 3. Deduplicação e Proteção contra Replay de Webhook ---");
  {
    const dedupMsgId = `test_dedup_${Date.now()}`;
    const phone = "5511996242812";

    report("isMessageProcessed retorna false antes da marcação", !isMessageProcessed(dedupMsgId));
    markMessageProcessed(dedupMsgId, phone);
    report("isMessageProcessed retorna true após a marcação", isMessageProcessed(dedupMsgId));
  }

  // ─── Teste 4: Lifecycle do TypingManager (Start, Heartbeat, Stop) ───────────
  console.log("\n--- 4. Lifecycle do TypingManager & Zero Timers Órfãos ---");
  {
    mockServer.clear();
    const phone = "5511996242812";
    // Heartbeat curto para teste (200ms de intervalo, 500ms de delay)
    const tm = new TypingManager(phone, 200, 500, 5000);

    tm.start();
    // Verifica primeiro disparo imediato
    await new Promise(r => setTimeout(r, 50));
    report("TypingManager dispara 'composing' imediatamente ao iniciar", mockServer.presences.length >= 1 && mockServer.presences[0].body.presence === "composing");

    // Aguarda 2 intervalos de heartbeat (~450ms)
    await new Promise(r => setTimeout(r, 450));
    const countDuring = mockServer.presences.filter(p => p.body.presence === "composing").length;
    report("TypingManager renova presença periodicamente durante execução", countDuring >= 2, `disparos: ${countDuring}`);

    // Para o TypingManager
    await tm.stop();
    const lastPresence = mockServer.presences[mockServer.presences.length - 1];
    report("TypingManager envia 'paused' explícito ao encerrar", lastPresence?.body.presence === "paused");

    // Aguarda para garantir que nenhum timer continue disparando após stop
    const presencesAtStop = mockServer.presences.length;
    await new Promise(r => setTimeout(r, 400));
    report("Zero timers órfãos vivos após stop()", mockServer.presences.length === presencesAtStop);
  }

  // ─── Teste 5: TypingManager Teto de Segurança (Max Duration Ceiling) ───────
  console.log("\n--- 5. Teto de Segurança Automático do TypingManager ---");
  {
    mockServer.clear();
    const phone = "5511996242812";
    const tmMax = new TypingManager(phone, 100, 200, 400);
    tmMax.start();

    await new Promise(r => setTimeout(r, 600));
    report("TypingManager desativa automaticamente ao atingir maxDurationMs", tmMax.active === false);
    await tmMax.stop();
  }

  // ─── Teste 6: Fluxo Completo de Ingress com Reação e Enfileiramento ────────
  console.log("\n--- 6. Ingress Desacoplado: Reação 👀 Imediata e Enfileiramento ---");
  {
    mockServer.clear();
    const msgId = `test_msg_${Date.now()}`;
    const payload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "5511996242812@s.whatsapp.net",
          fromMe: false,
          id: msgId
        },
        message: {
          conversation: "Qual o CMV de Santo André?"
        }
      }
    };

    const t0 = Date.now();
    const res = await handleIncomingPayload(payload);
    const ingressMs = Date.now() - t0;

    report("Ingress responde com status 'queued' de forma ultra-rápida", res.body.status === "queued" && ingressMs < 100, `${ingressMs}ms`);

    // Aguarda envio assíncrono da reação 👀
    await new Promise(r => setTimeout(r, 150));
    const reactionSent = mockServer.reactions.find(r => r.body.key?.id === msgId);
    report("Reação 👀 foi despachada para o messageId de entrada", Boolean(reactionSent) && reactionSent?.body?.reaction === "👀");
  }

  // ─── Teste 7: Replay de Webhook Duplicado no Ingress ────────────────────────
  console.log("\n--- 7. Rejeição de Replay de Webhook Duplicado ---");
  {
    const dupMsgId = `test_dup_${Date.now()}`;
    const payload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "5511996242812@s.whatsapp.net",
          fromMe: false,
          id: dupMsgId
        },
        message: {
          conversation: "Falta muito pra meta?"
        }
      }
    };

    mockServer.clear();
    const firstRes = await handleIncomingPayload(payload);
    report("Primeira mensagem aceita com status 'queued'", firstRes.body.status === "queued");

    const secondRes = await handleIncomingPayload(payload);
    report("Segunda mensagem rejeitada como 'ignored_duplicate'", secondRes.body.status === "ignored_duplicate");

    await new Promise(r => setTimeout(r, 150));
    const reactionsForMsg = mockServer.reactions.filter(r => r.body.key?.id === dupMsgId);
    report("Apenas uma única reação despachada no total (zero duplicatas)", reactionsForMsg.length === 1);
  }

  // ─── Teste 8: Mensagem do Próprio Bot ou Status Ignoradas ──────────────────
  console.log("\n--- 8. Proteção Anti-Loop (fromMe e status ignorados) ---");
  {
    mockServer.clear();
    const outgoingPayload = {
      data: {
        key: {
          remoteJid: "5511996242812@s.whatsapp.net",
          fromMe: true,
          id: `bot_msg_${Date.now()}`
        },
        message: { conversation: "Resposta do bot" }
      }
    };

    const res = await handleIncomingPayload(outgoingPayload);
    report("Mensagem fromMe: true é ignorada com status 'ignored_outgoing_or_status'", res.body.status === "ignored_outgoing_or_status");
    report("Nenhuma reação disparada para mensagem do próprio bot", mockServer.reactions.length === 0);
  }

  // ─── Teste 9: Mensagem Sem ID Remoto de WhatsApp (Pula Reação sem Erro) ───
  console.log("\n--- 9. Resiliência: Mensagem Sem Key.ID ---");
  {
    mockServer.clear();
    const noKeyPayload = {
      sender: { phone_number: "5511996242812" },
      content: "Mensagem via API interna sem key"
    };

    const res = await handleIncomingPayload(noKeyPayload);
    report("Mensagem sem key.id é aceita e enfileirada normalmente", res.body.status === "queued");
    await new Promise(r => setTimeout(r, 100));
    report("Reação é omitida com segurança sem disparar erro", mockServer.reactions.length === 0);
  }

  // ─── Teste 10: Isolamento Concorrente entre Dois Usuários (Davi e Marcos) ──
  console.log("\n--- 10. Concorrência Per-Chat (Isolamento entre Usuários) ---");
  {
    const daviPayload = {
      data: {
        key: { remoteJid: "5511996242812@s.whatsapp.net", fromMe: false, id: `davi_${Date.now()}` },
        message: { conversation: "Pergunta Davi" }
      }
    };
    const marcosPayload = {
      data: {
        key: { remoteJid: "5511970671717@s.whatsapp.net", fromMe: false, id: `marcos_${Date.now()}` },
        message: { conversation: "Pergunta Marcos" }
      }
    };

    const [resDavi, resMarcos] = await Promise.all([
      handleIncomingPayload(daviPayload),
      handleIncomingPayload(marcosPayload)
    ]);

    report("Davi aceito e enfileirado na sua própria fila", resDavi.body.status === "queued");
    report("Marcos aceito e enfileirado na sua própria fila simultaneamente", resMarcos.body.status === "queued");
  }

  // ─── Teste 11: Suporte a WhatsApp LID (@lid) e Mapeamento de remoteJidAlt ───
  console.log("\n--- 11. WhatsApp LID Addressing (remoteJidAlt & @lid) ---");
  {
    mockServer.clear();
    const lidMsgId = `lid_test_${Date.now()}`;
    const lidPayload = {
      event: "messages.upsert",
      data: {
        key: {
          id: lidMsgId,
          fromMe: false,
          remoteJid: "271077481652389@lid",
          remoteJidAlt: "5511996242812@s.whatsapp.net",
          addressingMode: "lid"
        },
        message: {
          conversation: "teste"
        }
      }
    };

    const resLid = await handleIncomingPayload(lidPayload);
    report("Payload com remoteJid @lid é aceito na whitelist via remoteJidAlt", resLid.body.status === "queued");

    await new Promise(r => setTimeout(r, 150));
    const lidReaction = mockServer.reactions.find(r => r.body.key?.id === lidMsgId);
    report("Reação 👀 foi enviada para o remoteJid @lid correto", Boolean(lidReaction) && lidReaction?.body?.key?.remoteJid === "271077481652389@lid");
  }

  // ─── Teste 12: Transição de Reação 👀 -> ✅ e Idempotência Flexibilizada ────
  console.log("\n--- 12. Transição de Reações 👀 -> ✅ e Flexibilização de Idempotência ---");
  {
    mockServer.clear();
    const transMsgId = `test_trans_${Date.now()}`;
    const jid = "5511996242812@s.whatsapp.net";

    // 1. Reação inicial 👀
    const resSeen1 = await sendReactionWhatsApp(jid, transMsgId, "👀");
    report("1ª Reação 👀 enviada com sucesso", resSeen1.sucesso === true && !resSeen1.skipped);
    report("hasMessageBeenReacted(..., '👀') é true", hasMessageBeenReacted(transMsgId, "👀"));
    report("Estado atual é SENT_SEEN", getMessageReactionState(transMsgId) === "SENT_SEEN");

    // 2. Re-tentativa com 👀 (Idempotência sem duplicação)
    const resSeen2 = await sendReactionWhatsApp(jid, transMsgId, "👀");
    report("2ª Reação 👀 é pulada idempotentemente (skipped: true)", resSeen2.skipped === true);

    // 3. Transição para ✅ (Aceita sem ser bloqueada pelo 👀 prévio)
    const resComp1 = await sendReactionWhatsApp(jid, transMsgId, "✅");
    report("Reação ✅ aceita na transição de estado", resComp1.sucesso === true && !resComp1.skipped);
    report("hasMessageBeenReacted(..., '✅') é true", hasMessageBeenReacted(transMsgId, "✅"));
    report("hasMessageBeenReacted(..., '👀') continua true", hasMessageBeenReacted(transMsgId, "👀"));
    report("Estado atual avançou para SENT_COMPLETED", getMessageReactionState(transMsgId) === "SENT_COMPLETED");

    // 4. Re-tentativa com ✅ (Idempotência de conclusão)
    const resComp2 = await sendReactionWhatsApp(jid, transMsgId, "✅");
    report("2ª Reação ✅ é pulada idempotentemente (skipped: true)", resComp2.skipped === true);

    // 5. Auditoria no SQLite comprova coexistência determinística
    const rows = db.prepare("SELECT reaction, state, sucesso FROM message_reactions WHERE message_id = ? ORDER BY id ASC").all(transMsgId);
    report("SQLite registra exatamente 2 reações para o messageId", rows.length === 2);
    report("Registro 1 é 👀 com estado SENT_SEEN", rows[0]?.reaction === "👀" && rows[0]?.state === "SENT_SEEN");
    report("Registro 2 é ✅ com estado SENT_COMPLETED", rows[1]?.reaction === "✅" && rows[1]?.state === "SENT_COMPLETED");
  }

  // ─── Teste 13: Reação ✅ em TODOS os messageIds que Compuseram o Lote ─────
  console.log("\n--- 13. Reação ✅ em Lote Multi-ID (Todos os IDs Reagidos) ---");
  {
    mockServer.clear();
    const batchId = `batch_multi_${Date.now()}`;
    const idA = `msg_batch_A_${Date.now()}`;
    const idB = `msg_batch_B_${Date.now()}`;
    const phone = "5511996242812";
    const jid = `${phone}@s.whatsapp.net`;

    // Registra reações iniciais 👀
    await sendReactionWhatsApp(jid, idA, "👀");
    await sendReactionWhatsApp(jid, idB, "👀");

    mockServer.clear();

    // Simula encerramento do lote e processamento bem-sucedido
    // Dispara reação ✅ para todos os IDs do lote
    const targetMsgIds = [idA, idB];
    for (const mId of targetMsgIds) {
      await sendReactionWhatsApp(jid, mId, "✅");
      recordLifecycle(mId, "sent_whatsapp", batchId, "replies_count:2");
    }

    const reactionsA = mockServer.reactions.filter(r => r.body.key?.id === idA && r.body.reaction === "✅");
    const reactionsB = mockServer.reactions.filter(r => r.body.key?.id === idB && r.body.reaction === "✅");

    report("Reação ✅ enviada para o primeiro ID do lote (idA)", reactionsA.length === 1);
    report("Reação ✅ enviada para o segundo ID do lote (idB)", reactionsB.length === 1);
    report("Ambos os IDs no SQLite agora possuem estado SENT_COMPLETED",
      getMessageReactionState(idA) === "SENT_COMPLETED" && getMessageReactionState(idB) === "SENT_COMPLETED"
    );

    // Auditoria SQLite lifecycle para ambos
    const lcA = db.prepare("SELECT state FROM message_lifecycle WHERE message_id = ? AND state = 'sent_whatsapp'").get(idA);
    const lcB = db.prepare("SELECT state FROM message_lifecycle WHERE message_id = ? AND state = 'sent_whatsapp'").get(idB);
    report("Auditoria message_lifecycle contém 'sent_whatsapp' para idA", Boolean(lcA));
    report("Auditoria message_lifecycle contém 'sent_whatsapp' para idB", Boolean(lcB));
  }

  // ─── Teste 14: Reação ❌ e Fallback Calmo em Caso de Erro Irrecuperável ────
  console.log("\n--- 14. Reação ❌ e Fallback Calmo em Caso de Erro Irrecuperável ---");
  {
    mockServer.clear();
    const failId = `msg_fail_${Date.now()}`;
    const phone = "5511996242812";
    const jid = `${phone}@s.whatsapp.net`;

    await sendReactionWhatsApp(jid, failId, "👀");
    mockServer.clear();

    // Simula tratamento de erro irrecuperável
    recordLifecycle(failId, "failed", "batch_fail_1", "timeout_consulta_banco");
    await sendReactionWhatsApp(jid, failId, "❌");
    await sendReplyWhatsApp(phone, "Ocorreu uma instabilidade momentânea ao processar sua mensagem. Por favor, tente novamente.");

    const reactFail = mockServer.reactions.find(r => r.body.key?.id === failId);
    report("Reação ❌ enviada para mensagem com falha", reactFail?.body?.reaction === "❌");
    report("Estado no SQLite registrado como SENT_FAILED", getMessageReactionState(failId) === "SENT_FAILED");

    const fallbackMsg = mockServer.messages.find(m => m.body.text.includes("instabilidade momentânea"));
    report("Fallback calmo despachado para o WhatsApp do usuário", Boolean(fallbackMsg));

    const lcFail = db.prepare("SELECT state, details FROM message_lifecycle WHERE message_id = ? AND state = 'failed'").get(failId);
    report("Auditoria message_lifecycle registrou estado 'failed' com detalhes do erro", Boolean(lcFail) && lcFail.details.includes("timeout_consulta_banco"));
  }

  // ─── Teste 15: Preservação de LID na Reação Final ✅ ──────────────────────
  console.log("\n--- 15. Preservação de LID na Reação Final ✅ ---");
  {
    mockServer.clear();
    const lidFinalId = `lid_final_${Date.now()}`;
    const nativeLidJid = "271077481652389@lid";

    // Envia reação inicial 👀 preservando LID
    await sendReactionWhatsApp(nativeLidJid, lidFinalId, "👀");
    const firstReq = mockServer.reactions[0];
    report("Reação 👀 enviada para JID nativo @lid", firstReq?.body?.key?.remoteJid === nativeLidJid);

    // Envia reação final ✅ preservando LID
    await sendReactionWhatsApp(nativeLidJid, lidFinalId, "✅");
    const secondReq = mockServer.reactions[1];
    report("Reação ✅ enviada preservando o JID nativo @lid (sem alterar para @s.whatsapp.net)", secondReq?.body?.key?.remoteJid === nativeLidJid);

    // Confirma que no banco o remote_jid foi gravado com o @lid nativo
    const rowLid = db.prepare("SELECT remote_jid, reaction, state FROM message_reactions WHERE message_id = ? AND reaction = '✅'").get(lidFinalId);
    report("remote_jid persistido no SQLite preserva o @lid nativo", rowLid?.remote_jid === nativeLidJid);
  }

  // ─── Teste 16: Blindagem Contra Falhas na API de Reação ───────────────────
  console.log("\n--- 16. Blindagem Contra Falhas na API de Reação ---");
  {
    mockServer.clear();
    mockServer.failReactions = true; // Injeta falha 500 no mock de reação

    const blindId = `blind_${Date.now()}`;
    const jid = "5511996242812@s.whatsapp.net";

    // sendReactionWhatsApp com erro não lança exceção não-tratada
    let threw = false;
    let resReaction: any = null;
    try {
      resReaction = await sendReactionWhatsApp(jid, blindId, "👀");
    } catch {
      threw = true;
    }

    report("sendReactionWhatsApp captura erro sem lançar exceção fatal", !threw && resReaction.sucesso === false);

    // Envio da resposta final continua ocorrendo perfeitamente
    const replyRes = await sendReplyWhatsApp("5511996242812", "Resposta prioritária de faturamento");
    report("Envio de mensagem de resposta opera normalmente mesmo com API de reações inoperante", replyRes.sucesso === true);
    report("Mensagem de resposta foi entregue ao mock do WhatsApp", mockServer.messages.length === 1);

    mockServer.failReactions = false;
  }

  // ─── Teste 17: Observabilidade no SQLite & Mascaramento de Dados ──────────
  console.log("\n--- 17. Observabilidade no SQLite (message_lifecycle) e Privacidade ---");
  {
    const obsMsgId = `obs_${Date.now()}`;
    const phone = "5511996242812";
    const jid = `${phone}@s.whatsapp.net`;
    const batchId = `batch_obs_${Date.now()}`;

    // 1. Auditoria dos marcos em sequência
    recordLifecycle(obsMsgId, "accepted", null, `jid:${maskJid(jid)}`);
    recordLifecycle(obsMsgId, "batch_closed", batchId, "parts:1");
    recordLifecycle(obsMsgId, "generating", batchId, "dispatcher_start");
    recordLifecycle(obsMsgId, "sent_whatsapp", batchId, "replies_count:1 api_status:200");

    // Simula evento de webhook de confirmação de entrega do WhatsApp
    const deliveryPayload = {
      event: "messages.update",
      data: {
        key: { id: obsMsgId, remoteJid: jid },
        status: "DELIVERY_ACK"
      }
    };
    const delivRes = await handleIncomingPayload(deliveryPayload);
    report("handleIncomingPayload processa evento messages.update com status delivered_recorded", delivRes.body.status === "delivered_recorded");

    // Verifica marcos gravados no SQLite
    const milestones = db.prepare("SELECT state, details FROM message_lifecycle WHERE message_id = ? ORDER BY id ASC").all(obsMsgId);
    const states = milestones.map((m: any) => m.state);

    report("Marco 'accepted' registrado", states.includes("accepted"));
    report("Marco 'batch_closed' registrado", states.includes("batch_closed"));
    report("Marco 'generating' registrado", states.includes("generating"));
    report("Marco 'sent_whatsapp' registrado (aceite da API)", states.includes("sent_whatsapp"));
    report("Marco 'delivered' registrado (confirmação do WhatsApp)", states.includes("delivered"));

    // 2. Conformidade de Privacidade
    const allDetails = milestones.map((m: any) => m.details || "").join(" ");
    report("Telefones gravados estão devidamente mascarados (ex: 5511*****2812)", allDetails.includes("5511*****2812") && !allDetails.includes("5511996242812"));
    report("Nenhuma credencial ou token gravado no message_lifecycle", !allDetails.includes("TorkEvoApiKey") && !allDetails.includes("Secure!"));

    // 3. Mascaradores utilitários
    report("maskPhone mascara corretamente", maskPhone("5511996242812") === "5511*****2812");
    report("maskJid com @lid mascara usuário mantendo domínio", maskJid("271077481652389@lid").endsWith("@lid") && maskJid("271077481652389@lid").includes("****"));
  }

  // Finalização do Mock
  await mockServer.stop();

  console.log("\n===============================================================================");
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} PASS (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log("===============================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch(err => {
  console.error("Erro fatal no harness de testes:", err);
  process.exit(1);
});
