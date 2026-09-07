import { randomUUID } from 'node:crypto';

import {
  COMPARISON_V2_CONTRACT_VERSION,
  assertComparisonFreshForReviewV2,
  assertReviewAuthorityInvariantV2,
  candidateEvidenceDigestV2,
  comparisonFreshnessDigestV2,
  comparisonResultDigestV2,
  draftChangeSetContentDigestV2,
  evaluateComparisonFreshnessV2,
  deriveAuthorizedSensitivities,
  sha256Text,
  stableJson,
  validateComparisonChildrenV2,
  validateDraftChangeSetV2,
  resolveReviewOperationV2CommandDigest,
  validateResolveReviewOperationV2Request,
  type Actor,
  type DraftChangeSetV2,
  type ReviewAuthoritySelectionV2,
  type SecurityContext,
  type SemanticRelationshipV2,
  type AnalysisRevisionV2,
  type ComparisonResultV2,
  type ComparisonDigestV2,
  type ResolveReviewOperationV2Operation,
  type ResolveReviewOperationV2Outcome,
  type ResolveReviewOperationV2Request,
} from '../../../packages/contracts/src/index.js';
import type {
  ComparisonV2AggregateForReview,
  ComparisonV2ReviewFreshnessPort,
} from './review-v2.js';

export const OPERATION_RESOLUTION_V2_CONTRACT_VERSION = 'review-operation-resolution.v1' as const;

export type OperationResolutionV2 = {
  readonly resolutionId: string;
  readonly contractVersion: typeof OPERATION_RESOLUTION_V2_CONTRACT_VERSION;
  readonly projectId: string;
  readonly changeSetId: string;
  readonly sourceDraftRevision: number;
  readonly sourceDraftDigest: ComparisonDigestV2;
  readonly resolvedDraftRevision: number;
  readonly resolvedDraftDigest: ComparisonDigestV2;
  readonly comparisonId: string;
  readonly comparisonDigest: ComparisonDigestV2;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly candidateDigest: ComparisonDigestV2;
  readonly candidateSourceVersionId: string;
  readonly candidateEvidenceIds: readonly string[];
  readonly canonicalSnapshotId: string;
  readonly canonicalVersion: number;
  readonly canonicalDigest: ComparisonDigestV2;
  readonly shortlistDigest?: ComparisonDigestV2;
  readonly analysisRevisionIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly resolverActorId: string;
  readonly clientRequestId: string;
  readonly semanticCommandIdentity: string;
  readonly idempotencyKey: string;
  readonly commandDigest: ComparisonDigestV2;
  readonly resolutionDigest: ComparisonDigestV2;
  readonly chosenOperation: ResolveReviewOperationV2Operation;
  readonly state: 'RESOLVED';
  readonly createdAt: string;
};

export type ReviewOperationResolutionWrite = {
  readonly currentDraft: DraftChangeSetV2;
  readonly resolvedDraft: DraftChangeSetV2;
  readonly resolution: OperationResolutionV2;
};

export type ReviewOperationResolutionStoreResult = {
  readonly status: 'RESOLVED' | 'IDEMPOTENT_REPLAY';
  readonly resolution: OperationResolutionV2;
  readonly draft: DraftChangeSetV2;
};

export type ReviewOperationResolutionStorePort = {
  findDraftById(projectId: string, changeSetId: string): Promise<DraftChangeSetV2 | undefined>;
  findOperationResolutionByRequest(
    projectId: string,
    changeSetId: string,
    clientRequestId: string,
    idempotencyKey: string,
  ): Promise<OperationResolutionV2 | undefined>;
  resolveOperation(
    write: ReviewOperationResolutionWrite,
  ): Promise<ReviewOperationResolutionStoreResult>;
};

export type ResolveReviewOperationV2Dependencies = {
  readonly aggregate: {
    findComparisonById(
      projectId: string,
      comparisonId: string,
    ): Promise<ComparisonV2AggregateForReview | undefined>;
  };
  readonly freshness: ComparisonV2ReviewFreshnessPort;
  readonly repository: ReviewOperationResolutionStorePort;
  readonly now?: () => string;
  readonly accessRevision?: string;
  readonly policyContextRevision?: string;
};

export type ResolveReviewOperationV2Command = {
  readonly projectId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly authority: ReviewAuthoritySelectionV2;
  readonly rolloutAuthorityRevision: string;
  readonly accessSensitivityPolicyRevision?: string;
  readonly request: ResolveReviewOperationV2Request;
  readonly semanticCommandIdentity?: string;
};

export type ReviewOperationResolutionV2Port = {
  resolve(command: ResolveReviewOperationV2Command): Promise<ResolveReviewOperationV2Outcome>;
};

export type ReviewOperationResolutionV2AuthorityPort = {
  resolve(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly candidateRevision: number;
  }): Promise<{
    readonly selection: ReviewAuthoritySelectionV2;
    readonly authorityRevision: string;
  }>;
};

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const isAuthorized = (comparison: ComparisonResultV2, security: SecurityContext): boolean => {
  const allowed = deriveAuthorizedSensitivities(security.sensitivity);
  return (
    comparison.accessScope.length > 0 &&
    comparison.accessScope.every((scope) => security.accessScope.includes(scope)) &&
    allowed.includes(comparison.sensitivity)
  );
};

const sameLineage = (
  draft: DraftChangeSetV2,
  aggregate: ComparisonV2AggregateForReview,
): boolean => {
  const comparison = aggregate.comparison;
  return (
    draft.projectId === comparison.projectId &&
    draft.comparisonId === comparison.comparisonId &&
    draft.comparisonDigest === comparisonResultDigestV2(comparison) &&
    draft.candidate.id === comparison.candidate.id &&
    draft.candidate.revision === comparison.candidate.revision &&
    draft.candidate.digest === comparison.candidate.digest &&
    sameStringArray(draft.candidate.evidenceIds, comparison.candidate.evidenceIds) &&
    draft.canonicalSnapshot.id === comparison.canonicalSnapshot.id &&
    draft.canonicalSnapshot.version === comparison.canonicalSnapshot.version &&
    draft.canonicalSnapshot.digest === comparison.canonicalSnapshot.digest &&
    draft.disposition === comparison.disposition &&
    draft.reviewRecommendation === comparison.reviewRecommendation &&
    sameStringArray(draft.analysisRevisionIds, comparison.analysisRevisionIds) &&
    sameStringArray(draft.relationshipIds, comparison.relationshipIds)
  );
};

const resolutionDigest = (resolution: Omit<OperationResolutionV2, 'resolutionDigest'>): string =>
  sha256Text(
    stableJson({
      ...resolution,
      candidateEvidenceIds: [...resolution.candidateEvidenceIds].sort(),
      analysisRevisionIds: [...resolution.analysisRevisionIds].sort(),
      relationshipIds: [...resolution.relationshipIds].sort(),
    }),
  );

const matchesRequest = (
  resolution: OperationResolutionV2,
  request: ResolveReviewOperationV2Request,
): boolean =>
  resolution.sourceDraftRevision === request.expectedDraftRevision &&
  resolution.sourceDraftDigest === request.expectedDraftDigest &&
  resolution.chosenOperation === request.chosenOperation &&
  resolution.commandDigest === resolveReviewOperationV2CommandDigest(request);

const clone = <T>(value: T): T => structuredClone(value);

const validateResolveReviewOperationV2RequestInput: (
  value: unknown,
) => asserts value is ResolveReviewOperationV2Request = validateResolveReviewOperationV2Request;

/** Product/Review domain implementation. It performs only Review persistence;
 * Canonical, Stage 6, providers and external Actions are intentionally absent. */
export const createReviewOperationResolutionV2 = (
  dependencies: ResolveReviewOperationV2Dependencies,
): ReviewOperationResolutionV2Port => {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async resolve(
      command: ResolveReviewOperationV2Command,
    ): Promise<ResolveReviewOperationV2Outcome> {
      const request = command.request;
      try {
        validateResolveReviewOperationV2RequestInput(request);
      } catch {
        return { status: 'BLOCKED', code: 'INVALID_OPERATION' };
      }
      if (
        !nonEmpty(command.projectId) ||
        command.actor.type !== 'user' ||
        !nonEmpty(command.actor.id) ||
        !Array.isArray(command.security.accessScope) ||
        command.security.accessScope.length === 0 ||
        !nonEmpty(command.authority.projectId) ||
        command.authority.projectId !== command.projectId ||
        command.authority.rollout !== 'V2_ACTIVE' ||
        !nonEmpty(command.rolloutAuthorityRevision) ||
        (request.chosenOperation !== 'ADD_CLAIM' && request.chosenOperation !== 'NO_OP')
      ) {
        return { status: 'BLOCKED', code: 'FORBIDDEN' };
      }
      try {
        assertReviewAuthorityInvariantV2(command.authority);
      } catch {
        return { status: 'BLOCKED', code: 'PROJECT_SCOPE_MISMATCH' };
      }
      if (request.changeSetId.trim().length === 0 || request.clientRequestId.trim().length === 0) {
        return { status: 'BLOCKED', code: 'INVALID_OPERATION' };
      }

      let existing: OperationResolutionV2 | undefined;
      try {
        existing = await dependencies.repository.findOperationResolutionByRequest(
          command.projectId,
          request.changeSetId,
          request.clientRequestId,
          request.idempotencyKey,
        );
      } catch {
        return { status: 'BLOCKED', code: 'OUTCOME_UNKNOWN' };
      }
      if (existing) {
        if (!matchesRequest(existing, request)) {
          return { status: 'BLOCKED', code: 'IDEMPOTENCY_KEY_REUSE' };
        }
        return {
          status: 'IDEMPOTENT_REPLAY',
          resolutionId: existing.resolutionId,
          changeSetId: existing.changeSetId,
          sourceDraftRevision: existing.sourceDraftRevision,
          resolvedDraftRevision: existing.resolvedDraftRevision,
          resolvedDraftDigest: existing.resolvedDraftDigest,
          chosenOperation: existing.chosenOperation,
        };
      }

      let draft: DraftChangeSetV2 | undefined;
      try {
        draft = await dependencies.repository.findDraftById(command.projectId, request.changeSetId);
      } catch {
        return { status: 'BLOCKED', code: 'OUTCOME_UNKNOWN' };
      }
      if (!draft) return { status: 'BLOCKED', code: 'NOT_FOUND' };
      if (draft.projectId !== command.projectId) {
        return { status: 'BLOCKED', code: 'PROJECT_SCOPE_MISMATCH' };
      }
      if (
        !isAuthorized(
          {
            comparisonId: draft.comparisonId,
            contractVersion: COMPARISON_V2_CONTRACT_VERSION,
            projectId: draft.projectId,
            candidate: draft.candidate,
            canonicalSnapshot: draft.canonicalSnapshot,
            disposition: draft.disposition,
            reviewRecommendation: draft.reviewRecommendation,
            ...(draft.shortlistDigest === undefined ? {} : { shortlist: undefined }),
            analysisRevisionIds: [...draft.analysisRevisionIds],
            relationshipIds: [...draft.relationshipIds],
            accessScope: [...draft.accessScope],
            sensitivity: draft.sensitivity,
            createdAt: draft.createdAt,
          },
          command.security,
        )
      ) {
        return { status: 'BLOCKED', code: 'ACCESS_REVOKED' };
      }
      if (
        draft.revisionNumber !== request.expectedDraftRevision ||
        draft.contentDigest !== request.expectedDraftDigest
      ) {
        return { status: 'BLOCKED', code: 'DRAFT_REVISION_CONFLICT' };
      }
      if (
        draft.status !== 'PENDING_REVIEW' ||
        draft.disposition !== 'REVIEW_REQUIRED' ||
        draft.operation !== 'MODIFY_REVIEW' ||
        draft.reviewRecommendation !== 'MODIFY_REVIEW'
      ) {
        return { status: 'BLOCKED', code: 'DRAFT_NOT_ELIGIBLE' };
      }

      let aggregate: ComparisonV2AggregateForReview | undefined;
      try {
        aggregate = await dependencies.aggregate.findComparisonById(
          command.projectId,
          draft.comparisonId,
        );
      } catch {
        return { status: 'BLOCKED', code: 'OUTCOME_UNKNOWN' };
      }
      if (!aggregate) return { status: 'BLOCKED', code: 'NOT_FOUND' };
      if (
        aggregate.comparison.projectId !== command.projectId ||
        aggregate.comparison.candidate.id !== draft.candidate.id ||
        aggregate.comparison.candidate.revision !== draft.candidate.revision ||
        command.authority.candidateId !== draft.candidate.id ||
        command.authority.candidateRevision !== draft.candidate.revision ||
        !sameLineage(draft, aggregate)
      ) {
        return { status: 'BLOCKED', code: 'STALE_REVIEW_INPUT' };
      }
      try {
        validateComparisonChildrenV2(
          aggregate.comparison,
          aggregate.relationships,
          aggregate.analyses,
        );
      } catch {
        return { status: 'BLOCKED', code: 'STALE_REVIEW_INPUT' };
      }

      let current: Awaited<ReturnType<ComparisonV2ReviewFreshnessPort['getCurrent']>>;
      try {
        current = await dependencies.freshness.getCurrent({
          aggregate,
          expected: draft.freshnessIdentity,
          authority: command.authority,
          security: command.security,
        });
      } catch {
        return { status: 'BLOCKED', code: 'OUTCOME_UNKNOWN' };
      }
      const freshness = evaluateComparisonFreshnessV2(
        draft.freshnessIdentity,
        current.identity,
        current.shortlist ?? aggregate.comparison.shortlist,
      );
      if (
        freshness.reasons.some((reason) =>
          new Set<string>([
            'ACCESS_SENSITIVITY_POLICY_CHANGED',
            'SHORTLIST_POLICY_CHANGED',
            'SEMANTIC_POLICY_CHANGED',
          ]).has(reason),
        )
      ) {
        return { status: 'BLOCKED', code: 'POLICY_CHANGED' };
      }
      try {
        assertComparisonFreshForReviewV2(freshness, aggregate.comparison);
      } catch {
        return { status: 'BLOCKED', code: 'STALE_REVIEW_INPUT' };
      }
      if (draft.freshnessDigest !== comparisonFreshnessDigestV2(draft.freshnessIdentity)) {
        return { status: 'BLOCKED', code: 'STALE_REVIEW_INPUT' };
      }

      const createdAt = now();
      const resolvedDraftWithoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
        ...draft,
        revisionNumber: draft.revisionNumber + 1,
        operation: request.chosenOperation,
        updatedAt: createdAt,
      };
      const resolvedDraft: DraftChangeSetV2 = {
        ...resolvedDraftWithoutDigest,
        contentDigest: draftChangeSetContentDigestV2(resolvedDraftWithoutDigest),
      };
      validateDraftChangeSetV2(resolvedDraft);
      const commandDigest = resolveReviewOperationV2CommandDigest(request);
      const unsigned: Omit<OperationResolutionV2, 'resolutionDigest'> = {
        resolutionId: randomUUID(),
        contractVersion: OPERATION_RESOLUTION_V2_CONTRACT_VERSION,
        projectId: command.projectId,
        changeSetId: draft.changeSetId,
        sourceDraftRevision: draft.revisionNumber,
        sourceDraftDigest: draft.contentDigest,
        resolvedDraftRevision: resolvedDraft.revisionNumber,
        resolvedDraftDigest: resolvedDraft.contentDigest,
        comparisonId: aggregate.comparison.comparisonId,
        comparisonDigest: draft.comparisonDigest,
        candidateId: draft.candidate.id,
        candidateRevision: draft.candidate.revision,
        candidateDigest: draft.candidate.digest,
        candidateSourceVersionId: draft.candidate.sourceVersionId,
        candidateEvidenceIds: [...draft.candidate.evidenceIds].sort(),
        canonicalSnapshotId: draft.canonicalSnapshot.id,
        canonicalVersion: draft.canonicalSnapshot.version,
        canonicalDigest: draft.canonicalSnapshot.digest,
        ...(draft.shortlistDigest === undefined ? {} : { shortlistDigest: draft.shortlistDigest }),
        analysisRevisionIds: [...draft.analysisRevisionIds].sort(),
        relationshipIds: [...draft.relationshipIds].sort(),
        accessRevision: dependencies.accessRevision ?? command.rolloutAuthorityRevision,
        policyContextRevision:
          dependencies.policyContextRevision ??
          command.accessSensitivityPolicyRevision ??
          command.rolloutAuthorityRevision,
        resolverActorId: command.actor.id,
        clientRequestId: request.clientRequestId,
        semanticCommandIdentity:
          command.semanticCommandIdentity ??
          `review.resolve-operation-v2:${command.projectId}:${draft.changeSetId}:${draft.revisionNumber}`,
        idempotencyKey: request.idempotencyKey,
        commandDigest,
        chosenOperation: request.chosenOperation,
        state: 'RESOLVED',
        createdAt,
      };
      const resolution: OperationResolutionV2 = {
        ...unsigned,
        resolutionDigest: resolutionDigest(unsigned),
      };
      try {
        const stored = await dependencies.repository.resolveOperation({
          currentDraft: draft,
          resolvedDraft,
          resolution,
        });
        return {
          status: stored.status,
          resolutionId: stored.resolution.resolutionId,
          changeSetId: stored.resolution.changeSetId,
          sourceDraftRevision: stored.resolution.sourceDraftRevision,
          resolvedDraftRevision: stored.resolution.resolvedDraftRevision,
          resolvedDraftDigest: stored.resolution.resolvedDraftDigest,
          chosenOperation: stored.resolution.chosenOperation,
        };
      } catch (error) {
        const code = (error as { readonly code?: string }).code;
        if (code === 'IDEMPOTENCY_KEY_REUSE') {
          return { status: 'BLOCKED', code };
        }
        if (code === 'OUTCOME_UNKNOWN') return { status: 'BLOCKED', code };
        return {
          status: 'BLOCKED',
          code: code === 'DRAFT_REVISION_CONFLICT' ? code : 'RESOLUTION_CONFLICT',
        };
      }
    },
  };
};

/** Deterministic adapter used by Review unit/contract tests and by assemblies
 * that do not have PostgreSQL.  The write path clones all data and serializes
 * concurrent calls through a tiny in-process mutex. */
export class InMemoryReviewOperationResolutionStore implements ReviewOperationResolutionStorePort {
  private readonly drafts = new Map<string, DraftChangeSetV2>();
  private readonly revisions = new Map<string, DraftChangeSetV2>();
  private readonly resolutions = new Map<string, OperationResolutionV2>();
  private tail: Promise<void> = Promise.resolve();

  seedDraft(draft: DraftChangeSetV2): void {
    validateDraftChangeSetV2(draft);
    const key = `${draft.projectId}:${draft.changeSetId}`;
    this.drafts.set(key, clone(draft));
    this.revisions.set(`${key}:${draft.revisionNumber}`, clone(draft));
  }

  async findDraftById(
    projectId: string,
    changeSetId: string,
  ): Promise<DraftChangeSetV2 | undefined> {
    const draft = this.drafts.get(`${projectId}:${changeSetId}`);
    return draft === undefined ? undefined : clone(draft);
  }

  async findDraftRevision(
    projectId: string,
    changeSetId: string,
    revision: number,
  ): Promise<DraftChangeSetV2 | undefined> {
    const draft = this.revisions.get(`${projectId}:${changeSetId}:${revision}`);
    return draft === undefined ? undefined : clone(draft);
  }

  async findOperationResolutionByRequest(
    projectId: string,
    changeSetId: string,
    clientRequestId: string,
    idempotencyKey: string,
  ): Promise<OperationResolutionV2 | undefined> {
    const found = [...this.resolutions.values()].find(
      (resolution) =>
        resolution.projectId === projectId &&
        resolution.changeSetId === changeSetId &&
        (resolution.clientRequestId === clientRequestId ||
          resolution.idempotencyKey === idempotencyKey),
    );
    return found === undefined ? undefined : clone(found);
  }

  async findOperationResolutionForDraft(
    projectId: string,
    changeSetId: string,
    resolvedDraftRevision: number,
    resolvedDraftDigest: string,
    chosenOperation: ResolveReviewOperationV2Operation,
  ): Promise<OperationResolutionV2 | undefined> {
    const found = [...this.resolutions.values()].find(
      (resolution) =>
        resolution.projectId === projectId &&
        resolution.changeSetId === changeSetId &&
        resolution.resolvedDraftRevision === resolvedDraftRevision &&
        resolution.resolvedDraftDigest === resolvedDraftDigest &&
        resolution.chosenOperation === chosenOperation,
    );
    return found === undefined ? undefined : clone(found);
  }

  async resolveOperation(
    write: ReviewOperationResolutionWrite,
  ): Promise<ReviewOperationResolutionStoreResult> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      const key = `${write.resolution.projectId}:${write.resolution.changeSetId}`;
      const existing = [...this.resolutions.values()].find(
        (resolution) =>
          resolution.projectId === write.resolution.projectId &&
          resolution.changeSetId === write.resolution.changeSetId &&
          (resolution.clientRequestId === write.resolution.clientRequestId ||
            resolution.idempotencyKey === write.resolution.idempotencyKey),
      );
      if (existing) {
        if (
          existing.commandDigest !== write.resolution.commandDigest ||
          existing.chosenOperation !== write.resolution.chosenOperation
        ) {
          throw Object.assign(new Error('Idempotency key reused.'), {
            code: 'IDEMPOTENCY_KEY_REUSE',
          });
        }
        const current = this.drafts.get(key);
        if (!current)
          throw Object.assign(new Error('Resolution outcome is unknown.'), {
            code: 'OUTCOME_UNKNOWN',
          });
        return { status: 'IDEMPOTENT_REPLAY', resolution: clone(existing), draft: clone(current) };
      }
      const current = this.drafts.get(key);
      if (
        !current ||
        current.revisionNumber !== write.currentDraft.revisionNumber ||
        current.contentDigest !== write.currentDraft.contentDigest
      ) {
        throw Object.assign(new Error('Draft revision changed.'), {
          code: 'DRAFT_REVISION_CONFLICT',
        });
      }
      const sourceKey = `${key}:${write.resolution.sourceDraftRevision}`;
      const source = this.revisions.get(sourceKey);
      if (source && source.contentDigest !== write.resolution.sourceDraftDigest) {
        throw Object.assign(new Error('Source revision conflicts.'), {
          code: 'RESOLUTION_CONFLICT',
        });
      }
      this.revisions.set(sourceKey, clone(write.currentDraft));
      this.revisions.set(
        `${key}:${write.resolution.resolvedDraftRevision}`,
        clone(write.resolvedDraft),
      );
      this.resolutions.set(write.resolution.resolutionId, clone(write.resolution));
      this.drafts.set(key, clone(write.resolvedDraft));
      return {
        status: 'RESOLVED',
        resolution: clone(write.resolution),
        draft: clone(write.resolvedDraft),
      };
    } finally {
      release();
    }
  }

  listResolutions(): readonly OperationResolutionV2[] {
    return [...this.resolutions.values()].map(clone);
  }
}

export const operationResolutionV2CandidateEvidenceDigest = candidateEvidenceDigestV2;
export type OperationResolutionV2Lineage = {
  readonly relationships: readonly SemanticRelationshipV2[];
  readonly analyses: readonly AnalysisRevisionV2[];
};
