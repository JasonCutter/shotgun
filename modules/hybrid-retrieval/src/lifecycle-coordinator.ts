import { randomUUID } from 'node:crypto';

import {
  type BuildGenerationInput,
  type BuildGenerationResult,
  type SemanticActiveGenerationReaderPort,
  type SemanticCorpusItem,
  type SemanticCorpusReaderPort,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingResolverPort,
  type SemanticIndexRepositoryPort,
  type SemanticLifecycleRepositoryPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  type SemanticProjectionRebuilderPort,
  type SemanticReadiness,
  SemanticEmbeddingError,
  sha256Text,
  stableJson,
} from '../../../packages/contracts/src/index.js';

const compareOrdinal = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const areStringSetsEqual = (a: readonly string[], b: readonly string[]): boolean => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
};

export const computeCorpusMembershipFingerprint = (
  items: readonly SemanticCorpusItem[],
): string => {
  const sorted = [...items].sort((a, b) => {
    const typeCmp = compareOrdinal(a.resourceType, b.resourceType);
    if (typeCmp !== 0) return typeCmp;
    return compareOrdinal(a.resourceId, b.resourceId);
  });
  return sha256Text(
    stableJson(
      sorted.map((item) => ({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        canonicalVersion: item.canonicalVersion,
        semanticTextDigest: item.semanticTextDigest,
        evidenceIds: [...item.evidenceIds].sort(compareOrdinal),
        accessScope: [...item.accessScope].sort(compareOrdinal),
        sensitivity: item.sensitivity,
      })),
    ),
  );
};

export const computeItemMembershipFingerprint = (
  items: readonly SemanticProjectionItem[],
): string => {
  const sorted = [...items].sort((a, b) => {
    const typeCmp = compareOrdinal(a.resourceType, b.resourceType);
    if (typeCmp !== 0) return typeCmp;
    return compareOrdinal(a.resourceId, b.resourceId);
  });
  return sha256Text(
    stableJson(
      sorted.map((item) => ({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        canonicalVersion: item.canonicalVersion,
        semanticTextDigest: item.semanticTextDigest,
        evidenceIds: [...item.evidenceIds].sort(compareOrdinal),
        accessScope: [...item.accessScope].sort(compareOrdinal),
        sensitivity: item.sensitivity,
      })),
    ),
  );
};

export class SemanticLifecycleCoordinator implements SemanticProjectionRebuilderPort {
  private readonly clock: () => string;

  constructor(
    private readonly corpusReader: SemanticCorpusReaderPort,
    private readonly resolver: SemanticEmbeddingResolverPort,
    private readonly executionPort: SemanticEmbeddingExecutionPort,
    private readonly indexRepository: SemanticIndexRepositoryPort,
    private readonly activeGenerationReader: SemanticActiveGenerationReaderPort,
    private readonly lifecycleRepository?: SemanticLifecycleRepositoryPort,
    options?: {
      readonly clock?: () => string;
    },
  ) {
    this.clock = options?.clock ?? (() => new Date().toISOString());
  }

  async buildGeneration(input: BuildGenerationInput): Promise<BuildGenerationResult> {
    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required for building a semantic generation.',
        operation: 'build-generation',
      });
    }

    const mode = input.mode ?? 'INCREMENTAL';
    const autoActivate = input.autoActivate ?? true;

    // 1. Resolve exact target corpus snapshot
    const corpus = await this.corpusReader.readCorpus(projectId);

    // 2. Resolve embedding execution authority and profile pin
    const resolved = await this.resolver.resolveExecution({
      projectId,
      sensitivity: 'restricted',
    });

    const generationId = `gen-${randomUUID()}`;
    const createdAt = this.clock();

    // 3. Create new BUILDING generation
    const candidateGeneration: SemanticProjectionGeneration = {
      projectId,
      generationId,
      sourceProjectionDigest: corpus.sourceProjectionDigest,
      canonicalBaseVersion: Math.max(1, corpus.canonicalBaseVersion),
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
      dimension: resolved.profile.dimension,
      distanceMetric: resolved.profile.distanceMetric,
      normalizationPolicy: resolved.profile.normalizationPolicy,
      buildStatus: 'BUILDING',
      createdAt,
    };

    await this.indexRepository.saveGeneration(candidateGeneration);

    try {
      // 4. Build or reuse item vectors
      const itemsToPersist: SemanticProjectionItem[] = [];
      let reusedCount = 0;
      let newlyEmbeddedCount = 0;

      // Determine previous generation for safe incremental vector reuse
      let reusableActiveGen: SemanticProjectionGeneration | undefined;
      if (mode === 'INCREMENTAL') {
        const currentActive = await this.activeGenerationReader.getActiveGeneration(projectId);
        if (
          currentActive &&
          currentActive.buildStatus === 'READY' &&
          currentActive.embeddingProfileId === candidateGeneration.embeddingProfileId &&
          currentActive.embeddingProfileRevision === candidateGeneration.embeddingProfileRevision &&
          currentActive.providerPolicyFingerprint ===
            candidateGeneration.providerPolicyFingerprint &&
          currentActive.representationVersion === candidateGeneration.representationVersion &&
          currentActive.dimension === candidateGeneration.dimension &&
          currentActive.distanceMetric === candidateGeneration.distanceMetric &&
          currentActive.normalizationPolicy === candidateGeneration.normalizationPolicy
        ) {
          reusableActiveGen = currentActive;
        }
      }

      for (const targetItem of corpus.items) {
        let reused = false;
        if (reusableActiveGen) {
          const existingItem = await this.indexRepository.getItem(
            projectId,
            reusableActiveGen.generationId,
            targetItem.resourceType,
            targetItem.resourceId,
          );

          if (
            existingItem &&
            existingItem.semanticTextDigest === targetItem.semanticTextDigest &&
            existingItem.canonicalVersion === targetItem.canonicalVersion &&
            existingItem.representationVersion === targetItem.representationVersion &&
            existingItem.sensitivity === targetItem.sensitivity &&
            areStringSetsEqual(existingItem.accessScope, targetItem.accessScope) &&
            areStringSetsEqual(existingItem.evidenceIds, targetItem.evidenceIds) &&
            existingItem.vector.length === candidateGeneration.dimension
          ) {
            itemsToPersist.push({
              semanticItemId: existingItem.semanticItemId,
              projectId,
              generationId,
              resourceType: targetItem.resourceType,
              resourceId: targetItem.resourceId,
              sourceProjectionDigest: corpus.sourceProjectionDigest,
              canonicalVersion: targetItem.canonicalVersion,
              semanticTextDigest: targetItem.semanticTextDigest,
              embeddingProfileId: candidateGeneration.embeddingProfileId,
              embeddingProfileRevision: candidateGeneration.embeddingProfileRevision,
              representationVersion: targetItem.representationVersion,
              vector: existingItem.vector,
              dimension: candidateGeneration.dimension,
              evidenceIds: targetItem.evidenceIds,
              accessScope: targetItem.accessScope,
              sensitivity: targetItem.sensitivity,
              indexedAt: this.clock(),
              createdAt: this.clock(),
              updatedAt: this.clock(),
            });
            reusedCount++;
            reused = true;
          }
        }

        if (!reused) {
          const embedRes = await this.executionPort.embed({
            text: targetItem.semanticText,
            resourceType: targetItem.resourceType,
          });

          if (embedRes.vector.length !== candidateGeneration.dimension) {
            throw new SemanticEmbeddingError({
              code: 'VALIDATION_FAILURE',
              safeMessage: `Generated vector length ${embedRes.vector.length} does not match dimension ${candidateGeneration.dimension}.`,
              operation: 'build-generation:embed',
            });
          }

          itemsToPersist.push({
            semanticItemId: `sem-${targetItem.resourceType.toLowerCase()}-${targetItem.resourceId}`,
            projectId,
            generationId,
            resourceType: targetItem.resourceType,
            resourceId: targetItem.resourceId,
            sourceProjectionDigest: corpus.sourceProjectionDigest,
            canonicalVersion: targetItem.canonicalVersion,
            semanticTextDigest: targetItem.semanticTextDigest,
            embeddingProfileId: candidateGeneration.embeddingProfileId,
            embeddingProfileRevision: candidateGeneration.embeddingProfileRevision,
            representationVersion: targetItem.representationVersion,
            vector: embedRes.vector,
            dimension: candidateGeneration.dimension,
            evidenceIds: targetItem.evidenceIds,
            accessScope: targetItem.accessScope,
            sensitivity: targetItem.sensitivity,
            indexedAt: this.clock(),
            createdAt: this.clock(),
            updatedAt: this.clock(),
          });
          newlyEmbeddedCount++;
        }
      }

      // 5. Persist candidate generation items
      await this.indexRepository.upsertItems(itemsToPersist);

      // 6. Logical Membership Validation & Equivalence Verification
      const expectedFingerprint = computeCorpusMembershipFingerprint(corpus.items);
      const actualFingerprint = computeItemMembershipFingerprint(itemsToPersist);

      if (
        expectedFingerprint !== actualFingerprint ||
        itemsToPersist.length !== corpus.items.length
      ) {
        await this.indexRepository.updateGenerationStatus(projectId, generationId, 'FAILED');
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Candidate generation membership validation failed: expected fingerprint '${expectedFingerprint}', actual '${actualFingerprint}'.`,
          operation: 'build-generation:validate',
        });
      }

      // 7. Transition to READY
      await this.indexRepository.updateGenerationStatus(projectId, generationId, 'READY');
      const readyGeneration: SemanticProjectionGeneration = {
        ...candidateGeneration,
        buildStatus: 'READY',
      };

      // 8. Explicit Atomic Switch
      let activated = false;
      if (autoActivate && this.lifecycleRepository) {
        await this.lifecycleRepository.switchActiveGeneration({
          projectId,
          targetGenerationId: generationId,
        });
        activated = true;
      }

      return {
        generation: readyGeneration,
        totalItemsCount: itemsToPersist.length,
        reusedCount,
        newlyEmbeddedCount,
        membershipFingerprint: actualFingerprint,
        activated,
      };
    } catch (error) {
      // Mark generation as FAILED on error
      try {
        await this.indexRepository.updateGenerationStatus(projectId, generationId, 'FAILED');
      } catch {
        // Ignore secondary update error
      }
      throw error;
    }
  }

  async getReadiness(projectId: string): Promise<SemanticReadiness> {
    const activeGen = await this.activeGenerationReader.getActiveGeneration(projectId);
    if (!activeGen) {
      return {
        status: 'UNAVAILABLE',
        reason: `No ready active semantic projection generation was found for project '${projectId}'.`,
      };
    }

    if (activeGen.buildStatus === 'FAILED') {
      return {
        status: 'FAILED',
        activeGenerationId: activeGen.generationId,
        embeddingProfileId: activeGen.embeddingProfileId,
        dimension: activeGen.dimension,
        reason: 'Active semantic projection generation is in FAILED status.',
        updatedAt: activeGen.createdAt,
      };
    }

    if (activeGen.buildStatus === 'BUILDING') {
      return {
        status: 'BUILDING',
        activeGenerationId: activeGen.generationId,
        embeddingProfileId: activeGen.embeddingProfileId,
        dimension: activeGen.dimension,
        reason: 'Semantic projection generation is currently BUILDING.',
        updatedAt: activeGen.createdAt,
      };
    }

    // Check STALE safety rule
    const currentCorpus = await this.corpusReader.readCorpus(projectId);
    const isStale =
      activeGen.canonicalBaseVersion < currentCorpus.canonicalBaseVersion ||
      activeGen.sourceProjectionDigest !== currentCorpus.sourceProjectionDigest;

    if (isStale) {
      return {
        status: 'STALE',
        activeGenerationId: activeGen.generationId,
        embeddingProfileId: activeGen.embeddingProfileId,
        dimension: activeGen.dimension,
        reason: 'Semantic projection is behind Canonical Knowledge.',
        updatedAt: activeGen.createdAt,
      };
    }

    return {
      status: 'READY',
      activeGenerationId: activeGen.generationId,
      embeddingProfileId: activeGen.embeddingProfileId,
      dimension: activeGen.dimension,
      updatedAt: activeGen.createdAt,
    };
  }
}
