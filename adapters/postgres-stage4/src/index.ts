import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  AIProviderCallRepositoryPort,
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
  type ClaimCandidate,
  type ClaimCandidateStatus,
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

export class PostgresAIProviderCallRepository implements AIProviderCallRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(record: AIProviderExecutionRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO ai.provider_calls (
            call_id, project_id, request_id, provider, model, prompt_version, policy_version,
            schema_name, data_classification, input_evidence_ids, status, call_json, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (project_id, request_id)
          DO UPDATE SET
            status = EXCLUDED.status,
            call_json = EXCLUDED.call_json
        `,
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
          record.status,
          record.call ?? null,
          record.createdAt,
        ],
      );
      const stored = await client.query<{ call_id: string }>(
        'SELECT call_id::text FROM ai.provider_calls WHERE project_id = $1 AND request_id = $2',
        [record.projectId, record.requestId],
      );
      const callId = stored.rows[0]?.call_id;
      if (!callId) {
        throw new Error('AI Provider Call was not stored.');
      }
      for (const attempt of record.attempts) {
        await client.query(
          `
            INSERT INTO ai.provider_attempts (
              attempt_id, call_id, attempt_number, status, error_code,
              provider_response_id, latency_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (call_id, attempt_number) DO NOTHING
          `,
          [
            attempt.attemptId,
            callId,
            attempt.attemptNumber,
            attempt.status,
            attempt.errorCode ?? null,
            attempt.providerResponseId ?? null,
            attempt.latencyMs,
          ],
        );
      }
      await client.query('COMMIT');
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
    const result = await this.pool.query<ProviderCallRow>(
      `
        SELECT
          call_id::text, project_id, request_id, provider, model, prompt_version,
          policy_version, schema_name, data_classification,
          ARRAY(SELECT value::text FROM unnest(input_evidence_ids) value) AS input_evidence_ids,
          status, call_json, created_at
        FROM ai.provider_calls
        WHERE project_id = $1 AND request_id = $2
      `,
      [projectId, requestId],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    const attempts = await this.pool.query<AttemptRow>(
      `
        SELECT
          attempt_id::text, attempt_number, status, error_code, provider_response_id, latency_ms
        FROM ai.provider_attempts
        WHERE call_id = $1
        ORDER BY attempt_number
      `,
      [row.call_id],
    );
    return {
      callId: row.call_id,
      requestId: row.request_id,
      projectId: row.project_id,
      provider: row.provider,
      model: row.model,
      promptVersion: row.prompt_version,
      policyVersion: row.policy_version,
      schemaName: row.schema_name,
      dataClassification: row.data_classification,
      inputEvidenceIds: row.input_evidence_ids,
      status: row.status,
      attempts: attempts.rows.map(mapAttempt),
      call: row.call_json ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}

export class PostgresCandidateRepository implements CandidateRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveBatch(batch: CandidateBatch): Promise<CandidateBatch> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${batch.projectId}:${batch.idempotencyKey}`,
      ]);
      const existing = await loadBatch(client, batch.projectId, batch.idempotencyKey);
      if (existing) {
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
      await client.query('COMMIT');
      return batch;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
