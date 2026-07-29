import { queryOptions } from '@tanstack/react-query';

import type { GlobalShellView, ProductSessionView, ShotgunApiClient } from '@shotgun/api-client';

import { globalShellQueryKey, homeActionCenterQueryKey } from '../app/query-keys.js';

const sessionAccessRevision = (session: ProductSessionView): string =>
  session.apiVersion === '2.0.0'
    ? session.projectAccessRevision
    : session.accessibleProjects
        .map((project) => `${project.id}:${project.isOwner ? 'owner' : 'member'}`)
        .sort()
        .join('|');

export const globalShellQueryOptions = (
  apiClient: ShotgunApiClient,
  session: ProductSessionView | null,
) =>
  queryOptions({
    queryKey: session
      ? globalShellQueryKey(
          session.principal.id,
          session.activeProject?.id ?? null,
          sessionAccessRevision(session),
        )
      : (['protected', 'global-shell', 'no-session'] as const),
    queryFn: ({ signal }) => apiClient.getGlobalShell({ signal }),
    enabled: session !== null,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

export const homeActionCenterQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView | null,
) =>
  queryOptions({
    queryKey: shell?.activeProject
      ? homeActionCenterQueryKey({
          principalId: shell.principalId,
          sessionId: shell.sessionId,
          activeProjectId: shell.activeProject.id,
          accessRevision: shell.accessRevision,
          policyContextRevision: shell.policyContextRevision,
          projectionRevision: shell.projectionRevision,
        })
      : (['project', 'home-action-center', 'no-project'] as const),
    queryFn: ({ signal }) => apiClient.getHomeActionCenter({ signal }),
    enabled: shell?.activeProject !== null && shell !== null,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
