import { describe, expect, it } from 'vitest';

import {
  DiscoveryActivityAdapter,
  InMemoryDiscoveryActivityRead,
} from '../../adapters/frontend-activity-discovery/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProductCoordinator,
  ActivityProjectionBuilder,
  type ActivityAdapterRegistryPort,
  type ActivityProductScopeV1,
  type DiscoveryActivityReadPort,
} from '../../modules/frontend-activity/src/index.js';
import type {
  DiscoveryJobV1,
  DiscoveryRunV1,
  DiscoveryStageV1,
  DiscoveryTriggerV1,
} from '../../packages/contracts/src/index.js';
import type {
  DiscoveryActivityAttemptRow,
  DiscoveryActivityFindingReadPort,
  DiscoveryActivityHistoryV1,
} from '../../modules/frontend-activity/src/index.js';

const budget = {
  schemaVersion: '1.0.0' as const,
  budgetVersion: 'discovery-work-budget:v1' as const,
  budgetId: 'budget-1',
  budgetRevision: 'budget-1',
  maxResources: 10,
  maxSemanticNeighbors: 10,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 1,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 100,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const trigger: DiscoveryTriggerV1 = {
  schemaVersion: '1.0.0',
  triggerId: 'trigger-1',
  triggerClass: 'MANUAL',
  triggerIdentity: { kind: 'MANUAL', commandId: 'command-1', requestId: 'request-1' },
  projectId: 'project-1',
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 1, snapshotDigest: 'canonical-1' },
  requiredDiscoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-1',
    projectionDigest: 'projection-1',
  },
  policyRevision: 'policy-1',
  strategyRevision: 'strategy-1',
  createdAt: '2026-08-30T00:00:00.000Z',
  observedAt: '2026-08-30T00:00:00.000Z',
  correlationId: 'correlation-1',
  actor: { actorId: 'actor-1', principalId: 'principal-1' },
};

const job: DiscoveryJobV1 = {
  schemaVersion: '1.0.0',
  jobId: 'job-1',
  logicalIdentity: {
    schemaVersion: '1.0.0',
    identityVersion: 'discovery-job-logical:v1',
    value: 'logical-job-1',
  },
  projectId: 'project-1',
  trigger,
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: trigger.canonicalBase,
  requiredDiscoveryBase: trigger.requiredDiscoveryBase,
  policyRevision: 'policy-1',
  strategyRevision: 'strategy-1',
  budget,
  lifecycleState: 'SUCCEEDED',
  lifecycleRevision: 3,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:09.000Z',
};

const run: DiscoveryRunV1 = {
  schemaVersion: '1.0.0',
  runId: 'run-1',
  jobId: job.jobId,
  projectId: job.projectId,
  requestedScanMode: job.requestedScanMode,
  effectiveScanMode: job.effectiveScanMode,
  runRevision: 1,
  canonicalBase: job.canonicalBase,
  requiredDiscoveryBase: job.requiredDiscoveryBase,
  policyRevision: job.policyRevision,
  strategyRevision: job.strategyRevision,
  budget: job.budget,
  lifecycleState: 'SUCCEEDED',
  lifecycleRevision: 3,
  createdAt: '2026-08-30T00:00:01.000Z',
  updatedAt: '2026-08-30T00:00:09.000Z',
  completedAt: '2026-08-30T00:00:09.000Z',
};

const attempt1: DiscoveryActivityAttemptRow = {
  schemaVersion: '1.0.0',
  attemptId: 'attempt-1',
  jobId: job.jobId,
  runId: run.runId,
  projectId: job.projectId,
  attemptNumber: 1,
  lifecycleRevision: 2,
  attemptKind: 'INITIAL',
  lifecycleState: 'FAILED_RETRYABLE',
  createdAt: '2026-08-30T00:00:02.000Z',
  updatedAt: '2026-08-30T00:00:04.000Z',
  completedAt: '2026-08-30T00:00:04.000Z',
  failure: {
    schemaVersion: '1.0.0',
    code: 'PROVIDER_TIMEOUT',
    classification: 'RETRYABLE',
    retryable: true,
    safeMessage: 'The provider timed out; the attempt was scheduled for retry.',
    failedStage: 'GENERATE_FINDINGS',
    occurredAt: '2026-08-30T00:00:04.000Z',
    retryNotBefore: '2026-08-30T00:00:05.000Z',
  },
};

const attempt2: DiscoveryActivityAttemptRow = {
  ...attempt1,
  attemptId: 'attempt-2',
  attemptNumber: 2,
  attemptKind: 'DOMAIN_RETRY',
  lifecycleRevision: 2,
  lifecycleState: 'SUCCEEDED',
  previousAttemptId: attempt1.attemptId,
  createdAt: '2026-08-30T00:00:05.000Z',
  updatedAt: '2026-08-30T00:00:09.000Z',
  completedAt: '2026-08-30T00:00:09.000Z',
  failure: undefined,
};

const stage = (input: {
  readonly stageId: string;
  readonly attemptId: string;
  readonly state: DiscoveryStageV1['state'];
  readonly ordinal: number;
  readonly type: DiscoveryStageV1['stageType'];
  readonly at: string;
}): DiscoveryStageV1 => ({
  schemaVersion: '1.0.0',
  stageId: input.stageId,
  jobId: job.jobId,
  runId: run.runId,
  attemptId: input.attemptId,
  projectId: job.projectId,
  stageOrdinal: input.ordinal,
  stageType: input.type,
  stageRevision: input.state === 'FAILED_RETRYABLE' ? 2 : 1,
  state: input.state,
  createdAt: input.at,
  updatedAt: input.at,
  ...(input.state === 'SUCCEEDED' || input.state === 'FAILED_RETRYABLE'
    ? { completedAt: input.at }
    : {}),
});

const history: DiscoveryActivityHistoryV1 = {
  job: [
    {
      resourceKind: 'DiscoveryJob',
      resourceId: job.jobId,
      projectId: job.projectId,
      jobId: job.jobId,
      revision: 1,
      toState: 'QUEUED',
      occurredAt: '2026-08-30T00:00:00.000Z',
    },
    {
      resourceKind: 'DiscoveryJob',
      resourceId: job.jobId,
      projectId: job.projectId,
      jobId: job.jobId,
      revision: 2,
      fromState: 'QUEUED',
      toState: 'RUNNING',
      occurredAt: '2026-08-30T00:00:01.000Z',
    },
    {
      resourceKind: 'DiscoveryJob',
      resourceId: job.jobId,
      projectId: job.projectId,
      jobId: job.jobId,
      revision: 3,
      fromState: 'RUNNING',
      toState: 'SUCCEEDED',
      occurredAt: '2026-08-30T00:00:09.000Z',
    },
  ],
  run: [
    {
      resourceKind: 'DiscoveryRun',
      resourceId: run.runId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      revision: 1,
      toState: 'QUEUED',
      occurredAt: '2026-08-30T00:00:01.000Z',
    },
    {
      resourceKind: 'DiscoveryRun',
      resourceId: run.runId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      revision: 2,
      fromState: 'QUEUED',
      toState: 'RUNNING',
      occurredAt: '2026-08-30T00:00:02.000Z',
    },
    {
      resourceKind: 'DiscoveryRun',
      resourceId: run.runId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      revision: 3,
      fromState: 'RUNNING',
      toState: 'SUCCEEDED',
      occurredAt: '2026-08-30T00:00:09.000Z',
    },
  ],
  attempt: [
    {
      resourceKind: 'DiscoveryAttempt',
      resourceId: attempt1.attemptId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt1.attemptId,
      revision: 1,
      toState: 'RUNNING',
      occurredAt: '2026-08-30T00:00:02.000Z',
    },
    {
      resourceKind: 'DiscoveryAttempt',
      resourceId: attempt1.attemptId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt1.attemptId,
      revision: 2,
      fromState: 'RUNNING',
      toState: 'FAILED_RETRYABLE',
      occurredAt: '2026-08-30T00:00:04.000Z',
    },
    {
      resourceKind: 'DiscoveryAttempt',
      resourceId: attempt2.attemptId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt2.attemptId,
      revision: 1,
      toState: 'RUNNING',
      occurredAt: '2026-08-30T00:00:05.000Z',
    },
    {
      resourceKind: 'DiscoveryAttempt',
      resourceId: attempt2.attemptId,
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt2.attemptId,
      revision: 2,
      fromState: 'RUNNING',
      toState: 'SUCCEEDED',
      occurredAt: '2026-08-30T00:00:09.000Z',
    },
  ],
  stage: [
    {
      resourceKind: 'DiscoveryStage',
      resourceId: 'stage-1a',
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt1.attemptId,
      revision: 1,
      toState: 'QUEUED',
      occurredAt: '2026-08-30T00:00:02.000Z',
    },
    {
      resourceKind: 'DiscoveryStage',
      resourceId: 'stage-3a',
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt1.attemptId,
      revision: 2,
      toState: 'FAILED_RETRYABLE',
      occurredAt: '2026-08-30T00:00:04.000Z',
    },
    {
      resourceKind: 'DiscoveryStage',
      resourceId: 'stage-1b',
      projectId: job.projectId,
      jobId: job.jobId,
      runId: run.runId,
      attemptId: attempt2.attemptId,
      revision: 1,
      toState: 'SUCCEEDED',
      occurredAt: '2026-08-30T00:00:09.000Z',
    },
  ],
};

const scope: ActivityProductScopeV1 = {
  principalId: 'principal-1',
  activeProjectId: job.projectId,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-context-1',
  accessScope: ['activity:read', 'activity:refresh'],
  sensitivityClearance: 'internal',
};

const readWithFixture = (): InMemoryDiscoveryActivityRead => {
  const read = new InMemoryDiscoveryActivityRead();
  read.seedJob(job);
  read.seedRun(run);
  read.seedAttempt(attempt1);
  read.seedAttempt(attempt2);
  read.seedStage(
    stage({
      stageId: 'stage-1a',
      attemptId: attempt1.attemptId,
      state: 'FAILED_RETRYABLE',
      ordinal: 3,
      type: 'GENERATE_FINDINGS',
      at: '2026-08-30T00:00:04.000Z',
    }),
  );
  read.seedStage(
    stage({
      stageId: 'stage-1b',
      attemptId: attempt2.attemptId,
      state: 'SUCCEEDED',
      ordinal: 7,
      type: 'RECONCILE_FINDINGS',
      at: '2026-08-30T00:00:09.000Z',
    }),
  );
  read.seedHistory({ projectId: job.projectId, runId: run.runId, history });
  return read;
};

const registryFor = (adapter: DiscoveryActivityAdapter): ActivityAdapterRegistryPort => ({
  adapters: [adapter],
  adapterFor: (domainKind) => (domainKind === 'DISCOVERY' ? adapter : undefined),
  healthSummaries: () => ({ [adapter.adapterId]: adapter.health() }),
});

describe('AKP-4 WP5 Discovery Activity adapter', () => {
  it('maps durable retry history, reconciliation evidence and safe failure without exposing Findings', async () => {
    const adapter = new DiscoveryActivityAdapter(readWithFixture());
    const page = await adapter.readQueue(scope, { limit: 10 });
    const first = page.items[0]!;
    expect(first.root).toMatchObject({
      rootKind: 'JOB',
      activityId: job.jobId,
      domainKind: 'DISCOVERY',
      jobId: job.jobId,
      runId: run.runId,
    });
    const detail = await adapter.readDetail(scope, first.root);
    expect(detail.attempts.map((attempt) => attempt.attemptId)).toEqual(['attempt-1', 'attempt-2']);
    expect(detail.attempts[0]!.failure).toMatchObject({
      kind: 'TRANSIENT',
      code: 'PROVIDER_TIMEOUT',
    });
    expect(detail.attempts[1]!.failure).toBeUndefined();
    expect(detail.events.some((event) => event.category === 'RETRY_SCHEDULED')).toBe(true);
    expect(
      detail.events.some(
        (event) =>
          event.relatedRef.resourceKind === 'DiscoveryStage' &&
          event.relatedRef.resourceId === 'stage-1b',
      ),
    ).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('findingId');
    expect(JSON.stringify(detail)).not.toContain('stage_outputs');
    expect(detail.availableActions).toEqual([]);
  });

  it('maps WAITING_FOR_PROJECTION to queued pre-execution work, never WAITING_FOR_USER', async () => {
    const read = readWithFixture();
    const waitingJob = {
      ...job,
      jobId: 'job-waiting-for-projection',
      logicalIdentity: { ...job.logicalIdentity, value: 'logical-job-waiting-for-projection' },
      lifecycleState: 'WAITING_FOR_PROJECTION',
      lifecycleRevision: 4,
      updatedAt: '2026-08-30T00:00:30.000Z',
    } satisfies DiscoveryJobV1;
    read.seedJob(waitingJob);
    read.seedHistory({
      projectId: waitingJob.projectId,
      runId: waitingJob.jobId,
      history: {
        job: [
          {
            resourceKind: 'DiscoveryJob',
            resourceId: waitingJob.jobId,
            projectId: waitingJob.projectId,
            jobId: waitingJob.jobId,
            revision: 4,
            fromState: 'QUEUED',
            toState: 'WAITING_FOR_PROJECTION',
            occurredAt: '2026-08-30T00:00:30.000Z',
          },
        ],
        run: [],
        attempt: [],
        stage: [],
      },
    });
    const adapter = new DiscoveryActivityAdapter(read);
    const item = (await adapter.readQueue(scope, { limit: 10 })).items.find(
      (candidate) => candidate.root.activityId === waitingJob.jobId,
    )!;
    expect(item.state).toBe('QUEUED');
    expect(item.state).not.toBe('WAITING_FOR_USER');
    const detail = await adapter.readDetail(scope, item.root);
    expect(detail.run.state).toBe('QUEUED');
    expect(detail.run.runId).toBe(waitingJob.jobId);
    expect(detail.run.state).not.toBe('WAITING_FOR_USER');
    expect(
      detail.events.some(
        (event) =>
          event.relatedRef.resourceKind === 'DiscoveryJob' &&
          event.relatedRef.resourceId === waitingJob.jobId &&
          event.category === 'PROGRESS' &&
          event.summary.includes('waiting for projection'),
      ),
    ).toBe(true);
  });

  it('adds owner-readable WP4 presentation, exact Finding backlinks and server Attention', async () => {
    const findingRead: DiscoveryActivityFindingReadPort = {
      listActivityFindings: async (input) => {
        expect(input.projectId).toBe(job.projectId);
        expect(input.jobId).toBe(job.jobId);
        expect(input.runId).toBe(run.runId);
        return [
          {
            projectId: job.projectId,
            findingId: 'finding-1',
            findingRevision: 4,
            runId: run.runId,
            findingType: 'KNOWLEDGE_GAP',
            lifecycleState: 'REVIEW_READY',
            title: 'Missing owner context',
            reviewEligible: true,
            resourceHref: '/knowledge/discoveries/finding-1?revision=4',
          },
        ];
      },
    };
    const adapter = new DiscoveryActivityAdapter(readWithFixture(), findingRead);
    const item = (await adapter.readQueue(scope, { limit: 10 })).items[0]!;
    expect(item.summary).toContain('수동 Discovery 실행');
    expect(item.summary).not.toContain(job.jobId);
    expect(item.dimensions.attention).toBe('NEEDS_ATTENTION');

    const detail = await adapter.readDetail(scope, item.root);
    expect(detail.presentation).toMatchObject({
      title: '수동 Discovery 실행 · 증분 스캔',
      triggerLabel: '수동 Discovery 실행',
      scanModeLabel: '증분 스캔',
      attentionReason: 'REVIEW_ELIGIBLE_FINDING',
      boundedWork: {
        maxResources: budget.maxResources,
        maxFindings: budget.maxFindings,
        maxProviderCalls: budget.maxProviderCalls,
      },
      relatedResourceCount: 1,
      relatedResourcesTruncated: false,
    });
    expect(detail.presentation?.relatedResources?.[0]).toMatchObject({
      resourceId: 'finding-1',
      resourceRevision: 4,
      title: 'Missing owner context',
      resourceHref: '/knowledge/discoveries/finding-1?revision=4',
      authority: 'DERIVED_INFERENCE',
    });
    expect(detail.dimensions.progress).toBeUndefined();
    expect(detail.attempts[0]?.retryKind).toBe('INITIAL');
    expect(detail.attempts[1]?.retryKind).toBe('DOMAIN_RETRY');
    expect(detail.stages.find((entry) => entry.label === 'Finding 생성')).toBeDefined();
  });

  it('keeps projection wait owner-readable and does not convert it into user action or Attention', async () => {
    const read = new InMemoryDiscoveryActivityRead();
    const waitingJob = {
      ...job,
      jobId: 'job-wp4-wait',
      logicalIdentity: { ...job.logicalIdentity, value: 'logical-job-wp4-wait' },
      lifecycleState: 'WAITING_FOR_PROJECTION',
      lifecycleRevision: 4,
      projectionWait: {
        requiredDiscoveryBase: job.requiredDiscoveryBase!,
        waitDeadlineAt: '2026-09-01T00:00:00.000Z',
        fallbackPolicyRevision: 'fallback-policy-1',
      },
      updatedAt: '2026-08-31T00:00:30.000Z',
    } satisfies DiscoveryJobV1;
    read.seedJob(waitingJob);
    read.seedHistory({
      projectId: waitingJob.projectId,
      runId: waitingJob.jobId,
      history: { job: [], run: [], attempt: [], stage: [] },
    });
    const adapter = new DiscoveryActivityAdapter(read);
    const root = (await adapter.readQueue(scope, { limit: 10 })).items.find(
      (entry) => entry.root.activityId === waitingJob.jobId,
    )!.root;
    const detail = await adapter.readDetail(scope, root);
    expect(detail.run.state).toBe('QUEUED');
    expect(detail.dimensions.attention).toBe('NONE');
    expect(detail.availableActions).toEqual([]);
    expect(detail.presentation?.wait).toMatchObject({
      state: 'WAITING_FOR_PROJECTION',
      requiredProjectionRevision: job.requiredDiscoveryBase?.projectionRevision,
      deadlineAt: '2026-09-01T00:00:00.000Z',
      fallbackPolicyRevision: 'fallback-policy-1',
    });
    expect(JSON.stringify(detail)).not.toContain('WAITING_FOR_USER');
  });

  it('preserves partial, terminal failure and cancellation distinctions at the common Activity boundary', async () => {
    for (const [runtimeState, activityState] of [
      ['PARTIAL', 'PARTIAL'],
      ['FAILED_TERMINAL', 'FAILED'],
      ['CANCELLED', 'CANCELLED'],
    ] as const) {
      const read = readWithFixture();
      read.seedJob({
        ...job,
        lifecycleState: runtimeState,
        lifecycleRevision: job.lifecycleRevision + 1,
        updatedAt: '2026-08-30T00:00:11.000Z',
      });
      const item = (await new DiscoveryActivityAdapter(read).readQueue(scope, { limit: 10 }))
        .items[0]!;
      expect(item.state).toBe(activityState);
    }
  });

  it('keeps identity deterministic, binds access to the active project and exposes no generic commands', async () => {
    const adapter = new DiscoveryActivityAdapter(readWithFixture());
    const first = (await adapter.readQueue(scope, { limit: 10 })).items[0]!;
    const second = (await adapter.readQueue(scope, { limit: 10 })).items[0]!;
    expect(second.root).toEqual(first.root);
    expect(await adapter.canAccess(scope, first.root)).toBe(true);
    expect(await adapter.canAccess({ ...scope, activeProjectId: 'project-2' }, first.root)).toBe(
      false,
    );
  });

  it('keeps queue pagination aligned with the durable job/run updated timestamp', async () => {
    const read = readWithFixture();
    read.seedJob({
      ...job,
      jobId: 'job-2',
      logicalIdentity: { ...job.logicalIdentity, value: 'logical-job-2' },
      updatedAt: '2026-08-30T00:00:08.000Z',
    });
    read.seedRun({
      ...run,
      runId: 'run-2',
      jobId: 'job-2',
      updatedAt: '2026-08-30T00:00:20.000Z',
      completedAt: '2026-08-30T00:00:20.000Z',
    });
    const adapter = new DiscoveryActivityAdapter(read);
    const first = await adapter.readQueue(scope, { limit: 1 });
    expect(first.items.map((item) => item.root.activityId)).toEqual(['job-2']);
    expect(first.nextCursor).toBeDefined();

    const second = await adapter.readQueue(scope, {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.root.activityId)).toEqual([job.jobId]);
  });

  it('continues after a raw page is empty after Activity filtering', async () => {
    const read = readWithFixture();
    const nonMatchingJob = {
      ...job,
      jobId: 'job-filtered-out',
      logicalIdentity: { ...job.logicalIdentity, value: 'logical-job-filtered-out' },
      lifecycleState: 'RUNNING',
      lifecycleRevision: 4,
      updatedAt: '2026-08-30T00:00:20.000Z',
    } satisfies DiscoveryJobV1;
    const matchingJob = {
      ...job,
      jobId: 'job-filtered-match',
      logicalIdentity: { ...job.logicalIdentity, value: 'logical-job-filtered-match' },
      lifecycleState: 'SUCCEEDED',
      lifecycleRevision: 4,
      updatedAt: '2026-08-30T00:00:10.000Z',
    } satisfies DiscoveryJobV1;
    read.seedJob(nonMatchingJob);
    read.seedJob(matchingJob);

    const adapter = new DiscoveryActivityAdapter(read);
    const first = await adapter.readQueue(scope, {
      limit: 1,
      states: ['SUCCEEDED'],
    });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).toBeDefined();

    const returnedIds: string[] = [];
    const seenCursors = new Set<string>();
    let cursor = first.nextCursor;
    for (let pageNumber = 0; pageNumber < 4 && cursor !== undefined; pageNumber += 1) {
      expect(seenCursors.has(cursor)).toBe(false);
      seenCursors.add(cursor);
      const page = await adapter.readQueue(scope, {
        limit: 1,
        states: ['SUCCEEDED'],
        cursor,
      });
      returnedIds.push(...page.items.map((item) => item.root.activityId));
      cursor = page.nextCursor;
    }

    expect(returnedIds).toEqual([matchingJob.jobId, job.jobId]);
    expect(new Set(returnedIds).size).toBe(returnedIds.length);
    expect(cursor).toBeUndefined();
  });

  it('does not mutate runtime state when the Activity read adapter fails', async () => {
    const read = readWithFixture();
    const before = await read.getJob({ projectId: job.projectId, jobId: job.jobId });
    const failingRead: DiscoveryActivityReadPort = {
      listJobs: async () => {
        throw new Error('database connection details must not escape');
      },
      getJob: read.getJob.bind(read),
      getRun: read.getRun.bind(read),
      getLatestRun: read.getLatestRun.bind(read),
      listActivityAttempts: read.listActivityAttempts.bind(read),
      listActivityStages: read.listActivityStages.bind(read),
      listHistory: read.listHistory.bind(read),
    };
    const adapter = new DiscoveryActivityAdapter(failingRead);
    await expect(adapter.readQueue(scope, { limit: 10 })).rejects.toThrow(
      'database connection details must not escape',
    );
    expect(await read.getJob({ projectId: job.projectId, jobId: job.jobId })).toEqual(before);
  });

  it('travels through the existing projection and Product API queue/detail/stages/events/refresh paths', async () => {
    const adapter = new DiscoveryActivityAdapter(readWithFixture());
    const store = createInMemoryActivityReadModelStore();
    const registry = registryFor(adapter);
    const builder = new ActivityProjectionBuilder(
      registry,
      store,
      () => new Date('2026-08-30T00:01:00.000Z'),
    );
    const coordinator = new ActivityProductCoordinator(
      registry,
      store,
      builder,
      () => new Date('2026-08-30T00:01:00.000Z'),
    );
    const refreshed = await coordinator.refreshActivityProjection(scope, {
      schemaVersion: '1.0.0',
    });
    expect(refreshed.indexCount).toBe(1);
    const queue = await coordinator.listActivityQueue(scope, {
      schemaVersion: '1.0.0',
      domainKinds: ['DISCOVERY'],
    });
    const root = queue.items[0]!.root;
    const request = {
      schemaVersion: '1.0.0' as const,
      domainKind: 'DISCOVERY' as const,
      activityId: root.activityId,
      domainResourceKind: root.domainResourceKind,
      domainResourceId: root.domainResourceId,
    };
    expect((await coordinator.getActivityDetail(scope, request)).root.activityId).toBe(job.jobId);
    expect(
      (await coordinator.listActivityStages(scope, { ...request, limit: 1 })).stages,
    ).toHaveLength(1);
    expect(
      (await coordinator.listActivityEvents(scope, { ...request, limit: 2 })).events,
    ).toHaveLength(2);
  });
});
