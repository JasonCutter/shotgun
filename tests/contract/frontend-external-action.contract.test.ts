import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_ACTION_FAILURE_REASONS,
  EXTERNAL_ACTION_QUEUE_PAGE_SIZE_CAP,
  FRONTEND_EXTERNAL_ACTION_COMMAND_TYPES,
  FrontendContractError,
  decodeActionAuditEventV1,
  decodeActionCandidateV1,
  decodeActionManifestV1,
  decodeCompensatingActionV1,
  decodeExecutionAttemptV1,
  decodeExecutionV1,
  decodeExternalActionApprovalV1,
  decodeExternalActionV1,
  decodeListExternalActionsRequestV1,
  decodePreflightV1,
  decodeResultV1,
  decodeRiskDecisionV1,
  decodeRollbackV1,
  decodeValidateActionCandidateRequestV1,
  decodeVerificationV1,
  externalActionFailureMappingFor,
  externalActionManifestDigest,
  frontendExternalActionApproveDigest,
  frontendExternalActionExecuteDigest,
  frontendExternalActionManifestDigest,
  frontendExternalActionVerifyDigest,
  isExternalActionCommandType,
} from '../../packages/contracts/src/index.js';

/**
 * FE-P4-S2 External Action contracts — strict decoding, unknown-field
 * rejection, digest integrity, bounded queue and exhaustive failure mapping.
 */

const actor = {
  schemaVersion: '1.0.0' as const,
  principalId: 'principal-1',
  actorId: 'user-1',
};

const identityRef = {
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
  manifestDigest: externalActionManifestDigest(manifestInput),
  expiresAt: '2026-09-04T00:00:00.000Z',
  createdAt: '2026-08-05T00:00:00.000Z',
  createdBy: actor,
});

const makeExternalAction = () => ({
  schemaVersion: '1.0.0' as const,
  actionId: 'action-1',
  actionRevision: 3,
  targetKind: 'KNOWN_TARGET' as const,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  externalRevision: 'ext-7',
  operation: 'UPDATE_REVERSIBLE' as const,
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  riskDecisionRef: identityRef,
  manifestRef: identityRef,
  approvalRef: identityRef,
  status: 'APPROVED' as const,
  capabilities: ['READ_EXTERNAL_ACTION', 'EXECUTE_EXTERNAL_ACTION', 'VERIFY_EXTERNAL_ACTION'],
  aggregateState: 'AVAILABLE' as const,
  staleReason: undefined,
  accessMasking: 'VISIBLE' as const,
  maskedFields: [],
  latestExecutionRef: undefined,
  compensationForActionId: undefined,
  updatedAt: '2026-08-05T00:00:00.000Z',
  createdAt: '2026-08-05T00:00:00.000Z',
});

describe('FE-P4-S2 ExternalActionV1 aggregate', () => {
  it('decodes a valid aggregate with capabilities and binding fields', () => {
    const decoded = decodeExternalActionV1(makeExternalAction());
    expect(decoded.actionId).toBe('action-1');
    expect(decoded.actionRevision).toBe(3);
    expect(decoded.capabilities).toContain('EXECUTE_EXTERNAL_ACTION');
    expect(decoded.status).toBe('APPROVED');
    expect(decoded.resourceProjectId).toBe('project-1');
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
});

describe('FE-P4-S2 ActionManifestV1 digest integrity', () => {
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
});

describe('FE-P4-S2 Approval, Preflight, Execution, Attempt, Verification, Result', () => {
  it('decodes a RiskDecisionV1 with a frozen risk level', () => {
    const riskDecision = {
      schemaVersion: '1.0.0' as const,
      riskDecisionId: 'risk-1',
      actionId: 'action-1',
      riskLevel: 'R3' as const,
      policyVersion: 'stage11.action-risk.v1',
      requiresUserApproval: true,
      reasons: ['FINANCIAL_OR_LEGAL'],
      decidedAt: '2026-08-05T00:00:00.000Z',
    };
    const decoded = decodeRiskDecisionV1(riskDecision);
    expect(decoded.riskLevel).toBe('R3');
    expect(decoded.requiresUserApproval).toBe(true);
    expect(() => decodeRiskDecisionV1({ ...riskDecision, riskLevel: 'R9' })).toThrow(
      FrontendContractError,
    );
  });

  it('decodes an ExternalActionApprovalV1 with purpose EXTERNAL_ACTION only', () => {
    const approval = {
      schemaVersion: '1.0.0' as const,
      approvalId: 'approval-1',
      purpose: 'EXTERNAL_ACTION' as const,
      actionId: 'action-1',
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
    };
    expect(decodeExternalActionApprovalV1(approval).purpose).toBe('EXTERNAL_ACTION');
  });

  it('rejects a non-EXTERNAL_ACTION approval purpose', () => {
    const approval = {
      schemaVersion: '1.0.0' as const,
      approvalId: 'approval-1',
      purpose: 'KNOWLEDGE_CANONICAL_CHANGE' as const,
      actionId: 'action-1',
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
    };
    expect(() => decodeExternalActionApprovalV1(approval)).toThrow(FrontendContractError);
  });

  it('decodes a PreflightV1 with all revalidation flags', () => {
    const preflight = {
      schemaVersion: '1.0.0' as const,
      preflightId: 'preflight-1',
      concreteKind: 'PREFLIGHT' as const,
      actionId: 'action-1',
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
    };
    expect(decodePreflightV1(preflight).status).toBe('READY');
  });

  it('decodes an ExecutionV1 and ExecutionAttemptV1 with per-attempt idempotency', () => {
    const execution = {
      schemaVersion: '1.0.0' as const,
      executionId: 'execution-1',
      concreteKind: 'EXECUTION' as const,
      actionId: 'action-1',
      manifestRevision: 1,
      status: 'IN_PROGRESS' as const,
      attemptCount: 1,
      startedAt: '2026-08-05T00:00:00.000Z',
      completedAt: undefined,
      latestAttemptRef: undefined,
    };
    const attempt = {
      schemaVersion: '1.0.0' as const,
      attemptId: 'attempt-1',
      attemptNumber: 1,
      executionId: 'execution-1',
      actionId: 'action-1',
      idempotencyKey: 'idem-attempt-1',
      status: 'IN_PROGRESS' as const,
      policyContextRevision: 'policy-1',
      externalRevision: 'ext-7',
      providerRef: undefined,
      correlationId: 'corr-1',
      causationId: undefined,
      startedAt: '2026-08-05T00:00:00.000Z',
      completedAt: undefined,
    };
    expect(decodeExecutionV1(execution).attemptCount).toBe(1);
    expect(decodeExecutionAttemptV1(attempt).idempotencyKey).toBe('idem-attempt-1');
  });

  it('decodes a VerificationV1 and rejects a non-verification status value', () => {
    const verification = {
      schemaVersion: '1.0.0' as const,
      verificationId: 'verification-1',
      concreteKind: 'VERIFICATION' as const,
      actionId: 'action-1',
      executionId: 'execution-1',
      attemptId: 'attempt-1',
      targetRevision: 'rev-3',
      targetDigest: `sha256:${'c'.repeat(64)}`,
      externalRevision: 'ext-7',
      status: 'APPLIED' as const,
      observedDigest: `sha256:${'c'.repeat(64)}`,
      verifiedAt: '2026-08-05T00:01:00.000Z',
    };
    expect(decodeVerificationV1(verification).status).toBe('APPLIED');
    expect(() => decodeVerificationV1({ ...verification, status: 'SUCCESS' })).toThrow(
      FrontendContractError,
    );
  });

  it('decodes a ResultV1 with safe output references', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      resultId: 'result-1',
      actionId: 'action-1',
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
    };
    expect(decodeResultV1(result).outputRefs[0]?.outputKind).toBe('LINK');
  });
});

describe('FE-P4-S2 Candidate, Compensation, Rollback, Audit', () => {
  it('decodes an ActionCandidateV1 with compensation marker', () => {
    const candidate = {
      schemaVersion: '1.0.0' as const,
      candidateId: 'candidate-1',
      candidateRevision: 1,
      actionId: 'action-1',
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
      targetRef: identityRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      compensationForActionId: 'action-0',
      candidateDigest: `sha256:${'4'.repeat(64)}`,
      riskDecisionRef: identityRef,
      generatedAt: '2026-08-05T00:00:00.000Z',
      generatedBy: actor,
    };
    const decoded = decodeActionCandidateV1(candidate);
    expect(decoded.compensationForActionId).toBe('action-0');
  });

  it('decodes a CompensatingActionV1', () => {
    const compensation = {
      schemaVersion: '1.0.0' as const,
      compensationId: 'compensation-1',
      actionId: 'action-2',
      sourceActionId: 'action-1',
      sourceExecutionId: 'execution-1',
      candidateRef: identityRef,
      status: 'CANDIDATE_VALIDATED' as const,
      preparedAt: '2026-08-05T00:00:00.000Z',
      preparedBy: actor,
    };
    expect(decodeCompensatingActionV1(compensation).sourceActionId).toBe('action-1');
  });

  it('decodes a RollbackV1 and rejects an unknown rollback status', () => {
    const rollback = {
      schemaVersion: '1.0.0' as const,
      rollbackId: 'rollback-1',
      actionId: 'action-1',
      status: 'PREPARED' as const,
      manifestRef: undefined,
      approvalRef: undefined,
      executionRef: undefined,
      verificationRef: undefined,
      updatedAt: '2026-08-05T00:00:00.000Z',
    };
    expect(decodeRollbackV1(rollback).status).toBe('PREPARED');
    expect(() => decodeRollbackV1({ ...rollback, status: 'MAGIC' })).toThrow(FrontendContractError);
  });

  it('decodes an ActionAuditEventV1 with a frozen category', () => {
    const event = {
      schemaVersion: '1.0.0' as const,
      auditEventId: 'audit-1',
      actionId: 'action-1',
      sequence: 1,
      category: 'EXECUTION_VERIFIED' as const,
      eventJson: '{"safe":true}',
      occurredAt: '2026-08-05T00:00:00.000Z',
    };
    expect(decodeActionAuditEventV1(event).category).toBe('EXECUTION_VERIFIED');
  });
});

describe('FE-P4-S2 bounded requests and digest helpers', () => {
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

  it('rejects a ValidateActionCandidate request with an unknown operation', () => {
    expect(() =>
      decodeValidateActionCandidateRequestV1({
        schemaVersion: '1.0.0',
        clientRequestId: 'client-1',
        idempotencyKey: 'idem-1',
        actionId: 'action-1',
        candidateId: 'candidate-1',
        operation: 'EXPLODE',
        targetRef: identityRef,
        parameterRef,
        evidenceRefs: [evidenceSetRef],
      }),
    ).toThrow(FrontendContractError);
  });

  it('produces stable semantic digests for governed commands', () => {
    const approveRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-approve',
      idempotencyKey: 'idem-approve',
      actionId: 'action-1',
      manifestId: 'manifest-1',
      manifestRevision: 1,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    };
    const executeRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-execute',
      idempotencyKey: 'idem-execute',
      actionId: 'action-1',
      expectedActionRevision: 3,
      manifestRevision: 1,
      preflightId: 'preflight-1',
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    };
    const verifyRequest = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'client-verify',
      idempotencyKey: 'idem-verify',
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
        clientRequestId: 'client-manifest',
        idempotencyKey: 'idem-manifest',
        actionId: 'action-1',
        expectedActionRevision: 3,
        reason: 'Prepare.',
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
