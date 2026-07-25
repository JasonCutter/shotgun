import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';

export const ConnectorsWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: connectors,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'connectors', targetProjectId],
    queryFn: () => apiClient.getConnectorSettings(targetProjectId),
  });

  if (isLoading) return <div>Loading connector integrations...</div>;
  if (error) return <div className="error-banner">Failed to load connectors settings.</div>;

  if (connectors?.availability === 'UNAVAILABLE') {
    return (
      <section className="connectors-workspace">
        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Connector Integrations</h2>
        <div
          style={{
            color: '#b91c1c',
            padding: '16px',
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
          }}
        >
          {connectors.disabledReason}
        </div>
      </section>
    );
  }

  return (
    <section className="connectors-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Connector Integrations</h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Manage external action connectors, webhook integrations, and credential masking.
      </p>

      {connectors?.data?.length === 0 ? (
        <p style={{ color: '#64748b' }}>No connectors configured for project {targetProjectId}.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}
        >
          {connectors?.data?.map((conn) => (
            <div
              key={conn.connectorId}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                background: '#fff',
              }}
            >
              <h3>{conn.name}</h3>
              <p>
                Status: <strong>{conn.status}</strong>
              </p>
              {conn.maskedCredentials && (
                <p style={{ fontSize: '13px', color: '#64748b' }}>
                  Credentials: {conn.maskedCredentials}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
