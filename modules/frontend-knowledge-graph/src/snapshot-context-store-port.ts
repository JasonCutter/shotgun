import type {
  GraphBaseViewKindV1,
  GraphFilterSetV1,
  GraphNodeReferenceV1,
  GraphOverlayKindV1,
  GraphTraversalLimitsV1,
} from '../../../packages/contracts/src/index.js';

/**
 * Immutable Snapshot Context descriptor (ADR-127). Stores NO graph node/edge
 * payloads; stores the actual normalized `GraphFilterSetV1` plus its digest so
 * the identical computation can be reconstructed from `snapshotId`.
 */
export type GraphSnapshotContextDescriptorV1 = {
  readonly snapshotId: string;
  readonly projectId: string;
  readonly viewKind: GraphBaseViewKindV1;
  readonly overlayKinds: readonly GraphOverlayKindV1[];
  readonly rootRefs: readonly GraphNodeReferenceV1[];
  readonly normalizedFilters: GraphFilterSetV1;
  readonly filtersDigest: string;
  readonly limits: GraphTraversalLimitsV1;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly projectionRevision: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
};

export type SnapshotContextStorePort = {
  /** Writes an immutable descriptor; a duplicate snapshotId is rejected. */
  write(context: GraphSnapshotContextDescriptorV1): Promise<void>;
  /** Resolves snapshotId -> descriptor for a Project; undefined when unknown/expired. */
  resolve(projectId: string, snapshotId: string): Promise<GraphSnapshotContextDescriptorV1 | undefined>;
  /** Removes expired descriptors (bounded retention). */
  pruneExpired(nowIso: string): Promise<void>;
};
