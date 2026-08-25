import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  canonicalSnapshotDigest,
  type CanonicalClaim,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  type KnowledgeReviewGroup,
  semanticCorpusWatermarkFromSource,
  type SemanticApprovedKnowledgeSourceIdentity,
  type SemanticCorpusSourceSnapshot,
  type SemanticCorpusSourceSnapshotReaderPort,
  type SemanticCorpusSourceWatermark,
} from '../../../packages/contracts/src/index.js';
import { buildSemanticCorpusSourceSnapshot } from '../../../modules/semantic-corpus/src/index.js';

type StateRow = QueryResultRow & {
  readonly version: number;
  readonly snapshot_digest: string;
  readonly updated_at: Date;
};

type ClaimRow = QueryResultRow & {
  readonly claim_json: CanonicalClaim;
};

type GroupRow = QueryResultRow & {
  readonly project_id: string;
  readonly group_id: string;
  readonly source_version_id: string;
  readonly revision_number: number;
  readonly content_digest: string;
  readonly items: KnowledgeReviewGroup['items'];
  readonly access_scope: string[];
  readonly sensitivity: KnowledgeReviewGroup['sensitivity'];
  readonly created_at: Date;
  readonly updated_at: Date;
};

type ProjectionRow = QueryResultRow & {
  readonly status: 'READY' | 'DEGRADED';
  readonly projection: CompiledTruthProjection | null;
};

type WatermarkRow = QueryResultRow & {
  readonly version: number | null;
  readonly snapshot_digest: string | null;
  readonly approved_groups: readonly SemanticApprovedKnowledgeSourceIdentity[] | null;
};

const groupColumns = `project_id, group_id, source_version_id, revision_number,
  content_digest, items, access_scope, sensitivity, created_at, updated_at`;

const mapGroup = (row: GroupRow): KnowledgeReviewGroup => ({
  projectId: row.project_id,
  groupId: row.group_id,
  sourceVersionId: row.source_version_id,
  revisionNumber: row.revision_number,
  status: 'APPROVED',
  contentDigest: row.content_digest,
  items: row.items,
  decisions: [],
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const readState = async (client: PoolClient, projectId: string): Promise<StateRow | undefined> => {
  const result = await client.query<StateRow>(
    `SELECT version, snapshot_digest, updated_at
     FROM canonical.project_state
     WHERE project_id = $1`,
    [projectId],
  );
  return result.rows[0];
};

const readApprovedGroups = async (
  client: PoolClient,
  projectId: string,
): Promise<readonly KnowledgeReviewGroup[]> => {
  const result = await client.query<GroupRow>(
    `SELECT ${groupColumns}
     FROM knowledge.review_groups
     WHERE project_id = $1 AND status = 'APPROVED'
     ORDER BY group_id`,
    [projectId],
  );
  return result.rows.map(mapGroup);
};

const readClaims = async (
  client: PoolClient,
  projectId: string,
): Promise<readonly CanonicalClaim[]> => {
  const result = await client.query<ClaimRow>(
    `SELECT claim_json
     FROM canonical.claims
     WHERE project_id = $1
     ORDER BY claim_id`,
    [projectId],
  );
  return result.rows.map((row) => row.claim_json);
};

const readReadyProjection = async (
  client: PoolClient,
  projectId: string,
): Promise<CompiledTruthProjection | undefined> => {
  const result = await client.query<ProjectionRow>(
    `SELECT status, projection
     FROM projection.compiled_truth
     WHERE project_id = $1`,
    [projectId],
  );
  const row = result.rows[0];
  return row?.status === 'READY' && row.projection ? row.projection : undefined;
};

const canonicalFrom = (
  projectId: string,
  state: StateRow | undefined,
  claims: readonly CanonicalClaim[],
): CanonicalSnapshot => {
  const version = state?.version ?? 0;
  return {
    snapshotId: `canonical:${projectId}:${version}`,
    projectId,
    version,
    digest: state?.snapshot_digest ?? canonicalSnapshotDigest(projectId, 0, []),
    claims: claims.map((claim) => ({
      claimId: claim.claimId,
      text: claim.claimText,
      revisionNumber: claim.revisionNumber,
      evidenceIds: [...claim.evidenceIds],
    })),
    createdAt: state?.updated_at.toISOString() ?? '1970-01-01T00:00:00.000Z',
  };
};

export class PostgresSemanticCorpusSourceSnapshotReader implements SemanticCorpusSourceSnapshotReaderPort {
  constructor(private readonly pool: Pool) {}

  async readSnapshot(projectId: string): Promise<SemanticCorpusSourceSnapshot> {
    const client = await this.pool.connect();
    try {
      // All Canonical, approved Knowledge and READY projection reads share one
      // PostgreSQL MVCC snapshot. No independent pool reads can be combined into
      // semantic corpus authority.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const state = await readState(client, projectId);
      const claims = await readClaims(client, projectId);
      const approvedGroups = await readApprovedGroups(client, projectId);
      const projection = await readReadyProjection(client, projectId);
      await client.query('COMMIT');
      const canonical = canonicalFrom(projectId, state, claims);
      return buildSemanticCorpusSourceSnapshot({
        projectId,
        canonical,
        claims,
        approvedGroups,
        ...(projection === undefined
          ? {}
          : { compiledTruth: { status: 'READY' as const, projection } }),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readWatermark(projectId: string): Promise<SemanticCorpusSourceWatermark> {
    // The database returns one bounded group-metadata aggregate. It never loads
    // Canonical claim text or Knowledge item payloads into representations,
    // performs embeddings, or runs vector retrieval. Group content_digest is
    // the authoritative digest of the approved item payload, so this has the
    // same source identity as the full snapshot without rebuilding it.
    const result = await this.pool.query<WatermarkRow>(
      `WITH approved AS (
         SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'groupId', group_id,
               'sourceVersionId', source_version_id,
               'revisionNumber', revision_number,
               'status', 'APPROVED',
               'contentDigest', content_digest,
               'accessScope', access_scope,
               'sensitivity', sensitivity,
               'items', '[]'::jsonb
             )
             ORDER BY group_id
           ), '[]'::jsonb
         ) AS approved_groups
         FROM knowledge.review_groups
         WHERE project_id = $1 AND status = 'APPROVED'
       )
       SELECT state.version, state.snapshot_digest, approved.approved_groups
       FROM approved
       LEFT JOIN canonical.project_state AS state ON state.project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    const version = row?.version ?? 0;
    const canonicalDigest = row?.snapshot_digest ?? canonicalSnapshotDigest(projectId, 0, []);
    return semanticCorpusWatermarkFromSource({
      projectId,
      canonicalVersion: version,
      canonicalSnapshotDigest: canonicalDigest,
      approvedGroups: row?.approved_groups ?? [],
    });
  }
}
