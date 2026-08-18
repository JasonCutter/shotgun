import { describe, expect, it } from 'vitest';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  type EvidenceSpan,
  type HybridSearchRequest,
  type HybridSearchResponse,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateResult,
  type SemanticProjectionGeneration,
  type SemanticRetrieverPort,
  createQuery,
  ShotgunKernel,
} from '../../packages/kernel/src/index.js';
import {
  type EvidenceSpanResolverPort,
  HybridRetrievalCoordinator,
  createHybridRetrievalModule,
} from '../../modules/hybrid-retrieval/src/index.js';

describe('SearchHybridKnowledge Contract Test', () => {
  const createHarness = (options?: {
    readonly lexicalItems?: readonly LexicalCandidateResult[];
    readonly semanticItems?: readonly SemanticCandidateResult[];
    readonly evidenceSpans?: Record<string, EvidenceSpan>;
  }) => {
    const lexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: options?.lexicalItems ?? [],
        readiness: {
          status: 'READY',
          projectedCanonicalVersion: 1,
          canonicalVersion: 1,
          lag: 0,
          canonicalSnapshotDigest: 'sha256:snap-1',
        },
      }),
    };

    const semanticRetriever: SemanticRetrieverPort = {
      retrieve: async () => options?.semanticItems ?? [],
    };

    const evidenceResolver: EvidenceSpanResolverPort = {
      getEvidenceSpan: async (_projId, evId) =>
        options?.evidenceSpans?.[evId] ?? {
          evidenceId: evId,
          revisionId: 'rev-1',
          projectId: 'proj-alpha',
          sourceId: 'src-1',
          sourceVersionId: 'src-ver-1',
          pointer: '/blocks/0',
          nodeKind: 'paragraph',
          origin: 'source',
          position: { type: 'TextPositionSelector', start: 0, end: 30, unit: 'unicode-code-point' },
          quote: { type: 'TextQuoteSelector', exact: 'Exact quote in evidence.' },
          exactHash: 'sha256:exact',
          accessScope: ['owner'],
          sensitivity: 'internal',
          createdAt: '2026-08-18T10:00:00.000Z',
        },
    };

    const sampleGeneration: SemanticProjectionGeneration = {
      projectId: 'proj-alpha',
      generationId: 'gen-001',
      sourceProjectionDigest: 'sha256:src-digest',
      canonicalBaseVersion: 1,
      credentialId: 'cred-1',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:policy-fp',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'prov-reg:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      representationVersion: 'semantic-representation:v1',
      dimension: 768,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const activeGenerationReader: SemanticActiveGenerationReaderPort = {
      getActiveGeneration: async () => sampleGeneration,
    };

    const coordinator = new HybridRetrievalCoordinator(
      lexicalRetriever,
      semanticRetriever,
      evidenceResolver,
      activeGenerationReader,
      undefined,
      { clock: () => '2026-08-18T12:00:00.000Z' },
    );

    const hybridModule = createHybridRetrievalModule(coordinator);
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(hybridModule);

    return { kernel, coordinator };
  };

  it('executes SearchHybridKnowledge query over Kernel and matches output schema', async () => {
    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-1',
        canonicalVersion: 1,
        claimText: 'Revenue reached 100M.',
        sourceVersionId: 'src-ver-1',
        evidenceIds: ['ev-1'],
        accessScope: ['owner'],
        sensitivity: 'internal',
        score: 0.9,
        matchType: 'FULL_TEXT',
        rank: 1,
      },
    ];

    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-1',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'CLAIM',
        resourceId: 'claim-1',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-1',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-1'],
        accessScope: ['owner'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { kernel } = createHarness({ lexicalItems, semanticItems });
    await kernel.start();

    const query = createQuery<HybridSearchRequest>({
      messageType: 'SearchHybridKnowledge',
      schemaVersion: '1.0.0',
      producerModule: 'test-client',
      producerVersion: '1.0.0',
      projectId: 'proj-alpha',
      actor: { type: 'user', id: 'user-1' },
      security: { accessScope: ['owner'], sensitivity: 'internal', dataClassification: 'internal' },
      payload: {
        query: 'revenue performance',
        limit: 5,
      },
    });

    const delivery = await kernel.connector.query<HybridSearchResponse>(query);
    const response = delivery.result.payload;

    expect(response.schemaVersion).toBe('1.0.0');
    expect(response.projectId).toBe('proj-alpha');
    expect(response.query).toBe('revenue performance');
    expect(response.readiness.lexical.status).toBe('READY');
    expect(response.readiness.semantic.status).toBe('READY');
    expect(response.readiness.degraded).toBe(false);

    expect(response.items).toHaveLength(1);
    const item = response.items[0]!;
    expect(item.resourceType).toBe('CLAIM');
    expect(item.resourceId).toBe('claim-1');
    expect(item.fusionRank).toBe(1);
    expect(item.signals).toEqual(['HYBRID', 'LEXICAL', 'SEMANTIC']);
    expect(item.citations).toHaveLength(1);
    expect(item.citations[0]!.evidenceId).toBe('ev-1');
    expect(item.citations[0]!.exactQuote).toBe('Exact quote in evidence.');
  });

  it('rejects query when security context is incomplete', async () => {
    const { kernel } = createHarness();
    await kernel.start();

    const query = createQuery<HybridSearchRequest>({
      messageType: 'SearchHybridKnowledge',
      schemaVersion: '1.0.0',
      producerModule: 'test-client',
      producerVersion: '1.0.0',
      projectId: '',
      actor: { type: 'user', id: '' },
      security: { accessScope: [], sensitivity: 'internal', dataClassification: '' },
      payload: { query: 'test' },
    });

    await expect(kernel.connector.query(query)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
});
