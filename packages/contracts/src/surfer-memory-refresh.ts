import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferObservationSelection } from './surfer-cognition.js';
import type { SurferDirectiveMemorySession } from './surfer-directive-memory.js';
import type { SurferDirectiveExtractionV2 } from './surfer-directive-v2.js';
export type SurferMemoryRefreshIntent = {
  schemaVersion: '1.0.0';
  contract: 'surfer.memory-refresh.v1';
  operationId: string;
  expectedActiveSnapshotId: string;
  replaces: SurferArtifactRef;
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
};
export type SurferMemoryRefreshRequest = SurferMemoryRefreshIntent & {
  packet: SurferDirectiveExtractionV2;
};
/** Backend-only plan contains no historical text, interpretation or quotes. */
export type SurferMemoryReplacementPlan = {
  snapshotId: string;
  snapshotDigest: string;
  target: SurferArtifactRef;
  retained: SurferArtifactRef[];
  sourceId: string;
};
export interface SurferMemoryRefreshSession extends SurferDirectiveMemorySession {
  planReplacement(input: {
    snapshotId: string;
    target: SurferArtifactRef;
    basis: SurferSourceBasisV2;
  }): Promise<SurferMemoryReplacementPlan>;
}
export interface SurferMemoryRefreshSessionPort {
  withRefreshSession<T>(
    actor: unknown,
    apply: (session: SurferMemoryRefreshSession) => Promise<T>,
  ): Promise<T>;
}
