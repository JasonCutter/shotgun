import type { Pool, QueryResultRow } from 'pg';

import type {
  CompiledTruthProjection,
  DerivedInferenceCandidate,
} from '../../../packages/contracts/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';
import { COMPILED_TRUTH_PROJECTOR_VERSION } from '../../../modules/compiled-truth/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

type ProjectionRow = QueryResultRow & {
  project_id: string;
  projector_version: string;
  source_snapshot_digest: string | null;
  logical_digest: string | null;
  canonical_version: number;
  build_mode: CompiledTruthProjection['buildMode'] | null;
  projection: CompiledTruthProjection | null;
  status: 'READY' | 'DEGRADED';
  last_error: string | null;
  updated_at: Date;
};

type InferenceRow = QueryResultRow & {
  project_id: string;
  fingerprint: string;
  candidate_id: string;
  candidate: DerivedInferenceCandidate;
  created_at: Date;
};

type InferenceSaveResult = {
  accepted: readonly DerivedInferenceCandidate[];
  suppressedFingerprints: readonly string[];
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
};

const timestampEquals = (left: Date | string, right: string): boolean => {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return !Number.isNaN(leftDate.valueOf()) && leftDate.toISOString() === rightDate.toISOString();
};

const isOutcomeUnknown = (error: unknown): error is ShotgunError =>
  error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';

const matchesProjection = (row: ProjectionRow, expected: CompiledTruthProjection): boolean =>
  row.project_id === expected.projectId &&
  row.projector_version === expected.projectorVersion &&
  row.source_snapshot_digest === expected.sourceSnapshotDigest &&
  row.logical_digest === expected.logicalDigest &&
  row.canonical_version === expected.canonicalVersion &&
  row.build_mode === expected.buildMode &&
  row.status === 'READY' &&
  row.last_error === null &&
  row.projection !== null &&
  canonicalJson(row.projection) === canonicalJson(expected) &&
  timestampEquals(row.updated_at, expected.projectedAt);

const matchesInference = (
  row: InferenceRow,
  projectId: string,
  expected: DerivedInferenceCandidate,
): boolean =>
  row.project_id === projectId &&
  row.fingerprint === expected.fingerprint &&
  row.candidate_id === expected.candidateId &&
  canonicalJson(row.candidate) === canonicalJson(expected) &&
  timestampEquals(row.created_at, expected.createdAt);

export class PostgresCompiledTruthRepository implements CompiledTruthRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async synchronize(projection: CompiledTruthProjection): Promise<CompiledTruthProjection> {
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const result = await client.query<{ projection: CompiledTruthProjection }>(
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
          const persisted = result.rows[0]?.projection;
          if (persisted === undefined) {
            throw new Error('Compiled Truth synchronize did not return a projection.');
          }
          return persisted;
        },
        {
          module: 'postgres-stage10',
          operation: 'synchronize-compiled-truth',
        },
      );
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        const persisted = await this.findProjectionRow(projection.projectId).catch(() => undefined);
        if (persisted && matchesProjection(persisted, projection)) {
          return persisted.projection!;
        }
      }
      throw error;
    }
  }

  async findProjection(projectId: string): Promise<CompiledTruthProjection | undefined> {
    return (await this.findProjectionRow(projectId))?.projection ?? undefined;
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
    const row = await this.findProjectionRow(projectId);
    return row?.status === 'DEGRADED' && row.last_error
      ? { error: row.last_error, updatedAt: row.updated_at.toISOString() }
      : undefined;
  }

  async saveInferences(
    projectId: string,
    candidates: readonly DerivedInferenceCandidate[],
  ): Promise<InferenceSaveResult> {
    let observed: InferenceSaveResult | undefined;
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (client) => {
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
          observed = { accepted, suppressedFingerprints };
          return observed;
        },
        {
          module: 'postgres-stage10',
          operation: 'save-discovery-inferences',
        },
      );
    } catch (error) {
      if (isOutcomeUnknown(error) && observed) {
        if (
          observed.accepted.length === 0 &&
          observed.suppressedFingerprints.length === candidates.length
        ) {
          return observed;
        }
        if (observed.accepted.length > 0) {
          const persisted = await this.readInferenceRows(
            projectId,
            observed.accepted.map((candidate) => candidate.fingerprint),
          ).catch(() => undefined);
          if (
            persisted &&
            observed.accepted.every((candidate) => {
              const row = persisted.get(candidate.fingerprint);
              return row !== undefined && matchesInference(row, projectId, candidate);
            })
          ) {
            return observed;
          }
        }
      }
      throw error;
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

  private async findProjectionRow(projectId: string): Promise<ProjectionRow | undefined> {
    const result = await this.pool.query<ProjectionRow>(
      `SELECT project_id, projector_version, source_snapshot_digest, logical_digest,
              canonical_version, build_mode, projection, status, last_error, updated_at
       FROM projection.compiled_truth WHERE project_id = $1`,
      [projectId],
    );
    return result.rows[0];
  }

  private async readInferenceRows(
    projectId: string,
    fingerprints: readonly string[],
  ): Promise<Map<string, InferenceRow>> {
    const result = await this.pool.query<InferenceRow>(
      `SELECT project_id, fingerprint, candidate_id, candidate, created_at
       FROM projection.discovery_inferences
       WHERE project_id = $1 AND fingerprint = ANY($2::text[])`,
      [projectId, fingerprints],
    );
    return new Map(result.rows.map((row) => [row.fingerprint, row]));
  }
}
