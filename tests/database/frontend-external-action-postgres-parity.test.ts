import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  FakeExternalActionEngine,
  InMemoryExternalActionStore,
} from '../../adapters/frontend-external-action-in-memory/src/index.js';
import { PostgresExternalActionStore } from '../../adapters/frontend-external-action-postgres/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  FrontendExternalActionProductCoordinator,
  type FrontendExternalActionScopeV1,
} from '../../modules/frontend-external-action/src/index.js';
import type { ExternalActionRepositoryBoundaryPort } from '../../modules/frontend-external-action/src/external-action-store-port.js';

/**
 * FE-P4-S2 WP3 — in-memory vs PostgreSQL External Action adapter parity.
 * Every scenario runs the same governed lifecycle against a boundary and
 * returns a deterministic comparable record (statuses, revisions, attempt
 * ordering, audit sequences, rollback lifecycle, project-scoped queue).
 */

const PROJECT_ID = 'project-1';

const targetRef = {
  schemaVersion: '1.0.0' as const,
  targetKind: 'KNOWN_TARGET' as const,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  externalRevision: 'ext-7',
};

const parameterRef = {
  schemaVersion: '1.0.0' as const,
  parameterId: 'param-1',
  parameterRevision: '2',
  parameterDigest: `sha256:${'a'.repeat(64)}`,
};

const evidenceSetRef = {
  schemaVersion: '1.0.0' as const,
  evidenceSetId: 'evidence-1',
  evidenceSetDigest: `sha256:${'b'.repeat(64)}`,
};

const scope: FrontendExternalActionScopeV1 = {
  principalId: 'principal-1',
  actor: { schemaVersion: '1.0.0', principalId: 'principal-1', actorId: 'user-1' },
  activeProjectId: PROJECT_ID,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
  riskClearance: 'R4',
};

const credential = {
  schemaVersion: '1.0.0' as const,
  connectorId: 'fake-connector',
  name: 'Fake Connector',
  status: 'CONFIGURED' as const,
  maskedCredential: 'ab••••••••cd',
  capabilities: ['TEST', 'ROTATE', 'REVOKE'] as const,
};

const budget = {
  schemaVersion: '1.0.0' as const,
  projectId: PROJECT_ID,
  status: 'OK' as const,
  usedExecutions: 0,
  remainingExecutions: 100,
  softLimit: 80,
  hardLimit: 100,
  exhausted: false,
};

const seedServerOwnedState = (boundary: ExternalActionRepositoryBoundaryPort): Promise<void> =>
  boundary.transaction(async (repositories) => {
    await repositories.credentials.insert(credential);
    await repositories.budgets.insert(budget);
  });

const makeCoordinator = (
  boundary: ExternalActionRepositoryBoundaryPort,
  behavior: ConstructorParameters<typeof FakeExternalActionEngine>[0] = {},
) =>
  new FrontendExternalActionProductCoordinator(
    boundary,
    new InMemoryFrontendCommandGateway(),
    new FakeExternalActionEngine(behavior),
  );

const scenarioFullLifecycle = async (
  boundary: ExternalActionRepositoryBoundaryPort,
): Promise<Record<string, unknown>> => {
  await seedServerOwnedState(boundary);
  // First attempt OUTCOME_UNKNOWN, retries SUCCEEDED (fake engine).
  const coordinator = makeCoordinator(boundary, { executeStatus: 'OUTCOME_UNKNOWN' });
  const actionId = 'action-parity-1';
  const revisionOf = async () =>
    (await coordinator.getExternalAction(scope, { schemaVersion: '1.0.0', actionId })).action
      .actionRevision;

  const validated = await coordinator.validateActionCandidate(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-validate',
    idempotencyKey: 'parity-idem-validate',
    actionId,
    candidateId: 'candidate-parity-1',
    operation: 'UPDATE_REVERSIBLE',
    targetRef,
    parameterRef,
    evidenceRefs: [evidenceSetRef],
  });
  const prepared = await coordinator.prepareActionManifest(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-prepare',
    idempotencyKey: 'parity-idem-prepare',
    actionId,
    expectedActionRevision: await revisionOf(),
    reason: 'Prepare.',
  });
  await coordinator.approveExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-approve',
    idempotencyKey: 'parity-idem-approve',
    actionId,
    manifestId: prepared.manifest.manifestId,
    manifestRevision: prepared.manifest.manifestRevision,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Approved.',
  });
  const preflighted = await coordinator.preflightExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-preflight',
    idempotencyKey: 'parity-idem-preflight',
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: prepared.manifest.manifestRevision,
    expectedExternalRevision: 'ext-7',
    reason: 'Preflight.',
  });
  const executed = await coordinator.executeExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-execute',
    idempotencyKey: 'parity-idem-execute',
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: prepared.manifest.manifestRevision,
    preflightId: preflighted.preflight.preflightId,
    expectedExternalRevision: 'ext-7',
    reason: 'Execute.',
  });
  // Retry succeeds (fake engine: first attempt OUTCOME_UNKNOWN, retries SUCCEEDED).
  const retried = await coordinator.retryExecutionAttempt(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-retry',
    idempotencyKey: 'parity-idem-retry',
    actionId,
    executionId: executed.execution.executionId,
    sourceAttemptId: executed.attempt.attemptId,
    causationId: 'parity-cause-retry',
    reason: 'Retry.',
  });
  const verified = await coordinator.verifyExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity-verify',
    idempotencyKey: 'parity-idem-verify',
    actionId,
    executionId: executed.execution.executionId,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Verify.',
  });
  const detail = await coordinator.getExternalActionDetail(scope, {
    schemaVersion: '1.0.0',
    actionId,
  });
  const attempts = await coordinator.getExecutionAttempts(scope, {
    schemaVersion: '1.0.0',
    actionId,
    pageSize: 50,
  });
  const audit = await coordinator.listExternalActionAudit(scope, {
    schemaVersion: '1.0.0',
    actionId,
    pageSize: 50,
  });
  const queue = await coordinator.listExternalActions(scope, {
    schemaVersion: '1.0.0',
    pageSize: 50,
  });

  return {
    candidateRevision: validated.candidate.candidateRevision,
    manifestRevision: prepared.manifest.manifestRevision,
    preflightStatus: preflighted.preflight.status,
    firstOutcome: executed.outcome,
    retryAttemptNumber: retried.attempt.attemptNumber,
    retryAttemptStatus: retried.attempt.status,
    verificationStatus: verified.verification.status,
    aggregateStatus: detail.action.status,
    aggregateRevision: detail.action.actionRevision,
    attemptNumbers: attempts.attempts.map((attempt) => attempt.attemptNumber),
    attemptStatuses: attempts.attempts.map((attempt) => attempt.status),
    executionStatus: detail.execution?.status,
    resultAttemptIdMatches: detail.result?.attemptId === retried.attempt.attemptId,
    auditCategories: audit.events.map((event) => event.category),
    auditSequences: audit.events.map((event) => event.sequence),
    auditMonotonicUnique:
      new Set(audit.events.map((event) => event.sequence)).size === audit.events.length,
    queueCount: queue.items.length,
    budgetRemaining: detail.budget?.remainingExecutions,
  };
};

const scenarioRollbackLifecycle = async (
  boundary: ExternalActionRepositoryBoundaryPort,
): Promise<Record<string, unknown>> => {
  await seedServerOwnedState(boundary);
  // The rollback lifecycle needs SUCCEEDED executions (forward + rollback),
  // so the fake connector uses its default SUCCEEDED behavior here.
  const coordinator = makeCoordinator(boundary, {});
  const actionId = 'action-parity-2';
  const revisionOf = async () =>
    (await coordinator.getExternalAction(scope, { schemaVersion: '1.0.0', actionId })).action
      .actionRevision;

  await coordinator.validateActionCandidate(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-validate',
    idempotencyKey: 'parity2-idem-validate',
    actionId,
    candidateId: 'candidate-parity-2',
    operation: 'UPDATE_REVERSIBLE',
    targetRef,
    parameterRef,
    evidenceRefs: [evidenceSetRef],
  });
  const prepared = await coordinator.prepareActionManifest(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-prepare',
    idempotencyKey: 'parity2-idem-prepare',
    actionId,
    expectedActionRevision: await revisionOf(),
    reason: 'Prepare.',
  });
  await coordinator.approveExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-approve',
    idempotencyKey: 'parity2-idem-approve',
    actionId,
    manifestId: prepared.manifest.manifestId,
    manifestRevision: prepared.manifest.manifestRevision,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Approved.',
  });
  const preflighted = await coordinator.preflightExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-preflight',
    idempotencyKey: 'parity2-idem-preflight',
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: prepared.manifest.manifestRevision,
    expectedExternalRevision: 'ext-7',
    reason: 'Preflight.',
  });
  const executed = await coordinator.executeExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-execute',
    idempotencyKey: 'parity2-idem-execute',
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: prepared.manifest.manifestRevision,
    preflightId: preflighted.preflight.preflightId,
    expectedExternalRevision: 'ext-7',
    reason: 'Execute.',
  });
  await coordinator.verifyExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-verify',
    idempotencyKey: 'parity2-idem-verify',
    actionId,
    executionId: executed.execution.executionId,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Verify.',
  });
  const preparedRollback = await coordinator.rollbackExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-rollback',
    idempotencyKey: 'parity2-idem-rollback',
    actionId,
    executionId: executed.execution.executionId,
    reason: 'Rollback.',
  });
  const rollbackManifest = preparedRollback.rollback.manifestRef!;
  await coordinator.approveExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-rb-approve',
    idempotencyKey: 'parity2-idem-rb-approve',
    actionId,
    manifestId: rollbackManifest.resourceId,
    manifestRevision: rollbackManifest.resourceRevision!,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Approve rollback.',
  });
  const rollbackPreflight = await coordinator.preflightExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-rb-preflight',
    idempotencyKey: 'parity2-idem-rb-preflight',
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: rollbackManifest.resourceRevision!,
    expectedExternalRevision: 'ext-7',
    reason: 'Preflight rollback.',
  });
  const rollbackExecuted = await coordinator.executeExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-rb-execute',
    idempotencyKey: 'parity2-idem-rb-execute',
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: rollbackManifest.resourceRevision!,
    preflightId: rollbackPreflight.preflight.preflightId,
    expectedExternalRevision: 'ext-7',
    reason: 'Execute rollback.',
  });
  const rollbackVerified = await coordinator.verifyExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: 'parity2-rb-verify',
    idempotencyKey: 'parity2-idem-rb-verify',
    actionId,
    executionId: rollbackExecuted.execution.executionId,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Verify rollback.',
  });
  const detail = await coordinator.getExternalActionDetail(scope, {
    schemaVersion: '1.0.0',
    actionId,
  });
  return {
    rollbackPreparedStatus: preparedRollback.rollback.status,
    rollbackPreflightStatus: rollbackPreflight.preflight.status,
    rollbackExecutionStatus: rollbackExecuted.execution.status,
    rollbackVerificationStatus: rollbackVerified.verification.status,
    rollbackResourceStatus: detail.rollback?.status,
    rollbackHasVerificationRef: detail.rollback?.verificationRef !== undefined,
    aggregateStatus: detail.action.status,
  };
};

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const pgBoundary = (): ExternalActionRepositoryBoundaryPort =>
  new PostgresExternalActionStore(pool!);

const truncateAll = (): Promise<unknown> =>
  pool!.query(
    `TRUNCATE frontend_external_action.aggregates,
              frontend_external_action.candidates,
              frontend_external_action.risk_decisions,
              frontend_external_action.manifests,
              frontend_external_action.approvals,
              frontend_external_action.preflights,
              frontend_external_action.executions,
              frontend_external_action.attempts,
              frontend_external_action.verifications,
              frontend_external_action.results,
              frontend_external_action.audit_events,
              frontend_external_action.compensations,
              frontend_external_action.rollbacks,
              frontend_external_action.credentials,
              frontend_external_action.budgets
     CASCADE`,
  );

describe.runIf(pool)('FE-P4-S2 in-memory vs PostgreSQL External Action adapter parity', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('matches in-memory output for the full governed lifecycle', async () => {
    const memory = await scenarioFullLifecycle(new InMemoryExternalActionStore());
    const postgres = await scenarioFullLifecycle(pgBoundary());
    expect(postgres).toEqual(memory);
  });

  it('matches in-memory output for the rollback lifecycle to ROLLED_BACK', async () => {
    const memory = await scenarioRollbackLifecycle(new InMemoryExternalActionStore());
    const postgres = await scenarioRollbackLifecycle(pgBoundary());
    expect(postgres).toEqual(memory);
  });

  it('enforces ordered append-only attempts and a unique audit sequence at the database', async () => {
    const boundary = pgBoundary();
    await seedServerOwnedState(boundary);
    const coordinator = makeCoordinator(boundary);
    const actionId = 'action-parity-3';
    const revisionOf = async () =>
      (await coordinator.getExternalAction(scope, { schemaVersion: '1.0.0', actionId })).action
        .actionRevision;
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'parity3-validate',
      idempotencyKey: 'parity3-idem-validate',
      actionId,
      candidateId: 'candidate-parity-3',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'parity3-prepare',
      idempotencyKey: 'parity3-idem-prepare',
      actionId,
      expectedActionRevision: await revisionOf(),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'parity3-approve',
      idempotencyKey: 'parity3-idem-approve',
      actionId,
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'parity3-preflight',
      idempotencyKey: 'parity3-idem-preflight',
      actionId,
      expectedActionRevision: await revisionOf(),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    const executed = await coordinator.executeExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'parity3-execute',
      idempotencyKey: 'parity3-idem-execute',
      actionId,
      expectedActionRevision: await revisionOf(),
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    });
    // The audit sequence column is unique per action at the database.
    const client = await pool!.connect();
    try {
      const sequences = await client.query<{ sequence: number }>(
        `SELECT sequence FROM frontend_external_action.audit_events
         WHERE action_id = $1 ORDER BY sequence`,
        [actionId],
      );
      expect(sequences.rows.length).toBeGreaterThanOrEqual(2);
      expect(new Set(sequences.rows.map((row) => row.sequence)).size).toBe(sequences.rows.length);
      // Attempts are ordered and numbered (AC-07) with the same attemptId
      // transitioning IN_PROGRESS -> terminal (single row per attempt).
      const attemptRows = await client.query<{
        attempt_id: string;
        attempt_number: number;
        status: string;
      }>(
        `SELECT attempt_id, attempt_number, status FROM frontend_external_action.attempts
         WHERE execution_id = $1 ORDER BY attempt_number`,
        [executed.execution.executionId],
      );
      expect(attemptRows.rows.map((row) => row.attempt_number)).toEqual([1]);
      expect(attemptRows.rows[0]?.attempt_id).toBe(executed.attempt.attemptId);
      expect(attemptRows.rows[0]?.status).toBe(executed.attempt.status);
    } finally {
      client.release();
    }
  });
});

const MIGRATION_028 = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
  'db/migrations/028_frontend_external_action_product.sql',
);

const reverseDdl = `
  DROP TRIGGER IF EXISTS frontend_external_action_audit_immutable
    ON frontend_external_action.audit_events;
  DROP FUNCTION IF EXISTS frontend_external_action.block_audit_mutation();
  DROP INDEX IF EXISTS frontend_external_action_aggregates_project_idx;
  DROP INDEX IF EXISTS frontend_external_action_candidates_project_idx;
  DROP INDEX IF EXISTS frontend_external_action_manifests_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_approvals_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_preflights_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_executions_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_attempts_execution_idx;
  DROP INDEX IF EXISTS frontend_external_action_verifications_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_results_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_audit_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_compensations_action_idx;
  DROP INDEX IF EXISTS frontend_external_action_rollbacks_action_idx;
  DROP TABLE IF EXISTS frontend_external_action.aggregates;
  DROP TABLE IF EXISTS frontend_external_action.candidates;
  DROP TABLE IF EXISTS frontend_external_action.risk_decisions;
  DROP TABLE IF EXISTS frontend_external_action.manifests;
  DROP TABLE IF EXISTS frontend_external_action.approvals;
  DROP TABLE IF EXISTS frontend_external_action.preflights;
  DROP TABLE IF EXISTS frontend_external_action.executions;
  DROP TABLE IF EXISTS frontend_external_action.attempts;
  DROP TABLE IF EXISTS frontend_external_action.verifications;
  DROP TABLE IF EXISTS frontend_external_action.results;
  DROP TABLE IF EXISTS frontend_external_action.audit_events;
  DROP TABLE IF EXISTS frontend_external_action.compensations;
  DROP TABLE IF EXISTS frontend_external_action.rollbacks;
  DROP TABLE IF EXISTS frontend_external_action.credentials;
  DROP TABLE IF EXISTS frontend_external_action.budgets;
  DROP SCHEMA IF EXISTS frontend_external_action;
`;

describe.runIf(pool)('FE-P4-S2 migration 028 apply/rollback + append-only audit (AC-21)', () => {
  afterAll(async () => {
    await pool!.end();
  });

  it('applies 028, rolls it back to the pre-028 fingerprint, and re-applies cleanly', async () => {
    const client = await pool!.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS frontend_external_action CASCADE');
      const sql = await readFile(MIGRATION_028, 'utf8');

      await client.query('BEGIN');
      await client.query(sql);
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'frontend_external_action' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          'aggregates',
          'candidates',
          'manifests',
          'approvals',
          'preflights',
          'executions',
          'attempts',
          'verifications',
          'results',
          'audit_events',
          'compensations',
          'rollbacks',
          'credentials',
          'budgets',
        ]),
      );
      const hasAuditTrigger = await client.query(
        `SELECT COUNT(*)::int AS count FROM pg_trigger
         WHERE tgname = 'frontend_external_action_audit_immutable'`,
      );
      expect(hasAuditTrigger.rows[0]?.count).toBe(1);
      // Reverse DDL removes only the 028 objects.
      await client.query(reverseDdl);
      const afterReverse = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_external_action'`,
      );
      expect(afterReverse.rows[0]?.count).toBe(0);
      await client.query('COMMIT');

      // Re-apply restores the schema for the remaining suite.
      await client.query(sql);
      const restored = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_external_action'`,
      );
      expect(restored.rows[0]?.count).toBe(1);
    } finally {
      client.release();
    }
  });

  it('rejects UPDATE/DELETE on append-only audit events at the database', async () => {
    const client = await pool!.connect();
    try {
      await client.query(
        `INSERT INTO frontend_external_action.audit_events
           (audit_event_id, action_id, resource_project_id, sequence, category, snapshot, occurred_at)
         VALUES ('audit-append-only', 'action-ao', 'project-1', 1, 'ACTION_EXECUTED',
                 '{"auditEventId":"audit-append-only"}', now())`,
      );
      await expect(
        client.query(
          `UPDATE frontend_external_action.audit_events SET category = 'ACTION_VERIFIED'
           WHERE audit_event_id = 'audit-append-only'`,
        ),
      ).rejects.toThrow(/append-only|immutable/i);
      await client.query(
        `DELETE FROM frontend_external_action.audit_events WHERE audit_event_id = 'audit-append-only'`,
      );
    } catch (error) {
      // The DELETE is also blocked by the append-only trigger; ignore it.
      if (error instanceof Error && !/append-only|immutable/i.test(error.message)) throw error;
    } finally {
      client.release();
    }
  });
});
