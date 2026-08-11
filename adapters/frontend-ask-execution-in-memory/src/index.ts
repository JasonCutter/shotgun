import { randomUUID } from 'node:crypto';

import {
  ASK_SCHEMA_VERSION,
  ShotgunError,
  type AskAnswerRunEventView,
  type AskAnswerRunExportView,
  type AskAnswerRunFeedbackView,
  type AskAnswerRunProvider,
  type AskAnswerRunRetryMode,
  type AskAnswerRunSnapshot,
  type AskAnswerRunUsage,
  type AskAnswerRunState,
  type AskAnswerRunFailure,
  type AskAnswerRunEventKind,
  type AskAnswerExportFormat,
  type AskAnswerFeedbackKind,
  type AskCitationView,
  type AskTransitionSeedKind,
  type AskTransitionSeedPayload,
  type AskTransitionSeedView,
} from '../../../packages/contracts/src/index.js';
import {
  askExecutionContextDigest,
  highestSensitivity,
} from '../../../modules/frontend-ask-execution/src/index.js';
import type {
  AskAnswerExecutionRepositoryPort,
  AskClaimedExecution,
  AskExecutionAttempt,
  AskExecutionEvidence,
  AskExecutionRunContext,
  AskExecutionScope,
  AskExecutionSourceVersionContext,
  AskExecutionTransactionPort,
  AskWorkerLeaseState,
} from '../../../modules/frontend-ask-execution/src/index.js';

type RecordValue = {
  snapshot: AskAnswerRunSnapshot;
  evidence: readonly AskExecutionEvidence[];
  sourceVersions: readonly AskExecutionSourceVersionContext[];
  events: AskAnswerRunEventView[];
  attempts: AskExecutionAttempt[];
  contexts: Map<string, AskExecutionRunContext>;
  exports: Map<string, AskAnswerRunExportView>;
  feedback: Map<string, AskAnswerRunFeedbackView>;
  transitionSeeds: Map<string, AskTransitionSeedView>;
  leaseExpiresAt: Map<string, number>;
  cancelRequested: boolean;
};

const failure = (code: 'NOT_FOUND' | 'INVALID_REQUEST', message: string): ShotgunError =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'frontend-ask-execution-in-memory',
    operation: 'execution',
  });

const now = (): string => new Date().toISOString();
export class InMemoryAskAnswerExecutionRepository implements AskAnswerExecutionRepositoryPort {
  private readonly records = new Map<string, RecordValue>();

  constructor(private readonly publish: (snapshot: AskAnswerRunSnapshot) => void = () => {}) {}

  register(
    snapshot: AskAnswerRunSnapshot,
    evidence: readonly AskExecutionEvidence[] = [],
    sourceVersions: readonly AskExecutionSourceVersionContext[] = [],
  ): void {
    const events: AskAnswerRunEventView[] =
      snapshot.state === 'QUEUED'
        ? [
            {
              schemaVersion: ASK_SCHEMA_VERSION,
              eventId: `event-${snapshot.answerRunId}-queued`,
              answerRunId: snapshot.answerRunId,
              projectId: snapshot.projectId,
              ordinal: 0,
              kind: 'STATE',
              state: 'QUEUED',
              answerRevision: snapshot.answerRevision,
              createdAt: snapshot.createdAt,
            },
          ]
        : [];
    this.records.set(snapshot.answerRunId, {
      snapshot,
      evidence,
      sourceVersions,
      events,
      attempts: [],
      contexts: new Map(),
      exports: new Map(),
      feedback: new Map(),
      transitionSeeds: new Map(),
      leaseExpiresAt: new Map(),
      cancelRequested: false,
    });
  }

  async getRunContext(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskExecutionRunContext | undefined> {
    const record = this.authorized(scope, answerRunId, false);
    return record ? this.contextFor(record, record.evidence) : undefined;
  }

  async claimInitial(
    scope: AskExecutionScope,
    answerRunId: string,
    workerId = `ask-worker-in-memory-${randomUUID()}`,
  ): Promise<AskClaimedExecution | undefined> {
    const record = this.authorized(scope, answerRunId);
    if (record.snapshot.state !== 'QUEUED') return undefined;
    const context = this.contextFor(record, record.evidence);
    const attempt: AskExecutionAttempt = {
      attemptId: `attempt-${randomUUID()}`,
      attemptNumber: record.attempts.length + 1,
      kind: 'INITIAL',
      accessRevision: record.snapshot.accessRevision,
      policyContextRevision: record.snapshot.policyContextRevision,
      resolvedContextDigest: context.resolvedContextDigest,
      queryPlanRevision: context.queryPlanRevision,
      resolvedSensitivity: highestSensitivity(context.context),
      leaseOwner: workerId,
    };
    record.attempts.push(attempt);
    record.leaseExpiresAt.set(attempt.attemptId, Date.now() + 30_000);
    record.cancelRequested = false;
    this.update(record, {
      state: 'RUNNING',
      attentionReason: undefined,
      capabilities: ['CANCEL'],
      attemptNumber: attempt.attemptNumber,
      eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
      failure: undefined,
      partialText: undefined,
    });
    const claimed = { attempt, context: { ...context, snapshot: record.snapshot } };
    record.contexts.set(attempt.attemptId, claimed.context);
    return claimed;
  }

  async retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
    readonly workerId?: string;
  }): Promise<AskClaimedExecution> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (!['FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN'].includes(record.snapshot.state)) {
      throw failure(
        'INVALID_REQUEST',
        'Only a failed, cancelled, or outcome-unknown AnswerRun can retry.',
      );
    }
    const previous = record.attempts.at(-1);
    const context =
      input.mode === 'SAME_CONTEXT' && previous
        ? (record.contexts.get(previous.attemptId) ?? this.contextFor(record, record.evidence))
        : this.contextFor(record, record.evidence);
    const attempt: AskExecutionAttempt = {
      attemptId: `attempt-${randomUUID()}`,
      attemptNumber: record.attempts.length + 1,
      kind: input.mode === 'SAME_CONTEXT' ? 'RETRY_SAME_CONTEXT' : 'RETRY_CURRENT_POLICY',
      accessRevision:
        input.mode === 'SAME_CONTEXT' ? record.snapshot.accessRevision : input.scope.accessRevision,
      policyContextRevision:
        input.mode === 'SAME_CONTEXT'
          ? record.snapshot.policyContextRevision
          : input.scope.policyContextRevision,
      resolvedContextDigest: context.resolvedContextDigest,
      queryPlanRevision: context.queryPlanRevision,
      resolvedSensitivity: highestSensitivity(context.context),
      leaseOwner: input.workerId ?? `ask-worker-in-memory-${randomUUID()}`,
    };
    record.attempts.push(attempt);
    record.leaseExpiresAt.set(attempt.attemptId, Date.now() + 30_000);
    record.cancelRequested = false;
    this.update(record, {
      state: 'RUNNING',
      capabilities: ['CANCEL'],
      accessRevision: attempt.accessRevision,
      policyContextRevision: attempt.policyContextRevision,
      attemptNumber: attempt.attemptNumber,
      eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
      failure: undefined,
      partialText: undefined,
    });
    const claimed = { attempt, context: { ...context, snapshot: record.snapshot } };
    record.contexts.set(attempt.attemptId, claimed.context);
    return claimed;
  }

  async requestCancel(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskAnswerRunSnapshot> {
    const record = this.authorized(scope, answerRunId);
    if (record.snapshot.state === 'QUEUED') {
      record.cancelRequested = true;
      this.update(record, {
        state: 'CANCELLED',
        capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
        eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
        failure: {
          code: 'CANCELLED',
          message: 'The AnswerRun was cancelled by the user.',
          retryable: true,
          outcomeUnknown: false,
        },
      });
      return record.snapshot;
    }
    if (!['RUNNING', 'STREAMING', 'PARTIAL', 'CANCEL_REQUESTED'].includes(record.snapshot.state)) {
      throw failure('INVALID_REQUEST', 'Only an active AnswerRun can be cancelled.');
    }
    record.cancelRequested = true;
    if (record.snapshot.state !== 'CANCEL_REQUESTED') {
      this.update(record, {
        state: 'CANCEL_REQUESTED',
        capabilities: [],
        eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
      });
    }
    return record.snapshot;
  }

  async isCancelRequested(scope: AskExecutionScope, answerRunId: string): Promise<boolean> {
    return this.authorized(scope, answerRunId).cancelRequested;
  }

  async appendPartial(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly attemptNumber: number;
    readonly partialText: string;
    readonly workerId: string;
  }): Promise<void> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (
      record.snapshot.attemptNumber !== input.attemptNumber ||
      !this.ownsLiveAttempt(record, input.attemptId, input.attemptNumber, input.workerId) ||
      record.cancelRequested
    )
      return;
    if (record.snapshot.state === 'RUNNING') {
      this.update(record, {
        state: 'STREAMING',
        eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
        attemptId: input.attemptId,
      });
    }
    this.update(record, {
      state: 'PARTIAL',
      partialText: input.partialText,
      eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
      attemptId: input.attemptId,
    });
  }

  async complete(input: {
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
  }): Promise<AskAnswerRunSnapshot> {
    const record = this.authorized(input.scope, input.answerRunId);
    const attempt = record.attempts.at(-1);
    if (
      record.snapshot.attemptNumber !== input.attemptNumber ||
      record.cancelRequested ||
      !attempt ||
      !this.ownsLiveAttempt(record, attempt.attemptId, input.attemptNumber, input.workerId)
    ) {
      return record.snapshot;
    }
    Object.assign(attempt, {
      ...(input.providerResponseId === undefined
        ? {}
        : { providerResponseId: input.providerResponseId }),
      ...(input.dataPolicyVersion === undefined
        ? {}
        : { dataPolicyVersion: input.dataPolicyVersion }),
    });
    this.update(record, {
      state: 'SUCCEEDED',
      capabilities: [
        'EXPORT',
        'CREATE_INTAKE_DRAFT',
        'CREATE_DRAFT_CHANGE_SET',
        'PROPOSE_DIRECTIVE',
      ],
      statements: [
        {
          statementId: `statement-${randomUUID()}`,
          text: input.answer,
          citations: input.citations,
        },
      ],
      provider: input.provider,
      usage: input.usage,
      partialText: undefined,
      eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
      attemptId: record.attempts.at(-1)?.attemptId,
    });
    return record.snapshot;
  }

  async fail(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly failure: AskAnswerRunFailure;
    readonly state: Extract<AskAnswerRunState, 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED'>;
    readonly workerId: string;
  }): Promise<AskAnswerRunSnapshot> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (
      (record.snapshot.attemptNumber !== input.attemptNumber &&
        record.snapshot.state !== 'CANCEL_REQUESTED') ||
      !this.ownsLiveAttempt(
        record,
        record.attempts.at(-1)?.attemptId ?? '',
        input.attemptNumber,
        input.workerId,
        input.state === 'CANCELLED',
      )
    ) {
      return record.snapshot;
    }
    this.update(record, {
      state: input.state,
      capabilities:
        input.state === 'FAILED' || input.state === 'OUTCOME_UNKNOWN' || input.state === 'CANCELLED'
          ? ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY']
          : [],
      failure: input.failure,
      eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
    });
    return record.snapshot;
  }

  async getEvents(
    scope: AskExecutionScope,
    answerRunId: string,
    afterOrdinal = -1,
  ): Promise<readonly AskAnswerRunEventView[]> {
    return this.authorized(scope, answerRunId).events.filter(
      (event) => event.ordinal > afterOrdinal,
    );
  }

  async saveExport(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly format: AskAnswerExportFormat;
    readonly content: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunExportView> {
    const record = this.authorized(input.scope, input.answerRunId);
    const key = `${input.scope.principalId}:${input.requestId}`;
    const existing = record.exports.get(key);
    if (existing) return existing;
    const result = {
      schemaVersion: ASK_SCHEMA_VERSION,
      exportId: `export-${randomUUID()}`,
      answerRunId: record.snapshot.answerRunId,
      projectId: record.snapshot.projectId,
      format: input.format,
      content: input.content,
      createdAt: now(),
    };
    record.exports.set(key, result);
    return result;
  }

  async saveFeedback(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskAnswerFeedbackKind;
    readonly comment?: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView> {
    const record = this.authorized(input.scope, input.answerRunId);
    const key = `${input.scope.principalId}:${input.requestId}`;
    const existing = record.feedback.get(key);
    if (existing) return existing;
    const result = {
      schemaVersion: ASK_SCHEMA_VERSION,
      feedbackId: `feedback-${randomUUID()}`,
      answerRunId: record.snapshot.answerRunId,
      projectId: record.snapshot.projectId,
      kind: input.kind,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      createdAt: now(),
    };
    record.feedback.set(key, result);
    return result;
  }

  async saveTransitionSeed(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly payload: AskTransitionSeedPayload;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView> {
    const record = this.authorized(input.scope, input.answerRunId);
    const key = `${input.scope.principalId}:${input.kind}:${input.requestId}`;
    const existing = record.transitionSeeds.get(key);
    if (existing) return existing;
    const result = {
      schemaVersion: ASK_SCHEMA_VERSION,
      seedId: `seed-${randomUUID()}`,
      answerRunId: record.snapshot.answerRunId,
      projectId: record.snapshot.projectId,
      kind: input.kind,
      state: 'PROPOSED' as const,
      payload: input.payload,
      createdAt: now(),
    };
    record.transitionSeeds.set(key, result);
    return result;
  }

  async findExportByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunExportView | undefined> {
    return this.authorized(input.scope, input.answerRunId).exports.get(
      `${input.scope.principalId}:${input.requestId}`,
    );
  }

  async findFeedbackByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView | undefined> {
    return this.authorized(input.scope, input.answerRunId).feedback.get(
      `${input.scope.principalId}:${input.requestId}`,
    );
  }

  async findTransitionSeedByRequestId(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView | undefined> {
    return this.authorized(input.scope, input.answerRunId).transitionSeeds.get(
      `${input.scope.principalId}:${input.kind}:${input.requestId}`,
    );
  }

  async setAttemptAudit(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly dataPolicyVersion: string;
    readonly workerId: string;
  }): Promise<void> {
    const record = this.authorized(input.scope, input.answerRunId);
    const attempt = record.attempts.find((candidate) => candidate.attemptId === input.attemptId);
    if (attempt && attempt.leaseOwner === input.workerId) {
      Object.assign(attempt, { dataPolicyVersion: input.dataPolicyVersion });
    }
  }

  async heartbeatAttempt(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptId: string;
    readonly workerId: string;
  }): Promise<AskWorkerLeaseState> {
    const record = this.authorized(input.scope, input.answerRunId, false);
    if (!record) return 'TERMINAL';
    if (record.snapshot.state === 'CANCEL_REQUESTED') return 'CANCEL_REQUESTED';
    if (['CANCELLED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(record.snapshot.state))
      return 'TERMINAL';
    const attempt = record.attempts.find((candidate) => candidate.attemptId === input.attemptId);
    if (!attempt || attempt.leaseOwner !== input.workerId) return 'LEASE_LOST';
    const leaseExpiresAt = record.leaseExpiresAt.get(input.attemptId) ?? 0;
    if (leaseExpiresAt < Date.now()) return 'LEASE_LOST';
    record.leaseExpiresAt.set(input.attemptId, Date.now() + 30_000);
    return 'OWNED';
  }

  async transaction<T>(
    action: (transaction: AskExecutionTransactionPort) => Promise<T>,
  ): Promise<T> {
    const callbacks: (() => void)[] = [];
    const transaction: AskExecutionTransactionPort = {
      rawTransaction: this,
      afterCommit: (callback) => callbacks.push(callback),
      getRunContext: (scope, answerRunId) => this.getRunContext(scope, answerRunId),
      requestCancel: (scope, answerRunId) => this.requestCancel(scope, answerRunId),
      retryAndClaim: (input) => this.retryAndClaim(input),
      saveExport: (input) => this.saveExport(input),
      saveFeedback: (input) => this.saveFeedback(input),
      saveTransitionSeed: (input) => this.saveTransitionSeed(input),
    };
    const result = await action(transaction);
    for (const callback of callbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[frontend-ask-execution-in-memory] post-commit callback failed', error);
      }
    }
    return result;
  }

  async recoverInterrupted(): Promise<number> {
    let recovered = 0;
    for (const record of this.records.values()) {
      const attempt = record.attempts.at(-1);
      const leaseExpired =
        attempt !== undefined && (record.leaseExpiresAt.get(attempt.attemptId) ?? 0) < Date.now();
      if (
        attempt &&
        leaseExpired &&
        ['RUNNING', 'STREAMING', 'PARTIAL'].includes(record.snapshot.state)
      ) {
        record.leaseExpiresAt.set(attempt.attemptId, Date.now() + 1_000);
        await this.fail({
          scope: this.scopeFor(record.snapshot),
          answerRunId: record.snapshot.answerRunId,
          attemptNumber: record.snapshot.attemptNumber ?? 0,
          state: 'OUTCOME_UNKNOWN',
          failure: {
            code: 'OUTCOME_UNKNOWN',
            message: 'The execution worker stopped before the provider outcome was known.',
            retryable: false,
            outcomeUnknown: true,
          },
          workerId: attempt.leaseOwner ?? 'ask-worker-recovery',
        });
        recovered += 1;
      } else if (attempt && leaseExpired && record.snapshot.state === 'CANCEL_REQUESTED') {
        record.leaseExpiresAt.set(attempt.attemptId, Date.now() + 1_000);
        await this.fail({
          scope: this.scopeFor(record.snapshot),
          answerRunId: record.snapshot.answerRunId,
          attemptNumber: record.snapshot.attemptNumber ?? 0,
          state: 'CANCELLED',
          failure: {
            code: 'CANCELLED',
            message: 'The execution was cancelled after worker recovery.',
            retryable: true,
            outcomeUnknown: false,
          },
          workerId: attempt.leaseOwner ?? 'ask-worker-recovery',
        });
        recovered += 1;
      }
    }
    return recovered;
  }

  async claimQueuedForWorker(
    workerId?: string,
    limit = 32,
  ): Promise<readonly { scope: AskExecutionScope; claimed: AskClaimedExecution }[]> {
    const claimed: { scope: AskExecutionScope; claimed: AskClaimedExecution }[] = [];
    for (const record of this.records.values()) {
      if (claimed.length >= limit) break;
      if (record.snapshot.state !== 'QUEUED') continue;
      const scope = this.scopeFor(record.snapshot);
      const execution = await this.claimInitial(
        scope,
        record.snapshot.answerRunId,
        workerId ?? `ask-worker-in-memory-${randomUUID()}`,
      );
      if (execution) claimed.push({ scope, claimed: execution });
    }
    return claimed;
  }

  private authorized(scope: AskExecutionScope, answerRunId: string, required = true): RecordValue {
    const record = this.records.get(answerRunId);
    if (!record || record.snapshot.projectId !== scope.projectId) {
      if (!required) return undefined as unknown as RecordValue;
      throw failure('NOT_FOUND', 'The requested AnswerRun was not found.');
    }
    return record;
  }

  private ownsLiveAttempt(
    record: RecordValue,
    attemptId: string,
    attemptNumber: number,
    workerId: string,
    allowCancelRequested = false,
  ): boolean {
    const runState = record.snapshot.state;
    if (
      !['RUNNING', 'STREAMING', 'PARTIAL'].includes(runState) &&
      !(allowCancelRequested && runState === 'CANCEL_REQUESTED')
    )
      return false;
    const attempt = record.attempts.find((candidate) => candidate.attemptId === attemptId);
    return Boolean(
      attempt &&
      attempt.attemptNumber === attemptNumber &&
      attempt.leaseOwner === workerId &&
      (record.leaseExpiresAt.get(attemptId) ?? 0) >= Date.now(),
    );
  }

  private update(
    record: RecordValue,
    patch: Partial<AskAnswerRunSnapshot> & { attemptId?: string },
  ): void {
    const previous = record.snapshot;
    const updated: AskAnswerRunSnapshot = {
      ...previous,
      ...patch,
      updatedAt: now(),
      ...(patch.attentionReason === undefined ? {} : { attentionReason: patch.attentionReason }),
    };
    if (updated.state !== 'ACTION_REQUIRED')
      delete (updated as { attentionReason?: unknown }).attentionReason;
    record.snapshot = updated;
    const kind: AskAnswerRunEventKind =
      updated.state === 'SUCCEEDED'
        ? 'COMPLETED'
        : updated.state === 'FAILED' || updated.state === 'OUTCOME_UNKNOWN'
          ? 'FAILED'
          : updated.state === 'CANCELLED'
            ? 'CANCELLED'
            : updated.partialText !== undefined
              ? 'PARTIAL'
              : 'STATE';
    record.events.push({
      schemaVersion: ASK_SCHEMA_VERSION,
      eventId: `event-${randomUUID()}`,
      answerRunId: updated.answerRunId,
      projectId: updated.projectId,
      ordinal: record.events.length,
      kind,
      state: updated.state,
      ...(patch.attemptId === undefined ? {} : { attemptId: patch.attemptId }),
      ...(updated.partialText === undefined ? {} : { partialText: updated.partialText }),
      answerRevision: updated.answerRevision,
      createdAt: updated.updatedAt,
    });
    this.publish(updated);
  }

  private contextFor(
    record: RecordValue,
    evidence: readonly AskExecutionEvidence[],
  ): AskExecutionRunContext {
    const context = [
      ...evidence.map((item) => ({ kind: 'EVIDENCE' as const, ...item })),
      ...record.sourceVersions,
    ];
    const queryPlanRevision = 'ask-query-plan-v3';
    return {
      snapshot: record.snapshot,
      evidence,
      context,
      contextStatus: context.length > 0 ? 'SUPPORTED' : 'NO_SUPPORTED_ANSWER',
      queryPlanRevision,
      resolvedContextDigest: askExecutionContextDigest({
        queryPlanRevision,
        projectId: record.snapshot.projectId,
        mode: record.snapshot.mode,
        question: record.snapshot.question,
        context,
      }),
    };
  }

  private scopeFor(snapshot: AskAnswerRunSnapshot): AskExecutionScope {
    return {
      principalId: 'ask-worker',
      projectId: snapshot.projectId,
      accessRevision: snapshot.accessRevision,
      policyContextRevision: snapshot.policyContextRevision,
      sensitivityClearance: 'restricted',
    };
  }
}
