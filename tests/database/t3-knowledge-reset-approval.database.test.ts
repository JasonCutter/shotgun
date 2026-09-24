import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PostgresKnowledgeResetPersistence } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { createPostCommitAckLossPool } from '../helpers/postgres-commit-ack-loss.js';

describe('ADR-171 PostgreSQL reset approval persistence', () => {
  it('reconciles a committed approval after COMMIT acknowledgement loss and preserves state', async () => {
    const database = await createIsolatedPostgresTestDatabase();
    const pool = database.createPool();
    const projectId = `t3-project-${randomUUID()}`;
    const principalId = randomUUID();
    const credentialId = randomUUID();
    const now = new Date('2026-09-23T01:00:00.000Z');
    try {
      await pool.query(
        `INSERT INTO project_admin.projects (id, name, description, status, active)
         VALUES ($1, 'T3 preservation fixture', 'must remain unchanged', 'ACTIVE', true)`,
        [projectId],
      );
      await pool.query(
        `INSERT INTO auth.principals (principal_id, actor_type, status, created_at)
         VALUES ($1, 'user', 'active', $2)`,
        [principalId, now],
      );
      await pool.query(
        `INSERT INTO auth.credentials (
           credential_id, principal_id, credential_type, account_id, password_hash, password_changed_at
         ) VALUES ($1, $2, 'local_password', $3, 'argon2id$v=1$test-hash', $4)`,
        [credentialId, principalId, `t3-${principalId}@example.test`, now],
      );
      await pool.query(
        `INSERT INTO auth.project_memberships (
           principal_id, project_id, scopes, sensitivity_clearance, is_owner
         ) VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
        [principalId, projectId],
      );
      await pool.query(
        `INSERT INTO auth.sessions (
           session_id, token_hash, csrf_hash, principal_id, active_project_id, expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          `sha256:${'1'.repeat(64)}`,
          `sha256:${'2'.repeat(64)}`,
          principalId,
          projectId,
          new Date(now.getTime() + 86_400_000),
          now,
        ],
      );
      await pool.query(
        `INSERT INTO settings.principal_preferences (principal_id, preferences)
         VALUES ($1, '{"locale":"ko-KR"}'::jsonb)`,
        [principalId],
      );
      await pool.query(
        `INSERT INTO settings.project_settings (project_id, key, value, category)
         VALUES ($1, 'locale', '"ko-KR"'::jsonb, 'general')`,
        [projectId],
      );
      await pool.query(
        `INSERT INTO ai.provider_credentials (
           credential_id, project_id, provider_id, encrypted_secret, encryption_version,
           key_version, credential_revision, lifecycle_state, created_at, updated_at
         ) VALUES ($1, $2, 'deepseek',
           '{"version":"v1","algorithm":"aes-256-gcm","nonce":"n","ciphertext":"c","authTag":"t"}'::jsonb,
           'aes-256-gcm:v1', 'test-key', 1, 'active', $3, $3)`,
        [credentialId, projectId, now],
      );
      await pool.query(
        `INSERT INTO ai.project_ai_configuration_revisions (
           project_id, active_provider_id, active_model_id, credential_id,
           credential_revision, ai_configuration_revision, updated_by, updated_at
         ) VALUES ($1, 'deepseek', 'deepseek-chat', $2, 1, 1, $3, $4)`,
        [projectId, credentialId, principalId, now],
      );
      await pool.query(
        `INSERT INTO ai.project_ai_configurations (
           project_id, active_provider_id, active_model_id, credential_id,
           credential_revision, ai_configuration_revision, updated_by, updated_at
         ) VALUES ($1, 'deepseek', 'deepseek-chat', $2, 1, 1, $3, $4)`,
        [projectId, credentialId, principalId, now],
      );
      await pool.query(
        `INSERT INTO ai.project_standing_ai_processing_policy_revisions (
           project_id, enabled, provider_id, policy_revision, ai_configuration_revision, changed_by, changed_at
         ) VALUES ($1, true, 'deepseek', 1, 1, $2, $3)`,
        [projectId, principalId, now],
      );
      await pool.query(
        `INSERT INTO ai.project_standing_ai_processing_policies (
           project_id, enabled, provider_id, policy_revision, ai_configuration_revision, changed_by, changed_at
         ) VALUES ($1, true, 'deepseek', 1, 1, $2, $3)`,
        [projectId, principalId, now],
      );
      await pool.query(
        `INSERT INTO settings.provider_external_transfer_approval_revisions (
           project_id, provider_id, approved, approval_revision, reviewed_by, reviewed_at
         ) VALUES ($1, 'deepseek', true, 1, $2, $3)`,
        [projectId, principalId, now],
      );
      await pool.query(
        `INSERT INTO settings.provider_external_transfer_approvals (
           project_id, provider_id, approved, approval_revision, reviewed_by, reviewed_at
         ) VALUES ($1, 'deepseek', true, 1, $2, $3)`,
        [projectId, principalId, now],
      );

      const persistence = new PostgresKnowledgeResetPersistence(pool);
      const fingerprintBefore =
        await persistence.fingerprintPreservedProjectConfiguration(projectId);
      const context = await persistence.readProjectResetContext({
        projectId,
        actorPrincipalId: principalId,
      });
      if (!context) throw new Error('Owner reset context fixture was not found.');
      const approvalInput = {
        requestId: randomUUID(),
        previewId: randomUUID(),
        projectId,
        actorPrincipalId: principalId,
        projectRevision: context.projectRevision,
        expectedKnowledgeEpoch: context.knowledgeEpoch,
        manifestDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
        ownerManifestDigest: `sha256:${'b'.repeat(64)}` as `sha256:${string}`,
        preservedConfigurationDigest: fingerprintBefore,
        idempotencyKey: randomUUID(),
        counts: {
          sourceCount: 2,
          sourceVersionCount: 3,
          sourceDerivedRecordCount: 14,
          redactedHistoryRecordCount: 4,
          rebuildProjectionCount: 5,
          sharedAssetCount: 1,
          blockedRecordCount: 0,
        },
      };
      const commitLoss = createPostCommitAckLossPool(pool);
      const approvalAfterLostAcknowledgement = new PostgresKnowledgeResetPersistence(
        commitLoss.pool,
      );
      const approved = await approvalAfterLostAcknowledgement.insertApproved(approvalInput);
      const replay = await persistence.insertApproved(approvalInput);

      expect(approved.request.state).toBe('APPROVED');
      expect(approved.request.knowledgeEpoch).toBe(1);
      expect(approved.replayed).toBe(true);
      expect(replay.replayed).toBe(true);
      expect(replay.request.requestId).toBe(approved.request.requestId);
      expect(commitLoss.trace).toMatchObject({
        commitAttempts: 1,
        commitAttempted: true,
        acknowledgementLost: true,
        rollbackAfterCommit: 0,
      });
      expect(await persistence.findById(projectId, approved.request.requestId)).toMatchObject({
        requestId: approved.request.requestId,
        state: 'APPROVED',
        manifestDigest: approvalInput.manifestDigest,
        ownerManifestDigest: approvalInput.ownerManifestDigest,
        preservedConfigurationDigest: fingerprintBefore,
      });
      expect(await persistence.fingerprintPreservedProjectConfiguration(projectId)).toBe(
        fingerprintBefore,
      );

      const epoch = await pool.query<{ epoch: string; state: string }>(
        `SELECT epoch::text, state FROM project_admin.project_knowledge_epoch WHERE project_id = $1`,
        [projectId],
      );
      expect(epoch.rows[0]).toEqual({ epoch: '1', state: 'RESET_PENDING' });
      expect(await persistence.readKnowledgeEpoch(projectId)).toBe(1);
      const sourceCounts = await pool.query<{
        project_count: string;
        auth_count: string;
        ai_count: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM project_admin.projects WHERE id = $1) AS project_count,
           (SELECT count(*)::text FROM auth.credentials WHERE principal_id = $2) AS auth_count,
           (SELECT count(*)::text FROM ai.project_ai_configurations WHERE project_id = $1) AS ai_count`,
        [projectId, principalId],
      );
      expect(sourceCounts.rows[0]).toEqual({ project_count: '1', auth_count: '1', ai_count: '1' });

      await expect(
        persistence.insertApproved({
          ...approvalInput,
          requestId: randomUUID(),
          preservedConfigurationDigest: `sha256:${'c'.repeat(64)}` as `sha256:${string}`,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' });

      await expect(
        persistence.insertApproved({
          ...approvalInput,
          requestId: randomUUID(),
          actorPrincipalId: randomUUID(),
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'NOT_PROJECT_OWNER' });
    } finally {
      await database.dispose();
    }
  });
});
