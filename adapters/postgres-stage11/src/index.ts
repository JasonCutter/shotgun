import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  ActionApprovalRecord,
  ActionAuditEvent,
  ActionExecutionRecord,
  ServerActionCandidate,
} from '../../../packages/contracts/src/index.js';
import {
  ShotgunError,
  actionPreviewDigest,
  type ActionPreview,
  stableJson,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  ActionCandidateRepositoryPort,
  ActionExecutionRepositoryPort,
  ActionTransition,
} from '../../../modules/action-execution/src/index.js';
import type {
  ActionFeedbackReviewRepositoryPort,
  ActionReviewWorkItem,
} from '../../../modules/action-feedback-review/src/index.js';

type ExecutionRow = { readonly record_json: ActionExecutionRecord };
type AuditRow = { readonly event_json: ActionAuditEvent };
type CandidateRow = { readonly candidate_json: ServerActionCandidate };
type ActionReviewRow = {
  readonly work_item_id: string;
  readonly project_id: string;
  readonly semantic_key: string;
  readonly action_id: string;
  readonly outcome: ActionReviewWorkItem['outcome'];
  readonly phase: 'ACTION_REVIEW';
  readonly status: 'PENDING';
  readonly evidence_ref: string;
  readonly feedback_occurred_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
};

type ExecutionReadbackRow = ExecutionRow & {
  readonly snapshot_json: ActionPreview;
  readonly snapshot_id: string;
  readonly snapshot_action_id: string;
  readonly snapshot_project_id: string;
  readonly snapshot_digest: string;
  readonly snapshot_expires_at: string | Date;
};

type ApprovalReadbackRow = ExecutionReadbackRow & {
  readonly approval_id: string;
  readonly approval_json: ActionApprovalRecord;
  readonly approval_action_id: string;
  readonly approval_snapshot_id: string;
  readonly approval_snapshot_digest: string;
  readonly approval_expires_at: string | Date;
};

const normalizedTimestamp = (value: string | Date): string | undefined => {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
};

const mapActionReviewRow = (row: ActionReviewRow): ActionReviewWorkItem => {
  const feedbackOccurredAt = normalizedTimestamp(row.feedback_occurred_at);
  const createdAt = normalizedTimestamp(row.created_at);
  const updatedAt = normalizedTimestamp(row.updated_at);
  if (feedbackOccurredAt === undefined || createdAt === undefined || updatedAt === undefined) {
    throw new Error('Action review work item timestamps are invalid.');
  }
  return {
    workItemId: row.work_item_id,
    projectId: row.project_id,
    semanticKey: row.semantic_key,
    actionId: row.action_id,
    outcome: row.outcome,
    phase: row.phase,
    status: row.status,
    evidenceRef: row.evidence_ref,
    feedbackOccurredAt,
    createdAt,
    updatedAt,
  };
};

const isOutcomeUnknown = (error: unknown): error is ShotgunError =>
  error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';

const sameTimestamp = (left: string | Date, right: string | Date): boolean =>
  normalizedTimestamp(left) !== undefined &&
  normalizedTimestamp(left) === normalizedTimestamp(right);

/** Trusted Candidate persistence. No HTTP adapter writes to this port. */
export class PostgresActionCandidateRepository implements ActionCandidateRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async stage(candidate: ServerActionCandidate): Promise<void> {
    await this.pool.query(
      `INSERT INTO action.candidates (project_id, candidate_id, revision_number, candidate_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now(), now())
       ON CONFLICT (project_id, candidate_id) DO UPDATE
       SET revision_number = EXCLUDED.revision_number, candidate_json = EXCLUDED.candidate_json, updated_at = now()
       WHERE action.candidates.revision_number <= EXCLUDED.revision_number`,
      [
        candidate.projectId,
        candidate.candidate.candidateId,
        candidate.candidate.revisionNumber,
        JSON.stringify(candidate),
      ],
    );
  }

  async find(projectId: string, candidateId: string): Promise<ServerActionCandidate | undefined> {
    const result = await this.pool.query<CandidateRow>(
      'SELECT candidate_json FROM action.candidates WHERE project_id = $1 AND candidate_id = $2',
      [projectId, candidateId],
    );
    return result.rows[0]?.candidate_json;
  }
}

export class PostgresActionExecutionRepository
  implements ActionExecutionRepositoryPort, ActionFeedbackReviewRepositoryPort
{
  constructor(private readonly pool: Pool) {}

  async createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord> {
    return this.transaction(
      'create-preview',
      async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${record.projectId}:${record.preview.candidate.candidateId}:${record.preview.candidate.revisionNumber}:${record.preview.operationKey}`,
        ]);
        const existing = await client.query<ExecutionRow>(
          `SELECT record_json FROM action.executions WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = $3`,
          [
            record.projectId,
            record.preview.candidate.candidateId,
            record.preview.candidate.revisionNumber,
          ],
        );
        const current = existing.rows[0]?.record_json;
        if (current) {
          if (current.preview.previewDigest !== record.preview.previewDigest)
            throw stale('The same Action Candidate revision was changed after Preview creation.');
          return current;
        }
        await client.query(
          `INSERT INTO action.executions (action_id, project_id, candidate_id, candidate_revision, candidate_digest, target_digest, parameter_digest, preview_digest, status, record_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
          [
            record.actionId,
            record.projectId,
            record.preview.candidate.candidateId,
            record.preview.candidate.revisionNumber,
            record.preview.candidateDigest,
            record.preview.targetDigest,
            record.preview.parameterDigest,
            record.preview.previewDigest,
            record.status,
            JSON.stringify(record),
            record.createdAt,
            record.updatedAt,
          ],
        );
        await client.query(
          `INSERT INTO action.preview_snapshots (snapshot_id, action_id, project_id, snapshot_digest, expires_at, snapshot_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            record.preview.snapshotId,
            record.actionId,
            record.projectId,
            record.preview.previewDigest,
            record.preview.expiresAt,
            JSON.stringify(record.preview),
            record.preview.createdAt,
          ],
        );
        for (const event of initialAudit) await this.appendAudit(client, event);
        return record;
      },
      (observed) => this.reconcileCreatePreview(record, initialAudit, observed),
    );
  }

  async approve(
    projectId: string,
    actionId: string,
    expectedPreviewDigest: string,
    approval: ActionApprovalRecord,
  ): Promise<ActionExecutionRecord> {
    return this.transaction(
      'approve-action',
      async (client) => {
        const current = await this.lock(client, projectId, actionId);
        if (current.status === 'APPROVED' && current.approval) return current;
        if (
          current.status !== 'PREVIEW_READY' ||
          expectedPreviewDigest !== current.preview.previewDigest ||
          approval.snapshotDigest !== current.preview.previewDigest ||
          approval.snapshotId !== current.preview.snapshotId ||
          approval.expiresAt !== current.preview.expiresAt
        )
          throw stale('Preview Snapshot does not match the Action approval.');
        const next: ActionExecutionRecord = {
          ...current,
          status: 'APPROVED',
          approval,
          updatedAt: approval.approvedAt,
        };
        await client.query(
          `INSERT INTO action.approval_records (approval_id, action_id, snapshot_id, snapshot_digest, approved_by, expires_at, approval_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            approval.approvalId,
            actionId,
            approval.snapshotId,
            approval.snapshotDigest,
            approval.approvedBy.id,
            approval.expiresAt,
            JSON.stringify(approval),
            approval.approvedAt,
          ],
        );
        await this.update(client, next);
        await this.appendAudit(client, {
          actionId,
          projectId,
          category: 'ACTION_APPROVED',
          actorId: approval.approvedBy.id,
          policyVersion: current.preview.riskDecision.policyVersion,
          details: {
            approvalId: approval.approvalId,
            snapshotDigest: approval.snapshotDigest,
            candidateRevision: approval.candidateRevision,
            expiresAt: approval.expiresAt,
          },
          occurredAt: approval.approvedAt,
        });
        return next;
      },
      (observed) => this.reconcileApproval(projectId, observed),
    );
  }

  async claimForExecution(
    projectId: string,
    approvalId: string,
    now: string,
    actorId: string,
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord }> {
    return this.transaction(
      'claim-action-for-execution',
      async (client) => {
        const result = await client.query<{
          record_json: ActionExecutionRecord;
          snapshot_json: ActionPreview;
          approval_json: ActionApprovalRecord;
          approval_snapshot_id: string;
          approval_snapshot_digest: string;
          approval_expires_at: string | Date;
          snapshot_digest: string;
          snapshot_expires_at: string | Date;
        }>(
          `SELECT executions.record_json, snapshots.snapshot_json,
                approvals.approval_json,
                approvals.snapshot_id AS approval_snapshot_id,
                approvals.snapshot_digest AS approval_snapshot_digest,
                approvals.expires_at AS approval_expires_at,
                snapshots.snapshot_digest,
                snapshots.expires_at AS snapshot_expires_at
         FROM action.approval_records approvals
         JOIN action.executions executions ON executions.action_id = approvals.action_id
         JOIN action.preview_snapshots snapshots ON snapshots.snapshot_id = approvals.snapshot_id
         WHERE approvals.approval_id = $1 AND executions.project_id = $2 FOR UPDATE OF executions`,
          [approvalId, projectId],
        );
        const row = result.rows[0];
        if (!row) throw stale('Approval Record is invalid.');

        const current = row.record_json;
        const snapshot = row.snapshot_json;
        const approval = row.approval_json;
        const snapshotExpiry = normalizedTimestamp(snapshot.expiresAt);
        const storedSnapshotExpiry = normalizedTimestamp(row.snapshot_expires_at);
        const approvalExpiry = normalizedTimestamp(approval.expiresAt);
        const storedApprovalExpiry = normalizedTimestamp(row.approval_expires_at);

        if (
          snapshot.actionId !== current.actionId ||
          snapshot.projectId !== projectId ||
          snapshot.snapshotId !== row.approval_snapshot_id ||
          snapshot.previewDigest !== row.snapshot_digest ||
          actionPreviewDigest(snapshot) !== row.snapshot_digest ||
          !snapshotExpiry ||
          !storedSnapshotExpiry ||
          snapshotExpiry !== storedSnapshotExpiry
        ) {
          throw stale('Preview Snapshot integrity compromised.');
        }

        if (
          approval.approvalId !== approvalId ||
          approval.actionId !== current.actionId ||
          approval.snapshotId !== row.approval_snapshot_id ||
          approval.snapshotDigest !== row.approval_snapshot_digest ||
          approval.snapshotDigest !== row.snapshot_digest ||
          !approvalExpiry ||
          !storedApprovalExpiry ||
          approvalExpiry !== storedApprovalExpiry ||
          approvalExpiry !== snapshotExpiry
        ) {
          throw stale('Approval Record does not match the immutable Preview Snapshot.');
        }

        if (
          !current.preview ||
          !current.approval ||
          stableJson(current.preview) !== stableJson(snapshot) ||
          stableJson(current.approval) !== stableJson(approval)
        ) {
          throw stale('Execution projection differs from authoritative immutable records.');
        }

        const recordWithSnapshot: ActionExecutionRecord = {
          ...current,
          preview: snapshot,
          approval,
        };
        if (recordWithSnapshot.status !== 'APPROVED')
          return { claimed: false, record: recordWithSnapshot };
        if (new Date(approval.expiresAt).getTime() <= new Date(now).getTime())
          throw stale('Approval Record has expired.');
        const next: ActionExecutionRecord = {
          ...recordWithSnapshot,
          status: 'EXECUTING',
          updatedAt: now,
        };
        await this.update(client, next);
        await this.appendAudit(client, {
          actionId: current.actionId,
          projectId,
          category: 'ACTION_EXECUTION_CLAIMED',
          actorId,
          policyVersion: current.preview.riskDecision.policyVersion,
          details: { approvalId, snapshotDigest: approval.snapshotDigest, automaticRetry: false },
          occurredAt: now,
        });
        return { claimed: true, record: next };
      },
      (observed) => this.reconcileClaim(projectId, approvalId, actorId, now, observed),
    );
  }

  async transition(
    projectId: string,
    actionId: string,
    transition: ActionTransition,
  ): Promise<ActionExecutionRecord> {
    return this.transaction(
      'transition-action',
      async (client) => {
        const current = await this.lock(client, projectId, actionId);
        if (current.status !== transition.expectedStatus)
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: `Action '${actionId}' moved from ${transition.expectedStatus} to ${current.status}.`,
            module: 'postgres-stage11',
            operation: 'transition-action',
          });
        if (
          transition.next.actionId !== current.actionId ||
          transition.next.projectId !== current.projectId ||
          transition.next.preview.previewDigest !== current.preview.previewDigest
        )
          throw stale('An Action transition cannot change immutable Preview Snapshot identity.');
        await this.update(client, transition.next);
        await this.appendAudit(client, {
          actionId,
          projectId,
          category: transition.category,
          actorId: transition.actorId,
          policyVersion: current.preview.riskDecision.policyVersion,
          details: transition.details,
          occurredAt: transition.next.updatedAt,
        });
        return transition.next;
      },
      (observed) => this.reconcileTransition(projectId, actionId, transition, observed),
    );
  }

  async find(projectId: string, actionId: string): Promise<ActionExecutionRecord | undefined> {
    const result = await this.pool.query<ExecutionRow>(
      'SELECT record_json FROM action.executions WHERE project_id = $1 AND action_id = $2',
      [projectId, actionId],
    );
    return result.rows[0]?.record_json;
  }

  async listAudit(projectId: string, actionId: string): Promise<readonly ActionAuditEvent[]> {
    const result = await this.pool.query<AuditRow>(
      'SELECT event_json FROM action.audit_events WHERE project_id = $1 AND action_id = $2 ORDER BY sequence',
      [projectId, actionId],
    );
    return result.rows.map((row) => row.event_json);
  }

  async upsertFromFeedback(
    input: Parameters<ActionFeedbackReviewRepositoryPort['upsertFromFeedback']>[0],
  ): Promise<ActionReviewWorkItem> {
    return this.transaction(
      'upsert-action-feedback-review',
      async (client) => {
        const owner = await client.query<{ readonly project_id: string }>(
          `SELECT project_id
         FROM action.executions
         WHERE action_id::text = $1
         FOR SHARE`,
          [input.actionId],
        );
        if (owner.rows[0]?.project_id !== input.projectId) {
          throw new ShotgunError({
            code: 'NOT_FOUND',
            safeMessage: 'The Action feedback owner was not found in this project.',
            module: 'stage11.action-feedback-review',
            operation: 'bind-action-feedback-project',
          });
        }
        const result = await client.query<ActionReviewRow>(
          `INSERT INTO action.action_review_work_items
           (work_item_id, project_id, semantic_key, action_id, outcome, phase, status,
            evidence_ref, feedback_occurred_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (project_id, semantic_key) DO NOTHING
         RETURNING work_item_id, project_id, semantic_key, action_id, outcome, phase, status,
                   evidence_ref, feedback_occurred_at, created_at, updated_at`,
          [
            randomUUID(),
            input.projectId,
            input.semanticKey,
            input.actionId,
            input.outcome,
            input.phase,
            'PENDING',
            input.evidenceRef,
            input.feedbackOccurredAt,
            input.now,
          ],
        );
        const row =
          result.rows[0] ??
          (
            await client.query<ActionReviewRow>(
              `SELECT work_item_id, project_id, semantic_key, action_id, outcome, phase, status,
                    evidence_ref, feedback_occurred_at, created_at, updated_at
             FROM action.action_review_work_items
             WHERE project_id = $1 AND semantic_key = $2`,
              [input.projectId, input.semanticKey],
            )
          ).rows[0];
        if (row === undefined) throw new Error('Action review work item could not be persisted.');
        if (row.action_id !== input.actionId || row.outcome !== input.outcome) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'Action feedback semantic identity is already bound to different data.',
            module: 'stage11.action-feedback-review',
            operation: 'upsert-action-review-work-item',
          });
        }
        return mapActionReviewRow(row);
      },
      (observed) => this.reconcileFeedback(input.projectId, input.semanticKey, observed),
    );
  }

  async listByAction(input: {
    readonly projectId: string;
    readonly actionId: string;
    readonly limit: number;
  }): Promise<readonly ActionReviewWorkItem[]> {
    const result = await this.pool.query<ActionReviewRow>(
      `SELECT work_item_id, project_id, semantic_key, action_id, outcome, phase, status,
              evidence_ref, feedback_occurred_at, created_at, updated_at
       FROM action.action_review_work_items
       WHERE project_id = $1 AND action_id = $2
       ORDER BY created_at ASC, work_item_id ASC
       LIMIT $3`,
      [input.projectId, input.actionId, Math.max(1, Math.min(100, input.limit))],
    );
    return result.rows.map(mapActionReviewRow);
  }

  private async transaction<T>(
    operation: string,
    action: (client: PoolClient) => Promise<T>,
    reconcile: (observed: T) => Promise<T | undefined>,
  ): Promise<T> {
    let observed: T | undefined;
    let actionCompleted = false;
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const result = await action(client);
          observed = result;
          actionCompleted = true;
          return result;
        },
        { module: 'postgres-stage11', operation },
      );
    } catch (error) {
      if (!isOutcomeUnknown(error) || !actionCompleted) throw error;
      try {
        const reconciled = await reconcile(observed as T);
        if (reconciled !== undefined) return reconciled;
      } catch {
        // Preserve the original OUTCOME_UNKNOWN when authoritative read-back fails.
      }
      throw error;
    }
  }

  private async readExecutionReadback(
    projectId: string,
    actionId: string,
  ): Promise<ExecutionReadbackRow | undefined> {
    const result = await this.pool.query<ExecutionReadbackRow>(
      `SELECT executions.record_json,
              snapshots.snapshot_json,
              snapshots.snapshot_id,
              snapshots.action_id AS snapshot_action_id,
              snapshots.project_id AS snapshot_project_id,
              snapshots.snapshot_digest,
              snapshots.expires_at AS snapshot_expires_at
       FROM action.executions executions
       JOIN action.preview_snapshots snapshots ON snapshots.action_id = executions.action_id
       WHERE executions.project_id = $1 AND executions.action_id = $2`,
      [projectId, actionId],
    );
    return result.rows[0];
  }

  private async readPreviewReadback(
    projectId: string,
    candidateId: string,
    candidateRevision: number,
  ): Promise<ExecutionReadbackRow | undefined> {
    const result = await this.pool.query<ExecutionReadbackRow>(
      `SELECT executions.record_json,
              snapshots.snapshot_json,
              snapshots.snapshot_id,
              snapshots.action_id AS snapshot_action_id,
              snapshots.project_id AS snapshot_project_id,
              snapshots.snapshot_digest,
              snapshots.expires_at AS snapshot_expires_at
       FROM action.executions executions
       JOIN action.preview_snapshots snapshots ON snapshots.action_id = executions.action_id
       WHERE executions.project_id = $1
         AND executions.candidate_id = $2
         AND executions.candidate_revision = $3`,
      [projectId, candidateId, candidateRevision],
    );
    return result.rows[0];
  }

  private async readApprovalReadback(
    projectId: string,
    actionId: string,
    approvalId: string,
  ): Promise<ApprovalReadbackRow | undefined> {
    const result = await this.pool.query<ApprovalReadbackRow>(
      `SELECT executions.record_json,
              snapshots.snapshot_json,
              snapshots.snapshot_id,
              snapshots.action_id AS snapshot_action_id,
              snapshots.project_id AS snapshot_project_id,
              snapshots.snapshot_digest,
              snapshots.expires_at AS snapshot_expires_at,
              approvals.approval_id,
              approvals.approval_json,
              approvals.action_id AS approval_action_id,
              approvals.snapshot_id AS approval_snapshot_id,
              approvals.snapshot_digest AS approval_snapshot_digest,
              approvals.expires_at AS approval_expires_at
       FROM action.approval_records approvals
       JOIN action.executions executions ON executions.action_id = approvals.action_id
       JOIN action.preview_snapshots snapshots ON snapshots.snapshot_id = approvals.snapshot_id
       WHERE executions.project_id = $1
         AND executions.action_id = $2
         AND approvals.approval_id = $3`,
      [projectId, actionId, approvalId],
    );
    return result.rows[0];
  }

  private matchesExecutionReadback(
    row: ExecutionReadbackRow,
    expected: ActionExecutionRecord,
  ): boolean {
    return (
      stableJson(row.record_json) === stableJson(expected) &&
      row.snapshot_id === expected.preview.snapshotId &&
      row.snapshot_action_id === expected.actionId &&
      row.snapshot_project_id === expected.projectId &&
      row.snapshot_digest === expected.preview.previewDigest &&
      actionPreviewDigest(row.snapshot_json) === row.snapshot_digest &&
      stableJson(row.snapshot_json) === stableJson(expected.preview) &&
      sameTimestamp(row.snapshot_expires_at, expected.preview.expiresAt)
    );
  }

  private async reconcileCreatePreview(
    requested: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
    observed: ActionExecutionRecord,
  ): Promise<ActionExecutionRecord | undefined> {
    const row = await this.readPreviewReadback(
      requested.projectId,
      requested.preview.candidate.candidateId,
      requested.preview.candidate.revisionNumber,
    );
    if (!row || !this.matchesExecutionReadback(row, observed)) return undefined;
    return (await this.hasExactAuditEvents(observed.projectId, observed.actionId, initialAudit))
      ? observed
      : undefined;
  }

  private matchesApprovalReadback(
    row: ApprovalReadbackRow,
    expected: ActionExecutionRecord,
  ): boolean {
    const approval = expected.approval;
    return (
      approval !== undefined &&
      this.matchesExecutionReadback(row, expected) &&
      row.approval_id === approval.approvalId &&
      row.approval_action_id === expected.actionId &&
      row.snapshot_id === approval.snapshotId &&
      row.snapshot_digest === approval.snapshotDigest &&
      row.approval_snapshot_id === approval.snapshotId &&
      row.approval_snapshot_digest === approval.snapshotDigest &&
      stableJson(row.approval_json) === stableJson(approval) &&
      sameTimestamp(row.approval_expires_at, approval.expiresAt) &&
      stableJson(row.snapshot_json) === stableJson(expected.preview)
    );
  }

  private async reconcileApproval(
    projectId: string,
    observed: ActionExecutionRecord,
  ): Promise<ActionExecutionRecord | undefined> {
    const approval = observed.approval;
    if (!approval) return undefined;
    const row = await this.readApprovalReadback(projectId, observed.actionId, approval.approvalId);
    if (!row || !this.matchesApprovalReadback(row, observed)) return undefined;
    const event = {
      actionId: observed.actionId,
      projectId,
      category: 'ACTION_APPROVED' as const,
      actorId: approval.approvedBy.id,
      policyVersion: observed.preview.riskDecision.policyVersion,
      details: {
        approvalId: approval.approvalId,
        snapshotDigest: approval.snapshotDigest,
        candidateRevision: approval.candidateRevision,
        expiresAt: approval.expiresAt,
      },
      occurredAt: approval.approvedAt,
    };
    return (await this.hasExactAuditEvents(projectId, observed.actionId, [event]))
      ? observed
      : undefined;
  }

  private async reconcileClaim(
    projectId: string,
    approvalId: string,
    actorId: string,
    now: string,
    observed: { readonly claimed: boolean; readonly record: ActionExecutionRecord },
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord } | undefined> {
    const row = await this.readApprovalReadback(projectId, observed.record.actionId, approvalId);
    if (!row || !this.matchesApprovalReadback(row, observed.record)) return undefined;
    if (observed.claimed && observed.record.status !== 'EXECUTING') return undefined;
    if (observed.claimed) {
      const event = {
        actionId: observed.record.actionId,
        projectId,
        category: 'ACTION_EXECUTION_CLAIMED' as const,
        actorId,
        policyVersion: observed.record.preview.riskDecision.policyVersion,
        details: {
          approvalId,
          snapshotDigest: observed.record.preview.previewDigest,
          automaticRetry: false,
        },
        occurredAt: now,
      };
      if (!(await this.hasExactAuditEvents(projectId, observed.record.actionId, [event])))
        return undefined;
    }
    return observed;
  }

  private async reconcileTransition(
    projectId: string,
    actionId: string,
    transition: ActionTransition,
    observed: ActionExecutionRecord,
  ): Promise<ActionExecutionRecord | undefined> {
    const row = await this.readExecutionReadback(projectId, actionId);
    if (!row || !this.matchesExecutionReadback(row, observed)) return undefined;
    const event = {
      actionId,
      projectId,
      category: transition.category,
      actorId: transition.actorId,
      policyVersion: observed.preview.riskDecision.policyVersion,
      details: transition.details,
      occurredAt: observed.updatedAt,
    };
    return (await this.hasExactAuditEvents(projectId, actionId, [event])) ? observed : undefined;
  }

  private async hasExactAuditEvents(
    projectId: string,
    actionId: string,
    expected: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<boolean> {
    const result = await this.pool.query<AuditRow>(
      'SELECT event_json FROM action.audit_events WHERE project_id = $1 AND action_id = $2 ORDER BY sequence',
      [projectId, actionId],
    );
    return expected.every(
      (wanted) =>
        result.rows.filter(
          ({ event_json: event }) =>
            event.actionId === wanted.actionId &&
            event.projectId === wanted.projectId &&
            event.category === wanted.category &&
            event.actorId === wanted.actorId &&
            event.policyVersion === wanted.policyVersion &&
            sameTimestamp(event.occurredAt, wanted.occurredAt) &&
            stableJson(event.details) === stableJson(wanted.details),
        ).length === 1,
    );
  }

  private async reconcileFeedback(
    projectId: string,
    semanticKey: string,
    observed: ActionReviewWorkItem,
  ): Promise<ActionReviewWorkItem | undefined> {
    const result = await this.pool.query<ActionReviewRow>(
      `SELECT work_item_id, project_id, semantic_key, action_id, outcome, phase, status,
              evidence_ref, feedback_occurred_at, created_at, updated_at
       FROM action.action_review_work_items
       WHERE project_id = $1 AND semantic_key = $2`,
      [projectId, semanticKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const persisted = mapActionReviewRow(row);
    return stableJson(persisted) === stableJson(observed) ? observed : undefined;
  }

  private async lock(
    client: PoolClient,
    projectId: string,
    actionId: string,
  ): Promise<ActionExecutionRecord> {
    const result = await client.query<ExecutionRow>(
      'SELECT record_json FROM action.executions WHERE project_id = $1 AND action_id = $2 FOR UPDATE',
      [projectId, actionId],
    );
    const record = result.rows[0]?.record_json;
    if (!record)
      throw new ShotgunError({
        code: 'ACTION_REFERENCE_NOT_FOUND',
        safeMessage: `Action '${actionId}' was not found in this project.`,
        module: 'postgres-stage11',
        operation: 'find-action',
      });
    return record;
  }

  private async update(client: PoolClient, record: ActionExecutionRecord): Promise<void> {
    await client.query(
      'UPDATE action.executions SET status = $3, record_json = $4::jsonb, updated_at = $5 WHERE project_id = $1 AND action_id = $2',
      [record.projectId, record.actionId, record.status, JSON.stringify(record), record.updatedAt],
    );
  }

  private async appendAudit(
    client: PoolClient,
    event: Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>,
  ): Promise<void> {
    const sequence = await client.query<{ next_sequence: number }>(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM action.audit_events WHERE action_id = $1',
      [event.actionId],
    );
    const full: ActionAuditEvent = {
      ...event,
      auditEventId: randomUUID(),
      sequence: Number(sequence.rows[0]?.next_sequence ?? 1),
    };
    await client.query(
      'INSERT INTO action.audit_events (audit_event_id, action_id, project_id, sequence, category, event_json, occurred_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [
        full.auditEventId,
        full.actionId,
        full.projectId,
        full.sequence,
        full.category,
        JSON.stringify(full),
        full.occurredAt,
      ],
    );
  }
}

const stale = (message: string): ShotgunError =>
  new ShotgunError({
    code: 'STALE_ACTION_SNAPSHOT',
    safeMessage: message,
    module: 'postgres-stage11',
    operation: 'validate-action-approval',
  });
