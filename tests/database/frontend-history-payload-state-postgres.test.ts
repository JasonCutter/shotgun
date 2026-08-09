import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

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
});
