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
  readonly requiredDiscoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly createdAt: string;
  readonly causationId?: string;
  readonly correlationId?: string;
};

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
};

export type DiscoveryCanonicalCommittedSourcePort = {
  resolve(
    envelope: DiscoveryCanonicalCommittedEventEnvelopeV1,
  ): Promise<DiscoveryCanonicalCommittedSourceV1>;
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

export type DiscoveryCanonicalTriggerCoordinationResultV1 = {
  readonly schemaVersion: typeof DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1;
  readonly disposition: 'CREATED' | 'ALREADY_EXISTS';
  readonly jobId: string;
  readonly logicalJobIdentity: DiscoveryLogicalJobIdentityV1;
  readonly readiness: DiscoveryProjectionReadinessV1;
  readonly lifecycleState: DiscoveryRuntimeLifecycleStateV1;
};

export type DiscoveryWaitingReevaluationResultV1 = {
  readonly schemaVersion: typeof DISCOVERY_TRIGGER_COORDINATION_SCHEMA_VERSION_V1;
  readonly disposition: 'READY_FOR_EXECUTION' | 'WAITING_FOR_PROJECTION' | 'FAILED_RETRYABLE';
  readonly jobId: string;
  readonly job: DiscoveryJobV1;
  readonly readiness: DiscoveryProjectionReadinessV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
};
