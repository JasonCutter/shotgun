import {
  assertReviewAuthorityInvariantV2,
  candidateEvidenceDigestV2,
  claimCandidateDigest,
  sha256Text,
  stableJson,
  ShotgunError,
  type Actor,
  type CanonicalSnapshot,
  type ClaimCandidate,
  type ComparisonFreshnessIdentityV2,
  type ErrorCode,
  type ComparisonRolloutStateV2,
  type ReviewAuthoritySelectionV2,
  type SecurityContext,
} from '../../../packages/contracts/src/index.js';
import type { SemanticActiveGenerationReaderPort } from '../../../packages/contracts/src/hybrid-retrieval.js';
import {
  COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
  COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
  COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
  type ComparisonCandidateV2ResolverPort,
  type ComparisonV2OrchestrationOutcome,
  type ComparisonV2OrchestrationBlockedEvidence,
  type ComparisonV2OrchestratorPort,
  type ComparisonV2ExecutionTrigger,
  comparisonLexicalProjectionBaseV2,
  comparisonLexicalProjectionWatermarkV2,
} from '../../../modules/comparison/src/index.js';
import type { LexicalRetrieverPort } from '../../../packages/contracts/src/hybrid-retrieval.js';
import {
  ComparisonV2ReviewFreshnessError,
  type ComparisonV2ReviewBridgePort,
  type ComparisonV2ReviewFreshnessPort,
} from '../../../modules/change-set-review/src/index.js';
import type { SettingsRepositoryPort } from '../../../modules/settings-policy/src/index.js';
import {
  COMPARISON_ROLLOUT_SETTING_KEY,
  isComparisonRolloutState,
} from '../../../modules/settings-policy/src/index.js';

export type ComparisonV2RuntimeBoundary = {
  handleCandidateValidated(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly candidate: ClaimCandidate;
    readonly actor: Actor;
    readonly security: SecurityContext;
    readonly correlationId?: string;
    /** Internal server authority; never accepted from Product payloads. */
    readonly executionTrigger?: ComparisonV2ExecutionTrigger;
  }): Promise<ComparisonV2RuntimeOutcome>;
  shouldRunV1(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly candidateRevision: number;
  }): Promise<boolean>;
};

export type ComparisonV2RuntimeOutcome = {
  readonly rollout: ComparisonRolloutStateV2;
  readonly authority: ReviewAuthoritySelectionV2;
  readonly authorityRevision: string;
  readonly v1Executed: boolean;
  readonly v2Outcome?: ComparisonV2OrchestrationOutcome;
  readonly review:
    | { readonly status: 'DRAFT_CREATED' }
    | { readonly status: 'BLOCKED'; readonly reason: string }
    | { readonly status: 'NOT_ATTEMPTED' };
};

export type ComparisonRolloutAuthority = {
  readonly rollout: ComparisonRolloutStateV2;
  readonly authorityRevision: string;
  readonly selection: ReviewAuthoritySelectionV2;
};

export type ComparisonRolloutAuthorityResolverPort = {
  resolve(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly candidateRevision: number;
  }): Promise<ComparisonRolloutAuthority>;
};

const rolloutAuthorityRevision = (rollout: ComparisonRolloutStateV2): string =>
  sha256Text(stableJson({ policy: 'comparison-stage5-rollout:v1', state: rollout }));

export const createComparisonRolloutAuthorityResolver = (
  settings: Pick<SettingsRepositoryPort, 'getProjectSettingValue'>,
): ComparisonRolloutAuthorityResolverPort => ({
  async resolve(input) {
    const configured = settings.getProjectSettingValue
      ? await settings.getProjectSettingValue(input.projectId, COMPARISON_ROLLOUT_SETTING_KEY)
      : undefined;
    const rollout: ComparisonRolloutStateV2 = isComparisonRolloutState(configured)
      ? configured
      : 'V1_ONLY';
    const candidates = [
      {
        projectId: input.projectId,
        candidateId: input.candidateId,
        candidateRevision: input.candidateRevision,
        contractVersion: '1.0' as const,
        reviewAuthoritative: rollout !== 'V2_ACTIVE',
      },
      {
        projectId: input.projectId,
        candidateId: input.candidateId,
        candidateRevision: input.candidateRevision,
        contractVersion: '2.0' as const,
        reviewAuthoritative: rollout === 'V2_ACTIVE',
      },
    ];
    const selection: ReviewAuthoritySelectionV2 = {
      projectId: input.projectId,
      candidateId: input.candidateId,
      candidateRevision: input.candidateRevision,
      rollout,
      candidates,
    };
    assertReviewAuthorityInvariantV2(selection);
    return {
      rollout,
      authorityRevision: rolloutAuthorityRevision(rollout),
      selection,
    };
  },
});

type FreshnessMetadata = {
  readonly providerModelCapabilityIdentity?: string;
  readonly promptTemplateRevision?: string;
  readonly outputSchemaRevision?: string;
  readonly semanticPolicyRevision?: string;
};

type FreshnessDependencies = {
  readonly candidate: ComparisonCandidateV2ResolverPort;
  readonly canonicalSnapshot: { getSnapshot(projectId: string): Promise<CanonicalSnapshot> };
  readonly lexicalRetriever: LexicalRetrieverPort;
  readonly activeGenerationReader?: SemanticActiveGenerationReaderPort;
  readonly rollout: ComparisonRolloutAuthorityResolverPort;
  readonly readSemanticMetadata?: (input: {
    readonly projectId: string;
    readonly candidate: ClaimCandidate;
    readonly security: SecurityContext;
  }) => Promise<FreshnessMetadata>;
};

const candidateFromClaim = (candidate: ClaimCandidate) => ({
  id: candidate.candidateId,
  revision: candidate.revisionNumber,
  sourceVersionId: candidate.sourceVersionId,
  digest: claimCandidateDigest(candidate),
  evidenceIds: [...candidate.evidenceIds],
});

const canonicalIdentity = (snapshot: CanonicalSnapshot) => ({
  id: snapshot.snapshotId,
  version: snapshot.version,
  digest: snapshot.digest,
});

const retryableFreshnessCause = (error: unknown): boolean =>
  error instanceof ShotgunError && error.retryable;

const freshnessUnavailable = (input: {
  readonly message: string;
  readonly retryable: boolean;
}): never => {
  throw new ComparisonV2ReviewFreshnessError(input);
};

export const createComparisonV2ReviewFreshnessAdapter = (
  dependencies: FreshnessDependencies,
): ComparisonV2ReviewFreshnessPort => ({
  async getCurrent(input) {
    const { comparison } = input.aggregate;
    let candidateRecord: Awaited<ReturnType<ComparisonCandidateV2ResolverPort['findById']>>;
    try {
      candidateRecord = await dependencies.candidate.findById(
        comparison.projectId,
        comparison.candidate.id,
      );
    } catch (error) {
      return freshnessUnavailable({
        message: 'candidate unavailable',
        retryable: retryableFreshnessCause(error),
      });
    }
    if (
      !candidateRecord ||
      candidateRecord.projectId !== comparison.projectId ||
      candidateRecord.candidateId !== comparison.candidate.id ||
      candidateRecord.revisionNumber !== comparison.candidate.revision ||
      candidateRecord.status !== 'READY'
    ) {
      return freshnessUnavailable({ message: 'candidate unavailable', retryable: false });
    }
    let snapshot: CanonicalSnapshot;
    try {
      snapshot = await dependencies.canonicalSnapshot.getSnapshot(comparison.projectId);
    } catch (error) {
      return freshnessUnavailable({
        message: 'canonical snapshot unavailable',
        retryable: retryableFreshnessCause(error),
      });
    }
    let authority: ComparisonRolloutAuthority;
    try {
      authority = await dependencies.rollout.resolve({
        projectId: comparison.projectId,
        candidateId: comparison.candidate.id,
        candidateRevision: comparison.candidate.revision,
      });
    } catch (error) {
      return freshnessUnavailable({
        message: 'rollout authority unavailable',
        retryable: retryableFreshnessCause(error),
      });
    }
    const currentCandidate = candidateFromClaim(candidateRecord);
    const currentSnapshot = canonicalIdentity(snapshot);
    const common = {
      candidateId: currentCandidate.id,
      candidateRevision: currentCandidate.revision,
      candidateSourceVersionId: currentCandidate.sourceVersionId,
      candidateDigest: currentCandidate.digest,
      candidateEvidenceDigest: candidateEvidenceDigestV2(currentCandidate),
      canonicalSnapshotId: currentSnapshot.id,
      canonicalSnapshotDigest: currentSnapshot.digest,
      canonicalSnapshotVersion: currentSnapshot.version,
      rolloutAuthorityRevision: authority.authorityRevision,
    } as const;
    if (input.expected.mode === 'DETERMINISTIC_EXACT') {
      return {
        identity: {
          ...common,
          mode: 'DETERMINISTIC_EXACT',
          exactDuplicateTarget: input.expected.exactDuplicateTarget,
        },
      };
    }

    // Canonical identity is the first authoritative freshness boundary.  If
    // it moved, the existing evaluator already knows how to classify the
    // comparison as CANONICAL_SNAPSHOT_CHANGED and the Review bridge will
    // perform the guarded STALE transition.  Do this before reading lexical
    // or semantic projections so a projection watermark/provider failure
    // cannot mask a confirmed Canonical drift as FRESHNESS_UNAVAILABLE.
    const canonicalSnapshotChanged =
      input.expected.canonicalSnapshotId !== currentSnapshot.id ||
      input.expected.canonicalSnapshotDigest !== currentSnapshot.digest ||
      input.expected.canonicalSnapshotVersion !== currentSnapshot.version;
    if (canonicalSnapshotChanged) {
      const identity: ComparisonFreshnessIdentityV2 =
        input.expected.mode === 'EMPTY_CANONICAL_BOOTSTRAP'
          ? {
              ...common,
              mode: 'EMPTY_CANONICAL_BOOTSTRAP',
              shortlistDigest: input.expected.shortlistDigest,
              shortlistPolicyRevision: input.expected.shortlistPolicyRevision,
              semanticGenerationId: input.expected.semanticGenerationId,
              semanticSourceProjectionDigest: input.expected.semanticSourceProjectionDigest,
              semanticCanonicalBaseVersion: input.expected.semanticCanonicalBaseVersion,
            }
          : {
              ...common,
              mode: 'SEMANTIC',
              shortlistDigest: input.expected.shortlistDigest,
              shortlistPolicyRevision: input.expected.shortlistPolicyRevision,
              semanticGenerationId: input.expected.semanticGenerationId,
              semanticSourceProjectionDigest: input.expected.semanticSourceProjectionDigest,
              semanticCanonicalBaseVersion: input.expected.semanticCanonicalBaseVersion,
              providerModelCapabilityIdentity: input.expected.providerModelCapabilityIdentity,
              promptTemplateRevision: input.expected.promptTemplateRevision,
              outputSchemaRevision: input.expected.outputSchemaRevision,
              semanticPolicyRevision: input.expected.semanticPolicyRevision,
            };
      return {
        identity,
        shortlist: comparison.shortlist
          ? {
              querySemanticReadiness: comparison.shortlist.querySemanticReadiness,
              coverageStatus: comparison.shortlist.coverageStatus,
              truncated: comparison.shortlist.truncated,
            }
          : undefined,
      };
    }
    let lexical: Awaited<ReturnType<LexicalRetrieverPort['retrieve']>>;
    try {
      lexical = await dependencies.lexicalRetriever.retrieve({
        projectId: comparison.projectId,
        query: candidateRecord.claimText,
        accessScopes: candidateRecord.accessScope,
        limit: 100,
      });
    } catch (error) {
      return freshnessUnavailable({
        message: 'lexical projection unavailable',
        retryable: retryableFreshnessCause(error),
      });
    }
    if (
      lexical.readiness.status !== 'READY' ||
      lexical.readiness.lag !== 0 ||
      lexical.readiness.projectedCanonicalVersion !== snapshot.version ||
      lexical.readiness.canonicalVersion !== snapshot.version ||
      lexical.readiness.canonicalSnapshotDigest !== snapshot.digest ||
      (lexical.readiness.projectedSnapshotDigest !== undefined &&
        lexical.readiness.projectedSnapshotDigest !== snapshot.digest)
    ) {
      return freshnessUnavailable({
        message: 'lexical projection unavailable',
        retryable: lexical.readiness.status === 'STALE',
      });
    }
    if (
      comparison.shortlist &&
      (comparison.shortlist.lexicalProjectionWatermark !==
        comparisonLexicalProjectionWatermarkV2(lexical.readiness, snapshot) ||
        comparison.shortlist.lexicalProjectionBase !==
          comparisonLexicalProjectionBaseV2(lexical.readiness))
    ) {
      return freshnessUnavailable({ message: 'lexical projection changed', retryable: true });
    }
    let generation: Awaited<
      ReturnType<NonNullable<SemanticActiveGenerationReaderPort['getActiveGeneration']>>
    >;
    try {
      generation = dependencies.activeGenerationReader
        ? await dependencies.activeGenerationReader.getActiveGeneration(comparison.projectId)
        : undefined;
    } catch (error) {
      return freshnessUnavailable({
        message: 'semantic generation unavailable',
        retryable: retryableFreshnessCause(error),
      });
    }
    if (!generation || generation.buildStatus !== 'READY') {
      return freshnessUnavailable({ message: 'semantic generation unavailable', retryable: true });
    }
    const emptyCanonicalBootstrap =
      snapshot.claims.length === 0 &&
      Array.isArray(comparison.shortlist?.selectedTargetIdentities) &&
      comparison.shortlist.selectedTargetIdentities.length === 0 &&
      input.aggregate.analyses.length === 0;
    if (emptyCanonicalBootstrap) {
      if (input.expected.mode !== 'EMPTY_CANONICAL_BOOTSTRAP') {
        throw new Error('empty Canonical bootstrap freshness mode mismatch');
      }
      return {
        identity: {
          ...common,
          mode: 'EMPTY_CANONICAL_BOOTSTRAP',
          shortlistDigest: input.expected.shortlistDigest,
          shortlistPolicyRevision: input.expected.shortlistPolicyRevision,
          semanticGenerationId: generation.generationId,
          semanticSourceProjectionDigest: generation.sourceProjectionDigest,
          semanticCanonicalBaseVersion: generation.canonicalBaseVersion,
        },
        shortlist: comparison.shortlist
          ? {
              querySemanticReadiness: comparison.shortlist.querySemanticReadiness,
              coverageStatus: comparison.shortlist.coverageStatus,
              truncated: comparison.shortlist.truncated,
            }
          : undefined,
      };
    }
    if (input.expected.mode !== 'SEMANTIC') {
      throw new Error('semantic freshness mode mismatch');
    }
    let metadata: FreshnessMetadata = {};
    if (dependencies.readSemanticMetadata) {
      try {
        metadata = await dependencies.readSemanticMetadata({
          projectId: comparison.projectId,
          candidate: candidateRecord,
          security: input.security,
        });
      } catch (error) {
        return freshnessUnavailable({
          message: 'semantic metadata unavailable',
          retryable: retryableFreshnessCause(error),
        });
      }
    }
    return {
      identity: {
        ...common,
        mode: 'SEMANTIC',
        shortlistDigest: input.expected.shortlistDigest,
        shortlistPolicyRevision: input.expected.shortlistPolicyRevision,
        semanticGenerationId: generation.generationId,
        semanticSourceProjectionDigest: generation.sourceProjectionDigest,
        semanticCanonicalBaseVersion: generation.canonicalBaseVersion,
        providerModelCapabilityIdentity:
          metadata.providerModelCapabilityIdentity ??
          input.expected.providerModelCapabilityIdentity,
        promptTemplateRevision:
          metadata.promptTemplateRevision ?? COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
        outputSchemaRevision:
          metadata.outputSchemaRevision ?? COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
        semanticPolicyRevision:
          metadata.semanticPolicyRevision ?? COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
      },
      shortlist: comparison.shortlist
        ? {
            querySemanticReadiness: comparison.shortlist.querySemanticReadiness,
            coverageStatus: comparison.shortlist.coverageStatus,
            truncated: comparison.shortlist.truncated,
          }
        : undefined,
    };
  },
});

const requiredAckFailure = (input: {
  readonly request: Parameters<ComparisonV2RuntimeBoundary['handleCandidateValidated']>[0];
  readonly classification: RequiredAckFailureClassification;
  readonly reason: string;
}): ShotgunError =>
  new ShotgunError({
    code: input.classification.code,
    safeMessage: `Stage 5 V2 did not reach an authoritative Review terminal state (${input.reason}).`,
    module: 'stage5.comparison',
    operation: 'candidate-validated-v2-required-ack',
    correlationId: input.request.correlationId,
    retryable: input.classification.retryable,
  });

type RequiredAckFailureClassification = {
  readonly code: ErrorCode;
  readonly retryable: boolean;
};

const terminalClassification = (code: ErrorCode = 'VALIDATION_ERROR') =>
  ({
    code,
    retryable: false,
  }) satisfies RequiredAckFailureClassification;

const retryableClassification = (code: ErrorCode = 'RETRYABLE_DEPENDENCY') =>
  ({
    code,
    retryable: true,
  }) satisfies RequiredAckFailureClassification;

const classifyAnalysisFailure = (analysis: {
  readonly state: string;
  readonly safeFailureCode?: string;
}): RequiredAckFailureClassification => {
  if (analysis.state === 'FAILED_RETRYABLE') {
    // Outcome-unknown is a reconciliation boundary, not an ordinary retry.
    if (analysis.safeFailureCode === 'OUTCOME_UNKNOWN') {
      return terminalClassification('OUTCOME_UNKNOWN');
    }
    return retryableClassification(
      analysis.safeFailureCode === 'ANALYSIS_TIMEOUT' ? 'TIMEOUT' : 'RETRYABLE_DEPENDENCY',
    );
  }
  if (analysis.state === 'SEMANTIC_UNAVAILABLE') {
    switch (analysis.safeFailureCode) {
      case 'PROVIDER_UNAVAILABLE':
      case 'ANALYSIS_TIMEOUT':
      case 'RETRYABLE_DEPENDENCY':
        return retryableClassification(
          analysis.safeFailureCode === 'ANALYSIS_TIMEOUT' ? 'TIMEOUT' : 'RETRYABLE_DEPENDENCY',
        );
      default:
        return terminalClassification('AI_CAPABILITY_UNAVAILABLE');
    }
  }
  if (analysis.state === 'POLICY_BLOCKED') return terminalClassification('POLICY_DENIED');
  if (analysis.state === 'FAILED_TERMINAL') return terminalClassification('TERMINAL_FAILURE');
  return terminalClassification();
};

const classifyShortlistFailure = (
  evidence: Extract<ComparisonV2OrchestrationBlockedEvidence, { source: 'SHORTLIST' }>,
): RequiredAckFailureClassification => {
  switch (evidence.reason) {
    case 'LEXICAL_UNAVAILABLE':
      return evidence.readiness.lexicalRetryable === true
        ? retryableClassification('RETRYABLE_DEPENDENCY')
        : terminalClassification('VALIDATION_ERROR');
    case 'LEXICAL_STALE':
    case 'SEMANTIC_STALE':
    case 'GENERATION_UNAVAILABLE':
    case 'GENERATION_MISMATCH':
      return retryableClassification('STALE_VERSION');
    case 'SEMANTIC_UNAVAILABLE':
    case 'SEMANTIC_DEGRADED': {
      const execution = evidence.readiness.semanticExecution;
      const safeCode = evidence.readiness.semanticSafeFailureCode;
      if (
        evidence.readiness.semanticRetryable === true ||
        execution === 'PROVIDER_UNAVAILABLE' ||
        execution === 'TEMPORARILY_UNAVAILABLE' ||
        safeCode === 'TIMEOUT' ||
        safeCode === 'PROVIDER_FAILURE'
      ) {
        return retryableClassification(safeCode === 'TIMEOUT' ? 'TIMEOUT' : 'RETRYABLE_DEPENDENCY');
      }
      return terminalClassification('AI_CAPABILITY_UNAVAILABLE');
    }
    default:
      return terminalClassification(
        evidence.reason === 'POLICY_DENIED' || evidence.reason === 'POLICY_INTEGRITY'
          ? 'POLICY_DENIED'
          : evidence.reason === 'SNAPSHOT_INTEGRITY'
            ? 'STALE_VERSION'
            : 'VALIDATION_ERROR',
      );
  }
};

const classifySemanticBlockedFailure = (
  evidence: Extract<ComparisonV2OrchestrationBlockedEvidence, { source: 'SEMANTIC' }>,
): RequiredAckFailureClassification => {
  if (evidence.reason === 'SEMANTIC_UNAVAILABLE' && evidence.retryable === true) {
    return retryableClassification('RETRYABLE_DEPENDENCY');
  }
  if (evidence.safeFailureCode === 'POLICY_DENIED') return terminalClassification('POLICY_DENIED');
  if (evidence.safeFailureCode === 'STALE_COMPARISON')
    return terminalClassification('STALE_VERSION');
  if (evidence.safeFailureCode === 'RESOURCE_SCOPE_LEAK') {
    return terminalClassification('RESOURCE_ACCESS_REVOKED');
  }
  return terminalClassification('VALIDATION_ERROR');
};

const classifyOrchestrationFailure = (
  outcome: Extract<ComparisonV2OrchestrationOutcome, { status: 'BLOCKED' }>,
): RequiredAckFailureClassification => {
  if (outcome.evidence?.source === 'SHORTLIST') return classifyShortlistFailure(outcome.evidence);
  if (outcome.evidence?.source === 'SEMANTIC')
    return classifySemanticBlockedFailure(outcome.evidence);
  switch (outcome.reason) {
    case 'CANDIDATE_ACCESS_DENIED':
      return terminalClassification('POLICY_DENIED');
    case 'CANDIDATE_INTEGRITY':
      return terminalClassification('STALE_VERSION');
    case 'CANDIDATE_RESOLUTION_FAILED':
      return terminalClassification('NOT_FOUND');
    default:
      return terminalClassification();
  }
};

export const createComparisonV2Runtime = (input: {
  readonly candidate: ComparisonCandidateV2ResolverPort;
  readonly settings: Pick<SettingsRepositoryPort, 'getProjectSettingValue'>;
  readonly orchestrator: ComparisonV2OrchestratorPort;
  readonly reviewBridge?: ComparisonV2ReviewBridgePort;
  readonly freshness?: ComparisonV2ReviewFreshnessPort;
  readonly k?: number;
  /** Deprecated compatibility field; attempt is resolved from persisted state. */
  readonly attempt?: number;
}): ComparisonV2RuntimeBoundary => {
  const rollout = createComparisonRolloutAuthorityResolver(input.settings);
  const k = input.k ?? 10;
  return {
    async shouldRunV1(request) {
      const authority = await rollout.resolve(request);
      return authority.rollout !== 'V2_ACTIVE';
    },
    async handleCandidateValidated(request) {
      const authority = await rollout.resolve({
        projectId: request.projectId,
        candidateId: request.candidateId,
        candidateRevision: request.candidate.revisionNumber,
      });
      if (authority.rollout === 'V1_ONLY') {
        return {
          rollout: authority.rollout,
          authority: authority.selection,
          authorityRevision: authority.authorityRevision,
          v1Executed: true,
          review: { status: 'NOT_ATTEMPTED' },
        };
      }
      const requiresPublisherAck = request.executionTrigger === 'INITIAL_OR_EVENT_REPLAY';
      let v2Outcome: ComparisonV2OrchestrationOutcome;
      try {
        v2Outcome = await input.orchestrator.compare({
          projectId: request.projectId,
          candidateId: request.candidateId,
          actor: request.actor,
          security: request.security,
          k,
          attempt: 1,
          executionTrigger: request.executionTrigger ?? 'INITIAL_OR_EVENT_REPLAY',
        });
      } catch (error) {
        if (authority.rollout === 'V2_SHADOW' || !requiresPublisherAck) {
          v2Outcome = { status: 'BLOCKED', reason: 'CONTRACT_FAILURE' };
        } else {
          throw error;
        }
      }
      if (authority.rollout === 'V2_SHADOW') {
        return {
          rollout: authority.rollout,
          authority: authority.selection,
          authorityRevision: authority.authorityRevision,
          v1Executed: true,
          v2Outcome,
          review: { status: 'NOT_ATTEMPTED' },
        };
      }
      if (v2Outcome.status !== 'COMPLETED') {
        if (requiresPublisherAck) {
          const classification =
            v2Outcome.status === 'BLOCKED'
              ? classifyOrchestrationFailure(v2Outcome)
              : classifyAnalysisFailure(v2Outcome.analysis);
          throw requiredAckFailure({
            request,
            classification,
            reason: `V2_${v2Outcome.status}`,
          });
        }
        return {
          rollout: authority.rollout,
          authority: authority.selection,
          authorityRevision: authority.authorityRevision,
          v1Executed: false,
          v2Outcome,
          review: { status: 'NOT_ATTEMPTED' },
        };
      }
      const currentAuthority = await rollout.resolve({
        projectId: request.projectId,
        candidateId: request.candidateId,
        candidateRevision: request.candidate.revisionNumber,
      });
      if (currentAuthority.rollout !== 'V2_ACTIVE') {
        if (requiresPublisherAck) {
          throw requiredAckFailure({
            request,
            classification: terminalClassification('POLICY_DENIED'),
            reason: 'ROLLOUT_DOWNGRADED',
          });
        }
        return {
          rollout: authority.rollout,
          authority: authority.selection,
          authorityRevision: authority.authorityRevision,
          v1Executed: false,
          v2Outcome,
          review: { status: 'BLOCKED', reason: 'ROLLOUT_DOWNGRADED' },
        };
      }
      if (!input.reviewBridge || !input.freshness) {
        if (requiresPublisherAck) {
          throw requiredAckFailure({
            request,
            classification: terminalClassification('CONFIGURATION_REQUIRED'),
            reason: 'REVIEW_BRIDGE_UNAVAILABLE',
          });
        }
        return {
          rollout: authority.rollout,
          authority: currentAuthority.selection,
          authorityRevision: currentAuthority.authorityRevision,
          v1Executed: false,
          v2Outcome,
          review: { status: 'BLOCKED', reason: 'REVIEW_BRIDGE_UNAVAILABLE' },
        };
      }
      const bridgeOutcome = await input.reviewBridge.materializeDraft({
        event: v2Outcome.event,
        actor: request.actor,
        security: request.security,
        authority: currentAuthority.selection,
        rolloutAuthorityRevision: currentAuthority.authorityRevision,
      });
      if (bridgeOutcome.status !== 'DRAFT_CREATED') {
        if (requiresPublisherAck) {
          const classification =
            bridgeOutcome.reason === 'FRESHNESS_UNAVAILABLE' && bridgeOutcome.retryable === true
              ? retryableClassification('RETRYABLE_DEPENDENCY')
              : bridgeOutcome.reason === 'STALE_COMPARISON'
                ? terminalClassification('STALE_VERSION')
                : bridgeOutcome.reason === 'ACCESS_DENIED'
                  ? terminalClassification('POLICY_DENIED')
                  : terminalClassification('VALIDATION_ERROR');
          throw requiredAckFailure({
            request,
            classification,
            reason: `REVIEW_${bridgeOutcome.reason}`,
          });
        }
        return {
          rollout: authority.rollout,
          authority: currentAuthority.selection,
          authorityRevision: currentAuthority.authorityRevision,
          v1Executed: false,
          v2Outcome,
          review: { status: 'BLOCKED', reason: bridgeOutcome.reason },
        };
      }
      return {
        rollout: authority.rollout,
        authority: currentAuthority.selection,
        authorityRevision: currentAuthority.authorityRevision,
        v1Executed: false,
        v2Outcome,
        review: { status: 'DRAFT_CREATED' },
      };
    },
  };
};
