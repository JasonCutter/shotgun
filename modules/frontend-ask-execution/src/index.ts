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
  sha256Text,
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
  /** Server-derived membership scopes used by authoritative context resolution. */
  readonly accessScope?: readonly string[];
};

export type AskExecutionEvidence = {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly exactQuote: string;
  readonly sensitivity: AskExecutionScope['sensitivityClearance'];
};

export type AskExecutionSourceVersionContext = {
  readonly kind: 'SOURCE_VERSION';
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly contentHash: string;
  readonly mediaType: 'text/plain';
  readonly text: string;
  readonly sensitivity: AskExecutionScope['sensitivityClearance'];
};

export type AskExecutionContextItem =
  ({ readonly kind: 'EVIDENCE' } & AskExecutionEvidence) | AskExecutionSourceVersionContext;

export type AskSourceVersionContextReaderPort = {
  resolve(input: {
    readonly scope: AskExecutionScope;
    readonly sourceId: string;
    readonly sourceVersionId: string;
  }): Promise<AskExecutionSourceVersionContext | undefined>;
};

export type AskAnswerProviderCitation = {
  readonly evidenceId: string;
  readonly exactQuote?: string;
};

export type AskAnswerProviderRequest = {
  readonly answerRunId: string;
  readonly question: string;
  readonly mode: AskAnswerRunSnapshot['mode'];
  readonly context: readonly AskExecutionContextItem[];
  readonly resolvedContextDigest: string;
  readonly queryPlanRevision: string;
  readonly dataPolicyVersion: string;
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
  readonly resolvedContextDigest: string;
  readonly queryPlanRevision: string;
  readonly resolvedSensitivity: AskExecutionScope['sensitivityClearance'];
  readonly dataPolicyVersion?: string;
  readonly providerResponseId?: string;
  readonly leaseOwner?: string;
};

export type AskWorkerLeaseState = 'OWNED' | 'CANCEL_REQUESTED' | 'LEASE_LOST' | 'TERMINAL';

export type AskExecutionContextStatus = 'SUPPORTED' | 'NO_SUPPORTED_ANSWER';

export type AskExecutionRunContext = {
  readonly snapshot: AskAnswerRunSnapshot;
  readonly evidence: readonly AskExecutionEvidence[];
  readonly context: readonly AskExecutionContextItem[];
  readonly contextStatus: AskExecutionContextStatus;
  readonly resolvedContextDigest: string;
  readonly queryPlanRevision: string;
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
    workerId?: string,
  ): Promise<AskClaimedExecution | undefined>;
  retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
    readonly workerId?: string;
  }): Promise<AskClaimedExecution>;
  requestCancel(scope: AskExecutionScope, answerRunId: string): Promise<AskAnswerRunSnapshot>;
  isCancelRequested(scope: AskExecutionScope, answerRunId: string): Promise<boolean>;
  appendPartial(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly attemptNumber: number;
    readonly partialText: string;
    readonly workerId: string;
  }): Promise<void>;
  complete(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly answer: string;
    readonly citations: readonly AskCitationView[];
    readonly provider: AskAnswerRunProvider;
    readonly providerResponseId?: string;
    readonly dataPolicyVersion?: string;
    readonly resolvedContextDigest?: string;
    readonly queryPlanRevision?: string;
    readonly usage?: AskAnswerRunUsage;
    readonly workerId: string;
  }): Promise<AskAnswerRunSnapshot>;
  fail(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly failure: AskAnswerRunFailure;
    readonly state: Extract<AskAnswerRunState, 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED'>;
    readonly workerId: string;
  }): Promise<AskAnswerRunSnapshot>;
  getEvents(
    scope: AskExecutionScope,
    answerRunId: string,
    afterOrdinal?: number,
  ): Promise<readonly AskAnswerRunEventView[]>;
  setAttemptAudit(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly dataPolicyVersion: string;
    readonly workerId: string;
  }): Promise<void>;
  heartbeatAttempt(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly workerId: string;
  }): Promise<AskWorkerLeaseState>;
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
  findExportByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunExportView | undefined>;
  findFeedbackByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView | undefined>;
  findTransitionSeedByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView | undefined>;
  transaction<T>(action: (transaction: AskExecutionTransactionPort) => Promise<T>): Promise<T>;
  recoverInterrupted(): Promise<number>;
  claimQueuedForWorker(
    workerId?: string,
    limit?: number,
  ): Promise<
    readonly {
      readonly scope: AskExecutionScope;
      readonly claimed: AskClaimedExecution;
    }[]
  >;
};

export type AskExecutionTransactionPort = {
  readonly rawTransaction: unknown;
  afterCommit(action: () => void): void;
  getRunContext(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskExecutionRunContext | undefined>;
  requestCancel(scope: AskExecutionScope, answerRunId: string): Promise<AskAnswerRunSnapshot>;
  retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
    readonly workerId?: string;
  }): Promise<AskClaimedExecution>;
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

const sensitivityRank = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
} as const;

export const highestSensitivity = (
  context: readonly { readonly sensitivity: AskExecutionScope['sensitivityClearance'] }[],
): AskExecutionScope['sensitivityClearance'] =>
  context.reduce<AskExecutionScope['sensitivityClearance']>(
    (highest, item) =>
      sensitivityRank[item.sensitivity] > sensitivityRank[highest] ? item.sensitivity : highest,
    'public',
  );

export const askExecutionContextDigest = (input: {
  readonly queryPlanRevision: string;
  readonly projectId: string;
  readonly mode: AskAnswerRunSnapshot['mode'];
  readonly question: string;
  readonly context: readonly AskExecutionContextItem[];
}): string =>
  sha256Text(
    stableJson({
      queryPlanRevision: input.queryPlanRevision,
      projectId: input.projectId,
      mode: input.mode,
      question: input.question,
      context: input.context.map((item) =>
        item.kind === 'EVIDENCE'
          ? {
              kind: item.kind,
              evidenceId: item.evidenceId,
              sourceId: item.sourceId,
              sourceVersionId: item.sourceVersionId,
              exactQuote: item.exactQuote,
            }
          : {
              kind: item.kind,
              sourceId: item.sourceId,
              sourceVersionId: item.sourceVersionId,
              contentHash: item.contentHash,
              mediaType: item.mediaType,
              representationDigest: sha256Text(item.text),
            },
      ),
    }),
  );

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
  private readonly active = new Map<
    string,
    { readonly attemptId: string; readonly controller: AbortController }
  >();
  private readonly inFlight = new Map<string, Promise<AskAnswerRunSnapshot>>();
  private readonly workerId = `ask-worker-${process.pid}-${randomUUID()}`;
  private readonly maxConcurrency: number;

  constructor(
    private readonly repository: AskAnswerExecutionRepositoryPort,
    private readonly provider: AskAnswerProviderPort,
    options: { readonly maxConcurrency?: number } = {},
  ) {
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 4));
  }

  async enqueue(input: AskExecutionScope & { readonly answerRunId: string }): Promise<void> {
    // HTTP enqueue is only a wake hint. The durable worker owns claim and execution.
    void input;
  }

  async execute(scope: AskExecutionScope, answerRunId: string): Promise<AskAnswerRunSnapshot> {
    const claimed = await this.repository.claimInitial(scope, answerRunId, this.workerId);
    if (!claimed) {
      const current = await this.repository.getRunContext(scope, answerRunId);
      if (!current) throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'execute');
      return current.snapshot;
    }
    return this.runClaimed(scope, claimed);
  }

  async cancel(
    scope: AskExecutionScope,
    answerRunId: string,
    transaction?: AskExecutionTransactionPort,
  ): Promise<AskAnswerRunSnapshot> {
    const snapshot = transaction
      ? await transaction.requestCancel(scope, answerRunId)
      : await this.repository.requestCancel(scope, answerRunId);
    const abortActive = () => this.active.get(answerRunId)?.controller.abort();
    if (transaction) transaction.afterCommit(abortActive);
    else abortActive();
    return snapshot;
  }

  async retry(
    scope: AskExecutionScope,
    answerRunId: string,
    mode: AskAnswerRunRetryMode,
    transaction?: AskExecutionTransactionPort,
  ): Promise<AskAnswerRunSnapshot> {
    const claimed = transaction
      ? await transaction.retryAndClaim({ scope, answerRunId, mode, workerId: this.workerId })
      : await this.repository.retryAndClaim({ scope, answerRunId, mode, workerId: this.workerId });
    const start = () => void this.runClaimed(scope, claimed);
    if (transaction) transaction.afterCommit(start);
    else start();
    return { ...claimed.context.snapshot, attemptId: claimed.attempt.attemptId };
  }

  async withCommandTransaction<T>(
    action: (transaction: AskExecutionTransactionPort) => Promise<T>,
  ): Promise<T> {
    return this.repository.transaction(action);
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
    transaction?: AskExecutionTransactionPort,
  ): Promise<AskAnswerRunExportView> {
    const execution: Pick<AskAnswerExecutionRepositoryPort, 'getRunContext' | 'saveExport'> =
      transaction ?? this.repository;
    const context = await execution.getRunContext(scope, answerRunId);
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
    return execution.saveExport({ scope, answerRunId, format, content, requestId });
  }

  async feedback(
    scope: AskExecutionScope,
    answerRunId: string,
    kind: AskAnswerFeedbackKind,
    comment?: string,
    requestId: string = randomUUID(),
    transaction?: AskExecutionTransactionPort,
  ): Promise<AskAnswerRunFeedbackView> {
    const execution: Pick<AskAnswerExecutionRepositoryPort, 'getRunContext' | 'saveFeedback'> =
      transaction ?? this.repository;
    const context = await execution.getRunContext(scope, answerRunId);
    if (!context) throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'feedback');
    return execution.saveFeedback({
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
    transaction?: AskExecutionTransactionPort,
  ): Promise<AskTransitionSeedView> {
    const execution: Pick<
      AskAnswerExecutionRepositoryPort,
      'getRunContext' | 'saveTransitionSeed'
    > = transaction ?? this.repository;
    const context = await execution.getRunContext(scope, answerRunId);
    if (!context)
      throw executionError('NOT_FOUND', 'The AnswerRun was not found.', 'transition-seed');
    if (context.snapshot.state !== 'SUCCEEDED') {
      throw executionError(
        'INVALID_REQUEST',
        'Only a succeeded AnswerRun can create a transition seed.',
        'transition-seed',
      );
    }
    return execution.saveTransitionSeed({
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

  async findExportByRequestId(
    scope: AskExecutionScope,
    answerRunId: string,
    requestId: string,
  ): Promise<AskAnswerRunExportView | undefined> {
    return this.repository.findExportByRequestId({ scope, answerRunId, requestId });
  }

  async findFeedbackByRequestId(
    scope: AskExecutionScope,
    answerRunId: string,
    requestId: string,
  ): Promise<AskAnswerRunFeedbackView | undefined> {
    return this.repository.findFeedbackByRequestId({ scope, answerRunId, requestId });
  }

  async findTransitionSeedByRequestId(
    scope: AskExecutionScope,
    answerRunId: string,
    kind: AskTransitionSeedKind,
    requestId: string,
  ): Promise<AskTransitionSeedView | undefined> {
    return this.repository.findTransitionSeedByRequestId({
      scope,
      answerRunId,
      kind,
      requestId,
    });
  }

  async startWorker(intervalMs = 1000): Promise<() => Promise<void>> {
    let activeTick: Promise<void> | undefined;
    let stopRequested = false;
    const tick = (): Promise<void> => {
      if (stopRequested) return Promise.resolve();
      if (activeTick) return activeTick;
      activeTick = (async () => {
        await this.repository.recoverInterrupted();
        if (stopRequested) return;
        const capacity = this.maxConcurrency - this.inFlight.size;
        if (capacity <= 0) return;
        const claimed = await this.repository.claimQueuedForWorker(this.workerId, capacity);
        for (const { scope, claimed: execution } of claimed) {
          if (this.inFlight.size >= this.maxConcurrency) break;
          void this.runClaimed(scope, execution);
        }
      })().finally(() => {
        activeTick = undefined;
      });
      return activeTick;
    };
    await tick();
    const timer = setInterval(() => {
      void tick().catch((error: unknown) => {
        // A worker tick failure must remain observable; the next tick retries the durable scan.
        console.error('[ask-answer-worker] tick failed', error);
      });
    }, intervalMs);
    return async () => {
      stopRequested = true;
      clearInterval(timer);
      while (activeTick || this.inFlight.size > 0) {
        const tickInFlight = activeTick;
        if (tickInFlight) await Promise.allSettled([tickInFlight]);
        const executions = [...this.inFlight.values()];
        if (executions.length > 0) await Promise.allSettled(executions);
      }
    };
  }

  private runClaimed(
    scope: AskExecutionScope,
    claimed: AskClaimedExecution,
  ): Promise<AskAnswerRunSnapshot> {
    const key = claimed.attempt.attemptId;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const execution = this.executeClaimed(scope, claimed);
    this.inFlight.set(key, execution);
    void execution
      .catch((error: unknown) => {
        console.error('[ask-answer-worker] execution failed', error);
      })
      .finally(() => {
        if (this.inFlight.get(key) === execution) this.inFlight.delete(key);
      });
    return execution;
  }

  private async executeClaimed(
    scope: AskExecutionScope,
    claimed: AskClaimedExecution,
  ): Promise<AskAnswerRunSnapshot> {
    const { attempt, context } = claimed;
    const workerId = attempt.leaseOwner ?? this.workerId;
    const controller = new AbortController();
    this.active.set(context.snapshot.answerRunId, {
      attemptId: attempt.attemptId,
      controller,
    });
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.repository
        .heartbeatAttempt({
          scope,
          answerRunId: context.snapshot.answerRunId,
          attemptId: attempt.attemptId,
          workerId,
        })
        .then((state) => {
          if (state === 'CANCEL_REQUESTED') {
            controller.abort();
          } else if (state === 'LEASE_LOST' || state === 'TERMINAL') {
            leaseLost = true;
            controller.abort();
          }
        })
        .catch(() => {
          leaseLost = true;
          controller.abort();
        });
    }, 5_000);
    try {
      await this.repository.setAttemptAudit({
        scope,
        answerRunId: context.snapshot.answerRunId,
        attemptId: attempt.attemptId,
        dataPolicyVersion: this.provider.identity.dataPolicyVersion,
        workerId,
      });
      if (context.contextStatus === 'NO_SUPPORTED_ANSWER') {
        return this.repository.complete({
          scope,
          answerRunId: context.snapshot.answerRunId,
          attemptNumber: attempt.attemptNumber,
          answer: 'No supported answer was found in the authoritative context.',
          citations: [],
          provider: {
            provider: 'shotgun-context-resolver',
            model: 'no-supported-answer',
            adapterVersion: '1.0.0',
          },
          dataPolicyVersion: 'context-resolver-v1',
          resolvedContextDigest: context.resolvedContextDigest,
          queryPlanRevision: context.queryPlanRevision,
          workerId,
        });
      }
      const result = await this.provider.execute({
        answerRunId: context.snapshot.answerRunId,
        question: context.snapshot.question,
        mode: context.snapshot.mode,
        context: context.context,
        resolvedContextDigest: context.resolvedContextDigest,
        queryPlanRevision: context.queryPlanRevision,
        dataPolicyVersion: this.provider.identity.dataPolicyVersion,
        signal: controller.signal,
        onPartial: async (partialText) => {
          if (!partialText.trim() || controller.signal.aborted) return;
          await this.repository.appendPartial({
            scope,
            answerRunId: context.snapshot.answerRunId,
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
            partialText,
            workerId,
          });
        },
      });
      const cancellation = await this.cancellationStatus(
        scope,
        context.snapshot.answerRunId,
        controller,
      );
      if (leaseLost || cancellation.lookupError) {
        return this.repository.fail({
          scope,
          answerRunId: context.snapshot.answerRunId,
          attemptNumber: attempt.attemptNumber,
          state: 'OUTCOME_UNKNOWN',
          failure: {
            code: 'OUTCOME_UNKNOWN',
            message: 'The worker lease or cancellation state could not be resolved.',
            retryable: false,
            outcomeUnknown: true,
          },
          workerId,
        });
      }
      if (cancellation.requested) {
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
          workerId,
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
        ...(result.providerResponseId === undefined
          ? {}
          : { providerResponseId: result.providerResponseId }),
        dataPolicyVersion: this.provider.identity.dataPolicyVersion,
        resolvedContextDigest: context.resolvedContextDigest,
        queryPlanRevision: context.queryPlanRevision,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        workerId,
      });
    } catch (error) {
      const cancellation = await this.cancellationStatus(
        scope,
        context.snapshot.answerRunId,
        controller,
      );
      if (leaseLost || cancellation.lookupError) {
        return this.repository.fail({
          scope,
          answerRunId: context.snapshot.answerRunId,
          attemptNumber: attempt.attemptNumber,
          state: 'OUTCOME_UNKNOWN',
          failure: {
            code: 'OUTCOME_UNKNOWN',
            message: 'The worker lease or cancellation state could not be resolved.',
            retryable: false,
            outcomeUnknown: true,
          },
          workerId,
        });
      }
      if (cancellation.requested) {
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
          workerId,
        });
      }
      const failure = this.failureFrom(error);
      return this.repository.fail({
        scope,
        answerRunId: context.snapshot.answerRunId,
        attemptNumber: attempt.attemptNumber,
        state: failure.outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
        failure,
        workerId,
      });
    } finally {
      clearInterval(heartbeat);
      const current = this.active.get(context.snapshot.answerRunId);
      if (current?.attemptId === attempt.attemptId) {
        this.active.delete(context.snapshot.answerRunId);
      }
    }
  }

  private async cancellationStatus(
    scope: AskExecutionScope,
    answerRunId: string,
    controller: AbortController,
  ): Promise<{ readonly requested: boolean; readonly lookupError?: unknown }> {
    if (controller.signal.aborted) return { requested: true };
    try {
      return {
        requested: await this.repository.isCancelRequested(scope, answerRunId),
      };
    } catch (lookupError) {
      return { requested: false, lookupError };
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
