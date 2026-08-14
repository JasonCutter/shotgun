import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  outcomeIndeterminateApiError,
  type GlobalShellView,
  type ProjectListItemView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../app/query-client.js';
import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createSessionCycleState } from '../session/session-query.js';
import { ProjectCommandSurface } from './project-command-surface.js';

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

const project: ProjectListItemView = {
  id: 'project-1',
  name: 'Current Project',
  description: '',
  isOwner: true,
  status: 'ACTIVE',
  active: true,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  revision: 3,
  capability: {
    canRename: true,
    canArchive: true,
    canRestore: false,
    canDelete: true,
    canManagePolicies: true,
  },
};

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const mutationResult = {
  outcome: {} as never,
  resource: project,
} as Awaited<ReturnType<ShotgunApiClient['createProject']>>;

const activeProjectWithoutRename: ProjectListItemView = {
  ...project,
  capability: {
    ...project.capability,
    canRename: false,
  },
};

const eligibleOtherProject: ProjectListItemView = {
  ...project,
  id: 'project-2',
  name: 'Other Project',
  active: false,
  capability: {
    ...project.capability,
    canRename: true,
  },
};

const renderSurface = (
  commandId: 'project.create' | 'project.rename' | 'project.archive' | 'project.delete_request',
  apiClient: Partial<ShotgunApiClient>,
) =>
  render(
    <AppProviders runtime={runtime(apiClient)}>
      <MemoryRouter>
        <ProjectCommandSurface
          open
          commandId={commandId}
          shell={shell}
          invoker={null}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </AppProviders>,
  );

describe('ProjectCommandSurface', () => {
  it('uses createProject with the existing binding and blocks duplicate submission while pending', async () => {
    const user = userEvent.setup();
    let resolveCreate: (() => void) | undefined;
    const createProject = vi.fn<ShotgunApiClient['createProject']>(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve(mutationResult);
        }),
    );
    renderSurface('project.create', { getProjects: vi.fn(async () => [project]), createProject });

    await user.type(await screen.findByRole('textbox', { name: 'Project key' }), 'new-project');
    await user.type(await screen.findByRole('textbox', { name: 'Project name' }), 'New Project');
    const submit = await screen.findByRole('button', { name: 'Create Project' });
    await user.click(submit);
    await user.click(submit);

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-project',
        name: 'New Project',
        activeProjectId: 'project-1',
        targetProjectId: 'project-1',
      }),
    );
    resolveCreate?.();
  });

  it('renames through updateProject with the server revision binding', async () => {
    const user = userEvent.setup();
    const updateProject = vi.fn<ShotgunApiClient['updateProject']>(async () => mutationResult);
    renderSurface('project.rename', { getProjects: vi.fn(async () => [project]), updateProject });

    await user.type(
      await screen.findByRole('textbox', { name: 'New Project name' }),
      'Renamed Project',
    );
    await user.click(await screen.findByRole('button', { name: 'Rename Project' }));

    expect(updateProject).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        name: 'Renamed Project',
        expectedRevision: 3,
        activeProjectId: 'project-1',
        targetProjectId: 'project-1',
        resourceProjectId: 'project-1',
      }),
    );
  });

  it('requires explicit selection instead of targeting the first eligible Project', async () => {
    const user = userEvent.setup();
    const updateProject = vi.fn<ShotgunApiClient['updateProject']>(async () => mutationResult);
    renderSurface('project.rename', {
      getProjects: vi.fn(async () => [activeProjectWithoutRename, eligibleOtherProject]),
      updateProject,
    });

    expect(await screen.findByText('Select the Project for this command.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'New Project name' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: /Other Project/ }));
    await user.type(
      await screen.findByRole('textbox', { name: 'New Project name' }),
      'Renamed Project',
    );
    await user.click(await screen.findByRole('button', { name: 'Rename Project' }));

    expect(updateProject).toHaveBeenCalledWith(
      'project-2',
      expect.objectContaining({ targetProjectId: 'project-2' }),
    );
  });

  it('does not archive until explicit confirmation', async () => {
    const user = userEvent.setup();
    const archiveProject = vi.fn<ShotgunApiClient['archiveProject']>(async () => mutationResult);
    renderSurface('project.archive', { getProjects: vi.fn(async () => [project]), archiveProject });

    expect(archiveProject).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Confirm Archive' }));
    expect(archiveProject).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ expectedRevision: 3, targetProjectId: 'project-1' }),
    );
  });

  it('does not submit deletion until explicit destructive confirmation', async () => {
    const user = userEvent.setup();
    const requestDeleteProject = vi.fn<ShotgunApiClient['requestDeleteProject']>(
      async () => mutationResult,
    );
    renderSurface('project.delete_request', {
      getProjects: vi.fn(async () => [project]),
      requestDeleteProject,
    });

    expect(requestDeleteProject).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Confirm Deletion Request' }));
    expect(requestDeleteProject).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ expectedRevision: 3, targetProjectId: 'project-1' }),
    );
  });

  it('resolves an outcome-unknown write by its original identity without resubmitting', async () => {
    const user = userEvent.setup();
    const updateProject = vi.fn<ShotgunApiClient['updateProject']>(async () => {
      throw outcomeIndeterminateApiError('request-from-error');
    });
    const getFrontendCommandOutcomeByClientRequestId = vi.fn<
      ShotgunApiClient['getFrontendCommandOutcomeByClientRequestId']
    >(
      async () =>
        ({ outcomeState: 'COMPLETED' }) as Awaited<
          ReturnType<ShotgunApiClient['getFrontendCommandOutcomeByClientRequestId']>
        >,
    );
    renderSurface('project.rename', {
      getProjects: vi.fn(async () => [project]),
      updateProject,
      getFrontendCommandOutcomeByClientRequestId,
    });

    await user.type(
      await screen.findByRole('textbox', { name: 'New Project name' }),
      'Renamed Project',
    );
    await user.click(await screen.findByRole('button', { name: 'Rename Project' }));

    const originalClientRequestId = updateProject.mock.calls[0]?.[1].clientRequestId;
    expect(updateProject).toHaveBeenCalledTimes(1);
    expect(originalClientRequestId).toBeTruthy();
    expect(screen.queryByText('request-from-error')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Check result' }));
    await waitFor(() =>
      expect(getFrontendCommandOutcomeByClientRequestId).toHaveBeenCalledWith(
        originalClientRequestId,
      ),
    );
    expect(updateProject).toHaveBeenCalledTimes(1);
  });
});
