import { describe, expect, it } from 'vitest';
import {
  type EvidenceSpan,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticRetrieverPort,
  SemanticEmbeddingError,
} from '../../packages/contracts/src/index.js';
import {
  type EvidenceSpanResolverPort,
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

  const createRig = (options: { readonly semanticError?: SemanticEmbeddingError }) => {
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

    const semanticRetriever: SemanticRetrieverPort = {
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
    expect(response.readiness.degradedReason).toContain(
      'Active semantic embedding profile is required',
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
    expect(response.readiness.degradedReason).toContain(
      'No ready active semantic projection generation',
    );
    expect(response.items).toHaveLength(1);
  });

  it('degrades to lexical search with DEGRADED when query embedding is policy-denied', async () => {
    const error = new SemanticEmbeddingError({
      code: 'POLICY_DENIED',
      safeMessage: 'Provider privacy policy prohibits external transfer of restricted data.',
      operation: 'resolve-privacy-authority',
    });

    const { coordinator } = createRig({ semanticError: error });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'secret restricted query',
      accessScopes: ['finance'],
      allowedSensitivities: ['restricted'],
    });

    expect(response.readiness.degraded).toBe(true);
    expect(response.readiness.semantic.status).toBe('DEGRADED');
    expect(response.readiness.degradedReason).toBe(
      'Query embedding policy denied for requested sensitivity.',
    );
    expect(response.items).toHaveLength(1);
    expect(response.items[0]!.signals).toEqual(['LEXICAL']);
  });

  it('degrades to lexical search with DEGRADED on embedding provider timeout or failure', async () => {
    const error = new SemanticEmbeddingError({
      code: 'TIMEOUT',
      safeMessage: 'Embedding provider API timed out after 5000ms.',
      operation: 'embed',
    });

    const { coordinator } = createRig({ semanticError: error });

    const response = await coordinator.search({
      projectId: 'proj-alpha',
      query: 'revenue',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
    });

    expect(response.readiness.degraded).toBe(true);
    expect(response.readiness.semantic.status).toBe('DEGRADED');
    expect(response.readiness.degradedReason).toContain('Embedding provider API timed out');
    expect(response.items).toHaveLength(1);
  });
});
