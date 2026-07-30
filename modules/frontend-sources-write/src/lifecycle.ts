export type SourcesRetryMode = 'SAME_CONTEXT' | 'CURRENT_POLICY';

export type RetrySourcesItemsInput = {
  readonly projectId: string;
  readonly submissionId: string;
  readonly submissionItemIds: readonly string[];
  readonly commandId: string;
  readonly mode: SourcesRetryMode;
  readonly acceptedPolicyContextId: string;
  readonly acceptedPolicyBinding: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly createdAt: string;
};

export type CancelSourcesSubmissionInput = {
  readonly projectId: string;
  readonly submissionId: string;
  readonly commandId: string;
  readonly acceptedPolicyContextId: string;
  readonly acceptedPolicyBinding: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly createdAt: string;
};

export type MarkSourcesOutcomeIndeterminateInput = {
  readonly projectId: string;
  readonly submissionId: string;
  readonly submissionItemIds: readonly string[];
  readonly updatedAt: string;
};

export type SourcesLifecycleMutationResult = {
  readonly submissionId: string;
  readonly submissionState: string;
  readonly submissionRevision: string;
  readonly itemStates: readonly {
    readonly submissionItemId: string;
    readonly state: string;
    readonly itemRevision: string;
    readonly attemptCount: number;
  }[];
};

export type SourcesIntakeLifecyclePort = {
  retryItems(input: RetrySourcesItemsInput): Promise<SourcesLifecycleMutationResult>;
  cancelSubmission(input: CancelSourcesSubmissionInput): Promise<SourcesLifecycleMutationResult>;
  markOutcomeIndeterminate(
    input: MarkSourcesOutcomeIndeterminateInput,
  ): Promise<SourcesLifecycleMutationResult>;
};
