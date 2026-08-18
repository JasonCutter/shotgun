import searchHybridKnowledgeSchema from '../../../packages/contracts/schemas/search-hybrid-knowledge.v1.schema.json';
import hybridSearchResponseSchema from '../../../packages/contracts/schemas/hybrid-search-response.v1.schema.json';
import searchCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import canonicalSearchResponseSchema from '../../../packages/contracts/schemas/canonical-search-response.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import {
  type CanonicalSearchResult,
  type CanonicalSnapshot,
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
  type KnowledgeResourceResolverPort,
  type LexicalCandidateResult,
  type LexicalRetrieverInput,
  type LexicalRetrieverPort,
  type ProjectionReadiness,
  type ProjectionWatermark,
  type QueryEnvelope,
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

const getHighestSensitivity = (
  sensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[],
): 'public' | 'internal' | 'private' | 'restricted' => {
  if (sensitivities.includes('restricted')) return 'restricted';
  if (sensitivities.includes('private')) return 'private';
  if (sensitivities.includes('internal')) return 'internal';
  return 'public';
};

export class SemanticRetriever implements SemanticRetrieverPort {
  constructor(
    private readonly repository: SemanticIndexRepositoryPort,
    private readonly resolver: SemanticEmbeddingResolverPort,
    private readonly executionPort: SemanticEmbeddingExecutionPort,
    private readonly activeGenerationReader: SemanticActiveGenerationReaderPort,
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

    // 4. Generate query vector using WP1 semantic embedding authority
    const embedRes = await this.executionPort.embed({
      text: query,
      resourceType: 'QUERY',
    });

    // Verify injected execution Port identity & result against generation pin
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

    // 5. Query nearest neighbors with Security-before-Top-K filtering
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
      throw new Error('Project ID and query are required for lexical retrieval.');
    }

    const query = input.query?.trim();
    if (!query) {
      throw new Error('Project ID and query are required for lexical retrieval.');
    }

    if (!input.accessScopes || input.accessScopes.length === 0) {
      throw new Error('Access scopes must be a non-empty array for lexical retrieval.');
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
      throw new Error(
        `Limit must be a positive integer <= ${HYBRID_SEARCH_MAX_LIMIT}. Received: ${limit}`,
      );
    }

    const watermark = await this.repository.findWatermark(projectId);
    const snapshot = await this.getCanonicalSnapshot(projectId);

    const canonicalVersion = snapshot?.version ?? 0;
    const projectedCanonicalVersion = watermark?.canonicalVersion ?? 0;
    const lag = Math.max(0, canonicalVersion - projectedCanonicalVersion);
    const snapshotDigest = snapshot?.digest ?? 'sha256:empty';

    let status: 'READY' | 'STALE' | 'DEGRADED' = 'READY';
    if (!watermark || watermark.status === 'DEGRADED') {
      status = 'DEGRADED';
    } else if (lag > 0 || watermark.snapshotDigest !== snapshotDigest) {
      status = 'STALE';
    }

    const readiness: ProjectionReadiness = {
      status,
      projectedCanonicalVersion,
      canonicalVersion,
      lag,
      canonicalSnapshotDigest: snapshotDigest,
      projectedSnapshotDigest: watermark?.snapshotDigest,
      lastCommitId: watermark?.lastCommitId,
      updatedAt: watermark?.updatedAt,
      reason:
        status === 'DEGRADED'
          ? (watermark?.lastError ?? 'Projection search is degraded.')
          : status === 'STALE'
            ? 'Projection lag behind canonical version.'
            : undefined,
    };

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
    private readonly semanticRetriever?: SemanticRetrieverPort,
    private readonly resourceResolver?: KnowledgeResourceResolverPort,
    private readonly evidenceResolver?: EvidenceSpanResolverPort,
    private readonly sourceVersionResolver?: SourceVersionResolverPort,
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
        safeMessage: 'Access scopes must be a non-empty array.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    if (!input.allowedSensitivities || input.allowedSensitivities.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Allowed sensitivities must be a non-empty array.',
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

    // 1. Execute Lexical Retrieval
    const lexicalResult = await this.lexicalRetriever.retrieve({
      projectId,
      query,
      accessScopes: input.accessScopes,
      limit,
    });

    // 2. Execute Semantic Retrieval with safe request-local degradation
    let semanticItems: readonly SemanticCandidateResult[] = [];
    let semanticReadiness: SemanticReadiness = { status: 'READY' };
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

        const activeGen = await this.activeGenerationReader?.getActiveGeneration(projectId);
        if (activeGen) {
          semanticReadiness = {
            status: 'READY',
            activeGenerationId: activeGen.generationId,
            embeddingProfileId: activeGen.embeddingProfileId,
            dimension: activeGen.dimension,
            updatedAt: activeGen.createdAt,
          };
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
            case 'CAPABILITY_UNAVAILABLE':
              semanticReadiness = {
                status: 'UNAVAILABLE',
                reason: 'Active semantic projection generation is unavailable.',
              };
              semanticDegradedReason = 'Active semantic projection generation is unavailable.';
              break;
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

    const isDegraded =
      lexicalResult.readiness.status !== 'READY' || semanticReadiness.status !== 'READY';

    // 3. Fusion (RRF: Reciprocal Rank Fusion)
    const rrfK = this.fusionPolicy.k;
    const lexicalWeight = this.fusionPolicy.lexicalWeight ?? 1.0;
    const semanticWeight = this.fusionPolicy.semanticWeight ?? 1.0;

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

    const candidateMap = new Map<string, CandidateAccumulator>();

    // Add lexical candidates
    for (const lex of lexicalResult.items) {
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

    // Add / merge semantic candidates
    for (let index = 0; index < semanticItems.length; index++) {
      const sem = semanticItems[index]!;
      const semRank = index + 1;
      const key = `${sem.resourceType}:${sem.resourceId}`;
      const semRrfScore = semanticWeight / (rrfK + semRank);

      const existing = candidateMap.get(key);
      if (existing) {
        existing.semanticRank = semRank;
        existing.fusionScore += semRrfScore;
        for (const ev of sem.evidenceIds) {
          if (!existing.evidenceIds.includes(ev)) {
            existing.evidenceIds.push(ev);
          }
        }
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

    // 4. Deterministic Sort: fusionScore DESC, then resourceType ASC, then resourceId ASC
    const sortedCandidates = Array.from(candidateMap.values()).sort((left, right) => {
      if (Math.abs(left.fusionScore - right.fusionScore) > 1e-12) {
        return right.fusionScore - left.fusionScore;
      }
      const typeCmp = left.resourceType.localeCompare(right.resourceType);
      if (typeCmp !== 0) return typeCmp;
      return left.resourceId.localeCompare(right.resourceId);
    });

    const topK = sortedCandidates.slice(0, limit);

    // 5. Authoritative Content and Citation Lineage Resolution
    const allowedScopeSet = new Set(input.accessScopes);
    const callerHighestSens = getHighestSensitivity(input.allowedSensitivities);
    const items: HybridCandidateResult[] = [];

    for (let index = 0; index < topK.length; index++) {
      const cand = topK[index]!;
      const fusionRank = index + 1;

      // Determine signals
      const signals: HybridFusionSignal[] = [];
      if (cand.lexicalRank !== undefined && cand.semanticRank !== undefined) {
        signals.push('HYBRID', 'LEXICAL', 'SEMANTIC');
      } else if (cand.lexicalRank !== undefined) {
        signals.push('LEXICAL');
      } else {
        signals.push('SEMANTIC');
      }

      // Resolve content for semantic-only resources if text is absent
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

      // Resolve and verify citation lineage: Knowledge -> EvidenceSpan -> SourceVersion
      const citations: HybridCitation[] = [];
      if (this.evidenceResolver) {
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

          // Security check on evidence span
          const scopeAllowed = span.accessScope.every((scope) => allowedScopeSet.has(scope));
          if (!scopeAllowed || !hasSensitivityClearance(callerHighestSens, span.sensitivity)) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: `Caller lacks access clearance for EvidenceSpan '${evidenceId}'.`,
              module: 'hybrid-retrieval',
              operation: 'resolve-citations',
            });
          }

          // Verify SourceVersion existence and project/source lineage
          if (this.sourceVersionResolver) {
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

    return {
      schemaVersion: '1.0.0',
      projectId,
      query,
      items,
      fusionPolicy: this.fusionPolicy,
      readiness: {
        lexical: lexicalResult.readiness,
        semantic: semanticReadiness,
        degraded: isDegraded,
        degradedReason: semanticDegradedReason,
      },
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
      contracts: [
        { name: 'SearchHybridKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'SearchCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [],
      readsViaPorts: [
        'SearchProjectionRepositoryPort.search',
        'SemanticIndexRepositoryPort.findNearestNeighbors',
        'SemanticActiveGenerationReaderPort.getActiveGeneration',
        'EvidenceSpanResolverPort.getEvidenceSpan',
      ],
      directSchemaAccess: false,
    },
    consumes: { commands: [], events: [] },
    produces: { events: [] },
    provides: {
      queries: [{ name: 'SearchHybridKnowledge', range: '>=1.0.0 <2.0.0' }],
      capabilities: [{ name: 'hybrid-retrieval-provider', priority: 100 }],
    },
    requires: {
      capabilities: [],
    },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'SearchHybridKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchHybridKnowledgeSchema,
      outputSchema: hybridSearchResponseSchema,
    },
    {
      name: 'SearchCanonicalKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchCanonicalKnowledgeSchema,
      outputSchema: canonicalSearchResponseSchema,
    },
    {
      name: 'GetEvidenceSpan',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getEvidenceSpanSchema,
      outputSchema: evidenceSpanSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [],
    queries: [
      {
        messageType: 'SearchHybridKnowledge',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope: QueryEnvelope) {
          if (!envelope.projectId || !envelope.actor || !envelope.security) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'Hybrid retrieval requires complete security context.',
              module: 'stage7.hybrid-retrieval',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          const payload = envelope.payload as HybridSearchRequest;
          const authorizedSensitivities = deriveAuthorizedSensitivities(
            envelope.security.sensitivity,
          );
          return coordinator.search({
            projectId: envelope.projectId,
            query: payload.query,
            accessScopes: envelope.security.accessScope,
            allowedSensitivities: authorizedSensitivities,
            limit: payload.limit,
          });
        },
      },
    ],
  },
});
