/**
 * Hydra — Adaptador de Evidências e Resumos Operacionais de Atendimento
 * Spec: hydra-os-conversation-context
 * Responsabilidade: Executor 2 (Fontes, Dados e Evidências)
 */

import {
  ConversationAnalysisRecord,
  ConversationSummaryRecord,
  SummarySourceType,
  AnalysisSourceType,
  ExtractedStatement,
  ConversationGap,
  SanitizedMessage
} from './types/conversation_context_contract';

export class SummaryEvidenceAdapter {
  private summariesStore: Map<number, ConversationAnalysisRecord> = new Map();

  /**
   * Registra um resumo/análise operacional para uma conversa.
   */
  public registerSummary(summary: ConversationAnalysisRecord): void {
    this.summariesStore.set(summary.conversationId, summary);
  }

  /**
   * Obtém a análise válida mais recente para a conversa.
   */
  public getSummaryForConversation(conversationId: number): ConversationAnalysisRecord | null {
    const summary = this.summariesStore.get(conversationId);
    if (!summary || !summary.isValid) return null;
    return summary;
  }

  /**
   * Obtém a análise válida para uma conversa e loja específicas (compatibilidade IAnalysisRepository).
   */
  public async getAnalysisByConversation(conversationId: number, lojaSlug: string): Promise<ConversationAnalysisRecord | null> {
    const summary = this.summariesStore.get(conversationId);
    if (!summary || !summary.isValid) return null;
    if (summary.lojaSlug.toLowerCase() !== lojaSlug.toLowerCase()) return null;
    return summary;
  }

  /**
   * Obtém a análise operacional existente para uma OS e loja específicas (Ajuste 2 / G08).
   */
  public async getAnalysisByOS(osId: number, lojaSlug: string): Promise<ConversationAnalysisRecord | null> {
    for (const record of this.summariesStore.values()) {
      if (
        record.isValid &&
        record.lojaSlug.toLowerCase() === lojaSlug.toLowerCase() &&
        record.coveredOsIds &&
        record.coveredOsIds.includes(osId)
      ) {
        return record;
      }
    }
    return null;
  }

  /**
   * Avalia a confiabilidade e aplicabilidade do resumo/análise.
   * REGRA F08 (Versão 2): Fim do descarte cego por rótulo.
   * Se a fonte for WATCHDOG_EVAL mas contiver afirmações operacionais sustentadas com evidência,
   * tais afirmações DEVEM ser aproveitadas. Alerta isolado de conduta não comprova a situação da OS.
   */
  public evaluateSummaryReliability(summary: ConversationAnalysisRecord): {
    canUseAsBase: boolean;
    isWatchdogInfractionOnly: boolean;
    reason?: string;
  } {
    if (summary.sourceType === 'WATCHDOG_EVAL') {
      const operationalStatements = this.extractOperationalStatements(summary);
      if (operationalStatements.length === 0) {
        return {
          canUseAsBase: false,
          isWatchdogInfractionOnly: true,
          reason: 'Relatório do Watchdog trata apenas de infrações de conduta; não constitui resumo de situação de OS.'
        };
      }

      // F08: Se houver afirmações operacionais sustentadas por evidência no registro do Watchdog, aproveitá-las
      return {
        canUseAsBase: true,
        isWatchdogInfractionOnly: false,
        reason: undefined
      };
    }

    const statements = summary.statements || [];
    const gaps = summary.gaps || [];

    if (statements.length === 0 && gaps.length === 0) {
      return {
        canUseAsBase: false,
        isWatchdogInfractionOnly: false,
        reason: 'Resumo sem afirmações estruturadas ou metadados de cobertura.'
      };
    }

    return {
      canUseAsBase: true,
      isWatchdogInfractionOnly: false
    };
  }

  /**
   * Extrai afirmações estritamente operacionais da análise, expurgando alertas isolados de conduta (WATCHDOG_FLAG).
   */
  public extractOperationalStatements(summary: ConversationAnalysisRecord): ExtractedStatement[] {
    return (summary.statements || []).filter(s => s.subject !== 'WATCHDOG_FLAG');
  }

  /**
   * Detecta lacunas de mídia e mensagens no histórico da conversa.
   * REGRA PÉTREA: Áudio ou mídia não transcrita NUNCA pode ser interpretada como silêncio ou concordância tácita.
   */
  public detectMediaGaps(messages: readonly SanitizedMessage[]): ConversationGap[] {
    const gaps: ConversationGap[] = [];
    for (const msg of messages) {
      if (msg.hasAttachments && msg.attachmentType === 'audio' && !msg.isTranscribed) {
        gaps.push({
          gapId: `gap_audio_${msg.messageId}`,
          messageId: msg.messageId,
          conversationId: msg.conversationId,
          gapType: 'UNTRANSCRIBED_AUDIO',
          timestamp: msg.createdAt,
          description: 'Áudio enviado pelo cliente ainda sem transcrição textual. Proibido inferir silêncio ou concordância tácita.'
        });
      } else if (msg.hasAttachments && (msg.attachmentType === 'image' || msg.attachmentType === 'document') && !msg.textContent) {
        gaps.push({
          gapId: `gap_media_${msg.messageId}`,
          messageId: msg.messageId,
          conversationId: msg.conversationId,
          gapType: 'UNREAD_MEDIA',
          timestamp: msg.createdAt,
          description: `Anexo de ${msg.attachmentType} pendente de leitura visual ou OCR.`
        });
      } else if (msg.isDeleted) {
        gaps.push({
          gapId: `gap_del_${msg.messageId}`,
          messageId: msg.messageId,
          conversationId: msg.conversationId,
          gapType: 'DELETED_MESSAGE',
          timestamp: msg.createdAt,
          description: 'Mensagem apagada no WhatsApp pelo remetente.'
        });
      }
    }
    return gaps;
  }

  /**
   * Avalia a cobertura temporal e de cursores da análise frente ao estado atual da conversa.
   */
  public checkCoverage(
    summary: ConversationAnalysisRecord,
    latestMessageId: number | null
  ): { isFullyCovered: boolean; laggingMessageCount: number; cursorLastMessageId: number } {
    const cursor = summary.analyzedUntilMessageId ?? summary.cursorLastMessageId ?? 0;
    if (latestMessageId === null || latestMessageId <= cursor) {
      return {
        isFullyCovered: true,
        laggingMessageCount: 0,
        cursorLastMessageId: cursor
      };
    }

    return {
      isFullyCovered: false,
      laggingMessageCount: latestMessageId - cursor,
      cursorLastMessageId: cursor
    };
  }

  /**
   * Valida a integridade do schema de uma análise com marcadores de cobertura.
   */
  public validateSummarySchema(summary: ConversationAnalysisRecord): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const id = summary.analysisId || summary.summaryId;
    if (!id) errors.push('analysisId ou summaryId obrigatório');
    if (!summary.conversationId) errors.push('conversationId obrigatório');
    if (!summary.lojaSlug) errors.push('lojaSlug obrigatório');
    if (!summary.coveredOsIds || summary.coveredOsIds.length === 0) errors.push('coveredOsIds deve conter ao menos uma OS');
    if (!summary.sourceType) errors.push('sourceType obrigatório');
    const cursor = summary.analyzedUntilMessageId ?? summary.cursorLastMessageId;
    if (cursor === undefined || cursor < 0) errors.push('cursorLastMessageId inválido');
    const coveredUntil = summary.analyzedUntilTimestamp ?? summary.messagesCoveredUntil;
    if (!coveredUntil) errors.push('messagesCoveredUntil obrigatório');
    if (!summary.generatedAt) errors.push('generatedAt obrigatório');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validação Estrita de Vínculo (Ajuste 2 da Revisão v2.1 — Incidente Linea/Jabaquara).
   * Ter conversationId persistido não basta! O vínculo só é válido e comprovado se:
   * 1. analysis.lojaSlug.toLowerCase() === order.lojaSlug.toLowerCase()
   * 2. analysis.coveredOsIds.includes(order.osId)
   * 3. analysis.isValid === true
   *
   * Se conversationId existir mas analysis.coveredOsIds não incluir a OS solicitada,
   * registra lacuna ConversationGap do tipo NOT_IN_ANALYSIS e NÃO atribui as afirmações da conversa ao alvo.
   */
  public validateStrictOrderLink(
    analysis: ConversationAnalysisRecord | null,
    order: { osId: number; lojaSlug: string }
  ): {
    isValidLink: boolean;
    gap?: ConversationGap;
    usableStatements: readonly ExtractedStatement[];
    reason?: string;
  } {
    if (!analysis) {
      return {
        isValidLink: false,
        usableStatements: [],
        reason: 'Nenhuma análise informada para validação.'
      };
    }

    // 1. Validação de loja
    if (analysis.lojaSlug.toLowerCase() !== order.lojaSlug.toLowerCase()) {
      return {
        isValidLink: false,
        gap: {
          gapId: `gap_not_in_analysis_${order.osId}_store_mismatch`,
          conversationId: analysis.conversationId,
          gapType: 'NOT_IN_ANALYSIS',
          timestamp: analysis.generatedAt,
          description: `Análise da conversa (ID ${analysis.conversationId}) pertence à loja '${analysis.lojaSlug}', divergente da loja da OS '${order.lojaSlug}'. Vínculo rejeitado.`
        },
        usableStatements: [],
        reason: `Loja da análise (${analysis.lojaSlug}) diverge da loja da OS (${order.lojaSlug}).`
      };
    }

    // 2. Validação se a OS solicitada está contida em coveredOsIds
    const coveredOsIds = analysis.coveredOsIds || [];
    if (!coveredOsIds.includes(order.osId)) {
      return {
        isValidLink: false,
        gap: {
          gapId: `gap_not_in_analysis_${order.osId}`,
          conversationId: analysis.conversationId,
          gapType: 'NOT_IN_ANALYSIS',
          timestamp: analysis.generatedAt,
          description: `Conversa identificada (ID ${analysis.conversationId}), mas a OS ${order.osId} não consta entre as ordens cobertas na análise (${coveredOsIds.join(', ')}). Afirmações não atribuídas.`
        },
        usableStatements: [],
        reason: `OS ${order.osId} não está presente em coveredOsIds da análise da conversa.`
      };
    }

    // 3. Validação de flag isValid
    if (!analysis.isValid) {
      return {
        isValidLink: false,
        usableStatements: [],
        reason: 'Análise marcada como inválida (isValid === false).'
      };
    }

    // Vínculo comprovado e estrito!
    const statements = analysis.statements || [];
    const targetStatements = statements.filter(s => s.targetOsId === order.osId);
    return {
      isValidLink: true,
      usableStatements: targetStatements
    };
  }
}
