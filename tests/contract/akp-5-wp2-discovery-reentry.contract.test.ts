import { describe, expect, it } from 'vitest';

import {
  DiscoveryReentryConsumer,
  DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
  type DiscoveryApprovedResourceRevisionResolverPort,
  type DiscoveryReentryLifecycleCurrentV1,
  type DiscoveryReentryPersistencePort,
  type DiscoveryReentryStoredIntakeV1,
  type DiscoveryReentryConsumptionDispositionRecordV1,
} from '../../modules/discovery-reentry/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingReadyV1,
} from '../../packages/contracts/src/index.js';

const now = '2026-08-30T02:00:00.000Z';
const projectId = 'akp-5-wp2-contract-project';
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
    findingRevision: 1,
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
    createdAt: now,
  });

const publication = (): DiscoveryFindingReadyV1 => ({
  schemaVersion: '1.0.0',
  publicationId: 'publication-1',
  projectId,
  findingId: 'finding-1',
  findingRevision: 1,
  fingerprint: 'sha256:fingerprint',
  fingerprintVersion: 'discovery-fingerprint:v1',
  jobId: 'job-1',
  runId: 'run-1',
  attemptId: 'attempt-1',
  canonicalBase: finding().canonicalBase,
  requiredDiscoveryBase: finding().discoveryBase,
  occurredAt: now,
});

class MemoryPersistence implements DiscoveryReentryPersistencePort {
  public stored: DiscoveryReentryStoredIntakeV1 | undefined;
  public disposition: DiscoveryReentryConsumptionDispositionRecordV1 | undefined;
  public lifecycle: DiscoveryReentryLifecycleCurrentV1 = {
    projectId,
    findingId: 'finding-1',
    findingRevision: 1,
    lifecycleState: 'NEW',
    lifecycleRevision: 1,
    updatedAt: now,
  };

  public async listPendingFindingReady(): Promise<readonly DiscoveryFindingReadyV1[]> {
    return this.stored ? [] : [publication()];
  }

  public async findFinding(): Promise<DiscoveryFindingEnvelopeV1> {
    return finding();
  }

  public async findLifecycle(): Promise<DiscoveryReentryLifecycleCurrentV1> {
    return this.lifecycle;
  }

  public async findExisting(): Promise<DiscoveryReentryStoredIntakeV1 | undefined> {
    return this.stored;
  }

  public async findConsumptionDisposition(): Promise<
    DiscoveryReentryConsumptionDispositionRecordV1 | undefined
  > {
    return this.disposition;
  }

  public async recordConsumptionDisposition(
    input: Parameters<DiscoveryReentryPersistencePort['recordConsumptionDisposition']>[0],
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1> {
    if (!this.disposition) {
      this.disposition = {
        projectId: input.projectId,
        findingId: input.findingId,
        findingRevision: input.findingRevision,
        requestedReentryPurpose: input.requestedReentryPurpose,
        publicationId: input.publicationId,
        disposition: input.disposition,
        reasonCode: input.reasonCode,
        reasonDetail: input.reasonDetail,
        ...(input.nextEligibleAt === undefined ? {} : { nextEligibleAt: input.nextEligibleAt }),
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };
    } else if (this.disposition.disposition === 'RETRYABLE' && input.disposition === 'RETRYABLE') {
      this.disposition = {
        ...this.disposition,
        publicationId: input.publicationId,
        reasonCode: input.reasonCode,
        reasonDetail: input.reasonDetail,
        nextEligibleAt: input.nextEligibleAt!,
        updatedAt: input.occurredAt,
      };
    }
    return this.disposition;
  }

  public async persistIntake(
    input: Parameters<DiscoveryReentryPersistencePort['persistIntake']>[0],
  ) {
    if (this.stored) return { status: 'IDEMPOTENT' as const, ...this.stored };
    this.lifecycle = {
      ...this.lifecycle,
      lifecycleState: 'VALIDATING',
      lifecycleRevision: 2,
    };
    this.stored = {
      logicalIdentityKey: input.logicalIdentity.logicalIdentityKey,
      manifest: input.manifest,
      candidate: input.candidate,
      lifecycle: this.lifecycle,
    };
    if (this.disposition?.disposition === 'RETRYABLE') {
      this.disposition = {
        ...this.disposition,
        disposition: 'PROCESSED',
        reasonCode: 'SUCCESS',
        reasonDetail: 'FindingReady was processed into durable re-entry intake.',
        nextEligibleAt: undefined,
        updatedAt: input.occurredAt,
      };
    }
    return { status: 'CREATED' as const, ...this.stored };
  }
}

const resolver = (
  result: Awaited<ReturnType<DiscoveryApprovedResourceRevisionResolverPort['resolve']>>,
): DiscoveryApprovedResourceRevisionResolverPort => ({
  resolve: async () => result,
});

describe('AKP-5 WP2 durable re-entry consumer contract', () => {
  it('uses the server-owned purpose, deterministic ids and idempotent replay', async () => {
    const persistence = new MemoryPersistence();
    const consumer = new DiscoveryReentryConsumer(
      persistence,
      resolver({
        status: 'RESOLVED',
        refs: [
          {
            ...relatedResource,
            resourceState: 'APPROVED',
            resourceRevision: 'revision-2',
          },
        ],
      }),
      () => new Date(now),
    );

    const first = await consumer.consume(publication());
    expect(first.status).toBe('CREATED');
    if (first.status !== 'CREATED') return;
    expect(first.manifest.requestedReentryPurpose).toBe(
      DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
    );
    expect(first.manifest.manifestId).toBe(
      first.candidate.candidateId.replace('candidate', 'manifest'),
    );
    expect(first.candidate.relatedResourceRefs[0]).toMatchObject({
      resourceState: 'APPROVED',
      resourceRevision: 'revision-2',
    });
    expect(first.candidate.reviewEligibility).toBe('NOT_ELIGIBLE');
    expect(first.candidate.origin).toBe('DERIVED_DISCOVERY');
    expect('sourceVersionId' in first.candidate).toBe(false);

    const replay = await consumer.consume(publication());
    expect(replay.status).toBe('IDEMPOTENT');
    expect(await consumer.runOnce()).toEqual({ fetched: 0, results: [] });
  });

  it('rejects protected publication authority fields that do not match the durable Finding', async () => {
    const persistence = new MemoryPersistence();
    const consumer = new DiscoveryReentryConsumer(
      persistence,
      resolver({ status: 'RESOLVED', refs: [] }),
      () => new Date(now),
    );
    const tampered = { ...publication(), projectId: 'other-project' };

    await expect(consumer.consume(tampered)).resolves.toMatchObject({
      status: 'IDENTITY_MISMATCH',
    });
    expect(persistence.stored).toBeUndefined();
    expect(persistence.lifecycle.lifecycleState).toBe('NEW');
  });

  it('fails closed when approved revision resolution is unavailable', async () => {
    const persistence = new MemoryPersistence();
    const consumer = new DiscoveryReentryConsumer(
      persistence,
      resolver({ status: 'UNRESOLVED', reason: 'revision is not authoritative' }),
      () => new Date(now),
    );

    await expect(consumer.consume(publication())).resolves.toEqual({
      status: 'UNRESOLVED_REVISION',
      reason: 'revision is not authoritative',
      reasonCode: 'NO_APPROVED_REENTRY_AUTHORITY',
      disposition: 'BLOCKED_NON_RETRYABLE',
    });
    expect(persistence.stored).toBeUndefined();
    expect(persistence.lifecycle.lifecycleState).toBe('NEW');
  });

  it('records retryable failures with advancing durable eligibility and closes on success', async () => {
    const persistence = new MemoryPersistence();
    let attempts = 0;
    const retryingResolver: DiscoveryApprovedResourceRevisionResolverPort = {
      resolve: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('temporary authority outage'), { retryable: true });
        }
        return {
          status: 'RESOLVED',
          refs: [{ ...relatedResource, resourceState: 'APPROVED', resourceRevision: 'revision-2' }],
        };
      },
    };
    const consumer = new DiscoveryReentryConsumer(
      persistence,
      retryingResolver,
      () => new Date(now),
      { retryBackoffMs: 1_000 },
    );

    const first = await consumer.consume(publication());
    expect(first).toMatchObject({
      status: 'RETRYABLE',
      reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
      disposition: 'RETRYABLE',
    });
    const firstNext = persistence.disposition?.nextEligibleAt;
    expect(firstNext).toBe('2026-08-30T02:00:01.000Z');

    const second = await consumer.consume(publication());
    expect(second).toMatchObject({ status: 'RETRYABLE', disposition: 'RETRYABLE' });
    expect(persistence.disposition?.nextEligibleAt).toBe('2026-08-30T02:00:02.000Z');
    expect(Date.parse(persistence.disposition!.nextEligibleAt!) > Date.parse(firstNext!)).toBe(
      true,
    );

    const success = await consumer.consume(publication());
    expect(success.status).toBe('CREATED');
    expect(persistence.disposition?.disposition).toBe('PROCESSED');
  });

  it('does not reopen terminal or review lifecycle states', async () => {
    for (const lifecycleState of [
      'STALE',
      'SUPERSEDED',
      'RESOLVED',
      'DISMISSED',
      'SUPPRESSED',
      'REENTERED',
      'REVIEW_READY',
    ] as const) {
      const persistence = new MemoryPersistence();
      persistence.lifecycle = { ...persistence.lifecycle, lifecycleState };
      const consumer = new DiscoveryReentryConsumer(
        persistence,
        resolver({ status: 'RESOLVED', refs: [] }),
        () => new Date(now),
      );
      await expect(consumer.consume(publication())).resolves.toMatchObject({
        status: 'INELIGIBLE',
        lifecycleState,
      });
      expect(persistence.stored).toBeUndefined();
    }
  });
});
