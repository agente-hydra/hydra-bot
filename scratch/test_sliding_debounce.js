const axios = require('axios');
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:4100/webhook';

const redis = new Redis(REDIS_URL);

async function runTest() {
  console.log('================================================================');
  console.log('🚀 INICIANDO TESTE DO WATCHDOG SLIDING IDLE DEBOUNCE');
  console.log('================================================================');

  const testConvId = 999901;

  // Limpeza inicial
  await redis.del(`debounce:conv:${testConvId}`);
  await redis.del(`debounce_start:conv:${testConvId}`);
  await redis.del(`buffer:conv:${testConvId}`);
  await redis.zrem('watchdog:scheduled_evals', String(testConvId));

  try {
    // -------------------------------------------------------------
    // ETAPA 1: Envio da Mensagem 1 (Início do Ciclo)
    // -------------------------------------------------------------
    console.log('\n--- ETAPA 1: Primeira Mensagem da Conversa ---');
    const t1 = Math.floor(Date.now() / 1000);
    const res1 = await axios.post(GATEWAY_URL, {
      event: 'message_created',
      message_type: 'incoming',
      conversation: { id: testConvId, inbox_id: 1, labels: [] },
      content: 'Olá, quanto custa a revisão completa?'
    });

    console.log('Resposta do Gateway (Msg 1):', res1.data);
    if (!res1.data.received || !res1.data.is_first) {
      throw new Error(`Falha na Msg 1: esperava is_first=true, recebeu: ${JSON.stringify(res1.data)}`);
    }

    const scheduled1 = res1.data.scheduled_at;
    const ttl1 = await redis.ttl(`debounce:conv:${testConvId}`);
    const score1 = await redis.zscore('watchdog:scheduled_evals', String(testConvId));
    const start1 = await redis.get(`debounce_start:conv:${testConvId}`);

    console.log(`✓ Msg 1 agendada para: ${res1.data.scheduled_time} (Epoch: ${scheduled1})`);
    console.log(`✓ TTL no Redis: ${ttl1}s | ZSET Score: ${score1} | Burst Start: ${start1}`);

    if (ttl1 < 1180 || Math.abs(Number(score1) - scheduled1) > 2) {
      throw new Error(`Inconsistência no Redis após Msg 1: TTL=${ttl1}, Score=${score1}`);
    }
    console.log('✅ [PASS] ETAPA 1: Primeira mensagem abriu janela de inatividade e gravou início do ciclo.');

    // -------------------------------------------------------------
    // ETAPA 2: Envio da Mensagem 2 (Prorrogação da Janela Deslizante)
    // -------------------------------------------------------------
    console.log('\n--- ETAPA 2: Segunda Mensagem (Simulando Diálogo Ativo) ---');
    await new Promise(r => setTimeout(r, 2000)); // Espera 2s

    const res2 = await axios.post(GATEWAY_URL, {
      event: 'message_created',
      message_type: 'outgoing',
      conversation: { id: testConvId, inbox_id: 1, labels: [] },
      content: 'Bom dia! A revisão básica custa a partir de R$ 250,00.'
    });

    console.log('Resposta do Gateway (Msg 2):', res2.data);
    if (!res2.data.received || res2.data.is_first) {
      throw new Error(`Falha na Msg 2: esperava is_first=false, recebeu: ${JSON.stringify(res2.data)}`);
    }

    const scheduled2 = res2.data.scheduled_at;
    const ttl2 = await redis.ttl(`debounce:conv:${testConvId}`);
    const score2 = await redis.zscore('watchdog:scheduled_evals', String(testConvId));
    const start2 = await redis.get(`debounce_start:conv:${testConvId}`);

    console.log(`✓ Msg 2 reagendada para: ${res2.data.scheduled_time} (Epoch: ${scheduled2})`);
    console.log(`✓ TTL renovado: ${ttl2}s | ZSET Score: ${score2} | Burst Start: ${start2}`);

    if (scheduled2 <= scheduled1) {
      throw new Error(`CRÍTICO: O agendamento NÃO deslizou! scheduled2 (${scheduled2}) <= scheduled1 (${scheduled1})`);
    }

    if (start2 !== start1) {
      throw new Error(`CRÍTICO: Burst Start foi resetado indevidamente! Era ${start1}, virou ${start2}`);
    }

    if (ttl2 < 1180) {
      throw new Error(`CRÍTICO: TTL não foi renovado para ~1200s! TTL=${ttl2}`);
    }

    console.log('✅ [PASS] ETAPA 2: Sliding Debounce comprovado! Timer foi prorrogado após nova mensagem.');

    // -------------------------------------------------------------
    // ETAPA 3: Validação do Teto Máximo (Ceiling Guard - 2 Horas)
    // -------------------------------------------------------------
    console.log('\n--- ETAPA 3: Simulação de Conversa Contínua Atingindo o Teto (2 Horas) ---');
    // Força burstStart para 7.000 segundos atrás (~1h 56m)
    const simulatedStart = Math.floor(Date.now() / 1000) - 7000;
    await redis.set(`debounce_start:conv:${testConvId}`, String(simulatedStart));

    const res3 = await axios.post(GATEWAY_URL, {
      event: 'message_created',
      message_type: 'incoming',
      conversation: { id: testConvId, inbox_id: 1, labels: [] },
      content: 'E a troca de óleo de freio, quanto custa?'
    });

    const scheduled3 = res3.data.scheduled_at;
    const maxCeilingExpected = simulatedStart + 7200; // 2 horas (7200s)

    console.log(`✓ Agendamento sob teto: ${res3.data.scheduled_time} (Epoch: ${scheduled3})`);
    console.log(`✓ Teto máximo esperado: ${maxCeilingExpected}`);

    if (scheduled3 > maxCeilingExpected) {
      throw new Error(`CRÍTICO: Ultrapassou o teto máximo de acumulação! scheduled=${scheduled3}, ceiling=${maxCeilingExpected}`);
    }
    console.log('✅ [PASS] ETAPA 3: Teto máximo de segurança (Ceiling) respeitado com sucesso.');

    console.log('\n================================================================');
    console.log('🎉 TODOS OS TESTES DO SLIDING IDLE DEBOUNCE FORAM APROVADOS!');
    console.log('================================================================');
  } finally {
    // Limpeza pós-teste
    await redis.del(`debounce:conv:${testConvId}`);
    await redis.del(`debounce_start:conv:${testConvId}`);
    await redis.del(`buffer:conv:${testConvId}`);
    await redis.zrem('watchdog:scheduled_evals', String(testConvId));
    await redis.quit();
  }
}

runTest().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});
