import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import {
  createProjectionSearchModule,
  type ProjectionCommitWrite,
  type ProjectionRebuildWrite,
  type SearchProjectionRepositoryPort,
} from '../../modules/projection-search/src/index.js';
import type { HandlerContext } from '../../packages/module-sdk/src/index.js';
import {
  ShotgunError,
  type CommandEnvelope,
  type CanonicalSnapshot,
  type EventEnvelope,
  type ProjectionWatermark,
  type SearchProjectionDocument,
} from '../../packages/contracts/src/index.js';

type FailureMode = 'commit-ack-loss' | 'unresolved-commit-ack-loss';

type FakeTransaction = {
  readonly calls: string[];
  readonly poolQueries: string[];
  readonly pool: Pool;
};

const result = <T extends QueryResultRow>(rows: readonly T[] = []): QueryResult<T> => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  rows: [...rows],
  fields: [],
});

const readyRow = (watermark: ProjectionWatermark): QueryResultRow => ({
  project_id: watermark.projectId,
  last_commit_id: watermark.lastCommitId ?? null,
  canonical_version: watermark.canonicalVersion,
  snapshot_digest: watermark.snapshotDigest,
  status: 'READY',
  last_error: null,
  updated_at: new Date(watermark.updatedAt),
});

const createFakeTransaction = (
  mode: FailureMode,
  readback: ProjectionWatermark | undefined,
): FakeTransaction => {
  const calls: string[] = [];
  const poolQueries: string[] = [];
  const client = {
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => {
      void values;
      calls.push(sql);
      if (sql === 'COMMIT') {
        if (mode === 'commit-ack-loss') {
          throw new Error('simulated lost COMMIT acknowledgement');
        }
        throw new Error('simulated unresolved COMMIT acknowledgement');
      }
      if (sql === 'ROLLBACK') return result<T>();
      return result<T>();
    },
    release: () => undefined,
  };
  const pool = {
    connect: async (): Promise<PoolClient> => client as unknown as PoolClient,
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => {
      void values;
      poolQueries.push(sql);
      if (sql.includes('FROM projection.watermarks')) {
        return result<T>(readback ? [readyRow(readback) as T] : []);
      }
      return result<T>();
    },
  };
  return { calls, poolQueries, pool: pool as unknown as Pool };
};

const fixture = () => {
  const projectId = `stage7-unit-${randomUUID()}`;
  const commitId = randomUUID();
  const projectedAt = '2026-09-15T00:00:00.000Z';
  const watermark: ProjectionWatermark = {
    projectId,
    lastCommitId: commitId,
    canonicalVersion: 1,
    snapshotDigest: `sha256:${'a'.repeat(64)}`,
    status: 'READY',
    updatedAt: projectedAt,
  };
  const document: SearchProjectionDocument = {
    projectId,
    claimId: `claim:${randomUUID()}`,
    commitId,
    revisionId: `revision:${randomUUID()}`,
    canonicalVersion: 1,
    claimText: 'Stage 7 transaction boundary fixture.',
    sourceVersionId: randomUUID(),
    evidenceIds: [`evidence:${randomUUID()}`],
    accessScope: ['owner'],
    sensitivity: 'private',
    projectedAt,
  };
  return { projectId, commitId, projectedAt, watermark, document };
};

describe('Postgres Stage 7 transaction boundary', () => {
  it.each([['incremental apply', 'apply'] as const, ['full rebuild', 'rebuild'] as const])(
    '%s resolves a committed COMMIT acknowledgement loss from the watermark',
    async (_name, path) => {
      const current = fixture();
      const fake = createFakeTransaction('commit-ack-loss', current.watermark);
      const repository = new PostgresSearchProjectionRepository(fake.pool);

      if (path === 'apply') {
        const write: ProjectionCommitWrite = {
          document: current.document,
          commitId: current.commitId,
          operation: 'ADD_CLAIM',
          canonicalVersion: 1,
          snapshotDigest: current.watermark.snapshotDigest,
          projectedAt: current.projectedAt,
        };
        await expect(repository.applyCommit(current.projectId, write)).resolves.toBeUndefined();
      } else {
        const write: ProjectionRebuildWrite = {
          documents: [current.document],
          watermark: current.watermark,
        };
        await expect(repository.rebuild(current.projectId, write)).resolves.toBeUndefined();
      }

      expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
      expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
      expect(
        fake.poolQueries.filter((query) => query.includes('FROM projection.watermarks')),
      ).toHaveLength(1);
    },
  );

  it.each([['incremental apply', 'apply'] as const, ['full rebuild', 'rebuild'] as const])(
    '%s preserves OUTCOME_UNKNOWN when the COMMIT result cannot be proven',
    async (_name, path) => {
      const current = fixture();
      const fake = createFakeTransaction('unresolved-commit-ack-loss', undefined);
      const repository = new PostgresSearchProjectionRepository(fake.pool);
      const operation =
        path === 'apply'
          ? repository.applyCommit(current.projectId, {
              document: current.document,
              commitId: current.commitId,
              operation: 'ADD_CLAIM',
              canonicalVersion: 1,
              snapshotDigest: current.watermark.snapshotDigest,
              projectedAt: current.projectedAt,
            })
          : repository.rebuild(current.projectId, {
              documents: [current.document],
              watermark: current.watermark,
            });

      await expect(operation).rejects.toMatchObject({
        code: 'OUTCOME_UNKNOWN',
        module: 'postgres-stage7',
        operation: path === 'apply' ? 'apply-canonical-projection' : 'rebuild-canonical-projection',
      });
      expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
      expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
    },
  );

  it.each([['incremental apply', 'apply'] as const, ['full rebuild', 'rebuild'] as const])(
    '%s rolls back deterministic pre-COMMIT failure',
    async (_name, path) => {
      const current = fixture();
      const fake = createFakeTransaction('unresolved-commit-ack-loss', undefined);
      const repository = new PostgresSearchProjectionRepository(fake.pool, {
        failpoint: 'after-document',
      });
      const operation =
        path === 'apply'
          ? repository.applyCommit(current.projectId, {
              document: current.document,
              commitId: current.commitId,
              operation: 'ADD_CLAIM',
              canonicalVersion: 1,
              snapshotDigest: current.watermark.snapshotDigest,
              projectedAt: current.projectedAt,
            })
          : repository.rebuild(current.projectId, {
              documents: [current.document],
              watermark: current.watermark,
            });

      await expect(operation).rejects.toThrow('failpoint');
      expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(0);
      expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(1);
    },
  );
});

const handlerEnvelope = (
  messageType: 'CanonicalCommitted' | 'RebuildSearchProjection',
  projectId: string,
  payload: Record<string, unknown>,
) =>
  ({
    messageType,
    messageKind: messageType === 'CanonicalCommitted' ? 'event' : 'command',
    schemaVersion: '1.0.0',
    messageId: randomUUID(),
    idempotencyKey: `stage7-test:${randomUUID()}`,
    correlationId: randomUUID(),
    traceId: randomUUID(),
    producerModule: 'stage7-test',
    producerVersion: '1.0.0',
    projectId,
    actor: { type: 'service', id: 'stage7-test' },
    security: {
      accessScope: ['owner'],
      sensitivity: 'restricted',
      dataClassification: 'stage7-test',
    },
    payload,
  }) as unknown as EventEnvelope;

describe('Stage 7 ambiguous handler failures', () => {
  it('does not mark CanonicalCommitted degraded for OUTCOME_UNKNOWN', async () => {
    const projectId = `stage7-handler-${randomUUID()}`;
    const markDegraded = vi.fn(async () => undefined);
    const repository: SearchProjectionRepositoryPort = {
      applyCommit: vi.fn(async () => {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'Projection outcome is ambiguous.',
          module: 'postgres-stage7',
          operation: 'apply-canonical-projection',
        });
      }),
      rebuild: vi.fn(async () => undefined),
      markDegraded,
      findWatermark: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
    };
    const module = createProjectionSearchModule(repository, {
      now: () => '2026-09-15T00:00:00.000Z',
    });
    const context = { publish: vi.fn(), query: vi.fn() } as unknown as HandlerContext;
    const event = handlerEnvelope('CanonicalCommitted', projectId, {
      commitId: randomUUID(),
      operation: 'NO_OP',
      status: 'NO_OP',
      canonicalVersion: 0,
      snapshotDigest: `sha256:${'b'.repeat(64)}`,
      actorId: 'stage7-test',
      accessScope: ['owner'],
      sensitivity: 'restricted',
    });

    await expect(module.handlers.events[0]!.handle(event, context)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(markDegraded).not.toHaveBeenCalled();
  });

  it('does not mark RebuildSearchProjection degraded for OUTCOME_UNKNOWN', async () => {
    const projectId = `stage7-handler-${randomUUID()}`;
    const markDegraded = vi.fn(async () => undefined);
    const repository: SearchProjectionRepositoryPort = {
      applyCommit: vi.fn(async () => undefined),
      rebuild: vi.fn(async () => {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'Projection outcome is ambiguous.',
          module: 'postgres-stage7',
          operation: 'rebuild-canonical-projection',
        });
      }),
      markDegraded,
      findWatermark: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
    };
    const module = createProjectionSearchModule(repository, {
      now: () => '2026-09-15T00:00:00.000Z',
    });
    const snapshot = {
      snapshotId: `canonical:${projectId}:0`,
      projectId,
      version: 0,
      digest: `sha256:${'c'.repeat(64)}`,
      claims: [],
      createdAt: '2026-09-15T00:00:00.000Z',
    } as unknown as CanonicalSnapshot;
    const context = {
      publish: vi.fn(),
      query: vi.fn(async (request: { messageType: string }) =>
        request.messageType === 'GetCanonicalSnapshot'
          ? { payload: snapshot }
          : { payload: { items: [] } },
      ),
    } as unknown as HandlerContext;
    const command = handlerEnvelope(
      'RebuildSearchProjection',
      projectId,
      {},
    ) as unknown as CommandEnvelope;

    await expect(module.handlers.commands[0]!.handle(command, context)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(markDegraded).not.toHaveBeenCalled();
  });
});
