import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
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
import type { TransformationRevision } from '../../packages/contracts/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import {
  directTextCommand,
  documentRevisionQuery,
  evidenceQuery,
  evidenceListQuery,
  intakeResultQuery,
} from '../helpers/stage-3.js';
import { fileCommand } from '../helpers/stage-2.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

let isolatedDatabase: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>> | undefined;
let pool: Pool | undefined;

const createHarness = async (storage: InMemoryAssetStorage) => {
  const adapter = new LucasAugmentedPlainTextAdapter();
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), adapter),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), adapter),
  );
  await kernel.start();
  return kernel;
};

describe('Stage 3 PostgreSQL persistence', () => {
  beforeAll(async () => {
    isolatedDatabase = await createIsolatedPostgresTestDatabase();
    pool = isolatedDatabase.createPool();
  });

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
    await isolatedDatabase?.dispose();
  });

  it('reuses Revision and Evidence identities across runtime restarts', async () => {
    const storage = new InMemoryAssetStorage();
    const first = await createHarness(storage);
    const command = directTextCommand('stage3-postgres', 'Persistent first. Persistent second.');
    await first.connector.sendCommand(command);
    const intake = (
      await first.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const firstRevision = (
      await first.connector.query<TransformationRevision>(
        documentRevisionQuery(command, intake.sourceVersionId),
      )
    ).result.payload;
    const firstEvidence = (
      await first.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(command, intake.sourceVersionId),
      )
    ).result.payload;
    await first.shutdown();

    const second = await createHarness(storage);
    const replayed = directTextCommand('stage3-postgres', 'Persistent first. Persistent second.');
    await second.connector.sendCommand(replayed);
    const secondRevision = (
      await second.connector.query<TransformationRevision>(
        documentRevisionQuery(replayed, intake.sourceVersionId),
      )
    ).result.payload;
    const secondEvidence = (
      await second.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(replayed, intake.sourceVersionId),
      )
    ).result.payload;

    expect(secondRevision.revisionId).toBe(firstRevision.revisionId);
    expect(secondEvidence.items.map((item) => item.evidenceId)).toEqual(
      firstEvidence.items.map((item) => item.evidenceId),
    );
    const counts = await pool!.query<{
      revisions: string;
      attempts: string;
      evidence: string;
    }>(`
      SELECT
        (SELECT count(*) FROM transformation.revisions)::text AS revisions,
        (SELECT count(*) FROM transformation.attempts)::text AS attempts,
        (SELECT count(*) FROM evidence.spans)::text AS evidence
    `);
    expect(counts.rows[0]).toEqual({
      revisions: '1',
      attempts: '2',
      evidence: String(firstEvidence.items.length),
    });
    await second.shutdown();
  });

  it('persists Markdown heading context on the exact body Evidence', async () => {
    const storage = new InMemoryAssetStorage();
    const first = await createHarness(storage);
    const statement = 'Shotgun v1.2 출시일은 2026-08-01이다.';
    const command = fileCommand(
      'stage3-markdown-heading-postgres',
      'release.md',
      'text/markdown',
      new TextEncoder().encode(`# Release\n${statement}`),
    );
    await first.connector.sendCommand(command);
    const intake = (
      await first.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const firstEvidence = (
      await first.connector.query<{
        items: readonly {
          readonly evidenceId: string;
          readonly position: { readonly start: number; readonly end: number };
          readonly selectors: readonly { readonly type: string; readonly value: string }[];
        }[];
      }>(evidenceListQuery(command, intake.sourceVersionId))
    ).result.payload;
    await first.shutdown();

    const second = await createHarness(storage);
    const replay = fileCommand(
      'stage3-markdown-heading-postgres',
      'release.md',
      'text/markdown',
      new TextEncoder().encode(`# Release\n${statement}`),
    );
    await second.connector.sendCommand(replay);
    const storedEvidence = (
      await second.connector.query<{
        items: readonly {
          readonly evidenceId: string;
          readonly position: { readonly start: number; readonly end: number };
          readonly selectors: readonly { readonly type: string; readonly value: string }[];
        }[];
      }>(evidenceListQuery(replay, intake.sourceVersionId))
    ).result.payload;
    const expected = storedEvidence.items.find(
      (item) => item.position.start === 10 && item.position.end === 41,
    );
    const storedBody = expected
      ? (
          await second.connector.query<{
            readonly quote: { readonly exact: string };
            readonly selectors: readonly { readonly type: string; readonly value: string }[];
          }>(evidenceQuery(replay, expected.evidenceId))
        ).result.payload
      : undefined;

    expect(storedBody).toMatchObject({
      quote: { exact: statement },
      selectors: [{ type: 'MarkdownHeadingContext', value: 'Release' }],
    });
    expect(storedEvidence.items.map((item) => item.evidenceId)).toEqual(
      firstEvidence.items.map((item) => item.evidenceId),
    );
    await second.shutdown();
  });
});
