import {
  createSemanticProjectionConvergenceModule,
  runSemanticProjectionConvergenceRecovery,
  SemanticProjectionConvergenceCoordinator,
  startSemanticProjectionConvergenceWorker,
} from '../../modules/semantic-generation/src/convergence.js';
import {
  type SemanticCorpusSourceWatermark,
  type SemanticEmbeddingProfile,
  type SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import { describe, expect, it, vi } from 'vitest';

const projectId = 'project-c7';
const profile: SemanticEmbeddingProfile = {
  profileId: 'profile-c7',
  projectId,
  profileRevision: 1,
  providerId: 'provider-c7',
  embeddingModelId: 'model-c7',
  credentialId: 'credential-c7',
  credentialRevision: 1,
  representationVersion: 'semantic-representation:v2',
  dimension: 2,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  status: 'ACTIVE',
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedBy: 'test',
  updatedAt: '2026-09-16T00:00:00.000Z',
};

const watermark: SemanticCorpusSourceWatermark = {
  projectId,
  canonicalVersion: 1,
  canonicalSnapshotDigest: 'sha256:canonical-c7',
  approvedKnowledgeDigest: 'sha256:approved-c7',
  sourceSnapshotDigest: 'sha256:source-c7',
};

const generation = (
  overrides: Partial<SemanticProjectionGeneration> = {},
): SemanticProjectionGeneration => ({
  projectId,
  generationId: 'generation-c7',
  sourceProjectionDigest: watermark.sourceSnapshotDigest,
  canonicalBaseVersion: watermark.canonicalVersion,
  credentialId: profile.credentialId,
  credentialRevision: profile.credentialRevision,
  providerPolicyFingerprint: 'sha256:policy-c7',
  providerId: profile.providerId,
  embeddingModelId: profile.embeddingModelId,
  embeddingProfileId: profile.profileId,
  embeddingProfileRevision: profile.profileRevision,
  providerRegistryRevision: 'providers:c7',
  capabilityCatalogRevision: 'catalog:c7',
  representationVersion: profile.representationVersion,
  dimension: profile.dimension,
  distanceMetric: profile.distanceMetric,
  normalizationPolicy: profile.normalizationPolicy,
  buildStatus: 'READY',
  createdAt: '2026-09-16T00:00:00.000Z',
  ...overrides,
});

const input = {
  projectId,
  actor: { type: 'service' as const, id: 'test-c7' },
  security: {
    accessScope: ['owner'],
    sensitivity: 'restricted' as const,
    dataClassification: 'semantic-test',
  },
  trigger: 'STARTUP' as const,
};

const createRig = (active: SemanticProjectionGeneration | undefined = generation()) => {
  const getCurrent = vi.fn(async (): Promise<SemanticEmbeddingProfile | undefined> => profile);
  const getWatermark = vi.fn(async () => watermark);
  const getActiveGeneration = vi.fn(async () => active);
  const resolveExecution = vi.fn(async () => ({
    pin: {
      projectId,
      providerId: profile.providerId,
      embeddingModelId: profile.embeddingModelId,
      embeddingProfileId: profile.profileId,
      embeddingProfileRevision: profile.profileRevision,
      credentialId: profile.credentialId,
      credentialRevision: profile.credentialRevision,
      providerRegistryRevision: 'providers:c7',
      capabilityCatalogRevision: 'catalog:c7',
      providerPolicyFingerprint: 'sha256:policy-c7',
      representationVersion: profile.representationVersion,
      dimension: profile.dimension,
      createdAt: '2026-09-16T01:00:00.000Z',
    },
    profile,
    model: {
      providerId: profile.providerId,
      modelId: profile.embeddingModelId,
      displayName: 'C7 test model',
      providerDefaultDimension: profile.dimension,
      shotgunDefaultDimension: profile.dimension,
      shotgunAllowedDimensions: [profile.dimension],
      shotgunBatchLimit: 32,
      capabilityRevision: 'catalog:c7',
      supportedDistanceMetrics: [profile.distanceMetric],
      defaultDistanceMetric: profile.distanceMetric,
      defaultNormalizationPolicy: profile.normalizationPolicy,
    },
  }));
  const refresh = vi.fn(async () => ({
    projectId,
    profileRevision: profile.profileRevision,
    status: 'ACTIVATED' as const,
    generationId: 'generation-c7-refresh',
    itemCount: 1,
    membershipDigest: 'sha256:membership-c7',
  }));
  const coordinator = new SemanticProjectionConvergenceCoordinator({
    profileService: { getCurrent } as never,
    source: {
      readSnapshot: vi.fn(async () => ({
        projectId,
        canonicalVersion: watermark.canonicalVersion,
        canonicalSnapshotDigest: watermark.canonicalSnapshotDigest,
        approvedKnowledgeDigest: watermark.approvedKnowledgeDigest,
        sourceSnapshotDigest: watermark.sourceSnapshotDigest,
        effectiveAt: '2026-09-16T01:00:00.000Z',
        resources: [],
      })),
      readWatermark: getWatermark,
    },
    activeGenerationReader: { getActiveGeneration },
    semanticEmbeddingResolver: { resolveExecution } as never,
    refresh: { refresh },
    now: () => '2026-09-16T01:00:00.000Z',
  });
  return { coordinator, getCurrent, getWatermark, getActiveGeneration, refresh, resolveExecution };
};

describe('C7 Canonical-driven semantic projection convergence', () => {
  it('is an exact-current no-op and never invokes the refresh authority', async () => {
    const rig = createRig();

    await expect(rig.coordinator.converge(input)).resolves.toMatchObject({
      projectId,
      action: 'NO_OP',
      generationId: 'generation-c7',
      canonicalVersion: 1,
    });
    expect(rig.refresh).not.toHaveBeenCalled();
    expect(rig.coordinator.observations()).toMatchObject([
      { projectId, status: 'READY', action: 'NO_OP' },
    ]);
  });

  it('refreshes a stale active generation through SemanticProjectionRefreshPort', async () => {
    const rig = createRig(
      generation({
        sourceProjectionDigest: 'sha256:old-source-c7',
        canonicalBaseVersion: 0,
      }),
    );
    rig.getActiveGeneration
      .mockResolvedValueOnce(
        generation({ sourceProjectionDigest: 'sha256:old-source-c7', canonicalBaseVersion: 0 }),
      )
      .mockResolvedValueOnce(generation({ generationId: 'generation-c7-refresh' }));

    await expect(rig.coordinator.converge(input)).resolves.toMatchObject({
      projectId,
      action: 'REFRESHED',
      generationId: 'generation-c7-refresh',
    });
    expect(rig.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when authoritative execution policy or registry identity changes', async () => {
    const rig = createRig();
    rig.resolveExecution.mockImplementationOnce(async () => ({
      pin: {
        projectId,
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        embeddingProfileId: profile.profileId,
        embeddingProfileRevision: profile.profileRevision,
        credentialId: profile.credentialId,
        credentialRevision: profile.credentialRevision + 1,
        providerRegistryRevision: 'providers:c7-changed',
        capabilityCatalogRevision: 'catalog:c7-changed',
        providerPolicyFingerprint: 'sha256:policy-c7-changed',
        representationVersion: profile.representationVersion,
        dimension: profile.dimension,
        createdAt: '2026-09-16T01:00:00.000Z',
      },
      profile,
      model: {
        providerId: profile.providerId,
        modelId: profile.embeddingModelId,
        displayName: 'C7 test model',
        providerDefaultDimension: profile.dimension,
        shotgunDefaultDimension: profile.dimension,
        shotgunAllowedDimensions: [profile.dimension],
        shotgunBatchLimit: 32,
        capabilityRevision: 'catalog:c7-changed',
        supportedDistanceMetrics: [profile.distanceMetric],
        defaultDistanceMetric: profile.distanceMetric,
        defaultNormalizationPolicy: profile.normalizationPolicy,
      },
    }));

    await expect(rig.coordinator.converge(input)).resolves.toMatchObject({
      action: 'REFRESHED',
      generationId: 'generation-c7',
    });
    expect(rig.refresh).toHaveBeenCalledTimes(1);
  });

  it('treats no profile as a safe no-op and recovers a historical published gap', async () => {
    const rig = createRig(undefined);
    rig.getCurrent.mockResolvedValue(undefined);
    await expect(rig.coordinator.converge(input)).resolves.toMatchObject({
      projectId,
      action: 'NOT_CONFIGURED',
    });
    expect(rig.refresh).not.toHaveBeenCalled();

    const recovery = await runSemanticProjectionConvergenceRecovery(
      async () => [projectId],
      rig.coordinator,
      'STARTUP',
    );
    expect(recovery).toMatchObject({ ready: 0, notConfigured: 1, recoveryPending: 0 });
  });

  it('keeps CanonicalCommitted convergence best-effort and non-required', () => {
    const module = createSemanticProjectionConvergenceModule();
    const handler = module.handlers.events[0];
    expect(handler?.requiredForPublisherAcknowledgement).not.toBe(true);
    expect(module.manifest.produces.events).toEqual([]);
    expect(module.manifest.produces.handoffs).toEqual([]);
  });

  it('records every periodic recovery result and contains runner failures', async () => {
    const onResult = vi.fn();
    const onFailure = vi.fn();
    const notConfiguredRig = createRig();
    notConfiguredRig.getCurrent.mockResolvedValue(undefined);
    const worker = startSemanticProjectionConvergenceWorker(
      async () => [projectId],
      notConfiguredRig.coordinator,
      60_000,
      { onResult, onFailure },
    );
    await worker.tick();
    await worker.stop();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ notConfigured: 1 }),
      expect.any(String),
      expect.any(String),
    );

    const failedWorker = startSemanticProjectionConvergenceWorker(
      async () => {
        throw new Error('periodic list failure');
      },
      createRig(undefined).coordinator,
      60_000,
      { onResult, onFailure },
    );
    await expect(failedWorker.tick()).resolves.toBeUndefined();
    await failedWorker.stop();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
