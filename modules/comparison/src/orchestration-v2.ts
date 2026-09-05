import { randomUUID } from 'node:crypto';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  assertComparisonEventV2,
  claimCandidateDigest,
  createExactDuplicateComparisonResultV2,
  deriveAuthorizedSensitivities,
  validateAnalysisRevisionV2,
  type Actor,
  type AnalysisRevisionV2,
  type ClaimCandidate,
  type ComparisonCandidateV2,
  type ComparisonCompletedV2,
  type ComparisonFailedV2,
  type ComparisonIncompleteV2,
  type ComparisonResultV2,
  type SecurityContext,
  type SemanticRelationshipV2,
  type SemanticRelationshipTypeV2,
} from '../../../packages/contracts/src/index.js';
import {
  type ComparisonV2Aggregate,
  type ComparisonV2RepositoryPort,
  validateComparisonV2Aggregate,
} from './persistence-v2.js';
import {
  type ComparisonShortlistV2Outcome,
  type ComparisonShortlistV2Port,
} from './shortlist-v2.js';
import {
  type ComparisonSemanticAnalysisV2Outcome,
  type ComparisonSemanticAnalysisV2Port,
} from './semantic-analysis-v2.js';

/**
 * The Candidate owner remains outside Comparison.  This structural port is
 * intentionally smaller than the v1 module API so orchestration cannot reach
 * through another module's runtime or persistence implementation.
 */
export type ComparisonCandidateV2ResolverPort = {
  findById(projectId: string, candidateId: string): Promise<ClaimCandidate | undefined>;
};

export type ComparisonV2TerminalEvent =
  ComparisonCompletedV2 | ComparisonIncompleteV2 | ComparisonFailedV2;

export type ComparisonV2EventPublisherPort = {
  publish(event: ComparisonV2TerminalEvent): Promise<void>;
};

export type ComparisonV2OrchestrationRequest = {
  readonly projectId: string;
  readonly candidateId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly k: number;
  readonly attempt: number;
};

export type ComparisonV2OrchestratorDependencies = {
  readonly candidate: ComparisonCandidateV2ResolverPort;
  readonly shortlist: ComparisonShortlistV2Port;
  readonly semanticAnalysis: ComparisonSemanticAnalysisV2Port;
  readonly repository: ComparisonV2RepositoryPort;
  readonly events?: ComparisonV2EventPublisherPort;
  readonly now?: () => string;
  readonly randomId?: () => string;
};

export type ComparisonV2OrchestrationBlockedReason =
  | 'INVALID_REQUEST'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_NOT_READY'
  | 'CANDIDATE_INTEGRITY'
  | 'CANDIDATE_ACCESS_DENIED'
  | 'CANDIDATE_RESOLUTION_FAILED'
  | 'SHORTLIST_BLOCKED'
  | 'SEMANTIC_BLOCKED'
  | 'CONTRACT_FAILURE';

export type ComparisonV2OrchestrationOutcome =
  | {
      readonly status: 'COMPLETED';
      readonly aggregate: ComparisonV2Aggregate;
      readonly event: ComparisonCompletedV2;
    }
  | {
      readonly status: 'INCOMPLETE';
      readonly analysis: AnalysisRevisionV2;
      readonly event: ComparisonIncompleteV2;
    }
  | {
      readonly status: 'FAILED';
      readonly analysis: AnalysisRevisionV2;
      readonly event: ComparisonFailedV2;
    }
  | {
      readonly status: 'BLOCKED';
      readonly reason: ComparisonV2OrchestrationBlockedReason;
      readonly detail?: string;
    };

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isRequestValid = (request: ComparisonV2OrchestrationRequest): boolean =>
  isNonEmpty(request.projectId) &&
  isNonEmpty(request.candidateId) &&
  isNonEmpty(request.actor.id) &&
  request.security.accessScope.length > 0 &&
  isNonEmpty(request.security.dataClassification) &&
  Number.isSafeInteger(request.k) &&
  request.k >= 1 &&
  Number.isSafeInteger(request.attempt) &&
  request.attempt >= 1;

const candidateToV2 = (candidate: ClaimCandidate): ComparisonCandidateV2 => ({
  id: candidate.candidateId,
  revision: candidate.revisionNumber,
  digest: claimCandidateDigest(candidate),
  sourceVersionId: candidate.sourceVersionId,
  evidenceIds: [...candidate.evidenceIds],
});

const hasCandidateAccess = (candidate: ClaimCandidate, security: SecurityContext): boolean => {
  const allowedSensitivities = deriveAuthorizedSensitivities(security.sensitivity);
  return (
    candidate.accessScope.length > 0 &&
    candidate.accessScope.every((scope) => security.accessScope.includes(scope)) &&
    allowedSensitivities.includes(candidate.sensitivity)
  );
};

const shortlistFailureDetail = (
  outcome: Extract<ComparisonShortlistV2Outcome, { status: 'BLOCKED' }>,
): string => `${outcome.reason}:${JSON.stringify(outcome.readiness)}`;

const semanticFailureDetail = (
  outcome: Extract<ComparisonSemanticAnalysisV2Outcome, { status: 'BLOCKED' }>,
): string => `${outcome.reason}:${outcome.safeFailureCode}`;

const isAmbiguousOrConflictOnly = (relationships: readonly SemanticRelationshipV2[]): boolean =>
  relationships.length > 0 &&
  relationships.every((relationship) =>
    (['AMBIGUOUS', 'CONTRADICTS'] as readonly SemanticRelationshipTypeV2[]).includes(
      relationship.type,
    ),
  );

const publish = async (
  publisher: ComparisonV2EventPublisherPort | undefined,
  event: ComparisonV2TerminalEvent,
): Promise<void> => {
  assertComparisonEventV2(event);
  if (publisher) await publisher.publish(event);
};

const failedEvent = (
  analysis: AnalysisRevisionV2,
  emittedAt: string,
): ComparisonIncompleteV2 | ComparisonFailedV2 => {
  const safeFailureCode = analysis.safeFailureCode;
  if (!safeFailureCode) throw new Error('Terminal AnalysisRevision must carry safeFailureCode.');
  if (analysis.state === 'SEMANTIC_UNAVAILABLE' || analysis.state === 'POLICY_BLOCKED') {
    return {
      eventType: 'ComparisonIncompleteV2',
      contractVersion: COMPARISON_V2_CONTRACT_VERSION,
      comparisonId: analysis.comparisonId,
      state: analysis.state,
      analysisRevisionId: analysis.analysisRevisionId,
      safeFailureCode,
      emittedAt,
    } satisfies ComparisonIncompleteV2;
  }
  if (analysis.state !== 'FAILED_RETRYABLE' && analysis.state !== 'FAILED_TERMINAL') {
    throw new Error(`Unexpected terminal analysis state: ${analysis.state}`);
  }
  return {
    eventType: 'ComparisonFailedV2',
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    comparisonId: analysis.comparisonId,
    state: analysis.state,
    analysisRevisionId: analysis.analysisRevisionId,
    safeFailureCode,
    emittedAt,
  } satisfies ComparisonFailedV2;
};

const buildSemanticComparison = (input: {
  readonly comparisonId: string;
  readonly request: ComparisonV2OrchestrationRequest;
  readonly candidate: ComparisonCandidateV2;
  readonly shortlist: Extract<ComparisonShortlistV2Outcome, { status: 'READY' }>;
  readonly analysis: Extract<ComparisonSemanticAnalysisV2Outcome, { status: 'COMPLETED' }>;
  readonly createdAt: string;
}): ComparisonV2Aggregate => {
  const { analysis, relationships } = input.analysis;
  if (analysis.shortlistDigest !== input.shortlist.shortlistDigest) {
    throw new Error('Semantic analysis shortlist identity does not match WP3 output.');
  }
  const selected = new Set(
    input.shortlist.shortlist.selectedTargetIdentities.map(
      (target) => `${target.resourceType}:${target.resourceId}:${target.resourceRevision}`,
    ),
  );
  const relationshipTargets = new Set(
    relationships.map(
      (relationship) =>
        `${relationship.comparedResource.resourceType}:${relationship.comparedResource.resourceId}:${relationship.comparedResource.resourceRevision}`,
    ),
  );
  if (
    relationshipTargets.size !== selected.size ||
    [...selected].some((identity) => !relationshipTargets.has(identity))
  ) {
    throw new Error('Semantic analysis did not cover every shortlisted Claim.');
  }

  const allUnrelated = relationships.every((relationship) => relationship.type === 'UNRELATED');
  const reviewRecommendation = allUnrelated
    ? 'ADD_CLAIM'
    : isAmbiguousOrConflictOnly(relationships)
      ? 'HOLD'
      : 'MODIFY_REVIEW';
  const comparison: ComparisonResultV2 = {
    comparisonId: input.comparisonId,
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    projectId: input.request.projectId,
    candidate: input.candidate,
    canonicalSnapshot: input.shortlist.shortlist.canonicalSnapshot,
    disposition: allUnrelated ? 'NEW' : 'REVIEW_REQUIRED',
    reviewRecommendation,
    shortlist: input.shortlist.shortlist,
    analysisRevisionIds: [analysis.analysisRevisionId],
    relationshipIds: relationships.map((relationship) => relationship.relationshipId),
    accessScope: [...input.request.security.accessScope].sort(),
    sensitivity: input.request.security.sensitivity,
    createdAt: input.createdAt,
  };
  const aggregate: ComparisonV2Aggregate = { comparison, analyses: [analysis], relationships };
  validateComparisonV2Aggregate(aggregate);
  return aggregate;
};

export const createComparisonV2Orchestrator = (
  dependencies: ComparisonV2OrchestratorDependencies,
) => {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const nextId = dependencies.randomId ?? randomUUID;

  return {
    async compare(
      request: ComparisonV2OrchestrationRequest,
    ): Promise<ComparisonV2OrchestrationOutcome> {
      if (!isRequestValid(request)) return { status: 'BLOCKED', reason: 'INVALID_REQUEST' };

      let candidate: ClaimCandidate | undefined;
      try {
        candidate = await dependencies.candidate.findById(request.projectId, request.candidateId);
      } catch {
        return { status: 'BLOCKED', reason: 'CANDIDATE_RESOLUTION_FAILED' };
      }
      if (!candidate) return { status: 'BLOCKED', reason: 'CANDIDATE_NOT_FOUND' };
      if (
        candidate.projectId !== request.projectId ||
        candidate.candidateId !== request.candidateId ||
        candidate.revisionNumber !== 1 ||
        candidate.status !== 'READY' ||
        !isNonEmpty(candidate.claimText)
      ) {
        return { status: 'BLOCKED', reason: 'CANDIDATE_NOT_READY' };
      }
      if (!hasCandidateAccess(candidate, request.security)) {
        return { status: 'BLOCKED', reason: 'CANDIDATE_ACCESS_DENIED' };
      }

      let candidateV2: ComparisonCandidateV2;
      try {
        candidateV2 = candidateToV2(candidate);
        if (
          candidateV2.digest !==
          claimCandidateDigest({
            candidateId: candidate.candidateId,
            revisionNumber: candidate.revisionNumber,
            sourceVersionId: candidate.sourceVersionId,
            claimText: candidate.claimText,
            evidenceIds: candidate.evidenceIds,
            status: candidate.status,
          })
        ) {
          return { status: 'BLOCKED', reason: 'CANDIDATE_INTEGRITY' };
        }
      } catch {
        return { status: 'BLOCKED', reason: 'CANDIDATE_INTEGRITY' };
      }

      let shortlist: ComparisonShortlistV2Outcome;
      try {
        shortlist = await dependencies.shortlist.build({
          projectId: request.projectId,
          candidate: {
            candidateId: candidate.candidateId,
            projectId: candidate.projectId,
            claimText: candidate.claimText,
          },
          actor: request.actor,
          security: request.security,
          k: request.k,
        });
      } catch {
        return { status: 'BLOCKED', reason: 'SHORTLIST_BLOCKED' };
      }
      if (shortlist.status === 'BLOCKED') {
        return {
          status: 'BLOCKED',
          reason: 'SHORTLIST_BLOCKED',
          detail: shortlistFailureDetail(shortlist),
        };
      }

      const comparisonId = nextId();
      const createdAt = now();
      if (shortlist.status === 'EXACT_DUPLICATE') {
        const comparison = createExactDuplicateComparisonResultV2({
          comparisonId,
          projectId: request.projectId,
          candidate: candidateV2,
          canonicalSnapshot: shortlist.exactDuplicateTarget.canonicalSnapshot,
          exactDuplicateTarget: shortlist.exactDuplicateTarget,
          accessScope: [...request.security.accessScope].sort(),
          sensitivity: request.security.sensitivity,
          createdAt,
        });
        const aggregate: ComparisonV2Aggregate = { comparison, analyses: [], relationships: [] };
        validateComparisonV2Aggregate(aggregate);
        const stored = await dependencies.repository.saveCompletedAggregate(aggregate);
        validateComparisonV2Aggregate(stored);
        const event: ComparisonCompletedV2 = {
          eventType: 'ComparisonCompletedV2',
          contractVersion: COMPARISON_V2_CONTRACT_VERSION,
          comparison: stored.comparison,
          analysisRevisionIds: [...stored.comparison.analysisRevisionIds],
          emittedAt: now(),
        };
        await publish(dependencies.events, event);
        return { status: 'COMPLETED', aggregate: stored, event };
      }

      let semantic: ComparisonSemanticAnalysisV2Outcome;
      try {
        semantic = await dependencies.semanticAnalysis.analyze({
          projectId: request.projectId,
          comparisonId,
          candidate: candidateV2,
          candidateText: candidate.claimText,
          shortlist: shortlist.shortlist,
          shortlistDigest: shortlist.shortlistDigest,
          actor: request.actor,
          security: request.security,
          attempt: request.attempt,
        });
      } catch {
        return { status: 'BLOCKED', reason: 'SEMANTIC_BLOCKED' };
      }
      if (semantic.status === 'BLOCKED') {
        return {
          status: 'BLOCKED',
          reason: 'SEMANTIC_BLOCKED',
          detail: semanticFailureDetail(semantic),
        };
      }
      if (semantic.status === 'FAILED') {
        const stored = await dependencies.repository.saveAnalysisRevision({
          projectId: request.projectId,
          revision: semantic.analysis,
        });
        validateAnalysisRevisionV2(stored);
        const event = failedEvent(stored, now());
        await publish(dependencies.events, event);
        if (event.eventType === 'ComparisonIncompleteV2') {
          return { status: 'INCOMPLETE', analysis: stored, event };
        }
        return { status: 'FAILED', analysis: stored, event };
      }

      let aggregate: ComparisonV2Aggregate;
      try {
        aggregate = buildSemanticComparison({
          comparisonId,
          request,
          candidate: candidateV2,
          shortlist,
          analysis: semantic,
          createdAt,
        });
      } catch {
        return {
          status: 'BLOCKED',
          reason: 'CONTRACT_FAILURE',
          detail: 'semantic aggregate validation failed',
        };
      }
      const stored = await dependencies.repository.saveCompletedAggregate(aggregate);
      validateComparisonV2Aggregate(stored);
      const event: ComparisonCompletedV2 = {
        eventType: 'ComparisonCompletedV2',
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparison: stored.comparison,
        analysisRevisionIds: [...stored.comparison.analysisRevisionIds],
        emittedAt: now(),
      };
      await publish(dependencies.events, event);
      return { status: 'COMPLETED', aggregate: stored, event };
    },
  };
};

export type ComparisonV2OrchestratorPort = ReturnType<typeof createComparisonV2Orchestrator>;
