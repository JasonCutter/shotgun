import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferScope } from './surfer-learning.js';
import type { SurferDirectiveMemorySession } from './surfer-directive-memory.js';

export type SurferMemoryRefreshDiscoveryPlan = {
  schemaVersion: '1.0.0';
  contract: 'surfer.memory-refresh-plan.v1';
  status: 'EMPTY' | 'UNCHANGED' | 'REFRESH_REQUIRED' | 'BLOCKED';
  snapshot: { snapshotId: string; digest: string } | null;
  authorityDigest: string;
  targets: {
    memory: SurferArtifactRef;
    sourceId: string;
    previousFingerprint: string;
    previousMaterialProof: string;
    currentFingerprint: string;
    currentMaterialProof: string;
    sourceVersionId: string;
    revisionId: string;
  }[];
  retained: SurferArtifactRef[];
  blocked: {
    memory: SurferArtifactRef | null;
    reason:
      | 'UNSUPPORTED_MEMBER'
      | 'UNSUPPORTED_DEPENDENCIES'
      | 'AUTHORITY_CHANGED'
      | 'SOURCE_UNAVAILABLE'
      | 'HEAD_CHANGED'
      | 'SCOPE_WEAKENED'
      | 'NOT_NEWER_SOURCE'
      | 'BATCH_CAPACITY'
      | 'NON_SOURCE_STALENESS';
  }[];
};
/** Historical payload stays internal. Returned data never contains text, quotes or selector recipes. */
export interface SurferMemoryRefreshDiscoverySession extends SurferDirectiveMemorySession {
  discoverActive(): Promise<{
    plan: SurferMemoryRefreshDiscoveryPlan;
    basis: SurferSourceBasisV2 | null;
    scope: SurferScope | null;
  }>;
}
export interface SurferMemoryRefreshDiscoveryPort {
  withDiscoverySession<T>(
    actor: unknown,
    apply: (session: SurferMemoryRefreshDiscoverySession) => Promise<T>,
  ): Promise<T>;
}
