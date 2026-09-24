import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

export { PostgresIntakeKnowledgeResetOwner } from './intake-owner.js';
export { PostgresEvidenceKnowledgeResetOwner } from './evidence-owner.js';
export { PostgresAskKnowledgeResetOwner } from './ask-owner.js';
export { PostgresComparisonKnowledgeResetOwner } from './comparison-owner.js';
export { PostgresValidationKnowledgeResetOwner } from './validation-owner.js';
export { PostgresCandidateKnowledgeResetOwner } from './candidate-owner.js';
export { PostgresAiOutputKnowledgeResetOwner } from './ai-output-owner.js';
export { PostgresAssetKnowledgeResetOwner } from './asset-owner.js';
export { PostgresKnowledgeGraphResetOwner } from './knowledge-graph-owner.js';
export { PostgresProjectAuditKnowledgeResetOwner } from './project-audit-owner.js';
export { PostgresFrontendCommandKnowledgeResetOwner } from './frontend-command-owner.js';
export { PostgresExternalActionKnowledgeResetOwner } from './external-action-owner.js';
export { PostgresActionKnowledgeResetOwner } from './action-owner.js';
export { PostgresDiscoveryKnowledgeResetOwner } from './discovery-owner.js';
export { PostgresKnowledgeDraftResetOwner } from './knowledge-draft-owner.js';
export { PostgresReviewKnowledgeResetOwner } from './review-owner.js';
export { PostgresProjectionKnowledgeResetOwner } from './projection-owner.js';
export { PostgresProjectionResetSnapshotWriter } from './projection-owner.js';
export { PostgresCanonicalKnowledgeResetOwner } from './canonical-owner.js';
export { PostgresActivityKnowledgeResetOwner } from './activity-owner.js';
export type { ProjectActivityResetRebuilder, ActivityResetProjection } from './activity-owner.js';
export { createProjectActivityResetRebuilder } from './activity-reset-rebuilder.js';
export { PostgresHistoryKnowledgeResetOwner } from './history-owner.js';
export type { ProjectHistoryResetRebuilder, HistoryResetProjection } from './history-owner.js';
export { createProjectHistoryResetRebuilder } from './history-reset-rebuilder.js';
export { PostgresKnowledgeModelResetOwner } from './knowledge-owner.js';
export { PostgresConnectorKnowledgeResetOwner } from './connector-owner.js';
export { PostgresSettingsKnowledgeResetOwner } from './settings-owner.js';
export { PostgresKnowledgeResetExecutorPersistence } from './execution-persistence.js';
export {
  composePostgresKnowledgeResetOwners,
  createPostgresKnowledgeResetMaintenanceExecutor,
} from './maintenance-composition.js';
export type { PostgresKnowledgeResetRebuilders } from './maintenance-composition.js';
export { PostgresSourceProductKnowledgeResetOwner } from './source-product-owner.js';
export { PostgresTransformationKnowledgeResetOwner } from './transformation-owner.js';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import {
  KnowledgeResetContractError,
  type KnowledgeResetConfigurationFingerprintPort,
  type KnowledgeResetProjectStatePort,
  type KnowledgeResetRequestRepositoryPort,
  type KnowledgeResetRequestV1,
} from '../../../modules/source-knowledge-reset/src/index.js';

type ResetRequestRow = QueryResultRow & {
  request_id: string;
  project_id: string;
  state: KnowledgeResetRequestV1['state'];
  preview_id: string;
  project_revision: number;
  expected_knowledge_epoch: string;
  resulting_knowledge_epoch: string;
  manifest_digest: string;
  owner_manifest_digest: string | null;
  preserved_configuration_digest: string | null;
  idempotency_key: string;
  blocker_codes: string[];
  impact_counts: KnowledgeResetRequestV1['counts'];
  step_checkpoints: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

const safeJsonObject = <T extends Record<string, unknown>>(value: unknown): T => {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {} as T;
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as T)
    : ({} as T);
};

const sameCounts = (
  left: KnowledgeResetRequestV1['counts'],
  right: KnowledgeResetRequestV1['counts'],
): boolean =>
  (Object.keys(left) as (keyof KnowledgeResetRequestV1['counts'])[])
    .sort()
    .every((key) => left[key] === right[key]) &&
  Object.keys(left).length === Object.keys(right).length;

const toRequest = (row: ResetRequestRow): KnowledgeResetRequestV1 => {
  const checkpoints = safeJsonObject<Record<string, unknown>>(row.step_checkpoints);
  return {
    schemaVersion: '1.0.0',
    requestId: row.request_id,
    projectId: row.project_id,
    projectRevision: row.project_revision,
    manifestDigest: row.manifest_digest as `sha256:${string}`,
    ...(row.owner_manifest_digest === null
      ? {}
      : { ownerManifestDigest: row.owner_manifest_digest as `sha256:${string}` }),
    ...(row.preserved_configuration_digest === null
      ? {}
      : {
          preservedConfigurationDigest: row.preserved_configuration_digest as `sha256:${string}`,
        }),
    state: row.state,
    expectedKnowledgeEpoch: Number(row.expected_knowledge_epoch),
    knowledgeEpoch: Number(row.resulting_knowledge_epoch),
    blockerCodes: row.blocker_codes as KnowledgeResetRequestV1['blockerCodes'],
    counts: safeJsonObject<KnowledgeResetRequestV1['counts']>(row.impact_counts),
    completedSteps: Object.keys(checkpoints)
      .filter((key) => checkpoints[key] === true)
      .sort(),
    casStatus:
      checkpoints.casStatus === 'COMPLETE'
        ? 'COMPLETE'
        : checkpoints.casStatus === 'QUARANTINED_PENDING_SWEEP'
          ? 'QUARANTINED_PENDING_SWEEP'
          : checkpoints.casStatus === 'BLOCKED'
            ? 'BLOCKED'
            : 'NOT_STARTED',
    backupStatus:
      checkpoints.backupStatus === 'COMPLETE'
        ? 'COMPLETE'
        : checkpoints.backupStatus === 'BLOCKED'
          ? 'BLOCKED'
          : 'PENDING',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  };
};

const requestSelect = `
  SELECT request_id::text, preview_id::text, project_id, project_revision, state,
         expected_knowledge_epoch::text, resulting_knowledge_epoch::text,
         manifest_digest, owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         blocker_codes, impact_counts, step_checkpoints, created_at, updated_at, completed_at
  FROM project_admin.project_knowledge_reset_requests`;

const readResetRequest = async (
  client: Pool | PoolClient,
  projectId: string,
  requestId: string,
): Promise<KnowledgeResetRequestV1 | null> => {
  const result = await client.query<ResetRequestRow>(
    `${requestSelect} WHERE project_id = $1 AND request_id = $2`,
    [projectId, requestId],
  );
  return result.rows[0] ? toRequest(result.rows[0]) : null;
};

export class PostgresKnowledgeResetPersistence
  implements
    KnowledgeResetProjectStatePort,
    KnowledgeResetRequestRepositoryPort,
    KnowledgeResetConfigurationFingerprintPort
{
  constructor(private readonly pool: Pool) {}

  async readProjectResetContext(input: { projectId: string; actorPrincipalId: string }) {
    const result = await this.pool.query<{
      project_revision: number;
      knowledge_epoch: string | null;
      reset_state: 'READY' | 'RESET_PENDING' | 'RESET_FAILED' | 'RESET_UNVERIFIED' | null;
    }>(
      `SELECT p.revision AS project_revision,
              e.epoch::text AS knowledge_epoch,
              e.state AS reset_state
       FROM project_admin.projects AS p
         JOIN auth.project_memberships AS m
         ON m.project_id = p.id
        AND m.principal_id = $2::uuid
        AND m.is_owner = true
        AND (m.expires_at IS NULL OR m.expires_at > now())
       LEFT JOIN project_admin.project_knowledge_epoch AS e ON e.project_id = p.id
       WHERE p.id = $1`,
      [input.projectId, input.actorPrincipalId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      projectId: input.projectId,
      projectRevision: row.project_revision,
      knowledgeEpoch: Number(row.knowledge_epoch ?? 0),
      resetState: row.reset_state ?? 'READY',
      actorPrincipalId: input.actorPrincipalId,
    } as const;
  }

  async readKnowledgeEpoch(projectId: string): Promise<number> {
    const result = await this.pool.query<{ epoch: string | null }>(
      `SELECT epoch::text FROM project_admin.project_knowledge_epoch WHERE project_id = $1`,
      [projectId],
    );
    return Number(result.rows[0]?.epoch ?? 0);
  }

  async insertApproved(
    input: Parameters<KnowledgeResetRequestRepositoryPort['insertApproved']>[0],
  ) {
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const project = await client.query<{
            project_revision: number;
            knowledge_epoch: string | null;
            reset_state: 'READY' | 'RESET_PENDING' | 'RESET_FAILED' | 'RESET_UNVERIFIED' | null;
            is_owner: boolean;
          }>(
            `SELECT p.revision AS project_revision,
                e.epoch::text AS knowledge_epoch,
                e.state AS reset_state,
                m.is_owner
         FROM project_admin.projects AS p
         JOIN auth.project_memberships AS m
           ON m.project_id = p.id
          AND m.principal_id = $2::uuid
          AND m.is_owner = true
          AND (m.expires_at IS NULL OR m.expires_at > now())
         LEFT JOIN project_admin.project_knowledge_epoch AS e ON e.project_id = p.id
         WHERE p.id = $1
         FOR UPDATE OF p, m`,
            [input.projectId, input.actorPrincipalId],
          );
          const current = project.rows[0];
          if (!current || !current.is_owner) {
            throw new KnowledgeResetContractError(
              'NOT_PROJECT_OWNER',
              'Project Owner access is required.',
            );
          }
          // The Project row lock above serializes approvals for this Project.
          // Do not lock the request row: runtime can read approved request
          // columns and insert requests, but must not receive UPDATE privilege.
          const existing = await client.query<ResetRequestRow>(
            `${requestSelect} WHERE project_id = $1 AND idempotency_key = $2`,
            [input.projectId, input.idempotencyKey],
          );
          if (existing.rows[0]) {
            const row = existing.rows[0];
            if (
              row.preview_id !== input.previewId ||
              row.project_revision !== input.projectRevision ||
              Number(row.expected_knowledge_epoch) !== input.expectedKnowledgeEpoch ||
              row.manifest_digest !== input.manifestDigest ||
              row.owner_manifest_digest !== input.ownerManifestDigest ||
              row.preserved_configuration_digest !== input.preservedConfigurationDigest ||
              !sameCounts(row.impact_counts, input.counts)
            ) {
              throw new KnowledgeResetContractError(
                'INVALID_CONFIRMATION',
                'Idempotency key was reused for a different reset request.',
              );
            }
            return { request: toRequest(row), replayed: true };
          }
          if ((current.reset_state ?? 'READY') !== 'READY') {
            throw new KnowledgeResetContractError(
              'RESET_IN_PROGRESS',
              'A Project knowledge reset is already active.',
            );
          }
          if (
            current.project_revision !== input.projectRevision ||
            Number(current.knowledge_epoch ?? 0) !== input.expectedKnowledgeEpoch
          ) {
            throw new KnowledgeResetContractError(
              'STALE_PREVIEW',
              'Project access or knowledge changed; preview again.',
            );
          }

          const epochWrite = await client.query(
            `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
         VALUES ($1, $2::bigint + 1::bigint, 'RESET_PENDING')
         ON CONFLICT (project_id) DO UPDATE
           SET epoch = EXCLUDED.epoch, state = 'RESET_PENDING', updated_at = now()
         WHERE project_admin.project_knowledge_epoch.epoch = EXCLUDED.epoch - 1::bigint
           AND project_admin.project_knowledge_epoch.state = 'READY'`,
            [input.projectId, input.expectedKnowledgeEpoch],
          );
          if (epochWrite.rowCount !== 1) {
            throw new KnowledgeResetContractError(
              'RESET_IN_PROGRESS',
              'A Project knowledge reset is already active.',
            );
          }
          const inserted = await client.query<ResetRequestRow>(
            `INSERT INTO project_admin.project_knowledge_reset_requests (
           request_id, preview_id, project_id, actor_principal_id,
           project_revision, expected_knowledge_epoch, manifest_digest,
           owner_manifest_digest, preserved_configuration_digest, resulting_knowledge_epoch,
           idempotency_key, state, impact_counts
         ) VALUES (
           $1, $2, $3, $4, $5, $6::bigint, $7, $8, $9, $6::bigint + 1::bigint,
           $10, 'APPROVED', $11::jsonb
         )
         RETURNING request_id::text, preview_id::text, project_id, project_revision, state,
                   expected_knowledge_epoch::text, resulting_knowledge_epoch::text,
                   manifest_digest, owner_manifest_digest, preserved_configuration_digest,
                   idempotency_key,
                   blocker_codes, impact_counts, step_checkpoints, created_at, updated_at, completed_at`,
            [
              input.requestId,
              input.previewId,
              input.projectId,
              input.actorPrincipalId,
              input.projectRevision,
              input.expectedKnowledgeEpoch,
              input.manifestDigest,
              input.ownerManifestDigest,
              input.preservedConfigurationDigest,
              input.idempotencyKey,
              JSON.stringify(input.counts),
            ],
          );
          const row = inserted.rows[0];
          if (!row) throw new Error('Project Source knowledge reset request was not persisted.');
          return { request: toRequest(row), replayed: false };
        },
        {
          module: 'source-knowledge-reset',
          operation: 'insert-approved-reset-request',
        },
      );
    } catch (error) {
      if (!(error instanceof ShotgunError) || error.code !== 'OUTCOME_UNKNOWN') throw error;

      // A lost COMMIT acknowledgement is resolved only through durable
      // idempotency readback; the transaction helper deliberately does not retry.
      const persisted = await this.findByIdempotencyKey(input.projectId, input.idempotencyKey);
      if (!persisted) throw error;
      if (
        persisted.projectRevision !== input.projectRevision ||
        persisted.expectedKnowledgeEpoch !== input.expectedKnowledgeEpoch ||
        persisted.manifestDigest !== input.manifestDigest ||
        persisted.ownerManifestDigest !== input.ownerManifestDigest ||
        persisted.preservedConfigurationDigest !== input.preservedConfigurationDigest ||
        !sameCounts(persisted.counts, input.counts)
      ) {
        throw new KnowledgeResetContractError(
          'INVALID_CONFIRMATION',
          'Idempotency key was reused for a different reset request.',
        );
      }
      return { request: persisted, replayed: true };
    }
  }

  async findById(projectId: string, requestId: string): Promise<KnowledgeResetRequestV1 | null> {
    return readResetRequest(this.pool, projectId, requestId);
  }

  /** Runtime-only lookup used to restore the approved actor's Activity scope. */
  async readResetActorPrincipalId(projectId: string, requestId: string): Promise<string | null> {
    const result = await this.pool.query<{ actor_principal_id: string }>(
      `SELECT project_admin.t3_read_reset_actor($1, $2::uuid) AS actor_principal_id`,
      [projectId, requestId],
    );
    return result.rows[0]?.actor_principal_id ?? null;
  }

  async findByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<KnowledgeResetRequestV1 | null> {
    const result = await this.pool.query<ResetRequestRow>(
      `${requestSelect} WHERE project_id = $1 AND idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return result.rows[0] ? toRequest(result.rows[0]) : null;
  }

  async fingerprintPreservedProjectConfiguration(projectId: string): Promise<`sha256:${string}`> {
    const result = await this.pool.query<{ fingerprint_inputs: unknown }>(
      `WITH project_principals AS (
         SELECT DISTINCT principal_id
         FROM auth.project_memberships
         WHERE project_id = $1
       )
       SELECT jsonb_build_object(
         'project', (SELECT to_jsonb(p) FROM project_admin.projects AS p WHERE p.id = $1),
         'memberships', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.principal_id)
           FROM auth.project_memberships AS m WHERE m.project_id = $1), '[]'::jsonb),
         'principals', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.principal_id)
           FROM auth.principals AS p JOIN project_principals pp USING (principal_id)), '[]'::jsonb),
         'credentials', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.credential_id)
           FROM auth.credentials AS c JOIN project_principals pp USING (principal_id)), '[]'::jsonb),
         'sessions', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.session_id)
           FROM auth.sessions AS s JOIN project_principals pp USING (principal_id)), '[]'::jsonb),
         'apiTokens', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.token_id)
           FROM auth.api_tokens AS t JOIN project_principals pp USING (principal_id)), '[]'::jsonb),
         'principalPreferences', COALESCE((SELECT jsonb_agg(to_jsonb(prefs) ORDER BY prefs.principal_id)
           FROM settings.principal_preferences AS prefs
           JOIN project_principals pp ON prefs.principal_id = pp.principal_id::text), '[]'::jsonb),
         'projectSettings', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.key)
           FROM settings.project_settings AS s WHERE s.project_id = $1), '[]'::jsonb),
         'projectAiConfiguration', (SELECT to_jsonb(c) FROM ai.project_ai_configurations AS c WHERE c.project_id = $1),
         'projectAiConfigurationRevisions', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.ai_configuration_revision)
           FROM ai.project_ai_configuration_revisions AS c WHERE c.project_id = $1), '[]'::jsonb),
         'providerCredentials', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.credential_id, c.credential_revision)
           FROM ai.provider_credentials AS c WHERE c.project_id = $1), '[]'::jsonb),
         'standingAiPolicy', (SELECT to_jsonb(p) FROM ai.project_standing_ai_processing_policies AS p WHERE p.project_id = $1),
         'standingAiPolicyRevisions', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policy_revision)
           FROM ai.project_standing_ai_processing_policy_revisions AS p WHERE p.project_id = $1), '[]'::jsonb),
         'providerTransferApprovals', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.provider_id)
           FROM settings.provider_external_transfer_approvals AS a WHERE a.project_id = $1), '[]'::jsonb),
         'providerTransferApprovalRevisions', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.provider_id, a.approval_revision)
           FROM settings.provider_external_transfer_approval_revisions AS a WHERE a.project_id = $1), '[]'::jsonb),
         'settingsReviewProposals', COALESCE((SELECT jsonb_agg(to_jsonb(proposal) ORDER BY proposal.proposal_id)
           FROM settings.settings_review_proposals AS proposal WHERE proposal.project_id = $1), '[]'::jsonb),
         'settingsRevisions', COALESCE((SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision.revision)
           FROM settings.settings_revisions AS revision WHERE revision.project_id = $1), '[]'::jsonb),
         'policyContextRevisions', COALESCE((SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision.revision)
           FROM settings.policy_context_revisions AS revision WHERE revision.project_id = $1), '[]'::jsonb),
         'settingsCommands', COALESCE((SELECT jsonb_agg(to_jsonb(command) ORDER BY command.command_id)
           FROM settings.settings_commands AS command WHERE command.project_id = $1), '[]'::jsonb),
         'settingsCommandResults', COALESCE((SELECT jsonb_agg(to_jsonb(result) ORDER BY result.command_id)
           FROM settings.settings_command_results AS result
           JOIN settings.settings_commands AS command USING (command_id)
           WHERE command.project_id = $1), '[]'::jsonb),
         'settingsAuditEvents', COALESCE((SELECT jsonb_agg(to_jsonb(event) ORDER BY event.timestamp, event.event_id)
           FROM settings.settings_audit_events AS event WHERE event.project_id = $1), '[]'::jsonb),
         'settingsHistoryPayloadState', COALESCE((SELECT jsonb_agg(to_jsonb(state)
           ORDER BY state.source_event_kind, state.source_event_id)
           FROM settings.history_payload_state AS state WHERE state.resource_project_id = $1), '[]'::jsonb),
         'preferenceRevisions', COALESCE((SELECT jsonb_agg(to_jsonb(revision)
           ORDER BY revision.principal_id, revision.revision)
           FROM settings.preference_revisions AS revision
           JOIN project_principals pp ON revision.principal_id = pp.principal_id::text), '[]'::jsonb),
         'preferenceCommands', COALESCE((SELECT jsonb_agg(to_jsonb(command) ORDER BY command.command_id)
           FROM settings.preference_commands AS command
           JOIN project_principals pp ON command.principal_id = pp.principal_id::text), '[]'::jsonb),
         'preferenceCommandResults', COALESCE((SELECT jsonb_agg(to_jsonb(result) ORDER BY result.command_id)
           FROM settings.preference_command_results AS result
           JOIN settings.preference_commands AS command USING (command_id)
           JOIN project_principals pp ON command.principal_id = pp.principal_id::text), '[]'::jsonb),
         'semanticEmbeddingProfiles', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.profile_revision)
           FROM projection.semantic_embedding_profiles AS p WHERE p.project_id = $1), '[]'::jsonb),
         'externalActionCredentials', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.connector_id)
           FROM frontend_external_action.credentials AS c), '[]'::jsonb),
         'externalActionBudgets', (SELECT to_jsonb(b) FROM frontend_external_action.budgets AS b WHERE b.project_id = $1)
       ) AS fingerprint_inputs`,
      [projectId],
    );
    const payload = result.rows[0]?.fingerprint_inputs;
    if (payload === undefined)
      throw new Error('Preserved Project configuration snapshot is unavailable.');
    return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
  }
}
