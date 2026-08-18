import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';

import type {
  AIProviderPrivacyProposal,
  AISettingsApproval,
  AISettingsPrivacyStatus,
  GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import {
  useProductLocalization,
  type ProductTranslator,
} from '../localization/product-localization.js';
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
const aiSettingsQueryKey = (projectId: string) => ['settings', 'ai', projectId] as const;

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

const privacyStateLabel = (
  privacy: AISettingsPrivacyStatus | undefined,
  t: ProductTranslator,
): string => {
  if (!privacy) return t('ai.privacy.review_required');
  if (privacy.approval?.approved || privacy.legacyGeminiCompatibility)
    return t('ai.privacy.approved');
  if (privacy.approval?.approved === false) return t('ai.privacy.not_approved');
  return t('ai.privacy.review_required');
};

const isPrivacyApproved = (privacy: AISettingsPrivacyStatus | undefined): boolean =>
  Boolean(privacy?.approval?.approved || privacy?.legacyGeminiCompatibility);

export const PrivacyCommandSurface = ({
  open,
  commandId,
  shell,
  invoker,
  onClose,
}: PrivacyCommandSurfaceProps) => {
  const { apiClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const projectId = shell.activeProject?.id ?? '';
  const [mode, setMode] = useState<PrivacyCommandId>('privacy.open');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [pendingProviderProposal, setPendingProviderProposal] =
    useState<AIProviderPrivacyProposal>();
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

  const aiSettingsQuery = useQuery({
    queryKey: aiSettingsQueryKey(projectId),
    queryFn: ({ signal }) => apiClient.getAISettings(projectId, { signal }),
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

  const aiSettings = aiSettingsQuery.data;
  const effectiveProviderId = useMemo(() => {
    if (
      selectedProviderId &&
      aiSettings?.providers.some((p) => p.providerId === selectedProviderId)
    ) {
      return selectedProviderId;
    }
    const configured = aiSettings?.currentConfiguration?.activeProviderId;
    if (configured && aiSettings?.providers.some((p) => p.providerId === configured)) {
      return configured;
    }
    return aiSettings?.defaultProviderId ?? aiSettings?.providers[0]?.providerId ?? '';
  }, [aiSettings, selectedProviderId]);

  const selectedProvider = useMemo(
    () => aiSettings?.providers.find((p) => p.providerId === effectiveProviderId),
    [aiSettings?.providers, effectiveProviderId],
  );

  const selectedProviderPrivacy = useMemo(
    () => aiSettings?.privacy.find((p) => p.providerId === effectiveProviderId),
    [aiSettings?.privacy, effectiveProviderId],
  );

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setMode(commandId);
    setSelectedProviderId('');
    setPendingProviderProposal(undefined);
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
      queryClient.invalidateQueries({ queryKey: aiSettingsQueryKey(projectId) }),
    ]);
    await privacyQuery.refetch();
    if (reviewMode) await snapshotQuery.refetch();
    await aiSettingsQuery.refetch();
  };

  const projectMutation = useMutation({
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
        setMessage(t('privacy.owner_approval_required'));
        setErrorMessage(undefined);
        return;
      }
      if (response.resource.status === 'APPLIED') {
        setReviewProposalId(undefined);
        setMessage(t('privacy.project_approval_recorded'));
        setErrorMessage(undefined);
        await refreshPrivacy();
        return;
      }
      setMessage(t('privacy.review_not_final'));
      setErrorMessage(undefined);
    },
    onError: (error, input) => {
      if (isOutcomeIndeterminateError(error)) {
        setOutcomeRecovery({
          clientRequestId: input.clientRequestId,
          idempotencyKey: input.idempotencyKey,
        });
        setMessage(t('privacy.review_needs_checking'));
        setErrorMessage(undefined);
        return;
      }
      setErrorMessage(safeErrorMessage(error));
    },
  });

  const providerPrivacyMutation = useMutation<
    AIProviderPrivacyProposal | AISettingsApproval,
    unknown,
    'propose' | 'approve'
  >({
    mutationFn: (action: 'propose' | 'approve') => {
      if (!aiSettings || !selectedProvider || !selectedProviderPrivacy) {
        throw new Error(t('ai.error.provider_required_for_privacy'));
      }
      if (action === 'approve') {
        if (!pendingProviderProposal) throw new Error(t('ai.error.no_privacy_proposal'));
        return apiClient.approveAIProviderPrivacyProposal({
          projectId,
          providerId: selectedProvider.providerId,
          proposalId: pendingProviderProposal.proposalId,
          expectedApprovalRevision: pendingProviderProposal.expectedApprovalRevision,
        });
      }
      return apiClient.proposeAIProviderPrivacyApproval({
        projectId,
        providerId: selectedProvider.providerId,
        approved: true,
        expectedApprovalRevision: selectedProviderPrivacy.approval?.approvalRevision ?? 0,
      });
    },
    onSuccess: async (result, action) => {
      if (action === 'propose') {
        const proposal = result as AIProviderPrivacyProposal;
        if (
          !selectedProvider ||
          proposal.projectId !== projectId ||
          proposal.providerId !== selectedProvider.providerId
        ) {
          setPendingProviderProposal(undefined);
          setErrorMessage(t('ai.error.provider_proposal_validation_failed'));
          return;
        }
        setPendingProviderProposal(proposal);
        setMessage(t('ai.privacy_proposed'));
        setErrorMessage(undefined);
        return;
      }
      setPendingProviderProposal(undefined);
      setMessage(t('ai.privacy_saved'));
      setErrorMessage(undefined);
      await refreshPrivacy();
    },
    onError: (error) => {
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
        setMessage(t('privacy.review_completed'));
        await refreshPrivacy();
      } else if (outcome.outcomeState === 'REJECTED') {
        setOutcomeRecovery(undefined);
        setErrorMessage(outcome.rejection?.message ?? t('privacy.review_rejected'));
      } else {
        setMessage(t('privacy.review_not_final'));
      }
    } catch {
      setErrorMessage(t('privacy.review_check_failed'));
    } finally {
      setIsResolvingOutcome(false);
    }
  };

  const submitProjectReview = (proposalId?: string) => {
    if (
      !projectId ||
      !privacyData ||
      !snapshotQuery.data ||
      projectMutation.isPending ||
      outcomeRecovery
    ) {
      return;
    }
    const snapshot = snapshotQuery.data;
    projectMutation.mutate({
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

  const pending =
    projectMutation.isPending ||
    providerPrivacyMutation.isPending ||
    isResolvingOutcome ||
    outcomeRecovery !== undefined;
  const providerApproved = isPrivacyApproved(selectedProviderPrivacy);
  const canApproveProviderPrivacy = pendingProviderProposal !== undefined;

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
      <div className="modal-card privacy-command-surface hfm-command-surface">
        <h2 id={titleId}>{reviewMode ? t('privacy.review_title') : t('privacy.project_title')}</h2>
        {message ? (
          <p className="privacy-command-message" role="status">
            {message}
          </p>
        ) : null}
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        {outcomeRecovery ? (
          <button
            className="hfm-action-secondary"
            type="button"
            onClick={() => void resolveOutcome()}
            disabled={projectMutation.isPending || isResolvingOutcome}
          >
            {isResolvingOutcome ? t('common.checking') : t('common.check_result')}
          </button>
        ) : null}

        {/* SECTION 1: PROVIDER PRIVACY */}
        {aiSettings && selectedProvider && selectedProviderPrivacy ? (
          <section
            className="privacy-command-section"
            aria-labelledby="command-provider-privacy-heading"
          >
            <h3
              id="command-provider-privacy-heading"
              style={{ margin: '0 0 8px 0', fontSize: '15px' }}
            >
              {t('ai.provider_privacy')}
            </h3>
            {aiSettings.providers.length > 1 ? (
              <div style={{ marginBottom: '8px' }}>
                <label
                  htmlFor="privacy-command-provider-select"
                  style={{ display: 'block', fontWeight: 600, marginBottom: '4px' }}
                >
                  {t('ai.provider')}
                </label>
                <select
                  id="privacy-command-provider-select"
                  value={effectiveProviderId}
                  onChange={(e) => {
                    setSelectedProviderId(e.target.value);
                    setPendingProviderProposal(undefined);
                  }}
                  disabled={pending}
                >
                  {aiSettings.providers.map((provider) => (
                    <option key={provider.providerId} value={provider.providerId}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p>
              <strong>{selectedProvider.displayName}:</strong>{' '}
              {privacyStateLabel(selectedProviderPrivacy, t)}
            </p>
            {selectedProviderPrivacy.legacyGeminiCompatibility ? (
              <p>{t('privacy.gemini_compatibility_note')}</p>
            ) : null}
            {reviewMode && !providerApproved && !canApproveProviderPrivacy ? (
              <button
                className="hfm-action-secondary"
                type="button"
                onClick={() => providerPrivacyMutation.mutate('propose')}
                disabled={pending}
              >
                {t('ai.request_provider_privacy')}
              </button>
            ) : null}
            {reviewMode && canApproveProviderPrivacy ? (
              <button
                className="hfm-action-primary"
                type="button"
                onClick={() => {
                  if (window.confirm(t('ai.approve_privacy_decision'))) {
                    providerPrivacyMutation.mutate('approve');
                  }
                }}
                disabled={pending}
              >
                {t('ai.approve_provider_privacy')}
              </button>
            ) : null}
          </section>
        ) : null}

        {/* SECTION 2: PROJECT PRIVACY */}
        {privacyQuery.isLoading ? <p>{t('privacy.loading')}</p> : null}
        {privacyQuery.isError ? <p role="alert">{t('privacy.load_failed')}</p> : null}
        {privacyQuery.data?.availability === 'UNAVAILABLE' ? (
          <p role="alert">{privacyQuery.data.disabledReason}</p>
        ) : null}
        {privacyData ? (
          <>
            <section className="privacy-command-section" aria-label={t('privacy.summary')}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>
                {t('privacy.project_title')}
              </h3>
              <p>
                <strong>{t('privacy.profile_label')}</strong>{' '}
                {t(`privacy.profile.${privacyData.profileName.toLowerCase()}` as never)}
              </p>
              <p>
                <strong>{t('privacy.sensitivity_label')}</strong>{' '}
                {t(`privacy.sensitivity.${privacyData.sensitivityLevel.toLowerCase()}` as never)}
              </p>
              <p>
                <strong>{t('privacy.external_transfer_label')}</strong>{' '}
                {privacyData.externalTransferAllowed
                  ? t('privacy.external_allowed')
                  : t('privacy.not_approved')}
              </p>
              <p>
                <strong>{t('privacy.project_approval_label')}</strong>{' '}
                {privacyData.approvalStatus === 'REVIEW_PENDING'
                  ? t('privacy.approval.review_pending')
                  : privacyData.approvalStatus === 'APPROVED'
                    ? t('privacy.approval.approved')
                    : t('privacy.not_approved')}
              </p>
              <p>
                <strong>{t('privacy.deployment_label')}</strong>{' '}
                {privacyData.deploymentAllowsPrivateExternalTransfer
                  ? t('privacy.transfer_may_permit')
                  : t('privacy.transfer_blocked')}
              </p>
              <p>{t('privacy.restricted_context')}</p>
            </section>
            {reviewMode && snapshotQuery.isLoading ? (
              <p>{t('privacy.loading_preconditions')}</p>
            ) : null}
            {reviewMode && snapshotQuery.isError ? (
              <p role="alert">{t('privacy.preconditions_load_failed')}</p>
            ) : null}
            {reviewMode && !privacyData.externalTransferAllowed && !effectiveReviewProposalId ? (
              <button
                className="hfm-action-primary"
                type="button"
                disabled={pending || snapshotQuery.data === undefined}
                onClick={() => submitProjectReview()}
              >
                {t('privacy.request_review')}
              </button>
            ) : null}
            {reviewMode && effectiveReviewProposalId ? (
              <div className="privacy-command-section">
                <p>{t('privacy.owner_approval_explanation')}</p>
                <button
                  className="hfm-action-primary"
                  type="button"
                  disabled={pending || snapshotQuery.data === undefined}
                  onClick={() => {
                    if (window.confirm(t('privacy.approve_transfer'))) {
                      submitProjectReview(effectiveReviewProposalId);
                    }
                  }}
                >
                  {t('privacy.approve_review')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="dialog-actions">
          <button
            className="hfm-action-secondary"
            type="button"
            onClick={onClose}
            disabled={projectMutation.isPending || providerPrivacyMutation.isPending}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
