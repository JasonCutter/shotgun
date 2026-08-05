import { describe, expect, it, vi } from 'vitest';

import { FrontendContractError } from '../../packages/contracts/src/index.js';
import { createFrontendExternalActionClient } from '../../packages/shotgun-api-client/src/index.js';

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
  aggregateState: 'READY' as const,
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

  it('refreshes the CSRF token once on a 403 and retries (no blind auto-retry)', async () => {
    let posted = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return posted === 0
          ? jsonResponse(200, { csrfToken: 'csrf-first' })
          : jsonResponse(200, { csrfToken: 'csrf-refreshed' });
      }
      if (String(url).includes('/external-action/validate')) {
        posted += 1;
        if (posted === 1) return new Response('', { status: 403 });
        return jsonResponse(200, validateResult());
      }
      return jsonResponse(500, {});
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
    // Exactly one CSRF refresh + one retried mutation (never a second retry).
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
});
