import type { CanonicalSearchMatch, ProjectionReadiness } from './cited-search.js';
import type { SourceSelector, TextPositionSelector } from './document-evidence.js';
import type { SemanticCandidateResult, SemanticProjectionGeneration } from './semantic-index.js';
import type { SemanticResourceInput, SemanticResourceType } from './semantic-representation.js';

export const HYBRID_FUSION_POLICY_RRF_V1 = 'rrf:v1' as const;
export const HYBRID_FUSION_DEFAULT_RRF_K = 60 as const;
export const HYBRID_SEARCH_DEFAULT_LIMIT = 10 as const;
export const HYBRID_SEARCH_MAX_LIMIT = 100 as const;

export type SemanticActiveGenerationReaderPort = {
  getActiveGeneration(projectId: string): Promise<SemanticProjectionGeneration | undefined>;
};

export type SemanticRetrieverInput = {
  readonly projectId: string;
  readonly query: string;
  readonly accessScopes: readonly string[];
  readonly allowedSensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[];
  readonly limit?: number;
};

export type SemanticRetrieverPort = {
  retrieve(input: SemanticRetrieverInput): Promise<readonly SemanticCandidateResult[]>;
};

export type LexicalRetrieverInput = {
  readonly projectId: string;
  readonly query: string;
  readonly accessScopes: readonly string[];
  readonly limit?: number;
};

export type LexicalCandidateResult = {
  readonly claimId: string;
  readonly commitId: string;
  readonly revisionId: string;
  readonly canonicalVersion: number;
  readonly claimText: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly score: number;
  readonly matchType: CanonicalSearchMatch;
  readonly rank: number;
};

export type LexicalRetrieverPort = {
  retrieve(input: LexicalRetrieverInput): Promise<{
    readonly items: readonly LexicalCandidateResult[];
    readonly readiness: ProjectionReadiness;
  }>;
};

export type KnowledgeResourceContent = {
  readonly text: string;
  readonly canonicalVersion?: number;
  readonly evidenceIds?: readonly string[];
  readonly sourceVersionId?: string;
  readonly accessScope?: readonly string[];
  readonly sensitivity?: 'public' | 'internal' | 'private' | 'restricted';
};

export type KnowledgeResourceResolverPort = {
  resolveResource(
    projectId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<KnowledgeResourceContent | undefined>;
};

export type SourceVersionInfo = {
  readonly sourceVersionId: string;
  readonly projectId: string;
  readonly sourceId: string;
};

export type SourceVersionResolverPort = {
  getSourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<SourceVersionInfo | undefined>;
};

export type HybridFusionSignal = 'LEXICAL' | 'SEMANTIC' | 'HYBRID';

export type HybridCitation = {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly exactQuote: string;
  readonly pointer?: string;
  readonly position?: TextPositionSelector;
  readonly selectors?: readonly SourceSelector[];
};

export type HybridCandidateResult = {
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly text: string;
  readonly canonicalVersion: number;
  readonly evidenceIds: readonly string[];
  readonly citations: readonly HybridCitation[];
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly signals: readonly HybridFusionSignal[];
  readonly lexicalRank?: number;
  readonly lexicalScore?: number;
  readonly lexicalMatchType?: CanonicalSearchMatch;
  readonly semanticRank?: number;
  readonly fusionRank: number;
  readonly fusionScore: number;
};

export type HybridFusionPolicy = {
  readonly version: typeof HYBRID_FUSION_POLICY_RRF_V1;
  readonly k: number;
  readonly lexicalWeight?: number;
  readonly semanticWeight?: number;
};

export type SemanticReadinessStatus =
  'BUILDING' | 'READY' | 'STALE' | 'FAILED' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export type SemanticReadiness = {
  readonly status: SemanticReadinessStatus;
  readonly activeGenerationId?: string;
  readonly embeddingProfileId?: string;
  readonly dimension?: number;
  readonly reason?: string;
  readonly updatedAt?: string;
};

export type SemanticCorpusItem = {
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly canonicalVersion: number;
  readonly representationInput: SemanticResourceInput;
  readonly semanticText: string;
  readonly semanticTextDigest: string;
  readonly representationVersion: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly sourceVersionId?: string;
};

export type SemanticCorpusSnapshot = {
  readonly projectId: string;
  readonly canonicalBaseVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly sourceProjectionDigest: string;
  readonly corpusDigest: string;
  readonly items: readonly SemanticCorpusItem[];
  readonly totalItems: number;
};

export type SemanticCorpusReaderPort = {
  readCorpus(projectId: string): Promise<SemanticCorpusSnapshot>;
};

export type BuildGenerationInput = {
  readonly projectId: string;
  readonly mode?: 'FULL' | 'INCREMENTAL';
  readonly autoActivate?: boolean;
};

export type BuildGenerationResult = {
  readonly generation: SemanticProjectionGeneration;
  readonly totalItemsCount: number;
  readonly reusedCount: number;
  readonly newlyEmbeddedCount: number;
  readonly membershipFingerprint: string;
  readonly activated: boolean;
};

export type SemanticProjectionRebuilderPort = {
  buildGeneration(input: BuildGenerationInput): Promise<BuildGenerationResult>;
  getReadiness(projectId: string): Promise<SemanticReadiness>;
};

export type HybridSearchReadiness = {
  readonly lexical: ProjectionReadiness;
  readonly semantic: SemanticReadiness;
  readonly degraded: boolean;
  readonly degradedReason?: string;
};

export type HybridSearchRequest = {
  readonly query: string;
  readonly limit?: number;
};

export type HybridSearchResponse = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly query: string;
  readonly items: readonly HybridCandidateResult[];
  readonly fusionPolicy: HybridFusionPolicy;
  readonly readiness: HybridSearchReadiness;
  readonly generatedAt: string;
};

export type HybridRetrievalInput = {
  readonly projectId: string;
  readonly query: string;
  readonly accessScopes: readonly string[];
  readonly allowedSensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[];
  readonly limit?: number;
};

export type HybridRetrievalCoordinatorPort = {
  search(input: HybridRetrievalInput): Promise<HybridSearchResponse>;
};

export const deriveAuthorizedSensitivities = (
  clearance: 'public' | 'internal' | 'private' | 'restricted',
): readonly ('public' | 'internal' | 'private' | 'restricted')[] => {
  switch (clearance) {
    case 'public':
      return ['public'] as const;
    case 'internal':
      return ['public', 'internal'] as const;
    case 'private':
      return ['public', 'internal', 'private'] as const;
    case 'restricted':
      return ['public', 'internal', 'private', 'restricted'] as const;
  }
};
