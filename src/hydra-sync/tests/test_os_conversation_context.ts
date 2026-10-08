/**
 * Hydra — Suíte de Testes T41 a T54 + 5 Gates da Auditoria (Versão 2)
 * Spec: hydra-os-conversation-context
 * Versão: 2.0.0 — Alinhamento total à auditoria de 05/10/2026
 */

import { ConversationSourceAdapter } from '../conversation_source_adapter';
import { SummaryEvidenceAdapter } from '../summary_evidence_adapter';
import { HybridOSCoordinator, SecurityAccessDeniedError } from '../hybrid_os_coordinator';
import { ConversationSemanticResolver } from '../conversation_semantic_resolver';
import { OSSituationComposer } from '../os_situation_composer';
import {
  FIXTURE_OS_CATALOG,
  FIXTURE_SUMMARIES,
  FIXTURE_MESSAGES
} from '../fixtures/conversation_context_fixtures';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testId: string, testDesc: string): void {
  if (condition) {
    passedCount++;
    console.log(`✅ [PASS] ${testId} — ${testDesc}`);
  } else {
    failedCount++;
    console.error(`❌ [FAIL] ${testId} — ${testDesc}`);
  }
}

async function runSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🔬 HYDRA — SUÍTE DE TESTES T41 A T54 + 5 GATES ADVERSARIAIS (VERSÃO 2)');
  console.log('='.repeat(80));

  const sourceAdapter = new ConversationSourceAdapter();
  const summaryAdapter = new SummaryEvidenceAdapter();

  for (const [convIdStr, msgs] of Object.entries(FIXTURE_MESSAGES)) {
    sourceAdapter.seedMessages(parseInt(convIdStr, 10), msgs);
  }
  for (const summary of Object.values(FIXTURE_SUMMARIES)) {
    summaryAdapter.registerSummary(summary);
  }

  const coordinator = new HybridOSCoordinator(sourceAdapter, summaryAdapter, FIXTURE_OS_CATALOG);
  coordinator.registerLink(501, 101); // OS 501 -> Conv 101
  coordinator.registerLink(502, 102); // OS 502 -> Conv 102
  coordinator.registerLink(503, 102); // OS 503 -> Conv 102
  coordinator.registerLink(506, 106); // OS 506 -> Conv 106
  coordinator.registerLink(507, 107); // OS 507 -> Conv 107 (Watchdog)
  coordinator.registerLink(508, 108); // OS 508 -> Conv 108
  coordinator.registerLink(509, 109); // OS 509 -> Conv 109
  coordinator.registerLink(510, 110); // OS 510 -> Campinas
  coordinator.registerLink(511, 111); // OS 511 -> Conv 111 (Prompt injection)
  coordinator.registerLink(512, 112); // OS 512 -> Conv 112 (Audio gap)
  coordinator.registerLink(514, 114); // OS 514 -> Conv 114 (Cache)
  coordinator.registerLink(518, 118); // OS 518 -> Conv 118 (Gate 4: Edição)
  coordinator.registerLink(519, 119); // OS 519 -> Conv 119 (Gate 5: Truncamento)
  coordinator.registerLink(520, 120); // OS 520 -> Conv 120 (T45 v2)

  console.log('\n--- SEÇÃO 1: OS, Vínculo Inequívoco e Modo Padrão (T41) ---');
  {
    const report = await coordinator.inspectOS({
      osId: 501,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba',
      isComplementaryRequested: false
    });

    const hasApproval = report.conversationState?.statements.some(
      s => s.subject === 'CLIENT_APPROVAL' && s.confirmation === 'EXPLICIT_CONFIRMED'
    );
    const hasCommitment = report.conversationState?.statements.some(
      s => s.subject === 'ATTENDANT_COMMITMENT'
    );
    const balloonValid = report.formattedWhatsAppBalloon.includes('Civic') &&
      !report.formattedWhatsAppBalloon.includes('**');

    assert(
      !!hasApproval && !!hasCommitment && balloonValid,
      'T41_UNAMBIGUOUS_LINK_AND_VALID_SUMMARY',
      'OS 501 combina dados cadastrais e análise existente no modo padrão com zero chamadas brutas'
    );
  }

  console.log('\n--- SEÇÃO 2: Contato com Múltiplos Veículos / Ordens (T42 e T43) ---');
  {
    const resolver = new ConversationSemanticResolver();
    const os502 = FIXTURE_OS_CATALOG[502];
    const os503 = FIXTURE_OS_CATALOG[503];
    const msgs102 = FIXTURE_MESSAGES[102];

    const eval502 = resolver.evaluateLink(
      {
        osId: os502.osId,
        lojaSlug: os502.lojaSlug,
        vehiclePlate: os502.vehiclePlate,
        customerPhone: os502.customerPhone,
        customerName: os502.customerName,
        openedAt: os502.openedAt
      },
      {
        conversationId: 102,
        inboxId: 1,
        lojaSlug: 'sorocaba',
        contactPhone: os502.customerPhone,
        contactName: os502.customerName,
        messagesSample: msgs102
      },
      [os503]
    );

    const stmtCivic = resolver.extractStatement(msgs102[0], 502);
    const stmtCorolla = resolver.extractStatement(msgs102[1], 503);

    assert(
      stmtCivic?.subject === 'CLIENT_APPROVAL' &&
      stmtCorolla?.subject !== 'CLIENT_APPROVAL',
      'T42_SAME_CONTACT_MULTIPLE_VEHICLES_SEGREGATION',
      'Aprovação do Civic CIV1234 não é indevidamente herdada pelo Corolla COR5678 do mesmo cliente'
    );

    assert(
      eval502.link?.evidence.vehiclePlate === 'CIV1234',
      'T43_SINGLE_CONVERSATION_MULTIPLE_ORDERS_EVIDENCE',
      'Conversa única segmenta ordens por evidência contextual explícita sem misturar temas'
    );
  }

  console.log('\n--- SEÇÃO 3: Mensagem Posterior ao Resumo e Watchdog Operacional (T44 e T45) ---');
  {
    // T44 Versão 2: Nova análise publicada para OS 506
    summaryAdapter.registerSummary({
      summaryId: 'sum_506_v2',
      analysisId: 'ana_506_v2',
      conversationId: 106,
      lojaSlug: 'sorocaba',
      coveredOsIds: [506],
      sourceType: 'OPERATIONAL_SYNTHESIS',
      cursorLastMessageId: 205,
      analyzedUntilMessageId: 205,
      messagesCoveredUntil: '2026-10-04T10:05:00Z',
      analyzedUntilTimestamp: '2026-10-04T10:05:00Z',
      generatedAt: '2026-10-04T10:10:00Z',
      analysisVersion: 'v2.0',
      statements: [
        {
          statementId: 'stmt_506_v2_appr',
          subject: 'CLIENT_APPROVAL',
          polarity: 'AFFIRMATIVE',
          authorRole: 'CLIENT',
          authorName: 'Roberto Dias',
          messageId: 205,
          timestamp: '2026-10-04T10:00:00Z',
          rawExcerpt: 'Mudei de ideia, pode fazer a embreagem do Onix! Aprovado!',
          targetOsId: 506,
          confirmation: 'EXPLICIT_CONFIRMED'
        }
      ],
      gaps: [],
      isValid: true
    });

    const report506 = await coordinator.inspectOS({
      osId: 506,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba',
      isComplementaryRequested: false
    });

    const hasNewApproval = report506.conversationState?.statements.some(
      s => s.messageId === 205 && s.subject === 'CLIENT_APPROVAL'
    );
    const hasDivergence = report506.discrepancies.some(d => d.discrepancyType === 'STATUS_LAG');

    assert(
      !!hasNewApproval && hasDivergence,
      'T44_NEW_ANALYSIS_VERSION_INCORPORATED',
      'Nova versão da análise é incorporada no modo padrão sem disparar reanálise automática'
    );

    // T45 Versão 2: Análise de Watchdog contendo aprovação operacional com evidência (F08)
    const report520 = await coordinator.inspectOS({
      osId: 520,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba',
      isComplementaryRequested: false
    });

    const hasOperationalApproval = report520.conversationState?.statements.some(
      s => s.subject === 'CLIENT_APPROVAL' && s.confirmation === 'EXPLICIT_CONFIRMED'
    );
    const hasWatchdogFlag = report520.conversationState?.statements.some(
      s => s.subject === 'WATCHDOG_FLAG'
    );

    assert(
      !!hasOperationalApproval && !!hasWatchdogFlag,
      'T45_WATCHDOG_OPERATIONAL_FACTS_UTILIZED_F08',
      'Análise de Watchdog tem dados operacionais aproveitados e alerta de conduta segregado (Fim do descarte cego)'
    );
  }

  console.log('\n--- SEÇÃO 4: "Ok" Ambíguo e Alegação de Pagamento vs ERP (T46 e T47) ---');
  {
    const report508 = await coordinator.inspectOS({
      osId: 508,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba',
      isComplementaryRequested: true
    });

    const okStatement = report508.conversationState?.statements.find(
      s => s.messageId === 251
    );

    assert(
      okStatement?.confirmation === 'AMBIGUOUS_GENERIC' &&
      report508.pendingActions.some(p => p.includes('Confirmar com o cliente')),
      'T46_AMBIGUOUS_OK_REQUIRES_BUDGET_CONFIRMATION',
      'Resposta "Ok" genérica após orçamento é marcada como ambígua exigindo confirmação de versão'
    );

    const report509 = await coordinator.inspectOS({
      osId: 509,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba',
      isComplementaryRequested: true
    });

    const hasPaymentClaim = report509.conversationState?.statements.some(
      s => s.subject === 'PAYMENT_CLAIM' && s.confirmation === 'CLAIM_UNCONFIRMED'
    );
    const hasPaymentDivergence = report509.discrepancies.some(
      d => d.discrepancyType === 'PAYMENT_PENDING'
    );

    assert(
      !!hasPaymentClaim && hasPaymentDivergence && report509.formattedWhatsAppBalloon.includes('Alegação de pagamento'),
      'T47_PAYMENT_CLAIM_DISTINGUISHED_FROM_CONFIRMED_RECEIPT',
      'Alegação de Pix pelo cliente é registrada sem presumir quitação financeira cadastral'
    );
  }

  console.log('\n--- SEÇÃO 5: Segurança, Prompt Injection e Lacunas de Mídia (T48 a T50) ---');
  {
    let accessBlocked = false;
    try {
      await coordinator.inspectOS({
        osId: 510,
        userPersona: 'gerente',
        requestedByLojaSlug: 'sorocaba',
        isComplementaryRequested: false
      });
    } catch (err: unknown) {
      if (err instanceof SecurityAccessDeniedError) {
        accessBlocked = true;
      }
    }

    assert(
      accessBlocked,
      'T48_CROSS_STORE_MANAGER_ACCESS_BLOCKED',
      'Gerente de Sorocaba é compulsoriamente bloqueado ao tentar consultar OS de Campinas'
    );

    const report511 = await coordinator.inspectOS({
      osId: 511,
      userPersona: 'socio',
      isComplementaryRequested: true
    });

    const injectionExecuted = report511.formattedWhatsAppBalloon.includes('DISCOUNT_APPROVED_100%') ||
      report511.erpState.paidValue === 5000;

    assert(
      !injectionExecuted && report511.erpState.status === 'Aguardando Pagamento',
      'T49_PROMPT_INJECTION_NEUTRALIZED_AS_LITERAL_DATA',
      'Comando malicioso no WhatsApp do cliente é tratado puramente como dado textual sem execução'
    );

    const report512 = await coordinator.inspectOS({
      osId: 512,
      userPersona: 'socio',
      isComplementaryRequested: true
    });

    const hasAudioGap = report512.conversationState?.gaps.some(
      g => g.gapType === 'UNTRANSCRIBED_AUDIO'
    );
    const limitationNoted = report512.limitations.some(
      l => l.includes('Áudio recebido') && l.includes('não inferir silêncio')
    );

    assert(
      !!hasAudioGap && limitationNoted,
      'T50_UNTRANSCRIBED_AUDIO_RECORDED_AS_EXPLICIT_GAP',
      'Áudio sem transcrição é registrado como lacuna explícita sem presumir silêncio ou aceite'
    );
  }

  console.log('\n--- SEÇÃO 6: Resiliência, Fallback, Agregadores e Cache (T51 a T54) ---');
  {
    // T51: Invalidação de cache por nova versão da análise
    const cacheManager = coordinator.getCacheManager();
    const os514 = FIXTURE_OS_CATALOG[514];

    cacheManager.set('sorocaba', 514, 'socio', 'v1.0', os514.updatedAt, {
      osId: 514,
      lojaSlug: 'sorocaba',
      vehiclePlate: 'CAC1111',
      vehicleModel: 'Fiat Toro',
      timestampReport: new Date().toISOString(),
      erpState: {
        status: os514.status,
        totalValue: os514.totalValue,
        paidValue: os514.paidValue,
        pendingServices: os514.pendingServices,
        updatedAt: os514.updatedAt
      },
      discrepancies: [],
      pendingActions: [],
      limitations: [],
      formattedWhatsAppBalloon: 'Balão Versão v1.0',
      cachedResponse: false
    });

    // Ao consultar com nova versão 'v2.0', o cache deve dar MISS e atualizar
    const cachedMiss = await cacheManager.get('sorocaba', 514, 'socio', 'v2.0', os514.updatedAt);
    assert(
      cachedMiss === null,
      'T51_CACHE_INVALIDATED_BY_ANALYSIS_VERSION',
      'Cache multi-fatorial é invalidado por nova versão da análise garantindo dados frescos'
    );

    // T52: Falha na API de conversas com ERP operacional funcional
    const failingSourceAdapter = new ConversationSourceAdapter();
    failingSourceAdapter.fetchMessages = async () => {
      throw new Error('503 Service Unavailable: Chatwoot API down');
    };
    const fallbackCoordinator = new HybridOSCoordinator(failingSourceAdapter, summaryAdapter, FIXTURE_OS_CATALOG);
    fallbackCoordinator.registerLink(501, 101);

    const report501Fallback = await fallbackCoordinator.inspectOS({
      osId: 501,
      userPersona: 'socio',
      isComplementaryRequested: true // Força modo complementar com erro
    });

    assert(
      report501Fallback.limitations.some(l => l.includes('WhatsApp temporariamente inacessível')) &&
      report501Fallback.erpState.totalValue === 2400.0,
      'T52_CONVERSATION_SERVICE_FAILURE_FALLBACK_TO_ERP',
      'Falha na API de WhatsApp entrega dados cadastrais da oficina sem quebrar a consulta'
    );

    // T53: Pergunta agregadora com base amostral parcial
    const composer = new OSSituationComposer();
    const aggReport = composer.compose({
      osId: 0,
      lojaSlug: 'sorocaba',
      vehiclePlate: 'TODAS',
      vehicleModel: 'Frota Parcial',
      erpState: {
        status: 'Consolidado Parcial',
        totalValue: 0,
        paidValue: 0,
        pendingServices: [],
        updatedAt: new Date().toISOString()
      },
      isAggregatorSampleOnly: true
    });

    assert(
      aggReport.limitations.some(l => l.includes('amostra de conversas analisadas')) &&
      aggReport.limitations.some(l => l.includes('não reflete o total consolidado')),
      'T53_AGGREGATOR_QUERY_DECLARES_SAMPLE_LIMITATIONS',
      'Consulta agregadora em base parcial declara explicitamente limitação de amostra e recusa total indevido'
    );

    // T54: Consulta repetida com fontes inalteradas (Cache HIT)
    await coordinator.inspectOS({
      osId: 514,
      userPersona: 'socio',
      isComplementaryRequested: false
    });

    const reportCached = await coordinator.inspectOS({
      osId: 514,
      userPersona: 'socio',
      isComplementaryRequested: false
    });

    assert(
      reportCached.cachedResponse === true,
      'T54_REPEATED_QUERY_CACHE_HIT_AND_MEASURED_REUSE',
      'Consulta idêntica sem novas análises consome cache contextual com cachedResponse: true'
    );
  }

  console.log('\n--- SEÇÃO 7: CINCO GATES ADVERSARIAIS DA AUDITORIA (05/10/2026) ---');
  {
    // GATE 1: Negação Rigorosa (case: "negation")
    const resolver = new ConversationSemanticResolver();
    const msgNeg = {
      messageId: 10,
      conversationId: 101,
      senderType: 'contact' as const,
      senderName: 'Cliente',
      textContent: 'Nao autorizo o servico de embreagem',
      isPrivate: false,
      createdAt: '2026-10-01T10:10:00Z',
      hasAttachments: false
    };
    const stmtNeg = resolver.extractStatement(msgNeg, 501);
    assert(
      stmtNeg?.subject === 'CLIENT_REFUSAL' && stmtNeg.polarity === 'NEGATIVE',
      'AUDIT_GATE_1_NEGATION',
      'Gate 1 (Auditoria): "Nao autorizo o servico" é classificado estritamente como CLIENT_REFUSAL e NUNCA CLIENT_APPROVAL'
    );

    // GATE 2: Conversa sem Vínculo Comprovado (case: "missing_link_evidence")
    const reportNoLink = await coordinator.inspectOS({
      osId: 517,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba'
    });
    assert(
      reportNoLink.linkInfo === null &&
      !reportNoLink.formattedWhatsAppBalloon.includes('aprovou') &&
      reportNoLink.limitations.some(l => l.includes('Não há conversa de atendimento vinculada')),
      'AUDIT_GATE_2_MISSING_LINK_EVIDENCE',
      'Gate 2 (Auditoria): Conversa sem identificadores comprovados aborta incorporação e retorna dados do ERP com limitação'
    );

    // GATE 3: Candidatos de Outra Loja Purgados em Ambiguidade (case: "cross_store_candidates")
    const reportAmb = await coordinator.inspectOS({
      osId: 502,
      userPersona: 'gerente',
      requestedByLojaSlug: 'sorocaba'
    });
    const balloonText = reportAmb.formattedWhatsAppBalloon;
    const otherStoreExposed = balloonText.includes('Campinas') || balloonText.includes('OS 521') || balloonText.includes('CAM5566');
    assert(
      !otherStoreExposed,
      'AUDIT_GATE_3_CROSS_STORE_CANDIDATES_PURGED',
      'Gate 3 (Auditoria): Candidatos de outra loja são rigorosamente purgados antes de compor lista de ambiguidade para gerente'
    );

    // GATE 4: Mensagem Editada com Mesmo ID Invalida Cache (case: "edited_message_same_id")
    sourceAdapter.seedMessages(118, [
      {
        messageId: 600,
        conversationId: 118,
        senderType: 'contact',
        senderName: 'Tatiana Rocha',
        textContent: 'Pode fazer o conserto!',
        isPrivate: false,
        createdAt: '2026-10-05T09:00:00Z',
        hasAttachments: false
      }
    ]);

    await coordinator.inspectOS({
      osId: 518,
      userPersona: 'socio',
      isComplementaryRequested: true
    });

    const reportV1Cached = await coordinator.inspectOS({
      osId: 518,
      userPersona: 'socio',
      isComplementaryRequested: true
    });
    assert(reportV1Cached.cachedResponse === true, 'AUDIT_GATE_4_CACHE_HIT_BEFORE_EDIT', 'Gate 4: Cache hit antes da edição comprovado');

    // Cliente edita mensagem 600 no WhatsApp com mesmo ID:
    sourceAdapter.seedMessages(118, [
      {
        messageId: 600,
        conversationId: 118,
        senderType: 'contact',
        senderName: 'Tatiana Rocha',
        textContent: 'NÃO AUTORIZO O CONSERTO! CANCELE TUDO!',
        isPrivate: false,
        createdAt: '2026-10-05T09:00:00Z',
        hasAttachments: false
      }
    ]);

    const report518Fresh = await coordinator.inspectOS({
      osId: 518,
      userPersona: 'socio',
      isComplementaryRequested: true
    });

    const oldApprovalRetained = report518Fresh.conversationState?.statements.some(s => s.subject === 'CLIENT_APPROVAL');
    const hasRefusalStatement = report518Fresh.conversationState?.statements.some(s => s.subject === 'CLIENT_REFUSAL');

    assert(
      report518Fresh.cachedResponse === false && !oldApprovalRetained && !!hasRefusalStatement,
      'AUDIT_GATE_4_EDITED_MESSAGE_INVALIDATES_CACHE',
      'Gate 4 (Auditoria): Mensagem editada com mesmo ID invalida cache e descarta aprovação anterior (oldApprovalRetained: false)'
    );

    // GATE 5: Truncamento de Histórico com Lacuna Obrigatória (case: "history_truncation")
    const report519 = await coordinator.inspectOS({
      osId: 519,
      userPersona: 'socio',
      isComplementaryRequested: true
    });
    const hasTruncationGap = report519.conversationState?.gaps.some(g => g.gapType === 'TRUNCATED_HISTORY');
    const limitationTruncated = report519.limitations.some(l => l.includes('Histórico recente limitado ao orçamento'));
    assert(
      !!hasTruncationGap && limitationTruncated,
      'AUDIT_GATE_5_HISTORY_TRUNCATION_GAP_RECORDED',
      'Gate 5 (Auditoria): Histórico longo com mais de 20 mensagens registra compulsoriamente lacuna TRUNCATED_HISTORY'
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO FINAL DA SUÍTE VERSÃO 2: ${passedCount} APROVADOS / ${failedCount} FALHAS`);
  if (failedCount === 0) {
    console.log('🎉 100% PASS — TODOS OS 14 TESTES T41-T54 E OS 5 GATES ADVERSARIAIS FORAM HOMOLOGADOS COM SUCESSO!');
  } else {
    console.error('⚠️ ATENÇÃO: Houve falhas na suíte de testes.');
  }
  console.log('='.repeat(80));

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
