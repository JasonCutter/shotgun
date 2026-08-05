import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, ShotgunApiClient } from '@shotgun/api-client';
import { externalActionManifestDigest, type ActionManifestV1 } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { ExternalActionWorkspace } from './external-action-workspace.js';

const now = '2026-08-05T12:00:00.000Z';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'projection-1',
  fetchedAt: now,
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const queueResult = {
  schemaVersion: '1.0.0',
  items: [
    {
      schemaVersion: '1.0.0',
      actionId: 'action-1',
      actionRevision: 4,
      operation: 'UPDATE_REVERSIBLE',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      status: 'VERIFIED',
      aggregateState: 'AVAILABLE',
      capabilities: [],
      riskLevel: 'R4',
      updatedAt: now,
    },
  ],
  nextCursor: undefined,
  capabilities: [],
};

const manifest = {
  schemaVersion: '1.0.0',
  manifestId: 'manifest-1',
  manifestRevision: 1,
  actionId: 'action-1',
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'a'.repeat(64)}`,
  externalRevision: 'ext-7',
  parameterRef: {
    schemaVersion: '1.0.0',
    parameterId: 'param-1',
    parameterRevision: '2',
    parameterDigest: `sha256:${'b'.repeat(64)}`,
  },
  parameterDigest: `sha256:${'b'.repeat(64)}`,
  evidenceSetRef: {
    schemaVersion: '1.0.0',
    evidenceSetId: 'evidence-1',
    evidenceSetDigest: `sha256:${'c'.repeat(64)}`,
  },
  evidenceSetDigest: `sha256:${'c'.repeat(64)}`,
  payloadDigest: `sha256:${'d'.repeat(64)}`,
  manifestDigest: '',
  expiresAt: '2026-09-01T00:00:00.000Z',
  createdAt: now,
  createdBy: {
    schemaVersion: '1.0.0',
    principalId: 'principal-1',
    actorId: 'user-1',
  },
};

const validManifest = {
  ...manifest,
  manifestDigest: externalActionManifestDigest(manifest as ActionManifestV1),
};

const riskDecision = {
  schemaVersion: '1.0.0',
  riskDecisionId: 'risk-1',
  actionId: 'action-1',
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  riskLevel: 'R4',
  policyVersion: 'stage11.action-risk.v1',
  requiresUserApproval: true,
  reasons: ['High impact'],
  decidedAt: now,
};

const detailResult = {
  schemaVersion: '1.0.0',
  action: {
    schemaVersion: '1.0.0',
    actionId: 'action-1',
    actionRevision: 4,
    operation: 'UPDATE_REVERSIBLE',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    status: 'VERIFIED',
    aggregateState: 'AVAILABLE',
    accessMasking: 'VISIBLE',
    maskedFields: [],
    capabilities: [],
    updatedAt: now,
    createdAt: now,
    targetRef: {
      schemaVersion: '1.0.0',
      targetKind: 'KNOWN_TARGET',
      targetId: 'target-1',
      targetRevision: 'rev-3',
      externalRevision: 'ext-7',
    },
    manifestRef: { schemaVersion: '1.0.0', resourceKind: 'manifest', resourceId: 'manifest-1' },
    riskDecisionRef: { schemaVersion: '1.0.0', resourceKind: 'riskDecision', resourceId: 'risk-1' },
    latestExecutionRef: {
      schemaVersion: '1.0.0',
      resourceKind: 'execution',
      resourceId: 'execution-1',
    },
  },
  manifest: validManifest,
  riskDecision,
  attempts: [],
};

const restrictedDetail = {
  schemaVersion: '1.0.0',
  action: {
    schemaVersion: '1.0.0',
    actionId: 'action-1',
    actionRevision: 4,
    operation: 'UPDATE_REVERSIBLE',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    accessRevision: 'access-2',
    policyContextRevision: 'policy-1',
    status: 'VERIFIED',
    aggregateState: 'ACCESS_RESTRICTED',
    staleReason: 'the access or policy scope changed since this action was created',
    accessMasking: 'HIDDEN',
    maskedFields: [],
    capabilities: [],
    updatedAt: now,
    createdAt: now,
  },
  attempts: [],
};

// READY_TO_EXECUTE exposes the Cancel (abort) governed surface.
const readyDetailResult = {
  schemaVersion: '1.0.0',
  action: {
    schemaVersion: '1.0.0',
    actionId: 'action-1',
    actionRevision: 4,
    operation: 'UPDATE_REVERSIBLE',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    status: 'READY_TO_EXECUTE',
    aggregateState: 'AVAILABLE',
    accessMasking: 'VISIBLE',
    maskedFields: [],
    capabilities: [],
    updatedAt: now,
    createdAt: now,
    targetRef: {
      schemaVersion: '1.0.0',
      targetKind: 'KNOWN_TARGET',
      targetId: 'target-1',
      targetRevision: 'rev-3',
      externalRevision: 'ext-7',
    },
    manifestRef: { schemaVersion: '1.0.0', resourceKind: 'manifest', resourceId: 'manifest-1' },
    riskDecisionRef: { schemaVersion: '1.0.0', resourceKind: 'riskDecision', resourceId: 'risk-1' },
    latestExecutionRef: {
      schemaVersion: '1.0.0',
      resourceKind: 'execution',
      resourceId: 'execution-1',
    },
  },
  manifest: validManifest,
  riskDecision,
  attempts: [],
};

// A valid, NON-restricted detail whose embedded manifest is OPTIONAL in the
// contract: only `action.targetRef.externalRevision` is authoritative for the
// external revision (Review 4865620679 item 3).
const noEmbeddedManifestDetailResult = {
  schemaVersion: '1.0.0',
  action: detailResult.action,
  riskDecision,
  attempts: [],
};

// VERIFYING exposes the Verify governed surface (canVerify).
const verifyingDetailResult = {
  schemaVersion: '1.0.0',
  action: {
    ...detailResult.action,
    status: 'VERIFYING',
  },
  manifest: validManifest,
  riskDecision,
  attempts: [],
};

const execution = {
  schemaVersion: '1.0.0',
  executionId: 'execution-1',
  concreteKind: 'EXECUTION',
  actionId: 'action-1',
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  manifestRevision: 1,
  status: 'SUCCEEDED',
  attemptCount: 1,
  startedAt: now,
  completedAt: now,
  latestAttemptRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'attempt',
    resourceId: 'attempt-1',
  },
};

const attemptsList = [
  {
    schemaVersion: '1.0.0',
    attemptId: 'attempt-1',
    attemptNumber: 1,
    executionId: 'execution-1',
    actionId: 'action-1',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    idempotencyKey: 'idem-attempt-1',
    status: 'SUCCEEDED',
    policyContextRevision: 'policy-1',
    externalRevision: 'ext-7',
    correlationId: 'corr-1',
    startedAt: now,
    completedAt: now,
  },
];

const verification = {
  schemaVersion: '1.0.0',
  verificationId: 'verification-1',
  concreteKind: 'VERIFICATION',
  actionId: 'action-1',
  resourceProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  executionId: 'execution-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'a'.repeat(64)}`,
  externalRevision: 'ext-7',
  status: 'APPLIED',
  observedDigest: `sha256:${'a'.repeat(64)}`,
  verifiedAt: now,
};

type FetchBehavior = {
  readonly detail: unknown;
  readonly childReads: boolean;
  readonly cancelDelayMs?: number;
  readonly rollbackStatus?: number;
  readonly resolveOutcome?: 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
  readonly resolveFails?: boolean;
  /** Detail payload returned for the FIRST detail read (before any governed command). */
  readonly detailBeforeCommand?: unknown;
  /** Detail payload returned AFTER a governed command succeeds (stale-surface test). */
  readonly detailAfterCommand?: unknown;
  /** Serve the verification read only after a Verify command succeeds. */
  readonly verificationAfterVerify?: boolean;
  /** Delay the detail response (used to hold the COMPLETED refresh lock open). */
  readonly detailDelayMs?: number;
};

const createFetchMock = (behavior: FetchBehavior) => {
  const calls: string[] = [];
  const bodies: Array<{ url: string; body: unknown }> = [];
  let detailReads = 0;
  let verifyExecuted = false;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url);
    calls.push(text);
    if (init?.method === 'POST' && init.body) {
      try {
        bodies.push({ url: text, body: JSON.parse(String(init.body)) });
      } catch {
        // ignore non-JSON bodies
      }
    }
    if (text.endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-ext' });
    }
    if (text.includes('/external-action/queue')) {
      return jsonResponse(200, queueResult);
    }
    if (text.includes('/external-action/actions/detail')) {
      detailReads += 1;
      if (behavior.detailDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, behavior.detailDelayMs));
      }
      if (detailReads > 1 && behavior.detailAfterCommand !== undefined) {
        return jsonResponse(200, behavior.detailAfterCommand);
      }
      if (detailReads === 1 && behavior.detailBeforeCommand !== undefined) {
        return jsonResponse(200, behavior.detailBeforeCommand);
      }
      return jsonResponse(200, behavior.detail);
    }
    if (text.includes('/external-action/actions/read')) {
      // Aggregate snapshot read used to bind the deep-link restore identity.
      return jsonResponse(200, { schemaVersion: '1.0.0', action: detailResult.action });
    }
    // Governed mutation results must ECHO the request identity
    // (clientRequestId / idempotencyKey / actionId) or the strict client
    // throws an identity mismatch and the success path never runs.
    const requestBody = init?.method === 'POST' && init.body ? JSON.parse(String(init.body)) : {};
    if (text.includes('/external-action/cancel')) {
      if (behavior.cancelDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, behavior.cancelDelayMs));
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: requestBody.clientRequestId,
        idempotencyKey: requestBody.idempotencyKey,
        commandSemanticDigest: `sha256:${'f'.repeat(64)}`,
        actionId: requestBody.actionId,
        status: 'CANCELLING',
      });
    }
    if (text.includes('/external-action/verify')) {
      verifyExecuted = true;
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: requestBody.clientRequestId,
        idempotencyKey: requestBody.idempotencyKey,
        commandSemanticDigest: `sha256:${'f'.repeat(64)}`,
        actionId: requestBody.actionId,
        verification: { ...verification, executionId: requestBody.executionId },
      });
    }
    if (text.includes('/external-action/rollback')) {
      if (behavior.rollbackStatus) {
        return jsonResponse(behavior.rollbackStatus, {
          code: 'ACTION_OUTCOME_UNKNOWN',
          message: 'Rollback outcome is unresolved.',
        });
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: requestBody.clientRequestId,
        idempotencyKey: requestBody.idempotencyKey,
        commandSemanticDigest: `sha256:${'f'.repeat(64)}`,
        actionId: requestBody.actionId,
        rollback: {
          schemaVersion: '1.0.0',
          rollbackId: 'rollback-1',
          actionId: requestBody.actionId,
          resourceProjectId: 'project-1',
          effectiveProjectId: 'project-1',
          status: 'ROLLED_BACK',
          executionRef: {
            schemaVersion: '1.0.0',
            resourceKind: 'execution',
            resourceId: requestBody.executionId,
          },
          updatedAt: now,
        },
      });
    }
    if (text.includes('/external-action/compensating')) {
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: requestBody.clientRequestId,
        idempotencyKey: requestBody.idempotencyKey,
        commandSemanticDigest: `sha256:${'f'.repeat(64)}`,
        compensation: {
          schemaVersion: '1.0.0',
          actionId: requestBody.sourceActionId,
          status: 'PREPARED',
        },
      });
    }
    if (text.includes('/external-action/command-outcomes/by-client-request/')) {
      // Echo the original identity back from the request (clientRequestId is
      // in the path; idempotencyKey + semanticDigest are in the query).
      const clientRequestId =
        text.split('/command-outcomes/by-client-request/')[1]?.split('?')[0] ?? '';
      const idempotencyKey =
        new URLSearchParams(text.split('?')[1] ?? '').get('idempotencyKey') ?? '';
      if (behavior.resolveFails) {
        return jsonResponse(503, {
          code: 'NETWORK_FAILURE',
          message: 'Resolve endpoint unavailable.',
        });
      }
      if (behavior.resolveOutcome === 'REJECTED') {
        return jsonResponse(200, {
          schemaVersion: '1.0.0',
          outcome: 'REJECTED',
          originalClientRequestId: clientRequestId,
          originalIdempotencyKey: idempotencyKey,
          rejection: { code: 'EXTERNAL_ACTION_STALE', message: 'The action changed.' },
        });
      }
      if (behavior.resolveOutcome === 'OUTCOME_UNKNOWN') {
        return jsonResponse(200, {
          schemaVersion: '1.0.0',
          outcome: 'OUTCOME_UNKNOWN',
          originalClientRequestId: clientRequestId,
          originalIdempotencyKey: idempotencyKey,
        });
      }
      // COMPLETED must carry the exclusive `completed` outcome with the
      // command type + typed result (strict decoder).
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: clientRequestId,
        originalIdempotencyKey: idempotencyKey,
        completed: {
          commandType: 'frontend.external-action.rollback.v1',
          result: {
            schemaVersion: '1.0.0',
            outcome: 'COMPLETED',
            clientRequestId,
            idempotencyKey,
            commandSemanticDigest: `sha256:${'f'.repeat(64)}`,
            actionId: 'action-1',
            rollback: {
              schemaVersion: '1.0.0',
              rollbackId: 'rollback-1',
              actionId: 'action-1',
              resourceProjectId: 'project-1',
              effectiveProjectId: 'project-1',
              status: 'ROLLED_BACK',
              executionRef: {
                schemaVersion: '1.0.0',
                resourceKind: 'execution',
                resourceId: 'execution-1',
              },
              updatedAt: now,
            },
          },
        },
      });
    }
    if (behavior.childReads) {
      if (text.includes('/external-action/manifests/read')) {
        return jsonResponse(200, { schemaVersion: '1.0.0', manifest: validManifest });
      }
      if (text.includes('/external-action/risk-decisions/read')) {
        return jsonResponse(200, { schemaVersion: '1.0.0', riskDecision });
      }
      if (text.includes('/external-action/executions/read')) {
        return jsonResponse(200, { schemaVersion: '1.0.0', execution });
      }
      if (text.includes('/external-action/executions/attempts')) {
        return jsonResponse(200, { schemaVersion: '1.0.0', attempts: attemptsList });
      }
      if (text.includes('/external-action/verifications/read')) {
        if (behavior.verificationAfterVerify && !verifyExecuted) {
          return jsonResponse(404, {
            code: 'EXTERNAL_ACTION_NOT_FOUND',
            message: 'The External Action verification was not found.',
          });
        }
        return jsonResponse(200, { schemaVersion: '1.0.0', verification });
      }
    }
    return jsonResponse(404, {
      code: 'EXTERNAL_ACTION_NOT_FOUND',
      message: 'The External Action was not found.',
    });
  });
  return { fetchMock, calls, bodies };
};

const createRuntime = (): AppRuntime => ({
  apiClient: {} as unknown as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderWorkspace = (runtime: AppRuntime, initialEntries: string[] = ['/external-action']) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ shell }} />,
        children: [
          {
            path: 'external-action',
            element: <ExternalActionWorkspace />,
          },
        ],
      },
    ],
    { initialEntries },
  );
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

describe('ExternalActionWorkspace (FE-P4-S2 WP5)', () => {
  it('renders the bounded queue and loads the aggregate detail on selection', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));

    await waitFor(
      () => {
        screen.getByText(/manifest-1/);
      },
      { timeout: 10000 },
    );
    screen.getByText(/위험 수준/);
    screen.getByText('ext-7');
    vi.unstubAllGlobals();
  });

  it('shows the access-loss restricted shell and never issues protected child reads', async () => {
    const { fetchMock, calls } = createFetchMock({ detail: restrictedDetail, childReads: false });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));

    await waitFor(
      () => {
        expect(document.querySelector('.restricted-shell')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    const shell = document.querySelector('.restricted-shell');
    expect(shell?.textContent ?? '').toContain('외부 액션 접근이');
    // Review 4865177355 item 3: no protected child read is issued for a
    // Hidden/Restricted action.
    const childReads = calls.filter(
      (call) =>
        call.includes('/manifests/read') ||
        call.includes('/risk-decisions/read') ||
        call.includes('/preflights/read') ||
        call.includes('/executions/read') ||
        call.includes('/verifications/read') ||
        call.includes('/results/read') ||
        call.includes('/approvals/read'),
    );
    expect(childReads).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('restores selection from a deep link and preserves focus', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, ['/external-action?action=action-1&focus=manifest-heading']);

    await waitFor(
      () => {
        screen.getByText(/manifest-1/);
      },
      { timeout: 10000 },
    );
    // The manifest heading is focusable (tabIndex -1) and focused on restore.
    const heading = document.getElementById('manifest-heading');
    expect(heading?.tabIndex).toBe(-1);
    expect(document.activeElement?.id).toBe('manifest-heading');
    vi.unstubAllGlobals();
  });

  it('sends a governed command exactly once on rapid double-click (SUBMITTING lock)', async () => {
    const { fetchMock, calls } = createFetchMock({
      detail: readyDetailResult,
      childReads: true,
      cancelDelayMs: 100,
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByText(/취소 요청/);
      },
      { timeout: 10000 },
    );

    const cancelButton = screen.getByRole('button', { name: '취소 요청' });
    // Rapid double-click while the first request is still in flight.
    await userEvent.click(cancelButton);
    await userEvent.click(cancelButton);
    await waitFor(() => {
      const posted = calls.filter((call) => call.includes('/external-action/cancel'));
      expect(posted.length).toBeGreaterThanOrEqual(1);
    });
    const posted = calls.filter((call) => call.includes('/external-action/cancel'));
    // The SUBMITTING lock makes the governed command exactly-once.
    expect(posted.length).toBe(1);
    vi.unstubAllGlobals();
  });

  it('recovers an OUTCOME_UNKNOWN command by the original identity and adjudicates the result', async () => {
    const { fetchMock, calls } = createFetchMock({
      detail: detailResult, // VERIFIED -> rollback surface
      childReads: true,
      rollbackStatus: 503,
      resolveOutcome: 'REJECTED',
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '롤백' });
      },
      { timeout: 10000 },
    );

    // Rollback returns OUTCOME_UNKNOWN -> recovery state with the original
    // identity and a resolve-only action (never a re-execute button).
    await userEvent.click(screen.getByRole('button', { name: '롤백' }));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '원래 요청으로 복구' });
      },
      { timeout: 10000 },
    );
    expect(screen.queryByRole('button', { name: /재실행|retry/i })).toBeNull();

    // Resolve by the ORIGINAL identity -> REJECTED is adjudicated as a TYPED
    // failure carrying the ACTUAL rejection code (EXTERNAL_ACTION_STALE), not
    // a generic NETWORK_FAILURE (Review 4865620679 item 5).
    await userEvent.click(screen.getByRole('button', { name: '원래 요청으로 복구' }));
    await waitFor(
      () => {
        expect(document.querySelector('.stale-state')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    const failure = document.querySelector('.stale-state');
    expect(failure?.textContent ?? '').toContain('재검증이 필요');
    const resolveCalls = calls.filter((call) =>
      call.includes('/external-action/command-outcomes/by-client-request/'),
    );
    expect(resolveCalls.length).toBe(1);
    expect(resolveCalls[0]).toContain('idempotencyKey=');
    expect(resolveCalls[0]).toContain('semanticDigest=');
    vi.unstubAllGlobals();
  });

  it('restores ALL five resource identities from a deep link and syncs the URL on selection', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    const router = renderWorkspace(runtime, [
      '/external-action?action=action-1&manifest=manifest-1&execution=execution-1&attempt=attempt-1&verification=verification-1',
    ]);

    await waitFor(
      () => {
        screen.getByText(/manifest-1/);
      },
      { timeout: 10000 },
    );
    // Manifest, execution, attempt and verification are all selected from the
    // deep link (Review 4865620679 item 2): four aria-pressed=true controls
    // (the attempt button is `시도 N · status`, not a 선택됨 label).
    expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(4);
    expect(screen.getAllByRole('button', { name: '선택됨' }).length).toBeGreaterThanOrEqual(2);
    // URL keeps all five resource identities.
    expect(router.state.location.search).toContain('action=action-1');
    expect(router.state.location.search).toContain('manifest=manifest-1');
    expect(router.state.location.search).toContain('execution=execution-1');
    expect(router.state.location.search).toContain('attempt=attempt-1');
    expect(router.state.location.search).toContain('verification=verification-1');
    vi.unstubAllGlobals();
  });

  it('fails closed when a deep-link resource id does not match the returned resource', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, ['/external-action?action=action-1&manifest=manifest-X']);

    await waitFor(
      () => {
        screen.getByText('선택한 매니페스트가 현재 액션과 일치하지 않아 표시하지 않습니다.');
      },
      { timeout: 10000 },
    );
    // The mismatched manifest is never mirrored as selected.
    expect(document.querySelector('[aria-pressed="true"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('derives the external revision from targetRef when the detail has no embedded manifest', async () => {
    const { fetchMock } = createFetchMock({
      detail: noEmbeddedManifestDetailResult,
      childReads: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByText(/manifest-1/);
      },
      { timeout: 10000 },
    );
    // Child reads use the targetRef external revision ('ext-7') in their query
    // keys — never an empty external revision (Review 4865620679 item 3).
    // Only CHILD READ keys (scope + 'external-action' + 'action' + operation)
    // carry the learned external revision; the queue key, the detail key and
    // the scope-binding snapshot key legitimately use their own identity and
    // are excluded here. Every child key must use 'ext-7' — never ''.
    const childOperations = [
      'manifest',
      'risk-decision',
      'preflight',
      'execution',
      'attempts',
      'verification',
      'result',
      'audit',
      'approval',
    ];
    const childKeys = runtime.queryClient
      .getQueryCache()
      .findAll()
      .map((query) => query.queryKey)
      .filter((key) => {
        const externalActionIndex = key.indexOf('external-action');
        return (
          String(key[0]) === 'project' &&
          externalActionIndex >= 0 &&
          key[externalActionIndex + 1] === 'action' &&
          childOperations.includes(String(key[key.length - 1]))
        );
      });
    expect(childKeys.length).toBeGreaterThan(0);
    for (const key of childKeys) {
      expect(key[key.length - 2]).toBe('ext-7');
    }
    vi.unstubAllGlobals();
  });

  it('sends the command-common reason draft to every governed command', async () => {
    const { fetchMock, bodies } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '롤백' });
      },
      { timeout: 10000 },
    );
    await userEvent.type(screen.getByLabelText('거버넌스 명령 사유'), '재검토 필요');

    // Rollback carries the typed reason (not the default phrase).
    await userEvent.click(screen.getByRole('button', { name: '롤백' }));
    await waitFor(
      () => {
        expect(bodies.some((entry) => entry.url.includes('/external-action/rollback'))).toBe(true);
      },
      { timeout: 10000 },
    );
    const rollbackBody = bodies.find((entry) => entry.url.includes('/external-action/rollback'));
    expect((rollbackBody?.body as { reason?: string }).reason).toBe('재검토 필요');
    vi.unstubAllGlobals();
  });

  it('refreshes the action after a governed command and removes the stale surface', async () => {
    const { fetchMock, calls } = createFetchMock({
      detail: readyDetailResult,
      childReads: true,
      detailAfterCommand: {
        ...readyDetailResult,
        action: { ...readyDetailResult.action, status: 'CANCELLING' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '취소 요청' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '취소 요청' }));

    // After the command resolves, the exact action query is refetched and the
    // stale CANCELLING surface disappears (Review 4865620679 item 4).
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: '취소 요청' })).toBeNull();
      },
      { timeout: 10000 },
    );
    const detailReads = calls.filter((call) => call.includes('/actions/detail'));
    expect(detailReads.length).toBeGreaterThan(1);
    vi.unstubAllGlobals();
  });

  it('refreshes the exact action queries when an OUTCOME_UNKNOWN resolves as COMPLETED', async () => {
    const { fetchMock, calls } = createFetchMock({
      detail: detailResult,
      childReads: true,
      rollbackStatus: 503,
      resolveOutcome: 'COMPLETED',
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '롤백' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '롤백' }));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '원래 요청으로 복구' });
      },
      { timeout: 10000 },
    );
    const detailReadsBefore = calls.filter((call) => call.includes('/actions/detail')).length;
    await userEvent.click(screen.getByRole('button', { name: '원래 요청으로 복구' }));

    await waitFor(
      () => {
        const detailReads = calls.filter((call) => call.includes('/actions/detail'));
        expect(detailReads.length).toBeGreaterThan(detailReadsBefore);
      },
      { timeout: 10000 },
    );
    // Recovery finished: the resolve-only action is gone and no failure shown.
    expect(screen.queryByRole('button', { name: '원래 요청으로 복구' })).toBeNull();
    expect(document.querySelector('.stale-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('keeps an OUTCOME_UNKNOWN recoverable when resolve returns continued OUTCOME_UNKNOWN', async () => {
    const { fetchMock } = createFetchMock({
      detail: detailResult,
      childReads: true,
      rollbackStatus: 503,
      resolveOutcome: 'OUTCOME_UNKNOWN',
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '롤백' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '롤백' }));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '원래 요청으로 복구' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '원래 요청으로 복구' }));

    // Still OUTCOME_UNKNOWN: the original identity is kept and the resolve-only
    // action remains (Review 4865620679 item 5).
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: '원래 요청으로 복구' })).not.toBeNull();
      },
      { timeout: 10000 },
    );
    vi.unstubAllGlobals();
  });

  it('returns to a recoverable OUTCOME_UNKNOWN (original identity) when the resolve read fails', async () => {
    const { fetchMock } = createFetchMock({
      detail: detailResult,
      childReads: true,
      rollbackStatus: 503,
      resolveFails: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '롤백' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '롤백' }));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '원래 요청으로 복구' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '원래 요청으로 복구' }));

    // The resolve failure keeps the ORIGINAL OUTCOME_UNKNOWN identity and the
    // recovery is unlocked so the user can resolve again.
    await waitFor(
      () => {
        const button = screen.getByRole('button', { name: '원래 요청으로 복구' });
        expect((button as HTMLButtonElement).disabled).toBe(false);
      },
      { timeout: 10000 },
    );
    expect(document.querySelector('.stale-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('refreshes the verification read and preserves focus after a successful Verify', async () => {
    const { fetchMock } = createFetchMock({
      detail: verifyingDetailResult,
      childReads: true,
      verificationAfterVerify: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '검증 실행' });
      },
      { timeout: 10000 },
    );
    // No verification section before the command (the read 404s).
    expect(document.getElementById('verification-heading')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '검증 실행' }));

    // Verify success refreshes the verification read; the heading mounts and
    // focus moves to it (Review 4865620679 item 6).
    await waitFor(
      () => {
        expect(document.getElementById('verification-heading')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    expect(document.activeElement?.id).toBe('verification-heading');
    vi.unstubAllGlobals();
  });

  it('clears every resource selection when Back/Forward removes the parameters from the URL', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    const router = renderWorkspace(runtime, [
      '/external-action?action=action-1&manifest=manifest-1&execution=execution-1&attempt=attempt-1&verification=verification-1',
    ]);
    await waitFor(
      () => {
        expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(4);
      },
      { timeout: 10000 },
    );

    // Back/Forward removes the resource parameters: the URL is the source of
    // truth, so the stale selections must be cleared (Review 4866122577 item 2).
    router.navigate('/external-action?action=action-1');
    await waitFor(
      () => {
        expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
      },
      { timeout: 10000 },
    );
    expect(screen.getAllByRole('button', { name: '선택' }).length).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });

  it('preserves previously selected resource parameters when selecting another resource', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    const router = renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        expect(screen.getAllByRole('button', { name: '선택' }).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 10000 },
    );

    // Select the manifest (first 선택), then the execution (next 선택): the
    // manifest parameter must be preserved in the URL (Review 4866122577 item 2).
    const firstSelect = () => {
      const buttons = screen.getAllByRole('button', { name: '선택' });
      expect(buttons[0]).toBeDefined();
      return buttons[0] as HTMLElement;
    };
    await userEvent.click(firstSelect());
    await waitFor(
      () => {
        expect(router.state.location.search).toContain('manifest=manifest-1');
      },
      { timeout: 10000 },
    );
    await userEvent.click(firstSelect());
    await waitFor(
      () => {
        expect(router.state.location.search).toContain('manifest=manifest-1');
        expect(router.state.location.search).toContain('execution=execution-1');
      },
      { timeout: 10000 },
    );
    vi.unstubAllGlobals();
  });

  it('clears a mismatched deep-link resource from state so governed commands never carry it', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, ['/external-action?action=action-1&execution=execution-X']);

    await waitFor(
      () => {
        screen.getByText('선택한 실행이 현재 액션과 일치하지 않아 표시하지 않습니다.');
      },
      { timeout: 10000 },
    );
    // The mismatched execution id is NOT selected (no aria-pressed control).
    expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
    vi.unstubAllGlobals();
  });

  it('uses a dedicated snapshot bootstrap key and never an empty external revision in resource keys', async () => {
    const { fetchMock } = createFetchMock({ detail: detailResult, childReads: true });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime, [
      '/external-action?action=action-1&manifest=manifest-1&execution=execution-1&attempt=attempt-1&verification=verification-1',
    ]);
    await waitFor(
      () => {
        expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(4);
      },
      { timeout: 10000 },
    );
    const keys = runtime.queryClient
      .getQueryCache()
      .findAll()
      .map((query) => query.queryKey);
    // The snapshot uses a dedicated bootstrap key — NOT a revision-bound
    // resource key (Review 4866122577 item 3).
    const snapshotKeys = keys.filter(
      (key) => key.includes('external-action') && key[key.length - 2] === 'snapshot',
    );
    expect(snapshotKeys.length).toBe(1);
    const snapshotKey = snapshotKeys[0];
    expect(snapshotKey).toBeDefined();
    if (snapshotKey) {
      expect(snapshotKey[snapshotKey.length - 1]).toBe('action-1');
    }
    // Every regular resource key (action-phase) carries a NON-empty external
    // revision — the detail key included.
    const resourceKeys = keys.filter((key) => {
      const index = key.indexOf('external-action');
      return String(key[0]) === 'project' && index >= 0 && key[index + 1] === 'action';
    });
    expect(resourceKeys.length).toBeGreaterThan(0);
    for (const key of resourceKeys) {
      const index = key.indexOf('external-action');
      expect(key[index + 2]).toBe('action-1');
      expect(key[index + 4]).not.toBe('');
    }
    vi.unstubAllGlobals();
  });

  it('keeps the recovery lock during the COMPLETED refresh so no governed command is submitted', async () => {
    const { fetchMock, calls } = createFetchMock({
      detail: detailResult,
      childReads: true,
      rollbackStatus: 503,
      resolveOutcome: 'COMPLETED',
      detailDelayMs: 200,
    });
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await screen.findByText('action-1');
    await userEvent.click(screen.getByText('action-1'));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '롤백' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '롤백' }));
    await waitFor(
      () => {
        screen.getByRole('button', { name: '원래 요청으로 복구' });
      },
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: '원래 요청으로 복구' }));

    // While the delayed refetch is in flight the recovery lock holds: the stale
    // governed surface is disabled and no new command is submitted
    // (Review 4866122577 item 5).
    await waitFor(
      () => {
        const rollback = screen.getByRole('button', { name: '롤백' });
        expect((rollback as HTMLButtonElement).disabled).toBe(true);
      },
      { timeout: 10000 },
    );
    const rollbackPosts = calls.filter((call) => call.includes('/external-action/rollback'));
    expect(rollbackPosts.length).toBe(1);

    // After the refresh settles the recovery lock releases.
    await waitFor(
      () => {
        const rollback = screen.getByRole('button', { name: '롤백' });
        expect((rollback as HTMLButtonElement).disabled).toBe(false);
      },
      { timeout: 10000 },
    );
    expect(screen.queryByRole('button', { name: '원래 요청으로 복구' })).toBeNull();
    vi.unstubAllGlobals();
  });
});
