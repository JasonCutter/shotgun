import type { Actor, ValidatedActionCandidate } from '../../packages/contracts/src/index.js';
import { createCommand, createQuery } from '../../packages/kernel/src/index.js';

const security = (accessScope: readonly string[]) => ({
  accessScope,
  sensitivity: 'private' as const,
  dataClassification: 'personal',
});

const context = (accessScope: readonly string[], actor: Actor = { type: 'user', id: 'owner' }) => ({
  projectId: 'project-stage11',
  actor,
  security: security(accessScope),
});

export const actionCandidate = (
  suffix: string,
  overrides: Partial<ValidatedActionCandidate> = {},
): ValidatedActionCandidate => ({
  candidateId: `action-candidate:${suffix}`,
  revisionNumber: 1,
  operation: 'CREATE_DRAFT',
  target: {
    connectorId: 'fake-draft',
    accountRef: 'account:personal',
    destination: `drafts/${suffix}`,
  },
  parameters: { title: `Draft ${suffix}`, body: `Reviewed body for ${suffix}.` },
  validation: {
    status: 'VALIDATED',
    validationId: `validation:${suffix}`,
    validatedAt: '2026-07-17T10:00:00.000Z',
    evidenceIds: [`evidence:${suffix}`],
  },
  requestedAt: '2026-07-17T10:00:00.000Z',
  ...overrides,
});

export const prepareActionCommand = (candidate: ValidatedActionCandidate, suffix = 'prepare') =>
  createCommand({
    messageType: 'PrepareActionPreview',
    schemaVersion: '1.0.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${candidate.candidateId}:${suffix}`,
    ...context(['action:candidate:stage']),
    payload: candidate,
  });

export const approveActionCommand = (
  actionId: string,
  expectedPreviewDigest: string,
  suffix = 'approve',
  actor: Actor = { type: 'user', id: 'owner' },
  expiresInMs = 60000,
) =>
  createCommand({
    messageType: 'ApproveActionPreview',
    schemaVersion: '1.0.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${actionId}:${suffix}`,
    ...context(['action:approve'], actor),
    payload: { actionId, expectedPreviewDigest, expiresInMs },
  });

export const executeActionCommand = (
  actionId: string,
  approvalTokenId: string,
  suffix = 'execute',
) =>
  createCommand({
    messageType: 'ExecuteApprovedAction',
    schemaVersion: '1.0.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${actionId}:${suffix}`,
    ...context(['action:execute']),
    payload: { actionId, approvalTokenId },
  });

export const verifyActionCommand = (actionId: string, suffix = 'verify') =>
  createCommand({
    messageType: 'VerifyActionOutcome',
    schemaVersion: '1.0.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    idempotencyKey: `stage11:${actionId}:${suffix}`,
    ...context(['action:verify']),
    payload: { actionId },
  });

export const actionAuditQuery = (actionId: string) =>
  createQuery({
    messageType: 'ListActionAudit',
    schemaVersion: '1.0.0',
    producerModule: 'stage11-test',
    producerVersion: '1.0.0',
    ...context(['action:audit:read']),
    payload: { actionId },
  });
