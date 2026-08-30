import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  PostgresDiscoveryReentryFreshnessAuthority,
  PostgresDiscoveryReentryRepository,
} from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import {
  PostgresDiscoveryReviewResourceRepository,
  createPostgresReviewDiscoveryCandidateReader,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReentryFreshnessEvaluator,
  DiscoveryReviewMaterializer,
  discoveryReentryFreshnessBindingFromFindingV1,
  type DiscoveryReviewResourceWriterPort,
} from '../../modules/discovery-reentry/src/index.js';
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
const projectId = `akp-5-wp5-db-${randomUUID()}`;
const now = '2026-08-31T00:30:00.000Z';

const findingFor = (
  findingId: string,
  options: {
    readonly relatedResourceRefs?: readonly {
      readonly schemaVersion: '1.0.0';
      readonly resourceKind: 'CANONICAL_CLAIM';
      readonly resourceId: string;
      readonly projectId: string;
      readonly resourceState: 'CURRENT';
    }[];
    readonly evidenceIds?: readonly string[];
  } = {},
): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 1,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: `subject-${findingId}`,
      missingFact: 'database fact',
      question: 'Which current authority is valid?',
    },
    relatedResourceRefs: options.relatedResourceRefs ?? [],
    evidenceIds: options.evidenceIds ?? [],
    sourceProjectionDigest: 'sha256:wp5-db-source',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 9,
      snapshotDigest: 'sha256:wp5-db-canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp5-db-9',
      projectionDigest: 'sha256:wp5-db-discovery',
    },
    runId: `run-${findingId}`,
    signalSummary: {},
    rationale: 'The finding must be revalidated against current authorities.',
    derivationSummary: 'AKP-5 WP5 PostgreSQL fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp5-db-rule',
      ruleVersion: '1',
      inputDigest: 'sha256:wp5-db-input',
    },
    accessScope: ['review'],
    sensitivity: 'internal',
    fingerprint: `sha256:${findingId}-fingerprint`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });

const publicationFor = (finding: DiscoveryFindingEnvelopeV1): DiscoveryFindingReadyV1 => ({
  schemaVersion: '1.0.0',
  publicationId: `publication-${finding.findingId}`,
  projectId,
  findingId: finding.findingId,
  findingRevision: finding.findingRevision,
  fingerprint: finding.fingerprint,
  fingerprintVersion: finding.fingerprintVersion,
  jobId: `job-${finding.findingId}`,
  runId: finding.runId,
  attemptId: `attempt-${finding.findingId}`,
  canonicalBase: finding.canonicalBase,
  requiredDiscoveryBase: finding.discoveryBase,
  occurredAt: now,
});

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

const setupFinding = async (
  finding: DiscoveryFindingEnvelopeV1,
): Promise<PostgresDiscoveryFindingRepository> => {
  const repository = new PostgresDiscoveryFindingRepository(pool!);
  await repository.save(finding);
  return repository;
};

const evaluator = (): DiscoveryReentryFreshnessEvaluator =>
  new DiscoveryReentryFreshnessEvaluator(new PostgresDiscoveryReentryFreshnessAuthority(pool!));

describe.runIf(databaseUrl)('AKP-5 WP5 PostgreSQL freshness authority and guards', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  beforeEach(async () => {
    await cleanup();
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-5 WP5 database project', 'ACTIVE', true)`,
      [projectId],
    );
  });

  afterAll(async () => {
    await cleanup();
    await pool!.end();
  });

  it('A/B: reads server-owned lifecycle and keeps a fresh Finding eligible', async () => {
    const finding = findingFor('finding-a');
    await setupFinding(finding);
    const authority = new PostgresDiscoveryReentryFreshnessAuthority(pool!);
    const state = await authority.read({
      binding: discoveryReentryFreshnessBindingFromFindingV1(finding),
      stage: 'REENTRY_INTAKE',
    });
    expect(state.lifecycleState).toBe('NEW');
    expect(state.authorization).toBe('AUTHORIZED');
    const repository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: new PostgresDiscoveryFindingRepository(pool!),
    });
    const result = await new DiscoveryReentryConsumer(
      repository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result.status).toBe('CREATED');
  });

  it('C: blocks intake when an approved related resource is unavailable', async () => {
    const relatedResource = {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'CANONICAL_CLAIM' as const,
      resourceId: 'missing-claim',
      projectId,
      resourceState: 'CURRENT' as const,
    };
    const finding = findingFor('finding-c', { relatedResourceRefs: [relatedResource] });
    const findingRepository = await setupFinding(finding);
    let resolverCalls = 0;
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, { lifecycleRepository: findingRepository }),
      {
        resolve: async () => {
          resolverCalls += 1;
          return {
            status: 'RESOLVED' as const,
            refs: [
              { ...relatedResource, resourceState: 'APPROVED' as const, resourceRevision: '1' },
            ],
          };
        },
      },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'STALE' });
    expect(resolverCalls).toBe(0);
    await expect(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }).findExisting('not-created'),
    ).resolves.toBeUndefined();
  });

  it('D/E: blocks intake when Evidence is unavailable and preserves project isolation', async () => {
    const finding = findingFor('finding-d', { evidenceIds: ['missing-evidence'] });
    await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: new PostgresDiscoveryFindingRepository(pool!),
      }),
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'STALE' });
    const authority = new PostgresDiscoveryReentryFreshnessAuthority(pool!);
    const isolated = await authority.read({
      binding: {
        ...discoveryReentryFreshnessBindingFromFindingV1(finding),
        approvedRelatedResourceRefs: [
          {
            schemaVersion: '1.0.0',
            resourceKind: 'CANONICAL_CLAIM',
            resourceId: 'cross-project-claim',
            projectId: 'another-project',
            resourceState: 'APPROVED',
            resourceRevision: '1',
          },
        ],
      },
      stage: 'REENTRY_INTAKE',
    });
    expect(isolated.relatedResources[0]).toMatchObject({
      availability: 'UNAVAILABLE',
      projectId: 'another-project',
    });
  });

  it('F: does not save a Review resource when Guard B sees terminal lifecycle', async () => {
    const finding = findingFor('finding-f');
    const findingRepository = await setupFinding(finding);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumed = await new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;
    const lifecycle = await findingRepository.findLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    await findingRepository.transitionLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: lifecycle!.lifecycleRevision,
      targetState: 'STALE',
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: 'RELEVANT_INPUT_CHANGED',
      occurredAt: now,
      context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
    });
    let writes = 0;
    await expect(
      new DiscoveryReviewMaterializer(
        reentryRepository,
        {
          save: async () => {
            writes += 1;
            return 'CREATED';
          },
        },
        evaluator(),
      ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey }),
    ).rejects.toThrow(/not eligible/);
    expect(writes).toBe(0);
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toEqual([]);
  });

  it('G/H: retains but hides an immutable resource when authority changes after save', async () => {
    const finding = findingFor('finding-gh');
    const findingRepository = await setupFinding(finding);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumed = await new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;
    const writer: DiscoveryReviewResourceWriterPort = {
      save: async (resource) => {
        const lifecycle = await findingRepository.findLifecycle({
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
        });
        await findingRepository.transitionLifecycle({
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          expectedLifecycleRevision: lifecycle!.lifecycleRevision,
          targetState: 'STALE',
          cause: 'SYSTEM_RECONCILIATION',
          reasonCode: 'RELEVANT_INPUT_CHANGED',
          occurredAt: now,
          context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
        });
        await new PostgresDiscoveryReviewResourceRepository(pool!).save(resource);
        return 'CREATED';
      },
    };
    const result = await new DiscoveryReviewMaterializer(
      reentryRepository,
      writer,
      evaluator(),
    ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey });
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.resource).toBeDefined();
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
    ).resolves.toEqual([]);
  });

  it('I/J/K: terminal replay is closed, migration is absent, and the legacy schemas remain present', async () => {
    const finding = findingFor('finding-ijk');
    const findingRepository = await setupFinding(finding);
    const lifecycle = await findingRepository.findLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    await findingRepository.transitionLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: lifecycle!.lifecycleRevision,
      targetState: 'RESOLVED',
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: 'CANONICAL_EQUIVALENT_ACCEPTED',
      occurredAt: now,
      context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
    });
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, { lifecycleRepository: findingRepository }),
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'RESOLVED' });
    expect(existsSync('db/migrations/055_akp_5_wp5.sql')).toBe(false);
    expect(existsSync('db/migrations/053_akp_5_wp2_discovery_reentry.sql')).toBe(true);
    expect(existsSync('db/migrations/054_akp_5_wp3_persistent_review_bridge.sql')).toBe(true);
  });
});
