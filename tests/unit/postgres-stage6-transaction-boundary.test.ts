import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

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

type FailureMode = 'commit-ack-loss' | 'pre-commit-failure';

type FakeTransaction = {
  readonly calls: string[];
  readonly pool: Pool;
};

const result = <T extends QueryResultRow>(rows: readonly T[] = []): QueryResult<T> => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  rows: [...rows],
  fields: [],
});

const createFakeTransaction = (
  snapshotDigest: string,
  mode: FailureMode,
  failure: Error,
): FakeTransaction => {
  const calls: string[] = [];
  const client = {
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => {
      void values;
      calls.push(sql);
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (sql === 'COMMIT') {
        if (mode === 'commit-ack-loss') throw failure;
        return result<T>();
      }
      if (sql === 'ROLLBACK') return result<T>();
      if (mode === 'pre-commit-failure' && normalized.includes('INSERT INTO canonical.outbox')) {
        throw failure;
      }
      if (normalized.includes('SELECT version, snapshot_digest')) {
        return result<T>([
          {
            version: 0,
            snapshot_digest: snapshotDigest,
            updated_at: new Date('2026-09-15T00:00:00.000Z'),
          } as T,
        ]);
      }
      if (
        normalized.includes('FROM canonical.commits') ||
        normalized.includes('FROM canonical.claims') ||
        normalized.includes('FROM canonical.relations') ||
        normalized.includes('FROM canonical.relation_precursors')
      ) {
        return result<T>();
      }
      return result<T>();
    },
    release: () => undefined,
  };
  return {
    calls,
    pool: {
      connect: async (): Promise<PoolClient> => client as unknown as PoolClient,
    } as unknown as Pool,
  };
};

const legacyFixture = (): {
  readonly write: CanonicalCommitWrite;
  readonly snapshotDigest: string;
} => {
  const projectId = `stage6-unit-legacy-${randomUUID()}`;
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
    claimText: 'A deterministic legacy Stage 6 claim.',
    operation: 'ADD_CLAIM',
    classification: 'ACCEPT' as const,
    candidateDigest: 'sha256:candidate',
    evidenceIds: ['evidence:legacy'],
    accessScope: ['owner'],
    sensitivity: 'private' as const,
    expectedCanonicalVersion: 0,
    snapshotDigest,
    diffDigest: 'sha256:diff',
    contentDigest: 'sha256:content',
    approvalToken: { actorId: 'owner' },
    reason: 'Stage 6 transaction boundary test.',
    createdAt: '2026-09-15T00:00:00.000Z',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
  } as unknown as ApprovedChangeSetManifest;
  return {
    snapshotDigest,
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
  readonly write: CanonicalCommitV2Write;
  readonly snapshotDigest: string;
} => {
  const projectId = `stage6-unit-v2-${randomUUID()}`;
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
    userApproval: { reason: 'Stage 6 v2 transaction boundary test.' },
    manifestDigest: `sha256:${'b'.repeat(64)}`,
  } as unknown as ApprovedChangeSetManifestV2;
  return {
    snapshotDigest,
    write: {
      commitId: `canonical-v2:${manifestId}`,
      revisionId: `revision-v2:${manifestId}`,
      historyEventId: `history-v2:${manifestId}`,
      outboxId: `outbox-v2:${manifestId}`,
      claimId: `claim-v2:${manifestId}`,
      manifest,
      candidateClaimText: 'A deterministic v2 Stage 6 claim.',
      actor: { type: 'user', id: 'owner' },
      committedAt: '2026-09-15T00:00:01.000Z',
    },
  };
};

const frontendFixture = (): {
  readonly write: FrontendCanonicalCommitWrite;
  readonly snapshotDigest: string;
} => {
  const projectId = `stage6-unit-frontend-${randomUUID()}`;
  const commitId = randomUUID();
  const snapshotDigest = canonicalSnapshotDigest(projectId, 0, []);
  return {
    snapshotDigest,
    write: {
      commitId,
      revisionId: `revision:${commitId}`,
      historyEventId: `history:${commitId}`,
      outboxId: `outbox:${commitId}`,
      projectId,
      operation: 'ADD_CLAIM',
      claimId: `claim:${commitId}`,
      claimText: 'A deterministic Frontend Stage 6 claim.',
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
      reason: 'Stage 6 frontend transaction boundary test.',
      actor: { type: 'user', id: 'owner' },
      committedAt: '2026-09-15T00:00:01.000Z',
    },
  };
};

const cases = [
  {
    name: 'legacy commit',
    create: legacyFixture,
    invoke: (repository: PostgresCanonicalKnowledgeRepository, write: CanonicalCommitWrite) =>
      repository.commit(write),
    operation: 'commit-canonical',
  },
  {
    name: 'v2 commit',
    create: v2Fixture,
    invoke: (repository: PostgresCanonicalKnowledgeRepository, write: CanonicalCommitV2Write) =>
      repository.commitV2(write),
    operation: 'commit-canonical-v2',
  },
  {
    name: 'frontend direct commit',
    create: frontendFixture,
    invoke: (
      repository: PostgresCanonicalKnowledgeRepository,
      write: FrontendCanonicalCommitWrite,
    ) => repository.commitFrontendDraft(write),
    operation: 'commit-frontend-draft',
  },
] as const;

describe.each(cases)('$name transaction boundary', ({ create, invoke, operation }) => {
  it('maps COMMIT acknowledgement loss to OUTCOME_UNKNOWN without ROLLBACK', async () => {
    const fixture = create();
    const failure = new Error('simulated lost COMMIT acknowledgement');
    const fake = createFakeTransaction(fixture.snapshotDigest, 'commit-ack-loss', failure);
    const repository = new PostgresCanonicalKnowledgeRepository(fake.pool);

    await expect(invoke(repository, fixture.write)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      module: 'postgres-stage6',
      operation,
    });
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
  });

  it('rolls back a failure that occurs before COMMIT and preserves the original error', async () => {
    const fixture = create();
    const failure = new Error('simulated Stage 6 write failure');
    const fake = createFakeTransaction(fixture.snapshotDigest, 'pre-commit-failure', failure);
    const repository = new PostgresCanonicalKnowledgeRepository(fake.pool);

    await expect(invoke(repository, fixture.write)).rejects.toBe(failure);
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(0);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(1);
  });
});
