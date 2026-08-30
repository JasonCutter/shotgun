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
  findEvidence(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined>;
};

export type DiscoveryProductPageCursorV1 = {
  readonly findingId: string;
  readonly findingRevision: number;
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
const CURSOR_VERSION = 'frontend-discovery-cursor:v1';

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

const payloadRefs = (
  payload: DiscoveryFindingPayloadV1,
): readonly { readonly projectId: string }[] => {
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
      providerId: provenance.providerId,
      modelId: provenance.modelId,
      modelVersion: provenance.modelVersion,
      promptVersion: provenance.promptVersion,
      outputSchemaVersion: provenance.outputSchemaVersion,
    };
  }
  return {
    schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
    kind: provenance.kind,
    ruleId: provenance.deterministic.ruleId,
    ruleVersion: provenance.deterministic.ruleVersion,
    inputDigest: provenance.deterministic.inputDigest,
    providerId: provenance.aiExecution.providerId,
    modelId: provenance.aiExecution.modelId,
    modelVersion: provenance.aiExecution.modelVersion,
    promptVersion: provenance.aiExecution.promptVersion,
    outputSchemaVersion: provenance.aiExecution.outputSchemaVersion,
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

const encodeCursor = (cursor: DiscoveryProductPageCursorV1): string =>
  Buffer.from(
    JSON.stringify({
      version: CURSOR_VERSION,
      findingId: cursor.findingId,
      findingRevision: cursor.findingRevision,
    }),
    'utf8',
  ).toString('base64url');

export const decodeDiscoveryProductCursor = (
  value: string | undefined,
): DiscoveryProductPageCursorV1 | undefined => {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('cursor must be an object');
    const object = parsed as Record<string, unknown>;
    if (
      Object.keys(object).some((key) => !['version', 'findingId', 'findingRevision'].includes(key))
    )
      throw new Error('cursor contains unsupported fields');
    if (
      object.version !== CURSOR_VERSION ||
      typeof object.findingId !== 'string' ||
      object.findingId.trim().length === 0 ||
      typeof object.findingRevision !== 'number' ||
      !Number.isSafeInteger(object.findingRevision) ||
      object.findingRevision <= 0
    )
      throw new Error('cursor identity is invalid');
    return { findingId: object.findingId, findingRevision: object.findingRevision };
  } catch {
    throw new FrontendContractError('INVALID_REQUEST', 'Discovery cursor is invalid.');
  }
};

const isVisibleTo = (
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
  // EvidenceSpan.revisionId is the persisted source-map/evidence revision
  // identity; no synthetic SourceVersion or Evidence ID is fabricated here.
  evidenceSpanId: span.revisionId,
  sourceId: span.sourceId,
  sourceVersionId: span.sourceVersionId,
});

export class FrontendDiscoveryProductReadCoordinator {
  constructor(private readonly source: DiscoveryProductReadSource) {}

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
    if (!isVisibleTo(finding, scope)) return notFound();
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
    const capabilities: DiscoveryProductCapabilitiesV1 = {
      schemaVersion: FRONTEND_DISCOVERY_SCHEMA_VERSION,
      canOpenReview: context.reviewBinding !== undefined,
      canInspectEvidence: context.evidence.length > 0,
      canOpenGraph: relatedResourceRefs.length > 0,
      canOpenActivity: finding.runId.trim().length > 0,
      canInvestigate:
        context.reviewBinding !== undefined ||
        relatedResourceRefs.length > 0 ||
        context.evidence.length > 0 ||
        finding.runId.trim().length > 0,
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
    const after = decodeDiscoveryProductCursor(scope.request.cursor);
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
        ? encodeCursor({
            findingId: consumed.at(-1)!.findingId,
            findingRevision: consumed.at(-1)!.findingRevision,
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
