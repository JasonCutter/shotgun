import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import type { SearchProjectionDocument } from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const doc = (
  projectId: string,
  version: number,
  text: string,
): SearchProjectionDocument => ({
  projectId,
  claimId: `claim-${version}-${randomUUID()}`,
  commitId: `commit-${version}-${randomUUID()}`,
  revisionId: `revision-${version}-${randomUUID()}`,
  canonicalVersion: version,
  claimText: text,
  sourceVersionId: `source-${version}-${randomUUID()}`,
  evidenceIds: [`evidence-${version}-${randomUUID()}`],
  accessScope: ['owner'],
  sensitivity: 'private',
  projectedAt: `2026-09-12T14:0${version}:00.000Z`,
});

describe.runIf(pool)('Issue #279 Stage 7 incremental lexical version semantics', () => {
  beforeEach(async () => {
    await pool!.query('TRUNCATE projection.search_documents, projection.watermarks CASCADE');
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('returns historical v1/v2 claims as members of the current v3 READY snapshot', async () => {
    const projectId = `issue-279-${randomUUID()}`;
    const repository = new PostgresSearchProjectionRepository(pool!);
    const backup = doc(projectId, 1, 'Orion 서비스는 매일 02:00에 백업을 시작한다.');
    const stable = doc(projectId, 2, 'Orion 서비스의 운영 배포 채널은 stable이다.');
    const archive = doc(projectId, 3, 'Orion 서비스는 ArchiveDB에 운영 기록을 보관한다.');

    await repository.applyCommit(projectId, {
      document: backup,
      commitId: backup.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:v1',
      projectedAt: backup.projectedAt,
    });
    await repository.applyCommit(projectId, {
      document: stable,
      commitId: stable.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 2,
      snapshotDigest: 'sha256:v2',
      projectedAt: stable.projectedAt,
    });
    await repository.applyCommit(projectId, {
      document: archive,
      commitId: archive.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 3,
      snapshotDigest: 'sha256:v3',
      projectedAt: archive.projectedAt,
    });

    const rawRows = await pool!.query<{ claim_id: string; canonical_version: number }>(
      `SELECT claim_id, canonical_version
       FROM projection.search_documents
       WHERE project_id = $1
       ORDER BY canonical_version`,
      [projectId],
    );
    expect(rawRows.rows.map((row) => row.canonical_version)).toEqual([1, 2, 3]);

    const backupResults = await repository.search(projectId, '02:00', 10, ['owner']);
    const stableResults = await repository.search(projectId, 'stable', 10, ['owner']);
    const archiveResults = await repository.search(projectId, 'ArchiveDB', 10, ['owner']);

    expect(backupResults).toEqual([
      expect.objectContaining({ claimId: backup.claimId, canonicalVersion: 3 }),
    ]);
    expect(stableResults).toEqual([
      expect.objectContaining({ claimId: stable.claimId, canonicalVersion: 3 }),
    ]);
    expect(archiveResults).toEqual([
      expect.objectContaining({ claimId: archive.claimId, canonicalVersion: 3 }),
    ]);

    const watermark = await repository.findWatermark(projectId);
    expect(watermark).toMatchObject({
      status: 'READY',
      canonicalVersion: 3,
      snapshotDigest: 'sha256:v3',
    });
  });
});
