import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import type { SearchProjectionDocument } from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const documentFor = (
  projectId: string,
  claimText = 'Milo weighs 5 kg.',
): SearchProjectionDocument => ({
  projectId,
  claimId: `claim:${randomUUID()}`,
  commitId: randomUUID(),
  revisionId: `revision:${randomUUID()}`,
  canonicalVersion: 1,
  claimText,
  sourceVersionId: randomUUID(),
  evidenceIds: [randomUUID()],
  accessScope: ['owner'],
  sensitivity: 'private',
  projectedAt: new Date().toISOString(),
});

describe.runIf(pool)('Stage 7 PostgreSQL projection and search', () => {
  beforeEach(async () => {
    await pool!.query('TRUNCATE projection.search_documents, projection.watermarks CASCADE');
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('uses pg_trgm plus GIN indexes and restores the Watermark after restart', async () => {
    const extensions = await pool!.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    const indexes = await pool!.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'projection'
       ORDER BY indexname`,
    );
    expect(extensions.rows).toEqual([{ extname: 'pg_trgm' }]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(['projection_search_fts_idx', 'projection_search_trgm_idx']),
    );

    const projectId = `stage7-db-${randomUUID()}`;
    const document = documentFor(projectId);
    const digest = `sha256:${'1'.repeat(64)}`;
    const first = new PostgresSearchProjectionRepository(pool!);
    await first.applyCommit(projectId, {
      document,
      commitId: document.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 1,
      snapshotDigest: digest,
      projectedAt: document.projectedAt,
    });

    const exact = await first.search(projectId, 'Milo weighs', 10, ['owner']);
    const typo = await first.search(projectId, 'Milo weighs 5 kf.', 10, ['owner']);
    expect(exact[0]).toMatchObject({ claimId: document.claimId, matchType: 'SUBSTRING' });
    expect(typo[0]).toMatchObject({ claimId: document.claimId, matchType: 'TRIGRAM' });
    expect(await first.search(projectId, 'Milo', 10, ['reader'])).toEqual([]);

    const restarted = new PostgresSearchProjectionRepository(pool!);
    expect(await restarted.findWatermark(projectId)).toMatchObject({
      lastCommitId: document.commitId,
      canonicalVersion: 1,
      snapshotDigest: digest,
      status: 'READY',
    });
  });

  it('rolls back a partial document write and supports an atomic rebuild', async () => {
    const projectId = `stage7-db-failure-${randomUUID()}`;
    const document = documentFor(projectId);
    const digest = `sha256:${'2'.repeat(64)}`;
    const failing = new PostgresSearchProjectionRepository(pool!, {
      failpoint: 'after-document',
    });
    await expect(
      failing.applyCommit(projectId, {
        document,
        commitId: document.commitId,
        operation: 'ADD_CLAIM',
        canonicalVersion: 1,
        snapshotDigest: digest,
        projectedAt: document.projectedAt,
      }),
    ).rejects.toThrow('failpoint');
    const count = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM projection.search_documents WHERE project_id = $1',
      [projectId],
    );
    expect(count.rows[0]?.count).toBe('0');

    const healthy = new PostgresSearchProjectionRepository(pool!);
    await healthy.rebuild(projectId, {
      documents: [document],
      watermark: {
        projectId,
        lastCommitId: document.commitId,
        canonicalVersion: 1,
        snapshotDigest: digest,
        status: 'READY',
        updatedAt: document.projectedAt,
      },
    });
    await healthy.rebuild(projectId, {
      documents: [document],
      watermark: {
        projectId,
        lastCommitId: document.commitId,
        canonicalVersion: 1,
        snapshotDigest: digest,
        status: 'READY',
        updatedAt: document.projectedAt,
      },
    });
    expect(await healthy.search(projectId, 'Milo', 10, ['owner'])).toHaveLength(1);
  });
});
