import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  ActivityDomainAttemptViewV1,
  ActivityEventCategoryV1,
  ActivityEventViewV1,
  ActivityRootReferenceV1,
  AskAnswerRunEventKind,
  AskAnswerRunEventView,
  AskAnswerRunSnapshot,
  AskAnswerRunState,
} from '../../../packages/contracts/src/index.js';
import {
  activityAttentionFrom,
  activityRetryabilityFrom,
  activityStateFromAskState,
  decodeAskActivityCursor,
  encodeAskActivityCursor,
  type AskActivityAnswerRunRow,
  type ActivityAdapterHealthV1,
  type ActivityAdapterScopeV1,
  type ActivityDetailV1,
  type ActivityEventContinuationV1,
  type ActivityQueueFilterV1,
  type ActivityQueueItemV1,
  type ActivityQueuePageV1,
  type ActivityStageContinuationV1,
  type AskActivityAdapterPort,
  type AskActivityReadPort,
} from '../../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — concrete Ask Activity adapter.
 *
 * Observes the Ask domain through `AskActivityReadPort` (AnswerRun = RUN root,
 * AnswerRunAttempt = domain attempt, AnswerRunEvent = bounded operational
 * evidence). Ask has no durable Job, so the Activity root is a RUN (ADR-130
 * §2). The adapter never authors execution authority: Retry/Cancel remain Ask
 * commands. Reads are bounded and non-disclosing.
 */

const ADAPTER_ID = 'ask-activity-adapter';
const DETAIL_EVENT_CAP = 50;

const notFound = (): never => {
  throw new FrontendContractError('NOT_FOUND', 'The Activity resource was not found.');
};

const metadataFor = (input: {
  readonly sourceUpdatedAt?: string;
  readonly projectedAt: string;
  readonly cursor?: string;
}): ActivityQueuePageV1['metadata'] => ({
  schemaVersion: '1.0.0',
  snapshotRevision: 1,
  generatedAt: input.projectedAt,
  sourceUpdatedAt: input.sourceUpdatedAt ?? input.projectedAt,
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  partial: false,
  ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
});

const runRoot = (run: { answerRunId: string; projectId: string }): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: 'RUN',
  activityId: run.answerRunId,
  domainKind: 'ASK',
  domainResourceKind: 'AnswerRun',
  domainResourceId: run.answerRunId,
  resourceProjectId: run.projectId,
  resourceHref: `/product-api/frontend/ask/run?answerRunId=${run.answerRunId}`,
  runId: run.answerRunId,
});

const terminalAskState = (state: AskAnswerRunState): boolean =>
  state === 'SUCCEEDED' ||
  state === 'FAILED' ||
  state === 'CANCELLED' ||
  state === 'OUTCOME_UNKNOWN';

const askEventCategory = (
  kind: AskAnswerRunEventKind,
  state: AskAnswerRunState,
): ActivityEventCategoryV1 =>
  kind === 'COMPLETED'
    ? 'SUCCEEDED'
    : kind === 'FAILED'
      ? 'FAILED'
      : kind === 'CANCELLED'
        ? 'CANCELLED'
        : kind === 'PARTIAL'
          ? 'PROGRESS'
          : state === 'QUEUED'
            ? 'QUEUED'
            : state === 'RUNNING' || state === 'STREAMING'
              ? 'STARTED'
              : 'STARTED';

export class AskActivityAdapter implements AskActivityAdapterPort {
  readonly adapterId = ADAPTER_ID;
  readonly domainKind = 'ASK' as const;
  readonly domainKinds = ['ASK'] as const;

  constructor(private readonly read: AskActivityReadPort) {}

  health(): ActivityAdapterHealthV1 {
    return { status: 'AVAILABLE' };
  }

  private queueItemFromRun(run: AskActivityAnswerRunRow): ActivityQueueItemV1 {
    return {
      root: runRoot(run),
      summary: `Ask answer run ${run.answerRunId}`,
      state: activityStateFromAskState(run.state),
      dimensions: {
        schemaVersion: '1.0.0',
        attention: activityAttentionFrom(run.attentionReason),
        retryability: activityRetryabilityFrom(run.failure?.retryable),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
      updatedAt: run.updatedAt,
    };
  }

  async readQueue(
    scope: ActivityAdapterScopeV1,
    filter: ActivityQueueFilterV1,
  ): Promise<ActivityQueuePageV1> {
    const limit = Math.max(1, filter.limit ?? 50);
    const { runs, nextCursor } = await this.read.listAnswerRuns({
      projectId: scope.activeProjectId,
      ...(filter.cursor === undefined ? {} : { cursor: filter.cursor }),
      limit: limit + 1,
    });
    const hasMore = runs.length > limit;
    const pageRuns = hasMore ? runs.slice(0, limit) : runs;
    let sourceUpdatedAt: string | undefined;
    for (const run of pageRuns) {
      if (sourceUpdatedAt === undefined || run.updatedAt > sourceUpdatedAt) {
        sourceUpdatedAt = run.updatedAt;
      }
    }
    return {
      items: pageRuns.map((run) => this.queueItemFromRun(run)),
      metadata: metadataFor({
        sourceUpdatedAt,
        projectedAt: new Date().toISOString(),
        ...(hasMore && nextCursor !== undefined ? { cursor: nextCursor } : {}),
      }),
      ...(hasMore && nextCursor !== undefined ? { nextCursor } : {}),
    };
  }

  private attemptViewFrom(run: AskActivityAnswerRunRow): ActivityDomainAttemptViewV1 {
    return {
      schemaVersion: '1.0.0',
      attemptId: run.attemptId ?? `attempt-${run.answerRunId}`,
      runId: run.answerRunId,
      attemptNumber: run.attemptNumber ?? 1,
      attemptKind: 'ASK_ANSWER',
      state: activityStateFromAskState(run.state),
      retryability: activityRetryabilityFrom(run.failure?.retryable),
      ...(run.failure === undefined
        ? {}
        : {
            failure: {
              schemaVersion: '1.0.0',
              kind: run.failure.outcomeUnknown
                ? 'OUTCOME_UNKNOWN'
                : run.failure.retryable
                  ? 'TRANSIENT'
                  : 'PERMANENT',
              code: run.failure.code,
              message: run.failure.message,
              occurredAt: run.updatedAt,
            },
          }),
      startedAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(terminalAskState(run.state) ? { completedAt: run.updatedAt } : {}),
      stageRefs: [],
    };
  }

  private eventFromEvent(event: AskAnswerRunEventView): ActivityEventViewV1 {
    return {
      schemaVersion: '1.0.0',
      eventId: event.eventId,
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'AnswerRun',
        resourceId: event.answerRunId,
      },
      category: askEventCategory(event.kind, event.state),
      sequence: event.ordinal,
      occurredAt: event.createdAt,
      summary: `Ask answer run event ${event.kind}`,
    };
  }

  async readDetail(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ActivityDetailV1> {
    const run = await this.read.getAnswerRun({
      projectId: scope.activeProjectId,
      answerRunId: root.domainResourceId,
    });
    if (run === undefined) return notFound();
    const events = await this.read.listAnswerRunEvents({
      projectId: scope.activeProjectId,
      answerRunId: run.answerRunId,
      limit: DETAIL_EVENT_CAP,
    });
    const projectedAt = new Date().toISOString();
    return {
      root: runRoot(run),
      run: {
        schemaVersion: '1.0.0',
        runId: run.answerRunId,
        sequence: 1,
        state: activityStateFromAskState(run.state),
        startedAt: run.createdAt,
        updatedAt: run.updatedAt,
        ...(terminalAskState(run.state) ? { completedAt: run.updatedAt } : {}),
        domainAttemptRefs: [],
        correlationRefs: [],
        causationRefs: [],
      },
      attempts: [this.attemptViewFrom(run)],
      stages: [],
      events: events.map((event) => this.eventFromEvent(event)),
      transportAttempts: [],
      metadata: metadataFor({ sourceUpdatedAt: run.updatedAt, projectedAt }),
      dimensions: {
        schemaVersion: '1.0.0',
        attention: activityAttentionFrom(run.attentionReason),
        retryability: activityRetryabilityFrom(run.failure?.retryable),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
    };
  }

  async readStages(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    _cursor?: string,
    _limit?: number,
  ): Promise<ActivityStageContinuationV1> {
    const run = await this.read.getAnswerRun({
      projectId: scope.activeProjectId,
      answerRunId: root.domainResourceId,
    });
    if (run === undefined) return notFound();
    // Ask has no durable stage pipeline in the bounded Activity view.
    void _cursor;
    void _limit;
    return {
      stages: [],
      metadata: metadataFor({
        sourceUpdatedAt: run.updatedAt,
        projectedAt: new Date().toISOString(),
      }),
    };
  }

  async readEvents(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    _cursor?: string,
    limit?: number,
  ): Promise<ActivityEventContinuationV1> {
    const run = await this.read.getAnswerRun({
      projectId: scope.activeProjectId,
      answerRunId: root.domainResourceId,
    });
    if (run === undefined) return notFound();
    const events = await this.read.listAnswerRunEvents({
      projectId: scope.activeProjectId,
      answerRunId: run.answerRunId,
      limit: Math.max(1, limit ?? 50),
    });
    return {
      events: events.map((event) => this.eventFromEvent(event)),
      metadata: metadataFor({
        sourceUpdatedAt: run.updatedAt,
        projectedAt: new Date().toISOString(),
      }),
    };
  }
}

/**
 * In-memory `AskActivityReadPort` for tests and default (non-Postgres) runtime
 * wiring. Stores whole `AskAnswerRunSnapshot`s and event views and serves the
 * project-scoped queue with stable updatedAt DESC ordering and a keyset cursor.
 */
export class InMemoryAskActivityRead implements AskActivityReadPort {
  private readonly runs = new Map<string, AskAnswerRunSnapshot>();
  private readonly eventRows = new Map<string, AskAnswerRunEventView>();

  seedRun(run: AskAnswerRunSnapshot): void {
    this.runs.set(`${run.projectId}\u0000${run.answerRunId}`, run);
  }

  seedEvent(input: AskAnswerRunEventView): void {
    this.eventRows.set(`${input.projectId}\u0000${input.answerRunId}\u0000${input.eventId}`, input);
  }

  async listAnswerRuns(input: {
    readonly projectId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly runs: readonly AskActivityAnswerRunRow[];
    readonly nextCursor?: string;
  }> {
    let runs = [...this.runs.values()]
      .filter((run) => run.projectId === input.projectId)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
    if (input.cursor !== undefined) {
      const cursor = decodeAskActivityCursor(input.cursor);
      runs = runs.filter(
        (run) =>
          run.updatedAt < cursor.updatedAt ||
          (run.updatedAt === cursor.updatedAt && run.answerRunId > cursor.answerRunId),
      );
    }
    const page = runs.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      runs: page.map<AskActivityAnswerRunRow>((run) => ({
        answerRunId: run.answerRunId,
        projectId: run.projectId,
        state: run.state,
        ...(run.attentionReason === undefined ? {} : { attentionReason: run.attentionReason }),
        ...(run.attemptId === undefined ? {} : { attemptId: run.attemptId }),
        ...(run.attemptNumber === undefined ? {} : { attemptNumber: run.attemptNumber }),
        ...(run.failure === undefined ? {} : { failure: run.failure }),
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
      ...(runs.length > page.length && last !== undefined
        ? {
            nextCursor: encodeAskActivityCursor({
              updatedAt: last.updatedAt,
              answerRunId: last.answerRunId,
            }),
          }
        : {}),
    };
  }

  async getAnswerRun(input: {
    readonly projectId: string;
    readonly answerRunId: string;
  }): Promise<AskActivityAnswerRunRow | undefined> {
    const run = this.runs.get(`${input.projectId}\u0000${input.answerRunId}`);
    if (run === undefined) return undefined;
    return {
      answerRunId: run.answerRunId,
      projectId: run.projectId,
      state: run.state,
      ...(run.attentionReason === undefined ? {} : { attentionReason: run.attentionReason }),
      ...(run.attemptId === undefined ? {} : { attemptId: run.attemptId }),
      ...(run.attemptNumber === undefined ? {} : { attemptNumber: run.attemptNumber }),
      ...(run.failure === undefined ? {} : { failure: run.failure }),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  async listAnswerRunEvents(input: {
    readonly projectId: string;
    readonly answerRunId: string;
    readonly afterOrdinal?: number;
    readonly limit: number;
  }): Promise<readonly AskAnswerRunEventView[]> {
    return [...this.eventRows.values()]
      .filter(
        (event) =>
          event.projectId === input.projectId &&
          event.answerRunId === input.answerRunId &&
          (input.afterOrdinal === undefined || event.ordinal > input.afterOrdinal),
      )
      .sort((a, b) => a.ordinal - b.ordinal)
      .slice(0, input.limit);
  }
}

export const createInMemoryAskActivityRead = (): InMemoryAskActivityRead =>
  new InMemoryAskActivityRead();
