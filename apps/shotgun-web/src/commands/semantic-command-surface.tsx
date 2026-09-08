import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import type { GlobalShellView, SemanticComparisonStatusView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
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
const snapshotQueryKey = (projectId: string) => ['settings', 'snapshot', projectId] as const;

const commandIdentity = (prefix: string): string =>
  typeof crypto.randomUUID === 'function'
    ? `${prefix}:${crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

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
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const projectId = shell.activeProject?.id ?? '';
  const [feedback, setFeedback] = useState<Feedback>();

  const statusQuery = useQuery({
    queryKey: statusQueryKey(projectId),
    queryFn: ({ signal }) => apiClient.getSemanticComparisonStatus(projectId, { signal }),
    enabled: open && Boolean(projectId),
  });

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setFeedback(undefined);
  }, [commandId, invoker, open]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: statusQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: snapshotQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'ai', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['protected'] }),
      queryClient.invalidateQueries({ queryKey: ['project'] }),
    ]);
    await statusQuery.refetch();
  };

  const prepareMutation = useMutation({
    mutationFn: () => apiClient.prepareSemanticComparison(projectId),
    onSuccess: async (status) => {
      await refresh();
      if (status.status === 'READY') {
        setFeedback({ tone: 'info', message: t('semantic.status_ready') });
      } else {
        setFeedback({ tone: 'error', message: t('semantic.refresh_blocked') });
      }
    },
    onError: (error) => {
      setFeedback({ tone: 'error', message: safeErrorMessage(error) || t('semantic.failed') });
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

  if (!open || !commandId || !projectId) return null;

  const status = statusQuery.data;
  const busy = prepareMutation.isPending || activationMutation.isPending;
  const alreadyEnabled = status?.status === 'READY' && status.rollout === 'V2_ACTIVE';
  const canPrepare = !busy && !alreadyEnabled && status?.status !== 'PREPARING';
  const canEnable = !busy && status?.status === 'READY' && status.rollout !== 'V2_ACTIVE';

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
        {feedback ? (
          <p role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.message}</p>
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
