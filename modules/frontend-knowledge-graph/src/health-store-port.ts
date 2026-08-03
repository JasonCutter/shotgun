import type {
  GraphBaseViewKindV1,
  GraphOverlayKindV1,
  GraphProjectionHealthV1,
  GraphResultCompletenessV1,
  GraphTraversalLimitsV1,
  GraphTruncationStateV1,
  GraphUnavailableReasonV1,
} from '../../../packages/contracts/src/index.js';

export type GraphProjectionHealthRecordV1 = {
  readonly projectId: string;
  readonly viewKind: GraphBaseViewKindV1;
  readonly projectionRevision: string;
  readonly status: GraphProjectionHealthV1;
  readonly generatedAt: string;
  readonly lag: number;
  readonly rebuildState: 'IDLE' | 'REBUILDING' | 'FAILED';
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type GraphOverlayHealthRecordV1 = {
  readonly projectId: string;
  readonly baseSnapshotId: string;
  readonly overlayKind: GraphOverlayKindV1;
  readonly overlaySnapshotId: string;
  readonly overlayRevision: string;
  readonly analyzerRevision: string;
  readonly policyContextRevision: string;
  readonly generatedAt: string;
  readonly completeness: GraphResultCompletenessV1;
  readonly truncation?: GraphTruncationStateV1;
  readonly unavailableReason?: GraphUnavailableReasonV1;
};

export type GraphContinuationRecordV1 = {
  readonly token: string;
  readonly expiresAt: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly snapshotId: string;
  readonly rootRef?: unknown;
  readonly filtersDigest: string;
  readonly viewKind: GraphBaseViewKindV1;
  readonly overlayKinds: readonly GraphOverlayKindV1[];
  readonly limits: GraphTraversalLimitsV1;
};

export type HealthStorePort = {
  upsertProjectionHealth(record: GraphProjectionHealthRecordV1): Promise<void>;
  getProjectionHealth(
    projectId: string,
    viewKind: GraphBaseViewKindV1,
  ): Promise<GraphProjectionHealthRecordV1 | undefined>;

  upsertOverlayHealth(record: GraphOverlayHealthRecordV1): Promise<void>;
  getOverlayHealth(
    projectId: string,
    baseSnapshotId: string,
    overlayKind: GraphOverlayKindV1,
  ): Promise<GraphOverlayHealthRecordV1 | undefined>;

  writeContinuation(record: GraphContinuationRecordV1): Promise<void>;
  findContinuation(token: string): Promise<GraphContinuationRecordV1 | undefined>;
  deleteContinuation(token: string): Promise<void>;

  pruneExpired(nowIso: string): Promise<void>;
};
