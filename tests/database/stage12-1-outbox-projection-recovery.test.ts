import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../adapters/postgres-stage9/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import {
  createApplication,
  runCanonicalProjectionRecovery,
} from '../../assemblies/shotgun-app/src/server.js';
import {
  canonicalSnapshotDigest,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalCommittedPayload,
  type CanonicalHistoryEvent,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const seedCanonicalProject = async (
  projectId: string,
  outboxStatus: 'processing' | 'published',
) => {
  const commitId = randomUUID();
  const manifestId = commitId;
  const changeSetId = randomUUID();
  const sourceVersionId = randomUUID();
  const claimId = `claim:${manifestId}`;
  const revisionId = `revision:${manifestId}`;
  const historyEventId = `history:${manifestId}`;
  const outboxId = `outbox:${manifestId}`;
  const createdAt = '2026-07-21T00:00:00.000Z';
  const claim: CanonicalClaim = {
    claimId,
    projectId,
    revisionNumber: 1,
    claimText: `${projectId} survives recovery.`,
    sourceVersionId,
    evidenceIds: [`evidence:${projectId}`],
    createdFromManifestId: manifestId,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt,
  };
  const snapshotDigest = canonicalSnapshotDigest(projectId, 1, [
    {
      claimId,
      text: claim.claimText,
      revisionNumber: 1,
      evidenceIds: claim.evidenceIds,
    },
  ]);
  const commit: CanonicalCommitResult = {
    commitId,
    projectId,
    manifestId,
    manifestDigest: `sha256:${'1'.repeat(64)}`,
    changeSetId,
    operation: 'ADD_CLAIM',
    status: 'COMMITTED',
    beforeVersion: 0,
    afterVersion: 1,
    snapshotDigest,
    claimId,
    revisionId,
    historyEventId,
    outboxId,
    committedAt: createdAt,
  };
  const history: CanonicalHistoryEvent = {
    historyEventId,
    projectId,
    commitId,
    manifestId,
    changeSetId,
    eventType: 'CANONICAL_CLAIM_ADDED',
    beforeVersion: 0,
    afterVersion: 1,
    claimId,
    reason: 'Stage 12.1 recovery fixture.',
    actor: { type: 'user', id: 'owner' },
    createdAt,
  };
  const payload: CanonicalCommittedPayload = {
    commitId,
    manifestId,
    changeSetId,
    operation: 'ADD_CLAIM',
    status: 'COMMITTED',
    canonicalVersion: 1,
    snapshotDigest,
    claimId,
    actorId: 'owner',
    accessScope: ['owner'],
    sensitivity: 'private',
  };

  await pool!.query('BEGIN');
  try {
    await pool!.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 1, $2, $3)`,
      [projectId, snapshotDigest, createdAt],
    );
    await pool!.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [claimId, projectId, sourceVersionId, manifestId, JSON.stringify(claim), createdAt],
    );
    await pool!.query(
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
        createdAt,
      ],
    );
    await pool!.query(
      `INSERT INTO canonical.revisions (
         revision_id, project_id, commit_id, revision_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [revisionId, projectId, commitId, JSON.stringify({ revisionId }), createdAt],
    );
    await pool!.query(
      `INSERT INTO canonical.history_events (
         history_event_id, project_id, commit_id, event_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [historyEventId, projectId, commitId, JSON.stringify(history), createdAt],
    );
    await pool!.query(
      `INSERT INTO canonical.outbox (
         outbox_id, project_id, aggregate_id, event_type, payload_json, status,
         attempts, available_at, claimed_at, published_at
       ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, $5, 1, $6, $7, $8)`,
      [
        outboxId,
        projectId,
        commitId,
        JSON.stringify(payload),
        outboxStatus,
        createdAt,
        outboxStatus === 'processing' ? createdAt : null,
        outboxStatus === 'published' ? createdAt : null,
      ],
    );
    await pool!.query('COMMIT');
  } catch (error) {
    await pool!.query('ROLLBACK');
    throw error;
  }
  return { projectId, snapshotDigest, claimId, outboxId };
};

describe.runIf(pool)('Stage 12.1 Canonical Outbox and Projection recovery', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        projection.discovery_inferences,
        projection.compiled_truth,
        projection.search_documents,
        projection.watermarks,
        knowledge.entity_vault_imports,
        knowledge.review_groups,
        canonical.outbox,
        canonical.history_events,
        canonical.revisions,
        canonical.commits,
        canonical.claims,
        canonical.project_state
      CASCADE
    `);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('recovers stale Outbox and missing projections on startup without duplicate replay', async () => {
    const stale = await seedCanonicalProject('project-stale-outbox', 'processing');
    const published = await seedCanonicalProject('project-published-outbox', 'published');
    const canonical = new PostgresCanonicalKnowledgeRepository(pool!);
    const search = new PostgresSearchProjectionRepository(pool!);
    const knowledge = new PostgresKnowledgeModelRepository(pool!);
    const compiled = new PostgresCompiledTruthRepository(pool!);
    const app = await createApplication({
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: search,
      knowledgeModelRepository: knowledge,
      compiledTruthRepository: compiled,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    for (const fixture of [stale, published]) {
      const outbox = await canonical.findOutbox(fixture.projectId, fixture.outboxId);
      const watermark = await search.findWatermark(fixture.projectId);
      const projection = await compiled.findProjection(fixture.projectId);
      expect(outbox).toMatchObject({ status: 'published' });
      expect(watermark).toMatchObject({
        status: 'READY',
        canonicalVersion: 1,
        snapshotDigest: fixture.snapshotDigest,
      });
      expect(projection).toMatchObject({
        projectId: fixture.projectId,
        canonicalVersion: 1,
        buildMode: 'FULL_REBUILD',
      });
      expect(await search.search(fixture.projectId, 'survives', 10, ['owner'])).toMatchObject([
        { claimId: fixture.claimId },
      ]);
    }

    const replay = await runCanonicalProjectionRecovery(canonical, app.kernel.connector);
    expect(replay).toEqual({
      projects: [
        {
          projectId: 'project-published-outbox',
          status: 'READY',
          outboxPublished: 0,
          searchRebuilt: false,
          compiledTruthRebuilt: false,
        },
        {
          projectId: 'project-stale-outbox',
          status: 'READY',
          outboxPublished: 0,
          searchRebuilt: false,
          compiledTruthRebuilt: false,
        },
      ],
      ready: 2,
      failed: 0,
    });
    const counts = await pool!.query<{
      outbox: string;
      search: string;
      compiled: string;
    }>(`
      SELECT
        (SELECT count(*) FROM canonical.outbox)::text AS outbox,
        (SELECT count(*) FROM projection.search_documents)::text AS search,
        (SELECT count(*) FROM projection.compiled_truth)::text AS compiled
    `);
    expect(counts.rows[0]).toEqual({ outbox: '2', search: '2', compiled: '2' });
    await app.server.close();
  });
});
