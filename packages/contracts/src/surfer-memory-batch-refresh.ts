import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferObservationSelection } from './surfer-cognition.js';
import type { SurferDirectiveMemorySession } from './surfer-directive-memory.js';
import type { SurferDirectiveExtractionV2 } from './surfer-directive-v2.js';

export type SurferMemoryBatchTarget = {
  replaces: SurferArtifactRef;
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
};
export type SurferMemoryBatchRefreshIntent = {
  schemaVersion: '1.0.0';
  contract: 'surfer.memory-batch-refresh.v1';
  operationId: string;
  expectedActiveSnapshotId: string;
  targets: SurferMemoryBatchTarget[];
};
export type SurferMemoryBatchRefreshRequest = Omit<SurferMemoryBatchRefreshIntent, 'targets'> & {
  targets: (SurferMemoryBatchTarget & { packet: SurferDirectiveExtractionV2 })[];
};
/** Backend metadata only. No historical text, interpretation or citations. */
export type SurferMemoryBatchReplacementPlan = {
  snapshotId: string;
  snapshotDigest: string;
  targets: SurferArtifactRef[];
  retained: SurferArtifactRef[];
  sourceIds: string[];
};
export interface SurferMemoryBatchRefreshSession extends SurferDirectiveMemorySession {
  planReplacements(input: {
    snapshotId: string;
    targets: SurferMemoryBatchTarget[];
  }): Promise<SurferMemoryBatchReplacementPlan>;
}
export interface SurferMemoryBatchRefreshSessionPort {
  withBatchRefreshSession<T>(
    actor: unknown,
    apply: (session: SurferMemoryBatchRefreshSession) => Promise<T>,
  ): Promise<T>;
}
