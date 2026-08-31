import { describe, expect, it } from 'vitest';

import {
  computeDiscoveryEpistemicReentryIdentityV1,
  createDerivedKnowledgeCandidateV1,
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryEpistemicValidationResultV1,
  createDiscoveryReentryManifestV1,
  decodeDiscoveryEpistemicReentryTriggerV1,
  type DiscoveryFeedbackEventV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingLifecycleState,
  type DiscoveryEpistemicValidationResultV1,
  type DiscoveryReentryFreshnessReasonCodeV1,
} from '../../packages/contracts/src/index.js';
import {
  DiscoveryEpistemicReentryConsumer,
  DiscoveryReviewMaterializer,
  normalizeDiscoveryFindingToReviewResourceV1,
  DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
  type DiscoveryApprovedResourceRevisionResolverPort,
  type DiscoveryDerivedValidationAuthorityPort,
  type DiscoveryReentryLifecycleCurrentV1,
  type DiscoveryReentryPersistencePort,
  type DiscoveryReentryStoredIntakeV1,
  type DiscoveryEpistemicReentryTriggerRecordV1,
  type DiscoveryReviewResourceWriterPort,
} from '../../modules/discovery-reentry/src/index.js';

const projectId = 'akp-7-wp4-contract-project';
const occurredAt = '2026-08-31T00:00:00.000Z';
const relatedResource = {
  schemaVersion: '1.0.0' as const,
  resourceKind: 'CANONICAL_CLAIM' as const,
  resourceId: 'claim-1',
  projectId,
  resourceState: 'CURRENT' as const,
};

const finding = (): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: 'finding-1',
    findingRevision: 2,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'subject-1',
      missingFact: 'missing fact',
      question: 'What is missing?',
    },
    relatedResourceRefs: [relatedResource],
    evidenceIds: ['evidence-1'],
    sourceProjectionDigest: 'sha256:projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 2,
      snapshotDigest: 'sha256:canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-2',
      projectionDigest: 'sha256:discovery',
    },
    runId: 'run-1',
    signalSummary: {},
    rationale: 'rationale',
    derivationSummary: 'derived',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'rule-1',
      ruleVersion: '1',
      inputDigest: 'sha256:input',
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    fingerprint: 'sha256:fingerprint',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: occurredAt,
  });

const feedback = (
  feedbackId: string,
  feedbackKind: DiscoveryFeedbackEventV1['feedbackKind'],
): DiscoveryFeedbackEventV1 => ({
  schemaVersion: '1.0.0',
  feedbackId,
  projectId,
  findingId: 'finding-1',
  findingRevision: 2,
  actor: { type: 'user', id: 'principal-1' },
  principalId: 'principal-1',
  feedbackClass: 'EPISTEMIC',
  feedbackKind: feedbackKind as Extract<DiscoveryFeedbackEventV1['feedbackKind'], string>,
  reason: 'bounded challenge',
  scope: 'FINDING',
  createdAt: occurredAt,
});

class MemoryPersistence implements DiscoveryReentryPersistencePort {
  private readonly feedbackById = new Map<string, DiscoveryFeedbackEventV1>();
  private readonly triggers = new Map<string, DiscoveryEpistemicReentryTriggerRecordV1>();
  private readonly intakes = new Map<string, DiscoveryReentryStoredIntakeV1>();
  private currentLifecycle: DiscoveryReentryLifecycleCurrentV1 = {
    projectId,
    findingId: 'finding-1',
    findingRevision: 2,
    lifecycleState: 'NEW',
    lifecycleRevision: 1,
    updatedAt: occurredAt,
  };

  constructor(
    private readonly returnNewerFinding = false,
    lifecycleState: DiscoveryFindingLifecycleState = 'NEW',
  ) {
    this.currentLifecycle = { ...this.currentLifecycle, lifecycleState };
    for (const kind of [
      'INCORRECT_RELATION',
      'INSUFFICIENT_EVIDENCE',
      'WRONG_ENTITY',
      'TEMPORAL_ERROR',
      'MISLEADING_PATTERN',
      'MISIDENTIFIED_CONFLICT',
    ] as const) {
      const event = feedback(`feedback:${kind}`, kind);
      const trigger = decodeDiscoveryEpistemicReentryTriggerV1({
        schemaVersion: '1.0.0',
        feedbackId: event.feedbackId,
        projectId: event.projectId,
        findingId: event.findingId,
        findingRevision: event.findingRevision,
        feedbackClass: 'EPISTEMIC',
        feedbackKind: event.feedbackKind,
        occurredAt: event.createdAt,
      });
      const identity = computeDiscoveryEpistemicReentryIdentityV1(trigger);
      this.feedbackById.set(event.feedbackId, event);
      this.triggers.set(identity.logicalIdentityKey, {
        ...trigger,
        identity,
        status: 'PENDING',
        attempts: 0,
      });
    }
  }

  async listPendingFindingReady() {
    return [];
  }

  async findFinding(): Promise<DiscoveryFindingEnvelopeV1> {
    return this.returnNewerFinding ? { ...finding(), findingRevision: 3 } : finding();
  }

  async findLifecycle(): Promise<DiscoveryReentryLifecycleCurrentV1> {
    return this.currentLifecycle;
  }

  getCurrentLifecycle(): DiscoveryReentryLifecycleCurrentV1 {
    return this.currentLifecycle;
  }

  async findConsumptionDisposition() {
    return undefined;
  }

  async recordConsumptionDisposition(): Promise<
    Awaited<ReturnType<DiscoveryReentryPersistencePort['recordConsumptionDisposition']>>
  > {
    throw new Error('not used by WP4 contract');
  }

  async findExisting(key: string) {
    return this.intakes.get(key);
  }

  async persistIntake(
    input: Parameters<DiscoveryReentryPersistencePort['persistIntake']>[0],
  ): Promise<Awaited<ReturnType<DiscoveryReentryPersistencePort['persistIntake']>>> {
    const existing = this.intakes.get(input.logicalIdentity.logicalIdentityKey);
    if (existing) return { status: 'IDEMPOTENT', ...existing };
    if (this.currentLifecycle.lifecycleState === 'NEW') {
      this.currentLifecycle = {
        ...this.currentLifecycle,
        lifecycleState: 'VALIDATING',
        lifecycleRevision: 2,
      };
    }
    const stored = {
      logicalIdentityKey: input.logicalIdentity.logicalIdentityKey,
      manifest: input.manifest,
      candidate: input.candidate,
      lifecycle: this.currentLifecycle,
    };
    this.intakes.set(stored.logicalIdentityKey, stored);
    const trigger = [...this.triggers.values()].find(
      (entry) => entry.feedbackId === stored.manifest.epistemicContext?.feedbackId,
    );
    if (trigger) {
      this.triggers.set(trigger.identity.logicalIdentityKey, {
        ...trigger,
        status: 'PROCESSED',
        attempts: trigger.attempts + 1,
        reasonCode: 'SUCCESS',
        reasonDetail: 'processed',
      });
    }
    return { status: 'CREATED', ...stored };
  }

  async transitionFindingToStale(
    input: Parameters<NonNullable<DiscoveryReentryPersistencePort['transitionFindingToStale']>>[0],
  ) {
    if (this.currentLifecycle.lifecycleState === 'STALE') {
      return { status: 'IDEMPOTENT' as const, current: this.currentLifecycle };
    }
    this.currentLifecycle = {
      ...this.currentLifecycle,
      lifecycleState: 'STALE',
      lifecycleRevision: this.currentLifecycle.lifecycleRevision + 1,
      updatedAt: input.occurredAt,
    };
    return { status: 'APPLIED' as const, current: this.currentLifecycle };
  }

  async transitionFindingToReviewReady(
    input: Parameters<
      NonNullable<DiscoveryReentryPersistencePort['transitionFindingToReviewReady']>
    >[0],
  ) {
    this.currentLifecycle = {
      ...this.currentLifecycle,
      lifecycleState: 'REVIEW_READY',
      lifecycleRevision: this.currentLifecycle.lifecycleRevision + 1,
      updatedAt: input.occurredAt,
    };
    return { status: 'APPLIED' as const, current: this.currentLifecycle };
  }

  async findEpistemicFeedback(input: { projectId: string; feedbackId: string }) {
    const event = this.feedbackById.get(input.feedbackId);
    return event?.projectId === input.projectId ? event : undefined;
  }

  async listPendingEpistemicReentryTriggers() {
    return [...this.triggers.values()].filter((trigger) => trigger.status === 'PENDING');
  }

  getEpistemicReentryTriggers() {
    return [...this.triggers.values()];
  }

  async recordEpistemicReentryDisposition(
    input: Parameters<
      NonNullable<DiscoveryReentryPersistencePort['recordEpistemicReentryDisposition']>
    >[0],
  ) {
    const current = this.triggers.get(input.identity.logicalIdentityKey)!;
    const updated = {
      ...current,
      status: input.disposition,
      attempts: current.attempts + 1,
      reasonCode: input.reasonCode,
      reasonDetail: input.reasonDetail,
      ...(input.nextEligibleAt === undefined ? {} : { nextEligibleAt: input.nextEligibleAt }),
    };
    this.triggers.set(input.identity.logicalIdentityKey, updated);
    return updated;
  }
}

const resolver: DiscoveryApprovedResourceRevisionResolverPort = {
  resolve: async () => ({
    status: 'RESOLVED',
    refs: [{ ...relatedResource, resourceState: 'APPROVED', resourceRevision: 'revision-2' }],
  }),
};

const validationAuthorityFor = (
  outcomeOrError: DiscoveryEpistemicValidationResultV1['outcome'] | Error,
): DiscoveryDerivedValidationAuthorityPort => ({
  validateEpistemicCorrection: async ({ identity, finding, context }) => {
    if (outcomeOrError instanceof Error) throw outcomeOrError;
    return createDiscoveryEpistemicValidationResultV1({
      logicalIdentityKey: identity.logicalIdentityKey,
      feedbackId: context.feedbackId,
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      feedbackKind: context.feedbackKind,
      outcome: outcomeOrError,
      evaluatedAt: occurredAt,
    });
  },
});

const freshnessEvaluatorFor = (
  state: 'FRESH' | 'REVALIDATION_REQUIRED' | 'INVALIDATED',
  reasonCodes: readonly DiscoveryReentryFreshnessReasonCodeV1[] = [],
) => ({
  assess: async () => ({
    schemaVersion: '1.0.0' as const,
    assessmentVersion: 'discovery-reentry-freshness:v1' as const,
    assessmentId: `assessment:${state}`,
    assessedAt: occurredAt,
    projectId,
    findingId: 'finding-1',
    findingRevision: 2,
    state,
    reasonCodes,
    reasonDetail: `freshness ${state}`,
  }),
});

describe('AKP-7 WP4 EPISTEMIC feedback re-entry contract', () => {
  it('routes all six kinds through one exact, idempotent correction identity', async () => {
    const persistence = new MemoryPersistence();
    const consumer = new DiscoveryEpistemicReentryConsumer(
      persistence,
      resolver,
      () => new Date(occurredAt),
    );
    const batch = await consumer.runOnce(100);

    expect(batch.fetched).toBe(6);
    expect(batch.results).toHaveLength(6);
    expect(batch.results.every((result) => result.status === 'CREATED')).toBe(true);
    expect(
      persistence.getEpistemicReentryTriggers().every((trigger) => !('reason' in trigger)),
    ).toBe(true);
    expect(
      batch.results.map((result) =>
        result.status === 'CREATED' ? result.manifest.epistemicContext?.validationFocus : '',
      ),
    ).toEqual(
      expect.arrayContaining([
        'RELATION_CORRECTNESS',
        'EVIDENCE_SUFFICIENCY',
        'ENTITY_IDENTITY',
        'TEMPORAL_VALIDITY',
        'PATTERN_VALIDITY',
        'CONFLICT_CLASSIFICATION',
      ]),
    );

    const replay = await consumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(replay.status).toBe('IDEMPOTENT');
    expect(
      computeDiscoveryEpistemicReentryIdentityV1({
        projectId,
        feedbackId: 'feedback:INCORRECT_RELATION',
        findingId: 'finding-1',
        findingRevision: 2,
      }).logicalIdentityKey,
    ).not.toBe(
      computeDiscoveryEpistemicReentryIdentityV1({
        projectId,
        feedbackId: 'feedback:INCORRECT_RELATION',
        findingId: 'finding-1',
        findingRevision: 3,
      }).logicalIdentityKey,
    );
  });

  it.each(['REVIEW_READY', 'REENTERED', 'DISMISSED', 'SUPPRESSED'] as const)(
    'keeps %s lifecycle state while retaining the epistemic correction intake',
    async (lifecycleState) => {
      const persistence = new MemoryPersistence(false, lifecycleState);
      const consumer = new DiscoveryEpistemicReentryConsumer(
        persistence,
        resolver,
        () => new Date(occurredAt),
      );
      const result = await consumer.consume({
        schemaVersion: '1.0.0',
        feedbackId: 'feedback:INCORRECT_RELATION',
        projectId,
        findingId: 'finding-1',
        findingRevision: 2,
        feedbackClass: 'EPISTEMIC',
        feedbackKind: 'INCORRECT_RELATION',
        occurredAt,
      });

      expect(result.status).toBe('CREATED');
      if (result.status !== 'CREATED') return;
      expect(result.candidate.evidenceIds).toEqual(['evidence-1']);
      expect(result.candidate.epistemicContext?.reasonKind).toBe('NON_EVIDENCE_USER_CHALLENGE');
      expect(persistence.getCurrentLifecycle().lifecycleState).toBe(lifecycleState);
    },
  );

  it.each(['RESOLVED', 'STALE', 'SUPERSEDED'] as const)(
    'records %s as an explicit ineligible disposition without reopening it',
    async (lifecycleState) => {
      const persistence = new MemoryPersistence(false, lifecycleState);
      const consumer = new DiscoveryEpistemicReentryConsumer(
        persistence,
        resolver,
        () => new Date(occurredAt),
      );
      const result = await consumer.consume({
        schemaVersion: '1.0.0',
        feedbackId: 'feedback:INCORRECT_RELATION',
        projectId,
        findingId: 'finding-1',
        findingRevision: 2,
        feedbackClass: 'EPISTEMIC',
        feedbackKind: 'INCORRECT_RELATION',
        occurredAt,
      });

      expect(result).toMatchObject({ status: 'INELIGIBLE', disposition: 'INELIGIBLE' });
      expect(persistence.getCurrentLifecycle().lifecycleState).toBe(lifecycleState);
    },
  );

  it('fails closed for an exact revision mismatch and never retargets a newer Finding', async () => {
    const persistence = new MemoryPersistence(true);
    const consumer = new DiscoveryEpistemicReentryConsumer(
      persistence,
      resolver,
      () => new Date(occurredAt),
    );
    const result = await consumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(result.status).toBe('IDENTITY_MISMATCH');
  });

  it.each(['SUPPORTED', 'NOT_SUPPORTED', 'INSUFFICIENTLY_RESOLVABLE'] as const)(
    'gates correction Review materialization on the explicit %s outcome',
    async (outcome) => {
      const persistence = new MemoryPersistence();
      const consumer = new DiscoveryEpistemicReentryConsumer(
        persistence,
        resolver,
        () => new Date(occurredAt),
        { validationAuthority: validationAuthorityFor(outcome) },
      );
      const result = await consumer.consume({
        schemaVersion: '1.0.0',
        feedbackId: 'feedback:INCORRECT_RELATION',
        projectId,
        findingId: 'finding-1',
        findingRevision: 2,
        feedbackClass: 'EPISTEMIC',
        feedbackKind: 'INCORRECT_RELATION',
        occurredAt,
      });
      expect(result.status).toBe('CREATED');
      if (result.status !== 'CREATED') return;
      expect(result.candidate.epistemicValidationResult?.outcome).toBe(outcome);

      const saved: string[] = [];
      const materializer = new DiscoveryReviewMaterializer(persistence, {
        save: async (resource) => {
          saved.push(resource.reviewResourceId);
          return 'CREATED';
        },
      });
      const materialized = await materializer.materialize({
        logicalIdentityKey: result.logicalIdentityKey,
      });
      if (outcome === 'SUPPORTED') {
        expect(materialized.status).toBe('CREATED');
        expect(saved).toHaveLength(1);
        expect(persistence.getCurrentLifecycle().lifecycleState).toBe('REVIEW_READY');
      } else {
        expect(materialized).toMatchObject({ status: 'BLOCKED_VALIDATION', outcome });
        expect(saved).toHaveLength(0);
        expect(persistence.getCurrentLifecycle().lifecycleState).toBe('VALIDATING');
      }
    },
  );

  it.each(['REVIEW_READY', 'REENTERED', 'DISMISSED', 'SUPPRESSED'] as const)(
    'creates a distinct correction Review resource from %s without changing the original lifecycle',
    async (lifecycleState) => {
      const persistence = new MemoryPersistence(false, lifecycleState);
      const consumer = new DiscoveryEpistemicReentryConsumer(
        persistence,
        resolver,
        () => new Date(occurredAt),
        { validationAuthority: validationAuthorityFor('SUPPORTED') },
      );
      const result = await consumer.consume({
        schemaVersion: '1.0.0',
        feedbackId: 'feedback:INCORRECT_RELATION',
        projectId,
        findingId: 'finding-1',
        findingRevision: 2,
        feedbackClass: 'EPISTEMIC',
        feedbackKind: 'INCORRECT_RELATION',
        occurredAt,
      });
      expect(result.status).toBe('CREATED');
      if (result.status !== 'CREATED') return;
      const written: DiscoveryReviewResourceWriterPort['save'] extends (
        resource: infer R,
      ) => Promise<unknown>
        ? R[]
        : never = [];
      const materializer = new DiscoveryReviewMaterializer(persistence, {
        save: async (resource) => {
          written.push(resource);
          return 'CREATED';
        },
      });
      const materialized = await materializer.materialize({
        logicalIdentityKey: result.logicalIdentityKey,
      });
      expect(materialized.status).toBe('CREATED');
      expect(written).toHaveLength(1);
      expect(written[0]?.validationResult.epistemicValidationResult?.outcome).toBe('SUPPORTED');
      expect(persistence.getCurrentLifecycle().lifecycleState).toBe(lifecycleState);
    },
  );

  it('does not overwrite an earlier Review root when a correction becomes Review-eligible', async () => {
    const value = finding();
    const normalManifest = createDiscoveryReentryManifestV1({
      manifestId: 'normal-manifest',
      finding: value,
      requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
      createdAt: occurredAt,
    });
    const previous = normalizeDiscoveryFindingToReviewResourceV1({
      finding: value,
      candidate: createDerivedKnowledgeCandidateV1({
        candidateId: 'previous-normal-candidate',
        finding: value,
        manifest: normalManifest,
        approvedRelatedResourceRefs: [
          { ...relatedResource, resourceState: 'APPROVED', resourceRevision: 'revision-2' },
        ],
        createdAt: occurredAt,
      }),
    });
    const persistence = new MemoryPersistence(false, 'REENTERED');
    const consumer = new DiscoveryEpistemicReentryConsumer(
      persistence,
      resolver,
      () => new Date(occurredAt),
      { validationAuthority: validationAuthorityFor('SUPPORTED') },
    );
    const result = await consumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(result.status).toBe('CREATED');
    if (result.status !== 'CREATED') return;
    const previousKey = `${previous.reviewResourceId}:${previous.resourceRevision}`;
    const resources = new Map([[previousKey, previous]]);
    const materializer = new DiscoveryReviewMaterializer(persistence, {
      save: async (resource) => {
        const key = `${resource.reviewResourceId}:${resource.resourceRevision}`;
        if (resources.has(key)) return 'IDEMPOTENT';
        resources.set(key, resource);
        return 'CREATED';
      },
    });
    const materialized = await materializer.materialize({
      logicalIdentityKey: result.logicalIdentityKey,
    });
    expect(materialized.status).toBe('CREATED');
    expect(resources.get(previousKey)).toBe(previous);
    expect(resources.size).toBe(2);
    expect(result.candidate.epistemicValidationResult?.digest).toBeDefined();
    expect(
      (materialized as { resource: { reviewResourceId: string } }).resource.reviewResourceId,
    ).not.toBe(previous.reviewResourceId);
  });

  it('reuses the authoritative freshness/stale path and keeps security invalidation fail-closed', async () => {
    const stalePersistence = new MemoryPersistence();
    const staleConsumer = new DiscoveryEpistemicReentryConsumer(
      stalePersistence,
      resolver,
      () => new Date(occurredAt),
      {
        freshnessEvaluator: freshnessEvaluatorFor('REVALIDATION_REQUIRED', [
          'RELATED_RESOURCE_CHANGED',
        ]),
      },
    );
    const staleResult = await staleConsumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(staleResult).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'STALE' });

    const securityPersistence = new MemoryPersistence();
    const securityConsumer = new DiscoveryEpistemicReentryConsumer(
      securityPersistence,
      resolver,
      () => new Date(occurredAt),
      {
        freshnessEvaluator: freshnessEvaluatorFor('REVALIDATION_REQUIRED', [
          'ACCESS_NO_LONGER_AUTHORIZED',
        ]),
      },
    );
    const securityResult = await securityConsumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(securityResult).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'NEW' });
    expect(securityPersistence.getCurrentLifecycle().lifecycleState).toBe('NEW');
  });

  it('closes deterministic post-trigger failures and retains retryable failures for backoff', async () => {
    const deterministicPersistence = new MemoryPersistence();
    const deterministicConsumer = new DiscoveryEpistemicReentryConsumer(
      deterministicPersistence,
      resolver,
      () => new Date(occurredAt),
      {
        validationAuthority: validationAuthorityFor(
          new Error('invalid challenge authority result'),
        ),
      },
    );
    const deterministicResult = await deterministicConsumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(deterministicResult).toMatchObject({
      status: 'BLOCKED_NON_RETRYABLE',
      disposition: 'BLOCKED_NON_RETRYABLE',
    });
    expect(deterministicPersistence.getEpistemicReentryTriggers()[0]?.status).toBe(
      'BLOCKED_NON_RETRYABLE',
    );
    expect((await deterministicConsumer.runOnce(100)).fetched).toBe(5);

    const retryPersistence = new MemoryPersistence();
    const retryableError = Object.assign(new Error('temporary authority outage'), {
      retryable: true,
    });
    const retryConsumer = new DiscoveryEpistemicReentryConsumer(
      retryPersistence,
      resolver,
      () => new Date(occurredAt),
      { validationAuthority: validationAuthorityFor(retryableError) },
    );
    const retryResult = await retryConsumer.consume({
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:INCORRECT_RELATION',
      projectId,
      findingId: 'finding-1',
      findingRevision: 2,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INCORRECT_RELATION',
      occurredAt,
    });
    expect(retryResult).toMatchObject({ status: 'RETRYABLE', disposition: 'RETRYABLE' });
    expect(retryPersistence.getEpistemicReentryTriggers()[0]).toMatchObject({
      status: 'RETRYABLE',
      nextEligibleAt: expect.any(String),
    });
  });
});
