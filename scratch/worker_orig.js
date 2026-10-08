const Redis = require('ioredis');
const { execFile } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { acquireLock } = require('./lib/lock');
const {
  recordAuditSuccess,
  recordRetry,
  recordDeadLetter,
  recordDelivery
} = require('./lib/metrics');

// Configuracoes
const REDIS_URL = 'redis://127.0.0.1:6380';
const AGY_PATH = '/home/operacional/.local/bin/agy';
const MODEL = 'gemini-3.8-flash-low';
const ADMIN_NUMBER = '5511996242812';

// Chatwoot Configs
const CHATWOOT_URL = 'https://chat.tork.services';
const CHATWOOT_OUTBOUND_URL = 'https://chat.tork.services';
const CHATWOOT_TOKEN = 'pQ44LMiCu1XS1VcBGCEPywTd';
const ACCOUNT_ID = '1';

// Mapeamento de Lojas por Inbox ID
const INBOX_NAMES = {
  1: 'Atendimento Central',
  2: 'Jorge Beretta',
  3: 'Kennedy',
  4: 'Dom Pedro',
  5: 'Rudge Ramos',
  6: 'Jabaquara',
  7: 'Piraporinha',
  8: 'Planalto',
  9: 'Mauá',
  10: 'Carijós'
};

// Gerentes Titulares por Loja (extraído do histórico operacional do Chatwoot)
const STORE_MANAGERS = {
  1: 'Kamila',
  2: 'Erik',
  3: 'Paulo',
  4: 'Leandro',
  5: 'Lucas',
  6: 'Vanessa',
  7: 'Anderson',
  8: 'Roberto',
  9: 'Marcelo',
  10: 'Gerente Carijós'
};

// Filtros de Fornecedores e Internos
const SUPPLIER_REGEX = /(^|\s|\W)(for|forn|fornecedor|auto\s*pe[cç]as|pe[cç]as|distribuidora|motoboy|guincho|retifica|parceiro|mecanic[ao]|uniformes|vendedor|vendas|distribuidor|amortecedor|procopio|mecanica\s*popular)($|\s|\W)/i;
const IGNORED_TAGS = ['fornecedor', 'frotista', 'garantia', 'interno', 'gerente', 'terceiro', 'rh'];
const IGNORED_INBOXES = [11, 14, 15]; // 11: REI DO MODULO, 14: RH, 15: Hydra Bot

// Ranking monotônico do funil (O funil SÓ anda para frente)
const STAGE_RANKS = {
  'TRIAGEM_EXTERNA': 1,
  'AGENDAMENTO': 2,
  'VEICULO_NA_OFICINA': 3,
  'ORCAMENTO_APRESENTADO': 4,
  'NEGOCIACAO': 5,
  'SERVICO_EM_ANDAMENTO': 6,
  'PRONTO_ENTREGA': 7,
  'POS_VENDA_GARANTIA': 8,
  'FORNECEDOR_PARCEIRO': 9
};

const REGRA_TITULOS = {
  'PRECO_PREMATURO': 'Preço Prematuro sem Vistoria',
  'SEM_TENTATIVA_FECHAMENTO': 'Atendimento Passivo sem CTA',
  'UPSELL_IGNORADO': 'Oportunidade / Upsell Ignorado',
  'ORCAMENTO_AMADOR': 'Orçamento sem Discriminação',
  'QUEBRA_OBJECAO_OMISSA': 'Desistência Passiva na Objeção',
  'FALTA_PROATIVIDADE_PANE': 'Falta de Apoio em Pane',
  'CLIENTE_NO_VACUO': 'Cliente Deixado sem Retorno',
  'ATENDIMENTO_DESCASO_OU_RISPIDEZ': 'Descaso ou Rispidez'
};

const redis = new Redis(REDIS_URL);

// Canais que recebem os avisos operacionais (Davi: 2121, Marcos: 2404)
const ALERT_CONVERSATIONS = [2121, 2404];

async function sendWhatsAppAlert(text, convId, codigoRegra, customHash = null) {
  const statusPorDestinatario = {};
  const alertHash = customHash || crypto.createHash('md5').update(`${convId}:${codigoRegra}:${text}`).digest('hex').slice(0, 12);

  for (const cid of ALERT_CONVERSATIONS) {
    const alertKey = `alert:sent:${convId}:${cid}:${alertHash}`;
    const alreadyAlerted = await redis.get(alertKey);
    if (alreadyAlerted) {
      console.log(`[ANTI-SPAM] Alerta da regra "${codigoRegra}" (hash ${alertHash}) já confirmado para Conv ${cid}. Suprimido.`);
      statusPorDestinatario[cid] = { enviado: false, motivo: 'COOLDOWN', cooldownApplied: true };
      continue;
    }

    try {
      const res = await axios.post(`${CHATWOOT_OUTBOUND_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${cid}/messages`, {
        content: text,
        message_type: 'outgoing'
      }, {
        headers: { 'api_access_token': CHATWOOT_TOKEN },
        timeout: 10000
      });
      console.log(`✅ Alerta enviado para Chatwoot Conv ${cid} (Msg ID: ${res.data?.id})`);
      // Cooldown isolado de 1 hora para ESTE destinatário confirmado
      await redis.setex(alertKey, 3600, '1');
      await redis.del(`alert:pending:${convId}:${cid}:${alertHash}`);
      await recordDelivery(redis, cid, true);
      statusPorDestinatario[cid] = { enviado: true, messageId: res.data?.id, cooldownApplied: true };
    } catch (err) {
      console.error(`❌ Erro ao enviar alerta via Chatwoot para Conv ${cid}:`, err.message);
      await redis.setex(`alert:pending:${convId}:${cid}:${alertHash}`, 86400, err.message);
      await recordDelivery(redis, cid, false, err.message);
      statusPorDestinatario[cid] = { enviado: false, erro: err.message, cooldownApplied: false };
    }
  }
  return statusPorDestinatario;
}

async function downloadAttachment(url, ext) {
  try {
    const res = await axios.get(url, { responseType: 'stream' });
    const filename = `/tmp/watchdog_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const writer = fs.createWriteStream(filename);
    res.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filename));
      writer.on('error', reject);
    });
  } catch (err) {
    console.error(`Erro ao baixar anexo ${url}:`, err.message);
    return null;
  }
}

async function fetchConversationContext(convId) {
  try {
    // 1. Carregar estado salvo do Redis (State Machine)
    const stateRaw = await redis.get(`state:conv:${convId}`);
    let cachedState = null;
    if (stateRaw) {
      try { cachedState = JSON.parse(stateRaw); } catch (e) {}
    }

    const convRes = await axios.get(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${convId}`, {
      headers: { api_access_token: CHATWOOT_TOKEN },
      timeout: 10000
    });
    
    const convData = convRes.data || {};
    const contactName = convData.meta?.sender?.name || '';
    const phoneNumber = convData.meta?.sender?.phone_number || '';
    const labels = convData.labels || [];
    const inboxId = Number(convData.inbox_id);

    // Filtro estrito: Ignorar fornecedores, internos, RH e canais administrativos
    if (
      IGNORED_INBOXES.includes(inboxId) ||
      labels.some(l => IGNORED_TAGS.includes(l.toLowerCase())) ||
      (contactName && SUPPLIER_REGEX.test(contactName))
    ) {
      console.log(`[IGNORADO] Conversa ${convId} descartada (Contato: "${contactName}", Inbox: ${inboxId}, Tags: ${labels.join(', ')})`);
      return { transcript: '', filesToProcess: [], newLastMsgId: null, cachedState: null, isIgnored: true };
    }

    // 2. Buscar mensagens com paginação reversa (até alcançar cachedState.last_msg_id ou teto de 150 mensagens)
    const msgsUrl = `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${convId}/messages`;
    const msgsRes = await axios.get(msgsUrl, {
      headers: { api_access_token: CHATWOOT_TOKEN },
      timeout: 10000
    });

    let rawMessages = msgsRes.data?.payload || [];

    const targetLastId = cachedState?.last_msg_id || 0;
    if (rawMessages.length >= 20) {
      let oldestMsgId = rawMessages.reduce((min, m) => (!min || m.id < min ? m.id : min), null);
      let pages = 1;
      while (oldestMsgId && (targetLastId === 0 || oldestMsgId > targetLastId) && pages < 5) {
        try {
          const prevRes = await axios.get(`${msgsUrl}?before=${oldestMsgId}`, {
            headers: { api_access_token: CHATWOOT_TOKEN },
            timeout: 10000
          });
          const prevPayload = prevRes.data?.payload || [];
          if (prevPayload.length === 0) break;
          rawMessages = [...prevPayload, ...rawMessages];
          oldestMsgId = prevPayload.reduce((min, m) => (!min || m.id < min ? m.id : min), null);
          pages++;
        } catch (pageErr) {
          console.warn(`[WATCHDOG] Aviso na paginação Chatwoot conv ${convId}:`, pageErr.message);
          break;
        }
      }
    }

    // Deduplicação estrita por ID e ordenação cronológica ascendente (ASC)
    const messageMap = new Map();
    for (const m of rawMessages) {
      if (m && m.id) messageMap.set(m.id, m);
    }
    const allMessages = Array.from(messageMap.values()).sort((a, b) => a.id - b.id);

    if (allMessages.length === 0) {
      return { transcript: '', filesToProcess: [], newLastMsgId: null, cachedState: null };
    }

    let deltaMessages = [];
    if (cachedState && cachedState.last_msg_id) {
      // Pega apenas mensagens novas desde a última auditoria (Compressor de Contexto)
      deltaMessages = allMessages.filter(m => m.id > cachedState.last_msg_id);
    } else {
      // Primeira auditoria: pega as últimas 8 mensagens para inicializar
      deltaMessages = allMessages.slice(-8);
    }

    // Ignora mensagens internas/templates
    deltaMessages = deltaMessages.filter(m => m.message_type !== 2);

    if (deltaMessages.length === 0) {
      return { transcript: '', filesToProcess: [], newLastMsgId: allMessages[allMessages.length - 1].id, cachedState };
    }

    const newLastMsgId = allMessages[allMessages.length - 1].id;
    let transcript = '';
    const filesToProcess = [];

    // Incluir mensagens anteriores para contexto
    const recentHistory = allMessages.slice(-10);
    let fullContextSummary = '';
    for (const msg of recentHistory) {
      const sender = msg.message_type === 0 ? 'Cliente' : 'Gerente';
      fullContextSummary += `\n[${sender}]: ${msg.content || (msg.attachments?.length ? '[Mídia/Anexo]' : '')}`;
    }

    for (const msg of deltaMessages) {
      const sender = msg.message_type === 0 ? 'Cliente' : 'Gerente';
      const content = msg.content || '';
      transcript += `\n[${sender}]: ${content}`;

      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          transcript += ` [Anexo enviado pelo ${sender}: ${att.file_type}]`;
          const ext = att.file_type === 'audio' ? 'ogg' : (att.file_type === 'image' ? 'jpg' : 'mp4');
          const localPath = await downloadAttachment(att.data_url, ext);
          if (localPath) filesToProcess.push(localPath);
        }
      }
    }

    // Identificação de Loja e Gerente Titular
    const storeName = INBOX_NAMES[inboxId] || convData.inbox?.name || `Loja #${inboxId}`;
    const defaultManager = STORE_MANAGERS[inboxId] || 'Gerente da Loja';
    const assigneeName = convData.meta?.assignee?.name;
    const lastOutgoing = allMessages.slice().reverse().find(m => m.message_type === 1);
    const senderName = lastOutgoing?.sender?.name;

    // Se o remetente for Financeiro, Bot, Admin ou nulo, utiliza o titular da unidade
    let managerName = defaultManager;
    const isGenericUser = (n) => !n || ['Financeiro', 'Bot', 'Admin Tork', 'Hydra'].includes(n);
    if (assigneeName && !isGenericUser(assigneeName)) {
      managerName = assigneeName;
    } else if (senderName && !isGenericUser(senderName)) {
      managerName = senderName;
    }

    const meta = {
      contactName,
      phoneNumber,
      inboxId,
      storeName,
      managerName,
      fullContextSummary
    };

    return { transcript, filesToProcess, newLastMsgId, cachedState, meta };
  } catch (err) {
    console.error('Erro ao puxar contexto do Chatwoot:', err.message);
    return { transcript: '', filesToProcess: [], newLastMsgId: null, cachedState: null };
  }
}

async function auditWithAgy(transcript, files, cachedState, meta) {
  return new Promise((resolve) => {
    const currentStage = cachedState?.stage || 'TRIAGEM_EXTERNA';
    const currentSummary = cachedState?.summary || 'Início do atendimento.';
    const storeName = meta?.storeName || 'Loja Tork';
    const managerName = meta?.managerName || 'Gerente';
    const contactInfo = meta ? `Nome: "${meta.contactName}" | Telefone: ${meta.phoneNumber}` : 'Cliente padrão';
    const contextHistory = meta?.fullContextSummary || '';

    const prompt = `Você é o Auditor Sênior Implacável e Roteador de Funil da rede de oficinas Mecânica Popular / Tork.
Sua missão é auditar o atendimento identificando falhas operacionais e comerciais cometidas pelos gerentes com MÁXIMA RIGIDEZ contra erros reais, mas com ZERO FALSOS POSITIVOS.

DADOS DO ATENDIMENTO:
• Loja / Unidade: ${storeName}
• Gerente / Atendente: ${managerName}
• Cliente: ${contactInfo}

ESTÁGIO ATUAL DO ATENDIMENTO: ${currentStage}
HISTÓRICO COMPACTO DAS ETAPAS ANTERIORES:
${currentSummary}

HISTÓRICO RECENTE COMPLETO DA CONVERSA:
${contextHistory}

══════════════════════════════════════════════════════════════
FILTROS OBRIGATÓRIOS CONTRA FALSOS POSITIVOS:

1. FILTRO DE INTERLOCUTOR (B2C vs B2B / FORNECEDOR / PARCEIRO):
   - Se o contato for um FORNECEDOR (peças, autopeças, retífica, câmbio, tintas, uniformes, motoboy, guincho) ou OUTRO MECÂNICO/OFICINA:
   - Se a conversa envolver cotação de peças, cobrança de entregas, prazos ou o gerente estiver desabafando sobre o cliente ("o cara tá me cobrando"):
   -> NÃO É INFRAÇÃO DE ATENDIMENTO! Defina "infracao_detectada": false, "novo_estagio": "FORNECEDOR_PARCEIRO".

2. REGRA DO CONVITE PRÉVIO PARA O ELEVADOR (CASO DE PREÇO ESTIMADO):
   - Se o gerente JÁ CONVIDOU ou ORIENTOU o cliente a comparecer para inspeção física no elevador (ex: "dá uma passada aqui que levanto o carro pra você", "passa aqui pra gente avaliar"), e o cliente INSISTIU em saber valores, perguntou se troca peça X, ou já veio com diagnóstico externo pronto de outro lugar:
   -> Passar valores de referência de peças e mão de obra NÃO É INFRAÇÃO de PRECO_PREMATURO! O gerente cumpriu o protocolo de priorizar o elevador.
   -> A infração "PRECO_PREMATURO" só ocorre se o gerente der preço fechado DE IMEDIATO, sem JAMAIS chamar ou convidar para inspecionar no elevador.

3. VEÍCULO NA OFICINA:
   - Se o carro já deu entrada física na oficina, está no pátio ou já subiu no elevador: passar orçamento fechado NÃO É INFRAÇÃO! É a conduta correta esperada.
══════════════════════════════════════════════════════════════

NOVAS MENSAGENS A AUDITAR NESTA ETAPA (DELTA):
${transcript.replace(/"/g, '\\"')}

${files.length > 0 ? `ARQUIVOS/MÍDIAS ANEXADOS NESTE INTERVALO:\n${files.join('\n')}` : ''}

REGRAS DE FALHA OPERACIONAL (CAGADAS REAIS DE GERENTES):

1. "PRECO_PREMATURO":
   - Ocorre se o carro está FORA da oficina (TRIAGEM_EXTERNA), o gerente NUNCA convidou o cliente para inspecionar no elevador e passou preço fechado de boca.

2. "SEM_TENTATIVA_FECHAMENTO" (Venda Passiva / Falta de CTA):
   - O gerente passou orçamento, explicou valor ou tirou dúvida e NÃO FEZ nenhuma pergunta de fechamento, agendamento ou condução ("podemos agendar para hoje?", "quer trazer de manhã ou à tarde?"). Apenas jogou o valor e ficou passivo esperando o cliente.

3. "UPSELL_IGNORADO" (Oportunidade Perdida):
   - O cliente relatou um segundo defeito, barulho, viagem próxima, vazamento ou dúvida preventiva, e o gerente respondeu só a primeira coisa e ignorou totalmente o relato secundário.

4. "ORCAMENTO_AMADOR" (Sem Discriminação de Peça e Mão de Obra):
   - O gerente jogou valor total redondo no susto ("fica 1200 tudo"), sem discriminar o que é peça e o que é mão de obra, ou sem detalhar o que será feito.

5. "QUEBRA_OBJECAO_OMISSA" (Desistência Passiva no Preço):
   - O cliente relutou no preço ("achei meio caro", "vou ver com minha esposa", "tô cotando"), e o gerente aceitou passivamente dizendo apenas "tá bom", "ok", "qualquer coisa me avisa", sem defender a garantia, qualidade das peças ou parcelamento.

6. "FALTA_PROATIVIDADE_PANE" (Cliente com Carro Parado sem Socorro):
   - O cliente relata que o carro quebrou na rua, não liga, ferveu ou parou, e o gerente age com frieza dizendo apenas "traz aqui", sem oferecer guincho, socorro ou apoio prático.

7. "CLIENTE_NO_VACUO" (Abandono no Meio da Conversa):
   - O cliente fez uma pergunta direta de agendamento ou dúvida técnica e o gerente o deixou no vácuo por horas sem retorno dentro do expediente.

8. "ATENDIMENTO_DESCASO_OU_RISPIDEZ":
   - Gerente ríspido, impaciente, grosseiro ou que responde de forma monossilábica e com evidente má vontade.

Se o atendimento seguiu o padrão correto, ou se o gerente convidou para o elevador, ou se for fornecedor: "infracao_detectada": false.

SCHEMA JSON OBRIGATÓRIO (responda estritamente em JSON):
{
  "novo_estagio": "TRIAGEM_EXTERNA" | "AGENDAMENTO" | "VEICULO_NA_OFICINA" | "ORCAMENTO_APRESENTADO" | "NEGOCIACAO" | "SERVICO_EM_ANDAMENTO" | "PRONTO_ENTREGA" | "POS_VENDA_GARANTIA" | "FORNECEDOR_PARCEIRO",
  "novo_passo_resumo": "1 frase curta resumindo o que aconteceu nestas novas mensagens",
  "contexto_resumido": "1 frase curta com o contexto geral do atendimento (ex: Cliente cotando troca de embreagem do HB20)",
  "infracao_detectada": boolean,
  "codigo_regra": "PRECO_PREMATURO" | "SEM_TENTATIVA_FECHAMENTO" | "UPSELL_IGNORADO" | "ORCAMENTO_AMADOR" | "QUEBRA_OBJECAO_OMISSA" | "FALTA_PROATIVIDADE_PANE" | "CLIENTE_NO_VACUO" | "ATENDIMENTO_DESCASO_OU_RISPIDEZ" | "NENHUMA",
  "descricao_falha": "1 frase direta explicando exatamente a falha",
  "trecho_cliente": "pergunta, solicitação ou fala do cliente que motivou o momento (ex: 'eu posso levar a pastilha e vcs fazem a instalação?' ou vazio se não houver)",
  "trecho_gerente": "resposta ou ação exata do gerente que cometeu a falha (ex: 'pode sim.' ou 'SEGUE ORÇAMENTO DO OUTRO COXIM')",
  "tipo_mensagem_cliente": "Texto" | "Áudio" | "Imagem",
  "tipo_mensagem_gerente": "Texto" | "Áudio" | "Imagem",
  "score_confianca": number (0 a 1)
}`;

    const args = ['-p', prompt, '--model', MODEL, '--output-format', 'json', '--dangerously-skip-permissions'];
    
    execFile(AGY_PATH, args, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
      files.forEach(f => {
        try { fs.unlinkSync(f); } catch (e) {}
      });

      if (error) {
        const errorMsg = stderr || error.message;
        console.error('Erro no agy:', errorMsg);
        redis.incr('stats:erros_ia').catch(e => console.error('Redis error:', e.message));
        return resolve(null);
      }
      
      try {
        let content = stdout.trim();
        let parsedCli = null;
        try {
          parsedCli = JSON.parse(content);
          if (parsedCli && parsedCli.response) {
            content = parsedCli.response.trim();
          }
        } catch (e) {}

        // Atualizar telemetria e Janela de 5 Horas da Cota
        const now = Math.floor(Date.now() / 1000);
        const windowStartRaw = await redis.get('quota:5h:window_start');
        let windowStart = windowStartRaw ? parseInt(windowStartRaw, 10) : null;
        
        if (!windowStart || now - windowStart >= 18000) {
          await redis.set('quota:5h:window_start', now);
          await redis.set('quota:5h:requests', '1');
        } else {
          await redis.incr('quota:5h:requests');
        }

        if (parsedCli && parsedCli.usage) {
          const inTokens = parsedCli.usage.input_tokens || 0;
          const outTokens = parsedCli.usage.output_tokens || 0;
          const totTokens = parsedCli.usage.total_tokens || (inTokens + outTokens);
          
          await redis.incrby('stats:tokens_input', inTokens);
          await redis.incrby('stats:tokens_output', outTokens);
          await redis.incrby('stats:tokens_total', totTokens);
        }

        if (content.includes('```json')) {
          content = content.split('```json')[1].split('```')[0].trim();
        } else if (content.includes('```')) {
          content = content.split('```')[1].split('```')[0].trim();
        }
        const jsonResult = JSON.parse(content);
        resolve(jsonResult);
      } catch (err) {
        console.error('Erro ao fazer parse do JSON do agy:', stdout);
        redis.incr('stats:erros_ia').catch(e => console.error('Redis error:', e.message));
        resolve(null);
      }
    });
  });
}

async function handleAuditFailure(convId, errorMsg) {
  const retryKey = `watchdog:retry:conv:${convId}`;
  const attempts = await redis.incr(retryKey);
  await redis.expire(retryKey, 86400); // 24h TTL
  if (attempts >= 3) {
    console.error(`🚨 [WORKER] Limite de 3 tentativas atingido para conversa ${convId}. Movendo para DLQ.`);
    await recordDeadLetter(redis, convId, {
      error: errorMsg,
      attempts,
      source: 'watchdog_worker'
    });
    await redis.zrem('watchdog:scheduled_evals', String(convId));
    await redis.del(retryKey);
    await redis.del(`buffer:conv:${convId}`);
    await redis.del(`debounce:conv:${convId}`);
  } else {
    const delaySeconds = attempts * 60; // 1 min, 2 min, 3 min
    const nextScore = Math.floor(Date.now() / 1000) + delaySeconds;
    await redis.zadd('watchdog:scheduled_evals', nextScore, String(convId));
    await recordRetry(redis, convId, attempts, errorMsg);
    console.warn(`⚠️ [WORKER] Falha transitória na conv ${convId} (tentativa ${attempts}/3). Reagendada com backoff para daqui a ${delaySeconds}s.`);
  }
}

async function triggerConversationAudit(convId, source = 'keyspace') {
  // 1. Ignora os próprios canais de alertas do Hydra (2121 e 2404)
  if (ALERT_CONVERSATIONS.includes(Number(convId))) {
    await redis.del(`buffer:conv:${convId}`);
    await redis.del(`debounce:conv:${convId}`);
    await redis.zrem('watchdog:scheduled_evals', String(convId));
    return;
  }

  // 2. Lock Distribuído com UUID único e renovação ativa (heartbeat a cada 20s)
  const lockKey = `evaluating:conv:${convId}`;
  const lock = await acquireLock(redis, lockKey, 60, 20000);
  if (!lock) {
    console.log(`[WORKER] Conversa ${convId} já bloqueada por outro worker/rotina. Ignorando.`);
    return;
  }

  const startTime = Date.now();

  try {
    console.log(`⏳ [${source.toUpperCase()}] Janela de 15 minutos concluída para conversa ${convId}. Puxando histórico consolidado...`);

    const { transcript, filesToProcess, newLastMsgId, cachedState, meta, isIgnored } = await fetchConversationContext(convId);

    if (isIgnored) {
      console.log(`[WORKER] Conversa ${convId} descartada por regras de filtro (fornecedor/interno). Limpando agendamento.`);
      // TWO-PHASE ACK: remove do ZSET e limpa buffers somente após confirmação do descarte
      await redis.zrem('watchdog:scheduled_evals', String(convId));
      await redis.del(`buffer:conv:${convId}`);
      await redis.del(`debounce:conv:${convId}`);
      await redis.del(`watchdog:retry:conv:${convId}`);
      return;
    }

    if (!transcript || transcript.trim() === '') {
      console.log(`[WORKER] Conversa ${convId} sem novas mensagens relevantes no período.`);
      // TWO-PHASE ACK: remove do ZSET pois não há trabalho pendente
      await redis.zrem('watchdog:scheduled_evals', String(convId));
      await redis.del(`buffer:conv:${convId}`);
      await redis.del(`debounce:conv:${convId}`);
      await redis.del(`watchdog:retry:conv:${convId}`);
      return;
    }

    console.log(`🔍 [WORKER] Auditando lote consolidado da conversa ${convId} (${filesToProcess.length} mídias, Contato: "${meta?.contactName}", Loja: "${meta?.storeName}", Gerente: "${meta?.managerName}").`);
    
    await redis.incr('stats:conversas_analisadas');

    const result = await auditWithAgy(transcript, filesToProcess, cachedState, meta);

    if (result) {
      // Trava de regressão de estágio (O funil nunca volta para trás)
      const currentRank = STAGE_RANKS[cachedState?.stage || 'TRIAGEM_EXTERNA'] || 1;
      const suggestedRank = STAGE_RANKS[result.novo_estagio] || 1;
      const finalStage = suggestedRank >= currentRank ? result.novo_estagio : (cachedState?.stage || 'TRIAGEM_EXTERNA');

      // Atualizar histórico em scratchpad compacto (até 5 passos)
      const existingSummary = cachedState?.summary || '';
      const newStep = result.novo_passo_resumo ? `• [${finalStage}]: ${result.novo_passo_resumo}` : '';
      const updatedSummaryLines = existingSummary.split('\n').filter(Boolean);
      if (newStep) updatedSummaryLines.push(newStep);
      const trimmedSummary = updatedSummaryLines.slice(-5).join('\n');

      const newState = {
        last_msg_id: newLastMsgId || cachedState?.last_msg_id,
        stage: finalStage,
        summary: trimmedSummary,
        updated_at: Math.floor(Date.now() / 1000)
      };

      // Cache persistente por 7 dias
      await redis.setex(`state:conv:${convId}`, 604800, JSON.stringify(newState));

      // TWO-PHASE ACK: Remove do ZSET e limpa buffers SOMENTE APÓS persistir com sucesso o novo estado
      await redis.zrem('watchdog:scheduled_evals', String(convId));
      await redis.del(`buffer:conv:${convId}`);
      await redis.del(`debounce:conv:${convId}`);
      await redis.del(`watchdog:retry:conv:${convId}`);

      const durationMs = Date.now() - startTime;
      await recordAuditSuccess(redis, durationMs);

      // Avaliação de infração com prova e Trava Anti-Spam com Cooldown Isolado por Destinatário
      if (result.infracao_detectada && result.score_confianca >= 0.80 && finalStage !== 'FORNECEDOR_PARCEIRO') {
        const storeName = meta?.storeName || 'Loja Tork';
        const managerName = meta?.managerName || 'Gerente';
        const tituloRegra = REGRA_TITULOS[result.codigo_regra] || result.codigo_regra || 'Infração Operacional';
        const convUrl = `${CHATWOOT_OUTBOUND_URL}/app/accounts/${ACCOUNT_ID}/conversations/${convId}`;

        const alertLines = [
          `*HYDRA | Infração Operacional*`,
          ``,
          `> *${tituloRegra}:* ${result.descricao_falha}`,
          ``,
          `*Detalhes do atendimento:*`,
          `- Loja: *${storeName}* | Responsável: *${managerName}*`,
        ];

        if (meta?.contactName) {
          alertLines.push(`- Cliente: *${meta.contactName}*`);
        }

        if (result.contexto_resumido) {
          alertLines.push(`- Contexto: ${result.contexto_resumido}`);
        }

        alertLines.push(``);
        alertLines.push(`*Diálogo auditado:*`);
        if (result.trecho_cliente) {
          const tipoCli = result.tipo_mensagem_cliente || 'Texto';
          alertLines.push(`> Cliente (${tipoCli}): "${result.trecho_cliente}"`);
        }
        const tipoGer = result.tipo_mensagem_gerente || 'Texto';
        const falaGerente = result.trecho_gerente || result.trecho_exato_gerente || 'Ação passiva sem CTA';
        alertLines.push(`> Gerente (${tipoGer}): "${falaGerente}"`);

        alertLines.push(``);
        alertLines.push(`*Acesso à conversa:*`);
        alertLines.push(`> ${convUrl}`);

        const alertMsg = alertLines.join('\n');
        
        console.log(`Infração detectada na loja ${storeName} (${managerName})! Disparando alerta com idempotência por destinatário...`);
        const statusEnvios = await sendWhatsAppAlert(alertMsg, convId, result.codigo_regra);
        
        const algumEnviado = Object.values(statusEnvios).some(s => s.enviado);
        if (algumEnviado) {
          await redis.incr('stats:infracoes_detectadas');
          await redis.hincrby('stats:infracoes_por_loja', storeName, 1);
        }
      } else {
        console.log(`Conversa ${convId} (${meta?.storeName} - ${meta?.managerName}) auditada sem infração. Estágio: ${finalStage}`);
      }
    } else {
      console.warn(`[WORKER] Auditoria via agy retornou nulo para conv ${convId}. Acionando política de retry.`);
      await handleAuditFailure(convId, 'IA retornou nulo ou falha de inferência');
    }
  } catch (err) {
    console.error(`[WORKER] Erro durante auditoria da conversa ${convId}:`, err);
    await handleAuditFailure(convId, err.message);
  } finally {
    // 4. Libera o lock atômico de forma segura via script Lua (só libera se o token for o mesmo)
    try {
      await lock.release();
    } catch (e) {
      console.error(`Erro ao liberar lock de conv ${convId}:`, e.message);
    }
    console.log(`[WORKER] ✅ Conversa ${convId} ciclo de processamento concluído.`);
  }
}

function startReconciliationWorker() {
  setInterval(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const expiredConvs = await redis.zrangebyscore('watchdog:scheduled_evals', '-inf', now);
      if (expiredConvs && expiredConvs.length > 0) {
        console.log(`[RECONCILIADOR] 🔍 Encontradas ${expiredConvs.length} conversas com janela expirada no ZSET.`);
        for (const cid of expiredConvs) {
          await triggerConversationAudit(cid, 'reconciler');
        }
      }
    } catch (err) {
      console.error('[RECONCILIADOR] Erro na varredura ZSET:', err.message);
    }
  }, 30 * 1000); // Checa a cada 30 segundos
}

async function processKeyspaceEvents() {
  await redis.config('SET', 'notify-keyspace-events', 'Ex');
  
  const sub = new Redis(REDIS_URL);
  sub.subscribe('__keyevent@0__:expired');

  sub.on('message', async (channel, key) => {
    if (key.startsWith('debounce:conv:')) {
      const convId = key.split(':')[2];
      await triggerConversationAudit(convId, 'keyspace');
    }
  });

  console.log('Worker iniciado. Escutando expirações de debounce (15 min) e agendamentos no ZSET...');
}

// Inicia ambos os motores (Pub/Sub reativo + Reconciliador periódico de resiliência)
processKeyspaceEvents();
startReconciliationWorker();
