import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryReviewResourceRepository } from '../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReviewMaterializer,
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
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!);
    const consumer = new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
    );
    const consumed = await consumer.consume(publication);
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;

    const materializer = new DiscoveryReviewMaterializer(
      new PostgresDiscoveryReentryRepository(pool!),
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
  });
});
