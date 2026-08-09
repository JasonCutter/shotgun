import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import {
  FrontendContractError,
  ShotgunError,
  decodeProjectAdministrationView,
  decodeProjectListItemView,
  decodeSettingsSnapshot,
  type ConnectorSettingsView,
  type CostBudgetView,
  type DiagnosticsView,
  type DirectiveProposalView,
  type ModelDescriptorView,
  type PrivacyRetentionView,
  type ProjectAdministrationView,
  type ProjectListItemView,
  type SchemaPackView,
  type SettingsCommandResult,
  type SettingsImpactPreview,
  type SettingsSnapshot,
  type SettingsValidationResult,
  type ProductFeatureView,
} from '../../../packages/contracts/src/index.js';
import type {
  CreateProjectInput,
  ProjectBootstrapInput,
  ProjectBootstrapResult,
  ProjectBootstrapUnitOfWorkPort,
  ProjectAdministrationRepositoryPort,
  UpdateProjectInput,
  ProjectLifecycleCommandInput,
  CreateProjectTombstoneInput,
  DeletedProjectAuditScopeRecord,
  GrantDeletedProjectAuditScopeInput,
  ProjectTombstoneRecord,
  ProjectTombstoneStorePort,
  RevokeDeletedProjectAuditScopeInput,
} from '../../../modules/project-administration/src/index.js';
import type {
  SettingsRepositoryPort,
  ApplySettingsCommandInput,
  ApplyPreferenceCommandInput,
  ListPolicyHistoryInput,
  ListPolicyHistoryResult,
  PolicyHistoryReadPort,
} from '../../../modules/settings-policy/src/index.js';
import { deriveSettingsImpact } from '../../../modules/settings-policy/src/index.js';
import type {
  IntakeRepositoryPort,
  IntakeSubmission,
  SavedIntakeSubmission,
} from '../../../modules/intake/src/index.js';
import type {
  OriginalAssetRepositoryPort,
  SourceVersionSecurityRecord,
  StoredIntakeResult,
  StoreOriginalAssetInput,
} from '../../../modules/original-asset/src/index.js';
import type {
  SourcesProjectionRecord,
  SourcesProjectionRepositoryPort,
} from '../../../modules/frontend-sources-product/src/index.js';

type IntakeRow = QueryResultRow & {
  readonly submission_id: string;
  readonly project_id: string;
  readonly actor_id: string;
  readonly requested_source_id: string | null;
  readonly channel: IntakeSubmission['channel'];
  readonly material_kind: IntakeSubmission['materialKind'];
  readonly media_type: IntakeSubmission['mediaType'];
  readonly original_file_name: string | null;
  readonly content_hash: string;
  readonly size_bytes: string;
  readonly access_scope: string[];
  readonly sensitivity: IntakeSubmission['sensitivity'];
};

type StoredResultRow = QueryResultRow & {
  readonly submission_id: string;
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly version_number: number;
  readonly asset_id: string;
  readonly media_type: string;
  readonly content_hash: string;
  readonly size_bytes: string;
  readonly storage_key: string;
  readonly access_scope: string[];
  readonly sensitivity: StoredIntakeResult['sensitivity'];
  readonly channel: StoredIntakeResult['channel'];
  readonly material_kind: StoredIntakeResult['materialKind'];
  readonly original_file_name: string | null;
  readonly asset_reused: boolean;
  readonly version_created: boolean;
};

const resultSelect = `
  SELECT
    receipt.submission_id,
    receipt.project_id,
    source.source_id::text,
    version.source_version_id::text,
    version.version_number,
    original.asset_id::text,
    version.media_type,
    original.content_hash,
    original.size_bytes::text,
    original.storage_key,
    version.access_scope,
    version.sensitivity,
    receipt.channel,
    receipt.material_kind,
    receipt.original_file_name,
    receipt.asset_reused,
    receipt.version_created
  FROM asset.storage_receipts AS receipt
  JOIN asset.source_versions AS version
    ON version.source_version_id = receipt.source_version_id
  JOIN asset.sources AS source
    ON source.source_id = version.source_id
  JOIN asset.original_assets AS original
    ON original.asset_id = version.original_asset_id
`;

const mapStoredResult = (row: StoredResultRow): StoredIntakeResult => ({
  submissionId: row.submission_id,
  projectId: row.project_id,
  sourceId: row.source_id,
  sourceVersionId: row.source_version_id,
  versionNumber: row.version_number,
  channel: row.channel,
  materialKind: row.material_kind,
  originalFileName: row.original_file_name ?? undefined,
  assetReference: {
    assetId: row.asset_id,
    versionId: row.source_version_id,
    mediaType: row.media_type,
    contentHash: row.content_hash,
    sizeBytes: Number(row.size_bytes),
    storageUri: `asset://${row.asset_id}/versions/${row.source_version_id}`,
    accessScope: row.access_scope,
  },
  storageKey: row.storage_key,
  sensitivity: row.sensitivity,
  assetReused: row.asset_reused,
  versionCreated: row.version_created,
});

const sameScopes = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export class PostgresIntakeRepository implements IntakeRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(submission: IntakeSubmission): Promise<SavedIntakeSubmission> {
    const inserted = await this.pool.query(
      `
        INSERT INTO intake.submissions (
          submission_key,
          submission_id,
          project_id,
          actor_id,
          requested_source_id,
          channel,
          material_kind,
          media_type,
          original_file_name,
          content_hash,
          size_bytes,
          access_scope,
          sensitivity,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (project_id, submission_id) DO NOTHING
        RETURNING submission_id
      `,
      [
        randomUUID(),
        submission.submissionId,
        submission.projectId,
        submission.actorId,
        submission.sourceId ?? null,
        submission.channel,
        submission.materialKind,
        submission.mediaType,
        submission.originalFileName ?? null,
        submission.contentHash,
        submission.sizeBytes,
        submission.accessScope,
        submission.sensitivity,
        submission.createdAt,
      ],
    );
    if (inserted.rowCount === 1) {
      return { submission, duplicateSubmission: false };
    }

    const existing = await this.pool.query<IntakeRow>(
      `
        SELECT
          submission_id,
          project_id,
          actor_id,
          requested_source_id::text,
          channel,
          material_kind,
          media_type,
          original_file_name,
          content_hash,
          size_bytes::text,
          access_scope,
          sensitivity
        FROM intake.submissions
        WHERE project_id = $1 AND submission_id = $2
      `,
      [submission.projectId, submission.submissionId],
    );
    const row = existing.rows[0];
    const matches =
      row &&
      row.actor_id === submission.actorId &&
      (row.requested_source_id ?? undefined) === submission.sourceId &&
      row.channel === submission.channel &&
      row.material_kind === submission.materialKind &&
      row.media_type === submission.mediaType &&
      (row.original_file_name ?? undefined) === submission.originalFileName &&
      row.content_hash === submission.contentHash &&
      Number(row.size_bytes) === submission.sizeBytes &&
      sameScopes(row.access_scope, submission.accessScope) &&
      row.sensitivity === submission.sensitivity;
    if (!matches) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: `Submission '${submission.submissionId}' was already used for different input.`,
        module: 'postgres',
        operation: 'save-intake-submission',
      });
    }
    return { submission, duplicateSubmission: true };
  }
}

export class PostgresOriginalAssetRepository
  implements OriginalAssetRepositoryPort, SourcesProjectionRepositoryPort
{
  constructor(private readonly pool: Pool) {}

  async assertSource(projectId: string, sourceId: string): Promise<void> {
    const source = await this.pool.query(
      'SELECT 1 FROM asset.sources WHERE source_id = $1 AND project_id = $2',
      [sourceId, projectId],
    );
    if (source.rowCount !== 1) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Source '${sourceId}' was not found in this project.`,
        module: 'postgres',
        operation: 'assert-source',
      });
    }
  }

  async store(input: StoreOriginalAssetInput): Promise<StoredIntakeResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.projectId}:${input.submissionId}`,
      ]);

      const receipt = await this.findReceipt(client, input.projectId, input.submissionId);
      if (receipt) {
        await client.query('COMMIT');
        return receipt;
      }

      const insertedAsset = await client.query<{ asset_id: string }>(
        `
          INSERT INTO asset.original_assets (
            asset_id, content_hash, size_bytes, storage_key, created_at
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (content_hash) DO NOTHING
          RETURNING asset_id::text
        `,
        [randomUUID(), input.contentHash, input.sizeBytes, input.storageKey, input.createdAt],
      );
      const assetReused = insertedAsset.rowCount === 0;
      const asset = await client.query<{ asset_id: string }>(
        'SELECT asset_id::text FROM asset.original_assets WHERE content_hash = $1',
        [input.contentHash],
      );
      const assetId = asset.rows[0]?.asset_id;
      if (!assetId) {
        throw new Error('Original Asset insert did not produce an asset.');
      }

      const sourceId = await this.resolveSource(client, input);
      const existingVersion = await client.query<{
        source_version_id: string;
        version_number: number;
      }>(
        `
          SELECT source_version_id::text, version_number
          FROM asset.source_versions
          WHERE source_id = $1 AND original_asset_id = $2
        `,
        [sourceId, assetId],
      );

      let sourceVersionId = existingVersion.rows[0]?.source_version_id;
      let versionNumber = existingVersion.rows[0]?.version_number;
      const versionCreated = !sourceVersionId;
      if (!sourceVersionId || !versionNumber) {
        const latest = await client.query<{ next_version: number }>(
          `
            SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
            FROM asset.source_versions
            WHERE source_id = $1
          `,
          [sourceId],
        );
        sourceVersionId = randomUUID();
        versionNumber = Number(latest.rows[0]?.next_version ?? 1);
        await client.query(
          `
            INSERT INTO asset.source_versions (
              source_version_id,
              source_id,
              version_number,
              original_asset_id,
              media_type,
              access_scope,
              sensitivity,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            sourceVersionId,
            sourceId,
            versionNumber,
            assetId,
            input.mediaType,
            input.accessScope,
            input.sensitivity,
            input.createdAt,
          ],
        );
      }

      await client.query(
        `
          INSERT INTO asset.storage_receipts (
            receipt_id,
            submission_id,
            project_id,
            source_version_id,
            channel,
            material_kind,
            original_file_name,
            asset_reused,
            version_created,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          randomUUID(),
          input.submissionId,
          input.projectId,
          sourceVersionId,
          input.channel,
          input.materialKind,
          input.originalFileName ?? null,
          assetReused,
          versionCreated,
          input.createdAt,
        ],
      );

      const stored = await this.findReceipt(client, input.projectId, input.submissionId);
      if (!stored) {
        throw new Error('Original Asset receipt was not created.');
      }
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findBySubmission(
    projectId: string,
    submissionId: string,
  ): Promise<StoredIntakeResult | undefined> {
    const result = await this.pool.query<StoredResultRow>(
      `${resultSelect} WHERE receipt.project_id = $1 AND receipt.submission_id = $2`,
      [projectId, submissionId],
    );
    return result.rows[0] ? mapStoredResult(result.rows[0]) : undefined;
  }

  async findByVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<StoredIntakeResult | undefined> {
    const result = await this.pool.query<StoredResultRow>(
      `${resultSelect}
       WHERE receipt.project_id = $1 AND receipt.source_version_id = $2
       ORDER BY receipt.created_at
       LIMIT 1`,
      [projectId, sourceVersionId],
    );
    return result.rows[0] ? mapStoredResult(result.rows[0]) : undefined;
  }

  async findSourceVersionSecurity(
    projectId: string,
    sourceVersionId: string,
  ): Promise<SourceVersionSecurityRecord | undefined> {
    const result = await this.pool.query<{
      project_id: string;
      source_id: string;
      source_version_id: string;
      original_asset_id: string;
      content_hash: string;
      access_scope: string[];
      sensitivity: SourceVersionSecurityRecord['sensitivity'];
    }>(
      `SELECT source.project_id,
              source.source_id::text,
              version.source_version_id::text,
              version.original_asset_id::text,
              original.content_hash,
              version.access_scope,
              version.sensitivity
       FROM asset.source_versions AS version
       JOIN asset.sources AS source ON source.source_id = version.source_id
       JOIN asset.original_assets AS original ON original.asset_id = version.original_asset_id
       WHERE source.project_id = $1 AND version.source_version_id = $2`,
      [projectId, sourceVersionId],
    );
    const row = result.rows[0];
    return row
      ? {
          projectId: row.project_id,
          sourceId: row.source_id,
          sourceVersionId: row.source_version_id,
          originalAssetId: row.original_asset_id,
          contentHash: row.content_hash,
          accessScope: row.access_scope,
          sensitivity: row.sensitivity,
        }
      : undefined;
  }

  async listProjectSourceVersions(projectId: string): Promise<readonly SourcesProjectionRecord[]> {
    const result = await this.pool.query<{
      project_id: string;
      source_id: string;
      source_version_id: string;
      version_number: number;
      media_type: string;
      content_hash: string;
      size_bytes: string;
      original_file_name: string | null;
      storage_key: string;
      access_scope: string[];
      sensitivity: SourcesProjectionRecord['sensitivity'];
      created_at: Date;
    }>(
      `SELECT source.project_id,
              source.source_id::text,
              version.source_version_id::text,
              version.version_number,
              version.media_type,
              original.content_hash,
              original.size_bytes::text,
              receipt.original_file_name,
              original.storage_key,
              version.access_scope,
              version.sensitivity,
              version.created_at
       FROM asset.source_versions AS version
       JOIN asset.sources AS source ON source.source_id = version.source_id
       JOIN asset.original_assets AS original ON original.asset_id = version.original_asset_id
       LEFT JOIN LATERAL (
         SELECT candidate.original_file_name
         FROM asset.storage_receipts AS candidate
         WHERE candidate.project_id = source.project_id
           AND candidate.source_version_id = version.source_version_id
         ORDER BY candidate.created_at, candidate.receipt_id
         LIMIT 1
       ) AS receipt ON true
       WHERE source.project_id = $1
       ORDER BY source.source_id, version.version_number`,
      [projectId],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      sourceId: row.source_id,
      sourceVersionId: row.source_version_id,
      versionNumber: row.version_number,
      mediaType: row.media_type,
      contentHash: row.content_hash,
      sizeBytes: Number(row.size_bytes),
      ...(row.original_file_name === null ? {} : { originalFileName: row.original_file_name }),
      storageKey: row.storage_key,
      accessScope: row.access_scope,
      sensitivity: row.sensitivity,
      createdAt: row.created_at.toISOString(),
    }));
  }

  private async resolveSource(client: PoolClient, input: StoreOriginalAssetInput): Promise<string> {
    if (input.requestedSourceId) {
      const source = await client.query<{ source_id: string }>(
        `
          SELECT source_id::text
          FROM asset.sources
          WHERE source_id = $1 AND project_id = $2
          FOR UPDATE
        `,
        [input.requestedSourceId, input.projectId],
      );
      const sourceId = source.rows[0]?.source_id;
      if (!sourceId) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: `Source '${input.requestedSourceId}' was not found in this project.`,
          module: 'postgres',
          operation: 'resolve-source',
        });
      }
      return sourceId;
    }

    const sourceId = randomUUID();
    await client.query(
      `
        INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
        VALUES ($1, $2, $3, $4)
      `,
      [sourceId, input.projectId, input.actorId, input.createdAt],
    );
    return sourceId;
  }

  private async findReceipt(
    client: PoolClient,
    projectId: string,
    submissionId: string,
  ): Promise<StoredIntakeResult | undefined> {
    const result = await client.query<StoredResultRow>(
      `${resultSelect} WHERE receipt.project_id = $1 AND receipt.submission_id = $2`,
      [projectId, submissionId],
    );
    return result.rows[0] ? mapStoredResult(result.rows[0]) : undefined;
  }
}

export const createPostgresPool = (connectionString: string): Pool =>
  new Pool({ connectionString });

// ============================================================================
// Postgres Project Administration Repository & Settings Repository
// ============================================================================

export class PostgresProjectAdministrationRepository implements ProjectAdministrationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getProjects(projectIds: readonly string[]): Promise<ProjectAdministrationView> {
    if (projectIds.length === 0) {
      return decodeProjectAdministrationView({
        schemaVersion: '1.0.0',
        projects: [],
      });
    }

    // No JOIN with auth.project_memberships, as requested in ADR-114 boundaries
    const res = await this.pool.query<{
      id: string;
      name: string;
      description: string | null;
      status: string;
      active: boolean;
      created_at: Date;
      updated_at: Date;
      revision: number;
    }>(
      `SELECT id, name, description, status, active, created_at, updated_at, revision
       FROM project_admin.projects
       WHERE id = ANY($1)
       ORDER BY created_at ASC`,
      [projectIds as string[]], // pg module array mapping
    );

    const projects: ProjectListItemView[] = res.rows.map((row) => {
      // NOTE: isOwner and capabilities should be resolved by the Application Coordinator,
      // not by the Repository. Returning base attributes here.
      const isActive = row.status === 'ACTIVE';
      const isArchived = row.status === 'ARCHIVED';
      return decodeProjectListItemView({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        isOwner: false, // Coordinator will set this
        status: row.status,
        active: row.active,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        revision: Number(row.revision),
        capability: {
          canRename: isActive,
          canArchive: isActive,
          canRestore: isArchived,
          canDelete: isActive || isArchived,
          canManagePolicies: isActive,
        },
      });
    });

    return decodeProjectAdministrationView({
      schemaVersion: '1.0.0',
      projects,
    });
  }

  async getProjectDetails(projectId: string): Promise<ProjectListItemView | null> {
    const res = await this.pool.query<{
      id: string;
      name: string;
      description: string | null;
      status: string;
      active: boolean;
      created_at: Date;
      updated_at: Date;
      revision: number;
    }>(
      `SELECT id, name, description, status, active, created_at, updated_at, revision
       FROM project_admin.projects
       WHERE id = $1`,
      [projectId],
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    // NOTE: Capability here reflects project lifecycle only; route handlers enforce membership.
    const isActive = row.status === 'ACTIVE';
    const isArchived = row.status === 'ARCHIVED';
    return decodeProjectListItemView({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isOwner: false, // route handler must supply membership context for real isOwner
      status: row.status,
      active: row.active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      revision: Number(row.revision),
      capability: {
        canRename: isActive,
        canArchive: isActive,
        canRestore: isArchived,
        canDelete: isActive || isArchived,
        canManagePolicies: isActive,
      },
    });
  }

  async createProject(input: CreateProjectInput): Promise<ProjectListItemView> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();

      const existingIdem = await client.query<{
        client_request_id: string;
      }>(
        `SELECT client_request_id FROM project_admin.project_command_results WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingIdem.rows.length > 0) {
        if (existingIdem.rows[0]?.client_request_id !== input.clientRequestId) {
          throw new FrontendContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            `Idempotency key '${input.idempotencyKey}' reused with different clientRequestId.`,
          );
        }
        await client.query('COMMIT');
        const existingProject = await this.getProjectDetails(input.projectId);
        if (!existingProject) throw new Error('Project created but not found');
        return existingProject;
      }

      // Step 1: Insert project metadata (using input.projectId directly)
      const insertRes = await client.query<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        active: boolean;
        created_at: Date;
        updated_at: Date;
        revision: number;
      }>(
        `INSERT INTO project_admin.projects (id, name, description, status, active, created_at, updated_at, revision)
         VALUES ($1, $2, $3, 'ACTIVE', false, $4, $4, 1)
         RETURNING id, name, description, status, active, created_at, updated_at, revision`,
        [input.projectId, input.name, input.description ?? null, now],
      );

      // Step 2: Insert project revision record
      await client.query(
        `INSERT INTO project_admin.project_revisions (project_id, revision, changed_by, change_reason, created_at)
         VALUES ($1, 1, $2, 'Initial project creation', $3)`,
        [input.projectId, input.actorPrincipalId, now],
      );

      // Step 3: Owner membership — use auth.project_memberships
      await client.query(
        `INSERT INTO auth.project_memberships (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (principal_id, project_id) DO NOTHING`,
        [input.actorPrincipalId, input.projectId, ['owner'], 'private'],
      );

      // Step 4: Initial Settings Revision (append-only; PK=(project_id, revision))
      await client.query(
        `INSERT INTO settings.settings_revisions (project_id, revision, settings_snapshot, created_at)
         VALUES ($1, 1, '{}'::jsonb, $2)`,
        [input.projectId, now],
      );

      // Step 5: Initial Policy Context Revision (append-only; PK=(project_id, revision))
      await client.query(
        `INSERT INTO settings.policy_context_revisions (project_id, revision, policy_binding, created_at)
         VALUES ($1, 1, '{}'::jsonb, $2)`,
        [input.projectId, now],
      );

      // Step 6: Project Lifecycle Command Idempotency
      await client.query(
        `INSERT INTO project_admin.project_commands (command_id, client_request_id, idempotency_key, project_id, actor_id, expected_revision, command_type, command_payload, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'CREATE_PROJECT', $7, 'APPLIED', $8)`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          input.projectId,
          input.actorPrincipalId,
          1,
          JSON.stringify({ name: input.name, description: input.description }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO project_admin.project_command_results (command_id, client_request_id, idempotency_key, status, applied_revision, completed_at)
         VALUES ($1, $2, $3, 'APPLIED', 1, $4)`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, now],
      );

      // Step 7: Audit event
      await client.query(
        `INSERT INTO settings.settings_audit_events
           (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.projectId,
          input.actorPrincipalId,
          'PROJECT_CREATED',
          'LOW',
          JSON.stringify({ projectName: input.name }),
          now,
        ],
      );

      await client.query('COMMIT');

      const row = insertRes.rows[0]!;
      return decodeProjectListItemView({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        isOwner: true,
        status: row.status,
        active: row.active,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        revision: Number(row.revision),
        capability: {
          canRename: true,
          canArchive: true,
          canRestore: false,
          canDelete: true,
          canManagePolicies: true,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateProject(input: UpdateProjectInput): Promise<ProjectListItemView> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();

      const existingIdem = await client.query<{
        client_request_id: string;
      }>(
        `SELECT client_request_id FROM project_admin.project_command_results WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingIdem.rows.length > 0) {
        if (existingIdem.rows[0]?.client_request_id !== input.clientRequestId) {
          throw new FrontendContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            `Idempotency key '${input.idempotencyKey}' reused with different clientRequestId.`,
          );
        }
        await client.query('COMMIT');
        const existingProject = await this.getProjectDetails(input.projectId);
        if (!existingProject) throw new Error('Project updated but not found');
        return existingProject;
      }

      const checkRes = await client.query<{ revision: number }>(
        `SELECT revision FROM project_admin.projects WHERE id = $1 FOR UPDATE`,
        [input.projectId],
      );
      if (checkRes.rows.length === 0) {
        throw new FrontendContractError(
          'RESOURCE_RETIRED',
          `Project '${input.projectId}' not found.`,
        );
      }
      const currentRev = checkRes.rows[0]!.revision;
      if (currentRev !== input.expectedProjectRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected project revision ${input.expectedProjectRevision} but current is ${currentRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      const updateRes = await client.query<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        active: boolean;
        created_at: Date;
        updated_at: Date;
        revision: number;
      }>(
        `UPDATE project_admin.projects
         SET name = COALESCE($1, name), description = COALESCE($2, description), revision = $3, updated_at = $4
         WHERE id = $5
         RETURNING id, name, description, status, active, created_at, updated_at, revision`,
        [input.name ?? null, input.description ?? null, nextRev, now, input.projectId],
      );

      await client.query(
        `INSERT INTO project_admin.project_revisions (project_id, revision, changed_by, change_reason, created_at)
         VALUES ($1, $2, $3, 'Update project metadata', $4)`,
        [input.projectId, nextRev, input.actorPrincipalId, now],
      );

      await client.query(
        `INSERT INTO project_admin.project_commands (command_id, client_request_id, idempotency_key, project_id, actor_id, expected_revision, command_type, command_payload, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'UPDATE_PROJECT', $7, 'APPLIED', $8)`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          input.projectId,
          input.actorPrincipalId,
          input.expectedProjectRevision,
          JSON.stringify({ name: input.name, description: input.description }),
          now,
        ],
      );

      await client.query(
        `INSERT INTO project_admin.project_command_results (command_id, client_request_id, idempotency_key, status, applied_revision, completed_at)
         VALUES ($1, $2, $3, 'APPLIED', $4, $5)`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, nextRev, now],
      );

      await client.query('COMMIT');
      const row = updateRes.rows[0]!;
      const isActive = row.status === 'ACTIVE';
      const isArchived = row.status === 'ARCHIVED';
      return decodeProjectListItemView({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        isOwner: false, // route handler enforces membership
        status: row.status,
        active: row.active,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        revision: Number(row.revision),
        capability: {
          canRename: isActive,
          canArchive: isActive,
          canRestore: isArchived,
          canDelete: isActive || isArchived,
          canManagePolicies: isActive,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async archiveProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView> {
    return this.updateStatus(input, 'ARCHIVED');
  }

  async restoreProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView> {
    return this.updateStatus(input, 'ACTIVE');
  }

  async requestDeleteProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView> {
    return this.updateStatus(input, 'DELETE_REQUESTED');
  }

  private async updateStatus(
    input: ProjectLifecycleCommandInput,
    newStatus: string,
  ): Promise<ProjectListItemView> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();

      const existingIdem = await client.query<{
        client_request_id: string;
      }>(
        `SELECT client_request_id FROM project_admin.project_command_results WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingIdem.rows.length > 0) {
        if (existingIdem.rows[0]?.client_request_id !== input.clientRequestId) {
          throw new FrontendContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            `Idempotency key '${input.idempotencyKey}' reused with different clientRequestId.`,
          );
        }
        await client.query('COMMIT');
        const existingProject = await this.getProjectDetails(input.projectId);
        if (!existingProject) throw new Error('Project updated but not found');
        return existingProject;
      }

      const checkRes = await client.query<{ revision: number }>(
        `SELECT revision FROM project_admin.projects WHERE id = $1 FOR UPDATE`,
        [input.projectId],
      );
      if (checkRes.rows.length === 0) {
        throw new FrontendContractError(
          'RESOURCE_RETIRED',
          `Project '${input.projectId}' not found.`,
        );
      }
      const currentRev = checkRes.rows[0]!.revision;
      if (currentRev !== input.expectedProjectRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected revision ${input.expectedProjectRevision} but current is ${currentRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      const updateRes = await client.query<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        active: boolean;
        created_at: Date;
        updated_at: Date;
        revision: number;
      }>(
        `UPDATE project_admin.projects
         SET status = $1, revision = $2, updated_at = $3
         WHERE id = $4
         RETURNING id, name, description, status, active, created_at, updated_at, revision`,
        [newStatus, nextRev, now, input.projectId],
      );

      await client.query(
        `INSERT INTO project_admin.project_revisions (project_id, revision, changed_by, change_reason, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.projectId, nextRev, input.actorPrincipalId, `Status updated to ${newStatus}`, now],
      );

      await client.query(
        `INSERT INTO project_admin.project_commands (command_id, client_request_id, idempotency_key, project_id, actor_id, expected_revision, command_type, command_payload, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPLIED', $9)`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          input.projectId,
          input.actorPrincipalId,
          input.expectedProjectRevision,
          `UPDATE_STATUS_${newStatus}`,
          JSON.stringify({ status: newStatus }),
          now,
        ],
      );

      await client.query(
        `INSERT INTO project_admin.project_command_results (command_id, client_request_id, idempotency_key, status, applied_revision, completed_at)
         VALUES ($1, $2, $3, 'APPLIED', $4, $5)`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, nextRev, now],
      );

      await client.query('COMMIT');
      const row = updateRes.rows[0]!;
      return decodeProjectListItemView({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        isOwner: false, // route handler enforces membership
        status: row.status,
        active: row.active,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        revision: Number(row.revision),
        capability: {
          canRename: row.status === 'ACTIVE',
          canArchive: row.status === 'ACTIVE',
          canRestore: row.status === 'ARCHIVED',
          canDelete: row.status === 'ACTIVE' || row.status === 'ARCHIVED',
          canManagePolicies: row.status === 'ACTIVE',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export class PostgresProjectBootstrapUnitOfWork implements ProjectBootstrapUnitOfWorkPort {
  constructor(private readonly pool: Pool) {}

  async bootstrap(input: ProjectBootstrapInput): Promise<ProjectBootstrapResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{
        active_project_id: string | null;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT active_project_id, revoked_at, expires_at
         FROM auth.sessions
         WHERE session_id = $1
           AND principal_id = $2
         FOR UPDATE`,
        [input.sessionId, input.principalId],
      );
      const sessionRow = session.rows[0];
      if (!sessionRow || sessionRow.revoked_at || sessionRow.expires_at.getTime() <= Date.now()) {
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'The bootstrap Session is invalid, expired, or revoked.',
          module: 'project-bootstrap',
          operation: 'lock-zero-project-session',
        });
      }

      const existing = await this.findCompletedWithClient(client, input.commandId);
      if (existing) {
        await client.query('COMMIT');
        return { project: existing, replayed: true };
      }

      const memberships = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM auth.project_memberships
         WHERE principal_id = $1
           AND (expires_at IS NULL OR expires_at > now())`,
        [input.principalId],
      );
      const actualAccessRevision = memberships.rows[0]?.count ?? '0';
      if (
        input.observedProjectAccessRevision !== undefined &&
        input.observedProjectAccessRevision !== actualAccessRevision
      ) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_REVISION_CONFLICT',
          safeMessage: 'The accessible Project set changed before bootstrap.',
          module: 'project-bootstrap',
          operation: 'verify-project-access-revision',
        });
      }
      if (sessionRow.active_project_id !== null || actualAccessRevision !== '0') {
        throw new ShotgunError({
          code: 'ZERO_PROJECT_PRECONDITION_FAILED',
          safeMessage: 'The Session is no longer in the zero-project state.',
          module: 'project-bootstrap',
          operation: 'verify-zero-project-state',
        });
      }

      const projectId = randomUUID();
      const createdAt = new Date();
      const inserted = await client.query<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        active: boolean;
        created_at: Date;
        updated_at: Date;
        revision: number;
      }>(
        `INSERT INTO project_admin.projects (
           id, name, description, status, active, created_at, updated_at, revision
         ) VALUES ($1, $2, $3, 'ACTIVE', true, $4, $4, 1)
         RETURNING id, name, description, status, active, created_at, updated_at, revision`,
        [projectId, input.payload.name, input.payload.description ?? null, createdAt],
      );
      await client.query(
        `INSERT INTO project_admin.project_revisions (
           project_id, revision, changed_by, change_reason, created_at
         ) VALUES ($1, 1, $2, 'Initial zero-project bootstrap', $3)`,
        [projectId, input.principalId, createdAt],
      );
      await client.query(
        `INSERT INTO auth.project_memberships (
           principal_id, project_id, scopes, sensitivity_clearance, is_owner
         ) VALUES ($1, $2, $3, 'private', true)`,
        [input.principalId, projectId, ['owner']],
      );
      await client.query(
        `UPDATE auth.sessions
         SET active_project_id = $2
         WHERE session_id = $1
           AND active_project_id IS NULL`,
        [input.sessionId, projectId],
      );
      await client.query(
        `INSERT INTO settings.settings_revisions (
           project_id, revision, settings_snapshot, created_at
         ) VALUES ($1, 1, '{}'::jsonb, $2)`,
        [projectId, createdAt],
      );
      await client.query(
        `INSERT INTO settings.policy_context_revisions (
           project_id, revision, policy_binding, created_at
         ) VALUES ($1, 1, '{}'::jsonb, $2)`,
        [projectId, createdAt],
      );
      await client.query(
        `INSERT INTO project_admin.project_commands (
           command_id, client_request_id, idempotency_key, project_id, actor_id,
           expected_revision, command_type, command_payload, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, 0, 'CREATE_PROJECT_BOOTSTRAP', $6, 'APPLIED', $7)`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          projectId,
          input.principalId,
          JSON.stringify(input.payload),
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO project_admin.project_command_results (
           command_id, client_request_id, idempotency_key, status,
           applied_revision, completed_at
         ) VALUES ($1, $2, $3, 'APPLIED', 1, $4)`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, createdAt],
      );
      await client.query(
        `INSERT INTO auth.audit_events (
           audit_event_id, principal_id, project_id, event, reason, created_at
         ) VALUES ($1, $2, $3, 'PROJECT_BOOTSTRAP_COMMITTED', $4, $5)`,
        [randomUUID(), input.principalId, projectId, `commandId=${input.commandId}`, createdAt],
      );
      await client.query(
        `INSERT INTO settings.settings_audit_events (
           event_id, project_id, actor_id, action_name, risk_level, details, timestamp
         ) VALUES ($1, $2, $3, 'PROJECT_CREATED', 'LOW', $4, $5)`,
        [
          randomUUID(),
          projectId,
          input.principalId,
          JSON.stringify({ bootstrap: true, commandId: input.commandId }),
          createdAt,
        ],
      );
      await client.query('COMMIT');
      return { project: this.toProjectView(inserted.rows[0]!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findCompleted(commandId: string): Promise<ProjectListItemView | null> {
    const client = await this.pool.connect();
    try {
      return await this.findCompletedWithClient(client, commandId);
    } finally {
      client.release();
    }
  }

  private async findCompletedWithClient(
    client: PoolClient,
    commandId: string,
  ): Promise<ProjectListItemView | null> {
    const result = await client.query<{
      id: string;
      name: string;
      description: string | null;
      status: string;
      active: boolean;
      created_at: Date;
      updated_at: Date;
      revision: number;
    }>(
      `SELECT project.id, project.name, project.description, project.status,
              project.active, project.created_at, project.updated_at, project.revision
       FROM project_admin.project_commands command
       JOIN project_admin.projects project ON project.id = command.project_id
       WHERE command.command_id = $1
         AND command.command_type = 'CREATE_PROJECT_BOOTSTRAP'
         AND command.status = 'APPLIED'`,
      [commandId],
    );
    return result.rows[0] ? this.toProjectView(result.rows[0]) : null;
  }

  private toProjectView(row: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    active: boolean;
    created_at: Date;
    updated_at: Date;
    revision: number;
  }): ProjectListItemView {
    return decodeProjectListItemView({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isOwner: true,
      status: row.status,
      active: row.active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      revision: Number(row.revision),
      capability: {
        canRename: row.status === 'ACTIVE',
        canArchive: row.status === 'ACTIVE',
        canRestore: row.status === 'ARCHIVED',
        canDelete: row.status === 'ACTIVE' || row.status === 'ARCHIVED',
        canManagePolicies: row.status === 'ACTIVE',
      },
    });
  }
}

export class PostgresSettingsRepository implements SettingsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getPrincipalPreferences(principalId: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query<{ preferences_snapshot: Record<string, unknown> }>(
      `SELECT preferences_snapshot FROM settings.preference_revisions
       WHERE principal_id = $1
       ORDER BY revision DESC LIMIT 1`,
      [principalId],
    );
    return (
      res.rows[0]?.preferences_snapshot ?? {
        locale: 'en-US',
        timezone: 'UTC',
        dateDisplay: 'YYYY-MM-DD',
        screenDensity: 'COMFORTABLE',
        reducedMotion: false,
      }
    );
  }

  async getPrincipalPreferenceRevision(principalId: string): Promise<number> {
    const result = await this.pool.query<{ revision: number }>(
      `SELECT COALESCE(MAX(revision), 0) AS revision
       FROM settings.preference_revisions
       WHERE principal_id = $1`,
      [principalId],
    );
    return result.rows[0]?.revision ?? 0;
  }

  async updatePrincipalPreferences(
    input: ApplyPreferenceCommandInput,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingIdem = await client.query<{
        client_request_id: string;
      }>(
        `SELECT client_request_id FROM settings.preference_command_results WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingIdem.rows.length > 0) {
        if (existingIdem.rows[0]?.client_request_id !== input.clientRequestId) {
          throw new FrontendContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            `Idempotency key '${input.idempotencyKey}' reused with different clientRequestId.`,
          );
        }
        await client.query('COMMIT');
        return this.getPrincipalPreferences(input.principalId); // Return current state
      }

      // Lock principal row first
      await client.query(
        `INSERT INTO settings.principal_preferences (principal_id, preferences, updated_at)
         VALUES ($1, '{}'::jsonb, now())
         ON CONFLICT (principal_id) DO NOTHING`,
        [input.principalId],
      );
      await client.query(
        `SELECT principal_id FROM settings.principal_preferences WHERE principal_id = $1 FOR UPDATE`,
        [input.principalId],
      );
      const revRes = await client.query<{ revision: number }>(
        `SELECT COALESCE(MAX(revision), 0) AS revision FROM settings.preference_revisions WHERE principal_id = $1`,
        [input.principalId],
      );
      const currentRev = revRes.rows[0]?.revision ?? 0;
      if (currentRev !== input.expectedPreferenceRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected preference revision ${input.expectedPreferenceRevision} but current is ${currentRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      const existing = await this.getPrincipalPreferences(input.principalId);
      const updated = { ...existing, ...input.preferences };

      // INSERT revision
      await client.query(
        `INSERT INTO settings.preference_revisions (principal_id, revision, preferences_snapshot, created_at)
         VALUES ($1, $2, $3, now())`,
        [input.principalId, nextRev, JSON.stringify(updated)],
      );

      // Record commands
      await client.query(
        `INSERT INTO settings.preference_commands (command_id, client_request_id, idempotency_key, principal_id, expected_revision, status, command_payload, created_at)
         VALUES ($1, $2, $3, $4, $5, 'APPLIED', $6, now())`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          input.principalId,
          input.expectedPreferenceRevision,
          JSON.stringify(input.preferences),
        ],
      );
      await client.query(
        `INSERT INTO settings.preference_command_results (command_id, client_request_id, idempotency_key, status, applied_revision, completed_at)
         VALUES ($1, $2, $3, 'APPLIED', $4, now())`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, nextRev],
      );

      // Audit event
      await client.query(
        `INSERT INTO settings.settings_audit_events
           (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [
          randomUUID(),
          'SYSTEM_SCOPE', // Preferences are not project-scoped
          input.principalId,
          'PREFERENCE_COMMAND_APPLIED',
          'LOW',
          JSON.stringify({ appliedRevision: nextRev, keys: Object.keys(input.preferences) }),
        ],
      );

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSettingsSnapshot(projectId: string): Promise<SettingsSnapshot> {
    // Independent settings revision — do not use project_admin.projects.revision
    const settingsRevRes = await this.pool.query<{ revision: number }>(
      `SELECT MAX(revision) AS revision FROM settings.settings_revisions WHERE project_id = $1`,
      [projectId],
    );
    const settingsRev = settingsRevRes.rows[0]?.revision ?? 1;

    // Independent policy context revision
    const policyRevRes = await this.pool.query<{ revision: number }>(
      `SELECT MAX(revision) AS revision FROM settings.policy_context_revisions WHERE project_id = $1`,
      [projectId],
    );
    const policyRev = policyRevRes.rows[0]?.revision ?? 1;

    const snapRes = await this.pool.query<{ settings_snapshot: Record<string, unknown> }>(
      `SELECT settings_snapshot FROM settings.settings_revisions
       WHERE project_id = $1
       ORDER BY revision DESC LIMIT 1`,
      [projectId],
    );
    const snapshotJson = snapRes.rows[0]?.settings_snapshot ?? {};

    const localeVal =
      typeof snapshotJson['general.locale'] === 'string' ? snapshotJson['general.locale'] : 'ko-KR';

    return decodeSettingsSnapshot({
      schemaVersion: '1.0.0',
      targetProjectId: projectId,
      settingsRevision: settingsRev,
      policyContextRevision: policyRev,
      categories: [
        {
          categoryId: 'preferences',
          label: 'User Preferences',
          description: 'Personal display and locale settings',
          scope: 'PRINCIPAL',
          totalSettingsCount: 5,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'IMMEDIATE',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
          lastModifiedAt: new Date().toISOString(),
        },
        {
          categoryId: 'projects',
          label: 'Project Administration',
          description: 'Project identity, lifecycle and access',
          scope: 'PROJECT',
          totalSettingsCount: 3,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'IMMEDIATE',
          capability: { canEdit: true, canReset: false, canProposeReview: false },
          lastModifiedAt: new Date().toISOString(),
        },
      ],
      settings: [
        {
          key: 'general.locale',
          label: 'Locale',
          description: 'Interface language and regional formatting',
          scope: 'PRINCIPAL',
          category: 'preferences',
          valueType: 'string',
          currentValue: localeVal,
          defaultValue: 'ko-KR',
          applicationMode: 'IMMEDIATE',
          riskLevel: 'LOW',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
        },
      ],
      fetchedAt: new Date().toISOString(),
    });
  }

  async validateSettingsDraft(
    _projectId: string,
    draft: Record<string, unknown>,
  ): Promise<SettingsValidationResult> {
    const errors: { key: string; message: string }[] = [];
    const warnings: { key: string; message: string }[] = [];

    if (
      draft['costs.monthlyHardLimitUsd'] !== undefined &&
      Number(draft['costs.monthlyHardLimitUsd']) < 0
    ) {
      errors.push({ key: 'costs.monthlyHardLimitUsd', message: 'Hard limit cannot be negative.' });
    }

    return Object.freeze({
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    });
  }

  async previewSettingsImpact(
    projectId: string,
    expectedSettingsRevision: number,
    observedPolicyContextRevision: number,
    draft: Record<string, unknown>,
  ): Promise<SettingsImpactPreview> {
    const revRes = await this.pool.query<{ revision: number }>(
      `SELECT MAX(revision) AS revision FROM settings.settings_revisions WHERE project_id = $1`,
      [projectId],
    );
    const currentRev = revRes.rows[0]?.revision ?? 1;
    if (currentRev !== expectedSettingsRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected settings revision ${expectedSettingsRevision} but current is ${currentRev}.`,
      );
    }

    const policyRevisionResult = await this.pool.query<{ revision: number }>(
      `SELECT MAX(revision) AS revision
       FROM settings.policy_context_revisions
       WHERE project_id = $1`,
      [projectId],
    );
    const currentPolicyRevision = policyRevisionResult.rows[0]?.revision ?? 1;
    if (currentPolicyRevision !== observedPolicyContextRevision) {
      throw new FrontendContractError(
        'POLICY_CONTEXT_CHANGED',
        `Observed policy context revision ${observedPolicyContextRevision} but current is ${currentPolicyRevision}.`,
      );
    }

    return Object.freeze({
      targetProjectId: projectId,
      expectedRevision: expectedSettingsRevision,
      ...deriveSettingsImpact(draft),
      affectedComponents: Object.freeze(['settings-policy']),
      summaryDescription: `Applying ${Object.keys(draft).length} setting changes to project ${projectId}.`,
    });
  }

  async applySettingsCommand(input: ApplySettingsCommandInput): Promise<SettingsCommandResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingCmd = await client.query<{
        command_id: string;
        client_request_id: string;
        command_payload: Record<string, unknown>;
        project_id: string;
        expected_revision: number;
        status: string;
        applied_revision: number | null;
        completed_at: Date;
      }>(
        `SELECT c.command_id, c.client_request_id, c.command_payload, c.project_id, c.expected_revision, r.status, r.applied_revision, r.completed_at
         FROM settings.settings_commands c
         JOIN settings.settings_command_results r USING (command_id)
         WHERE c.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingCmd.rows.length > 0) {
        const row = existingCmd.rows[0]!;
        const payloadMatch = JSON.stringify(row.command_payload) === JSON.stringify(input.settings);
        if (
          row.client_request_id !== input.clientRequestId ||
          row.project_id !== input.projectId ||
          row.expected_revision !== input.expectedSettingsRevision ||
          !payloadMatch
        ) {
          throw new FrontendContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            `Idempotency key '${input.idempotencyKey}' reused with mismatched parameters or payload.`,
          );
        }
        await client.query('COMMIT');
        return Object.freeze({
          commandId: row.command_id,
          clientRequestId: row.client_request_id,
          idempotencyKey: input.idempotencyKey,
          projectId: row.project_id,
          status: row.status as SettingsCommandResult['status'],
          appliedRevision: row.applied_revision ?? undefined,
          completedAt: row.completed_at ? row.completed_at.toISOString() : new Date().toISOString(),
        });
      }

      // 1. Lock parent project row
      const projRes = await client.query<{ id: string }>(
        `SELECT id FROM project_admin.projects WHERE id = $1 FOR UPDATE`,
        [input.projectId],
      );
      if (projRes.rows.length === 0) {
        throw new FrontendContractError(
          'RESOURCE_RETIRED',
          `Project '${input.projectId}' not found.`,
        );
      }

      // 2. Query settings revision (no FOR UPDATE on aggregate)
      const revRes = await client.query<{ revision: number }>(
        `SELECT COALESCE(MAX(revision), 0) AS revision FROM settings.settings_revisions WHERE project_id = $1`,
        [input.projectId],
      );
      const currentRev = revRes.rows[0]?.revision ?? 0;
      if (currentRev !== input.expectedSettingsRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected settings revision ${input.expectedSettingsRevision} but current is ${currentRev}.`,
        );
      }

      // 3. Query policy context revision (no FOR UPDATE on aggregate)
      const policyRevRes = await client.query<{ revision: number }>(
        `SELECT COALESCE(MAX(revision), 0) AS revision FROM settings.policy_context_revisions WHERE project_id = $1`,
        [input.projectId],
      );
      const currentPolicyRev = policyRevRes.rows[0]?.revision ?? 0;
      if (currentPolicyRev !== input.observedPolicyContextRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Observed policy context revision ${input.observedPolicyContextRevision} differs from current ${currentPolicyRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      const nextPolicyRev = currentPolicyRev + 1; // Bump policy context revision since settings affect policy

      // Read current snapshot from latest settings_revisions row
      const existingSnap = await client.query<{ settings_snapshot: Record<string, unknown> }>(
        `SELECT settings_snapshot FROM settings.settings_revisions
         WHERE project_id = $1
         ORDER BY revision DESC LIMIT 1`,
        [input.projectId],
      );
      const updatedSnapshot = {
        ...(existingSnap.rows[0]?.settings_snapshot ?? {}),
        ...input.settings,
      };

      // INSERT new settings_revisions row (append-only; PK=(project_id, revision))
      await client.query(
        `INSERT INTO settings.settings_revisions (project_id, revision, settings_snapshot, created_at)
         VALUES ($1, $2, $3, now())`,
        [input.projectId, nextRev, JSON.stringify(updatedSnapshot)],
      );

      // INSERT new policy_context_revisions row
      await client.query(
        `INSERT INTO settings.policy_context_revisions (project_id, revision, policy_binding, created_at)
         VALUES ($1, $2, $3, now())`,
        [input.projectId, nextPolicyRev, JSON.stringify({})],
      );

      await client.query(
        `INSERT INTO settings.settings_commands (command_id, client_request_id, idempotency_key, project_id, expected_revision, status, command_payload, created_at)
         VALUES ($1, $2, $3, $4, $5, 'APPLIED', $6, now())`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          input.projectId,
          input.expectedSettingsRevision,
          JSON.stringify(input.settings),
        ],
      );

      await client.query(
        `INSERT INTO settings.settings_command_results (command_id, client_request_id, idempotency_key, status, applied_revision, completed_at)
         VALUES ($1, $2, $3, 'APPLIED', $4, now())`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, nextRev],
      );

      // Audit event — use actual schema columns
      await client.query(
        `INSERT INTO settings.settings_audit_events
           (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [
          randomUUID(),
          input.projectId,
          input.actorId,
          'SETTINGS_COMMAND_APPLIED',
          'LOW',
          JSON.stringify({ appliedRevision: nextRev, keys: Object.keys(input.settings) }),
        ],
      );

      await client.query('COMMIT');

      return Object.freeze({
        commandId: input.commandId,
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
        projectId: input.projectId,
        status: 'APPLIED',
        appliedRevision: nextRev,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCommandStatus(commandId: string): Promise<SettingsCommandResult | null> {
    // Join settings_commands to get project_id for route-level authorization
    const res = await this.pool.query<{
      command_id: string;
      client_request_id: string;
      idempotency_key: string;
      project_id: string | null;
      status: string;
      applied_revision: number | null;
      review_proposal_id: string | null;
      error_message: string | null;
      completed_at: Date;
    }>(
      `SELECT r.command_id, r.client_request_id, r.idempotency_key, c.project_id,
              r.status, r.applied_revision, r.review_proposal_id, r.error_message, r.completed_at
       FROM settings.settings_command_results r
       LEFT JOIN settings.settings_commands c USING (command_id)
       WHERE r.command_id = $1`,
      [commandId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    return Object.freeze({
      commandId: row.command_id,
      clientRequestId: row.client_request_id,
      idempotencyKey: row.idempotency_key,
      projectId: row.project_id ?? undefined,
      status: row.status as SettingsCommandResult['status'],
      appliedRevision: row.applied_revision ?? undefined,
      reviewProposalId: row.review_proposal_id ?? undefined,
      errorMessage: row.error_message ?? undefined,
      completedAt: row.completed_at.toISOString(),
    });
  }

  async getModelDescriptors(
    projectId: string,
  ): Promise<ProductFeatureView<readonly ModelDescriptorView[]>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Model configurations are not available in this tier.',
    };
  }

  async getCostBudget(projectId: string): Promise<ProductFeatureView<CostBudgetView>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Cost & Billing features are not available in this tier.',
    };
  }

  async getPrivacyRetention(projectId: string): Promise<ProductFeatureView<PrivacyRetentionView>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Privacy controls are not available in this tier.',
    };
  }

  async getConnectorSettings(
    projectId: string,
  ): Promise<ProductFeatureView<readonly ConnectorSettingsView[]>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Connectors are not available in this tier.',
    };
  }

  async getDirectiveProposals(
    projectId: string,
  ): Promise<ProductFeatureView<readonly DirectiveProposalView[]>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Directives are not available in this tier.',
    };
  }

  async getSchemaPacks(projectId: string): Promise<ProductFeatureView<readonly SchemaPackView[]>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Schema Packs are not available in this tier.',
    };
  }

  async getDiagnostics(projectId: string): Promise<ProductFeatureView<DiagnosticsView>> {
    void projectId;
    return {
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason: 'Diagnostics are not available in this tier.',
    };
  }
}

/**
 * PostgreSQL Policy History read adapter (WP2-A). Reads the authoritative
 * append-only `settings.settings_audit_events` source. Read-only: never
 * mutates the source (migration 032 forbids UPDATE/DELETE/TRUNCATE).
 */
export class PostgresPolicyHistoryReadAdapter implements PolicyHistoryReadPort {
  constructor(private readonly pool: Pool) {}

  async listPolicyHistory(input: ListPolicyHistoryInput): Promise<ListPolicyHistoryResult> {
    if (!input.projectId) {
      throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `ListPolicyHistory limit must be a positive integer, got ${input.limit}`,
      );
    }
    const params: (string | number)[] = [input.projectId];
    let cursorPredicate = '';
    if (input.cursor) {
      params.push(input.cursor.timestamp, input.cursor.eventId);
      cursorPredicate = `AND (timestamp > $2 OR (timestamp = $2 AND event_id > $3))`;
    }
    params.push(input.limit + 1);
    const res = await this.pool.query<{
      event_id: string;
      project_id: string;
      actor_id: string;
      action_name: string;
      risk_level: string;
      details: Record<string, unknown>;
      timestamp: Date;
    }>(
      `SELECT event_id, project_id, actor_id, action_name, risk_level, details, timestamp
       FROM settings.settings_audit_events
       WHERE project_id = $1 ${cursorPredicate}
       ORDER BY timestamp ASC, event_id ASC
       LIMIT $${params.length}`,
      params,
    );
    const entries = res.rows.map((row) =>
      Object.freeze({
        eventId: row.event_id,
        projectId: row.project_id,
        actorId: row.actor_id,
        actionName: row.action_name,
        riskLevel: row.risk_level,
        details: row.details,
        timestamp: row.timestamp.toISOString(),
      }),
    );
    const hasMore = entries.length > input.limit;
    const page = hasMore ? entries.slice(0, input.limit) : entries;
    const nextCursor =
      hasMore && page.length > 0
        ? { timestamp: page[page.length - 1]!.timestamp, eventId: page[page.length - 1]!.eventId }
        : undefined;
    return { entries: Object.freeze(page), nextCursor };
  }
}

/**
 * PostgreSQL ProjectTombstone / DeletedProjectAuditScope store (WP2-C).
 * Reads/writes project_audit.project_tombstones and
 * project_audit.deleted_project_audit_scopes (migration 031).
 */
export class PostgresProjectTombstoneStore implements ProjectTombstoneStorePort {
  constructor(private readonly pool: Pool) {}

  async createTombstone(input: CreateProjectTombstoneInput): Promise<ProjectTombstoneRecord> {
    if (!input.projectId) {
      throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    }
    await this.pool.query(
      `INSERT INTO project_audit.project_tombstones
         (project_id, deleted_at, deleted_by, reason, retention_class, lineage_digest)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.projectId,
        input.deletedAt,
        input.deletedBy,
        input.reason,
        input.retentionClass,
        input.lineageDigest,
      ],
    );
    return this.getTombstone(input.projectId) as Promise<ProjectTombstoneRecord>;
  }

  async getTombstone(projectId: string): Promise<ProjectTombstoneRecord | null> {
    if (!projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    const res = await this.pool.query<{
      project_id: string;
      deleted_at: Date;
      deleted_by: string;
      reason: string;
      retention_class: string;
      lineage_digest: string;
    }>(
      `SELECT project_id, deleted_at, deleted_by, reason, retention_class, lineage_digest
       FROM project_audit.project_tombstones WHERE project_id = $1`,
      [projectId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return Object.freeze({
      projectId: row.project_id,
      deletedAt: row.deleted_at.toISOString(),
      deletedBy: row.deleted_by,
      reason: row.reason,
      retentionClass: row.retention_class,
      lineageDigest: row.lineage_digest,
    });
  }

  async grantAuditScope(
    input: GrantDeletedProjectAuditScopeInput,
  ): Promise<DeletedProjectAuditScopeRecord> {
    if (!input.scopeId || !input.projectId) {
      throw new FrontendContractError('INVALID_REQUEST', 'scopeId and projectId required');
    }
    const tombstone = await this.getTombstone(input.projectId);
    if (!tombstone) {
      throw new FrontendContractError(
        'NOT_FOUND',
        `Project ${input.projectId} has no tombstone; audit scope requires a tombstone.`,
      );
    }
    await this.pool.query(
      `INSERT INTO project_audit.deleted_project_audit_scopes
         (scope_id, project_id, granted_principal_ids, granted_at, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.scopeId,
        input.projectId,
        JSON.stringify(input.grantedPrincipalIds),
        input.grantedAt,
        input.grantedBy,
      ],
    );
    return this.getAuditScope(input.scopeId) as Promise<DeletedProjectAuditScopeRecord>;
  }

  async revokeAuditScope(
    input: RevokeDeletedProjectAuditScopeInput,
  ): Promise<DeletedProjectAuditScopeRecord> {
    const res = await this.pool.query(
      `UPDATE project_audit.deleted_project_audit_scopes
       SET revoked_at = $2 WHERE scope_id = $1 AND revoked_at IS NULL`,
      [input.scopeId, input.revokedAt],
    );
    if (res.rowCount === 0) {
      const existing = await this.getAuditScope(input.scopeId);
      if (!existing) {
        throw new FrontendContractError('NOT_FOUND', `Audit scope ${input.scopeId} not found.`);
      }
      throw new FrontendContractError(
        'CONFLICT',
        `Audit scope ${input.scopeId} is already revoked.`,
      );
    }
    return this.getAuditScope(input.scopeId) as Promise<DeletedProjectAuditScopeRecord>;
  }

  async getAuditScope(scopeId: string): Promise<DeletedProjectAuditScopeRecord | null> {
    if (!scopeId) throw new FrontendContractError('INVALID_REQUEST', 'scopeId required');
    const res = await this.pool.query<{
      scope_id: string;
      project_id: string;
      granted_principal_ids: string[];
      granted_at: Date;
      granted_by: string;
      revoked_at: Date | null;
    }>(
      `SELECT scope_id, project_id, granted_principal_ids, granted_at, granted_by, revoked_at
       FROM project_audit.deleted_project_audit_scopes WHERE scope_id = $1`,
      [scopeId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return Object.freeze({
      scopeId: row.scope_id,
      projectId: row.project_id,
      grantedPrincipalIds: Object.freeze(row.granted_principal_ids),
      grantedAt: row.granted_at.toISOString(),
      grantedBy: row.granted_by,
      revokedAt: row.revoked_at ? row.revoked_at.toISOString() : undefined,
    });
  }

  async listAuditScopes(projectId: string): Promise<readonly DeletedProjectAuditScopeRecord[]> {
    if (!projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    const res = await this.pool.query<{
      scope_id: string;
      project_id: string;
      granted_principal_ids: string[];
      granted_at: Date;
      granted_by: string;
      revoked_at: Date | null;
    }>(
      `SELECT scope_id, project_id, granted_principal_ids, granted_at, granted_by, revoked_at
       FROM project_audit.deleted_project_audit_scopes
       WHERE project_id = $1 ORDER BY scope_id ASC`,
      [projectId],
    );
    return Object.freeze(
      res.rows.map((row) =>
        Object.freeze({
          scopeId: row.scope_id,
          projectId: row.project_id,
          grantedPrincipalIds: Object.freeze(row.granted_principal_ids),
          grantedAt: row.granted_at.toISOString(),
          grantedBy: row.granted_by,
          revokedAt: row.revoked_at ? row.revoked_at.toISOString() : undefined,
        }),
      ),
    );
  }
}
