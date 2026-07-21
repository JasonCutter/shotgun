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

export class InMemoryAIProviderCallRepository implements AIProviderCallRepositoryPort {
  private readonly records = new Map<string, AIProviderExecutionRecord>();
  private readonly outputs = new Map<string, AIProviderOutput>();

  async ensure(record: AIProviderExecutionRecord): Promise<AIProviderExecutionRecord> {
    const key = `${record.projectId}:${record.requestId}`;
    const existing = this.records.get(key);
    if (existing) return existing;
    this.records.set(key, record);
    return record;
  }

  async findByRequestId(
    projectId: string,
    requestId: string,
  ): Promise<AIProviderExecutionRecord | undefined> {
    return this.records.get(`${projectId}:${requestId}`);
  }

  async claimNextAttempt(
    projectId: string,
    requestId: string,
  ): Promise<ClaimedProviderAttempt | undefined> {
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
    if (
      !record ||
      !['REQUESTED', 'PROVIDER_FAILED'].includes(record.state) ||
      record.attempts.length >= record.maxAttempts
    )
      return undefined;
    const attempt: AIProviderAttempt = {
      attemptId: `${record.callId}-${record.attempts.length + 1}`,
      attemptNumber: record.attempts.length + 1,
      status: 'running',
      latencyMs: 0,
    };
    const claimed = {
      ...record,
      state: 'PROVIDER_RUNNING' as const,
      attempts: [...record.attempts, attempt],
    };
    this.records.set(key, claimed);
    return { record: claimed, attempt };
  }

  async storeOutput(
    projectId: string,
    requestId: string,
    output: AIProviderOutput,
  ): Promise<AIProviderExecutionRecord> {
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
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
      this.outputs.has(output.attemptId)
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The provider output does not belong to the claimed durable attempt.',
        module: 'stage4-in-memory',
        operation: 'store-provider-output',
      });
    }
    // An output becomes visible on the generation request only after it is
    // accepted. Invalid structured output remains immutable attempt evidence
    // and must not prevent a later, bounded retry from storing its own output.
    this.outputs.set(output.attemptId, output);
    return { ...record, output };
  }

  async acceptOutput(
    projectId: string,
    requestId: string,
    outputId: string,
    call: AIProviderCall,
  ): Promise<AIProviderExecutionRecord> {
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
    const output = [...this.outputs.values()].find((item) => item.outputId === outputId);
    if (
      !record ||
      !output ||
      output.projectId !== projectId ||
      output.callId !== record.callId ||
      output.requestDigest !== record.requestDigest ||
      output.inputSnapshotDigest !== record.inputSnapshotDigest ||
      call.callId !== record.callId ||
      !call.structuredOutputValid ||
      !call.attempts.some(
        (attempt) => attempt.attemptId === output.attemptId && attempt.status === 'succeeded',
      )
    ) {
      throw new ShotgunError({
        code: 'FORMAT_CORRUPT',
        safeMessage: 'The accepted provider output is not available.',
        module: 'stage4-in-memory',
        operation: 'accept-provider-output',
      });
    }
    if (record.output?.outputId === outputId) return record;
    if (record.output) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'A different Provider output is already accepted.',
        module: 'stage4-in-memory',
        operation: 'accept-provider-output',
      });
    }
    const accepted = {
      ...record,
      state: 'OUTPUT_MATERIALIZED' as const,
      status: 'succeeded' as const,
      call,
      output,
      attempts: call.attempts,
    };
    this.records.set(key, accepted);
    return accepted;
  }

  async failAttempt(
    projectId: string,
    requestId: string,
    attemptId: string,
    errorCode: ErrorCode,
  ): Promise<AIProviderExecutionRecord> {
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
    if (!record)
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The AI generation request was not found.',
        module: 'stage4-in-memory',
        operation: 'fail-provider-attempt',
      });
    const failed = {
      ...record,
      state: 'PROVIDER_FAILED' as const,
      status: 'failed' as const,
      attempts: record.attempts.map((attempt) =>
        attempt.attemptId === attemptId
          ? { ...attempt, status: 'failed' as const, errorCode }
          : attempt,
      ),
    };
    this.records.set(key, failed);
    return failed;
  }

  async markAttemptOutcomeUnknown(
    projectId: string,
    requestId: string,
    attemptId: string,
  ): Promise<AIProviderExecutionRecord> {
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
    if (!record)
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The AI generation request was not found.',
        module: 'stage4-in-memory',
        operation: 'mark-provider-outcome-unknown',
      });
    if (record.output || record.state !== 'PROVIDER_RUNNING') return record;
    const unknown = {
      ...record,
      state: 'OUTCOME_UNKNOWN' as const,
      status: 'failed' as const,
      attempts: record.attempts.map((attempt) =>
        attempt.attemptId === attemptId && attempt.status === 'running'
          ? { ...attempt, status: 'outcome_unknown' as const }
          : attempt,
      ),
    };
    this.records.set(key, unknown);
    return unknown;
  }

  async completeMaterialization(
    projectId: string,
    requestId: string,
    outputId: string,
  ): Promise<void> {
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
    if (record?.output?.outputId === outputId)
      this.records.set(key, { ...record, state: 'COMPLETED' });
  }

  async failMaterialization(
    projectId: string,
    requestId: string,
    outputId: string,
    _errorCode: ErrorCode,
  ): Promise<void> {
    void _errorCode;
    const key = `${projectId}:${requestId}`;
    const record = this.records.get(key);
    if (record?.output?.outputId === outputId)
      this.records.set(key, { ...record, state: 'MATERIALIZATION_FAILED', status: 'failed' });
  }

  async markExpiredRunningAttemptsOutcomeUnknown(): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.state === 'PROVIDER_RUNNING') {
        this.records.set(key, {
          ...record,
          state: 'OUTCOME_UNKNOWN',
          status: 'failed',
          attempts: record.attempts.map((attempt) =>
            attempt.status === 'running' ? { ...attempt, status: 'outcome_unknown' } : attempt,
          ),
        });
      }
    }
  }

  async listRecoverableMaterializations(): Promise<readonly AIProviderExecutionRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        (record.state === 'OUTPUT_MATERIALIZED' || record.state === 'MATERIALIZATION_FAILED') &&
        record.output !== undefined,
    );
  }

  list(): readonly AIProviderExecutionRecord[] {
    return [...this.records.values()];
  }
}

export class InMemoryValidationRepository implements ValidationRepositoryPort {
  private readonly results = new Map<string, ValidationResult>();

  async save(result: ValidationResult): Promise<ValidationResult> {
    const key = `${result.projectId}:${result.candidateId}`;
    const existing = this.results.get(key);
    if (existing) {
      if (
        stableJson({ ...existing, validationId: undefined }) !==
        stableJson({ ...result, validationId: undefined })
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Candidate produced a different immutable Validation Result.',
          module: 'stage4-in-memory',
          operation: 'save-validation-result',
        });
      }
      return existing;
    }
    this.results.set(key, result);
    return result;
  }

  async findByCandidateId(
    projectId: string,
    candidateId: string,
  ): Promise<ValidationResult | undefined> {
    return this.results.get(`${projectId}:${candidateId}`);
  }

  async findByValidationId(
    projectId: string,
    validationId: string,
  ): Promise<ValidationResult | undefined> {
    return [...this.results.values()].find(
      (v) => v.projectId === projectId && v.validationId === validationId,
    );
  }

  count(): number {
    return this.results.size;
  }
}

export class InMemoryCandidateRepository implements CandidateRepositoryPort {
  private readonly batches = new Map<string, CandidateBatch>();
  private readonly candidates = new Map<string, ClaimCandidate>();
  private readonly materializations = new Map<
    string,
    { readonly batchId?: string; readonly state: 'MATERIALIZATION_FAILED' | 'COMPLETED' }
  >();

  async failMaterialization(
    projectId: string,
    materialization: NonNullable<CandidateBatch['materialization']>,
    _errorCode: ErrorCode,
    _createdAt: string,
  ): Promise<void> {
    void _errorCode;
    void _createdAt;
    const key = `${projectId}:${materialization.outputId}`;
    const existing = this.materializations.get(key);
    if (!existing?.batchId) this.materializations.set(key, { state: 'MATERIALIZATION_FAILED' });
  }

  async saveBatch(batch: CandidateBatch): Promise<CandidateBatch> {
    const key = `${batch.projectId}:${batch.idempotencyKey}`;
    const existing = this.batches.get(key);
    if (existing) {
      this.bindMaterialization(batch, existing.batchId);
      if (
        stableJson({
          ...existing,
          batchId: undefined,
          candidates: existing.candidates.map((item) => ({
            ...item,
            candidateId: undefined,
            batchId: undefined,
          })),
        }) !==
        stableJson({
          ...batch,
          batchId: undefined,
          candidates: batch.candidates.map((item) => ({
            ...item,
            candidateId: undefined,
            batchId: undefined,
          })),
        })
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The same candidate idempotency key produced different output.',
          module: 'stage4-in-memory',
          operation: 'save-candidate-batch',
        });
      }
      return existing;
    }
    this.batches.set(key, batch);
    batch.candidates.forEach((candidate) =>
      this.candidates.set(`${batch.projectId}:${candidate.candidateId}`, candidate),
    );
    this.bindMaterialization(batch, batch.batchId);
    return batch;
  }

  private bindMaterialization(batch: CandidateBatch, batchId: string) {
    if (!batch.materialization) return;
    const existing = this.materializations.get(
      `${batch.projectId}:${batch.materialization.outputId}`,
    );
    if (existing?.batchId && existing.batchId !== batchId) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The persisted AI output is already bound to another Candidate Batch.',
        module: 'stage4-in-memory',
        operation: 'bind-candidate-materialization',
      });
    }
    this.materializations.set(`${batch.projectId}:${batch.materialization.outputId}`, {
      batchId,
      state: 'COMPLETED',
    });
  }

  async findBatchByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CandidateBatch | undefined> {
    return this.batches.get(`${projectId}:${idempotencyKey}`);
  }

  async findById(projectId: string, candidateId: string): Promise<ClaimCandidate | undefined> {
    return this.candidates.get(`${projectId}:${candidateId}`);
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly ClaimCandidate[]> {
    return [...this.candidates.values()].filter(
      (candidate) =>
        candidate.projectId === projectId && candidate.sourceVersionId === sourceVersionId,
    );
  }

  async updateStatus(
    projectId: string,
    candidateId: string,
    status: Extract<ClaimCandidateStatus, 'READY' | 'REJECTED'>,
  ): Promise<void> {
    const key = `${projectId}:${candidateId}`;
    const candidate = this.candidates.get(key);
    if (!candidate) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Claim Candidate was not found.',
        module: 'stage4-in-memory',
        operation: 'update-candidate-status',
      });
    }
    if (candidate.status !== 'PENDING_VALIDATION' && candidate.status !== status) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Claim Candidate already has a different final status.',
        module: 'stage4-in-memory',
        operation: 'update-candidate-status',
      });
    }
    this.candidates.set(key, { ...candidate, status });
  }

  counts() {
    return { batches: this.batches.size, candidates: this.candidates.size };
  }
}
