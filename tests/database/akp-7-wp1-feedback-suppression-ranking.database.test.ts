import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFeedbackEventV1,
  type DiscoveryRankingPolicyRevisionV1,
  type DiscoverySuppressionDirectiveV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectA = `akp-7-wp1-a-${randomUUID()}`;
const projectB = `akp-7-wp1-b-${randomUUID()}`;
const policyId = `discovery-ranking-policy-${randomUUID()}`;

const finding = (projectId: string, findingId: string): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 2,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'AKP-7',
      missingFact: 'feedback persistence',
      question: 'Which feedback history is retained?',
    },
    relatedResourceRefs: [],
    evidenceIds: ['evidence-akp-7-wp1'],
    sourceProjectionDigest: 'sha256:source-projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:canonical-snapshot',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'discovery-projection-1',
      projectionDigest: 'sha256:discovery-projection',
    },
    runId: 'run-akp-7-wp1',
    signalSummary: { novelty: 0.5 },
    rationale: 'This fixture is a derived finding for the WP1 persistence test.',
    derivationSummary: 'The fixture carries no prompt or secret material.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'akp-7-wp1-test',
      ruleVersion: '1',
      inputDigest: 'sha256:akp-7-wp1-input',
    },
    accessScope: ['owner'],
    sensitivity: 'public',
    fingerprint: `sha256:${findingId}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-31T00:00:00.000Z',
  });

const feedback = (
  projectId: string,
  findingId: string,
  feedbackId: string,
): DiscoveryFeedbackEventV1 => ({
  schemaVersion: '1.0.0',
  feedbackId,
  projectId,
  findingId,
  findingRevision: 2,
  actor: { type: 'user', id: 'principal-akp-7' },
  principalId: 'principal-akp-7',
  feedbackClass: 'UTILITY',
  feedbackKind: 'USEFUL',
  reason: 'The discovery history is useful.',
  scope: 'FINDING',
  createdAt: '2026-08-31T01:00:00.000Z',
});

const exactSuppression = (
  projectId: string,
  findingId: string,
  suppressionId: string,
): DiscoverySuppressionDirectiveV1 => ({
  schemaVersion: '1.0.0',
  suppressionId,
  projectId,
  actor: { type: 'user', id: 'principal-akp-7' },
  principalId: 'principal-akp-7',
  sourceFindingId: findingId,
  sourceFindingRevision: 2,
  suppressionKind: 'SUPPRESS_EXACT',
  scope: 'FINDING',
  matcherKind: 'EXACT_FINGERPRINT',
  matcherVersion: 'discovery-fingerprint:v1',
  fingerprint: `sha256:${findingId}`,
  fingerprintVersion: 'discovery-fingerprint:v1',
  createdAt: '2026-08-31T02:00:00.000Z',
});

const rankingPolicy = (
  revision: number,
  effectiveFrom: string,
): DiscoveryRankingPolicyRevisionV1 => ({
  schemaVersion: '1.0.0',
  policyId,
  policyRevision: revision,
  scope: 'GLOBAL',
  algorithmVersion: 'discovery-ranking-policy:v1',
  rules: ['benefits-minus-penalties', 'finding-id-tiebreak'],
  weights: {
    novelty: 1,
    projectRelevance: 0.8,
    evidenceCoverage: 0.7,
    impactReach: 0.6,
    temporalUrgency: 0.5,
    redundancyPenalty: 0.4,
    costRiskPenalty: 0.3,
  },
  createdBy: { type: 'system', id: 'akp-7-wp1-test' },
  createdAt: effectiveFrom,
  effectiveFrom,
});

describe.runIf(databaseUrl)('AKP-7 WP1 feedback and ranking PostgreSQL authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-7 WP1 A', 'ACTIVE', true),
              ($2, 'AKP-7 WP1 B', 'ACTIVE', true)`,
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
      // Test cleanup may bypass append-only triggers; normal repository code
      // has no deletion path for these durable records.
      await client.query('SET session_replication_role = replica');
      await client.query(
        'DELETE FROM discovery.suppression_directives WHERE project_id IN ($1, $2)',
        [projectA, projectB],
      );
      await client.query('DELETE FROM discovery.feedback_events WHERE project_id IN ($1, $2)', [
        projectA,
        projectB,
      ]);
      await client.query('DELETE FROM discovery.ranking_policy_revisions WHERE policy_id = $1', [
        policyId,
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

  it('round-trips append-only feedback with exact revision and project isolation', async () => {
    const repository = new PostgresDiscoveryFeedbackRepository(pool!);
    const event = feedback(projectA, 'finding-a', 'feedback-a');
    expect(await repository.appendFeedback(event)).toBe('CREATED');
    expect(await repository.appendFeedback({ ...event, reason: 'overwrite attempt' })).toBe(
      'CONFLICT',
    );
    expect(
      await repository.listFeedbackForFinding({
        projectId: projectA,
        findingId: 'finding-a',
        findingRevision: 2,
      }),
    ).toEqual([event]);
    expect(
      await repository.listFeedbackForFinding({
        projectId: projectB,
        findingId: 'finding-a',
        findingRevision: 2,
      }),
    ).toEqual([]);
  });

  it('separates exact suppression from similar matching and retains expired snooze history', async () => {
    const repository = new PostgresDiscoveryFeedbackRepository(pool!);
    const exact = exactSuppression(projectA, 'finding-a', 'suppression-exact');
    expect(await repository.appendSuppression(exact)).toBe('CREATED');
    expect(await repository.appendSuppression({ ...exact, fingerprint: 'overwrite attempt' })).toBe(
      'CONFLICT',
    );
    expect(
      await repository.appendSuppression({
        ...exact,
        suppressionId: 'suppression-similar',
        suppressionKind: 'SUPPRESS_SIMILAR',
        scope: 'PROJECT',
        matcherKind: 'SEMANTIC_FAMILY',
        matcherVersion: 'semantic-family:v1',
        fingerprint: undefined,
        fingerprintVersion: undefined,
      }),
    ).toBe('CREATED');
    expect(
      await repository.appendSuppression({
        ...exact,
        suppressionId: 'suppression-snooze',
        suppressionKind: 'SNOOZE',
        matcherKind: 'NONE',
        matcherVersion: undefined,
        fingerprint: undefined,
        fingerprintVersion: undefined,
        expiresAt: '2026-09-01T00:00:00.000Z',
      }),
    ).toBe('CREATED');

    const lookup = {
      projectId: projectA,
      principalId: 'principal-akp-7',
      findingId: 'finding-a',
      findingRevision: 2,
      fingerprint: 'sha256:finding-a',
      fingerprintVersion: 'discovery-fingerprint:v1',
      at: '2026-08-31T12:00:00.000Z',
    };
    expect(
      (await repository.listRelevantSuppression(lookup)).map((entry) => entry.suppressionId),
    ).toEqual(['suppression-exact', 'suppression-snooze']);
    expect(
      (
        await repository.listRelevantSuppression({
          ...lookup,
          fingerprint: undefined,
          fingerprintVersion: undefined,
          semanticMatcherVersion: 'semantic-family:v1',
        })
      ).map((entry) => entry.suppressionId),
    ).toEqual(['suppression-similar', 'suppression-snooze']);
    expect(
      (
        await repository.listRelevantSuppression({
          ...lookup,
          at: '2026-09-02T00:00:00.000Z',
        })
      ).map((entry) => entry.suppressionId),
    ).toEqual(['suppression-exact']);
    expect(
      (
        await pool!.query<{ count: string }>(
          'SELECT count(*) FROM discovery.suppression_directives WHERE suppression_id = $1',
          ['suppression-snooze'],
        )
      ).rows[0]?.count,
    ).toBe('1');
    expect(
      await repository.listRelevantSuppression({
        ...lookup,
        projectId: projectB,
        findingId: 'finding-b',
      }),
    ).toEqual([]);
    expect(
      await repository.listSuppressionForPresentation({
        projectId: projectA,
        principalId: 'principal-akp-7',
        at: '2026-08-31T12:00:00.000Z',
      }),
    ).toHaveLength(3);
    expect(
      (
        await repository.listLatestUtilityFeedbackForPresentation({
          projectId: projectA,
          principalId: 'principal-akp-7',
          at: '2026-08-31T12:00:00.000Z',
        })
      ).map((entry) => entry.feedbackId),
    ).toEqual(['feedback-a']);
  });

  it('keeps ranking policy revisions immutable and resolves the effective global revision', async () => {
    const repository = new PostgresDiscoveryFeedbackRepository(pool!);
    expect(
      await repository.insertRankingPolicyRevision(rankingPolicy(1, '2026-08-31T00:00:00.000Z')),
    ).toBe('CREATED');
    expect(
      await repository.insertRankingPolicyRevision(rankingPolicy(2, '2999-01-01T00:00:00.000Z')),
    ).toBe('CREATED');
    expect(
      await repository.insertRankingPolicyRevision(rankingPolicy(2, '2999-01-01T00:00:00.000Z')),
    ).toBe('CONFLICT');
    expect(
      (
        await repository.resolveEffectiveRankingPolicy({
          projectId: projectA,
          policyId,
        })
      )?.policyRevision,
    ).toBe(1);
    expect(
      (
        await repository.resolveEffectiveRankingPolicy({
          projectId: projectA,
          policyId,
          at: '2999-01-02T00:00:00.000Z',
        })
      )?.policyRevision,
    ).toBe(2);
    expect(
      (
        await repository.resolveEffectiveRankingPolicy({
          projectId: projectA,
          policyId,
          at: '2026-08-31T12:00:00.000Z',
        })
      )?.policyRevision,
    ).toBe(1);
    expect(
      (
        await repository.listRankingPolicyRevisions({
          projectId: projectA,
          policyId,
          at: '2999-01-02T00:00:00.000Z',
        })
      ).map((entry) => entry.policyRevision),
    ).toEqual([2, 1]);
  });
});
