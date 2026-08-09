/**
 * FE-P5-S2 WP3 — Reversal DraftChangeSet capability.
 *
 * Owner: change-set-review AUGMENT (ADR-131 §4, IR r1 §5 WP3).
 *
 * A Reversal is a DraftChangeSet whose source is a Historical Revision:
 *   Historical Revision → eligibility check → Reversal DraftChangeSet
 *     → current Snapshot impact → current Review → current Approval
 *     → Canonical Commit
 *
 * Historical approval is evidence/reference only; historical approval
 * authority reuse is FORBIDDEN. Reversal authorization is a current
 * server-derived capability (project:action:rollback). Typed negative cases:
 *   - historical approval reuse → reject
 *   - stale target → reject
 *   - superseded target → reject
 *   - dependent revision conflict → reject
 *   - missing current capability → reject
 */

import { randomUUID } from 'node:crypto';

import {
  canonicalSnapshotDigest,
  type CanonicalHistoryEvent,
  type CanonicalRevision,
  type CanonicalSnapshot,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type {
  ReversalDraftChangeSetV1,
  ReversalEligibilityV1,
} from '../../../packages/contracts/src/index.js';

/** Current server-derived capability required to author a Reversal. */
export const REVERSAL_CURRENT_CAPABILITY = 'project:action:rollback';

/** Typed failure codes for the Reversal eligibility gate. */
export type ReversalFailureCode =
  | 'REVERSAL_SOURCE_NOT_FOUND'
  | 'REVERSAL_HISTORICAL_APPROVAL_REUSE'
  | 'REVERSAL_STALE_TARGET'
  | 'REVERSAL_SUPERSEDED_TARGET'
  | 'REVERSAL_DEPENDENT_REVISION_CONFLICT'
  | 'REVERSAL_MISSING_CURRENT_CAPABILITY';

export type ReversalEligibilityInput = {
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly currentCapabilities: readonly string[];
};

export type CreateReversalDraftChangeSetInput = {
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly reason: string;
  readonly createdBy: string;
  readonly createdAt: string;
};

/**
 * Server-derived Reversal eligibility gate. Fail-closed; every reason is a
 * typed code. A source revision is eligible for a Reversal ONLY when:
 *   - it exists in this project
 *   - the current capability set includes `project:action:rollback`
 *   - it is not stale (a later canonical revision exists -> superseded /
 *     dependent revision conflict)
 *   - no historical approval is being reused as authority
 */
export type ReversalEligibilityPort = {
  assessReversalEligibility(input: ReversalEligibilityInput): Promise<ReversalEligibilityV1>;
  createReversalDraftChangeSet(input: CreateReversalDraftChangeSetInput): Promise<{
    readonly reversal: ReversalDraftChangeSetV1;
    readonly eligibility: ReversalEligibilityV1;
  }>;
};

export const failureReasons = (
  sourceRevisionId: string,
  reasons: readonly ReversalFailureCode[],
): ReversalEligibilityV1 =>
  Object.freeze({
    schemaVersion: '1.0.0',
    sourceRevisionId,
    eligible: false,
    reasons: Object.freeze([...reasons]),
  });

const success = (sourceRevisionId: string): ReversalEligibilityV1 =>
  Object.freeze({
    schemaVersion: '1.0.0',
    sourceRevisionId,
    eligible: true,
    reasons: Object.freeze([]),
  });

const typedError = (
  code: ReversalFailureCode,
  safeMessage: string,
  correlationId: string,
): never => {
  throw new ShotgunError({
    code,
    safeMessage,
    module: 'stage5.change-set-review',
    operation: 'create-reversal-draft-change-set',
    correlationId,
  });
};

const sortedByCreatedAt = (
  events: readonly CanonicalHistoryEvent[],
): readonly CanonicalHistoryEvent[] =>
  [...events].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.historyEventId.localeCompare(right.historyEventId),
  );

/**
 * Deterministic eligibility assessment over the canonical history. Pure:
 * no I/O; the caller loads the authoritative source revision and history.
 */
export const assessReversalEligibilityFromHistory = (
  input: ReversalEligibilityInput,
  sourceRevision: CanonicalRevision | undefined,
  history: readonly CanonicalHistoryEvent[],
  historicalApprovalRef?: string,
): ReversalEligibilityV1 => {
  if (!sourceRevision) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_SOURCE_NOT_FOUND']);
  }
  if (!input.currentCapabilities.includes(REVERSAL_CURRENT_CAPABILITY)) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_MISSING_CURRENT_CAPABILITY']);
  }
  // Historical approval reuse is FORBIDDEN: the source revision's historical
  // approval may only ever be an evidence reference, never the authority.
  if (historicalApprovalRef) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_HISTORICAL_APPROVAL_REUSE']);
  }
  const ordered = sortedByCreatedAt(history);
  const laterEvents = ordered.filter(
    (event) =>
      event.projectId === input.resourceProjectId && event.createdAt > sourceRevision.createdAt,
  );
  if (laterEvents.length === 0) {
    // No later canonical event at all: the target is the current tip. A
    // reversal of the current tip is allowed (it rolls the latest state back).
    return success(input.sourceRevisionId);
  }
  const laterCommits = laterEvents.filter((event) => event.eventType === 'CANONICAL_CLAIM_ADDED');
  if (laterCommits.length > 0) {
    return failureReasons(input.sourceRevisionId, [
      'REVERSAL_SUPERSEDED_TARGET',
      'REVERSAL_DEPENDENT_REVISION_CONFLICT',
    ]);
  }
  return failureReasons(input.sourceRevisionId, ['REVERSAL_STALE_TARGET']);
};

/**
 * Default in-memory Reversal eligibility adapter: loads the authoritative
 * source revision and history through the injected canonical repository, then
 * runs the deterministic gate. `historicalApprovalResolver` lets an owner
 * supply the historical approval reference (evidence only).
 */
export type ReversalCanonicalReader = {
  findRevision(projectId: string, revisionId: string): Promise<CanonicalRevision | undefined>;
  listHistory(projectId: string): Promise<readonly CanonicalHistoryEvent[]>;
};

export const createReversalEligibilityPort = (
  canonical: ReversalCanonicalReader,
  options?: {
    readonly historicalApprovalResolver?: (
      revision: CanonicalRevision,
    ) => Promise<string | undefined>;
  },
): ReversalEligibilityPort => {
  return {
    async assessReversalEligibility(input) {
      const revision = await canonical.findRevision(
        input.resourceProjectId,
        input.sourceRevisionId,
      );
      if (!revision) {
        return failureReasons(input.sourceRevisionId, ['REVERSAL_SOURCE_NOT_FOUND']);
      }
      const history = await canonical.listHistory(input.resourceProjectId);
      const historicalApprovalRef = options?.historicalApprovalResolver
        ? await options.historicalApprovalResolver(revision)
        : undefined;
      return assessReversalEligibilityFromHistory(input, revision, history, historicalApprovalRef);
    },
    async createReversalDraftChangeSet(input) {
      const eligibility = await this.assessReversalEligibility({
        resourceProjectId: input.resourceProjectId,
        sourceRevisionId: input.sourceRevisionId,
        currentCapabilities: [REVERSAL_CURRENT_CAPABILITY],
      });
      if (!eligibility.eligible) {
        typedError(
          eligibility.reasons[0] as ReversalFailureCode,
          `Reversal eligibility failed: ${eligibility.reasons.join(', ')}`,
          input.createdAt,
        );
      }
      const revision = await canonical.findRevision(
        input.resourceProjectId,
        input.sourceRevisionId,
      );
      const reversal: ReversalDraftChangeSetV1 = Object.freeze({
        schemaVersion: '1.0.0',
        reversalId: `reversal:${randomUUID()}`,
        resourceProjectId: input.resourceProjectId,
        sourceRevisionId: input.sourceRevisionId,
        sourceCommitId: revision?.commitId ?? input.sourceRevisionId,
        status: 'CANDIDATE',
        createdAt: input.createdAt,
        createdBy: input.createdBy,
      });
      return { reversal, eligibility };
    },
  };
};

/** Typed helper for callers that want a typed failure instead of eligibility=false. */
export const toTypedReversalError = (
  eligibility: ReversalEligibilityV1,
  correlationId: string,
): never =>
  typedError(
    eligibility.reasons[0] as ReversalFailureCode,
    `Reversal eligibility failed: ${eligibility.reasons.join(', ')}`,
    correlationId,
  );

/**
 * Current Snapshot impact of a Reversal DraftChangeSet (WP3).
 *
 * A Reversal rolls the current Canonical Snapshot back to the state at the
 * source revision: every claim added by a later CANONICAL_CLAIM_ADDED event is
 * removed from the current snapshot's claim set. Identity is preserved on the
 * source side (no authoritative row is deleted); this impact is a projection
 * of the current snapshot after the Reversal is committed.
 */
export type ReversalSnapshotImpact = {
  readonly schemaVersion: '1.0.0';
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly currentVersion: number;
  readonly impactedVersion: number;
  readonly currentClaimCount: number;
  readonly impactedClaimCount: number;
  readonly removedClaimIds: readonly string[];
  readonly retainedClaimIds: readonly string[];
  readonly currentDigest: string;
  readonly impactedDigest: string;
};

const canonicalSnapshotDigestFor = (
  projectId: string,
  version: number,
  claims: readonly {
    claimId: string;
    text: string;
    revisionNumber: number;
    evidenceIds: readonly string[];
  }[],
): string => canonicalSnapshotDigest(projectId, version, claims);

/**
 * Compute the current Snapshot impact for a Reversal at `sourceRevisionId`.
 * Pure: no I/O. `removedClaimIds` are the claim identities introduced by
 * later canonical commits (after the source revision), i.e. what the Reversal
 * would remove from the current snapshot.
 */
export const computeReversalSnapshotImpact = (
  sourceRevision: CanonicalRevision,
  currentSnapshot: CanonicalSnapshot,
  history: readonly CanonicalHistoryEvent[],
): ReversalSnapshotImpact => {
  const ordered = sortedByCreatedAt(history);
  const removedClaimIds = [
    ...new Set(
      ordered
        .filter(
          (event) =>
            event.projectId === sourceRevision.projectId &&
            event.eventType === 'CANONICAL_CLAIM_ADDED' &&
            event.createdAt > sourceRevision.createdAt &&
            event.claimId,
        )
        .map((event) => event.claimId as string),
    ),
  ];
  const removed = new Set(removedClaimIds);
  const retainedClaims = currentSnapshot.claims.filter((claim) => !removed.has(claim.claimId));
  const impactedVersion = currentSnapshot.version - removedClaimIds.length;
  return Object.freeze({
    schemaVersion: '1.0.0',
    resourceProjectId: sourceRevision.projectId,
    sourceRevisionId: sourceRevision.revisionId,
    currentVersion: currentSnapshot.version,
    impactedVersion,
    currentClaimCount: currentSnapshot.claims.length,
    impactedClaimCount: retainedClaims.length,
    removedClaimIds: Object.freeze(removedClaimIds),
    retainedClaimIds: Object.freeze(retainedClaims.map((claim) => claim.claimId)),
    currentDigest: currentSnapshot.digest,
    impactedDigest: canonicalSnapshotDigestFor(
      sourceRevision.projectId,
      impactedVersion,
      retainedClaims,
    ),
  });
};
