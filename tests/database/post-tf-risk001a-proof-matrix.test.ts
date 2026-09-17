import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  PostgresSourcesStage3AtomicPersistence,
  PostgresSourcesStage3ProgressRepository,
  PostgresSourcesStage4ContinuationStore,
} from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import {
  PostgresAIProviderCallRepository,
  PostgresCandidateRepository,
} from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewV2Repository,
  PostgresComparisonV2Repository,
} from '../../adapters/postgres-stage5/src/index.js';
import type { CandidateBatch } from '../../modules/candidate-generation/src/index.js';
import type {
  AIProviderCall,
  AIProviderOutput,
  ClaimCandidate,
  DraftChangeSetV2,
} from '../../packages/contracts/src/index.js';
import {
  draftChangeSetContentDigestV2,
  sha256Text,
  stableJson,
} from '../../packages/contracts/src/index.js';
import type { AIProviderExecutionRecord } from '../../modules/ai-provider/src/index.js';
import type {
  ComparisonV2ReviewDecisionWrite,
  OperationResolutionV2,
  ReviewOperationResolutionWrite,
} from '../../modules/change-set-review/src/index.js';
import { createAdr163ReviewFixture } from '../helpers/adr163-review-fixture.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

type CommitAckLossTrace = {
  commitAttempts: number;
  commitSucceeded: boolean;
  acknowledgementLost: boolean;
  postCommitRollbackAttempts: number;
  productionReconciliationReadbacks: number;
  testVerificationReadbacks: number;
};

const createCommitAckLossPool = (
  realPool: Pool,
): { readonly pool: Pool; readonly trace: CommitAckLossTrace } => {
  const trace: CommitAckLossTrace = {
    commitAttempts: 0,
    commitSucceeded: false,
    acknowledgementLost: false,
    postCommitRollbackAttempts: 0,
    productionReconciliationReadbacks: 0,
    testVerificationReadbacks: 0,
  };
  const faultPool = {
    query: async (sql: string, values?: readonly unknown[]) => {
      if (trace.commitSucceeded && trace.acknowledgementLost) {
        trace.productionReconciliationReadbacks += 1;
      }
      return values === undefined ? realPool.query(sql) : realPool.query(sql, [...values]);
    },
    connect: async (): Promise<PoolClient> => {
      const realClient = await realPool.connect();
      const client = {
        query: async (sql: string, values?: readonly unknown[]) => {
          const command = sql.trim().toUpperCase();
          if (command === 'COMMIT') {
            trace.commitAttempts += 1;
            await realClient.query('COMMIT');
            trace.commitSucceeded = true;
            trace.acknowledgementLost = true;
            throw new Error('synthetic commit acknowledgement loss');
          }
          if (command === 'ROLLBACK' && trace.commitSucceeded) {
            trace.postCommitRollbackAttempts += 1;
          }
          return values === undefined ? realClient.query(sql) : realClient.query(sql, [...values]);
        },
        release: () => realClient.release(),
      };
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;
  return { pool: faultPool, trace };
};

const testVerificationReadback = (trace: CommitAckLossTrace): void => {
  trace.testVerificationReadbacks += 1;
};

const expectAckLossTrace = (
  trace: CommitAckLossTrace,
  expectedPostCommitRollbackAttempts = 1,
): void => {
  expect(trace).toMatchObject({
    commitAttempts: 1,
    commitSucceeded: true,
    acknowledgementLost: true,
    postCommitRollbackAttempts: expectedPostCommitRollbackAttempts,
    testVerificationReadbacks: 1,
  });
};

const expectSafeAckLossTrace = (trace: CommitAckLossTrace): void => {
  expectAckLossTrace(trace);
  expect(trace.productionReconciliationReadbacks).toBe(0);
};

const expectCorrectedAckLossTrace = (trace: CommitAckLossTrace): void => {
  expectAckLossTrace(trace, 0);
  expect(trace.productionReconciliationReadbacks).toBeGreaterThan(0);
};

const createPreCommitDatabaseErrorPool = (
  realPool: Pool,
  code: string,
): { readonly pool: Pool } => {
  let injected = false;
  const faultPool = {
    query: async (sql: string, values?: readonly unknown[]) =>
      values === undefined ? realPool.query(sql) : realPool.query(sql, [...values]),
    connect: async (): Promise<PoolClient> => {
      const realClient = await realPool.connect();
      const client = {
        query: async (sql: string, values?: readonly unknown[]) => {
          const command = sql.trim().toUpperCase();
          if (!injected && command !== 'BEGIN') {
            injected = true;
            const error = new Error('synthetic pre-COMMIT database failure') as Error & {
              code?: string;
            };
            error.code = code;
            throw error;
          }
          return values === undefined ? realClient.query(sql) : realClient.query(sql, [...values]);
        },
        release: () => realClient.release(),
      };
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;
  return { pool: faultPool };
};

const seedMaterialized = async (prefix: string) => {
  const projectId = `${prefix}-${randomUUID()}`;
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const assetId = randomUUID();
  const now = '2026-09-17T08:00:00.000Z';
  const content = `POST-TF proof fixture ${projectId}`;
  const contentHash = sha256Text(content);
  await pool.query(
    `INSERT INTO asset.original_assets
       (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, 1, $3, $4)`,
    [assetId, contentHash, `${prefix}/${assetId}`, now],
  );
  await pool.query(
    `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    [sourceId, projectId, `${prefix}-test`, now],
  );
  await pool.query(
    `INSERT INTO asset.source_versions (
       source_version_id, source_id, version_number, original_asset_id,
       media_type, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'public', $4)`,
    [sourceVersionId, sourceId, assetId, now],
  );
  await pool.query(
    `INSERT INTO source_product.source_stage3_progress
       (project_id, source_id, source_version_id, state, created_at, updated_at)
     VALUES ($1, $2, $3, 'MATERIALIZED', $4, $4)`,
    [projectId, sourceId, sourceVersionId, now],
  );
  return { projectId, sourceId, sourceVersionId, assetId, content, contentHash, now };
};

const seedContinuation = async (prefix: string) => {
  const ids = await seedMaterialized(prefix);
  const revisionId = randomUUID();
  const indexingResultId = randomUUID();
  const continuationId = randomUUID();
  const digest = sha256Text(`${prefix}:${ids.projectId}`);
  await pool.query(
    `INSERT INTO transformation.revisions (
       revision_id, project_id, source_id, source_version_id, source_content_hash,
       transformer_id, transformer_version, document_ir, source_map, document_hash,
       source_map_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, 'post-tf-proof', '1', '{}'::jsonb, '{}'::jsonb,
               $5, $5, '{owner}', 'public', $6)`,
    [revisionId, ids.projectId, ids.sourceId, ids.sourceVersionId, digest, ids.now],
  );
  await pool.query(
    `INSERT INTO evidence.indexing_results (
       indexing_result_id, project_id, source_id, source_version_id, revision_id,
       transformer_id, transformer_version, status, evidence_count, reused_count,
       evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'post-tf-proof', '1', 'INDEXED', 1, 0,
               $6, 'stage3-evidence-index.v1', $6, $7, $7)`,
    [
      indexingResultId,
      ids.projectId,
      ids.sourceId,
      ids.sourceVersionId,
      revisionId,
      digest,
      ids.now,
    ],
  );
  await pool.query(
    `INSERT INTO evidence.stage4_continuations (
       continuation_id, project_id, source_id, source_version_id, revision_id,
       indexing_result_id, continuation_key, evidence_snapshot, evidence_set_digest,
       evidence_count, access_scope, sensitivity, data_classification, state,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, '[]'::jsonb, $8,
               1, '{owner}', 'public', 'source-content', 'PENDING', $9, $9)`,
    [
      continuationId,
      ids.projectId,
      ids.sourceId,
      ids.sourceVersionId,
      revisionId,
      indexingResultId,
      `post-tf:${continuationId}`,
      digest,
      ids.now,
    ],
  );
  return { ...ids, revisionId, indexingResultId, continuationId };
};

const cleanupSource = async (
  ids: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly assetId: string;
  },
  options: { readonly preserveProviderHistory?: boolean } = {},
) => {
  await pool.query('DELETE FROM review.decisions_v2 WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM review.approved_manifests_v2 WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM review.operation_resolutions_v2 WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM review.change_set_revisions_v2 WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM review.change_sets_v2 WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM comparison.relationships_v2 WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM comparison.results_v2 WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM comparison.analysis_revisions_v2 WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM candidate.materializations WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM candidate.claim_candidates WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM candidate.batches WHERE project_id = $1', [ids.projectId]);
  if (!options.preserveProviderHistory) {
    await pool.query('DELETE FROM ai.provider_outputs WHERE project_id = $1', [ids.projectId]);
    await pool.query(
      'DELETE FROM ai.provider_attempts WHERE call_id IN (SELECT call_id FROM ai.provider_calls WHERE project_id = $1)',
      [ids.projectId],
    );
    await pool.query('DELETE FROM ai.provider_calls WHERE project_id = $1', [ids.projectId]);
  }
  await pool.query('DELETE FROM evidence.stage4_continuations WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM source_product.source_stage3_progress WHERE project_id = $1', [
    ids.projectId,
  ]);
  await pool.query('DELETE FROM evidence.indexing_results WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM evidence.spans WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM transformation.attempts WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM transformation.revisions WHERE project_id = $1', [ids.projectId]);
  await pool.query('DELETE FROM asset.source_versions WHERE source_version_id = $1', [
    ids.sourceVersionId,
  ]);
  await pool.query('DELETE FROM asset.sources WHERE source_id = $1', [ids.sourceId]);
  await pool.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [ids.assetId]);
};

const cleanupSourceWithoutProviderHistory = async (ids: {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly assetId: string;
}) => cleanupSource(ids, { preserveProviderHistory: true });

const makeAIRecord = (projectId: string, requestId: string): AIProviderExecutionRecord => ({
  callId: randomUUID(),
  requestId,
  projectId,
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
  inputSnapshotDigest: sha256Text(`snapshot:${requestId}`),
  requestDigest: sha256Text(`request:${requestId}`),
  state: 'REQUESTED',
  status: 'failed',
  maxAttempts: 2,
  attempts: [],
  createdAt: '2026-09-17T08:00:00.000Z',
});

const makeProviderCall = (
  record: AIProviderExecutionRecord,
  attempts: AIProviderCall['attempts'],
  adapterVersion = 'post-tf-adapter',
): AIProviderCall => ({
  callId: record.callId,
  requestId: record.requestId,
  taskProfile: 'candidate-extraction',
  schemaName: 'ClaimCandidateBatch.v1',
  provider: record.provider,
  adapterVersion,
  model: record.model,
  modelVersion: 'post-tf-model',
  promptVersion: record.promptVersion,
  policyVersion: record.policyVersion,
  dataPolicyVersion: 'post-tf-data-policy',
  dataClassification: record.dataClassification,
  inputEvidenceIds: record.inputEvidenceIds,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  cost: { currency: 'USD', status: 'estimated', amountMicros: 0 },
  attempts,
  structuredOutputValid: true,
  createdAt: record.createdAt,
});

const makeProviderOutput = (
  record: AIProviderExecutionRecord,
  attemptId: string,
): AIProviderOutput => {
  const rawText = '{"candidates":[]}';
  return {
    outputId: randomUUID(),
    projectId: record.projectId,
    callId: record.callId,
    attemptId,
    envelopeVersion: 'ai-provider-output-v1',
    provider: record.provider,
    adapterVersion: 'post-tf-adapter',
    model: record.model,
    schemaName: 'ClaimCandidateBatch.v1',
    schemaVersion: '1.0.0',
    promptVersion: record.promptVersion,
    policyVersion: record.policyVersion,
    dataPolicyVersion: 'post-tf-data-policy',
    rawText,
    contentDigest: sha256Text(rawText),
    requestDigest: record.requestDigest,
    inputSnapshotDigest: record.inputSnapshotDigest,
    providerResponseId: 'post-tf-provider-response',
    modelVersion: 'post-tf-model',
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    cost: { currency: 'USD', status: 'estimated', amountMicros: 0 },
    receivedAt: '2026-09-17T08:00:01.000Z',
  };
};

const makeCandidateBatch = (ids: Awaited<ReturnType<typeof seedMaterialized>>): CandidateBatch => {
  const record = makeAIRecord(ids.projectId, `candidate:${randomUUID()}`);
  const call = makeProviderCall(record, []);
  const evidenceId = randomUUID();
  const candidate: ClaimCandidate = {
    candidateId: randomUUID(),
    batchId: randomUUID(),
    revisionNumber: 1,
    projectId: ids.projectId,
    sourceVersionId: ids.sourceVersionId,
    claimText: 'POST-TF candidate fixture.',
    evidenceIds: [evidenceId],
    evidenceMode: 'DIRECT_EVIDENCE',
    extractionProfile: 'direct-only',
    status: 'PENDING_VALIDATION',
    providerCall: call,
    accessScope: ['owner'],
    sensitivity: 'public',
    createdAt: ids.now,
  };
  return {
    batchId: candidate.batchId,
    projectId: ids.projectId,
    sourceVersionId: ids.sourceVersionId,
    idempotencyKey: `post-tf-batch:${randomUUID()}`,
    providerCall: call,
    candidates: [candidate],
    createdAt: ids.now,
  };
};

const seedStage5Fixture = async (prefix: string) => {
  const ids = await seedMaterialized(prefix);
  const fixture = createAdr163ReviewFixture({
    suffix: `${prefix}-${randomUUID()}`,
    projectId: ids.projectId,
    candidateId: randomUUID(),
    batchId: randomUUID(),
    evidenceId: randomUUID(),
    sourceVersionId: ids.sourceVersionId,
    claimText: 'POST-TF Stage 5 review fixture.',
  });
  const revisionId = randomUUID();
  const claimHash = sha256Text(fixture.candidate.claimText);
  await pool.query(
    `INSERT INTO transformation.revisions (
       revision_id, project_id, source_id, source_version_id, source_content_hash,
       transformer_id, transformer_version, document_ir, source_map, document_hash,
       source_map_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, 'post-tf-proof', '1', '{}'::jsonb, '{}'::jsonb,
               $5, $5, '{owner}', 'private', $6)`,
    [revisionId, ids.projectId, ids.sourceId, ids.sourceVersionId, ids.contentHash, ids.now],
  );
  await pool.query(
    `INSERT INTO evidence.spans (
       evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
       node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, '/claim', 'sentence', 'source',
               '{"start":0,"end":1}', $6::jsonb, $7, '{owner}', 'private', $8)`,
    [
      fixture.candidate.evidenceIds[0],
      revisionId,
      ids.projectId,
      ids.sourceId,
      ids.sourceVersionId,
      JSON.stringify({ text: fixture.candidate.claimText }),
      claimHash,
      ids.now,
    ],
  );
  await pool.query(
    `INSERT INTO candidate.batches (
       batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      fixture.candidate.batchId,
      ids.projectId,
      ids.sourceVersionId,
      `post-tf-stage5:${fixture.candidate.batchId}`,
      JSON.stringify(fixture.candidate.providerCall),
      ids.now,
    ],
  );
  await pool.query(
    `INSERT INTO candidate.claim_candidates (
       candidate_id, batch_id, project_id, source_version_id, revision_number,
       claim_text, evidence_id, evidence_mode, extraction_profile, status,
       provider_call, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE',
               'direct-only', 'READY', $7, '{owner}', 'private', $8)`,
    [
      fixture.candidate.candidateId,
      fixture.candidate.batchId,
      ids.projectId,
      ids.sourceVersionId,
      fixture.candidate.claimText,
      fixture.candidate.evidenceIds[0],
      JSON.stringify(fixture.candidate.providerCall),
      ids.now,
    ],
  );
  return { ...ids, fixture };
};

const updatedDraft = (
  draft: DraftChangeSetV2,
  status: DraftChangeSetV2['status'],
  revisionNumber = draft.revisionNumber,
  updatedAt = '2026-09-17T08:00:02.000Z',
): DraftChangeSetV2 => {
  const { contentDigest: _contentDigest, ...withoutDigest } = draft;
  void _contentDigest;
  const next = { ...withoutDigest, status, revisionNumber, updatedAt };
  return { ...next, contentDigest: draftChangeSetContentDigestV2(next) };
};

const makeResolution = (
  currentDraft: DraftChangeSetV2,
  resolvedDraft: DraftChangeSetV2,
): OperationResolutionV2 => {
  const identity = `post-tf-resolution:${randomUUID()}`;
  return {
    resolutionId: randomUUID(),
    contractVersion: 'review-operation-resolution.v1',
    projectId: currentDraft.projectId,
    changeSetId: currentDraft.changeSetId,
    sourceDraftRevision: currentDraft.revisionNumber,
    sourceDraftDigest: currentDraft.contentDigest,
    resolvedDraftRevision: resolvedDraft.revisionNumber,
    resolvedDraftDigest: resolvedDraft.contentDigest,
    resolvedDraftMaterialDigest: sha256Text(`material:${identity}`),
    comparisonId: currentDraft.comparisonId,
    comparisonDigest: currentDraft.comparisonDigest,
    candidateId: currentDraft.candidate.id,
    candidateRevision: currentDraft.candidate.revision,
    candidateDigest: currentDraft.candidate.digest,
    candidateSourceVersionId: currentDraft.candidate.sourceVersionId,
    candidateEvidenceIds: currentDraft.candidate.evidenceIds,
    canonicalSnapshotId: currentDraft.canonicalSnapshot.id,
    canonicalVersion: currentDraft.canonicalSnapshot.version,
    canonicalDigest: currentDraft.canonicalSnapshot.digest,
    shortlistDigest: currentDraft.shortlistDigest,
    analysisRevisionIds: currentDraft.analysisRevisionIds,
    relationshipIds: currentDraft.relationshipIds,
    relationshipMaterialDigests: [],
    accessRevision: 'post-tf-access:1',
    policyContextRevision: 'post-tf-policy:1',
    resolverActorId: 'post-tf-proof-user',
    clientRequestId: `${identity}:client`,
    semanticCommandIdentity: `${identity}:semantic`,
    idempotencyKey: `${identity}:idempotency`,
    commandDigest: sha256Text(`${identity}:command`),
    resolutionDigest: sha256Text(`${identity}:resolution`),
    chosenOperation: 'NO_OP',
    state: 'RESOLVED',
    createdAt: '2026-09-17T08:00:02.000Z',
  };
};

describe('POST-TF RISK-001A authority-critical commit ambiguity proof matrix', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('Stage 3 progress claim: reconciles a committed claim after ACK loss', async () => {
    const ids = await seedMaterialized('post-tf-s3-claim');
    try {
      const injected = createCommitAckLossPool(pool);
      const repository = new PostgresSourcesStage3ProgressRepository(injected.pool);
      const claim = await repository.claim({
        ...ids,
        workerId: 'post-tf-s3-claim-worker',
        leaseDurationMs: 30_000,
        now: ids.now,
      });
      expect(claim.status).toBe('CLAIMED');
      if (claim.status !== 'CLAIMED') return;
      const row = await pool.query<{
        state: string;
        attempt_count: number;
        lease_owner: string | null;
        lease_token: string | null;
        fencing_token: string;
      }>(
        `SELECT state, attempt_count, lease_owner, lease_token, fencing_token::text
           FROM source_product.source_stage3_progress
         WHERE project_id = $1 AND source_version_id = $2`,
        [ids.projectId, ids.sourceVersionId],
      );
      testVerificationReadback(injected.trace);
      expect(row.rows[0]).toMatchObject({
        state: 'STAGE3_RUNNING',
        attempt_count: 1,
        lease_owner: 'post-tf-s3-claim-worker',
        lease_token: claim.lease.leaseToken,
        fencing_token: String(claim.lease.fencingToken),
      });
      await expect(
        new PostgresSourcesStage3ProgressRepository(pool).claim({
          ...ids,
          workerId: 'post-tf-s3-claim-worker',
          leaseDurationMs: 30_000,
          now: ids.now,
        }),
      ).resolves.toEqual({ status: 'DEFERRED', reason: 'ACTIVE_LEASE' });
      expectCorrectedAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 3 atomic persistence: reconciles all authorities after ACK loss', async () => {
    const ids = await seedMaterialized('post-tf-s3-atomic');
    try {
      const cleanProgress = new PostgresSourcesStage3ProgressRepository(pool);
      const claim = await cleanProgress.claim({
        ...ids,
        workerId: 'post-tf-s3-atomic-worker',
        leaseDurationMs: 30_000,
        now: ids.now,
      });
      expect(claim.status).toBe('CLAIMED');
      if (claim.status !== 'CLAIMED') return;
      const transformer = new LucasAugmentedPlainTextAdapter();
      const output = transformer.transform({
        sourceId: ids.sourceId,
        sourceVersionId: ids.sourceVersionId,
        sourceContentHash: ids.contentHash,
        mediaType: 'text/plain',
        text: ids.content,
      });
      const input = {
        lease: claim.lease,
        transformation: {
          projectId: ids.projectId,
          sourceId: ids.sourceId,
          sourceVersionId: ids.sourceVersionId,
          sourceContentHash: ids.contentHash,
          transformer: transformer.identity,
          output,
          accessScope: ['owner'],
          sensitivity: 'public' as const,
          createdAt: ids.now,
        },
        locator: transformer,
        continuation: {
          projectId: ids.projectId,
          sourceId: ids.sourceId,
          sourceVersionId: ids.sourceVersionId,
          revisionId: 'filled-by-atomic-persistence',
          evidenceCount: 0,
          reusedCount: 0,
          accessScope: ['owner'],
          sensitivity: 'public' as const,
          dataClassification: 'source-content',
        },
      };
      const injected = createCommitAckLossPool(pool);
      const persisted = await new PostgresSourcesStage3AtomicPersistence(injected.pool).persist(
        input,
      );
      expect(persisted.saved.revision.sourceVersionId).toBe(ids.sourceVersionId);
      expect(persisted.indexingResultId).toBeDefined();
      const attempt = await pool.query<{
        attempt_id: string;
        project_id: string;
        source_version_id: string;
        transformer_id: string;
        transformer_version: string;
        revision_id: string;
        reused_revision: boolean;
      }>(
        `SELECT attempt_id::text, project_id, source_version_id::text,
                transformer_id, transformer_version, revision_id::text, reused_revision
           FROM transformation.attempts
          WHERE attempt_id = $1`,
        [persisted.saved.attemptId],
      );
      testVerificationReadback(injected.trace);
      expect(attempt.rows[0]).toEqual({
        attempt_id: persisted.saved.attemptId,
        project_id: persisted.saved.revision.projectId,
        source_version_id: persisted.saved.revision.sourceVersionId,
        transformer_id: persisted.saved.revision.transformer.id,
        transformer_version: persisted.saved.revision.transformer.version,
        revision_id: persisted.saved.revision.revisionId,
        reused_revision: persisted.saved.reusedRevision,
      });
      const counts = await pool.query<{
        attempts: string;
        revisions: string;
        evidence: string;
        indexing: string;
        continuations: string;
        state: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM transformation.attempts WHERE project_id = $1 AND source_version_id = $2) AS attempts,
           (SELECT count(*)::text FROM transformation.revisions WHERE project_id = $1 AND source_version_id = $2) AS revisions,
           (SELECT count(*)::text FROM evidence.spans WHERE project_id = $1 AND source_version_id = $2) AS evidence,
           (SELECT count(*)::text FROM evidence.indexing_results WHERE project_id = $1 AND source_version_id = $2) AS indexing,
           (SELECT count(*)::text FROM evidence.stage4_continuations WHERE project_id = $1 AND source_version_id = $2) AS continuations,
           (SELECT state FROM source_product.source_stage3_progress WHERE project_id = $1 AND source_version_id = $2) AS state`,
        [ids.projectId, ids.sourceVersionId],
      );
      expect(counts.rows[0]).toMatchObject({
        attempts: '1',
        revisions: '1',
        evidence: '3',
        indexing: '1',
        continuations: '1',
        state: 'STAGE3_COMPLETED',
      });
      await expect(
        new PostgresSourcesStage3AtomicPersistence(pool).persist(input),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expectCorrectedAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 3 continuation claim: reconciles a committed claim after ACK loss', async () => {
    const ids = await seedContinuation('post-tf-s3-continuation');
    try {
      const injected = createCommitAckLossPool(pool);
      const claim = await new PostgresSourcesStage4ContinuationStore(injected.pool).claimNext({
        workerId: 'post-tf-s3-continuation-worker',
        leaseDurationMs: 30_000,
        now: ids.now,
      });
      expect(claim.status).toBe('CLAIMED');
      if (claim.status !== 'CLAIMED') return;
      const row = await pool.query<{
        state: string;
        attempt_count: number;
        lease_owner: string | null;
        lease_token: string | null;
        fencing_token: string;
      }>(
        `SELECT state, attempt_count, lease_owner, lease_token, fencing_token::text
           FROM evidence.stage4_continuations
          WHERE continuation_id = $1`,
        [ids.continuationId],
      );
      testVerificationReadback(injected.trace);
      expect(row.rows[0]).toMatchObject({
        state: 'RUNNING',
        attempt_count: 1,
        lease_owner: 'post-tf-s3-continuation-worker',
        lease_token: claim.leaseToken,
        fencing_token: String(claim.fencingToken),
      });
      await expect(
        new PostgresSourcesStage4ContinuationStore(pool).claimNext({
          workerId: 'post-tf-s3-continuation-worker',
          leaseDurationMs: 30_000,
          now: ids.now,
        }),
      ).resolves.toEqual({ status: 'EMPTY' });
      expectCorrectedAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 4 ensure: exact retry converges to the committed provider call', async () => {
    const ids = await seedMaterialized('post-tf-s4-ensure');
    const record = makeAIRecord(ids.projectId, `ensure:${randomUUID()}`);
    try {
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresAIProviderCallRepository(injected.pool).ensure(record),
      ).rejects.toThrow('synthetic commit acknowledgement loss');
      testVerificationReadback(injected.trace);
      expect(
        await new PostgresAIProviderCallRepository(pool).findByRequestId(
          ids.projectId,
          record.requestId,
        ),
      ).toEqual(record);
      expect(await new PostgresAIProviderCallRepository(pool).ensure(record)).toEqual(record);
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 4 provider claim: reconciles a committed attempt after ACK loss', async () => {
    const ids = await seedMaterialized('post-tf-s4-claim');
    const record = makeAIRecord(ids.projectId, `claim:${randomUUID()}`);
    try {
      const clean = new PostgresAIProviderCallRepository(pool);
      await clean.ensure(record);
      const injected = createCommitAckLossPool(pool);
      const claimed = await new PostgresAIProviderCallRepository(injected.pool).claimNextAttempt(
        ids.projectId,
        record.requestId,
      );
      expect(claimed).toBeDefined();
      if (!claimed) return;
      const durable = await clean.findByRequestId(ids.projectId, record.requestId);
      testVerificationReadback(injected.trace);
      expect(durable?.state).toBe('PROVIDER_RUNNING');
      expect(durable?.attempts).toHaveLength(1);
      expect(claimed.record).toEqual(durable);
      expect(claimed.attempt).toEqual(durable?.attempts[0]);
      await expect(
        clean.claimNextAttempt(ids.projectId, record.requestId),
      ).resolves.toBeUndefined();
      expectCorrectedAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 4 provider outcome-unknown: exact retry returns the same safe durable state', async () => {
    const ids = await seedMaterialized('post-tf-s4-unknown');
    const record = makeAIRecord(ids.projectId, `unknown:${randomUUID()}`);
    try {
      const clean = new PostgresAIProviderCallRepository(pool);
      await clean.ensure(record);
      const claimed = await clean.claimNextAttempt(ids.projectId, record.requestId);
      expect(claimed).toBeDefined();
      if (!claimed) return;
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresAIProviderCallRepository(injected.pool).markAttemptOutcomeUnknown(
          ids.projectId,
          record.requestId,
          claimed.attempt.attemptId,
        ),
      ).rejects.toThrow('synthetic commit acknowledgement loss');
      const durable = await clean.findByRequestId(ids.projectId, record.requestId);
      testVerificationReadback(injected.trace);
      expect(durable?.state).toBe('OUTCOME_UNKNOWN');
      expect(durable?.attempts[0]?.status).toBe('outcome_unknown');
      expect(
        (
          await clean.markAttemptOutcomeUnknown(
            ids.projectId,
            record.requestId,
            claimed.attempt.attemptId,
          )
        ).state,
      ).toBe('OUTCOME_UNKNOWN');
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 4 provider output acceptance: exact retry is idempotent after durable acceptance', async () => {
    const ids = await seedMaterialized('post-tf-s4-accept');
    const record = makeAIRecord(ids.projectId, `accept:${randomUUID()}`);
    try {
      const clean = new PostgresAIProviderCallRepository(pool);
      await clean.ensure(record);
      const claimed = await clean.claimNextAttempt(ids.projectId, record.requestId);
      expect(claimed).toBeDefined();
      if (!claimed) return;
      const output = makeProviderOutput(record, claimed.attempt.attemptId);
      await clean.storeOutput(ids.projectId, record.requestId, output);
      const call = makeProviderCall(
        record,
        claimed.record.attempts.map((attempt) => ({
          ...attempt,
          status: 'succeeded' as const,
          providerResponseId: output.providerResponseId,
          latencyMs: 1,
        })),
      );
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresAIProviderCallRepository(injected.pool).acceptOutput(
          ids.projectId,
          record.requestId,
          output.outputId,
          call,
        ),
      ).rejects.toThrow('synthetic commit acknowledgement loss');
      const durable = await clean.findByRequestId(ids.projectId, record.requestId);
      testVerificationReadback(injected.trace);
      expect(durable?.state).toBe('OUTPUT_MATERIALIZED');
      expect(durable?.output?.outputId).toBe(output.outputId);
      expect(
        (await clean.acceptOutput(ids.projectId, record.requestId, output.outputId, call)).output
          ?.outputId,
      ).toBe(output.outputId);
      expectSafeAckLossTrace(injected.trace);
    } finally {
      // Provider output provenance is append-only by contract. Leave this
      // uniquely identified proof history in the isolated db-test database.
      await cleanupSourceWithoutProviderHistory(ids);
    }
  });

  it('Stage 4 candidate batch persistence: exact retry converges without duplicate candidates', async () => {
    const ids = await seedMaterialized('post-tf-s4-batch');
    const batch = makeCandidateBatch(ids);
    try {
      const revisionId = randomUUID();
      const evidenceId = batch.candidates[0]!.evidenceIds[0];
      await pool.query(
        `INSERT INTO transformation.revisions (
           revision_id, project_id, source_id, source_version_id, source_content_hash,
           transformer_id, transformer_version, document_ir, source_map, document_hash,
           source_map_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'post-tf-proof', '1', '{}'::jsonb, '{}'::jsonb,
                   $5, $5, '{owner}', 'public', $6)`,
        [revisionId, ids.projectId, ids.sourceId, ids.sourceVersionId, ids.contentHash, ids.now],
      );
      await pool.query(
        `INSERT INTO evidence.spans (
           evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
           node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, '/post-tf-candidate', 'sentence', 'source',
                   '{"start":0,"end":1}', '{"text":"POST-TF candidate fixture."}'::jsonb,
                   $6, '{owner}', 'public', $7)`,
        [
          evidenceId,
          revisionId,
          ids.projectId,
          ids.sourceId,
          ids.sourceVersionId,
          sha256Text('POST-TF candidate fixture.'),
          ids.now,
        ],
      );
      const injected = createCommitAckLossPool(pool);
      await expect(new PostgresCandidateRepository(injected.pool).saveBatch(batch)).rejects.toThrow(
        'synthetic commit acknowledgement loss',
      );
      const clean = new PostgresCandidateRepository(pool);
      testVerificationReadback(injected.trace);
      expect(await clean.findBatchByIdempotencyKey(ids.projectId, batch.idempotencyKey)).toEqual(
        batch,
      );
      expect(await clean.saveBatch(batch)).toEqual(batch);
      const count = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM candidate.claim_candidates WHERE project_id = $1 AND batch_id = $2',
        [ids.projectId, batch.batchId],
      );
      expect(count.rows[0]?.count).toBe('1');
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 5 Draft persistence: exact retry converges to the committed Draft', async () => {
    const ids = await seedStage5Fixture('post-tf-s5-draft');
    try {
      await new PostgresComparisonV2Repository(pool).saveCompletedAggregate(ids.fixture.aggregate);
      const repository = new PostgresChangeSetReviewV2Repository(pool);
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresChangeSetReviewV2Repository(injected.pool).saveDraft(ids.fixture.draft),
      ).rejects.toThrow('synthetic commit acknowledgement loss');
      testVerificationReadback(injected.trace);
      expect(await repository.findDraftById(ids.projectId, ids.fixture.draft.changeSetId)).toEqual(
        ids.fixture.draft,
      );
      expect(await repository.saveDraft(ids.fixture.draft)).toEqual(ids.fixture.draft);
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 5 stale transition: reconciles a committed STALE state after ACK loss', async () => {
    const ids = await seedStage5Fixture('post-tf-s5-stale');
    try {
      const repository = new PostgresChangeSetReviewV2Repository(pool);
      await new PostgresComparisonV2Repository(pool).saveCompletedAggregate(ids.fixture.aggregate);
      await repository.saveDraft(ids.fixture.draft);
      const injected = createCommitAckLossPool(pool);
      const stale = await new PostgresChangeSetReviewV2Repository(injected.pool).markStaleIfCurrent(
        {
          projectId: ids.projectId,
          changeSetId: ids.fixture.draft.changeSetId,
          expectedRevisionNumber: ids.fixture.draft.revisionNumber,
          expectedContentDigest: ids.fixture.draft.contentDigest,
          updatedAt: '2026-09-17T08:00:03.000Z',
        },
      );
      const durable = await repository.findDraftById(ids.projectId, ids.fixture.draft.changeSetId);
      testVerificationReadback(injected.trace);
      expect(durable?.status).toBe('STALE');
      expect(stale).toEqual(durable);
      await expect(
        repository.markStaleIfCurrent({
          projectId: ids.projectId,
          changeSetId: ids.fixture.draft.changeSetId,
          expectedRevisionNumber: ids.fixture.draft.revisionNumber,
          expectedContentDigest: ids.fixture.draft.contentDigest,
          updatedAt: '2026-09-17T08:00:03.000Z',
        }),
      ).rejects.toMatchObject({ code: 'STALE_VERSION' });
      expectCorrectedAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 5 stale transition: preserves database error mapping before COMMIT', async () => {
    const ids = await seedStage5Fixture('post-tf-s5-stale-db-error');
    try {
      const repository = new PostgresChangeSetReviewV2Repository(pool);
      await new PostgresComparisonV2Repository(pool).saveCompletedAggregate(ids.fixture.aggregate);
      await repository.saveDraft(ids.fixture.draft);
      const injected = createPreCommitDatabaseErrorPool(pool, '23505');
      await expect(
        new PostgresChangeSetReviewV2Repository(injected.pool).markStaleIfCurrent({
          projectId: ids.projectId,
          changeSetId: ids.fixture.draft.changeSetId,
          expectedRevisionNumber: ids.fixture.draft.revisionNumber,
          expectedContentDigest: ids.fixture.draft.contentDigest,
          updatedAt: '2026-09-17T08:00:03.000Z',
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        operation: 'mark-review-draft-v2-stale',
      });
      expect(await repository.findDraftById(ids.projectId, ids.fixture.draft.changeSetId)).toEqual(
        ids.fixture.draft,
      );
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 5 operation resolution: exact retry returns IDEMPOTENT_REPLAY after durable resolution', async () => {
    const ids = await seedStage5Fixture('post-tf-s5-resolve');
    try {
      const repository = new PostgresChangeSetReviewV2Repository(pool);
      await new PostgresComparisonV2Repository(pool).saveCompletedAggregate(ids.fixture.aggregate);
      await repository.saveDraft(ids.fixture.draft);
      const resolvedDraft = updatedDraft(ids.fixture.draft, 'PENDING_REVIEW', 2);
      const resolution = makeResolution(ids.fixture.draft, resolvedDraft);
      const write: ReviewOperationResolutionWrite = {
        currentDraft: ids.fixture.draft,
        resolvedDraft,
        resolution,
      };
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresChangeSetReviewV2Repository(injected.pool).resolveOperation(write),
      ).rejects.toThrow('synthetic commit acknowledgement loss');
      const durable = await repository.findDraftById(ids.projectId, ids.fixture.draft.changeSetId);
      testVerificationReadback(injected.trace);
      expect(durable).toEqual(resolvedDraft);
      expect(
        await repository.findOperationResolutionByClientRequest(
          ids.projectId,
          resolution.clientRequestId,
          resolution.semanticCommandIdentity,
        ),
      ).toEqual(resolution);
      expect((await repository.resolveOperation(write)).status).toBe('IDEMPOTENT_REPLAY');
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 5 review decision: exact retry returns the committed decision and Draft', async () => {
    const ids = await seedStage5Fixture('post-tf-s5-decision');
    try {
      const repository = new PostgresChangeSetReviewV2Repository(pool);
      await new PostgresComparisonV2Repository(pool).saveCompletedAggregate(ids.fixture.aggregate);
      await repository.saveDraft(ids.fixture.draft);
      const updated = updatedDraft(ids.fixture.draft, 'APPROVED');
      const write: ComparisonV2ReviewDecisionWrite = {
        projectId: ids.projectId,
        changeSetId: ids.fixture.draft.changeSetId,
        expectedRevisionNumber: ids.fixture.draft.revisionNumber,
        expectedContentDigest: ids.fixture.draft.contentDigest,
        decision: {
          decisionId: randomUUID(),
          decision: 'APPROVE',
          actor: { type: 'user', id: 'post-tf-proof-user' },
          reason: 'POST-TF ACK-loss proof.',
          decidedAt: '2026-09-17T08:00:02.000Z',
        },
        updated,
      };
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresChangeSetReviewV2Repository(injected.pool).recordDecision(write),
      ).rejects.toThrow('synthetic commit acknowledgement loss');
      const durable = await repository.findDecisionById(ids.projectId, write.decision.decisionId);
      testVerificationReadback(injected.trace);
      expect(durable?.draft).toEqual(updated);
      expect(durable?.decision).toEqual(write.decision);
      expect((await repository.recordDecision(write)).decision).toEqual(write.decision);
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });

  it('Stage 5 Comparison V2 aggregate: exact retry converges after a durable aggregate commit', async () => {
    const ids = await seedStage5Fixture('post-tf-s5-aggregate');
    try {
      const repository = new PostgresComparisonV2Repository(pool);
      const injected = createCommitAckLossPool(pool);
      await expect(
        new PostgresComparisonV2Repository(injected.pool).saveCompletedAggregate(
          ids.fixture.aggregate,
        ),
      ).rejects.toThrow();
      const durable = await repository.findComparisonById(
        ids.projectId,
        ids.fixture.aggregate.comparison.comparisonId,
      );
      testVerificationReadback(injected.trace);
      expect(stableJson(durable)).toBe(stableJson(ids.fixture.aggregate));
      expect(stableJson(await repository.saveCompletedAggregate(ids.fixture.aggregate))).toBe(
        stableJson(ids.fixture.aggregate),
      );
      expectSafeAckLossTrace(injected.trace);
    } finally {
      await cleanupSource(ids);
    }
  });
});
