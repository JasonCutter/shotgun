import type { Pool } from 'pg';

import { FrontendContractError, stableJson } from '../../../packages/contracts/src/index.js';
import type {
  GraphSnapshotContextDescriptorV1,
  SnapshotContextStorePort,
} from '../../../modules/frontend-knowledge-graph/src/index.js';
import type {
  GraphContinuationRecordV1,
  GraphOverlayHealthRecordV1,
  GraphProjectionHealthRecordV1,
  HealthStorePort,
} from '../../../modules/frontend-knowledge-graph/src/index.js';

const JSONB = (value: unknown): string => JSON.stringify(value);
const PARSE = (value: unknown): unknown => {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

export class PostgresFrontendKnowledgeGraphStores implements SnapshotContextStorePort, HealthStorePort {
  constructor(private readonly pool: Pool) {}

  async write(context: GraphSnapshotContextDescriptorV1): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO frontend_knowledge_graph.snapshot_context (
          snapshot_id, project_id, view_kind, overlay_kinds, root_refs,
          normalized_filters, filters_digest, limits, access_revision,
          policy_context_revision, projection_revision, generated_at, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          context.snapshotId,
          context.projectId,
          context.viewKind,
          JSONB(context.overlayKinds),
          JSONB(context.rootRefs),
          JSONB(context.normalizedFilters),
          context.filtersDigest,
          JSONB(context.limits),
          context.accessRevision,
          context.policyContextRevision,
          context.projectionRevision,
          context.generatedAt,
          context.expiresAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new FrontendContractError('CONFLICT', `snapshot context ${context.snapshotId} already exists`);
      }
      throw error;
    }
  }

  async resolve(
    projectId: string,
    snapshotId: string,
  ): Promise<GraphSnapshotContextDescriptorV1 | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT snapshot_id, project_id, view_kind, overlay_kinds, root_refs,
              normalized_filters, filters_digest, limits, access_revision,
              policy_context_revision, projection_revision, generated_at, expires_at
       FROM frontend_knowledge_graph.snapshot_context
       WHERE snapshot_id = $1 AND project_id = $2`,
      [snapshotId, projectId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      snapshotId: row['snapshot_id'] as string,
      projectId: row['project_id'] as string,
      viewKind: row['view_kind'] as GraphSnapshotContextDescriptorV1['viewKind'],
      overlayKinds: PARSE(row['overlay_kinds']) as readonly GraphSnapshotContextDescriptorV1['overlayKinds'][number][],
      rootRefs: PARSE(row['root_refs']) as GraphSnapshotContextDescriptorV1['rootRefs'],
      normalizedFilters: PARSE(row['normalized_filters']) as GraphSnapshotContextDescriptorV1['normalizedFilters'],
      filtersDigest: row['filters_digest'] as string,
      limits: PARSE(row['limits']) as GraphSnapshotContextDescriptorV1['limits'],
      accessRevision: row['access_revision'] as string,
      policyContextRevision: row['policy_context_revision'] as string,
      projectionRevision: row['projection_revision'] as string,
      generatedAt: (row['generated_at'] as Date).toISOString(),
      expiresAt: (row['expires_at'] as Date).toISOString(),
    };
  }

  async pruneExpired(nowIso: string): Promise<void> {
    await this.pool.query(`SELECT frontend_knowledge_graph.prune_expired($1)`, [nowIso]);
  }

  async upsertProjectionHealth(record: GraphProjectionHealthRecordV1): Promise<void> {
    await this.pool.query(
      `INSERT INTO frontend_knowledge_graph.projection_health (
        project_id, view_kind, projection_revision, status, generated_at, lag,
        rebuild_state, access_revision, policy_context_revision
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (project_id, view_kind) DO UPDATE SET
        projection_revision = EXCLUDED.projection_revision,
        status = EXCLUDED.status,
        generated_at = EXCLUDED.generated_at,
        lag = EXCLUDED.lag,
        rebuild_state = EXCLUDED.rebuild_state,
        access_revision = EXCLUDED.access_revision,
        policy_context_revision = EXCLUDED.policy_context_revision`,
      [
        record.projectId,
        record.viewKind,
        record.projectionRevision,
        record.status,
        record.generatedAt,
        record.lag,
        record.rebuildState,
        record.accessRevision,
        record.policyContextRevision,
      ],
    );
  }

  async getProjectionHealth(
    projectId: string,
    viewKind: GraphProjectionHealthRecordV1['viewKind'],
  ): Promise<GraphProjectionHealthRecordV1 | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT project_id, view_kind, projection_revision, status, generated_at, lag,
              rebuild_state, access_revision, policy_context_revision
       FROM frontend_knowledge_graph.projection_health
       WHERE project_id = $1 AND view_kind = $2`,
      [projectId, viewKind],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      projectId: row['project_id'] as string,
      viewKind: row['view_kind'] as GraphProjectionHealthRecordV1['viewKind'],
      projectionRevision: row['projection_revision'] as string,
      status: row['status'] as GraphProjectionHealthRecordV1['status'],
      generatedAt: (row['generated_at'] as Date).toISOString(),
      lag: row['lag'] as number,
      rebuildState: row['rebuild_state'] as GraphProjectionHealthRecordV1['rebuildState'],
      accessRevision: row['access_revision'] as string,
      policyContextRevision: row['policy_context_revision'] as string,
    };
  }

  async upsertOverlayHealth(record: GraphOverlayHealthRecordV1): Promise<void> {
    await this.pool.query(
      `INSERT INTO frontend_knowledge_graph.overlay_health (
        project_id, base_snapshot_id, overlay_kind, overlay_snapshot_id,
        overlay_revision, analyzer_revision, policy_context_revision,
        generated_at, completeness, truncation, unavailable_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (project_id, base_snapshot_id, overlay_kind) DO UPDATE SET
        overlay_snapshot_id = EXCLUDED.overlay_snapshot_id,
        overlay_revision = EXCLUDED.overlay_revision,
        analyzer_revision = EXCLUDED.analyzer_revision,
        policy_context_revision = EXCLUDED.policy_context_revision,
        generated_at = EXCLUDED.generated_at,
        completeness = EXCLUDED.completeness,
        truncation = EXCLUDED.truncation,
        unavailable_reason = EXCLUDED.unavailable_reason`,
      [
        record.projectId,
        record.baseSnapshotId,
        record.overlayKind,
        record.overlaySnapshotId,
        record.overlayRevision,
        record.analyzerRevision,
        record.policyContextRevision,
        record.generatedAt,
        record.completeness,
        record.truncation === undefined ? null : JSONB(record.truncation),
        record.unavailableReason ?? null,
      ],
    );
  }

  async getOverlayHealth(
    projectId: string,
    baseSnapshotId: string,
    overlayKind: GraphOverlayHealthRecordV1['overlayKind'],
  ): Promise<GraphOverlayHealthRecordV1 | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT project_id, base_snapshot_id, overlay_kind, overlay_snapshot_id,
              overlay_revision, analyzer_revision, policy_context_revision,
              generated_at, completeness, truncation, unavailable_reason
       FROM frontend_knowledge_graph.overlay_health
       WHERE project_id = $1 AND base_snapshot_id = $2 AND overlay_kind = $3`,
      [projectId, baseSnapshotId, overlayKind],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      projectId: row['project_id'] as string,
      baseSnapshotId: row['base_snapshot_id'] as string,
      overlayKind: row['overlay_kind'] as GraphOverlayHealthRecordV1['overlayKind'],
      overlaySnapshotId: row['overlay_snapshot_id'] as string,
      overlayRevision: row['overlay_revision'] as string,
      analyzerRevision: row['analyzer_revision'] as string,
      policyContextRevision: row['policy_context_revision'] as string,
      generatedAt: (row['generated_at'] as Date).toISOString(),
      completeness: row['completeness'] as GraphOverlayHealthRecordV1['completeness'],
      truncation:
        row['truncation'] === null ? undefined : (PARSE(row['truncation']) as GraphOverlayHealthRecordV1['truncation']),
      unavailableReason: (row['unavailable_reason'] as GraphOverlayHealthRecordV1['unavailableReason'] | null) ?? undefined,
    };
  }

  async writeContinuation(record: GraphContinuationRecordV1): Promise<void> {
    await this.pool.query(
      `INSERT INTO frontend_knowledge_graph.continuation (
        token, expires_at, principal_id, session_id, project_id,
        access_revision, policy_context_revision, snapshot_id, root_ref,
        filters_digest, view_kind, overlay_kinds, limits
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        record.token,
        record.expiresAt,
        record.principalId,
        record.sessionId,
        record.projectId,
        record.accessRevision,
        record.policyContextRevision,
        record.snapshotId,
        record.rootRef === undefined ? null : JSONB(record.rootRef),
        record.filtersDigest,
        record.viewKind,
        JSONB(record.overlayKinds),
        JSONB(record.limits),
      ],
    );
  }

  async findContinuation(token: string): Promise<GraphContinuationRecordV1 | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT token, expires_at, principal_id, session_id, project_id,
              access_revision, policy_context_revision, snapshot_id, root_ref,
              filters_digest, view_kind, overlay_kinds, limits
       FROM frontend_knowledge_graph.continuation WHERE token = $1`,
      [token],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      token: row['token'] as string,
      expiresAt: (row['expires_at'] as Date).toISOString(),
      principalId: row['principal_id'] as string,
      sessionId: row['session_id'] as string,
      projectId: row['project_id'] as string,
      accessRevision: row['access_revision'] as string,
      policyContextRevision: row['policy_context_revision'] as string,
      snapshotId: row['snapshot_id'] as string,
      rootRef: row['root_ref'] === null ? undefined : PARSE(row['root_ref']),
      filtersDigest: row['filters_digest'] as string,
      viewKind: row['view_kind'] as GraphContinuationRecordV1['viewKind'],
      overlayKinds: PARSE(row['overlay_kinds']) as readonly GraphContinuationRecordV1['overlayKinds'][number][],
      limits: PARSE(row['limits']) as GraphContinuationRecordV1['limits'],
    };
  }

  async deleteContinuation(token: string): Promise<void> {
    await this.pool.query(`DELETE FROM frontend_knowledge_graph.continuation WHERE token = $1`, [token]);
  }
}

export { stableJson };
