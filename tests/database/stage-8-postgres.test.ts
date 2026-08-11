import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { fileCommand } from '../helpers/stage-2.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Stage 8 PostgreSQL format persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        evidence.spans,
        transformation.attempts,
        transformation.revisions,
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

  it('stores binary media and Cell selectors without losing JSON structure', async () => {
    const transformer = new PythonDocumentFormatAdapter({
      pythonExecutable: process.env.PYTHON ?? 'python',
    });
    const locator = new LucasAugmentedPlainTextAdapter();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      createIntakeModule(new PostgresIntakeRepository(pool!)),
      createOriginalAssetModule(
        new PostgresOriginalAssetRepository(pool!),
        new InMemoryAssetStorage(),
      ),
      createTransformationModule(new PostgresTransformationRepository(pool!), transformer),
      createEvidenceModule(new PostgresEvidenceRepository(pool!), locator),
    );
    await kernel.start();
    const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.xlsx'));
    await kernel.connector.sendCommand(
      fileCommand(
        'stage8-postgres-xlsx',
        'golden.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes,
      ),
    );
    const stored = await pool!.query<{
      media_type: string;
      material_kind: string;
      selectors: unknown;
    }>(
      `
        SELECT v.media_type, r.material_kind, e.selectors
        FROM asset.source_versions v
        JOIN asset.storage_receipts r ON r.source_version_id = v.source_version_id
        JOIN evidence.spans e ON e.source_version_id = v.source_version_id
        WHERE e.selectors @> '[{"type":"CellSelector","cell":"B2"}]'::jsonb
      `,
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      material_kind: 'document',
    });
    await kernel.shutdown();
  }, 20_000);
});
