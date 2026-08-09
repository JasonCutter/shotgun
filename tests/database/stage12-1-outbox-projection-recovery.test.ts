import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../adapters/postgres-stage9/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import { dispatchCanonicalOutbox } from '../../modules/canonical-knowledge/src/index.js';
import {
  createApplication,
  runCanonicalProjectionRecovery,
} from '../../assemblies/shotgun-app/src/server.js';
import { createCommand } from '../../packages/kernel/src/index.js';
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
    authorityId: null,
    authorityDigest: null,
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
    authorityId: null,
    authorityDigest: null,
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
  return { projectId, snapshotDigest, claimId, outboxId, commitId };
};

const seedOutboxBatch = async (projectId: string, aggregateId: string) => {
  const outboxIds = ['outbox:batch:01', 'outbox:batch:02', 'outbox:batch:03'];
  for (const [index, outboxId] of outboxIds.entries()) {
    const availableAt = `2026-07-21T00:00:0${index}.000Z`;
    await pool!.query(
      `INSERT INTO canonical.outbox (
         outbox_id, project_id, aggregate_id, event_type, payload_json, status,
         attempts, available_at, claimed_at, published_at
       ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, 'pending', 0, $5, NULL, NULL)`,
      [
        outboxId,
        projectId,
        aggregateId,
        JSON.stringify({ commitId: `commit:batch:${index + 1}` }),
        availableAt,
      ],
    );
  }
  return outboxIds;
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

  it('orders a PostgreSQL Outbox batch and immediately releases failed and unprocessed claims', async () => {
    const fixture = await seedCanonicalProject('project-batch-failure', 'published');
    const outboxIds = await seedOutboxBatch(fixture.projectId, fixture.commitId);
    const first = outboxIds[0]!;
    const second = outboxIds[1]!;
    const third = outboxIds[2]!;
    const canonical = new PostgresCanonicalKnowledgeRepository(pool!);
    const attempted: string[] = [];
    const delivered: string[] = [];

    await expect(
      dispatchCanonicalOutbox(
        canonical,
        {
          async publish(event) {
            const outboxId = event.idempotencyKey.replace('canonical-outbox:', '');
            attempted.push(outboxId);
            if (outboxId === second) throw new Error('simulated second publish failure');
            delivered.push(outboxId);
          },
        },
        fixture.projectId,
        3,
        '2026-07-21T12:00:00.000Z',
      ),
    ).rejects.toThrow('simulated second publish failure');

    expect(attempted).toEqual([first, second]);
    expect(delivered).toEqual([first]);
    await expect(canonical.findOutbox(fixture.projectId, first)).resolves.toMatchObject({
      status: 'published',
      attempts: 1,
    });
    await expect(canonical.findOutbox(fixture.projectId, second)).resolves.toMatchObject({
      status: 'pending',
      attempts: 1,
      claimedAt: undefined,
      lastError: 'OUTBOX_PUBLICATION_FAILED',
    });
    await expect(canonical.findOutbox(fixture.projectId, third)).resolves.toMatchObject({
      status: 'pending',
      attempts: 1,
      claimedAt: undefined,
      lastError: 'OUTBOX_BATCH_INTERRUPTED',
    });
    const processing = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM canonical.outbox
       WHERE project_id = $1 AND status = 'processing'`,
      [fixture.projectId],
    );
    expect(processing.rows[0]).toEqual({ count: '0' });

    const replayDelivered: string[] = [];
    await expect(
      dispatchCanonicalOutbox(
        canonical,
        {
          async publish(event) {
            replayDelivered.push(event.idempotencyKey.replace('canonical-outbox:', ''));
          },
        },
        fixture.projectId,
        3,
        '2026-07-21T12:00:01.000Z',
      ),
    ).resolves.toBe(2);
    expect(replayDelivered).toEqual([second, third]);
    expect(delivered).toEqual([first]);
    await expect(canonical.findOutbox(fixture.projectId, second)).resolves.toMatchObject({
      status: 'published',
      attempts: 2,
    });
    await expect(canonical.findOutbox(fixture.projectId, third)).resolves.toMatchObject({
      status: 'published',
      attempts: 2,
    });
  });

  it('never persists sensitive error details in the Outbox last_error column', async () => {
    const fixture = await seedCanonicalProject('project-sensitive-error', 'published');
    const outboxIds = await seedOutboxBatch(fixture.projectId, fixture.commitId);
    const second = outboxIds[1]!;
    const third = outboxIds[2]!;
    const canonical = new PostgresCanonicalKnowledgeRepository(pool!);

    await expect(
      dispatchCanonicalOutbox(
        canonical,
        {
          async publish(event) {
            const outboxId = event.idempotencyKey.replace('canonical-outbox:', '');
            if (outboxId === second) {
              throw new Error(
                'DATABASE_URL=postgres://admin:password@private-host/shotgun ' +
                  'Authorization: Bearer private-token ' +
                  'payload={"claim":"private canonical content"}',
              );
            }
          },
        },
        fixture.projectId,
        3,
        '2026-07-21T12:00:00.000Z',
      ),
    ).rejects.toThrow();

    const failedRecord = await canonical.findOutbox(fixture.projectId, second);
    expect(failedRecord!.lastError).toBe('OUTBOX_PUBLICATION_FAILED');

    const interruptedRecord = await canonical.findOutbox(fixture.projectId, third);
    expect(interruptedRecord!.lastError).toBe('OUTBOX_BATCH_INTERRUPTED');

    const forbiddenStrings = [
      'postgres://',
      'admin',
      'password',
      'private-host',
      'Authorization',
      'Bearer',
      'private-token',
      'payload',
      'private canonical content',
    ];
    for (const forbidden of forbiddenStrings) {
      expect(failedRecord!.lastError).not.toContain(forbidden);
      expect(interruptedRecord!.lastError).not.toContain(forbidden);
    }
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
  it.each(['STALE', 'DEGRADED'] as const)(
    'rejects Knowledge Discovery when Compiled Truth is %s',
    async (status) => {
      const fixture = await seedCanonicalProject(
        `project-discovery-${status.toLowerCase()}`,
        'published',
      );
      const canonical = new PostgresCanonicalKnowledgeRepository(pool!);
      const search = new PostgresSearchProjectionRepository(pool!);
      const knowledge = new PostgresKnowledgeModelRepository(pool!);
      const compiled = new PostgresCompiledTruthRepository(pool!);

      const degradedSpy = vi
        .spyOn(compiled, 'degradedState')
        .mockResolvedValue(
          status === 'DEGRADED'
            ? { error: 'DEGRADED', updatedAt: '2026-07-21T00:00:00.000Z' }
            : undefined,
        );

      const projectionSpy = vi.spyOn(compiled, 'findProjection').mockResolvedValue(
        status === 'STALE'
          ? {
              projectId: fixture.projectId,
              projectorVersion: '1.0.0',
              sourceSnapshotDigest: 'old',
              logicalDigest: 'old',
              canonicalVersion: -1, // forces STALE
              buildMode: 'FULL_REBUILD',
              items: [],
              graph: {
                nodes: [],
                edges: [],
                fallback: { available: true, modes: ['LIST', 'TABLE'] },
              },
              projectedAt: '2026-07-21T00:00:00.000Z',
            }
          : undefined,
      );

      const app = await createApplication({
        canonicalKnowledgeRepository: canonical,
        searchProjectionRepository: search,
        knowledgeModelRepository: knowledge,
        compiledTruthRepository: compiled,
        canonicalProjectionRecoveryIntervalMs: false,
      });

      const command = createCommand({
        messageType: 'RunKnowledgeDiscovery',
        schemaVersion: '1.0.0',
        producerModule: 'test',
        producerVersion: '1.0.0',
        idempotencyKey: `test-discovery-${status.toLowerCase()}`,
        projectId: fixture.projectId,
        actor: { type: 'user', id: 'owner' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'private',
          dataClassification: 'canonical-recovery',
        },
        payload: { mode: 'INCREMENTAL', maxNodes: 10, maxSuggestions: 10 },
      });

      try {
        await expect(app.kernel.connector.sendCommand(command)).rejects.toMatchObject({
          code: 'CONFLICT',
          safeMessage: 'Compiled Truth is not ready for Knowledge Discovery.',
        });

        const count = await pool!.query(
          `SELECT count(*) FROM projection.discovery_inferences WHERE project_id = $1`,
          [fixture.projectId],
        );
        expect(count.rows[0].count).toBe('0');
      } finally {
        degradedSpy.mockRestore();
        projectionSpy.mockRestore();
        await app.server.close();
      }
    },
  );

  it('never persists sensitive error details when Search Projection update fails', async () => {
    const fixture = await seedCanonicalProject('project-search-sensitive', 'published');
    const canonical = new PostgresCanonicalKnowledgeRepository(pool!);
    const search = new PostgresSearchProjectionRepository(pool!);
    const knowledge = new PostgresKnowledgeModelRepository(pool!);
    const compiled = new PostgresCompiledTruthRepository(pool!);

    const spy = vi
      .spyOn(search, 'rebuild')
      .mockRejectedValue(
        new Error(
          'DATABASE_URL=postgres://admin:password@private-host/shotgun ' +
            'Authorization: Bearer private-token ' +
            'payload={"claim":"private canonical content"} ' +
            'SELECT * FROM canonical.claims',
        ),
      );

    const app = await createApplication({
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: search,
      knowledgeModelRepository: knowledge,
      compiledTruthRepository: compiled,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    await expect(
      app.kernel.connector.sendCommand(
        createCommand({
          messageType: 'RebuildSearchProjection',
          schemaVersion: '1.0.0',
          producerModule: 'test',
          producerVersion: '1.0.0',
          idempotencyKey: 'test-search-sensitive',
          projectId: fixture.projectId,
          actor: { type: 'user', id: 'owner' },
          security: {
            accessScope: ['owner'],
            sensitivity: 'private',
            dataClassification: 'canonical-recovery',
          },
          payload: {},
        }),
      ),
    ).rejects.toBeDefined();

    const watermark = await search.findWatermark(fixture.projectId);
    expect(watermark).toBeDefined();
    expect(watermark!.status).toBe('DEGRADED');
    expect(watermark!.lastError).toBe('SEARCH_PROJECTION_UPDATE_FAILED');

    const forbiddenStrings = [
      'postgres://',
      'admin',
      'password',
      'private-host',
      'Authorization',
      'Bearer',
      'private-token',
      'payload',
      'private canonical content',
      'SELECT',
      'canonical.claims',
    ];
    for (const forbidden of forbiddenStrings) {
      expect(watermark!.lastError).not.toContain(forbidden);
    }

    spy.mockRestore();
    await app.server.close();
  });

  it('never persists sensitive error details when Compiled Truth build fails', async () => {
    const fixture = await seedCanonicalProject('project-compiled-sensitive', 'published');
    const canonical = new PostgresCanonicalKnowledgeRepository(pool!);
    const search = new PostgresSearchProjectionRepository(pool!);
    const knowledge = new PostgresKnowledgeModelRepository(pool!);
    const compiled = new PostgresCompiledTruthRepository(pool!);

    const spy = vi
      .spyOn(compiled, 'synchronize')
      .mockRejectedValue(
        new Error(
          'DATABASE_URL=postgres://admin:password@private-host/shotgun ' +
            'Authorization: Bearer private-token ' +
            'payload={"claim":"private canonical content"} ' +
            'SELECT * FROM canonical.claims',
        ),
      );

    const app = await createApplication({
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: search,
      knowledgeModelRepository: knowledge,
      compiledTruthRepository: compiled,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    await expect(
      app.kernel.connector.sendCommand(
        createCommand({
          messageType: 'BuildCompiledTruth',
          schemaVersion: '1.0.0',
          producerModule: 'test',
          producerVersion: '1.0.0',
          idempotencyKey: 'test-compiled-sensitive',
          projectId: fixture.projectId,
          actor: { type: 'user', id: 'owner' },
          security: {
            accessScope: ['owner'],
            sensitivity: 'private',
            dataClassification: 'canonical-recovery',
          },
          payload: { mode: 'FULL_REBUILD' },
        }),
      ),
    ).rejects.toBeDefined();

    const projection = await pool!.query(
      `SELECT last_error, status FROM projection.compiled_truth WHERE project_id = $1`,
      [fixture.projectId],
    );
    expect(projection.rows[0]?.last_error).toBe('COMPILED_TRUTH_BUILD_FAILED');

    const forbiddenStrings = [
      'postgres://',
      'admin',
      'password',
      'private-host',
      'Authorization',
      'Bearer',
      'private-token',
      'payload',
      'private canonical content',
      'SELECT',
      'canonical.claims',
    ];
    for (const forbidden of forbiddenStrings) {
      expect(projection.rows[0]?.last_error).not.toContain(forbidden);
    }

    spy.mockRestore();
    await app.server.close();
  });
});
