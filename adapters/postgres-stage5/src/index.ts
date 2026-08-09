import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { ComparisonRepositoryPort } from '../../../modules/comparison/src/index.js';
import type {
  ChangeSetReviewRepositoryPort,
  ReviewDecisionWrite,
} from '../../../modules/change-set-review/src/index.js';
import {
  type ApprovedChangeSetManifest,
  type ComparisonResult,
  type DraftChangeSet,
  type ReversalDraftChangeSetV1,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

type ComparisonRow = QueryResultRow & {
  readonly result_json: ComparisonResult;
};

type ChangeSetRow = QueryResultRow & {
  readonly change_set_json: DraftChangeSet;
  readonly manifest_json: ApprovedChangeSetManifest | null;
};

type DecisionRow = QueryResultRow & {
  readonly decision_json: ReviewDecisionWrite['decision'];
  readonly change_set_json?: DraftChangeSet;
  readonly manifest_json?: ApprovedChangeSetManifest | null;
};

type ReversalRow = QueryResultRow & {
  readonly reversal_json: ReversalDraftChangeSetV1;
};

const comparisonSelect = `
  SELECT result_json
  FROM comparison.results
`;

const changeSetSelect = `
  SELECT change_set_json, manifest_json
  FROM review.change_sets
`;

const loadChangeSetForUpdate = async (
  client: PoolClient,
  projectId: string,
  changeSetId: string,
): Promise<ChangeSetRow | undefined> => {
  const result = await client.query<ChangeSetRow>(
    `${changeSetSelect} WHERE project_id = $1 AND change_set_id = $2 FOR UPDATE`,
    [projectId, changeSetId],
  );
  return result.rows[0];
};

export class PostgresComparisonRepository implements ComparisonRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(result: ComparisonResult): Promise<ComparisonResult> {
    const inserted = await this.pool.query<ComparisonRow>(
      `
        INSERT INTO comparison.results (
          comparison_id, project_id, source_version_id, candidate_id,
          snapshot_id, snapshot_version, snapshot_digest, classification,
          candidate_digest, diff_digest, result_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (project_id, candidate_id, snapshot_digest) DO NOTHING
        RETURNING result_json
      `,
      [
        result.comparisonId,
        result.projectId,
        result.sourceVersionId,
        result.candidateId,
        result.snapshotId,
        result.snapshotVersion,
        result.snapshotDigest,
        result.classification,
        result.candidateDigest,
        result.diffDigest,
        JSON.stringify(result),
        result.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return inserted.rows[0].result_json;
    }
    const existing = await this.findByCandidateAndSnapshot(
      result.projectId,
      result.candidateId,
      result.snapshotDigest,
    );
    if (!existing) {
      throw new Error('Comparison Result was not stored.');
    }
    if (
      stableJson({ ...existing, comparisonId: undefined }) !==
      stableJson({ ...result, comparisonId: undefined })
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The same Candidate and Snapshot produced a different comparison.',
        module: 'postgres-stage5',
        operation: 'save-comparison',
      });
    }
    return existing;
  }

  async findById(projectId: string, comparisonId: string): Promise<ComparisonResult | undefined> {
    const result = await this.pool.query<ComparisonRow>(
      `${comparisonSelect} WHERE project_id = $1 AND comparison_id = $2`,
      [projectId, comparisonId],
    );
    return result.rows[0]?.result_json;
  }

  async findByCandidateAndSnapshot(
    projectId: string,
    candidateId: string,
    snapshotDigest: string,
  ): Promise<ComparisonResult | undefined> {
    const result = await this.pool.query<ComparisonRow>(
      `${comparisonSelect}
       WHERE project_id = $1 AND candidate_id = $2 AND snapshot_digest = $3`,
      [projectId, candidateId, snapshotDigest],
    );
    return result.rows[0]?.result_json;
  }
}

export class PostgresChangeSetReviewRepository implements ChangeSetReviewRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(changeSet: DraftChangeSet): Promise<DraftChangeSet> {
    const inserted = await this.pool.query<ChangeSetRow>(
      `
        INSERT INTO review.change_sets (
          change_set_id, project_id, source_version_id, candidate_id, comparison_id,
          revision_number, status, content_digest, expected_canonical_version,
          snapshot_digest, change_set_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (project_id, comparison_id) DO NOTHING
        RETURNING change_set_json, manifest_json
      `,
      [
        changeSet.changeSetId,
        changeSet.projectId,
        changeSet.sourceVersionId,
        changeSet.candidateId,
        changeSet.comparisonId,
        changeSet.revisionNumber,
        changeSet.status,
        changeSet.contentDigest,
        changeSet.expectedCanonicalVersion,
        changeSet.snapshotDigest,
        JSON.stringify(changeSet),
        changeSet.createdAt,
        changeSet.updatedAt,
      ],
    );
    if (inserted.rows[0]) {
      return inserted.rows[0].change_set_json;
    }
    const existing = await this.findByComparisonId(changeSet.projectId, changeSet.comparisonId);
    if (!existing) {
      throw new Error('Draft Change Set was not stored.');
    }
    if (
      stableJson({ ...existing, changeSetId: undefined }) !==
      stableJson({ ...changeSet, changeSetId: undefined })
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The same Comparison produced a different Draft Change Set.',
        module: 'postgres-stage5',
        operation: 'save-draft-change-set',
      });
    }
    return existing;
  }

  async findById(projectId: string, changeSetId: string): Promise<DraftChangeSet | undefined> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect} WHERE project_id = $1 AND change_set_id = $2`,
      [projectId, changeSetId],
    );
    return result.rows[0]?.change_set_json;
  }

  async findByComparisonId(
    projectId: string,
    comparisonId: string,
  ): Promise<DraftChangeSet | undefined> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect} WHERE project_id = $1 AND comparison_id = $2`,
      [projectId, comparisonId],
    );
    return result.rows[0]?.change_set_json;
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly DraftChangeSet[]> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect}
       WHERE project_id = $1 AND source_version_id = $2
       ORDER BY created_at, change_set_id`,
      [projectId, sourceVersionId],
    );
    return result.rows.map((row) => row.change_set_json);
  }

  async findDecision(
    projectId: string,
    decisionId: string,
  ): Promise<
    | {
        readonly changeSet: DraftChangeSet;
        readonly decision: ReviewDecisionWrite['decision'];
        readonly manifest?: ApprovedChangeSetManifest;
      }
    | undefined
  > {
    const result = await this.pool.query<DecisionRow>(
      `
        SELECT d.decision_json, c.change_set_json, c.manifest_json
        FROM review.decisions d
        JOIN review.change_sets c ON c.change_set_id = d.change_set_id
        WHERE d.project_id = $1 AND d.decision_id = $2
      `,
      [projectId, decisionId],
    );
    const row = result.rows[0];
    if (!row?.change_set_json) {
      return undefined;
    }
    return {
      changeSet: row.change_set_json,
      decision: row.decision_json,
      manifest: row.manifest_json ?? undefined,
    };
  }

  async recordDecision(write: ReviewDecisionWrite): Promise<{
    readonly changeSet: DraftChangeSet;
    readonly manifest?: ApprovedChangeSetManifest;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await loadChangeSetForUpdate(client, write.projectId, write.changeSetId);
      if (!row) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The Draft Change Set was not found.',
          module: 'postgres-stage5',
          operation: 'record-review-decision',
        });
      }
      const existingDecision = await client.query<DecisionRow>(
        'SELECT decision_json FROM review.decisions WHERE decision_id = $1',
        [write.decision.decisionId],
      );
      if (existingDecision.rows[0]) {
        if (stableJson(existingDecision.rows[0].decision_json) !== stableJson(write.decision)) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'The review decision id was reused with different content.',
            module: 'postgres-stage5',
            operation: 'record-review-decision',
          });
        }
        await client.query('COMMIT');
        return {
          changeSet: row.change_set_json,
          manifest: row.manifest_json ?? undefined,
        };
      }
      const current = row.change_set_json;
      if (
        current.revisionNumber !== write.expectedRevisionNumber ||
        current.contentDigest !== write.expectedContentDigest
      ) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The Draft Change Set changed before the decision was stored.',
          module: 'postgres-stage5',
          operation: 'record-review-decision',
        });
      }
      if (['APPROVED', 'REJECTED', 'STALE'].includes(current.status)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Draft Change Set already has a final status.',
          module: 'postgres-stage5',
          operation: 'record-review-decision',
        });
      }
      await client.query(
        `
          INSERT INTO review.decisions (
            decision_id, project_id, change_set_id, decision, actor_type,
            actor_id, reason, content_digest, decision_json, decided_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          write.decision.decisionId,
          write.projectId,
          write.changeSetId,
          write.decision.decision,
          write.decision.actor.type,
          write.decision.actor.id,
          write.decision.reason,
          write.decision.contentDigest,
          JSON.stringify(write.decision),
          write.decision.decidedAt,
        ],
      );
      await client.query(
        `
          UPDATE review.change_sets
          SET status = $3,
              change_set_json = $4,
              manifest_json = $5,
              updated_at = $6
          WHERE project_id = $1 AND change_set_id = $2
        `,
        [
          write.projectId,
          write.changeSetId,
          write.updated.status,
          JSON.stringify(write.updated),
          write.manifest ? JSON.stringify(write.manifest) : null,
          write.updated.updatedAt,
        ],
      );
      await client.query('COMMIT');
      return { changeSet: write.updated, manifest: write.manifest };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markStale(
    projectId: string,
    changeSetId: string,
    expectedContentDigest: string,
    updatedAt: string,
  ): Promise<DraftChangeSet> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await loadChangeSetForUpdate(client, projectId, changeSetId);
      if (!row) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The Draft Change Set was not found.',
          module: 'postgres-stage5',
          operation: 'mark-change-set-stale',
        });
      }
      const current = row.change_set_json;
      if (current.contentDigest !== expectedContentDigest) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The Draft Change Set changed before it could be marked stale.',
          module: 'postgres-stage5',
          operation: 'mark-change-set-stale',
        });
      }
      if (current.status === 'STALE') {
        await client.query('COMMIT');
        return current;
      }
      if (['APPROVED', 'REJECTED'].includes(current.status)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'A final Draft Change Set cannot be marked stale.',
          module: 'postgres-stage5',
          operation: 'mark-change-set-stale',
        });
      }
      const stale = { ...current, status: 'STALE' as const, updatedAt };
      await client.query(
        `
          UPDATE review.change_sets
          SET status = 'STALE', change_set_json = $3, updated_at = $4
          WHERE project_id = $1 AND change_set_id = $2
        `,
        [projectId, changeSetId, JSON.stringify(stale), updatedAt],
      );
      await client.query('COMMIT');
      return stale;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findApprovedManifest(
    projectId: string,
    changeSetId: string,
  ): Promise<ApprovedChangeSetManifest | undefined> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect} WHERE project_id = $1 AND change_set_id = $2`,
      [projectId, changeSetId],
    );
    return result.rows[0]?.manifest_json ?? undefined;
  }

  // FE-P5-S2 WP5 (Round 4 Option 1): owning-Domain Reversal durable authority
  // (additive `review.reversals` record set, migration 033).
  async saveReversal(reversal: ReversalDraftChangeSetV1): Promise<ReversalDraftChangeSetV1> {
    const inserted = await this.pool.query<ReversalRow>(
      `
        INSERT INTO review.reversals (reversal_id, project_id, reversal_json, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (reversal_id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          reversal_json = EXCLUDED.reversal_json,
          created_at = EXCLUDED.created_at
        RETURNING reversal_json
      `,
      [
        reversal.reversalId,
        reversal.resourceProjectId,
        JSON.stringify(reversal),
        reversal.createdAt,
      ],
    );
    return inserted.rows[0]?.reversal_json ?? reversal;
  }

  async findReversalById(
    projectId: string,
    reversalId: string,
  ): Promise<ReversalDraftChangeSetV1 | undefined> {
    const result = await this.pool.query<ReversalRow>(
      `
        SELECT reversal_json
        FROM review.reversals
        WHERE project_id = $1 AND reversal_id = $2
      `,
      [projectId, reversalId],
    );
    return result.rows[0]?.reversal_json;
  }

  async listReversals(projectId: string): Promise<readonly ReversalDraftChangeSetV1[]> {
    const result = await this.pool.query<ReversalRow>(
      `
        SELECT reversal_json
        FROM review.reversals
        WHERE project_id = $1
        ORDER BY created_at, reversal_id
      `,
      [projectId],
    );
    return result.rows.map((row) => row.reversal_json);
  }
}
