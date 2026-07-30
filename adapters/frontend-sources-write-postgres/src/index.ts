import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  CreateExactDuplicateDecisionInput,
  CreateSourcesIntakeSubmissionInput,
  ExactDuplicateDecisionResult,
  ResolveExactDuplicateDecisionInput,
  SourcesIntakeStoredItemInput,
  SourcesIntakeStoredItemResult,
  SourcesIntakeSubmissionResult,
  SourcesIntakeUnitOfWorkPort,
} from '../../../modules/frontend-sources-write/src/index.js';

type CommandRow = QueryResultRow & {
  readonly command_id: string;
  readonly principal_id: string;
  readonly active_project_id: string | null;
  readonly target_project_id: string | null;
  readonly command_type: string;
  readonly outcome_state: string;
  readonly command_payload: unknown;
};

type ExistingSubmissionRow = QueryResultRow & {
  readonly submission_id: string;
  readonly project_id: string;
  readonly submission_revision: string;
};

type StoredItemRow = QueryResultRow & {
  readonly submission_item_id: string;
  readonly client_item_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly version_number: number;
  readonly original_asset_id: string;
  readonly asset_reused: boolean;
  readonly version_created: boolean;
};

const forbiddenPayloadKeys = new Set([
  'authorization',
  'bytes',
  'contentbase64',
  'cookie',
  'filebytes',
  'filepath',
  'localpath',
  'proxy-authorization',
  'rawtext',
  'text',
]);

const assertSafeLedgerManifest = (value: unknown, path = 'payload'): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeLedgerManifest(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPayloadKeys.has(key.toLocaleLowerCase())) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: `Frontend Command Ledger payload contains forbidden raw-input field '${path}.${key}'.`,
        module: 'frontend-sources-write-postgres',
        operation: 'assert-safe-ledger-manifest',
      });
    }
    assertSafeLedgerManifest(child, `${path}.${key}`);
  }
};

const assertItemContract = (item: SourcesIntakeStoredItemInput): void => {
  const expectedChannel = {
    DIRECT_TEXT: 'direct_text',
    FILE: 'file_upload',
    URL: 'url_acquisition',
  } as const;
  if (item.channel !== expectedChannel[item.inputKind]) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Sources Item kind and Stage 2 channel do not match.',
      module: 'frontend-sources-write-postgres',
      operation: 'validate-item-channel',
    });
  }
  if (item.sizeBytes <= 0 || item.sizeBytes > 1_048_576) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Sources Item exceeds the approved one MiB boundary.',
      module: 'frontend-sources-write-postgres',
      operation: 'validate-item-size',
    });
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(item.contentHash)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Sources Item content hash is invalid.',
      module: 'frontend-sources-write-postgres',
      operation: 'validate-item-hash',
    });
  }
  if (item.inputKind === 'URL' && !item.urlProvenance) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'A successful URL Item requires safe provenance.',
      module: 'frontend-sources-write-postgres',
      operation: 'validate-url-provenance',
    });
  }
  if (item.inputKind !== 'URL' && item.urlProvenance) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Only URL Items may provide URL provenance.',
      module: 'frontend-sources-write-postgres',
      operation: 'validate-url-provenance',
    });
  }
  assertSafeLedgerManifest(item.inputManifest, 'inputManifest');
};

export class PostgresSourcesIntakeUnitOfWork implements SourcesIntakeUnitOfWorkPort {
  constructor(private readonly pool: Pool) {}

  async createSubmission(
    input: CreateSourcesIntakeSubmissionInput,
  ): Promise<SourcesIntakeSubmissionResult> {
    if (input.items.length === 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'A Sources submission requires at least one Item.',
        module: 'frontend-sources-write-postgres',
        operation: 'create-submission',
      });
    }

    input.items.forEach(assertItemContract);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.projectId}:${input.submissionId}`,
      ]);

      const replay = await client.query<ExistingSubmissionRow>(
        `SELECT submission_id::text, project_id, submission_revision::text
         FROM source_product.intake_submissions
         WHERE create_command_id = $1
         FOR UPDATE`,
        [input.createCommandId],
      );
      if (replay.rows[0]) {
        const result = await this.loadSubmissionResult(client, replay.rows[0], true);
        await client.query('COMMIT');
        return result;
      }

      const command = await this.assertAcceptedCommand(
        client,
        input.createCommandId,
        input.principalId,
        input.projectId,
        'sources.intake.submit.v1',
      );
      assertSafeLedgerManifest(command.command_payload);

      await client.query(
        `INSERT INTO source_product.intake_submissions (
           submission_id, project_id, principal_id, session_id, create_command_id,
           state, origin_kind, accepted_policy_context_id, accepted_policy_binding,
           access_revision, policy_context_revision, submission_revision,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'RUNNING', 'NATIVE', $6, $7::jsonb,
           $8, $9, 1, $10, $10
         )`,
        [
          input.submissionId,
          input.projectId,
          input.principalId,
          input.sessionId,
          input.createCommandId,
          input.acceptedPolicyContextId,
          JSON.stringify(input.acceptedPolicyBinding),
          input.accessRevision,
          input.policyContextRevision,
          input.createdAt,
        ],
      );

      const results: SourcesIntakeStoredItemResult[] = [];
      for (const [ordinal, item] of input.items.entries()) {
        results.push(await this.storeItem(client, input, item, ordinal));
      }

      const completed = await client.query<{ submission_revision: string }>(
        `UPDATE source_product.intake_submissions
         SET state = 'SUCCEEDED', completed_at = $2
         WHERE submission_id = $1
         RETURNING submission_revision::text`,
        [input.submissionId, input.createdAt],
      );
      const submissionRevision = completed.rows[0]?.submission_revision;
      if (!submissionRevision) {
        throw new Error('Sources submission did not complete.');
      }

      await client.query('COMMIT');
      return {
        submissionId: input.submissionId,
        projectId: input.projectId,
        submissionRevision,
        replayed: false,
        items: results,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createExactDuplicateDecision(
    input: CreateExactDuplicateDecisionInput,
  ): Promise<ExactDuplicateDecisionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.projectId}:${input.submissionId}`,
      ]);
      const item = await client.query<{
        content_hash: string | null;
        active_duplicate_decision_id: string | null;
      }>(
        `SELECT content_hash, active_duplicate_decision_id::text
         FROM source_product.intake_submission_items
         WHERE project_id = $1
           AND submission_id = $2
           AND submission_item_id = $3
         FOR UPDATE`,
        [input.projectId, input.submissionId, input.submissionItemId],
      );
      const row = item.rows[0];
      if (!row || row.content_hash !== input.contentHash) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The Sources Item changed before duplicate evaluation.',
          module: 'frontend-sources-write-postgres',
          operation: 'create-duplicate-decision',
        });
      }

      const previous = await client.query<{
        decision_id: string;
        decision_revision: string;
      }>(
        `SELECT decision_id::text, decision_revision::text
         FROM source_product.exact_duplicate_decisions
         WHERE submission_item_id = $1
         ORDER BY decision_revision DESC
         LIMIT 1
         FOR UPDATE`,
        [input.submissionItemId],
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
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14
         )`,
        [
          decisionId,
          input.projectId,
          input.submissionId,
          input.submissionItemId,
          revision,
          input.contentHash,
          input.existingSourceId,
          input.existingSourceVersionId,
          input.allowedDispositions,
          input.observedSourceRevision,
          input.accessRevision,
          input.policyContextRevision,
          previous.rows[0]?.decision_id ?? null,
          input.createdAt,
        ],
      );
      await client.query(
        `UPDATE source_product.intake_submission_items
         SET active_duplicate_decision_id = $2,
             state = 'ACTION_REQUIRED'
         WHERE submission_item_id = $1`,
        [input.submissionItemId, decisionId],
      );
      await client.query('COMMIT');
      return { decisionId, decisionRevision: String(revision) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveExactDuplicateDecision(
    input: ResolveExactDuplicateDecisionInput,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.projectId}:${input.submissionId}`,
      ]);
      await this.assertAcceptedCommand(
        client,
        input.commandId,
        undefined,
        input.projectId,
        'sources.duplicate.resolve.v1',
      );
      await client.query(
        `INSERT INTO source_product.exact_duplicate_dispositions (
           disposition_id, project_id, submission_id, submission_item_id,
           decision_id, observed_decision_revision, command_id, disposition,
           target_source_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          input.projectId,
          input.submissionId,
          input.submissionItemId,
          input.decisionId,
          Number(input.observedDecisionRevision),
          input.commandId,
          input.disposition,
          input.targetSourceId ?? null,
          input.createdAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async storeItem(
    client: PoolClient,
    submission: CreateSourcesIntakeSubmissionInput,
    item: SourcesIntakeStoredItemInput,
    ordinal: number,
  ): Promise<SourcesIntakeStoredItemResult> {
    const submissionItemId = randomUUID();
    const intakeAttemptId = randomUUID();
    const stage2SubmissionId = submissionItemId;

    await client.query(
      `INSERT INTO source_product.intake_submission_items (
         submission_item_id, project_id, submission_id, client_item_id,
         ordinal, input_kind, label, input_manifest, state,
         validation_results, content_hash, media_type, size_bytes,
         item_revision, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'RUNNING',
         '[]'::jsonb, $9, $10, $11, 1, $12, $12
       )`,
      [
        submissionItemId,
        submission.projectId,
        submission.submissionId,
        item.clientItemId,
        ordinal,
        item.inputKind,
        item.label,
        JSON.stringify(item.inputManifest),
        item.contentHash,
        item.mediaType,
        item.sizeBytes,
        submission.createdAt,
      ],
    );

    await client.query(
      `INSERT INTO source_product.intake_attempts (
         intake_attempt_id, project_id, submission_id, submission_item_id,
         command_id, attempt_number, attempt_kind, state, correlation_id,
         causation_attempt_id, accepted_policy_context_id,
         accepted_policy_binding, attempt_revision, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, 1, 'SUBMIT', 'RUNNING', $6,
         NULL, $7, $8::jsonb, 1, $9, $9
       )`,
      [
        intakeAttemptId,
        submission.projectId,
        submission.submissionId,
        submissionItemId,
        submission.createCommandId,
        submission.correlationId,
        submission.acceptedPolicyContextId,
        JSON.stringify(submission.acceptedPolicyBinding),
        submission.createdAt,
      ],
    );

    await client.query(
      `INSERT INTO intake.submissions (
         submission_key, submission_id, project_id, actor_id,
         requested_source_id, channel, material_kind, media_type,
         original_file_name, content_hash, size_bytes, access_scope,
         sensitivity, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'plain_text', $7,
         $8, $9, $10, $11, $12, $13
       )`,
      [
        randomUUID(),
        stage2SubmissionId,
        submission.projectId,
        submission.principalId,
        item.requestedSourceId ?? null,
        item.channel,
        item.mediaType,
        item.originalFileName ?? null,
        item.contentHash,
        item.sizeBytes,
        submission.accessScope,
        submission.sensitivity,
        submission.createdAt,
      ],
    );

    const insertedAsset = await client.query<{ asset_id: string }>(
      `INSERT INTO asset.original_assets (
         asset_id, content_hash, size_bytes, storage_key, created_at
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING asset_id::text`,
      [randomUUID(), item.contentHash, item.sizeBytes, item.storageKey, submission.createdAt],
    );
    const assetReused = insertedAsset.rowCount === 0;
    const asset = await client.query<{ asset_id: string }>(
      `SELECT asset_id::text
       FROM asset.original_assets
       WHERE content_hash = $1`,
      [item.contentHash],
    );
    const originalAssetId = asset.rows[0]?.asset_id;
    if (!originalAssetId) throw new Error('Original Asset was not resolved.');

    const sourceId = await this.resolveSource(client, submission, item.requestedSourceId);
    const existingVersion = await client.query<{
      source_version_id: string;
      version_number: number;
    }>(
      `SELECT source_version_id::text, version_number
       FROM asset.source_versions
       WHERE source_id = $1 AND original_asset_id = $2`,
      [sourceId, originalAssetId],
    );

    let sourceVersionId = existingVersion.rows[0]?.source_version_id;
    let versionNumber = existingVersion.rows[0]?.version_number;
    const versionCreated = sourceVersionId === undefined;
    if (!sourceVersionId || versionNumber === undefined) {
      const next = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM asset.source_versions
         WHERE source_id = $1`,
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
          submission.accessScope,
          submission.sensitivity,
          submission.createdAt,
        ],
      );
    }

    await client.query(
      `INSERT INTO asset.storage_receipts (
         receipt_id, submission_id, project_id, source_version_id,
         channel, material_kind, original_file_name, asset_reused,
         version_created, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'plain_text', $6, $7, $8, $9)`,
      [
        randomUUID(),
        stage2SubmissionId,
        submission.projectId,
        sourceVersionId,
        item.channel,
        item.originalFileName ?? null,
        assetReused,
        versionCreated,
        submission.createdAt,
      ],
    );

    await client.query(
      `UPDATE source_product.intake_submission_items
       SET stage2_submission_id = $2,
           produced_source_id = $3,
           produced_source_version_id = $4,
           state = 'SUCCEEDED',
           completed_at = $5
       WHERE submission_item_id = $1`,
      [
        submissionItemId,
        stage2SubmissionId,
        sourceId,
        sourceVersionId,
        submission.createdAt,
      ],
    );

    await client.query(
      `UPDATE source_product.intake_attempts
       SET state = 'SUCCEEDED', completed_at = $2
       WHERE intake_attempt_id = $1`,
      [intakeAttemptId, submission.createdAt],
    );

    if (item.urlProvenance) {
      await this.storeUrlProvenance(
        client,
        submission,
        item,
        submissionItemId,
        intakeAttemptId,
        originalAssetId,
        sourceVersionId,
      );
    }

    return {
      submissionItemId,
      clientItemId: item.clientItemId,
      sourceId,
      sourceVersionId,
      versionNumber,
      originalAssetId,
      assetReused,
      versionCreated,
    };
  }

  private async storeUrlProvenance(
    client: PoolClient,
    submission: CreateSourcesIntakeSubmissionInput,
    item: SourcesIntakeStoredItemInput,
    submissionItemId: string,
    intakeAttemptId: string,
    originalAssetId: string,
    sourceVersionId: string,
  ): Promise<void> {
    const provenance = item.urlProvenance;
    if (!provenance) return;
    const urlAttemptId = randomUUID();
    await client.query(
      `INSERT INTO source_product.url_acquisition_attempts (
         url_acquisition_attempt_id, project_id, submission_id,
         submission_item_id, intake_attempt_id, normalized_requested_url,
         redacted_requested_url, state, max_redirects, connect_timeout_ms,
         header_timeout_ms, body_timeout_ms, total_timeout_ms,
         max_compressed_bytes, max_decompressed_bytes,
         accepted_policy_context_id, policy_context_revision,
         retention_class, retention_expires_at, acquisition_revision,
         created_at, updated_at, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'SUCCEEDED', $8, $9,
         $10, $11, $12, $13, $14, $15, $16, $17, $18, 1, $19, $19, $19
       )`,
      [
        urlAttemptId,
        submission.projectId,
        submission.submissionId,
        submissionItemId,
        intakeAttemptId,
        provenance.normalizedRequestedUrl,
        provenance.redactedRequestedUrl,
        provenance.limits.maxRedirects,
        provenance.limits.connectTimeoutMs,
        provenance.limits.headerTimeoutMs,
        provenance.limits.bodyTimeoutMs,
        provenance.limits.totalTimeoutMs,
        provenance.limits.maxCompressedBytes,
        provenance.limits.maxDecompressedBytes,
        submission.acceptedPolicyContextId,
        submission.policyContextRevision,
        provenance.retentionClass,
        provenance.retentionExpiresAt ?? null,
        submission.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO source_product.url_provenance_receipts (
         url_provenance_receipt_id, project_id, submission_id,
         submission_item_id, url_acquisition_attempt_id, receipt_revision,
         outcome, redacted_requested_url, redacted_final_url,
         redirect_chain_digest, redirect_observations, dns_observations,
         response_status, response_content_type, response_content_length,
         compressed_bytes, decompressed_bytes, response_metadata,
         content_hash, original_asset_id, source_version_id, failure_code,
         retention_class, retention_expires_at, retrieved_at, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, 1, 'SUCCEEDED', $6, $7, $8,
         $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb,
         $17, $18, $19, NULL, $20, $21, $22, $23
       )`,
      [
        randomUUID(),
        submission.projectId,
        submission.submissionId,
        submissionItemId,
        urlAttemptId,
        provenance.redactedRequestedUrl,
        provenance.redactedFinalUrl,
        provenance.redirectChainDigest,
        JSON.stringify(provenance.redirectObservations),
        JSON.stringify(provenance.dnsObservations),
        provenance.responseStatus,
        provenance.responseContentType,
        provenance.responseContentLength ?? null,
        provenance.compressedBytes,
        provenance.decompressedBytes,
        JSON.stringify(provenance.responseMetadata),
        item.contentHash,
        originalAssetId,
        sourceVersionId,
        provenance.retentionClass,
        provenance.retentionExpiresAt ?? null,
        provenance.retrievedAt,
        submission.createdAt,
      ],
    );
  }

  private async resolveSource(
    client: PoolClient,
    submission: CreateSourcesIntakeSubmissionInput,
    requestedSourceId?: string,
  ): Promise<string> {
    if (requestedSourceId) {
      const source = await client.query<{ source_id: string }>(
        `SELECT source_id::text
         FROM asset.sources
         WHERE source_id = $1 AND project_id = $2
         FOR UPDATE`,
        [requestedSourceId, submission.projectId],
      );
      const sourceId = source.rows[0]?.source_id;
      if (!sourceId) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The requested Source is not available in this Project.',
          module: 'frontend-sources-write-postgres',
          operation: 'resolve-source',
        });
      }
      return sourceId;
    }
    const sourceId = randomUUID();
    await client.query(
      `INSERT INTO asset.sources (
         source_id, project_id, created_by_actor_id, created_at
       ) VALUES ($1, $2, $3, $4)`,
      [sourceId, submission.projectId, submission.principalId, submission.createdAt],
    );
    return sourceId;
  }

  private async assertAcceptedCommand(
    client: PoolClient,
    commandId: string,
    principalId: string | undefined,
    projectId: string,
    commandType: string,
  ): Promise<CommandRow> {
    const result = await client.query<CommandRow>(
      `SELECT command_id, principal_id::text, active_project_id,
              target_project_id, command_type, outcome_state, command_payload
       FROM frontend_command.command_ledger
       WHERE command_id = $1
       FOR SHARE`,
      [commandId],
    );
    const command = result.rows[0];
    if (
      !command ||
      command.outcome_state !== 'ACCEPTED' ||
      command.command_type !== commandType ||
      (principalId !== undefined && command.principal_id !== principalId) ||
      command.active_project_id !== projectId ||
      command.target_project_id !== projectId
    ) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'The accepted Frontend Command does not match this Sources operation.',
        module: 'frontend-sources-write-postgres',
        operation: 'assert-accepted-command',
      });
    }
    return command;
  }

  private async loadSubmissionResult(
    client: PoolClient,
    submission: ExistingSubmissionRow,
    replayed: boolean,
  ): Promise<SourcesIntakeSubmissionResult> {
    const items = await client.query<StoredItemRow>(
      `SELECT item.submission_item_id::text,
              item.client_item_id,
              item.produced_source_id::text AS source_id,
              item.produced_source_version_id::text AS source_version_id,
              version.version_number,
              version.original_asset_id::text,
              receipt.asset_reused,
              receipt.version_created
       FROM source_product.intake_submission_items AS item
       JOIN asset.source_versions AS version
         ON version.source_version_id = item.produced_source_version_id
       JOIN asset.storage_receipts AS receipt
         ON receipt.project_id = item.project_id
        AND receipt.submission_id = item.stage2_submission_id
       WHERE item.submission_id = $1
       ORDER BY item.ordinal`,
      [submission.submission_id],
    );
    return {
      submissionId: submission.submission_id,
      projectId: submission.project_id,
      submissionRevision: submission.submission_revision,
      replayed,
      items: items.rows.map((row) => ({
        submissionItemId: row.submission_item_id,
        clientItemId: row.client_item_id,
        sourceId: row.source_id,
        sourceVersionId: row.source_version_id,
        versionNumber: row.version_number,
        originalAssetId: row.original_asset_id,
        assetReused: row.asset_reused,
        versionCreated: row.version_created,
      })),
    };
  }
}
