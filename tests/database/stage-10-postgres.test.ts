import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import type {
  CanonicalSnapshot,
  CompiledTruthProjection,
  DerivedInferenceCandidate,
  KnowledgeReviewGroup,
  QueryResultEnvelope,
} from '../../packages/contracts/src/index.js';
import { createCommand, createQuery } from '../../packages/kernel/src/index.js';
import type { DispatchQueryInput, HandlerContext } from '../../packages/module-sdk/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

type CommitAckLossMode = 'after-commit' | 'before-commit';

type CommitAckLossPool = {
  readonly pool: Pool;
  readonly commands: string[];
  readonly delegatedCommitCount: () => number;
  readonly connectionDiscarded: () => boolean;
};

const createCommitAckLossPool = (basePool: Pool, mode: CommitAckLossMode): CommitAckLossPool => {
  const commands: string[] = [];
  let delegatedCommitCount = 0;
  let connectionDiscarded = false;
  const query = async (
    client: PoolClient,
    queryText: string,
    values?: readonly unknown[],
  ): Promise<unknown> => client.query(queryText, values as unknown[]);
  const wrappedPool = {
    connect: async (): Promise<PoolClient> => {
      const client = await basePool.connect();
      let released = false;
      return {
        query: async (queryText: string, values?: readonly unknown[]) => {
          const command = queryText.trim().toUpperCase();
          if (command === 'BEGIN' || command === 'COMMIT' || command === 'ROLLBACK') {
            commands.push(command);
          }
          if (command === 'COMMIT') {
            if (mode === 'before-commit') {
              connectionDiscarded = true;
              released = true;
              client.release(new Error('discarded before COMMIT outcome was proven'));
              throw new Error('simulated unresolved COMMIT acknowledgement');
            }
            delegatedCommitCount += 1;
            await query(client, queryText, values);
            throw new Error('simulated lost COMMIT acknowledgement');
          }
          return query(client, queryText, values);
        },
        release: (error?: Error) => {
          if (released) return;
          released = true;
          client.release(error);
        },
      } as unknown as PoolClient;
    },
    query: (queryText: string, values?: readonly unknown[]) =>
      basePool.query(queryText, values as unknown[]),
  };
  return {
    pool: wrappedPool as unknown as Pool,
    commands,
    delegatedCommitCount: () => delegatedCommitCount,
    connectionDiscarded: () => connectionDiscarded,
  };
};

const projection = (buildMode: 'FULL_REBUILD' | 'INCREMENTAL'): CompiledTruthProjection => ({
  projectId: 'project-stage10',
  projectorVersion: '1.0.0',
  sourceSnapshotDigest: `sha256:${'1'.repeat(64)}`,
  logicalDigest: `sha256:${'2'.repeat(64)}`,
  canonicalVersion: 3,
  items: [
    {
      id: 'entity:isolated',
      type: 'ENTITY',
      label: 'Isolated',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: ['evidence:1'],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'entity:isolated',
        type: 'ENTITY',
        label: 'Isolated',
        state: 'CURRENT',
        source: 'APPROVED_KNOWLEDGE',
        evidenceIds: ['evidence:1'],
        accessScope: ['owner'],
        sensitivity: 'private',
      },
    ],
    edges: [],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: '2026-07-17T10:00:00.000Z',
  buildMode,
});

const inference: DerivedInferenceCandidate = {
  candidateId: 'inference:isolated',
  fingerprint: `sha256:${'3'.repeat(64)}`,
  status: 'DERIVED_INFERENCE',
  candidateType: 'KNOWLEDGE_GAP',
  question: 'What approved relationship is missing for Isolated?',
  relatedNodeIds: ['entity:isolated'],
  evidenceIds: ['evidence:1'],
  sourceProjectionDigest: `sha256:${'2'.repeat(64)}`,
  reentryPhase: 'VALIDATION',
  createdAt: '2026-07-17T10:01:00.000Z',
};

const approvedGroup = (projectId: string, groupId: string): KnowledgeReviewGroup => ({
  groupId,
  projectId,
  sourceVersionId: 'source-stage10',
  revisionNumber: 1,
  status: 'APPROVED',
  contentDigest: `sha256:${'7'.repeat(64)}`,
  items: [
    {
      candidateId: 'entity:isolated',
      candidateType: 'ENTITY',
      revisionNumber: 1,
      sourceVersionId: 'source-stage10',
      evidenceIds: ['evidence:1'],
      modelOutputs: [
        {
          provider: 'fixture',
          model: 'model-a',
          value: 'Isolated',
          evidenceIds: ['evidence:1'],
        },
      ],
      name: 'Isolated',
      entityKind: 'CONCEPT',
      aliases: [],
      resolution: { status: 'NEW' },
    },
  ],
  decisions: [],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-07-17T09:00:00.000Z',
  updatedAt: '2026-07-17T10:00:00.000Z',
});

describe.runIf(pool)('Stage 10 PostgreSQL projection persistence', () => {
  beforeEach(async () => {
    await pool!.query(
      'TRUNCATE projection.discovery_inferences, projection.compiled_truth CASCADE',
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('survives restart, keeps full/incremental parity and suppresses duplicate inference', async () => {
    const first = new PostgresCompiledTruthRepository(pool!);
    await first.synchronize(projection('FULL_REBUILD'));

    const restarted = new PostgresCompiledTruthRepository(pool!);
    expect(await restarted.findProjection('project-stage10')).toEqual(projection('FULL_REBUILD'));
    const incremental = await restarted.synchronize(projection('INCREMENTAL'));
    expect(incremental.logicalDigest).toBe(projection('FULL_REBUILD').logicalDigest);
    expect(incremental.buildMode).toBe('INCREMENTAL');

    const accepted = await restarted.saveInferences('project-stage10', [inference]);
    expect(accepted).toEqual({ accepted: [inference], suppressedFingerprints: [] });
    const repeated = await restarted.saveInferences('project-stage10', [inference]);
    expect(repeated).toEqual({
      accepted: [],
      suppressedFingerprints: [inference.fingerprint],
    });
    expect(await restarted.listInferences('project-stage10')).toEqual([inference]);
  });

  it('resolves a real Compiled Truth COMMIT acknowledgement loss from an exact READY read-back', async () => {
    const expected = projection('FULL_REBUILD');
    const ackLoss = createCommitAckLossPool(pool!, 'after-commit');
    const repository = new PostgresCompiledTruthRepository(ackLoss.pool);

    await expect(repository.synchronize(expected)).resolves.toEqual(expected);
    expect(ackLoss.delegatedCommitCount()).toBe(1);
    expect(ackLoss.commands.filter((command) => command === 'ROLLBACK')).toHaveLength(0);

    const persisted = await pool!.query<{
      status: string;
      last_error: string | null;
      projection: CompiledTruthProjection;
    }>(
      `SELECT status, last_error, projection
       FROM projection.compiled_truth WHERE project_id = $1`,
      [expected.projectId],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({ status: 'READY', last_error: null });
    expect(persisted.rows[0]!.projection).toEqual(expected);
    const count = await pool!.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM projection.compiled_truth WHERE project_id = $1',
      [expected.projectId],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('keeps an unresolved real Compiled Truth COMMIT outcome unknown after discarding the transaction connection', async () => {
    const expected = projection('FULL_REBUILD');
    const unresolved = createCommitAckLossPool(pool!, 'before-commit');
    const repository = new PostgresCompiledTruthRepository(unresolved.pool);

    await expect(repository.synchronize(expected)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(unresolved.delegatedCommitCount()).toBe(0);
    expect(unresolved.connectionDiscarded()).toBe(true);
    expect(unresolved.commands.filter((command) => command === 'ROLLBACK')).toHaveLength(0);

    const persisted = await pool!.query(
      'SELECT 1 FROM projection.compiled_truth WHERE project_id = $1',
      [expected.projectId],
    );
    expect(persisted.rows).toHaveLength(0);
  });

  it('resolves a real inference COMMIT acknowledgement loss without recomputing accepted as suppressed', async () => {
    const ackLoss = createCommitAckLossPool(pool!, 'after-commit');
    const repository = new PostgresCompiledTruthRepository(ackLoss.pool);

    await expect(repository.saveInferences('project-stage10', [inference])).resolves.toEqual({
      accepted: [inference],
      suppressedFingerprints: [],
    });
    expect(ackLoss.delegatedCommitCount()).toBe(1);
    expect(ackLoss.commands.filter((command) => command === 'ROLLBACK')).toHaveLength(0);

    const persisted = await pool!.query<{
      project_id: string;
      fingerprint: string;
      candidate_id: string;
      candidate: DerivedInferenceCandidate;
      created_at: Date;
    }>(
      `SELECT project_id, fingerprint, candidate_id, candidate, created_at
       FROM projection.discovery_inferences WHERE project_id = $1`,
      ['project-stage10'],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      project_id: 'project-stage10',
      fingerprint: inference.fingerprint,
      candidate_id: inference.candidateId,
      candidate: inference,
    });
    expect(persisted.rows[0]!.created_at.toISOString()).toBe(inference.createdAt);
  });

  it('preserves a real mixed accepted/suppressed inference batch after COMMIT acknowledgement loss', async () => {
    const existingRepository = new PostgresCompiledTruthRepository(pool!);
    await existingRepository.saveInferences('project-stage10', [inference]);
    const newInference: DerivedInferenceCandidate = {
      ...inference,
      candidateId: 'inference:stage10-new',
      fingerprint: `sha256:${'8'.repeat(64)}`,
      question: 'What approved relationship is missing for New?',
      createdAt: '2026-07-17T10:02:00.000Z',
    };
    const ackLoss = createCommitAckLossPool(pool!, 'after-commit');
    const repository = new PostgresCompiledTruthRepository(ackLoss.pool);

    await expect(
      repository.saveInferences('project-stage10', [inference, newInference]),
    ).resolves.toEqual({
      accepted: [newInference],
      suppressedFingerprints: [inference.fingerprint],
    });
    expect(ackLoss.delegatedCommitCount()).toBe(1);
    expect(ackLoss.commands.filter((command) => command === 'ROLLBACK')).toHaveLength(0);

    const count = await pool!.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM projection.discovery_inferences WHERE project_id = $1',
      ['project-stage10'],
    );
    expect(count.rows[0]!.count).toBe(2);
    const persisted = await pool!.query<{ fingerprint: string; candidate_id: string }>(
      `SELECT fingerprint, candidate_id
       FROM projection.discovery_inferences WHERE project_id = $1 ORDER BY candidate_id`,
      ['project-stage10'],
    );
    expect(persisted.rows).toEqual([
      { fingerprint: inference.fingerprint, candidate_id: inference.candidateId },
      { fingerprint: newInference.fingerprint, candidate_id: newInference.candidateId },
    ]);
  });

  it('keeps an unresolved real inference COMMIT outcome unknown after discarding the transaction connection', async () => {
    const candidate: DerivedInferenceCandidate = {
      ...inference,
      candidateId: 'inference:stage10-unknown',
      fingerprint: `sha256:${'9'.repeat(64)}`,
    };
    const unresolved = createCommitAckLossPool(pool!, 'before-commit');
    const repository = new PostgresCompiledTruthRepository(unresolved.pool);

    await expect(repository.saveInferences('project-stage10', [candidate])).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(unresolved.delegatedCommitCount()).toBe(0);
    expect(unresolved.connectionDiscarded()).toBe(true);
    expect(unresolved.commands.filter((command) => command === 'ROLLBACK')).toHaveLength(0);

    const persisted = await pool!.query(
      `SELECT 1 FROM projection.discovery_inferences
       WHERE project_id = $1 AND fingerprint = $2`,
      ['project-stage10', candidate.fingerprint],
    );
    expect(persisted.rows).toHaveLength(0);
  });

  it('serves the persisted projection through the Stage 10 read snapshot handler', async () => {
    const repository = new PostgresCompiledTruthRepository(pool!);
    const groups = { items: [approvedGroup('project-stage10', 'group:stage10')] };
    const canonical: CanonicalSnapshot = {
      snapshotId: 'snapshot-stage10',
      projectId: 'project-stage10',
      version: 3,
      digest: `sha256:${'4'.repeat(64)}`,
      claims: [],
      createdAt: '2026-07-17T10:00:00.000Z',
    };
    const module = createCompiledTruthModule(repository);
    const buildHandler = module.handlers.commands.find(
      (candidate) => candidate.messageType === 'BuildCompiledTruth',
    );
    const handler = module.handlers.queries.find(
      (candidate) => candidate.messageType === 'GetCompiledTruthReadSnapshot',
    );
    expect(buildHandler).toBeDefined();
    expect(handler).toBeDefined();
    const context: HandlerContext = {
      moduleId: module.manifest.id,
      attemptNumber: 1,
      signal: new AbortController().signal,
      publish: async () => undefined,
      query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
        const payload =
          input.messageType === 'GetCanonicalSnapshot'
            ? canonical
            : input.messageType === 'ListKnowledgeGroups'
              ? groups
              : undefined;
        if (payload === undefined) throw new Error(`Unexpected query ${input.messageType}`);
        return { payload } as QueryResultEnvelope<TResult>;
      },
    };
    await buildHandler!.handle(
      createCommand({
        messageType: 'BuildCompiledTruth',
        schemaVersion: '1.0.0',
        producerModule: 'stage10-database-test',
        producerVersion: '1.0.0',
        idempotencyKey: 'stage10-database-build-ready',
        projectId: 'project-stage10',
        actor: { type: 'user', id: 'owner-stage10' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'private',
          dataClassification: 'personal',
        },
        payload: { mode: 'FULL_REBUILD' },
      }),
      context,
    );
    const query = createQuery({
      messageType: 'GetCompiledTruthReadSnapshot',
      schemaVersion: '1.0.0',
      producerModule: 'stage10-database-test',
      producerVersion: '1.0.0',
      projectId: 'project-stage10',
      actor: { type: 'user', id: 'owner-stage10' },
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'personal',
      },
      payload: { schemaVersion: '1.0.0' },
    });
    const result = await handler!.handle(query, context);
    expect(result).toMatchObject({
      projectId: 'project-stage10',
      status: { status: 'READY', projectedCanonicalVersion: 3 },
      projection: { projectId: 'project-stage10', items: [{ id: 'entity:isolated' }] },
    });
  });

  it('keeps a persisted projection visible as STALE when the current source snapshot changes', async () => {
    const repository = new PostgresCompiledTruthRepository(pool!);
    const groups = { items: [approvedGroup('project-stage10', 'group:stage10-stale')] };
    const canonical: CanonicalSnapshot = {
      snapshotId: 'snapshot-stage10-stale',
      projectId: 'project-stage10',
      version: 3,
      digest: `sha256:${'5'.repeat(64)}`,
      claims: [],
      createdAt: '2026-07-17T10:00:00.000Z',
    };
    const module = createCompiledTruthModule(repository);
    const buildHandler = module.handlers.commands.find(
      (candidate) => candidate.messageType === 'BuildCompiledTruth',
    );
    const handler = module.handlers.queries.find(
      (candidate) => candidate.messageType === 'GetCompiledTruthReadSnapshot',
    );
    expect(buildHandler).toBeDefined();
    expect(handler).toBeDefined();
    const context: HandlerContext = {
      moduleId: module.manifest.id,
      attemptNumber: 1,
      signal: new AbortController().signal,
      publish: async () => undefined,
      query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
        const payload =
          input.messageType === 'GetCanonicalSnapshot'
            ? canonical
            : input.messageType === 'ListKnowledgeGroups'
              ? groups
              : undefined;
        if (payload === undefined) throw new Error(`Unexpected query ${input.messageType}`);
        return { payload } as QueryResultEnvelope<TResult>;
      },
    };
    const build = (await buildHandler!.handle(
      createCommand({
        messageType: 'BuildCompiledTruth',
        schemaVersion: '1.0.0',
        producerModule: 'stage10-database-test',
        producerVersion: '1.0.0',
        idempotencyKey: 'stage10-database-build-stale',
        projectId: 'project-stage10',
        actor: { type: 'user', id: 'owner-stage10' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'private',
          dataClassification: 'personal',
        },
        payload: { mode: 'FULL_REBUILD' },
      }),
      context,
    )) as CompiledTruthProjection;
    await repository.synchronize({
      ...build,
      sourceSnapshotDigest: `sha256:${'6'.repeat(64)}`,
    });
    const result = await handler!.handle(
      createQuery({
        messageType: 'GetCompiledTruthReadSnapshot',
        schemaVersion: '1.0.0',
        producerModule: 'stage10-database-test',
        producerVersion: '1.0.0',
        projectId: 'project-stage10',
        actor: { type: 'user', id: 'owner-stage10' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'private',
          dataClassification: 'personal',
        },
        payload: { schemaVersion: '1.0.0' },
      }),
      context,
    );
    expect(result).toMatchObject({
      projectId: 'project-stage10',
      status: { status: 'STALE', projectedCanonicalVersion: 3 },
      projection: { projectId: 'project-stage10', items: [{ id: 'entity:isolated' }] },
    });
  });
});
