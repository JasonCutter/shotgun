import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type FrontendKnowledgeGraphClient,
  type GlobalShellView,
  type GraphConflictOverlayRequestV1,
  type GraphDiscoveryOverlayRequestV1,
  type GraphEvidenceDetailRequestV1,
  type GraphKnowledgeGapOverlayRequestV1,
  type GraphNeighborhoodRequestV1,
  type GraphPathDescribeRequestV1,
  type GraphPathRequestV1,
  type GraphRecursiveImpactOverlayRequestV1,
  type GraphRestoreRequestV1,
  type GraphSnapshotRefreshRequestV1,
  type GraphSnapshotRequestV1,
  type GraphSnapshotResultV1,
} from '@shotgun/api-client';

import {
  graphDisabledQueryKey,
  graphScopeQueryKey,
  graphSnapshotPhaseQueryKey,
  type GraphQueryScope,
} from '../app/query-keys.js';

export const graphCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const graphQueryRetry = (failureCount: number, error: unknown): boolean =>
  graphCanManuallyRetry(error) && failureCount < 2;

export const graphScopeFromShell = (shell: GlobalShellView | null): GraphQueryScope | null =>
  shell?.activeProject
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        resourceProjectId: shell.activeProject.id,
        accessRevision: shell.accessRevision,
        policyContextRevision: shell.policyContextRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
        projectionRevision: shell.projectionRevision,
      }
    : null;

/**
 * Scope-phase read: an initial snapshot request bound to the server
 * Project/access scope. The snapshot-phase keys below are bound to the
 * server-issued snapshot identity and never reuse another project/policy/
 * snapshot/overlay revision's cached result (AC-16).
 */
export const graphSnapshotQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  shell: GlobalShellView | null,
  request: GraphSnapshotRequestV1,
) => {
  const scope = graphScopeFromShell(shell);
  return queryOptions({
    queryKey: scope ? graphScopeQueryKey(scope, request) : graphDisabledQueryKey('snapshot'),
    queryFn: ({ signal }) => client.getGraphSnapshot(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });
};

export const graphDiscoverySnapshotQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  shell: GlobalShellView | null,
  request: GraphSnapshotRequestV1,
  findingId: string,
  findingRevision: number,
) => {
  const scope = graphScopeFromShell(shell);
  return queryOptions({
    queryKey: scope
      ? [...graphScopeQueryKey(scope, request), 'discovery', findingId, findingRevision]
      : graphDisabledQueryKey('discovery-snapshot'),
    queryFn: ({ signal }) =>
      client.getDiscoveryGraphSnapshot(request, findingId, findingRevision, { signal }),
    enabled: scope !== null && findingId.trim().length > 0 && findingRevision > 0,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });
};

export const graphNeighborhoodQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphNeighborhoodRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'neighborhood',
          request.centerRef,
        ])
      : graphDisabledQueryKey('neighborhood'),
    queryFn: ({ signal }) => client.expandGraphNeighborhood(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });

export const graphPathQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphPathRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'path',
          request.fromRef,
          request.toRef,
        ])
      : graphDisabledQueryKey('path'),
    queryFn: ({ signal }) => client.findGraphPath(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });

export const graphPathDescribeQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphPathDescribeRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'path-description',
          request.pathId,
        ])
      : graphDisabledQueryKey('path-description'),
    queryFn: ({ signal }) => client.describeGraphPath(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });

export const graphOverlayQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request:
    | GraphConflictOverlayRequestV1
    | GraphKnowledgeGapOverlayRequestV1
    | GraphRecursiveImpactOverlayRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'overlay',
          request.overlayKind,
        ])
      : graphDisabledQueryKey(`overlay-${request.overlayKind}`),
    queryFn: ({ signal }) => {
      if (request.overlayKind === 'CONFLICT') {
        return client.getConflictOverlay(request, { signal });
      }
      if (request.overlayKind === 'KNOWLEDGE_GAP') {
        return client.getKnowledgeGapOverlay(request, { signal });
      }
      return client.getRecursiveImpactOverlay(request, { signal });
    },
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });

export const graphDiscoveryOverlayQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphDiscoveryOverlayRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.baseSnapshotId, request.projectionRevision, [
          'overlay',
          'DISCOVERY',
          request.findingId,
          request.findingRevision,
        ])
      : graphDisabledQueryKey('overlay-DISCOVERY'),
    queryFn: ({ signal }) => client.getDiscoveryOverlay(request, { signal }),
    enabled: scope !== null && request.findingId.trim().length > 0 && request.findingRevision > 0,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });

export const graphEvidenceQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphEvidenceDetailRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'evidence',
          request.target,
        ])
      : graphDisabledQueryKey('evidence'),
    queryFn: ({ signal }) => client.getGraphEvidenceDetail(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 15_000,
  });

export const graphRefreshQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphSnapshotRefreshRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'refresh',
          request.expectedSnapshotRevision,
        ])
      : graphDisabledQueryKey('refresh'),
    queryFn: ({ signal }) => client.refreshGraphSnapshot(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 0,
  });

export const graphRestoreQueryOptions = (
  client: FrontendKnowledgeGraphClient,
  scope: GraphQueryScope | null,
  request: GraphRestoreRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? graphSnapshotPhaseQueryKey(scope, request.snapshotId, request.projectionRevision, [
          'restore',
          request.selectedNodeRefs,
        ])
      : graphDisabledQueryKey('restore'),
    queryFn: ({ signal }) => client.restoreGraphDeepLink(request, { signal }),
    enabled: scope !== null,
    retry: graphQueryRetry,
    staleTime: 0,
  });

export const graphSnapshotIsReady = (result: GraphSnapshotResultV1 | undefined): boolean =>
  Boolean(result && result.identity.snapshotId.length > 0);
