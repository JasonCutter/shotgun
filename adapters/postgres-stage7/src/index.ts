import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  ProjectionCommitWrite,
  ProjectionRebuildWrite,
  SearchProjectionRepositoryPort,
} from '../../../modules/projection-search/src/index.js';
import {
  canonicalSnapshotDigest,
  type CanonicalSearchMatch,
  type CanonicalSearchResult,
  type ProjectionWatermark,
  type SearchProjectionDocument,
} from '../../../packages/contracts/src/index.js';

type WatermarkRow = QueryResultRow & {
  readonly project_id: string;
  readonly last_commit_id: string | null;
  readonly canonical_version: number;
  readonly snapshot_digest: string;
  readonly status: 'READY' | 'DEGRADED';
  readonly last_error: string | null;
  readonly updated_at: Date;
};

type SearchRow = QueryResultRow & {
  readonly project_id: string;
  readonly claim_id: string;
  readonly commit_id: string;
  readonly revision_id: string;
  readonly canonical_version: number;
  readonly claim_text: string;
  readonly source_version_id: string;
  readonly evidence_ids: string[];
  readonly access_scope: string[];
  readonly sensitivity: SearchProjectionDocument['sensitivity'];
  readonly projected_at: Date;
  readonly score: number;
  readonly match_type: CanonicalSearchMatch;
};

export type PostgresStage7Options = { readonly failpoint?: 'after-document' };

const mapWatermark = (row: WatermarkRow): ProjectionWatermark => ({
  projectId: row.project_id,
  ...(row.last_commit_id ? { lastCommitId: row.last_commit_id } : {}),
  canonicalVersion: row.canonical_version,
  snapshotDigest: row.snapshot_digest,
  status: row.status,
  ...(row.last_error ? { lastError: row.last_error } : {}),
  updatedAt: row.updated_at.toISOString(),
});

const insertDocument = async (client: PoolClient, document: SearchProjectionDocument) => {
  await client.query(
    `INSERT INTO projection.search_documents (
       project_id, claim_id, commit_id, revision_id, canonical_version, claim_text,
       source_version_id, evidence_ids, access_scope, sensitivity, projected_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (project_id, claim_id) DO UPDATE SET
       commit_id = EXCLUDED.commit_id,
       revision_id = EXCLUDED.revision_id,
       canonical_version = EXCLUDED.canonical_version,
       claim_text = EXCLUDED.claim_text,
       source_version_id = EXCLUDED.source_version_id,
       evidence_ids = EXCLUDED.evidence_ids,
       access_scope = EXCLUDED.access_scope,
       sensitivity = EXCLUDED.sensitivity,
       projected_at = EXCLUDED.projected_at`,
    [
      document.projectId,
      document.claimId,
      document.commitId,
      document.revisionId,
      document.canonicalVersion,
      document.claimText,
      document.sourceVersionId,
      document.evidenceIds,
      document.accessScope,
      document.sensitivity,
      document.projectedAt,
    ],
  );
};

const upsertWatermark = async (client: PoolClient, watermark: ProjectionWatermark) => {
  await client.query(
    `INSERT INTO projection.watermarks (
       project_id, last_commit_id, canonical_version, snapshot_digest, status, last_error, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id) DO UPDATE SET
       last_commit_id = EXCLUDED.last_commit_id,
       canonical_version = EXCLUDED.canonical_version,
       snapshot_digest = EXCLUDED.snapshot_digest,
       status = EXCLUDED.status,
       last_error = EXCLUDED.last_error,
       updated_at = EXCLUDED.updated_at`,
    [
      watermark.projectId,
      watermark.lastCommitId ?? null,
      watermark.canonicalVersion,
      watermark.snapshotDigest,
      watermark.status,
      watermark.lastError ?? null,
      watermark.updatedAt,
    ],
  );
};

export class PostgresSearchProjectionRepository implements SearchProjectionRepositoryPort {
  constructor(
    private readonly pool: Pool,
    private readonly options: PostgresStage7Options = {},
  ) {}

  async applyCommit(projectId: string, write: ProjectionCommitWrite): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<WatermarkRow>(
        `SELECT project_id, last_commit_id, canonical_version, snapshot_digest,
                status, last_error, updated_at
         FROM projection.watermarks
         WHERE project_id = $1
         FOR UPDATE`,
        [projectId],
      );
      const existing = current.rows[0];
      if (existing?.last_commit_id === write.commitId) {
        await client.query('COMMIT');
        return;
      }
      const projectedVersion = existing?.canonical_version ?? 0;
      const expectedVersion =
        write.operation === 'ADD_CLAIM' ? projectedVersion + 1 : projectedVersion;
      if (write.canonicalVersion !== expectedVersion) {
        throw new Error(
          `Projection sequence gap: expected ${expectedVersion}, received ${write.canonicalVersion}.`,
        );
      }
      if (write.document) await insertDocument(client, write.document);
      if (this.options.failpoint === 'after-document') {
        throw new Error('Stage 7 projection failpoint after document.');
      }
      await upsertWatermark(client, {
        projectId,
        lastCommitId: write.commitId,
        canonicalVersion: write.canonicalVersion,
        snapshotDigest: write.snapshotDigest,
        status: 'READY',
        updatedAt: write.projectedAt,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rebuild(projectId: string, write: ProjectionRebuildWrite): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM projection.search_documents WHERE project_id = $1', [
        projectId,
      ]);
      for (const document of write.documents) await insertDocument(client, document);
      if (this.options.failpoint === 'after-document') {
        throw new Error('Stage 7 projection failpoint after document.');
      }
      await upsertWatermark(client, write.watermark);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDegraded(projectId: string, error: string, updatedAt: string): Promise<void> {
    const current = await this.findWatermark(projectId);
    const client = await this.pool.connect();
    try {
      await upsertWatermark(client, {
        projectId,
        ...(current?.lastCommitId ? { lastCommitId: current.lastCommitId } : {}),
        canonicalVersion: current?.canonicalVersion ?? 0,
        snapshotDigest: current?.snapshotDigest ?? canonicalSnapshotDigest(projectId, 0, []),
        status: 'DEGRADED',
        lastError: error,
        updatedAt,
      });
    } finally {
      client.release();
    }
  }

  async findWatermark(projectId: string): Promise<ProjectionWatermark | undefined> {
    const result = await this.pool.query<WatermarkRow>(
      `SELECT project_id, last_commit_id, canonical_version, snapshot_digest,
              status, last_error, updated_at
       FROM projection.watermarks
       WHERE project_id = $1`,
      [projectId],
    );
    return result.rows[0] ? mapWatermark(result.rows[0]) : undefined;
  }

  async search(
    projectId: string,
    query: string,
    limit: number,
    accessScopes: readonly string[],
  ): Promise<readonly CanonicalSearchResult[]> {
    const result = await this.pool.query<SearchRow>(
      `WITH ranked AS (
         SELECT project_id, claim_id, commit_id, revision_id, canonical_version,
                claim_text, source_version_id, evidence_ids, access_scope, sensitivity,
                projected_at,
                GREATEST(
                  ts_rank_cd(search_vector, websearch_to_tsquery('simple', $2)),
                  similarity(claim_text, $2),
                  CASE WHEN claim_text ILIKE '%' || $2 || '%' THEN 1.0 ELSE 0.0 END
                )::double precision AS score,
                CASE
                  WHEN claim_text ILIKE '%' || $2 || '%' THEN 'SUBSTRING'
                  WHEN search_vector @@ websearch_to_tsquery('simple', $2) THEN 'FULL_TEXT'
                  ELSE 'TRIGRAM'
                END AS match_type
         FROM projection.search_documents
         WHERE project_id = $1
           AND access_scope <@ $3::text[]
           AND (
             search_vector @@ websearch_to_tsquery('simple', $2)
             OR claim_text % $2
             OR claim_text ILIKE '%' || $2 || '%'
           )
       )
       SELECT * FROM ranked
       ORDER BY score DESC, claim_id
       LIMIT $4`,
      [projectId, query, accessScopes, limit],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      claimId: row.claim_id,
      commitId: row.commit_id,
      revisionId: row.revision_id,
      canonicalVersion: row.canonical_version,
      claimText: row.claim_text,
      sourceVersionId: row.source_version_id,
      evidenceIds: row.evidence_ids,
      accessScope: row.access_scope,
      sensitivity: row.sensitivity,
      projectedAt: row.projected_at.toISOString(),
      score: row.score,
      matchType: row.match_type,
    }));
  }
}
