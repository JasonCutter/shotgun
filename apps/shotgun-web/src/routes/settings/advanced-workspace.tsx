import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';

export const AdvancedWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: snapshot,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'snapshot', targetProjectId],
    queryFn: () => apiClient.getSettingsSnapshot(targetProjectId),
  });

  if (isLoading) return <div>Loading advanced settings...</div>;
  if (error) return <div className="error-banner">Failed to load advanced settings.</div>;

  return (
    <section className="advanced-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>
        Advanced Settings & Policy Overrides
      </h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Configure advanced system flags, policy override rules, and experimental runtime options.
      </p>

      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '16px',
          background: '#f8fafc',
        }}
      >
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>System Revision & Policy Context</h3>
        <p style={{ fontSize: '14px', color: '#475569' }}>
          Target Project: <strong>{snapshot?.targetProjectId}</strong>
        </p>
        <p style={{ fontSize: '14px', color: '#475569' }}>
          Settings Revision: <strong>{snapshot?.settingsRevision}</strong>
        </p>
        <p style={{ fontSize: '14px', color: '#475569' }}>
          Policy Context Revision: <strong>{snapshot?.policyContextRevision}</strong>
        </p>
      </div>
    </section>
  );
};
