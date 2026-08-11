import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createStage2Harness, directTextCommand, intakeResultQuery } from '../helpers/stage-2.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Stage 2 PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        intake.submissions,
        asset.storage_receipts,
        asset.source_versions,
        asset.sources,
        asset.original_assets
      CASCADE
    `);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('keeps Submission and SourceVersion idempotent across runtime restarts', async () => {
    const storage = new InMemoryAssetStorage();
    const first = await createStage2Harness({
      transport: new InProcessTransport(),
      intakeRepository: new PostgresIntakeRepository(pool!),
      originalAssetRepository: new PostgresOriginalAssetRepository(pool!),
      storage,
    });
    const command = directTextCommand('postgres-dedup', 'persistent original');
    await first.kernel.connector.sendCommand(command);
    const firstResult = (
      await first.kernel.connector.query<{
        sourceId: string;
        sourceVersionId: string;
      }>(intakeResultQuery(command))
    ).result.payload;
    await first.kernel.shutdown();

    const second = await createStage2Harness({
      transport: new InProcessTransport(),
      intakeRepository: new PostgresIntakeRepository(pool!),
      originalAssetRepository: new PostgresOriginalAssetRepository(pool!),
      storage,
    });
    const replayed = directTextCommand('postgres-dedup', 'persistent original');
    await second.kernel.connector.sendCommand(replayed);
    const replayedResult = (
      await second.kernel.connector.query<{
        sourceId: string;
        sourceVersionId: string;
      }>(intakeResultQuery(replayed))
    ).result.payload;

    expect(replayedResult).toEqual(firstResult);
    const counts = await pool!.query<{
      submissions: string;
      sources: string;
      versions: string;
      assets: string;
      receipts: string;
    }>(`
      SELECT
        (SELECT count(*) FROM intake.submissions)::text AS submissions,
        (SELECT count(*) FROM asset.sources)::text AS sources,
        (SELECT count(*) FROM asset.source_versions)::text AS versions,
        (SELECT count(*) FROM asset.original_assets)::text AS assets,
        (SELECT count(*) FROM asset.storage_receipts)::text AS receipts
    `);
    expect(counts.rows[0]).toEqual({
      submissions: '1',
      sources: '1',
      versions: '1',
      assets: '1',
      receipts: '1',
    });
  });

  it('serializes new versions for the same Source', async () => {
    const storage = new InMemoryAssetStorage();
    const harness = await createStage2Harness({
      transport: new InProcessTransport(),
      intakeRepository: new PostgresIntakeRepository(pool!),
      originalAssetRepository: new PostgresOriginalAssetRepository(pool!),
      storage,
    });
    const first = directTextCommand('postgres-version-1', 'one');
    await harness.kernel.connector.sendCommand(first);
    const firstResult = (
      await harness.kernel.connector.query<{ sourceId: string }>(intakeResultQuery(first))
    ).result.payload;
    const second = directTextCommand('postgres-version-2', 'two', {
      sourceId: firstResult.sourceId,
    });
    const third = directTextCommand('postgres-version-3', 'three', {
      sourceId: firstResult.sourceId,
    });

    await Promise.all([
      harness.kernel.connector.sendCommand(second),
      harness.kernel.connector.sendCommand(third),
    ]);

    const versions = await pool!.query<{ version_number: number }>(
      `
        SELECT version_number
        FROM asset.source_versions
        WHERE source_id = $1
        ORDER BY version_number
      `,
      [firstResult.sourceId],
    );
    expect(versions.rows.map((row) => row.version_number)).toEqual([1, 2, 3]);
  });
});
