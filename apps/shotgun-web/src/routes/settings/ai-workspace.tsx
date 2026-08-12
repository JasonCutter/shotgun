import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AICredentialMetadata,
  AITestConnectionResult,
  AISettingsCredentialStatus,
  AISettingsProvider,
  AISettingsPrivacyStatus,
} from '@shotgun/api-client';

import { useAppRuntime } from '../../app/providers.js';
import { sessionQueryOptions } from '../../session/session-query.js';

type SettingsOutletContext = {
  readonly requestConfirmation?: (message: string, action: () => void) => void;
};

type Feedback = {
  readonly tone: 'success' | 'error' | 'info';
  readonly title: string;
  readonly detail?: string;
};

const providerLabel = (provider: AISettingsProvider): string => provider.displayName;

const latestCredential = (
  credentials: readonly AISettingsCredentialStatus[],
  providerId: string,
): AISettingsCredentialStatus | undefined =>
  [...credentials]
    .filter((credential) => credential.providerId === providerId)
    .sort((left, right) => right.credentialRevision - left.credentialRevision)[0];

const activeCredential = (
  credentials: readonly AISettingsCredentialStatus[],
  providerId: string,
): AISettingsCredentialStatus | undefined =>
  [...credentials]
    .filter(
      (credential) =>
        credential.providerId === providerId && credential.lifecycleState === 'active',
    )
    .sort((left, right) => right.credentialRevision - left.credentialRevision)[0];

const privacyLabel = (privacy: AISettingsPrivacyStatus | undefined): string => {
  if (!privacy) return 'No provider privacy decision returned.';
  if (privacy.approval?.approved || privacy.legacyGeminiCompatibility) return 'Approved';
  if (privacy.approval) return 'Review required';
  return 'Not approved';
};

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'The AI settings command failed.';

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

const feedbackStyle = (tone: Feedback['tone']): CSSProperties => {
  if (tone === 'success') {
    return { background: '#f0fdf4', borderColor: '#86efac', color: '#166534' };
  }
  if (tone === 'error') {
    return { background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' };
  }
  return { background: '#eff6ff', borderColor: '#93c5fd', color: '#1e40af' };
};

export const AIWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const { requestConfirmation } = useOutletContext<SettingsOutletContext>();
  const [searchParams] = useSearchParams();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const targetProjectId = searchParams.get('targetProjectId') ?? session?.activeProject?.id ?? '';
  const feedbackRef = useRef<HTMLDivElement>(null);

  const settingsQuery = useQuery({
    queryKey: ['settings', 'ai', targetProjectId],
    queryFn: ({ signal }) => apiClient.getAISettings(targetProjectId, { signal }),
    enabled: Boolean(targetProjectId),
  });

  const settings = settingsQuery.data;
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [draftSecret, setDraftSecret] = useState('');
  const [initializedProjectId, setInitializedProjectId] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [testResult, setTestResult] = useState<AITestConnectionResult | null>(null);

  useEffect(() => {
    if (!settings || initializedProjectId === settings.projectId) return;
    const configuredProvider = settings.currentConfiguration?.activeProviderId;
    const providerId = configuredProvider ?? settings.defaultProviderId;
    const provider = settings.providers.find((candidate) => candidate.providerId === providerId);
    const configuredModel = settings.currentConfiguration?.activeModelId;
    const modelId =
      configuredModel ??
      provider?.models.find((model) => model.modelId)?.modelId ??
      provider?.models[0]?.modelId ??
      '';
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setDraftSecret('');
    setTestResult(null);
    setFeedback(null);
    setInitializedProjectId(settings.projectId);
  }, [initializedProjectId, settings]);

  useEffect(() => {
    if (feedback?.tone === 'error') feedbackRef.current?.focus();
  }, [feedback]);

  const selectedProvider = useMemo(
    () => settings?.providers.find((provider) => provider.providerId === selectedProviderId),
    [selectedProviderId, settings?.providers],
  );
  const selectedModel = selectedProvider?.models.find((model) => model.modelId === selectedModelId);
  const selectedPrivacy = settings?.privacy.find(
    (privacy) => privacy.providerId === selectedProviderId,
  );
  const currentCredential = useMemo(() => {
    if (!settings || !selectedProviderId) return undefined;
    const configured = settings.currentConfiguration;
    if (configured?.activeProviderId === selectedProviderId) {
      const exact = settings.credentialStatuses.find(
        (credential) =>
          credential.credentialId === configured.credentialId &&
          credential.credentialRevision === configured.credentialRevision,
      );
      if (exact) return exact;
    }
    return activeCredential(settings.credentialStatuses, selectedProviderId);
  }, [selectedProviderId, settings]);
  const latestSelectedCredential = settings
    ? latestCredential(settings.credentialStatuses, selectedProviderId)
    : undefined;
  const usableCredential =
    currentCredential?.lifecycleState === 'active' ? currentCredential : undefined;
  const serverRevision = settings?.currentConfiguration?.aiConfigurationRevision ?? 0;
  const hasCredential = Boolean(usableCredential);
  const canSave =
    Boolean(settings && selectedProvider && selectedModel) &&
    Boolean(draftSecret || hasCredential) &&
    settings?.vaultAvailability.state === 'AVAILABLE';

  const invalidateSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings', 'ai', targetProjectId] });
  };

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider || !selectedModel || !settings) {
        throw new Error('Select a registered provider and model first.');
      }
      if (draftSecret) {
        return apiClient.testAIConnection({
          projectId: settings.projectId,
          providerId: selectedProvider.providerId,
          modelId: selectedModel.modelId,
          draftSecret,
        });
      }
      if (!usableCredential) throw new Error('Enter an API key or select a stored credential.');
      return apiClient.testAIConnection({
        projectId: settings.projectId,
        providerId: selectedProvider.providerId,
        modelId: selectedModel.modelId,
        credentialId: usableCredential.credentialId,
        credentialRevision: usableCredential.credentialRevision,
      });
    },
    onSuccess: (result) => {
      setTestResult(result);
      setFeedback({
        tone: result.status === 'CONNECTED' ? 'success' : 'error',
        title: statusLabel(result.status),
        detail: result.safeMessage,
      });
    },
    onError: (error) => {
      setTestResult(null);
      setFeedback({
        tone: 'error',
        title: 'Test Connection failed',
        detail: safeErrorMessage(error),
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!settings || !selectedProvider || !selectedModel) {
        throw new Error('Select a registered provider and model first.');
      }
      let credential: AICredentialMetadata | undefined;
      let credentialWasSaved = false;
      if (draftSecret) {
        credential = usableCredential
          ? await apiClient.replaceAICredential({
              projectId: settings.projectId,
              providerId: selectedProvider.providerId,
              credentialId: usableCredential.credentialId,
              expectedRevision: usableCredential.credentialRevision,
              secret: draftSecret,
            })
          : await apiClient.createAICredential({
              projectId: settings.projectId,
              providerId: selectedProvider.providerId,
              secret: draftSecret,
            });
        credentialWasSaved = true;
        setDraftSecret('');
      }
      const credentialId = credential?.credentialId ?? usableCredential?.credentialId;
      const credentialRevision =
        credential?.credentialRevision ?? usableCredential?.credentialRevision;
      if (!credentialId || credentialRevision === undefined) {
        throw new Error('An active credential is required before saving the configuration.');
      }
      try {
        return await apiClient.saveAIConfiguration({
          projectId: settings.projectId,
          expectedRevision: serverRevision,
          providerId: selectedProvider.providerId,
          modelId: selectedModel.modelId,
          credentialId,
          credentialRevision,
        });
      } catch (error) {
        if (credentialWasSaved) {
          throw new PartialSaveError(safeErrorMessage(error));
        }
        throw error;
      }
    },
    onSuccess: async () => {
      setTestResult(null);
      setFeedback({
        tone: 'success',
        title: 'AI configuration saved',
        detail:
          'The saved configuration is ready for the next runtime-enabled execution. Ask routing has not changed in A7.',
      });
      await invalidateSettings();
    },
    onError: async (error) => {
      if (error instanceof PartialSaveError) {
        setFeedback({
          tone: 'error',
          title: 'Credential saved; AI configuration was not changed',
          detail: `${error.message} Reload current settings and explicitly retry the configuration save. The key input was discarded and no duplicate credential request was sent.`,
        });
        await invalidateSettings();
        return;
      }
      setFeedback({
        tone: 'error',
        title: 'AI configuration was not saved',
        detail: safeErrorMessage(error),
      });
    },
  });

  const runCredentialAction = (action: 'revoke' | 'remove') => {
    if (!settings || !selectedProvider || !usableCredential) return;
    const command = async () => {
      try {
        if (action === 'revoke') {
          await apiClient.revokeAICredential({
            projectId: settings.projectId,
            providerId: selectedProvider.providerId,
            credentialId: usableCredential.credentialId,
            credentialRevision: usableCredential.credentialRevision,
          });
        } else {
          await apiClient.removeAICredential({
            projectId: settings.projectId,
            providerId: selectedProvider.providerId,
            credentialId: usableCredential.credentialId,
            credentialRevision: usableCredential.credentialRevision,
          });
        }
        setTestResult(null);
        setDraftSecret('');
        setFeedback({
          tone: 'success',
          title: action === 'revoke' ? 'Credential revoked' : 'Credential removed',
          detail: 'No other provider or credential was activated automatically.',
        });
        await invalidateSettings();
      } catch (error) {
        setFeedback({
          tone: 'error',
          title: `Credential ${action} failed`,
          detail: safeErrorMessage(error),
        });
      }
    };
    const message =
      action === 'revoke'
        ? 'Revoke this credential? Existing configuration will not fall back to another provider.'
        : 'Remove this credential? This cannot be undone from the Product surface.';
    if (requestConfirmation) requestConfirmation(message, () => void command());
    else if (window.confirm(message)) void command();
  };

  const handleProviderChange = (providerId: string) => {
    const provider = settings?.providers.find((candidate) => candidate.providerId === providerId);
    setSelectedProviderId(providerId);
    setSelectedModelId(provider?.models[0]?.modelId ?? '');
    setTestResult(null);
    setFeedback(null);
  };

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saveMutation.isPending) saveMutation.mutate();
  };

  if (!targetProjectId) return <div>Choose an active Project before configuring AI.</div>;
  if (settingsQuery.isLoading) return <div>Loading AI settings...</div>;
  if (settingsQuery.error || !settings) {
    return <div className="error-banner">Failed to load server-authoritative AI settings.</div>;
  }

  const privateEligible = Boolean(
    selectedPrivacy?.deploymentAllowed &&
    (selectedPrivacy.approval?.approved || selectedPrivacy.legacyGeminiCompatibility),
  );
  const latestState = latestSelectedCredential?.lifecycleState;
  const currentCredentialReferenced = Boolean(
    settings.currentConfiguration?.credentialId === currentCredential?.credentialId,
  );

  return (
    <section className="ai-settings-workspace" aria-labelledby="ai-settings-heading">
      <header>
        <p className="eyebrow">Canonical Product workspace</p>
        <h2
          id="ai-settings-heading"
          tabIndex={-1}
          style={{ fontSize: '24px', marginBottom: '8px' }}
        >
          Settings → AI
        </h2>
        <p style={{ color: '#475569', maxWidth: '760px' }}>
          Choose a registered provider and model, manage a Project credential, and save the next
          runtime configuration. A7 does not switch Ask routing yet.
        </p>
      </header>

      {feedback ? (
        <div
          ref={feedbackRef}
          tabIndex={feedback.tone === 'error' ? -1 : undefined}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          style={{
            border: '1px solid',
            borderRadius: '8px',
            padding: '12px',
            ...feedbackStyle(feedback.tone),
          }}
        >
          <strong>{feedback.title}</strong>
          {feedback.detail ? <p style={{ margin: '4px 0 0' }}>{feedback.detail}</p> : null}
        </div>
      ) : null}

      {settings.mode === 'LEGACY_GEMINI_COMPATIBILITY' ? (
        <div className="notice-banner" style={{ marginTop: '16px' }}>
          <strong>Legacy Gemini compatibility</strong>
          <p>
            This Project has no managed AI configuration. Historical Gemini approval remains
            Gemini-only.{' '}
            {settings.legacyGeminiCredentialConfigured
              ? 'A legacy deployment credential is configured, but its value is never shown here.'
              : 'No legacy credential metadata is available.'}
          </p>
          <p>
            Save a Project-managed configuration to migrate explicitly; no hidden migration occurs.
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSave} style={{ display: 'grid', gap: '16px', marginTop: '20px' }}>
        <div className="settings-card" style={{ display: 'grid', gap: '14px' }}>
          <h3 style={{ margin: 0 }}>Provider and model</h3>
          <div>
            <label
              htmlFor="ai-provider"
              style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
            >
              AI Provider
            </label>
            <select
              id="ai-provider"
              value={selectedProviderId}
              onChange={(event) => handleProviderChange(event.target.value)}
              disabled={saveMutation.isPending || testMutation.isPending}
              style={{ width: '100%', padding: '9px' }}
            >
              {settings.providers.map((provider) => (
                <option
                  key={provider.providerId}
                  value={provider.providerId}
                  disabled={provider.status !== 'active'}
                >
                  {providerLabel(provider)}
                  {provider.status !== 'active' ? ' (Unavailable)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="ai-model"
              style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
            >
              Model
            </label>
            <select
              id="ai-model"
              value={selectedModelId}
              onChange={(event) => {
                setSelectedModelId(event.target.value);
                setTestResult(null);
              }}
              disabled={saveMutation.isPending || testMutation.isPending || !selectedProvider}
              style={{ width: '100%', padding: '9px' }}
            >
              {selectedProvider?.models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName} ({model.modelId})
                </option>
              ))}
            </select>
            {selectedModel ? (
              <p style={{ color: '#64748b', fontSize: '13px', margin: '6px 0 0' }}>
                Server catalog revision {selectedModel.capabilityRevision}. Shotgun capabilities:{' '}
                {selectedModel.shotgunUsableCapabilities.join(', ') || 'none'}.
              </p>
            ) : (
              <p role="status">No server-enabled model is available for this provider.</p>
            )}
          </div>
        </div>

        <div className="settings-card" style={{ display: 'grid', gap: '12px' }}>
          <h3 style={{ margin: 0 }}>Project credential</h3>
          <p style={{ margin: 0 }}>
            <strong>Status:</strong>{' '}
            {currentCredential?.lifecycleState === 'active'
              ? `Configured · revision ${currentCredential.credentialRevision}`
              : latestState
                ? `No active credential · latest state ${latestState}`
                : 'No Project credential configured'}
          </p>
          {currentCredentialReferenced ? (
            <p style={{ color: '#92400e', margin: 0 }}>
              The active Project configuration references this credential. Revoke/remove will not
              activate another provider or key.
            </p>
          ) : null}
          <label htmlFor="ai-api-key" style={{ fontWeight: 600 }}>
            API Key (write-only)
          </label>
          <input
            id="ai-api-key"
            name="ai-api-key"
            type="password"
            value={draftSecret}
            onChange={(event) => {
              setDraftSecret(event.target.value);
              setTestResult(null);
            }}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={
              currentCredential
                ? 'Enter a new key to replace the current revision'
                : 'Enter a provider API key'
            }
            disabled={saveMutation.isPending || testMutation.isPending}
            style={{ width: '100%', padding: '9px' }}
          />
          <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>
            Existing keys are never displayed. This value is held only in this form and is cleared
            after a successful credential save or navigation away.
          </p>
          {usableCredential ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => runCredentialAction('revoke')}
                disabled={saveMutation.isPending || testMutation.isPending}
              >
                Revoke credential
              </button>
              <button
                type="button"
                onClick={() => runCredentialAction('remove')}
                disabled={saveMutation.isPending || testMutation.isPending}
              >
                Remove credential
              </button>
            </div>
          ) : null}
        </div>

        <div className="settings-card" style={{ display: 'grid', gap: '12px' }}>
          <h3 style={{ margin: 0 }}>Connection and save</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={
                testMutation.isPending ||
                saveMutation.isPending ||
                (!draftSecret && !usableCredential)
              }
            >
              {testMutation.isPending ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending || testMutation.isPending || !canSave}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save AI configuration'}
            </button>
          </div>
          {testResult ? (
            <div role="status" aria-live="polite">
              <strong>Last Test Connection: {statusLabel(testResult.status)}</strong>
              <p style={{ margin: '4px 0 0' }}>{testResult.safeMessage}</p>
            </div>
          ) : (
            <p style={{ color: '#64748b', margin: 0 }}>
              Connection not tested. Test Connection is optional for Save.
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong>Configuration revision:</strong> {serverRevision}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Runtime:</strong> Saved settings do not cut Ask over to provider routing in A7.
          </p>
        </div>
      </form>

      <section
        className="settings-card"
        aria-labelledby="ai-privacy-heading"
        style={{ marginTop: '16px' }}
      >
        <h3 id="ai-privacy-heading" style={{ margin: 0 }}>
          Privacy and deployment
        </h3>
        <p>
          <strong>Provider:</strong>{' '}
          {selectedProvider ? providerLabel(selectedProvider) : 'Not selected'}
        </p>
        <p>
          <strong>Project approval:</strong> {privacyLabel(selectedPrivacy)}
          {selectedPrivacy?.approval
            ? ` · revision ${selectedPrivacy.approval.approvalRevision}`
            : ''}
          {selectedPrivacy?.legacyGeminiCompatibility ? ' · historical Gemini compatibility' : ''}
        </p>
        <p>
          <strong>Deployment:</strong> {selectedPrivacy?.deploymentAllowed ? 'Allowed' : 'Blocked'}
        </p>
        <p>
          <strong>Effective private eligibility:</strong>{' '}
          {privateEligible ? 'Eligible' : 'Not eligible'}
        </p>
        <p>Restricted Project data is always blocked from external AI transfer.</p>
        {selectedPrivacy && !privateEligible ? (
          <Link to={`/settings/privacy?targetProjectId=${encodeURIComponent(targetProjectId)}`}>
            Open Owner privacy review
          </Link>
        ) : null}
        <p style={{ color: '#64748b', fontSize: '13px' }}>
          The UI only presents A4 authority. It cannot approve REVIEW_REQUIRED or raise the
          deployment ceiling.
        </p>
      </section>
    </section>
  );
};

class PartialSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialSaveError';
  }
}
