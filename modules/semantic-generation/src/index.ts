import { randomUUID } from 'node:crypto';

import {
  isSemanticProductResourceType,
  sha256Text,
  semanticMembershipSummaryFromItems,
  semanticStableJson,
  semanticVectorPayloadIdentity,
  semanticVectorPayloadIdentityDigest,
  type ResolvedSemanticEmbeddingExecution,
  type SemanticEmbeddingCompatibilityPort,
  type SemanticCorpusSourceResource,
  type SemanticCorpusSourceSnapshot,
  type SemanticCorpusSourceWatermark,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingResolverPort,
  type SemanticEmbeddingRouterPort,
  type SemanticGenerationActivationResult,
  type SemanticGenerationLifecycleRepositoryPort,
  type SemanticGenerationPointerExpectation,
  type SemanticIndexRepositoryPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  type SemanticProjectionRefreshPort,
  type SemanticProjectionRefreshResult,
  type SemanticSensitivity,
  SemanticEmbeddingError,
  validateFiniteVector,
  validateUnitLength,
} from '../../../packages/contracts/src/index.js';

type SemanticGenerationRepository = SemanticIndexRepositoryPort &
  SemanticGenerationLifecycleRepositoryPort;

export type SemanticGenerationBuildResult = {
  readonly projectId: string;
  readonly generationId: string;
  readonly status: 'ACTIVATED' | 'CONFLICT' | 'STALE';
  readonly generation: SemanticProjectionGeneration;
  readonly itemCount: number;
  readonly membershipDigest: string;
};

export type SemanticGenerationBuildInput = {
  readonly projectId: string;
  readonly targetProfileRevision: number;
  readonly generationId?: string;
};

export type SemanticGenerationBuilderOptions = {
  readonly now?: () => string;
  readonly generationId?: () => string;
  readonly maxBatchSize?: number;
};

const sensitivityRank: Record<SemanticSensitivity, number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const highestSensitivity = (
  resources: readonly SemanticCorpusSourceResource[],
): SemanticSensitivity =>
  resources.reduce<SemanticSensitivity>(
    (highest, resource) =>
      sensitivityRank[resource.provenance.sensitivity] > sensitivityRank[highest]
        ? resource.provenance.sensitivity
        : highest,
    'public',
  );

const sourceWatermarkMatches = (
  snapshot: SemanticCorpusSourceSnapshot,
  watermark: SemanticCorpusSourceWatermark,
): boolean =>
  snapshot.projectId === watermark.projectId &&
  snapshot.canonicalVersion === watermark.canonicalVersion &&
  snapshot.canonicalSnapshotDigest === watermark.canonicalSnapshotDigest &&
  snapshot.approvedKnowledgeDigest === watermark.approvedKnowledgeDigest &&
  snapshot.sourceSnapshotDigest === watermark.sourceSnapshotDigest;

const authorityRank = (authority: SemanticCorpusSourceResource['authority']): number => {
  switch (authority) {
    case 'COMPILED_TRUTH':
      return 3;
    case 'CANONICAL':
      return 2;
    case 'APPROVED_KNOWLEDGE':
      return 1;
  }
};

const uniqueResources = (
  resources: readonly SemanticCorpusSourceResource[],
): readonly SemanticCorpusSourceResource[] => {
  const selected = new Map<string, SemanticCorpusSourceResource>();
  for (const resource of resources) {
    if (!isSemanticProductResourceType(resource.resourceType)) continue;
    const key = `${resource.resourceType}\u0000${resource.resourceId}`;
    const current = selected.get(key);
    if (!current || authorityRank(resource.authority) > authorityRank(current.authority)) {
      selected.set(key, resource);
    }
  }
  return [...selected.values()].sort((left, right) =>
    left.resourceType < right.resourceType
      ? -1
      : left.resourceType > right.resourceType
        ? 1
        : left.resourceId < right.resourceId
          ? -1
          : left.resourceId > right.resourceId
            ? 1
            : 0,
  );
};

const pointerExpectation = (
  pointer: Awaited<ReturnType<SemanticGenerationRepository['getActiveGenerationPointer']>>,
): SemanticGenerationPointerExpectation =>
  pointer
    ? {
        kind: 'EXISTING',
        activeGenerationId: pointer.activeGenerationId,
        pointerRevision: pointer.pointerRevision,
      }
    : { kind: 'NONE' };

export class SemanticGenerationBuilder {
  constructor(
    private readonly repository: SemanticGenerationRepository,
    private readonly source: {
      readSnapshot(projectId: string): Promise<SemanticCorpusSourceSnapshot>;
      readWatermark(projectId: string): Promise<SemanticCorpusSourceWatermark>;
    },
    private readonly embeddingResolver: SemanticEmbeddingResolverPort &
      SemanticEmbeddingCompatibilityPort,
    private readonly embeddingRouter: SemanticEmbeddingRouterPort,
    private readonly profileService?: SemanticEmbeddingProfilePort,
    private readonly options: SemanticGenerationBuilderOptions = {},
  ) {}

  async build(input: SemanticGenerationBuildInput): Promise<SemanticGenerationBuildResult> {
    const projectId = input.projectId.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required for semantic generation build.',
        operation: 'semantic-generation:build',
      });
    }
    if (!Number.isSafeInteger(input.targetProfileRevision) || input.targetProfileRevision < 1) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Target semantic embedding profile revision is invalid.',
        operation: 'semantic-generation:build',
      });
    }

    const expectedPointer = pointerExpectation(
      await this.repository.getActiveGenerationPointer(projectId),
    );
    const snapshot = await this.source.readSnapshot(projectId);
    const resources = uniqueResources(snapshot.resources);
    const resolved = await this.embeddingResolver.resolveExecution({
      projectId,
      sensitivity: highestSensitivity(resources),
      profileRevision: input.targetProfileRevision,
    });

    if (resolved.profile.profileRevision !== input.targetProfileRevision) {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Resolved embedding profile revision is not the requested build target.',
        operation: 'semantic-generation:resolve-profile',
      });
    }
    if (this.profileService) {
      const exactProfile = await this.profileService.getRevision(
        projectId,
        input.targetProfileRevision,
      );
      if (!exactProfile || exactProfile.profileId !== resolved.profile.profileId) {
        throw new SemanticEmbeddingError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: 'Target semantic embedding profile revision was not found.',
          operation: 'semantic-generation:resolve-profile',
        });
      }
    }

    const now = this.options.now ?? (() => new Date().toISOString());
    const generation: SemanticProjectionGeneration = {
      projectId,
      generationId: input.generationId ?? this.options.generationId?.() ?? randomUUID(),
      sourceProjectionDigest: snapshot.sourceSnapshotDigest,
      canonicalBaseVersion: snapshot.canonicalVersion,
      credentialId: resolved.pin.credentialId,
      credentialRevision: resolved.pin.credentialRevision,
      providerPolicyFingerprint: resolved.pin.providerPolicyFingerprint,
      providerId: resolved.pin.providerId,
      embeddingModelId: resolved.pin.embeddingModelId,
      embeddingProfileId: resolved.pin.embeddingProfileId,
      embeddingProfileRevision: resolved.pin.embeddingProfileRevision,
      providerRegistryRevision: resolved.pin.providerRegistryRevision,
      capabilityCatalogRevision: resolved.pin.capabilityCatalogRevision,
      representationVersion: resolved.pin.representationVersion,
      dimension: resolved.pin.dimension,
      distanceMetric: resolved.profile.distanceMetric,
      normalizationPolicy: resolved.profile.normalizationPolicy,
      buildStatus: 'BUILDING',
      createdAt: now(),
    };

    const saved = await this.repository.saveGeneration(generation);
    if (saved === 'EXISTS' || saved === 'CONFLICT') {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Semantic generation ID is already used by another build.',
        operation: 'semantic-generation:create',
      });
    }

    try {
      const items = await this.buildItems(resources, generation, resolved, expectedPointer);
      const expectedSummary = semanticMembershipSummaryFromItems(
        projectId,
        generation.generationId,
        items,
      );

      await this.persistInBoundedBatches(items);
      const persistedSummary = await this.repository.readGenerationMembershipSummary(
        projectId,
        generation.generationId,
      );
      if (
        !persistedSummary ||
        persistedSummary.itemCount !== expectedSummary.itemCount ||
        persistedSummary.membershipDigest !== expectedSummary.membershipDigest
      ) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: 'Persisted semantic generation membership did not match the build target.',
          operation: 'semantic-generation:validate-membership',
        });
      }

      const status = await this.repository.transitionGenerationStatus({
        projectId,
        generationId: generation.generationId,
        expectedStatus: 'BUILDING',
        nextStatus: 'READY',
      });
      if (status !== 'UPDATED') {
        throw new SemanticEmbeddingError({
          code: 'CONFLICT',
          safeMessage: 'Semantic generation status changed before readiness.',
          operation: 'semantic-generation:ready',
        });
      }

      const watermark = await this.source.readWatermark(projectId);
      if (!sourceWatermarkMatches(snapshot, watermark)) {
        return {
          projectId,
          generationId: generation.generationId,
          status: 'STALE',
          generation: { ...generation, buildStatus: 'READY' },
          itemCount: expectedSummary.itemCount,
          membershipDigest: expectedSummary.membershipDigest,
        };
      }

      const activation = await this.repository.activateGeneration({
        projectId,
        generationId: generation.generationId,
        expectedPointer,
        sourceProjectionDigest: snapshot.sourceSnapshotDigest,
        canonicalBaseVersion: snapshot.canonicalVersion,
        updatedAt: now(),
      });
      return {
        projectId,
        generationId: generation.generationId,
        status: activation.status === 'ACTIVATED' ? 'ACTIVATED' : 'CONFLICT',
        generation: { ...generation, buildStatus: 'READY' },
        itemCount: expectedSummary.itemCount,
        membershipDigest: expectedSummary.membershipDigest,
      };
    } catch (error) {
      await this.repository.transitionGenerationStatus({
        projectId,
        generationId: generation.generationId,
        expectedStatus: 'BUILDING',
        nextStatus: 'FAILED',
      });
      throw error;
    }
  }

  async rollback(input: {
    readonly projectId: string;
    readonly targetGenerationId: string;
    readonly expectedPointer: SemanticGenerationPointerExpectation;
    readonly now?: string;
  }): Promise<SemanticGenerationActivationResult> {
    const target = await this.repository.getGeneration(input.projectId, input.targetGenerationId);
    if (!target || target.buildStatus !== 'READY') {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Rollback target is not a ready semantic generation.',
        operation: 'semantic-generation:rollback',
      });
    }
    const watermark = await this.source.readWatermark(input.projectId);
    if (
      target.sourceProjectionDigest !== watermark.sourceSnapshotDigest ||
      target.canonicalBaseVersion !== watermark.canonicalVersion
    ) {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Rollback target is incompatible with the current source watermark.',
        operation: 'semantic-generation:rollback',
      });
    }
    const compatibility = await this.embeddingResolver.resolveCompatibility({
      projectId: input.projectId,
      providerId: target.providerId,
      embeddingModelId: target.embeddingModelId,
      embeddingProfileId: target.embeddingProfileId,
      embeddingProfileRevision: target.embeddingProfileRevision,
      credentialId: target.credentialId,
      credentialRevision: target.credentialRevision,
      representationVersion: target.representationVersion,
      dimension: target.dimension,
      distanceMetric: target.distanceMetric,
      normalizationPolicy: target.normalizationPolicy,
    });
    if (
      target.providerId !== compatibility.providerId ||
      target.embeddingModelId !== compatibility.embeddingModelId ||
      target.embeddingProfileId !== compatibility.embeddingProfileId ||
      target.embeddingProfileRevision !== compatibility.embeddingProfileRevision ||
      target.credentialId !== compatibility.credentialId ||
      target.credentialRevision !== compatibility.credentialRevision ||
      target.representationVersion !== compatibility.representationVersion ||
      target.dimension !== compatibility.dimension ||
      target.distanceMetric !== compatibility.distanceMetric ||
      target.normalizationPolicy !== compatibility.normalizationPolicy
    ) {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: 'Rollback target is incompatible with the current embedding execution.',
        operation: 'semantic-generation:rollback',
      });
    }
    return this.repository.activateGeneration({
      projectId: input.projectId,
      generationId: input.targetGenerationId,
      expectedPointer: input.expectedPointer,
      sourceProjectionDigest: watermark.sourceSnapshotDigest,
      canonicalBaseVersion: watermark.canonicalVersion,
      updatedAt: input.now ?? (this.options.now ?? (() => new Date().toISOString()))(),
    });
  }

  private async buildItems(
    resources: readonly SemanticCorpusSourceResource[],
    generation: SemanticProjectionGeneration,
    resolved: ResolvedSemanticEmbeddingExecution,
    activePointer: SemanticGenerationPointerExpectation,
  ): Promise<readonly SemanticProjectionItem[]> {
    let activeGeneration: SemanticProjectionGeneration | undefined;
    if (activePointer.kind === 'EXISTING') {
      activeGeneration = await this.repository.getGeneration(
        generation.projectId,
        activePointer.activeGenerationId,
      );
      if (activeGeneration?.buildStatus !== 'READY') activeGeneration = undefined;
    }

    const activeItems = new Map<string, SemanticProjectionItem>();
    if (activeGeneration) {
      for (const resource of resources) {
        const item = await this.repository.getItem(
          generation.projectId,
          activeGeneration.generationId,
          resource.resourceType,
          resource.resourceId,
        );
        if (item) activeItems.set(`${resource.resourceType}\u0000${resource.resourceId}`, item);
      }
    }

    const built = new Map<string, SemanticProjectionItem>();
    const pending: {
      readonly resource: SemanticCorpusSourceResource;
      readonly item: SemanticProjectionItem;
    }[] = [];
    for (const resource of resources) {
      if (resource.representation.representationVersion !== generation.representationVersion) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: 'Semantic representation version does not match the target profile.',
          operation: 'semantic-generation:representation',
        });
      }
      const key = `${resource.resourceType}\u0000${resource.resourceId}`;
      const semanticItemId = sha256Text(
        semanticStableJson({
          projectId: generation.projectId,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          authority: resource.authority,
          sourceVersionId: resource.provenance.sourceVersionId,
          resourceRevision: resource.provenance.resourceRevision,
        }),
      );
      const itemBase: SemanticProjectionItem = {
        semanticItemId,
        projectId: generation.projectId,
        generationId: generation.generationId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        sourceProjectionDigest: generation.sourceProjectionDigest,
        canonicalVersion: generation.canonicalBaseVersion,
        semanticTextDigest: resource.representation.semanticTextDigest,
        embeddingProfileId: generation.embeddingProfileId,
        embeddingProfileRevision: generation.embeddingProfileRevision,
        representationVersion: generation.representationVersion,
        vector: [],
        dimension: generation.dimension,
        evidenceIds: [...resource.provenance.evidenceIds],
        accessScope: [...resource.provenance.accessScope],
        sensitivity: resource.provenance.sensitivity,
        providerId: generation.providerId,
        embeddingModelId: generation.embeddingModelId,
        normalizationPolicy: generation.normalizationPolicy,
        authority: resource.authority,
        provenance: resource.provenance,
        indexedAt: generation.createdAt,
        createdAt: generation.createdAt,
        updatedAt: generation.createdAt,
      };

      const oldItem = activeItems.get(key);
      if (
        oldItem &&
        activeGeneration &&
        semanticVectorPayloadIdentityDigest(
          semanticVectorPayloadIdentity(oldItem, activeGeneration),
        ) ===
          semanticVectorPayloadIdentityDigest(semanticVectorPayloadIdentity(itemBase, generation))
      ) {
        built.set(key, { ...itemBase, vector: [...oldItem.vector] });
      } else {
        pending.push({ resource, item: itemBase });
      }
    }

    const groups = new Map<string, { sensitivity: SemanticSensitivity; entries: typeof pending }>();
    for (const entry of pending) {
      const key = `${resolved.pin.providerId}|${resolved.pin.embeddingModelId}|${resolved.pin.dimension}|${resolved.profile.normalizationPolicy}|${resolved.pin.embeddingProfileId}|${resolved.pin.embeddingProfileRevision}|${entry.resource.provenance.sensitivity}`;
      const group = groups.get(key);
      if (group) group.entries.push(entry);
      else
        groups.set(key, { sensitivity: entry.resource.provenance.sensitivity, entries: [entry] });
    }

    const batchSize = Math.max(
      1,
      Math.min(this.options.maxBatchSize ?? 32, resolved.model.shotgunBatchLimit),
    );
    for (const group of groups.values()) {
      for (let offset = 0; offset < group.entries.length; offset += batchSize) {
        const entries = group.entries.slice(offset, offset + batchSize);
        const results = await this.embeddingRouter.embedBatch(
          resolved.pin,
          entries.map(({ resource }) => ({
            text: resource.representation.semanticText,
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
          })),
          group.sensitivity,
        );
        if (results.length !== entries.length) {
          throw new SemanticEmbeddingError({
            code: 'VALIDATION_FAILURE',
            safeMessage: 'Embedding batch result count did not match the requested payload count.',
            operation: 'semantic-generation:embed-batch',
          });
        }
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]!;
          const result = results[index]!;
          if (
            result.providerId !== generation.providerId ||
            result.modelId !== generation.embeddingModelId ||
            result.dimension !== generation.dimension ||
            result.vector.length !== generation.dimension
          ) {
            throw new SemanticEmbeddingError({
              code: 'VALIDATION_FAILURE',
              safeMessage: 'Embedding result identity did not match the candidate generation.',
              operation: 'semantic-generation:embed-batch',
            });
          }
          if (generation.normalizationPolicy === 'unit_length') {
            validateUnitLength(result.vector, 'semantic-generation:embed-batch');
          } else {
            validateFiniteVector(result.vector, 'semantic-generation:embed-batch');
          }
          built.set(`${entry.resource.resourceType}\u0000${entry.resource.resourceId}`, {
            ...entry.item,
            vector: [...result.vector],
          });
        }
      }
    }

    return resources
      .map((resource) => built.get(`${resource.resourceType}\u0000${resource.resourceId}`))
      .filter((item): item is SemanticProjectionItem => item !== undefined);
  }

  private async persistInBoundedBatches(items: readonly SemanticProjectionItem[]): Promise<void> {
    const batchSize = Math.max(1, this.options.maxBatchSize ?? 32);
    for (let offset = 0; offset < items.length; offset += batchSize) {
      await this.repository.upsertGenerationItems(items.slice(offset, offset + batchSize));
    }
  }
}

/**
 * Product-facing manual refresh boundary. It resolves both the target profile
 * and project from trusted server context, then delegates all persistence and
 * activation decisions to the R3 generation builder.
 */
export class SemanticProjectionRefreshService implements SemanticProjectionRefreshPort {
  constructor(
    private readonly profileService: SemanticEmbeddingProfilePort,
    private readonly builder: Pick<SemanticGenerationBuilder, 'build'>,
  ) {}

  async refresh(
    input: Parameters<SemanticProjectionRefreshPort['refresh']>[0],
  ): Promise<SemanticProjectionRefreshResult> {
    const projectId = input.projectId.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required for semantic projection refresh.',
        operation: 'semantic-projection:refresh',
      });
    }
    if (
      !input.actor?.id?.trim() ||
      (!input.security.accessScope.includes('owner') &&
        !input.security.accessScope.includes('admin'))
    ) {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: 'Administrative authority is required for semantic projection refresh.',
        operation: 'semantic-projection:refresh',
      });
    }

    const profile = await this.profileService.getCurrent(projectId);
    if (!profile || !['PREPARED', 'ACTIVE'].includes(profile.status)) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'A configured semantic embedding profile is required for refresh.',
        operation: 'semantic-projection:resolve-target',
      });
    }

    const result = await this.builder.build({
      projectId,
      targetProfileRevision: profile.profileRevision,
    });
    return {
      projectId,
      profileRevision: profile.profileRevision,
      status: result.status,
      generationId: result.generationId,
      itemCount: result.itemCount,
      membershipDigest: result.membershipDigest,
    };
  }
}
