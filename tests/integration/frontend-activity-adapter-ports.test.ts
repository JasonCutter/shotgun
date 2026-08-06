import { describe, expect, it } from 'vitest';

import type { ActivityRootReferenceV1 } from '../../packages/contracts/src/index.js';
import {
  ACTIVITY_ADAPTER_GENERIC_FAILURE_MESSAGE,
  activityTraceRef,
  ActivityAdapterError,
  asActivityAdapterError,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityQueuePageV1,
  type AskActivityAdapterPort,
  type ExternalActionActivityAdapterPort,
  type SourcesActivityAdapterPort,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP1 — Activity adapter ports.
 * Verifies that Sources, Ask and External Action adapters satisfy the typed
 * port surface, that the registry preserves accessible results when one
 * adapter fails (Contract Snapshot §3 / AC-10), and that the scope is
 * server-side only.
 */

const SCOPE: ActivityAdapterScopeV1 = {
  principalId: 'principal-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
};

const sourcesRoot: ActivityRootReferenceV1 = {
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: 'activity-sources-1',
  domainKind: 'SOURCES',
  domainResourceKind: 'IntakeSubmission',
  domainResourceId: 'submission-1',
  resourceProjectId: 'project-1',
  resourceHref: '/activity/sources/submission-1',
  jobId: 'job-1',
  runId: 'run-1',
};

const askRoot: ActivityRootReferenceV1 = {
  schemaVersion: '1.0.0',
  rootKind: 'RUN',
  activityId: 'activity-ask-1',
  domainKind: 'ASK',
  domainResourceKind: 'AnswerRun',
  domainResourceId: 'answer-run-1',
  resourceProjectId: 'project-1',
  resourceHref: '/activity/ask/answer-run-1',
  runId: 'run-2',
};

const queuePage = (root: ActivityRootReferenceV1, updatedAt: string): ActivityQueuePageV1 => ({
  items: [
    {
      root,
      summary: 'queued activity',
      state: 'QUEUED',
      dimensions: {
        schemaVersion: '1.0.0',
        attention: 'NONE',
        retryability: 'UNKNOWN',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
      updatedAt,
    },
  ],
  metadata: {
    schemaVersion: '1.0.0',
    snapshotRevision: 1,
    generatedAt: updatedAt,
    sourceUpdatedAt: updatedAt,
    freshness: 'CURRENT',
    adapterStatus: 'AVAILABLE',
    partial: false,
  },
});

const makeSourcesAdapter = (opts: { fail?: boolean } = {}): SourcesActivityAdapterPort => ({
  adapterId: 'sources-activity-adapter',
  domainKind: 'SOURCES',
  domainKinds: ['SOURCES'],
  async readQueue(scope) {
    if (opts.fail) {
      throw new ActivityAdapterError({
        code: 'ACTIVITY_ADAPTER_UNAVAILABLE',
        adapterId: this.adapterId,
        domainKind: 'SOURCES',
        message: 'sources store unavailable',
      });
    }
    if (scope.activeProjectId !== 'project-1')
      return { items: [], metadata: queuePage(sourcesRoot, '').metadata };
    return queuePage(sourcesRoot, '2026-08-06T00:01:00.000Z');
  },
  async readDetail(scope, root) {
    if (opts.fail) throw new Error('sources detail failed');
    if (scope.activeProjectId !== root.resourceProjectId) {
      throw new Error('cross-project activity detail denied');
    }
    return {
      root,
      run: {
        schemaVersion: '1.0.0',
        runId: root.runId,
        jobId: root.jobId,
        sequence: 1,
        state: 'QUEUED',
        startedAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:01:00.000Z',
        domainAttemptRefs: [],
        correlationRefs: [activityTraceRef('CORRELATION', 'commandId', 'command-1')],
        causationRefs: [],
      },
      attempts: [],
      stages: [],
      events: [],
      transportAttempts: [],
      metadata: {
        schemaVersion: '1.0.0',
        snapshotRevision: 1,
        generatedAt: '2026-08-06T00:01:00.000Z',
        sourceUpdatedAt: '2026-08-06T00:01:00.000Z',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
        partial: false,
      },
      dimensions: {
        schemaVersion: '1.0.0',
        attention: 'NONE',
        retryability: 'UNKNOWN',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
    };
  },
  async readStages() {
    return { stages: [], metadata: queuePage(sourcesRoot, '').metadata };
  },
  async readEvents() {
    return { events: [], metadata: queuePage(sourcesRoot, '').metadata };
  },
  health() {
    return { status: opts.fail ? 'UNAVAILABLE' : 'AVAILABLE' };
  },
});

const makeAskAdapter = (): AskActivityAdapterPort => ({
  adapterId: 'ask-activity-adapter',
  domainKind: 'ASK',
  domainKinds: ['ASK'],
  async readQueue(scope) {
    if (scope.activeProjectId !== askRoot.resourceProjectId) {
      return { items: [], metadata: queuePage(askRoot, '').metadata };
    }
    return queuePage(askRoot, '2026-08-06T00:02:00.000Z');
  },
  async readDetail(scope, root) {
    if (scope.activeProjectId !== root.resourceProjectId) {
      throw new Error('cross-project activity detail denied');
    }
    return {
      root,
      run: {
        schemaVersion: '1.0.0',
        runId: root.runId,
        sequence: 1,
        state: 'SUCCEEDED',
        startedAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:02:00.000Z',
        domainAttemptRefs: [],
        correlationRefs: [],
        causationRefs: [],
      },
      attempts: [],
      stages: [],
      events: [],
      transportAttempts: [],
      metadata: {
        schemaVersion: '1.0.0',
        snapshotRevision: 2,
        generatedAt: '2026-08-06T00:02:00.000Z',
        sourceUpdatedAt: '2026-08-06T00:02:00.000Z',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
        partial: false,
      },
      dimensions: {
        schemaVersion: '1.0.0',
        attention: 'NONE',
        retryability: 'UNKNOWN',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
      },
    };
  },
  async readStages() {
    return { stages: [], metadata: queuePage(askRoot, '').metadata };
  },
  async readEvents() {
    return { events: [], metadata: queuePage(askRoot, '').metadata };
  },
  health() {
    return { status: 'AVAILABLE' };
  },
});

const makeExternalActionAdapter = (): ExternalActionActivityAdapterPort => ({
  adapterId: 'external-action-activity-adapter',
  domainKind: 'EXTERNAL_ACTION',
  domainKinds: ['EXTERNAL_ACTION'],
  async readQueue(scope) {
    if (scope.activeProjectId !== askRoot.resourceProjectId) {
      return { items: [], metadata: queuePage(askRoot, '').metadata };
    }
    return { items: [], metadata: queuePage(askRoot, '').metadata };
  },
  async readDetail() {
    throw new ActivityAdapterError({
      code: 'ACTIVITY_ADAPTER_UNAVAILABLE',
      adapterId: 'external-action-activity-adapter',
      domainKind: 'EXTERNAL_ACTION',
      message: 'external action store unavailable',
      safe: true,
    });
  },
  async readStages() {
    return { stages: [], metadata: queuePage(askRoot, '').metadata };
  },
  async readEvents() {
    return { events: [], metadata: queuePage(askRoot, '').metadata };
  },
  health() {
    return { status: 'UNAVAILABLE' };
  },
});

const makeRegistry = (adapters: readonly ActivityAdapterPort[]): ActivityAdapterRegistryPort => ({
  adapters,
  adapterFor(domainKind) {
    return adapters.find((adapter) => adapter.domainKind === domainKind);
  },
  healthSummaries() {
    return Object.fromEntries(adapters.map((adapter) => [adapter.adapterId, adapter.health()]));
  },
});

describe('FE-P5-S1 adapter ports', () => {
  it('Sources, Ask and External Action adapters satisfy the typed port surface', async () => {
    const sources = makeSourcesAdapter();
    const ask = makeAskAdapter();
    const external = makeExternalActionAdapter();
    const registry = makeRegistry([sources, ask, external]);

    expect(registry.adapterFor('SOURCES')).toBe(sources);
    expect(registry.adapterFor('ASK')).toBe(ask);
    expect(registry.adapterFor('EXTERNAL_ACTION')).toBe(external);
    expect(registry.adapterFor('ASK')).not.toBe(sources);

    const sourcesPage = await sources.readQueue(SCOPE, { limit: 10 });
    expect(sourcesPage.items[0]?.root.domainResourceId).toBe('submission-1');
    expect(sourcesPage.items[0]?.root.activityId).toBe('activity-sources-1');
    expect(sourcesPage.items[0]?.root.activityId).not.toBe('submission-1');

    const askPage = await ask.readQueue(SCOPE, { limit: 10 });
    expect(askPage.items[0]?.root.rootKind).toBe('RUN');
    expect(askPage.items[0]?.root.jobId).toBeUndefined();

    const detail = await sources.readDetail(SCOPE, sourcesRoot);
    expect(detail.run.runId).toBe(sourcesRoot.runId);
  });

  it('one adapter failure does not erase accessible results from other adapters', async () => {
    const sources = makeSourcesAdapter({ fail: true });
    const ask = makeAskAdapter();
    const registry = makeRegistry([sources, ask]);

    const results: Array<{ adapter: string; ok: boolean }> = [];
    for (const adapter of registry.adapters) {
      try {
        await adapter.readQueue(SCOPE, { limit: 10 });
        results.push({ adapter: adapter.adapterId, ok: true });
      } catch {
        results.push({ adapter: adapter.adapterId, ok: false });
      }
    }

    expect(results).toEqual([
      { adapter: 'sources-activity-adapter', ok: false },
      { adapter: 'ask-activity-adapter', ok: true },
    ]);

    const health = registry.healthSummaries();
    expect(health['sources-activity-adapter']?.status).toBe('UNAVAILABLE');
    expect(health['ask-activity-adapter']?.status).toBe('AVAILABLE');
  });

  it('registry exposes per-domain adapter lookup for the federated read', () => {
    const sources = makeSourcesAdapter();
    const ask = makeAskAdapter();
    const registry = makeRegistry([sources, ask]);
    expect(registry.adapters.length).toBe(2);
    expect(registry.adapterFor('SOURCES')?.adapterId).toBe('sources-activity-adapter');
    expect(registry.adapterFor('EXTERNAL_ACTION')).toBeUndefined();
  });

  it('scope carries only server-side authority and is never part of view payloads', async () => {
    const sources = makeSourcesAdapter();
    const page = await sources.readQueue(SCOPE, { limit: 10 });
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('principalId');
    expect(serialized).not.toContain('accessRevision');
    expect(serialized).not.toContain('policyContextRevision');
  });

  it('typed adapters fail closed with a safe ActivityAdapterError', async () => {
    const external = makeExternalActionAdapter();
    await expect(external.readDetail(SCOPE, askRoot)).rejects.toBeInstanceOf(ActivityAdapterError);
    await expect(external.readDetail(SCOPE, askRoot)).rejects.toMatchObject({
      code: 'ACTIVITY_ADAPTER_UNAVAILABLE',
      domainKind: 'EXTERNAL_ACTION',
      safe: true,
    });
  });

  it('converts unknown exceptions to a non-disclosing generic message (safe: false)', () => {
    const converted = asActivityAdapterError({
      adapterId: 'sources-activity-adapter',
      domainKind: 'SOURCES',
      error: new Error('SELECT * FROM secrets -- token=super-secret path=/etc/passwd'),
    });
    expect(converted).toBeInstanceOf(ActivityAdapterError);
    expect(converted.safe).toBe(false);
    expect(converted.message).toBe(ACTIVITY_ADAPTER_GENERIC_FAILURE_MESSAGE);
    expect(converted.message).not.toContain('super-secret');
    expect(converted.message).not.toContain('SELECT');
    expect(converted.message).not.toContain('/etc/passwd');
  });

  it('passes recognized allow-listed ActivityAdapterError through unchanged', () => {
    const typed = new ActivityAdapterError({
      code: 'ACTIVITY_ADAPTER_DEGRADED',
      adapterId: 'ask-activity-adapter',
      domainKind: 'ASK',
      message: 'ask adapter degraded',
      safe: true,
    });
    const converted = asActivityAdapterError({
      adapterId: 'ask-activity-adapter',
      domainKind: 'ASK',
      error: typed,
    });
    expect(converted).toBe(typed);
    expect(converted.safe).toBe(true);
  });

  it('defaults unrecognized typed errors to safe: false when no allow-list applies', () => {
    const typedWithoutSafe = new ActivityAdapterError({
      code: 'ACTIVITY_ADAPTER_DEGRADED',
      adapterId: 'ask-activity-adapter',
      domainKind: 'ASK',
      message: 'unclassified detail',
    });
    expect(typedWithoutSafe.safe).toBe(false);
  });
});
