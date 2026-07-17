import type { SecurityContext } from './types.js';

export type ProjectionStatus = 'READY' | 'STALE' | 'DEGRADED';

export type ProjectionWatermark = {
  readonly projectId: string;
  readonly lastCommitId?: string;
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
  readonly status: 'READY' | 'DEGRADED';
  readonly lastError?: string;
  readonly updatedAt: string;
};

export type ProjectionReadiness = {
  readonly status: ProjectionStatus;
  readonly projectedCanonicalVersion: number;
  readonly canonicalVersion: number;
  readonly lag: number;
  readonly projectedSnapshotDigest?: string;
  readonly canonicalSnapshotDigest: string;
  readonly lastCommitId?: string;
  readonly updatedAt?: string;
  readonly reason?: string;
};

export type SearchProjectionDocument = {
  readonly projectId: string;
  readonly claimId: string;
  readonly commitId: string;
  readonly revisionId: string;
  readonly canonicalVersion: number;
  readonly claimText: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly projectedAt: string;
};

export type CanonicalSearchMatch = 'FULL_TEXT' | 'TRIGRAM' | 'SUBSTRING';

export type CanonicalSearchResult = SearchProjectionDocument & {
  readonly score: number;
  readonly matchType: CanonicalSearchMatch;
};

export type CanonicalSearchResponse = {
  readonly query: string;
  readonly items: readonly CanonicalSearchResult[];
  readonly readiness: ProjectionReadiness;
};

export type AnswerCitation = {
  readonly citationId: string;
  readonly claimId: string;
  readonly revisionId: string;
  readonly evidenceId: string;
  readonly sourceVersionId: string;
  readonly exactQuote: string;
};

export type CitedAnswerStatement = {
  readonly text: string;
  readonly certainty: 'CANONICAL';
  readonly citations: readonly AnswerCitation[];
};

export type CitedAnswer = {
  readonly status: 'ANSWERED' | 'NO_MATCH' | 'STALE_PROJECTION';
  readonly question: string;
  readonly statements: readonly CitedAnswerStatement[];
  readonly readiness: ProjectionReadiness;
  readonly uncertainty?: string;
};
