import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';
import { modelCapabilityLabel, modelCostLabel } from '../../presentation/product-labels.js';

export const ModelsWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: models,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'models', targetProjectId],
    queryFn: () => apiClient.getModelDescriptors(targetProjectId),
  });

  if (isLoading) return <div>Loading model profiles...</div>;
  if (error) return <div className="error-banner">Failed to load model profiles.</div>;

  if (models?.availability === 'UNAVAILABLE') {
    return (
      <section className="models-workspace">
        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>AI Model Profiles & Routing</h2>
        <div
          style={{
            color: '#b91c1c',
            padding: '16px',
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
          }}
        >
          {models.disabledReason}
        </div>
      </section>
    );
  }

  return (
    <section className="models-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>AI Model Profiles & Routing</h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Select default AI models for processing, reasoning, and citation synthesis.
      </p>

      <div
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        }}
      >
        {models?.data?.map((m) => (
          <div
            key={m.modelId}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '16px',
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>{m.displayName}</h3>
              {m.isDefault && (
                <span
                  style={{
                    padding: '2px 6px',
                    background: '#dcfce7',
                    color: '#166534',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  Default
                </span>
              )}
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '8px 0' }}>
              Provider: {m.provider === 'google' ? 'Google' : m.provider} ·{' '}
              {modelCostLabel(m.costClass)}
            </p>
            <p style={{ fontSize: '13px' }}>Privacy: {m.privacyCharacteristics}</p>
            <div style={{ marginTop: '12px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                Capabilities:
              </span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                {m.capabilities.map((cap) => (
                  <span
                    key={cap}
                    style={{
                      padding: '2px 6px',
                      background: '#f1f5f9',
                      borderRadius: '4px',
                      fontSize: '11px',
                    }}
                  >
                    {modelCapabilityLabel(cap)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
