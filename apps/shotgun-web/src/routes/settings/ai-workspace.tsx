import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router';
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

const soleCredential = (
  credentials: readonly AISettingsCredentialStatus[],
  providerId: string,
  lifecycleState?: AISettingsCredentialStatus['lifecycleState'],
): AISettingsCredentialStatus | undefined => {
  const matches = credentials.filter(
    (credential) =>
      credential.providerId === providerId &&
      (lifecycleState === undefined || credential.lifecycleState === lifecycleState),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const credentialWriteRequestId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? `ai-credential-write:${crypto.randomUUID()}`
    : `ai-credential-write:${Date.now()}:${Math.random().toString(16).slice(2)}`;

const privacyLabel = (privacy: AISettingsPrivacyStatus | undefined): string => {
  if (!privacy) return 'Review required';
  if (privacy.approval?.approved || privacy.legacyGeminiCompatibility) return 'Approved';
  if (privacy.approval?.approved === false) return 'Not approved / Rejected';
  return 'Review required';
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
    return {
      background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
      borderColor: 'var(--success)',
      borderLeft: '4px solid var(--success)',
      color: 'var(--ink)',
    };
  }
  if (tone === 'error') {
    return {
      background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
      borderColor: 'var(--danger)',
      borderLeft: '4px solid var(--danger)',
      color: 'var(--ink)',
    };
  }
  return {
    background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
    borderColor: 'var(--accent)',
    borderLeft: '4px solid var(--accent)',
    color: 'var(--ink)',
  };
};

export const AIWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const { requestConfirmation } = useOutletContext<SettingsOutletContext>();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const targetProjectId = session?.activeProject?.id ?? '';
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
  const credentialRequestIdRef = useRef<string | undefined>(undefined);

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
    return soleCredential(settings.credentialStatuses, selectedProviderId, 'active');
  }, [selectedProviderId, settings]);
  const onlySelectedCredential = settings
    ? soleCredential(settings.credentialStatuses, selectedProviderId)
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
        const clientRequestId = credentialRequestIdRef.current ?? credentialWriteRequestId();
        const recoveryBinding = usableCredential
          ? {
              operation: 'REPLACE' as const,
              providerId: selectedProvider.providerId,
              credentialId: usableCredential.credentialId,
              expectedRevision: usableCredential.credentialRevision,
            }
          : { operation: 'CREATE' as const, providerId: selectedProvider.providerId };
        credentialRequestIdRef.current = clientRequestId;
        try {
          credential = usableCredential
            ? await apiClient.replaceAICredential({
                projectId: settings.projectId,
                providerId: selectedProvider.providerId,
                credentialId: usableCredential.credentialId,
                expectedRevision: usableCredential.credentialRevision,
                secret: draftSecret,
                clientRequestId,
              })
            : await apiClient.createAICredential({
                projectId: settings.projectId,
                providerId: selectedProvider.providerId,
                secret: draftSecret,
                clientRequestId,
              });
        } catch (error) {
          try {
            credential = await apiClient.getAICredentialWriteOutcome({
              projectId: settings.projectId,
              clientRequestId,
              ...recoveryBinding,
            });
          } catch {
            throw error;
          }
        }
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
      credentialRequestIdRef.current = undefined;
      setTestResult(null);
      setFeedback({
        tone: 'success',
        title: 'AI configuration saved',
        detail:
          'Saved configuration applies to the next new AI execution. Existing and in-flight AnswerRuns, including retry pins, retain their original execution identity.',
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

  const standingPolicyMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!settings) throw new Error('AI settings are not loaded.');
      const configuration = settings.currentConfiguration;
      if (!configuration || configuration.activeProviderId !== selectedProviderId) {
        throw new Error(
          'Save the selected provider configuration before enabling automatic AI processing.',
        );
      }
      return apiClient.saveAIStandingPolicy({
        projectId: settings.projectId,
        expectedRevision: settings.standingPolicy?.policyRevision ?? 0,
        enabled,
        providerId: configuration.activeProviderId,
        aiConfigurationRevision: configuration.aiConfigurationRevision,
      });
    },
    onSuccess: async (policy) => {
      setFeedback({
        tone: 'success',
        title: policy.enabled
          ? 'AI automatic processing enabled'
          : 'AI automatic processing disabled',
        detail: policy.enabled
          ? 'Public and internal material, and private material permitted by deployment policy, can now use the configured provider automatically. Restricted material remains blocked.'
          : 'New AI-assisted processing is blocked until the Project Owner enables it again. In-flight execution pins are unchanged.',
      });
      await invalidateSettings();
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        title: 'AI automatic processing was not changed',
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

  const isPrivacyApproved = Boolean(
    selectedPrivacy?.approval?.approved || selectedPrivacy?.legacyGeminiCompatibility,
  );
  const latestState = onlySelectedCredential?.lifecycleState;
  const currentCredentialReferenced = Boolean(
    settings.currentConfiguration?.credentialId === currentCredential?.credentialId,
  );
  const standingPolicy = settings.standingPolicy;
  const standingProviderMatches =
    standingPolicy?.providerId === settings.currentConfiguration?.activeProviderId;
  const standingEnabled = standingPolicy?.enabled === true;
  const standingToggleDisabled =
    standingPolicyMutation.isPending ||
    saveMutation.isPending ||
    testMutation.isPending ||
    (!standingEnabled &&
      (!settings.currentConfiguration ||
        settings.currentConfiguration.activeProviderId !== selectedProviderId));

  return (
    <section className="ai-settings-workspace" aria-labelledby="ai-settings-heading">
      <header>
        <p className="eyebrow">Settings</p>
        <h2
          id="ai-settings-heading"
          tabIndex={-1}
          style={{ fontSize: '24px', marginBottom: '8px' }}
        >
          AI
        </h2>
        <p style={{ color: 'var(--muted)', maxWidth: '760px' }}>
          Choose an AI provider and model, configure your Project credential, and test the
          connection.
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

      <form onSubmit={handleSave} style={{ display: 'grid', gap: '16px', marginTop: '20px' }}>
        <div className="settings-card" style={{ display: 'grid', gap: '12px' }}>
          <h3 style={{ margin: 0 }}>AI Automatic Processing</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
            <input
              type="checkbox"
              aria-label="AI Automatic Processing"
              checked={standingEnabled}
              disabled={standingToggleDisabled}
              onChange={(event) => standingPolicyMutation.mutate(event.currentTarget.checked)}
            />
            {standingEnabled ? 'ON' : 'OFF'}
          </label>
          <p style={{ margin: 0 }}>
            <strong>Provider:</strong>{' '}
            {standingPolicy?.providerId
              ? (settings.providers.find(
                  (provider) => provider.providerId === standingPolicy.providerId,
                )?.displayName ?? standingPolicy.providerId)
              : selectedProvider
                ? providerLabel(selectedProvider)
                : 'Not configured'}
          </p>
          {standingEnabled && standingProviderMatches ? (
            <p style={{ margin: 0 }}>
              <strong>Private project material:</strong> Automatically usable by the configured AI
              provider when permitted by the deployment ceiling.
            </p>
          ) : standingEnabled ? (
            <p role="status" style={{ margin: 0, color: 'var(--attention)' }}>
              The configured provider changed. Save the new provider, then enable automatic
              processing for it explicitly.
            </p>
          ) : (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Enable this once to allow permitted AI-assisted processing across the Project.
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong>Restricted material:</strong> External AI blocked.
          </p>
        </div>

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
                  {model.displayName}
                </option>
              ))}
            </select>
            {!selectedModel ? (
              <p role="status">No server-enabled model is available for this provider.</p>
            ) : null}
          </div>
        </div>

        <div className="settings-card" style={{ display: 'grid', gap: '12px' }}>
          <h3 style={{ margin: 0 }}>Project credential</h3>
          <p style={{ margin: 0 }}>
            <strong>Status:</strong>{' '}
            {currentCredential?.lifecycleState === 'active'
              ? 'Configured'
              : latestState
                ? `No active credential · ${latestState}`
                : 'No Project credential configured'}
          </p>
          {currentCredentialReferenced ? (
            <div
              style={{
                border: '1px solid var(--attention)',
                borderLeft: '4px solid var(--attention)',
                borderRadius: 'var(--radius)',
                padding: '8px 12px',
                background: 'color-mix(in srgb, var(--attention) 8%, var(--surface))',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              The active Project configuration references this credential. Revoke/remove will not
              activate another provider or key.
            </div>
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
              credentialRequestIdRef.current = undefined;
              setDraftSecret(event.target.value);
              setTestResult(null);
            }}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={
              currentCredential
                ? 'Enter a new key to replace the current credential'
                : 'Enter a provider API key'
            }
            disabled={saveMutation.isPending || testMutation.isPending}
            style={{ width: '100%', padding: '9px' }}
          />
          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
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
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              Connection not tested. Test Connection is optional for Save.
            </p>
          )}
        </div>
      </form>

      <section
        className="settings-card"
        aria-labelledby="ai-privacy-heading"
        style={{ marginTop: '16px' }}
      >
        <h3 id="ai-privacy-heading" style={{ margin: 0 }}>
          Privacy status
        </h3>
        <p style={{ margin: '8px 0' }}>
          <strong>Provider:</strong>{' '}
          {selectedProvider ? providerLabel(selectedProvider) : 'Not selected'}
        </p>
        <p style={{ margin: '8px 0' }}>
          <strong>Project approval:</strong> {privacyLabel(selectedPrivacy)}
        </p>
        <p style={{ margin: '8px 0' }}>
          <strong>Deployment:</strong> {selectedPrivacy?.deploymentAllowed ? 'Allowed' : 'Blocked'}
        </p>
        {!isPrivacyApproved ? (
          <div
            style={{
              marginTop: '12px',
              border: '1px solid var(--attention)',
              borderLeft: '4px solid var(--attention)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
              background: 'color-mix(in srgb, var(--attention) 8%, var(--surface))',
            }}
          >
            <p style={{ color: 'var(--ink)', margin: '0 0 8px 0', fontWeight: 500 }}>
              Historical provider approval records are preserved for audit. Routine automatic
              processing is controlled by the Project-level switch above.
            </p>
            <Link
              to={`/settings/privacy?providerId=${selectedProviderId}`}
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius)',
                color: 'var(--ink)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '13px',
              }}
            >
              Review privacy in Settings → Privacy
            </Link>
          </div>
        ) : null}
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
