import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

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
  command_id: string;
  principal_id: string;
  active_project_id: string | null;
  target_project_id: string | null;
  command_type: string;
  outcome_state: string;
  command_payload: unknown;
};

type StoredItemRow = QueryResultRow & {
  submission_item_id: string;
  client_item_id: string;
  source_id: string;
  source_version_id: string;
  version_number: number;
  original_asset_id: string;
  asset_reused: boolean;
  version_created: boolean;
};

const forbiddenKeys = new Set([
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

export const assertSourcesLedgerManifestSafe = (value: unknown, path = 'payload'): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSourcesLedgerManifestSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLocaleLowerCase())) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: `Frontend Command Ledger payload contains forbidden raw-input field '${path}.${key}'.`,
        module: 'frontend-sources-write-postgres',
        operation: 'assert-safe-ledger-manifest',
      });
    }
    assertSourcesLedgerManifestSafe(child, `${path}.${key}`);
  }
};

const validateItem = (item: SourcesIntakeStoredItemInput): void => {
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
  if ((item.inputKind === 'URL') !== Boolean(item.urlProvenance)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Successful URL Items require URL provenance and non-URL Items prohibit it.',
      module: 'frontend-sources-write-postgres',
      operation: 'validate-url-provenance',
    });
  }
  assertSourcesLedgerManifestSafe(item.inputManifest, 'inputManifest');
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
    input.items.forEach(validateItem);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.projectId}:${input.submissionId}`,
      ]);

      const replay = await client.query<{
        submission_id: string;
        project_id: string;
        submission_revision: string;
      }>(
        `SELECT submission_id::text, project_id, submission_revision::text
         FROM source_product.intake_submissions
         WHERE create_command_id = $1
         FOR UPDATE`,
        [input.createCommandId],
      );
      if (replay.rows[0]) {
        const result = await this.loadResult(client, replay.rows[0], true);
        await client.query('COMMIT');
        return result;
      }

      const command = await this.acceptedCommand(
        client,
        input.createCommandId,
        input.projectId,
        'sources.intake.submit.v1',
        input.principalId,
      );
      assertSourcesLedgerManifestSafe(command.command_payload);

      await client.query(
        `INSERT INTO source_product.intake_submissions (
           submission_id, project_id, principal_id, session_id, create_command_id,
           state, accepted_policy_context_id, accepted_policy_binding,
           access_revision, policy_context_revision, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7::jsonb, $8, $9, $10, $10)`,
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

      const items: SourcesIntakeStoredItemResult[] = [];
      for (const [ordinal, item] of input.items.entries()) {
        items.push(await this.storeItem(client, input, item, ordinal));
      }

      const completed = await client.query<{ submission_revision: string }>(
        `UPDATE source_product.intake_submissions
         SET state = 'SUCCEEDED', completed_at = $2
         WHERE submission_id = $1
         RETURNING submission_revision::text`,
        [input.submissionId, input.createdAt],
      );
      const submissionRevision = completed.rows[0]?.submission_revision;
      if (!submissionRevision) throw new Error('Sources submission did not complete.');
      await client.query('COMMIT');
      return {
        submissionId: input.submissionId,
        projectId: input.projectId,
        submissionRevision,
        replayed: false,
        items,
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
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.projectId}:${input.submissionId}`,
      ]);
      const item = await client.query<{ content_hash: string | null }>(
        `SELECT content_hash
         FROM source_product.intake_submission_items
         WHERE project_id = $1 AND submission_id = $2 AND submission_item_id = $3
         FOR UPDATE`,
        [input.projectId, input.submissionId, input.submissionItemId],
      );
      if (item.rows[0]?.content_hash !== input.contentHash) {
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
         ORDER BY decision_revision DESC LIMIT 1 FOR UPDATE`,
        [input.submissionItemId],
      );
      const decisionId = randomUUID();
      const revision = Number(previous.rows[0]?.decision_revision ?? 0) + 1;
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
         SET active_duplicate_decision_id = $2, state = 'ACTION_REQUIRED'
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

  async resolveExactDuplicateDecision(input: ResolveExactDuplicateDecisionInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.projectId}:${input.submissionId}`,
      ]);
      await this.acceptedCommand(
        client,
        input.commandId,
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
    await client.query(
      `INSERT INTO source_product.intake_submission_items (
         submission_item_id, project_id, submission_id, client_item_id, ordinal,
         input_kind, label, input_manifest, state, content_hash, media_type,
         size_bytes, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'RUNNING', $9, $10, $11, $12, $12)`,
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
         accepted_policy_context_id, accepted_policy_binding, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 1, 'SUBMIT', 'RUNNING', $6, $7, $8::jsonb, $9, $9)`,
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
         submission_key, submission_id, project_id, actor_id, requested_source_id,
         channel, material_kind, media_type, original_file_name, content_hash,
         size_bytes, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'plain_text', $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        submissionItemId,
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

    const assetInsert = await client.query<{ asset_id: string }>(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (content_hash) DO NOTHING RETURNING asset_id::text`,
      [randomUUID(), item.contentHash, item.sizeBytes, item.storageKey, submission.createdAt],
    );
    const assetReused = assetInsert.rowCount === 0;
    const asset = await client.query<{ asset_id: string }>(
      'SELECT asset_id::text FROM asset.original_assets WHERE content_hash = $1',
      [item.contentHash],
    );
    const originalAssetId = asset.rows[0]?.asset_id;
    if (!originalAssetId) throw new Error('Original Asset was not resolved.');

    const sourceId = await this.source(client, submission, item.requestedSourceId);
    const existing = await client.query<{ source_version_id: string; version_number: number }>(
      `SELECT source_version_id::text, version_number
       FROM asset.source_versions WHERE source_id = $1 AND original_asset_id = $2`,
      [sourceId, originalAssetId],
    );
    let sourceVersionId = existing.rows[0]?.source_version_id;
    let versionNumber = existing.rows[0]?.version_number;
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
          submission.accessScope,
          submission.sensitivity,
          submission.createdAt,
        ],
      );
    }
    await client.query(
      `INSERT INTO asset.storage_receipts (
         receipt_id, submission_id, project_id, source_version_id, channel,
         material_kind, original_file_name, asset_reused, version_created, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'plain_text', $6, $7, $8, $9)`,
      [
        randomUUID(),
        submissionItemId,
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
       SET stage2_submission_id = submission_item_id::text,
           produced_source_id = $2, produced_source_version_id = $3,
           state = 'SUCCEEDED', completed_at = $4
       WHERE submission_item_id = $1`,
      [submissionItemId, sourceId, sourceVersionId, submission.createdAt],
    );
    await client.query(
      `UPDATE source_product.intake_attempts
       SET state = 'SUCCEEDED', completed_at = $2 WHERE intake_attempt_id = $1`,
      [intakeAttemptId, submission.createdAt],
    );
    if (item.urlProvenance) {
      await this.urlReceipt(
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

  private async urlReceipt(
    client: PoolClient,
    submission: CreateSourcesIntakeSubmissionInput,
    item: SourcesIntakeStoredItemInput,
    submissionItemId: string,
    intakeAttemptId: string,
    originalAssetId: string,
    sourceVersionId: string,
  ): Promise<void> {
    const p = item.urlProvenance;
    if (!p) return;
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
        submission.projectId,
        submission.submissionId,
        submissionItemId,
        intakeAttemptId,
        p.normalizedRequestedUrl,
        p.redactedRequestedUrl,
        p.limits.maxRedirects,
        p.limits.connectTimeoutMs,
        p.limits.headerTimeoutMs,
        p.limits.bodyTimeoutMs,
        p.limits.totalTimeoutMs,
        p.limits.maxCompressedBytes,
        p.limits.maxDecompressedBytes,
        submission.acceptedPolicyContextId,
        submission.policyContextRevision,
        p.retentionClass,
        p.retentionExpiresAt ?? null,
        submission.createdAt,
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
        submission.projectId,
        submission.submissionId,
        submissionItemId,
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
        submission.createdAt,
      ],
    );
  }

  private async source(
    client: PoolClient,
    submission: CreateSourcesIntakeSubmissionInput,
    requestedSourceId?: string,
  ): Promise<string> {
    if (requestedSourceId) {
      const result = await client.query<{ source_id: string }>(
        `SELECT source_id::text FROM asset.sources
         WHERE source_id = $1 AND project_id = $2 FOR UPDATE`,
        [requestedSourceId, submission.projectId],
      );
      const sourceId = result.rows[0]?.source_id;
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
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [sourceId, submission.projectId, submission.principalId, submission.createdAt],
    );
    return sourceId;
  }

  private async acceptedCommand(
    client: PoolClient,
    commandId: string,
    projectId: string,
    commandType: string,
    principalId?: string,
  ): Promise<CommandRow> {
    const result = await client.query<CommandRow>(
      `SELECT command_id, principal_id::text, active_project_id, target_project_id,
              command_type, outcome_state, command_payload
       FROM frontend_command.command_ledger WHERE command_id = $1 FOR SHARE`,
      [commandId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.outcome_state !== 'ACCEPTED' ||
      row.command_type !== commandType ||
      (principalId !== undefined && row.principal_id !== principalId) ||
      row.active_project_id !== projectId ||
      row.target_project_id !== projectId
    ) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'The accepted Frontend Command does not match this Sources operation.',
        module: 'frontend-sources-write-postgres',
        operation: 'assert-accepted-command',
      });
    }
    return row;
  }

  private async loadResult(
    client: PoolClient,
    submission: { submission_id: string; project_id: string; submission_revision: string },
    replayed: boolean,
  ): Promise<SourcesIntakeSubmissionResult> {
    const items = await client.query<StoredItemRow>(
      `SELECT item.submission_item_id::text, item.client_item_id,
              item.produced_source_id::text AS source_id,
              item.produced_source_version_id::text AS source_version_id,
              version.version_number, version.original_asset_id::text,
              receipt.asset_reused, receipt.version_created
       FROM source_product.intake_submission_items AS item
       JOIN asset.source_versions AS version
         ON version.source_version_id = item.produced_source_version_id
       JOIN asset.storage_receipts AS receipt
         ON receipt.project_id = item.project_id
        AND receipt.submission_id = item.stage2_submission_id
       WHERE item.submission_id = $1 ORDER BY item.ordinal`,
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
