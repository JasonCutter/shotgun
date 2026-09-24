import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

describe('ADR-171 PostgreSQL Source knowledge impact inspection', () => {
  it('classifies Source and shared CAS impacts without returning source data', async () => {
    const database = await createIsolatedPostgresTestDatabase();
    const pool = database.createPool();
    const projectId = `t3-impact-${randomUUID()}`;
    const otherProjectId = `t3-impact-other-${randomUUID()}`;
    const sourceId = randomUUID();
    const otherSourceId = randomUUID();
    const versionId = randomUUID();
    const otherVersionId = randomUUID();
    const assetId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');

    try {
      await pool.query(
        `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, 12, $3, $4)`,
        [assetId, `sha256:${'a'.repeat(64)}`, `sha256/${'a'.repeat(64)}`, now],
      );
      await pool.query(
        `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
         VALUES ($1, $2, 'owner', $3), ($4, $5, 'other-owner', $3)`,
        [sourceId, projectId, now, otherSourceId, otherProjectId],
      );
      await pool.query(
        `INSERT INTO asset.source_versions (
           source_version_id, source_id, version_number, original_asset_id, media_type,
           access_scope, sensitivity, created_at
         ) VALUES
           ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4),
           ($5, $6, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
        [versionId, sourceId, assetId, now, otherVersionId, otherSourceId],
      );

      const impact = await new PostgresKnowledgeResetImpactInspector(
        pool,
      ).inspectProjectSourceKnowledge(projectId);
      expect(impact.counts).toMatchObject({
        sourceCount: 1,
        sourceVersionCount: 1,
        sharedAssetCount: 1,
      });
      expect(impact.blockers).not.toContain('UNCLASSIFIED_CONTENT');
      expect(impact.blockers).toContain('ERASURE_EXECUTOR_UNAVAILABLE');
      expect(impact.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(JSON.stringify(impact)).not.toContain(sourceId);
      expect(JSON.stringify(impact)).not.toContain(versionId);
      expect(JSON.stringify(impact)).not.toContain(`sha256/${'a'.repeat(64)}`);
    } finally {
      await database.dispose();
    }
  }, 15_000);

  it('keeps an independent Ask conversation while classifying it as preserved', async () => {
    const database = await createIsolatedPostgresTestDatabase();
    const pool = database.createPool();
    const projectId = `t3-impact-conditional-${randomUUID()}`;
    const now = new Date('2026-09-23T01:00:00.000Z');
    try {
      await pool.query(
        `INSERT INTO project_admin.projects (id, name, description, status, active)
         VALUES ($1, 'T3 impact fixture', 'preserve', 'ACTIVE', true)`,
        [projectId],
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO frontend_ask.conversations (
           conversation_id, project_id, title, active_branch_id, conversation_revision,
           created_at, updated_at
         ) VALUES ($1, $2, 'Conversation title', $3, '1', $4, $4)`,
          [`conversation-${projectId}`, projectId, `branch-${projectId}`, now],
        );
        await client.query(
          `INSERT INTO frontend_ask.branches (
             branch_id, conversation_id, label, branch_revision, created_at, updated_at
           ) VALUES ($1, $2, 'Main', '1', $3, $3)`,
          [`branch-${projectId}`, `conversation-${projectId}`, now],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const impact = await new PostgresKnowledgeResetImpactInspector(
        pool,
      ).inspectProjectSourceKnowledge(projectId);
      expect(impact.blockers).not.toContain('UNCLASSIFIED_CONTENT');
      expect(impact.counts.blockedRecordCount).toBe(0);
      expect(impact.counts.sourceCount).toBe(0);
      expect(JSON.stringify(impact)).not.toContain('Conversation title');
    } finally {
      await database.dispose();
    }
  });

  it('blocks Project audit tombstones that can retain unclassified free text', async () => {
    const database = await createIsolatedPostgresTestDatabase();
    const pool = database.createPool();
    const projectId = `t3-impact-audit-${randomUUID()}`;
    const canary = `source-audit-canary-${randomUUID()}`;
    try {
      await pool.query(
        `INSERT INTO project_audit.project_tombstones (
           project_id, deleted_at, deleted_by, reason, retention_class, lineage_digest
         ) VALUES ($1, now(), 't3-test', $2, 'test', $3)`,
        [projectId, canary, `sha256:${'b'.repeat(64)}`],
      );

      const impact = await new PostgresKnowledgeResetImpactInspector(
        pool,
      ).inspectProjectSourceKnowledge(projectId);
      expect(impact.blockers).toContain('UNCLASSIFIED_CONTENT');
      expect(impact.counts.blockedRecordCount).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(impact)).not.toContain(canary);
    } finally {
      await database.dispose();
    }
  });

  it('fences Project content writes after the durable knowledge epoch advances', async () => {
    const database = await createIsolatedPostgresTestDatabase();
    const pool = database.createPool();
    const projectId = `t3-write-fence-${randomUUID()}`;
    const now = new Date('2026-09-23T01:00:00.000Z');
    try {
      await pool.query(
        `INSERT INTO project_admin.projects (id, name, status, active)
         VALUES ($1, 'T3 write fence fixture', 'ACTIVE', true)`,
        [projectId],
      );
      await pool.query(
        `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [randomUUID(), projectId, now],
      );
      await pool.query(
        `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
         VALUES ($1, 1, 'RESET_PENDING')`,
        [projectId],
      );

      await expect(
        pool.query(
          `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
           VALUES ($1, $2, 'owner', $3)`,
          [randomUUID(), projectId, now],
        ),
      ).rejects.toMatchObject({
        code: '55000',
        constraint: 'project_knowledge_reset_write_fence',
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('shotgun.t3_reset_request_id', $1, true)`, [
          randomUUID(),
        ]);
        await expect(
          client.query(
            `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
             VALUES ($1, $2, 'owner', $3)`,
            [randomUUID(), projectId, now],
          ),
        ).rejects.toMatchObject({
          code: '55000',
          constraint: 'project_knowledge_reset_write_fence',
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }

      await expect(
        pool.query(
          `INSERT INTO settings.project_settings (project_id, key, value, category)
           VALUES ($1, 'locale', '"ko-KR"'::jsonb, 'general')`,
          [projectId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await database.dispose();
    }
  });
});
