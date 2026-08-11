import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useRevalidator } from 'react-router';

import type { GlobalShellView, ProductSessionView, SessionBoundaryView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import {
  productSessionQueryKey,
  purgeProjectScopedCaches,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';
import { safeErrorMessage } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';
import { useLeaveGuard } from './leave-guard-context.js';

export const ProjectSelector = ({
  session,
  shell,
}: {
  readonly session: ProductSessionView;
  readonly shell: GlobalShellView;
}) => {
  const { apiClient, queryClient } = useAppRuntime();
  const revalidator = useRevalidator();
  const connectivity = useConnectivityState();
  const { getLeaveState } = useLeaveGuard();

  const [guardMessage, setGuardMessage] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const switching = useMutation({
    mutationFn: (projectId: string) => apiClient.switchActiveProject(projectId),
    onSuccess: async (nextSession) => {
      await purgeProjectScopedCaches(queryClient);
      queryClient.setQueryData(productSessionQueryKey, nextSession);
      queryClient.setQueryData(
        sessionBoundaryQueryKey,
        (oldBoundary: SessionBoundaryView | undefined) =>
          oldBoundary ? { ...oldBoundary, session: nextSession } : oldBoundary,
      );
      revalidator.revalidate();
      setGuardMessage(null);
    },
  });

  const initiateProjectSwitch = (targetProjectId: string) => {
    if (targetProjectId === session.activeProject?.id) return;
    setGuardMessage(null);

    if (connectivity.isOffline) {
      setGuardMessage('Project switching is unavailable while offline.');
      selectRef.current?.focus();
      return;
    }

    const leaveState = getLeaveState();
    if (!leaveState.canLeaveCurrentContext) {
      setGuardMessage('Resolve the current Workspace before switching Projects.');
      selectRef.current?.focus();
      return;
    }
    if (leaveState.hasBlockingDialog) {
      setGuardMessage('Close the blocking dialog before switching Projects.');
      selectRef.current?.focus();
      return;
    }
    if (leaveState.hasUnsavedDraft) {
      setGuardMessage('Save or discard the current draft before switching Projects.');
      selectRef.current?.focus();
      return;
    }
    if (leaveState.hasOutcomeUnknownCommand) {
      setGuardMessage(
        'A command outcome is unknown. Switching does not retry it; recover it with the original request ID.',
      );
    }

    switching.mutate(targetProjectId);
  };

  if (!session.activeProject || session.accessibleProjects.length === 0) {
    return (
      <div className="project-control">
        <span>Current project</span>
        <Link to="/settings/projects">Create your first Project</Link>
      </div>
    );
  }

  return (
    <div className="project-control">
      <label htmlFor="active-project">Current project</label>
      <select
        id="active-project"
        ref={selectRef}
        value={session.activeProject.id}
        disabled={switching.isPending || connectivity.isOffline}
        onChange={(event) => initiateProjectSwitch(event.currentTarget.value)}
      >
        {session.accessibleProjects.map((project) => (
          <option key={project.id} value={project.id}>
            {shell.accessibleProjects.find((candidate) => candidate.id === project.id)?.label ??
              'Unnamed project'}
            {project.isOwner ? ' (Owner)' : ''}
          </option>
        ))}
      </select>

      {switching.isPending ? <LoadingState message="Switching Project…" /> : null}
      {guardMessage ? (
        <p role="alert" className="guard-alert">
          {guardMessage}
        </p>
      ) : null}
      {switching.error ? <p role="alert">{safeErrorMessage(switching.error)}</p> : null}
    </div>
  );
};
