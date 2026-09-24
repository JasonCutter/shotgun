import userEvent from '@testing-library/user-event';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  outcomeIndeterminateApiError,
  type RecompareCandidateResponse,
  type SemanticComparisonStatusView,
  type ShotgunApiClient,
  type SourceCandidateListView,
  type SourceDetailView,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import {
  OwnerCommandControllerProvider,
  type OwnerCommandController,
} from '../section3/global-tools.js';
import type { OwnerCommandDefinition } from '../commands/owner-command-registry.js';
import { SourceDetailWorkspace } from './source-detail-workspace.js';
import { pendingSourceRecompareCommandStorageKey } from './source-recompare-command-storage.js';

const now = '2026-09-15T10:00:00.000Z';

const shell = {
  schemaVersion: '1.0.0' as const,
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    sensitivityClearance: 'private' as const,
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private' as const,
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

const semanticCommand: OwnerCommandDefinition = {
  id: 'semantic.enable',
  category: 'AI',
  label: 'Enable semantic comparison',
  description: 'Prepare semantic comparison and enable it after confirmation',
  aliases: [],
  keywords: ['semantic'],
  availability: 'AVAILABLE',
  risk: 'WRITE',
  presentation: 'DIALOG',
  action: { kind: 'OPEN_SEMANTIC_FLOW', commandId: 'semantic.enable' },
};

const detail: SourceDetailView = {
  schemaVersion: '1.0.0',
  sourceId: 'source-1',
  projectId: 'project-1',
  label: 'Owner notes',
  lifecycle: 'ACTIVE',
  mediaType: 'text/markdown',
  sensitivity: 'internal',
  currentSourceVersionId: 'version-1',
  versionCount: 1,
  previewReadiness: 'READY',
  askUsageState: 'EVIDENCE_READY',
  askUsageExplanation: 'Evidence is ready.',
  capabilities: ['PREVIEW', 'SELECT_FOR_ASK'],
  sourceRevision: 'source-1',
  projectionRevision: 'source-projection-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: now,
  updatedAt: now,
};

const semanticStatus: SemanticComparisonStatusView = {
  projectId: 'project-1',
  status: 'READY',
  rollout: 'V2_ACTIVE',
  settingsRevision: 3,
  embeddingOptions: [],
};

const candidates: SourceCandidateListView = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'version-1',
  items: [
    {
      candidateId: 'candidate-a',
      revisionNumber: 1,
      status: 'READY',
      claimText: 'Candidate A claim',
      sourceVersionId: 'version-1',
      createdAt: now,
    },
    {
      candidateId: 'candidate-b',
      revisionNumber: 1,
      status: 'READY',
      claimText: 'Candidate B claim',
      sourceVersionId: 'version-1',
      createdAt: now,
    },
  ],
  projectionRevision: 'candidate-projection-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
};

const successfulRecompare = (candidateId: string): RecompareCandidateResponse => ({
  commandStatus: 'processed',
  result: {
    candidateId,
    candidateRevisionNumber: 1,
    rollout: 'V2_ACTIVE',
    v1Executed: false,
    v2: { status: 'COMPLETED', comparisonId: `comparison-${candidateId}` },
    review: { status: 'DRAFT_CREATED' },
    comparisonId: `comparison-${candidateId}`,
  },
  reviewChangeSetId: `comparison-v2:${candidateId}`,
});

const createRuntime = (recompareCandidate: ShotgunApiClient['recompareCandidate']): AppRuntime => {
  const apiClient = {
    getSourceDetail: vi.fn(async () => detail),
    getSourceCandidates: vi.fn(async () => candidates),
    getSourceVersionHistory: vi.fn(async () => ({
      schemaVersion: '1.0.0',
      projectId: 'project-1',
      sourceId: 'source-1',
      selectedSourceVersionId: 'version-1',
      versions: [
        {
          sourceVersionId: 'version-1',
          versionNumber: 1,
          contentHash: 'sha256:' + 'a'.repeat(64),
          mediaType: 'text/markdown',
          sizeBytes: 10,
          createdAt: now,
          transformationState: 'READY' as const,
          evidenceCount: 1,
        },
      ],
      projectionRevision: 'source-projection-1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      fetchedAt: now,
    })),
    getSourcePreview: vi.fn(async () => ({
      schemaVersion: '1.0.0',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      projectId: 'project-1',
      mediaType: 'text/markdown',
      contentHash: 'sha256:' + 'a'.repeat(64),
      mode: 'ORIGINAL' as const,
      readiness: 'READY' as const,
      text: 'Source text',
      locators: [],
      capabilities: ['PREVIEW' as const],
      projectionRevision: 'source-projection-1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      fetchedAt: now,
    })),
    getSourceEvidence: vi.fn(async () => ({
      schemaVersion: '1.0.0',
      projectId: 'project-1',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      items: [],
      projectionRevision: 'source-projection-1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      fetchedAt: now,
    })),
    getSemanticComparisonStatus: vi.fn(async () => semanticStatus),
    getPrincipalPreferences: vi.fn(async () => ({ preferences: { locale: 'en-US' }, revision: 1 })),
    recompareCandidate,
  } as unknown as ShotgunApiClient;
  return {
    apiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
};

const renderDetail = (
  runtime: AppRuntime,
  controller: OwnerCommandController = { commands: [], executeCommand: vi.fn() },
) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ shell }} />,
        children: [
          { path: 'sources/:sourceId', element: <SourceDetailWorkspace /> },
          { path: 'review', element: <p>Review route</p> },
          { path: 'settings/ai', element: <p>AI settings</p> },
        ],
      },
    ],
    { initialEntries: ['/sources/source-1?version=version-1'] },
  );
  render(
    <AppProviders runtime={runtime}>
      <OwnerCommandControllerProvider controller={controller}>
        <RouterProvider router={router} />
      </OwnerCommandControllerProvider>
    </AppProviders>,
  );
  return router;
};

describe('Source Detail initial V2 Candidate re-entry', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the semantic setup command from a READY candidate when comparison is not configured', async () => {
    const runtime = createRuntime(vi.fn());
    vi.mocked(runtime.apiClient.getSemanticComparisonStatus).mockResolvedValue({
      ...semanticStatus,
      status: 'NOT_CONFIGURED',
      rollout: 'V1_ONLY',
    });
    const executeCommand = vi.fn();
    const router = renderDetail(runtime, {
      commands: [semanticCommand],
      executeCommand,
    });

    const settingsButtons = await screen.findAllByRole('button', {
      name: 'Open Semantic Comparison settings',
    });
    expect(settingsButtons).toHaveLength(2);
    await userEvent.click(settingsButtons[0]!);

    expect(executeCommand).toHaveBeenCalledWith(semanticCommand, settingsButtons[0]);
    expect(router.state.location.pathname).toBe('/sources/source-1');
    expect(screen.queryByText('AI settings')).toBeNull();
  });

  it('lists both READY Candidates, prevents duplicate clicks, and exposes Review recovery after success', async () => {
    let resolveRequest: ((value: RecompareCandidateResponse) => void) | undefined;
    const recompareCandidate = vi.fn<ShotgunApiClient['recompareCandidate']>(
      () =>
        new Promise<RecompareCandidateResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    renderDetail(createRuntime(recompareCandidate));
    const user = userEvent.setup();

    expect(await screen.findByText('Candidate A claim')).toBeTruthy();
    expect(screen.getByText('Candidate B claim')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Run semantic comparison' });
    expect(buttons).toHaveLength(2);

    await user.click(buttons[0]!);
    const pending = await screen.findByRole('button', { name: 'Running semantic comparison…' });
    expect(pending).toHaveProperty('disabled', true);
    await user.click(pending);
    expect(recompareCandidate).toHaveBeenCalledTimes(1);
    expect(recompareCandidate.mock.calls[0]?.[0]).toMatchObject({
      candidateId: 'candidate-a',
      idempotencyKey: expect.stringContaining('source-recompare:'),
    });
    const firstKey = recompareCandidate.mock.calls[0]?.[0].idempotencyKey;

    resolveRequest?.(successfulRecompare('candidate-a'));
    expect(
      await screen.findByText('Semantic comparison completed and a Review draft is ready.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Review' }).getAttribute('href')).toBe('/review');

    const remainingButtons = screen.getAllByRole('button', { name: 'Run semantic comparison' });
    expect(remainingButtons).toHaveLength(2);
    await user.click(remainingButtons[1]!);
    expect(recompareCandidate).toHaveBeenCalledTimes(2);
    expect(recompareCandidate.mock.calls[1]?.[0]).toMatchObject({ candidateId: 'candidate-b' });
    expect(recompareCandidate.mock.calls[1]?.[0].idempotencyKey).not.toBe(firstKey);
  });

  it('retains the exact Candidate/key after response loss and reuses it after remount', async () => {
    const recompareCandidate = vi
      .fn<ShotgunApiClient['recompareCandidate']>()
      .mockRejectedValueOnce(outcomeIndeterminateApiError('source-recompare-loss'))
      .mockResolvedValueOnce(successfulRecompare('candidate-a'));
    const runtime = createRuntime(recompareCandidate);
    const firstRouter = renderDetail(runtime);
    const user = userEvent.setup();

    await user.click(
      (await screen.findAllByRole('button', { name: 'Run semantic comparison' }))[0]!,
    );
    await screen.findByText(
      'The previous comparison request could not be confirmed. Retry to resolve it safely.',
    );
    expect(
      sessionStorage.getItem(
        pendingSourceRecompareCommandStorageKey(
          'project-1',
          'source-1',
          'version-1',
          'candidate-a',
        ),
      ),
    ).toContain('candidate-a');
    const firstKey = recompareCandidate.mock.calls[0]?.[0].idempotencyKey;
    firstRouter.dispose();
    cleanup();

    renderDetail(runtime);
    expect(
      await screen.findByRole('button', { name: 'Resolve previous comparison request' }),
    ).toBeTruthy();
    expect(recompareCandidate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Resolve previous comparison request' }));
    await screen.findByText('Semantic comparison completed and a Review draft is ready.');
    expect(recompareCandidate).toHaveBeenCalledTimes(2);
    expect(recompareCandidate.mock.calls[1]?.[0]).toEqual({
      candidateId: 'candidate-a',
      idempotencyKey: firstKey,
    });
    expect(
      sessionStorage.getItem(
        pendingSourceRecompareCommandStorageKey(
          'project-1',
          'source-1',
          'version-1',
          'candidate-a',
        ),
      ),
    ).toBeNull();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open Review' })).toBeTruthy());
  });

  it('shows the semantic credential recovery path for a credential-unavailable block', async () => {
    const recompareCandidate = vi.fn<ShotgunApiClient['recompareCandidate']>(
      async () =>
        ({
          commandStatus: 'processed',
          result: {
            candidateId: 'candidate-a',
            candidateRevisionNumber: 1,
            rollout: 'V2_ACTIVE',
            v1Executed: false,
            v2: {
              status: 'BLOCKED',
              reason: 'SHORTLIST_BLOCKED',
              detail:
                'SEMANTIC_UNAVAILABLE:{"semanticExecution":"CREDENTIAL_UNAVAILABLE","semanticSafeFailureCode":"CONFIGURATION_REQUIRED"}',
            },
          },
        }) as RecompareCandidateResponse,
    );
    const executeCommand = vi.fn();
    renderDetail(createRuntime(recompareCandidate), {
      commands: [semanticCommand],
      executeCommand,
    });
    const user = userEvent.setup();

    await user.click(
      (await screen.findAllByRole('button', { name: 'Run semantic comparison' }))[0]!,
    );
    expect(
      await screen.findByText(
        'The embedding credential needs attention. Replace it in Semantic Comparison settings, then prepare semantic comparison again.',
      ),
    ).toBeTruthy();
    const openSettings = screen.getByRole('button', {
      name: 'Open Semantic Comparison settings',
    });
    await user.click(openSettings);
    expect(executeCommand).toHaveBeenCalledWith(semanticCommand, openSettings);
  });
});
