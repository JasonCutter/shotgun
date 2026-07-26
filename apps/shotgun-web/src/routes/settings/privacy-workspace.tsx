import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';

export const PrivacyWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

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
          <strong>Profile Name:</strong> {privacyData.profileName}
        </p>
        <p>
          <strong>Sensitivity Level:</strong> {privacyData.sensitivityLevel}
        </p>
        <p>
          <strong>External Transfer Allowed:</strong>{' '}
          {privacyData.externalTransferAllowed ? 'Yes' : 'No'}
        </p>
        <p>
          <strong>Retention Summary:</strong> {privacyData.retentionSummary}
        </p>
      </div>
    </section>
  );
};
