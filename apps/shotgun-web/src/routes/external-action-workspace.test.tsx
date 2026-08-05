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

type FetchBehavior = {
  readonly detail: unknown;
  readonly childReads: boolean;
  readonly cancelDelayMs?: number;
  readonly rollbackStatus?: number;
  readonly resolveOutcome?: 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
};

const createFetchMock = (behavior: FetchBehavior) => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const text = String(url);
    calls.push(text);
    if (text.endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-ext' });
    }
    if (text.includes('/external-action/queue')) {
      return jsonResponse(200, queueResult);
    }
    if (text.includes('/external-action/actions/detail')) {
      return jsonResponse(200, behavior.detail);
    }
    if (text.includes('/external-action/actions/read')) {
      // Aggregate snapshot read used to bind the deep-link restore identity.
      return jsonResponse(200, { schemaVersion: '1.0.0', action: detailResult.action });
    }
    if (text.includes('/external-action/cancel')) {
      if (behavior.cancelDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, behavior.cancelDelayMs));
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: 'client-cancel-1',
        idempotencyKey: 'idem-cancel-1',
        commandSemanticDigest: `sha256:${'f'.repeat(64)}`,
        actionId: 'action-1',
        status: 'CANCELLING',
      });
    }
    if (text.includes('/external-action/rollback')) {
      if (behavior.rollbackStatus) {
        return jsonResponse(behavior.rollbackStatus, {
          code: 'ACTION_OUTCOME_UNKNOWN',
          message: 'Rollback outcome is unresolved.',
        });
      }
    }
    if (text.includes('/external-action/command-outcomes/by-client-request/')) {
      // Echo the original identity back from the request (clientRequestId is
      // in the path; idempotencyKey + semanticDigest are in the query).
      const clientRequestId =
        text.split('/command-outcomes/by-client-request/')[1]?.split('?')[0] ?? '';
      const idempotencyKey =
        new URLSearchParams(text.split('?')[1] ?? '').get('idempotencyKey') ?? '';
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
    }
    if (behavior.childReads) {
      if (text.includes('/external-action/manifests/read')) {
        return jsonResponse(200, { schemaVersion: '1.0.0', manifest: validManifest });
      }
      if (text.includes('/external-action/risk-decisions/read')) {
        return jsonResponse(200, { schemaVersion: '1.0.0', riskDecision });
      }
    }
    return jsonResponse(404, {
      code: 'EXTERNAL_ACTION_NOT_FOUND',
      message: 'The External Action was not found.',
    });
  });
  return { fetchMock, calls };
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

    // Resolve by the ORIGINAL identity -> REJECTED is adjudicated as failure.
    await userEvent.click(screen.getByRole('button', { name: '원래 요청으로 복구' }));
    await waitFor(
      () => {
        expect(document.querySelector('.stale-state')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    const failure = document.querySelector('.stale-state');
    expect(failure?.textContent ?? '').toContain('거부되었습니다');
    const resolveCalls = calls.filter((call) =>
      call.includes('/external-action/command-outcomes/by-client-request/'),
    );
    expect(resolveCalls.length).toBe(1);
    expect(resolveCalls[0]).toContain('idempotencyKey=');
    expect(resolveCalls[0]).toContain('semanticDigest=');
    vi.unstubAllGlobals();
  });
});
