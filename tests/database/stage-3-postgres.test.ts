import { afterAll, beforeEach, describe, expect, it } from 'vitest';

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
import type { TransformationRevision } from '../../packages/contracts/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import {
  directTextCommand,
  documentRevisionQuery,
  evidenceListQuery,
  intakeResultQuery,
} from '../helpers/stage-3.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

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

describe.runIf(pool)('Stage 3 PostgreSQL persistence', () => {
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
});
