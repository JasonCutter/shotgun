import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi, afterEach } from 'vitest';

import type {
  GlobalShellView,
  ShotgunApiClient,
  SemanticComparisonStatusView,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { createSessionCycleState } from '../session/session-query.js';
import { SemanticCommandSurface } from './semantic-command-surface.js';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: { id: 'project-1', label: 'Current Project', sensitivityClearance: 'private' },
  accessibleProjects: [],
  navigation: [],
  features: [],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: 'notifications-1' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'projection-1',
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const status = (
  overrides: Partial<SemanticComparisonStatusView> = {},
): SemanticComparisonStatusView => ({
  projectId: 'project-1',
  status: 'NOT_CONFIGURED',
  rollout: 'V1_ONLY',
  settingsRevision: 4,
  ...overrides,
});

const snapshot = {
  schemaVersion: '1.0.0',
  targetProjectId: 'project-1',
  settingsRevision: 4,
  policyContextRevision: 2,
  categories: [],
  settings: [],
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const renderSurface = (apiClient: Partial<ShotgunApiClient>) => {
  const runtime: AppRuntime = {
    apiClient: apiClient as ShotgunApiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
  return render(
    <AppProviders runtime={runtime}>
      <ProductLocalizationProvider principalId="principal-1">
        <MemoryRouter>
          <SemanticCommandSurface
            open
            commandId="semantic.enable"
            shell={shell}
            invoker={null}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      </ProductLocalizationProvider>
    </AppProviders>,
  );
};

afterEach(() => vi.restoreAllMocks());

describe('SemanticCommandSurface', () => {
  it('prepares once and only offers activation after READY', async () => {
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(status())
      .mockResolvedValue(status({ status: 'READY' }));
    const prepareSemanticComparison = vi.fn<ShotgunApiClient['prepareSemanticComparison']>(
      async () => status({ status: 'READY' }),
    );
    const applySettingsCommand = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      prepareSemanticComparison,
      getSettingsSnapshot: vi.fn(async () => snapshot as never),
      applySettingsCommand,
    });

    expect(await screen.findByText('Not configured')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Prepare semantic comparison' }));
    await waitFor(() => expect(prepareSemanticComparison).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Enable semantic comparison' })).toBeTruthy();
    expect(applySettingsCommand).not.toHaveBeenCalled();
  });

  it('uses the normal settings authority and confirms READY/V2_ACTIVE after activation', async () => {
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(status({ status: 'READY' }))
      .mockResolvedValue(status({ status: 'READY', rollout: 'V2_ACTIVE' }));
    const applySettingsCommand = vi.fn<ShotgunApiClient['applySettingsCommand']>(async () => ({
      outcome: {} as never,
      resource: { status: 'APPLIED' } as never,
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      prepareSemanticComparison: vi.fn(),
      getSettingsSnapshot: vi.fn(async () => snapshot as never),
      applySettingsCommand,
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enable semantic comparison' }),
    );
    await waitFor(() => expect(applySettingsCommand).toHaveBeenCalledTimes(1));
    expect(applySettingsCommand.mock.calls[0]?.[0]).toMatchObject({
      activeProjectId: 'project-1',
      targetProjectId: 'project-1',
      expectedSettingsRevision: 4,
      observedPolicyContextRevision: 2,
      settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
    });
    expect(await screen.findByText('Semantic comparison is enabled.')).toBeTruthy();
  });
});
