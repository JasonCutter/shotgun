import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CanonicalHistoryAdapter } from '../../adapters/frontend-history-canonical/src/index.js';
import { InMemoryPayloadStateStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresCanonicalKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/canonical-owner.js';
import {
  PostgresHistoryKnowledgeResetOwner,
  PostgresKnowledgeResetPersistence,
  type HistoryResetProjection,
} from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 History projection erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;
  let runtimePool: Pool;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    const password = randomUUID();
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = 'shotgun_erasure_executor';
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString(), max: 1 });
    await executorPool.query('SELECT 1');

    const runtimePassword = randomUUID();
    await adminPool.query(`ALTER ROLE shotgun_runtime LOGIN PASSWORD ${literal(runtimePassword)}`);
    const runtimeConnection = new URL(database.databaseUrl);
    runtimeConnection.username = 'shotgun_runtime';
    runtimeConnection.password = runtimePassword;
    runtimePool = new Pool({ connectionString: runtimeConnection.toString(), max: 1 });
    await runtimePool.query('SELECT 1');
  });

  afterAll(async () => {
    await runtimePool?.end();
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_runtime NOLOGIN PASSWORD NULL');
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const createProject = async (projectId: string) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 History fixture', 'ACTIVE', true)`,
      [projectId],
    );
  };

  const createReset = async (projectId: string): Promise<KnowledgeResetOwnerContext> => {
    const requestId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests (
         request_id, preview_id, project_id, actor_principal_id, project_revision,
         expected_knowledge_epoch, resulting_knowledge_epoch, manifest_digest,
         owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         state, impact_counts
       ) VALUES ($1, $2, $3, 't3-history-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, hash('b'), hash('c'), hash('d'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest: hash('b') as `sha256:${string}`,
    };
  };

  const setState = async (context: KnowledgeResetOwnerContext, state: string) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [context.projectId, context.requestId, state, []],
    );
  };

  const addHistoryEntry = async (projectId: string, entryId: string, canary: string) => {
    await adminPool.query(
      `INSERT INTO frontend_history.history_projection_index (
         resource_project_id, history_entry_id, domain_kind, domain_resource_kind,
         domain_resource_id, source_event_kind, source_event_id, source_sequence,
         occurred_at, payload_availability, payload_snapshot, projected_at
       ) VALUES ($1, $2, 'CANONICAL', 'CanonicalCommit', $3, 'COMMIT', $4, 1,
                 now(), 'AVAILABLE', $5::jsonb, now())`,
      [projectId, entryId, `commit-${entryId}`, `event-${entryId}`, JSON.stringify({ canary })],
    );
  };

  const addWatermark = async (projectId: string, adapterId: string, domainKind: string) => {
    await adminPool.query(
      `INSERT INTO frontend_history.projection_watermarks (
         resource_project_id, adapter_id, domain_kind, projected_at,
         adapter_status, snapshot_revision
       ) VALUES ($1, $2, $3, now(), 'AVAILABLE', 5)`,
      [projectId, adapterId, domainKind],
    );
  };

  it('removes stale History payloads and rebuilds the four owner projections', async () => {
    const projectId = `t3-history-${randomUUID()}`;
    const otherProjectId = `${projectId}-other`;
    await createProject(projectId);
    await createProject(otherProjectId);
    await addHistoryEntry(projectId, 'old-source-event', 'T3_HISTORY_SOURCE_CANARY');
    await addHistoryEntry(projectId, 'independent-before-reset', 'OLD_POLICY_PAYLOAD');
    await addWatermark(projectId, 'canonical-history', 'CANONICAL');
    await addHistoryEntry(otherProjectId, 'other-event', 'OTHER_PROJECT_HISTORY');
    await addWatermark(otherProjectId, 'canonical-history-other', 'CANONICAL');

    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.rebuildProjectionCount).toBeGreaterThanOrEqual(3);

    const context = await createReset(projectId);
    await expect(
      new PostgresKnowledgeResetPersistence(runtimePool).readResetActorPrincipalId(
        projectId,
        context.requestId,
      ),
    ).resolves.toBe('t3-history-test');
    await expect(
      executorPool.query('SELECT project_admin.t3_read_reset_actor($1, $2::uuid)', [
        projectId,
        context.requestId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    const canonicalOwner = new PostgresCanonicalKnowledgeResetOwner(executorPool);
    await canonicalOwner.fence(context);
    const now = new Date().toISOString();
    const domains = ['CANONICAL', 'REVIEW', 'EXTERNAL_ACTION', 'POLICY'] as const;
    const projection: { value?: HistoryResetProjection } = {};
    const owner = new PostgresHistoryKnowledgeResetOwner(executorPool, {
      async rebuildProjectHistory(input) {
        expect(input).toEqual(context);
        if (!projection.value) throw new Error('History fixture projection was not prepared.');
        return projection.value;
      },
    });

    await owner.fence(context);
    await expect(
      adminPool.query(
        'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1',
        [projectId],
      ),
    ).rejects.toMatchObject({ constraint: 'project_knowledge_reset_write_fence' });
    await setState(context, 'PURGING');
    await owner.purge(context);
    await canonicalOwner.purge(context);
    await owner.purge(context);
    const canonical = new PostgresCanonicalKnowledgeRepository(adminPool);
    const canonicalHistory = new CanonicalHistoryAdapter(
      canonical,
      new InMemoryPayloadStateStore('CANONICAL'),
      () => new Date(now),
    );
    const resetEntries = await canonicalHistory.readHistory(projectId);
    const resetEntry = resetEntries.find(
      (entry) => entry.sourceEventKind === 'CANONICAL_KNOWLEDGE_RESET',
    );
    expect(resetEntry).toMatchObject({
      domainResourceKind: 'CANONICAL_KNOWLEDGE_RESET',
      domainResourceId: context.requestId,
      sourceEventKind: 'CANONICAL_KNOWLEDGE_RESET',
      payloadAvailability: 'AVAILABLE',
    });
    if (!resetEntry) throw new Error('Canonical reset event was not projected by its adapter.');
    await expect(
      new PostgresCanonicalKnowledgeRepository(runtimePool).listKnowledgeResetEvents(projectId),
    ).resolves.toMatchObject([{ eventId: resetEntry.sourceEventId, requestId: context.requestId }]);
    await expect(
      runtimePool.query('SELECT canonical.t3_publish_project_knowledge_reset_event($1, $2::uuid)', [
        projectId,
        context.requestId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    projection.value = {
      entries: [
        ...(resetEntry === undefined ? [] : [resetEntry]),
        {
          schemaVersion: '1.0.0',
          historyEntryId: 'surviving-policy-entry',
          resourceProjectId: projectId,
          domainKind: 'POLICY',
          domainResourceKind: 'PolicyRevision',
          domainResourceId: 'policy-revision-1',
          sourceEventKind: 'POLICY_REVISION',
          sourceEventId: 'policy-event-1',
          occurredAt: now,
          payloadAvailability: 'AVAILABLE',
          payloadSnapshot: { policy: 'independent' },
          projectedAt: now,
        },
      ],
      watermarks: domains.map((domainKind) => ({
        resourceProjectId: projectId,
        adapterId: `${domainKind.toLowerCase()}-history`,
        domainKind,
        projectedAt: now,
        adapterStatus: 'AVAILABLE' as const,
        snapshotRevision: 1,
      })),
      partial: false,
      failures: [],
    };
    await setState(context, 'REBUILDING');
    await expect(
      executorPool.query(
        'SELECT canonical.t3_publish_project_knowledge_reset_event($1, $2::uuid)',
        [projectId, context.requestId],
      ),
    ).rejects.toMatchObject({ constraint: 't3_canonical_reset_history_missing' });
    await owner.rebuild(context);
    await expect(owner.verify(context)).resolves.toEqual({ verified: true, blockerCodes: [] });

    const rows = await adminPool.query<{
      source_event_kind: string;
      payload_availability: string;
      payload_snapshot: unknown;
    }>(
      `SELECT source_event_kind, payload_availability, payload_snapshot
       FROM frontend_history.history_projection_index WHERE resource_project_id = $1
       ORDER BY source_event_kind`,
      [projectId],
    );
    expect(rows.rows).toEqual([
      {
        source_event_kind: 'CANONICAL_KNOWLEDGE_RESET',
        payload_availability: 'AVAILABLE',
        payload_snapshot: expect.objectContaining({
          eventType: 'CANONICAL_KNOWLEDGE_RESET',
          requestId: context.requestId,
          resultingKnowledgeEpoch: 1,
          stateVersion: 1,
        }),
      },
      {
        source_event_kind: 'POLICY_REVISION',
        payload_availability: 'AVAILABLE',
        payload_snapshot: { policy: 'independent' },
      },
    ]);
    const published = await adminPool.query<{ published_at: Date | null }>(
      'SELECT published_at FROM canonical.knowledge_reset_events WHERE event_id = $1::uuid',
      [resetEntry.sourceEventId],
    );
    expect(published.rows[0]?.published_at).toBeInstanceOf(Date);
    await expect(canonical.listKnowledgeResetEvents(projectId)).resolves.toMatchObject([
      {
        eventId: resetEntry.sourceEventId,
        requestId: context.requestId,
        publishedAt: expect.any(String),
      },
    ]);
    const canary = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM frontend_history.history_projection_index
       WHERE resource_project_id = $1 AND payload_snapshot::text LIKE '%CANARY%'`,
      [projectId],
    );
    expect(canary.rows[0]?.count).toBe('0');
    const otherRows = await adminPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_history.history_projection_index WHERE resource_project_id = $1',
      [otherProjectId],
    );
    expect(otherRows.rows[0]?.count).toBe('1');
  }, 60_000);

  it('rejects a History rebuild that omits an owner watermark', async () => {
    const projectId = `t3-history-partial-${randomUUID()}`;
    await createProject(projectId);
    const context = await createReset(projectId);
    const owner = new PostgresHistoryKnowledgeResetOwner(executorPool, {
      async rebuildProjectHistory() {
        return { entries: [], watermarks: [], partial: false, failures: [] };
      },
    });
    await owner.fence(context);
    await setState(context, 'PURGING');
    await owner.purge(context);
    await setState(context, 'REBUILDING');
    await expect(owner.rebuild(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
      terminalState: 'ERASURE_UNVERIFIED',
    });
  });
});
