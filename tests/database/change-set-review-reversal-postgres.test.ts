import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  REVERSAL_CURRENT_CAPABILITY,
  computeReversalSnapshotImpact,
  createReversalEligibilityPort,
  type ReversalCanonicalReader,
} from '../../modules/change-set-review/src/index.js';
import {
  canonicalSnapshotDigest,
  type CanonicalClaim,
  type CanonicalHistoryEvent,
  type CanonicalRevision,
  type CanonicalSnapshotClaim,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const makeCanonical = () => {
  const canonical: ReversalCanonicalReader = {
    findRevision: (projectId, revisionId) => {
      const repo = new PostgresCanonicalKnowledgeRepository(pool!);
      return repo.findRevision(projectId, revisionId);
    },
    listHistory: (projectId) => {
      const repo = new PostgresCanonicalKnowledgeRepository(pool!);
      return repo.listHistory(projectId);
    },
  };
  return canonical;
};

const addCommit = async (opts: {
  projectId: string;
  revisionId: string;
  eventId: string;
  createdAt: string;
  claimId?: string;
  beforeVersion: number;
  afterVersion: number;
}) => {
  const { projectId, revisionId, eventId, createdAt, claimId: rawClaimId } = opts;
  const commitId = randomUUID();
  const changeSetId = randomUUID();
  const manifestId = randomUUID();
  // claim_id is a GLOBAL primary key in canonical.claims, so scope it per
  // project to keep parallel/serial DB tests isolated.
  const claimId = rawClaimId === undefined ? undefined : `${projectId}:${rawClaimId}`;
  const claim =
    claimId === undefined
      ? undefined
      : {
          claimId,
          projectId,
          revisionNumber: opts.afterVersion as number,
          claimText: `claim ${claimId}`,
          sourceVersionId: randomUUID(),
          evidenceIds: [] as readonly string[],
          createdFromManifestId: manifestId,
          accessScope: ['owner'] as readonly string[],
          sensitivity: 'private' as const,
          createdAt,
        };
  const revision: CanonicalRevision = {
    revisionId,
    projectId,
    commitId,
    manifestId,
    operation: claim ? 'ADD_CLAIM' : 'NO_OP',
    beforeVersion: opts.beforeVersion,
    afterVersion: opts.afterVersion,
    claimId: claim?.claimId,
    reason: 'commit',
    actor: { type: 'user', id: 'actor-1' },
    createdAt,
  };
  const historyEvent: CanonicalHistoryEvent = {
    historyEventId: eventId,
    projectId,
    commitId,
    manifestId,
    changeSetId: changeSetId,
    eventType: claim ? 'CANONICAL_CLAIM_ADDED' : 'CHANGESET_NO_OP',
    beforeVersion: opts.beforeVersion,
    afterVersion: opts.afterVersion,
    claimId: claim?.claimId,
    reason: 'commit',
    actor: { type: 'user', id: 'actor-1' },
    createdAt,
  };
  if (claim) {
    await pool!.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [claimId, projectId, randomUUID(), manifestId, JSON.stringify(claim), createdAt],
    );
  }
  // project_state.snapshot_digest is CHECK-constrained to the real digest of
  // the project's current claims; compute it from what is now persisted.
  const { rows: claimRows } = await pool!.query<{ claim_json: CanonicalClaim }>(
    `SELECT claim_json
     FROM canonical.claims
     WHERE project_id = $1
     ORDER BY claim_id`,
    [projectId],
  );
  const snapshotClaims = claimRows.map((row) => ({
    claimId: row.claim_json.claimId,
    text: row.claim_json.claimText,
    revisionNumber: row.claim_json.revisionNumber,
    evidenceIds: row.claim_json.evidenceIds,
  }));
  const snapshotDigest = canonicalSnapshotDigest(projectId, opts.afterVersion, snapshotClaims);
  await pool!.query(
    `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id) DO UPDATE
       SET version = EXCLUDED.version,
           snapshot_digest = EXCLUDED.snapshot_digest,
           updated_at = EXCLUDED.updated_at`,
    [projectId, opts.afterVersion, snapshotDigest, createdAt],
  );
  await pool!.query(
    `INSERT INTO canonical.commits (
       commit_id, project_id, manifest_id, manifest_digest, change_set_id,
       result_json, committed_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      commitId,
      projectId,
      manifestId,
      `sha256:${'1'.repeat(64)}`,
      changeSetId,
      JSON.stringify({ commitId }),
      createdAt,
    ],
  );
  await pool!.query(
    `INSERT INTO canonical.revisions (
       revision_id, project_id, commit_id, revision_json, created_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [revisionId, projectId, commitId, JSON.stringify(revision), createdAt],
  );
  await pool!.query(
    `INSERT INTO canonical.history_events (
       history_event_id, project_id, commit_id, event_json, created_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [eventId, projectId, commitId, JSON.stringify(historyEvent), createdAt],
  );
  return { commitId, claimId };
};

const cleanup = async () => {
  // canonical.claims is append-only (no DELETE), matching the other DB tests
  // that seed canonical tables: reset the whole canonical schema set.
  await pool!.query(`
    TRUNCATE
      canonical.outbox,
      canonical.history_events,
      canonical.revisions,
      canonical.commits,
      canonical.claims,
      canonical.project_state
    CASCADE
  `);
};

describe.runIf(pool)('FE-P5-S2 WP3 Reversal DraftChangeSet (real PostgreSQL)', () => {
  afterAll(async () => {
    await pool?.end();
  });

  it('finds an existing revision + same revisionId under a DIFFERENT project -> not found', async () => {
    const project = `p-rev-find-${randomUUID().slice(0, 8)}`;
    const otherProject = `p-rev-other-${randomUUID().slice(0, 8)}`;
    try {
      const { commitId } = await addCommit({
        projectId: project,
        revisionId: 'revision:1',
        eventId: 'e-1',
        createdAt: '2026-08-09T00:00:00.000Z',
        claimId: 'claim-a',
        beforeVersion: 0,
        afterVersion: 1,
      });
      const canonical = makeCanonical();
      // Existing project + existing revisionId -> found.
      const found = await canonical.findRevision(project, 'revision:1');
      expect(found).toBeDefined();
      expect(found!.projectId).toBe(project);
      expect(found!.revisionId).toBe('revision:1');
      expect(found!.commitId).toBe(commitId);
      // Wrong project + same revisionId -> NOT found (project scope guard).
      const wrong = await canonical.findRevision(otherProject, 'revision:1');
      expect(wrong).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('canonical-backed reversal eligibility on the real DB (tip eligible -> CANDIDATE)', async () => {
    const project = `p-rev-tip-${randomUUID().slice(0, 8)}`;
    try {
      await addCommit({
        projectId: project,
        revisionId: 'revision:1',
        eventId: 'e-1',
        createdAt: '2026-08-09T00:00:00.000Z',
        claimId: 'claim-a',
        beforeVersion: 0,
        afterVersion: 1,
      });
      const { commitId: secondCommitId } = await addCommit({
        projectId: project,
        revisionId: 'revision:2',
        eventId: 'e-2',
        createdAt: '2026-08-09T02:00:00.000Z',
        claimId: 'claim-b',
        beforeVersion: 1,
        afterVersion: 2,
      });
      const canonical = makeCanonical();
      const port = createReversalEligibilityPort(canonical, {
        currentCapabilitiesResolver: async () => [REVERSAL_CURRENT_CAPABILITY],
      });

      // Current tip (revision:2) is eligible; create produces a CANDIDATE.
      const { reversal, eligibility } = await port.createReversalDraftChangeSet({
        resourceProjectId: project,
        sourceRevisionId: 'revision:2',
        reason: 'rollback latest',
        createdBy: 'actor-1',
        createdAt: '2026-08-09T03:00:00.000Z',
      });
      expect(eligibility.eligible).toBe(true);
      expect(reversal.status).toBe('CANDIDATE');
      expect(reversal.sourceRevisionId).toBe('revision:2');
      expect(reversal.sourceCommitId).toBe(secondCommitId);
      expect(reversal.resourceProjectId).toBe(project);
    } finally {
      await cleanup();
    }
  });

  it('superseded target on the real DB -> typed eligibility rejection', async () => {
    const project = `p-rev-sup-${randomUUID().slice(0, 8)}`;
    try {
      await addCommit({
        projectId: project,
        revisionId: 'revision:1',
        eventId: 'e-1',
        createdAt: '2026-08-09T00:00:00.000Z',
        claimId: 'claim-a',
        beforeVersion: 0,
        afterVersion: 1,
      });
      await addCommit({
        projectId: project,
        revisionId: 'revision:2',
        eventId: 'e-2',
        createdAt: '2026-08-09T02:00:00.000Z',
        claimId: 'claim-b',
        beforeVersion: 1,
        afterVersion: 2,
      });
      const canonical = makeCanonical();
      const port = createReversalEligibilityPort(canonical, {
        currentCapabilitiesResolver: async () => [REVERSAL_CURRENT_CAPABILITY],
      });
      // Reversing revision:1 is superseded by the later claim commit.
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: project,
          sourceRevisionId: 'revision:1',
          reason: 'rollback old',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_SUPERSEDED_TARGET' });
    } finally {
      await cleanup();
    }
  });

  it('snapshot impact on the real DB: reversing the current tip removes its own claim', async () => {
    const project = `p-rev-impact-${randomUUID().slice(0, 8)}`;
    try {
      await addCommit({
        projectId: project,
        revisionId: 'revision:1',
        eventId: 'e-1',
        createdAt: '2026-08-09T00:00:00.000Z',
        claimId: 'claim-a',
        beforeVersion: 0,
        afterVersion: 1,
      });
      const { claimId: claimB } = await addCommit({
        projectId: project,
        revisionId: 'revision:2',
        eventId: 'e-2',
        createdAt: '2026-08-09T02:00:00.000Z',
        claimId: 'claim-b',
        beforeVersion: 1,
        afterVersion: 2,
      });
      const canonical = makeCanonical();
      const source = (await canonical.findRevision(project, 'revision:2'))!;
      const history = await canonical.listHistory(project);
      const repo = new PostgresCanonicalKnowledgeRepository(pool!);
      const snapshot = await repo.getSnapshot(project);
      const impact = computeReversalSnapshotImpact(source, snapshot, history);
      // GPT fix C: current-tip reversal removes the source revision's OWN
      // ADD_CLAIM effect (claim-b), retaining claim-a, impactedVersion=1.
      expect(impact.removedClaimIds).toEqual([claimB]);
      expect(impact.impactedVersion).toBe(1);
      expect(impact.impactedClaimCount).toBe(1);
      expect(impact.currentClaimCount).toBe(2);
      // Digest round-trips through the contract digest function.
      expect(impact.impactedDigest).toBe(
        canonicalSnapshotDigest(project, 1, [
          {
            claimId: snapshot.claims.find((c) => c.claimId !== claimB)!.claimId,
            text: snapshot.claims.find((c) => c.claimId !== claimB)!.text,
            revisionNumber: snapshot.claims.find((c) => c.claimId !== claimB)!.revisionNumber,
            evidenceIds: [],
          } satisfies CanonicalSnapshotClaim,
        ]),
      );
    } finally {
      await cleanup();
    }
  });

  it('same-timestamp tie-break on the real DB: later event detected by history position', async () => {
    const project = `p-rev-tie-${randomUUID().slice(0, 8)}`;
    try {
      const sameTime = '2026-08-09T00:00:00.000Z';
      await addCommit({
        projectId: project,
        revisionId: 'revision:1',
        eventId: 'e-1',
        createdAt: sameTime,
        claimId: 'claim-a',
        beforeVersion: 0,
        afterVersion: 1,
      });
      await addCommit({
        projectId: project,
        revisionId: 'revision:2',
        eventId: 'e-2',
        createdAt: sameTime,
        claimId: 'claim-b',
        beforeVersion: 1,
        afterVersion: 2,
      });
      const canonical = makeCanonical();
      const history = await canonical.listHistory(project);
      // Both events share createdAt; the DB orders by created_at,
      // history_event_id (e-1 < e-2), so e-2 is LATER than revision:1's e-1.
      expect(history.map((e) => e.historyEventId)).toEqual(['e-1', 'e-2']);
      const port = createReversalEligibilityPort(canonical, {
        currentCapabilitiesResolver: async () => [REVERSAL_CURRENT_CAPABILITY],
      });
      await expect(
        port.createReversalDraftChangeSet({
          resourceProjectId: project,
          sourceRevisionId: 'revision:1',
          reason: 'rollback',
          createdBy: 'actor-1',
          createdAt: '2026-08-09T03:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'REVERSAL_SUPERSEDED_TARGET' });
    } finally {
      await cleanup();
    }
  });
});
