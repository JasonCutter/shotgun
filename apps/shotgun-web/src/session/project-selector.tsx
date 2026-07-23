import { useMutation } from '@tanstack/react-query';
import { useRevalidator } from 'react-router';

import type { ProductSessionView } from '@shotgun/api-client';

import { clearProjectQueries, productSessionQueryKey } from '../app/query-keys.js';
import { useAppRuntime } from '../app/providers.js';
import { safeErrorMessage } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';

export const ProjectSelector = ({ session }: { readonly session: ProductSessionView }) => {
  const { apiClient, queryClient } = useAppRuntime();
  const revalidator = useRevalidator();
  const switching = useMutation({
    mutationFn: (projectId: string) => apiClient.switchActiveProject(projectId),
    onSuccess: async (nextSession) => {
      await clearProjectQueries(queryClient);
      queryClient.setQueryData(productSessionQueryKey, nextSession);
      revalidator.revalidate();
    },
  });

  return (
    <div className="project-control">
      <label htmlFor="active-project">Active Project</label>
      <select
        id="active-project"
        value={session.activeProject.id}
        disabled={switching.isPending}
        onChange={(event) => switching.mutate(event.currentTarget.value)}
      >
        {session.accessibleProjects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.id}
            {project.isOwner ? ' (Owner)' : ''}
          </option>
        ))}
      </select>
      {switching.isPending ? <LoadingState message="Project 전환 중" /> : null}
      {switching.error ? <p role="alert">{safeErrorMessage(switching.error)}</p> : null}
    </div>
  );
};
