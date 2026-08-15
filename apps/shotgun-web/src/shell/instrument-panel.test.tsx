import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, ProductSessionView, ShotgunApiClient } from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { productSessionQueryKey } from '../app/query-keys.js';
import type { OwnerCommandController } from '../section3/global-tools.js';
import { createSessionCycleState } from '../session/session-query.js';
import { InstrumentPanel } from './instrument-panel.js';

const session: ProductSessionView = {
  apiVersion: '1.0.0',
  principal: {
    id: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
    authenticationMethod: 'session',
  },
  activeProject: { id: 'project-private-id' },
  accessibleProjects: [
    { id: 'project-private-id', isOwner: true },
    { id: 'project-next-id', isOwner: true },
  ],
  session: { expiresAt: null },
};

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-a',
  sessionId: 'session-a',
  activeProject: {
    id: 'project-private-id',
    label: 'Project Alpha',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-private-id',
      label: 'Project Alpha',
      isOwner: true,
      sensitivityClearance: 'private',
    },
    {
      id: 'project-next-id',
      label: 'Project Beta',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: 'shell-1',
  fetchedAt: '2026-08-15T00:00:00.000Z',
};

const controller = (executeCommand = vi.fn()): OwnerCommandController => ({
  executeCommand,
  commands: [
    {
      id: 'project.switch',
      category: 'PROJECT',
      label: 'Switch to Project Beta',
      description: 'Switch Project',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'WRITE',
      presentation: 'DIALOG',
      context: { projectId: 'project-next-id' },
      action: { kind: 'SWITCH_PROJECT', projectId: 'project-next-id' },
    },
  ],
});

const renderInstrument = (sharedController = controller()) => {
  const getAISettings = vi.fn(async () => ({
    projectId: 'project-private-id',
    defaultProviderId: 'provider-a',
    currentConfiguration: { activeProviderId: 'provider-a', activeModelId: 'model-a' },
    providers: [
      {
        providerId: 'provider-a',
        displayName: 'Provider A',
        status: 'active',
        models: [{ modelId: 'model-a', displayName: 'Model A' }],
      },
    ],
    privacy: [],
    credentialStatuses: [],
    vaultAvailability: { state: 'AVAILABLE' },
  }));
  const testAIConnection = vi.fn();
  const queryClient = createFrontendQueryClient();
  queryClient.setQueryData(productSessionQueryKey, session);
  const runtime: AppRuntime = {
    apiClient: {
      getAISettings,
      testAIConnection,
    } as unknown as ShotgunApiClient,
    queryClient,
    sessionCycleState: createSessionCycleState(),
  };

  render(
    <AppProviders runtime={runtime}>
      <MemoryRouter initialEntries={['/sources/source-private-id']}>
        <InstrumentPanel shell={shell} controller={sharedController} />
      </MemoryRouter>
    </AppProviders>,
  );
  return { getAISettings, testAIConnection };
};

describe('InstrumentPanel HFM-S7-C2', () => {
  it('uses the shared project.switch command, keeps identifiers out of visible text, and renders a human breadcrumb', async () => {
    const user = userEvent.setup();
    const executeCommand = vi.fn();
    const { getAISettings, testAIConnection } = renderInstrument(controller(executeCommand));

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Current project' }),
      'project-next-id',
    );

    expect(executeCommand.mock.calls.map(([command]) => command.id)).toEqual(['project.switch']);
    expect(screen.getByLabelText('Workspace breadcrumb').textContent).toBe('Sources / Source');
    expect(await screen.findByText('Provider A / Model A')).toBeTruthy();
    expect(screen.queryByText('project-private-id')).toBeNull();
    expect(screen.queryByText('source-private-id')).toBeNull();
    expect(getAISettings).toHaveBeenCalledWith('project-private-id', expect.any(Object));
    expect(testAIConnection).not.toHaveBeenCalled();
  });
});
