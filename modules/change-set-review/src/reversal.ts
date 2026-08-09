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
 * Authority boundaries (Frozen ADR-131 / IR r1):
 * - Reversal authorization is a CURRENT server-derived capability
 *   (`project:action:rollback`). The browser request NEVER carries a
 *   capability; the server derives it via an injected resolver.
 * - Historical approval is evidence/reference only; its EXISTENCE is allowed
 *   and preserved on the Reversal candidate. Only an attempt to USE a
 *   historical approval as the current authority is rejected.
 * - A Reversal reverses the EFFECT of the selected Historical Revision (an
 *   ADD_CLAIM revision removes that claim), including the current tip — it is
 *   a new change, never a direct restore of an old snapshot.
 * - Later-event detection uses the authoritative history position
 *   (createdAt, historyEventId tie-break), not timestamp-only comparison.
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

/**
 * Server-derived eligibility input. `currentCapabilities` is the CURRENT
 * server-derived capability set (from the injected resolver), never a value
 * the browser supplies. `reuseHistoricalApprovalAttempt` is the caller's
 * attempt to use a historical approval as authority (default false).
 */
export type ReversalEligibilityInput = {
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly currentCapabilities: readonly string[];
  readonly reuseHistoricalApprovalAttempt?: boolean;
};

/**
 * Server command input for a Reversal DraftChangeSet.
 *
 * The Frozen browser contract is `CreateReversalDraftChangeSetRequestV1`:
 * `schemaVersion`, `resourceProjectId`, `sourceRevisionId`, `reason` ONLY —
 * no capability, no principal, no timestamp from the client.
 *
 * `createdBy` and `createdAt` are SERVER-DERIVED command context (the current
 * principal and wall-clock from the server-side command handler), never
 * browser-supplied authority. The port uses `createdBy` as the `principalId`
 * when resolving the current server-derived capability set.
 */
export type CreateReversalDraftChangeSetInput = {
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly reason: string;
  /** Server-derived command context: the current principal id. */
  readonly createdBy: string;
  /** Server-derived command context: the current wall-clock. */
  readonly createdAt: string;
};

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

/** Authoritative canonical history ordering: createdAt, then historyEventId. */
export const sortHistoryEvents = (
  events: readonly CanonicalHistoryEvent[],
): readonly CanonicalHistoryEvent[] =>
  [...events].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.historyEventId.localeCompare(right.historyEventId),
  );

/**
 * Locate the source revision's position in the authoritative history via its
 * commitId, then return the events strictly AFTER it (stable tie-break).
 * Timestamp-only comparison is NOT used: the source event is found by
 * identity, so same-timestamp later events are still detected.
 *
 * Returns `undefined` when the source revision EXISTS but its matching
 * authoritative HistoryEvent is missing (lost/truncated lineage): callers
 * must treat that as fail-closed, never as "current tip".
 */
export const laterHistoryEvents = (
  sourceRevision: CanonicalRevision,
  history: readonly CanonicalHistoryEvent[],
): readonly CanonicalHistoryEvent[] | undefined => {
  const ordered = sortHistoryEvents(history);
  const index = ordered.findIndex(
    (event) =>
      event.projectId === sourceRevision.projectId && event.commitId === sourceRevision.commitId,
  );
  if (index < 0) return undefined;
  return ordered.slice(index + 1);
};

/**
 * Deterministic eligibility assessment over the authoritative canonical
 * history. Pure: no I/O. Later events are detected by history position
 * (commitId → stable ordered rows after it), so same-timestamp events are
 * correctly ordered by historyEventId tie-break.
 *
 * Rules:
 *   - source revision must exist
 *   - current capability set must include `project:action:rollback`
 *   - historical approval AUTHORITY REUSE attempt → typed reject
 *     (the existence of a historical approval is evidence-only and allowed)
 *   - later CANONICAL_CLAIM_ADDED event(s) → superseded + dependent conflict
 *   - later events but none is a claim commit (NO_OP only) → stale target
 *   - no later event at all → the source is the current tip → eligible
 */
export const assessReversalEligibilityFromHistory = (
  input: ReversalEligibilityInput,
  sourceRevision: CanonicalRevision | undefined,
  history: readonly CanonicalHistoryEvent[],
): ReversalEligibilityV1 => {
  if (!sourceRevision) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_SOURCE_NOT_FOUND']);
  }
  if (!input.currentCapabilities.includes(REVERSAL_CURRENT_CAPABILITY)) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_MISSING_CURRENT_CAPABILITY']);
  }
  // Historical approval AUTHORITY reuse is FORBIDDEN. The mere existence of a
  // historical approval reference is evidence-only and does NOT block.
  if (input.reuseHistoricalApprovalAttempt) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_HISTORICAL_APPROVAL_REUSE']);
  }
  const later = laterHistoryEvents(sourceRevision, history);
  // Fail-closed: the source revision exists but its authoritative HistoryEvent
  // is missing (lost/truncated lineage). We CANNOT verify it is the current
  // tip, so we must NOT treat it as eligible. Reuse REVERSAL_SOURCE_NOT_FOUND.
  if (later === undefined) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_SOURCE_NOT_FOUND']);
  }
  const laterCommits = later.filter((event) => event.eventType === 'CANONICAL_CLAIM_ADDED');
  if (laterCommits.length > 0) {
    return failureReasons(input.sourceRevisionId, [
      'REVERSAL_SUPERSEDED_TARGET',
      'REVERSAL_DEPENDENT_REVISION_CONFLICT',
    ]);
  }
  if (later.length > 0) {
    return failureReasons(input.sourceRevisionId, ['REVERSAL_STALE_TARGET']);
  }
  return success(input.sourceRevisionId);
};

/**
 * Injected server-side capability resolver. It is called with the current
 * server-derived command context (resource project + principal id) so a
 * singleton port can compute the CURRENT capability set for the right
 * project/principal. `principalId` is server-derived, never browser-supplied.
 */
export type CurrentCapabilitiesResolver = (context: {
  readonly resourceProjectId: string;
  readonly principalId: string; // server-derived
}) => Promise<readonly string[]>;

/**
 * Canonical reader: authoritative source revision + history loading.
 */
export type ReversalCanonicalReader = {
  findRevision(projectId: string, revisionId: string): Promise<CanonicalRevision | undefined>;
  listHistory(projectId: string): Promise<readonly CanonicalHistoryEvent[]>;
};

export const createReversalEligibilityPort = (
  canonical: ReversalCanonicalReader,
  options?: {
    /** Server-derived current capabilities (REQUIRED for create). */
    readonly currentCapabilitiesResolver?: CurrentCapabilitiesResolver;
    /** Historical approval evidence reference (allowed, evidence-only). */
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
      return assessReversalEligibilityFromHistory(input, revision, history);
    },
    async createReversalDraftChangeSet(input) {
      const currentCapabilitiesResolver = options?.currentCapabilitiesResolver;
      if (!currentCapabilitiesResolver) {
        return typedError(
          'REVERSAL_MISSING_CURRENT_CAPABILITY',
          'No server-derived capability resolver is configured; Reversal creation is not authorized.',
          input.createdAt,
        );
      }
      // The capability is derived SERVER-SIDE for the current command context
      // (resource project + principal id). The browser request never carries
      // any capability or principal; `input.createdBy` is server-derived.
      const currentCapabilities = await currentCapabilitiesResolver({
        resourceProjectId: input.resourceProjectId,
        principalId: input.createdBy,
      });
      const eligibility = await this.assessReversalEligibility({
        resourceProjectId: input.resourceProjectId,
        sourceRevisionId: input.sourceRevisionId,
        currentCapabilities,
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
      // Historical approval (if any) is preserved as EVIDENCE ONLY on the
      // Reversal DraftChangeSet; it never authorizes the Reversal. Current
      // Review + current Approval are still required before Canonical Commit.
      const historicalApprovalRef =
        options?.historicalApprovalResolver && revision
          ? await options.historicalApprovalResolver(revision)
          : undefined;
      const reversal: ReversalDraftChangeSetV1 = Object.freeze({
        schemaVersion: '1.0.0',
        reversalId: `reversal:${randomUUID()}`,
        resourceProjectId: input.resourceProjectId,
        sourceRevisionId: input.sourceRevisionId,
        sourceCommitId: revision?.commitId ?? input.sourceRevisionId,
        historicalApprovalRef,
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
 * A Reversal reverses the EFFECT of the selected Historical Revision: an
 * ADD_CLAIM revision removes the claim it added (so reversing the current tip
 * has a real, non-zero impact), and any later ADD_CLAIM events are also
 * removed. The impact is a projection of the current snapshot after the
 * Reversal — identity is preserved on the source side (no authoritative row
 * is deleted). impactedVersion is the source revision's beforeVersion (the
 * version the reversal returns to), minus the number of later claims removed.
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
 * Pure: no I/O.
 *
 * removedClaimIds = the source revision's OWN added claim (if ADD_CLAIM) plus
 * every claim added by a later CANONICAL_CLAIM_ADDED event. This makes a
 * current-tip Reversal non-zero: `revision:2 (ADD_CLAIM claim-b)` →
 * `removedClaimIds=['claim-b']`, `impactedVersion = revision:2.beforeVersion`.
 */
export const computeReversalSnapshotImpact = (
  sourceRevision: CanonicalRevision,
  currentSnapshot: CanonicalSnapshot,
  history: readonly CanonicalHistoryEvent[],
): ReversalSnapshotImpact => {
  const removedSet = new Set<string>();
  if (sourceRevision.operation === 'ADD_CLAIM' && sourceRevision.claimId) {
    removedSet.add(sourceRevision.claimId);
  }
  // `laterHistoryEvents` is undefined only if the source history event is
  // missing — but impact is computed for an ELIGIBLE reversal, so lineage is
  // verified; treat as no later events defensively.
  const later = laterHistoryEvents(sourceRevision, history) ?? [];
  for (const event of later) {
    if (event.eventType === 'CANONICAL_CLAIM_ADDED' && event.claimId) {
      removedSet.add(event.claimId);
    }
  }
  const removedClaimIds = [...removedSet];
  const removed = new Set(removedClaimIds);
  const retainedClaims = currentSnapshot.claims.filter((claim) => !removed.has(claim.claimId));
  // The Reversal returns the snapshot to the version right BEFORE the source
  // revision's own effect (its beforeVersion), undoing its own ADD_CLAIM plus
  // every later claim commit. e.g. reversing the current tip revision:2
  // (beforeVersion=1, ADD_CLAIM claim-b) -> impactedVersion = 1.
  const impactedVersion = sourceRevision.beforeVersion;
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
