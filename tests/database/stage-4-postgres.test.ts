import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
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
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import type { ClaimCandidate } from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { candidatesQuery, directTextCommand, intakeResultQuery } from '../helpers/stage-4.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createHarness = async (storage: InMemoryAssetStorage, provider: FakeAIProviderAdapter) => {
  const adapter = new LucasAugmentedPlainTextAdapter();
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), adapter),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), adapter),
    createAIProviderModule(new PostgresAIProviderCallRepository(pool!), provider, {
      allowPrivate: true,
      allowRestricted: false,
      maxAttempts: 2,
    }),
    createCandidateGenerationModule(new PostgresCandidateRepository(pool!)),
    createValidationModule(new PostgresValidationRepository(pool!)),
  );
  await kernel.start();
  return kernel;
};

describe.runIf(pool)('Stage 4 PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
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

  it('reuses provider call, candidate revision and validation after a runtime restart', async () => {
    const storage = new InMemoryAssetStorage();
    const firstProvider = new FakeAIProviderAdapter();
    const first = await createHarness(storage, firstProvider);
    const command = directTextCommand('stage4-postgres', 'Milo weighs 5 kg.');
    await first.connector.sendCommand(command);
    const intake = (
      await first.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const firstCandidate = (
      await first.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;
    expect(first.connector.deadLetters.list()).toEqual([]);
    expect(firstCandidate.status).toBe('READY');
    await first.shutdown();

    const secondProvider = new FakeAIProviderAdapter();
    const second = await createHarness(storage, secondProvider);
    const replayed = directTextCommand('stage4-postgres', 'Milo weighs 5 kg.');
    await second.connector.sendCommand(replayed);
    const secondCandidate = (
      await second.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(replayed, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;

    expect(secondCandidate.candidateId).toBe(firstCandidate.candidateId);
    expect(secondCandidate.status).toBe('READY');
    expect(firstProvider.calls()).toBe(1);
    expect(secondProvider.calls()).toBe(0);
    const counts = await pool!.query<{
      calls: string;
      attempts: string;
      batches: string;
      candidates: string;
      validations: string;
    }>(`
      SELECT
        (SELECT count(*) FROM ai.provider_calls)::text AS calls,
        (SELECT count(*) FROM ai.provider_attempts)::text AS attempts,
        (SELECT count(*) FROM candidate.batches)::text AS batches,
        (SELECT count(*) FROM candidate.claim_candidates)::text AS candidates,
        (SELECT count(*) FROM validation.results)::text AS validations
    `);
    expect(counts.rows[0]).toEqual({
      calls: '1',
      attempts: '1',
      batches: '1',
      candidates: '1',
      validations: '1',
    });
    await second.shutdown();
  });
});
