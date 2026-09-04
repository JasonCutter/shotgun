import { describe, expect, it } from 'vitest';

import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import {
  createApplication,
  InMemoryCanonicalProjectionRecoveryReporter,
  RECOVERY_RUNNER_IDS,
  type CanonicalProjectionRecoveryConnector,
  runCanonicalProjectionRecovery,
  runCanonicalProjectionRecoveryWithReport,
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
    let releaseReport!: () => void;
    const reportBlocked = new Promise<void>((resolve) => {
      releaseReport = resolve;
    });
    const reporter = {
      async report() {
        await reportBlocked;
      },
    };
    const worker = startCanonicalProjectionRecoveryWorker(repository, connector, 60_000, reporter);

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
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseReport();
    await Promise.all([first, overlapping, stop]);
    expect(stopped).toBe(true);
    await worker.tick();
    expect(calls).toBe(1);
  });

  it('reports a safe startup result while preserving per-project failure isolation', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    repository.listProjectIds = async () => ['project-a', 'project-b'];
    const reporter = new InMemoryCanonicalProjectionRecoveryReporter();
    const connector: CanonicalProjectionRecoveryConnector = {
      async sendCommand<TResult>(command: ReturnType<typeof createCommand>) {
        if (command.projectId === 'project-b') {
          throw new Error('postgres://private-host/canonical payload must not be reported');
        }
        return { result: { published: 0 } as TResult };
      },
      async query<TResult>(query: ReturnType<typeof createQuery>) {
        const payload =
          query.messageType === 'GetProjectionReadiness' ? readySearch() : readyCompiled();
        return { result: { payload: payload as TResult } };
      },
    };

    const report = await runCanonicalProjectionRecoveryWithReport(
      repository,
      connector,
      'STARTUP',
      reporter,
    );

    expect(report).toMatchObject({
      trigger: 'STARTUP',
      runStatus: 'COMPLETED',
      result: {
        ready: 1,
        failed: 1,
        projects: [
          { projectId: 'project-a', status: 'READY' },
          { projectId: 'project-b', status: 'FAILED', failureCode: 'RECOVERY_FAILED' },
        ],
      },
    });
    expect(JSON.stringify(report)).not.toContain('postgres://');
    expect(reporter.latest()).toEqual(report);
  });

  it('keeps application startup available while recording the latest safe startup report', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    repository.listProjectIds = async () => ['project-a', 'project-b'];
    const claimOutbox = repository.claimOutbox.bind(repository);
    repository.claimOutbox = async (...args) => {
      if (args[0] === 'project-b') {
        throw new Error('DATABASE_URL=postgres://private-host/canonical payload');
      }
      return claimOutbox(...args);
    };
    const reporter = new InMemoryCanonicalProjectionRecoveryReporter();

    const app = await createApplication({
      canonicalKnowledgeRepository: repository,
      canonicalProjectionRecoveryReporter: reporter,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    expect(app.state.canonicalProjectionRecovery.latest()).toMatchObject({
      trigger: 'STARTUP',
      runStatus: 'COMPLETED',
      result: {
        ready: 1,
        failed: 1,
        projects: [
          { projectId: 'project-a', status: 'READY' },
          { projectId: 'project-b', status: 'FAILED', failureCode: 'RECOVERY_FAILED' },
        ],
      },
    });
    const recovery = app.state.recovery.get(RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION);
    expect(recovery).toMatchObject({
      runnerId: RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION,
      executionStatus: 'COMPLETED',
      outcome: 'DEGRADED',
      freshness: 'CURRENT',
      readinessImpact: 'DEGRADED',
      scannedCount: 2,
      succeededCount: 1,
      retryableCount: 1,
      safeCodes: ['CANONICAL_PROJECTION_RECOVERY_PARTIAL_FAILURE'],
    });
    expect(JSON.stringify(recovery)).not.toContain('project-a');
    expect(JSON.stringify(recovery)).not.toContain('project-b');
    expect(JSON.stringify(reporter.latest())).not.toContain('postgres://');
    await app.server.close();
  });

  it('retains one canonical runner identity across periodic degradation and recovery', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    repository.listProjectIds = async () => ['project-a'];
    let fail = true;
    const claimOutbox = repository.claimOutbox.bind(repository);
    repository.claimOutbox = async (...args) => {
      if (fail) throw new Error('project recovery unavailable');
      return claimOutbox(...args);
    };

    const app = await createApplication({
      canonicalKnowledgeRepository: repository,
      canonicalProjectionRecoveryIntervalMs: 60_000,
    });

    const degraded = app.state.recovery.get(RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION);
    expect(degraded).toMatchObject({
      runnerId: RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION,
      executionStatus: 'COMPLETED',
      outcome: 'DEGRADED',
      freshness: 'CURRENT',
      readinessImpact: 'DEGRADED',
    });
    expect(degraded?.lastSuccessAt).toBeUndefined();

    fail = false;
    await app.state.canonicalProjectionRecovery.tick();
    const healthy = app.state.recovery.get(RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION);
    expect(healthy).toMatchObject({
      runnerId: RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION,
      executionStatus: 'COMPLETED',
      outcome: 'HEALTHY',
      freshness: 'CURRENT',
      readinessImpact: 'NONE',
      scannedCount: 1,
      succeededCount: 1,
      retryableCount: 0,
      safeCodes: [],
    });
    expect(healthy?.lastSuccessAt).toBeDefined();
    await app.server.close();
  });

  it('reports periodic retry success and top-level failure without stopping the worker', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    let listFails = true;
    let projectBFails = true;
    repository.listProjectIds = async () => {
      if (listFails) throw new Error('DATABASE_URL=postgres://secret');
      return ['project-a', 'project-b'];
    };
    const reporter = new InMemoryCanonicalProjectionRecoveryReporter();
    const connector: CanonicalProjectionRecoveryConnector = {
      async sendCommand<TResult>(command: ReturnType<typeof createCommand>) {
        if (command.projectId === 'project-b' && projectBFails) {
          throw new Error('project b unavailable');
        }
        return { result: { published: 0 } as TResult };
      },
      async query<TResult>(query: ReturnType<typeof createQuery>) {
        const payload =
          query.messageType === 'GetProjectionReadiness' ? readySearch() : readyCompiled();
        return { result: { payload: payload as TResult } };
      },
    };
    const worker = startCanonicalProjectionRecoveryWorker(repository, connector, 60_000, reporter);

    await worker.tick();
    expect(reporter.latest()).toEqual(
      expect.objectContaining({
        trigger: 'PERIODIC',
        runStatus: 'FAILED',
        safeError: 'CANONICAL_PROJECTION_RECOVERY_FAILED',
      }),
    );
    expect(JSON.stringify(reporter.latest())).not.toContain('postgres://');

    listFails = false;
    await worker.tick();
    expect(reporter.latest()).toMatchObject({
      runStatus: 'COMPLETED',
      result: { ready: 1, failed: 1 },
    });

    projectBFails = false;
    await worker.tick();
    expect(reporter.latest()).toMatchObject({
      runStatus: 'COMPLETED',
      result: { ready: 2, failed: 0 },
    });
    expect(reporter.reports()).toHaveLength(3);
    await worker.stop();
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
