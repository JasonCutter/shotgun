import type { SecurityContext } from '../../../packages/contracts/src/index.js';

export type {
  SourcesStage3EvidenceIndexedInput,
  SourcesStage3PipelinePort,
  SourcesStage4ContinuationPort,
} from './stage3-pipeline.js';
export {
  assertSourcesResourceSecurityContinuation,
  resolveSourcesResourceSecurity,
  sourceSecurityMetadataEqual,
  type SourcesResourceSecurityAuthority,
  type SourcesResourceSecurityMetadata,
  type SourcesResourceSecurityPolicy,
} from './resource-security.js';

export type SourcesIntakeChannel = 'direct_text' | 'file_upload' | 'url_acquisition';
export type SourcesIntakeInputKind = 'DIRECT_TEXT' | 'FILE' | 'URL';
export type SourcesDuplicateDisposition =
  | 'REUSE_EXISTING_VERSION'
  | 'CREATE_VERSION_CANDIDATE'
  | 'CREATE_SEPARATE_SOURCE'
  | 'CANCEL_SUBMISSION';

export type SourcesUrlSuccessProvenance = {
  readonly normalizedRequestedUrl: string;
  readonly redactedRequestedUrl: string;
  readonly redactedFinalUrl: string;
  readonly redirectChainDigest: string;
  readonly redirectObservations: readonly Readonly<Record<string, unknown>>[];
  readonly dnsObservations: readonly Readonly<Record<string, unknown>>[];
  readonly responseStatus: number;
  readonly responseContentType: 'text/plain' | 'text/markdown';
  readonly responseContentLength?: number;
  readonly compressedBytes: number;
  readonly decompressedBytes: number;
  readonly responseMetadata: Readonly<Record<string, unknown>>;
  readonly retentionClass: string;
  readonly retentionExpiresAt?: string;
  readonly retrievedAt: string;
  readonly limits: {
    readonly maxRedirects: number;
    readonly connectTimeoutMs: number;
    readonly headerTimeoutMs: number;
    readonly bodyTimeoutMs: number;
    readonly totalTimeoutMs: number;
    readonly maxCompressedBytes: number;
    readonly maxDecompressedBytes: number;
  };
};

export type SourcesIntakeStoredItemInput = {
  readonly clientItemId: string;
  readonly inputKind: SourcesIntakeInputKind;
  readonly label: string;
  readonly inputManifest: Readonly<Record<string, unknown>>;
  readonly channel: SourcesIntakeChannel;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly originalFileName?: string;
  readonly requestedSourceId?: string;
  readonly urlProvenance?: SourcesUrlSuccessProvenance;
};

export type CreateSourcesIntakeSubmissionInput = {
  readonly submissionId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly createCommandId: string;
  readonly correlationId: string;
  readonly acceptedPolicyContextId: string;
  readonly acceptedPolicyBinding: Readonly<Record<string, unknown>>;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
  readonly items: readonly SourcesIntakeStoredItemInput[];
};

export type SourcesIntakeStoredItemResult = {
  readonly submissionItemId: string;
  readonly clientItemId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly originalAssetId: string;
  readonly assetReused: boolean;
  readonly versionCreated: boolean;
};

export type SourcesIntakeSubmissionResult = {
  readonly submissionId: string;
  readonly projectId: string;
  readonly submissionRevision: string;
  readonly replayed: boolean;
  readonly items: readonly SourcesIntakeStoredItemResult[];
};

export type CreateExactDuplicateDecisionInput = {
  readonly projectId: string;
  readonly submissionId: string;
  readonly submissionItemId: string;
  readonly contentHash: string;
  readonly existingSourceId: string;
  readonly existingSourceVersionId: string;
  readonly allowedDispositions: readonly SourcesDuplicateDisposition[];
  readonly observedSourceRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly createdAt: string;
};

export type ExactDuplicateDecisionResult = {
  readonly decisionId: string;
  readonly decisionRevision: string;
};

export type ResolveExactDuplicateDecisionInput = {
  readonly projectId: string;
  readonly submissionId: string;
  readonly submissionItemId: string;
  readonly decisionId: string;
  readonly observedDecisionRevision: string;
  readonly commandId: string;
  readonly disposition: SourcesDuplicateDisposition;
  readonly targetSourceId?: string;
  readonly createdAt: string;
};

export type SourcesIntakeUnitOfWorkPort = {
  createSubmission(
    input: CreateSourcesIntakeSubmissionInput,
  ): Promise<SourcesIntakeSubmissionResult>;
  createExactDuplicateDecision(
    input: CreateExactDuplicateDecisionInput,
  ): Promise<ExactDuplicateDecisionResult>;
  resolveExactDuplicateDecision(input: ResolveExactDuplicateDecisionInput): Promise<void>;
};

export * from './product-service.js';
