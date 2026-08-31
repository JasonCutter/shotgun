import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../adapters/discovery-reentry-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  computeDiscoveryEpistemicReentryIdentityV1,
  createDiscoveryFindingEnvelopeV1,
  decodeDiscoveryEpistemicReentryTriggerV1,
  type DiscoveryFeedbackEventV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectA = `akp-7-wp4-a-${randomUUID()}`;
const projectB = `akp-7-wp4-b-${randomUUID()}`;

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
              ($2, 'AKP-7 WP4 B', 'ACTIVE', true)`,
      [projectA, projectB],
    );
    const findings = new PostgresDiscoveryFindingRepository(pool!);
    expect(await findings.save(finding(projectA, 'finding-a'))).toBe('CREATED');
    expect(await findings.save(finding(projectB, 'finding-b'))).toBe('CREATED');
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      // Test cleanup may bypass append-only triggers; production code has no
      // deletion path for these durable records.
      await client.query('SET session_replication_role = replica');
      await client.query(
        'DELETE FROM discovery.epistemic_reentry_triggers WHERE project_id IN ($1, $2)',
        [projectA, projectB],
      );
      await client.query('DELETE FROM discovery.feedback_events WHERE project_id IN ($1, $2)', [
        projectA,
        projectB,
      ]);
      await client.query(
        'DELETE FROM discovery.finding_lifecycle_history WHERE project_id IN ($1, $2)',
        [projectA, projectB],
      );
      await client.query(
        'DELETE FROM discovery.finding_lifecycle_current WHERE project_id IN ($1, $2)',
        [projectA, projectB],
      );
      await client.query('DELETE FROM discovery.findings WHERE project_id IN ($1, $2)', [
        projectA,
        projectB,
      ]);
      await client.query('DELETE FROM project_admin.projects WHERE id IN ($1, $2)', [
        projectA,
        projectB,
      ]);
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
});
