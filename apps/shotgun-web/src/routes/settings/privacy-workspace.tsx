import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';
import { privacyProfileLabel, sensitivityLabel } from '../../presentation/product-labels.js';
import { sessionQueryOptions } from '../../session/session-query.js';

export const PrivacyWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const { data: snapshot } = useQuery({
    queryKey: ['settings', 'snapshot', targetProjectId],
    queryFn: () => apiClient.getSettingsSnapshot(targetProjectId),
  });
  const [reviewProposalId, setReviewProposalId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const {
    data: privacy,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'privacy', targetProjectId],
    queryFn: () => apiClient.getPrivacyRetention(targetProjectId),
  });

  if (isLoading) return <div>Loading privacy & sensitivity settings...</div>;
  if (error || !privacy)
    return <div className="error-banner">Failed to load privacy settings.</div>;

  if (privacy.availability === 'UNAVAILABLE') {
    return (
      <section className="privacy-workspace">
        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Privacy & Sensitivity Controls</h2>
        <div
          style={{
            color: '#b91c1c',
            padding: '16px',
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
          }}
        >
          {privacy.disabledReason}
        </div>
      </section>
    );
  }

  const privacyData = privacy.data;
  const effectiveReviewProposalId = reviewProposalId ?? privacyData.pendingReviewProposalId;

  const submitReviewCommand = async (proposalId?: string) => {
    if (!session?.activeProject?.id || !snapshot) return;
    setSubmitting(true);
    setNotice(undefined);
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
        setReviewProposalId(response.resource.reviewProposalId);
        setNotice('Owner review is required. Confirm the proposal separately to apply it.');
      } else if (response.resource.status === 'APPLIED') {
        setReviewProposalId(undefined);
        setNotice('Project privacy approval was recorded. Deployment policy still applies.');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['settings', 'privacy', targetProjectId] }),
          queryClient.invalidateQueries({ queryKey: ['settings', 'snapshot', targetProjectId] }),
        ]);
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Privacy review command failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="privacy-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Privacy & Sensitivity Controls</h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Configure asset sensitivity classification, external transfer boundaries, and data
        retention.
      </p>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '600px',
        }}
      >
        <p>
          <strong>Privacy profile:</strong> {privacyProfileLabel(privacyData.profileName)}
        </p>
        <p>
          <strong>Sensitivity:</strong> {sensitivityLabel(privacyData.sensitivityLevel)}
        </p>
        <p>
          <strong>External Transfer Allowed:</strong>{' '}
          {privacyData.externalTransferAllowed ? 'Yes' : 'No'}
        </p>
        <p>
          <strong>Project approval:</strong> {privacyData.approvalStatus.replaceAll('_', ' ')}
        </p>
        <p>
          <strong>Deployment capability:</strong>{' '}
          {privacyData.deploymentAllowsPrivateExternalTransfer
            ? 'Private external transfer may be enabled after Project approval.'
            : 'This deployment currently blocks private external transfer.'}
        </p>
        <p>Restricted Project context is never sent to an external AI provider.</p>
        <p>
          <strong>Retention Summary:</strong> {privacyData.retentionSummary}
        </p>
        {!privacyData.externalTransferAllowed && !effectiveReviewProposalId ? (
          <button
            type="button"
            disabled={submitting || !snapshot}
            onClick={() => void submitReviewCommand()}
          >
            Request external AI transfer review
          </button>
        ) : null}
        {effectiveReviewProposalId ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              if (
                window.confirm(
                  'Approve sending private Project context to external AI providers when deployment policy also permits it?',
                )
              ) {
                void submitReviewCommand(effectiveReviewProposalId);
              }
            }}
          >
            Approve reviewed privacy proposal
          </button>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </section>
  );
};
