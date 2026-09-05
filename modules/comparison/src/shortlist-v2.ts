import {
  COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshotDigest,
  deriveAuthorizedSensitivities,
  isExactDuplicateV2,
  sha256Text,
  shortlistAuditDigestV2,
  stableJson,
  validateShortlistAuditV2,
  type Actor,
  type CanonicalSnapshot,
  type ComparisonDigestV2,
  type ExactDuplicateTargetV2,
  type HybridCandidateResult,
  type HybridRetrievalCoordinatorPort,
  type LexicalCandidateResult,
  type LexicalRetrieverPort,
  type ProjectionReadiness,
  type SemanticActiveGenerationReaderPort,
  type SemanticProjectionGeneration,
  type SemanticReadinessStatus,
  type SecurityContext,
  type ShortlistAuditV2,
  type ShortlistTargetIdentityV2,
} from '../../../packages/contracts/src/index.js';
import type { CanonicalSnapshotPort } from './index.js';

export const COMPARISON_SHORTLIST_POLICY_VERSION_V2 = 'comparison-shortlist-policy:v1' as const;
export const COMPARISON_SHORTLIST_OVERFETCH_MULTIPLIER_V2 = 4 as const;
export const COMPARISON_SHORTLIST_MAX_RETRIEVAL_LIMIT_V2 = 100 as const;

export type ComparisonShortlistV2Candidate = {
  readonly candidateId: string;
  readonly projectId: string;
  readonly claimText: string;
};

export type ComparisonShortlistV2Request = {
  readonly projectId: string;
  readonly candidate: ComparisonShortlistV2Candidate;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly k: number;
};

export type ShortlistBlockedReasonV2 =
  | 'INVALID_REQUEST'
  | 'POLICY_DENIED'
  | 'POLICY_INTEGRITY'
  | 'SNAPSHOT_INTEGRITY'
  | 'LEXICAL_UNAVAILABLE'
  | 'LEXICAL_STALE'
  | 'LEXICAL_DEGRADED'
  | 'SEMANTIC_UNAVAILABLE'
  | 'SEMANTIC_STALE'
  | 'SEMANTIC_DEGRADED'
  | 'GENERATION_UNAVAILABLE'
  | 'GENERATION_MISMATCH'
  | 'INSUFFICIENT_CLAIM_COVERAGE'
  | 'CONTRACT_INVALID';

export type ShortlistReadinessMetadataV2 = {
  readonly lexicalStatus?: ProjectionReadiness['status'];
  readonly semanticStatus?: SemanticReadinessStatus;
};

export type ComparisonShortlistV2Outcome =
  | {
      readonly status: 'EXACT_DUPLICATE';
      readonly exactDuplicateTarget: ExactDuplicateTargetV2;
    }
  | {
      readonly status: 'READY';
      readonly shortlist: ShortlistAuditV2;
      readonly shortlistDigest: ComparisonDigestV2;
    }
  | {
      readonly status: 'BLOCKED';
      readonly reason: ShortlistBlockedReasonV2;
      /** Safe readiness metadata only; never includes target IDs or text. */
      readonly readiness: ShortlistReadinessMetadataV2;
    };

export type ComparisonShortlistV2Dependencies = {
  readonly canonicalSnapshot: CanonicalSnapshotPort;
  readonly lexicalRetriever: LexicalRetrieverPort;
  readonly hybridRetrieval: HybridRetrievalCoordinatorPort;
  readonly activeGenerationReader: SemanticActiveGenerationReaderPort;
};

export type ComparisonShortlistV2Port = {
  build(request: ComparisonShortlistV2Request): Promise<ComparisonShortlistV2Outcome>;
};

const blocked = (
  reason: ShortlistBlockedReasonV2,
  readiness: ShortlistReadinessMetadataV2 = {},
): ComparisonShortlistV2Outcome => ({ status: 'BLOCKED', reason, readiness });

const isNonEmpty = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isScopeAllowed = (required: readonly string[], granted: readonly string[]): boolean => {
  const grantedSet = new Set(granted);
  return required.length > 0 && required.every((scope) => grantedSet.has(scope));
};

const isSensitivityAllowed = (
  sensitivity: SecurityContext['sensitivity'],
  allowed: readonly SecurityContext['sensitivity'][],
): boolean => allowed.includes(sensitivity);

const isValidSnapshot = (snapshot: CanonicalSnapshot, projectId: string): boolean =>
  isNonEmpty(snapshot.snapshotId) &&
  snapshot.projectId === projectId &&
  Number.isSafeInteger(snapshot.version) &&
  snapshot.version >= 0 &&
  snapshot.digest ===
    canonicalSnapshotDigest(projectId, snapshot.version, snapshot.claims, snapshot.relations);

const isLexicalReadyForSnapshot = (
  readiness: ProjectionReadiness,
  snapshot: CanonicalSnapshot,
): boolean =>
  readiness.status === 'READY' &&
  readiness.lag === 0 &&
  readiness.projectedCanonicalVersion === snapshot.version &&
  readiness.canonicalVersion === snapshot.version &&
  readiness.canonicalSnapshotDigest === snapshot.digest &&
  (readiness.projectedSnapshotDigest === undefined ||
    readiness.projectedSnapshotDigest === snapshot.digest);

/**
 * Lexical projection rows historically use canonicalVersion as their resource
 * revision. Semantic rows resolved through the canonical reader carry the
 * claim revision. Accept both while pinning the emitted target to the
 * authoritative snapshot claim revision.
 */
const isCompatibleClaimRevision = (
  value: number | undefined,
  claimRevision: number,
  snapshotVersion: number,
): boolean => value === undefined || value === claimRevision || value === snapshotVersion;

export const comparisonLexicalProjectionWatermarkV2 = (
  readiness: ProjectionReadiness,
  snapshot: CanonicalSnapshot,
): string =>
  sha256Text(
    stableJson({
      identityVersion: 'comparison-lexical-projection-watermark:v1',
      ...(readiness.lastCommitId === undefined ? {} : { lastCommitId: readiness.lastCommitId }),
      projectedCanonicalVersion: readiness.projectedCanonicalVersion,
      projectedSnapshotDigest: readiness.projectedSnapshotDigest ?? snapshot.digest,
    }),
  );

export const comparisonLexicalProjectionBaseV2 = (readiness: ProjectionReadiness): string =>
  sha256Text(
    stableJson({
      identityVersion: 'comparison-lexical-projection-base:v1',
      canonicalVersion: readiness.canonicalVersion,
      canonicalSnapshotDigest: readiness.canonicalSnapshotDigest,
    }),
  );

const policyRevision = (input: {
  readonly k: number;
  readonly retrievalLimit: number;
  readonly fusionPolicy: unknown;
}): string =>
  sha256Text(
    stableJson({
      identityVersion: COMPARISON_SHORTLIST_POLICY_VERSION_V2,
      activation: 'CLAIM_ONLY',
      overFetchMultiplier: COMPARISON_SHORTLIST_OVERFETCH_MULTIPLIER_V2,
      maxRetrievalLimit: COMPARISON_SHORTLIST_MAX_RETRIEVAL_LIMIT_V2,
      k: input.k,
      retrievalLimit: input.retrievalLimit,
      fusionPolicy: input.fusionPolicy,
    }),
  );

const safeSemanticReason = (status: SemanticReadinessStatus): ShortlistBlockedReasonV2 => {
  switch (status) {
    case 'STALE':
      return 'SEMANTIC_STALE';
    case 'DEGRADED':
      return 'SEMANTIC_DEGRADED';
    case 'READY':
      return 'GENERATION_MISMATCH';
    case 'UNAVAILABLE':
    case 'NOT_CONFIGURED':
      return 'SEMANTIC_UNAVAILABLE';
  }
};

const isGenerationReady = (
  generation: SemanticProjectionGeneration | undefined,
  snapshot: CanonicalSnapshot,
): generation is SemanticProjectionGeneration =>
  generation !== undefined &&
  generation.buildStatus === 'READY' &&
  generation.projectId === snapshot.projectId &&
  isNonEmpty(generation.generationId) &&
  isNonEmpty(generation.sourceProjectionDigest) &&
  generation.canonicalBaseVersion === snapshot.version;

const isAuthorizedClaimResult = (
  item: HybridCandidateResult,
  security: SecurityContext,
  allowedSensitivities: readonly SecurityContext['sensitivity'][],
): boolean =>
  item.authority === 'CANONICAL' &&
  isScopeAllowed(item.accessScope, security.accessScope) &&
  isSensitivityAllowed(item.sensitivity, allowedSensitivities);

const isSnapshotCompatibleClaimResult = (
  item: HybridCandidateResult,
  claim: CanonicalSnapshot['claims'][number],
  snapshot: CanonicalSnapshot,
  generation: SemanticProjectionGeneration,
): boolean => {
  if (item.canonicalVersion !== undefined && item.canonicalVersion !== snapshot.version) {
    return false;
  }
  if (item.baseCanonicalVersion !== undefined && item.baseCanonicalVersion !== snapshot.version) {
    return false;
  }
  if (item.sourceSnapshotDigest !== undefined && item.sourceSnapshotDigest !== snapshot.digest) {
    return false;
  }
  if (
    item.sourceProjectionDigest !== undefined &&
    item.sourceProjectionDigest !== generation.sourceProjectionDigest
  ) {
    return false;
  }
  if (!isCompatibleClaimRevision(item.authorityRevision, claim.revisionNumber, snapshot.version)) {
    return false;
  }
  if (!isCompatibleClaimRevision(item.resourceRevision, claim.revisionNumber, snapshot.version)) {
    return false;
  }
  return item.resourceId === claim.claimId;
};

const validateRequest = (
  request: ComparisonShortlistV2Request,
): ShortlistBlockedReasonV2 | undefined => {
  if (
    !isNonEmpty(request.projectId) ||
    !isNonEmpty(request.candidate.candidateId) ||
    !isNonEmpty(request.candidate.projectId) ||
    request.candidate.projectId !== request.projectId ||
    !isNonEmpty(request.candidate.claimText) ||
    !isNonEmpty(request.actor.id) ||
    !Array.isArray(request.security.accessScope) ||
    request.security.accessScope.length === 0 ||
    !Number.isSafeInteger(request.k) ||
    request.k < 1 ||
    request.k > COMPARISON_SHORTLIST_MAX_RETRIEVAL_LIMIT_V2
  ) {
    return 'INVALID_REQUEST';
  }
  return undefined;
};

const safeLexicalFailureReason = (
  readiness: ProjectionReadiness,
  snapshot: CanonicalSnapshot,
): ShortlistBlockedReasonV2 => {
  if (readiness.status === 'DEGRADED') return 'LEXICAL_DEGRADED';
  if (!isLexicalReadyForSnapshot(readiness, snapshot)) return 'LEXICAL_STALE';
  return 'LEXICAL_UNAVAILABLE';
};

const findAuthorizedLexicalClaim = (
  items: readonly LexicalCandidateResult[],
  snapshot: CanonicalSnapshot,
  candidateText: string,
  security: SecurityContext,
  allowedSensitivities: readonly SecurityContext['sensitivity'][],
):
  | { readonly claim: CanonicalSnapshot['claims'][number] }
  | { readonly blocked: ShortlistBlockedReasonV2 }
  | undefined => {
  for (const item of items) {
    if (
      !isScopeAllowed(item.accessScope, security.accessScope) ||
      !isSensitivityAllowed(item.sensitivity, allowedSensitivities)
    ) {
      continue;
    }
    if (
      !isNonEmpty(item.commitId) ||
      !isNonEmpty(item.revisionId) ||
      item.canonicalVersion !== snapshot.version
    ) {
      return { blocked: 'SNAPSHOT_INTEGRITY' };
    }
    const claim = snapshot.claims.find((entry) => entry.claimId === item.claimId);
    if (!claim) return { blocked: 'SNAPSHOT_INTEGRITY' };
    if (isExactDuplicateV2(candidateText, claim.text)) return { claim };
  }
  return undefined;
};

export class ComparisonShortlistV2Service implements ComparisonShortlistV2Port {
  constructor(private readonly dependencies: ComparisonShortlistV2Dependencies) {}

  async build(request: ComparisonShortlistV2Request): Promise<ComparisonShortlistV2Outcome> {
    const invalidRequest = validateRequest(request);
    if (invalidRequest) return blocked(invalidRequest);

    let snapshot: CanonicalSnapshot;
    try {
      snapshot = await this.dependencies.canonicalSnapshot.getSnapshot(request.projectId);
    } catch {
      return blocked('SNAPSHOT_INTEGRITY');
    }
    if (!isValidSnapshot(snapshot, request.projectId)) return blocked('SNAPSHOT_INTEGRITY');

    const allowedSensitivities = deriveAuthorizedSensitivities(request.security.sensitivity);
    const retrievalLimit = Math.min(
      Math.max(request.k * COMPARISON_SHORTLIST_OVERFETCH_MULTIPLIER_V2, request.k),
      COMPARISON_SHORTLIST_MAX_RETRIEVAL_LIMIT_V2,
    );

    let lexical: Awaited<ReturnType<LexicalRetrieverPort['retrieve']>>;
    try {
      lexical = await this.dependencies.lexicalRetriever.retrieve({
        projectId: request.projectId,
        query: request.candidate.claimText,
        accessScopes: request.security.accessScope,
        limit: retrievalLimit,
      });
    } catch {
      return blocked('LEXICAL_UNAVAILABLE');
    }

    if (!isLexicalReadyForSnapshot(lexical.readiness, snapshot)) {
      return blocked(safeLexicalFailureReason(lexical.readiness, snapshot), {
        lexicalStatus: lexical.readiness.status,
      });
    }

    const lexicalMatch = findAuthorizedLexicalClaim(
      lexical.items,
      snapshot,
      request.candidate.claimText,
      request.security,
      allowedSensitivities,
    );
    if (lexicalMatch && 'blocked' in lexicalMatch) {
      return blocked(lexicalMatch.blocked, { lexicalStatus: lexical.readiness.status });
    }
    if (lexicalMatch && 'claim' in lexicalMatch) {
      return {
        status: 'EXACT_DUPLICATE',
        exactDuplicateTarget: {
          resourceType: 'CLAIM',
          resourceId: lexicalMatch.claim.claimId,
          resourceRevision: lexicalMatch.claim.revisionNumber,
          canonicalSnapshot: {
            id: snapshot.snapshotId,
            version: snapshot.version,
            digest: snapshot.digest,
          },
        },
      };
    }

    let hybrid;
    try {
      hybrid = await this.dependencies.hybridRetrieval.search({
        projectId: request.projectId,
        query: request.candidate.claimText,
        accessScopes: request.security.accessScope,
        allowedSensitivities,
        actor: request.actor,
        security: request.security,
        limit: retrievalLimit,
      });
    } catch {
      return blocked('SEMANTIC_UNAVAILABLE', { lexicalStatus: lexical.readiness.status });
    }

    if (hybrid.projectId !== request.projectId) {
      return blocked('POLICY_INTEGRITY', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus: hybrid.readiness.semantic.status,
      });
    }
    if (!isLexicalReadyForSnapshot(hybrid.readiness.lexical, snapshot)) {
      return blocked(safeLexicalFailureReason(hybrid.readiness.lexical, snapshot), {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus: hybrid.readiness.semantic.status,
      });
    }

    const semanticStatus = hybrid.readiness.semantic.status;
    if (semanticStatus !== 'READY') {
      return blocked(safeSemanticReason(semanticStatus), {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }

    let generation: SemanticProjectionGeneration | undefined;
    try {
      generation = await this.dependencies.activeGenerationReader.getActiveGeneration(
        request.projectId,
      );
    } catch {
      return blocked('GENERATION_UNAVAILABLE', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }
    if (!isGenerationReady(generation, snapshot)) {
      return blocked('GENERATION_UNAVAILABLE', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }
    if (hybrid.readiness.semantic.activeGenerationId !== generation.generationId) {
      return blocked('GENERATION_MISMATCH', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }
    if (hybrid.readiness.degraded) {
      return blocked('SEMANTIC_DEGRADED', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }

    const exclusionCounts: Record<string, number> = {};
    const selected = new Map<string, ShortlistTargetIdentityV2>();
    for (const item of hybrid.items) {
      if (item.resourceType !== 'CLAIM') {
        exclusionCounts[item.resourceType] = (exclusionCounts[item.resourceType] ?? 0) + 1;
        continue;
      }

      const claim = snapshot.claims.find((entry) => entry.claimId === item.resourceId);
      if (!claim) {
        return blocked('SNAPSHOT_INTEGRITY', {
          lexicalStatus: hybrid.readiness.lexical.status,
          semanticStatus,
        });
      }
      if (!isAuthorizedClaimResult(item, request.security, allowedSensitivities)) {
        return blocked('POLICY_INTEGRITY', {
          lexicalStatus: hybrid.readiness.lexical.status,
          semanticStatus,
        });
      }
      if (!isSnapshotCompatibleClaimResult(item, claim, snapshot, generation)) {
        return blocked('SNAPSHOT_INTEGRITY', {
          lexicalStatus: hybrid.readiness.lexical.status,
          semanticStatus,
        });
      }

      const target: ShortlistTargetIdentityV2 = {
        resourceType: 'CLAIM',
        resourceId: claim.claimId,
        resourceRevision: claim.revisionNumber,
      };
      selected.set(
        `${target.resourceType}:${target.resourceId}:${target.resourceRevision}`,
        target,
      );
    }

    const selectedTargetIdentities = [...selected.values()].slice(0, request.k);
    const retrievalSaturated = hybrid.items.length >= retrievalLimit;
    if (
      selectedTargetIdentities.length === 0 ||
      (retrievalSaturated && selectedTargetIdentities.length < request.k)
    ) {
      return blocked('INSUFFICIENT_CLAIM_COVERAGE', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }

    const shortlist: ShortlistAuditV2 = {
      contractVersion: COMPARISON_V2_CONTRACT_VERSION,
      canonicalSnapshot: {
        id: snapshot.snapshotId,
        version: snapshot.version,
        digest: snapshot.digest,
      },
      lexicalProjectionWatermark: comparisonLexicalProjectionWatermarkV2(
        hybrid.readiness.lexical,
        snapshot,
      ),
      lexicalProjectionBase: comparisonLexicalProjectionBaseV2(hybrid.readiness.lexical),
      semanticGenerationId: generation.generationId,
      semanticSourceProjectionDigest: generation.sourceProjectionDigest,
      semanticCanonicalBaseVersion: generation.canonicalBaseVersion,
      querySemanticReadiness: 'READY',
      policyRevision: policyRevision({
        k: request.k,
        retrievalLimit,
        fusionPolicy: hybrid.fusionPolicy,
      }),
      k: request.k,
      selectedTargetIdentities,
      exclusionCounts,
      truncated: false,
      coverageStatus: 'COMPLETE',
    };

    try {
      validateShortlistAuditV2(shortlist);
    } catch {
      return blocked('CONTRACT_INVALID', {
        lexicalStatus: hybrid.readiness.lexical.status,
        semanticStatus,
      });
    }

    return {
      status: 'READY',
      shortlist,
      shortlistDigest: shortlistAuditDigestV2(shortlist),
    };
  }
}

export const createComparisonShortlistV2 = (
  dependencies: ComparisonShortlistV2Dependencies,
): ComparisonShortlistV2Port => new ComparisonShortlistV2Service(dependencies);
