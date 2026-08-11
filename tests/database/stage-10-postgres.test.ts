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
