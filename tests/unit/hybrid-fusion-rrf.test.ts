import { describe, expect, it } from 'vitest';
import {
  type EvidenceSpan,
  type KnowledgeResourceResolverPort,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateResult,
  type SemanticProjectionGeneration,
  type SemanticResourceType,
  type SemanticRetrieverPort,
  type SourceVersionResolverPort,
} from '../../packages/contracts/src/index.js';
import {
  type EvidenceSpanResolverPort,
  HybridRetrievalCoordinator,
} from '../../modules/hybrid-retrieval/src/index.js';

describe('Hybrid Fusion (RRF) & Coordinator Unit Tests', () => {
  const createEvidenceSpan = (evidenceId: string): EvidenceSpan => ({
    evidenceId,
    revisionId: 'rev-1',
    projectId: 'proj-alpha',
    sourceId: 'src-1',
    sourceVersionId: 'src-ver-1',
    pointer: '/blocks/0/sentences/0',
    nodeKind: 'sentence',
    origin: 'source',
    position: { type: 'TextPositionSelector', start: 0, end: 30, unit: 'unicode-code-point' },
    quote: { type: 'TextQuoteSelector', exact: 'Quarterly revenue was 100M.' },
    exactHash: 'sha256:exact',
    accessScope: ['finance'],
    sensitivity: 'internal',
    createdAt: '2026-08-18T10:00:00.000Z',
  });

  const createRig = (options?: {
    readonly lexicalItems?: readonly LexicalCandidateResult[];
    readonly semanticItems?: readonly SemanticCandidateResult[];
    readonly resourceResolver?: KnowledgeResourceResolverPort;
    readonly fusionPolicy?: {
      readonly k?: number;
      readonly lexicalWeight?: number;
      readonly semanticWeight?: number;
    };
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

    const defaultResourceResolver: KnowledgeResourceResolverPort = {
      resolveResource: async (_projId, resourceType, resourceId) => ({
        text: `Authoritative content for ${resourceType}:${resourceId}`,
        canonicalVersion: 1,
        evidenceIds: [`ev-${resourceId}`],
        sourceVersionId: 'src-ver-1',
      }),
    };

    const evidenceResolver: EvidenceSpanResolverPort = {
      getEvidenceSpan: async (_projId, evId) => createEvidenceSpan(evId),
    };

    const sourceVersionResolver: SourceVersionResolverPort = {
      getSourceVersion: async (_projId, sourceVersionId) => ({
        sourceVersionId,
        projectId: 'proj-alpha',
        sourceId: 'src-1',
      }),
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
      options?.resourceResolver ?? defaultResourceResolver,
      evidenceResolver,
      sourceVersionResolver,
      activeGenerationReader,
      undefined,
      {
        clock: () => '2026-08-18T12:00:00.000Z',
        fusionPolicy: options?.fusionPolicy,
      },
    );

    return { coordinator };
  };

  it('fuses candidates from lexical-only, semantic-only, and dual participation correctly', async () => {
    // Lexical items:
    // Rank 1: claim-1 (also in semantic rank 2) -> HYBRID
    // Rank 2: claim-2 (only in lexical) -> LEXICAL
    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-1',
        canonicalVersion: 1,
        claimText: 'Revenue reached 100M.',
        sourceVersionId: 'src-ver-1',
        evidenceIds: ['ev-1'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        score: 0.9,
        matchType: 'FULL_TEXT',
        rank: 1,
      },
      {
        claimId: 'claim-2',
        commitId: 'commit-2',
        revisionId: 'rev-2',
        canonicalVersion: 1,
        claimText: 'Operating margin expanded.',
        sourceVersionId: 'src-ver-2',
        evidenceIds: ['ev-2'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        score: 0.7,
        matchType: 'TRIGRAM',
        rank: 2,
      },
    ];

    // Semantic items:
    // Rank 1: claim-3 (only in semantic) -> SEMANTIC
    // Rank 2: claim-1 (also in lexical rank 1) -> HYBRID
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-3',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'CLAIM',
        resourceId: 'claim-3',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-3',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-3'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
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
        distance: 0.15,
        dimension: 768,
        evidenceIds: ['ev-1'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({ lexicalItems, semanticItems });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'revenue performance',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
      limit: 10,
    });

    expect(response.items).toHaveLength(3);

    // Rank 1: claim-1 (dual channel HYBRID)
    expect(response.items[0]!.resourceId).toBe('claim-1');
    expect(response.items[0]!.fusionRank).toBe(1);
    expect(response.items[0]!.signals).toEqual(['HYBRID', 'LEXICAL', 'SEMANTIC']);
    expect(response.items[0]!.lexicalRank).toBe(1);
    expect(response.items[0]!.semanticRank).toBe(2);
    expect(response.items[0]!.fusionScore).toBeCloseTo(1 / 61 + 1 / 62, 6);

    // Rank 2: claim-3 (SEMANTIC only)
    expect(response.items[1]!.resourceId).toBe('claim-3');
    expect(response.items[1]!.fusionRank).toBe(2);
    expect(response.items[1]!.signals).toEqual(['SEMANTIC']);
    expect(response.items[1]!.lexicalRank).toBeUndefined();
    expect(response.items[1]!.semanticRank).toBe(1);
    expect(response.items[1]!.fusionScore).toBeCloseTo(1 / 61, 6);
    expect(response.items[1]!.text).toBe('Authoritative content for CLAIM:claim-3');

    // Rank 3: claim-2 (LEXICAL only)
    expect(response.items[2]!.resourceId).toBe('claim-2');
    expect(response.items[2]!.fusionRank).toBe(3);
    expect(response.items[2]!.signals).toEqual(['LEXICAL']);
    expect(response.items[2]!.lexicalRank).toBe(2);
    expect(response.items[2]!.semanticRank).toBeUndefined();
    expect(response.items[2]!.fusionScore).toBeCloseTo(1 / 62, 6);
  });

  it('performs deterministic tie-breaking on score tie', async () => {
    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-02',
        commitId: 'commit-2',
        revisionId: 'rev-2',
        canonicalVersion: 1,
        claimText: 'Claim 2',
        sourceVersionId: 'src-ver-2',
        evidenceIds: ['ev-claim-2'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        score: 0.9,
        matchType: 'FULL_TEXT',
        rank: 1,
      },
    ];

    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-dec',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'DECISION',
        resourceId: 'dec-01',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-dec',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-dec-1'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({ lexicalItems, semanticItems });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'search query',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.items).toHaveLength(2);
    expect(response.items[0]!.fusionScore).toBeCloseTo(response.items[1]!.fusionScore, 6);

    // Tied score 1/61: 'CLAIM' < 'DECISION'
    expect(response.items[0]!.resourceType).toBe('CLAIM');
    expect(response.items[0]!.resourceId).toBe('claim-02');

    expect(response.items[1]!.resourceType).toBe('DECISION');
    expect(response.items[1]!.resourceId).toBe('dec-01');
  });

  it('resolves semantic-only resource content for all 6 allowed resource types', async () => {
    const resourceTypes: readonly SemanticResourceType[] = [
      'CLAIM',
      'FACT',
      'ENTITY',
      'RELATION',
      'EVENT',
      'DECISION',
    ];

    const semanticItems: SemanticCandidateResult[] = resourceTypes.map((type, idx) => ({
      semanticItemId: `sem-${type.toLowerCase()}`,
      projectId: 'proj-alpha',
      generationId: 'gen-001',
      resourceType: type,
      resourceId: `${type.toLowerCase()}-${idx + 1}`,
      sourceProjectionDigest: 'sha256:src-digest',
      canonicalVersion: 1,
      semanticTextDigest: `sha256:text-${type}`,
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: 'semantic-representation:v1',
      distance: 0.1,
      dimension: 768,
      evidenceIds: [`ev-${type.toLowerCase()}`],
      accessScope: ['finance'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    }));

    const { coordinator } = createRig({
      lexicalItems: [],
      semanticItems,
      resourceResolver: {
        resolveResource: async (_projId, resourceType, resourceId) => ({
          text: `Authoritative resolved content for ${resourceType}:${resourceId}`,
          canonicalVersion: 2,
          evidenceIds: [`ev-${resourceType.toLowerCase()}`],
          sourceVersionId: 'src-ver-1',
        }),
      },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'search all types',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
      limit: 10,
    });

    expect(response.items).toHaveLength(6);
    for (const item of response.items) {
      expect(item.text).toBe(
        `Authoritative resolved content for ${item.resourceType}:${item.resourceId}`,
      );
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.canonicalVersion).toBe(2);
    }
  });

  it('fails closed when semantic resource identity cannot be resolved', async () => {
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-unresolved',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'FACT',
        resourceId: 'fact-missing',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-missing',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-fact'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({
      lexicalItems: [],
      semanticItems,
      resourceResolver: {
        resolveResource: async () => undefined,
      },
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'search query',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow('could not be resolved from authoritative knowledge');
  });

  it('respects internal test-configured RRF fusion policy', async () => {
    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-1',
        canonicalVersion: 1,
        claimText: 'Claim 1',
        sourceVersionId: 'src-ver-1',
        evidenceIds: ['ev-1'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        score: 0.9,
        matchType: 'FULL_TEXT',
        rank: 1,
      },
    ];

    const { coordinator } = createRig({
      lexicalItems,
      semanticItems: [],
      fusionPolicy: { k: 20, lexicalWeight: 2.0 },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'query',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.fusionPolicy.k).toBe(20);
    expect(response.fusionPolicy.lexicalWeight).toBe(2.0);
    // Score = 2.0 / (20 + 1) = 2/21
    expect(response.items[0]!.fusionScore).toBeCloseTo(2 / 21, 6);
  });
});
