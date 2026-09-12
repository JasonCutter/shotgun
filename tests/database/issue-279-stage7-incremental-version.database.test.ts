import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import { LexicalRetriever } from '../../modules/hybrid-retrieval/src/index.js';
import type { SearchProjectionDocument } from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const digest = (digit: string): string => `sha256:${digit.repeat(64)}`;

const doc = (projectId: string, version: number, text: string): SearchProjectionDocument => ({
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

  it('preserves row lineage while exposing current v3 identity through LexicalRetriever', async () => {
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
      snapshotDigest: digest('1'),
      projectedAt: backup.projectedAt,
    });
    await repository.applyCommit(projectId, {
      document: stable,
      commitId: stable.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 2,
      snapshotDigest: digest('2'),
      projectedAt: stable.projectedAt,
    });
    await repository.applyCommit(projectId, {
      document: archive,
      commitId: archive.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 3,
      snapshotDigest: digest('3'),
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

    const rawBackup = await repository.search(projectId, '02:00', 10, ['owner']);
    const rawStable = await repository.search(projectId, 'stable', 10, ['owner']);
    const rawArchive = await repository.search(projectId, 'ArchiveDB', 10, ['owner']);
    expect(rawBackup).toEqual([
      expect.objectContaining({ claimId: backup.claimId, canonicalVersion: 1 }),
    ]);
    expect(rawStable).toEqual([
      expect.objectContaining({ claimId: stable.claimId, canonicalVersion: 2 }),
    ]);
    expect(rawArchive).toEqual([
      expect.objectContaining({ claimId: archive.claimId, canonicalVersion: 3 }),
    ]);

    const lexical = new LexicalRetriever(repository, async () => ({
      snapshotId: `snapshot-${projectId}`,
      projectId,
      version: 3,
      digest: digest('3'),
      claims: [],
      createdAt: '2026-09-12T14:03:00.000Z',
    }));

    const lexicalBackup = await lexical.retrieve({
      projectId,
      query: '02:00',
      accessScopes: ['owner'],
      limit: 10,
    });
    const lexicalStable = await lexical.retrieve({
      projectId,
      query: 'stable',
      accessScopes: ['owner'],
      limit: 10,
    });
    const lexicalArchive = await lexical.retrieve({
      projectId,
      query: 'ArchiveDB',
      accessScopes: ['owner'],
      limit: 10,
    });

    expect(lexicalBackup.readiness).toMatchObject({
      status: 'READY',
      canonicalVersion: 3,
      projectedCanonicalVersion: 3,
    });
    expect(lexicalBackup.items).toEqual([
      expect.objectContaining({ claimId: backup.claimId, canonicalVersion: 3 }),
    ]);
    expect(lexicalStable.items).toEqual([
      expect.objectContaining({ claimId: stable.claimId, canonicalVersion: 3 }),
    ]);
    expect(lexicalArchive.items).toEqual([
      expect.objectContaining({ claimId: archive.claimId, canonicalVersion: 3 }),
    ]);
  });
});
