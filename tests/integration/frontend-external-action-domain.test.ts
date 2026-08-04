import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  FakeExternalActionEngine,
  InMemoryExternalActionStore,
} from '../../adapters/frontend-external-action-in-memory/src/index.js';
import {
  FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES,
  frontendExternalActionCandidateDigest,
  type ExternalActionCredentialViewV1,
} from '../../packages/contracts/src/index.js';
import {
  FrontendExternalActionProductCoordinator,
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
    readonly executeStatus?: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
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
  const coordinator = new FrontendExternalActionProductCoordinator(
    store,
    new InMemoryFrontendCommandGateway(),
    new FakeExternalActionEngine(behavior),
  );
  coordinator.setServerOwnedState({
    credentialStatus: 'CONFIGURED',
    budgetAvailable: true,
    budgetProjectId: PROJECT_ID,
  });
  return { store, coordinator };
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
    const { coordinator } = makeCoordinator();
    coordinator.setServerOwnedState({
      credentialStatus: 'CONFIGURED',
      budgetAvailable: false,
      budgetProjectId: PROJECT_ID,
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
});
