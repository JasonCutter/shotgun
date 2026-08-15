import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  outcomeIndeterminateApiError,
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
  it('opens privacy as a read-only surface and performs no mutation', async () => {
    const getPrivacyRetention = vi.fn(async () => privacyResponse());
    const getSettingsSnapshot = vi.fn(async () => snapshot as never);
    const applySettingsCommand = vi.fn();
    renderSurface('privacy.open', {
      getPrivacyRetention,
      getSettingsSnapshot,
      applySettingsCommand,
    });

    expect(await screen.findByText('Controlled external')).toBeTruthy();
    expect(screen.getByText('Retained according to Project policy.')).toBeTruthy();
    expect(getPrivacyRetention).toHaveBeenCalledWith('project-1');
    expect(getSettingsSnapshot).not.toHaveBeenCalled();
    expect(applySettingsCommand).not.toHaveBeenCalled();
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
});
