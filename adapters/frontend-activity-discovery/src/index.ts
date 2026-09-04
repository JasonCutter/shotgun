import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  ActivityDomainAttemptViewV1,
  ActivityDomainPresentationV1,
  ActivityEventCategoryV1,
  ActivityEventViewV1,
  ActivityLifecycleStateV1,
  ActivityRootReferenceV1,
  ActivityStageStateV1,
  ActivityStageViewV1,
  DiscoveryJobV1,
  DiscoveryRunV1,
  DiscoveryRuntimeLifecycleStateV1,
  DiscoveryRuntimeStageStateV1,
  DiscoveryStageV1,
} from '../../../packages/contracts/src/index.js';
import {
  activityFailureKindFrom,
  activityRetryabilityFrom,
  decodeDiscoveryActivityCursor,
  encodeDiscoveryActivityCursor,
  type ActivityAdapterHealthV1,
  type ActivityAdapterScopeV1,
  type ActivityDetailV1,
  type ActivityEventContinuationV1,
  type ActivityQueueFilterV1,
  type ActivityQueueItemV1,
  type ActivityQueuePageV1,
  type ActivityStageContinuationV1,
  type DiscoveryActivityAdapterPort,
  type DiscoveryActivityAttemptRow,
  type DiscoveryActivityFailureContextV1,
  type DiscoveryActivityFindingReadPort,
  type DiscoveryActivityFindingRow,
  type DiscoveryActivityHistoryV1,
  type DiscoveryActivityJobRow,
  type DiscoveryActivityLifecycleEventV1,
  type DiscoveryActivityReadPort,
} from '../../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 / AKP-4 WP5 Discovery Activity adapter.
 *
 * This adapter is read-only. Discovery Job/Run/Attempt/Stage and lifecycle
 * history remain authoritative in the Discovery runtime; Activity only maps
 * those records into the existing federated projection. Finding payloads,
 * stage outputs, provider data and re-entry/governance commands are never
 * read or returned here; only a bounded, safe Finding backlink may be
 * supplied by the existing Finding/Review authorities.
 */

const ADAPTER_ID = 'discovery-activity-adapter';
const PAGE_CAP = 50;
const FINDING_PAGE_CAP = 20;

const triggerLabel = (job: DiscoveryJobV1): string => {
  switch (job.trigger.triggerClass) {
    case 'CANONICAL_COMMITTED':
      return 'Canonical 변경 후 Discovery';
    case 'SCHEDULED_FULL_SCAN':
      return '예약된 전체 스캔';
    case 'MANUAL':
      return '수동 Discovery 실행';
  }
};

const scanModeLabel = (job: DiscoveryJobV1): string =>
  job.effectiveScanMode === 'FULL_SCAN' ? '전체 스캔' : '증분 스캔';

const lifecycleLabel = (state: DiscoveryRuntimeLifecycleStateV1): string => {
  switch (state) {
    case 'QUEUED':
      return '대기 중';
    case 'WAITING_FOR_PROJECTION':
      return '필수 지식 프로젝션 대기 중';
    case 'RUNNING':
      return '실행 중';
    case 'PARTIAL':
      return '부분 완료';
    case 'SUCCEEDED':
      return '완료';
    case 'FAILED_RETRYABLE':
      return '재시도 가능한 실패';
    case 'FAILED_TERMINAL':
      return '복구 불가 실패';
    case 'CANCELLED':
      return '취소됨';
  }
};

const stageLabels: Readonly<Record<DiscoveryStageV1['stageType'], string>> = {
  WAIT_FOR_PROJECTION: '필수 프로젝션 대기',
  LOAD_SIGNALS: '신호 로드',
  GENERATE_FINDINGS: 'Finding 생성',
  QUALITY_GATE: '품질 게이트',
  PERSIST_FINDINGS: 'Finding 저장',
  PUBLISH_REENTRY: '재진입 이벤트 발행',
  RECONCILE_FINDINGS: 'Finding 정합성 확인',
};

const notFound = (): never => {
  throw new FrontendContractError('NOT_FOUND', 'The Activity resource was not found.');
};

const commonState = (state: DiscoveryRuntimeLifecycleStateV1): ActivityLifecycleStateV1 => {
  switch (state) {
    case 'QUEUED':
      return 'QUEUED';
    case 'WAITING_FOR_PROJECTION':
      // Projection readiness is a pre-execution wait. Preserve the frozen
      // WP5 Activity meaning as QUEUED; it is never a user-action state.
      return 'QUEUED';
    case 'RUNNING':
      return 'RUNNING';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED_RETRYABLE':
    case 'FAILED_TERMINAL':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
};

const stageState = (state: DiscoveryRuntimeStageStateV1): ActivityStageStateV1 => {
  switch (state) {
    case 'QUEUED':
      return 'PENDING';
    case 'RUNNING':
      return 'RUNNING';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED_RETRYABLE':
    case 'FAILED_TERMINAL':
      return 'FAILED';
    case 'CANCELLED':
      return 'SKIPPED';
  }
};

const eventCategory = (
  state: DiscoveryRuntimeLifecycleStateV1 | DiscoveryRuntimeStageStateV1,
): ActivityEventCategoryV1 => {
  switch (state) {
    case 'QUEUED':
      return 'QUEUED';
    case 'RUNNING':
      return 'STARTED';
    case 'WAITING_FOR_PROJECTION':
    case 'PARTIAL':
      return 'PROGRESS';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED_RETRYABLE':
      return 'RETRY_SCHEDULED';
    case 'FAILED_TERMINAL':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
};

const isTerminal = (state: DiscoveryRuntimeLifecycleStateV1): boolean =>
  state === 'SUCCEEDED' ||
  state === 'FAILED_RETRYABLE' ||
  state === 'FAILED_TERMINAL' ||
  state === 'CANCELLED';

const attentionFor = (
  state: DiscoveryRuntimeLifecycleStateV1,
  hasReviewEligibleFinding: boolean,
): {
  readonly state: 'NEEDS_ATTENTION' | 'RESOLVED' | 'NONE';
  readonly reason?: ActivityDomainPresentationV1['attentionReason'];
} => {
  if (state === 'FAILED_TERMINAL') return { state: 'NEEDS_ATTENTION', reason: 'FAILED_TERMINAL' };
  if (hasReviewEligibleFinding) {
    return { state: 'NEEDS_ATTENTION', reason: 'REVIEW_ELIGIBLE_FINDING' };
  }
  return { state: 'NONE' };
};

const safeFailureFrom = (
  failure: DiscoveryActivityFailureContextV1 | undefined,
): ActivityDetailV1['attempts'][number]['failure'] | undefined =>
  failure === undefined
    ? undefined
    : {
        schemaVersion: '1.0.0',
        kind: activityFailureKindFrom({
          retryable: failure.retryable,
          outcomeUnknown: false,
          cancelled: false,
        }),
        code: failure.code,
        message: failure.safeMessage,
        occurredAt: failure.occurredAt,
      };

const maxTimestamp = (...values: readonly (string | undefined)[]): string => {
  const present = values.filter((value): value is string => value !== undefined);
  return present.reduce(
    (max, value) => (value > max ? value : max),
    present[0] ?? '1970-01-01T00:00:00.000Z',
  );
};

const metadataFor = (input: {
  readonly sourceUpdatedAt: string;
  readonly projectedAt?: string;
  readonly cursor?: string;
}): ActivityQueuePageV1['metadata'] => ({
  schemaVersion: '1.0.0',
  snapshotRevision: 1,
  generatedAt: input.projectedAt ?? new Date().toISOString(),
  sourceUpdatedAt: input.sourceUpdatedAt,
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  partial: false,
  ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
});

const jobRoot = (row: DiscoveryActivityJobRow, runId?: string): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: row.job.jobId,
  domainKind: 'DISCOVERY',
  domainResourceKind: 'DiscoveryJob',
  domainResourceId: row.job.jobId,
  resourceProjectId: row.job.projectId,
  resourceHref: `/activity?domain=DISCOVERY&activity=${encodeURIComponent(row.job.jobId)}&resource=DiscoveryJob&resourceId=${encodeURIComponent(row.job.jobId)}`,
  jobId: row.job.jobId,
  // A Job can be visible before its first Run is claimed. The fallback is
  // the stable Job lineage, never a random or wall-clock identity. Once a
  // Run exists, the queue root carries that durable Run id.
  runId: runId ?? row.run?.runId ?? row.job.jobId,
});

const activityCursorForJob = (row: DiscoveryActivityJobRow): string =>
  encodeDiscoveryActivityCursor({
    updatedAt: maxTimestamp(row.job.updatedAt, row.run?.updatedAt),
    jobId: row.job.jobId,
  });

const cursorForOffset = (prefix: 'stages' | 'events', offset: number): string =>
  `discovery:${prefix}:${offset}`;

const offsetFromCursor = (prefix: 'stages' | 'events', cursor: string | undefined): number => {
  if (cursor === undefined) return 0;
  const expected = `discovery:${prefix}:`;
  if (!cursor.startsWith(expected)) {
    throw new Error(`DISCOVERY_ACTIVITY_INVALID_CURSOR: ${prefix} cursor malformed`);
  }
  const offset = Number.parseInt(cursor.slice(expected.length), 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`DISCOVERY_ACTIVITY_INVALID_CURSOR: ${prefix} cursor malformed`);
  }
  return offset;
};

const historyEventSort = (
  a: DiscoveryActivityLifecycleEventV1,
  b: DiscoveryActivityLifecycleEventV1,
): number => {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  const rank = (kind: DiscoveryActivityLifecycleEventV1['resourceKind']): number =>
    kind === 'DiscoveryJob' ? 0 : kind === 'DiscoveryRun' ? 1 : kind === 'DiscoveryAttempt' ? 2 : 3;
  if (rank(a.resourceKind) !== rank(b.resourceKind))
    return rank(a.resourceKind) - rank(b.resourceKind);
  if (a.revision !== b.revision) return a.revision - b.revision;
  return `${a.resourceKind}:${a.resourceId}`.localeCompare(`${b.resourceKind}:${b.resourceId}`);
};

const semanticEssenceDiagnosticEvent = (input: {
  readonly jobId: string;
  readonly runId: string;
  readonly runRevision: number;
  readonly excludedCount: number;
  readonly candidateCount?: number;
  readonly occurredAt: string;
}): ActivityEventViewV1 => {
  const ratio =
    input.candidateCount === undefined
      ? `${input.excludedCount}`
      : `${input.excludedCount}/${input.candidateCount}`;
  return {
    schemaVersion: '1.0.0',
    eventId: `discovery:${input.jobId}:run:${input.runId}:semantic-essence-diagnostics`,
    relatedRef: {
      schemaVersion: '1.0.0',
      resourceKind: 'DiscoveryRun',
      resourceId: input.runId,
      resourceRevision: input.runRevision,
    },
    category: 'PROGRESS',
    sequence: 0,
    occurredAt: input.occurredAt,
    summary: `Semantic-essence exclusions: ${ratio} candidates; run completion PARTIAL.`,
    domainResourceRef: {
      schemaVersion: '1.0.0',
      resourceKind: 'DiscoveryJob',
      resourceId: input.jobId,
    },
  };
};

export class DiscoveryActivityAdapter implements DiscoveryActivityAdapterPort {
  readonly adapterId = ADAPTER_ID;
  readonly domainKind = 'DISCOVERY' as const;
  readonly domainKinds = ['DISCOVERY'] as const;

  constructor(
    private readonly read: DiscoveryActivityReadPort,
    private readonly findingRead?: DiscoveryActivityFindingReadPort,
  ) {}

  health(): ActivityAdapterHealthV1 {
    return { status: 'AVAILABLE' };
  }

  async canAccess(scope: ActivityAdapterScopeV1, root: ActivityRootReferenceV1): Promise<boolean> {
    if (
      root.domainKind !== 'DISCOVERY' ||
      root.rootKind !== 'JOB' ||
      root.activityId !== root.domainResourceId ||
      root.domainResourceKind !== 'DiscoveryJob' ||
      root.resourceProjectId !== scope.activeProjectId ||
      root.jobId !== root.domainResourceId
    ) {
      return false;
    }
    const job = await this.read.getJob({
      projectId: scope.activeProjectId,
      jobId: root.domainResourceId,
    });
    return job?.projectId === scope.activeProjectId;
  }

  private async jobForRoot(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<DiscoveryJobV1> {
    if (
      root.domainKind !== 'DISCOVERY' ||
      root.rootKind !== 'JOB' ||
      root.activityId !== root.domainResourceId ||
      root.domainResourceKind !== 'DiscoveryJob' ||
      root.resourceProjectId !== scope.activeProjectId ||
      root.jobId !== root.domainResourceId
    ) {
      return notFound();
    }
    const job = await this.read.getJob({
      projectId: scope.activeProjectId,
      jobId: root.domainResourceId,
    });
    if (job === undefined || job.projectId !== scope.activeProjectId) return notFound();
    return job;
  }

  private async findingsFor(
    scope: ActivityAdapterScopeV1,
    job: DiscoveryJobV1,
    run: DiscoveryRunV1 | undefined,
  ): Promise<readonly DiscoveryActivityFindingRow[]> {
    if (!run || this.findingRead === undefined) return [];
    try {
      const findings = await this.findingRead.listActivityFindings({
        projectId: scope.activeProjectId,
        jobId: job.jobId,
        runId: run.runId,
        accessScope: scope.accessScope,
        sensitivityClearance: scope.sensitivityClearance,
        limit: FINDING_PAGE_CAP + 1,
      });
      // Retain one bounded sentinel so the presentation can distinguish an
      // exact 20-item result from a truncated backlink list. Attention still
      // evaluates every row returned by this bounded read.
      return findings.slice(0, FINDING_PAGE_CAP + 1);
    } catch {
      // Finding/Review authority is optional to the runtime projection. A
      // failed backlink read must never grant Attention or disclose data.
      return [];
    }
  }

  private async hasReviewEligibleFindingFor(
    scope: ActivityAdapterScopeV1,
    job: DiscoveryJobV1,
    run: DiscoveryRunV1 | undefined,
  ): Promise<boolean> {
    if (!run || this.findingRead === undefined) return false;
    if (this.findingRead.hasReviewEligibleActivityFinding === undefined) {
      // Attention is fail-closed when its separate authority is unavailable;
      // the bounded backlink rows are presentation data, not authority.
      return false;
    }
    try {
      return await this.findingRead.hasReviewEligibleActivityFinding({
        projectId: scope.activeProjectId,
        jobId: job.jobId,
        runId: run.runId,
        accessScope: scope.accessScope,
        sensitivityClearance: scope.sensitivityClearance,
      });
    } catch {
      // An unavailable authority must never grant Attention.
      return false;
    }
  }

  private presentationFor(
    job: DiscoveryJobV1,
    run: DiscoveryRunV1 | undefined,
    findings: readonly DiscoveryActivityFindingRow[],
    attention: ReturnType<typeof attentionFor>,
  ): ActivityDomainPresentationV1 {
    const state = run?.lifecycleState ?? job.lifecycleState;
    const waitBinding = run?.projectionWait ?? job.projectionWait;
    const displayedFindings = findings.slice(0, FINDING_PAGE_CAP);
    const relatedResources = displayedFindings.map((finding) => ({
      schemaVersion: '1.0.0' as const,
      resourceKind: 'DISCOVERY_FINDING' as const,
      resourceId: finding.findingId,
      resourceRevision: finding.findingRevision,
      title: finding.title,
      findingType: finding.findingType,
      lifecycleState: finding.lifecycleState,
      authority: 'DERIVED_INFERENCE' as const,
      resourceHref: finding.resourceHref,
    }));
    return {
      schemaVersion: '1.0.0',
      title: `${triggerLabel(job)} · ${scanModeLabel(job)}`,
      triggerLabel: triggerLabel(job),
      scanModeLabel: scanModeLabel(job),
      ...(attention.reason === undefined ? {} : { attentionReason: attention.reason }),
      ...(state === 'WAITING_FOR_PROJECTION' && waitBinding !== undefined
        ? {
            wait: {
              schemaVersion: '1.0.0' as const,
              state: 'WAITING_FOR_PROJECTION' as const,
              requiredProjectionRevision: waitBinding.requiredDiscoveryBase.projectionRevision,
              requiredProjectionDigest: waitBinding.requiredDiscoveryBase.projectionDigest,
              deadlineAt: waitBinding.waitDeadlineAt,
              fallbackPolicyRevision: waitBinding.fallbackPolicyRevision,
            },
          }
        : {}),
      boundedWork: {
        schemaVersion: '1.0.0',
        maxResources: job.budget.maxResources,
        maxFindings: job.budget.maxFindings,
        maxProviderCalls: job.budget.maxProviderCalls,
        deadlineAt: job.budget.deadlineAt,
      },
      ...(relatedResources.length === 0 ? {} : { relatedResources }),
      ...(findings.length > FINDING_PAGE_CAP
        ? {
            relatedResourceCount: relatedResources.length,
            relatedResourcesTruncated: true,
          }
        : relatedResources.length > 0
          ? { relatedResourceCount: relatedResources.length, relatedResourcesTruncated: false }
          : {}),
    };
  }

  private async queueItemFrom(
    scope: ActivityAdapterScopeV1,
    row: DiscoveryActivityJobRow,
  ): Promise<ActivityQueueItemV1> {
    // The queue has always represented the durable Job lifecycle. A Run is
    // still the source for detail-level execution lineage, but allowing a
    // stale/terminal Run snapshot to overwrite the Job state would regress
    // the existing Activity queue contract (and can hide a later Job state).
    const runtimeState = row.job.lifecycleState;
    const state = commonState(runtimeState);
    const hasReviewEligibleFinding = await this.hasReviewEligibleFindingFor(
      scope,
      row.job,
      row.run,
    );
    const attention = attentionFor(runtimeState, hasReviewEligibleFinding);
    return {
      root: jobRoot(row),
      summary: `${triggerLabel(row.job)} · ${scanModeLabel(row.job)} · ${lifecycleLabel(row.job.lifecycleState)}`,
      state,
      dimensions: {
        schemaVersion: '1.0.0',
        attention: attention.state,
        retryability: activityRetryabilityFrom(
          runtimeState === 'FAILED_RETRYABLE'
            ? true
            : runtimeState === 'FAILED_TERMINAL' || runtimeState === 'CANCELLED'
              ? false
              : undefined,
        ),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
      updatedAt: maxTimestamp(row.job.updatedAt, row.run?.updatedAt),
    };
  }

  async readQueue(
    scope: ActivityAdapterScopeV1,
    filter: ActivityQueueFilterV1,
  ): Promise<ActivityQueuePageV1> {
    const limit = Math.min(PAGE_CAP, Math.max(1, filter.limit ?? PAGE_CAP));
    const { jobs } = await this.read.listJobs({
      projectId: scope.activeProjectId,
      ...(filter.cursor === undefined ? {} : { cursor: filter.cursor }),
      limit: limit + 1,
    });
    const pageRows = jobs.slice(0, limit);
    const items = (await Promise.all(pageRows.map((row) => this.queueItemFrom(scope, row)))).filter(
      (item) =>
        (filter.states === undefined || filter.states.includes(item.state)) &&
        (filter.attention === undefined || item.dimensions.attention === filter.attention),
    );
    const last = pageRows[pageRows.length - 1];
    const hasMore = jobs.length > limit;
    const nextCursor = hasMore && last !== undefined ? activityCursorForJob(last) : undefined;
    return {
      items,
      metadata: metadataFor({
        sourceUpdatedAt: maxTimestamp(
          ...pageRows.flatMap((row) => [row.job.updatedAt, row.run?.updatedAt]),
        ),
        ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
      }),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  private async resolveRun(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    job: DiscoveryJobV1,
  ): Promise<DiscoveryRunV1 | undefined> {
    // The deterministic pre-claim fallback is deliberately not resolved as a
    // Run. It keeps Job-root identity stable until a new projection observes
    // the durable Run and publishes its actual id.
    if (root.runId === job.jobId) return undefined;
    const run = await this.read.getRun({
      projectId: scope.activeProjectId,
      jobId: job.jobId,
      runId: root.runId,
    });
    if (run === undefined || run.projectId !== scope.activeProjectId || run.jobId !== job.jobId) {
      return notFound();
    }
    return run;
  }

  private attemptView(attempt: DiscoveryActivityAttemptRow): ActivityDomainAttemptViewV1 {
    return {
      schemaVersion: '1.0.0',
      attemptId: attempt.attemptId,
      runId: attempt.runId,
      attemptNumber: attempt.attemptNumber,
      attemptKind: 'DISCOVERY_EXECUTION',
      retryKind: attempt.attemptKind,
      state: commonState(attempt.lifecycleState),
      retryability: activityRetryabilityFrom(
        attempt.lifecycleState === 'FAILED_RETRYABLE'
          ? true
          : attempt.lifecycleState === 'FAILED_TERMINAL' || attempt.lifecycleState === 'CANCELLED'
            ? false
            : undefined,
      ),
      ...(safeFailureFrom(attempt.failure) === undefined
        ? {}
        : { failure: safeFailureFrom(attempt.failure) }),
      startedAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
      stageRefs: [],
    };
  }

  private stageView(
    stage: DiscoveryStageV1,
    attempt: DiscoveryActivityAttemptRow | undefined,
    sequence: number,
  ): ActivityStageViewV1 {
    const failure =
      attempt?.failure !== undefined &&
      (attempt.failure.failedStage === stage.stageType ||
        attempt.failure.failedStage === stage.stageId)
        ? safeFailureFrom(attempt.failure)
        : undefined;
    return {
      schemaVersion: '1.0.0',
      stageId: stage.stageId,
      stageKey: `discovery-attempt-${stage.attemptId}-stage-${stage.stageOrdinal}-${stage.stageType.toLowerCase()}`,
      label: stageLabels[stage.stageType],
      sequence,
      state: stageState(stage.state),
      startedAt: stage.createdAt,
      updatedAt: stage.updatedAt,
      ...(stage.completedAt === undefined ? {} : { completedAt: stage.completedAt }),
      ...(failure === undefined ? {} : { failure }),
    };
  }

  private eventViews(
    history: DiscoveryActivityHistoryV1,
    job: DiscoveryJobV1,
  ): ActivityEventViewV1[] {
    const all = [...history.job, ...history.run, ...history.attempt, ...history.stage].sort(
      historyEventSort,
    );
    return all.map((event, index) => ({
      schemaVersion: '1.0.0',
      eventId: `discovery:${job.jobId}:${event.resourceKind}:${event.resourceId}:${event.revision}`,
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: event.resourceKind,
        resourceId: event.resourceId,
        resourceRevision: event.revision,
      },
      category: eventCategory(event.toState),
      sequence: index + 1,
      occurredAt: event.occurredAt,
      summary: `Discovery ${event.resourceKind.replace('Discovery', '')} ${event.toState.toLowerCase().replaceAll('_', ' ')}`,
      domainResourceRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'DiscoveryJob',
        resourceId: job.jobId,
      },
    }));
  }

  async readDetail(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ActivityDetailV1> {
    const job = await this.jobForRoot(scope, root);
    const run = await this.resolveRun(scope, root, job);
    const attempts = run
      ? await this.read.listActivityAttempts({
          projectId: scope.activeProjectId,
          jobId: job.jobId,
          runId: run.runId,
        })
      : [];
    const stages = (
      await Promise.all(
        attempts.map((attempt) =>
          this.read.listActivityStages({
            projectId: scope.activeProjectId,
            jobId: job.jobId,
            runId: run?.runId ?? root.runId,
            attemptId: attempt.attemptId,
          }),
        ),
      )
    ).flat();
    const sortedStages = [...stages].sort((a, b) => {
      const attemptA =
        attempts.find((attempt) => attempt.attemptId === a.attemptId)?.attemptNumber ?? 0;
      const attemptB =
        attempts.find((attempt) => attempt.attemptId === b.attemptId)?.attemptNumber ?? 0;
      return (
        attemptA - attemptB || a.stageOrdinal - b.stageOrdinal || a.stageId.localeCompare(b.stageId)
      );
    });
    const history = await this.read.listHistory({
      projectId: scope.activeProjectId,
      jobId: job.jobId,
      runId: run?.runId ?? root.runId,
      attemptIds: attempts.map((attempt) => attempt.attemptId),
      stageIds: sortedStages.map((stage) => stage.stageId),
    });
    const diagnosticAggregate =
      run === undefined
        ? undefined
        : await this.read.getSemanticEssenceDiagnosticAggregate?.({
            projectId: scope.activeProjectId,
            jobId: job.jobId,
            runId: run.runId,
          });
    const currentState = run?.lifecycleState ?? job.lifecycleState;
    const findings = await this.findingsFor(scope, job, run);
    const hasReviewEligibleFinding = await this.hasReviewEligibleFindingFor(scope, job, run);
    const attention = attentionFor(currentState, hasReviewEligibleFinding);
    const runId = run?.runId ?? root.runId;
    const events = this.eventViews(history, job);
    if (diagnosticAggregate !== undefined) {
      events.push({
        ...semanticEssenceDiagnosticEvent({
          jobId: job.jobId,
          runId,
          runRevision: run?.runRevision ?? 1,
          excludedCount: diagnosticAggregate.excludedCount,
          ...(diagnosticAggregate.candidateCount === undefined
            ? {}
            : { candidateCount: diagnosticAggregate.candidateCount }),
          occurredAt: diagnosticAggregate.updatedAt,
        }),
        sequence: events.length + 1,
      });
    }
    const attemptRefs = attempts.map((attempt) => ({
      schemaVersion: '1.0.0' as const,
      resourceKind: 'DiscoveryAttempt',
      resourceId: attempt.attemptId,
      resourceRevision: attempt.lifecycleRevision,
    }));
    const correlationRefs = [
      {
        schemaVersion: '1.0.0' as const,
        refType: 'CORRELATION' as const,
        refKind: 'DiscoveryTrigger',
        refId: job.trigger.triggerId,
      },
    ];
    const completedAt =
      run?.completedAt ??
      (isTerminal(currentState) ? (run?.updatedAt ?? job.updatedAt) : undefined);
    const sourceUpdatedAt = maxTimestamp(
      job.updatedAt,
      run?.updatedAt,
      ...attempts.flatMap((attempt) => [attempt.updatedAt, attempt.failure?.occurredAt]),
      ...sortedStages.map((stage) => stage.updatedAt),
      ...(diagnosticAggregate === undefined ? [] : [diagnosticAggregate.updatedAt]),
      ...[...history.job, ...history.run, ...history.attempt, ...history.stage].map(
        (event) => event.occurredAt,
      ),
    );
    const firstFailure = [...attempts]
      .reverse()
      .map((attempt) => safeFailureFrom(attempt.failure))
      .find((failure) => failure !== undefined);
    const activityRoot = jobRoot({ job, ...(run === undefined ? {} : { run }) }, runId);
    return {
      root: activityRoot,
      run: {
        schemaVersion: '1.0.0',
        runId,
        jobId: job.jobId,
        sequence: run?.runRevision ?? 1,
        state: commonState(currentState),
        startedAt: run?.createdAt ?? job.createdAt,
        updatedAt: run?.updatedAt ?? job.updatedAt,
        ...(completedAt === undefined ? {} : { completedAt }),
        domainAttemptRefs: attemptRefs,
        correlationRefs,
        causationRefs: attempts
          .filter((attempt) => attempt.previousAttemptId !== undefined)
          .map((attempt) => ({
            schemaVersion: '1.0.0' as const,
            refType: 'CAUSATION' as const,
            refKind: 'DiscoveryAttempt',
            refId: attempt.previousAttemptId!,
          })),
      },
      attempts: attempts.map((attempt) => ({
        ...this.attemptView(attempt),
        stageRefs: sortedStages
          .filter((stage) => stage.attemptId === attempt.attemptId)
          .map((stage) => ({
            schemaVersion: '1.0.0' as const,
            resourceKind: 'DiscoveryStage',
            resourceId: stage.stageId,
            resourceRevision: stage.stageRevision,
          })),
      })),
      stages: sortedStages.map((stage, index) =>
        this.stageView(
          stage,
          attempts.find((attempt) => attempt.attemptId === stage.attemptId),
          index + 1,
        ),
      ),
      events,
      transportAttempts: [],
      metadata: metadataFor({ sourceUpdatedAt }),
      dimensions: {
        schemaVersion: '1.0.0',
        attention: attention.state,
        ...(firstFailure === undefined ? {} : { failure: firstFailure }),
        retryability: activityRetryabilityFrom(
          currentState === 'FAILED_RETRYABLE'
            ? true
            : currentState === 'FAILED_TERMINAL' || currentState === 'CANCELLED'
              ? false
              : undefined,
        ),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
      // WP5 is observation-only. Discovery retry/cancel remain outside the
      // generic Activity command surface until a later governed work item.
      presentation: this.presentationFor(job, run, findings, attention),
      availableActions: [],
    };
  }

  async readStages(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityStageContinuationV1> {
    const detail = await this.readDetail(scope, root);
    const offset = offsetFromCursor('stages', cursor);
    const capped = Math.min(PAGE_CAP, Math.max(1, limit ?? PAGE_CAP));
    const stages = detail.stages.slice(offset, offset + capped);
    const nextCursor =
      offset + stages.length < detail.stages.length
        ? cursorForOffset('stages', offset + stages.length)
        : undefined;
    return {
      stages,
      metadata: { ...detail.metadata, ...(nextCursor === undefined ? {} : { cursor: nextCursor }) },
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async readEvents(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityEventContinuationV1> {
    const detail = await this.readDetail(scope, root);
    const offset = offsetFromCursor('events', cursor);
    const capped = Math.min(PAGE_CAP, Math.max(1, limit ?? PAGE_CAP));
    const events = detail.events.slice(offset, offset + capped);
    const nextCursor =
      offset + events.length < detail.events.length
        ? cursorForOffset('events', offset + events.length)
        : undefined;
    return {
      events,
      metadata: { ...detail.metadata, ...(nextCursor === undefined ? {} : { cursor: nextCursor }) },
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }
}

/** In-memory owning-domain read port used by contract/integration tests. */
export class InMemoryDiscoveryActivityRead implements DiscoveryActivityReadPort {
  private readonly jobs = new Map<string, DiscoveryJobV1>();
  private readonly runs = new Map<string, DiscoveryRunV1>();
  private readonly attempts = new Map<string, DiscoveryActivityAttemptRow>();
  private readonly stages = new Map<string, DiscoveryStageV1>();
  private readonly histories = new Map<string, DiscoveryActivityHistoryV1>();

  private key(projectId: string, id: string): string {
    return `${projectId}\u0000${id}`;
  }

  seedJob(job: DiscoveryJobV1): void {
    this.jobs.set(this.key(job.projectId, job.jobId), job);
  }

  seedRun(run: DiscoveryRunV1): void {
    this.runs.set(this.key(run.projectId, run.runId), run);
  }

  seedAttempt(attempt: DiscoveryActivityAttemptRow): void {
    this.attempts.set(this.key(attempt.projectId, attempt.attemptId), attempt);
  }

  seedStage(stage: DiscoveryStageV1): void {
    this.stages.set(this.key(stage.projectId, stage.stageId), stage);
  }

  seedHistory(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly history: DiscoveryActivityHistoryV1;
  }): void {
    this.histories.set(this.key(input.projectId, input.runId), input.history);
  }

  async listJobs(input: {
    readonly projectId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{ readonly jobs: readonly DiscoveryActivityJobRow[]; readonly nextCursor?: string }> {
    let rows = [...this.jobs.values()]
      .filter((job) => job.projectId === input.projectId)
      .map((job): DiscoveryActivityJobRow => ({
        job,
        run: [...this.runs.values()]
          .filter((run) => run.projectId === job.projectId && run.jobId === job.jobId)
          .sort((a, b) => b.runRevision - a.runRevision || a.runId.localeCompare(b.runId))[0],
      }))
      .sort((a, b) => {
        const aUpdated = maxTimestamp(a.job.updatedAt, a.run?.updatedAt);
        const bUpdated = maxTimestamp(b.job.updatedAt, b.run?.updatedAt);
        return bUpdated.localeCompare(aUpdated) || a.job.jobId.localeCompare(b.job.jobId);
      });
    if (input.cursor !== undefined) {
      const cursor = decodeDiscoveryActivityCursor(input.cursor);
      rows = rows.filter((row) => {
        const updatedAt = maxTimestamp(row.job.updatedAt, row.run?.updatedAt);
        return (
          updatedAt < cursor.updatedAt ||
          (updatedAt === cursor.updatedAt && row.job.jobId > cursor.jobId)
        );
      });
    }
    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      jobs: page,
      ...(rows.length > page.length && last !== undefined
        ? {
            nextCursor: encodeDiscoveryActivityCursor({
              updatedAt: maxTimestamp(last.job.updatedAt, last.run?.updatedAt),
              jobId: last.job.jobId,
            }),
          }
        : {}),
    };
  }

  async getJob(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryJobV1 | undefined> {
    return this.jobs.get(this.key(input.projectId, input.jobId));
  }

  async getRun(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<DiscoveryRunV1 | undefined> {
    const run = this.runs.get(this.key(input.projectId, input.runId));
    return run?.jobId === input.jobId ? run : undefined;
  }

  async getLatestRun(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryRunV1 | undefined> {
    return [...this.runs.values()]
      .filter((run) => run.projectId === input.projectId && run.jobId === input.jobId)
      .sort((a, b) => b.runRevision - a.runRevision || a.runId.localeCompare(b.runId))[0];
  }

  async listActivityAttempts(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<readonly DiscoveryActivityAttemptRow[]> {
    return [...this.attempts.values()]
      .filter(
        (attempt) =>
          attempt.projectId === input.projectId &&
          attempt.jobId === input.jobId &&
          attempt.runId === input.runId,
      )
      .sort((a, b) => a.attemptNumber - b.attemptNumber || a.attemptId.localeCompare(b.attemptId));
  }

  async listActivityStages(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptId: string;
  }): Promise<readonly DiscoveryStageV1[]> {
    return [...this.stages.values()]
      .filter(
        (stage) =>
          stage.projectId === input.projectId &&
          stage.jobId === input.jobId &&
          stage.runId === input.runId &&
          stage.attemptId === input.attemptId,
      )
      .sort((a, b) => a.stageOrdinal - b.stageOrdinal || a.stageId.localeCompare(b.stageId));
  }

  async listHistory(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<DiscoveryActivityHistoryV1>;
  async listHistory(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptIds: readonly string[];
    readonly stageIds: readonly string[];
  }): Promise<DiscoveryActivityHistoryV1>;
  async listHistory(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptIds?: readonly string[];
    readonly stageIds?: readonly string[];
  }): Promise<DiscoveryActivityHistoryV1> {
    return (
      this.histories.get(this.key(input.projectId, input.runId)) ?? {
        job: [],
        run: [],
        attempt: [],
        stage: [],
      }
    );
  }
}

export const createInMemoryDiscoveryActivityRead = (): InMemoryDiscoveryActivityRead =>
  new InMemoryDiscoveryActivityRead();
