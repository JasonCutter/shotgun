import { describe, expect, it } from 'vitest';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  analysisInputDigestV2,
  canonicalSnapshotDigest,
  claimCandidateDigest,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  shortlistAuditDigestV2,
  type AnalysisRevisionV2,
  type CanonicalSnapshot,
  type ClaimCandidate,
  type ComparisonCandidateV2,
  type SecurityContext,
  type SemanticRelationshipV2,
  type ShortlistAuditV2,
} from '../../packages/contracts/src/index.js';
import {
  createComparisonV2Orchestrator,
  type ComparisonV2OrchestratorDependencies,
} from '../../modules/comparison/src/orchestration-v2.js';
import type { ComparisonV2RepositoryPort } from '../../modules/comparison/src/persistence-v2.js';

const projectId = 'project-orchestration-v2';
const now = '2026-09-05T12:00:00.000Z';
const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'comparison.test',
};

const snapshotBase = {
  snapshotId: 'snapshot-1',
  projectId,
  version: 3,
  claims: [
    { claimId: 'claim-1', text: 'Existing claim one.', revisionNumber: 1, evidenceIds: ['e-1'] },
    { claimId: 'claim-2', text: 'Existing claim two.', revisionNumber: 1, evidenceIds: ['e-2'] },
  ],
  createdAt: now,
} as const;
const snapshot: CanonicalSnapshot = {
  ...snapshotBase,
  digest: canonicalSnapshotDigest(
    snapshotBase.projectId,
    snapshotBase.version,
    snapshotBase.claims,
    undefined,
  ),
};

const candidateText = 'A new claim from the source.';
const candidate: ClaimCandidate = {
  candidateId: 'candidate-1',
  batchId: 'batch-1',
  revisionNumber: 1,
  projectId,
  sourceVersionId: 'source-1',
  claimText: candidateText,
  evidenceIds: ['evidence-1'],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status: 'READY',
  providerCall: {} as ClaimCandidate['providerCall'],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: now,
};

const candidateV2: ComparisonCandidateV2 = {
  id: candidate.candidateId,
  revision: 1,
  digest: claimCandidateDigest(candidate),
  sourceVersionId: candidate.sourceVersionId,
  evidenceIds: [...candidate.evidenceIds],
};

const audit = (targets: readonly string[]): ShortlistAuditV2 => ({
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshot: {
    id: snapshot.snapshotId,
    version: snapshot.version,
    digest: snapshot.digest,
  },
  lexicalProjectionWatermark: sha256Text('watermark'),
  lexicalProjectionBase: sha256Text('lexical-base'),
  semanticGenerationId: 'generation-1',
  semanticSourceProjectionDigest: sha256Text('semantic-source'),
  semanticCanonicalBaseVersion: snapshot.version,
  querySemanticReadiness: 'READY',
  policyRevision: sha256Text('policy'),
  k: targets.length,
  selectedTargetIdentities: targets.map((resourceId) => ({
    resourceType: 'CLAIM',
    resourceId,
    resourceRevision: 1,
  })),
  exclusionCounts: {},
  truncated: false,
  coverageStatus: 'COMPLETE',
});

const relationship = (
  comparisonId: string,
  analysisRevisionId: string,
  resourceId: string,
  type: SemanticRelationshipV2['type'],
): SemanticRelationshipV2 => {
  const base = {
    relationshipId: `relationship-${resourceId}`,
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    comparisonId,
    candidateId: candidateV2.id,
    candidateRevision: candidateV2.revision,
    candidateDigest: candidateV2.digest,
    candidateEvidenceIds: [...candidateV2.evidenceIds],
    comparedResource: { resourceType: 'CLAIM' as const, resourceId, resourceRevision: 1 },
    canonicalSnapshot: {
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    type,
    analysisRevisionId,
    ruleIdentity: 'comparison-semantic-analysis-policy:v1',
    rationale: 'Test rationale.',
    accessScope: ['owner'],
    sensitivity: 'private' as const,
    revision: 1,
    createdAt: now,
  } satisfies Omit<SemanticRelationshipV2, 'materialDigest'>;
  return { ...base, materialDigest: semanticRelationshipMaterialDigestV2(base) };
};

const analysis = (
  comparisonId: string,
  shortlistDigest: string,
  resources: readonly string[],
  state: AnalysisRevisionV2['state'] = 'COMPLETED',
): AnalysisRevisionV2 => ({
  analysisRevisionId: 'analysis-1',
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  comparisonId,
  candidate: candidateV2,
  canonicalSnapshot: {
    id: snapshot.snapshotId,
    version: snapshot.version,
    digest: snapshot.digest,
  },
  inputDigest: analysisInputDigestV2({
    candidate: candidateV2,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    shortlistDigest,
    comparedResourceIdentities: resources.map((resourceId) => ({
      resourceType: 'CLAIM' as const,
      resourceId,
      resourceRevision: 1,
    })),
    providerIdentity: { providerId: 'provider', modelId: 'model', capabilityId: 'capability' },
    credentialRevisionRef: 'credential:revision:1',
    promptTemplateRevision: 'prompt:v1',
    outputSchemaRevision: 'schema:v1',
    semanticPolicyRevision: 'policy:v1',
  }),
  shortlistDigest,
  comparedResourceIdentities: resources.map((resourceId) => ({
    resourceType: 'CLAIM' as const,
    resourceId,
    resourceRevision: 1,
  })),
  providerIdentity: { providerId: 'provider', modelId: 'model', capabilityId: 'capability' },
  credentialRevisionRef: 'credential:revision:1',
  promptTemplateRevision: 'prompt:v1',
  outputSchemaRevision: 'schema:v1',
  semanticPolicyRevision: 'policy:v1',
  attempt: 1,
  state,
  outcome:
    state === 'COMPLETED' || state === 'PENDING' || state === 'ANALYZING'
      ? state === 'COMPLETED'
        ? 'COMPLETED'
        : undefined
      : state,
  startedAt: now,
  completedAt: now,
  durationMs: 1,
  outputDigest: state === 'COMPLETED' ? sha256Text('output') : undefined,
  materialDigest: state === 'COMPLETED' ? sha256Text('material') : undefined,
  safeFailureCode: state === 'COMPLETED' ? undefined : 'SEMANTIC_UNAVAILABLE',
  createdAt: now,
});

const repository = () => {
  const completed: unknown[] = [];
  const analyses: AnalysisRevisionV2[] = [];
  const repo: ComparisonV2RepositoryPort = {
    async saveAnalysisRevision({ revision }) {
      analyses.push(revision);
      return revision;
    },
    async transitionAnalysisRevision() {
      throw new Error('not used');
    },
    async findAnalysisRevision() {
      return undefined;
    },
    async findAnalysisRevisionByInput() {
      return undefined;
    },
    async saveCompletedAggregate(aggregate) {
      completed.push(aggregate);
      return aggregate;
    },
    async findComparisonById() {
      return undefined;
    },
    async findComparisonByIdentity() {
      return undefined;
    },
  };
  return { repo, completed, analyses };
};

const baseDependencies = (
  shortlist: ComparisonV2OrchestratorDependencies['shortlist'],
  semanticAnalysis: ComparisonV2OrchestratorDependencies['semanticAnalysis'],
) => {
  const stored = repository();
  return {
    stored,
    dependencies: {
      candidate: { findById: async () => candidate },
      shortlist,
      semanticAnalysis,
      repository: stored.repo,
      now: () => now,
      randomId: () => 'comparison-1',
    } satisfies ComparisonV2OrchestratorDependencies,
  };
};

const request = {
  projectId,
  candidateId: candidate.candidateId,
  actor: { type: 'user' as const, id: 'user-1' },
  security,
  k: 2,
  attempt: 1,
};

describe('Comparison v2 orchestration', () => {
  it('takes the exact path without semantic analysis and persists one terminal aggregate', async () => {
    let semanticCalls = 0;
    const setup = baseDependencies(
      {
        async build() {
          return {
            status: 'EXACT_DUPLICATE' as const,
            exactDuplicateTarget: {
              resourceType: 'CLAIM' as const,
              resourceId: 'claim-1',
              resourceRevision: 1,
              canonicalSnapshot: {
                id: snapshot.snapshotId,
                version: snapshot.version,
                digest: snapshot.digest,
              },
            },
          };
        },
      },
      {
        async analyze() {
          semanticCalls += 1;
          throw new Error('exact path must not invoke WP4');
        },
      },
    );
    const result = await createComparisonV2Orchestrator(setup.dependencies).compare(request);
    expect(result.status).toBe('COMPLETED');
    expect(semanticCalls).toBe(0);
    expect(setup.stored.completed).toHaveLength(1);
    if (result.status === 'COMPLETED') {
      expect(result.aggregate.comparison.disposition).toBe('EXACT_DUPLICATE');
      expect(result.aggregate.comparison.analysisRevisionIds).toEqual([]);
      expect(result.event.eventType).toBe('ComparisonCompletedV2');
    }
  });

  it('passes the same candidate and shortlist to WP4 and retains every UNRELATED target as NEW', async () => {
    const shortlistAudit = audit(['claim-1', 'claim-2']);
    let receivedCandidate: ComparisonCandidateV2 | undefined;
    let receivedShortlistDigest: string | undefined;
    const setup = baseDependencies(
      {
        async build() {
          return {
            status: 'READY' as const,
            shortlist: shortlistAudit,
            shortlistDigest: shortlistAuditDigestV2(shortlistAudit),
          };
        },
      },
      {
        async analyze(input) {
          receivedCandidate = input.candidate;
          receivedShortlistDigest = input.shortlistDigest;
          const analysisValue = analysis(input.comparisonId, input.shortlistDigest, [
            'claim-1',
            'claim-2',
          ]);
          return {
            status: 'COMPLETED' as const,
            analysis: analysisValue,
            relationships: [
              relationship(
                input.comparisonId,
                analysisValue.analysisRevisionId,
                'claim-1',
                'UNRELATED',
              ),
              relationship(
                input.comparisonId,
                analysisValue.analysisRevisionId,
                'claim-2',
                'UNRELATED',
              ),
            ],
          };
        },
      },
    );
    const result = await createComparisonV2Orchestrator(setup.dependencies).compare(request);
    expect(result.status).toBe('COMPLETED');
    expect(receivedCandidate).toEqual(candidateV2);
    expect(receivedShortlistDigest).toBe(shortlistAuditDigestV2(shortlistAudit));
    if (result.status === 'COMPLETED') {
      expect(result.aggregate.comparison.disposition).toBe('NEW');
      expect(result.aggregate.comparison.reviewRecommendation).toBe('ADD_CLAIM');
      expect(result.aggregate.relationships).toHaveLength(2);
    }
  });

  it('persists terminal provider failures but does not fabricate a completed aggregate', async () => {
    const shortlistAudit = audit(['claim-1']);
    const setup = baseDependencies(
      {
        async build() {
          return {
            status: 'READY' as const,
            shortlist: shortlistAudit,
            shortlistDigest: shortlistAuditDigestV2(shortlistAudit),
          };
        },
      },
      {
        async analyze(input) {
          return {
            status: 'FAILED' as const,
            analysis: analysis(
              input.comparisonId,
              input.shortlistDigest,
              ['claim-1'],
              'FAILED_RETRYABLE',
            ),
            relationships: [],
          };
        },
      },
    );
    const result = await createComparisonV2Orchestrator(setup.dependencies).compare(request);
    expect(result.status).toBe('FAILED');
    expect(setup.stored.completed).toHaveLength(0);
    expect(setup.stored.analyses).toHaveLength(1);
    if (result.status === 'FAILED') expect(result.event.eventType).toBe('ComparisonFailedV2');
  });

  it('retains mixed SUPPORTS, REFINES, and UNRELATED relationships as REVIEW_REQUIRED', async () => {
    const shortlistAudit = audit(['claim-1', 'claim-2']);
    const setup = baseDependencies(
      {
        async build() {
          return {
            status: 'READY' as const,
            shortlist: shortlistAudit,
            shortlistDigest: shortlistAuditDigestV2(shortlistAudit),
          };
        },
      },
      {
        async analyze(input) {
          const analysisValue = analysis(input.comparisonId, input.shortlistDigest, [
            'claim-1',
            'claim-2',
          ]);
          return {
            status: 'COMPLETED' as const,
            analysis: analysisValue,
            relationships: [
              relationship(
                input.comparisonId,
                analysisValue.analysisRevisionId,
                'claim-1',
                'SUPPORTS',
              ),
              relationship(
                input.comparisonId,
                analysisValue.analysisRevisionId,
                'claim-2',
                'UNRELATED',
              ),
            ],
          };
        },
      },
    );
    const result = await createComparisonV2Orchestrator(setup.dependencies).compare(request);
    expect(result.status).toBe('COMPLETED');
    if (result.status === 'COMPLETED') {
      expect(result.aggregate.comparison.disposition).toBe('REVIEW_REQUIRED');
      expect(result.aggregate.comparison.reviewRecommendation).toBe('MODIFY_REVIEW');
      expect(result.aggregate.relationships.map((item) => item.type)).toEqual([
        'SUPPORTS',
        'UNRELATED',
      ]);
    }
  });
});
