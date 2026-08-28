import { describe, expect, it } from 'vitest';

import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import { SemanticGenerationBuilder } from '../../modules/semantic-generation/src/index.js';
import {
  SEMANTIC_REPRESENTATION_VERSION_V2,
  buildSemanticRepresentationV2,
  sha256Text,
  semanticMembershipDigest,
  type SemanticEmbeddingCompatibility,
  semanticVectorPayloadIdentity,
  type ResolvedSemanticEmbeddingExecution,
  type SemanticCorpusSourceResource,
  type SemanticCorpusSourceSnapshot,
  type SemanticEmbeddingResolverPort,
  type SemanticEmbeddingRouterPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  type SemanticCorpusSourceWatermark,
} from '../../packages/contracts/src/index.js';

const digest = (value: string): string => sha256Text(value);

const profile = {
  profileId: 'profile-r3',
  projectId: 'project-r3',
  profileRevision: 1,
  providerId: 'provider-r3',
  embeddingModelId: 'model-r3',
  credentialId: 'credential-r3',
  credentialRevision: 1,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension: 2,
  distanceMetric: 'cosine' as const,
  normalizationPolicy: 'unit_length' as const,
  status: 'ACTIVE' as const,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedBy: 'test',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

const resolved: ResolvedSemanticEmbeddingExecution = {
  profile,
  model: {
    providerId: profile.providerId,
    modelId: profile.embeddingModelId,
    displayName: 'R3 test model',
    providerDefaultDimension: 2,
    shotgunDefaultDimension: 2,
    shotgunAllowedDimensions: [2],
    shotgunBatchLimit: 100,
    capabilityRevision: 'catalog:r3',
    supportedDistanceMetrics: ['cosine'],
    defaultDistanceMetric: 'cosine',
    defaultNormalizationPolicy: 'unit_length',
  },
  pin: {
    projectId: profile.projectId,
    providerId: profile.providerId,
    embeddingModelId: profile.embeddingModelId,
    embeddingProfileId: profile.profileId,
    embeddingProfileRevision: profile.profileRevision,
    credentialId: profile.credentialId,
    credentialRevision: profile.credentialRevision,
    providerRegistryRevision: 'providers:r3',
    capabilityCatalogRevision: 'catalog:r3',
    providerPolicyFingerprint: digest('policy'),
    representationVersion: profile.representationVersion,
    dimension: profile.dimension,
    createdAt: profile.createdAt,
  },
};

const makeResource = (
  resourceId: string,
  options: { readonly evidenceIds?: readonly string[]; readonly text?: string } = {},
): SemanticCorpusSourceResource => {
  const semanticInput = {
    resourceType: 'CLAIM' as const,
    resourceId,
    statement: options.text ?? `Statement ${resourceId}`,
  };
  return {
    resourceType: 'CLAIM',
    resourceId,
    authority: 'CANONICAL',
    provenance: {
      authority: 'CANONICAL',
      resourceBaseId: resourceId,
      resourceRevision: 1,
      baseCanonicalVersion: 1,
      sourceVersionId: `source-${resourceId}`,
      evidenceIds: [...(options.evidenceIds ?? [`evidence-${resourceId}`])],
      accessScope: ['project:r3'],
      sensitivity: 'internal',
    },
    semanticInput,
    representation: buildSemanticRepresentationV2(semanticInput),
  };
};

const makeSnapshot = (
  resources: readonly SemanticCorpusSourceResource[],
  sourceDigest: string,
): SemanticCorpusSourceSnapshot => ({
  projectId: 'project-r3',
  canonicalVersion: 1,
  canonicalSnapshotDigest: digest('canonical'),
  approvedKnowledgeDigest: digest('approved'),
  sourceSnapshotDigest: sourceDigest,
  effectiveAt: '2026-08-26T00:00:00.000Z',
  resources,
});

const makeRig = (initialSnapshot: SemanticCorpusSourceSnapshot) => {
  let snapshot = initialSnapshot;
  let watermark: SemanticCorpusSourceWatermark = {
    projectId: snapshot.projectId,
    canonicalVersion: snapshot.canonicalVersion,
    canonicalSnapshotDigest: snapshot.canonicalSnapshotDigest,
    approvedKnowledgeDigest: snapshot.approvedKnowledgeDigest,
    sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
  };
  let batchCalls = 0;
  let payloadCalls = 0;
  let executionCalls = 0;
  let compatibilityOverrides: Partial<SemanticEmbeddingCompatibility> = {};
  let compatibilityFailure: Error | undefined;

  const source = {
    readSnapshot: async () => snapshot,
    readWatermark: async () => watermark,
  };
  const resolver: SemanticEmbeddingResolverPort = {
    resolveExecution: async () => {
      executionCalls++;
      return resolved;
    },
    resolveCompatibility: async (input) => {
      if (compatibilityFailure) throw compatibilityFailure;
      return { ...input, ...compatibilityOverrides };
    },
  };
  const router: SemanticEmbeddingRouterPort = {
    embed: async () => ({
      vector: [1, 0],
      dimension: 2,
      providerId: profile.providerId,
      modelId: profile.embeddingModelId,
    }),
    embedBatch: async (_pin, payloads) => {
      batchCalls++;
      payloadCalls += payloads.length;
      return payloads.map(() => ({
        vector: [1, 0],
        dimension: 2,
        providerId: profile.providerId,
        modelId: profile.embeddingModelId,
      }));
    },
  };
  const repository = new InMemorySemanticIndexRepository();
  const builder = (generationId: string) =>
    new SemanticGenerationBuilder(repository, source, resolver, router, undefined, {
      generationId: () => generationId,
      now: () => '2026-08-26T00:00:00.000Z',
      maxBatchSize: 2,
    });

  return {
    repository,
    builder,
    setSnapshot: (next: SemanticCorpusSourceSnapshot) => {
      snapshot = next;
    },
    setWatermark: (next: SemanticCorpusSourceWatermark) => {
      watermark = next;
    },
    counts: () => ({ batchCalls, payloadCalls }),
    executionCalls: () => executionCalls,
    setCompatibility: (overrides: Partial<SemanticEmbeddingCompatibility>) => {
      compatibilityOverrides = overrides;
    },
    setCompatibilityFailure: (error: Error | undefined) => {
      compatibilityFailure = error;
    },
  };
};

describe('R3 semantic generation lifecycle', () => {
  it('splits compatible embedding work into bounded batches and activates a persisted candidate', async () => {
    const snapshot = makeSnapshot(
      ['a', 'b', 'c', 'd', 'e'].map((id) => makeResource(id)),
      digest('snapshot-a'),
    );
    const rig = makeRig(snapshot);

    const result = await rig.builder('generation-a').build({
      projectId: 'project-r3',
      targetProfileRevision: 1,
    });

    expect(result.status).toBe('ACTIVATED');
    expect(result.itemCount).toBe(5);
    expect(rig.counts()).toEqual({ batchCalls: 3, payloadCalls: 5 });
    expect(await rig.repository.getActiveGenerationPointer('project-r3')).toMatchObject({
      activeGenerationId: 'generation-a',
      pointerRevision: 1,
    });
    expect(
      await rig.repository.readGenerationMembershipSummary('project-r3', 'generation-a'),
    ).toMatchObject({ itemCount: 5, membershipDigest: result.membershipDigest });
    const pointer = await rig.repository.getActiveGenerationPointer('project-r3');
    expect(pointer).toBeDefined();
    const embeddingCountsBeforeRollback = rig.counts();
    expect(rig.executionCalls()).toBe(1);
    const rollback = await rig.builder('unused-generation-id').rollback({
      projectId: 'project-r3',
      targetGenerationId: 'generation-a',
      expectedPointer: {
        kind: 'EXISTING',
        activeGenerationId: pointer!.activeGenerationId,
        pointerRevision: pointer!.pointerRevision,
      },
    });
    expect(rollback.status).toBe('ACTIVATED');
    expect((await rig.repository.getActiveGenerationPointer('project-r3'))?.pointerRevision).toBe(
      2,
    );
    expect(rig.counts()).toEqual(embeddingCountsBeforeRollback);
    expect(rig.executionCalls()).toBe(1);
  });

  it('permits rollback when only historical audit revisions differ from current compatibility', async () => {
    const snapshot = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(snapshot);
    await rig.builder('generation-a').build({ projectId: 'project-r3', targetProfileRevision: 1 });
    const pointer = await rig.repository.getActiveGenerationPointer('project-r3');

    const result = await rig.builder('unused-generation-id').rollback({
      projectId: 'project-r3',
      targetGenerationId: 'generation-a',
      expectedPointer: {
        kind: 'EXISTING',
        activeGenerationId: pointer!.activeGenerationId,
        pointerRevision: pointer!.pointerRevision,
      },
    });

    expect(result.status).toBe('ACTIVATED');
  });

  it('rejects rollback when current credential capability is unavailable', async () => {
    const snapshot = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(snapshot);
    await rig.builder('generation-a').build({ projectId: 'project-r3', targetProfileRevision: 1 });
    rig.setCompatibilityFailure(new Error('credential revoked'));
    const pointer = await rig.repository.getActiveGenerationPointer('project-r3');

    await expect(
      rig.builder('unused-generation-id').rollback({
        projectId: 'project-r3',
        targetGenerationId: 'generation-a',
        expectedPointer: {
          kind: 'EXISTING',
          activeGenerationId: pointer!.activeGenerationId,
          pointerRevision: pointer!.pointerRevision,
        },
      }),
    ).rejects.toThrow('credential revoked');
  });

  it('rejects rollback when the current provider/model compatibility is unavailable', async () => {
    const snapshot = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(snapshot);
    await rig.builder('generation-a').build({ projectId: 'project-r3', targetProfileRevision: 1 });
    rig.setCompatibilityFailure(new Error('provider unavailable'));
    const pointer = await rig.repository.getActiveGenerationPointer('project-r3');

    await expect(
      rig.builder('unused-generation-id').rollback({
        projectId: 'project-r3',
        targetGenerationId: 'generation-a',
        expectedPointer: {
          kind: 'EXISTING',
          activeGenerationId: pointer!.activeGenerationId,
          pointerRevision: pointer!.pointerRevision,
        },
      }),
    ).rejects.toThrow('provider unavailable');
  });

  it('rejects rollback when the target source watermark is stale', async () => {
    const snapshot = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(snapshot);
    await rig.builder('generation-a').build({ projectId: 'project-r3', targetProfileRevision: 1 });
    rig.setWatermark({
      ...snapshot,
      sourceSnapshotDigest: digest('snapshot-advanced'),
    });
    const pointer = await rig.repository.getActiveGenerationPointer('project-r3');

    await expect(
      rig.builder('unused-generation-id').rollback({
        projectId: 'project-r3',
        targetGenerationId: 'generation-a',
        expectedPointer: {
          kind: 'EXISTING',
          activeGenerationId: pointer!.activeGenerationId,
          pointerRevision: pointer!.pointerRevision,
        },
      }),
    ).rejects.toMatchObject({ embeddingErrorCode: 'CONFLICT' });
  });

  it('reuses only the active generation vector when payload identity is unchanged', async () => {
    const first = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(first);
    await rig.builder('generation-a').build({ projectId: 'project-r3', targetProfileRevision: 1 });

    const changedMembership = makeSnapshot(
      [makeResource('claim-1', { evidenceIds: ['evidence-changed'] })],
      digest('snapshot-b'),
    );
    rig.setSnapshot(changedMembership);
    rig.setWatermark({
      projectId: changedMembership.projectId,
      canonicalVersion: changedMembership.canonicalVersion,
      canonicalSnapshotDigest: changedMembership.canonicalSnapshotDigest,
      approvedKnowledgeDigest: changedMembership.approvedKnowledgeDigest,
      sourceSnapshotDigest: changedMembership.sourceSnapshotDigest,
    });

    const result = await rig.builder('generation-b').build({
      projectId: 'project-r3',
      targetProfileRevision: 1,
    });
    expect(result.status).toBe('ACTIVATED');
    expect(rig.counts()).toEqual({ batchCalls: 1, payloadCalls: 1 });
    expect(await rig.repository.getActiveGenerationPointer('project-r3')).toMatchObject({
      activeGenerationId: 'generation-b',
      pointerRevision: 2,
    });

    const item = await rig.repository.getItem('project-r3', 'generation-b', 'CLAIM', 'claim-1');
    const generation = await rig.repository.getGeneration('project-r3', 'generation-b');
    expect(item && generation).toBeTruthy();
    expect(semanticVectorPayloadIdentity(item!, generation!)).toEqual(
      semanticVectorPayloadIdentity(
        { ...item!, generationId: 'generation-a' },
        (await rig.repository.getGeneration('project-r3', 'generation-a'))!,
      ),
    );

    const changedSemanticText = makeSnapshot(
      [makeResource('claim-1', { text: 'A semantically changed statement' })],
      digest('snapshot-c'),
    );
    rig.setSnapshot(changedSemanticText);
    rig.setWatermark({
      projectId: changedSemanticText.projectId,
      canonicalVersion: changedSemanticText.canonicalVersion,
      canonicalSnapshotDigest: changedSemanticText.canonicalSnapshotDigest,
      approvedKnowledgeDigest: changedSemanticText.approvedKnowledgeDigest,
      sourceSnapshotDigest: changedSemanticText.sourceSnapshotDigest,
    });
    expect(
      (
        await rig.builder('generation-c').build({
          projectId: 'project-r3',
          targetProfileRevision: 1,
        })
      ).status,
    ).toBe('ACTIVATED');
    expect(rig.counts()).toEqual({ batchCalls: 2, payloadCalls: 2 });
  });

  it('validates persisted membership identity and does not activate after source advancement', async () => {
    const snapshot = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(snapshot);
    const advancedWatermark: SemanticCorpusSourceWatermark = {
      projectId: snapshot.projectId,
      canonicalVersion: snapshot.canonicalVersion + 1,
      canonicalSnapshotDigest: digest('canonical-advanced'),
      approvedKnowledgeDigest: snapshot.approvedKnowledgeDigest,
      sourceSnapshotDigest: digest('snapshot-advanced'),
    };
    rig.setWatermark({
      ...advancedWatermark,
    });
    const result = await rig.builder('generation-stale').build({
      projectId: 'project-r3',
      targetProfileRevision: 1,
    });
    expect(result.status).toBe('STALE');
    expect(await rig.repository.getActiveGenerationPointer('project-r3')).toBeUndefined();
    expect(
      (await rig.repository.getGeneration('project-r3', 'generation-stale'))?.buildStatus,
    ).toBe('READY');
  });

  it('returns typed conflict for concurrent first activation while both candidates remain READY', async () => {
    const snapshot = makeSnapshot([makeResource('claim-1')], digest('snapshot-a'));
    const rig = makeRig(snapshot);
    const [left, right] = await Promise.all([
      rig.builder('generation-left').build({ projectId: 'project-r3', targetProfileRevision: 1 }),
      rig.builder('generation-right').build({ projectId: 'project-r3', targetProfileRevision: 1 }),
    ]);

    expect([left.status, right.status].sort()).toEqual(['ACTIVATED', 'CONFLICT']);
    expect((await rig.repository.getGeneration('project-r3', 'generation-left'))?.buildStatus).toBe(
      'READY',
    );
    expect(
      (await rig.repository.getGeneration('project-r3', 'generation-right'))?.buildStatus,
    ).toBe('READY');
  });

  it('keeps vector bytes and timestamps out of membership digest and rejects FACT at the Product write boundary', async () => {
    const itemBase: SemanticProjectionItem = {
      semanticItemId: 'item',
      projectId: 'project-r3',
      generationId: 'generation',
      resourceType: 'CLAIM',
      resourceId: 'claim',
      sourceProjectionDigest: digest('snapshot'),
      canonicalVersion: 0,
      semanticTextDigest: digest('text'),
      embeddingProfileId: 'profile',
      embeddingProfileRevision: 1,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
      vector: [1, 0],
      dimension: 2,
      evidenceIds: ['evidence'],
      accessScope: ['project:r3'],
      sensitivity: 'internal',
      indexedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(
      semanticMembershipDigest([
        { ...itemBase, vector: [0, 1], indexedAt: '2027-01-01T00:00:00.000Z' },
      ]),
    ).toBe(semanticMembershipDigest([itemBase]));

    const repo = new InMemorySemanticIndexRepository();
    const generation: SemanticProjectionGeneration = {
      projectId: 'project-r3',
      generationId: 'generation',
      sourceProjectionDigest: digest('snapshot'),
      canonicalBaseVersion: 0,
      credentialId: 'credential',
      credentialRevision: 1,
      providerPolicyFingerprint: digest('policy'),
      providerId: profile.providerId,
      embeddingModelId: profile.embeddingModelId,
      embeddingProfileId: profile.profileId,
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'providers:r3',
      capabilityCatalogRevision: 'catalog:r3',
      representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
      dimension: 2,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'BUILDING',
      createdAt: '2026-08-26T00:00:00.000Z',
    };
    await repo.saveGeneration(generation);
    await expect(
      repo.upsertGenerationItems([
        {
          ...itemBase,
          providerId: profile.providerId,
          embeddingModelId: profile.embeddingModelId,
          normalizationPolicy: 'unit_length',
        },
        { ...itemBase, resourceType: 'FACT' },
      ]),
    ).rejects.toMatchObject({ embeddingErrorCode: 'VALIDATION_FAILURE' });
    expect(await repo.getItem('project-r3', 'generation', 'CLAIM', 'claim')).toBeUndefined();
  });
});
