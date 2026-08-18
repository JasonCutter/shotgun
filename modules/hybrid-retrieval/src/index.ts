import searchHybridKnowledgeSchema from '../../../packages/contracts/schemas/search-hybrid-knowledge.v1.schema.json';
import hybridSearchResponseSchema from '../../../packages/contracts/schemas/hybrid-search-response.v1.schema.json';
import searchCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import canonicalSearchResponseSchema from '../../../packages/contracts/schemas/canonical-search-response.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import {
  type CanonicalSearchMatch,
  type CanonicalSearchResult,
  type CanonicalSnapshot,
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
  type HybridSearchReadiness,
  type HybridSearchRequest,
  type HybridSearchResponse,
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

const computeLexicalReadiness = (
  snapshot: CanonicalSnapshot,
  watermark: ProjectionWatermark | undefined,
): ProjectionReadiness => {
  if (!watermark) {
    const ready = snapshot.version === 0;
    return {
      status: ready ? 'READY' : 'STALE',
      projectedCanonicalVersion: 0,
      canonicalVersion: snapshot.version,
      lag: snapshot.version,
      ...(ready ? { projectedSnapshotDigest: snapshot.digest } : {}),
      canonicalSnapshotDigest: snapshot.digest,
      ...(!ready ? { reason: 'Search Projection has not processed the Canonical Commit.' } : {}),
    };
  }
  const matches =
    watermark.canonicalVersion === snapshot.version && watermark.snapshotDigest === snapshot.digest;
  const status = watermark.status === 'DEGRADED' ? 'DEGRADED' : matches ? 'READY' : 'STALE';
  return {
    status,
    projectedCanonicalVersion: watermark.canonicalVersion,
    canonicalVersion: snapshot.version,
    lag: Math.max(0, snapshot.version - watermark.canonicalVersion),
    projectedSnapshotDigest: watermark.snapshotDigest,
    canonicalSnapshotDigest: snapshot.digest,
    ...(watermark.lastCommitId ? { lastCommitId: watermark.lastCommitId } : {}),
    updatedAt: watermark.updatedAt,
    ...(status !== 'READY'
      ? { reason: watermark.lastError ?? 'Search Projection is behind Canonical Knowledge.' }
      : {}),
  };
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
    const query = input.query?.trim();
    if (!projectId || !query) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID and query are required for semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }
    if (!Array.isArray(input.accessScopes) || input.accessScopes.length === 0) {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: 'Access scopes must be a non-empty array for authorized semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }
    for (const scope of input.accessScopes) {
      if (typeof scope !== 'string' || scope.trim().length === 0) {
        throw new SemanticEmbeddingError({
          code: 'POLICY_DENIED',
          safeMessage: 'All accessScope entries must be non-empty strings.',
          operation: 'semantic-retriever:retrieve',
        });
      }
    }
    if (!Array.isArray(input.allowedSensitivities) || input.allowedSensitivities.length === 0) {
      throw new SemanticEmbeddingError({
        code: 'POLICY_DENIED',
        safeMessage: 'Allowed sensitivities must be provided for authorized semantic retrieval.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
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

    // 3. Verify active generation belongs to exact project and is compatible with resolved profile
    if (gen.projectId !== projectId) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage:
          'Active semantic projection generation does not belong to the requested project.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    if (
      gen.embeddingProfileId !== resolved.profile.profileId ||
      gen.embeddingProfileRevision !== resolved.profile.profileRevision ||
      gen.dimension !== resolved.model.shotgunDefaultDimension ||
      gen.representationVersion !== resolved.profile.representationVersion
    ) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage:
          'Active semantic projection generation is incompatible with the resolved embedding profile.',
        operation: 'semantic-retriever:retrieve',
      });
    }

    // 4. Generate query vector using WP1 semantic embedding authority
    const embedRes = await this.executionPort.embed({
      text: query,
      resourceType: 'QUERY',
    });

    if (embedRes.dimension !== gen.dimension || embedRes.vector.length !== gen.dimension) {
      throw new SemanticEmbeddingError({
        code: 'VALIDATION_FAILURE',
        safeMessage: `Query vector dimension ${embedRes.vector.length} does not match generation dimension ${gen.dimension}.`,
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
    private readonly getCanonicalSnapshot: (projectId: string) => Promise<CanonicalSnapshot>,
  ) {}

  async retrieve(input: LexicalRetrieverInput): Promise<{
    readonly items: readonly LexicalCandidateResult[];
    readonly readiness: ProjectionReadiness;
  }> {
    const projectId = input.projectId?.trim();
    const query = input.query?.trim();
    if (!projectId || !query) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Project ID and query are required for lexical retrieval.',
        module: 'stage7.projection-search',
        operation: 'lexical-retriever:retrieve',
      });
    }
    if (!Array.isArray(input.accessScopes) || input.accessScopes.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Access scopes must be a non-empty array for lexical retrieval.',
        module: 'stage7.projection-search',
        operation: 'lexical-retriever:retrieve',
      });
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: `Limit must be a positive integer <= ${HYBRID_SEARCH_MAX_LIMIT}. Received: ${limit}`,
        module: 'stage7.projection-search',
        operation: 'lexical-retriever:retrieve',
      });
    }

    const [snapshot, watermark] = await Promise.all([
      this.getCanonicalSnapshot(projectId),
      this.repository.findWatermark(projectId),
    ]);

    const readiness = computeLexicalReadiness(snapshot, watermark);
    if (readiness.status !== 'READY') {
      return { items: [], readiness };
    }

    const searchResults = await this.repository.search(projectId, query, limit, input.accessScopes);

    const items: LexicalCandidateResult[] = searchResults.map(
      (result: CanonicalSearchResult, index: number) => ({
        claimId: result.claimId,
        commitId: result.commitId,
        revisionId: result.revisionId,
        canonicalVersion: result.canonicalVersion,
        claimText: result.claimText,
        sourceVersionId: result.sourceVersionId,
        evidenceIds: [...result.evidenceIds],
        accessScope: [...result.accessScope],
        sensitivity: result.sensitivity,
        score: result.score,
        matchType: result.matchType,
        rank: index + 1,
      }),
    );

    return { items, readiness };
  }
}

type InternalMergedCandidate = {
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly text: string;
  readonly canonicalVersion: number;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly lexicalRank?: number;
  readonly lexicalScore?: number;
  readonly lexicalMatchType?: CanonicalSearchMatch;
  readonly semanticRank?: number;
  readonly semanticDistance?: number;
  readonly fusionScore: number;
};

export class HybridRetrievalCoordinator implements HybridRetrievalCoordinatorPort {
  private readonly clock: () => string;

  constructor(
    private readonly lexicalRetriever: LexicalRetrieverPort,
    private readonly semanticRetriever: SemanticRetrieverPort,
    private readonly evidenceResolver: EvidenceSpanResolverPort,
    private readonly activeGenerationReader: SemanticActiveGenerationReaderPort,
    private readonly profilePort?: SemanticEmbeddingProfilePort,
    options?: { readonly clock?: () => string },
  ) {
    this.clock = options?.clock ?? (() => new Date().toISOString());
  }

  async search(input: HybridRetrievalInput): Promise<HybridSearchResponse> {
    const projectId = input.projectId?.trim();
    const query = input.query?.trim();
    if (!projectId || !query) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Project ID and query are required for hybrid retrieval.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    if (!Array.isArray(input.accessScopes) || input.accessScopes.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Access scopes must be a non-empty array for authorized hybrid retrieval.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }
    if (!Array.isArray(input.allowedSensitivities) || input.allowedSensitivities.length === 0) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Allowed sensitivities must be provided for authorized hybrid retrieval.',
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    const limit = input.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > HYBRID_SEARCH_MAX_LIMIT) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: `Limit must be a positive integer <= ${HYBRID_SEARCH_MAX_LIMIT}. Received: ${limit}`,
        module: 'hybrid-retrieval',
        operation: 'search',
      });
    }

    const rrfK = input.fusionPolicy?.k ?? HYBRID_FUSION_DEFAULT_RRF_K;
    const lexicalWeight = input.fusionPolicy?.lexicalWeight ?? 1.0;
    const semanticWeight = input.fusionPolicy?.semanticWeight ?? 1.0;

    const fusionPolicy: HybridFusionPolicy = {
      version: HYBRID_FUSION_POLICY_RRF_V1,
      k: rrfK,
      lexicalWeight,
      semanticWeight,
    };

    // 1. Execute Lexical Retrieval (Stage 7 authority)
    const lexicalResult = await this.lexicalRetriever.retrieve({
      projectId,
      query,
      accessScopes: input.accessScopes,
      limit,
    });

    // 2. Execute Semantic Retrieval with Request-Local Degradation handling
    let semanticCandidates: readonly SemanticCandidateResult[] = [];
    let semanticReadiness: SemanticReadiness;

    try {
      semanticCandidates = await this.semanticRetriever.retrieve({
        projectId,
        query,
        accessScopes: input.accessScopes,
        allowedSensitivities: input.allowedSensitivities,
        limit,
      });

      const activeGen = await this.activeGenerationReader.getActiveGeneration(projectId);
      semanticReadiness = {
        status: 'READY',
        activeGenerationId: activeGen?.generationId,
        embeddingProfileId: activeGen?.embeddingProfileId,
        dimension: activeGen?.dimension,
        updatedAt: activeGen?.createdAt,
      };
    } catch (error) {
      if (error instanceof SemanticEmbeddingError) {
        let status: SemanticReadiness['status'];
        let reason = error.safeMessage;

        switch (error.embeddingErrorCode) {
          case 'CONFIGURATION_REQUIRED':
            status = 'NOT_CONFIGURED';
            break;
          case 'CAPABILITY_UNAVAILABLE':
            status = 'UNAVAILABLE';
            break;
          case 'POLICY_DENIED':
            status = 'DEGRADED';
            reason = 'Query embedding policy denied for requested sensitivity.';
            break;
          case 'PROVIDER_FAILURE':
          case 'TIMEOUT':
            status = 'DEGRADED';
            reason = `Semantic embedding provider failure: ${error.safeMessage}`;
            break;
          default:
            status = 'DEGRADED';
        }

        semanticReadiness = {
          status,
          reason,
          updatedAt: this.clock(),
        };
      } else {
        // Unhandled unexpected semantic error -> degrade safely rather than crashing healthy lexical search
        semanticReadiness = {
          status: 'DEGRADED',
          reason: error instanceof Error ? error.message : 'Unknown semantic retrieval failure.',
          updatedAt: this.clock(),
        };
      }
    }

    // 3. Reciprocal Rank Fusion (RRF) & Merging
    const candidateMap = new Map<string, InternalMergedCandidate>();

    // Index lexical candidates
    for (const lex of lexicalResult.items) {
      const key = `CLAIM::${lex.claimId}`;
      const rrfScore = lexicalWeight / (rrfK + lex.rank);
      candidateMap.set(key, {
        resourceType: 'CLAIM',
        resourceId: lex.claimId,
        text: lex.claimText,
        canonicalVersion: lex.canonicalVersion,
        evidenceIds: lex.evidenceIds,
        accessScope: lex.accessScope,
        sensitivity: lex.sensitivity,
        lexicalRank: lex.rank,
        lexicalScore: lex.score,
        lexicalMatchType: lex.matchType,
        fusionScore: rrfScore,
      });
    }

    // Merge or insert semantic candidates
    semanticCandidates.forEach((sem, index) => {
      const semRank = index + 1;
      const key = `${sem.resourceType}::${sem.resourceId}`;
      const semScore = semanticWeight / (rrfK + semRank);

      const existing = candidateMap.get(key);
      if (existing) {
        // Dual-channel participation
        candidateMap.set(key, {
          ...existing,
          semanticRank: semRank,
          semanticDistance: sem.distance,
          fusionScore: existing.fusionScore + semScore,
        });
      } else {
        candidateMap.set(key, {
          resourceType: sem.resourceType,
          resourceId: sem.resourceId,
          text: '', // Semantic item text will be loaded/kept
          canonicalVersion: sem.canonicalVersion,
          evidenceIds: sem.evidenceIds,
          accessScope: sem.accessScope,
          sensitivity: sem.sensitivity,
          semanticRank: semRank,
          semanticDistance: sem.distance,
          fusionScore: semScore,
        });
      }
    });

    // 4. Deterministic sorting:
    // 1. fusionScore DESC
    // 2. resourceType ASC (alphabetical)
    // 3. resourceId ASC (UTF-16 code unit lexical order)
    const sortedCandidates = Array.from(candidateMap.values()).sort((a, b) => {
      if (Math.abs(b.fusionScore - a.fusionScore) > 1e-12) {
        return b.fusionScore - a.fusionScore;
      }
      if (a.resourceType !== b.resourceType) {
        return a.resourceType < b.resourceType ? -1 : 1;
      }
      return a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0;
    });

    const topK = sortedCandidates.slice(0, limit);

    // 5. Authoritative Citation Lineage Resolution
    const allowedScopeSet = new Set(input.accessScopes);

    const items: HybridCandidateResult[] = [];

    for (let index = 0; index < topK.length; index++) {
      const cand = topK[index]!;
      const fusionRank = index + 1;

      // Fail closed if evidenceIds is empty
      if (!Array.isArray(cand.evidenceIds) || cand.evidenceIds.length === 0) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: `Candidate ${cand.resourceType}:${cand.resourceId} has no evidence references.`,
          module: 'hybrid-retrieval',
          operation: 'resolve-citations',
        });
      }

      const citations: HybridCitation[] = [];
      for (const evidenceId of cand.evidenceIds) {
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
        const callerHighestSens = getHighestSensitivity(input.allowedSensitivities);
        if (!scopeAllowed || !hasSensitivityClearance(callerHighestSens, span.sensitivity)) {
          throw new ShotgunError({
            code: 'POLICY_DENIED',
            safeMessage: `Caller lacks access clearance for EvidenceSpan '${evidenceId}'.`,
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
          selectors: span.selectors ? [...span.selectors] : undefined,
        });
      }

      // Determine signals
      const signals: HybridFusionSignal[] = [];
      if (cand.lexicalRank !== undefined && cand.semanticRank !== undefined) {
        signals.push('HYBRID', 'LEXICAL', 'SEMANTIC');
      } else if (cand.lexicalRank !== undefined) {
        signals.push('LEXICAL');
      } else {
        signals.push('SEMANTIC');
      }

      items.push({
        resourceType: cand.resourceType,
        resourceId: cand.resourceId,
        text: cand.text,
        canonicalVersion: cand.canonicalVersion,
        evidenceIds: [...cand.evidenceIds],
        citations,
        accessScope: [...cand.accessScope],
        sensitivity: cand.sensitivity,
        signals,
        lexicalRank: cand.lexicalRank,
        lexicalScore: cand.lexicalScore,
        lexicalMatchType: cand.lexicalMatchType,
        semanticRank: cand.semanticRank,
        semanticDistance: cand.semanticDistance,
        fusionRank,
        fusionScore: cand.fusionScore,
      });
    }

    const readiness: HybridSearchReadiness = {
      lexical: lexicalResult.readiness,
      semantic: semanticReadiness,
      degraded: semanticReadiness.status !== 'READY',
      ...(semanticReadiness.status !== 'READY' ? { degradedReason: semanticReadiness.reason } : {}),
    };

    return {
      schemaVersion: '1.0.0',
      projectId,
      query,
      items,
      fusionPolicy,
      readiness,
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
        'SearchCanonicalKnowledge query',
        'GetEvidenceSpan query',
        'SemanticIndexRepositoryPort',
        'SemanticActiveGenerationReaderPort',
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
          return coordinator.search({
            projectId: envelope.projectId,
            query: payload.query,
            accessScopes: envelope.security.accessScope,
            allowedSensitivities: [envelope.security.sensitivity],
            limit: payload.limit,
            fusionPolicy: payload.fusionPolicy,
          });
        },
      },
    ],
  },
});
