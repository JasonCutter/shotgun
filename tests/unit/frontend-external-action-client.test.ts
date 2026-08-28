import { describe, expect, it, vi } from 'vitest';

import { FrontendContractError } from '../../packages/contracts/src/index.js';
import {
  createFrontendExternalActionClient,
  type FrontendExternalActionClient,
} from '../../packages/shotgun-api-client/src/index.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const PROJECT = 'project-1';

const actor = {
  schemaVersion: '1.0.0' as const,
  principalId: 'principal-1',
  actorId: 'user-1',
};

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

const resourceRef = (kind: string, resourceId: string) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind: kind,
  resourceId,
});

const riskDecision = {
  schemaVersion: '1.0.0' as const,
  riskDecisionId: 'risk-1',
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  riskLevel: 'R4' as const,
  policyVersion: 'stage11.action-risk.v1',
  requiresUserApproval: true,
  reasons: ['test'],
  decidedAt: '2026-08-05T00:00:00.000Z',
};

const candidate = {
  schemaVersion: '1.0.0' as const,
  candidateId: 'candidate-1',
  candidateRevision: 1,
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  sourceRefs: [],
  operation: 'UPDATE_REVERSIBLE' as const,
  targetRef,
  parameterRef,
  evidenceRefs: [evidenceSetRef],
  candidateDigest: `sha256:${'c'.repeat(64)}`,
  riskDecisionRef: resourceRef('riskDecision', 'risk-1'),
  generatedAt: '2026-08-05T00:00:00.000Z',
  generatedBy: actor,
};

const validateResult = (actionId = 'action-1', clientRequestId = 'client-v-1') => ({
  schemaVersion: '1.0.0',
  outcome: 'COMPLETED',
  clientRequestId,
  idempotencyKey: 'idem-v-1',
  commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
  actionId,
  riskDecision,
  candidate,
});

const actionAggregate = {
  schemaVersion: '1.0.0' as const,
  actionId: 'action-1',
  actionRevision: 4,
  operation: 'UPDATE_REVERSIBLE' as const,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  status: 'PREFLIGHT_READY' as const,
  aggregateState: 'AVAILABLE' as const,
  accessMasking: 'VISIBLE' as const,
  maskedFields: [],
  capabilities: ['LIST_EXTERNAL_ACTIONS', 'READ_EXTERNAL_ACTION', 'EXECUTE_EXTERNAL_ACTION'],
  updatedAt: '2026-08-05T00:00:00.000Z',
  createdAt: '2026-08-05T00:00:00.000Z',
  targetRef,
  riskDecisionRef: resourceRef('riskDecision', 'risk-1'),
  manifestRef: resourceRef('manifest', 'manifest-1'),
  approvalRef: resourceRef('approval', 'approval-1'),
  latestExecutionRef: resourceRef('execution', 'execution-1'),
};

const outcomeResolved = {
  schemaVersion: '1.0.0',
  outcome: 'COMPLETED',
  originalClientRequestId: 'client-ex-1',
  originalIdempotencyKey: 'idem-ex-1',
  completed: {
    commandType: 'frontend.external-action.validate-candidate.v1',
    result: validateResult(),
  },
};

const manifest = {
  schemaVersion: '1.0.0' as const,
  manifestId: 'manifest-1',
  manifestRevision: 1,
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'e'.repeat(64)}`,
  externalRevision: 'ext-7',
  parameterRef,
  parameterDigest: `sha256:${'a'.repeat(64)}`,
  evidenceSetRef,
  evidenceSetDigest: `sha256:${'b'.repeat(64)}`,
  payloadDigest: `sha256:${'f'.repeat(64)}`,
  manifestDigest: `sha256:${'1'.repeat(64)}`,
  expiresAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-08-05T00:00:00.000Z',
  createdBy: actor,
};

const approval = {
  schemaVersion: '1.0.0' as const,
  approvalId: 'approval-1',
  purpose: 'EXTERNAL_ACTION' as const,
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  manifestId: 'manifest-1',
  manifestRevision: 1,
  manifestDigest: `sha256:${'1'.repeat(64)}`,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'e'.repeat(64)}`,
  externalRevision: 'ext-7',
  actor,
  projectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  reason: 'Approved.',
  issuedAt: '2026-08-05T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  status: 'ACTIVE' as const,
};

const preflight = {
  schemaVersion: '1.0.0' as const,
  preflightId: 'preflight-1',
  concreteKind: 'PREFLIGHT' as const,
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  manifestRevision: 1,
  preflightDigest: `sha256:${'2'.repeat(64)}`,
  status: 'READY' as const,
  reasons: ['ok'],
  permissionRevalidated: true,
  credentialRevalidated: true,
  budgetRevalidated: true,
  policyRevalidated: true,
  targetStateRevalidated: true,
  externalRevisionRevalidated: true,
  runAt: '2026-08-05T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
};

const execution = {
  schemaVersion: '1.0.0' as const,
  executionId: 'execution-1',
  concreteKind: 'EXECUTION' as const,
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  manifestRevision: 1,
  status: 'SUCCEEDED' as const,
  attemptCount: 1,
  startedAt: '2026-08-05T00:00:00.000Z',
};

const attempt = {
  schemaVersion: '1.0.0' as const,
  attemptId: 'attempt-1',
  attemptNumber: 1,
  executionId: 'execution-1',
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  idempotencyKey: 'idem-ex-1',
  status: 'SUCCEEDED' as const,
  policyContextRevision: 'policy-1',
  externalRevision: 'ext-7',
  correlationId: 'corr-1',
  startedAt: '2026-08-05T00:00:00.000Z',
};

const verification = {
  schemaVersion: '1.0.0' as const,
  verificationId: 'verification-1',
  concreteKind: 'VERIFICATION' as const,
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  executionId: 'execution-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'e'.repeat(64)}`,
  externalRevision: 'ext-7',
  status: 'APPLIED' as const,
  verifiedAt: '2026-08-05T00:00:00.000Z',
};

const rollback = {
  schemaVersion: '1.0.0' as const,
  rollbackId: 'rollback-1',
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  status: 'PREPARED' as const,
  executionRef: resourceRef('execution', 'execution-1'),
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const compensation = {
  schemaVersion: '1.0.0' as const,
  compensationId: 'compensation-1',
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  sourceActionId: 'action-1',
  sourceExecutionId: 'execution-1',
  candidateRef: resourceRef('candidate', 'candidate-1'),
  status: 'CANDIDATE_VALIDATED' as const,
  preparedAt: '2026-08-05T00:00:00.000Z',
  preparedBy: actor,
};

// Every governed command with a valid request, a valid fully-decoding result,
// and a single tampered identity field. A tamper on ANY identity field must be
// rejected fail-closed by the client (Review 4863146027 item 4).
const identityBindingCases = [
  {
    name: 'validateActionCandidate',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-1',
      idempotencyKey: 'idem-v-1',
      actionId: 'action-1',
      candidateId: 'candidate-1',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    },
    result: () => validateResult(),
    tamper: (value: ReturnType<typeof validateResult>) => ({
      ...value,
      candidate: { ...value.candidate, candidateId: 'candidate-OTHER' },
    }),
    call: (client: ReturnType<typeof createFrontendExternalActionClient>) =>
      client.validateActionCandidate(identityBindingCases[0].params),
  },
  {
    name: 'prepareActionManifest',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-p-1',
      idempotencyKey: 'idem-p-1',
      actionId: 'action-1',
      expectedActionRevision: 4,
      reason: 'Prepare.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-p-1',
      idempotencyKey: 'idem-p-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      manifest,
    }),
    tamper: (value: { manifest: { actionId: string } }) => ({
      ...value,
      manifest: { ...value.manifest, actionId: 'action-OTHER' },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.prepareActionManifest(identityBindingCases[1].params),
  },
  {
    name: 'approveExternalAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-a-1',
      idempotencyKey: 'idem-a-1',
      actionId: 'action-1',
      manifestId: 'manifest-1',
      manifestRevision: 1,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Approved.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-a-1',
      idempotencyKey: 'idem-a-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      approval,
    }),
    tamper: (value: { approval: { actionId: string } }) => ({
      ...value,
      approval: { ...value.approval, manifestId: 'manifest-OTHER' },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.approveExternalAction(identityBindingCases[2].params),
  },
  {
    name: 'preflightExternalAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-pf-1',
      idempotencyKey: 'idem-pf-1',
      actionId: 'action-1',
      expectedActionRevision: 3,
      manifestRevision: 1,
      expectedExternalRevision: 'ext-7',
      reason: 'Preflight.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-pf-1',
      idempotencyKey: 'idem-pf-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      preflight,
    }),
    tamper: (value: { preflight: { actionId: string } }) => ({
      ...value,
      preflight: { ...value.preflight, manifestRevision: 99 },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.preflightExternalAction(identityBindingCases[3].params),
  },
  {
    name: 'executeExternalAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-ex-1',
      idempotencyKey: 'idem-ex-1',
      actionId: 'action-1',
      expectedActionRevision: 4,
      manifestRevision: 1,
      preflightId: 'preflight-1',
      expectedExternalRevision: 'ext-7',
      reason: 'Execute.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-ex-1',
      idempotencyKey: 'idem-ex-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      execution,
      attempt,
    }),
    tamper: (value: {
      execution: { actionId: string };
      attempt: { externalRevision: string };
    }) => ({
      ...value,
      attempt: { ...value.attempt, externalRevision: 'ext-OTHER' },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.executeExternalAction(identityBindingCases[4].params),
  },
  {
    name: 'retryExecutionAttempt',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-r-1',
      idempotencyKey: 'idem-r-1',
      actionId: 'action-1',
      executionId: 'execution-1',
      sourceAttemptId: 'attempt-1',
      causationId: 'cause-1',
      reason: 'Retry.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-r-1',
      idempotencyKey: 'idem-r-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      attempt,
    }),
    tamper: (value: { attempt: { executionId: string; causationId: string } }) => ({
      ...value,
      attempt: { ...value.attempt, causationId: 'cause-OTHER' },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.retryExecutionAttempt(identityBindingCases[5].params),
  },
  {
    name: 'verifyExternalAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-vf-1',
      idempotencyKey: 'idem-vf-1',
      actionId: 'action-1',
      executionId: 'execution-1',
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
      reason: 'Verify.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-vf-1',
      idempotencyKey: 'idem-vf-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      verification,
    }),
    tamper: (value: { verification: { executionId: string; externalRevision: string } }) => ({
      ...value,
      verification: { ...value.verification, externalRevision: 'ext-OTHER' },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.verifyExternalAction(identityBindingCases[6].params),
  },
  {
    name: 'cancelExternalAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-c-1',
      idempotencyKey: 'idem-c-1',
      actionId: 'action-1',
      expectedActionRevision: 4,
      reason: 'Cancel.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-c-1',
      idempotencyKey: 'idem-c-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      status: 'CANCELLED',
    }),
    tamper: (value: { idempotencyKey: string }) => ({
      ...value,
      idempotencyKey: 'idem-c-OTHER',
    }),
    call: (client: FrontendExternalActionClient) =>
      client.cancelExternalAction(identityBindingCases[7].params),
  },
  {
    name: 'rollbackExternalAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-rb-1',
      idempotencyKey: 'idem-rb-1',
      actionId: 'action-1',
      executionId: 'execution-1',
      reason: 'Rollback.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-rb-1',
      idempotencyKey: 'idem-rb-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      actionId: 'action-1',
      rollback,
    }),
    tamper: (value: { rollback: { actionId: string; executionRef?: { resourceId: string } } }) => ({
      ...value,
      rollback: {
        ...value.rollback,
        executionRef: { ...value.rollback.executionRef, resourceId: 'execution-OTHER' },
      },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.rollbackExternalAction(identityBindingCases[8].params),
  },
  {
    name: 'prepareCompensatingAction',
    params: {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-co-1',
      idempotencyKey: 'idem-co-1',
      sourceActionId: 'action-1',
      sourceExecutionId: 'execution-1',
      reason: 'Compensate.',
    },
    result: () => ({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'client-co-1',
      idempotencyKey: 'idem-co-1',
      commandSemanticDigest: `sha256:${'d'.repeat(64)}`,
      compensation,
    }),
    tamper: (value: { compensation: { sourceActionId: string } }) => ({
      ...value,
      compensation: { ...value.compensation, sourceActionId: 'action-OTHER' },
    }),
    call: (client: FrontendExternalActionClient) =>
      client.prepareCompensatingAction(identityBindingCases[9].params),
  },
] as const;

describe('createFrontendExternalActionClient (FE-P4-S2 WP4 Product API connection)', () => {
  it('runs a governed validate command with CSRF and strict decoding', async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      return jsonResponse(200, validateResult());
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    const result = await client.validateActionCandidate({
      schemaVersion: '1.0.0',
      clientRequestId: 'client-v-1',
      idempotencyKey: 'idem-v-1',
      actionId: 'action-1',
      candidateId: 'candidate-1',
      operation: 'UPDATE_REVERSIBLE',
      targetRef,
      parameterRef,
      evidenceRefs: [evidenceSetRef],
      reason: 'Validate.',
    });

    expect(result.actionId).toBe('action-1');
    const call = calls.find((entry) => entry.url.includes('/external-action/validate'));
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toMatchObject({ 'x-csrf-token': 'csrf-ext' });
  });

  it('rejects a read whose decoded identity does not match the request', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        action: { ...actionAggregate, actionId: 'action-OTHER' },
      });
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    await expect(
      client.getExternalAction({ schemaVersion: '1.0.0', actionId: 'action-1' }),
    ).rejects.toThrow(FrontendContractError);
  });

  it('sends a governed mutation exactly ONCE on a general 403 and returns the typed failure (no mutation resend)', async () => {
    let posted = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      if (String(url).includes('/external-action/validate')) {
        posted += 1;
        return jsonResponse(403, {
          code: 'PROJECT_ACCESS_DENIED',
          message: 'The current scope does not grant the VALIDATE_CANDIDATE capability.',
        });
      }
      return jsonResponse(500, {});
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    await expect(
      client.validateActionCandidate({
        schemaVersion: '1.0.0',
        clientRequestId: 'client-v-1',
        idempotencyKey: 'idem-v-1',
        actionId: 'action-1',
        candidateId: 'candidate-1',
        operation: 'UPDATE_REVERSIBLE',
        targetRef,
        parameterRef,
        evidenceRefs: [evidenceSetRef],
        reason: 'Validate.',
      }),
    ).rejects.toThrow(/capability/i);
    // A governed mutation is NEVER auto-resent on a general 403 — exactly one
    // POST, and the typed failure is surfaced to the caller (Review
    // 4863146027 item 2; AC-20). No CSRF refresh happens either.
    expect(posted).toBe(1);
  });

  it('refreshes the CSRF token once on a typed CSRF denial and retries a READ POST', async () => {
    let posted = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return posted === 0
          ? jsonResponse(200, { csrfToken: 'csrf-first' })
          : jsonResponse(200, { csrfToken: 'csrf-refreshed' });
      }
      if (String(url).includes('/external-action/actions/read')) {
        posted += 1;
        if (posted === 1) {
          return jsonResponse(403, {
            code: 'REQUEST_ORIGIN_DENIED',
            message: 'The Product request was denied.',
          });
        }
        return jsonResponse(200, { schemaVersion: '1.0.0', action: actionAggregate });
      }
      return jsonResponse(500, {});
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    const result = await client.getExternalAction({
      schemaVersion: '1.0.0',
      actionId: 'action-1',
    });
    expect(result.action.actionId).toBe('action-1');
    // A READ POST may refresh the CSRF token once and retry (reads are
    // idempotent and safe); it never retries a second time.
    expect(posted).toBe(2);
  });

  it('does NOT auto-retry a non-CSRF mutation failure', async () => {
    let posted = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      posted += 1;
      return jsonResponse(400, {
        code: 'EXTERNAL_ACTION_STALE',
        message: 'The External Action revision changed.',
      });
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    await expect(
      client.executeExternalAction({
        schemaVersion: '1.0.0',
        clientRequestId: 'client-ex-1',
        idempotencyKey: 'idem-ex-1',
        actionId: 'action-1',
        expectedActionRevision: 4,
        manifestRevision: 1,
        preflightId: 'preflight-1',
        expectedExternalRevision: 'ext-7',
        reason: 'Execute.',
      }),
    ).rejects.toThrow(/revision changed|stale/i);
    expect(posted).toBe(1);
  });

  it('resolves an OUTCOME_UNKNOWN command by the original identity through the GET endpoint', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const text = String(url);
      if (text.endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      expect(text).toContain('/external-action/command-outcomes/by-client-request/client-ex-1');
      expect(text).toContain('idempotencyKey=idem-ex-1');
      expect(text).toContain('semanticDigest=sha');
      expect(init?.method ?? 'GET').toBe('GET');
      return jsonResponse(200, outcomeResolved);
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    const result = await client.resolveExternalActionOutcome({
      schemaVersion: '1.0.0',
      clientRequestId: 'client-ex-1',
      idempotencyKey: 'idem-ex-1',
      semanticDigest: 'sha256:digest',
    });
    expect(result.outcome).toBe('COMPLETED');
    expect(result.originalClientRequestId).toBe('client-ex-1');
  });

  it('forwards an AbortSignal to the mutation request', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(200, validateResult());
    });

    const controller = new AbortController();
    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    const result = await client.validateActionCandidate(
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-v-1',
        idempotencyKey: 'idem-v-1',
        actionId: 'action-1',
        candidateId: 'candidate-1',
        operation: 'UPDATE_REVERSIBLE',
        targetRef,
        parameterRef,
        evidenceRefs: [evidenceSetRef],
        reason: 'Validate.',
      },
      { signal: controller.signal },
    );
    expect(result.actionId).toBe('action-1');
  });

  it.each(identityBindingCases)(
    'rejects a governed $name result whose identity is not bound to the command (fail-closed)',
    async (command) => {
      const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/api/v1/security/csrf')) {
          return jsonResponse(200, { csrfToken: 'csrf-ext' });
        }
        return jsonResponse(200, command.tamper(command.result() as never));
      });
      const client = createFrontendExternalActionClient({ fetch: fetchMock });
      await expect(command.call(client)).rejects.toThrow(FrontendContractError);
    },
  );

  it('resolves an OUTCOME_UNKNOWN command only when BOTH original clientRequestId and originalIdempotencyKey match', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      return jsonResponse(200, { ...outcomeResolved, originalIdempotencyKey: 'idem-ex-OTHER' });
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    await expect(
      client.resolveExternalActionOutcome({
        schemaVersion: '1.0.0',
        clientRequestId: 'client-ex-1',
        idempotencyKey: 'idem-ex-1',
        semanticDigest: 'sha256:digest',
      }),
    ).rejects.toThrow(FrontendContractError);
  });

  it('reads an External Action approval through the protected approvals/read route', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      return jsonResponse(200, { schemaVersion: '1.0.0', approval });
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    const result = await client.getExternalActionApproval({
      schemaVersion: '1.0.0',
      actionId: 'action-1',
    });
    expect(result.approval.approvalId).toBe('approval-1');
    expect(result.approval.actionId).toBe('action-1');
  });

  it('rejects an approval read whose decoded action does not match the request', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-ext' });
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        approval: { ...approval, actionId: 'action-OTHER' },
      });
    });

    const client = createFrontendExternalActionClient({ fetch: fetchMock });
    await expect(
      client.getExternalActionApproval({ schemaVersion: '1.0.0', actionId: 'action-1' }),
    ).rejects.toThrow(FrontendContractError);
  });
});
