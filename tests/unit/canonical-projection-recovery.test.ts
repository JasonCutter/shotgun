import { describe, expect, it } from 'vitest';

import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import {
  type CanonicalProjectionRecoveryConnector,
  runCanonicalProjectionRecovery,
  startCanonicalProjectionRecoveryWorker,
} from '../../assemblies/shotgun-app/src/server.js';
import type {
  CompiledTruthProjectionStatus,
  ProjectionReadiness,
} from '../../packages/contracts/src/index.js';
import type { createCommand, createQuery } from '../../packages/kernel/src/index.js';

const readySearch = (): ProjectionReadiness => ({
  status: 'READY',
  projectedCanonicalVersion: 1,
  canonicalVersion: 1,
  lag: 0,
  projectedSnapshotDigest: `sha256:${'1'.repeat(64)}`,
  canonicalSnapshotDigest: `sha256:${'1'.repeat(64)}`,
  updatedAt: '2026-07-21T00:00:00.000Z',
});

const staleSearch = (): ProjectionReadiness => ({
  status: 'STALE',
  projectedCanonicalVersion: 0,
  canonicalVersion: 1,
  lag: 1,
  canonicalSnapshotDigest: `sha256:${'1'.repeat(64)}`,
  reason: 'Projection is missing.',
});

const readyCompiled = (): CompiledTruthProjectionStatus => ({
  status: 'READY',
  projectorVersion: '1.0.0',
  canonicalVersion: 1,
  projectedCanonicalVersion: 1,
  lag: 0,
  sourceSnapshotDigest: `sha256:${'2'.repeat(64)}`,
  logicalDigest: `sha256:${'3'.repeat(64)}`,
  lastBuildMode: 'FULL_REBUILD',
  updatedAt: '2026-07-21T00:00:00.000Z',
});

const missingCompiled = (): CompiledTruthProjectionStatus => ({
  status: 'NOT_BUILT',
  projectorVersion: '1.0.0',
  canonicalVersion: 1,
  projectedCanonicalVersion: 0,
  lag: 1,
});

describe('Canonical Projection recovery coordinator', () => {
  it('drains bounded Outbox batches, rebuilds stale projections and isolates project failure', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    repository.listProjectIds = async () => ['project-ready', 'project-failed'];
    let dispatches = 0;
    let searchRebuilt = false;
    let compiledRebuilt = false;
    const connector: CanonicalProjectionRecoveryConnector = {
      async sendCommand<TResult>(command: ReturnType<typeof createCommand>) {
        if (command.projectId === 'project-failed') {
          throw new Error('Project database unavailable.');
        }
        if (command.messageType === 'DispatchCanonicalOutbox') {
          dispatches += 1;
          return { result: { published: dispatches === 1 ? 2 : 0 } as TResult };
        }
        if (command.messageType === 'RebuildSearchProjection') searchRebuilt = true;
        if (command.messageType === 'BuildCompiledTruth') compiledRebuilt = true;
        return { result: {} as TResult };
      },
      async query<TResult>(query: ReturnType<typeof createQuery>) {
        const payload =
          query.messageType === 'GetProjectionReadiness'
            ? searchRebuilt
              ? readySearch()
              : staleSearch()
            : compiledRebuilt
              ? readyCompiled()
              : missingCompiled();
        return { result: { payload: payload as TResult } };
      },
    };

    const result = await runCanonicalProjectionRecovery(repository, connector, {
      batchSize: 2,
      maxBatchesPerProject: 3,
    });

    expect(result).toEqual({
      projects: [
        {
          projectId: 'project-ready',
          status: 'READY',
          outboxPublished: 2,
          searchRebuilt: true,
          compiledTruthRebuilt: true,
        },
        {
          projectId: 'project-failed',
          status: 'FAILED',
          outboxPublished: 0,
          searchRebuilt: false,
          compiledTruthRebuilt: false,
          error: 'Project database unavailable.',
        },
      ],
      ready: 1,
      failed: 1,
    });
  });

  it('prevents overlapping worker runs and stops future ticks', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.listProjectIds = async () => {
      calls += 1;
      await blocked;
      return [];
    };
    const connector: CanonicalProjectionRecoveryConnector = {
      async sendCommand<TResult>() {
        return { result: {} as TResult };
      },
      async query<TResult>() {
        return { result: { payload: {} as TResult } };
      },
    };
    const worker = startCanonicalProjectionRecoveryWorker(repository, connector, 60_000);

    const first = worker.tick();
    const overlapping = worker.tick();
    expect(calls).toBe(1);
    let stopped = false;
    const stop = worker.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([first, overlapping, stop]);
    expect(stopped).toBe(true);
    await worker.tick();
    expect(calls).toBe(1);
  });

  it('rejects invalid recovery bounds before starting work', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    const connector: CanonicalProjectionRecoveryConnector = {
      async sendCommand<TResult>() {
        return { result: {} as TResult };
      },
      async query<TResult>() {
        return { result: { payload: {} as TResult } };
      },
    };

    await expect(
      runCanonicalProjectionRecovery(repository, connector, { batchSize: 0 }),
    ).rejects.toThrow('batchSize must be a positive integer');
    expect(() => startCanonicalProjectionRecoveryWorker(repository, connector, 0)).toThrow(
      'interval must be at least one millisecond',
    );
  });
});
