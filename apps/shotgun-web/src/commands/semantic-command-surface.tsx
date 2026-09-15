import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  ShotgunApiError,
  type GlobalShellView,
  type SemanticEmbeddingSetupSelection,
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
import {
  clearPendingSemanticEmbeddingCredentialReplacement,
  readPendingSemanticEmbeddingCredentialReplacement,
  SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError,
  writePendingSemanticEmbeddingCredentialReplacement,
  type PendingSemanticEmbeddingCredentialReplacementV1,
} from './semantic-embedding-credential-storage.js';

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
const embeddingOptionKey = (selection: SemanticEmbeddingSetupSelection): string =>
  `${selection.providerId}:${selection.embeddingModelId}`;

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
  const [selectedEmbeddingIdentity, setSelectedEmbeddingIdentity] =
    useState<SemanticEmbeddingSetupSelection>();
  const [pendingCredentialReplacement, setPendingCredentialReplacement] = useState<
    PendingSemanticEmbeddingCredentialReplacementV1 | undefined
  >();

  const statusQuery = useQuery({
    queryKey: statusQueryKey(projectId),
    queryFn: ({ signal }) => apiClient.getSemanticComparisonStatus(projectId, { signal }),
    enabled: open && Boolean(projectId),
  });
  const embeddingOptions = statusQuery.data?.embeddingOptions ?? [];
  const selectedEmbeddingOption =
    selectedEmbeddingIdentity === undefined
      ? undefined
      : embeddingOptions.find(
          (option) =>
            option.providerId === selectedEmbeddingIdentity.providerId &&
            option.embeddingModelId === selectedEmbeddingIdentity.embeddingModelId,
        );
  const currentProfileEmbeddingOption = statusQuery.data?.profile
    ? embeddingOptions.find(
        (option) =>
          option.providerId === statusQuery.data?.profile?.providerId &&
          option.embeddingModelId === statusQuery.data?.profile?.embeddingModelId,
      )
    : undefined;

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setFeedback(undefined);
    setPrivacyBlocked(false);
    setPendingCredentialReplacement(readPendingSemanticEmbeddingCredentialReplacement(projectId));
  }, [commandId, invoker, open, projectId]);

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
      const option = selectedEmbeddingOption;
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

  const replacementMutation = useMutation({
    mutationFn: async (input: {
      readonly identity: PendingSemanticEmbeddingCredentialReplacementV1;
      readonly secret: string;
    }) => {
      writePendingSemanticEmbeddingCredentialReplacement(input.identity);
      try {
        return await apiClient.replaceSemanticEmbeddingCredential({
          projectId: input.identity.projectId,
          providerId: input.identity.providerId,
          embeddingModelId: input.identity.embeddingModelId,
          secret: input.secret,
          clientRequestId: input.identity.clientRequestId,
        });
      } catch (error) {
        if (error instanceof ShotgunApiError && error.status >= 400 && error.status < 500) {
          clearPendingSemanticEmbeddingCredentialReplacement(input.identity);
          throw error;
        }
        try {
          const outcome = await apiClient.getAICredentialWriteOutcome({
            projectId: input.identity.projectId,
            providerId: input.identity.providerId,
            operation: 'REPLACE',
            clientRequestId: input.identity.clientRequestId,
            credentialId: input.identity.credentialId,
            expectedRevision: input.identity.expectedRevision,
          });
          clearPendingSemanticEmbeddingCredentialReplacement(input.identity);
          return outcome;
        } catch (recoveryError) {
          if (
            recoveryError instanceof ShotgunApiError &&
            recoveryError.status >= 400 &&
            recoveryError.status < 500
          ) {
            if (recoveryError.status !== 404) {
              clearPendingSemanticEmbeddingCredentialReplacement(input.identity);
              throw recoveryError;
            }
          }
          throw new SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError();
        }
      }
    },
    onSuccess: async (_, input) => {
      clearPendingSemanticEmbeddingCredentialReplacement(input.identity);
      setEmbeddingSecret('');
      setPendingCredentialReplacement(undefined);
      await refresh();
      setFeedback({ tone: 'success', message: t('semantic.credential_replaced') });
    },
    onError: (error, input) => {
      if (error instanceof SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError) {
        setEmbeddingSecret('');
        setPendingCredentialReplacement(input.identity);
        setFeedback({
          tone: 'error',
          message: t('semantic.credential_replacement_outcome_indeterminate'),
        });
        return;
      }
      setPendingCredentialReplacement(undefined);
      setFeedback({
        tone: 'error',
        message: semanticErrorMessage(error, t) || t('semantic.credential_replacement_failed'),
      });
    },
  });

  const resolveReplacementMutation = useMutation({
    mutationFn: async (identity: PendingSemanticEmbeddingCredentialReplacementV1) => {
      try {
        return await apiClient.getAICredentialWriteOutcome({
          projectId: identity.projectId,
          providerId: identity.providerId,
          operation: 'REPLACE',
          clientRequestId: identity.clientRequestId,
          credentialId: identity.credentialId,
          expectedRevision: identity.expectedRevision,
        });
      } catch (error) {
        if (error instanceof ShotgunApiError && error.status === 404) {
          throw new SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError();
        }
        throw error;
      }
    },
    onSuccess: async () => {
      clearPendingSemanticEmbeddingCredentialReplacement();
      setPendingCredentialReplacement(undefined);
      await refresh();
      setFeedback({ tone: 'success', message: t('semantic.credential_replaced') });
    },
    onError: (error, identity) => {
      if (!(error instanceof SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError)) {
        clearPendingSemanticEmbeddingCredentialReplacement(identity);
        setPendingCredentialReplacement(undefined);
      }
      setFeedback({
        tone: 'error',
        message:
          error instanceof SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError
            ? t('semantic.credential_replacement_outcome_indeterminate')
            : semanticErrorMessage(error, t) || t('semantic.credential_replacement_failed'),
      });
    },
  });

  useEffect(() => {
    const preserved = selectedEmbeddingIdentity
      ? embeddingOptions.find(
          (option) =>
            option.providerId === selectedEmbeddingIdentity.providerId &&
            option.embeddingModelId === selectedEmbeddingIdentity.embeddingModelId,
        )
      : undefined;
    const next =
      preserved ??
      embeddingOptions.find((option) => option.hasActiveCredential) ??
      embeddingOptions[0];
    const nextSelection = next
      ? { providerId: next.providerId, embeddingModelId: next.embeddingModelId }
      : undefined;
    if (
      nextSelection?.providerId !== selectedEmbeddingIdentity?.providerId ||
      nextSelection?.embeddingModelId !== selectedEmbeddingIdentity?.embeddingModelId
    ) {
      setSelectedEmbeddingIdentity(nextSelection);
    }
  }, [embeddingOptions, selectedEmbeddingIdentity]);

  if (!open || !commandId || !projectId) return null;

  const status = statusQuery.data;
  const busy =
    prepareMutation.isPending ||
    activationMutation.isPending ||
    saveCredentialMutation.isPending ||
    replacementMutation.isPending ||
    resolveReplacementMutation.isPending;
  const alreadyEnabled = status?.status === 'READY' && status.rollout === 'V2_ACTIVE';
  const canPrepare =
    !busy &&
    status !== undefined &&
    status.status !== 'PREPARING' &&
    (status.status !== 'READY' || status.rollout !== 'V2_ACTIVE');
  const canEnable = !busy && status?.status === 'READY' && status.rollout !== 'V2_ACTIVE';
  const showEmbeddingCredentialSetup = status?.status === 'NOT_CONFIGURED';
  const showEmbeddingCredentialReplacement = Boolean(
    !showEmbeddingCredentialSetup &&
    currentProfileEmbeddingOption?.hasActiveCredential &&
    currentProfileEmbeddingOption.activeCredentialId &&
    currentProfileEmbeddingOption.activeCredentialRevision !== undefined &&
    status?.profile?.credentialId === currentProfileEmbeddingOption.activeCredentialId &&
    status.profile.credentialRevision === currentProfileEmbeddingOption.activeCredentialRevision,
  );
  const canSaveEmbeddingCredential = Boolean(
    showEmbeddingCredentialSetup &&
    selectedEmbeddingOption &&
    !selectedEmbeddingOption.hasActiveCredential &&
    embeddingSecret &&
    !busy,
  );
  const canReplaceEmbeddingCredential = Boolean(
    showEmbeddingCredentialReplacement &&
    status?.profile &&
    currentProfileEmbeddingOption?.activeCredentialId &&
    currentProfileEmbeddingOption.activeCredentialRevision !== undefined &&
    !pendingCredentialReplacement &&
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

  const handleReplaceEmbeddingCredential = () => {
    const profile = status?.profile;
    const option = currentProfileEmbeddingOption;
    if (
      !profile ||
      !option?.activeCredentialId ||
      option.activeCredentialRevision === undefined ||
      !embeddingSecret
    ) {
      return;
    }
    const identity: PendingSemanticEmbeddingCredentialReplacementV1 = {
      schemaVersion: 1,
      projectId,
      providerId: profile.providerId,
      embeddingModelId: profile.embeddingModelId,
      clientRequestId: commandIdentity('semantic-embedding-credential-replace'),
      operation: 'REPLACE',
      credentialId: option.activeCredentialId,
      expectedRevision: option.activeCredentialRevision,
    };
    replacementMutation.mutate({ identity, secret: embeddingSecret });
  };

  const handleResolveEmbeddingCredentialReplacement = () => {
    if (!pendingCredentialReplacement) return;
    resolveReplacementMutation.mutate(pendingCredentialReplacement);
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
                  value={selectedEmbeddingOption ? embeddingOptionKey(selectedEmbeddingOption) : ''}
                  onChange={(event) => {
                    const option = embeddingOptions.find(
                      (candidate) => embeddingOptionKey(candidate) === event.target.value,
                    );
                    setSelectedEmbeddingIdentity(
                      option
                        ? {
                            providerId: option.providerId,
                            embeddingModelId: option.embeddingModelId,
                          }
                        : undefined,
                    );
                  }}
                  disabled={busy}
                >
                  {embeddingOptions.map((option) => (
                    <option key={embeddingOptionKey(option)} value={embeddingOptionKey(option)}>
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
        {showEmbeddingCredentialReplacement ? (
          <section aria-labelledby={`${titleId}-embedding-credential-replace`}>
            <h3 id={`${titleId}-embedding-credential-replace`}>
              {t('semantic.credential_replace_required')}
            </h3>
            <p>{t('semantic.credential_replace_explanation')}</p>
            <p>
              <strong>{t('semantic.embedding_provider')}:</strong>{' '}
              {currentProfileEmbeddingOption?.providerDisplayName} ·{' '}
              {currentProfileEmbeddingOption?.embeddingModelDisplayName}
            </p>
            <label htmlFor={`${titleId}-embedding-replacement-secret`}>
              {t('semantic.embedding_credential')}
            </label>
            <input
              id={`${titleId}-embedding-replacement-secret`}
              aria-label={t('semantic.embedding_credential')}
              type="password"
              autoComplete="new-password"
              value={embeddingSecret}
              onChange={(event) => setEmbeddingSecret(event.target.value)}
              disabled={busy || Boolean(pendingCredentialReplacement)}
            />
            <button
              type="button"
              onClick={handleReplaceEmbeddingCredential}
              disabled={!canReplaceEmbeddingCredential}
            >
              {t('semantic.replace_credential')}
            </button>
            {pendingCredentialReplacement ? (
              <button
                type="button"
                onClick={handleResolveEmbeddingCredentialReplacement}
                disabled={busy}
              >
                {t('semantic.resolve_credential_replacement')}
              </button>
            ) : null}
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
