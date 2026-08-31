import { sha256Text } from './document-evidence.js';
import { semanticStableJson, utf16OrdinalCompare } from './semantic-representation.js';
import type { Actor } from './types.js';

export const DISCOVERY_FEEDBACK_SCHEMA_VERSION = '1.0.0' as const;

export const DISCOVERY_FEEDBACK_CLASSES = ['EPISTEMIC', 'UTILITY'] as const;
export type DiscoveryFeedbackClassV1 = (typeof DISCOVERY_FEEDBACK_CLASSES)[number];

export const DISCOVERY_EPISTEMIC_FEEDBACK_KINDS = [
  'INCORRECT_RELATION',
  'INSUFFICIENT_EVIDENCE',
  'WRONG_ENTITY',
  'TEMPORAL_ERROR',
  'MISLEADING_PATTERN',
  'MISIDENTIFIED_CONFLICT',
] as const;
export type DiscoveryEpistemicFeedbackKindV1 = (typeof DISCOVERY_EPISTEMIC_FEEDBACK_KINDS)[number];

export const DISCOVERY_EPISTEMIC_VALIDATION_FOCUS_BY_KIND = {
  INCORRECT_RELATION: 'RELATION_CORRECTNESS',
  INSUFFICIENT_EVIDENCE: 'EVIDENCE_SUFFICIENCY',
  WRONG_ENTITY: 'ENTITY_IDENTITY',
  TEMPORAL_ERROR: 'TEMPORAL_VALIDITY',
  MISLEADING_PATTERN: 'PATTERN_VALIDITY',
  MISIDENTIFIED_CONFLICT: 'CONFLICT_CLASSIFICATION',
} as const satisfies Record<DiscoveryEpistemicFeedbackKindV1, string>;
export type DiscoveryEpistemicValidationFocusV1 =
  (typeof DISCOVERY_EPISTEMIC_VALIDATION_FOCUS_BY_KIND)[DiscoveryEpistemicFeedbackKindV1];
export const DISCOVERY_EPISTEMIC_VALIDATION_FOCUS_VERSION =
  'discovery-epistemic-validation-focus:v1' as const;
export const DISCOVERY_EPISTEMIC_CHALLENGE_REASON_KIND = 'NON_EVIDENCE_USER_CHALLENGE' as const;

export const DISCOVERY_UTILITY_FEEDBACK_KINDS = [
  'USEFUL',
  'NOT_RELEVANT',
  'ALREADY_KNOWN',
  'TOO_FREQUENT',
  'SNOOZE',
  'SUPPRESS_EXACT',
  'SUPPRESS_SIMILAR',
] as const;
export type DiscoveryUtilityFeedbackKindV1 = (typeof DISCOVERY_UTILITY_FEEDBACK_KINDS)[number];

export type DiscoveryFeedbackKindV1 =
  DiscoveryEpistemicFeedbackKindV1 | DiscoveryUtilityFeedbackKindV1;

export const DISCOVERY_FEEDBACK_SCOPE_KINDS = ['FINDING', 'PROJECT'] as const;
export type DiscoveryFeedbackScopeV1 = (typeof DISCOVERY_FEEDBACK_SCOPE_KINDS)[number];

export type DiscoveryFeedbackActorV1 = Actor;

export type DiscoveryFeedbackEventV1 = {
  readonly schemaVersion: typeof DISCOVERY_FEEDBACK_SCHEMA_VERSION;
  readonly feedbackId: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly actor: DiscoveryFeedbackActorV1;
  /** Optional server-bound principal identity, following BaseEnvelope conventions. */
  readonly principalId?: string;
  readonly feedbackClass: DiscoveryFeedbackClassV1;
  readonly feedbackKind: DiscoveryFeedbackKindV1;
  /** Short user rationale or machine-readable reason; raw prompts are not part of this contract. */
  readonly reason?: string;
  readonly scope?: DiscoveryFeedbackScopeV1;
  readonly createdAt: string;
};

/**
 * The durable, server-owned hand-off from an accepted EPISTEMIC event to the
 * Discovery re-entry consumer. This payload deliberately excludes the raw
 * rationale and every Evidence/Fact/Claim/Canonical field.
 */
export const DISCOVERY_EPISTEMIC_REENTRY_TRIGGER_SCHEMA_VERSION = '1.0.0' as const;
export const DISCOVERY_EPISTEMIC_REENTRY_IDENTITY_VERSION =
  'discovery-epistemic-reentry-identity:v1' as const;

export type DiscoveryEpistemicReentryTriggerV1 = {
  readonly schemaVersion: typeof DISCOVERY_EPISTEMIC_REENTRY_TRIGGER_SCHEMA_VERSION;
  readonly feedbackId: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly feedbackClass: 'EPISTEMIC';
  readonly feedbackKind: DiscoveryEpistemicFeedbackKindV1;
  readonly occurredAt: string;
};

export type DiscoveryEpistemicReentryIdentityInputV1 = Pick<
  DiscoveryEpistemicReentryTriggerV1,
  'projectId' | 'feedbackId' | 'findingId' | 'findingRevision'
>;

export type DiscoveryEpistemicReentryIdentityV1 = DiscoveryEpistemicReentryIdentityInputV1 & {
  readonly identityVersion: typeof DISCOVERY_EPISTEMIC_REENTRY_IDENTITY_VERSION;
};

export type DiscoveryEpistemicReentryIdentityResultV1 = {
  readonly identityVersion: typeof DISCOVERY_EPISTEMIC_REENTRY_IDENTITY_VERSION;
  readonly logicalIdentityKey: string;
  readonly idempotencyKey: string;
  readonly normalizedInput: DiscoveryEpistemicReentryIdentityV1;
};

export const DISCOVERY_SUPPRESSION_KINDS = [
  'SUPPRESS_EXACT',
  'SUPPRESS_SIMILAR',
  'SNOOZE',
] as const;
export type DiscoverySuppressionKindV1 = (typeof DISCOVERY_SUPPRESSION_KINDS)[number];

export const DISCOVERY_SUPPRESSION_MATCHER_KINDS = [
  'NONE',
  'EXACT_FINGERPRINT',
  'SEMANTIC_FAMILY',
] as const;
export type DiscoverySuppressionMatcherKindV1 =
  (typeof DISCOVERY_SUPPRESSION_MATCHER_KINDS)[number];

export type DiscoverySuppressionDirectiveV1 = {
  readonly schemaVersion: typeof DISCOVERY_FEEDBACK_SCHEMA_VERSION;
  readonly suppressionId: string;
  readonly projectId: string;
  readonly actor: DiscoveryFeedbackActorV1;
  /** Optional server-bound principal identity, following BaseEnvelope conventions. */
  readonly principalId?: string;
  readonly sourceFindingId: string;
  readonly sourceFindingRevision: number;
  readonly suppressionKind: DiscoverySuppressionKindV1;
  readonly scope: DiscoveryFeedbackScopeV1;
  readonly matcherKind: DiscoverySuppressionMatcherKindV1;
  readonly matcherVersion?: string;
  readonly fingerprint?: string;
  readonly fingerprintVersion?: string;
  /** SNOOZE requires expiry; suppression directives may also be reviewed later. */
  readonly expiresAt?: string;
  readonly reviewAt?: string;
  readonly createdAt: string;
};

/** The only ranking dimensions owned by the AKP-3 deterministic authority. */
export type DiscoveryRankingDimensionsV1 = {
  readonly novelty: number;
  readonly projectRelevance: number;
  readonly evidenceCoverage: number;
  readonly impactReach: number;
  readonly temporalUrgency: number;
  readonly redundancyPenalty: number;
  readonly costRiskPenalty: number;
};

export const DISCOVERY_RANKING_POLICY_VERSION_V1 = 'discovery-ranking-policy:v1' as const;
export const DISCOVERY_RANKING_POLICY_SCOPE_V1 = 'GLOBAL' as const;

/**
 * Current AKP-3 policy shape. It remains the input to the existing ranking
 * function; AKP-7 only adds a durable revision envelope around it.
 */
export type DiscoveryRankingPolicyV1 = {
  readonly version: typeof DISCOVERY_RANKING_POLICY_VERSION_V1;
  readonly weights: DiscoveryRankingDimensionsV1;
};

export type DiscoveryRankingPolicyRevisionV1 = {
  readonly schemaVersion: typeof DISCOVERY_FEEDBACK_SCHEMA_VERSION;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly scope: typeof DISCOVERY_RANKING_POLICY_SCOPE_V1;
  readonly algorithmVersion: typeof DISCOVERY_RANKING_POLICY_VERSION_V1;
  /** Inspectable, versioned rule labels; no truth/confidence meaning is implied. */
  readonly rules: readonly string[];
  readonly weights: DiscoveryRankingDimensionsV1;
  readonly createdBy: DiscoveryFeedbackActorV1;
  readonly createdAt: string;
  readonly effectiveFrom: string;
};

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};

const objectValue = (value: unknown, path: string): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be an object');
  }
  return value as ObjectValue;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): ObjectValue => {
  const object = objectValue(value, path);
  const unknownKeys = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    return fail(path, `contains unknown field(s): ${unknownKeys.join(', ')}`);
  }
  return object;
};

const required = (object: ObjectValue, key: string, path: string): unknown => {
  if (!Object.hasOwn(object, key) || object[key] === undefined) {
    return fail(`${path}.${key}`, 'is required');
  }
  return object[key];
};

const text = (value: unknown, path: string, maxLength?: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(path, 'must be a non-empty string');
  }
  const normalized = value.trim();
  if (maxLength !== undefined && normalized.length > maxLength) {
    return fail(path, `must be at most ${maxLength} characters`);
  }
  return normalized;
};

const optionalText = (value: unknown, path: string, maxLength?: number): string | undefined =>
  value === undefined ? undefined : text(value, path, maxLength);

const positiveInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return fail(path, 'must be a positive integer');
  }
  return value as number;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const isoDate = (value: unknown, path: string): string => {
  const normalized = text(value, path);
  if (Number.isNaN(Date.parse(normalized))) return fail(path, 'must be a valid date-time');
  return normalized;
};

const optionalIsoDate = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : isoDate(value, path);

const decodeActor = (value: unknown, path: string): DiscoveryFeedbackActorV1 => {
  const object = strictObject(value, ['type', 'id'], path);
  return {
    type: enumValue(required(object, 'type', path), ['user', 'service', 'system'], `${path}.type`),
    id: text(required(object, 'id', path), `${path}.id`),
  };
};

const decodeRankingDimensions = (value: unknown, path: string): DiscoveryRankingDimensionsV1 => {
  const object = strictObject(
    value,
    [
      'novelty',
      'projectRelevance',
      'evidenceCoverage',
      'impactReach',
      'temporalUrgency',
      'redundancyPenalty',
      'costRiskPenalty',
    ],
    path,
  );
  const read = (key: keyof DiscoveryRankingDimensionsV1): number => {
    const numberValue = required(object, key, path);
    if (
      typeof numberValue !== 'number' ||
      !Number.isFinite(numberValue) ||
      numberValue < 0 ||
      numberValue > 1
    ) {
      return fail(`${path}.${key}`, 'must be a finite number within 0..1');
    }
    return numberValue;
  };
  return {
    novelty: read('novelty'),
    projectRelevance: read('projectRelevance'),
    evidenceCoverage: read('evidenceCoverage'),
    impactReach: read('impactReach'),
    temporalUrgency: read('temporalUrgency'),
    redundancyPenalty: read('redundancyPenalty'),
    costRiskPenalty: read('costRiskPenalty'),
  };
};

const decodeRules = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) return fail(path, 'must be a non-empty array');
  const rules = value.map((entry, index) => text(entry, `${path}[${index}]`, 120));
  if (new Set(rules).size !== rules.length) return fail(path, 'must not contain duplicates');
  return [...rules].sort(utf16OrdinalCompare);
};

export const decodeDiscoveryFeedbackEventV1 = (value: unknown): DiscoveryFeedbackEventV1 => {
  const path = 'feedback';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'feedbackId',
      'projectId',
      'findingId',
      'findingRevision',
      'actor',
      'principalId',
      'feedbackClass',
      'feedbackKind',
      'reason',
      'scope',
      'createdAt',
    ],
    path,
  );
  const feedbackClass = enumValue(
    required(object, 'feedbackClass', path),
    DISCOVERY_FEEDBACK_CLASSES,
    `${path}.feedbackClass`,
  );
  const feedbackKind = enumValue(
    required(object, 'feedbackKind', path),
    [...DISCOVERY_EPISTEMIC_FEEDBACK_KINDS, ...DISCOVERY_UTILITY_FEEDBACK_KINDS],
    `${path}.feedbackKind`,
  );
  const epistemic = (DISCOVERY_EPISTEMIC_FEEDBACK_KINDS as readonly string[]).includes(
    feedbackKind,
  );
  if ((feedbackClass === 'EPISTEMIC') !== epistemic) {
    return fail(path, 'feedbackClass and feedbackKind are incompatible');
  }
  const reason = optionalText(object.reason, `${path}.reason`, 500);
  const scope =
    object.scope === undefined
      ? undefined
      : enumValue(object.scope, DISCOVERY_FEEDBACK_SCOPE_KINDS, `${path}.scope`);
  return {
    schemaVersion: enumValue(
      required(object, 'schemaVersion', path),
      [DISCOVERY_FEEDBACK_SCHEMA_VERSION],
      `${path}.schemaVersion`,
    ),
    feedbackId: text(required(object, 'feedbackId', path), `${path}.feedbackId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    actor: decodeActor(required(object, 'actor', path), `${path}.actor`),
    ...(object.principalId === undefined
      ? {}
      : { principalId: text(object.principalId, `${path}.principalId`) }),
    feedbackClass,
    feedbackKind,
    ...(reason === undefined ? {} : { reason }),
    ...(scope === undefined ? {} : { scope }),
    createdAt: isoDate(required(object, 'createdAt', path), `${path}.createdAt`),
  };
};

export const decodeDiscoveryEpistemicReentryTriggerV1 = (
  value: unknown,
): DiscoveryEpistemicReentryTriggerV1 => {
  const path = 'discoveryEpistemicReentryTrigger';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'feedbackId',
      'projectId',
      'findingId',
      'findingRevision',
      'feedbackClass',
      'feedbackKind',
      'occurredAt',
    ],
    path,
  );
  const feedbackClass = enumValue(
    required(object, 'feedbackClass', path),
    ['EPISTEMIC'] as const,
    `${path}.feedbackClass`,
  );
  return {
    schemaVersion: enumValue(
      required(object, 'schemaVersion', path),
      [DISCOVERY_EPISTEMIC_REENTRY_TRIGGER_SCHEMA_VERSION],
      `${path}.schemaVersion`,
    ),
    feedbackId: text(required(object, 'feedbackId', path), `${path}.feedbackId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    feedbackClass,
    feedbackKind: enumValue(
      required(object, 'feedbackKind', path),
      DISCOVERY_EPISTEMIC_FEEDBACK_KINDS,
      `${path}.feedbackKind`,
    ),
    occurredAt: isoDate(required(object, 'occurredAt', path), `${path}.occurredAt`),
  };
};

export const computeDiscoveryEpistemicReentryIdentityV1 = (
  input: DiscoveryEpistemicReentryIdentityInputV1,
): DiscoveryEpistemicReentryIdentityResultV1 => {
  const normalizedInput: DiscoveryEpistemicReentryIdentityV1 = {
    identityVersion: DISCOVERY_EPISTEMIC_REENTRY_IDENTITY_VERSION,
    projectId: text(input.projectId, 'projectId'),
    feedbackId: text(input.feedbackId, 'feedbackId'),
    findingId: text(input.findingId, 'findingId'),
    findingRevision: positiveInteger(input.findingRevision, 'findingRevision'),
  };
  const logicalIdentityKey = sha256Text(semanticStableJson(normalizedInput));
  return {
    identityVersion: DISCOVERY_EPISTEMIC_REENTRY_IDENTITY_VERSION,
    logicalIdentityKey,
    idempotencyKey: logicalIdentityKey,
    normalizedInput,
  };
};

export const createDiscoveryFeedbackEventV1 = (
  value: DiscoveryFeedbackEventV1,
): DiscoveryFeedbackEventV1 => decodeDiscoveryFeedbackEventV1(value);

export const decodeDiscoverySuppressionDirectiveV1 = (
  value: unknown,
): DiscoverySuppressionDirectiveV1 => {
  const path = 'suppression';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'suppressionId',
      'projectId',
      'actor',
      'principalId',
      'sourceFindingId',
      'sourceFindingRevision',
      'suppressionKind',
      'scope',
      'matcherKind',
      'matcherVersion',
      'fingerprint',
      'fingerprintVersion',
      'expiresAt',
      'reviewAt',
      'createdAt',
    ],
    path,
  );
  const suppressionKind = enumValue(
    required(object, 'suppressionKind', path),
    DISCOVERY_SUPPRESSION_KINDS,
    `${path}.suppressionKind`,
  );
  const matcherKind = enumValue(
    required(object, 'matcherKind', path),
    DISCOVERY_SUPPRESSION_MATCHER_KINDS,
    `${path}.matcherKind`,
  );
  const scope = enumValue(
    required(object, 'scope', path),
    DISCOVERY_FEEDBACK_SCOPE_KINDS,
    `${path}.scope`,
  );
  const matcherVersion = optionalText(object.matcherVersion, `${path}.matcherVersion`, 120);
  const fingerprint = optionalText(object.fingerprint, `${path}.fingerprint`, 512);
  const fingerprintVersion = optionalText(
    object.fingerprintVersion,
    `${path}.fingerprintVersion`,
    120,
  );
  const expiresAt = optionalIsoDate(object.expiresAt, `${path}.expiresAt`);
  const reviewAt = optionalIsoDate(object.reviewAt, `${path}.reviewAt`);
  if (suppressionKind === 'SNOOZE') {
    if (
      matcherKind !== 'NONE' ||
      matcherVersion !== undefined ||
      fingerprint !== undefined ||
      fingerprintVersion !== undefined
    ) {
      return fail(path, 'SNOOZE cannot carry a fingerprint or matcher');
    }
    if (expiresAt === undefined) return fail(`${path}.expiresAt`, 'is required for SNOOZE');
  } else if (suppressionKind === 'SUPPRESS_EXACT') {
    if (matcherKind !== 'EXACT_FINGERPRINT') {
      return fail(path, 'SUPPRESS_EXACT requires EXACT_FINGERPRINT matcher');
    }
    if (
      matcherVersion === undefined ||
      fingerprint === undefined ||
      fingerprintVersion === undefined
    ) {
      return fail(path, 'SUPPRESS_EXACT requires matcher and fingerprint versions');
    }
  } else {
    if (matcherKind !== 'SEMANTIC_FAMILY' || matcherVersion === undefined) {
      return fail(path, 'SUPPRESS_SIMILAR requires a versioned SEMANTIC_FAMILY matcher');
    }
    if (fingerprint !== undefined || fingerprintVersion !== undefined) {
      return fail(path, 'SUPPRESS_SIMILAR cannot carry an exact fingerprint');
    }
  }
  return {
    schemaVersion: enumValue(
      required(object, 'schemaVersion', path),
      [DISCOVERY_FEEDBACK_SCHEMA_VERSION],
      `${path}.schemaVersion`,
    ),
    suppressionId: text(required(object, 'suppressionId', path), `${path}.suppressionId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    actor: decodeActor(required(object, 'actor', path), `${path}.actor`),
    ...(object.principalId === undefined
      ? {}
      : { principalId: text(object.principalId, `${path}.principalId`) }),
    sourceFindingId: text(required(object, 'sourceFindingId', path), `${path}.sourceFindingId`),
    sourceFindingRevision: positiveInteger(
      required(object, 'sourceFindingRevision', path),
      `${path}.sourceFindingRevision`,
    ),
    suppressionKind,
    scope,
    matcherKind,
    ...(matcherVersion === undefined ? {} : { matcherVersion }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...(fingerprintVersion === undefined ? {} : { fingerprintVersion }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(reviewAt === undefined ? {} : { reviewAt }),
    createdAt: isoDate(required(object, 'createdAt', path), `${path}.createdAt`),
  };
};

export const createDiscoverySuppressionDirectiveV1 = (
  value: DiscoverySuppressionDirectiveV1,
): DiscoverySuppressionDirectiveV1 => decodeDiscoverySuppressionDirectiveV1(value);

export const decodeDiscoveryRankingPolicyRevisionV1 = (
  value: unknown,
): DiscoveryRankingPolicyRevisionV1 => {
  const path = 'rankingPolicy';
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'policyId',
      'policyRevision',
      'scope',
      'algorithmVersion',
      'rules',
      'weights',
      'createdBy',
      'createdAt',
      'effectiveFrom',
    ],
    path,
  );
  return {
    schemaVersion: enumValue(
      required(object, 'schemaVersion', path),
      [DISCOVERY_FEEDBACK_SCHEMA_VERSION],
      `${path}.schemaVersion`,
    ),
    policyId: text(required(object, 'policyId', path), `${path}.policyId`),
    policyRevision: positiveInteger(
      required(object, 'policyRevision', path),
      `${path}.policyRevision`,
    ),
    scope: enumValue(
      required(object, 'scope', path),
      [DISCOVERY_RANKING_POLICY_SCOPE_V1],
      `${path}.scope`,
    ),
    algorithmVersion: enumValue(
      required(object, 'algorithmVersion', path),
      [DISCOVERY_RANKING_POLICY_VERSION_V1],
      `${path}.algorithmVersion`,
    ),
    rules: decodeRules(required(object, 'rules', path), `${path}.rules`),
    weights: decodeRankingDimensions(required(object, 'weights', path), `${path}.weights`),
    createdBy: decodeActor(required(object, 'createdBy', path), `${path}.createdBy`),
    createdAt: isoDate(required(object, 'createdAt', path), `${path}.createdAt`),
    effectiveFrom: isoDate(required(object, 'effectiveFrom', path), `${path}.effectiveFrom`),
  };
};

export const createDiscoveryRankingPolicyRevisionV1 = (
  value: DiscoveryRankingPolicyRevisionV1,
): DiscoveryRankingPolicyRevisionV1 => decodeDiscoveryRankingPolicyRevisionV1(value);
