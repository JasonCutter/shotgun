import { describe, expect, it } from 'vitest';

import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  HYBRID_FUSION_POLICY_RRF_V1,
  SEMANTIC_EMBEDDING_CATALOG_REVISION,
  SEMANTIC_REPRESENTATION_VERSION_V2,
  SemanticEmbeddingError,
  semanticRepresentationBuilderV2,
  sha256Text,
  type EvidenceSpan,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingModelDescriptor,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingResolverPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  type SemanticRepresentationInputV2,
} from '../../packages/contracts/src/index.js';
import {
  createEvaluationRun,
  evaluateSearchObservations,
  validateEvaluationRun,
  type GoldenCorpus,
  type SearchQueryObservation,
} from '../../packages/quality-evaluation/src/index.js';
import {
  HybridRetrievalCoordinator,
  SemanticRetriever,
  type EvidenceSpanResolverPort,
  type SourceVersionResolverPort,
} from '../../modules/hybrid-retrieval/src/index.js';
import {
  loadAkp1SemanticCorpus,
  semanticClaimById,
  semanticClaims,
  semanticQueryById,
  toQualityCorpus,
  type Akp1SemanticClaim,
  type Akp1SemanticCorpus,
} from '../helpers/akp-1-wp5.js';

const projectId = 'akp-1-semantic-synthetic';
const generationId = 'generation-wp5';
const profileId = 'profile-wp5';
const providerId = 'deterministic-fixture';
const embeddingModelId = 'semantic-wp5-fixture';
const sourceProjectionDigest = `sha256:${'5'.repeat(64)}`;
const canonicalBaseVersion = 3;
const timestamp = '2026-08-28T00:00:00.000Z';
const dimension = 8;

const unit = (values: readonly number[]): readonly number[] => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
};

const resourceVectors: Readonly<Record<string, readonly number[]>> = {
  'r-release-claim': unit([1, 0, 0, 0, 0, 0, 0, 0]),
  'r-release-policy': unit([0, 1, 0, 0, 0, 0, 0, 0]),
  'r-atlas-entity': unit([0, 0, 1, 0, 0, 0, 0, 0]),
  'r-atlas-retrieval-relation': unit([0, 0, 0.8, 0.6, 0, 0, 0, 0]),
  'r-migration-event': unit([0, 0, 0, 1, 0, 0, 0, 0]),
  'r-transfer-policy': unit([0, 0, 0, 0, 1, 0, 0, 0]),
  'r-credential-safety': unit([1, 0, 0, 0, 0, 0, 0, 0]),
  'r-private-key-warning': unit([1, 0, 0, 0, 0, 0, 0, 0]),
};

const queryVectors: Readonly<Record<string, readonly number[]>> = {
  'Release trains ship weekly': resourceVectors['r-release-claim']!,
  'Releas trains shipp wekly': resourceVectors['r-release-claim']!,
  'deployment cadence': resourceVectors['r-release-claim']!,
  'How often are releases shipped?': resourceVectors['r-release-claim']!,
  '프로젝트 코드명 Atlas': unit([0, 0, 1, 0.25, 0, 0, 0, 0]),
  'When did the migration start?': resourceVectors['r-migration-event']!,
  'release approval policy': unit([0.6, 0.8, 0, 0, 0, 0, 0, 0]),
  'external provider transfer approval': resourceVectors['r-transfer-policy']!,
};

const expectedTopResource: Readonly<Record<string, string>> = {
  'q-release-exact': 'r-release-claim',
  'q-release-typo': 'r-release-claim',
  'q-release-synonym': 'r-release-claim',
  'q-release-paraphrase': 'r-release-claim',
  'q-atlas-korean-alias': 'r-atlas-entity',
  'q-migration-temporal': 'r-migration-event',
  'q-release-ambiguous-neighbor': 'r-release-policy',
  'q-transfer-negative-control': 'r-transfer-policy',
};

const semanticInputFor = (claim: Akp1SemanticClaim): SemanticRepresentationInputV2 => {
  switch (claim.semanticResourceType) {
    case 'CLAIM':
      return {
        resourceType: 'CLAIM',
        resourceId: claim.goldenClaimId,
        statement: claim.claimText,
      };
    case 'ENTITY':
      return {
        resourceType: 'ENTITY',
        resourceId: claim.goldenClaimId,
        entityType: 'project',
        name: 'Atlas',
        aliases: ['프로젝트 코드명'],
      };
    case 'RELATION':
      return {
        resourceType: 'RELATION',
        resourceId: claim.goldenClaimId,
        relationType: 'links',
        fromName: 'Atlas',
        toName: 'retrieval index',
        stableFromRef: 'r-atlas-entity',
        stableToRef: 'retrieval-index',
      };
    case 'EVENT':
      return {
        resourceType: 'EVENT',
        resourceId: claim.goldenClaimId,
        eventType: 'migration',
        title: claim.claimText,
        occurredAt: '2026-08-20',
      };
    case 'DECISION':
      return {
        resourceType: 'DECISION',
        resourceId: claim.goldenClaimId,
        decisionType: 'policy',
        decision: claim.claimText,
      };
  }
};

const generation: SemanticProjectionGeneration = {
  projectId,
  generationId,
  sourceProjectionDigest,
  canonicalBaseVersion,
  credentialId: 'fixture-vault-reference',
  credentialRevision: 1,
  providerPolicyFingerprint: `sha256:${'6'.repeat(64)}`,
  providerId,
  embeddingModelId,
  embeddingProfileId: profileId,
  embeddingProfileRevision: 1,
  providerRegistryRevision: 'fixture-provider-registry:v1',
  capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  buildStatus: 'READY',
  createdAt: timestamp,
};

const profile: SemanticEmbeddingProfile = {
  profileId,
  projectId,
  profileRevision: 1,
  providerId,
  embeddingModelId,
  credentialId: generation.credentialId,
  credentialRevision: generation.credentialRevision,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  status: 'ACTIVE',
  createdAt: timestamp,
  createdBy: 'wp5-test',
  activatedAt: timestamp,
  updatedBy: 'wp5-test',
  updatedAt: timestamp,
};

const model: SemanticEmbeddingModelDescriptor = {
  providerId,
  modelId: embeddingModelId,
  displayName: 'WP5 deterministic fixture model',
  providerDefaultDimension: dimension,
  shotgunDefaultDimension: dimension,
  shotgunAllowedDimensions: [dimension],
  shotgunBatchLimit: 32,
  capabilityRevision: 'fixture-capability:v1',
  supportedDistanceMetrics: ['cosine'],
  defaultDistanceMetric: 'cosine',
  defaultNormalizationPolicy: 'unit_length',
};

const executionPin = {
  projectId,
  providerId,
  embeddingModelId,
  embeddingProfileId: profileId,
  embeddingProfileRevision: 1,
  credentialId: generation.credentialId,
  credentialRevision: 1,
  providerRegistryRevision: generation.providerRegistryRevision,
  capabilityCatalogRevision: generation.capabilityCatalogRevision,
  providerPolicyFingerprint: generation.providerPolicyFingerprint,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension,
  createdAt: timestamp,
} as const;

const createExecution = (): SemanticEmbeddingExecutionPort => ({
  identity: { providerId, embeddingModelId, dimension },
  embed: async (payload) => ({
    vector: queryVectors[payload.text] ?? queryVectors['Release trains ship weekly']!,
    dimension,
    modelId: embeddingModelId,
    providerId,
  }),
  embedBatch: async (payloads) =>
    Promise.all(
      payloads.map(async (payload) => ({
        vector: queryVectors[payload.text] ?? queryVectors['Release trains ship weekly']!,
        dimension,
        modelId: embeddingModelId,
        providerId,
      })),
    ),
});

const createResolver = (): SemanticEmbeddingResolverPort => ({
  resolveExecution: async () => ({ pin: executionPin, profile, model }),
  resolveCompatibility: async (input) => input,
});

const createProvenance = (claim: Akp1SemanticClaim) =>
  claim.semanticAuthority === 'CANONICAL'
    ? {
        authority: 'CANONICAL' as const,
        resourceBaseId: claim.goldenClaimId,
        resourceRevision: claim.semanticResourceRevision,
        baseCanonicalVersion: canonicalBaseVersion,
        sourceVersionId: claim.semanticSourceVersionId,
        evidenceIds: [`evidence-${claim.goldenClaimId}`],
        accessScope: claim.semanticAccessScope,
        sensitivity: claim.semanticSensitivity,
      }
    : {
        authority: 'APPROVED_KNOWLEDGE' as const,
        resourceBaseId: claim.goldenClaimId,
        resourceRevision: claim.semanticResourceRevision,
        knowledgeGroupId: 'knowledge-wp5-approved',
        knowledgeGroupRevision: 1,
        sourceVersionId: claim.semanticSourceVersionId,
        evidenceIds: [`evidence-${claim.goldenClaimId}`],
        accessScope: claim.semanticAccessScope,
        sensitivity: claim.semanticSensitivity,
      };

const createItems = (corpus: Akp1SemanticCorpus): readonly SemanticProjectionItem[] =>
  semanticClaims(corpus).map((claim) => {
    const representation = semanticRepresentationBuilderV2.build(semanticInputFor(claim));
    return {
      semanticItemId: `semantic:${claim.goldenClaimId}`,
      projectId,
      generationId,
      resourceType: claim.semanticResourceType,
      resourceId: claim.goldenClaimId,
      sourceProjectionDigest,
      canonicalVersion: canonicalBaseVersion,
      semanticTextDigest: representation.semanticTextDigest,
      embeddingProfileId: profileId,
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
      vector: resourceVectors[claim.goldenClaimId]!,
      dimension,
      evidenceIds: [`evidence-${claim.goldenClaimId}`],
      accessScope: claim.semanticAccessScope,
      sensitivity: claim.semanticSensitivity,
      providerId,
      embeddingModelId,
      normalizationPolicy: 'unit_length',
      authority: claim.semanticAuthority,
      provenance: createProvenance(claim),
      indexedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

const createEvidence = (corpus: Akp1SemanticCorpus): Readonly<Record<string, EvidenceSpan>> =>
  Object.fromEntries(
    semanticClaims(corpus).map((claim) => [
      `evidence-${claim.goldenClaimId}`,
      {
        evidenceId: `evidence-${claim.goldenClaimId}`,
        revisionId: `revision-${claim.goldenClaimId}`,
        projectId,
        sourceId: `source-${claim.goldenClaimId}`,
        sourceVersionId: claim.semanticSourceVersionId,
        pointer: `/synthetic/${claim.goldenClaimId}`,
        nodeKind: 'paragraph',
        origin: 'source',
        position: { type: 'TextPositionSelector', ...claim.evidence.position },
        quote: { type: 'TextQuoteSelector', exact: claim.evidence.exact },
        exactHash: sha256Text(claim.evidence.exact),
        accessScope: claim.semanticAccessScope,
        sensitivity: claim.semanticSensitivity,
        createdAt: timestamp,
      } satisfies EvidenceSpan,
    ]),
  );

const lexicalIdsByQuery: Readonly<Record<string, readonly string[]>> = {
  'Release trains ship weekly': ['r-release-claim'],
};

const createLexicalRetriever = (corpus: Akp1SemanticCorpus): LexicalRetrieverPort => ({
  retrieve: async (input) => {
    const claims = (lexicalIdsByQuery[input.query] ?? [])
      .map((resourceId) => semanticClaimById(corpus, resourceId))
      .filter((claim) =>
        claim.semanticAccessScope.every((scope) => input.accessScopes.includes(scope)),
      )
      .map((claim, index): LexicalCandidateResult => ({
        claimId: claim.goldenClaimId,
        commitId: 'commit-wp5-fixture',
        revisionId: `revision-${claim.goldenClaimId}`,
        canonicalVersion: canonicalBaseVersion,
        claimText: claim.claimText,
        sourceVersionId: claim.semanticSourceVersionId,
        evidenceIds: [`evidence-${claim.goldenClaimId}`],
        accessScope: claim.semanticAccessScope,
        sensitivity: claim.semanticSensitivity,
        score: 1 - index / 100,
        matchType: 'FULL_TEXT',
        rank: index + 1,
      }))
      .slice(0, input.limit ?? 10);

    return {
      items: claims,
      readiness: {
        status: 'READY',
        projectedCanonicalVersion: canonicalBaseVersion,
        canonicalVersion: canonicalBaseVersion,
        lag: 0,
        projectedSnapshotDigest: sourceProjectionDigest,
        canonicalSnapshotDigest: sourceProjectionDigest,
        updatedAt: timestamp,
      },
    };
  },
});

const createRig = async (corpus: Akp1SemanticCorpus) => {
  const repository = new InMemorySemanticIndexRepository();
  await repository.saveGeneration(generation);
  const items = createItems(corpus);
  await repository.upsertGenerationItems(items);
  const activeGenerationReader = {
    getActiveGeneration: async (requestedProjectId: string) =>
      requestedProjectId === projectId ? generation : undefined,
  };
  const semanticRetriever = new SemanticRetriever(
    repository,
    createResolver(),
    createExecution(),
    activeGenerationReader,
  );
  const evidence = createEvidence(corpus);
  const resourceResolver = {
    resolveResource: async (
      requestedProjectId: string,
      resourceType: Akp1SemanticClaim['semanticResourceType'],
      resourceId: string,
      expectedAuthority?: Akp1SemanticClaim['semanticAuthority'],
    ) => {
      if (requestedProjectId !== projectId) return undefined;
      const claim = semanticClaimById(corpus, resourceId);
      if (claim.semanticResourceType !== resourceType) return undefined;
      if (expectedAuthority && claim.semanticAuthority !== expectedAuthority) return undefined;
      return {
        text: claim.claimText,
        authority: claim.semanticAuthority,
        authorityRevision: claim.semanticResourceRevision,
        resourceRevision: claim.semanticResourceRevision,
        ...(claim.semanticAuthority === 'CANONICAL'
          ? { canonicalVersion: canonicalBaseVersion, baseCanonicalVersion: canonicalBaseVersion }
          : {}),
        evidenceIds: [`evidence-${claim.goldenClaimId}`],
        sourceVersionId: claim.semanticSourceVersionId,
        accessScope: claim.semanticAccessScope,
        sensitivity: claim.semanticSensitivity,
      };
    },
  };
  const evidenceResolver: EvidenceSpanResolverPort = {
    getEvidenceSpan: async (requestedProjectId, evidenceId) =>
      requestedProjectId === projectId ? evidence[evidenceId] : undefined,
  };
  const sourceVersionResolver: SourceVersionResolverPort = {
    getSourceVersion: async (requestedProjectId, sourceVersionId) => {
      if (requestedProjectId !== projectId) return undefined;
      const claim = semanticClaims(corpus).find(
        (entry) => entry.semanticSourceVersionId === sourceVersionId,
      );
      return claim
        ? { sourceVersionId, projectId, sourceId: `source-${claim.goldenClaimId}` }
        : undefined;
    },
  };
  const createCoordinator = (mode: 'lexical' | 'semantic' | 'hybrid'): HybridRetrievalCoordinator =>
    new HybridRetrievalCoordinator(
      createLexicalRetriever(corpus),
      mode === 'lexical' ? undefined : semanticRetriever,
      resourceResolver,
      evidenceResolver,
      sourceVersionResolver,
      activeGenerationReader,
      undefined,
      { clock: () => timestamp },
    );

  return { repository, generation, items, semanticRetriever, createCoordinator };
};

const runLane = async (
  coordinator: HybridRetrievalCoordinator,
  corpus: Akp1SemanticCorpus,
): Promise<{
  readonly observations: readonly SearchQueryObservation[];
  readonly responses: readonly Awaited<ReturnType<HybridRetrievalCoordinator['search']>>[];
}> => {
  const responses = [] as Awaited<ReturnType<HybridRetrievalCoordinator['search']>>[];
  const observations: SearchQueryObservation[] = [];
  for (const query of corpus.cases.flatMap((entry) => entry.queries)) {
    const response = await coordinator.search({
      projectId,
      query: query.queryText,
      accessScopes: ['owner'],
      allowedSensitivities: ['public'],
      limit: 3,
    });
    responses.push(response);
    observations.push({
      queryId: query.queryId,
      results: response.items.map((item) => ({
        goldenClaimId: item.resourceId,
        citationCorrect: item.citations.every(
          (citation) =>
            citation.sourceVersionId ===
            semanticClaimById(corpus, item.resourceId).semanticSourceVersionId,
        ),
      })),
    });
  }
  return { observations, responses };
};

const runArtifact = (corpus: GoldenCorpus, observations: readonly SearchQueryObservation[]) => {
  const results = evaluateSearchObservations(corpus, observations, []);
  const run = createEvaluationRun(corpus.manifest, results, {
    runId: 'wp5-semantic-search-measurement',
    runMode: 'deterministic-recorded',
    evaluationKind: 'SEARCH',
    applicationCommitSha: process.env.GITHUB_SHA ?? 'WORKTREE',
    startedAt: timestamp,
    completedAt: timestamp,
    moduleVersions: {
      'hybrid-retrieval': 'workspace',
      'semantic-index-in-memory': 'workspace',
    },
    adapterVersions: { 'semantic-index-in-memory': 'workspace' },
    projectorVersions: { 'semantic-representation-v2': SEMANTIC_REPRESENTATION_VERSION_V2 },
    provider: {
      providerName: 'recorded-fixture',
      providerAdapterVersion: 'wp5-deterministic-fixture:v1',
      providerModel: embeddingModelId,
      providerModelVersion: 'fixture:v1',
      promptVersion: 'none',
      policyVersion: 'semantic-query-classification:v1',
    },
    deterministicSettings:
      'unit_length cosine; 8 dimensions; RRF k=60; security-before-top-k; no raw query persistence',
    environmentSummary: {
      lane: 'WP5 semantic Golden Query',
      data: 'synthetic-only',
      network: 'no provider network calls',
    },
  });
  validateEvaluationRun(run);
  return { results, run };
};

const medianAndP95 = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (rank: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(rank * sorted.length) - 1)]!;
  return { medianMs: percentile(0.5), p95Ms: percentile(0.95) };
};

describe('AKP-1 WP5 quality, security, privacy, performance and closure evidence', () => {
  it('loads an approved closed Golden Query corpus and preserves Product semantic eligibility', async () => {
    const rawCorpus = await loadAkp1SemanticCorpus();
    const qualityCorpus = toQualityCorpus(rawCorpus);
    expect(rawCorpus.manifest.corpusKind).toBe('SEMANTIC_SEARCH');
    expect(qualityCorpus.manifest.corpusDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(semanticClaims(rawCorpus)).toHaveLength(8);
    expect(semanticClaims(rawCorpus).map((claim) => claim.semanticResourceType)).toEqual([
      'CLAIM',
      'DECISION',
      'ENTITY',
      'RELATION',
      'EVENT',
      'DECISION',
      'CLAIM',
      'CLAIM',
    ]);
    expect(semanticClaims(rawCorpus).map((claim) => claim.semanticResourceType)).not.toContain(
      'FACT',
    );
    for (const claim of semanticClaims(rawCorpus)) {
      const first = semanticRepresentationBuilderV2.build(semanticInputFor(claim));
      const second = semanticRepresentationBuilderV2.build(semanticInputFor(claim));
      expect(first).toEqual(second);
      expect(first.representationVersion).toBe(SEMANTIC_REPRESENTATION_VERSION_V2);
    }
    expect(qualityCorpus.cases.flatMap((entry) => entry.queries)).toHaveLength(8);
  });

  it('compares lexical-only, semantic-only and Hybrid retrieval through the existing Stage 12 evaluator', async () => {
    const rawCorpus = await loadAkp1SemanticCorpus();
    const qualityCorpus = toQualityCorpus(rawCorpus);
    const rig = await createRig(rawCorpus);
    const laneResults = new Map<string, ReturnType<typeof runArtifact>>();

    for (const lane of ['lexical', 'semantic', 'hybrid'] as const) {
      const { observations, responses } = await runLane(rig.createCoordinator(lane), rawCorpus);
      const artifact = runArtifact(qualityCorpus, observations);
      laneResults.set(lane, artifact);
      expect(artifact.results.aggregateResults.counts.queries).toBe(8);
      expect(artifact.run.runDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      console.info(
        `[WP5 ${lane}] queries=${artifact.results.aggregateResults.counts.queries} passed=${artifact.results.caseResults.filter((result) => result.passed).length} mrr=${artifact.results.aggregateResults.metrics.mrr?.value ?? 'null'} hitRateAt1=${artifact.results.aggregateResults.metrics.hitRateAt1?.value ?? 'null'} ndcgAt3=${artifact.results.aggregateResults.metrics.ndcgAt3?.value ?? 'null'} citationCorrectness=${artifact.results.aggregateResults.metrics.citationCorrectness?.value ?? 'null'}`,
      );
      if (lane !== 'lexical') {
        expect(artifact.results.caseResults.every((result) => result.passed)).toBe(true);
        for (const response of responses) {
          const query = rawCorpus.cases
            .flatMap((entry) => entry.queries)
            .find((entry) => entry.queryText === response.query);
          expect(query).toBeDefined();
          expect(response.readiness.semantic.status).toBe('READY');
          expect(response.items[0]?.resourceId).toBe(expectedTopResource[query!.queryId]);
        }
      }
    }

    const semanticArtifact = laneResults.get('semantic')!;
    const hybridArtifact = laneResults.get('hybrid')!;
    expect(semanticArtifact.results.aggregateResults.metrics.citationCorrectness?.value).toBe(1);
    expect(hybridArtifact.results.aggregateResults.metrics.citationCorrectness?.value).toBe(1);
    const membership = await rig.repository.readGenerationMembershipSummary(
      projectId,
      generationId,
    );
    expect(membership?.itemCount).toBe(8);
    expect(membership?.membershipDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rig.generation.representationVersion).toBe(SEMANTIC_REPRESENTATION_VERSION_V2);
    expect(hybridArtifact.run.databaseSearchConfiguration).toEqual({});
    expect(HYBRID_FUSION_POLICY_RRF_V1).toBe('rrf:v1');
  });

  it('proves security-before-top-k, request-local degradation, and privacy-safe evaluation output', async () => {
    const rawCorpus = await loadAkp1SemanticCorpus();
    const qualityCorpus = toQualityCorpus(rawCorpus);
    const rig = await createRig(rawCorpus);
    const { observations, responses } = await runLane(rig.createCoordinator('hybrid'), rawCorpus);
    const artifact = runArtifact(qualityCorpus, observations);
    const releaseResponse = responses.find(
      (response) => response.query === 'Release trains ship weekly',
    )!;
    expect(releaseResponse.items[0]?.resourceId).toBe('r-release-claim');
    expect(releaseResponse.items.every((item) => item.sensitivity === 'public')).toBe(true);
    expect(releaseResponse.items.some((item) => item.resourceId === 'r-credential-safety')).toBe(
      false,
    );
    expect(releaseResponse.items.some((item) => item.resourceId === 'r-private-key-warning')).toBe(
      false,
    );

    const lexical = createLexicalRetriever(rawCorpus);
    const deniedSemantic = {
      retrieve: async () => {
        throw new SemanticEmbeddingError({
          code: 'POLICY_DENIED',
          safeMessage: 'Semantic embedding policy denied for this fixture lane.',
          operation: 'wp5-fixture-policy',
        });
      },
    };
    const fallbackCoordinator = new HybridRetrievalCoordinator(
      lexical,
      deniedSemantic,
      undefined,
      {
        getEvidenceSpan: async (requestedProjectId, evidenceId) =>
          requestedProjectId === projectId ? createEvidence(rawCorpus)[evidenceId] : undefined,
      },
      {
        getSourceVersion: async (requestedProjectId, sourceVersionId) => {
          const claim = semanticClaims(rawCorpus).find(
            (entry) => entry.semanticSourceVersionId === sourceVersionId,
          );
          return claim && requestedProjectId === projectId
            ? { sourceVersionId, projectId, sourceId: `source-${claim.goldenClaimId}` }
            : undefined;
        },
      },
      undefined,
      undefined,
      { clock: () => timestamp },
    );
    const fallback = await fallbackCoordinator.search({
      projectId,
      query: 'Release trains ship weekly',
      accessScopes: ['owner'],
      allowedSensitivities: ['public'],
      limit: 3,
    });
    expect(fallback.readiness.semantic.status).toBe('DEGRADED');
    expect(fallback.items[0]?.resourceId).toBe('r-release-claim');

    const serialized = JSON.stringify({ observations, evaluation: artifact.run });
    expect(serialized).not.toContain('Release trains ship weekly');
    expect(serialized).not.toContain('프로젝트 코드명 Atlas');
    expect(serialized).not.toMatch(/r4-test-secret|apiKey|credentialBytes/i);
  });

  it('records measured local retrieval latency without asserting an invented universal threshold', async () => {
    const rawCorpus = await loadAkp1SemanticCorpus();
    const rig = await createRig(rawCorpus);
    const coordinator = rig.createCoordinator('hybrid');
    const query = semanticQueryById(rawCorpus, 'q-release-ambiguous-neighbor');
    for (let index = 0; index < 3; index++) {
      await coordinator.search({
        projectId,
        query: query.queryText,
        accessScopes: ['owner'],
        allowedSensitivities: ['public'],
        limit: 3,
      });
    }
    const samples: number[] = [];
    for (let index = 0; index < 15; index++) {
      const started = performance.now();
      await coordinator.search({
        projectId,
        query: query.queryText,
        accessScopes: ['owner'],
        allowedSensitivities: ['public'],
        limit: 3,
      });
      samples.push(performance.now() - started);
    }
    const measured = medianAndP95(samples);
    expect(samples).toHaveLength(15);
    expect(Number.isFinite(measured.medianMs)).toBe(true);
    expect(Number.isFinite(measured.p95Ms)).toBe(true);
    console.info(
      `[WP5 measured] hybrid semantic query=${query.queryId} samples=${samples.length} medianMs=${measured.medianMs.toFixed(3)} p95Ms=${measured.p95Ms.toFixed(3)}`,
    );
  });
});
