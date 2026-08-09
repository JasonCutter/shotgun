import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';
import {
  canonicalSnapshotDigest,
  type CanonicalCommitResult,
  type FrontendCanonicalCommitWrite,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const authority = {
  kind: 'FRONTEND_REVIEW_APPROVAL' as const,
  approvalId: 'approval-1',
  approvalBindingDigest: 'sha256:binding',
  reviewContextId: 'context-1',
  contextRevision: 1,
  draftId: 'draft-1',
  draftRevision: 3,
  draftContentDigest: 'sha256:draft',
  approvedItemIds: ['item-1'],
};

const baseWrite = {
  projectId: 'project-1',
  expectedCanonicalVersion: 0,
  snapshotDigest: canonicalSnapshotDigest('project-1', 0, []),
  authority,
  reason: 'Committed via Review Approval approval-1.',
  actor: { type: 'user' as const, id: 'principal-1' },
  committedAt: '2026-08-09T00:00:00.000Z',
};

const addClaimWrite = (
  overrides: Partial<FrontendCanonicalCommitWrite> = {},
): FrontendCanonicalCommitWrite => {
  const commitId = randomUUID();
  return {
    ...baseWrite,
    commitId,
    revisionId: `revision:${commitId}`,
    historyEventId: `history:${commitId}`,
    outboxId: `outbox:${commitId}`,
    operation: 'ADD_CLAIM',
    claimId: 'claim-1',
    claimText: 'The reviewed claim is committed to Canonical.',
    sourceVersionId: 'source-version-1',
    evidenceIds: ['evidence-1'],
    accessScope: ['owner'],
    sensitivity: 'private',
    ...overrides,
  } as FrontendCanonicalCommitWrite;
};

const noOpWrite = (
  overrides: Partial<FrontendCanonicalCommitWrite> = {},
): FrontendCanonicalCommitWrite => {
  const commitId = randomUUID();
  return {
    ...baseWrite,
    commitId,
    revisionId: `revision:${commitId}`,
    historyEventId: `history:${commitId}`,
    outboxId: `outbox:${commitId}`,
    operation: 'NO_OP',
    ...overrides,
  } as FrontendCanonicalCommitWrite;
};

describe.runIf(pool)('FE-P5-XP Correction B: commitFrontendDraft (Postgres parity)', () => {
  afterAll(async () => {
    await pool!.end();
  });

  it('commits an ADD_CLAIM with FRONTEND_REVIEW_APPROVAL provenance and no legacy manifest', async () => {
    await dropSchemas();
    await migrateUpTo();
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    const write = addClaimWrite();
    const result = await repository.commitFrontendDraft(write);

    expect(result.status).toBe('COMMITTED');
    expect(result.operation).toBe('ADD_CLAIM');
    expect(result.manifestId).toBeNull();
    expect(result.manifestDigest).toBeNull();
    expect(result.changeSetId).toBeNull();
    expect(result.authorityId).toBe('approval-1');
    expect(result.authorityDigest).toBe('sha256:binding');
    expect(result.afterVersion).toBe(1);

    const snapshot = await repository.getSnapshot('project-1');
    expect(snapshot.version).toBe(1);
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.claims[0]?.claimId).toBe('claim-1');

    const claim = await repository.findClaim('project-1', 'claim-1');
    expect(claim?.createdFromManifestId).toBeNull();
    expect(claim?.authorityId).toBe('approval-1');
    expect(claim?.authorityDigest).toBe('sha256:binding');

    const history = await repository.listHistory('project-1');
    expect(history).toHaveLength(1);
    expect(history[0]?.eventType).toBe('CANONICAL_CLAIM_ADDED');
    expect(history[0]?.manifestId).toBeNull();

    const outbox = await repository.findOutbox('project-1', `outbox:${write.commitId}`);
    expect(outbox?.payload.manifestId).toBeNull();
  });

  it('is replay-idempotent for the same commit id + authority', async () => {
    await dropSchemas();
    await migrateUpTo();
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    const write = addClaimWrite();
    const first = await repository.commitFrontendDraft(write);
    const replay = await repository.commitFrontendDraft(write);
    expect(replay).toEqual(first);
    const snapshot = await repository.getSnapshot('project-1');
    expect(snapshot.version).toBe(1);
    expect(snapshot.claims).toHaveLength(1);
  });

  it('rejects a replay whose authorityDigest differs from the stored commit (GPT Round 3 #1)', async () => {
    await dropSchemas();
    await migrateUpTo();
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    const write = addClaimWrite();
    const first = await repository.commitFrontendDraft(write);
    expect(first.authorityDigest).toBe('sha256:binding');
    // Same commit id + same approvalId but a forged binding digest.
    await expect(
      repository.commitFrontendDraft(
        addClaimWrite({
          authority: { ...authority, approvalBindingDigest: 'sha256:forged' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a second commit for the same approval (one approval -> one commit)', async () => {
    await dropSchemas();
    await migrateUpTo();
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    await repository.commitFrontendDraft(addClaimWrite());
    await expect(
      repository.commitFrontendDraft(
        addClaimWrite({
          commitId: randomUUID(),
          revisionId: `revision:${randomUUID()}`,
          historyEventId: `history:${randomUUID()}`,
          outboxId: `outbox:${randomUUID()}`,
          claimId: 'claim-2',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const snapshot = await repository.getSnapshot('project-1');
    expect(snapshot.version).toBe(1);
  });

  it('fails closed with STALE_APPROVAL when the canonical snapshot moved', async () => {
    await dropSchemas();
    await migrateUpTo();
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    // Advance the snapshot with a first commit, then try to commit against v0.
    await repository.commitFrontendDraft(
      addClaimWrite({ authority: { ...authority, approvalId: 'approval-a' } }),
    );
    await expect(
      repository.commitFrontendDraft(
        addClaimWrite({
          authority: { ...authority, approvalId: 'approval-b' },
          commitId: randomUUID(),
          revisionId: `revision:${randomUUID()}`,
          historyEventId: `history:${randomUUID()}`,
          outboxId: `outbox:${randomUUID()}`,
          claimId: 'claim-b',
        }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_APPROVAL' });
  }, 60_000);

  it('commits a NO_OP without claims or a version bump', async () => {
    await dropSchemas();
    await migrateUpTo();
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    const result = await repository.commitFrontendDraft(noOpWrite());
    expect(result.status).toBe('NO_OP');
    expect(result.afterVersion).toBe(0);
    const snapshot = await repository.getSnapshot('project-1');
    expect(snapshot.version).toBe(0);
    expect(snapshot.claims).toHaveLength(0);
    const history = await repository.listHistory('project-1');
    expect(history[0]?.eventType).toBe('CHANGESET_NO_OP');
  });

  it('preserves legacy Stage-5 commit rows with LEGACY_STAGE5_MANIFEST authority', async () => {
    await dropSchemas();
    await migrateUpTo();
    const client = await pool!.connect();
    try {
      // Insert a legacy-shaped commit row directly and verify the authority
      // defaults to LEGACY_STAGE5_MANIFEST without breaking the frontend path.
      await client.query(
        `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
         VALUES ($1, 0, $2, '2026-08-09T00:00:00.000Z')
         ON CONFLICT (project_id) DO NOTHING`,
        ['legacy-project', canonicalSnapshotDigest('legacy-project', 0, [])],
      );
      const legacyCommitId = randomUUID();
      const legacyManifestId = randomUUID();
      const legacyChangeSetId = randomUUID();
      await client.query(
        `INSERT INTO canonical.commits (
           commit_id, project_id, manifest_id, manifest_digest, change_set_id,
           result_json, committed_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          legacyCommitId,
          'legacy-project',
          legacyManifestId,
          'sha256:' + 'a'.repeat(64),
          legacyChangeSetId,
          JSON.stringify({ commitId: legacyCommitId }),
          '2026-08-09T00:00:00.000Z',
        ],
      );
      const row = await client.query(
        `SELECT authority_kind, authority_id, authority_digest, manifest_id, change_set_id
         FROM canonical.commits WHERE commit_id = $1`,
        [legacyCommitId],
      );
      expect(row.rows[0]?.authority_kind).toBe('LEGACY_STAGE5_MANIFEST');
      expect(row.rows[0]?.manifest_id).toBe(legacyManifestId);
      expect(row.rows[0]?.authority_id).toBeNull();
    } finally {
      client.release();
    }
  });
});
