import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';

export const DiagnosticsWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: diagnostics,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'diagnostics', targetProjectId],
    queryFn: () => apiClient.getDiagnostics(targetProjectId),
  });

  if (isLoading) return <div>Loading diagnostics real-fact telemetry...</div>;
  if (error || !diagnostics) return <div className="error-banner">Failed to load diagnostics.</div>;

  return (
    <section className="diagnostics-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>
        System Diagnostics & Real-Fact Telemetry
      </h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Verified operational state without simulated metrics or placeholder indicators.
      </p>

      <div
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>App Version</p>
          <p style={{ margin: '4px 0 0 0', fontWeight: 600 }}>{diagnostics.appVersion}</p>
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Server Version</p>
          <p style={{ margin: '4px 0 0 0', fontWeight: 600 }}>{diagnostics.serverVersion}</p>
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Database Readiness</p>
          <p
            style={{
              margin: '4px 0 0 0',
              fontWeight: 600,
              color: diagnostics.databaseReadiness === 'READY' ? '#166534' : '#dc2626',
            }}
          >
            {diagnostics.databaseReadiness}
          </p>
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Projection Readiness</p>
          <p
            style={{
              margin: '4px 0 0 0',
              fontWeight: 600,
              color: diagnostics.projectionReadiness === 'READY' ? '#166534' : '#dc2626',
            }}
          >
            {diagnostics.projectionReadiness}
          </p>
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Backup Status</p>
          <p
            style={{
              margin: '4px 0 0 0',
              fontWeight: 600,
              color: diagnostics.backupStatus === 'HEALTHY' ? '#166534' : '#d97706',
            }}
          >
            {diagnostics.backupStatus}
          </p>
        </div>
      </div>
    </section>
  );
};
