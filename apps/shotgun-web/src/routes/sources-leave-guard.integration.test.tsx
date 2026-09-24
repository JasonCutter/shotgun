import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, ShotgunApiClient, SourceLibraryPageView } from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { createSessionCycleState } from '../session/session-query.js';
import { SourcesWorkspace } from './sources-workspace.js';

const now = '2026-07-30T12:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-a',
    label: 'Project A',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-a',
      label: 'Project A',
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

const libraryPage: SourceLibraryPageView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-a',
  items: [],
  queryDigest: hash,
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
  stale: false,
};

const createRuntime = (): AppRuntime => ({
  apiClient: {
    listSources: vi.fn(async () => libraryPage),
  } as unknown as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const ShellOutlet = () => {
  const { getLeaveState } = useLeaveGuard();
  return (
    <>
      <Link to="/home">Home</Link>
      <button
        type="button"
        onClick={() =>
          document.body.setAttribute('data-leave-state', JSON.stringify(getLeaveState()))
        }
      >
        Inspect leave state
      </button>
      <Outlet context={{ shell }} />
    </>
  );
};

const renderWorkspace = () => {
  const runtime = createRuntime();
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ShellOutlet />,
        children: [
          { path: 'sources', element: <SourcesWorkspace /> },
          { path: 'home', element: <p>Home workspace</p> },
        ],
      },
    ],
    { initialEntries: ['/sources?view=add'] },
  );

  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

const addDirectTextDraft = async (label: string, text: string) => {
  await userEvent.clear(screen.getByLabelText('Label'));
  await userEvent.type(screen.getByLabelText('Label'), label);
  await userEvent.clear(screen.getByLabelText('Direct Text'));
  await userEvent.type(screen.getByLabelText('Direct Text'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Add intake draft' }));
};

describe('Sources Workspace Leave Guard integration', () => {
  it('keeps an unsubmitted file draft when navigation is canceled and discards it only by choice', async () => {
    const user = userEvent.setup();
    const router = renderWorkspace();
    await screen.findByRole('heading', { name: 'Sources', level: 1 });

    await user.selectOptions(screen.getByLabelText('Input type'), 'FILE');
    await user.upload(
      screen.getByLabelText('File'),
      new File(['draft content'], 'sample.txt', { type: 'text/plain' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add intake draft' }));
    expect(screen.getByRole('button', { name: 'Submit drafts' })).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(router.state.location.pathname).toBe('/sources');
    expect(screen.getByRole('dialog', { name: 'Leave with unsubmitted drafts?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('sample.txt')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/sources');

    await user.click(screen.getByRole('link', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'Discard drafts and leave' }));
    expect(await screen.findByText('Home workspace')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/home');
  });

  it('keeps the Guard active after a partial delete and releases it after the last delete', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: 'Sources', level: 1 });

    await addDirectTextDraft('Draft A', 'First draft');
    await addDirectTextDraft('Draft B', 'Second draft');

    await userEvent.click(screen.getByRole('button', { name: 'Remove Draft A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inspect leave state' }));
    expect(document.body.getAttribute('data-leave-state')).toContain('"hasUnsavedDraft":true');

    await userEvent.click(screen.getByRole('button', { name: 'Remove Draft B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inspect leave state' }));
    expect(document.body.getAttribute('data-leave-state')).toContain('"hasUnsavedDraft":false');
  });

  it('releases the Guard immediately after discarding the queue', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: 'Sources', level: 1 });

    await addDirectTextDraft('Draft A', 'Transient draft');
    await userEvent.click(screen.getByRole('button', { name: 'Discard all drafts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inspect leave state' }));

    expect(document.body.getAttribute('data-leave-state')).toContain('"hasUnsavedDraft":false');
    expect(screen.getByText('No drafts yet.')).toBeTruthy();
  });
});
