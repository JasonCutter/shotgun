import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryFindingLifecycleState,
  DiscoveryProjectionBaseIdentityV1,
} from './discovery-finding.js';
import type {
  DiscoveryApprovedResourceRevisionRefV1,
  DiscoveryReviewEvidenceLineageRefV1,
} from './discovery-reentry.js';
import { semanticStableJson } from './semantic-representation.js';
import { sha256Text } from './document-evidence.js';
import type { DiscoveryFindingType } from './discovery-finding.js';

/**
 * AKP-5 WP5 freshness is a versioned, server-owned assessment.  The
 * canonical/discovery base identities are retained as historical inputs, but
 * freshness is decided from the material resources and propositions relied on
 * by a Finding.  A later unrelated Canonical commit therefore does not, by
 * itself, invalidate a review.
 */
export const DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1 =
  'discovery-reentry-freshness:v1' as const;

export const DISCOVERY_REENTRY_FRESHNESS_STATES = [
  'FRESH',
  'REVALIDATION_REQUIRED',
  'INVALIDATED',
  'AUTHORIZATION_DENIED',
  'PERSISTENCE_FAILURE',
] as const;
export type DiscoveryReentryFreshnessStateV1 = (typeof DISCOVERY_REENTRY_FRESHNESS_STATES)[number];

export type DiscoveryReentryFreshnessStageV1 =
  | 'REENTRY_INTAKE'
  | 'REVIEW_RESOURCE_MATERIALIZATION'
  | 'REVIEW_CONTEXT_MATERIALIZATION'
  | 'REVIEW_DECISION';

export const DISCOVERY_REENTRY_FRESHNESS_REASON_CODES = [
  'FINDING_NO_LONGER_ACTIVE',
  'SOURCE_PROJECTION_MATERIAL_CHANGE',
  'DISCOVERY_BASE_MATERIAL_CHANGE',
  'RELATED_RESOURCE_CHANGED',
  'RELATED_RESOURCE_UNAVAILABLE',
  'EVIDENCE_LINEAGE_CHANGED',
  'EVIDENCE_UNAVAILABLE',
  'CANONICAL_CONTEXT_MATERIAL_CHANGE',
  'ACCESS_NO_LONGER_AUTHORIZED',
  'SENSITIVITY_POLICY_CHANGED',
  'REVIEW_TARGET_SUPERSEDED',
] as const;
export type DiscoveryReentryFreshnessReasonCodeV1 =
  (typeof DISCOVERY_REENTRY_FRESHNESS_REASON_CODES)[number];

export type DiscoveryReentryFreshnessReviewTargetV1 = {
  readonly reviewResourceId: string;
  readonly resourceRevision: number;
  readonly resourceDigest: string;
};

/** Immutable server-owned lineage that a later assessment must re-check. */
export type DiscoveryReentryFreshnessBindingV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly findingType: DiscoveryFindingType;
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly manifestId?: string;
  readonly candidateId?: string;
  readonly candidateRevision?: number;
  readonly approvedRelatedResourceRefs: readonly DiscoveryApprovedResourceRevisionRefV1[];
  readonly relatedResourceMaterialDigests?: readonly {
    readonly resourceKind: string;
    readonly resourceId: string;
    readonly materialDigest: string;
  }[];
  readonly evidenceIds: readonly string[];
  readonly evidenceLineage?: readonly DiscoveryReviewEvidenceLineageRefV1[];
  readonly evidenceMaterialDigests?: readonly {
    readonly evidenceId: string;
    readonly materialDigest: string;
  }[];
  readonly derivationProvenanceDigest: string;
  readonly validationProfileVersion: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly reviewTarget?: DiscoveryReentryFreshnessReviewTargetV1;
  /** A material digest may be supplied by an authority that has one. */
  readonly canonicalContextMaterialDigest?: string;
};

export type DiscoveryReentryFreshnessResourceObservationV1 = {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly projectId: string;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly resourceRevision?: string;
  /** Digest of the relied-on proposition/resource, not a global snapshot. */
  readonly materialDigest?: string;
  readonly accessScope?: readonly string[];
  readonly sensitivity?: 'public' | 'internal' | 'private' | 'restricted';
};

export type DiscoveryReentryFreshnessEvidenceObservationV1 = {
  readonly evidenceId: string;
  readonly projectId: string;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly sourceId?: string;
  readonly sourceVersionId?: string;
  readonly evidenceSpanId?: string;
  readonly materialDigest?: string;
  readonly accessScope?: readonly string[];
  readonly sensitivity?: 'public' | 'internal' | 'private' | 'restricted';
};

export type DiscoveryReentryFreshnessCurrentStateV1 = {
  readonly projectId: string;
  readonly findingRevision: number;
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  /** Digest of only the source projection material relied upon by the Finding. */
  readonly sourceProjectionMaterialDigest?: string;
  /** Digest of only the discovery projection material relied upon by the Finding. */
  readonly discoveryBaseMaterialDigest?: string;
  /** Digest of the Canonical propositions relied upon by the Finding. */
  readonly canonicalContextMaterialDigest?: string;
  readonly relatedResources: readonly DiscoveryReentryFreshnessResourceObservationV1[];
  readonly evidence: readonly DiscoveryReentryFreshnessEvidenceObservationV1[];
  readonly derivationProvenanceDigest?: string;
  readonly validationProfileVersion?: string;
  readonly authorization: 'AUTHORIZED' | 'DENIED' | 'UNKNOWN';
  readonly currentAccessScope?: readonly string[];
  readonly currentSensitivity?: 'public' | 'internal' | 'private' | 'restricted';
  readonly sensitivityPolicy: 'UNCHANGED' | 'CHANGED' | 'DENIED' | 'UNKNOWN';
  readonly reviewTarget?:
    | {
        readonly status: 'CURRENT';
        readonly resourceRevision: number;
        readonly resourceDigest: string;
      }
    | { readonly status: 'SUPERSEDED' | 'UNAVAILABLE' };
};

export type DiscoveryReentryFreshnessAssessmentV1 = {
  readonly schemaVersion: '1.0.0';
  readonly assessmentVersion: typeof DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1;
  readonly assessmentId: string;
  readonly assessedAt: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly state: DiscoveryReentryFreshnessStateV1;
  readonly reasonCodes: readonly DiscoveryReentryFreshnessReasonCodeV1[];
  /** Safe diagnostic text; never contains protected payload. */
  readonly reasonDetail: string;
};

export type DiscoveryReentryFreshnessAssessmentInputV1 = {
  readonly binding: DiscoveryReentryFreshnessBindingV1;
  readonly current: DiscoveryReentryFreshnessCurrentStateV1;
  readonly assessedAt: string;
};

export type DiscoveryReentryFreshnessAssessmentFailureV1 = {
  readonly state: 'PERSISTENCE_FAILURE' | 'AUTHORIZATION_DENIED';
  readonly reasonCode?: DiscoveryReentryFreshnessReasonCodeV1;
  readonly reasonDetail: string;
};

const sensitivityRank: Record<DiscoveryReentryFreshnessBindingV1['sensitivity'], number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const scopeContains = (required: readonly string[], actual: readonly string[]): boolean => {
  const actualSet = new Set(actual);
  return required.every((entry) => actualSet.has(entry));
};

const refKey = (ref: { readonly resourceKind: string; readonly resourceId: string }): string =>
  `${ref.resourceKind}\u0000${ref.resourceId}`;

const digest = (value: unknown): string => sha256Text(semanticStableJson(value));

const assessment = (
  input: DiscoveryReentryFreshnessAssessmentInputV1,
  state: DiscoveryReentryFreshnessStateV1,
  reasonCodes: readonly DiscoveryReentryFreshnessReasonCodeV1[],
  reasonDetail: string,
): DiscoveryReentryFreshnessAssessmentV1 => ({
  schemaVersion: '1.0.0',
  assessmentVersion: DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1,
  assessmentId: digest({
    assessmentVersion: DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1,
    projectId: input.binding.projectId,
    findingId: input.binding.findingId,
    findingRevision: input.binding.findingRevision,
    state,
    reasonCodes,
    assessedAt: input.assessedAt,
  }),
  assessedAt: input.assessedAt,
  projectId: input.binding.projectId,
  findingId: input.binding.findingId,
  findingRevision: input.binding.findingRevision,
  state,
  reasonCodes: [...reasonCodes],
  reasonDetail,
});

const invalidatingStates = new Set<DiscoveryFindingLifecycleState>([
  'DISMISSED',
  'SUPPRESSED',
  'RESOLVED',
  'STALE',
  'SUPERSEDED',
]);

/** Pure comparison used by workers, Review adapters, and PostgreSQL tests. */
export const assessDiscoveryReentryFreshnessV1 = (
  input: DiscoveryReentryFreshnessAssessmentInputV1,
): DiscoveryReentryFreshnessAssessmentV1 => {
  const { binding, current } = input;
  if (
    current.projectId !== binding.projectId ||
    current.findingRevision !== binding.findingRevision
  ) {
    return assessment(
      input,
      'INVALIDATED',
      ['FINDING_NO_LONGER_ACTIVE'],
      'Finding identity is no longer active.',
    );
  }
  if (invalidatingStates.has(current.lifecycleState)) {
    return assessment(
      input,
      'INVALIDATED',
      ['FINDING_NO_LONGER_ACTIVE'],
      'Finding lifecycle is terminal.',
    );
  }
  if (current.authorization === 'DENIED') {
    return assessment(
      input,
      'AUTHORIZATION_DENIED',
      ['ACCESS_NO_LONGER_AUTHORIZED'],
      'Current access authority denied the relied-on material.',
    );
  }
  if (current.authorization === 'UNKNOWN') {
    return assessment(
      input,
      'PERSISTENCE_FAILURE',
      [],
      'Current access authority could not be established.',
    );
  }
  if (
    current.currentAccessScope !== undefined &&
    !scopeContains(binding.accessScope, current.currentAccessScope)
  ) {
    return assessment(
      input,
      'AUTHORIZATION_DENIED',
      ['ACCESS_NO_LONGER_AUTHORIZED'],
      'Current access scope no longer covers the Finding scope.',
    );
  }
  if (current.sensitivityPolicy === 'DENIED') {
    return assessment(
      input,
      'AUTHORIZATION_DENIED',
      ['SENSITIVITY_POLICY_CHANGED'],
      'Current sensitivity policy denied the relied-on material.',
    );
  }
  if (
    current.currentSensitivity !== undefined &&
    sensitivityRank[current.currentSensitivity] > sensitivityRank[binding.sensitivity]
  ) {
    return assessment(
      input,
      'AUTHORIZATION_DENIED',
      ['SENSITIVITY_POLICY_CHANGED'],
      'Current sensitivity exceeds the Finding protection bound.',
    );
  }

  const reasons: DiscoveryReentryFreshnessReasonCodeV1[] = [];
  const boundResourceDigests = new Map(
    (binding.relatedResourceMaterialDigests ?? []).map((entry) => [
      refKey(entry),
      entry.materialDigest,
    ]),
  );
  if (
    current.sourceProjectionMaterialDigest !== undefined &&
    current.sourceProjectionMaterialDigest !== binding.sourceProjectionDigest
  ) {
    reasons.push('SOURCE_PROJECTION_MATERIAL_CHANGE');
  }
  if (
    current.discoveryBaseMaterialDigest !== undefined &&
    current.discoveryBaseMaterialDigest !== binding.discoveryBase.projectionDigest
  ) {
    reasons.push('DISCOVERY_BASE_MATERIAL_CHANGE');
  }
  if (
    binding.canonicalContextMaterialDigest !== undefined &&
    current.canonicalContextMaterialDigest !== undefined &&
    current.canonicalContextMaterialDigest !== binding.canonicalContextMaterialDigest
  ) {
    reasons.push('CANONICAL_CONTEXT_MATERIAL_CHANGE');
  }
  if (current.sensitivityPolicy === 'CHANGED' && !reasons.includes('SENSITIVITY_POLICY_CHANGED')) {
    reasons.push('SENSITIVITY_POLICY_CHANGED');
  }
  if (
    current.derivationProvenanceDigest !== undefined &&
    current.derivationProvenanceDigest !== binding.derivationProvenanceDigest
  ) {
    reasons.push('SOURCE_PROJECTION_MATERIAL_CHANGE');
  }
  if (
    current.validationProfileVersion !== undefined &&
    current.validationProfileVersion !== binding.validationProfileVersion
  ) {
    reasons.push('DISCOVERY_BASE_MATERIAL_CHANGE');
  }

  const currentResources = new Map(current.relatedResources.map((entry) => [refKey(entry), entry]));
  for (const ref of binding.approvedRelatedResourceRefs) {
    const observed = currentResources.get(refKey(ref));
    if (observed === undefined || observed.availability === 'UNAVAILABLE') {
      reasons.push('RELATED_RESOURCE_UNAVAILABLE');
      continue;
    }
    if (observed.projectId !== binding.projectId) {
      return assessment(
        input,
        'AUTHORIZATION_DENIED',
        ['ACCESS_NO_LONGER_AUTHORIZED'],
        'Related resource crossed the project boundary.',
      );
    }
    if (
      (observed.resourceRevision !== undefined &&
        ref.resourceRevision !== undefined &&
        ref.resourceRevision !== 'CURRENT' &&
        observed.resourceRevision !== ref.resourceRevision) ||
      (observed.materialDigest !== undefined &&
        boundResourceDigests.get(refKey(ref)) !== undefined &&
        observed.materialDigest !== boundResourceDigests.get(refKey(ref)))
    ) {
      reasons.push('RELATED_RESOURCE_CHANGED');
    }
    if (
      observed.accessScope !== undefined &&
      !scopeContains(binding.accessScope, observed.accessScope)
    ) {
      return assessment(
        input,
        'AUTHORIZATION_DENIED',
        ['ACCESS_NO_LONGER_AUTHORIZED'],
        'Related resource access scope narrowed.',
      );
    }
    if (
      observed.sensitivity !== undefined &&
      sensitivityRank[observed.sensitivity] > sensitivityRank[binding.sensitivity]
    ) {
      return assessment(
        input,
        'AUTHORIZATION_DENIED',
        ['SENSITIVITY_POLICY_CHANGED'],
        'Related resource sensitivity increased.',
      );
    }
  }

  const currentEvidence = new Map(current.evidence.map((entry) => [entry.evidenceId, entry]));
  const boundEvidenceDigests = new Map(
    (binding.evidenceMaterialDigests ?? []).map((entry) => [
      entry.evidenceId,
      entry.materialDigest,
    ]),
  );
  for (const evidenceId of binding.evidenceIds) {
    const observed = currentEvidence.get(evidenceId);
    if (observed === undefined || observed.availability === 'UNAVAILABLE') {
      reasons.push('EVIDENCE_UNAVAILABLE');
      continue;
    }
    if (observed.projectId !== binding.projectId) {
      return assessment(
        input,
        'AUTHORIZATION_DENIED',
        ['ACCESS_NO_LONGER_AUTHORIZED'],
        'Evidence crossed the project boundary.',
      );
    }
    const boundLineage = binding.evidenceLineage?.find((entry) => entry.evidenceId === evidenceId);
    if (
      (boundLineage?.sourceId !== undefined && observed.sourceId !== boundLineage.sourceId) ||
      (boundLineage?.sourceVersionId !== undefined &&
        observed.sourceVersionId !== boundLineage.sourceVersionId) ||
      (boundLineage?.evidenceSpanId !== undefined &&
        observed.evidenceSpanId !== boundLineage.evidenceSpanId) ||
      (observed.materialDigest !== undefined &&
        boundEvidenceDigests.get(evidenceId) !== undefined &&
        observed.materialDigest !== boundEvidenceDigests.get(evidenceId))
    ) {
      reasons.push('EVIDENCE_LINEAGE_CHANGED');
    }
    if (
      observed.accessScope !== undefined &&
      !scopeContains(binding.accessScope, observed.accessScope)
    ) {
      return assessment(
        input,
        'AUTHORIZATION_DENIED',
        ['ACCESS_NO_LONGER_AUTHORIZED'],
        'Evidence access scope narrowed.',
      );
    }
    if (
      observed.sensitivity !== undefined &&
      sensitivityRank[observed.sensitivity] > sensitivityRank[binding.sensitivity]
    ) {
      return assessment(
        input,
        'AUTHORIZATION_DENIED',
        ['SENSITIVITY_POLICY_CHANGED'],
        'Evidence sensitivity increased.',
      );
    }
  }

  if (binding.reviewTarget !== undefined) {
    if (
      current.reviewTarget?.status === 'SUPERSEDED' ||
      current.reviewTarget?.status === 'UNAVAILABLE'
    ) {
      reasons.push('REVIEW_TARGET_SUPERSEDED');
    } else if (
      current.reviewTarget === undefined ||
      current.reviewTarget.status !== 'CURRENT' ||
      current.reviewTarget.resourceRevision !== binding.reviewTarget.resourceRevision ||
      current.reviewTarget.resourceDigest !== binding.reviewTarget.resourceDigest
    ) {
      reasons.push('REVIEW_TARGET_SUPERSEDED');
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) {
    const invalidated = uniqueReasons.some((reason) =>
      [
        'FINDING_NO_LONGER_ACTIVE',
        'RELATED_RESOURCE_UNAVAILABLE',
        'EVIDENCE_UNAVAILABLE',
        'REVIEW_TARGET_SUPERSEDED',
      ].includes(reason),
    );
    return assessment(
      input,
      invalidated ? 'INVALIDATED' : 'REVALIDATION_REQUIRED',
      uniqueReasons,
      invalidated
        ? 'A relied-on authority is no longer available.'
        : 'A relied-on material input changed.',
    );
  }
  return assessment(
    input,
    'FRESH',
    [],
    'All relied-on material and security authorities remain current.',
  );
};
