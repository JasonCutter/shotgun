import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  outcomeIndeterminateApiError,
  type AISettingsReadModel,
  type GlobalShellView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import { AICommandSurface } from './ai-command-surface.js';

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

const baseSettings = (): AISettingsReadModel => ({
  projectId: 'project-1',
  mode: 'PROJECT_MANAGED',
  defaultProviderId: 'deepseek',
  currentConfiguration: {
    projectId: 'project-1',
    activeProviderId: 'openai',
    activeModelId: 'gpt-test',
    credentialId: 'credential-1',
    credentialRevision: 7,
    aiConfigurationRevision: 12,
    updatedBy: 'owner-1',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  providers: [
    {
      providerId: 'openai',
      displayName: 'OpenAI',
      status: 'active',
      models: [
        {
          providerId: 'openai',
          modelId: 'gpt-test',
          displayName: 'GPT Test',
          shotgunUsableCapabilities: ['ASK'],
          capabilityRevision: 'cap-1',
        },
      ],
    },
    {
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      status: 'active',
      models: [
        {
          providerId: 'deepseek',
          modelId: 'deepseek-test',
          displayName: 'DeepSeek Test',
          shotgunUsableCapabilities: ['ASK'],
          capabilityRevision: 'cap-2',
        },
      ],
    },
  ],
  credentialStatuses: [
    {
      credentialId: 'credential-1',
      projectId: 'project-1',
      providerId: 'openai',
      credentialRevision: 7,
      lifecycleState: 'active',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
  ],
  privacy: [
    {
      providerId: 'openai',
      deploymentAllowed: true,
      approval: {
        projectId: 'project-1',
        providerId: 'openai',
        approved: false,
        approvalRevision: 4,
        reviewedBy: 'owner-1',
        reviewedAt: '2026-08-14T00:00:00.000Z',
      },
      legacyGeminiCompatibility: false,
    },
  ],
  vaultAvailability: { state: 'AVAILABLE', keyVersion: 'vault-1' },
  legacyGeminiCredentialConfigured: false,
});

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderSurface = (
  commandId: 'ai.configure' | 'ai.test_connection',
  apiClient: Partial<ShotgunApiClient>,
) =>
  render(
    <AppProviders runtime={runtime(apiClient)}>
      <MemoryRouter>
        <AICommandSurface
          open
          commandId={commandId}
          shell={shell}
          invoker={null}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </AppProviders>,
  );

const successfulTest = {
  providerId: 'openai',
  modelId: 'gpt-test',
  status: 'CONNECTED' as const,
  checkedAt: '2026-08-14T00:00:00.000Z',
  safeMessage: 'Connection verified.',
};

const credential = {
  credentialId: 'credential-2',
  projectId: 'project-1',
  providerId: 'deepseek',
  encryptionVersion: 'aes-256-gcm-v1',
  keyVersion: 'vault-1',
  credentialRevision: 8,
  lifecycleState: 'active' as const,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

describe('AICommandSurface', () => {
  it('tests an exact stored credential without persisting configuration', async () => {
    const user = userEvent.setup();
    const testAIConnection = vi.fn<ShotgunApiClient['testAIConnection']>(
      async () => successfulTest,
    );
    const createAICredential = vi.fn();
    const saveAIConfiguration = vi.fn();
    renderSurface('ai.test_connection', {
      getAISettings: vi.fn(async () => baseSettings()),
      testAIConnection,
      createAICredential,
      saveAIConfiguration,
    });

    await user.click(await screen.findByRole('button', { name: 'Test Connection' }));

    expect(testAIConnection).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai',
      modelId: 'gpt-test',
      credentialId: 'credential-1',
      credentialRevision: 7,
    });
    expect(createAICredential).not.toHaveBeenCalled();
    expect(saveAIConfiguration).not.toHaveBeenCalled();
    expect(await screen.findByText(/Connected: Connection verified/)).toBeTruthy();
  });

  it('uses the draft secret only for Test Connection and blocks duplicate execution', async () => {
    const user = userEvent.setup();
    let resolveTest: ((value: typeof successfulTest) => void) | undefined;
    const testAIConnection = vi.fn(
      () => new Promise<typeof successfulTest>((resolve) => (resolveTest = resolve)),
    );
    const createAICredential = vi.fn();
    const saveAIConfiguration = vi.fn();
    renderSurface('ai.test_connection', {
      getAISettings: vi.fn(async () => baseSettings()),
      testAIConnection,
      createAICredential,
      saveAIConfiguration,
    });

    const secret = await screen.findByLabelText('API Key (write-only)');
    await user.type(secret, 'temporary-secret');
    const testButton = screen.getByRole('button', { name: 'Test Connection' });
    await user.click(testButton);
    await user.click(testButton);

    expect(testAIConnection).toHaveBeenCalledTimes(1);
    expect(testAIConnection).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai',
      modelId: 'gpt-test',
      draftSecret: 'temporary-secret',
    });
    expect(createAICredential).not.toHaveBeenCalled();
    expect(saveAIConfiguration).not.toHaveBeenCalled();
    resolveTest?.(successfulTest);
  });

  it('creates a credential once and saves configuration with the exact current revision', async () => {
    const user = userEvent.setup();
    const settings = { ...baseSettings(), currentConfiguration: undefined, credentialStatuses: [] };
    const createAICredential = vi.fn<ShotgunApiClient['createAICredential']>(
      async () => credential,
    );
    const saveAIConfiguration = vi.fn<ShotgunApiClient['saveAIConfiguration']>(
      async () => ({}) as never,
    );
    renderSurface('ai.configure', {
      getAISettings: vi.fn(async () => settings),
      createAICredential,
      saveAIConfiguration,
    });

    await user.type(await screen.findByLabelText('API Key (write-only)'), 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Save AI configuration' }));

    await waitFor(() => expect(saveAIConfiguration).toHaveBeenCalledTimes(1));
    expect(createAICredential).toHaveBeenCalledTimes(1);
    expect(createAICredential).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        providerId: 'deepseek',
        secret: 'new-secret',
        clientRequestId: expect.any(String),
      }),
    );
    expect(saveAIConfiguration).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'deepseek',
      modelId: 'deepseek-test',
      credentialId: 'credential-2',
      credentialRevision: 8,
    });
    expect((screen.getByLabelText('API Key (write-only)') as HTMLInputElement).value).toBe('');
  });

  it('replaces only the exact configuration-bound credential', async () => {
    const user = userEvent.setup();
    const replacement = { ...credential, providerId: 'openai', credentialId: 'credential-1' };
    const replaceAICredential = vi.fn<ShotgunApiClient['replaceAICredential']>(
      async () => replacement,
    );
    const saveAIConfiguration = vi.fn<ShotgunApiClient['saveAIConfiguration']>(
      async () => ({}) as never,
    );
    renderSurface('ai.configure', {
      getAISettings: vi.fn(async () => baseSettings()),
      replaceAICredential,
      saveAIConfiguration,
    });

    await user.type(await screen.findByLabelText('API Key (write-only)'), 'replacement-secret');
    await user.click(screen.getByRole('button', { name: 'Save AI configuration' }));

    await waitFor(() => expect(replaceAICredential).toHaveBeenCalledTimes(1));
    expect(replaceAICredential).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        providerId: 'openai',
        credentialId: 'credential-1',
        expectedRevision: 7,
        secret: 'replacement-secret',
        clientRequestId: expect.any(String),
      }),
    );
    expect(saveAIConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'credential-1', credentialRevision: 8 }),
    );
  });

  it('keeps an uncertain credential write in specialized recovery without resubmitting', async () => {
    const user = userEvent.setup();
    const settings = { ...baseSettings(), currentConfiguration: undefined, credentialStatuses: [] };
    const createAICredential = vi.fn<ShotgunApiClient['createAICredential']>(async () => {
      throw outcomeIndeterminateApiError('credential-request-1');
    });
    const getAICredentialWriteOutcome = vi.fn<ShotgunApiClient['getAICredentialWriteOutcome']>(
      async () => credential,
    );
    const saveAIConfiguration = vi.fn<ShotgunApiClient['saveAIConfiguration']>(
      async () => ({}) as never,
    );
    renderSurface('ai.configure', {
      getAISettings: vi.fn(async () => settings),
      createAICredential,
      getAICredentialWriteOutcome,
      saveAIConfiguration,
    });

    await user.type(await screen.findByLabelText('API Key (write-only)'), 'uncertain-secret');
    await user.click(screen.getByRole('button', { name: 'Save AI configuration' }));
    expect(await screen.findByRole('button', { name: 'Check result' })).toBeTruthy();
    expect(createAICredential).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('API Key (write-only)') as HTMLInputElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(getAICredentialWriteOutcome).toHaveBeenCalledTimes(1));
    expect(getAICredentialWriteOutcome).toHaveBeenCalledWith({
      projectId: 'project-1',
      clientRequestId: expect.stringContaining('ai-credential-write:'),
      providerId: 'deepseek',
      operation: 'CREATE',
    });
    expect(createAICredential).toHaveBeenCalledTimes(1);
    expect(saveAIConfiguration).toHaveBeenCalledTimes(1);
  });

  it('reports a credential-saved partial result without repeating the credential write', async () => {
    const user = userEvent.setup();
    const settings = { ...baseSettings(), currentConfiguration: undefined, credentialStatuses: [] };
    const createAICredential = vi.fn<ShotgunApiClient['createAICredential']>(
      async () => credential,
    );
    const saveAIConfiguration = vi.fn<ShotgunApiClient['saveAIConfiguration']>(async () => {
      throw new Error('stale configuration');
    });
    renderSurface('ai.configure', {
      getAISettings: vi.fn(async () => settings),
      createAICredential,
      saveAIConfiguration,
    });

    await user.type(await screen.findByLabelText('API Key (write-only)'), 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Save AI configuration' }));

    expect(
      await screen.findByText('Credential saved; AI configuration was not changed'),
    ).toBeTruthy();
    expect(createAICredential).toHaveBeenCalledTimes(1);
  });

  it('requires explicit confirmation before revoking an exact credential', async () => {
    const user = userEvent.setup();
    const revokeAICredential = vi.fn<ShotgunApiClient['revokeAICredential']>(
      async () => credential,
    );
    renderSurface('ai.configure', {
      getAISettings: vi.fn(async () => baseSettings()),
      revokeAICredential,
    });

    await user.click(await screen.findByRole('button', { name: 'Revoke credential' }));
    expect(revokeAICredential).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm revoke credential' }));

    await waitFor(() =>
      expect(revokeAICredential).toHaveBeenCalledWith({
        projectId: 'project-1',
        providerId: 'openai',
        credentialId: 'credential-1',
        credentialRevision: 7,
      }),
    );
  });

  it('does not guess when multiple active credentials are available', async () => {
    const user = userEvent.setup();
    const base = baseSettings();
    const settings = {
      ...base,
      currentConfiguration: undefined,
      credentialStatuses: [
        base.credentialStatuses[0]!,
        { ...base.credentialStatuses[0]!, credentialId: 'credential-2', credentialRevision: 2 },
      ],
    };
    const testAIConnection = vi.fn<ShotgunApiClient['testAIConnection']>(
      async () => successfulTest,
    );
    renderSurface('ai.test_connection', {
      getAISettings: vi.fn(async () => settings),
      testAIConnection,
    });

    await user.selectOptions(await screen.findByLabelText('Provider'), 'openai');
    expect(await screen.findByText(/Multiple active credentials/)).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Test Connection' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(testAIConnection).not.toHaveBeenCalled();
  });

  it('requires a second explicit provider privacy approval and keeps it provider-scoped', async () => {
    const user = userEvent.setup();
    const proposeAIProviderPrivacyApproval = vi.fn<
      ShotgunApiClient['proposeAIProviderPrivacyApproval']
    >(async () => ({
      proposalId: 'proposal-1',
      projectId: 'project-1',
      providerId: 'openai',
      approved: true,
      expectedApprovalRevision: 4,
      proposedBy: 'owner-1',
      status: 'PROPOSED',
      createdAt: '2026-08-14T00:00:00.000Z',
    }));
    const approveAIProviderPrivacyProposal = vi.fn<
      ShotgunApiClient['approveAIProviderPrivacyProposal']
    >(async () => ({
      projectId: 'project-1',
      providerId: 'openai',
      approved: true,
      approvalRevision: 5,
      reviewedBy: 'owner-1',
      reviewedAt: '2026-08-14T00:00:00.000Z',
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSurface('ai.configure', {
      getAISettings: vi.fn(async () => baseSettings()),
      proposeAIProviderPrivacyApproval,
      approveAIProviderPrivacyProposal,
    });

    await user.click(
      await screen.findByRole('button', { name: 'Request provider privacy approval' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Approve provider privacy decision' }),
    );

    expect(proposeAIProviderPrivacyApproval).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai',
      approved: true,
      expectedApprovalRevision: 4,
    });
    await waitFor(() =>
      expect(approveAIProviderPrivacyProposal).toHaveBeenCalledWith({
        projectId: 'project-1',
        providerId: 'openai',
        proposalId: 'proposal-1',
        expectedApprovalRevision: 4,
      }),
    );
    expect(screen.queryByText('proposal-1')).toBeNull();
  });
});
