import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryFindingEnvelopeV1,
  DiscoveryFindingLifecycleState,
  DiscoveryProjectionBaseIdentityV1,
} from '../../../packages/contracts/src/index.js';
import {
  DISCOVERY_FINDING_LIFECYCLE_STATES,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

export type DiscoveryFindingIdentityV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryFindingLifecycleCurrentV1 = DiscoveryFindingIdentityV1 & {
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly lifecycleRevision: number;
  readonly updatedAt: string;
};

export type DiscoveryLifecycleCauseV1 =
  'MATERIALIZATION' | 'GOVERNED_WORKFLOW' | 'SYSTEM_RECONCILIATION';

export type DiscoveryLifecycleReasonCodeV1 =
  | 'FINDING_MATERIALIZED'
  | 'VALIDATION_STARTED'
  | 'REVIEW_READY'
  | 'REENTERED'
  | 'DISMISSED'
  | 'SUPPRESSED'
  | 'CANONICAL_EQUIVALENT_ACCEPTED'
  | 'SOURCE_MATERIALLY_SUPERSEDED'
  | 'RELEVANT_INPUT_CHANGED';

export type DiscoveryLifecycleContextV1 = {
  readonly canonicalBase?: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase?: DiscoveryProjectionBaseIdentityV1;
};

export type DiscoveryFindingLifecycleHistoryV1 = DiscoveryFindingIdentityV1 & {
  readonly lifecycleRevision: number;
  readonly fromState?: DiscoveryFindingLifecycleState;
  readonly toState: DiscoveryFindingLifecycleState;
  readonly cause: DiscoveryLifecycleCauseV1;
  readonly reasonCode: DiscoveryLifecycleReasonCodeV1;
  readonly canonicalBase?: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase?: DiscoveryProjectionBaseIdentityV1;
  readonly occurredAt: string;
};

export type DiscoveryLifecycleTransitionInputV1 = DiscoveryFindingIdentityV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryFindingLifecycleState;
  readonly cause: DiscoveryLifecycleCauseV1;
  readonly reasonCode: DiscoveryLifecycleReasonCodeV1;
  readonly occurredAt: string;
  readonly context?: DiscoveryLifecycleContextV1;
};

export type DiscoveryLifecycleTransitionResultV1 =
  | {
      readonly status: 'APPLIED';
      readonly lifecycle: DiscoveryFindingLifecycleCurrentV1;
      readonly history: DiscoveryFindingLifecycleHistoryV1;
    }
  | {
      readonly status: 'CONFLICT';
      readonly current: DiscoveryFindingLifecycleCurrentV1;
    };

export type DiscoveryFindingLifecycleRepositoryPort = {
  findLifecycle(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryFindingLifecycleCurrentV1 | undefined>;
  listLifecycleHistory(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<readonly DiscoveryFindingLifecycleHistoryV1[]>;
  transitionLifecycle(
    input: DiscoveryLifecycleTransitionInputV1,
  ): Promise<DiscoveryLifecycleTransitionResultV1>;
};

export type DiscoveryFindingFingerprintLookupPort = {
  findByFingerprint(
    projectId: string,
    fingerprintVersion: string,
    fingerprint: string,
  ): Promise<readonly DiscoveryFindingIdentityV1[]>;
};

export type DiscoveryFindingWp3RepositoryPort = DiscoveryFindingLifecycleRepositoryPort &
  DiscoveryFindingFingerprintLookupPort;

export const DISCOVERY_RECONCILIATION_DISPOSITIONS = [
  'UNCHANGED',
  'CANONICAL_EQUIVALENT_ACCEPTED',
  'SOURCE_MATERIALLY_SUPERSEDED',
  'RELEVANT_INPUT_CHANGED',
] as const;
export type DiscoveryReconciliationDispositionV1 =
  (typeof DISCOVERY_RECONCILIATION_DISPOSITIONS)[number];

export type DiscoveryReconciliationObservationV1 = DiscoveryFindingIdentityV1 &
  DiscoveryLifecycleContextV1 & {
    readonly disposition: DiscoveryReconciliationDispositionV1;
  };

export type DiscoveryReconciliationInputV1 = {
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly expectedLifecycleRevision: number;
  readonly observation: unknown;
  readonly occurredAt: string;
};

export type DiscoveryReconciliationResultV1 =
  | { readonly status: 'UNCHANGED'; readonly observation: DiscoveryReconciliationObservationV1 }
  | {
      readonly status: 'TRANSITIONED';
      readonly observation: DiscoveryReconciliationObservationV1;
      readonly transition: Extract<
        DiscoveryLifecycleTransitionResultV1,
        { readonly status: 'APPLIED' }
      >;
    }
  | {
      readonly status: 'CONFLICT';
      readonly observation: DiscoveryReconciliationObservationV1;
      readonly transition: Extract<
        DiscoveryLifecycleTransitionResultV1,
        { readonly status: 'CONFLICT' }
      >;
    };

const fail = (
  operation: string,
  code: 'VALIDATION_ERROR' | 'FORMAT_CORRUPT',
  message: string,
): never => {
  throw new ShotgunError({
    code,
    safeMessage: message,
    module: 'discovery-finding-lifecycle',
    operation,
  });
};

const objectValue = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path} must be an object`);
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
  if (unknownKeys.length > 0) {
    return fail(
      'decode-observation',
      'FORMAT_CORRUPT',
      `${path} contains unknown field(s): ${unknownKeys.join(', ')}`,
    );
  }
  return object;
};

const required = (object: Record<string, unknown>, key: string, path: string): unknown => {
  if (!Object.hasOwn(object, key) || object[key] === undefined) {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path}.${key} is required`);
  }
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path} must be a non-empty string`);
  }
  return value.trim();
};

const positiveInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path} must be a positive integer`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path} must be a non-negative integer`);
  }
  return value;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const timestamp = text(value, path);
  if (Number.isNaN(Date.parse(timestamp))) {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path} must be an ISO timestamp`);
  }
  return timestamp;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(
      'decode-observation',
      'FORMAT_CORRUPT',
      `${path} must be one of ${values.join(', ')}`,
    );
  }
  return value as T;
};

const decodeCanonicalBase = (value: unknown, path: string): DiscoveryCanonicalBaseIdentityV1 => {
  const object = strictObject(value, ['schemaVersion', 'canonicalVersion', 'snapshotDigest'], path);
  if (text(required(object, 'schemaVersion', path), `${path}.schemaVersion`) !== '1.0.0') {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path}.schemaVersion is unsupported`);
  }
  return {
    schemaVersion: '1.0.0',
    canonicalVersion: nonNegativeInteger(
      required(object, 'canonicalVersion', path),
      `${path}.canonicalVersion`,
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
  if (text(required(object, 'schemaVersion', path), `${path}.schemaVersion`) !== '1.0.0') {
    return fail('decode-observation', 'FORMAT_CORRUPT', `${path}.schemaVersion is unsupported`);
  }
  return {
    schemaVersion: '1.0.0',
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    projectionDigest: text(required(object, 'projectionDigest', path), `${path}.projectionDigest`),
  };
};

const decodeContext = (
  object: Record<string, unknown>,
  path: string,
): DiscoveryLifecycleContextV1 => {
  const canonicalBase =
    object.canonicalBase === undefined
      ? undefined
      : decodeCanonicalBase(object.canonicalBase, `${path}.canonicalBase`);
  const discoveryBase =
    object.discoveryBase === undefined
      ? undefined
      : decodeDiscoveryBase(object.discoveryBase, `${path}.discoveryBase`);
  return {
    ...(canonicalBase === undefined ? {} : { canonicalBase }),
    ...(discoveryBase === undefined ? {} : { discoveryBase }),
  };
};

const decodeIdentity = (
  object: Record<string, unknown>,
  path: string,
): DiscoveryFindingIdentityV1 => ({
  projectId: text(required(object, 'projectId', path), `${path}.projectId`),
  findingId: text(required(object, 'findingId', path), `${path}.findingId`),
  findingRevision: positiveInteger(
    required(object, 'findingRevision', path),
    `${path}.findingRevision`,
  ),
});

export const decodeDiscoveryReconciliationObservationV1 = (
  value: unknown,
  path = 'reconciliationObservation',
): DiscoveryReconciliationObservationV1 => {
  const object = strictObject(
    value,
    ['projectId', 'findingId', 'findingRevision', 'disposition', 'canonicalBase', 'discoveryBase'],
    path,
  );
  const disposition = enumValue(
    required(object, 'disposition', path),
    DISCOVERY_RECONCILIATION_DISPOSITIONS,
    `${path}.disposition`,
  );
  return {
    ...decodeIdentity(object, path),
    disposition,
    ...decodeContext(object, path),
  };
};

const transitionError = (message: string): never => fail('transition', 'VALIDATION_ERROR', message);

const workflowTargetByState: Readonly<
  Partial<Record<DiscoveryFindingLifecycleState, readonly DiscoveryFindingLifecycleState[]>>
> = {
  NEW: ['VALIDATING'],
  VALIDATING: ['REVIEW_READY', 'DISMISSED', 'SUPPRESSED'],
  REVIEW_READY: ['REENTERED', 'DISMISSED', 'SUPPRESSED'],
};

const reconciliationReasonByTarget: Readonly<
  Record<'RESOLVED' | 'STALE' | 'SUPERSEDED', DiscoveryLifecycleReasonCodeV1>
> = {
  RESOLVED: 'CANONICAL_EQUIVALENT_ACCEPTED',
  STALE: 'RELEVANT_INPUT_CHANGED',
  SUPERSEDED: 'SOURCE_MATERIALLY_SUPERSEDED',
};

export const assertDiscoveryLifecycleTransitionV1 = (
  fromState: DiscoveryFindingLifecycleState,
  targetState: DiscoveryFindingLifecycleState,
  cause: DiscoveryLifecycleCauseV1,
  reasonCode: DiscoveryLifecycleReasonCodeV1,
): void => {
  if (!DISCOVERY_FINDING_LIFECYCLE_STATES.includes(fromState)) {
    return transitionError(`Unsupported current lifecycle state: ${fromState}`);
  }
  if (!DISCOVERY_FINDING_LIFECYCLE_STATES.includes(targetState)) {
    return transitionError(`Unsupported target lifecycle state: ${targetState}`);
  }
  if (fromState === targetState) return transitionError('Lifecycle transition must change state.');

  if (targetState === 'RESOLVED' || targetState === 'STALE' || targetState === 'SUPERSEDED') {
    if (cause !== 'SYSTEM_RECONCILIATION') {
      return transitionError('Terminal reconciliation states require system reconciliation.');
    }
    if (reconciliationReasonByTarget[targetState] !== reasonCode) {
      return transitionError('Reconciliation reason does not match the target lifecycle state.');
    }
    if (!['NEW', 'VALIDATING', 'REVIEW_READY', 'REENTERED'].includes(fromState)) {
      return transitionError('Terminal lifecycle states cannot be reopened or reconciled again.');
    }
    return;
  }

  if (cause !== 'GOVERNED_WORKFLOW') {
    return transitionError('Non-terminal lifecycle transitions require a governed workflow.');
  }
  if (!workflowTargetByState[fromState]?.includes(targetState)) {
    return transitionError(`Lifecycle transition ${fromState} -> ${targetState} is not allowed.`);
  }
  const expectedReason: Partial<
    Record<DiscoveryFindingLifecycleState, DiscoveryLifecycleReasonCodeV1>
  > = {
    VALIDATING: 'VALIDATION_STARTED',
    REVIEW_READY: 'REVIEW_READY',
    REENTERED: 'REENTERED',
    DISMISSED: 'DISMISSED',
    SUPPRESSED: 'SUPPRESSED',
  };
  if (expectedReason[targetState] !== reasonCode) {
    return transitionError('Workflow reason does not match the target lifecycle state.');
  }
};

export const decodeDiscoveryFindingLifecycleCurrentV1 = (
  value: unknown,
  path = 'lifecycleCurrent',
): DiscoveryFindingLifecycleCurrentV1 => {
  const object = strictObject(
    value,
    [
      'projectId',
      'findingId',
      'findingRevision',
      'lifecycleState',
      'lifecycleRevision',
      'updatedAt',
    ],
    path,
  );
  return {
    ...decodeIdentity(object, path),
    lifecycleState: enumValue(
      required(object, 'lifecycleState', path),
      DISCOVERY_FINDING_LIFECYCLE_STATES,
      `${path}.lifecycleState`,
    ),
    lifecycleRevision: positiveInteger(
      required(object, 'lifecycleRevision', path),
      `${path}.lifecycleRevision`,
    ),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
  };
};

export const decodeDiscoveryFindingLifecycleHistoryV1 = (
  value: unknown,
  path = 'lifecycleHistory',
): DiscoveryFindingLifecycleHistoryV1 => {
  const object = strictObject(
    value,
    [
      'projectId',
      'findingId',
      'findingRevision',
      'lifecycleRevision',
      'fromState',
      'toState',
      'cause',
      'reasonCode',
      'canonicalBase',
      'discoveryBase',
      'occurredAt',
    ],
    path,
  );
  const fromState =
    object.fromState === undefined || object.fromState === null
      ? undefined
      : enumValue(object.fromState, DISCOVERY_FINDING_LIFECYCLE_STATES, `${path}.fromState`);
  return {
    ...decodeIdentity(object, path),
    lifecycleRevision: positiveInteger(
      required(object, 'lifecycleRevision', path),
      `${path}.lifecycleRevision`,
    ),
    ...(fromState === undefined ? {} : { fromState }),
    toState: enumValue(
      required(object, 'toState', path),
      DISCOVERY_FINDING_LIFECYCLE_STATES,
      `${path}.toState`,
    ),
    cause: enumValue(
      required(object, 'cause', path),
      ['MATERIALIZATION', 'GOVERNED_WORKFLOW', 'SYSTEM_RECONCILIATION'],
      `${path}.cause`,
    ),
    reasonCode: enumValue(
      required(object, 'reasonCode', path),
      [
        'FINDING_MATERIALIZED',
        'VALIDATION_STARTED',
        'REVIEW_READY',
        'REENTERED',
        'DISMISSED',
        'SUPPRESSED',
        'CANONICAL_EQUIVALENT_ACCEPTED',
        'SOURCE_MATERIALLY_SUPERSEDED',
        'RELEVANT_INPUT_CHANGED',
      ],
      `${path}.reasonCode`,
    ),
    ...decodeContext(object, path),
    occurredAt: isoTimestamp(required(object, 'occurredAt', path), `${path}.occurredAt`),
  };
};

export class DiscoveryFindingLifecycleService {
  constructor(private readonly repository: DiscoveryFindingLifecycleRepositoryPort) {}

  async transition(
    input: DiscoveryLifecycleTransitionInputV1,
  ): Promise<DiscoveryLifecycleTransitionResultV1> {
    if (
      !Number.isSafeInteger(input.expectedLifecycleRevision) ||
      input.expectedLifecycleRevision < 1
    ) {
      return transitionError('Expected lifecycle revision must be a positive integer.');
    }
    if (Number.isNaN(Date.parse(input.occurredAt))) {
      return transitionError('Transition occurredAt must be an ISO timestamp.');
    }
    const current = await this.repository.findLifecycle(input);
    if (!current) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Discovery finding lifecycle was not found.',
        module: 'discovery-finding-lifecycle',
        operation: 'transition',
      });
    }
    assertDiscoveryLifecycleTransitionV1(
      current.lifecycleState,
      input.targetState,
      input.cause,
      input.reasonCode,
    );
    return this.repository.transitionLifecycle(input);
  }

  async reconcile(input: DiscoveryReconciliationInputV1): Promise<DiscoveryReconciliationResultV1> {
    const observation = decodeDiscoveryReconciliationObservationV1(input.observation);
    const identity: DiscoveryFindingIdentityV1 = {
      projectId: input.finding.projectId,
      findingId: input.finding.findingId,
      findingRevision: input.finding.findingRevision,
    };
    if (
      observation.projectId !== identity.projectId ||
      observation.findingId !== identity.findingId ||
      observation.findingRevision !== identity.findingRevision
    ) {
      throw new ShotgunError({
        code: 'RESOURCE_PROJECT_MISMATCH',
        safeMessage: 'Reconciliation observation does not match the finding identity.',
        module: 'discovery-finding-lifecycle',
        operation: 'reconcile',
      });
    }
    if (observation.disposition === 'UNCHANGED') {
      return { status: 'UNCHANGED', observation };
    }
    const targetState =
      observation.disposition === 'CANONICAL_EQUIVALENT_ACCEPTED'
        ? 'RESOLVED'
        : observation.disposition === 'SOURCE_MATERIALLY_SUPERSEDED'
          ? 'SUPERSEDED'
          : 'STALE';
    const transition = await this.transition({
      ...identity,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      targetState,
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: observation.disposition,
      occurredAt: input.occurredAt,
      context: {
        ...(observation.canonicalBase === undefined
          ? {}
          : { canonicalBase: observation.canonicalBase }),
        ...(observation.discoveryBase === undefined
          ? {}
          : { discoveryBase: observation.discoveryBase }),
      },
    });
    return transition.status === 'APPLIED'
      ? { status: 'TRANSITIONED', observation, transition }
      : { status: 'CONFLICT', observation, transition };
  }
}
