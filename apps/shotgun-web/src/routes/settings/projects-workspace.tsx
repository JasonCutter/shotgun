import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAppRuntime } from '../../app/providers.js';
import { projectAdminQueryKey, purgeSettingsScopedCaches } from '../../app/query-keys.js';
import { sessionQueryOptions } from '../../session/session-query.js';

export const ProjectsWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const principalId = session?.principal.id ?? 'principal-a';

  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: projectAdminQueryKey(principalId),
    queryFn: () => apiClient.getProjects(),
  });

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newProjectId, setNewProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (params: {
      id: string;
      name: string;
      description?: string;
      clientRequestId: string;
      idempotencyKey: string;
    }) => apiClient.createProject(params),
    onSuccess: async () => {
      await purgeSettingsScopedCaches(queryClient);
      setCreateModalOpen(false);
      setNewProjectId('');
      setNewProjectName('');
      setNewProjectDesc('');
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : 'Create project failed.');
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const reqId = `req-${Date.now()}`;
    const idemKey = `idem-create-${newProjectId}-${Date.now()}`;
    createMutation.mutate({
      id: newProjectId,
      name: newProjectName,
      description: newProjectDesc,
      clientRequestId: reqId,
      idempotencyKey: idemKey,
    });
  };

  if (isLoading) return <div>Loading project administration workspace...</div>;
  if (error) return <div className="error-banner">Failed to load projects list.</div>;

  return (
    <section className="projects-workspace">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '20px', margin: '0 0 4px 0' }}>Project Administration</h2>
          <p style={{ color: '#64748b', margin: 0 }}>
            Manage project identity, metadata, and lifecycle status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          style={{
            padding: '8px 16px',
            background: '#16a34a',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          + Create New Project
        </button>
      </div>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginTop: '16px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
        }}
      >
        <thead>
          <tr
            style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}
          >
            <th style={{ padding: '12px' }}>Project ID</th>
            <th style={{ padding: '12px' }}>Name</th>
            <th style={{ padding: '12px' }}>Status</th>
            <th style={{ padding: '12px' }}>Active</th>
            <th style={{ padding: '12px' }}>Revision</th>
            <th style={{ padding: '12px' }}>Created</th>
            <th style={{ padding: '12px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {projects?.map((proj) => (
            <tr key={proj.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '12px', fontWeight: 600 }}>{proj.id}</td>
              <td style={{ padding: '12px' }}>{proj.name}</td>
              <td style={{ padding: '12px' }}>
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background:
                      proj.status === 'ACTIVE'
                        ? '#dcfce7'
                        : proj.status === 'ARCHIVED'
                          ? '#f1f5f9'
                          : '#fee2e2',
                    color:
                      proj.status === 'ACTIVE'
                        ? '#166534'
                        : proj.status === 'ARCHIVED'
                          ? '#475569'
                          : '#991b1b',
                  }}
                >
                  {proj.status}
                </span>
              </td>
              <td style={{ padding: '12px' }}>{proj.active ? 'Yes' : 'No'}</td>
              <td style={{ padding: '12px' }}>{proj.revision}</td>
              <td style={{ padding: '12px', fontSize: '13px', color: '#64748b' }}>
                {new Date(proj.createdAt).toLocaleDateString()}
              </td>
              <td style={{ padding: '12px' }}>
                <Link
                  to={`/settings/projects/${encodeURIComponent(proj.id)}`}
                  style={{
                    padding: '4px 8px',
                    background: '#2563eb',
                    color: '#fff',
                    borderRadius: '4px',
                    textDecoration: 'none',
                    fontSize: '12px',
                  }}
                >
                  Details / Policy
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {createModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-dialog-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '24px',
              borderRadius: '8px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <h2 id="create-project-dialog-title" style={{ marginTop: 0 }}>
              Create Project
            </h2>

            {errorMessage && (
              <div
                style={{
                  padding: '8px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  borderRadius: '4px',
                  marginBottom: '12px',
                  fontSize: '13px',
                }}
              >
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} style={{ display: 'grid', gap: '12px' }}>
              <div>
                <label
                  htmlFor="new-proj-id"
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    fontSize: '13px',
                    marginBottom: '4px',
                  }}
                >
                  Project ID (Immutable)
                </label>
                <input
                  id="new-proj-id"
                  required
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
                  placeholder="e.g., my-new-project"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="new-proj-name"
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    fontSize: '13px',
                    marginBottom: '4px',
                  }}
                >
                  Project Name
                </label>
                <input
                  id="new-proj-name"
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g., My New Project"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="new-proj-desc"
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    fontSize: '13px',
                    marginBottom: '4px',
                  }}
                >
                  Description (Optional)
                </label>
                <textarea
                  id="new-proj-desc"
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    minHeight: '60px',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  marginTop: '12px',
                }}
              >
                <button type="button" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  style={{
                    padding: '8px 16px',
                    background: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                  }}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
