import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useId, type FormEvent } from 'react';

import type {
  AICredentialMetadata,
  AIProviderPrivacyProposal,
  AITestConnectionResult,
  AISettingsApproval,
  AISettingsCredentialStatus,
  AISettingsPrivacyStatus,
  AISettingsReadModel,
  GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useProductLocalization } from '../localization/product-localization.js';
import type { AICommandId } from './owner-command-registry.js';

type Feedback = {
  readonly tone: 'success' | 'error' | 'info';
  readonly title: string;
  readonly detail?: string;
};

type ConfigurationInput = {
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly providerId: string;
  readonly modelId: string;
};

type CredentialSubmission = ConfigurationInput & {
  readonly clientRequestId: string;
  readonly operation: 'CREATE' | 'REPLACE';
  readonly credentialId?: string;
  readonly expectedCredentialRevision?: number;
};

type ConfigurationSubmission = ConfigurationInput & {
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly credentialWasSaved: boolean;
};

type CredentialRecovery = Omit<CredentialSubmission, 'secret'>;

type TestSubmission = ConfigurationInput & {
  readonly secretSource: 'DRAFT' | 'STORED';
  readonly credentialId?: string;
  readonly credentialRevision?: number;
};

type DestructiveAction = 'revoke' | 'remove' | undefined;

export type AICommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: AICommandId | null;
  readonly shell: GlobalShellView;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

const settingsQueryKey = (projectId: string) => ['settings', 'ai', projectId] as const;

const identity = (): string =>
  typeof crypto.randomUUID === 'function'
    ? `ai-credential-write:${crypto.randomUUID()}`
    : `ai-credential-write:${Date.now()}:${Math.random().toString(16).slice(2)}`;

const isConclusiveCredentialRejection = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    readonly failure?: unknown;
    readonly recovery?: unknown;
  };
  return candidate.failure !== undefined && candidate.recovery !== 'RESOLVE_EXISTING_OUTCOME';
};

const statusLabel = (status: AITestConnectionResult['status']): string => {
  switch (status) {
    case 'CONNECTED':
      return 'Connected';
    case 'AUTHENTICATION_FAILED':
      return 'Authentication failed';
    case 'MODEL_UNAVAILABLE':
      return 'Model unavailable';
    case 'RATE_LIMITED':
      return 'Rate limited';
    case 'TEMPORARILY_UNAVAILABLE':
      return 'Temporarily unavailable';
    default:
      return 'Connection failed';
  }
};

const privacyStateLabel = (privacy: AISettingsPrivacyStatus | undefined): string => {
  if (!privacy) return 'Review required';
  if (privacy.approval?.approved || privacy.legacyGeminiCompatibility) return 'Approved';
  if (privacy.approval?.approved === false) return 'Not approved';
  return 'Review required';
};

const exactOrUnambiguousCredential = (
  settings: AISettingsReadModel,
  providerId: string,
): AISettingsCredentialStatus | undefined => {
  const configuration = settings.currentConfiguration;
  if (configuration?.activeProviderId === providerId) {
    const exact = settings.credentialStatuses.find(
      (credential) =>
        credential.credentialId === configuration.credentialId &&
        credential.credentialRevision === configuration.credentialRevision &&
        credential.lifecycleState === 'active',
    );
    if (exact) return exact;
  }

  const activeCredentials = settings.credentialStatuses.filter(
    (credential) => credential.providerId === providerId && credential.lifecycleState === 'active',
  );
  return activeCredentials.length === 1 ? activeCredentials[0] : undefined;
};

const activeCredentialCount = (settings: AISettingsReadModel, providerId: string): number =>
  settings.credentialStatuses.filter(
    (credential) => credential.providerId === providerId && credential.lifecycleState === 'active',
  ).length;

const isPrivacyApproved = (privacy: AISettingsPrivacyStatus | undefined): boolean =>
  Boolean(privacy?.approval?.approved || privacy?.legacyGeminiCompatibility);

export const AICommandSurface = ({
  open,
  commandId,
  shell,
  invoker,
  onClose,
}: AICommandSurfaceProps) => {
  const { apiClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const projectId = shell.activeProject?.id ?? '';
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [draftSecret, setDraftSecret] = useState('');
  const [initializedProjectId, setInitializedProjectId] = useState('');
  const [feedback, setFeedback] = useState<Feedback>();
  const [testResult, setTestResult] = useState<AITestConnectionResult>();
  const [pendingPrivacyProposal, setPendingPrivacyProposal] = useState<AIProviderPrivacyProposal>();
  const [credentialRecovery, setCredentialRecovery] = useState<CredentialRecovery>();
  const [destructiveAction, setDestructiveAction] = useState<DestructiveAction>();
  const credentialSecretRef = useRef<string | undefined>(undefined);
  const draftTestSecretRef = useRef<string | undefined>(undefined);

  const settingsQuery = useQuery({
    queryKey: settingsQueryKey(projectId),
    queryFn: ({ signal }) => apiClient.getAISettings(projectId, { signal }),
    enabled: open && Boolean(projectId),
  });
  const settings = settingsQuery.data;

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setFeedback(undefined);
    setTestResult(undefined);
    setPendingPrivacyProposal(undefined);
    setCredentialRecovery(undefined);
    setDestructiveAction(undefined);
    setDraftSecret('');
    credentialSecretRef.current = undefined;
    draftTestSecretRef.current = undefined;
    setInitializedProjectId('');
  }, [commandId, invoker, open]);

  useEffect(() => {
    if (!settings || initializedProjectId === settings.projectId) return;
    const providerId =
      settings.currentConfiguration?.activeProviderId ?? settings.defaultProviderId;
    const provider =
      settings.providers.find((candidate) => candidate.providerId === providerId) ??
      settings.providers.find((candidate) => candidate.status === 'active') ??
      settings.providers[0];
    const selectedProvider = provider?.providerId ?? '';
    const configuredModel =
      settings.currentConfiguration?.activeProviderId === selectedProvider
        ? settings.currentConfiguration.activeModelId
        : undefined;
    const model =
      provider?.models.find((candidate) => candidate.modelId === configuredModel) ??
      provider?.models[0];
    setSelectedProviderId(selectedProvider);
    setSelectedModelId(model?.modelId ?? '');
    setDraftSecret('');
    credentialSecretRef.current = undefined;
    draftTestSecretRef.current = undefined;
    setTestResult(undefined);
    setFeedback(undefined);
    setInitializedProjectId(settings.projectId);
  }, [initializedProjectId, settings]);

  const selectedProvider = useMemo(
    () => settings?.providers.find((provider) => provider.providerId === selectedProviderId),
    [selectedProviderId, settings?.providers],
  );
  const selectedProviderIsActive = selectedProvider?.status === 'active';
  const selectedModel = selectedProvider?.models.find((model) => model.modelId === selectedModelId);
  const selectedPrivacy = settings?.privacy.find(
    (privacy) => privacy.providerId === selectedProviderId,
  );
  const usableCredential = settings
    ? exactOrUnambiguousCredential(settings, selectedProviderId)
    : undefined;
  const activeCredentials = settings ? activeCredentialCount(settings, selectedProviderId) : 0;
  const hasAmbiguousCredentials = !usableCredential && activeCredentials > 1;
  const hasVault = settings?.vaultAvailability.state === 'AVAILABLE';
  const canTest = Boolean(
    settings && selectedProviderIsActive && selectedModel && (draftSecret || usableCredential),
  );
  const canSave = Boolean(
    settings &&
    selectedProviderIsActive &&
    selectedModel &&
    (draftSecret ? hasVault : usableCredential) &&
    !hasAmbiguousCredentials,
  );
  const refreshSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: settingsQueryKey(projectId) });
    await settingsQuery.refetch();
  };

  const configurationMutation = useMutation({
    mutationFn: (input: ConfigurationSubmission) =>
      apiClient.saveAIConfiguration({
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        providerId: input.providerId,
        modelId: input.modelId,
        credentialId: input.credentialId,
        credentialRevision: input.credentialRevision,
      }),
    onSuccess: async () => {
      setFeedback({
        tone: 'success',
        title: 'AI configuration saved',
        detail: 'The selected provider and model are ready for the next new AI execution.',
      });
      setTestResult(undefined);
      await refreshSettings();
    },
    onError: async (error, input) => {
      setFeedback({
        tone: 'error',
        title: input.credentialWasSaved
          ? 'Credential saved; AI configuration was not changed'
          : 'AI configuration was not saved',
        detail: input.credentialWasSaved
          ? 'The saved credential was not repeated. Refresh the current settings and explicitly try the configuration again.'
          : safeErrorMessage(error),
      });
      if (input.credentialWasSaved) await refreshSettings();
    },
  });

  const credentialMutation = useMutation({
    mutationFn: async (input: CredentialSubmission): Promise<AICredentialMetadata> => {
      const secret = credentialSecretRef.current;
      if (!secret) throw new Error('The credential secret is no longer available.');
      if (input.operation === 'REPLACE') {
        if (input.credentialId === undefined || input.expectedCredentialRevision === undefined) {
          throw new Error('The exact credential could not be selected.');
        }
        return apiClient.replaceAICredential({
          projectId: input.projectId,
          providerId: input.providerId,
          credentialId: input.credentialId,
          expectedRevision: input.expectedCredentialRevision,
          secret,
          clientRequestId: input.clientRequestId,
        });
      }
      return apiClient.createAICredential({
        projectId: input.projectId,
        providerId: input.providerId,
        secret,
        clientRequestId: input.clientRequestId,
      });
    },
    onSuccess: (credential, input) => {
      setDraftSecret('');
      credentialSecretRef.current = undefined;
      setCredentialRecovery(undefined);
      configurationMutation.mutate({
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        providerId: input.providerId,
        modelId: input.modelId,
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        credentialWasSaved: true,
      });
    },
    onError: (error, input) => {
      setDraftSecret('');
      credentialSecretRef.current = undefined;
      if (!isConclusiveCredentialRejection(error)) {
        setCredentialRecovery(input);
        setFeedback({
          tone: 'info',
          title: 'Credential result needs checking',
          detail: 'The credential write was not repeated. Check the result to continue safely.',
        });
        return;
      }
      setFeedback({
        tone: 'error',
        title: 'Credential was not saved',
        detail: safeErrorMessage(error),
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: (input: TestSubmission) => {
      if (input.secretSource === 'DRAFT') {
        const draftSecret = draftTestSecretRef.current;
        if (!draftSecret) throw new Error('The draft secret is no longer available.');
        return apiClient.testAIConnection({
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          draftSecret,
        });
      }
      return apiClient.testAIConnection({
        projectId: input.projectId,
        providerId: input.providerId,
        modelId: input.modelId,
        credentialId: input.credentialId!,
        credentialRevision: input.credentialRevision!,
      });
    },
    onSuccess: (result) => {
      draftTestSecretRef.current = undefined;
      setTestResult(result);
      setFeedback({
        tone: result.status === 'CONNECTED' ? 'success' : 'error',
        title: statusLabel(result.status),
        detail: result.safeMessage,
      });
    },
    onError: (error) => {
      draftTestSecretRef.current = undefined;
      setTestResult(undefined);
      setFeedback({
        tone: 'error',
        title: 'Test Connection failed',
        detail: safeErrorMessage(error),
      });
    },
  });

  const privacyMutation = useMutation<
    AIProviderPrivacyProposal | AISettingsApproval,
    unknown,
    'propose' | 'approve'
  >({
    mutationFn: (action: 'propose' | 'approve') => {
      if (!settings || !selectedProviderIsActive || !selectedProvider || !selectedPrivacy) {
        throw new Error('Select a registered provider before requesting privacy review.');
      }
      if (action === 'approve') {
        if (!pendingPrivacyProposal)
          throw new Error('No provider privacy proposal is awaiting review.');
        return apiClient.approveAIProviderPrivacyProposal({
          projectId: settings.projectId,
          providerId: selectedProvider.providerId,
          proposalId: pendingPrivacyProposal.proposalId,
          expectedApprovalRevision: pendingPrivacyProposal.expectedApprovalRevision,
        });
      }
      return apiClient.proposeAIProviderPrivacyApproval({
        projectId: settings.projectId,
        providerId: selectedProvider.providerId,
        approved: true,
        expectedApprovalRevision: selectedPrivacy.approval?.approvalRevision ?? 0,
      });
    },
    onSuccess: async (result, action) => {
      if (action === 'propose') {
        setPendingPrivacyProposal(result as AIProviderPrivacyProposal);
        setFeedback({
          tone: 'info',
          title: 'Provider privacy review proposed',
          detail: 'The proposal still requires a separate Owner approval.',
        });
        return;
      }
      setPendingPrivacyProposal(undefined);
      setFeedback({
        tone: 'success',
        title: 'Provider privacy decision saved',
        detail: 'This decision applies only to the selected provider.',
      });
      await refreshSettings();
    },
    onError: (error) =>
      setFeedback({
        tone: 'error',
        title: 'Provider privacy review failed',
        detail: safeErrorMessage(error),
      }),
  });

  const credentialActionMutation = useMutation({
    mutationFn: (action: 'revoke' | 'remove') => {
      if (!settings || !selectedProvider || !usableCredential) {
        throw new Error('The exact active credential is no longer available.');
      }
      const input = {
        projectId: settings.projectId,
        providerId: selectedProvider.providerId,
        credentialId: usableCredential.credentialId,
        credentialRevision: usableCredential.credentialRevision,
      };
      return action === 'revoke'
        ? apiClient.revokeAICredential(input)
        : apiClient.removeAICredential(input);
    },
    onSuccess: async (_, action) => {
      setDestructiveAction(undefined);
      setDraftSecret('');
      setFeedback({
        tone: 'success',
        title: action === 'revoke' ? 'Credential revoked' : 'Credential removed',
        detail: 'No other provider or credential was activated automatically.',
      });
      await refreshSettings();
    },
    onError: (error, action) =>
      setFeedback({
        tone: 'error',
        title: `Credential ${action} failed`,
        detail: safeErrorMessage(error),
      }),
  });

  const resolveCredentialOutcome = async () => {
    if (!credentialRecovery) return;
    try {
      const credential =
        credentialRecovery.operation === 'REPLACE'
          ? await apiClient.getAICredentialWriteOutcome({
              projectId: credentialRecovery.projectId,
              clientRequestId: credentialRecovery.clientRequestId,
              providerId: credentialRecovery.providerId,
              operation: 'REPLACE',
              credentialId: credentialRecovery.credentialId!,
              expectedRevision: credentialRecovery.expectedCredentialRevision!,
            })
          : await apiClient.getAICredentialWriteOutcome({
              projectId: credentialRecovery.projectId,
              clientRequestId: credentialRecovery.clientRequestId,
              providerId: credentialRecovery.providerId,
              operation: 'CREATE',
            });
      setCredentialRecovery(undefined);
      setDraftSecret('');
      configurationMutation.mutate({
        projectId: credentialRecovery.projectId,
        expectedRevision: credentialRecovery.expectedRevision,
        providerId: credentialRecovery.providerId,
        modelId: credentialRecovery.modelId,
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        credentialWasSaved: true,
      });
    } catch {
      setFeedback({
        tone: 'info',
        title: 'Credential result still needs checking',
        detail: 'No credential write was repeated. Check the result again later.',
      });
    }
  };

  const handleProviderChange = (providerId: string) => {
    const provider = settings?.providers.find((candidate) => candidate.providerId === providerId);
    if (!provider || provider.status !== 'active') return;
    setSelectedProviderId(providerId);
    setSelectedModelId(provider?.models[0]?.modelId ?? '');
    draftTestSecretRef.current = undefined;
    setTestResult(undefined);
    setPendingPrivacyProposal(undefined);
    setFeedback(undefined);
  };

  const handleTest = () => {
    if (
      !settings ||
      !selectedProviderIsActive ||
      !selectedProvider ||
      !selectedModel ||
      testMutation.isPending
    )
      return;
    const usesDraftSecret = Boolean(draftSecret);
    if (usesDraftSecret) draftTestSecretRef.current = draftSecret;
    setDraftSecret('');
    testMutation.mutate({
      projectId: settings.projectId,
      expectedRevision: settings.currentConfiguration?.aiConfigurationRevision ?? 0,
      providerId: selectedProvider.providerId,
      modelId: selectedModel.modelId,
      secretSource: usesDraftSecret ? 'DRAFT' : 'STORED',
      ...(usesDraftSecret || !usableCredential
        ? {}
        : {
            credentialId: usableCredential.credentialId,
            credentialRevision: usableCredential.credentialRevision,
          }),
    });
  };

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      commandId !== 'ai.configure' ||
      !settings ||
      !selectedProviderIsActive ||
      !selectedProvider ||
      !selectedModel ||
      !canSave ||
      credentialRecovery
    )
      return;
    const configuration = {
      projectId: settings.projectId,
      expectedRevision: settings.currentConfiguration?.aiConfigurationRevision ?? 0,
      providerId: selectedProvider.providerId,
      modelId: selectedModel.modelId,
    } satisfies ConfigurationInput;
    setFeedback(undefined);
    if (draftSecret) {
      credentialSecretRef.current = draftSecret;
      const input: CredentialSubmission = {
        ...configuration,
        clientRequestId: identity(),
        operation: usableCredential ? 'REPLACE' : 'CREATE',
        ...(usableCredential
          ? {
              credentialId: usableCredential.credentialId,
              expectedCredentialRevision: usableCredential.credentialRevision,
            }
          : {}),
      };
      setDraftSecret('');
      credentialMutation.mutate(input);
      return;
    }
    if (!usableCredential) return;
    configurationMutation.mutate({
      ...configuration,
      credentialId: usableCredential.credentialId,
      credentialRevision: usableCredential.credentialRevision,
      credentialWasSaved: false,
    });
  };

  if (!open || !commandId) return null;
  if (!projectId) return null;

  const isConfigure = commandId === 'ai.configure';
  const mutationPending =
    credentialMutation.isPending ||
    configurationMutation.isPending ||
    testMutation.isPending ||
    privacyMutation.isPending ||
    credentialActionMutation.isPending;
  const actionPending = mutationPending || credentialRecovery !== undefined;
  const canApprovePrivacy = pendingPrivacyProposal !== undefined;
  const privacyIsApproved = isPrivacyApproved(selectedPrivacy);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={dialog.onDialogKeyDown}
    >
      <div className="modal-card ai-command-surface">
        <h2 id={titleId}>{isConfigure ? t('ai.configure') : t('ai.test')}</h2>
        {feedback ? (
          <p
            className={`ai-command-message ai-command-message-${feedback.tone}`}
            role={feedback.tone === 'error' ? 'alert' : 'status'}
          >
            <strong>{feedback.title}</strong>
            {feedback.detail ? <span>{feedback.detail}</span> : null}
          </p>
        ) : null}
        {settingsQuery.isLoading ? <p>{t('ai.loading')}</p> : null}
        {settingsQuery.isError ? <p role="alert">Failed to load AI settings.</p> : null}
        {settings && selectedProvider && selectedModel ? (
          <>
            <form onSubmit={handleSave}>
              <label htmlFor="ai-command-provider">{t('ai.provider')}</label>
              <select
                id="ai-command-provider"
                value={selectedProviderId}
                onChange={(event) => handleProviderChange(event.currentTarget.value)}
                disabled={actionPending}
              >
                {settings.providers.map((provider) => (
                  <option
                    key={provider.providerId}
                    value={provider.providerId}
                    disabled={provider.status !== 'active'}
                  >
                    {provider.displayName}
                    {provider.status !== 'active' ? ' (Unavailable)' : ''}
                  </option>
                ))}
              </select>
              <label htmlFor="ai-command-model">{t('ai.model')}</label>
              <select
                id="ai-command-model"
                value={selectedModelId}
                onChange={(event) => {
                  setSelectedModelId(event.currentTarget.value);
                  setTestResult(undefined);
                }}
                disabled={actionPending}
              >
                {selectedProvider.models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </select>
              <label htmlFor="ai-command-secret">{t('ai.api_key')}</label>
              <input
                id="ai-command-secret"
                type="password"
                value={draftSecret}
                autoComplete="new-password"
                onChange={(event) => setDraftSecret(event.currentTarget.value)}
                disabled={actionPending}
              />
              {settings.vaultAvailability.state !== 'AVAILABLE' ? (
                <p role="status">
                  Credential management is unavailable right now. Draft-only Test Connection is
                  still available.
                </p>
              ) : null}
              {!selectedProviderIsActive ? (
                <p role="status">
                  This provider is currently unavailable. Choose an available provider to continue.
                </p>
              ) : null}
              {hasAmbiguousCredentials ? (
                <p role="status">
                  Multiple active credentials are available. No credential was selected
                  automatically.
                </p>
              ) : (
                <p role="status">
                  {usableCredential ? 'Credential configured.' : 'No credential configured.'}
                </p>
              )}
              <div className="dialog-actions">
                <button type="button" onClick={handleTest} disabled={actionPending || !canTest}>
                  {testMutation.isPending ? t('ai.testing') : t('ai.test_connection')}
                </button>
                {isConfigure ? (
                  <button type="submit" disabled={actionPending || !canSave}>
                    {credentialMutation.isPending || configurationMutation.isPending
                      ? t('common.saving')
                      : t('ai.save_configuration')}
                  </button>
                ) : null}
              </div>
            </form>
            {credentialRecovery ? (
              <button
                type="button"
                onClick={() => void resolveCredentialOutcome()}
                disabled={mutationPending}
              >
                {t('common.check_result')}
              </button>
            ) : null}
            {testResult ? (
              <p role="status">
                {statusLabel(testResult.status)}: {testResult.safeMessage}
              </p>
            ) : null}
            {isConfigure ? (
              <section className="ai-command-section" aria-labelledby="ai-privacy-heading">
                <h3 id="ai-privacy-heading">{t('ai.provider_privacy')}</h3>
                <p>{privacyStateLabel(selectedPrivacy)}</p>
                {selectedPrivacy?.legacyGeminiCompatibility ? (
                  <p>Historical Gemini compatibility applies only to this provider.</p>
                ) : null}
                {selectedPrivacy && !privacyIsApproved && !canApprovePrivacy ? (
                  <button
                    type="button"
                    onClick={() => privacyMutation.mutate('propose')}
                    disabled={actionPending || !selectedProviderIsActive}
                  >
                    Request provider privacy approval
                  </button>
                ) : null}
                {canApprovePrivacy ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Approve this provider privacy decision?')) {
                        privacyMutation.mutate('approve');
                      }
                    }}
                    disabled={actionPending || !selectedProviderIsActive}
                  >
                    Approve provider privacy decision
                  </button>
                ) : null}
                {selectedPrivacy?.deploymentAllowed && privacyIsApproved ? (
                  <p>
                    Private external transfer is available only when deployment policy permits it.
                  </p>
                ) : null}
              </section>
            ) : null}
            {isConfigure && usableCredential ? (
              <section className="ai-command-section" aria-labelledby="ai-credential-heading">
                <h3 id="ai-credential-heading">{t('ai.credential_actions')}</h3>
                {settings.currentConfiguration?.credentialId === usableCredential.credentialId ? (
                  <p>This credential is used by the current saved configuration.</p>
                ) : null}
                {destructiveAction ? (
                  <div>
                    <p>
                      {destructiveAction === 'revoke'
                        ? 'Revoke this credential? Existing configuration will not fall back to another provider.'
                        : 'Remove this credential? This action cannot be undone from this surface.'}
                    </p>
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => credentialActionMutation.mutate(destructiveAction)}
                    >
                      Confirm {destructiveAction === 'revoke' ? 'revoke' : 'remove'} credential
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestructiveAction(undefined)}
                      disabled={actionPending}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="dialog-actions">
                    <button
                      type="button"
                      onClick={() => setDestructiveAction('revoke')}
                      disabled={actionPending}
                    >
                      Revoke credential
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestructiveAction('remove')}
                      disabled={actionPending}
                    >
                      Remove credential
                    </button>
                  </div>
                )}
              </section>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                onClick={onClose}
                disabled={credentialMutation.isPending || configurationMutation.isPending}
              >
                {t('common.close')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};
