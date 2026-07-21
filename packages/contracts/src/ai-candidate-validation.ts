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
  readonly status: 'running' | 'succeeded' | 'failed' | 'outcome_unknown';
  readonly errorCode?: ErrorCode;
  readonly providerResponseId?: string;
  readonly latencyMs: number;
};

export type AIDurableState =
  | 'REQUESTED'
  | 'PROVIDER_RUNNING'
  | 'OUTPUT_MATERIALIZED'
  | 'PROVIDER_FAILED'
  | 'OUTCOME_UNKNOWN'
  | 'MATERIALIZATION_FAILED'
  | 'COMPLETED';

export type AIProviderOutput = {
  readonly outputId: string;
  readonly projectId: string;
  readonly callId: string;
  readonly attemptId: string;
  readonly envelopeVersion: 'ai-provider-output-v1';
  readonly provider: string;
  readonly adapterVersion: string;
  readonly model: string;
  readonly schemaName: 'ClaimCandidateBatch.v1';
  readonly schemaVersion: '1.0.0';
  readonly promptVersion: 'direct-claim-v1';
  readonly policyVersion: 'direct-only-v1';
  readonly dataPolicyVersion: 'gemini-stateless-no-sharing-v1' | 'fake-local-v1';
  readonly rawText: string;
  readonly contentDigest: string;
  readonly requestDigest: string;
  readonly inputSnapshotDigest: string;
  readonly providerResponseId?: string;
  readonly modelVersion: string;
  readonly finishReason?: string;
  readonly usage: AIUsage;
  readonly cost: AICost;
  readonly receivedAt: string;
};

export type AIProviderOutputReference = Omit<AIProviderOutput, 'rawText'>;

export type CandidateMaterializationRef = {
  readonly outputId: string;
  readonly outputDigest: string;
  readonly inputSnapshotDigest: string;
  readonly materializerVersion: 'stage12-1-v1';
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
