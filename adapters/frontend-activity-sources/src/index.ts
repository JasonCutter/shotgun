import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  ActivityDomainAttemptViewV1,
  ActivityEventCategoryV1,
  ActivityEventViewV1,
  ActivityLifecycleStateV1,
  ActivityRootReferenceV1,
  ActivityStageStateV1,
  ActivityStageViewV1,
  IntakeSubmissionSnapshot,
  IntakeSubmissionState,
} from '../../../packages/contracts/src/index.js';
import {
  activityAttentionFrom,
  activityRetryabilityFrom,
  activityStateFromSourcesItemState,
  activityStateFromSourcesState,
  decodeSourcesActivityCursor,
  encodeSourcesActivityCursor,
  type ActivityAdapterHealthV1,
  type ActivityAdapterScopeV1,
  type ActivityDetailV1,
  type ActivityEventContinuationV1,
  type ActivityQueueFilterV1,
  type ActivityQueueItemV1,
  type ActivityQueuePageV1,
  type ActivityStageContinuationV1,
  type SourcesActivityAdapterPort,
  type SourcesActivityAttemptRow,
  type SourcesActivityReadPort,
  type SourcesActivitySubmissionRow,
} from '../../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — concrete Sources Activity adapter.
 *
 * Observes the Sources domain through `SourcesActivityReadPort`
 * (IntakeSubmission = Job root, item processing = stages, IntakeAttempt =
 * event evidence). It never authors execution authority: Retry/Cancel remain
 * Sources commands. Reads are bounded and non-disclosing: a missing or
 * cross-principal submission produces the same NOT_FOUND.
 */

const ADAPTER_ID = 'sources-activity-adapter';
const DETAIL_EVENT_CAP = 50;

const notFound = (): never => {
  throw new FrontendContractError('NOT_FOUND', 'The Activity resource was not found.');
};

const SOURCES_ATTEMPT_LIFECYCLE: Readonly<Record<string, ActivityLifecycleStateV1>> = {
  ACCEPTED: 'RUNNING',
  RUNNING: 'RUNNING',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  OUTCOME_INDETERMINATE: 'OUTCOME_UNKNOWN',
};

const sourcesAttemptLifecycle = (state: string): ActivityLifecycleStateV1 =>
  SOURCES_ATTEMPT_LIFECYCLE[state] ?? 'OUTCOME_UNKNOWN';

const sourcesEventCategory = (state: string): ActivityEventCategoryV1 =>
  state === 'SUCCEEDED'
    ? 'SUCCEEDED'
    : state === 'FAILED'
      ? 'FAILED'
      : state === 'CANCELLED' || state === 'CANCEL_REQUESTED'
        ? 'CANCELLED'
        : state === 'ACCEPTED' || state === 'RUNNING'
          ? 'STARTED'
          : 'OUTCOME_UNKNOWN';

const lifecycleToStageState = (state: ActivityLifecycleStateV1): ActivityStageStateV1 =>
  state === 'QUEUED' || state === 'WAITING_FOR_USER'
    ? 'PENDING'
    : state === 'RUNNING' || state === 'PARTIAL'
      ? 'RUNNING'
      : state === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : state === 'FAILED'
          ? 'FAILED'
          : state === 'CANCEL_REQUESTED' || state === 'CANCELLED'
            ? 'SKIPPED'
            : 'OUTCOME_UNKNOWN';

const sourcesRetryable = (state: IntakeSubmissionState): boolean =>
  state === 'FAILED' || state === 'OUTCOME_INDETERMINATE';

const terminalSourcesState = (state: IntakeSubmissionState): boolean =>
  state === 'SUCCEEDED' ||
  state === 'FAILED' ||
  state === 'CANCELLED' ||
  state === 'OUTCOME_INDETERMINATE';

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

const submissionRoot = (row: SourcesActivitySubmissionRow): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: row.submissionId,
  domainKind: 'SOURCES',
  domainResourceKind: 'IntakeSubmission',
  domainResourceId: row.submissionId,
  resourceProjectId: row.projectId,
  resourceHref: `/product-api/frontend/sources/read?submissionId=${row.submissionId}`,
  jobId: row.submissionId,
  runId: row.submissionId,
});

export class SourcesActivityAdapter implements SourcesActivityAdapterPort {
  readonly adapterId = ADAPTER_ID;
  readonly domainKind = 'SOURCES' as const;
  readonly domainKinds = ['SOURCES'] as const;

  constructor(private readonly read: SourcesActivityReadPort) {}

  health(): ActivityAdapterHealthV1 {
    return { status: 'AVAILABLE' };
  }

  private queueItemFromRow(row: SourcesActivitySubmissionRow): ActivityQueueItemV1 {
    const state = activityStateFromSourcesState(row.state);
    return {
      root: submissionRoot(row),
      summary: `Sources intake submission ${row.submissionId}`,
      state,
      dimensions: {
        schemaVersion: '1.0.0',
        attention: activityAttentionFrom(row.attentionReason),
        retryability: activityRetryabilityFrom(sourcesRetryable(row.state)),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
      updatedAt: row.updatedAt,
    };
  }

  async readQueue(
    scope: ActivityAdapterScopeV1,
    filter: ActivityQueueFilterV1,
  ): Promise<ActivityQueuePageV1> {
    const limit = Math.max(1, filter.limit ?? 50);
    const { rows, nextCursor } = await this.read.listSubmissions({
      projectId: scope.activeProjectId,
      principalId: scope.principalId,
      ...(filter.cursor === undefined ? {} : { cursor: filter.cursor }),
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    let sourceUpdatedAt: string | undefined;
    for (const row of pageRows) {
      if (sourceUpdatedAt === undefined || row.updatedAt > sourceUpdatedAt) {
        sourceUpdatedAt = row.updatedAt;
      }
    }
    return {
      items: pageRows.map((row) => this.queueItemFromRow(row)),
      metadata: metadataFor({
        sourceUpdatedAt,
        projectedAt: new Date().toISOString(),
        ...(hasMore && nextCursor !== undefined ? { cursor: nextCursor } : {}),
      }),
      ...(hasMore && nextCursor !== undefined ? { nextCursor } : {}),
    };
  }

  private stageFromItem(
    item: IntakeSubmissionSnapshot['items'][number],
    index: number,
    snapshot: IntakeSubmissionSnapshot,
  ): ActivityStageViewV1 {
    const lifecycle = activityStateFromSourcesItemState(item.state);
    return {
      schemaVersion: '1.0.0',
      stageId: item.itemId,
      stageKey: `intake-item-${index + 1}`,
      label: item.manifest.label,
      sequence: index + 1,
      state: lifecycleToStageState(lifecycle),
      ...(item.progress === undefined
        ? {}
        : {
            progress: {
              schemaVersion: '1.0.0',
              current: item.progress.completedUnits,
              total: item.progress.totalUnits,
            },
          }),
      startedAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      ...(item.safeFailure === undefined
        ? {}
        : {
            failure: {
              schemaVersion: '1.0.0',
              kind: 'TRANSIENT',
              code: item.safeFailure.code,
              message: item.safeFailure.message,
              occurredAt: snapshot.updatedAt,
            },
          }),
    };
  }

  private attemptViewFrom(
    attempt: SourcesActivityAttemptRow,
    snapshot: IntakeSubmissionSnapshot,
  ): ActivityDomainAttemptViewV1 {
    return {
      schemaVersion: '1.0.0',
      attemptId: attempt.intakeAttemptId,
      runId: snapshot.submissionId,
      attemptNumber: attempt.attemptNumber,
      attemptKind: 'SOURCES_INTAKE',
      state: sourcesAttemptLifecycle(attempt.state),
      retryability: activityRetryabilityFrom(attempt.state === 'FAILED'),
      startedAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
      stageRefs: [
        {
          schemaVersion: '1.0.0',
          resourceKind: 'IntakeSubmissionItem',
          resourceId: attempt.submissionItemId,
        },
      ],
    };
  }

  private eventFromAttempt(
    attempt: SourcesActivityAttemptRow,
    sequence: number,
  ): ActivityEventViewV1 {
    return {
      schemaVersion: '1.0.0',
      eventId: attempt.intakeAttemptId,
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: attempt.submissionItemId,
      },
      category: sourcesEventCategory(attempt.state),
      sequence,
      occurredAt: attempt.createdAt,
      summary: `Sources intake attempt ${attempt.attemptNumber} ${attempt.state}`,
      domainResourceRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmission',
        resourceId: attempt.submissionId,
      },
    };
  }

  private async collectAttempts(
    scope: ActivityAdapterScopeV1,
    snapshot: IntakeSubmissionSnapshot,
    limit: number,
  ): Promise<readonly SourcesActivityAttemptRow[]> {
    const attempts: SourcesActivityAttemptRow[] = [];
    let remaining = limit;
    for (const item of snapshot.items) {
      if (remaining <= 0) break;
      const itemAttempts = await this.read.listItemAttempts({
        projectId: scope.activeProjectId,
        submissionId: snapshot.submissionId,
        submissionItemId: item.itemId,
        limit: Math.min(remaining, 25),
      });
      attempts.push(...itemAttempts);
      remaining -= itemAttempts.length;
    }
    return attempts;
  }

  async readDetail(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ActivityDetailV1> {
    const snapshot = await this.read.getSubmission({
      projectId: scope.activeProjectId,
      submissionId: root.domainResourceId,
      principalId: scope.principalId,
    });
    if (snapshot === undefined) return notFound();
    const attempts = await this.collectAttempts(scope, snapshot, DETAIL_EVENT_CAP);
    const projectedAt = new Date().toISOString();
    return {
      root: submissionRoot({
        submissionId: snapshot.submissionId,
        projectId: snapshot.projectId,
        principalId: snapshot.principalId,
        state: snapshot.state,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        itemCount: snapshot.items.length,
      }),
      run: {
        schemaVersion: '1.0.0',
        runId: snapshot.submissionId,
        jobId: snapshot.submissionId,
        sequence: 1,
        state: activityStateFromSourcesState(snapshot.state),
        startedAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        ...(terminalSourcesState(snapshot.state) ? { completedAt: snapshot.updatedAt } : {}),
        domainAttemptRefs: attempts.map((attempt) => ({
          schemaVersion: '1.0.0',
          resourceKind: 'IntakeAttempt',
          resourceId: attempt.intakeAttemptId,
        })),
        correlationRefs: [],
        causationRefs: [],
      },
      attempts: attempts.map((attempt) => this.attemptViewFrom(attempt, snapshot)),
      stages: snapshot.items.map((item, index) => this.stageFromItem(item, index, snapshot)),
      events: attempts.map((attempt, index) => this.eventFromAttempt(attempt, index + 1)),
      transportAttempts: [],
      metadata: metadataFor({ sourceUpdatedAt: snapshot.updatedAt, projectedAt }),
      dimensions: {
        schemaVersion: '1.0.0',
        attention: activityAttentionFrom(
          snapshot.items.find((item) => item.attentionReason !== undefined)?.attentionReason,
        ),
        retryability: activityRetryabilityFrom(sourcesRetryable(snapshot.state)),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
    };
  }

  async readStages(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    _cursor?: string,
    limit?: number,
  ): Promise<ActivityStageContinuationV1> {
    const snapshot = await this.read.getSubmission({
      projectId: scope.activeProjectId,
      submissionId: root.domainResourceId,
      principalId: scope.principalId,
    });
    if (snapshot === undefined) return notFound();
    const capped = Math.max(1, limit ?? 50);
    const stages = snapshot.items
      .slice(0, capped)
      .map((item, index) => this.stageFromItem(item, index, snapshot));
    return {
      stages,
      metadata: metadataFor({
        sourceUpdatedAt: snapshot.updatedAt,
        projectedAt: new Date().toISOString(),
      }),
      ...(snapshot.items.length > stages.length
        ? { nextCursor: `sources:stages:${stages.length}` }
        : {}),
    };
  }

  async readEvents(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    _cursor?: string,
    limit?: number,
  ): Promise<ActivityEventContinuationV1> {
    const snapshot = await this.read.getSubmission({
      projectId: scope.activeProjectId,
      submissionId: root.domainResourceId,
      principalId: scope.principalId,
    });
    if (snapshot === undefined) return notFound();
    const capped = Math.max(1, limit ?? 50);
    const attempts = await this.collectAttempts(scope, snapshot, capped);
    return {
      events: attempts.map((attempt, index) => this.eventFromAttempt(attempt, index + 1)),
      metadata: metadataFor({
        sourceUpdatedAt: snapshot.updatedAt,
        projectedAt: new Date().toISOString(),
      }),
    };
  }
}

/**
 * In-memory `SourcesActivityReadPort` for tests and default (non-Postgres)
 * runtime wiring. Stores whole `IntakeSubmissionSnapshot`s and optional
 * attempt rows and serves the project-scoped queue with stable updatedAt DESC
 * ordering and a keyset cursor.
 */
export class InMemorySourcesActivityRead implements SourcesActivityReadPort {
  private readonly submissions = new Map<string, IntakeSubmissionSnapshot>();
  private readonly attempts = new Map<string, SourcesActivityAttemptRow>();

  seedSubmission(snapshot: IntakeSubmissionSnapshot): void {
    this.submissions.set(`${snapshot.projectId}\u0000${snapshot.submissionId}`, snapshot);
  }

  seedAttempt(attempt: SourcesActivityAttemptRow): void {
    this.attempts.set(
      `${attempt.projectId}\u0000${attempt.submissionId}\u0000${attempt.intakeAttemptId}`,
      attempt,
    );
  }

  async listSubmissions(input: {
    readonly projectId: string;
    readonly principalId?: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly rows: readonly SourcesActivitySubmissionRow[];
    readonly nextCursor?: string;
  }> {
    let rows = [...this.submissions.values()]
      .filter((snapshot) => snapshot.projectId === input.projectId)
      .map<SourcesActivitySubmissionRow>((snapshot) => ({
        submissionId: snapshot.submissionId,
        projectId: snapshot.projectId,
        principalId: snapshot.principalId,
        state: snapshot.state,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        itemCount: snapshot.items.length,
        attentionReason: snapshot.items.find((item) => item.attentionReason !== undefined)
          ?.attentionReason,
      }))
      .sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
    if (input.principalId !== undefined) {
      rows = rows.filter((row) => row.principalId === input.principalId);
    }
    if (input.cursor !== undefined) {
      const cursor = decodeSourcesActivityCursor(input.cursor);
      rows = rows.filter(
        (row) =>
          row.updatedAt < cursor.updatedAt ||
          (row.updatedAt === cursor.updatedAt && row.submissionId > cursor.submissionId),
      );
    }
    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      ...(rows.length > page.length && last !== undefined
        ? {
            nextCursor: encodeSourcesActivityCursor({
              updatedAt: last.updatedAt,
              submissionId: last.submissionId,
            }),
          }
        : {}),
    };
  }

  async getSubmission(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly principalId?: string;
  }): Promise<IntakeSubmissionSnapshot | undefined> {
    const snapshot = this.submissions.get(`${input.projectId}\u0000${input.submissionId}`);
    if (snapshot === undefined) return undefined;
    if (input.principalId !== undefined && snapshot.principalId !== input.principalId) {
      return undefined;
    }
    return snapshot;
  }

  async listItemAttempts(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly submissionItemId: string;
    readonly limit: number;
  }): Promise<readonly SourcesActivityAttemptRow[]> {
    return [...this.attempts.values()]
      .filter(
        (attempt) =>
          attempt.projectId === input.projectId &&
          attempt.submissionId === input.submissionId &&
          attempt.submissionItemId === input.submissionItemId,
      )
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .slice(0, input.limit);
  }
}

export const createInMemorySourcesActivityRead = (): InMemorySourcesActivityRead =>
  new InMemorySourcesActivityRead();
