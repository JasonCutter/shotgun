import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresSemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-postgres/src/index.js';
import type { SemanticEmbeddingProfile } from '../../packages/contracts/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { createPostCommitAckLossPool } from '../helpers/postgres-commit-ack-loss.js';

const databaseConfigured = Boolean(process.env.TEST_DATABASE_URL?.trim());

const profile = (
  projectId: string,
  revision: number,
  suffix: string,
): SemanticEmbeddingProfile => ({
  profileId: `ts6-profile-${suffix}`,
  projectId,
  profileRevision: revision,
  providerId: 'openai',
  embeddingModelId: 'text-embedding-3-small',
  credentialId: `ts6-credential-${projectId}`,
  credentialRevision: 1,
  representationVersion: 'semantic-representation:v1',
  dimension: 1536,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  status: 'PREPARED',
  createdAt: '2026-09-20T08:00:00.000Z',
  createdBy: 'ts6-c1',
  updatedBy: 'ts6-c1',
  updatedAt: '2026-09-20T08:00:00.000Z',
});

describe.skipIf(!databaseConfigured)('TS-6 semantic embedding COMMIT acknowledgement proof', () => {
  let isolated: IsolatedPostgresTestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    isolated = await createIsolatedPostgresTestDatabase();
    pool = isolated.createPool();
  });

  afterAll(async () => {
    await isolated.dispose();
  });

  it('reconciles the exact hidden revision and preserves stale/newer/cross-project boundaries', async () => {
    const projectId = `ts6-semantic-${Date.now()}`;
    const projectB = `${projectId}-other`;
    const repository = new PostgresSemanticEmbeddingProfileRepository(pool);
    const first = profile(projectId, 1, 'one');
    const second = profile(projectId, 2, 'two');

    await expect(repository.saveRevision({ expectedRevision: 0, next: first })).resolves.toBe(
      'CREATED',
    );

    const injected = createPostCommitAckLossPool(pool);
    await expect(
      new PostgresSemanticEmbeddingProfileRepository(injected.pool).saveRevision({
        expectedRevision: 1,
        next: second,
      }),
    ).resolves.toBe('UPDATED');
    expect(injected.trace).toMatchObject({
      commitAttempts: 1,
      rollbackAttempts: 0,
      commitAttempted: true,
      acknowledgementLost: true,
      rollbackAfterCommit: 0,
    });

    const freshRepository = new PostgresSemanticEmbeddingProfileRepository(pool);
    await expect(freshRepository.findByRevision(projectId, 2)).resolves.toEqual(second);
    await expect(freshRepository.saveRevision({ expectedRevision: 1, next: second })).resolves.toBe(
      'CONFLICT',
    );
    await expect(
      freshRepository.saveRevision({ expectedRevision: 1, next: profile(projectId, 3, 'newer') }),
    ).resolves.toBe('CONFLICT');

    await expect(freshRepository.findByRevision(projectB, 2)).resolves.toBeUndefined();
    await expect(freshRepository.findCurrent(projectId)).resolves.toEqual(second);
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM projection.semantic_embedding_profiles
        WHERE project_id = $1 AND profile_revision = 2`,
      [projectId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });
});
