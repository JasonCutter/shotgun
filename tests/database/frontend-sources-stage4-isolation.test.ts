import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import {
  PostgresCandidateRepository,
  PostgresValidationRepository,
  PostgresAIProviderCallRepository,
} from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { SourcesStage3TestPipeline } from '../../adapters/sources-stage3-pipeline/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createAIProviderModule,
  type AIProviderAdapterPort,
} from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import type {
  SourcesStage3PipelinePort,
  SourcesStage4ContinuationPort,
} from '../../modules/frontend-sources-write/src/index.js';
import type {
  SourcesProductWriteScope,
  SubmitSourcesProductInput,
} from '../../modules/frontend-sources-write/src/product-service.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import type { AIExecutionIdentity } from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const hash = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const insertAcceptedCommand = async (input: {
  readonly commandId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly now: string;
}) => {
  await pool!.query(
    `INSERT INTO frontend_command.command_ledger (
       command_id, command_revision, client_request_id, idempotency_key,
       principal_id, envelope_version, scope_kind, active_project_id,
       target_project_id, resource_project_id, scope_binding_key,
       command_type, command_schema_version, command_semantic_digest,
       policy_binding, accepted_principal_context, accepted_project_context,
       accepted_policy_context, preconditions, command_payload, outcome_state,
       completion_disposition, produced_resources, rejection, correlation_id,
       trace_id, received_at, accepted_at, completed_at, last_updated_at
     ) VALUES (
       $1, 1, $2, $3, $4, '2.0.0', 'PROJECT', $5, $5, NULL, $6,
       'sources.intake.submit.v1', '1.0.0', $7, $8::jsonb, $9::jsonb,
       $10::jsonb, $11::jsonb, '[]'::jsonb, $12::jsonb, 'ACCEPTED',
       NULL, '[]'::jsonb, NULL, $13, $14, $15, $15, NULL, $15
     )`,
    [
      input.commandId,
      `client-${input.commandId}`,
      `idempotency-${input.commandId}`,
      input.principalId,
      input.projectId,
      JSON.stringify({ envelopeVersion: '2.0.0', scope: 'PROJECT', projectId: input.projectId }),
      hash(`command-${input.commandId}`),
      JSON.stringify({ mode: 'CURRENT' }),
      JSON.stringify({ principalId: input.principalId }),
      JSON.stringify({ activeProjectId: input.projectId, targetProjectId: input.projectId }),
      JSON.stringify({ policyContextId: `policy/${input.projectId}`, policyContextRevision: '1' }),
      JSON.stringify({ draftId: 'stage4-isolation-draft', inputs: [] }),
      `correlation-${input.commandId}`,
      `trace-${input.commandId}`,
      input.now,
    ],
  );
};

const createContext = async () => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `stage4-isolation-${randomUUID()}`;
  const now = new Date().toISOString();
  await pool!.query(
    `INSERT INTO auth.principals (
       principal_id, actor_type, status, account_id, created_at
     ) VALUES ($1, 'user', 'active', $2, $3)`,
    [principalId, `stage4-isolation-owner-${principalId}`, now],
  );
  await pool!.query(
    `INSERT INTO project_admin.projects (
       id, name, status, active, created_at, updated_at, revision
     ) VALUES ($1, 'Stage 4 Isolation Test Project', 'ACTIVE', true, $2, $2, 1)`,
    [projectId, now],
  );
  await pool!.query(
    `INSERT INTO auth.project_memberships (
       principal_id, project_id, scopes, sensitivity_clearance, is_owner
     ) VALUES ($1, $2, '{owner}', 'private', true)`,
    [principalId, projectId],
  );
  await pool!.query(
    `INSERT INTO auth.sessions (
       session_id, token_hash, csrf_hash, principal_id, active_project_id,
       expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      hash(`session-${sessionId}`),
      hash(`csrf-${sessionId}`),
      principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
      now,
    ],
  );
  const scope: SourcesProductWriteScope = {
    principalId,
    sessionId,
    projectId,
    principalAccessScopes: ['owner'],
    sensitivityClearance: 'private',
    resourceSecurityPolicy: {
      allowedClassifications: ['public', 'internal', 'private'],
      resourceAccessScope: ['owner'],
    },
    accessRevision: `${projectId}:owner`,
    policyContextRevision: '1',
    acceptedPolicyContextId: `policy/${projectId}`,
    acceptedPolicyBinding: { mode: 'CURRENT', policyContextRevision: '1' },
  };
  return { principalId, sessionId, projectId, now, scope };
};

const prepareSubmission = async (
  context: Awaited<ReturnType<typeof createContext>>,
  storage: InMemoryAssetStorage,
  text: string,
): Promise<{
  readonly input: SubmitSourcesProductInput;
  readonly staging: SealedSourcesStagingService;
}> => {
  const commandId = randomUUID();
  const submissionId = randomUUID();
  await insertAcceptedCommand({
    commandId,
    principalId: context.principalId,
    projectId: context.projectId,
    now: context.now,
  });
  const staging = new SealedSourcesStagingService(
    storage,
    'stage4-isolation-staging-secret-32-characters',
    undefined,
    () => new Date(context.now),
  );
  const itemId = randomUUID();
  const receipt = await staging.stageBytes({
    draftId: 'stage4-isolation-draft',
    itemId,
    projectId: context.projectId,
    principalId: context.principalId,
    kind: 'DIRECT_TEXT',
    label: 'Stage 4 isolation source',
    mediaType: 'text/plain',
    bytes: new TextEncoder().encode(text),
  });
  const artifact = await staging.resolve({
    stagingReference: receipt.stagingReference,
    draftId: 'stage4-isolation-draft',
    itemId,
    projectId: context.projectId,
    principalId: context.principalId,
    kind: 'DIRECT_TEXT',
  });
  return {
    staging,
    input: {
      submissionId,
      commandId,
      correlationId: `correlation-${commandId}`,
      draftId: 'stage4-isolation-draft',
      scope: context.scope,
      items: [{ ...artifact, requestedClassification: 'public' }],
      createdAt: context.now,
    },
  };
};

const createStage3Pipeline = (
  storage: InMemoryAssetStorage,
  stage4?: SourcesStage4ContinuationPort,
): SourcesStage3TestPipeline => {
  const transformer = new LucasAugmentedPlainTextAdapter();
  return new SourcesStage3TestPipeline({
    storage,
    transformer,
    locator: transformer,
    transformationRepository: new PostgresTransformationRepository(pool!),
    evidenceRepository: new PostgresEvidenceRepository(pool!),
    ...(stage4 === undefined ? {} : { stage4 }),
  });
};

const stage4Identity: AIExecutionIdentity = {
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  aiConfigurationRevision: 1,
  credentialId: 'stage4-isolation-credential',
  credentialRevision: 1,
  policyContextRevision: 'stage4-isolation-policy-1',
  providerPolicyFingerprint: 'stage4-isolation-fingerprint',
};

const createStage4Harness = async (options: { readonly enabled: boolean }) => {
  const transformer = new LucasAugmentedPlainTextAdapter();
  const evidenceRepository = new PostgresEvidenceRepository(pool!);
  const transformationRepository = new PostgresTransformationRepository(pool!);
  const aiRepository = new PostgresAIProviderCallRepository(pool!);
  const candidateRepository = new PostgresCandidateRepository(pool!);
  const validationRepository = new PostgresValidationRepository(pool!);
  let providerCalls = 0;
  const provider: AIProviderAdapterPort = {
    identity: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      adapterVersion: 'stage4-isolation-test-v1',
      dataPolicyVersion: 'stage4-isolation-policy-v1',
    },
    async generateStructured(request) {
      providerCalls += 1;
      const prompt = JSON.parse(request.prompt) as {
        readonly evidence?: readonly { readonly evidenceId: string; readonly text: string }[];
      };
      const first = prompt.evidence?.[0];
      return {
        rawText: JSON.stringify({
          candidates: first ? [{ claimText: first.text, evidenceId: first.evidenceId }] : [],
        }),
        providerResponseId: `stage4-isolation-response-${providerCalls}`,
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18,
      };
    },
  };
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createOriginalAssetModule(new InMemoryOriginalAssetRepository(), new InMemoryAssetStorage()),
    createTransformationModule(transformationRepository, transformer),
    createEvidenceModule(evidenceRepository, transformer),
    createAIProviderModule(
      aiRepository,
      provider,
      { allowPrivate: true, allowRestricted: false, maxAttempts: 2 },
      {
        executionResolver: {
          resolve: async () => ({ adapter: provider, executionIdentity: stage4Identity }),
        },
      },
    ),
    createCandidateGenerationModule(candidateRepository),
    createValidationModule(validationRepository),
  );
  await kernel.start();

  const publishEvidenceIndexed = async (input: {
    readonly projectId: string;
    readonly sourceVersionId: string;
    readonly revisionId: string;
    readonly evidenceCount: number;
    readonly reusedCount: number;
    readonly accessScope: readonly string[];
    readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
    readonly dataClassification: string;
  }) => {
    const delivery = await kernel.connector.publishEvent({
      messageId: randomUUID(),
      messageType: 'EvidenceIndexed',
      messageKind: 'event',
      schemaVersion: '1.0.0',
      producerModule: 'sources-stage3-pipeline',
      producerVersion: '1.0.0',
      correlationId: `sources-stage3:${input.projectId}:${input.sourceVersionId}`,
      projectId: input.projectId,
      actor: { type: 'service', id: 'sources-stage3-pipeline' },
      security: {
        accessScope: [...input.accessScope],
        sensitivity: input.sensitivity,
        dataClassification: input.dataClassification,
      },
      idempotencyKey: `evidence-indexed:${input.projectId}:${input.revisionId}`,
      payload: {
        revisionId: input.revisionId,
        sourceVersionId: input.sourceVersionId,
        evidenceCount: input.evidenceCount,
        reusedCount: input.reusedCount,
      },
      createdAt: new Date().toISOString(),
      traceId: randomUUID(),
    });
    const failed = delivery.consumers.find((consumer) => consumer.status === 'dead-letter');
    if (failed) throw new Error(`Stage 4 consumer dead-lettered: ${failed.consumerId}`);
  };

  return {
    aiRepository,
    candidateRepository,
    validationRepository,
    providerCalls: () => providerCalls,
    onEvidenceIndexed: async (input: Parameters<typeof publishEvidenceIndexed>[0]) => {
      if (!options.enabled) return;
      await publishEvidenceIndexed(input);
    },
    async close() {
      await kernel.shutdown();
    },
  };
};

class GenuineStage3Failure implements SourcesStage3PipelinePort {
  async runForSourceVersion(
    _input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0],
  ): Promise<Awaited<ReturnType<SourcesStage3PipelinePort['runForSourceVersion']>>> {
    void _input;
    throw new Error('genuine transformation failure');
  }
}

afterAll(async () => {
  await pool?.end();
});

describe.runIf(pool)('Source Product / Stage 4 failure isolation', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        validation.results,
        candidate.materializations,
        candidate.claim_candidates,
        candidate.batches,
        ai.provider_outputs,
        ai.provider_attempts,
        ai.provider_calls,
        evidence.spans,
        transformation.attempts,
        transformation.revisions,
        source_product.url_provenance_receipts,
        source_product.url_acquisition_attempts,
        source_product.exact_duplicate_dispositions,
        source_product.exact_duplicate_decisions,
        source_product.intake_attempts,
        source_product.intake_submission_items,
        source_product.intake_submissions,
        asset.storage_receipts,
        asset.source_versions,
        asset.sources,
        asset.original_assets,
        intake.submissions,
        frontend_command.command_ledger,
        project_admin.project_revisions,
        project_admin.projects,
        auth.audit_events,
        auth.sessions,
        auth.project_memberships,
        auth.credentials,
        auth.principals
      CASCADE
    `);
  });

  it('keeps Source success after Stage 4 failure and does not retry it on replay', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    let continuationFailures = 0;
    const pipeline = createStage3Pipeline(storage, {
      onEvidenceIndexed: async () => {
        continuationFailures += 1;
        throw new Error('provider unavailable');
      },
    });
    const prepared = await prepareSubmission(
      context,
      storage,
      'Evidence survives provider failure.',
    );
    const service = new PostgresSourcesProductService(pool!, prepared.staging, pipeline);

    const first = await service.submit(prepared.input);
    expect(first.state).toBe('SUCCEEDED');
    const produced = first.items[0]?.producedResource;
    expect(produced?.sourceVersionId).toBeTruthy();
    const sourceVersionId = produced!.sourceVersionId;
    expect(
      Number(
        (
          await pool!.query(
            'SELECT count(*)::text AS count FROM evidence.spans WHERE project_id = $1 AND source_version_id = $2',
            [context.projectId, sourceVersionId],
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        (
          await pool!.query(
            'SELECT count(*)::text AS count FROM candidate.claim_candidates WHERE project_id = $1 AND source_version_id = $2',
            [context.projectId, sourceVersionId],
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBe(0);

    const replay = await service.submit(prepared.input);
    expect(replay.state).toBe('SUCCEEDED');
    expect(continuationFailures).toBe(1);
  });

  it('keeps Source success and makes zero AI calls when Standing Policy is off', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const harness = await createStage4Harness({ enabled: false });
    try {
      const pipeline = createStage3Pipeline(storage, harness);
      const prepared = await prepareSubmission(context, storage, 'Policy-off source Evidence.');
      const service = new PostgresSourcesProductService(pool!, prepared.staging, pipeline);
      const result = await service.submit(prepared.input);
      const sourceVersionId = result.items[0]!.producedResource!.sourceVersionId;

      expect(result.state).toBe('SUCCEEDED');
      expect(harness.providerCalls()).toBe(0);
      expect(
        Number(
          (
            await pool!.query(
              'SELECT count(*)::text AS count FROM evidence.spans WHERE project_id = $1 AND source_version_id = $2',
              [context.projectId, sourceVersionId],
            )
          ).rows[0]?.count ?? 0,
        ),
      ).toBeGreaterThan(0);
      expect(
        Number(
          (
            await pool!.query(
              'SELECT count(*)::text AS count FROM candidate.claim_candidates WHERE project_id = $1 AND source_version_id = $2',
              [context.projectId, sourceVersionId],
            )
          ).rows[0]?.count ?? 0,
        ),
      ).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it('keeps genuine Transformation failure retryable as OUTCOME_INDETERMINATE', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const prepared = await prepareSubmission(
      context,
      storage,
      'Transformation fails before Evidence.',
    );
    const service = new PostgresSourcesProductService(
      pool!,
      prepared.staging,
      new GenuineStage3Failure(),
    );

    await expect(service.submit(prepared.input)).rejects.toThrow('genuine transformation failure');
    const result = await service.getSubmission(context.scope, prepared.input.submissionId);
    expect(result?.state).toBe('OUTCOME_INDETERMINATE');
  });

  it('keeps normal Stage 4 success downstream-owned and idempotent on Source replay', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const harness = await createStage4Harness({ enabled: true });
    try {
      const pipeline = createStage3Pipeline(storage, harness);
      const prepared = await prepareSubmission(
        context,
        storage,
        'A direct claim survives validation.',
      );
      const service = new PostgresSourcesProductService(pool!, prepared.staging, pipeline);
      const result = await service.submit(prepared.input);
      const sourceVersionId = result.items[0]!.producedResource!.sourceVersionId;
      const beforeReplay = await pool!.query<{
        batches: string;
        candidates: string;
        calls: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM candidate.batches WHERE project_id = $1 AND source_version_id = $2) AS batches,
           (SELECT count(*)::text FROM candidate.claim_candidates WHERE project_id = $1 AND source_version_id = $2) AS candidates,
           (SELECT count(*)::text FROM ai.provider_calls WHERE project_id = $1 AND source_version_id = $2) AS calls`,
        [context.projectId, sourceVersionId],
      );
      const candidate = (
        await harness.candidateRepository.listBySourceVersion(context.projectId, sourceVersionId)
      )[0];
      const validation = candidate
        ? await harness.validationRepository.findByCandidateId(
            context.projectId,
            candidate.candidateId,
          )
        : undefined;

      expect(result.state).toBe('SUCCEEDED');
      expect(harness.providerCalls()).toBe(1);
      expect(candidate?.status).toBe('READY');
      expect(validation?.status).toBe('READY');
      expect(candidate?.providerCall.provider).toBe('deepseek');
      expect(candidate?.providerCall.model).toBe('deepseek-v4-flash');

      const replay = await service.submit(prepared.input);
      const afterReplay = await pool!.query<{ batches: string; candidates: string; calls: string }>(
        `SELECT
           (SELECT count(*)::text FROM candidate.batches WHERE project_id = $1 AND source_version_id = $2) AS batches,
           (SELECT count(*)::text FROM candidate.claim_candidates WHERE project_id = $1 AND source_version_id = $2) AS candidates,
           (SELECT count(*)::text FROM ai.provider_calls WHERE project_id = $1 AND source_version_id = $2) AS calls`,
        [context.projectId, sourceVersionId],
      );
      expect(replay.state).toBe('SUCCEEDED');
      expect(afterReplay.rows[0]).toEqual(beforeReplay.rows[0]);
      expect(harness.providerCalls()).toBe(1);
    } finally {
      await harness.close();
    }
  });
});
