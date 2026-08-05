import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  EXTERNAL_ACTION_ATTEMPT_LIST_CAP,
  EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP,
  type ActionAuditEventV1,
  type ActionCandidateV1,
  type ActionManifestV1,
  type CompensatingActionV1,
  type ExecutionAttemptV1,
  type ExecutionV1,
  type ExternalActionApprovalV1,
  type ExternalActionBudgetViewV1,
  type ExternalActionCredentialViewV1,
  type ExternalActionV1,
  type PreflightV1,
  type ResultV1,
  type RiskDecisionV1,
  type RollbackV1,
  type VerificationV1,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  ExternalActionAggregateStorePort,
  ExternalActionApprovalStorePort,
  ExternalActionAttemptStorePort,
  ExternalActionAuditStorePort,
  ExternalActionBudgetStorePort,
  ExternalActionCandidateStorePort,
  ExternalActionCompensationStorePort,
  ExternalActionCredentialStorePort,
  ExternalActionExecutionStorePort,
  ExternalActionManifestStorePort,
  ExternalActionPreflightStorePort,
  ExternalActionRepositoryBoundaryPort,
  ExternalActionResultStorePort,
  ExternalActionRiskDecisionStorePort,
  ExternalActionRollbackStorePort,
  ExternalActionTransactionHandleV1,
  ExternalActionTransactionRepositoriesV1,
  ExternalActionVerificationStorePort,
} from '../../../modules/frontend-external-action/src/external-action-store-port.js';

/**
 * FE-P4-S2 External Action Product PostgreSQL adapter. Mirrors the in-memory
 * adapter's observable semantics exactly (ordered latest lookups, capped
 * collections, monotonic audit sequence, upsert-by-identity writes) over the
 * `frontend_external_action` schema created by migration 028. The authoritative
 * full resource is the `snapshot` jsonb round-trip; scalar columns mirror key
 * fields only for constraints, ordering and project-scoped lookups.
 */

const JSONB_SNAPSHOT = (value: unknown): string => JSON.stringify(value);
/**
 * node-postgres already deserializes `jsonb` columns into JS objects, so the
 * value may arrive as a parsed object. Only string values need JSON.parse.
 */
const PARSE = (value: unknown): unknown => {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
};

type SnapshotRow = QueryResultRow & { readonly snapshot: string | unknown };

const aggregateFrom = (row: SnapshotRow): ExternalActionV1 =>
  PARSE(row.snapshot) as ExternalActionV1;
const candidateFrom = (row: SnapshotRow): ActionCandidateV1 =>
  PARSE(row.snapshot) as ActionCandidateV1;
const riskDecisionFrom = (row: SnapshotRow): RiskDecisionV1 =>
  PARSE(row.snapshot) as RiskDecisionV1;
const manifestFrom = (row: SnapshotRow): ActionManifestV1 =>
  PARSE(row.snapshot) as ActionManifestV1;
const approvalFrom = (row: SnapshotRow): ExternalActionApprovalV1 =>
  PARSE(row.snapshot) as ExternalActionApprovalV1;
const preflightFrom = (row: SnapshotRow): PreflightV1 => PARSE(row.snapshot) as PreflightV1;
const executionFrom = (row: SnapshotRow): ExecutionV1 => PARSE(row.snapshot) as ExecutionV1;
const attemptFrom = (row: SnapshotRow): ExecutionAttemptV1 =>
  PARSE(row.snapshot) as ExecutionAttemptV1;
const verificationFrom = (row: SnapshotRow): VerificationV1 =>
  PARSE(row.snapshot) as VerificationV1;
const resultFrom = (row: SnapshotRow): ResultV1 => PARSE(row.snapshot) as ResultV1;
const auditFrom = (row: SnapshotRow): ActionAuditEventV1 =>
  PARSE(row.snapshot) as ActionAuditEventV1;
const compensationFrom = (row: SnapshotRow): CompensatingActionV1 =>
  PARSE(row.snapshot) as CompensatingActionV1;
const rollbackFrom = (row: SnapshotRow): RollbackV1 => PARSE(row.snapshot) as RollbackV1;
const credentialFrom = (row: SnapshotRow): ExternalActionCredentialViewV1 =>
  PARSE(row.snapshot) as ExternalActionCredentialViewV1;
const budgetFrom = (row: SnapshotRow): ExternalActionBudgetViewV1 =>
  PARSE(row.snapshot) as ExternalActionBudgetViewV1;

export class PostgresExternalActionStore implements ExternalActionRepositoryBoundaryPort {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(
    action: (repositories: ExternalActionTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => action(this.repositories(client)),
      { module: 'frontend-external-action-postgres', operation: 'external-action-transaction' },
    );
  }

  async transactionWithHandle<T>(
    action: (handle: ExternalActionTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => action({ repositories: this.repositories(client), raw: client }),
      { module: 'frontend-external-action-postgres', operation: 'external-action-transaction' },
    );
  }

  private repositories(client: PoolClient): ExternalActionTransactionRepositoriesV1 {
    const aggregate = (row: SnapshotRow | undefined): ExternalActionV1 | undefined =>
      row ? aggregateFrom(row) : undefined;

    const aggregates: ExternalActionAggregateStorePort = {
      find: async (actionId) =>
        aggregate(
          (
            await client.query<SnapshotRow>(
              `SELECT snapshot FROM frontend_external_action.aggregates WHERE action_id = $1`,
              [actionId],
            )
          ).rows[0],
        ),
      findById: async (actionId) =>
        aggregate(
          (
            await client.query<SnapshotRow>(
              `SELECT snapshot FROM frontend_external_action.aggregates WHERE action_id = $1`,
              [actionId],
            )
          ).rows[0],
        ),
      insert: async (action) => {
        await client.query(
          `INSERT INTO frontend_external_action.aggregates
             (action_id, resource_project_id, effective_project_id, status,
              aggregate_state, action_revision, access_revision, policy_context_revision,
              snapshot, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (action_id) DO UPDATE SET
             resource_project_id = EXCLUDED.resource_project_id,
             effective_project_id = EXCLUDED.effective_project_id,
             status = EXCLUDED.status,
             aggregate_state = EXCLUDED.aggregate_state,
             action_revision = EXCLUDED.action_revision,
             access_revision = EXCLUDED.access_revision,
             policy_context_revision = EXCLUDED.policy_context_revision,
             snapshot = EXCLUDED.snapshot,
             updated_at = EXCLUDED.updated_at`,
          [
            action.actionId,
            action.resourceProjectId,
            action.effectiveProjectId,
            action.status,
            action.aggregateState,
            action.actionRevision,
            action.accessRevision,
            action.policyContextRevision,
            JSONB_SNAPSHOT(action),
            action.createdAt,
            action.updatedAt,
          ],
        );
      },
      update: async (action) => {
        await aggregates.insert(action);
      },
      lock: async (actionId) =>
        aggregate(
          (
            await client.query<SnapshotRow>(
              `SELECT snapshot FROM frontend_external_action.aggregates WHERE action_id = $1`,
              [actionId],
            )
          ).rows[0],
        ),
      listByProject: async (resourceProjectId, limit, offset) => {
        const result = await client.query<SnapshotRow>(
          `SELECT snapshot FROM frontend_external_action.aggregates
           WHERE resource_project_id = $1
           ORDER BY updated_at DESC, action_id
           LIMIT $2 OFFSET $3`,
          [resourceProjectId, Math.min(limit, EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP), offset],
        );
        return result.rows.map(aggregateFrom);
      },
    };

    const candidates: ExternalActionCandidateStorePort = {
      find: async (actionId, candidateId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.candidates
             WHERE action_id = $1 AND candidate_id = $2`,
            [actionId, candidateId],
          )
        ).rows[0];
        return row ? candidateFrom(row) : undefined;
      },
      findByActionId: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.candidates
             WHERE action_id = $1 ORDER BY candidate_revision DESC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? candidateFrom(row) : undefined;
      },
      insert: async (candidate) => {
        await client.query(
          `INSERT INTO frontend_external_action.candidates
             (action_id, candidate_id, candidate_revision, resource_project_id,
              candidate_digest, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (action_id, candidate_id) DO UPDATE SET
             candidate_revision = EXCLUDED.candidate_revision,
             resource_project_id = EXCLUDED.resource_project_id,
             candidate_digest = EXCLUDED.candidate_digest,
             snapshot = EXCLUDED.snapshot,
             created_at = EXCLUDED.created_at`,
          [
            candidate.actionId,
            candidate.candidateId,
            candidate.candidateRevision,
            candidate.resourceProjectId,
            candidate.candidateDigest,
            JSONB_SNAPSHOT(candidate),
            candidate.generatedAt,
          ],
        );
      },
    };

    const riskDecisions: ExternalActionRiskDecisionStorePort = {
      find: async (actionId, riskDecisionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.risk_decisions
             WHERE action_id = $1 AND risk_decision_id = $2`,
            [actionId, riskDecisionId],
          )
        ).rows[0];
        return row ? riskDecisionFrom(row) : undefined;
      },
      insert: async (decision) => {
        await client.query(
          `INSERT INTO frontend_external_action.risk_decisions
             (action_id, risk_decision_id, resource_project_id, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (action_id, risk_decision_id) DO UPDATE SET
             resource_project_id = EXCLUDED.resource_project_id,
             snapshot = EXCLUDED.snapshot`,
          [
            decision.actionId,
            decision.riskDecisionId,
            decision.resourceProjectId,
            JSONB_SNAPSHOT(decision),
            decision.decidedAt,
          ],
        );
      },
    };

    const manifests: ExternalActionManifestStorePort = {
      findById: async (manifestId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.manifests WHERE manifest_id = $1`,
            [manifestId],
          )
        ).rows[0];
        return row ? manifestFrom(row) : undefined;
      },
      findCurrent: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.manifests
             WHERE action_id = $1 ORDER BY manifest_revision DESC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? manifestFrom(row) : undefined;
      },
      insert: async (manifest) => {
        await client.query(
          `INSERT INTO frontend_external_action.manifests
             (manifest_id, action_id, resource_project_id, manifest_revision,
              manifest_digest, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (manifest_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             manifest_revision = EXCLUDED.manifest_revision,
             manifest_digest = EXCLUDED.manifest_digest,
             snapshot = EXCLUDED.snapshot`,
          [
            manifest.manifestId,
            manifest.actionId,
            manifest.resourceProjectId,
            manifest.manifestRevision,
            manifest.manifestDigest,
            JSONB_SNAPSHOT(manifest),
            manifest.createdAt,
          ],
        );
      },
      lockCurrent: async (actionId) => manifests.findCurrent(actionId),
    };

    const approvals: ExternalActionApprovalStorePort = {
      findById: async (approvalId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.approvals WHERE approval_id = $1`,
            [approvalId],
          )
        ).rows[0];
        return row ? approvalFrom(row) : undefined;
      },
      findActiveByAction: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.approvals
             WHERE action_id = $1 AND status = 'ACTIVE'
             ORDER BY issued_at DESC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? approvalFrom(row) : undefined;
      },
      insert: async (approval) => {
        await client.query(
          `INSERT INTO frontend_external_action.approvals
             (approval_id, action_id, resource_project_id, status, issued_at, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (approval_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             status = EXCLUDED.status,
             issued_at = EXCLUDED.issued_at,
             snapshot = EXCLUDED.snapshot`,
          [
            approval.approvalId,
            approval.actionId,
            approval.resourceProjectId,
            approval.status,
            approval.issuedAt,
            JSONB_SNAPSHOT(approval),
            approval.issuedAt,
          ],
        );
      },
    };

    const preflights: ExternalActionPreflightStorePort = {
      findById: async (preflightId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.preflights WHERE preflight_id = $1`,
            [preflightId],
          )
        ).rows[0];
        return row ? preflightFrom(row) : undefined;
      },
      findCurrent: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.preflights
             WHERE action_id = $1 ORDER BY run_at DESC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? preflightFrom(row) : undefined;
      },
      insert: async (preflight) => {
        await client.query(
          `INSERT INTO frontend_external_action.preflights
             (preflight_id, action_id, resource_project_id, run_at, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (preflight_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             run_at = EXCLUDED.run_at,
             snapshot = EXCLUDED.snapshot`,
          [
            preflight.preflightId,
            preflight.actionId,
            preflight.resourceProjectId,
            preflight.runAt,
            JSONB_SNAPSHOT(preflight),
            preflight.runAt,
          ],
        );
      },
    };

    const executions: ExternalActionExecutionStorePort = {
      findById: async (executionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.executions WHERE execution_id = $1`,
            [executionId],
          )
        ).rows[0];
        return row ? executionFrom(row) : undefined;
      },
      findCurrent: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.executions
             WHERE action_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? executionFrom(row) : undefined;
      },
      insert: async (execution) => {
        await client.query(
          `INSERT INTO frontend_external_action.executions
             (execution_id, action_id, resource_project_id, status,
              manifest_revision, snapshot, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (execution_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             status = EXCLUDED.status,
             manifest_revision = EXCLUDED.manifest_revision,
             snapshot = EXCLUDED.snapshot,
             updated_at = EXCLUDED.updated_at`,
          [
            execution.executionId,
            execution.actionId,
            execution.resourceProjectId,
            execution.status,
            execution.manifestRevision,
            JSONB_SNAPSHOT(execution),
            execution.startedAt,
            execution.completedAt ?? execution.startedAt,
          ],
        );
      },
      update: async (execution) => {
        await executions.insert(execution);
      },
    };

    const attempts: ExternalActionAttemptStorePort = {
      findByExecution: async (executionId) => {
        const result = await client.query<SnapshotRow>(
          `SELECT snapshot FROM frontend_external_action.attempts
           WHERE execution_id = $1 ORDER BY attempt_number ASC LIMIT $2`,
          [executionId, EXTERNAL_ACTION_ATTEMPT_LIST_CAP],
        );
        return result.rows.map(attemptFrom);
      },
      findById: async (attemptId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.attempts WHERE attempt_id = $1`,
            [attemptId],
          )
        ).rows[0];
        return row ? attemptFrom(row) : undefined;
      },
      insert: async (attempt) => {
        await client.query(
          `INSERT INTO frontend_external_action.attempts
             (attempt_id, execution_id, action_id, resource_project_id,
              attempt_number, status, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (attempt_id) DO UPDATE SET
             execution_id = EXCLUDED.execution_id,
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             attempt_number = EXCLUDED.attempt_number,
             status = EXCLUDED.status,
             snapshot = EXCLUDED.snapshot`,
          [
            attempt.attemptId,
            attempt.executionId,
            attempt.actionId,
            attempt.resourceProjectId,
            attempt.attemptNumber,
            attempt.status,
            JSONB_SNAPSHOT(attempt),
            attempt.startedAt,
          ],
        );
      },
      lockByExecution: async (executionId) => {
        const result = await client.query<SnapshotRow>(
          `SELECT snapshot FROM frontend_external_action.attempts
           WHERE execution_id = $1 ORDER BY attempt_number ASC`,
          [executionId],
        );
        return result.rows.map(attemptFrom);
      },
    };

    const verifications: ExternalActionVerificationStorePort = {
      findById: async (verificationId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.verifications WHERE verification_id = $1`,
            [verificationId],
          )
        ).rows[0];
        return row ? verificationFrom(row) : undefined;
      },
      findCurrent: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.verifications
             WHERE action_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? verificationFrom(row) : undefined;
      },
      insert: async (verification) => {
        await client.query(
          `INSERT INTO frontend_external_action.verifications
             (verification_id, action_id, resource_project_id, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (verification_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             snapshot = EXCLUDED.snapshot`,
          [
            verification.verificationId,
            verification.actionId,
            verification.resourceProjectId,
            JSONB_SNAPSHOT(verification),
            verification.verifiedAt,
          ],
        );
      },
    };

    const results: ExternalActionResultStorePort = {
      findById: async (resultId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.results WHERE result_id = $1`,
            [resultId],
          )
        ).rows[0];
        return row ? resultFrom(row) : undefined;
      },
      findCurrent: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.results
             WHERE action_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? resultFrom(row) : undefined;
      },
      insert: async (result) => {
        await client.query(
          `INSERT INTO frontend_external_action.results
             (result_id, action_id, resource_project_id, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (result_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             snapshot = EXCLUDED.snapshot`,
          [
            result.resultId,
            result.actionId,
            result.resourceProjectId,
            JSONB_SNAPSHOT(result),
            result.completedAt,
          ],
        );
      },
    };

    const audit: ExternalActionAuditStorePort = {
      append: async (event) => {
        await client.query(
          `INSERT INTO frontend_external_action.audit_events
             (audit_event_id, action_id, resource_project_id, sequence, category,
              snapshot, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (audit_event_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             sequence = EXCLUDED.sequence,
             category = EXCLUDED.category,
             snapshot = EXCLUDED.snapshot`,
          [
            event.auditEventId,
            event.actionId,
            event.resourceProjectId,
            event.sequence,
            event.category,
            JSONB_SNAPSHOT(event),
            event.occurredAt,
          ],
        );
      },
      listByAction: async (actionId, limit, offset) => {
        const result = await client.query<SnapshotRow>(
          `SELECT snapshot FROM frontend_external_action.audit_events
           WHERE action_id = $1 ORDER BY sequence ASC
           LIMIT $2 OFFSET $3`,
          [actionId, Math.min(limit, EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP), offset],
        );
        return result.rows.map(auditFrom);
      },
      nextSequence: async (actionId) => {
        const result = await client.query<{ readonly next: string | null }>(
          `SELECT max(sequence)::text AS next
           FROM frontend_external_action.audit_events WHERE action_id = $1`,
          [actionId],
        );
        const max = result.rows[0]?.next;
        return max === null || max === undefined ? 1 : Number(max) + 1;
      },
    };

    const compensations: ExternalActionCompensationStorePort = {
      find: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.compensations
             WHERE action_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? compensationFrom(row) : undefined;
      },
      insert: async (compensation) => {
        await client.query(
          `INSERT INTO frontend_external_action.compensations
             (compensation_id, action_id, resource_project_id, snapshot, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (compensation_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             snapshot = EXCLUDED.snapshot`,
          [
            compensation.compensationId,
            compensation.actionId,
            compensation.resourceProjectId,
            JSONB_SNAPSHOT(compensation),
            compensation.preparedAt,
          ],
        );
      },
    };

    const rollbacks: ExternalActionRollbackStorePort = {
      find: async (actionId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.rollbacks
             WHERE action_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [actionId],
          )
        ).rows[0];
        return row ? rollbackFrom(row) : undefined;
      },
      insert: async (rollback) => {
        await client.query(
          `INSERT INTO frontend_external_action.rollbacks
             (rollback_id, action_id, resource_project_id, status, snapshot, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (rollback_id) DO UPDATE SET
             action_id = EXCLUDED.action_id,
             resource_project_id = EXCLUDED.resource_project_id,
             status = EXCLUDED.status,
             snapshot = EXCLUDED.snapshot,
             updated_at = EXCLUDED.updated_at`,
          [
            rollback.rollbackId,
            rollback.actionId,
            rollback.resourceProjectId,
            rollback.status,
            JSONB_SNAPSHOT(rollback),
            rollback.updatedAt,
            rollback.updatedAt,
          ],
        );
      },
      update: async (rollback) => {
        await rollbacks.insert(rollback);
      },
    };

    const credentials: ExternalActionCredentialStorePort = {
      findByConnector: async (connectorId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.credentials WHERE connector_id = $1`,
            [connectorId],
          )
        ).rows[0];
        return row ? credentialFrom(row) : undefined;
      },
      insert: async (credential) => {
        await client.query(
          `INSERT INTO frontend_external_action.credentials (connector_id, snapshot, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (connector_id) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
          [credential.connectorId, JSONB_SNAPSHOT(credential), new Date().toISOString()],
        );
      },
    };

    const budgets: ExternalActionBudgetStorePort = {
      findByProject: async (projectId) => {
        const row = (
          await client.query<SnapshotRow>(
            `SELECT snapshot FROM frontend_external_action.budgets WHERE project_id = $1`,
            [projectId],
          )
        ).rows[0];
        return row ? budgetFrom(row) : undefined;
      },
      insert: async (budget) => {
        await client.query(
          `INSERT INTO frontend_external_action.budgets (project_id, snapshot, created_at, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
          [
            budget.projectId,
            JSONB_SNAPSHOT(budget),
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        );
      },
      update: async (budget) => {
        await budgets.insert(budget);
      },
    };

    return {
      aggregates,
      candidates,
      riskDecisions,
      manifests,
      approvals,
      preflights,
      executions,
      attempts,
      verifications,
      results,
      audit,
      compensations,
      rollbacks,
      credentials,
      budgets,
    };
  }
}
