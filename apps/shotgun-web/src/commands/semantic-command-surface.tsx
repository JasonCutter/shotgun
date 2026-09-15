import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  ShotgunApiError,
  type GlobalShellView,
  type SemanticComparisonStatusView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { convergeOwnerState } from '../app/query-keys.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import {
  useProductLocalization,
  type ProductTranslator,
} from '../localization/product-localization.js';
import type { SemanticCommandId } from './owner-command-registry.js';

type Feedback = {
  readonly tone: 'success' | 'error' | 'info';
  readonly message: string;
};

export type SemanticCommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: SemanticCommandId | null;
  readonly shell: GlobalShellView;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

const statusQueryKey = (projectId: string) =>
  ['settings', 'ai', 'semantic-comparison', projectId] as const;
const commandIdentity = (prefix: string): string =>
  typeof crypto.randomUUID === 'function'
    ? `${prefix}:${crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

const semanticErrorMessage = (error: unknown, t: ProductTranslator): string => {
  if (error instanceof ShotgunApiError && error.code === 'CONFIGURATION_REQUIRED') {
    return t('semantic.configuration_required');
  }
  return safeErrorMessage(error);
};

const statusLabel = (
  status: SemanticComparisonStatusView['status'],
  t: ProductTranslator,
): string => {
  switch (status) {
    case 'NOT_CONFIGURED':
      return t('semantic.status_not_configured');
    case 'PREPARING':
      return t('semantic.status_preparing');
    case 'READY':
      return t('semantic.status_ready');
    case 'NEEDS_ATTENTION':
      return t('semantic.status_needs_attention');
  }
};

export const SemanticCommandSurface = ({
  open,
  commandId,
  shell,
  invoker,
  onClose,
}: SemanticCommandSurfaceProps) => {
  const { apiClient, queryClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const navigate = useNavigate();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const projectId = shell.activeProject?.id ?? '';
  const [feedback, setFeedback] = useState<Feedback>();
  const [privacyBlocked, setPrivacyBlocked] = useState(false);
  const [embeddingSecret, setEmbeddingSecret] = useState('');
  const [selectedEmbeddingOptionIndex, setSelectedEmbeddingOptionIndex] = useState<number>();

  const statusQuery = useQuery({
    queryKey: statusQueryKey(projectId),
    queryFn: ({ signal }) => apiClient.getSemanticComparisonStatus(projectId, { signal }),
    enabled: open && Boolean(projectId),
  });
  const selectedEmbeddingOption =
    selectedEmbeddingOptionIndex === undefined
      ? undefined
      : statusQuery.data?.embeddingOptions[selectedEmbeddingOptionIndex];

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setFeedback(undefined);
    setPrivacyBlocked(false);
  }, [commandId, invoker, open]);

  const refresh = async () => {
    await convergeOwnerState(queryClient, projectId);
    await statusQuery.refetch();
  };

  const prepareMutation = useMutation({
    mutationFn: () =>
      apiClient.prepareSemanticComparison(
        projectId,
        statusQuery.data?.status === 'NOT_CONFIGURED' && selectedEmbeddingOption
          ? {
              providerId: selectedEmbeddingOption.providerId,
              embeddingModelId: selectedEmbeddingOption.embeddingModelId,
            }
          : undefined,
      ),
    onSuccess: async (status) => {
      setPrivacyBlocked(false);
      await refresh();
      if (status.status === 'READY') {
        setFeedback({ tone: 'info', message: t('semantic.status_ready') });
      } else {
        setFeedback({ tone: 'error', message: t('semantic.refresh_blocked') });
      }
    },
    onError: (error) => {
      const isPrivacyBlocker = error instanceof ShotgunApiError && error.code === 'POLICY_DENIED';
      setPrivacyBlocked(isPrivacyBlocker);
      setFeedback({
        tone: 'error',
        message: isPrivacyBlocker
          ? t('semantic.privacy_required')
          : semanticErrorMessage(error, t) || t('semantic.failed'),
      });
    },
  });

  const activationMutation = useMutation({
    mutationFn: async () => {
      const readiness = await apiClient.getSemanticComparisonStatus(projectId);
      if (readiness.status !== 'READY') {
        throw new Error(t('semantic.not_ready'));
      }
      const snapshot = await apiClient.getSettingsSnapshot(projectId);
      return apiClient.applySettingsCommand({
        activeProjectId: projectId,
        targetProjectId: projectId,
        resourceProjectId: projectId,
        clientRequestId: commandIdentity('semantic-activation'),
        idempotencyKey: commandIdentity('semantic-activation'),
        expectedSettingsRevision: snapshot.settingsRevision,
        observedPolicyContextRevision: snapshot.policyContextRevision,
        settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
      });
    },
    onSuccess: async () => {
      await refresh();
      const confirmed = await apiClient.getSemanticComparisonStatus(projectId);
      if (confirmed.status === 'READY' && confirmed.rollout === 'V2_ACTIVE') {
        setFeedback({ tone: 'success', message: t('semantic.enabled') });
      } else {
        setFeedback({ tone: 'error', message: t('semantic.not_ready') });
      }
    },
    onError: (error) => {
      setFeedback({ tone: 'error', message: safeErrorMessage(error) || t('semantic.not_ready') });
    },
  });

  const saveCredentialMutation = useMutation({
    mutationFn: async () => {
      const options = statusQuery.data?.embeddingOptions ?? [];
      const option =
        selectedEmbeddingOptionIndex === undefined
          ? undefined
          : options[selectedEmbeddingOptionIndex];
      if (!option) throw new Error(t('semantic.no_embedding_options'));
      if (option.hasActiveCredential) throw new Error(t('semantic.credential_existing'));
      if (!embeddingSecret) throw new Error(t('semantic.embedding_credential'));

      const clientRequestId = commandIdentity('semantic-embedding-credential');
      try {
        return await apiClient.saveSemanticEmbeddingCredential({
          projectId,
          providerId: option.providerId,
          embeddingModelId: option.embeddingModelId,
          secret: embeddingSecret,
          clientRequestId,
        });
      } catch (error) {
        try {
          return await apiClient.getAICredentialWriteOutcome({
            projectId,
            providerId: option.providerId,
            operation: 'CREATE',
            clientRequestId,
          });
        } catch {
          throw error;
        }
      }
    },
    onSuccess: async () => {
      setEmbeddingSecret('');
      await refresh();
      setFeedback({ tone: 'success', message: t('semantic.credential_saved') });
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        message: semanticErrorMessage(error, t) || t('semantic.failed'),
      });
    },
  });

  useEffect(() => {
    const options = statusQuery.data?.embeddingOptions ?? [];
    if (
      selectedEmbeddingOptionIndex === undefined ||
      !options[selectedEmbeddingOptionIndex] ||
      options[selectedEmbeddingOptionIndex]?.hasActiveCredential
    ) {
      const preferredIndex = options.findIndex((option) => !option.hasActiveCredential);
      setSelectedEmbeddingOptionIndex(
        preferredIndex >= 0 ? preferredIndex : options.length ? 0 : undefined,
      );
    }
  }, [selectedEmbeddingOptionIndex, statusQuery.data]);

  if (!open || !commandId || !projectId) return null;

  const status = statusQuery.data;
  const busy =
    prepareMutation.isPending || activationMutation.isPending || saveCredentialMutation.isPending;
  const alreadyEnabled = status?.status === 'READY' && status.rollout === 'V2_ACTIVE';
  const canPrepare = !busy && !alreadyEnabled && status?.status !== 'PREPARING';
  const canEnable = !busy && status?.status === 'READY' && status.rollout !== 'V2_ACTIVE';
  const embeddingOptions = status?.embeddingOptions ?? [];
  const showEmbeddingCredentialSetup = status?.status === 'NOT_CONFIGURED';
  const canSaveEmbeddingCredential = Boolean(
    showEmbeddingCredentialSetup &&
    selectedEmbeddingOption &&
    !selectedEmbeddingOption.hasActiveCredential &&
    embeddingSecret &&
    !busy,
  );

  const handlePrepare = () => {
    if (!window.confirm(t('semantic.prepare'))) return;
    setFeedback({ tone: 'info', message: t('semantic.preparing') });
    prepareMutation.mutate();
  };

  const handleEnable = () => {
    if (!window.confirm(t('semantic.enable_confirm_detail'))) return;
    activationMutation.mutate();
  };

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
      <div className="modal-card hfm-command-surface semantic-command-surface">
        <h2 id={titleId}>{t('semantic.enable')}</h2>
        {statusQuery.isLoading ? <p>{t('common.loading')}</p> : null}
        {statusQuery.isError ? <p role="alert">{t('semantic.load_failed')}</p> : null}
        {status ? (
          <p role="status">
            {statusLabel(status.status, t)}
            {alreadyEnabled ? ` · ${t('semantic.already_enabled')}` : null}
          </p>
        ) : null}
        {showEmbeddingCredentialSetup ? (
          <section aria-labelledby={`${titleId}-embedding-credential`}>
            <h3 id={`${titleId}-embedding-credential`}>{t('semantic.credential_required')}</h3>
            <p>{t('semantic.credential_explanation')}</p>
            {embeddingOptions.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!canSaveEmbeddingCredential) return;
                  saveCredentialMutation.mutate();
                }}
              >
                <label htmlFor={`${titleId}-embedding-provider`}>
                  {t('semantic.embedding_provider')}
                </label>
                <select
                  id={`${titleId}-embedding-provider`}
                  aria-label={t('semantic.embedding_provider')}
                  value={selectedEmbeddingOptionIndex ?? ''}
                  onChange={(event) => setSelectedEmbeddingOptionIndex(Number(event.target.value))}
                  disabled={busy}
                >
                  {embeddingOptions.map((option, index) => (
                    <option key={`${option.providerId}:${option.embeddingModelId}`} value={index}>
                      {option.providerDisplayName} · {option.embeddingModelDisplayName}
                      {option.hasActiveCredential
                        ? ` (${t('semantic.embedding_option_configured')})`
                        : ''}
                    </option>
                  ))}
                </select>
                {selectedEmbeddingOption?.hasActiveCredential ? (
                  <p>{t('semantic.credential_existing')}</p>
                ) : (
                  <>
                    <label htmlFor={`${titleId}-embedding-secret`}>
                      {t('semantic.embedding_credential')}
                    </label>
                    <input
                      id={`${titleId}-embedding-secret`}
                      aria-label={t('semantic.embedding_credential')}
                      type="password"
                      autoComplete="new-password"
                      value={embeddingSecret}
                      onChange={(event) => setEmbeddingSecret(event.target.value)}
                      disabled={busy}
                    />
                    <button type="submit" disabled={!canSaveEmbeddingCredential}>
                      {t('semantic.save_credential')}
                    </button>
                  </>
                )}
              </form>
            ) : (
              <p>{t('semantic.no_embedding_options')}</p>
            )}
          </section>
        ) : null}
        {feedback ? (
          <p role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.message}</p>
        ) : null}
        {privacyBlocked ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/settings/privacy');
            }}
          >
            {t('semantic.open_privacy')}
          </button>
        ) : null}
        {status?.status === 'NEEDS_ATTENTION' ? <p>{t('semantic.refresh_blocked')}</p> : null}
        <div className="hfm-command-actions">
          {canPrepare ? (
            <button type="button" onClick={handlePrepare} disabled={busy}>
              {status?.status === 'READY' ? t('semantic.prepare') : t('semantic.prepare')}
            </button>
          ) : null}
          {canEnable ? (
            <button type="button" onClick={handleEnable} disabled={busy}>
              {t('semantic.enable_confirm')}
            </button>
          ) : null}
          <button type="button" onClick={onClose} disabled={busy}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
