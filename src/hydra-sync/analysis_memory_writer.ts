/**
 * Hydra — Analysis Memory Writer (Persistência Canônica Transacional e Outbox)
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 2 (Dados e Persistência)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import Database from 'better-sqlite3';
import {
  AnalysisMemoryWriter,
  AnalysisRevisionIdentity,
  ConversationAnalysisRecord
} from './types/conversation_context_contract';
import { AnalysisProjectionOutboxManager } from './analysis_projection_outbox';

export class SqliteAnalysisMemoryWriter implements AnalysisMemoryWriter {
  private readonly outboxManager: AnalysisProjectionOutboxManager;

  constructor(private readonly db: Database.Database) {
    this.outboxManager = new AnalysisProjectionOutboxManager(this.db);
  }

  /**
   * Grava a análise histórica e agenda a projeção no outbox em TRANSAÇÃO ATÔMICA ÚNICA.
   * Suporta atendimentos com OS formalizada ou atendimentos pré-OS (H05).
   * Idempotente para reprocessamentos da mesma revisão (H02).
   */
  public async recordCompletedAnalysis(
    analysis: ConversationAnalysisRecord,
    identity: AnalysisRevisionIdentity
  ): Promise<{ readonly revisionId: string; readonly projectionQueued: boolean }> {
    const revisionId = identity.revisionId || `${identity.sourceId}:${identity.accountId}:${identity.conversationId}:${identity.analysisRunId}`;
    const sourceType = (analysis as { sourceType?: string }).sourceType || 'OPERATIONAL_SYNTHESIS';
    const generatedAt = (analysis as { generatedAt?: string; analyzedAt?: string }).generatedAt || (analysis as { analyzedAt?: string }).analyzedAt || new Date().toISOString();
    const analyzedUntilMsgId = (analysis as { analyzedUntilMessageId?: number }).analyzedUntilMessageId ?? null;
    const analyzedUntilTime = (analysis as { analyzedUntilTimestamp?: string; analyzedAt?: string }).analyzedUntilTimestamp || (analysis as { analyzedAt?: string }).analyzedAt || generatedAt;
    const schemaVer = identity.schemaVersion || '1.0';
    const analyzerVer = identity.analyzerVersion || '1.0';
    const isValid = (analysis as { isValid?: boolean }).isValid !== undefined ? ((analysis as { isValid?: boolean }).isValid ? 1 : 0) : 1;

    const recordTx = this.db.transaction(() => {
      // 1. Inserir ou atualizar na tabela canônica de análises por revision_id
      const insertAnalysis = this.db.prepare(`
        INSERT INTO hydra_analises_atendimento (
          revision_id, analysis_id, source_id, account_id, conversation_id,
          loja_slug, covered_os_ids, source_type, analyzed_until_message_id,
          analyzed_until_timestamp, occurred_at, analyzed_at, analysis_run_id,
          schema_version, analyzer_version, operational_summary, conduct_alert, is_valid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(revision_id) DO UPDATE SET
          analyzed_until_message_id = excluded.analyzed_until_message_id,
          analyzed_until_timestamp = excluded.analyzed_until_timestamp,
          operational_summary = excluded.operational_summary,
          conduct_alert = excluded.conduct_alert,
          is_valid = excluded.is_valid
      `);

      insertAnalysis.run(
        revisionId,
        analysis.analysisId,
        identity.sourceId,
        identity.accountId,
        analysis.conversationId,
        analysis.lojaSlug,
        JSON.stringify(analysis.coveredOsIds || []),
        sourceType,
        analyzedUntilMsgId,
        analyzedUntilTime,
        generatedAt,
        generatedAt,
        identity.analysisRunId,
        schemaVer,
        analyzerVer,
        analysis.executiveSummary || null,
        null,
        isValid
      );

      // 2. Limpar afirmações e lacunas anteriores desta revisão para manter idempotência
      this.db.prepare('DELETE FROM hydra_afirmacoes_analisadas WHERE revision_id = ?').run(revisionId);
      this.db.prepare('DELETE FROM hydra_lacunas_conversa WHERE revision_id = ?').run(revisionId);

      // 3. Inserir afirmações com chave composta (revision_id, statement_id)
      const insertStatement = this.db.prepare(`
        INSERT INTO hydra_afirmacoes_analisadas (
          revision_id, statement_id, fact_id, analysis_id, target_os_id,
          subject_type, polarity, author_role, author_name, message_id,
          event_timestamp, raw_excerpt, confirmation_level, service_scope,
          budget_version, monetary_cents, delay_cause_reported,
          part_name, part_code, part_quantity_requested, part_quantity_arrived,
          order_ref, supersedes_fact_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const statementsList = analysis.extractedStatements || (analysis as { statements?: readonly ExtractedStatement[] }).statements || [];
      for (const stmt of statementsList) {
        const factId = stmt.factId || `fact_${stmt.statementId}`;
        const monetaryCents = stmt.monetaryCents !== undefined
          ? stmt.monetaryCents
          : ((stmt as { monetaryValue?: number }).monetaryValue !== undefined ? Math.round((stmt as { monetaryValue?: number }).monetaryValue! * 100) : null);
        const subjectType = (stmt as { subjectType?: string }).subjectType || stmt.subject || 'UNKNOWN';
        const eventTimestamp = (stmt as { eventTimestamp?: string }).eventTimestamp || stmt.timestamp || new Date().toISOString();
        const confLevel = (stmt as { confirmationLevel?: string }).confirmationLevel || (stmt as { confirmation?: string }).confirmation || 'CONFIRMED';

        insertStatement.run(
          revisionId,
          stmt.statementId,
          factId,
          analysis.analysisId,
          stmt.targetOsId || null,
          subjectType,
          stmt.polarity,
          stmt.authorRole,
          stmt.authorName,
          stmt.messageId,
          eventTimestamp,
          stmt.rawExcerpt,
          confLevel,
          stmt.serviceScope || null,
          stmt.budgetVersion || null,
          monetaryCents,
          stmt.delayCauseReported || null,
          stmt.partReference?.partName || null,
          stmt.partReference?.partCode || null,
          stmt.partReference?.quantityRequested || null,
          stmt.partReference?.quantityArrived || null,
          stmt.partReference?.orderRef || null,
          stmt.supersedesFactId || null
        );
      }

      // 4. Inserir lacunas
      const insertGap = this.db.prepare(`
        INSERT INTO hydra_lacunas_conversa (
          gap_id, revision_id, analysis_id, conversation_id, gap_type,
          message_id, event_timestamp, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const gapsList = analysis.gaps || [];
      for (const gap of gapsList) {
        const gapTimestamp = (gap as { eventTimestamp?: string }).eventTimestamp || (gap as { timestamp?: string }).timestamp || (gap as { firstDetectedAt?: string }).firstDetectedAt || new Date().toISOString();
        insertGap.run(
          gap.gapId,
          revisionId,
          analysis.analysisId,
          (gap as { conversationId?: number }).conversationId || analysis.conversationId,
          gap.gapType,
          gap.messageId || null,
          gapTimestamp,
          gap.description
        );
      }

      // 5. Agendar no Outbox na mesma transação atômica
      this.outboxManager.enqueue(revisionId, analysis.analysisId, analysis.lojaSlug);
    });

    recordTx();

    return {
      revisionId,
      projectionQueued: true
    };
  }
}
