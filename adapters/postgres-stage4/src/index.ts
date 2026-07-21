import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  AIProviderCallRepositoryPort,
  ClaimedProviderAttempt,
  AIProviderExecutionRecord,
} from '../../../modules/ai-provider/src/index.js';
import type {
  CandidateBatch,
  CandidateRepositoryPort,
} from '../../../modules/candidate-generation/src/index.js';
import type { ValidationRepositoryPort } from '../../../modules/validation/src/index.js';
import {
  type AIProviderAttempt,
  type AIProviderCall,
  type AIProviderOutput,
  type ClaimCandidate,
  type ClaimCandidateStatus,
  type ErrorCode,
  stableJson,
  ShotgunError,
  type ValidationResult,
} from '../../../packages/contracts/src/index.js';

type ProviderCallRow = QueryResultRow & {
  readonly call_id: string;
  readonly project_id: string;
  readonly request_id: string;
  readonly provider: string;
  readonly model: string;
  readonly prompt_version: AIProviderCall['promptVersion'];
  readonly policy_version: AIProviderCall['policyVersion'];
  readonly schema_name: AIProviderCall['schemaName'];
  readonly data_classification: string;
  readonly input_evidence_ids: string[];
  readonly source_version_id: string | null;
  readonly access_scope: string[];
  readonly sensitivity: AIProviderExecutionRecord['sensitivity'];
  readonly input_snapshot_digest: string | null;
  readonly request_digest: string | null;
  readonly durable_state: AIProviderExecutionRecord['state'];
  readonly max_attempts: number;
  readonly status: AIProviderExecutionRecord['status'];
  readonly call_json: AIProviderCall | null;
  readonly created_at: Date;
};

type AttemptRow = QueryResultRow & {
  readonly attempt_id: string;
  readonly attempt_number: number;
  readonly status: AIProviderAttempt['status'];
  readonly error_code: AIProviderAttempt['errorCode'] | null;
  readonly provider_response_id: string | null;
  readonly latency_ms: number;
};

type OutputRow = QueryResultRow & {
  readonly output_id: string;
  readonly call_id: string;
  readonly attempt_id: string;
  readonly envelope_version: 'ai-provider-output-v1';
  readonly project_id: string;
  readonly provider: string;
  readonly adapter_version: string;
  readonly model: string;
  readonly schema_name: 'ClaimCandidateBatch.v1';
  readonly schema_version: '1.0.0';
  readonly prompt_version: 'direct-claim-v1';
  readonly policy_version: 'direct-only-v1';
  readonly data_policy_version: 'gemini-stateless-no-sharing-v1' | 'fake-local-v1';
  readonly output_text: string;
  readonly content_digest: string;
  readonly request_digest: string;
  readonly input_snapshot_digest: string;
  readonly provider_response_id: string | null;
  readonly model_version: string;
  readonly finish_reason: string | null;
  readonly usage_json: AIProviderOutput['usage'];
  readonly cost_json: AIProviderOutput['cost'];
  readonly structured_output_valid: boolean;
  readonly received_at: Date;
};

type BatchRow = QueryResultRow & {
  readonly batch_id: string;
  readonly project_id: string;
  readonly source_version_id: string;
  readonly idempotency_key: string;
  readonly provider_call: AIProviderCall;
  readonly created_at: Date;
};

type CandidateRow = QueryResultRow & {
  readonly candidate_id: string;
  readonly batch_id: string;
  readonly project_id: string;
  readonly source_version_id: string;
  readonly revision_number: 1;
  readonly claim_text: string;
  readonly evidence_id: string;
  readonly evidence_mode: 'DIRECT_EVIDENCE';
  readonly extraction_profile: 'direct-only';
  readonly status: ClaimCandidate['status'];
  readonly provider_call: AIProviderCall;
  readonly access_scope: string[];
  readonly sensitivity: ClaimCandidate['sensitivity'];
  readonly created_at: Date;
};

type ValidationRow = QueryResultRow & {
  readonly validation_id: string;
  readonly candidate_id: string;
  readonly revision_number: 1;
  readonly project_id: string;
  readonly source_version_id: string;
  readonly status: ValidationResult['status'];
  readonly dimensions: ValidationResult['dimensions'];
  readonly created_at: Date;
};

const mapAttempt = (row: AttemptRow): AIProviderAttempt => ({
  attemptId: row.attempt_id,
  attemptNumber: row.attempt_number,
  status: row.status,
  errorCode: row.error_code ?? undefined,
  providerResponseId: row.provider_response_id ?? undefined,
  latencyMs: row.latency_ms,
});

const mapOutput = (row: OutputRow): AIProviderOutput => ({
  outputId: row.output_id,
  projectId: row.project_id,
  callId: row.call_id,
  attemptId: row.attempt_id,
  envelopeVersion: row.envelope_version,
  provider: row.provider,
  adapterVersion: row.adapter_version,
  model: row.model,
  schemaName: row.schema_name,
  schemaVersion: row.schema_version,
  promptVersion: row.prompt_version,
  policyVersion: row.policy_version,
  dataPolicyVersion: row.data_policy_version,
  rawText: row.output_text,
  contentDigest: row.content_digest,
  requestDigest: row.request_digest,
  inputSnapshotDigest: row.input_snapshot_digest,
  providerResponseId: row.provider_response_id ?? undefined,
  modelVersion: row.model_version,
  finishReason: row.finish_reason ?? undefined,
  usage: row.usage_json,
  cost: row.cost_json,
  structuredOutputValid: row.structured_output_valid,
  receivedAt: row.received_at.toISOString(),
});

const mapCandidate = (row: CandidateRow): ClaimCandidate => ({
  candidateId: row.candidate_id,
  batchId: row.batch_id,
  revisionNumber: row.revision_number,
  projectId: row.project_id,
  sourceVersionId: row.source_version_id,
  claimText: row.claim_text,
  evidenceIds: [row.evidence_id],
  evidenceMode: row.evidence_mode,
  extractionProfile: row.extraction_profile,
  status: row.status,
  providerCall: row.provider_call,
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  createdAt: row.created_at.toISOString(),
});

const mapValidation = (row: ValidationRow): ValidationResult => ({
  validationId: row.validation_id,
  candidateId: row.candidate_id,
  revisionNumber: row.revision_number,
  projectId: row.project_id,
  sourceVersionId: row.source_version_id,
  status: row.status,
  dimensions: row.dimensions,
  createdAt: row.created_at.toISOString(),
});

const candidateSelect = `
  SELECT
    candidate_id::text,
    batch_id::text,
    project_id,
    source_version_id::text,
    revision_number,
    claim_text,
    evidence_id::text,
    evidence_mode,
    extraction_profile,
    status,
    provider_call,
    access_scope,
    sensitivity,
    created_at
  FROM candidate.claim_candidates
`;

const loadBatch = async (
  client: Pool | PoolClient,
  projectId: string,
  idempotencyKey: string,
): Promise<CandidateBatch | undefined> => {
  const batch = await client.query<BatchRow>(
    `
      SELECT
        batch_id::text,
        project_id,
        source_version_id::text,
        idempotency_key,
        provider_call,
        created_at
      FROM candidate.batches
      WHERE project_id = $1 AND idempotency_key = $2
    `,
    [projectId, idempotencyKey],
  );
  const row = batch.rows[0];
  if (!row) {
    return undefined;
  }
  const candidates = await client.query<CandidateRow>(
    `${candidateSelect} WHERE project_id = $1 AND batch_id = $2 ORDER BY created_at, candidate_id`,
    [projectId, row.batch_id],
  );
  return {
    batchId: row.batch_id,
    projectId: row.project_id,
    sourceVersionId: row.source_version_id,
    idempotencyKey: row.idempotency_key,
    providerCall: row.provider_call,
    candidates: candidates.rows.map(mapCandidate),
    createdAt: row.created_at.toISOString(),
  };
};

const loadProviderRecord = async (
  client: Pool | PoolClient,
  projectId: string,
  requestId: string,
  lock = false,
): Promise<AIProviderExecutionRecord | undefined> => {
  const result = await client.query<ProviderCallRow>(
    `SELECT call_id::text, project_id, request_id, provider, model, prompt_version, policy_version,
      schema_name, data_classification, ARRAY(SELECT value::text FROM unnest(input_evidence_ids) value) AS input_evidence_ids,
      source_version_id::text, access_scope, sensitivity, input_snapshot_digest, request_digest,
      durable_state, max_attempts, status, call_json, created_at
     FROM ai.provider_calls WHERE project_id = $1 AND request_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [projectId, requestId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const attempts = await client.query<AttemptRow>(
    `SELECT attempt_id::text, attempt_number, status, error_code, provider_response_id, latency_ms
     FROM ai.provider_attempts WHERE call_id = $1 ORDER BY attempt_number`,
    [row.call_id],
  );
  const output = await client.query<OutputRow>(
    `SELECT output_id::text, project_id, call_id::text, attempt_id::text, envelope_version, provider, adapter_version,
      model, schema_name, schema_version, prompt_version, policy_version, data_policy_version, output_text, content_digest,
      request_digest, input_snapshot_digest, provider_response_id, model_version, finish_reason, usage_json, cost_json,
      structured_output_valid, received_at
     FROM ai.provider_outputs WHERE output_id = (SELECT accepted_output_id FROM ai.provider_calls WHERE call_id = $1)`,
    [row.call_id],
  );
  return {
    callId: row.call_id,
    requestId: row.request_id,
    projectId: row.project_id,
    sourceVersionId: row.source_version_id ?? '',
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    policyVersion: row.policy_version,
    schemaName: row.schema_name,
    dataClassification: row.data_classification,
    accessScope: row.access_scope,
    sensitivity: row.sensitivity,
    inputEvidenceIds: row.input_evidence_ids,
    inputSnapshotDigest: row.input_snapshot_digest ?? '',
    requestDigest: row.request_digest ?? '',
    state: row.durable_state,
    status: row.status,
    maxAttempts: row.max_attempts,
    attempts: attempts.rows.map(mapAttempt),
    call: row.call_json ?? undefined,
    output: output.rows[0] ? mapOutput(output.rows[0]) : undefined,
    createdAt: row.created_at.toISOString(),
  };
};

export class PostgresAIProviderCallRepository implements AIProviderCallRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async ensure(record: AIProviderExecutionRecord): Promise<AIProviderExecutionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ai.provider_calls (call_id, project_id, request_id, provider, model, prompt_version, policy_version,
          schema_name, data_classification, input_evidence_ids, source_version_id, access_scope, sensitivity,
          input_snapshot_digest, request_digest, durable_state, max_attempts, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'REQUESTED',$16,'failed',$17,$17)
         ON CONFLICT (project_id, request_id) DO NOTHING`,
        [
          record.callId,
          record.projectId,
          record.requestId,
          record.provider,
          record.model,
          record.promptVersion,
          record.policyVersion,
          record.schemaName,
          record.dataClassification,
          record.inputEvidenceIds,
          record.sourceVersionId,
          record.accessScope,
          record.sensitivity,
          record.inputSnapshotDigest,
          record.requestDigest,
          record.maxAttempts,
          record.createdAt,
        ],
      );
      const stored = await loadProviderRecord(client, record.projectId, record.requestId, true);
      await client.query('COMMIT');
      if (!stored) throw new Error('AI Provider Call was not stored.');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByRequestId(
    projectId: string,
    requestId: string,
  ): Promise<AIProviderExecutionRecord | undefined> {
    return loadProviderRecord(this.pool, projectId, requestId);
  }

  async list(): Promise<readonly AIProviderExecutionRecord[]> {
    const rows = await this.pool.query<{ project_id: string; request_id: string }>(
      `SELECT project_id, request_id FROM ai.provider_calls ORDER BY created_at`,
    );
    return (
      await Promise.all(
        rows.rows.map(async (row) => await this.findByRequestId(row.project_id, row.request_id)),
      )
    ).filter((record): record is AIProviderExecutionRecord => record !== undefined);
  }

  async claimNextAttempt(
    projectId: string,
    requestId: string,
  ): Promise<ClaimedProviderAttempt | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await loadProviderRecord(client, projectId, requestId, true);
      if (
        !record ||
        !['REQUESTED', 'PROVIDER_FAILED'].includes(record.state) ||
        record.attempts.length >= record.maxAttempts
      ) {
        await client.query('COMMIT');
        return undefined;
      }
      const attempt: AIProviderAttempt = {
        attemptId: randomUUID(),
        attemptNumber: record.attempts.length + 1,
        status: 'running',
        latencyMs: 0,
      };
      await client.query(
        `INSERT INTO ai.provider_attempts (attempt_id, call_id, attempt_number, status, latency_ms, started_at, lease_expires_at)
         VALUES ($1,$2,$3,'running',0,now(),now() + interval '5 minutes')`,
        [attempt.attemptId, record.callId, attempt.attemptNumber],
      );
      await client.query(
        `UPDATE ai.provider_calls SET durable_state = 'PROVIDER_RUNNING', status = 'failed', updated_at = now() WHERE call_id = $1`,
        [record.callId],
      );
      const claimed = await loadProviderRecord(client, projectId, requestId);
      await client.query('COMMIT');
      return claimed ? { record: claimed, attempt } : undefined;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async storeOutput(
    projectId: string,
    requestId: string,
    output: AIProviderOutput,
  ): Promise<AIProviderExecutionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await loadProviderRecord(client, projectId, requestId, true);
      if (
        !record ||
        output.projectId !== projectId ||
        record.callId !== output.callId ||
        record.requestDigest !== output.requestDigest ||
        record.inputSnapshotDigest !== output.inputSnapshotDigest ||
        !record.attempts.some(
          (attempt) =>
            attempt.attemptId === output.attemptId &&
            (attempt.status === 'running' || attempt.status === 'outcome_unknown'),
        ) ||
        record.output
      )
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The provider output does not belong to the claimed durable attempt.',
          module: 'postgres-stage4',
          operation: 'store-provider-output',
        });
      await client.query(
        `INSERT INTO ai.provider_outputs (output_id, project_id, call_id, attempt_id, envelope_version, provider,
          adapter_version, model, schema_name, schema_version, prompt_version, policy_version, data_policy_version,
          output_text, content_digest, request_digest, input_snapshot_digest, provider_response_id, model_version,
          finish_reason, usage_json, cost_json, structured_output_valid, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [
          output.outputId,
          projectId,
          output.callId,
          output.attemptId,
          output.envelopeVersion,
          output.provider,
          output.adapterVersion,
          output.model,
          output.schemaName,
          output.schemaVersion,
          output.promptVersion,
          output.policyVersion,
          output.dataPolicyVersion,
          output.rawText,
          output.contentDigest,
          output.requestDigest,
          output.inputSnapshotDigest,
          output.providerResponseId ?? null,
          output.modelVersion,
          output.finishReason ?? null,
          output.usage,
          output.cost,
          output.structuredOutputValid,
          output.receivedAt,
        ],
      );
      await client.query('COMMIT');
      return { ...record, output };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptOutput(
    projectId: string,
    requestId: string,
    outputId: string,
    call: AIProviderCall,
  ): Promise<AIProviderExecutionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await loadProviderRecord(client, projectId, requestId, true);
      if (!record)
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The AI generation request was not found.',
          module: 'postgres-stage4',
          operation: 'accept-provider-output',
        });
      const output = await client.query<OutputRow>(
        `SELECT output_id::text, project_id, call_id::text, attempt_id::text, envelope_version, provider, adapter_version, model, schema_name, schema_version, prompt_version, policy_version, data_policy_version, output_text, content_digest, request_digest, input_snapshot_digest, provider_response_id, model_version, finish_reason, usage_json, cost_json, structured_output_valid, received_at FROM ai.provider_outputs WHERE output_id = $1 AND call_id = $2`,
        [outputId, record.callId],
      );
      const outputRow = output.rows[0];
      if (
        !outputRow ||
        record.requestDigest !== outputRow.request_digest ||
        record.inputSnapshotDigest !== outputRow.input_snapshot_digest
      )
        throw new ShotgunError({
          code: 'FORMAT_CORRUPT',
          safeMessage: 'The persisted provider output failed request integrity verification.',
          module: 'postgres-stage4',
          operation: 'accept-provider-output',
        });
      const completedAttempt = call.attempts.find(
        (attempt) => attempt.attemptId === outputRow.attempt_id,
      );
      await client.query(
        `UPDATE ai.provider_attempts SET status = 'succeeded', provider_response_id = $1, latency_ms = $2, finished_at = now() WHERE attempt_id = $3`,
        [
          completedAttempt?.providerResponseId ?? null,
          completedAttempt?.latencyMs ?? 0,
          outputRow.attempt_id,
        ],
      );
      await client.query(
        `UPDATE ai.provider_calls SET accepted_output_id = $1, durable_state = 'OUTPUT_MATERIALIZED', status = 'succeeded', call_json = $2, updated_at = now() WHERE call_id = $3`,
        [outputId, call, record.callId],
      );
      const accepted = await loadProviderRecord(client, projectId, requestId);
      await client.query('COMMIT');
      if (!accepted) throw new Error('AI Provider Call disappeared after output acceptance.');
      return accepted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failAttempt(
    projectId: string,
    requestId: string,
    attemptId: string,
    code: ErrorCode,
  ): Promise<AIProviderExecutionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await loadProviderRecord(client, projectId, requestId, true);
      if (!record)
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The AI generation request was not found.',
          module: 'postgres-stage4',
          operation: 'fail-provider-attempt',
        });
      await client.query(
        `UPDATE ai.provider_attempts SET status = 'failed', error_code = $1, finished_at = now() WHERE attempt_id = $2 AND call_id = $3`,
        [code, attemptId, record.callId],
      );
      await client.query(
        `UPDATE ai.provider_calls SET durable_state = 'PROVIDER_FAILED', status = 'failed', updated_at = now() WHERE call_id = $1`,
        [record.callId],
      );
      const failed = await loadProviderRecord(client, projectId, requestId);
      await client.query('COMMIT');
      if (!failed) throw new Error('AI Provider Call disappeared after failure.');
      return failed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeMaterialization(
    projectId: string,
    requestId: string,
    outputId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ai.provider_calls SET durable_state = 'COMPLETED', updated_at = now() WHERE project_id = $1 AND request_id = $2 AND accepted_output_id = $3`,
      [projectId, requestId, outputId],
    );
  }
  async failMaterialization(
    projectId: string,
    requestId: string,
    outputId: string,
    code: ErrorCode,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ai.provider_calls SET durable_state = 'MATERIALIZATION_FAILED', status = 'failed', updated_at = now() WHERE project_id = $1 AND request_id = $2 AND accepted_output_id = $3`,
      [projectId, requestId, outputId],
    );
    void code;
  }
  async markExpiredRunningAttemptsOutcomeUnknown(): Promise<void> {
    await this.pool.query(
      `UPDATE ai.provider_attempts SET status = 'outcome_unknown', finished_at = now() WHERE status = 'running' AND lease_expires_at <= now()`,
    );
    await this.pool.query(
      `UPDATE ai.provider_calls SET durable_state = 'OUTCOME_UNKNOWN', status = 'failed', updated_at = now() WHERE durable_state = 'PROVIDER_RUNNING' AND NOT EXISTS (SELECT 1 FROM ai.provider_attempts a WHERE a.call_id = ai.provider_calls.call_id AND a.status = 'running')`,
    );
  }
  async listRecoverableMaterializations(): Promise<readonly AIProviderExecutionRecord[]> {
    const result = await this.pool.query<{ project_id: string; request_id: string }>(
      `SELECT project_id, request_id FROM ai.provider_calls WHERE durable_state IN ('OUTPUT_MATERIALIZED', 'MATERIALIZATION_FAILED') AND accepted_output_id IS NOT NULL ORDER BY created_at`,
    );
    return (
      await Promise.all(
        result.rows.map(async (row) => await this.findByRequestId(row.project_id, row.request_id)),
      )
    ).filter((record): record is AIProviderExecutionRecord => record !== undefined);
  }
}

export class PostgresCandidateRepository implements CandidateRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async failMaterialization(
    projectId: string,
    materialization: NonNullable<CandidateBatch['materialization']>,
    errorCode: ErrorCode,
    createdAt: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO candidate.materializations (
         materialization_id, project_id, output_id, output_digest, input_snapshot_digest,
         materializer_version, batch_id, state, failure_code, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,NULL,'MATERIALIZATION_FAILED',$7,$8)
       ON CONFLICT (project_id, output_id, materializer_version)
       DO UPDATE SET state = 'MATERIALIZATION_FAILED', failure_code = EXCLUDED.failure_code
       WHERE candidate.materializations.batch_id IS NULL
         AND candidate.materializations.output_digest = EXCLUDED.output_digest
         AND candidate.materializations.input_snapshot_digest = EXCLUDED.input_snapshot_digest`,
      [
        randomUUID(),
        projectId,
        materialization.outputId,
        materialization.outputDigest,
        materialization.inputSnapshotDigest,
        materialization.materializerVersion,
        errorCode,
        createdAt,
      ],
    );
  }

  async saveBatch(batch: CandidateBatch): Promise<CandidateBatch> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${batch.projectId}:${batch.idempotencyKey}`,
      ]);
      const existing = await loadBatch(client, batch.projectId, batch.idempotencyKey);
      if (existing) {
        await this.bindMaterialization(client, batch, existing.batchId);
        await client.query('COMMIT');
        return existing;
      }
      await client.query(
        `
          INSERT INTO candidate.batches (
            batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          batch.batchId,
          batch.projectId,
          batch.sourceVersionId,
          batch.idempotencyKey,
          batch.providerCall,
          batch.createdAt,
        ],
      );
      for (const candidate of batch.candidates) {
        await client.query(
          `
            INSERT INTO candidate.claim_candidates (
              candidate_id, batch_id, project_id, source_version_id, revision_number,
              claim_text, evidence_id, evidence_mode, extraction_profile, status,
              provider_call, access_scope, sensitivity, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            candidate.candidateId,
            candidate.batchId,
            candidate.projectId,
            candidate.sourceVersionId,
            candidate.revisionNumber,
            candidate.claimText,
            candidate.evidenceIds[0],
            candidate.evidenceMode,
            candidate.extractionProfile,
            candidate.status,
            candidate.providerCall,
            candidate.accessScope,
            candidate.sensitivity,
            candidate.createdAt,
          ],
        );
      }
      await this.bindMaterialization(client, batch, batch.batchId);
      await client.query('COMMIT');
      return batch;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async bindMaterialization(
    client: PoolClient,
    batch: CandidateBatch,
    batchId: string,
  ): Promise<void> {
    if (!batch.materialization) return;
    const materialization = batch.materialization;
    const bound = await client.query<{ batch_id: string | null }>(
      `INSERT INTO candidate.materializations (
         materialization_id, project_id, output_id, output_digest, input_snapshot_digest,
         materializer_version, batch_id, state, created_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETED',$8,$8)
       ON CONFLICT (project_id, output_id, materializer_version)
       DO UPDATE SET batch_id = EXCLUDED.batch_id, state = 'COMPLETED', failure_code = NULL,
         completed_at = EXCLUDED.completed_at
       WHERE (candidate.materializations.batch_id IS NULL OR candidate.materializations.batch_id = EXCLUDED.batch_id)
         AND candidate.materializations.output_digest = EXCLUDED.output_digest
         AND candidate.materializations.input_snapshot_digest = EXCLUDED.input_snapshot_digest
       RETURNING batch_id::text`,
      [
        randomUUID(),
        batch.projectId,
        materialization.outputId,
        materialization.outputDigest,
        materialization.inputSnapshotDigest,
        materialization.materializerVersion,
        batchId,
        batch.createdAt,
      ],
    );
    if (bound.rows[0]?.batch_id !== batchId) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The persisted AI output is already bound to another Candidate Batch.',
        module: 'postgres-stage4',
        operation: 'bind-candidate-materialization',
      });
    }
  }

  async findBatchByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CandidateBatch | undefined> {
    return loadBatch(this.pool, projectId, idempotencyKey);
  }

  async findById(projectId: string, candidateId: string): Promise<ClaimCandidate | undefined> {
    const result = await this.pool.query<CandidateRow>(
      `${candidateSelect} WHERE project_id = $1 AND candidate_id = $2`,
      [projectId, candidateId],
    );
    return result.rows[0] ? mapCandidate(result.rows[0]) : undefined;
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly ClaimCandidate[]> {
    const result = await this.pool.query<CandidateRow>(
      `${candidateSelect}
       WHERE project_id = $1 AND source_version_id = $2
       ORDER BY created_at, candidate_id`,
      [projectId, sourceVersionId],
    );
    return result.rows.map(mapCandidate);
  }

  async updateStatus(
    projectId: string,
    candidateId: string,
    status: Extract<ClaimCandidateStatus, 'READY' | 'REJECTED'>,
  ): Promise<void> {
    const current = await this.findById(projectId, candidateId);
    if (!current) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Claim Candidate was not found.',
        module: 'postgres-stage4',
        operation: 'update-candidate-status',
      });
    }
    if (current.status !== 'PENDING_VALIDATION' && current.status !== status) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Claim Candidate already has a different final status.',
        module: 'postgres-stage4',
        operation: 'update-candidate-status',
      });
    }
    await this.pool.query(
      'UPDATE candidate.claim_candidates SET status = $3 WHERE project_id = $1 AND candidate_id = $2',
      [projectId, candidateId, status],
    );
  }
}

export class PostgresValidationRepository implements ValidationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(result: ValidationResult): Promise<ValidationResult> {
    const inserted = await this.pool.query<ValidationRow>(
      `
        INSERT INTO validation.results (
          validation_id, candidate_id, revision_number, project_id,
          source_version_id, status, dimensions, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (project_id, candidate_id, revision_number) DO NOTHING
        RETURNING
          validation_id::text, candidate_id::text, revision_number, project_id,
          source_version_id::text, status, dimensions, created_at
      `,
      [
        result.validationId,
        result.candidateId,
        result.revisionNumber,
        result.projectId,
        result.sourceVersionId,
        result.status,
        JSON.stringify(result.dimensions),
        result.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return mapValidation(inserted.rows[0]);
    }
    const existing = await this.findByCandidateId(result.projectId, result.candidateId);
    if (!existing) {
      throw new Error('Validation Result was not stored.');
    }
    if (
      stableJson({ ...existing, validationId: undefined }) !==
      stableJson({ ...result, validationId: undefined })
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Candidate produced a different immutable Validation Result.',
        module: 'postgres-stage4',
        operation: 'save-validation-result',
      });
    }
    return existing;
  }

  async findByCandidateId(
    projectId: string,
    candidateId: string,
  ): Promise<ValidationResult | undefined> {
    const result = await this.pool.query<ValidationRow>(
      `
        SELECT
          validation_id::text, candidate_id::text, revision_number, project_id,
          source_version_id::text, status, dimensions, created_at
        FROM validation.results
        WHERE project_id = $1 AND candidate_id = $2 AND revision_number = 1
      `,
      [projectId, candidateId],
    );
    return result.rows[0] ? mapValidation(result.rows[0]) : undefined;
  }

  async findByValidationId(
    projectId: string,
    validationId: string,
  ): Promise<ValidationResult | undefined> {
    const result = await this.pool.query<ValidationRow>(
      `
        SELECT
          validation_id::text, candidate_id::text, revision_number, project_id,
          source_version_id::text, status, dimensions, created_at
        FROM validation.results
        WHERE project_id = $1 AND validation_id = $2
      `,
      [projectId, validationId],
    );
    return result.rows[0] ? mapValidation(result.rows[0]) : undefined;
  }
}
