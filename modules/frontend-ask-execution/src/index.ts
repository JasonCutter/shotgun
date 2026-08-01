import { randomUUID } from 'node:crypto';

import {
  ShotgunError,
  type AskAnswerExportFormat,
  type AskAnswerFeedbackKind,
  type AskAnswerRunEventView,
  type AskAnswerRunProvider,
  type AskAnswerRunRetryMode,
  type AskAnswerRunSnapshot,
  type AskAnswerRunUsage,
  type AskAnswerRunState,
  type AskAnswerRunFailure,
  type AskAnswerRunExportView,
  type AskAnswerRunFeedbackView,
  type AskAnswerRunTransitionSeedRequest,
  type AskTransitionSeedKind,
  type AskTransitionSeedPayload,
  type AskTransitionSeedView,
  type AskCitationView,
  stableJson,
} from '../../../packages/contracts/src/index.js';

export const ASK_EXECUTION_COMMAND_TYPES = {
  cancel: 'ask.answer-run.cancel.v1',
  retry: 'ask.answer-run.retry.v1',
  export: 'ask.answer-run.export.v1',
  feedback: 'ask.answer-run.feedback.v1',
  transitionSeed: 'ask.answer-run.transition-seed.v1',
} as const;

export type AskExecutionScope = {
  readonly principalId: string;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
};

export type AskExecutionEvidence = {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly exactQuote: string;
  readonly sensitivity: AskExecutionScope['sensitivityClearance'];
};

export type AskAnswerProviderCitation = {
  readonly evidenceId: string;
  readonly exactQuote?: string;
};

export type AskAnswerProviderRequest = {
  readonly answerRunId: string;
  readonly question: string;
  readonly mode: AskAnswerRunSnapshot['mode'];
  readonly evidence: readonly AskExecutionEvidence[];
  readonly signal: AbortSignal;
  readonly onPartial: (partialText: string) => Promise<void>;
};

export type AskAnswerProviderResult = {
  readonly answer: string;
  readonly citations: readonly AskAnswerProviderCitation[];
  readonly providerResponseId?: string;
  readonly provider: AskAnswerRunProvider;
  readonly usage?: AskAnswerRunUsage;
};

export type AskAnswerProviderPort = {
  readonly identity: AskAnswerRunProvider & { readonly dataPolicyVersion: string };
  execute(request: AskAnswerProviderRequest): Promise<AskAnswerProviderResult>;
};

export type AskExecutionAttemptKind = 'INITIAL' | 'RETRY_SAME_CONTEXT' | 'RETRY_CURRENT_POLICY';

export type AskExecutionAttempt = {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly kind: AskExecutionAttemptKind;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type AskExecutionRunContext = {
  readonly snapshot: AskAnswerRunSnapshot;
  readonly evidence: readonly AskExecutionEvidence[];
};

export type AskClaimedExecution = {
  readonly attempt: AskExecutionAttempt;
  readonly context: AskExecutionRunContext;
};

export type AskAnswerExecutionRepositoryPort = {
  getRunContext(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskExecutionRunContext | undefined>;
  claimInitial(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskClaimedExecution | undefined>;
  retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
  }): Promise<AskClaimedExecution>;
  requestCancel(scope: AskExecutionScope, answerRunId: string): Promise<AskAnswerRunSnapshot>;
  isCancelRequested(scope: AskExecutionScope, answerRunId: string): Promise<boolean>;
  appendPartial(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly partialText: string;
  }): Promise<void>;
  complete(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly answer: string;
    readonly citations: readonly AskCitationView[];
    readonly provider: AskAnswerRunProvider;
    readonly usage?: AskAnswerRunUsage;
  }): Promise<AskAnswerRunSnapshot>;
  fail(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly failure: AskAnswerRunFailure;
    readonly state: Extract<AskAnswerRunState, 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED'>;
  }): Promise<AskAnswerRunSnapshot>;
  getEvents(
    scope: AskExecutionScope,
    answerRunId: string,
    afterOrdinal?: number,
  ): Promise<readonly AskAnswerRunEventView[]>;
  saveExport(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly format: AskAnswerExportFormat;
    readonly content: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunExportView>;
  saveFeedback(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskAnswerFeedbackKind;
    readonly comment?: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView>;
  saveTransitionSeed(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly payload: AskTransitionSeedPayload;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView>;
};

const executionError = (
  code: ConstructorParameters<typeof ShotgunError>[0]['code'],
  message: string,
  operation: string,
  retryable = false,
): ShotgunError =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'frontend-ask-execution',
    operation,
    retryable,
  });

const retryableFailureCodes = new Set([
  'RATE_LIMITED',
  'TIMEOUT',
  'RETRYABLE_DEPENDENCY',
  'VALIDATION_ERROR',
]);

const buildAnswer = (snapshot: AskAnswerRunSnapshot): string =>
  snapshot.statements.map((statement) => statement.text).join('\n\n');

const markdownFor = (snapshot: AskAnswerRunSnapshot): string => {
  const citations = snapshot.statements.flatMap((statement) => statement.citations);
  const citationLines = citations.map(
    (citation) =>
      `- ${citation.sourceId}/${citation.sourceVersionId}/${citation.evidenceId}${
        citation.exactQuote ? `: "${citation.exactQuote}"` : ''
      }`,
  );
  return [
    `# ${snapshot.question}`,
    '',
    buildAnswer(snapshot),
    ...(citationLines.length > 0 ? ['', '## Citations', ...citationLines] : []),
  ].join('\n');
};

export class AskAnswerExecutionService {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly repository: AskAnswerExecutionRepositoryPort,
    private readonly provider: AskAnswerProviderPort,
  ) {}

  async enqueue(input: AskExecutionScope & { readonly answerRunId: string }): Promise<void> {
    const { answerRunId, ...scope } = input;
    const claimed = await this.repository.claimInitial(scope, answerRunId);
    if (!claimed) return;
    void this.executeClaimed(scope, claimed);
  }

  async execute(scope: AskExecutionScope, answerRunId: string): Promise<AskAnswerRunSnapshot> {
    const claimed = await this.repository.claimInitial(scope, answerRunId);
    if (!claimed) {
      const current = await this.repository.getRunContext(scope, answerRunId);
      if (!current) throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'execute');
      return current.snapshot;
    }
    return this.executeClaimed(scope, claimed);
  }

  async cancel(scope: AskExecutionScope, answerRunId: string): Promise<AskAnswerRunSnapshot> {
    const snapshot = await this.repository.requestCancel(scope, answerRunId);
    this.active.get(answerRunId)?.abort();
    return snapshot;
  }

  async retry(
    scope: AskExecutionScope,
    answerRunId: string,
    mode: AskAnswerRunRetryMode,
  ): Promise<AskAnswerRunSnapshot> {
    const claimed = await this.repository.retryAndClaim({ scope, answerRunId, mode });
    return this.executeClaimed(scope, claimed);
  }

  async events(
    scope: AskExecutionScope,
    answerRunId: string,
    afterOrdinal?: number,
  ): Promise<readonly AskAnswerRunEventView[]> {
    const context = await this.repository.getRunContext(scope, answerRunId);
    if (!context) throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'events');
    return this.repository.getEvents(scope, answerRunId, afterOrdinal);
  }

  async export(
    scope: AskExecutionScope,
    answerRunId: string,
    format: AskAnswerExportFormat,
    requestId: string = randomUUID(),
  ): Promise<AskAnswerRunExportView> {
    const context = await this.repository.getRunContext(scope, answerRunId);
    if (!context) throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'export');
    if (context.snapshot.state !== 'SUCCEEDED') {
      throw executionError(
        'INVALID_REQUEST',
        'Only a succeeded AnswerRun can be exported.',
        'export',
      );
    }
    const content =
      format === 'MARKDOWN' ? markdownFor(context.snapshot) : stableJson(context.snapshot);
    return this.repository.saveExport({ scope, answerRunId, format, content, requestId });
  }

  async feedback(
    scope: AskExecutionScope,
    answerRunId: string,
    kind: AskAnswerFeedbackKind,
    comment?: string,
    requestId: string = randomUUID(),
  ): Promise<AskAnswerRunFeedbackView> {
    const context = await this.repository.getRunContext(scope, answerRunId);
    if (!context) throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'feedback');
    return this.repository.saveFeedback({
      scope,
      answerRunId,
      kind,
      ...(comment === undefined ? {} : { comment }),
      requestId,
    });
  }

  async transitionSeed(
    scope: AskExecutionScope,
    answerRunId: string,
    kind: AskTransitionSeedKind,
    requestId: string = randomUUID(),
  ): Promise<AskTransitionSeedView> {
    const context = await this.repository.getRunContext(scope, answerRunId);
    if (!context)
      throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'transition-seed');
    if (context.snapshot.state !== 'SUCCEEDED') {
      throw executionError(
        'INVALID_REQUEST',
        'Only a succeeded AnswerRun can create a transition seed.',
        'transition-seed',
      );
    }
    return this.repository.saveTransitionSeed({
      scope,
      answerRunId,
      kind,
      payload: {
        question: context.snapshot.question,
        answer: buildAnswer(context.snapshot),
        citations: context.snapshot.statements.flatMap((statement) => statement.citations),
      },
      requestId,
    });
  }

  private async executeClaimed(
    scope: AskExecutionScope,
    claimed: AskClaimedExecution,
  ): Promise<AskAnswerRunSnapshot> {
    const { attempt, context } = claimed;
    const controller = new AbortController();
    this.active.set(context.snapshot.answerRunId, controller);
    try {
      const result = await this.provider.execute({
        answerRunId: context.snapshot.answerRunId,
        question: context.snapshot.question,
        mode: context.snapshot.mode,
        evidence: context.evidence,
        signal: controller.signal,
        onPartial: async (partialText) => {
          if (!partialText.trim() || controller.signal.aborted) return;
          await this.repository.appendPartial({
            scope,
            answerRunId: context.snapshot.answerRunId,
            attemptNumber: attempt.attemptNumber,
            partialText,
          });
        },
      });
      if (
        controller.signal.aborted ||
        (await this.repository.isCancelRequested(scope, context.snapshot.answerRunId))
      ) {
        return this.repository.fail({
          scope,
          answerRunId: context.snapshot.answerRunId,
          attemptNumber: attempt.attemptNumber,
          state: 'CANCELLED',
          failure: {
            code: 'CANCELLED',
            message: 'The AnswerRun was cancelled by the user.',
            retryable: true,
            outcomeUnknown: false,
          },
        });
      }
      const citations = this.validateCitations(context, result.citations);
      return this.repository.complete({
        scope,
        answerRunId: context.snapshot.answerRunId,
        attemptNumber: attempt.attemptNumber,
        answer: result.answer,
        citations,
        provider: result.provider,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        (await this.repository
          .isCancelRequested(scope, context.snapshot.answerRunId)
          .catch(() => false))
      ) {
        return this.repository.fail({
          scope,
          answerRunId: context.snapshot.answerRunId,
          attemptNumber: attempt.attemptNumber,
          state: 'CANCELLED',
          failure: {
            code: 'CANCELLED',
            message: 'The AnswerRun was cancelled by the user.',
            retryable: true,
            outcomeUnknown: false,
          },
        });
      }
      const failure = this.failureFrom(error);
      return this.repository.fail({
        scope,
        answerRunId: context.snapshot.answerRunId,
        attemptNumber: attempt.attemptNumber,
        state: failure.outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
        failure,
      });
    } finally {
      this.active.delete(context.snapshot.answerRunId);
    }
  }

  private validateCitations(
    context: AskExecutionRunContext,
    citations: readonly AskAnswerProviderCitation[],
  ): readonly AskCitationView[] {
    const byEvidence = new Map(context.evidence.map((evidence) => [evidence.evidenceId, evidence]));
    return citations.map((citation, index) => {
      const evidence = byEvidence.get(citation.evidenceId);
      if (!evidence) {
        throw executionError(
          'VALIDATION_ERROR',
          `Provider citation ${index + 1} is not part of the selected Evidence.`,
          'validate-citations',
        );
      }
      if (citation.exactQuote !== undefined && citation.exactQuote !== evidence.exactQuote) {
        throw executionError(
          'VALIDATION_ERROR',
          `Provider citation ${index + 1} does not match the selected Evidence quote.`,
          'validate-citations',
        );
      }
      return {
        citationId: `citation-${randomUUID()}`,
        sourceId: evidence.sourceId,
        sourceVersionId: evidence.sourceVersionId,
        evidenceId: evidence.evidenceId,
        exactQuote: evidence.exactQuote,
      };
    });
  }

  private failureFrom(error: unknown): AskAnswerRunFailure {
    if (error instanceof ShotgunError) {
      return {
        code: error.code,
        message: error.message,
        retryable: error.retryable || retryableFailureCodes.has(error.code),
        outcomeUnknown: error.code === 'OUTCOME_UNKNOWN',
      };
    }
    return {
      code: 'TERMINAL_FAILURE',
      message: error instanceof Error ? error.message : 'The AnswerRun provider failed.',
      retryable: false,
      outcomeUnknown: false,
    };
  }
}

export type AskAnswerRunTransitionSeedRequestForService = AskAnswerRunTransitionSeedRequest;
