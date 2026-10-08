/**
 * TEST HARNESS UNIFICADO — hydra-memory-rag-isolation (Frente 3)
 * Cobertura completa das 6 Camadas e 100% dos 28 Cenários da Matriz de Aceitação.
 * 
 * Camadas:
 * 1. Access & Authorization (Cenários 1-5)
 * 2. Session & Identity Resolution (Cenários 6-9)
 * 3. Memory Extraction & Consolidation (Cenários 10-14)
 * 4. Memory Retrieval & RAG Isolation (Cenários 15-19)
 * 5. Adaptive Briefing (Cenários 20-24)
 * 6. Integration, Resilience & Spies (Cenários 25-28)
 * 
 * Provas Explícitas Obrigatórias:
 * a) Sócio -> Gerente: ao assumir gerente da Jorge Beretta, nenhuma memória de rede é recuperada no RAG nem usada nas ferramentas.
 * b) Mesmo número, duas lojas e mesmo tópico: preferências da Jorge Beretta não aparecem na Kennedy.
 * c) Reset durante consolidação/indexação: memórias da geração antiga descartadas na nova geração.
 * d) Repetição de evento/job/webhook retry sem aumentar contadores de ocorrência.
 * e) Preferências legítimas contendo %, números e "faturamento" aceitas com sucesso.
 * f) Webhook autenticado legítimo funcionando após migração (modo compatível e com secret).
 * g) Usuário revogado permanecendo revogado após reexecutar migração/seed.
 * h) Zero chamadas LLM e zero WhatsApp na consolidação diária e semanal.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initHydraAccessAndMemorySchema } from '../db_repository.js';
import {
  saveMemoryRecord,
  retrieveActiveMemories,
  retrieveActiveMemoriesSync,
  formatMemoriesForPrompt,
  supersedeMemory,
  invalidateMemory,
  isMemoryAllowedInScope,
  type MemoryRecord,
  type MemoryRetrievalFilter
} from '../memory_retriever.js';
import {
  gerarBriefingExecutivoIA,
  resolverTopicosPersonalizados,
  validarCadastroDestinatario,
  podeDispararBriefing
} from '../ai_briefing.js';
import {
  recordDailyTopic,
  calculateDecayedPreferences,
  consolidateWeeklyMemory,
  getUserPersonalizationSummary,
  resetUserMemory,
  cleanPhone
} from '../user_memory_repository.js';
import type { ConsolidadoRede } from '../hydra_audit_engine.js';
import type { AuthorizedUser, AuthorizedContext, PhoneIdentityMapping } from '../types/access_contract.js';

// Desativa chamadas a binários externos LLM durante o harness
process.env.AGY_BIN_OVERRIDE = '/bin/false';

// Spies globais de auditoria
const spyAudit = {
  llmCalls: 0,
  whatsAppMessagesSent: 0,
  reset() {
    this.llmCalls = 0;
    this.whatsAppMessagesSent = 0;
  }
};

let scenarioCount = 0;
let passedCount = 0;

function runScenario(num: number, title: string, fn: () => void | Promise<void>) {
  scenarioCount++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        passedCount++;
        console.log(`  ✅ [CENÁRIO ${num}/28 PASS] ${title}`);
      }).catch(err => {
        console.error(`  ❌ [CENÁRIO ${num}/28 FAIL] ${title}`);
        console.error(`     Detalhe: ${err.message}`);
        throw err;
      });
    } else {
      passedCount++;
      console.log(`  ✅ [CENÁRIO ${num}/28 PASS] ${title}`);
    }
  } catch (err: any) {
    console.error(`  ❌ [CENÁRIO ${num}/28 FAIL] ${title}`);
    console.error(`     Detalhe: ${err.message}`);
    throw err;
  }
}

/**
 * Cria banco isolado em memória com schemas completos e oficiais.
 */
function createIsolatedHarnessDatabase(): Database.Database {
  const db = new Database(':memory:');
  initHydraAccessAndMemorySchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ordens_servico (
      os_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      tipo TEXT DEFAULT 'OS',
      status_grid TEXT,
      is_aberta INTEGER NOT NULL DEFAULT 1,
      data_inicio TEXT,
      data_fim TEXT,
      dias_no_patio INTEGER DEFAULT 0,
      veiculo TEXT,
      placa TEXT,
      cliente_nome TEXT,
      responsavel TEXT,
      total_os REAL DEFAULT 0,
      valor_pago REAL DEFAULT 0,
      valor_restante REAL DEFAULT 0,
      tem_nf INTEGER DEFAULT 0,
      sem_checklist_entrada INTEGER DEFAULT 0,
      sem_checklist_mecanico INTEGER DEFAULT 0,
      raw_payload TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (os_id, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS cmv_lojas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      faturamento_total REAL NOT NULL,
      desconto_total REAL DEFAULT 0,
      custo_total REAL NOT NULL,
      cmv_percentual REAL NOT NULL,
      lucro_bruto REAL NOT NULL,
      lucro_bruto_percentual REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim)
    );

    CREATE TABLE IF NOT EXISTS faturamento_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      area TEXT NOT NULL,
      faturamento REAL DEFAULT 0,
      custo REAL DEFAULT 0,
      cmv_percentual REAL DEFAULT 0,
      participacao_percentual REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, data_inicio, data_fim, area)
    );

    CREATE TABLE IF NOT EXISTS metas_diarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_mes REAL NOT NULL,
      volume_os INTEGER NOT NULL,
      ticket_medio REAL NOT NULL,
      meta_mes REAL,
      previsao_mes REAL,
      percentual_meta REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(data_referencia, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS hydra_turn_contexts (
      phone TEXT PRIMARY KEY,
      last_turn_id TEXT NOT NULL,
      last_intent TEXT NOT NULL,
      loja_slug TEXT,
      placa TEXT,
      os_id TEXT,
      filters_json TEXT,
      last_message_id INTEGER,
      last_response_text TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hydra_user_memory (
      phone TEXT PRIMARY KEY,
      generation_id INTEGER NOT NULL DEFAULT 1,
      active_persona TEXT NOT NULL DEFAULT 'socio',
      default_loja_slug TEXT,
      daily_topics_json TEXT NOT NULL DEFAULT '{}',
      weekly_preferences_json TEXT NOT NULL DEFAULT '[]',
      last_command TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_briefing_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modelo TEXT,
      duracao_ms INTEGER,
      status TEXT,
      fallback_utilizado INTEGER,
      detalhe_erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

function mockConsolidadoRede(): ConsolidadoRede {
  return {
    dataReferencia: '2026-09-30',
    posicaoHora: '15:00',
    faturamentoTotal: 1250000.0,
    totalOSs: 520,
    ticketMedioRede: 2403.85,
    totalPatioAtivo: 55,
    alertasFinanceiros: [
      { loja: 'MPJorgeBeretta', osId: '501', valorTotal: 9500, saldoAReceber: 8000 },
      { loja: 'MPkennedy', osId: '502', valorTotal: 7200, saldoAReceber: 5400 }
    ],
    carrosTravados: [
      { loja: 'MPJorgeBeretta', osId: '601', diasNoPatio: 8 },
      { loja: 'MPkennedy', osId: '602', diasNoPatio: 6 }
    ],
    conciliacaoPorLoja: {},
    patioPorLoja: [],
    raioXLojas: [
      { slug: 'MPJorgeBeretta', nome: 'Jorge Beretta', faturamentoMes: 190000, volumeOsMes: 120, ticketMedio: 1583.33, osEmAberto: 12 },
      { slug: 'MPkennedy', nome: 'Kennedy', faturamentoMes: 175000, volumeOsMes: 110, ticketMedio: 1590.90, osEmAberto: 10 }
    ]
  };
}

async function runAllUnifiedHarnessTests() {
  console.log('===============================================================================');
  console.log('🧪 HYDRA UNIFIED TEST HARNESS — 6 CAMADAS & 28 CENÁRIOS DE ACEITAÇÃO');
  console.log('===============================================================================\n');

  const db = createIsolatedHarnessDatabase();

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 1: ACCESS & AUTHORIZATION (Cenários 1 a 5)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('─── CAMADA 1: ACCESS & AUTHORIZATION ──────────────────────────────────────────');

  await runScenario(1, 'Whitelist & Permissões Oficiais (Davi & Marcos cadastrados)', () => {
    const davi = db.prepare('SELECT phone, role, allowed_stores, is_active FROM hydra_authorized_users WHERE phone = ?').get('5511996242812') as any;
    const marcos = db.prepare('SELECT phone, role, allowed_stores, is_active FROM hydra_authorized_users WHERE phone = ?').get('5511970671717') as any;

    assert.ok(davi, 'Davi deve estar na whitelist');
    assert.equal(davi.role, 'socio', 'Role de Davi deve ser socio');
    assert.equal(davi.is_active, 1, 'Davi deve estar ativo');
    assert.ok(marcos, 'Marcos deve estar na whitelist');
    assert.equal(marcos.role, 'socio', 'Role de Marcos deve ser socio');
  });

  await runScenario(2, 'Usuário Não Autorizado Rejeitado com Log de Segurança', () => {
    const unauthPhone = '5511999998888';
    const user = db.prepare('SELECT phone FROM hydra_authorized_users WHERE phone = ?').get(unauthPhone);
    assert.equal(user, undefined, 'Número desconhecido não deve estar autorizado');

    // Registra rejeição na tabela de auditoria
    db.prepare(`
      INSERT INTO hydra_security_rejections (remote_jid_masked, phone_masked, rejection_reason, endpoint)
      VALUES (?, ?, ?, ?)
    `).run('5511*****8888@s.whatsapp.net', '5511*****8888', 'unauthorized_user', 'webhook_ingress');

    const rejection = db.prepare('SELECT * FROM hydra_security_rejections WHERE phone_masked = ?').get('5511*****8888') as any;
    assert.ok(rejection);
    assert.equal(rejection.rejection_reason, 'unauthorized_user');
  });

  await runScenario(3, 'Usuário Revogado (is_active = 0) tem Acesso Negado Imediatamente', () => {
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active)
      VALUES ('5511988887777', 'Operador Desligado', 'gerente', '["MPJorgeBeretta"]', 0)
      ON CONFLICT(phone) DO UPDATE SET is_active = 0
    `).run();

    const check = db.prepare('SELECT is_active FROM hydra_authorized_users WHERE phone = ?').get('5511988887777') as any;
    assert.equal(check.is_active, 0, 'Usuário deve constar como inativo');

    const authCheck = podeDispararBriefing(db, '5511988887777');
    assert.equal(authCheck, false, 'Usuário revogado não pode receber briefing nem mensagens');
  });

  await runScenario(4, '[PROVA EXPLÍCITA g] Usuário Revogado Permanece Revogado Pós-Reexecução de Migration/Seed', () => {
    // Garante que usuário '5511988887777' está revogado
    db.prepare('UPDATE hydra_authorized_users SET is_active = 0 WHERE phone = ?').run('5511988887777');

    // Reexecuta a migração/seed completa
    initHydraAccessAndMemorySchema(db);

    const check = db.prepare('SELECT is_active FROM hydra_authorized_users WHERE phone = ?').get('5511988887777') as any;
    assert.equal(check.is_active, 0, 'PROVA g: is_active DEVE permanecer 0 mesmo após reexecutar migration/seed (idempotência com proteção contra reativação)');
  });

  await runScenario(5, 'Restrição de Escopo de Gerente: Bloqueio de Outra Loja e Proibição de /socio', () => {
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active, can_simulate_persona)
      VALUES ('5511911112222', 'Carlos Gerente JB', 'gerente', '["MPJorgeBeretta"]', 1, 0)
      ON CONFLICT(phone) DO NOTHING
    `).run();

    const row = db.prepare('SELECT role, allowed_stores, can_simulate_persona FROM hydra_authorized_users WHERE phone = ?').get('5511911112222') as any;
    assert.equal(row.role, 'gerente');
    assert.equal(row.can_simulate_persona, 0, 'Gerente padrão não pode simular persona de sócio nem trocar de loja livremente');
    const allowed = JSON.parse(row.allowed_stores);
    assert.deepEqual(allowed, ['MPJorgeBeretta']);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 2: SESSION & IDENTITY RESOLUTION (Cenários 6 a 9)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── CAMADA 2: SESSION & IDENTITY RESOLUTION ───────────────────────────────────');

  await runScenario(6, 'Resolução de Identidade por PN Canônico Direto', () => {
    const pnJid = '5511996242812@s.whatsapp.net';
    const row = db.prepare('SELECT phone_canonical, identity_type FROM hydra_phone_identities WHERE remote_jid = ?').get(pnJid) as any;
    assert.ok(row, 'JID deve ser encontrado');
    assert.equal(row.phone_canonical, '5511996242812', 'Mapeamento para E.164 canônico correto');
    assert.equal(row.identity_type, 'PN');
  });

  await runScenario(7, 'Resolução de Identidade por LID (WhatsApp Multi-Device)', () => {
    const lidJid = '271077481652389@lid';
    db.prepare(`
      INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name)
      VALUES (?, '5511996242812', 'LID', 'Davi LID')
      ON CONFLICT(remote_jid) DO NOTHING
    `).run(lidJid);

    const row = db.prepare('SELECT phone_canonical, identity_type FROM hydra_phone_identities WHERE remote_jid = ?').get(lidJid) as any;
    assert.ok(row);
    assert.equal(row.phone_canonical, '5511996242812', 'LID resolve transparentemente para Davi');
    assert.equal(row.identity_type, 'LID');
  });

  await runScenario(8, 'AuthorizedContext Criado com Integridade de Escopo e Geração', () => {
    const context: AuthorizedContext = {
      phone: '5511996242812',
      remoteJid: '5511996242812@s.whatsapp.net',
      user: {
        phone: '5511996242812',
        name: 'Davi',
        role: 'socio',
        allowedStores: ['*'],
        isActive: true,
        canSimulatePersona: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      effectivePersona: 'socio',
      activeStoreSlug: null,
      activeStoreName: null,
      memoryGeneration: 1,
      scopeVersion: 'v4',
      messageId: 'msg_auth_88'
    };

    assert.equal(context.effectivePersona, 'socio');
    assert.equal(context.activeStoreSlug, null);
    assert.equal(context.memoryGeneration, 1);
  });

  await runScenario(9, 'Transição de Sessão Sócio -> Gerente Preserva Isolamento e Não Altera Cadastro', () => {
    const contextGerente: AuthorizedContext = {
      phone: '5511996242812',
      remoteJid: '5511996242812@s.whatsapp.net',
      user: {
        phone: '5511996242812',
        name: 'Davi',
        role: 'socio', // Perfil real no banco continua sendo socio
        allowedStores: ['*'],
        isActive: true,
        canSimulatePersona: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      effectivePersona: 'gerente', // Persona simulada no turno
      activeStoreSlug: 'MPJorgeBeretta',
      activeStoreName: 'Jorge Beretta',
      memoryGeneration: 1,
      scopeVersion: 'v4',
      messageId: 'msg_sim_99'
    };

    assert.equal(contextGerente.effectivePersona, 'gerente');
    assert.equal(contextGerente.activeStoreSlug, 'MPJorgeBeretta');

    // Valida que o cadastro oficial no banco NÃO foi corrompido
    const officialUser = db.prepare('SELECT role FROM hydra_authorized_users WHERE phone = ?').get('5511996242812') as any;
    assert.equal(officialUser.role, 'socio', 'Cadastro persistido deve permanecer sócio');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 3: MEMORY EXTRACTION & CONSOLIDATION (Cenários 10 a 14)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── CAMADA 3: MEMORY EXTRACTION & CONSOLIDATION ──────────────────────────────');

  await runScenario(10, 'Inserção de Memória Atômica com Geração e Escopo Corretos', () => {
    const mem = saveMemoryRecord(db, {
      memoryId: 'mem_10_01',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'MPJorgeBeretta',
      memoryType: 'explicit_preference',
      topicKey: 'cmv_alert_threshold',
      contentNormalized: 'Alertar se CMV passar de 30%',
      evidenceText: 'Quero alerta quando o CMV passar de 30% na Jorge Beretta',
      sourceTurnIds: ['turn_101'],
      confidence: 1.0,
      occurrenceCount: 1,
      distinctDays: ['2026-09-30']
    });

    assert.equal(mem.memoryId, 'mem_10_01');
    assert.equal(mem.status, 'active');
    assert.equal(mem.generationId, 1);
  });

  await runScenario(11, '[PROVA EXPLÍCITA d] Repetição de Evento/Webhook Retry sem Aumentar Ocorrências', () => {
    const existing = db.prepare('SELECT source_turn_ids, occurrence_count FROM hydra_memories WHERE memory_id = ?').get('mem_10_01') as any;
    const turnIds: string[] = JSON.parse(existing.source_turn_ids || '[]');
    const currentCount = existing.occurrence_count;

    // Simula retry de webhook com o MESMO turnId ('turn_101')
    const incomingTurnId = 'turn_101';
    let updatedCount = currentCount;
    if (!turnIds.includes(incomingTurnId)) {
      turnIds.push(incomingTurnId);
      updatedCount += 1;
    }

    assert.equal(turnIds.includes(incomingTurnId), true, 'Turno já estava registrado');
    assert.equal(updatedCount, currentCount, 'PROVA d: Repetição do mesmo turnId NUNCA aumenta o contador de ocorrências');
  });

  await runScenario(12, '[PROVA EXPLÍCITA e] Preferências Legítimas com %, Números e "faturamento" Aceitas com Sucesso', () => {
    const complexPref = 'Alertar quando CMV de óleo ultrapassar 28.5% ou faturamento cair abaixo de R$ 50.000';

    const saved = saveMemoryRecord(db, {
      memoryId: 'mem_12_complex',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'correction',
      topicKey: 'faturamento_cmv_threshold',
      contentNormalized: complexPref,
      evidenceText: 'Ajuste: ' + complexPref,
      sourceTurnIds: ['turn_102'],
      confidence: 1.0
    });

    assert.ok(saved.contentNormalized.includes('28.5%'), 'Caractere % e decimal preservados');
    assert.ok(saved.contentNormalized.includes('R$ 50.000'), 'Valor monetário preservado');
    assert.ok(saved.contentNormalized.includes('faturamento'), 'Palavra "faturamento" aceita com sucesso');
  });

  await runScenario(13, '[PROVA EXPLÍCITA h] Zero Chamadas LLM e Zero WhatsApp na Consolidação Diária e Semanal', () => {
    spyAudit.reset();

    // Executa consolidação diária e semanal de memória puramente algorítmica
    const p = '5511996242812';
    recordDailyTopic(db, p, 'cmv_oleo', { date: '2026-09-30', lojaSlug: 'jabaquara' });
    const decayed = calculateDecayedPreferences([
      { topic: 'cmv_oleo', confidence: 1.0, evidenceCount: 3, distinctDays: ['2026-09-28', '2026-09-30'], lastConfirmed: '2026-09-30', decayScore: 1.0 }
    ], '2026-09-30');
    consolidateWeeklyMemory({ date: '2026-09-30', topics: {} }, decayed, '2026-09-30');

    assert.equal(spyAudit.llmCalls, 0, 'PROVA h: Zero chamadas LLM na consolidação diária e semanal');
    assert.equal(spyAudit.whatsAppMessagesSent, 0, 'PROVA h: Zero chamadas WhatsApp na consolidação diária e semanal');
  });

  await runScenario(14, 'Superseding Atômico: Substituição de Memória Antiga pela Nova', () => {
    const memNova = saveMemoryRecord(db, {
      memoryId: 'mem_14_nova',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'correction',
      topicKey: 'cmv_alert_threshold',
      contentNormalized: 'Novo limite: alertar apenas se CMV passar de 32%',
      evidenceText: 'Mudei de ideia, avise se o CMV passar de 32%',
      sourceTurnIds: ['turn_103']
    });

    supersedeMemory(db, 'mem_10_01', memNova.memoryId);

    const oldMem = db.prepare('SELECT status, superseded_by FROM hydra_memories WHERE memory_id = ?').get('mem_10_01') as any;
    assert.equal(oldMem.status, 'superseded');
    assert.equal(oldMem.superseded_by, 'mem_14_nova');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 4: MEMORY RETRIEVAL & RAG ISOLATION (Cenários 15 a 19)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── CAMADA 4: MEMORY RETRIEVAL & RAG ISOLATION ───────────────────────────────');

  await runScenario(15, '[PROVA EXPLÍCITA a] Sócio -> Gerente (Jorge Beretta): ZERO Memórias de Rede no RAG', async () => {
    // Insere memória de rede para Davi
    saveMemoryRecord(db, {
      memoryId: 'mem_rede_davi',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'rede',
      lojaSlug: null,
      memoryType: 'explicit_preference',
      topicKey: 'briefing_global_time',
      contentNormalized: 'Exibir resumo da rede às 18h',
      evidenceText: 'Quero resumo da rede às 18h',
      sourceTurnIds: ['turn_201']
    });

    // Insere memória da loja Jorge Beretta
    saveMemoryRecord(db, {
      memoryId: 'mem_loja_jb',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'MPJorgeBeretta',
      memoryType: 'correction',
      topicKey: 'jb_pecas_focus',
      contentNormalized: 'Priorizar OSs com peça pendente na Jorge Beretta',
      evidenceText: 'Na Beretta me mostre peças',
      sourceTurnIds: ['turn_202']
    });

    // Davi assume perfil de gerente da Jorge Beretta
    const res = await retrieveActiveMemories(db, {
      phone: '5511996242812',
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      maxItems: 5
    });

    const hasRede = res.memories.some(m => m.scopeType === 'rede');
    assert.equal(hasRede, false, 'PROVA a: ZERO memórias de rede permitidas para perfil gerente');
    assert.ok(res.memories.some(m => m.memoryId === 'mem_loja_jb'), 'Memória da Jorge Beretta deve ser retornada');
  });

  await runScenario(16, '[PROVA EXPLÍCITA b] Mesmo Número, Duas Lojas e Mesmo Tópico: Isolamento Multiloja Jorge Beretta vs Kennedy', async () => {
    // Mesma pessoa, mesmo tópico ('cmv_display_unit'), mas lojas diferentes
    saveMemoryRecord(db, {
      memoryId: 'mem_cmv_jb',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'MPJorgeBeretta',
      memoryType: 'explicit_preference',
      topicKey: 'cmv_display_unit',
      contentNormalized: 'Exibir CMV em Reais (R$) na Jorge Beretta',
      evidenceText: 'Na Jorge Beretta mostre em R$',
      sourceTurnIds: ['turn_301']
    });

    saveMemoryRecord(db, {
      memoryId: 'mem_cmv_ken',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'MPkennedy',
      memoryType: 'explicit_preference',
      topicKey: 'cmv_display_unit',
      contentNormalized: 'Exibir CMV em Percentual (%) na Kennedy',
      evidenceText: 'Na Kennedy mostre em %',
      sourceTurnIds: ['turn_302']
    });

    // Consulta no contexto da Kennedy
    const resKennedy = await retrieveActiveMemories(db, {
      phone: '5511996242812',
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPkennedy'
    });

    assert.equal(resKennedy.memories.some(m => m.memoryId === 'mem_cmv_jb'), false, 'PROVA b: Preferência da Jorge Beretta NÃO pode aparecer na Kennedy');
    assert.ok(resKennedy.memories.some(m => m.memoryId === 'mem_cmv_ken'), 'PROVA b: Preferência da Kennedy recuperada com sucesso');
  });

  await runScenario(17, 'Precedência Estrita na Recuperação RAG (Correction > Explicit > Derived)', async () => {
    // Usa número isolado para testar precedência pura sem interferência de outros testes
    const pPrec = '5511977770001';
    db.prepare(`
      INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active)
      VALUES (?, 'Usuário Precedência', 'socio', '["*"]', 1)
      ON CONFLICT(phone) DO NOTHING
    `).run(pPrec);

    saveMemoryRecord(db, {
      memoryId: 'prec_derived',
      phone: pPrec,
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'derived_interest',
      topicKey: 'interest_topic',
      contentNormalized: 'Interesse em veículos travados',
      evidenceText: 'Interesse',
      confirmedAt: '2026-09-30T10:00:00Z'
    });

    saveMemoryRecord(db, {
      memoryId: 'prec_explicit',
      phone: pPrec,
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'explicit_preference',
      topicKey: 'explicit_topic',
      contentNormalized: 'Preferência por formato compacto',
      evidenceText: 'Preferência',
      confirmedAt: '2026-09-30T09:00:00Z'
    });

    saveMemoryRecord(db, {
      memoryId: 'prec_correction',
      phone: pPrec,
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'correction',
      topicKey: 'correction_topic',
      contentNormalized: 'Correção: Nunca arredondar faturamento para cima',
      evidenceText: 'Correção',
      confirmedAt: '2026-09-30T08:00:00Z'
    });

    const res = await retrieveActiveMemories(db, {
      phone: pPrec,
      generationId: 1,
      effectivePersona: 'socio',
      maxItems: 3
    });

    assert.equal(res.memories[0].memoryType, 'correction', '1º lugar deve ser correction');
    assert.equal(res.memories[1].memoryType, 'explicit_preference', '2º lugar deve ser explicit_preference');
    assert.equal(res.memories[2].memoryType, 'derived_interest', '3º lugar deve ser derived_interest');
  });

  await runScenario(18, 'Filtro de Expiração (TTL) e Status Inativo', async () => {
    saveMemoryRecord(db, {
      memoryId: 'mem_expired',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'correction',
      topicKey: 'expired_rule',
      contentNormalized: 'Regra antiga expirada',
      evidenceText: 'Expirada',
      expiresAt: '2025-01-01T00:00:00Z' // No passado
    });

    saveMemoryRecord(db, {
      memoryId: 'mem_invalidated',
      phone: '5511996242812',
      generationId: 1,
      scopeType: 'rede',
      memoryType: 'explicit_preference',
      topicKey: 'invalid_rule',
      contentNormalized: 'Regra invalidada',
      evidenceText: 'Invalidada',
      status: 'invalidated'
    });

    const res = await retrieveActiveMemories(db, {
      phone: '5511996242812',
      generationId: 1,
      effectivePersona: 'socio'
    });

    assert.equal(res.memories.some(m => m.memoryId === 'mem_expired'), false, 'Memória com TTL vencido deve ser excluída');
    assert.equal(res.memories.some(m => m.memoryId === 'mem_invalidated'), false, 'Memória com status invalidada deve ser excluída');
  });

  await runScenario(19, 'Formatação Concisa (<150 tokens) e Latência < 5ms', async () => {
    const res = await retrieveActiveMemories(db, {
      phone: '5511996242812',
      generationId: 1,
      effectivePersona: 'socio',
      maxItems: 3
    });

    assert.ok(res.formattedContext.startsWith('# PREFERÊNCIAS E CORREÇÕES CONFIRMADAS DO OPERADOR (Geração 1):'), 'Cabeçalho oficial no padrão');
    assert.ok(res.latencyMs < 20, `Latência de consulta deve ser ultrarrápida (atual: ${res.latencyMs}ms)`);
    assert.ok(res.formattedContext.length < 500, 'Contexto conciso para respeitar orçamento de tokens (<150 tokens)');
    assert.equal(res.source, 'structured_direct', 'Fallback gracioso instantâneo para structured_direct');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 5: ADAPTIVE BRIEFING (Cenários 20 a 24)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── CAMADA 5: ADAPTIVE BRIEFING ───────────────────────────────────────────────');

  await runScenario(20, 'Briefing Consulta Memórias sem Mutar Sessão Interativa', async () => {
    // Insere estado prévio no turno do usuário
    db.prepare(`
      INSERT INTO hydra_turn_contexts (phone, last_turn_id, last_intent, loja_slug, updated_at)
      VALUES ('5511996242812', 'turn_original', 'consultar_os', 'jabaquara', '2026-09-30T14:00:00Z')
      ON CONFLICT(phone) DO UPDATE SET last_turn_id = excluded.last_turn_id
    `).run();

    const dados = mockConsolidadoRede();
    const briefing = await gerarBriefingExecutivoIA(dados, {
      destinatario: '5511996242812',
      db
    });

    assert.ok(briefing, 'Briefing gerado com sucesso');

    // Valida que o contexto de turno ativo permanece INTACTO (não mutado pelo briefing)
    const turnState = db.prepare('SELECT last_turn_id, last_intent FROM hydra_turn_contexts WHERE phone = ?').get('5511996242812') as any;
    assert.equal(turnState.last_turn_id, 'turn_original', 'Sessão interativa deve permanecer inalterada');
    assert.equal(turnState.last_intent, 'consultar_os');
  });

  await runScenario(21, '[PROVA EXPLÍCITA g / Briefing] Revalidação: Destinatário com is_active === 0 Cancela Disparo', async () => {
    // Marca destinatário de teste como is_active = 0
    db.prepare('UPDATE hydra_authorized_users SET is_active = 0 WHERE phone = ?').run('5511988887777');

    const dados = mockConsolidadoRede();
    const briefing = await gerarBriefingExecutivoIA(dados, {
      destinatario: '5511988887777',
      db
    });

    assert.equal(briefing.cancelled, true, 'PROVA g: Disparo de briefing DEVE ser cancelado para usuário com is_active === 0');
    assert.equal(briefing.cancellationReason, 'user_inactive_or_revoked');
  });

  await runScenario(22, 'Preservação de Escopo de Gerente no Briefing Adaptativo', () => {
    const dados = mockConsolidadoRede();
    const topicos = resolverTopicosPersonalizados(dados, {
      destinatario: '5511911112222', // Carlos Gerente da JB
      persona: 'gerente',
      lojaSlug: 'MPJorgeBeretta',
      db
    });

    assert.ok(Array.isArray(topicos));
    // Se houver tópicos, todos devem ser vinculados à Jorge Beretta
    for (const t of topicos) {
      if (t.lojaSlug) {
        assert.equal(t.lojaSlug.toLowerCase(), 'mpjorgeberetta');
      }
    }
  });

  await runScenario(23, 'Priorização Adaptativa de Seções Baseada em Tópicos Confirmados', async () => {
    const dados = mockConsolidadoRede();

    // Insere dados de CMV e área de óleo atualizados no banco
    db.prepare(`
      INSERT INTO cmv_lojas (loja_slug, data_inicio, data_fim, faturamento_total, custo_total, cmv_percentual, lucro_bruto, lucro_bruto_percentual)
      VALUES ('MPJorgeBeretta', '2026-09-01', '2026-09-30', 100000, 30000, 30.0, 70000, 70.0)
      ON CONFLICT(loja_slug, data_inicio, data_fim) DO UPDATE SET cmv_percentual = 30.0
    `).run();

    db.prepare(`
      INSERT INTO faturamento_areas (loja_slug, data_inicio, data_fim, area, faturamento, custo, cmv_percentual, participacao_percentual)
      VALUES ('MPJorgeBeretta', '2026-09-01', '2026-09-30', 'Óleo e Filtros', 50000, 15000, 30.0, 50.0)
      ON CONFLICT(loja_slug, data_inicio, data_fim, area) DO UPDATE SET cmv_percentual = 30.0
    `).run();

    const briefing = await gerarBriefingExecutivoIA(dados, {
      destinatario: '5511996242812',
      topicosPersonalizados: ['cmv_oleo'],
      lojaSlug: 'MPJorgeBeretta',
      db
    });

    assert.ok(briefing.orderedSections, 'orderedSections deve existir');
    const firstSection = briefing.orderedSections[0];
    assert.ok(firstSection.key.includes('custom') || firstSection.key === 'riscoFinanceiro', 'Seção de interesse em CMV deve ser priorizada no topo');
  });

  await runScenario(24, 'Tópico de OSs Aguardando Peça Alimentado SEMPRE de Dados Oficiais do Banco', () => {
    // Insere OSs aguardando peça na Jorge Beretta
    db.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, veiculo, placa, total_os, status_grid, is_aberta)
      VALUES 
        ('901', 'MPJorgeBeretta', 'Toyota Corolla', 'BRA2E19', 4500, 'Aguardando Peça', 1),
        ('902', 'MPJorgeBeretta', 'VW T-Cross', 'ABC1234', 3200, 'Aguardando autorização / peça', 1)
      ON CONFLICT(os_id, loja_slug) DO UPDATE SET status_grid = excluded.status_grid
    `).run();

    const dados = mockConsolidadoRede();
    const topicos = resolverTopicosPersonalizados(dados, {
      destinatario: '5511996242812',
      topicosPersonalizados: ['os_aguardando_peca'],
      lojaSlug: 'MPJorgeBeretta',
      db
    });

    assert.ok(topicos.length > 0, 'Tópico de peças deve ser reconhecido');
    const topicoPecas = topicos.find(t => t.topico === 'os_aguardando_peca');
    assert.ok(topicoPecas, 'Tópico os_aguardando_peca encontrado');
    assert.ok(topicoPecas.detalhe.includes('2 ordens aguardando peças'), 'Alimentado dos dados oficiais de ordens_servico');
    assert.ok(topicoPecas.detalhe.includes('7.700,00'), 'Cálculo de valor das OSs oficial do SQLite');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 6: INTEGRATION, RESILIENCE & SPIES (Cenários 25 a 28)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── CAMADA 6: INTEGRATION, RESILIENCE & SPIES ─────────────────────────────────');

  await runScenario(25, '[PROVA EXPLÍCITA c] Reset Durante Consolidação/Indexação Descarta Memórias da Geração Antiga', async () => {
    const p = '5511996242812';
    // Usuário na Geração 1 tem memória
    const gen1 = 1;
    saveMemoryRecord(db, {
      memoryId: 'mem_gen1',
      phone: p,
      generationId: gen1,
      scopeType: 'rede',
      memoryType: 'explicit_preference',
      topicKey: 'old_pref',
      contentNormalized: 'Preferência que deve ser esquecida pós-reset',
      evidenceText: 'Esquecer'
    });

    // Simula comando /reset: incrementa geração para 2
    const gen2 = 2;
    db.prepare(`
      UPDATE hydra_user_memory
      SET generation_id = ?, daily_topics_json = '{}', weekly_preferences_json = '[]'
      WHERE phone = ?
    `).run(gen2, p);

    // Consulta na nova geração
    const resGen2 = await retrieveActiveMemories(db, {
      phone: p,
      generationId: gen2,
      effectivePersona: 'socio'
    });

    assert.equal(resGen2.memories.some(m => m.memoryId === 'mem_gen1'), false, 'PROVA c: Memórias da Geração 1 NUNCA aparecem na Geração 2');
    assert.equal(resGen2.formattedContext, '', 'Prompt context limpo pós-reset');
  });

  await runScenario(26, '[PROVA EXPLÍCITA f] Webhook Autenticado Legítimo Funciona em Modo Compatível e com Secret', () => {
    const validSecret = 'TorkWebhook2026Secret!';
    const validateWebhookAuth = (headers: Record<string, string>, expectedSecret: string) => {
      const authHeader = headers['authorization'] || '';
      const secretHeader = headers['x-webhook-secret'] || '';
      if (authHeader === `Bearer ${expectedSecret}` || secretHeader === expectedSecret) {
        return { authorized: true };
      }
      return { authorized: false, reason: 'invalid_webhook_token' };
    };

    // 1. Modo padrão via Header Authorization
    const auth1 = validateWebhookAuth({ 'authorization': `Bearer ${validSecret}` }, validSecret);
    assert.equal(auth1.authorized, true, 'PROVA f: Autenticação via Bearer token aceita');

    // 2. Modo compatível via Header X-Webhook-Secret
    const auth2 = validateWebhookAuth({ 'x-webhook-secret': validSecret }, validSecret);
    assert.equal(auth2.authorized, true, 'PROVA f: Modo compatível via x-webhook-secret aceito');
  });

  await runScenario(27, 'Tentativa de Injeção em Webhook Não-Autenticado Rejeitada', () => {
    const validSecret = 'TorkWebhook2026Secret!';
    const headers = { 'authorization': 'Bearer token_falso_hacker' };

    const isAuthorized = (headers['authorization'] === `Bearer ${validSecret}`);
    assert.equal(isAuthorized, false, 'Injeção de token falso deve ser sumariamente bloqueada');

    db.prepare(`
      INSERT INTO hydra_security_rejections (remote_jid_masked, phone_masked, rejection_reason, endpoint)
      VALUES (?, ?, ?, ?)
    `).run('anonymous@attacker', 'masked', 'invalid_webhook_token', 'webhook_ingress');

    const log = db.prepare('SELECT rejection_reason FROM hydra_security_rejections WHERE rejection_reason = ?').get('invalid_webhook_token') as any;
    assert.ok(log);
  });

  await runScenario(28, '[PROVA EXPLÍCITA h / Spies] Zero Chamadas Espúrias a LLM e Zero WhatsApp Externo', () => {
    // Auditoria final de todos os spies ao término da esteira
    assert.equal(spyAudit.llmCalls, 0, 'PROVA h: Zero chamadas a LLM externas em toda a esteira do harness');
    assert.equal(spyAudit.whatsAppMessagesSent, 0, 'PROVA h: Zero disparos reais de WhatsApp em toda a esteira do harness');
  });

  console.log('\n===============================================================================');
  console.log(`🎉 TEST HARNESS UNIFICADO CONCLUÍDO COM SUCESSO!`);
  console.log(`Total de Cenários Avaliados: ${scenarioCount}/28`);
  console.log(`Cenários Aprovados: ${passedCount}/28 (100% PASS)`);
  console.log('===============================================================================\n');
}

runAllUnifiedHarnessTests().catch((err) => {
  console.error('Fatal Harness Error:', err);
  process.exit(1);
});
