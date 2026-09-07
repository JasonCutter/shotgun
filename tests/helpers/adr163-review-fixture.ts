import {
  analysisInputDigestV2,
  canonicalSnapshotDigest,
  claimCandidateDigest,
  comparisonFreshnessDigestV2,
  comparisonResultDigestV2,
  draftChangeSetContentDigestV2,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  shortlistAuditDigestV2,
  stableJson,
  type CanonicalSnapshot,
  type ClaimCandidate,
  type ComparisonResultV2,
  type DraftChangeSetV2,
  type ProjectionReadiness,
  type ReviewAuthoritySelectionV2,
  type SecurityContext,
  type SemanticProjectionGeneration,
  type SemanticRelationshipV2,
} from '../../packages/contracts/src/index.js';
import {
  COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2,
  COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
  COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
  COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
  comparisonLexicalProjectionBaseV2,
  comparisonLexicalProjectionWatermarkV2,
} from '../../modules/comparison/src/index.js';
import type { ComparisonV2AggregateForReview } from '../../modules/change-set-review/src/index.js';

export const ADR163_FIXTURE_PROJECT = 'shotgun';
export const ADR163_FIXTURE_SECURITY: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'knowledge',
};

export type Adr163ReviewFixture = {
  readonly candidate: ClaimCandidate;
  readonly aggregate: ComparisonV2AggregateForReview;
  readonly draft: DraftChangeSetV2;
  readonly authority: ReviewAuthoritySelectionV2;
};

const providerCall = (createdAt: string) =>
  ({
    callId: 'adr163-fixture-call',
    requestId: 'adr163-fixture-request',
    taskProfile: 'candidate-extraction',
    schemaName: 'ClaimCandidateBatch.v1',
    provider: 'fixture',
    adapterVersion: 'fixture',
    model: 'fixture',
    modelVersion: 'fixture',
    promptVersion: 'direct-claim-v1',
    policyVersion: 'direct-only-v1',
    dataPolicyVersion: 'fixture',
    dataClassification: 'knowledge',
    inputEvidenceIds: ['evidence-adr163-fixture'],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    cost: { currency: 'USD', status: 'estimated', amountMicros: 0 },
    attempts: [],
    structuredOutputValid: true,
    createdAt,
  }) as ClaimCandidate['providerCall'];

export const createAdr163ReviewFixture = (input: {
  readonly suffix: string;
  readonly candidateId?: string;
  readonly batchId?: string;
  readonly evidenceId?: string;
  readonly sourceVersionId?: string;
  readonly claimText: string;
  readonly snapshot?: CanonicalSnapshot;
  readonly createdAt?: string;
  readonly freshnessMode?: 'SEMANTIC' | 'DETERMINISTIC_EXACT';
  readonly rolloutAuthorityRevision?: string;
  readonly semanticFreshness?: {
    readonly lexicalReadiness: ProjectionReadiness;
    readonly semanticGeneration: SemanticProjectionGeneration;
    readonly providerModelCapabilityIdentity: string;
    readonly shortlistPolicyRevision?: string;
  };
}): Adr163ReviewFixture => {
  const createdAt = input.createdAt ?? '2026-09-08T12:00:00.000Z';
  const snapshot =
    input.snapshot ??
    ({
      snapshotId: `snapshot:${ADR163_FIXTURE_PROJECT}:0`,
      projectId: ADR163_FIXTURE_PROJECT,
      version: 0,
      claims: [],
      createdAt,
      digest: canonicalSnapshotDigest(ADR163_FIXTURE_PROJECT, 0, []),
    } satisfies CanonicalSnapshot);
  const evidenceId = input.evidenceId ?? `evidence:adr163:${input.suffix}`;
  const candidateId = input.candidateId ?? `candidate:adr163:${input.suffix}`;
  const batchId = input.batchId ?? `batch:adr163:${input.suffix}`;
  const sourceVersionId = input.sourceVersionId ?? `source-version:adr163:${input.suffix}`;
  const semanticFreshness = input.semanticFreshness;
  const candidateWithoutDigest = {
    candidateId,
    batchId,
    revisionNumber: 1 as const,
    projectId: ADR163_FIXTURE_PROJECT,
    sourceVersionId,
    claimText: input.claimText,
    evidenceIds: [evidenceId] as [string],
    evidenceMode: 'DIRECT_EVIDENCE' as const,
    extractionProfile: 'direct-only' as const,
    status: 'READY' as const,
    providerCall: providerCall(createdAt),
    accessScope: ['owner'],
    sensitivity: 'private' as const,
    createdAt,
  };
  const candidate = candidateWithoutDigest as ClaimCandidate;
  const candidateDigest = claimCandidateDigest(candidate);
  const candidateIdentity = {
    id: candidateId,
    revision: 1 as const,
    digest: candidateDigest,
    sourceVersionId,
    evidenceIds: [evidenceId] as readonly string[],
  };
  const shortlist = {
    contractVersion: '2.0' as const,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    lexicalProjectionWatermark: semanticFreshness
      ? comparisonLexicalProjectionWatermarkV2(semanticFreshness.lexicalReadiness, snapshot)
      : sha256Text(`watermark:${input.suffix}`),
    lexicalProjectionBase: semanticFreshness
      ? comparisonLexicalProjectionBaseV2(semanticFreshness.lexicalReadiness)
      : sha256Text(`lexical:${input.suffix}`),
    semanticGenerationId:
      semanticFreshness?.semanticGeneration.generationId ?? `generation:${input.suffix}`,
    semanticSourceProjectionDigest:
      semanticFreshness?.semanticGeneration.sourceProjectionDigest ??
      sha256Text(`source-projection:${input.suffix}`),
    semanticCanonicalBaseVersion:
      semanticFreshness?.semanticGeneration.canonicalBaseVersion ?? snapshot.version,
    querySemanticReadiness: 'READY' as const,
    policyRevision:
      semanticFreshness?.shortlistPolicyRevision ?? sha256Text(`shortlist-policy:${input.suffix}`),
    k: 1,
    selectedTargetIdentities: [
      {
        resourceType: 'CLAIM' as const,
        resourceId: `existing:${input.suffix}`,
        resourceRevision: 1,
      },
    ],
    exclusionCounts: {},
    truncated: false,
    coverageStatus: 'COMPLETE' as const,
  };
  const comparedResource = {
    resourceType: 'CLAIM' as const,
    resourceId: `existing:${input.suffix}`,
    resourceRevision: 1,
  };
  const providerIdentity = {
    providerId: 'fixture-provider',
    modelId: 'fixture-model',
    capabilityId: COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2,
  };
  const analysisInput = {
    candidate: candidateIdentity,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    shortlistDigest: shortlistAuditDigestV2(shortlist),
    comparedResourceIdentities: [comparedResource],
    providerIdentity,
    credentialRevisionRef: 'credential:fixture',
    promptTemplateRevision: COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
    outputSchemaRevision: COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
    semanticPolicyRevision: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
  };
  const analysis = {
    analysisRevisionId: `analysis:adr163:${input.suffix}`,
    contractVersion: '2.0' as const,
    comparisonId: `comparison:adr163:${input.suffix}`,
    candidate: candidateIdentity,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    inputDigest: analysisInputDigestV2(analysisInput),
    shortlistDigest: shortlistAuditDigestV2(shortlist),
    comparedResourceIdentities: [comparedResource],
    providerIdentity,
    credentialRevisionRef: analysisInput.credentialRevisionRef,
    promptTemplateRevision: analysisInput.promptTemplateRevision,
    outputSchemaRevision: analysisInput.outputSchemaRevision,
    semanticPolicyRevision: analysisInput.semanticPolicyRevision,
    attempt: 1,
    state: 'COMPLETED' as const,
    outcome: 'COMPLETED' as const,
    startedAt: createdAt,
    completedAt: createdAt,
    durationMs: 1,
    outputDigest: sha256Text(`output:${input.suffix}`),
    materialDigest: sha256Text(`material:${input.suffix}`),
    createdAt,
  };
  const relationshipWithoutDigest: Omit<SemanticRelationshipV2, 'materialDigest'> = {
    relationshipId: `relationship:adr163:${input.suffix}`,
    contractVersion: '2.0',
    comparisonId: comparisonId(input.suffix),
    candidateId,
    candidateRevision: 1,
    candidateDigest,
    candidateEvidenceIds: [evidenceId],
    comparedResource,
    canonicalSnapshot: {
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    type: 'UNRELATED',
    analysisRevisionId: analysis.analysisRevisionId,
    ruleIdentity: 'fixture-rule',
    rationale: 'ADR-163 bounded integration fixture.',
    accessScope: ['owner'],
    sensitivity: 'private',
    revision: 1,
    createdAt,
  };
  const relationship = {
    ...relationshipWithoutDigest,
    materialDigest: semanticRelationshipMaterialDigestV2(relationshipWithoutDigest),
  };
  const comparison: ComparisonResultV2 = {
    comparisonId: comparisonId(input.suffix),
    contractVersion: '2.0',
    projectId: ADR163_FIXTURE_PROJECT,
    candidate: candidateIdentity,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    disposition: 'REVIEW_REQUIRED',
    reviewRecommendation: 'MODIFY_REVIEW',
    shortlist,
    analysisRevisionIds: [analysis.analysisRevisionId],
    relationshipIds: [relationship.relationshipId],
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt,
  };
  const aggregate = { comparison, analyses: [analysis], relationships: [relationship] };
  const freshnessCommon = {
    candidateId,
    candidateRevision: 1,
    candidateSourceVersionId: sourceVersionId,
    candidateDigest,
    candidateEvidenceDigest: sha256Text(stableJson({ evidenceIds: [evidenceId] })),
    canonicalSnapshotId: snapshot.snapshotId,
    canonicalSnapshotDigest: snapshot.digest,
    canonicalSnapshotVersion: snapshot.version,
    rolloutAuthorityRevision: input.rolloutAuthorityRevision ?? 'rollout:adr163-fixture',
  };
  const freshnessIdentity =
    input.freshnessMode === 'DETERMINISTIC_EXACT'
      ? {
          ...freshnessCommon,
          mode: 'DETERMINISTIC_EXACT' as const,
          exactDuplicateTarget: {
            resourceType: 'CLAIM' as const,
            resourceId: `existing:${input.suffix}`,
            resourceRevision: 1,
            canonicalSnapshot: {
              id: snapshot.snapshotId,
              version: snapshot.version,
              digest: snapshot.digest,
            },
          },
        }
      : {
          ...freshnessCommon,
          mode: 'SEMANTIC' as const,
          shortlistDigest: shortlistAuditDigestV2(shortlist),
          shortlistPolicyRevision: shortlist.policyRevision,
          semanticGenerationId: shortlist.semanticGenerationId,
          semanticSourceProjectionDigest: shortlist.semanticSourceProjectionDigest,
          semanticCanonicalBaseVersion: shortlist.semanticCanonicalBaseVersion,
          providerModelCapabilityIdentity:
            semanticFreshness?.providerModelCapabilityIdentity ??
            [
              providerIdentity.providerId,
              providerIdentity.modelId,
              providerIdentity.capabilityId,
            ].join('/'),
          promptTemplateRevision: analysis.promptTemplateRevision,
          outputSchemaRevision: analysis.outputSchemaRevision,
          semanticPolicyRevision: analysis.semanticPolicyRevision,
        };
  const draftWithoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
    changeSetId: `change-set:adr163:${input.suffix}`,
    contractVersion: '2.0',
    revisionNumber: 1,
    projectId: ADR163_FIXTURE_PROJECT,
    candidate: candidateIdentity,
    comparisonId: comparison.comparisonId,
    comparisonDigest: comparisonResultDigestV2(comparison),
    canonicalSnapshot: comparison.canonicalSnapshot,
    analysisRevisionIds: [...comparison.analysisRevisionIds],
    disposition: 'REVIEW_REQUIRED',
    relationshipIds: [...comparison.relationshipIds],
    evidenceIds: [evidenceId],
    operation: 'MODIFY_REVIEW',
    reviewRecommendation: 'MODIFY_REVIEW',
    status: 'PENDING_REVIEW',
    expectedCanonicalVersion: snapshot.version,
    snapshotDigest: snapshot.digest,
    shortlistDigest: shortlistAuditDigestV2(shortlist),
    freshnessIdentity,
    freshnessDigest: comparisonFreshnessDigestV2(freshnessIdentity),
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt,
    updatedAt: createdAt,
  };
  const draft = {
    ...draftWithoutDigest,
    contentDigest: draftChangeSetContentDigestV2(draftWithoutDigest),
  } satisfies DraftChangeSetV2;
  return {
    candidate,
    aggregate,
    draft,
    authority: {
      projectId: ADR163_FIXTURE_PROJECT,
      candidateId,
      candidateRevision: 1,
      rollout: 'V2_ACTIVE',
      candidates: [
        {
          projectId: ADR163_FIXTURE_PROJECT,
          candidateId,
          candidateRevision: 1,
          contractVersion: '2.0',
          reviewAuthoritative: true,
        },
      ],
    },
  };
};

const comparisonId = (suffix: string): string => `comparison:adr163:${suffix}`;
