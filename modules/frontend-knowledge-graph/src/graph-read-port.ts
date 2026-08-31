import type {
  GraphEvidenceDetailRequestV1,
  GraphEvidenceDetailResultV1,
  GraphDiscoveryOverlayRequestV1,
  GraphNeighborhoodRequestV1,
  GraphNeighborhoodResultV1,
  GraphOverlayResultV1,
  GraphPathDescriptionV1,
  GraphPathDescribeRequestV1,
  GraphPathRequestV1,
  GraphPathResultV1,
  GraphNodeReferenceV1,
  GraphRecursiveImpactOverlayRequestV1,
  GraphRestoreRequestV1,
  GraphRestoreResultV1,
  GraphSnapshotRefreshRequestV1,
  GraphSnapshotRequestV1,
  GraphSnapshotResultV1,
} from '../../../packages/contracts/src/index.js';

/**
 * Server-derived read scope. The browser never supplies or overrides these
 * values; every FE-P3-S3 read validates its response against this scope.
 */
export type GraphReadScopeV1 = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope: readonly string[];
  readonly discoveryContext?: {
    readonly activeProject: {
      readonly id: string;
      readonly label: string;
      readonly isOwner: boolean;
      readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
    };
    readonly accessibleProjects: readonly {
      readonly id: string;
      readonly label: string;
      readonly isOwner: boolean;
      readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
    }[];
  };
};

export type GraphReadPort = {
  getSnapshot?(
    scope: GraphReadScopeV1,
    snapshotId: string,
    projectionRevision: string,
  ): Promise<GraphSnapshotResultV1 | undefined>;
  snapshot(
    scope: GraphReadScopeV1,
    request: GraphSnapshotRequestV1,
  ): Promise<GraphSnapshotResultV1>;
  neighborhood(
    scope: GraphReadScopeV1,
    request: GraphNeighborhoodRequestV1,
  ): Promise<GraphNeighborhoodResultV1>;
  path(scope: GraphReadScopeV1, request: GraphPathRequestV1): Promise<GraphPathResultV1>;
  pathDescription(
    scope: GraphReadScopeV1,
    request: GraphPathDescribeRequestV1,
  ): Promise<GraphPathDescriptionV1>;
  evidenceDetail(
    scope: GraphReadScopeV1,
    request: GraphEvidenceDetailRequestV1,
  ): Promise<GraphEvidenceDetailResultV1>;
  refresh(
    scope: GraphReadScopeV1,
    request: GraphSnapshotRefreshRequestV1,
  ): Promise<GraphSnapshotResultV1>;
  restore(scope: GraphReadScopeV1, request: GraphRestoreRequestV1): Promise<GraphRestoreResultV1>;
};

export type GraphImpactPort = {
  recursiveImpact(
    scope: GraphReadScopeV1,
    request: GraphRecursiveImpactOverlayRequestV1,
    baseSnapshotId: string,
  ): Promise<GraphOverlayResultV1>;
};

/**
 * Read-only binding seam for a persisted Discovery Finding. The port owns the
 * current Finding/resource/Evidence authorization checks; the graph domain
 * only binds its result to the exact base snapshot and projection revision.
 */
export type GraphDiscoveryOverlayPort = {
  /**
   * Resolve the server-authorized resource roots for the exact Finding
   * revision before a focused base snapshot is materialized. Browser-supplied
   * resource refs are never used for this operation.
   */
  resolveDiscoveryRoots?(
    scope: GraphReadScopeV1,
    request: Pick<GraphDiscoveryOverlayRequestV1, 'findingId' | 'findingRevision'>,
  ): Promise<readonly GraphNodeReferenceV1[] | undefined>;
  discoveryOverlay(
    scope: GraphReadScopeV1,
    request: GraphDiscoveryOverlayRequestV1,
    baseSnapshot: GraphSnapshotResultV1,
  ): Promise<GraphOverlayResultV1>;
};
