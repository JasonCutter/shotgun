import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  AISettingsReadModel,
  PrivacyRetentionView,
  ProductFeatureView,
  ShotgunApiClient,
} from '@shotgun/api-client';

import { createFrontendQueryClient } from '../../app/query-client.js';
import { AppProviders } from '../../app/providers.js';
import { createSessionCycleState } from '../../session/session-query.js';
import { PrivacyWorkspace } from './privacy-workspace.js';

const now = '2026-08-14T00:00:00.000Z';

const session = {
  apiVersion: '2.0.0' as const,
  principal: {
    id: 'principal-1',
    actor: { type: 'user' as const, id: 'user-1' },
    authenticationMethod: 'session' as const,
  },
  activeProject: { id: 'project-authoritative-99' },
  accessibleProjects: [{ id: 'project-authoritative-99', isOwner: true }],
  session: { expiresAt: now },
};

const makeAISettings = (overrides: Partial<AISettingsReadModel> = {}): AISettingsReadModel => ({
  projectId: 'project-authoritative-99',
  mode: 'PROJECT_MANAGED',
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
          shotgunUsableCapabilities: ['text'],
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
          shotgunUsableCapabilities: ['text'],
          capabilityRevision: 'model-catalog:v1',
        },
      ],
    },
  ],
  credentialStatuses: [],
  privacy: [
    {
      providerId: 'deepseek',
      deploymentAllowed: true,
      approval: {
        projectId: 'project-authoritative-99',
        providerId: 'deepseek',
        approved: false,
        approvalRevision: 2,
        reviewedBy: 'principal-1',
        reviewedAt: now,
      },
      legacyGeminiCompatibility: false,
    },
    {
      providerId: 'openai',
      deploymentAllowed: true,
      approval: {
        projectId: 'project-authoritative-99',
        providerId: 'openai',
        approved: false,
        approvalRevision: 3,
        reviewedBy: 'principal-1',
        reviewedAt: now,
      },
      legacyGeminiCompatibility: false,
    },
  ],
  vaultAvailability: { state: 'AVAILABLE', keyVersion: 'test' },
  legacyGeminiCredentialConfigured: false,
  ...overrides,
});

const makePrivacyRetention = (
  overrides: Partial<PrivacyRetentionView> = {},
): ProductFeatureView<PrivacyRetentionView> => ({
  availability: 'AVAILABLE',
  data: {
    targetProjectId: 'project-authoritative-99',
    profileName: 'CONTROLLED_EXTERNAL',
    sensitivityLevel: 'SENSITIVE',
    externalTransferAllowed: false,
    approvalStatus: 'NOT_APPROVED',
    deploymentAllowsPrivateExternalTransfer: true,
    retentionSummary: 'Retained according to Project policy.',
    connectorAllowed: false,
    telemetryAllowed: false,
    exportAllowed: false,
    approvalRevision: 1,
    restrictedExternalTransferAllowed: false,
    ...overrides,
  },
});

const snapshot = {
  settingsRevision: 10,
  policyContextRevision: 15,
  effectiveSettings: {},
};

const renderWorkspace = (
  apiClient: Partial<ShotgunApiClient> = {},
  initialUrl = '/settings/privacy',
) => {
  const api = {
    getSession: vi.fn().mockResolvedValue(session),
    getAISettings: vi.fn().mockResolvedValue(makeAISettings()),
    getPrivacyRetention: vi.fn().mockResolvedValue(makePrivacyRetention()),
    getSettingsSnapshot: vi.fn().mockResolvedValue(snapshot),
    proposeAIProviderPrivacyApproval: vi.fn().mockImplementation(async (params) => ({
      proposalId: `proposal-${params.providerId}-123`,
      projectId: params.projectId,
      providerId: params.providerId,
      approved: params.approved,
      expectedApprovalRevision: params.expectedApprovalRevision,
      proposedBy: 'principal-1',
      status: 'PROPOSED',
      createdAt: now,
    })),
    approveAIProviderPrivacyProposal: vi.fn().mockImplementation(async (params) => ({
      projectId: params.projectId,
      providerId: params.providerId,
      approved: true,
      approvalRevision: params.expectedApprovalRevision + 1,
      reviewedBy: 'principal-1',
      reviewedAt: now,
    })),
    applySettingsCommand: vi.fn().mockResolvedValue({
      outcome: {} as never,
      resource: {
        status: 'REVIEW_REQUIRED',
        reviewProposalId: 'project-review-prop-1',
      },
    }),
    ...apiClient,
  } as unknown as ShotgunApiClient;

  const queryClient = createFrontendQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <div>
            <Outlet context={{ requestConfirmation: vi.fn() }} />
          </div>
        ),
        children: [{ path: 'settings/privacy', element: <PrivacyWorkspace /> }],
      },
    ],
    { initialEntries: [initialUrl] },
  );

  const view = render(
    <AppProviders
      runtime={{ apiClient: api, queryClient, sessionCycleState: createSessionCycleState() }}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return { ...view, api };
};

describe('PrivacyWorkspace (A7 Settings → Privacy)', () => {
  it('renders Provider Privacy and Project Privacy as separate surfaces with authoritative session project', async () => {
    const { api } = renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Provider Privacy' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Project Privacy & External Data Transfer' }),
    ).toBeTruthy();
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.getByText(/Retained according to Project policy/i)).toBeTruthy();

    expect(api.getPrivacyRetention).toHaveBeenCalledWith('project-authoritative-99');
    expect(api.getAISettings).toHaveBeenCalledWith('project-authoritative-99', expect.any(Object));
  });

  it('performs AI provider proposal and approval for the exact selected provider', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api } = renderWorkspace();

    const providerSelect = await screen.findByLabelText('AI Provider');
    await user.selectOptions(providerSelect, 'openai');

    const proposeButton = await screen.findByRole('button', {
      name: 'Request provider approval',
    });
    await user.click(proposeButton);

    await waitFor(() =>
      expect(api.proposeAIProviderPrivacyApproval).toHaveBeenCalledWith({
        projectId: 'project-authoritative-99',
        providerId: 'openai',
        approved: true,
        expectedApprovalRevision: 3,
      }),
    );

    const approveButton = await screen.findByRole('button', {
      name: 'Approve provider review',
    });
    await user.click(approveButton);

    await waitFor(() =>
      expect(api.approveAIProviderPrivacyProposal).toHaveBeenCalledWith({
        projectId: 'project-authoritative-99',
        providerId: 'openai',
        proposalId: 'proposal-openai-123',
        expectedApprovalRevision: 3,
      }),
    );
  });

  it('rejects a proposal response when providerId does not match the requested provider', async () => {
    const user = userEvent.setup();
    const proposeAIProviderPrivacyApproval = vi.fn().mockResolvedValue({
      proposalId: 'proposal-mismatched-999',
      projectId: 'project-authoritative-99',
      providerId: 'deepseek',
      approved: true,
      expectedApprovalRevision: 2,
      proposedBy: 'principal-1',
      status: 'PROPOSED',
      createdAt: now,
    });
    const approveAIProviderPrivacyProposal = vi.fn();
    renderWorkspace({
      proposeAIProviderPrivacyApproval,
      approveAIProviderPrivacyProposal,
    });

    const providerSelect = await screen.findByLabelText('AI Provider');
    await user.selectOptions(providerSelect, 'openai');

    const proposeButton = await screen.findByRole('button', {
      name: 'Request provider approval',
    });
    await user.click(proposeButton);

    expect(
      await screen.findByText(
        'Provider privacy proposal could not be validated for the selected provider.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve provider review' })).toBeNull();
    expect(approveAIProviderPrivacyProposal).not.toHaveBeenCalled();
  });

  it('uses applySettingsCommand for Project Privacy review and approval', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api } = renderWorkspace();

    const requestReviewButton = await screen.findByRole('button', {
      name: 'Request external AI transfer review',
    });
    await user.click(requestReviewButton);

    await waitFor(() =>
      expect(api.applySettingsCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          activeProjectId: 'project-authoritative-99',
          targetProjectId: 'project-authoritative-99',
          settings: { 'privacy.externalTransferAllowed': true },
          expectedSettingsRevision: 10,
          observedPolicyContextRevision: 15,
        }),
      ),
    );

    const approveProposalButton = await screen.findByRole('button', {
      name: 'Approve reviewed privacy proposal',
    });
    await user.click(approveProposalButton);

    await waitFor(() =>
      expect(api.applySettingsCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          activeProjectId: 'project-authoritative-99',
          targetProjectId: 'project-authoritative-99',
          reviewProposalId: 'project-review-prop-1',
          settings: { 'privacy.externalTransferAllowed': true },
        }),
      ),
    );
  });

  it('handles AI settings failure gracefully without corrupting Project Privacy', async () => {
    const { api } = renderWorkspace({
      getAISettings: vi.fn().mockRejectedValue(new Error('AI service offline')),
    });

    expect(await screen.findByText('Failed to load AI provider privacy settings.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Project Privacy & External Data Transfer' }),
    ).toBeTruthy();
    expect(screen.getByText(/Controlled external/i)).toBeTruthy();
    expect(api.getPrivacyRetention).toHaveBeenCalledWith('project-authoritative-99');
  });

  it('validates providerId route parameter against server provider list', async () => {
    renderWorkspace({}, '/settings/privacy?providerId=nonexistent-provider');

    expect(
      await screen.findByText(
        "The specified AI provider 'nonexistent-provider' is not registered for this project.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request provider approval' })).toBeNull();
  });

  it('ignores targetProjectId URL parameter and binds strictly to the session active project', async () => {
    const { api } = renderWorkspace({}, '/settings/privacy?targetProjectId=rogue-project-99');
    expect(await screen.findByRole('heading', { name: 'Provider Privacy' })).toBeTruthy();
    expect(api.getPrivacyRetention).toHaveBeenCalledWith('project-authoritative-99');
    expect(api.getAISettings).toHaveBeenCalledWith('project-authoritative-99', expect.any(Object));
    expect(api.getPrivacyRetention).not.toHaveBeenCalledWith('rogue-project-99');
    expect(api.getAISettings).not.toHaveBeenCalledWith('rogue-project-99', expect.any(Object));
  });
});
