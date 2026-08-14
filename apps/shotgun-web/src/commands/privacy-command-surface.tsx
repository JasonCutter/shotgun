import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import { privacyProfileLabel, sensitivityLabel } from '../presentation/product-labels.js';
import type { PrivacyCommandId } from './owner-command-registry.js';

type CommandIdentity = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

type PrivacySubmission = CommandIdentity & {
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly resourceProjectId: string;
  readonly expectedSettingsRevision: number;
  readonly observedPolicyContextRevision: number;
  readonly reviewProposalId?: string;
};

type OutcomeRecovery = CommandIdentity;

export type PrivacyCommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: PrivacyCommandId | null;
  readonly shell: GlobalShellView;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

const privacyQueryKey = (projectId: string) => ['settings', 'privacy', projectId] as const;
const snapshotQueryKey = (projectId: string) => ['settings', 'snapshot', projectId] as const;

const identity = (): CommandIdentity => ({
  clientRequestId: crypto.randomUUID(),
  idempotencyKey: crypto.randomUUID(),
});

const isOutcomeIndeterminateError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly recovery?: unknown };
  return (
    candidate.code === 'OUTCOME_INDETERMINATE' ||
    candidate.code === 'OUTCOME_UNKNOWN' ||
    candidate.recovery === 'RESOLVE_EXISTING_OUTCOME'
  );
};

export const PrivacyCommandSurface = ({
  open,
  commandId,
  shell,
  invoker,
  onClose,
}: PrivacyCommandSurfaceProps) => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const projectId = shell.activeProject?.id ?? '';
  const [mode, setMode] = useState<PrivacyCommandId>('privacy.open');
  const [reviewProposalId, setReviewProposalId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [outcomeRecovery, setOutcomeRecovery] = useState<OutcomeRecovery>();
  const [isResolvingOutcome, setIsResolvingOutcome] = useState(false);

  const privacyQuery = useQuery({
    queryKey: privacyQueryKey(projectId),
    queryFn: () => apiClient.getPrivacyRetention(projectId),
    enabled: open && Boolean(projectId),
  });
  const reviewMode = mode === 'privacy.review';
  const snapshotQuery = useQuery({
    queryKey: snapshotQueryKey(projectId),
    queryFn: () => apiClient.getSettingsSnapshot(projectId),
    enabled: open && reviewMode && Boolean(projectId),
  });
  const privacyData =
    privacyQuery.data?.availability === 'AVAILABLE' ? privacyQuery.data.data : undefined;
  const effectiveReviewProposalId = reviewProposalId ?? privacyData?.pendingReviewProposalId;

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setMode(commandId);
    setReviewProposalId(undefined);
    setMessage(undefined);
    setErrorMessage(undefined);
    setOutcomeRecovery(undefined);
    setIsResolvingOutcome(false);
  }, [commandId, invoker, open]);

  const refreshPrivacy = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: privacyQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: snapshotQueryKey(projectId) }),
    ]);
    await privacyQuery.refetch();
    if (reviewMode) await snapshotQuery.refetch();
  };

  const mutation = useMutation({
    mutationFn: (input: PrivacySubmission) =>
      apiClient.applySettingsCommand({
        activeProjectId: input.activeProjectId,
        targetProjectId: input.targetProjectId,
        resourceProjectId: input.resourceProjectId,
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
        expectedSettingsRevision: input.expectedSettingsRevision,
        observedPolicyContextRevision: input.observedPolicyContextRevision,
        settings: { 'privacy.externalTransferAllowed': true },
        ...(input.reviewProposalId ? { reviewProposalId: input.reviewProposalId } : {}),
      }),
    onSuccess: async (response) => {
      if (response.resource.status === 'REVIEW_REQUIRED' && response.resource.reviewProposalId) {
        setReviewProposalId(response.resource.reviewProposalId);
        setMessage('Owner approval is still required for this privacy review.');
        setErrorMessage(undefined);
        return;
      }
      if (response.resource.status === 'APPLIED') {
        setReviewProposalId(undefined);
        setMessage('Project privacy approval was recorded. Deployment policy still applies.');
        setErrorMessage(undefined);
        await refreshPrivacy();
        return;
      }
      setMessage('The privacy review is not final yet. Check the result again.');
      setErrorMessage(undefined);
    },
    onError: (error, input) => {
      if (isOutcomeIndeterminateError(error)) {
        setOutcomeRecovery({
          clientRequestId: input.clientRequestId,
          idempotencyKey: input.idempotencyKey,
        });
        setMessage('The privacy review result needs checking. It will not be submitted again.');
        setErrorMessage(undefined);
        return;
      }
      setErrorMessage(safeErrorMessage(error));
    },
  });

  const resolveOutcome = async () => {
    if (!outcomeRecovery || isResolvingOutcome) return;
    setIsResolvingOutcome(true);
    setErrorMessage(undefined);
    try {
      const outcome = await apiClient.getFrontendCommandOutcomeByClientRequestId(
        outcomeRecovery.clientRequestId,
      );
      if (outcome.outcomeState === 'COMPLETED') {
        setOutcomeRecovery(undefined);
        setMessage('Privacy review completed.');
        await refreshPrivacy();
      } else if (outcome.outcomeState === 'REJECTED') {
        setOutcomeRecovery(undefined);
        setErrorMessage(outcome.rejection?.message ?? 'Privacy review was rejected.');
      } else {
        setMessage('The privacy review is not final yet. Check the result again.');
      }
    } catch {
      setErrorMessage('The privacy review result could not be checked. Try again.');
    } finally {
      setIsResolvingOutcome(false);
    }
  };

  const submitReview = (proposalId?: string) => {
    if (
      !projectId ||
      !privacyData ||
      !snapshotQuery.data ||
      mutation.isPending ||
      outcomeRecovery
    ) {
      return;
    }
    const snapshot = snapshotQuery.data;
    mutation.mutate({
      ...identity(),
      activeProjectId: projectId,
      targetProjectId: projectId,
      resourceProjectId: projectId,
      expectedSettingsRevision: snapshot.settingsRevision,
      observedPolicyContextRevision: snapshot.policyContextRevision,
      ...(proposalId ? { reviewProposalId: proposalId } : {}),
    });
  };

  if (!open || !commandId) return null;
  if (!projectId) return null;

  const pending = mutation.isPending || isResolvingOutcome || outcomeRecovery !== undefined;

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
      <div className="modal-card privacy-command-surface">
        <h2 id={titleId}>{reviewMode ? 'Review Privacy' : 'Project Privacy'}</h2>
        {message ? (
          <p className="privacy-command-message" role="status">
            {message}
          </p>
        ) : null}
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        {outcomeRecovery ? (
          <button
            type="button"
            onClick={() => void resolveOutcome()}
            disabled={mutation.isPending || isResolvingOutcome}
          >
            {isResolvingOutcome ? 'Checking...' : 'Check result'}
          </button>
        ) : null}
        {privacyQuery.isLoading ? <p>Loading privacy settings...</p> : null}
        {privacyQuery.isError ? <p role="alert">Failed to load privacy settings.</p> : null}
        {privacyQuery.data?.availability === 'UNAVAILABLE' ? (
          <p role="alert">{privacyQuery.data.disabledReason}</p>
        ) : null}
        {privacyData ? (
          <>
            <section className="privacy-command-section" aria-label="Privacy summary">
              <p>
                <strong>Privacy profile:</strong> {privacyProfileLabel(privacyData.profileName)}
              </p>
              <p>
                <strong>Sensitivity:</strong> {sensitivityLabel(privacyData.sensitivityLevel)}
              </p>
              <p>
                <strong>External transfer:</strong>{' '}
                {privacyData.externalTransferAllowed ? 'Allowed' : 'Not approved'}
              </p>
              <p>
                <strong>Project approval:</strong> {privacyData.approvalStatus.replaceAll('_', ' ')}
              </p>
              <p>
                <strong>Deployment:</strong>{' '}
                {privacyData.deploymentAllowsPrivateExternalTransfer
                  ? 'May permit private external transfer after approval.'
                  : 'Currently blocks private external transfer.'}
              </p>
              <p>Restricted Project context is never sent to an external AI provider.</p>
              <p>
                <strong>Retention:</strong> {privacyData.retentionSummary}
              </p>
            </section>
            {!reviewMode && !privacyData.externalTransferAllowed ? (
              <button type="button" onClick={() => setMode('privacy.review')} disabled={pending}>
                Open privacy review
              </button>
            ) : null}
            {reviewMode && snapshotQuery.isLoading ? (
              <p>Loading current review preconditions...</p>
            ) : null}
            {reviewMode && snapshotQuery.isError ? (
              <p role="alert">Current privacy review preconditions could not be loaded.</p>
            ) : null}
            {reviewMode && !privacyData.externalTransferAllowed && !effectiveReviewProposalId ? (
              <button
                type="button"
                disabled={pending || snapshotQuery.data === undefined}
                onClick={() => submitReview()}
              >
                Request external AI transfer review
              </button>
            ) : null}
            {reviewMode && effectiveReviewProposalId ? (
              <div className="privacy-command-section">
                <p>
                  Owner approval is required before private Project context may be sent to external
                  AI providers. Restricted context remains blocked.
                </p>
                <button
                  type="button"
                  disabled={pending || snapshotQuery.data === undefined}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Approve private Project context transfer when deployment policy permits it?',
                      )
                    ) {
                      submitReview(effectiveReviewProposalId);
                    }
                  }}
                >
                  Approve reviewed privacy proposal
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={mutation.isPending}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
