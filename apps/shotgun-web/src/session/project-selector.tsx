import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

import type { ProductSessionView, SessionBoundaryView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import {
  purgeProjectScopedCaches,
  productSessionQueryKey,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';
import { safeErrorMessage } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';
import { useLeaveGuard } from './leave-guard-context.js';

export const ProjectSelector = ({ session }: { readonly session: ProductSessionView }) => {
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
    if (targetProjectId === session.activeProject.id) return;
    setGuardMessage(null);

    if (connectivity.isOffline) {
      setGuardMessage('오프라인 상태에서는 Project를 전환할 수 없습니다.');
      selectRef.current?.focus();
      return;
    }

    const leaveState = getLeaveState();

    if (!leaveState.canLeaveCurrentContext) {
      setGuardMessage('현재 Workspace 작업으로 인해 Project를 전환할 수 없습니다.');
      selectRef.current?.focus();
      return;
    }

    if (leaveState.hasBlockingDialog) {
      setGuardMessage('열려 있는 대화 상자를 먼저 처리한 후 전환해 주세요.');
      selectRef.current?.focus();
      return;
    }

    if (leaveState.hasOutcomeUnknownCommand) {
      setGuardMessage('실행 중인 명령의 결과를 확인하기 전에는 Project를 전환할 수 없습니다.');
      selectRef.current?.focus();
      return;
    }

    if (leaveState.hasUnsavedDraft) {
      setGuardMessage('저장되지 않은 Draft가 있어 Project를 전환할 수 없습니다.');
      selectRef.current?.focus();
      return;
    }

    switching.mutate(targetProjectId);
  };

  return (
    <div className="project-control">
      <label htmlFor="active-project">Active Project</label>
      <select
        id="active-project"
        ref={selectRef}
        value={session.activeProject.id}
        disabled={switching.isPending || connectivity.isOffline}
        onChange={(event) => initiateProjectSwitch(event.currentTarget.value)}
      >
        {session.accessibleProjects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.id}
            {project.isOwner ? ' (Owner)' : ''}
          </option>
        ))}
      </select>

      {switching.isPending ? <LoadingState message="Project 전환 중" /> : null}
      {guardMessage ? (
        <p role="alert" className="guard-alert">
          {guardMessage}
        </p>
      ) : null}
      {switching.error ? <p role="alert">{safeErrorMessage(switching.error)}</p> : null}
    </div>
  );
};
