import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';

export const SchemaWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: schemaPacks,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'schema', targetProjectId],
    queryFn: () => apiClient.getSchemaPacks(targetProjectId),
  });

  if (isLoading) return <div>Loading schema packs...</div>;
  if (error) return <div className="error-banner">Failed to load schema packs.</div>;

  if (schemaPacks?.availability === 'UNAVAILABLE') {
    return (
      <section className="schema-workspace">
        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>
          Schema Packs & Migration Requirements
        </h2>
        <div
          style={{
            color: '#b91c1c',
            padding: '16px',
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
          }}
        >
          {schemaPacks.disabledReason}
        </div>
      </section>
    );
  }

  return (
    <section className="schema-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>
        Schema Packs & Migration Requirements
      </h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Manage installed knowledge schema packs, version upgrades, and migration requirements.
      </p>

      {schemaPacks?.data?.map((sp) => (
        <div
          key={sp.packId}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
            background: '#fff',
            marginBottom: '12px',
          }}
        >
          <h3>
            {sp.name} (v{sp.version})
          </h3>
          <p>
            Compatibility: <strong>{sp.compatibilityStatus}</strong>
          </p>
        </div>
      ))}
    </section>
  );
};
