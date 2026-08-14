import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  GlobalSearchResultView,
  GlobalShellView,
  ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { GlobalSearchDialog } from './global-search-dialog.js';
import { GlobalTools } from './global-tools.js';

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
    {
      id: 'project-2',
      label: 'Research Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [{ id: 'global-search', label: 'Search', availability: 'AVAILABLE' }],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: '1',
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const searchResult: GlobalSearchResultView = {
  schemaVersion: '1.0.0',
  scope: 'ACTIVE_PROJECT',
  results: [
    {
      stableId: 'result-1',
      kind: 'SOURCE',
      label: 'Matching source',
      projectId: 'project-1',
      projectLabel: 'Current Project',
      targetRoute: { routeId: 'sources', href: '/sources' },
    },
  ],
  projectionRevision: 'projection-1',
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

describe('GlobalTools HFM-S1 preservation', () => {
  it('announces the result count after a successful global search', async () => {
    const user = userEvent.setup();
    const searchGlobal = vi.fn(async () => searchResult);

    render(
      <AppProviders runtime={runtime({ searchGlobal })}>
        <MemoryRouter>
          <GlobalSearchDialog shell={shell} open invoker={null} onClose={vi.fn()} />
        </MemoryRouter>
      </AppProviders>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'matching');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('1 search results.')).toBeTruthy();
  });

  it('keeps Project switch mutation errors visible to the owner', async () => {
    const user = userEvent.setup();
    const switchActiveProject = vi.fn(async () => {
      throw new Error('Project switch failed');
    });

    render(
      <AppProviders runtime={runtime({ switchActiveProject })}>
        <MemoryRouter>
          <GlobalTools shell={shell} />
        </MemoryRouter>
      </AppProviders>,
    );

    await user.click(screen.getByRole('button', { name: 'Commands' }));
    await user.click(screen.getByRole('button', { name: /Switch to Research Project/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Project switch failed');
  });
});
