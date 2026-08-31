import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  FrontendContractError,
  ShotgunError,
  type EvidenceSpan,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingPayloadV1,
  type DiscoveryProductCapabilitiesV1,
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
  type DiscoveryResourceKind,
  type DiscoveryResourceRefV1,
  type ListDiscoveryFindingsRequestV1,
  type ListDiscoveryFindingsResultV1,
  type ReadDiscoveryFindingRequestV1,
  type ReadDiscoveryFindingResultV1,
  decodeDiscoveryProductFindingDetailV1,
  decodeDiscoveryProductFindingSummaryV1,
  FRONTEND_DISCOVERY_SCHEMA_VERSION,
} from '../../../packages/contracts/src/index.js';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';

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

export type DiscoveryProductGraphReadiness = {
  canReadGraph(projectId: string): Promise<boolean>;
};

export type DiscoveryProductPageCursorV1 = {
  readonly findingId: string;
  readonly findingRevision: number;
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
const CURSOR_VERSION = 'frontend-discovery-cursor:v2';
const CURSOR_PREFIX = 'fdc2';
const CURSOR_IV_BYTES = 12;
const CURSOR_TAG_BYTES = 16;

export type DiscoveryProductCursorCodec = {
  encode(input: {
    readonly projectId: string;
    readonly cursor: DiscoveryProductPageCursorV1;
  }): string;
  decode(value: string): {
    readonly projectId: string;
    readonly cursor: DiscoveryProductPageCursorV1;
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

/** AES-GCM makes the keyset continuation opaque and tamper-evident. The
 * plaintext Finding identity remains server-owned and is never sent to the
 * browser in reversible JSON/base64 form. */
export const createEncryptedDiscoveryProductCursorCodec = (
  secret: string,
): DiscoveryProductCursorCodec => {
  if (secret.trim().length < 16) throw new Error('Discovery cursor secret is too short.');
  const key = cursorKey(secret);
  return {
    encode({ projectId, cursor }) {
      if (!projectId.trim() || !validCursorIdentity(cursor)) {
        throw new Error('Discovery cursor identity is invalid.');
      }
      const iv = randomBytes(CURSOR_IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(CURSOR_VERSION, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(
          JSON.stringify({
            projectId,
            findingId: cursor.findingId,
            findingRevision: cursor.findingRevision,
          }),
          'utf8',
        ),
        cipher.final(),
      ]);
      return [
        CURSOR_PREFIX,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
      ].join('.');
    },
    decode(value) {
      try {
        if (value.length > 1024) throw new Error('cursor is too long');
        const [prefix, ivText, ciphertextText, tagText] = value.split('.');
        if (prefix !== CURSOR_PREFIX || !ivText || !ciphertextText || !tagText) {
          throw new Error('cursor envelope is invalid');
        }
        const iv = Buffer.from(ivText, 'base64url');
        const ciphertext = Buffer.from(ciphertextText, 'base64url');
        const tag = Buffer.from(tagText, 'base64url');
        if (iv.length !== CURSOR_IV_BYTES || tag.length !== CURSOR_TAG_BYTES) {
          throw new Error('cursor envelope lengths are invalid');
        }
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from(CURSOR_VERSION, 'utf8'));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('cursor payload is invalid');
        }
        const object = parsed as Record<string, unknown>;
        if (
          Object.keys(object).some(
            (key) => !['projectId', 'findingId', 'findingRevision'].includes(key),
          ) ||
          typeof object.projectId !== 'string' ||
          !object.projectId.trim() ||
          !validCursorIdentity({
            findingId: object.findingId,
            findingRevision: object.findingRevision,
          })
        ) {
          throw new Error('cursor payload is invalid');
        }
        return {
          projectId: object.projectId,
          cursor: {
            findingId: object.findingId as string,
            findingRevision: object.findingRevision as number,
          },
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

export class FrontendDiscoveryProductReadCoordinator {
  private readonly cursorCodec: DiscoveryProductCursorCodec;
  private readonly graphReadiness?: DiscoveryProductGraphReadiness;

  constructor(
    private readonly source: DiscoveryProductReadSource,
    options: {
      readonly cursorCodec?: DiscoveryProductCursorCodec;
      readonly graphReadiness?: DiscoveryProductGraphReadiness;
    } = {},
  ) {
    this.cursorCodec = options.cursorCodec ?? defaultCursorCodec();
    this.graphReadiness = options.graphReadiness;
  }

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
    const canReadGraph =
      eligibleForGraph &&
      (this.graphReadiness === undefined ||
        (await this.graphReadiness.canReadGraph(finding.projectId)));
    const capabilities: DiscoveryProductCapabilitiesV1 = {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      canOpenReview: context.reviewBinding !== undefined,
      canInspectEvidence: context.evidence.length > 0,
      canOpenGraph: canReadGraph,
      // WP1 has no server-authoritative Activity or Investigation navigation
      // identity. A persisted runId is not sufficient capability evidence.
      canOpenActivity: false,
      canInvestigate: false,
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

  async listFindings(
    scope: DiscoveryProductReadInput & { readonly request: ListDiscoveryFindingsRequestV1 },
  ): Promise<ListDiscoveryFindingsResultV1> {
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
}
