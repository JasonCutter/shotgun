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
          <strong>Profile Name:</strong> {privacy.profileName}
        </p>
        <p>
          <strong>Sensitivity Level:</strong> {privacy.sensitivityLevel}
        </p>
        <p>
          <strong>External Transfer Allowed:</strong>{' '}
          {privacy.externalTransferAllowed ? 'Yes' : 'No'}
        </p>
        <p>
          <strong>Retention Summary:</strong> {privacy.retentionSummary}
        </p>
      </div>
    </section>
  );
};
