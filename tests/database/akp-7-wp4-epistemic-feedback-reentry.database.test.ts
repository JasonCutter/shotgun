import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../adapters/discovery-reentry-postgres/src/index.js';
import {
  createPostgresReviewDiscoveryCandidateReader,
  PostgresDiscoveryReviewResourceRepository,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  computeDiscoveryEpistemicReentryIdentityV1,
  createDiscoveryEpistemicValidationResultV1,
  createDiscoveryFindingEnvelopeV1,
  decodeDiscoveryEpistemicReentryTriggerV1,
  type DiscoveryFeedbackEventV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import {
  DiscoveryEpistemicReentryConsumer,
  DiscoveryReviewMaterializer,
  type DiscoveryDerivedValidationAuthorityPort,
} from '../../modules/discovery-reentry/src/index.js';
import type { DiscoveryFindingLifecycleRepositoryPort } from '../../modules/discovery-finding-lifecycle/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectA = `akp-7-wp4-a-${randomUUID()}`;
const projectB = `akp-7-wp4-b-${randomUUID()}`;
const projectC = `akp-7-wp4-c-${randomUUID()}`;
const projectD = `akp-7-wp4-d-${randomUUID()}`;
const projectE = `akp-7-wp4-e-${randomUUID()}`;
const projectIds = [projectA, projectB, projectC, projectD, projectE];

const finding = (
  projectId: string,
  findingId: string,
  findingRevision = 2,
): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'AKP-7 WP4',
      missingFact: 'epistemic feedback re-entry',
      question: 'Which exact Finding revision is challenged?',
    },
    relatedResourceRefs: [],
    evidenceIds: ['evidence-akp-7-wp4'],
    sourceProjectionDigest: 'sha256:akp-7-wp4-source-projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:akp-7-wp4-canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: `discovery-projection-${findingRevision}`,
      projectionDigest: `sha256:akp-7-wp4-discovery-${findingRevision}`,
    },
    runId: 'run-akp-7-wp4',
    signalSummary: { novelty: 0.4 },
    rationale: 'This fixture is a derived Finding for the WP4 persistence gate.',
    derivationSummary: 'The fixture contains no private feedback reason.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'akp-7-wp4-test',
      ruleVersion: '1',
      inputDigest: 'sha256:akp-7-wp4-input',
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    fingerprint: `sha256:akp-7-wp4-${projectId}-${findingId}-${findingRevision}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: `2026-08-31T0${findingRevision}:00:00.000Z`,
  });

const epistemicFeedback = (
  projectId: string,
  findingId: string,
  feedbackId: string,
): DiscoveryFeedbackEventV1 => ({
  schemaVersion: '1.0.0',
  feedbackId,
  projectId,
  findingId,
  findingRevision: 2,
  actor: { type: 'user', id: 'principal-akp-7-wp4' },
  principalId: 'principal-akp-7-wp4',
  feedbackClass: 'EPISTEMIC',
  feedbackKind: 'WRONG_ENTITY',
  reason: 'The Finding is bound to the wrong entity.',
  scope: 'FINDING',
  createdAt: '2026-08-31T03:00:00.000Z',
});

const utilityFeedback = (
  projectId: string,
  findingId: string,
  feedbackId: string,
): DiscoveryFeedbackEventV1 => ({
  ...epistemicFeedback(projectId, findingId, feedbackId),
  feedbackClass: 'UTILITY',
  feedbackKind: 'USEFUL',
  reason: 'The Finding is useful.',
});

const triggerFor = (event: DiscoveryFeedbackEventV1) =>
  decodeDiscoveryEpistemicReentryTriggerV1({
    schemaVersion: '1.0.0',
    feedbackId: event.feedbackId,
    projectId: event.projectId,
    findingId: event.findingId,
    findingRevision: event.findingRevision,
    feedbackClass: 'EPISTEMIC',
    feedbackKind: event.feedbackKind,
    occurredAt: event.createdAt,
  });

describe.runIf(databaseUrl)('AKP-7 WP4 EPISTEMIC feedback re-entry PostgreSQL authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-7 WP4 A', 'ACTIVE', true),
              ($2, 'AKP-7 WP4 B', 'ACTIVE', true),
              ($3, 'AKP-7 WP4 C', 'ACTIVE', true),
              ($4, 'AKP-7 WP4 D', 'ACTIVE', true),
              ($5, 'AKP-7 WP4 E', 'ACTIVE', true)`,
      projectIds,
    );
    const findings = new PostgresDiscoveryFindingRepository(pool!);
    expect(await findings.save(finding(projectA, 'finding-a'))).toBe('CREATED');
    expect(await findings.save(finding(projectB, 'finding-b'))).toBe('CREATED');
    expect(await findings.save(finding(projectC, 'finding-c'))).toBe('CREATED');
    expect(await findings.save(finding(projectD, 'finding-d'))).toBe('CREATED');
    expect(await findings.save(finding(projectE, 'finding-e'))).toBe('CREATED');
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      // Test cleanup may bypass append-only triggers; production code has no
      // deletion path for these durable records.
      await client.query('SET session_replication_role = replica');
      await client.query(
        'DELETE FROM discovery.reentry_review_resources WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.reentry_review_roots WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.reentry_consumption WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.reentry_candidates WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.reentry_manifests WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.epistemic_reentry_triggers WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.feedback_events WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.finding_lifecycle_history WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.finding_lifecycle_current WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM discovery.findings WHERE project_id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
      await client.query(
        'DELETE FROM project_admin.projects WHERE id IN ($1, $2, $3, $4, $5)',
        projectIds,
      );
    } finally {
      await client.query('SET session_replication_role = origin');
      client.release();
      await pool.end();
    }
  });

  it('atomically stores a trigger, reconciles historical feedback, and preserves exact revision/project identity', async () => {
    const feedbackRepository = new PostgresDiscoveryFeedbackRepository(pool!);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!);
    const findings = new PostgresDiscoveryFindingRepository(pool!);
    const eventA = epistemicFeedback(projectA, 'finding-a', 'feedback-shared');
    const triggerA = triggerFor(eventA);

    await feedbackRepository.transaction(async ({ repository }) => {
      expect(await repository.appendFeedback(eventA)).toBe('CREATED');
      if (repository.appendEpistemicReentryTrigger === undefined) {
        throw new Error('EPISTEMIC trigger writer is required by this database test.');
      }
      expect(await repository.appendEpistemicReentryTrigger(triggerA)).toBe('CREATED');
    });
    expect(
      await reentryRepository.findEpistemicFeedback({
        projectId: projectA,
        feedbackId: eventA.feedbackId,
      }),
    ).toEqual(eventA);
    expect(await feedbackRepository.appendEpistemicReentryTrigger(triggerA)).toBe('CONFLICT');

    const eventB = epistemicFeedback(projectB, 'finding-b', 'feedback-shared');
    expect(await feedbackRepository.appendFeedback(eventB)).toBe('CREATED');
    expect(
      await feedbackRepository.appendFeedback(
        utilityFeedback(projectA, 'finding-a', 'feedback-utility'),
      ),
    ).toBe('CREATED');
    expect(await reentryRepository.reconcileEpistemicFeedback(25)).toBe(1);
    expect(await reentryRepository.reconcileEpistemicFeedback(25)).toBe(0);

    const pending = await reentryRepository.listPendingEpistemicReentryTriggers(25);
    expect(pending).toHaveLength(2);
    expect(pending.map((entry) => [entry.projectId, entry.feedbackId])).toEqual(
      expect.arrayContaining([
        [projectA, eventA.feedbackId],
        [projectB, eventB.feedbackId],
      ]),
    );
    expect(pending.find((entry) => entry.projectId === projectB)).toMatchObject({
      projectId: projectB,
      findingId: 'finding-b',
      findingRevision: 2,
      feedbackKind: 'WRONG_ENTITY',
      status: 'PENDING',
    });

    expect(await findings.save(finding(projectB, 'finding-b', 3))).toBe('CREATED');
    expect(
      (
        await reentryRepository.findFinding({
          projectId: projectB,
          findingId: 'finding-b',
          findingRevision: 2,
        })
      )?.findingRevision,
    ).toBe(2);
    expect(
      (
        await reentryRepository.findFinding({
          projectId: projectB,
          findingId: 'finding-b',
          findingRevision: 3,
        })
      )?.findingRevision,
    ).toBe(3);

    const identityB = computeDiscoveryEpistemicReentryIdentityV1(triggerFor(eventB));
    const dispositioned = await reentryRepository.recordEpistemicReentryDisposition({
      identity: identityB,
      disposition: 'BLOCKED_NON_RETRYABLE',
      reasonCode: 'IDENTITY_MISMATCH',
      reasonDetail: 'The test records an explicit governed terminal disposition.',
      occurredAt: '2026-08-31T04:00:00.000Z',
    });
    expect(dispositioned).toMatchObject({
      projectId: projectB,
      feedbackId: eventB.feedbackId,
      findingRevision: 2,
      status: 'BLOCKED_NON_RETRYABLE',
      reasonCode: 'IDENTITY_MISMATCH',
    });
    expect(
      (await reentryRepository.listPendingEpistemicReentryTriggers(25)).map(
        (entry) => entry.projectId,
      ),
    ).toEqual([projectA]);
  });

  it('hides a saved supported correction during VALIDATING, then exposes it after authorized closure', async () => {
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const feedbackRepository = new PostgresDiscoveryFeedbackRepository(pool!);
    const event = epistemicFeedback(projectA, 'finding-a', 'feedback-correction-crash-gap');
    const trigger = triggerFor(event);
    await feedbackRepository.transaction(async ({ repository }) => {
      expect(await repository.appendFeedback(event)).toBe('CREATED');
      if (repository.appendEpistemicReentryTrigger === undefined) {
        throw new Error('EPISTEMIC trigger writer is required by this database test.');
      }
      expect(await repository.appendEpistemicReentryTrigger(trigger)).toBe('CREATED');
    });

    const resolver = { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) };
    const validationAuthority: DiscoveryDerivedValidationAuthorityPort = {
      validateEpistemicCorrection: async ({ identity, finding, context }) =>
        createDiscoveryEpistemicValidationResultV1({
          logicalIdentityKey: identity.logicalIdentityKey,
          feedbackId: context.feedbackId,
          projectId: finding.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          feedbackKind: context.feedbackKind,
          outcome: 'SUPPORTED',
          evaluatedAt: finding.createdAt,
        }),
    };
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumed = await new DiscoveryEpistemicReentryConsumer(
      reentryRepository,
      resolver,
      () => new Date('2026-08-31T05:00:00.000Z'),
      { validationAuthority },
    ).consume(trigger);
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;

    const reader = createPostgresReviewDiscoveryCandidateReader(pool!);
    expect(
      await findingRepository.findLifecycle({
        projectId: projectA,
        findingId: 'finding-a',
        findingRevision: 2,
      }),
    ).toMatchObject({ lifecycleState: 'VALIDATING' });
    await expect(reader.list(projectA)).resolves.toHaveLength(0);

    const failingLifecycleRepository: DiscoveryFindingLifecycleRepositoryPort = {
      findLifecycle: (identity) => findingRepository.findLifecycle(identity),
      listLifecycleHistory: (identity) => findingRepository.listLifecycleHistory(identity),
      transitionLifecycle: async () => {
        throw new Error('simulated crash after supported correction Review save');
      },
    };
    await expect(
      new DiscoveryReviewMaterializer(
        new PostgresDiscoveryReentryRepository(pool!, {
          lifecycleRepository: failingLifecycleRepository,
        }),
        new PostgresDiscoveryReviewResourceRepository(pool!),
      ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey }),
    ).rejects.toThrow('simulated crash after supported correction Review save');

    const persisted = await pool!.query<{ review_resource_id: string }>(
      `SELECT review_resource_id
       FROM discovery.reentry_review_resources
       WHERE project_id = $1
       ORDER BY resource_revision DESC
       LIMIT 1`,
      [projectA],
    );
    const reviewResourceId = persisted.rows[0]?.review_resource_id;
    expect(reviewResourceId).toBeDefined();
    await expect(reader.list(projectA)).resolves.toHaveLength(0);

    const identity = {
      projectId: projectA,
      findingId: 'finding-a',
      findingRevision: 2,
    };
    const current = await findingRepository.findLifecycle(identity);
    expect(current?.lifecycleState).toBe('VALIDATING');
    expect(
      await findingRepository.transitionLifecycle({
        ...identity,
        expectedLifecycleRevision: current!.lifecycleRevision,
        targetState: 'REVIEW_READY',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'REVIEW_READY',
        occurredAt: '2026-08-31T05:01:00.000Z',
        context: {
          canonicalBase: finding(projectA, 'finding-a').canonicalBase,
          discoveryBase: finding(projectA, 'finding-a').discoveryBase,
        },
      }),
    ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleState: 'REVIEW_READY' } });
    await expect(reader.list(projectA)).resolves.toEqual([
      expect.objectContaining({
        origin: 'DERIVED_DISCOVERY',
        reviewResourceId,
        lineage: expect.objectContaining({ reviewResourceId }),
      }),
    ]);

    const materializeAndCheckClosedState = async (input: {
      projectId: string;
      findingId: string;
      feedbackId: string;
      targetState: 'REENTERED' | 'DISMISSED' | 'SUPPRESSED';
    }) => {
      const stateFindingRepository = new PostgresDiscoveryFindingRepository(pool!);
      const stateFeedback = epistemicFeedback(input.projectId, input.findingId, input.feedbackId);
      const stateTrigger = triggerFor(stateFeedback);
      await feedbackRepository.transaction(async ({ repository }) => {
        expect(await repository.appendFeedback(stateFeedback)).toBe('CREATED');
        if (repository.appendEpistemicReentryTrigger === undefined) {
          throw new Error('EPISTEMIC trigger writer is required by this database test.');
        }
        expect(await repository.appendEpistemicReentryTrigger(stateTrigger)).toBe('CREATED');
      });
      const stateConsumed = await new DiscoveryEpistemicReentryConsumer(
        new PostgresDiscoveryReentryRepository(pool!, {
          lifecycleRepository: stateFindingRepository,
        }),
        resolver,
        () => new Date('2026-08-31T05:10:00.000Z'),
        { validationAuthority },
      ).consume(stateTrigger);
      expect(stateConsumed.status).toBe('CREATED');
      if (stateConsumed.status !== 'CREATED') throw new Error('Expected correction intake.');
      const stateMaterialized = await new DiscoveryReviewMaterializer(
        new PostgresDiscoveryReentryRepository(pool!, {
          lifecycleRepository: stateFindingRepository,
        }),
        new PostgresDiscoveryReviewResourceRepository(pool!),
      ).materialize({ logicalIdentityKey: stateConsumed.logicalIdentityKey });
      expect(stateMaterialized.status).toBe('CREATED');
      if (stateMaterialized.status !== 'CREATED') throw new Error('Expected Review resource.');
      const stateIdentity = {
        projectId: input.projectId,
        findingId: input.findingId,
        findingRevision: 2,
      };
      const stateLifecycle = await stateFindingRepository.findLifecycle(stateIdentity);
      expect(
        await stateFindingRepository.transitionLifecycle({
          ...stateIdentity,
          expectedLifecycleRevision: stateLifecycle!.lifecycleRevision,
          targetState: input.targetState,
          cause: 'GOVERNED_WORKFLOW',
          reasonCode: input.targetState,
          occurredAt: '2026-08-31T05:11:00.000Z',
        }),
      ).toMatchObject({
        status: 'APPLIED',
        lifecycle: { lifecycleState: input.targetState },
      });
      await expect(
        createPostgresReviewDiscoveryCandidateReader(pool!).list(input.projectId),
      ).resolves.toEqual([
        expect.objectContaining({
          origin: 'DERIVED_DISCOVERY',
          reviewResourceId: stateMaterialized.resource.reviewResourceId,
        }),
      ]);
    };

    await materializeAndCheckClosedState({
      projectId: projectC,
      findingId: 'finding-c',
      feedbackId: 'feedback-correction-reentered',
      targetState: 'REENTERED',
    });
    await materializeAndCheckClosedState({
      projectId: projectD,
      findingId: 'finding-d',
      feedbackId: 'feedback-correction-dismissed',
      targetState: 'DISMISSED',
    });
    await materializeAndCheckClosedState({
      projectId: projectE,
      findingId: 'finding-e',
      feedbackId: 'feedback-correction-suppressed',
      targetState: 'SUPPRESSED',
    });
  });
});
