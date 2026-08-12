import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  AICredentialMetadata,
  AISettingsReadModel,
  ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../../app/query-client.js';
import { AppProviders, type AppRuntime } from '../../app/providers.js';
import { createSessionCycleState } from '../../session/session-query.js';
import { AIWorkspace } from './ai-workspace.js';

const now = '2026-08-12T09:00:00.000Z';

const session = {
  apiVersion: '2.0.0' as const,
  principal: {
    id: 'principal-1',
    actor: { type: 'user' as const, id: 'user-1' },
    authenticationMethod: 'session' as const,
  },
  activeProject: { id: 'project-1' },
  accessibleProjects: [{ id: 'project-1', isOwner: true }],
  session: { expiresAt: now },
};

const credential: AICredentialMetadata = {
  credentialId: 'credential-1',
  projectId: 'project-1',
  providerId: 'deepseek',
  encryptionVersion: 'a2-v1',
  keyVersion: 'test',
  credentialRevision: 1,
  lifecycleState: 'active',
  createdAt: now,
  updatedAt: now,
};

const makeSettings = (overrides: Partial<AISettingsReadModel> = {}): AISettingsReadModel => ({
  projectId: 'project-1',
  mode: 'UNCONFIGURED',
  defaultProviderId: 'deepseek',
  providers: [
    {
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      status: 'active',
      models: [
        {
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          displayName: 'DeepSeek V4 Flash',
          shotgunUsableCapabilities: ['text', 'structuredOutput'],
          capabilityRevision: 'model-catalog:v1',
        },
      ],
    },
    {
      providerId: 'openai',
      displayName: 'OpenAI',
      status: 'active',
      models: [
        {
          providerId: 'openai',
          modelId: 'gpt-5.6-luna',
          displayName: 'GPT-5.6 Luna',
          shotgunUsableCapabilities: ['text', 'structuredOutput'],
          capabilityRevision: 'model-catalog:v1',
        },
      ],
    },
    {
      providerId: 'google-gemini',
      displayName: 'Google Gemini',
      status: 'active',
      models: [
        {
          providerId: 'google-gemini',
          modelId: 'gemini-3.6-flash',
          displayName: 'Gemini 3.6 Flash',
          shotgunUsableCapabilities: ['text', 'structuredOutput'],
          capabilityRevision: 'model-catalog:v1',
        },
      ],
    },
  ],
  credentialStatuses: [],
  privacy: ['deepseek', 'openai', 'google-gemini'].map((providerId) => ({
    providerId,
    deploymentAllowed: false,
    legacyGeminiCompatibility: false,
  })),
  vaultAvailability: { state: 'AVAILABLE', keyVersion: 'test' },
  legacyGeminiCredentialConfigured: false,
  ...overrides,
});

const renderWorkspace = (apiClient: Partial<ShotgunApiClient>, settings = makeSettings()) => {
  const api = {
    getSession: vi.fn().mockResolvedValue(session),
    getAISettings: vi.fn().mockResolvedValue(settings),
    testAIConnection: vi.fn().mockResolvedValue({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      status: 'CONNECTED' as const,
      checkedAt: now,
      safeMessage: 'Provider connection succeeded.',
    }),
    createAICredential: vi.fn().mockResolvedValue(credential),
    replaceAICredential: vi.fn().mockResolvedValue(credential),
    saveAIConfiguration: vi.fn().mockResolvedValue({
      projectId: 'project-1',
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-v4-flash',
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
      aiConfigurationRevision: 1,
      updatedBy: 'principal-1',
      updatedAt: now,
    }),
    revokeAICredential: vi.fn().mockResolvedValue({ ...credential, lifecycleState: 'revoked' }),
    removeAICredential: vi.fn().mockResolvedValue({ ...credential, lifecycleState: 'removed' }),
    ...apiClient,
  } as unknown as ShotgunApiClient;
  const runtime: AppRuntime = {
    apiClient: api,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <Outlet
            context={{ requestConfirmation: (_message: string, action: () => void) => action() }}
          />
        ),
        children: [{ path: 'settings/ai', element: <AIWorkspace /> }],
      },
    ],
    { initialEntries: ['/settings/ai?targetProjectId=project-1'] },
  );
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { api, router };
};

describe('AIWorkspace (A7 Settings → AI)', () => {
  it('uses the server descriptor set and defaults a fresh Project to DeepSeek', async () => {
    renderWorkspace({});

    expect(await screen.findByRole('heading', { name: 'Settings → AI' })).toBeTruthy();
    expect((screen.getByLabelText('AI Provider') as HTMLSelectElement).value).toBe('deepseek');
    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Google Gemini' })).toBeTruthy();
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('deepseek-v4-flash');
    expect(screen.getByText('No Project credential configured')).toBeTruthy();
  });

  it('switches provider/model from server descriptors and never persists the draft key', async () => {
    const user = userEvent.setup();
    const { api } = renderWorkspace({});
    localStorage.clear();
    sessionStorage.clear();
    const provider = await screen.findByLabelText('AI Provider');
    await user.selectOptions(provider, 'google-gemini');
    expect((provider as HTMLSelectElement).value).toBe('google-gemini');
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('gemini-3.6-flash');
    await user.selectOptions(provider, 'openai');
    expect((provider as HTMLSelectElement).value).toBe('openai');
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('gpt-5.6-luna');

    const key = await screen.findByLabelText('API Key (write-only)');
    await user.type(key, 'draft-only-key');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(window.location.search).not.toContain('draft-only-key');
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));

    await screen.findByText('Connected');
    expect(api.testAIConnection).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      draftSecret: 'draft-only-key',
    });
    expect(api.createAICredential).not.toHaveBeenCalled();
  });

  it('saves a new credential then configuration and clears the key field', async () => {
    const user = userEvent.setup();
    const { api } = renderWorkspace({});
    const key = await screen.findByLabelText('API Key (write-only)');
    await user.type(key, 'one-time-key');
    await user.click(screen.getByRole('button', { name: 'Save AI configuration' }));

    await screen.findByText('AI configuration saved');
    expect(api.createAICredential).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'deepseek',
      secret: 'one-time-key',
    });
    expect(api.saveAIConfiguration).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
    });
    expect((key as HTMLInputElement).value).toBe('');
  });

  it('reports credential-success/configuration-conflict as a partial outcome without retrying', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValue(new Error('Configuration revision is stale.'));
    const { api } = renderWorkspace({ saveAIConfiguration: save });
    const key = await screen.findByLabelText('API Key (write-only)');
    await user.type(key, 'one-time-key');
    await user.click(screen.getByRole('button', { name: 'Save AI configuration' }));

    await screen.findByText('Credential saved; AI configuration was not changed');
    expect(api.createAICredential).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect((key as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/no duplicate credential request/i)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('alert'));
  });

  it('uses the exact stored credential revision for revoke and remove without fallback', async () => {
    const storedSettings = makeSettings({
      mode: 'PROJECT_MANAGED',
      currentConfiguration: {
        projectId: 'project-1',
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        aiConfigurationRevision: 3,
        updatedBy: 'principal-1',
        updatedAt: now,
      },
      credentialStatuses: [
        {
          credentialId: credential.credentialId,
          projectId: credential.projectId,
          providerId: credential.providerId,
          credentialRevision: credential.credentialRevision,
          lifecycleState: 'active',
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        },
      ],
    });
    const user = userEvent.setup();
    const { api } = renderWorkspace({}, storedSettings);
    await user.click(await screen.findByRole('button', { name: 'Revoke credential' }));
    await waitFor(() => expect(api.revokeAICredential).toHaveBeenCalledTimes(1));
    expect(api.revokeAICredential).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'deepseek',
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
    });
    await user.click(screen.getByRole('button', { name: 'Remove credential' }));
    await waitFor(() => expect(api.removeAICredential).toHaveBeenCalledTimes(1));
    expect(api.removeAICredential).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'deepseek',
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
    });
  });

  it('presents historical Gemini compatibility without extending it to other providers', async () => {
    const legacySettings = makeSettings({
      mode: 'LEGACY_GEMINI_COMPATIBILITY',
      privacy: [
        {
          providerId: 'google-gemini',
          deploymentAllowed: true,
          legacyGeminiCompatibility: true,
        },
        {
          providerId: 'openai',
          deploymentAllowed: true,
          legacyGeminiCompatibility: false,
        },
        {
          providerId: 'deepseek',
          deploymentAllowed: true,
          legacyGeminiCompatibility: false,
        },
      ],
      legacyGeminiCredentialConfigured: true,
    });
    const user = userEvent.setup();
    renderWorkspace({}, legacySettings);
    expect(await screen.findByText('Legacy Gemini compatibility')).toBeTruthy();
    const provider = screen.getByLabelText('AI Provider');
    await user.selectOptions(provider, 'google-gemini');
    expect(screen.getByText('Approved · historical Gemini compatibility')).toBeTruthy();
    await user.selectOptions(provider, 'openai');
    expect(screen.getByText('Not approved')).toBeTruthy();
  });

  it('tests an exact stored credential and exposes privacy review without bypassing approval', async () => {
    const storedSettings = makeSettings({
      mode: 'PROJECT_MANAGED',
      currentConfiguration: {
        projectId: 'project-1',
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: credential.credentialId,
        credentialRevision: 1,
        aiConfigurationRevision: 4,
        updatedBy: 'principal-1',
        updatedAt: now,
      },
      credentialStatuses: [credential],
      privacy: [
        {
          providerId: 'deepseek',
          deploymentAllowed: true,
          approval: {
            projectId: 'project-1',
            providerId: 'deepseek',
            approved: false,
            approvalRevision: 2,
            reviewedBy: 'owner-1',
            reviewedAt: now,
          },
          legacyGeminiCompatibility: false,
        },
      ],
    });
    const user = userEvent.setup();
    const { api } = renderWorkspace({}, storedSettings);
    await user.click(await screen.findByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Connected');
    expect(api.testAIConnection).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      credentialId: credential.credentialId,
      credentialRevision: 1,
    });
    expect(screen.getByText('Review required · revision 2')).toBeTruthy();
    expect(screen.getByText('Effective private eligibility:').parentElement?.textContent).toContain(
      'Not eligible',
    );
    expect(
      screen.getByRole('link', { name: 'Open Owner privacy review' }).getAttribute('href'),
    ).toBe('/settings/privacy?targetProjectId=project-1');
  });

  it('prevents duplicate Test Connection submissions while the command is pending', async () => {
    const user = userEvent.setup();
    const pending = vi.fn().mockReturnValue(new Promise<never>(() => undefined));
    renderWorkspace({ testAIConnection: pending });
    await user.type(await screen.findByLabelText('API Key (write-only)'), 'draft-key');
    const button = await screen.findByRole('button', { name: 'Test Connection' });
    await user.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(pending).toHaveBeenCalledTimes(1);
  });
});
