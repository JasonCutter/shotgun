import { utf16OrdinalCompare } from './semantic-representation.js';
import type { SecurityContext } from './types.js';

/**
 * AKP-2 WP1 contract only. A Discovery finding is a durable, non-Canonical
 * derived record. It is not a KnowledgeCandidate, Fact, Review decision or
 * executable Action.
 */

export const DISCOVERY_FINDING_SCHEMA_VERSION = '1.0.0' as const;
export type DiscoveryFindingSchemaVersion = typeof DISCOVERY_FINDING_SCHEMA_VERSION;

export const DISCOVERY_FINDING_TYPES = [
  'KNOWLEDGE_GAP',
  'EVIDENCE_GAP',
  'RELATION_HYPOTHESIS',
  'PATTERN_HYPOTHESIS',
  'CONFLICT_HYPOTHESIS',
  'CLARIFICATION_QUESTION',
  'ACTION_SUGGESTION',
] as const;
export type DiscoveryFindingType = (typeof DISCOVERY_FINDING_TYPES)[number];

export const DISCOVERY_GENERATION_METHODS = ['DETERMINISTIC', 'AI_ASSISTED', 'HYBRID'] as const;
export type DiscoveryGenerationMethod = (typeof DISCOVERY_GENERATION_METHODS)[number];

export const DISCOVERY_FINDING_LIFECYCLE_STATES = [
  'NEW',
  'VALIDATING',
  'REVIEW_READY',
  'REENTERED',
  'DISMISSED',
  'SUPPRESSED',
  'RESOLVED',
  'STALE',
  'SUPERSEDED',
] as const;
export type DiscoveryFindingLifecycleState = (typeof DISCOVERY_FINDING_LIFECYCLE_STATES)[number];

export type DiscoveryFindingStatus = 'DERIVED_INFERENCE';

/** This is identity for a finding record, not a Canonical or SourceVersion revision. */
export type DiscoveryFindingRevision = number;

export const DISCOVERY_RESOURCE_KINDS = [
  'CANONICAL_CLAIM',
  'CANONICAL_ENTITY',
  'CANONICAL_EVENT',
  'CANONICAL_RELATION',
  'CANONICAL_CONFLICT',
  'CANONICAL_DECISION',
  'SOURCE',
  'SOURCE_VERSION',
  'COMPILED_TRUTH_ITEM',
] as const;
export type DiscoveryResourceKind = (typeof DISCOVERY_RESOURCE_KINDS)[number];

export const DISCOVERY_RESOURCE_STATES = ['CURRENT', 'APPROVED'] as const;
export type DiscoveryResourceState = (typeof DISCOVERY_RESOURCE_STATES)[number];

/**
 * Minimal typed identity used when no existing shared resource reference is
 * sufficiently specific. Evidence is intentionally not a related-resource
 * replacement; evidence lineage remains in the envelope's evidenceIds.
 */
export type DiscoveryResourceRefV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly resourceKind: DiscoveryResourceKind;
  readonly resourceId: string;
  readonly projectId: string;
  readonly resourceState: DiscoveryResourceState;
  readonly resourceRevision?: string;
};

export type DiscoveryCanonicalBaseIdentityV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
};

export type DiscoveryProjectionBaseIdentityV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly projectionRevision: string;
  readonly projectionDigest: string;
};

export type DiscoveryTemporalQualificationV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly description: string;
};

type DiscoveryPayloadBase<TType extends DiscoveryFindingType> = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly payloadType: TType;
};

export type KnowledgeGapPayloadV1 =
  | (DiscoveryPayloadBase<'KNOWLEDGE_GAP'> & {
      readonly gapKind: 'MISSING_FACT';
      readonly subject: string;
      readonly missingFact: string;
      readonly question: string;
    })
  | (DiscoveryPayloadBase<'KNOWLEDGE_GAP'> & {
      readonly gapKind: 'TEMPORAL_GAP';
      readonly subject: string;
      readonly missingTimeDescription: string;
      readonly question: string;
    })
  | (DiscoveryPayloadBase<'KNOWLEDGE_GAP'> & {
      readonly gapKind: 'UNDEFINED_TERM';
      readonly term: string;
      readonly context: string;
      readonly question: string;
    })
  | (DiscoveryPayloadBase<'KNOWLEDGE_GAP'> & {
      readonly gapKind: 'KNOWN_CONFLICT_QUESTION';
      readonly knownConflictRef: DiscoveryResourceRefV1;
      readonly missingResolutionInput: string;
      readonly question: string;
    });

export type EvidenceGapPayloadV1 = DiscoveryPayloadBase<'EVIDENCE_GAP'> & {
  readonly coverageKind: 'ABSENT' | 'WEAK' | 'INSUFFICIENT';
  readonly affectedResourceRef: DiscoveryResourceRefV1;
  readonly coverageGap: string;
  readonly requiredEvidence: string;
};

export type RelationHypothesisPayloadV1 = DiscoveryPayloadBase<'RELATION_HYPOTHESIS'> & {
  readonly sourceEndpoint: DiscoveryResourceRefV1;
  readonly targetEndpoint: DiscoveryResourceRefV1;
  readonly proposedRelationType: string;
  readonly direction: 'DIRECTED' | 'UNDIRECTED';
  readonly temporalQualification?: DiscoveryTemporalQualificationV1;
};

export type PatternHypothesisPayloadV1 = DiscoveryPayloadBase<'PATTERN_HYPOTHESIS'> & {
  readonly patternKind: 'CLUSTER' | 'TREND' | 'RECURRING_ASSOCIATION' | 'TEMPORAL_CHANGE';
  readonly memberResourceRefs: readonly [
    DiscoveryResourceRefV1,
    DiscoveryResourceRefV1,
    ...DiscoveryResourceRefV1[],
  ];
  readonly patternIdentity: string;
  readonly patternStatement: string;
};

export type ConflictHypothesisPayloadV1 = DiscoveryPayloadBase<'CONFLICT_HYPOTHESIS'> & {
  readonly participatingResourceRefs: readonly [
    DiscoveryResourceRefV1,
    DiscoveryResourceRefV1,
    ...DiscoveryResourceRefV1[],
  ];
  readonly contradictionKind: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
  readonly possibleContradiction: string;
};

export type ClarificationQuestionPayloadV1 = DiscoveryPayloadBase<'CLARIFICATION_QUESTION'> & {
  readonly investigationTargetRefs: readonly [DiscoveryResourceRefV1, ...DiscoveryResourceRefV1[]];
  readonly question: string;
  readonly context: string;
  readonly proposedNextStep: string;
};

export type ActionSuggestionPayloadV1 = DiscoveryPayloadBase<'ACTION_SUGGESTION'> & {
  readonly suggestedAction: string;
  readonly rationale: string;
  readonly affectedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly riskContext?: string;
  /** The only legal execution-status value at the Discovery boundary. */
  readonly executionStatus: 'CANDIDATE_ONLY';
};

export type DiscoveryFindingPayloadV1 =
  | KnowledgeGapPayloadV1
  | EvidenceGapPayloadV1
  | RelationHypothesisPayloadV1
  | PatternHypothesisPayloadV1
  | ConflictHypothesisPayloadV1
  | ClarificationQuestionPayloadV1
  | ActionSuggestionPayloadV1;

export type DiscoveryDeterministicProvenanceV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly kind: 'DETERMINISTIC';
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly inputDigest: string;
};

export type DiscoveryAiExecutionProvenanceV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly kind: 'AI_ASSISTED';
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly aiConfigurationRevision: string;
  /** Server-owned credential identity; never a credential or secret value. */
  readonly credentialId: string;
  /** Immutable credential revision; never a credential or secret value. */
  readonly credentialRevision: string;
  /** Effective ADR-133 provider-policy decision identity. */
  readonly providerPolicyFingerprint: string;
  readonly privacyPolicyRevision: string;
  readonly dataPolicyRevision: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
};

export type DiscoveryHybridProvenanceV1 = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly kind: 'HYBRID';
  readonly deterministic: Omit<DiscoveryDeterministicProvenanceV1, 'schemaVersion' | 'kind'>;
  readonly aiExecution: Omit<DiscoveryAiExecutionProvenanceV1, 'schemaVersion' | 'kind'>;
};

export type DiscoveryFindingProvenanceV1 =
  | DiscoveryDeterministicProvenanceV1
  | DiscoveryAiExecutionProvenanceV1
  | DiscoveryHybridProvenanceV1;

/** Bounded retrieval/discovery observations, never epistemic authority. */
export type DiscoverySignalSummaryV1 = {
  readonly semanticSimilarity?: number;
  readonly semanticRank?: number;
  readonly lexicalRank?: number;
  readonly graphDistance?: number;
  readonly graphTopology?: 'ISOLATED' | 'CONNECTED' | 'HUB' | 'COMMUNITY';
  readonly temporalOverlap?: number;
  readonly temporalChange?: 'NONE' | 'EMERGING' | 'SHIFTING' | 'ENDED';
  readonly evidenceCoverage?: number;
  readonly conflictState?: 'NONE' | 'KNOWN_CONFLICT' | 'POSSIBLE_CONFLICT';
  readonly novelty?: number;
  readonly rankingCostMicros?: number;
};

export type DiscoveryRetentionClassV1 = 'EPHEMERAL_PRE_MATERIALIZATION' | 'DURABLE_DERIVED_RECORD';

export type DiscoveryFindingEnvelopeV1Base = {
  readonly schemaVersion: DiscoveryFindingSchemaVersion;
  readonly findingId: string;
  readonly findingRevision: DiscoveryFindingRevision;
  readonly projectId: string;
  readonly status: 'DERIVED_INFERENCE';
  readonly generationMethod: DiscoveryGenerationMethod;
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly evidenceIds: readonly string[];
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly runId: string;
  readonly signalSummary: DiscoverySignalSummaryV1;
  readonly rationale: string;
  readonly derivationSummary: string;
  readonly provenance: DiscoveryFindingProvenanceV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
  readonly retentionClass: 'DURABLE_DERIVED_RECORD';
  readonly createdAt: string;
  readonly supersedesFindingId?: string;
};

export type DiscoveryFindingEnvelopeV1 =
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'KNOWLEDGE_GAP';
      readonly payload: KnowledgeGapPayloadV1;
    })
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'EVIDENCE_GAP';
      readonly payload: EvidenceGapPayloadV1;
    })
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'RELATION_HYPOTHESIS';
      readonly payload: RelationHypothesisPayloadV1;
    })
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'PATTERN_HYPOTHESIS';
      readonly payload: PatternHypothesisPayloadV1;
    })
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'CONFLICT_HYPOTHESIS';
      readonly payload: ConflictHypothesisPayloadV1;
    })
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'CLARIFICATION_QUESTION';
      readonly payload: ClarificationQuestionPayloadV1;
    })
  | (DiscoveryFindingEnvelopeV1Base & {
      readonly findingType: 'ACTION_SUGGESTION';
      readonly payload: ActionSuggestionPayloadV1;
    });

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

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(path, 'must be a non-empty string');
  }
  return value.trim();
};

const optionalText = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : text(value, path);

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const positiveInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(path, 'must be a positive integer');
  }
  return value;
};

const nonNegativeInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'must be a non-negative integer');
  }
  return value;
};

const finiteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(path, 'must be a finite number');
  }
  return value;
};

const boundedNumber = (value: unknown, path: string): number => {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) return fail(path, 'must be within 0..1');
  return number;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const timestamp = text(value, path);
  if (Number.isNaN(Date.parse(timestamp))) return fail(path, 'must be an ISO timestamp');
  return timestamp;
};

const schemaVersion = (object: ObjectValue, path: string): DiscoveryFindingSchemaVersion =>
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_FINDING_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );

const stringArray = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  return value.map((entry, index) => text(entry, `${path}[${index}]`));
};

const normalizedScope = (value: unknown, path: string): readonly string[] => {
  const scope = stringArray(value, path);
  const unique = [...new Set(scope)];
  if (unique.length === 0) return fail(path, 'must contain at least one access scope');
  return unique.sort(utf16OrdinalCompare);
};

const decodeResourceRef = (value: unknown, path: string): DiscoveryResourceRefV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'resourceKind',
      'resourceId',
      'projectId',
      'resourceState',
      'resourceRevision',
    ],
    path,
  );
  schemaVersion(object, path);
  const resourceRevision = optionalText(object.resourceRevision, `${path}.resourceRevision`);
  return {
    schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
    resourceKind: enumValue(
      required(object, 'resourceKind', path),
      DISCOVERY_RESOURCE_KINDS,
      `${path}.resourceKind`,
    ),
    resourceId: text(required(object, 'resourceId', path), `${path}.resourceId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    resourceState: enumValue(
      required(object, 'resourceState', path),
      DISCOVERY_RESOURCE_STATES,
      `${path}.resourceState`,
    ),
    ...(resourceRevision === undefined ? {} : { resourceRevision }),
  };
};

const decodeTemporalQualification = (
  value: unknown,
  path: string,
): DiscoveryTemporalQualificationV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'validFrom', 'validTo', 'description'],
    path,
  );
  schemaVersion(object, path);
  const validFrom =
    object.validFrom === undefined
      ? undefined
      : isoTimestamp(object.validFrom, `${path}.validFrom`);
  const validTo =
    object.validTo === undefined ? undefined : isoTimestamp(object.validTo, `${path}.validTo`);
  if (
    validFrom !== undefined &&
    validTo !== undefined &&
    Date.parse(validFrom) > Date.parse(validTo)
  ) {
    return fail(path, 'validFrom must not be later than validTo');
  }
  return {
    schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validTo === undefined ? {} : { validTo }),
    description: text(required(object, 'description', path), `${path}.description`),
  };
};

const payloadBase = <TType extends DiscoveryFindingType>(
  object: ObjectValue,
  expectedType: TType,
  path: string,
): DiscoveryPayloadBase<TType> => {
  schemaVersion(object, path);
  const payloadType = enumValue(
    required(object, 'payloadType', path),
    DISCOVERY_FINDING_TYPES,
    `${path}.payloadType`,
  );
  if (payloadType !== expectedType) return fail(path, `payloadType must be ${expectedType}`);
  return { schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION, payloadType: expectedType };
};

const decodeKnowledgeGapPayload = (value: unknown, path: string): KnowledgeGapPayloadV1 => {
  const object = objectValue(value, path);
  const gapKind = enumValue(
    required(object, 'gapKind', path),
    ['MISSING_FACT', 'TEMPORAL_GAP', 'UNDEFINED_TERM', 'KNOWN_CONFLICT_QUESTION'],
    `${path}.gapKind`,
  );
  if (gapKind === 'MISSING_FACT') {
    const strict = strictObject(
      object,
      ['schemaVersion', 'payloadType', 'gapKind', 'subject', 'missingFact', 'question'],
      path,
    );
    return {
      ...payloadBase(strict, 'KNOWLEDGE_GAP', path),
      gapKind,
      subject: text(required(strict, 'subject', path), `${path}.subject`),
      missingFact: text(required(strict, 'missingFact', path), `${path}.missingFact`),
      question: text(required(strict, 'question', path), `${path}.question`),
    };
  }
  if (gapKind === 'TEMPORAL_GAP') {
    const strict = strictObject(
      object,
      ['schemaVersion', 'payloadType', 'gapKind', 'subject', 'missingTimeDescription', 'question'],
      path,
    );
    return {
      ...payloadBase(strict, 'KNOWLEDGE_GAP', path),
      gapKind,
      subject: text(required(strict, 'subject', path), `${path}.subject`),
      missingTimeDescription: text(
        required(strict, 'missingTimeDescription', path),
        `${path}.missingTimeDescription`,
      ),
      question: text(required(strict, 'question', path), `${path}.question`),
    };
  }
  if (gapKind === 'UNDEFINED_TERM') {
    const strict = strictObject(
      object,
      ['schemaVersion', 'payloadType', 'gapKind', 'term', 'context', 'question'],
      path,
    );
    return {
      ...payloadBase(strict, 'KNOWLEDGE_GAP', path),
      gapKind,
      term: text(required(strict, 'term', path), `${path}.term`),
      context: text(required(strict, 'context', path), `${path}.context`),
      question: text(required(strict, 'question', path), `${path}.question`),
    };
  }
  const strict = strictObject(
    object,
    [
      'schemaVersion',
      'payloadType',
      'gapKind',
      'knownConflictRef',
      'missingResolutionInput',
      'question',
    ],
    path,
  );
  const knownConflictRef = decodeResourceRef(
    required(strict, 'knownConflictRef', path),
    `${path}.knownConflictRef`,
  );
  if (knownConflictRef.resourceKind !== 'CANONICAL_CONFLICT') {
    return fail(`${path}.knownConflictRef.resourceKind`, 'must identify a CANONICAL_CONFLICT');
  }
  return {
    ...payloadBase(strict, 'KNOWLEDGE_GAP', path),
    gapKind,
    knownConflictRef,
    missingResolutionInput: text(
      required(strict, 'missingResolutionInput', path),
      `${path}.missingResolutionInput`,
    ),
    question: text(required(strict, 'question', path), `${path}.question`),
  };
};

const decodeEvidenceGapPayload = (value: unknown, path: string): EvidenceGapPayloadV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'payloadType',
      'coverageKind',
      'affectedResourceRef',
      'coverageGap',
      'requiredEvidence',
    ],
    path,
  );
  return {
    ...payloadBase(object, 'EVIDENCE_GAP', path),
    coverageKind: enumValue(
      required(object, 'coverageKind', path),
      ['ABSENT', 'WEAK', 'INSUFFICIENT'],
      `${path}.coverageKind`,
    ),
    affectedResourceRef: decodeResourceRef(
      required(object, 'affectedResourceRef', path),
      `${path}.affectedResourceRef`,
    ),
    coverageGap: text(required(object, 'coverageGap', path), `${path}.coverageGap`),
    requiredEvidence: text(required(object, 'requiredEvidence', path), `${path}.requiredEvidence`),
  };
};

const decodeRelationHypothesisPayload = (
  value: unknown,
  path: string,
): RelationHypothesisPayloadV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'payloadType',
      'sourceEndpoint',
      'targetEndpoint',
      'proposedRelationType',
      'direction',
      'temporalQualification',
    ],
    path,
  );
  const temporalQualification =
    object.temporalQualification === undefined
      ? undefined
      : decodeTemporalQualification(object.temporalQualification, `${path}.temporalQualification`);
  return {
    ...payloadBase(object, 'RELATION_HYPOTHESIS', path),
    sourceEndpoint: decodeResourceRef(
      required(object, 'sourceEndpoint', path),
      `${path}.sourceEndpoint`,
    ),
    targetEndpoint: decodeResourceRef(
      required(object, 'targetEndpoint', path),
      `${path}.targetEndpoint`,
    ),
    proposedRelationType: text(
      required(object, 'proposedRelationType', path),
      `${path}.proposedRelationType`,
    ),
    direction: enumValue(
      required(object, 'direction', path),
      ['DIRECTED', 'UNDIRECTED'],
      `${path}.direction`,
    ),
    ...(temporalQualification === undefined ? {} : { temporalQualification }),
  };
};

const decodeResourceRefs = (value: unknown, path: string): readonly DiscoveryResourceRefV1[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  return value.map((entry, index) => decodeResourceRef(entry, `${path}[${index}]`));
};

const requireMinimumRefs = (
  refs: readonly DiscoveryResourceRefV1[],
  minimum: number,
  path: string,
): void => {
  if (refs.length < minimum)
    return fail(path, `must contain at least ${minimum} resource references`);
};

const decodePatternHypothesisPayload = (
  value: unknown,
  path: string,
): PatternHypothesisPayloadV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'payloadType',
      'patternKind',
      'memberResourceRefs',
      'patternIdentity',
      'patternStatement',
    ],
    path,
  );
  const memberResourceRefs = decodeResourceRefs(
    required(object, 'memberResourceRefs', path),
    `${path}.memberResourceRefs`,
  );
  requireMinimumRefs(memberResourceRefs, 2, `${path}.memberResourceRefs`);
  return {
    ...payloadBase(object, 'PATTERN_HYPOTHESIS', path),
    patternKind: enumValue(
      required(object, 'patternKind', path),
      ['CLUSTER', 'TREND', 'RECURRING_ASSOCIATION', 'TEMPORAL_CHANGE'],
      `${path}.patternKind`,
    ),
    memberResourceRefs: memberResourceRefs as PatternHypothesisPayloadV1['memberResourceRefs'],
    patternIdentity: text(required(object, 'patternIdentity', path), `${path}.patternIdentity`),
    patternStatement: text(required(object, 'patternStatement', path), `${path}.patternStatement`),
  };
};

const decodeConflictHypothesisPayload = (
  value: unknown,
  path: string,
): ConflictHypothesisPayloadV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'payloadType',
      'participatingResourceRefs',
      'contradictionKind',
      'possibleContradiction',
    ],
    path,
  );
  const participatingResourceRefs = decodeResourceRefs(
    required(object, 'participatingResourceRefs', path),
    `${path}.participatingResourceRefs`,
  );
  requireMinimumRefs(participatingResourceRefs, 2, `${path}.participatingResourceRefs`);
  return {
    ...payloadBase(object, 'CONFLICT_HYPOTHESIS', path),
    participatingResourceRefs:
      participatingResourceRefs as ConflictHypothesisPayloadV1['participatingResourceRefs'],
    contradictionKind: enumValue(
      required(object, 'contradictionKind', path),
      ['FACTUAL', 'TEMPORAL', 'IDENTITY', 'MODEL_DISAGREEMENT'],
      `${path}.contradictionKind`,
    ),
    possibleContradiction: text(
      required(object, 'possibleContradiction', path),
      `${path}.possibleContradiction`,
    ),
  };
};

const decodeClarificationQuestionPayload = (
  value: unknown,
  path: string,
): ClarificationQuestionPayloadV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'payloadType',
      'investigationTargetRefs',
      'question',
      'context',
      'proposedNextStep',
    ],
    path,
  );
  const investigationTargetRefs = decodeResourceRefs(
    required(object, 'investigationTargetRefs', path),
    `${path}.investigationTargetRefs`,
  );
  requireMinimumRefs(investigationTargetRefs, 1, `${path}.investigationTargetRefs`);
  return {
    ...payloadBase(object, 'CLARIFICATION_QUESTION', path),
    investigationTargetRefs:
      investigationTargetRefs as ClarificationQuestionPayloadV1['investigationTargetRefs'],
    question: text(required(object, 'question', path), `${path}.question`),
    context: text(required(object, 'context', path), `${path}.context`),
    proposedNextStep: text(required(object, 'proposedNextStep', path), `${path}.proposedNextStep`),
  };
};

const decodeActionSuggestionPayload = (value: unknown, path: string): ActionSuggestionPayloadV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'payloadType',
      'suggestedAction',
      'rationale',
      'affectedResourceRefs',
      'riskContext',
      'executionStatus',
    ],
    path,
  );
  const riskContext = optionalText(object.riskContext, `${path}.riskContext`);
  return {
    ...payloadBase(object, 'ACTION_SUGGESTION', path),
    suggestedAction: text(required(object, 'suggestedAction', path), `${path}.suggestedAction`),
    rationale: text(required(object, 'rationale', path), `${path}.rationale`),
    affectedResourceRefs: decodeResourceRefs(
      required(object, 'affectedResourceRefs', path),
      `${path}.affectedResourceRefs`,
    ),
    ...(riskContext === undefined ? {} : { riskContext }),
    executionStatus: enumValue(
      required(object, 'executionStatus', path),
      ['CANDIDATE_ONLY'],
      `${path}.executionStatus`,
    ),
  };
};

const decodePayload = (
  value: unknown,
  findingType: DiscoveryFindingType,
  path: string,
): DiscoveryFindingPayloadV1 => {
  switch (findingType) {
    case 'KNOWLEDGE_GAP':
      return decodeKnowledgeGapPayload(value, path);
    case 'EVIDENCE_GAP':
      return decodeEvidenceGapPayload(value, path);
    case 'RELATION_HYPOTHESIS':
      return decodeRelationHypothesisPayload(value, path);
    case 'PATTERN_HYPOTHESIS':
      return decodePatternHypothesisPayload(value, path);
    case 'CONFLICT_HYPOTHESIS':
      return decodeConflictHypothesisPayload(value, path);
    case 'CLARIFICATION_QUESTION':
      return decodeClarificationQuestionPayload(value, path);
    case 'ACTION_SUGGESTION':
      return decodeActionSuggestionPayload(value, path);
  }
};

const decodeDeterministicDetails = (
  value: unknown,
  path: string,
): Omit<DiscoveryDeterministicProvenanceV1, 'schemaVersion' | 'kind'> => {
  const object = strictObject(value, ['ruleId', 'ruleVersion', 'inputDigest'], path);
  return {
    ruleId: text(required(object, 'ruleId', path), `${path}.ruleId`),
    ruleVersion: text(required(object, 'ruleVersion', path), `${path}.ruleVersion`),
    inputDigest: text(required(object, 'inputDigest', path), `${path}.inputDigest`),
  };
};

const decodeAiDetails = (
  value: unknown,
  path: string,
): Omit<DiscoveryAiExecutionProvenanceV1, 'schemaVersion' | 'kind'> => {
  const object = strictObject(
    value,
    [
      'providerId',
      'modelId',
      'modelVersion',
      'aiConfigurationRevision',
      'credentialId',
      'credentialRevision',
      'providerPolicyFingerprint',
      'privacyPolicyRevision',
      'dataPolicyRevision',
      'promptVersion',
      'outputSchemaVersion',
    ],
    path,
  );
  return {
    providerId: text(required(object, 'providerId', path), `${path}.providerId`),
    modelId: text(required(object, 'modelId', path), `${path}.modelId`),
    modelVersion: text(required(object, 'modelVersion', path), `${path}.modelVersion`),
    aiConfigurationRevision: text(
      required(object, 'aiConfigurationRevision', path),
      `${path}.aiConfigurationRevision`,
    ),
    credentialId: text(required(object, 'credentialId', path), `${path}.credentialId`),
    credentialRevision: text(
      required(object, 'credentialRevision', path),
      `${path}.credentialRevision`,
    ),
    providerPolicyFingerprint: text(
      required(object, 'providerPolicyFingerprint', path),
      `${path}.providerPolicyFingerprint`,
    ),
    privacyPolicyRevision: text(
      required(object, 'privacyPolicyRevision', path),
      `${path}.privacyPolicyRevision`,
    ),
    dataPolicyRevision: text(
      required(object, 'dataPolicyRevision', path),
      `${path}.dataPolicyRevision`,
    ),
    promptVersion: text(required(object, 'promptVersion', path), `${path}.promptVersion`),
    outputSchemaVersion: text(
      required(object, 'outputSchemaVersion', path),
      `${path}.outputSchemaVersion`,
    ),
  };
};

const decodeProvenance = (
  value: unknown,
  generationMethod: DiscoveryGenerationMethod,
  path: string,
): DiscoveryFindingProvenanceV1 => {
  const object = objectValue(value, path);
  schemaVersion(object, path);
  const kind = enumValue(
    required(object, 'kind', path),
    DISCOVERY_GENERATION_METHODS,
    `${path}.kind`,
  );
  if (kind !== generationMethod)
    return fail(path, `kind must match generationMethod ${generationMethod}`);
  if (kind === 'DETERMINISTIC') {
    const strict = strictObject(
      object,
      ['schemaVersion', 'kind', 'ruleId', 'ruleVersion', 'inputDigest'],
      path,
    );
    return {
      schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
      kind,
      ...decodeDeterministicDetails(
        Object.fromEntries(
          Object.entries(strict).filter(([key]) => key !== 'schemaVersion' && key !== 'kind'),
        ),
        path,
      ),
    };
  }
  if (kind === 'AI_ASSISTED') {
    const strict = strictObject(
      object,
      [
        'schemaVersion',
        'kind',
        'providerId',
        'modelId',
        'modelVersion',
        'aiConfigurationRevision',
        'credentialId',
        'credentialRevision',
        'providerPolicyFingerprint',
        'privacyPolicyRevision',
        'dataPolicyRevision',
        'promptVersion',
        'outputSchemaVersion',
      ],
      path,
    );
    return {
      schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
      kind,
      ...decodeAiDetails(
        Object.fromEntries(
          Object.entries(strict).filter(([key]) => key !== 'schemaVersion' && key !== 'kind'),
        ),
        path,
      ),
    };
  }
  const strict = strictObject(
    object,
    ['schemaVersion', 'kind', 'deterministic', 'aiExecution'],
    path,
  );
  return {
    schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
    kind,
    deterministic: decodeDeterministicDetails(
      required(strict, 'deterministic', path),
      `${path}.deterministic`,
    ),
    aiExecution: decodeAiDetails(required(strict, 'aiExecution', path), `${path}.aiExecution`),
  };
};

const decodeSignalSummary = (value: unknown, path: string): DiscoverySignalSummaryV1 => {
  const object = strictObject(
    value,
    [
      'semanticSimilarity',
      'semanticRank',
      'lexicalRank',
      'graphDistance',
      'graphTopology',
      'temporalOverlap',
      'temporalChange',
      'evidenceCoverage',
      'conflictState',
      'novelty',
      'rankingCostMicros',
    ],
    path,
  );
  const optionalBounded = (key: string): number | undefined =>
    object[key] === undefined ? undefined : boundedNumber(object[key], `${path}.${key}`);
  const optionalRank = (key: string): number | undefined =>
    object[key] === undefined ? undefined : nonNegativeInteger(object[key], `${path}.${key}`);
  const optionalCost = (key: string): number | undefined =>
    object[key] === undefined ? undefined : finiteNumber(object[key], `${path}.${key}`);
  const semanticSimilarity = optionalBounded('semanticSimilarity');
  const temporalOverlap = optionalBounded('temporalOverlap');
  const evidenceCoverage = optionalBounded('evidenceCoverage');
  const novelty = optionalBounded('novelty');
  const semanticRank = optionalRank('semanticRank');
  const lexicalRank = optionalRank('lexicalRank');
  const graphDistance = optionalRank('graphDistance');
  const rankingCostMicros = optionalCost('rankingCostMicros');
  const graphTopology =
    object.graphTopology === undefined
      ? undefined
      : enumValue(
          object.graphTopology,
          ['ISOLATED', 'CONNECTED', 'HUB', 'COMMUNITY'],
          `${path}.graphTopology`,
        );
  const temporalChange =
    object.temporalChange === undefined
      ? undefined
      : enumValue(
          object.temporalChange,
          ['NONE', 'EMERGING', 'SHIFTING', 'ENDED'],
          `${path}.temporalChange`,
        );
  const conflictState =
    object.conflictState === undefined
      ? undefined
      : enumValue(
          object.conflictState,
          ['NONE', 'KNOWN_CONFLICT', 'POSSIBLE_CONFLICT'],
          `${path}.conflictState`,
        );
  return {
    ...(semanticSimilarity === undefined ? {} : { semanticSimilarity }),
    ...(semanticRank === undefined ? {} : { semanticRank }),
    ...(lexicalRank === undefined ? {} : { lexicalRank }),
    ...(graphDistance === undefined ? {} : { graphDistance }),
    ...(graphTopology === undefined ? {} : { graphTopology }),
    ...(temporalOverlap === undefined ? {} : { temporalOverlap }),
    ...(temporalChange === undefined ? {} : { temporalChange }),
    ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }),
    ...(conflictState === undefined ? {} : { conflictState }),
    ...(novelty === undefined ? {} : { novelty }),
    ...(rankingCostMicros === undefined ? {} : { rankingCostMicros }),
  };
};

const resourceKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

const payloadResourceRefs = (
  payload: DiscoveryFindingPayloadV1,
): readonly DiscoveryResourceRefV1[] => {
  switch (payload.payloadType) {
    case 'KNOWLEDGE_GAP':
      return payload.gapKind === 'KNOWN_CONFLICT_QUESTION' ? [payload.knownConflictRef] : [];
    case 'EVIDENCE_GAP':
      return [payload.affectedResourceRef];
    case 'RELATION_HYPOTHESIS':
      return [payload.sourceEndpoint, payload.targetEndpoint];
    case 'PATTERN_HYPOTHESIS':
      return payload.memberResourceRefs;
    case 'CONFLICT_HYPOTHESIS':
      return payload.participatingResourceRefs;
    case 'CLARIFICATION_QUESTION':
      return payload.investigationTargetRefs;
    case 'ACTION_SUGGESTION':
      return payload.affectedResourceRefs;
  }
};

const decodeCanonicalBase = (value: unknown, path: string): DiscoveryCanonicalBaseIdentityV1 => {
  const object = strictObject(value, ['schemaVersion', 'canonicalVersion', 'snapshotDigest'], path);
  schemaVersion(object, path);
  return {
    schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
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
  schemaVersion(object, path);
  return {
    schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    projectionDigest: text(required(object, 'projectionDigest', path), `${path}.projectionDigest`),
  };
};

export const decodeDiscoveryFindingEnvelopeV1 = (
  value: unknown,
  path = 'discoveryFinding',
): DiscoveryFindingEnvelopeV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'findingId',
      'findingRevision',
      'projectId',
      'findingType',
      'status',
      'generationMethod',
      'lifecycleState',
      'payload',
      'relatedResourceRefs',
      'evidenceIds',
      'sourceProjectionDigest',
      'canonicalBase',
      'discoveryBase',
      'runId',
      'signalSummary',
      'rationale',
      'derivationSummary',
      'provenance',
      'accessScope',
      'sensitivity',
      'fingerprint',
      'fingerprintVersion',
      'retentionClass',
      'createdAt',
      'supersedesFindingId',
    ],
    path,
  );
  schemaVersion(object, path);
  const projectId = text(required(object, 'projectId', path), `${path}.projectId`);
  const findingType = enumValue(
    required(object, 'findingType', path),
    DISCOVERY_FINDING_TYPES,
    `${path}.findingType`,
  );
  const generationMethod = enumValue(
    required(object, 'generationMethod', path),
    DISCOVERY_GENERATION_METHODS,
    `${path}.generationMethod`,
  );
  const relatedResourceRefs = decodeResourceRefs(
    required(object, 'relatedResourceRefs', path),
    `${path}.relatedResourceRefs`,
  );
  for (const [index, resource] of relatedResourceRefs.entries()) {
    if (resource.projectId !== projectId) {
      return fail(
        `${path}.relatedResourceRefs[${index}].projectId`,
        'must match the finding projectId',
      );
    }
  }
  const payload = decodePayload(required(object, 'payload', path), findingType, `${path}.payload`);
  const relatedKeys = new Set(relatedResourceRefs.map(resourceKey));
  for (const [index, resource] of payloadResourceRefs(payload).entries()) {
    if (!relatedKeys.has(resourceKey(resource))) {
      return fail(
        `${path}.relatedResourceRefs`,
        `must include payload resource reference at index ${index}`,
      );
    }
  }
  const evidenceIds = stringArray(required(object, 'evidenceIds', path), `${path}.evidenceIds`);
  const supersedesFindingId = optionalText(
    object.supersedesFindingId,
    `${path}.supersedesFindingId`,
  );
  return {
    schemaVersion: DISCOVERY_FINDING_SCHEMA_VERSION,
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    projectId,
    findingType,
    status: enumValue(required(object, 'status', path), ['DERIVED_INFERENCE'], `${path}.status`),
    generationMethod,
    lifecycleState: enumValue(
      required(object, 'lifecycleState', path),
      DISCOVERY_FINDING_LIFECYCLE_STATES,
      `${path}.lifecycleState`,
    ),
    payload,
    relatedResourceRefs,
    evidenceIds,
    sourceProjectionDigest: text(
      required(object, 'sourceProjectionDigest', path),
      `${path}.sourceProjectionDigest`,
    ),
    canonicalBase: decodeCanonicalBase(
      required(object, 'canonicalBase', path),
      `${path}.canonicalBase`,
    ),
    discoveryBase: decodeDiscoveryBase(
      required(object, 'discoveryBase', path),
      `${path}.discoveryBase`,
    ),
    runId: text(required(object, 'runId', path), `${path}.runId`),
    signalSummary: decodeSignalSummary(
      required(object, 'signalSummary', path),
      `${path}.signalSummary`,
    ),
    rationale: text(required(object, 'rationale', path), `${path}.rationale`),
    derivationSummary: text(
      required(object, 'derivationSummary', path),
      `${path}.derivationSummary`,
    ),
    provenance: decodeProvenance(
      required(object, 'provenance', path),
      generationMethod,
      `${path}.provenance`,
    ),
    accessScope: normalizedScope(required(object, 'accessScope', path), `${path}.accessScope`),
    sensitivity: enumValue(
      required(object, 'sensitivity', path),
      ['public', 'internal', 'private', 'restricted'],
      `${path}.sensitivity`,
    ),
    fingerprint: text(required(object, 'fingerprint', path), `${path}.fingerprint`),
    fingerprintVersion: text(
      required(object, 'fingerprintVersion', path),
      `${path}.fingerprintVersion`,
    ),
    retentionClass: enumValue(
      required(object, 'retentionClass', path),
      ['DURABLE_DERIVED_RECORD'],
      `${path}.retentionClass`,
    ),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    ...(supersedesFindingId === undefined ? {} : { supersedesFindingId }),
  } as DiscoveryFindingEnvelopeV1;
};

export type DiscoveryFindingEnvelopeInputV1 = {
  [T in DiscoveryFindingType]: Omit<
    Extract<DiscoveryFindingEnvelopeV1, { readonly findingType: T }>,
    'status'
  >;
}[DiscoveryFindingType];

/** Factory fixes the authority status instead of accepting caller input. */
export const createDiscoveryFindingEnvelopeV1 = (
  input: DiscoveryFindingEnvelopeInputV1,
): DiscoveryFindingEnvelopeV1 =>
  decodeDiscoveryFindingEnvelopeV1({ ...input, status: 'DERIVED_INFERENCE' });

export type DiscoveryFingerprintLogicalInputV1 = {
  readonly findingType: DiscoveryFindingType;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly semanticEssence: string;
  readonly fingerprintVersion: string;
};

export type DiscoveryNormalizedFingerprintInputV1 = {
  readonly findingType: DiscoveryFindingType;
  readonly relatedResourceRefs: readonly {
    readonly schemaVersion: DiscoveryFindingSchemaVersion;
    readonly projectId: string;
    readonly resourceKind: DiscoveryResourceKind;
    readonly resourceId: string;
    readonly resourceState: DiscoveryResourceState;
    readonly resourceRevision?: string;
  }[];
  readonly semanticEssence: string;
  readonly fingerprintVersion: string;
};

/**
 * WP1 defines the deterministic logical input only. WP3 owns the final hash,
 * duplicate detection and reconciliation engine.
 */
export const normalizeDiscoveryFingerprintInputV1 = (
  input: DiscoveryFingerprintLogicalInputV1,
): DiscoveryNormalizedFingerprintInputV1 => {
  const findingType = enumValue(input.findingType, DISCOVERY_FINDING_TYPES, 'findingType');
  const semanticEssence = text(input.semanticEssence, 'semanticEssence');
  const fingerprintVersion = text(input.fingerprintVersion, 'fingerprintVersion');
  const relatedResourceRefs = input.relatedResourceRefs
    .map((resource, index) => {
      const decoded = decodeResourceRef(resource, `relatedResourceRefs[${index}]`);
      return {
        schemaVersion: decoded.schemaVersion,
        projectId: decoded.projectId,
        resourceKind: decoded.resourceKind,
        resourceId: decoded.resourceId,
        resourceState: decoded.resourceState,
        ...(decoded.resourceRevision === undefined
          ? {}
          : { resourceRevision: decoded.resourceRevision }),
      };
    })
    .sort((left, right) => utf16OrdinalCompare(resourceKey(left), resourceKey(right)));
  return { findingType, relatedResourceRefs, semanticEssence, fingerprintVersion };
};

export const DISCOVERY_REENTRY_TARGET_BY_TYPE = {
  RELATION_HYPOTHESIS: 'RELATION_GOVERNANCE',
  PATTERN_HYPOTHESIS: 'DERIVED_CLAIM_OR_KNOWLEDGE_CANDIDATE_GOVERNANCE',
  CONFLICT_HYPOTHESIS: 'EXISTING_CONFLICT_COMPARISON_AND_REVIEW',
  KNOWLEDGE_GAP: 'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE',
  EVIDENCE_GAP: 'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE',
  CLARIFICATION_QUESTION: 'INVESTIGATION_QUESTION_PATH',
  ACTION_SUGGESTION: 'ACTION_CANDIDATE_GOVERNANCE',
} as const satisfies Record<DiscoveryFindingType, string>;

export type DiscoveryReentryTargetV1 =
  (typeof DISCOVERY_REENTRY_TARGET_BY_TYPE)[DiscoveryFindingType];

export const discoveryReentryTargetFor = (
  findingType: DiscoveryFindingType,
): DiscoveryReentryTargetV1 => DISCOVERY_REENTRY_TARGET_BY_TYPE[findingType];

export type DiscoveryServerSecurityInputV1 = {
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
};

export type DiscoverySecurityCompositionFailureV1 =
  | { readonly materializable: false; readonly reason: 'INVALID_PROJECT_ID' }
  | { readonly materializable: false; readonly reason: 'CROSS_PROJECT' }
  | { readonly materializable: false; readonly reason: 'NO_COMMON_ACCESS_SCOPE' }
  | { readonly materializable: false; readonly reason: 'INVALID_SENSITIVITY' };

export type DiscoverySecurityCompositionSuccessV1 = {
  readonly materializable: true;
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
};

export type DiscoverySecurityCompositionResultV1 =
  DiscoverySecurityCompositionSuccessV1 | DiscoverySecurityCompositionFailureV1;

const SENSITIVITY_RANK: Readonly<Record<SecurityContext['sensitivity'], number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};
const SENSITIVITY_VALUES = ['public', 'internal', 'private', 'restricted'] as const;

const normalizeServerProjectId = (value: string): string => value.trim();

const normalizeServerScope = (scope: readonly string[]): readonly string[] =>
  [...new Set(scope.map((entry) => entry.trim()).filter((entry) => entry.length > 0))].sort(
    utf16OrdinalCompare,
  );

/**
 * Composes only server-derived resource/context classifications. There is no
 * browser-provided requested scope or sensitivity parameter that could lower
 * the result. A finding is materializable only when the safe scope
 * intersection is non-empty and every input belongs to the finding project.
 */
export const composeDiscoveryFindingSecurityV1 = (input: {
  readonly findingProjectId: string;
  readonly resources: readonly DiscoveryServerSecurityInputV1[];
  readonly executionContext: DiscoveryServerSecurityInputV1;
}): DiscoverySecurityCompositionResultV1 => {
  const findingProjectId = normalizeServerProjectId(input.findingProjectId);
  if (findingProjectId.length === 0) return { materializable: false, reason: 'INVALID_PROJECT_ID' };
  const allInputs = [...input.resources, input.executionContext];
  if (allInputs.some((entry) => !SENSITIVITY_VALUES.includes(entry.sensitivity))) {
    return { materializable: false, reason: 'INVALID_SENSITIVITY' };
  }
  if (
    allInputs.some((entry) => {
      const projectId = normalizeServerProjectId(entry.projectId);
      return projectId.length === 0 || projectId !== findingProjectId;
    })
  ) {
    return { materializable: false, reason: 'CROSS_PROJECT' };
  }
  const normalizedScopes = allInputs.map((entry) => normalizeServerScope(entry.accessScope));
  let commonScope = new Set(normalizedScopes[0] ?? []);
  for (const scope of normalizedScopes.slice(1)) {
    commonScope = new Set([...commonScope].filter((entry) => scope.includes(entry)));
  }
  if (commonScope.size === 0) {
    return { materializable: false, reason: 'NO_COMMON_ACCESS_SCOPE' };
  }
  const highestSensitivity = allInputs.reduce<SecurityContext['sensitivity']>(
    (highest, entry) =>
      SENSITIVITY_RANK[entry.sensitivity] > SENSITIVITY_RANK[highest] ? entry.sensitivity : highest,
    'public',
  );
  return {
    materializable: true,
    projectId: findingProjectId,
    accessScope: [...commonScope].sort(utf16OrdinalCompare),
    sensitivity: highestSensitivity,
  };
};
