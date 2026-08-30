import { randomUUID } from 'node:crypto';

import canonicalCommittedSchema from '../../../packages/contracts/schemas/canonical-committed.v1.schema.json';
import durableManualDiscoverySchema from '../../../packages/contracts/schemas/run-knowledge-discovery-durable.v1.schema.json';
import {
  createDiscoveryLogicalJobIdentityV1,
  decodeDiscoveryJobV1,
  decodeDiscoveryTriggerV1,
  DISCOVERY_PROJECTION_KINDS_V1,
  DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
  DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
  DISCOVERY_TRIGGER_POLICY_REVISION_V1,
  DISCOVERY_WORK_BUDGET_VERSION_V1,
  decodeDiscoveryManualTriggerRequestV1,
  DISCOVERY_DURABLE_MANUAL_COMMAND_V1,
  semanticStableJson,
  ShotgunError,
  utf16OrdinalCompare,
  type DiscoveryCanonicalCommittedEventEnvelopeV1,
  type DiscoveryCanonicalCommittedSourcePort,
  type DiscoveryCanonicalTriggerLookupV1,
  type DiscoveryCurrentAuthorityPort,
  type DiscoveryManualTriggerCoordinationResultV1,
  type DiscoveryManualTriggerLookupV1,
  type DiscoveryManualTriggerRequestV1,
  type DiscoveryCanonicalTriggerCoordinationResultV1,
  type DiscoveryClockPort,
  type DiscoveryJobV1,
  type DiscoveryProjectionBaseIdentityV1,
  type DiscoveryProjectionKindV1,
  type DiscoveryProjectionObservationV1,
  type DiscoveryProjectionReadinessV1,
  type DiscoveryProjectionReadinessPort,
  type DiscoveryProjectionWaitBindingV1,
  type DiscoveryRuntimeBudgetBindingV1,
  type DiscoveryRuntimeLifecycleStateV1,
  type DiscoveryLogicalJobIdentityV1,
  type DiscoveryTriggerPolicyPort,
  type DiscoveryTriggerPolicyV1,
  type DiscoveryScheduledTriggerLookupV1,
  type DiscoveryScheduleV1,
  type DiscoveryTriggerWorkBudgetTemplateV1,
  type DiscoveryWaitingReevaluationResultV1,
  type CommandEnvelope,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type DiscoveryTriggerRuntimeJobLookupV1 = {
  readonly projectId: string;
  readonly jobId: string;
};

export type DiscoveryTriggerRuntimeLogicalJobLookupV1 = {
  readonly projectId: string;
  readonly logicalIdentity: DiscoveryLogicalJobIdentityV1;
};

export type DiscoveryTriggerRuntimeJobTransitionInputV1 = DiscoveryTriggerRuntimeJobLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly updatedAt: string;
};

/** WP1's durable Job authority, repeated structurally to keep this module independent. */
export type DiscoveryTriggerRuntimeRepositoryPort = {
  saveJob(job: DiscoveryJobV1): Promise<'CREATED' | 'CONFLICT'>;
  findJob(lookup: DiscoveryTriggerRuntimeJobLookupV1): Promise<DiscoveryJobV1 | undefined>;
  findJobByTriggerIdentity(
    lookup:
      | DiscoveryCanonicalTriggerLookupV1
      | DiscoveryScheduledTriggerLookupV1
      | DiscoveryManualTriggerLookupV1,
  ): Promise<DiscoveryJobV1 | undefined>;
  findJobByLogicalIdentity(
    lookup: DiscoveryTriggerRuntimeLogicalJobLookupV1,
  ): Promise<DiscoveryJobV1 | undefined>;
  transitionJob(
    input: DiscoveryTriggerRuntimeJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT'>;
};

export const utf16ObservationOrderV1 = (
  left: DiscoveryProjectionObservationV1,
  right: DiscoveryProjectionObservationV1,
): number => utf16OrdinalCompare(left.projectionKind, right.projectionKind);

export const aggregateDiscoveryProjectionReadinessV1 = (input: {
  readonly requiredBase: DiscoveryProjectionBaseIdentityV1;
  readonly observations: readonly DiscoveryProjectionObservationV1[];
  readonly observedAt: string;
}): DiscoveryProjectionReadinessV1 => {
  const expectedKinds = new Set<DiscoveryProjectionKindV1>(DISCOVERY_PROJECTION_KINDS_V1);
  if (input.observations.length === 0) {
    throw new TypeError('At least one required Discovery projection observation is required.');
  }
  const seen = new Set<DiscoveryProjectionKindV1>();
  for (const observation of input.observations) {
    if (!expectedKinds.has(observation.projectionKind)) {
      throw new TypeError(`Unsupported Discovery projection kind '${observation.projectionKind}'.`);
    }
    if (seen.has(observation.projectionKind)) {
      throw new TypeError(
        `Duplicate Discovery projection observation '${observation.projectionKind}'.`,
      );
    }
    seen.add(observation.projectionKind);
    if (
      semanticStableJson(observation.requiredIdentity) !== semanticStableJson(input.requiredBase)
    ) {
      throw new TypeError(
        `Projection '${observation.projectionKind}' observed a different required base.`,
      );
    }
  }
  const observations = [...input.observations].sort(utf16ObservationOrderV1);
  const status = observations.every((observation) => observation.status === 'READY')
    ? 'READY'
    : observations.some((observation) => observation.status === 'BEHIND')
      ? 'BEHIND'
      : 'UNAVAILABLE';
  return {
    schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
    status,
    requiredBase: input.requiredBase,
    observations,
    observedAt: input.observedAt,
  };
};

const failClosed = (operation: string, safeMessage: string): never => {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage,
    module: 'akp-4.discovery-trigger-coordinator',
    operation,
  });
};

const assertPolicy = (policy: DiscoveryTriggerPolicyV1): void => {
  if (
    !policy.policyRevision.trim() ||
    !policy.strategyRevision.trim() ||
    !policy.fallbackPolicyRevision.trim()
  ) {
    return failClosed('resolve-policy', 'Discovery trigger policy identity is required.');
  }
  if (
    !Number.isSafeInteger(policy.waitTimeoutMs) ||
    policy.waitTimeoutMs <= 0 ||
    policy.waitTimeoutMs > 24 * 60 * 60 * 1000
  ) {
    return failClosed('resolve-policy', 'Discovery projection wait must be bounded.');
  }
  if (policy.requiredProjectionKinds.length === 0) {
    return failClosed('resolve-policy', 'At least one Discovery projection is required.');
  }
  if (
    policy.allowedManualScanModes !== undefined &&
    (policy.allowedManualScanModes.length === 0 ||
      policy.allowedManualScanModes.some((mode) => mode !== 'INCREMENTAL' && mode !== 'FULL_SCAN'))
  ) {
    return failClosed('resolve-policy', 'Manual Discovery scan modes are invalid.');
  }
  const seen = new Set<DiscoveryProjectionKindV1>();
  for (const kind of policy.requiredProjectionKinds) {
    if (!DISCOVERY_PROJECTION_KINDS_V1.includes(kind) || seen.has(kind)) {
      return failClosed('resolve-policy', 'Discovery projection requirements are invalid.');
    }
    seen.add(kind);
  }
  const budget = policy.budget as DiscoveryTriggerWorkBudgetTemplateV1;
  if (
    budget.schemaVersion !== DISCOVERY_RUNTIME_SCHEMA_VERSION_V1 ||
    budget.budgetVersion !== DISCOVERY_WORK_BUDGET_VERSION_V1 ||
    Object.entries(budget).some(
      ([key, value]) =>
        key.startsWith('max') &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0),
    )
  ) {
    return failClosed('resolve-policy', 'Discovery work budget binding is invalid.');
  }
};

const deadlineFrom = (now: string, waitTimeoutMs: number): string => {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp))
    return failClosed('clock', 'Server clock returned an invalid time.');
  return new Date(timestamp + waitTimeoutMs).toISOString();
};

const budgetFor = (
  template: DiscoveryTriggerWorkBudgetTemplateV1,
  deadlineAt: string,
): DiscoveryRuntimeBudgetBindingV1 => ({ ...template, deadlineAt });

const projectionWaitFor = (
  requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1,
  waitDeadlineAt: string,
  fallbackPolicyRevision: string,
): DiscoveryProjectionWaitBindingV1 => ({
  requiredDiscoveryBase,
  waitDeadlineAt,
  fallbackPolicyRevision,
});

const lifecycleFor = (
  readiness: DiscoveryProjectionReadinessV1,
): Extract<DiscoveryRuntimeLifecycleStateV1, 'QUEUED' | 'WAITING_FOR_PROJECTION'> =>
  readiness.status === 'READY' ? 'QUEUED' : 'WAITING_FOR_PROJECTION';

const assertExistingJob = (job: DiscoveryJobV1, projectId: string): DiscoveryJobV1 => {
  const decoded = decodeDiscoveryJobV1(job);
  if (decoded.projectId !== projectId || decoded.trigger.projectId !== projectId) {
    return failClosed('resolve-existing-job', 'Discovery Job project identity does not match.');
  }
  return decoded;
};

const assertExistingCanonicalCommittedJob = (
  job: DiscoveryJobV1,
  projectId: string,
  policy: DiscoveryTriggerPolicyV1,
): DiscoveryJobV1 & { readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1 } => {
  const decoded = assertExistingJob(job, projectId);
  if (
    decoded.trigger.triggerClass !== 'CANONICAL_COMMITTED' ||
    decoded.requiredDiscoveryBase === undefined
  ) {
    return failClosed(
      'resolve-existing-job',
      'Canonical Discovery Job is missing its durable trigger binding.',
    );
  }
  if (
    decoded.policyRevision !== policy.policyRevision ||
    decoded.strategyRevision !== policy.strategyRevision
  ) {
    return failClosed(
      'resolve-existing-job',
      'Canonical Discovery Job policy binding cannot be replaced on redelivery.',
    );
  }
  return decoded as DiscoveryJobV1 & {
    readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1;
  };
};

const assertExistingServerOwnedJob = (
  job: DiscoveryJobV1,
  projectId: string,
  triggerClass: 'SCHEDULED_FULL_SCAN' | 'MANUAL',
): DiscoveryJobV1 & { readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1 } => {
  const decoded = assertExistingJob(job, projectId);
  if (
    decoded.trigger.triggerClass !== triggerClass ||
    decoded.requiredDiscoveryBase === undefined
  ) {
    return failClosed(
      'resolve-existing-job',
      'Server-owned Discovery Job is missing its durable trigger binding.',
    );
  }
  return decoded as DiscoveryJobV1 & {
    readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1;
  };
};

const resultForExisting = (
  job: DiscoveryJobV1,
  readiness: DiscoveryProjectionReadinessV1,
): DiscoveryCanonicalTriggerCoordinationResultV1 => ({
  schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
  disposition: 'ALREADY_EXISTS',
  jobId: job.jobId,
  logicalJobIdentity: job.logicalIdentity,
  readiness,
  lifecycleState: job.lifecycleState,
});

export const createDefaultDiscoveryTriggerPolicyV1 = (): DiscoveryTriggerPolicyV1 => ({
  policyRevision: DISCOVERY_TRIGGER_POLICY_REVISION_V1,
  strategyRevision: 'discovery-trigger-strategy:v1',
  fallbackPolicyRevision: DISCOVERY_TRIGGER_POLICY_REVISION_V1,
  requiredProjectionKinds: [...DISCOVERY_PROJECTION_KINDS_V1],
  allowedManualScanModes: ['INCREMENTAL', 'FULL_SCAN'],
  waitTimeoutMs: 5 * 60 * 1000,
  budget: {
    schemaVersion: DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
    budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
    budgetId: 'discovery-work-budget',
    budgetRevision: 'discovery-trigger-policy:v1',
    maxResources: 100,
    maxSemanticNeighbors: 100,
    maxCandidatePairs: 40,
    maxCandidateGroups: 20,
    maxFindings: 20,
    maxProviderCalls: 10,
    maxInputTokens: 10_000,
    maxOutputTokens: 5_000,
    maxOutputTokensPerCall: 1_000,
    maxEstimatedCostMicros: 25_000,
    maxConcurrentProviderCalls: 2,
  },
});

export class StaticDiscoveryTriggerPolicy implements DiscoveryTriggerPolicyPort {
  constructor(
    private readonly policy: DiscoveryTriggerPolicyV1 = createDefaultDiscoveryTriggerPolicyV1(),
  ) {
    assertPolicy(policy);
  }

  async resolve(): Promise<DiscoveryTriggerPolicyV1> {
    return this.policy;
  }
}

export type DiscoveryTriggerCoordinatorOptions = {
  readonly jobId?: () => string;
  readonly triggerId?: () => string;
  readonly currentAuthority?: DiscoveryCurrentAuthorityPort;
};

export class DiscoveryTriggerCoordinator {
  constructor(
    private readonly source: DiscoveryCanonicalCommittedSourcePort,
    private readonly readiness: DiscoveryProjectionReadinessPort,
    private readonly runtime: DiscoveryTriggerRuntimeRepositoryPort,
    private readonly policyPort: DiscoveryTriggerPolicyPort,
    private readonly clock: DiscoveryClockPort = { now: () => new Date().toISOString() },
    private readonly options: DiscoveryTriggerCoordinatorOptions = {},
  ) {}

  async coordinateCanonicalCommitted(
    envelope: DiscoveryCanonicalCommittedEventEnvelopeV1,
  ): Promise<DiscoveryCanonicalTriggerCoordinationResultV1> {
    const source = await this.source.resolve(envelope);
    if (!envelope.projectId || envelope.projectId !== source.projectId) {
      return failClosed(
        'coordinate-canonical-committed',
        'Canonical event project identity is invalid.',
      );
    }
    const policy = await this.policyPort.resolve(source.projectId);
    assertPolicy(policy);
    const observedAt = this.clock.now();
    const triggerLookup: DiscoveryCanonicalTriggerLookupV1 = {
      projectId: source.projectId,
      triggerClass: 'CANONICAL_COMMITTED',
      eventId: source.eventIdentity.eventId,
      eventRevision: source.eventIdentity.eventRevision,
    };
    const existing = await this.runtime.findJobByTriggerIdentity(triggerLookup);
    if (existing) {
      const job = assertExistingCanonicalCommittedJob(existing, source.projectId, policy);
      const readiness = await this.readiness.read({
        projectId: job.projectId,
        requiredBase: job.requiredDiscoveryBase,
        projectionKinds: policy.requiredProjectionKinds,
        observedAt,
      });
      return resultForExisting(job, readiness);
    }
    const requiredDiscoveryBase =
      source.requiredDiscoveryBase ??
      (this.source.resolveInitialProjectionBase === undefined
        ? failClosed(
            'resolve-canonical-event',
            'Initial Discovery projection base authority is unavailable.',
          )
        : await this.source.resolveInitialProjectionBase(source));
    const waitDeadlineAt = deadlineFrom(observedAt, policy.waitTimeoutMs);
    const trigger = decodeDiscoveryTriggerV1({
      schemaVersion: DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
      triggerId: envelope.messageId,
      triggerClass: 'CANONICAL_COMMITTED',
      triggerIdentity: {
        kind: 'CANONICAL_COMMITTED',
        eventId: source.eventIdentity.eventId,
        eventRevision: source.eventIdentity.eventRevision,
      },
      projectId: source.projectId,
      requestedScanMode: 'INCREMENTAL',
      effectiveScanMode: 'INCREMENTAL',
      canonicalBase: source.canonicalBase,
      requiredDiscoveryBase,
      policyRevision: policy.policyRevision,
      strategyRevision: policy.strategyRevision,
      ...(policy.profileBinding === undefined ? {} : { profileBinding: policy.profileBinding }),
      createdAt: source.createdAt,
      observedAt,
      ...(source.causationId === undefined ? {} : { causationId: source.causationId }),
      ...(source.correlationId === undefined
        ? envelope.correlationId === undefined
          ? {}
          : { correlationId: envelope.correlationId }
        : { correlationId: source.correlationId }),
    });
    const readiness = await this.readiness.read({
      projectId: source.projectId,
      requiredBase: requiredDiscoveryBase,
      projectionKinds: policy.requiredProjectionKinds,
      observedAt,
    });
    const logicalIdentity = createDiscoveryLogicalJobIdentityV1(trigger);
    const lifecycleState = lifecycleFor(readiness);
    const projectionWait =
      lifecycleState === 'WAITING_FOR_PROJECTION'
        ? projectionWaitFor(requiredDiscoveryBase, waitDeadlineAt, policy.fallbackPolicyRevision)
        : undefined;
    const job = decodeDiscoveryJobV1({
      schemaVersion: DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
      jobId: this.options.jobId?.() ?? randomUUID(),
      logicalIdentity,
      projectId: source.projectId,
      trigger,
      requestedScanMode: 'INCREMENTAL',
      effectiveScanMode: 'INCREMENTAL',
      canonicalBase: source.canonicalBase,
      requiredDiscoveryBase,
      policyRevision: policy.policyRevision,
      strategyRevision: policy.strategyRevision,
      ...(policy.profileBinding === undefined ? {} : { profileBinding: policy.profileBinding }),
      budget: budgetFor(policy.budget, waitDeadlineAt),
      lifecycleState,
      lifecycleRevision: 1,
      ...(projectionWait === undefined ? {} : { projectionWait }),
      createdAt: observedAt,
      updatedAt: observedAt,
    });
    const saved = await this.runtime.saveJob(job);
    if (saved === 'CREATED') {
      return {
        schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
        disposition: 'CREATED',
        jobId: job.jobId,
        logicalJobIdentity: job.logicalIdentity,
        readiness,
        lifecycleState,
      };
    }
    const concurrent = await this.runtime.findJobByTriggerIdentity(triggerLookup);
    if (!concurrent) {
      return failClosed(
        'coordinate-canonical-committed',
        'Concurrent Discovery Job conflict lost its durable winner.',
      );
    }
    const concurrentJob = assertExistingCanonicalCommittedJob(concurrent, source.projectId, policy);
    const concurrentReadiness = await this.readiness.read({
      projectId: concurrentJob.projectId,
      requiredBase: concurrentJob.requiredDiscoveryBase,
      projectionKinds: policy.requiredProjectionKinds,
      observedAt,
    });
    return resultForExisting(concurrentJob, concurrentReadiness);
  }

  private async coordinateServerOwnedTrigger(input: {
    readonly projectId: string;
    readonly triggerClass: 'SCHEDULED_FULL_SCAN' | 'MANUAL';
    readonly triggerIdentity: DiscoveryScheduledTriggerLookupV1 | DiscoveryManualTriggerLookupV1;
    readonly requestedScanMode: 'INCREMENTAL' | 'FULL_SCAN';
    readonly actor?: { readonly actorId: string; readonly principalId: string };
    readonly correlationId?: string;
    readonly causationId?: string;
  }): Promise<DiscoveryCanonicalTriggerCoordinationResultV1> {
    const policy = await this.policyPort.resolve(input.projectId);
    assertPolicy(policy);
    const observedAt = this.clock.now();
    const existing = await this.runtime.findJobByTriggerIdentity(input.triggerIdentity);
    if (existing) {
      const job = assertExistingServerOwnedJob(existing, input.projectId, input.triggerClass);
      const readiness = await this.readiness.read({
        projectId: job.projectId,
        requiredBase: job.requiredDiscoveryBase,
        projectionKinds: policy.requiredProjectionKinds,
        observedAt,
      });
      return resultForExisting(job, readiness);
    }
    if (
      input.triggerClass === 'MANUAL' &&
      !(policy.allowedManualScanModes ?? ['INCREMENTAL', 'FULL_SCAN']).includes(
        input.requestedScanMode,
      )
    ) {
      return failClosed(
        'coordinate-manual',
        'Requested manual Discovery scan mode is not allowed.',
      );
    }
    const authority = this.options.currentAuthority;
    if (!authority) {
      return failClosed(
        'resolve-current-authority',
        'Current Canonical and Discovery projection authority is unavailable.',
      );
    }
    const current = await authority.resolve(input.projectId);
    if (
      current.projectId !== input.projectId ||
      current.canonicalBase.schemaVersion !== '1.0.0' ||
      current.requiredDiscoveryBase.schemaVersion !== '1.0.0'
    ) {
      return failClosed('resolve-current-authority', 'Current Discovery authority is invalid.');
    }
    const waitDeadlineAt = deadlineFrom(observedAt, policy.waitTimeoutMs);
    const trigger = decodeDiscoveryTriggerV1({
      schemaVersion: DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
      triggerId: this.options.triggerId?.() ?? randomUUID(),
      triggerClass: input.triggerClass,
      triggerIdentity:
        input.triggerClass === 'SCHEDULED_FULL_SCAN'
          ? {
              kind: 'SCHEDULED_FULL_SCAN',
              scheduleId: (input.triggerIdentity as DiscoveryScheduledTriggerLookupV1).scheduleId,
              scheduleRevision: (input.triggerIdentity as DiscoveryScheduledTriggerLookupV1)
                .scheduleRevision,
              occurrenceKey: (input.triggerIdentity as DiscoveryScheduledTriggerLookupV1)
                .occurrenceKey,
            }
          : {
              kind: 'MANUAL',
              commandId: (input.triggerIdentity as DiscoveryManualTriggerLookupV1).commandId,
              requestId: (input.triggerIdentity as DiscoveryManualTriggerLookupV1).requestId,
            },
      projectId: input.projectId,
      requestedScanMode: input.requestedScanMode,
      effectiveScanMode: input.requestedScanMode,
      canonicalBase: current.canonicalBase,
      requiredDiscoveryBase: current.requiredDiscoveryBase,
      policyRevision: policy.policyRevision,
      strategyRevision: policy.strategyRevision,
      ...(policy.profileBinding === undefined ? {} : { profileBinding: policy.profileBinding }),
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      createdAt: observedAt,
      observedAt,
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
    const readiness = await this.readiness.read({
      projectId: input.projectId,
      requiredBase: current.requiredDiscoveryBase,
      projectionKinds: policy.requiredProjectionKinds,
      observedAt,
    });
    const logicalIdentity = createDiscoveryLogicalJobIdentityV1(trigger);
    const lifecycleState = lifecycleFor(readiness);
    const projectionWait =
      lifecycleState === 'WAITING_FOR_PROJECTION'
        ? projectionWaitFor(
            current.requiredDiscoveryBase,
            waitDeadlineAt,
            policy.fallbackPolicyRevision,
          )
        : undefined;
    const job = decodeDiscoveryJobV1({
      schemaVersion: DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
      jobId: this.options.jobId?.() ?? randomUUID(),
      logicalIdentity,
      projectId: input.projectId,
      trigger,
      requestedScanMode: input.requestedScanMode,
      effectiveScanMode: input.requestedScanMode,
      canonicalBase: current.canonicalBase,
      requiredDiscoveryBase: current.requiredDiscoveryBase,
      policyRevision: policy.policyRevision,
      strategyRevision: policy.strategyRevision,
      ...(policy.profileBinding === undefined ? {} : { profileBinding: policy.profileBinding }),
      budget: budgetFor(policy.budget, waitDeadlineAt),
      lifecycleState,
      lifecycleRevision: 1,
      ...(projectionWait === undefined ? {} : { projectionWait }),
      createdAt: observedAt,
      updatedAt: observedAt,
    });
    if ((await this.runtime.saveJob(job)) === 'CREATED') {
      return {
        schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
        disposition: 'CREATED',
        jobId: job.jobId,
        logicalJobIdentity: job.logicalIdentity,
        readiness,
        lifecycleState,
      };
    }
    const concurrent = await this.runtime.findJobByTriggerIdentity(input.triggerIdentity);
    if (!concurrent) {
      return failClosed(
        'coordinate-server-owned-trigger',
        'Concurrent Discovery Job conflict lost its durable winner.',
      );
    }
    const concurrentJob = assertExistingServerOwnedJob(
      concurrent,
      input.projectId,
      input.triggerClass,
    );
    const concurrentReadiness = await this.readiness.read({
      projectId: concurrentJob.projectId,
      requiredBase: concurrentJob.requiredDiscoveryBase,
      projectionKinds: policy.requiredProjectionKinds,
      observedAt,
    });
    return resultForExisting(concurrentJob, concurrentReadiness);
  }

  async coordinateScheduledFullScan(
    schedule: DiscoveryScheduleV1,
  ): Promise<DiscoveryCanonicalTriggerCoordinationResultV1> {
    if (
      schedule.status !== 'ENABLED' ||
      !schedule.projectId.trim() ||
      !schedule.scheduleId.trim() ||
      !/^\d+$/.test(schedule.scheduleRevision) ||
      !schedule.nextOccurrenceKey.trim()
    ) {
      return failClosed('coordinate-scheduled-full-scan', 'Discovery schedule is invalid.');
    }
    const lookup: DiscoveryScheduledTriggerLookupV1 = {
      projectId: schedule.projectId,
      triggerClass: 'SCHEDULED_FULL_SCAN',
      scheduleId: schedule.scheduleId,
      scheduleRevision: schedule.scheduleRevision,
      occurrenceKey: schedule.nextOccurrenceKey,
    };
    return this.coordinateServerOwnedTrigger({
      projectId: schedule.projectId,
      triggerClass: 'SCHEDULED_FULL_SCAN',
      triggerIdentity: lookup,
      requestedScanMode: 'FULL_SCAN',
    });
  }

  async coordinateManual(
    envelope: CommandEnvelope<DiscoveryManualTriggerRequestV1>,
  ): Promise<DiscoveryManualTriggerCoordinationResultV1> {
    if (
      envelope.messageKind !== 'command' ||
      envelope.messageType !== DISCOVERY_DURABLE_MANUAL_COMMAND_V1 ||
      envelope.schemaVersion !== '1.0.0' ||
      !envelope.projectId ||
      !envelope.actor ||
      envelope.actor.type !== 'user' ||
      !envelope.security?.accessScope.includes('owner')
    ) {
      return failClosed(
        'coordinate-manual',
        'Owner-authorized manual Discovery context is required.',
      );
    }
    const request = decodeDiscoveryManualTriggerRequestV1(envelope.payload);
    const lookup: DiscoveryManualTriggerLookupV1 = {
      projectId: envelope.projectId,
      triggerClass: 'MANUAL',
      commandId: request.commandId,
      requestId: request.requestId,
    };
    return this.coordinateServerOwnedTrigger({
      projectId: envelope.projectId,
      triggerClass: 'MANUAL',
      triggerIdentity: lookup,
      requestedScanMode: request.requestedScanMode,
      actor: { actorId: envelope.actor.id, principalId: envelope.actor.id },
      causationId: envelope.messageId,
      correlationId: envelope.correlationId,
    });
  }

  async reEvaluateCanonicalDiscoveryProjectionReadiness(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryWaitingReevaluationResultV1> {
    const stored = await this.runtime.findJob(input);
    if (!stored) {
      return failClosed('reevaluate-projection-readiness', 'Discovery Job was not found.');
    }
    const job = assertExistingJob(stored, input.projectId);
    if (
      job.trigger.triggerClass !== 'CANONICAL_COMMITTED' ||
      job.lifecycleState !== 'WAITING_FOR_PROJECTION' ||
      !job.requiredDiscoveryBase ||
      !job.projectionWait
    ) {
      return failClosed(
        'reevaluate-projection-readiness',
        'Only a CanonicalCommitted Job with a durable projection wait can be re-evaluated.',
      );
    }
    const policy = await this.policyPort.resolve(job.projectId);
    assertPolicy(policy);
    if (
      policy.policyRevision !== job.policyRevision ||
      policy.strategyRevision !== job.strategyRevision
    ) {
      return failClosed(
        'reevaluate-projection-readiness',
        'The active projection policy no longer matches the waiting Job binding.',
      );
    }
    const observedAt = this.clock.now();
    const readiness = await this.readiness.read({
      projectId: job.projectId,
      requiredBase: job.requiredDiscoveryBase,
      projectionKinds: policy.requiredProjectionKinds,
      observedAt,
    });
    if (readiness.status === 'READY') {
      return {
        schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
        disposition: 'READY_FOR_EXECUTION',
        jobId: job.jobId,
        job,
        readiness,
        projectionWait: job.projectionWait,
      };
    }
    if (Date.parse(observedAt) < Date.parse(job.projectionWait.waitDeadlineAt)) {
      return {
        schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
        disposition: 'WAITING_FOR_PROJECTION',
        jobId: job.jobId,
        job,
        readiness,
        projectionWait: job.projectionWait,
      };
    }
    const transitioned = await this.runtime.transitionJob({
      projectId: job.projectId,
      jobId: job.jobId,
      expectedLifecycleRevision: job.lifecycleRevision,
      targetState: 'FAILED_RETRYABLE',
      updatedAt: observedAt,
    });
    if (transitioned === 'NOT_FOUND' || transitioned === 'CONFLICT') {
      return failClosed(
        'reevaluate-projection-readiness',
        'Waiting Discovery Job changed while its projection deadline was evaluated.',
      );
    }
    return {
      schemaVersion: DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1,
      disposition: 'FAILED_RETRYABLE',
      jobId: job.jobId,
      job: transitioned,
      readiness,
    };
  }
}

export const createDiscoveryTriggerCoordinatorModule = (
  coordinator: DiscoveryTriggerCoordinator,
): ShotgunModule => ({
  manifest: {
    id: 'akp-4.discovery-trigger-coordinator',
    version: '1.0.0',
    owner: 'Shotgun Discovery Trigger Coordination',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['discovery.jobs', 'discovery.job_lifecycle_history', 'discovery.schedules'],
      readsViaPorts: [
        'CanonicalKnowledgeRepositoryPort',
        'SemanticCorpusSourceSnapshotReaderPort',
        'CompiledTruthRepositoryPort',
        'SemanticGenerationLifecycleRepositoryPort',
      ],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [{ name: DISCOVERY_DURABLE_MANUAL_COMMAND_V1, range: '>=1.0.0 <2.0.0' }],
      events: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
    },
    produces: { events: [] },
    provides: { queries: [], capabilities: [] },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: DISCOVERY_DURABLE_MANUAL_COMMAND_V1,
      version: '1.0.0',
      kind: 'command',
      inputSchema: durableManualDiscoverySchema,
    },
    {
      name: 'CanonicalCommitted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: canonicalCommittedSchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: DISCOVERY_DURABLE_MANUAL_COMMAND_V1,
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          return coordinator.coordinateManual(
            envelope as CommandEnvelope<DiscoveryManualTriggerRequestV1>,
          );
        },
      },
    ],
    events: [
      {
        messageType: 'CanonicalCommitted',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        requiredForPublisherAcknowledgement: true,
        async handle(envelope): Promise<void> {
          await coordinator.coordinateCanonicalCommitted(
            envelope as DiscoveryCanonicalCommittedEventEnvelopeV1,
          );
        },
      },
    ],
    queries: [],
  },
});

export {
  nextDiscoveryWeeklyOccurrenceV1,
  PersistentDiscoveryScheduler,
  startPersistentDiscoverySchedulerWorker,
  type DiscoverySchedulerTickResultV1,
  type DiscoveryWeeklyOccurrenceV1,
} from './scheduler.js';
