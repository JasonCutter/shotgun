import {
  assertAnalysisStateTransitionV2,
  sha256Text,
  stableJson,
  validateAnalysisRevisionV2,
  validateComparisonChildrenV2,
  type AnalysisLifecycleStateV2,
  type AnalysisRevisionV2,
  type ComparisonResultV2,
  type ComparisonSafeFailureCodeV2,
  type SemanticRelationshipV2,
} from '../../../packages/contracts/src/index.js';

/**
 * The WP2 aggregate is deliberately separate from the historical v1
 * ComparisonRepositoryPort.  The adapter owns the database representation;
 * callers only exchange the already-frozen v2 contract objects.
 */
export type ComparisonV2Aggregate = {
  readonly comparison: ComparisonResultV2;
  readonly relationships: readonly SemanticRelationshipV2[];
  readonly analyses: readonly AnalysisRevisionV2[];
};

export type ComparisonV2StorageIdentity =
  | {
      readonly mode: 'SEMANTIC';
      readonly projectId: string;
      readonly candidateId: string;
      readonly candidateRevision: number;
      readonly candidateDigest: string;
      readonly canonicalSnapshotDigest: string;
      readonly analysisInputSetDigest: string;
    }
  | {
      readonly mode: 'DETERMINISTIC_EXACT';
      readonly projectId: string;
      readonly candidateId: string;
      readonly candidateRevision: number;
      readonly candidateDigest: string;
      readonly canonicalSnapshotDigest: string;
      readonly exactDuplicateClaimId: string;
      readonly exactDuplicateClaimRevision: number;
    };

export type AnalysisRevisionTransitionV2 = {
  readonly projectId: string;
  readonly analysisRevisionId: string;
  readonly expectedState: AnalysisLifecycleStateV2;
  readonly nextState: AnalysisLifecycleStateV2;
  readonly updates?: Readonly<{
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly durationMs?: number;
    readonly outputDigest?: string;
    readonly materialDigest?: string;
    readonly safeFailureCode?: ComparisonSafeFailureCodeV2;
  }>;
};

export type ComparisonV2RepositoryPort = {
  saveAnalysisRevision(input: {
    readonly projectId: string;
    readonly revision: AnalysisRevisionV2;
  }): Promise<AnalysisRevisionV2>;
  transitionAnalysisRevision(transition: AnalysisRevisionTransitionV2): Promise<AnalysisRevisionV2>;
  findAnalysisRevision(
    projectId: string,
    analysisRevisionId: string,
  ): Promise<AnalysisRevisionV2 | undefined>;
  findAnalysisRevisionByInput(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly candidateRevision: number;
    readonly canonicalSnapshotDigest: string;
    readonly inputDigest: string;
    readonly attempt: number;
  }): Promise<AnalysisRevisionV2 | undefined>;
  saveCompletedAggregate(aggregate: ComparisonV2Aggregate): Promise<ComparisonV2Aggregate>;
  findComparisonById(
    projectId: string,
    comparisonId: string,
  ): Promise<ComparisonV2Aggregate | undefined>;
  findComparisonByIdentity(
    identity: ComparisonV2StorageIdentity,
  ): Promise<ComparisonV2Aggregate | undefined>;
};

export const analysisInputSetDigestV2 = (
  analyses: readonly Pick<AnalysisRevisionV2, 'inputDigest'>[],
): string =>
  sha256Text(
    stableJson(
      analyses
        .map((analysis) => analysis.inputDigest)
        .sort((left, right) => left.localeCompare(right)),
    ),
  );

export const comparisonV2StorageIdentity = (
  aggregate: ComparisonV2Aggregate,
): ComparisonV2StorageIdentity => {
  const { comparison } = aggregate;
  const common = {
    projectId: comparison.projectId,
    candidateId: comparison.candidate.id,
    candidateRevision: comparison.candidate.revision,
    candidateDigest: comparison.candidate.digest,
    canonicalSnapshotDigest: comparison.canonicalSnapshot.digest,
  } as const;
  if (comparison.disposition === 'EXACT_DUPLICATE') {
    const target = comparison.exactDuplicateTarget;
    if (!target) throw new Error('EXACT_DUPLICATE requires an exact target.');
    return {
      ...common,
      mode: 'DETERMINISTIC_EXACT',
      exactDuplicateClaimId: target.resourceId,
      exactDuplicateClaimRevision: target.resourceRevision,
    };
  }
  return {
    ...common,
    mode: 'SEMANTIC',
    analysisInputSetDigest: analysisInputSetDigestV2(aggregate.analyses),
  };
};

/**
 * Generated comparison/child IDs are transport identities, not persistence
 * identity.  This normalized digest lets a replay with a fresh generated ID
 * converge while still detecting a change to authoritative material.
 */
export const comparisonV2AggregateContentDigest = (aggregate: ComparisonV2Aggregate): string => {
  const normalizeAnalysis = (analysis: AnalysisRevisionV2) => ({
    ...analysis,
    analysisRevisionId: undefined,
    comparisonId: undefined,
    candidate: {
      ...analysis.candidate,
      evidenceIds: [...analysis.candidate.evidenceIds].sort(),
    },
    comparedResourceIdentities: [...analysis.comparedResourceIdentities].sort((left, right) =>
      `${left.resourceType}:${left.resourceId}:${left.resourceRevision}`.localeCompare(
        `${right.resourceType}:${right.resourceId}:${right.resourceRevision}`,
      ),
    ),
  });
  const analysisFingerprints = new Map(
    aggregate.analyses.map((analysis) => [
      analysis.analysisRevisionId,
      stableJson(normalizeAnalysis(analysis)),
    ]),
  );
  const normalizedAnalyses = aggregate.analyses
    .map(normalizeAnalysis)
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  const normalizedRelationships = aggregate.relationships
    .map((relationship) => ({
      ...relationship,
      relationshipId: undefined,
      comparisonId: undefined,
      candidateEvidenceIds: [...relationship.candidateEvidenceIds].sort(),
      accessScope: [...relationship.accessScope].sort(),
      analysisRevisionId: analysisFingerprints.get(relationship.analysisRevisionId),
    }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return sha256Text(
    stableJson({
      comparison: {
        ...aggregate.comparison,
        comparisonId: undefined,
        candidate: {
          ...aggregate.comparison.candidate,
          evidenceIds: [...aggregate.comparison.candidate.evidenceIds].sort(),
        },
        accessScope: [...aggregate.comparison.accessScope].sort(),
        shortlist: aggregate.comparison.shortlist
          ? {
              ...aggregate.comparison.shortlist,
              selectedTargetIdentities: [
                ...aggregate.comparison.shortlist.selectedTargetIdentities,
              ].sort((left, right) =>
                `${left.resourceType}:${left.resourceId}:${left.resourceRevision}`.localeCompare(
                  `${right.resourceType}:${right.resourceId}:${right.resourceRevision}`,
                ),
              ),
            }
          : undefined,
        analysisRevisionIds: normalizedAnalyses,
        relationshipIds: normalizedRelationships,
      },
      analyses: normalizedAnalyses,
      relationships: normalizedRelationships,
    }),
  );
};

export const validateComparisonV2Aggregate = (aggregate: ComparisonV2Aggregate): void => {
  validateComparisonChildrenV2(aggregate.comparison, aggregate.relationships, aggregate.analyses);
  for (const analysis of aggregate.analyses) validateAnalysisRevisionV2(analysis);
};

export const assertAnalysisTransitionV2 = (
  from: AnalysisLifecycleStateV2,
  to: AnalysisLifecycleStateV2,
): void => {
  assertAnalysisStateTransitionV2(from, to);
};
