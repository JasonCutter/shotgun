import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  ActivityEventCategoryV1,
  ActivityEventViewV1,
  ActivityLifecycleStateV1,
  ActivityQueueItemV1,
  ActivityQueuePageV1,
  ActivityRootReferenceV1,
  ActivitySafeFailureV1,
  ActivityStageViewV1,
  AnalysisRevisionV2,
  ClaimCandidate,
} from '../../../packages/contracts/src/index.js';
import {
  type ActivityAdapterHealthV1,
  type ActivityAdapterScopeV1,
  type ActivityAdapterPort,
  type ActivityDetailV1,
  type ActivityEventContinuationV1,
  type ActivityQueueFilterV1,
  type ActivityQueuePageV1 as ModuleActivityQueuePageV1,
  type ActivityStageContinuationV1,
} from '../../../modules/frontend-activity/src/index.js';
import type {
  ComparisonV2BlockedOutcome,
  ComparisonV2BlockedOutcomeRepositoryPort,
  ComparisonV2TerminalAnalysisReaderPort,
} from '../../../modules/comparison/src/index.js';

const ADAPTER_ID = 'comparison-activity-adapter';
const BLOCKED_RESOURCE_KIND = 'ComparisonBlockedOutcome';
const ANALYSIS_RESOURCE_KIND = 'ComparisonAnalysisRevision';

const SENSITIVITY_RANK: Readonly<Record<string, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

type CandidateAccessReader = {
  findById(projectId: string, candidateId: string): Promise<ClaimCandidate | undefined>;
};

type ComparisonActivityRecord =
  | { readonly kind: 'BLOCKED'; readonly outcome: ComparisonV2BlockedOutcome }
  | {
      readonly kind: 'TERMINAL_ANALYSIS';
      readonly analysis: AnalysisRevisionV2;
      readonly projectId: string;
    };

const notFound = (): never => {
  throw new FrontendContractError('NOT_FOUND', 'The Activity resource was not found.');
};

const safeFailure = (input: {
  readonly code: string;
  readonly occurredAt: string;
  readonly message: string;
}): ActivitySafeFailureV1 => ({
  schemaVersion: '1.0.0',
  kind: 'PERMANENT',
  code: input.code,
  message: input.message,
  occurredAt: input.occurredAt,
});

const analysisObservedAt = (analysis: AnalysisRevisionV2): string =>
  analysis.completedAt ?? analysis.createdAt;

const analysisIdentity = (analysis: AnalysisRevisionV2): string =>
  `${analysis.candidate.id}|${analysis.candidate.revision}|${analysis.candidate.digest}`;

const isNewerAnalysis = (candidate: AnalysisRevisionV2, current: AnalysisRevisionV2): boolean =>
  candidate.attempt > current.attempt ||
  (candidate.attempt === current.attempt &&
    (candidate.createdAt > current.createdAt ||
      (candidate.createdAt === current.createdAt &&
        candidate.analysisRevisionId > current.analysisRevisionId)));

const rootFor = (record: ComparisonActivityRecord): ActivityRootReferenceV1 => {
  if (record.kind === 'BLOCKED') {
    const outcome = record.outcome;
    return {
      schemaVersion: '1.0.0',
      rootKind: 'JOB',
      activityId: outcome.blockedOutcomeId,
      domainKind: 'COMPARISON',
      domainResourceKind: BLOCKED_RESOURCE_KIND,
      domainResourceId: outcome.blockedOutcomeId,
      resourceProjectId: outcome.projectId,
      resourceHref: `/activity?domain=COMPARISON&activity=${encodeURIComponent(outcome.blockedOutcomeId)}&resource=${BLOCKED_RESOURCE_KIND}&resourceId=${encodeURIComponent(outcome.blockedOutcomeId)}`,
      jobId: outcome.blockedOutcomeId,
      runId: `stage5-blocked:${outcome.blockedOutcomeId}`,
    };
  }
  const analysis = record.analysis;
  return {
    schemaVersion: '1.0.0',
    rootKind: 'JOB',
    activityId: analysis.analysisRevisionId,
    domainKind: 'COMPARISON',
    domainResourceKind: ANALYSIS_RESOURCE_KIND,
    domainResourceId: analysis.analysisRevisionId,
    resourceProjectId: record.projectId,
    resourceHref: `/activity?domain=COMPARISON&activity=${encodeURIComponent(analysis.analysisRevisionId)}&resource=${ANALYSIS_RESOURCE_KIND}&resourceId=${encodeURIComponent(analysis.analysisRevisionId)}`,
    jobId: analysis.analysisRevisionId,
    runId: `stage5-analysis:${analysis.analysisRevisionId}`,
  };
};

const stateFor = (record: ComparisonActivityRecord): ActivityLifecycleStateV1 => {
  if (record.kind === 'BLOCKED') return record.outcome.state === 'ACTIVE' ? 'FAILED' : 'SUCCEEDED';
  return 'FAILED';
};

const attentionFor = (record: ComparisonActivityRecord) => {
  if (record.kind === 'BLOCKED')
    return record.outcome.state === 'ACTIVE' ? ('NEEDS_ATTENTION' as const) : ('RESOLVED' as const);
  return 'NEEDS_ATTENTION' as const;
};

const queueItemFor = (record: ComparisonActivityRecord): ActivityQueueItemV1 => {
  const root = rootFor(record);
  if (record.kind === 'BLOCKED') {
    const outcome = record.outcome;
    return {
      root,
      summary: 'Stage 5 comparison requires attention',
      state: stateFor(record),
      dimensions: {
        schemaVersion: '1.0.0',
        attention: attentionFor(record),
        retryability: 'UNKNOWN',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
        ...(outcome.state === 'ACTIVE'
          ? {
              failure: safeFailure({
                code: outcome.safeCode,
                message: 'Stage 5 comparison is blocked and requires attention.',
                occurredAt: outcome.lastObservedAt,
              }),
            }
          : {}),
      },
      presentation: {
        schemaVersion: '1.0.0',
        title: 'Stage 5 comparison blocked',
        triggerLabel: 'Candidate validation',
        scanModeLabel: 'Governed semantic comparison',
        attentionReason: 'FAILED_TERMINAL',
      },
      updatedAt: outcome.lastObservedAt,
    };
  }
  const analysis = record.analysis;
  const observedAt = analysisObservedAt(analysis);
  return {
    root,
    summary: 'Stage 5 semantic analysis requires attention',
    state: 'FAILED',
    dimensions: {
      schemaVersion: '1.0.0',
      attention: 'NEEDS_ATTENTION',
      retryability: analysis.state === 'FAILED_RETRYABLE' ? 'RETRYABLE' : 'UNKNOWN',
      freshness: 'CURRENT',
      adapterStatus: 'AVAILABLE',
      failure: safeFailure({
        code: analysis.safeFailureCode ?? analysis.state,
        message: 'Stage 5 semantic analysis requires attention.',
        occurredAt: observedAt,
      }),
    },
    presentation: {
      schemaVersion: '1.0.0',
      title: 'Stage 5 semantic analysis failed',
      triggerLabel: 'Candidate validation',
      scanModeLabel: 'Governed semantic comparison',
      attentionReason: 'FAILED_TERMINAL',
    },
    updatedAt: observedAt,
  };
};

const stageFor = (record: ComparisonActivityRecord): ActivityStageViewV1 => {
  const root = rootFor(record);
  const observedAt =
    record.kind === 'BLOCKED' ? record.outcome.lastObservedAt : analysisObservedAt(record.analysis);
  const startedAt =
    record.kind === 'BLOCKED' ? record.outcome.firstObservedAt : record.analysis.startedAt;
  const failure =
    record.kind === 'BLOCKED'
      ? record.outcome.state === 'ACTIVE'
        ? safeFailure({
            code: record.outcome.safeCode,
            message: 'Stage 5 comparison is blocked and requires attention.',
            occurredAt: observedAt,
          })
        : undefined
      : safeFailure({
          code: record.analysis.safeFailureCode ?? record.analysis.state,
          message: 'Stage 5 semantic analysis requires attention.',
          occurredAt: observedAt,
        });
  return {
    schemaVersion: '1.0.0',
    stageId: `stage5:${root.activityId}`,
    stageKey: 'STAGE_5_COMPARISON',
    label: record.kind === 'BLOCKED' ? 'Stage 5 semantic comparison' : 'Stage 5 semantic analysis',
    sequence: 5,
    state: stateFor(record) === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
    startedAt,
    updatedAt: observedAt,
    ...(failure === undefined ? { completedAt: observedAt } : { failure }),
  };
};

const eventFor = (record: ComparisonActivityRecord): ActivityEventViewV1 => {
  const root = rootFor(record);
  const active = record.kind === 'BLOCKED' && record.outcome.state === 'ACTIVE';
  const occurredAt =
    record.kind === 'BLOCKED' ? record.outcome.lastObservedAt : analysisObservedAt(record.analysis);
  return {
    schemaVersion: '1.0.0',
    eventId: `stage5:${root.activityId}`,
    relatedRef: {
      schemaVersion: '1.0.0',
      resourceKind: root.domainResourceKind,
      resourceId: root.domainResourceId,
    },
    category: (active ? 'USER_ATTENTION' : 'FAILED') as ActivityEventCategoryV1,
    sequence: 1,
    occurredAt,
    summary: active ? 'Stage 5 comparison blocked' : 'Stage 5 semantic analysis failed',
    domainResourceRef: {
      schemaVersion: '1.0.0',
      resourceKind: root.domainResourceKind,
      resourceId: root.domainResourceId,
    },
  };
};

const metadata = (now: string, sourceUpdatedAt: string): ActivityQueuePageV1['metadata'] => ({
  schemaVersion: '1.0.0',
  snapshotRevision: 1,
  generatedAt: now,
  sourceUpdatedAt,
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  partial: false,
});

export class ComparisonActivityAdapter implements ActivityAdapterPort {
  readonly adapterId = ADAPTER_ID;
  readonly domainKind = 'COMPARISON' as const;
  readonly domainKinds = ['COMPARISON'] as const;

  constructor(
    private readonly blocked: ComparisonV2BlockedOutcomeRepositoryPort,
    private readonly terminal?: ComparisonV2TerminalAnalysisReaderPort,
    private readonly candidates?: CandidateAccessReader,
  ) {}

  health(): ActivityAdapterHealthV1 {
    return { status: 'AVAILABLE' };
  }

  private async candidateCanAccess(
    scope: ActivityAdapterScopeV1,
    analysis: AnalysisRevisionV2,
  ): Promise<boolean> {
    if (!this.candidates) return false;
    const candidate = await this.candidates.findById(scope.activeProjectId, analysis.candidate.id);
    if (
      !candidate ||
      candidate.projectId !== scope.activeProjectId ||
      candidate.revisionNumber !== analysis.candidate.revision
    )
      return false;
    const granted = new Set(scope.accessScope ?? []);
    if (!candidate.accessScope.every((value) => granted.has(value))) return false;
    const candidateRank = SENSITIVITY_RANK[candidate.sensitivity] ?? Number.MAX_SAFE_INTEGER;
    const clearanceRank = SENSITIVITY_RANK[scope.sensitivityClearance ?? 'public'] ?? -1;
    return candidateRank <= clearanceRank;
  }

  private async blockedCanAccess(
    scope: ActivityAdapterScopeV1,
    outcome: ComparisonV2BlockedOutcome,
  ): Promise<boolean> {
    if (outcome.projectId !== scope.activeProjectId) return false;
    const granted = new Set(scope.accessScope ?? []);
    if (!outcome.accessScope.every((value) => granted.has(value))) return false;
    const outcomeRank = SENSITIVITY_RANK[outcome.sensitivity] ?? Number.MAX_SAFE_INTEGER;
    const clearanceRank = SENSITIVITY_RANK[scope.sensitivityClearance ?? 'public'] ?? -1;
    return outcomeRank <= clearanceRank;
  }

  private async terminalRecords(
    scope: ActivityAdapterScopeV1,
  ): Promise<readonly ComparisonActivityRecord[]> {
    if (!this.terminal || !this.candidates) return [];
    const analyses = await this.latestTerminalAnalyses(scope.activeProjectId);
    const records: ComparisonActivityRecord[] = [];
    for (const analysis of analyses) {
      if (await this.candidateCanAccess(scope, analysis))
        records.push({ kind: 'TERMINAL_ANALYSIS', analysis, projectId: scope.activeProjectId });
    }
    return records;
  }

  /**
   * AnalysisRevisionV2 is append-only by attempt.  Select the latest
   * authoritative state for each Candidate revision/digest before deciding
   * whether a safe terminal failure is visible; otherwise an old failure can
   * resurrect after a later completion or policy block.
   */
  private async latestTerminalAnalyses(projectId: string): Promise<readonly AnalysisRevisionV2[]> {
    if (!this.terminal) return [];
    const latestByCandidate = new Map<string, AnalysisRevisionV2>();
    for (const analysis of await this.terminal.listTerminalAnalysisRevisions(projectId)) {
      const identity = analysisIdentity(analysis);
      const current = latestByCandidate.get(identity);
      if (current === undefined || isNewerAnalysis(analysis, current)) {
        latestByCandidate.set(identity, analysis);
      }
    }
    return [...latestByCandidate.values()].filter((analysis) =>
      ['SEMANTIC_UNAVAILABLE', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'].includes(analysis.state),
    );
  }

  private async recordsFor(
    scope: ActivityAdapterScopeV1,
  ): Promise<readonly ComparisonActivityRecord[]> {
    const [blocks, terminalRecords] = await Promise.all([
      this.blocked.listBlockedOutcomes(scope.activeProjectId),
      this.terminalRecords(scope),
    ]);
    const terminalKeys = new Set(
      terminalRecords
        .filter(
          (
            record,
          ): record is Extract<ComparisonActivityRecord, { readonly kind: 'TERMINAL_ANALYSIS' }> =>
            record.kind === 'TERMINAL_ANALYSIS',
        )
        .map(
          (record) =>
            `${record.analysis.candidate.id}|${record.analysis.candidate.revision}|${record.analysis.candidate.digest}`,
        ),
    );
    const blockRecords = blocks
      .filter(
        (outcome) =>
          outcome.state !== 'ACTIVE' ||
          !terminalKeys.has(
            `${outcome.candidateId}|${outcome.candidateRevision}|${outcome.candidateDigest}`,
          ),
      )
      .map((outcome) => ({ kind: 'BLOCKED' as const, outcome }));
    return [...blockRecords, ...terminalRecords].sort((left, right) =>
      queueItemFor(right).updatedAt.localeCompare(queueItemFor(left).updatedAt),
    );
  }

  async canAccess(scope: ActivityAdapterScopeV1, root: ActivityRootReferenceV1): Promise<boolean> {
    if (root.domainResourceKind === BLOCKED_RESOURCE_KIND) {
      const outcome = await this.blocked.findBlockedOutcome(
        scope.activeProjectId,
        root.domainResourceId,
      );
      return outcome === undefined ? false : this.blockedCanAccess(scope, outcome);
    }
    if (root.domainResourceKind === ANALYSIS_RESOURCE_KIND && this.terminal && this.candidates) {
      const analysis = (await this.latestTerminalAnalyses(scope.activeProjectId)).find(
        (item) => item.analysisRevisionId === root.domainResourceId,
      );
      return analysis === undefined ? false : this.candidateCanAccess(scope, analysis);
    }
    return false;
  }

  async readQueue(
    scope: ActivityAdapterScopeV1,
    filter: ActivityQueueFilterV1,
  ): Promise<ModuleActivityQueuePageV1> {
    const all = await this.recordsFor(scope);
    const stateFilter = new Set(filter.states ?? []);
    const filtered = all.filter((record) => {
      const item = queueItemFor(record);
      return (
        (stateFilter.size === 0 || stateFilter.has(item.state)) &&
        (filter.attention === undefined || item.dimensions.attention === filter.attention)
      );
    });
    const offset = filter.cursor?.startsWith('comparison:')
      ? Number.parseInt(filter.cursor.slice('comparison:'.length), 10)
      : 0;
    const limit = Math.max(1, filter.limit ?? 50);
    const page = filtered.slice(offset, offset + limit);
    const nextCursor =
      offset + page.length < filtered.length ? `comparison:${offset + page.length}` : undefined;
    const now = new Date().toISOString();
    const newest = page[0] === undefined ? now : queueItemFor(page[0]).updatedAt;
    return {
      items: page.map(queueItemFor),
      metadata: metadata(now, newest),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  private async resolve(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ComparisonActivityRecord> {
    if (root.domainResourceKind === BLOCKED_RESOURCE_KIND) {
      const outcome = await this.blocked.findBlockedOutcome(
        scope.activeProjectId,
        root.domainResourceId,
      );
      if (!outcome || !(await this.blockedCanAccess(scope, outcome))) return notFound();
      return { kind: 'BLOCKED', outcome };
    }
    if (root.domainResourceKind === ANALYSIS_RESOURCE_KIND && this.terminal && this.candidates) {
      const analysis = (await this.latestTerminalAnalyses(scope.activeProjectId)).find(
        (item) => item.analysisRevisionId === root.domainResourceId,
      );
      if (!analysis || !(await this.candidateCanAccess(scope, analysis))) return notFound();
      return { kind: 'TERMINAL_ANALYSIS', analysis, projectId: scope.activeProjectId };
    }
    return notFound();
  }

  async readDetail(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ActivityDetailV1> {
    const record = await this.resolve(scope, root);
    const item = queueItemFor(record);
    const observedAt =
      record.kind === 'BLOCKED'
        ? record.outcome.lastObservedAt
        : analysisObservedAt(record.analysis);
    const now = new Date().toISOString();
    return {
      root: item.root,
      run: {
        schemaVersion: '1.0.0',
        runId: item.root.runId,
        jobId: item.root.jobId,
        sequence: 1,
        state: item.state,
        startedAt:
          record.kind === 'BLOCKED' ? record.outcome.firstObservedAt : record.analysis.startedAt,
        updatedAt: observedAt,
        ...(item.state === 'SUCCEEDED' ? { completedAt: observedAt } : {}),
        domainAttemptRefs: [],
        correlationRefs: [],
        causationRefs: [],
      },
      attempts: [],
      stages: [stageFor(record)],
      events: [eventFor(record)],
      transportAttempts: [],
      metadata: {
        schemaVersion: '1.0.0',
        snapshotRevision: 1,
        generatedAt: now,
        sourceUpdatedAt: observedAt,
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
        partial: false,
      },
      dimensions: item.dimensions,
      presentation: item.presentation,
      availableActions: [],
    };
  }

  async readStages(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit = 50,
  ): Promise<ActivityStageContinuationV1> {
    const record = await this.resolve(scope, root);
    const now = new Date().toISOString();
    return {
      stages: cursor ? [] : [stageFor(record)].slice(0, limit),
      metadata: metadata(now, queueItemFor(record).updatedAt),
    };
  }

  async readEvents(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit = 50,
  ): Promise<ActivityEventContinuationV1> {
    const record = await this.resolve(scope, root);
    const now = new Date().toISOString();
    return {
      events: cursor ? [] : [eventFor(record)].slice(0, limit),
      metadata: metadata(now, queueItemFor(record).updatedAt),
    };
  }
}
