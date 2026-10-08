/**
 * Hydra — Gerenciador de Outbox de Projeção com Claim Token e Lease
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 2 (Dados e Persistência)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export interface OutboxJobRecord {
  readonly jobId: string;
  readonly revisionId: string;
  readonly analysisId: string;
  readonly lojaSlug: string;
  readonly status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly workerId?: string;
  readonly claimToken?: string;
  readonly claimedAt?: string;
  readonly leaseExpiresAt?: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly processedAt?: string;
}

export class AnalysisProjectionOutboxManager {
  constructor(private readonly db: Database.Database) {}

  /**
   * Enfileira um novo trabalho de projeção de forma idempotente.
   */
  public enqueue(
    revisionId: string,
    analysisId: string,
    lojaSlug: string,
    projectionVersion = 1
  ): string {
    const jobId = `outbox:${revisionId}:v${projectionVersion}`;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO hydra_analysis_projection_outbox (
        job_id, revision_id, analysis_id, loja_slug, status, attempts, max_attempts
      ) VALUES (?, ?, ?, ?, 'PENDING', 0, 5)
    `);

    stmt.run(jobId, revisionId, analysisId, lojaSlug);
    return jobId;
  }

  /**
   * Realiza o claim atômico do próximo job elegível garantindo:
   * 1. attempts < max_attempts (A3 - nunca executa a 6ª tentativa)
   * 2. Geração de claimToken exclusivo por claim
   * 3. Lease de 60 segundos
   */
  public claimNextJob(workerId: string, leaseDurationSeconds = 60): OutboxJobRecord | null {
    // 1. Marca jobs que excederam o limite como FAILED imediatamente (A3)
    this.db.prepare(`
      UPDATE hydra_analysis_projection_outbox
      SET status = 'FAILED'
      WHERE attempts >= max_attempts AND status != 'COMPLETED'
    `).run();

    // 2. Busca e reserva atômica dentro de transação imediata
    let claimedJob: OutboxJobRecord | null = null;

    const claimTx = this.db.transaction(() => {
      // Localiza o job mais antigo elegível
      const selectStmt = this.db.prepare(`
        SELECT 
          job_id, revision_id, analysis_id, loja_slug, status,
          worker_id, claim_token, claimed_at, lease_expires_at,
          attempts, max_attempts, error_message, created_at, processed_at
        FROM hydra_analysis_projection_outbox
        WHERE attempts < max_attempts
          AND (
            status = 'PENDING' 
            OR (status = 'PROCESSING' AND lease_expires_at < datetime('now'))
          )
        ORDER BY created_at ASC
        LIMIT 1
      `);

      const row = selectStmt.get() as {
        job_id: string;
        revision_id: string;
        analysis_id: string;
        loja_slug: string;
        status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
        worker_id: string | null;
        claim_token: string | null;
        claimed_at: string | null;
        lease_expires_at: string | null;
        attempts: number;
        max_attempts: number;
        error_message: string | null;
        created_at: string;
        processed_at: string | null;
      } | undefined;

      if (!row) {
        return;
      }

      // Verificação estrita de limite (A3)
      if (row.attempts >= row.max_attempts) {
        this.db.prepare("UPDATE hydra_analysis_projection_outbox SET status = 'FAILED' WHERE job_id = ?").run(row.job_id);
        return;
      }

      const newClaimToken = randomUUID();

      const updateStmt = this.db.prepare(`
        UPDATE hydra_analysis_projection_outbox
        SET status = 'PROCESSING',
            worker_id = ?,
            claim_token = ?,
            claimed_at = datetime('now'),
            lease_expires_at = datetime('now', '+' || ? || ' seconds'),
            attempts = attempts + 1
        WHERE job_id = ?
          AND attempts < max_attempts
          AND (
            status = 'PENDING' 
            OR (status = 'PROCESSING' AND lease_expires_at < datetime('now'))
          )
      `);

      const result = updateStmt.run(workerId, newClaimToken, leaseDurationSeconds, row.job_id);

      if (result.changes > 0) {
        claimedJob = {
          jobId: row.job_id,
          revisionId: row.revision_id,
          analysisId: row.analysis_id,
          lojaSlug: row.loja_slug,
          status: 'PROCESSING',
          workerId,
          claimToken: newClaimToken,
          claimedAt: new Date().toISOString(),
          leaseExpiresAt: new Date(Date.now() + leaseDurationSeconds * 1000).toISOString(),
          attempts: row.attempts + 1,
          maxAttempts: row.max_attempts,
          errorMessage: row.error_message || undefined,
          createdAt: row.created_at,
          processedAt: undefined
        };
      }
    });

    claimTx();
    return claimedJob;
  }

  /**
   * Confirma a conclusão do job (Ack) protegida pelo claimToken (A3).
   * Retorna false se o worker perdeu o lease para outro worker.
   */
  public completeJob(jobId: string, claimToken: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE hydra_analysis_projection_outbox
      SET status = 'COMPLETED',
          processed_at = datetime('now'),
          error_message = NULL
      WHERE job_id = ? AND claim_token = ?
    `);

    const result = stmt.run(jobId, claimToken);
    return result.changes > 0;
  }

  /**
   * Registra falha na execução do job com mensagem de erro.
   * Se attempts >= maxAttempts, transiciona para FAILED.
   */
  public failJob(jobId: string, claimToken: string, errorMessage: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE hydra_analysis_projection_outbox
      SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
          error_message = ?,
          worker_id = NULL,
          claim_token = NULL,
          lease_expires_at = NULL
      WHERE job_id = ? AND claim_token = ?
    `);

    const result = stmt.run(errorMessage, jobId, claimToken);
    return result.changes > 0;
  }
}
