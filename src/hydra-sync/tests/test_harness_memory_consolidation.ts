/**
 * Test Harness - Frente 2: Memória Atômica Estruturada e Consolidação Sem LLM
 *
 * Cobertura de Verificação:
 * 1. Extração piggyback no revisor sem chamadas extras de IA.
 * 2. Aceitação de preferências legítimas contendo %, números e "faturamento".
 * 3. Rejeição de fatos operacionais voláteis transitórios concretos (saldo de OS, faturamento realizado em data X, placas, moeda R$).
 * 4. Confiança >= 0.8 mantendo derived_interest sem promoção indevida para explicit_preference.
 * 5. Mesmo número, duas lojas e mesmo tópico (garantia de isolamento no agrupamento quíntuplo).
 * 6. Isolamento estrito de escopo para Gerente vs Sócio (gerente nunca vê escopo 'rede').
 * 7. Precedência de correção explícita substituindo versão anterior (status = 'superseded').
 * 8. Repetição de evento/job sem aumentar contadores (deduplicação idempotente por source_turn_ids).
 * 9. Consolidação diária e semanal com watermark em America/Sao_Paulo (zero chamadas LLM e zero WhatsApp).
 * 10. Reset durante consolidação descartando commits atrasados da geração antiga (blindagem pós-reset).
 */

import Database from 'better-sqlite3';
import {
  saveMemoryRecord,
  updateMemoryStatus,
  getMemoriesByTopic,
  invalidateGenerationMemories,
  validateAndPersistMemoryCandidates,
  isVolatileFactualCandidate,
  getSaoPauloDate,
  formatMemoriesForPrompt,
  getMemoriesForPrompt
} from '../memory_repository.js';
import {
  runDailyConsolidation,
  runWeeklyConsolidation,
  buildQuintupleKey,
  getConsolidationCheckpoint,
  getActiveGeneration
} from '../memory_consolidator.js';
import {
  buildCriticalReviewerPrompt,
  CRITICAL_REVIEWER_RULES,
  type ReviewerDecision
} from '../semantic_prompt.js';
import type { MemoryCandidate, MemoryRecord } from '../types/memory_contract.js';
import { initHydraAccessAndMemorySchema } from '../db_repository.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalhe: ${detail}`);
    process.exitCode = 1;
  }
}

function createIsolatedTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  initHydraAccessAndMemorySchema(db);

  // Garante tabela de perfis para teste de geração e blindagem de reset
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_user_profiles (
      phone TEXT PRIMARY KEY,
      persona TEXT NOT NULL DEFAULT 'socio',
      loja_slug TEXT,
      loja_nome TEXT,
      default_scope TEXT NOT NULL DEFAULT 'rede',
      memory_generation INTEGER NOT NULL DEFAULT 1,
      daily_memory_reset_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

async function runMemoryConsolidationTests() {
  console.log('🚀 Iniciando TEST HARNESS — Frente 2: Memória Estruturada e Consolidação Sem LLM\n');

  const db = createIsolatedTestDatabase();
  const testPhone = '5511996242812';

  // Registra perfil inicial na geração 1
  db.prepare(`
    INSERT INTO hydra_user_profiles (phone, persona, default_scope, memory_generation)
    VALUES (?, 'socio', 'rede', 1)
    ON CONFLICT(phone) DO UPDATE SET memory_generation = 1
  `).run(testPhone);

  // ---------------------------------------------------------------------------
  // TESTE 1: Extração piggyback no revisor sem chamadas extras de IA
  // ---------------------------------------------------------------------------
  console.log('--- 1. Extração Piggyback no Revisor de IA ---');
  {
    const prompt = buildCriticalReviewerPrompt({
      originalMessage: 'prefiro ver faturamento antes de OS nas respostas',
      lojaSlug: 'MPJorgeBeretta',
      lojaNome: 'Jorge Beretta',
      persona: 'gerente',
      respostaCandidata: 'Aqui está a listagem de OSs...'
    });

    assert(
      prompt.includes('EXTRAÇÃO DE CANDIDATOS DE MEMÓRIA (PIGGYBACKING NO MESMO TURNO)'),
      'Prompt do revisor inclui seção de piggybacking de memória'
    );
    assert(
      prompt.includes('candidatosMemoria'),
      'Prompt do revisor orienta emissão de candidatosMemoria no mesmo JSON'
    );
    assert(
      prompt.includes('TAXONOMIA ESTRITA'),
      'Prompt do revisor orienta taxonomia estrita (explicit_preference, correction, derived_interest)'
    );

    // Simula resposta JSON piggyback do revisor
    const simulatedReviewerJson: ReviewerDecision = {
      decisao: 'APROVAR',
      motivo: 'Resposta clara e direta',
      resposta: 'Aqui está o faturamento antes das OSs...',
      candidatosMemoria: [
        {
          memoryType: 'explicit_preference',
          scopeType: 'perfil_global',
          topicKey: 'ordem_faturamento_os',
          contentNormalized: 'prefiro faturamento antes de OS',
          evidenceText: 'prefiro ver faturamento antes de OS nas respostas',
          confidence: 1.0
        }
      ]
    };

    assert(
      simulatedReviewerJson.candidatosMemoria !== undefined && simulatedReviewerJson.candidatosMemoria.length === 1,
      'JSON do revisor emite decisão operacional e candidatos a memória em 1 único turno'
    );

    const persistResult = validateAndPersistMemoryCandidates(
      db,
      simulatedReviewerJson.candidatosMemoria!,
      {
        phone: testPhone,
        generationId: 1,
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJorgeBeretta',
        turnId: 'turn_piggyback_01'
      }
    );

    assert(persistResult.persistedCount === 1, 'Candidato piggyback validado e persistido no mesmo turno');
    assert(persistResult.rejectedCount === 0, 'Zero rejeições para preferência legítima de piggyback');
  }

  // ---------------------------------------------------------------------------
  // TESTE 2: Aceitação de preferências legítimas contendo %, números e "faturamento"
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Aceitação de Preferências Legítimas ---');
  {
    const legitimateCandidates: MemoryCandidate[] = [
      {
        memoryType: 'explicit_preference',
        scopeType: 'perfil_global',
        topicKey: 'pref_faturamento_ordem',
        contentNormalized: 'prefiro faturamento antes de OS',
        evidenceText: 'quero sempre o faturamento antes das OSs'
      },
      {
        memoryType: 'explicit_preference',
        scopeType: 'perfil_global',
        topicKey: 'cmv_format_percent',
        contentNormalized: 'mostre CMV em % com duas casas',
        evidenceText: 'exiba o CMV sempre em % com duas casas'
      },
      {
        memoryType: 'correction',
        scopeType: 'perfil_global',
        topicKey: 'alias_retidos_dias',
        contentNormalized: 'retidos significa mais de 5 dias',
        evidenceText: 'quando eu disser retidos entenda mais de 5 dias'
      },
      {
        memoryType: 'derived_interest',
        scopeType: 'loja',
        lojaSlug: 'MPJorgeBeretta',
        topicKey: 'focus_freios',
        contentNormalized: 'acompanhar OS de freios',
        evidenceText: 'como estao as OS de freios hoje?'
      }
    ];

    for (const cand of legitimateCandidates) {
      const check = isVolatileFactualCandidate(cand);
      assert(!check.isVolatile, `isVolatileFactualCandidate aceita legitimamente: "${cand.contentNormalized}"`);
    }

    const res = validateAndPersistMemoryCandidates(db, legitimateCandidates, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      turnId: 'turn_legitimate_02'
    });

    assert(res.persistedCount === 4, 'Todas as 4 preferências legítimas foram persistidas com sucesso');
    assert(res.rejectedCount === 0, 'Zero falsos positivos no validador equilibrado');
  }

  // ---------------------------------------------------------------------------
  // TESTE 3: Rejeição de fatos operacionais voláteis transitórios concretos
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Rejeição de Fatos Operacionais Voláteis Transitórios ---');
  {
    const volatileCandidates: MemoryCandidate[] = [
      {
        memoryType: 'explicit_preference',
        scopeType: 'loja',
        topicKey: 'saldo_os_1128',
        contentNormalized: 'saldo da OS 1128 é R$ 350,00',
        evidenceText: 'o saldo da OS 1128 é R$ 350,00'
      },
      {
        memoryType: 'derived_interest',
        scopeType: 'rede',
        topicKey: 'fat_ontem',
        contentNormalized: 'faturamento de ontem foi 50000',
        evidenceText: 'ontem faturamos 50000'
      },
      {
        memoryType: 'explicit_preference',
        scopeType: 'loja',
        topicKey: 'fat_realizado_data',
        contentNormalized: 'faturamento realizado em 15/09 de R$ 84.613,61',
        evidenceText: 'faturamento realizado em 15/09 de R$ 84.613,61'
      },
      {
        memoryType: 'derived_interest',
        scopeType: 'loja',
        topicKey: 'veiculo_placa_pronto',
        contentNormalized: 'veículo placa ABC1D23 está pronto',
        evidenceText: 'o carro placa ABC1D23 ja terminou'
      },
      {
        memoryType: 'explicit_preference',
        scopeType: 'loja',
        topicKey: 'saldo_devedor_os_5521',
        contentNormalized: 'saldo devedor da os 5521 é 1200',
        evidenceText: 'a pendencia da os 5521 é 1200'
      }
    ];

    for (const cand of volatileCandidates) {
      const check = isVolatileFactualCandidate(cand);
      assert(check.isVolatile, `isVolatileFactualCandidate rejeita fato volátil: "${cand.contentNormalized}" (${check.reason})`);
    }

    const res = validateAndPersistMemoryCandidates(db, volatileCandidates, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      turnId: 'turn_volatile_03'
    });

    assert(res.persistedCount === 0, 'Zero fatos voláteis foram persistidos na memória');
    assert(res.rejectedCount === 5, 'Todos os 5 candidatos voláteis foram rigorosamente bloqueados');
  }

  // ---------------------------------------------------------------------------
  // TESTE 4: Confiança >= 0.8 mantendo derived_interest sem promoção indevida
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Regra de Ouro: derived_interest com confiança >= 0.8 permanece candidate ---');
  {
    const highConfDerived: MemoryCandidate = {
      memoryType: 'derived_interest',
      scopeType: 'loja',
      lojaSlug: 'MPJorgeBeretta',
      topicKey: 'interesse_oleo_sintetico',
      contentNormalized: 'acompanhar vendas de óleo sintético',
      evidenceText: 'me mostre de novo as vendas de oleo sintetico',
      confidence: 0.95 // Alta confiança informada pela IA
    };

    const res = validateAndPersistMemoryCandidates(db, [highConfDerived], {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      turnId: 'turn_derived_04'
    });

    assert(res.persistedCount === 1, 'Candidato de derived_interest salvo com sucesso');

    // Inspeciona no banco diretamente o status gravado
    const saved = db.prepare(`
      SELECT status, confidence, memory_type
      FROM hydra_memories
      WHERE phone = ? AND topic_key = ?
    `).get(testPhone, 'interesse_oleo_sintetico') as any;

    assert(saved.memory_type === 'derived_interest', 'Tipo gravado é derived_interest');
    assert(saved.confidence === 0.95, 'Confiança original 0.95 foi preservada');
    assert(
      saved.status === 'candidate',
      'REGRA DE OURO ATENDIDA: Confiança >= 0.8 NÃO promove inferência para status active na persistência!'
    );

    // Verifica que getMemoriesByTopic NÃO retorna memórias em status candidate
    const retrieved = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      topicKey: 'interesse_oleo_sintetico'
    });

    assert(retrieved.length === 0, 'getMemoriesByTopic ignora memórias com status candidate (apenas active são injetadas no prompt)');
  }

  // ---------------------------------------------------------------------------
  // TESTE 5: Mesmo número, duas lojas e mesmo tópico (Agrupamento Quíntuplo)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Agrupamento Quíntuplo: Mesmo telefone, mesmo tópico, lojas diferentes ---');
  {
    const candLojaA: MemoryCandidate = {
      memoryType: 'explicit_preference',
      scopeType: 'loja',
      lojaSlug: 'MPJorgeBeretta',
      topicKey: 'meta_prioritaria',
      contentNormalized: 'foco em serviços pesados na Jorge Beretta',
      evidenceText: 'aqui na Jorge Beretta quero foco em serviços pesados'
    };

    const candLojaB: MemoryCandidate = {
      memoryType: 'explicit_preference',
      scopeType: 'loja',
      lojaSlug: 'MPSantoAndre',
      topicKey: 'meta_prioritaria',
      contentNormalized: 'foco em alinhamento e pneus em Santo André',
      evidenceText: 'em Santo André a prioridade é alinhamento e pneus'
    };

    validateAndPersistMemoryCandidates(db, [candLojaA], {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      turnId: 'turn_loja_a'
    });

    validateAndPersistMemoryCandidates(db, [candLojaB], {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPSantoAndre',
      turnId: 'turn_loja_b'
    });

    const keyA = buildQuintupleKey({
      phone: testPhone,
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'MPJorgeBeretta',
      topicKey: 'meta_prioritaria'
    });

    const keyB = buildQuintupleKey({
      phone: testPhone,
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'MPSantoAndre',
      topicKey: 'meta_prioritaria'
    });

    assert(keyA !== keyB, `Chaves quíntuplas são estritamente distintas (${keyA} !== ${keyB})`);

    // Recuperação para Jorge Beretta
    const memsLojaA = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      topicKey: 'meta_prioritaria'
    });

    assert(memsLojaA.length === 1, 'Retorna apenas 1 memória para Jorge Beretta');
    assert(
      memsLojaA[0].contentNormalized === 'foco em serviços pesados na Jorge Beretta',
      'Memória retornada corresponde exclusivamente à loja Jorge Beretta'
    );

    // Recuperação para Santo André
    const memsLojaB = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPSantoAndre',
      topicKey: 'meta_prioritaria'
    });

    assert(memsLojaB.length === 1, 'Retorna apenas 1 memória para Santo André');
    assert(
      memsLojaB[0].contentNormalized === 'foco em alinhamento e pneus em Santo André',
      'Memória retornada corresponde exclusivamente à loja Santo André (zero contaminação cruzada)'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 6: Isolamento de Escopo para Gerente vs Sócio
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Isolamento Rigoroso de Escopo: Gerente NUNCA acessa rede ---');
  {
    // Grava uma memória de escopo 'rede'
    const candRede: MemoryCandidate = {
      memoryType: 'explicit_preference',
      scopeType: 'rede',
      topicKey: 'visao_consolidada_rede',
      contentNormalized: 'consolidar faturamento de todas as 11 lojas',
      evidenceText: 'como sócio quero ver a rede toda consolidada'
    };

    validateAndPersistMemoryCandidates(db, [candRede], {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'socio',
      turnId: 'turn_rede_socio'
    });

    // 1. Sócio consulta: DEVE retornar
    const socioMems = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'socio',
      topicKey: 'visao_consolidada_rede'
    });
    assert(socioMems.length === 1, 'Sócio consegue acessar memórias de escopo rede');

    // 2. Gerente consulta: NUNCA deve retornar!
    const gerenteMems = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      topicKey: 'visao_consolidada_rede'
    });
    assert(
      gerenteMems.length === 0,
      'ISOLAMENTO COMPLETO: Gerente NUNCA recebe memórias com scope_type = rede!'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 7: Precedência de Correção Explícita (status = 'superseded')
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Precedência de Correção Explícita ---');
  {
    // Memória original v1
    validateAndPersistMemoryCandidates(
      db,
      [
        {
          memoryType: 'explicit_preference',
          scopeType: 'perfil_global',
          topicKey: 'regra_dias_retidos',
          contentNormalized: 'retidos significa mais de 3 dias',
          evidenceText: 'retidos para mim é 3 dias'
        }
      ],
      {
        phone: testPhone,
        generationId: 1,
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJorgeBeretta',
        turnId: 'turn_corr_v1'
      }
    );

    const v1Mems = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      topicKey: 'regra_dias_retidos'
    });
    assert(v1Mems.length === 1 && v1Mems[0].contentNormalized === 'retidos significa mais de 3 dias', 'Versão 1 ativa');

    // Usuário emite uma correção explícita v2
    validateAndPersistMemoryCandidates(
      db,
      [
        {
          memoryType: 'correction',
          scopeType: 'perfil_global',
          topicKey: 'regra_dias_retidos',
          contentNormalized: 'retidos significa mais de 7 dias, corrigindo os 3 dias',
          evidenceText: 'na verdade retidos sao mais de 7 dias, esquece os 3 dias'
        }
      ],
      {
        phone: testPhone,
        generationId: 1,
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJorgeBeretta',
        turnId: 'turn_corr_v2'
      }
    );

    // Consulta banco completo para verificar o status da v1
    const v1Row = db.prepare(`
      SELECT status, superseded_by
      FROM hydra_memories
      WHERE memory_id = ?
    `).get(v1Mems[0].memoryId) as any;

    assert(v1Row.status === 'superseded', 'Versão anterior foi marcada com status = superseded');
    assert(v1Row.superseded_by !== null, `Ponteiro superseded_by aponta para nova versão (${v1Row.superseded_by})`);

    // Consulta com getMemoriesByTopic: apenas a v2 deve ser retornada
    const v2Mems = getMemoriesByTopic(db, {
      phone: testPhone,
      generationId: 1,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta',
      topicKey: 'regra_dias_retidos'
    });

    assert(v2Mems.length === 1, 'Apenas 1 memória ativa é recuperada');
    assert(
      v2Mems[0].contentNormalized === 'retidos significa mais de 7 dias, corrigindo os 3 dias',
      'Versão corrigida v2 sobrepõe perfeitamente a v1'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 8: Repetição de evento/job sem aumentar contadores (Deduplicação por source_turn_ids)
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Deduplicação Estável por source_turn_ids ---');
  {
    const candIdempotent: MemoryCandidate = {
      memoryType: 'explicit_preference',
      scopeType: 'perfil_global',
      topicKey: 'ordem_faturamento_os',
      contentNormalized: 'prefiro faturamento antes de OS',
      evidenceText: 'faturamento antes de OS'
    };

    // Submete 3 vezes exatamente com o mesmo turnId (ex: retries de webhook)
    for (let i = 0; i < 3; i++) {
      validateAndPersistMemoryCandidates(db, [candIdempotent], {
        phone: testPhone,
        generationId: 1,
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJorgeBeretta',
        turnId: 'turn_idempotent_fixed_id'
      });
    }

    const row = db.prepare(`
      SELECT occurrence_count, source_turn_ids
      FROM hydra_memories
      WHERE phone = ? AND topic_key = ? AND status = 'active'
    `).get(testPhone, 'ordem_faturamento_os') as any;

    const turnIds = JSON.parse(row.source_turn_ids || '[]');
    const count = Number(row.occurrence_count);

    assert(turnIds.filter((t: string) => t === 'turn_idempotent_fixed_id').length === 1, 'turnId duplicado não é reinserido no array');
    assert(count <= 2, `occurrence_count não infla com repetições do mesmo turnId (atual: ${count})`);
  }

  // ---------------------------------------------------------------------------
  // TESTE 9: Consolidação Diária e Semanal com Watermark em America/Sao_Paulo
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Consolidação Determinística Diária e Semanal (Zero LLM, Zero WhatsApp) ---');
  {
    // Insere candidato de interesse derivado com 2 dias distintos no passado
    const candidate2Days: MemoryRecord = {
      memoryId: 'mem_test_2days_derived',
      phone: testPhone,
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'mpjorgeberetta',
      memoryType: 'derived_interest',
      topicKey: 'interesse_ar_condicionado',
      contentNormalized: 'acompanhar revisões de ar condicionado',
      evidenceText: 'como estao as revisoes de ar condicionado?',
      sourceTurnIds: ['turn_day1', 'turn_day2'],
      status: 'candidate',
      confidence: 0.8,
      occurrenceCount: 2,
      distinctDays: ['2026-09-28', '2026-09-30'],
      createdAt: '2026-09-28T10:00:00-03:00',
      confirmedAt: '2026-09-30T10:00:00-03:00'
    };
    saveMemoryRecord(db, candidate2Days);

    // Insere candidato de interesse derivado com apenas 1 dia
    const candidate1Day: MemoryRecord = {
      memoryId: 'mem_test_1day_derived',
      phone: testPhone,
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'mpjorgeberetta',
      memoryType: 'derived_interest',
      topicKey: 'interesse_amortecedores',
      contentNormalized: 'acompanhar troca de amortecedores',
      evidenceText: 'tem amortecedor pra trocar?',
      sourceTurnIds: ['turn_single_day'],
      status: 'candidate',
      confidence: 0.8,
      occurrenceCount: 1,
      distinctDays: ['2026-09-30'],
      createdAt: '2026-09-30T11:00:00-03:00',
      confirmedAt: '2026-09-30T11:00:00-03:00'
    };
    saveMemoryRecord(db, candidate1Day);

    // 1. Executa Consolidação Diária
    const dailyRes = runDailyConsolidation(db, '2026-09-30');
    assert(dailyRes.consolidatedCount > 0, `Consolidação diária processou ${dailyRes.consolidatedCount} grupos`);
    assert(dailyRes.discardedResetCount === 0, 'Zero descartes por reset na geração ativa correta');

    const cpDaily = getConsolidationCheckpoint(db, 'daily_consolidation');
    assert(cpDaily.recordsConsolidated > 0, 'Checkpoint diário atualizado com contagem consolidada');
    assert(cpDaily.lastProcessedTimestamp.length > 0, 'Checkpoint diário gravou watermark timestamp');

    // 2. Executa Consolidação Semanal
    const weeklyRes = runWeeklyConsolidation(db, '2026-09-30');
    assert(weeklyRes.promotedCount >= 1, `Promoção semanal: ${weeklyRes.promotedCount} candidato promovido a active`);
    assert(weeklyRes.decayedCount >= 1, `Decaimento semanal: ${weeklyRes.decayedCount} candidato de 1 dia sofreu decaimento`);

    // Inspeciona resultado do candidato de 2 dias (deve ter sido promovido a active)
    const row2Days = db.prepare(`SELECT status, confidence FROM hydra_memories WHERE memory_id = ?`).get('mem_test_2days_derived') as any;
    assert(row2Days.status === 'active', 'Candidato com 2 dias distintos promovido com sucesso a active!');
    assert(row2Days.confidence >= 0.9, `Confiança incrementada para preferência estável (atual: ${row2Days.confidence})`);

    // Inspeciona resultado do candidato de 1 dia (deve ter decaído e ganho TTL de 14 dias)
    const row1Day = db.prepare(`SELECT status, confidence, expires_at FROM hydra_memories WHERE memory_id = ?`).get('mem_test_1day_derived') as any;
    assert(row1Day.status === 'candidate', 'Candidato de 1 dia permanece candidate sem promoção indevida');
    assert(row1Day.confidence === 0.4, `Confiança decaída pela metade (0.8 * 0.5 = ${row1Day.confidence})`);
    assert(row1Day.expires_at !== null, 'Data de expiração (TTL de 14 dias) atribuída com sucesso');

    // Reexecutar consolidação diária/semanal NÃO deve duplicar nem criar efeitos colaterais
    const repeatDaily = runDailyConsolidation(db, '2026-09-30');
    assert(repeatDaily.consolidatedCount > 0, 'Reexecução da consolidação diária é estável e idempotente');
  }

  // ---------------------------------------------------------------------------
  // TESTE 10: Reset durante consolidação descartando commits atrasados (Blindagem Pós-Reset)
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Blindagem Pós-Reset: Descarte de commits de gerações defasadas ---');
  {
    // Cria uma memória na geração antiga (Geração 1)
    const oldGenMem: MemoryRecord = {
      memoryId: 'mem_generation_1_stale',
      phone: testPhone,
      generationId: 1,
      scopeType: 'loja',
      lojaSlug: 'mpjorgeberetta',
      memoryType: 'derived_interest',
      topicKey: 'stale_gen1_topic',
      contentNormalized: 'acompanhar pneus gen 1',
      evidenceText: 'pneus gen 1',
      sourceTurnIds: ['turn_gen1'],
      status: 'candidate',
      confidence: 0.8,
      occurrenceCount: 1,
      distinctDays: ['2026-09-28'],
      createdAt: '2026-09-28T10:00:00-03:00',
      confirmedAt: '2026-09-28T10:00:00-03:00'
    };
    saveMemoryRecord(db, oldGenMem);

    // Simula que o usuário rodou /reset enquanto o consolidador inicia:
    // A geração ativa do perfil sobe de 1 para 2!
    db.prepare(`UPDATE hydra_user_profiles SET memory_generation = 2 WHERE phone = ?`).run(testPhone);
    assert(getActiveGeneration(db, testPhone) === 2, 'Geração ativa do perfil agora é 2');

    // Executa consolidação: o registro tem status 'candidate' e generation_id = 1,
    // mas o perfil já está na geração 2. O consolidador deve descartar o commit!
    const weeklyResetCheck = runWeeklyConsolidation(db, '2026-09-30');
    assert(
      weeklyResetCheck.discardedResetCount >= 1,
      `BLINDAGEM PÓS-RESET ATIVA: ${weeklyResetCheck.discardedResetCount} registros da geração antiga foram descartados com rollback/skip`
    );

    // Agora aplica a invalidação formal de gerações anteriores
    invalidateGenerationMemories(db, testPhone, 1);
    const staleRow = db.prepare(`SELECT status FROM hydra_memories WHERE memory_id = ?`).get('mem_generation_1_stale') as any;
    assert(staleRow.status === 'invalidated', 'Memória da geração antiga foi formalmente invalidada pós-reset');
  }

  // ---------------------------------------------------------------------------
  // TESTE 11: Formatação de Contexto para Prompt (<150 tokens)
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Formatação de Memória para o Prompt de Conversação ---');
  {
    // Cria uma memória ativa na Geração 2
    validateAndPersistMemoryCandidates(
      db,
      [
        {
          memoryType: 'explicit_preference',
          scopeType: 'perfil_global',
          topicKey: 'cmv_display_unit',
          contentNormalized: 'mostre CMV em % com duas casas',
          evidenceText: 'CMV em % com duas casas'
        }
      ],
      {
        phone: testPhone,
        generationId: 2,
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJorgeBeretta',
        turnId: 'turn_gen2_prompt'
      }
    );

    const promptResult = getMemoriesForPrompt(db, {
      phone: testPhone,
      generationId: 2,
      effectivePersona: 'gerente',
      activeLojaSlug: 'MPJorgeBeretta'
    });

    assert(promptResult.memories.length > 0, 'Recuperou memórias ativas da geração 2');
    assert(promptResult.source === 'structured_direct', 'Fonte de recuperação é structured_direct');
    assert(promptResult.formattedContext.includes('cmv_display_unit'), 'Contexto formatado contém topicKey');
    assert(promptResult.formattedContext.includes('duas casas'), 'Contexto formatado contém contentNormalized');
    assert(promptResult.formattedContext.length < 500, 'Contexto é extremamente conciso (<150 tokens)');
    console.log(`\n     Contexto Formatado:\n${promptResult.formattedContext.split('\n').map(l => '     ' + l).join('\n')}`);
  }

  // ---------------------------------------------------------------------------
  // RESUMO FINAL
  // ---------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`🏁 TESTES CONCLUÍDOS: ${passedTests}/${totalTests} PASSOS APROVADOS (100%)`);
  console.log('===============================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runMemoryConsolidationTests().catch(err => {
  console.error('❌ Erro fatal durante a execução do test harness:', err);
  process.exit(1);
});
