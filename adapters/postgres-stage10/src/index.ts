import type { Pool } from 'pg';

import type {
  CompiledTruthProjection,
  DerivedInferenceCandidate,
} from '../../../packages/contracts/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';
import { COMPILED_TRUTH_PROJECTOR_VERSION } from '../../../modules/compiled-truth/src/index.js';

type ProjectionRow = {
  projection: CompiledTruthProjection | null;
  status: 'READY' | 'DEGRADED';
  last_error: string | null;
  updated_at: Date;
};

export class PostgresCompiledTruthRepository implements CompiledTruthRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async synchronize(projection: CompiledTruthProjection): Promise<CompiledTruthProjection> {
    const result = await this.pool.query<{ projection: CompiledTruthProjection }>(
      `INSERT INTO projection.compiled_truth (
         project_id, projector_version, source_snapshot_digest, logical_digest,
         canonical_version, build_mode, projection, status, last_error, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'READY', NULL, $8)
       ON CONFLICT (project_id) DO UPDATE SET
         projector_version = EXCLUDED.projector_version,
         source_snapshot_digest = EXCLUDED.source_snapshot_digest,
         logical_digest = EXCLUDED.logical_digest,
         canonical_version = EXCLUDED.canonical_version,
         build_mode = EXCLUDED.build_mode,
         projection = EXCLUDED.projection,
         status = 'READY',
         last_error = NULL,
         updated_at = EXCLUDED.updated_at
       RETURNING projection`,
      [
        projection.projectId,
        projection.projectorVersion,
        projection.sourceSnapshotDigest,
        projection.logicalDigest,
        projection.canonicalVersion,
        projection.buildMode,
        JSON.stringify(projection),
        projection.projectedAt,
      ],
    );
    return result.rows[0]!.projection;
  }

  async findProjection(projectId: string): Promise<CompiledTruthProjection | undefined> {
    const result = await this.pool.query<ProjectionRow>(
      `SELECT projection, status, last_error, updated_at
       FROM projection.compiled_truth WHERE project_id = $1`,
      [projectId],
    );
    return result.rows[0]?.projection ?? undefined;
  }

  async markDegraded(projectId: string, error: string, updatedAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO projection.compiled_truth (
         project_id, projector_version, canonical_version, status, last_error, updated_at
       ) VALUES ($1, $2, 0, 'DEGRADED', $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET
         status = 'DEGRADED', last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at`,
      [projectId, COMPILED_TRUTH_PROJECTOR_VERSION, error, updatedAt],
    );
  }

  async degradedState(
    projectId: string,
  ): Promise<{ error: string; updatedAt: string } | undefined> {
    const result = await this.pool.query<ProjectionRow>(
      `SELECT projection, status, last_error, updated_at
       FROM projection.compiled_truth WHERE project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    return row?.status === 'DEGRADED' && row.last_error
      ? { error: row.last_error, updatedAt: row.updated_at.toISOString() }
      : undefined;
  }

  async saveInferences(
    projectId: string,
    candidates: readonly DerivedInferenceCandidate[],
  ): Promise<{
    accepted: readonly DerivedInferenceCandidate[];
    suppressedFingerprints: readonly string[];
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const accepted: DerivedInferenceCandidate[] = [];
      const suppressedFingerprints: string[] = [];
      for (const candidate of candidates) {
        const result = await client.query(
          `INSERT INTO projection.discovery_inferences (
             project_id, fingerprint, candidate_id, candidate, created_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (project_id, fingerprint) DO NOTHING
           RETURNING fingerprint`,
          [
            projectId,
            candidate.fingerprint,
            candidate.candidateId,
            JSON.stringify(candidate),
            candidate.createdAt,
          ],
        );
        if (result.rowCount === 1) accepted.push(candidate);
        else suppressedFingerprints.push(candidate.fingerprint);
      }
      await client.query('COMMIT');
      return { accepted, suppressedFingerprints };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listInferences(projectId: string): Promise<readonly DerivedInferenceCandidate[]> {
    const result = await this.pool.query<{ candidate: DerivedInferenceCandidate }>(
      `SELECT candidate FROM projection.discovery_inferences
       WHERE project_id = $1 ORDER BY candidate_id`,
      [projectId],
    );
    return result.rows.map((row) => row.candidate);
  }
}
