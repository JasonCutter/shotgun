import type {
  ExactDuplicateDecisionView,
  ExactDuplicateDisposition,
  IntakeSubmissionSnapshot,
  SourcesSensitivity,
  SourcesStagingInputKind,
  SourcesStagingReceipt,
} from '../../../packages/contracts/src/index.js';
import type {
  SourcesIntakeChannel,
  SourcesIntakeInputKind,
  SourcesUrlSuccessProvenance,
} from './index.js';
import type { SourcesResourceSecurityPolicy } from './resource-security.js';

export type ResolvedSourcesStagingArtifact = {
  readonly draftId: string;
  readonly itemId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly kind: SourcesIntakeInputKind;
  readonly label: string;
  readonly channel: SourcesIntakeChannel;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly stagingReference?: string;
  readonly fileName?: string;
  readonly redactedRequestedUrl?: string;
  readonly urlProvenance?: SourcesUrlSuccessProvenance;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly requestedClassification?: SourcesSensitivity;
};

export type SourcesStagingServicePort = {
  stageBytes(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly kind: 'DIRECT_TEXT' | 'FILE';
    readonly label: string;
    readonly mediaType: 'text/plain' | 'text/markdown';
    readonly fileName?: string;
    readonly bytes: Uint8Array;
  }): Promise<SourcesStagingReceipt>;
  stageUrl(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly label: string;
    readonly requestedUrl: string;
  }): Promise<SourcesStagingReceipt>;
  resolve(input: {
    readonly stagingReference: string;
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly kind: SourcesStagingInputKind;
  }): Promise<ResolvedSourcesStagingArtifact>;
};

export type SourcesProductWriteScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly principalAccessScopes: readonly string[];
  readonly sensitivityClearance: SourcesSensitivity;
  readonly resourceSecurityPolicy: SourcesResourceSecurityPolicy;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly acceptedPolicyContextId: string;
  readonly acceptedPolicyBinding: Readonly<Record<string, unknown>>;
};

export type SubmitSourcesProductInput = {
  readonly submissionId: string;
  readonly commandId: string;
  readonly correlationId: string;
  readonly draftId: string;
  readonly scope: SourcesProductWriteScope;
  readonly items: readonly ResolvedSourcesStagingArtifact[];
  readonly createdAt: string;
};

export type ResolveSourcesDuplicateProductInput = {
  readonly commandId: string;
  readonly correlationId: string;
  readonly decisionId: string;
  readonly observedDecisionRevision: string;
  readonly disposition: ExactDuplicateDisposition;
  readonly targetSourceId?: string;
  readonly scope: SourcesProductWriteScope;
  readonly createdAt: string;
};

export type RetrySourcesProductInput = {
  readonly commandId: string;
  readonly correlationId: string;
  readonly submissionId: string;
  readonly itemIds: readonly string[];
  readonly mode: 'SAME_CONTEXT' | 'CURRENT_POLICY';
  readonly scope: SourcesProductWriteScope;
  readonly createdAt: string;
};

export type CancelSourcesProductInput = {
  readonly commandId: string;
  readonly correlationId: string;
  readonly submissionId: string;
  readonly scope: SourcesProductWriteScope;
  readonly createdAt: string;
};

export type SourcesProductWriteServicePort = {
  submit(input: SubmitSourcesProductInput): Promise<IntakeSubmissionSnapshot>;
  getSubmission(
    scope: SourcesProductWriteScope,
    submissionId: string,
  ): Promise<IntakeSubmissionSnapshot | undefined>;
  getDuplicateDecision(
    scope: SourcesProductWriteScope,
    decisionId: string,
  ): Promise<ExactDuplicateDecisionView | undefined>;
  resolveDuplicate(input: ResolveSourcesDuplicateProductInput): Promise<IntakeSubmissionSnapshot>;
  retry(input: RetrySourcesProductInput): Promise<IntakeSubmissionSnapshot>;
  cancel(input: CancelSourcesProductInput): Promise<IntakeSubmissionSnapshot>;
};
