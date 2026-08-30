import { describe, expect, it } from 'vitest';

import {
  computeDiscoveryReentryLogicalIdentityV1,
  createDerivedKnowledgeCandidateV1,
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryReentryManifestV1,
  decodeDiscoveryReviewResourceV1,
  discoveryReviewResourceContentDigestV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingReadyV1,
  type DiscoveryReentryFreshnessAssessmentV1,
} from '../../packages/contracts/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReviewMaterializer,
  DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
  discoveryReentryFreshnessBindingFromFindingV1,
  discoveryReentryFreshnessBindingFromReviewResourceV1,
  normalizeDiscoveryFindingToReviewResourceV1,
  type DiscoveryReentryFreshnessEvaluatorPort,
  type DiscoveryReentryLifecycleCurrentV1,
  type DiscoveryReentryPersistencePort,
  type DiscoveryReentryStoredIntakeV1,
  type DiscoveryReviewResourceWriterPort,
} from '../../modules/discovery-reentry/src/index.js';
import {
  DiscoveryCandidateReviewTargetAdapter,
  InMemoryFrontendReviewStore,
  createInMemoryReviewDiscoveryCandidateReader,
  type ReviewDiscoveryCandidateDerivedSourceV1,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import {
  FrontendReviewProductCoordinator,
  type FrontendReviewScopeV1,
} from '../../modules/frontend-review/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';

const projectId = 'akp-5-wp5-integration-project';
const now = '2026-08-31T00:00:00.000Z';

const finding = (): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: 'finding-wp5-1',
    findingRevision: 1,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'subject-wp5',
      missingFact: 'missing fact',
      question: 'Which fact is authoritative?',
    },
    relatedResourceRefs: [],
    evidenceIds: [],
    sourceProjectionDigest: 'sha256:wp5-source',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 7,
      snapshotDigest: 'sha256:wp5-canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp5-7',
      projectionDigest: 'sha256:wp5-discovery',
    },
    runId: 'run-wp5-1',
    signalSummary: {},
    rationale: 'The derived signal needs governed review.',
    derivationSummary: 'WP5 stale provenance fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp5-rule',
      ruleVersion: '1',
      inputDigest: 'sha256:wp5-input',
    },
    accessScope: ['review'],
    sensitivity: 'internal',
    fingerprint: 'sha256:wp5-fingerprint',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });

const publication = (value: DiscoveryFindingEnvelopeV1): DiscoveryFindingReadyV1 => ({
  schemaVersion: '1.0.0',
  publicationId: 'publication-wp5-1',
  projectId: value.projectId,
  findingId: value.findingId,
  findingRevision: value.findingRevision,
  fingerprint: value.fingerprint,
  fingerprintVersion: value.fingerprintVersion,
  jobId: 'job-wp5-1',
  runId: value.runId,
  attemptId: 'attempt-wp5-1',
  canonicalBase: value.canonicalBase,
  requiredDiscoveryBase: value.discoveryBase,
  occurredAt: now,
});

const staleAssessment = (
  value: DiscoveryFindingEnvelopeV1,
  state: DiscoveryReentryFreshnessAssessmentV1['state'] = 'INVALIDATED',
  reasonCodes: DiscoveryReentryFreshnessAssessmentV1['reasonCodes'] = ['RELATED_RESOURCE_CHANGED'],
): DiscoveryReentryFreshnessAssessmentV1 => ({
  schemaVersion: '1.0.0',
  assessmentVersion: 'discovery-reentry-freshness:v1',
  assessmentId: `assessment:${state}`,
  assessedAt: now,
  projectId: value.projectId,
  findingId: value.findingId,
  findingRevision: value.findingRevision,
  state,
  reasonCodes,
  reasonDetail: 'The relied-on server authority changed.',
});

class MemoryReentryPersistence implements DiscoveryReentryPersistencePort {
  public stored: DiscoveryReentryStoredIntakeV1 | undefined;
  public persisted = 0;
  public savedReviewReady = 0;
  public lifecycle: DiscoveryReentryLifecycleCurrentV1 = {
    projectId,
    findingId: 'finding-wp5-1',
    findingRevision: 1,
    lifecycleState: 'NEW' as const,
    lifecycleRevision: 1,
    updatedAt: now,
  };

  public constructor(private readonly authoritativeFinding: DiscoveryFindingEnvelopeV1) {}

  public async listPendingFindingReady(): Promise<readonly DiscoveryFindingReadyV1[]> {
    return this.stored === undefined ? [publication(this.authoritativeFinding)] : [];
  }

  public async findFinding(): Promise<DiscoveryFindingEnvelopeV1> {
    return this.authoritativeFinding;
  }

  public async findLifecycle() {
    return this.lifecycle;
  }

  public async findConsumptionDisposition() {
    return undefined;
  }

  public async recordConsumptionDisposition(
    input: Parameters<DiscoveryReentryPersistencePort['recordConsumptionDisposition']>[0],
  ) {
    return {
      ...input,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    };
  }

  public async findExisting(): Promise<DiscoveryReentryStoredIntakeV1 | undefined> {
    return this.stored;
  }

  public async persistIntake(
    input: Parameters<DiscoveryReentryPersistencePort['persistIntake']>[0],
  ) {
    this.persisted += 1;
    this.lifecycle = {
      ...this.lifecycle,
      lifecycleState: 'VALIDATING',
      lifecycleRevision: 2,
      updatedAt: input.occurredAt,
    };
    this.stored = {
      logicalIdentityKey: input.logicalIdentity.logicalIdentityKey,
      manifest: input.manifest,
      candidate: input.candidate,
      lifecycle: this.lifecycle,
    };
    return { status: 'CREATED' as const, ...this.stored };
  }

  public async transitionFindingToStale(
    input: Parameters<NonNullable<DiscoveryReentryPersistencePort['transitionFindingToStale']>>[0],
  ) {
    if (this.lifecycle.lifecycleState === 'STALE') {
      return { status: 'IDEMPOTENT' as const, current: this.lifecycle };
    }
    this.lifecycle = {
      ...this.lifecycle,
      lifecycleState: 'STALE',
      lifecycleRevision: this.lifecycle.lifecycleRevision + 1,
      updatedAt: input.occurredAt,
    };
    return { status: 'APPLIED' as const, current: this.lifecycle };
  }

  public async transitionFindingToReviewReady(
    input: Parameters<
      NonNullable<DiscoveryReentryPersistencePort['transitionFindingToReviewReady']>
    >[0],
  ) {
    this.savedReviewReady += 1;
    this.lifecycle = {
      ...this.lifecycle,
      lifecycleState: 'REVIEW_READY',
      lifecycleRevision: this.lifecycle.lifecycleRevision + 1,
      updatedAt: input.occurredAt,
    };
    return { status: 'APPLIED' as const, current: this.lifecycle };
  }
}

const intakeFor = (value: DiscoveryFindingEnvelopeV1): DiscoveryReentryStoredIntakeV1 => {
  const manifest = createDiscoveryReentryManifestV1({
    manifestId: 'manifest-wp5-1',
    finding: value,
    requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
    createdAt: now,
  });
  const logicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
    projectId: value.projectId,
    findingId: value.findingId,
    findingRevision: value.findingRevision,
    findingType: value.findingType,
    sourceProjectionDigest: value.sourceProjectionDigest,
    canonicalBase: value.canonicalBase,
    requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
  });
  const candidate = createDerivedKnowledgeCandidateV1({
    candidateId: `discovery-reentry-candidate:${logicalIdentity.logicalIdentityKey}`,
    finding: value,
    manifest,
    approvedRelatedResourceRefs: [],
    createdAt: now,
  });
  return {
    logicalIdentityKey: logicalIdentity.logicalIdentityKey,
    manifest,
    candidate,
    lifecycle: {
      projectId,
      findingId: value.findingId,
      findingRevision: value.findingRevision,
      lifecycleState: 'VALIDATING',
      lifecycleRevision: 2,
      updatedAt: now,
    },
  };
};

const evaluatorFor = (
  assessments: readonly DiscoveryReentryFreshnessAssessmentV1[],
): DiscoveryReentryFreshnessEvaluatorPort => {
  let index = 0;
  return {
    assess: async () => assessments[Math.min(index++, assessments.length - 1)]!,
  };
};

describe('AKP-5 WP5 stale provenance and security closure', () => {
  it('Guard A resolves frozen authority before closing stale intake or persisting a candidate', async () => {
    const value = finding();
    const persistence = new MemoryReentryPersistence(value);
    let resolverCalls = 0;
    const consumer = new DiscoveryReentryConsumer(
      persistence,
      {
        resolve: async () => {
          resolverCalls += 1;
          return { status: 'RESOLVED' as const, refs: [] };
        },
      },
      () => new Date(now),
      { freshnessEvaluator: evaluatorFor([staleAssessment(value)]) },
    );

    const result = await consumer.consume(publication(value));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'STALE',
      freshnessAssessment: { state: 'INVALIDATED' },
    });
    expect(resolverCalls).toBe(1);
    expect(persistence.persisted).toBe(0);
  });

  it('Guard B does not save a Review resource when pre-save authority is stale', async () => {
    const value = finding();
    const persistence = new MemoryReentryPersistence(value);
    persistence.stored = intakeFor(value);
    let writes = 0;
    const writer: DiscoveryReviewResourceWriterPort = {
      save: async () => {
        writes += 1;
        return 'CREATED';
      },
    };
    const materializer = new DiscoveryReviewMaterializer(
      persistence,
      writer,
      evaluatorFor([staleAssessment(value)]),
    );

    const result = await materializer.materialize({
      logicalIdentityKey: persistence.stored.logicalIdentityKey,
    });

    expect(result).toMatchObject({ status: 'BLOCKED', assessment: { state: 'INVALIDATED' } });
    expect(writes).toBe(0);
    expect(persistence.savedReviewReady).toBe(0);
    expect(persistence.lifecycle.lifecycleState).toBe('STALE');
  });

  it('Guard B keeps an immutable crash-gap resource hidden when authority changes after save', async () => {
    const value = finding();
    const persistence = new MemoryReentryPersistence(value);
    persistence.stored = intakeFor(value);
    let writes = 0;
    const writer: DiscoveryReviewResourceWriterPort = {
      save: async () => {
        writes += 1;
        return 'CREATED';
      },
    };
    const materializer = new DiscoveryReviewMaterializer(
      persistence,
      writer,
      evaluatorFor([staleAssessment(value, 'FRESH', []), staleAssessment(value)]),
    );

    const result = await materializer.materialize({
      logicalIdentityKey: persistence.stored.logicalIdentityKey,
    });

    expect(result.status).toBe('BLOCKED');
    expect((result as { resource?: unknown }).resource).toBeDefined();
    expect(writes).toBe(1);
    expect(persistence.savedReviewReady).toBe(0);
    expect(persistence.lifecycle.lifecycleState).toBe('STALE');
  });

  it('Guard C rejects a previously fresh Discovery Review context when authority changes at decision time', async () => {
    const value = finding();
    const resource = normalizeDiscoveryFindingToReviewResourceV1({
      finding: value,
      candidate: intakeFor(value).candidate,
    });
    const source: ReviewDiscoveryCandidateDerivedSourceV1 = {
      origin: 'DERIVED_DISCOVERY',
      reviewResourceId: resource.reviewResourceId,
      resourceRevision: resource.resourceRevision,
      candidateId: resource.candidateId,
      candidateRevision: resource.candidateRevision,
      resourceProjectId: resource.projectId,
      effectiveProjectId: resource.effectiveProjectId,
      content: resource.content,
      evidence: resource.evidenceLineage,
      impact: resource.content.normalizedMaterial?.impact ?? [],
      lineage: resource,
      contentDigest: resource.contentDigest,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    };
    const adapter = new DiscoveryCandidateReviewTargetAdapter(
      createInMemoryReviewDiscoveryCandidateReader([source]),
      evaluatorFor([
        staleAssessment(value, 'FRESH', []),
        staleAssessment(value, 'FRESH', []),
        staleAssessment(value),
      ]),
    );
    const scope: FrontendReviewScopeV1 = {
      principalId: 'principal-wp5',
      sessionId: 'session-wp5',
      activeProjectId: projectId,
      accessRevision: 'access-wp5',
      policyContextRevision: 'policy-wp5',
      sensitivityClearance: 'ALL',
      accessScope: ['review'],
    };
    const coordinator = new FrontendReviewProductCoordinator(
      new InMemoryFrontendReviewStore(),
      new InMemoryFrontendCommandGateway(),
      [adapter],
      () => new Date(now),
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 10,
    });
    expect(queue.items).toHaveLength(1);
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });

    await expect(
      coordinator.recordReviewDecisions(scope, {
        schemaVersion: '1.0.0',
        clientRequestId: 'wp5-decision-request',
        idempotencyKey: 'wp5-decision-idempotency',
        reviewContextId: context.context.reviewContextId,
        expectedContextRevision: context.context.contextRevision,
        expectedTargetRevision: context.context.targetRevision,
        expectedTargetDigest: context.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: context.context.items[0]!.reviewItemId,
            intent: 'APPROVE',
            reason: 'The old context must be revalidated.',
          },
        ],
      }),
    ).rejects.toMatchObject({ apiCode: 'REVIEW_TARGET_CHANGED' });
  });

  it('keeps the binding server-derived and does not use a global Canonical version', () => {
    const bound = discoveryReentryFreshnessBindingFromFindingV1(finding());
    expect(bound.canonicalBase.canonicalVersion).toBe(7);
    expect(bound.approvedRelatedResourceRefs).toEqual([]);
    expect(bound).not.toHaveProperty('currentCanonicalVersion');
  });

  it('never invents CURRENT as an approved frozen revision', () => {
    const rawFinding = createDiscoveryFindingEnvelopeV1({
      ...finding(),
      relatedResourceRefs: [
        {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_CLAIM',
          resourceId: 'claim-current-only',
          projectId,
          resourceState: 'CURRENT',
        },
      ],
    });
    expect(() => discoveryReentryFreshnessBindingFromFindingV1(rawFinding)).toThrow(/frozen base/);
  });

  it('preserves full Evidence lineage when a Review resource becomes a freshness binding', () => {
    const value = createDiscoveryFindingEnvelopeV1({
      ...finding(),
      evidenceIds: ['evidence-lineage-1'],
    });
    const normalized = normalizeDiscoveryFindingToReviewResourceV1({
      finding: value,
      candidate: intakeFor(value).candidate,
    });
    const evidenceLineage = [
      {
        schemaVersion: '1.0.0' as const,
        evidenceId: 'evidence-lineage-1',
        sourceId: 'source-lineage-1',
        sourceVersionId: 'source-version-lineage-1',
        evidenceSpanId: 'span-lineage-1',
      },
    ];
    const { contentDigest, createdAt, updatedAt, ...digestInput } = normalized;
    void contentDigest;
    const resource = decodeDiscoveryReviewResourceV1(
      {
        ...digestInput,
        evidenceLineage,
        contentDigest: discoveryReviewResourceContentDigestV1({
          ...digestInput,
          evidenceLineage,
        }),
        createdAt,
        updatedAt,
      },
      'lineageReviewResource',
    );
    expect(discoveryReentryFreshnessBindingFromReviewResourceV1(resource).evidenceLineage).toEqual(
      evidenceLineage,
    );
  });
});
