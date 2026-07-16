import type { ErrorCode } from './errors.js';
import type { SecurityContext } from './types.js';

export type AIUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
};

export type AICost = {
  readonly currency: 'USD';
  readonly status: 'unavailable' | 'estimated';
  readonly amountMicros?: number;
};

export type AIProviderAttempt = {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly status: 'succeeded' | 'failed';
  readonly errorCode?: ErrorCode;
  readonly providerResponseId?: string;
  readonly latencyMs: number;
};

export type AIProviderCall = {
  readonly callId: string;
  readonly requestId: string;
  readonly taskProfile: 'candidate-extraction';
  readonly schemaName: 'ClaimCandidateBatch.v1';
  readonly provider: string;
  readonly adapterVersion: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly promptVersion: 'direct-claim-v1';
  readonly policyVersion: 'direct-only-v1';
  readonly dataPolicyVersion: 'gemini-stateless-no-sharing-v1' | 'fake-local-v1';
  readonly dataClassification: string;
  readonly inputEvidenceIds: readonly string[];
  readonly usage: AIUsage;
  readonly cost: AICost;
  readonly attempts: readonly AIProviderAttempt[];
  readonly structuredOutputValid: boolean;
  readonly createdAt: string;
};

export type GeneratedClaim = {
  readonly claimText: string;
  readonly evidenceId: string;
};

export type ClaimCandidateStatus = 'PENDING_VALIDATION' | 'READY' | 'REJECTED';

export type ClaimCandidate = {
  readonly candidateId: string;
  readonly batchId: string;
  readonly revisionNumber: 1;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly claimText: string;
  readonly evidenceIds: readonly [string];
  readonly evidenceMode: 'DIRECT_EVIDENCE';
  readonly extractionProfile: 'direct-only';
  readonly status: ClaimCandidateStatus;
  readonly providerCall: AIProviderCall;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type ValidationDimensionName =
  'schema' | 'evidence-reference' | 'direct-text' | 'policy' | 'semantic';

export type ValidationDimension = {
  readonly name: ValidationDimensionName;
  readonly status: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly reason?: string;
};

export type ValidationResult = {
  readonly validationId: string;
  readonly candidateId: string;
  readonly revisionNumber: 1;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly status: 'READY' | 'REJECTED';
  readonly dimensions: readonly ValidationDimension[];
  readonly createdAt: string;
};
