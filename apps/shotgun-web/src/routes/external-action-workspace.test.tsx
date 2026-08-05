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

const createFetchMock = (detail: unknown, withChildReads: boolean) => {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const text = String(url);
    if (text.endsWith('/api/v1/security/csrf')) {
      return jsonResponse(200, { csrfToken: 'csrf-ext' });
    }
    if (text.includes('/external-action/queue')) {
      return jsonResponse(200, queueResult);
    }
    if (text.includes('/external-action/actions/detail')) {
      return jsonResponse(200, detail);
    }
    if (withChildReads) {
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
  return fetchMock;
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
    const fetchMock = createFetchMock(detailResult, true);
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await waitFor(() => {
      screen.getByText('External Actions');
    });
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

  it('shows the access-loss restricted shell without protected payload', async () => {
    const fetchMock = createFetchMock(restrictedDetail, false);
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createRuntime();
    renderWorkspace(runtime);

    await waitFor(() => {
      screen.getByText('action-1');
    });
    await userEvent.click(screen.getByText('action-1'));

    // The access-loss restricted shell renders without the protected payload.
    await waitFor(
      () => {
        expect(document.querySelector('.restricted-shell')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    const shell = document.querySelector('.restricted-shell');
    expect(shell?.textContent ?? '').toContain('외부 액션 접근이');
    // Protected payload is never rendered for a restricted action.
    expect(screen.queryByText(/위험 수준/)).toBeNull();
    expect(screen.queryByText(/manifest-1/)).toBeNull();
    vi.unstubAllGlobals();
  });
});
