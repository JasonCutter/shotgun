import type {
  ExactDuplicateDecisionView,
  ExactDuplicateDisposition,
  IntakeSubmissionSnapshot,
  SourcesSensitivity,
} from '../../../packages/contracts/src/index.js';
import type { ResolvedSourcesStagingArtifact } from '../../frontend-sources-staging/src/index.js';

export type SourcesProductWriteScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly accessScopes: readonly string[];
  readonly sensitivity: SourcesSensitivity;
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
