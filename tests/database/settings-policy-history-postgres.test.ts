import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const appendAuditEvent = async (
  projectId: string,
  overrides: { actionName?: string; timestamp?: string; details?: Record<string, unknown> },
) => {
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  await pool!.query(
    `INSERT INTO settings.settings_audit_events
       (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
     VALUES ($1, $2, 'actor-1', $3, 'LOW', $4::jsonb, $5)`,
    [
      eventId,
      projectId,
      overrides.actionName ?? 'SETTINGS_COMMAND_APPLIED',
      JSON.stringify(overrides.details ?? {}),
      overrides.timestamp ?? new Date().toISOString(),
    ],
  );
  return eventId;
};

describe.runIf(pool)('FE-P5-S2 WP2-A Policy History read (PostgreSQL)', () => {
  it('reads all three authoritative settings sources with keyset pagination', async () => {
    const { PostgresPolicyHistoryReadAdapter } =
      await import('../../adapters/postgres/src/index.js');
    const project = `pg-policy-${randomUUID().slice(0, 8)}`;
    const adapter = new PostgresPolicyHistoryReadAdapter(pool!);

    const t1 = '2026-08-08T00:00:00.000Z';
    const t2 = '2026-08-08T01:00:00.000Z';
    const t3 = '2026-08-08T02:00:00.000Z';
    // settings_audit_events
    const audit1 = await appendAuditEvent(project, {
      actionName: 'SETTINGS_COMMAND_APPLIED',
      timestamp: t1,
    });
    const audit2 = await appendAuditEvent(project, {
      actionName: 'POLICY_CHANGED',
      timestamp: t2,
    });
    await appendAuditEvent(project, { actionName: 'SETTINGS_COMMAND_APPLIED', timestamp: t3 });
    // settings_revisions
    await pool!.query(
      `INSERT INTO settings.settings_revisions (project_id, revision, settings_snapshot, created_at)
       VALUES ($1, 1, '{"k":"v"}'::jsonb, $2)`,
      [project, t1],
    );
    // policy_context_revisions
    await pool!.query(
      `INSERT INTO settings.policy_context_revisions (project_id, revision, policy_binding, created_at)
       VALUES ($1, 1, '{"policy":"p"}'::jsonb, $2)`,
      [project, '2026-08-08T00:30:00.000Z'],
    );
    // Another project must not leak in
    const otherProject = `pg-policy-other-${randomUUID().slice(0, 8)}`;
    await appendAuditEvent(otherProject, { actionName: 'LEAK_CHECK', timestamp: t3 });

    const page1 = await adapter.listPolicyHistory({ projectId: project, limit: 3 });
    // All three sources exposed, sorted by (timestamp ASC, source_kind ASC
    // lexical, source_id ASC). At t1 (settings_revisions + audit1): lexical
    // 'SETTINGS_AUDIT_EVENT' < 'SETTINGS_REVISION'. policy_context is t=00:30.
    expect(page1.entries.map((e) => e.sourceKind)).toEqual([
      'SETTINGS_AUDIT_EVENT',
      'SETTINGS_REVISION',
      'POLICY_CONTEXT_REVISION',
    ]);
    expect(page1.entries[0]!.sourceId).toBe(audit1);
    expect(page1.entries[0]!.actionName).toBe('SETTINGS_COMMAND_APPLIED');
    expect(page1.entries[1]!.sourceId).toBe('1');
    expect(page1.entries[1]!.details).toEqual({ k: 'v' });
    expect(page1.entries[2]!.sourceId).toBe('1');
    expect(page1.entries[2]!.details).toEqual({ policy: 'p' });
    expect(page1.nextCursor).toBeDefined();

    const page2 = await adapter.listPolicyHistory({
      projectId: project,
      limit: 3,
      cursor: page1.nextCursor,
    });
    // Remaining: audit2 + audit3 (t2, t3)
    expect(page2.entries.map((e) => e.actionName)).toEqual([
      'POLICY_CHANGED',
      'SETTINGS_COMMAND_APPLIED',
    ]);
    expect(page2.entries[0]!.sourceId).toBe(audit2);
    expect(page2.nextCursor).toBeUndefined();

    // The authoritative sources remain immutable: read never mutates.
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
