import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  createPostgresReviewDiscoveryCandidateReader,
  PostgresDiscoveryReviewResourceRepository,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReviewMaterializer,
  PersistentDiscoveryReentryWorker,
  type DiscoveryReviewResourceWriterPort,
} from '../../modules/discovery-reentry/src/index.js';
import type { DiscoveryFindingLifecycleRepositoryPort } from '../../modules/discovery-finding-lifecycle/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingReadyV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = `akp-5-wp4-db-${randomUUID()}`;
const now = '2026-08-30T04:30:00.000Z';

const finding: DiscoveryFindingEnvelopeV1 = createDiscoveryFindingEnvelopeV1({
  schemaVersion: '1.0.0',
  findingId: 'finding-wp4-db-knowledge-gap',
  findingRevision: 1,
  projectId,
  findingType: 'KNOWLEDGE_GAP',
  generationMethod: 'DETERMINISTIC',
  lifecycleState: 'NEW',
  payload: {
    schemaVersion: '1.0.0',
    payloadType: 'KNOWLEDGE_GAP',
    gapKind: 'MISSING_FACT',
    subject: 'database subject',
    missingFact: 'database fact',
    question: 'Which database fact is missing?',
  },
  relatedResourceRefs: [],
  evidenceIds: ['evidence-wp4-db-1'],
  sourceProjectionDigest: 'sha256:wp4-db-source',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 1,
    snapshotDigest: 'sha256:wp4-db-canonical',
  },
  discoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-wp4-db-1',
    projectionDigest: 'sha256:wp4-db-discovery',
  },
  runId: 'run-wp4-db-1',
  signalSummary: {},
  rationale: 'The persisted database finding needs governed investigation.',
  derivationSummary: 'WP4 PostgreSQL integration fixture.',
  provenance: {
    schemaVersion: '1.0.0',
    kind: 'DETERMINISTIC',
    ruleId: 'wp4-db-rule',
    ruleVersion: '1',
    inputDigest: 'sha256:wp4-db-input',
  },
  accessScope: ['owner'],
  sensitivity: 'private',
  fingerprint: 'sha256:wp4-db-fingerprint',
  fingerprintVersion: 'discovery-fingerprint:v1',
  retentionClass: 'DURABLE_DERIVED_RECORD',
  createdAt: now,
});

const publication: DiscoveryFindingReadyV1 = {
  schemaVersion: '1.0.0',
  publicationId: 'publication-wp4-db-1',
  projectId,
  findingId: finding.findingId,
  findingRevision: finding.findingRevision,
  fingerprint: finding.fingerprint,
  fingerprintVersion: finding.fingerprintVersion,
  jobId: 'job-wp4-db-1',
  runId: finding.runId,
  attemptId: 'attempt-wp4-db-1',
  canonicalBase: finding.canonicalBase,
  requiredDiscoveryBase: finding.discoveryBase,
  occurredAt: now,
};

const cleanup = async (): Promise<void> => {
  if (pool === undefined) return;
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await client.query('DELETE FROM discovery.reentry_review_resources WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_review_roots WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_consumption WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_candidates WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_manifests WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

describe.runIf(databaseUrl)('AKP-5 WP4 PostgreSQL materialization authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  beforeEach(async () => {
    await cleanup();
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-5 WP4 database project', 'ACTIVE', true)`,
      [projectId],
    );
    await new PostgresDiscoveryFindingRepository(pool!).save(finding);
  });

  afterAll(async () => {
    await cleanup();
    await pool!.end();
  });

  it('persists the authoritative Finding-to-Candidate-to-Review path idempotently', async () => {
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumer = new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    const consumed = await consumer.consume(publication);
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;

    const materializer = new DiscoveryReviewMaterializer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryReviewResourceRepository(pool!),
    );
    const first = await materializer.materialize({
      logicalIdentityKey: consumed.logicalIdentityKey,
    });
    const second = await materializer.materialize({
      logicalIdentityKey: consumed.logicalIdentityKey,
    });
    expect(first.status).toBe('CREATED');
    expect(second.status).toBe('IDEMPOTENT');
    if (first.status !== 'CREATED') return;
    expect(first.resource.content.normalizedMaterial?.materializationTarget).toBe(
      'KNOWLEDGE_GAP_INVESTIGATION',
    );
    expect(first.resource.reviewEligibility).toBe('ELIGIBLE_AFTER_VALIDATION');

    const persisted = await pool!.query<{
      candidate_eligibility: string;
      lifecycle_state: string;
      review_count: number;
      content: { normalizedMaterial?: { materializationTarget?: string } };
    }>(
      `SELECT candidate->>'reviewEligibility' AS candidate_eligibility,
              (SELECT lifecycle_state
               FROM discovery.finding_lifecycle_current
               WHERE project_id = candidate.project_id
                 AND finding_id = candidate.finding_id
                 AND finding_revision = candidate.finding_revision) AS lifecycle_state,
              (SELECT count(*)::int
               FROM discovery.reentry_review_resources
               WHERE project_id = candidate.project_id
                 AND candidate_id = candidate.candidate_id
                 AND candidate_revision = candidate.candidate_revision) AS review_count,
              (SELECT content FROM discovery.reentry_review_resources
               WHERE project_id = candidate.project_id
                 AND candidate_id = candidate.candidate_id
                 AND candidate_revision = candidate.candidate_revision
               ORDER BY resource_revision DESC LIMIT 1) AS content
       FROM discovery.reentry_candidates candidate
       WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = $3`,
      [projectId, consumed.candidate.candidateId, consumed.candidate.candidateRevision],
    );
    expect(persisted.rows[0]).toMatchObject({
      candidate_eligibility: 'NOT_ELIGIBLE',
      lifecycle_state: 'REVIEW_READY',
      review_count: 1,
      content: { normalizedMaterial: { materializationTarget: 'KNOWLEDGE_GAP_INVESTIGATION' } },
    });
    const lifecycleHistory = await findingRepository.listLifecycleHistory({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    expect(lifecycleHistory.filter((entry) => entry.toState === 'REVIEW_READY')).toEqual([
      expect.objectContaining({
        fromState: 'VALIDATING',
        toState: 'REVIEW_READY',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'REVIEW_READY',
        canonicalBase: finding.canonicalBase,
        discoveryBase: finding.discoveryBase,
      }),
    ]);
  });

  it('recovers a processed WP2 intake after repository and worker recreation', async () => {
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const firstRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumer = new DiscoveryReentryConsumer(
      firstRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    const consumed = await consumer.consume(publication);
    expect(consumed.status).toBe('CREATED');

    const recreatedRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const worker = new PersistentDiscoveryReentryWorker(
      new DiscoveryReentryConsumer(
        recreatedRepository,
        { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
        () => new Date(now),
      ),
      {
        batchLimit: 1,
        reviewMaterializer: new DiscoveryReviewMaterializer(
          recreatedRepository,
          new PostgresDiscoveryReviewResourceRepository(pool!),
        ),
      },
    );
    await expect(worker.runOnce()).resolves.toMatchObject({ fetched: 0, results: [] });

    const lifecycle = await findingRepository.findLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    expect(lifecycle?.lifecycleState).toBe('REVIEW_READY');
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toHaveLength(1);
  });

  it('retries a materializer failure from the durable pending scan', async () => {
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumer = new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    await expect(consumer.consume(publication)).resolves.toMatchObject({ status: 'CREATED' });
    const [pending] = await reentryRepository.listPendingReviewMaterialization(1);
    expect(pending).toBeDefined();

    const failingWriter: DiscoveryReviewResourceWriterPort = {
      save: async () => {
        throw new Error('simulated Review writer outage');
      },
    };
    await expect(
      new DiscoveryReviewMaterializer(reentryRepository, failingWriter).materialize({
        logicalIdentityKey: pending!.logicalIdentityKey,
      }),
    ).rejects.toThrow('simulated Review writer outage');
    expect(
      (
        await findingRepository.findLifecycle({
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
        })
      )?.lifecycleState,
    ).toBe('VALIDATING');

    const worker = new PersistentDiscoveryReentryWorker(
      new DiscoveryReentryConsumer(
        new PostgresDiscoveryReentryRepository(pool!, {
          lifecycleRepository: findingRepository,
        }),
        { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
        () => new Date(now),
      ),
      {
        batchLimit: 1,
        reviewMaterializer: new DiscoveryReviewMaterializer(
          new PostgresDiscoveryReentryRepository(pool!, {
            lifecycleRepository: findingRepository,
          }),
          new PostgresDiscoveryReviewResourceRepository(pool!),
        ),
      },
    );
    await expect(worker.runOnce()).resolves.toMatchObject({ fetched: 0, results: [] });
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toHaveLength(1);
  });

  it('keeps a saved Review resource hidden until lifecycle closure and recovers the gap', async () => {
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const consumerRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumer = new DiscoveryReentryConsumer(
      consumerRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    await expect(consumer.consume(publication)).resolves.toMatchObject({ status: 'CREATED' });
    const [pending] = await consumerRepository.listPendingReviewMaterialization(1);
    expect(pending).toBeDefined();

    const failingLifecycleRepository: DiscoveryFindingLifecycleRepositoryPort = {
      findLifecycle: (identity) => findingRepository.findLifecycle(identity),
      listLifecycleHistory: (identity) => findingRepository.listLifecycleHistory(identity),
      transitionLifecycle: async () => {
        throw new Error('simulated crash after Review save');
      },
    };
    const preTransitionRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: failingLifecycleRepository,
    });
    await expect(
      new DiscoveryReviewMaterializer(
        preTransitionRepository,
        new PostgresDiscoveryReviewResourceRepository(pool!),
      ).materialize({ logicalIdentityKey: pending!.logicalIdentityKey }),
    ).rejects.toThrow('simulated crash after Review save');
    expect(
      (
        await pool!.query<{ count: number }>(
          `SELECT count(*)::int AS count
         FROM discovery.reentry_review_resources
         WHERE project_id = $1`,
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe(1);
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toHaveLength(0);

    const worker = new PersistentDiscoveryReentryWorker(
      new DiscoveryReentryConsumer(
        new PostgresDiscoveryReentryRepository(pool!, {
          lifecycleRepository: findingRepository,
        }),
        { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
        () => new Date(now),
      ),
      {
        batchLimit: 1,
        reviewMaterializer: new DiscoveryReviewMaterializer(
          new PostgresDiscoveryReentryRepository(pool!, {
            lifecycleRepository: findingRepository,
          }),
          new PostgresDiscoveryReviewResourceRepository(pool!),
        ),
      },
    );
    await expect(worker.runOnce()).resolves.toMatchObject({ fetched: 0, results: [] });
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toHaveLength(1);
    expect(
      (
        await pool!.query<{ count: number }>(
          `SELECT count(*)::int AS count
         FROM discovery.reentry_review_resources
         WHERE project_id = $1`,
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it('converges concurrent materializers to one resource and one lifecycle transition', async () => {
    const firstFindingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const consumerRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: firstFindingRepository,
    });
    const consumer = new DiscoveryReentryConsumer(
      consumerRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    await expect(consumer.consume(publication)).resolves.toMatchObject({ status: 'CREATED' });
    const [pending] = await consumerRepository.listPendingReviewMaterialization(1);
    expect(pending).toBeDefined();

    const materialize = (lifecycleRepository: PostgresDiscoveryFindingRepository) => {
      const repository = new PostgresDiscoveryReentryRepository(pool!, { lifecycleRepository });
      return new DiscoveryReviewMaterializer(
        repository,
        new PostgresDiscoveryReviewResourceRepository(pool!),
      ).materialize({ logicalIdentityKey: pending!.logicalIdentityKey });
    };
    const results = await Promise.allSettled([
      materialize(firstFindingRepository),
      materialize(new PostgresDiscoveryFindingRepository(pool!)),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const persisted = await pool!.query<{ resources: number; ready_transitions: number }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_review_resources WHERE project_id = $1) AS resources,
         (SELECT count(*)::int
          FROM discovery.finding_lifecycle_history
          WHERE project_id = $1 AND to_state = 'REVIEW_READY') AS ready_transitions`,
      [projectId],
    );
    expect(persisted.rows[0]).toEqual({ resources: 1, ready_transitions: 1 });
  });

  it('fails closed on a terminal lifecycle race and never reopens the Finding', async () => {
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const consumerRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumer = new DiscoveryReentryConsumer(
      consumerRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    await expect(consumer.consume(publication)).resolves.toMatchObject({ status: 'CREATED' });
    const [pending] = await consumerRepository.listPendingReviewMaterialization(1);
    expect(pending).toBeDefined();
    const current = await findingRepository.findLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    expect(current?.lifecycleState).toBe('VALIDATING');
    const terminal = await findingRepository.transitionLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: current!.lifecycleRevision,
      targetState: 'STALE',
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: 'RELEVANT_INPUT_CHANGED',
      occurredAt: now,
      context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
    });
    expect(terminal.status).toBe('APPLIED');

    await expect(
      new DiscoveryReviewMaterializer(
        new PostgresDiscoveryReentryRepository(pool!, {
          lifecycleRepository: findingRepository,
        }),
        new PostgresDiscoveryReviewResourceRepository(pool!),
      ).materialize({
        logicalIdentityKey: pending!.logicalIdentityKey,
      }),
    ).rejects.toThrow(/not eligible/);
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toHaveLength(0);
    expect(
      (
        await findingRepository.findLifecycle({
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
        })
      )?.lifecycleState,
    ).toBe('STALE');
  });
});
