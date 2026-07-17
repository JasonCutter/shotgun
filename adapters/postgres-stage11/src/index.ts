import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  ActionApprovalToken,
  ActionAuditEvent,
  ActionExecutionRecord,
} from '../../../packages/contracts/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  ActionExecutionRepositoryPort,
  ActionTransition,
} from '../../../modules/action-execution/src/index.js';

type ExecutionRow = { readonly record_json: ActionExecutionRecord };
type AuditRow = { readonly event_json: ActionAuditEvent };

export class PostgresActionExecutionRepository implements ActionExecutionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${record.projectId}:${record.preview.candidate.candidateId}:${record.preview.candidate.revisionNumber}`,
      ]);
      const existing = await client.query<ExecutionRow>(
        `SELECT record_json FROM action.executions
         WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = $3`,
        [
          record.projectId,
          record.preview.candidate.candidateId,
          record.preview.candidate.revisionNumber,
        ],
      );
      const current = existing.rows[0]?.record_json;
      if (current) {
        if (current.preview.candidateDigest !== record.preview.candidateDigest) {
          throw stale('The same Action candidate revision was changed after preview creation.');
        }
        return current;
      }
      await client.query(
        `INSERT INTO action.executions (
           action_id, project_id, candidate_id, candidate_revision, candidate_digest,
           target_digest, parameter_digest, preview_digest, status, record_json, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
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
      for (const event of initialAudit) await this.appendAudit(client, event);
      return record;
    });
  }

  async approve(
    projectId: string,
    actionId: string,
    expectedPreviewDigest: string,
    approval: ActionApprovalToken,
  ): Promise<ActionExecutionRecord> {
    return this.transaction(async (client) => {
      const current = await this.lock(client, projectId, actionId);
      if (current.status === 'APPROVED' && current.approval) return current;
      if (current.status !== 'PREVIEW_READY') {
        throw stale(`Action '${actionId}' is no longer waiting for approval.`);
      }
      if (
        expectedPreviewDigest !== current.preview.previewDigest ||
        approval.previewDigest !== current.preview.previewDigest ||
        approval.candidateRevision !== current.preview.candidate.revisionNumber ||
        approval.targetDigest !== current.preview.targetDigest ||
        approval.parameterDigest !== current.preview.parameterDigest
      ) {
        throw stale('The Action changed after the displayed Preview was created.');
      }
      const next: ActionExecutionRecord = {
        ...current,
        status: 'APPROVED',
        approval,
        updatedAt: approval.approvedAt,
      };
      await client.query(
        `INSERT INTO action.approvals (
           token_id, action_id, preview_digest, target_digest, parameter_digest,
           candidate_revision, approved_by, approval_json, approved_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          approval.tokenId,
          actionId,
          approval.previewDigest,
          approval.targetDigest,
          approval.parameterDigest,
          approval.candidateRevision,
          approval.approvedBy.id,
          JSON.stringify(approval),
          approval.approvedAt,
          approval.expiresAt,
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
          tokenId: approval.tokenId,
          previewDigest: approval.previewDigest,
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
    actionId: string,
    tokenId: string,
    now: string,
    actorId: string,
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord }> {
    return this.transaction(async (client) => {
      const current = await this.lock(client, projectId, actionId);
      const approval = current.approval;
      if (!approval || approval.tokenId !== tokenId) throw stale('Approval Token is invalid.');
      if (
        approval.previewDigest !== current.preview.previewDigest ||
        approval.targetDigest !== current.preview.targetDigest ||
        approval.parameterDigest !== current.preview.parameterDigest ||
        approval.candidateRevision !== current.preview.candidate.revisionNumber
      ) {
        throw stale('Approval Token does not match the current Action revision and parameters.');
      }
      if (current.status !== 'APPROVED') return { claimed: false, record: current };
      if (new Date(approval.expiresAt).getTime() <= new Date(now).getTime()) {
        throw stale('Approval Token has expired.');
      }
      const next: ActionExecutionRecord = { ...current, status: 'EXECUTING', updatedAt: now };
      await this.update(client, next);
      await this.appendAudit(client, {
        actionId,
        projectId,
        category: 'ACTION_EXECUTION_CLAIMED',
        actorId,
        policyVersion: current.preview.riskDecision.policyVersion,
        details: { tokenId, automaticRetry: false },
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
      if (current.status !== transition.expectedStatus) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: `Action '${actionId}' moved from ${transition.expectedStatus} to ${current.status}.`,
          module: 'postgres-stage11',
          operation: 'transition-action',
        });
      }
      if (
        transition.next.actionId !== current.actionId ||
        transition.next.projectId !== current.projectId ||
        transition.next.preview.previewDigest !== current.preview.previewDigest
      ) {
        throw stale('An Action transition cannot change the approved Preview identity.');
      }
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
      `SELECT event_json FROM action.audit_events
       WHERE project_id = $1 AND action_id = $2 ORDER BY sequence`,
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
      `SELECT record_json FROM action.executions
       WHERE project_id = $1 AND action_id = $2 FOR UPDATE`,
      [projectId, actionId],
    );
    const record = result.rows[0]?.record_json;
    if (!record) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Action '${actionId}' was not found in this project.`,
        module: 'postgres-stage11',
        operation: 'find-action',
      });
    }
    return record;
  }

  private async update(client: PoolClient, record: ActionExecutionRecord): Promise<void> {
    await client.query(
      `UPDATE action.executions
       SET status = $3, record_json = $4::jsonb, updated_at = $5
       WHERE project_id = $1 AND action_id = $2`,
      [record.projectId, record.actionId, record.status, JSON.stringify(record), record.updatedAt],
    );
  }

  private async appendAudit(
    client: PoolClient,
    event: Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>,
  ): Promise<void> {
    const sequence = await client.query<{ next_sequence: number }>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
       FROM action.audit_events WHERE action_id = $1`,
      [event.actionId],
    );
    const full: ActionAuditEvent = {
      ...event,
      auditEventId: randomUUID(),
      sequence: Number(sequence.rows[0]?.next_sequence ?? 1),
    };
    await client.query(
      `INSERT INTO action.audit_events (
         audit_event_id, action_id, project_id, sequence, category, event_json, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
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
    code: 'STALE_APPROVAL',
    safeMessage: message,
    module: 'postgres-stage11',
    operation: 'validate-action-approval',
  });
