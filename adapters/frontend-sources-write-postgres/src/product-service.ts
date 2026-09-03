import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  ShotgunError,
  SOURCES_SCHEMA_VERSION,
  type ExactDuplicateDecisionView,
  type IntakeSubmissionItemView,
  type IntakeSubmissionSnapshot,
  type SourcesCapability,
} from '../../../packages/contracts/src/index.js';
import type { SourcesStagingServicePort } from '../../../modules/frontend-sources-staging/src/index.js';
import type {
  CancelSourcesProductInput,
  ResolveSourcesDuplicateProductInput,
  RetrySourcesProductInput,
  SourcesProductWriteScope,
  SourcesProductWriteServicePort,
  SubmitSourcesProductInput,
} from '../../../modules/frontend-sources-write/src/product-service.js';
import {
  assertSourcesResourceSecurityContinuation,
  resolveSourcesResourceSecurity,
  sourceSecurityMetadataEqual,
  HISTORICAL_RECONCILIATION_REQUIRED_CODE,
  type SourcesResourceSecurityMetadata,
  type SourcesStage3PipelinePort,
  type SourcesStage3ProgressState,
} from '../../../modules/frontend-sources-write/src/index.js';
import type {
  CreateSourcesIntakeSubmissionInput,
  SourcesIntakeStoredItemInput,
  SourcesUrlSuccessProvenance,
} from '../../../modules/frontend-sources-write/src/index.js';
import { assertSourcesLedgerManifestSafe } from './index.js';
import { PostgresSourcesIntakeLifecycle } from './lifecycle.js';

const compatibleDuplicateDispositions = [
  'REUSE_EXISTING_VERSION',
  'CREATE_SEPARATE_SOURCE',
  'CANCEL_SUBMISSION',
] as const;

const incompatibleDuplicateDispositions = ['CREATE_SEPARATE_SOURCE', 'CANCEL_SUBMISSION'] as const;

type DuplicateRecord = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly originalAssetId: string;
  readonly security: SourcesResourceSecurityMetadata;
};

type MaterializedStage3Item = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly storageKey: string;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly contentHash: string;
  readonly security: SourcesResourceSecurityMetadata;
};

type ProductItemRow = QueryResultRow & {
  readonly submission_item_id: string;
  readonly client_item_id: string;
  readonly input_kind: 'DIRECT_TEXT' | 'FILE' | 'URL';
  readonly label: string;
  readonly input_manifest: Record<string, unknown>;
  readonly state: IntakeSubmissionItemView['state'];
  readonly validation_results: unknown;
  readonly content_hash: string | null;
  readonly media_type: string | null;
  readonly size_bytes: string | null;
  readonly produced_source_id: string | null;
  readonly produced_source_version_id: string | null;
  readonly active_duplicate_decision_id: string | null;
  readonly attention_reason: string | null;
  readonly safe_failure_code: string | null;
  readonly safe_failure_message: string | null;
  readonly safe_failure_retryable: boolean | null;
  readonly item_revision: string;
  readonly version_number: number | null;
  readonly stage3_state?: SourcesStage3ProgressState | null;
  readonly stage3_next_attempt_at?: Date | string | null;
  readonly stage3_lease_expires_at?: Date | string | null;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const epochMs = (value: Date | string | null | undefined): number | undefined =>
  value === null || value === undefined
    ? undefined
    : value instanceof Date
      ? value.getTime()
      : Date.parse(value);

const inputCapabilities = (
  state: IntakeSubmissionItemView['state'],
): readonly SourcesCapability[] => {
  if (state === 'ACTION_REQUIRED') return ['RESOLVE_DUPLICATE', 'CANCEL'];
  if (state === 'FAILED' || state === 'CANCELLED' || state === 'OUTCOME_INDETERMINATE') {
    return ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'];
  }
  if (state === 'VALIDATING' || state === 'QUEUED' || state === 'RUNNING') return ['CANCEL'];
  return [];
};

const submissionCapabilities = (
  state: IntakeSubmissionSnapshot['state'],
): readonly SourcesCapability[] => {
  if (state === 'FAILED' || state === 'CANCELLED' || state === 'OUTCOME_INDETERMINATE') {
    return ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'];
  }
  if (
    state === 'VALIDATING' ||
    state === 'QUEUED' ||
    state === 'RUNNING' ||
    state === 'PARTIAL' ||
    state === 'ACTION_REQUIRED'
  ) {
    return ['CANCEL'];
  }
  return [];
};

const safeManifest = (
  artifact: SubmitSourcesProductInput['items'][number],
): Readonly<Record<string, unknown>> => ({
  kind: artifact.kind,
  itemId: artifact.itemId,
  label: artifact.label,
  mediaType: artifact.mediaType,
  sizeBytes: artifact.sizeBytes,
  contentHash: artifact.contentHash,
  stagingReference: artifact.kind === 'URL' ? artifact.redactedRequestedUrl : 'sealed',
  ...(artifact.fileName === undefined ? {} : { fileName: artifact.fileName }),
  ...(artifact.redactedRequestedUrl === undefined
    ? {}
    : { requestedUrl: artifact.redactedRequestedUrl }),
  ...(artifact.requestedClassification === undefined
    ? {}
    : { requestedClassification: artifact.requestedClassification }),
});

const resolveItemSecurity = (
  scope: SourcesProductWriteScope,
  artifact: SubmitSourcesProductInput['items'][number],
): SourcesResourceSecurityMetadata =>
  resolveSourcesResourceSecurity(
    {
      principalId: scope.principalId,
      sensitivityClearance: scope.sensitivityClearance,
      policy: scope.resourceSecurityPolicy,
    },
    artifact.requestedClassification,
  );

const pinnedItemSecurity = (
  row: Pick<ProductItemRow, 'input_manifest'>,
): SourcesResourceSecurityMetadata => {
  const value = row.input_manifest['effectiveResourceSecurity'];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The Source Intake item has no durable resource security classification.',
      module: 'frontend-sources-write-postgres',
      operation: 'read-pinned-resource-security',
    });
  }
  const record = value as Record<string, unknown>;
  const sensitivity = record['sensitivity'];
  const accessScope = record['accessScope'];
  if (
    (sensitivity !== 'public' &&
      sensitivity !== 'internal' &&
      sensitivity !== 'private' &&
      sensitivity !== 'restricted') ||
    !Array.isArray(accessScope) ||
    accessScope.length === 0 ||
    !accessScope.every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The Source Intake item has invalid durable resource security metadata.',
      module: 'frontend-sources-write-postgres',
      operation: 'read-pinned-resource-security',
    });
  }
  return { sensitivity, accessScope };
};

const allowedDuplicateDispositions = (
  existing: SourcesResourceSecurityMetadata,
  requested: SourcesResourceSecurityMetadata,
): readonly string[] =>
  sourceSecurityMetadataEqual(existing, requested)
    ? compatibleDuplicateDispositions
    : incompatibleDuplicateDispositions;

const storedItem = (
  artifact: SubmitSourcesProductInput['items'][number],
  requestedSourceId?: string,
): SourcesIntakeStoredItemInput => ({
  clientItemId: artifact.itemId,
  inputKind: artifact.kind,
  label: artifact.label,
  inputManifest: {
    ...safeManifest(artifact),
    stagingReference: artifact.kind === 'URL' ? artifact.redactedRequestedUrl : 'sealed',
  },
  channel: artifact.channel,
  mediaType: artifact.mediaType,
  contentHash: artifact.contentHash,
  sizeBytes: artifact.sizeBytes,
  storageKey: artifact.storageKey,
  ...(artifact.fileName === undefined ? {} : { originalFileName: artifact.fileName }),
  ...(requestedSourceId === undefined ? {} : { requestedSourceId }),
  ...(artifact.urlProvenance === undefined ? {} : { urlProvenance: artifact.urlProvenance }),
});

export class PostgresSourcesProductService implements SourcesProductWriteServicePort {
  private readonly lifecycle: PostgresSourcesIntakeLifecycle;

  constructor(
    private readonly pool: Pool,
    private readonly staging: SourcesStagingServicePort,
    /** FE-P5-XP Correction C: Source Intake → Stage 3 pipeline (real path). */
    private readonly stage3Pipeline?: SourcesStage3PipelinePort,
  ) {
    this.lifecycle = new PostgresSourcesIntakeLifecycle(pool);
  }

  async submit(input: SubmitSourcesProductInput): Promise<IntakeSubmissionSnapshot> {
    const existing = await this.getSubmission(input.scope, input.submissionId);
    if (existing) {
      // FE-P5-XP Correction Round 2: a replay of an intake whose SourceVersions
      // were materialized but whose Stage 3 pipeline did not complete
      // (RUNNING/PARTIAL/OUTCOME_INDETERMINATE) RESUMES the pipeline for the SAME
      // SourceVersions (idempotent) and then finalizes the submission — a
      // transient Stage 3 failure must never leave a SourceVersion permanently
      // without Evidence nor falsely report a final SUCCESS.
      // FE-P5-XP Correction Round 3: the original mixed outcome (duplicate /
      // action-required items) is preserved, so a mixed submission resumes to
      // PARTIAL and an all-succeeded one to SUCCEEDED.
      if (
        this.stage3Pipeline &&
        ['RUNNING', 'PARTIAL', 'OUTCOME_INDETERMINATE'].includes(existing.state)
      ) {
        const resumed = await this.materializedItemsForStage3(
          input.scope.projectId,
          input.submissionId,
        );
        if (resumed.items.length > 0 || resumed.unfinishedCount === 0) {
          await this.runStage3AndFinalize(
            resumed.items,
            input,
            input.scope,
            resumed.unfinishedCount,
          );
        }
        return (await this.getSubmission(input.scope, input.submissionId))!;
      }
      return existing;
    }
    const client = await this.pool.connect();
    // Materialized SourceVersions are handed to the Stage 3 pipeline AFTER the
    // intake transaction commits (real production path, never fixture-side).
    const materializedForStage3: MaterializedStage3Item[] = [];
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.scope.projectId}:${input.submissionId}`,
      ]);
      await this.assertAcceptedCommand(
        client,
        input.commandId,
        input.scope,
        'sources.intake.submit.v1',
      );
      await client.query(
        `INSERT INTO source_product.intake_submissions (
           submission_id, project_id, principal_id, session_id, create_command_id,
           state, accepted_policy_context_id, accepted_policy_binding,
           access_revision, policy_context_revision, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7::jsonb, $8, $9, $10, $10)`,
        [
          input.submissionId,
          input.scope.projectId,
          input.scope.principalId,
          input.scope.sessionId,
          input.commandId,
          input.scope.acceptedPolicyContextId,
          JSON.stringify(input.scope.acceptedPolicyBinding),
          input.scope.accessRevision,
          input.scope.policyContextRevision,
          input.createdAt,
        ],
      );

      let succeeded = 0;
      let actionRequired = 0;
      for (const [ordinal, artifact] of input.items.entries()) {
        const itemId = randomUUID();
        const attemptId = randomUUID();
        const security = resolveItemSecurity(input.scope, artifact);
        const manifest = {
          ...safeManifest(artifact),
          stagingReference: this.referenceForArtifact(artifact),
          effectiveResourceSecurity: security,
        };
        assertSourcesLedgerManifestSafe(manifest);
        await this.insertItemAndAttempt(
          client,
          input,
          artifact,
          itemId,
          attemptId,
          ordinal,
          manifest,
        );
        const duplicate = await this.findDuplicate(
          client,
          input.scope.projectId,
          artifact.contentHash,
          security,
        );
        if (duplicate) {
          await this.createDuplicateDecision(
            client,
            input,
            artifact,
            itemId,
            attemptId,
            duplicate,
            security,
          );
          actionRequired += 1;
        } else {
          const materialized = await this.materialize(
            client,
            input.scope,
            input.submissionId,
            itemId,
            attemptId,
            storedItem(artifact),
            security,
            input.createdAt,
          );
          materializedForStage3.push({
            sourceId: materialized.sourceId,
            sourceVersionId: materialized.sourceVersionId,
            storageKey: artifact.storageKey,
            mediaType: artifact.mediaType,
            contentHash: artifact.contentHash,
            security,
          });
          succeeded += 1;
        }
      }
      // FE-P5-XP Correction Round 2: the submission is NOT finalized SUCCEEDED
      // until the Stage 3 pipeline completed. After the (durable) materialization
      // commit the submission stays RUNNING while the pipeline runs; a Stage 3
      // failure flips it to OUTCOME_INDETERMINATE (retryable) instead of falsely
      // reporting SUCCESS without Evidence.
      const baseState =
        actionRequired === 0 ? 'RUNNING' : succeeded === 0 ? 'ACTION_REQUIRED' : 'PARTIAL';
      await client.query(
        `UPDATE source_product.intake_submissions
         SET state = $2, completed_at = NULL
         WHERE submission_id = $1`,
        [input.submissionId, baseState],
      );
      await client.query('COMMIT');
      transactionActive = false;
      // FE-P5-XP Correction C: after the intake transaction commits, run the
      // REAL production Stage 3 pipeline for every materialized SourceVersion
      // (transform + evidence indexing). The pipeline is idempotent.
      if (this.stage3Pipeline && materializedForStage3.length > 0) {
        await this.runStage3AndFinalize(materializedForStage3, input, input.scope);
      } else if (actionRequired === 0) {
        await this.finalizeSubmissionState(input.submissionId, 'SUCCEEDED', input.createdAt);
      }
      return (await this.getSubmission(input.scope, input.submissionId))!;
    } catch (error) {
      if (transactionActive) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * FE-P5-XP Correction Round 2 — run the Stage 3 pipeline for materialized
   * SourceVersions and only THEN finalize the submission SUCCEEDED. On a Stage 3
   * failure the submission is flipped to OUTCOME_INDETERMINATE (retryable) so a
   * replay resumes the SAME SourceVersions; a final SUCCESS is never reported
   * without Evidence.
   */
  private async runStage3AndFinalize(
    items: readonly MaterializedStage3Item[],
    input: Pick<SubmitSourcesProductInput, 'submissionId' | 'createdAt'>,
    scope: SourcesProductWriteScope,
    unfinishedCount = 0,
  ): Promise<void> {
    if (!this.stage3Pipeline) return;
    // A submission may be RUNNING while another worker still holds a valid
    // SourceVersion lease. Do not finalize it merely because this replay has
    // no currently-claimable rows; the durable progress row remains the
    // authority for when resume is safe.
    if (items.length === 0 && unfinishedCount > 0) return;
    try {
      for (const item of items) {
        await this.stage3Pipeline.runForSourceVersion({
          projectId: scope.projectId,
          sourceId: item.sourceId,
          sourceVersionId: item.sourceVersionId,
          storageKey: item.storageKey,
          mediaType: item.mediaType,
          contentHash: item.contentHash,
          accessScope: [...item.security.accessScope],
          sensitivity: item.security.sensitivity,
        });
      }
    } catch (error) {
      await this.markSubmissionStage3Incomplete(
        input.submissionId,
        error instanceof ShotgunError ? error.code : 'STAGE3_RETRYABLE_FAILURE',
        error instanceof ShotgunError
          ? error.safeMessage
          : 'Stage 3 transformation or Evidence indexing failed.',
      );
      throw error;
    }
    await this.markStage3ItemsSucceeded(input.submissionId);
    // A historical reconciliation row is intentionally not eligible for the
    // normal pipeline.  Do not let another eligible item make the submission
    // look terminal while that unresolved SourceVersion remains outstanding.
    const remaining = await this.materializedItemsForStage3(scope.projectId, input.submissionId);
    if (remaining.unfinishedCount > 0) return;
    await this.finalizeSubmissionState(
      input.submissionId,
      remaining.actionRequired === 0 ? 'SUCCEEDED' : 'PARTIAL',
      input.createdAt,
    );
  }

  /**
   * Flip an intake whose Stage 3 pipeline failed to a retryable state.
   * FE-P5-XP Correction Round 3: both RUNNING (all-succeeded items) and PARTIAL
   * (mixed duplicate + materialized items) submissions transition here, so a
   * mixed submission is also retryable instead of permanently lacking Evidence.
   */
  private async markSubmissionStage3Incomplete(
    submissionId: string,
    code: string,
    message: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      await client.query(
        `UPDATE source_product.intake_submissions
         SET state = 'OUTCOME_INDETERMINATE'
         WHERE submission_id = $1 AND state IN ('RUNNING', 'PARTIAL')`,
        [submissionId],
      );
      await client.query(
        `UPDATE source_product.intake_submission_items AS item
            SET state = 'OUTCOME_INDETERMINATE', safe_failure_code = $2,
                safe_failure_message = $3, safe_failure_retryable = true
          WHERE item.submission_id = $1
            AND item.produced_source_version_id IS NOT NULL
            AND item.state = 'SUCCEEDED'
            AND EXISTS (
              SELECT 1
                FROM source_product.source_stage3_progress AS progress
               WHERE progress.project_id = item.project_id
                 AND progress.source_version_id = item.produced_source_version_id
                 AND progress.state NOT IN ('STAGE3_COMPLETED', 'NO_EVIDENCE')
            )`,
        [submissionId, code.slice(0, 200), message.slice(0, 2000)],
      );
      await client.query('COMMIT');
      transactionActive = false;
    } catch (error) {
      if (transactionActive) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Finalize an intake submission to its terminal state once Stage 3 is done. */
  private async finalizeSubmissionState(
    submissionId: string,
    state: 'SUCCEEDED' | 'PARTIAL',
    createdAt: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      await client.query(
        `UPDATE source_product.intake_submissions
         SET state = $2,
             completed_at = CASE WHEN $2 = 'SUCCEEDED' THEN $3::timestamptz ELSE completed_at END
         WHERE submission_id = $1 AND state IN ('RUNNING', 'OUTCOME_INDETERMINATE')`,
        [submissionId, state, createdAt],
      );
      await client.query('COMMIT');
      transactionActive = false;
    } catch (error) {
      if (transactionActive) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * FE-P5-XP Correction Round 2 — resolve the materialized SourceVersions of an
   * existing intake (replay/resume) for the Stage 3 pipeline, preserving the
   * SAME SourceId/SourceVersionId (never re-materialize a duplicate).
   * FE-P5-XP Correction Round 3 — also reports how many items of the original
   * submission are still action-required (duplicate decisions), so a resumed
   * mixed submission finalizes PARTIAL and an all-succeeded one SUCCEEDED.
   */
  private async materializedItemsForStage3(
    projectId: string,
    submissionId: string,
  ): Promise<{
    readonly items: MaterializedStage3Item[];
    readonly actionRequired: number;
    readonly unfinishedCount: number;
  }> {
    const result = await this.pool.query<ProductItemRow>(
      `SELECT item.submission_item_id::text, item.client_item_id, item.input_kind,
              item.label, item.input_manifest, item.state, item.validation_results,
              item.content_hash, item.media_type, item.size_bytes::text,
              item.produced_source_id::text, item.produced_source_version_id::text,
              item.active_duplicate_decision_id::text, item.attention_reason,
              item.safe_failure_code, item.safe_failure_message,
              item.safe_failure_retryable, item.item_revision::text,
              version.version_number,
              progress.state AS stage3_state,
              progress.next_attempt_at AS stage3_next_attempt_at,
              progress.lease_expires_at AS stage3_lease_expires_at
       FROM source_product.intake_submission_items AS item
       LEFT JOIN asset.source_versions AS version
         ON version.source_version_id = item.produced_source_version_id
       LEFT JOIN source_product.source_stage3_progress AS progress
         ON progress.project_id = item.project_id
        AND progress.source_id = item.produced_source_id
        AND progress.source_version_id = item.produced_source_version_id
       WHERE item.project_id = $1 AND item.submission_id = $2
         AND item.produced_source_id IS NOT NULL
         AND item.produced_source_version_id IS NOT NULL
       ORDER BY item.ordinal`,
      [projectId, submissionId],
    );
    const actionRequired = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM source_product.intake_submission_items
       WHERE project_id = $1 AND submission_id = $2
         AND active_duplicate_decision_id IS NOT NULL`,
      [projectId, submissionId],
    );
    const items: MaterializedStage3Item[] = [];
    let unfinishedCount = 0;
    const now = Date.now();
    for (const row of result.rows) {
      const state = row.stage3_state as SourcesStage3ProgressState | null;
      const terminal = state === 'STAGE3_COMPLETED' || state === 'NO_EVIDENCE';
      if (!terminal) unfinishedCount += 1;
      const retryableReady =
        state === 'STAGE3_RETRYABLE' &&
        (epochMs(row.stage3_next_attempt_at) === undefined ||
          epochMs(row.stage3_next_attempt_at)! <= now);
      const staleRunning =
        state === 'STAGE3_RUNNING' &&
        epochMs(row.stage3_lease_expires_at) !== undefined &&
        epochMs(row.stage3_lease_expires_at)! <= now;
      const eligible =
        state === 'MATERIALIZED' ||
        (state === 'RECONCILIATION_REQUIRED' &&
          row.safe_failure_code !== HISTORICAL_RECONCILIATION_REQUIRED_CODE) ||
        retryableReady ||
        staleRunning;
      if (!eligible) continue;
      const contentHash = row.content_hash;
      if (!contentHash) continue;
      const storage = await this.pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM asset.original_assets WHERE content_hash = $1 LIMIT 1`,
        [contentHash],
      );
      const storageKey = storage.rows[0]?.storage_key;
      if (!storageKey) continue;
      items.push({
        sourceId: row.produced_source_id!,
        sourceVersionId: row.produced_source_version_id!,
        storageKey,
        mediaType: (row.media_type as 'text/plain' | 'text/markdown') ?? 'text/plain',
        contentHash,
        security: pinnedItemSecurity(row),
      });
    }
    return {
      items,
      actionRequired: Number(actionRequired.rows[0]?.count ?? 0),
      unfinishedCount,
    };
  }

  async getSubmission(
    scope: SourcesProductWriteScope,
    submissionId: string,
  ): Promise<IntakeSubmissionSnapshot | undefined> {
    const submission = await this.pool.query<{
      submission_id: string;
      principal_id: string;
      session_id: string;
      project_id: string;
      state: IntakeSubmissionSnapshot['state'];
      accepted_policy_context_id: string;
      submission_revision: string;
      access_revision: string;
      policy_context_revision: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT submission_id::text, principal_id::text, session_id::text, project_id,
              state, accepted_policy_context_id, submission_revision::text,
              access_revision, policy_context_revision, created_at, updated_at
       FROM source_product.intake_submissions
       WHERE project_id = $1 AND submission_id = $2`,
      [scope.projectId, submissionId],
    );
    const row = submission.rows[0];
    if (!row) return undefined;
    if (row.principal_id !== scope.principalId) return undefined;
    const items = await this.pool.query<ProductItemRow>(
      `SELECT item.submission_item_id::text, item.client_item_id, item.input_kind,
              item.label, item.input_manifest, item.state, item.validation_results,
              item.content_hash, item.media_type, item.size_bytes::text,
              item.produced_source_id::text, item.produced_source_version_id::text,
              item.active_duplicate_decision_id::text, item.attention_reason,
              item.safe_failure_code, item.safe_failure_message,
              item.safe_failure_retryable, item.item_revision::text,
              version.version_number
       FROM source_product.intake_submission_items AS item
       LEFT JOIN asset.source_versions AS version
         ON version.source_version_id = item.produced_source_version_id
       WHERE item.project_id = $1 AND item.submission_id = $2
       ORDER BY item.ordinal`,
      [scope.projectId, submissionId],
    );
    return {
      schemaVersion: SOURCES_SCHEMA_VERSION,
      submissionId: row.submission_id,
      principalId: row.principal_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      state: row.state,
      items: items.rows.map((item) => this.publicItem(scope, item)),
      capabilities: submissionCapabilities(row.state),
      acceptedPolicyContextId: row.accepted_policy_context_id,
      submissionRevision: row.submission_revision,
      accessRevision: row.access_revision,
      policyContextRevision: row.policy_context_revision,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      stale:
        row.access_revision !== scope.accessRevision ||
        row.policy_context_revision !== scope.policyContextRevision,
    };
  }

  async getDuplicateDecision(
    scope: SourcesProductWriteScope,
    decisionId: string,
  ): Promise<ExactDuplicateDecisionView | undefined> {
    const result = await this.pool.query<{
      decision_id: string;
      submission_id: string;
      submission_item_id: string;
      project_id: string;
      content_hash: string;
      existing_source_id: string;
      existing_source_version_id: string;
      allowed_dispositions: ExactDuplicateDecisionView['allowedDispositions'];
      decision_revision: string;
      observed_source_revision: string;
      access_revision: string;
      policy_context_revision: string;
      created_at: Date;
      version_number: number;
      label: string | null;
    }>(
      `SELECT decision.decision_id::text, decision.submission_id::text,
              decision.submission_item_id::text, decision.project_id,
              decision.content_hash, decision.existing_source_id::text,
              decision.existing_source_version_id::text,
              decision.allowed_dispositions, decision.decision_revision::text,
              decision.observed_source_revision, decision.access_revision,
              decision.policy_context_revision, decision.created_at,
              version.version_number, receipt.original_file_name AS label
       FROM source_product.exact_duplicate_decisions AS decision
       JOIN asset.source_versions AS version
         ON version.source_version_id = decision.existing_source_version_id
       LEFT JOIN LATERAL (
         SELECT original_file_name
         FROM asset.storage_receipts
         WHERE project_id = decision.project_id
           AND source_version_id = decision.existing_source_version_id
         ORDER BY created_at, receipt_id LIMIT 1
       ) AS receipt ON true
       WHERE decision.project_id = $1 AND decision.decision_id = $2`,
      [scope.projectId, decisionId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      schemaVersion: SOURCES_SCHEMA_VERSION,
      decisionId: row.decision_id,
      submissionId: row.submission_id,
      itemId: row.submission_item_id,
      projectId: row.project_id,
      contentHash: row.content_hash,
      existingSource: {
        sourceId: row.existing_source_id,
        sourceVersionId: row.existing_source_version_id,
        label: row.label ?? `Source ${row.existing_source_id.slice(0, 8)}`,
        versionNumber: row.version_number,
      },
      allowedDispositions: row.allowed_dispositions,
      decisionRevision: row.decision_revision,
      sourceRevision: row.observed_source_revision,
      accessRevision: row.access_revision,
      policyContextRevision: row.policy_context_revision,
      createdAt: iso(row.created_at),
    };
  }

  async resolveDuplicate(
    input: ResolveSourcesDuplicateProductInput,
  ): Promise<IntakeSubmissionSnapshot> {
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      const decision = await client.query<{
        submission_id: string;
        submission_item_id: string;
        decision_revision: string;
        access_revision: string;
        policy_context_revision: string;
        existing_source_id: string;
        existing_source_version_id: string;
        content_hash: string;
        input_kind: 'DIRECT_TEXT' | 'FILE' | 'URL';
        client_item_id: string;
        input_manifest: Record<string, unknown>;
        allowed_dispositions: readonly string[];
        label: string;
        state: string;
      }>(
        `SELECT decision.submission_id::text, decision.submission_item_id::text,
                decision.decision_revision::text, decision.access_revision,
                decision.policy_context_revision, decision.existing_source_id::text,
                decision.existing_source_version_id::text, decision.content_hash,
                item.input_kind, item.client_item_id, item.input_manifest,
                decision.allowed_dispositions, item.label, item.state
         FROM source_product.exact_duplicate_decisions AS decision
         JOIN source_product.intake_submission_items AS item
           ON item.submission_item_id = decision.submission_item_id
         WHERE decision.project_id = $1 AND decision.decision_id = $2
         FOR UPDATE OF decision, item`,
        [input.scope.projectId, input.decisionId],
      );
      const row = decision.rows[0];
      if (!row) throw this.notFound();
      if (
        row.decision_revision !== input.observedDecisionRevision ||
        row.access_revision !== input.scope.accessRevision ||
        row.policy_context_revision !== input.scope.policyContextRevision
      ) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The duplicate decision is stale.',
          module: 'frontend-sources-write-postgres',
          operation: 'resolve-duplicate',
        });
      }
      await this.assertAcceptedCommand(
        client,
        input.commandId,
        input.scope,
        'sources.duplicate.resolve.v1',
      );
      if (!row.allowed_dispositions.includes(input.disposition)) {
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage:
            'The requested duplicate disposition is not allowed for this Source security identity.',
          module: 'frontend-sources-write-postgres',
          operation: 'resolve-duplicate',
        });
      }
      const security = pinnedItemSecurity(row);
      await client.query(
        `INSERT INTO source_product.exact_duplicate_dispositions (
           disposition_id, project_id, submission_id, submission_item_id,
           decision_id, observed_decision_revision, command_id, disposition,
           target_source_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          input.scope.projectId,
          row.submission_id,
          row.submission_item_id,
          input.decisionId,
          Number(input.observedDecisionRevision),
          input.commandId,
          input.disposition,
          input.targetSourceId ?? null,
          input.createdAt,
        ],
      );
      await client.query(
        `UPDATE source_product.intake_submissions
         SET state = 'RUNNING'
         WHERE submission_id = $1 AND state IN ('PARTIAL', 'ACTION_REQUIRED')`,
        [row.submission_id],
      );
      if (input.disposition === 'CANCEL_SUBMISSION') {
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'CANCEL_REQUESTED' WHERE submission_item_id = $1`,
          [row.submission_item_id],
        );
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'CANCELLED', completed_at = $2 WHERE submission_item_id = $1`,
          [row.submission_item_id, input.createdAt],
        );
      } else {
        const reference = String(row.input_manifest['stagingReference'] ?? '');
        const artifact = await this.staging.resolve({
          stagingReference: reference,
          draftId: String(row.input_manifest['draftId'] ?? ''),
          itemId: row.client_item_id,
          projectId: input.scope.projectId,
          principalId: input.scope.principalId,
          kind: row.input_kind,
        });
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'RUNNING' WHERE submission_item_id = $1`,
          [row.submission_item_id],
        );
        const attemptId = await this.createResolutionAttempt(
          client,
          input,
          row.submission_id,
          row.submission_item_id,
        );
        if (input.disposition === 'REUSE_EXISTING_VERSION') {
          await this.reuseExistingVersion(
            client,
            input.scope,
            row.submission_item_id,
            attemptId,
            artifact,
            security,
            row.existing_source_id,
            row.existing_source_version_id,
            input.createdAt,
          );
        } else {
          await this.materialize(
            client,
            input.scope,
            row.submission_id,
            row.submission_item_id,
            attemptId,
            storedItem(artifact),
            security,
            input.createdAt,
          );
        }
      }
      // Duplicate resolution can materialize a new SourceVersion (or reuse an
      // existing one whose Stage 3 work was interrupted). When the real Stage
      // 3 pipeline is available, the submission was already moved to RUNNING
      // above; keep it there until transform and Evidence indexing complete.
      // Recomputing here would terminalize it as SUCCEEDED before Stage 3 and
      // the lifecycle contract intentionally forbids SUCCEEDED -> RUNNING.
      if (input.disposition === 'CANCEL_SUBMISSION' || !this.stage3Pipeline) {
        await this.recomputeSubmission(client, row.submission_id, input.createdAt);
      }
      await client.query('COMMIT');
      transactionActive = false;
      if (input.disposition !== 'CANCEL_SUBMISSION' && this.stage3Pipeline) {
        const resumed = await this.materializedItemsForStage3(
          input.scope.projectId,
          row.submission_id,
        );
        if (resumed.items.length > 0 || resumed.unfinishedCount === 0) {
          await this.runStage3AndFinalize(
            resumed.items,
            { submissionId: row.submission_id, createdAt: input.createdAt },
            input.scope,
            resumed.unfinishedCount,
          );
        }
      }
      return (await this.getSubmission(input.scope, row.submission_id))!;
    } catch (error) {
      if (transactionActive) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async retry(input: RetrySourcesProductInput): Promise<IntakeSubmissionSnapshot> {
    if (input.mode === 'CURRENT_POLICY') {
      await this.assertCurrentPolicyAllowsPinnedItems(input);
    }
    await this.lifecycle.retryItems({
      projectId: input.scope.projectId,
      submissionId: input.submissionId,
      submissionItemIds: input.itemIds,
      commandId: input.commandId,
      correlationId: input.correlationId,
      mode: input.mode,
      acceptedPolicyContextId: input.scope.acceptedPolicyContextId,
      acceptedPolicyBinding: input.scope.acceptedPolicyBinding,
      createdAt: input.createdAt,
    });
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      await client.query(
        `UPDATE source_product.intake_submissions SET state = 'RUNNING'
         WHERE submission_id = $1 AND state = 'QUEUED'`,
        [input.submissionId],
      );
      for (const itemId of input.itemIds) {
        const item = await client.query<{
          input_kind: 'DIRECT_TEXT' | 'FILE' | 'URL';
          client_item_id: string;
          input_manifest: Record<string, unknown>;
          content_hash: string;
          submission_item_id: string;
          intake_attempt_id: string;
          produced_source_id: string | null;
          produced_source_version_id: string | null;
        }>(
          `SELECT item.input_kind, item.client_item_id, item.input_manifest,
                  item.content_hash, item.submission_item_id::text,
                  item.produced_source_id::text, item.produced_source_version_id::text,
                  attempt.intake_attempt_id::text
           FROM source_product.intake_submission_items AS item
           JOIN LATERAL (
             SELECT intake_attempt_id
             FROM source_product.intake_attempts
             WHERE submission_item_id = item.submission_item_id
             ORDER BY attempt_number DESC LIMIT 1
           ) AS attempt ON true
           WHERE item.project_id = $1 AND item.submission_id = $2
             AND item.submission_item_id = $3
           FOR UPDATE OF item`,
          [input.scope.projectId, input.submissionId, itemId],
        );
        const row = item.rows[0];
        if (!row) throw this.notFound();
        const security = pinnedItemSecurity(row);
        await client.query(
          `UPDATE source_product.intake_attempts SET state = 'RUNNING'
           WHERE intake_attempt_id = $1 AND state = 'ACCEPTED'`,
          [row.intake_attempt_id],
        );
        await client.query(
          `UPDATE source_product.intake_submission_items SET state = 'RUNNING'
           WHERE submission_item_id = $1 AND state = 'QUEUED'`,
          [row.submission_item_id],
        );
        // Stage 3 retries resume the durable SourceVersion and never restage
        // the original artifact.
        if (row.produced_source_id && row.produced_source_version_id) continue;
        const artifact = await this.staging.resolve({
          stagingReference: String(row.input_manifest['stagingReference'] ?? ''),
          draftId: String(row.input_manifest['draftId'] ?? ''),
          itemId: row.client_item_id,
          projectId: input.scope.projectId,
          principalId: input.scope.principalId,
          kind: row.input_kind,
        });
        const duplicate = await this.findDuplicate(
          client,
          input.scope.projectId,
          artifact.contentHash,
          security,
        );
        if (duplicate) {
          await this.createRetryDuplicateDecision(
            client,
            input,
            artifact,
            row.submission_item_id,
            row.intake_attempt_id,
            duplicate,
            security,
          );
        } else {
          await this.materialize(
            client,
            input.scope,
            input.submissionId,
            row.submission_item_id,
            row.intake_attempt_id,
            storedItem(artifact),
            security,
            input.createdAt,
          );
        }
      }
      if (!this.stage3Pipeline) {
        await this.recomputeSubmission(client, input.submissionId, input.createdAt);
      }
      await client.query('COMMIT');
      transactionActive = false;
      if (this.stage3Pipeline) {
        const resumed = await this.materializedItemsForStage3(
          input.scope.projectId,
          input.submissionId,
        );
        if (resumed.items.length > 0 || resumed.unfinishedCount === 0) {
          await this.runStage3AndFinalize(
            resumed.items,
            { submissionId: input.submissionId, createdAt: input.createdAt },
            input.scope,
            resumed.unfinishedCount,
          );
        }
      }
      return (await this.getSubmission(input.scope, input.submissionId))!;
    } catch (error) {
      if (transactionActive) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertCurrentPolicyAllowsPinnedItems(
    input: RetrySourcesProductInput,
  ): Promise<void> {
    const rows = await this.pool.query<
      Pick<ProductItemRow, 'input_manifest' | 'submission_item_id'>
    >(
      `SELECT submission_item_id::text, input_manifest
       FROM source_product.intake_submission_items
       WHERE project_id = $1 AND submission_id = $2
         AND submission_item_id = ANY($3::uuid[])`,
      [input.scope.projectId, input.submissionId, input.itemIds],
    );
    if (rows.rowCount !== input.itemIds.length) throw this.notFound();
    const authority = {
      principalId: input.scope.principalId,
      sensitivityClearance: input.scope.sensitivityClearance,
      policy: input.scope.resourceSecurityPolicy,
    };
    for (const row of rows.rows) {
      assertSourcesResourceSecurityContinuation(authority, pinnedItemSecurity(row));
    }
  }

  async cancel(input: CancelSourcesProductInput): Promise<IntakeSubmissionSnapshot> {
    await this.lifecycle.cancelSubmission({
      projectId: input.scope.projectId,
      submissionId: input.submissionId,
      commandId: input.commandId,
      correlationId: input.correlationId,
      acceptedPolicyContextId: input.scope.acceptedPolicyContextId,
      acceptedPolicyBinding: input.scope.acceptedPolicyBinding,
      createdAt: input.createdAt,
    });
    const snapshot = await this.getSubmission(input.scope, input.submissionId);
    if (!snapshot) throw this.notFound();
    return snapshot;
  }

  private referenceForArtifact(artifact: SubmitSourcesProductInput['items'][number]): string {
    const value = artifact as SubmitSourcesProductInput['items'][number] & {
      readonly stagingReference?: string;
    };
    if (!value.stagingReference) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Resolved staging artifact is missing its sealed reference.',
        module: 'frontend-sources-write-postgres',
        operation: 'persist-staging-reference',
      });
    }
    return value.stagingReference;
  }

  private async insertItemAndAttempt(
    client: PoolClient,
    input: SubmitSourcesProductInput,
    artifact: SubmitSourcesProductInput['items'][number],
    itemId: string,
    attemptId: string,
    ordinal: number,
    manifest: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO source_product.intake_submission_items (
         submission_item_id, project_id, submission_id, client_item_id, ordinal,
         input_kind, label, input_manifest, state, validation_results,
         content_hash, media_type, size_bytes, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'RUNNING', $9::jsonb,
                 $10, $11, $12, $13, $13)`,
      [
        itemId,
        input.scope.projectId,
        input.submissionId,
        artifact.itemId,
        ordinal,
        artifact.kind,
        artifact.label,
        JSON.stringify({ ...manifest, draftId: input.draftId }),
        JSON.stringify([
          { code: 'VALID', valid: true, message: 'Server staging validation passed.' },
        ]),
        artifact.contentHash,
        artifact.mediaType,
        artifact.sizeBytes,
        input.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO source_product.intake_attempts (
         intake_attempt_id, project_id, submission_id, submission_item_id,
         command_id, attempt_number, attempt_kind, state, correlation_id,
         accepted_policy_context_id, accepted_policy_binding, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 1, 'SUBMIT', 'RUNNING', $6, $7, $8::jsonb, $9, $9)`,
      [
        attemptId,
        input.scope.projectId,
        input.submissionId,
        itemId,
        input.commandId,
        input.correlationId,
        input.scope.acceptedPolicyContextId,
        JSON.stringify(input.scope.acceptedPolicyBinding),
        input.createdAt,
      ],
    );
  }

  private async createDuplicateDecision(
    client: PoolClient,
    input: SubmitSourcesProductInput,
    artifact: SubmitSourcesProductInput['items'][number],
    itemId: string,
    attemptId: string,
    duplicate: DuplicateRecord,
    security: SourcesResourceSecurityMetadata,
  ): Promise<void> {
    const decisionId = randomUUID();
    await client.query(
      `INSERT INTO source_product.exact_duplicate_decisions (
         decision_id, project_id, submission_id, submission_item_id,
         decision_revision, content_hash, existing_source_id,
         existing_source_version_id, allowed_dispositions,
         observed_source_revision, access_revision, policy_context_revision,
         supersedes_decision_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, NULL, $12)`,
      [
        decisionId,
        input.scope.projectId,
        input.submissionId,
        itemId,
        artifact.contentHash,
        duplicate.sourceId,
        duplicate.sourceVersionId,
        allowedDuplicateDispositions(duplicate.security, security),
        String(duplicate.versionNumber),
        input.scope.accessRevision,
        input.scope.policyContextRevision,
        input.createdAt,
      ],
    );
    await client.query(
      `UPDATE source_product.intake_submission_items
       SET active_duplicate_decision_id = $2, state = 'ACTION_REQUIRED',
           attention_reason = 'An exact-content match requires an explicit disposition.'
       WHERE submission_item_id = $1`,
      [itemId, decisionId],
    );
    await client.query(
      `UPDATE source_product.intake_attempts SET state = 'SUCCEEDED', completed_at = $2
       WHERE intake_attempt_id = $1`,
      [attemptId, input.createdAt],
    );
  }

  private async createRetryDuplicateDecision(
    client: PoolClient,
    input: RetrySourcesProductInput,
    artifact: SubmitSourcesProductInput['items'][number],
    itemId: string,
    attemptId: string,
    duplicate: DuplicateRecord,
    security: SourcesResourceSecurityMetadata,
  ): Promise<void> {
    const previous = await client.query<{ decision_id: string; decision_revision: string }>(
      `SELECT decision_id::text, decision_revision::text
       FROM source_product.exact_duplicate_decisions
       WHERE submission_item_id = $1
       ORDER BY decision_revision DESC LIMIT 1 FOR UPDATE`,
      [itemId],
    );
    const revision = Number(previous.rows[0]?.decision_revision ?? 0) + 1;
    const decisionId = randomUUID();
    await client.query(
      `INSERT INTO source_product.exact_duplicate_decisions (
         decision_id, project_id, submission_id, submission_item_id,
         decision_revision, content_hash, existing_source_id,
         existing_source_version_id, allowed_dispositions,
         observed_source_revision, access_revision, policy_context_revision,
         supersedes_decision_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        decisionId,
        input.scope.projectId,
        input.submissionId,
        itemId,
        revision,
        artifact.contentHash,
        duplicate.sourceId,
        duplicate.sourceVersionId,
        allowedDuplicateDispositions(duplicate.security, security),
        String(duplicate.versionNumber),
        input.scope.accessRevision,
        input.scope.policyContextRevision,
        previous.rows[0]?.decision_id ?? null,
        input.createdAt,
      ],
    );
    await client.query(
      `UPDATE source_product.intake_submission_items
       SET active_duplicate_decision_id = $2, state = 'ACTION_REQUIRED',
           attention_reason = 'An exact-content match requires an explicit disposition.'
       WHERE submission_item_id = $1`,
      [itemId, decisionId],
    );
    await client.query(
      `UPDATE source_product.intake_attempts SET state = 'SUCCEEDED', completed_at = $2
       WHERE intake_attempt_id = $1`,
      [attemptId, input.createdAt],
    );
  }

  private async findDuplicate(
    client: PoolClient,
    projectId: string,
    contentHash: string,
    requestedSecurity: SourcesResourceSecurityMetadata,
  ): Promise<DuplicateRecord | undefined> {
    const result = await client.query<{
      source_id: string;
      source_version_id: string;
      version_number: number;
      original_asset_id: string;
      access_scope: string[];
      sensitivity: SourcesResourceSecurityMetadata['sensitivity'];
    }>(
      `SELECT source.source_id::text, version.source_version_id::text,
              version.version_number, version.original_asset_id::text,
              version.access_scope, version.sensitivity
       FROM asset.original_assets AS original
       JOIN asset.source_versions AS version ON version.original_asset_id = original.asset_id
       JOIN asset.sources AS source ON source.source_id = version.source_id
       WHERE source.project_id = $1 AND original.content_hash = $2
       ORDER BY (version.sensitivity = $3 AND version.access_scope = $4::text[]) DESC,
                version.created_at, version.source_version_id
       LIMIT 1`,
      [projectId, contentHash, requestedSecurity.sensitivity, requestedSecurity.accessScope],
    );
    const row = result.rows[0];
    return row
      ? {
          sourceId: row.source_id,
          sourceVersionId: row.source_version_id,
          versionNumber: row.version_number,
          originalAssetId: row.original_asset_id,
          security: { sensitivity: row.sensitivity, accessScope: row.access_scope },
        }
      : undefined;
  }

  private async materialize(
    client: PoolClient,
    scope: SourcesProductWriteScope,
    submissionId: string,
    itemId: string,
    attemptId: string,
    item: SourcesIntakeStoredItemInput,
    security: SourcesResourceSecurityMetadata,
    createdAt: string,
    forceNewVersion = false,
  ): Promise<{ readonly sourceId: string; readonly sourceVersionId: string }> {
    const recovered = await this.recoverExistingStage2(client, scope.projectId, itemId);
    if (recovered) {
      await this.finishItem(
        client,
        itemId,
        attemptId,
        recovered.sourceId,
        recovered.sourceVersionId,
        createdAt,
      );
      await this.ensureStage3Progress(
        client,
        scope.projectId,
        recovered.sourceId,
        recovered.sourceVersionId,
        createdAt,
      );
      return { sourceId: recovered.sourceId, sourceVersionId: recovered.sourceVersionId };
    }
    await this.insertStage2Submission(client, scope, itemId, item, security, createdAt);
    const assetInsert = await client.query<{ asset_id: string }>(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (content_hash) DO NOTHING RETURNING asset_id::text`,
      [randomUUID(), item.contentHash, item.sizeBytes, item.storageKey, createdAt],
    );
    const assetReused = assetInsert.rowCount === 0;
    const asset = await client.query<{ asset_id: string }>(
      'SELECT asset_id::text FROM asset.original_assets WHERE content_hash = $1',
      [item.contentHash],
    );
    const originalAssetId = asset.rows[0]?.asset_id;
    if (!originalAssetId) throw new Error('Original Asset was not resolved.');
    const sourceId = await this.resolveOrCreateSource(
      client,
      scope,
      item.requestedSourceId,
      createdAt,
    );
    let sourceVersionId: string | undefined;
    let versionNumber: number | undefined;
    if (!forceNewVersion) {
      const existing = await client.query<{ source_version_id: string; version_number: number }>(
        `SELECT source_version_id::text, version_number
         FROM asset.source_versions WHERE source_id = $1 AND original_asset_id = $2
         ORDER BY version_number LIMIT 1`,
        [sourceId, originalAssetId],
      );
      sourceVersionId = existing.rows[0]?.source_version_id;
      versionNumber = existing.rows[0]?.version_number;
    }
    const versionCreated = sourceVersionId === undefined;
    if (!sourceVersionId || versionNumber === undefined) {
      const next = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM asset.source_versions WHERE source_id = $1`,
        [sourceId],
      );
      sourceVersionId = randomUUID();
      versionNumber = Number(next.rows[0]?.next_version ?? 1);
      await client.query(
        `INSERT INTO asset.source_versions (
           source_version_id, source_id, version_number, original_asset_id,
           media_type, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sourceVersionId,
          sourceId,
          versionNumber,
          originalAssetId,
          item.mediaType,
          security.accessScope,
          security.sensitivity,
          createdAt,
        ],
      );
    }
    await this.insertStorageReceipt(
      client,
      scope.projectId,
      itemId,
      sourceVersionId,
      item,
      assetReused,
      versionCreated,
      createdAt,
    );
    if (item.urlProvenance) {
      await this.insertUrlReceipt(
        client,
        scope,
        submissionId,
        itemId,
        attemptId,
        item,
        originalAssetId,
        sourceVersionId,
        createdAt,
      );
    }
    await this.finishItem(client, itemId, attemptId, sourceId, sourceVersionId, createdAt);
    await this.ensureStage3Progress(client, scope.projectId, sourceId, sourceVersionId, createdAt);
    return { sourceId, sourceVersionId };
  }

  private async reuseExistingVersion(
    client: PoolClient,
    scope: SourcesProductWriteScope,
    itemId: string,
    attemptId: string,
    artifact: SubmitSourcesProductInput['items'][number],
    security: SourcesResourceSecurityMetadata,
    sourceId: string,
    sourceVersionId: string,
    createdAt: string,
  ): Promise<void> {
    const version = await client.query<{
      original_asset_id: string;
      access_scope: string[];
      sensitivity: SourcesResourceSecurityMetadata['sensitivity'];
    }>(
      `SELECT original_asset_id::text, access_scope, sensitivity FROM asset.source_versions
       WHERE source_id = $1 AND source_version_id = $2`,
      [sourceId, sourceVersionId],
    );
    const existing = version.rows[0];
    if (!existing) throw this.notFound();
    if (
      !sourceSecurityMetadataEqual(
        { sensitivity: existing.sensitivity, accessScope: existing.access_scope },
        security,
      )
    ) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'The existing SourceVersion has incompatible security metadata.',
        module: 'frontend-sources-write-postgres',
        operation: 'reuse-existing-version',
      });
    }
    const item = storedItem(artifact, sourceId);
    await this.insertStage2Submission(client, scope, itemId, item, security, createdAt);
    await this.insertStorageReceipt(
      client,
      scope.projectId,
      itemId,
      sourceVersionId,
      item,
      true,
      false,
      createdAt,
    );
    if (item.urlProvenance) {
      await this.insertUrlReceipt(
        client,
        scope,
        '',
        itemId,
        attemptId,
        item,
        existing.original_asset_id,
        sourceVersionId,
        createdAt,
      );
    }
    await this.finishItem(client, itemId, attemptId, sourceId, sourceVersionId, createdAt);
    await this.ensureStage3Progress(client, scope.projectId, sourceId, sourceVersionId, createdAt);
  }

  private async markStage3ItemsSucceeded(submissionId: string): Promise<void> {
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      await client.query(
        `UPDATE source_product.intake_submission_items AS item
            SET state = 'SUCCEEDED', safe_failure_code = NULL,
                safe_failure_message = NULL, safe_failure_retryable = NULL
          WHERE item.submission_id = $1
            AND item.state IN ('OUTCOME_INDETERMINATE', 'RUNNING')
            AND item.produced_source_version_id IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM source_product.source_stage3_progress AS progress
               WHERE progress.project_id = item.project_id
                 AND progress.source_version_id = item.produced_source_version_id
                 AND progress.state IN ('STAGE3_COMPLETED', 'NO_EVIDENCE')
            )`,
        [submissionId],
      );
      await client.query(
        `UPDATE source_product.intake_attempts AS attempt
            SET state = 'SUCCEEDED', completed_at = clock_timestamp()
          WHERE attempt.submission_id = $1
            AND attempt.state = 'RUNNING'
            AND EXISTS (
              SELECT 1
                FROM source_product.intake_submission_items AS item
                JOIN source_product.source_stage3_progress AS progress
                  ON progress.project_id = item.project_id
                 AND progress.source_version_id = item.produced_source_version_id
               WHERE item.submission_item_id = attempt.submission_item_id
                 AND progress.state IN ('STAGE3_COMPLETED', 'NO_EVIDENCE')
            )`,
        [submissionId],
      );
      await client.query('COMMIT');
      transactionActive = false;
    } catch (error) {
      if (transactionActive) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureStage3Progress(
    client: PoolClient,
    projectId: string,
    sourceId: string,
    sourceVersionId: string,
    createdAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO source_product.source_stage3_progress (
         project_id, source_id, source_version_id, state, created_at, updated_at
       ) VALUES ($1, $2, $3, 'MATERIALIZED', $4, $4)
       ON CONFLICT (project_id, source_version_id) DO NOTHING`,
      [projectId, sourceId, sourceVersionId, createdAt],
    );
  }

  private async insertStage2Submission(
    client: PoolClient,
    scope: SourcesProductWriteScope,
    itemId: string,
    item: SourcesIntakeStoredItemInput,
    security: SourcesResourceSecurityMetadata,
    createdAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO intake.submissions (
         submission_key, submission_id, project_id, actor_id, requested_source_id,
         channel, material_kind, media_type, original_file_name, content_hash,
         size_bytes, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'plain_text', $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        itemId,
        scope.projectId,
        scope.principalId,
        item.requestedSourceId ?? null,
        item.channel,
        item.mediaType,
        item.originalFileName ?? null,
        item.contentHash,
        item.sizeBytes,
        security.accessScope,
        security.sensitivity,
        createdAt,
      ],
    );
  }

  private async insertStorageReceipt(
    client: PoolClient,
    projectId: string,
    itemId: string,
    sourceVersionId: string,
    item: SourcesIntakeStoredItemInput,
    assetReused: boolean,
    versionCreated: boolean,
    createdAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO asset.storage_receipts (
         receipt_id, submission_id, project_id, source_version_id, channel,
         material_kind, original_file_name, asset_reused, version_created, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'plain_text', $6, $7, $8, $9)`,
      [
        randomUUID(),
        itemId,
        projectId,
        sourceVersionId,
        item.channel,
        item.originalFileName ?? null,
        assetReused,
        versionCreated,
        createdAt,
      ],
    );
  }

  private async insertUrlReceipt(
    client: PoolClient,
    scope: SourcesProductWriteScope,
    submissionId: string,
    itemId: string,
    attemptId: string,
    item: SourcesIntakeStoredItemInput,
    originalAssetId: string,
    sourceVersionId: string,
    createdAt: string,
  ): Promise<void> {
    const p = item.urlProvenance;
    if (!p) return;
    const actualSubmissionId =
      submissionId ||
      (
        await client.query<{ submission_id: string }>(
          `SELECT submission_id::text FROM source_product.intake_submission_items
           WHERE submission_item_id = $1`,
          [itemId],
        )
      ).rows[0]?.submission_id;
    if (!actualSubmissionId) throw new Error('URL Product Submission was not resolved.');
    const urlAttemptId = randomUUID();
    await client.query(
      `INSERT INTO source_product.url_acquisition_attempts (
         url_acquisition_attempt_id, project_id, submission_id, submission_item_id,
         intake_attempt_id, normalized_requested_url, redacted_requested_url,
         state, max_redirects, connect_timeout_ms, header_timeout_ms, body_timeout_ms,
         total_timeout_ms, max_compressed_bytes, max_decompressed_bytes,
         accepted_policy_context_id, policy_context_revision, retention_class,
         retention_expires_at, created_at, updated_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUCCEEDED', $8, $9, $10, $11,
                 $12, $13, $14, $15, $16, $17, $18, $19, $19, $19)`,
      [
        urlAttemptId,
        scope.projectId,
        actualSubmissionId,
        itemId,
        attemptId,
        p.normalizedRequestedUrl,
        p.redactedRequestedUrl,
        p.limits.maxRedirects,
        p.limits.connectTimeoutMs,
        p.limits.headerTimeoutMs,
        p.limits.bodyTimeoutMs,
        p.limits.totalTimeoutMs,
        p.limits.maxCompressedBytes,
        p.limits.maxDecompressedBytes,
        scope.acceptedPolicyContextId,
        scope.policyContextRevision,
        p.retentionClass,
        p.retentionExpiresAt ?? null,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO source_product.url_provenance_receipts (
         url_provenance_receipt_id, project_id, submission_id, submission_item_id,
         url_acquisition_attempt_id, outcome, redacted_requested_url,
         redacted_final_url, redirect_chain_digest, redirect_observations,
         dns_observations, response_status, response_content_type,
         response_content_length, compressed_bytes, decompressed_bytes,
         response_metadata, content_hash, original_asset_id, source_version_id,
         retention_class, retention_expires_at, retrieved_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'SUCCEEDED', $6, $7, $8, $9::jsonb,
                 $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb, $17,
                 $18, $19, $20, $21, $22, $23)`,
      [
        randomUUID(),
        scope.projectId,
        actualSubmissionId,
        itemId,
        urlAttemptId,
        p.redactedRequestedUrl,
        p.redactedFinalUrl,
        p.redirectChainDigest,
        JSON.stringify(p.redirectObservations),
        JSON.stringify(p.dnsObservations),
        p.responseStatus,
        p.responseContentType,
        p.responseContentLength ?? null,
        p.compressedBytes,
        p.decompressedBytes,
        JSON.stringify(p.responseMetadata),
        item.contentHash,
        originalAssetId,
        sourceVersionId,
        p.retentionClass,
        p.retentionExpiresAt ?? null,
        p.retrievedAt,
        createdAt,
      ],
    );
  }

  private async resolveOrCreateSource(
    client: PoolClient,
    scope: SourcesProductWriteScope,
    requestedSourceId: string | undefined,
    createdAt: string,
  ): Promise<string> {
    if (requestedSourceId) {
      const source = await client.query<{ source_id: string }>(
        `SELECT source_id::text FROM asset.sources
         WHERE project_id = $1 AND source_id = $2 FOR UPDATE`,
        [scope.projectId, requestedSourceId],
      );
      if (!source.rows[0]) throw this.notFound();
      return source.rows[0].source_id;
    }
    const sourceId = randomUUID();
    await client.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [sourceId, scope.projectId, scope.principalId, createdAt],
    );
    return sourceId;
  }

  private async finishItem(
    client: PoolClient,
    itemId: string,
    attemptId: string,
    sourceId: string,
    sourceVersionId: string,
    createdAt: string,
  ): Promise<void> {
    await client.query(
      `UPDATE source_product.intake_submission_items
       SET stage2_submission_id = submission_item_id::text,
           produced_source_id = $2, produced_source_version_id = $3,
           active_duplicate_decision_id = NULL, attention_reason = NULL,
           state = 'SUCCEEDED', completed_at = $4
       WHERE submission_item_id = $1`,
      [itemId, sourceId, sourceVersionId, createdAt],
    );
    await client.query(
      `UPDATE source_product.intake_attempts
       SET state = CASE WHEN state = 'ACCEPTED' THEN 'RUNNING' ELSE state END
       WHERE intake_attempt_id = $1`,
      [attemptId],
    );
    await client.query(
      `UPDATE source_product.intake_attempts
       SET state = 'SUCCEEDED', completed_at = $2 WHERE intake_attempt_id = $1`,
      [attemptId, createdAt],
    );
  }

  private async recoverExistingStage2(
    client: PoolClient,
    projectId: string,
    itemId: string,
  ): Promise<{ sourceId: string; sourceVersionId: string } | undefined> {
    const result = await client.query<{ source_id: string; source_version_id: string }>(
      `SELECT version.source_id::text, receipt.source_version_id::text
       FROM asset.storage_receipts AS receipt
       JOIN asset.source_versions AS version
         ON version.source_version_id = receipt.source_version_id
       WHERE receipt.project_id = $1 AND receipt.submission_id = $2`,
      [projectId, itemId],
    );
    const row = result.rows[0];
    return row ? { sourceId: row.source_id, sourceVersionId: row.source_version_id } : undefined;
  }

  private async createResolutionAttempt(
    client: PoolClient,
    input: ResolveSourcesDuplicateProductInput,
    submissionId: string,
    itemId: string,
  ): Promise<string> {
    const previous = await client.query<{ attempt_id: string; attempt_number: number }>(
      `SELECT intake_attempt_id::text AS attempt_id, attempt_number
       FROM source_product.intake_attempts
       WHERE submission_item_id = $1 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE`,
      [itemId],
    );
    const attemptId = randomUUID();
    await client.query(
      `INSERT INTO source_product.intake_attempts (
         intake_attempt_id, project_id, submission_id, submission_item_id,
         command_id, attempt_number, attempt_kind, state, correlation_id,
         causation_attempt_id, accepted_policy_context_id,
         accepted_policy_binding, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'RETRY_CURRENT_POLICY', 'RUNNING',
                 $7, $8, $9, $10::jsonb, $11, $11)`,
      [
        attemptId,
        input.scope.projectId,
        submissionId,
        itemId,
        input.commandId,
        Number(previous.rows[0]?.attempt_number ?? 0) + 1,
        input.correlationId,
        previous.rows[0]?.attempt_id ?? null,
        input.scope.acceptedPolicyContextId,
        JSON.stringify(input.scope.acceptedPolicyBinding),
        input.createdAt,
      ],
    );
    return attemptId;
  }

  private async recomputeSubmission(
    client: PoolClient,
    submissionId: string,
    createdAt: string,
  ): Promise<void> {
    const result = await client.query<{ state: IntakeSubmissionItemView['state']; count: string }>(
      `SELECT state, count(*)::text AS count
       FROM source_product.intake_submission_items
       WHERE submission_id = $1 GROUP BY state`,
      [submissionId],
    );
    const counts = new Map(result.rows.map((row) => [row.state, Number(row.count)]));
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const succeeded = counts.get('SUCCEEDED') ?? 0;
    const cancelled = counts.get('CANCELLED') ?? 0;
    const action = counts.get('ACTION_REQUIRED') ?? 0;
    const failed = counts.get('FAILED') ?? 0;
    let state: IntakeSubmissionSnapshot['state'];
    if (succeeded === total) state = 'SUCCEEDED';
    else if (cancelled === total) state = 'CANCELLED';
    else if (action > 0 && succeeded + cancelled + failed > 0) state = 'PARTIAL';
    else if (action > 0) state = 'ACTION_REQUIRED';
    else if (failed === total) state = 'FAILED';
    else if (failed > 0 || cancelled > 0) state = 'PARTIAL';
    else state = 'RUNNING';
    await client.query(
      `UPDATE source_product.intake_submissions
       SET state = $2,
           completed_at = CASE WHEN $2 IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
                               THEN $3::timestamptz ELSE NULL END
       WHERE submission_id = $1`,
      [submissionId, state, createdAt],
    );
  }

  private async assertAcceptedCommand(
    client: PoolClient,
    commandId: string,
    scope: SourcesProductWriteScope,
    commandType: string,
  ): Promise<void> {
    const result = await client.query<{
      principal_id: string;
      active_project_id: string | null;
      target_project_id: string | null;
      command_type: string;
      outcome_state: string;
      command_payload: unknown;
    }>(
      `SELECT principal_id::text, active_project_id, target_project_id,
              command_type, outcome_state, command_payload
       FROM frontend_command.command_ledger WHERE command_id = $1 FOR SHARE`,
      [commandId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.outcome_state !== 'ACCEPTED' ||
      row.command_type !== commandType ||
      row.principal_id !== scope.principalId ||
      row.active_project_id !== scope.projectId ||
      row.target_project_id !== scope.projectId
    ) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'The accepted Command does not match this Sources operation.',
        module: 'frontend-sources-write-postgres',
        operation: 'assert-product-command',
      });
    }
    assertSourcesLedgerManifestSafe(row.command_payload);
  }

  private publicItem(
    scope: SourcesProductWriteScope,
    item: ProductItemRow,
  ): IntakeSubmissionItemView {
    const base = {
      itemId: item.submission_item_id,
      label: item.label,
      sizeBytes: Number(item.size_bytes ?? 0),
      ...(item.content_hash === null ? {} : { contentHash: item.content_hash }),
    };
    const manifest =
      item.input_kind === 'DIRECT_TEXT'
        ? {
            kind: 'DIRECT_TEXT' as const,
            ...base,
            mediaType: 'text/plain' as const,
          }
        : item.input_kind === 'FILE'
          ? {
              kind: 'FILE' as const,
              ...base,
              fileName: String(item.input_manifest['fileName'] ?? item.label),
              mediaType: String(item.media_type ?? 'text/plain'),
            }
          : {
              kind: 'URL' as const,
              ...base,
              requestedUrl: String(
                item.input_manifest['requestedUrl'] ?? 'https://redacted.invalid/',
              ),
              ...(item.media_type === null ? {} : { mediaType: item.media_type }),
            };
    const validation = Array.isArray(item.validation_results)
      ? (item.validation_results as IntakeSubmissionItemView['validation'])
      : [];
    return {
      itemId: item.submission_item_id,
      manifest,
      state: item.state,
      validation,
      ...(item.produced_source_id === null ||
      item.produced_source_version_id === null ||
      item.version_number === null
        ? {}
        : {
            producedResource: {
              sourceId: item.produced_source_id,
              sourceVersionId: item.produced_source_version_id,
              projectId: scope.projectId,
              versionNumber: item.version_number,
            },
          }),
      ...(item.active_duplicate_decision_id === null
        ? {}
        : { duplicateDecisionId: item.active_duplicate_decision_id }),
      ...(item.safe_failure_code === null ||
      item.safe_failure_message === null ||
      item.safe_failure_retryable === null
        ? {}
        : {
            safeFailure: {
              code: item.safe_failure_code,
              message: item.safe_failure_message,
              retryable: item.safe_failure_retryable,
            },
          }),
      capabilities: inputCapabilities(item.state),
      ...(item.attention_reason === null ? {} : { attentionReason: item.attention_reason }),
    };
  }

  private notFound(): ShotgunError {
    return new ShotgunError({
      code: 'NOT_FOUND',
      safeMessage: 'The requested Sources resource was not found.',
      module: 'frontend-sources-write-postgres',
      operation: 'read-product-resource',
    });
  }
}
