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
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { candidatesQuery, directTextCommand, intakeResultQuery } from '../helpers/stage-4.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createHarness = async (storage: InMemoryAssetStorage, provider: FakeAIProviderAdapter) => {
  const aiRepository = new PostgresAIProviderCallRepository(pool!);
  const kernel = new ShotgunKernel(new InProcessTransport());
  const text = new LucasAugmentedPlainTextAdapter();
  kernel.register(
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), text),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), text),
    createAIProviderModule(aiRepository, provider, {
      allowPrivate: true,
      allowRestricted: false,
      maxAttempts: 2,
    }),
    createCandidateGenerationModule(new PostgresCandidateRepository(pool!)),
    createValidationModule(new PostgresValidationRepository(pool!)),
  );
  await kernel.start();
  return { kernel, aiRepository };
};

describe.runIf(pool)('Stage 12.1 durable AI materialization', () => {
  beforeEach(async () => {
    await pool!
      .query(`TRUNCATE validation.results, candidate.materializations, candidate.claim_candidates,
      candidate.batches, ai.provider_outputs, ai.provider_attempts, ai.provider_calls, evidence.spans,
      transformation.attempts, transformation.revisions, intake.submissions, asset.storage_receipts,
      asset.source_versions, asset.sources, asset.original_assets CASCADE`);
  });
  afterAll(async () => await pool!.end());

  it('calls the provider once and creates no duplicate Candidates on repeated delivery', async () => {
    const provider = new FakeAIProviderAdapter();
    const first = await createHarness(new InMemoryAssetStorage(), provider);
    const command = directTextCommand('stage12-durable-repeat', 'Milo weighs 5 kg.');
    await first.kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await first.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    await first.kernel.connector.sendCommand(
      directTextCommand('stage12-durable-repeat', 'Milo weighs 5 kg.'),
    );
    const candidates = (
      await first.kernel.connector.query<{ items: readonly unknown[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;
    expect(provider.calls()).toBe(1);
    expect(candidates).toHaveLength(1);
    await first.kernel.shutdown();
  });

  it('keeps accepted output recoverable after a restart boundary without another provider call', async () => {
    const provider = new FakeAIProviderAdapter();
    const first = await createHarness(new InMemoryAssetStorage(), provider);
    const command = directTextCommand('stage12-durable-output', 'Milo weighs 5 kg.');
    await first.kernel.connector.sendCommand(command);
    const record = (await first.aiRepository.list())[0]!;
    await first.aiRepository.failMaterialization(
      record.projectId,
      record.requestId,
      record.output!.outputId,
      'TERMINAL_FAILURE',
    );
    await first.kernel.shutdown();
    const secondProvider = new FakeAIProviderAdapter();
    const second = await createHarness(new InMemoryAssetStorage(), secondProvider);
    expect(await second.aiRepository.listRecoverableMaterializations()).toHaveLength(1);
    expect(secondProvider.calls()).toBe(0);
    await second.kernel.shutdown();
  });

  it('keeps the existing batch binding recoverable without adding Candidates or calling the provider', async () => {
    const provider = new FakeAIProviderAdapter();
    const harness = await createHarness(new InMemoryAssetStorage(), provider);
    const command = directTextCommand('stage12-durable-bind', 'Milo weighs 5 kg.');
    await harness.kernel.connector.sendCommand(command);
    const record = (await harness.aiRepository.list())[0]!;
    await harness.aiRepository.failMaterialization(
      record.projectId,
      record.requestId,
      record.output!.outputId,
      'TERMINAL_FAILURE',
    );
    const counts = await pool!.query(
      `SELECT count(*)::text AS candidates FROM candidate.claim_candidates`,
    );
    expect(
      (await harness.aiRepository.listRecoverableMaterializations())[0]?.output?.outputId,
    ).toBe(record.output!.outputId);
    expect(counts.rows[0]?.candidates).toBe('1');
    expect(provider.calls()).toBe(1);
    await harness.kernel.shutdown();
  });

  it('records a clear provider failure inside the two-attempt durable budget and produces no Candidate', async () => {
    const provider = new FakeAIProviderAdapter([
      { errorCode: 'TIMEOUT' },
      { errorCode: 'TIMEOUT' },
    ]);
    const harness = await createHarness(new InMemoryAssetStorage(), provider);
    await harness.kernel.connector.sendCommand(
      directTextCommand('stage12-durable-failure', 'Milo weighs 5 kg.'),
    );
    const record = (await harness.aiRepository.list())[0]!;
    expect(provider.calls()).toBe(2);
    expect(record.attempts).toHaveLength(2);
    expect(record.state).toBe('PROVIDER_FAILED');
    expect(
      (await pool!.query(`SELECT count(*)::text AS candidates FROM candidate.claim_candidates`))
        .rows[0]?.candidates,
    ).toBe('0');
    await harness.kernel.shutdown();
  });

  it('fails closed for invalid persisted output and does not materialize Candidates', async () => {
    const provider = new FakeAIProviderAdapter([
      { rawText: '{"candidates":[{"claimText":"bad"}]}' },
      { rawText: '{"candidates":[{"evidenceId":"missing"}]}' },
    ]);
    const harness = await createHarness(new InMemoryAssetStorage(), provider);
    await harness.kernel.connector.sendCommand(
      directTextCommand('stage12-durable-corrupt', 'Milo weighs 5 kg.'),
    );
    const record = (await harness.aiRepository.list())[0]!;
    expect(provider.calls()).toBe(2);
    expect(record.state).toBe('PROVIDER_FAILED');
    expect(record.output).toBeUndefined();
    expect(
      (await pool!.query(`SELECT count(*)::text AS candidates FROM candidate.claim_candidates`))
        .rows[0]?.candidates,
    ).toBe('0');
    await harness.kernel.shutdown();
  });
});
