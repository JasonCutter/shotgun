import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { ComparisonActivityAdapter } from '../../adapters/frontend-activity-comparison/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresComparisonV2Repository } from '../../adapters/postgres-stage5/src/index.js';
import type { ClaimCandidate } from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
let pool: Pool | undefined;

describe.runIf(databaseUrl)('Issue #245 PostgreSQL blocked outcome durability', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    pool = createPostgresPool(databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('survives pool recreation and remains Product-visible as Attention', async () => {
    const suffix = randomUUID();
    const projectId = `issue245-db-${suffix}`;
    const candidateId = `candidate-${suffix}`;
    const candidate = {
      candidateId,
      projectId,
      revisionNumber: 1,
      accessScope: ['owner'],
      sensitivity: 'private',
    } as unknown as ClaimCandidate;
    const candidateDigest =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const governingInputDigest =
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const writeRepository = new PostgresComparisonV2Repository(pool!);
    const created = await writeRepository.blockedOutcomes.recordBlockedOutcome({
      projectId,
      candidateId,
      candidateRevision: 1,
      candidateDigest,
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest,
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: '2026-09-09T12:00:00.000Z',
    });

    await pool!.end();
    pool = createPostgresPool(databaseUrl!);
    const readRepository = new PostgresComparisonV2Repository(pool);
    try {
      const persisted = await readRepository.blockedOutcomes.findBlockedOutcome(
        projectId,
        created.blockedOutcomeId,
      );
      expect(persisted).toMatchObject({
        blockedOutcomeId: created.blockedOutcomeId,
        projectId,
        state: 'ACTIVE',
      });

      await readRepository.blockedOutcomes.resolveBlockedOutcomes({
        projectId,
        candidateId,
        candidateRevision: 1,
        candidateDigest,
        resolutionIdentity: 'comparison-resolved-db',
        resolvedAt: '2026-09-09T12:01:00.000Z',
        state: 'RESOLVED',
      });
      const reactivated = await readRepository.blockedOutcomes.recordBlockedOutcome({
        projectId,
        candidateId,
        candidateRevision: 1,
        candidateDigest,
        blockedPhase: 'SHORTLIST',
        reason: 'SHORTLIST_BLOCKED',
        safeCode: 'SHORTLIST_BLOCKED',
        governingInputDigest,
        accessScope: ['owner'],
        sensitivity: 'private',
        observedAt: '2026-09-09T12:02:00.000Z',
      });
      expect(reactivated).toMatchObject({
        blockedOutcomeId: created.blockedOutcomeId,
        state: 'ACTIVE',
        resolvedAt: undefined,
        resolutionIdentity: undefined,
      });

      const adapter = new ComparisonActivityAdapter(readRepository.blockedOutcomes, undefined, {
        findById: async () => candidate,
      });
      const page = await adapter.readQueue(
        {
          principalId: 'owner-245-db',
          activeProjectId: projectId,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
          accessScope: ['owner'],
          sensitivityClearance: 'private',
        },
        {},
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.dimensions.attention).toBe('NEEDS_ATTENTION');
    } finally {
      await pool.query('DELETE FROM comparison.blocked_outcomes_v2 WHERE project_id = $1', [
        projectId,
      ]);
    }
  });
});
