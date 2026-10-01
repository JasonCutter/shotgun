import { createHash, randomUUID } from 'node:crypto';

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { expect, it, vi } from 'vitest';

import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { PostgresVPAskEvidenceSearch } from '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';
import {
  type VPDecisionExecutionRepositoryPort,
  VPRelationDecisionRouter,
  type VPDecisionProviderPort,
} from '../../modules/vp-decision/src/index.js';
import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import { vpRelationDecisionCorpus } from '../helpers/vp-relation-decision-corpus.js';
import { vpFinanceRelationCandidateCorpus } from '../helpers/vp-finance-relation-candidate.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { verifyVPProjectionReplay } from '../../scripts/vp-projection-replay.js';
import { dropIsolatedRestoreDatabase } from '../../scripts/backup-restore.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { initializeSourceErasureJournal } from '../../scripts/source-erasure-journal.js';
import {
  createDefaultOwnerDeps,
  runOwnerCreate,
  runOwnerRestoreSafe,
} from '../../scripts/backup-owner-core.js';

const hash = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

const canRunBackupAcceptance =
  Boolean(process.env.TEST_DATABASE_URL?.trim()) &&
  (process.env.SHOTGUN_PG_TOOL_MODE === 'docker-compose' ||
    process.env.CI === 'true' ||
    Boolean(process.env.PG_DUMP_BIN?.trim() && process.env.PG_RESTORE_BIN?.trim()));

const createCommitAckLossPool = (
  basePool: Pool,
  shouldLoseAcknowledgement: () => boolean,
  onLostAcknowledgement: () => void,
): Pool =>
  ({
    query: basePool.query.bind(basePool),
    connect: async (): Promise<PoolClient> => {
      const client = await basePool.connect();
      return {
        query: async <T extends QueryResultRow = QueryResultRow>(
          sql: string,
          values?: readonly unknown[],
        ) => {
          const result =
            values === undefined
              ? await client.query<T>(sql)
              : await client.query<T>(sql, values as never);
          if (sql.trim().toUpperCase() === 'COMMIT' && shouldLoseAcknowledgement()) {
            const error = new Error('Simulated lost PostgreSQL COMMIT acknowledgement.');
            onLostAcknowledgement();
            throw error;
          }
          return result;
        },
        release: (error?: Error) => client.release(error),
      } as unknown as PoolClient;
    },
  }) as unknown as Pool;

const seedAssertion = async (
  pool: Pool,
  input: {
    projectId: string;
    principalId: string;
    assertionId: string;
    text: string;
    sourceText?: string;
    assetRoot?: string;
  },
): Promise<void> => {
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const evidenceId = randomUUID();
  const candidateId = randomUUID();
  const batchId = randomUUID();
  const indexingId = randomUUID();
  const { projectId, principalId, assertionId, text } = input;
  const sourceText = input.sourceText ?? text;
  const storageKey = `vp-priority-${assetId}`;
  if (input.assetRoot) {
    await mkdir(input.assetRoot, { recursive: true });
    await writeFile(path.join(input.assetRoot, storageKey), sourceText);
  }
  await pool.query(
    `INSERT INTO asset.original_assets
       (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [assetId, hash(sourceText), Buffer.byteLength(sourceText), storageKey],
  );
  await pool.query(
    `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [sourceId, projectId, principalId],
  );
  await pool.query(
    `INSERT INTO asset.source_versions
       (source_version_id, source_id, version_number, original_asset_id,
        media_type, access_scope, sensitivity, created_at)
     VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'public', now())`,
    [sourceVersionId, sourceId, assetId],
  );
  await pool.query(
    `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', '{}'::jsonb,
             '{}'::jsonb, $6, $7, '{owner}', 'public', now())`,
    [
      revisionId,
      projectId,
      sourceId,
      sourceVersionId,
      hash(sourceText),
      hash(sourceText),
      hash(sourceId),
    ],
  );
  await pool.query(
    `INSERT INTO evidence.spans
       (evidence_id, revision_id, project_id, source_id, source_version_id,
        pointer, node_kind, origin, position, quote, exact_hash,
        access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, '/paragraph[1]/sentence[1]', 'sentence',
             'source', $6::jsonb, $7::jsonb, $8, '{owner}', 'public', now())`,
    [
      evidenceId,
      revisionId,
      projectId,
      sourceId,
      sourceVersionId,
      JSON.stringify({ start: 0, end: sourceText.length }),
      JSON.stringify({ exact: sourceText }),
      hash(sourceText),
    ],
  );
  await pool.query(
    `INSERT INTO evidence.indexing_results
       (indexing_result_id, project_id, source_id, source_version_id, revision_id,
        transformer_id, transformer_version, status, evidence_count, reused_count,
        evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', 'INDEXED', 1, 0,
             $6, 'stage3-evidence-index.v1', $7, now(), now())`,
    [
      indexingId,
      projectId,
      sourceId,
      sourceVersionId,
      revisionId,
      hash(evidenceId),
      hash('owner-public'),
    ],
  );
  await pool.query(
    `INSERT INTO source_product.source_stage3_progress
       (project_id, source_id, source_version_id, state, indexing_result_id,
        created_at, updated_at)
     VALUES ($1, $2, $3, 'STAGE3_COMPLETED', $4, now(), now())`,
    [projectId, sourceId, sourceVersionId, indexingId],
  );
  await pool.query(
    `INSERT INTO candidate.batches
       (batch_id, project_id, source_version_id, revision_id,
        idempotency_key, provider_call, created_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
    [batchId, projectId, sourceVersionId, revisionId, `vp-priority-${batchId}`],
  );
  await pool.query(
    `INSERT INTO candidate.claim_candidates
       (candidate_id, batch_id, project_id, source_version_id,
        revision_number, claim_text, evidence_id, evidence_mode,
        extraction_profile, status, provider_call, access_scope,
        sensitivity, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE',
             'direct-only', 'READY', '{}'::jsonb, '{owner}', 'public', now())`,
    [candidateId, batchId, projectId, sourceVersionId, text, evidenceId],
  );
  await pool.query(
    `INSERT INTO validation.results
       (validation_id, candidate_id, revision_number, project_id,
        source_version_id, status, dimensions, created_at)
     VALUES ($1, $2, 1, $3, $4, 'READY', '[]'::jsonb, now())`,
    [randomUUID(), candidateId, projectId, sourceVersionId],
  );
  await pool.query(
    `INSERT INTO vp.assertions
       (assertion_id, project_id, candidate_id, source_id, source_version_id,
        evidence_id, claim_text, origin, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'DIRECT_SOURCE', '{owner}', 'public', now())`,
    [assertionId, projectId, candidateId, sourceId, sourceVersionId, evidenceId, text],
  );
};

it('prioritizes the related cross-source pair before an older unrelated pair', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-priority-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-priority-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP relation priority',
      description: 'related pair before older unrelated pair',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const anchor = '00000000-0000-4000-8000-000000000001';
    const unrelated = '00000000-0000-4000-8000-000000000002';
    const related = '00000000-0000-4000-8000-000000000003';
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: anchor,
      text: '할인율이 높아지면 현재가치는 낮아진다.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: unrelated,
      text: '달빛 연구소에는 사과나무 세 그루가 있다.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: related,
      text: '같은 미래 현금흐름과 기간이 유지되면 할인율 상승은 현재가치를 낮춘다.',
      sourceText:
        '재무 계산의 전제입니다. '.repeat(180) +
        'NPV 공식에서 미래 현금흐름과 기간이 고정될 때 할인율이 높아질수록 현재가치는 낮아진다. ' +
        '같은 미래 현금흐름과 기간이 유지되면 할인율 상승은 현재가치를 낮춘다.',
    });
    const jobs = new PostgresVPRelationJobs(pool);
    const policyRevision = `vp-priority-${randomUUID()}`;
    expect(await jobs.enqueueCurrentPairs(policyRevision, 1)).toBe(1);
    const selected = await pool.query<{ left_assertion_id: string; right_assertion_id: string }>(
      `SELECT left_assertion_id::text, right_assertion_id::text
         FROM vp.relation_jobs WHERE project_id = $1`,
      [projectId],
    );
    expect(selected.rows).toEqual([{ left_assertion_id: anchor, right_assertion_id: related }]);
    let providerInput: Parameters<VPDecisionProviderPort['decideRelation']>[0] | undefined;
    const provider: VPDecisionProviderPort = {
      decideRelation: async (input) => {
        providerInput = input;
        return {
          choice: 'EQUIVALENT',
          confidence: 0.95,
          probabilities: {
            EQUIVALENT: 0.95,
            SUPPORTS: 0.01,
            QUALIFIES: 0.01,
            CONTRADICTS: 0.01,
            RELATED: 0.01,
            UNRESOLVED: 0.01,
          },
          deepAnalysisScore: 0,
          model: 'deepseek/test-model',
          inputTokens: 50,
          outputTokens: 10,
        };
      },
    };
    const worker = new VPRelationJobWorker(
      jobs,
      new VPRelationDecisionRouter(undefined, provider, {
        revision: policyRevision,
        minimumChoiceProbability: 0.9,
        maximumDeepAnalysisScore: 0,
        maximumInputTokens: 4_000,
        maximumOutputTokens: 256,
      }),
      async () => true,
      policyRevision,
    );
    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(providerInput?.left.text).toBe('할인율이 높아지면 현재가치는 낮아진다.');
    expect(providerInput?.left.evidenceContext).toBeUndefined();
    expect(providerInput?.right.evidenceContextTruncated).toBe(true);
    expect(Array.from(providerInput?.right.evidenceContext ?? '').length).toBeLessThanOrEqual(
      2_000,
    );
    expect(providerInput?.right.evidenceContext).toContain(
      '같은 미래 현금흐름과 기간이 유지되면 할인율 상승은 현재가치를 낮춘다.',
    );
  } finally {
    await database.dispose();
  }
}, 60_000);

it.runIf(canRunBackupAcceptance)(
  'restores VP source evidence and a pending relation job, then converges it once',
  async () => {
    const parentDatabaseUrl = await requireTestDatabaseTarget();
    const source = await createIsolatedPostgresTestDatabase();
    const sourcePool = source.createPool();
    let targetPool: Pool | undefined;
    let restoredTarget: Awaited<ReturnType<typeof runOwnerRestoreSafe>>['target'] | undefined;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-vp-restore-recovery-'));
    const journalRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-vp-restore-journal-'));
    const backupRoot = path.join(temporaryRoot, 'backups');
    const sourceAssetRoot = path.join(temporaryRoot, 'source-assets');
    const ownerDeps = {
      ...createDefaultOwnerDeps(),
      homedir: () => temporaryRoot,
    };
    const journalKey = randomUUID() + randomUUID();
    const priorJournalRoot = process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
    const priorJournalKey = process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
    let testFailed = false;
    let testFailure: unknown;
    let cleanupFailure: AggregateError | undefined;

    try {
      process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = journalRoot;
      process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = journalKey;
      await initializeSourceErasureJournal(
        { root: journalRoot, hmacKey: journalKey },
        temporaryRoot,
      );

      const projectId = `vp-backup-recovery-${randomUUID()}`;
      const principal = await new PostgresAuthRepository(sourcePool).bootstrapLocalOwnerPrincipal({
        accountId: `vp-backup-recovery-owner-${randomUUID()}`,
      });
      await new PostgresProjectAdministrationRepository(sourcePool).createProject({
        commandId: randomUUID(),
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectId,
        name: 'VP backup restore recovery',
        description: 'restore source evidence and pending relation work',
        actorPrincipalId: principal.principalId,
        expectedProjectRevision: 0,
      });

      const leftAssertionId = randomUUID();
      const rightAssertionId = randomUUID();
      const leftText = '할인율이 높아지면 현재가치는 낮아진다.';
      const rightText = '미래 현금흐름과 기간이 같다면 할인율 상승은 현재가치를 낮춘다.';
      await seedAssertion(sourcePool, {
        projectId,
        principalId: principal.principalId,
        assertionId: leftAssertionId,
        text: leftText,
        assetRoot: sourceAssetRoot,
      });
      await seedAssertion(sourcePool, {
        projectId,
        principalId: principal.principalId,
        assertionId: rightAssertionId,
        text: rightText,
        assetRoot: sourceAssetRoot,
      });

      const policyRevision = `vp-backup-recovery-${randomUUID()}`;
      const sourceJobs = new PostgresVPRelationJobs(sourcePool);
      expect(await sourceJobs.enqueueCurrentPairs(policyRevision, 1)).toBe(1);
      const pendingBeforeBackup = await sourcePool.query<{ status: string }>(
        `SELECT status FROM vp.relation_jobs
          WHERE project_id = $1 AND policy_revision = $2`,
        [projectId, policyRevision],
      );
      expect(pendingBeforeBackup.rows).toEqual([{ status: 'PENDING' }]);

      const ownerBackup = await runOwnerCreate(
        { root: backupRoot },
        {
          databaseUrl: source.databaseUrl,
          assetRoot: sourceAssetRoot,
          toolMode:
            process.env.SHOTGUN_PG_TOOL_MODE === 'docker-compose' ? 'docker-compose' : 'local',
        },
        ownerDeps,
      );
      const manifest = ownerBackup.manifest;
      expect(ownerBackup.verifiedManifest.backupId).toBe(manifest.backupId);
      expect(manifest.formatVersion).toBe('shotgun-backup-v1');
      expect(manifest.assets.files).toHaveLength(2);

      const ownerRestore = await runOwnerRestoreSafe(
        { backup: ownerBackup.directory, root: backupRoot },
        {
          sourceDatabaseUrl: source.databaseUrl,
          toolMode:
            process.env.SHOTGUN_PG_TOOL_MODE === 'docker-compose' ? 'docker-compose' : 'local',
        },
        ownerDeps,
      );
      restoredTarget = ownerRestore.target;
      expect(restoredTarget.autoCreated).toBe(true);
      expect(ownerRestore.recovery).toEqual({
        canonicalReadable: true,
        startupRecoverySucceeded: true,
        searchReady: true,
        compiledTruthReady: true,
        productReadable: true,
      });
      const sourceAfterRestore = await sourcePool.query<{
        readonly assertion_count: string;
        readonly pending_jobs: string;
      }>(
        `SELECT (SELECT count(*)::text FROM vp.assertions WHERE project_id = $1) AS assertion_count,
                (SELECT count(*)::text FROM vp.relation_jobs
                  WHERE project_id = $1 AND policy_revision = $2 AND status = 'PENDING') AS pending_jobs`,
        [projectId, policyRevision],
      );
      expect(sourceAfterRestore.rows).toEqual([{ assertion_count: '2', pending_jobs: '1' }]);
      const target = restoredTarget;
      const restoredPool = createPostgresPool(target.databaseUrl);
      targetPool = restoredPool;

      const restoredRows = await restoredPool.query<{
        readonly sources: string;
        readonly source_versions: string;
        readonly evidence_spans: string;
        readonly assertions: string;
        readonly current_assertions: string;
        readonly pending_jobs: string;
        readonly asset_count: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM asset.sources WHERE project_id = $1) AS sources,
           (SELECT count(*)::text FROM asset.source_versions version
             JOIN asset.sources source USING (source_id)
            WHERE source.project_id = $1) AS source_versions,
           (SELECT count(*)::text FROM evidence.spans WHERE project_id = $1) AS evidence_spans,
           (SELECT count(*)::text FROM vp.assertions WHERE project_id = $1) AS assertions,
           (SELECT count(*)::text FROM vp.current_assertions WHERE project_id = $1) AS current_assertions,
           (SELECT count(*)::text FROM vp.relation_jobs
             WHERE project_id = $1 AND policy_revision = $2 AND status = 'PENDING') AS pending_jobs,
           (SELECT count(*)::text FROM asset.original_assets) AS asset_count`,
        [projectId, policyRevision],
      );
      expect(restoredRows.rows).toEqual([
        {
          sources: '2',
          source_versions: '2',
          evidence_spans: '2',
          assertions: '2',
          current_assertions: '2',
          pending_jobs: '1',
          asset_count: '2',
        },
      ]);
      const restoredAssets = await restoredPool.query<{ storage_key: string }>(
        `SELECT asset.storage_key FROM asset.original_assets asset
          JOIN asset.source_versions version ON version.original_asset_id = asset.asset_id
          JOIN asset.sources source USING (source_id)
         WHERE source.project_id = $1 ORDER BY asset.storage_key`,
        [projectId],
      );
      for (const asset of restoredAssets.rows) {
        expect(await readFile(path.join(target.assetRoot, asset.storage_key), 'utf8')).toMatch(
          /할인율/u,
        );
      }

      let providerCalls = 0;
      const probabilities = {
        EQUIVALENT: 0.97,
        SUPPORTS: 0.005,
        QUALIFIES: 0.005,
        CONTRADICTS: 0.005,
        RELATED: 0.005,
        UNRESOLVED: 0.01,
      };
      const resolver: AIProviderExecutionResolverPort = {
        resolve: async () => ({
          adapter: {
            identity: {
              provider: 'deepseek',
              model: 'deepseek-restore-recovery-test',
              adapterVersion: 'test',
              dataPolicyVersion: 'test',
            },
            generateStructured: async () => {
              providerCalls += 1;
              return {
                rawText: JSON.stringify({
                  choice: 'EQUIVALENT',
                  direction: 'NONE',
                  confidence: 0.97,
                  probabilities,
                }),
                providerResponseId: 'restore-recovery-provider-response',
                modelVersion: 'deepseek-restore-recovery-test',
                inputTokens: 40,
                outputTokens: 8,
              };
            },
          },
          executionIdentity: {} as never,
        }),
      };
      const restoredJobs = new PostgresVPRelationJobs(restoredPool);
      const worker = new VPRelationJobWorker(
        restoredJobs,
        new VPRelationDecisionRouter(
          undefined,
          new GeneralAIVPDecisionAdapter(resolver, restoredJobs),
          {
            revision: policyRevision,
            minimumChoiceProbability: 0.9,
            maximumDeepAnalysisScore: 0,
            maximumInputTokens: 4_000,
            maximumOutputTokens: 256,
          },
        ),
        async () => true,
        policyRevision,
      );
      expect(await worker.dispatchOnce()).toBe('DECIDED');
      expect(await worker.dispatchOnce()).toBe('EMPTY');

      const recoveryResult = await restoredPool.query<{
        readonly job_status: string;
        readonly provider_call_state: string;
        readonly receipt_count: string;
        readonly relation_count: string;
        readonly left_assertion_id: string;
        readonly right_assertion_id: string;
      }>(
        `SELECT job.status AS job_status,
                (SELECT provider_call.state FROM vp.relation_provider_calls AS provider_call
                  WHERE provider_call.project_id = job.project_id
                    AND provider_call.job_id = job.job_id) AS provider_call_state,
                (SELECT count(*)::text FROM vp.decision_receipts receipt
                  WHERE receipt.project_id = job.project_id
                    AND receipt.task_kind = 'SEMANTIC_RELATION'
                    AND receipt.policy_revision = job.policy_revision) AS receipt_count,
                (SELECT count(*)::text FROM vp.relations relation
                  WHERE relation.project_id = job.project_id) AS relation_count,
                job.left_assertion_id::text,
                job.right_assertion_id::text
           FROM vp.relation_jobs job
          WHERE job.project_id = $1 AND job.policy_revision = $2`,
        [projectId, policyRevision],
      );
      expect(providerCalls).toBe(1);
      expect(recoveryResult.rows).toEqual([
        {
          job_status: 'COMPLETED',
          provider_call_state: 'OUTPUT_STORED',
          receipt_count: '1',
          relation_count: '1',
          left_assertion_id: [leftAssertionId, rightAssertionId].sort()[0],
          right_assertion_id: [leftAssertionId, rightAssertionId].sort()[1],
        },
      ]);
    } catch (error) {
      testFailed = true;
      testFailure = error;
    } finally {
      if (priorJournalRoot === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
      else process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = priorJournalRoot;
      if (priorJournalKey === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
      else process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = priorJournalKey;
      const cleanupErrors: unknown[] = [];
      if (targetPool) {
        try {
          await targetPool.end();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (restoredTarget?.databaseName) {
        try {
          await dropIsolatedRestoreDatabase(parentDatabaseUrl, restoredTarget.databaseName);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (restoredTarget?.assetRoot) {
        try {
          await rm(restoredTarget.assetRoot, { recursive: true, force: true });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        await source.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
      const directoryCleanup = await Promise.allSettled([
        rm(temporaryRoot, { recursive: true, force: true }),
        rm(journalRoot, { recursive: true, force: true }),
      ]);
      cleanupErrors.push(
        ...directoryCleanup
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason),
      );
      if (cleanupErrors.length > 0)
        cleanupFailure = new AggregateError(
          cleanupErrors,
          'VP backup recovery test cleanup failed.',
        );
    }
    if (testFailed) throw testFailure;
    if (cleanupFailure) throw cleanupFailure;
  },
  180_000,
);

it('keeps low-similarity exact relation candidates when paging the complete pair queue', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-relation-no-prune-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-relation-no-prune-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP low-similarity relation preservation',
      description: 'ranking must not prune pairs as the queue is paged',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });

    const crossLanguagePair = vpRelationDecisionCorpus.cases.find(
      (sample) => sample.caseId === 'cross-language-equivalent',
    );
    const financePair = vpFinanceRelationCandidateCorpus.cases.find(
      (sample) => sample.caseId === 'finance-discount-rate-present-value',
    );
    expect(crossLanguagePair).toBeDefined();
    expect(financePair).toBeDefined();
    const assertionIds = [
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000104',
    ];
    const claimsToSeed = [
      { assertionId: assertionIds[0]!, text: crossLanguagePair!.left },
      { assertionId: assertionIds[1]!, text: crossLanguagePair!.right },
      { assertionId: assertionIds[2]!, text: financePair!.left },
      { assertionId: assertionIds[3]!, text: financePair!.right },
    ];
    for (const claim of claimsToSeed) {
      await seedAssertion(pool, {
        projectId,
        principalId: principal.principalId,
        ...claim,
      });
    }

    const policyRevision = `vp-relation-no-prune-${randomUUID()}`;
    const jobs = new PostgresVPRelationJobs(pool);
    let enqueuedCount = 0;
    while (true) {
      const inserted = await jobs.enqueueCurrentPairs(policyRevision, 1);
      if (inserted === 0) break;
      enqueuedCount += inserted;
      expect(enqueuedCount).toBeLessThanOrEqual(6);
    }
    expect(enqueuedCount).toBe(6);

    const stored = await pool.query<{
      readonly left_assertion_id: string;
      readonly right_assertion_id: string;
    }>(
      `SELECT left_assertion_id::text, right_assertion_id::text
         FROM vp.relation_jobs
        WHERE project_id = $1 AND policy_revision = $2`,
      [projectId, policyRevision],
    );
    const pairs = new Set(
      stored.rows.map(({ left_assertion_id, right_assertion_id }) =>
        [left_assertion_id, right_assertion_id].sort().join(':'),
      ),
    );
    expect(pairs).toContain([assertionIds[0], assertionIds[1]].sort().join(':'));
    expect(pairs).toContain([assertionIds[2], assertionIds[3]].sort().join(':'));
  } finally {
    await database.dispose();
  }
}, 60_000);

it('replays a stored provider decision after worker loss without a second egress', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-response-replay-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-response-replay-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP response replay',
      description: 'durable provider output survives worker loss',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const leftId = '00000000-0000-4000-8000-000000000011';
    const rightId = '00000000-0000-4000-8000-000000000012';
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: leftId,
      text: '이익이 증가했다고 해서 현금도 같은 금액만큼 증가하는 것은 아니다.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: rightId,
      text: '이 예시에서는 이익이 증가했지만 해당 기간 현금은 증가하지 않았다.',
    });
    const policyRevision = `vp-response-replay-${randomUUID()}`;
    const jobs = new PostgresVPRelationJobs(pool);
    expect(await jobs.enqueueCurrentPairs(policyRevision, 1)).toBe(1);
    const probabilities = {
      EQUIVALENT: 0.005,
      SUPPORTS: 0.98,
      QUALIFIES: 0,
      CONTRADICTS: 0.005,
      RELATED: 0.005,
      UNRESOLVED: 0.005,
    };
    let providerCalls = 0;
    const resolver: AIProviderExecutionResolverPort = {
      resolve: async () => ({
        adapter: {
          identity: {
            provider: 'deepseek',
            model: 'deepseek-test-model',
            adapterVersion: 'test',
            dataPolicyVersion: 'test',
          },
          generateStructured: async () => {
            providerCalls += 1;
            return {
              rawText: JSON.stringify({
                choice: 'SUPPORTS',
                direction: 'RIGHT_TO_LEFT',
                confidence: 0.98,
                probabilities,
              }),
              providerResponseId: 'response-replayed-after-worker-loss',
              modelVersion: 'deepseek-test-model',
              inputTokens: 72,
              outputTokens: 24,
            };
          },
        },
        executionIdentity: {} as never,
      }),
    };
    let loseControlAfterOutputCommit = true;
    const crashAfterOutputCommit: VPDecisionExecutionRepositoryPort = {
      claim: (input) => jobs.claim(input),
      storeOutput: async (input) => {
        const stored = await jobs.storeOutput(input);
        if (loseControlAfterOutputCommit) {
          loseControlAfterOutputCommit = false;
          throw new Error('Simulated worker exit after durable output commit.');
        }
        return stored;
      },
      markOutcomeUnknown: (input) => jobs.markOutcomeUnknown(input),
    };
    const policy = {
      revision: policyRevision,
      minimumChoiceProbability: 0.9,
      maximumDeepAnalysisScore: 0,
      maximumInputTokens: 4000,
      maximumOutputTokens: 256,
    };
    const firstWorker = new VPRelationJobWorker(
      jobs,
      new VPRelationDecisionRouter(
        undefined,
        new GeneralAIVPDecisionAdapter(resolver, crashAfterOutputCommit),
        policy,
      ),
      async () => true,
      policyRevision,
    );
    expect(await firstWorker.dispatchOnce()).toBe('OUTCOME_UNKNOWN');
    expect(providerCalls).toBe(1);

    await pool.query(
      `UPDATE vp.relation_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE project_id = $1 AND policy_revision = $2 AND status = 'RUNNING'`,
      [projectId, policyRevision],
    );
    const restartedJobs = new PostgresVPRelationJobs(pool);
    const restartedWorker = new VPRelationJobWorker(
      restartedJobs,
      new VPRelationDecisionRouter(
        undefined,
        new GeneralAIVPDecisionAdapter(resolver, restartedJobs),
        policy,
      ),
      async () => true,
      policyRevision,
    );
    expect(await restartedWorker.dispatchOnce()).toBe('DECIDED');
    expect(providerCalls).toBe(1);
    const stored = await pool.query<{
      readonly state: string;
      readonly job_status: string;
      readonly receipt_count: string;
      readonly relation_count: string;
      readonly relation_kind: string;
      readonly relation_direction: string;
    }>(
      `SELECT provider_call.state, job.status AS job_status,
              (SELECT relation.relation_kind FROM vp.relations relation
                WHERE relation.project_id = job.project_id
                  AND relation.left_assertion_id = job.left_assertion_id
                  AND relation.right_assertion_id = job.right_assertion_id
                ORDER BY relation.created_at DESC LIMIT 1) AS relation_kind,
              (SELECT relation.relation_direction FROM vp.relations relation
                WHERE relation.project_id = job.project_id
                  AND relation.left_assertion_id = job.left_assertion_id
                  AND relation.right_assertion_id = job.right_assertion_id
                ORDER BY relation.created_at DESC LIMIT 1) AS relation_direction,
              (SELECT count(*)::text FROM vp.decision_receipts receipt
                WHERE receipt.project_id = job.project_id
                  AND receipt.task_kind = 'SEMANTIC_RELATION'
                  AND receipt.policy_revision = job.policy_revision) AS receipt_count,
              (SELECT count(*)::text FROM vp.relations relation
                WHERE relation.project_id = job.project_id
                  AND relation.left_assertion_id = job.left_assertion_id
                  AND relation.right_assertion_id = job.right_assertion_id) AS relation_count
         FROM vp.relation_provider_calls provider_call
         JOIN vp.relation_jobs job USING (project_id, job_id)
        WHERE job.project_id = $1 AND job.policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(stored.rows).toEqual([
      {
        state: 'OUTPUT_STORED',
        job_status: 'COMPLETED',
        relation_kind: 'SUPPORTS',
        relation_direction: 'RIGHT_TO_LEFT',
        receipt_count: '1',
        relation_count: '1',
      },
    ]);
    const exampleEvidence = await pool.query<{ evidence_id: string }>(
      `SELECT evidence_id::text FROM vp.current_assertions
        WHERE project_id = $1 AND assertion_id = $2`,
      [projectId, rightId],
    );
    const supportingSearch = await new PostgresVPAskEvidenceSearch(pool).search({
      projectId,
      question: '이익이 증가했다고 해서 현금도 같은 금액만큼 증가하는 것은 아니다.',
      accessScope: ['owner'],
      authorizedSensitivities: ['public'],
      limit: 12,
    });
    expect(supportingSearch.evidenceIds).toContain(exampleEvidence.rows[0]?.evidence_id);
  } finally {
    await database.dispose();
  }
}, 60_000);

it('terminalizes an uncertain provider response without retrying it after restart', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-response-unknown-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-response-unknown-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP response unknown',
      description: 'ambiguous provider egress is not repeated',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: '00000000-0000-4000-8000-000000000021',
      text: '실질 GDP는 2024년에 증가했다.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: '00000000-0000-4000-8000-000000000022',
      text: '실질 GDP는 2024년에 감소했다.',
    });
    const policyRevision = `vp-response-unknown-${randomUUID()}`;
    const jobs = new PostgresVPRelationJobs(pool);
    expect(await jobs.enqueueCurrentPairs(policyRevision, 1)).toBe(1);
    let providerCalls = 0;
    const resolver: AIProviderExecutionResolverPort = {
      resolve: async () => ({
        adapter: {
          identity: {
            provider: 'deepseek',
            model: 'deepseek-test-model',
            adapterVersion: 'test',
            dataPolicyVersion: 'test',
          },
          generateStructured: async () => {
            providerCalls += 1;
            throw new Error('connection lost with provider request in flight');
          },
        },
        executionIdentity: {} as never,
      }),
    };
    const policy = {
      revision: policyRevision,
      minimumChoiceProbability: 0.9,
      maximumDeepAnalysisScore: 0,
      maximumInputTokens: 4000,
      maximumOutputTokens: 256,
    };
    const worker = new VPRelationJobWorker(
      jobs,
      new VPRelationDecisionRouter(
        undefined,
        new GeneralAIVPDecisionAdapter(resolver, jobs),
        policy,
      ),
      async () => true,
      policyRevision,
    );
    expect(await worker.dispatchOnce()).toBe('OUTCOME_UNKNOWN');
    expect(providerCalls).toBe(1);
    expect(await new PostgresVPRelationJobs(pool).claimNext(policyRevision)).toBeUndefined();
    const unknown = await pool.query<{ readonly state: string; readonly status: string }>(
      `SELECT provider_call.state, job.status
         FROM vp.relation_provider_calls provider_call
         JOIN vp.relation_jobs job USING (project_id, job_id)
        WHERE job.project_id = $1 AND job.policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(unknown.rows).toEqual([{ state: 'OUTCOME_UNKNOWN', status: 'OUTCOME_UNKNOWN' }]);
    expect(await verifyVPProjectionReplay(pool, projectId)).toMatchObject({
      relationQueueSettled: true,
      relationQueueComplete: false,
      failedRelationJobs: 0,
      unknownRelationJobs: 1,
    });
    expect(providerCalls).toBe(1);
  } finally {
    await database.dispose();
  }
}, 60_000);

it('fences a second provider request when the worker process dies after HTTP success', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  let providerHttpAcceptances = 0;
  const providerStub = createServer((_request, response) => {
    providerHttpAcceptances += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted: true, responseId: 'synthetic-http-acceptance' }));
  });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const projectId = `vp-http-crash-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-http-crash-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP provider HTTP process crash',
      description: 'kill a worker after a provider HTTP success response',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: '00000000-0000-4000-8000-000000000031',
      text: '실질 GDP는 2025년에 4% 증가했다.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: '00000000-0000-4000-8000-000000000032',
      text: '실질 GDP는 2025년에 2% 증가했다.',
    });
    const policyRevision = `vp-http-crash-${randomUUID()}`;
    const jobs = new PostgresVPRelationJobs(pool);
    expect(await jobs.enqueueCurrentPairs(policyRevision, 1)).toBe(1);

    await new Promise<void>((resolve, reject) => {
      providerStub.once('error', reject);
      providerStub.listen(0, '127.0.0.1', resolve);
    });
    const address = providerStub.address();
    if (!address || typeof address === 'string')
      throw new Error('Provider test server did not bind.');
    const crashProbe = path.join(
      process.cwd(),
      'tests',
      'helpers',
      'vp-relation-kill-after-http-response.ts',
    );
    const inheritedPath = process.env.PATH ?? process.env.Path;
    const childEnvironment = Object.fromEntries(
      Object.entries({
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PATH: inheritedPath,
        Path: inheritedPath,
        DATABASE_URL: database.databaseUrl,
        VP_CRASH_TEST_PROVIDER_URL: `http://127.0.0.1:${address.port}/decision`,
        VP_CRASH_TEST_PROJECT_ID: projectId,
        VP_CRASH_TEST_POLICY_REVISION: policyRevision,
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    child = spawn(process.execPath, ['--import', 'tsx', crashProbe], {
      cwd: process.cwd(),
      env: childEnvironment,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let childStderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      childStderr += chunk.toString('utf8');
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Worker did not receive provider HTTP response.')),
        20_000,
      );
      child!.once('message', (message: unknown) => {
        clearTimeout(timeout);
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'provider-http-response-received'
        ) {
          resolve();
        } else {
          reject(new Error('Worker sent an unexpected crash-probe message.'));
        }
      });
      child!.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child!.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Worker exited before provider HTTP success (code=${code}, signal=${signal}): ${childStderr}`,
          ),
        );
      });
    });
    expect(providerHttpAcceptances).toBe(1);
    const exited = once(child, 'exit');
    expect(child.kill()).toBe(true);
    const [exitCode, exitSignal] = (await exited) as [number | null, NodeJS.Signals | null];
    expect(exitCode === null || exitSignal !== null).toBe(true);

    const beforeRestart = await pool.query<{
      readonly job_status: string;
      readonly call_state: string;
      readonly call_count: string;
    }>(
      `SELECT job.status AS job_status, provider_call.state AS call_state,
              count(*) OVER ()::text AS call_count
         FROM vp.relation_jobs AS job
         JOIN vp.relation_provider_calls AS provider_call USING (project_id, job_id)
        WHERE job.project_id = $1 AND job.policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(beforeRestart.rows).toEqual([
      { job_status: 'RUNNING', call_state: 'RUNNING', call_count: '1' },
    ]);

    await pool.query(
      `UPDATE vp.relation_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE project_id = $1 AND policy_revision = $2 AND status = 'RUNNING'`,
      [projectId, policyRevision],
    );
    let restartedProviderCalls = 0;
    const restartedResolver: AIProviderExecutionResolverPort = {
      resolve: async () => ({
        adapter: {
          identity: {
            provider: 'deepseek',
            model: 'deepseek-crash-test',
            adapterVersion: 'restart-spy',
            dataPolicyVersion: 'test-only',
          },
          generateStructured: async () => {
            restartedProviderCalls += 1;
            throw new Error('Unknown outcome must not be sent again.');
          },
        },
        executionIdentity: {} as never,
      }),
    };
    const policy = {
      revision: policyRevision,
      minimumChoiceProbability: 0.9,
      maximumDeepAnalysisScore: 0,
      maximumInputTokens: 4000,
      maximumOutputTokens: 256,
    };
    const restartedWorker = new VPRelationJobWorker(
      new PostgresVPRelationJobs(pool),
      new VPRelationDecisionRouter(
        undefined,
        new GeneralAIVPDecisionAdapter(restartedResolver, new PostgresVPRelationJobs(pool)),
        policy,
      ),
      async () => true,
      policyRevision,
    );
    expect(await restartedWorker.dispatchOnce()).toBe('EMPTY');
    expect(providerHttpAcceptances).toBe(1);
    expect(restartedProviderCalls).toBe(0);
    const terminal = await pool.query<{
      readonly job_status: string;
      readonly call_state: string;
      readonly failure_code: string | null;
      readonly provider_failure_code: string | null;
      readonly call_count: string;
    }>(
      `SELECT job.status AS job_status, provider_call.state AS call_state,
              job.last_failure_code AS failure_code,
              provider_call.failure_code AS provider_failure_code,
              count(*) OVER ()::text AS call_count
         FROM vp.relation_jobs AS job
         JOIN vp.relation_provider_calls AS provider_call USING (project_id, job_id)
        WHERE job.project_id = $1 AND job.policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(terminal.rows).toEqual([
      {
        job_status: 'OUTCOME_UNKNOWN',
        call_state: 'OUTCOME_UNKNOWN',
        failure_code: 'PROVIDER_OUTCOME_UNKNOWN',
        provider_failure_code: 'WORKER_LEASE_EXPIRED_AFTER_PROVIDER_START',
        call_count: '1',
      },
    ]);
    expect(await verifyVPProjectionReplay(pool, projectId)).toMatchObject({
      relationQueueSettled: true,
      relationQueueComplete: false,
      failedRelationJobs: 0,
      unknownRelationJobs: 1,
    });
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (providerStub.listening) {
      await new Promise<void>((resolve, reject) =>
        providerStub.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await database.dispose();
  }
}, 60_000);

it('characterizes the all-pairs relation queue and daily decision budget at 64 assertions', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-scale-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-scale-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP relation pair scale',
      description: '64 synthetic assertions across distinct sources',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });

    const assertionCount = 64;
    for (let index = 0; index < assertionCount; index += 1) {
      await seedAssertion(pool, {
        projectId,
        principalId: principal.principalId,
        assertionId: randomUUID(),
        text: `Synthetic source ${index} reports measure ${index + 1} for period 2026-Q3.`,
      });
    }

    const eligibleRows = await pool.query<{ pair_count: string }>(
      `SELECT count(*)::text AS pair_count
         FROM vp.current_assertions AS left_claim
         JOIN vp.current_assertions AS right_claim
           ON right_claim.project_id = left_claim.project_id
          AND left_claim.assertion_id < right_claim.assertion_id
          AND left_claim.claim_text <> right_claim.claim_text
          AND left_claim.access_scope = right_claim.access_scope
          AND left_claim.sensitivity = right_claim.sensitivity
        WHERE left_claim.project_id = $1`,
      [projectId],
    );
    const eligiblePairCount = Number(eligibleRows.rows[0]?.pair_count ?? 0);
    const expectedPairCount = (assertionCount * (assertionCount - 1)) / 2;
    expect(eligiblePairCount).toBe(expectedPairCount);

    const jobs = new PostgresVPRelationJobs(pool);
    const started = performance.now();
    let enqueueBatchCount = 0;
    let enqueuedCount = 0;
    while (true) {
      const inserted = await jobs.enqueueCurrentPairs('vp-scale-candidate-v1', 128);
      if (inserted === 0) break;
      enqueueBatchCount += 1;
      enqueuedCount += inserted;
    }
    const enqueueElapsedMs = Math.round(performance.now() - started);
    const pending = await pool.query<{ pending_count: string }>(
      `SELECT count(*)::text AS pending_count
         FROM vp.relation_jobs
        WHERE project_id = $1 AND policy_revision = 'vp-scale-candidate-v1'
          AND status = 'PENDING'`,
      [projectId],
    );
    const budget = await pool.query<{ claimed_count: string }>(
      `SELECT COALESCE((SELECT claimed_count::text FROM vp.relation_call_budget
                         WHERE budget_day = CURRENT_DATE), '0') AS claimed_count`,
    );
    expect(enqueuedCount).toBe(eligiblePairCount);
    expect(Number(pending.rows[0]?.pending_count ?? 0)).toBe(eligiblePairCount);
    expect(Number(budget.rows[0]?.claimed_count ?? 0)).toBe(0);

    console.info(
      JSON.stringify({
        summary: 'vp-relation-pair-scale-v1',
        assertionCount,
        eligiblePairCount,
        pendingJobCount: Number(pending.rows[0]?.pending_count ?? 0),
        enqueueBatchCount,
        enqueueElapsedMs,
        dailyProviderAttemptCeiling: 100,
        minimumDaysAtCeiling: Math.ceil(eligiblePairCount / 100),
        providerCallsMade: 0,
      }),
    );
  } finally {
    await database.dispose();
  }
}, 120_000);

it('measures pg_trgm filtering recall against both VP relation candidate corpora', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const runtime = await pool.query<{
      server_version: string;
      trigram_version: string | null;
      vector_version: string | null;
    }>(
      `SELECT current_setting('server_version') AS server_version,
              (SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm') AS trigram_version,
              (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version`,
    );
    expect(runtime.rows[0]?.trigram_version).toBeTruthy();
    expect(runtime.rows[0]?.vector_version).toBeTruthy();

    const corpora = [
      {
        corpusId: vpRelationDecisionCorpus.corpusId,
        corpusVersion: vpRelationDecisionCorpus.corpusVersion,
        corpusDigest: vpRelationDecisionCorpus.corpusDigest,
        labelReviewStatus: vpRelationDecisionCorpus.labelReviewStatus,
        cases: vpRelationDecisionCorpus.cases,
      },
      {
        corpusId: vpFinanceRelationCandidateCorpus.corpusId,
        corpusVersion: vpFinanceRelationCandidateCorpus.corpusVersion,
        corpusDigest: vpFinanceRelationCandidateCorpus.corpusDigest,
        labelReviewStatus: vpFinanceRelationCandidateCorpus.labelReviewStatus,
        cases: vpFinanceRelationCandidateCorpus.cases,
      },
    ];
    const thresholds = [0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
    const measurements = await Promise.all(
      corpora.map(async (corpus) => {
        const scores = await Promise.all(
          corpus.cases.map(async (sample) => {
            const result = await pool.query<{ score: number }>(
              `SELECT similarity($1::text, $2::text)::real AS score`,
              [sample.left, sample.right],
            );
            return {
              caseId: sample.caseId,
              score: Number(result.rows[0]?.score ?? 0),
              exactRelation:
                sample.allowedChoices.length === 1 && sample.allowedChoices[0] !== 'UNRESOLVED',
            };
          }),
        );
        const exactRelationCases = scores.filter((sample) => sample.exactRelation);
        const frontier = thresholds.map((threshold) => {
          const retained = scores.filter((sample) => sample.score >= threshold);
          const retainedExactRelations = retained.filter((sample) => sample.exactRelation).length;
          return {
            threshold,
            retainedCandidates: retained.length,
            exactRelationRecall: `${retainedExactRelations}/${exactRelationCases.length}`,
            missedExactRelations: exactRelationCases
              .filter((sample) => sample.score < threshold)
              .map((sample) => sample.caseId),
          };
        });
        return {
          corpusId: corpus.corpusId,
          corpusVersion: corpus.corpusVersion,
          corpusDigest: corpus.corpusDigest,
          labelReviewStatus: corpus.labelReviewStatus,
          caseCount: scores.length,
          exactRelationCaseCount: exactRelationCases.length,
          scores: scores.map(({ caseId, score, exactRelation }) => ({
            caseId,
            score: Number(score.toFixed(4)),
            exactRelation,
          })),
          frontier,
        };
      }),
    );
    expect(measurements.map((sample) => sample.caseCount)).toEqual([16, 14]);
    expect(measurements.map((sample) => sample.exactRelationCaseCount)).toEqual([10, 13]);
    expect(
      measurements.every((measurement) =>
        measurement.scores.every((sample) => sample.score >= 0 && sample.score <= 1),
      ),
    ).toBe(true);

    console.info(
      JSON.stringify({
        summary: 'vp-relation-pg-trgm-filter-frontier-v2',
        postgresVersion: runtime.rows[0]?.server_version,
        pgTrgmVersion: runtime.rows[0]?.trigram_version,
        pgvectorVersion: runtime.rows[0]?.vector_version,
        relationDefinition:
          'exact single-choice labels other than UNRESOLVED, including RELATED and SUPPORTS',
        measurements,
      }),
    );
  } finally {
    await database.dispose();
  }
}, 60_000);

it('moves an exhausted relation job to terminal FAILED and keeps it out of replay completion', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-retry-cap-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-retry-cap-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP relation retry cap',
      description: 'failed jobs are terminal and remain visible to replay',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: 'Company B reported operating income of 10 in 2025.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: 'Company B reported operating income of 20 in 2025.',
    });

    const policyRevision = 'vp-retry-cap-policy-v1';
    const jobs = new PostgresVPRelationJobs(pool, 100, 2);
    expect(await jobs.enqueueCurrentPairs(policyRevision)).toBe(1);
    const firstAttempt = await jobs.claimNext(policyRevision);
    expect(firstAttempt?.attemptCount).toBe(1);
    expect(
      await jobs.retry({
        jobId: firstAttempt!.jobId,
        leaseToken: firstAttempt!.leaseToken,
        code: 'PROVIDER_FAILED',
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe('RETRYABLE');

    const lastAttempt = await jobs.claimNext(policyRevision);
    expect(lastAttempt?.attemptCount).toBe(2);
    expect(
      await jobs.retry({
        jobId: lastAttempt!.jobId,
        leaseToken: lastAttempt!.leaseToken,
        code: 'PROVIDER_FAILED',
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe('FAILED');

    const restartedAdapter = new PostgresVPRelationJobs(pool, 100, 2);
    expect(await restartedAdapter.claimNext(policyRevision)).toBeUndefined();
    const failed = await pool.query<{
      status: string;
      attempt_count: number;
      max_attempts: number;
    }>(
      `SELECT status, attempt_count, max_attempts FROM vp.relation_jobs
        WHERE project_id = $1 AND policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(failed.rows).toEqual([{ status: 'FAILED', attempt_count: 2, max_attempts: 2 }]);

    const crashedPolicyRevision = 'vp-retry-cap-crash-policy-v1';
    const oneAttemptJobs = new PostgresVPRelationJobs(pool, 100, 1);
    expect(await oneAttemptJobs.enqueueCurrentPairs(crashedPolicyRevision)).toBe(1);
    const crashedAttempt = await oneAttemptJobs.claimNext(crashedPolicyRevision);
    expect(crashedAttempt?.attemptCount).toBe(1);
    await pool.query(
      `UPDATE vp.relation_jobs
          SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE job_id = $1`,
      [crashedAttempt!.jobId],
    );
    expect(await new PostgresVPRelationJobs(pool, 100, 1).claimNext(crashedPolicyRevision)).toBe(
      undefined,
    );
    const crashState = await pool.query<{ status: string; last_failure_code: string }>(
      `SELECT status, last_failure_code FROM vp.relation_jobs WHERE job_id = $1`,
      [crashedAttempt!.jobId],
    );
    expect(crashState.rows).toEqual([
      { status: 'FAILED', last_failure_code: 'MAX_ATTEMPTS_EXCEEDED' },
    ]);
    expect(await verifyVPProjectionReplay(pool, projectId)).toMatchObject({
      relationQueueSettled: true,
      relationQueueComplete: false,
      pendingRelationJobs: 0,
      failedRelationJobs: 2,
      unknownRelationJobs: 0,
    });
  } finally {
    await database.dispose();
  }
}, 60_000);

it('reclaims an expired relation lease after Adapter restart without duplicating its ledger records', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-restart-relation-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-restart-relation-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP relation lease recovery',
      description: 'an expired lease is recoverable by a fresh adapter process',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: 'Company C reported net income of 10 in 2025.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: 'Company C reported net income of 11 in 2025.',
    });

    const policyRevision = 'vp-restart-relation-policy-v1';
    const firstProcess = new PostgresVPRelationJobs(pool);
    expect(await firstProcess.enqueueCurrentPairs(policyRevision)).toBe(1);
    const interrupted = await firstProcess.claimNext(policyRevision);
    expect(interrupted?.attemptCount).toBe(1);
    await pool.query(
      `UPDATE vp.relation_jobs
          SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE job_id = $1`,
      [interrupted!.jobId],
    );

    const restartedProcess = new PostgresVPRelationJobs(pool);
    const recovered = await restartedProcess.claimNext(policyRevision);
    expect(recovered).toMatchObject({ jobId: interrupted!.jobId, attemptCount: 2 });
    expect(
      await restartedProcess.completeDecision({
        jobId: recovered!.jobId,
        leaseToken: recovered!.leaseToken,
        provider: 'GENERAL_AI',
        choice: 'RELATED',
        direction: 'UNDIRECTED',
        confidence: 0.91,
        model: 'vp-restart-test-model',
        inputTokens: 12,
        outputTokens: 4,
      }),
    ).toBe(true);

    const persisted = await pool.query<{
      job_status: string;
      attempt_count: number;
      receipt_count: string;
      relation_count: string;
    }>(
      `SELECT job.status AS job_status, job.attempt_count,
              (SELECT count(*)::text FROM vp.decision_receipts AS receipt
                WHERE receipt.project_id = job.project_id
                  AND receipt.task_kind = 'SEMANTIC_RELATION') AS receipt_count,
              (SELECT count(*)::text FROM vp.relations AS relation
                WHERE relation.project_id = job.project_id) AS relation_count
         FROM vp.relation_jobs AS job
        WHERE job.project_id = $1 AND job.policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(persisted.rows).toEqual([
      { job_status: 'COMPLETED', attempt_count: 2, receipt_count: '1', relation_count: '1' },
    ]);
  } finally {
    await database.dispose();
  }
}, 60_000);

it('does not duplicate a provider call or relation when the committed decision acknowledgement is lost', async () => {
  const database = await createIsolatedPostgresTestDatabase();
  const pool = database.createPool();
  try {
    const projectId = `vp-ack-loss-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `vp-ack-loss-owner-${randomUUID()}`,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'VP relation commit acknowledgement loss',
      description: 'the committed relation is not replayed after its acknowledgement is lost',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: 'Company A reported revenue of 100 in 2025.',
    });
    await seedAssertion(pool, {
      projectId,
      principalId: principal.principalId,
      assertionId: randomUUID(),
      text: 'Company A reported revenue of 200 in 2025.',
    });

    const policyRevision = 'vp-ack-loss-policy-v1';
    let providerCalls = 0;
    let acknowledgementLossInjected = false;
    const ackLossPool = createCommitAckLossPool(
      pool,
      () => providerCalls > 0 && !acknowledgementLossInjected,
      () => {
        acknowledgementLossInjected = true;
      },
    );
    const jobs = new PostgresVPRelationJobs(ackLossPool);
    const readOutcome = vi.spyOn(jobs, 'readDecisionOutcome');
    const provider: VPDecisionProviderPort = {
      decideRelation: async () => {
        providerCalls += 1;
        return {
          choice: 'CONTRADICTS',
          confidence: 0.99,
          probabilities: {
            EQUIVALENT: 0.001,
            SUPPORTS: 0,
            QUALIFIES: 0.001,
            CONTRADICTS: 0.996,
            RELATED: 0.001,
            UNRESOLVED: 0.001,
          },
          deepAnalysisScore: 0,
          model: 'deepseek/test-model',
          inputTokens: 24,
          outputTokens: 8,
        };
      },
    };
    const worker = new VPRelationJobWorker(
      jobs,
      new VPRelationDecisionRouter(undefined, provider, {
        revision: policyRevision,
        minimumChoiceProbability: 0.9,
        maximumDeepAnalysisScore: 0,
        maximumInputTokens: 4_000,
        maximumOutputTokens: 256,
      }),
      async () => true,
      policyRevision,
    );

    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(await worker.dispatchOnce()).toBe('EMPTY');
    expect(acknowledgementLossInjected).toBe(true);
    expect(readOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: expect.any(String),
        leaseToken: expect.any(String),
      }),
    );
    const persisted = await pool.query<{
      job_status: string;
      receipt_count: string;
      relation_count: string;
    }>(
      `SELECT job.status AS job_status,
              (SELECT count(*)::text FROM vp.decision_receipts AS receipt
                WHERE receipt.project_id = job.project_id
                  AND receipt.task_kind = 'SEMANTIC_RELATION') AS receipt_count,
              (SELECT count(*)::text FROM vp.relations AS relation
                WHERE relation.project_id = job.project_id) AS relation_count
         FROM vp.relation_jobs AS job
        WHERE job.project_id = $1 AND job.policy_revision = $2`,
      [projectId, policyRevision],
    );
    expect(providerCalls).toBe(1);
    expect(persisted.rows).toEqual([
      { job_status: 'COMPLETED', receipt_count: '1', relation_count: '1' },
    ]);
  } finally {
    await database.dispose();
  }
}, 60_000);
