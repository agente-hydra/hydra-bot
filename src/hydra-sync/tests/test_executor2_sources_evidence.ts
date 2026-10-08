/**
 * Hydra — Suíte de Testes Isolada do Executor 2: Fontes, Dados e Evidências (Versão 2)
 * Spec: hydra-os-conversation-context
 * Responsabilidade: Executor 2 (Dados, Fontes, Repositório Real e Evidências)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 * Diretrizes: F01 (Desacoplamento e Repositório Real), F08 (Fim do descarte cego de Watchdog),
 * Modo Complementar (Zero side-effects) e os 5 Gates Adversariais da Auditoria.
 */

import Database from 'better-sqlite3';
import {
  ConversationSourceAdapter,
  ChatwootMessageRaw,
  EvolutionMessageRaw
} from '../conversation_source_adapter';
import { SummaryEvidenceAdapter } from '../summary_evidence_adapter';
import {
  RealAnalysisRepository,
  PhysicalDatabaseUnavailableError
} from '../real_analysis_repository';
import { OperationalDataRepository } from '../operational_data_repository';
import {
  SanitizedMessage,
  ConversationAnalysisRecord,
  ConversationSummaryRecord,
  ConversationGap,
  SecurityContext,
  CandidateOrder,
  SecurityAccessDeniedError
} from '../types/conversation_context_contract';
import {
  FIXTURE_OS_CATALOG,
  FIXTURE_SUMMARIES,
  FIXTURE_MESSAGES,
  FIXTURE_FIVE_GATES
} from '../fixtures/conversation_context_fixtures';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, testDesc: string): void {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${testId} — ${testDesc}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${testId} — ${testDesc}`);
  }
}

async function runExecutor2Tests(): Promise<void> {
  console.log('='.repeat(80));
  console.log('📦 EXECUTOR 2: SUÍTE DE TESTES DE DADOS, REPOSITÓRIO REAL, EVIDÊNCIAS E FONTES (VERSÃO 2)');
  console.log('='.repeat(80));

  const sourceAdapter = new ConversationSourceAdapter();
  const summaryAdapter = new SummaryEvidenceAdapter();

  // =========================================================================
  // SEÇÃO 1: LEITURA NÃO-INTRUSIVA NO MODO COMPLEMENTAR (ZERO SIDE-EFFECTS & CURSORES)
  // =========================================================================
  console.log('\n--- SEÇÃO 1: Leitura Não-Intrusiva no Modo Complementar (Zero Side-Effects) ---');
  {
    // Popula mensagens para conversa de teste 201
    const testMessages: SanitizedMessage[] = [
      {
        messageId: 1,
        conversationId: 201,
        senderType: 'contact',
        senderName: 'Cliente Teste',
        textContent: 'Olá, qual o valor da troca de óleo?',
        isPrivate: false,
        createdAt: '2026-10-05T08:00:00Z',
        hasAttachments: false
      },
      {
        messageId: 2,
        conversationId: 201,
        senderType: 'agent',
        senderName: 'Consultor Mário',
        textContent: 'Bom dia! Fica em R$ 350,00 com filtro.',
        isPrivate: false,
        createdAt: '2026-10-05T08:05:00Z',
        hasAttachments: false
      },
      {
        messageId: 3,
        conversationId: 201,
        senderType: 'contact',
        senderName: 'Cliente Teste',
        textContent: 'Perfeito, pode agendar para amanhã.',
        isPrivate: false,
        createdAt: '2026-10-05T08:10:00Z',
        hasAttachments: false
      },
      {
        messageId: 4,
        conversationId: 201,
        senderType: 'contact',
        senderName: 'Cliente Teste',
        textContent: 'Mensagem cancelada pelo remetente',
        isPrivate: false,
        isDeleted: true,
        createdAt: '2026-10-05T08:12:00Z',
        hasAttachments: false
      }
    ];

    sourceAdapter.seedMessages(201, testMessages);

    // EX2_T01: Leitura padrão não dispara chamadas de escrita
    const readResult1 = await sourceAdapter.fetchMessages({ conversationId: 201 });
    assert(
      sourceAdapter.getWriteEffectSideCount() === 0 && readResult1.length === 3,
      'EX2_T01_NON_INTRUSIVE_READ_ZERO_SIDE_EFFECTS',
      'Leitura de mensagens mantém getWriteEffectSideCount() estritamente em zero'
    );

    // EX2_T02: Leitura paginada com cursor sinceMessageId
    const readResultCursor = await sourceAdapter.fetchMessages({
      conversationId: 201,
      sinceMessageId: 1,
      limit: 1
    });
    assert(
      readResultCursor.length === 1 &&
      readResultCursor[0].messageId === 2 &&
      sourceAdapter.getWriteEffectSideCount() === 0,
      'EX2_T02_PAGINATED_READ_WITH_CURSOR',
      'Leitura paginada com cursor sinceMessageId retorna apenas mensagens posteriores mantendo zero side-effects'
    );

    // EX2_T03: Imutabilidade do store original (nenhuma flag de lida/modificada)
    const readResultAgain = await sourceAdapter.fetchMessages({ conversationId: 201 });
    assert(
      readResultAgain.every(m => m.updatedAt === undefined && !m.isDeleted) &&
      sourceAdapter.getWriteEffectSideCount() === 0,
      'EX2_T03_STORE_IMMUTABILITY_NO_READ_RECEIPT',
      'Nenhuma mensagem é modificada ou marcada como lida no store de origem'
    );

    // EX2_T04: Mensagens deletadas (isDeleted: true) são filtradas da leitura padrão
    const deletedFound = readResult1.some(m => m.messageId === 4 || m.isDeleted === true);
    assert(
      !deletedFound,
      'EX2_T04_DELETED_MESSAGES_PURGED_FROM_ACTIVE_STREAM',
      'Mensagens apagadas pelo remetente são suprimidas da listagem ativa de leitura'
    );
  }

  // =========================================================================
  // SEÇÃO 2: FILTRO ESTRITO DE NOTAS PRIVADAS (SEGURANÇA E PRIVACIDADE)
  // =========================================================================
  console.log('\n--- SEÇÃO 2: Filtro de Notas Privadas ---');
  {
    const internalNotesMessages: SanitizedMessage[] = [
      {
        messageId: 10,
        conversationId: 202,
        senderType: 'contact',
        senderName: 'Dono do Carro',
        textContent: 'Quanto fica o alinhamento?',
        isPrivate: false,
        createdAt: '2026-10-05T09:00:00Z',
        hasAttachments: false
      },
      {
        messageId: 11,
        conversationId: 202,
        senderType: 'agent',
        senderName: 'Atendente',
        textContent: 'Nota interna: cliente é frotista e pediu 10% de desconto adicional',
        isPrivate: true,
        createdAt: '2026-10-05T09:02:00Z',
        hasAttachments: false
      },
      {
        messageId: 12,
        conversationId: 202,
        senderType: 'agent',
        senderName: 'Atendente',
        textContent: 'Fica R$ 120,00 senhor!',
        isPrivate: false,
        createdAt: '2026-10-05T09:05:00Z',
        hasAttachments: false
      }
    ];

    sourceAdapter.seedMessages(202, internalNotesMessages);

    // EX2_T05: Sem flag includePrivateNotes (padrão seguro): nota privada é oculta
    const publicOnly = await sourceAdapter.fetchMessages({ conversationId: 202 });
    assert(
      publicOnly.length === 2 && !publicOnly.some(m => m.isPrivate),
      'EX2_T05_PRIVATE_NOTES_FILTERED_BY_DEFAULT',
      'Notas privadas internas (isPrivate: true) são ocultadas por padrão na consulta'
    );

    // EX2_T06: Com flag includePrivateNotes: true, notas privadas são acessíveis
    const withPrivate = await sourceAdapter.fetchMessages({
      conversationId: 202,
      includePrivateNotes: true
    });
    assert(
      withPrivate.length === 3 && withPrivate.some(m => m.isPrivate && m.messageId === 11),
      'EX2_T06_PRIVATE_NOTES_RETURNED_ONLY_WITH_PERMISSION',
      'Notas privadas só são retornadas sob autorização explícita (includePrivateNotes: true)'
    );

    // EX2_T07: Mapeamento de payload bruto do Chatwoot com private: true
    const rawChatwootPrivateNote: ChatwootMessageRaw = {
      id: 88,
      content: 'Atenção mecânicos: verificar vazamento no cárter',
      message_type: 1,
      private: true,
      created_at: 1728118800,
      sender: {
        id: 5,
        name: 'Supervisor Oficina',
        type: 'user'
      }
    };
    const adaptedPrivate = sourceAdapter.adaptChatwootMessage(rawChatwootPrivateNote, 202);
    assert(
      adaptedPrivate.isPrivate === true && adaptedPrivate.senderType === 'agent',
      'EX2_T07_CHATWOOT_RAW_PRIVATE_NOTE_ADAPTATION',
      'Payload bruto de nota privada do Chatwoot é preservado com isPrivate: true'
    );
  }

  // =========================================================================
  // SEÇÃO 3: MAPEAMENTO DE FONTES BRUTAS (CHATWOOT & EVOLUTION API)
  // =========================================================================
  console.log('\n--- SEÇÃO 3: Mapeamento de Fontes Brutas (Chatwoot & Evolution) ---');
  {
    // EX2_T08: Chatwoot Message com anexo de áudio
    const rawChatwootAudio: ChatwootMessageRaw = {
      id: 99,
      content: '',
      message_type: 0,
      private: false,
      created_at: '2026-10-05T09:15:00Z',
      sender: {
        id: 77,
        name: 'Cliente Áudio',
        type: 'contact'
      },
      attachments: [
        {
          file_type: 'audio/ogg',
          data_url: 'https://chatwoot.local/attachments/voice_note.ogg'
        }
      ]
    };
    const adaptedAudio = sourceAdapter.adaptChatwootMessage(rawChatwootAudio, 203);
    assert(
      adaptedAudio.hasAttachments === true &&
      adaptedAudio.attachmentType === 'audio' &&
      adaptedAudio.isTranscribed === false &&
      adaptedAudio.senderType === 'contact',
      'EX2_T08_CHATWOOT_AUDIO_ATTACHMENT_MAPPING',
      'ChatwootMessageRaw mapeia anexo de áudio e define isTranscribed: false para auditoria'
    );

    // EX2_T09: Evolution API WhatsApp Message
    const rawEvolutionMsg: EvolutionMessageRaw = {
      key: {
        id: 'EVO_MSG_123',
        fromMe: false,
        remoteJid: '5511999990001@s.whatsapp.net'
      },
      pushName: 'João Silva',
      message: {
        extendedTextMessage: {
          text: 'Pode confirmar se o carro fica pronto hoje?'
        }
      },
      messageTimestamp: 1728120000
    };
    const adaptedEvolution = sourceAdapter.adaptEvolutionMessage(rawEvolutionMsg, 203, 101);
    assert(
      adaptedEvolution.messageId === 101 &&
      adaptedEvolution.senderType === 'contact' &&
      adaptedEvolution.senderName === 'João Silva' &&
      adaptedEvolution.textContent === 'Pode confirmar se o carro fica pronto hoje?',
      'EX2_T09_EVOLUTION_API_WHATSAPP_MESSAGE_MAPPING',
      'EvolutionMessageRaw converte mensagem nativa de WhatsApp mantendo remetente e texto literal'
    );

    // EX2_T10: getLatestMessageId para detecção de defasagem (lag check)
    const latestId = await sourceAdapter.getLatestMessageId(202);
    assert(
      latestId === 12,
      'EX2_T10_GET_LATEST_MESSAGE_ID_RAPID_LAG_CHECK',
      'getLatestMessageId recupera o cursor mais recente da conversa com complexidade O(1)'
    );
  }

  // =========================================================================
  // SEÇÃO 4: DETECÇÃO DE LACUNAS DE MÍDIA (ÁUDIO, DOCUMENTOS, DELETADAS)
  // =========================================================================
  console.log('\n--- SEÇÃO 4: Detecção de Lacunas de Mídia e Cláusula Anti-Silêncio ---');
  {
    const messagesWithGaps: SanitizedMessage[] = [
      {
        messageId: 50,
        conversationId: 204,
        senderType: 'contact',
        senderName: 'Bruno Alencar',
        textContent: '[Áudio sem transcrição]',
        isPrivate: false,
        createdAt: '2026-10-04T16:35:00Z',
        hasAttachments: true,
        attachmentType: 'audio',
        isTranscribed: false
      },
      {
        messageId: 51,
        conversationId: 204,
        senderType: 'contact',
        senderName: 'Bruno Alencar',
        textContent: '',
        isPrivate: false,
        createdAt: '2026-10-04T16:36:00Z',
        hasAttachments: true,
        attachmentType: 'image'
      },
      {
        messageId: 52,
        conversationId: 204,
        senderType: 'contact',
        senderName: 'Bruno Alencar',
        textContent: 'Mensagem apagada',
        isPrivate: false,
        isDeleted: true,
        createdAt: '2026-10-04T16:37:00Z',
        hasAttachments: false
      }
    ];

    const detectedGaps = summaryAdapter.detectMediaGaps(messagesWithGaps);

    // EX2_T11: Áudio não transcrito gera ConversationGap explícito
    const audioGap = detectedGaps.find(g => g.gapType === 'UNTRANSCRIBED_AUDIO');
    assert(
      audioGap !== undefined && audioGap.messageId === 50,
      'EX2_T11_UNTRANSCRIBED_AUDIO_GENERATES_EXPLICIT_GAP',
      'Áudio recebido sem transcrição gera ConversationGap explícito com tipo UNTRANSCRIBED_AUDIO'
    );

    // EX2_T12: Cláusula Pétrea Anti-Silêncio: gap veda inferir consentimento tácito
    assert(
      audioGap !== undefined &&
      audioGap.description.includes('Proibido inferir silêncio ou concordância tácita'),
      'EX2_T12_ANTI_SILENCE_PETREOUS_CLAUSE_ENFORCEMENT',
      'Descrição do gap expressa veto obrigatório a interpretação de silêncio ou aceite tácito'
    );

    // EX2_T13: Imagem/documento não processado gera UNREAD_MEDIA
    const mediaGap = detectedGaps.find(g => g.gapType === 'UNREAD_MEDIA');
    assert(
      mediaGap !== undefined && mediaGap.messageId === 51,
      'EX2_T13_UNREAD_MEDIA_GAP_IDENTIFIED',
      'Imagem ou anexo sem conteúdo textual gera lacuna do tipo UNREAD_MEDIA'
    );

    // EX2_T14: Mensagem deletada gera DELETED_MESSAGE
    const delGap = detectedGaps.find(g => g.gapType === 'DELETED_MESSAGE');
    assert(
      delGap !== undefined && delGap.messageId === 52,
      'EX2_T14_DELETED_MESSAGE_GAP_IDENTIFIED',
      'Mensagem excluída no WhatsApp gera lacuna do tipo DELETED_MESSAGE para auditoria'
    );

    // EX2_T15: Fixture T50 (OS 512, Conv 112) com áudio real do Bruno Alencar
    const fixture112Messages = FIXTURE_MESSAGES[112];
    const fixtureGaps = summaryAdapter.detectMediaGaps(fixture112Messages);
    assert(
      fixtureGaps.length === 1 &&
      fixtureGaps[0].gapType === 'UNTRANSCRIBED_AUDIO' &&
      fixtureGaps[0].messageId === 450,
      'EX2_T15_FIXTURE_T50_REAL_AUDIO_GAP_VERIFICATION',
      'Fixture controlada T50 (OS 512, Conv 112) tem áudio pendente identificado como lacuna factual'
    );
  }

  // =========================================================================
  // SEÇÃO 5: FIM DO DESCARTE CEGO (F08 & VERSÃO 2) E AVALIAÇÃO DE RESUMOS
  // =========================================================================
  console.log('\n--- SEÇÃO 5: Fim do Descarte Cego (F08) e Avaliação de Resumos ---');
  {
    // EX2_T16: Resumo WATCHDOG_EVAL com apenas alerta de conduta é REJEITADO como situação de OS
    const watchdogSummary = FIXTURE_SUMMARIES[107]; // Fixture T45 (OS 507)
    const evalWatchdog = summaryAdapter.evaluateSummaryReliability(watchdogSummary);

    assert(
      evalWatchdog.canUseAsBase === false,
      'EX2_T16_WATCHDOG_ISOLATED_FLAG_REJECTED_AS_MECHANICAL_OS_SUMMARY',
      'Alerta isolado de conduta no Watchdog (sem dados operacionais) não serve como resumo de OS'
    );

    // EX2_T17: Resumo WATCHDOG_EVAL isolado é classificado com isWatchdogInfractionOnly: true
    assert(
      evalWatchdog.isWatchdogInfractionOnly === true &&
      evalWatchdog.reason !== undefined &&
      evalWatchdog.reason.includes('Watchdog'),
      'EX2_T17_WATCHDOG_ISOLATED_FLAGGED_AS_INFRACTION_ONLY',
      'Watchdog isolado é marcado expressamente como infração de conduta'
    );

    // EX2_T18: F08 & VERSÃO 2: Análise WATCHDOG_EVAL com afirmações operacionais sustentadas é APROVEITADA
    const watchdogWithOps = FIXTURE_SUMMARIES[120]; // Fixture T45 Versão 2 (OS 520)
    const evalWatchdogWithOps = summaryAdapter.evaluateSummaryReliability(watchdogWithOps);
    const operationalStmts = summaryAdapter.extractOperationalStatements(watchdogWithOps);

    assert(
      evalWatchdogWithOps.canUseAsBase === true &&
      evalWatchdogWithOps.isWatchdogInfractionOnly === false &&
      operationalStmts.length === 1 &&
      operationalStmts[0].subject === 'CLIENT_APPROVAL' &&
      operationalStmts[0].polarity === 'AFFIRMATIVE' &&
      operationalStmts[0].rawExcerpt.includes('orçamento de R$ 2.100 aprovado'),
      'EX2_T18_WATCHDOG_WITH_OPERATIONAL_FACTS_UTILIZED_F08',
      'Diretriz F08: Fim do descarte cego por rótulo; afirmação operacional com evidência é APROVEITADA'
    );

    // EX2_T19: Resumo de Síntese Operacional padrão válido (Fixture T41, OS 501)
    const operationalSummary = FIXTURE_SUMMARIES[101];
    const evalOperational = summaryAdapter.evaluateSummaryReliability(operationalSummary);

    assert(
      evalOperational.canUseAsBase === true &&
      evalOperational.isWatchdogInfractionOnly === false,
      'EX2_T19_OPERATIONAL_SYNTHESIS_ACCEPTED_AS_VALID_BASE',
      'OPERATIONAL_SYNTHESIS com afirmações e cobertura válida é plenamente aprovado para reuso'
    );

    // EX2_T20: Resumo vazio (sem statements e sem gaps) é rejeitado
    const emptySummary: ConversationAnalysisRecord = {
      analysisId: 'sum_empty',
      summaryId: 'sum_empty',
      conversationId: 999,
      lojaSlug: 'sorocaba',
      coveredOsIds: [999],
      sourceType: 'OPERATIONAL_SYNTHESIS',
      analyzedUntilMessageId: 0,
      cursorLastMessageId: 0,
      analyzedUntilTimestamp: '2026-10-05T00:00:00Z',
      messagesCoveredUntil: '2026-10-05T00:00:00Z',
      generatedAt: '2026-10-05T00:00:00Z',
      analysisVersion: 'v1.0.0',
      statements: [],
      gaps: [],
      isValid: true
    };
    const evalEmpty = summaryAdapter.evaluateSummaryReliability(emptySummary);
    assert(
      evalEmpty.canUseAsBase === false &&
      Boolean(evalEmpty.reason?.includes('sem afirmações estruturadas')),
      'EX2_T20_EMPTY_SUMMARY_REJECTED_FOR_LACK_OF_COVERAGE',
      'Resumo sem afirmações estruturadas ou metadados de cobertura é recusado'
    );

    // EX2_T21: Resumo com isValid: false é rejeitado pelo repositório
    summaryAdapter.registerSummary({
      ...operationalSummary,
      conversationId: 888,
      isValid: false
    });
    const retrievedInvalid = summaryAdapter.getSummaryForConversation(888);
    assert(
      retrievedInvalid === null,
      'EX2_T21_INVALID_FLAGGED_SUMMARY_REJECTED_BY_STORE',
      'Resumo marcado como isValid: false não é retornado pelo repositório de evidências'
    );
  }

  // =========================================================================
  // SEÇÃO 6: REPOSITÓRIO REAL DE ANÁLISES (F01: DESACOPLAMENTO E BASE FÍSICA SQLITE)
  // =========================================================================
  console.log('\n--- SEÇÃO 6: Repositório Real de Análises (F01: Desacoplamento e SQLite) ---');
  {
    // EX2_T22: Repositório não configurado retorna indisponibilidade explícita (sem mock silencioso)
    const unconfiguredRepo = new RealAnalysisRepository();
    const status = unconfiguredRepo.checkAvailability();
    assert(
      unconfiguredRepo.isAvailable() === false &&
      status.status === 'UNCONFIGURED' &&
      status.reason !== undefined &&
      status.reason.includes('F01'),
      'EX2_T22_REAL_REPO_UNCONFIGURED_RETURNS_EXPLICIT_UNAVAILABLE',
      'F01: Repositório sem base física declara indisponibilidade explícita e NUNCA injeta mocks silenciosos'
    );

    // EX2_T23: Chamada de leitura em repositório não configurado lança PhysicalDatabaseUnavailableError
    let threwPhysicalError = false;
    try {
      await unconfiguredRepo.getAnalysisByConversation(101, 'sorocaba');
    } catch (err) {
      if (err instanceof PhysicalDatabaseUnavailableError) {
        threwPhysicalError = true;
      }
    }
    assert(
      threwPhysicalError,
      'EX2_T23_REAL_REPO_UNCONFIGURED_THROWS_PHYSICAL_ERROR',
      'F01: getAnalysisByConversation sem base física lança erro explícito em vez de fallback silencioso'
    );

    // EX2_T24: Repositório configurado com base SQLite real
    const sqliteDb = new Database(':memory:');
    const realRepo = new RealAnalysisRepository({ db: sqliteDb });
    assert(
      realRepo.isAvailable() === true && realRepo.checkAvailability().status === 'AVAILABLE',
      'EX2_T24_REAL_REPO_CONFIGURED_WITH_SQLITE_IS_AVAILABLE',
      'Repositório instanciado com SQLite cria schema e reporta disponibilidade real'
    );

    // EX2_T25: Persistência real de análise e consulta por conversa e por OS
    const analysisToSave = FIXTURE_SUMMARIES[101];
    await realRepo.saveAnalysis(analysisToSave);

    const fetchedByConv = await realRepo.getAnalysisByConversation(101, 'sorocaba');
    assert(
      fetchedByConv !== null &&
      fetchedByConv.analysisId === 'sum_501' &&
      fetchedByConv.analyzedUntilMessageId === 100 &&
      Boolean(fetchedByConv.statements && fetchedByConv.statements.length === 2) &&
      Boolean(fetchedByConv.statements && fetchedByConv.statements[0].rawExcerpt.includes('trocar os amortecedores')),
      'EX2_T25_REAL_REPO_SAVE_AND_FETCH_BY_CONVERSATION',
      'Persistência e recuperação de análise via SQLite real preserva declarações e metadados'
    );

    const fetchedByOS = await realRepo.getAnalysisByOS(501, 'sorocaba');
    assert(
      fetchedByOS !== null &&
      fetchedByOS.analysisId === 'sum_501' &&
      Boolean(fetchedByOS.coveredOsIds && fetchedByOS.coveredOsIds.includes(501)),
      'EX2_T26_REAL_REPO_FETCH_BY_OS',
      'getAnalysisByOS localiza a análise a partir da OS mapeada nos coveredOsIds'
    );

    // EX2_T27: Listagem de análises por loja
    const storeAnalyses = await realRepo.listAnalysesByStore('sorocaba');
    assert(
      storeAnalyses.length === 1 && storeAnalyses[0].lojaSlug === 'sorocaba',
      'EX2_T27_REAL_REPO_LIST_BY_STORE',
      'listAnalysesByStore retorna todas as análises válidas da loja consultada'
    );

    // EX2_T28: Avaliação de evidência e F08 no Repositório Real
    await realRepo.saveAnalysis(FIXTURE_SUMMARIES[120]); // Watchdog com dados operacionais
    const watchdogFromDb = await realRepo.getAnalysisByOS(520, 'sorocaba');
    assert(watchdogFromDb !== null, 'EX2_T28_PRE_CHECK_WATCHDOG_SAVED', 'Registro de OS 520 recuperado do SQLite');

    if (watchdogFromDb) {
      const evalFromDb = realRepo.evaluateAnalysisEvidence(watchdogFromDb);
      assert(
        evalFromDb.canUseAsBase === true &&
        evalFromDb.isWatchdogInfractionOnly === false &&
        evalFromDb.usableStatements.length === 1 &&
        evalFromDb.usableStatements[0].subject === 'CLIENT_APPROVAL',
        'EX2_T28_REAL_REPO_F08_EVALUATION',
        'Repositório Real avalia evidência e aproveita fatos operacionais de WATCHDOG_EVAL (F08)'
      );
    }
  }

  // =========================================================================
  // SEÇÃO 7: COBERTURA, CURSORES E INTEGRIDADE DAS FIXTURES T41-T54
  // =========================================================================
  console.log('\n--- SEÇÃO 7: Schemas, Marcadores de Cobertura e Fixtures T41-T54 ---');
  {
    // EX2_T29: Validação de Schema de Resumos Operacionais
    const schemaCheckValid = summaryAdapter.validateSummarySchema(FIXTURE_SUMMARIES[101]);
    assert(
      schemaCheckValid.isValid === true && schemaCheckValid.errors.length === 0,
      'EX2_T29_SUMMARY_SCHEMA_VALIDATION_STRICT',
      'Resumo operacional cumpre estritamente todos os campos obrigatórios do schema'
    );

    // EX2_T30: Verificação de Cobertura e Detecção de Cursor Defasado (Lagging count)
    const coverageLagging = summaryAdapter.checkCoverage(FIXTURE_SUMMARIES[106], 205);
    assert(
      coverageLagging.isFullyCovered === false &&
      coverageLagging.laggingMessageCount === 5 &&
      coverageLagging.cursorLastMessageId === 200,
      'EX2_T30_SUMMARY_COVERAGE_MARKER_DETECTS_LAG',
      'Marcador de cobertura detecta mensagens posteriores ao cursor apontando necessidade de leitura incremental'
    );

    const coverageUpToDate = summaryAdapter.checkCoverage(FIXTURE_SUMMARIES[101], 100);
    assert(
      coverageUpToDate.isFullyCovered === true &&
      coverageUpToDate.laggingMessageCount === 0,
      'EX2_T31_SUMMARY_COVERAGE_MARKER_CONFIRMS_FRESHNESS',
      'Marcador de cobertura atesta frescor quando cursor iguala ou supera mensagem mais recente'
    );

    // EX2_T32: Catálogo Completo de Fixtures T41 a T54
    const requiredOSIds = [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 514, 516, 517, 518, 519, 520];
    const allOSsPresent = requiredOSIds.every(id => FIXTURE_OS_CATALOG[id] !== undefined);
    assert(
      allOSsPresent,
      'EX2_T32_FIXTURES_CATALOG_COMPLETENESS_T41_T54_V2',
      'Catálogo de fixtures cobre todos os cenários T41-T54 e extensões da Versão 2'
    );
  }

  // =========================================================================
  // SEÇÃO 8: VALIDAÇÃO DOS 5 GATES ADVERSARIAIS DA AUDITORIA
  // =========================================================================
  console.log('\n--- SEÇÃO 8: Validação dos 5 Gates Adversariais da Auditoria ---');
  {
    // EX2_T33: Gate 1 — Negações ("Não autorizo", "Ainda não fiz o Pix")
    const g1 = FIXTURE_FIVE_GATES.gate1_negation;
    const summary116 = FIXTURE_SUMMARIES[g1.conversationId];
    assert(
      summary116 !== undefined &&
      Boolean(summary116.statements) &&
      summary116.statements!.every(s => s.polarity === 'NEGATIVE') &&
      summary116.statements!.some(s => s.subject === 'CLIENT_REFUSAL') &&
      summary116.statements!.some(s => s.subject === 'PAYMENT_REFUSAL') &&
      !summary116.statements!.some(s => s.subject === 'CLIENT_APPROVAL' || s.subject === 'PAYMENT_CLAIM'),
      'EX2_T33_GATE1_NEGATION_STRUCTURE_COMPLIANCE',
      'Gate 1 (Auditoria): Negações explícitas registradas com polaridade NEGATIVE, jamais aprovação'
    );

    // EX2_T34: Gate 2 — Ausência de vínculo comprovado
    const g2 = FIXTURE_FIVE_GATES.gate2_missing_link_evidence;
    const os517 = FIXTURE_OS_CATALOG[g2.osId];
    const msgs117 = FIXTURE_MESSAGES[g2.conversationId];
    assert(
      os517 !== undefined &&
      msgs117.length > 0 &&
      !msgs117[0].textContent.includes(os517.vehiclePlate) &&
      !msgs117[0].textContent.includes(String(os517.osId)) &&
      g2.approvalAttributed === false,
      'EX2_T34_GATE2_MISSING_LINK_EVIDENCE_COMPLIANCE',
      'Gate 2 (Auditoria): Conversa sem identificadores de vínculo tem approvalAttributed = false'
    );

    // EX2_T35: Gate 3 — Candidatos cross-store
    const g3 = FIXTURE_FIVE_GATES.gate3_cross_store_candidates;
    const osAuth = FIXTURE_OS_CATALOG[g3.authorizedOsId];
    const osForeign = FIXTURE_OS_CATALOG[g3.forbiddenCrossStoreOsId];
    assert(
      osAuth.lojaSlug === g3.primaryStore &&
      osForeign.lojaSlug === g3.foreignStore &&
      osAuth.customerPhone === osForeign.customerPhone,
      'EX2_T35_GATE3_CROSS_STORE_CANDIDATES_COMPLIANCE',
      'Gate 3 (Auditoria): Mesmo contato em duas lojas com segregação de OS e placa'
    );

    // EX2_T36: Gate 4 — Edição de mensagem de mesmo ID / Atualização de versão
    const g4 = FIXTURE_FIVE_GATES.gate4_edited_message_same_id;
    assert(
      g4.messageId === 600 &&
      g4.version1.polarity === 'AFFIRMATIVE' &&
      g4.version2.polarity === 'NEGATIVE' &&
      (g4.version1.analysisVersion as string) !== (g4.version2.analysisVersion as string),
      'EX2_T36_GATE4_EDITED_MESSAGE_SAME_ID_COMPLIANCE',
      'Gate 4 (Auditoria): Edição da mensagem 600 altera polaridade para NEGATIVE e atualiza versão da análise'
    );

    // EX2_T37: Gate 5 — Histórico longo e lacuna de truncamento
    const g5 = FIXTURE_FIVE_GATES.gate5_history_truncation;
    const msgs119 = FIXTURE_MESSAGES[g5.conversationId];
    const summary119 = FIXTURE_SUMMARIES[g5.conversationId];
    const truncGap = summary119?.gaps ? summary119.gaps.find(g => g.gapType === 'TRUNCATED_HISTORY') : undefined;
    assert(
      msgs119.length === 25 &&
      msgs119.length > g5.maxBudgetLimit &&
      truncGap !== undefined &&
      truncGap.description.includes('20 mensagens'),
      'EX2_T37_GATE5_HISTORY_TRUNCATION_COMPLIANCE',
      'Gate 5 (Auditoria): Histórico com 25 mensagens gera lacuna TRUNCATED_HISTORY no modo complementar'
    );
  }

  // =========================================================================
  // SEÇÃO 9: VALIDAÇÃO ESTRITA DE VÍNCULO (AJUSTE 2 DA REVISÃO v2.1)
  // =========================================================================
  console.log('\n--- SEÇÃO 9: Validação Estrita de Vínculo (Revisão v2.1) ---');
  {
    // EX2_T38: Ter conversationId não basta — divergência de loja rejeita vínculo e gera lacuna NOT_IN_ANALYSIS
    const analysisSorocaba = FIXTURE_SUMMARIES[101]; // loja: sorocaba, covered: [501]
    const orderCampinas = { osId: 501, lojaSlug: 'campinas' };
    const valStoreMismatch = summaryAdapter.validateStrictOrderLink(analysisSorocaba, orderCampinas);
    assert(
      valStoreMismatch.isValidLink === false &&
      valStoreMismatch.gap !== undefined &&
      valStoreMismatch.gap.gapType === 'NOT_IN_ANALYSIS' &&
      valStoreMismatch.usableStatements.length === 0,
      'EX2_T38_STRICT_LINK_STORE_MISMATCH_REJECTED',
      'Vínculo rejeitado quando loja da análise diverge da loja da OS, gerando lacuna NOT_IN_ANALYSIS'
    );

    // EX2_T39: Ter conversationId não basta — OS não presente em coveredOsIds rejeita vínculo
    const orderNotCovered = { osId: 999, lojaSlug: 'sorocaba' };
    const valNotCovered = summaryAdapter.validateStrictOrderLink(analysisSorocaba, orderNotCovered);
    assert(
      valNotCovered.isValidLink === false &&
      valNotCovered.gap !== undefined &&
      valNotCovered.gap.gapType === 'NOT_IN_ANALYSIS' &&
      valNotCovered.gap.description.includes('não consta entre as ordens cobertas') &&
      valNotCovered.usableStatements.length === 0,
      'EX2_T39_STRICT_LINK_OS_NOT_IN_COVERED_REJECTED',
      'Vínculo rejeitado quando coveredOsIds não inclui a OS solicitada; afirmações não atribuídas'
    );

    // EX2_T40: Análise inválida (isValid === false) é sumariamente rejeitada
    const invalidAnalysis = { ...analysisSorocaba, isValid: false };
    const valInvalid = summaryAdapter.validateStrictOrderLink(invalidAnalysis, { osId: 501, lojaSlug: 'sorocaba' });
    assert(
      valInvalid.isValidLink === false && valInvalid.usableStatements.length === 0,
      'EX2_T40_STRICT_LINK_INVALID_FLAG_REJECTED',
      'Análise com isValid === false tem vínculo estrito rejeitado'
    );

    // EX2_T41: Vínculo válido e comprovado entrega afirmações direcionadas para a OS alvo
    const valValid = summaryAdapter.validateStrictOrderLink(analysisSorocaba, { osId: 501, lojaSlug: 'sorocaba' });
    assert(
      valValid.isValidLink === true &&
      valValid.usableStatements.length === 2 &&
      valValid.usableStatements.every(s => s.targetOsId === 501),
      'EX2_T41_STRICT_LINK_VALID_APPROVED',
      'Vínculo estritamente comprovado (loja + coveredOsIds + isValid) aprova e entrega afirmações alvo'
    );

    // EX2_T42: Integração da validação estrita no RealAnalysisRepository
    const sqliteDb = new Database(':memory:');
    const realRepo = new RealAnalysisRepository({ db: sqliteDb });
    await realRepo.saveAnalysis(analysisSorocaba);

    const verifiedResult = await realRepo.getAnalysisForOrderWithStrictValidation(101, { osId: 501, lojaSlug: 'sorocaba' });
    assert(
      verifiedResult.analysis !== null &&
      verifiedResult.isValidLink === true &&
      verifiedResult.usableStatements.length === 2,
      'EX2_T42_REAL_REPO_STRICT_VALIDATION_INTEGRATION',
      'RealAnalysisRepository valida vínculo estrito de ponta a ponta a partir de registros do SQLite'
    );
  }

  // =========================================================================
  // SEÇÃO 10: REPOSITÓRIO OPERACIONAL E BUSCA DE VEÍCULOS (INCIDENTE LINEA)
  // =========================================================================
  console.log('\n--- SEÇÃO 10: Repositório Operacional e Busca de Veículos (Incidente Linea) ---');
  {
    const opDb = new Database(':memory:');
    const opRepo = new OperationalDataRepository({ db: opDb });

    // Seed de ordens de teste para reprodução fiel do incidente Linea/Jabaquara e cenários ambíguos
    const seedOrders: CandidateOrder[] = [
      // 1. Linea único em Jabaquara com 1 OS aberta
      {
        osId: 1001,
        lojaSlug: 'jabaquara',
        vehicleModel: 'Fiat Linea Essence 1.8',
        vehiclePlate: 'LIN1001',
        customerName: 'Renato Silva',
        customerPhone: '11988880001',
        status: 'Em Diagnóstico',
        isAberta: true,
        totalValue: 1200.0,
        paidValue: 0.0,
        pendingServices: ['Troca de Correia'],
        openedAt: '2026-09-01T08:00:00Z', // Aberta há mais de 30 dias (não deve ser descartada)
        updatedAt: '2026-10-05T09:00:00Z'
      },
      // 2. Linea em Sorocaba (para teste de isolamento de escopo)
      {
        osId: 1002,
        lojaSlug: 'sorocaba',
        vehicleModel: 'Fiat Linea Absolute 1.9',
        vehiclePlate: 'LIN2002',
        customerName: 'Marcos Souza',
        customerPhone: '15977770002',
        status: 'Aguardando Peça',
        isAberta: true,
        totalValue: 2500.0,
        paidValue: 1000.0,
        pendingServices: ['Módulo Dualogic'],
        openedAt: '2026-10-01T08:00:00Z',
        updatedAt: '2026-10-05T09:00:00Z'
      },
      // 3. Dois Civics distintos em Sorocaba (AMBIGUOUS_VEHICLE)
      {
        osId: 2001,
        lojaSlug: 'sorocaba',
        vehicleModel: 'Honda Civic LXS',
        vehiclePlate: 'CIV1000',
        customerName: 'Cliente A',
        customerPhone: '15966660003',
        status: 'Em Execução',
        isAberta: true,
        totalValue: 800.0,
        paidValue: 0.0,
        pendingServices: ['Freios'],
        openedAt: '2026-10-03T08:00:00Z',
        updatedAt: '2026-10-05T09:00:00Z'
      },
      {
        osId: 2002,
        lojaSlug: 'sorocaba',
        vehicleModel: 'Honda Civic Touring',
        vehiclePlate: 'CIV2000',
        customerName: 'Cliente B',
        customerPhone: '15955550004',
        status: 'Aguardando Aprovação',
        isAberta: true,
        totalValue: 3400.0,
        paidValue: 0.0,
        pendingServices: ['Turbina'],
        openedAt: '2026-10-04T08:00:00Z',
        updatedAt: '2026-10-05T09:00:00Z'
      },
      // 4. Mesmo veículo Corolla com duas OSs abertas simultâneas (AMBIGUOUS_ORDER)
      {
        osId: 3001,
        lojaSlug: 'sorocaba',
        vehicleModel: 'Toyota Corolla XEi',
        vehiclePlate: 'COR3000',
        customerName: 'Cliente C',
        customerPhone: '15944440005',
        status: 'Mecânica',
        isAberta: true,
        totalValue: 1500.0,
        paidValue: 0.0,
        pendingServices: ['Suspensão'],
        openedAt: '2026-10-02T08:00:00Z',
        updatedAt: '2026-10-05T09:00:00Z'
      },
      {
        osId: 3002,
        lojaSlug: 'sorocaba',
        vehicleModel: 'Toyota Corolla XEi',
        vehiclePlate: 'COR3000',
        customerName: 'Cliente C',
        customerPhone: '15944440005',
        status: 'Funilaria',
        isAberta: true,
        totalValue: 2200.0,
        paidValue: 0.0,
        pendingServices: ['Pintura Parachoque'],
        openedAt: '2026-10-03T08:00:00Z',
        updatedAt: '2026-10-05T09:00:00Z'
      }
    ];

    for (const ord of seedOrders) {
      opRepo.saveOrder(ord);
    }

    // EX2_T43: Ausência de SecurityContext lança SecurityAccessDeniedError (sem fallback silencioso)
    let threwNoSec = false;
    try {
      await opRepo.searchVehiclesByModel('linea', undefined as unknown as SecurityContext);
    } catch (err) {
      if (err instanceof SecurityAccessDeniedError) threwNoSec = true;
    }
    assert(
      threwNoSec,
      'EX2_T43_OPERATIONAL_REPO_MISSING_SECURITY_SCOPE_THROWS',
      'searchVehiclesByModel exige SecurityContext obrigatório e recusa fallback silencioso'
    );

    // EX2_T44: Gerente tentando consultar loja diferente da autorizada é bloqueado sumariamente
    const gerenteJabaquara: SecurityContext = {
      persona: 'gerente',
      authorizedLojaSlug: 'jabaquara'
    };
    let threwCrossStore = false;
    try {
      await opRepo.searchVehiclesByModel('linea', gerenteJabaquara, 'sorocaba');
    } catch (err) {
      if (err instanceof SecurityAccessDeniedError) threwCrossStore = true;
    }
    assert(
      threwCrossStore,
      'EX2_T44_OPERATIONAL_REPO_GERENTE_CROSS_STORE_FORBIDDEN',
      'Gerente de Jabaquara tentando filtrar Sorocaba lança SecurityAccessDeniedError imediato'
    );

    // EX2_T45: Busca por modelo inexistente retorna união NO_MATCH
    const noMatchResult = await opRepo.searchVehiclesByModel('ferrari', gerenteJabaquara);
    assert(
      noMatchResult.type === 'NO_MATCH' && noMatchResult.requestedModel === 'ferrari',
      'EX2_T45_OPERATIONAL_REPO_SEARCH_NO_MATCH',
      'Modelo não encontrado retorna união discriminada NO_MATCH com escopo verificado'
    );

    // EX2_T46: Incidente Linea/Jabaquara — Alvo único com 1 OS ativa resolve RESOLVED com dados íntegros
    const lineaJabaquaraResult = await opRepo.searchVehiclesByModel('linea', gerenteJabaquara);
    assert(
      lineaJabaquaraResult.type === 'RESOLVED' &&
      lineaJabaquaraResult.vehicle.vehiclePlate === 'LIN1001' &&
      lineaJabaquaraResult.order.osId === 1001 &&
      lineaJabaquaraResult.order.isAberta === true &&
      lineaJabaquaraResult.relatedOrdersCount === 1,
      'EX2_T46_OPERATIONAL_REPO_SEARCH_RESOLVED_LINEA_JABAQUARA',
      'Incidente Linea: alvo único no Jabaquara resolve RESOLVED com OS ativa preservada (>30 dias)'
    );

    // EX2_T47: Múltiplos veículos com placas distintas retornam união AMBIGUOUS_VEHICLE
    const socioScope: SecurityContext = { persona: 'socio' };
    const civicResult = await opRepo.searchVehiclesByModel('civic', socioScope, 'sorocaba');
    assert(
      civicResult.type === 'AMBIGUOUS_VEHICLE' &&
      civicResult.totalFound === 2 &&
      civicResult.vehicles.length === 2 &&
      civicResult.vehicles.some((v: { vehiclePlate?: string }) => v.vehiclePlate === 'CIV1000') &&
      civicResult.vehicles.some((v: { vehiclePlate?: string }) => v.vehiclePlate === 'CIV2000'),
      'EX2_T47_OPERATIONAL_REPO_SEARCH_AMBIGUOUS_VEHICLE',
      'Múltiplos carros com placas distintas retornam AMBIGUOUS_VEHICLE sem limitar a rows[0]'
    );

    // EX2_T48: Mesmo veículo com 2 ordens abertas simultâneas retorna união AMBIGUOUS_ORDER
    const corollaResult = await opRepo.searchVehiclesByModel('corolla', socioScope, 'sorocaba');
    assert(
      corollaResult.type === 'AMBIGUOUS_ORDER' &&
      corollaResult.vehicle.vehiclePlate === 'COR3000' &&
      corollaResult.totalFound === 2 &&
      corollaResult.orders.length === 2,
      'EX2_T48_OPERATIONAL_REPO_SEARCH_AMBIGUOUS_ORDER',
      'Mesmo veículo com 2 OSs abertas relevantes retorna AMBIGUOUS_ORDER para desambiguação'
    );

    // EX2_T49: Histórico do veículo não exclui OSs abertas antigas (>30 dias)
    const lineaHistory = await opRepo.getOrdersForVehicle('LIN1001', gerenteJabaquara);
    assert(
      lineaHistory.length === 1 &&
      lineaHistory[0].osId === 1001 &&
      lineaHistory[0].openedAt === '2026-09-01T08:00:00Z',
      'EX2_T49_OPERATIONAL_REPO_ORDERS_FOR_VEHICLE_NO_30D_EXCLUSION',
      'getOrdersForVehicle preserva ordens antigas (>30 dias) sem exclusão arbitrária'
    );

    // EX2_T50: Gerente de Jabaquara não enxerga Linea de Sorocaba no resultado
    const lineaGerenteResult = await opRepo.searchVehiclesByModel('linea', gerenteJabaquara);
    assert(
      lineaGerenteResult.type === 'RESOLVED' &&
      lineaGerenteResult.vehicle.lojaSlug === 'jabaquara' &&
      lineaGerenteResult.vehicle.vehiclePlate !== 'LIN2002',
      'EX2_T50_OPERATIONAL_REPO_GERENTE_RESTRICTED_TO_AUTHORIZED_STORE',
      'Gerente de Jabaquara tem busca restrita à sua loja autorizada com zero vazamento de Sorocaba'
    );
  }

  // =========================================================================
  // RELATÓRIO FINAL
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO FINAL EXECUTOR 2: ${passed} APROVADOS / ${failed} FALHAS`);
  console.log('='.repeat(80));

  if (failed === 0) {
    console.log(`🎉 100% PASS — TODOS OS ${passed} TESTES DO EXECUTOR 2 HOMOLOGADOS COM SUCESSO!`);
  } else {
    console.error(`⚠️ ATENÇÃO: Houve ${failed} falhas na suíte de testes.`);
    process.exit(1);
  }
}

runExecutor2Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
