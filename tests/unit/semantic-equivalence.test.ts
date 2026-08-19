import { describe, expect, it } from 'vitest';

import {
  type SemanticCorpusItem,
  type SemanticCorpusReaderPort,
  type SemanticCorpusSnapshot,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingModelDescriptor,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingResolverPort,
  SEMANTIC_REPRESENTATION_VERSION,
} from '../../packages/contracts/src/index.js';
import {
  InMemorySemanticActiveGenerationReader,
  InMemorySemanticLifecycleRepository,
} from '../../adapters/semantic-active-generation-in-memory/src/index.js';
import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  computeCorpusMembershipFingerprint,
  SemanticLifecycleCoordinator,
} from '../../modules/hybrid-retrieval/src/index.js';
import { DeterministicFakeEmbeddingAdapter } from '../../modules/semantic-embedding/src/index.js';

describe('AKP-1 WP4: Full vs Incremental Equivalence & Invalidation (AKP1-AC-10)', () => {
  const projectId = 'proj-equivalence-test';

  const mockProfile: SemanticEmbeddingProfile = {
    profileId: 'prof-eq-1',
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

  const makeItem = (
    resourceType: 'CLAIM' | 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION',
    resourceId: string,
    text: string,
    opts?: {
      canonicalVersion?: number;
      evidenceIds?: string[];
      accessScope?: string[];
      sensitivity?: 'public' | 'internal' | 'private' | 'restricted';
    },
  ): SemanticCorpusItem => ({
    resourceType,
    resourceId,
    canonicalVersion: opts?.canonicalVersion ?? 1,
    representationInput: { resourceType: 'CLAIM', resourceId, statement: text },
    semanticText: `resource_type: ${resourceType}\nstatement: ${text}`,
    semanticTextDigest: `sha256:digest-${resourceId}-${text}`,
    representationVersion: SEMANTIC_REPRESENTATION_VERSION,
    evidenceIds: opts?.evidenceIds ?? ['ev-1'],
    accessScope: opts?.accessScope ?? ['engineering'],
    sensitivity: opts?.sensitivity ?? 'internal',
    sourceVersionId: 'sv-1',
  });

  it('1. proves full rebuild and incremental rebuild produce equal membership fingerprints for identical target corpus', async () => {
    const corpusItems: SemanticCorpusItem[] = [
      makeItem('CLAIM', 'claim-1', 'First statement'),
      makeItem('CLAIM', 'claim-2', 'Second statement'),
      makeItem('ENTITY', 'entity-1', 'Core Concept'),
      makeItem('RELATION', 'rel-1', 'Relates'),
      makeItem('EVENT', 'event-1', 'Event Occurred'),
      makeItem('DECISION', 'dec-1', 'Decision Made'),
    ];

    const targetCorpus: SemanticCorpusSnapshot = {
      projectId,
      canonicalBaseVersion: 1,
      canonicalSnapshotDigest: 'sha256:snap-1',
      sourceProjectionDigest: 'sha256:src-1',
      corpusDigest: 'sha256:corpus-1',
      items: Object.freeze(corpusItems),
      totalItems: corpusItems.length,
    };

    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => targetCorpus,
    };

    // Full rebuild from scratch
    const indexRepoFull = new InMemorySemanticIndexRepository();
    const lifecycleRepoFull = new InMemorySemanticLifecycleRepository(indexRepoFull);
    const activeReaderFull = new InMemorySemanticActiveGenerationReader(
      lifecycleRepoFull,
      indexRepoFull,
    );

    const coordinatorFull = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepoFull,
      activeReaderFull,
      lifecycleRepoFull,
    );

    const fullResult = await coordinatorFull.buildGeneration({ projectId, mode: 'FULL' });
    expect(fullResult.newlyEmbeddedCount).toBe(6);
    expect(fullResult.reusedCount).toBe(0);

    // Incremental rebuild from existing generation
    const indexRepoIncr = new InMemorySemanticIndexRepository();
    const lifecycleRepoIncr = new InMemorySemanticLifecycleRepository(indexRepoIncr);
    const activeReaderIncr = new InMemorySemanticActiveGenerationReader(
      lifecycleRepoIncr,
      indexRepoIncr,
    );

    const coordinatorIncr = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepoIncr,
      activeReaderIncr,
      lifecycleRepoIncr,
    );

    // Initial build
    await coordinatorIncr.buildGeneration({ projectId, mode: 'FULL' });

    // Incremental build on same corpus
    const incrResult = await coordinatorIncr.buildGeneration({ projectId, mode: 'INCREMENTAL' });
    expect(incrResult.reusedCount).toBe(6);
    expect(incrResult.newlyEmbeddedCount).toBe(0);

    // Membership fingerprints must be strictly equal!
    expect(fullResult.membershipFingerprint).toBe(incrResult.membershipFingerprint);
    expect(fullResult.membershipFingerprint).toBe(computeCorpusMembershipFingerprint(corpusItems));
  });

  it('2. proves deletion/supersession removes resources from incremental candidate generation', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    // State 1: 3 items (claim-1, claim-2, entity-1)
    let currentItems: SemanticCorpusItem[] = [
      makeItem('CLAIM', 'claim-1', 'First statement'),
      makeItem('CLAIM', 'claim-2', 'Second statement (to be deleted)'),
      makeItem('ENTITY', 'entity-1', 'Core Concept'),
    ];

    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => ({
        projectId,
        canonicalBaseVersion: 1,
        canonicalSnapshotDigest: 'sha256:snap-1',
        sourceProjectionDigest: 'sha256:src-1',
        corpusDigest: 'sha256:corpus-1',
        items: Object.freeze(currentItems),
        totalItems: currentItems.length,
      }),
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    const build1 = await coordinator.buildGeneration({ projectId });
    expect(build1.totalItemsCount).toBe(3);

    // State 2: claim-2 deleted, claim-3 added
    currentItems = [
      makeItem('CLAIM', 'claim-1', 'First statement'),
      makeItem('ENTITY', 'entity-1', 'Core Concept'),
      makeItem('CLAIM', 'claim-3', 'Third statement (new)'),
    ];

    const build2 = await coordinator.buildGeneration({ projectId, mode: 'INCREMENTAL' });
    expect(build2.totalItemsCount).toBe(3);
    expect(build2.reusedCount).toBe(2); // claim-1 and entity-1 reused
    expect(build2.newlyEmbeddedCount).toBe(1); // claim-3 newly embedded

    // Verify claim-2 is NOT in the new generation items
    const claim2Item = await indexRepo.getItem(
      projectId,
      build2.generation.generationId,
      'CLAIM',
      'claim-2',
    );
    expect(claim2Item).toBeUndefined();

    // Verify claim-1 and claim-3 ARE present
    const claim1Item = await indexRepo.getItem(
      projectId,
      build2.generation.generationId,
      'CLAIM',
      'claim-1',
    );
    const claim3Item = await indexRepo.getItem(
      projectId,
      build2.generation.generationId,
      'CLAIM',
      'claim-3',
    );
    expect(claim1Item).toBeDefined();
    expect(claim3Item).toBeDefined();
  });

  it('3. proves accessScope, sensitivity, and evidence changes force item invalidation and re-embedding', async () => {
    const indexRepo = new InMemorySemanticIndexRepository();
    const lifecycleRepo = new InMemorySemanticLifecycleRepository(indexRepo);
    const activeReader = new InMemorySemanticActiveGenerationReader(lifecycleRepo, indexRepo);

    // State 1
    let currentItems: SemanticCorpusItem[] = [
      makeItem('CLAIM', 'claim-1', 'First statement', {
        accessScope: ['engineering'],
        sensitivity: 'internal',
        evidenceIds: ['ev-1'],
      }),
      makeItem('CLAIM', 'claim-2', 'Second statement', {
        accessScope: ['engineering'],
        sensitivity: 'internal',
        evidenceIds: ['ev-2'],
      }),
      makeItem('CLAIM', 'claim-3', 'Third statement', {
        accessScope: ['engineering'],
        sensitivity: 'internal',
        evidenceIds: ['ev-3'],
      }),
    ];

    const corpusReader: SemanticCorpusReaderPort = {
      readCorpus: async () => ({
        projectId,
        canonicalBaseVersion: 1,
        canonicalSnapshotDigest: 'sha256:snap-1',
        sourceProjectionDigest: 'sha256:src-1',
        corpusDigest: 'sha256:corpus-1',
        items: Object.freeze(currentItems),
        totalItems: currentItems.length,
      }),
    };

    const coordinator = new SemanticLifecycleCoordinator(
      corpusReader,
      mockResolver,
      fakeEmbedder,
      indexRepo,
      activeReader,
      lifecycleRepo,
    );

    await coordinator.buildGeneration({ projectId });

    // State 2:
    // claim-1: unchanged (reused)
    // claim-2: accessScope changed (re-embedded)
    // claim-3: sensitivity changed (re-embedded)
    currentItems = [
      makeItem('CLAIM', 'claim-1', 'First statement', {
        accessScope: ['engineering'],
        sensitivity: 'internal',
        evidenceIds: ['ev-1'],
      }),
      makeItem('CLAIM', 'claim-2', 'Second statement', {
        accessScope: ['engineering', 'security'],
        sensitivity: 'internal',
        evidenceIds: ['ev-2'],
      }),
      makeItem('CLAIM', 'claim-3', 'Third statement', {
        accessScope: ['engineering'],
        sensitivity: 'restricted',
        evidenceIds: ['ev-3'],
      }),
    ];

    const build2 = await coordinator.buildGeneration({ projectId, mode: 'INCREMENTAL' });
    expect(build2.reusedCount).toBe(1); // only claim-1
    expect(build2.newlyEmbeddedCount).toBe(2); // claim-2 and claim-3 re-embedded
  });
});
