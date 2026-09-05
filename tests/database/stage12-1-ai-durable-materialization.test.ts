import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Focused Stage 12.1 durability recovery contracts.

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
import { runAIDurableMaterializationRecovery } from '../../assemblies/shotgun-app/src/server.js';
import {
  createAIProviderModule,
  type AIProviderExecutionRecord,
} from '../../modules/ai-provider/src/index.js';
import {
  createCandidateGenerationModule,
  type CandidateRepositoryPort,
} from '../../modules/candidate-generation/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import {
  type AIProviderOutput,
  type AIProviderOutputReference,
  type ClaimCandidate,
  createChildQuery,
  createCommand,
  type EvidenceSpan,
  type GeneratedClaim,
  ShotgunError,
  ShotgunKernel,
} from '../../packages/kernel/src/index.js';
import { evidenceListQuery, evidenceQuery } from '../helpers/stage-3.js';
import { candidatesQuery, directTextCommand, intakeResultQuery } from '../helpers/stage-4.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

class StoreFailingPostgresAIProviderCallRepository extends PostgresAIProviderCallRepository {
  private shouldFail = true;

  override async storeOutput(
    projectId: string,
    requestId: string,
    output: AIProviderOutput,
  ): Promise<AIProviderExecutionRecord> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'The test Output store is unavailable.',
        module: 'stage12-1-test',
        operation: 'store-provider-output',
        retryable: true,
      });
    }
    return super.storeOutput(projectId, requestId, output);
  }
}

type HarnessOptions = {
  readonly aiRepository?: PostgresAIProviderCallRepository;
  readonly candidateRepository?: CandidateRepositoryPort | false;
};

const createHarness = async (
  storage: InMemoryAssetStorage,
  provider: FakeAIProviderAdapter,
  options: HarnessOptions = {},
) => {
  const aiRepository = options.aiRepository ?? new PostgresAIProviderCallRepository(pool!);
  const candidateRepository =
    options.candidateRepository === undefined
      ? new PostgresCandidateRepository(pool!)
      : options.candidateRepository;
  const kernel = new ShotgunKernel(new InProcessTransport());
  const text = new LucasAugmentedPlainTextAdapter();
  const baseModules = [
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), text),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), text),
    createAIProviderModule(aiRepository, provider, {
      allowPrivate: true,
      allowRestricted: false,
      maxAttempts: 2,
    }),
  ] as const;
  if (candidateRepository) {
    kernel.register(
      ...baseModules,
      createCandidateGenerationModule(candidateRepository),
      createValidationModule(new PostgresValidationRepository(pool!)),
    );
  } else {
    kernel.register(...baseModules);
  }
  await kernel.start();
  return { kernel, aiRepository };
};

const resetDatabase = async () => {
  await pool!
    .query(`TRUNCATE validation.results, candidate.materializations, candidate.claim_candidates,
      candidate.batches, ai.provider_outputs, ai.provider_attempts, ai.provider_calls, evidence.spans,
      transformation.attempts, transformation.revisions, intake.submissions, asset.storage_receipts,
      asset.source_versions, asset.sources, asset.original_assets CASCADE`);
};

const prepareGeneration = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  requestId: string,
) => {
  const command = directTextCommand(requestId, 'Milo weighs 5 kg.');
  await harness.kernel.connector.sendCommand(command);
  const sourceVersionId = (
    await harness.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
  ).result.payload.sourceVersionId;
  const summaries = (
    await harness.kernel.connector.query<{
      items: readonly { readonly evidenceId: string; readonly nodeKind: string }[];
    }>(evidenceListQuery(command, sourceVersionId))
  ).result.payload.items.filter((item) => item.nodeKind === 'sentence');
  const evidence = await Promise.all(
    summaries.map(
      async (item) =>
        (
          await harness.kernel.connector.query<EvidenceSpan>(
            evidenceQuery(command, item.evidenceId),
          )
        ).result.payload,
    ),
  );
  return {
    command,
    sourceVersionId,
    requestId: `${command.projectId}:${sourceVersionId}:candidate-extraction:direct-claim-v1:direct-only-v1`,
    evidence,
  };
};

type GeneratedOutput = {
  readonly candidates: readonly GeneratedClaim[];
  readonly output: AIProviderOutputReference;
};

const generateStructured = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  prepared: Awaited<ReturnType<typeof prepareGeneration>>,
) =>
  await harness.kernel.connector.query<GeneratedOutput>(
    createChildQuery(prepared.command, {
      messageType: 'GenerateStructured',
      schemaVersion: '1.0.0',
      producerModule: 'stage12-1-test',
      producerVersion: '1.0.0',
      payload: {
        requestId: prepared.requestId,
        taskProfile: 'candidate-extraction',
        schemaName: 'ClaimCandidateBatch.v1',
        policyVersion: 'direct-only-v1',
        dataClassification: prepared.command.security!.dataClassification,
        sourceVersionId: prepared.sourceVersionId,
        accessScope: prepared.command.security!.accessScope,
        sensitivity: prepared.command.security!.sensitivity,
        evidence: prepared.evidence.map((item) => ({
          evidenceId: item.evidenceId,
          text: item.quote.exact,
          exactHash: item.exactHash,
          revisionId: item.revisionId,
        })),
      },
    }),
  );

const resumeCommand = (record: AIProviderExecutionRecord) =>
  createCommand({
    messageType: 'ResumeCandidateMaterialization',
    schemaVersion: '1.0.0',
    producerModule: 'stage12-1-test',
    producerVersion: '1.0.0',
    idempotencyKey: `resume-candidate-materialization:${record.projectId}:${record.requestId}:${record.output?.outputId ?? 'missing'}`,
    projectId: record.projectId,
    actor: { type: 'service', id: 'stage12-1-test-recovery' },
    security: {
      accessScope: record.accessScope,
      sensitivity: record.sensitivity,
      dataClassification: record.dataClassification,
    },
    payload: { sourceVersionId: record.sourceVersionId, requestId: record.requestId },
  });

describe.runIf(pool)('Stage 12.1 durable AI materialization', () => {
  beforeEach(resetDatabase);
  afterAll(async () => await pool!.end());

  it('persists one completed materialization and reuses it on repeated delivery', async () => {
    const provider = new FakeAIProviderAdapter();
    const first = await createHarness(new InMemoryAssetStorage(), provider);
    const command = directTextCommand('stage12-durable-repeat', 'Milo weighs 5 kg.');
    await first.kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await first.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const firstBatch = await pool!.query<{ batch_id: string }>(
      `SELECT batch_id::text FROM candidate.batches`,
    );
    await first.kernel.connector.sendCommand(
      directTextCommand('stage12-durable-repeat', 'Milo weighs 5 kg.'),
    );
    const candidates = (
      await first.kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;
    const state = await pool!.query<{
      calls: string;
      accepted_outputs: string;
      materializations: string;
      completed_materializations: string;
      batches: string;
      candidates: string;
      durable_state: string;
      batch_id: string;
    }>(`SELECT
      (SELECT count(*)::text FROM ai.provider_calls) AS calls,
      (SELECT count(*)::text FROM ai.provider_calls WHERE accepted_output_id IS NOT NULL) AS accepted_outputs,
      (SELECT count(*)::text FROM candidate.materializations) AS materializations,
      (SELECT count(*)::text FROM candidate.materializations WHERE state = 'COMPLETED') AS completed_materializations,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates,
      (SELECT durable_state FROM ai.provider_calls) AS durable_state,
      (SELECT batch_id::text FROM candidate.batches) AS batch_id`);
    expect(provider.calls()).toBe(1);
    expect(candidates).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      calls: '1',
      accepted_outputs: '1',
      materializations: '1',
      completed_materializations: '1',
      batches: '1',
      candidates: '1',
      durable_state: 'COMPLETED',
      batch_id: firstBatch.rows[0]?.batch_id,
    });
    await first.kernel.shutdown();
  });

  it('recovers a genuinely stored accepted Output with no Candidate state', async () => {
    const first = await createHarness(new InMemoryAssetStorage(), new FakeAIProviderAdapter(), {
      candidateRepository: false,
    });
    const prepared = await prepareGeneration(first, 'stage12-output-only');
    const generated = (await generateStructured(first, prepared)).result.payload;
    const before = await pool!.query<{
      durable_state: string;
      accepted_output_id: string;
      materializations: string;
      batches: string;
      candidates: string;
    }>(`SELECT durable_state, accepted_output_id::text,
      (SELECT count(*)::text FROM candidate.materializations) AS materializations,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
      FROM ai.provider_calls`);
    expect(before.rows[0]).toMatchObject({
      durable_state: 'OUTPUT_MATERIALIZED',
      accepted_output_id: generated.output.outputId,
      materializations: '0',
      batches: '0',
      candidates: '0',
    });
    await first.kernel.shutdown();

    const recoveryProvider = new FakeAIProviderAdapter();
    const recovery = await createHarness(new InMemoryAssetStorage(), recoveryProvider);
    const recoveryResult = await runAIDurableMaterializationRecovery(
      recovery.aiRepository,
      recovery.kernel.connector,
    );
    const after = await pool!.query<{
      durable_state: string;
      accepted_output_id: string;
      materialization_state: string;
      batches: string;
      candidates: string;
    }>(`SELECT call.durable_state, call.accepted_output_id::text,
      (SELECT state FROM candidate.materializations) AS materialization_state,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
      FROM ai.provider_calls call`);
    expect(recoveryResult).toEqual({ attempted: 1, resumed: 1, failed: 0 });
    expect(recoveryProvider.calls()).toBe(0);
    expect(after.rows[0]).toMatchObject({
      durable_state: 'COMPLETED',
      accepted_output_id: generated.output.outputId,
      materialization_state: 'COMPLETED',
      batches: '1',
      candidates: '1',
    });
    await recovery.kernel.shutdown();
  });

  it('preserves pre-deployment request identity while resuming an incomplete durable request', async () => {
    const first = await createHarness(new InMemoryAssetStorage(), new FakeAIProviderAdapter(), {
      candidateRepository: false,
    });
    const prepared = await prepareGeneration(first, 'stage12-legacy-request-digest');
    await generateStructured(first, prepared);
    const record = (await first.aiRepository.list())[0]!;
    const historicalDigest = record.requestDigest;

    await pool!.query(
      'ALTER TABLE ai.provider_outputs DISABLE TRIGGER provider_outputs_append_only',
    );
    try {
      await pool!.query('BEGIN');
      await pool!.query(
        `UPDATE ai.provider_calls
         SET accepted_output_id = NULL, durable_state = 'REQUESTED', status = 'failed'
         WHERE project_id = $1 AND request_id = $2`,
        [record.projectId, record.requestId],
      );
      await pool!.query('DELETE FROM ai.provider_outputs');
      await pool!.query('DELETE FROM ai.provider_attempts');
      await pool!.query('COMMIT');
    } catch (error) {
      await pool!.query('ROLLBACK');
      throw error;
    } finally {
      await pool!.query(
        'ALTER TABLE ai.provider_outputs ENABLE TRIGGER provider_outputs_append_only',
      );
    }
    await first.kernel.shutdown();

    const recoveryProvider = new FakeAIProviderAdapter();
    const recovery = await createHarness(new InMemoryAssetStorage(), recoveryProvider);
    await recovery.kernel.connector.sendCommand(resumeCommand(record));

    const after = await pool!.query<{
      request_digest: string;
      durable_state: string;
      provider_calls: string;
      batches: string;
      candidates: string;
    }>(`SELECT request_digest, durable_state,
      (SELECT count(*)::text FROM ai.provider_calls) AS provider_calls,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
      FROM ai.provider_calls`);
    expect(after.rows[0]).toEqual({
      request_digest: historicalDigest,
      durable_state: 'COMPLETED',
      provider_calls: '1',
      batches: '1',
      candidates: '1',
    });
    expect(recoveryProvider.calls()).toBe(1);
    await recovery.kernel.shutdown();
  });

  it('recovers a failed Materialization by binding the existing Batch without Provider recall', async () => {
    const first = await createHarness(new InMemoryAssetStorage(), new FakeAIProviderAdapter());
    const command = directTextCommand('stage12-bind-existing', 'Milo weighs 5 kg.');
    await first.kernel.connector.sendCommand(command);
    const existing = await pool!.query<{
      call_id: string;
      batch_id: string;
      candidate_id: string;
      output_id: string;
    }>(`SELECT call.call_id::text, batch.batch_id::text, candidate.candidate_id::text,
      call.accepted_output_id::text AS output_id
      FROM candidate.batches batch
      JOIN candidate.claim_candidates candidate ON candidate.batch_id = batch.batch_id
      CROSS JOIN ai.provider_calls call`);
    await pool!.query(
      `UPDATE candidate.materializations
       SET state = 'MATERIALIZATION_FAILED', failure_code = 'RETRYABLE_DEPENDENCY', completed_at = NULL
       WHERE output_id = $1`,
      [existing.rows[0]?.output_id],
    );
    const record = (await first.aiRepository.list())[0]!;
    await first.aiRepository.failMaterialization(
      record.projectId,
      record.requestId,
      existing.rows[0]!.output_id,
      'RETRYABLE_DEPENDENCY',
    );
    const before = await pool!.query<{
      call_id: string;
      batch_id: string;
      candidate_id: string;
      output_id: string;
      materialization_state: string;
      durable_state: string;
      provider_status: string;
      provider_calls: string;
      materializations: string;
      batches: string;
      candidates: string;
    }>(`SELECT call.call_id::text, batch.batch_id::text, candidate.candidate_id::text,
      materialization.output_id::text, materialization.state AS materialization_state,
      call.durable_state, call.status AS provider_status,
      (SELECT count(*)::text FROM ai.provider_calls) AS provider_calls,
      (SELECT count(*)::text FROM candidate.materializations) AS materializations,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
      FROM candidate.batches batch
      JOIN candidate.claim_candidates candidate ON candidate.batch_id = batch.batch_id
      JOIN candidate.materializations materialization ON materialization.batch_id = batch.batch_id
      CROSS JOIN ai.provider_calls call`);
    expect(before.rows[0]).toMatchObject({
      call_id: existing.rows[0]?.call_id,
      batch_id: existing.rows[0]?.batch_id,
      candidate_id: existing.rows[0]?.candidate_id,
      output_id: existing.rows[0]?.output_id,
      materialization_state: 'MATERIALIZATION_FAILED',
      durable_state: 'MATERIALIZATION_FAILED',
      provider_status: 'failed',
      provider_calls: '1',
      materializations: '1',
      batches: '1',
      candidates: '1',
    });
    await first.kernel.shutdown();

    const recoveryProvider = new FakeAIProviderAdapter();
    const recovery = await createHarness(new InMemoryAssetStorage(), recoveryProvider);
    const recoveryResult = await runAIDurableMaterializationRecovery(
      recovery.aiRepository,
      recovery.kernel.connector,
    );
    const after = await pool!.query<{
      call_id: string;
      batch_id: string;
      candidate_id: string;
      output_id: string;
      materialization_state: string;
      durable_state: string;
      provider_status: string;
      provider_calls: string;
      materializations: string;
      batches: string;
      candidates: string;
    }>(`SELECT call.call_id::text, batch.batch_id::text, candidate.candidate_id::text,
      materialization.output_id::text, materialization.state AS materialization_state,
      call.durable_state, call.status AS provider_status,
      (SELECT count(*)::text FROM ai.provider_calls) AS provider_calls,
      (SELECT count(*)::text FROM candidate.materializations) AS materializations,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
      FROM candidate.batches batch
      JOIN candidate.claim_candidates candidate ON candidate.batch_id = batch.batch_id
      JOIN candidate.materializations materialization ON materialization.batch_id = batch.batch_id
      CROSS JOIN ai.provider_calls call`);
    expect(recoveryResult).toEqual({ attempted: 1, resumed: 1, failed: 0 });
    expect(recoveryProvider.calls()).toBe(0);
    expect(after.rows[0]).toMatchObject({
      call_id: existing.rows[0]?.call_id,
      batch_id: existing.rows[0]?.batch_id,
      candidate_id: existing.rows[0]?.candidate_id,
      output_id: existing.rows[0]?.output_id,
      materialization_state: 'COMPLETED',
      durable_state: 'COMPLETED',
      provider_status: 'succeeded',
      provider_calls: '1',
      materializations: '1',
      batches: '1',
      candidates: '1',
    });
    await recovery.kernel.shutdown();
  });

  it('persists only two clear retryable Provider failures and no generation products', async () => {
    const provider = new FakeAIProviderAdapter([
      { errorCode: 'TIMEOUT' },
      { errorCode: 'TIMEOUT' },
    ]);
    const harness = await createHarness(new InMemoryAssetStorage(), provider);
    await harness.kernel.connector.sendCommand(
      directTextCommand('stage12-durable-failure', 'Milo weighs 5 kg.'),
    );
    const state = await pool!.query<{
      durable_state: string;
      accepted_outputs: string;
      attempts: string;
      materializations: string;
      batches: string;
      candidates: string;
    }>(`SELECT durable_state,
      (SELECT count(*)::text FROM ai.provider_calls WHERE accepted_output_id IS NOT NULL) AS accepted_outputs,
      (SELECT count(*)::text FROM ai.provider_attempts) AS attempts,
      (SELECT count(*)::text FROM candidate.materializations) AS materializations,
      (SELECT count(*)::text FROM candidate.batches) AS batches,
      (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
      FROM ai.provider_calls`);
    expect(provider.calls()).toBe(2);
    expect(state.rows[0]).toMatchObject({
      durable_state: 'PROVIDER_FAILED',
      accepted_outputs: '0',
      attempts: '2',
      materializations: '0',
      batches: '0',
      candidates: '0',
    });
    await harness.kernel.shutdown();
  });

  it('fails closed when the persisted recovery authority is absent or corrupt', async () => {
    const cases = [
      'missing-reference',
      'content-digest',
      'input-snapshot-digest',
      'unsupported-envelope',
    ] as const;

    for (const corruption of cases) {
      await resetDatabase();
      const first = await createHarness(new InMemoryAssetStorage(), new FakeAIProviderAdapter(), {
        candidateRepository: false,
      });
      const prepared = await prepareGeneration(first, `stage12-corrupt-${corruption}`);
      await generateStructured(first, prepared);
      const record = (await first.aiRepository.list())[0]!;
      await first.kernel.shutdown();

      let envelopeConstraintDropped = false;
      try {
        if (corruption === 'missing-reference') {
          await pool!.query(`UPDATE ai.provider_calls SET accepted_output_id = NULL`);
        } else {
          await pool!.query(
            `ALTER TABLE ai.provider_outputs DISABLE TRIGGER provider_outputs_append_only`,
          );
          if (corruption === 'content-digest') {
            await pool!.query(`UPDATE ai.provider_outputs SET content_digest = $1`, [
              `sha256:${'0'.repeat(64)}`,
            ]);
          } else if (corruption === 'input-snapshot-digest') {
            await pool!.query(`UPDATE ai.provider_outputs SET input_snapshot_digest = $1`, [
              `sha256:${'1'.repeat(64)}`,
            ]);
          } else {
            await pool!.query(
              `ALTER TABLE ai.provider_outputs DROP CONSTRAINT provider_outputs_envelope_version_check`,
            );
            envelopeConstraintDropped = true;
            await pool!.query(
              `UPDATE ai.provider_outputs SET envelope_version = 'ai-provider-output-v0'`,
            );
          }
          await pool!.query(
            `ALTER TABLE ai.provider_outputs ENABLE TRIGGER provider_outputs_append_only`,
          );
        }

        const recoveryProvider = new FakeAIProviderAdapter();
        const recovery = await createHarness(new InMemoryAssetStorage(), recoveryProvider);
        try {
          await recovery.kernel.connector.sendCommand(resumeCommand(record));
        } catch {
          // The internal Resume command is expected to fail closed.
        }
        let replayError: unknown;
        try {
          await generateStructured(recovery, prepared);
        } catch (error) {
          replayError = error;
        }
        const after = await pool!.query<{
          durable_state: string;
          materializations: string;
          completed_materializations: string;
          candidates: string;
        }>(`SELECT durable_state,
          (SELECT count(*)::text FROM candidate.materializations) AS materializations,
          (SELECT count(*)::text FROM candidate.materializations WHERE state = 'COMPLETED') AS completed_materializations,
          (SELECT count(*)::text FROM candidate.claim_candidates) AS candidates
          FROM ai.provider_calls`);
        expect(recoveryProvider.calls(), corruption).toBe(0);
        expect(after.rows[0], corruption).toMatchObject({
          materializations: '0',
          completed_materializations: '0',
          candidates: '0',
        });
        expect(after.rows[0]?.durable_state, corruption).not.toBe('COMPLETED');
        expect(replayError, corruption).toBeInstanceOf(ShotgunError);
        const safeError = replayError as ShotgunError;
        expect(safeError.safeMessage, corruption).not.toContain(record.requestDigest);
        expect(safeError.safeMessage, corruption).not.toContain('Milo weighs 5 kg.');
        await recovery.kernel.shutdown();
      } finally {
        await pool!.query(
          `ALTER TABLE ai.provider_outputs ENABLE TRIGGER provider_outputs_append_only`,
        );
        if (envelopeConstraintDropped) {
          await resetDatabase();
          await pool!.query(
            `ALTER TABLE ai.provider_outputs ADD CONSTRAINT provider_outputs_envelope_version_check CHECK (envelope_version = 'ai-provider-output-v1')`,
          );
        }
      }
    }
  });

  it('does not recall the Provider after a response is followed by Output storage failure', async () => {
    const provider = new FakeAIProviderAdapter();
    const aiRepository = new StoreFailingPostgresAIProviderCallRepository(pool!);
    const harness = await createHarness(new InMemoryAssetStorage(), provider, {
      aiRepository,
      candidateRepository: false,
    });
    const prepared = await prepareGeneration(harness, 'stage12-store-failure');
    await expect(generateStructured(harness, prepared)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    await expect(generateStructured(harness, prepared)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    const state = await pool!.query<{
      durable_state: string;
      attempts: string;
      accepted_outputs: string;
      outputs: string;
    }>(`SELECT durable_state,
      (SELECT count(*)::text FROM ai.provider_attempts) AS attempts,
      (SELECT count(*)::text FROM ai.provider_calls WHERE accepted_output_id IS NOT NULL) AS accepted_outputs,
      (SELECT count(*)::text FROM ai.provider_outputs) AS outputs
      FROM ai.provider_calls`);
    expect(provider.calls()).toBe(1);
    expect(state.rows[0]).toMatchObject({
      durable_state: 'OUTCOME_UNKNOWN',
      attempts: '1',
      accepted_outputs: '0',
      outputs: '0',
    });
    await harness.kernel.shutdown();
  });
});
