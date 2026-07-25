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
} from '../../../packages/contracts/src/index.js';
import type {
  CreateProjectInput,
  ProjectAdministrationRepositoryPort,
  UpdateProjectInput,
} from '../../../modules/project-administration/src/index.js';
import type {
  ApplySettingsCommandInput,
  SettingsRepositoryPort,
} from '../../../modules/settings-policy/src/index.js';
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

export class PostgresOriginalAssetRepository implements OriginalAssetRepositoryPort {
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

  async getProjects(principalId: string): Promise<ProjectAdministrationView> {
    if (!principalId) throw new FrontendContractError('INVALID_REQUEST', 'principalId required');
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
       ORDER BY created_at ASC`,
    );

    const projects: ProjectListItemView[] = res.rows.map((row) =>
      decodeProjectListItemView({
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
      }),
    );

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

  async createProject(input: CreateProjectInput): Promise<ProjectListItemView> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();
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
        [input.id, input.name, input.description ?? null, now],
      );

      await client.query(
        `INSERT INTO project_admin.project_revisions (project_id, revision, changed_by, change_reason, created_at)
         VALUES ($1, 1, $2, 'Initial project creation', $3)`,
        [input.id, input.ownerId, now],
      );

      // 1. Owner Membership
      await client.query(
        `INSERT INTO auth.memberships (principal_id, project_id, scopes, sensitivity_clearance, is_owner, created_at)
         VALUES ($1, $2, $3, $4, true, $5)
         ON CONFLICT (principal_id, project_id) DO NOTHING`,
        [input.ownerId, input.id, JSON.stringify(['owner']), 'private', now],
      );

      // 2. Initial Policy Context
      await client.query(
        `INSERT INTO settings.policy_context_revisions (project_id, revision, updated_at)
         VALUES ($1, 1, $2)
         ON CONFLICT (project_id) DO NOTHING`,
        [input.id, now],
      );

      // 3. Initial Settings Snapshot (Empty jsonb for now)
      await client.query(
        `INSERT INTO settings.settings_revisions (project_id, revision, settings_snapshot, updated_at)
         VALUES ($1, 1, '{}'::jsonb, $2)
         ON CONFLICT (project_id) DO NOTHING`,
        [input.id, now],
      );

      // 4. Audit Event
      await client.query(
        `INSERT INTO settings.settings_audit_events (project_id, actor_id, event, target_revision, created_at)
         VALUES ($1, $2, 'PROJECT_CREATED', 1, $3)`,
        [input.id, input.ownerId, now],
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
      if (currentRev !== input.expectedRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected revision ${input.expectedRevision} but current is ${currentRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      const now = new Date();
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

      await client.query('COMMIT');
      const row = updateRes.rows[0]!;
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

  async archiveProject(projectId: string, expectedRevision: number): Promise<ProjectListItemView> {
    return this.updateStatus(projectId, expectedRevision, 'ARCHIVED');
  }

  async restoreProject(projectId: string, expectedRevision: number): Promise<ProjectListItemView> {
    return this.updateStatus(projectId, expectedRevision, 'ACTIVE');
  }

  async requestDeleteProject(
    projectId: string,
    expectedRevision: number,
  ): Promise<ProjectListItemView> {
    return this.updateStatus(projectId, expectedRevision, 'DELETE_REQUESTED');
  }

  private async updateStatus(
    projectId: string,
    expectedRevision: number,
    newStatus: string,
  ): Promise<ProjectListItemView> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const checkRes = await client.query<{ revision: number }>(
        `SELECT revision FROM project_admin.projects WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (checkRes.rows.length === 0) {
        throw new FrontendContractError('RESOURCE_RETIRED', `Project '${projectId}' not found.`);
      }
      const currentRev = checkRes.rows[0]!.revision;
      if (currentRev !== expectedRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected revision ${expectedRevision} but current is ${currentRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      const now = new Date();
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
        [newStatus, nextRev, now, projectId],
      );

      await client.query('COMMIT');
      const row = updateRes.rows[0]!;
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
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export class PostgresSettingsRepository implements SettingsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getPrincipalPreferences(principalId: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query<{ preferences: Record<string, unknown> }>(
      `SELECT preferences FROM settings.principal_preferences WHERE principal_id = $1`,
      [principalId],
    );
    return (
      res.rows[0]?.preferences ?? {
        locale: 'en-US',
        timezone: 'UTC',
        dateDisplay: 'YYYY-MM-DD',
        screenDensity: 'COMFORTABLE',
        reducedMotion: false,
      }
    );
  }

  async updatePrincipalPreferences(
    principalId: string,
    preferences: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = await this.getPrincipalPreferences(principalId);
    const updated = { ...existing, ...preferences };
    await this.pool.query(
      `INSERT INTO settings.principal_preferences (principal_id, preferences, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (principal_id) DO UPDATE SET preferences = $2, updated_at = now()`,
      [principalId, JSON.stringify(updated)],
    );
    return updated;
  }

  async getSettingsSnapshot(projectId: string): Promise<SettingsSnapshot> {
    const revRes = await this.pool.query<{ revision: number }>(
      `SELECT revision FROM project_admin.projects WHERE id = $1`,
      [projectId],
    );
    const rev = revRes.rows[0]?.revision ?? 1;

    const snapRes = await this.pool.query<{ settings_snapshot: Record<string, unknown> }>(
      `SELECT settings_snapshot FROM settings.settings_revisions WHERE project_id = $1`,
      [projectId],
    );
    const snapshotJson = snapRes.rows[0]?.settings_snapshot ?? {};

    const localeVal =
      typeof snapshotJson['general.locale'] === 'string' ? snapshotJson['general.locale'] : 'ko-KR';

    return decodeSettingsSnapshot({
      schemaVersion: '1.0.0',
      targetProjectId: projectId,
      settingsRevision: rev,
      policyContextRevision: rev,
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
    expectedRevision: number,
    draft: Record<string, unknown>,
  ): Promise<SettingsImpactPreview> {
    const revRes = await this.pool.query<{ revision: number }>(
      `SELECT revision FROM project_admin.projects WHERE id = $1`,
      [projectId],
    );
    const currentRev = revRes.rows[0]?.revision ?? 1;
    if (currentRev !== expectedRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${expectedRevision} but current is ${currentRev}.`,
      );
    }

    return Object.freeze({
      targetProjectId: projectId,
      expectedRevision,
      requiresReview: false,
      requiresMigration: false,
      requiresRestart: false,
      riskLevel: 'LOW',
      affectedComponents: Object.freeze(['settings-policy']),
      summaryDescription: `Applying ${Object.keys(draft).length} setting changes to project ${projectId}.`,
    });
  }

  async applySettingsCommand(input: ApplySettingsCommandInput): Promise<SettingsCommandResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingIdem = await client.query<{
        client_request_id: string;
        status: string;
        applied_revision: number | null;
      }>(
        `SELECT client_request_id, status, applied_revision FROM settings.settings_command_results WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingIdem.rows.length > 0) {
        const row = existingIdem.rows[0]!;
        if (row.client_request_id !== input.clientRequestId) {
          throw new FrontendContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            `Idempotency key '${input.idempotencyKey}' reused with different clientRequestId.`,
          );
        }
        await client.query('COMMIT');
        return Object.freeze({
          commandId: input.commandId,
          clientRequestId: input.clientRequestId,
          idempotencyKey: input.idempotencyKey,
          status: row.status as SettingsCommandResult['status'],
          appliedRevision: row.applied_revision ?? undefined,
          completedAt: new Date().toISOString(),
        });
      }

      const revRes = await client.query<{ revision: number }>(
        `SELECT revision FROM project_admin.projects WHERE id = $1 FOR UPDATE`,
        [input.projectId],
      );
      if (revRes.rows.length === 0) {
        throw new FrontendContractError(
          'RESOURCE_RETIRED',
          `Project '${input.projectId}' not found.`,
        );
      }
      const currentRev = revRes.rows[0]!.revision;
      if (currentRev !== input.expectedRevision) {
        throw new FrontendContractError(
          'REVISION_CONFLICT',
          `Expected revision ${input.expectedRevision} but current is ${currentRev}.`,
        );
      }

      const nextRev = currentRev + 1;
      await client.query(
        `UPDATE project_admin.projects SET revision = $1, updated_at = now() WHERE id = $2`,
        [nextRev, input.projectId],
      );

      const existingSnap = await client.query<{ settings_snapshot: Record<string, unknown> }>(
        `SELECT settings_snapshot FROM settings.settings_revisions WHERE project_id = $1`,
        [input.projectId],
      );
      const updatedSnapshot = {
        ...(existingSnap.rows[0]?.settings_snapshot ?? {}),
        ...input.settings,
      };

      await client.query(
        `UPDATE settings.settings_revisions SET settings_snapshot = $1, revision = $2, updated_at = now() WHERE project_id = $3`,
        [JSON.stringify(updatedSnapshot), nextRev, input.projectId],
      );

      await client.query(
        `INSERT INTO settings.settings_commands (command_id, client_request_id, idempotency_key, project_id, expected_revision, status, command_payload, created_at)
         VALUES ($1, $2, $3, $4, $5, 'APPLIED', $6, now())`,
        [
          input.commandId,
          input.clientRequestId,
          input.idempotencyKey,
          input.projectId,
          input.expectedRevision,
          JSON.stringify(input.settings),
        ],
      );

      await client.query(
        `INSERT INTO settings.settings_command_results (command_id, client_request_id, idempotency_key, status, applied_revision, completed_at)
         VALUES ($1, $2, $3, 'APPLIED', $4, now())`,
        [input.commandId, input.clientRequestId, input.idempotencyKey, nextRev],
      );

      await client.query('COMMIT');

      return Object.freeze({
        commandId: input.commandId,
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
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
    const res = await this.pool.query<{
      command_id: string;
      client_request_id: string;
      idempotency_key: string;
      status: string;
      applied_revision: number | null;
      review_proposal_id: string | null;
      error_message: string | null;
      completed_at: Date;
    }>(
      `SELECT command_id, client_request_id, idempotency_key, status, applied_revision, review_proposal_id, error_message, completed_at
       FROM settings.settings_command_results
       WHERE command_id = $1`,
      [commandId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    return Object.freeze({
      commandId: row.command_id,
      clientRequestId: row.client_request_id,
      idempotencyKey: row.idempotency_key,
      status: row.status as SettingsCommandResult['status'],
      appliedRevision: row.applied_revision ?? undefined,
      reviewProposalId: row.review_proposal_id ?? undefined,
      errorMessage: row.error_message ?? undefined,
      completedAt: row.completed_at.toISOString(),
    });
  }

  async getModelDescriptors(projectId: string): Promise<readonly ModelDescriptorView[]> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Model configurations are not available in this tier.',
    );
  }

  async getCostBudget(projectId: string): Promise<CostBudgetView> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Cost & Billing features are not available in this tier.',
    );
  }

  async getPrivacyRetention(projectId: string): Promise<PrivacyRetentionView> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Privacy controls are not available in this tier.',
    );
  }

  async getConnectorSettings(projectId: string): Promise<readonly ConnectorSettingsView[]> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Connectors are not available in this tier.',
    );
  }

  async getDirectiveProposals(projectId: string): Promise<readonly DirectiveProposalView[]> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Directives are not available in this tier.',
    );
  }

  async getSchemaPacks(projectId: string): Promise<readonly SchemaPackView[]> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Schema Packs are not available in this tier.',
    );
  }

  async getDiagnostics(projectId: string): Promise<DiagnosticsView> {
    void projectId;
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Diagnostics are not available in this tier.',
    );
  }
}
