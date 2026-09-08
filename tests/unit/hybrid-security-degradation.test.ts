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

  const semanticItem = (
    overrides: Partial<SemanticCandidateResult> = {},
  ): SemanticCandidateResult => ({
    semanticItemId: 'sem-1',
    projectId: 'proj-alpha',
    generationId: 'gen-001',
    resourceType: 'CLAIM',
    resourceId: 'claim-sem-1',
    sourceProjectionDigest: 'sha256:src-digest',
    canonicalVersion: 1,
    semanticTextDigest: 'sha256:text-sem-1',
    embeddingProfileId: 'prof-1',
    embeddingProfileRevision: 1,
    representationVersion: 'semantic-representation:v1',
    distance: 0.1,
    dimension: 768,
    evidenceIds: ['ev-lex-1'],
    accessScope: ['finance'],
    sensitivity: 'internal',
    indexedAt: '2026-08-18T10:00:00.000Z',
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  });

  const defaultResourceResolver: KnowledgeResourceResolverPort = {
    resolveResource: async (_projId, resourceType, resourceId) => ({
      text: `Authoritative content for ${resourceType}:${resourceId}`,
      canonicalVersion: 1,
      sourceVersionId: 'src-ver-1',
      evidenceIds: ['ev-lex-1'],
      accessScope: ['finance'],
      sensitivity: resourceId === 'claim-priv' ? 'private' : 'public',
    }),
  };

  const createRig = (options: {
    readonly semanticError?: unknown;
    readonly semanticRetriever?: SemanticRetrieverPort;
    readonly resourceResolver?: KnowledgeResourceResolverPort;
    readonly evidenceResolver?: EvidenceSpanResolverPort;
    readonly sourceVersionResolver?: SourceVersionResolverPort;
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
      options.resourceResolver ?? defaultResourceResolver,
      options.evidenceResolver ?? evidenceResolver,
      options.sourceVersionResolver ?? sourceVersionResolver,
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

  it('preserves bounded query-execution diagnostics for policy denial without raw error details', async () => {
    const error = new SemanticEmbeddingError({
      code: 'POLICY_DENIED',
      safeMessage: 'Denied by policy: operation=enforce-privacy-policy secret=do-not-leak',
      operation: 'enforce-privacy-policy',
    });
    const { coordinator } = createRig({ semanticError: error });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.semantic).toMatchObject({
      status: 'DEGRADED',
      degradationStage: 'QUERY_EXECUTION',
      safeFailureCode: 'POLICY_DENIED',
    });
    const json = JSON.stringify(response);
    expect(json).not.toContain('enforce-privacy-policy');
    expect(json).not.toContain('do-not-leak');
  });

  it('preserves timeout/provider failures with bounded execution-stage diagnostics', async () => {
    const cases = [
      {
        code: 'TIMEOUT' as const,
        operation: 'embed-batch',
        stage: 'QUERY_EXECUTION' as const,
        safeFailureCode: 'TIMEOUT' as const,
      },
      {
        code: 'PROVIDER_FAILURE' as const,
        operation: 'provider-request',
        stage: 'QUERY_EXECUTION' as const,
        safeFailureCode: 'PROVIDER_FAILURE' as const,
      },
      {
        code: 'PROVIDER_FAILURE' as const,
        operation: 'find-nearest-neighbors',
        stage: 'NEAREST_NEIGHBOR' as const,
        safeFailureCode: 'PROVIDER_FAILURE' as const,
      },
    ];

    for (const testCase of cases) {
      const { coordinator } = createRig({
        semanticError: new SemanticEmbeddingError({
          code: testCase.code,
          safeMessage: 'provider failure details must remain private',
          operation: testCase.operation,
        }),
      });
      const response = await coordinator.search({
        projectId: 'proj-alpha',
        query: 'financial report',
        accessScopes: ['finance'],
        allowedSensitivities: ['internal'],
      });

      expect(response.readiness.semantic).toMatchObject({
        status: 'DEGRADED',
        degradationStage: testCase.stage,
        safeFailureCode: testCase.safeFailureCode,
      });
    }
  });

  it('distinguishes semantic query-vector validation from query execution failure', async () => {
    const { coordinator } = createRig({
      semanticError: new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: 'query vector dimension is invalid',
        operation: 'semantic-retriever:validate-vector',
      }),
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.semantic).toMatchObject({
      status: 'DEGRADED',
      degradationStage: 'VECTOR_VALIDATION',
      safeFailureCode: 'VALIDATION_FAILURE',
    });
  });

  it('keeps legacy retrieve validation at the non-overclaiming query-execution stage', async () => {
    const { coordinator } = createRig({
      semanticError: new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: 'legacy pre-execution identity validation failed',
        operation: 'semantic-retriever:retrieve',
      }),
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.semantic).toMatchObject({
      status: 'DEGRADED',
      degradationStage: 'QUERY_EXECUTION',
      safeFailureCode: 'VALIDATION_FAILURE',
    });
    expect(response.readiness.semantic.degradationStage).not.toBe('VECTOR_VALIDATION');
  });

  it('classifies candidate fusion failures without exposing the internal operation', async () => {
    const { coordinator } = createRig({
      semanticRetriever: {
        retrieve: async () => [
          semanticItem({
            semanticItemId: 'sem-fusion',
            resourceId: 'claim-lex-1',
            sensitivity: 'private',
          }),
        ],
      },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: ['private'],
    });

    expect(response.readiness.semantic).toMatchObject({
      status: 'DEGRADED',
      degradationStage: 'RESULT_FUSION',
      safeFailureCode: 'POLICY_DENIED',
    });
    expect(JSON.stringify(response)).not.toContain('fuse-candidates');
  });

  it('classifies authoritative resource resolution failures', async () => {
    const { coordinator } = createRig({
      semanticRetriever: {
        retrieve: async () => [semanticItem({ resourceId: 'claim-resource-fail' })],
      },
      resourceResolver: { resolveResource: async () => undefined },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.semantic).toMatchObject({
      status: 'DEGRADED',
      degradationStage: 'RESOURCE_RESOLUTION',
      safeFailureCode: 'VALIDATION_FAILURE',
    });
  });

  it('classifies citation and evidence lineage resolution failures', async () => {
    const { coordinator } = createRig({
      semanticRetriever: {
        retrieve: async () => [
          semanticItem({ resourceId: 'claim-citation-fail', evidenceIds: ['ev-missing'] }),
        ],
      },
      resourceResolver: {
        resolveResource: async () => ({
          text: 'Authoritative semantic content',
          authority: 'CANONICAL',
          authorityRevision: 1,
          resourceRevision: 1,
          canonicalVersion: 1,
          evidenceIds: ['ev-missing'],
          accessScope: ['finance'],
          sensitivity: 'internal',
        }),
      },
      evidenceResolver: {
        getEvidenceSpan: async (_projectId, evidenceId) =>
          evidenceId === 'ev-missing' ? undefined : sampleEvidence,
      },
    });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'financial report',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.semantic).toMatchObject({
      status: 'DEGRADED',
      degradationStage: 'CITATION_RESOLUTION',
      safeFailureCode: 'VALIDATION_FAILURE',
    });
  });
});
