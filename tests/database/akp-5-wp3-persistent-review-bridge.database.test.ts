import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  createPostgresReviewDiscoveryCandidateReader,
  PostgresDiscoveryReviewResourceRepository,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { DiscoveryCandidateReviewTargetAdapter } from '../../adapters/frontend-review-in-memory/src/index.js';
import {
  DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
  discoveryReviewResourceContentDigestV1,
  type DiscoveryReviewResourceV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = 'akp-5-wp3-db-project';
const now = '2026-08-30T03:00:00.000Z';

const resourceWithoutDigest = {
  schemaVersion: '1.0.0' as const,
  origin: 'DERIVED_DISCOVERY' as const,
  projectId,
  reviewResourceId: 'review-resource-wp3-db-1',
  resourceRevision: 2,
  effectiveProjectId: projectId,
  candidateId: 'candidate-wp3-db-1',
  candidateRevision: 1,
  findingId: 'finding-wp3-db-1',
  findingRevision: 1,
  findingType: 'KNOWLEDGE_GAP' as const,
  manifestId: 'manifest-wp3-db-1',
  governanceTarget: 'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE' as const,
  sourceProjectionDigest: 'sha256:wp3-db-source',
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 8,
    snapshotDigest: 'sha256:wp3-db-canonical',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'projection-wp3-db-8',
    projectionDigest: 'sha256:wp3-db-discovery',
  },
  relatedResourceRefs: [],
  evidenceIds: ['evidence-wp3-db-1'],
  derivationProvenance: {
    schemaVersion: '1.0.0' as const,
    kind: 'DETERMINISTIC' as const,
    ruleId: 'wp3-db-test-rule',
    ruleVersion: '1',
    inputDigest: 'sha256:wp3-db-input',
  },
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  validationProfile: DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
  validationResult: {
    schemaVersion: '1.0.0' as const,
    artifactKind: 'VALIDATION' as const,
    artifactId: 'validation-wp3-db-1',
    artifactRevision: '3',
    digest: 'sha256:wp3-db-validation',
  },
  lifecycleState: 'REVIEW_READY' as const,
  reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION' as const,
  content: {
    schemaVersion: '1.0.0' as const,
    summary: 'Database-backed validated derived candidate',
    detail: 'The same normalized resource is read after a new reader is created.',
    rationale: 'The database bridge persists a validation result and lineage.',
  },
  evidenceLineage: [
    {
      schemaVersion: '1.0.0' as const,
      evidenceId: 'evidence-wp3-db-1',
    },
  ],
} satisfies Omit<DiscoveryReviewResourceV1, 'contentDigest' | 'createdAt' | 'updatedAt'>;

const resource: DiscoveryReviewResourceV1 = {
  ...resourceWithoutDigest,
  contentDigest: discoveryReviewResourceContentDigestV1(resourceWithoutDigest),
  createdAt: now,
  updatedAt: now,
};

const seedPrerequisites = async (database: Pool): Promise<void> => {
  await database.query(
    `INSERT INTO project_admin.projects (id, name, status, active)
     VALUES ($1, 'AKP-5 WP3 database project', 'ACTIVE', true)
     ON CONFLICT (id) DO NOTHING`,
    [projectId],
  );
  await database.query(
    `INSERT INTO discovery.findings (
       schema_version, finding_id, finding_revision, project_id, finding_type,
       status, generation_method, lifecycle_state, payload, related_resource_refs,
       evidence_ids, source_projection_digest, canonical_base_version,
       canonical_snapshot_digest, discovery_projection_revision,
       discovery_projection_digest, run_id, signal_summary, rationale,
       derivation_summary, provenance, access_scope, sensitivity, fingerprint,
       fingerprint_version, retention_class, created_at
     ) VALUES (
       '1.0.0', $1, 1, $2, 'KNOWLEDGE_GAP', 'DERIVED_INFERENCE', 'DETERMINISTIC',
       'REVIEW_READY', $3::jsonb, '[]'::jsonb, ARRAY['evidence-wp3-db-1'],
       'sha256:wp3-db-source', 8, 'sha256:wp3-db-canonical', 'projection-wp3-db-8',
       'sha256:wp3-db-discovery', 'run-wp3-db-1', '{}'::jsonb, 'A test finding.',
       'A test derived record.', $4::jsonb, ARRAY['owner'], 'internal',
       'sha256:wp3-db-fingerprint', 'discovery-fingerprint:v1',
       'DURABLE_DERIVED_RECORD', $5)`,
    [
      resource.findingId,
      projectId,
      JSON.stringify({ schemaVersion: '1.0.0', payloadType: 'KNOWLEDGE_GAP' }),
      JSON.stringify(resource.derivationProvenance),
      now,
    ],
  );
  await database.query(
    `INSERT INTO discovery.reentry_manifests (
       logical_identity_version, logical_identity_key, manifest_id, project_id,
       finding_id, finding_revision, finding_type, source_projection_digest,
       canonical_base_version, canonical_snapshot_digest, requested_reentry_purpose,
       manifest, created_at
     ) VALUES (
       'discovery-reentry-identity:v1', 'wp3-db-manifest-identity', $1, $2,
       $3, 1, 'KNOWLEDGE_GAP', 'sha256:wp3-db-source', 8,
       'sha256:wp3-db-canonical', 'DERIVED_PROVENANCE_VALIDATION', '{}'::jsonb, $4)`,
    [resource.manifestId, projectId, resource.findingId, now],
  );
  await database.query(
    `INSERT INTO discovery.reentry_candidates (
       candidate_id, candidate_revision, logical_identity_key, project_id,
       manifest_id, finding_id, finding_revision, finding_type, origin,
       source_projection_digest, canonical_base_version, canonical_snapshot_digest,
       discovery_projection_revision, discovery_projection_digest,
       related_resource_refs, evidence_ids, derivation_provenance, access_scope,
       sensitivity, validation_profile, reentry_eligibility, review_eligibility,
       candidate, created_at
     ) VALUES (
       $1, 1, 'wp3-db-candidate-identity', $2, $3, $4, 1, 'KNOWLEDGE_GAP',
       'DERIVED_DISCOVERY', 'sha256:wp3-db-source', 8, 'sha256:wp3-db-canonical',
       'projection-wp3-db-8', 'sha256:wp3-db-discovery', '[]'::jsonb,
       ARRAY['evidence-wp3-db-1'], $5::jsonb, ARRAY['owner'], 'internal',
       $6::jsonb, 'ELIGIBLE_FOR_VALIDATION', 'NOT_ELIGIBLE', '{}'::jsonb, $7)`,
    [
      resource.candidateId,
      projectId,
      resource.manifestId,
      resource.findingId,
      JSON.stringify(resource.derivationProvenance),
      JSON.stringify(resource.validationProfile),
      now,
    ],
  );
};

const cleanup = async (database: Pool): Promise<void> => {
  const client = await database.connect();
  try {
    // The review bridge is immutable in normal operation; cleanup is the
    // controlled administrative path for this isolated test project.
    await client.query('SET session_replication_role = replica');
    await client.query('DELETE FROM discovery.reentry_review_resources WHERE project_id = $1', [
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

describe.runIf(pool)('AKP-5 WP3 persistent Review bridge (real PostgreSQL)', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await cleanup(pool!);
    await seedPrerequisites(pool!);
  });

  afterAll(async () => {
    await cleanup(pool!);
    await pool!.end();
  });

  it('persists, restarts and reads the same eligible target with idempotent identity', async () => {
    const writer = new PostgresDiscoveryReviewResourceRepository(pool!);
    await expect(writer.save(resource)).resolves.toBe('CREATED');
    await expect(new PostgresDiscoveryReviewResourceRepository(pool!).save(resource)).resolves.toBe(
      'IDEMPOTENT',
    );

    const firstReader = createPostgresReviewDiscoveryCandidateReader(pool!);
    const first = await firstReader.list(projectId);
    const restartedReader = createPostgresReviewDiscoveryCandidateReader(pool!);
    const restarted = await restartedReader.list(projectId);
    expect(first).toHaveLength(1);
    expect(restarted).toEqual(first);
    expect(restarted[0]).toMatchObject({
      origin: 'DERIVED_DISCOVERY',
      reviewResourceId: resource.reviewResourceId,
      resourceRevision: resource.resourceRevision,
      candidateRevision: resource.candidateRevision,
      contentDigest: resource.contentDigest,
      evidence: [{ evidenceId: 'evidence-wp3-db-1' }],
    });

    const adapter = new DiscoveryCandidateReviewTargetAdapter(restartedReader);
    const target = (await adapter.listSourceTargets(projectId))[0]!;
    const context = await adapter.materializeContext({
      scope: {
        principalId: 'principal-wp3-db',
        sessionId: 'session-wp3-db',
        activeProjectId: projectId,
        accessRevision: 'access-wp3-db',
        policyContextRevision: 'policy-wp3-db',
        sensitivityClearance: 'ALL',
        accessScope: ['owner', 'review'],
      },
      source: target,
      reviewContextId: 'review-context-wp3-db',
      contextRevision: 1,
      generatedAt: now,
    });
    expect(context.context.targetRevision).toBe(String(resource.resourceRevision));
    expect(context.context.targetDigest).toBe(resource.contentDigest);
    expect(context.context.artifactRefs.discoveryLineage?.origin).toBe('DERIVED_DISCOVERY');
    expect(context.context.artifactRefs.discoveryLineage?.candidateRevision).toBe(1);
    await expect(
      adapter.readEvidence({
        scope: {
          principalId: 'principal-wp3-db',
          sessionId: 'session-wp3-db',
          activeProjectId: projectId,
          accessRevision: 'access-wp3-db',
          policyContextRevision: 'policy-wp3-db',
          sensitivityClearance: 'ALL',
          accessScope: ['owner', 'review'],
        },
        source: target,
        reviewItemId: 'item-1',
      }),
    ).resolves.toEqual([]);

    const nextRevisionInput = {
      ...resourceWithoutDigest,
      resourceRevision: 3,
      content: { ...resource.content, summary: 'Explicit immutable resource revision 3' },
    } satisfies Omit<DiscoveryReviewResourceV1, 'contentDigest' | 'createdAt' | 'updatedAt'>;
    const nextRevision: DiscoveryReviewResourceV1 = {
      ...nextRevisionInput,
      contentDigest: discoveryReviewResourceContentDigestV1(nextRevisionInput),
      createdAt: now,
      updatedAt: now,
    };
    await expect(writer.save(nextRevision)).resolves.toBe('CREATED');
    await expect(firstReader.list(projectId)).resolves.toMatchObject([
      { resourceRevision: 3, contentDigest: nextRevision.contentDigest },
    ]);
    await expect(
      pool!.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM discovery.reentry_review_resources
         WHERE project_id = $1 AND review_resource_id = $2`,
        [projectId, resource.reviewResourceId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
  });

  it('does not leak raw WP2 candidates, foreign projects, or conflicting immutable content', async () => {
    const reader = createPostgresReviewDiscoveryCandidateReader(pool!);
    expect(await reader.list('foreign-project')).toEqual([]);
    expect(await reader.find(projectId, resource.candidateId)).toBeUndefined();

    const conflictingInput = {
      ...resourceWithoutDigest,
      content: { ...resource.content, summary: 'conflicting immutable revision' },
    } satisfies Omit<DiscoveryReviewResourceV1, 'contentDigest' | 'createdAt' | 'updatedAt'>;
    const conflicting: DiscoveryReviewResourceV1 = {
      ...conflictingInput,
      contentDigest: discoveryReviewResourceContentDigestV1(conflictingInput),
      createdAt: now,
      updatedAt: now,
    };
    await expect(
      new PostgresDiscoveryReviewResourceRepository(pool!).save(conflicting),
    ).rejects.toThrow(/different immutable content/);
    await expect(
      pool!.query(
        `UPDATE discovery.reentry_review_resources
         SET content_digest = 'sha256:tampered'
         WHERE project_id = $1 AND review_resource_id = $2 AND resource_revision = $3`,
        [projectId, resource.reviewResourceId, resource.resourceRevision],
      ),
    ).rejects.toThrow(/immutable/);
  });
});
