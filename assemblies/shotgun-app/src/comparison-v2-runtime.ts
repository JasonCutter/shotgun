import {
  assertReviewAuthorityInvariantV2,
  candidateEvidenceDigestV2,
  claimCandidateDigest,
  sha256Text,
  stableJson,
  type Actor,
  type CanonicalSnapshot,
  type ClaimCandidate,
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
  type ComparisonV2OrchestratorPort,
  comparisonLexicalProjectionBaseV2,
  comparisonLexicalProjectionWatermarkV2,
} from '../../../modules/comparison/src/index.js';
import type { LexicalRetrieverPort } from '../../../packages/contracts/src/hybrid-retrieval.js';
import {
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

export const createComparisonV2ReviewFreshnessAdapter = (
  dependencies: FreshnessDependencies,
): ComparisonV2ReviewFreshnessPort => ({
  async getCurrent(input) {
    const { comparison } = input.aggregate;
    const candidateRecord = await dependencies.candidate.findById(
      comparison.projectId,
      comparison.candidate.id,
    );
    if (
      !candidateRecord ||
      candidateRecord.projectId !== comparison.projectId ||
      candidateRecord.candidateId !== comparison.candidate.id ||
      candidateRecord.revisionNumber !== comparison.candidate.revision ||
      candidateRecord.status !== 'READY'
    ) {
      throw new Error('candidate unavailable');
    }
    const snapshot = await dependencies.canonicalSnapshot.getSnapshot(comparison.projectId);
    const authority = await dependencies.rollout.resolve({
      projectId: comparison.projectId,
      candidateId: comparison.candidate.id,
      candidateRevision: comparison.candidate.revision,
    });
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
    const lexical = await dependencies.lexicalRetriever.retrieve({
      projectId: comparison.projectId,
      query: candidateRecord.claimText,
      accessScopes: candidateRecord.accessScope,
      limit: 100,
    });
    if (
      lexical.readiness.status !== 'READY' ||
      lexical.readiness.lag !== 0 ||
      lexical.readiness.projectedCanonicalVersion !== snapshot.version ||
      lexical.readiness.canonicalVersion !== snapshot.version ||
      lexical.readiness.canonicalSnapshotDigest !== snapshot.digest ||
      (lexical.readiness.projectedSnapshotDigest !== undefined &&
        lexical.readiness.projectedSnapshotDigest !== snapshot.digest)
    ) {
      throw new Error('lexical projection unavailable');
    }
    if (
      comparison.shortlist &&
      (comparison.shortlist.lexicalProjectionWatermark !==
        comparisonLexicalProjectionWatermarkV2(lexical.readiness, snapshot) ||
        comparison.shortlist.lexicalProjectionBase !==
          comparisonLexicalProjectionBaseV2(lexical.readiness))
    ) {
      throw new Error('lexical projection changed');
    }
    const generation = dependencies.activeGenerationReader
      ? await dependencies.activeGenerationReader.getActiveGeneration(comparison.projectId)
      : undefined;
    if (!generation || generation.buildStatus !== 'READY') {
      throw new Error('semantic generation unavailable');
    }
    const metadata = dependencies.readSemanticMetadata
      ? await dependencies.readSemanticMetadata({
          projectId: comparison.projectId,
          candidate: candidateRecord,
          security: input.security,
        })
      : {};
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

export const createComparisonV2Runtime = (input: {
  readonly candidate: ComparisonCandidateV2ResolverPort;
  readonly settings: Pick<SettingsRepositoryPort, 'getProjectSettingValue'>;
  readonly orchestrator: ComparisonV2OrchestratorPort;
  readonly reviewBridge?: ComparisonV2ReviewBridgePort;
  readonly freshness?: ComparisonV2ReviewFreshnessPort;
  readonly k?: number;
  readonly attempt?: number;
}): ComparisonV2RuntimeBoundary => {
  const rollout = createComparisonRolloutAuthorityResolver(input.settings);
  const k = input.k ?? 10;
  const attempt = input.attempt ?? 1;
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
      let v2Outcome: ComparisonV2OrchestrationOutcome;
      try {
        v2Outcome = await input.orchestrator.compare({
          projectId: request.projectId,
          candidateId: request.candidateId,
          actor: request.actor,
          security: request.security,
          k,
          attempt,
        });
      } catch {
        v2Outcome = { status: 'BLOCKED', reason: 'CONTRACT_FAILURE' };
      }
      if (authority.rollout === 'V2_SHADOW' || v2Outcome.status !== 'COMPLETED') {
        return {
          rollout: authority.rollout,
          authority: authority.selection,
          authorityRevision: authority.authorityRevision,
          v1Executed: authority.rollout === 'V2_SHADOW',
          v2Outcome,
          review: { status: 'NOT_ATTEMPTED' },
        };
      }
      const currentAuthority = await rollout.resolve({
        projectId: request.projectId,
        candidateId: request.candidateId,
        candidateRevision: request.candidate.revisionNumber,
      });
      if (currentAuthority.rollout !== 'V2_ACTIVE' || !input.reviewBridge || !input.freshness) {
        return {
          rollout: authority.rollout,
          authority: authority.selection,
          authorityRevision: authority.authorityRevision,
          v1Executed: false,
          v2Outcome,
          review: {
            status: 'BLOCKED',
            reason:
              currentAuthority.rollout !== 'V2_ACTIVE'
                ? 'ROLLOUT_DOWNGRADED'
                : 'REVIEW_BRIDGE_UNAVAILABLE',
          },
        };
      }
      const bridgeOutcome = await input.reviewBridge.materializeDraft({
        event: v2Outcome.event,
        actor: request.actor,
        security: request.security,
        authority: currentAuthority.selection,
        rolloutAuthorityRevision: currentAuthority.authorityRevision,
      });
      return {
        rollout: authority.rollout,
        authority: currentAuthority.selection,
        authorityRevision: currentAuthority.authorityRevision,
        v1Executed: false,
        v2Outcome,
        review:
          bridgeOutcome.status === 'DRAFT_CREATED'
            ? { status: 'DRAFT_CREATED' }
            : { status: 'BLOCKED', reason: bridgeOutcome.reason },
      };
    },
  };
};
