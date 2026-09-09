import { describe, expect, it } from 'vitest';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  analysisInputDigestV2,
  canonicalSnapshotDigest,
  claimCandidateDigest,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  stableJson,
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
import {
  type ComparisonV2Aggregate,
  comparisonV2StorageIdentity,
  type ComparisonV2RepositoryPort,
} from '../../modules/comparison/src/persistence-v2.js';

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

const emptySnapshot: CanonicalSnapshot = {
  snapshotId: 'snapshot-empty',
  projectId,
  version: 0,
  claims: [],
  createdAt: now,
  digest: canonicalSnapshotDigest(projectId, 0, [], undefined),
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

const audit = (
  targets: readonly string[],
  snapshotInput: CanonicalSnapshot = snapshot,
): ShortlistAuditV2 => ({
  contractVersion: COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshot: {
    id: snapshotInput.snapshotId,
    version: snapshotInput.version,
    digest: snapshotInput.digest,
  },
  lexicalProjectionWatermark: sha256Text('watermark'),
  lexicalProjectionBase: sha256Text('lexical-base'),
  semanticGenerationId: 'generation-1',
  semanticSourceProjectionDigest: sha256Text('semantic-source'),
  semanticCanonicalBaseVersion: snapshotInput.version,
  querySemanticReadiness: 'READY',
  policyRevision: sha256Text('policy'),
  k: Math.max(targets.length, 1),
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

  it('reuses the deterministic exact identity without invoking semantic analysis', async () => {
    const stored: ComparisonV2Aggregate[] = [];
    let generatedId = 0;
    let semanticCalls = 0;
    const repository: ComparisonV2RepositoryPort = {
      async saveAnalysisRevision({ revision }) {
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
        stored.push(aggregate);
        return aggregate;
      },
      async findComparisonById(project, comparisonId) {
        return stored.find(
          (aggregate) =>
            aggregate.comparison.projectId === project &&
            aggregate.comparison.comparisonId === comparisonId,
        );
      },
      async findComparisonByIdentity(identity) {
        return stored.find(
          (aggregate) =>
            stableJson(comparisonV2StorageIdentity(aggregate)) === stableJson(identity),
        );
      },
    };
    const dependencies: ComparisonV2OrchestratorDependencies = {
      candidate: { findById: async () => candidate },
      shortlist: {
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
      semanticAnalysis: {
        async analyze() {
          semanticCalls += 1;
          throw new Error('deterministic exact must not invoke semantic analysis');
        },
      },
      repository,
      now: () => now,
      randomId: () => `exact-${++generatedId}`,
    };
    const orchestrator = createComparisonV2Orchestrator(dependencies);
    const first = await orchestrator.compare(request);
    const replay = await orchestrator.compare(request);
    expect(first.status).toBe('COMPLETED');
    expect(replay.status).toBe('COMPLETED');
    expect(semanticCalls).toBe(0);
    expect(stored).toHaveLength(1);
    if (first.status === 'COMPLETED' && replay.status === 'COMPLETED') {
      expect(replay.aggregate.comparison.comparisonId).toBe(
        first.aggregate.comparison.comparisonId,
      );
    }
  });

  it('retains only safe shortlist subreason and readiness detail when blocked', async () => {
    let semanticCalls = 0;
    const setup = baseDependencies(
      {
        async build() {
          return {
            status: 'BLOCKED' as const,
            reason: 'SEMANTIC_DEGRADED' as const,
            readiness: { lexicalStatus: 'READY' as const, semanticStatus: 'DEGRADED' as const },
          };
        },
      },
      {
        async analyze() {
          semanticCalls += 1;
          throw new Error('blocked shortlist must not invoke semantic analysis');
        },
      },
    );

    const result = await createComparisonV2Orchestrator(setup.dependencies).compare(request);

    expect(result).toEqual({
      status: 'BLOCKED',
      reason: 'SHORTLIST_BLOCKED',
      detail: 'SEMANTIC_DEGRADED:{"lexicalStatus":"READY","semanticStatus":"DEGRADED"}',
    });
    expect(semanticCalls).toBe(0);
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

  it('completes an empty-Canonical bootstrap without semantic analysis or provider work', async () => {
    const shortlistAudit = audit([], emptySnapshot);
    let semanticCalls = 0;
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
        async analyze() {
          semanticCalls += 1;
          throw new Error('empty-Canonical bootstrap must not invoke semantic analysis');
        },
      },
    );

    const result = await createComparisonV2Orchestrator(setup.dependencies).compare(request);

    expect(result.status).toBe('COMPLETED');
    expect(semanticCalls).toBe(0);
    expect(setup.stored.completed).toHaveLength(1);
    if (result.status !== 'COMPLETED') return;
    expect(result.aggregate.comparison.disposition).toBe('NEW');
    expect(result.aggregate.comparison.reviewRecommendation).toBe('ADD_CLAIM');
    expect(result.aggregate.comparison.analysisRevisionIds).toEqual([]);
    expect(result.aggregate.comparison.relationshipIds).toEqual([]);
    expect(result.aggregate.comparison.shortlist?.selectedTargetIdentities).toEqual([]);
    expect(result.event.eventType).toBe('ComparisonCompletedV2');
    expect(result.event.analysisRevisionIds).toEqual([]);
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

  it('reuses an identical governed analysis identity but stores a new identity when shortlist input changes', async () => {
    const aggregates: ComparisonV2Aggregate[] = [];
    let generatedId = 0;
    const repository: ComparisonV2RepositoryPort = {
      async saveAnalysisRevision({ revision }) {
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
        aggregates.push(aggregate);
        return aggregate;
      },
      async findComparisonById(requestProjectId, comparisonId) {
        return aggregates.find(
          (aggregate) =>
            aggregate.comparison.projectId === requestProjectId &&
            aggregate.comparison.comparisonId === comparisonId,
        );
      },
      async findComparisonByIdentity(identity) {
        const key = JSON.stringify(identity);
        return aggregates.find(
          (aggregate) => JSON.stringify(comparisonV2StorageIdentity(aggregate)) === key,
        );
      },
    };
    const execute = async (target: 'claim-1' | 'claim-2') => {
      const shortlistAudit = audit([target]);
      const orchestrator = createComparisonV2Orchestrator({
        candidate: { findById: async () => candidate },
        shortlist: {
          async build() {
            return {
              status: 'READY' as const,
              shortlist: shortlistAudit,
              shortlistDigest: shortlistAuditDigestV2(shortlistAudit),
            };
          },
        },
        semanticAnalysis: {
          async analyze(input) {
            const analysisValue = analysis(input.comparisonId, input.shortlistDigest, [target]);
            return {
              status: 'COMPLETED' as const,
              analysis: analysisValue,
              relationships: [
                relationship(
                  input.comparisonId,
                  analysisValue.analysisRevisionId,
                  target,
                  'UNRELATED',
                ),
              ],
            };
          },
        },
        repository,
        now: () => now,
        randomId: () => `comparison-${++generatedId}`,
      });
      return orchestrator.compare(request);
    };

    const first = await execute('claim-1');
    const replay = await execute('claim-1');
    const changedInput = await execute('claim-2');

    expect(first.status).toBe('COMPLETED');
    expect(replay.status).toBe('COMPLETED');
    expect(changedInput.status).toBe('COMPLETED');
    if (
      first.status === 'COMPLETED' &&
      replay.status === 'COMPLETED' &&
      changedInput.status === 'COMPLETED'
    ) {
      expect(replay.aggregate.comparison.comparisonId).toBe(
        first.aggregate.comparison.comparisonId,
      );
      expect(changedInput.aggregate.comparison.comparisonId).not.toBe(
        first.aggregate.comparison.comparisonId,
      );
    }
    expect(aggregates).toHaveLength(2);
  });

  it('looks up a completed semantic aggregate before invoking the provider on a different delivery key', async () => {
    const shortlistAudit = audit(['claim-1']);
    const shortlistDigest = shortlistAuditDigestV2(shortlistAudit);
    const stored: ComparisonV2Aggregate[] = [];
    let providerCalls = 0;
    let generatedId = 0;
    const repository: ComparisonV2RepositoryPort = {
      async saveAnalysisRevision({ revision }) {
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
        stored.push(aggregate);
        return aggregate;
      },
      async findComparisonById() {
        return undefined;
      },
      async findComparisonByIdentity(identity) {
        return stored.find(
          (aggregate) =>
            stableJson(comparisonV2StorageIdentity(aggregate)) === stableJson(identity),
        );
      },
    };
    const semanticAnalysis = {
      async resolveInputIdentity() {
        const value = analysis('preflight-comparison', shortlistDigest, ['claim-1']);
        return {
          inputDigest: value.inputDigest,
          providerIdentity: value.providerIdentity,
          credentialRevisionRef: value.credentialRevisionRef,
          promptTemplateRevision: value.promptTemplateRevision,
          outputSchemaRevision: value.outputSchemaRevision,
          semanticPolicyRevision: value.semanticPolicyRevision,
        };
      },
      async analyze(input: { readonly comparisonId: string; readonly shortlistDigest: string }) {
        providerCalls += 1;
        const value = analysis(input.comparisonId, input.shortlistDigest, ['claim-1']);
        return {
          status: 'COMPLETED' as const,
          analysis: value,
          relationships: [
            relationship(input.comparisonId, value.analysisRevisionId, 'claim-1', 'UNRELATED'),
          ],
        };
      },
    };
    const execute = () =>
      createComparisonV2Orchestrator({
        candidate: { findById: async () => candidate },
        shortlist: {
          async build() {
            return { status: 'READY' as const, shortlist: shortlistAudit, shortlistDigest };
          },
        },
        semanticAnalysis,
        repository,
        now: () => now,
        randomId: () => `comparison-${++generatedId}`,
      }).compare(request);

    const first = await execute();
    const replayWithDifferentKey = await execute();
    expect(first.status).toBe('COMPLETED');
    expect(replayWithDifferentKey.status).toBe('COMPLETED');
    expect(providerCalls).toBe(1);
    expect(stored).toHaveLength(1);
    if (first.status === 'COMPLETED' && replayWithDifferentKey.status === 'COMPLETED') {
      expect(replayWithDifferentKey.aggregate.comparison.comparisonId).toBe(
        first.aggregate.comparison.comparisonId,
      );
    }
  });

  it('reuses terminal failures on replay and advances only on explicit operator re-entry', async () => {
    const shortlistAudit = audit(['claim-1']);
    const shortlistDigest = shortlistAuditDigestV2(shortlistAudit);
    const stored: ComparisonV2Aggregate[] = [];
    const analyses: AnalysisRevisionV2[] = [];
    let providerCalls = 0;
    let generatedId = 0;
    const identity = analysis('identity-comparison', shortlistDigest, ['claim-1']);
    const repository: ComparisonV2RepositoryPort = {
      async saveAnalysisRevision({ revision }) {
        analyses.push(revision);
        return revision;
      },
      async transitionAnalysisRevision() {
        throw new Error('not used');
      },
      async findAnalysisRevision(_projectId, analysisRevisionId) {
        return analyses.find((item) => item.analysisRevisionId === analysisRevisionId);
      },
      async findAnalysisRevisionByInput() {
        return undefined;
      },
      async findLatestAnalysisRevisionByInput() {
        return analyses.at(-1);
      },
      async saveCompletedAggregate(aggregate) {
        stored.push(aggregate);
        analyses.push(...aggregate.analyses);
        return aggregate;
      },
      async findComparisonById() {
        return undefined;
      },
      async findComparisonByIdentity(identityToFind) {
        return stored.find(
          (aggregate) =>
            stableJson(comparisonV2StorageIdentity(aggregate)) === stableJson(identityToFind),
        );
      },
    };
    const semanticAnalysis: ComparisonV2OrchestratorDependencies['semanticAnalysis'] = {
      async resolveInputIdentity() {
        return {
          inputDigest: identity.inputDigest,
          providerIdentity: identity.providerIdentity,
          credentialRevisionRef: identity.credentialRevisionRef,
          promptTemplateRevision: identity.promptTemplateRevision,
          outputSchemaRevision: identity.outputSchemaRevision,
          semanticPolicyRevision: identity.semanticPolicyRevision,
        };
      },
      async analyze(input) {
        providerCalls += 1;
        if (input.attempt === 1) {
          const failed = {
            ...analysis(input.comparisonId, input.shortlistDigest, ['claim-1'], 'FAILED_TERMINAL'),
            analysisRevisionId: 'analysis-1',
            attempt: 1,
            inputDigest: identity.inputDigest,
            safeFailureCode: 'TERMINAL_FAILURE' as const,
          };
          return { status: 'FAILED' as const, analysis: failed, relationships: [] as const };
        }
        const completed = {
          ...analysis(input.comparisonId, input.shortlistDigest, ['claim-1'], 'COMPLETED'),
          analysisRevisionId: 'analysis-2',
          attempt: input.attempt,
          inputDigest: identity.inputDigest,
        };
        return {
          status: 'COMPLETED' as const,
          analysis: completed,
          relationships: [
            relationship(input.comparisonId, completed.analysisRevisionId, 'claim-1', 'UNRELATED'),
          ],
        };
      },
    };
    const orchestrator = createComparisonV2Orchestrator({
      candidate: { findById: async () => candidate },
      shortlist: {
        async build() {
          return { status: 'READY' as const, shortlist: shortlistAudit, shortlistDigest };
        },
      },
      semanticAnalysis,
      repository,
      now: () => now,
      randomId: () => `comparison-${++generatedId}`,
    });
    const initial = await orchestrator.compare({
      ...request,
      executionTrigger: 'INITIAL_OR_EVENT_REPLAY',
    });
    const replay = await orchestrator.compare({
      ...request,
      executionTrigger: 'INITIAL_OR_EVENT_REPLAY',
    });
    expect(initial.status).toBe('FAILED');
    expect(replay.status).toBe('FAILED');
    expect(providerCalls).toBe(1);
    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.attempt).toBe(1);

    const reentry = await orchestrator.compare({
      ...request,
      executionTrigger: 'EXPLICIT_OPERATOR_REENTRY',
    });
    expect(reentry.status).toBe('COMPLETED');
    expect(providerCalls).toBe(2);
    expect(analyses).toHaveLength(2);
    expect(analyses.map((item) => item.attempt)).toEqual([1, 2]);
    expect(stored).toHaveLength(1);
    if (reentry.status === 'COMPLETED') {
      expect(reentry.aggregate.analyses[0]?.attempt).toBe(2);
    }

    const replayedOperatorCommand = await orchestrator.compare({
      ...request,
      executionTrigger: 'EXPLICIT_OPERATOR_REENTRY',
    });
    expect(replayedOperatorCommand.status).toBe('COMPLETED');
    expect(providerCalls).toBe(2);
    expect(analyses).toHaveLength(2);
    expect(stored).toHaveLength(1);
  });
});
