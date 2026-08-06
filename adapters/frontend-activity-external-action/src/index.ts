import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  ActionAuditEventV1,
  ActivityDomainAttemptViewV1,
  ActivityEventCategoryV1,
  ActivityEventViewV1,
  ActivityLifecycleStateV1,
  ActivityRootReferenceV1,
  ActivityStageStateV1,
  ActivityStageViewV1,
  ExecutionAttemptV1,
  ExternalActionAggregateStatusV1,
  ExternalActionV1,
} from '../../../packages/contracts/src/index.js';
import {
  activityRetryabilityFrom,
  activityStateFromExternalActionState,
  type ActivityAdapterHealthV1,
  type ActivityAdapterScopeV1,
  type ActivityDetailV1,
  type ActivityEventContinuationV1,
  type ActivityQueueFilterV1,
  type ActivityQueueItemV1,
  type ActivityQueuePageV1,
  type ActivityStageContinuationV1,
  type ExternalActionActivityAdapterPort,
} from '../../../modules/frontend-activity/src/index.js';
import type { ExternalActionRepositoryBoundaryPort } from '../../../modules/frontend-external-action/src/external-action-store-port.js';

/**
 * FE-P5-S1 WP3 — concrete External Action Activity adapter.
 *
 * Observes the External Action domain through
 * `ExternalActionRepositoryBoundaryPort` (Action aggregate = Job root,
 * Execution = run, ExecutionAttempt = stage/domain attempt, AuditEvent =
 * bounded operational evidence). It never authors execution authority:
 * approve/preflight/execute/retry/cancel remain External Action commands.
 * Reads are bounded and non-disclosing: a missing or cross-project action
 * produces the same NOT_FOUND.
 */

const ADAPTER_ID = 'external-action-activity-adapter';
const DETAIL_EVENT_CAP = 50;

const notFound = (): never => {
  throw new FrontendContractError('NOT_FOUND', 'The Activity resource was not found.');
};

const encodeOffsetCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');

const decodeOffsetCursor = (value: string): number => {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
    offset?: unknown;
  };
  if (
    typeof parsed.offset !== 'number' ||
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0
  ) {
    throw new Error('EXTERNAL_ACTION_ACTIVITY_INVALID_CURSOR: malformed cursor');
  }
  return parsed.offset;
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

const actionRoot = (action: ExternalActionV1): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: action.actionId,
  domainKind: 'EXTERNAL_ACTION',
  domainResourceKind: 'ExternalAction',
  domainResourceId: action.actionId,
  resourceProjectId: action.resourceProjectId,
  resourceHref: `/product-api/frontend/external-action/actions/read?actionId=${action.actionId}`,
  jobId: action.actionId,
  runId: action.latestExecutionRef?.resourceId ?? action.actionId,
});

const externalActionRetryable = (status: ExternalActionAggregateStatusV1): boolean =>
  status === 'FAILED' ||
  status === 'PREFLIGHT_FAILED' ||
  status === 'VERIFICATION_FAILED' ||
  status === 'OUTCOME_UNKNOWN';

const attemptLifecycle = (status: ExecutionAttemptV1['status']): ActivityLifecycleStateV1 =>
  status === 'PENDING'
    ? 'QUEUED'
    : status === 'IN_PROGRESS'
      ? 'RUNNING'
      : status === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : status === 'FAILED'
          ? 'FAILED'
          : status === 'CANCELLED'
            ? 'CANCELLED'
            : 'OUTCOME_UNKNOWN';

const attemptStageState = (status: ExecutionAttemptV1['status']): ActivityStageStateV1 =>
  status === 'PENDING'
    ? 'PENDING'
    : status === 'IN_PROGRESS'
      ? 'RUNNING'
      : status === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : status === 'FAILED'
          ? 'FAILED'
          : status === 'CANCELLED'
            ? 'SKIPPED'
            : 'OUTCOME_UNKNOWN';

const auditEventCategory = (category: ActionAuditEventV1['category']): ActivityEventCategoryV1 =>
  category === 'ACTION_FAILED' ||
  category === 'ACTION_VERIFICATION_FAILED' ||
  category === 'ACTION_PREFLIGHT_FAILED'
    ? 'FAILED'
    : category === 'ACTION_OUTCOME_UNKNOWN'
      ? 'OUTCOME_UNKNOWN'
      : category === 'ACTION_APPROVED' || category === 'ACTION_RISK_DECIDED'
        ? 'USER_ATTENTION'
        : category === 'ACTION_EXECUTED' || category === 'ACTION_VERIFIED'
          ? 'SUCCEEDED'
          : category === 'ACTION_CANDIDATE_VALIDATED' ||
              category === 'ACTION_EXECUTION_CLAIMED' ||
              category === 'ACTION_PREFLIGHT_PASSED'
            ? 'STARTED'
            : 'PROGRESS';

export class ExternalActionActivityAdapter implements ExternalActionActivityAdapterPort {
  readonly adapterId = ADAPTER_ID;
  readonly domainKind = 'EXTERNAL_ACTION' as const;
  readonly domainKinds = ['EXTERNAL_ACTION'] as const;

  constructor(private readonly boundary: ExternalActionRepositoryBoundaryPort) {}

  health(): ActivityAdapterHealthV1 {
    return { status: 'AVAILABLE' };
  }

  /**
   * Owning-Domain deep-link authorization for a concrete Action: same as the
   * External Action Product boundary (project, access/policy revision,
   * capability and access masking). Any mismatch is a non-disclosing NOT_FOUND.
   */
  private requireActionRead(
    action: ExternalActionV1,
    scope: ActivityAdapterScopeV1,
    capability: 'READ_EXTERNAL_ACTION' | 'READ_AUDIT',
  ): void {
    if (action.resourceProjectId !== scope.activeProjectId) return notFound();
    if (action.accessMasking === 'HIDDEN') return notFound();
    if (scope.accessRevision !== undefined && action.accessRevision !== scope.accessRevision) {
      return notFound();
    }
    if (
      scope.policyContextRevision !== undefined &&
      action.policyContextRevision !== scope.policyContextRevision
    ) {
      return notFound();
    }
    // Match the owning-Domain Scope → Capability matrix: broad owner/admin or
    // the fine-grained frozen scope (`action:read` / `action:audit:read`).
    const granted = scope.accessScope ?? [];
    const has = (entry: string): boolean =>
      granted.includes('owner') || granted.includes('admin') || granted.includes(entry);
    const grantedCapability =
      capability === 'READ_AUDIT'
        ? has('action:audit:read')
        : has('action:read') || has('READ_EXTERNAL_ACTION');
    if (!grantedCapability) return notFound();
  }

  /** Non-disclosing access check for Queue response filtering (R3-1). */
  async canAccess(scope: ActivityAdapterScopeV1, root: ActivityRootReferenceV1): Promise<boolean> {
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(root.domainResourceId);
      if (action === undefined) return false;
      try {
        this.requireActionRead(action, scope, 'READ_EXTERNAL_ACTION');
        return true;
      } catch {
        return false;
      }
    });
  }

  private queueItemFromAction(action: ExternalActionV1): ActivityQueueItemV1 {
    return {
      root: actionRoot(action),
      summary: `External action ${action.actionId} (${action.operation})`,
      state: activityStateFromExternalActionState(action.status),
      dimensions: {
        schemaVersion: '1.0.0',
        attention: 'NONE',
        retryability: activityRetryabilityFrom(externalActionRetryable(action.status)),
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
      updatedAt: action.updatedAt,
    };
  }

  async readQueue(
    scope: ActivityAdapterScopeV1,
    filter: ActivityQueueFilterV1,
  ): Promise<ActivityQueuePageV1> {
    const limit = Math.max(1, filter.limit ?? 50);
    const offset = filter.cursor === undefined ? 0 : decodeOffsetCursor(filter.cursor);
    const actions = await this.boundary.transaction((repositories) =>
      repositories.aggregates.listByProject(scope.activeProjectId, limit + 1, offset),
    );
    const hasMore = actions.length > limit;
    const pageActions = hasMore ? actions.slice(0, limit) : actions;
    const nextOffset = offset + pageActions.length;
    const nextCursor = hasMore ? encodeOffsetCursor(nextOffset) : undefined;
    let sourceUpdatedAt: string | undefined;
    for (const action of pageActions) {
      if (sourceUpdatedAt === undefined || action.updatedAt > sourceUpdatedAt) {
        sourceUpdatedAt = action.updatedAt;
      }
    }
    return {
      items: pageActions.map((action) => this.queueItemFromAction(action)),
      metadata: metadataFor({
        sourceUpdatedAt,
        projectedAt: new Date().toISOString(),
        ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
      }),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  private attemptViewFrom(attempt: ExecutionAttemptV1): ActivityDomainAttemptViewV1 {
    return {
      schemaVersion: '1.0.0',
      attemptId: attempt.attemptId,
      runId: attempt.executionId,
      attemptNumber: attempt.attemptNumber,
      attemptKind: 'EXTERNAL_ACTION_EXECUTION',
      state: attemptLifecycle(attempt.status),
      retryability: activityRetryabilityFrom(
        attempt.status === 'FAILED' || attempt.status === 'OUTCOME_UNKNOWN',
      ),
      startedAt: attempt.startedAt,
      updatedAt: attempt.completedAt ?? attempt.startedAt,
      ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
      stageRefs: [],
    };
  }

  private stageFromAttempt(attempt: ExecutionAttemptV1, index: number): ActivityStageViewV1 {
    return {
      schemaVersion: '1.0.0',
      stageId: attempt.attemptId,
      stageKey: `execution-attempt-${attempt.attemptNumber}`,
      label: `Execution attempt ${attempt.attemptNumber}`,
      sequence: index + 1,
      state: attemptStageState(attempt.status),
      startedAt: attempt.startedAt,
      updatedAt: attempt.completedAt ?? attempt.startedAt,
      ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
    };
  }

  private eventFromAudit(event: ActionAuditEventV1): ActivityEventViewV1 {
    return {
      schemaVersion: '1.0.0',
      eventId: event.auditEventId,
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'ExternalAction',
        resourceId: event.actionId,
      },
      category: auditEventCategory(event.category),
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      summary: event.eventData.message,
    };
  }

  async readDetail(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
  ): Promise<ActivityDetailV1> {
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(root.domainResourceId);
      if (action === undefined) return notFound();
      this.requireActionRead(action, scope, 'READ_EXTERNAL_ACTION');
      const execution = await repositories.executions.findCurrent(action.actionId);
      const attempts = execution
        ? await repositories.attempts.findByExecution(execution.executionId)
        : [];
      const audit = await repositories.audit.listByAction(action.actionId, DETAIL_EVENT_CAP, 0);
      const projectedAt = new Date().toISOString();
      return {
        root: actionRoot(action),
        run: {
          schemaVersion: '1.0.0',
          runId: execution?.executionId ?? action.actionId,
          jobId: action.actionId,
          sequence: 1,
          state: activityStateFromExternalActionState(action.status),
          startedAt: execution?.startedAt ?? action.createdAt,
          updatedAt: action.updatedAt,
          ...(execution?.completedAt === undefined ? {} : { completedAt: execution.completedAt }),
          domainAttemptRefs: attempts.map((attempt) => ({
            schemaVersion: '1.0.0',
            resourceKind: 'attempt',
            resourceId: attempt.attemptId,
          })),
          correlationRefs: [],
          causationRefs: [],
        },
        attempts: attempts.map((attempt) => this.attemptViewFrom(attempt)),
        stages: attempts.map((attempt, index) => this.stageFromAttempt(attempt, index)),
        events: audit.map((event) => this.eventFromAudit(event)),
        transportAttempts: [],
        metadata: metadataFor({ sourceUpdatedAt: action.updatedAt, projectedAt }),
        dimensions: {
          schemaVersion: '1.0.0',
          attention: 'NONE',
          retryability: activityRetryabilityFrom(externalActionRetryable(action.status)),
          freshness: 'CURRENT',
          adapterStatus: 'AVAILABLE',
        },
      };
    });
  }

  async readStages(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityStageContinuationV1> {
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(root.domainResourceId);
      if (action === undefined) return notFound();
      this.requireActionRead(action, scope, 'READ_EXTERNAL_ACTION');
      const execution = await repositories.executions.findCurrent(action.actionId);
      const attempts = execution
        ? await repositories.attempts.findByExecution(execution.executionId)
        : [];
      const capped = Math.max(1, limit ?? 50);
      const offset = cursor === undefined ? 0 : decodeOffsetCursor(cursor);
      const slice = attempts.slice(offset, offset + capped + 1);
      const hasMore = slice.length > capped;
      const pageAttempts = hasMore ? slice.slice(0, capped) : slice;
      const nextOffset = offset + pageAttempts.length;
      const nextCursor = hasMore ? encodeOffsetCursor(nextOffset) : undefined;
      return {
        stages: pageAttempts.map((attempt, index) =>
          this.stageFromAttempt(attempt, offset + index),
        ),
        metadata: metadataFor({
          sourceUpdatedAt: action.updatedAt,
          projectedAt: new Date().toISOString(),
        }),
        ...(nextCursor === undefined ? {} : { nextCursor }),
      };
    });
  }

  async readEvents(
    scope: ActivityAdapterScopeV1,
    root: ActivityRootReferenceV1,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityEventContinuationV1> {
    return this.boundary.transaction(async (repositories) => {
      const action = await repositories.aggregates.findById(root.domainResourceId);
      if (action === undefined) return notFound();
      this.requireActionRead(action, scope, 'READ_AUDIT');
      const capped = Math.max(1, limit ?? 50);
      const offset = cursor === undefined ? 0 : decodeOffsetCursor(cursor);
      const events = await repositories.audit.listByAction(action.actionId, capped + 1, offset);
      const hasMore = events.length > capped;
      const pageEvents = hasMore ? events.slice(0, capped) : events;
      const nextOffset = offset + pageEvents.length;
      return {
        events: pageEvents.map((event) => this.eventFromAudit(event)),
        metadata: metadataFor({
          sourceUpdatedAt: action.updatedAt,
          projectedAt: new Date().toISOString(),
        }),
        ...(hasMore ? { nextCursor: encodeOffsetCursor(nextOffset) } : {}),
      };
    });
  }
}
