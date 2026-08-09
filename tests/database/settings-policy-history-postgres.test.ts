import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import type { PolicyHistoryEntry } from '../../modules/settings-policy/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const appendAuditEvent = async (projectId: string, overrides: Partial<PolicyHistoryEntry>) => {
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  await pool!.query(
    `INSERT INTO settings.settings_audit_events
       (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      eventId,
      projectId,
      overrides.actorId ?? 'actor-1',
      overrides.actionName ?? 'SETTINGS_COMMAND_APPLIED',
      overrides.riskLevel ?? 'LOW',
      JSON.stringify(overrides.details ?? {}),
      overrides.timestamp ?? new Date().toISOString(),
    ],
  );
  return eventId;
};

describe.runIf(pool)('FE-P5-S2 WP2-A Policy History read (PostgreSQL)', () => {
  it('reads project-scoped append-only audit events with keyset pagination', async () => {
    const { PostgresPolicyHistoryReadAdapter } =
      await import('../../adapters/postgres/src/index.js');
    const project = `pg-policy-${randomUUID().slice(0, 8)}`;
    const adapter = new PostgresPolicyHistoryReadAdapter(pool!);

    const t1 = '2026-08-08T00:00:00.000Z';
    const t2 = '2026-08-08T01:00:00.000Z';
    const t3 = '2026-08-08T02:00:00.000Z';
    const id1 = await appendAuditEvent(project, {
      actionName: 'SETTINGS_COMMAND_APPLIED',
      timestamp: t1,
    });
    const id2 = await appendAuditEvent(project, {
      actionName: 'POLICY_CHANGED',
      timestamp: t2,
    });
    await appendAuditEvent(project, { actionName: 'SETTINGS_COMMAND_APPLIED', timestamp: t3 });
    // Another project must not leak in
    const otherProject = `pg-policy-other-${randomUUID().slice(0, 8)}`;
    await appendAuditEvent(otherProject, { actionName: 'LEAK_CHECK', timestamp: t3 });

    const page1 = await adapter.listPolicyHistory({ projectId: project, limit: 2 });
    expect(page1.entries.map((e) => e.actionName)).toEqual([
      'SETTINGS_COMMAND_APPLIED',
      'POLICY_CHANGED',
    ]);
    expect(page1.entries.map((e) => e.eventId)).toEqual([id1, id2]);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await adapter.listPolicyHistory({
      projectId: project,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries[0]!.actionName).toBe('SETTINGS_COMMAND_APPLIED');
    expect(page2.nextCursor).toBeUndefined();

    // The source remains authoritative and immutable: read never mutates.
    const { rows } = await pool!.query(
      `SELECT count(*)::int AS count FROM settings.settings_audit_events WHERE project_id = $1`,
      [project],
    );
    expect(rows[0].count).toBe(3);
  });

  it('rejects invalid inputs with INVALID_REQUEST', async () => {
    const { PostgresPolicyHistoryReadAdapter } =
      await import('../../adapters/postgres/src/index.js');
    const adapter = new PostgresPolicyHistoryReadAdapter(pool!);
    await expect(adapter.listPolicyHistory({ projectId: '', limit: 10 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(adapter.listPolicyHistory({ projectId: 'p', limit: 0 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});
