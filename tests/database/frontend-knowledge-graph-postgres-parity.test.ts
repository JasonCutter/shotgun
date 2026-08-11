import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import { PostgresFrontendKnowledgeGraphStores } from '../../adapters/frontend-knowledge-graph-postgres/src/index.js';
import type { HealthStorePort } from '../../modules/frontend-knowledge-graph/src/index.js';
import type { SnapshotContextStorePort } from '../../modules/frontend-knowledge-graph/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const descriptor = (snapshotId: string) => ({
  snapshotId,
  projectId: 'project-1',
  viewKind: 'KNOWLEDGE_SEMANTIC' as const,
  overlayKinds: [] as const,
  rootRefs: [],
  normalizedFilters: { schemaVersion: '1.0.0' as const },
  filtersDigest: `sha256:${snapshotId}`,
  limits: {
    schemaVersion: '1.0.0' as const,
    maxDepth: 3,
    maxNodes: 100,
    maxEdges: 200,
    traversalBudget: 1000,
    serverTimeoutBudgetMs: 5000,
  },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'proj-1',
  generatedAt: '2026-08-04T08:00:00.000Z',
  expiresAt: '2026-08-04T08:15:00.000Z',
});

const continuation = (token: string) => ({
  token,
  expiresAt: '2026-08-04T08:10:00.000Z',
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  snapshotId: 'snapshot-1',
  rootRef: undefined,
  filtersDigest: 'sha256:filters',
  viewKind: 'KNOWLEDGE_SEMANTIC' as const,
  overlayKinds: [] as const,
  limits: {
    schemaVersion: '1.0.0' as const,
    maxDepth: 3,
    maxNodes: 100,
    maxEdges: 200,
    traversalBudget: 1000,
    serverTimeoutBudgetMs: 5000,
  },
});

const runScenario = async (
  snapshotStore: SnapshotContextStorePort,
  healthStore: HealthStorePort,
): Promise<{
  resolvedSnapshot: string | undefined;
  projectionStatus: string | undefined;
  overlayKind: string | undefined;
  continuationToken: string | undefined;
}> => {
  await snapshotStore.write(descriptor('snapshot-1'));
  const resolved = await snapshotStore.resolve('project-1', 'snapshot-1');
  await healthStore.upsertProjectionHealth({
    projectId: 'project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'proj-1',
    status: 'COMPLETE',
    generatedAt: '2026-08-04T08:00:00.000Z',
    lag: 0,
    rebuildState: 'IDLE',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
  });
  const projection = await healthStore.getProjectionHealth('project-1', 'KNOWLEDGE_SEMANTIC');
  await healthStore.upsertOverlayHealth({
    projectId: 'project-1',
    baseSnapshotId: 'snapshot-1',
    overlayKind: 'CONFLICT',
    overlaySnapshotId: 'overlay-1',
    overlayRevision: 'overlay-rev-1',
    analyzerRevision: 'analyzer-1',
    policyContextRevision: 'policy-1',
    generatedAt: '2026-08-04T08:00:00.000Z',
    completeness: 'COMPLETE',
  });
  const overlay = await healthStore.getOverlayHealth('project-1', 'snapshot-1', 'CONFLICT');
  await healthStore.writeContinuation(continuation('token-1'));
  const continuationRecord = await healthStore.findContinuation('token-1');
  await healthStore.deleteContinuation('token-1');
  const deleted = await healthStore.findContinuation('token-1');
  return {
    resolvedSnapshot: resolved?.snapshotId,
    projectionStatus: projection?.status,
    overlayKind: overlay?.overlayKind,
    continuationToken: deleted === undefined ? continuationRecord?.token : undefined,
  };
};

describe.runIf(pool)('FE-P3-S3 in-memory vs PostgreSQL graph store parity', () => {
  beforeEach(async () => {
    await pool!.query(
      `TRUNCATE frontend_knowledge_graph.snapshot_context,
                frontend_knowledge_graph.projection_health,
                frontend_knowledge_graph.overlay_health,
                frontend_knowledge_graph.continuation
       CASCADE`,
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('produces identical results across the four storage boundaries', async () => {
    const inMemorySnapshot = createInMemorySnapshotContextStore();
    const inMemoryHealth = createInMemoryHealthStore();
    const postgresStores = new PostgresFrontendKnowledgeGraphStores(pool!);

    const memoryResult = await runScenario(inMemorySnapshot, inMemoryHealth);
    const postgresResult = await runScenario(postgresStores, postgresStores);

    expect(postgresResult).toEqual(memoryResult);
    expect(postgresResult.resolvedSnapshot).toBe('snapshot-1');
    expect(postgresResult.projectionStatus).toBe('COMPLETE');
    expect(postgresResult.overlayKind).toBe('CONFLICT');
    expect(postgresResult.continuationToken).toBe('token-1');
  });

  it('rejects a duplicate immutable snapshot context write', async () => {
    const inMemorySnapshot = createInMemorySnapshotContextStore();
    const postgresStores = new PostgresFrontendKnowledgeGraphStores(pool!);
    for (const store of [inMemorySnapshot, postgresStores]) {
      await store.write(descriptor('snapshot-1'));
      await expect(store.write(descriptor('snapshot-1'))).rejects.toThrow();
    }
  });
});
