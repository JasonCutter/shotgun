import { sha256Text } from '../../packages/contracts/src/index.js';
import type { Actor, ServerActionCandidate } from '../../packages/contracts/src/index.js';
import { createCommand, createQuery } from '../../packages/kernel/src/index.js';

const security = (accessScope: readonly string[], sensitivity = 'private' as const) => ({
  accessScope,
  sensitivity,
  dataClassification: 'personal' as const,
});
const context = (accessScope: readonly string[], actor: Actor = { type: 'user', id: 'owner' }) => ({
  projectId: 'project-stage11',
  actor,
  security: security(accessScope),
});

export const actionServerCandidate = (
  suffix: string,
  overrides: Partial<ServerActionCandidate> = {},
): ServerActionCandidate => {
  const evidenceId = `evidence:${suffix}`;
  const candidate = {
    candidateId: `action-candidate:${suffix}`,
    revisionNumber: 1,
    operation: 'CREATE_DRAFT' as const,
    target: {
      connectorId: 'fake-draft',
      accountRef: 'account:personal',
      destination: `drafts/${suffix}`,
    },
    parameters: { title: `Draft ${suffix}`, body: `Reviewed body for ${suffix}.` },
    validation: {
      status: 'VALIDATED' as const,
      validationId: `validation:${suffix}`,
      validatedAt: '2026-07-17T10:00:00.000Z',
      evidenceIds: [evidenceId],
    },
    requestedAt: '2026-07-17T10:00:00.000Z',
  };
  return {
    projectId: 'project-stage11',
    candidate,
    allowedOperationKeys: ['CREATE_DRAFT'],
    validationDigest: sha256Text(`validation:${suffix}`),
    evidence: [{ evidenceId, digest: sha256Text(`evidence:${suffix}`) }],
    sourceSensitivity: 'private',
    ...overrides,
  };
};

export const prepareActionCommand = (candidate: ServerActionCandidate, suffix = 'prepare') =>
  createCommand({
    messageType: 'PrepareActionPreview',
    schemaVersion: '1.1.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${candidate.candidate.candidateId}:${suffix}`,
    ...context(['action:candidate:stage']),
    payload: {
      candidateId: candidate.candidate.candidateId,
      expectedRevision: candidate.candidate.revisionNumber,
      operationKey: 'CREATE_DRAFT',
    },
  });

export const approveActionCommand = (
  actionId: string,
  expectedPreviewDigest: string,
  suffix = 'approve',
  actor: Actor = { type: 'user', id: 'owner' },
) =>
  createCommand({
    messageType: 'ApproveActionPreview',
    schemaVersion: '1.1.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${actionId}:${suffix}`,
    ...context(['action:approve'], actor),
    payload: { actionId, expectedPreviewDigest },
  });

export const executeActionCommand = (approvalId: string, suffix = 'execute') =>
  createCommand({
    messageType: 'ExecuteApprovedAction',
    schemaVersion: '1.1.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${approvalId}:${suffix}`,
    ...context(['action:execute']),
    payload: { approvalId },
  });

export const verifyActionCommand = (actionId: string, suffix = 'verify') =>
  createCommand({
    messageType: 'VerifyActionOutcome',
    schemaVersion: '1.1.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${actionId}:${suffix}`,
    ...context(['action:verify'], { type: 'service', id: 'verification-worker' }),
    payload: { actionId },
  });

export const actionAuditQuery = (actionId: string) =>
  createQuery({
    messageType: 'ListActionAudit',
    schemaVersion: '1.1.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    ...context(['action:audit:read']),
    payload: { actionId },
  });
