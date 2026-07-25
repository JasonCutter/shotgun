import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppRuntime } from '../../app/providers.js';
import { purgeSettingsScopedCaches } from '../../app/query-keys.js';

export const ProjectDetailsWorkspace = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();

  const targetId = projectId ?? 'shotgun';

  const {
    data: project,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['project-details', targetId],
    queryFn: () => apiClient.getProjectDetails(targetId),
  });

  const [renameValue, setRenameValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (params: { name?: string; description?: string; expectedRevision: number }) =>
      apiClient.updateProject(targetId, params),
    onSuccess: async () => {
      await purgeSettingsScopedCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ['project-details', targetId] });
      setMessage('Project name updated.');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (expectedRevision: number) => apiClient.archiveProject(targetId, expectedRevision),
    onSuccess: async () => {
      await purgeSettingsScopedCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ['project-details', targetId] });
      setMessage('Project archived.');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (expectedRevision: number) => apiClient.restoreProject(targetId, expectedRevision),
    onSuccess: async () => {
      await purgeSettingsScopedCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ['project-details', targetId] });
      setMessage('Project restored.');
    },
  });

  const deleteRequestMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      apiClient.requestDeleteProject(targetId, expectedRevision),
    onSuccess: async () => {
      await purgeSettingsScopedCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ['project-details', targetId] });
      setMessage('Delete request submitted.');
    },
  });

  if (isLoading) return <div>Loading project details...</div>;
  if (error || !project) return <div className="error-banner">Project not found.</div>;

  return (
    <section className="project-details-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Project Details: {project.name}</h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Project ID: <code>{project.id}</code> | Revision: {project.revision}
      </p>

      {message && (
        <div
          style={{
            padding: '8px',
            background: '#dcfce7',
            color: '#166534',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          {message}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gap: '20px',
          maxWidth: '600px',
          background: '#fff',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <h3>Status & Lifecycle</h3>
          <p>
            Current Status: <strong>{project.status}</strong>
          </p>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            {project.capability.canArchive && (
              <button
                type="button"
                onClick={() => archiveMutation.mutate(project.revision)}
                disabled={archiveMutation.isPending}
                style={{
                  padding: '8px 16px',
                  background: '#d97706',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                }}
              >
                Archive Project
              </button>
            )}

            {project.capability.canRestore && (
              <button
                type="button"
                onClick={() => restoreMutation.mutate(project.revision)}
                disabled={restoreMutation.isPending}
                style={{
                  padding: '8px 16px',
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                }}
              >
                Restore Project
              </button>
            )}

            {project.capability.canDelete && (
              <button
                type="button"
                onClick={() => deleteRequestMutation.mutate(project.revision)}
                disabled={deleteRequestMutation.isPending}
                style={{
                  padding: '8px 16px',
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                }}
              >
                Request Deletion
              </button>
            )}
          </div>
        </div>

        <div>
          <h3>Rename Project</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renameValue.trim()) {
                updateMutation.mutate({
                  name: renameValue.trim(),
                  expectedRevision: project.revision,
                });
              }
            }}
            style={{ display: 'flex', gap: '8px' }}
          >
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="New project name"
              disabled={!project.capability.canRename}
              style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
            <button
              type="submit"
              disabled={!project.capability.canRename || updateMutation.isPending}
              style={{
                padding: '8px 16px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
              }}
            >
              Rename
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};
