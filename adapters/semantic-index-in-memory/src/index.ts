import {
  type SemanticCandidateQuery,
  type SemanticCandidateResult,
  type SemanticIndexRepositoryPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  type SemanticResourceType,
  SemanticEmbeddingError,
  validateSecurityInput,
  validateUnitLength,
} from '../../../packages/contracts/src/index.js';

const genKey = (projectId: string, generationId: string): string =>
  `${projectId.trim()}::${generationId.trim()}`;

const itemKey = (
  projectId: string,
  generationId: string,
  resourceType: SemanticResourceType,
  resourceId: string,
): string =>
  `${projectId.trim()}::${generationId.trim()}::${resourceType.trim()}::${resourceId.trim()}`;

const semanticKey = (projectId: string, generationId: string, semanticItemId: string): string =>
  `${projectId.trim()}::${generationId.trim()}::${semanticItemId.trim()}`;

const cloneGen = (gen: SemanticProjectionGeneration): SemanticProjectionGeneration => ({
  ...gen,
});

const cloneItem = (item: SemanticProjectionItem): SemanticProjectionItem => ({
  ...item,
  vector: [...item.vector],
  evidenceIds: [...item.evidenceIds],
  accessScope: [...item.accessScope],
});

const computeCosineDistance = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const similarity = dot / denom;
  return Math.max(0, 1 - similarity);
};

const computeDotProductDistance = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return -dot; // In pgvector <#>, distance is -dot_product so higher dot product has lower distance
};

const computeEuclideanDistance = (a: readonly number[], b: readonly number[]): number => {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
};

export class InMemorySemanticIndexRepository implements SemanticIndexRepositoryPort {
  private readonly generations = new Map<string, SemanticProjectionGeneration>();
  private readonly items = new Map<string, SemanticProjectionItem>();
  private readonly semanticKeyToItemKey = new Map<string, string>();

  async saveGeneration(
    generation: SemanticProjectionGeneration,
  ): Promise<'CREATED' | 'EXISTS' | 'CONFLICT'> {
    const key = genKey(generation.projectId, generation.generationId);
    const existing = this.generations.get(key);
    if (existing) {
      if (
        existing.sourceProjectionDigest === generation.sourceProjectionDigest &&
        existing.canonicalBaseVersion === generation.canonicalBaseVersion &&
        existing.credentialId === generation.credentialId &&
        existing.credentialRevision === generation.credentialRevision &&
        existing.providerPolicyFingerprint === generation.providerPolicyFingerprint &&
        existing.providerId === generation.providerId &&
        existing.embeddingModelId === generation.embeddingModelId &&
        existing.embeddingProfileId === generation.embeddingProfileId &&
        existing.embeddingProfileRevision === generation.embeddingProfileRevision &&
        existing.providerRegistryRevision === generation.providerRegistryRevision &&
        existing.capabilityCatalogRevision === generation.capabilityCatalogRevision &&
        existing.representationVersion === generation.representationVersion &&
        existing.dimension === generation.dimension &&
        existing.distanceMetric === generation.distanceMetric &&
        existing.normalizationPolicy === generation.normalizationPolicy
      ) {
        return 'EXISTS';
      }
      return 'CONFLICT';
    }

    this.generations.set(key, cloneGen(generation));
    return 'CREATED';
  }

  async getGeneration(
    projectId: string,
    generationId: string,
  ): Promise<SemanticProjectionGeneration | undefined> {
    const gen = this.generations.get(genKey(projectId, generationId));
    return gen ? cloneGen(gen) : undefined;
  }

  async listGenerations(projectId: string): Promise<readonly SemanticProjectionGeneration[]> {
    const normalized = projectId.trim();
    const result: SemanticProjectionGeneration[] = [];
    for (const gen of this.generations.values()) {
      if (gen.projectId === normalized) {
        result.push(cloneGen(gen));
      }
    }
    return result.sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? -1 : 1;
      }
      return a.generationId < b.generationId ? -1 : 1;
    });
  }

  async deleteGeneration(projectId: string, generationId: string): Promise<boolean> {
    const key = genKey(projectId, generationId);
    const existed = this.generations.delete(key);
    if (existed) {
      await this.deleteItemsByGeneration(projectId, generationId);
    }
    return existed;
  }

  async upsertItem(item: SemanticProjectionItem): Promise<void> {
    const gen = await this.getGeneration(item.projectId, item.generationId);
    if (!gen) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Referenced projection generation does not exist.',
        operation: 'upsert-item',
      });
    }
    if (
      item.dimension !== gen.dimension ||
      item.embeddingProfileId !== gen.embeddingProfileId ||
      item.embeddingProfileRevision !== gen.embeddingProfileRevision ||
      item.representationVersion !== gen.representationVersion
    ) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Item metadata does not match referenced generation.`,
        operation: 'upsert-item',
      });
    }
    if (item.vector.length !== gen.dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Item dimension ${item.dimension} (vector length ${item.vector.length}) does not match generation dimension ${gen.dimension}.`,
        operation: 'upsert-item',
      });
    }
    if (gen.normalizationPolicy === 'unit_length') {
      validateUnitLength(item.vector, 'upsert-item');
    }

    const key = itemKey(item.projectId, item.generationId, item.resourceType, item.resourceId);
    const semKey = semanticKey(item.projectId, item.generationId, item.semanticItemId);
    this.items.set(key, cloneItem(item));
    this.semanticKeyToItemKey.set(semKey, key);
  }

  async upsertItems(items: readonly SemanticProjectionItem[]): Promise<void> {
    for (const item of items) {
      await this.upsertItem(item);
    }
  }

  async getItem(
    projectId: string,
    generationId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<SemanticProjectionItem | undefined> {
    const key = itemKey(projectId, generationId, resourceType, resourceId);
    const item = this.items.get(key);
    return item ? cloneItem(item) : undefined;
  }

  async getItemBySemanticId(
    projectId: string,
    generationId: string,
    semanticItemId: string,
  ): Promise<SemanticProjectionItem | undefined> {
    const semKey = semanticKey(projectId, generationId, semanticItemId);
    const key = this.semanticKeyToItemKey.get(semKey);
    if (!key) return undefined;
    const item = this.items.get(key);
    return item ? cloneItem(item) : undefined;
  }

  async deleteItem(
    projectId: string,
    generationId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
  ): Promise<boolean> {
    const key = itemKey(projectId, generationId, resourceType, resourceId);
    const item = this.items.get(key);
    if (item) {
      this.semanticKeyToItemKey.delete(semanticKey(projectId, generationId, item.semanticItemId));
    }
    return this.items.delete(key);
  }

  async deleteItemsByGeneration(projectId: string, generationId: string): Promise<number> {
    const prefix = `${projectId.trim()}::${generationId.trim()}::`;
    let count = 0;
    for (const [key, item] of Array.from(this.items.entries())) {
      if (key.startsWith(prefix)) {
        this.semanticKeyToItemKey.delete(semanticKey(projectId, generationId, item.semanticItemId));
        this.items.delete(key);
        count++;
      }
    }
    return count;
  }

  async findNearestNeighbors(
    query: SemanticCandidateQuery,
  ): Promise<readonly SemanticCandidateResult[]> {
    validateSecurityInput(query, 'find-nearest-neighbors');

    const projectId = query.projectId.trim();
    const generationId = query.generationId.trim();

    const gen = await this.getGeneration(projectId, generationId);
    if (!gen) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Requested projection generation was not found.',
        operation: 'find-nearest-neighbors',
      });
    }

    if (query.dimension !== gen.dimension || query.queryVector.length !== gen.dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Query vector dimension ${query.queryVector.length} does not match generation dimension ${gen.dimension}.`,
        operation: 'find-nearest-neighbors',
      });
    }

    if (gen.normalizationPolicy === 'unit_length') {
      validateUnitLength(query.queryVector, 'find-nearest-neighbors');
    }

    const allowedSensitivities = new Set(query.allowedSensitivities);
    const allowedScopes = new Set(query.accessScopes);

    const candidates: { item: SemanticProjectionItem; distance: number }[] = [];

    // Security predicate before Top-K candidate ranking
    for (const item of this.items.values()) {
      if (item.projectId !== projectId || item.generationId !== generationId) {
        continue;
      }
      if (item.dimension !== gen.dimension) {
        continue;
      }
      if (!allowedSensitivities.has(item.sensitivity)) {
        continue;
      }
      // Access scope containment: item access scopes must all be permitted
      const scopeAllowed = item.accessScope.every((scope) => allowedScopes.has(scope));
      if (!scopeAllowed) {
        continue;
      }

      let distance: number;
      switch (gen.distanceMetric) {
        case 'cosine':
          distance = computeCosineDistance(item.vector, query.queryVector);
          break;
        case 'dot_product':
          distance = computeDotProductDistance(item.vector, query.queryVector);
          break;
        case 'euclidean':
          distance = computeEuclideanDistance(item.vector, query.queryVector);
          break;
        default:
          throw new SemanticEmbeddingError({
            code: 'VALIDATION_FAILURE',
            safeMessage: `Unsupported distance metric '${gen.distanceMetric}'.`,
            operation: 'find-nearest-neighbors',
          });
      }

      candidates.push({ item, distance });
    }

    // Sort by distance ASC, with deterministic tie-breaking on resourceType, resourceId
    candidates.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.item.resourceType !== b.item.resourceType) {
        return a.item.resourceType < b.item.resourceType ? -1 : 1;
      }
      return a.item.resourceId < b.item.resourceId ? -1 : 1;
    });

    const topK = candidates.slice(0, query.limit);

    return topK.map(({ item, distance }) => ({
      semanticItemId: item.semanticItemId,
      projectId: item.projectId,
      generationId: item.generationId,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      sourceProjectionDigest: item.sourceProjectionDigest,
      canonicalVersion: item.canonicalVersion,
      semanticTextDigest: item.semanticTextDigest,
      embeddingProfileId: item.embeddingProfileId,
      embeddingProfileRevision: item.embeddingProfileRevision,
      representationVersion: item.representationVersion,
      distance,
      dimension: item.dimension,
      evidenceIds: [...item.evidenceIds],
      accessScope: [...item.accessScope],
      sensitivity: item.sensitivity,
      indexedAt: item.indexedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }
}
