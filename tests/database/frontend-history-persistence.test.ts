import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('FE-P5-S2 WP1 persistence (migrations 030-032)', () => {
  it('accepts same source_event_id with different source_event_kind in payload sidecars', async () => {
    // Uses canonical.history_payload_state (migration 032 sidecar) which is not
    // dropped by per-schema rollback tests that only touch frontend_review /
    // frontend_knowledge_graph / frontend_external_action.
    const project = `pg-hist-${randomUUID().slice(0, 8)}`;
    await pool!.query(
      `INSERT INTO canonical.history_payload_state
         (resource_project_id, source_event_kind, source_event_id, payload_availability, changed_at, reason)
       VALUES ($1, 'DECISION', 'event:same', 'AVAILABLE', now(), 'test')`,
      [project],
    );
    await pool!.query(
      `INSERT INTO canonical.history_payload_state
         (resource_project_id, source_event_kind, source_event_id, payload_availability, changed_at, reason)
       VALUES ($1, 'APPROVAL', 'event:same', 'AVAILABLE', now(), 'test')`,
      [project],
    );
    const { rows } = await pool!.query(
      `SELECT count(*)::int AS count FROM canonical.history_payload_state
        WHERE resource_project_id = $1 AND source_event_id = 'event:same'`,
      [project],
    );
    expect(rows[0].count).toBe(2);
    await pool!.query(
      `DELETE FROM canonical.history_payload_state WHERE resource_project_id = $1`,
      [project],
    );
  });

  it('rejects UPDATE and DELETE on reused settings history sources but allows INSERT', async () => {
    // INSERT allowed
    const project = `pg-hist-${randomUUID().slice(0, 8)}`;
    await pool!.query(
      `INSERT INTO settings.settings_audit_events (event_id, project_id, actor_id, action_name, risk_level, details)
       VALUES ($1, $2, 'actor:1', 'TEST_ACTION', 'LOW', '{}'::jsonb)`,
      [`event:${randomUUID().slice(0, 8)}`, project],
    );
    await pool!.query(
      `INSERT INTO settings.settings_revisions (project_id, revision, settings_snapshot)
       VALUES ($1, 1, '{}'::jsonb)`,
      [project],
    );

    // UPDATE rejected
    await expect(
      pool!.query(
        `UPDATE settings.settings_audit_events SET risk_level = 'HIGH' WHERE project_id = $1`,
        [project],
      ),
    ).rejects.toThrow();
    await expect(
      pool!.query(
        `UPDATE settings.settings_revisions SET settings_snapshot = '{"x":1}'::jsonb WHERE project_id = $1`,
        [project],
      ),
    ).rejects.toThrow();

    // DELETE rejected
    await expect(
      pool!.query(`DELETE FROM settings.settings_audit_events WHERE project_id = $1`, [project]),
    ).rejects.toThrow();
    await expect(
      pool!.query(`DELETE FROM settings.settings_revisions WHERE project_id = $1`, [project]),
    ).rejects.toThrow();

    // TRUNCATE rejected (statement-level append-only guard, migration 032)
    await expect(pool!.query(`TRUNCATE settings.settings_audit_events`)).rejects.toThrow();
    await expect(pool!.query(`TRUNCATE settings.settings_revisions`)).rejects.toThrow();
    await expect(pool!.query(`TRUNCATE settings.policy_context_revisions`)).rejects.toThrow();
  });

  it('keeps owner-local purge audit streams append-only (canonical + frontend_review, 032)', async () => {
    const project = `pg-audit-${randomUUID().slice(0, 8)}`;
    const insertAudit = (schema: 'canonical' | 'frontend_review') =>
      pool!.query(
        `INSERT INTO ${schema}.history_payload_audit_events
           (audit_event_id, resource_project_id, source_event_kind, source_event_id,
            previous_availability, new_availability, reason, actor_id, occurred_at)
         VALUES ($1, $2, 'DECISION', 'event:1', 'AVAILABLE', 'PURGED_BY_POLICY', 'retention', 'actor:1', now())`,
        [`audit:${randomUUID().slice(0, 8)}`, project],
      );

    // INSERT allowed on both owner-local streams
    await insertAudit('canonical');
    await insertAudit('frontend_review');
    for (const schema of ['canonical', 'frontend_review'] as const) {
      const { rows } = await pool!.query(
        `SELECT count(*)::int AS count FROM ${schema}.history_payload_audit_events
          WHERE resource_project_id = $1`,
        [project],
      );
      expect(rows[0].count).toBe(1);
      // Purge-only invariant: new_availability must be PURGED_BY_POLICY
      await expect(
        pool!.query(
          `INSERT INTO ${schema}.history_payload_audit_events
             (audit_event_id, resource_project_id, source_event_kind, source_event_id,
              previous_availability, new_availability, reason, actor_id, occurred_at)
           VALUES ($1, $2, 'DECISION', 'event:2', 'AVAILABLE', 'REDACTED', 'x', 'actor:1', now())`,
          [`audit:${randomUUID().slice(0, 8)}`, project],
        ),
      ).rejects.toThrow(/new_availability/);
      await expect(
        pool!.query(
          `INSERT INTO ${schema}.history_payload_audit_events
             (audit_event_id, resource_project_id, source_event_kind, source_event_id,
              previous_availability, new_availability, reason, actor_id, occurred_at)
           VALUES ($1, $2, 'DECISION', 'event:3', 'AVAILABLE', 'AVAILABLE', 'x', 'actor:1', now())`,
          [`audit:${randomUUID().slice(0, 8)}`, project],
        ),
      ).rejects.toThrow(/new_availability/);
      // previous_availability must not already be PURGED_BY_POLICY
      await expect(
        pool!.query(
          `INSERT INTO ${schema}.history_payload_audit_events
             (audit_event_id, resource_project_id, source_event_kind, source_event_id,
              previous_availability, new_availability, reason, actor_id, occurred_at)
           VALUES ($1, $2, 'DECISION', 'event:4', 'PURGED_BY_POLICY', 'PURGED_BY_POLICY', 'x', 'actor:1', now())`,
          [`audit:${randomUUID().slice(0, 8)}`, project],
        ),
      ).rejects.toThrow(/previous_availability|new_availability/);
      // UPDATE rejected
      await expect(
        pool!.query(
          `UPDATE ${schema}.history_payload_audit_events SET reason = 'x' WHERE resource_project_id = $1`,
          [project],
        ),
      ).rejects.toThrow();
      // DELETE rejected
      await expect(
        pool!.query(
          `DELETE FROM ${schema}.history_payload_audit_events WHERE resource_project_id = $1`,
          [project],
        ),
      ).rejects.toThrow();
      // TRUNCATE rejected (statement-level guard)
      await expect(
        pool!.query(`TRUNCATE ${schema}.history_payload_audit_events`),
      ).rejects.toThrow();
    }
  });
});
