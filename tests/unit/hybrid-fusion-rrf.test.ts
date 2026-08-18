import { describe, expect, it } from 'vitest';
import {
  type EvidenceSpan,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateResult,
  type SemanticProjectionGeneration,
  type SemanticRetrieverPort,
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
      getEvidenceSpan: async (_projId, evId) => createEvidenceSpan(evId),
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

    // Score calculations with k = 60:
    // claim-1: 1/(60+1) + 1/(60+2) = 1/61 + 1/62 = 0.0163934 + 0.0161290 = 0.0325225
    // claim-3: 1/(60+1) = 1/61 = 0.0163934
    // claim-2: 1/(60+2) = 1/62 = 0.0161290

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

    // Rank 3: claim-2 (LEXICAL only)
    expect(response.items[2]!.resourceId).toBe('claim-2');
    expect(response.items[2]!.fusionRank).toBe(3);
    expect(response.items[2]!.signals).toEqual(['LEXICAL']);
    expect(response.items[2]!.lexicalRank).toBe(2);
    expect(response.items[2]!.semanticRank).toBeUndefined();
    expect(response.items[2]!.fusionScore).toBeCloseTo(1 / 62, 6);
  });

  it('performs deterministic tie-breaking on score tie', async () => {
    // We construct two candidates that receive identical RRF fusion scores (1/61 each):
    // 1. claim-02 from lexical search (rank 1 -> 1/61)
    // 2. dec-01 from semantic search (rank 1 -> 1/61)
    // 3. claim-01 from another equal channel (or another tie test)
    //
    // Tied fusionScore: 1/61.
    // Order should be:
    // 1. CLAIM:claim-02 (resourceType 'CLAIM' < 'DECISION')
    // 2. DECISION:dec-01
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
      fusionPolicy: { k: 60, lexicalWeight: 1, semanticWeight: 1 },
    });

    expect(response.items).toHaveLength(2);
    expect(response.items[0]!.fusionScore).toBeCloseTo(response.items[1]!.fusionScore, 6);

    // Tied score 1/61: 'CLAIM' < 'DECISION'
    expect(response.items[0]!.resourceType).toBe('CLAIM');
    expect(response.items[0]!.resourceId).toBe('claim-02');

    expect(response.items[1]!.resourceType).toBe('DECISION');
    expect(response.items[1]!.resourceId).toBe('dec-01');
  });

  it('respects custom RRF k parameter and weights', async () => {
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

    const { coordinator } = createRig({ lexicalItems, semanticItems: [] });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'query',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
      fusionPolicy: { k: 20, lexicalWeight: 2.0 },
    });

    expect(response.fusionPolicy.k).toBe(20);
    expect(response.fusionPolicy.lexicalWeight).toBe(2.0);
    // Score = 2.0 / (20 + 1) = 2/21
    expect(response.items[0]!.fusionScore).toBeCloseTo(2 / 21, 6);
  });
});
