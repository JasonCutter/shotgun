import { describe, expect, it } from 'vitest';

import {
  REVERSAL_CURRENT_CAPABILITY,
  assessReversalEligibilityFromHistory,
  computeReversalSnapshotImpact,
  createReversalEligibilityPort,
  failureReasons,
  laterHistoryEvents,
  type ReversalCanonicalReader,
} from '../../modules/change-set-review/src/index.js';
import {
  canonicalSnapshotDigest,
  type CanonicalHistoryEvent,
  type CanonicalRevision,
  type CanonicalSnapshot,
} from '../../packages/contracts/src/index.js';

const revision = (
  overrides: Partial<CanonicalRevision> & { revisionId: string },
): CanonicalRevision => ({
  projectId: 'p1',
  commitId: `commit-${overrides.revisionId}`,
  manifestId: `manifest-${overrides.revisionId}`,
  operation: 'ADD_CLAIM',
  beforeVersion: 0,
  afterVersion: 1,
  claimId: overrides.claimId ?? `claim-${overrides.revisionId}`,
  reason: 'original',
  actor: { type: 'user', id: 'actor-1' },
  createdAt: '2026-08-09T00:00:00.000Z',
  ...overrides,
});

const event = (
  overrides: Partial<CanonicalHistoryEvent> & { historyEventId: string; createdAt: string },
): CanonicalHistoryEvent => ({
  projectId: 'p1',
  commitId: `commit-${overrides.historyEventId}`,
  manifestId: `manifest-${overrides.historyEventId}`,
  changeSetId: `change-set-${overrides.historyEventId}`,
  eventType: 'CANONICAL_CLAIM_ADDED',
  beforeVersion: 0,
  afterVersion: 1,
  claimId: `claim-${overrides.historyEventId}`,
  reason: 'later',
  actor: { type: 'user', id: 'actor-2' },
  ...overrides,
});

const eligibilityInput = (
  sourceRevisionId: string,
  capabilities: readonly string[] = [REVERSAL_CURRENT_CAPABILITY],
  reuseHistoricalApprovalAttempt = false,
) => ({
  resourceProjectId: 'p1',
  sourceRevisionId,
  currentCapabilities: capabilities,
  reuseHistoricalApprovalAttempt,
});

describe('change-set-review WP3 Reversal DraftChangeSet', () => {
  describe('deterministic eligibility gate (pure)', () => {
    it('source revision not found -> typed reject', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:missing'),
        undefined,
        [],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_SOURCE_NOT_FOUND']);
    });

    it('missing current capability -> typed reject', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1', []),
        revision({ revisionId: 'revision:1' }),
        [],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_MISSING_CURRENT_CAPABILITY']);
    });

    it('historical approval reuse ATTEMPT -> typed reject', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1', [REVERSAL_CURRENT_CAPABILITY], true),
        revision({ revisionId: 'revision:1' }),
        [],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_HISTORICAL_APPROVAL_REUSE']);
    });

    it('historical approval existence alone does NOT block (evidence-only)', () => {
      // A historical approval ref exists, but no reuse attempt: eligible.
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T01:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-1',
            createdAt: '2026-08-09T01:00:00.000Z',
            commitId: 'commit-revision:1',
          }),
        ],
      );
      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('current tip with no later canonical event -> eligible', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T01:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-1',
            createdAt: '2026-08-09T01:00:00.000Z',
            commitId: 'commit-revision:1',
          }),
        ],
      );
      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('later canonical claim -> superseded + dependent revision conflict typed reject', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-1',
            createdAt: '2026-08-09T00:00:00.000Z',
            commitId: 'commit-revision:1',
            claimId: 'claim-a',
          }),
          event({
            historyEventId: 'e-2',
            createdAt: '2026-08-09T02:00:00.000Z',
            claimId: 'claim-b',
          }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual([
        'REVERSAL_SUPERSEDED_TARGET',
        'REVERSAL_DEPENDENT_REVISION_CONFLICT',
      ]);
    });

    it('same-timestamp later event is detected via authoritative history position (tie-break)', () => {
      // Both events share createdAt; the authoritative ORDER (createdAt,
      // historyEventId) places e-1 before e-2. The source revision is e-1, so
      // e-2 is a LATER canonical claim -> superseded. Timestamp-only
      // comparison would have missed this.
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-1',
            createdAt: '2026-08-09T00:00:00.000Z',
            commitId: 'commit-revision:1',
            claimId: 'claim-a',
          }),
          event({
            historyEventId: 'e-2',
            createdAt: '2026-08-09T00:00:00.000Z',
            claimId: 'claim-b',
          }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual([
        'REVERSAL_SUPERSEDED_TARGET',
        'REVERSAL_DEPENDENT_REVISION_CONFLICT',
      ]);
    });

    it('same-timestamp NO_OP later event -> stale target (tie-break, no dependent commit)', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-1',
            createdAt: '2026-08-09T00:00:00.000Z',
            commitId: 'commit-revision:1',
            claimId: 'claim-a',
          }),
          event({
            historyEventId: 'e-2',
            createdAt: '2026-08-09T00:00:00.000Z',
            eventType: 'CHANGESET_NO_OP',
            claimId: undefined,
          }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_STALE_TARGET']);
    });

    it('later NO_OP event only -> stale target typed reject (no dependent commit)', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-1',
            createdAt: '2026-08-09T00:00:00.000Z',
            commitId: 'commit-revision:1',
            claimId: 'claim-a',
          }),
          event({
            historyEventId: 'e-2',
            createdAt: '2026-08-09T02:00:00.000Z',
            eventType: 'CHANGESET_NO_OP',
            claimId: undefined,
          }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_STALE_TARGET']);
    });

    it('laterHistoryEvents finds later rows by commitId position (not timestamp)', () => {
      const source = revision({
        revisionId: 'revision:1',
        createdAt: '2026-08-09T00:00:00.000Z',
      });
      const history = [
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T00:00:00.000Z',
          commitId: 'commit-revision:1',
        }),
        event({ historyEventId: 'e-2', createdAt: '2026-08-09T00:00:00.000Z' }),
        event({ historyEventId: 'e-3', createdAt: '2026-08-09T00:00:00.000Z' }),
      ];
      const later = laterHistoryEvents(source, history);
      expect(later).toBeDefined();
      expect(later!.map((e) => e.historyEventId)).toEqual(['e-2', 'e-3']);
    });

    it('fail-closed when the source revision exists but its history event is MISSING (lost lineage)', () => {
      // GPT Round 2 fix D: a revision whose authoritative HistoryEvent cannot
      // be located must NOT be treated as the current tip. Missing lineage is
      // a typed reject, reusing REVERSAL_SOURCE_NOT_FOUND.
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({
            historyEventId: 'e-other',
            createdAt: '2026-08-09T00:00:00.000Z',
            commitId: 'commit-other',
          }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_SOURCE_NOT_FOUND']);
      // laterHistoryEvents also reports the missing lineage as undefined.
      expect(
        laterHistoryEvents(
          revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
          [
            event({
              historyEventId: 'e-other',
              createdAt: '2026-08-09T00:00:00.000Z',
              commitId: 'commit-other',
            }),
          ],
        ),
      ).toBeUndefined();
    });
  });

  describe('createReversalEligibilityPort (canonical-backed, server-derived capability)', () => {
    const makeReader = (): ReversalCanonicalReader & {
      revisions: CanonicalRevision[];
      history: CanonicalHistoryEvent[];
    } => {
      const revisions: CanonicalRevision[] = [];
      const history: CanonicalHistoryEvent[] = [];
      return {
        revisions,
        history,
        async findRevision(_projectId, revisionId) {
          return revisions.find((r) => r.revisionId === revisionId);
        },
        async listHistory(projectId) {
          return history.filter((h) => h.projectId === projectId);
        },
      };
    };

    it('creates a CANDIDATE Reversal DraftChangeSet for an eligible tip revision (server-derived capability)', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T01:00:00.000Z',
          commitId: 'commit-revision:tip',
          claimId: 'claim-a',
        }),
      );
      const port = createReversalEligibilityPort(reader, {
        currentCapabilitiesResolver: async () => [REVERSAL_CURRENT_CAPABILITY],
      });

      const { reversal, eligibility } = await port.createReversalDraftChangeSet({
        resourceProjectId: 'p1',
        sourceRevisionId: 'revision:tip',
        reason: 'rollback the latest claim',
        createdBy: 'actor-1',
        createdAt: '2026-08-09T03:00:00.000Z',
      });
      expect(eligibility.eligible).toBe(true);
      expect(reversal.status).toBe('CANDIDATE');
      expect(reversal.sourceRevisionId).toBe('revision:tip');
      expect(reversal.sourceCommitId).toBe('commit-revision:tip');
      expect(reversal.resourceProjectId).toBe('p1');
      expect(reversal.createdBy).toBe('actor-1');
    });

    it('throws typed error when eligibility fails (superseded target)', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:old', createdAt: '2026-08-09T00:00:00.000Z' }),
      );
      reader.history.push(
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T00:00:00.000Z',
          commitId: 'commit-revision:old',
          claimId: 'claim-a',
        }),
        event({
          historyEventId: 'e-2',
          createdAt: '2026-08-09T02:00:00.000Z',
          claimId: 'claim-b',
        }),
      );
      const port = createReversalEligibilityPort(reader, {
        currentCapabilitiesResolver: async () => [REVERSAL_CURRENT_CAPABILITY],
      });
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: 'p1',
          sourceRevisionId: 'revision:old',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_SUPERSEDED_TARGET' });
    });

    it('resolves the current capability per project/principal context (project A allowed, project B rejected)', async () => {
      // GPT Round 2 fix A: the resolver receives the server-derived command
      // context so a singleton port computes the CURRENT capability set for
      // the right project/principal. Same service: project A + current actor
      // has rollback -> allowed; project B + same actor has no rollback ->
      // REVERSAL_MISSING_CURRENT_CAPABILITY.
      const reader = makeReader();
      reader.revisions.push(
        revision({
          revisionId: 'revision:pA',
          projectId: 'pA',
          createdAt: '2026-08-09T01:00:00.000Z',
        }),
        revision({
          revisionId: 'revision:pB',
          projectId: 'pB',
          createdAt: '2026-08-09T01:00:00.000Z',
        }),
      );
      reader.history.push(
        event({
          historyEventId: 'e-a1',
          projectId: 'pA',
          createdAt: '2026-08-09T01:00:00.000Z',
          commitId: 'commit-revision:pA',
          claimId: 'claim-a',
        }),
        event({
          historyEventId: 'e-b1',
          projectId: 'pB',
          createdAt: '2026-08-09T01:00:00.000Z',
          commitId: 'commit-revision:pB',
          claimId: 'claim-b',
        }),
      );
      const seenContexts: Array<{ resourceProjectId: string; principalId: string }> = [];
      const port = createReversalEligibilityPort(reader, {
        currentCapabilitiesResolver: async (context) => {
          seenContexts.push({ ...context });
          // project A grants rollback; project B does not.
          return context.resourceProjectId === 'pA' ? [REVERSAL_CURRENT_CAPABILITY] : [];
        },
      });
      const { reversal } = await port.createReversalDraftChangeSet({
        resourceProjectId: 'pA',
        sourceRevisionId: 'revision:pA',
        reason: 'rollback',
        createdBy: 'actor-1',
        createdAt: '2026-08-09T03:00:00.000Z',
      });
      expect(reversal.status).toBe('CANDIDATE');
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: 'pB',
          sourceRevisionId: 'revision:pB',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_MISSING_CURRENT_CAPABILITY' });
      // The resolver saw the server-derived context for each create call.
      expect(seenContexts).toEqual([
        { resourceProjectId: 'pA', principalId: 'actor-1' },
        { resourceProjectId: 'pB', principalId: 'actor-1' },
      ]);
    });

    it('rejects create when the server-derived capability set lacks rollback (browser cannot pass capability)', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T01:00:00.000Z',
          commitId: 'commit-revision:tip',
          claimId: 'claim-a',
        }),
      );
      // Server derives the CURRENT capabilities: the current set does not
      // include project:action:rollback -> create is rejected, even though the
      // request body carries no capability at all.
      const port = createReversalEligibilityPort(reader, {
        currentCapabilitiesResolver: async () => ['project:read'],
      });
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: 'p1',
          sourceRevisionId: 'revision:tip',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_MISSING_CURRENT_CAPABILITY' });
    });

    it('rejects create when no capability resolver is injected (fail-closed)', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T01:00:00.000Z',
          commitId: 'commit-revision:tip',
          claimId: 'claim-a',
        }),
      );
      const port = createReversalEligibilityPort(reader);
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: 'p1',
          sourceRevisionId: 'revision:tip',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_MISSING_CURRENT_CAPABILITY' });
    });

    it('preserves historical approval as EVIDENCE ONLY on the reversal', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T01:00:00.000Z',
          commitId: 'commit-revision:tip',
          claimId: 'claim-a',
        }),
      );
      const port = createReversalEligibilityPort(reader, {
        currentCapabilitiesResolver: async () => [REVERSAL_CURRENT_CAPABILITY],
        historicalApprovalResolver: async () => 'approval:historical',
      });
      const { reversal, eligibility } = await port.createReversalDraftChangeSet({
        resourceProjectId: 'p1',
        sourceRevisionId: 'revision:tip',
        reason: 'rollback',
        createdBy: 'actor-1',
        createdAt: '2026-08-09T03:00:00.000Z',
      });
      // Evidence-only: the historical approval is referenced, not reused as
      // authority. Eligibility is still eligible (reuse is NOT attempted).
      expect(eligibility.eligible).toBe(true);
      expect(reversal.historicalApprovalRef).toBe('approval:historical');
      expect(reversal.status).toBe('CANDIDATE');
    });

    it('failureReasons helper produces the frozen eligibility shape', () => {
      const result = failureReasons('revision:1', ['REVERSAL_SOURCE_NOT_FOUND']);
      expect(result).toEqual({
        schemaVersion: '1.0.0',
        sourceRevisionId: 'revision:1',
        eligible: false,
        reasons: ['REVERSAL_SOURCE_NOT_FOUND'],
      });
    });
  });

  describe('computeReversalSnapshotImpact', () => {
    const currentSnapshot = (claims: { claimId: string; text: string }[]): CanonicalSnapshot => {
      const snapshotClaims = claims.map((claim, index) => ({
        claimId: claim.claimId,
        text: claim.text,
        revisionNumber: index + 1,
        evidenceIds: [],
      }));
      return {
        snapshotId: 'canonical:p1:2',
        projectId: 'p1',
        version: 2,
        digest: canonicalSnapshotDigest('p1', 2, snapshotClaims),
        claims: snapshotClaims,
        createdAt: '2026-08-09T03:00:00.000Z',
      };
    };

    it('removes the source own ADD_CLAIM claim plus later claims', () => {
      // GPT fix C: the source revision's OWN ADD_CLAIM effect is reversed, so
      // reversing revision:1 (which added claim-a) removes claim-a as well as
      // the later claim-b, returning to revision:1.beforeVersion (0).
      const source = revision({
        revisionId: 'revision:1',
        createdAt: '2026-08-09T00:00:00.000Z',
        beforeVersion: 0,
        afterVersion: 1,
        claimId: 'claim-a',
      });
      const snapshot = currentSnapshot([
        { claimId: 'claim-a', text: 'first' },
        { claimId: 'claim-b', text: 'second' },
      ]);
      const history = [
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T00:00:00.000Z',
          commitId: 'commit-revision:1',
          claimId: 'claim-a',
        }),
        event({
          historyEventId: 'e-2',
          createdAt: '2026-08-09T02:00:00.000Z',
          claimId: 'claim-b',
        }),
      ];
      const impact = computeReversalSnapshotImpact(source, snapshot, history);
      expect(impact.currentVersion).toBe(2);
      expect(impact.impactedVersion).toBe(0);
      expect(impact.removedClaimIds).toEqual(['claim-a', 'claim-b']);
      expect(impact.retainedClaimIds).toEqual([]);
      expect(impact.currentClaimCount).toBe(2);
      expect(impact.impactedClaimCount).toBe(0);
      expect(impact.currentDigest).toBe(snapshot.digest);
      expect(impact.impactedDigest).toBe(canonicalSnapshotDigest('p1', 0, []));
    });

    it('reverses the source revision own ADD_CLAIM effect (current-tip reversal is non-zero)', () => {
      // GPT fix C: "revision:2 current tip -> removedClaimIds=['claim-b'] ->
      // impactedVersion = revision:2.beforeVersion (1)". The source revision's
      // OWN ADD_CLAIM effect is reversed, so a current-tip reversal has real
      // impact.
      const source = revision({
        revisionId: 'revision:2',
        createdAt: '2026-08-09T02:00:00.000Z',
        beforeVersion: 1,
        afterVersion: 2,
        claimId: 'claim-b',
      });
      const snapshot = currentSnapshot([
        { claimId: 'claim-a', text: 'first' },
        { claimId: 'claim-b', text: 'second' },
      ]);
      const history = [
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T00:00:00.000Z',
          claimId: 'claim-a',
        }),
        event({
          historyEventId: 'e-2',
          createdAt: '2026-08-09T02:00:00.000Z',
          commitId: 'commit-revision:2',
          claimId: 'claim-b',
        }),
      ];
      const impact = computeReversalSnapshotImpact(source, snapshot, history);
      expect(impact.removedClaimIds).toEqual(['claim-b']);
      expect(impact.retainedClaimIds).toEqual(['claim-a']);
      expect(impact.impactedVersion).toBe(1);
      expect(impact.impactedClaimCount).toBe(1);
    });

    it('removes later claims AND the source own claim when both exist', () => {
      const source = revision({
        revisionId: 'revision:1',
        createdAt: '2026-08-09T00:00:00.000Z',
        claimId: 'claim-a',
      });
      const snapshot = currentSnapshot([
        { claimId: 'claim-a', text: 'first' },
        { claimId: 'claim-b', text: 'second' },
        { claimId: 'claim-c', text: 'third' },
      ]);
      const history = [
        event({
          historyEventId: 'e-1',
          createdAt: '2026-08-09T00:00:00.000Z',
          commitId: 'commit-revision:1',
          claimId: 'claim-a',
        }),
        event({
          historyEventId: 'e-2',
          createdAt: '2026-08-09T01:00:00.000Z',
          claimId: 'claim-b',
        }),
        event({
          historyEventId: 'e-3',
          createdAt: '2026-08-09T02:00:00.000Z',
          claimId: 'claim-c',
        }),
      ];
      const impact = computeReversalSnapshotImpact(source, snapshot, history);
      expect(impact.removedClaimIds).toEqual(['claim-a', 'claim-b', 'claim-c']);
      expect(impact.retainedClaimIds).toEqual([]);
      expect(impact.impactedVersion).toBe(0);
      expect(impact.impactedClaimCount).toBe(0);
    });
  });
});
