import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('FE-P5-S2 WP2-B PayloadState (PostgreSQL)', () => {
  it('flips the sidecar to PURGED_BY_POLICY and appends the owner-local purge audit atomically (canonical)', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'CANONICAL');
    const project = `pg-ps-${randomUUID().slice(0, 8)}`;
    const kind = 'DECISION';
    const eventId = `event:${randomUUID().slice(0, 8)}`;
    const now = '2026-08-09T00:00:00.000Z';

    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    expect((await store.getPayloadState(project, kind, eventId))?.payloadAvailability).toBe(
      'AVAILABLE',
    );

    const purged = await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      policyRevision: 'policy/1',
      reason: 'retention',
      tombstoneMetadata: { digest: `sha256:${'a'.repeat(64)}` },
      actorId: 'admin-1',
      occurredAt: now,
    });
    expect(purged.payloadAvailability).toBe('PURGED_BY_POLICY');
    expect(purged.tombstoneMetadata).toEqual({ digest: `sha256:${'a'.repeat(64)}` });

    // purge AuditEvent appended to owner-local stream (identity preserved)
    const audit = await pool!.query(
      `SELECT previous_availability, new_availability, reason, actor_id
       FROM canonical.history_payload_audit_events
       WHERE resource_project_id = $1 AND source_event_kind = $2 AND source_event_id = $3`,
      [project, kind, eventId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.previous_availability).toBe('AVAILABLE');
    expect(audit.rows[0]!.new_availability).toBe('PURGED_BY_POLICY');
    expect(audit.rows[0]!.reason).toBe('retention');
    expect(audit.rows[0]!.actor_id).toBe('admin-1');

    // Re-purge rejected
    await expect(
      store.purgeByPolicy({
        resourceProjectId: project,
        sourceEventKind: kind,
        sourceEventId: eventId,
        reason: 'second',
        actorId: 'admin-1',
        occurredAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await pool!.query(
      `DELETE FROM canonical.history_payload_state WHERE resource_project_id = $1`,
      [project],
    );
  });

  it('appends purge audit to the reused settings audit stream (SETTINGS owner)', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'SETTINGS');
    const project = `pg-ps-set-${randomUUID().slice(0, 8)}`;
    const kind = 'SETTINGS_COMMAND_APPLIED';
    const eventId = `event:${randomUUID().slice(0, 8)}`;
    const now = '2026-08-09T00:00:00.000Z';

    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      payloadAvailability: 'UNAVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      policyRevision: 'policy/2',
      reason: 'retention',
      actorId: 'admin-1',
      occurredAt: now,
    });

    const audit = await pool!.query(
      `SELECT action_name, details, actor_id
       FROM settings.settings_audit_events
       WHERE project_id = $1 AND action_name = 'HISTORY_PAYLOAD_PURGED'`,
      [project],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.action_name).toBe('HISTORY_PAYLOAD_PURGED');
    expect(audit.rows[0]!.details).toMatchObject({
      sourceEventId: eventId,
      newAvailability: 'PURGED_BY_POLICY',
      previousAvailability: 'UNAVAILABLE',
      policyRevision: 'policy/2',
    });
    expect(audit.rows[0]!.actor_id).toBe('admin-1');

    await pool!.query(`DELETE FROM settings.history_payload_state WHERE resource_project_id = $1`, [
      project,
    ]);
  });

  it('rejects invalid inputs', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'EXTERNAL_ACTION');
    await expect(
      store.setPayloadState({
        resourceProjectId: '',
        sourceEventKind: 'DECISION',
        sourceEventId: 'e',
        payloadAvailability: 'AVAILABLE',
        reason: 'x',
        actorId: 'a',
        changedAt: '2026-08-09T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects direct set of PURGED_BY_POLICY and resurrection after purge', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'CANONICAL');
    const project = `pg-ps-guard-${randomUUID().slice(0, 8)}`;
    const kind = 'DECISION';
    const eventId = `event:${randomUUID().slice(0, 8)}`;
    const now = '2026-08-09T00:00:00.000Z';

    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    // Direct set PURGED_BY_POLICY rejected
    await expect(
      store.setPayloadState({
        resourceProjectId: project,
        sourceEventKind: kind,
        sourceEventId: eventId,
        payloadAvailability: 'PURGED_BY_POLICY',
        reason: 'bypass',
        actorId: 'actor-1',
        changedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      reason: 'retention',
      actorId: 'admin-1',
      occurredAt: now,
    });
    // Resurrection rejected
    await expect(
      store.setPayloadState({
        resourceProjectId: project,
        sourceEventKind: kind,
        sourceEventId: eventId,
        payloadAvailability: 'AVAILABLE',
        reason: 'resurrect',
        actorId: 'actor-1',
        changedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await pool!.query(
      `DELETE FROM canonical.history_payload_state WHERE resource_project_id = $1`,
      [project],
    );
  });

  it('resolves External Action sourceEventId to action_id server-side (RESULT + AUDIT_EVENT)', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'EXTERNAL_ACTION');
    const project = `pg-ps-ea-${randomUUID().slice(0, 8)}`;
    const actionId = `action:${randomUUID().slice(0, 8)}`;
    const resultId = `result:${randomUUID().slice(0, 8)}`;
    const auditEventId = `audit:${randomUUID().slice(0, 8)}`;
    const now = '2026-08-09T00:00:00.000Z';

    // Seed an External Action aggregate + result + audit event
    await pool!.query(
      `INSERT INTO frontend_external_action.aggregates
         (action_id, resource_project_id, effective_project_id, status, aggregate_state,
          action_revision, access_revision, policy_context_revision, snapshot, created_at, updated_at)
       VALUES ($1, $2, $2, 'ACCEPTED', 'READY', 1, 'access/1', 'policy/1', '{}'::jsonb, $3, $3)`,
      [actionId, project, now],
    );
    await pool!.query(
      `INSERT INTO frontend_external_action.results (result_id, action_id, resource_project_id, effective_project_id, snapshot, created_at)
       VALUES ($1, $2, $3, $3, '{}'::jsonb, $4)`,
      [resultId, actionId, project, now],
    );
    await pool!.query(
      `INSERT INTO frontend_external_action.audit_events
         (audit_event_id, action_id, resource_project_id, effective_project_id, sequence, category, snapshot, occurred_at)
       VALUES ($1, $2, $3, $3, 1, 'RESULT_RECORDED', '{}'::jsonb, $4)`,
      [auditEventId, actionId, project, now],
    );

    // RESULT source -> resolved action_id -> purge audit on that action
    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: 'RESULT',
      sourceEventId: resultId,
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: 'RESULT',
      sourceEventId: resultId,
      reason: 'retention',
      actorId: 'admin-1',
      occurredAt: now,
    });
    // AUDIT_EVENT source -> resolved action_id -> purge audit on that action
    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: 'AUDIT_EVENT',
      sourceEventId: auditEventId,
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: 'AUDIT_EVENT',
      sourceEventId: auditEventId,
      reason: 'retention',
      actorId: 'admin-1',
      occurredAt: now,
    });

    const audit = await pool!.query(
      `SELECT action_id, sequence, category, snapshot
       FROM frontend_external_action.audit_events
       WHERE action_id = $1 AND category = 'HISTORY_PAYLOAD_PURGED'
       ORDER BY sequence ASC`,
      [actionId],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0]!.action_id).toBe(actionId);
    expect(audit.rows[0]!.sequence).toBe(2);
    expect(audit.rows[0]!.snapshot).toMatchObject({
      sourceEventKind: 'RESULT',
      sourceEventId: resultId,
      newAvailability: 'PURGED_BY_POLICY',
    });
    expect(audit.rows[1]!.sequence).toBe(3);
    expect(audit.rows[1]!.snapshot).toMatchObject({
      sourceEventKind: 'AUDIT_EVENT',
      sourceEventId: auditEventId,
      newAvailability: 'PURGED_BY_POLICY',
    });

    // Unknown source -> resolution fails
    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: 'RESULT',
      sourceEventId: `result:missing-${randomUUID().slice(0, 8)}`,
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await expect(
      store.purgeByPolicy({
        resourceProjectId: project,
        sourceEventKind: 'RESULT',
        sourceEventId: `result:missing-${randomUUID().slice(0, 8)}`,
        reason: 'retention',
        actorId: 'admin-1',
        occurredAt: now,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // audit_events is append-only (INSERT allowed, UPDATE/DELETE/TRUNCATE
    // forbidden), so the purge audit rows created by this test remain; they
    // are isolated by the unique action/project prefix and cannot collide
    // with other tests. Clean up the remaining mutable rows only.
    await pool!.query(
      `DELETE FROM frontend_external_action.results WHERE resource_project_id = $1`,
      [project],
    );
    await pool!.query(
      `DELETE FROM frontend_external_action.history_payload_state WHERE resource_project_id = $1`,
      [project],
    );
    await pool!.query(
      `DELETE FROM frontend_external_action.aggregates WHERE resource_project_id = $1`,
      [project],
    );
  });

  it('sanitizes the persistent History projection cache on purge (Round 3 F)', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'CANONICAL');
    const project = `pg-ps-cache-${randomUUID().slice(0, 8)}`;
    const kind = 'CANONICAL_CLAIM_ADDED';
    const now = '2026-08-09T00:00:00.000Z';

    const seedProjectionRow = async (eventId: string) => {
      await pool!.query(
        `INSERT INTO frontend_history.history_projection_index
           (resource_project_id, history_entry_id, domain_kind, domain_resource_kind,
            domain_resource_id, source_event_kind, source_event_id, occurred_at,
            payload_availability, payload_snapshot, projected_at)
         VALUES ($1, $2, 'CANONICAL', 'CANONICAL_CLAIM', $3, $4, $5, $6, 'AVAILABLE', $7, $6)`,
        [
          project,
          `history:${project}:${eventId}`,
          `claim:${eventId}`,
          kind,
          eventId,
          now,
          JSON.stringify({ reason: 'secret-payload', actor: 'alice' }),
        ],
      );
    };
    const readProjectionRow = async (eventId: string) => {
      const row = await pool!.query<{
        payload_availability: string;
        payload_snapshot: Record<string, unknown> | null;
      }>(
        `SELECT payload_availability, payload_snapshot
         FROM frontend_history.history_projection_index
         WHERE resource_project_id = $1 AND source_event_kind = $2 AND source_event_id = $3`,
        [project, kind, eventId],
      );
      return row.rows[0];
    };

    // 1. Purge WITHOUT tombstone metadata: the cached raw payload must be
    //    explicitly removed from persistent storage (the Round 3 F gap — an
    //    absent tombstone previously left the old raw snapshot in place).
    const eventA = `event:${randomUUID().slice(0, 8)}`;
    await seedProjectionRow(eventA);
    await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventA,
      reason: 'retention',
      actorId: 'admin-1',
      occurredAt: now,
    });
    const rowA = await readProjectionRow(eventA);
    expect(rowA!.payload_availability).toBe('PURGED_BY_POLICY');
    expect(rowA!.payload_snapshot).toBeNull();

    // 2. Purge WITH tombstone metadata: the tombstone replaces the raw payload.
    const eventB = `event:${randomUUID().slice(0, 8)}`;
    await seedProjectionRow(eventB);
    await store.purgeByPolicy({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventB,
      reason: 'retention',
      tombstoneMetadata: { digest: 'sha256:redacted' },
      actorId: 'admin-1',
      occurredAt: now,
    });
    const rowB = await readProjectionRow(eventB);
    expect(rowB!.payload_availability).toBe('PURGED_BY_POLICY');
    expect(rowB!.payload_snapshot).toEqual({ digest: 'sha256:redacted' });

    // 3. setPayloadState transition to REDACTED also sanitizes the cache.
    const eventC = `event:${randomUUID().slice(0, 8)}`;
    await seedProjectionRow(eventC);
    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventC,
      payloadAvailability: 'REDACTED',
      reason: 'retention',
      actorId: 'admin-1',
      changedAt: now,
    });
    const rowC = await readProjectionRow(eventC);
    expect(rowC!.payload_availability).toBe('REDACTED');
    expect(rowC!.payload_snapshot).toBeNull();

    await pool!.query(
      `DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1`,
      [project],
    );
    await pool!.query(
      `DELETE FROM canonical.history_payload_state WHERE resource_project_id = $1`,
      [project],
    );
    // canonical.history_payload_audit_events is append-only (no DELETE); the
    // purge audit rows left by this test are isolated by the unique project
    // prefix and cannot collide with other tests.
  });

  it('setPayloadState rolls back the sidecar transition when projection sanitize fails (Round 4 F2-B)', async () => {
    const { PostgresPayloadStateStore } =
      await import('../../adapters/frontend-history-postgres/src/index.js');
    const store = new PostgresPayloadStateStore(pool!, 'CANONICAL');
    const project = `pg-ps-txn-${randomUUID().slice(0, 8)}`;
    const kind = 'CANONICAL_CLAIM_ADDED';
    const eventId = `event:${randomUUID().slice(0, 8)}`;
    const now = '2026-08-09T00:00:00.000Z';

    // Seed an AVAILABLE sidecar state.
    await store.setPayloadState({
      resourceProjectId: project,
      sourceEventKind: kind,
      sourceEventId: eventId,
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });

    // Make the projection sanitize fail INSIDE the setPayloadState
    // transaction: the whole transition must roll back (sidecar included).
    const originalConnect = pool!.connect.bind(pool!);
    const connectSpy = vi.spyOn(pool!, 'connect');
    connectSpy.mockImplementation(async () => {
      const client = await originalConnect();
      const originalClientQuery = client.query.bind(client);
      client.query = ((sql: unknown, ...args: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('frontend_history.history_projection_index')) {
          return Promise.reject(new Error('projection sanitize simulated failure'));
        }
        return (originalClientQuery as (...a: unknown[]) => Promise<unknown>)(sql, ...args);
      }) as typeof client.query;
      return client;
    });

    try {
      await expect(
        store.setPayloadState({
          resourceProjectId: project,
          sourceEventKind: kind,
          sourceEventId: eventId,
          payloadAvailability: 'REDACTED',
          reason: 'retention',
          actorId: 'admin-1',
          changedAt: now,
        }),
      ).rejects.toThrow(/projection sanitize simulated failure/);
    } finally {
      connectSpy.mockRestore();
    }

    // The sidecar transition must NOT have been committed (full rollback):
    // partial retention state (sidecar REDACTED + projection AVAILABLE) is
    // impossible.
    const state = await store.getPayloadState(project, kind, eventId);
    expect(state?.payloadAvailability).toBe('AVAILABLE');

    await pool!.query(
      `DELETE FROM canonical.history_payload_state WHERE resource_project_id = $1`,
      [project],
    );
  });
});
