import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type {
  AIProviderPrivacyProposal,
  AISettingsPrivacyStatus,
  AISettingsProvider,
} from '@shotgun/api-client';

import { useAppRuntime } from '../../app/providers.js';
import { privacyProfileLabel, sensitivityLabel } from '../../presentation/product-labels.js';
import { sessionQueryOptions } from '../../session/session-query.js';

const privacyLabel = (privacy: AISettingsPrivacyStatus | undefined): string => {
  if (!privacy) return 'Review required';
  if (privacy.approval?.approved || privacy.legacyGeminiCompatibility) return 'Approved';
  if (privacy.approval?.approved === false) return 'Not approved / Rejected';
  return 'Review required';
};

const providerLabel = (provider: AISettingsProvider): string => provider.displayName;

export const PrivacyWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const targetProjectId = session?.activeProject?.id ?? '';
  const initialProviderParam = searchParams.get('providerId') ?? '';

  const [selectedProviderId, setSelectedProviderId] = useState<string>(initialProviderParam);
  const [pendingProviderProposal, setPendingProviderProposal] =
    useState<AIProviderPrivacyProposal | null>(null);
  const [providerNotice, setProviderNotice] = useState<string>();

  const [projectReviewProposalId, setProjectReviewProposalId] = useState<string>();
  const [projectNotice, setProjectNotice] = useState<string>();
  const [projectSubmitting, setProjectSubmitting] = useState(false);

  const aiSettingsQuery = useQuery({
    queryKey: ['settings', 'ai', targetProjectId],
    queryFn: ({ signal }) => apiClient.getAISettings(targetProjectId, { signal }),
    enabled: Boolean(targetProjectId),
  });

  const privacyQuery = useQuery({
    queryKey: ['settings', 'privacy', targetProjectId],
    queryFn: () => apiClient.getPrivacyRetention(targetProjectId),
    enabled: Boolean(targetProjectId),
  });

  const snapshotQuery = useQuery({
    queryKey: ['settings', 'snapshot', targetProjectId],
    queryFn: () => apiClient.getSettingsSnapshot(targetProjectId),
    enabled: Boolean(targetProjectId),
  });

  const aiSettings = aiSettingsQuery.data;
  const privacy = privacyQuery.data;
  const snapshot = snapshotQuery.data;

  const initialProviderIsInvalid = Boolean(
    initialProviderParam &&
    aiSettings &&
    !aiSettings.providers.some((p) => p.providerId === initialProviderParam),
  );

  const effectiveProviderId = useMemo(() => {
    if (selectedProviderId) {
      if (aiSettings?.providers.some((p) => p.providerId === selectedProviderId)) {
        return selectedProviderId;
      }
      return '';
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

  const providerPrivacyMutation = useMutation({
    mutationFn: async (action: 'propose-approve' | 'propose-reject' | 'approve') => {
      if (!aiSettings || !selectedProvider || !selectedProviderPrivacy) {
        throw new Error('Select a registered provider before requesting privacy review.');
      }
      if (action === 'approve') {
        if (!pendingProviderProposal) {
          throw new Error('No provider privacy proposal is awaiting review.');
        }
        return {
          kind: 'approval' as const,
          approval: await apiClient.approveAIProviderPrivacyProposal({
            projectId: targetProjectId,
            providerId: selectedProvider.providerId,
            proposalId: pendingProviderProposal.proposalId,
            expectedApprovalRevision: pendingProviderProposal.expectedApprovalRevision,
          }),
        };
      }
      return {
        kind: 'proposal' as const,
        proposal: await apiClient.proposeAIProviderPrivacyApproval({
          projectId: targetProjectId,
          providerId: selectedProvider.providerId,
          approved: action === 'propose-approve',
          expectedApprovalRevision: selectedProviderPrivacy.approval?.approvalRevision ?? 0,
        }),
      };
    },
    onSuccess: async (result) => {
      if (result.kind === 'proposal') {
        const proposal = result.proposal;
        if (
          !selectedProvider ||
          proposal.projectId !== targetProjectId ||
          proposal.providerId !== selectedProvider.providerId
        ) {
          setPendingProviderProposal(null);
          setProviderNotice(
            'Provider privacy proposal could not be validated for the selected provider.',
          );
          return;
        }
        setPendingProviderProposal(proposal);
        setProviderNotice(
          'Provider privacy review proposed. Confirm the proposal to complete approval.',
        );
        return;
      }
      setPendingProviderProposal(null);
      setProviderNotice(
        result.approval.approved
          ? 'Provider privacy approved for this provider.'
          : 'Provider privacy not approved.',
      );
      await queryClient.invalidateQueries({ queryKey: ['settings', 'ai', targetProjectId] });
    },
    onError: (error) => {
      setProviderNotice(error instanceof Error ? error.message : 'Provider privacy review failed.');
    },
  });

  const submitProjectReviewCommand = async (proposalId?: string) => {
    if (!session?.activeProject?.id || !snapshot || !targetProjectId) return;
    setProjectSubmitting(true);
    setProjectNotice(undefined);
    try {
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await apiClient.applySettingsCommand({
        activeProjectId: session.activeProject.id,
        targetProjectId,
        resourceProjectId: targetProjectId,
        clientRequestId: `privacy-review-${nonce}`,
        idempotencyKey: `privacy-review-${nonce}`,
        expectedSettingsRevision: snapshot.settingsRevision,
        observedPolicyContextRevision: snapshot.policyContextRevision,
        settings: { 'privacy.externalTransferAllowed': true },
        ...(proposalId ? { reviewProposalId: proposalId } : {}),
      });
      if (response.resource.status === 'REVIEW_REQUIRED' && response.resource.reviewProposalId) {
        setProjectReviewProposalId(response.resource.reviewProposalId);
        setProjectNotice('Owner review is required. Confirm the proposal separately to apply it.');
      } else if (response.resource.status === 'APPLIED') {
        setProjectReviewProposalId(undefined);
        setProjectNotice('Project privacy approval was recorded. Deployment policy still applies.');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['settings', 'privacy', targetProjectId] }),
          queryClient.invalidateQueries({ queryKey: ['settings', 'snapshot', targetProjectId] }),
        ]);
      }
    } catch (reason) {
      setProjectNotice(reason instanceof Error ? reason.message : 'Privacy review command failed.');
    } finally {
      setProjectSubmitting(false);
    }
  };

  if (!targetProjectId) {
    return <div>Choose an active Project before configuring privacy.</div>;
  }

  if (privacyQuery.isLoading && aiSettingsQuery.isLoading) {
    return <div>Loading privacy settings...</div>;
  }

  const privacyData = privacy?.availability === 'AVAILABLE' ? privacy.data : undefined;
  const effectiveProjectReviewProposalId =
    projectReviewProposalId ?? privacyData?.pendingReviewProposalId;
  const providerApproved = Boolean(
    selectedProviderPrivacy?.approval?.approved ||
    selectedProviderPrivacy?.legacyGeminiCompatibility,
  );

  return (
    <section className="privacy-workspace">
      <header style={{ marginBottom: '20px' }}>
        <p className="eyebrow">Settings</p>
        <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Privacy</h2>
        <p style={{ color: 'var(--muted)' }}>
          Inspect and manage Provider Privacy approvals and Project external data transfer policies.
        </p>
      </header>

      <div style={{ display: 'grid', gap: '24px', maxWidth: '720px' }}>
        {/* SECTION 1: PROVIDER PRIVACY */}
        <section
          className="settings-card"
          aria-labelledby="provider-privacy-heading"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '20px',
          }}
        >
          <h3 id="provider-privacy-heading" style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
            Provider Privacy
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 16px 0' }}>
            AI provider privacy approval is provider-scoped. Approving one provider does not approve
            others.
          </p>

          {aiSettingsQuery.isLoading ? (
            <p role="status">Loading AI provider privacy settings...</p>
          ) : aiSettingsQuery.isError || !aiSettings ? (
            <div className="error-banner" role="alert">
              Failed to load AI provider privacy settings.
            </div>
          ) : null}

          {initialProviderIsInvalid ? (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              The specified AI provider &apos;{initialProviderParam}&apos; is not registered for
              this project.
            </p>
          ) : null}

          {aiSettings?.providers && aiSettings.providers.length > 0 ? (
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="privacy-provider-select"
                style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}
              >
                AI Provider
              </label>
              <select
                id="privacy-provider-select"
                value={effectiveProviderId}
                onChange={(event) => {
                  setSelectedProviderId(event.target.value);
                  setPendingProviderProposal(null);
                  setProviderNotice(undefined);
                }}
                disabled={providerPrivacyMutation.isPending}
                style={{ width: '100%', padding: '8px' }}
              >
                {aiSettings.providers.map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>
                    {providerLabel(provider)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selectedProvider ? (
            <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
              <p style={{ margin: 0 }}>
                <strong>Provider:</strong> {providerLabel(selectedProvider)}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Status:</strong> {privacyLabel(selectedProviderPrivacy)}
                {selectedProviderPrivacy?.legacyGeminiCompatibility
                  ? ' · An existing Gemini approval applies only to Google Gemini.'
                  : ''}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Deployment capability:</strong>{' '}
                {selectedProviderPrivacy?.deploymentAllowed ? 'Allowed' : 'Blocked'}
              </p>
            </div>
          ) : null}

          {selectedProvider && selectedProviderPrivacy ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {!pendingProviderProposal ? (
                <>
                  <button
                    type="button"
                    onClick={() => providerPrivacyMutation.mutate('propose-approve')}
                    disabled={providerPrivacyMutation.isPending}
                  >
                    Request {providerApproved ? 'updated' : ''} provider approval
                  </button>
                  {providerApproved && !selectedProviderPrivacy.legacyGeminiCompatibility ? (
                    <button
                      type="button"
                      onClick={() => providerPrivacyMutation.mutate('propose-reject')}
                      disabled={providerPrivacyMutation.isPending}
                    >
                      Request provider rejection
                    </button>
                  ) : null}
                </>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  <span role="status" style={{ color: 'var(--ink)' }}>
                    Review proposal pending for {selectedProvider.displayName}:{' '}
                    {pendingProviderProposal.approved ? 'approval' : 'rejection'}.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Approve privacy review for ${selectedProvider.displayName}?`,
                        )
                      ) {
                        providerPrivacyMutation.mutate('approve');
                      }
                    }}
                    disabled={providerPrivacyMutation.isPending}
                  >
                    Approve provider review
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {providerNotice ? (
            <p role="status" style={{ marginTop: '12px', color: 'var(--ink)' }}>
              {providerNotice}
            </p>
          ) : null}
        </section>

        {/* SECTION 2: PROJECT PRIVACY */}
        <section
          className="settings-card"
          aria-labelledby="project-privacy-heading"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '20px',
          }}
        >
          <h3 id="project-privacy-heading" style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
            Project Privacy & External Data Transfer
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 16px 0' }}>
            Configure Project sensitivity classification and overall external AI data transfer
            boundary.
          </p>

          {privacyQuery.isLoading ? (
            <p role="status">Loading Project privacy settings...</p>
          ) : privacyQuery.isError || !privacy ? (
            <div className="error-banner" role="alert">
              Failed to load Project privacy settings.
            </div>
          ) : null}

          {privacy?.availability === 'UNAVAILABLE' ? (
            <div
              style={{
                color: 'var(--ink)',
                padding: '16px',
                background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
                border: '1px solid var(--danger)',
                borderLeft: '4px solid var(--danger)',
                borderRadius: 'var(--radius)',
              }}
            >
              {privacy.disabledReason}
            </div>
          ) : null}

          {privacyData ? (
            <>
              <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                <p style={{ margin: 0 }}>
                  <strong>Privacy profile:</strong> {privacyProfileLabel(privacyData.profileName)}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Sensitivity:</strong> {sensitivityLabel(privacyData.sensitivityLevel)}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>External Transfer Allowed:</strong>{' '}
                  {privacyData.externalTransferAllowed ? 'Yes' : 'No'}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Project approval:</strong>{' '}
                  {privacyData.approvalStatus.replaceAll('_', ' ')}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Deployment capability:</strong>{' '}
                  {privacyData.deploymentAllowsPrivateExternalTransfer
                    ? 'Private external transfer may be enabled after Project approval.'
                    : 'This deployment currently blocks private external transfer.'}
                </p>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
                  Restricted Project context is never sent to an external AI provider.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Retention Summary:</strong> {privacyData.retentionSummary}
                </p>
              </div>

              {!privacyData.externalTransferAllowed && !effectiveProjectReviewProposalId ? (
                <button
                  type="button"
                  disabled={projectSubmitting || !snapshot}
                  onClick={() => void submitProjectReviewCommand()}
                >
                  Request external AI transfer review
                </button>
              ) : null}

              {effectiveProjectReviewProposalId ? (
                <button
                  type="button"
                  disabled={projectSubmitting}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Approve sending private Project context to external AI providers when deployment policy also permits it?',
                      )
                    ) {
                      void submitProjectReviewCommand(effectiveProjectReviewProposalId);
                    }
                  }}
                >
                  Approve reviewed privacy proposal
                </button>
              ) : null}
            </>
          ) : null}

          {projectNotice ? (
            <p role="status" style={{ marginTop: '12px', color: 'var(--ink)' }}>
              {projectNotice}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
};
