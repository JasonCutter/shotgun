import { describe, expect, it } from 'vitest';

import {
  type CanonicalSnapshot,
  type LexicalRetrieverPort,
  type SemanticCorpusReaderPort,
  type SemanticCorpusSnapshot,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingModelDescriptor,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingResolverPort,
  type SemanticProjectionGeneration,
  SEMANTIC_REPRESENTATION_VERSION,
  SemanticEmbeddingError,
} from '../../packages/contracts/src/index.js';
import {
  InMemorySemanticActiveGenerationReader,
  InMemorySemanticLifecycleRepository,
} from '../../adapters/semantic-active-generation-in-memory/src/index.js';
import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  HybridRetrievalCoordinator,
  SemanticLifecycleCoordinator,
  SemanticRetriever,
} from '../../modules/hybrid-retrieval/src/index.js';
import { DeterministicFakeEmbeddingAdapter } from '../../modules/semantic-embedding/src/index.js';

describe('AKP-1 WP4: Semantic Lifecycle, Invalidation, Readiness & Generation Switch', () => {
  const projectId = 'proj-lifecycle-test';

  const mockProfile: SemanticEmbeddingProfile = {
    profileId: 'prof-lifecycle-1',
    projectId,
    profileRevision: 1,
    providerId: 'fake-provider',
    embeddingModelId: 'fake-model-1',
    credentialId: 'cred-1',
    credentialRevision: 1,
    representationVersion: SEMANTIC_REPRESENTATION_VERSION,
    dimension: 8,
    distanceMetric: 'cosine',
    normalizationPolicy: 'unit_length',
    status: 'ACTIVE',
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedBy: 'user-admin',
    updatedAt: '2026-08-18T10:00:00.000Z',
  };

  const mockModel: SemanticEmbeddingModelDescriptor = {
    providerId: 'fake-provider',
    modelId: 'fake-model-1',
    displayName: 'Fake Model',
    providerDefaultDimension: 8,
    shotgunDefaultDimension: 8,
    shotgunAllowedDimensions: [8],
    shotgunBatchLimit: 50,
    capabilityRevision: 'cap-v1',
    supportedDistanceMetrics: ['cosine'],
    defaultDistanceMetric: 'cosine',
    defaultNormalizationPolicy: 'unit_length',
  };

  const mockResolver: SemanticEmbeddingResolverPort = {
    resolveExecution: async () => ({
      pin: {
        projectId,
        providerId: mockProfile.providerId,
        embeddingModelId: mockProfile.embeddingModelId,
        embeddingProfileId: mockProfile.profileId,
        embeddingProfileRevision: mockProfile.profileRevision,
        credentialId: mockProfile.credentialId,
        credentialRevision: mockProfile.credentialRevision,
        providerRegistryRevision: 'prov-reg:v1',
        capabilityCatalogRevision: 'cap-v1',
        providerPolicyFingerprint: 'sha256:' + '0'.repeat(64),
        representationVersion: mockProfile.representationVersion,
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      profile: mockProfile,
      model: mockModel,
    }),
  };

  const fakeEmbedder: SemanticEmbeddingExecutionPort = new DeterministicFakeEmbeddingAdapter({
    providerId: mockProfile.providerId,
    embeddingModelId: mockProfile.embeddingModelId,
    dimension: 8,
  });

  const createCorpusSnapshot = (
    canonicalBaseVersion: number,
    itemsCount = 3,
  ): SemanticCorpusSnapshot => {
    const items = [];
    for (let i = 1; i <= itemsCount; i++) {
      items.push({
        resourceType: 'CLAIM' as const,
        resourceId: `claim-${i}`,
        canonicalVersion: canonicalBaseVersion,
        representationInput: {
          resourceType: 'CLAIM' as const,
          resourceId: `claim-${i}`,
          statement: `Claim ${i}`,
        },
        semanticText: `resource_type: CLAIM\nstatement: Claim ${i}`,
        semanticTextDigest: `sha256:digest-claim-${i}`,
        representationVersion: SEMANTIC_REPRESENTATION_VERSION,
        evidenceIds: [`ev-${i}`],
        accessScope: ['engineering'],
        sensitivity: 'internal' as const,
        sourceVersionId: `sv-${i}`,
      });
    }
    return {
      projectId,
      canonicalBaseVersion,
      canonicalSnapshotDigest: `sha256:snap-${canonicalBaseVersion}`,
      sourceProjectionDigest: `sha256:src-proj-${canonicalBaseVersion}`,
      corpusDigest: `sha256:corpus-${canonicalBaseVersion}`,
      items: Object.freeze(items),
      totalItems: items.length,
    };
  };

  it('1. proves ACTIVE pointer is explicit and cannot be inferred from newest / created_at / highest ID', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    // Save generation 1 (READY)
    const gen1: SemanticProjectionGeneration = {
      projectId,
      generationId: 'gen-001',
      sourceProjectionDigest: 'sha256:src-1',
      canonicalBaseVersion: 1,
      credentialId: 'cred-1',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '0'.repeat(64),
      providerId: 'fake-provider',
      embeddingModelId: 'fake-model-1',
      embeddingProfileId: 'prof-lifecycle-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'prov-reg:v1',
      capabilityCatalogRevision: 'cap-v1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 8,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await indexRepo.saveGeneration(gen1);

    // Save generation 2 (READY, created later, higher ID)
    const gen2: SemanticProjectionGeneration = {
      ...gen1,
      generationId: 'gen-002',
      createdAt: '2026-08-18T11:00:00.000Z',
    };
    await indexRepo.saveGeneration(gen2);

    // No pointer has been set yet -> getActiveGeneration returns undefined (NEVER inferred from gen2!)
    const activeNone = await activeReader.getActiveGeneration(projectId);
    expect(activeNone).toBeUndefined();

    // Explicitly switch to gen1
    await lifecycleRepo.switchActiveGeneration({ projectId, targetGenerationId: 'gen-001' });
    const activeGen1 = await activeReader.getActiveGeneration(projectId);
    expect(activeGen1?.generationId).toBe('gen-001');

    // Explicitly switch to gen2
    await lifecycleRepo.switchActiveGeneration({ projectId, targetGenerationId: 'gen-002' });
    const activeGen2 = await activeReader.getActiveGeneration(projectId);
    expect(activeGen2?.generationId).toBe('gen-002');
  });

  it('2. proves BUILDING generation cannot be activated and is not queryable before READY', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);

    const genBuilding: SemanticProjectionGeneration = {
      projectId,
      generationId: 'gen-building',
      sourceProjectionDigest: 'sha256:src-1',
      canonicalBaseVersion: 1,
      credentialId: 'cred-1',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '0'.repeat(64),
      providerId: 'fake-provider',
      embeddingModelId: 'fake-model-1',
      embeddingProfileId: 'prof-lifecycle-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'prov-reg:v1',
      capabilityCatalogRevision: 'cap-v1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 8,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'BUILDING',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await indexRepo.saveGeneration(genBuilding);

    // Attempt to switch to BUILDING generation must fail
    await expect(
      lifecycleRepo.switchActiveGeneration({ projectId, targetGenerationId: 'gen-building' }),
    ).rejects.toThrow(SemanticEmbeddingError);
  });

  it('3. proves failed replacement build leaves active pointer unchanged', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    const corpus = createCorpusSnapshot(1);
    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => corpus,
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    // Initial successful build
    const build1 = await coordinator.buildGeneration({ projectId });
    expect(build1.activated).toBe(true);

    const activeGenBefore = await activeReader.getActiveGeneration(projectId);
    expect(activeGenBefore?.generationId).toBe(build1.generation.generationId);

    // Create a failing embedder to simulate build failure
    const failingEmbedder: SemanticEmbeddingExecutionPort = {
      identity: fakeEmbedder.identity,
      embed: async () => {
        throw new Error('Simulated upstream embedding failure');
      },
      embedBatch: async () => {
        throw new Error('Simulated upstream embedding failure');
      },
    };

    const failingCoordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      failingEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    // Replacement build fails
    await expect(failingCoordinator.buildGeneration({ projectId, mode: 'FULL' })).rejects.toThrow();

    // Active pointer is unchanged!
    const activeGenAfter = await activeReader.getActiveGeneration(projectId);
    expect(activeGenAfter?.generationId).toBe(build1.generation.generationId);
  });

  it('4. proves STALE active generation is not queried and query embedding is not executed', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    let canonicalVersion = 1;
    const getCanonicalSnapshot = async (): Promise<CanonicalSnapshot> => ({
      snapshotId: 'snap-current',
      projectId,
      version: canonicalVersion,
      digest: `sha256:snap-${canonicalVersion}`,
      claims: [],
      createdAt: '2026-08-18T10:00:00.000Z',
    });

    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => createCorpusSnapshot(1),
    };

    let queryEmbedCallCount = 0;
    const countingEmbedder: SemanticEmbeddingExecutionPort = {
      identity: fakeEmbedder.identity,
      embed: async (input) => {
        if (input.resourceType === 'QUERY') {
          queryEmbedCallCount++;
        }
        return fakeEmbedder.embed(input);
      },
      embedBatch: async (inputs) => {
        for (const input of inputs) {
          if (input.resourceType === 'QUERY') {
            queryEmbedCallCount++;
          }
        }
        return fakeEmbedder.embedBatch(inputs);
      },
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      countingEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    // Build generation at canonical version 1
    await coordinator.buildGeneration({ projectId });

    const retriever = new SemanticRetriever(
      indexRepo,
      mockResolver,
      countingEmbedder,
      activeReader,
      getCanonicalSnapshot,
    );

    // When canonical version is 1, retrieval succeeds and query is embedded
    const res1 = await retriever.retrieve({
      projectId,
      query: 'test query',
      accessScopes: ['engineering'],
      allowedSensitivities: ['internal'],
    });
    expect(res1.length).toBeGreaterThan(0);
    expect(queryEmbedCallCount).toBe(1);

    // Canonical version advances to 2 -> generation 1 becomes STALE
    canonicalVersion = 2;

    // Retrieval against STALE generation fails without calling query embed!
    await expect(
      retriever.retrieve({
        projectId,
        query: 'test query',
        accessScopes: ['engineering'],
        allowedSensitivities: ['internal'],
      }),
    ).rejects.toThrow(/stale/i);

    // Verify query embedding was NOT executed for stale query!
    expect(queryEmbedCallCount).toBe(1);
  });

  it('5. proves healthy lexical retrieval survives semantic STALE/FAILED/UNAVAILABLE state (AKP1-AC-09)', async () => {
    const mockLexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: [
          {
            claimId: 'claim-lex-1',
            commitId: 'commit-1',
            revisionId: 'rev-1',
            canonicalVersion: 2,
            claimText: 'Healthy lexical result',
            sourceVersionId: 'sv-1',
            evidenceIds: ['ev-1'],
            accessScope: ['engineering'],
            sensitivity: 'internal',
            score: 0.95,
            matchType: 'FULL_TEXT',
            rank: 1,
          },
        ],
        readiness: {
          status: 'READY',
          canonicalVersion: 2,
          projectedCanonicalVersion: 2,
          canonicalSnapshotDigest: 'sha256:snap-2',
          lag: 0,
        },
      }),
    };

    const mockEvidenceResolver = {
      getEvidenceSpan: async () => ({
        evidenceId: 'ev-1',
        projectId,
        sourceId: 'src-1',
        sourceVersionId: 'sv-1',
        revisionId: 'rev-1',
        pointer: '/blocks/0',
        nodeKind: 'paragraph' as const,
        position: {
          type: 'TextPositionSelector' as const,
          start: 0,
          end: 50,
          unit: 'unicode-code-point' as const,
        },
        quote: { type: 'TextQuoteSelector' as const, exact: 'Healthy lexical result' },
        exactHash: 'sha256:exact',
        accessScope: ['engineering'],
        sensitivity: 'internal' as const,
        origin: 'source' as const,
        createdAt: '2026-08-18T10:00:00.000Z',
      }),
    };

    const mockSourceVersionResolver = {
      getSourceVersion: async () => ({
        sourceVersionId: 'sv-1',
        projectId,
        sourceId: 'src-1',
      }),
    };

    // Semantic retriever fails with STALE error
    const failingSemanticRetriever = {
      retrieve: async () => {
        throw new SemanticEmbeddingError({
          code: 'CAPABILITY_UNAVAILABLE',
          safeMessage:
            'Active semantic projection generation is stale (canonical version 2 > base version 1).',
          operation: 'retrieve',
        });
      },
    };

    const coordinator = new HybridRetrievalCoordinator(
      mockLexicalRetriever,
      failingSemanticRetriever,
      undefined,
      mockEvidenceResolver,
      mockSourceVersionResolver,
    );

    const result = await coordinator.search({
      projectId,
      query: 'test query',
      accessScopes: ['engineering'],
      allowedSensitivities: ['internal'],
    });

    // Lexical results are preserved and returned
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.resourceId).toBe('claim-lex-1');
    expect(result.items[0]?.signals).toEqual(['LEXICAL']);

    // Hybrid readiness shows lexical READY, semantic STALE/degraded
    expect(result.readiness.lexical.status).toBe('READY');
    expect(result.readiness.semantic.status).toBe('STALE');
    expect(result.readiness.degraded).toBe(true);
  });

  it('6. proves rollback uses explicit retained generation and cannot bypass stale/base compatibility (AKP1-AC-11)', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    let currentBase = 1;
    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => createCorpusSnapshot(currentBase),
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    // 1. Build Gen 1 at base 1
    const gen1 = await coordinator.buildGeneration({ projectId });
    expect(gen1.activated).toBe(true);

    // 2. Advance base to 2 and build Gen 2
    currentBase = 2;
    const gen2 = await coordinator.buildGeneration({ projectId });
    expect(gen2.activated).toBe(true);

    // Pointer currently points to Gen 2, lastKnownGood is Gen 1
    const pointer = await lifecycleRepo.getActivePointer(projectId);
    expect(pointer?.activeGenerationId).toBe(gen2.generation.generationId);
    expect(pointer?.lastKnownGoodGenerationId).toBe(gen1.generation.generationId);

    // 3. Rollback to Gen 1
    const rolledBackPointer = await lifecycleRepo.rollbackActiveGeneration({ projectId });
    expect(rolledBackPointer.activeGenerationId).toBe(gen1.generation.generationId);

    // 4. Verify that rolled back Gen 1 is STALE because current canonical base is 2
    const readiness = await coordinator.getReadiness(projectId);
    expect(readiness.status).toBe('STALE');
  });

  it('7. proves bounded pruning preserves ACTIVE, rollback, and in-progress BUILDING generations (AKP1-AC-11)', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);

    // Create 4 generations: Gen 1 (LKG), Gen 2 (ACTIVE), Gen 3 (BUILDING), Gen 4 (old READY)
    const baseGen: SemanticProjectionGeneration = {
      projectId,
      generationId: 'gen-1-lkg',
      sourceProjectionDigest: 'sha256:src-1',
      canonicalBaseVersion: 1,
      credentialId: 'cred-1',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:' + '0'.repeat(64),
      providerId: 'fake-provider',
      embeddingModelId: 'fake-model-1',
      embeddingProfileId: 'prof-lifecycle-1',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'prov-reg:v1',
      capabilityCatalogRevision: 'cap-v1',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION,
      dimension: 8,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: '2026-08-18T08:00:00.000Z',
    };

    await indexRepo.saveGeneration(baseGen);
    await indexRepo.saveGeneration({
      ...baseGen,
      generationId: 'gen-old',
      createdAt: '2026-08-18T07:00:00.000Z',
    });
    await indexRepo.saveGeneration({
      ...baseGen,
      generationId: 'gen-2-active',
      createdAt: '2026-08-18T09:00:00.000Z',
    });
    await indexRepo.saveGeneration({
      ...baseGen,
      generationId: 'gen-3-building',
      buildStatus: 'BUILDING',
      createdAt: '2026-08-18T10:00:00.000Z',
    });

    // Set pointer: Gen 1 = LKG, Gen 2 = ACTIVE
    await lifecycleRepo.switchActiveGeneration({ projectId, targetGenerationId: 'gen-1-lkg' });
    await lifecycleRepo.switchActiveGeneration({ projectId, targetGenerationId: 'gen-2-active' });

    // Prune with retainMaxCount: 2
    const pruneResult = await lifecycleRepo.pruneGenerations({ projectId, retainMaxCount: 2 });

    // gen-old was pruned
    expect(pruneResult.prunedGenerationIds).toContain('gen-old');

    // gen-2-active (ACTIVE), gen-1-lkg (LKG), gen-3-building (BUILDING) were preserved!
    expect(pruneResult.retainedGenerationIds).toContain('gen-2-active');
    expect(pruneResult.retainedGenerationIds).toContain('gen-1-lkg');
    expect(pruneResult.retainedGenerationIds).toContain('gen-3-building');
  });

  it('8. proves coordinator CAS activation race: Build B begins with A active -> pointer changes A -> C before B activation -> B activation fails CONFLICT -> C remains ACTIVE -> B remains READY', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    const corpus = createCorpusSnapshot(1);
    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => corpus,
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    // 1. Initial build creates Generation A (ACTIVE, rev 1)
    const genA = await coordinator.buildGeneration({ projectId });
    expect(genA.activated).toBe(true);
    const pointerA = await lifecycleRepo.getActivePointer(projectId);
    expect(pointerA?.activeGenerationId).toBe(genA.generation.generationId);
    expect(pointerA?.pointerRevision).toBe(1);

    // 2. Build Generation C directly in indexRepo and switch pointer to C (ACTIVE, rev 2)
    const genC: SemanticProjectionGeneration = {
      ...genA.generation,
      generationId: 'gen-C',
      createdAt: '2026-08-18T10:15:00.000Z',
    };
    await indexRepo.saveGeneration(genC);

    let switched = false;
    const raceEmbedder: SemanticEmbeddingExecutionPort = {
      identity: fakeEmbedder.identity,
      embed: async (input) => {
        // While B is embedding, competing process switches active pointer to C!
        if (!switched) {
          switched = true;
          await lifecycleRepo.switchActiveGeneration({
            projectId,
            targetGenerationId: 'gen-C',
            expectedCurrentActiveGenerationId: genA.generation.generationId,
            expectedPointerRevision: 1,
          });
        }
        return fakeEmbedder.embed(input);
      },
      embedBatch: async (inputs) => {
        return fakeEmbedder.embedBatch(inputs);
      },
    };

    const coordinatorB = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      raceEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    // 3. Build B fails activation with CONFLICT because pointer changed during build!
    let caughtError: unknown;
    try {
      await coordinatorB.buildGeneration({ projectId, mode: 'FULL' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(SemanticEmbeddingError);
    expect((caughtError as SemanticEmbeddingError).embeddingErrorCode).toBe('CONFLICT');

    // 4. Generation C remains ACTIVE (pointer revision 2)
    const pointerAfterRace = await lifecycleRepo.getActivePointer(projectId);
    expect(pointerAfterRace?.activeGenerationId).toBe('gen-C');
    expect(pointerAfterRace?.pointerRevision).toBe(2);

    const activeGen = await activeReader.getActiveGeneration(projectId);
    expect(activeGen?.generationId).toBe('gen-C');

    // 5. Generation B was built and remains READY in repository, but was NOT activated!
    const allGens = await indexRepo.listGenerations(projectId);
    const genBRecord = allGens.find(
      (g) => g.generationId !== genA.generation.generationId && g.generationId !== 'gen-C',
    );
    expect(genBRecord).toBeDefined();
    expect(genBRecord?.buildStatus).toBe('READY');
  });

  it('9. proves same-canonical-version corpus STALE fast-fail: 0 query embed calls, 0 vector Top-K calls, healthy lexical preserved', async () => {
    const trackingIndexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(trackingIndexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(
      lifecycleRepo,
      trackingIndexRepo,
    );

    // Initial corpus snapshot at canonicalBaseVersion 1 with sensitivity 'internal'
    let currentCorpus = createCorpusSnapshot(1);
    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => currentCorpus,
    };

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
    const originalFindNearest = trackingIndexRepo.findNearestNeighbors.bind(trackingIndexRepo);
    trackingIndexRepo.findNearestNeighbors = async (query) => {
      vectorTopKCallCount++;
      return originalFindNearest(query);
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      trackingEmbedder,
      trackingIndexRepo,
      activeReader,
      lifecycleRepo,
    );

    // Build Generation 1 for initial corpus
    await coordinator.buildGeneration({ projectId });
    expect(queryEmbedCallCount).toBe(0); // Only item embeddings during build

    // SemanticRetriever with full corpus readiness authority
    const retriever = new SemanticRetriever(
      trackingIndexRepo,
      mockResolver,
      trackingEmbedder,
      activeReader,
      coordinator, // Provides getReadiness()
    );

    // Lexical retriever mock
    const mockLexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: [
          {
            claimId: 'claim-lex-1',
            commitId: 'commit-1',
            revisionId: 'rev-1',
            canonicalVersion: 1,
            claimText: 'Healthy lexical result',
            sourceVersionId: 'sv-1',
            evidenceIds: ['ev-1'],
            accessScope: ['engineering'],
            sensitivity: 'internal',
            score: 0.95,
            matchType: 'FULL_TEXT',
            rank: 1,
          },
        ],
        readiness: {
          status: 'READY',
          canonicalVersion: 1,
          projectedCanonicalVersion: 1,
          canonicalSnapshotDigest: 'sha256:snap-1',
          lag: 0,
        },
      }),
    };

    const mockResourceResolver = {
      resolveResource: async (
        _pId: string,
        type: 'CLAIM' | 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION',
        id: string,
      ) => ({
        resourceType: type,
        resourceId: id,
        text: `Claim text for ${id}`,
        canonicalVersion: 1,
        evidenceIds: [`ev-${id.replace('claim-', '')}`],
        accessScope: ['engineering'],
        sensitivity: 'internal' as const,
      }),
    };

    const hybridCoordinator = new HybridRetrievalCoordinator(
      mockLexicalRetriever,
      retriever,
      mockResourceResolver,
      {
        getEvidenceSpan: async (_pId, evidenceId) => ({
          evidenceId,
          projectId,
          sourceId: 'src-1',
          sourceVersionId: 'sv-1',
          revisionId: 'rev-1',
          pointer: '/blocks/0',
          nodeKind: 'paragraph',
          position: { type: 'TextPositionSelector', start: 0, end: 50, unit: 'unicode-code-point' },
          quote: { type: 'TextQuoteSelector', exact: 'Claim text' },
          exactHash: 'sha256:exact',
          accessScope: ['engineering'],
          sensitivity: 'internal',
          origin: 'source',
          createdAt: '2026-08-18T10:00:00.000Z',
        }),
      },
      {
        getSourceVersion: async () => ({
          sourceVersionId: 'sv-1',
          projectId,
          sourceId: 'src-1',
        }),
      },
      activeReader,
    );

    // Initial search when corpus is fresh: succeeds, calls 1 query embed and 1 vector Top-K
    const res1 = await hybridCoordinator.search({
      projectId,
      query: 'test query',
      accessScopes: ['engineering'],
      allowedSensitivities: ['internal'],
    });
    expect(res1.readiness.semantic.status).toBe('READY');
    expect(queryEmbedCallCount).toBe(1);
    expect(vectorTopKCallCount).toBe(1);

    // CANONICAL VERSION REMAINS 1, BUT CORPUS IDENTITY (accessScope / sensitivity / digest) CHANGES!
    const modifiedItems = currentCorpus.items.map((it, idx) =>
      idx === 0
        ? { ...it, sensitivity: 'restricted' as const, semanticTextDigest: 'sha256:changed-digest' }
        : it,
    );
    currentCorpus = {
      ...currentCorpus,
      sourceProjectionDigest: 'sha256:modified-source-proj-digest',
      corpusDigest: 'sha256:modified-corpus-digest',
      items: Object.freeze(modifiedItems),
    };

    // Reset counters to measure STALE request behavior
    queryEmbedCallCount = 0;
    vectorTopKCallCount = 0;

    // Direct semantic retrieval against STALE corpus throws CAPABILITY_UNAVAILABLE with cause STALE
    let retrieverError: unknown;
    try {
      await retriever.retrieve({
        projectId,
        query: 'test query',
        accessScopes: ['engineering'],
        allowedSensitivities: ['internal'],
      });
    } catch (err) {
      retrieverError = err;
    }
    expect(retrieverError).toBeInstanceOf(SemanticEmbeddingError);
    expect(
      ((retrieverError as SemanticEmbeddingError).cause as { readinessStatus?: string })
        ?.readinessStatus,
    ).toBe('STALE');

    // CRITICAL: Query embedding call count MUST be 0, Vector Top-K call count MUST be 0!
    expect(queryEmbedCallCount).toBe(0);
    expect(vectorTopKCallCount).toBe(0);

    // Hybrid search against STALE corpus preserves healthy lexical results and reports STALE
    const hybridRes = await hybridCoordinator.search({
      projectId,
      query: 'test query',
      accessScopes: ['engineering'],
      allowedSensitivities: ['internal'],
    });

    expect(hybridRes.readiness.semantic.status).toBe('STALE');
    expect(hybridRes.readiness.lexical.status).toBe('READY');
    expect(hybridRes.readiness.degraded).toBe(true);
    expect(hybridRes.items.length).toBe(1);
    expect(hybridRes.items[0]?.resourceId).toBe('claim-lex-1');
    expect(hybridRes.items[0]?.signals).toEqual(['LEXICAL']);

    // Still 0 query embeddings and 0 vector Top-K queries!
    expect(queryEmbedCallCount).toBe(0);
    expect(vectorTopKCallCount).toBe(0);
  });
});
