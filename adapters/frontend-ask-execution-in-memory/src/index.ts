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
import type {
  AskAnswerExecutionRepositoryPort,
  AskClaimedExecution,
  AskExecutionAttempt,
  AskExecutionEvidence,
  AskExecutionRunContext,
  AskExecutionScope,
} from '../../../modules/frontend-ask-execution/src/index.js';

type RecordValue = {
  snapshot: AskAnswerRunSnapshot;
  evidence: readonly AskExecutionEvidence[];
  events: AskAnswerRunEventView[];
  attempts: AskExecutionAttempt[];
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

  register(snapshot: AskAnswerRunSnapshot, evidence: readonly AskExecutionEvidence[] = []): void {
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
      events,
      attempts: [],
      cancelRequested: false,
    });
  }

  async getRunContext(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskExecutionRunContext | undefined> {
    const record = this.authorized(scope, answerRunId, false);
    return record ? { snapshot: record.snapshot, evidence: record.evidence } : undefined;
  }

  async claimInitial(
    scope: AskExecutionScope,
    answerRunId: string,
  ): Promise<AskClaimedExecution | undefined> {
    const record = this.authorized(scope, answerRunId);
    if (record.snapshot.state !== 'QUEUED') return undefined;
    const attempt: AskExecutionAttempt = {
      attemptId: `attempt-${randomUUID()}`,
      attemptNumber: record.attempts.length + 1,
      kind: 'INITIAL',
      accessRevision: record.snapshot.accessRevision,
      policyContextRevision: record.snapshot.policyContextRevision,
    };
    record.attempts.push(attempt);
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
    return { attempt, context: { snapshot: record.snapshot, evidence: record.evidence } };
  }

  async retryAndClaim(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly mode: AskAnswerRunRetryMode;
  }): Promise<AskClaimedExecution> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (!['FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN'].includes(record.snapshot.state)) {
      throw failure(
        'INVALID_REQUEST',
        'Only a failed, cancelled, or outcome-unknown AnswerRun can retry.',
      );
    }
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
    };
    record.attempts.push(attempt);
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
    return { attempt, context: { snapshot: record.snapshot, evidence: record.evidence } };
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
    readonly attemptNumber: number;
    readonly partialText: string;
  }): Promise<void> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (record.snapshot.attemptNumber !== input.attemptNumber || record.cancelRequested) return;
    this.update(record, {
      state: 'PARTIAL',
      partialText: input.partialText,
      eventRevision: (record.snapshot.eventRevision ?? 0) + 1,
    });
  }

  async complete(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly answer: string;
    readonly citations: readonly AskCitationView[];
    readonly provider: AskAnswerRunProvider;
    readonly usage?: AskAnswerRunUsage;
  }): Promise<AskAnswerRunSnapshot> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (record.snapshot.attemptNumber !== input.attemptNumber || record.cancelRequested) {
      return record.snapshot;
    }
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
    });
    return record.snapshot;
  }

  async fail(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly attemptNumber: number;
    readonly failure: AskAnswerRunFailure;
    readonly state: Extract<AskAnswerRunState, 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED'>;
  }): Promise<AskAnswerRunSnapshot> {
    const record = this.authorized(input.scope, input.answerRunId);
    if (
      record.snapshot.attemptNumber !== input.attemptNumber &&
      record.snapshot.state !== 'CANCEL_REQUESTED'
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
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      exportId: `export-${randomUUID()}`,
      answerRunId: record.snapshot.answerRunId,
      projectId: record.snapshot.projectId,
      format: input.format,
      content: input.content,
      createdAt: now(),
    };
  }

  async saveFeedback(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskAnswerFeedbackKind;
    readonly comment?: string;
    readonly requestId: string;
  }): Promise<AskAnswerRunFeedbackView> {
    const record = this.authorized(input.scope, input.answerRunId);
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      feedbackId: `feedback-${randomUUID()}`,
      answerRunId: record.snapshot.answerRunId,
      projectId: record.snapshot.projectId,
      kind: input.kind,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      createdAt: now(),
    };
  }

  async saveTransitionSeed(input: {
    readonly scope: AskExecutionScope;
    readonly answerRunId: string;
    readonly kind: AskTransitionSeedKind;
    readonly payload: AskTransitionSeedPayload;
    readonly requestId: string;
  }): Promise<AskTransitionSeedView> {
    const record = this.authorized(input.scope, input.answerRunId);
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      seedId: `seed-${randomUUID()}`,
      answerRunId: record.snapshot.answerRunId,
      projectId: record.snapshot.projectId,
      kind: input.kind,
      state: 'PROPOSED',
      payload: input.payload,
      createdAt: now(),
    };
  }

  private authorized(scope: AskExecutionScope, answerRunId: string, required = true): RecordValue {
    const record = this.records.get(answerRunId);
    if (!record || record.snapshot.projectId !== scope.projectId) {
      if (!required) return undefined as unknown as RecordValue;
      throw failure('NOT_FOUND', 'The requested AnswerRun was not found.');
    }
    return record;
  }

  private update(record: RecordValue, patch: Partial<AskAnswerRunSnapshot>): void {
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
      ...(updated.partialText === undefined ? {} : { partialText: updated.partialText }),
      answerRevision: updated.answerRevision,
      createdAt: updated.updatedAt,
    });
    this.publish(updated);
  }
}
