import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_ACTION_ATTEMPT_LIST_CAP,
  EXTERNAL_ACTION_AUDIT_CATEGORIES,
  EXTERNAL_ACTION_FAILURE_REASONS,
  EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP,
  FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES,
  FrontendContractError,
  decodeActionAuditEventV1,
  decodeActionCandidateV1,
  decodeActionManifestV1,
  decodeApproveExternalActionRequestV1,
  decodeApproveExternalActionResultV1,
  decodeCancelExternalActionRequestV1,
  decodeCancelExternalActionResultV1,
  decodeCompensatingActionV1,
  decodeExecuteExternalActionRequestV1,
  decodeExecuteExternalActionResultV1,
  decodeExecutionAttemptV1,
  decodeExecutionV1,
  decodeExternalActionApprovalV1,
  decodeExternalActionBudgetViewV1,
  decodeExternalActionCredentialViewV1,
  decodeExternalActionV1,
  decodeGetActionManifestRequestV1,
  decodeGetActionManifestResultV1,
  decodeGetActionResultRequestV1,
  decodeGetActionResultResultV1,
  decodeGetExecutionAttemptsRequestV1,
  decodeGetExecutionAttemptsResultV1,
  decodeGetExecutionRequestV1,
  decodeGetExecutionResultV1,
  decodeGetExternalActionDetailRequestV1,
  decodeGetExternalActionDetailResultV1,
  decodeGetExternalActionRequestV1,
  decodeGetExternalActionResultV1,
  decodeGetPreflightRequestV1,
  decodeGetPreflightResultV1,
  decodeGetRiskDecisionRequestV1,
  decodeGetRiskDecisionResultV1,
  decodeGetVerificationRequestV1,
  decodeGetVerificationResultV1,
  decodeListExternalActionAuditRequestV1,
  decodeListExternalActionAuditResultV1,
  decodeListExternalActionsRequestV1,
  decodeListExternalActionsResultV1,
  decodePreflightExternalActionRequestV1,
  decodePreflightExternalActionResultV1,
  decodePreflightV1,
  decodePrepareActionManifestRequestV1,
  decodePrepareActionManifestResultV1,
  decodePrepareCompensatingActionRequestV1,
  decodePrepareCompensatingActionResultV1,
  decodeResolveExternalActionOutcomeRequestV1,
  decodeResolveExternalActionOutcomeResultV1,
  decodeResultV1,
  decodeRetryExecutionAttemptRequestV1,
  decodeRetryExecutionAttemptResultV1,
  decodeRiskDecisionV1,
  decodeRollbackExternalActionRequestV1,
  decodeRollbackExternalActionResultV1,
  decodeRollbackV1,
  decodeValidateActionCandidateRequestV1,
  decodeValidateActionCandidateResultV1,
  decodeVerificationV1,
  decodeVerifyExternalActionRequestV1,
  decodeVerifyExternalActionResultV1,
  externalActionFailureMappingFor,
  externalActionManifestDigest,
  frontendExternalActionApproveDigest,
  frontendExternalActionCancelDigest,
  frontendExternalActionCompensationDigest,
  frontendExternalActionExecuteDigest,
  frontendExternalActionManifestDigest,
  frontendExternalActionPreflightDigest,
  frontendExternalActionRetryDigest,
  frontendExternalActionRollbackDigest,
  frontendExternalActionVerifyDigest,
  isExternalActionCommandType,
} from '../../packages/contracts/src/index.js';

/**
 * FE-P4-S2 External Action contracts — strict decoding, unknown-field
 * rejection, digest integrity, cross-field invariants, the access-restricted
 * shell, bounded queue and exhaustive failure mapping. Operation decoders are
 * exercised per operation (governed commands and read results).
 */

const actor = {
  schemaVersion: '1.0.0' as const,
  principalId: 'principal-1',
  actorId: 'user-1',
};

/** Target identity reference (only used for the external target). */
const targetRef = {
  schemaVersion: '1.0.0' as const,
  targetKind: 'KNOWN_TARGET' as const,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  externalRevision: 'ext-7',
};

/** Typed Product resource reference (candidate/manifest/approval/…). */
const resourceRef = {
  schemaVersion: '1.0.0' as const,
  resourceKind: 'manifest' as const,
  resourceId: 'manifest-1',
  resourceRevision: 1,
};

const projectBinding = {
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
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

const manifestInput = {
  manifestId: 'manifest-1',
  manifestRevision: 1,
  actionId: 'action-1',
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'c'.repeat(64)}`,
  externalRevision: 'ext-7',
  parameterRef,
  parameterDigest: `sha256:${'a'.repeat(64)}`,
  evidenceSetRef,
  evidenceSetDigest: `sha256:${'b'.repeat(64)}`,
  payloadDigest: `sha256:${'d'.repeat(64)}`,
};

const makeManifest = () => ({
  schemaVersion: '1.0.0' as const,
  ...manifestInput,
  ...projectBinding,
  manifestDigest: externalActionManifestDigest(manifestInput),
  expiresAt: '2026-09-04T00:00:00.000Z',
  createdAt: '2026-08-05T00:00:00.000Z',
  createdBy: actor,
});

const makeExternalAction = () => ({
  schemaVersion: '1.0.0' as const,
  actionId: 'action-1',
  actionRevision: 3,
  operation: 'UPDATE_REVERSIBLE' as const,
  ...projectBinding,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  status: 'APPROVED' as const,
  aggregateState: 'AVAILABLE' as const,
  staleReason: undefined,
  accessMasking: 'VISIBLE' as const,
  maskedFields: [],
  capabilities: ['READ_EXTERNAL_ACTION', 'EXECUTE_EXTERNAL_ACTION', 'VERIFY_EXTERNAL_ACTION'],
  updatedAt: '2026-08-05T00:00:00.000Z',
  createdAt: '2026-08-05T00:00:00.000Z',
  targetRef,
  riskDecisionRef: { ...resourceRef, resourceKind: 'riskDecision', resourceId: 'risk-1' },
  manifestRef: resourceRef,
  approvalRef: { ...resourceRef, resourceKind: 'approval', resourceId: 'approval-1' },
  latestExecutionRef: undefined,
  compensationForActionId: undefined,
});

const makeRiskDecision = () => ({
  schemaVersion: '1.0.0' as const,
  riskDecisionId: 'risk-1',
  actionId: 'action-1',
  ...projectBinding,
  riskLevel: 'R3' as const,
  policyVersion: 'stage11.action-risk.v1',
  requiresUserApproval: true,
  reasons: ['FINANCIAL_OR_LEGAL'],
  decidedAt: '2026-08-05T00:00:00.000Z',
});

const makeApproval = () => ({
  schemaVersion: '1.0.0' as const,
  approvalId: 'approval-1',
  purpose: 'EXTERNAL_ACTION' as const,
  actionId: 'action-1',
  ...projectBinding,
  manifestId: 'manifest-1',
  manifestRevision: 1,
  manifestDigest: externalActionManifestDigest(manifestInput),
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'c'.repeat(64)}`,
  externalRevision: 'ext-7',
  actor,
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  reason: 'Approved.',
  issuedAt: '2026-08-05T00:00:00.000Z',
  expiresAt: '2026-09-04T00:00:00.000Z',
  status: 'ACTIVE' as const,
  invalidationReason: undefined,
});

const makePreflight = () => ({
  schemaVersion: '1.0.0' as const,
  preflightId: 'preflight-1',
  concreteKind: 'PREFLIGHT' as const,
  actionId: 'action-1',
  ...projectBinding,
  manifestRevision: 1,
  preflightDigest: `sha256:${'f'.repeat(64)}`,
  status: 'READY' as const,
  reasons: [],
  permissionRevalidated: true,
  credentialRevalidated: true,
  budgetRevalidated: true,
  policyRevalidated: true,
  targetStateRevalidated: true,
  externalRevisionRevalidated: true,
  runAt: '2026-08-05T00:00:00.000Z',
  expiresAt: '2026-08-05T00:30:00.000Z',
});

const makeExecution = () => ({
  schemaVersion: '1.0.0' as const,
  executionId: 'execution-1',
  concreteKind: 'EXECUTION' as const,
  actionId: 'action-1',
  ...projectBinding,
  manifestRevision: 1,
  status: 'IN_PROGRESS' as const,
  attemptCount: 1,
  startedAt: '2026-08-05T00:00:00.000Z',
  completedAt: undefined,
  latestAttemptRef: undefined,
});

const makeAttempt = () => ({
  schemaVersion: '1.0.0' as const,
  attemptId: 'attempt-1',
  attemptNumber: 1,
  executionId: 'execution-1',
  actionId: 'action-1',
  ...projectBinding,
  idempotencyKey: 'idem-attempt-1',
  status: 'IN_PROGRESS' as const,
  policyContextRevision: 'policy-1',
  externalRevision: 'ext-7',
  providerRef: undefined,
  correlationId: 'corr-1',
  causationId: undefined,
  startedAt: '2026-08-05T00:00:00.000Z',
  completedAt: undefined,
});

const makeVerification = () => ({
  schemaVersion: '1.0.0' as const,
  verificationId: 'verification-1',
  concreteKind: 'VERIFICATION' as const,
  actionId: 'action-1',
  ...projectBinding,
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'c'.repeat(64)}`,
  externalRevision: 'ext-7',
  status: 'APPLIED' as const,
  observedDigest: `sha256:${'c'.repeat(64)}`,
  verifiedAt: '2026-08-05T00:01:00.000Z',
});

const makeResult = () => ({
  schemaVersion: '1.0.0' as const,
  resultId: 'result-1',
  actionId: 'action-1',
  ...projectBinding,
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  externalId: 'external-1',
  observedDigest: `sha256:${'1'.repeat(64)}`,
  completedAt: '2026-08-05T00:02:00.000Z',
  verificationRef: undefined,
  outputRefs: [
    {
      schemaVersion: '1.0.0' as const,
      outputKind: 'LINK',
      outputId: 'out-1',
      outputDigest: `sha256:${'2'.repeat(64)}`,
    },
  ],
});

const makeCandidate = () => ({
  schemaVersion: '1.0.0' as const,
  candidateId: 'candidate-1',
  candidateRevision: 1,
  actionId: 'action-1',
  ...projectBinding,
  sourceRefs: [
    {
      schemaVersion: '1.0.0' as const,
      sourceKind: 'OPERATION',
      sourceId: 'op-1',
      sourceRevision: '1',
      sourceDigest: `sha256:${'3'.repeat(64)}`,
    },
  ],
  operation: 'UPDATE_REVERSIBLE' as const,
  targetRef,
  parameterRef,
  evidenceRefs: [evidenceSetRef],
  compensationForActionId: 'action-0',
  candidateDigest: `sha256:${'4'.repeat(64)}`,
  riskDecisionRef: { ...resourceRef, resourceKind: 'riskDecision', resourceId: 'risk-1' },
  generatedAt: '2026-08-05T00:00:00.000Z',
  generatedBy: actor,
});

const makeCompensation = () => ({
  schemaVersion: '1.0.0' as const,
  compensationId: 'compensation-1',
  actionId: 'action-2',
  ...projectBinding,
  sourceActionId: 'action-1',
  sourceExecutionId: 'execution-1',
  candidateRef: { ...resourceRef, resourceKind: 'candidate', resourceId: 'candidate-1' },
  status: 'CANDIDATE_VALIDATED' as const,
  preparedAt: '2026-08-05T00:00:00.000Z',
  preparedBy: actor,
});

const makeRollback = () => ({
  schemaVersion: '1.0.0' as const,
  rollbackId: 'rollback-1',
  actionId: 'action-1',
  ...projectBinding,
  status: 'PREPARED' as const,
  manifestRef: undefined,
  approvalRef: undefined,
  executionRef: undefined,
  verificationRef: undefined,
  updatedAt: '2026-08-05T00:00:00.000Z',
});

const makeAuditEvent = () => ({
  schemaVersion: '1.0.0' as const,
  auditEventId: 'audit-1',
  actionId: 'action-1',
  ...projectBinding,
  sequence: 1,
  category: 'ACTION_VERIFIED' as const,
  eventData: {
    schemaVersion: '1.0.0' as const,
    message: 'External action verified.',
    refs: [resourceRef],
  },
  occurredAt: '2026-08-05T00:00:00.000Z',
});

const commandIdentity = {
  clientRequestId: 'client-1',
  idempotencyKey: 'idem-1',
};

describe('FE-P4-S2 ExternalActionV1 aggregate and restricted shell', () => {
  it('decodes a valid aggregate with capabilities and project binding', () => {
    const decoded = decodeExternalActionV1(makeExternalAction());
    expect(decoded.actionId).toBe('action-1');
    expect(decoded.actionRevision).toBe(3);
    expect(decoded.capabilities).toContain('EXECUTE_EXTERNAL_ACTION');
    expect(decoded.status).toBe('APPROVED');
    expect(decoded.resourceProjectId).toBe('project-1');
    expect(decoded.effectiveProjectId).toBe('project-1');
    expect(decoded.targetRef?.targetId).toBe('target-1');
  });

  it('rejects unknown fields (strict object)', () => {
    expect(() => decodeExternalActionV1({ ...makeExternalAction(), unexpected: true })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a non-1.0.0 schemaVersion', () => {
    expect(() =>
      decodeExternalActionV1({ ...makeExternalAction(), schemaVersion: '2.0.0' }),
    ).toThrow(FrontendContractError);
  });

  it('rejects an unknown operation and an unknown status', () => {
    expect(() => decodeExternalActionV1({ ...makeExternalAction(), operation: 'EXPLODE' })).toThrow(
      FrontendContractError,
    );
    expect(() => decodeExternalActionV1({ ...makeExternalAction(), status: 'TRANSMUTED' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a zero action revision', () => {
    expect(() => decodeExternalActionV1({ ...makeExternalAction(), actionRevision: 0 })).toThrow(
      FrontendContractError,
    );
  });

  it('AC-17: decodes an access-restricted shell without protected identity', () => {
    const decoded = decodeExternalActionV1({
      ...makeExternalAction(),
      aggregateState: 'ACCESS_RESTRICTED',
      accessMasking: 'HIDDEN',
      targetRef: undefined,
      riskDecisionRef: undefined,
      manifestRef: undefined,
      approvalRef: undefined,
      latestExecutionRef: undefined,
      compensationForActionId: undefined,
    });
    expect(decoded.aggregateState).toBe('ACCESS_RESTRICTED');
    expect(decoded.targetRef).toBeUndefined();
    expect(decoded.manifestRef).toBeUndefined();
  });

  it('AC-17: rejects an access-restricted shell that leaks protected identity', () => {
    expect(() =>
      decodeExternalActionV1({
        ...makeExternalAction(),
        aggregateState: 'ACCESS_RESTRICTED',
        accessMasking: 'HIDDEN',
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeExternalActionV1({
        ...makeExternalAction(),
        accessMasking: 'HIDDEN',
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-17: requires protected identity when the aggregate is not restricted', () => {
    const action = makeExternalAction();
    expect(() => decodeExternalActionV1({ ...action, targetRef: undefined })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P4-S2 Project binding on every Product resource', () => {
  it('rejects a RiskDecision without resourceProjectId', () => {
    const withoutBinding = { ...makeRiskDecision() } as Record<string, unknown>;
    delete withoutBinding.resourceProjectId;
    expect(() => decodeRiskDecisionV1(withoutBinding)).toThrow(FrontendContractError);
  });

  it('rejects an AuditEvent without effectiveProjectId', () => {
    const withoutBinding = { ...makeAuditEvent() } as Record<string, unknown>;
    delete withoutBinding.effectiveProjectId;
    expect(() => decodeActionAuditEventV1(withoutBinding)).toThrow(FrontendContractError);
  });

  it('rejects a Rollback without project binding', () => {
    const withoutBinding = { ...makeRollback() } as Record<string, unknown>;
    delete withoutBinding.resourceProjectId;
    delete withoutBinding.effectiveProjectId;
    expect(() => decodeRollbackV1(withoutBinding)).toThrow(FrontendContractError);
  });
});

describe('FE-P4-S2 ActionManifestV1 digest integrity and consistency', () => {
  it('decodes a manifest whose manifestDigest matches the payload', () => {
    const manifest = makeManifest();
    expect(decodeActionManifestV1(manifest).manifestDigest).toBe(manifest.manifestDigest);
  });

  it('rejects a manifest whose manifestDigest does not match the payload', () => {
    const manifest = makeManifest();
    expect(() =>
      decodeActionManifestV1({
        ...manifest,
        manifestDigest: `sha256:${'e'.repeat(64)}`,
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a manifest with a non-sha256 digest', () => {
    const manifest = makeManifest();
    expect(() => decodeActionManifestV1({ ...manifest, targetDigest: 'md5:abc' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a manifest whose parameterDigest does not match its parameterRef', () => {
    const manifest = makeManifest();
    expect(() =>
      decodeActionManifestV1({
        ...manifest,
        parameterDigest: `sha256:${'9'.repeat(64)}`,
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a manifest whose evidenceSetDigest does not match its evidenceSetRef', () => {
    const manifest = makeManifest();
    expect(() =>
      decodeActionManifestV1({
        ...manifest,
        evidenceSetDigest: `sha256:${'8'.repeat(64)}`,
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a manifest whose expiresAt precedes createdAt', () => {
    const manifest = makeManifest();
    expect(() =>
      decodeActionManifestV1({
        ...manifest,
        expiresAt: '2026-08-04T00:00:00.000Z',
      }),
    ).toThrow(FrontendContractError);
  });
});

describe('FE-P4-S2 Approval, Preflight, Execution, Attempt, Verification, Result', () => {
  it('decodes a RiskDecisionV1 with a frozen risk level', () => {
    const riskDecision = makeRiskDecision();
    const decoded = decodeRiskDecisionV1(riskDecision);
    expect(decoded.riskLevel).toBe('R3');
    expect(decoded.requiresUserApproval).toBe(true);
    expect(() => decodeRiskDecisionV1({ ...riskDecision, riskLevel: 'R9' })).toThrow(
      FrontendContractError,
    );
  });

  it('decodes an ExternalActionApprovalV1 with purpose EXTERNAL_ACTION only', () => {
    expect(decodeExternalActionApprovalV1(makeApproval()).purpose).toBe('EXTERNAL_ACTION');
  });

  it('rejects a non-EXTERNAL_ACTION approval purpose', () => {
    expect(() =>
      decodeExternalActionApprovalV1({ ...makeApproval(), purpose: 'KNOWLEDGE_CANONICAL_CHANGE' }),
    ).toThrow(FrontendContractError);
  });

  it('rejects an ACTIVE approval whose expiry does not follow issuance', () => {
    expect(() =>
      decodeExternalActionApprovalV1({
        ...makeApproval(),
        issuedAt: '2026-09-04T00:00:00.000Z',
        expiresAt: '2026-08-05T00:00:00.000Z',
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a PreflightV1 with all revalidation flags', () => {
    expect(decodePreflightV1(makePreflight()).status).toBe('READY');
  });

  it('rejects a READY Preflight that did not revalidate everything', () => {
    expect(() => decodePreflightV1({ ...makePreflight(), permissionRevalidated: false })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a READY Preflight whose expiry is not in the future', () => {
    expect(() =>
      decodePreflightV1({ ...makePreflight(), expiresAt: '2026-08-05T00:00:00.000Z' }),
    ).toThrow(FrontendContractError);
  });

  it('decodes an ExecutionV1 and ExecutionAttemptV1 with per-attempt idempotency', () => {
    expect(decodeExecutionV1(makeExecution()).attemptCount).toBe(1);
    expect(decodeExecutionAttemptV1(makeAttempt()).idempotencyKey).toBe('idem-attempt-1');
  });

  it('rejects a terminal execution without completedAt', () => {
    expect(() => decodeExecutionV1({ ...makeExecution(), status: 'SUCCEEDED' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a non-terminal attempt that carries completedAt', () => {
    expect(() =>
      decodeExecutionAttemptV1({
        ...makeAttempt(),
        status: 'IN_PROGRESS',
        completedAt: '2026-08-05T00:01:00.000Z',
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a terminal attempt with a completedAt after startedAt', () => {
    expect(
      decodeExecutionAttemptV1({
        ...makeAttempt(),
        status: 'SUCCEEDED',
        completedAt: '2026-08-05T00:02:00.000Z',
      }).status,
    ).toBe('SUCCEEDED');
  });

  it('rejects a terminal attempt whose completedAt precedes startedAt', () => {
    expect(() =>
      decodeExecutionAttemptV1({
        ...makeAttempt(),
        status: 'FAILED',
        completedAt: '2026-08-04T00:00:00.000Z',
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a VerificationV1 and rejects a non-verification status value', () => {
    const verification = makeVerification();
    expect(decodeVerificationV1(verification).status).toBe('APPLIED');
    expect(() => decodeVerificationV1({ ...verification, status: 'SUCCESS' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects APPLIED/MISMATCH verification without observedDigest', () => {
    expect(() =>
      decodeVerificationV1({ ...makeVerification(), status: 'APPLIED', observedDigest: undefined }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeVerificationV1({
        ...makeVerification(),
        status: 'MISMATCH',
        observedDigest: undefined,
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects NOT_APPLIED verification that carries observedDigest', () => {
    expect(() =>
      decodeVerificationV1({
        ...makeVerification(),
        status: 'NOT_APPLIED',
        observedDigest: `sha256:${'c'.repeat(64)}`,
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a ResultV1 with safe output references', () => {
    expect(decodeResultV1(makeResult()).outputRefs[0]?.outputKind).toBe('LINK');
  });
});

describe('FE-P4-S2 Candidate, Compensation, Rollback, Audit', () => {
  it('decodes an ActionCandidateV1 with compensation marker', () => {
    const decoded = decodeActionCandidateV1(makeCandidate());
    expect(decoded.compensationForActionId).toBe('action-0');
    expect(decoded.riskDecisionRef.resourceKind).toBe('riskDecision');
  });

  it('rejects an ActionCandidate whose targetRef is a resource ref (typed refs)', () => {
    const candidate = makeCandidate();
    expect(() =>
      decodeActionCandidateV1({
        ...candidate,
        targetRef: { ...resourceRef, resourceKind: 'candidate', resourceId: 'candidate-1' },
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a CompensatingActionV1', () => {
    expect(decodeCompensatingActionV1(makeCompensation()).sourceActionId).toBe('action-1');
  });

  it('decodes a RollbackV1 and rejects an unknown rollback status', () => {
    const rollback = makeRollback();
    expect(decodeRollbackV1(rollback).status).toBe('PREPARED');
    expect(() => decodeRollbackV1({ ...rollback, status: 'MAGIC' })).toThrow(FrontendContractError);
  });

  it('decodes an ActionAuditEventV1 with a frozen 12-category set', () => {
    const decoded = decodeActionAuditEventV1(makeAuditEvent());
    expect(decoded.category).toBe('ACTION_VERIFIED');
    expect(EXTERNAL_ACTION_AUDIT_CATEGORIES).toHaveLength(12);
  });

  it('rejects an audit category outside the frozen 12-category set', () => {
    expect(() =>
      decodeActionAuditEventV1({ ...makeAuditEvent(), category: 'EXECUTION_VERIFIED' }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeActionAuditEventV1({ ...makeAuditEvent(), category: 'ACTION_DETAIL_READ' }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a raw/unsupported audit payload (safe structured eventData only)', () => {
    expect(() =>
      decodeActionAuditEventV1({
        ...makeAuditEvent(),
        eventData: { schemaVersion: '1.0.0', message: 'x', refs: [], secret: 'top' },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeActionAuditEventV1({
        ...makeAuditEvent(),
        eventJson: '{"raw":true}',
        eventData: undefined,
      }),
    ).toThrow(FrontendContractError);
  });
});

describe('FE-P4-S2 Credential and budget Product views (AC-13 / AC-14)', () => {
  it('decodes a masked credential view without raw secrets', () => {
    const credential = {
      schemaVersion: '1.0.0' as const,
      connectorId: 'connector-1',
      name: 'Production Connector',
      status: 'CONFIGURED' as const,
      maskedCredential: 'a•••••••4',
      capabilities: ['TEST', 'ROTATE', 'REVOKE'] as const,
    };
    const decoded = decodeExternalActionCredentialViewV1(credential);
    expect(decoded.maskedCredential).toBe('a•••••••4');
    expect(() =>
      decodeExternalActionCredentialViewV1({ ...credential, status: 'ROTATING' }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a budget view and enforces softLimit <= hardLimit', () => {
    const budget = {
      schemaVersion: '1.0.0' as const,
      projectId: 'project-1',
      status: 'OK' as const,
      usedExecutions: 3,
      remainingExecutions: 47,
      softLimit: 40,
      hardLimit: 50,
      exhausted: false,
    };
    expect(decodeExternalActionBudgetViewV1(budget).remainingExecutions).toBe(47);
    expect(() => decodeExternalActionBudgetViewV1({ ...budget, softLimit: 60 })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P4-S2 governed command request decoders (per operation)', () => {
  it('decodes a ValidateActionCandidate request and rejects an unknown operation', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      candidateId: 'candidate-1',
      operation: 'UPDATE_REVERSIBLE' as const,
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      compensationForActionId: 'action-0',
      reason: 'Validate.',
    };
    expect(decodeValidateActionCandidateRequestV1(request).candidateId).toBe('candidate-1');
    expect(() =>
      decodeValidateActionCandidateRequestV1({ ...request, operation: 'EXPLODE' }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a PrepareManifest request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      expectedActionRevision: 3,
      reason: 'Prepare.',
    };
    expect(decodePrepareActionManifestRequestV1(request).expectedActionRevision).toBe(3);
    expect(() =>
      decodePrepareActionManifestRequestV1({ ...request, expectedActionRevision: 0 }),
    ).toThrow(FrontendContractError);
  });

  it('decodes an Approve request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      manifestId: 'manifest-1',
      manifestRevision: 1,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    };
    expect(decodeApproveExternalActionRequestV1(request).manifestRevision).toBe(1);
    expect(() =>
      decodeApproveExternalActionRequestV1({ ...request, expectedTargetRevision: '' }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a Preflight request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      expectedActionRevision: 3,
      manifestRevision: 1,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    };
    expect(decodePreflightExternalActionRequestV1(request).manifestRevision).toBe(1);
  });

  it('decodes an Execute request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      expectedActionRevision: 3,
      manifestRevision: 1,
      preflightId: 'preflight-1',
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    expect(decodeExecuteExternalActionRequestV1(request).preflightId).toBe('preflight-1');
  });

  it('decodes a RetryAttempt request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      executionId: 'execution-1',
      sourceAttemptId: 'attempt-1',
      causationId: 'cause-1',
      reason: 'Retry.',
    };
    expect(decodeRetryExecutionAttemptRequestV1(request).causationId).toBe('cause-1');
  });

  it('decodes a Verify request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      executionId: 'execution-1',
      attemptId: 'attempt-1',
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Verify.',
    };
    expect(decodeVerifyExternalActionRequestV1(request).executionId).toBe('execution-1');
  });

  it('decodes a Cancel request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      expectedActionRevision: 3,
      reason: 'Cancel.',
    };
    expect(decodeCancelExternalActionRequestV1(request).reason).toBe('Cancel.');
  });

  it('decodes a Rollback request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      executionId: 'execution-1',
      reason: 'Rollback.',
    };
    expect(decodeRollbackExternalActionRequestV1(request).executionId).toBe('execution-1');
  });

  it('decodes a PrepareCompensation request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      sourceActionId: 'action-1',
      sourceExecutionId: 'execution-1',
      reason: 'Compensate.',
    };
    expect(decodePrepareCompensatingActionRequestV1(request).sourceActionId).toBe('action-1');
  });

  it('decodes a ResolveOutcome request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      semanticDigest: `sha256:${'5'.repeat(64)}`,
    };
    expect(decodeResolveExternalActionOutcomeRequestV1(request).semanticDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it('rejects unknown fields on every governed command request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      expectedActionRevision: 3,
      reason: 'Prepare.',
    };
    expect(() => decodePrepareActionManifestRequestV1({ ...request, injected: true })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P4-S2 read request decoders', () => {
  it('rejects a queue page size above the cap', () => {
    expect(() =>
      decodeListExternalActionsRequestV1({
        schemaVersion: '1.0.0',
        pageSize: EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP + 1,
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a bounded queue request', () => {
    const decoded = decodeListExternalActionsRequestV1({
      schemaVersion: '1.0.0',
      pageSize: 25,
    });
    expect(decoded.pageSize).toBe(25);
  });

  it('decodes Get / GetDetail / ListAudit read requests', () => {
    expect(
      decodeGetExternalActionRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
    expect(
      decodeGetExternalActionDetailRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' })
        .actionId,
    ).toBe('action-1');
    const audit = decodeListExternalActionAuditRequestV1({
      schemaVersion: '1.0.0',
      actionId: 'action-1',
      pageSize: 20,
    });
    expect(audit.pageSize).toBe(20);
    expect(() =>
      decodeListExternalActionAuditRequestV1({
        schemaVersion: '1.0.0',
        actionId: 'action-1',
        pageSize: EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP + 1,
      }),
    ).toThrow(FrontendContractError);
  });
});

describe('FE-P4-S2 command result decoders', () => {
  it('decodes ValidateCandidate result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      riskDecision: makeRiskDecision(),
      candidate: makeCandidate(),
    };
    expect(decodeValidateActionCandidateResultV1(result).riskDecision.riskLevel).toBe('R3');
  });

  it('decodes PrepareManifest result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      manifest: makeManifest(),
    };
    expect(decodePrepareActionManifestResultV1(result).manifest.manifestId).toBe('manifest-1');
  });

  it('decodes Approve result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      approval: makeApproval(),
    };
    expect(decodeApproveExternalActionResultV1(result).approval.status).toBe('ACTIVE');
  });

  it('decodes Preflight result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      preflight: makePreflight(),
    };
    expect(decodePreflightExternalActionResultV1(result).preflight.status).toBe('READY');
  });

  it('decodes Execute result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      execution: makeExecution(),
      attempt: makeAttempt(),
    };
    const decoded = decodeExecuteExternalActionResultV1(result);
    expect(decoded.execution.executionId).toBe('execution-1');
    expect(decoded.attempt.attemptId).toBe('attempt-1');
  });

  it('rejects an Execute result whose nested resources disagree on Action/Execution/Project', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      execution: makeExecution(),
      attempt: makeAttempt(),
    };
    expect(() =>
      decodeExecuteExternalActionResultV1({
        ...result,
        execution: { ...makeExecution(), actionId: 'action-2' },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeExecuteExternalActionResultV1({
        ...result,
        attempt: { ...makeAttempt(), actionId: 'action-2' },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeExecuteExternalActionResultV1({
        ...result,
        attempt: { ...makeAttempt(), executionId: 'execution-2' },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeExecuteExternalActionResultV1({
        ...result,
        attempt: { ...makeAttempt(), resourceProjectId: 'project-2' },
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a RetryAttempt result whose attempt belongs to another Action', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      attempt: makeAttempt(),
    };
    expect(() =>
      decodeRetryExecutionAttemptResultV1({
        ...result,
        attempt: { ...makeAttempt(), actionId: 'action-2' },
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes RetryAttempt result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      attempt: makeAttempt(),
    };
    expect(decodeRetryExecutionAttemptResultV1(result).attempt.attemptNumber).toBe(1);
  });

  it('decodes Verify result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      verification: makeVerification(),
    };
    expect(decodeVerifyExternalActionResultV1(result).verification.status).toBe('APPLIED');
  });

  it('decodes Cancel result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      status: 'CANCELLING' as const,
    };
    expect(decodeCancelExternalActionResultV1(result).status).toBe('CANCELLING');
  });

  it('decodes Rollback result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      actionId: 'action-1',
      rollback: makeRollback(),
    };
    expect(decodeRollbackExternalActionResultV1(result).rollback.status).toBe('PREPARED');
  });

  it('decodes PrepareCompensation result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      ...commandIdentity,
      commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
      compensation: makeCompensation(),
    };
    expect(decodePrepareCompensatingActionResultV1(result).compensation.sourceActionId).toBe(
      'action-1',
    );
  });

  it('decodes ResolveOutcome result with a commandType-dispatched strict result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      outcome: 'COMPLETED' as const,
      originalClientRequestId: 'client-1',
      originalIdempotencyKey: 'idem-1',
      completed: {
        commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
        result: {
          schemaVersion: '1.0.0' as const,
          outcome: 'COMPLETED' as const,
          ...commandIdentity,
          commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
          actionId: 'action-1',
          execution: makeExecution(),
          attempt: makeAttempt(),
        },
      },
    };
    const decoded = decodeResolveExternalActionOutcomeResultV1(result);
    expect(decoded.completed?.commandType).toBe(FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute);
  });

  it('rejects a ResolveOutcome completed payload that is not a strict command result', () => {
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({
        schemaVersion: '1.0.0' as const,
        outcome: 'COMPLETED' as const,
        originalClientRequestId: 'client-1',
        originalIdempotencyKey: 'idem-1',
        completed: {
          commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
          result: { ok: true },
        },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({
        schemaVersion: '1.0.0' as const,
        outcome: 'COMPLETED' as const,
        originalClientRequestId: 'client-1',
        originalIdempotencyKey: 'idem-1',
        completed: {
          commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
          result: {
            schemaVersion: '1.0.0' as const,
            outcome: 'COMPLETED' as const,
            ...commandIdentity,
            commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
            actionId: 'action-1',
            status: 'CANCELLING' as const,
          },
        },
      }),
    ).toThrow(FrontendContractError);
  });

  it('enforces the ResolveOutcome exclusive outcome contract', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      originalClientRequestId: 'client-1',
      originalIdempotencyKey: 'idem-1',
    };
    // COMPLETED requires completed and forbids rejection.
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({ ...base, outcome: 'COMPLETED' as const }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({
        ...base,
        outcome: 'COMPLETED' as const,
        rejection: { code: 'ACTION_EXECUTION_NOT_ALLOWED', message: 'no' },
      }),
    ).toThrow(FrontendContractError);
    // REJECTED requires rejection and forbids completed.
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({ ...base, outcome: 'REJECTED' as const }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({
        ...base,
        outcome: 'REJECTED' as const,
        rejection: { code: 'ACTION_EXECUTION_NOT_ALLOWED', message: 'no' },
        completed: {
          commandType: FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute,
          result: {
            schemaVersion: '1.0.0' as const,
            outcome: 'COMPLETED' as const,
            ...commandIdentity,
            commandSemanticDigest: `sha256:${'6'.repeat(64)}`,
            actionId: 'action-1',
            execution: makeExecution(),
            attempt: makeAttempt(),
          },
        },
      }),
    ).toThrow(FrontendContractError);
    // OUTCOME_UNKNOWN forbids both.
    expect(() =>
      decodeResolveExternalActionOutcomeResultV1({
        ...base,
        outcome: 'OUTCOME_UNKNOWN' as const,
        rejection: { code: 'ACTION_OUTCOME_UNKNOWN', message: 'unknown' },
      }),
    ).toThrow(FrontendContractError);
    expect(
      decodeResolveExternalActionOutcomeResultV1({
        ...base,
        outcome: 'OUTCOME_UNKNOWN' as const,
      }).outcome,
    ).toBe('OUTCOME_UNKNOWN');
    // REJECTED with only rejection decodes.
    expect(
      decodeResolveExternalActionOutcomeResultV1({
        ...base,
        outcome: 'REJECTED' as const,
        rejection: { code: 'ACTION_EXECUTION_NOT_ALLOWED', message: 'no' },
      }).rejection?.code,
    ).toBe('ACTION_EXECUTION_NOT_ALLOWED');
  });
});

describe('FE-P4-S2 read result decoders', () => {
  it('decodes ListExternalActions result with project-bound queue items', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      items: [
        {
          schemaVersion: '1.0.0' as const,
          actionId: 'action-1',
          actionRevision: 3,
          operation: 'UPDATE_REVERSIBLE' as const,
          ...projectBinding,
          status: 'APPROVED' as const,
          aggregateState: 'AVAILABLE' as const,
          capabilities: ['READ_EXTERNAL_ACTION'] as const,
          riskLevel: 'R3' as const,
          updatedAt: '2026-08-05T00:00:00.000Z',
        },
      ],
      nextCursor: undefined,
      capabilities: ['LIST_EXTERNAL_ACTIONS'] as const,
    };
    const decoded = decodeListExternalActionsResultV1(result);
    expect(decoded.items[0]?.riskLevel).toBe('R3');
    expect(decoded.items[0]?.resourceProjectId).toBe('project-1');
  });

  it('decodes GetExternalAction result', () => {
    const result = { schemaVersion: '1.0.0' as const, action: makeExternalAction() };
    expect(decodeGetExternalActionResultV1(result).action.actionId).toBe('action-1');
  });

  it('decodes ListAudit result', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      events: [makeAuditEvent()],
      nextCursor: undefined,
    };
    expect(decodeListExternalActionAuditResultV1(result).events[0]?.category).toBe(
      'ACTION_VERIFIED',
    );
  });

  it('decodes GetDetail result with optional resources and views', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      action: makeExternalAction(),
      manifest: makeManifest(),
      riskDecision: makeRiskDecision(),
      approval: makeApproval(),
      preflight: makePreflight(),
      execution: makeExecution(),
      attempts: [makeAttempt()],
      verification: makeVerification(),
      result: makeResult(),
      rollback: makeRollback(),
      compensation: makeCompensation(),
      credential: {
        schemaVersion: '1.0.0' as const,
        connectorId: 'connector-1',
        name: 'Production Connector',
        status: 'CONFIGURED' as const,
        maskedCredential: 'a•••••••4',
        capabilities: ['TEST'] as const,
      },
      budget: {
        schemaVersion: '1.0.0' as const,
        projectId: 'project-1',
        status: 'OK' as const,
        usedExecutions: 3,
        remainingExecutions: 47,
        softLimit: 40,
        hardLimit: 50,
        exhausted: false,
      },
    };
    const decoded = decodeGetExternalActionDetailResultV1(result);
    expect(decoded.manifest?.manifestId).toBe('manifest-1');
    expect(decoded.attempts).toHaveLength(1);
    expect(decoded.credential?.maskedCredential).toBe('a•••••••4');
    expect(decoded.budget?.remainingExecutions).toBe(47);
  });

  it('decodes every frozen individual Read Operation result', () => {
    expect(
      decodeGetActionManifestResultV1({
        schemaVersion: '1.0.0',
        manifest: makeManifest(),
      }).manifest.manifestId,
    ).toBe('manifest-1');
    expect(
      decodeGetRiskDecisionResultV1({
        schemaVersion: '1.0.0',
        riskDecision: makeRiskDecision(),
      }).riskDecision.riskLevel,
    ).toBe('R3');
    expect(
      decodeGetPreflightResultV1({ schemaVersion: '1.0.0', preflight: makePreflight() }).preflight
        .status,
    ).toBe('READY');
    expect(
      decodeGetExecutionResultV1({ schemaVersion: '1.0.0', execution: makeExecution() }).execution
        .executionId,
    ).toBe('execution-1');
    expect(
      decodeGetExecutionAttemptsResultV1({
        schemaVersion: '1.0.0',
        attempts: [makeAttempt()],
      }).attempts[0]?.attemptNumber,
    ).toBe(1);
    expect(
      decodeGetVerificationResultV1({
        schemaVersion: '1.0.0',
        verification: makeVerification(),
      }).verification.status,
    ).toBe('APPLIED');
    expect(
      decodeGetActionResultResultV1({ schemaVersion: '1.0.0', result: makeResult() }).result
        .externalId,
    ).toBe('external-1');
  });

  it('decodes every frozen individual Read Operation request', () => {
    expect(
      decodeGetActionManifestRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
    expect(
      decodeGetRiskDecisionRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
    expect(
      decodeGetPreflightRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
    expect(
      decodeGetExecutionRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
    const attemptsReq = decodeGetExecutionAttemptsRequestV1({
      schemaVersion: '1.0.0',
      actionId: 'action-1',
      pageSize: 20,
    });
    expect(attemptsReq.pageSize).toBe(20);
    expect(() =>
      decodeGetExecutionAttemptsRequestV1({
        schemaVersion: '1.0.0',
        actionId: 'action-1',
        pageSize: EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP + 1,
      }),
    ).toThrow(FrontendContractError);
    expect(
      decodeGetVerificationRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
    expect(
      decodeGetActionResultRequestV1({ schemaVersion: '1.0.0', actionId: 'action-1' }).actionId,
    ).toBe('action-1');
  });
});

describe('FE-P4-S2 nested binding and Attempt list invariants', () => {
  const makeDetail = () => ({
    schemaVersion: '1.0.0' as const,
    action: makeExternalAction(),
    manifest: makeManifest(),
    execution: makeExecution(),
    attempts: [makeAttempt()],
  });

  it('rejects a GetDetail result whose nested resource belongs to another Action', () => {
    expect(() =>
      decodeGetExternalActionDetailResultV1({
        ...makeDetail(),
        manifest: { ...makeManifest(), actionId: 'action-2' },
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a GetDetail result whose nested resource crosses the project boundary', () => {
    expect(() =>
      decodeGetExternalActionDetailResultV1({
        ...makeDetail(),
        manifest: { ...makeManifest(), resourceProjectId: 'project-2' },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeGetExternalActionDetailResultV1({
        ...makeDetail(),
        attempts: [{ ...makeAttempt(), effectiveProjectId: 'project-2' }],
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-07: rejects an Attempt list above the cap', () => {
    const attempts = Array.from({ length: EXTERNAL_ACTION_ATTEMPT_LIST_CAP + 1 }, (_, i) => ({
      ...makeAttempt(),
      attemptId: `attempt-${i + 1}`,
      attemptNumber: i + 1,
      idempotencyKey: `idem-attempt-${i + 1}`,
    }));
    expect(() =>
      decodeGetExecutionAttemptsResultV1({
        schemaVersion: '1.0.0',
        attempts,
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-07: rejects non-consecutive attemptNumber', () => {
    expect(() =>
      decodeGetExecutionAttemptsResultV1({
        schemaVersion: '1.0.0',
        attempts: [
          { ...makeAttempt(), attemptNumber: 2 },
          { ...makeAttempt(), attemptId: 'attempt-2', attemptNumber: 3 },
        ],
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-07: rejects duplicate attemptId and duplicate idempotencyKey', () => {
    expect(() =>
      decodeGetExecutionAttemptsResultV1({
        schemaVersion: '1.0.0',
        attempts: [makeAttempt(), { ...makeAttempt(), attemptId: 'attempt-1', attemptNumber: 2 }],
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeGetExecutionAttemptsResultV1({
        schemaVersion: '1.0.0',
        attempts: [
          makeAttempt(),
          {
            ...makeAttempt(),
            attemptId: 'attempt-2',
            idempotencyKey: 'idem-attempt-1',
            attemptNumber: 2,
          },
        ],
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-07: rejects attempts across different Executions', () => {
    expect(() =>
      decodeGetExecutionAttemptsResultV1({
        schemaVersion: '1.0.0',
        attempts: [
          makeAttempt(),
          {
            ...makeAttempt(),
            attemptId: 'attempt-2',
            executionId: 'execution-2',
            attemptNumber: 2,
          },
        ],
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-07: rejects an Attempt list whose length mismatches execution.attemptCount', () => {
    expect(() =>
      decodeGetExternalActionDetailResultV1({
        ...makeDetail(),
        execution: { ...makeExecution(), attemptCount: 2 },
      }),
    ).toThrow(FrontendContractError);
  });

  it('AC-07: rejects an Attempt list whose latestAttemptRef does not match the last attempt', () => {
    const second = {
      ...makeAttempt(),
      attemptId: 'attempt-2',
      attemptNumber: 2,
      idempotencyKey: 'idem-2',
    };
    expect(() =>
      decodeGetExternalActionDetailResultV1({
        ...makeDetail(),
        execution: {
          ...makeExecution(),
          attemptCount: 2,
          latestAttemptRef: {
            schemaVersion: '1.0.0' as const,
            resourceKind: 'attempt' as const,
            resourceId: 'attempt-1',
            resourceRevision: 1,
          },
        },
        attempts: [makeAttempt(), second],
      }),
    ).toThrow(FrontendContractError);
    const decoded = decodeGetExternalActionDetailResultV1({
      ...makeDetail(),
      execution: {
        ...makeExecution(),
        attemptCount: 2,
        latestAttemptRef: {
          schemaVersion: '1.0.0' as const,
          resourceKind: 'attempt' as const,
          resourceId: 'attempt-2',
          resourceRevision: 2,
        },
      },
      attempts: [makeAttempt(), second],
    });
    expect(decoded.attempts).toHaveLength(2);
  });
});

describe('FE-P4-S2 digest helpers', () => {
  it('produces stable semantic digests for governed commands', () => {
    const approveRequest = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      manifestId: 'manifest-1',
      manifestRevision: 1,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    };
    const executeRequest = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      expectedActionRevision: 3,
      manifestRevision: 1,
      preflightId: 'preflight-1',
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    const verifyRequest = {
      schemaVersion: '1.0.0' as const,
      ...commandIdentity,
      actionId: 'action-1',
      executionId: 'execution-1',
      attemptId: 'attempt-1',
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Verify.',
    };
    const approveDigest = frontendExternalActionApproveDigest(approveRequest);
    expect(approveDigest).toBe(frontendExternalActionApproveDigest(approveRequest));
    expect(approveDigest).not.toBe(frontendExternalActionExecuteDigest(executeRequest));
    expect(approveDigest).not.toBe(frontendExternalActionVerifyDigest(verifyRequest));
    expect(
      frontendExternalActionManifestDigest({
        schemaVersion: '1.0.0' as const,
        ...commandIdentity,
        actionId: 'action-1',
        expectedActionRevision: 3,
        reason: 'Prepare.',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      frontendExternalActionCancelDigest({
        schemaVersion: '1.0.0' as const,
        ...commandIdentity,
        actionId: 'action-1',
        expectedActionRevision: 3,
        reason: 'Cancel.',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      frontendExternalActionPreflightDigest({
        schemaVersion: '1.0.0' as const,
        ...commandIdentity,
        actionId: 'action-1',
        expectedActionRevision: 3,
        manifestRevision: 1,
        expectedExternalRevision: 'ext-7',
        reason: 'Preflight.',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      frontendExternalActionRetryDigest({
        schemaVersion: '1.0.0' as const,
        ...commandIdentity,
        actionId: 'action-1',
        executionId: 'execution-1',
        sourceAttemptId: 'attempt-1',
        causationId: 'cause-1',
        reason: 'Retry.',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      frontendExternalActionRollbackDigest({
        schemaVersion: '1.0.0' as const,
        ...commandIdentity,
        actionId: 'action-1',
        executionId: 'execution-1',
        reason: 'Rollback.',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      frontendExternalActionCompensationDigest({
        schemaVersion: '1.0.0' as const,
        ...commandIdentity,
        sourceActionId: 'action-1',
        sourceExecutionId: 'execution-1',
        reason: 'Compensate.',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('FE-P4-S2 failure mapping completeness', () => {
  it('maps every ExternalActionFailureReasonV1 to a typed failure', () => {
    for (const reason of EXTERNAL_ACTION_FAILURE_REASONS) {
      const mapping = externalActionFailureMappingFor(reason);
      expect(mapping, `missing mapping for ${reason}`).toBeDefined();
      expect(mapping?.normalizedCode).toBe(reason);
      expect(mapping?.httpStatus).toBeGreaterThanOrEqual(400);
      expect(mapping?.message.length).toBeGreaterThan(0);
    }
  });

  it('registers every External Action command type', () => {
    expect(isExternalActionCommandType(FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES.execute)).toBe(true);
    expect(isExternalActionCommandType('frontend.external-action.execute.v1')).toBe(true);
    expect(isExternalActionCommandType('frontend.review.record-decisions.v1')).toBe(false);
  });
});
