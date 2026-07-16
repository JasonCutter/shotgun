import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { EmptyCanonicalSnapshotAdapter } from '../../adapters/canonical-snapshot-empty/src/index.js';
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
import {
  PostgresAIProviderCallRepository,
  PostgresCandidateRepository,
  PostgresValidationRepository,
} from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresComparisonRepository,
} from '../../adapters/postgres-stage5/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import type {
  ApprovedChangeSetManifest,
  DraftChangeSet,
} from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import {
  changesQuery,
  decisionCommand,
  directTextCommand,
  intakeResultQuery,
  manifestQuery,
  reviewQuery,
} from '../helpers/stage-5.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createHarness = async (storage: InMemoryAssetStorage) => {
  const adapter = new LucasAugmentedPlainTextAdapter();
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), adapter),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), adapter),
    createAIProviderModule(
      new PostgresAIProviderCallRepository(pool!),
      new FakeAIProviderAdapter(),
      {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 2,
      },
    ),
    createCandidateGenerationModule(new PostgresCandidateRepository(pool!)),
    createValidationModule(new PostgresValidationRepository(pool!)),
    createComparisonModule(
      new PostgresComparisonRepository(pool!),
      new EmptyCanonicalSnapshotAdapter(),
      new JsDiffAdapter(),
    ),
    createChangeSetReviewModule(new PostgresChangeSetReviewRepository(pool!)),
  );
  await kernel.start();
  return kernel;
};

const createDraft = async (kernel: ShotgunKernel, submissionId: string) => {
  const command = directTextCommand(submissionId, 'Milo weighs 5 kg.');
  await kernel.connector.sendCommand(command);
  const intake = (
    await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
  ).result.payload;
  const draft = (
    await kernel.connector.query<{ items: readonly DraftChangeSet[] }>(
      changesQuery(command, intake.sourceVersionId),
    )
  ).result.payload.items[0]!;
  return { command, draft };
};

describe.runIf(pool)('Stage 5 PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        review.decisions,
        review.change_sets,
        comparison.results,
        validation.results,
        candidate.claim_candidates,
        candidate.batches,
        ai.provider_attempts,
        ai.provider_calls,
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

  it('keeps review history and the approval manifest across runtime restarts', async () => {
    const storage = new InMemoryAssetStorage();
    const first = await createHarness(storage);
    const { command, draft } = await createDraft(first, 'stage5-postgres-restart');
    await first.connector.sendCommand(
      decisionCommand(command, draft, 'HOLD', randomUUID(), 'Wait for owner review.'),
    );
    await first.shutdown();

    const second = await createHarness(storage);
    const held = (
      await second.connector.query<{ changeSet: DraftChangeSet }>(
        reviewQuery(command, draft.changeSetId),
      )
    ).result.payload.changeSet;
    expect(held).toMatchObject({
      status: 'ON_HOLD',
      decisions: [{ decision: 'HOLD', reason: 'Wait for owner review.' }],
    });

    await second.connector.sendCommand(
      decisionCommand(
        command,
        held,
        'APPROVE',
        '00000000-0000-4000-8000-000000000005',
        'Owner completed review.',
      ),
    );
    const manifest = (
      await second.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(command, draft.changeSetId),
      )
    ).result.payload;
    expect(manifest.reason).toBe('Owner completed review.');
    await second.shutdown();

    const third = await createHarness(storage);
    const replay = await third.connector.sendCommand(
      decisionCommand(
        command,
        held,
        'APPROVE',
        '00000000-0000-4000-8000-000000000005',
        'Owner completed review.',
      ),
    );
    expect(replay.result).toMatchObject({
      changeSet: { status: 'APPROVED', decisions: [{ decision: 'HOLD' }, { decision: 'APPROVE' }] },
      manifest: { manifestId: manifest.manifestId },
    });
    const restored = (
      await third.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(command, draft.changeSetId),
      )
    ).result.payload;
    expect(restored.manifestId).toBe(manifest.manifestId);
    const counts = await pool!.query<{
      comparisons: string;
      changes: string;
      decisions: string;
    }>(`
      SELECT
        (SELECT count(*) FROM comparison.results)::text AS comparisons,
        (SELECT count(*) FROM review.change_sets)::text AS changes,
        (SELECT count(*) FROM review.decisions)::text AS decisions
    `);
    expect(counts.rows[0]).toEqual({
      comparisons: '1',
      changes: '1',
      decisions: '2',
    });
    await third.shutdown();
  });

  it('allows only one final decision under concurrent approval attempts', async () => {
    const kernel = await createHarness(new InMemoryAssetStorage());
    const { command, draft } = await createDraft(kernel, 'stage5-postgres-concurrency');
    const results = await Promise.allSettled([
      kernel.connector.sendCommand(
        decisionCommand(command, draft, 'APPROVE', randomUUID(), 'First approval.'),
      ),
      kernel.connector.sendCommand(
        decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Second approval.'),
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const stored = (
      await kernel.connector.query<{ changeSet: DraftChangeSet }>(
        reviewQuery(command, draft.changeSetId),
      )
    ).result.payload.changeSet;
    expect(stored.status).toBe('APPROVED');
    expect(stored.decisions).toHaveLength(1);
    const count = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM review.decisions',
    );
    expect(count.rows[0]?.count).toBe('1');
    await kernel.shutdown();
  });
});
