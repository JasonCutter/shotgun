import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  FrontendContractError,
  ShotgunError,
  type EvidenceSpan,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingPayloadV1,
  type DiscoveryProductCapabilitiesV1,
  type DiscoveryProductActivityBindingV1,
  type DiscoveryProductEvidenceReferenceV1,
  type DiscoveryProductFindingSummaryV1,
  type DiscoveryProductFreshnessV1,
  type DiscoveryProductGovernanceV1,
  type DiscoveryProductLineageV1,
  type DiscoveryProductProvenanceV1,
  type DiscoveryProductReentryStateV1,
  type DiscoveryProductSafeSignalsV1,
  type DiscoveryProductValidationStateV1,
  type DiscoveryProductSensitivityV1,
  type DiscoveryProductPresentationMetadataV1,
  type DiscoveryProductFindingPresentationV1,
  type DiscoveryProductPresentationReasonCodeV1,
  type DiscoveryRankingDimensionsV1,
  type DiscoveryResourceKind,
  type DiscoveryResourceRefV1,
  type ListDiscoveryFindingsRequestV1,
  type ListDiscoveryFindingsResultV1,
  type ReadDiscoveryFindingRequestV1,
  type ReadDiscoveryFindingResultV1,
  decodeDiscoveryProductFindingDetailV1,
  decodeDiscoveryProductFindingSummaryV1,
  FRONTEND_DISCOVERY_SCHEMA_VERSION,
  DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1,
  DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1,
  DISCOVERY_RANKING_POLICY_VERSION_V1,
  canDiscoveryFindingTransitionV1,
} from '../../../packages/contracts/src/index.js';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import type {
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoveryRankingPolicyV1,
  DiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import { utf16OrdinalCompare } from '../../../packages/contracts/src/semantic-representation.js';

/** A read-only Product port. Implementations may compose existing repositories
 * or use narrow SQL, but may not own Discovery, lifecycle, validation, or
 * Review state. */
export type DiscoveryProductReadSource = {
  listFindings(
    projectId: string,
    after: DiscoveryProductPageCursorV1 | undefined,
    limit: number,
  ): Promise<readonly DiscoveryFindingEnvelopeV1[]>;
  findFinding(input: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
  }): Promise<DiscoveryFindingEnvelopeV1 | undefined>;
  /** Optional lineage lookup used by bounded ranked presentation reads. */
  findLatestFinding?(
    projectId: string,
    findingId: string,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined>;
  findLifecycle(
    input: DiscoveryProductFindingIdentityV1,
  ): Promise<DiscoveryProductLifecycleCurrentV1 | undefined>;
  findReentryDisposition(input: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
  }): Promise<Exclude<DiscoveryProductReentryStateV1, 'NOT_REQUESTED'> | undefined>;
  findReviewBinding(input: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
  }): Promise<DiscoveryProductReviewBindingV1 | undefined>;
  findResourceAuthorization(
    resource: DiscoveryResourceRefV1,
  ): Promise<DiscoveryProductResourceAuthorizationV1 | undefined>;
  findEvidence(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined>;
};

/** Assembly-injected authority adapter. The Product module does not import
 * AKP-3 implementation code directly. */
export type DiscoveryProductRankingAuthority = (
  inputs: readonly {
    readonly candidate: DiscoveryFindingEnvelopeV1;
    readonly dimensions: DiscoveryRankingDimensionsV1;
  }[],
  policy: DiscoveryRankingPolicyV1,
) => readonly {
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly scoreMicros: number;
}[];

/** Assembly-injected WP1 feedback read Port. The Product module owns no
 * feedback storage and does not import the feedback domain implementation. */
export type DiscoveryProductFeedbackReadPort = {
  readonly resolveEffectiveRankingPolicy: (lookup: {
    readonly projectId: string;
    readonly policyId: string;
    readonly at?: string;
  }) => Promise<DiscoveryRankingPolicyRevisionV1 | undefined>;
  readonly listLatestUtilityFeedbackForPresentation?: (lookup: {
    readonly projectId: string;
    readonly principalId: string;
    readonly at: string;
  }) => Promise<readonly DiscoveryFeedbackEventV1[]>;
  readonly listFeedbackForFinding: (lookup: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
    readonly principalId?: string;
  }) => Promise<readonly DiscoveryFeedbackEventV1[]>;
  readonly listSuppressionForPresentation?: (lookup: {
    readonly projectId: string;
    readonly principalId: string;
    readonly at: string;
  }) => Promise<readonly DiscoverySuppressionDirectiveV1[]>;
  readonly listRelevantSuppression: (lookup: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
    readonly principalId: string;
    readonly fingerprint?: string;
    readonly fingerprintVersion?: string;
    readonly semanticMatcherVersion?: string;
    readonly at?: string;
  }) => Promise<readonly DiscoverySuppressionDirectiveV1[]>;
};

export type DiscoveryProductGraphReadiness = {
  canReadGraph(projectId: string): Promise<boolean>;
};

/** Server-side Activity root authority. The Product module may only use this
 * read surface to expose a verified bridge; it cannot create or control work. */
export type DiscoveryProductActivityReadPort = {
  findActivityBinding(input: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
    readonly runId: string;
  }): Promise<Pick<DiscoveryProductActivityBindingV1, 'jobId' | 'runId'> | undefined>;
};

export type DiscoveryProductPageCursorV1 = {
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryProductPresentationSortKeyV1 = {
  readonly effectivePriorityMicros: number;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryProductRankedCursorContextV1 = {
  readonly principalId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly evaluationTime: string;
  readonly policyIdentity: string;
  readonly policyRevision: number;
  readonly filterContextDigest: string;
  readonly utilityAdjustmentVersion: typeof DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1;
  readonly semanticMatcherVersion: typeof DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1;
  readonly lastSortKey: DiscoveryProductPresentationSortKeyV1;
  readonly lastRank: number;
};

export type DiscoveryProductResourceAuthorizationV1 = {
  readonly projectId: string;
  readonly resourceKind: DiscoveryResourceKind;
  readonly resourceId: string;
  readonly resourceState: 'CURRENT' | 'APPROVED';
  readonly resourceRevision?: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: DiscoveryProductSensitivityV1;
  readonly graphEligible: boolean;
};

export type DiscoveryProductFindingIdentityV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryProductLifecycleCurrentV1 = DiscoveryProductFindingIdentityV1 & {
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly lifecycleRevision: number;
  readonly updatedAt: string;
};

export const createEmptyDiscoveryProductReadSource = (): DiscoveryProductReadSource => ({
  listFindings: async () => [],
  findFinding: async () => undefined,
  findLifecycle: async () => undefined,
  findReentryDisposition: async () => undefined,
  findReviewBinding: async () => undefined,
  findResourceAuthorization: async () => undefined,
  findEvidence: async () => undefined,
});

export type DiscoveryProductReviewBindingV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly reviewResourceId: string;
  readonly resourceRevision: number;
  readonly lifecycleState: 'REVIEW_READY';
  readonly reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION';
};

export type DiscoveryProductReadInput = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProject: {
    readonly id: string;
    readonly label: string;
    readonly isOwner: boolean;
    readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
  };
  readonly accessibleProjects: readonly {
    readonly id: string;
    readonly label: string;
    readonly isOwner: boolean;
    readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
  }[];
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope?: readonly string[];
};

const DEFAULT_PAGE_LIMIT = 25;
const CURSOR_VERSION = 'frontend-discovery-cursor:v3';
const CURSOR_PREFIX = 'fdc2';
const RANKED_CURSOR_PREFIX = 'fdc3';
const CURSOR_IV_BYTES = 12;
const CURSOR_TAG_BYTES = 16;

export type DiscoveryProductCursorCodec = {
  encode(input: {
    readonly projectId: string;
    readonly cursor: DiscoveryProductPageCursorV1;
    readonly context?: DiscoveryProductRankedCursorContextV1;
  }): string;
  decode(value: string): {
    readonly projectId: string;
    readonly cursor: DiscoveryProductPageCursorV1;
    readonly context?: DiscoveryProductRankedCursorContextV1;
  };
};

const validCursorIdentity = (value: unknown): value is DiscoveryProductPageCursorV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    Object.keys(object).every((key) => ['findingId', 'findingRevision'].includes(key)) &&
    typeof object.findingId === 'string' &&
    object.findingId.trim().length > 0 &&
    typeof object.findingRevision === 'number' &&
    Number.isSafeInteger(object.findingRevision) &&
    object.findingRevision > 0
  );
};

const cursorKey = (secret: string): Buffer => createHash('sha256').update(secret).digest();

const validSortKey = (value: unknown): value is DiscoveryProductPresentationSortKeyV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    Object.keys(object).every((key) =>
      ['effectivePriorityMicros', 'findingId', 'findingRevision'].includes(key),
    ) &&
    typeof object.effectivePriorityMicros === 'number' &&
    Number.isSafeInteger(object.effectivePriorityMicros) &&
    typeof object.findingId === 'string' &&
    object.findingId.trim().length > 0 &&
    typeof object.findingRevision === 'number' &&
    Number.isSafeInteger(object.findingRevision) &&
    object.findingRevision > 0
  );
};

const validRankedContext = (value: unknown): value is DiscoveryProductRankedCursorContextV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    Object.keys(object).every((key) =>
      [
        'principalId',
        'accessRevision',
        'policyContextRevision',
        'evaluationTime',
        'policyIdentity',
        'policyRevision',
        'filterContextDigest',
        'utilityAdjustmentVersion',
        'semanticMatcherVersion',
        'lastSortKey',
        'lastRank',
      ].includes(key),
    ) &&
    typeof object.principalId === 'string' &&
    object.principalId.trim().length > 0 &&
    typeof object.accessRevision === 'string' &&
    object.accessRevision.trim().length > 0 &&
    typeof object.policyContextRevision === 'string' &&
    object.policyContextRevision.trim().length > 0 &&
    typeof object.evaluationTime === 'string' &&
    Number.isFinite(Date.parse(object.evaluationTime)) &&
    typeof object.policyIdentity === 'string' &&
    object.policyIdentity.trim().length > 0 &&
    typeof object.policyRevision === 'number' &&
    Number.isSafeInteger(object.policyRevision) &&
    object.policyRevision > 0 &&
    typeof object.filterContextDigest === 'string' &&
    /^[0-9a-f]{64}$/u.test(object.filterContextDigest) &&
    object.utilityAdjustmentVersion === DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1 &&
    object.semanticMatcherVersion === DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1 &&
    validSortKey(object.lastSortKey) &&
    typeof object.lastRank === 'number' &&
    Number.isSafeInteger(object.lastRank) &&
    object.lastRank > 0
  );
};

/** AES-GCM makes the keyset continuation opaque and tamper-evident. The
 * plaintext Finding identity remains server-owned and is never sent to the
 * browser in reversible JSON/base64 form. */
export const createEncryptedDiscoveryProductCursorCodec = (
  secret: string,
): DiscoveryProductCursorCodec => {
  if (secret.trim().length < 16) throw new Error('Discovery cursor secret is too short.');
  const key = cursorKey(secret);
  return {
    encode({ projectId, cursor, context }) {
      if (!projectId.trim() || !validCursorIdentity(cursor)) {
        throw new Error('Discovery cursor identity is invalid.');
      }
      if (context !== undefined && !validRankedContext(context)) {
        throw new Error('Discovery ranked cursor context is invalid.');
      }
      const aad = context === undefined ? 'frontend-discovery-cursor:v2' : CURSOR_VERSION;
      const iv = randomBytes(CURSOR_IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(
          JSON.stringify(
            context === undefined
              ? {
                  projectId,
                  findingId: cursor.findingId,
                  findingRevision: cursor.findingRevision,
                }
              : {
                  projectId,
                  findingId: cursor.findingId,
                  findingRevision: cursor.findingRevision,
                  context,
                },
          ),
          'utf8',
        ),
        cipher.final(),
      ]);
      return [
        context === undefined ? CURSOR_PREFIX : RANKED_CURSOR_PREFIX,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
      ].join('.');
    },
    decode(value) {
      try {
        if (value.length > 1024) throw new Error('cursor is too long');
        const [prefix, ivText, ciphertextText, tagText] = value.split('.');
        if (
          (prefix !== CURSOR_PREFIX && prefix !== RANKED_CURSOR_PREFIX) ||
          !ivText ||
          !ciphertextText ||
          !tagText
        ) {
          throw new Error('cursor envelope is invalid');
        }
        const iv = Buffer.from(ivText, 'base64url');
        const ciphertext = Buffer.from(ciphertextText, 'base64url');
        const tag = Buffer.from(tagText, 'base64url');
        if (iv.length !== CURSOR_IV_BYTES || tag.length !== CURSOR_TAG_BYTES) {
          throw new Error('cursor envelope lengths are invalid');
        }
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(
          Buffer.from(
            prefix === RANKED_CURSOR_PREFIX ? CURSOR_VERSION : 'frontend-discovery-cursor:v2',
            'utf8',
          ),
        );
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('cursor payload is invalid');
        }
        const object = parsed as Record<string, unknown>;
        if (
          Object.keys(object).some(
            (key) => !['projectId', 'findingId', 'findingRevision', 'context'].includes(key),
          ) ||
          typeof object.projectId !== 'string' ||
          !object.projectId.trim() ||
          !validCursorIdentity({
            findingId: object.findingId,
            findingRevision: object.findingRevision,
          }) ||
          (prefix === RANKED_CURSOR_PREFIX && !validRankedContext(object.context)) ||
          (prefix === CURSOR_PREFIX && object.context !== undefined)
        ) {
          throw new Error('cursor payload is invalid');
        }
        return {
          projectId: object.projectId,
          cursor: {
            findingId: object.findingId as string,
            findingRevision: object.findingRevision as number,
          },
          ...(object.context === undefined
            ? {}
            : { context: object.context as DiscoveryProductRankedCursorContextV1 }),
        };
      } catch {
        throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
      }
    },
  };
};

const defaultCursorCodec = (): DiscoveryProductCursorCodec => ({
  encode(input) {
    const secret =
      process.env.SHOTGUN_DISCOVERY_CURSOR_SECRET ?? process.env.SOURCES_STAGING_SECRET;
    if (!secret) throw new Error('Discovery cursor secret is not configured.');
    return createEncryptedDiscoveryProductCursorCodec(secret).encode(input);
  },
  decode(value) {
    const secret =
      process.env.SHOTGUN_DISCOVERY_CURSOR_SECRET ?? process.env.SOURCES_STAGING_SECRET;
    if (!secret) throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
    return createEncryptedDiscoveryProductCursorCodec(secret).decode(value);
  },
});

const failure = (
  code: ConstructorParameters<typeof ShotgunError>[0]['code'],
  operation: string,
  message: string,
): never => {
  throw new ShotgunError({
    code,
    safeMessage: message,
    module: 'frontend-discovery-product',
    operation,
  });
};

const notFound = (): never =>
  failure('NOT_FOUND', 'read-discovery-finding', 'The requested Discovery finding was not found.');

const normalizeText = (value: string, maximum: number): string => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
};

const payloadRefs = (payload: DiscoveryFindingPayloadV1): readonly DiscoveryResourceRefV1[] => {
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

const graphEligibleFinding = (finding: DiscoveryFindingEnvelopeV1): boolean => {
  if (
    finding.findingType !== 'RELATION_HYPOTHESIS' &&
    finding.findingType !== 'PATTERN_HYPOTHESIS' &&
    finding.findingType !== 'CONFLICT_HYPOTHESIS'
  ) {
    return false;
  }
  const refs = payloadRefs(finding.payload);
  if (finding.findingType === 'RELATION_HYPOTHESIS') return refs.length === 2;
  return refs.length > 0;
};

const payloadTitleAndSummary = (
  payload: DiscoveryFindingPayloadV1,
): { readonly title: string; readonly summary: string } => {
  switch (payload.payloadType) {
    case 'KNOWLEDGE_GAP':
      return {
        title: `Knowledge gap: ${payload.gapKind === 'UNDEFINED_TERM' ? payload.term : payload.gapKind === 'KNOWN_CONFLICT_QUESTION' ? 'known conflict' : payload.subject}`,
        summary: payload.question,
      };
    case 'EVIDENCE_GAP':
      return { title: 'Evidence gap', summary: payload.coverageGap };
    case 'RELATION_HYPOTHESIS':
      return {
        title: `Relation hypothesis: ${payload.proposedRelationType}`,
        summary: `${payload.sourceEndpoint.resourceId} ${payload.direction === 'DIRECTED' ? '→' : '↔'} ${payload.targetEndpoint.resourceId}`,
      };
    case 'PATTERN_HYPOTHESIS':
      return {
        title: `Pattern hypothesis: ${payload.patternKind}`,
        summary: payload.patternStatement,
      };
    case 'CONFLICT_HYPOTHESIS':
      return {
        title: `Conflict hypothesis: ${payload.contradictionKind}`,
        summary: payload.possibleContradiction,
      };
    case 'CLARIFICATION_QUESTION':
      return { title: 'Clarification question', summary: payload.question };
    case 'ACTION_SUGGESTION':
      return { title: 'Action suggestion', summary: payload.suggestedAction };
  }
};

const safeSignalsFrom = (source: DiscoveryFindingEnvelopeV1): DiscoveryProductSafeSignalsV1 => {
  const signals = source.signalSummary;
  return {
    ...(signals.graphDistance === undefined ? {} : { graphDistance: signals.graphDistance }),
    ...(signals.graphTopology === undefined ? {} : { graphTopology: signals.graphTopology }),
    ...(signals.temporalOverlap === undefined ? {} : { temporalOverlap: signals.temporalOverlap }),
    ...(signals.temporalChange === undefined ? {} : { temporalChange: signals.temporalChange }),
    ...(signals.evidenceCoverage === undefined
      ? {}
      : { evidenceCoverage: signals.evidenceCoverage }),
    ...(signals.conflictState === undefined ? {} : { conflictState: signals.conflictState }),
    ...(signals.novelty === undefined ? {} : { novelty: signals.novelty }),
  };
};

const safeProvenanceFrom = (source: DiscoveryFindingEnvelopeV1): DiscoveryProductProvenanceV1 => {
  const provenance = source.provenance;
  if (provenance.kind === 'DETERMINISTIC') {
    return {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      kind: provenance.kind,
      ruleId: provenance.ruleId,
      ruleVersion: provenance.ruleVersion,
      inputDigest: provenance.inputDigest,
    };
  }
  if (provenance.kind === 'AI_ASSISTED') {
    return {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      kind: provenance.kind,
    };
  }
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    kind: provenance.kind,
    ruleId: provenance.deterministic.ruleId,
    ruleVersion: provenance.deterministic.ruleVersion,
    inputDigest: provenance.deterministic.inputDigest,
  };
};

const lifecycleValidationState = (
  state: DiscoveryFindingLifecycleState,
): DiscoveryProductValidationStateV1 => {
  if (state === 'NEW') return 'NOT_STARTED';
  if (state === 'VALIDATING') return 'VALIDATING';
  if (state === 'REVIEW_READY' || state === 'REENTERED') return 'VALIDATED';
  return 'UNKNOWN';
};

const freshnessState = (
  lifecycleState: DiscoveryFindingLifecycleState,
  reentryState: DiscoveryProductReentryStateV1,
): DiscoveryProductFreshnessV1['state'] =>
  lifecycleState === 'STALE' ||
  lifecycleState === 'SUPERSEDED' ||
  reentryState === 'RETRYABLE' ||
  reentryState === 'BLOCKED_NON_RETRYABLE'
    ? 'REVALIDATION_REQUIRED'
    : 'UNKNOWN';

export const decodeDiscoveryProductCursor = (
  value: string | undefined,
): DiscoveryProductPageCursorV1 | undefined => {
  if (value === undefined) return undefined;
  return defaultCursorCodec().decode(value).cursor;
};

const isFindingVisibleTo = (
  finding: DiscoveryFindingEnvelopeV1,
  scope: DiscoveryProductReadInput,
): boolean =>
  finding.projectId === scope.activeProject.id &&
  (scope.accessScope ?? []).length > 0 &&
  finding.accessScope.every((required) => (scope.accessScope ?? []).includes(required)) &&
  hasSensitivityClearance(scope.activeProject.sensitivityClearance, finding.sensitivity) &&
  finding.relatedResourceRefs.every((resource) => resource.projectId === scope.activeProject.id) &&
  payloadRefs(finding.payload).every((resource) => resource.projectId === scope.activeProject.id);

const evidenceReference = (span: EvidenceSpan): DiscoveryProductEvidenceReferenceV1 => ({
  schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
  evidenceId: span.evidenceId,
  evidenceRevisionId: span.revisionId,
  sourceId: span.sourceId,
  sourceVersionId: span.sourceVersionId,
});

export const DISCOVERY_PRODUCT_DIMENSION_MAPPING_VERSION_V1 =
  'discovery-ranking-dimensions:v1' as const;
export const DISCOVERY_PRODUCT_POLICY_ID_V1 = 'discovery-ranking-policy' as const;
export const DISCOVERY_PRODUCT_BUILT_IN_POLICY_ID_V1 =
  'discovery-ranking-policy:builtin-v1' as const;

export const DISCOVERY_PRODUCT_UTILITY_ADJUSTMENTS_V1 = {
  USEFUL: 250_000,
  NOT_RELEVANT: -250_000,
  ALREADY_KNOWN: -125_000,
  TOO_FREQUENT: -500_000,
} as const;

const clamp01 = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

const temporalUrgencyFor = (finding: DiscoveryFindingEnvelopeV1): number => {
  const change = finding.signalSummary.temporalChange;
  const changeScore =
    change === 'EMERGING' ? 1 : change === 'SHIFTING' ? 0.8 : change === 'ENDED' ? 0.6 : 0;
  return Math.max(changeScore, clamp01(finding.signalSummary.temporalOverlap ?? 0, 0));
};

const impactReachFor = (finding: DiscoveryFindingEnvelopeV1): number => {
  switch (finding.findingType) {
    case 'CONFLICT_HYPOTHESIS':
      return 1;
    case 'RELATION_HYPOTHESIS':
    case 'PATTERN_HYPOTHESIS':
      return 0.75;
    case 'EVIDENCE_GAP':
    case 'KNOWLEDGE_GAP':
      return 0.5;
    case 'CLARIFICATION_QUESTION':
    case 'ACTION_SUGGESTION':
      return 0.25;
  }
};

const redundancyPenaltyFor = (finding: DiscoveryFindingEnvelopeV1): number => {
  const topology = finding.signalSummary.graphTopology;
  const topologyPenalty = topology === 'HUB' ? 0.8 : topology === 'COMMUNITY' ? 0.4 : 0;
  const noveltyPenalty = 1 - clamp01(finding.signalSummary.novelty ?? 0.5, 0.5);
  return Math.max(topologyPenalty, noveltyPenalty * 0.5);
};

/** The single server-owned V1 mapping from persisted Finding state/signals to
 * the existing AKP-3 ranking dimensions. It intentionally ignores prose,
 * model identity, browser telemetry and all epistemic authority fields. */
export const deriveDiscoveryRankingDimensionsV1 = (
  finding: DiscoveryFindingEnvelopeV1,
): DiscoveryRankingDimensionsV1 => ({
  novelty: clamp01(finding.signalSummary.novelty ?? 0.5, 0.5),
  projectRelevance: 1,
  evidenceCoverage: clamp01(finding.signalSummary.evidenceCoverage ?? 0.5, 0.5),
  impactReach: impactReachFor(finding),
  temporalUrgency: temporalUrgencyFor(finding),
  redundancyPenalty: redundancyPenaltyFor(finding),
  costRiskPenalty: clamp01((finding.signalSummary.rankingCostMicros ?? 0) / 1_000_000, 0),
});

const builtInPolicy = (): DiscoveryRankingPolicyV1 => ({
  version: DISCOVERY_RANKING_POLICY_VERSION_V1,
  weights: {
    novelty: 0.25,
    projectRelevance: 0.2,
    evidenceCoverage: 0.2,
    impactReach: 0.15,
    temporalUrgency: 0.1,
    redundancyPenalty: 0.05,
    costRiskPenalty: 0.05,
  },
});

type EffectivePresentationPolicyV1 = {
  readonly policy: DiscoveryRankingPolicyV1;
  readonly policyIdentity: string;
  readonly policyRevision: number;
  readonly policySource: 'PERSISTED' | 'BUILT_IN_FALLBACK';
};

const policyForRevision = (
  revision: DiscoveryRankingPolicyRevisionV1,
): EffectivePresentationPolicyV1 => ({
  policy: { version: revision.algorithmVersion, weights: revision.weights },
  policyIdentity: revision.policyId,
  policyRevision: revision.policyRevision,
  policySource: 'PERSISTED',
});

const fallbackPresentationPolicy = (): EffectivePresentationPolicyV1 => ({
  policy: builtInPolicy(),
  policyIdentity: DISCOVERY_PRODUCT_BUILT_IN_POLICY_ID_V1,
  policyRevision: 1,
  policySource: 'BUILT_IN_FALLBACK',
});

const utilityReasonFor = (
  kind: keyof typeof DISCOVERY_PRODUCT_UTILITY_ADJUSTMENTS_V1,
): DiscoveryProductPresentationReasonCodeV1 =>
  kind === 'USEFUL'
    ? 'UTILITY_USEFUL'
    : kind === 'NOT_RELEVANT'
      ? 'UTILITY_NOT_RELEVANT'
      : kind === 'ALREADY_KNOWN'
        ? 'UTILITY_ALREADY_KNOWN'
        : 'UTILITY_TOO_FREQUENT';

const utilityKind = (
  event: DiscoveryFeedbackEventV1 | undefined,
): keyof typeof DISCOVERY_PRODUCT_UTILITY_ADJUSTMENTS_V1 | undefined =>
  event?.feedbackClass === 'UTILITY' &&
  (event.feedbackKind === 'USEFUL' ||
    event.feedbackKind === 'NOT_RELEVANT' ||
    event.feedbackKind === 'ALREADY_KNOWN' ||
    event.feedbackKind === 'TOO_FREQUENT')
    ? event.feedbackKind
    : undefined;

const semanticResourceKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

/** Deterministic typed-family key. Unsupported payloads deliberately return
 * undefined, which is a fail-closed NO MATCH for similar suppression. */
export const discoverySemanticFamilyKeyV1 = (
  finding: DiscoveryFindingEnvelopeV1,
): string | undefined => {
  const payload = finding.payload;
  let family: unknown;
  switch (payload.payloadType) {
    case 'KNOWLEDGE_GAP':
      family =
        payload.gapKind === 'KNOWN_CONFLICT_QUESTION'
          ? {
              payloadType: payload.payloadType,
              gapKind: payload.gapKind,
              ref: semanticResourceKey(payload.knownConflictRef),
            }
          : payload.gapKind === 'UNDEFINED_TERM'
            ? { payloadType: payload.payloadType, gapKind: payload.gapKind, term: payload.term }
            : {
                payloadType: payload.payloadType,
                gapKind: payload.gapKind,
                subject: payload.subject,
              };
      break;
    case 'EVIDENCE_GAP':
      family = {
        payloadType: payload.payloadType,
        coverageKind: payload.coverageKind,
        ref: semanticResourceKey(payload.affectedResourceRef),
      };
      break;
    case 'RELATION_HYPOTHESIS': {
      const endpoints = [
        semanticResourceKey(payload.sourceEndpoint),
        semanticResourceKey(payload.targetEndpoint),
      ];
      family = {
        payloadType: payload.payloadType,
        direction: payload.direction,
        relationType: payload.proposedRelationType,
        endpoints:
          payload.direction === 'UNDIRECTED' ? endpoints.sort(utf16OrdinalCompare) : endpoints,
      };
      break;
    }
    case 'PATTERN_HYPOTHESIS':
      family = {
        payloadType: payload.payloadType,
        patternKind: payload.patternKind,
        members: payload.memberResourceRefs.map(semanticResourceKey).sort(utf16OrdinalCompare),
      };
      break;
    case 'CONFLICT_HYPOTHESIS':
      family = {
        payloadType: payload.payloadType,
        contradictionKind: payload.contradictionKind,
        members: payload.participatingResourceRefs
          .map(semanticResourceKey)
          .sort(utf16OrdinalCompare),
      };
      break;
    case 'CLARIFICATION_QUESTION':
    case 'ACTION_SUGGESTION':
      return undefined;
  }
  return JSON.stringify({ version: DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1, family });
};

const isMandatoryVisibility = (finding: DiscoveryFindingEnvelopeV1): boolean =>
  finding.findingType === 'CONFLICT_HYPOTHESIS' ||
  (finding.findingType === 'KNOWLEDGE_GAP' &&
    finding.payload.gapKind === 'KNOWN_CONFLICT_QUESTION') ||
  finding.signalSummary.conflictState === 'KNOWN_CONFLICT' ||
  finding.relatedResourceRefs.some((resource) => resource.resourceKind === 'CANONICAL_CONFLICT');

const subjectId = (value: {
  readonly principalId?: string;
  readonly actor: { readonly id: string };
}): string => value.principalId ?? value.actor.id;

const findingIdentityKey = (finding: {
  readonly findingId: string;
  readonly findingRevision: number;
}): string => `${finding.findingId}\u0000${finding.findingRevision}`;

const latestUtilityByFinding = (
  events: readonly DiscoveryFeedbackEventV1[],
): ReadonlyMap<string, DiscoveryFeedbackEventV1> => {
  const latest = new Map<string, DiscoveryFeedbackEventV1>();
  for (const event of events) {
    const kind = utilityKind(event);
    if (!kind) continue;
    const key = findingIdentityKey(event);
    const current = latest.get(key);
    if (
      current === undefined ||
      Date.parse(event.createdAt) > Date.parse(current.createdAt) ||
      (Date.parse(event.createdAt) === Date.parse(current.createdAt) &&
        utf16OrdinalCompare(event.feedbackId, current.feedbackId) > 0)
    ) {
      latest.set(key, event);
    }
  }
  return latest;
};

const discoveryFilterContextDigest = (request: ListDiscoveryFindingsRequestV1): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        findingTypes: request.findingTypes ?? null,
        lifecycleStates: request.lifecycleStates ?? null,
      }),
    )
    .digest('hex');

const presentationSortKeyCompare = (
  left: DiscoveryProductPresentationSortKeyV1,
  right: DiscoveryProductPresentationSortKeyV1,
): number =>
  left.effectivePriorityMicros !== right.effectivePriorityMicros
    ? right.effectivePriorityMicros - left.effectivePriorityMicros
    : utf16OrdinalCompare(left.findingId, right.findingId) ||
      left.findingRevision - right.findingRevision;

const isAfterPresentationCursor = (
  candidate: DiscoveryProductPresentationSortKeyV1,
  cursor: DiscoveryProductPresentationSortKeyV1,
): boolean => presentationSortKeyCompare(candidate, cursor) > 0;

export class FrontendDiscoveryProductReadCoordinator {
  private readonly cursorCodec: DiscoveryProductCursorCodec;
  private readonly graphReadiness?: DiscoveryProductGraphReadiness;
  private readonly feedbackRepository?: DiscoveryProductFeedbackReadPort;
  private readonly rankingAuthority?: DiscoveryProductRankingAuthority;
  private readonly now: () => string;

  constructor(
    private readonly source: DiscoveryProductReadSource,
    options: {
      readonly cursorCodec?: DiscoveryProductCursorCodec;
      readonly graphReadiness?: DiscoveryProductGraphReadiness;
      readonly activityRead?: DiscoveryProductActivityReadPort;
      readonly feedbackRepository?: DiscoveryProductFeedbackReadPort;
      readonly rankingAuthority?: DiscoveryProductRankingAuthority;
      readonly now?: () => string;
    } = {},
  ) {
    this.cursorCodec = options.cursorCodec ?? defaultCursorCodec();
    this.graphReadiness = options.graphReadiness;
    this.activityRead = options.activityRead;
    this.feedbackRepository = options.feedbackRepository;
    this.rankingAuthority = options.rankingAuthority;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private readonly activityRead?: DiscoveryProductActivityReadPort;

  private async authorizeResources(
    finding: DiscoveryFindingEnvelopeV1,
    scope: DiscoveryProductReadInput,
  ): Promise<readonly DiscoveryProductResourceAuthorizationV1[] | undefined> {
    if (!isFindingVisibleTo(finding, scope)) return undefined;
    const refs = [...finding.relatedResourceRefs, ...payloadRefs(finding.payload)].filter(
      (resource, index, all) => {
        const key = `${resource.projectId}:${resource.resourceKind}:${resource.resourceId}:${resource.resourceRevision ?? ''}`;
        return (
          all.findIndex(
            (candidate) =>
              `${candidate.projectId}:${candidate.resourceKind}:${candidate.resourceId}:${candidate.resourceRevision ?? ''}` ===
              key,
          ) === index
        );
      },
    );
    const authorized = await Promise.all(
      refs.map(async (resource) => {
        try {
          return await this.source.findResourceAuthorization(resource);
        } catch {
          // An authority failure is a non-disclosing miss for this Finding,
          // not a reason to expose a partial projection.
          return undefined;
        }
      }),
    );
    if (
      authorized.some(
        (resolved, index) =>
          resolved === undefined ||
          resolved.projectId !== scope.activeProject.id ||
          resolved.resourceKind !== refs[index]!.resourceKind ||
          resolved.resourceId !== refs[index]!.resourceId ||
          resolved.resourceState !== refs[index]!.resourceState ||
          (refs[index]!.resourceRevision !== undefined &&
            resolved.resourceRevision !== refs[index]!.resourceRevision) ||
          resolved.accessScope.some((required) => !(scope.accessScope ?? []).includes(required)) ||
          !hasSensitivityClearance(scope.activeProject.sensitivityClearance, resolved.sensitivity),
      )
    ) {
      return undefined;
    }
    return authorized as readonly DiscoveryProductResourceAuthorizationV1[];
  }

  private async contextFor(
    finding: DiscoveryFindingEnvelopeV1,
    scope: DiscoveryProductReadInput,
  ): Promise<{
    readonly lifecycle: DiscoveryProductLifecycleCurrentV1;
    readonly reentryState: DiscoveryProductReentryStateV1;
    readonly reviewBinding?: DiscoveryProductReviewBindingV1;
    readonly evidence: readonly DiscoveryProductEvidenceReferenceV1[];
  }> {
    const identity = {
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    };
    const [lifecycle, disposition, reviewBinding, evidenceRows] = await Promise.all([
      this.source.findLifecycle(identity),
      this.source.findReentryDisposition(identity),
      this.source.findReviewBinding(identity),
      Promise.all(
        finding.evidenceIds.map((evidenceId) =>
          this.source.findEvidence(finding.projectId, evidenceId),
        ),
      ),
    ]);
    if (
      !lifecycle ||
      lifecycle.projectId !== finding.projectId ||
      lifecycle.findingId !== finding.findingId ||
      lifecycle.findingRevision !== finding.findingRevision
    ) {
      return failure(
        'FORMAT_CORRUPT',
        'read-discovery-lifecycle',
        'Discovery lifecycle authority is missing or mismatched.',
      );
    }
    const visibleEvidence = evidenceRows.flatMap((span) => {
      if (
        !span ||
        span.projectId !== scope.activeProject.id ||
        span.evidenceId === undefined ||
        !span.sourceId ||
        !span.sourceVersionId ||
        !span.revisionId ||
        !span.accessScope.every((required) => (scope.accessScope ?? []).includes(required)) ||
        !hasSensitivityClearance(scope.activeProject.sensitivityClearance, span.sensitivity)
      )
        return [];
      return [evidenceReference(span)];
    });
    const reentryState: DiscoveryProductReentryStateV1 = disposition ?? 'NOT_REQUESTED';
    const safeReview =
      reviewBinding &&
      reviewBinding.projectId === finding.projectId &&
      reviewBinding.findingId === finding.findingId &&
      reviewBinding.findingRevision === finding.findingRevision &&
      reviewBinding.resourceRevision > 0 &&
      reviewBinding.lifecycleState === 'REVIEW_READY' &&
      reviewBinding.reviewEligibility === 'ELIGIBLE_AFTER_VALIDATION' &&
      lifecycle.lifecycleState === 'REVIEW_READY'
        ? reviewBinding
        : undefined;
    return {
      lifecycle,
      reentryState,
      ...(safeReview === undefined ? {} : { reviewBinding: safeReview }),
      evidence: visibleEvidence,
    };
  }

  private async toSummary(
    finding: DiscoveryFindingEnvelopeV1,
    scope: DiscoveryProductReadInput,
  ): Promise<{
    readonly summary: DiscoveryProductFindingSummaryV1;
    readonly lineage: DiscoveryProductLineageV1;
  }> {
    const authorizedResources = await this.authorizeResources(finding, scope);
    if (authorizedResources === undefined) return notFound();
    const context = await this.contextFor(finding, scope);
    const titleAndSummary = payloadTitleAndSummary(finding.payload);
    const relatedResourceRefs = finding.relatedResourceRefs.filter(
      (resource) => resource.projectId === scope.activeProject.id,
    );
    const governance: DiscoveryProductGovernanceV1 = {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      reentryState: context.reentryState,
      validationState: lifecycleValidationState(context.lifecycle.lifecycleState),
      reviewReadiness: context.reviewBinding ? 'ELIGIBLE_AFTER_VALIDATION' : 'NOT_ELIGIBLE',
      ...(context.reviewBinding === undefined
        ? {}
        : { reviewResourceId: context.reviewBinding.reviewResourceId }),
    };
    const freshness: DiscoveryProductFreshnessV1 = {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      state: freshnessState(context.lifecycle.lifecycleState, context.reentryState),
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: finding.canonicalBase.canonicalVersion,
        snapshotDigest: finding.canonicalBase.snapshotDigest,
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: finding.discoveryBase.projectionRevision,
        projectionDigest: finding.discoveryBase.projectionDigest,
      },
    };
    const eligibleForGraph =
      graphEligibleFinding(finding) &&
      authorizedResources.length > 0 &&
      authorizedResources.every((resource) => resource.graphEligible);
    let canReadGraph = false;
    if (eligibleForGraph && this.graphReadiness !== undefined) {
      try {
        canReadGraph = await this.graphReadiness.canReadGraph(finding.projectId);
      } catch {
        // A Product capability is an authority statement; an unavailable
        // readiness authority cannot grant Graph navigation.
        canReadGraph = false;
      }
    }
    let canOpenActivity = false;
    const capabilitiesBase = {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      canOpenReview: context.reviewBinding !== undefined,
      canInspectEvidence: context.evidence.length > 0,
      canOpenGraph: canReadGraph,
      canOpenActivity: false,
      canInvestigate: false,
      canDismiss:
        scope.activeProject.isOwner &&
        canDiscoveryFindingTransitionV1(
          context.lifecycle.lifecycleState,
          'DISMISSED',
          'GOVERNED_WORKFLOW',
          'DISMISSED',
        ),
    } as const;
    let activity: DiscoveryProductActivityBindingV1 | undefined;
    if (this.activityRead !== undefined) {
      try {
        const binding = await this.activityRead.findActivityBinding({
          projectId: finding.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          runId: finding.runId,
        });
        if (
          binding !== undefined &&
          binding.jobId.trim().length > 0 &&
          binding.runId === finding.runId
        ) {
          activity = {
            schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
            activityId: binding.jobId,
            jobId: binding.jobId,
            runId: binding.runId,
            resourceKind: 'DiscoveryJob',
            resourceHref: `/activity?domain=DISCOVERY&activity=${encodeURIComponent(binding.jobId)}&resource=DiscoveryJob&resourceId=${encodeURIComponent(binding.jobId)}`,
          };
          canOpenActivity = true;
        }
      } catch {
        // Capability authority is fail-closed when the Activity root cannot be
        // revalidated. The Finding remains readable without the backlink.
      }
    }
    const capabilities: DiscoveryProductCapabilitiesV1 = {
      ...capabilitiesBase,
      canOpenActivity,
    };
    const summary = decodeDiscoveryProductFindingSummaryV1({
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      projectId: finding.projectId,
      findingType: finding.findingType,
      authority: 'DERIVED_INFERENCE',
      generationMethod: finding.generationMethod,
      lifecycleState: context.lifecycle.lifecycleState,
      title: normalizeText(titleAndSummary.title, 120),
      summary: normalizeText(titleAndSummary.summary, 280),
      rationale: normalizeText(finding.rationale, 1000),
      derivationSummary: normalizeText(finding.derivationSummary, 1000),
      safeSignals: safeSignalsFrom(finding),
      governance,
      freshness,
      runId: finding.runId,
      capabilities,
      ...(activity === undefined ? {} : { activity }),
      createdAt: finding.createdAt,
    });
    const lineage: DiscoveryProductLineageV1 = {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      relatedResourceRefs,
      evidence: context.evidence,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: freshness.canonicalBase,
      discoveryBase: freshness.discoveryBase,
      provenance: safeProvenanceFrom(finding),
    };
    return { summary, lineage };
  }

  private async resolvePresentationPolicy(
    projectId: string,
    evaluationTime: string,
  ): Promise<EffectivePresentationPolicyV1> {
    const revision = await this.feedbackRepository?.resolveEffectiveRankingPolicy({
      projectId,
      policyId: DISCOVERY_PRODUCT_POLICY_ID_V1,
      at: evaluationTime,
    });
    return revision === undefined ? fallbackPresentationPolicy() : policyForRevision(revision);
  }

  /** Streams immutable Finding revisions in bounded keyset batches. The
   * presentation layer never materializes the Project's complete Finding set. */
  private async *readPresentationBatches(
    projectId: string,
    evaluationTime: string,
  ): AsyncGenerator<readonly DiscoveryFindingEnvelopeV1[], void, void> {
    let after: DiscoveryProductPageCursorV1 | undefined;
    const batchSize = 250;
    for (;;) {
      const page = await this.source.listFindings(projectId, after, batchSize);
      if (page.length === 0) break;
      const evaluationMillis = Date.parse(evaluationTime);
      const eligible = page.filter(
        (finding) =>
          finding.projectId === projectId &&
          Number.isFinite(Date.parse(finding.createdAt)) &&
          Date.parse(finding.createdAt) <= evaluationMillis,
      );
      if (eligible.length > 0) yield eligible;
      if (page.length < batchSize) break;
      const last = page.at(-1)!;
      const next = { findingId: last.findingId, findingRevision: last.findingRevision };
      if (
        after &&
        next.findingId === after.findingId &&
        next.findingRevision === after.findingRevision
      ) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          'Discovery Finding pagination is invalid.',
        );
      }
      after = next;
    }
  }

  private async latestPresentationFeedback(
    scope: DiscoveryProductReadInput,
    evaluationTime: string,
  ): Promise<ReadonlyMap<string, DiscoveryFeedbackEventV1> | undefined> {
    if (!this.feedbackRepository) return new Map();
    const bulk = this.feedbackRepository.listLatestUtilityFeedbackForPresentation;
    if (!bulk) return undefined;
    const events = await bulk.call(this.feedbackRepository, {
      projectId: scope.activeProject.id,
      principalId: scope.principalId,
      at: evaluationTime,
    });
    return latestUtilityByFinding(
      events.filter(
        (event) =>
          event.projectId === scope.activeProject.id &&
          subjectId(event) === scope.principalId &&
          Date.parse(event.createdAt) <= Date.parse(evaluationTime),
      ),
    );
  }

  private async latestUtilityForFinding(
    finding: DiscoveryFindingEnvelopeV1,
    scope: DiscoveryProductReadInput,
    evaluationTime: string,
  ): Promise<DiscoveryFeedbackEventV1 | undefined> {
    if (!this.feedbackRepository) return undefined;
    const events = await this.feedbackRepository.listFeedbackForFinding({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      principalId: scope.principalId,
    });
    return latestUtilityByFinding(
      events.filter(
        (event) =>
          event.projectId === scope.activeProject.id &&
          subjectId(event) === scope.principalId &&
          Date.parse(event.createdAt) <= Date.parse(evaluationTime),
      ),
    ).get(findingIdentityKey(finding));
  }

  private async presentationSuppressions(
    scope: DiscoveryProductReadInput,
    evaluationTime: string,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[] | undefined> {
    if (!this.feedbackRepository) return [];
    const bulk = this.feedbackRepository.listSuppressionForPresentation;
    if (!bulk) return undefined;
    return bulk.call(this.feedbackRepository, {
      projectId: scope.activeProject.id,
      principalId: scope.principalId,
      at: evaluationTime,
    });
  }

  private async relevantSuppressionForFinding(
    finding: DiscoveryFindingEnvelopeV1,
    scope: DiscoveryProductReadInput,
    evaluationTime: string,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]> {
    if (!this.feedbackRepository) return [];
    const rows = await this.feedbackRepository.listRelevantSuppression({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      principalId: scope.principalId,
      fingerprint: finding.fingerprint,
      fingerprintVersion: finding.fingerprintVersion,
      semanticMatcherVersion: DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1,
      at: evaluationTime,
    });
    return rows.filter(
      (directive) => Date.parse(directive.createdAt) <= Date.parse(evaluationTime),
    );
  }

  private async authorizedSuppressionSources(
    directives: readonly DiscoverySuppressionDirectiveV1[],
    scope: DiscoveryProductReadInput,
    evaluationTime: string,
  ): Promise<Map<string, DiscoveryFindingEnvelopeV1>> {
    const sources = new Map<string, DiscoveryFindingEnvelopeV1>();
    const unique = new Map<string, DiscoverySuppressionDirectiveV1>();
    for (const directive of directives) {
      const key = findingIdentityKey({
        findingId: directive.sourceFindingId,
        findingRevision: directive.sourceFindingRevision,
      });
      if (!unique.has(key)) unique.set(key, directive);
    }
    await Promise.all(
      [...unique.entries()].map(async ([key, directive]) => {
        if (
          directive.projectId !== scope.activeProject.id ||
          subjectId(directive) !== scope.principalId
        ) {
          return;
        }
        try {
          const source = await this.source.findFinding({
            projectId: directive.projectId,
            findingId: directive.sourceFindingId,
            findingRevision: directive.sourceFindingRevision,
          });
          if (
            source === undefined ||
            Date.parse(source.createdAt) > Date.parse(evaluationTime) ||
            !(await this.authorizeResources(source, scope))
          ) {
            return;
          }
          sources.set(key, source);
        } catch {
          // An inaccessible or corrupt source is a fail-closed NO MATCH.
        }
      }),
    );
    return sources;
  }

  private async isSameFindingLineage(
    candidate: DiscoveryFindingEnvelopeV1,
    source: DiscoveryFindingEnvelopeV1,
  ): Promise<boolean> {
    const visited = new Set<string>();
    let current: DiscoveryFindingEnvelopeV1 | undefined = candidate;
    for (let index = 0; current !== undefined && index < 100; index += 1) {
      if (current.findingId === source.findingId) return true;
      const parentId = current.supersedesFindingId;
      if (!parentId || parentId === source.findingId) return parentId === source.findingId;
      if (visited.has(parentId) || this.source.findLatestFinding === undefined) return false;
      visited.add(parentId);
      current = await this.source.findLatestFinding(candidate.projectId, parentId);
    }
    return false;
  }

  private async suppressionMatches(
    directive: DiscoverySuppressionDirectiveV1,
    candidate: DiscoveryFindingEnvelopeV1,
    suppressionSources: Map<string, DiscoveryFindingEnvelopeV1>,
    principalId: string,
    scope: DiscoveryProductReadInput,
    evaluationTime: string,
  ): Promise<boolean> {
    if (directive.projectId !== candidate.projectId || subjectId(directive) !== principalId) {
      return false;
    }
    if (directive.suppressionKind === 'SNOOZE') {
      return (
        directive.matcherKind === 'NONE' &&
        directive.sourceFindingId === candidate.findingId &&
        directive.sourceFindingRevision === candidate.findingRevision
      );
    }
    if (directive.suppressionKind === 'SUPPRESS_EXACT') {
      return (
        directive.matcherKind === 'EXACT_FINGERPRINT' &&
        directive.fingerprint === candidate.fingerprint &&
        directive.fingerprintVersion === candidate.fingerprintVersion &&
        (directive.scope === 'PROJECT' ||
          (directive.sourceFindingId === candidate.findingId &&
            directive.sourceFindingRevision === candidate.findingRevision))
      );
    }
    if (
      directive.matcherKind !== 'SEMANTIC_FAMILY' ||
      directive.matcherVersion !== DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1
    ) {
      return false;
    }
    const sourceKey = findingIdentityKey({
      findingId: directive.sourceFindingId,
      findingRevision: directive.sourceFindingRevision,
    });
    let source = suppressionSources.get(sourceKey);
    if (!source) {
      try {
        const resolved = await this.source.findFinding({
          projectId: directive.projectId,
          findingId: directive.sourceFindingId,
          findingRevision: directive.sourceFindingRevision,
        });
        if (
          resolved !== undefined &&
          Date.parse(resolved.createdAt) <= Date.parse(evaluationTime) &&
          (await this.authorizeResources(resolved, scope))
        ) {
          source = resolved;
          suppressionSources.set(sourceKey, resolved);
        }
      } catch {
        // An inaccessible or corrupt source is a fail-closed NO MATCH.
      }
    }
    if (!source) return false;
    const sourceFamily = discoverySemanticFamilyKeyV1(source);
    const candidateFamily = discoverySemanticFamilyKeyV1(candidate);
    if (
      sourceFamily === undefined ||
      candidateFamily === undefined ||
      sourceFamily !== candidateFamily
    ) {
      return false;
    }
    return directive.scope === 'PROJECT'
      ? candidate.projectId === directive.projectId
      : this.isSameFindingLineage(candidate, source);
  }

  private async listRankedFindings(
    scope: DiscoveryProductReadInput & { readonly request: ListDiscoveryFindingsRequestV1 },
  ): Promise<ListDiscoveryFindingsResultV1> {
    const limit = scope.request.limit ?? DEFAULT_PAGE_LIMIT;
    const decodedCursor =
      scope.request.cursor === undefined
        ? undefined
        : this.cursorCodec.decode(scope.request.cursor);
    if (
      decodedCursor?.projectId !== undefined &&
      decodedCursor.projectId !== scope.activeProject.id
    ) {
      throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
    }
    const cursorContext = decodedCursor?.context;
    if (scope.request.cursor !== undefined && cursorContext === undefined) {
      throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
    }
    const filterContextDigest = discoveryFilterContextDigest(scope.request);
    const evaluationTime = cursorContext?.evaluationTime ?? this.now();
    if (!Number.isFinite(Date.parse(evaluationTime))) {
      throw new FrontendContractError('INVALID_REQUEST', 'Discovery evaluation time is invalid.');
    }
    if (
      cursorContext &&
      (cursorContext.principalId !== scope.principalId ||
        cursorContext.accessRevision !== scope.accessRevision ||
        cursorContext.policyContextRevision !== scope.policyContextRevision ||
        cursorContext.filterContextDigest !== filterContextDigest)
    ) {
      throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
    }
    const effective = await this.resolvePresentationPolicy(scope.activeProject.id, evaluationTime);
    if (
      cursorContext &&
      (cursorContext.policyIdentity !== effective.policyIdentity ||
        cursorContext.policyRevision !== effective.policyRevision)
    ) {
      throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
    }
    if (!this.rankingAuthority) {
      return failure(
        'INTERNAL_UNCLASSIFIED',
        'rank-discovery-findings',
        'Discovery ranking authority is not configured.',
      );
    }
    const after = cursorContext?.lastSortKey;
    const feedback = await this.latestPresentationFeedback(scope, evaluationTime);
    const suppressions = await this.presentationSuppressions(scope, evaluationTime);
    const suppressionSources = await this.authorizedSuppressionSources(
      suppressions ?? [],
      scope,
      evaluationTime,
    );
    type RankedPresentationEntry = {
      readonly finding: DiscoveryFindingEnvelopeV1;
      readonly scoreKey: DiscoveryProductPresentationSortKeyV1;
      readonly summary: DiscoveryProductFindingSummaryV1;
      readonly reasons: readonly DiscoveryProductPresentationReasonCodeV1[];
    };
    const best: RankedPresentationEntry[] = [];
    const rankBase = cursorContext?.lastRank ?? 0;
    for await (const batch of this.readPresentationBatches(
      scope.activeProject.id,
      evaluationTime,
    )) {
      const views: {
        readonly finding: DiscoveryFindingEnvelopeV1;
        readonly summary: DiscoveryProductFindingSummaryV1;
      }[] = [];
      for (const finding of batch) {
        try {
          views.push({ finding, summary: (await this.toSummary(finding, scope)).summary });
        } catch (error) {
          if (error instanceof ShotgunError && error.code === 'NOT_FOUND') continue;
          throw error;
        }
      }
      const eligible: {
        readonly finding: DiscoveryFindingEnvelopeV1;
        readonly summary: DiscoveryProductFindingSummaryV1;
        readonly utilityKindValue:
          keyof typeof DISCOVERY_PRODUCT_UTILITY_ADJUSTMENTS_V1 | undefined;
        readonly reasons: readonly DiscoveryProductPresentationReasonCodeV1[];
      }[] = [];
      for (const view of views) {
        if (
          (scope.request.findingTypes !== undefined &&
            !scope.request.findingTypes.includes(view.summary.findingType)) ||
          (scope.request.lifecycleStates !== undefined &&
            !scope.request.lifecycleStates.includes(view.summary.lifecycleState))
        ) {
          continue;
        }
        const utility = feedback
          ? feedback.get(findingIdentityKey(view.finding))
          : await this.latestUtilityForFinding(view.finding, scope, evaluationTime);
        const candidateSuppressions = suppressions
          ? suppressions
          : await this.relevantSuppressionForFinding(view.finding, scope, evaluationTime);
        let matchingSuppression: DiscoverySuppressionDirectiveV1 | undefined;
        for (const directive of candidateSuppressions) {
          if (
            await this.suppressionMatches(
              directive,
              view.finding,
              suppressionSources,
              scope.principalId,
              scope,
              evaluationTime,
            )
          ) {
            matchingSuppression = directive;
            break;
          }
        }
        const mandatory = isMandatoryVisibility(view.finding);
        if (matchingSuppression && !mandatory) continue;
        const utilityKindValue = utilityKind(utility);
        const reasons: DiscoveryProductPresentationReasonCodeV1[] = ['BASE_RANK'];
        if (utilityKindValue) reasons.push(utilityReasonFor(utilityKindValue));
        if (matchingSuppression && mandatory) reasons.push('MANDATORY_VISIBILITY_OVERRIDE');
        eligible.push({
          finding: view.finding,
          summary: view.summary,
          utilityKindValue,
          reasons,
        });
      }
      if (eligible.length === 0) continue;
      const ranked = this.rankingAuthority(
        eligible.map(({ finding }) => ({
          candidate: finding,
          dimensions: deriveDiscoveryRankingDimensionsV1(finding),
        })),
        effective.policy,
      );
      const eligibleByIdentity = new Map(
        eligible.map((entry) => [findingIdentityKey(entry.finding), entry]),
      );
      for (const entry of ranked) {
        const context = eligibleByIdentity.get(findingIdentityKey(entry.candidate));
        if (!context) continue;
        const scoreKey = {
          effectivePriorityMicros:
            entry.scoreMicros +
            (context.utilityKindValue === undefined
              ? 0
              : DISCOVERY_PRODUCT_UTILITY_ADJUSTMENTS_V1[context.utilityKindValue]),
          findingId: entry.candidate.findingId,
          findingRevision: entry.candidate.findingRevision,
        } satisfies DiscoveryProductPresentationSortKeyV1;
        if (after && !isAfterPresentationCursor(scoreKey, after)) continue;
        best.push({
          finding: entry.candidate,
          scoreKey,
          summary: context.summary,
          reasons: context.reasons,
        });
      }
      best.sort((left, right) => presentationSortKeyCompare(left.scoreKey, right.scoreKey));
      if (best.length > limit + 1) best.length = limit + 1;
    }
    const page = best.slice(0, limit);
    const findings = page.map(({ summary, reasons }, index) => ({
      ...summary,
      presentation: {
        rank: rankBase + index + 1,
        reasonCodes: reasons,
      } satisfies DiscoveryProductFindingPresentationV1,
    }));
    const hasMore = best.length > page.length;
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? this.cursorCodec.encode({
            projectId: scope.activeProject.id,
            cursor: {
              findingId: last.finding.findingId,
              findingRevision: last.finding.findingRevision,
            },
            context: {
              principalId: scope.principalId,
              accessRevision: scope.accessRevision,
              policyContextRevision: scope.policyContextRevision,
              evaluationTime,
              policyIdentity: effective.policyIdentity,
              policyRevision: effective.policyRevision,
              filterContextDigest,
              utilityAdjustmentVersion: DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1,
              semanticMatcherVersion: DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1,
              lastSortKey: last.scoreKey,
              lastRank: rankBase + page.length,
            },
          })
        : undefined;
    const presentation: DiscoveryProductPresentationMetadataV1 = {
      algorithmVersion: DISCOVERY_RANKING_POLICY_VERSION_V1,
      policyIdentity: effective.policyIdentity,
      policyRevision: effective.policyRevision,
      policySource: effective.policySource,
      utilityAdjustmentVersion: DISCOVERY_PRODUCT_UTILITY_ADJUSTMENT_VERSION_V1,
      semanticMatcherVersion: DISCOVERY_PRODUCT_SEMANTIC_MATCHER_VERSION_V1,
      evaluationTime,
    };
    return {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      findings,
      presentation,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async listFindings(
    scope: DiscoveryProductReadInput & { readonly request: ListDiscoveryFindingsRequestV1 },
  ): Promise<ListDiscoveryFindingsResultV1> {
    if (this.feedbackRepository !== undefined) return this.listRankedFindings(scope);
    const limit = scope.request.limit ?? DEFAULT_PAGE_LIMIT;
    const decodedCursor =
      scope.request.cursor === undefined
        ? undefined
        : this.cursorCodec.decode(scope.request.cursor);
    if (decodedCursor && decodedCursor.projectId !== scope.activeProject.id) {
      throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
    }
    const after = decodedCursor?.cursor;
    const raw = await this.source.listFindings(scope.activeProject.id, after, limit + 1);
    const consumed = raw.slice(0, limit);
    const selected = consumed.filter(
      (finding) =>
        scope.request.findingTypes === undefined ||
        scope.request.findingTypes.includes(finding.findingType),
    );
    const findings: DiscoveryProductFindingSummaryV1[] = [];
    for (const finding of selected) {
      try {
        const summary = (await this.toSummary(finding, scope)).summary;
        if (
          scope.request.lifecycleStates !== undefined &&
          !scope.request.lifecycleStates.includes(summary.lifecycleState)
        ) {
          continue;
        }
        findings.push(summary);
      } catch (error) {
        if (error instanceof ShotgunError && error.code === 'NOT_FOUND') continue;
        throw error;
      }
    }
    const nextCursor =
      raw.length > limit && consumed.at(-1)
        ? this.cursorCodec.encode({
            projectId: scope.activeProject.id,
            cursor: {
              findingId: consumed.at(-1)!.findingId,
              findingRevision: consumed.at(-1)!.findingRevision,
            },
          })
        : undefined;
    return {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      findings,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async readFinding(
    scope: DiscoveryProductReadInput & { readonly request: ReadDiscoveryFindingRequestV1 },
  ): Promise<ReadDiscoveryFindingResultV1> {
    const finding = await this.source.findFinding({
      projectId: scope.activeProject.id,
      findingId: scope.request.findingId,
      findingRevision: scope.request.findingRevision,
    });
    if (!finding) return notFound();
    const view = await this.toSummary(finding, scope);
    const detail = decodeDiscoveryProductFindingDetailV1({
      ...view.summary,
      payload: finding.payload,
      lineage: view.lineage,
    });
    return {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      finding: detail,
    };
  }

  /**
   * Internal server-only authority bridge for Product commands. The raw
   * Finding never crosses the browser boundary; the normal Product
   * projection path is still executed first so project, resource, scope and
   * sensitivity checks remain identical to a user read.
   */
  async findAuthoritativeFinding(
    scope: DiscoveryProductReadInput & {
      readonly request: ReadDiscoveryFindingRequestV1;
    },
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined> {
    const finding = await this.source.findFinding({
      projectId: scope.activeProject.id,
      findingId: scope.request.findingId,
      findingRevision: scope.request.findingRevision,
    });
    if (!finding) return undefined;
    try {
      await this.toSummary(finding, scope);
    } catch (error) {
      if (error instanceof ShotgunError && error.code === 'NOT_FOUND') return undefined;
      throw error;
    }
    return finding;
  }
}
