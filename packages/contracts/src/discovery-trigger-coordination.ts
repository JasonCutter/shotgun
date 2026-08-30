import type { CanonicalCommittedPayload } from './canonical-knowledge.js';
import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryProjectionBaseIdentityV1,
} from './discovery-finding.js';
import type {
  DiscoveryJobV1,
  DiscoveryLogicalJobIdentityV1,
  DiscoveryRuntimeBudgetBindingV1,
  DiscoveryRuntimeLifecycleStateV1,
  DiscoveryRuntimeProfileBindingV1,
  DiscoveryProjectionWaitBindingV1,
  DiscoveryRuntimeScanModeV1,
} from './discovery-runtime.js';
import type { EventEnvelope } from './types.js';

export const DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1 = '1.0.0' as const;
export const DISCOVERY_TRIGGER_POLICY_REVISION_V1 = 'projection-wait-policy:v1' as const;

export const DISCOVERY_PROJECTION_KINDS_V1 = [
  'COMPILED_TRUTH',
  'GRAPH_PROJECTION',
  'SEMANTIC_INDEX',
] as const;
export type DiscoveryProjectionKindV1 = (typeof DISCOVERY_PROJECTION_KINDS_V1)[number];

export const DISCOVERY_PROJECTION_OBSERVATION_STATUSES_V1 = [
  'READY',
  'BEHIND',
  'UNAVAILABLE',
] as const;
export type DiscoveryProjectionObservationStatusV1 =
  (typeof DISCOVERY_PROJECTION_OBSERVATION_STATUSES_V1)[number];

export type DiscoveryProjectionObservationV1 = {
  readonly projectionKind: DiscoveryProjectionKindV1;
  readonly requiredIdentity: DiscoveryProjectionBaseIdentityV1;
  readonly observedIdentity?: DiscoveryProjectionBaseIdentityV1;
  readonly status: DiscoveryProjectionObservationStatusV1;
  readonly reason?: string;
};

export type DiscoveryProjectionReadinessV1 = {
  readonly schemaVersion: typeof DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1;
  readonly status: DiscoveryProjectionObservationStatusV1;
  readonly requiredBase: DiscoveryProjectionBaseIdentityV1;
  readonly observations: readonly DiscoveryProjectionObservationV1[];
  readonly observedAt: string;
};

export type DiscoveryCanonicalCommittedSourceV1 = {
  readonly projectId: string;
  readonly eventIdentity: {
    readonly eventId: string;
    readonly eventRevision: string;
  };
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly requiredDiscoveryBase?: DiscoveryProjectionBaseIdentityV1;
  readonly createdAt: string;
  readonly causationId?: string;
  readonly correlationId?: string;
};

export type DiscoveryCanonicalTriggerLookupV1 = {
  readonly projectId: string;
  readonly triggerClass: 'CANONICAL_COMMITTED';
  readonly eventId: string;
  readonly eventRevision: string;
};

export type DiscoveryScheduledTriggerLookupV1 = {
  readonly projectId: string;
  readonly triggerClass: 'SCHEDULED_FULL_SCAN';
  readonly scheduleId: string;
  readonly scheduleRevision: string;
  readonly occurrenceKey: string;
};

export type DiscoveryManualTriggerLookupV1 = {
  readonly projectId: string;
  readonly triggerClass: 'MANUAL';
  readonly commandId: string;
  readonly requestId: string;
};

export type DiscoveryTriggerIdentityLookupV1 =
  | DiscoveryCanonicalTriggerLookupV1
  | DiscoveryScheduledTriggerLookupV1
  | DiscoveryManualTriggerLookupV1;

export type DiscoveryCanonicalCommittedEventEnvelopeV1 = EventEnvelope<CanonicalCommittedPayload>;

export type DiscoveryTriggerWorkBudgetTemplateV1 = Omit<
  DiscoveryRuntimeBudgetBindingV1,
  'deadlineAt'
>;

export type DiscoveryTriggerPolicyV1 = {
  readonly policyRevision: string;
  readonly strategyRevision: string;
  readonly fallbackPolicyRevision: string;
  readonly requiredProjectionKinds: readonly DiscoveryProjectionKindV1[];
  readonly waitTimeoutMs: number;
  readonly budget: DiscoveryTriggerWorkBudgetTemplateV1;
  readonly profileBinding?: DiscoveryRuntimeProfileBindingV1;
  readonly allowedManualScanModes?: readonly DiscoveryRuntimeScanModeV1[];
};

export type DiscoveryCanonicalCommittedSourcePort = {
  resolve(
    envelope: DiscoveryCanonicalCommittedEventEnvelopeV1,
  ): Promise<DiscoveryCanonicalCommittedSourceV1>;
  resolveInitialProjectionBase?(
    source: DiscoveryCanonicalCommittedSourceV1,
  ): Promise<DiscoveryProjectionBaseIdentityV1>;
};

export type DiscoveryCurrentAuthorityV1 = {
  readonly projectId: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1;
};

export type DiscoveryCurrentAuthorityPort = {
  resolve(projectId: string): Promise<DiscoveryCurrentAuthorityV1>;
};

export type DiscoveryProjectionReadinessPort = {
  read(input: {
    readonly projectId: string;
    readonly requiredBase: DiscoveryProjectionBaseIdentityV1;
    readonly projectionKinds: readonly DiscoveryProjectionKindV1[];
    readonly observedAt: string;
  }): Promise<DiscoveryProjectionReadinessV1>;
};

export type DiscoveryTriggerPolicyPort = {
  resolve(projectId: string): Promise<DiscoveryTriggerPolicyV1>;
};

export type DiscoveryClockPort = {
  now(): string;
};

export type DiscoveryTriggerCoordinationResultV1 = {
  readonly schemaVersion: typeof DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1;
  readonly disposition: 'CREATED' | 'ALREADY_EXISTS';
  readonly jobId: string;
  readonly logicalJobIdentity: DiscoveryLogicalJobIdentityV1;
  readonly readiness: DiscoveryProjectionReadinessV1;
  readonly lifecycleState: DiscoveryRuntimeLifecycleStateV1;
};

export type DiscoveryCanonicalTriggerCoordinationResultV1 = DiscoveryTriggerCoordinationResultV1;
export type DiscoveryScheduledTriggerCoordinationResultV1 = DiscoveryTriggerCoordinationResultV1;
export type DiscoveryManualTriggerCoordinationResultV1 = DiscoveryTriggerCoordinationResultV1;

export const DISCOVERY_DURABLE_MANUAL_COMMAND_V1 = 'RunKnowledgeDiscoveryDurable' as const;
export type DiscoveryManualTriggerRequestV1 = {
  readonly commandId: string;
  readonly requestId: string;
  readonly requestedScanMode: DiscoveryRuntimeScanModeV1;
};

const manualText = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    throw new TypeError(`${path} must be a non-empty string of at most 512 characters.`);
  }
  return value.trim();
};

export const decodeDiscoveryManualTriggerRequestV1 = (
  value: unknown,
): DiscoveryManualTriggerRequestV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Discovery manual trigger request must be an object.');
  }
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).filter(
    (key) => !['commandId', 'requestId', 'requestedScanMode'].includes(key),
  );
  if (unknown.length) throw new TypeError(`Unknown manual trigger field(s): ${unknown.join(', ')}`);
  const requestedScanMode = object.requestedScanMode;
  if (requestedScanMode !== 'INCREMENTAL' && requestedScanMode !== 'FULL_SCAN') {
    throw new TypeError('requestedScanMode must be INCREMENTAL or FULL_SCAN.');
  }
  return {
    commandId: manualText(object.commandId, 'commandId'),
    requestId: manualText(object.requestId, 'requestId'),
    requestedScanMode,
  };
};

export type DiscoveryWaitingReevaluationResultV1 = {
  readonly schemaVersion: typeof DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1;
  readonly disposition: 'READY_FOR_EXECUTION' | 'WAITING_FOR_PROJECTION' | 'FAILED_RETRYABLE';
  readonly jobId: string;
  readonly job: DiscoveryJobV1;
  readonly readiness: DiscoveryProjectionReadinessV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
};
