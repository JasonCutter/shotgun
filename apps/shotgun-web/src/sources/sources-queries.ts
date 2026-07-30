import { queryOptions } from '@tanstack/react-query';

import type { GlobalShellView, ShotgunApiClient, SourceLibraryQuery } from '@shotgun/api-client';

import {
  sourceDetailQueryKey,
  sourceEvidenceQueryKey,
  sourcePreviewQueryKey,
  sourcesLibraryQueryKey,
  sourceVersionHistoryQueryKey,
  type SourcesQueryScope,
} from '../app/query-keys.js';

const clientDigest = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `client-query-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const sourcesScopeFromShell = (
  shell: GlobalShellView,
  resourceProjectId = shell.activeProject?.id,
): SourcesQueryScope | null =>
  shell.activeProject && resourceProjectId
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        resourceProjectId,
        projectionRevision: shell.projectionRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
        policyContextRevision: shell.policyContextRevision,
      }
    : null;

export const sourcesLibraryQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView,
  query: SourceLibraryQuery,
) => {
  const scope = sourcesScopeFromShell(shell);
  const digest = clientDigest(JSON.stringify(query));
  return queryOptions({
    queryKey: scope
      ? sourcesLibraryQueryKey(scope, digest)
      : (['project', 'sources-library', 'no-project'] as const),
    queryFn: ({ signal }) => apiClient.listSources(query, { signal }),
    enabled: scope !== null,
    retry: false,
    staleTime: 15_000,
  });
};

export const sourceDetailQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView,
  sourceId: string,
) => {
  const scope = sourcesScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? sourceDetailQueryKey(scope, sourceId)
      : (['project', 'source', 'no-project'] as const),
    queryFn: ({ signal }) => apiClient.getSourceDetail(sourceId, { signal }),
    enabled: scope !== null && sourceId.length > 0,
    retry: false,
    staleTime: 15_000,
  });
};

export const sourceVersionHistoryQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView,
  sourceId: string,
  sourceVersionId: string,
) => {
  const scope = sourcesScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? sourceVersionHistoryQueryKey(scope, sourceId, sourceVersionId)
      : (['project', 'source-history', 'no-project'] as const),
    queryFn: ({ signal }) =>
      apiClient.getSourceVersionHistory(sourceId, sourceVersionId, undefined, {
        signal,
      }),
    enabled: scope !== null && sourceId.length > 0 && sourceVersionId.length > 0,
    retry: false,
    staleTime: 15_000,
  });
};

export const sourcePreviewQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView,
  sourceId: string,
  sourceVersionId: string,
  mode: 'ORIGINAL' | 'TRANSFORMED',
) => {
  const scope = sourcesScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? sourcePreviewQueryKey(scope, sourceId, sourceVersionId, mode)
      : (['project', 'source-preview', 'no-project'] as const),
    queryFn: ({ signal }) =>
      apiClient.getSourcePreview(sourceId, sourceVersionId, mode, { signal }),
    enabled: scope !== null && sourceId.length > 0 && sourceVersionId.length > 0,
    retry: false,
    staleTime: 15_000,
  });
};

export const sourceEvidenceQueryOptions = (
  apiClient: ShotgunApiClient,
  shell: GlobalShellView,
  sourceId: string,
  sourceVersionId: string,
) => {
  const scope = sourcesScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? sourceEvidenceQueryKey(scope, sourceId, sourceVersionId)
      : (['project', 'source-evidence', 'no-project'] as const),
    queryFn: ({ signal }) =>
      apiClient.getSourceEvidence(sourceId, sourceVersionId, undefined, {
        signal,
      }),
    enabled: scope !== null && sourceId.length > 0 && sourceVersionId.length > 0,
    retry: false,
    staleTime: 15_000,
  });
};
