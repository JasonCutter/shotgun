import { sha256Text } from './document-evidence.js';
import {
  DISCOVERY_FINDING_LIFECYCLE_STATES,
  DISCOVERY_FINDING_TYPES,
  DISCOVERY_REENTRY_TARGET_BY_TYPE,
  decodeDiscoveryFindingEnvelopeV1,
  type DiscoveryCanonicalBaseIdentityV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingProvenanceV1,
  type DiscoveryFindingType,
  type DiscoveryProjectionBaseIdentityV1,
  type DiscoveryResourceRefV1,
} from './discovery-finding.js';
import { semanticStableJson, utf16OrdinalCompare } from './semantic-representation.js';
import type { SecurityContext } from './types.js';

/**
 * AKP-5 WP1 contract foundation. These values are durable governance
 * resources, not Canonical knowledge, Review decisions, Actions or workers.
 */
export const DISCOVERY_REENTRY_SCHEMA_VERSION = '1.0.0' as const;
export type DiscoveryReentrySchemaVersion = typeof DISCOVERY_REENTRY_SCHEMA_VERSION;

export const DISCOVERY_REENTRY_LOGICAL_IDENTITY_VERSION = 'discovery-reentry-identity:v1' as const;
export const DISCOVERY_DERIVED_VALIDATION_PROFILE_VERSION =
  'discovery-derived-validation:v1' as const;
export const DISCOVERY_DERIVED_VALIDATION_PROFILE_ID = 'discovery-derived-provenance' as const;

export const DISCOVERY_CANDIDATE_ORIGINS = ['SOURCE_EVIDENCE', 'DERIVED_DISCOVERY'] as const;
export type DiscoveryCandidateOriginKindV1 = (typeof DISCOVERY_CANDIDATE_ORIGINS)[number];

export const DISCOVERY_REENTRY_ELIGIBILITY_STATES = [
  'ELIGIBLE_FOR_VALIDATION',
  'NOT_ELIGIBLE',
  'STALE',
  'TERMINAL',
] as const;
export type DiscoveryReentryEligibilityV1 = (typeof DISCOVERY_REENTRY_ELIGIBILITY_STATES)[number];

export const DISCOVERY_REVIEW_ELIGIBILITY_STATES = [
  'NOT_ELIGIBLE',
  'ELIGIBLE_AFTER_VALIDATION',
] as const;
export type DiscoveryReviewEligibilityV1 = (typeof DISCOVERY_REVIEW_ELIGIBILITY_STATES)[number];

export type DiscoveryReentryManifestV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly manifestId: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly findingType: DiscoveryFindingType;
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly evidenceIds: readonly string[];
  readonly derivationProvenance: DiscoveryFindingProvenanceV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly requestedReentryPurpose: string;
  readonly createdAt: string;
};

/** Only the server supplies identity and timestamp; protected fields derive from the Finding. */
export type DiscoveryReentryManifestCreateInputV1 = {
  readonly manifestId: string;
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly requestedReentryPurpose: string;
  readonly createdAt: string;
};

export type DiscoveryReentryLogicalIdentityInputV1 =
  | Pick<
      DiscoveryReentryManifestV1,
      | 'projectId'
      | 'findingId'
      | 'findingRevision'
      | 'findingType'
      | 'sourceProjectionDigest'
      | 'canonicalBase'
      | 'requestedReentryPurpose'
    >
  | DiscoveryReentryManifestV1;

export type DiscoveryReentryLogicalIdentityV1 = {
  readonly identityVersion: typeof DISCOVERY_REENTRY_LOGICAL_IDENTITY_VERSION;
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly findingType: DiscoveryFindingType;
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly requestedReentryPurpose: string;
};

export type DiscoveryReentryLogicalIdentityResultV1 = {
  readonly identityVersion: typeof DISCOVERY_REENTRY_LOGICAL_IDENTITY_VERSION;
  readonly logicalIdentityKey: string;
  readonly idempotencyKey: string;
  readonly normalizedInput: DiscoveryReentryLogicalIdentityV1;
};

export type DiscoveryCandidateOriginSourceEvidenceV1 = {
  readonly origin: 'SOURCE_EVIDENCE';
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly [string, ...string[]];
};

export type DiscoveryCandidateOriginDerivedDiscoveryV1 = {
  readonly origin: 'DERIVED_DISCOVERY';
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly findingType: DiscoveryFindingType;
  readonly manifestId: string;
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly relatedResourceRefs: readonly DiscoveryApprovedResourceRevisionRefV1[];
  readonly evidenceIds: readonly string[];
  readonly derivationProvenance: DiscoveryFindingProvenanceV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
};

export type DiscoveryCandidateOriginV1 =
  DiscoveryCandidateOriginSourceEvidenceV1 | DiscoveryCandidateOriginDerivedDiscoveryV1;

/**
 * Server-resolved revision at the governance boundary. This is deliberately
 * distinct from the raw Finding ResourceRef, because a Finding may preserve
 * an unversioned CURRENT observation.
 */
export type DiscoveryApprovedResourceRevisionRefV1 = Omit<
  DiscoveryResourceRefV1,
  'resourceState' | 'resourceRevision'
> & {
  readonly resourceState: 'APPROVED';
  readonly resourceRevision: string;
};

export type DiscoveryDerivedValidationProfileV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly profileId: typeof DISCOVERY_DERIVED_VALIDATION_PROFILE_ID;
  readonly profileVersion: typeof DISCOVERY_DERIVED_VALIDATION_PROFILE_VERSION;
  readonly origin: 'DERIVED_DISCOVERY';
  readonly requiredLineage: readonly [
    'FINDING',
    'REENTRY_MANIFEST',
    'CANONICAL_BASE',
    'DISCOVERY_BASE',
    'APPROVED_RESOURCE_REVISIONS',
    'EVIDENCE_LINEAGE',
    'DERIVATION_PROVENANCE',
  ];
};

export const DISCOVERY_DERIVED_VALIDATION_PROFILE_V1: DiscoveryDerivedValidationProfileV1 = {
  schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
  profileId: DISCOVERY_DERIVED_VALIDATION_PROFILE_ID,
  profileVersion: DISCOVERY_DERIVED_VALIDATION_PROFILE_VERSION,
  origin: 'DERIVED_DISCOVERY',
  requiredLineage: [
    'FINDING',
    'REENTRY_MANIFEST',
    'CANONICAL_BASE',
    'DISCOVERY_BASE',
    'APPROVED_RESOURCE_REVISIONS',
    'EVIDENCE_LINEAGE',
    'DERIVATION_PROVENANCE',
  ],
};

export type DerivedKnowledgeCandidateV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly projectId: string;
  /** This candidate family is never a SOURCE_EVIDENCE ClaimCandidate. */
  readonly origin: 'DERIVED_DISCOVERY';
  readonly manifestId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly findingType: DiscoveryFindingType;
  readonly governanceTarget: (typeof DISCOVERY_REENTRY_TARGET_BY_TYPE)[DiscoveryFindingType];
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly relatedResourceRefs: readonly DiscoveryApprovedResourceRevisionRefV1[];
  readonly evidenceIds: readonly string[];
  readonly derivationProvenance: DiscoveryFindingProvenanceV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly validationProfile: DiscoveryDerivedValidationProfileV1;
  readonly reentryEligibility: DiscoveryReentryEligibilityV1;
  readonly reviewEligibility: DiscoveryReviewEligibilityV1;
  /** Present only for ACTION_SUGGESTION and never authorizes execution. */
  readonly actionExecutionStatus?: 'CANDIDATE_ONLY';
  readonly createdAt: string;
};

/**
 * A durable Review bridge resource produced after derived validation. This is
 * deliberately separate from `DerivedKnowledgeCandidateV1`: WP2 candidates
 * remain validation inputs and are never made Review-visible by row
 * existence. WP4 owns producing the eligible resource.
 */
export type DiscoveryReviewEvidenceLineageRefV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly evidenceId: string;
  /** Present only when this derived evidence genuinely resolves to Source data. */
  readonly sourceId?: string;
  readonly sourceVersionId?: string;
  readonly evidenceSpanId?: string;
};

export type DiscoveryReviewContentV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly summary: string;
  readonly detail: string;
  readonly rationale: string;
  readonly expectedImpact?: string;
};

export type DiscoveryReviewValidationResultV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly artifactKind: 'VALIDATION';
  readonly artifactId: string;
  readonly artifactRevision: string;
  readonly digest: string;
};

export type DiscoveryReviewLineageV1 = {
  readonly schemaVersion: DiscoveryReentrySchemaVersion;
  readonly origin: 'DERIVED_DISCOVERY';
  readonly projectId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly findingType: DiscoveryFindingType;
  readonly manifestId: string;
  readonly governanceTarget: (typeof DISCOVERY_REENTRY_TARGET_BY_TYPE)[DiscoveryFindingType];
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly relatedResourceRefs: readonly DiscoveryApprovedResourceRevisionRefV1[];
  readonly evidenceIds: readonly string[];
  readonly derivationProvenance: DiscoveryFindingProvenanceV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly validationProfile: DiscoveryDerivedValidationProfileV1;
  readonly validationResult: DiscoveryReviewValidationResultV1;
};

export type DiscoveryReviewResourceV1 = DiscoveryReviewLineageV1 & {
  readonly reviewResourceId: string;
  readonly resourceRevision: number;
  readonly effectiveProjectId: string;
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION';
  readonly content: DiscoveryReviewContentV1;
  readonly evidenceLineage: readonly DiscoveryReviewEvidenceLineageRefV1[];
  readonly contentDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DiscoveryReviewResourceDigestInputV1 = Omit<
  DiscoveryReviewResourceV1,
  'contentDigest' | 'createdAt' | 'updatedAt'
>;

export const DISCOVERY_REVIEW_ROOT_IDENTITY_VERSION = 'discovery-review-root-identity:v1' as const;

export type DiscoveryReviewRootIdentityInputV1 = {
  readonly projectId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly origin: 'DERIVED_DISCOVERY';
};

/**
 * Stable server-owned Review root identity. Resource revisions and mutable
 * presentation/validation wording deliberately do not participate.
 */
export const computeDiscoveryReviewRootIdentityV1 = (
  input: DiscoveryReviewRootIdentityInputV1,
): string =>
  sha256Text(
    semanticStableJson({
      identityVersion: DISCOVERY_REVIEW_ROOT_IDENTITY_VERSION,
      projectId: text(input.projectId, 'projectId'),
      candidateId: text(input.candidateId, 'candidateId'),
      candidateRevision: positiveInteger(input.candidateRevision, 'candidateRevision'),
      origin: enumValue(input.origin, ['DERIVED_DISCOVERY'] as const, 'origin'),
    }),
  );

const discoveryReviewResourceLineageFields = [
  'projectId',
  'candidateId',
  'candidateRevision',
  'origin',
  'findingId',
  'findingRevision',
  'findingType',
  'manifestId',
  'governanceTarget',
  'sourceProjectionDigest',
  'canonicalBase',
  'discoveryBase',
  'relatedResourceRefs',
  'evidenceIds',
  'derivationProvenance',
  'accessScope',
  'sensitivity',
  'validationProfile',
] as const;

/**
 * Review resources are normalized projections, not a second author of WP2
 * lineage. Review eligibility is intentionally excluded because WP2's
 * candidate remains NOT_ELIGIBLE while the later bridge resource can be
 * ELIGIBLE_AFTER_VALIDATION.
 */
export const assertDiscoveryReviewResourceMatchesCandidateV1 = (
  resource: DiscoveryReviewResourceV1,
  candidate: DerivedKnowledgeCandidateV1,
): void => {
  for (const field of discoveryReviewResourceLineageFields) {
    if (sameJson(resource[field], candidate[field])) continue;
    return fail(
      `discoveryReviewResource.${field}`,
      'must exactly preserve the authoritative WP2 candidate lineage',
    );
  }
};

export const discoveryReviewResourceContentDigestV1 = (
  input: DiscoveryReviewResourceDigestInputV1,
): string => sha256Text(semanticStableJson(input));

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

const isoTimestamp = (value: unknown, path: string): string => {
  const timestamp = text(value, path);
  if (Number.isNaN(Date.parse(timestamp))) return fail(path, 'must be an ISO timestamp');
  return timestamp;
};

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

const sensitivityValues = ['public', 'internal', 'private', 'restricted'] as const;
const sensitivityRank: Readonly<Record<SecurityContext['sensitivity'], number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const decodeCanonicalBase = (value: unknown, path: string): DiscoveryCanonicalBaseIdentityV1 => {
  const object = strictObject(value, ['schemaVersion', 'canonicalVersion', 'snapshotDigest'], path);
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
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
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    projectionDigest: text(required(object, 'projectionDigest', path), `${path}.projectionDigest`),
  };
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
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  const resourceKind = enumValue(
    required(object, 'resourceKind', path),
    [
      'CANONICAL_CLAIM',
      'CANONICAL_ENTITY',
      'CANONICAL_EVENT',
      'CANONICAL_RELATION',
      'CANONICAL_CONFLICT',
      'CANONICAL_DECISION',
      'SOURCE',
      'SOURCE_VERSION',
      'COMPILED_TRUTH_ITEM',
    ] as const,
    `${path}.resourceKind`,
  );
  const resourceState = enumValue(
    required(object, 'resourceState', path),
    ['CURRENT', 'APPROVED'] as const,
    `${path}.resourceState`,
  );
  const resourceRevision =
    object.resourceRevision === undefined
      ? undefined
      : text(object.resourceRevision, `${path}.resourceRevision`);
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    resourceKind,
    resourceId: text(required(object, 'resourceId', path), `${path}.resourceId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    resourceState,
    ...(resourceRevision === undefined ? {} : { resourceRevision }),
  };
};

const resourceRefKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

const decodeResourceRefs = (value: unknown, path: string): readonly DiscoveryResourceRefV1[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  const refs = value.map((entry, index) => decodeResourceRef(entry, `${path}[${index}]`));
  const keys = refs.map(resourceRefKey);
  if (new Set(keys).size !== keys.length)
    return fail(path, 'must not contain duplicate references');
  return refs;
};

const resourceIdentityKey = (resource: DiscoveryResourceRefV1): string =>
  [resource.projectId, resource.resourceKind, resource.resourceId].join('\u0000');

const decodeApprovedResourceRef = (
  value: unknown,
  path: string,
): DiscoveryApprovedResourceRevisionRefV1 => {
  const resource = decodeResourceRef(value, path);
  if (resource.resourceState !== 'APPROVED') {
    return fail(`${path}.resourceState`, 'must be APPROVED for governance resolution');
  }
  if (resource.resourceRevision === undefined) {
    return fail(`${path}.resourceRevision`, 'is required for governance resolution');
  }
  return {
    ...resource,
    resourceState: 'APPROVED',
    resourceRevision: resource.resourceRevision,
  };
};

const decodeApprovedResourceRefs = (
  value: unknown,
  path: string,
): readonly DiscoveryApprovedResourceRevisionRefV1[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  const refs = value.map((entry, index) => decodeApprovedResourceRef(entry, `${path}[${index}]`));
  const keys = refs.map(resourceIdentityKey);
  if (new Set(keys).size !== keys.length) {
    return fail(path, 'must not contain duplicate resolved resource identities');
  }
  return refs;
};

export const decodeDiscoveryApprovedResourceRevisionRefV1 = (
  value: unknown,
  path = 'approvedResourceRevisionRef',
): DiscoveryApprovedResourceRevisionRefV1 => decodeApprovedResourceRef(value, path);

export const decodeDiscoveryApprovedResourceRevisionRefsV1 = (
  value: unknown,
  path = 'approvedResourceRevisionRefs',
): readonly DiscoveryApprovedResourceRevisionRefV1[] => decodeApprovedResourceRefs(value, path);

/**
 * Validates the server-authoritative revision set without performing a lookup.
 * The original Finding/Manifest refs remain immutable lineage; the returned
 * refs are the approved revisions consumed by derived validation.
 */
export const validateDiscoveryApprovedResourceRevisionResolutionV1 = (
  originalRefs: readonly DiscoveryResourceRefV1[],
  resolvedRefs: unknown,
  path = 'approvedResourceRevisionRefs',
): readonly DiscoveryApprovedResourceRevisionRefV1[] => {
  const original = originalRefs.map((entry, index) =>
    decodeResourceRef(entry, `originalRelatedResourceRefs[${index}]`),
  );
  const originalKeys = original.map(resourceIdentityKey);
  if (new Set(originalKeys).size !== originalKeys.length) {
    return fail('originalRelatedResourceRefs', 'must not contain duplicate resource identities');
  }
  const resolved = decodeApprovedResourceRefs(resolvedRefs, path);
  if (resolved.length !== original.length) {
    return fail(path, 'must contain exactly one resolved ref per original resource');
  }
  const resolvedByKey = new Map(resolved.map((entry) => [resourceIdentityKey(entry), entry]));
  for (const [index, key] of originalKeys.entries()) {
    if (!resolvedByKey.has(key)) {
      return fail(
        `${path}[${index}]`,
        'must preserve projectId, resourceKind and resourceId from original lineage',
      );
    }
  }
  return originalKeys.map((key) => resolvedByKey.get(key)!);
};

const decodeDeterministicProvenance = (
  value: unknown,
  path: string,
): Omit<
  DiscoveryFindingProvenanceV1 & { readonly kind: 'DETERMINISTIC' },
  'schemaVersion' | 'kind'
> => {
  const object = strictObject(value, ['ruleId', 'ruleVersion', 'inputDigest'], path);
  return {
    ruleId: text(required(object, 'ruleId', path), `${path}.ruleId`),
    ruleVersion: text(required(object, 'ruleVersion', path), `${path}.ruleVersion`),
    inputDigest: text(required(object, 'inputDigest', path), `${path}.inputDigest`),
  };
};

const decodeAiProvenance = (
  value: unknown,
  path: string,
): Omit<
  DiscoveryFindingProvenanceV1 & { readonly kind: 'AI_ASSISTED' },
  'schemaVersion' | 'kind'
> => {
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

const decodeProvenance = (value: unknown, path: string): DiscoveryFindingProvenanceV1 => {
  const object = objectValue(value, path);
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  const kind = enumValue(
    required(object, 'kind', path),
    ['DETERMINISTIC', 'AI_ASSISTED', 'HYBRID'] as const,
    `${path}.kind`,
  );
  if (kind === 'DETERMINISTIC') {
    const strict = strictObject(
      value,
      ['schemaVersion', 'kind', 'ruleId', 'ruleVersion', 'inputDigest'],
      path,
    );
    return {
      schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
      kind,
      ...decodeDeterministicProvenance(
        {
          ruleId: strict.ruleId,
          ruleVersion: strict.ruleVersion,
          inputDigest: strict.inputDigest,
        },
        path,
      ),
    };
  }
  if (kind === 'AI_ASSISTED') {
    const strict = strictObject(
      value,
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
      schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
      kind,
      ...decodeAiProvenance(
        Object.fromEntries(
          Object.keys(strict)
            .filter((key) => key !== 'schemaVersion' && key !== 'kind')
            .map((key) => [key, strict[key]]),
        ),
        path,
      ),
    };
  }
  const strict = strictObject(
    value,
    ['schemaVersion', 'kind', 'deterministic', 'aiExecution'],
    path,
  );
  const deterministic = strictObject(
    required(strict, 'deterministic', path),
    ['ruleId', 'ruleVersion', 'inputDigest'],
    `${path}.deterministic`,
  );
  const aiExecution = strictObject(
    required(strict, 'aiExecution', path),
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
    `${path}.aiExecution`,
  );
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    kind,
    deterministic: decodeDeterministicProvenance(deterministic, `${path}.deterministic`),
    aiExecution: decodeAiProvenance(aiExecution, `${path}.aiExecution`),
  };
};

const decodeSensitivity = (value: unknown, path: string): SecurityContext['sensitivity'] =>
  enumValue(value, sensitivityValues, path);

const decodeManifestCore = (value: unknown, path: string): DiscoveryReentryManifestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'manifestId',
      'projectId',
      'findingId',
      'findingRevision',
      'findingType',
      'sourceProjectionDigest',
      'canonicalBase',
      'relatedResourceRefs',
      'evidenceIds',
      'derivationProvenance',
      'accessScope',
      'sensitivity',
      'requestedReentryPurpose',
      'createdAt',
    ],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  const projectId = text(required(object, 'projectId', path), `${path}.projectId`);
  const relatedResourceRefs = decodeResourceRefs(
    required(object, 'relatedResourceRefs', path),
    `${path}.relatedResourceRefs`,
  );
  for (const [index, resource] of relatedResourceRefs.entries()) {
    if (resource.projectId !== projectId) {
      return fail(`${path}.relatedResourceRefs[${index}].projectId`, 'must match projectId');
    }
  }
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    projectId,
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    findingType: enumValue(
      required(object, 'findingType', path),
      DISCOVERY_FINDING_TYPES,
      `${path}.findingType`,
    ),
    sourceProjectionDigest: text(
      required(object, 'sourceProjectionDigest', path),
      `${path}.sourceProjectionDigest`,
    ),
    canonicalBase: decodeCanonicalBase(
      required(object, 'canonicalBase', path),
      `${path}.canonicalBase`,
    ),
    relatedResourceRefs,
    evidenceIds: stringArray(required(object, 'evidenceIds', path), `${path}.evidenceIds`),
    derivationProvenance: decodeProvenance(
      required(object, 'derivationProvenance', path),
      `${path}.derivationProvenance`,
    ),
    accessScope: normalizedScope(required(object, 'accessScope', path), `${path}.accessScope`),
    sensitivity: decodeSensitivity(required(object, 'sensitivity', path), `${path}.sensitivity`),
    requestedReentryPurpose: text(
      required(object, 'requestedReentryPurpose', path),
      `${path}.requestedReentryPurpose`,
    ),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
  };
};

export const decodeDiscoveryReentryManifestV1 = (
  value: unknown,
  path = 'discoveryReentryManifest',
): DiscoveryReentryManifestV1 => decodeManifestCore(value, path);

const sameJson = (left: unknown, right: unknown): boolean =>
  semanticStableJson(left) === semanticStableJson(right);

const isSubset = (subset: readonly string[], superset: readonly string[]): boolean =>
  subset.every((entry) => superset.includes(entry));

/** Validates all protected manifest bindings against the server-owned Finding. */
export const assertDiscoveryReentryManifestMatchesFindingV1 = (
  manifest: DiscoveryReentryManifestV1,
  finding: DiscoveryFindingEnvelopeV1,
): void => {
  if (manifest.projectId !== finding.projectId)
    return fail('manifest.projectId', 'must match finding.projectId');
  if (manifest.findingId !== finding.findingId)
    return fail('manifest.findingId', 'must match finding.findingId');
  if (manifest.findingRevision !== finding.findingRevision) {
    return fail('manifest.findingRevision', 'must match finding.findingRevision');
  }
  if (manifest.findingType !== finding.findingType)
    return fail('manifest.findingType', 'must match finding.findingType');
  if (manifest.sourceProjectionDigest !== finding.sourceProjectionDigest) {
    return fail('manifest.sourceProjectionDigest', 'must match finding.sourceProjectionDigest');
  }
  if (!sameJson(manifest.canonicalBase, finding.canonicalBase)) {
    return fail('manifest.canonicalBase', 'must match finding.canonicalBase');
  }
  if (!sameJson(manifest.relatedResourceRefs, finding.relatedResourceRefs)) {
    return fail('manifest.relatedResourceRefs', 'must preserve finding resource lineage');
  }
  if (!sameJson(manifest.evidenceIds, finding.evidenceIds)) {
    return fail('manifest.evidenceIds', 'must preserve finding Evidence lineage');
  }
  if (!sameJson(manifest.derivationProvenance, finding.provenance)) {
    return fail('manifest.derivationProvenance', 'must preserve finding derivation provenance');
  }
  if (!isSubset(manifest.accessScope, finding.accessScope)) {
    return fail('manifest.accessScope', 'must not widen Finding access authority');
  }
  if (sensitivityRank[manifest.sensitivity] < sensitivityRank[finding.sensitivity]) {
    return fail('manifest.sensitivity', 'must not weaken Finding sensitivity');
  }
};

export const createDiscoveryReentryManifestV1 = (
  input: DiscoveryReentryManifestCreateInputV1,
): DiscoveryReentryManifestV1 => {
  const finding = decodeDiscoveryFindingEnvelopeV1(input.finding, 'finding');
  const manifest = decodeManifestCore(
    {
      schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
      manifestId: input.manifestId,
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      findingType: finding.findingType,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: finding.canonicalBase,
      relatedResourceRefs: finding.relatedResourceRefs,
      evidenceIds: finding.evidenceIds,
      derivationProvenance: finding.provenance,
      accessScope: finding.accessScope,
      sensitivity: finding.sensitivity,
      requestedReentryPurpose: input.requestedReentryPurpose,
      createdAt: input.createdAt,
    },
    'discoveryReentryManifest',
  );
  assertDiscoveryReentryManifestMatchesFindingV1(manifest, finding);
  return manifest;
};

export const createDiscoveryReentryManifestFromFindingV1 = createDiscoveryReentryManifestV1;

const normalizeLogicalIdentity = (
  input: DiscoveryReentryLogicalIdentityInputV1,
): DiscoveryReentryLogicalIdentityV1 => ({
  identityVersion: DISCOVERY_REENTRY_LOGICAL_IDENTITY_VERSION,
  projectId: text(input.projectId, 'projectId'),
  findingId: text(input.findingId, 'findingId'),
  findingRevision: positiveInteger(input.findingRevision, 'findingRevision'),
  findingType: enumValue(input.findingType, DISCOVERY_FINDING_TYPES, 'findingType'),
  sourceProjectionDigest: text(input.sourceProjectionDigest, 'sourceProjectionDigest'),
  canonicalBase: decodeCanonicalBase(input.canonicalBase, 'canonicalBase'),
  requestedReentryPurpose: text(input.requestedReentryPurpose, 'requestedReentryPurpose'),
});

export const normalizeDiscoveryReentryLogicalIdentityV1 = normalizeLogicalIdentity;

export const computeDiscoveryReentryLogicalIdentityV1 = (
  input: DiscoveryReentryLogicalIdentityInputV1,
): DiscoveryReentryLogicalIdentityResultV1 => {
  const normalizedInput = normalizeLogicalIdentity(input);
  const logicalIdentityKey = sha256Text(semanticStableJson(normalizedInput));
  return {
    identityVersion: DISCOVERY_REENTRY_LOGICAL_IDENTITY_VERSION,
    logicalIdentityKey,
    idempotencyKey: logicalIdentityKey,
    normalizedInput,
  };
};

export const computeDiscoveryReentryIdempotencyKeyV1 = (
  input: DiscoveryReentryLogicalIdentityInputV1,
): string => computeDiscoveryReentryLogicalIdentityV1(input).idempotencyKey;

const decodeProfile = (value: unknown, path: string): DiscoveryDerivedValidationProfileV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'profileId', 'profileVersion', 'origin', 'requiredLineage'],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  enumValue(
    required(object, 'profileId', path),
    [DISCOVERY_DERIVED_VALIDATION_PROFILE_ID],
    `${path}.profileId`,
  );
  enumValue(
    required(object, 'profileVersion', path),
    [DISCOVERY_DERIVED_VALIDATION_PROFILE_VERSION],
    `${path}.profileVersion`,
  );
  enumValue(required(object, 'origin', path), ['DERIVED_DISCOVERY'] as const, `${path}.origin`);
  const lineage = stringArray(required(object, 'requiredLineage', path), `${path}.requiredLineage`);
  const expected = DISCOVERY_DERIVED_VALIDATION_PROFILE_V1.requiredLineage;
  if (
    lineage.length !== expected.length ||
    lineage.some((entry, index) => entry !== expected[index])
  ) {
    return fail(`${path}.requiredLineage`, 'must match the versioned derived lineage profile');
  }
  return DISCOVERY_DERIVED_VALIDATION_PROFILE_V1;
};

export const decodeDiscoveryDerivedValidationProfileV1 = (
  value: unknown,
  path = 'discoveryDerivedValidationProfile',
): DiscoveryDerivedValidationProfileV1 => decodeProfile(value, path);

export const createDiscoveryDerivedValidationProfileV1 = (): DiscoveryDerivedValidationProfileV1 =>
  DISCOVERY_DERIVED_VALIDATION_PROFILE_V1;

const decodeEligibility = (value: unknown, path: string): DiscoveryReentryEligibilityV1 =>
  enumValue(value, DISCOVERY_REENTRY_ELIGIBILITY_STATES, path);

const decodeReviewEligibility = (value: unknown, path: string): DiscoveryReviewEligibilityV1 =>
  enumValue(value, DISCOVERY_REVIEW_ELIGIBILITY_STATES, path);

const decodeReviewEvidenceLineage = (
  value: unknown,
  path: string,
): DiscoveryReviewEvidenceLineageRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'evidenceId', 'sourceId', 'sourceVersionId', 'evidenceSpanId'],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  const sourceId =
    object.sourceId === undefined ? undefined : text(object.sourceId, `${path}.sourceId`);
  const sourceVersionId =
    object.sourceVersionId === undefined
      ? undefined
      : text(object.sourceVersionId, `${path}.sourceVersionId`);
  const evidenceSpanId =
    object.evidenceSpanId === undefined
      ? undefined
      : text(object.evidenceSpanId, `${path}.evidenceSpanId`);
  const sourceFields = [sourceId, sourceVersionId, evidenceSpanId];
  if (
    sourceFields.some((field) => field !== undefined) &&
    sourceFields.some((field) => field === undefined)
  ) {
    return fail(
      `${path}.sourceId`,
      'sourceId, sourceVersionId and evidenceSpanId must be supplied together',
    );
  }
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    evidenceId: text(required(object, 'evidenceId', path), `${path}.evidenceId`),
    ...(sourceId === undefined ? {} : { sourceId, sourceVersionId, evidenceSpanId }),
  };
};

const decodeReviewContent = (value: unknown, path: string): DiscoveryReviewContentV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'summary', 'detail', 'rationale', 'expectedImpact'],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    summary: text(required(object, 'summary', path), `${path}.summary`),
    detail: text(required(object, 'detail', path), `${path}.detail`),
    rationale: text(required(object, 'rationale', path), `${path}.rationale`),
    ...(object.expectedImpact === undefined
      ? {}
      : { expectedImpact: text(object.expectedImpact, `${path}.expectedImpact`) }),
  };
};

const decodeReviewValidationResult = (
  value: unknown,
  path: string,
): DiscoveryReviewValidationResultV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'artifactKind', 'artifactId', 'artifactRevision', 'digest'],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  enumValue(
    required(object, 'artifactKind', path),
    ['VALIDATION'] as const,
    `${path}.artifactKind`,
  );
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    artifactKind: 'VALIDATION',
    artifactId: text(required(object, 'artifactId', path), `${path}.artifactId`),
    artifactRevision: text(required(object, 'artifactRevision', path), `${path}.artifactRevision`),
    digest: text(required(object, 'digest', path), `${path}.digest`),
  };
};

const decodeReviewLineage = (value: unknown, path: string): DiscoveryReviewLineageV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'origin',
      'projectId',
      'candidateId',
      'candidateRevision',
      'findingId',
      'findingRevision',
      'findingType',
      'manifestId',
      'governanceTarget',
      'sourceProjectionDigest',
      'canonicalBase',
      'discoveryBase',
      'relatedResourceRefs',
      'evidenceIds',
      'derivationProvenance',
      'accessScope',
      'sensitivity',
      'validationProfile',
      'validationResult',
    ],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  enumValue(required(object, 'origin', path), ['DERIVED_DISCOVERY'] as const, `${path}.origin`);
  const projectId = text(required(object, 'projectId', path), `${path}.projectId`);
  const findingType = enumValue(
    required(object, 'findingType', path),
    DISCOVERY_FINDING_TYPES,
    `${path}.findingType`,
  );
  const relatedResourceRefs = decodeApprovedResourceRefs(
    required(object, 'relatedResourceRefs', path),
    `${path}.relatedResourceRefs`,
  );
  if (relatedResourceRefs.some((ref) => ref.projectId !== projectId)) {
    return fail(`${path}.relatedResourceRefs`, 'must remain project-scoped');
  }
  const governanceTarget = enumValue(
    required(object, 'governanceTarget', path),
    Object.values(DISCOVERY_REENTRY_TARGET_BY_TYPE),
    `${path}.governanceTarget`,
  );
  if (governanceTarget !== DISCOVERY_REENTRY_TARGET_BY_TYPE[findingType]) {
    return fail(`${path}.governanceTarget`, 'must match findingType mapping');
  }
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    origin: 'DERIVED_DISCOVERY',
    projectId,
    candidateId: text(required(object, 'candidateId', path), `${path}.candidateId`),
    candidateRevision: positiveInteger(
      required(object, 'candidateRevision', path),
      `${path}.candidateRevision`,
    ),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    findingType,
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    governanceTarget,
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
    relatedResourceRefs,
    evidenceIds: stringArray(required(object, 'evidenceIds', path), `${path}.evidenceIds`),
    derivationProvenance: decodeProvenance(
      required(object, 'derivationProvenance', path),
      `${path}.derivationProvenance`,
    ),
    accessScope: normalizedScope(required(object, 'accessScope', path), `${path}.accessScope`),
    sensitivity: decodeSensitivity(required(object, 'sensitivity', path), `${path}.sensitivity`),
    validationProfile: decodeProfile(
      required(object, 'validationProfile', path),
      `${path}.validationProfile`,
    ),
    validationResult: decodeReviewValidationResult(
      required(object, 'validationResult', path),
      `${path}.validationResult`,
    ),
  };
};

export const decodeDiscoveryReviewLineageV1 = (
  value: unknown,
  path = 'discoveryReviewLineage',
): DiscoveryReviewLineageV1 => decodeReviewLineage(value, path);

export const decodeDiscoveryReviewResourceV1 = (
  value: unknown,
  path = 'discoveryReviewResource',
): DiscoveryReviewResourceV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'origin',
      'projectId',
      'candidateId',
      'candidateRevision',
      'findingId',
      'findingRevision',
      'findingType',
      'manifestId',
      'governanceTarget',
      'sourceProjectionDigest',
      'canonicalBase',
      'discoveryBase',
      'relatedResourceRefs',
      'evidenceIds',
      'derivationProvenance',
      'accessScope',
      'sensitivity',
      'validationProfile',
      'validationResult',
      'reviewResourceId',
      'resourceRevision',
      'effectiveProjectId',
      'lifecycleState',
      'reviewEligibility',
      'content',
      'evidenceLineage',
      'contentDigest',
      'createdAt',
      'updatedAt',
    ],
    path,
  );
  const lineage = decodeReviewLineage(
    {
      schemaVersion: object.schemaVersion,
      origin: object.origin,
      projectId: object.projectId,
      candidateId: object.candidateId,
      candidateRevision: object.candidateRevision,
      findingId: object.findingId,
      findingRevision: object.findingRevision,
      findingType: object.findingType,
      manifestId: object.manifestId,
      governanceTarget: object.governanceTarget,
      sourceProjectionDigest: object.sourceProjectionDigest,
      canonicalBase: object.canonicalBase,
      discoveryBase: object.discoveryBase,
      relatedResourceRefs: object.relatedResourceRefs,
      evidenceIds: object.evidenceIds,
      derivationProvenance: object.derivationProvenance,
      accessScope: object.accessScope,
      sensitivity: object.sensitivity,
      validationProfile: object.validationProfile,
      validationResult: object.validationResult,
    },
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  const lifecycleState = enumValue(
    required(object, 'lifecycleState', path),
    DISCOVERY_FINDING_LIFECYCLE_STATES,
    `${path}.lifecycleState`,
  );
  if (lifecycleState !== 'REVIEW_READY') {
    return fail(`${path}.lifecycleState`, 'Review resources must be in REVIEW_READY state');
  }
  const effectiveProjectId = text(
    required(object, 'effectiveProjectId', path),
    `${path}.effectiveProjectId`,
  );
  if (effectiveProjectId !== lineage.projectId) {
    return fail(
      `${path}.effectiveProjectId`,
      'must match projectId for a project-scoped Review resource',
    );
  }
  const reviewEligibility = enumValue(
    required(object, 'reviewEligibility', path),
    ['ELIGIBLE_AFTER_VALIDATION'] as const,
    `${path}.reviewEligibility`,
  );
  const evidenceLineageValue = required(object, 'evidenceLineage', path);
  if (!Array.isArray(evidenceLineageValue)) {
    return fail(`${path}.evidenceLineage`, 'must be an array');
  }
  const evidenceLineage = evidenceLineageValue.map((entry, index) =>
    decodeReviewEvidenceLineage(entry, `${path}.evidenceLineage[${index}]`),
  );
  const evidenceIds = new Set(lineage.evidenceIds);
  if (new Set(evidenceLineage.map((entry) => entry.evidenceId)).size !== evidenceLineage.length) {
    return fail(`${path}.evidenceLineage`, 'must not contain duplicate evidence identities');
  }
  if (evidenceLineage.some((entry) => !evidenceIds.has(entry.evidenceId))) {
    return fail(`${path}.evidenceLineage`, 'must preserve evidenceIds lineage');
  }
  const resource: DiscoveryReviewResourceV1 = {
    ...lineage,
    reviewResourceId: text(required(object, 'reviewResourceId', path), `${path}.reviewResourceId`),
    resourceRevision: positiveInteger(
      required(object, 'resourceRevision', path),
      `${path}.resourceRevision`,
    ),
    effectiveProjectId,
    lifecycleState,
    reviewEligibility,
    content: decodeReviewContent(required(object, 'content', path), `${path}.content`),
    evidenceLineage,
    contentDigest: text(required(object, 'contentDigest', path), `${path}.contentDigest`),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
  };
  const expectedReviewResourceId = computeDiscoveryReviewRootIdentityV1({
    projectId: resource.projectId,
    candidateId: resource.candidateId,
    candidateRevision: resource.candidateRevision,
    origin: resource.origin,
  });
  if (resource.reviewResourceId !== expectedReviewResourceId) {
    return fail(
      `${path}.reviewResourceId`,
      `must equal the server-owned stable Review root identity ${expectedReviewResourceId}`,
    );
  }
  const digestInput = Object.fromEntries(
    Object.entries(resource).filter(
      ([key]) => !['contentDigest', 'createdAt', 'updatedAt'].includes(key),
    ),
  ) as unknown as DiscoveryReviewResourceDigestInputV1;
  if (resource.contentDigest !== discoveryReviewResourceContentDigestV1(digestInput)) {
    return fail(`${path}.contentDigest`, 'must match the normalized immutable resource content');
  }
  return resource;
};

const decodeDerivedCandidateCore = (value: unknown, path: string): DerivedKnowledgeCandidateV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'candidateId',
      'candidateRevision',
      'projectId',
      'origin',
      'manifestId',
      'findingId',
      'findingRevision',
      'findingType',
      'governanceTarget',
      'sourceProjectionDigest',
      'canonicalBase',
      'discoveryBase',
      'relatedResourceRefs',
      'evidenceIds',
      'derivationProvenance',
      'accessScope',
      'sensitivity',
      'validationProfile',
      'reentryEligibility',
      'reviewEligibility',
      'actionExecutionStatus',
      'createdAt',
    ],
    path,
  );
  enumValue(
    required(object, 'schemaVersion', path),
    [DISCOVERY_REENTRY_SCHEMA_VERSION],
    `${path}.schemaVersion`,
  );
  const projectId = text(required(object, 'projectId', path), `${path}.projectId`);
  const findingType = enumValue(
    required(object, 'findingType', path),
    DISCOVERY_FINDING_TYPES,
    `${path}.findingType`,
  );
  const relatedResourceRefs = decodeApprovedResourceRefs(
    required(object, 'relatedResourceRefs', path),
    `${path}.relatedResourceRefs`,
  );
  for (const [index, resource] of relatedResourceRefs.entries()) {
    if (resource.projectId !== projectId) {
      return fail(`${path}.relatedResourceRefs[${index}].projectId`, 'must match projectId');
    }
  }
  const governanceTarget = enumValue(
    required(object, 'governanceTarget', path),
    Object.values(DISCOVERY_REENTRY_TARGET_BY_TYPE),
    `${path}.governanceTarget`,
  );
  if (governanceTarget !== DISCOVERY_REENTRY_TARGET_BY_TYPE[findingType]) {
    return fail(`${path}.governanceTarget`, 'must match findingType mapping');
  }
  const actionExecutionStatus =
    object.actionExecutionStatus === undefined
      ? undefined
      : enumValue(
          object.actionExecutionStatus,
          ['CANDIDATE_ONLY'] as const,
          `${path}.actionExecutionStatus`,
        );
  if (findingType === 'ACTION_SUGGESTION' && actionExecutionStatus !== 'CANDIDATE_ONLY') {
    return fail(`${path}.actionExecutionStatus`, 'ACTION_SUGGESTION must remain candidate-only');
  }
  if (findingType !== 'ACTION_SUGGESTION' && actionExecutionStatus !== undefined) {
    return fail(`${path}.actionExecutionStatus`, 'is only valid for ACTION_SUGGESTION');
  }
  const reviewEligibility = decodeReviewEligibility(
    required(object, 'reviewEligibility', path),
    `${path}.reviewEligibility`,
  );
  if (reviewEligibility !== 'NOT_ELIGIBLE') {
    return fail(
      `${path}.reviewEligibility`,
      'raw derived validation input cannot be Review eligible',
    );
  }
  return {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    candidateId: text(required(object, 'candidateId', path), `${path}.candidateId`),
    candidateRevision: positiveInteger(
      required(object, 'candidateRevision', path),
      `${path}.candidateRevision`,
    ),
    projectId,
    origin: enumValue(
      required(object, 'origin', path),
      ['DERIVED_DISCOVERY'] as const,
      `${path}.origin`,
    ),
    manifestId: text(required(object, 'manifestId', path), `${path}.manifestId`),
    findingId: text(required(object, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(object, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    findingType,
    governanceTarget,
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
    relatedResourceRefs,
    evidenceIds: stringArray(required(object, 'evidenceIds', path), `${path}.evidenceIds`),
    derivationProvenance: decodeProvenance(
      required(object, 'derivationProvenance', path),
      `${path}.derivationProvenance`,
    ),
    accessScope: normalizedScope(required(object, 'accessScope', path), `${path}.accessScope`),
    sensitivity: decodeSensitivity(required(object, 'sensitivity', path), `${path}.sensitivity`),
    validationProfile: decodeProfile(
      required(object, 'validationProfile', path),
      `${path}.validationProfile`,
    ),
    reentryEligibility: decodeEligibility(
      required(object, 'reentryEligibility', path),
      `${path}.reentryEligibility`,
    ),
    reviewEligibility,
    ...(actionExecutionStatus === undefined ? {} : { actionExecutionStatus }),
    createdAt: isoTimestamp(required(object, 'createdAt', path), `${path}.createdAt`),
  };
};

export const decodeDerivedKnowledgeCandidateV1 = (
  value: unknown,
  path = 'derivedKnowledgeCandidate',
): DerivedKnowledgeCandidateV1 => decodeDerivedCandidateCore(value, path);

export type DerivedKnowledgeCandidateCreateInputV1 = {
  readonly candidateId: string;
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly manifest: DiscoveryReentryManifestV1;
  /** Required server-authoritative resolution; never copied from Finding/Manifest. */
  readonly approvedRelatedResourceRefs: readonly DiscoveryApprovedResourceRevisionRefV1[];
  readonly validationProfile?: DiscoveryDerivedValidationProfileV1;
  readonly createdAt: string;
};

export const deriveDiscoveryReentryEligibilityV1 = (
  lifecycleState: DiscoveryFindingLifecycleState,
): DiscoveryReentryEligibilityV1 => {
  if (!DISCOVERY_FINDING_LIFECYCLE_STATES.includes(lifecycleState)) {
    return fail('lifecycleState', 'must use the existing Finding lifecycle vocabulary');
  }
  if (lifecycleState === 'NEW' || lifecycleState === 'VALIDATING') return 'ELIGIBLE_FOR_VALIDATION';
  if (lifecycleState === 'STALE') return 'STALE';
  if (['DISMISSED', 'SUPPRESSED', 'RESOLVED', 'SUPERSEDED'].includes(lifecycleState)) {
    return 'TERMINAL';
  }
  return 'NOT_ELIGIBLE';
};

export const deriveDiscoveryReviewEligibilityV1 = (input: {
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly derivedValidationComplete: boolean;
  readonly comparisonPreparationComplete: boolean;
  readonly stale: boolean;
}): DiscoveryReviewEligibilityV1 => {
  if (!DISCOVERY_FINDING_LIFECYCLE_STATES.includes(input.lifecycleState)) {
    return fail('lifecycleState', 'must use the existing Finding lifecycle vocabulary');
  }
  if (
    input.lifecycleState === 'REVIEW_READY' &&
    input.derivedValidationComplete &&
    input.comparisonPreparationComplete &&
    !input.stale
  ) {
    return 'ELIGIBLE_AFTER_VALIDATION';
  }
  return 'NOT_ELIGIBLE';
};

export const createDerivedKnowledgeCandidateV1 = (
  input: DerivedKnowledgeCandidateCreateInputV1,
): DerivedKnowledgeCandidateV1 => {
  const finding = decodeDiscoveryFindingEnvelopeV1(input.finding, 'finding');
  const manifest = decodeDiscoveryReentryManifestV1(input.manifest, 'manifest');
  assertDiscoveryReentryManifestMatchesFindingV1(manifest, finding);
  const eligibility = deriveDiscoveryReentryEligibilityV1(finding.lifecycleState);
  if (eligibility !== 'ELIGIBLE_FOR_VALIDATION') {
    return fail(
      'finding.lifecycleState',
      `cannot enter derived validation from ${finding.lifecycleState}`,
    );
  }
  const approvedRelatedResourceRefs = validateDiscoveryApprovedResourceRevisionResolutionV1(
    manifest.relatedResourceRefs,
    input.approvedRelatedResourceRefs,
  );
  const validationProfile = decodeProfile(
    input.validationProfile ?? DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
    'validationProfile',
  );
  const candidate = {
    schemaVersion: DISCOVERY_REENTRY_SCHEMA_VERSION,
    candidateId: input.candidateId,
    candidateRevision: 1,
    projectId: finding.projectId,
    origin: 'DERIVED_DISCOVERY' as const,
    manifestId: manifest.manifestId,
    findingId: finding.findingId,
    findingRevision: finding.findingRevision,
    findingType: finding.findingType,
    governanceTarget: DISCOVERY_REENTRY_TARGET_BY_TYPE[finding.findingType],
    sourceProjectionDigest: finding.sourceProjectionDigest,
    canonicalBase: finding.canonicalBase,
    discoveryBase: finding.discoveryBase,
    relatedResourceRefs: approvedRelatedResourceRefs,
    evidenceIds: manifest.evidenceIds,
    derivationProvenance: manifest.derivationProvenance,
    accessScope: manifest.accessScope,
    sensitivity: manifest.sensitivity,
    validationProfile,
    reentryEligibility: eligibility,
    reviewEligibility: 'NOT_ELIGIBLE' as const,
    ...(finding.findingType === 'ACTION_SUGGESTION'
      ? { actionExecutionStatus: 'CANDIDATE_ONLY' as const }
      : {}),
    createdAt: input.createdAt,
  };
  return decodeDerivedCandidateCore(candidate, 'derivedKnowledgeCandidate');
};

export const createDerivedDiscoveryKnowledgeCandidateV1 = createDerivedKnowledgeCandidateV1;

export const decodeDiscoveryCandidateOriginV1 = (
  value: unknown,
  path = 'candidateOrigin',
): DiscoveryCandidateOriginV1 => {
  const object = objectValue(value, path);
  const origin = enumValue(
    required(object, 'origin', path),
    DISCOVERY_CANDIDATE_ORIGINS,
    `${path}.origin`,
  );
  if (origin === 'SOURCE_EVIDENCE') {
    const strict = strictObject(value, ['origin', 'sourceVersionId', 'evidenceIds'], path);
    const evidenceIds = stringArray(required(strict, 'evidenceIds', path), `${path}.evidenceIds`);
    if (evidenceIds.length === 0)
      return fail(`${path}.evidenceIds`, 'must contain direct Evidence');
    return {
      origin,
      sourceVersionId: text(required(strict, 'sourceVersionId', path), `${path}.sourceVersionId`),
      evidenceIds: evidenceIds as [string, ...string[]],
    };
  }
  const strict = strictObject(
    value,
    [
      'origin',
      'projectId',
      'findingId',
      'findingRevision',
      'findingType',
      'manifestId',
      'sourceProjectionDigest',
      'canonicalBase',
      'relatedResourceRefs',
      'evidenceIds',
      'derivationProvenance',
      'accessScope',
      'sensitivity',
    ],
    path,
  );
  const projectId = text(required(strict, 'projectId', path), `${path}.projectId`);
  const relatedResourceRefs = decodeApprovedResourceRefs(
    required(strict, 'relatedResourceRefs', path),
    `${path}.relatedResourceRefs`,
  );
  if (relatedResourceRefs.some((ref) => ref.projectId !== projectId)) {
    return fail(`${path}.relatedResourceRefs`, 'must remain project-scoped');
  }
  return {
    origin,
    projectId,
    findingId: text(required(strict, 'findingId', path), `${path}.findingId`),
    findingRevision: positiveInteger(
      required(strict, 'findingRevision', path),
      `${path}.findingRevision`,
    ),
    findingType: enumValue(
      required(strict, 'findingType', path),
      DISCOVERY_FINDING_TYPES,
      `${path}.findingType`,
    ),
    manifestId: text(required(strict, 'manifestId', path), `${path}.manifestId`),
    sourceProjectionDigest: text(
      required(strict, 'sourceProjectionDigest', path),
      `${path}.sourceProjectionDigest`,
    ),
    canonicalBase: decodeCanonicalBase(
      required(strict, 'canonicalBase', path),
      `${path}.canonicalBase`,
    ),
    relatedResourceRefs,
    evidenceIds: stringArray(required(strict, 'evidenceIds', path), `${path}.evidenceIds`),
    derivationProvenance: decodeProvenance(
      required(strict, 'derivationProvenance', path),
      `${path}.derivationProvenance`,
    ),
    accessScope: normalizedScope(required(strict, 'accessScope', path), `${path}.accessScope`),
    sensitivity: decodeSensitivity(required(strict, 'sensitivity', path), `${path}.sensitivity`),
  };
};

export const discoveryCandidateOriginFromDerivedCandidateV1 = (
  candidate: DerivedKnowledgeCandidateV1,
): DiscoveryCandidateOriginDerivedDiscoveryV1 => ({
  origin: 'DERIVED_DISCOVERY',
  projectId: candidate.projectId,
  findingId: candidate.findingId,
  findingRevision: candidate.findingRevision,
  findingType: candidate.findingType,
  manifestId: candidate.manifestId,
  sourceProjectionDigest: candidate.sourceProjectionDigest,
  canonicalBase: candidate.canonicalBase,
  relatedResourceRefs: candidate.relatedResourceRefs,
  evidenceIds: candidate.evidenceIds,
  derivationProvenance: candidate.derivationProvenance,
  accessScope: candidate.accessScope,
  sensitivity: candidate.sensitivity,
});
