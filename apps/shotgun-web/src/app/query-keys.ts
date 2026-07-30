import type { QueryClient } from '@tanstack/react-query';

export const productSessionQueryKey = ['product', 'session'] as const;
export const sessionBoundaryQueryKey = ['session', 'boundary'] as const;
export const protectedQueryKey = ['protected'] as const;
export const globalQueryKey = ['global'] as const;
export const unprotectedQueryKey = ['unprotected'] as const;

export const projectQueryKey = (
  principalId: string,
  projectId: string,
  resource: string,
  ...parts: readonly unknown[]
) => ['project', principalId, projectId, resource, ...parts] as const;

export const settings5DQueryKey = (
  principalId: string,
  targetProjectId: string,
  resourceProjectId: string,
  category: string,
  revisionOrResourceId?: string | number,
) =>
  [
    'settings',
    principalId,
    targetProjectId,
    resourceProjectId,
    category,
    revisionOrResourceId ?? 'latest',
  ] as const;

export const projectAdminQueryKey = (principalId: string) =>
  ['project-admin', principalId] as const;

export const globalShellQueryKey = (
  principalId: string,
  activeProjectId: string | null,
  accessRevision: string,
) => ['protected', 'global-shell', principalId, activeProjectId, accessRevision] as const;

export const homeActionCenterQueryKey = (input: {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly projectionRevision: string;
}) =>
  [
    'project',
    input.principalId,
    input.activeProjectId,
    'home-action-center',
    input.sessionId,
    input.accessRevision,
    input.policyContextRevision,
    input.projectionRevision,
  ] as const;

export type SourcesQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly projectionRevision: string;
  readonly sensitivity: string;
  readonly policyContextRevision: string;
};

const sourcesScopeKey = (scope: SourcesQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.projectionRevision,
    scope.sensitivity,
    scope.policyContextRevision,
  ] as const;

export const sourcesLibraryQueryKey = (scope: SourcesQueryScope, clientQueryDigest: string) =>
  [...sourcesScopeKey(scope), 'sources-library', clientQueryDigest] as const;

export const sourceDetailQueryKey = (scope: SourcesQueryScope, sourceId: string) =>
  [...sourcesScopeKey(scope), 'source', sourceId] as const;

export const sourceVersionHistoryQueryKey = (
  scope: SourcesQueryScope,
  sourceId: string,
  sourceVersionId: string,
) => [...sourcesScopeKey(scope), 'source', sourceId, 'versions', sourceVersionId] as const;

export const sourcePreviewQueryKey = (
  scope: SourcesQueryScope,
  sourceId: string,
  sourceVersionId: string,
  mode: 'ORIGINAL' | 'TRANSFORMED',
) =>
  [
    ...sourcesScopeKey(scope),
    'source',
    sourceId,
    'version',
    sourceVersionId,
    'preview',
    mode,
  ] as const;

export const sourceEvidenceQueryKey = (
  scope: SourcesQueryScope,
  sourceId: string,
  sourceVersionId: string,
) =>
  [...sourcesScopeKey(scope), 'source', sourceId, 'version', sourceVersionId, 'evidence'] as const;

export const clearProjectQueries = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
};

export const purgeProjectScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await clearProjectQueries(queryClient);
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.removeQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['protected', 'global-shell'] });
  queryClient.removeQueries({ queryKey: ['protected', 'global-shell'] });
};

export const purgeProtectedSessionCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['protected'] });
  queryClient.removeQueries({ queryKey: ['protected'] });
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.removeQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['project-admin'] });
  queryClient.removeQueries({ queryKey: ['project-admin'] });
  await queryClient.cancelQueries({ queryKey: productSessionQueryKey });
  queryClient.removeQueries({ queryKey: productSessionQueryKey });
};

export const purgeSettingsScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.invalidateQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['project-admin'] });
  queryClient.invalidateQueries({ queryKey: ['project-admin'] });
};
