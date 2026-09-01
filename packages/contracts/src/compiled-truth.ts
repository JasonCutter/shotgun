import type { KnowledgeCandidateType, RelationCandidate } from './knowledge-model.js';
import type { SecurityContext } from './types.js';
import { sha256Text, stableJson } from './document-evidence.js';

export type ProjectionTemporalState = 'CURRENT' | 'PAST' | 'FUTURE' | 'CONFLICT';
export type ProjectionBuildMode = 'FULL_REBUILD' | 'INCREMENTAL';

export type CompiledTruthItem = {
  readonly id: string;
  readonly type: 'CLAIM' | KnowledgeCandidateType;
  /** Present for approved Knowledge Model candidates so downstream Discovery
   * can bind a resource to the exact approved Relation revision. */
  readonly revisionNumber?: number;
  readonly sourceVersionId?: string;
  readonly label: string;
  readonly state: ProjectionTemporalState;
  readonly source: 'CANONICAL_CLAIM' | 'APPROVED_KNOWLEDGE';
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
};

export type CompiledTruthEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relationType: string;
  readonly direction: RelationCandidate['direction'];
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly source: 'APPROVED_TYPED_EDGE' | 'CANONICAL_RELATION';
};

export type CompiledTruthGraph = {
  readonly nodes: readonly CompiledTruthItem[];
  readonly edges: readonly CompiledTruthEdge[];
  readonly fallback: { readonly available: true; readonly modes: readonly ['LIST', 'TABLE'] };
};

export type CompiledTruthProjection = {
  readonly projectId: string;
  readonly projectorVersion: string;
  readonly sourceSnapshotDigest: string;
  readonly logicalDigest: string;
  readonly canonicalVersion: number;
  readonly items: readonly CompiledTruthItem[];
  readonly graph: CompiledTruthGraph;
  readonly projectedAt: string;
  readonly buildMode: ProjectionBuildMode;
};

export type CompiledTruthProjectionStatus = {
  readonly status: 'NOT_BUILT' | 'READY' | 'STALE' | 'DEGRADED';
  readonly projectorVersion: string;
  readonly canonicalVersion: number;
  readonly projectedCanonicalVersion: number;
  readonly lag: number;
  readonly sourceSnapshotDigest?: string;
  readonly logicalDigest?: string;
  readonly lastBuildMode?: ProjectionBuildMode;
  readonly updatedAt?: string;
  readonly lastError?: string;
};

export type DerivedInferenceCandidate = {
  readonly candidateId: string;
  readonly fingerprint: string;
  readonly status: 'DERIVED_INFERENCE';
  readonly candidateType: 'KNOWLEDGE_GAP';
  readonly question: string;
  readonly relatedNodeIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly sourceProjectionDigest: string;
  readonly reentryPhase: 'VALIDATION';
  readonly createdAt: string;
};

export type DiscoveryRunResult = {
  readonly mode: 'INCREMENTAL' | 'WEEKLY';
  readonly scannedNodes: number;
  readonly generated: readonly DerivedInferenceCandidate[];
  readonly suppressedFingerprints: readonly string[];
  readonly budget: { readonly maxNodes: number; readonly maxSuggestions: number };
};

export const compiledTruthLogicalDigest = (
  items: readonly CompiledTruthItem[],
  edges: readonly CompiledTruthEdge[],
): string => sha256Text(stableJson({ items, edges }));

export const discoveryFingerprint = (relatedNodeIds: readonly string[], question: string): string =>
  sha256Text(
    stableJson({
      relatedNodeIds: [...relatedNodeIds].sort(),
      question: question.trim(),
    }),
  );
