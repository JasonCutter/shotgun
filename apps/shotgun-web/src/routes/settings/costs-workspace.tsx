import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';

export const CostsWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: costs,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'costs', targetProjectId],
    queryFn: () => apiClient.getCostBudget(targetProjectId),
  });

  if (isLoading) return <div>Loading cost and budget metrics...</div>;
  if (error || !costs)
    return <div className="error-banner">Failed to load cost budget metrics.</div>;

  return (
    <section className="costs-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Costs & Budget Management</h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Monitor API token usage, estimated costs, soft limits, and hard budget caps.
      </p>

      <div
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            padding: '16px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Tokens Used</p>
          <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 700 }}>
            {costs.currentUsageTokens.toLocaleString()}
          </p>
        </div>
        <div
          style={{
            padding: '16px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Confirmed Cost</p>
          <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 700 }}>
            ${costs.confirmedCostUsd.toFixed(2)}
          </p>
        </div>
        <div
          style={{
            padding: '16px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Soft Limit</p>
          <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 700, color: '#d97706' }}>
            ${costs.softLimitUsd.toFixed(2)}
          </p>
        </div>
        <div
          style={{
            padding: '16px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Hard Limit</p>
          <p style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 700, color: '#dc2626' }}>
            ${costs.hardLimitUsd.toFixed(2)}
          </p>
        </div>
      </div>
    </section>
  );
};
