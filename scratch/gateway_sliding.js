const Fastify = require('fastify');
const Redis = require('ioredis');

const redis = new Redis('redis://127.0.0.1:6380');
const fastify = Fastify({ logger: true });

const SUPPLIER_REGEX = /(^|\s|\W)(for|forn|fornecedor|auto\s*pe[cç]as|pe[cç]as|distribuidora|motoboy|guincho|retifica|parceiro|mecanic[ao]|uniformes|vendedor|vendas|distribuidor|amortecedor|procopio|mecanica\s*popular)($|\s|\W)/i;
const IGNORED_TAGS = ['fornecedor', 'frotista', 'garantia', 'interno', 'gerente', 'terceiro', 'rh'];
const IGNORED_INBOXES = [11, 14, 15]; // 11: REI DO MODULO, 14: RH, 15: Hydra Bot

// Configurações de Janela Deslizante de Inatividade (Sliding Idle Debounce)
// Padrão: 20 minutos (1200 segundos) de silêncio após a ÚLTIMA mensagem
const IDLE_GAP_SECONDS = parseInt(process.env.WATCHDOG_IDLE_SECONDS || String(20 * 60), 10);
// Teto máximo de acumulação contínua para evitar inanição em conversas sem pausa (2 horas)
const MAX_ACCUMULATION_SECONDS = parseInt(process.env.WATCHDOG_MAX_WINDOW_SECONDS || String(120 * 60), 10);

fastify.post('/webhook', async (request, reply) => {
  try {
    const payload = request.body;
    
    // Processamos mensagens do cliente (incoming) e do atendente/gerente (outgoing)
    const msgType = payload.message_type;
    if (payload.event !== 'message_created' || (msgType !== 'outgoing' && msgType !== 'incoming' && msgType !== 0 && msgType !== 1)) {
      return reply.code(200).send({ received: true, ignored: true });
    }

    const convId = payload.conversation?.id;
    const inboxId = Number(payload.conversation?.inbox_id);
    const labels = payload.conversation?.labels || [];
    const contactName = payload.conversation?.meta?.sender?.name || payload.conversation?.contact_inbox?.contact?.name || '';
    
    const IGNORED_ALERT_CONVS = [2121, 2404];
    
    // 1. IGNORA O PRÓPRIO BOT (Conversas de alertas 2121/2404 ou Inboxes ignoradas)
    if (IGNORED_ALERT_CONVS.includes(Number(convId)) || IGNORED_INBOXES.includes(inboxId)) {
      return reply.code(200).send({ received: true, ignored: true, reason: 'bot_or_ignored_inbox' });
    }

    // 2. IGNORA FORNECEDORES POR TAG / ETIQUETA
    if (labels.some(label => IGNORED_TAGS.includes(label.toLowerCase()))) {
      console.log(`[GATEWAY] Ignorando conversa ${convId} por tag: ${labels.join(', ')}`);
      return reply.code(200).send({ received: true, ignored: true, reason: 'ignored_tag' });
    }

    // 3. IGNORA FORNECEDORES POR NOME DO CONTATO
    if (contactName && SUPPLIER_REGEX.test(contactName)) {
      console.log(`[GATEWAY] Ignorando conversa ${convId} por nome de fornecedor: "${contactName}"`);
      return reply.code(200).send({ received: true, ignored: true, reason: 'supplier_contact' });
    }
    
    // Buffer da mensagem com TTL para higiene de memória (teto máx + 10 min)
    const bufferKey = `buffer:conv:${convId}`;
    await redis.rpush(bufferKey, JSON.stringify(payload));
    await redis.expire(bufferKey, MAX_ACCUMULATION_SECONDS + 600);

    const nowSec = Math.floor(Date.now() / 1000);
    const startKey = `debounce_start:conv:${convId}`;
    const debounceKey = `debounce:conv:${convId}`;

    // Marca o início da rajada de conversa (caso seja a primeira mensagem do ciclo)
    const isFirstInBurst = await redis.set(startKey, String(nowSec), 'NX', 'EX', MAX_ACCUMULATION_SECONDS + 600);
    const burstStartSec = Number((await redis.get(startKey)) || nowSec);

    // Próximo disparo previsto = nowSec + IDLE_GAP_SECONDS (janela deslizante a partir da última mensagem)
    let nextScheduledAt = nowSec + IDLE_GAP_SECONDS;
    const maxCeilingAt = burstStartSec + MAX_ACCUMULATION_SECONDS;

    // Se ultrapassar o teto máximo de 2h de conversa ininterrupta, trava no teto para forçar auditoria
    if (nextScheduledAt > maxCeilingAt) {
      nextScheduledAt = maxCeilingAt;
    }

    const remainingTtl = Math.max(1, nextScheduledAt - nowSec);

    // Renova a chave de debounce e atualiza o score no ZSET de agendamentos (Sliding Debounce)
    await redis.set(debounceKey, '1', 'EX', remainingTtl);
    await redis.zadd('watchdog:scheduled_evals', nextScheduledAt, String(convId));

    const scheduledTimeStr = new Date(nextScheduledAt * 1000).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (isFirstInBurst) {
      console.log(`[GATEWAY] ⏱️ Nova conversa/ciclo iniciado para conv ${convId}. Auditoria prevista após ${Math.round(IDLE_GAP_SECONDS / 60)}m de silêncio (em: ${scheduledTimeStr})`);
    } else {
      console.log(`[GATEWAY] 🔄 Nova msg na conv ${convId}. Janela prorrogada (+${Math.round(IDLE_GAP_SECONDS / 60)}m de inatividade)! Nova previsão: ${scheduledTimeStr}`);
    }

    return reply.code(200).send({
      received: true,
      buffered: true,
      idle_gap_seconds: IDLE_GAP_SECONDS,
      scheduled_at: nextScheduledAt,
      scheduled_time: scheduledTimeStr,
      is_first: Boolean(isFirstInBurst)
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
});

fastify.listen({ port: 4100, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Watchdog Gateway escutando na porta 4100 (Idle Gap: ${IDLE_GAP_SECONDS}s, Max Window: ${MAX_ACCUMULATION_SECONDS}s)`);
});
