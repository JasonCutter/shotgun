import { describe, expect, it } from 'vitest';

import {
  REVERSAL_CURRENT_CAPABILITY,
  assessReversalEligibilityFromHistory,
  computeReversalSnapshotImpact,
  createReversalEligibilityPort,
  failureReasons,
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
  reason: 'later',
  actor: { type: 'user', id: 'actor-2' },
  ...overrides,
});

const eligibilityInput = (
  sourceRevisionId: string,
  capabilities: readonly string[] = [REVERSAL_CURRENT_CAPABILITY],
) => ({
  resourceProjectId: 'p1',
  sourceRevisionId,
  currentCapabilities: capabilities,
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
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1' }),
        [],
        true,
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_HISTORICAL_APPROVAL_REUSE']);
    });

    it('historical approval existence alone does NOT block (evidence-only)', () => {
      // A historical approval ref exists, but no reuse attempt: eligible.
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T01:00:00.000Z' }),
        [event({ historyEventId: 'e-1', createdAt: '2026-08-09T01:00:00.000Z' })],
        false,
      );
      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('current tip with no later canonical event -> eligible', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T01:00:00.000Z' }),
        [event({ historyEventId: 'e-1', createdAt: '2026-08-09T01:00:00.000Z' })],
      );
      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('later canonical claim -> superseded + dependent revision conflict typed reject', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
          event({ historyEventId: 'e-2', createdAt: '2026-08-09T02:00:00.000Z' }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual([
        'REVERSAL_SUPERSEDED_TARGET',
        'REVERSAL_DEPENDENT_REVISION_CONFLICT',
      ]);
    });

    it('later NO_OP event only -> stale target typed reject (no dependent commit)', () => {
      const result = assessReversalEligibilityFromHistory(
        eligibilityInput('revision:1'),
        revision({ revisionId: 'revision:1', createdAt: '2026-08-09T00:00:00.000Z' }),
        [
          event({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
          event({
            historyEventId: 'e-2',
            createdAt: '2026-08-09T02:00:00.000Z',
            eventType: 'CHANGESET_NO_OP',
          }),
        ],
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(['REVERSAL_STALE_TARGET']);
    });
  });

  describe('createReversalEligibilityPort (canonical-backed)', () => {
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
        async listHistory() {
          return [...history];
        },
      };
    };

    it('creates a CANDIDATE Reversal DraftChangeSet for an eligible tip revision', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(event({ historyEventId: 'e-1', createdAt: '2026-08-09T01:00:00.000Z' }));
      const port = createReversalEligibilityPort(reader);

      const { reversal, eligibility } = await port.createReversalDraftChangeSet({
        resourceProjectId: 'p1',
        sourceRevisionId: 'revision:tip',
        reason: 'rollback the latest claim',
        createdBy: 'actor-1',
        createdAt: '2026-08-09T03:00:00.000Z',
        currentCapabilities: [REVERSAL_CURRENT_CAPABILITY],
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
        event({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
        event({ historyEventId: 'e-2', createdAt: '2026-08-09T02:00:00.000Z' }),
      );
      const port = createReversalEligibilityPort(reader);
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: 'p1',
          sourceRevisionId: 'revision:old',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
          currentCapabilities: [REVERSAL_CURRENT_CAPABILITY],
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_SUPERSEDED_TARGET' });
    });

    it('preserves historical approval as EVIDENCE ONLY on the reversal', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(event({ historyEventId: 'e-1', createdAt: '2026-08-09T01:00:00.000Z' }));
      const port = createReversalEligibilityPort(reader, {
        historicalApprovalResolver: async () => 'approval:historical',
      });
      const { reversal, eligibility } = await port.createReversalDraftChangeSet({
        resourceProjectId: 'p1',
        sourceRevisionId: 'revision:tip',
        reason: 'rollback',
        createdBy: 'actor-1',
        createdAt: '2026-08-09T03:00:00.000Z',
        currentCapabilities: [REVERSAL_CURRENT_CAPABILITY],
      });
      // Evidence-only: the historical approval is referenced, not reused as
      // authority. Eligibility is still eligible (reuse is NOT attempted).
      expect(eligibility.eligible).toBe(true);
      expect(reversal.historicalApprovalRef).toBe('approval:historical');
      expect(reversal.status).toBe('CANDIDATE');
    });

    it('rejects a caller that passes an empty current capability set (no injection)', async () => {
      const reader = makeReader();
      reader.revisions.push(
        revision({ revisionId: 'revision:tip', createdAt: '2026-08-09T01:00:00.000Z' }),
      );
      reader.history.push(event({ historyEventId: 'e-1', createdAt: '2026-08-09T01:00:00.000Z' }));
      const port = createReversalEligibilityPort(reader);
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: 'p1',
          sourceRevisionId: 'revision:tip',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
          currentCapabilities: [],
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_MISSING_CURRENT_CAPABILITY' });
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

    it('removes only claims added after the source revision', () => {
      const source = revision({
        revisionId: 'revision:1',
        createdAt: '2026-08-09T00:00:00.000Z',
      });
      const snapshot = currentSnapshot([
        { claimId: 'claim-a', text: 'first' },
        { claimId: 'claim-b', text: 'second' },
      ]);
      const history = [
        event({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z', claimId: 'claim-a' }),
        event({
          historyEventId: 'e-2',
          createdAt: '2026-08-09T02:00:00.000Z',
          claimId: 'claim-b',
        }),
      ];
      const impact = computeReversalSnapshotImpact(source, snapshot, history);
      expect(impact.currentVersion).toBe(2);
      expect(impact.impactedVersion).toBe(1);
      expect(impact.removedClaimIds).toEqual(['claim-b']);
      expect(impact.retainedClaimIds).toEqual(['claim-a']);
      expect(impact.currentClaimCount).toBe(2);
      expect(impact.impactedClaimCount).toBe(1);
      expect(impact.currentDigest).toBe(snapshot.digest);
      expect(impact.impactedDigest).toBe(
        canonicalSnapshotDigest(
          'p1',
          1,
          snapshot.claims.filter((c) => c.claimId === 'claim-a'),
        ),
      );
    });

    it('removes nothing when the source revision is the current tip', () => {
      const source = revision({
        revisionId: 'revision:2',
        createdAt: '2026-08-09T02:00:00.000Z',
      });
      const snapshot = currentSnapshot([
        { claimId: 'claim-a', text: 'first' },
        { claimId: 'claim-b', text: 'second' },
      ]);
      const history = [
        event({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z', claimId: 'claim-a' }),
        event({
          historyEventId: 'e-2',
          createdAt: '2026-08-09T02:00:00.000Z',
          claimId: 'claim-b',
        }),
      ];
      const impact = computeReversalSnapshotImpact(source, snapshot, history);
      expect(impact.removedClaimIds).toEqual([]);
      expect(impact.impactedVersion).toBe(2);
      expect(impact.impactedClaimCount).toBe(2);
    });
  });
});
