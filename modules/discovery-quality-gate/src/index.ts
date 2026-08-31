import {
  computeDiscoveryFingerprintV1,
  composeDiscoveryFindingSecurityV1,
  createDiscoveryFindingEnvelopeV1,
  decodeDiscoveryFindingEnvelopeV1,
  DISCOVERY_RANKING_POLICY_VERSION_V1,
  deriveDiscoverySemanticEssenceV1,
  sha256Text,
  semanticStableJson,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryFindingEnvelopeInputV1,
  DiscoveryFollowUpQualificationProofV1,
  DiscoveryFollowUpOriginIdentityV1,
  DiscoveryFindingEnvelopeV1,
  DiscoveryFindingType,
  DiscoveryRankingDimensionsV1,
  DiscoveryRankingPolicyV1,
  DiscoveryFindingProvenanceV1,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryResourceRefV1,
  DiscoverySignalSummaryV1,
  DiscoverySecurityCompositionSuccessV1,
  DiscoveryServerSecurityInputV1,
  DiscoveryStructuredGenerationRequestV1,
  DiscoveryStructuredGenerationResponseV1,
  DiscoveryWorkBudgetExhaustedV1,
  DiscoveryWorkBudgetPortV1,
} from '../../../packages/contracts/src/index.js';

/**
 * AKP-3 WP4 owns the deterministic pre-persistence boundary. It never imports
 * a persistence adapter and never changes a Discovery finding lifecycle.
 */
export const DISCOVERY_QUALITY_GATE_VERSION_V1 = 'discovery-quality-gate:v1' as const;
export const DISCOVERY_WORK_BUDGET_VERSION_V1 = 'discovery-work-budget:v1' as const;
export const DISCOVERY_TOKEN_ESTIMATOR_VERSION_V1 = 'discovery-token-estimator:v1' as const;

export const DISCOVERY_QUALITY_GATE_DISPOSITIONS = [
  'ACCEPTED',
  'REJECTED',
  'SUPPRESSED',
  'BUDGET_EXHAUSTED',
] as const;
export type DiscoveryQualityGateDispositionV1 =
  (typeof DISCOVERY_QUALITY_GATE_DISPOSITIONS)[number];

export const DISCOVERY_QUALITY_GATE_REASON_CODES = [
  'SCHEMA_INVALID',
  'PROJECT_MISMATCH',
  'SOURCE_PROJECTION_MISMATCH',
  'CANONICAL_BASE_MISMATCH',
  'DISCOVERY_BASE_MISMATCH',
  'RESOURCE_MISSING',
  'RESOURCE_INELIGIBLE',
  'RESOURCE_PROJECT_MISMATCH',
  'NO_COMMON_ACCESS_SCOPE',
  'SECURITY_CLASSIFICATION_MISMATCH',
  'EVIDENCE_LINEAGE_MISSING',
  'RELATION_SELF_REFERENCE',
  'RELATION_INVALID',
  'PATTERN_MEMBERS_INVALID',
  'CONFLICT_PARTICIPANTS_INVALID',
  'CONFLICT_BASIS_MISSING',
  'ACTION_NOT_CANDIDATE_ONLY',
  'AUTHORITATIVE_EQUIVALENT',
  'FINGERPRINT_DUPLICATE',
  'SUPPRESSED_FINGERPRINT',
  'FINGERPRINT_INVALID',
  'AI_PROVENANCE_INVALID',
  'EVIDENCE_LINEAGE_INVALID',
  'CONFLICT_BASIS_INVALID',
  'FOLLOW_UP_QUALIFICATION_MISSING',
  'FOLLOW_UP_QUALIFICATION_INVALID',
] as const;
export type DiscoveryQualityGateReasonCodeV1 = (typeof DISCOVERY_QUALITY_GATE_REASON_CODES)[number];

export type DiscoveryQualityGateContextV1 = {
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: DiscoveryServerSecurityInputV1['sensitivity'];
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
};

export type DiscoveryAuthoritativeResourceV1 = {
  readonly exists: boolean;
  readonly eligible: boolean;
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: DiscoveryServerSecurityInputV1['sensitivity'];
};

export type DiscoveryExistingFindingV1 = {
  readonly findingId: string;
  readonly findingRevision: number;
  readonly lifecycleState: string;
};

/** Server-owned lookup boundary used by the quality gate. */
export type DiscoveryQualityRevalidationPortV1 = {
  revalidateResource(input: {
    readonly projectId: string;
    readonly resource: DiscoveryResourceRefV1;
  }): Promise<DiscoveryAuthoritativeResourceV1 | undefined>;
  revalidateEvidence?(input: {
    readonly projectId: string;
    readonly evidenceId: string;
    readonly candidate: DiscoveryFindingEnvelopeV1;
    readonly context: DiscoveryQualityGateContextV1;
  }): Promise<
    | {
        readonly exists: boolean;
        readonly eligible: boolean;
        readonly projectId: string;
        readonly identityValid: boolean;
      }
    | undefined
  >;
  findByFingerprint(input: {
    readonly projectId: string;
    readonly fingerprintVersion: string;
    readonly fingerprint: string;
  }): Promise<readonly DiscoveryExistingFindingV1[]>;
  findAuthoritativeEquivalent(input: {
    readonly projectId: string;
    readonly candidate: DiscoveryFindingEnvelopeV1;
  }): Promise<boolean>;
};

/** The only WP2 lineage signal needed by WP4 to prove a Conflict basis. */
export type DiscoveryQualitySelectionSignalV1 = {
  readonly kind: 'EXPLICIT_INCOMPATIBILITY';
  readonly incompatibilityKind: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
  readonly source:
    | 'TYPED_PROPOSITION'
    | 'TEMPORAL_QUALIFICATION'
    | 'IDENTITY_ASSIGNMENT'
    | 'EXPLICIT_CONFLICT_SIGNAL';
  readonly signalId: string;
};

export type DiscoveryQualityGateInputV1 = {
  /** Unknown is intentional: the gate is the runtime decoder boundary. */
  readonly candidate: unknown;
  /** The server retains the exact pre-materialization V1 logical identity. */
  readonly fingerprintInput: {
    readonly findingType: DiscoveryFindingType;
    readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
    readonly semanticEssence: string;
  };
  readonly context: DiscoveryQualityGateContextV1;
  readonly selectionSignals?: readonly DiscoveryQualitySelectionSignalV1[];
  readonly qualifiedFollowUp?: DiscoveryFollowUpQualificationProofV1;
  readonly budget?: DiscoveryWorkBudgetPortV1;
};

export type DiscoveryQualityAcceptedV1 = {
  readonly disposition: 'ACCEPTED';
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
  readonly security: DiscoverySecurityCompositionSuccessV1;
};

export type DiscoveryQualityRejectedV1 = {
  readonly disposition: 'REJECTED';
  readonly reasonCode: DiscoveryQualityGateReasonCodeV1;
  readonly message: string;
};

export type DiscoveryQualitySuppressedV1 = {
  readonly disposition: 'SUPPRESSED';
  readonly reasonCode: 'SUPPRESSED_FINGERPRINT';
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly fingerprint: string;
  readonly existing: DiscoveryExistingFindingV1;
};

export type DiscoveryQualityGateResultV1 =
  | DiscoveryQualityAcceptedV1
  | DiscoveryQualityRejectedV1
  | DiscoveryQualitySuppressedV1
  | DiscoveryQualityBudgetExhaustedV1;

export type DiscoveryQualityBudgetExhaustedV1 = {
  readonly disposition: 'BUDGET_EXHAUSTED';
  readonly status: 'BUDGET_EXHAUSTED';
  readonly reason: 'FINDING_LIMIT' | 'DEADLINE_EXPIRED';
  readonly completion: 'PARTIAL';
  readonly truncation: {
    readonly schemaVersion: '1.0.0';
    readonly budgetVersion: typeof DISCOVERY_WORK_BUDGET_VERSION_V1;
    readonly truncated: true;
    readonly reason: 'FINDING_LIMIT' | 'DEADLINE_EXPIRED';
  };
};

const sameJson = (left: unknown, right: unknown): boolean =>
  semanticStableJson(left) === semanticStableJson(right);

const nonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be non-empty`);
  return normalized;
};

const positiveFiniteInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive finite integer`);
  }
  return value;
};

const nonNegativeFiniteInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite integer`);
  }
  return value;
};

const normalizedScope = (scope: readonly string[], field: string): readonly string[] => {
  const normalized = [...new Set(scope.map((entry) => nonEmpty(entry, `${field} entry`)))].sort(
    utf16OrdinalCompare,
  );
  if (normalized.length === 0) throw new TypeError(`${field} must not be empty`);
  return normalized;
};

const resourceKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

const uniqueResources = (
  resources: readonly DiscoveryResourceRefV1[],
): DiscoveryResourceRefV1[] => {
  const result = new Map<string, DiscoveryResourceRefV1>();
  for (const resource of resources) {
    const key = resourceKey(resource);
    if (result.has(key)) throw new Error('duplicate resource identity');
    result.set(key, resource);
  }
  return [...result.values()].sort((left, right) =>
    utf16OrdinalCompare(resourceKey(left), resourceKey(right)),
  );
};

const mergeResources = (resources: readonly DiscoveryResourceRefV1[]): DiscoveryResourceRefV1[] => {
  const result = new Map<string, DiscoveryResourceRefV1>();
  for (const resource of resources) result.set(resourceKey(resource), resource);
  return [...result.values()].sort((left, right) =>
    utf16OrdinalCompare(resourceKey(left), resourceKey(right)),
  );
};

const payloadResources = (
  payload: DiscoveryFindingEnvelopeV1['payload'],
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

const reject = (
  reasonCode: DiscoveryQualityGateReasonCodeV1,
  message: string,
): DiscoveryQualityRejectedV1 => ({ disposition: 'REJECTED', reasonCode, message });

const computedFingerprint = (
  input: DiscoveryQualityGateInputV1['fingerprintInput'],
): {
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
} => {
  const fingerprint = computeDiscoveryFingerprintV1(input);
  return {
    fingerprint: fingerprint.fingerprint,
    fingerprintVersion: fingerprint.fingerprintVersion,
  };
};

const actionLooksExecutable = (value: string): boolean =>
  /(?:^|\s)(?:run|execute|launch|invoke)\s+(?:this\s+)?(?:command|script|tool)|\b(?:curl|wget|powershell|bash|sh)\b|\b(?:api[- ]key|authorization\s*:|bearer\s+|private\s+key)\b/i.test(
    value,
  );

const conflictSourceFor = {
  FACTUAL: 'TYPED_PROPOSITION',
  TEMPORAL: 'TEMPORAL_QUALIFICATION',
  IDENTITY: 'IDENTITY_ASSIGNMENT',
  MODEL_DISAGREEMENT: 'EXPLICIT_CONFLICT_SIGNAL',
} as const;

const validateConflictBasis = (
  candidate: DiscoveryFindingEnvelopeV1,
  selectionSignals: readonly DiscoveryQualitySelectionSignalV1[] | undefined,
): DiscoveryQualityGateReasonCodeV1 | undefined => {
  if (candidate.findingType !== 'CONFLICT_HYPOTHESIS') return undefined;
  const payload = candidate.payload;
  if (payload.payloadType !== 'CONFLICT_HYPOTHESIS') return 'CONFLICT_PARTICIPANTS_INVALID';
  const signal = selectionSignals?.find((entry) => entry.kind === 'EXPLICIT_INCOMPATIBILITY');
  if (!signal) return 'CONFLICT_BASIS_MISSING';
  if (
    signal.source !== conflictSourceFor[signal.incompatibilityKind] ||
    signal.incompatibilityKind !== payload.contradictionKind ||
    signal.signalId.trim().length === 0
  ) {
    return 'CONFLICT_BASIS_INVALID';
  }
  return undefined;
};

const isValidFollowUpIdentity = (
  identity: DiscoveryFollowUpQualificationProofV1['originIdentity'],
): boolean =>
  identity.schemaVersion === '1.0.0' &&
  identity.fingerprintVersion === 'discovery-fingerprint:v1' &&
  /^sha256:[0-9a-f]{64}$/.test(identity.fingerprint) &&
  [
    'KNOWLEDGE_GAP',
    'EVIDENCE_GAP',
    'RELATION_HYPOTHESIS',
    'PATTERN_HYPOTHESIS',
    'CONFLICT_HYPOTHESIS',
  ].includes(identity.originFindingType);

const validateFollowUpQualification = (
  candidate: DiscoveryFindingEnvelopeV1,
  context: DiscoveryQualityGateContextV1,
  qualification: DiscoveryFollowUpQualificationProofV1 | undefined,
): DiscoveryQualityGateReasonCodeV1 | undefined => {
  if (
    candidate.findingType !== 'CLARIFICATION_QUESTION' &&
    candidate.findingType !== 'ACTION_SUGGESTION'
  ) {
    return undefined;
  }
  if (!qualification) return 'FOLLOW_UP_QUALIFICATION_MISSING';
  if (!isValidFollowUpIdentity(qualification.originIdentity)) {
    return 'FOLLOW_UP_QUALIFICATION_INVALID';
  }
  try {
    if (
      qualification.projectId !== context.projectId ||
      qualification.sourceProjectionDigest !== context.sourceProjectionDigest ||
      !sameJson(qualification.canonicalBase, context.canonicalBase) ||
      !sameJson(qualification.discoveryBase, context.discoveryBase) ||
      !sameJson(
        uniqueResources(qualification.relatedResourceRefs),
        uniqueResources(candidate.relatedResourceRefs),
      )
    ) {
      return 'FOLLOW_UP_QUALIFICATION_INVALID';
    }
  } catch {
    return 'FOLLOW_UP_QUALIFICATION_INVALID';
  }
  return undefined;
};

const budgetFindingExhausted = (
  result: ReturnType<DiscoveryWorkBudgetPortV1['admitWork']>,
): DiscoveryQualityBudgetExhaustedV1 | undefined =>
  result.status === 'BUDGET_EXHAUSTED'
    ? {
        disposition: 'BUDGET_EXHAUSTED',
        status: 'BUDGET_EXHAUSTED',
        reason: result.reason === 'DEADLINE_EXPIRED' ? 'DEADLINE_EXPIRED' : 'FINDING_LIMIT',
        completion: 'PARTIAL',
        truncation: {
          schemaVersion: '1.0.0',
          budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
          truncated: true,
          reason: result.reason === 'DEADLINE_EXPIRED' ? 'DEADLINE_EXPIRED' : 'FINDING_LIMIT',
        },
      }
    : undefined;

const validateStructure = (
  candidate: DiscoveryFindingEnvelopeV1,
  selectionSignals: readonly DiscoveryQualitySelectionSignalV1[] | undefined,
): DiscoveryQualityGateReasonCodeV1 | undefined => {
  const related = new Set(candidate.relatedResourceRefs.map(resourceKey));
  const payloadRefs = payloadResources(candidate.payload);
  if (payloadRefs.some((resource) => !related.has(resourceKey(resource)))) {
    return 'RELATION_INVALID';
  }
  switch (candidate.findingType) {
    case 'RELATION_HYPOTHESIS': {
      const payload = candidate.payload;
      if (payload.payloadType !== 'RELATION_HYPOTHESIS') return 'RELATION_INVALID';
      if (resourceKey(payload.sourceEndpoint) === resourceKey(payload.targetEndpoint)) {
        return 'RELATION_SELF_REFERENCE';
      }
      if (
        payload.direction === 'DIRECTED' &&
        resourceKey(payload.sourceEndpoint) === resourceKey(payload.targetEndpoint)
      ) {
        return 'RELATION_SELF_REFERENCE';
      }
      return undefined;
    }
    case 'PATTERN_HYPOTHESIS': {
      const payload = candidate.payload;
      if (payload.payloadType !== 'PATTERN_HYPOTHESIS') return 'PATTERN_MEMBERS_INVALID';
      const members = payload.memberResourceRefs.map(resourceKey);
      return new Set(members).size < 2 ? 'PATTERN_MEMBERS_INVALID' : undefined;
    }
    case 'CONFLICT_HYPOTHESIS': {
      const payload = candidate.payload;
      if (payload.payloadType !== 'CONFLICT_HYPOTHESIS') return 'CONFLICT_PARTICIPANTS_INVALID';
      const participants = payload.participatingResourceRefs.map(resourceKey);
      if (new Set(participants).size < 2) return 'CONFLICT_PARTICIPANTS_INVALID';
      if (!selectionSignals?.some((signal) => signal.kind === 'EXPLICIT_INCOMPATIBILITY')) {
        return 'CONFLICT_BASIS_MISSING';
      }
      return undefined;
    }
    case 'ACTION_SUGGESTION': {
      const payload = candidate.payload;
      if (
        payload.payloadType !== 'ACTION_SUGGESTION' ||
        payload.executionStatus !== 'CANDIDATE_ONLY' ||
        actionLooksExecutable(`${payload.suggestedAction}\n${payload.rationale}`)
      ) {
        return 'ACTION_NOT_CANDIDATE_ONLY';
      }
      return undefined;
    }
    default:
      return undefined;
  }
};

const validateContext = (context: DiscoveryQualityGateContextV1): void => {
  nonEmpty(context.projectId, 'context.projectId');
  normalizedScope(context.accessScope, 'context.accessScope');
  nonEmpty(context.sourceProjectionDigest, 'context.sourceProjectionDigest');
  if (!['public', 'internal', 'private', 'restricted'].includes(context.sensitivity)) {
    throw new TypeError('context.sensitivity is invalid');
  }
  nonNegativeFiniteInteger(context.canonicalBase.canonicalVersion, 'canonicalVersion');
  nonEmpty(context.canonicalBase.snapshotDigest, 'canonical snapshot digest');
  nonEmpty(context.discoveryBase.projectionRevision, 'discovery projection revision');
  nonEmpty(context.discoveryBase.projectionDigest, 'discovery projection digest');
};

export class DiscoveryQualityGateV1 {
  public constructor(private readonly revalidation: DiscoveryQualityRevalidationPortV1) {}

  public async evaluate(input: DiscoveryQualityGateInputV1): Promise<DiscoveryQualityGateResultV1> {
    let candidate: DiscoveryFindingEnvelopeV1;
    try {
      validateContext(input.context);
      candidate = decodeDiscoveryFindingEnvelopeV1(input.candidate);
    } catch {
      return reject('SCHEMA_INVALID', 'The candidate failed the Discovery envelope contract.');
    }

    if (candidate.projectId !== input.context.projectId) {
      return reject('PROJECT_MISMATCH', 'The candidate Project does not match the server context.');
    }
    if (candidate.sourceProjectionDigest !== input.context.sourceProjectionDigest) {
      return reject('SOURCE_PROJECTION_MISMATCH', 'The candidate source projection is stale.');
    }
    if (!sameJson(candidate.canonicalBase, input.context.canonicalBase)) {
      return reject('CANONICAL_BASE_MISMATCH', 'The candidate Canonical base is stale.');
    }
    if (!sameJson(candidate.discoveryBase, input.context.discoveryBase)) {
      return reject('DISCOVERY_BASE_MISMATCH', 'The candidate Discovery base is stale.');
    }
    try {
      if (
        input.fingerprintInput.findingType !== candidate.findingType ||
        !sameJson(
          uniqueResources(input.fingerprintInput.relatedResourceRefs),
          uniqueResources(candidate.relatedResourceRefs),
        )
      ) {
        return reject(
          'FINGERPRINT_INVALID',
          'The server fingerprint input is not bound to the candidate.',
        );
      }
    } catch {
      return reject('FINGERPRINT_INVALID', 'The candidate has duplicate resource identity.');
    }

    const structuralReason = validateStructure(candidate, input.selectionSignals);
    if (structuralReason) {
      return reject(structuralReason, 'The candidate has an invalid or unsafe structure.');
    }

    const conflictReason = validateConflictBasis(candidate, input.selectionSignals);
    if (conflictReason) {
      return reject(conflictReason, 'The candidate does not carry the frozen Conflict basis.');
    }

    const qualificationReason = validateFollowUpQualification(
      candidate,
      input.context,
      input.qualifiedFollowUp,
    );
    if (qualificationReason) {
      return reject(qualificationReason, 'The follow-up qualification proof is invalid.');
    }

    if (
      candidate.findingType !== 'KNOWLEDGE_GAP' &&
      candidate.findingType !== 'EVIDENCE_GAP' &&
      candidate.evidenceIds.length === 0
    ) {
      return reject('EVIDENCE_LINEAGE_MISSING', 'Non-gap findings require evidence lineage.');
    }
    if (candidate.findingType !== 'KNOWLEDGE_GAP' && candidate.findingType !== 'EVIDENCE_GAP') {
      if (!this.revalidation.revalidateEvidence) {
        return reject(
          'EVIDENCE_LINEAGE_INVALID',
          'Evidence lineage cannot be revalidated through a server-owned Port.',
        );
      }
      for (const evidenceId of candidate.evidenceIds) {
        const evidence = await this.revalidation.revalidateEvidence({
          projectId: input.context.projectId,
          evidenceId,
          candidate,
          context: input.context,
        });
        if (
          !evidence ||
          !evidence.exists ||
          !evidence.eligible ||
          !evidence.identityValid ||
          evidence.projectId !== input.context.projectId
        ) {
          return reject('EVIDENCE_LINEAGE_INVALID', 'Evidence lineage is not authoritative.');
        }
      }
    }

    let fingerprint: ReturnType<typeof computedFingerprint>;
    try {
      if (
        candidate.findingType !== 'KNOWLEDGE_GAP' &&
        candidate.findingType !== 'EVIDENCE_GAP' &&
        input.fingerprintInput.semanticEssence !==
          deriveDiscoverySemanticEssenceV1({
            findingType: candidate.findingType,
            payload: candidate.payload,
            originIdentity: input.qualifiedFollowUp?.originIdentity,
          })
      ) {
        return reject(
          'FINGERPRINT_INVALID',
          'The candidate semantic essence is not the server-owned ADR-149 projection.',
        );
      }
      fingerprint = computedFingerprint(input.fingerprintInput);
    } catch {
      return reject('FINGERPRINT_INVALID', 'The candidate fingerprint input is invalid.');
    }
    if (
      candidate.fingerprint !== fingerprint.fingerprint ||
      candidate.fingerprintVersion !== fingerprint.fingerprintVersion
    ) {
      return reject(
        'FINGERPRINT_INVALID',
        'The candidate fingerprint is not the accepted V1 identity.',
      );
    }

    let resources: DiscoveryResourceRefV1[];
    try {
      resources = mergeResources([
        ...candidate.relatedResourceRefs,
        ...payloadResources(candidate.payload),
      ]);
    } catch {
      return reject('RELATION_INVALID', 'The candidate repeats a typed resource identity.');
    }
    const authoritative: DiscoveryServerSecurityInputV1[] = [];
    for (const resource of resources) {
      const record = await this.revalidation.revalidateResource({
        projectId: input.context.projectId,
        resource,
      });
      if (!record || !record.exists)
        return reject('RESOURCE_MISSING', 'A required resource no longer exists.');
      if (!record.eligible)
        return reject('RESOURCE_INELIGIBLE', 'A required resource is no longer eligible.');
      if (
        record.projectId !== input.context.projectId ||
        resource.projectId !== input.context.projectId
      ) {
        return reject(
          'RESOURCE_PROJECT_MISMATCH',
          'A required resource crosses the server Project boundary.',
        );
      }
      authoritative.push({
        projectId: record.projectId,
        accessScope: record.accessScope,
        sensitivity: record.sensitivity,
      });
    }
    const security = composeDiscoveryFindingSecurityV1({
      findingProjectId: input.context.projectId,
      resources: authoritative,
      executionContext: {
        projectId: input.context.projectId,
        accessScope: input.context.accessScope,
        sensitivity: input.context.sensitivity,
      },
    });
    if (!security.materializable) {
      return reject(
        'NO_COMMON_ACCESS_SCOPE',
        'No safe common access scope can publish this candidate.',
      );
    }
    if (
      !sameJson(
        [...candidate.accessScope].sort(utf16OrdinalCompare),
        [...security.accessScope].sort(utf16OrdinalCompare),
      ) ||
      candidate.sensitivity !== security.sensitivity
    ) {
      return reject(
        'SECURITY_CLASSIFICATION_MISMATCH',
        'The candidate security classification is not server-composed.',
      );
    }
    if (
      input.qualifiedFollowUp &&
      (!sameJson(
        [...input.qualifiedFollowUp.accessScope].sort(utf16OrdinalCompare),
        [...security.accessScope].sort(utf16OrdinalCompare),
      ) ||
        input.qualifiedFollowUp.sensitivity !== security.sensitivity)
    ) {
      return reject(
        'FOLLOW_UP_QUALIFICATION_INVALID',
        'The follow-up qualification security does not match the server composition.',
      );
    }

    if (
      await this.revalidation.findAuthoritativeEquivalent({
        projectId: input.context.projectId,
        candidate,
      })
    ) {
      return reject('AUTHORITATIVE_EQUIVALENT', 'An authoritative equivalent already exists.');
    }
    const existing = await this.revalidation.findByFingerprint({
      projectId: input.context.projectId,
      fingerprintVersion: fingerprint.fingerprintVersion,
      fingerprint: fingerprint.fingerprint,
    });
    const suppressed = existing
      .filter((entry) => entry.lifecycleState === 'SUPPRESSED')
      .sort(
        (left, right) =>
          utf16OrdinalCompare(left.findingId, right.findingId) ||
          left.findingRevision - right.findingRevision,
      )[0];
    if (suppressed) {
      return {
        disposition: 'SUPPRESSED',
        reasonCode: 'SUPPRESSED_FINGERPRINT',
        candidate,
        fingerprint: fingerprint.fingerprint,
        existing: suppressed,
      };
    }
    if (existing.length > 0) {
      return reject('FINGERPRINT_DUPLICATE', 'An exact fingerprint duplicate already exists.');
    }
    if (input.budget) {
      const admission = input.budget.admitWork('findings');
      const exhausted = budgetFindingExhausted(admission);
      if (exhausted) return exhausted;
    }
    return {
      disposition: 'ACCEPTED',
      candidate,
      fingerprint: fingerprint.fingerprint,
      fingerprintVersion: fingerprint.fingerprintVersion,
      security,
    };
  }
}

export type DiscoveryAIGenerationMaterializationInputV1 = {
  readonly retentionClass: 'EPHEMERAL_PRE_MATERIALIZATION';
  readonly projectId: string;
  readonly findingType: DiscoveryFindingType;
  readonly generationMethod: 'AI_ASSISTED' | 'HYBRID';
  readonly payload: DiscoveryFindingEnvelopeV1['payload'];
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly evidenceIds: readonly string[];
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly runId: string;
  readonly signalSummary: DiscoverySignalSummaryV1;
  readonly rationale: string;
  readonly derivationSummary: string;
  readonly security: DiscoverySecurityCompositionSuccessV1;
  readonly provenance: DiscoveryAIGenerationMaterializationProvenanceV1;
  readonly selectionSignals?: readonly {
    readonly kind: string;
    readonly incompatibilityKind?: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
    readonly source?:
      | 'TYPED_PROPOSITION'
      | 'TEMPORAL_QUALIFICATION'
      | 'IDENTITY_ASSIGNMENT'
      | 'EXPLICIT_CONFLICT_SIGNAL';
    readonly signalId?: string;
  }[];
  readonly modelResponse?: Record<string, unknown>;
  readonly originIdentity?: DiscoveryFollowUpOriginIdentityV1;
  readonly qualifiedFollowUp?: DiscoveryFollowUpQualificationProofV1;
};

type DiscoveryAIGenerationSelectorProvenanceV1 = {
  readonly selectorId: string;
  readonly selectorVersion: string;
  readonly inputDigest: string;
  readonly anchorResourceKey: string;
  readonly selectionSignals: readonly {
    readonly kind: string;
    readonly incompatibilityKind?: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
    readonly source?:
      | 'TYPED_PROPOSITION'
      | 'TEMPORAL_QUALIFICATION'
      | 'IDENTITY_ASSIGNMENT'
      | 'EXPLICIT_CONFLICT_SIGNAL';
    readonly signalId?: string;
  }[];
};

type DiscoveryAIGenerationMaterializationProvenanceV1 =
  | Extract<DiscoveryFindingProvenanceV1, { readonly kind: 'AI_ASSISTED' }>
  | Extract<DiscoveryFindingProvenanceV1, { readonly kind: 'HYBRID' }>
  | {
      readonly schemaVersion: '1.0.0';
      readonly kind: 'HYBRID';
      readonly deterministic: DiscoveryAIGenerationSelectorProvenanceV1;
      readonly aiExecution: Extract<
        DiscoveryFindingProvenanceV1,
        { readonly kind: 'AI_ASSISTED' }
      > extends infer AiProvenance
        ? Omit<AiProvenance, 'schemaVersion' | 'kind'>
        : never;
    };

const toDurableAIGenerationProvenance = (
  provenance: DiscoveryAIGenerationMaterializationProvenanceV1,
): DiscoveryFindingProvenanceV1 => {
  if (provenance.kind === 'AI_ASSISTED') return provenance;
  if ('ruleId' in provenance.deterministic) {
    return {
      schemaVersion: '1.0.0',
      kind: 'HYBRID',
      deterministic: {
        ruleId: provenance.deterministic.ruleId,
        ruleVersion: provenance.deterministic.ruleVersion,
        inputDigest: provenance.deterministic.inputDigest,
      },
      aiExecution: provenance.aiExecution,
    };
  }
  return {
    schemaVersion: '1.0.0',
    kind: 'HYBRID',
    deterministic: {
      ruleId: provenance.deterministic.selectorId,
      ruleVersion: provenance.deterministic.selectorVersion,
      inputDigest: provenance.deterministic.inputDigest,
    },
    aiExecution: provenance.aiExecution,
  };
};

export type DiscoveryFingerprintAuthorityPortV1 = {
  compute(input: {
    readonly findingType: DiscoveryFindingType;
    readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
    readonly semanticEssence: string;
  }): {
    readonly fingerprintVersion: string;
    readonly fingerprint: string;
    readonly normalizedInput?: unknown;
  };
};

export type DiscoveryAIGenerationMaterializationDependenciesV1 = {
  readonly findingIdFactory: (input: {
    readonly projectId: string;
    readonly findingType: DiscoveryFindingType;
    readonly fingerprint: string;
  }) => string;
  readonly clock: { now(): string };
  readonly fingerprintAuthority: DiscoveryFingerprintAuthorityPortV1;
};

/**
 * Converts one server-owned ephemeral AI proposal into the durable envelope
 * consumed by WP4. Model response text is intentionally not part of the
 * persisted envelope; semantic identity is derived and fingerprinted here.
 */
export const materializeDiscoveryAIGenerationProposalV1 = (
  input: DiscoveryAIGenerationMaterializationInputV1,
  dependencies: DiscoveryAIGenerationMaterializationDependenciesV1,
): DiscoveryFindingEnvelopeV1 => {
  if (input.retentionClass !== 'EPHEMERAL_PRE_MATERIALIZATION') {
    throw new TypeError('Only ephemeral Discovery AI proposals may be materialized');
  }
  if (input.findingType === 'KNOWLEDGE_GAP' || input.findingType === 'EVIDENCE_GAP') {
    throw new TypeError('WP1 gap findings are not materialized through the WP3 AI bridge');
  }
  const semanticEssence = deriveDiscoverySemanticEssenceV1({
    findingType: input.findingType,
    payload: input.payload,
    originIdentity: input.originIdentity,
  });
  const fingerprint = dependencies.fingerprintAuthority.compute({
    findingType: input.findingType,
    relatedResourceRefs: input.relatedResourceRefs,
    semanticEssence,
  });
  if (!fingerprint.fingerprintVersion || !fingerprint.fingerprint) {
    throw new TypeError('The fingerprint authority returned an invalid identity');
  }
  const findingId = dependencies.findingIdFactory({
    projectId: input.projectId,
    findingType: input.findingType,
    fingerprint: fingerprint.fingerprint,
  });
  const common = {
    schemaVersion: '1.0.0' as const,
    findingId,
    findingRevision: 1,
    projectId: input.projectId,
    generationMethod: input.generationMethod,
    lifecycleState: 'NEW' as const,
    relatedResourceRefs: input.relatedResourceRefs,
    evidenceIds: input.evidenceIds,
    sourceProjectionDigest: input.sourceProjectionDigest,
    canonicalBase: input.canonicalBase,
    discoveryBase: input.discoveryBase,
    runId: input.runId,
    signalSummary: input.signalSummary,
    rationale: input.rationale,
    derivationSummary: input.derivationSummary,
    provenance: toDurableAIGenerationProvenance(input.provenance),
    accessScope: input.security.accessScope,
    sensitivity: input.security.sensitivity,
    fingerprint: fingerprint.fingerprint,
    fingerprintVersion: fingerprint.fingerprintVersion,
    retentionClass: 'DURABLE_DERIVED_RECORD' as const,
    createdAt: dependencies.clock.now(),
  };
  return createDiscoveryFindingEnvelopeV1({
    ...common,
    findingType: input.findingType,
    payload: input.payload,
  } as DiscoveryFindingEnvelopeInputV1);
};

export type DiscoveryMaterializedAIGenerationForQualityGateV1 = {
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly fingerprintInput: DiscoveryQualityGateInputV1['fingerprintInput'];
  readonly context: DiscoveryQualityGateContextV1;
  readonly selectionSignals?: readonly DiscoveryQualitySelectionSignalV1[];
  readonly qualifiedFollowUp?: DiscoveryFollowUpQualificationProofV1;
};

/**
 * The explicit WP3 → WP4 bridge. It materializes once, preserves the exact
 * server-derived logical input, and supplies the same server proof to the
 * quality gate without importing the WP3 module.
 */
export const createDiscoveryQualityGateInputFromAIGenerationProposalV1 = (
  proposal: DiscoveryAIGenerationMaterializationInputV1,
  dependencies: DiscoveryAIGenerationMaterializationDependenciesV1,
): DiscoveryMaterializedAIGenerationForQualityGateV1 => {
  const candidate = materializeDiscoveryAIGenerationProposalV1(proposal, dependencies);
  const semanticEssence = deriveDiscoverySemanticEssenceV1({
    findingType: proposal.findingType,
    payload: proposal.payload,
    originIdentity: proposal.originIdentity,
  });
  const selectionSignals = proposal.selectionSignals?.flatMap((signal) =>
    signal.kind === 'EXPLICIT_INCOMPATIBILITY' &&
    signal.incompatibilityKind !== undefined &&
    signal.source !== undefined &&
    signal.signalId !== undefined
      ? [
          {
            kind: 'EXPLICIT_INCOMPATIBILITY' as const,
            incompatibilityKind: signal.incompatibilityKind,
            source: signal.source,
            signalId: signal.signalId,
          },
        ]
      : [],
  );
  return {
    candidate,
    fingerprintInput: {
      findingType: proposal.findingType,
      relatedResourceRefs: proposal.relatedResourceRefs,
      semanticEssence,
    },
    context: {
      projectId: proposal.projectId,
      accessScope: proposal.security.accessScope,
      sensitivity: proposal.security.sensitivity,
      sourceProjectionDigest: proposal.sourceProjectionDigest,
      canonicalBase: proposal.canonicalBase,
      discoveryBase: proposal.discoveryBase,
    },
    ...(selectionSignals === undefined ? {} : { selectionSignals }),
    ...(proposal.qualifiedFollowUp === undefined
      ? {}
      : { qualifiedFollowUp: proposal.qualifiedFollowUp }),
  };
};

export type DiscoveryWorkBudgetV1 = {
  readonly schemaVersion: '1.0.0';
  readonly budgetVersion: typeof DISCOVERY_WORK_BUDGET_VERSION_V1;
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

export type DiscoveryBudgetDimensionV1 =
  | 'resources'
  | 'semanticNeighbors'
  | 'candidatePairs'
  | 'candidateGroups'
  | 'findings'
  | 'providerCalls'
  | 'inputTokens'
  | 'outputTokens'
  | 'estimatedCostMicros'
  | 'concurrency';

export const DISCOVERY_BUDGET_REASON_CODES = [
  'RESOURCE_LIMIT',
  'SEMANTIC_NEIGHBOR_LIMIT',
  'CANDIDATE_PAIR_LIMIT',
  'CANDIDATE_GROUP_LIMIT',
  'FINDING_LIMIT',
  'DEADLINE_EXPIRED',
  'OUTPUT_LIMIT_UNSUPPORTED',
  'CANCELLATION_UNSUPPORTED',
  'CONCURRENCY_LIMIT',
  'PROVIDER_CALL_LIMIT',
  'INPUT_TOKEN_LIMIT',
  'OUTPUT_TOKEN_LIMIT',
  'COST_LIMIT',
  'TOKEN_ESTIMATE_UNAVAILABLE',
  'OUTPUT_LIMIT_INVALID',
  'COST_ESTIMATE_UNAVAILABLE',
  'CANCELLED_OR_DEADLINE_EXPIRED',
] as const;
export type DiscoveryBudgetReasonCodeV1 = (typeof DISCOVERY_BUDGET_REASON_CODES)[number];

export type DiscoveryWorkBudgetSnapshotV1 = {
  readonly resources: number;
  readonly semanticNeighbors: number;
  readonly candidatePairs: number;
  readonly candidateGroups: number;
  readonly findings: number;
  readonly providerCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicros: number;
  readonly activeProviderCalls: number;
};

export type DiscoveryProviderReservationV1 = {
  readonly maxOutputTokens: number;
  readonly inputTokenUpperBound: number;
  readonly estimatedCostMicros: number;
  readonly state: 'RESERVED' | 'DISPATCHED' | 'FINALIZED' | 'CANCELLED_BEFORE_DISPATCH';
  readonly dispatch: () => void;
  readonly cancelBeforeDispatch: () => void;
  readonly finalize: (input?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly estimatedCostMicros?: number;
  }) => void;
};

export type DiscoveryBudgetTruncationV1 =
  | {
      readonly schemaVersion: '1.0.0';
      readonly budgetVersion: typeof DISCOVERY_WORK_BUDGET_VERSION_V1;
      readonly truncated: false;
    }
  | {
      readonly schemaVersion: '1.0.0';
      readonly budgetVersion: typeof DISCOVERY_WORK_BUDGET_VERSION_V1;
      readonly truncated: true;
      readonly reason: DiscoveryBudgetReasonCodeV1;
    };

export type DiscoveryBudgetExhaustedV1 = {
  readonly status: 'BUDGET_EXHAUSTED';
  readonly reason: DiscoveryBudgetReasonCodeV1;
  readonly completion: 'PARTIAL';
  readonly truncation: Extract<DiscoveryBudgetTruncationV1, { readonly truncated: true }>;
};

export type DiscoveryBudgetAdmissionV1 =
  | { readonly status: 'ADMITTED'; readonly reservation: DiscoveryProviderReservationV1 }
  | DiscoveryBudgetExhaustedV1;

const budgetExhausted = (reason: DiscoveryBudgetReasonCodeV1): DiscoveryBudgetExhaustedV1 => ({
  status: 'BUDGET_EXHAUSTED',
  reason,
  completion: 'PARTIAL',
  truncation: {
    schemaVersion: '1.0.0',
    budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
    truncated: true,
    reason,
  },
});

const workBudgetExhausted = (
  reason: DiscoveryWorkBudgetExhaustedV1['reason'],
): DiscoveryWorkBudgetExhaustedV1 => ({
  status: 'BUDGET_EXHAUSTED',
  reason,
  completion: 'PARTIAL',
  truncation: { truncated: true, reason },
});

const budgetDimension = (
  budget: DiscoveryWorkBudgetV1,
  dimension: DiscoveryBudgetDimensionV1,
): number => {
  switch (dimension) {
    case 'resources':
      return budget.maxResources;
    case 'semanticNeighbors':
      return budget.maxSemanticNeighbors;
    case 'candidatePairs':
      return budget.maxCandidatePairs;
    case 'candidateGroups':
      return budget.maxCandidateGroups;
    case 'findings':
      return budget.maxFindings;
    case 'providerCalls':
      return budget.maxProviderCalls;
    case 'inputTokens':
      return budget.maxInputTokens;
    case 'outputTokens':
      return budget.maxOutputTokens;
    case 'estimatedCostMicros':
      return budget.maxEstimatedCostMicros;
    case 'concurrency':
      return budget.maxConcurrentProviderCalls;
  }
};

const nowMs = (): number => Date.now();

const validateBudget = (budget: DiscoveryWorkBudgetV1): void => {
  if (
    budget.schemaVersion !== '1.0.0' ||
    budget.budgetVersion !== DISCOVERY_WORK_BUDGET_VERSION_V1
  ) {
    throw new TypeError('Unsupported Discovery work budget version');
  }
  for (const dimension of [
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
  ] as const) {
    positiveFiniteInteger(budget[dimension], dimension);
  }
  const deadline = Date.parse(budget.deadlineAt);
  if (!Number.isFinite(deadline)) throw new TypeError('deadlineAt must be an ISO timestamp');
};

const validateSnapshot = (
  budget: DiscoveryWorkBudgetV1,
  snapshot: DiscoveryWorkBudgetSnapshotV1,
): void => {
  const limits: Record<keyof DiscoveryWorkBudgetSnapshotV1, number> = {
    resources: budget.maxResources,
    semanticNeighbors: budget.maxSemanticNeighbors,
    candidatePairs: budget.maxCandidatePairs,
    candidateGroups: budget.maxCandidateGroups,
    findings: budget.maxFindings,
    providerCalls: budget.maxProviderCalls,
    inputTokens: budget.maxInputTokens,
    outputTokens: budget.maxOutputTokens,
    estimatedCostMicros: budget.maxEstimatedCostMicros,
    activeProviderCalls: budget.maxConcurrentProviderCalls,
  };
  for (const dimension of Object.keys(limits) as Array<keyof DiscoveryWorkBudgetSnapshotV1>) {
    const value = snapshot[dimension];
    if (!Number.isSafeInteger(value) || value < 0 || value > limits[dimension]) {
      throw new TypeError(`budget snapshot ${dimension} is outside the frozen budget`);
    }
  }
};

export class DiscoveryWorkBudgetLedgerV1 {
  private readonly admittedResourceKeys = new Set<string>();

  private readonly used: {
    -readonly [K in keyof DiscoveryWorkBudgetSnapshotV1]: DiscoveryWorkBudgetSnapshotV1[K];
  } = {
    resources: 0,
    semanticNeighbors: 0,
    candidatePairs: 0,
    candidateGroups: 0,
    findings: 0,
    providerCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicros: 0,
    activeProviderCalls: 0,
  };

  public constructor(
    private readonly budget: DiscoveryWorkBudgetV1,
    private readonly clock: () => number = nowMs,
    initialSnapshot?: DiscoveryWorkBudgetSnapshotV1,
  ) {
    validateBudget(budget);
    if (initialSnapshot !== undefined) this.restore(initialSnapshot);
  }

  /** Hydrates cumulative usage after a restart; it never extends the budget. */
  public restore(snapshot: DiscoveryWorkBudgetSnapshotV1): void {
    validateSnapshot(this.budget, snapshot);
    Object.assign(this.used, snapshot);
    // Resource identity keys are intentionally not reconstructed from a count.
    // A replayed resource may therefore consume a slot again, conservatively.
    this.admittedResourceKeys.clear();
  }

  public snapshot(): DiscoveryWorkBudgetSnapshotV1 {
    return { ...this.used };
  }

  public isExpired(): boolean {
    return this.clock() >= Date.parse(this.budget.deadlineAt);
  }

  public deadlineAt(): string {
    return this.budget.deadlineAt;
  }

  public maxOutputTokensPerCall(): number {
    return this.budget.maxOutputTokensPerCall;
  }

  public remainingWork(dimension: DiscoveryBudgetDimensionV1): number {
    if (dimension === 'concurrency') {
      return Math.max(0, this.budget.maxConcurrentProviderCalls - this.used.activeProviderCalls);
    }
    return Math.max(0, budgetDimension(this.budget, dimension) - this.used[dimension]);
  }

  public consume(
    dimension: Exclude<
      DiscoveryBudgetDimensionV1,
      'concurrency' | 'providerCalls' | 'inputTokens' | 'outputTokens' | 'estimatedCostMicros'
    >,
    amount = 1,
  ): boolean {
    positiveFiniteInteger(amount, `${dimension} amount`);
    if (this.isExpired()) return false;
    const current = this.used[dimension];
    if (current + amount > budgetDimension(this.budget, dimension)) return false;
    (this.used as Record<string, number>)[dimension] = current + amount;
    return true;
  }

  public admitWork(
    dimension:
      'resources' | 'semanticNeighbors' | 'candidatePairs' | 'candidateGroups' | 'findings',
    amount = 1,
  ): ReturnType<DiscoveryWorkBudgetPortV1['admitWork']> {
    positiveFiniteInteger(amount, `${dimension} amount`);
    const reasonByDimension = {
      resources: 'RESOURCE_LIMIT',
      semanticNeighbors: 'SEMANTIC_NEIGHBOR_LIMIT',
      candidatePairs: 'CANDIDATE_PAIR_LIMIT',
      candidateGroups: 'CANDIDATE_GROUP_LIMIT',
      findings: 'FINDING_LIMIT',
    } as const;
    if (this.isExpired()) return workBudgetExhausted('DEADLINE_EXPIRED');
    const current = this.used[dimension];
    if (current + amount > budgetDimension(this.budget, dimension)) {
      return workBudgetExhausted(reasonByDimension[dimension]);
    }
    this.used[dimension] = current + amount;
    return { status: 'ADMITTED' };
  }

  public admitResources(
    resources: readonly DiscoveryResourceRefV1[],
  ): ReturnType<DiscoveryWorkBudgetPortV1['admitResources']> {
    const ordered = [
      ...new Map(resources.map((resource) => [resourceKey(resource), resource])).keys(),
    ].sort(utf16OrdinalCompare);
    if (this.isExpired()) {
      return {
        ...workBudgetExhausted('DEADLINE_EXPIRED'),
        admittedResourceKeys: [],
      };
    }

    const admittedResourceKeys: string[] = [];
    let exhausted = false;
    for (const key of ordered) {
      if (this.admittedResourceKeys.has(key)) {
        admittedResourceKeys.push(key);
        continue;
      }
      if (this.used.resources >= this.budget.maxResources) {
        exhausted = true;
        continue;
      }
      this.admittedResourceKeys.add(key);
      this.used.resources += 1;
      admittedResourceKeys.push(key);
    }
    if (exhausted) {
      return {
        ...workBudgetExhausted('RESOURCE_LIMIT'),
        admittedResourceKeys,
      };
    }
    return { status: 'ADMITTED', admittedResourceKeys };
  }

  public admitProviderCall(input: {
    readonly inputTokenUpperBound: number;
    readonly estimatedCostMicros: number;
    readonly providerSupportsOutputTokenLimit: boolean;
    readonly providerSupportsCancellation: boolean;
    readonly maxOutputTokens?: number;
  }): DiscoveryBudgetAdmissionV1 {
    if (this.isExpired()) return budgetExhausted('DEADLINE_EXPIRED');
    if (!input.providerSupportsOutputTokenLimit) {
      return budgetExhausted('OUTPUT_LIMIT_UNSUPPORTED');
    }
    if (!input.providerSupportsCancellation) {
      return budgetExhausted('CANCELLATION_UNSUPPORTED');
    }
    positiveFiniteInteger(input.inputTokenUpperBound, 'inputTokenUpperBound');
    positiveFiniteInteger(input.estimatedCostMicros, 'estimatedCostMicros');
    const maxOutputTokens = Math.min(
      input.maxOutputTokens ?? this.budget.maxOutputTokensPerCall,
      this.budget.maxOutputTokensPerCall,
    );
    positiveFiniteInteger(maxOutputTokens, 'maxOutputTokens');
    if (this.used.activeProviderCalls >= this.budget.maxConcurrentProviderCalls) {
      return budgetExhausted('CONCURRENCY_LIMIT');
    }
    if (this.used.providerCalls + 1 > this.budget.maxProviderCalls) {
      return budgetExhausted('PROVIDER_CALL_LIMIT');
    }
    if (this.used.inputTokens + input.inputTokenUpperBound > this.budget.maxInputTokens) {
      return budgetExhausted('INPUT_TOKEN_LIMIT');
    }
    if (this.used.outputTokens + maxOutputTokens > this.budget.maxOutputTokens) {
      return budgetExhausted('OUTPUT_TOKEN_LIMIT');
    }
    if (
      this.used.estimatedCostMicros + input.estimatedCostMicros >
      this.budget.maxEstimatedCostMicros
    ) {
      return budgetExhausted('COST_LIMIT');
    }
    this.used.activeProviderCalls += 1;
    this.used.inputTokens += input.inputTokenUpperBound;
    this.used.outputTokens += maxOutputTokens;
    this.used.estimatedCostMicros += input.estimatedCostMicros;
    let state: DiscoveryProviderReservationV1['state'] = 'RESERVED';
    const releaseReservation = (): void => {
      this.used.activeProviderCalls = Math.max(0, this.used.activeProviderCalls - 1);
      this.used.inputTokens = Math.max(0, this.used.inputTokens - input.inputTokenUpperBound);
      this.used.outputTokens = Math.max(0, this.used.outputTokens - maxOutputTokens);
      this.used.estimatedCostMicros = Math.max(
        0,
        this.used.estimatedCostMicros - input.estimatedCostMicros,
      );
    };
    const reservation: DiscoveryProviderReservationV1 = {
      maxOutputTokens,
      inputTokenUpperBound: input.inputTokenUpperBound,
      estimatedCostMicros: input.estimatedCostMicros,
      get state() {
        return state;
      },
      dispatch: () => {
        if (state === 'RESERVED') {
          state = 'DISPATCHED';
          this.used.providerCalls += 1;
        }
      },
      cancelBeforeDispatch: () => {
        if (state === 'RESERVED') {
          state = 'CANCELLED_BEFORE_DISPATCH';
          releaseReservation();
        }
      },
      finalize: (usage) => {
        if (state === 'FINALIZED' || state === 'CANCELLED_BEFORE_DISPATCH') return;
        if (state === 'RESERVED') {
          reservation.cancelBeforeDispatch();
          return;
        }
        const actualInput = usage?.inputTokens ?? input.inputTokenUpperBound;
        const actualOutput = usage?.outputTokens ?? maxOutputTokens;
        const actualCost = usage?.estimatedCostMicros ?? input.estimatedCostMicros;
        if (
          !Number.isSafeInteger(actualInput) ||
          actualInput < 0 ||
          actualInput > input.inputTokenUpperBound
        ) {
          throw new TypeError('Provider input usage exceeds its admitted upper bound');
        }
        if (
          !Number.isSafeInteger(actualOutput) ||
          actualOutput < 0 ||
          actualOutput > maxOutputTokens
        ) {
          throw new TypeError('Provider output usage exceeds its admitted cap');
        }
        if (
          !Number.isSafeInteger(actualCost) ||
          actualCost < 0 ||
          actualCost > input.estimatedCostMicros
        ) {
          throw new TypeError('Provider cost usage exceeds its admitted estimate');
        }
        state = 'FINALIZED';
        this.used.activeProviderCalls = Math.max(0, this.used.activeProviderCalls - 1);
        this.used.inputTokens = this.used.inputTokens - input.inputTokenUpperBound + actualInput;
        this.used.outputTokens = this.used.outputTokens - maxOutputTokens + actualOutput;
        this.used.estimatedCostMicros =
          this.used.estimatedCostMicros - input.estimatedCostMicros + actualCost;
      },
    };
    return { status: 'ADMITTED', reservation };
  }
}

export type DiscoveryTokenEstimatorPortV1 = {
  readonly revision: string;
  estimateUpperBound(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly request: DiscoveryStructuredGenerationRequestV1;
  }): number | undefined;
};

export type DiscoveryCostEstimatorPortV1 = {
  readonly revision: string;
  estimate(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly inputTokenUpperBound: number;
    readonly maxOutputTokens: number;
  }): number | undefined;
};

export type DiscoveryBudgetedProviderPortV1 = {
  readonly identity: {
    readonly provider: string;
    readonly model: string;
    readonly supportsOutputTokenLimit?: boolean;
    readonly supportsCancellation?: boolean;
  };
  generateStructured(
    request: DiscoveryStructuredGenerationRequestV1,
  ): Promise<DiscoveryStructuredGenerationResponseV1>;
  generateStructuredWithSignal?(
    request: DiscoveryStructuredGenerationRequestV1,
    signal?: AbortSignal,
  ): Promise<DiscoveryStructuredGenerationResponseV1>;
};

/** Optional durable admission ledger used by the long-running Discovery
 * provider path. A RESERVED row survives a worker crash and therefore keeps
 * the external-cost admission from silently disappearing. */
export type DiscoveryProviderReservationDurabilityPortV1 = {
  reserve(input: {
    readonly reservationId: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly inputTokenUpperBound: number;
    readonly maxOutputTokens: number;
    readonly estimatedCostMicros: number;
  }): Promise<'RESERVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'>;
  finalize(input: {
    readonly reservationId: string;
    readonly state: 'FINALIZED' | 'CANCELLED';
    readonly actualInputTokens?: number;
    readonly actualOutputTokens?: number;
    readonly actualCostMicros?: number;
  }): Promise<'FINALIZED' | 'CANCELLED' | 'STALE' | 'NOT_FOUND'>;
};

export type DiscoveryProviderExecutionResultV1 =
  | {
      readonly status: 'SUCCEEDED';
      readonly response: DiscoveryStructuredGenerationResponseV1;
      readonly completion: 'COMPLETE';
      readonly truncation: Extract<DiscoveryBudgetTruncationV1, { readonly truncated: false }>;
      readonly budgetVersion: typeof DISCOVERY_WORK_BUDGET_VERSION_V1;
      readonly tokenEstimatorRevision: string;
      readonly costEstimatorRevision: string;
    }
  | DiscoveryBudgetExhaustedV1;

export class DiscoveryBudgetControllerV1 {
  private reservationSequence = 0;

  public constructor(
    private readonly ledger: DiscoveryWorkBudgetLedgerV1,
    private readonly tokenEstimator: DiscoveryTokenEstimatorPortV1,
    private readonly costEstimator: DiscoveryCostEstimatorPortV1,
    private readonly durableReservations?: DiscoveryProviderReservationDurabilityPortV1,
  ) {}

  public async executeProviderCall(input: {
    readonly provider: DiscoveryBudgetedProviderPortV1;
    readonly request: DiscoveryStructuredGenerationRequestV1;
    readonly signal?: AbortSignal;
    readonly maxOutputTokens?: number;
  }): Promise<DiscoveryProviderExecutionResultV1> {
    const { provider, request } = input;
    if (this.ledger.isExpired()) return budgetExhausted('DEADLINE_EXPIRED');
    if (!provider.generateStructuredWithSignal) {
      return budgetExhausted('CANCELLATION_UNSUPPORTED');
    }
    let estimatedInputTokenUpperBound: number | undefined;
    try {
      estimatedInputTokenUpperBound = this.tokenEstimator.estimateUpperBound({
        providerId: provider.identity.provider,
        modelId: provider.identity.model,
        request,
      });
    } catch {
      return budgetExhausted('TOKEN_ESTIMATE_UNAVAILABLE');
    }
    if (
      typeof estimatedInputTokenUpperBound !== 'number' ||
      !Number.isSafeInteger(estimatedInputTokenUpperBound) ||
      estimatedInputTokenUpperBound <= 0
    ) {
      return budgetExhausted('TOKEN_ESTIMATE_UNAVAILABLE');
    }
    const inputTokenUpperBound = estimatedInputTokenUpperBound;
    const maxOutputTokens = Math.min(
      input.maxOutputTokens ?? this.ledger.maxOutputTokensPerCall(),
      this.ledger.maxOutputTokensPerCall(),
    );
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      return budgetExhausted('OUTPUT_LIMIT_INVALID');
    }
    const estimatedCostMicros = this.costEstimator.estimate({
      providerId: provider.identity.provider,
      modelId: provider.identity.model,
      inputTokenUpperBound,
      maxOutputTokens,
    });
    if (estimatedCostMicros === undefined) {
      return budgetExhausted('COST_ESTIMATE_UNAVAILABLE');
    }
    const admission = this.ledger.admitProviderCall({
      inputTokenUpperBound,
      estimatedCostMicros,
      providerSupportsOutputTokenLimit: provider.identity.supportsOutputTokenLimit === true,
      providerSupportsCancellation: provider.identity.supportsCancellation === true,
      maxOutputTokens,
    });
    if (admission.status !== 'ADMITTED') return admission;
    const reservationId = `discovery-provider-reservation:${sha256Text(
      semanticStableJson({
        provider: provider.identity.provider,
        model: provider.identity.model,
        sequence: ++this.reservationSequence,
        now: Date.now(),
      }),
    )}`;
    if (this.durableReservations) {
      const durable = await this.durableReservations.reserve({
        reservationId,
        providerId: provider.identity.provider,
        modelId: provider.identity.model,
        inputTokenUpperBound,
        maxOutputTokens: admission.reservation.maxOutputTokens,
        estimatedCostMicros,
      });
      if (durable !== 'RESERVED') {
        admission.reservation.cancelBeforeDispatch();
        return budgetExhausted('CONCURRENCY_LIMIT');
      }
    }
    const controller = new AbortController();
    const deadlineMs = Date.parse(this.deadlineAt());
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleDeadline = (): void => {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        controller.abort('DISCOVERY_DEADLINE');
        return;
      }
      deadlineTimer = setTimeout(scheduleDeadline, Math.min(remainingMs, 2_147_483_647));
    };
    scheduleDeadline();
    const abort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) controller.abort(input.signal.reason);
    let reservationFinalized = false;
    const finalizeReservation = (
      usage?: Parameters<DiscoveryProviderReservationV1['finalize']>[0],
    ): void => {
      if (reservationFinalized) return;
      admission.reservation.finalize(usage);
      reservationFinalized = true;
    };
    const finalizeDurableReservation = async (input: {
      readonly state: 'FINALIZED' | 'CANCELLED';
      readonly actualInputTokens?: number;
      readonly actualOutputTokens?: number;
      readonly actualCostMicros?: number;
    }): Promise<boolean> => {
      if (!this.durableReservations) return true;
      const result = await this.durableReservations.finalize({ reservationId, ...input });
      return result === input.state;
    };
    try {
      if (controller.signal.aborted) {
        admission.reservation.cancelBeforeDispatch();
        await finalizeDurableReservation({ state: 'CANCELLED' });
        return budgetExhausted(
          input.signal?.aborted ? 'CANCELLED_OR_DEADLINE_EXPIRED' : 'DEADLINE_EXPIRED',
        );
      }
      admission.reservation.dispatch();
      const requestWithCap = { ...request, maxOutputTokens: admission.reservation.maxOutputTokens };
      const response = await provider.generateStructuredWithSignal(
        requestWithCap,
        controller.signal,
      );
      if (controller.signal.aborted) {
        finalizeReservation({
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });
        const durable = await finalizeDurableReservation({
          state: 'FINALIZED',
          actualInputTokens: response.inputTokens,
          actualOutputTokens: response.outputTokens,
        });
        if (!durable) return budgetExhausted('CONCURRENCY_LIMIT');
        return budgetExhausted('CANCELLED_OR_DEADLINE_EXPIRED');
      }
      finalizeReservation({
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      });
      const durable = await finalizeDurableReservation({
        state: 'FINALIZED',
        actualInputTokens: response.inputTokens,
        actualOutputTokens: response.outputTokens,
      });
      if (!durable) return budgetExhausted('CONCURRENCY_LIMIT');
      return {
        status: 'SUCCEEDED',
        response,
        completion: 'COMPLETE',
        truncation: {
          schemaVersion: '1.0.0',
          budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
          truncated: false,
        },
        budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
        tokenEstimatorRevision: this.tokenEstimator.revision,
        costEstimatorRevision: this.costEstimator.revision,
      };
    } catch (error) {
      finalizeReservation();
      await finalizeDurableReservation({ state: 'FINALIZED' });
      if (controller.signal.aborted) {
        return budgetExhausted('CANCELLED_OR_DEADLINE_EXPIRED');
      }
      throw error;
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      input.signal?.removeEventListener('abort', abort);
    }
  }

  private deadlineAt(): string {
    return this.ledger.deadlineAt();
  }
}

export { DISCOVERY_RANKING_POLICY_VERSION_V1 };
export type { DiscoveryRankingDimensionsV1, DiscoveryRankingPolicyV1 };

export type DiscoveryRankingInputV1 = {
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly dimensions: DiscoveryRankingDimensionsV1;
};

export type DiscoveryRankedCandidateV1 = {
  readonly rank: number;
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly dimensions: DiscoveryRankingDimensionsV1;
  readonly rankingPolicyVersion: typeof DISCOVERY_RANKING_POLICY_VERSION_V1;
  readonly scoreMicros: number;
  readonly tieBreakKey: string;
};

const rankingDimensions = [
  'novelty',
  'projectRelevance',
  'evidenceCoverage',
  'impactReach',
  'temporalUrgency',
  'redundancyPenalty',
  'costRiskPenalty',
] as const satisfies readonly (keyof DiscoveryRankingDimensionsV1)[];

const validateRankingNumber = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be within 0..1`);
  }
};

export const rankAcceptedDiscoveryCandidatesV1 = (
  inputs: readonly DiscoveryRankingInputV1[],
  policy: DiscoveryRankingPolicyV1,
): readonly DiscoveryRankedCandidateV1[] => {
  if (policy.version !== DISCOVERY_RANKING_POLICY_VERSION_V1) {
    throw new TypeError('Unsupported Discovery ranking policy version');
  }
  for (const dimension of rankingDimensions) {
    validateRankingNumber(policy.weights[dimension], `weights.${dimension}`);
  }
  const scored = inputs.map((input) => {
    for (const dimension of rankingDimensions) {
      validateRankingNumber(input.dimensions[dimension], `dimensions.${dimension}`);
    }
    const benefits =
      input.dimensions.novelty * policy.weights.novelty +
      input.dimensions.projectRelevance * policy.weights.projectRelevance +
      input.dimensions.evidenceCoverage * policy.weights.evidenceCoverage +
      input.dimensions.impactReach * policy.weights.impactReach +
      input.dimensions.temporalUrgency * policy.weights.temporalUrgency;
    const penalties =
      input.dimensions.redundancyPenalty * policy.weights.redundancyPenalty +
      input.dimensions.costRiskPenalty * policy.weights.costRiskPenalty;
    return {
      ...input,
      scoreMicros: Math.round((benefits - penalties) * 1_000_000),
      tieBreakKey: input.candidate.findingId,
    };
  });
  return scored
    .sort(
      (left, right) =>
        right.scoreMicros - left.scoreMicros ||
        utf16OrdinalCompare(left.tieBreakKey, right.tieBreakKey),
    )
    .map((entry, index) => ({
      rank: index + 1,
      candidate: entry.candidate,
      dimensions: entry.dimensions,
      rankingPolicyVersion: policy.version,
      scoreMicros: entry.scoreMicros,
      tieBreakKey: entry.tieBreakKey,
    }));
};

export const createDiscoveryQualityGateV1 = (
  revalidation: DiscoveryQualityRevalidationPortV1,
): DiscoveryQualityGateV1 => new DiscoveryQualityGateV1(revalidation);
