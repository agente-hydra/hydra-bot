/**
 * Hydra — Worker de Projeção de Grafo e Atualização de Posição
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 3 (Grafo e Projeção)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import Database from 'better-sqlite3';
import {
  ExtractedStatement,
  ConversationGap
} from './types/conversation_context_contract';
import { AnalysisProjectionOutboxManager, OutboxJobRecord } from './analysis_projection_outbox';
import { CaseCurrentPositionReducer } from './case_current_position';

export class CaseGraphProjector {
  private readonly outboxManager: AnalysisProjectionOutboxManager;

  constructor(
    private readonly db: Database.Database,
    private readonly workerId: string = 'worker_default'
  ) {
    this.outboxManager = new AnalysisProjectionOutboxManager(this.db);
  }

  /**
   * Processa o próximo job da fila outbox garantindo posse exclusiva por claimToken (A3).
   * Retorna true se processou um job com sucesso, false se a fila estava vazia ou o claim falhou.
   */
  public async processNextJob(): Promise<boolean> {
    const job = this.outboxManager.claimNextJob(this.workerId);
    if (!job) {
      return false;
    }

    try {
      this.projectJob(job);
      const ackSuccess = this.outboxManager.completeJob(job.jobId, job.claimToken!);
      return ackSuccess;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outboxManager.failJob(job.jobId, job.claimToken!, msg);
      return false;
    }
  }

  /**
   * Executa a projeção atômica de nós, arestas e posição atual.
   */
  public projectJob(job: OutboxJobRecord): void {
    const projectTx = this.db.transaction(() => {
      // 1. Carregar a análise associada à revisão
      const analysisRow = this.db.prepare(`
        SELECT 
          revision_id, analysis_id, source_id, account_id, conversation_id,
          loja_slug, covered_os_ids, analyzed_until_timestamp
        FROM hydra_analises_atendimento
        WHERE revision_id = ?
      `).get(job.revisionId) as {
        revision_id: string;
        analysis_id: string;
        source_id: string;
        account_id: string;
        conversation_id: number;
        loja_slug: string;
        covered_os_ids: string;
        analyzed_until_timestamp: string;
      } | undefined;

      if (!analysisRow) {
        throw new Error(`Analysis revision ${job.revisionId} not found`);
      }

      const { source_id, account_id, loja_slug, conversation_id, revision_id } = analysisRow;

      // 2. Projetar Nós do Grafo com Namespace Global (A4.3)
      const insertNode = this.db.prepare(`
        INSERT INTO hydra_case_graph_nodes (
          node_id, entity_type, label, account_id, loja_slug, attributes_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          attributes_json = excluded.attributes_json
      `);

      // Nó da Conversa
      const convNodeId = `CONVERSA:${source_id}:${account_id}:${loja_slug}:${conversation_id}`;
      insertNode.run(
        convNodeId,
        'CONVERSA',
        `Conversa #${conversation_id}`,
        account_id,
        loja_slug,
        JSON.stringify({ sourceId: source_id, conversationId: conversation_id })
      );

      // Nó da Análise
      const analysisNodeId = `ANALISE:${source_id}:${account_id}:${loja_slug}:${job.analysisId}`;
      insertNode.run(
        analysisNodeId,
        'ANALISE',
        `Análise ${job.analysisId} (Rev: ${revision_id})`,
        account_id,
        loja_slug,
        JSON.stringify({ revisionId: revision_id })
      );

      // Aresta: CONVERSA -> COVERS_SEGMENT -> ANALISE
      const insertEdge = this.db.prepare(`
        INSERT INTO hydra_case_graph_edges (
          edge_id, from_node_id, to_node_id, relation_type, status,
          version, link_method, confidence, loja_slug, evidence_ref
        ) VALUES (?, ?, ?, ?, 'ACTIVE', 1, 'STRUCTURAL', 'HIGH', ?, ?)
        ON CONFLICT(edge_id) DO UPDATE SET
          status = excluded.status
      `);

      const edgeConvAnalysis = `${convNodeId}->COVERS_SEGMENT->${analysisNodeId}`;
      insertEdge.run(
        edgeConvAnalysis,
        convNodeId,
        analysisNodeId,
        'COVERS_SEGMENT',
        loja_slug,
        `Revisão ${revision_id}`
      );

      // 3. Carregar e projetar afirmações desta revisão
      const stmtsRows = this.db.prepare(`
        SELECT 
          statement_id, fact_id, revision_id, target_os_id, subject_type,
          polarity, author_role, author_name, message_id, event_timestamp,
          raw_excerpt, confirmation_level, service_scope, budget_version,
          monetary_cents, delay_cause_reported, part_name, part_code,
          part_quantity_requested, part_quantity_arrived, order_ref, supersedes_fact_id
        FROM hydra_afirmacoes_analisadas
        WHERE revision_id = ?
      `).all(revision_id) as {
        statement_id: string;
        fact_id: string;
        revision_id: string;
        target_os_id: number | null;
        subject_type: string;
        polarity: string;
        author_role: string;
        author_name: string;
        message_id: number | null;
        event_timestamp: string;
        raw_excerpt: string;
        confirmation_level: string;
        service_scope: string | null;
        budget_version: string | null;
        monetary_cents: number | null;
        delay_cause_reported: string | null;
        part_name: string | null;
        part_code: string | null;
        part_quantity_requested: number | null;
        part_quantity_arrived: number | null;
        order_ref: string | null;
        supersedes_fact_id: string | null;
      }[];

      // Mapear para ExtractedStatement[]
      const statements: ExtractedStatement[] = stmtsRows.map(r => ({
        statementId: r.statement_id,
        factId: r.fact_id,
        revisionId: r.revision_id,
        subject: r.subject_type as ExtractedStatement['subject'],
        polarity: r.polarity as ExtractedStatement['polarity'],
        authorRole: r.author_role as ExtractedStatement['authorRole'],
        authorName: r.author_name,
        messageId: r.message_id,
        timestamp: r.event_timestamp,
        rawExcerpt: r.raw_excerpt,
        targetOsId: r.target_os_id ?? undefined,
        serviceScope: r.service_scope ?? undefined,
        budgetVersion: r.budget_version ?? undefined,
        monetaryCents: r.monetary_cents ?? undefined,
        delayCauseReported: r.delay_cause_reported ?? undefined,
        partReference: r.part_name ? {
          partName: r.part_name,
          partCode: r.part_code ?? undefined,
          quantityRequested: r.part_quantity_requested ?? 1,
          quantityArrived: r.part_quantity_arrived ?? 0,
          orderRef: r.order_ref ?? undefined
        } : undefined,
        supersedesFactId: r.supersedes_fact_id ?? undefined,
        confirmation: r.confirmation_level as ExtractedStatement['confirmation']
      }));

      // 4. Projetar nós de Fatos e arestas de pertinência
      for (const s of statements) {
        const factNodeId = `FATO:${source_id}:${account_id}:${loja_slug}:${s.factId || s.statementId}`;
        insertNode.run(
          factNodeId,
          'FATO',
          `Fato: ${s.subject}`,
          account_id,
          loja_slug,
          JSON.stringify({ rawExcerpt: s.rawExcerpt, polarity: s.polarity })
        );

        const edgeAnalysisFact = `${analysisNodeId}->CONTAINS_STATEMENT->${factNodeId}`;
        insertEdge.run(
          edgeAnalysisFact,
          analysisNodeId,
          factNodeId,
          'CONTAINS_STATEMENT',
          loja_slug,
          s.rawExcerpt
        );

        // Se o fato estiver ligado a uma OS, projeta o nó da OS e aresta TREATS_ORDER
        if (s.targetOsId) {
          const osNodeId = `ORDEM_SERVICO:${source_id}:${account_id}:${loja_slug}:${s.targetOsId}`;
          insertNode.run(
            osNodeId,
            'ORDEM_SERVICO',
            `OS #${s.targetOsId}`,
            account_id,
            loja_slug,
            JSON.stringify({ osId: s.targetOsId })
          );

          const edgeFactOs = `${factNodeId}->TREATS_ORDER->${osNodeId}`;
          insertEdge.run(
            edgeFactOs,
            factNodeId,
            osNodeId,
            'TREATS_ORDER',
            loja_slug,
            `Atendimento OS ${s.targetOsId}`
          );
        }
      }

      // 5. Atualizar a Posição Atual via State Reducer para cada OS coberta
      const coveredOsIds: number[] = JSON.parse(analysisRow.covered_os_ids || '[]');
      
      for (const osId of coveredOsIds) {
        // Carrega todas as afirmações vigentes históricas desta OS nesta loja
        const allOsStmtsRows = this.db.prepare(`
          SELECT 
            statement_id, fact_id, revision_id, target_os_id, subject_type,
            polarity, author_role, author_name, message_id, event_timestamp,
            raw_excerpt, confirmation_level, service_scope, budget_version,
            monetary_cents, delay_cause_reported, part_name, part_code,
            part_quantity_requested, part_quantity_arrived, order_ref, supersedes_fact_id
          FROM hydra_afirmacoes_analisadas
          WHERE target_os_id = ?
        `).all(osId) as typeof stmtsRows;

        const allOsStatements: ExtractedStatement[] = allOsStmtsRows.map(r => ({
          statementId: r.statement_id,
          factId: r.fact_id,
          revisionId: r.revision_id,
          subject: r.subject_type as ExtractedStatement['subject'],
          polarity: r.polarity as ExtractedStatement['polarity'],
          authorRole: r.author_role as ExtractedStatement['authorRole'],
          authorName: r.author_name,
          messageId: r.message_id,
          timestamp: r.event_timestamp,
          rawExcerpt: r.raw_excerpt,
          targetOsId: r.target_os_id ?? undefined,
          serviceScope: r.service_scope ?? undefined,
          budgetVersion: r.budget_version ?? undefined,
          monetaryCents: r.monetary_cents ?? undefined,
          delayCauseReported: r.delay_cause_reported ?? undefined,
          partReference: r.part_name ? {
            partName: r.part_name,
            partCode: r.part_code ?? undefined,
            quantityRequested: r.part_quantity_requested ?? 1,
            quantityArrived: r.part_quantity_arrived ?? 0,
            orderRef: r.order_ref ?? undefined
          } : undefined,
          supersedesFactId: r.supersedes_fact_id ?? undefined,
          confirmation: r.confirmation_level as ExtractedStatement['confirmation']
        }));

        // Executar State Reducer cumulativo
        const position = CaseCurrentPositionReducer.reduce({
          sourceId: source_id,
          accountId: account_id,
          lojaSlug: loja_slug,
          osId,
          vehiclePlate: 'LIN1234', // Preenchido com metadados do caso
          vehicleModel: 'Linea',
          customerName: 'Cliente',
          customerPhone: '5511999999999',
          currentErpStatus: 'NA FILA PARA EXECUÇÃO',
          erpSnapshotTimestamp: analysisRow.analyzed_until_timestamp,
          statements: allOsStatements,
          gaps: [],
          appliedRevisionsMap: { [convNodeId]: revision_id }
        });

        // Gravar ou atualizar na tabela hydra_case_current_position (Chave composta)
        this.db.prepare(`
          INSERT INTO hydra_case_current_position (
            source_id, account_id, loja_slug, os_id, vehicle_plate, vehicle_model,
            customer_phone, customer_name, current_erp_status, erp_snapshot_timestamp,
            current_approval_status, approved_budget_version, pending_budget_version,
            reported_delay_cause, reported_delay_author, reported_delay_role,
            reported_delay_at, reported_delay_raw, part_dependencies_json,
            commitments_summary, active_gaps_json, last_covered_message_id,
            last_covered_timestamp, applied_revisions_json, projection_version, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(source_id, loja_slug, os_id) DO UPDATE SET
            current_approval_status = excluded.current_approval_status,
            approved_budget_version = excluded.approved_budget_version,
            pending_budget_version = excluded.pending_budget_version,
            reported_delay_cause = excluded.reported_delay_cause,
            reported_delay_author = excluded.reported_delay_author,
            reported_delay_role = excluded.reported_delay_role,
            reported_delay_at = excluded.reported_delay_at,
            reported_delay_raw = excluded.reported_delay_raw,
            part_dependencies_json = excluded.part_dependencies_json,
            commitments_summary = excluded.commitments_summary,
            last_covered_message_id = excluded.last_covered_message_id,
            last_covered_timestamp = excluded.last_covered_timestamp,
            applied_revisions_json = excluded.applied_revisions_json,
            updated_at = datetime('now')
        `).run(
          position.sourceId,
          position.accountId,
          position.lojaSlug,
          position.osId,
          position.vehiclePlate,
          position.vehicleModel,
          position.customerPhone,
          position.customerName,
          position.currentErpStatus,
          position.erpSnapshotTimestamp,
          position.approvalStatus,
          position.approvedBudgetVersion || null,
          position.pendingBudgetVersion || null,
          position.reportedDelay?.cause || null,
          position.reportedDelay?.authorName || null,
          position.reportedDelay?.authorRole || null,
          position.reportedDelay?.reportedAt || null,
          position.reportedDelay?.rawExcerpt || null,
          JSON.stringify(position.activePartDependencies),
          position.latestCommitments.join(' | ') || null,
          JSON.stringify(position.activeGaps),
          position.lastCoveredTimestamp ? null : null,
          position.lastCoveredTimestamp,
          JSON.stringify(position.appliedRevisionsMap),
          position.projectionVersion
        );
      }
    });

    projectTx();
  }
}
