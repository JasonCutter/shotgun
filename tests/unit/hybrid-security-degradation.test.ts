import { describe, expect, it } from 'vitest';
import {
  deriveAuthorizedSensitivities,
  type EvidenceSpan,
  type KnowledgeResourceResolverPort,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateResult,
  type SemanticRetrieverPort,
  SemanticEmbeddingError,
} from '../../packages/contracts/src/index.js';
import {
  type EvidenceSpanResolverPort,
  type SourceVersionResolverPort,
  HybridRetrievalCoordinator,
} from '../../modules/hybrid-retrieval/src/index.js';

describe('Hybrid Security & Request-Local Semantic Degradation Unit Tests', () => {
  const sampleEvidence: EvidenceSpan = {
    evidenceId: 'ev-lex-1',
    revisionId: 'rev-1',
    projectId: 'proj-alpha',
    sourceId: 'src-1',
    sourceVersionId: 'src-ver-1',
    pointer: '/blocks/0',
    nodeKind: 'paragraph',
    origin: 'source',
    position: { type: 'TextPositionSelector', start: 0, end: 50, unit: 'unicode-code-point' },
    quote: { type: 'TextQuoteSelector', exact: 'Quarterly revenue exceeded forecasts.' },
    exactHash: 'sha256:exact',
    accessScope: ['finance'],
    sensitivity: 'internal',
    createdAt: '2026-08-18T10:00:00.000Z',
  };

  const sampleLexicalItem: LexicalCandidateResult = {
    claimId: 'claim-lex-1',
    commitId: 'commit-1',
    revisionId: 'rev-1',
    canonicalVersion: 1,
    claimText: 'Quarterly revenue exceeded forecasts.',
    sourceVersionId: 'src-ver-1',
    evidenceIds: ['ev-lex-1'],
    accessScope: ['finance'],
    sensitivity: 'internal',
    score: 0.9,
    matchType: 'FULL_TEXT',
    rank: 1,
  };

  const defaultResourceResolver: KnowledgeResourceResolverPort = {
    resolveResource: async (_projId, resourceType, resourceId) => ({
      text: `Authoritative content for ${resourceType}:${resourceId}`,
      canonicalVersion: 1,
      sourceVersionId: 'src-ver-1',
    }),
  };

  const createRig = (options: {
    readonly semanticError?: unknown;
    readonly semanticRetriever?: SemanticRetrieverPort;
  }) => {
    const lexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: [sampleLexicalItem],
        readiness: {
          status: 'READY',
          projectedCanonicalVersion: 1,
          canonicalVersion: 1,
          lag: 0,
          canonicalSnapshotDigest: 'sha256:snap-1',
        },
      }),
    };

    const semanticRetriever: SemanticRetrieverPort = options.semanticRetriever ?? {
      retrieve: async () => {
        if (options.semanticError) {
          throw options.semanticError;
        }
        return [];
      },
    };

    const evidenceResolver: EvidenceSpanResolverPort = {
      getEvidenceSpan: async () => sampleEvidence,
    };

    const activeGenerationReader: SemanticActiveGenerationReaderPort = {
      getActiveGeneration: async () => undefined,
    };

    const sourceVersionResolver: SourceVersionResolverPort = {
      getSourceVersion: async (_projId, sourceVersionId) => ({
        sourceVersionId,
        projectId: 'proj-alpha',
        sourceId: 'src-1',
      }),
    };

    const coordinator = new HybridRetrievalCoordinator(
      lexicalRetriever,
      options.semanticRetriever !== undefined
        ? options.semanticRetriever
        : options.semanticError
          ? semanticRetriever
          : undefined,
      defaultResourceResolver,
      evidenceResolver,
      sourceVersionResolver,
      activeGenerationReader,
      undefined,
      { clock: () => '2026-08-18T12:00:00.000Z' },
    );

    return { coordinator };
  };

  it('correctly derives hierarchical authorized sensitivity sets server-side', () => {
    expect(deriveAuthorizedSensitivities('public')).toEqual(['public']);
    expect(deriveAuthorizedSensitivities('internal')).toEqual(['public', 'internal']);
    expect(deriveAuthorizedSensitivities('private')).toEqual(['public', 'internal', 'private']);
    expect(deriveAuthorizedSensitivities('restricted')).toEqual([
      'public',
      'internal',
      'private',
      'restricted',
    ]);
  });

  it('allows a private caller to retrieve public, internal, and private, but blocks restricted items', async () => {
    const candidates: SemanticCandidateResult[] = [
      {
        semanticItemId: 'sem-pub',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'CLAIM',
        resourceId: 'claim-pub',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-pub',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: ['ev-lex-1'],
        accessScope: ['finance'],
        sensitivity: 'public',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-priv',
        projectId: 'proj-alpha',
        generationId: 'gen-001',
        resourceType: 'CLAIM',
        resourceId: 'claim-priv',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-priv',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.12,
        dimension: 768,
        evidenceIds: ['ev-lex-1'],
        accessScope: ['finance'],
        sensitivity: 'private',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    let passedSensitivities: readonly string[] = [];
    const customSemanticRetriever: SemanticRetrieverPort = {
      retrieve: async (input) => {
        passedSensitivities = input.allowedSensitivities;
        return candidates.filter((c) => input.allowedSensitivities.includes(c.sensitivity));
      },
    };

    const { coordinator } = createRig({ semanticRetriever: customSemanticRetriever });

    const privateClearanceSensitivities = deriveAuthorizedSensitivities('private');
    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: privateClearanceSensitivities,
    });

    expect(passedSensitivities).toEqual(['public', 'internal', 'private']);
    expect(response.items.some((i) => i.resourceId === 'claim-pub')).toBe(true);
    expect(response.items.some((i) => i.resourceId === 'claim-priv')).toBe(true);
  });

  it('degrades to lexical search with NOT_CONFIGURED when profile is missing', async () => {
    const error = new SemanticEmbeddingError({
      code: 'CONFIGURATION_REQUIRED',
      safeMessage: 'Active semantic embedding profile is required before embedding execution.',
      operation: 'resolve-active-profile',
    });

    const { coordinator } = createRig({ semanticError: error });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'revenue forecasts',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.degraded).toBe(true);
    expect(response.readiness.semantic.status).toBe('NOT_CONFIGURED');
    expect(response.readiness.degradedReason).toBe(
      'Active semantic embedding profile is not configured.',
    );
    expect(response.readiness.lexical.status).toBe('READY');

    // Lexical results are successfully returned!
    expect(response.items).toHaveLength(1);
    expect(response.items[0]!.resourceId).toBe('claim-lex-1');
    expect(response.items[0]!.signals).toEqual(['LEXICAL']);
  });

  it('degrades to lexical search with UNAVAILABLE when active generation is not found', async () => {
    const error = new SemanticEmbeddingError({
      code: 'CAPABILITY_UNAVAILABLE',
      safeMessage:
        "No ready active semantic projection generation was found for project 'proj-alpha'.",
      operation: 'semantic-retriever:retrieve',
    });

    const { coordinator } = createRig({ semanticError: error });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'revenue forecasts',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.degraded).toBe(true);
    expect(response.readiness.semantic.status).toBe('UNAVAILABLE');
    expect(response.readiness.degradedReason).toBe(
      'Active semantic projection generation is unavailable.',
    );
    expect(response.items).toHaveLength(1);
  });

  it('degrades safely when semantic retriever is not configured at all', async () => {
    const { coordinator } = createRig({});

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'revenue forecasts',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.degraded).toBe(true);
    expect(response.readiness.semantic.status).toBe('UNAVAILABLE');
    expect(response.readiness.degradedReason).toBe('Semantic retrieval is not configured.');
    expect(response.items).toHaveLength(1);
  });

  it('sanitizes unexpected errors and never leaks secrets or internal exception details', async () => {
    const rawSecretError = new Error(
      'DATABASE_CONNECTION_ERROR: postgresql://admin:SECRET_PASSWORD_123@internal-db:5432/shotgun table projection.semantic_items failed with FATAL 57P01',
    );

    const { coordinator } = createRig({ semanticError: rawSecretError });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'sensitive search',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.degraded).toBe(true);
    expect(response.readiness.semantic.status).toBe('DEGRADED');
    expect(response.readiness.degradedReason).toBe(
      'Semantic retrieval is temporarily unavailable.',
    );
    expect(response.readiness.semantic.reason).toBe(
      'Semantic retrieval is temporarily unavailable.',
    );

    // Ensure secret text is nowhere in the entire JSON response
    const jsonStr = JSON.stringify(response);
    expect(jsonStr).not.toContain('SECRET_PASSWORD_123');
    expect(jsonStr).not.toContain('DATABASE_CONNECTION_ERROR');
    expect(jsonStr).not.toContain('57P01');
    expect(jsonStr).not.toContain('internal-db');
  });
});
