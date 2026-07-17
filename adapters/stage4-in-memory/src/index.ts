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
  type ClaimCandidate,
  type ClaimCandidateStatus,
  stableJson,
  ShotgunError,
  type ValidationResult,
} from '../../../packages/contracts/src/index.js';

export class InMemoryAIProviderCallRepository implements AIProviderCallRepositoryPort {
  private readonly records = new Map<string, AIProviderExecutionRecord>();

  async save(record: AIProviderExecutionRecord): Promise<void> {
    this.records.set(`${record.projectId}:${record.requestId}`, record);
  }

  async findByRequestId(
    projectId: string,
    requestId: string,
  ): Promise<AIProviderExecutionRecord | undefined> {
    return this.records.get(`${projectId}:${requestId}`);
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

  async saveBatch(batch: CandidateBatch): Promise<CandidateBatch> {
    const key = `${batch.projectId}:${batch.idempotencyKey}`;
    const existing = this.batches.get(key);
    if (existing) {
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
    return batch;
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
