import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router';

import { useAppRuntime } from '../../app/providers.js';
import {
  productSessionQueryKey,
  purgeProtectedSessionCaches,
  sessionBoundaryQueryKey,
} from '../../app/query-keys.js';
import { useAccessibleDialog } from '../../app/use-accessible-dialog.js';
import { sessionQueryOptions } from '../../session/session-query.js';

/**
 * Compatibility-only bootstrap route. Project administration after bootstrap
 * is owned by the shared slash-command registry.
 */
export const ProjectsWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session, isPending } = useQuery(sessionQueryOptions(apiClient));
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const closeCreateModal = () => setCreateModalOpen(false);
  const createDialog = useAccessibleDialog({ open: createModalOpen, onClose: closeCreateModal });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('Session is unavailable.');
      return apiClient.createFirstProject({
        name: newProjectName,
        ...(newProjectDescription ? { description: newProjectDescription } : {}),
        projectAccessRevision: session.apiVersion === '2.0.0' ? session.projectAccessRevision : '0',
        clientRequestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async () => {
      const nextSession = await apiClient.getSession();
      await purgeProtectedSessionCaches(queryClient);
      queryClient.setQueryData(productSessionQueryKey, nextSession);
      queryClient.setQueryData(sessionBoundaryQueryKey, (current: unknown) =>
        typeof current === 'object' && current !== null
          ? { ...current, session: nextSession }
          : current,
      );
      setCreateModalOpen(false);
      setNewProjectName('');
      setNewProjectDescription('');
      setErrorMessage(null);
      navigate('/');
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Create project failed.');
    },
  });

  if (isPending || !session) return <div>Loading Project onboarding...</div>;
  if (session.activeProject) return <Navigate to="/" replace />;

  return (
    <section className="projects-workspace">
      <h1>Create your first Project</h1>
      <p>Create one Project to unlock Home, Sources, Ask, Search, and slash commands.</p>
      <button
        type="button"
        onClick={(event) => {
          createDialog.captureInvoker(event.currentTarget);
          setCreateModalOpen(true);
        }}
      >
        Create Project
      </button>

      {createModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-dialog-title"
          ref={createDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={createDialog.onDialogKeyDown}
        >
          <h2 id="create-project-dialog-title">Create your first Project</h2>
          {errorMessage ? <p role="alert">{errorMessage}</p> : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setErrorMessage(null);
              createMutation.mutate();
            }}
          >
            <label htmlFor="first-project-name">Project Name</label>
            <input
              id="first-project-name"
              required
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
            />
            <label htmlFor="first-project-description">Description (Optional)</label>
            <textarea
              id="first-project-description"
              value={newProjectDescription}
              onChange={(event) => setNewProjectDescription(event.target.value)}
            />
            <button type="button" onClick={closeCreateModal}>
              Cancel
            </button>
            <button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Project'}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
};
