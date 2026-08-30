import {
  computeDiscoveryReentryLogicalIdentityV1,
  createDerivedKnowledgeCandidateV1,
  createDiscoveryReentryManifestV1,
  decodeDerivedKnowledgeCandidateV1,
  decodeDiscoveryFindingEnvelopeV1,
  decodeDiscoveryFindingReadyV1,
  deriveDiscoveryReentryEligibilityV1,
  DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
  DISCOVERY_REENTRY_TARGET_BY_TYPE,
  assertDiscoveryReviewResourceMatchesCandidateV1,
  assertDiscoveryReentryManifestMatchesFindingV1,
  validateDiscoveryApprovedResourceRevisionResolutionV1,
  discoveryReviewResourceContentDigestV1,
  computeDiscoveryReviewRootIdentityV1,
  decodeDiscoveryReviewResourceV1,
  semanticStableJson,
  sha256Text,
  type DiscoveryReviewResourceDigestInputV1,
  type DerivedKnowledgeCandidateV1,
  type DiscoveryCanonicalBaseIdentityV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingReadyV1,
  type DiscoveryProjectionBaseIdentityV1,
  type DiscoveryReentryLogicalIdentityResultV1,
  type DiscoveryReentryManifestV1,
  type DiscoveryApprovedResourceRevisionRefV1,
  type DiscoveryResourceRefV1,
  type DiscoveryReviewImpactMaterialV1,
  type DiscoveryReviewNormalizedMaterialV1,
  type DiscoveryReviewResourceV1,
  type DiscoveryReviewLineageV1,
  type DiscoveryReviewTypeSpecificMaterialV1,
  assessDiscoveryReentryFreshnessV1,
  DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1,
  type DiscoveryReentryFreshnessAssessmentV1,
  type DiscoveryReentryFreshnessBindingV1,
  type DiscoveryReentryFreshnessCurrentStateV1,
  type DiscoveryReentryFreshnessStageV1,
} from '../../../packages/contracts/src/index.js';

export type { DiscoveryReentryFreshnessStageV1 } from '../../../packages/contracts/src/index.js';

export const DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION =
  'DERIVED_PROVENANCE_VALIDATION' as const;

export const DISCOVERY_REENTRY_CONSUMPTION_DISPOSITIONS = [
  'PROCESSED',
  'INELIGIBLE',
  'BLOCKED_NON_RETRYABLE',
  'RETRYABLE',
] as const;
export const DISCOVERY_REENTRY_DEFAULT_RETRY_BACKOFF_MS = 1_000;
export type DiscoveryReentryConsumptionDispositionV1 =
  (typeof DISCOVERY_REENTRY_CONSUMPTION_DISPOSITIONS)[number];

export const DISCOVERY_REENTRY_CONSUMPTION_REASON_CODES = [
  'SUCCESS',
  'LIFECYCLE_INELIGIBLE',
  'NO_APPROVED_REENTRY_AUTHORITY',
  'NO_APPROVED_REVISION_AT_FROZEN_BASE',
  'FINDING_NOT_FOUND',
  'IDENTITY_MISMATCH',
  'UNSUPPORTED_RESOURCE_KIND',
  'RETRYABLE_INFRASTRUCTURE_FAILURE',
] as const;
export type DiscoveryReentryConsumptionReasonCodeV1 =
  (typeof DISCOVERY_REENTRY_CONSUMPTION_REASON_CODES)[number];

export type DiscoveryFindingIdentityV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryReentryLifecycleCurrentV1 = DiscoveryFindingIdentityV1 & {
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly lifecycleRevision: number;
  readonly updatedAt: string;
};

export type DiscoveryApprovedResourceRevisionResolutionInputV1 = {
  readonly projectId: string;
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
};

export type DiscoveryApprovedResourceRevisionResolutionResultV1 =
  | {
      readonly status: 'RESOLVED';
      readonly refs: readonly DiscoveryApprovedResourceRevisionRefV1[];
    }
  | {
      readonly status: 'UNRESOLVED';
      readonly reason: string;
      readonly reasonCode?: DiscoveryReentryConsumptionReasonCodeV1;
    };

/** The only authority allowed to turn Finding refs into approved revisions. */
export type DiscoveryApprovedResourceRevisionResolverPort = {
  resolve(
    input: DiscoveryApprovedResourceRevisionResolutionInputV1,
  ): Promise<DiscoveryApprovedResourceRevisionResolutionResultV1>;
};

export type DiscoveryReentryStoredIntakeV1 = {
  readonly logicalIdentityKey: string;
  readonly manifest: DiscoveryReentryManifestV1;
  readonly candidate: DerivedKnowledgeCandidateV1;
  readonly lifecycle: DiscoveryReentryLifecycleCurrentV1;
};

export type DiscoveryReentryReviewReadyTransitionInputV1 = DiscoveryFindingIdentityV1 & {
  readonly expectedLifecycleRevision: number;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly occurredAt: string;
};

export type DiscoveryReentryReviewReadyTransitionResultV1 =
  | {
      readonly status: 'APPLIED' | 'IDEMPOTENT';
      readonly current: DiscoveryReentryLifecycleCurrentV1;
    }
  | {
      readonly status: 'CONFLICT';
      readonly current: DiscoveryReentryLifecycleCurrentV1;
    };

export type DiscoveryReentryConsumptionDispositionRecordV1 = DiscoveryFindingIdentityV1 & {
  readonly requestedReentryPurpose: typeof DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION;
  readonly publicationId: string;
  readonly disposition: DiscoveryReentryConsumptionDispositionV1;
  readonly reasonCode: DiscoveryReentryConsumptionReasonCodeV1;
  readonly reasonDetail: string;
  readonly nextEligibleAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DiscoveryReentryConsumptionDispositionInputV1 = Omit<
  DiscoveryReentryConsumptionDispositionRecordV1,
  'createdAt' | 'updatedAt'
> & {
  readonly occurredAt: string;
};

export type DiscoveryReentryPersistenceResultV1 =
  | ({ readonly status: 'CREATED' | 'IDEMPOTENT' } & DiscoveryReentryStoredIntakeV1)
  | {
      readonly status: 'INELIGIBLE';
      readonly lifecycle: DiscoveryReentryLifecycleCurrentV1;
    }
  | {
      readonly status: 'DISPOSITIONED';
      readonly disposition: 'INELIGIBLE' | 'BLOCKED_NON_RETRYABLE';
      readonly reasonCode: DiscoveryReentryConsumptionReasonCodeV1;
      readonly lifecycle: DiscoveryReentryLifecycleCurrentV1;
    };

export type DiscoveryReentryPersistencePort = {
  listPendingFindingReady(limit: number): Promise<readonly DiscoveryFindingReadyV1[]>;
  findFinding(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined>;
  findLifecycle(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryReentryLifecycleCurrentV1 | undefined>;
  findConsumptionDisposition(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1 | undefined>;
  recordConsumptionDisposition(
    input: DiscoveryReentryConsumptionDispositionInputV1,
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1>;
  findExisting(logicalIdentityKey: string): Promise<DiscoveryReentryStoredIntakeV1 | undefined>;
  /** Existing persisted candidates that still need the WP3 Review projection. */
  listPendingReviewMaterialization?(
    limit: number,
  ): Promise<readonly DiscoveryReentryStoredIntakeV1[]>;
  /** Existing lifecycle authority; no second lifecycle store is permitted. */
  transitionFindingToReviewReady?(
    input: DiscoveryReentryReviewReadyTransitionInputV1,
  ): Promise<DiscoveryReentryReviewReadyTransitionResultV1>;
  /** Existing Finding lifecycle authority used to close a stale intake. */
  transitionFindingToStale?(
    input: DiscoveryReentryStaleTransitionInputV1,
  ): Promise<DiscoveryReentryStaleTransitionResultV1>;
  persistIntake(input: {
    readonly logicalIdentity: DiscoveryReentryLogicalIdentityResultV1;
    readonly finding: DiscoveryFindingEnvelopeV1;
    readonly manifest: DiscoveryReentryManifestV1;
    readonly candidate: DerivedKnowledgeCandidateV1;
    readonly expectedLifecycleRevision: number;
    readonly publicationId: string;
    readonly occurredAt: string;
  }): Promise<DiscoveryReentryPersistenceResultV1>;
};

export type DiscoveryReentryStaleTransitionInputV1 = DiscoveryFindingIdentityV1 & {
  readonly expectedLifecycleRevision: number;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly occurredAt: string;
};

export type DiscoveryReentryStaleTransitionResultV1 =
  | {
      readonly status: 'APPLIED' | 'IDEMPOTENT';
      readonly current: DiscoveryReentryLifecycleCurrentV1;
    }
  | {
      readonly status: 'CONFLICT';
      readonly current: DiscoveryReentryLifecycleCurrentV1;
    };

export type DiscoveryReentryFreshnessAuthorityPort = {
  read(input: {
    readonly binding: DiscoveryReentryFreshnessBindingV1;
    readonly stage: DiscoveryReentryFreshnessStageV1;
  }): Promise<DiscoveryReentryFreshnessCurrentStateV1>;
};

export type DiscoveryReentryFreshnessEvaluatorPort = {
  assess(input: {
    readonly binding: DiscoveryReentryFreshnessBindingV1;
    readonly stage: DiscoveryReentryFreshnessStageV1;
    readonly assessedAt: string;
  }): Promise<DiscoveryReentryFreshnessAssessmentV1>;
};

/** Narrow reusable evaluator: authorities supply current server-side state. */
export class DiscoveryReentryFreshnessEvaluator implements DiscoveryReentryFreshnessEvaluatorPort {
  public constructor(private readonly authority: DiscoveryReentryFreshnessAuthorityPort) {}

  public async assess(input: {
    readonly binding: DiscoveryReentryFreshnessBindingV1;
    readonly stage: DiscoveryReentryFreshnessStageV1;
    readonly assessedAt: string;
  }): Promise<DiscoveryReentryFreshnessAssessmentV1> {
    try {
      const current = await this.authority.read(input);
      return assessDiscoveryReentryFreshnessV1({
        binding: input.binding,
        current,
        assessedAt: input.assessedAt,
      });
    } catch (error) {
      return {
        schemaVersion: '1.0.0',
        assessmentVersion: DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1,
        assessmentId: sha256Text(
          semanticStableJson({
            assessmentVersion: DISCOVERY_REENTRY_FRESHNESS_ASSESSMENT_VERSION_V1,
            projectId: input.binding.projectId,
            findingId: input.binding.findingId,
            findingRevision: input.binding.findingRevision,
            state: 'PERSISTENCE_FAILURE',
            assessedAt: input.assessedAt,
          }),
        ),
        assessedAt: input.assessedAt,
        projectId: input.binding.projectId,
        findingId: input.binding.findingId,
        findingRevision: input.binding.findingRevision,
        state: 'PERSISTENCE_FAILURE',
        reasonCodes: [],
        reasonDetail: textOf(error),
      };
    }
  }
}

export const discoveryReentryFreshnessBindingFromFindingV1 = (
  finding: DiscoveryFindingEnvelopeV1,
): DiscoveryReentryFreshnessBindingV1 => ({
  projectId: finding.projectId,
  findingId: finding.findingId,
  findingRevision: finding.findingRevision,
  findingType: finding.findingType,
  sourceProjectionDigest: finding.sourceProjectionDigest,
  canonicalBase: finding.canonicalBase,
  discoveryBase: finding.discoveryBase,
  approvedRelatedResourceRefs: finding.relatedResourceRefs.map((ref) => ({
    ...ref,
    resourceState: 'APPROVED' as const,
    resourceRevision: ref.resourceRevision ?? 'CURRENT',
  })),
  evidenceIds: finding.evidenceIds,
  derivationProvenanceDigest: sha256Text(semanticStableJson(finding.provenance)),
  validationProfileVersion: 'discovery-derived-validation:v1',
  accessScope: finding.accessScope,
  sensitivity: finding.sensitivity,
});

export const discoveryReentryFreshnessBindingFromCandidateV1 = (
  candidate: DerivedKnowledgeCandidateV1,
  finding: DiscoveryFindingEnvelopeV1,
): DiscoveryReentryFreshnessBindingV1 => ({
  projectId: candidate.projectId,
  findingId: candidate.findingId,
  findingRevision: candidate.findingRevision,
  findingType: candidate.findingType,
  sourceProjectionDigest: candidate.sourceProjectionDigest,
  canonicalBase: candidate.canonicalBase,
  discoveryBase: candidate.discoveryBase,
  manifestId: candidate.manifestId,
  candidateId: candidate.candidateId,
  candidateRevision: candidate.candidateRevision,
  approvedRelatedResourceRefs: candidate.relatedResourceRefs,
  evidenceIds: finding.evidenceIds,
  derivationProvenanceDigest: sha256Text(semanticStableJson(candidate.derivationProvenance)),
  validationProfileVersion: candidate.validationProfile.profileVersion,
  accessScope: candidate.accessScope,
  sensitivity: candidate.sensitivity,
});

export const discoveryReentryFreshnessBindingFromReviewResourceV1 = (
  resource: DiscoveryReviewResourceV1,
): DiscoveryReentryFreshnessBindingV1 =>
  discoveryReentryFreshnessBindingFromLineageV1(resource, {
    reviewResourceId: resource.reviewResourceId,
    resourceRevision: resource.resourceRevision,
    resourceDigest: resource.contentDigest,
  });

export const discoveryReentryFreshnessBindingFromLineageV1 = (
  lineage: DiscoveryReviewLineageV1,
  reviewTarget?: DiscoveryReentryFreshnessBindingV1['reviewTarget'],
): DiscoveryReentryFreshnessBindingV1 => ({
  projectId: lineage.projectId,
  findingId: lineage.findingId,
  findingRevision: lineage.findingRevision,
  findingType: lineage.findingType,
  sourceProjectionDigest: lineage.sourceProjectionDigest,
  canonicalBase: lineage.canonicalBase,
  discoveryBase: lineage.discoveryBase,
  manifestId: lineage.manifestId,
  candidateId: lineage.candidateId,
  candidateRevision: lineage.candidateRevision,
  approvedRelatedResourceRefs: lineage.relatedResourceRefs,
  evidenceIds: lineage.evidenceIds,
  derivationProvenanceDigest: sha256Text(semanticStableJson(lineage.derivationProvenance)),
  validationProfileVersion: lineage.validationProfile.profileVersion,
  accessScope: lineage.accessScope,
  sensitivity: lineage.sensitivity,
  ...(reviewTarget === undefined ? {} : { reviewTarget }),
});

export type DiscoveryReentryConsumeResultV1 =
  | {
      readonly status: 'CREATED' | 'IDEMPOTENT';
      readonly logicalIdentityKey: string;
      readonly manifest: DiscoveryReentryManifestV1;
      readonly candidate: DerivedKnowledgeCandidateV1;
    }
  | {
      readonly status: 'INELIGIBLE';
      readonly logicalIdentityKey?: string;
      readonly lifecycleState: DiscoveryFindingLifecycleState;
      readonly disposition: 'INELIGIBLE';
      readonly freshnessAssessment?: DiscoveryReentryFreshnessAssessmentV1;
    }
  | {
      readonly status: 'FINDING_NOT_FOUND';
      readonly projectId: string;
      readonly findingId: string;
      readonly findingRevision: number;
    }
  | {
      readonly status: 'IDENTITY_MISMATCH';
      readonly reason: string;
    }
  | {
      readonly status: 'INVALID_PUBLICATION';
      readonly reason: string;
    }
  | {
      readonly status: 'UNRESOLVED_REVISION';
      readonly reason: string;
      readonly reasonCode?: DiscoveryReentryConsumptionReasonCodeV1;
      readonly disposition?: 'BLOCKED_NON_RETRYABLE';
    }
  | {
      readonly status: 'RETRYABLE';
      readonly reason: string;
      readonly reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE';
      readonly disposition: 'RETRYABLE';
      readonly nextEligibleAt: string;
    }
  | {
      readonly status: 'PERSISTENCE_FAILURE';
      readonly reason: string;
    };

export type DiscoveryReentryBatchResultV1 = {
  readonly fetched: number;
  readonly results: readonly DiscoveryReentryConsumeResultV1[];
};

const textOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Discovery re-entry failed closed.';

const isRetryableFailure = (error: unknown): error is { readonly retryable: true } =>
  typeof error === 'object' &&
  error !== null &&
  'retryable' in error &&
  (error as { readonly retryable?: unknown }).retryable === true;

const sameCanonicalBase = (
  left: DiscoveryCanonicalBaseIdentityV1,
  right: DiscoveryCanonicalBaseIdentityV1,
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.canonicalVersion === right.canonicalVersion &&
  left.snapshotDigest === right.snapshotDigest;

const sameDiscoveryBase = (
  left: DiscoveryProjectionBaseIdentityV1,
  right: DiscoveryProjectionBaseIdentityV1,
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.projectionRevision === right.projectionRevision &&
  left.projectionDigest === right.projectionDigest;

const findingIdentity = (publication: DiscoveryFindingReadyV1): DiscoveryFindingIdentityV1 => ({
  projectId: publication.projectId,
  findingId: publication.findingId,
  findingRevision: publication.findingRevision,
});

const dispositionResult = (
  disposition: DiscoveryReentryConsumptionDispositionRecordV1,
  lifecycle: DiscoveryReentryLifecycleCurrentV1,
): DiscoveryReentryConsumeResultV1 | undefined => {
  if (disposition.disposition === 'INELIGIBLE') {
    return {
      status: 'INELIGIBLE',
      lifecycleState: lifecycle.lifecycleState,
      disposition: 'INELIGIBLE',
    };
  }
  if (disposition.disposition === 'BLOCKED_NON_RETRYABLE') {
    return {
      status: 'UNRESOLVED_REVISION',
      reason: disposition.reasonDetail,
      reasonCode: disposition.reasonCode,
      disposition: 'BLOCKED_NON_RETRYABLE',
    };
  }
  return undefined;
};

export class DiscoveryReentryConsumer {
  private readonly retryBackoffMs: number;
  private readonly freshnessEvaluator: DiscoveryReentryFreshnessEvaluatorPort | undefined;

  public constructor(
    private readonly persistence: DiscoveryReentryPersistencePort,
    private readonly resolver: DiscoveryApprovedResourceRevisionResolverPort,
    private readonly clock: () => Date = () => new Date(),
    options: {
      readonly retryBackoffMs?: number;
      readonly freshnessEvaluator?: DiscoveryReentryFreshnessEvaluatorPort;
    } = {},
  ) {
    this.retryBackoffMs = options.retryBackoffMs ?? DISCOVERY_REENTRY_DEFAULT_RETRY_BACKOFF_MS;
    this.freshnessEvaluator = options.freshnessEvaluator;
    if (
      !Number.isSafeInteger(this.retryBackoffMs) ||
      this.retryBackoffMs < 100 ||
      this.retryBackoffMs > 60_000
    ) {
      throw new TypeError('retryBackoffMs must be between 100ms and 60000ms');
    }
  }

  private async closeStaleFinding(
    finding: DiscoveryFindingEnvelopeV1,
    lifecycle: DiscoveryReentryLifecycleCurrentV1,
    assessment: DiscoveryReentryFreshnessAssessmentV1,
  ): Promise<DiscoveryReentryLifecycleCurrentV1> {
    let current = lifecycle;
    if (
      assessment.state !== 'PERSISTENCE_FAILURE' &&
      assessment.state !== 'FRESH' &&
      this.freshnessEvaluator !== undefined
    ) {
      // The transition is delegated to the existing Finding lifecycle
      // authority. No parallel freshness lifecycle or mutable Finding row is
      // created by WP5.
      if (this.persistence.transitionFindingToStale !== undefined) {
        const transition = await this.persistence.transitionFindingToStale({
          projectId: finding.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          expectedLifecycleRevision: lifecycle.lifecycleRevision,
          canonicalBase: finding.canonicalBase,
          discoveryBase: finding.discoveryBase,
          occurredAt: this.clock().toISOString(),
        });
        current = transition.current;
      }
    }
    return current;
  }

  private async assessFreshness(
    finding: DiscoveryFindingEnvelopeV1,
    stage: DiscoveryReentryFreshnessStageV1,
    assessedAt: string,
  ): Promise<DiscoveryReentryFreshnessAssessmentV1 | undefined> {
    return this.freshnessEvaluator?.assess({
      binding: discoveryReentryFreshnessBindingFromFindingV1(finding),
      stage,
      assessedAt,
    });
  }

  private async retryableResult(
    identity: DiscoveryFindingIdentityV1,
    publication: DiscoveryFindingReadyV1,
    error: unknown,
    previousDisposition: DiscoveryReentryConsumptionDispositionRecordV1 | undefined,
  ): Promise<DiscoveryReentryConsumeResultV1> {
    try {
      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid Date');
      const occurredAt = now.toISOString();
      const previousEligibleAt = previousDisposition?.nextEligibleAt;
      const previousTime =
        previousEligibleAt === undefined
          ? Number.NEGATIVE_INFINITY
          : Date.parse(previousEligibleAt);
      if (!Number.isFinite(previousTime) && previousTime !== Number.NEGATIVE_INFINITY) {
        throw new TypeError('stored retry disposition has an invalid nextEligibleAt');
      }
      const nextEligibleAt = new Date(
        Math.max(now.getTime() + this.retryBackoffMs, previousTime + this.retryBackoffMs),
      ).toISOString();
      const stored = await this.persistence.recordConsumptionDisposition({
        ...identity,
        requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
        publicationId: publication.publicationId,
        disposition: 'RETRYABLE',
        reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
        reasonDetail: textOf(error),
        nextEligibleAt,
        occurredAt,
      });
      if (stored.disposition !== 'RETRYABLE' || stored.nextEligibleAt === undefined) {
        return {
          status: 'PERSISTENCE_FAILURE',
          reason: 'A concurrent terminal disposition superseded the retryable outcome.',
        };
      }
      return {
        status: 'RETRYABLE',
        reason: textOf(error),
        reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
        disposition: 'RETRYABLE',
        nextEligibleAt: stored.nextEligibleAt,
      };
    } catch (retryError) {
      return { status: 'PERSISTENCE_FAILURE', reason: textOf(retryError) };
    }
  }

  public async consume(input: unknown): Promise<DiscoveryReentryConsumeResultV1> {
    let publication: DiscoveryFindingReadyV1;
    try {
      publication = decodeDiscoveryFindingReadyV1(input);
    } catch (error) {
      return { status: 'INVALID_PUBLICATION', reason: textOf(error) };
    }

    const identity = findingIdentity(publication);
    let finding: DiscoveryFindingEnvelopeV1 | undefined;
    try {
      finding = await this.persistence.findFinding(identity);
    } catch (error) {
      if (isRetryableFailure(error)) {
        return this.retryableResult(identity, publication, error, undefined);
      }
      return { status: 'PERSISTENCE_FAILURE', reason: textOf(error) };
    }
    if (!finding) {
      try {
        await this.persistence.recordConsumptionDisposition({
          ...identity,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'BLOCKED_NON_RETRYABLE',
          reasonCode: 'FINDING_NOT_FOUND',
          reasonDetail: 'FindingReady references no durable Finding.',
          occurredAt: this.clock().toISOString(),
        });
      } catch {
        // An unknown project may fail the project FK; retain the original
        // closed result and let the notification remain diagnosable.
      }
      return { status: 'FINDING_NOT_FOUND', ...identity };
    }

    if (
      finding.projectId !== publication.projectId ||
      finding.findingId !== publication.findingId ||
      finding.findingRevision !== publication.findingRevision ||
      finding.runId !== publication.runId ||
      finding.fingerprint !== publication.fingerprint ||
      finding.fingerprintVersion !== publication.fingerprintVersion ||
      !sameCanonicalBase(finding.canonicalBase, publication.canonicalBase) ||
      !publication.requiredDiscoveryBase ||
      !sameDiscoveryBase(finding.discoveryBase, publication.requiredDiscoveryBase)
    ) {
      await this.persistence.recordConsumptionDisposition({
        ...identity,
        requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
        publicationId: publication.publicationId,
        disposition: 'BLOCKED_NON_RETRYABLE',
        reasonCode: 'IDENTITY_MISMATCH',
        reasonDetail:
          'FindingReady does not match the server-owned Finding identity or frozen bases.',
        occurredAt: this.clock().toISOString(),
      });
      return {
        status: 'IDENTITY_MISMATCH',
        reason: 'FindingReady does not match the server-owned Finding identity or frozen bases.',
      };
    }

    const logicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      findingType: finding.findingType,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: finding.canonicalBase,
      requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
    });

    try {
      const existing = await this.persistence.findExisting(logicalIdentity.logicalIdentityKey);
      if (existing) {
        return {
          status: 'IDEMPOTENT',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          manifest: existing.manifest,
          candidate: existing.candidate,
        };
      }

      const lifecycle = await this.persistence.findLifecycle(identity);
      if (!lifecycle) {
        await this.persistence.recordConsumptionDisposition({
          ...identity,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'BLOCKED_NON_RETRYABLE',
          reasonCode: 'FINDING_NOT_FOUND',
          reasonDetail: 'FindingReady references no durable Finding lifecycle.',
          occurredAt: this.clock().toISOString(),
        });
        return { status: 'FINDING_NOT_FOUND', ...identity };
      }
      const storedDisposition = await this.persistence.findConsumptionDisposition(identity);
      if (storedDisposition) {
        const disposition = dispositionResult(storedDisposition, lifecycle);
        if (disposition) return disposition;
      }
      const eligibility = deriveDiscoveryReentryEligibilityV1(lifecycle.lifecycleState);
      if (lifecycle.lifecycleState !== 'NEW' || eligibility !== 'ELIGIBLE_FOR_VALIDATION') {
        await this.persistence.recordConsumptionDisposition({
          projectId: identity.projectId,
          findingId: identity.findingId,
          findingRevision: identity.findingRevision,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'INELIGIBLE',
          reasonCode: 'LIFECYCLE_INELIGIBLE',
          reasonDetail: `Finding lifecycle is ${lifecycle.lifecycleState}.`,
          occurredAt: this.clock().toISOString(),
        });
        return {
          status: 'INELIGIBLE',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          lifecycleState: lifecycle.lifecycleState,
          disposition: 'INELIGIBLE',
        };
      }

      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid Date');
      const createdAt = now.toISOString();
      const freshness = await this.assessFreshness(finding, 'REENTRY_INTAKE', createdAt);
      if (freshness !== undefined && freshness.state !== 'FRESH') {
        if (freshness.state === 'PERSISTENCE_FAILURE') {
          return this.retryableResult(
            identity,
            publication,
            Object.assign(new Error(freshness.reasonDetail), { retryable: true }),
            storedDisposition,
          );
        }
        const closedLifecycle = await this.closeStaleFinding(finding, lifecycle, freshness);
        await this.persistence.recordConsumptionDisposition({
          ...identity,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'INELIGIBLE',
          reasonCode: 'LIFECYCLE_INELIGIBLE',
          reasonDetail: `Freshness ${freshness.state}: ${freshness.reasonCodes.join(', ') || 'authority denied'}.`,
          occurredAt: createdAt,
        });
        return {
          status: 'INELIGIBLE',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          lifecycleState: closedLifecycle.lifecycleState,
          disposition: 'INELIGIBLE',
          freshnessAssessment: freshness,
        };
      }
      const manifest = createDiscoveryReentryManifestV1({
        manifestId: `discovery-reentry-manifest:${logicalIdentity.logicalIdentityKey}`,
        finding,
        requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
        createdAt,
      });
      let resolution: Awaited<ReturnType<DiscoveryApprovedResourceRevisionResolverPort['resolve']>>;
      try {
        resolution = await this.resolver.resolve({
          projectId: finding.projectId,
          finding,
          canonicalBase: finding.canonicalBase,
          discoveryBase: finding.discoveryBase,
          relatedResourceRefs: finding.relatedResourceRefs,
        });
      } catch (error) {
        if (isRetryableFailure(error)) {
          return this.retryableResult(identity, publication, error, storedDisposition);
        }
        throw error;
      }
      if (resolution.status === 'UNRESOLVED') {
        const reasonCode = resolution.reasonCode ?? 'NO_APPROVED_REENTRY_AUTHORITY';
        if (reasonCode === 'RETRYABLE_INFRASTRUCTURE_FAILURE') {
          return this.retryableResult(
            identity,
            publication,
            new Error(resolution.reason),
            storedDisposition,
          );
        }
        await this.persistence.recordConsumptionDisposition({
          projectId: identity.projectId,
          findingId: identity.findingId,
          findingRevision: identity.findingRevision,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'BLOCKED_NON_RETRYABLE',
          reasonCode,
          reasonDetail: resolution.reason,
          occurredAt: createdAt,
        });
        return {
          status: 'UNRESOLVED_REVISION',
          reason: resolution.reason,
          reasonCode,
          disposition: 'BLOCKED_NON_RETRYABLE',
        };
      }

      const candidate = createDerivedKnowledgeCandidateV1({
        candidateId: `discovery-reentry-candidate:${logicalIdentity.logicalIdentityKey}`,
        finding,
        manifest,
        approvedRelatedResourceRefs: resolution.refs,
        createdAt,
      });
      let persisted: DiscoveryReentryPersistenceResultV1;
      try {
        persisted = await this.persistence.persistIntake({
          logicalIdentity,
          finding,
          manifest,
          candidate,
          expectedLifecycleRevision: lifecycle.lifecycleRevision,
          publicationId: publication.publicationId,
          occurredAt: createdAt,
        });
      } catch (error) {
        if (isRetryableFailure(error)) {
          return this.retryableResult(identity, publication, error, storedDisposition);
        }
        throw error;
      }
      if (persisted.status === 'INELIGIBLE') {
        return {
          status: 'INELIGIBLE',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          lifecycleState: persisted.lifecycle.lifecycleState,
          disposition: 'INELIGIBLE',
        };
      }
      if (persisted.status === 'DISPOSITIONED') {
        if (persisted.disposition === 'INELIGIBLE') {
          return {
            status: 'INELIGIBLE',
            logicalIdentityKey: logicalIdentity.logicalIdentityKey,
            lifecycleState: persisted.lifecycle.lifecycleState,
            disposition: 'INELIGIBLE',
          };
        }
        return {
          status: 'UNRESOLVED_REVISION',
          reason: 'Re-entry was durably blocked by a concurrent deterministic disposition.',
          reasonCode: persisted.reasonCode,
          disposition: 'BLOCKED_NON_RETRYABLE',
        };
      }
      return {
        status: persisted.status,
        logicalIdentityKey: persisted.logicalIdentityKey,
        manifest: persisted.manifest,
        candidate: persisted.candidate,
      };
    } catch (error) {
      return { status: 'PERSISTENCE_FAILURE', reason: textOf(error) };
    }
  }

  public async runOnce(limit = 25): Promise<DiscoveryReentryBatchResultV1> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be between 1 and 100');
    }
    const publications = await this.persistence.listPendingFindingReady(limit);
    const results: DiscoveryReentryConsumeResultV1[] = [];
    for (const publication of publications) results.push(await this.consume(publication));
    return { fetched: publications.length, results };
  }

  public async listPendingReviewMaterialization(
    limit: number,
  ): Promise<readonly DiscoveryReentryStoredIntakeV1[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be between 1 and 100');
    }
    return this.persistence.listPendingReviewMaterialization === undefined
      ? []
      : this.persistence.listPendingReviewMaterialization(limit);
  }
}

export type PersistentDiscoveryReentryWorkerOptionsV1 = {
  readonly pollIntervalMs?: number;
  readonly batchLimit?: number;
  readonly reviewMaterializer?: DiscoveryReviewMaterializerPort;
};

export class PersistentDiscoveryReentryWorker {
  private readonly pollIntervalMs: number;
  private readonly batchLimit: number;
  private readonly reviewMaterializer: DiscoveryReviewMaterializerPort | undefined;
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private wakePoll: (() => void) | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly consumer: DiscoveryReentryConsumer,
    options: PersistentDiscoveryReentryWorkerOptionsV1 = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.batchLimit = options.batchLimit ?? 25;
    this.reviewMaterializer = options.reviewMaterializer;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) {
      throw new TypeError('pollIntervalMs must be at least 100ms');
    }
    if (!Number.isSafeInteger(this.batchLimit) || this.batchLimit < 1 || this.batchLimit > 100) {
      throw new TypeError('batchLimit must be between 1 and 100');
    }
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.wakePoll?.();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  public async runOnce(): Promise<DiscoveryReentryBatchResultV1> {
    const batch = await this.consumer.runOnce(this.batchLimit);
    if (this.reviewMaterializer === undefined) return batch;
    const materializedKeys = new Set<string>();
    const materialize = async (logicalIdentityKey: string): Promise<void> => {
      try {
        const result = await this.reviewMaterializer!.materialize({ logicalIdentityKey });
        if (result.status === 'CREATED' || result.status === 'IDEMPOTENT') {
          materializedKeys.add(logicalIdentityKey);
        } else {
          console.error('[discovery-reentry-worker] Review materialization intake not found', {
            logicalIdentityKey,
          });
        }
      } catch (error) {
        // The persisted candidate remains discoverable by the recovery scan;
        // a materialization failure must not turn into a permanently lost item.
        console.error('[discovery-reentry-worker] Review materialization failed', {
          logicalIdentityKey,
          error: textOf(error),
        });
      }
    };
    for (const result of batch.results) {
      if (result.status !== 'CREATED' && result.status !== 'IDEMPOTENT') continue;
      await materialize(result.logicalIdentityKey);
    }
    try {
      const pending = await this.consumer.listPendingReviewMaterialization(this.batchLimit);
      for (const intake of pending) {
        if (!materializedKeys.has(intake.logicalIdentityKey)) {
          await materialize(intake.logicalIdentityKey);
        }
      }
    } catch (error) {
      console.error('[discovery-reentry-worker] Review recovery scan failed', {
        error: textOf(error),
      });
    }
    return batch;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const batch = await this.runOnce();
        for (const result of batch.results) {
          if (
            result.status === 'PERSISTENCE_FAILURE' ||
            result.status === 'INVALID_PUBLICATION' ||
            result.status === 'IDENTITY_MISMATCH'
          ) {
            console.error('[discovery-reentry-worker] item failed closed', result);
          }
        }
      } catch (error) {
        console.error('[discovery-reentry-worker] tick failed', error);
      }
      if (this.running) await this.waitForPoll();
    }
  }

  private async waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (this.pollTimer !== undefined) clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.wakePoll = undefined;
        resolve();
      };
      this.wakePoll = settle;
      this.pollTimer = setTimeout(settle, this.pollIntervalMs);
    });
  }
}

export type DiscoveryReviewResourceWriterPort = {
  save(resource: DiscoveryReviewResourceV1): Promise<'CREATED' | 'IDEMPOTENT'>;
};

export type DiscoveryReviewMaterializerPort = {
  materialize(
    input: DiscoveryReviewMaterializationInputV1,
  ): Promise<DiscoveryReviewMaterializationResultV1>;
};

export type DiscoveryReviewMaterializationInputV1 = {
  /** Lookup-only key. The caller never supplies Finding or Candidate content. */
  readonly logicalIdentityKey: string;
  readonly resourceRevision?: number;
};

export type DiscoveryReviewMaterializationResultV1 =
  | {
      readonly status: 'CREATED' | 'IDEMPOTENT';
      readonly resource: DiscoveryReviewResourceV1;
    }
  | { readonly status: 'NOT_FOUND' }
  | {
      readonly status: 'BLOCKED';
      readonly assessment: DiscoveryReentryFreshnessAssessmentV1;
      readonly resource?: DiscoveryReviewResourceV1;
    };

const reviewMaterializationTargetForFindingType = (
  findingType: DiscoveryFindingEnvelopeV1['findingType'],
): DiscoveryReviewNormalizedMaterialV1['materializationTarget'] => {
  switch (findingType) {
    case 'KNOWLEDGE_GAP':
      return 'KNOWLEDGE_GAP_INVESTIGATION';
    case 'EVIDENCE_GAP':
      return 'EVIDENCE_GAP_INVESTIGATION';
    case 'RELATION_HYPOTHESIS':
      return 'RELATION_CANDIDATE';
    case 'PATTERN_HYPOTHESIS':
      return 'DERIVED_CLAIM_CANDIDATE';
    case 'CONFLICT_HYPOTHESIS':
      return 'CONFLICT_REVIEW';
    case 'CLARIFICATION_QUESTION':
      return 'CLARIFICATION_WORK_ITEM';
    case 'ACTION_SUGGESTION':
      return 'ACTION_CANDIDATE';
  }
};

export const discoveryReviewMaterializationTargetForV1 = reviewMaterializationTargetForFindingType;

const sameReviewJson = (left: unknown, right: unknown): boolean =>
  semanticStableJson(left) === semanticStableJson(right);

const reviewSensitivityRank: Record<DerivedKnowledgeCandidateV1['sensitivity'], number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const reviewSubset = (subset: readonly string[], superset: readonly string[]): boolean =>
  subset.every((entry) => superset.includes(entry));

const assertAuthoritativeFindingCandidatePairV1 = (
  finding: DiscoveryFindingEnvelopeV1,
  candidate: DerivedKnowledgeCandidateV1,
): void => {
  if (candidate.origin !== 'DERIVED_DISCOVERY') {
    throw new TypeError(
      'Only DERIVED_DISCOVERY candidates can be normalized into this Review bridge.',
    );
  }
  if (candidate.reviewEligibility !== 'NOT_ELIGIBLE') {
    throw new TypeError('The persisted derived candidate must remain NOT_ELIGIBLE.');
  }
  if (candidate.reentryEligibility !== 'ELIGIBLE_FOR_VALIDATION') {
    throw new TypeError('The persisted derived candidate is not eligible for derived validation.');
  }
  const exactFields: readonly (keyof DerivedKnowledgeCandidateV1)[] = [
    'projectId',
    'findingId',
    'findingRevision',
    'findingType',
    'sourceProjectionDigest',
    'canonicalBase',
    'discoveryBase',
    'evidenceIds',
    'derivationProvenance',
  ];
  const findingValues: Record<string, unknown> = {
    projectId: finding.projectId,
    findingId: finding.findingId,
    findingRevision: finding.findingRevision,
    findingType: finding.findingType,
    sourceProjectionDigest: finding.sourceProjectionDigest,
    canonicalBase: finding.canonicalBase,
    discoveryBase: finding.discoveryBase,
    evidenceIds: finding.evidenceIds,
    derivationProvenance: finding.provenance,
  };
  for (const field of exactFields) {
    if (!sameReviewJson(candidate[field], findingValues[field])) {
      throw new TypeError(`Persisted candidate ${field} does not match the authoritative Finding.`);
    }
  }
  if (candidate.governanceTarget !== DISCOVERY_REENTRY_TARGET_BY_TYPE[finding.findingType]) {
    throw new TypeError('Persisted candidate governanceTarget does not match findingType.');
  }
  if (!sameReviewJson(candidate.validationProfile, DISCOVERY_DERIVED_VALIDATION_PROFILE_V1)) {
    throw new TypeError('Persisted candidate validationProfile is not the governed profile.');
  }
  if (!reviewSubset(candidate.accessScope, finding.accessScope)) {
    throw new TypeError('Persisted candidate accessScope widens Finding authority.');
  }
  if (reviewSensitivityRank[candidate.sensitivity] < reviewSensitivityRank[finding.sensitivity]) {
    throw new TypeError('Persisted candidate sensitivity weakens Finding protection.');
  }
  validateDiscoveryApprovedResourceRevisionResolutionV1(
    finding.relatedResourceRefs,
    candidate.relatedResourceRefs,
  );
};

const reviewResourceIdentityForRef = (ref: DiscoveryResourceRefV1): string =>
  [ref.resourceKind, ref.resourceId, ref.resourceRevision ?? ''].join(':');

const reviewImpactEntries = (
  finding: DiscoveryFindingEnvelopeV1,
  targetKind: string,
  refs: readonly DiscoveryResourceRefV1[],
  description: string,
): readonly DiscoveryReviewImpactMaterialV1[] => {
  const targets = refs.length === 0 ? [undefined] : refs;
  return targets.map((ref, index) => ({
    schemaVersion: finding.schemaVersion,
    impactId: `discovery-review-impact:${finding.findingId}:${finding.findingRevision}:${index + 1}`,
    targetKind,
    targetId: ref === undefined ? finding.findingId : reviewResourceIdentityForRef(ref),
    description,
  }));
};

const reviewAfterState = (
  findingType: DiscoveryFindingEnvelopeV1['findingType'],
): DiscoveryReviewNormalizedMaterialV1['comparison']['after']['state'] => {
  switch (findingType) {
    case 'KNOWLEDGE_GAP':
    case 'EVIDENCE_GAP':
    case 'CLARIFICATION_QUESTION':
      return 'INVESTIGATION';
    case 'RELATION_HYPOTHESIS':
    case 'PATTERN_HYPOTHESIS':
      return 'PROPOSED';
    case 'CONFLICT_HYPOTHESIS':
      return 'CONFLICTING';
    case 'ACTION_SUGGESTION':
      return 'CANDIDATE_ONLY';
  }
};

const reviewAfterSummary = (
  findingType: DiscoveryFindingEnvelopeV1['findingType'],
  target: DiscoveryReviewNormalizedMaterialV1['materializationTarget'],
): string => {
  switch (findingType) {
    case 'KNOWLEDGE_GAP':
      return `${target} requires investigation; no Fact or affirmative Evidence is established.`;
    case 'EVIDENCE_GAP':
      return `${target} requires additional support; no Evidence, SourceVersion, or Fact is established.`;
    case 'RELATION_HYPOTHESIS':
      return `${target} is a staged relation candidate and does not establish a relation.`;
    case 'PATTERN_HYPOTHESIS':
      return `${target} is a derived Claim proposal and does not establish Canonical truth.`;
    case 'CONFLICT_HYPOTHESIS':
      return `${target} preserves both statements for review without selecting a winner.`;
    case 'CLARIFICATION_QUESTION':
      return `${target} is an investigation work item and is not Canonical content.`;
    case 'ACTION_SUGGESTION':
      return `${target} remains CANDIDATE_ONLY and does not authorize execution.`;
  }
};

const normalizeTypeSpecificMaterial = (
  finding: DiscoveryFindingEnvelopeV1,
): DiscoveryReviewTypeSpecificMaterialV1 => {
  switch (finding.findingType) {
    case 'KNOWLEDGE_GAP': {
      const payload = finding.payload;
      return {
        findingType: 'KNOWLEDGE_GAP',
        question: payload.question,
        whyItMatters: finding.rationale,
        gapKind: payload.gapKind,
        ...(payload.gapKind === 'MISSING_FACT'
          ? { subject: payload.subject, missingFact: payload.missingFact }
          : {}),
        ...(payload.gapKind === 'TEMPORAL_GAP'
          ? { subject: payload.subject, missingTimeDescription: payload.missingTimeDescription }
          : {}),
        ...(payload.gapKind === 'UNDEFINED_TERM'
          ? { term: payload.term, context: payload.context }
          : {}),
        ...(payload.gapKind === 'KNOWN_CONFLICT_QUESTION'
          ? {
              knownConflictRef: payload.knownConflictRef,
              missingResolutionInput: payload.missingResolutionInput,
            }
          : {}),
      };
    }
    case 'EVIDENCE_GAP':
      return {
        findingType: 'EVIDENCE_GAP',
        coverageKind: finding.payload.coverageKind,
        claimText: finding.rationale,
        missingEvidence: finding.payload.requiredEvidence,
        coverageGap: finding.payload.coverageGap,
        affectedResourceRef: finding.payload.affectedResourceRef,
      };
    case 'RELATION_HYPOTHESIS':
      return {
        findingType: 'RELATION_HYPOTHESIS',
        fromResource: finding.payload.sourceEndpoint,
        toResource: finding.payload.targetEndpoint,
        relationType: finding.payload.proposedRelationType,
        direction: finding.payload.direction,
        rationale: finding.rationale,
        ...(finding.payload.temporalQualification === undefined
          ? {}
          : {
              temporalQualification: {
                ...(finding.payload.temporalQualification.validFrom === undefined
                  ? {}
                  : { validFrom: finding.payload.temporalQualification.validFrom }),
                ...(finding.payload.temporalQualification.validTo === undefined
                  ? {}
                  : { validTo: finding.payload.temporalQualification.validTo }),
                description: finding.payload.temporalQualification.description,
              },
            }),
      };
    case 'PATTERN_HYPOTHESIS':
      return {
        findingType: 'PATTERN_HYPOTHESIS',
        claim: finding.payload.patternStatement,
        rationale: finding.rationale,
        supportingLineage: finding.payload.memberResourceRefs,
        patternKind: finding.payload.patternKind,
        patternIdentity: finding.payload.patternIdentity,
      };
    case 'CONFLICT_HYPOTHESIS':
      return {
        findingType: 'CONFLICT_HYPOTHESIS',
        statementA: finding.payload.participatingResourceRefs[0],
        statementB: finding.payload.participatingResourceRefs[1],
        rationale: finding.rationale,
        contradictionKind: finding.payload.contradictionKind,
        possibleContradiction: finding.payload.possibleContradiction,
      };
    case 'CLARIFICATION_QUESTION':
      return {
        findingType: 'CLARIFICATION_QUESTION',
        question: finding.payload.question,
        whyNeeded: finding.rationale,
        context: finding.payload.context,
        proposedNextStep: finding.payload.proposedNextStep,
        lineage: finding.payload.investigationTargetRefs,
      };
    case 'ACTION_SUGGESTION':
      return {
        findingType: 'ACTION_SUGGESTION',
        recommendedAction: finding.payload.suggestedAction,
        rationale: finding.payload.rationale,
        ...(finding.payload.riskContext === undefined
          ? {}
          : { context: finding.payload.riskContext }),
        affectedResourceRefs: finding.payload.affectedResourceRefs,
        executionStatus: 'CANDIDATE_ONLY',
      };
  }
};

const normalizeImpactMaterial = (
  finding: DiscoveryFindingEnvelopeV1,
): readonly DiscoveryReviewImpactMaterialV1[] => {
  switch (finding.findingType) {
    case 'KNOWLEDGE_GAP':
      return reviewImpactEntries(
        finding,
        'AFFECTED_ITEM',
        finding.relatedResourceRefs,
        'Investigation input for a knowledge gap; absence is not an established Fact.',
      );
    case 'EVIDENCE_GAP':
      return reviewImpactEntries(
        finding,
        'AFFECTED_ITEM',
        [finding.payload.affectedResourceRef],
        'Additional evidence is required; the gap does not establish Evidence or a Fact.',
      );
    case 'RELATION_HYPOTHESIS':
      return reviewImpactEntries(
        finding,
        'RELATION',
        [finding.payload.sourceEndpoint, finding.payload.targetEndpoint],
        'Staged relation candidate only; no existing relation is fabricated or changed.',
      );
    case 'PATTERN_HYPOTHESIS':
      return reviewImpactEntries(
        finding,
        'CLAIM',
        finding.payload.memberResourceRefs,
        'Derived Claim proposal only; Canonical truth is not established.',
      );
    case 'CONFLICT_HYPOTHESIS':
      return reviewImpactEntries(
        finding,
        'CONFLICT',
        finding.payload.participatingResourceRefs,
        'Both conflict statements remain independently reviewable; no winner or resolved Fact is selected.',
      );
    case 'CLARIFICATION_QUESTION':
      return reviewImpactEntries(
        finding,
        'AFFECTED_ITEM',
        finding.payload.investigationTargetRefs,
        'Investigation context only; no Canonical, Claim, Fact, or Evidence is created.',
      );
    case 'ACTION_SUGGESTION':
      return reviewImpactEntries(
        finding,
        'AFFECTED_ITEM',
        finding.payload.affectedResourceRefs,
        'Action candidate only; no external execution, queue, ledger, or autonomous runtime is authorized.',
      );
  }
};

export const normalizeDiscoveryFindingToReviewResourceV1 = (input: {
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly candidate: DerivedKnowledgeCandidateV1;
  readonly resourceRevision?: number;
}): DiscoveryReviewResourceV1 => {
  const finding = decodeDiscoveryFindingEnvelopeV1(input.finding, 'authoritativeFinding');
  const candidate = decodeDerivedKnowledgeCandidateV1(
    input.candidate,
    'authoritativeDerivedKnowledgeCandidate',
  );
  assertAuthoritativeFindingCandidatePairV1(finding, candidate);
  const resourceRevision = input.resourceRevision ?? 1;
  if (!Number.isSafeInteger(resourceRevision) || resourceRevision < 1) {
    throw new TypeError('resourceRevision must be a positive integer.');
  }
  const materializationTarget = reviewMaterializationTargetForFindingType(finding.findingType);
  const normalizedMaterial: DiscoveryReviewNormalizedMaterialV1 = {
    schemaVersion: finding.schemaVersion,
    normalizationVersion: 'discovery-review-materialization:v1',
    findingType: finding.findingType,
    materializationTarget,
    comparison: {
      schemaVersion: finding.schemaVersion,
      normalizationVersion: 'discovery-review-materialization:v1',
      before: {
        state: 'NOT_AVAILABLE',
        reason: 'NO_AUTHORITATIVE_PREVIOUS_CANONICAL_VALUE',
      },
      after: {
        state: reviewAfterState(finding.findingType),
        summary: reviewAfterSummary(finding.findingType, materializationTarget),
      },
    },
    impact: normalizeImpactMaterial(finding),
    typeSpecific: normalizeTypeSpecificMaterial(finding),
  };
  const validationResult = {
    schemaVersion: candidate.schemaVersion,
    artifactKind: 'VALIDATION' as const,
    artifactId: `discovery-derived-validation:${candidate.candidateId}:${candidate.candidateRevision}`,
    artifactRevision: '1',
    digest: sha256Text(
      semanticStableJson({
        normalizationVersion: normalizedMaterial.normalizationVersion,
        candidateId: candidate.candidateId,
        candidateRevision: candidate.candidateRevision,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        findingType: finding.findingType,
        sourceProjectionDigest: candidate.sourceProjectionDigest,
        canonicalBase: candidate.canonicalBase,
        discoveryBase: candidate.discoveryBase,
        validationProfile: candidate.validationProfile,
        normalizedMaterial,
      }),
    ),
  };
  const impactSummary = normalizedMaterial.impact.map((entry) => entry.description).join(' ');
  const digestInput: DiscoveryReviewResourceDigestInputV1 = {
    schemaVersion: candidate.schemaVersion,
    origin: candidate.origin,
    projectId: candidate.projectId,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.candidateRevision,
    findingId: candidate.findingId,
    findingRevision: candidate.findingRevision,
    findingType: candidate.findingType,
    manifestId: candidate.manifestId,
    governanceTarget: candidate.governanceTarget,
    sourceProjectionDigest: candidate.sourceProjectionDigest,
    canonicalBase: candidate.canonicalBase,
    discoveryBase: candidate.discoveryBase,
    relatedResourceRefs: candidate.relatedResourceRefs,
    evidenceIds: candidate.evidenceIds,
    derivationProvenance: candidate.derivationProvenance,
    accessScope: candidate.accessScope,
    sensitivity: candidate.sensitivity,
    validationProfile: candidate.validationProfile,
    validationResult,
    reviewResourceId: computeDiscoveryReviewRootIdentityV1({
      projectId: candidate.projectId,
      candidateId: candidate.candidateId,
      candidateRevision: candidate.candidateRevision,
      origin: candidate.origin,
    }),
    resourceRevision,
    effectiveProjectId: candidate.projectId,
    lifecycleState: 'REVIEW_READY',
    reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION',
    content: {
      schemaVersion: candidate.schemaVersion,
      summary: `${materializationTarget} for ${finding.findingId}`,
      detail: semanticStableJson(normalizedMaterial),
      rationale: finding.rationale,
      ...(impactSummary === '' ? {} : { expectedImpact: impactSummary }),
      normalizedMaterial,
    },
    evidenceLineage: candidate.evidenceIds.map((evidenceId) => ({
      schemaVersion: candidate.schemaVersion,
      evidenceId,
    })),
  };
  const resource: DiscoveryReviewResourceV1 = {
    ...digestInput,
    contentDigest: discoveryReviewResourceContentDigestV1(digestInput),
    createdAt: candidate.createdAt,
    updatedAt: candidate.createdAt,
  };
  assertDiscoveryReviewResourceMatchesCandidateV1(resource, candidate);
  return decodeDiscoveryReviewResourceV1(resource, 'normalizedDiscoveryReviewResource');
};

export class DiscoveryReviewMaterializer implements DiscoveryReviewMaterializerPort {
  public constructor(
    private readonly persistence: DiscoveryReentryPersistencePort,
    private readonly writer: DiscoveryReviewResourceWriterPort,
    private readonly freshnessEvaluator?: DiscoveryReentryFreshnessEvaluatorPort,
  ) {}

  private async freshness(
    finding: DiscoveryFindingEnvelopeV1,
    candidate: DerivedKnowledgeCandidateV1,
    stage: DiscoveryReentryFreshnessStageV1,
    assessedAt: string,
  ): Promise<DiscoveryReentryFreshnessAssessmentV1 | undefined> {
    return this.freshnessEvaluator?.assess({
      binding: discoveryReentryFreshnessBindingFromCandidateV1(candidate, finding),
      stage,
      assessedAt,
    });
  }

  private async staleClose(
    finding: DiscoveryFindingEnvelopeV1,
    lifecycle: DiscoveryReentryLifecycleCurrentV1,
    assessment: DiscoveryReentryFreshnessAssessmentV1,
  ): Promise<void> {
    if (this.persistence.transitionFindingToStale === undefined) return;
    await this.persistence.transitionFindingToStale({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: lifecycle.lifecycleRevision,
      canonicalBase: finding.canonicalBase,
      discoveryBase: finding.discoveryBase,
      occurredAt: assessment.assessedAt,
    });
  }

  public async materialize(
    input: DiscoveryReviewMaterializationInputV1,
  ): Promise<DiscoveryReviewMaterializationResultV1> {
    if (input.logicalIdentityKey.trim() === '') {
      throw new TypeError('logicalIdentityKey must not be empty.');
    }
    const stored = await this.persistence.findExisting(input.logicalIdentityKey);
    if (stored === undefined) return { status: 'NOT_FOUND' };
    const finding = await this.persistence.findFinding({
      projectId: stored.manifest.projectId,
      findingId: stored.manifest.findingId,
      findingRevision: stored.manifest.findingRevision,
    });
    if (finding === undefined) {
      throw new TypeError('Authoritative Finding disappeared before Review materialization.');
    }
    if (stored.logicalIdentityKey !== input.logicalIdentityKey) {
      throw new TypeError(
        'Persisted intake logical identity does not match the materialization lookup.',
      );
    }
    assertDiscoveryReentryManifestMatchesFindingV1(stored.manifest, finding);
    assertAuthoritativeFindingCandidatePairV1(finding, stored.candidate);
    const logicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      findingType: finding.findingType,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: finding.canonicalBase,
      requestedReentryPurpose: stored.manifest.requestedReentryPurpose,
    });
    if (logicalIdentity.logicalIdentityKey !== input.logicalIdentityKey) {
      throw new TypeError('Materialization lookup is not the server-derived logical identity.');
    }
    if (
      stored.candidate.manifestId !== stored.manifest.manifestId ||
      stored.candidate.candidateId !==
        `discovery-reentry-candidate:${logicalIdentity.logicalIdentityKey}`
    ) {
      throw new TypeError(
        'Persisted candidate identity is not bound to its authoritative manifest.',
      );
    }
    if (
      stored.lifecycle.projectId !== finding.projectId ||
      stored.lifecycle.findingId !== finding.findingId ||
      stored.lifecycle.findingRevision !== finding.findingRevision
    ) {
      throw new TypeError('Persisted lifecycle identity does not match the authoritative Finding.');
    }
    if (
      stored.lifecycle.lifecycleState !== 'VALIDATING' &&
      stored.lifecycle.lifecycleState !== 'REVIEW_READY'
    ) {
      throw new TypeError(
        `Finding lifecycle ${stored.lifecycle.lifecycleState} is not eligible for Review materialization.`,
      );
    }
    const assessedAt = new Date().toISOString();
    const beforeSave = await this.freshness(
      finding,
      stored.candidate,
      'REVIEW_RESOURCE_MATERIALIZATION',
      assessedAt,
    );
    if (beforeSave !== undefined && beforeSave.state !== 'FRESH') {
      if (beforeSave.state === 'PERSISTENCE_FAILURE') {
        throw Object.assign(new Error(beforeSave.reasonDetail), { retryable: true });
      }
      await this.staleClose(finding, stored.lifecycle, beforeSave);
      return { status: 'BLOCKED', assessment: beforeSave };
    }
    const resource = normalizeDiscoveryFindingToReviewResourceV1({
      finding,
      candidate: stored.candidate,
      resourceRevision: input.resourceRevision,
    });
    const status = await this.writer.save(resource);
    // A save/transition crash gap is intentionally safe: if the authority
    // changed while the immutable resource was being written, do not promote
    // the Finding to REVIEW_READY. The existing Review reader hides it until
    // a fresh, authoritative revision is available.
    const afterSave = await this.freshness(
      finding,
      stored.candidate,
      'REVIEW_RESOURCE_MATERIALIZATION',
      new Date().toISOString(),
    );
    if (afterSave !== undefined && afterSave.state !== 'FRESH') {
      if (afterSave.state === 'PERSISTENCE_FAILURE') {
        throw Object.assign(new Error(afterSave.reasonDetail), { retryable: true });
      }
      await this.staleClose(finding, stored.lifecycle, afterSave);
      return { status: 'BLOCKED', assessment: afterSave, resource };
    }
    if (this.persistence.transitionFindingToReviewReady !== undefined) {
      const transition = await this.persistence.transitionFindingToReviewReady({
        projectId: finding.projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        expectedLifecycleRevision: stored.lifecycle.lifecycleRevision,
        canonicalBase: finding.canonicalBase,
        discoveryBase: finding.discoveryBase,
        occurredAt: finding.createdAt,
      });
      if (transition.status === 'CONFLICT') {
        throw new TypeError(
          'Finding lifecycle changed before Review materialization could become Review-ready.',
        );
      }
    }
    return { status, resource };
  }
}
