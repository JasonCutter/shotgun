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
  sha256Text,
  stableJson,
} from '../../../packages/contracts/src/index.js';
import {
  type ComparisonV2Aggregate,
  type ComparisonV2BlockedPhase,
  type ComparisonV2RepositoryPort,
  analysisInputSetDigestV2,
  comparisonV2StorageIdentity,
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
  /** Internal server authority; never accepted from the Product payload. */
  readonly executionTrigger?: ComparisonV2ExecutionTrigger;
  /** Initial internal value retained for source compatibility. */
  readonly attempt: number;
};

export type ComparisonV2ExecutionTrigger = 'INITIAL_OR_EVENT_REPLAY' | 'EXPLICIT_OPERATOR_REENTRY';

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

const isEmptyCanonicalBootstrapShortlist = (
  shortlist: Extract<ComparisonShortlistV2Outcome, { status: 'READY' }>,
): boolean =>
  shortlist.shortlist.selectedTargetIdentities.length === 0 &&
  shortlist.shortlist.coverageStatus === 'COMPLETE' &&
  shortlist.shortlist.querySemanticReadiness === 'READY' &&
  !shortlist.shortlist.truncated &&
  Object.values(shortlist.shortlist.exclusionCounts).every((count) => count === 0);

const isAmbiguousOrConflictOnly = (relationships: readonly SemanticRelationshipV2[]): boolean =>
  relationships.length > 0 &&
  relationships.every((relationship) =>
    (['AMBIGUOUS', 'CONTRADICTS'] as readonly SemanticRelationshipTypeV2[]).includes(
      relationship.type,
    ),
  );

const attentionBlockedReason = (reason: string, detail?: string): boolean => {
  if (reason === 'CANDIDATE_RESOLUTION_FAILED') return true;
  if (reason === 'SHORTLIST_BLOCKED') {
    return !detail?.match(
      /INVALID_REQUEST|POLICY_DENIED|POLICY_INTEGRITY|SNAPSHOT_INTEGRITY|CONTRACT_INVALID/,
    );
  }
  if (reason === 'SEMANTIC_BLOCKED') {
    return !detail?.match(
      /INVALID_REQUEST|POLICY_BLOCKED|SHORTLIST_INTEGRITY|SNAPSHOT_MISMATCH|RESOURCE_SCOPE_LEAK|RESOURCE_NOT_FOUND|RESOURCE_REVISION_MISMATCH|RESOURCE_ACCESS_REVOKED/,
    );
  }
  return reason === 'CONTRACT_FAILURE';
};

const blockedPhaseFor = (
  reason: ComparisonV2OrchestrationBlockedReason,
): ComparisonV2BlockedPhase => {
  switch (reason) {
    case 'CANDIDATE_RESOLUTION_FAILED':
      return 'CANDIDATE_RESOLUTION';
    case 'SHORTLIST_BLOCKED':
      return 'SHORTLIST';
    case 'SEMANTIC_BLOCKED':
      return 'SEMANTIC_ANALYSIS';
    case 'CONTRACT_FAILURE':
      return 'CONTRACT';
    default:
      return 'CANDIDATE_RESOLUTION';
  }
};

const publish = async (
  publisher: ComparisonV2EventPublisherPort | undefined,
  event: ComparisonV2TerminalEvent,
): Promise<void> => {
  assertComparisonEventV2(event);
  if (publisher) await publisher.publish(event);
};

const saveOrReuseCompletedAggregate = async (
  repository: ComparisonV2RepositoryPort,
  aggregate: ComparisonV2Aggregate,
): Promise<ComparisonV2Aggregate> => {
  const identity = comparisonV2StorageIdentity(aggregate);
  // Keep partial contract/test compositions source-compatible while all
  // production adapters expose the identity lookup. A missing lookup simply
  // falls through to the adapter's existing uniqueness guard.
  const existing =
    typeof repository.findComparisonByIdentity === 'function'
      ? await repository.findComparisonByIdentity(identity)
      : undefined;
  if (existing) {
    validateComparisonV2Aggregate(existing);
    return existing;
  }
  const stored = await repository.saveCompletedAggregate(aggregate);
  validateComparisonV2Aggregate(stored);
  return stored;
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

const existingFailedOutcome = (
  analysis: AnalysisRevisionV2,
  emittedAt: string,
): Extract<ComparisonV2OrchestrationOutcome, { status: 'INCOMPLETE' | 'FAILED' }> => {
  const event = failedEvent(analysis, emittedAt);
  if (event.eventType === 'ComparisonIncompleteV2') {
    return { status: 'INCOMPLETE', analysis, event };
  }
  return { status: 'FAILED', analysis, event };
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

  const persistBlocked = async (input: {
    readonly request: ComparisonV2OrchestrationRequest;
    readonly candidate?: ComparisonCandidateV2;
    readonly reason: ComparisonV2OrchestrationBlockedReason;
    readonly phase?: ComparisonV2BlockedPhase;
    readonly detail?: string;
  }): Promise<void> => {
    if (!attentionBlockedReason(input.reason, input.detail)) return;
    const repository = dependencies.repository.blockedOutcomes;
    if (!repository) return;
    const candidateId = input.candidate?.id ?? input.request.candidateId;
    const candidateRevision = input.candidate?.revision ?? 1;
    const phase = input.phase ?? blockedPhaseFor(input.reason);
    const candidateDigest =
      input.candidate?.digest ?? sha256Text(stableJson({ candidateId, blockedPhase: phase }));
    const governingInputDigest = sha256Text(
      stableJson({
        phase,
        reason: input.reason,
        detail: input.detail ?? null,
        attempt: input.request.attempt,
      }),
    );
    await repository.recordBlockedOutcome({
      projectId: input.request.projectId,
      candidateId,
      candidateRevision,
      candidateDigest,
      blockedPhase: phase,
      reason: input.reason,
      safeCode: input.reason,
      governingInputDigest,
      accessScope: [...input.request.security.accessScope].sort(),
      sensitivity: input.request.security.sensitivity,
      observedAt: now(),
    });
  };

  const blocked = async (input: {
    readonly request: ComparisonV2OrchestrationRequest;
    readonly candidate?: ComparisonCandidateV2;
    readonly reason: ComparisonV2OrchestrationBlockedReason;
    readonly phase?: ComparisonV2BlockedPhase;
    readonly detail?: string;
  }): Promise<Extract<ComparisonV2OrchestrationOutcome, { status: 'BLOCKED' }>> => {
    await persistBlocked(input);
    return {
      status: 'BLOCKED',
      reason: input.reason,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    };
  };

  const resolveBlocked = async (input: {
    readonly request: ComparisonV2OrchestrationRequest;
    readonly candidate: ComparisonCandidateV2;
    readonly resolutionIdentity: string;
    readonly state: 'RESOLVED' | 'SUPERSEDED';
  }): Promise<void> => {
    const repository = dependencies.repository.blockedOutcomes;
    if (!repository) return;
    await repository.resolveBlockedOutcomes({
      projectId: input.request.projectId,
      candidateId: input.candidate.id,
      candidateRevision: input.candidate.revision,
      candidateDigest: input.candidate.digest,
      resolutionIdentity: input.resolutionIdentity,
      resolvedAt: now(),
      state: input.state,
    });
  };

  return {
    async compare(
      request: ComparisonV2OrchestrationRequest,
    ): Promise<ComparisonV2OrchestrationOutcome> {
      if (!isRequestValid(request)) return { status: 'BLOCKED', reason: 'INVALID_REQUEST' };

      let candidate: ClaimCandidate | undefined;
      try {
        candidate = await dependencies.candidate.findById(request.projectId, request.candidateId);
      } catch {
        // No verified Candidate revision/digest exists at this boundary.  Do
        // not fabricate an operational Attention identity from the request
        // alone; preserve the fail-closed outcome until a trusted runtime
        // event can supply the Candidate lineage.
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
        return blocked({ request, candidate: candidateV2, reason: 'SHORTLIST_BLOCKED' });
      }
      if (shortlist.status === 'BLOCKED') {
        return blocked({
          request,
          candidate: candidateV2,
          reason: 'SHORTLIST_BLOCKED',
          detail: shortlistFailureDetail(shortlist),
        });
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
        const stored = await saveOrReuseCompletedAggregate(dependencies.repository, aggregate);
        await resolveBlocked({
          request,
          candidate: candidateV2,
          resolutionIdentity: stored.comparison.comparisonId,
          state: 'RESOLVED',
        });
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

      // A READY zero-target shortlist is valid only for the empty-Canonical
      // bootstrap path established by the shortlist service.  It is a
      // completed NEW comparison, but there is no Canonical target to analyze
      // and therefore no AnalysisRevision or provider call to create.
      if (isEmptyCanonicalBootstrapShortlist(shortlist)) {
        const comparison: ComparisonResultV2 = {
          comparisonId,
          contractVersion: COMPARISON_V2_CONTRACT_VERSION,
          projectId: request.projectId,
          candidate: candidateV2,
          canonicalSnapshot: shortlist.shortlist.canonicalSnapshot,
          disposition: 'NEW',
          reviewRecommendation: 'ADD_CLAIM',
          shortlist: shortlist.shortlist,
          analysisRevisionIds: [],
          relationshipIds: [],
          accessScope: [...request.security.accessScope].sort(),
          sensitivity: request.security.sensitivity,
          createdAt,
        };
        const aggregate: ComparisonV2Aggregate = { comparison, analyses: [], relationships: [] };
        validateComparisonV2Aggregate(aggregate);
        const stored = await saveOrReuseCompletedAggregate(dependencies.repository, aggregate);
        await resolveBlocked({
          request,
          candidate: candidateV2,
          resolutionIdentity: stored.comparison.comparisonId,
          state: 'RESOLVED',
        });
        const event: ComparisonCompletedV2 = {
          eventType: 'ComparisonCompletedV2',
          contractVersion: COMPARISON_V2_CONTRACT_VERSION,
          comparison: stored.comparison,
          analysisRevisionIds: [],
          emittedAt: now(),
        };
        await publish(dependencies.events, event);
        return { status: 'COMPLETED', aggregate: stored, event };
      }

      // Resolve the full governed semantic identity before any provider call.
      // This is intentionally separate from transport idempotency: a replay
      // with a different command key must converge on the completed V2
      // aggregate when Candidate, Canonical snapshot, shortlist and all
      // provider/prompt/policy inputs are unchanged.
      if (dependencies.semanticAnalysis.resolveInputIdentity) {
        let identity:
          | Awaited<
              ReturnType<NonNullable<ComparisonSemanticAnalysisV2Port['resolveInputIdentity']>>
            >
          | undefined;
        try {
          identity = await dependencies.semanticAnalysis.resolveInputIdentity({
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
          return blocked({
            request,
            candidate: candidateV2,
            reason: 'SEMANTIC_BLOCKED',
            phase: 'SEMANTIC_IDENTITY',
          });
        }
        if ('status' in identity) {
          if (identity.status === 'BLOCKED') {
            return blocked({
              request,
              candidate: candidateV2,
              reason: 'SEMANTIC_BLOCKED',
              phase: 'SEMANTIC_IDENTITY',
              detail: `${identity.reason}:${identity.safeFailureCode}`,
            });
          }
          // The pre-provider identity resolver must never produce a terminal
          // AnalysisRevision. Treat an unexpected outcome as a safe block.
          return blocked({
            request,
            candidate: candidateV2,
            reason: 'SEMANTIC_BLOCKED',
            phase: 'SEMANTIC_IDENTITY',
          });
        }
        const existing = await dependencies.repository.findComparisonByIdentity({
          mode: 'SEMANTIC',
          projectId: request.projectId,
          candidateId: candidateV2.id,
          candidateRevision: candidateV2.revision,
          candidateDigest: candidateV2.digest,
          canonicalSnapshotDigest: shortlist.shortlist.canonicalSnapshot.digest,
          analysisInputSetDigest: analysisInputSetDigestV2([{ inputDigest: identity.inputDigest }]),
        });
        if (existing) {
          validateComparisonV2Aggregate(existing);
          const event: ComparisonCompletedV2 = {
            eventType: 'ComparisonCompletedV2',
            contractVersion: COMPARISON_V2_CONTRACT_VERSION,
            comparison: existing.comparison,
            analysisRevisionIds: [...existing.comparison.analysisRevisionIds],
            emittedAt: now(),
          };
          await resolveBlocked({
            request,
            candidate: candidateV2,
            resolutionIdentity: existing.comparison.comparisonId,
            state: 'RESOLVED',
          });
          await publish(dependencies.events, event);
          return { status: 'COMPLETED', aggregate: existing, event };
        }

        // A completed aggregate is handled above.  For an incomplete history,
        // resolve the server-owned attempt from immutable AnalysisRevision
        // rows before invoking the provider.  Event/replay execution must
        // reuse a terminal failure, while the explicit Product re-entry
        // command is the only path allowed to advance FAILED_TERMINAL to the
        // next attempt.  The public Product payload remains candidateId plus
        // idempotencyKey; attempt is never client-controlled.
        let effectiveAttempt = request.attempt;
        const latest = dependencies.repository.findLatestAnalysisRevisionByInput
          ? await dependencies.repository.findLatestAnalysisRevisionByInput({
              projectId: request.projectId,
              candidateId: candidateV2.id,
              candidateRevision: candidateV2.revision,
              canonicalSnapshotDigest: shortlist.shortlist.canonicalSnapshot.digest,
              inputDigest: identity.inputDigest,
            })
          : undefined;
        if (latest) {
          // An unknown provider outcome must be reconciled by the existing
          // outcome/recovery path before any new provider execution. It is
          // never safe to treat a replay as permission to duplicate work.
          if (latest.safeFailureCode === 'OUTCOME_UNKNOWN') {
            const unknown = existingFailedOutcome(latest, now());
            await publish(dependencies.events, unknown.event);
            return unknown;
          }
          if (latest.state === 'FAILED_TERMINAL') {
            if (request.executionTrigger === 'EXPLICIT_OPERATOR_REENTRY') {
              effectiveAttempt = latest.attempt + 1;
            } else {
              const terminal = existingFailedOutcome(latest, now());
              await resolveBlocked({
                request,
                candidate: candidateV2,
                resolutionIdentity: latest.analysisRevisionId,
                state: 'SUPERSEDED',
              });
              await publish(dependencies.events, terminal.event);
              return terminal;
            }
          } else if (latest.state === 'COMPLETED') {
            return blocked({
              request,
              candidate: candidateV2,
              reason: 'CONTRACT_FAILURE',
              detail: 'Completed analysis has no aggregate.',
            });
          }
        }

        request = { ...request, attempt: effectiveAttempt };
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
        return blocked({ request, candidate: candidateV2, reason: 'SEMANTIC_BLOCKED' });
      }
      if (semantic.status === 'BLOCKED') {
        return blocked({
          request,
          candidate: candidateV2,
          reason: 'SEMANTIC_BLOCKED',
          detail: semanticFailureDetail(semantic),
        });
      }
      if (semantic.status === 'FAILED') {
        const stored = await dependencies.repository.saveAnalysisRevision({
          projectId: request.projectId,
          revision: semantic.analysis,
        });
        validateAnalysisRevisionV2(stored);
        const event = failedEvent(stored, now());
        await resolveBlocked({
          request,
          candidate: candidateV2,
          resolutionIdentity: stored.analysisRevisionId,
          state: 'SUPERSEDED',
        });
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
        return blocked({
          request,
          candidate: candidateV2,
          reason: 'CONTRACT_FAILURE',
          detail: 'semantic aggregate validation failed',
        });
      }
      const stored = await saveOrReuseCompletedAggregate(dependencies.repository, aggregate);
      await resolveBlocked({
        request,
        candidate: candidateV2,
        resolutionIdentity: stored.comparison.comparisonId,
        state: 'RESOLVED',
      });
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
