import type { Pool, QueryResultRow } from 'pg';

import type {
  IntakeSubmissionSnapshot,
  SourcesSensitivity,
} from '../../../packages/contracts/src/index.js';
import {
  decodeSourcesActivityAttemptCursor,
  decodeSourcesActivityCursor,
  encodeSourcesActivityAttemptCursor,
  encodeSourcesActivityCursor,
  type SourcesActivityAttemptRow,
  type SourcesActivityReadPort,
  type SourcesActivitySubmissionRow,
} from '../../../modules/frontend-activity/src/index.js';
import type { SourcesProductWriteScope } from '../../../modules/frontend-sources-write/src/product-service.js';

/**
 * FE-P5-S1 WP3 — PostgreSQL `SourcesActivityReadPort`.
 *
 * Reads the Sources Domain's `source_product` tables directly (submission
 * queue + intake attempts) and delegates the authoritative submission snapshot
 * to the existing Sources product service so the Activity read never duplicates
 * the Domain's read reconstruction. Reads are project- and principal-scoped.
 */

type SubmissionRow = QueryResultRow & {
  readonly submission_id: string;
  readonly project_id: string;
  readonly principal_id: string;
  readonly state: SourcesActivitySubmissionRow['state'];
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly completed_at: Date | null;
  readonly item_count: string;
  readonly attention_reason: string | null;
};

type AttemptRow = QueryResultRow & {
  readonly intake_attempt_id: string;
  readonly project_id: string;
  readonly submission_id: string;
  readonly submission_item_id: string;
  readonly attempt_number: string;
  readonly attempt_kind: string;
  readonly state: string;
  readonly correlation_id: string;
  readonly causation_attempt_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly completed_at: Date | null;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Sensitivity dominance ordering (higher rank = more restricted). */
const SENSITIVITY_RANK: Readonly<Record<string, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

export class PostgresSourcesActivityRead implements SourcesActivityReadPort {
  constructor(
    private readonly pool: Pool,
    private readonly productService: {
      getSubmission(
        scope: SourcesProductWriteScope,
        submissionId: string,
      ): Promise<IntakeSubmissionSnapshot | undefined>;
    },
  ) {}

  async listSubmissions(input: {
    readonly projectId: string;
    readonly principalId?: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly rows: readonly SourcesActivitySubmissionRow[];
    readonly nextCursor?: string;
  }> {
    const params: unknown[] = [input.projectId];
    const conditions = ['s.project_id = $1'];
    if (input.principalId !== undefined) {
      params.push(input.principalId);
      conditions.push(`s.principal_id::text = $${params.length}`);
    }
    if (input.cursor !== undefined) {
      const cursor = decodeSourcesActivityCursor(input.cursor);
      params.push(cursor.updatedAt, cursor.submissionId);
      const updatedParam = params.length - 1;
      const idParam = params.length;
      conditions.push(
        `(s.updated_at < $${updatedParam}
          OR (s.updated_at = $${updatedParam} AND s.submission_id::text > $${idParam}))`,
      );
    }
    params.push(input.limit);
    const result = await this.pool.query<SubmissionRow>(
      `SELECT s.submission_id::text AS submission_id, s.project_id,
              s.principal_id::text AS principal_id, s.state, s.created_at, s.updated_at,
              s.completed_at,
              (SELECT count(*)::text FROM source_product.intake_submission_items i
                WHERE i.project_id = s.project_id AND i.submission_id = s.submission_id) AS item_count,
              (SELECT i2.attention_reason FROM source_product.intake_submission_items i2
                WHERE i2.project_id = s.project_id AND i2.submission_id = s.submission_id
                  AND i2.attention_reason IS NOT NULL
                ORDER BY i2.ordinal LIMIT 1) AS attention_reason
       FROM source_product.intake_submissions s
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.updated_at DESC, s.submission_id ASC
       LIMIT $${params.length}`,
      params,
    );
    const rows = result.rows.map<SourcesActivitySubmissionRow>((row) => ({
      submissionId: row.submission_id,
      projectId: row.project_id,
      principalId: row.principal_id,
      state: row.state,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
      itemCount: Number(row.item_count),
      ...(row.attention_reason === null || row.attention_reason === undefined
        ? {}
        : { attentionReason: row.attention_reason }),
    }));
    const last = rows[rows.length - 1];
    return {
      rows,
      ...(rows.length >= input.limit && last !== undefined
        ? {
            nextCursor: encodeSourcesActivityCursor({
              updatedAt: last.updatedAt,
              submissionId: last.submissionId,
            }),
          }
        : {}),
    };
  }

  async getSubmission(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly principalId?: string;
    readonly accessScope?: readonly string[];
    readonly sensitivity?: string;
    readonly accessRevision?: string;
    readonly policyContextRevision?: string;
  }): Promise<IntakeSubmissionSnapshot | undefined> {
    // The owning Domain's authoritative read boundary revalidates access with
    // the server-derived binding (never browser-authored): principal, access
    // scopes, sensitivity and the current access/policy revisions are passed
    // through instead of synthetic values.
    const scope: SourcesProductWriteScope = {
      principalId: input.principalId ?? 'activity-read',
      sessionId: 'activity-read',
      projectId: input.projectId,
      accessScopes: input.accessScope ?? [],
      sensitivity: (input.sensitivity as SourcesSensitivity) ?? 'internal',
      accessRevision: input.accessRevision ?? 'activity-read',
      policyContextRevision: input.policyContextRevision ?? 'activity-read',
      acceptedPolicyContextId: 'activity-read',
      acceptedPolicyBinding: {},
    };
    const snapshot = await this.productService.getSubmission(scope, input.submissionId);
    if (snapshot === undefined) return undefined;
    // Own-Domain Activity revalidation (R4-2): the Activity read treats a
    // submission as non-readable when its recorded access/policy revisions no
    // longer match the current binding (stale) or when the scope's sensitivity
    // clearance does not dominate the materialized content — the same
    // non-disclosing NOT_FOUND as a missing or cross-principal resource. The
    // Sources product read keeps its own stale-marking semantics; the Activity
    // surface never returns a stale row as CURRENT.
    if (input.accessRevision !== undefined && snapshot.accessRevision !== input.accessRevision) {
      return undefined;
    }
    if (
      input.policyContextRevision !== undefined &&
      snapshot.policyContextRevision !== input.policyContextRevision
    ) {
      return undefined;
    }
    if (
      input.sensitivity !== undefined &&
      (SENSITIVITY_RANK[await this.effectiveSensitivity(input.projectId, input.submissionId)] ??
        0) > (SENSITIVITY_RANK[input.sensitivity] ?? -1)
    ) {
      return undefined;
    }
    return snapshot;
  }

  /**
   * Most restrictive sensitivity among the submission's materialized content
   * (its stage2 items' recorded sensitivity); `public` when nothing has been
   * materialized yet. The intake submission itself carries no independent
   * classification column, so the materialized item sensitivity is the
   * authoritative bound for the Activity sensitivity revalidation.
   */
  private async effectiveSensitivity(projectId: string, submissionId: string): Promise<string> {
    const result = await this.pool.query<{ sensitivity: string }>(
      `SELECT s.sensitivity
       FROM intake.submissions s
       JOIN source_product.intake_submission_items i
         ON i.project_id = s.project_id AND i.stage2_submission_id = s.submission_id
       WHERE s.project_id = $1 AND i.submission_id = $2`,
      [projectId, submissionId],
    );
    let effective: string = 'public';
    for (const row of result.rows) {
      const rank = SENSITIVITY_RANK[row.sensitivity] ?? 0;
      if (rank > (SENSITIVITY_RANK[effective] ?? 0)) effective = row.sensitivity;
    }
    return effective;
  }

  async listItemAttempts(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly submissionItemId: string;
    readonly limit: number;
  }): Promise<readonly SourcesActivityAttemptRow[]> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT intake_attempt_id::text, project_id, submission_id::text,
              submission_item_id::text, attempt_number::text, attempt_kind, state,
              correlation_id, causation_attempt_id::text, created_at, updated_at, completed_at
       FROM source_product.intake_attempts
       WHERE project_id = $1 AND submission_id = $2 AND submission_item_id = $3
       ORDER BY attempt_number ASC
       LIMIT $4`,
      [input.projectId, input.submissionId, input.submissionItemId, input.limit],
    );
    return result.rows.map<SourcesActivityAttemptRow>((row) => ({
      intakeAttemptId: row.intake_attempt_id,
      projectId: row.project_id,
      submissionId: row.submission_id,
      submissionItemId: row.submission_item_id,
      attemptNumber: Number(row.attempt_number),
      attemptKind: row.attempt_kind,
      state: row.state,
      correlationId: row.correlation_id,
      ...(row.causation_attempt_id === null
        ? {}
        : { causationAttemptId: row.causation_attempt_id }),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    }));
  }

  async listSubmissionAttempts(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly attempts: readonly SourcesActivityAttemptRow[];
    readonly nextCursor?: string;
  }> {
    const offset =
      input.cursor === undefined ? 0 : decodeSourcesActivityAttemptCursor(input.cursor).offset;
    const result = await this.pool.query<AttemptRow>(
      `SELECT a.intake_attempt_id::text, a.project_id, a.submission_id::text,
              a.submission_item_id::text, a.attempt_number::text, a.attempt_kind, a.state,
              a.correlation_id, a.causation_attempt_id::text, a.created_at, a.updated_at, a.completed_at
       FROM source_product.intake_attempts a
       JOIN source_product.intake_submission_items i
         ON i.project_id = a.project_id AND i.submission_id = a.submission_id
        AND i.submission_item_id = a.submission_item_id
       WHERE a.project_id = $1 AND a.submission_id = $2
       ORDER BY i.ordinal ASC, a.attempt_number ASC
       LIMIT $3 OFFSET $4`,
      [input.projectId, input.submissionId, input.limit, offset],
    );
    const attempts = result.rows.map<SourcesActivityAttemptRow>((row) => ({
      intakeAttemptId: row.intake_attempt_id,
      projectId: row.project_id,
      submissionId: row.submission_id,
      submissionItemId: row.submission_item_id,
      attemptNumber: Number(row.attempt_number),
      attemptKind: row.attempt_kind,
      state: row.state,
      correlationId: row.correlation_id,
      ...(row.causation_attempt_id === null
        ? {}
        : { causationAttemptId: row.causation_attempt_id }),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    }));
    const nextOffset = offset + attempts.length;
    return {
      attempts,
      ...(attempts.length >= input.limit
        ? { nextCursor: encodeSourcesActivityAttemptCursor({ offset: nextOffset }) }
        : {}),
    };
  }
}
