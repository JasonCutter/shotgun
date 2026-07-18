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
import type {
  ActionCandidateRepositoryPort,
  ActionExecutionRepositoryPort,
  ActionTransition,
} from '../../../modules/action-execution/src/index.js';

type ExecutionRow = { readonly record_json: ActionExecutionRecord };
type AuditRow = { readonly event_json: ActionAuditEvent };
type CandidateRow = { readonly candidate_json: ServerActionCandidate };

const normalizedTimestamp = (value: string | Date): string | undefined => {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
};

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

export class PostgresActionExecutionRepository implements ActionExecutionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
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
    });
  }

  async approve(
    projectId: string,
    actionId: string,
    expectedPreviewDigest: string,
    approval: ActionApprovalRecord,
  ): Promise<ActionExecutionRecord> {
    return this.transaction(async (client) => {
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
    });
  }

  async claimForExecution(
    projectId: string,
    approvalId: string,
    now: string,
    actorId: string,
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord }> {
    return this.transaction(async (client) => {
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

      const recordWithSnapshot: ActionExecutionRecord = { ...current, preview: snapshot, approval };
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
    });
  }

  async transition(
    projectId: string,
    actionId: string,
    transition: ActionTransition,
  ): Promise<ActionExecutionRecord> {
    return this.transaction(async (client) => {
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
    });
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

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
