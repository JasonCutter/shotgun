import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import {
  PostgresCanonicalCommittedSourceAdapter,
  PostgresDiscoveryProjectionReadinessAdapter,
} from '../../adapters/discovery-trigger-coordinator/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';
import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import { dispatchCanonicalOutbox } from '../../modules/canonical-knowledge/src/index.js';
import {
  createDefaultDiscoveryTriggerPolicyV1,
  DiscoveryTriggerCoordinator,
  StaticDiscoveryTriggerPolicy,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import {
  canonicalSnapshotDigest,
  semanticCorpusWatermarkFromSource,
  sha256Text,
  type CanonicalCommitResult,
  type CanonicalCommittedPayload,
  type DiscoveryCanonicalCommittedEventEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const poolA: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const poolB: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const readyProject = 'akp-4-wp2-coordinator-ready';
const waitingProject = 'akp-4-wp2-coordinator-waiting';

const canonicalDigestFor = (projectId: string, canonicalVersion = 1): string =>
  canonicalSnapshotDigest(projectId, canonicalVersion, []);

const sourceDigestFor = (projectId: string, canonicalVersion = 1): string =>
  semanticCorpusWatermarkFromSource({
    projectId,
    canonicalVersion,
    canonicalSnapshotDigest: canonicalDigestFor(projectId, canonicalVersion),
    approvedGroups: [],
  }).sourceSnapshotDigest;

const seedProject = async (
  projectId: string,
  includeReadyProjections: boolean,
  canonicalVersion = 1,
): Promise<{
  readonly outboxId: string;
  readonly commitId: string;
  readonly payload: CanonicalCommittedPayload;
}> => {
  const commitId = randomUUID();
  const manifestId = randomUUID();
  const changeSetId = randomUUID();
  const revisionId = `revision:${commitId}`;
  const historyEventId = `history:${commitId}`;
  const outboxId = `outbox:${commitId}`;
  const committedAt = '2026-08-30T00:00:00.000Z';
  const snapshotDigest = canonicalDigestFor(projectId, canonicalVersion);
  const payload: CanonicalCommittedPayload = {
    commitId,
    manifestId,
    changeSetId,
    operation: 'NO_OP',
    status: 'NO_OP',
    canonicalVersion,
    snapshotDigest,
    actorId: 'owner',
    accessScope: ['owner'],
    sensitivity: 'private',
  };
  const commit: CanonicalCommitResult = {
    commitId,
    projectId,
    manifestId,
    manifestDigest: sha256Text(`manifest:${commitId}`),
    changeSetId,
    authorityId: null,
    authorityDigest: null,
    operation: 'NO_OP',
    status: 'NO_OP',
    beforeVersion: canonicalVersion - 1,
    afterVersion: canonicalVersion,
    snapshotDigest,
    revisionId,
    historyEventId,
    outboxId,
    committedAt,
  };

  await poolA!.query('BEGIN');
  try {
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, $2, 'ACTIVE', true)
       ON CONFLICT (id) DO NOTHING`,
      [projectId, `AKP-4 WP2 ${projectId}`],
    );
    await poolA!.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET
         version = EXCLUDED.version,
         snapshot_digest = EXCLUDED.snapshot_digest,
         updated_at = EXCLUDED.updated_at`,
      [projectId, canonicalVersion, snapshotDigest, committedAt],
    );
    await poolA!.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        commitId,
        projectId,
        manifestId,
        commit.manifestDigest,
        changeSetId,
        JSON.stringify(commit),
        committedAt,
      ],
    );
    await poolA!.query(
      `INSERT INTO canonical.revisions (revision_id, project_id, commit_id, revision_json, created_at)
       VALUES ($1, $2, $3, '{}'::jsonb, $4)`,
      [revisionId, projectId, commitId, committedAt],
    );
    await poolA!.query(
      `INSERT INTO canonical.history_events (history_event_id, project_id, commit_id, event_json, created_at)
       VALUES ($1, $2, $3, '{}'::jsonb, $4)`,
      [historyEventId, projectId, commitId, committedAt],
    );
    await poolA!.query(
      `INSERT INTO canonical.outbox (
         outbox_id, project_id, aggregate_id, event_type, payload_json, status,
         attempts, available_at
       ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, 'pending', 0, $5)`,
      [outboxId, projectId, commitId, JSON.stringify(payload), committedAt],
    );
    if (includeReadyProjections) {
      const sourceDigest = sourceDigestFor(projectId, canonicalVersion);
      const logicalDigest = sha256Text(`logical:${projectId}`);
      const projection = {
        projectId,
        projectorVersion: 'test-projector:v1',
        sourceSnapshotDigest: sourceDigest,
        logicalDigest,
        canonicalVersion,
        items: [],
        graph: {
          nodes: [],
          edges: [],
          fallback: { available: true, modes: ['LIST', 'TABLE'] },
        },
        projectedAt: committedAt,
        buildMode: 'FULL_REBUILD',
      };
      await poolA!.query(
        `INSERT INTO projection.compiled_truth (
           project_id, projector_version, source_snapshot_digest, logical_digest,
           canonical_version, build_mode, projection, status, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'FULL_REBUILD', $6::jsonb, 'READY', $7)`,
        [
          projectId,
          projection.projectorVersion,
          sourceDigest,
          logicalDigest,
          canonicalVersion,
          JSON.stringify(projection),
          committedAt,
        ],
      );
      const generationId = `generation:${projectId}`;
      await poolA!.query(
        `INSERT INTO projection.semantic_generations (
           project_id, generation_id, source_projection_digest, canonical_base_version,
           credential_id, credential_revision, provider_policy_fingerprint,
           provider_id, embedding_model_id, embedding_profile_id, embedding_profile_revision,
           provider_registry_revision, capability_catalog_revision, representation_version,
           dimension, distance_metric, normalization_policy, build_status, created_at
         ) VALUES ($1, $2, $3, $4, 'credential-test', 1, $5,
           'provider-test', 'model-test', 'profile-test', 1,
           'providers:v1', 'capabilities:v1', 'representation:v1',
           1, 'cosine', 'none', 'READY', $6)`,
        [
          projectId,
          generationId,
          sourceDigest,
          canonicalVersion,
          sha256Text(`policy:${projectId}`),
          committedAt,
        ],
      );
      await poolA!.query(
        `INSERT INTO projection.semantic_generation_pointers (
           project_id, active_generation_id, pointer_revision,
           source_projection_digest, canonical_base_version, updated_at
         ) VALUES ($1, $2, 1, $3, $4, $5)`,
        [projectId, generationId, sourceDigest, canonicalVersion, committedAt],
      );
    }
    await poolA!.query('COMMIT');
  } catch (error) {
    await poolA!.query('ROLLBACK');
    throw error;
  }
  return { outboxId, commitId, payload };
};

const createCoordinator = (now: () => string, pool: Pool = poolA!) => {
  const canonical = new PostgresCanonicalKnowledgeRepository(pool);
  const sourceWatermark = new PostgresSemanticCorpusSourceSnapshotReader(pool);
  const semanticIndex = new PostgresSemanticIndexRepository(pool);
  const runtime = new PostgresDiscoveryRuntimeRepository(pool);
  const policy = new StaticDiscoveryTriggerPolicy({
    ...createDefaultDiscoveryTriggerPolicyV1(),
    waitTimeoutMs: 60_000,
  });
  return {
    canonical,
    runtime,
    service: new DiscoveryTriggerCoordinator(
      new PostgresCanonicalCommittedSourceAdapter(canonical, sourceWatermark),
      new PostgresDiscoveryProjectionReadinessAdapter(
        new PostgresCompiledTruthRepository(pool),
        semanticIndex,
      ),
      runtime,
      policy,
      { now },
      { jobId: () => `job:${randomUUID()}` },
    ),
  };
};

const eventFor = (
  projectId: string,
  fixture: Awaited<ReturnType<typeof seedProject>>,
  messageId: string,
): DiscoveryCanonicalCommittedEventEnvelopeV1 => ({
  messageId,
  messageType: 'CanonicalCommitted',
  messageKind: 'event',
  schemaVersion: '1.0.0',
  producerModule: 'stage6.canonical-knowledge',
  producerVersion: '1.0.0',
  correlationId: `correlation:${fixture.commitId}`,
  projectId,
  actor: { type: 'user', id: 'owner' },
  security: { accessScope: ['owner'], sensitivity: 'private', dataClassification: 'canonical' },
  payload: fixture.payload,
  createdAt: '2026-08-30T00:00:00.000Z',
  traceId: `trace:${messageId}`,
  idempotencyKey: `canonical-outbox:${fixture.outboxId}`,
});

describe.runIf(databaseUrl)('AKP-4 WP2 Canonical trigger coordinator PostgreSQL proof', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  beforeEach(async () => {
    await poolA!.query(`DELETE FROM discovery.job_lifecycle_history WHERE project_id IN ($1, $2)`, [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM discovery.jobs WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query(
      'DELETE FROM projection.semantic_generation_pointers WHERE project_id IN ($1, $2)',
      [readyProject, waitingProject],
    );
    await poolA!.query('DELETE FROM projection.semantic_generations WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM projection.compiled_truth WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM canonical.outbox WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM canonical.history_events WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM canonical.revisions WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM canonical.commits WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM canonical.project_state WHERE project_id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
    await poolA!.query('DELETE FROM project_admin.projects WHERE id IN ($1, $2)', [
      readyProject,
      waitingProject,
    ]);
  });

  afterAll(async () => {
    await poolA!.end();
    await poolB!.end();
  });

  it('consumes the real Canonical Outbox and durably creates one QUEUED Job', async () => {
    const fixture = await seedProject(readyProject, true);
    const { canonical, runtime, service } = createCoordinator(() => '2026-08-30T00:00:10.000Z');
    let firstResult: Awaited<
      ReturnType<DiscoveryTriggerCoordinator['coordinateCanonicalCommitted']>
    >;
    await expect(
      dispatchCanonicalOutbox(
        canonical,
        {
          async publish() {
            firstResult = await service.coordinateCanonicalCommitted(
              eventFor(readyProject, fixture, 'physical-delivery-crash'),
            );
            throw new Error('simulated completion loss after durable Job create');
          },
        },
        readyProject,
        1,
        '2026-08-30T00:00:10.000Z',
      ),
    ).rejects.toThrow('simulated completion loss');
    expect(await canonical.findOutbox(readyProject, fixture.outboxId)).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
    const firstJob = await runtime.findJob({ projectId: readyProject, jobId: firstResult!.jobId });
    expect(firstJob?.requiredDiscoveryBase).toBeDefined();
    await poolA!.query(
      `UPDATE canonical.project_state
       SET version = $2, snapshot_digest = $3, updated_at = $4
       WHERE project_id = $1`,
      [readyProject, 2, canonicalDigestFor(readyProject, 2), '2026-08-30T00:00:20.000Z'],
    );
    expect(sourceDigestFor(readyProject, 2)).not.toBe(
      firstJob!.requiredDiscoveryBase!.projectionDigest,
    );
    const delivered: string[] = [];
    let replayedResult: Awaited<
      ReturnType<DiscoveryTriggerCoordinator['coordinateCanonicalCommitted']>
    >;
    const published = await dispatchCanonicalOutbox(
      canonical,
      {
        async publish(input) {
          replayedResult = await service.coordinateCanonicalCommitted(
            eventFor(readyProject, fixture, 'physical-delivery-replay'),
          );
          delivered.push(replayedResult.disposition);
          expect(input.idempotencyKey).toBe(`canonical-outbox:${fixture.outboxId}`);
        },
      },
      readyProject,
      1,
      '2026-08-30T00:00:10.000Z',
    );
    expect(published).toBe(1);
    expect(delivered).toEqual(['ALREADY_EXISTS']);
    expect(await canonical.findOutbox(readyProject, fixture.outboxId)).toMatchObject({
      status: 'published',
      attempts: 1,
    });
    expect(replayedResult!).toMatchObject({
      disposition: 'ALREADY_EXISTS',
      jobId: firstResult!.jobId,
      logicalJobIdentity: firstResult!.logicalJobIdentity,
    });
    const replayedJob = await runtime.findJob({
      projectId: readyProject,
      jobId: firstResult!.jobId,
    });
    expect(replayedJob?.requiredDiscoveryBase).toEqual(firstJob?.requiredDiscoveryBase);
    expect(replayedJob?.budget).toEqual(firstJob?.budget);
    expect(replayedJob?.projectionWait).toEqual(firstJob?.projectionWait);
    expect(replayedJob?.createdAt).toBe(firstJob?.createdAt);
    const job = await runtime.findJobByLogicalIdentity({
      projectId: readyProject,
      logicalIdentity: firstResult!.logicalJobIdentity,
    });
    expect(job).toMatchObject({ lifecycleState: 'QUEUED', projectionWait: undefined });
    expect(
      await poolA!.query(
        'SELECT count(*)::text AS count FROM discovery.attempts WHERE project_id = $1',
        [readyProject],
      ),
    ).toMatchObject({ rows: [{ count: '0' }] });
    expect(
      await poolA!.query(
        'SELECT count(*)::text AS count FROM discovery.stages WHERE project_id = $1',
        [readyProject],
      ),
    ).toMatchObject({ rows: [{ count: '0' }] });
    expect(
      await service.coordinateCanonicalCommitted(
        eventFor(readyProject, fixture, 'physical-delivery-3'),
      ),
    ).toMatchObject({ disposition: 'ALREADY_EXISTS', jobId: job!.jobId });
  });

  it('persists exact WAITING binding, expires through WP1 history, and creates no physical execution rows', async () => {
    const fixture = await seedProject(waitingProject, false);
    let now = '2026-08-30T00:00:10.000Z';
    const { canonical, runtime, service } = createCoordinator(() => now);
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          await service.coordinateCanonicalCommitted(
            eventFor(waitingProject, fixture, 'wait-delivery'),
          );
        },
      },
      waitingProject,
      1,
      now,
    );
    const waiting = await poolA!.query<{
      lifecycle_state: string;
      required_projection_revision: string;
      required_projection_digest: string;
      wait_deadline_at: Date;
      wait_fallback_policy_revision: string;
    }>(
      `SELECT lifecycle_state, required_projection_revision, required_projection_digest,
              wait_deadline_at, wait_fallback_policy_revision
       FROM discovery.jobs WHERE project_id = $1`,
      [waitingProject],
    );
    expect(waiting.rows[0]).toMatchObject({
      lifecycle_state: 'WAITING_FOR_PROJECTION',
      required_projection_revision: 'semantic-corpus-source:v1:1',
      wait_fallback_policy_revision: 'projection-wait-policy:v1',
    });
    expect(waiting.rows[0]?.required_projection_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(waiting.rows[0]?.wait_deadline_at.toISOString()).toBe('2026-08-30T00:01:10.000Z');

    now = '2026-08-30T00:01:10.000Z';
    const job = (
      await poolA!.query<{ job_id: string }>(
        'SELECT job_id FROM discovery.jobs WHERE project_id = $1',
        [waitingProject],
      )
    ).rows[0]!;
    const expired = await service.reEvaluateCanonicalDiscoveryProjectionReadiness({
      projectId: waitingProject,
      jobId: job.job_id,
    });
    expect(expired.disposition).toBe('FAILED_RETRYABLE');
    expect(await runtime.findJob({ projectId: waitingProject, jobId: job.job_id })).toMatchObject({
      lifecycleState: 'FAILED_RETRYABLE',
      projectionWait: undefined,
    });
    expect(
      await poolA!.query(
        `SELECT from_state, to_state FROM discovery.job_lifecycle_history
         WHERE project_id = $1 AND job_id = $2 ORDER BY lifecycle_revision`,
        [waitingProject, job.job_id],
      ),
    ).toMatchObject({
      rows: [
        { from_state: null, to_state: 'WAITING_FOR_PROJECTION' },
        { from_state: 'WAITING_FOR_PROJECTION', to_state: 'FAILED_RETRYABLE' },
      ],
    });
    for (const table of ['discovery.runs', 'discovery.attempts', 'discovery.stages']) {
      const result = await poolA!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE project_id = $1`,
        [waitingProject],
      );
      expect(result.rows[0]?.count, table).toBe('0');
    }
  });

  it('creates a distinct Job for a distinct Canonical event identity', async () => {
    const firstFixture = await seedProject(readyProject, true, 1);
    const { service, runtime } = createCoordinator(() => '2026-08-30T00:00:10.000Z');
    const first = await service.coordinateCanonicalCommitted(
      eventFor(readyProject, firstFixture, 'canonical-c1'),
    );

    const secondFixture = await seedProject(readyProject, false, 2);
    const second = await service.coordinateCanonicalCommitted(
      eventFor(readyProject, secondFixture, 'canonical-c2'),
    );

    expect(first.disposition).toBe('CREATED');
    expect(second.disposition).toBe('CREATED');
    expect(second.jobId).not.toBe(first.jobId);
    expect(second.logicalJobIdentity.value).not.toBe(first.logicalJobIdentity.value);
    expect(
      await poolA!.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM discovery.jobs WHERE project_id = $1',
        [readyProject],
      ),
    ).toMatchObject({ rows: [{ count: '2' }] });
    expect(
      await runtime.findJobByTriggerIdentity({
        projectId: readyProject,
        triggerClass: 'CANONICAL_COMMITTED',
        eventId: secondFixture.commitId,
        eventRevision: '2',
      }),
    ).toMatchObject({ jobId: second.jobId });
  });

  it('serializes concurrent deliveries through PostgreSQL trigger uniqueness', async () => {
    const fixture = await seedProject(readyProject, true, 1);
    const first = createCoordinator(() => '2026-08-30T00:00:10.000Z', poolA!);
    const second = createCoordinator(() => '2026-08-30T00:00:11.000Z', poolB!);
    const [left, right] = await Promise.all([
      first.service.coordinateCanonicalCommitted(eventFor(readyProject, fixture, 'concurrent-a')),
      second.service.coordinateCanonicalCommitted(eventFor(readyProject, fixture, 'concurrent-b')),
    ]);

    expect(new Set([left.jobId, right.jobId])).toHaveLength(1);
    expect(new Set([left.disposition, right.disposition])).toEqual(
      new Set(['CREATED', 'ALREADY_EXISTS']),
    );
    expect(
      await poolA!.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM discovery.jobs WHERE project_id = $1',
        [readyProject],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    expect(
      await poolA!.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'discovery'
           AND tablename = 'jobs'
           AND indexname = 'discovery_jobs_canonical_trigger_identity_idx'`,
      ),
    ).toMatchObject({ rows: [{ indexname: 'discovery_jobs_canonical_trigger_identity_idx' }] });
  });
});
