import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  FakeExternalActionEngine,
  InMemoryExternalActionStore,
} from '../../adapters/frontend-external-action-in-memory/src/index.js';
import { PostgresExternalActionStore } from '../../adapters/frontend-external-action-postgres/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  FRONTEND_EXTERNAL_ACTION_API_VERSION,
  FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES,
  frontendExternalActionExecuteDigest,
} from '../../packages/contracts/src/index.js';
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
    // The CURRENT verification/result must be the ROLLBACK's (latest), never
    // the original forward one (Review 4860735262).
    currentVerificationIsRollback:
      detail.verification?.verificationId === rollbackVerified.verification.verificationId,
    currentResultAttemptIsRollback:
      detail.result?.attemptId === rollbackVerified.verification.attemptId,
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

const lifecycleToPreflight = async (
  coordinator: FrontendExternalActionProductCoordinator,
  actionId: string,
  prefix: string,
) => {
  const revisionOf = async () =>
    (await coordinator.getExternalAction(scope, { schemaVersion: '1.0.0', actionId })).action
      .actionRevision;
  await coordinator.validateActionCandidate(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-validate`,
    idempotencyKey: `${prefix}-idem-validate`,
    actionId,
    candidateId: `candidate-${actionId}`,
    operation: 'UPDATE_REVERSIBLE',
    targetRef,
    parameterRef,
    evidenceRefs: [evidenceSetRef],
  });
  const prepared = await coordinator.prepareActionManifest(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-prepare`,
    idempotencyKey: `${prefix}-idem-prepare`,
    actionId,
    expectedActionRevision: await revisionOf(),
    reason: 'Prepare.',
  });
  await coordinator.approveExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-approve`,
    idempotencyKey: `${prefix}-idem-approve`,
    actionId,
    manifestId: prepared.manifest.manifestId,
    manifestRevision: prepared.manifest.manifestRevision,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Approved.',
  });
  const preflighted = await coordinator.preflightExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `${prefix}-preflight`,
    idempotencyKey: `${prefix}-idem-preflight`,
    actionId,
    expectedActionRevision: await revisionOf(),
    manifestRevision: prepared.manifest.manifestRevision,
    expectedExternalRevision: 'ext-7',
    reason: 'Preflight.',
  });
  return { prepared, preflighted, revisionOf };
};

const acceptConnectorCommand = async (
  gateway: PostgresFrontendCommandGateway,
  executeRequest: {
    readonly clientRequestId: string;
    readonly idempotencyKey: string;
    readonly actionId: string;
    readonly expectedActionRevision: number;
    readonly manifestRevision: number;
    readonly preflightId: string;
    readonly expectedExternalRevision: string;
  },
) => {
  const now = new Date().toISOString();
  const accepted = await gateway.accept({
    commandId: `cmd-${executeRequest.clientRequestId}`,
    commandRevision: '1',
    principalId: scope.principalId,
    request: {
      envelopeVersion: '1.0.0',
      commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
      commandSchemaVersion: FRONTEND_EXTERNAL_ACTION_API_VERSION,
      clientRequestId: executeRequest.clientRequestId,
      idempotencyKey: executeRequest.idempotencyKey,
      projectContext: {
        activeProjectId: PROJECT_ID,
        targetProjectId: PROJECT_ID,
        resourceProjectId: PROJECT_ID,
        observedProjectAccessRevision: scope.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: scope.policyContextRevision,
      },
      preconditions: [],
      clientIssuedAt: now,
      payload: { ...executeRequest, schemaVersion: '1.0.0' as const, reason: 'Execute.' },
    },
    commandSemanticDigest: frontendExternalActionExecuteDigest({
      schemaVersion: '1.0.0',
      ...executeRequest,
      reason: 'Execute.',
    }),
    acceptedPolicyContext: {
      policyContextId: 'frontend-external-action-current-policy',
      policyContextRevision: scope.policyContextRevision,
      acceptedAt: now,
    },
    correlationId: `corr-${executeRequest.clientRequestId}`,
    traceId: `trace-${executeRequest.clientRequestId}`,
    receivedAt: now,
    acceptedAt: now,
  });
  return accepted;
};

describe.runIf(pool)(
  'FE-P4-S2 PostgreSQL concurrency + Command Ledger atomicity (Review 4860735262)',
  () => {
    beforeEach(async () => {
      await truncateAll();
      await pool!.query('TRUNCATE frontend_command.command_ledger CASCADE');
    });

    it('serializes concurrent commands on the same action with a real row lock (one wins, one fails stale)', async () => {
      const store = pgBoundary();
      await seedServerOwnedState(store);
      const coordinator = new FrontendExternalActionProductCoordinator(
        store,
        new PostgresFrontendCommandGateway(pool!),
        new FakeExternalActionEngine(),
      );
      const actionId = 'action-concurrent';
      const { prepared, preflighted, revisionOf } = await lifecycleToPreflight(
        coordinator,
        actionId,
        'parity-concurrent',
      );
      const revision = await revisionOf!();
      const buildRequest = (suffix: string) => ({
        schemaVersion: '1.0.0' as const,
        clientRequestId: `parity-concurrent-ex-${suffix}`,
        idempotencyKey: `parity-concurrent-idem-${suffix}`,
        actionId,
        expectedActionRevision: revision,
        manifestRevision: prepared.manifest.manifestRevision,
        preflightId: preflighted.preflight.preflightId,
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      });
      const first = buildRequest('1');
      const second = buildRequest('2');
      // Both start from the SAME aggregate revision; the FOR UPDATE row lock on
      // the aggregate serializes them — exactly one succeeds, the other must see
      // the bumped revision and fail closed with EXTERNAL_ACTION_STALE.
      const results = await Promise.allSettled([
        coordinator.executeExternalAction(scope, first),
        coordinator.executeExternalAction(scope, second),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]?.reason)).toMatch(/stale|revision/i);
    });

    it('reserves the project budget atomically under concurrency (single remaining execution)', async () => {
      const store = pgBoundary();
      await store.transaction(async (repositories) => {
        await repositories.budgets.insert({
          schemaVersion: '1.0.0',
          projectId: 'project-budget',
          status: 'OK',
          usedExecutions: 0,
          remainingExecutions: 1,
          softLimit: 80,
          hardLimit: 100,
          exhausted: false,
        });
      });
      await Promise.all([
        store.transaction((repositories) => repositories.budgets.reserve('project-budget')),
        store.transaction((repositories) => repositories.budgets.reserve('project-budget')),
      ]);
      const final = await store.transaction((repositories) =>
        repositories.budgets.findByProject('project-budget'),
      );
      // Exactly one reservation decremented (used = 1, remaining = 0, exhausted).
      expect(final?.usedExecutions).toBe(1);
      expect(final?.remainingExecutions).toBe(0);
      expect(final?.exhausted).toBe(true);
    });

    it('lets the LAST execution consume the final budget slot through the coordinator, then fails closed', async () => {
      const store = pgBoundary();
      await store.transaction(async (repositories) => {
        await repositories.credentials.insert(credential);
        await repositories.budgets.insert({
          schemaVersion: '1.0.0',
          projectId: PROJECT_ID,
          status: 'OK',
          usedExecutions: 0,
          remainingExecutions: 1,
          softLimit: 80,
          hardLimit: 100,
          exhausted: false,
        });
      });
      const gateway = new PostgresFrontendCommandGateway(pool!);
      const coordinator = new FrontendExternalActionProductCoordinator(
        store,
        gateway,
        new FakeExternalActionEngine(),
      );
      // First action consumes the single remaining execution.
      const first = await lifecycleToPreflight(coordinator, 'action-budget-a', 'parity-budget-a');
      const firstExecuted = await coordinator.executeExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'parity-budget-a-execute',
        idempotencyKey: 'parity-budget-a-idem-execute',
        actionId: 'action-budget-a',
        expectedActionRevision: await first.revisionOf!(),
        manifestRevision: first.prepared.manifest.manifestRevision,
        preflightId: first.preflighted.preflight.preflightId,
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      });
      expect(firstExecuted.execution.status).toBe('SUCCEEDED');
      const budget = await store.transaction((repositories) =>
        repositories.budgets.findByProject(PROJECT_ID),
      );
      expect(budget?.usedExecutions).toBe(1);
      expect(budget?.remainingExecutions).toBe(0);
      expect(budget?.exhausted).toBe(true);
      // A second action with an exhausted budget fails closed.
      const second = await lifecycleToPreflight(coordinator, 'action-budget-b', 'parity-budget-b');
      await expect(
        coordinator.executeExternalAction(scope, {
          schemaVersion: '1.0.0',
          clientRequestId: 'parity-budget-b-execute',
          idempotencyKey: 'parity-budget-b-idem-execute',
          actionId: 'action-budget-b',
          expectedActionRevision: await second.revisionOf!(),
          manifestRevision: second.prepared.manifest.manifestRevision,
          preflightId: second.preflighted.preflight.preflightId,
          expectedExternalRevision: 'ext-7',
          reason: 'Execute.',
        }),
      ).rejects.toThrow(/budget|exhausted|preflight|expiry/i);
    });

    it('serializes concurrent first validations on the same new action (action-id advisory lock)', async () => {
      const store = pgBoundary();
      await seedServerOwnedState(store);
      const gateway = new PostgresFrontendCommandGateway(pool!);
      const coordinator = new FrontendExternalActionProductCoordinator(
        store,
        gateway,
        new FakeExternalActionEngine(),
      );
      // Two concurrent validations with DIFFERENT semantics on the same new
      // action must serialize: the aggregate ends at revision 2 and both risk
      // decisions are present (no lost update, no duplicate revision 1).
      const changedParam = { ...parameterRef, parameterDigest: `sha256:${'e'.repeat(64)}` };
      const results = await Promise.allSettled([
        coordinator.validateActionCandidate(scope, {
          schemaVersion: '1.0.0',
          clientRequestId: 'parity-validate-concurrent-1',
          idempotencyKey: 'parity-validate-idem-1',
          actionId: 'action-validate-concurrent',
          candidateId: 'candidate-vc',
          operation: 'UPDATE_REVERSIBLE',
          targetRef,
          parameterRef,
          evidenceRefs: [evidenceSetRef],
        }),
        coordinator.validateActionCandidate(scope, {
          schemaVersion: '1.0.0',
          clientRequestId: 'parity-validate-concurrent-2',
          idempotencyKey: 'parity-validate-idem-2',
          actionId: 'action-validate-concurrent',
          candidateId: 'candidate-vc',
          operation: 'UPDATE_REVERSIBLE',
          targetRef,
          parameterRef: changedParam,
          evidenceRefs: [evidenceSetRef],
        }),
      ]);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const detail = await coordinator.getExternalActionDetail(scope, {
        schemaVersion: '1.0.0',
        actionId: 'action-validate-concurrent',
      });
      // Two serialized validations ⇒ action revision 2 and candidate revision 2.
      expect(detail.action.actionRevision).toBe(2);
      expect(detail.riskDecision).toBeDefined();
      const decisionIds = await pool!.query<{ risk_decision_id: string }>(
        `SELECT risk_decision_id FROM frontend_external_action.risk_decisions
       WHERE action_id = 'action-validate-concurrent'`,
      );
      expect(decisionIds.rows).toHaveLength(2);
    });

    it('rejects a conflicting immutable snapshot and an illegal attempt transition at the database', async () => {
      const store = pgBoundary();
      // Risk decision is immutable: same identity with a different snapshot fails.
      await store.transaction(async (repositories) => {
        await repositories.riskDecisions.insert({
          schemaVersion: '1.0.0',
          riskDecisionId: 'risk-immutable',
          actionId: 'action-immutable',
          resourceProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          riskLevel: 'R1',
          policyVersion: 'stage11.action-risk.v1',
          requiresUserApproval: false,
          reasons: ['A'],
          decidedAt: new Date().toISOString(),
        });
      });
      await expect(
        store.transaction(async (repositories) => {
          await repositories.riskDecisions.insert({
            schemaVersion: '1.0.0',
            riskDecisionId: 'risk-immutable',
            actionId: 'action-immutable',
            resourceProjectId: PROJECT_ID,
            effectiveProjectId: PROJECT_ID,
            riskLevel: 'R4',
            policyVersion: 'stage11.action-risk.v1',
            requiresUserApproval: true,
            reasons: ['B'],
            decidedAt: new Date().toISOString(),
          });
        }),
      ).rejects.toThrow(/immutable|conflict/i);
      // Attempt: terminal → IN_PROGRESS is an illegal transition.
      await store.transaction(async (repositories) => {
        await repositories.attempts.insert({
          schemaVersion: '1.0.0',
          attemptId: 'attempt-illegal',
          attemptNumber: 1,
          executionId: 'execution-illegal',
          actionId: 'action-illegal',
          resourceProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          idempotencyKey: 'idem-illegal',
          status: 'SUCCEEDED',
          policyContextRevision: 'policy-1',
          externalRevision: 'ext-7',
          correlationId: 'corr-illegal',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      });
      await expect(
        store.transaction(async (repositories) => {
          await repositories.attempts.insert({
            schemaVersion: '1.0.0',
            attemptId: 'attempt-illegal',
            attemptNumber: 1,
            executionId: 'execution-illegal',
            actionId: 'action-illegal',
            resourceProjectId: PROJECT_ID,
            effectiveProjectId: PROJECT_ID,
            idempotencyKey: 'idem-illegal',
            status: 'IN_PROGRESS',
            policyContextRevision: 'policy-1',
            externalRevision: 'ext-7',
            correlationId: 'corr-illegal',
            startedAt: new Date().toISOString(),
          });
        }),
      ).rejects.toThrow(/transition|conflict/i);
    });

    it('explicitly confirms the CURRENT verification/result are the rollback lifecycle ones', async () => {
      const store = pgBoundary();
      await seedServerOwnedState(store);
      const result = await scenarioRollbackLifecycle(store);
      expect(result.currentVerificationIsRollback).toBe(true);
      expect(result.currentResultAttemptIsRollback).toBe(true);
      expect(result.aggregateStatus).toBe('ROLLED_BACK');
    });

    it('rejects attempt start-metadata mutation and preflight binding changes at the database', async () => {
      const store = pgBoundary();
      // IN_PROGRESS → terminal with a CHANGED start metadata field fails closed
      // (only exact same-status replays and unchanged start metadata are legal).
      await store.transaction(async (repositories) => {
        await repositories.attempts.insert({
          schemaVersion: '1.0.0',
          attemptId: 'attempt-meta',
          attemptNumber: 1,
          executionId: 'execution-meta',
          actionId: 'action-meta',
          resourceProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          idempotencyKey: 'idem-meta',
          status: 'IN_PROGRESS',
          policyContextRevision: 'policy-1',
          externalRevision: 'ext-7',
          correlationId: 'corr-meta',
          startedAt: '2026-08-05T00:00:00.000Z',
        });
      });
      await expect(
        store.transaction(async (repositories) => {
          await repositories.attempts.insert({
            schemaVersion: '1.0.0',
            attemptId: 'attempt-meta',
            attemptNumber: 1,
            executionId: 'execution-meta',
            actionId: 'action-meta',
            resourceProjectId: PROJECT_ID,
            effectiveProjectId: PROJECT_ID,
            idempotencyKey: 'idem-meta',
            status: 'SUCCEEDED',
            policyContextRevision: 'policy-1',
            externalRevision: 'ext-7',
            correlationId: 'corr-meta',
            startedAt: '2026-08-05T00:00:01.000Z',
            completedAt: '2026-08-05T00:00:02.000Z',
          });
        }),
      ).rejects.toThrow(/immutable|start metadata|conflict/i);
      // A same-status attempt with a DIFFERENT snapshot also fails.
      await store.transaction(async (repositories) => {
        await repositories.attempts.insert({
          schemaVersion: '1.0.0',
          attemptId: 'attempt-meta-2',
          attemptNumber: 1,
          executionId: 'execution-meta-2',
          actionId: 'action-meta-2',
          resourceProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          idempotencyKey: 'idem-meta-2',
          status: 'SUCCEEDED',
          policyContextRevision: 'policy-1',
          externalRevision: 'ext-7',
          correlationId: 'corr-meta-2',
          startedAt: '2026-08-05T00:00:00.000Z',
          completedAt: '2026-08-05T00:00:01.000Z',
        });
      });
      await expect(
        store.transaction(async (repositories) => {
          await repositories.attempts.insert({
            schemaVersion: '1.0.0',
            attemptId: 'attempt-meta-2',
            attemptNumber: 1,
            executionId: 'execution-meta-2',
            actionId: 'action-meta-2',
            resourceProjectId: PROJECT_ID,
            effectiveProjectId: PROJECT_ID,
            idempotencyKey: 'idem-meta-2',
            status: 'SUCCEEDED',
            policyContextRevision: 'policy-1',
            externalRevision: 'ext-8',
            correlationId: 'corr-meta-2',
            startedAt: '2026-08-05T00:00:00.000Z',
            completedAt: '2026-08-05T00:00:01.000Z',
          });
        }),
      ).rejects.toThrow(/immutable|conflict/i);
      // A preflight binding (manifestRevision/preflightDigest/runAt) cannot be
      // changed for the same preflight identity.
      await store.transaction(async (repositories) => {
        await repositories.preflights.insert({
          schemaVersion: '1.0.0',
          preflightId: 'preflight-binding',
          concreteKind: 'PREFLIGHT',
          actionId: 'action-binding',
          resourceProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          manifestRevision: 1,
          preflightDigest: 'sha256:aaaa',
          status: 'DENIED',
          reasons: [],
          permissionRevalidated: true,
          credentialRevalidated: true,
          budgetRevalidated: true,
          policyRevalidated: true,
          targetStateRevalidated: false,
          externalRevisionRevalidated: false,
          runAt: '2026-08-05T00:00:00.000Z',
          expiresAt: '2026-08-05T00:30:00.000Z',
        });
      });
      await expect(
        store.transaction(async (repositories) => {
          await repositories.preflights.insert({
            ...({
              schemaVersion: '1.0.0',
              preflightId: 'preflight-binding',
              concreteKind: 'PREFLIGHT',
              actionId: 'action-binding',
              resourceProjectId: PROJECT_ID,
              effectiveProjectId: PROJECT_ID,
              manifestRevision: 1,
              preflightDigest: 'sha256:bbbb',
              status: 'READY',
              reasons: [],
              permissionRevalidated: true,
              credentialRevalidated: true,
              budgetRevalidated: true,
              policyRevalidated: true,
              targetStateRevalidated: true,
              externalRevisionRevalidated: true,
              runAt: '2026-08-05T00:00:00.000Z',
              expiresAt: '2026-08-05T00:30:00.000Z',
            } as const),
          });
        }),
      ).rejects.toThrow(/immutable|binding|conflict/i);
    });

    it('enforces the preflight transition rule in BOTH adapters (same-status exact replay, DENIED→READY only)', async () => {
      const assertTransitions = async (
        store: ExternalActionRepositoryBoundaryPort,
        suffix: string,
      ) => {
        const base = {
          schemaVersion: '1.0.0' as const,
          preflightId: `preflight-transition-${suffix}`,
          concreteKind: 'PREFLIGHT' as const,
          actionId: `action-transition-${suffix}`,
          resourceProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          manifestRevision: 1,
          preflightDigest: `sha256:${suffix}`,
          reasons: [] as string[],
          permissionRevalidated: true,
          credentialRevalidated: true,
          budgetRevalidated: true,
          policyRevalidated: true,
          targetStateRevalidated: false,
          externalRevisionRevalidated: false,
          runAt: '2026-08-05T00:00:00.000Z',
          expiresAt: '2026-08-05T00:30:00.000Z',
        };
        // Initial DENIED preflight.
        await store.transaction(async (repositories) => {
          await repositories.preflights.insert({ ...base, status: 'DENIED' });
        });
        // DENIED → READY (same binding, result fields change) is the ONLY legal
        // status transition.
        await store.transaction(async (repositories) => {
          await repositories.preflights.insert({
            ...base,
            status: 'READY',
            targetStateRevalidated: true,
            externalRevisionRevalidated: true,
          });
        });
        // READY → DENIED (reverse transition) fails closed.
        await expect(
          store.transaction(async (repositories) => {
            await repositories.preflights.insert({
              ...base,
              status: 'DENIED',
              reasons: ['readiness lost'],
              targetStateRevalidated: false,
              externalRevisionRevalidated: false,
            });
          }),
        ).rejects.toThrow(/immutable|conflict|transition/i);
        // Same status with a DIFFERENT snapshot fails closed.
        await expect(
          store.transaction(async (repositories) => {
            await repositories.preflights.insert({
              ...base,
              status: 'READY',
              targetStateRevalidated: true,
              externalRevisionRevalidated: true,
              reasons: ['changed'],
            });
          }),
        ).rejects.toThrow(/immutable|conflict|transition/i);
        // ALREADY_APPLIED → READY fails closed (same binding, illegal transition).
        await store.transaction(async (repositories) => {
          await repositories.preflights.insert({
            ...base,
            preflightId: `preflight-transition-aa-${suffix}`,
            actionId: `action-transition-aa-${suffix}`,
            status: 'ALREADY_APPLIED',
            targetStateRevalidated: true,
            externalRevisionRevalidated: true,
          });
        });
        await expect(
          store.transaction(async (repositories) => {
            await repositories.preflights.insert({
              ...base,
              preflightId: `preflight-transition-aa-${suffix}`,
              actionId: `action-transition-aa-${suffix}`,
              status: 'READY',
              targetStateRevalidated: true,
              externalRevisionRevalidated: true,
            });
          }),
        ).rejects.toThrow(/immutable|conflict|transition/i);
      };
      await assertTransitions(new InMemoryExternalActionStore(), 'mem');
      await assertTransitions(pgBoundary(), 'pg');
    });

    it('produces an identical last-slot budget view in both adapters (AC-21 parity)', async () => {
      const seedBudget = {
        schemaVersion: '1.0.0' as const,
        projectId: 'project-budget-parity',
        status: 'OK' as const,
        usedExecutions: 0,
        remainingExecutions: 1,
        softLimit: 80,
        hardLimit: 100,
        exhausted: false,
      };
      // PostgreSQL.
      const pg = pgBoundary();
      await pg.transaction(async (repositories) => {
        await repositories.budgets.insert(seedBudget);
      });
      const pgReserved = await pg.transaction(async (repositories) =>
        repositories.budgets.reserve('project-budget-parity'),
      );
      // In-memory.
      const memory = new InMemoryExternalActionStore();
      memory.seedBudget(seedBudget);
      const memoryReserved = await memory.transaction(async (repositories) =>
        repositories.budgets.reserve('project-budget-parity'),
      );
      // The FULL budget view is identical after consuming the last slot.
      expect(pgReserved).toEqual(memoryReserved);
      expect(pgReserved?.status).toBe('EXHAUSTED');
      expect(pgReserved?.remainingExecutions).toBe(0);
      expect(pgReserved?.exhausted).toBe(true);
    });

    it('commits Product resource and Command Ledger in one transaction and replays terminally (PG gateway)', async () => {
      const store = pgBoundary();
      await seedServerOwnedState(store);
      const gateway = new PostgresFrontendCommandGateway(pool!);
      const coordinator = new FrontendExternalActionProductCoordinator(
        store,
        gateway,
        new FakeExternalActionEngine(),
      );
      const actionId = 'action-pg-ledger';
      const { prepared, preflighted, revisionOf } = await lifecycleToPreflight(
        coordinator,
        actionId,
        'parity-pg-ledger',
      );
      const executeRequest = {
        schemaVersion: '1.0.0' as const,
        clientRequestId: 'parity-pg-ledger-execute',
        idempotencyKey: 'parity-pg-ledger-idem-execute',
        actionId,
        expectedActionRevision: await revisionOf!(),
        manifestRevision: prepared.manifest.manifestRevision,
        preflightId: preflighted.preflight.preflightId,
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      };
      const executed = await coordinator.executeExternalAction(scope, executeRequest);
      expect(executed.execution.status).toBe('SUCCEEDED');
      // Outcome resolution through the original identity returns the completed
      // command (ledger + terminal product resource are consistent).
      const digest = frontendExternalActionExecuteDigest(executeRequest);
      const resolved = await coordinator.resolveExternalActionOutcome(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: executeRequest.clientRequestId,
        idempotencyKey: executeRequest.idempotencyKey,
        semanticDigest: digest,
      });
      expect(resolved.outcome).toBe('COMPLETED');
      // Terminal replay is idempotent — same result, no OUTCOME_INDETERMINATE.
      const replayed = await coordinator.executeExternalAction(scope, executeRequest);
      expect(replayed.outcome).toBe('COMPLETED');
      expect(replayed.execution.executionId).toBe(executed.execution.executionId);
      // The ledger row is COMPLETED in the same database as the terminal attempt.
      const ledger = await pool!.query<{ outcome_state: string }>(
        `SELECT outcome_state FROM frontend_command.command_ledger
       WHERE client_request_id = $1`,
        [executeRequest.clientRequestId],
      );
      expect(ledger.rows[0]?.outcome_state).toBe('COMPLETED');
    });

    it('rolls back the ledger completion when a Product write fails in the same transaction', async () => {
      const store = pgBoundary();
      const gateway = new PostgresFrontendCommandGateway(pool!);
      const accepted = await acceptConnectorCommand(gateway, {
        clientRequestId: 'parity-atomic-ex',
        idempotencyKey: 'parity-atomic-idem',
        actionId: 'action-atomic',
        expectedActionRevision: 1,
        manifestRevision: 1,
        preflightId: 'preflight-atomic',
        expectedExternalRevision: 'ext-7',
      });
      const commandId = accepted.outcome.commandId;
      await expect(
        store.transactionWithHandle(async (handle) => {
          await gateway.lockAcceptedForExecution(handle.raw, commandId);
          // FIRST: complete the ledger command in this transaction.
          await gateway.completeInTransaction(handle.raw, {
            commandId,
            producedResources: [
              {
                resourceKind: 'frontend.external-action.action',
                resourceId: 'action-atomic',
              },
            ],
            completedAt: new Date().toISOString(),
          });
          // THEN: a Product write fails inside the same transaction (duplicate
          // audit sequence violates UNIQUE(action_id, sequence)).
          await handle.repositories.audit.append({
            schemaVersion: '1.0.0',
            auditEventId: 'audit-atomic-1',
            actionId: 'action-atomic',
            resourceProjectId: PROJECT_ID,
            effectiveProjectId: PROJECT_ID,
            sequence: 1,
            category: 'ACTION_EXECUTED',
            eventData: { schemaVersion: '1.0.0', message: 'x', refs: [] },
            occurredAt: new Date().toISOString(),
          });
          await handle.repositories.audit.append({
            schemaVersion: '1.0.0',
            auditEventId: 'audit-atomic-2',
            actionId: 'action-atomic',
            resourceProjectId: PROJECT_ID,
            effectiveProjectId: PROJECT_ID,
            sequence: 1,
            category: 'ACTION_VERIFIED',
            eventData: { schemaVersion: '1.0.0', message: 'y', refs: [] },
            occurredAt: new Date().toISOString(),
          });
        }),
      ).rejects.toThrow();
      // The ledger command stayed ACCEPTED — the ledger completion was rolled
      // back together with the failing Product write (real atomicity).
      const ledger = await pool!.query<{ outcome_state: string }>(
        `SELECT outcome_state FROM frontend_command.command_ledger WHERE command_id = $1`,
        [commandId],
      );
      expect(ledger.rows[0]?.outcome_state).toBe('ACCEPTED');
      // No partial Product writes survived the rollback.
      const auditRows = await pool!.query(
        `SELECT COUNT(*)::int AS count FROM frontend_external_action.audit_events
       WHERE action_id = 'action-atomic'`,
      );
      expect(auditRows.rows[0]?.count).toBe(0);
    });

    it('fails closed with OUTCOME_INDETERMINATE for an in-flight (ACCEPTED) connector command (PG gateway)', async () => {
      const store = pgBoundary();
      const gateway = new PostgresFrontendCommandGateway(pool!);
      // Accept + lock the command WITHOUT completing it (in-flight state).
      const accepted = await acceptConnectorCommand(gateway, {
        clientRequestId: 'parity-inflight-ex',
        idempotencyKey: 'parity-inflight-idem',
        actionId: 'action-inflight',
        expectedActionRevision: 1,
        manifestRevision: 1,
        preflightId: 'preflight-inflight',
        expectedExternalRevision: 'ext-7',
      });
      const commandId = accepted.outcome.commandId;
      await store.transactionWithHandle(async (handle) => {
        await gateway.lockAcceptedForExecution(handle.raw, commandId);
      });
      // Re-sending the same identity while the ledger is ACCEPTED must NOT
      // fabricate a COMPLETED result — it fails closed with OUTCOME_INDETERMINATE.
      const coordinator = new FrontendExternalActionProductCoordinator(
        store,
        gateway,
        new FakeExternalActionEngine(),
      );
      await expect(
        coordinator.executeExternalAction(scope, {
          schemaVersion: '1.0.0',
          clientRequestId: 'parity-inflight-ex',
          idempotencyKey: 'parity-inflight-idem',
          actionId: 'action-inflight',
          expectedActionRevision: 1,
          manifestRevision: 1,
          preflightId: 'preflight-inflight',
          expectedExternalRevision: 'ext-7',
          reason: 'Execute.',
        }),
      ).rejects.toThrow(/indeterminate|unresolved/i);
    });
  },
);

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
    const sql = await readFile(MIGRATION_028, 'utf8');
    try {
      await client.query('DROP SCHEMA IF EXISTS frontend_external_action CASCADE');
      // Apply.
      await client.query(sql);
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'frontend_external_action' ORDER BY table_name`,
      );
      // Exact 15-table list (Review 4860735262 — no arrayContaining, and
      // risk_decisions is included).
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'aggregates',
        'approvals',
        'attempts',
        'audit_events',
        'budgets',
        'candidates',
        'compensations',
        'credentials',
        'executions',
        'manifests',
        'preflights',
        'results',
        'risk_decisions',
        'rollbacks',
        'verifications',
      ]);
      // Every ACTION resource carries both resource_project_id and
      // effective_project_id binding columns (frozen contract; Review
      // 4860735262). credentials/budgets are server-owned views scoped by
      // connector/project, not action resources.
      const bindingColumns = await client.query(
        `SELECT table_name,
                bool_or(column_name IN ('resource_project_id')) AS has_resource,
                bool_or(column_name IN ('effective_project_id')) AS has_effective
         FROM information_schema.columns
         WHERE table_schema = 'frontend_external_action'
           AND table_name NOT IN ('credentials', 'budgets')
         GROUP BY table_name`,
      );
      for (const row of bindingColumns.rows) {
        expect(row.has_resource).toBe(true);
        expect(row.has_effective).toBe(true);
      }
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

      // Re-apply restores the schema for the remaining suite.
      await client.query(sql);
      const restored = await client.query(
        `SELECT COUNT(*)::int AS count FROM information_schema.schemata
         WHERE schema_name = 'frontend_external_action'`,
      );
      expect(restored.rows[0]?.count).toBe(1);
    } finally {
      // Guarantee the schema exists for the rest of the suite even when an
      // assertion above fails midway.
      await client.query(sql).catch(() => undefined);
      client.release();
    }
  });

  it('rejects UPDATE and DELETE on append-only audit events at the database', async () => {
    const client = await pool!.connect();
    try {
      await client.query(
        `INSERT INTO frontend_external_action.audit_events
           (audit_event_id, action_id, resource_project_id, effective_project_id,
            sequence, category, snapshot, occurred_at)
         VALUES ('audit-append-only', 'action-ao', 'project-1', 'project-1', 1,
                 'ACTION_EXECUTED', '{"auditEventId":"audit-append-only"}', now())`,
      );
      // UPDATE is rejected by the append-only trigger (own transaction so the
      // statement failure does not abort the DELETE check below).
      await client.query('BEGIN');
      await expect(
        client.query(
          `UPDATE frontend_external_action.audit_events SET category = 'ACTION_VERIFIED'
           WHERE audit_event_id = 'audit-append-only'`,
        ),
      ).rejects.toThrow(/append-only|immutable/i);
      await client.query('ROLLBACK');
      // DELETE is rejected by the append-only trigger (explicit evidence —
      // Review 4860735262).
      await client.query('BEGIN');
      await expect(
        client.query(
          `DELETE FROM frontend_external_action.audit_events
           WHERE audit_event_id = 'audit-append-only'`,
        ),
      ).rejects.toThrow(/append-only|immutable/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
