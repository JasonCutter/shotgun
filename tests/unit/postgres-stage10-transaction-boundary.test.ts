import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import {
  approvedKnowledgeDigest,
  approvedKnowledgeSourceIdentity,
  compiledTruthLogicalDigest,
  semanticCorpusSourceSnapshotDigest,
  ShotgunError,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  type DerivedInferenceCandidate,
  type DiscoveryRunResult,
  type KnowledgeReviewGroup,
} from '../../packages/contracts/src/index.js';
import {
  createCompiledTruthModule,
  type CompiledTruthRepositoryPort,
} from '../../modules/compiled-truth/src/index.js';
import type { HandlerContext } from '../../packages/module-sdk/src/index.js';
import { directTextCommand } from '../helpers/stage-3.js';
import { buildCompiledTruthCommand, runDiscoveryCommand } from '../helpers/stage-10.js';
import { entityCandidate } from '../helpers/stage-9.js';

const result = <T extends QueryResultRow>(rows: readonly T[] = []): QueryResult<T> => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  rows: [...rows],
  fields: [],
});

type FakeOptions = {
  readonly projectionReadback?: CompiledTruthProjection;
  readonly persistProjectionOnWrite?: boolean;
  readonly inferenceReadback?: readonly DerivedInferenceCandidate[];
  readonly persistInferenceOnWrite?: boolean;
  readonly commit: 'success' | 'ack-loss';
  readonly failOnCompiledTruthWrite?: boolean;
  readonly failOnInferenceWrite?: boolean;
};

type FakePostgres = {
  readonly pool: Pool;
  readonly calls: string[];
  readonly poolQueries: string[];
  readonly projectionReadback?: CompiledTruthProjection;
  readonly inferenceRows: Map<string, DerivedInferenceCandidate>;
};

const projectionRow = (projection: CompiledTruthProjection): QueryResultRow => ({
  project_id: projection.projectId,
  projector_version: projection.projectorVersion,
  source_snapshot_digest: projection.sourceSnapshotDigest,
  logical_digest: projection.logicalDigest,
  canonical_version: projection.canonicalVersion,
  build_mode: projection.buildMode,
  projection,
  status: 'READY',
  last_error: null,
  updated_at: new Date(projection.projectedAt),
});

const createFakePostgres = (options: FakeOptions): FakePostgres => {
  const calls: string[] = [];
  const poolQueries: string[] = [];
  const inferenceRows = new Map(
    (options.inferenceReadback ?? []).map((candidate) => [candidate.fingerprint, candidate]),
  );
  let projectionReadback = options.projectionReadback;
  const client = {
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return result<T>();
      if (sql === 'COMMIT') {
        if (options.commit === 'ack-loss') throw new Error('simulated lost COMMIT acknowledgement');
        return result<T>();
      }
      if (sql.includes('INSERT INTO projection.compiled_truth')) {
        if (options.failOnCompiledTruthWrite)
          throw new Error('deterministic compiled truth failure');
        const projection = JSON.parse(String(values?.[6])) as CompiledTruthProjection;
        if (options.persistProjectionOnWrite) projectionReadback = projection;
        return result<T>([{ projection } as unknown as T]);
      }
      if (sql.includes('INSERT INTO projection.discovery_inferences')) {
        if (options.failOnInferenceWrite) throw new Error('deterministic inference failure');
        const candidate = JSON.parse(String(values?.[3])) as DerivedInferenceCandidate;
        if (inferenceRows.has(candidate.fingerprint)) return result<T>();
        if (options.persistInferenceOnWrite) inferenceRows.set(candidate.fingerprint, candidate);
        return result<T>([{ fingerprint: candidate.fingerprint } as unknown as T]);
      }
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release: () => undefined,
  };
  const pool = {
    connect: async (): Promise<PoolClient> => client as unknown as PoolClient,
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => {
      poolQueries.push(sql);
      if (sql.includes('FROM projection.compiled_truth')) {
        return result<T>(projectionReadback ? [projectionRow(projectionReadback) as T] : []);
      }
      if (sql.includes('FROM projection.discovery_inferences') && sql.includes('ANY')) {
        const fingerprints = (values?.[1] as readonly string[]) ?? [];
        return result<T>(
          fingerprints
            .map((fingerprint) => inferenceRows.get(fingerprint))
            .filter((candidate): candidate is DerivedInferenceCandidate => candidate !== undefined)
            .map(
              (candidate) =>
                ({
                  project_id: values?.[0],
                  fingerprint: candidate.fingerprint,
                  candidate_id: candidate.candidateId,
                  candidate,
                  created_at: new Date(candidate.createdAt),
                }) as unknown as T,
            ),
        );
      }
      if (sql.includes('FROM projection.discovery_inferences')) {
        return result<T>(
          [...inferenceRows.values()].map((candidate) => ({ candidate }) as unknown as T),
        );
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  return {
    pool: pool as unknown as Pool,
    calls,
    poolQueries,
    projectionReadback,
    inferenceRows,
  };
};

const fixtureProjection = (
  projectId = `stage10-unit-${randomUUID()}`,
): CompiledTruthProjection => ({
  projectId,
  projectorVersion: '1.0.0',
  sourceSnapshotDigest: `sha256:${'1'.repeat(64)}`,
  logicalDigest: `sha256:${'2'.repeat(64)}`,
  canonicalVersion: 3,
  items: [],
  graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
  projectedAt: '2026-09-15T00:00:00.000Z',
  buildMode: 'FULL_REBUILD',
});

const fixtureCandidate = (suffix: string): DerivedInferenceCandidate => ({
  candidateId: `inference:${suffix}`,
  fingerprint: `sha256:${suffix.repeat(64).slice(0, 64)}`,
  status: 'DERIVED_INFERENCE',
  candidateType: 'KNOWLEDGE_GAP',
  question: `What is missing for ${suffix}?`,
  relatedNodeIds: [`entity:${suffix}`],
  evidenceIds: [`evidence:${suffix}`],
  sourceProjectionDigest: `sha256:${'2'.repeat(64)}`,
  reentryPhase: 'VALIDATION',
  createdAt: '2026-09-15T00:01:00.000Z',
});

describe('Postgres Stage 10 transaction boundary', () => {
  it('keeps Compiled Truth READY when COMMIT succeeds but its acknowledgement is lost', async () => {
    const expected = fixtureProjection();
    const fake = createFakePostgres({
      commit: 'ack-loss',
      projectionReadback: expected,
    });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(repository.synchronize(expected)).resolves.toEqual(expected);
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
    expect(fake.poolQueries.some((query) => query.includes('FROM projection.compiled_truth'))).toBe(
      true,
    );
  });

  it('preserves unresolved Compiled Truth COMMIT ambiguity without manufacturing READY', async () => {
    const expected = fixtureProjection();
    const fake = createFakePostgres({ commit: 'ack-loss' });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(repository.synchronize(expected)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      module: 'postgres-stage10',
      operation: 'synchronize-compiled-truth',
    });
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
  });

  it('rolls back deterministic Compiled Truth failures before COMMIT', async () => {
    const fake = createFakePostgres({
      commit: 'success',
      failOnCompiledTruthWrite: true,
    });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(repository.synchronize(fixtureProjection())).rejects.toThrow(
      'deterministic compiled truth failure',
    );
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(0);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(1);
  });

  it('returns the original accepted result after an inference COMMIT acknowledgement loss', async () => {
    const candidate = fixtureCandidate('accepted');
    const fake = createFakePostgres({
      commit: 'ack-loss',
      persistInferenceOnWrite: true,
    });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(repository.saveInferences('project-stage10', [candidate])).resolves.toEqual({
      accepted: [candidate],
      suppressedFingerprints: [],
    });
    expect(fake.inferenceRows.size).toBe(1);
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
    expect(fake.poolQueries.some((query) => query.includes('ANY'))).toBe(true);
  });

  it('preserves mixed accepted/suppressed results and only treats the new row as accepted', async () => {
    const existing = fixtureCandidate('existing');
    const accepted = fixtureCandidate('new');
    const fake = createFakePostgres({
      commit: 'ack-loss',
      inferenceReadback: [existing],
      persistInferenceOnWrite: true,
    });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(
      repository.saveInferences('project-stage10', [existing, accepted]),
    ).resolves.toEqual({
      accepted: [accepted],
      suppressedFingerprints: [existing.fingerprint],
    });
    expect(fake.inferenceRows.size).toBe(2);
  });

  it('keeps unresolved inference COMMIT ambiguity and emits no recoverable result', async () => {
    const candidate = fixtureCandidate('unknown');
    const fake = createFakePostgres({ commit: 'ack-loss' });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(repository.saveInferences('project-stage10', [candidate])).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      module: 'postgres-stage10',
      operation: 'save-discovery-inferences',
    });
    expect(fake.inferenceRows.size).toBe(0);
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(1);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(0);
  });

  it('rolls back deterministic inference failures before COMMIT', async () => {
    const fake = createFakePostgres({
      commit: 'success',
      failOnInferenceWrite: true,
    });
    const repository = new PostgresCompiledTruthRepository(fake.pool);

    await expect(
      repository.saveInferences('project-stage10', [fixtureCandidate('failure')]),
    ).rejects.toThrow('deterministic inference failure');
    expect(fake.calls.filter((call) => call === 'COMMIT')).toHaveLength(0);
    expect(fake.calls.filter((call) => call === 'ROLLBACK')).toHaveLength(1);
  });
});

const canonicalFixture = (projectId: string): CanonicalSnapshot => ({
  snapshotId: `snapshot:${projectId}`,
  projectId,
  version: 0,
  digest: `sha256:${'4'.repeat(64)}`,
  claims: [],
  createdAt: '2026-09-15T00:00:00.000Z',
});

const groupFixture = (projectId: string): KnowledgeReviewGroup => ({
  groupId: `group:${projectId}`,
  projectId,
  sourceVersionId: 'source:stage10',
  revisionNumber: 1,
  status: 'APPROVED',
  contentDigest: `sha256:${'5'.repeat(64)}`,
  items: [entityCandidate('entity:isolated', 'source:stage10', 'evidence:stage10', 'Isolated')],
  decisions: [],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
});

const readyProjectionForDiscovery = (
  canonical: CanonicalSnapshot,
  group: KnowledgeReviewGroup,
): CompiledTruthProjection => {
  const candidate = group.items[0]!;
  const item = {
    id: candidate.candidateId,
    type: 'ENTITY' as const,
    revisionNumber: candidate.revisionNumber,
    sourceVersionId: candidate.sourceVersionId,
    label: 'name' in candidate ? candidate.name : candidate.candidateId,
    state: 'CURRENT' as const,
    source: 'APPROVED_KNOWLEDGE' as const,
    evidenceIds: [...candidate.evidenceIds],
    accessScope: [...group.accessScope],
    sensitivity: group.sensitivity,
  };
  const sourceSnapshotDigest = semanticCorpusSourceSnapshotDigest({
    projectId: canonical.projectId,
    canonicalVersion: canonical.version,
    canonicalSnapshotDigest: canonical.digest,
    approvedKnowledgeDigest: approvedKnowledgeDigest([approvedKnowledgeSourceIdentity(group)]),
  });
  return {
    projectId: canonical.projectId,
    projectorVersion: '1.0.0',
    sourceSnapshotDigest,
    logicalDigest: compiledTruthLogicalDigest([item], []),
    canonicalVersion: canonical.version,
    items: [item],
    graph: { nodes: [item], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
    projectedAt: '2026-09-15T00:00:00.000Z',
    buildMode: 'FULL_REBUILD',
  };
};

const handlerContext = (
  moduleId: string,
  canonical: CanonicalSnapshot,
  group: KnowledgeReviewGroup | undefined,
  publish: HandlerContext['publish'],
): HandlerContext =>
  ({
    moduleId,
    attemptNumber: 1,
    publish,
    query: async (input: { messageType: string }) => {
      if (input.messageType === 'GetCanonicalSnapshot') return { payload: canonical };
      if (input.messageType === 'ListKnowledgeGroups') {
        return { payload: { items: group ? [group] : [] } };
      }
      throw new Error(`Unexpected query ${input.messageType}`);
    },
  }) as unknown as HandlerContext;

describe('Stage 10 handler ambiguity boundaries', () => {
  it('does not mark Compiled Truth degraded for OUTCOME_UNKNOWN', async () => {
    const parent = directTextCommand('stage10-ct-unknown', 'Compiled Truth ambiguity.');
    const markDegraded = vi.fn(async () => undefined);
    const repository: CompiledTruthRepositoryPort = {
      synchronize: vi.fn(async () => {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'Projection outcome is ambiguous.',
          module: 'postgres-stage10',
          operation: 'synchronize-compiled-truth',
        });
      }),
      findProjection: vi.fn(async () => undefined),
      markDegraded,
      degradedState: vi.fn(async () => undefined),
      saveInferences: vi.fn(async () => ({ accepted: [], suppressedFingerprints: [] })),
      listInferences: vi.fn(async () => []),
    };
    const module = createCompiledTruthModule(repository, {
      now: () => '2026-09-15T00:01:00.000Z',
    });
    const handler = module.handlers.commands.find(
      (candidate) => candidate.messageType === 'BuildCompiledTruth',
    )!;
    const context = handlerContext(
      module.manifest.id,
      canonicalFixture(parent.projectId!),
      undefined,
      vi.fn(async () => undefined),
    );

    await expect(
      handler.handle(buildCompiledTruthCommand(parent, 'FULL_REBUILD'), context),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(markDegraded).not.toHaveBeenCalled();
  });

  it('publishes DerivedInferenceReady exactly for accepted candidates after persistence succeeds', async () => {
    const parent = directTextCommand('stage10-discovery-accepted', 'Discovery ambiguity.');
    const canonical = canonicalFixture(parent.projectId!);
    const group = groupFixture(parent.projectId!);
    const projection = readyProjectionForDiscovery(canonical, group);
    const publish = vi.fn(async () => undefined);
    const repository: CompiledTruthRepositoryPort = {
      synchronize: vi.fn(async () => projection),
      findProjection: vi.fn(async () => projection),
      markDegraded: vi.fn(async () => undefined),
      degradedState: vi.fn(async () => undefined),
      saveInferences: vi.fn(async (_projectId, candidates) => ({
        accepted: candidates,
        suppressedFingerprints: [],
      })),
      listInferences: vi.fn(async () => []),
    };
    const module = createCompiledTruthModule(repository);
    const handler = module.handlers.commands.find(
      (candidate) => candidate.messageType === 'RunKnowledgeDiscovery',
    )!;
    const context = handlerContext(module.manifest.id, canonical, group, publish);

    const result = (await handler.handle(
      runDiscoveryCommand(parent, 'INCREMENTAL', 'accepted', 1, 1),
      context,
    )) as DiscoveryRunResult;
    expect(result.generated).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'DerivedInferenceReady',
        idempotencyKey: result.generated[0]!.fingerprint,
        payload: result.generated[0],
      }),
    );
  });

  it('does not publish DerivedInferenceReady when inference persistence remains unknown', async () => {
    const parent = directTextCommand('stage10-discovery-unknown', 'Discovery ambiguity.');
    const canonical = canonicalFixture(parent.projectId!);
    const group = groupFixture(parent.projectId!);
    const projection = readyProjectionForDiscovery(canonical, group);
    const publish = vi.fn(async () => undefined);
    const repository: CompiledTruthRepositoryPort = {
      synchronize: vi.fn(async () => projection),
      findProjection: vi.fn(async () => projection),
      markDegraded: vi.fn(async () => undefined),
      degradedState: vi.fn(async () => undefined),
      saveInferences: vi.fn(async () => {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'Inference persistence outcome is ambiguous.',
          module: 'postgres-stage10',
          operation: 'save-discovery-inferences',
        });
      }),
      listInferences: vi.fn(async () => []),
    };
    const module = createCompiledTruthModule(repository);
    const handler = module.handlers.commands.find(
      (candidate) => candidate.messageType === 'RunKnowledgeDiscovery',
    )!;
    const context = handlerContext(module.manifest.id, canonical, group, publish);

    await expect(
      handler.handle(runDiscoveryCommand(parent, 'INCREMENTAL', 'unknown', 1, 1), context),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(publish).not.toHaveBeenCalled();
  });
});
