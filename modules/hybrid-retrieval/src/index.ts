import searchHybridKnowledgeSchema from '../../../packages/contracts/schemas/search-hybrid-knowledge.v1.schema.json';
import hybridSearchResponseSchema from '../../../packages/contracts/schemas/hybrid-search-response.v1.schema.json';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import {
  type CanonicalClaim,
  type CanonicalSearchResult,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
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
  type SemanticCandidateResult,
  SemanticEmbeddingError,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingResolverPort,
  type SemanticIndexRepositoryPort,
  type SemanticReadiness,
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

export const AKP1_PRODUCT_ELIGIBLE_SEMANTIC_RESOURCE_TYPES: readonly SemanticResourceType[] =
  Object.freeze(['CLAIM', 'ENTITY', 'RELATION', 'EVENT', 'DECISION']);

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
  ): Promise<KnowledgeResourceContent | undefined> {
    switch (resourceType) {
      case 'CLAIM': {
        const claim = await this.canonicalKnowledge.findClaim(projectId, resourceId);
        if (!claim) {
          return undefined;
        }
        return {
          text: claim.claimText,
          evidenceIds: claim.evidenceIds,
          sourceVersionId: claim.sourceVersionId,
          accessScope: claim.accessScope,
          sensitivity: claim.sensitivity,
        };
      }

      case 'ENTITY':
      case 'RELATION':
      case 'EVENT':
      case 'DECISION': {
        if (this.knowledgeModel) {
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

    if (this.compiledTruth) {
      const projection = await this.compiledTruth.findProjection(projectId);
      if (projection) {
        const item = projection.items.find((i) => i.id === resourceId && i.type === resourceType);
        if (item) {
          return {
            text: item.label,
            canonicalVersion: projection.canonicalVersion,
            evidenceIds: item.evidenceIds,
            accessScope: item.accessScope,
            sensitivity: item.sensitivity,
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
    private readonly executionPort: SemanticEmbeddingExecutionPort,
    private readonly activeGenerationReader: SemanticActiveGenerationReaderPort,
    private readonly getCanonicalSnapshot?: (
      projectId: string,
    ) => Promise<CanonicalSnapshot | undefined>,
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

    // 1. Resolve execution authority using highest sensitivity requested
    const highestSens = getHighestSensitivity(input.allowedSensitivities);
    const resolved = await this.resolver.resolveExecution({
      projectId,
      sensitivity: highestSens,
    });

    // 2. Resolve active generation for this project
    const gen = await this.activeGenerationReader.getActiveGeneration(projectId);
    if (!gen || gen.buildStatus !== 'READY') {
      throw new SemanticEmbeddingError({
        code: 'CAPABILITY_UNAVAILABLE',
        safeMessage: `No ready active semantic projection generation was found for project '${projectId}'.`,
        operation: 'semantic-retriever:retrieve',
      });
    }

    // 2b. STALE safety check: do not query vector store or execute query embedding if active generation is stale
    if (this.getCanonicalSnapshot) {
      const snap = await this.getCanonicalSnapshot(projectId);
      if (snap && snap.version > gen.canonicalBaseVersion) {
        throw new SemanticEmbeddingError({
          code: 'CAPABILITY_UNAVAILABLE',
          safeMessage: `Active semantic projection generation '${gen.generationId}' is stale (canonical version ${snap.version} > base version ${gen.canonicalBaseVersion}).`,
          operation: 'semantic-retriever:retrieve',
        });
      }
    }

    // 3. Complete execution pin compatibility validation
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

    // 4. Validate injected execution Port identity against generation execution pin
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

    // 5. Generate query vector using WP1 semantic embedding authority
    const embedRes = await this.executionPort.embed({
      text: query,
      resourceType: 'QUERY',
    });

    // 6. Verify returned execution result identity against generation pin
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

    // 7. Query nearest neighbors with Security-before-Top-K filtering
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
      reason: 'Semantic retrieval is not configured.',
    };
    let semanticDegradedReason: string | undefined;

    if (!this.semanticRetriever) {
      semanticReadiness = {
        status: 'UNAVAILABLE',
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
          limit,
        });

        if (
          semanticItems.some(
            (item) => !AKP1_PRODUCT_ELIGIBLE_SEMANTIC_RESOURCE_TYPES.includes(item.resourceType),
          )
        ) {
          semanticItems = [];
          semanticReadiness = {
            status: 'DEGRADED',
            reason: 'Semantic retrieval is temporarily unavailable.',
          };
          semanticDegradedReason = 'Semantic retrieval is temporarily unavailable.';
        } else {
          const activeGen = await this.activeGenerationReader?.getActiveGeneration(projectId);
          if (activeGen) {
            const isStale =
              lexicalResult.readiness.canonicalVersion !== undefined &&
              activeGen.canonicalBaseVersion < lexicalResult.readiness.canonicalVersion;
            semanticReadiness = {
              status: isStale ? 'STALE' : 'READY',
              activeGenerationId: activeGen.generationId,
              embeddingProfileId: activeGen.embeddingProfileId,
              dimension: activeGen.dimension,
              updatedAt: activeGen.createdAt,
              ...(isStale ? { reason: 'Semantic projection is behind Canonical Knowledge.' } : {}),
            };
            if (isStale) {
              semanticDegradedReason = 'Semantic projection is behind Canonical Knowledge.';
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof SemanticEmbeddingError) {
          switch (err.embeddingErrorCode) {
            case 'CONFIGURATION_REQUIRED':
              semanticReadiness = {
                status: 'NOT_CONFIGURED',
                reason: 'Active semantic embedding profile is not configured.',
              };
              semanticDegradedReason = 'Active semantic embedding profile is not configured.';
              break;
            case 'CAPABILITY_UNAVAILABLE': {
              const isStale = err.safeMessage.toLowerCase().includes('stale');
              semanticReadiness = {
                status: isStale ? 'STALE' : 'UNAVAILABLE',
                reason: isStale
                  ? 'Semantic projection is behind Canonical Knowledge.'
                  : 'Active semantic projection generation is unavailable.',
              };
              semanticDegradedReason = isStale
                ? 'Semantic projection is behind Canonical Knowledge.'
                : 'Active semantic projection generation is unavailable.';
              break;
            }
            case 'POLICY_DENIED':
              semanticReadiness = {
                status: 'DEGRADED',
                reason: 'Semantic embedding policy denied for requested sensitivity.',
              };
              semanticDegradedReason =
                'Semantic embedding policy denied for requested sensitivity.';
              break;
            case 'TIMEOUT':
              semanticReadiness = {
                status: 'DEGRADED',
                reason: 'Semantic embedding service timed out.',
              };
              semanticDegradedReason = 'Semantic embedding service timed out.';
              break;
            default:
              semanticReadiness = {
                status: 'DEGRADED',
                reason: 'Semantic retrieval is temporarily unavailable.',
              };
              semanticDegradedReason = 'Semantic retrieval is temporarily unavailable.';
              break;
          }
        } else {
          semanticReadiness = {
            status: 'DEGRADED',
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
      resourceType: SemanticResourceType;
      resourceId: string;
      text?: string;
      canonicalVersion?: number;
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
        const semRank = index + 1;
        const key = `${sem.resourceType}:${sem.resourceId}`;
        const semRrfScore = semanticWeight / (rrfK + semRank);

        const existing = candidateMap.get(key);
        if (existing) {
          if (
            existing.canonicalVersion !== undefined &&
            sem.canonicalVersion !== undefined &&
            existing.canonicalVersion !== sem.canonicalVersion
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
            canonicalVersion: sem.canonicalVersion,
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
        let canonicalVersion = cand.canonicalVersion ?? 0;
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
          );

          if (!resolved || !resolved.text || resolved.text.trim().length === 0) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Semantic resource ${cand.resourceType}:${cand.resourceId} could not be resolved from authoritative knowledge.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-content',
            });
          }

          if (
            resolved.canonicalVersion !== undefined &&
            cand.canonicalVersion !== undefined &&
            resolved.canonicalVersion !== cand.canonicalVersion
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: `Version mismatch for ${cand.resourceType}:${cand.resourceId}: resolved canonical version ${resolved.canonicalVersion} !== candidate version ${cand.canonicalVersion}.`,
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
          if (resolved.canonicalVersion !== undefined) {
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
          canonicalVersion,
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
            limit: payload.limit,
          });
        },
      },
    ],
  },
});

export type { SourceVersionResolverPort };
export * from './corpus-reader.js';
export * from './lifecycle-coordinator.js';
