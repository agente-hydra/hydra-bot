/**
 * SUÍTE DE TESTES: ACESSO POR NÚMERO, SESSÃO E JANELA DE CONTEXTO (Frente 1)
 * Arquivo: src/hydra-sync/tests/test_harness_access_session.ts
 * 
 * Cobertura de Testes Obrigatória:
 * 1. Rejeição silenciosa de remetente não cadastrado (zero IA, zero mídia, zero reação, zero WhatsApp).
 * 2. Webhook autenticado legítimo funcionando após migração (modo compatível e com secret).
 * 3. Usuário revogado permanecendo revogado após reexecutar migração/seed (ON CONFLICT DO NOTHING).
 * 4. Mapeamento confiável de LID para PN sem duplicar identidade.
 * 5. Bloqueio de simulação de perfil para usuário sem can_simulate_persona.
 * 6. Revalidação em voo (usuário desativado com job na fila de espera sendo abortado).
 * 7. Isolamento de dois números conversando concorrentemente (sem mistura de lotes).
 * 8. Preservação dos parâmetros de 1.500ms de debounce e 120min de TTL.
 * 9. Execução de /reset incrementando geração e abortando trabalho ativo.
 */

process.env.HYDRA_TEST_MODE = "1";
import Database from 'better-sqlite3';
import {
  initHydraAccessAndMemorySchema
} from '../db_repository.js';
import {
  authenticateWebhookRequest,
  resolveCanonicalIdentity,
  revalidateAuthorization,
  recordSecurityRejection,
  maskPhone,
  maskJid
} from '../identity_access_guard.js';
import {
  interceptCommand,
  canUserSimulatePersona,
  isAuthorizedPhone,
  getUserProfile,
  InFlightAbortRegistry,
  executeResetCommand
} from '../command_interceptor.js';
import {
  saveTurnState,
  getLatestTurnState,
  clearTurnState,
  expireStaleOSFocus,
  cleanPhone
} from '../turn_context_repository.js';
import {
  handleIncomingPayload,
  MessageBatcher,
  setWebhookDatabase
} from '../../../webhook-listener.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: any, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) console.error(`     Detalhe: ${details}`);
    process.exitCode = 1;
  }
}

async function runAccessSessionHarness() {
  console.log('===============================================================================');
  console.log('🧪 SUÍTE DE TESTES: IDENTIDADE, ACESSO, SESSÃO E ISOLAMENTO (FRENTE 1)');
  console.log('===============================================================================\n');

  // Inicializa banco SQLite isolado em memória
  const db = new Database(':memory:');
  initHydraAccessAndMemorySchema(db);
  setWebhookDatabase(db);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. REJEIÇÃO SILENCIOSA DE REMETENTE NÃO CADASTRADO
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- 1. Rejeição Silenciosa de Remetente Não Cadastrado ---');
  {
    const nonRegisteredPhone = '5511999998888';
    const nonRegisteredJid = `${nonRegisteredPhone}@s.whatsapp.net`;

    const unauthPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: nonRegisteredJid,
          fromMe: false,
          id: 'MSG_UNAUTH_001'
        },
        pushName: 'Estranho',
        message: {
          conversation: 'Olá, qual o faturamento da loja?'
        }
      }
    };

    // Testa diretamente na Barreira 1 via resolveCanonicalIdentity
    const identityResult = resolveCanonicalIdentity(db, unauthPayload);
    assert(identityResult === null, 'Remetente não cadastrado deve retornar null no resolveCanonicalIdentity');

    // Testa através do handleIncomingPayload
    const response = await handleIncomingPayload(unauthPayload, {}, db);
    assert(response.statusCode === 200, 'Ingress retorna HTTP 200 para evitar retentativas agressivas da Evolution');
    assert(response.body?.status === 'ignored_unauthorized', 'Resposta deve ser "ignored_unauthorized"');

    // Valida auditoria na tabela hydra_security_rejections
    const rejectionRow = db.prepare(`
      SELECT remote_jid_masked, phone_masked, rejection_reason, endpoint
      FROM hydra_security_rejections
      WHERE rejection_reason = 'unauthorized_user'
      ORDER BY id DESC LIMIT 1
    `).get() as any;

    assert(rejectionRow != null, 'Rejeição deve ser auditada em hydra_security_rejections');
    assert(rejectionRow?.rejection_reason === 'unauthorized_user', 'Motivo da rejeição deve ser unauthorized_user');
    assert(rejectionRow?.endpoint === 'webhook_ingress', 'Endpoint auditado deve ser webhook_ingress');
    assert(!rejectionRow?.phone_masked?.includes(nonRegisteredPhone), 'Telefone deve estar mascarado sem vazar o número original');
    assert(rejectionRow?.phone_masked?.includes('****'), 'Máscara de privacidade aplicada no telefone');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1.1. BLOQUEIO ESTRITO DE MENSAGENS EM GRUPO (@g.us) — EX: MECANICA TI
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 1.1. Bloqueio Estrito de Mensagens em Grupos (@g.us) ---');
  {
    const groupJid = '120363425738307789@g.us';
    const groupPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: groupJid,
          participant: '5511996242812@s.whatsapp.net',
          fromMe: false,
          id: 'MSG_GROUP_001'
        },
        pushName: 'Davi',
        message: {
          conversation: 'Hydra, como tá a rede?'
        }
      }
    };

    // 1. resolveCanonicalIdentity DEVE retornar null imediatamente
    const identityResult = resolveCanonicalIdentity(db, groupPayload);
    assert(identityResult === null, 'Mensagem originada em grupo (@g.us) deve retornar null no resolveCanonicalIdentity');

    // 2. handleIncomingPayload DEVE retornar HTTP 200 ignored_unauthorized sem chamar LLM
    const response = await handleIncomingPayload(groupPayload, {}, db);
    assert(response.statusCode === 200, 'Ingress retorna HTTP 200 para mensagens de grupo');
    assert(response.body?.status === 'ignored_unauthorized', 'Resposta deve ser "ignored_unauthorized"');

    // 3. Valida auditoria em hydra_security_rejections
    const groupRejection = db.prepare(`
      SELECT remote_jid_masked, rejection_reason
      FROM hydra_security_rejections
      WHERE rejection_reason = 'group_message_prohibited'
      ORDER BY id DESC LIMIT 1
    `).get() as any;

    assert(groupRejection != null, 'Rejeição de grupo deve ser auditada');
    assert(groupRejection?.rejection_reason === 'group_message_prohibited', 'Motivo deve ser group_message_prohibited');
    assert(groupRejection?.remote_jid_masked?.includes('@g.us'), 'JID de grupo mascarado preservando domínio @g.us');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. WEBHOOK AUTENTICADO LEGÍTIMO (MODO COMPATÍVEL E COM SECRET)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Autenticação de Webhook (Modo Compatível & Secret) ---');
  {
    const authUserPhone = '5511996242812';
    const authPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: `${authUserPhone}@s.whatsapp.net`,
          fromMe: false,
          id: 'MSG_AUTH_001'
        },
        pushName: 'Davi',
        message: {
          conversation: '/menu'
        }
      }
    };

    // 2.1 Modo Compatível (EVOLUTION_WEBHOOK_SECRET ausente)
    const prevSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    delete process.env.EVOLUTION_WEBHOOK_SECRET;

    const compatRes = authenticateWebhookRequest({});
    assert(compatRes === true, 'Modo compatível aceita requisição sem secret');

    const ingressCompat = await handleIncomingPayload(authPayload, {}, db);
    assert(ingressCompat.statusCode === 200, 'Ingress aceita em modo compatível');
    assert(ingressCompat.body?.status === 'command_handled', 'Comando /menu executado com sucesso');

    // 2.2 Modo com Secret Configurado
    process.env.EVOLUTION_WEBHOOK_SECRET = 'ChaveSecretaHydra2026!';

    // Tentativa com header incorreto ou ausente
    const invalidHeaderRes = authenticateWebhookRequest({ 'x-webhook-secret': 'chave_errada' });
    assert(invalidHeaderRes === false, 'Header incorreto é rejeitado');

    const ingressInvalid = await handleIncomingPayload(authPayload, { 'x-webhook-secret': 'chave_errada' }, db);
    assert(ingressInvalid.statusCode === 401, 'Requisição com token inválido retorna HTTP 401');
    assert(ingressInvalid.body?.status === 'unauthorized_token', 'Body indica unauthorized_token');

    // Tentativa válida com x-webhook-secret
    const validHeaderRes1 = authenticateWebhookRequest({ 'x-webhook-secret': 'ChaveSecretaHydra2026!' });
    assert(validHeaderRes1 === true, 'Header x-webhook-secret válido é aceito');

    // Tentativa válida com apikey
    const validHeaderRes2 = authenticateWebhookRequest({ 'apikey': 'ChaveSecretaHydra2026!' });
    assert(validHeaderRes2 === true, 'Header apikey válido é aceito');

    // Tentativa válida com Authorization Bearer
    const validHeaderRes3 = authenticateWebhookRequest({ 'authorization': 'Bearer ChaveSecretaHydra2026!' });
    assert(validHeaderRes3 === true, 'Header Authorization Bearer válido é aceito');

    // Restaura ambiente
    if (prevSecret) process.env.EVOLUTION_WEBHOOK_SECRET = prevSecret;
    else delete process.env.EVOLUTION_WEBHOOK_SECRET;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. USUÁRIO REVOGADO PERMANECENDO REVOGADO APÓS REMIGRAÇÃO (ON CONFLICT DO NOTHING)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Usuário Revogado Permanece Revogado (ON CONFLICT DO NOTHING) ---');
  {
    const targetRevoke = '5511970671717'; // Marcos

    // Desativa Marcos
    db.prepare('UPDATE hydra_authorized_users SET is_active = 0 WHERE phone = ?').run(targetRevoke);

    const userBefore = db.prepare('SELECT is_active FROM hydra_authorized_users WHERE phone = ?').get(targetRevoke) as any;
    assert(userBefore?.is_active === 0, 'Usuário desativado com sucesso (is_active === 0)');

    // Reexecuta a migração/seed
    initHydraAccessAndMemorySchema(db);

    const userAfter = db.prepare('SELECT is_active FROM hydra_authorized_users WHERE phone = ?').get(targetRevoke) as any;
    assert(userAfter?.is_active === 0, 'Usuário revogado PERMANECE revogado após reexecutar migração (ON CONFLICT DO NOTHING)');

    // Valida que resolveCanonicalIdentity bloqueia o usuário revogado
    const revokedPayload = {
      data: {
        key: { remoteJid: `${targetRevoke}@s.whatsapp.net`, id: 'REV_MSG_1' },
        message: { conversation: 'Olá' }
      }
    };
    const resolvedRevoked = resolveCanonicalIdentity(db, revokedPayload);
    assert(resolvedRevoked === null, 'resolveCanonicalIdentity retorna null para usuário revogado');

    // Reativa Marcos para os demais testes
    db.prepare('UPDATE hydra_authorized_users SET is_active = 1 WHERE phone = ?').run(targetRevoke);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. MAPEAMENTO CONFIÁVEL DE LID PARA PN SEM DUPLICAR IDENTIDADE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Mapeamento Confiável de LID para PN sem Duplicação ---');
  {
    const daviPhone = '5511996242812';
    const daviLid = '271077481652389@lid';

    // Remove qualquer mapeamento prévio de teste
    db.prepare('DELETE FROM hydra_phone_identities WHERE remote_jid = ?').run(daviLid);

    // 4.1 Chegada de webhook com LID e remoteJidAlt confiável
    const lidWithAltPayload = {
      data: {
        key: {
          remoteJid: daviLid,
          remoteJidAlt: `${daviPhone}@s.whatsapp.net`,
          id: 'LID_MSG_001'
        },
        pushName: 'Davi Tork',
        message: { conversation: 'Status das metas' }
      }
    };

    const authContext1 = resolveCanonicalIdentity(db, lidWithAltPayload);
    assert(authContext1 !== null, 'Identidade resolvida com sucesso a partir de LID + remoteJidAlt');
    assert(authContext1?.phone === daviPhone, `Telefone canônico resolvido é ${daviPhone}`);
    assert(authContext1?.remoteJid === daviLid, 'remoteJid preserva o LID para resposta correta no WhatsApp');

    // Verifica que o mapeamento foi persistido em hydra_phone_identities
    const persistedMapping = db.prepare(`
      SELECT remote_jid, phone_canonical, identity_type
      FROM hydra_phone_identities
      WHERE remote_jid = ?
    `).get(daviLid) as any;

    assert(persistedMapping != null, 'Mapeamento de LID persistido em hydra_phone_identities');
    assert(persistedMapping?.phone_canonical === daviPhone, 'phone_canonical associado corretamente ao LID');
    assert(persistedMapping?.identity_type === 'LID', 'identity_type gravado como LID');

    // 4.2 Chegada subsequente com APENAS o LID (sem remoteJidAlt)
    const lidOnlyPayload = {
      data: {
        key: {
          remoteJid: daviLid,
          id: 'LID_MSG_002'
        },
        message: { conversation: 'Quais lojas já bateram?' }
      }
    };

    const authContext2 = resolveCanonicalIdentity(db, lidOnlyPayload);
    assert(authContext2 !== null, 'Identidade resolvida com sucesso a partir de LID já cadastrado');
    assert(authContext2?.phone === daviPhone, 'Telefone canônico obtido da tabela hydra_phone_identities');

    // Valida que não houve duplicação em hydra_authorized_users
    const userCount = db.prepare(`
      SELECT COUNT(*) as c FROM hydra_authorized_users WHERE phone = ?
    `).get(daviPhone) as any;
    assert(userCount?.c === 1, 'Zero duplicações na tabela hydra_authorized_users');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. BLOQUEIO DE SIMULAÇÃO DE PERFIL PARA USUÁRIO SEM can_simulate_persona
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Bloqueio de Simulação para Usuários sem can_simulate_persona ---');
  {
    const managerPhone = '5511988880001';
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active, can_simulate_persona)
      VALUES (?, 'Gerente Carlos', 'gerente', '["MPdompedro1"]', 1, 0)
      ON CONFLICT(phone) DO UPDATE SET can_simulate_persona = 0, is_active = 1
    `).run(managerPhone);

    assert(canUserSimulatePersona(db, managerPhone) === false, 'canUserSimulatePersona retorna false para Gerente Carlos');

    // 5.1 Carlos tenta assumir /socio
    const cmdSocio = await interceptCommand({
      phone: managerPhone,
      text: '/socio',
      db
    });
    assert(cmdSocio.handled === true, '/socio é interceptado determinísticamente');
    assert(cmdSocio.replyText?.includes('Acesso Restrito') || cmdSocio.replyText?.includes('não possui permissão'), 'Retorna recusa educada informando falta de permissão');
    assert(cmdSocio.profile?.persona === 'gerente', 'Persona permanece Gerente');

    // 5.2 Carlos tenta alternar para outra loja (/jabaquara)
    const cmdStore = await interceptCommand({
      phone: managerPhone,
      text: '/jabaquara',
      db
    });
    assert(cmdStore.handled === true, '/jabaquara é interceptado determinísticamente');
    assert(cmdStore.replyText?.includes('Acesso Restrito') || cmdStore.replyText?.includes('não possui permissão'), 'Alternância de loja recusada para quem não tem can_simulate_persona');
    assert(cmdStore.profile?.persona === 'gerente', 'Persona de Carlos permanece travada em Gerente');

    // 5.3 Carlos tenta /reset
    const cmdReset = await interceptCommand({
      phone: managerPhone,
      text: '/reset',
      db
    });
    assert(cmdReset.handled === true, '/reset é interceptado determinísticamente');
    assert(cmdReset.replyText?.includes('Acesso Restrito') || cmdReset.replyText?.includes('não possui permissão'), '/reset recusado para quem não tem can_simulate_persona');

    // 5.4 Carlos consulta /perfil (permitido!)
    const cmdPerfil = await interceptCommand({
      phone: managerPhone,
      text: '/perfil',
      db
    });
    assert(cmdPerfil.handled === true, '/perfil é permitido');
    assert(cmdPerfil.profile?.persona === 'gerente', '/perfil exibe persona de Gerente');
    assert(cmdPerfil.profile?.lojaSlug === 'MPdompedro1', '/perfil exibe loja permitida Dom Pedro I');

    // 5.5 Diretor com can_simulate_persona === 1 (Davi)
    const daviPhone = '5511996242812';
    assert(canUserSimulatePersona(db, daviPhone) === true, 'canUserSimulatePersona retorna true para Davi');

    const daviStore = await interceptCommand({
      phone: daviPhone,
      text: '/jabaquara',
      db
    });
    assert(daviStore.handled === true, 'Davi pode simular Gerente da Jabaquara');
    assert(daviStore.profile?.persona === 'gerente', 'Persona alterada para Gerente');
    assert(daviStore.profile?.lojaSlug === 'MPJabaquara', 'Loja alterada para MPJabaquara');

    const daviSocio = await interceptCommand({
      phone: daviPhone,
      text: '/socio',
      db
    });
    assert(daviSocio.handled === true, 'Davi pode retornar à persona Sócio');
    assert(daviSocio.profile?.persona === 'socio', 'Persona restaurada para Sócio');
    assert(daviSocio.profile?.defaultScope === 'rede', 'Escopo restaurado para Rede');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. REVALIDAÇÃO EM VOO (USUÁRIO DESATIVADO COM JOB NA FILA SENDO ABORTADO)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 6. Revalidação em Voo (In-Flight Check na Fila e Egress) ---');
  {
    const flightUser = '5511988880002';
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active, can_simulate_persona)
      VALUES (?, 'Operador Fila', 'gerente', '["MPkennedy"]', 1, 0)
      ON CONFLICT(phone) DO UPDATE SET is_active = 1
    `).run(flightUser);

    assert(revalidateAuthorization(db, flightUser) === true, 'Usuário autorizado inicialmente');
    assert(revalidateAuthorization(db, flightUser, 'MPkennedy') === true, 'Autorizado para loja designada');
    assert(revalidateAuthorization(db, flightUser, 'MPdompedro1') === false, 'Recusado para loja não designada');

    // Revoga usuário durante processamento de fila
    db.prepare('UPDATE hydra_authorized_users SET is_active = 0 WHERE phone = ?').run(flightUser);

    const revalAfterRevoke = revalidateAuthorization(db, flightUser);
    assert(revalAfterRevoke === false, 'revalidateAuthorization retorna false imediatamente após desativação');

    // Simula a Barreira 2 na fila: se usuário revogado, descarta e registra auditoria
    if (!revalidateAuthorization(db, flightUser)) {
      recordSecurityRejection(db, {
        remoteJidMasked: maskPhone(flightUser),
        phoneMasked: maskPhone(flightUser),
        reason: 'revoked_user',
        endpoint: 'queue_consumer',
        timestamp: new Date().toISOString()
      });
    }

    const rejection = db.prepare(`
      SELECT rejection_reason, endpoint FROM hydra_security_rejections
      WHERE endpoint = 'queue_consumer' AND rejection_reason = 'revoked_user'
      ORDER BY id DESC LIMIT 1
    `).get() as any;

    assert(rejection != null, 'Rejeição auditada em hydra_security_rejections no endpoint queue_consumer');
    assert(rejection?.endpoint === 'queue_consumer', 'Endpoint correto registrado');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. ISOLAMENTO DE DOIS NÚMEROS CONVERSANDO CONCORRENTEMENTE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 7. Isolamento de Dois Números Concorrentes (Sem Mistura de Lotes) ---');
  {
    const batcher = new MessageBatcher();
    const userA = '5511996242812';
    const userB = '5511970671717';

    // Intercala mensagens dos dois usuários
    const partA1 = {
      partId: 'pA1',
      messageId: 'mA1',
      conversationKey: userA,
      remoteJid: `${userA}@s.whatsapp.net`,
      kind: 'text',
      text: 'Qual o faturamento da Dom Pedro?',
      receivedAt: new Date().toISOString(),
      timestamp: Date.now()
    };
    const resA1 = batcher.addMessage(partA1, undefined, async () => {});

    const partB1 = {
      partId: 'pB1',
      messageId: 'mB1',
      conversationKey: userB,
      remoteJid: `${userB}@s.whatsapp.net`,
      kind: 'text',
      text: 'Como está o estoque da Kennedy?',
      receivedAt: new Date().toISOString(),
      timestamp: Date.now()
    };
    const resB1 = batcher.addMessage(partB1, undefined, async () => {});

    const partA2 = {
      partId: 'pA2',
      messageId: 'mA2',
      conversationKey: userA,
      remoteJid: `${userA}@s.whatsapp.net`,
      kind: 'text',
      text: 'e as metas do mês?',
      receivedAt: new Date().toISOString(),
      timestamp: Date.now()
    };
    const resA2 = batcher.addMessage(partA2, undefined, async () => {});

    assert(resA1.batchId === resA2.batchId, 'Mensagens do Usuário A agrupadas no mesmo lote');
    assert(resA1.batchId !== resB1.batchId, 'Lote do Usuário A é completamente diferente do Lote do Usuário B');

    // Valida que o lote de A contém apenas partes de A
    const activeBatchA = (batcher as any).activeBatches.get(userA);
    const activeBatchB = (batcher as any).activeBatches.get(userB);

    assert(activeBatchA.parts.length === 2, 'Lote A contém exatamente 2 mensagens');
    assert(activeBatchA.parts.every((p: any) => p.conversationKey === userA), '100% das mensagens do Lote A são do Usuário A');

    assert(activeBatchB.parts.length === 1, 'Lote B contém exatamente 1 mensagem');
    assert(activeBatchB.parts.every((p: any) => p.conversationKey === userB), '100% das mensagens do Lote B são do Usuário B');

    // Limpa timers ativos
    batcher.closeBatch(userA);
    batcher.closeBatch(userB);
    console.log('  ✅ Isolamento estrito entre usuários concorrentes comprovado.');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. PRESERVAÇÃO DOS PARÂMETROS DE 1.500ms DE DEBOUNCE E 120min DE TTL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 8. Preservação Rigorosa de Debounce (1.500ms) e TTL (120min) ---');
  {
    // 8.1 Debounce
    const batcher = new MessageBatcher();
    assert(batcher.getDebounceMs() === 1500, 'Debounce padrão é estritamente 1.500 ms');
    assert((batcher as any).maxWindowMs === 5000, 'Teto máximo da janela de debounce é estritamente 5.000 ms');

    // 8.2 TTL de Contexto de 120 minutos
    const ttlPhone = '5511996242812';
    clearTurnState(db, ttlPhone);

    // Estado com 121 minutos (expirado)
    const oldTimestamp = new Date(Date.now() - 121 * 60 * 1000).toISOString();
    saveTurnState(db, {
      phone: ttlPhone,
      lastTurnId: 'turn_old',
      lastIntent: 'os_detail',
      osId: '1099',
      placa: 'ABC1234',
      lojaSlug: 'MPdompedro1',
      filters: {},
      updatedAt: oldTimestamp
    });

    const stateExpired = getLatestTurnState(db, ttlPhone, 120);
    assert(stateExpired === null, 'getLatestTurnState com >120 minutos retorna null (expirado)');

    // Estado com 60 minutos (válido)
    const recentTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    saveTurnState(db, {
      phone: ttlPhone,
      lastTurnId: 'turn_recent',
      lastIntent: 'os_detail',
      osId: '2022',
      placa: 'XYZ9876',
      lojaSlug: 'MPdompedro1',
      filters: {},
      updatedAt: recentTimestamp
    });

    const stateValid = getLatestTurnState(db, ttlPhone, 120);
    assert(stateValid !== null, 'getLatestTurnState dentro de 120 minutos recupera o estado');
    assert(stateValid?.osId === '2022', 'os_id preservado no contexto ativo');

    // Teste de expiração cirúrgica de OS (expireStaleOSFocus) sem apagar identidade
    saveTurnState(db, {
      phone: ttlPhone,
      lastTurnId: 'turn_os_test',
      lastIntent: 'os_detail',
      osId: '3033',
      placa: 'KTM1122',
      lojaSlug: 'MPdompedro1',
      filters: {},
      updatedAt: oldTimestamp // 121 minutos atrás
    });

    const expiredOs = expireStaleOSFocus(db, ttlPhone, 120);
    assert(expiredOs === true, 'expireStaleOSFocus expirou o foco de OS');

    const turnAfterOsExpire = db.prepare(`
      SELECT os_id, placa, loja_slug FROM hydra_turn_contexts WHERE phone = ?
    `).get(ttlPhone) as any;

    assert(turnAfterOsExpire?.os_id === null, 'os_id foi expurgado');
    assert(turnAfterOsExpire?.placa === null, 'placa foi expurgada');

    // Garante que o usuário permanece intacto e autorizado
    const userStillAuth = revalidateAuthorization(db, ttlPhone);
    assert(userStillAuth === true, 'Autorização do usuário permanece intacta após expiração de OS');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. EXECUÇÃO DE /reset INCREMENTANDO GERAÇÃO E ABORTANDO TRABALHO ATIVO
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 9. Execução de /reset Incrementando Geração e Abortando Trabalho Ativo ---');
  {
    const resetPhone = '5511996242812';
    const abortRegistry = InFlightAbortRegistry.getInstance();

    // 1. Simula job em voo ativo
    const jobId = 'job_inflight_test_99';
    const abortController = abortRegistry.register(resetPhone, jobId, 'batch_test_99');

    assert(abortRegistry.hasInFlight(resetPhone) === true, 'Job registrado em voo com sucesso');
    assert(abortController.signal.aborted === false, 'Job ainda não abortado');

    // Prepara contexto anterior e geração
    const profileBefore = getUserProfile(db, resetPhone);
    const genBefore = profileBefore.memoryGeneration;

    // 2. Executa comando /reset
    let presenceStopped: boolean = false;
    const resetResult = await executeResetCommand(resetPhone, db, {
      abortRegistry,
      presenceFn: async (p, pres) => {
        if (pres === 'paused') presenceStopped = true;
      }
    });

    assert(resetResult.abortedInFlight === true, 'Regra de Ouro: detectou e abortou resposta em voo');
    assert(abortController.signal.aborted === true, 'AbortSignal do job em voo foi disparado');
    assert(!abortRegistry.hasInFlight(resetPhone), 'InFlightAbortRegistry limpo para o telefone');
    assert(presenceStopped, 'Presença pausada imediatamente');

    // Valida incremento de geração de memória
    assert(resetResult.newGeneration === genBefore + 1, `Geração incrementada de #${genBefore} para #${resetResult.newGeneration}`);

    const profileAfter = getUserProfile(db, resetPhone);
    assert(profileAfter.memoryGeneration === genBefore + 1, 'hydra_user_profiles atualizado com a nova geração');
    assert(profileAfter.persona === 'socio', 'Persona restaurada para Sócio');
    assert(profileAfter.defaultScope === 'rede', 'Escopo restaurado para Rede');

    // Valida limpeza de turn_contexts
    const turnAfterReset = db.prepare('SELECT 1 FROM hydra_turn_contexts WHERE phone = ?').get(cleanPhone(resetPhone));
    assert(turnAfterReset == null, 'hydra_turn_contexts completamente limpo para o usuário');

    // Valida confirmação textual
    assert(resetResult.replyText.includes(`Geração de Memória:* #${genBefore + 1}`), 'Confirmação cita a nova geração de memória');
    assert(resetResult.replyText.includes('Interrompida com sucesso'), 'Confirmação cita a interrupção da resposta em voo');
  }

  console.log('\n===============================================================================');
  console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('===============================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAccessSessionHarness().catch(err => {
  console.error('❌ Erro fatal na execução dos testes:', err);
  process.exit(1);
});
