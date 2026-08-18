import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  outcomeIndeterminateApiError,
  type AISettingsReadModel,
  type GlobalShellView,
  type PrivacyRetentionView,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { createSessionCycleState } from '../session/session-query.js';
import { PrivacyCommandSurface } from './privacy-command-surface.js';

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

const privacyView = (
  pendingReviewProposalId?: string,
  overrides: Partial<PrivacyRetentionView> = {},
): PrivacyRetentionView => ({
  targetProjectId: 'project-1',
  profileName: 'CONTROLLED_EXTERNAL',
  sensitivityLevel: 'SENSITIVE',
  externalTransferAllowed: false,
  connectorAllowed: false,
  telemetryAllowed: false,
  exportAllowed: false,
  retentionSummary: 'Retained according to Project policy.',
  deploymentAllowsPrivateExternalTransfer: true,
  approvalStatus: pendingReviewProposalId ? 'REVIEW_PENDING' : 'NOT_APPROVED',
  approvalRevision: 3,
  restrictedExternalTransferAllowed: false,
  ...(pendingReviewProposalId ? { pendingReviewProposalId } : {}),
  ...overrides,
});

const privacyResponse = (
  pendingReviewProposalId?: string,
  overrides: Partial<PrivacyRetentionView> = {},
) => ({
  availability: 'AVAILABLE' as const,
  data: privacyView(pendingReviewProposalId, overrides),
});

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderSurface = (
  commandId: 'privacy.open' | 'privacy.review',
  apiClient: Partial<ShotgunApiClient>,
  locale: 'en-US' | 'ko-KR' = 'en-US',
) =>
  render(
    <AppProviders
      runtime={runtime({
        getPrincipalPreferences: vi.fn(async () => ({
          preferences: { locale },
          revision: 1,
        })),
        ...apiClient,
      })}
    >
      <ProductLocalizationProvider principalId="principal-1">
        <MemoryRouter>
          <PrivacyCommandSurface
            open
            commandId={commandId}
            shell={shell}
            invoker={null}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      </ProductLocalizationProvider>
    </AppProviders>,
  );
const snapshot = {
  schemaVersion: '1.0.0',
  targetProjectId: 'project-1',
  settingsRevision: 14,
  policyContextRevision: 9,
  categories: [],
  settings: [],
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const reviewRequired = {
  outcome: {} as never,
  resource: { status: 'REVIEW_REQUIRED', reviewProposalId: 'proposal-1' } as never,
};

const applied = {
  outcome: {} as never,
  resource: { status: 'APPLIED' } as never,
};

describe('PrivacyCommandSurface', () => {
  it('opens privacy as a read-only surface and performs no mutation throughout its lifetime', async () => {
    const getPrivacyRetention = vi.fn(async () => privacyResponse());
    const getSettingsSnapshot = vi.fn(async () => snapshot as never);
    const applySettingsCommand = vi.fn();
    const proposeAIProviderPrivacyApproval = vi.fn();
    const approveAIProviderPrivacyProposal = vi.fn();
    const aiSettings: AISettingsReadModel = {
      projectId: 'project-1',
      mode: 'PROJECT_MANAGED',
      defaultProviderId: 'deepseek',
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
      ],
      credentialStatuses: [],
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
      vaultAvailability: { state: 'AVAILABLE', keyVersion: 'v1' },
      legacyGeminiCredentialConfigured: false,
    };
    const getAISettings = vi.fn(async () => aiSettings);

    renderSurface('privacy.open', {
      getPrivacyRetention,
      getSettingsSnapshot,
      getAISettings,
      applySettingsCommand,
      proposeAIProviderPrivacyApproval,
      approveAIProviderPrivacyProposal,
    });

    expect(await screen.findByText('Controlled external')).toBeTruthy();
    expect(screen.queryByText('Retained according to Project policy.')).toBeNull();
    expect(screen.queryByText(/Retention:/i)).toBeNull();
    expect(getPrivacyRetention).toHaveBeenCalledWith('project-1');
    expect(getSettingsSnapshot).not.toHaveBeenCalled();
    expect(applySettingsCommand).not.toHaveBeenCalled();
    expect(proposeAIProviderPrivacyApproval).not.toHaveBeenCalled();
    expect(approveAIProviderPrivacyProposal).not.toHaveBeenCalled();

    // Verify all write/proposal/escalation controls are absent
    expect(screen.queryByRole('button', { name: /Request provider privacy approval/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve provider privacy decision/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Request external AI transfer review/i }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve reviewed privacy proposal/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open review/i })).toBeNull();

    // Only close button exists
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button.textContent).toMatch(/Close/i);
    }
  });

  it('renders localized ko-KR privacy.open surface with zero raw retention text and read-only behavior', async () => {
    const getPrivacyRetention = vi.fn(async () => privacyResponse());
    const aiSettings: AISettingsReadModel = {
      projectId: 'project-1',
      mode: 'PROJECT_MANAGED',
      defaultProviderId: 'deepseek',
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          status: 'active',
          models: [],
        },
        {
          providerId: 'google-gemini',
          displayName: 'Google Gemini',
          status: 'active',
          models: [],
        },
      ],
      credentialStatuses: [],
      privacy: [
        {
          providerId: 'deepseek',
          deploymentAllowed: true,
          approval: {
            projectId: 'project-1',
            providerId: 'deepseek',
            approved: false,
            approvalRevision: 1,
            reviewedBy: 'owner-1',
            reviewedAt: '2026-08-14T00:00:00.000Z',
          },
          legacyGeminiCompatibility: false,
        },
        {
          providerId: 'google-gemini',
          deploymentAllowed: true,
          approval: {
            projectId: 'project-1',
            providerId: 'google-gemini',
            approved: true,
            approvalRevision: 1,
            reviewedBy: 'owner-1',
            reviewedAt: '2026-08-14T00:00:00.000Z',
          },
          legacyGeminiCompatibility: true,
        },
      ],
      vaultAvailability: { state: 'AVAILABLE', keyVersion: 'v1' },
      legacyGeminiCredentialConfigured: false,
    };
    const getAISettings = vi.fn(async () => aiSettings);

    renderSurface(
      'privacy.open',
      {
        getPrivacyRetention,
        getAISettings,
      },
      'ko-KR',
    );

    expect(
      await screen.findByRole('heading', { name: '프로젝트 개인정보', level: 2 }),
    ).toBeTruthy();
    expect(await screen.findByText('제공자 개인정보')).toBeTruthy();
    expect(screen.getByLabelText('제공자')).toBeTruthy();

    // Verify retention is NOT rendered
    expect(screen.queryByText('Retained according to Project policy.')).toBeNull();
    expect(screen.queryByText('Project retention policy is unchanged.')).toBeNull();
    expect(screen.queryByText(/보존:/i)).toBeNull();
    expect(screen.queryByText(/Retention:/i)).toBeNull();

    // Verify raw English copy is absent
    expect(screen.queryByText('AI Provider')).toBeNull();
    expect(screen.queryByText('Request provider privacy approval')).toBeNull();
    expect(screen.queryByText('Approve provider privacy decision')).toBeNull();
    expect(
      screen.queryByText('An existing Gemini approval applies only to Google Gemini.'),
    ).toBeNull();

    // Verify read-only state (no mutation buttons)
    expect(screen.queryByRole('button', { name: '제공자 개인정보 승인 요청' })).toBeNull();
    expect(screen.queryByRole('button', { name: '제공자 개인정보 결정 승인' })).toBeNull();
    expect(screen.queryByRole('button', { name: '개인정보 검토 요청' })).toBeNull();
  });

  it.each([
    [
      { profileName: 'LOCAL_ONLY', sensitivityLevel: 'NORMAL', approvalStatus: 'NOT_APPROVED' },
      ['Local only', 'Normal', 'Not approved'],
    ],
    [
      {
        profileName: 'RESTRICTED_EXTERNAL',
        sensitivityLevel: 'SENSITIVE',
        approvalStatus: 'REVIEW_PENDING',
      },
      ['Restricted external', 'Sensitive', 'Review pending'],
    ],
    [
      {
        profileName: 'CONTROLLED_EXTERNAL',
        sensitivityLevel: 'HIGHLY_SENSITIVE',
        approvalStatus: 'APPROVED',
      },
      ['Controlled external', 'Highly sensitive', 'Approved'],
    ],
    [
      { profileName: 'CUSTOM', sensitivityLevel: 'NORMAL', approvalStatus: 'APPROVED' },
      ['Custom', 'Approved'],
    ],
  ] as const)(
    'renders canonical privacy values with semantic presentation',
    async (overrides, labels) => {
      const getPrivacyRetention = vi.fn(async () => privacyResponse(undefined, overrides));
      renderSurface('privacy.open', { getPrivacyRetention });
      for (const label of labels)
        expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
      const approvalField = screen.getByText('Project approval:').parentElement;
      expect(approvalField?.textContent).toContain(labels.at(-1));
      if (overrides.approvalStatus === 'APPROVED')
        expect(approvalField?.textContent).not.toContain('Not approved');
    },
  );
  it('uses current review preconditions and distinct identities for request and approval', async () => {
    const user = userEvent.setup();
    const applySettingsCommand = vi
      .fn<ShotgunApiClient['applySettingsCommand']>()
      .mockResolvedValueOnce(reviewRequired)
      .mockResolvedValueOnce(applied);
    const getPrivacyRetention = vi.fn(async () => privacyResponse());
    const getSettingsSnapshot = vi.fn(async () => snapshot as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSurface('privacy.review', {
      getPrivacyRetention,
      getSettingsSnapshot,
      applySettingsCommand,
    });

    await user.click(
      await screen.findByRole('button', { name: 'Request external AI transfer review' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Approve reviewed privacy proposal' }),
    );

    await waitFor(() => expect(applySettingsCommand).toHaveBeenCalledTimes(2));
    const initial = applySettingsCommand.mock.calls[0]![0];
    const approval = applySettingsCommand.mock.calls[1]![0];
    expect(initial).toMatchObject({
      activeProjectId: 'project-1',
      targetProjectId: 'project-1',
      resourceProjectId: 'project-1',
      expectedSettingsRevision: 14,
      observedPolicyContextRevision: 9,
      settings: { 'privacy.externalTransferAllowed': true },
    });
    expect(approval).toMatchObject({
      activeProjectId: 'project-1',
      targetProjectId: 'project-1',
      resourceProjectId: 'project-1',
      expectedSettingsRevision: 14,
      observedPolicyContextRevision: 9,
      reviewProposalId: 'proposal-1',
    });
    expect(initial.clientRequestId).not.toBe(approval.clientRequestId);
    expect(initial.idempotencyKey).not.toBe(approval.idempotencyKey);
    expect(screen.queryByText('proposal-1')).toBeNull();
    expect(screen.queryByText('14')).toBeNull();
    expect(screen.queryByText('9')).toBeNull();
  });

  it('does not create a duplicate review request for a server-pending proposal', async () => {
    const user = userEvent.setup();
    const applySettingsCommand = vi.fn<ShotgunApiClient['applySettingsCommand']>(
      async () => applied,
    );
    const getPrivacyRetention = vi.fn(async () => privacyResponse('pending-proposal-1'));
    const getSettingsSnapshot = vi.fn(async () => snapshot as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSurface('privacy.review', {
      getPrivacyRetention,
      getSettingsSnapshot,
      applySettingsCommand,
    });

    expect(
      await screen.findByRole('button', { name: 'Approve reviewed privacy proposal' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Request external AI transfer review' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Approve reviewed privacy proposal' }));

    await waitFor(() => expect(applySettingsCommand).toHaveBeenCalledTimes(1));
    expect(applySettingsCommand).toHaveBeenCalledWith(
      expect.objectContaining({ reviewProposalId: 'pending-proposal-1' }),
    );
  });

  it('resolves an uncertain privacy write with the generic outcome resolver only', async () => {
    const user = userEvent.setup();
    const applySettingsCommand = vi.fn<ShotgunApiClient['applySettingsCommand']>(async () => {
      throw outcomeIndeterminateApiError('privacy-request-1');
    });
    const getFrontendCommandOutcomeByClientRequestId = vi.fn<
      ShotgunApiClient['getFrontendCommandOutcomeByClientRequestId']
    >(async () => ({ outcomeState: 'COMPLETED' }) as never);
    const getPrivacyRetention = vi.fn(async () => privacyResponse());
    const getSettingsSnapshot = vi.fn(async () => snapshot as never);
    renderSurface('privacy.review', {
      getPrivacyRetention,
      getSettingsSnapshot,
      applySettingsCommand,
      getFrontendCommandOutcomeByClientRequestId,
    });

    await user.click(
      await screen.findByRole('button', { name: 'Request external AI transfer review' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Check result' }));

    await waitFor(() =>
      expect(getFrontendCommandOutcomeByClientRequestId).toHaveBeenCalledTimes(1),
    );
    expect(applySettingsCommand).toHaveBeenCalledTimes(1);
    expect(getFrontendCommandOutcomeByClientRequestId).toHaveBeenCalledWith(expect.any(String));
  });

  it.each([
    [
      'en-US',
      'Owner approval is required before private Project context may be sent to external AI providers. Restricted context remains blocked.',
    ],
    [
      'ko-KR',
      '비공개 프로젝트 컨텍스트를 외부 AI 제공자에게 전송하려면 소유자 승인이 필요합니다. 제한된 컨텍스트는 계속 차단됩니다.',
    ],
  ] as const)('renders the owner approval explanation in %s', async (locale, explanation) => {
    renderSurface(
      'privacy.review',
      {
        getPrivacyRetention: vi.fn(async () => privacyResponse('proposal-1')),
        getSettingsSnapshot: vi.fn(async () => snapshot as never),
      },
      locale,
    );
    expect(await screen.findByText(explanation)).toBeTruthy();
  });

  it('supports provider-scoped privacy review and approval in privacy surface', async () => {
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
    const aiSettings: AISettingsReadModel = {
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
      ],
      credentialStatuses: [],
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
      vaultAvailability: { state: 'AVAILABLE', keyVersion: 'v1' },
      legacyGeminiCredentialConfigured: false,
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSurface('privacy.review', {
      getPrivacyRetention: vi.fn(async () => privacyResponse()),
      getAISettings: vi.fn(async () => aiSettings),
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

  it('renders localized ko-KR provider privacy review actions', async () => {
    const user = userEvent.setup();
    const proposeAIProviderPrivacyApproval = vi.fn<
      ShotgunApiClient['proposeAIProviderPrivacyApproval']
    >(async () => ({
      proposalId: 'proposal-ko-1',
      projectId: 'project-1',
      providerId: 'deepseek',
      approved: true,
      expectedApprovalRevision: 1,
      proposedBy: 'owner-1',
      status: 'PROPOSED',
      createdAt: '2026-08-14T00:00:00.000Z',
    }));
    const aiSettings: AISettingsReadModel = {
      projectId: 'project-1',
      mode: 'PROJECT_MANAGED',
      defaultProviderId: 'deepseek',
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          status: 'active',
          models: [],
        },
      ],
      credentialStatuses: [],
      privacy: [
        {
          providerId: 'deepseek',
          deploymentAllowed: true,
          approval: {
            projectId: 'project-1',
            providerId: 'deepseek',
            approved: false,
            approvalRevision: 1,
            reviewedBy: 'owner-1',
            reviewedAt: '2026-08-14T00:00:00.000Z',
          },
          legacyGeminiCompatibility: false,
        },
      ],
      vaultAvailability: { state: 'AVAILABLE', keyVersion: 'v1' },
      legacyGeminiCredentialConfigured: false,
    };
    renderSurface(
      'privacy.review',
      {
        getPrivacyRetention: vi.fn(async () => privacyResponse()),
        getAISettings: vi.fn(async () => aiSettings),
        proposeAIProviderPrivacyApproval,
      },
      'ko-KR',
    );

    // 1. Verify localized request button exists and raw English button is absent
    const requestButton = await screen.findByRole('button', {
      name: '제공자 개인정보 승인 요청',
    });
    expect(requestButton).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request provider privacy approval' })).toBeNull();

    // 2. Trigger proposal path only to make approval action available
    await user.click(requestButton);

    // 3. Verify localized approval button exists and raw English button is absent
    const approveButton = await screen.findByRole('button', {
      name: '제공자 개인정보 결정 승인',
    });
    expect(approveButton).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve provider privacy decision' })).toBeNull();
  });
});
