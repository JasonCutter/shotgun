import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';
import { TechnicalDetails } from '../../components/technical-details.js';
import { directiveStatusLabel } from '../../presentation/product-labels.js';

export const DirectivesWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const [searchParams] = useSearchParams();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';

  const {
    data: proposals,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'directives', targetProjectId],
    queryFn: () => apiClient.getDirectiveProposals(targetProjectId),
  });

  if (isLoading) return <div>Loading directive proposals...</div>;
  if (error) return <div className="error-banner">Failed to load directive proposals.</div>;

  if (proposals?.availability === 'UNAVAILABLE') {
    return (
      <section className="directives-workspace">
        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>User Directives & Fact Priority</h2>
        <div
          style={{
            color: '#b91c1c',
            padding: '16px',
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
          }}
        >
          {proposals.disabledReason}
        </div>
      </section>
    );
  }

  return (
    <section className="directives-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>User Directives & Fact Priority</h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Manage user directive proposals, fact ranking overrides, and rule priority conflicts.
      </p>

      {proposals?.data?.length === 0 ? (
        <p style={{ color: '#64748b' }}>No directive proposals are active for this project.</p>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {proposals?.data?.map((p) => (
            <div
              key={p.proposalId}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                background: '#fff',
              }}
            >
              <h3>Directive proposal · {directiveStatusLabel(p.status)}</h3>
              <p>{p.description}</p>
              <TechnicalDetails
                items={[
                  { label: 'Proposal ID', value: p.proposalId },
                  { label: 'Resource ID', value: p.resourceId },
                  { label: 'Directive type', value: p.directiveType },
                  { label: 'Status', value: p.status },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
