import type {
  GraphEvidenceDetailRequestV1,
  GraphEvidenceDetailResultV1,
  GraphNeighborhoodRequestV1,
  GraphNeighborhoodResultV1,
  GraphOverlayResultV1,
  GraphPathDescriptionV1,
  GraphPathDescribeRequestV1,
  GraphPathRequestV1,
  GraphPathResultV1,
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
};

export type GraphReadPort = {
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
