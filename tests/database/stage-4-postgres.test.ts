import { randomUUID } from 'node:crypto';

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
import { createCommand, type ClaimCandidate } from '../../packages/contracts/src/index.js';
import type { AIProviderExecutionRecord } from '../../modules/ai-provider/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { candidatesQuery, directTextCommand, intakeResultQuery } from '../helpers/stage-4.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
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

const reextractCommand = (
  parent: ReturnType<typeof directTextCommand>,
  sourceVersionId: string,
  requestId: string,
  idempotencyKey: string,
) =>
  createCommand({
    messageType: 'ReextractCandidateMaterialization',
    schemaVersion: '1.0.0',
    producerModule: 'stage4-postgres-test',
    producerVersion: '1.0.0',
    idempotencyKey,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    payload: { sourceVersionId, requestId },
  });

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

  it('persists separate re-extraction epochs for one SourceVersion and converges replay', async () => {
    const storage = new InMemoryAssetStorage();
    const provider = new FakeAIProviderAdapter();
    const kernel = await createHarness(storage, provider);
    const command = directTextCommand('stage4-postgres-reextract', 'Milo weighs 5 kg.');

    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const historical = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    await kernel.connector.sendCommand(
      reextractCommand(command, sourceVersionId, 'R2', 'postgres-reextract-r2'),
    );
    const afterR2 = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;
    expect(afterR2).toHaveLength(2);
    expect(afterR2[0]!.candidateId).not.toBe(afterR2[1]!.candidateId);
    expect(afterR2[0]!.batchId).not.toBe(afterR2[1]!.batchId);

    await kernel.connector.sendCommand(
      reextractCommand(command, sourceVersionId, 'R2', 'postgres-reextract-r2-replay'),
    );
    expect(provider.calls()).toBe(2);

    const durable = await pool!.query<{
      source_versions: string;
      batches: string;
      candidates: string;
      materializations: string;
      provider_calls: string;
    }>(`
      SELECT
        (SELECT count(DISTINCT source_version_id) FROM candidate.batches)::text AS source_versions,
        (SELECT count(*) FROM candidate.batches)::text AS batches,
        (SELECT count(*) FROM candidate.claim_candidates)::text AS candidates,
        (SELECT count(*) FROM candidate.materializations)::text AS materializations,
        (SELECT count(*) FROM ai.provider_calls)::text AS provider_calls
    `);
    expect(durable.rows[0]).toEqual({
      source_versions: '1',
      batches: '2',
      candidates: '2',
      materializations: '2',
      provider_calls: '2',
    });
    expect(historical[0]!.candidateId).toBeDefined();
    await kernel.shutdown();
  });

  it('does not reclaim terminal failures after restart, but preserves retryable reclaim', async () => {
    const repository = new PostgresAIProviderCallRepository(pool!);
    const baseRecord = (requestId: string): AIProviderExecutionRecord => ({
      callId: randomUUID(),
      requestId,
      projectId: 'stage4-retry-contract-postgres',
      sourceVersionId: randomUUID(),
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'direct-claim-v1',
      policyVersion: 'direct-only-v1',
      schemaName: 'ClaimCandidateBatch.v1',
      dataClassification: 'private',
      accessScope: ['owner'],
      sensitivity: 'private',
      inputEvidenceIds: [randomUUID()],
      inputSnapshotDigest: `snapshot-${requestId}`,
      requestDigest: `request-${requestId}`,
      state: 'REQUESTED',
      status: 'failed',
      maxAttempts: 2,
      attempts: [],
      createdAt: new Date().toISOString(),
    });

    const terminalRequestId = 'terminal-restart-request';
    const retryableRequestId = 'retryable-restart-request';
    try {
      for (const requestId of [terminalRequestId, retryableRequestId]) {
        await repository.ensure(baseRecord(requestId));
        const first = await repository.claimNextAttempt(
          'stage4-retry-contract-postgres',
          requestId,
        );
        expect(first).toBeDefined();
        await repository.failAttempt(
          'stage4-retry-contract-postgres',
          requestId,
          first!.attempt.attemptId,
          requestId === terminalRequestId ? 'CONFIGURATION_REQUIRED' : 'TIMEOUT',
        );
      }

      // A new repository instance models process restart/recovery; the
      // decision must come from durable attempt evidence, not process state.
      const recoveredRepository = new PostgresAIProviderCallRepository(pool!);
      await expect(
        recoveredRepository.claimNextAttempt('stage4-retry-contract-postgres', terminalRequestId),
      ).resolves.toBeUndefined();
      const retry = await recoveredRepository.claimNextAttempt(
        'stage4-retry-contract-postgres',
        retryableRequestId,
      );
      expect(retry).toBeDefined();
      expect(retry!.attempt.attemptNumber).toBe(2);
      expect(retry!.record.requestId).toBe(retryableRequestId);
    } finally {
      await pool!.query('DELETE FROM ai.provider_calls WHERE project_id = $1', [
        'stage4-retry-contract-postgres',
      ]);
    }
  });
});
