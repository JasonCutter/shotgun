import searchHybridKnowledgeSchema from '../../../packages/contracts/schemas/search-hybrid-knowledge.v1.schema.json';
import hybridSearchResponseSchema from '../../../packages/contracts/schemas/hybrid-search-response.v1.schema.json';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import {
  type CanonicalClaim,
  type CanonicalSearchResult,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  compiledTruthItemAuthority,
  deriveAuthorizedSensitivities,
  type EvidenceSpan,
  HYBRID_FUSION_DEFAULT_RRF_K,
  HYBRID_FUSION_POLICY_RRF_V1,
  HYBRID_SEARCH_DEFAULT_LIMIT,
  HYBRID_SEARCH_MAX_LIMIT,
  type HybridCandidateResult,
  type HybridCitation,
  type HybridFusionPolicy,
  type HybridFusionSignal,
  type HybridRetrievalCoordinatorPort,
  type HybridRetrievalInput,
  type HybridSearchRequest,
  type HybridSearchResponse,
  type KnowledgeResourceContent,
  type KnowledgeResourceResolverPort,
  type KnowledgeReviewGroup,
  type LexicalCandidateResult,
  type LexicalRetrieverInput,
  type LexicalRetrieverPort,
  type ProjectionReadiness,
  type ProjectionWatermark,
  type SemanticActiveGenerationReaderPort,
  type SemanticCorpusAuthority,
  type SemanticCandidateResult,
  SemanticEmbeddingError,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingResolverPort,
  type SemanticEmbeddingRouterPort,
  type SemanticIndexRepositoryPort,
  type SemanticCorpusSourceSnapshotReaderPort,
  type SemanticQueryClassificationPort,
  type SemanticQueryClassificationInput,
  type SemanticReadiness,
  isSemanticProductResourceType,
  type SemanticProductResourceType,
  type SemanticResourceType,
  type SemanticRetrieverInput,
  type SemanticRetrieverPort,
  ShotgunError,
  type SourceVersionResolverPort,
  validateFiniteVector,
  validateUnitLength,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type LexicalSearchProjectionRepositoryPort = {
  findWatermark(projectId: string): Promise<ProjectionWatermark | undefined>;
  search(
    projectId: string,
    query: string,
    limit: number,
    accessScopes: readonly string[],
  ): Promise<readonly CanonicalSearchResult[]>;
};

export type EvidenceSpanResolverPort = {
  getEvidenceSpan(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined>;
};

export type CanonicalClaimReaderPort = {
  findClaim(projectId: string, claimId: string): Promise<CanonicalClaim | undefined>;
};

export type KnowledgeModelReaderPort = {
  listGroups(projectId: string): Promise<readonly KnowledgeReviewGroup[]>;
};

export type CompiledTruthReaderPort = {
  findProjection(projectId: string): Promise<CompiledTruthProjection | undefined>;
};

const getHighestSensitivity = (
  sensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[],
): 'public' | 'internal' | 'private' | 'restricted' => {
  if (sensitivities.includes('restricted')) return 'restricted';
  if (sensitivities.includes('private')) return 'private';
  if (sensitivities.includes('internal')) return 'internal';
  return 'public';
};

const areStringSetsEqual = (a: readonly string[], b: readonly string[]): boolean => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
};

export const AKP1_PRODUCT_ELIGIBLE_SEMANTIC_RESOURCE_TYPES: readonly SemanticProductResourceType[] =
  Object.freeze(['CLAIM', 'ENTITY', 'RELATION', 'EVENT', 'DECISION']);

/**
 * R4 server-owned, deterministic egress policy. Browser/user query text is
 * private by default. Only an explicit, server-recognized restricted marker
 * may escalate that conservative default; caller clearance and lower
 * sensitivity markers never downgrade provider egress classification.
 */
export class DeterministicSemanticQueryClassificationPolicy implements SemanticQueryClassificationPort {
  classify(_input: SemanticQueryClassificationInput) {
    const query = _input.query.trim().toLowerCase();
    const classification = query.includes('[restricted]')
      ? ('restricted' as const)
      : ('private' as const);
    return {
      classification,
      policyRevision: 'semantic-query-classification:v1' as const,
    };
  }
}

const compareOrdinal = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export class ProductKnowledgeResourceResolver implements KnowledgeResourceResolverPort {
  constructor(
    private readonly canonicalKnowledge: CanonicalClaimReaderPort,
    private readonly knowledgeModel?: KnowledgeModelReaderPort,
    private readonly compiledTruth?: CompiledTruthReaderPort,
  ) {}

  async resolveResource(
    projectId: string,
    resourceType: SemanticResourceType,
    resourceId: string,
    expectedAuthority?: SemanticCorpusAuthority,
  ): Promise<KnowledgeResourceContent | undefined> {
    switch (resourceType) {
      case 'CLAIM': {
        const claim = await this.canonicalKnowledge.findClaim(projectId, resourceId);
        if (!claim) {
          return undefined;
        }
        if (!expectedAuthority || expectedAuthority === 'CANONICAL') {
          return {
            text: claim.claimText,
            authority: 'CANONICAL',
            authorityRevision: claim.revisionNumber,
            resourceRevision: claim.revisionNumber,
            evidenceIds: claim.evidenceIds,
            sourceVersionId: claim.sourceVersionId,
            accessScope: claim.accessScope,
            sensitivity: claim.sensitivity,
          };
        }
        if (expectedAuthority !== 'COMPILED_TRUTH') return undefined;
        break;
      }

      case 'ENTITY':
      case 'RELATION':
      case 'EVENT':
      case 'DECISION': {
        if (
          this.knowledgeModel &&
          (!expectedAuthority || expectedAuthority === 'APPROVED_KNOWLEDGE')
        ) {
          const groups = await this.knowledgeModel.listGroups(projectId);
          for (const group of groups) {
            if (group.status === 'APPROVED') {
              const candidate = group.items.find((item) => item.candidateId === resourceId);
              if (candidate && candidate.candidateType === resourceType) {
                let text: string | undefined;
                switch (candidate.candidateType) {
                  case 'ENTITY':
                    text = candidate.name;
                    break;
                  case 'RELATION':
                    text = `${candidate.fromCandidateId} ${candidate.relationType} ${candidate.toCandidateId}`;
                    break;
                  case 'EVENT':
                    text = candidate.title;
                    break;
                  case 'DECISION':
                    text = candidate.decisionText;
                    break;
                }
                if (text) {
                  return {
                    text,
                    authority: 'APPROVED_KNOWLEDGE',
                    authorityRevision: candidate.revisionNumber,
                    resourceRevision: candidate.revisionNumber,
                    sourceVersionId: candidate.sourceVersionId,
                    evidenceIds: candidate.evidenceIds,
                    accessScope: group.accessScope,
                    sensitivity: group.sensitivity,
                  };
                }
              }
            }
          }
        }
        break;
      }

      case 'FACT': {
        return undefined;
      }
    }

    if (expectedAuthority && expectedAuthority !== 'COMPILED_TRUTH') return undefined;

    if (this.compiledTruth) {
      const projection = await this.compiledTruth.findProjection(projectId);
      if (projection) {
        const item = projection.items.find((i) => i.id === resourceId && i.type === resourceType);
        const baseAuthority = item ? compiledTruthItemAuthority(item) : undefined;
        let base:
          | {
              readonly sourceVersionId: string;
              readonly evidenceIds: readonly string[];
              readonly accessScope: readonly string[];
              readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
              readonly resourceRevision: number;
            }
          | undefined;
        if (item && baseAuthority === 'CANONICAL') {
          const claim = await this.canonicalKnowledge.findClaim(projectId, resourceId);
          if (claim) {
            base = {
              sourceVersionId: claim.sourceVersionId,
              evidenceIds: claim.evidenceIds,
              accessScope: claim.accessScope,
              sensitivity: claim.sensitivity,
              resourceRevision: claim.revisionNumber,
            };
          }
        } else if (item && baseAuthority === 'APPROVED_KNOWLEDGE' && this.knowledgeModel) {
          const groups = await this.knowledgeModel.listGroups(projectId);
          for (const group of groups) {
            if (group.status !== 'APPROVED') continue;
            const candidate = group.items.find(
              (entry) => entry.candidateId === resourceId && entry.candidateType === resourceType,
            );
            if (candidate) {
              base = {
                sourceVersionId: candidate.sourceVersionId,
                evidenceIds: candidate.evidenceIds,
                accessScope: group.accessScope,
                sensitivity: group.sensitivity,
                resourceRevision: candidate.revisionNumber,
              };
              break;
            }
          }
        }

        if (item && base) {
          return {
            text: item.label,
            authority: 'COMPILED_TRUTH',
            authorityRevision: projection.canonicalVersion,
            resourceRevision: base.resourceRevision,
            baseCanonicalVersion: projection.canonicalVersion,
            sourceSnapshotDigest: projection.sourceSnapshotDigest,
            sourceProjectionDigest: projection.sourceSnapshotDigest,
            sourceVersionId: base.sourceVersionId,
            evidenceIds: base.evidenceIds,
            accessScope: base.accessScope,
            sensitivity: base.sensitivity,
          };
        }
      }
    }

    return undefined;
  }
}

export class SemanticRetriever implements SemanticRetrieverPort {
  constructor(
    private readonly repository: SemanticIndexRepositoryPort,
    private readonly resolver: SemanticEmbeddingResolverPort,
    private readonly executionPort: SemanticEmbeddingExecutionPort | SemanticEmbeddingRouterPort,
    private readonly activeGenerationReader: SemanticActiveGenerationReaderPort,
    private readonly options: {
      readonly sourceWatermarkReader?: SemanticCorpusSourceSnapshotReaderPort;
      readonly queryClassifier?: SemanticQueryClassificationPort;
    } = {},
  ) {}

  async retrieve(input: SemanticRetrieverInput): Promise<readonly SemanticCandidateResult[]> {
    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required for semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    const query = input.query?.trim();
    if (!query) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Search query is required for semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    if (!input.accessScopes || input.accessScopes.length === 0) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Access scopes must be a non-empty array for semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    if (!input.allowedSensitivities || input.allowedSensitivities.length === 0) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Allowed sensitivities must be a non-empty array for semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: `Limit must be a positive integer <= ${HYBRID_SEARCH_MAX_LIMIT}. Received: ${limit}`,
        operation: 'semantic-retriever:retrieve',
      });
    }

    // The legacy execution port remains a bounded test adapter for the
    // pre-R4 unit/database invariants. Normal Product startup supplies the
    // router branch below and never uses this authority path.
    if ('identity' in this.executionPort) {
      const highestSens = getHighestSensitivity(input.allowedSensitivities);
      const resolved = await this.resolver.resolveExecution({
        projectId,
        sensitivity: highestSens,
      });
      const gen = await this.activeGenerationReader.getActiveGeneration(projectId);
      if (!gen || gen.buildStatus !== 'READY') {
        throw new SemanticEmbeddingError({
          code: 'CAPABILITY_UNAVAILABLE',
          safeMessage: `No ready active semantic projection generation was found for project '${projectId}'.`,
          operation: 'semantic-retriever:retrieve',
        });
      }
      if (
        gen.projectId !== projectId ||
        gen.embeddingProfileId !== resolved.pin.embeddingProfileId ||
        gen.embeddingProfileRevision !== resolved.pin.embeddingProfileRevision ||
        gen.providerId !== resolved.pin.providerId ||
        gen.embeddingModelId !== resolved.pin.embeddingModelId ||
        gen.credentialId !== resolved.pin.credentialId ||
        gen.credentialRevision !== resolved.pin.credentialRevision ||
        gen.providerRegistryRevision !== resolved.pin.providerRegistryRevision ||
        gen.capabilityCatalogRevision !== resolved.pin.capabilityCatalogRevision ||
        gen.providerPolicyFingerprint !== resolved.pin.providerPolicyFingerprint ||
        gen.representationVersion !== resolved.pin.representationVersion ||
        gen.dimension !== resolved.profile.dimension ||
        gen.distanceMetric !== resolved.profile.distanceMetric ||
        gen.normalizationPolicy !== resolved.profile.normalizationPolicy
      ) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage:
            'Active semantic projection generation is incompatible with the resolved embedding profile or execution pin.',
          operation: 'semantic-retriever:retrieve',
        });
      }
      if (
        this.executionPort.identity.providerId !== gen.providerId ||
        this.executionPort.identity.embeddingModelId !== gen.embeddingModelId ||
        this.executionPort.identity.dimension !== gen.dimension
      ) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: 'Embedding execution port identity does not match generation execution pin.',
          operation: 'semantic-retriever:retrieve',
        });
      }
      const embedRes = await this.executionPort.embed({ text: query, resourceType: 'QUERY' });
      if (
        embedRes.providerId !== gen.providerId ||
        embedRes.modelId !== gen.embeddingModelId ||
        embedRes.dimension !== gen.dimension ||
        embedRes.vector.length !== gen.dimension
      ) {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage:
            'Query vector execution identity or dimension does not match generation execution pin.',
          operation: 'semantic-retriever:retrieve',
        });
      }
      if (gen.normalizationPolicy === 'unit_length') {
        validateUnitLength(embedRes.vector, 'semantic-retriever:retrieve');
      } else {
        validateFiniteVector(embedRes.vector, 'semantic-retriever:retrieve');
      }
      return this.repository.findNearestNeighbors({
        projectId,
        generationId: gen.generationId,
        queryVector: embedRes.vector,
        dimension: gen.dimension,
        accessScopes: input.accessScopes,
        allowedSensitivities: input.allowedSensitivities,
        limit,
      });
    }

    // R4 Product authority: the active pointer and generation are read before
    // any mutable profile, policy, vault, provider, or vector work.
    const generation = await this.activeGenerationReader.getActiveGeneration(projectId);
    if (!generation || generation.buildStatus !== 'READY') {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'No active semantic projection is configured for this project.',
        operation: 'semantic-retriever:read-active-generation',
      });
    }

    if (this.options.sourceWatermarkReader) {
      const watermark = await this.options.sourceWatermarkReader.readWatermark(projectId);
      if (
        watermark.projectId !== projectId ||
        generation.sourceProjectionDigest !== watermark.sourceSnapshotDigest ||
        generation.canonicalBaseVersion !== watermark.canonicalVersion
      ) {
        throw new SemanticEmbeddingError({
          code: 'STALE',
          safeMessage: 'Semantic projection is stale relative to current Product knowledge.',
          operation: 'semantic-retriever:check-watermark',
        });
      }
    }

    const classifier =
      this.options.queryClassifier ?? new DeterministicSemanticQueryClassificationPolicy();
    const classification = classifier.classify({
      projectId,
      actor: input.actor ?? { type: 'system', id: 'semantic-query' },
      security: input.security ?? {
        accessScope: input.accessScopes,
        sensitivity: 'internal',
        dataClassification: 'query',
      },
      query,
      searchSurface: 'HYBRID_SEARCH',
    });

    // Compatibility is current capability validation only. Historical build
    // audit fields on the generation are intentionally not compared here.
    const compatibility = await this.resolver.resolveCompatibility({
      projectId,
      providerId: generation.providerId,
      embeddingModelId: generation.embeddingModelId,
      embeddingProfileId: generation.embeddingProfileId,
      embeddingProfileRevision: generation.embeddingProfileRevision,
      credentialId: generation.credentialId,
      credentialRevision: generation.credentialRevision,
      representationVersion: generation.representationVersion,
      dimension: generation.dimension,
      distanceMetric: generation.distanceMetric,
      normalizationPolicy: generation.normalizationPolicy,
    });
    if (
      compatibility.projectId !== generation.projectId ||
      compatibility.providerId !== generation.providerId ||
      compatibility.embeddingModelId !== generation.embeddingModelId ||
      compatibility.embeddingProfileId !== generation.embeddingProfileId ||
      compatibility.embeddingProfileRevision !== generation.embeddingProfileRevision ||
      compatibility.credentialId !== generation.credentialId ||
      compatibility.credentialRevision !== generation.credentialRevision ||
      compatibility.representationVersion !== generation.representationVersion ||
      compatibility.dimension !== generation.dimension ||
      compatibility.distanceMetric !== generation.distanceMetric ||
      compatibility.normalizationPolicy !== generation.normalizationPolicy
    ) {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: 'Active semantic execution capability is unavailable.',
        operation: 'semantic-retriever:validate-compatibility',
      });
    }

    const pin = {
      projectId: generation.projectId,
      providerId: generation.providerId,
      embeddingModelId: generation.embeddingModelId,
      embeddingProfileId: generation.embeddingProfileId,
      embeddingProfileRevision: generation.embeddingProfileRevision,
      credentialId: generation.credentialId,
      credentialRevision: generation.credentialRevision,
      providerRegistryRevision: generation.providerRegistryRevision,
      capabilityCatalogRevision: generation.capabilityCatalogRevision,
      providerPolicyFingerprint: generation.providerPolicyFingerprint,
      representationVersion: generation.representationVersion,
      dimension: generation.dimension,
      createdAt: generation.createdAt,
    } as const;
    const embedRes = await this.executionPort.embed(
      pin,
      { text: query, resourceType: 'QUERY' },
      classification.classification,
    );
    if (
      embedRes.providerId !== generation.providerId ||
      embedRes.modelId !== generation.embeddingModelId ||
      embedRes.dimension !== generation.dimension ||
      embedRes.vector.length !== generation.dimension
    ) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage:
          'Query vector execution identity or dimension does not match the active projection.',
        operation: 'semantic-retriever:validate-vector',
      });
    }
    if (generation.normalizationPolicy === 'unit_length') {
      validateUnitLength(embedRes.vector, 'semantic-retriever:validate-vector');
    } else {
      validateFiniteVector(embedRes.vector, 'semantic-retriever:validate-vector');
    }
    return this.repository.findNearestNeighbors({
      projectId,
      generationId: generation.generationId,
      queryVector: embedRes.vector,
      dimension: generation.dimension,
      accessScopes: input.accessScopes,
      allowedSensitivities: input.allowedSensitivities,
      limit,
    });
  }
}

export class LexicalRetriever implements LexicalRetrieverPort {
  constructor(
    private readonly repository: LexicalSearchProjectionRepositoryPort,
    private readonly getCanonicalSnapshot: (
      projectId: string,
    ) => Promise<CanonicalSnapshot | undefined>,
  ) {}

  async retrieve(input: LexicalRetrieverInput): Promise<{
    readonly items: readonly LexicalCandidateResult[];
    readonly readiness: ProjectionReadiness;
  }> {
    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Project ID is required for lexical retrieval.',
        module: 'hybrid-retrieval',
        operation: 'lexical-retrieve',
      });
    }

    const query = input.query?.trim();
    if (!query) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Query is required for lexical retrieval.',
        module: 'hybrid-retrieval',
        operation: 'lexical-retrieve',
      });
    }

    if (!input.accessScopes || input.accessScopes.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Access scopes must be a non-empty array for lexical retrieval.',
        module: 'hybrid-retrieval',
        operation: 'lexical-retrieve',
      });
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: `Limit must be a positive integer <= ${HYBRID_SEARCH_MAX_LIMIT}. Received: ${limit}`,
        module: 'hybrid-retrieval',
        operation: 'lexical-retrieve',
      });
    }

    // 1. Watermark Readiness Verification
    const watermark = await this.repository.findWatermark(projectId);
    const snapshot = await this.getCanonicalSnapshot(projectId);

    const snapshotVersion = snapshot?.version ?? 0;
    const snapshotDigest = snapshot?.digest ?? '';

    let readiness: ProjectionReadiness;

    if (!watermark) {
      const ready = snapshotVersion === 0;
      readiness = {
        status: ready ? 'READY' : 'STALE',
        projectedCanonicalVersion: 0,
        canonicalVersion: snapshotVersion,
        lag: snapshotVersion,
        canonicalSnapshotDigest: snapshotDigest,
        ...(!ready ? { reason: 'Search Projection has not processed the Canonical Commit.' } : {}),
      };
    } else {
      const matches =
        watermark.canonicalVersion === snapshotVersion &&
        watermark.snapshotDigest === snapshotDigest;
      const status = watermark.status === 'DEGRADED' ? 'DEGRADED' : matches ? 'READY' : 'STALE';
      readiness = {
        status,
        projectedCanonicalVersion: watermark.canonicalVersion,
        canonicalVersion: snapshotVersion,
        lag: Math.max(0, snapshotVersion - watermark.canonicalVersion),
        projectedSnapshotDigest: watermark.snapshotDigest,
        canonicalSnapshotDigest: snapshotDigest,
        ...(watermark.lastCommitId ? { lastCommitId: watermark.lastCommitId } : {}),
        updatedAt: watermark.updatedAt,
        ...(status !== 'READY'
          ? { reason: watermark.lastError ?? 'Search Projection is behind Canonical Knowledge.' }
          : {}),
      };
    }

    if (readiness.status !== 'READY') {
      return { items: [], readiness };
    }

    const results = await this.repository.search(projectId, query, limit, input.accessScopes);
    const items: LexicalCandidateResult[] = results.map((res, index) => ({
      claimId: res.claimId,
      commitId: res.commitId,
      revisionId: res.revisionId,
      canonicalVersion: res.canonicalVersion,
      claimText: res.claimText,
      sourceVersionId: res.sourceVersionId,
      evidenceIds: [...res.evidenceIds],
      accessScope: [...res.accessScope],
      sensitivity: res.sensitivity,
      score: res.score,
      matchType: res.matchType,
      rank: index + 1,
    }));

    return { items, readiness };
  }
}

export class HybridRetrievalCoordinator implements HybridRetrievalCoordinatorPort {
  private readonly fusionPolicy: HybridFusionPolicy;
  private readonly clock: () => string;

  constructor(
    private readonly lexicalRetriever: LexicalRetrieverPort,
    private readonly semanticRetriever: SemanticRetrieverPort | undefined,
    private readonly resourceResolver: KnowledgeResourceResolverPort | undefined,
    private readonly evidenceResolver: EvidenceSpanResolverPort,
    private readonly sourceVersionResolver: SourceVersionResolverPort,
    private readonly activeGenerationReader?: SemanticActiveGenerationReaderPort,
    private readonly semanticProfileService?: SemanticEmbeddingProfilePort,
    options?: {
      readonly clock?: () => string;
      readonly fusionPolicy?: Partial<HybridFusionPolicy>;
    },
  ) {
    this.clock = options?.clock ?? (() => new Date().toISOString());
    this.fusionPolicy = {
      version: HYBRID_FUSION_POLICY_RRF_V1,
      k: options?.fusionPolicy?.k ?? HYBRID_FUSION_DEFAULT_RRF_K,
      lexicalWeight: options?.fusionPolicy?.lexicalWeight ?? 1.0,
      semanticWeight: options?.fusionPolicy?.semanticWeight ?? 1.0,
    };
  }

  async search(input: HybridRetrievalInput): Promise<HybridSearchResponse> {
    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Project ID is required for hybrid search.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    const query = input.query?.trim();
    if (!query) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Search query is required for hybrid search.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    if (!input.accessScopes || input.accessScopes.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Access scopes must be a non-empty array for hybrid search.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    if (!input.allowedSensitivities || input.allowedSensitivities.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Allowed sensitivities must be a non-empty array for hybrid search.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    if (!this.evidenceResolver || !this.sourceVersionResolver) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Evidence and SourceVersion resolvers are required for citation verification.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: `Limit must be a positive integer <= ${HYBRID_SEARCH_MAX_LIMIT}. Received: ${limit}`,
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    // 1. Lexical Retrieval
    const lexicalResult = await this.lexicalRetriever.retrieve({
      projectId,
      query,
      accessScopes: input.accessScopes,
      limit,
    });

    // 2. Semantic Retrieval
    let semanticItems: readonly SemanticCandidateResult[] = [];
    let semanticReadiness: SemanticReadiness = {
      status: 'NOT_CONFIGURED',
      data: 'NO_ACTIVE_GENERATION',
      execution: 'NOT_CONFIGURED',
      reason: 'Semantic retrieval is not configured.',
    };
    let semanticDegradedReason: string | undefined;

    if (!this.semanticRetriever) {
      semanticReadiness = {
        status: 'UNAVAILABLE',
        data: 'NO_ACTIVE_GENERATION',
        execution: 'NOT_CONFIGURED',
        reason: 'Semantic retrieval is not configured.',
      };
      semanticDegradedReason = 'Semantic retrieval is not configured.';
    } else {
      try {
        semanticItems = await this.semanticRetriever.retrieve({
          projectId,
          query,
          accessScopes: input.accessScopes,
          allowedSensitivities: input.allowedSensitivities,
          ...(input.actor === undefined ? {} : { actor: input.actor }),
          ...(input.security === undefined ? {} : { security: input.security }),
          limit,
        });

        if (semanticItems.some((item) => !isSemanticProductResourceType(item.resourceType))) {
          semanticItems = [];
          semanticReadiness = {
            status: 'DEGRADED',
            data: 'READY',
            execution: 'TEMPORARILY_UNAVAILABLE',
            reason: 'Semantic retrieval is temporarily unavailable.',
          };
          semanticDegradedReason = 'Semantic retrieval is temporarily unavailable.';
        } else {
          const activeGen = await this.activeGenerationReader?.getActiveGeneration(projectId);
          if (activeGen) {
            semanticReadiness = {
              status: 'READY',
              data: 'READY',
              execution: 'AVAILABLE',
              activeGenerationId: activeGen.generationId,
              embeddingProfileId: activeGen.embeddingProfileId,
              dimension: activeGen.dimension,
              updatedAt: activeGen.createdAt,
            };
          }
        }
      } catch (err: unknown) {
        if (err instanceof SemanticEmbeddingError) {
          switch (err.embeddingErrorCode) {
            case 'CONFIGURATION_REQUIRED':
              if (
                err.operation === 'semantic-retriever:read-active-generation' ||
                err.operation === 'resolve-active-profile'
              ) {
                semanticReadiness = {
                  status: 'NOT_CONFIGURED',
                  data: 'NO_ACTIVE_GENERATION',
                  execution: 'NOT_CONFIGURED',
                  reason:
                    err.operation === 'resolve-active-profile'
                      ? 'Active semantic embedding profile is not configured.'
                      : 'Active semantic projection is not configured.',
                };
                semanticDegradedReason =
                  err.operation === 'resolve-active-profile'
                    ? 'Active semantic embedding profile is not configured.'
                    : 'Active semantic projection is not configured.';
              } else {
                semanticReadiness = {
                  status: 'UNAVAILABLE',
                  data: 'READY',
                  execution: 'CREDENTIAL_UNAVAILABLE',
                  reason: 'Current semantic execution capability is unavailable.',
                };
                semanticDegradedReason = 'Current semantic execution capability is unavailable.';
              }
              break;
            case 'STALE':
              semanticReadiness = {
                status: 'STALE',
                data: 'STALE',
                execution: 'NOT_EVALUATED',
                reason: 'Semantic projection is stale relative to current Product knowledge.',
              };
              semanticDegradedReason =
                'Semantic projection is stale relative to current Product knowledge.';
              break;
            case 'CAPABILITY_UNAVAILABLE':
              {
                const credentialUnavailable =
                  err.operation.includes('credential') || err.operation.includes('vault');
                semanticReadiness = {
                  status: 'UNAVAILABLE',
                  data: 'READY',
                  execution: credentialUnavailable
                    ? 'CREDENTIAL_UNAVAILABLE'
                    : 'PROVIDER_UNAVAILABLE',
                  reason: credentialUnavailable
                    ? 'Pinned semantic credential revision is unavailable.'
                    : 'Active semantic projection generation is unavailable.',
                };
                semanticDegradedReason = credentialUnavailable
                  ? 'Pinned semantic credential revision is unavailable.'
                  : 'Active semantic projection generation is unavailable.';
              }
              break;
            case 'POLICY_DENIED':
              semanticReadiness = {
                status: 'DEGRADED',
                data: 'READY',
                execution: 'POLICY_DENIED',
                reason: 'Semantic embedding policy denied for requested sensitivity.',
              };
              semanticDegradedReason =
                'Semantic embedding policy denied for requested sensitivity.';
              break;
            case 'TIMEOUT':
              semanticReadiness = {
                status: 'DEGRADED',
                data: 'READY',
                execution: 'TEMPORARILY_UNAVAILABLE',
                reason: 'Semantic embedding service timed out.',
              };
              semanticDegradedReason = 'Semantic embedding service timed out.';
              break;
            default:
              semanticReadiness = {
                status: 'DEGRADED',
                data: 'READY',
                execution: 'TEMPORARILY_UNAVAILABLE',
                reason: 'Semantic retrieval is temporarily unavailable.',
              };
              semanticDegradedReason = 'Semantic retrieval is temporarily unavailable.';
              break;
          }
        } else {
          semanticReadiness = {
            status: 'DEGRADED',
            data: 'READY',
            execution: 'TEMPORARILY_UNAVAILABLE',
            reason: 'Semantic retrieval is temporarily unavailable.',
          };
          semanticDegradedReason = 'Semantic retrieval is temporarily unavailable.';
        }
      }
    }

    const rrfK = this.fusionPolicy.k;
    const lexicalWeight = this.fusionPolicy.lexicalWeight ?? 1.0;
    const semanticWeight = this.fusionPolicy.semanticWeight ?? 1.0;
    const allowedScopeSet = new Set(input.accessScopes);
    const callerHighestSens = getHighestSensitivity(input.allowedSensitivities);

    type CandidateAccumulator = {
      resourceType: SemanticProductResourceType;
      resourceId: string;
      text?: string;
      authority: SemanticCorpusAuthority;
      authorityRevision: number;
      resourceRevision?: number;
      legacyCanonicalVersion?: number;
      canonicalVersion?: number;
      baseCanonicalVersion?: number;
      sourceSnapshotDigest?: string;
      sourceProjectionDigest?: string;
      evidenceIds: string[];
      accessScope: string[];
      sensitivity: 'public' | 'internal' | 'private' | 'restricted';
      lexicalRank?: number;
      lexicalScore?: number;
      lexicalMatchType?: 'FULL_TEXT' | 'TRIGRAM' | 'SUBSTRING';
      semanticRank?: number;
      fusionScore: number;
    };

    const buildCandidatesAndResolve = async (
      lexItems: readonly LexicalCandidateResult[],
      semItems: readonly SemanticCandidateResult[],
    ): Promise<HybridCandidateResult[]> => {
      const candidateMap = new Map<string, CandidateAccumulator>();

      for (const lex of lexItems) {
        const key = `CLAIM:${lex.claimId}`;
        const rrfScore = lexicalWeight / (rrfK + lex.rank);
        candidateMap.set(key, {
          resourceType: 'CLAIM',
          resourceId: lex.claimId,
          text: lex.claimText,
          authority: 'CANONICAL',
          authorityRevision: lex.canonicalVersion,
          resourceRevision: lex.canonicalVersion,
          canonicalVersion: lex.canonicalVersion,
          evidenceIds: [...lex.evidenceIds],
          accessScope: [...lex.accessScope],
          sensitivity: lex.sensitivity,
          lexicalRank: lex.rank,
          lexicalScore: lex.score,
          lexicalMatchType: lex.matchType,
          fusionScore: rrfScore,
        });
      }

      for (let index = 0; index < semItems.length; index++) {
        const sem = semItems[index]!;
        if (!isSemanticProductResourceType(sem.resourceType)) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'FACT is not eligible for the Product semantic result.',
            module: 'hybrid-retrieval',
            operation: 'fuse-candidates',
          });
        }
        const semRank = index + 1;
        const key = `${sem.resourceType}:${sem.resourceId}`;
        const semRrfScore = semanticWeight / (rrfK + semRank);
        const authority =
          sem.authority ??
          sem.provenance?.authority ??
          (sem.resourceType === 'CLAIM' ? 'CANONICAL' : 'APPROVED_KNOWLEDGE');
        const hasExplicitAuthority =
          sem.authority !== undefined || sem.provenance?.authority !== undefined;
        const canonicalVersion =
          authority === 'CANONICAL' && hasExplicitAuthority ? sem.canonicalVersion : undefined;
        const legacyCanonicalVersion = hasExplicitAuthority ? undefined : sem.canonicalVersion;
        const baseCanonicalVersion =
          sem.provenance?.authority === 'CANONICAL' ||
          sem.provenance?.authority === 'COMPILED_TRUTH'
            ? sem.provenance.baseCanonicalVersion
            : undefined;
        const sourceProjectionDigest =
          sem.provenance?.authority === 'COMPILED_TRUTH'
            ? sem.provenance.sourceProjectionDigest
            : undefined;
        const authorityRevision =
          sem.provenance?.authority === 'COMPILED_TRUTH'
            ? sem.provenance.projectionCanonicalVersion
            : (sem.provenance?.resourceRevision ?? sem.canonicalVersion);

        const existing = candidateMap.get(key);
        if (existing) {
          if (
            existing.canonicalVersion !== undefined &&
            (canonicalVersion ?? legacyCanonicalVersion) !== undefined &&
            existing.canonicalVersion !== (canonicalVersion ?? legacyCanonicalVersion)
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Version mismatch for ${key}: lexical canonical version ${existing.canonicalVersion} !== semantic canonical version ${sem.canonicalVersion}.`,
              module: 'hybrid-retrieval',
              operation: 'fuse-candidates',
            });
          }

          if (existing.sensitivity !== sem.sensitivity) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: `Sensitivity mismatch for ${key} between lexical and semantic projections.`,
              module: 'hybrid-retrieval',
              operation: 'fuse-candidates',
            });
          }

          if (!areStringSetsEqual(existing.accessScope, sem.accessScope)) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: `Access scope mismatch for duplicate candidate ${key} between lexical and semantic projections.`,
              module: 'hybrid-retrieval',
              operation: 'fuse-candidates',
            });
          }

          if (!areStringSetsEqual(existing.evidenceIds, sem.evidenceIds)) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Evidence mismatch for duplicate candidate ${key} between lexical and semantic projections.`,
              module: 'hybrid-retrieval',
              operation: 'fuse-candidates',
            });
          }

          existing.semanticRank = semRank;
          existing.fusionScore += semRrfScore;
        } else {
          candidateMap.set(key, {
            resourceType: sem.resourceType,
            resourceId: sem.resourceId,
            authority,
            authorityRevision,
            ...(sem.provenance?.resourceRevision === undefined
              ? {}
              : { resourceRevision: sem.provenance.resourceRevision }),
            ...(legacyCanonicalVersion === undefined ? {} : { legacyCanonicalVersion }),
            ...(canonicalVersion === undefined ? {} : { canonicalVersion }),
            ...(baseCanonicalVersion === undefined ? {} : { baseCanonicalVersion }),
            ...(authority === 'COMPILED_TRUTH'
              ? { sourceSnapshotDigest: sem.sourceProjectionDigest }
              : {}),
            ...(sourceProjectionDigest === undefined ? {} : { sourceProjectionDigest }),
            evidenceIds: [...sem.evidenceIds],
            accessScope: [...sem.accessScope],
            sensitivity: sem.sensitivity,
            semanticRank: semRank,
            fusionScore: semRrfScore,
          });
        }
      }

      const sortedCandidates = Array.from(candidateMap.values()).sort((left, right) => {
        if (Math.abs(left.fusionScore - right.fusionScore) > 1e-12) {
          return right.fusionScore - left.fusionScore;
        }
        const typeCmp = compareOrdinal(left.resourceType, right.resourceType);
        if (typeCmp !== 0) return typeCmp;
        return compareOrdinal(left.resourceId, right.resourceId);
      });

      const topK = sortedCandidates.slice(0, limit);
      const items: HybridCandidateResult[] = [];

      for (let index = 0; index < topK.length; index++) {
        const cand = topK[index]!;
        const fusionRank = index + 1;

        const signals: HybridFusionSignal[] = [];
        if (cand.lexicalRank !== undefined && cand.semanticRank !== undefined) {
          signals.push('HYBRID', 'LEXICAL', 'SEMANTIC');
        } else if (cand.lexicalRank !== undefined) {
          signals.push('LEXICAL');
        } else {
          signals.push('SEMANTIC');
        }

        let text = cand.text;
        let canonicalVersion = cand.canonicalVersion;
        let evidenceIds = cand.evidenceIds;

        if (!text) {
          if (!this.resourceResolver) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Knowledge resource resolver is not configured to resolve ${cand.resourceType}:${cand.resourceId}.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-content',
            });
          }

          const resolved = await this.resourceResolver.resolveResource(
            projectId,
            cand.resourceType,
            cand.resourceId,
            cand.authority,
          );

          if (!resolved || !resolved.text || resolved.text.trim().length === 0) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Semantic resource ${cand.resourceType}:${cand.resourceId} could not be resolved from authoritative knowledge.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-content',
            });
          }

          if (resolved.authority !== undefined && resolved.authority !== cand.authority) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Authority mismatch for ${cand.resourceType}:${cand.resourceId}.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-content',
            });
          }

          if (
            resolved.authorityRevision !== undefined &&
            resolved.authorityRevision !== cand.authorityRevision
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Authority revision mismatch for ${cand.resourceType}:${cand.resourceId}.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-content',
            });
          }

          // Compatibility for bounded legacy adapters that predate the
          // explicit authority contract. New Product resolvers return typed
          // authority and revision fields instead.
          if (
            resolved.authority === undefined &&
            resolved.canonicalVersion !== undefined &&
            cand.legacyCanonicalVersion !== undefined &&
            resolved.canonicalVersion !== cand.legacyCanonicalVersion
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `resolved canonical version ${resolved.canonicalVersion} !== candidate version ${cand.legacyCanonicalVersion}`,
              module: 'hybrid-retrieval',
              operation: 'resolve-content',
            });
          }

          if (resolved.sensitivity !== undefined) {
            if (!hasSensitivityClearance(callerHighestSens, resolved.sensitivity)) {
              throw new ShotgunError({
                code: 'POLICY_DENIED',
                safeMessage: `Caller lacks clearance for resolved resource ${cand.resourceType}:${cand.resourceId} sensitivity '${resolved.sensitivity}'.`,
                module: 'hybrid-retrieval',
                operation: 'resolve-content',
              });
            }
            if (resolved.sensitivity !== cand.sensitivity) {
              throw new ShotgunError({
                code: 'POLICY_DENIED',
                safeMessage: `Sensitivity mismatch for ${cand.resourceType}:${cand.resourceId}: resolved '${resolved.sensitivity}' !== projected '${cand.sensitivity}'.`,
                module: 'hybrid-retrieval',
                operation: 'resolve-content',
              });
            }
          }

          if (resolved.accessScope !== undefined && resolved.accessScope.length > 0) {
            if (!areStringSetsEqual(cand.accessScope, resolved.accessScope)) {
              throw new ShotgunError({
                code: 'POLICY_DENIED',
                safeMessage: `Access scope mismatch for ${cand.resourceType}:${cand.resourceId}: projected [${cand.accessScope.join(', ')}] !== authoritative [${resolved.accessScope.join(', ')}].`,
                module: 'hybrid-retrieval',
                operation: 'resolve-content',
              });
            }
            const resolvedScopeAllowed = resolved.accessScope.every((s) => allowedScopeSet.has(s));
            if (!resolvedScopeAllowed) {
              throw new ShotgunError({
                code: 'POLICY_DENIED',
                safeMessage: `Caller lacks access scope for resolved resource ${cand.resourceType}:${cand.resourceId}.`,
                module: 'hybrid-retrieval',
                operation: 'resolve-content',
              });
            }
          }

          if (cand.evidenceIds && cand.evidenceIds.length > 0) {
            if (!resolved.evidenceIds || resolved.evidenceIds.length === 0) {
              throw new ShotgunError({
                code: 'VALIDATION_ERROR',
                safeMessage: `Evidence authority missing for ${cand.resourceType}:${cand.resourceId}.`,
                module: 'hybrid-retrieval',
                operation: 'resolve-content',
              });
            }
            const allContained = cand.evidenceIds.every((evId) =>
              resolved.evidenceIds!.includes(evId),
            );
            if (!allContained) {
              throw new ShotgunError({
                code: 'VALIDATION_ERROR',
                safeMessage: `Evidence identity mismatch for ${cand.resourceType}:${cand.resourceId}: candidate evidence [${cand.evidenceIds.join(', ')}] is not a subset of authoritative evidence [${resolved.evidenceIds.join(', ')}].`,
                module: 'hybrid-retrieval',
                operation: 'resolve-content',
              });
            }
          }

          text = resolved.text;
          const resolvedAuthority = resolved.authority ?? cand.authority;
          cand.authority = resolvedAuthority;
          if (resolved.authorityRevision !== undefined) {
            cand.authorityRevision = resolved.authorityRevision;
          }
          if (resolved.resourceRevision !== undefined) {
            cand.resourceRevision = resolved.resourceRevision;
          }
          if (resolved.baseCanonicalVersion !== undefined) {
            cand.baseCanonicalVersion = resolved.baseCanonicalVersion;
          }
          if (resolved.sourceSnapshotDigest !== undefined) {
            cand.sourceSnapshotDigest = resolved.sourceSnapshotDigest;
          }
          if (resolved.sourceProjectionDigest !== undefined) {
            cand.sourceProjectionDigest = resolved.sourceProjectionDigest;
          }
          if (resolved.canonicalVersion !== undefined && resolvedAuthority === 'CANONICAL') {
            canonicalVersion = resolved.canonicalVersion;
          }
          if (
            (!evidenceIds || evidenceIds.length === 0) &&
            resolved.evidenceIds &&
            resolved.evidenceIds.length > 0
          ) {
            evidenceIds = [...resolved.evidenceIds];
          }
        }

        const authority = cand.authority;
        const authorityRevision = cand.authorityRevision;

        if (!evidenceIds || evidenceIds.length === 0) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: `Candidate ${cand.resourceType}:${cand.resourceId} has no evidence references.`,
            module: 'hybrid-retrieval',
            operation: 'resolve-citations',
          });
        }

        const citations: HybridCitation[] = [];
        for (const evidenceId of evidenceIds) {
          const span = await this.evidenceResolver.getEvidenceSpan(projectId, evidenceId);
          if (!span) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `EvidenceSpan '${evidenceId}' referenced by ${cand.resourceType}:${cand.resourceId} was not found.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-citations',
            });
          }

          const scopeAllowed = span.accessScope.every((scope) => allowedScopeSet.has(scope));
          if (!scopeAllowed || !hasSensitivityClearance(callerHighestSens, span.sensitivity)) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: `Caller lacks access clearance for EvidenceSpan '${evidenceId}'.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-citations',
            });
          }

          const sourceVersion = await this.sourceVersionResolver.getSourceVersion(
            projectId,
            span.sourceVersionId,
          );
          if (!sourceVersion) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `SourceVersion '${span.sourceVersionId}' referenced by EvidenceSpan '${evidenceId}' was not found.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-citations',
            });
          }

          if (
            sourceVersion.projectId !== projectId ||
            (span.sourceId && sourceVersion.sourceId !== span.sourceId)
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `SourceVersion '${span.sourceVersionId}' does not match project or source lineage for EvidenceSpan '${evidenceId}'.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-citations',
            });
          }

          citations.push({
            evidenceId: span.evidenceId,
            sourceId: span.sourceId,
            sourceVersionId: span.sourceVersionId,
            revisionId: span.revisionId,
            exactQuote: span.quote.exact,
            pointer: span.pointer,
            position: span.position,
            selectors: span.selectors,
          });
        }

        if (citations.length === 0) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: `Candidate ${cand.resourceType}:${cand.resourceId} has unresolvable citation lineage.`,
            module: 'hybrid-retrieval',
            operation: 'resolve-citations',
          });
        }

        items.push({
          resourceType: cand.resourceType,
          resourceId: cand.resourceId,
          text,
          authority,
          authorityRevision,
          ...(cand.resourceRevision === undefined
            ? {}
            : { resourceRevision: cand.resourceRevision }),
          ...(canonicalVersion === undefined ? {} : { canonicalVersion }),
          ...(cand.baseCanonicalVersion === undefined
            ? {}
            : { baseCanonicalVersion: cand.baseCanonicalVersion }),
          ...(cand.sourceSnapshotDigest === undefined
            ? {}
            : { sourceSnapshotDigest: cand.sourceSnapshotDigest }),
          ...(cand.sourceProjectionDigest === undefined
            ? {}
            : { sourceProjectionDigest: cand.sourceProjectionDigest }),
          evidenceIds,
          citations,
          accessScope: cand.accessScope,
          sensitivity: cand.sensitivity,
          signals,
          lexicalRank: cand.lexicalRank,
          lexicalScore: cand.lexicalScore,
          lexicalMatchType: cand.lexicalMatchType,
          semanticRank: cand.semanticRank,
          fusionRank,
          fusionScore: cand.fusionScore,
        });
      }

      return items;
    };

    let items: HybridCandidateResult[] = [];
    if (semanticItems.length > 0) {
      try {
        items = await buildCandidatesAndResolve(lexicalResult.items, semanticItems);
      } catch (err: unknown) {
        if (lexicalResult.readiness.status === 'READY') {
          semanticReadiness = {
            status: 'DEGRADED',
            data: 'READY',
            execution: 'TEMPORARILY_UNAVAILABLE',
            reason: 'Semantic retrieval is temporarily unavailable.',
          };
          semanticDegradedReason = 'Semantic retrieval is temporarily unavailable.';
          items = await buildCandidatesAndResolve(lexicalResult.items, []);
        } else {
          throw err;
        }
      }
    } else {
      items = await buildCandidatesAndResolve(lexicalResult.items, []);
    }

    const isDegraded =
      lexicalResult.readiness.status !== 'READY' || semanticReadiness.status !== 'READY';

    return {
      schemaVersion: '1.0.0',
      projectId,
      query,
      items,
      readiness: {
        lexical: lexicalResult.readiness,
        semantic: semanticReadiness,
        degraded: isDegraded,
        degradedReason: semanticDegradedReason ?? lexicalResult.readiness.reason,
      },
      fusionPolicy: this.fusionPolicy,
      generatedAt: this.clock(),
    };
  }
}

export const createHybridRetrievalModule = (
  coordinator: HybridRetrievalCoordinatorPort,
): ShotgunModule => ({
  manifest: {
    id: 'stage7.hybrid-retrieval',
    version: '1.0.0',
    owner: 'Shotgun Hybrid Semantic Retrieval',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [{ name: 'SearchHybridKnowledge', range: '>=1.0.0 <2.0.0' }],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [],
      readsViaPorts: ['SearchCanonicalKnowledge query', 'GetEvidenceSpan query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [],
    },
    produces: {
      events: [],
      handoffs: [],
    },
    provides: {
      queries: [{ name: 'SearchHybridKnowledge', range: '>=1.0.0 <2.0.0' }],
      capabilities: [{ name: 'hybrid-retrieval-provider', priority: 100 }],
    },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: {
      canWriteCanonical: false,
      canExecuteExternalAction: false,
    },
  },
  contracts: [
    {
      name: 'SearchHybridKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchHybridKnowledgeSchema,
      outputSchema: hybridSearchResponseSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [],
    queries: [
      {
        messageType: 'SearchHybridKnowledge',
        version: '1.0.0',
        requiredAccessScopes: [],
        async handle(envelope) {
          const security = envelope.security;
          if (
            !envelope.projectId ||
            !envelope.actor?.id ||
            !security?.accessScope ||
            security.accessScope.length === 0 ||
            !security?.sensitivity
          ) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage:
                'SecurityContext (accessScope, sensitivity) is required for hybrid search.',
              module: 'hybrid-retrieval',
              operation: 'query-search-hybrid',
            });
          }

          const allowedSensitivities = deriveAuthorizedSensitivities(security.sensitivity);

          const payload = envelope.payload as HybridSearchRequest;
          return await coordinator.search({
            projectId: envelope.projectId,
            query: payload.query,
            accessScopes: security.accessScope,
            allowedSensitivities,
            actor: envelope.actor,
            security,
            limit: payload.limit,
          });
        },
      },
    ],
  },
});

export type { SourceVersionResolverPort };
