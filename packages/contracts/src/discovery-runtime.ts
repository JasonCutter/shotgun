import { sha256Text } from './document-evidence.js';
import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryProjectionBaseIdentityV1,
} from './discovery-finding.js';
import { semanticStableJson, utf16OrdinalCompare } from './semantic-representation.js';

export const DISCOVERY_RUNTIME_SCHEMA_VERSION_V1 = '1.0.0' as const;
export const DISCOVERY_LOGICAL_JOB_IDENTITY_VERSION_V1 = 'discovery-job-logical:v1' as const;
export const DISCOVERY_WORK_BUDGET_VERSION_V1 = 'discovery-work-budget:v1' as const;

export const DISCOVERY_RUNTIME_SCAN_MODES_V1 = ['INCREMENTAL', 'FULL_SCAN'] as const;
export type DiscoveryRuntimeScanModeV1 = (typeof DISCOVERY_RUNTIME_SCAN_MODES_V1)[number];

export const DISCOVERY_TRIGGER_CLASSES_V1 = [
  'CANONICAL_COMMITTED',
  'SCHEDULED_FULL_SCAN',
  'MANUAL',
] as const;
export type DiscoveryTriggerClassV1 = (typeof DISCOVERY_TRIGGER_CLASSES_V1)[number];

export const DISCOVERY_RUNTIME_LIFECYCLE_STATES_V1 = [
  'QUEUED',
  'WAITING_FOR_PROJECTION',
  'RUNNING',
  'PARTIAL',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'CANCELLED',
] as const;
export type DiscoveryRuntimeLifecycleStateV1 =
  (typeof DISCOVERY_RUNTIME_LIFECYCLE_STATES_V1)[number];

export const DISCOVERY_RUNTIME_ATTEMPT_KINDS_V1 = ['INITIAL', 'DOMAIN_RETRY'] as const;
export type DiscoveryRuntimeAttemptKindV1 = (typeof DISCOVERY_RUNTIME_ATTEMPT_KINDS_V1)[number];

export const DISCOVERY_RUNTIME_STAGE_TYPES_V1 = [
  'WAIT_FOR_PROJECTION',
  'LOAD_SIGNALS',
  'GENERATE_FINDINGS',
  'QUALITY_GATE',
  'PERSIST_FINDINGS',
  'PUBLISH_REENTRY',
  'RECONCILE_FINDINGS',
] as const;
export type DiscoveryRuntimeStageTypeV1 = (typeof DISCOVERY_RUNTIME_STAGE_TYPES_V1)[number];

export const DISCOVERY_RUNTIME_STAGE_STATES_V1 = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'CANCELLED',
] as const;
export type DiscoveryRuntimeStageStateV1 = (typeof DISCOVERY_RUNTIME_STAGE_STATES_V1)[number];

export const DISCOVERY_RUNTIME_BUDGET_DIMENSIONS_V1 = [
  'scan',
  'candidate',
  'provider',
  'token',
  'cost',
  'deadline',
  'concurrency',
] as const;
export type DiscoveryRuntimeBudgetDimensionV1 =
  (typeof DISCOVERY_RUNTIME_BUDGET_DIMENSIONS_V1)[number];

export type DiscoveryRuntimeProfileBindingV1 = {
  readonly profileId: string;
  readonly profileRevision: number;
};

export type DiscoveryRuntimeBudgetBindingV1 = {
  readonly schemaVersion: '1.0.0';
  /** This is the existing AKP-3 work-budget contract, not a new controller. */
  readonly budgetVersion: typeof DISCOVERY_WORK_BUDGET_VERSION_V1;
  readonly budgetId: string;
  readonly budgetRevision: string;
  readonly maxResources: number;
  readonly maxSemanticNeighbors: number;
  readonly maxCandidatePairs: number;
  readonly maxCandidateGroups: number;
  readonly maxFindings: number;
  readonly maxProviderCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxOutputTokensPerCall: number;
  readonly maxEstimatedCostMicros: number;
  readonly maxConcurrentProviderCalls: number;
  readonly deadlineAt: string;
};

export type DiscoveryCanonicalCommittedTriggerIdentityV1 = {
  readonly kind: 'CANONICAL_COMMITTED';
  readonly eventId: string;
  readonly eventRevision: string;
};

export type DiscoveryScheduledFullScanTriggerIdentityV1 = {
  readonly kind: 'SCHEDULED_FULL_SCAN';
  readonly scheduleId: string;
  readonly scheduleRevision: string;
  readonly occurrenceKey: string;
};

export type DiscoveryManualTriggerIdentityV1 = {
  readonly kind: 'MANUAL';
  readonly commandId: string;
  readonly requestId: string;
};

export type DiscoveryTriggerIdentityV1 =
  | DiscoveryCanonicalCommittedTriggerIdentityV1
  | DiscoveryScheduledFullScanTriggerIdentityV1
  | DiscoveryManualTriggerIdentityV1;

export type DiscoveryTriggerActorV1 = {
  readonly actorId: string;
  readonly principalId: string;
};

type DiscoveryTriggerCommonV1 = {
  readonly schemaVersion: '1.0.0';
  /** Physical observation identity. It is not the logical Job dedupe key. */
  readonly triggerId: string;
  readonly projectId: string;
  /** Discovery scan scope; distinct from the AKP-3 strategy set below. */
  readonly requestedScanMode: DiscoveryRuntimeScanModeV1;
  readonly effectiveScanMode: DiscoveryRuntimeScanModeV1;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly requiredDiscoveryBase?: DiscoveryProjectionBaseIdentityV1;
  readonly policyRevision: string;
  readonly strategyRevision: string;
  readonly profileBinding?: DiscoveryRuntimeProfileBindingV1;
  readonly createdAt: string;
  readonly observedAt: string;
  readonly causationId?: string;
  readonly correlationId?: string;
};

export type DiscoveryCanonicalCommittedTriggerV1 = DiscoveryTriggerCommonV1 & {
  readonly triggerClass: 'CANONICAL_COMMITTED';
  readonly triggerIdentity: DiscoveryCanonicalCommittedTriggerIdentityV1;
};

export type DiscoveryScheduledFullScanTriggerV1 = DiscoveryTriggerCommonV1 & {
  readonly triggerClass: 'SCHEDULED_FULL_SCAN';
  readonly triggerIdentity: DiscoveryScheduledFullScanTriggerIdentityV1;
};

export type DiscoveryManualTriggerV1 = DiscoveryTriggerCommonV1 & {
  readonly triggerClass: 'MANUAL';
  readonly triggerIdentity: DiscoveryManualTriggerIdentityV1;
  readonly actor: DiscoveryTriggerActorV1;
};

export type DiscoveryTriggerV1 =
  | DiscoveryCanonicalCommittedTriggerV1
  | DiscoveryScheduledFullScanTriggerV1
  | DiscoveryManualTriggerV1;

export type DiscoveryProjectionWaitBindingV1 = {
  readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly waitDeadlineAt: string;
  readonly fallbackPolicyRevision: string;
};

export type DiscoveryLogicalJobIdentityV1 = {
  readonly schemaVersion: '1.0.0';
  readonly identityVersion: typeof DISCOVERY_LOGICAL_JOB_IDENTITY_VERSION_V1;
  readonly value: string;
};

export type DiscoveryJobV1 = {
  readonly schemaVersion: '1.0.0';
  readonly jobId: string;
  readonly logicalIdentity: DiscoveryLogicalJobIdentityV1;
  readonly projectId: string;
  readonly trigger: DiscoveryTriggerV1;
  readonly requestedScanMode: DiscoveryRuntimeScanModeV1;
  readonly effectiveScanMode: DiscoveryRuntimeScanModeV1;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly requiredDiscoveryBase?: DiscoveryProjectionBaseIdentityV1;
  readonly policyRevision: string;
  readonly strategyRevision: string;
  readonly profileBinding?: DiscoveryRuntimeProfileBindingV1;
  readonly budget: DiscoveryRuntimeBudgetBindingV1;
  readonly lifecycleState: DiscoveryRuntimeLifecycleStateV1;
  readonly lifecycleRevision: number;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DiscoveryRunV1 = {
  readonly schemaVersion: '1.0.0';
  readonly runId: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly requestedScanMode: DiscoveryRuntimeScanModeV1;
  readonly effectiveScanMode: DiscoveryRuntimeScanModeV1;
  readonly runRevision: number;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly requiredDiscoveryBase?: DiscoveryProjectionBaseIdentityV1;
  readonly policyRevision: string;
  readonly strategyRevision: string;
  readonly profileBinding?: DiscoveryRuntimeProfileBindingV1;
  readonly budget: DiscoveryRuntimeBudgetBindingV1;
  readonly lifecycleState: DiscoveryRuntimeLifecycleStateV1;
  readonly lifecycleRevision: number;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryAttemptV1 = {
  readonly schemaVersion: '1.0.0';
  readonly attemptId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly attemptNumber: number;
  readonly lifecycleRevision: number;
  readonly attemptKind: DiscoveryRuntimeAttemptKindV1;
  readonly lifecycleState: DiscoveryRuntimeLifecycleStateV1;
  readonly previousAttemptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryStageV1 = {
  readonly schemaVersion: '1.0.0';
  readonly stageId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly projectId: string;
  readonly stageOrdinal: number;
  readonly stageType: DiscoveryRuntimeStageTypeV1;
  readonly stageRevision: number;
  readonly state: DiscoveryRuntimeStageStateV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};

const objectValue = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  const object = objectValue(value, path);
  const unknownKeys = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0)
    return fail(path, `contains unknown field(s): ${unknownKeys.join(', ')}`);
  return object;
};

const required = (object: Record<string, unknown>, key: string, path: string): unknown => {
  if (!Object.hasOwn(object, key) || object[key] === undefined)
    return fail(`${path}.${key}`, 'is required');
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0)
    return fail(path, 'must be non-empty');
  return value.trim();
};

const integer = (value: unknown, path: string, minimum: number): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return fail(path, `must be an integer >= ${minimum}`);
  }
  return value;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const timestamp = text(value, path);
  if (!Number.isFinite(Date.parse(timestamp))) return fail(path, 'must be an ISO timestamp');
  return timestamp;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const schemaVersion = (value: unknown, path: string): '1.0.0' => {
  if (value !== DISCOVERY_RUNTIME_SCHEMA_VERSION_V1) return fail(path, 'must be 1.0.0');
  return '1.0.0';
};

const decodeCanonicalBase = (value: unknown, path: string): DiscoveryCanonicalBaseIdentityV1 => {
  const object = strictObject(value, ['schemaVersion', 'canonicalVersion', 'snapshotDigest'], path);
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    canonicalVersion: integer(
      required(object, 'canonicalVersion', path),
      `${path}.canonicalVersion`,
      0,
    ),
    snapshotDigest: text(required(object, 'snapshotDigest', path), `${path}.snapshotDigest`),
  };
};

const decodeDiscoveryBase = (value: unknown, path: string): DiscoveryProjectionBaseIdentityV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'projectionRevision', 'projectionDigest'],
    path,
  );
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    projectionDigest: text(required(object, 'projectionDigest', path), `${path}.projectionDigest`),
  };
};

const decodeProfileBinding = (value: unknown, path: string): DiscoveryRuntimeProfileBindingV1 => {
  const object = strictObject(value, ['profileId', 'profileRevision'], path);
  return {
    profileId: text(required(object, 'profileId', path), `${path}.profileId`),
    profileRevision: integer(
      required(object, 'profileRevision', path),
      `${path}.profileRevision`,
      1,
    ),
  };
};

export const decodeDiscoveryRuntimeBudgetBindingV1 = (
  value: unknown,
  path = 'budget',
): DiscoveryRuntimeBudgetBindingV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'budgetVersion',
      'budgetId',
      'budgetRevision',
      'maxResources',
      'maxSemanticNeighbors',
      'maxCandidatePairs',
      'maxCandidateGroups',
      'maxFindings',
      'maxProviderCalls',
      'maxInputTokens',
      'maxOutputTokens',
      'maxOutputTokensPerCall',
      'maxEstimatedCostMicros',
      'maxConcurrentProviderCalls',
      'deadlineAt',
    ],
    path,
  );
  if (required(object, 'budgetVersion', path) !== DISCOVERY_WORK_BUDGET_VERSION_V1) {
    return fail(`${path}.budgetVersion`, 'must use the existing AKP-3 work budget contract');
  }
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
    budgetId: text(required(object, 'budgetId', path), `${path}.budgetId`),
    budgetRevision: text(required(object, 'budgetRevision', path), `${path}.budgetRevision`),
    maxResources: integer(required(object, 'maxResources', path), `${path}.maxResources`, 1),
    maxSemanticNeighbors: integer(
      required(object, 'maxSemanticNeighbors', path),
      `${path}.maxSemanticNeighbors`,
      1,
    ),
    maxCandidatePairs: integer(
      required(object, 'maxCandidatePairs', path),
      `${path}.maxCandidatePairs`,
      1,
    ),
    maxCandidateGroups: integer(
      required(object, 'maxCandidateGroups', path),
      `${path}.maxCandidateGroups`,
      1,
    ),
    maxFindings: integer(required(object, 'maxFindings', path), `${path}.maxFindings`, 1),
    maxProviderCalls: integer(
      required(object, 'maxProviderCalls', path),
      `${path}.maxProviderCalls`,
      1,
    ),
    maxInputTokens: integer(required(object, 'maxInputTokens', path), `${path}.maxInputTokens`, 1),
    maxOutputTokens: integer(
      required(object, 'maxOutputTokens', path),
      `${path}.maxOutputTokens`,
      1,
    ),
    maxOutputTokensPerCall: integer(
      required(object, 'maxOutputTokensPerCall', path),
      `${path}.maxOutputTokensPerCall`,
      1,
    ),
    maxEstimatedCostMicros: integer(
      required(object, 'maxEstimatedCostMicros', path),
      `${path}.maxEstimatedCostMicros`,
      1,
    ),
    maxConcurrentProviderCalls: integer(
      required(object, 'maxConcurrentProviderCalls', path),
      `${path}.maxConcurrentProviderCalls`,
      1,
    ),
    deadlineAt: isoTimestamp(required(object, 'deadlineAt', path), `${path}.deadlineAt`),
  };
};

const decodeTriggerIdentity = (value: unknown, path: string): DiscoveryTriggerIdentityV1 => {
  const object = objectValue(value, path);
  const kind = enumValue(object.kind, DISCOVERY_TRIGGER_CLASSES_V1, `${path}.kind`);
  if (kind === 'CANONICAL_COMMITTED') {
    const strict = strictObject(value, ['kind', 'eventId', 'eventRevision'], path);
    return {
      kind,
      eventId: text(required(strict, 'eventId', path), `${path}.eventId`),
      eventRevision: text(required(strict, 'eventRevision', path), `${path}.eventRevision`),
    };
  }
  if (kind === 'SCHEDULED_FULL_SCAN') {
    const strict = strictObject(
      value,
      ['kind', 'scheduleId', 'scheduleRevision', 'occurrenceKey'],
      path,
    );
    return {
      kind,
      scheduleId: text(required(strict, 'scheduleId', path), `${path}.scheduleId`),
      scheduleRevision: text(
        required(strict, 'scheduleRevision', path),
        `${path}.scheduleRevision`,
      ),
      occurrenceKey: text(required(strict, 'occurrenceKey', path), `${path}.occurrenceKey`),
    };
  }
  const strict = strictObject(value, ['kind', 'commandId', 'requestId'], path);
  return {
    kind,
    commandId: text(required(strict, 'commandId', path), `${path}.commandId`),
    requestId: text(required(strict, 'requestId', path), `${path}.requestId`),
  };
};

export const decodeDiscoveryTriggerV1 = (value: unknown, path = 'trigger'): DiscoveryTriggerV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'triggerId',
      'triggerClass',
      'triggerIdentity',
      'projectId',
      'requestedScanMode',
      'effectiveScanMode',
      'canonicalBase',
      'requiredDiscoveryBase',
      'policyRevision',
      'strategyRevision',
      'profileBinding',
      'actor',
      'createdAt',
      'observedAt',
      'causationId',
      'correlationId',
    ],
    path,
  );
  const triggerClass = enumValue(
    required(object, 'triggerClass', path),
    DISCOVERY_TRIGGER_CLASSES_V1,
    `${path}.triggerClass`,
  );
  const triggerIdentity = decodeTriggerIdentity(
    required(object, 'triggerIdentity', path),
    `${path}.triggerIdentity`,
  );
  if (triggerIdentity.kind !== triggerClass)
    return fail(`${path}.triggerIdentity.kind`, 'must match triggerClass');
  if (triggerClass !== 'MANUAL' && object.actor !== undefined) {
    return fail(`${path}.actor`, 'is allowed only for MANUAL triggers');
  }
  if (triggerClass === 'MANUAL' && object.actor === undefined) {
    return fail(`${path}.actor`, 'is required for MANUAL triggers');
  }
  const requestedScanMode = enumValue(
    required(object, 'requestedScanMode', path),
    DISCOVERY_RUNTIME_SCAN_MODES_V1,
    `${path}.requestedScanMode`,
  );
  const effectiveScanMode = enumValue(
    required(object, 'effectiveScanMode', path),
    DISCOVERY_RUNTIME_SCAN_MODES_V1,
    `${path}.effectiveScanMode`,
  );
  const fixedScanMode =
    triggerClass === 'CANONICAL_COMMITTED'
      ? 'INCREMENTAL'
      : triggerClass === 'SCHEDULED_FULL_SCAN'
        ? 'FULL_SCAN'
        : undefined;
  if (
    fixedScanMode !== undefined &&
    (requestedScanMode !== fixedScanMode || effectiveScanMode !== fixedScanMode)
  ) {
    return fail(`${path}.requestedScanMode`, `${triggerClass} must use ${fixedScanMode} scan mode`);
  }
  const common = {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    triggerId: text(required(object, 'triggerId', path), `${path}.triggerId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    requestedScanMode,
    effectiveScanMode,
    canonicalBase: decodeCanonicalBase(
      required(object, 'canonicalBase', path),
      `${path}.canonicalBase`,
    ),
    ...(object.requiredDiscoveryBase === undefined
      ? {}
      : {
          requiredDiscoveryBase: decodeDiscoveryBase(
            object.requiredDiscoveryBase,
            `${path}.requiredDiscoveryBase`,
          ),
        }),
    policyRevision: text(required(object, 'policyRevision', path), `${path}.policyRevision`),
    strategyRevision: text(required(object, 'strategyRevision', path), `${path}.strategyRevision`),
    ...(object.profileBinding === undefined
      ? {}
      : { profileBinding: decodeProfileBinding(object.profileBinding, `${path}.profileBinding`) }),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    observedAt: isoTimestamp(required(object, 'observedAt', path), `${path}.observedAt`),
    ...(object.causationId === undefined
      ? {}
      : { causationId: text(object.causationId, `${path}.causationId`) }),
    ...(object.correlationId === undefined
      ? {}
      : { correlationId: text(object.correlationId, `${path}.correlationId`) }),
  } as const;
  if (triggerClass === 'MANUAL') {
    const actor = strictObject(object.actor, ['actorId', 'principalId'], `${path}.actor`);
    return {
      ...common,
      triggerClass,
      triggerIdentity: triggerIdentity as DiscoveryManualTriggerIdentityV1,
      actor: {
        actorId: text(required(actor, 'actorId', `${path}.actor`), `${path}.actor.actorId`),
        principalId: text(
          required(actor, 'principalId', `${path}.actor`),
          `${path}.actor.principalId`,
        ),
      },
    };
  }
  if (triggerClass === 'CANONICAL_COMMITTED') {
    return {
      ...common,
      triggerClass,
      triggerIdentity: triggerIdentity as DiscoveryCanonicalCommittedTriggerIdentityV1,
    };
  }
  return {
    ...common,
    triggerClass,
    triggerIdentity: triggerIdentity as DiscoveryScheduledFullScanTriggerIdentityV1,
  };
};

export const createDiscoveryTriggerV1 = (input: unknown): DiscoveryTriggerV1 =>
  decodeDiscoveryTriggerV1(input);

const projectionWait = (value: unknown, path: string): DiscoveryProjectionWaitBindingV1 => {
  const object = strictObject(
    value,
    ['requiredDiscoveryBase', 'waitDeadlineAt', 'fallbackPolicyRevision'],
    path,
  );
  return {
    requiredDiscoveryBase: decodeDiscoveryBase(
      required(object, 'requiredDiscoveryBase', path),
      `${path}.requiredDiscoveryBase`,
    ),
    waitDeadlineAt: isoTimestamp(
      required(object, 'waitDeadlineAt', path),
      `${path}.waitDeadlineAt`,
    ),
    fallbackPolicyRevision: text(
      required(object, 'fallbackPolicyRevision', path),
      `${path}.fallbackPolicyRevision`,
    ),
  };
};

const baseRuntimeKeys = [
  'schemaVersion',
  'projectId',
  'requestedScanMode',
  'effectiveScanMode',
  'canonicalBase',
  'requiredDiscoveryBase',
  'policyRevision',
  'strategyRevision',
  'profileBinding',
  'budget',
  'lifecycleState',
  'lifecycleRevision',
  'projectionWait',
  'createdAt',
  'updatedAt',
] as const;

const decodeRuntimeBinding = (object: Record<string, unknown>, path: string) => {
  const lifecycleState = enumValue(
    required(object, 'lifecycleState', path),
    DISCOVERY_RUNTIME_LIFECYCLE_STATES_V1,
    `${path}.lifecycleState`,
  );
  const projectionWaitValue =
    object.projectionWait === undefined
      ? undefined
      : projectionWait(object.projectionWait, `${path}.projectionWait`);
  if (lifecycleState === 'WAITING_FOR_PROJECTION' && projectionWaitValue === undefined) {
    return fail(`${path}.projectionWait`, 'is required while waiting for projection');
  }
  if (lifecycleState !== 'WAITING_FOR_PROJECTION' && projectionWaitValue !== undefined) {
    return fail(`${path}.projectionWait`, 'is allowed only while waiting for projection');
  }
  const requiredDiscoveryBase =
    object.requiredDiscoveryBase === undefined
      ? undefined
      : decodeDiscoveryBase(object.requiredDiscoveryBase, `${path}.requiredDiscoveryBase`);
  if (
    projectionWaitValue !== undefined &&
    (requiredDiscoveryBase === undefined ||
      semanticStableJson(projectionWaitValue.requiredDiscoveryBase) !==
        semanticStableJson(requiredDiscoveryBase))
  ) {
    return fail(`${path}.projectionWait.requiredDiscoveryBase`, 'must match requiredDiscoveryBase');
  }
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    requestedScanMode: enumValue(
      required(object, 'requestedScanMode', path),
      DISCOVERY_RUNTIME_SCAN_MODES_V1,
      `${path}.requestedScanMode`,
    ),
    effectiveScanMode: enumValue(
      required(object, 'effectiveScanMode', path),
      DISCOVERY_RUNTIME_SCAN_MODES_V1,
      `${path}.effectiveScanMode`,
    ),
    canonicalBase: decodeCanonicalBase(
      required(object, 'canonicalBase', path),
      `${path}.canonicalBase`,
    ),
    ...(requiredDiscoveryBase === undefined
      ? {}
      : { requiredDiscoveryBase: requiredDiscoveryBase }),
    policyRevision: text(required(object, 'policyRevision', path), `${path}.policyRevision`),
    strategyRevision: text(required(object, 'strategyRevision', path), `${path}.strategyRevision`),
    ...(object.profileBinding === undefined
      ? {}
      : { profileBinding: decodeProfileBinding(object.profileBinding, `${path}.profileBinding`) }),
    budget: decodeDiscoveryRuntimeBudgetBindingV1(
      required(object, 'budget', path),
      `${path}.budget`,
    ),
    lifecycleState,
    lifecycleRevision: integer(
      required(object, 'lifecycleRevision', path),
      `${path}.lifecycleRevision`,
      1,
    ),
    ...(projectionWaitValue === undefined ? {} : { projectionWait: projectionWaitValue }),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
  } as const;
};

export const decodeDiscoveryLogicalJobIdentityV1 = (
  value: unknown,
  path = 'logicalIdentity',
): DiscoveryLogicalJobIdentityV1 => {
  const object = strictObject(value, ['schemaVersion', 'identityVersion', 'value'], path);
  if (required(object, 'identityVersion', path) !== DISCOVERY_LOGICAL_JOB_IDENTITY_VERSION_V1) {
    return fail(`${path}.identityVersion`, 'is unsupported');
  }
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    identityVersion: DISCOVERY_LOGICAL_JOB_IDENTITY_VERSION_V1,
    value: text(required(object, 'value', path), `${path}.value`),
  };
};

export const decodeDiscoveryJobV1 = (value: unknown, path = 'job'): DiscoveryJobV1 => {
  const object = strictObject(
    value,
    ['jobId', 'logicalIdentity', 'trigger', ...baseRuntimeKeys],
    path,
  );
  const binding = decodeRuntimeBinding(object, path);
  const trigger = decodeDiscoveryTriggerV1(required(object, 'trigger', path), `${path}.trigger`);
  const bindingFields = [
    ['projectId', binding.projectId, trigger.projectId],
    ['requestedScanMode', binding.requestedScanMode, trigger.requestedScanMode],
    ['effectiveScanMode', binding.effectiveScanMode, trigger.effectiveScanMode],
    ['canonicalBase', binding.canonicalBase, trigger.canonicalBase],
    ['requiredDiscoveryBase', binding.requiredDiscoveryBase, trigger.requiredDiscoveryBase],
    ['policyRevision', binding.policyRevision, trigger.policyRevision],
    ['strategyRevision', binding.strategyRevision, trigger.strategyRevision],
    ['profileBinding', binding.profileBinding, trigger.profileBinding],
  ] as const;
  for (const [field, actual, expected] of bindingFields) {
    if (semanticStableJson(actual) !== semanticStableJson(expected)) {
      return fail(`${path}.${field}`, 'must match trigger binding');
    }
  }
  const logicalIdentity = decodeDiscoveryLogicalJobIdentityV1(
    required(object, 'logicalIdentity', path),
    `${path}.logicalIdentity`,
  );
  const expectedIdentity = createDiscoveryLogicalJobIdentityV1(trigger);
  if (
    logicalIdentity.identityVersion !== expectedIdentity.identityVersion ||
    logicalIdentity.value !== expectedIdentity.value
  ) {
    return fail(`${path}.logicalIdentity`, 'must be recomputed from the trigger binding');
  }
  return {
    ...binding,
    jobId: text(required(object, 'jobId', path), `${path}.jobId`),
    logicalIdentity,
    trigger,
  };
};

export const decodeDiscoveryRunV1 = (value: unknown, path = 'run'): DiscoveryRunV1 => {
  const object = strictObject(
    value,
    ['runId', 'jobId', 'runRevision', 'completedAt', ...baseRuntimeKeys],
    path,
  );
  const binding = decodeRuntimeBinding(object, path);
  const completedAt = completionShape(object, path);
  return {
    ...binding,
    runId: text(required(object, 'runId', path), `${path}.runId`),
    jobId: text(required(object, 'jobId', path), `${path}.jobId`),
    runRevision: integer(required(object, 'runRevision', path), `${path}.runRevision`, 1),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
};

const completionShape = (object: Record<string, unknown>, path: string): string | undefined => {
  const completedAt =
    object.completedAt === undefined
      ? undefined
      : isoTimestamp(object.completedAt, `${path}.completedAt`);
  const state = enumValue(
    required(object, 'lifecycleState', path),
    DISCOVERY_RUNTIME_LIFECYCLE_STATES_V1,
    `${path}.lifecycleState`,
  );
  if (
    completedAt === undefined &&
    ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'].includes(state)
  ) {
    return fail(`${path}.completedAt`, 'is required for a completed attempt');
  }
  if (
    completedAt !== undefined &&
    !['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'].includes(state)
  ) {
    return fail(`${path}.completedAt`, 'is allowed only for a completed lifecycle state');
  }
  return completedAt;
};

export const decodeDiscoveryAttemptV1 = (value: unknown, path = 'attempt'): DiscoveryAttemptV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'attemptId',
      'jobId',
      'runId',
      'projectId',
      'attemptNumber',
      'lifecycleRevision',
      'attemptKind',
      'lifecycleState',
      'previousAttemptId',
      'createdAt',
      'updatedAt',
      'completedAt',
    ],
    path,
  );
  const completedAt = completionShape(object, path);
  const attemptKind = enumValue(
    required(object, 'attemptKind', path),
    DISCOVERY_RUNTIME_ATTEMPT_KINDS_V1,
    `${path}.attemptKind`,
  );
  if (attemptKind === 'INITIAL' && object.previousAttemptId !== undefined) {
    return fail(`${path}.previousAttemptId`, 'is allowed only for DOMAIN_RETRY');
  }
  if (attemptKind === 'INITIAL' && object.attemptNumber !== 1) {
    return fail(`${path}.attemptNumber`, 'INITIAL attempts must be numbered 1');
  }
  if (attemptKind === 'DOMAIN_RETRY' && object.previousAttemptId === undefined) {
    return fail(`${path}.previousAttemptId`, 'is required for DOMAIN_RETRY');
  }
  if (
    attemptKind === 'DOMAIN_RETRY' &&
    typeof object.attemptNumber === 'number' &&
    object.attemptNumber < 2
  ) {
    return fail(`${path}.attemptNumber`, 'DOMAIN_RETRY attempts must be numbered from 2');
  }
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    attemptId: text(required(object, 'attemptId', path), `${path}.attemptId`),
    jobId: text(required(object, 'jobId', path), `${path}.jobId`),
    runId: text(required(object, 'runId', path), `${path}.runId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    attemptNumber: integer(required(object, 'attemptNumber', path), `${path}.attemptNumber`, 1),
    lifecycleRevision: integer(
      required(object, 'lifecycleRevision', path),
      `${path}.lifecycleRevision`,
      1,
    ),
    attemptKind,
    lifecycleState: enumValue(
      required(object, 'lifecycleState', path),
      DISCOVERY_RUNTIME_LIFECYCLE_STATES_V1,
      `${path}.lifecycleState`,
    ),
    ...(object.previousAttemptId === undefined
      ? {}
      : { previousAttemptId: text(object.previousAttemptId, `${path}.previousAttemptId`) }),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
};

export const discoveryStageOrdinalV1 = (stageType: DiscoveryRuntimeStageTypeV1): number =>
  DISCOVERY_RUNTIME_STAGE_TYPES_V1.indexOf(stageType) + 1;

export const decodeDiscoveryStageV1 = (value: unknown, path = 'stage'): DiscoveryStageV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'stageId',
      'jobId',
      'runId',
      'attemptId',
      'projectId',
      'stageOrdinal',
      'stageType',
      'stageRevision',
      'state',
      'createdAt',
      'updatedAt',
      'completedAt',
    ],
    path,
  );
  const stageType = enumValue(
    required(object, 'stageType', path),
    DISCOVERY_RUNTIME_STAGE_TYPES_V1,
    `${path}.stageType`,
  );
  const stageOrdinal = integer(required(object, 'stageOrdinal', path), `${path}.stageOrdinal`, 1);
  if (stageOrdinal !== discoveryStageOrdinalV1(stageType))
    return fail(`${path}.stageOrdinal`, 'does not match stageType');
  const state = enumValue(
    required(object, 'state', path),
    DISCOVERY_RUNTIME_STAGE_STATES_V1,
    `${path}.state`,
  );
  const completedAt =
    object.completedAt === undefined
      ? undefined
      : isoTimestamp(object.completedAt, `${path}.completedAt`);
  if (
    completedAt === undefined &&
    ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'].includes(state)
  ) {
    return fail(`${path}.completedAt`, 'is required for a completed stage');
  }
  return {
    schemaVersion: schemaVersion(required(object, 'schemaVersion', path), `${path}.schemaVersion`),
    stageId: text(required(object, 'stageId', path), `${path}.stageId`),
    jobId: text(required(object, 'jobId', path), `${path}.jobId`),
    runId: text(required(object, 'runId', path), `${path}.runId`),
    attemptId: text(required(object, 'attemptId', path), `${path}.attemptId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    stageOrdinal,
    stageType,
    stageRevision: integer(required(object, 'stageRevision', path), `${path}.stageRevision`, 1),
    state,
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
};

export const createDiscoveryLogicalJobIdentityV1 = (
  triggerInput: DiscoveryTriggerV1,
): DiscoveryLogicalJobIdentityV1 => {
  const trigger = decodeDiscoveryTriggerV1(triggerInput);
  const identityInput = {
    projectId: trigger.projectId,
    triggerClass: trigger.triggerClass,
    triggerIdentity: trigger.triggerIdentity,
    requestedScanMode: trigger.requestedScanMode,
    effectiveScanMode: trigger.effectiveScanMode,
    canonicalBase: trigger.canonicalBase,
    requiredDiscoveryBase: trigger.requiredDiscoveryBase,
    policyRevision: trigger.policyRevision,
    strategyRevision: trigger.strategyRevision,
    profileBinding: trigger.profileBinding,
  };
  return {
    schemaVersion: DISCOVERY_RUNTIME_SCHEMA_VERSION_V1,
    identityVersion: DISCOVERY_LOGICAL_JOB_IDENTITY_VERSION_V1,
    value: sha256Text(semanticStableJson(identityInput)),
  };
};

const lifecycleTransitionTable: Readonly<
  Record<DiscoveryRuntimeLifecycleStateV1, readonly DiscoveryRuntimeLifecycleStateV1[]>
> = {
  QUEUED: ['WAITING_FOR_PROJECTION', 'RUNNING', 'FAILED_TERMINAL', 'CANCELLED'],
  WAITING_FOR_PROJECTION: ['RUNNING', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  RUNNING: ['PARTIAL', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  PARTIAL: ['RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED_RETRYABLE: ['QUEUED', 'RUNNING', 'CANCELLED'],
  FAILED_TERMINAL: [],
  CANCELLED: [],
};

export const assertDiscoveryRuntimeLifecycleTransitionV1 = (
  from: DiscoveryRuntimeLifecycleStateV1,
  to: DiscoveryRuntimeLifecycleStateV1,
): void => {
  if (!lifecycleTransitionTable[from].includes(to))
    return fail('lifecycleState', `invalid transition ${from} -> ${to}`);
};

const DISCOVERY_ATTEMPT_TERMINAL_STATES_V1: readonly DiscoveryRuntimeLifecycleStateV1[] = [
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'CANCELLED',
];

export const assertDiscoveryAttemptLifecycleTransitionV1 = (
  from: DiscoveryRuntimeLifecycleStateV1,
  to: DiscoveryRuntimeLifecycleStateV1,
): void => {
  if (DISCOVERY_ATTEMPT_TERMINAL_STATES_V1.includes(from)) {
    return fail('attempt.lifecycleState', `invalid transition ${from} -> ${to}`);
  }
  assertDiscoveryRuntimeLifecycleTransitionV1(from, to);
};

export const assertDiscoveryRuntimeStageTransitionV1 = (
  from: DiscoveryRuntimeStageStateV1,
  to: DiscoveryRuntimeStageStateV1,
): void => {
  const allowed: Readonly<
    Record<DiscoveryRuntimeStageStateV1, readonly DiscoveryRuntimeStageStateV1[]>
  > = {
    QUEUED: ['RUNNING', 'CANCELLED'],
    RUNNING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
    SUCCEEDED: [],
    FAILED_RETRYABLE: ['QUEUED', 'RUNNING'],
    FAILED_TERMINAL: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to))
    return fail('stage.state', `invalid transition ${from} -> ${to}`);
};

/** Deterministic ordering helper for repository list results. */
export const compareDiscoveryRuntimeIdentityV1 = (
  left: {
    readonly projectId: string;
    readonly runId?: string;
    readonly attemptId?: string;
    readonly stageId?: string;
  },
  right: typeof left,
): number =>
  utf16OrdinalCompare(left.projectId, right.projectId) ||
  utf16OrdinalCompare(left.runId ?? '', right.runId ?? '') ||
  utf16OrdinalCompare(left.attemptId ?? '', right.attemptId ?? '') ||
  utf16OrdinalCompare(left.stageId ?? '', right.stageId ?? '');
