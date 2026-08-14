import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  outcomeIndeterminateApiError,
  type GlobalShellView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { PreferencesCommandSurface } from './preferences-command-surface.js';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Current Project',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Current Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
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

const persisted = {
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
  dateDisplay: 'YYYY-MM-DD',
  screenDensity: 'COMFORTABLE',
  reducedMotion: false,
  futurePreference: 'preserve',
};

const mutationResult = {} as Awaited<ReturnType<ShotgunApiClient['updatePrincipalPreferences']>>;

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderSurface = (
  commandId: 'preferences.locale' | 'preferences.timezone' | 'preferences.display',
  apiClient: Partial<ShotgunApiClient>,
) =>
  render(
    <AppProviders runtime={runtime(apiClient)}>
      <MemoryRouter>
        <PreferencesCommandSurface
          open
          commandId={commandId}
          shell={shell}
          invoker={null}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </AppProviders>,
  );

const getPreferences = vi.fn<ShotgunApiClient['getPrincipalPreferences']>(async () => ({
  preferences: persisted,
  revision: 7,
}));

describe('PreferencesCommandSurface', () => {
  it('initializes locale from persisted data and preserves unrelated keys', async () => {
    const user = userEvent.setup();
    const updatePrincipalPreferences = vi.fn<ShotgunApiClient['updatePrincipalPreferences']>(
      async () => mutationResult,
    );
    renderSurface('preferences.locale', {
      getPrincipalPreferences: getPreferences,
      updatePrincipalPreferences,
    });

    const locale = await screen.findByRole('combobox', { name: 'Locale' });
    expect((locale as HTMLSelectElement).value).toBe('ko-KR');
    await user.selectOptions(locale, 'en-US');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updatePrincipalPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectId: 'project-1',
        targetProjectId: 'project-1',
        resourceProjectId: 'project-1',
        expectedPreferenceRevision: 7,
        preferences: { ...persisted, locale: 'en-US' },
      }),
    );
  });

  it('updates timezone without replacing display or future preference values', async () => {
    const user = userEvent.setup();
    const updatePrincipalPreferences = vi.fn<ShotgunApiClient['updatePrincipalPreferences']>(
      async () => mutationResult,
    );
    renderSurface('preferences.timezone', {
      getPrincipalPreferences: getPreferences,
      updatePrincipalPreferences,
    });

    const timezone = await screen.findByRole('combobox', { name: 'Timezone' });
    expect((timezone as HTMLSelectElement).value).toBe('Asia/Seoul');
    await user.selectOptions(timezone, 'UTC');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updatePrincipalPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPreferenceRevision: 7,
        preferences: { ...persisted, timezone: 'UTC' },
      }),
    );
  });

  it('initializes and saves all display fields as one preserved operation', async () => {
    const user = userEvent.setup();
    const updatePrincipalPreferences = vi.fn<ShotgunApiClient['updatePrincipalPreferences']>(
      async () => mutationResult,
    );
    renderSurface('preferences.display', {
      getPrincipalPreferences: getPreferences,
      updatePrincipalPreferences,
    });

    const dateDisplay = await screen.findByRole('combobox', { name: 'Date & Time Format' });
    const screenDensity = screen.getByRole('combobox', { name: 'Screen Density' });
    const reducedMotion = screen.getByRole('checkbox', { name: 'Reduce Motion / Animations' });
    expect((dateDisplay as HTMLSelectElement).value).toBe('YYYY-MM-DD');
    expect((screenDensity as HTMLSelectElement).value).toBe('COMFORTABLE');
    expect((reducedMotion as HTMLInputElement).checked).toBe(false);

    await user.selectOptions(dateDisplay, 'DD/MM/YYYY');
    await user.selectOptions(screenDensity, 'COMPACT');
    await user.click(reducedMotion);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updatePrincipalPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPreferenceRevision: 7,
        preferences: {
          ...persisted,
          dateDisplay: 'DD/MM/YYYY',
          screenDensity: 'COMPACT',
          reducedMotion: true,
        },
      }),
    );
  });

  it('submits a pending preference write once even when Save is attempted twice', async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    const updatePrincipalPreferences = vi.fn<ShotgunApiClient['updatePrincipalPreferences']>(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve(mutationResult);
        }),
    );
    renderSurface('preferences.locale', {
      getPrincipalPreferences: getPreferences,
      updatePrincipalPreferences,
    });

    const save = await screen.findByRole('button', { name: 'Save' });
    await user.click(save);
    await user.click(save);

    expect(updatePrincipalPreferences).toHaveBeenCalledTimes(1);
    resolveUpdate?.();
  });

  it('resolves outcome-unknown by original identity without resubmitting', async () => {
    const user = userEvent.setup();
    const updatePrincipalPreferences = vi.fn<ShotgunApiClient['updatePrincipalPreferences']>(
      async () => {
        throw outcomeIndeterminateApiError('raw-preference-request-id');
      },
    );
    const getFrontendCommandOutcomeByClientRequestId = vi.fn<
      ShotgunApiClient['getFrontendCommandOutcomeByClientRequestId']
    >(
      async () =>
        ({ outcomeState: 'COMPLETED' }) as Awaited<
          ReturnType<ShotgunApiClient['getFrontendCommandOutcomeByClientRequestId']>
        >,
    );
    renderSurface('preferences.locale', {
      getPrincipalPreferences: getPreferences,
      updatePrincipalPreferences,
      getFrontendCommandOutcomeByClientRequestId,
    });

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Locale' }), 'en-US');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const originalClientRequestId = updatePrincipalPreferences.mock.calls[0]?.[0].clientRequestId;
    expect(originalClientRequestId).toBeTruthy();
    expect(screen.queryByText('raw-preference-request-id')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Check result' }));
    await waitFor(() =>
      expect(getFrontendCommandOutcomeByClientRequestId).toHaveBeenCalledWith(
        originalClientRequestId,
      ),
    );
    expect(updatePrincipalPreferences).toHaveBeenCalledTimes(1);
  });
});
