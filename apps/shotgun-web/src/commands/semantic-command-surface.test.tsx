import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import type {
  GlobalShellView,
  ShotgunApiClient,
  SemanticComparisonStatusView,
} from '@shotgun/api-client';
import { ShotgunApiError } from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { createSessionCycleState } from '../session/session-query.js';
import { SemanticCommandSurface } from './semantic-command-surface.js';
import { semanticEmbeddingCredentialReplacementStorageKey } from './semantic-embedding-credential-storage.js';

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

const status = (
  overrides: Partial<SemanticComparisonStatusView> = {},
): SemanticComparisonStatusView => ({
  projectId: 'project-1',
  status: 'NOT_CONFIGURED',
  rollout: 'V1_ONLY',
  settingsRevision: 4,
  embeddingOptions: [
    {
      providerId: 'openai',
      providerDisplayName: 'OpenAI',
      embeddingModelId: 'text-embedding-3-small',
      embeddingModelDisplayName: 'Text Embedding 3 Small',
      hasActiveCredential: false,
    },
  ],
  ...overrides,
});

const multiEmbeddingOptions = [
  {
    providerId: 'openai',
    providerDisplayName: 'OpenAI',
    embeddingModelId: 'text-embedding-3-small',
    embeddingModelDisplayName: 'Text Embedding 3 Small',
    hasActiveCredential: false,
  },
  {
    providerId: 'openai',
    providerDisplayName: 'OpenAI',
    embeddingModelId: 'text-embedding-3-large',
    embeddingModelDisplayName: 'Text Embedding 3 Large',
    hasActiveCredential: false,
  },
  {
    providerId: 'google-gemini',
    providerDisplayName: 'Google Gemini',
    embeddingModelId: 'gemini-embedding-001',
    embeddingModelDisplayName: 'Gemini Embedding 001',
    hasActiveCredential: false,
  },
] as const;

const snapshot = {
  schemaVersion: '1.0.0',
  targetProjectId: 'project-1',
  settingsRevision: 4,
  policyContextRevision: 2,
  categories: [],
  settings: [],
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const renderSurface = (apiClient: Partial<ShotgunApiClient>) => {
  const runtime: AppRuntime = {
    apiClient: apiClient as ShotgunApiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
  return render(
    <AppProviders runtime={runtime}>
      <ProductLocalizationProvider principalId="principal-1">
        <MemoryRouter>
          <SemanticCommandSurface
            open
            commandId="semantic.enable"
            shell={shell}
            invoker={null}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      </ProductLocalizationProvider>
    </AppProviders>,
  );
};

const LocationProbe = () => <span data-testid="location-probe">{useLocation().pathname}</span>;

afterEach(() => vi.restoreAllMocks());
beforeEach(() => sessionStorage.clear());

describe('SemanticCommandSurface', () => {
  it('prepares once and only offers activation after READY', async () => {
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(status())
      .mockResolvedValue(status({ status: 'READY' }));
    const prepareSemanticComparison = vi.fn<ShotgunApiClient['prepareSemanticComparison']>(
      async () => status({ status: 'READY' }),
    );
    const applySettingsCommand = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      prepareSemanticComparison,
      getSettingsSnapshot: vi.fn(async () => snapshot as never),
      applySettingsCommand,
    });

    expect(await screen.findByText('Not configured')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Prepare semantic comparison' }));
    await waitFor(() => expect(prepareSemanticComparison).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Enable semantic comparison' })).toBeTruthy();
    expect(applySettingsCommand).not.toHaveBeenCalled();
  });

  it('uses the normal settings authority and confirms READY/V2_ACTIVE after activation', async () => {
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(status({ status: 'READY' }))
      .mockResolvedValue(status({ status: 'READY', rollout: 'V2_ACTIVE' }));
    const applySettingsCommand = vi.fn<ShotgunApiClient['applySettingsCommand']>(async () => ({
      outcome: {} as never,
      resource: { status: 'APPLIED' } as never,
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      prepareSemanticComparison: vi.fn(),
      getSettingsSnapshot: vi.fn(async () => snapshot as never),
      applySettingsCommand,
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enable semantic comparison' }),
    );
    await waitFor(() => expect(applySettingsCommand).toHaveBeenCalledTimes(1));
    expect(applySettingsCommand.mock.calls[0]?.[0]).toMatchObject({
      activeProjectId: 'project-1',
      targetProjectId: 'project-1',
      expectedSettingsRevision: 4,
      observedPolicyContextRevision: 2,
      settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
    });
    expect(await screen.findByText('Semantic comparison is enabled.')).toBeTruthy();
  });

  it('provides separate owner embedding credential setup without saving generative configuration', async () => {
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(status())
      .mockResolvedValue(
        status({
          embeddingOptions: [
            {
              providerId: 'openai',
              providerDisplayName: 'OpenAI',
              embeddingModelId: 'text-embedding-3-small',
              embeddingModelDisplayName: 'Text Embedding 3 Small',
              hasActiveCredential: true,
            },
          ],
        }),
      );
    const saveSemanticEmbeddingCredential = vi.fn<
      ShotgunApiClient['saveSemanticEmbeddingCredential']
    >(async () => ({}) as never);
    const saveAIConfiguration = vi.fn();

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      saveSemanticEmbeddingCredential,
      saveAIConfiguration,
    });

    expect(
      await screen.findByText(
        'Semantic comparison uses a separate embedding provider credential. It does not change the active generative AI configuration.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Embedding provider and model' })).toBeTruthy();
    const secret = screen.getByLabelText('Embedding provider API key (write-only)');
    await userEvent.type(secret, 'sk-test-embedding');
    await userEvent.click(screen.getByRole('button', { name: 'Save embedding credential' }));

    await waitFor(() => expect(saveSemanticEmbeddingCredential).toHaveBeenCalledTimes(1));
    expect(saveSemanticEmbeddingCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'sk-test-embedding',
      }),
    );
    expect(saveAIConfiguration).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'Embedding credential saved. The active generative AI configuration was not changed.',
      ),
    ).toBeTruthy();
  });

  it('preserves the exact selected embedding model across a multi-option credential refresh', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(status({ embeddingOptions: multiEmbeddingOptions }))
      .mockResolvedValue(
        status({
          embeddingOptions: multiEmbeddingOptions.map((option) => ({
            ...option,
            hasActiveCredential: option.providerId === 'openai',
          })),
        }),
      );
    const saveSemanticEmbeddingCredential = vi.fn<
      ShotgunApiClient['saveSemanticEmbeddingCredential']
    >(async () => ({}) as never);
    const prepareSemanticComparison = vi.fn<ShotgunApiClient['prepareSemanticComparison']>(
      async () => status({ status: 'READY' }),
    );

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      saveSemanticEmbeddingCredential,
      prepareSemanticComparison,
    });

    const select = await screen.findByRole('combobox', { name: 'Embedding provider and model' });
    await userEvent.selectOptions(select, 'openai:text-embedding-3-small');
    await userEvent.type(
      screen.getByLabelText('Embedding provider API key (write-only)'),
      'sk-test-embedding',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save embedding credential' }));

    await waitFor(() => expect(saveSemanticEmbeddingCredential).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe('openai:text-embedding-3-small'),
    );
    expect((select as HTMLSelectElement).value).not.toBe('google-gemini:gemini-embedding-001');

    await userEvent.click(screen.getByRole('button', { name: 'Prepare semantic comparison' }));
    await waitFor(() => expect(prepareSemanticComparison).toHaveBeenCalledTimes(1));
    expect(prepareSemanticComparison).toHaveBeenCalledWith('project-1', {
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
    });
    expect(prepareSemanticComparison.mock.calls[0]?.[1]).not.toMatchObject({
      providerId: 'google-gemini',
    });
  });

  it('prefers an existing configured option if the selected option disappears after refresh', async () => {
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(
        status({
          embeddingOptions: multiEmbeddingOptions,
        }),
      )
      .mockResolvedValue(
        status({
          embeddingOptions: [
            {
              ...multiEmbeddingOptions[1],
              hasActiveCredential: true,
            },
            {
              ...multiEmbeddingOptions[2],
              hasActiveCredential: false,
            },
          ],
        }),
      );
    const saveSemanticEmbeddingCredential = vi.fn<
      ShotgunApiClient['saveSemanticEmbeddingCredential']
    >(async () => ({}) as never);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      saveSemanticEmbeddingCredential,
      prepareSemanticComparison: vi.fn(),
    });

    const select = await screen.findByRole('combobox', { name: 'Embedding provider and model' });
    await userEvent.selectOptions(select, 'openai:text-embedding-3-small');
    await userEvent.type(
      screen.getByLabelText('Embedding provider API key (write-only)'),
      'sk-test-embedding',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save embedding credential' }));

    await waitFor(() => expect(saveSemanticEmbeddingCredential).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe('openai:text-embedding-3-large'),
    );
    expect((select as HTMLSelectElement).value).not.toBe('google-gemini:gemini-embedding-001');
  });

  it('projects typed configuration failures as an actionable semantic setup message', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const prepareSemanticComparison = vi.fn<ShotgunApiClient['prepareSemanticComparison']>(
      async () => {
        throw new ShotgunApiError({
          status: 503,
          code: 'CONFIGURATION_REQUIRED',
          message: 'typed server message',
        });
      },
    );

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus: vi.fn(async () => status()),
      prepareSemanticComparison,
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Prepare semantic comparison' }),
    );
    expect(
      await screen.findByText(
        'Add an embedding provider credential before preparing semantic comparison.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('The server request failed.')).toBeNull();
  });

  it('exposes semantic-only credential replacement while READY/V2_ACTIVE', async () => {
    const initial = status({
      status: 'READY',
      rollout: 'V2_ACTIVE',
      embeddingOptions: [
        {
          providerId: 'openai',
          providerDisplayName: 'OpenAI',
          embeddingModelId: 'text-embedding-3-small',
          embeddingModelDisplayName: 'Text Embedding 3 Small',
          hasActiveCredential: true,
          activeCredentialId: 'embedding-credential',
          activeCredentialRevision: 1,
        },
      ],
      profile: {
        profileId: 'profile-1',
        profileRevision: 1,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'embedding-credential',
        credentialRevision: 1,
        representationVersion: 'v2',
        dimension: 1536,
        status: 'ACTIVE',
      },
    });
    const afterReplacement = status({
      status: 'NEEDS_ATTENTION',
      rollout: 'V2_ACTIVE',
      embeddingOptions: [
        {
          ...initial.embeddingOptions[0]!,
          activeCredentialRevision: 2,
        },
      ],
      profile: initial.profile,
    });
    const getSemanticComparisonStatus = vi
      .fn<ShotgunApiClient['getSemanticComparisonStatus']>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(afterReplacement);
    const replaceSemanticEmbeddingCredential = vi.fn<
      ShotgunApiClient['replaceSemanticEmbeddingCredential']
    >(async () => ({}) as never);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      replaceSemanticEmbeddingCredential,
      prepareSemanticComparison: vi.fn(),
    });

    const secret = await screen.findByLabelText('Embedding provider API key (write-only)');
    await userEvent.type(secret, 'replacement-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Replace embedding credential' }));

    await waitFor(() => expect(replaceSemanticEmbeddingCredential).toHaveBeenCalledTimes(1));
    expect(replaceSemanticEmbeddingCredential).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      secret: 'replacement-secret',
      clientRequestId: expect.stringContaining('semantic-embedding-credential-replace:'),
    });
    expect(
      JSON.stringify(sessionStorage.getItem(semanticEmbeddingCredentialReplacementStorageKey)),
    ).not.toContain('replacement-secret');
    expect(
      await screen.findByText(
        'Embedding credential replaced. Prepare semantic comparison again to bind the new revision.',
      ),
    ).toBeTruthy();
    expect(sessionStorage.getItem(semanticEmbeddingCredentialReplacementStorageKey)).toBeNull();
  });

  it('resolves a response-loss replacement without resending the secret', async () => {
    const initial = status({
      status: 'READY',
      rollout: 'V2_ACTIVE',
      embeddingOptions: [
        {
          providerId: 'openai',
          providerDisplayName: 'OpenAI',
          embeddingModelId: 'text-embedding-3-small',
          embeddingModelDisplayName: 'Text Embedding 3 Small',
          hasActiveCredential: true,
          activeCredentialId: 'embedding-credential',
          activeCredentialRevision: 1,
        },
      ],
      profile: {
        profileId: 'profile-1',
        profileRevision: 1,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'embedding-credential',
        credentialRevision: 1,
        representationVersion: 'v2',
        dimension: 1536,
        status: 'ACTIVE',
      },
    });
    const getSemanticComparisonStatus = vi.fn<ShotgunApiClient['getSemanticComparisonStatus']>(
      async () => initial,
    );
    const replaceSemanticEmbeddingCredential = vi.fn<
      ShotgunApiClient['replaceSemanticEmbeddingCredential']
    >(async () => {
      throw new Error('response lost');
    });
    const getAICredentialWriteOutcome = vi
      .fn<ShotgunApiClient['getAICredentialWriteOutcome']>()
      .mockRejectedValueOnce(
        new ShotgunApiError({
          status: 404,
          code: 'NOT_FOUND',
          message: 'not found',
        }),
      )
      .mockResolvedValue({} as never);

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus,
      replaceSemanticEmbeddingCredential,
      getAICredentialWriteOutcome,
    });

    await userEvent.type(
      await screen.findByLabelText('Embedding provider API key (write-only)'),
      'response-loss-secret',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Replace embedding credential' }));
    expect(
      await screen.findByText(
        'The previous embedding credential replacement could not be confirmed. Resolve it before sending another key.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Resolve previous embedding credential replacement' }),
    ).toBeTruthy();
    const stored = sessionStorage.getItem(semanticEmbeddingCredentialReplacementStorageKey);
    expect(stored).toContain('embedding-credential');
    expect(stored).not.toContain('response-loss-secret');
    expect(replaceSemanticEmbeddingCredential).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole('button', { name: 'Resolve previous embedding credential replacement' }),
    );
    await waitFor(() => expect(getAICredentialWriteOutcome).toHaveBeenCalledTimes(2));
    expect(replaceSemanticEmbeddingCredential).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(semanticEmbeddingCredentialReplacementStorageKey)).toBeNull();
  });

  it('offers the Privacy settings route when semantic refresh is policy-blocked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();
    const prepareSemanticComparison = vi.fn<ShotgunApiClient['prepareSemanticComparison']>(
      async () => {
        throw new ShotgunApiError({
          status: 403,
          code: 'POLICY_DENIED',
          message: 'Privacy policy denied semantic refresh.',
        });
      },
    );

    const runtime: AppRuntime = {
      apiClient: {
        getPrincipalPreferences: vi.fn(async () => ({
          preferences: { locale: 'en-US' },
          revision: 1,
        })),
        getSemanticComparisonStatus: vi.fn(async () => status()),
        prepareSemanticComparison,
      } as unknown as ShotgunApiClient,
      queryClient: createFrontendQueryClient(),
      sessionCycleState: createSessionCycleState(),
    };
    render(
      <AppProviders runtime={runtime}>
        <ProductLocalizationProvider principalId="principal-1">
          <MemoryRouter>
            <SemanticCommandSurface
              open
              commandId="semantic.enable"
              shell={shell}
              invoker={null}
              onClose={onClose}
            />
            <LocationProbe />
          </MemoryRouter>
        </ProductLocalizationProvider>
      </AppProviders>,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Prepare semantic comparison' }),
    );
    expect(
      await screen.findByText(
        'Semantic refresh is blocked by Project privacy policy. Review Settings → Privacy before continuing.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Privacy settings' })).toBeTruthy();
    expect(screen.queryByText('The server request failed.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open Privacy settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location-probe').textContent).toBe('/settings/privacy');
  });

  it('keeps unknown semantic 5xx failures generic', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const prepareSemanticComparison = vi.fn<ShotgunApiClient['prepareSemanticComparison']>(
      async () => {
        throw new ShotgunApiError({
          status: 500,
          code: 'INTERNAL_UNCLASSIFIED',
          message: 'sensitive internal detail',
        });
      },
    );

    renderSurface({
      getPrincipalPreferences: vi.fn(async () => ({
        preferences: { locale: 'en-US' },
        revision: 1,
      })),
      getSemanticComparisonStatus: vi.fn(async () => status()),
      prepareSemanticComparison,
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Prepare semantic comparison' }),
    );
    expect(await screen.findByText('The server request failed.')).toBeTruthy();
    expect(screen.queryByText('sensitive internal detail')).toBeNull();
  });
});
