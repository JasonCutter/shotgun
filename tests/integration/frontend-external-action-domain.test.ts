import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  FakeExternalActionEngine,
  InMemoryExternalActionStore,
} from '../../adapters/frontend-external-action-in-memory/src/index.js';
import {
  FRONTEND_EXTERNAL_ACTION_API_VERSION,
  FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES,
  frontendExternalActionCandidateDigest,
  frontendExternalActionExecuteDigest,
  type ExternalActionCredentialViewV1,
} from '../../packages/contracts/src/index.js';
import {
  FrontendExternalActionProductCoordinator,
  externalActionCapabilitiesForScope,
  type FrontendExternalActionScopeV1,
} from '../../modules/frontend-external-action/src/index.js';

/**
 * FE-P4-S2 WP2 — External Action Product domain lifecycle over the in-memory
 * store, the in-memory command gateway and the fake connector (engine port).
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

const credential: ExternalActionCredentialViewV1 = {
  schemaVersion: '1.0.0',
  connectorId: 'fake-connector',
  name: 'Fake Connector',
  status: 'CONFIGURED',
  maskedCredential: 'ab••••••••cd',
  capabilities: ['TEST', 'ROTATE', 'REVOKE'],
};

const makeCoordinator = (
  behavior: {
    readonly preflightStatus?: 'READY' | 'ALREADY_APPLIED' | 'DENIED';
    readonly retryPreflightStatus?: 'READY' | 'ALREADY_APPLIED' | 'DENIED';
    readonly executeStatus?: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
    readonly retryStatus?: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
    readonly executeThrows?: boolean;
    readonly executeDelayMs?: number;
    readonly verifyStatus?: 'APPLIED' | 'NOT_APPLIED' | 'MISMATCH';
  } = {},
) => {
  const store = new InMemoryExternalActionStore();
  store.seedCredential(credential);
  store.seedBudget({
    schemaVersion: '1.0.0',
    projectId: PROJECT_ID,
    status: 'OK',
    usedExecutions: 0,
    remainingExecutions: 100,
    softLimit: 80,
    hardLimit: 100,
    exhausted: false,
  });
  const gateway = new InMemoryFrontendCommandGateway();
  const coordinator = new FrontendExternalActionProductCoordinator(
    store,
    gateway,
    new FakeExternalActionEngine(behavior),
  );
  return { store, coordinator, gateway };
};

const revisionOf = async (
  coordinator: FrontendExternalActionProductCoordinator,
  actionId: string,
) =>
  (
    await coordinator.getExternalAction(scope, {
      schemaVersion: '1.0.0',
      actionId,
    })
  ).action.actionRevision;

const runLifecycle = async (
  coordinator: FrontendExternalActionProductCoordinator,
  actionId = 'action-1',
) => {
  const currentRevision = async () =>
    (
      await coordinator.getExternalAction(scope, {
        schemaVersion: '1.0.0',
        actionId,
      })
    ).action.actionRevision;
  await coordinator.validateActionCandidate(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `client-validate-${actionId}`,
    idempotencyKey: `idem-validate-${actionId}`,
    actionId,
    candidateId: `candidate-${actionId}`,
    operation: 'UPDATE_REVERSIBLE',
    targetRef,
    parameterRef,
    evidenceRefs: [evidenceSetRef],
    reason: 'Validate.',
  });
  const prepared = await coordinator.prepareActionManifest(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `client-prepare-${actionId}`,
    idempotencyKey: `idem-prepare-${actionId}`,
    actionId,
    expectedActionRevision: await currentRevision(),
    reason: 'Prepare.',
  });
  const approved = await coordinator.approveExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `client-approve-${actionId}`,
    idempotencyKey: `idem-approve-${actionId}`,
    actionId,
    manifestId: prepared.manifest.manifestId,
    manifestRevision: prepared.manifest.manifestRevision,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Approved.',
  });
  const preflighted = await coordinator.preflightExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `client-preflight-${actionId}`,
    idempotencyKey: `idem-preflight-${actionId}`,
    actionId,
    expectedActionRevision: await currentRevision(),
    manifestRevision: prepared.manifest.manifestRevision,
    expectedExternalRevision: 'ext-7',
    reason: 'Preflight.',
  });
  const executed = await coordinator.executeExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `client-execute-${actionId}`,
    idempotencyKey: `idem-execute-${actionId}`,
    actionId,
    expectedActionRevision: await currentRevision(),
    manifestRevision: prepared.manifest.manifestRevision,
    preflightId: preflighted.preflight.preflightId,
    expectedExternalRevision: 'ext-7',
    reason: 'Execute.',
  });
  const verified = await coordinator.verifyExternalAction(scope, {
    schemaVersion: '1.0.0',
    clientRequestId: `client-verify-${actionId}`,
    idempotencyKey: `idem-verify-${actionId}`,
    actionId,
    executionId: executed.execution.executionId,
    attemptId: executed.attempt.attemptId,
    expectedTargetRevision: 'rev-3',
    expectedExternalRevision: 'ext-7',
    reason: 'Verify.',
  });
  return { validated: undefined, prepared, approved, preflighted, executed, verified };
};

describe('FE-P4-S2 WP2 External Action Product domain', () => {
  it('runs the full governed lifecycle to VERIFIED', async () => {
    const { coordinator, store } = makeCoordinator();
    const { verified, executed } = await runLifecycle(coordinator);

    expect(verified.verification.status).toBe('APPLIED');
    expect(executed.execution.status).toBe('SUCCEEDED');
    expect(executed.attempt.status).toBe('SUCCEEDED');
    expect(executed.attempt.completedAt).toBeDefined();

    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-1',
    });
    expect(detail.action.status).toBe('VERIFIED');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.attemptNumber).toBe(1);
    expect(detail.credential?.maskedCredential).toBe('ab••••••••cd');
    expect(detail.budget?.remainingExecutions).toBe(99);
    void store;
  });

  it('persists an ordered append-only attempt list with per-attempt idempotency', async () => {
    const { coordinator } = makeCoordinator({ executeStatus: 'OUTCOME_UNKNOWN' });
    // Manual lifecycle up to execute (verify is not allowed for OUTCOME_UNKNOWN).
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-r',
      idempotencyKey: 'idem-v-r',
      actionId: 'action-1',
      candidateId: 'candidate-1',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-r',
      idempotencyKey: 'idem-p-r',
      actionId: 'action-1',
      expectedActionRevision: await revisionOf(coordinator, 'action-1'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-r',
      idempotencyKey: 'idem-a-r',
      actionId: 'action-1',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-r',
      idempotencyKey: 'idem-pf-r',
      actionId: 'action-1',
      expectedActionRevision: await revisionOf(coordinator, 'action-1'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    const executed = await coordinator.executeExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-e-r',
      idempotencyKey: 'idem-e-r',
      actionId: 'action-1',
      expectedActionRevision: await revisionOf(coordinator, 'action-1'),
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    });
    expect(executed.outcome).toBe('OUTCOME_UNKNOWN');

    const retried = await coordinator.retryExecutionAttempt(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-retry',
      idempotencyKey: 'idem-retry-1',
      actionId: 'action-1',
      executionId: executed.execution.executionId,
      sourceAttemptId: executed.attempt.attemptId,
      causationId: 'cause-retry-1',
      reason: 'Retry.',
    });
    expect(retried.attempt.attemptNumber).toBe(2);
    expect(retried.attempt.causationId).toBe('cause-retry-1');

    const attempts = await coordinator.getExecutionAttempts(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-1',
      pageSize: 50,
    });
    expect(attempts.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
  });

  it('rejects execution without an ACTIVE approval', async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-no-approve',
      idempotencyKey: 'idem-no-approve',
      actionId: 'action-2',
      candidateId: 'candidate-2',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-prepare-2',
      idempotencyKey: 'idem-prepare-2',
      actionId: 'action-2',
      expectedActionRevision: await revisionOf(coordinator, 'action-2'),
      reason: 'Prepare.',
    });
    await expect(
      coordinator.preflightExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-preflight-2',
        idempotencyKey: 'idem-preflight-2',
        actionId: 'action-2',
        expectedActionRevision: await revisionOf(coordinator, 'action-2'),
        manifestRevision: prepared.manifest.manifestRevision,
        expectedExternalRevision: 'ext-7',
        reason: 'Preflight.',
      }),
    ).rejects.toThrow(/approval/i);
  });

  it('fails closed when the project execution budget is exhausted', async () => {
    const { coordinator, store } = makeCoordinator();
    // Server-owned budget store is authoritative: seed an exhausted budget.
    store.seedBudget({
      schemaVersion: '1.0.0',
      projectId: PROJECT_ID,
      status: 'EXHAUSTED',
      usedExecutions: 100,
      remainingExecutions: 0,
      softLimit: 80,
      hardLimit: 100,
      exhausted: true,
    });
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v3',
      idempotencyKey: 'idem-v3',
      actionId: 'action-3',
      candidateId: 'candidate-3',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p3',
      idempotencyKey: 'idem-p3',
      actionId: 'action-3',
      expectedActionRevision: await revisionOf(coordinator, 'action-3'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a3',
      idempotencyKey: 'idem-a3',
      actionId: 'action-3',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf3',
      idempotencyKey: 'idem-pf3',
      actionId: 'action-3',
      expectedActionRevision: await revisionOf(coordinator, 'action-3'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    await expect(
      coordinator.executeExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-ex3',
        idempotencyKey: 'idem-ex3',
        actionId: 'action-3',
        expectedActionRevision: await revisionOf(coordinator, 'action-3'),
        manifestRevision: prepared.manifest.manifestRevision,
        preflightId: preflighted.preflight.preflightId,
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      }),
    ).rejects.toThrow(); // fail-closed: budget unavailable ⇒ preflight DENIED ⇒ execution blocked
  });

  it('does not allow Cancel as Rollback and gates cancel by state', async () => {
    const { coordinator } = makeCoordinator();
    // Cancel before execution is allowed.
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-cancel',
      idempotencyKey: 'idem-cancel',
      actionId: 'action-4',
      candidateId: 'candidate-4',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const cancelled = await coordinator.cancelExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-cancel-4',
      idempotencyKey: 'idem-cancel-4',
      actionId: 'action-4',
      expectedActionRevision: await revisionOf(coordinator, 'action-4'),
      reason: 'Cancel.',
    });
    expect(cancelled.status).toBe('CANCELLED');
    // Rollback is never automatic and only exists after execution.
    await expect(
      coordinator.rollbackExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-rb4',
        idempotencyKey: 'idem-rb4',
        actionId: 'action-4',
        executionId: 'execution-missing',
        reason: 'Rollback.',
      }),
    ).rejects.toThrow(/rollback|not found/i);
  });

  it('resolves a completed command outcome through the original identity', async () => {
    const { coordinator } = makeCoordinator();
    await runLifecycle(coordinator, 'action-5');
    const validateRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-validate-action-5',
      idempotencyKey: 'idem-validate-action-5',
      actionId: 'action-5',
      candidateId: 'candidate-action-5',
      operation: 'UPDATE_REVERSIBLE' as const,
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    };
    const digest = frontendExternalActionCandidateDigest(validateRequest);
    const resolved = await coordinator.resolveExternalActionOutcome(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-validate-action-5',
      idempotencyKey: 'idem-validate-action-5',
      semanticDigest: digest,
    });
    expect(resolved.outcome).toBe('COMPLETED');
    expect(resolved.completed?.commandType).toBe(
      FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.validateCandidate,
    );
    // A mismatched digest fails closed.
    await expect(
      coordinator.resolveExternalActionOutcome(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-validate-action-5',
        idempotencyKey: 'idem-validate-action-5',
        semanticDigest: `sha256:${'9'.repeat(64)}`,
      }),
    ).rejects.toThrow(/digest/i);
  });

  it('produces a VERIFICATION resource (Connector success is never verified success)', async () => {
    const { coordinator } = makeCoordinator({ verifyStatus: 'MISMATCH' });
    const { verified } = await runLifecycle(coordinator, 'action-6');
    expect(verified.verification.status).toBe('MISMATCH');
    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-6',
    });
    expect(detail.action.status).toBe('VERIFICATION_FAILED');
    expect(detail.verification?.status).toBe('MISMATCH');
  });

  it('registers all governed command types for the gateway', () => {
    expect(FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute).toBe(
      'frontend.external-action.execute.v1',
    );
    expect(FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.prepareCompensation).toBe(
      'frontend.external-action.prepare-compensation.v1',
    );
  });

  it('replays an already-completed command idempotently (same result, no OUTCOME_INDETERMINATE)', async () => {
    const { coordinator } = makeCoordinator();
    const request = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-replay',
      idempotencyKey: 'idem-replay',
      actionId: 'action-r',
      candidateId: 'candidate-r',
      operation: 'UPDATE_REVERSIBLE' as const,
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    };
    const first = await coordinator.validateActionCandidate(scope, request);
    const second = await coordinator.validateActionCandidate(scope, request);
    expect(second.outcome).toBe('COMPLETED');
    expect(second.actionId).toBe(first.actionId);
    expect(second.riskDecision.riskDecisionId).toBe(first.riskDecision.riskDecisionId);
  });

  it('rejects execution when the approval no longer binds the current manifest', async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v8',
      idempotencyKey: 'idem-v8',
      actionId: 'action-8',
      candidateId: 'candidate-8',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p8',
      idempotencyKey: 'idem-p8',
      actionId: 'action-8',
      expectedActionRevision: await revisionOf(coordinator, 'action-8'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a8',
      idempotencyKey: 'idem-a8',
      actionId: 'action-8',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    // A new manifest revision supersedes the approved one (re-approval rule):
    // both preflight and execution are blocked until re-approval.
    const prepared2 = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p8b',
      idempotencyKey: 'idem-p8b',
      actionId: 'action-8',
      expectedActionRevision: await revisionOf(coordinator, 'action-8'),
      reason: 'Prepare again.',
    });
    await expect(
      coordinator.preflightExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-pf8',
        idempotencyKey: 'idem-pf8',
        actionId: 'action-8',
        expectedActionRevision: await revisionOf(coordinator, 'action-8'),
        manifestRevision: prepared2.manifest.manifestRevision,
        expectedExternalRevision: 'ext-7',
        reason: 'Preflight.',
      }),
    ).rejects.toThrow(/approval/i);
  });

  it('returns only a restricted shell from Detail when the scope changed', async () => {
    const { coordinator } = makeCoordinator();
    await runLifecycle(coordinator, 'action-9');
    const changedScope: FrontendExternalActionScopeV1 = {
      ...scope,
      accessRevision: 'access-2',
    };
    const detail = await coordinator.getExternalActionDetail(changedScope, {
      schemaVersion: '1.0.0',
      actionId: 'action-9',
    });
    expect(detail.action.aggregateState).toBe('ACCESS_RESTRICTED');
    expect(detail.action.targetRef).toBeUndefined();
    expect(detail.manifest).toBeUndefined();
    expect(detail.attempts).toEqual([]);
    expect(detail.credential).toBeUndefined();
  });

  it('writes append-only audit events through the governed lifecycle', async () => {
    const { coordinator } = makeCoordinator();
    await runLifecycle(coordinator, 'action-10');
    const audit = await coordinator.listExternalActionAudit(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-10',
      pageSize: 50,
    });
    expect(audit.events.length).toBeGreaterThanOrEqual(2);
    const categories = audit.events.map((event) => event.category);
    expect(categories).toContain('ACTION_EXECUTED');
    expect(categories).toContain('ACTION_VERIFIED');
  });

  it('never grants write capabilities from a read-only scope', async () => {
    const { coordinator } = makeCoordinator();
    const readScope: FrontendExternalActionScopeV1 = {
      ...scope,
      accessScope: ['action:read'],
    };
    const capabilities = externalActionCapabilitiesForScope(readScope);
    expect(capabilities).toContain('READ_EXTERNAL_ACTION');
    expect(capabilities).toContain('RESOLVE_OUTCOME');
    expect(capabilities).not.toContain('VALIDATE_CANDIDATE');
    expect(capabilities).not.toContain('PREPARE_MANIFEST');
    expect(capabilities).not.toContain('EXECUTE_EXTERNAL_ACTION');
    expect(capabilities).not.toContain('APPROVE_EXTERNAL_ACTION');
    // A read-only principal cannot validate a candidate (server authority).
    await expect(
      coordinator.validateActionCandidate(readScope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-readonly',
        idempotencyKey: 'idem-readonly',
        actionId: 'action-7',
        candidateId: 'candidate-7',
        operation: 'UPDATE_REVERSIBLE',
        targetRef,
        parameterRef,
        evidenceRefs: [evidenceSetRef],
      }),
    ).rejects.toThrow();
  });

  it('preserves a started attempt when the connector throws (OUTCOME_UNKNOWN, never lost)', async () => {
    const { coordinator } = makeCoordinator({ executeThrows: true });
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-throw',
      idempotencyKey: 'idem-v-throw',
      actionId: 'action-throw',
      candidateId: 'candidate-throw',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-throw',
      idempotencyKey: 'idem-p-throw',
      actionId: 'action-throw',
      expectedActionRevision: await revisionOf(coordinator, 'action-throw'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-throw',
      idempotencyKey: 'idem-a-throw',
      actionId: 'action-throw',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-throw',
      idempotencyKey: 'idem-pf-throw',
      actionId: 'action-throw',
      expectedActionRevision: await revisionOf(coordinator, 'action-throw'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    // The connector throws, but the command returns OUTCOME_UNKNOWN and the
    // attempt survives as a persisted recoverable resource.
    const executed = await coordinator.executeExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-ex-throw',
      idempotencyKey: 'idem-ex-throw',
      actionId: 'action-throw',
      expectedActionRevision: await revisionOf(coordinator, 'action-throw'),
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    });
    expect(executed.outcome).toBe('OUTCOME_UNKNOWN');
    expect(executed.attempt.status).toBe('OUTCOME_UNKNOWN');
    expect(executed.attempt.completedAt).toBeDefined();
    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-throw',
    });
    expect(detail.action.status).toBe('OUTCOME_UNKNOWN');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.status).toBe('OUTCOME_UNKNOWN');
  });

  it('recovers re-approval: a new manifest with a fresh approval passes preflight again', async () => {
    const { coordinator } = makeCoordinator();
    await runLifecycle(coordinator, 'action-reapprove');
    // Supersede the manifest and issue a fresh approval bound to it.
    const prepared2 = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-r2',
      idempotencyKey: 'idem-p-r2',
      actionId: 'action-reapprove',
      expectedActionRevision: await revisionOf(coordinator, 'action-reapprove'),
      reason: 'Prepare again.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-r2',
      idempotencyKey: 'idem-a-r2',
      actionId: 'action-reapprove',
      manifestId: prepared2.manifest.manifestId,
      manifestRevision: prepared2.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved again.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-r2',
      idempotencyKey: 'idem-pf-r2',
      actionId: 'action-reapprove',
      expectedActionRevision: await revisionOf(coordinator, 'action-reapprove'),
      manifestRevision: prepared2.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    expect(preflighted.preflight.status).toBe('READY');
  });

  it('rejects execution reusing a preflight from another action', async () => {
    const { coordinator } = makeCoordinator();
    const { preflighted } = await runLifecycle(coordinator, 'action-src');
    // A second action with its own lifecycle but a DIFFERENT preflight cannot
    // borrow action-src's preflight.
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-dst',
      idempotencyKey: 'idem-v-dst',
      actionId: 'action-dst',
      candidateId: 'candidate-dst',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const preparedDst = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-dst',
      idempotencyKey: 'idem-p-dst',
      actionId: 'action-dst',
      expectedActionRevision: await revisionOf(coordinator, 'action-dst'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-dst',
      idempotencyKey: 'idem-a-dst',
      actionId: 'action-dst',
      manifestId: preparedDst.manifest.manifestId,
      manifestRevision: preparedDst.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    await expect(
      coordinator.executeExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-ex-dst',
        idempotencyKey: 'idem-ex-dst',
        actionId: 'action-dst',
        expectedActionRevision: await revisionOf(coordinator, 'action-dst'),
        manifestRevision: preparedDst.manifest.manifestRevision,
        preflightId: preflighted.preflight.preflightId,
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      }),
    ).rejects.toThrow(/preflight/i);
  });

  it('preserves ALREADY_APPLIED from preflight and blocks execution', async () => {
    const { coordinator } = makeCoordinator({ preflightStatus: 'ALREADY_APPLIED' });
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-al',
      idempotencyKey: 'idem-v-al',
      actionId: 'action-al',
      candidateId: 'candidate-al',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-al',
      idempotencyKey: 'idem-p-al',
      actionId: 'action-al',
      expectedActionRevision: await revisionOf(coordinator, 'action-al'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-al',
      idempotencyKey: 'idem-a-al',
      actionId: 'action-al',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-al',
      idempotencyKey: 'idem-pf-al',
      actionId: 'action-al',
      expectedActionRevision: await revisionOf(coordinator, 'action-al'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    // The ALREADY_APPLIED status is preserved as a Product result, never
    // coerced to READY, and execution is blocked.
    expect(preflighted.preflight.status).toBe('ALREADY_APPLIED');
    await expect(
      coordinator.executeExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-ex-al',
        idempotencyKey: 'idem-ex-al',
        actionId: 'action-al',
        expectedActionRevision: await revisionOf(coordinator, 'action-al'),
        manifestRevision: prepared.manifest.manifestRevision,
        preflightId: preflighted.preflight.preflightId,
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      }),
    ).rejects.toThrow(/preflight|expired/i);
  });

  it('creates a new candidate revision and risk decision when candidate semantics change', async () => {
    const { coordinator } = makeCoordinator();
    const first = await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-sem1',
      idempotencyKey: 'idem-v-sem1',
      actionId: 'action-sem',
      candidateId: 'candidate-sem',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    // Same semantics ⇒ reused risk decision (candidate revision still
    // increments for the new command identity).
    const same = await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-sem1b',
      idempotencyKey: 'idem-v-sem1b',
      actionId: 'action-sem',
      candidateId: 'candidate-sem',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    expect(same.riskDecision.riskDecisionId).toBe(first.riskDecision.riskDecisionId);
    // Changed parameter semantics ⇒ candidate revision 3 + a NEW risk decision.
    const changedParam = {
      ...parameterRef,
      parameterDigest: `sha256:${'d'.repeat(64)}`,
    };
    const second = await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-sem2',
      idempotencyKey: 'idem-v-sem2',
      actionId: 'action-sem',
      candidateId: 'candidate-sem',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef: changedParam,
      evidenceRefs: [evidenceSetRef],
    });
    expect(second.candidate.candidateRevision).toBe(3);
    expect(second.riskDecision.riskDecisionId).not.toBe(first.riskDecision.riskDecisionId);
  });

  it('pins verification to the latest SUCCEEDED attempt and rejects earlier ones', async () => {
    const { coordinator } = makeCoordinator({ executeStatus: 'OUTCOME_UNKNOWN' });
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-ver',
      idempotencyKey: 'idem-v-ver',
      actionId: 'action-ver',
      candidateId: 'candidate-ver',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-ver',
      idempotencyKey: 'idem-p-ver',
      actionId: 'action-ver',
      expectedActionRevision: await revisionOf(coordinator, 'action-ver'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-ver',
      idempotencyKey: 'idem-a-ver',
      actionId: 'action-ver',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-ver',
      idempotencyKey: 'idem-pf-ver',
      actionId: 'action-ver',
      expectedActionRevision: await revisionOf(coordinator, 'action-ver'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    const first = await coordinator.executeExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-ex-ver1',
      idempotencyKey: 'idem-ex-ver1',
      actionId: 'action-ver',
      expectedActionRevision: await revisionOf(coordinator, 'action-ver'),
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    });
    expect(first.outcome).toBe('OUTCOME_UNKNOWN');
    // Retry succeeds (fake engine preflight passes by default).
    const retried = await coordinator.retryExecutionAttempt(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-retry-ver',
      idempotencyKey: 'idem-retry-ver',
      actionId: 'action-ver',
      executionId: first.execution.executionId,
      sourceAttemptId: first.attempt.attemptId,
      causationId: 'cause-retry-ver',
      reason: 'Retry.',
    });
    expect(retried.attempt.status).toBe('SUCCEEDED');
    // Verifying the earlier (non-latest, non-SUCCEEDED) attempt is rejected.
    await expect(
      coordinator.verifyExternalAction(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-ver-early',
        idempotencyKey: 'idem-ver-early',
        actionId: 'action-ver',
        executionId: first.execution.executionId,
        attemptId: first.attempt.attemptId,
        expectedTargetRevision: 'rev-3',
        expectedExternalRevision: 'ext-7',
        reason: 'Verify.',
      }),
    ).rejects.toThrow(/attempt|verification/i);
    // Without an attemptId, verification pins the latest SUCCEEDED attempt.
    const verified = await coordinator.verifyExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-ver-late',
      idempotencyKey: 'idem-ver-late',
      actionId: 'action-ver',
      executionId: first.execution.executionId,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Verify.',
    });
    expect(verified.verification.status).toBe('APPLIED');
    expect(verified.verification.attemptId).toBe(retried.attempt.attemptId);
    // Result external identity comes from the provider ref of the pinned attempt.
    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-ver',
    });
    expect(detail.result?.attemptId).toBe(retried.attempt.attemptId);
    expect(detail.result?.externalId).toContain('external-');
  });

  it('executes rollback through its own governed lifecycle (prepare → approve → preflight → execute → verify)', async () => {
    const { coordinator } = makeCoordinator();
    const { executed } = await runLifecycle(coordinator, 'action-rb');
    // Rollback is PREPARED by a separate governed command — never auto-executed.
    const preparedRollback = await coordinator.rollbackExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-rb5',
      idempotencyKey: 'idem-rb5',
      actionId: 'action-rb',
      executionId: executed.execution.executionId,
      reason: 'Rollback.',
    });
    expect(preparedRollback.outcome).toBe('COMPLETED');
    expect(preparedRollback.rollback.status).toBe('PREPARED');
    const rollbackManifest = preparedRollback.rollback.manifestRef!;
    let detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-rb',
    });
    expect(detail.action.status).toBe('ROLLBACK_AVAILABLE');
    // The user explicitly approves the rollback manifest.
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-rb-approve',
      idempotencyKey: 'idem-rb-approve',
      actionId: 'action-rb',
      manifestId: rollbackManifest.resourceId,
      manifestRevision: rollbackManifest.resourceRevision!,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approve rollback.',
    });
    // Rollback preflight (rollback semantics) runs through the normal command.
    const rollbackPreflight = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-rb-preflight',
      idempotencyKey: 'idem-rb-preflight',
      actionId: 'action-rb',
      expectedActionRevision: await revisionOf(coordinator, 'action-rb'),
      manifestRevision: rollbackManifest.resourceRevision!,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight rollback.',
    });
    expect(rollbackPreflight.preflight.status).toBe('READY');
    // Rollback execution through the normal execute command.
    const rollbackExecuted = await coordinator.executeExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-rb-execute',
      idempotencyKey: 'idem-rb-execute',
      actionId: 'action-rb',
      expectedActionRevision: await revisionOf(coordinator, 'action-rb'),
      manifestRevision: rollbackManifest.resourceRevision!,
      preflightId: rollbackPreflight.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute rollback.',
    });
    expect(rollbackExecuted.execution.status).toBe('SUCCEEDED');
    // Connector success alone never confirms the reversal — ROLLED_BACK is
    // reached only after an APPLIED rollback verification.
    detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-rb',
    });
    expect(detail.action.status).toBe('VERIFYING');
    expect(detail.rollback?.status).toBe('EXECUTING');
    const rollbackVerified = await coordinator.verifyExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-rb-verify',
      idempotencyKey: 'idem-rb-verify',
      actionId: 'action-rb',
      executionId: rollbackExecuted.execution.executionId,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Verify rollback.',
    });
    expect(rollbackVerified.verification.status).toBe('APPLIED');
    detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-rb',
    });
    expect(detail.action.status).toBe('ROLLED_BACK');
    expect(detail.rollback?.status).toBe('ROLLED_BACK');
    expect(detail.rollback?.verificationRef).toBeDefined();
  });

  it('keeps audit sequences strictly monotonic past 50 events (store-based authority)', async () => {
    const { coordinator } = makeCoordinator();
    // Each validation writes ACTION_RISK_DECIDED + ACTION_CANDIDATE_VALIDATED.
    // 30 changed-semantics validations produce 60 events on one action.
    for (let index = 0; index < 30; index += 1) {
      await coordinator.validateActionCandidate(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: `client-audit-${index}`,
        idempotencyKey: `idem-audit-${index}`,
        actionId: 'action-audit',
        candidateId: 'candidate-audit',
        operation: 'UPDATE_REVERSIBLE',
        targetRef,
        parameterRef: {
          ...parameterRef,
          parameterDigest: `sha256:${index.toString(16).padStart(64, '0')}`,
        },
        evidenceRefs: [evidenceSetRef],
      });
    }
    const page1 = await coordinator.listExternalActionAudit(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-audit',
      pageSize: 50,
    });
    const page2 = await coordinator.listExternalActionAudit(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-audit',
      pageSize: 50,
      cursor: page1.nextCursor,
    });
    const sequences = [...page1.events, ...page2.events].map((event) => event.sequence);
    expect(sequences).toHaveLength(60);
    expect(new Set(sequences).size).toBe(60);
    expect(Math.max(...sequences)).toBeGreaterThan(50);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(page2.events[0]?.sequence).toBe(51);
  });

  it('never treats an in-flight connector command as COMPLETED on replay (OUTCOME_INDETERMINATE)', async () => {
    const { coordinator, gateway } = makeCoordinator();
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-inflight',
      idempotencyKey: 'idem-v-inflight',
      actionId: 'action-inflight',
      candidateId: 'candidate-inflight',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-inflight',
      idempotencyKey: 'idem-p-inflight',
      actionId: 'action-inflight',
      expectedActionRevision: await revisionOf(coordinator, 'action-inflight'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-inflight',
      idempotencyKey: 'idem-a-inflight',
      actionId: 'action-inflight',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-inflight',
      idempotencyKey: 'idem-pf-inflight',
      actionId: 'action-inflight',
      expectedActionRevision: await revisionOf(coordinator, 'action-inflight'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    // Simulate "Phase 1 committed, ledger still ACCEPTED, process interrupted
    // before the connector call": accept + lock the same execute command
    // identity through the gateway WITHOUT completing the ledger.
    const executeRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-ex-inflight',
      idempotencyKey: 'idem-ex-inflight',
      actionId: 'action-inflight',
      expectedActionRevision: await revisionOf(coordinator, 'action-inflight'),
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    const now = new Date().toISOString();
    await gateway.accept({
      commandId: 'cmd-inflight',
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
        payload: executeRequest,
      },
      commandSemanticDigest: frontendExternalActionExecuteDigest(executeRequest),
      acceptedPolicyContext: {
        policyContextId: 'frontend-external-action-current-policy',
        policyContextRevision: scope.policyContextRevision,
        acceptedAt: now,
      },
      correlationId: 'corr-inflight',
      traceId: 'trace-inflight',
      receivedAt: now,
      acceptedAt: now,
    });
    await gateway.lockAcceptedForExecution(undefined, 'cmd-inflight');
    // Re-sending the same identity while the ledger is ACCEPTED (in-flight)
    // must NOT produce a fabricated COMPLETED result — it fails closed with
    // OUTCOME_INDETERMINATE, forcing resolution through the original identity.
    await expect(coordinator.executeExternalAction(scope, executeRequest)).rejects.toThrow(
      /indeterminate|unresolved/i,
    );
  });

  it('preserves a FAILED retry attempt when the retry preflight is denied', async () => {
    const { coordinator } = makeCoordinator({
      executeStatus: 'OUTCOME_UNKNOWN',
      retryPreflightStatus: 'DENIED',
    });
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-rpd',
      idempotencyKey: 'idem-v-rpd',
      actionId: 'action-rpd',
      candidateId: 'candidate-rpd',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-rpd',
      idempotencyKey: 'idem-p-rpd',
      actionId: 'action-rpd',
      expectedActionRevision: await revisionOf(coordinator, 'action-rpd'),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-rpd',
      idempotencyKey: 'idem-a-rpd',
      actionId: 'action-rpd',
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-rpd',
      idempotencyKey: 'idem-pf-rpd',
      actionId: 'action-rpd',
      expectedActionRevision: await revisionOf(coordinator, 'action-rpd'),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    const executed = await coordinator.executeExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-ex-rpd',
      idempotencyKey: 'idem-ex-rpd',
      actionId: 'action-rpd',
      expectedActionRevision: await revisionOf(coordinator, 'action-rpd'),
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    });
    // Retry is blocked by a denied preflight, but the started retry attempt
    // survives as FAILED (never lost).
    await expect(
      coordinator.retryExecutionAttempt(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-retry-rpd',
        idempotencyKey: 'idem-retry-rpd',
        actionId: 'action-rpd',
        executionId: executed.execution.executionId,
        sourceAttemptId: executed.attempt.attemptId,
        causationId: 'cause-retry-rpd',
        reason: 'Retry.',
      }),
    ).rejects.toThrow(/preflight|deni/i);
    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId: 'action-rpd',
    });
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts[1]?.status).toBe('FAILED');
    expect(detail.action.status).toBe('FAILED');
  });

  it('fails closed with EXTERNAL_ACTION_STALE when a governed command overlaps an in-flight connector execute (Phase-3 pinning)', async () => {
    const { coordinator } = makeCoordinator({
      executeStatus: 'SUCCEEDED',
      executeDelayMs: 250,
    });
    const actionId = 'action-overlap';
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-overlap',
      idempotencyKey: 'idem-v-overlap',
      actionId,
      candidateId: 'candidate-overlap',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-overlap',
      idempotencyKey: 'idem-p-overlap',
      actionId,
      expectedActionRevision: await revisionOf(coordinator, actionId),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-overlap',
      idempotencyKey: 'idem-a-overlap',
      actionId,
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-overlap',
      idempotencyKey: 'idem-pf-overlap',
      actionId,
      expectedActionRevision: await revisionOf(coordinator, actionId),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    const revBeforeExecute = await revisionOf(coordinator, actionId);
    const executeRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-ex-overlap',
      idempotencyKey: 'idem-ex-overlap',
      actionId,
      expectedActionRevision: revBeforeExecute,
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    // Start the execute: Phase 1 becomes durable (aggregate EXECUTING, rev+1)
    // and the connector call is delayed (still in flight).
    const executing = coordinator.executeExternalAction(scope, executeRequest);
    // Overlapping governed command while the action is EXECUTING: preflight
    // only checks the revision, so it runs and changes status + revision.
    await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-overlap-2',
      idempotencyKey: 'idem-pf-overlap-2',
      actionId,
      expectedActionRevision: revBeforeExecute + 1,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Overlapping preflight.',
    });
    // The delayed execute's Phase-3 finalize must fail closed: the aggregate is
    // no longer EXECUTING at expectedActionRevision + 1, so it cannot settle
    // the (now owned) resource.
    await expect(executing).rejects.toThrow(/stale|changed while the connector/i);
    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId,
    });
    // The overlapping preflight's state is preserved — the stale finalize did
    // NOT overwrite the action to VERIFYING.
    expect(detail.action.status).toBe('PREFLIGHT_READY');
    expect(detail.action.actionRevision).toBeGreaterThan(revBeforeExecute + 1);
  });

  it('rejects a second execute while the first connector call is in flight (no parallel execution, Review 4861433397)', async () => {
    const { coordinator } = makeCoordinator({
      executeStatus: 'SUCCEEDED',
      executeDelayMs: 250,
    });
    const actionId = 'action-reentry';
    await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-reentry',
      idempotencyKey: 'idem-v-reentry',
      actionId,
      candidateId: 'candidate-reentry',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    });
    const prepared = await coordinator.prepareActionManifest(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-reentry',
      idempotencyKey: 'idem-p-reentry',
      actionId,
      expectedActionRevision: await revisionOf(coordinator, actionId),
      reason: 'Prepare.',
    });
    await coordinator.approveExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-reentry',
      idempotencyKey: 'idem-a-reentry',
      actionId,
      manifestId: prepared.manifest.manifestId,
      manifestRevision: prepared.manifest.manifestRevision,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    });
    const preflighted = await coordinator.preflightExternalAction(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-reentry',
      idempotencyKey: 'idem-pf-reentry',
      actionId,
      expectedActionRevision: await revisionOf(coordinator, actionId),
      manifestRevision: prepared.manifest.manifestRevision,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    });
    const revBeforeExecute = await revisionOf(coordinator, actionId);
    const executeRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-ex-reentry-1',
      idempotencyKey: 'idem-ex-reentry-1',
      actionId,
      expectedActionRevision: revBeforeExecute,
      manifestRevision: prepared.manifest.manifestRevision,
      preflightId: preflighted.preflight.preflightId,
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    // Execute #1 starts: Phase 1 durable (aggregate EXECUTING) and the
    // connector call is delayed (still in flight).
    const first = coordinator.executeExternalAction(scope, executeRequest);
    // Prove the exact in-flight state via Product Read: wait until the action
    // is EXECUTING and capture the CURRENT revision (Review 4861829347).
    let executingRevision = revBeforeExecute;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const probe = await coordinator.getExternalActionDetail(scope, {
        schemaVersion: '1.0.0',
        actionId,
      });
      if (probe.action.status === 'EXECUTING') {
        executingRevision = probe.action.actionRevision;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(executingRevision).toBe(revBeforeExecute + 1);
    // Execute #2 for the SAME action while EXECUTING, submitted with the
    // CURRENT revision, must fail closed with ACTION_EXECUTION_NOT_ALLOWED —
    // never a parallel execution.
    await expect(
      coordinator.executeExternalAction(scope, {
        ...executeRequest,
        clientRequestId: 'client-ex-reentry-2',
        idempotencyKey: 'idem-ex-reentry-2',
        expectedActionRevision: executingRevision,
      }),
    ).rejects.toThrow(/already executing|not allowed|parallel/i);
    // Execute #1 completes normally once the delayed connector returns.
    const firstResult = await first;
    expect(firstResult.execution.status).toBe('SUCCEEDED');
    // Exactly ONE execution and ONE attempt exist — Execute #2 created nothing.
    const detail = await coordinator.getExternalActionDetail(scope, {
      schemaVersion: '1.0.0',
      actionId,
    });
    expect(detail.execution?.executionId).toBe(firstResult.execution.executionId);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.executionId).toBe(firstResult.execution.executionId);
    expect(detail.attempts[0]?.status).toBe('SUCCEEDED');
    expect(detail.action.status).toBe('VERIFYING');
  });

  it('creates a new risk decision when the policy context changes (same candidate meaning)', async () => {
    const { coordinator } = makeCoordinator();
    const first = await coordinator.validateActionCandidate(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-pol1',
      idempotencyKey: 'idem-v-pol1',
      actionId: 'action-pol',
      candidateId: 'candidate-pol',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    const changedPolicyScope: FrontendExternalActionScopeV1 = {
      ...scope,
      policyContextRevision: 'policy-2',
    };
    const second = await coordinator.validateActionCandidate(changedPolicyScope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-pol2',
      idempotencyKey: 'idem-v-pol2',
      actionId: 'action-pol',
      candidateId: 'candidate-pol',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
    });
    // Same candidate digest but a changed policy context ⇒ a NEW risk decision.
    expect(second.candidate.candidateDigest).toBe(first.candidate.candidateDigest);
    expect(second.riskDecision.riskDecisionId).not.toBe(first.riskDecision.riskDecisionId);
    expect(second.candidate.candidateRevision).toBe(2);
  });
});
