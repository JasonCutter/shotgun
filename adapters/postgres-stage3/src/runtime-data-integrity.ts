import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  buildEvidenceCandidates,
  type EvidenceLocatorPort,
} from '../../../modules/evidence/src/index.js';
import {
  HISTORICAL_RECONCILIATION_REQUIRED_CODE,
  STAGE3_RUNTIME_CONTRACT_ERROR_CODE,
} from '../../../modules/frontend-sources-write/src/index.js';
import type {
  SourcesStage3AtomicPersistencePort,
  SourcesStage3EvidenceIndexedInput,
  SourcesStage3ProgressLease,
  SourcesStage3ProgressPort,
  SourcesStage3ProgressState,
  SourcesStage3RecoveryItem,
  SourcesStage3ClaimResult,
  SourcesStage4ContinuationStorePort,
} from '../../../modules/frontend-sources-write/src/index.js';
import type { SaveTransformationInput } from '../../../modules/transformation/src/index.js';
import { sha256Text, ShotgunError, stableJson } from '../../../packages/contracts/src/index.js';
import { PostgresEvidenceRepository, PostgresTransformationRepository } from './index.js';

const nowIso = (): string => new Date().toISOString();
const MAX_STAGE3_LEASE_DURATION_MS = 5 * 60_000;

const validateLeaseInput = (now: string | undefined, leaseDurationMs: number): string => {
  const resolvedNow = now ?? nowIso();
  if (!Number.isFinite(Date.parse(resolvedNow))) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Stage 3 lease timestamp must be a valid ISO timestamp.',
      module: 'postgres-stage3',
      operation: 'validate-stage3-lease',
    });
  }
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1 ||
    leaseDurationMs > MAX_STAGE3_LEASE_DURATION_MS
  ) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Stage 3 lease duration must be a safe integer between 1 and ${MAX_STAGE3_LEASE_DURATION_MS} milliseconds.`,
      module: 'postgres-stage3',
      operation: 'validate-stage3-lease',
    });
  }
  return resolvedNow;
};

export class PostgresSourcesStage3ProgressRepository implements SourcesStage3ProgressPort {
  constructor(private readonly pool: Pool) {}

  async ensureMaterialized(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly createdAt?: string;
  }): Promise<void> {
    const inserted = await this.pool.query(
      `INSERT INTO source_product.source_stage3_progress (
         project_id, source_id, source_version_id, state, created_at, updated_at
       ) VALUES ($1, $2, $3, 'MATERIALIZED', $4, $4)
       ON CONFLICT (project_id, source_version_id) DO NOTHING`,
      [input.projectId, input.sourceId, input.sourceVersionId, input.createdAt ?? nowIso()],
    );
    if (inserted.rowCount === 1) return;
    const existing = await this.pool.query<{ source_id: string }>(
      `SELECT source_id::text
         FROM source_product.source_stage3_progress
        WHERE project_id = $1 AND source_version_id = $2`,
      [input.projectId, input.sourceVersionId],
    );
    if (existing.rows[0]?.source_id !== input.sourceId) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The SourceVersion is already bound to a different Source.',
        module: 'postgres-stage3',
        operation: 'ensure-source-stage3-progress',
      });
    }
  }

  async claim(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<SourcesStage3ClaimResult> {
    const now = validateLeaseInput(input.now, input.leaseDurationMs);
    const client = await this.pool.connect();
    let active = false;
    try {
      await client.query('BEGIN');
      active = true;
      const row = await client.query<{
        state: SourcesStage3ProgressState;
        fencing_token: string;
        lease_expires_at: Date | null;
        next_attempt_at: Date | null;
        indexing_result_id: string | null;
        safe_failure_code: string | null;
      }>(
        `SELECT state, fencing_token::text, lease_expires_at, next_attempt_at,
                indexing_result_id::text, safe_failure_code
           FROM source_product.source_stage3_progress
          WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
          FOR UPDATE`,
        [input.projectId, input.sourceId, input.sourceVersionId],
      );
      const current = row.rows[0];
      if (!current) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Source Stage 3 progress was not materialized.',
          module: 'postgres-stage3',
          operation: 'claim-source-stage3',
        });
      }
      if (current.state === 'STAGE3_COMPLETED' || current.state === 'NO_EVIDENCE') {
        const result = await client.query<{
          revision_id: string;
          indexing_result_id: string;
          evidence_count: number;
          reused_count: number;
        }>(
          `SELECT revision_id::text, indexing_result_id::text, evidence_count, reused_count
             FROM evidence.indexing_results
            WHERE indexing_result_id = $1`,
          [current.indexing_result_id],
        );
        const completed = result.rows[0];
        if (!completed) throw new Error('Completed Stage 3 progress has no indexing result.');
        await client.query('COMMIT');
        active = false;
        return {
          status: 'COMPLETED',
          state: current.state,
          revisionId: completed.revision_id,
          indexingResultId: completed.indexing_result_id,
          evidenceCount: completed.evidence_count,
          reusedCount: completed.reused_count,
        };
      }
      if (current.state === 'RECONCILIATION_REQUIRED') {
        await client.query('COMMIT');
        active = false;
        return {
          status: 'BLOCKED',
          reason:
            current.safe_failure_code === HISTORICAL_RECONCILIATION_REQUIRED_CODE
              ? 'HISTORICAL_RECONCILIATION'
              : current.safe_failure_code === STAGE3_RUNTIME_CONTRACT_ERROR_CODE
                ? 'RUNTIME_CONTRACT'
                : 'TERMINAL_FAILURE',
        };
      }
      if (
        current.state === 'STAGE3_RUNNING' &&
        current.lease_expires_at &&
        current.lease_expires_at.getTime() > Date.parse(now)
      ) {
        await client.query('COMMIT');
        active = false;
        return { status: 'DEFERRED', reason: 'ACTIVE_LEASE' };
      }
      if (
        current.state === 'STAGE3_RETRYABLE' &&
        current.next_attempt_at &&
        current.next_attempt_at.getTime() > Date.parse(now)
      ) {
        await client.query('COMMIT');
        active = false;
        return { status: 'DEFERRED', reason: 'RETRY_NOT_DUE' };
      }
      if (current.state === 'STAGE3_RUNNING') {
        await client.query(
          `UPDATE source_product.source_stage3_progress
              SET state = 'STAGE3_RETRYABLE', lease_owner = NULL, lease_token = NULL,
                  lease_acquired_at = NULL, lease_expires_at = NULL, next_attempt_at = $4::timestamptz,
                  safe_failure_code = 'LEASE_EXPIRED',
                  safe_failure_message = 'The previous Stage 3 lease expired.'
            WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3`,
          [input.projectId, input.sourceId, input.sourceVersionId, now],
        );
      }
      const leaseToken = randomUUID();
      const updated = await client.query<{ fencing_token: string }>(
        `UPDATE source_product.source_stage3_progress
            SET state = 'STAGE3_RUNNING', attempt_count = attempt_count + 1,
                next_attempt_at = NULL, lease_owner = $4, lease_token = $5,
                lease_acquired_at = $6::timestamptz,
                lease_expires_at = $6::timestamptz + ($7::bigint * interval '1 millisecond'),
                fencing_token = fencing_token + 1, safe_failure_code = NULL,
                safe_failure_message = NULL
          WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
            AND state IN ('MATERIALIZED', 'STAGE3_RETRYABLE', 'RECONCILIATION_REQUIRED')
         RETURNING fencing_token::text`,
        [
          input.projectId,
          input.sourceId,
          input.sourceVersionId,
          input.workerId,
          leaseToken,
          now,
          input.leaseDurationMs,
        ],
      );
      const claimed = updated.rows[0];
      if (!claimed) {
        await client.query('COMMIT');
        active = false;
        return { status: 'DEFERRED', reason: 'ACTIVE_LEASE' };
      }
      await client.query('COMMIT');
      active = false;
      return {
        status: 'CLAIMED',
        lease: {
          projectId: input.projectId,
          sourceId: input.sourceId,
          sourceVersionId: input.sourceVersionId,
          fencingToken: Number(claimed.fencing_token),
          leaseToken,
        },
      };
    } catch (error) {
      if (active) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordPreClaimFailure(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly retryable: boolean;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE source_product.source_stage3_progress
          SET state = CASE WHEN $4 THEN 'STAGE3_RETRYABLE' ELSE 'RECONCILIATION_REQUIRED' END,
              attempt_count = attempt_count + 1,
              next_attempt_at = CASE
                WHEN $4 THEN COALESCE(
                  $5::timestamptz,
                  clock_timestamp() + GREATEST(0.001, random())
                    * LEAST(300, 2 * POWER(2, LEAST(attempt_count, 7))) * interval '1 second'
                )
                ELSE NULL
              END,
              lease_owner = NULL, lease_token = NULL,
              lease_acquired_at = NULL, lease_expires_at = NULL,
              safe_failure_code = $6, safe_failure_message = $7,
              updated_at = clock_timestamp()
        WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
          AND state IN ('MATERIALIZED', 'STAGE3_RETRYABLE')`,
      [
        input.projectId,
        input.sourceId,
        input.sourceVersionId,
        input.retryable,
        input.nextAttemptAt ?? null,
        input.code.slice(0, 200),
        input.message.slice(0, 2000),
      ],
    );
    if (result.rowCount === 1) return;
    const existing = await this.pool.query<{ state: SourcesStage3ProgressState }>(
      `SELECT state
         FROM source_product.source_stage3_progress
        WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3`,
      [input.projectId, input.sourceId, input.sourceVersionId],
    );
    // A terminal reconciliation marker is monotonic. A late pre-claim error
    // must acknowledge that marker rather than resurrecting it as retryable.
    if (existing.rows[0]?.state === 'RECONCILIATION_REQUIRED') return;
    throw new ShotgunError({
      code: 'CONFLICT',
      safeMessage: 'Stage 3 pre-claim failure could not update its progress row.',
      module: 'postgres-stage3',
      operation: 'record-stage3-pre-claim-failure',
    });
  }

  async finalize(input: {
    readonly lease: SourcesStage3ProgressLease;
    readonly state: 'STAGE3_COMPLETED' | 'NO_EVIDENCE';
    readonly indexingResultId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE source_product.source_stage3_progress
          SET state = $5, indexing_result_id = $6, lease_owner = NULL,
              lease_token = NULL, lease_acquired_at = NULL, lease_expires_at = NULL,
              next_attempt_at = NULL, safe_failure_code = NULL, safe_failure_message = NULL
        WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
          AND lease_token = $4 AND fencing_token = $7 AND state = 'STAGE3_RUNNING'`,
      [
        input.lease.projectId,
        input.lease.sourceId,
        input.lease.sourceVersionId,
        input.lease.leaseToken,
        input.state,
        input.indexingResultId,
        input.lease.fencingToken,
      ],
    );
    if (result.rowCount === 1) return;
    // The atomic Stage 3 adapter may finalize the progress row in the same
    // transaction as transformation/evidence/result/continuation persistence.
    // Treat that exact terminal state as an idempotent acknowledgement while
    // rejecting a stale worker or a mismatched result.
    const existing = await this.pool.query<{
      state: SourcesStage3ProgressState;
      indexing_result_id: string | null;
    }>(
      `SELECT state, indexing_result_id::text
         FROM source_product.source_stage3_progress
        WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3`,
      [input.lease.projectId, input.lease.sourceId, input.lease.sourceVersionId],
    );
    if (
      existing.rows[0]?.state === input.state &&
      existing.rows[0]?.indexing_result_id === input.indexingResultId
    ) {
      return;
    }
    throw new Error('Stage 3 finalize lost its lease.');
  }

  async markFailure(input: {
    readonly lease: SourcesStage3ProgressLease;
    readonly retryable: boolean;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE source_product.source_stage3_progress
          SET state = CASE WHEN $5 THEN 'STAGE3_RETRYABLE' ELSE 'RECONCILIATION_REQUIRED' END,
              next_attempt_at = CASE
                WHEN $5 THEN COALESCE(
                  $6::timestamptz,
                  clock_timestamp() + GREATEST(0.001, random())
                    * LEAST(300, 2 * POWER(2, LEAST(attempt_count - 1, 7))) * interval '1 second'
                )
                ELSE NULL
              END,
              lease_owner = NULL, lease_token = NULL, lease_acquired_at = NULL,
              lease_expires_at = NULL, safe_failure_code = $7, safe_failure_message = $8
        WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
          AND lease_token = $4 AND fencing_token = $9 AND state = 'STAGE3_RUNNING'`,
      [
        input.lease.projectId,
        input.lease.sourceId,
        input.lease.sourceVersionId,
        input.lease.leaseToken,
        input.retryable,
        input.nextAttemptAt ?? null,
        input.code.slice(0, 200),
        input.message.slice(0, 2000),
        input.lease.fencingToken,
      ],
    );
    if (result.rowCount !== 1) throw new Error('Stage 3 failure update lost its lease.');
  }

  async markRetryable(input: {
    readonly lease: SourcesStage3ProgressLease;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void> {
    return this.markFailure({ ...input, retryable: true });
  }

  async findRecoverable(input?: { readonly limit?: number; readonly now?: string }) {
    const result = await this.pool.query<{
      project_id: string;
      source_id: string;
      source_version_id: string;
      state: SourcesStage3ProgressState;
      storage_key: string;
      media_type: 'text/plain' | 'text/markdown';
      content_hash: string;
      access_scope: string[];
      sensitivity: SourcesStage3RecoveryItem['sensitivity'];
    }>(
      `SELECT progress.project_id, progress.source_id::text,
              progress.source_version_id::text, progress.state,
              original.storage_key, version.media_type, original.content_hash,
              version.access_scope, version.sensitivity
         FROM source_product.source_stage3_progress
              AS progress
         JOIN asset.source_versions AS version
           ON version.source_id = progress.source_id
          AND version.source_version_id = progress.source_version_id
         JOIN asset.original_assets AS original
           ON original.asset_id = version.original_asset_id
        WHERE progress.state = 'MATERIALIZED'
           OR (progress.state = 'STAGE3_RETRYABLE'
               AND (progress.next_attempt_at IS NULL
                    OR progress.next_attempt_at <= COALESCE($1::timestamptz, now())))
           OR (progress.state = 'STAGE3_RUNNING'
               AND progress.lease_expires_at <= COALESCE($1::timestamptz, now()))
        ORDER BY progress.updated_at, progress.source_version_id
        LIMIT $2`,
      [input?.now ?? null, input?.limit ?? 100],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      sourceId: row.source_id,
      sourceVersionId: row.source_version_id,
      storageKey: row.storage_key,
      mediaType: row.media_type,
      contentHash: row.content_hash,
      accessScope: row.access_scope,
      sensitivity: row.sensitivity,
      state: row.state,
    }));
  }
}

export class PostgresSourcesStage3AtomicPersistence implements SourcesStage3AtomicPersistencePort {
  private readonly transformations: PostgresTransformationRepository;
  private readonly evidence: PostgresEvidenceRepository;

  constructor(private readonly pool: Pool) {
    this.transformations = new PostgresTransformationRepository(pool);
    this.evidence = new PostgresEvidenceRepository(pool);
  }

  async persist(input: {
    readonly transformation: SaveTransformationInput;
    readonly locator: EvidenceLocatorPort;
    readonly continuation: SourcesStage3EvidenceIndexedInput;
    readonly lease: SourcesStage3ProgressLease;
  }) {
    const client = await this.pool.connect();
    let active = false;
    try {
      await client.query('BEGIN');
      active = true;
      const progress = await client.query<{
        state: SourcesStage3ProgressState;
        lease_token: string | null;
        fencing_token: string;
      }>(
        `SELECT state, lease_token, fencing_token::text
           FROM source_product.source_stage3_progress
          WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
          FOR UPDATE`,
        [input.lease.projectId, input.lease.sourceId, input.lease.sourceVersionId],
      );
      const progressRow = progress.rows[0];
      if (
        !progressRow ||
        progressRow.state !== 'STAGE3_RUNNING' ||
        progressRow.lease_token !== input.lease.leaseToken ||
        Number(progressRow.fencing_token) !== input.lease.fencingToken
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Stage 3 lease is no longer valid.',
          module: 'postgres-stage3',
          operation: 'persist-stage3-atomic',
        });
      }
      const saved = await this.transformations.saveInTransaction(client, input.transformation);
      const candidates = buildEvidenceCandidates(saved.revision, input.locator);
      const indexed = await this.evidence.indexInTransaction(client, candidates);
      const evidenceIds = indexed.items.map((item) => item.evidenceId).sort();
      const evidenceSetDigest = sha256Text(stableJson(evidenceIds));
      const securityScopeDigest = sha256Text(
        stableJson({
          accessScope: input.continuation.accessScope,
          sensitivity: input.continuation.sensitivity,
        }),
      );
      const status = indexed.items.length === 0 ? 'NO_EVIDENCE' : 'INDEXED';
      const resultId = randomUUID();
      await client.query(
        `INSERT INTO evidence.indexing_results (
           indexing_result_id, project_id, source_id, source_version_id, revision_id,
           transformer_id, transformer_version, status, evidence_count, reused_count,
           evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   'stage3-evidence-index.v1', $12, $13, $13)
         ON CONFLICT (project_id, source_version_id, revision_id, transformer_id, transformer_version)
         DO NOTHING
         RETURNING indexing_result_id::text`,
        [
          resultId,
          input.transformation.projectId,
          input.transformation.sourceId,
          input.transformation.sourceVersionId,
          saved.revision.revisionId,
          input.transformation.transformer.id,
          input.transformation.transformer.version,
          status,
          indexed.items.length,
          indexed.reusedCount,
          evidenceSetDigest,
          securityScopeDigest,
          input.transformation.createdAt,
        ],
      );
      const result = await client.query<{
        indexing_result_id: string;
        project_id: string;
        source_id: string;
        source_version_id: string;
        revision_id: string;
        transformer_id: string;
        transformer_version: string;
        status: 'INDEXED' | 'NO_EVIDENCE';
        evidence_count: number;
        reused_count: number;
        evidence_set_digest: string;
        contract_version: string;
        security_scope_digest: string;
      }>(
        `SELECT indexing_result_id::text, project_id, source_id::text,
                source_version_id::text, revision_id::text, transformer_id,
                transformer_version, status, evidence_count, reused_count,
                evidence_set_digest, contract_version, security_scope_digest
           FROM evidence.indexing_results
          WHERE project_id = $1 AND source_version_id = $2 AND revision_id = $3
            AND transformer_id = $4 AND transformer_version = $5`,
        [
          input.transformation.projectId,
          input.transformation.sourceVersionId,
          saved.revision.revisionId,
          input.transformation.transformer.id,
          input.transformation.transformer.version,
        ],
      );
      const storedResult = result.rows[0];
      const indexingResultId = storedResult?.indexing_result_id;
      if (!indexingResultId) throw new Error('Indexing result was not stored.');
      if (
        storedResult.project_id !== input.transformation.projectId ||
        storedResult.source_id !== input.transformation.sourceId ||
        storedResult.source_version_id !== input.transformation.sourceVersionId ||
        storedResult.revision_id !== saved.revision.revisionId ||
        storedResult.transformer_id !== input.transformation.transformer.id ||
        storedResult.transformer_version !== input.transformation.transformer.version ||
        storedResult.status !== status ||
        storedResult.evidence_count !== indexed.items.length ||
        storedResult.evidence_set_digest !== evidenceSetDigest ||
        storedResult.contract_version !== 'stage3-evidence-index.v1' ||
        storedResult.security_scope_digest !== securityScopeDigest
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The existing Evidence indexing result conflicts with this replay.',
          module: 'postgres-stage3',
          operation: 'persist-stage3-indexing-result',
        });
      }
      // `reused_count` is an execution metric, so a replay can observe a
      // different local upsert count. Return the durable result's value to
      // keep the idempotent outcome stable across retries.
      const persistedIndexed = {
        items: indexed.items,
        reusedCount: storedResult.reused_count,
      };
      let continuationId: string | undefined;
      if (indexed.items.length > 0) {
        continuationId = randomUUID();
        const continuationKey = `evidence-indexed:${input.transformation.projectId}:${saved.revision.revisionId}`;
        await client.query(
          `INSERT INTO evidence.stage4_continuations (
             continuation_id, project_id, source_id, source_version_id, revision_id,
             indexing_result_id, continuation_key, evidence_snapshot, evidence_set_digest,
             evidence_count, access_scope, sensitivity, data_classification, state,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
                     'PENDING', $14, $14)
           ON CONFLICT (project_id, continuation_key) DO NOTHING`,
          [
            continuationId,
            input.transformation.projectId,
            input.transformation.sourceId,
            input.transformation.sourceVersionId,
            saved.revision.revisionId,
            indexingResultId,
            continuationKey,
            JSON.stringify({
              evidenceIds,
              revisionId: saved.revision.revisionId,
              sourceVersionId: input.transformation.sourceVersionId,
            }),
            evidenceSetDigest,
            indexed.items.length,
            input.continuation.accessScope,
            input.continuation.sensitivity,
            input.continuation.dataClassification,
            input.transformation.createdAt,
          ],
        );
        const existing = await client.query<{ continuation_id: string }>(
          `SELECT continuation_id::text
             FROM evidence.stage4_continuations
            WHERE project_id = $1 AND continuation_key = $2`,
          [input.transformation.projectId, continuationKey],
        );
        continuationId = existing.rows[0]?.continuation_id;
      }
      const finalized = await client.query(
        `UPDATE source_product.source_stage3_progress
            SET state = $5, indexing_result_id = $6, lease_owner = NULL,
                lease_token = NULL, lease_acquired_at = NULL, lease_expires_at = NULL,
                next_attempt_at = NULL, safe_failure_code = NULL, safe_failure_message = NULL
          WHERE project_id = $1 AND source_id = $2 AND source_version_id = $3
            AND lease_token = $4 AND fencing_token = $7 AND state = 'STAGE3_RUNNING'`,
        [
          input.lease.projectId,
          input.lease.sourceId,
          input.lease.sourceVersionId,
          input.lease.leaseToken,
          status === 'NO_EVIDENCE' ? 'NO_EVIDENCE' : 'STAGE3_COMPLETED',
          indexingResultId,
          input.lease.fencingToken,
        ],
      );
      if (finalized.rowCount !== 1) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Stage 3 lease was lost before finalization.',
          module: 'postgres-stage3',
          operation: 'finalize-stage3-atomic',
        });
      }
      await client.query('COMMIT');
      active = false;
      return { saved, indexed: persistedIndexed, indexingResultId, continuationId };
    } catch (error) {
      if (active) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresSourcesStage4ContinuationStore implements SourcesStage4ContinuationStorePort {
  constructor(private readonly pool: Pool) {}

  async claimNext(input: {
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }) {
    const now = validateLeaseInput(input.now, input.leaseDurationMs);
    const client = await this.pool.connect();
    const leaseToken = randomUUID();
    let active = false;
    try {
      await client.query('BEGIN');
      active = true;
      const result = await client.query<{
        continuation_id: string;
        project_id: string;
        source_id: string;
        source_version_id: string;
        revision_id: string;
        evidence_count: number;
        reused_count: number;
        access_scope: string[];
        sensitivity: SourcesStage3EvidenceIndexedInput['sensitivity'];
        data_classification: string;
        fencing_token: string;
      }>(
        `SELECT continuation.continuation_id::text, continuation.project_id,
                continuation.source_id::text, continuation.source_version_id::text,
                continuation.revision_id::text, continuation.evidence_count,
                result.reused_count, continuation.access_scope, continuation.sensitivity,
                continuation.data_classification, continuation.fencing_token::text
           FROM evidence.stage4_continuations AS continuation
           JOIN evidence.indexing_results AS result
             ON result.indexing_result_id = continuation.indexing_result_id
          WHERE continuation.state IN ('PENDING', 'RETRYABLE_FAILED')
            AND (continuation.next_attempt_at IS NULL OR continuation.next_attempt_at <= $1)
          ORDER BY COALESCE(continuation.next_attempt_at, continuation.created_at),
                   continuation.continuation_id
          FOR UPDATE OF continuation SKIP LOCKED
          LIMIT 1`,
        [now],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        active = false;
        return { status: 'EMPTY' } as const;
      }
      const updated = await client.query<{ fencing_token: string }>(
        `UPDATE evidence.stage4_continuations
            SET state = 'RUNNING', attempt_count = attempt_count + 1,
                lease_owner = $2, lease_token = $3, lease_acquired_at = $4::timestamptz,
                lease_expires_at = $4::timestamptz + ($5::bigint * interval '1 millisecond'),
                fencing_token = fencing_token + 1, updated_at = clock_timestamp()
          WHERE continuation_id = $1
         RETURNING fencing_token::text`,
        [row.continuation_id, input.workerId, leaseToken, now, input.leaseDurationMs],
      );
      await client.query('COMMIT');
      active = false;
      return {
        status: 'CLAIMED' as const,
        continuationId: row.continuation_id,
        leaseToken,
        fencingToken: Number(updated.rows[0]?.fencing_token ?? Number(row.fencing_token) + 1),
        continuation: {
          projectId: row.project_id,
          sourceId: row.source_id,
          sourceVersionId: row.source_version_id,
          revisionId: row.revision_id,
          evidenceCount: row.evidence_count,
          reusedCount: row.reused_count,
          accessScope: row.access_scope,
          sensitivity: row.sensitivity,
          dataClassification: row.data_classification,
        },
      };
    } catch (error) {
      if (active) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(input: {
    readonly continuationId: string;
    readonly leaseToken: string;
    readonly fencingToken: number;
    readonly generationRequestId?: string;
    readonly executionPinRef?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE evidence.stage4_continuations
          SET state = 'COMPLETED', completed_at = now(), lease_owner = NULL,
              lease_token = NULL, lease_acquired_at = NULL, lease_expires_at = NULL,
              generation_request_id = COALESCE($4, generation_request_id),
              execution_pin_ref = COALESCE($5, execution_pin_ref), safe_failure_code = NULL,
              safe_failure_message = NULL, updated_at = clock_timestamp()
        WHERE continuation_id = $1 AND lease_token = $2 AND fencing_token = $3
          AND state = 'RUNNING'`,
      [
        input.continuationId,
        input.leaseToken,
        input.fencingToken,
        input.generationRequestId ?? null,
        input.executionPinRef ?? null,
      ],
    );
    if (result.rowCount !== 1) throw new Error('Stage 4 continuation completion lost its lease.');
  }

  async fail(input: {
    readonly continuationId: string;
    readonly leaseToken: string;
    readonly fencingToken: number;
    readonly retryable: boolean;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void> {
    const state =
      input.code === 'OUTCOME_UNKNOWN'
        ? 'OUTCOME_UNKNOWN'
        : input.retryable
          ? 'RETRYABLE_FAILED'
          : 'TERMINAL_FAILED';
    const result = await this.pool.query(
      `UPDATE evidence.stage4_continuations
          SET state = $4, completed_at = CASE
                WHEN $4 IN ('TERMINAL_FAILED', 'OUTCOME_UNKNOWN') THEN now()
                ELSE NULL
              END,
              next_attempt_at = CASE
                WHEN $4 = 'RETRYABLE_FAILED' THEN COALESCE(
                  $5::timestamptz,
                  clock_timestamp() + LEAST(300, POWER(2, LEAST(attempt_count, 8))) * interval '1 second'
                )
                ELSE NULL
              END,
              lease_owner = NULL, lease_token = NULL, lease_acquired_at = NULL,
              lease_expires_at = NULL, safe_failure_code = $6, safe_failure_message = $7,
              updated_at = clock_timestamp()
        WHERE continuation_id = $1 AND lease_token = $2 AND fencing_token = $3
          AND state = 'RUNNING'`,
      [
        input.continuationId,
        input.leaseToken,
        input.fencingToken,
        state,
        input.nextAttemptAt ?? null,
        input.code.slice(0, 200),
        input.message.slice(0, 2000),
      ],
    );
    if (result.rowCount !== 1) throw new Error('Stage 4 continuation failure lost its lease.');
  }

  async recoverExpired(input?: { readonly now?: string }): Promise<number> {
    const result = await this.pool.query(
      `UPDATE evidence.stage4_continuations
          SET state = 'OUTCOME_UNKNOWN', completed_at = clock_timestamp(), next_attempt_at = NULL,
              lease_owner = NULL, lease_token = NULL, lease_acquired_at = NULL,
              lease_expires_at = NULL, safe_failure_code = 'LEASE_EXPIRED',
              safe_failure_message = 'The Stage 4 continuation lease expired; outcome requires reconciliation.',
              updated_at = clock_timestamp()
        WHERE state = 'RUNNING' AND lease_expires_at <= $1`,
      [input?.now ?? nowIso()],
    );
    return result.rowCount ?? 0;
  }
}
