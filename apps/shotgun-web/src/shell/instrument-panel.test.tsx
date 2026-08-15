import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  AISettingsReadModel,
  GlobalShellView,
  ProductSessionView,
  ShotgunApiClient,
} from '@shotgun/api-client';

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

const baseAISettings = (): AISettingsReadModel => ({
  projectId: 'project-private-id',
  mode: 'PROJECT_MANAGED',
  defaultProviderId: 'deepseek',
  currentConfiguration: {
    projectId: 'project-private-id',
    activeProviderId: 'provider-a',
    activeModelId: 'model-a',
    credentialId: 'credential-a',
    credentialRevision: 1,
    aiConfigurationRevision: 1,
    updatedBy: 'principal-a',
    updatedAt: '2026-08-15T00:00:00.000Z',
  },
  providers: [
    {
      providerId: 'provider-a',
      displayName: 'Provider A',
      status: 'active',
      models: [
        {
          providerId: 'provider-a',
          modelId: 'model-a',
          displayName: 'Model A',
          shotgunUsableCapabilities: [],
          capabilityRevision: '1',
        },
      ],
    },
  ],
  privacy: [],
  credentialStatuses: [],
  vaultAvailability: { state: 'AVAILABLE', keyVersion: '1' },
  legacyGeminiCredentialConfigured: false,
});

const renderInstrument = ({
  sharedController = controller(),
  settings = baseAISettings(),
}: {
  readonly sharedController?: OwnerCommandController;
  readonly settings?: AISettingsReadModel;
} = {}) => {
  const getAISettings = vi.fn(async () => settings);
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

describe('InstrumentPanel HFM-S7-C2R authority', () => {
  it('uses exact PROJECT_MANAGED provider/model descriptors and the shared project.switch command', async () => {
    const user = userEvent.setup();
    const executeCommand = vi.fn();
    const { getAISettings, testAIConnection } = renderInstrument({
      sharedController: controller(executeCommand),
    });

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Current project' }),
      'project-next-id',
    );

    expect(executeCommand.mock.calls.map(([command]) => command.id)).toEqual(['project.switch']);
    expect(screen.getByLabelText('Workspace breadcrumb').textContent).toBe('Sources / Source');
    expect(await screen.findByText('Provider A / Model A')).toBeTruthy();
    expect(screen.getByText('Configured')).toBeTruthy();
    expect(screen.queryByText('project-private-id')).toBeNull();
    expect(screen.queryByText('source-private-id')).toBeNull();
    expect(getAISettings).toHaveBeenCalledWith('project-private-id', expect.any(Object));
    expect(testAIConnection).not.toHaveBeenCalled();
  });

  it('does not infer provider, model, or Configured state when currentConfiguration is absent', async () => {
    const settings = {
      ...baseAISettings(),
      mode: 'UNCONFIGURED' as const,
      currentConfiguration: undefined,
    };
    const { testAIConnection } = renderInstrument({ settings });

    expect(screen.queryByLabelText('Configured AI provider and model')).toBeNull();
    expect(screen.queryByText('Configured', { exact: true })).toBeNull();
    expect(screen.queryByText('Provider A / Model A')).toBeNull();
    expect(testAIConnection).not.toHaveBeenCalled();
  });

  it('does not infer a legacy compatibility runtime identity from defaultProviderId', () => {
    const settings = {
      ...baseAISettings(),
      mode: 'LEGACY_GEMINI_COMPATIBILITY' as const,
      currentConfiguration: undefined,
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          status: 'active' as const,
          models: [
            {
              providerId: 'deepseek',
              modelId: 'deepseek-default',
              displayName: 'Default model',
              shotgunUsableCapabilities: [],
              capabilityRevision: '1',
            },
          ],
        },
      ],
    };
    renderInstrument({ settings });

    expect(screen.queryByLabelText('Configured AI provider and model')).toBeNull();
    expect(screen.queryByText('Configured', { exact: true })).toBeNull();
    expect(screen.queryByText('DeepSeek / Default model')).toBeNull();
  });

  it('hides the AI display when the exact configured provider descriptor is absent', () => {
    const settings = {
      ...baseAISettings(),
      currentConfiguration: {
        ...baseAISettings().currentConfiguration!,
        activeProviderId: 'provider-missing',
      },
    };
    renderInstrument({ settings });

    expect(screen.queryByLabelText('Configured AI provider and model')).toBeNull();
    expect(screen.queryByText('Configured', { exact: true })).toBeNull();
    expect(screen.queryByText('Provider A / Model A')).toBeNull();
  });

  it('hides the AI display when the exact configured model descriptor is absent', () => {
    const settings = {
      ...baseAISettings(),
      currentConfiguration: {
        ...baseAISettings().currentConfiguration!,
        activeModelId: 'model-missing',
      },
    };
    renderInstrument({ settings });

    expect(screen.queryByLabelText('Configured AI provider and model')).toBeNull();
    expect(screen.queryByText('Configured', { exact: true })).toBeNull();
    expect(screen.queryByText('Provider A / Model A')).toBeNull();
  });
});
