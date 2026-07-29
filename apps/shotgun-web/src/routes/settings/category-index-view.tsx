import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';
import { settings5DQueryKey } from '../../app/query-keys.js';
import { sessionQueryOptions } from '../../session/session-query.js';

export const CategoryIndexView = () => {
  const { apiClient } = useAppRuntime();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const [searchParams] = useSearchParams();

  const activeProjectId = session?.activeProject?.id ?? '';
  const targetProjectId = searchParams.get('targetProjectId') ?? activeProjectId;
  const principalId = session?.principal.id ?? 'principal-a';

  const {
    data: snapshot,
    isLoading,
    error,
  } = useQuery({
    queryKey: settings5DQueryKey(principalId, targetProjectId, targetProjectId, 'all'),
    queryFn: () => apiClient.getSettingsSnapshot(targetProjectId),
  });

  if (isLoading) return <div>Loading settings categories...</div>;
  if (error || !snapshot)
    return <div className="error-banner">Failed to load settings snapshot.</div>;

  return (
    <section className="category-index-view">
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Settings Categories Index</h2>
      <p style={{ color: '#64748b', marginBottom: '24px' }}>
        Select a category below to view and edit settings policy descriptors for project{' '}
        <strong>{targetProjectId}</strong>.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px',
        }}
      >
        {snapshot.categories.map((cat) => (
          <div
            key={cat.categoryId}
            className="category-card"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '16px',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <h3 style={{ margin: 0, fontSize: '16px' }}>{cat.label}</h3>
                <span
                  className="scope-badge"
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    background: '#f1f5f9',
                    borderRadius: '4px',
                  }}
                >
                  {cat.scope}
                </span>
              </div>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '8px 0 12px 0' }}>
                {cat.description}
              </p>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  fontSize: '12px',
                  color: '#475569',
                  marginBottom: '12px',
                }}
              >
                <span>Total: {cat.totalSettingsCount}</span>
                {cat.actionRequiredCount > 0 && (
                  <span style={{ color: '#dc2626' }}>
                    Action Required: {cat.actionRequiredCount}
                  </span>
                )}
                {cat.warningCount > 0 && (
                  <span style={{ color: '#d97706' }}>Warnings: {cat.warningCount}</span>
                )}
              </div>
              <Link
                to={`/settings/${cat.categoryId}?targetProjectId=${targetProjectId}`}
                style={{
                  display: 'inline-block',
                  width: '100%',
                  textAlign: 'center',
                  padding: '8px 12px',
                  background: '#2563eb',
                  color: '#ffffff',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                Manage Category
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
