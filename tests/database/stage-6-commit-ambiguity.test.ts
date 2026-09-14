import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import type {
  CanonicalCommitV2Write,
  CanonicalCommitWrite,
} from '../../modules/canonical-knowledge/src/index.js';
import {
  canonicalSnapshotDigest,
  type ApprovedChangeSetManifest,
  type ApprovedChangeSetManifestV2,
  type FrontendCanonicalCommitWrite,
} from '../../packages/contracts/src/index.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createCommitAckLossPool = (basePool: Pool): Pool =>
  ({
    connect: async (): Promise<PoolClient> => {
      const client = await basePool.connect();
      return {
        query: async <T extends QueryResultRow = QueryResultRow>(
          sql: string,
          values?: readonly unknown[],
        ) => {
          const response =
            values === undefined
              ? await client.query<T>(sql)
              : await client.query<T>(sql, values as never);
          if (sql === 'COMMIT') {
            throw new Error('Simulated lost PostgreSQL COMMIT acknowledgement.');
          }
          return response;
        },
        release: (error?: Error) => client.release(error),
      } as unknown as PoolClient;
    },
  }) as unknown as Pool;

const legacyFixture = (): {
  readonly projectId: string;
  readonly write: CanonicalCommitWrite;
} => {
  const projectId = `stage6-ack-loss-legacy-${randomUUID()}`;
  const manifestId = randomUUID();
  const snapshotDigest = canonicalSnapshotDigest(projectId, 0, []);
  const manifest = {
    manifestId,
    changeSetId: randomUUID(),
    changeSetRevisionNumber: 1,
    projectId,
    sourceVersionId: randomUUID(),
    candidateId: `candidate:${manifestId}`,
    candidateRevisionNumber: 1,
    claimText: 'A legacy claim survives a lost COMMIT acknowledgement.',
    operation: 'ADD_CLAIM',
    classification: 'ACCEPT',
    candidateDigest: 'sha256:candidate',
    evidenceIds: ['evidence:legacy'],
    accessScope: ['owner'],
    sensitivity: 'private',
    expectedCanonicalVersion: 0,
    snapshotDigest,
    diffDigest: 'sha256:diff',
    contentDigest: 'sha256:content',
    approvalToken: { actorId: 'owner' },
    reason: 'COMMIT acknowledgement loss regression.',
    createdAt: '2026-09-15T00:00:00.000Z',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
  } as unknown as ApprovedChangeSetManifest;
  return {
    projectId,
    write: {
      commitId: manifestId,
      revisionId: `revision:${manifestId}`,
      historyEventId: `history:${manifestId}`,
      outboxId: `outbox:${manifestId}`,
      claimId: `claim:${manifestId}`,
      manifest,
      actor: { type: 'user', id: 'owner' },
      committedAt: '2026-09-15T00:00:01.000Z',
    },
  };
};

const v2Fixture = (): {
  readonly projectId: string;
  readonly write: CanonicalCommitV2Write;
} => {
  const projectId = `stage6-ack-loss-v2-${randomUUID()}`;
  const manifestId = `manifest-v2:${randomUUID()}`;
  const snapshotDigest = canonicalSnapshotDigest(projectId, 0, []);
  const manifest = {
    manifestId,
    changeSetId: `comparison-v2:${manifestId}`,
    projectId,
    candidate: { sourceVersionId: `source-v2:${manifestId}` },
    evidenceIds: ['evidence:v2'],
    operation: 'ADD_CLAIM',
    expectedCanonicalVersion: 0,
    snapshotDigest,
    accessScope: ['owner'],
    sensitivity: 'private',
    userApproval: { reason: 'COMMIT acknowledgement loss regression.' },
    manifestDigest: `sha256:${'b'.repeat(64)}`,
  } as unknown as ApprovedChangeSetManifestV2;
  return {
    projectId,
    write: {
      commitId: `canonical-v2:${manifestId}`,
      revisionId: `revision-v2:${manifestId}`,
      historyEventId: `history-v2:${manifestId}`,
      outboxId: `outbox-v2:${manifestId}`,
      claimId: `claim-v2:${manifestId}`,
      manifest,
      candidateClaimText: 'A v2 claim survives a lost COMMIT acknowledgement.',
      actor: { type: 'user', id: 'owner' },
      committedAt: '2026-09-15T00:00:01.000Z',
    },
  };
};

const frontendFixture = (): {
  readonly projectId: string;
  readonly write: FrontendCanonicalCommitWrite;
} => {
  const projectId = `stage6-ack-loss-frontend-${randomUUID()}`;
  const commitId = randomUUID();
  const snapshotDigest = canonicalSnapshotDigest(projectId, 0, []);
  return {
    projectId,
    write: {
      commitId,
      revisionId: `revision:${commitId}`,
      historyEventId: `history:${commitId}`,
      outboxId: `outbox:${commitId}`,
      projectId,
      operation: 'ADD_CLAIM',
      claimId: `claim:${commitId}`,
      claimText: 'A frontend claim survives a lost COMMIT acknowledgement.',
      sourceVersionId: `source-frontend:${commitId}`,
      evidenceIds: ['evidence:frontend'],
      accessScope: ['owner'],
      sensitivity: 'private',
      expectedCanonicalVersion: 0,
      snapshotDigest,
      authority: {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: `approval:${commitId}`,
        approvalBindingDigest: 'sha256:frontend-binding',
        reviewContextId: `context:${commitId}`,
        contextRevision: 1,
        draftId: `draft:${commitId}`,
        draftRevision: 1,
        draftContentDigest: 'sha256:frontend-draft',
        approvedItemIds: [`item:${commitId}`],
      },
      reason: 'COMMIT acknowledgement loss regression.',
      actor: { type: 'user', id: 'owner' },
      committedAt: '2026-09-15T00:00:01.000Z',
    },
  };
};

const countCanonicalRows = async (projectId: string) => {
  const counts = await pool!.query<{
    readonly claims: string;
    readonly commits: string;
    readonly revisions: string;
    readonly history: string;
    readonly outbox: string;
    readonly version: string;
  }>(
    `SELECT
       (SELECT count(*) FROM canonical.claims WHERE project_id = $1)::text AS claims,
       (SELECT count(*) FROM canonical.commits WHERE project_id = $1)::text AS commits,
       (SELECT count(*) FROM canonical.revisions WHERE project_id = $1)::text AS revisions,
       (SELECT count(*) FROM canonical.history_events WHERE project_id = $1)::text AS history,
       (SELECT count(*) FROM canonical.outbox WHERE project_id = $1)::text AS outbox,
       (SELECT version FROM canonical.project_state WHERE project_id = $1)::text AS version`,
    [projectId],
  );
  return counts.rows[0];
};

describe.runIf(pool)('Stage 6 PostgreSQL COMMIT ambiguity recovery', () => {
  beforeEach(async () => {
    await dropSchemas(databaseUrl);
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('returns OUTCOME_UNKNOWN, then resolves all three direct paths by deterministic replay', async () => {
    type Stage6Write = CanonicalCommitWrite | CanonicalCommitV2Write | FrontendCanonicalCommitWrite;
    type Stage6Case = {
      readonly fixture: { readonly projectId: string; readonly write: Stage6Write };
      readonly invoke: (
        repository: PostgresCanonicalKnowledgeRepository,
        write: Stage6Write,
      ) => Promise<Awaited<ReturnType<PostgresCanonicalKnowledgeRepository['commit']>>>;
    };
    const cases: readonly Stage6Case[] = [
      {
        fixture: legacyFixture(),
        invoke: (repository, write) => repository.commit(write as CanonicalCommitWrite),
      },
      {
        fixture: v2Fixture(),
        invoke: (repository, write) => repository.commitV2(write as CanonicalCommitV2Write),
      },
      {
        fixture: frontendFixture(),
        invoke: (repository, write) =>
          repository.commitFrontendDraft(write as FrontendCanonicalCommitWrite),
      },
    ];

    for (const testCase of cases) {
      const ambiguousRepository = new PostgresCanonicalKnowledgeRepository(
        createCommitAckLossPool(pool!),
      );
      await expect(
        testCase.invoke(ambiguousRepository, testCase.fixture.write),
      ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });

      const repository = new PostgresCanonicalKnowledgeRepository(pool!);
      const replay = await testCase.invoke(repository, testCase.fixture.write);
      expect(replay.status).toBe('COMMITTED');
      expect(replay.afterVersion).toBe(1);
      expect(await countCanonicalRows(testCase.fixture.projectId)).toEqual({
        claims: '1',
        commits: '1',
        revisions: '1',
        history: '1',
        outbox: '1',
        version: '1',
      });
    }
  }, 60_000);
});
