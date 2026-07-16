import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  IntakeRepositoryPort,
  IntakeSubmission,
  SavedIntakeSubmission,
} from '../../../modules/intake/src/index.js';
import type {
  OriginalAssetRepositoryPort,
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
