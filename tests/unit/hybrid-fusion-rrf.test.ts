import { describe, expect, it } from 'vitest';
import {
  type CompiledTruthProjection,
  type EvidenceSpan,
  type KnowledgeCandidate,
  type KnowledgeResourceResolverPort,
  type KnowledgeReviewGroup,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type ProjectionReadiness,
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateResult,
  type SemanticProjectionGeneration,
  type SemanticRetrieverPort,
  type SourceVersionResolverPort,
} from '../../packages/contracts/src/index.js';
import {
  type CanonicalClaimReaderPort,
  type CompiledTruthReaderPort,
  type EvidenceSpanResolverPort,
  HybridRetrievalCoordinator,
  type KnowledgeModelReaderPort,
  ProductKnowledgeResourceResolver,
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
    readonly lexicalReadiness?: ProjectionReadiness;
    readonly semanticItems?: readonly SemanticCandidateResult[];
    readonly resourceResolver?: KnowledgeResourceResolverPort;
    readonly evidenceResolver?: EvidenceSpanResolverPort;
    readonly sourceVersionResolver?: SourceVersionResolverPort;
    readonly fusionPolicy?: {
      readonly k?: number;
      readonly lexicalWeight?: number;
      readonly semanticWeight?: number;
    };
  }) => {
    const lexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: options?.lexicalItems ?? [],
        readiness: options?.lexicalReadiness ?? {
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
      resolveResource: async (_projId, resourceType, resourceId) => {
        const matchingSem = options?.semanticItems?.find(
          (s) => s.resourceType === resourceType && s.resourceId === resourceId,
        );
        return {
          text: `Authoritative content for ${resourceType}:${resourceId}`,
          canonicalVersion: matchingSem?.canonicalVersion ?? 1,
          sourceVersionId: 'src-ver-1',
          evidenceIds: matchingSem?.evidenceIds ? [...matchingSem.evidenceIds] : ['ev-1'],
          accessScope: matchingSem?.accessScope ? [...matchingSem.accessScope] : ['finance'],
          sensitivity: matchingSem?.sensitivity ?? 'internal',
        };
      },
    };

    const evidenceResolver: EvidenceSpanResolverPort = options?.evidenceResolver ?? {
      getEvidenceSpan: async (_projId, evId) => createEvidenceSpan(evId),
    };

    const sourceVersionResolver: SourceVersionResolverPort = options?.sourceVersionResolver ?? {
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

  it('performs deterministic locale-independent UTF-16 code-unit tie-breaking on score tie', async () => {
    // UTF-16 code unit ordering: 'B' (0x42) < 'a' (0x61), 'Z' (0x5A) < 'a' (0x61)
    // whereas in many natural language locales 'a' < 'B'
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-lower',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'CLAIM',
        resourceId: 'a-item',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-lower',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-lower'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-upper',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'CLAIM',
        resourceId: 'B-item',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-upper',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-upper'],
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
        resolveResource: async (_p, _rType, rId) => ({
          text: `Text for ${rId}`,
          canonicalVersion: 1,
          sourceVersionId: 'src-ver-1',
          evidenceIds: [rId === 'a-item' ? 'ev-lower' : 'ev-upper'],
          accessScope: ['finance'],
          sensitivity: 'internal',
        }),
      },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'test query',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.items).toHaveLength(2);
    // Rank 1 item in semanticItems was 'a-item', rank 2 was 'B-item'.
    // With semanticRank 1 (score 1/61) and semanticRank 2 (score 1/62), rank 1 wins.
    // Now let's test tie-break when scores are equal:
    const equalSemanticItems: SemanticCandidateResult[] = [
      { ...semanticItems[0]!, resourceId: 'a-item' },
    ];
    const equalLexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'B-item',
        commitId: 'c-1',
        revisionId: 'r-1',
        canonicalVersion: 1,
        claimText: 'B item text',
        sourceVersionId: 'src-ver-1',
        evidenceIds: ['ev-upper'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        score: 0.9,
        matchType: 'FULL_TEXT',
        rank: 1, // Score 1/61
      },
    ];

    const { coordinator: tieCoordinator } = createRig({
      lexicalItems: equalLexicalItems,
      semanticItems: equalSemanticItems,
    });

    const tieResponse = await tieCoordinator.search({
      projectId: 'proj-alpha',
      query: 'test query',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(tieResponse.items).toHaveLength(2);
    expect(tieResponse.items[0]!.fusionScore).toBeCloseTo(tieResponse.items[1]!.fusionScore, 6);
    // Code unit comparison: 'B-item' (0x42) < 'a-item' (0x61)
    expect(tieResponse.items[0]!.resourceId).toBe('B-item');
    expect(tieResponse.items[1]!.resourceId).toBe('a-item');
  });

  it('ProductKnowledgeResourceResolver authoritatively resolves all six frozen semantic resource types', async () => {
    const canonicalKnowledge: CanonicalClaimReaderPort = {
      findClaim: async (projId, claimId) => {
        if (projId === 'proj-alpha' && claimId === 'claim-auth-1') {
          return {
            claimId: 'claim-auth-1',
            projectId: 'proj-alpha',
            revisionNumber: 1,
            claimText: 'Authoritative claim statement.',
            sourceVersionId: 'src-ver-1',
            evidenceIds: ['ev-claim-1'],
            createdFromManifestId: null,
            authorityId: null,
            authorityDigest: null,
            accessScope: ['finance'],
            sensitivity: 'internal',
            createdAt: '2026-08-18T10:00:00.000Z',
          };
        }
        return undefined;
      },
    };

    const approvedEntity: KnowledgeCandidate = {
      candidateId: 'entity-1',
      candidateType: 'ENTITY',
      name: 'Acme Corporation',
      entityKind: 'ORGANIZATION',
      aliases: ['Acme'],
      resolution: { status: 'NEW' },
      revisionNumber: 1,
      sourceVersionId: 'src-ver-1',
      evidenceIds: ['ev-entity-1'],
      modelOutputs: [],
    };

    const approvedRelation: KnowledgeCandidate = {
      candidateId: 'rel-1',
      candidateType: 'RELATION',
      fromCandidateId: 'entity-1',
      toCandidateId: 'entity-2',
      relationType: 'SUBSIDIARY_OF',
      direction: 'DIRECTED',
      revisionNumber: 1,
      sourceVersionId: 'src-ver-1',
      evidenceIds: ['ev-rel-1'],
      modelOutputs: [],
    };

    const approvedEvent: KnowledgeCandidate = {
      candidateId: 'event-1',
      candidateType: 'EVENT',
      title: 'Annual Shareholder Meeting',
      participantCandidateIds: ['entity-1'],
      revisionNumber: 1,
      sourceVersionId: 'src-ver-1',
      evidenceIds: ['ev-event-1'],
      modelOutputs: [],
    };

    const approvedDecision: KnowledgeCandidate = {
      candidateId: 'dec-1',
      candidateType: 'DECISION',
      decisionText: 'Approved dividend payout of $2.50 per share.',
      revisionNumber: 1,
      sourceVersionId: 'src-ver-1',
      evidenceIds: ['ev-dec-1'],
      modelOutputs: [],
    };

    const knowledgeReviewGroup: KnowledgeReviewGroup = {
      groupId: 'grp-1',
      projectId: 'proj-alpha',
      revisionNumber: 1,
      sourceVersionId: 'src-ver-1',
      contentDigest: 'sha256:grp-digest',
      status: 'APPROVED',
      accessScope: ['finance'],
      sensitivity: 'internal',
      items: [approvedEntity, approvedRelation, approvedEvent, approvedDecision],
      decisions: [],
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const knowledgeModel: KnowledgeModelReaderPort = {
      listGroups: async (projId) => (projId === 'proj-alpha' ? [knowledgeReviewGroup] : []),
    };

    const compiledProjection: CompiledTruthProjection = {
      projectId: 'proj-alpha',
      projectorVersion: '1.0.0',
      sourceSnapshotDigest: 'sha256:snap-digest',
      logicalDigest: 'sha256:logical-digest',
      canonicalVersion: 3,
      items: [
        {
          id: 'claim-auth-1',
          type: 'CLAIM',
          label: 'Compiled Truth claim label.',
          state: 'CURRENT',
          source: 'CANONICAL_CLAIM',
          evidenceIds: ['ev-claim-1'],
          accessScope: ['finance'],
          sensitivity: 'internal',
        },
        {
          id: 'fact-1',
          type: 'CLAIM',
          label: 'Q2 revenue: $100M USD',
          state: 'CURRENT',
          source: 'APPROVED_KNOWLEDGE',
          evidenceIds: ['ev-fact-1'],
          accessScope: ['finance'],
          sensitivity: 'internal',
        },
      ],
      graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
      projectedAt: '2026-08-18T10:00:00.000Z',
      buildMode: 'FULL_REBUILD',
    };

    const compiledTruth: CompiledTruthReaderPort = {
      findProjection: async (projId) => (projId === 'proj-alpha' ? compiledProjection : undefined),
    };

    const resolver = new ProductKnowledgeResourceResolver(
      canonicalKnowledge,
      knowledgeModel,
      compiledTruth,
    );

    // 1. Resolve CLAIM
    const claimRes = await resolver.resolveResource('proj-alpha', 'CLAIM', 'claim-auth-1');
    expect(claimRes).toBeDefined();
    expect(claimRes?.text).toBe('Authoritative claim statement.');
    expect(claimRes?.sourceVersionId).toBe('src-ver-1');
    expect(claimRes?.evidenceIds).toEqual(['ev-claim-1']);
    // Do NOT hardcode canonicalVersion: 1
    expect(claimRes?.canonicalVersion).toBeUndefined();

    // 1b. Resolve the same Claim through the Compiled Truth authority path.
    const compiledClaimRes = await resolver.resolveResource(
      'proj-alpha',
      'CLAIM',
      'claim-auth-1',
      'COMPILED_TRUTH',
    );
    expect(compiledClaimRes).toBeDefined();
    expect(compiledClaimRes?.text).toBe('Compiled Truth claim label.');
    expect(compiledClaimRes?.authority).toBe('COMPILED_TRUTH');
    expect(compiledClaimRes?.authorityRevision).toBe(3);
    expect(compiledClaimRes?.resourceRevision).toBe(1);
    expect(compiledClaimRes?.baseCanonicalVersion).toBe(3);
    expect(compiledClaimRes?.sourceSnapshotDigest).toBe('sha256:snap-digest');
    expect(compiledClaimRes?.sourceProjectionDigest).toBe('sha256:snap-digest');
    expect(compiledClaimRes?.sourceVersionId).toBe('src-ver-1');
    expect(compiledClaimRes?.evidenceIds).toEqual(['ev-claim-1']);
    expect(compiledClaimRes?.accessScope).toEqual(['finance']);
    expect(compiledClaimRes?.sensitivity).toBe('internal');

    // 2. Resolve ENTITY
    const entityRes = await resolver.resolveResource('proj-alpha', 'ENTITY', 'entity-1');
    expect(entityRes).toBeDefined();
    expect(entityRes?.text).toBe('Acme Corporation');
    expect(entityRes?.evidenceIds).toEqual(['ev-entity-1']);

    // 3. Resolve RELATION
    const relRes = await resolver.resolveResource('proj-alpha', 'RELATION', 'rel-1');
    expect(relRes).toBeDefined();
    expect(relRes?.text).toBe('entity-1 SUBSIDIARY_OF entity-2');
    expect(relRes?.evidenceIds).toEqual(['ev-rel-1']);

    // 4. Resolve EVENT
    const eventRes = await resolver.resolveResource('proj-alpha', 'EVENT', 'event-1');
    expect(eventRes).toBeDefined();
    expect(eventRes?.text).toBe('Annual Shareholder Meeting');
    expect(eventRes?.evidenceIds).toEqual(['ev-event-1']);

    // 5. Resolve DECISION
    const decRes = await resolver.resolveResource('proj-alpha', 'DECISION', 'dec-1');
    expect(decRes).toBeDefined();
    expect(decRes?.text).toBe('Approved dividend payout of $2.50 per share.');
    expect(decRes?.evidenceIds).toEqual(['ev-dec-1']);

    // 6. FACT returns undefined under ADR-147
    const factRes = await resolver.resolveResource('proj-alpha', 'FACT', 'fact-1');
    expect(factRes).toBeUndefined();

    // 7. CLAIM missing from Canonical Knowledge MUST NOT fall back to Compiled Truth
    const missingClaimRes = await resolver.resolveResource('proj-alpha', 'CLAIM', 'fact-1');
    expect(missingClaimRes).toBeUndefined();
  });

  it('degrades semantic channel gracefully to healthy lexical results when duplicate candidates have version mismatch', async () => {
    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-1',
        canonicalVersion: 1, // Version 1 in Lexical
        claimText: 'Revenue was 100M.',
        sourceVersionId: 'src-ver-1',
        evidenceIds: ['ev-1'],
        accessScope: ['finance'],
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
        canonicalVersion: 2, // Incompatible Version 2 in Semantic!
        semanticTextDigest: 'sha256:text-1',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
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
      query: 'revenue',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]!.resourceId).toBe('claim-1');
    expect(response.items[0]!.signals).toEqual(['LEXICAL']);
    expect(response.readiness.semantic.status).toBe('DEGRADED');
    expect(response.readiness.degraded).toBe(true);
  });

  it('fails closed when semantic candidate version mismatches authoritative resolved resource version and lexical is stale', async () => {
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-dec-1',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'DECISION',
        resourceId: 'dec-1',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1, // Candidate carries Version 1
        semanticTextDigest: 'sha256:text-dec',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-1'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({
      lexicalReadiness: {
        status: 'STALE',
        projectedCanonicalVersion: 0,
        canonicalVersion: 1,
        lag: 1,
        canonicalSnapshotDigest: 'sha256:snap',
      },
      semanticItems,
      resourceResolver: {
        resolveResource: async () => ({
          text: 'Decision text',
          canonicalVersion: 2, // Authoritative resolver returns Version 2!
          evidenceIds: ['ev-1'],
          sourceVersionId: 'src-ver-1',
        }),
      },
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'revenue decision',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow('resolved canonical version 2 !== candidate version 1');
  });

  it('allows candidate evidence that is a valid subset of authoritative resolved resource evidence', async () => {
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-dec-1',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'DECISION',
        resourceId: 'dec-1',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-dec',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-1'], // Candidate carries subset ['ev-1']
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({
      semanticItems,
      resourceResolver: {
        resolveResource: async () => ({
          text: 'Approved annual budget.',
          canonicalVersion: 1,
          evidenceIds: ['ev-1', 'ev-2'], // Authoritative resource has superset ['ev-1', 'ev-2']
          accessScope: ['finance'],
          sensitivity: 'internal',
          sourceVersionId: 'src-ver-1',
        }),
      },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'budget decision',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]!.resourceId).toBe('dec-1');
  });

  it('fails closed when candidate evidence contains extra stale IDs not in authoritative evidence and lexical is stale', async () => {
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-dec-1',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'DECISION',
        resourceId: 'dec-1',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-dec',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-1', 'ev-stale-99'], // Candidate contains stale evidence not in authoritative!
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({
      lexicalReadiness: {
        status: 'STALE',
        projectedCanonicalVersion: 0,
        canonicalVersion: 1,
        lag: 1,
        canonicalSnapshotDigest: 'sha256:snap',
      },
      semanticItems,
      resourceResolver: {
        resolveResource: async () => ({
          text: 'Decision text',
          canonicalVersion: 1,
          evidenceIds: ['ev-1'], // Authoritative evidence has only ['ev-1']
          accessScope: ['finance'],
          sensitivity: 'internal',
          sourceVersionId: 'src-ver-1',
        }),
      },
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'decision query',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow('is not a subset of authoritative evidence');
  });

  it('fails closed when authoritative resolved resource sensitivity mismatches candidate or exceeds clearance and lexical is stale', async () => {
    const semanticItems: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-dec-1',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'DECISION',
        resourceId: 'dec-1',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-dec',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-1'],
        accessScope: ['finance'],
        sensitivity: 'internal', // Projected as internal
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    const { coordinator } = createRig({
      lexicalReadiness: {
        status: 'STALE',
        projectedCanonicalVersion: 0,
        canonicalVersion: 1,
        lag: 1,
        canonicalSnapshotDigest: 'sha256:snap',
      },
      semanticItems,
      resourceResolver: {
        resolveResource: async () => ({
          text: 'Restricted decision text',
          canonicalVersion: 1,
          evidenceIds: ['ev-1'],
          sourceVersionId: 'src-ver-1',
          sensitivity: 'restricted', // Authoritative state is restricted!
        }),
      },
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'decision query',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow(
      "Caller lacks clearance for resolved resource DECISION:dec-1 sensitivity 'restricted'",
    );
  });
});
