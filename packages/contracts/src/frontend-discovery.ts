import { FrontendContractError } from './frontend-foundation.js';
import {
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoverySuppressionDirectiveV1,
  DISCOVERY_FEEDBACK_CLASSES,
  DISCOVERY_EPISTEMIC_FEEDBACK_KINDS,
  DISCOVERY_UTILITY_FEEDBACK_KINDS,
  DISCOVERY_FEEDBACK_SCOPE_KINDS,
  type DiscoveryFeedbackClassV1,
  type DiscoveryFeedbackEventV1,
  type DiscoveryFeedbackKindV1,
  type DiscoveryFeedbackScopeV1,
  type DiscoverySuppressionDirectiveV1,
} from './discovery-feedback.js';
import {
  decodeDiscoveryFindingPayloadV1,
  decodeDiscoveryResourceRefV1,
  DISCOVERY_FINDING_LIFECYCLE_STATES,
  DISCOVERY_FINDING_TYPES,
  DISCOVERY_GENERATION_METHODS,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingPayloadV1,
  type DiscoveryFindingType,
  type DiscoveryGenerationMethod,
  type DiscoveryResourceRefV1,
  type DiscoverySignalSummaryV1,
} from './discovery-finding.js';
import type { SecurityContext } from './types.js';

/** AKP-6 WP1 — server-authoritative Discovery Product read contract. */
export const FRONTEND_DISCOVERY_SCHEMA_VERSION = '1.0.0' as const;
export type FrontendDiscoverySchemaVersion = typeof FRONTEND_DISCOVERY_SCHEMA_VERSION;

export type DiscoveryProductFreshnessStateV1 = 'CURRENT' | 'REVALIDATION_REQUIRED' | 'UNKNOWN';

export type DiscoveryProductReentryStateV1 =
  'NOT_REQUESTED' | 'PROCESSED' | 'INELIGIBLE' | 'BLOCKED_NON_RETRYABLE' | 'RETRYABLE';

export type DiscoveryProductValidationStateV1 =
  'NOT_STARTED' | 'VALIDATING' | 'VALIDATED' | 'UNKNOWN';

export type DiscoveryProductReviewReadinessV1 = 'NOT_ELIGIBLE' | 'ELIGIBLE_AFTER_VALIDATION';

export type DiscoveryProductSafeSignalsV1 = Pick<
  DiscoverySignalSummaryV1,
  | 'graphDistance'
  | 'graphTopology'
  | 'temporalOverlap'
  | 'temporalChange'
  | 'evidenceCoverage'
  | 'conflictState'
  | 'novelty'
>;

export type DiscoveryProductProvenanceV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly kind: DiscoveryGenerationMethod;
  readonly ruleId?: string;
  readonly ruleVersion?: string;
  readonly inputDigest?: string;
};

export type DiscoveryProductEvidenceReferenceV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly evidenceId: string;
  readonly evidenceRevisionId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
};

export type DiscoveryProductLineageV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly evidence: readonly DiscoveryProductEvidenceReferenceV1[];
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: {
    readonly schemaVersion: '1.0.0';
    readonly canonicalVersion: number;
    readonly snapshotDigest: string;
  };
  readonly discoveryBase: {
    readonly schemaVersion: '1.0.0';
    readonly projectionRevision: string;
    readonly projectionDigest: string;
  };
  readonly provenance: DiscoveryProductProvenanceV1;
};

export type DiscoveryProductGovernanceV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly reentryState: DiscoveryProductReentryStateV1;
  readonly validationState: DiscoveryProductValidationStateV1;
  readonly reviewReadiness: DiscoveryProductReviewReadinessV1;
  readonly reviewResourceId?: string;
};

export type DiscoveryProductFreshnessV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly state: DiscoveryProductFreshnessStateV1;
  readonly canonicalBase: DiscoveryProductLineageV1['canonicalBase'];
  readonly discoveryBase: DiscoveryProductLineageV1['discoveryBase'];
};

export type DiscoveryProductCapabilitiesV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly canOpenReview: boolean;
  readonly canInspectEvidence: boolean;
  readonly canOpenGraph: boolean;
  readonly canOpenActivity: boolean;
  readonly canInvestigate: boolean;
  readonly canDismiss: boolean;
};

export const FRONTEND_DISCOVERY_COMMAND_TYPES = {
  dismiss: 'frontend.discovery.dismiss.v1',
  feedback: 'frontend.discovery.feedback.v1',
} as const;

export type FrontendDiscoveryCommandType =
  (typeof FRONTEND_DISCOVERY_COMMAND_TYPES)[keyof typeof FRONTEND_DISCOVERY_COMMAND_TYPES];

export type DiscoveryDismissFindingCommandRequestV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly findingId: string;
  readonly findingRevision: number;
};

/** AKP-7 WP2 — browser-owned intent only. Authority fields are server-derived. */
export type DiscoveryFeedbackProductCommandRequestV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly feedbackClass: DiscoveryFeedbackClassV1;
  readonly feedbackKind: DiscoveryFeedbackKindV1;
  readonly reason?: string;
  readonly scope?: DiscoveryFeedbackScopeV1;
  /** Browser intent for SNOOZE; the persisted directive calls this expiresAt. */
  readonly snoozeUntil?: string;
};

export type DiscoveryFeedbackProductStateRequestV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryFeedbackProductStateV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly feedbackHistory: readonly DiscoveryFeedbackEventV1[];
  readonly suppressionHistory: readonly DiscoverySuppressionDirectiveV1[];
};

/** Server-derived bridge to the federated Activity root. */
export type DiscoveryProductActivityBindingV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly activityId: string;
  readonly jobId: string;
  readonly runId: string;
  readonly resourceKind: 'DiscoveryJob';
  readonly resourceHref: string;
};

export type DiscoveryProductFindingSummaryV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly projectId: string;
  readonly findingType: DiscoveryFindingType;
  /** Explicitly non-Canonical and non-Fact authority classification. */
  readonly authority: 'DERIVED_INFERENCE';
  readonly generationMethod: DiscoveryGenerationMethod;
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly title: string;
  readonly summary: string;
  readonly rationale: string;
  readonly derivationSummary: string;
  readonly safeSignals: DiscoveryProductSafeSignalsV1;
  readonly governance: DiscoveryProductGovernanceV1;
  readonly freshness: DiscoveryProductFreshnessV1;
  readonly runId: string;
  readonly capabilities: DiscoveryProductCapabilitiesV1;
  readonly activity?: DiscoveryProductActivityBindingV1;
  readonly presentation?: DiscoveryProductFindingPresentationV1;
  readonly createdAt: string;
};

export type DiscoveryProductFindingDetailV1 = DiscoveryProductFindingSummaryV1 & {
  readonly payload: DiscoveryFindingPayloadV1;
  readonly lineage: DiscoveryProductLineageV1;
};

/** AKP-7 WP3 — safe, non-epistemic presentation metadata. */
export const DISCOVERY_PRODUCT_PRESENTATION_REASON_CODES_V1 = [
  'BASE_RANK',
  'UTILITY_USEFUL',
  'UTILITY_NOT_RELEVANT',
  'UTILITY_ALREADY_KNOWN',
  'UTILITY_TOO_FREQUENT',
  'MANDATORY_VISIBILITY_OVERRIDE',
] as const;
export type DiscoveryProductPresentationReasonCodeV1 =
  (typeof DISCOVERY_PRODUCT_PRESENTATION_REASON_CODES_V1)[number];

export const DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1 =
  'discovery-utility-adjustment:v1' as const;
export const DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1 = 'semantic-family:v1' as const;

export type DiscoveryProductFindingPresentationV1 = {
  readonly rank: number;
  readonly reasonCodes: readonly DiscoveryProductPresentationReasonCodeV1[];
};

export type DiscoveryProductPresentationMetadataV1 = {
  readonly algorithmVersion: string;
  readonly policyIdentity: string;
  readonly policyRevision: number;
  readonly policySource: 'PERSISTED' | 'BUILT_IN_FALLBACK';
  readonly utilityAdjustmentVersion: typeof DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1;
  readonly semanticMatcherVersion: typeof DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1;
  readonly evaluationTime: string;
};

export type ListDiscoveryFindingsRequestV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly cursor?: string;
  readonly limit?: number;
  readonly findingTypes?: readonly DiscoveryFindingType[];
  readonly lifecycleStates?: readonly DiscoveryFindingLifecycleState[];
};

export type ListDiscoveryFindingsResultV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly findings: readonly DiscoveryProductFindingSummaryV1[];
  readonly presentation?: DiscoveryProductPresentationMetadataV1;
  readonly nextCursor?: string;
};

export type ReadDiscoveryFindingRequestV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type ReadDiscoveryFindingResultV1 = {
  readonly schemaVersion: FrontendDiscoverySchemaVersion;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly finding: DiscoveryProductFindingDetailV1;
};

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new FrontendContractError('INVALID_REQUEST', `invalid ${path}: ${message}`);
};

const objectValue = (value: unknown, path: string): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be a non-null object');
  }
  return value as ObjectValue;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): ObjectValue => {
  const object = objectValue(value, path);
  const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) return fail(path, `contains unsupported fields: ${unknown.join(', ')}`);
  return object;
};

const required = (object: ObjectValue, key: string, path: string): unknown => {
  if (!Object.hasOwn(object, key) || object[key] === undefined)
    return fail(`${path}.${key}`, 'is required');
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0)
    return fail(path, 'must be non-empty text');
  return value;
};

const optionalText = (value: unknown, path: string, maxLength?: number): string | undefined => {
  if (value === undefined) return undefined;
  const result = text(value, path);
  if (maxLength !== undefined && result.trim().length > maxLength) {
    return fail(path, `must be at most ${maxLength} characters`);
  }
  return result;
};

const integer = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    return fail(path, 'must be a safe integer');
  return value;
};

const positiveInteger = (value: unknown, path: string): number => {
  const number = integer(value, path);
  if (number <= 0) return fail(path, 'must be positive');
  return number;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T))
    return fail(path, `must be one of ${values.join(', ')}`);
  return value as T;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) return fail(path, 'must be an ISO timestamp');
  return result;
};

const schemaVersion = (object: ObjectValue, path: string): FrontendDiscoverySchemaVersion =>
  enumValue(
    required(object, 'schemaVersion', path),
    [FRONTEND_DISCOVERY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );

const boundedNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return fail(path, 'must be a finite number between 0 and 1');
  }
  return value;
};

const safeSignals = (value: unknown, path: string): DiscoveryProductSafeSignalsV1 => {
  const object = strictObject(
    value,
    [
      'graphDistance',
      'graphTopology',
      'temporalOverlap',
      'temporalChange',
      'evidenceCoverage',
      'conflictState',
      'novelty',
    ],
    path,
  );
  const graphDistance =
    object.graphDistance === undefined
      ? undefined
      : integer(object.graphDistance, `${path}.graphDistance`);
  if (graphDistance !== undefined && graphDistance < 0)
    return fail(`${path}.graphDistance`, 'must be non-negative');
  const graphTopology =
    object.graphTopology === undefined
      ? undefined
      : enumValue(
          object.graphTopology,
          ['ISOLATED', 'CONNECTED', 'HUB', 'COMMUNITY'],
          `${path}.graphTopology`,
        );
  const temporalOverlap =
    object.temporalOverlap === undefined
      ? undefined
      : boundedNumber(object.temporalOverlap, `${path}.temporalOverlap`);
  const temporalChange =
    object.temporalChange === undefined
      ? undefined
      : enumValue(
          object.temporalChange,
          ['NONE', 'EMERGING', 'SHIFTING', 'ENDED'],
          `${path}.temporalChange`,
        );
  const evidenceCoverage =
    object.evidenceCoverage === undefined
      ? undefined
      : boundedNumber(object.evidenceCoverage, `${path}.evidenceCoverage`);
  const conflictState =
    object.conflictState === undefined
      ? undefined
      : enumValue(
          object.conflictState,
          ['NONE', 'KNOWN_CONFLICT', 'POSSIBLE_CONFLICT'],
          `${path}.conflictState`,
        );
  const novelty =
    object.novelty === undefined ? undefined : boundedNumber(object.novelty, `${path}.novelty`);
  return {
    ...(graphDistance === undefined ? {} : { graphDistance }),
    ...(graphTopology === undefined ? {} : { graphTopology }),
    ...(temporalOverlap === undefined ? {} : { temporalOverlap }),
    ...(temporalChange === undefined ? {} : { temporalChange }),
    ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }),
    ...(conflictState === undefined ? {} : { conflictState }),
    ...(novelty === undefined ? {} : { novelty }),
  };
};

const decodeProvenance = (value: unknown, path: string): DiscoveryProductProvenanceV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'kind', 'ruleId', 'ruleVersion', 'inputDigest'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    kind: enumValue(required(object, 'kind', path), DISCOVERY_GENERATION_METHODS, `${path}.kind`),
    ...(object.ruleId === undefined ? {} : { ruleId: text(object.ruleId, `${path}.ruleId`) }),
    ...(object.ruleVersion === undefined
      ? {}
      : { ruleVersion: text(object.ruleVersion, `${path}.ruleVersion`) }),
    ...(object.inputDigest === undefined
      ? {}
      : { inputDigest: text(object.inputDigest, `${path}.inputDigest`) }),
  };
};

const decodeBase = (value: unknown, path: string) => {
  const object = strictObject(value, ['schemaVersion', 'canonicalVersion', 'snapshotDigest'], path);
  schemaVersion(object, path);
  return {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: integer(
      required(object, 'canonicalVersion', path),
      `${path}.canonicalVersion`,
    ),
    snapshotDigest: text(required(object, 'snapshotDigest', path), `${path}.snapshotDigest`),
  };
};

const decodeDiscoveryBase = (value: unknown, path: string) => {
  const object = strictObject(
    value,
    ['schemaVersion', 'projectionRevision', 'projectionDigest'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: '1.0.0' as const,
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    projectionDigest: text(required(object, 'projectionDigest', path), `${path}.projectionDigest`),
  };
};

const decodeEvidence = (value: unknown, path: string): DiscoveryProductEvidenceReferenceV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'evidenceId', 'evidenceRevisionId', 'sourceId', 'sourceVersionId'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    evidenceId: text(required(object, 'evidenceId', path), `${path}.evidenceId`),
    evidenceRevisionId: text(
      required(object, 'evidenceRevisionId', path),
      `${path}.evidenceRevisionId`,
    ),
    sourceId: text(required(object, 'sourceId', path), `${path}.sourceId`),
    sourceVersionId: text(required(object, 'sourceVersionId', path), `${path}.sourceVersionId`),
  };
};

const decodeLineage = (value: unknown, path: string): DiscoveryProductLineageV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'relatedResourceRefs',
      'evidence',
      'sourceProjectionDigest',
      'canonicalBase',
      'discoveryBase',
      'provenance',
    ],
    path,
  );
  schemaVersion(object, path);
  const refs = required(object, 'relatedResourceRefs', path);
  if (!Array.isArray(refs)) return fail(`${path}.relatedResourceRefs`, 'must be an array');
  const evidence = required(object, 'evidence', path);
  if (!Array.isArray(evidence)) return fail(`${path}.evidence`, 'must be an array');
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    relatedResourceRefs: refs.map((entry, index) => {
      try {
        return decodeDiscoveryResourceRefV1(entry, `${path}.relatedResourceRefs[${index}]`);
      } catch (error) {
        return fail(
          `${path}.relatedResourceRefs[${index}]`,
          error instanceof Error ? error.message : 'is invalid',
        );
      }
    }),
    evidence: evidence.map((entry, index) => decodeEvidence(entry, `${path}.evidence[${index}]`)),
    sourceProjectionDigest: text(
      required(object, 'sourceProjectionDigest', path),
      `${path}.sourceProjectionDigest`,
    ),
    canonicalBase: decodeBase(required(object, 'canonicalBase', path), `${path}.canonicalBase`),
    discoveryBase: decodeDiscoveryBase(
      required(object, 'discoveryBase', path),
      `${path}.discoveryBase`,
    ),
    provenance: decodeProvenance(required(object, 'provenance', path), `${path}.provenance`),
  };
};

const decodeGovernance = (value: unknown, path: string): DiscoveryProductGovernanceV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'reentryState', 'validationState', 'reviewReadiness', 'reviewResourceId'],
    path,
  );
  schemaVersion(object, path);
  const reviewResourceId = optionalText(object.reviewResourceId, `${path}.reviewResourceId`);
  const reviewReadiness = enumValue(
    required(object, 'reviewReadiness', path),
    ['NOT_ELIGIBLE', 'ELIGIBLE_AFTER_VALIDATION'],
    `${path}.reviewReadiness`,
  );
  if (reviewReadiness === 'NOT_ELIGIBLE' && reviewResourceId !== undefined)
    return fail(path, 'reviewResourceId requires eligible review readiness');
  if (reviewReadiness === 'ELIGIBLE_AFTER_VALIDATION' && reviewResourceId === undefined)
    return fail(path, 'eligible review readiness requires reviewResourceId');
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    reentryState: enumValue(
      required(object, 'reentryState', path),
      ['NOT_REQUESTED', 'PROCESSED', 'INELIGIBLE', 'BLOCKED_NON_RETRYABLE', 'RETRYABLE'],
      `${path}.reentryState`,
    ),
    validationState: enumValue(
      required(object, 'validationState', path),
      ['NOT_STARTED', 'VALIDATING', 'VALIDATED', 'UNKNOWN'],
      `${path}.validationState`,
    ),
    reviewReadiness,
    ...(reviewResourceId === undefined ? {} : { reviewResourceId }),
  };
};

const decodeFreshness = (value: unknown, path: string): DiscoveryProductFreshnessV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'state', 'canonicalBase', 'discoveryBase'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    state: enumValue(
      required(object, 'state', path),
      ['CURRENT', 'REVALIDATION_REQUIRED', 'UNKNOWN'],
      `${path}.state`,
    ),
    canonicalBase: decodeBase(required(object, 'canonicalBase', path), `${path}.canonicalBase`),
    discoveryBase: decodeDiscoveryBase(
      required(object, 'discoveryBase', path),
      `${path}.discoveryBase`,
    ),
  };
};

const decodeCapabilities = (value: unknown, path: string): DiscoveryProductCapabilitiesV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'canOpenReview',
      'canInspectEvidence',
      'canOpenGraph',
      'canOpenActivity',
      'canInvestigate',
      'canDismiss',
    ],
    path,
  );
  schemaVersion(object, path);
  const boolean = (key: string): boolean => {
    const result = required(object, key, path);
    if (typeof result !== 'boolean') return fail(`${path}.${key}`, 'must be a boolean');
    return result;
  };
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    canOpenReview: boolean('canOpenReview'),
    canInspectEvidence: boolean('canInspectEvidence'),
    canOpenGraph: boolean('canOpenGraph'),
    canOpenActivity: boolean('canOpenActivity'),
    canInvestigate: boolean('canInvestigate'),
    canDismiss: boolean('canDismiss'),
  };
};

export const decodeDiscoveryDismissFindingCommandRequestV1 = (
  value: unknown,
  path = 'dismissDiscoveryFindingCommand',
): DiscoveryDismissFindingCommandRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'findingId', 'findingRevision'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
  };
};

const decodeFeedbackKind = (value: unknown, path: string): DiscoveryFeedbackKindV1 => {
  const values = [
    ...DISCOVERY_EPISTEMIC_FEEDBACK_KINDS,
    ...DISCOVERY_UTILITY_FEEDBACK_KINDS,
  ] as const;
  if (typeof value !== 'string' || !values.includes(value as (typeof values)[number])) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as DiscoveryFeedbackKindV1;
};

/**
 * Decodes the intentionally smaller browser command surface. In particular,
 * Project, principal, actor, Finding fingerprint, matcher and audit fields
 * are not accepted from the browser.
 */
export const decodeDiscoveryFeedbackProductCommandRequestV1 = (
  value: unknown,
  path = 'discoveryFeedbackProductCommand',
  now = Date.now(),
): DiscoveryFeedbackProductCommandRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'findingId',
      'findingRevision',
      'feedbackClass',
      'feedbackKind',
      'reason',
      'scope',
      'snoozeUntil',
    ],
    path,
  );
  schemaVersion(object, path);
  const feedbackClass = enumValue(
    required(object, 'feedbackClass', path),
    DISCOVERY_FEEDBACK_CLASSES,
    `${path}.feedbackClass`,
  );
  const feedbackKind = decodeFeedbackKind(
    required(object, 'feedbackKind', path),
    `${path}.feedbackKind`,
  );
  const isEpistemic = (DISCOVERY_EPISTEMIC_FEEDBACK_KINDS as readonly string[]).includes(
    feedbackKind,
  );
  if ((feedbackClass === 'EPISTEMIC') !== isEpistemic) {
    return fail(`${path}.feedbackClass`, 'feedbackClass and feedbackKind are incompatible');
  }
  const snoozeUntil =
    object.snoozeUntil === undefined
      ? undefined
      : isoTimestamp(object.snoozeUntil, `${path}.snoozeUntil`);
  if (feedbackKind === 'SNOOZE') {
    if (snoozeUntil === undefined) return fail(`${path}.snoozeUntil`, 'is required for SNOOZE');
    if (Date.parse(snoozeUntil) <= now) {
      return fail(`${path}.snoozeUntil`, 'must be in the future');
    }
  } else if (snoozeUntil !== undefined) {
    return fail(`${path}.snoozeUntil`, 'is only allowed for SNOOZE');
  }
  const scope =
    object.scope === undefined
      ? undefined
      : enumValue(object.scope, DISCOVERY_FEEDBACK_SCOPE_KINDS, `${path}.scope`);
  const reason = optionalText(object.reason, `${path}.reason`, 500);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    feedbackClass,
    feedbackKind,
    ...(reason === undefined ? {} : { reason }),
    ...(scope === undefined ? {} : { scope }),
    ...(snoozeUntil === undefined ? {} : { snoozeUntil }),
  };
};

export const decodeDiscoveryFeedbackProductStateRequestV1 = (
  value: unknown,
  path = 'discoveryFeedbackProductStateRequest',
): DiscoveryFeedbackProductStateRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'findingId', 'findingRevision'], path);
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
  };
};

export const decodeDiscoveryFeedbackProductStateV1 = (
  value: unknown,
  path = 'discoveryFeedbackProductState',
): DiscoveryFeedbackProductStateV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'findingId',
      'findingRevision',
      'feedbackHistory',
      'suppressionHistory',
    ],
    path,
  );
  schemaVersion(object, path);
  const feedbackHistory = required(object, 'feedbackHistory', path);
  const suppressionHistory = required(object, 'suppressionHistory', path);
  if (!Array.isArray(feedbackHistory)) return fail(`${path}.feedbackHistory`, 'must be an array');
  if (!Array.isArray(suppressionHistory)) {
    return fail(`${path}.suppressionHistory`, 'must be an array');
  }
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    feedbackHistory: feedbackHistory.map((entry) => decodeDiscoveryFeedbackEventV1(entry)),
    suppressionHistory: suppressionHistory.map((entry) =>
      decodeDiscoverySuppressionDirectiveV1(entry),
    ),
  };
};

const decodeActivityBinding = (value: unknown, path: string): DiscoveryProductActivityBindingV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'activityId', 'jobId', 'runId', 'resourceKind', 'resourceHref'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    activityId: text(required(object, 'activityId', path), `${path}.activityId`),
    jobId: text(required(object, 'jobId', path), `${path}.jobId`),
    runId: text(required(object, 'runId', path), `${path}.runId`),
    resourceKind: enumValue(
      required(object, 'resourceKind', path),
      ['DiscoveryJob'],
      `${path}.resourceKind`,
    ),
    resourceHref: text(required(object, 'resourceHref', path), `${path}.resourceHref`),
  };
};

const decodeSummary = (value: unknown, path: string): DiscoveryProductFindingSummaryV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'findingId',
      'findingRevision',
      'projectId',
      'findingType',
      'authority',
      'generationMethod',
      'lifecycleState',
      'title',
      'summary',
      'rationale',
      'derivationSummary',
      'safeSignals',
      'governance',
      'freshness',
      'runId',
      'capabilities',
      'activity',
      'presentation',
      'createdAt',
    ],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    findingType: enumValue(
      required(object, 'findingType', path),
      DISCOVERY_FINDING_TYPES,
      `${path}.findingType`,
    ),
    authority: enumValue(
      required(object, 'authority', path),
      ['DERIVED_INFERENCE'],
      `${path}.authority`,
    ),
    generationMethod: enumValue(
      required(object, 'generationMethod', path),
      DISCOVERY_GENERATION_METHODS,
      `${path}.generationMethod`,
    ),
    lifecycleState: enumValue(
      required(object, 'lifecycleState', path),
      DISCOVERY_FINDING_LIFECYCLE_STATES,
      `${path}.lifecycleState`,
    ),
    title: text(required(object, 'title', path), `${path}.title`),
    summary: text(required(object, 'summary', path), `${path}.summary`),
    rationale: text(required(object, 'rationale', path), `${path}.rationale`),
    derivationSummary: text(
      required(object, 'derivationSummary', path),
      `${path}.derivationSummary`,
    ),
    safeSignals: safeSignals(required(object, 'safeSignals', path), `${path}.safeSignals`),
    governance: decodeGovernance(required(object, 'governance', path), `${path}.governance`),
    freshness: decodeFreshness(required(object, 'freshness', path), `${path}.freshness`),
    runId: text(required(object, 'runId', path), `${path}.runId`),
    capabilities: decodeCapabilities(
      required(object, 'capabilities', path),
      `${path}.capabilities`,
    ),
    ...(object.activity === undefined
      ? {}
      : { activity: decodeActivityBinding(object.activity, `${path}.activity`) }),
    ...(object.presentation === undefined
      ? {}
      : { presentation: decodePresentation(object.presentation, `${path}.presentation`) }),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
  };
};

const decodePresentation = (
  value: unknown,
  path: string,
): DiscoveryProductFindingPresentationV1 => {
  const object = strictObject(value, ['rank', 'reasonCodes'], path);
  const rank = positiveInteger(required(object, 'rank', path), `${path}.rank`);
  const reasonCodes = required(object, 'reasonCodes', path);
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    return fail(`${path}.reasonCodes`, 'must be a non-empty array');
  }
  const decoded = reasonCodes.map((entry, index) =>
    enumValue(
      entry,
      DISCOVERY_PRODUCT_PRESENTATION_REASON_CODES_V1,
      `${path}.reasonCodes[${index}]`,
    ),
  );
  if (new Set(decoded).size !== decoded.length) {
    return fail(`${path}.reasonCodes`, 'must not contain duplicates');
  }
  return { rank, reasonCodes: decoded };
};

const decodePresentationMetadata = (
  value: unknown,
  path: string,
): DiscoveryProductPresentationMetadataV1 => {
  const object = strictObject(
    value,
    [
      'algorithmVersion',
      'policyIdentity',
      'policyRevision',
      'policySource',
      'utilityAdjustmentVersion',
      'semanticMatcherVersion',
      'evaluationTime',
    ],
    path,
  );
  const utilityAdjustmentVersion = enumValue(
    required(object, 'utilityAdjustmentVersion', path),
    [DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1],
    `${path}.utilityAdjustmentVersion`,
  );
  const semanticMatcherVersion = enumValue(
    required(object, 'semanticMatcherVersion', path),
    [DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1],
    `${path}.semanticMatcherVersion`,
  );
  return {
    algorithmVersion: text(required(object, 'algorithmVersion', path), `${path}.algorithmVersion`),
    policyIdentity: text(required(object, 'policyIdentity', path), `${path}.policyIdentity`),
    policyRevision: positiveInteger(
      required(object, 'policyRevision', path),
      `${path}.policyRevision`,
    ),
    policySource: enumValue(
      required(object, 'policySource', path),
      ['PERSISTED', 'BUILT_IN_FALLBACK'],
      `${path}.policySource`,
    ),
    utilityAdjustmentVersion,
    semanticMatcherVersion,
    evaluationTime: isoTimestamp(
      required(object, 'evaluationTime', path),
      `${path}.evaluationTime`,
    ),
  };
};

export const decodeListDiscoveryFindingsRequestV1 = (
  value: unknown,
  path = 'listDiscoveryFindingsRequest',
): ListDiscoveryFindingsRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'cursor', 'limit', 'findingTypes', 'lifecycleStates'],
    path,
  );
  schemaVersion(object, path);
  const cursor = optionalText(object.cursor, `${path}.cursor`);
  const limit = object.limit === undefined ? undefined : integer(object.limit, `${path}.limit`);
  if (limit !== undefined && (limit < 1 || limit > 100))
    return fail(`${path}.limit`, 'must be between 1 and 100');
  const decodeEnumArray = <T extends string>(
    key: string,
    values: readonly T[],
  ): readonly T[] | undefined => {
    const raw = object[key];
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.length === 0)
      return fail(`${path}.${key}`, 'must be a non-empty array');
    const result = raw.map((entry, index) => enumValue(entry, values, `${path}.${key}[${index}]`));
    if (new Set(result).size !== result.length)
      return fail(`${path}.${key}`, 'must not contain duplicates');
    return result;
  };
  const findingTypes = decodeEnumArray('findingTypes', DISCOVERY_FINDING_TYPES);
  const lifecycleStates = decodeEnumArray('lifecycleStates', DISCOVERY_FINDING_LIFECYCLE_STATES);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
    ...(findingTypes === undefined
      ? {}
      : { findingTypes: findingTypes as readonly DiscoveryFindingType[] }),
    ...(lifecycleStates === undefined
      ? {}
      : { lifecycleStates: lifecycleStates as readonly DiscoveryFindingLifecycleState[] }),
  };
};

export const decodeReadDiscoveryFindingRequestV1 = (
  value: unknown,
  path = 'readDiscoveryFindingRequest',
): ReadDiscoveryFindingRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'findingId', 'findingRevision'], path);
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
  };
};

export const decodeDiscoveryProductFindingSummaryV1 = (
  value: unknown,
  path = 'finding',
): DiscoveryProductFindingSummaryV1 => decodeSummary(value, path);

export const decodeDiscoveryProductFindingDetailV1 = (
  value: unknown,
  path = 'finding',
): DiscoveryProductFindingDetailV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'findingId',
      'findingRevision',
      'projectId',
      'findingType',
      'authority',
      'generationMethod',
      'lifecycleState',
      'title',
      'summary',
      'rationale',
      'derivationSummary',
      'safeSignals',
      'governance',
      'freshness',
      'runId',
      'capabilities',
      'activity',
      'createdAt',
      'payload',
      'lineage',
    ],
    path,
  );
  const summary = decodeSummary(
    Object.fromEntries(
      Object.entries(object).filter(([key]) => key !== 'payload' && key !== 'lineage'),
    ),
    path,
  );
  let payload: DiscoveryFindingPayloadV1;
  try {
    payload = decodeDiscoveryFindingPayloadV1(
      objectField(object, 'payload', path),
      summary.findingType,
      `${path}.payload`,
    );
  } catch (error) {
    return fail(`${path}.payload`, error instanceof Error ? error.message : 'is invalid');
  }
  return {
    ...summary,
    payload,
    lineage: decodeLineage(required(object, 'lineage', path), `${path}.lineage`),
  };
};

const objectField = (object: ObjectValue, key: string, path: string): unknown =>
  required(object, key, path);

export const decodeListDiscoveryFindingsResultV1 = (
  value: unknown,
  path = 'listDiscoveryFindingsResult',
): ListDiscoveryFindingsResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'findings',
      'presentation',
      'nextCursor',
    ],
    path,
  );
  schemaVersion(object, path);
  const findings = required(object, 'findings', path);
  if (!Array.isArray(findings)) return fail(`${path}.findings`, 'must be an array');
  const nextCursor = optionalText(object.nextCursor, `${path}.nextCursor`);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    findings: findings.map((entry, index) => decodeSummary(entry, `${path}.findings[${index}]`)),
    ...(object.presentation === undefined
      ? {}
      : { presentation: decodePresentationMetadata(object.presentation, `${path}.presentation`) }),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
};

export const decodeReadDiscoveryFindingResultV1 = (
  value: unknown,
  path = 'readDiscoveryFindingResult',
): ReadDiscoveryFindingResultV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'projectId', 'accessRevision', 'policyContextRevision', 'finding'],
    path,
  );
  schemaVersion(object, path);
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    finding: decodeDiscoveryProductFindingDetailV1(
      required(object, 'finding', path),
      `${path}.finding`,
    ),
  };
};

export type DiscoveryProductSensitivityV1 = SecurityContext['sensitivity'];
