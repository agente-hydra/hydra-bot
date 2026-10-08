/**
 * src/hydra-sync/tests/test_executor2_vault_memory.ts
 *
 * SU?TE DE TESTES DETERMIN?STICA - FRENTE 2 (hydra-obsidian-memory-audit)
 * Executor 2: Armazenamento Dur?vel Obsidian Vault por Identidade e Mem?ria SQLite
 *
 * Cen?rios Obrigat?rios Cobertos:
 * - M03: S?cio cria nota no vault, reinicia e recupera via syncVaultWithIndex
 * - M04: Gerente cria nota no vault restrita ? sua loja (tentativa de 'rede' ? rebaixada para 'loja')
 * - M05: Dois n?meros distintos com a mesma prefer?ncia (topic_key) n?o se misturam no vault
 * - M08: Corre??o na Loja A n?o invalida prefer?ncia na Loja B do mesmo operador
 * - M10: Reset durante escrita/consolida??o bloqueia commits da gera??o antiga
 * - M11: Recupera??o de nota ap?s grava??o do arquivo e antes do ?ndice SQLite (syncVaultWithIndex)
 * - M13: Nota Markdown externa com escopo 'rede' n?o amplia permiss?es para gerente
 * - M18: Valida??o de evid?ncia textual na mensagem do usu?rio (rejeita evid?ncias n?o ditas)
 * - Testes de Driver, Anti-Traversal, Two-Phase Write, Checkpoints Observ?veis (Zero LLM, Zero WhatsApp)
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { executeResetCommand, getUserProfile } from '../command_interceptor.js';
import {
  getVaultRoot,
  sanitizeCanonicalPhone,
  getUserVaultDir,
  computeSha256,
  validateFrontmatter,
  serializeFrontmatter,
  parseVaultNote,
  writeVaultNote,
  readVaultNote,
  initVaultIndexTable,
  syncVaultWithIndex,
  getVaultDiagnostics,
  createVaultNoteForPersona,
  queryVaultIndex,
  saveVaultNoteWithGenerationCheck,
  appendConversationToDailyDiary,
  getDailyDiaryContext,
  maskSensitiveData
} from '../vault_manager.js';
import type { VaultFrontmatter } from '../types/vault_contract.js';
import {
  initHydraAccessAndMemorySchema
} from '../db_repository.js';
import {
  validateAndPersistMemoryCandidates,
  getSaoPauloDate
} from '../memory_repository.js';
import {
  retrieveActiveMemoriesSync
} from '../memory_retriever.js';
import {
  runScheduledConsolidation,
  getConsolidationCheckpoint
} from '../memory_consolidator.js';

let passedTests = 0;
let totalTests = 0;

function check(condition: any, msg: string) {
  totalTests++;
  try {
    assert(Boolean(condition), msg);
    console.log(`  ? [PASS] ${msg}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ? [FAIL] ${msg}`);
    console.error(err);
    throw err;
  }
}

function registerUserInDb(db: Database.Database, phone: string, name = 'Test User', role = 'gerente') {
  initHydraAccessAndMemorySchema(db);
  db.prepare(`
    INSERT INTO hydra_authorized_users (phone, name, role, allowed_stores, is_active)
    VALUES (?, ?, ?, '["*"]', 1)
    ON CONFLICT(phone) DO NOTHING
  `).run(phone, name, role);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_user_profiles (
      phone TEXT PRIMARY KEY,
      persona TEXT NOT NULL DEFAULT 'gerente',
      loja_slug TEXT,
      loja_nome TEXT,
      default_scope TEXT NOT NULL DEFAULT 'loja',
      memory_generation INTEGER NOT NULL DEFAULT 1,
      daily_memory_reset_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      tool_used TEXT,
      tool_params TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(`
    INSERT INTO hydra_user_profiles (phone, persona, loja_slug, default_scope, memory_generation)
    VALUES (?, ?, 'MPJorgeBeretta', 'loja', 1)
    ON CONFLICT(phone) DO NOTHING
  `).run(phone, role);
}

async function runAllTests() {
  console.log('?? Iniciando SU?TE DE TESTES E2 ? Obsidian Vault, Armazenamento Dur?vel e Mem?ria SQLite\n');

  // Diret?rio tempor?rio e isolado para os testes do Vault
  const testVaultDir = path.resolve('.tmp', `test_vault_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  if (!fs.existsSync(testVaultDir)) {
    fs.mkdirSync(testVaultDir, { recursive: true });
  }

  try {
    // =========================================================================
    // BLOCO 1: DRIVER DO VAULT, SANITIZA??O, PATH TRAVERSAL E GRAVA??O TWO-PHASE
    // =========================================================================
    console.log('--- 1. Driver do Vault, Anti-Traversal e Grava??o Two-Phase ---');
    {
      // 1.1. Sanitiza??o can?nica
      const cleanPhone = sanitizeCanonicalPhone('+55 (11) 99999-0001');
      check(cleanPhone === '5511999990001', 'sanitizeCanonicalPhone extrai apenas d?gitos can?nicos');

      // 1.2. Bloqueio de Path Traversal
      let traversalBlocked = false;
      try {
        sanitizeCanonicalPhone('../../etc/passwd');
      } catch {
        traversalBlocked = true;
      }
      check(traversalBlocked, 'sanitizeCanonicalPhone bloqueia ../ path traversal no telefone');

      // 1.3. Cria??o de subdiret?rios padr?o
      const userDir = getUserVaultDir('5511999990001', testVaultDir);
      check(fs.existsSync(userDir), 'Diret?rio do usu?rio criado com sucesso');
      check(fs.existsSync(path.join(userDir, 'preferencias')), 'Subpasta preferencias criada automaticamente');
      check(fs.existsSync(path.join(userDir, 'correcoes')), 'Subpasta correcoes criada automaticamente');
      check(fs.existsSync(path.join(userDir, 'diario')), 'Subpasta diario criada automaticamente');

      // 1.4. Serializa??o e Parse de Frontmatter
      const sampleFm: VaultFrontmatter = {
        id: 'mem_test_unit_01',
        owner: '5511999990001',
        generation_id: 1,
        scope_type: 'loja',
        loja_slug: 'MPJorgeBeretta',
        topic_key: 'exibicao_cmv',
        memory_type: 'explicit_preference',
        status: 'active',
        version: 1,
        confidence: 0.95,
        evidence_text: 'mostrar CMV em porcentagem',
        source_turn_ids: ['turn_101', 'turn_102'],
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        expires_at: null,
        superseded_by: null
      };

      const serialized = serializeFrontmatter(sampleFm);
      check(serialized.startsWith('---\n') && serialized.endsWith('---'), 'Frontmatter delimitado estritamente por ---');

      const parsed = parseVaultNote(`${serialized}\n\nNota de corpo explicativa.`);
      check(parsed.frontmatter.id === 'mem_test_unit_01', 'Parser extrai id corretamente');
      check(parsed.frontmatter.confidence === 0.95, 'Parser preserva n?mero float confidence');
      check(parsed.frontmatter.source_turn_ids.length === 2, 'Parser preserva array de turnos');
      check(parsed.content === 'Nota de corpo explicativa.', 'Parser extrai corpo Markdown limpo');

      // 1.5. Grava??o Two-Phase (Atomic Rename)
      const written = writeVaultNote(
        '5511999990001',
        'preferencias/mem_test_unit_01.md',
        sampleFm,
        'Corpo da nota persistida.',
        testVaultDir
      );
      check(fs.existsSync(written.absolutePath), 'Arquivo final gravado com sucesso no destino');
      check(written.fileHash.length === 64, 'fileHash SHA-256 gerado com 64 caracteres');

      // L? a nota e valida hash
      const readBack = readVaultNote('5511999990001', 'preferencias/mem_test_unit_01.md', testVaultDir);
      check(readBack !== null, 'readVaultNote localizou a nota gravada');
      check(readBack?.fileHash === written.fileHash, 'Hash lido coincide perfeitamente com hash gravado');
    }

    // =========================================================================
    // BLOCO 2: CEN?RIO M03 ? S?CIO CRIA NOTA NO VAULT, REINICIA E RECUPERA
    // =========================================================================
    console.log('\n--- 2. Cen?rio M03: S?cio cria nota no vault, reinicia e recupera via syncVaultWithIndex ---');
    {
      const socioPhone = '5511999990003';
      const socioFm: VaultFrontmatter = {
        id: 'mem_socio_m03',
        owner: socioPhone,
        generation_id: 1,
        scope_type: 'rede',
        loja_slug: null,
        topic_key: 'ordem_faturamento_os',
        memory_type: 'explicit_preference',
        status: 'active',
        version: 1,
        confidence: 1.0,
        evidence_text: 'prefiro ver faturamento antes de OS nas respostas',
        source_turn_ids: ['turn_socio_01'],
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        expires_at: null,
        superseded_by: null
      };

      // S?cio grava nota no seu vault
      const note = writeVaultNote(
        socioPhone,
        'preferencias/mem_socio_m03.md',
        socioFm,
        '# Regra de Apresenta??o\nSempre iniciar relat?rios executivos pelo faturamento consolidado da rede.',
        testVaultDir
      );
      check(fs.existsSync(note.absolutePath), 'Nota do s?cio persistida fisicamente no vault em disco');

      // Simula rein?cio de banco/servi?o (novo SQLite zerado)
      const freshDb = new Database(':memory:');
      initHydraAccessAndMemorySchema(freshDb);
      initVaultIndexTable(freshDb);

      const beforeSyncCount = freshDb.prepare('SELECT count(*) as count FROM hydra_vault_index WHERE owner = ?').get(socioPhone) as any;
      check(beforeSyncCount.count === 0, 'SQLite antes da sincroniza??o est? limpo (zero registros)');

      // Executa syncVaultWithIndex
      const syncResult = syncVaultWithIndex(freshDb, socioPhone, testVaultDir);
      check(syncResult.reindexedCount === 1, 'syncVaultWithIndex reindexou a nota do s?cio (reindexedCount = 1)');
      check(syncResult.totalNotes === 1, 'Total de notas identificadas no disco = 1');

      // Consulta ?ndice reconstru?do
      const indexedRow = freshDb.prepare('SELECT * FROM hydra_vault_index WHERE owner = ?').get(socioPhone) as any;
      check(indexedRow.note_id === 'mem_socio_m03', 'Registro reconstru?do tem id correto');
      check(indexedRow.topic_key === 'ordem_faturamento_os', 'topic_key recuperado com integridade');
      check(indexedRow.file_hash === note.fileHash, 'SHA-256 do ?ndice ? id?ntico ao do arquivo em disco');

      // Idempot?ncia na segunda execu??o
      const secondSync = syncVaultWithIndex(freshDb, socioPhone, testVaultDir);
      check(secondSync.reindexedCount === 0 && secondSync.unchangedCount === 1, 'Re-sincroniza??o ? estritamente idempotente (unchangedCount = 1)');
    }

    // =========================================================================
    // BLOCO 3: CEN?RIO M04 ? GERENTE CRIA NOTA RESTRI??O DE LOJA (REBAIXA REDE)
    // =========================================================================
    console.log('\n--- 3. Cen?rio M04: Gerente cria nota no vault restrita ? sua loja ---');
    {
      const gerentePhone = '5511999990004';
      const lojaAtiva = 'MPJorgeBeretta';

      // Gerente tenta gravar uma nota com escopo 'rede'
      const noteGerente = createVaultNoteForPersona(
        gerentePhone,
        {
          frontmatter: {
            id: 'mem_gerente_m04',
            generation_id: 1,
            scope_type: 'rede', // Tentativa indevida de escopo rede
            loja_slug: null,
            topic_key: 'meta_vendas_pecas',
            memory_type: 'explicit_preference',
            status: 'active',
            version: 1,
            confidence: 1.0,
            evidence_text: 'focar em meta de vendas de pecas',
            source_turn_ids: ['turn_g01'],
            confirmed_at: new Date().toISOString(),
            expires_at: null,
            superseded_by: null
          },
          content: 'Meta de vendas de pe?as.',
          effectivePersona: 'gerente',
          activeLojaSlug: lojaAtiva
        },
        testVaultDir
      );

      check(noteGerente.frontmatter.scope_type === 'loja', 'M04: Tentativa de escopo rede pelo gerente foi rebaixada para loja');
      check(noteGerente.frontmatter.loja_slug === lojaAtiva, 'M04: Loja vinculada automaticamente ? loja ativa do gerente');

      // Valida que o arquivo em disco possui o escopo rebaixado
      const readOnDisk = readVaultNote(gerentePhone, noteGerente.relativePath, testVaultDir);
      check(readOnDisk?.frontmatter.scope_type === 'loja', 'M04: Arquivo no disco persistiu scope_type = loja');
      check(readOnDisk?.frontmatter.loja_slug === lojaAtiva, 'M04: Arquivo no disco persistiu loja_slug = MPJorgeBeretta');
    }

    // =========================================================================
    // BLOCO 4: CEN?RIO M05 ? DOIS N?MEROS DISTINTOS COM MESMO TOPIC_KEY
    // =========================================================================
    console.log('\n--- 4. Cen?rio M05: Dois n?meros distintos com a mesma prefer?ncia n?o se misturam ---');
    {
      const phoneA = '5511999990011';
      const phoneB = '5511999990022';
      const sharedTopic = 'formato_relatorio_diario';

      writeVaultNote(
        phoneA,
        'preferencias/formato.md',
        {
          id: 'mem_a_format',
          owner: phoneA,
          generation_id: 1,
          scope_type: 'perfil_global',
          loja_slug: null,
          topic_key: sharedTopic,
          memory_type: 'explicit_preference',
          status: 'active',
          version: 1,
          confidence: 1.0,
          evidence_text: 'quero tabela detalhada',
          source_turn_ids: ['turn_a1'],
          created_at: new Date().toISOString(),
          confirmed_at: null,
          expires_at: null,
          superseded_by: null
        },
        'Tabela detalhada com todas as colunas.',
        testVaultDir
      );

      writeVaultNote(
        phoneB,
        'preferencias/formato.md',
        {
          id: 'mem_b_format',
          owner: phoneB,
          generation_id: 1,
          scope_type: 'perfil_global',
          loja_slug: null,
          topic_key: sharedTopic,
          memory_type: 'explicit_preference',
          status: 'active',
          version: 1,
          confidence: 1.0,
          evidence_text: 'quero apenas resumo em texto',
          source_turn_ids: ['turn_b1'],
          created_at: new Date().toISOString(),
          confirmed_at: null,
          expires_at: null,
          superseded_by: null
        },
        'Apenas resumo curto de tr?s linhas.',
        testVaultDir
      );

      // Pastas f?sicas isoladas
      const dirA = path.join(testVaultDir, 'usuarios', phoneA, 'preferencias', 'formato.md');
      const dirB = path.join(testVaultDir, 'usuarios', phoneB, 'preferencias', 'formato.md');
      check(fs.existsSync(dirA) && fs.existsSync(dirB), 'Arquivos existem em diret?rios f?sicos completamente isolados');

      const memA = readVaultNote(phoneA, 'preferencias/formato.md', testVaultDir);
      const memB = readVaultNote(phoneB, 'preferencias/formato.md', testVaultDir);
      check(memA?.content.includes('Tabela detalhada'), 'Usu?rio A l? exclusivamente sua prefer?ncia de tabela');
      check(memB?.content.includes('Apenas resumo curto'), 'Usu?rio B l? exclusivamente sua prefer?ncia de resumo');

      const dbIsolation = new Database(':memory:');
      initHydraAccessAndMemorySchema(dbIsolation);
      syncVaultWithIndex(dbIsolation, phoneA, testVaultDir);
      syncVaultWithIndex(dbIsolation, phoneB, testVaultDir);

      const notesA = dbIsolation.prepare('SELECT note_id, owner FROM hydra_vault_index WHERE owner = ?').all(phoneA) as any[];
      const notesB = dbIsolation.prepare('SELECT note_id, owner FROM hydra_vault_index WHERE owner = ?').all(phoneB) as any[];

      check(notesA.length === 1 && notesA[0].note_id === 'mem_a_format', '?ndice de A cont?m apenas a nota de A');
      check(notesB.length === 1 && notesB[0].note_id === 'mem_b_format', '?ndice de B cont?m apenas a nota de B');
    }

    // =========================================================================
    // BLOCO 5: CEN?RIO M08 ? CORRE??O NA LOJA A N?O INVALIDA PREFER?NCIA NA LOJA B
    // =========================================================================
    console.log('\n--- 5. Cen?rio M08: Corre??o na Loja A n?o invalida prefer?ncia na Loja B ---');
    {
      const dbM08 = new Database(':memory:');
      const opPhone = '5511999990088';
      registerUserInDb(dbM08, opPhone, 'Operador Duas Lojas', 'gerente');

      // 1. Prefer?ncia na Loja A (MPJabaquara)
      validateAndPersistMemoryCandidates(
        dbM08,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'loja',
            lojaSlug: 'MPJabaquara',
            topicKey: 'meta_diaria_carros',
            contentNormalized: 'meta 10 carros em Jabaquara',
            evidenceText: 'nossa meta em Jabaquara ? 10 carros',
            confidence: 1.0
          }
        ],
        {
          phone: opPhone,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJabaquara',
          turnId: 'turn_m08_a1',
          rawUserMessage: 'nossa meta em Jabaquara ? 10 carros'
        }
      );

      // 2. Prefer?ncia na Loja B (MPdompedro1)
      validateAndPersistMemoryCandidates(
        dbM08,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'loja',
            lojaSlug: 'MPdompedro1',
            topicKey: 'meta_diaria_carros',
            contentNormalized: 'meta 15 carros em Dom Pedro',
            evidenceText: 'nossa meta em Dom Pedro ? 15 carros',
            confidence: 1.0
          }
        ],
        {
          phone: opPhone,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPdompedro1',
          turnId: 'turn_m08_b1',
          rawUserMessage: 'nossa meta em Dom Pedro ? 15 carros'
        }
      );

      // Ambas ativas
      const activePre = dbM08.prepare(`
        SELECT loja_slug, status FROM hydra_memories
        WHERE phone = ? AND topic_key = 'meta_diaria_carros' AND status = 'active'
      `).all(opPhone) as any[];
      check(activePre.length === 2, 'Ambas as lojas possuem prefer?ncias ativas inicialmente');

      // 3. Operador envia corre??o espec?fica para a Loja A (MPJabaquara)
      const corrResult = validateAndPersistMemoryCandidates(
        dbM08,
        [
          {
            memoryType: 'correction',
            scopeType: 'loja',
            lojaSlug: 'MPJabaquara',
            topicKey: 'meta_diaria_carros',
            contentNormalized: 'corrigido meta para 12 carros em Jabaquara',
            evidenceText: 'corrigindo meta de Jabaquara para 12 carros',
            confidence: 1.0
          }
        ],
        {
          phone: opPhone,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJabaquara',
          turnId: 'turn_m08_corr',
          rawUserMessage: 'corrigindo meta de Jabaquara para 12 carros'
        }
      );

      check(corrResult.persistedCount === 1, 'Corre??o de Jabaquara persistida com sucesso');

      // 4. Verifica??o estrita do isolamento qu?ntuplo
      const lojaARows = dbM08.prepare(`
        SELECT status, content_normalized FROM hydra_memories
        WHERE phone = ? AND LOWER(loja_slug) = 'mpjabaquara' AND topic_key = 'meta_diaria_carros'
        ORDER BY confirmed_at DESC
      `).all(opPhone) as any[];

      const lojaBRows = dbM08.prepare(`
        SELECT status, content_normalized FROM hydra_memories
        WHERE phone = ? AND LOWER(loja_slug) = 'mpdompedro1' AND topic_key = 'meta_diaria_carros'
      `).all(opPhone) as any[];

      check(lojaARows.some(r => r.status === 'superseded'), 'Loja A teve vers?o anterior marcada como superseded');
      check(lojaARows.some(r => r.status === 'active' && r.content_normalized.includes('12 carros')), 'Loja A possui nova corre??o ativa com 12 carros');

      check(lojaBRows.length === 1, 'Loja B continua com exatamente 1 registro');
      check(lojaBRows[0].status === 'active', 'Loja B PERMANECE ATIVA (zero contamina??o cruzada pela corre??o de Loja A)');
      check(lojaBRows[0].content_normalized.includes('15 carros'), 'Loja B manteve conte?do original de 15 carros');
    }

    // =========================================================================
    // BLOCO 6: CEN?RIO M10 ? RESET BLOQUEIA COMMITS DA GERA??O ANTIGA
    // =========================================================================
    console.log('\n--- 6. Cen?rio M10: Reset bloqueia commits e escrita da gera??o antiga ---');
    {
      const dbM10 = new Database(':memory:');
      const resetPhone = '5511999990100';
      registerUserInDb(dbM10, resetPhone, 'Gerente Reset', 'gerente');

      // Perfil do usu?rio com memory_generation = 2 p?s-reset
      dbM10.prepare(`
        UPDATE hydra_user_profiles SET memory_generation = 2 WHERE phone = ?
      `).run(resetPhone);

      // Tentativa de persistir candidato defasado da gera??o 1
      const staleCandidateRes = validateAndPersistMemoryCandidates(
        dbM10,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'loja',
            lojaSlug: 'MPJorgeBeretta',
            topicKey: 'resumo_ordens',
            contentNormalized: 'mostrar ordens em lista',
            evidenceText: 'mostrar ordens em lista',
            confidence: 1.0
          }
        ],
        {
          phone: resetPhone,
          generationId: 1, // Defasado! Perfil ativo est? na gera??o 2
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJorgeBeretta',
          turnId: 'turn_stale_01',
          rawUserMessage: 'mostrar ordens em lista'
        }
      );

      check(staleCandidateRes.persistedCount === 0, 'Commit de candidato da gera??o 1 bloqueado pelo validador p?s-reset');
      check(staleCandidateRes.rejectedCount === 1, 'Candidato da gera??o antiga formalmente rejeitado');

      // Tentativa de gravar nota no vault com gera??o defasada
      const staleVaultRes = saveVaultNoteWithGenerationCheck(
        dbM10,
        resetPhone,
        'preferencias/stale_note.md',
        {
          id: 'mem_stale_vault',
          owner: resetPhone,
          generation_id: 1, // Defasado!
          scope_type: 'loja',
          loja_slug: 'MPJorgeBeretta',
          topic_key: 'resumo_ordens',
          memory_type: 'explicit_preference',
          status: 'active',
          version: 1,
          confidence: 1.0,
          evidence_text: 'mostrar ordens em lista',
          source_turn_ids: ['turn_stale_01'],
          created_at: new Date().toISOString(),
          confirmed_at: null,
          expires_at: null,
          superseded_by: null
        },
        'Conte?do defasado.',
        testVaultDir
      );

      check(!staleVaultRes.saved, 'saveVaultNoteWithGenerationCheck recusou grava??o da nota defasada');
      check(staleVaultRes.discardedDueToReset, 'discardedDueToReset sinalizado como true');
    }

    // =========================================================================
    // BLOCO 7: CEN?RIO M11 ? RECUPERA??O DE NOTA AP?S GRAVA??O ANTES DO ?NDICE
    // =========================================================================
    console.log('\n--- 7. Cen?rio M11: Recupera??o de nota ap?s grava??o antes do ?ndice SQLite ---');
    {
      const dbM11 = new Database(':memory:');
      initHydraAccessAndMemorySchema(dbM11);
      initVaultIndexTable(dbM11);
      const phoneM11 = '5511999990111';

      // 1. Grava nota exclusivamente em disco (simula crash ou grava??o ass?ncrona antes do banco)
      const noteWritten = writeVaultNote(
        phoneM11,
        'preferencias/mem_recuperacao_m11.md',
        {
          id: 'mem_recuperacao_m11',
          owner: phoneM11,
          generation_id: 1,
          scope_type: 'perfil_global',
          loja_slug: null,
          topic_key: 'alerta_estoque_minimo',
          memory_type: 'explicit_preference',
          status: 'active',
          version: 1,
          confidence: 0.9,
          evidence_text: 'avise quando estoque for menor que 3',
          source_turn_ids: ['turn_m11_1'],
          created_at: new Date().toISOString(),
          confirmed_at: null,
          expires_at: null,
          superseded_by: null
        },
        '# Alerta de Estoque M?nimo\nDisparar aviso operacional quando o estoque de filtros cair abaixo de 3.',
        testVaultDir
      );

      check(fs.existsSync(noteWritten.absolutePath), 'Nota gravada no disco com sucesso');

      // Verifica que o banco ainda n?o sabe da exist?ncia da nota
      const countBefore = dbM11.prepare('SELECT count(*) as count FROM hydra_vault_index WHERE owner = ?').get(phoneM11) as any;
      check(countBefore.count === 0, '?ndice SQLite inicialmente n?o possui o registro');

      // 2. Executa syncVaultWithIndex para reconcilia??o
      const syncRes = syncVaultWithIndex(dbM11, phoneM11, testVaultDir);
      check(syncRes.reindexedCount === 1, 'syncVaultWithIndex descobriu e indexou o arquivo ?rf?o no SQLite');

      const countAfter = dbM11.prepare('SELECT count(*) as count FROM hydra_vault_index WHERE owner = ?').get(phoneM11) as any;
      check(countAfter.count === 1, '?ndice SQLite agora possui exatamente 1 registro recuperado');

      // 3. Simula dele??o do arquivo no disco e purga no banco
      fs.unlinkSync(noteWritten.absolutePath);
      const purgeSync = syncVaultWithIndex(dbM11, phoneM11, testVaultDir);
      check(purgeSync.purgedCount === 1, 'syncVaultWithIndex detectou aus?ncia do arquivo e expurgou o ?ndice SQLite');

      const countPurged = dbM11.prepare('SELECT count(*) as count FROM hydra_vault_index WHERE owner = ?').get(phoneM11) as any;
      check(countPurged.count === 0, '?ndice SQLite limpo ap?s purga (0 registros)');
    }

    // =========================================================================
    // BLOCO 8: CEN?RIO M13 ? NOTA EXTERNA COM ESCOPO 'REDE' N?O AMPLIA GERENTE
    // =========================================================================
    console.log('\n--- 8. Cen?rio M13: Nota externa com escopo rede n?o amplia permiss?es para gerente ---');
    {
      const dbM13 = new Database(':memory:');
      initHydraAccessAndMemorySchema(dbM13);
      initVaultIndexTable(dbM13);
      const phoneGerente = '5511999990133';

      // Algu?m coloca um arquivo Markdown diretamente no diret?rio do gerente com scope_type: 'rede'
      const noteDrop = writeVaultNote(
        phoneGerente,
        'preferencias/nota_externa_rede.md',
        {
          id: 'mem_externa_rede_m13',
          owner: phoneGerente,
          generation_id: 1,
          scope_type: 'rede', // Escopo de rede injetado externamente
          loja_slug: null,
          topic_key: 'politica_desconto_rede',
          memory_type: 'explicit_preference',
          status: 'active',
          version: 1,
          confidence: 1.0,
          evidence_text: 'desconto maximo de 20 por cento na rede',
          source_turn_ids: ['turn_drop_01'],
          created_at: new Date().toISOString(),
          confirmed_at: null,
          expires_at: null,
          superseded_by: null
        },
        'Regra de desconto de rede inserida manualmente.',
        testVaultDir
      );

      check(fs.existsSync(noteDrop.absolutePath), 'Nota externa inserida no disco');

      // Sincroniza com o ?ndice
      syncVaultWithIndex(dbM13, phoneGerente, testVaultDir);

      // Consulta como GERENTE
      const gerenteQuery = queryVaultIndex(dbM13, {
        owner: phoneGerente,
        generationId: 1,
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJorgeBeretta'
      });

      check(gerenteQuery.length === 0, 'M13: Gerente N?O recebe a nota de rede via queryVaultIndex (zero vazamento de permiss?o)');

      // Consulta como S?CIO
      const socioQuery = queryVaultIndex(dbM13, {
        owner: phoneGerente,
        generationId: 1,
        effectivePersona: 'socio'
      });

      check(socioQuery.length === 1, 'M13: S?cio possui permiss?o leg?tima para acessar escopo de rede');
    }

    // =========================================================================
    // BLOCO 9: CEN?RIO M18 ? VALIDA??O DE EVID?NCIA TEXTUAL NA MENSAGEM DO USU?RIO
    // =========================================================================
    console.log('\n--- 9. Cen?rio M18: Valida??o de evid?ncia textual na mensagem do usu?rio ---');
    {
      const dbM18 = new Database(':memory:');
      const testPhone18 = '5511999990188';
      registerUserInDb(dbM18, testPhone18, 'Gerente M18', 'gerente');

      // Caso 1: Usu?rio disse uma coisa, modelo inventou evid?ncia que n?o foi dita
      const hallucinatedEvidenceRes = validateAndPersistMemoryCandidates(
        dbM18,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'perfil_global',
            topicKey: 'preferencia_sobremesa',
            contentNormalized: 'gosta de sorvete',
            evidenceText: 'gosto de sorvete de baunilha', // NUNCA DITO PELO USU?RIO!
            confidence: 1.0
          }
        ],
        {
          phone: testPhone18,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJorgeBeretta',
          turnId: 'turn_m18_1',
          rawUserMessage: 'bom dia, qual ? o faturamento de hoje da loja?'
        }
      );

      check(hallucinatedEvidenceRes.persistedCount === 0, 'M18: Evid?ncia inventada n?o presente na mensagem do usu?rio foi rejeitada');
      check(hallucinatedEvidenceRes.rejectedCount === 1, 'M18: rejectedCount incrementado para evid?ncia alucinada');

      // Caso 2: Usu?rio efetivamente disse a frase da evid?ncia
      const legitimateEvidenceRes = validateAndPersistMemoryCandidates(
        dbM18,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'perfil_global',
            topicKey: 'faturamento_antes_os',
            contentNormalized: 'prefiro faturamento antes de OS',
            evidenceText: 'faturamento antes de OS', // Presente no texto!
            confidence: 1.0
          }
        ],
        {
          phone: testPhone18,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJorgeBeretta',
          turnId: 'turn_m18_2',
          rawUserMessage: 'prefiro ver faturamento antes de OS nas respostas por favor'
        }
      );

      check(legitimateEvidenceRes.persistedCount === 1, 'M18: Evid?ncia comprovadamente contida no rawUserMessage foi aceita e persistida');
      check(legitimateEvidenceRes.rejectedCount === 0, 'M18: Zero rejei??es para evid?ncia comprovada');

      // Caso 3: Evid?ncia vazia ou apenas espa?os
      const emptyEvidenceRes = validateAndPersistMemoryCandidates(
        dbM18,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'perfil_global',
            topicKey: 'teste_vazio',
            contentNormalized: 'conte?do v?lido',
            evidenceText: '   ', // Vazia!
            confidence: 1.0
          }
        ],
        {
          phone: testPhone18,
          generationId: 1,
          effectivePersona: 'gerente',
          turnId: 'turn_m18_3',
          rawUserMessage: 'conte?do v?lido'
        }
      );

      check(emptyEvidenceRes.persistedCount === 0 && emptyEvidenceRes.rejectedCount === 1, 'M18: Evid?ncia textual vazia ? sumariamente rejeitada');

      // Caso 4: Evid?ncia presente no hist?rico de conversation_messages quando rawUserMessage n?o ? passado
      dbM18.prepare(`
        INSERT INTO conversation_messages (phone, role, content)
        VALUES (?, 'user', ?)
      `).run(testPhone18, 'por favor quero que retidos signifique mais de 5 dias');

      const convHistoryEvidenceRes = validateAndPersistMemoryCandidates(
        dbM18,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'perfil_global',
            topicKey: 'alias_retidos_dias',
            contentNormalized: 'retidos significa mais de 5 dias',
            evidenceText: 'retidos signifique mais de 5 dias',
            confidence: 1.0
          }
        ],
        {
          phone: testPhone18,
          generationId: 1,
          effectivePersona: 'gerente',
          turnId: 'turn_m18_4'
        }
      );

      check(convHistoryEvidenceRes.persistedCount === 1, 'M18: Evid?ncia comprovada via hist?rico em conversation_messages aceita com sucesso');

      // Caso 5: Evid?ncia N?O presente em conversation_messages
      const convHistoryNotPresentRes = validateAndPersistMemoryCandidates(
        dbM18,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'perfil_global',
            topicKey: 'nao_dito',
            contentNormalized: 'n?o dito',
            evidenceText: 'viagem para o espa?o',
            confidence: 1.0
          }
        ],
        {
          phone: testPhone18,
          generationId: 1,
          effectivePersona: 'gerente',
          turnId: 'turn_m18_5'
        }
      );

      check(convHistoryNotPresentRes.persistedCount === 0 && convHistoryNotPresentRes.rejectedCount === 1, 'M18: Evid?ncia ausente no hist?rico de conversation_messages rejeitada');
    }

    // =========================================================================
    // BLOCO 10: AGENDAMENTO OBSERV?VEL DE CONSOLIDA??O (ZERO LLM, ZERO WHATSAPP)
    // =========================================================================
    console.log('\n--- 10. Agendamento Observ?vel de Consolida??o (Zero LLM, Zero WhatsApp) ---');
    {
      const dbCons = new Database(':memory:');
      initHydraAccessAndMemorySchema(dbCons);

      // Executa consolida??o di?ria agendada
      const schedDaily = runScheduledConsolidation(dbCons, 'daily');
      check(schedDaily.status === 'SUCCESS', 'runScheduledConsolidation daily executada com status SUCCESS');
      check(schedDaily.jobType === 'daily', 'jobType retornado ? daily');
      check(schedDaily.checkpoint.jobType === 'daily_consolidation', 'Checkpoint gravado em hydra_memory_consolidation_checkpoints');
      check(typeof schedDaily.checkpoint.updatedAt === 'string', 'Timestamp observ?vel updatedAt gravado no checkpoint');

      // Executa consolida??o semanal agendada
      const schedWeekly = runScheduledConsolidation(dbCons, 'weekly');
      check(schedWeekly.status === 'SUCCESS', 'runScheduledConsolidation weekly executada com status SUCCESS');
      check(schedWeekly.jobType === 'weekly', 'jobType retornado ? weekly');
      check(schedWeekly.checkpoint.jobType === 'weekly_consolidation', 'Checkpoint semanal gravado observavelmente');

      const cpDb = getConsolidationCheckpoint(dbCons, 'weekly_consolidation');
      check(cpDb.jobType === 'weekly_consolidation', 'Checkpoint lido diretamente do banco SQLite');
    }

    // =========================================================================
    // BLOCO 11: TELEMETRIA DE DIAGN?STICO DO VAULT
    // =========================================================================
    console.log('\n--- 11. Diagn?stico do Vault (getVaultDiagnostics) ---');
    {
      const dbDiag = new Database(':memory:');
      const diagPhone = '5511999990001';
      syncVaultWithIndex(dbDiag, diagPhone, testVaultDir);

      const diag = getVaultDiagnostics(dbDiag, diagPhone, 1, testVaultDir);
      check(diag.isVaultConfigured === true, 'isVaultConfigured reportado como true');
      check(diag.isAccessible === true, 'isAccessible reportado como true');
      check(diag.memoryGeneration === 1, 'memoryGeneration diagnosticado corretamente');
      check(diag.lastError === null, 'lastError ? null');
    }


    // =========================================================================
    // BLOCO 12: DI?RIO CONT?NUO NO OBSIDIAN VAULT & M?SCARA DE DADOS [E2-01..03]
    // =========================================================================
    console.log('\n--- 12. Di?rio Cont?nuo no Obsidian Vault & M?scara de Dados [E2-01..03] ---');
    {
      // 1. maskSensitiveData
      const sampleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const textWithSecrets = `Meu token ? ${sampleJwt} e Bearer secret_api_key_1234567890 e senha: minhasenha123456`;
      const masked = maskSensitiveData(textWithSecrets);
      check(!masked.includes(sampleJwt), 'maskSensitiveData mascarou o token JWT');
      check(!masked.includes('secret_api_key_1234567890'), 'maskSensitiveData mascarou o Bearer token');
      check(!masked.includes('minhasenha123456'), 'maskSensitiveData mascarou a senha');
      check(masked.includes('[DADO_PROTEGIDO]'), 'maskSensitiveData inseriu tag [DADO_PROTEGIDO]');

      // 2. appendConversationToDailyDiary
      const diaryPhone = '5511999990120';
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      appendConversationToDailyDiary(diaryPhone, `Pergunta com token: ${sampleJwt}`, 'Resposta da Hydra', {
        turnId: 'turn_d1',
        vaultRoot: testVaultDir,
        generationId: 1,
        storesReferenced: ['MPJabaquara'],
        scopeType: 'loja'
      });

      const diaryFilePath = path.join(testVaultDir, 'usuarios', diaryPhone, 'diario', `${todayStr}.md`);
      check(fs.existsSync(diaryFilePath), 'Arquivo de di?rio di?rio criado em usuarios/<phone>/diario/YYYY-MM-DD.md');

      const diaryContent = fs.readFileSync(diaryFilePath, 'utf8');
      check(diaryContent.includes('type: "episodic_daily_diary"'), 'Frontmatter cont?m type: "episodic_daily_diary"');
      check(diaryContent.includes(`owner: "${diaryPhone}"`), 'Frontmatter cont?m owner correto');
      check(diaryContent.includes('generation_id: 1'), 'Frontmatter cont?m generation_id');
      check(diaryContent.includes('version: 1'), 'Frontmatter cont?m version: 1');
      check(diaryContent.includes('MPJabaquara'), 'Frontmatter cont?m stores_referenced');
      check(diaryContent.includes('Turno #turn_d1'), 'Entrada cont?m cabe?alho do Turno');
      check(diaryContent.includes('[LOJA]'), 'Entrada cont?m tag de escopo [LOJA]');
      check(!diaryContent.includes(sampleJwt), 'Mensagem sens?vel no di?rio foi mascarada com sucesso');

      // 3. Idempot?ncia: retry do mesmo turnId n?o duplica
      const initialLength = diaryContent.length;
      appendConversationToDailyDiary(diaryPhone, 'Pergunta repetida', 'Resposta repetida', {
        turnId: 'turn_d1',
        vaultRoot: testVaultDir
      });
      const reloadedContent = fs.readFileSync(diaryFilePath, 'utf8');
      check(reloadedContent.length === initialLength, 'appendConversationToDailyDiary ? estritamente idempotente por turnId');

      // 4. Append subsequente adiciona novo turno sem sobrescrever
      appendConversationToDailyDiary(diaryPhone, 'Segundo turno', 'Segunda resposta', {
        turnId: 'turn_d2',
        vaultRoot: testVaultDir
      });
      const multiTurnContent = fs.readFileSync(diaryFilePath, 'utf8');
      check(multiTurnContent.includes('Turno #turn_d1'), 'Primeiro turno preservado no arquivo');
      check(multiTurnContent.includes('Turno #turn_d2'), 'Segundo turno anexado ao arquivo com sucesso');
    }

    // =========================================================================
    // BLOCO 13: RECUPERA??O CONTEXTUAL DE DI?RIO COM TETO ESTRITO [E2-04]
    // =========================================================================
    console.log('\n--- 13. Recupera??o Contextual de Di?rio com Teto Estrito [E2-04] ---');
    {
      const ragPhone = '5511999990130';
      const userDiarioDir = path.join(testVaultDir, 'usuarios', ragPhone, 'diario');
      fs.mkdirSync(userDiarioDir, { recursive: true });

      // Simula 3 dias de di?rios para validar pagina??o de 2 dias
      fs.writeFileSync(path.join(userDiarioDir, '2026-09-28.md'), `---
date: "2026-09-28"
owner: "${ragPhone}"
type: "episodic_daily_diary"
---
### [10:00:00] Turno #t1 [REDE]
- **Operador:** Dia velho
- **Hydra:** Resposta velha
`, 'utf8');

      fs.writeFileSync(path.join(userDiarioDir, '2026-09-29.md'), `---
date: "2026-09-29"
owner: "${ragPhone}"
type: "episodic_daily_diary"
---
### [10:00:00] Turno #t2 [REDE]
- **Operador:** Vis?o de rede sobre faturamento
- **Hydra:** Faturamento consolidado da rede
`, 'utf8');

      fs.writeFileSync(path.join(userDiarioDir, '2026-09-30.md'), `---
date: "2026-09-30"
owner: "${ragPhone}"
type: "episodic_daily_diary"
---
### [11:00:00] Turno #t3 [LOJA]
- **Operador:** Como est? a meta da loja jabaquara?
- **Hydra:** Loja: MPJabaquara faturamento R$ 10.000
`, 'utf8');

      // 1. S?cio acessa os 2 dias mais recentes (2026-09-30 e 2026-09-29), n?o o 3? dia (2026-09-28)
      const socioContext = getDailyDiaryContext(ragPhone, testVaultDir, 2000, {
        effectivePersona: 'socio'
      });
      check(socioContext.includes('2026-09-30.md'), 'Contexto inclui o dia mais recente');
      check(socioContext.includes('2026-09-29.md'), 'Contexto inclui o segundo dia mais recente');
      check(!socioContext.includes('2026-09-28.md'), 'Pagina??o limita hist?rico aos 2 dias mais recentes');
      check(socioContext.includes('Vis?o de rede'), 'S?cio tem acesso a turnos com escopo [REDE]');

      // 2. Gerente tem sess?es [REDE] expurgadas [E2-04]
      const gerenteContext = getDailyDiaryContext(ragPhone, testVaultDir, 2000, {
        effectivePersona: 'gerente',
        activeLojaSlug: 'MPJabaquara'
      });
      check(gerenteContext.includes('2026-09-30.md'), 'Gerente acessa turno da sua loja');
      check(!gerenteContext.includes('[REDE]'), 'Gerente N?O tem turnos [REDE] no contexto');
      check(!gerenteContext.includes('Faturamento consolidado da rede'), 'Conte?do de rede expurgado do contexto do gerente');

      // 3. Respeito ao teto de caracteres (maxChars)
      const cappedContext = getDailyDiaryContext(ragPhone, testVaultDir, 300);
      check(cappedContext.length <= 300, 'Contexto respeita estritamente o teto maxChars');

      // 4. Degrada??o graciosa
      const emptyContext = getDailyDiaryContext('5511000000000', testVaultDir);
      check(emptyContext === '', 'Recupera??o com usu?rio sem di?rio retorna string vazia');
    }

    // =========================================================================
    // BLOCO 14: UNIFICA??O DE PERSIST?NCIA VAULT & SQLITE [E2-05]
    // =========================================================================
    console.log('\n--- 14. Unifica??o de Persist?ncia Vault & SQLite [E2-05] ---');
    {
      const dbPersist = new Database(':memory:');
      const socioPhone = '5511999990141';
      const gerentePhone = '5511999990142';
      registerUserInDb(dbPersist, socioPhone, 'S?cio Unificado', 'socio');
      registerUserInDb(dbPersist, gerentePhone, 'Gerente Unificado', 'gerente');

      // 1. S?cio grava explicit_preference -> vai pro SQLite E pro Vault
      const socioCandidateRes = validateAndPersistMemoryCandidates(
        dbPersist,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'rede',
            topicKey: 'formato_faturamento_rede',
            contentNormalized: 'exibir ranking de lojas por CMV',
            evidenceText: 'exibir ranking de lojas por CMV',
            confidence: 1.0
          }
        ],
        {
          phone: socioPhone,
          generationId: 1,
          effectivePersona: 'socio',
          turnId: 'turn_socio_p1',
          rawUserMessage: 'exibir ranking de lojas por CMV',
          vaultRoot: testVaultDir
        }
      );
      check(socioCandidateRes.persistedCount === 1, 'S?cio: prefer?ncia persistida no SQLite');

      const socioVaultNotePath = path.join(testVaultDir, 'usuarios', socioPhone, 'preferencias', 'formato_faturamento_rede.md');
      check(fs.existsSync(socioVaultNotePath), 'S?cio: nota Markdown criada no Obsidian Vault em preferencias/');
      const socioNote = readVaultNote(socioPhone, 'preferencias/formato_faturamento_rede.md', testVaultDir);
      check(socioNote?.frontmatter.scope_type === 'rede', 'S?cio: nota no vault tem scope_type = rede');
      check(Boolean(socioNote?.content.includes('exibir ranking de lojas por CMV')), 'S?cio: conte?do correto na nota do vault');

      // 2. Gerente grava explicit_preference -> escopo rebaixado para loja, vai pro SQLite E pro Vault
      const gerenteCandidateRes = validateAndPersistMemoryCandidates(
        dbPersist,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'rede', // Gerente tentando rede -> deve ser normalizado para loja
            topicKey: 'ordem_veiculos_patio',
            contentNormalized: 'ordenar ve?culos por dias retidos decrescente',
            evidenceText: 'ordenar ve?culos por dias retidos decrescente',
            confidence: 1.0
          }
        ],
        {
          phone: gerentePhone,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJorgeBeretta',
          turnId: 'turn_gerente_p1',
          rawUserMessage: 'ordenar ve?culos por dias retidos decrescente',
          vaultRoot: testVaultDir
        }
      );
      check(gerenteCandidateRes.persistedCount === 1, 'Gerente: prefer?ncia persistida no SQLite');

      const gerenteVaultNotePath = path.join(testVaultDir, 'usuarios', gerentePhone, 'preferencias', 'ordem_veiculos_patio.md');
      check(fs.existsSync(gerenteVaultNotePath), 'Gerente: nota Markdown criada no Obsidian Vault em preferencias/');
      const gerenteNote = readVaultNote(gerentePhone, 'preferencias/ordem_veiculos_patio.md', testVaultDir);
      check(gerenteNote?.frontmatter.scope_type === 'loja', 'Gerente: scope_type foi normalizado para loja no Vault');
      check(gerenteNote?.frontmatter.loja_slug === 'MPJorgeBeretta', 'Gerente: loja_slug vinculada ? loja ativa do gerente no Vault');

      // 3. S?cio grava corre??o at?mica -> cria em correcoes/ no Vault e atualiza SQLite
      const corrCandidateRes = validateAndPersistMemoryCandidates(
        dbPersist,
        [
          {
            memoryType: 'correction',
            scopeType: 'rede',
            topicKey: 'formato_faturamento_rede',
            contentNormalized: 'exibir faturamento por valor total e n?o ranking',
            evidenceText: 'exibir faturamento por valor total e n?o ranking',
            confidence: 1.0
          }
        ],
        {
          phone: socioPhone,
          generationId: 1,
          effectivePersona: 'socio',
          turnId: 'turn_socio_corr1',
          rawUserMessage: 'exibir faturamento por valor total e n?o ranking',
          vaultRoot: testVaultDir
        }
      );
      check(corrCandidateRes.persistedCount === 1, 'Corre??o: persistida no SQLite');

      const corrVaultNotePath = path.join(testVaultDir, 'usuarios', socioPhone, 'correcoes', 'formato_faturamento_rede.md');
      check(fs.existsSync(corrVaultNotePath), 'Corre??o: nota Markdown criada em correcoes/ no Obsidian Vault');
      const corrNote = readVaultNote(socioPhone, 'correcoes/formato_faturamento_rede.md', testVaultDir);
      check(corrNote?.frontmatter.memory_type === 'correction', 'Corre??o: memory_type = correction no frontmatter');
    }

    // =========================================================================
    // BLOCO 15: INVALIDA??O DE GERA??O VIA /RESET SEM CORROMPER DISCO [E2-06]
    // =========================================================================
    console.log('\n--- 15. Invalida??o de Gera??o via /reset sem Corromper Disco [E2-06] ---');
    {
      const dbReset = new Database(':memory:');
      const resetUserPhone = '5511999990150';
      registerUserInDb(dbReset, resetUserPhone, 'Reset Test User', 'gerente');

      // 1. Cadastra prefer?ncia na gera??o 1
      validateAndPersistMemoryCandidates(
        dbReset,
        [
          {
            memoryType: 'explicit_preference',
            scopeType: 'loja',
            lojaSlug: 'MPJabaquara',
            topicKey: 'notificacoes_os',
            contentNormalized: 'avisar quando OS ultrapassar 15 dias',
            evidenceText: 'avisar quando OS ultrapassar 15 dias',
            confidence: 1.0
          }
        ],
        {
          phone: resetUserPhone,
          generationId: 1,
          effectivePersona: 'gerente',
          activeLojaSlug: 'MPJabaquara',
          turnId: 'turn_gen1_01',
          rawUserMessage: 'avisar quando OS ultrapassar 15 dias',
          vaultRoot: testVaultDir
        }
      );

      // Confirma que mem?ria est? ativa no SQLite na gera??o 1
      const preMems = dbReset.prepare(`
        SELECT status, generation_id FROM hydra_memories WHERE phone = ? AND topic_key = 'notificacoes_os'
      `).all(resetUserPhone);
      check(preMems.length === 1 && preMems[0].status === 'active' && preMems[0].generation_id === 1, 'Mem?ria da gera??o 1 ativa no SQLite');

      // Confirma que arquivo f?sico existe no Vault
      const vaultFile = path.join(testVaultDir, 'usuarios', resetUserPhone, 'preferencias', 'notificacoes_os.md');
      check(fs.existsSync(vaultFile), 'Arquivo Markdown da gera??o 1 existe fisicamente no Vault');

      // 2. Executa /reset atrav?s do comando
      const resetRes = await executeResetCommand(resetUserPhone, dbReset);
      check(resetRes.newGeneration === 2, '/reset incrementou memoryGeneration para 2');

      // 3. Mem?rias da gera??o 1 no SQLite foram marcadas como 'invalidated'
      const postMems = dbReset.prepare(`
        SELECT status, generation_id FROM hydra_memories WHERE phone = ? AND topic_key = 'notificacoes_os'
      `).all(resetUserPhone);
      check(postMems.length === 1 && postMems[0].status === 'invalidated', 'Mem?rias da gera??o anterior marcadas como "invalidated" no SQLite');

      // 4. Arquivo f?sico Markdown no Vault N?O foi corrompido nem apagado
      check(fs.existsSync(vaultFile), 'Arquivo f?sico no Vault permaneceu ?ntegro ap?s /reset');
      const noteContent = fs.readFileSync(vaultFile, 'utf8');
      check(noteContent.includes('avisar quando OS ultrapassar 15 dias'), 'Conte?do do arquivo no Vault n?o foi corrompido');

      // 5. Nova consulta na gera??o 2 n?o recupera nada
      const gen2Active = dbReset.prepare(`
        SELECT * FROM hydra_memories WHERE phone = ? AND generation_id = 2 AND status = 'active'
      `).all(resetUserPhone);
      check(gen2Active.length === 0, 'Gera??o 2 inicia com zero mem?rias ativas p?s-reset');
    }

    console.log('\n===============================================================');
    console.log(`?? SU?TE E2 CONCLU?DA: ${passedTests}/${totalTests} TESTES APROVADOS (100%)`);
    console.log('===============================================================\n');

  } finally {
    // Limpeza de arquivos tempor?rios do teste
    try {
      if (fs.existsSync(testVaultDir)) {
        fs.rmSync(testVaultDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

runAllTests().catch(err => {
  console.error('Falha cr?tica na su?te de testes:', err);
  process.exit(1);
});

