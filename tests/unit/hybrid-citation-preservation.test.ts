import { describe, expect, it } from 'vitest';
import {
  type EvidenceSpan,
  type KnowledgeResourceResolverPort,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateResult,
  type SemanticProjectionGeneration,
  type SemanticRetrieverPort,
  type SourceVersionInfo,
  type SourceVersionResolverPort,
} from '../../packages/contracts/src/index.js';
import {
  type EvidenceSpanResolverPort,
  HybridRetrievalCoordinator,
} from '../../modules/hybrid-retrieval/src/index.js';

describe('Hybrid Citation Lineage Preservation Unit Tests', () => {
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

  const createRig = (options?: {
    readonly lexicalItems?: readonly LexicalCandidateResult[];
    readonly semanticItems?: readonly SemanticCandidateResult[];
    readonly evidenceSpans?: Record<string, EvidenceSpan>;
    readonly sourceVersions?: Record<string, SourceVersionInfo>;
    readonly resourceResolver?: KnowledgeResourceResolverPort;
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
      getEvidenceSpan: async (_projId, evId) => options?.evidenceSpans?.[evId],
    };

    const sourceVersionResolver: SourceVersionResolverPort = {
      getSourceVersion: async (_projId, sourceVersionId) =>
        options?.sourceVersions
          ? options.sourceVersions[sourceVersionId]
          : {
              sourceVersionId,
              projectId: 'proj-alpha',
              sourceId: 'doc-source-1',
            },
    };

    const defaultResourceResolver: KnowledgeResourceResolverPort = {
      resolveResource: async (_projId, resourceType, resourceId) => ({
        text: `Authoritative text for ${resourceType}:${resourceId}`,
        canonicalVersion: 1,
        evidenceIds: [`ev-${resourceId}`],
        sourceVersionId: 'src-ver-101',
      }),
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
      { clock: () => '2026-08-18T12:00:00.000Z' },
    );

    return { coordinator };
  };

  it('attaches verified EvidenceSpan and SourceVersion citation lineage to each result', async () => {
    const span1: EvidenceSpan = {
      evidenceId: 'ev-1',
      revisionId: 'rev-101',
      projectId: 'proj-alpha',
      sourceId: 'doc-source-1',
      sourceVersionId: 'src-ver-101',
      pointer: '/blocks/0/sentences/0',
      nodeKind: 'sentence',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 10, end: 50, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Quarterly revenue reached 500M in Q2.' },
      exactHash: 'sha256:exact1',
      accessScope: ['finance'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-101',
        canonicalVersion: 1,
        claimText: 'Quarterly revenue reached 500M in Q2.',
        sourceVersionId: 'src-ver-101',
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
      evidenceSpans: { 'ev-1': span1 },
      sourceVersions: {
        'src-ver-101': {
          sourceVersionId: 'src-ver-101',
          projectId: 'proj-alpha',
          sourceId: 'doc-source-1',
        },
      },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'revenue Q2',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.items).toHaveLength(1);
    const item = response.items[0]!;
    expect(item.citations).toHaveLength(1);

    expect(item.citations[0]).toEqual({
      evidenceId: 'ev-1',
      sourceId: 'doc-source-1',
      sourceVersionId: 'src-ver-101',
      revisionId: 'rev-101',
      exactQuote: 'Quarterly revenue reached 500M in Q2.',
      pointer: '/blocks/0/sentences/0',
      position: { type: 'TextPositionSelector', start: 10, end: 50, unit: 'unicode-code-point' },
      selectors: undefined,
    });
  });

  it('fails explicitly when referenced SourceVersion does not exist', async () => {
    const span1: EvidenceSpan = {
      evidenceId: 'ev-1',
      revisionId: 'rev-101',
      projectId: 'proj-alpha',
      sourceId: 'doc-source-1',
      sourceVersionId: 'src-ver-nonexistent',
      pointer: '/blocks/0/sentences/0',
      nodeKind: 'sentence',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 10, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Quote text.' },
      exactHash: 'sha256:exact1',
      accessScope: ['finance'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-101',
        canonicalVersion: 1,
        claimText: 'Quote text.',
        sourceVersionId: 'src-ver-nonexistent',
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
      evidenceSpans: { 'ev-1': span1 },
      sourceVersions: {}, // empty source version repo -> undefined
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow(
      "SourceVersion 'src-ver-nonexistent' referenced by EvidenceSpan 'ev-1' was not found.",
    );
  });

  it('fails explicitly when SourceVersion project/source lineage mismatches', async () => {
    const span1: EvidenceSpan = {
      evidenceId: 'ev-1',
      revisionId: 'rev-101',
      projectId: 'proj-alpha',
      sourceId: 'doc-source-1',
      sourceVersionId: 'src-ver-101',
      pointer: '/blocks/0/sentences/0',
      nodeKind: 'sentence',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 10, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Quote text.' },
      exactHash: 'sha256:exact1',
      accessScope: ['finance'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const lexicalItems: LexicalCandidateResult[] = [
      {
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-101',
        canonicalVersion: 1,
        claimText: 'Quote text.',
        sourceVersionId: 'src-ver-101',
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
      evidenceSpans: { 'ev-1': span1 },
      sourceVersions: {
        'src-ver-101': {
          sourceVersionId: 'src-ver-101',
          projectId: 'proj-beta', // Wrong project!
          sourceId: 'doc-source-1',
        },
      },
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow("does not match project or source lineage for EvidenceSpan 'ev-1'");
  });

  it('fails with VALIDATION_ERROR when referenced EvidenceSpan does not exist in evidence repository', async () => {
    const candidateWithMissingEvidence: SemanticCandidateResult = {
      semanticItemId: 'sem-missing',
      projectId: 'proj-alpha',
      generationId: 'gen-001',
      resourceType: 'CLAIM',
      resourceId: 'claim-missing',
      sourceProjectionDigest: 'sha256:src-digest',
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:text-missing',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: 'semantic-representation:v1',
      distance: 0.1,
      dimension: 768,
      evidenceIds: ['ev-nonexistent'],
      accessScope: ['finance'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const { coordinator } = createRig({
      semanticItems: [candidateWithMissingEvidence],
      evidenceSpans: {},
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow(
      "EvidenceSpan 'ev-nonexistent' referenced by CLAIM:claim-missing was not found.",
    );
  });

  it('fails with POLICY_DENIED when caller lacks access clearance for an EvidenceSpan', async () => {
    const restrictedSpan: EvidenceSpan = {
      evidenceId: 'ev-restricted',
      revisionId: 'rev-sec',
      projectId: 'proj-alpha',
      sourceId: 'doc-source-sec',
      sourceVersionId: 'src-ver-sec',
      pointer: '/blocks/0/sentences/0',
      nodeKind: 'sentence',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 20, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Confidential formula.' },
      exactHash: 'sha256:exact-sec',
      accessScope: ['executive_only'], // Caller only has 'finance'
      sensitivity: 'restricted',
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const candidate: SemanticCandidateResult = {
      semanticItemId: 'sem-sec',
      projectId: 'proj-alpha',
      generationId: 'gen-001',
      resourceType: 'CLAIM',
      resourceId: 'claim-sec',
      sourceProjectionDigest: 'sha256:src-digest',
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:text-sec',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: 'semantic-representation:v1',
      distance: 0.1,
      dimension: 768,
      evidenceIds: ['ev-restricted'],
      accessScope: ['executive_only'],
      sensitivity: 'restricted',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const { coordinator } = createRig({
      semanticItems: [candidate],
      evidenceSpans: { 'ev-restricted': restrictedSpan },
    });

    await expect(
      coordinator.search({
        projectId: 'proj-alpha',
        query: 'secret',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow("Caller lacks access clearance for EvidenceSpan 'ev-restricted'.");
  });
});
