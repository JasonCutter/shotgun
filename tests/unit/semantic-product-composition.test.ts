import { describe, expect, it } from 'vitest';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  InMemorySemanticActiveGenerationReader,
  InMemorySemanticLifecycleRepository,
} from '../../adapters/semantic-active-generation-in-memory/src/index.js';
import { type EvidenceCandidate } from '../../modules/evidence/src/index.js';
import {
  SEMANTIC_REPRESENTATION_VERSION,
  type ResolvedSemanticEmbeddingExecution,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingResolverPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
} from '../../packages/contracts/src/index.js';
import { DeterministicFakeEmbeddingAdapter } from '../../modules/semantic-embedding/src/index.js';
import { ProductSemanticCorpusReader } from '../../modules/hybrid-retrieval/src/index.js';

describe('AKP-1 WP4: Product Semantic Composition Proof', () => {
  const projectId = 'proj-prod-composition-test';

  it('proves durable active pointer -> production SemanticRetriever -> HybridCoordinator -> /search/hybrid and STALE fast-fail', async () => {
    // 1. Repositories
    const authRepo = new InMemoryAuthRepository();
    await authRepo.bootstrapOwner({
      accountId: 'owner-1',
      projectId,
      scopes: ['owner', 'engineering'],
      sensitivityClearance: 'restricted',
    });
    const principal = await authRepo.findPrincipalByAccountId('owner-1');
    if (!principal) throw new Error('Fixture principal missing');
    const session = await authRepo.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );

    // 2. Set up Semantic Index & Lifecycle repositories
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    const fakeEmbedder = new DeterministicFakeEmbeddingAdapter({
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      dimension: 8,
    });

    let queryEmbedCallCount = 0;
    const trackingEmbedder: SemanticEmbeddingExecutionPort = {
      identity: fakeEmbedder.identity,
      embed: async (input) => {
        if (input.resourceType === 'QUERY') {
          queryEmbedCallCount++;
        }
        return fakeEmbedder.embed(input);
      },
      embedBatch: async (inputs) => {
        for (const i of inputs) {
          if (i.resourceType === 'QUERY') {
            queryEmbedCallCount++;
          }
        }
        return fakeEmbedder.embedBatch(inputs);
      },
    };

    let vectorTopKCallCount = 0;
    const originalFindNearest = indexRepo.findNearestNeighbors.bind(indexRepo);
    indexRepo.findNearestNeighbors = async (query) => {
      vectorTopKCallCount++;
      return originalFindNearest(query);
    };

    const mockResolver: SemanticEmbeddingResolverPort = {
      resolveExecution: async (input) =>
        ({
          pin: {
            projectId: input.projectId,
            providerId: 'openai',
            embeddingModelId: 'text-embedding-3-small',
            embeddingProfileId: 'prof-comp-1',
            embeddingProfileRevision: 1,
            credentialId: 'cred-1',
            credentialRevision: 1,
            providerRegistryRevision: 'prov-reg:v1',
            capabilityCatalogRevision: 'catalog:v1',
            providerPolicyFingerprint: 'sha256:fp-1',
            representationVersion: SEMANTIC_REPRESENTATION_VERSION,
            createdAt: '2026-08-19T10:00:00.000Z',
          },
          profile: {
            profileId: 'prof-comp-1',
            projectId: input.projectId,
            profileRevision: 1,
            providerId: 'openai',
            embeddingModelId: 'text-embedding-3-small',
            credentialId: 'cred-1',
            credentialRevision: 1,
            representationVersion: SEMANTIC_REPRESENTATION_VERSION,
            dimension: 8,
            distanceMetric: 'cosine',
            normalizationPolicy: 'unit_length',
            status: 'ACTIVE',
            createdAt: '2026-08-19T10:00:00.000Z',
            updatedBy: 'owner-1',
            updatedAt: '2026-08-19T10:00:00.000Z',
          },
          model: {
            modelId: 'text-embedding-3-small',
            displayName: 'Text Embedding 3 Small',
            providerId: 'openai',
            embeddingModelId: 'text-embedding-3-small',
            dimension: 8,
            providerDefaultDimension: 1536,
            shotgunDefaultDimension: 8,
            distanceMetric: 'cosine',
            normalizationPolicy: 'unit_length',
            registryRevision: 'prov-reg:v1',
            capabilityCatalogRevision: 'catalog:v1',
            supportedDimensions: [8, 1536],
            supportsDynamicDimensions: true,
            maxInputTokens: 8191,
          },
          credentialSecret: 'sk-test-secret',
          resolvedAt: '2026-08-19T10:00:00.000Z',
        }) as unknown as ResolvedSemanticEmbeddingExecution,
    };

    // 3. Construct Product Application through createApplication
    // DO NOT pass semanticRetriever directly! createApplication must construct the real SemanticRetriever with ProductSemanticCorpusReader!
    const app = await createApplication({
      production: false,
      authRepository: authRepo,
      semanticIndexRepository: indexRepo,
      semanticActiveGenerationReader: activeReader,
      semanticEmbeddingResolver: mockResolver,
      semanticEmbeddingExecutionPort: trackingEmbedder,
    });

    const { repositories, server } = app;

    // 4. Populate SourceVersion & EvidenceSpan through app repositories
    const storedAsset = await repositories.originalAsset.store({
      submissionId: 'sub-comp-1',
      projectId,
      actorId: 'owner-1',
      channel: 'file_upload',
      materialKind: 'document',
      mediaType: 'text/plain',
      originalFileName: 'report.txt',
      contentHash: 'sha256:content-hash-1',
      sizeBytes: 100,
      storageKey: 'assets/comp-1',
      accessScope: ['engineering'],
      sensitivity: 'internal',
      createdAt: '2026-08-19T10:00:00.000Z',
    });

    const evidenceCandidate: EvidenceCandidate = {
      revisionId: 'rev-comp-1',
      projectId,
      sourceId: storedAsset.sourceId,
      sourceVersionId: storedAsset.sourceVersionId,
      pointer: '/blocks/0',
      nodeKind: 'paragraph',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 35, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Product composition claim evidence.' },
      exactHash: 'sha256:exact-comp-1',
      accessScope: ['engineering'],
      sensitivity: 'internal',
      createdAt: '2026-08-19T10:00:00.000Z',
    };
    const indexedEv = await repositories.evidence.index([evidenceCandidate]);
    const evidenceId = indexedEv.items[0]!.evidenceId;

    // 5. Populate Canonical Claim (Canonical version 1)
    await repositories.canonical.commitFrontendDraft({
      commitId: 'commit-comp-1',
      projectId,
      expectedCanonicalVersion: 0,
      snapshotDigest: (await repositories.canonical.getSnapshot(projectId)).digest,
      operation: 'ADD_CLAIM',
      claimId: 'claim-comp-1',
      claimText: 'Product uses real SemanticRetriever in composition.',
      sourceVersionId: storedAsset.sourceVersionId,
      evidenceIds: [evidenceId],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      authority: {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: 'appr-comp-1',
        approvalBindingDigest: 'sha256:appr-digest-1',
        reviewContextId: 'ctx-comp-1',
        contextRevision: 1,
        draftId: 'draft-comp-1',
        draftRevision: 1,
        draftContentDigest: 'sha256:draft-digest-1',
        approvedItemIds: ['claim-comp-1'],
      },
      reason: 'Product composition claim commitment',
      actor: { type: 'user', id: 'owner-1' },
      committedAt: '2026-08-19T10:00:00.000Z',
      revisionId: 'rev-c-1',
      historyEventId: 'hist-c-1',
      outboxId: 'out-c-1',
    });

    // Populate Search Projection for healthy lexical retrieval
    await repositories.projection.rebuild(projectId, {
      watermark: {
        projectId,
        canonicalVersion: 1,
        snapshotDigest: (await repositories.canonical.getSnapshot(projectId)).digest,
        status: 'READY',
        updatedAt: '2026-08-19T10:00:00.000Z',
      },
      documents: [
        {
          claimId: 'claim-comp-1',
          commitId: 'commit-comp-1',
          revisionId: 'rev-c-1',
          projectId,
          canonicalVersion: 1,
          claimText: 'Product uses real SemanticRetriever in composition.',
          sourceVersionId: storedAsset.sourceVersionId,
          evidenceIds: [evidenceId],
          accessScope: ['engineering'],
          sensitivity: 'internal',
          projectedAt: '2026-08-19T10:00:00.000Z',
        },
      ],
    });

    // 6. Compute expected representation item & digest from ProductSemanticCorpusReader
    const corpusReader = new ProductSemanticCorpusReader(
      repositories.canonical,
      repositories.knowledge,
      repositories.compiledTruth,
    );
    const initialCorpus = await corpusReader.readCorpus(projectId);
    const corpusClaim = initialCorpus.items[0]!;

    // 7. Persist READY semantic generation + active pointer in the index repository
    const genRecord: SemanticProjectionGeneration = {
      projectId,
      generationId: 'gen-prod-001',
      sourceProjectionDigest: initialCorpus.sourceProjectionDigest,
      canonicalBaseVersion: 1,
      credentialId: 'cred-1',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:fp-1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-comp-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'prov-reg:v1',
      capabilityCatalogRevision: 'catalog:v1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 8,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-19T10:00:00.000Z',
    };
    await indexRepo.saveGeneration(genRecord);

    const embeddedItem = await fakeEmbedder.embed({
      resourceType: 'CLAIM',
      resourceId: 'claim-comp-1',
      text: corpusClaim.semanticText,
    });

    const semanticItem: SemanticProjectionItem = {
      semanticItemId: 'sem-comp-1',
      projectId,
      generationId: 'gen-prod-001',
      resourceType: 'CLAIM',
      resourceId: 'claim-comp-1',
      sourceProjectionDigest: initialCorpus.sourceProjectionDigest,
      canonicalVersion: 1,
      semanticTextDigest: corpusClaim.semanticTextDigest,
      embeddingProfileId: 'prof-comp-1',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      vector: embeddedItem.vector,
      dimension: 8,
      evidenceIds: [evidenceId],
      accessScope: ['engineering'],
      sensitivity: 'internal',
      indexedAt: '2026-08-19T10:00:00.000Z',
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z',
    };
    await indexRepo.upsertItems([semanticItem]);

    await lifecycleRepo.switchActiveGeneration({
      projectId,
      targetGenerationId: 'gen-prod-001',
    });

    // 8. Query /search/hybrid in fresh, healthy state
    const res1 = await server.inject({
      method: 'POST',
      url: '/search/hybrid',
      headers: {
        cookie: `shotgun_session=${session.sessionToken}`,
        'x-csrf-token': session.csrfToken,
      },
      payload: {
        query: 'real SemanticRetriever composition',
        limit: 10,
      },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    const hybrid1 = body1.hybridSearch;
    expect(hybrid1).toBeDefined();
    expect(hybrid1.readiness.semantic.status).toBe('READY');
    expect(hybrid1.readiness.degraded).toBe(false);
    expect(hybrid1.items.length).toBeGreaterThanOrEqual(1);
    expect(hybrid1.items[0].resourceId).toBe('claim-comp-1');
    expect(hybrid1.items[0].signals).toContain('HYBRID');
    expect(queryEmbedCallCount).toBe(1);
    expect(vectorTopKCallCount).toBe(1);

    // 9. Change corpus / sourceProjectionDigest at the SAME Canonical version (1)
    // Add an approved Knowledge Review Group in Stage 9 (which changes ProductSemanticCorpusReader sourceProjectionDigest at canonical version 1)
    await repositories.knowledge.saveGroup({
      groupId: 'kg-approved-1',
      projectId,
      sourceVersionId: storedAsset.sourceVersionId,
      revisionNumber: 1,
      contentDigest: 'sha256:kg-digest-1',
      accessScope: ['engineering'],
      sensitivity: 'internal',
      status: 'APPROVED',
      decisions: [],
      items: [
        {
          candidateId: 'entity-new-1',
          candidateType: 'ENTITY',
          revisionNumber: 1,
          modelOutputs: [],
          sourceVersionId: storedAsset.sourceVersionId,
          evidenceIds: [evidenceId],
          name: 'New Approved Component',
          entityKind: 'CONCEPT',
          aliases: ['Component'],
          resolution: { status: 'NEW' },
        },
      ],
      createdAt: '2026-08-19T10:05:00.000Z',
      updatedAt: '2026-08-19T10:05:00.000Z',
    });

    // Reset counters to measure STALE fast-fail behavior
    queryEmbedCallCount = 0;
    vectorTopKCallCount = 0;

    // 9. Query /search/hybrid against STALE corpus
    const res2 = await server.inject({
      method: 'POST',
      url: '/search/hybrid',
      headers: {
        cookie: `shotgun_session=${session.sessionToken}`,
        'x-csrf-token': session.csrfToken,
      },
      payload: {
        query: 'real SemanticRetriever composition',
        limit: 10,
      },
    });

    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    const hybrid2 = body2.hybridSearch;
    expect(hybrid2).toBeDefined();

    // Invariant checks:
    // 1) Semantic status is STALE
    expect(hybrid2.readiness.semantic.status).toBe('STALE');
    // 2) Degraded is true
    expect(hybrid2.readiness.degraded).toBe(true);
    // 3) Healthy lexical result is preserved
    expect(hybrid2.readiness.lexical.status).toBe('READY');
    expect(hybrid2.items.length).toBe(1);
    expect(hybrid2.items[0].resourceId).toBe('claim-comp-1');
    expect(hybrid2.items[0].signals).toEqual(['LEXICAL']);
    // 4) 0 query embeddings and 0 vector Top-K queries executed
    expect(queryEmbedCallCount).toBe(0);
    expect(vectorTopKCallCount).toBe(0);

    await server.close();
  });
});
