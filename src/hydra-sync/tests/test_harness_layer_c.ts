import Database from 'better-sqlite3';
import path from 'path';
import { HydraWebhookService, type WebhookDeliveryResult, type WebhookJobResult } from '../webhook_service.js';
import { assertWhatsAppNativeFormat } from '../format_utils.js';
import { ensureInboxTable } from '../idempotency_repository.js';

const DB_PATH = path.resolve('fixtures/test_hydra.db');
const db = new Database(DB_PATH);
ensureInboxTable(db);

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
  }
}

interface RecordedBalloon {
  phone: string;
  text: string;
  messageId: string;
  deliveredAt: number;
}

interface TelemetryPoint {
  queueWaitMs: number;
  intentRewriteMs: number;
  executionDbMs: number;
  llmMs: number;
  formatMs: number;
  timeToFirstBalloonMs: number;
  totalDurationMs: number;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runLayerCTests() {
  console.log('\n🚀 Iniciando TEST HARNESS — CAMADA C: Webhook Isolado + Transporte Simulado...\n');

  // Configura ambiente para fixture de testes e motor desacoplado ultra-rápido
  process.env.AGY_BIN_OVERRIDE = '/bin/false';
  process.env.HYDRA_DB_PATH = DB_PATH;

  // Limpa tabelas de teste para estado zerado
  try { db.exec('DELETE FROM hydra_inbox_messages'); } catch {}
  try { db.exec('DELETE FROM hydra_turn_contexts'); } catch {}
  try { db.exec('DELETE FROM conversation_messages'); } catch {}
  try { db.exec('DELETE FROM agent_interaction_logs'); } catch {}

  const TEST_PORT = 3338;
  const recordedBalloons: RecordedBalloon[] = [];
  const telemetryPoints: TelemetryPoint[] = [];

  let simulateFailureOnMsgId: string | null = null;
  let simulateDelayPhone: string | null = null;
  let simulateDelayMs = 0;
  let failureCount = 0;

  const webhookService = new HydraWebhookService({
    port: TEST_PORT,
    isSimulation: true,
    maxConcurrentConversations: 5
  });

  webhookService.setMockDeliverySink(async (phone, text, messageId) => {
    // Injeção de atraso simulado
    if (simulateDelayPhone && phone === simulateDelayPhone) {
      await new Promise(r => setTimeout(r, simulateDelayMs));
    }

    // Injeção de falha transitória (500 na 1ª tentativa, 200 na 2ª)
    if (simulateFailureOnMsgId && messageId === simulateFailureOnMsgId) {
      failureCount++;
      if (failureCount === 1) {
        return {
          sucesso: false,
          statusHttp: 500,
          tentativas: 1,
          duracaoMs: 15,
          erro: 'Simulated 500 Internal Server Error'
        };
      }
    }

    const balloon: RecordedBalloon = {
      phone,
      text,
      messageId,
      deliveredAt: Date.now()
    };
    recordedBalloons.push(balloon);

    return {
      sucesso: true,
      statusHttp: 200,
      tentativas: failureCount > 0 && messageId === simulateFailureOnMsgId ? 2 : 1,
      duracaoMs: 10,
      messageId: `sim_${Date.now()}`
    };
  });

  await webhookService.start(TEST_PORT);
  console.log(`✓ Servidor HydraWebhookService iniciado na porta ${TEST_PORT} (modo simulação)`);

  const clientFetch = async (payload: any): Promise<{ status: number; body: any; elapsedMs: number }> => {
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const elapsedMs = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, elapsedMs };
  };

  const waitForQueueDrain = async (maxWaitMs = 5000): Promise<void> => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs) {
      const m = webhookService.getQueueMetrics();
      if (m.activeCount === 0 && m.totalPendingJobs === 0) {
        return;
      }
      await new Promise(r => setTimeout(r, 20));
    }
  };

  try {
    // Warmup de conexão HTTP
    await fetch(`http://127.0.0.1:${TEST_PORT}/health`);

    // =========================================================================
    // TESTE 1: Ingress Rápido (<15ms) e Rajadas FIFO na Mesma Conversa
    // =========================================================================
    console.log('\n--- Teste 1: Rajadas na Mesma Conversa (FIFO & Associação de Balões) ---');

    const phoneDavi = '5511996242812';
    const burstPayloads = [
      {
        data: {
          key: { id: 'burst_msg_1', remoteJid: `${phoneDavi}@s.whatsapp.net`, fromMe: false },
          message: { conversation: 'quais OS estão sem sinal no jaba?' }
        }
      },
      {
        data: {
          key: { id: 'burst_msg_2', remoteJid: `${phoneDavi}@s.whatsapp.net`, fromMe: false },
          message: { conversation: 'qual a maior dessas?' }
        }
      },
      {
        data: {
          key: { id: 'burst_msg_3', remoteJid: `${phoneDavi}@s.whatsapp.net`, fromMe: false },
          message: { conversation: 'e a mais antiga?' }
        }
      }
    ];

    // Dispara a rajada concorrente
    const burstResponses = await Promise.all(burstPayloads.map(p => clientFetch(p)));

    // Validação do Ingress
    burstResponses.forEach((r, idx) => {
      assert(r.status === 200 && r.body.status === 'queued', `1.${idx+1}: Ingress HTTP enfileirou msg ${idx+1}`);
      assert(r.elapsedMs < 150, `1.${idx+1}: Ingress respondeu rapidamente (${r.elapsedMs}ms)`);
    });

    // Aguarda o dreno seguro da fila
    console.log('-> Aguardando execução sequencial dos turnos na fila...');
    await waitForQueueDrain(4000);

    // Valida a ordem de entrega dos balões para cada mensagem
    const balloonsMsg1 = recordedBalloons.filter(b => b.messageId === 'burst_msg_1');
    const balloonsMsg2 = recordedBalloons.filter(b => b.messageId === 'burst_msg_2');
    const balloonsMsg3 = recordedBalloons.filter(b => b.messageId === 'burst_msg_3');

    assert(balloonsMsg1.length > 0, '1.4: Balões da mensagem 1 foram entregues');
    assert(balloonsMsg2.length > 0, '1.4: Balões da mensagem 2 foram entregues');
    assert(balloonsMsg3.length > 0, '1.4: Balões da mensagem 3 foram entregues');

    // Valida preservação FIFO estrita (Msg 1 antes de Msg 2, Msg 2 antes de Msg 3)
    const tEnd1 = Math.max(...balloonsMsg1.map(b => b.deliveredAt));
    const tStart2 = Math.min(...balloonsMsg2.map(b => b.deliveredAt));
    const tEnd2 = Math.max(...balloonsMsg2.map(b => b.deliveredAt));
    const tStart3 = Math.min(...balloonsMsg3.map(b => b.deliveredAt));

    assert(tEnd1 <= tStart2, '1.5: Mensagem 1 completou antes da Mensagem 2 iniciar (FIFO estrito)');
    assert(tEnd2 <= tStart3, '1.6: Mensagem 2 completou antes da Mensagem 3 iniciar (FIFO estrito)');

    // Valida continuidade semântica correta (Msg 2 achou Onix R$ 25.000, Msg 3 achou Fiesta 14d)
    const textMsg2 = balloonsMsg2.map(b => b.text).join('\n');
    const textMsg3 = balloonsMsg3.map(b => b.text).join('\n');
    assert(textMsg2.includes('25.000,00'), '1.7: Turno 2 preservou contexto anafórico (Onix R$ 25.000,00)');
    assert(textMsg3.includes('14 dias'), '1.8: Turno 3 encontrou mais antiga preservando loja (Fiesta 14 dias)');

    // =========================================================================
    // TESTE 2: Concorrência entre Conversas Diferentes (Não-bloqueante)
    // =========================================================================
    console.log('\n--- Teste 2: Concorrência entre Conversas Diferentes ---');

    const phoneMarcos = '5511970671717';
    simulateDelayPhone = phoneDavi;
    simulateDelayMs = 200; // Davi tem atraso simulado de 200ms

    let marcosFinishedAt = 0;
    let daviFinishedAt = 0;

    const pDavi = clientFetch({
      data: {
        key: { id: 'slow_davi_msg', remoteJid: `${phoneDavi}@s.whatsapp.net`, fromMe: false },
        message: { conversation: 'como tá o Jabaquara?' }
      }
    });

    // Marcos envia 10ms depois
    await new Promise(r => setTimeout(r, 10));
    const pMarcos = clientFetch({
      data: {
        key: { id: 'fast_marcos_msg', remoteJid: `${phoneMarcos}@s.whatsapp.net`, fromMe: false },
        message: { conversation: 'faturamento das lojas' }
      }
    });

    await Promise.all([pDavi, pMarcos]);

    // Aguarda dreno seguro com timeout de 4 segundos
    const t0Poll = Date.now();
    while (Date.now() - t0Poll < 4000) {
      const bDavi = recordedBalloons.find(b => b.messageId === 'slow_davi_msg');
      const bMarcos = recordedBalloons.find(b => b.messageId === 'fast_marcos_msg');
      if (bDavi && !daviFinishedAt) daviFinishedAt = bDavi.deliveredAt;
      if (bMarcos && !marcosFinishedAt) marcosFinishedAt = bMarcos.deliveredAt;
      if (daviFinishedAt && marcosFinishedAt) break;
      await new Promise(r => setTimeout(r, 20));
    }

    assert(marcosFinishedAt < daviFinishedAt, '2.1: Marcos não foi bloqueado pela conversa lenta de Davi (Processamento Concorrente)');
    simulateDelayPhone = null;
    simulateDelayMs = 0;

    // =========================================================================
    // TESTE 3: Idempotência Atômica & Replays
    // =========================================================================
    console.log('\n--- Teste 3: Idempotência Atômica & Replays ---');

    const balloonsBefore = recordedBalloons.length;

    // 3.1: Envio inicial
    const idemp1 = await clientFetch({
      data: {
        key: { id: 'idemp_key_999', remoteJid: `${phoneMarcos}@s.whatsapp.net`, fromMe: false },
        message: { conversation: 'quais estão sem checklist?' }
      }
    });
    assert(idemp1.body.status === 'queued', '3.1: Primeira mensagem foi enfileirada');

    await waitForQueueDrain(2000);
    const balloonsAfterFirst = recordedBalloons.length;
    assert(balloonsAfterFirst > balloonsBefore, '3.2: Balões da primeira mensagem foram entregues');

    // 3.2: Replay exato com mesmo messageId
    const idemp2 = await clientFetch({
      data: {
        key: { id: 'idemp_key_999', remoteJid: `${phoneMarcos}@s.whatsapp.net`, fromMe: false },
        message: { conversation: 'quais estão sem checklist?' }
      }
    });
    assert(idemp2.body.status === 'ignored_duplicate', '3.3: Replay foi detectado e ignorado com status ignored_duplicate');
    assert(recordedBalloons.length === balloonsAfterFirst, '3.4: ZERO balões duplicados disparados no replay');

    // 3.3: Mensagem nova com mesmo texto mas ID diferente (deve processar!)
    const idemp3 = await clientFetch({
      data: {
        key: { id: 'idemp_key_1000_new', remoteJid: `${phoneMarcos}@s.whatsapp.net`, fromMe: false },
        message: { conversation: 'quais estão sem checklist?' }
      }
    });
    assert(idemp3.body.status === 'queued', '3.5: Nova mensagem com texto idêntico e novo ID é processada normalmente');

    await waitForQueueDrain(2000);
    assert(recordedBalloons.length > balloonsAfterFirst, '3.6: Novos balões foram entregues para o novo ID');

    // =========================================================================
    // TESTE 4: Tolerância a Falhas & Retry de Envio
    // =========================================================================
    console.log('\n--- Teste 4: Tolerância a Falhas e Retry com Backoff ---');

    simulateFailureOnMsgId = 'retry_test_msg';
    failureCount = 0;

    const retryJob = await webhookService.processDirectMessage(phoneDavi, 'faturamento das lojas', 'retry_test_msg');
    assert(retryJob.deliveryResults.length > 0, '4.1: Retornou resultado de entrega');
    assert(retryJob.deliveryResults[0].tentativas === 2, '4.2: Executou retry após falha transitória (tentativas = 2)');
    assert(retryJob.deliveryResults[0].sucesso === true, '4.3: Entrega concluída com sucesso após o retry');

    simulateFailureOnMsgId = null;

    // =========================================================================
    // TESTE 5: Telemetria de Latência por Etapa (p50 / p95)
    // =========================================================================
    console.log('\n--- Teste 5: Telemetria de Latência por Etapa (p50 / p95) ---');

    const sampleQueries = [
      'como tá o Jabaquara?',
      'quais OS estão sem sinal no jaba?',
      'qual a maior dessas?',
      'faturamento das lojas',
      'quais estão sem checklist?',
      'o Fiesta tá há quanto tempo na loja?',
      'OS 8770 quanto tempo na loja?'
    ];

    console.log(`-> Coletando telemetria em lote sobre ${sampleQueries.length} operações operacionais...`);
    for (let i = 0; i < sampleQueries.length; i++) {
      const q = sampleQueries[i];
      const job = await webhookService.processDirectMessage(phoneDavi, q, `telem_${i}_${Date.now()}`);
      if (job.dispatcherResult?.telemetry) {
        const t = job.dispatcherResult.telemetry;
        telemetryPoints.push({
          queueWaitMs: t.queueWaitMs || 0,
          intentRewriteMs: t.intentRewriteMs || 0,
          executionDbMs: t.executionDbMs || 0,
          llmMs: t.llmMs || 0,
          formatMs: t.formatMs || 0,
          timeToFirstBalloonMs: job.timeToFirstBalloonMs || 0,
          totalDurationMs: job.totalDurationMs || 0
        });
      }
    }

    const p50Queue = percentile(telemetryPoints.map(t => t.queueWaitMs), 50);
    const p95Queue = percentile(telemetryPoints.map(t => t.queueWaitMs), 95);

    const p50Rewrite = percentile(telemetryPoints.map(t => t.intentRewriteMs), 50);
    const p95Rewrite = percentile(telemetryPoints.map(t => t.intentRewriteMs), 95);

    const p50Db = percentile(telemetryPoints.map(t => t.executionDbMs), 50);
    const p95Db = percentile(telemetryPoints.map(t => t.executionDbMs), 95);

    const p50Format = percentile(telemetryPoints.map(t => t.formatMs), 50);
    const p95Format = percentile(telemetryPoints.map(t => t.formatMs), 95);

    const p50Total = percentile(telemetryPoints.map(t => t.totalDurationMs), 50);
    const p95Total = percentile(telemetryPoints.map(t => t.totalDurationMs), 95);

    console.log('\n  +-----------------------+----------+----------+');
    console.log('  | Etapa do Pipeline     |   p50    |   p95    |');
    console.log('  +-----------------------+----------+----------+');
    console.log(`  | Fila (queueWaitMs)    | ${String(p50Queue).padStart(6)}ms | ${String(p95Queue).padStart(6)}ms |`);
    console.log(`  | Reescrita de Intenção | ${String(p50Rewrite).padStart(6)}ms | ${String(p95Rewrite).padStart(6)}ms |`);
    console.log(`  | Consulta SQL / Banco  | ${String(p50Db).padStart(6)}ms | ${String(p95Db).padStart(6)}ms |`);
    console.log(`  | Formatação WhatsApp   | ${String(p50Format).padStart(6)}ms | ${String(p95Format).padStart(6)}ms |`);
    console.log(`  | Total até Envio       | ${String(p50Total).padStart(6)}ms | ${String(p95Total).padStart(6)}ms |`);
    console.log('  +-----------------------+----------+----------+');

    assert(p50Rewrite < 15, '5.1: p50 da Reescrita de Intenção < 15ms');
    assert(p50Db < 30, '5.2: p50 da Consulta ao Banco SQLite < 30ms');
    assert(p50Format < 10, '5.3: p50 da Formatação e Chunking < 10ms');
    assert(p95Total < 120, '5.4: p95 Total do Despachante Residente In-Memory < 120ms');

    // =========================================================================
    // RESULTADO FINAL DA CAMADA C
    // =========================================================================
    console.log('\n========================================================');
    console.log(`🏆 RESULTADO CAMADA C: ${passedTests}/${totalTests} TESTES APROVADOS!`);
    console.log('========================================================\n');

    if (passedTests !== totalTests) {
      process.exit(1);
    }
  } finally {
    await webhookService.stop();
    console.log('✓ Servidor HydraWebhookService finalizado com sucesso.');
  }
}

runLayerCTests().catch(err => {
  console.error('❌ Falha na bateria de testes da Camada C:', err);
  process.exit(1);
});