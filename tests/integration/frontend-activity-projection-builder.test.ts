import { describe, expect, it } from 'vitest';

import type { ActivityRootReferenceV1 } from '../../packages/contracts/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProjectionBuilder,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityQueuePageV1,
  type ActivityReadModelStorePort,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Federated Activity Projection Builder.
 * Verifies that owning-Domain adapter observations are merged into the additive
 * read model through a deterministic rebuild, that partial adapter failure is
 * surfaced (never erasing other adapters' results), and that snapshot revisions
 * are monotonic.
 */

const SCOPE: ActivityAdapterScopeV1 = {
  principalId: 'principal-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
};

const root = (input: {
  activityId: string;
  domainKind: ActivityRootReferenceV1['domainKind'];
  domainResourceId: string;
  updatedAt: string;
}): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: input.domainKind === 'ASK' ? 'RUN' : 'JOB',
  activityId: input.activityId,
  domainKind: input.domainKind,
  domainResourceKind: 'Resource',
  domainResourceId: input.domainResourceId,
  resourceProjectId: SCOPE.activeProjectId,
  resourceHref: `/activity/${input.activityId}`,
  ...(input.domainKind === 'ASK' ? {} : { jobId: `job-${input.activityId}` }),
  runId: `run-${input.activityId}`,
});

const queuePage = (
  items: Array<{
    activityId: string;
    domainKind: ActivityRootReferenceV1['domainKind'];
    domainResourceId: string;
    state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED';
    updatedAt: string;
  }>,
): ActivityQueuePageV1 => ({
  items: items.map((item) => ({
    root: root(item),
    summary: `summary-${item.activityId}`,
    state: item.state,
    dimensions: {
      schemaVersion: '1.0.0',
      attention: 'NONE',
      retryability: 'UNKNOWN',
      freshness: 'CURRENT',
      adapterStatus: 'AVAILABLE',
    },
    updatedAt: item.updatedAt,
  })),
  metadata: {
    schemaVersion: '1.0.0',
    snapshotRevision: 1,
    generatedAt: '2026-08-06T00:00:00.000Z',
    sourceUpdatedAt: '2026-08-06T00:00:00.000Z',
    freshness: 'CURRENT',
    adapterStatus: 'AVAILABLE',
    partial: false,
  },
});

const makeAdapter = (input: {
  adapterId: string;
  domainKind: ActivityAdapterPort['domainKind'];
  items: Array<{
    activityId: string;
    domainResourceId: string;
    state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED';
    updatedAt: string;
  }>;
  fail?: boolean;
}): ActivityAdapterPort => ({
  adapterId: input.adapterId,
  domainKind: input.domainKind,
  domainKinds: [input.domainKind],
  async readQueue() {
    if (input.fail) throw new Error(`raw failure from ${input.adapterId}: secret-token`);
    return queuePage(input.items.map((item) => ({ ...item, domainKind: input.domainKind })));
  },
  async readDetail() {
    throw new Error('not used');
  },
  async readStages() {
    return { stages: [], metadata: queuePage([]).metadata };
  },
  async readEvents() {
    return { events: [], metadata: queuePage([]).metadata };
  },
  async canAccess() {
    return true;
  },
  health() {
    return { status: input.fail ? 'UNAVAILABLE' : 'AVAILABLE' };
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

const store = (): ActivityReadModelStorePort => createInMemoryActivityReadModelStore();

describe('FE-P5-S1 ActivityProjectionBuilder', () => {
  it('builds the project projection into the read model with watermarks', async () => {
    const readModel = store();
    const sources = makeAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: [
        {
          activityId: 's1',
          domainResourceId: 'submission-1',
          state: 'RUNNING',
          updatedAt: '2026-08-06T00:00:01.000Z',
        },
        {
          activityId: 's2',
          domainResourceId: 'submission-2',
          state: 'QUEUED',
          updatedAt: '2026-08-06T00:00:02.000Z',
        },
      ],
    });
    const ask = makeAdapter({
      adapterId: 'ask-adapter',
      domainKind: 'ASK',
      items: [
        {
          activityId: 'a1',
          domainResourceId: 'answer-run-1',
          state: 'SUCCEEDED',
          updatedAt: '2026-08-06T00:00:03.000Z',
        },
      ],
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources, ask]), readModel);

    const result = await builder.buildProjectProjection(SCOPE);
    expect(result.resourceProjectId).toBe('project-1');
    expect(result.indexCount).toBe(3);
    expect(result.snapshotRevision).toBe(1);
    expect(result.adapterStatus).toBe('AVAILABLE');
    expect(result.partial).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.watermarks.map((w) => w.adapterId)).toEqual(['sources-adapter', 'ask-adapter']);

    const page = await readModel.index.queryProject({
      resourceProjectId: 'project-1',
      limit: 10,
    });
    // Stable ordering: updatedAt DESC.
    expect(page.records.map((r) => r.activityId)).toEqual(['a1', 's2', 's1']);
    expect(page.records[0]?.snapshotRevision).toBe(1);
  });

  it('preserves other adapters results when one adapter fails (partial result)', async () => {
    const readModel = store();
    const sources = makeAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      fail: true,
      items: [],
    });
    const ask = makeAdapter({
      adapterId: 'ask-adapter',
      domainKind: 'ASK',
      items: [
        {
          activityId: 'a1',
          domainResourceId: 'answer-run-1',
          state: 'SUCCEEDED',
          updatedAt: '2026-08-06T00:00:01.000Z',
        },
      ],
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources, ask]), readModel);

    const result = await builder.buildProjectProjection(SCOPE);
    expect(result.partial).toBe(true);
    expect(result.adapterStatus).toBe('DEGRADED');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.adapterId).toBe('sources-adapter');
    expect(result.failures[0]?.safe).toBe(false);
    // Raw internals are never propagated.
    expect(result.failures[0]?.message).not.toContain('secret-token');
    expect(result.indexCount).toBe(1);

    const page = await readModel.index.queryProject({
      resourceProjectId: 'project-1',
      limit: 10,
    });
    expect(page.records.map((r) => r.activityId)).toEqual(['a1']);

    // Fail closed: the failed adapter still receives a current-revision
    // UNAVAILABLE watermark (no sourceUpdatedAt/cursor/lag fabricated), so a
    // stale AVAILABLE observation can never be presented as current.
    const watermarks = await readModel.watermarks.readByProject('project-1');
    expect(watermarks).toHaveLength(2);
    const sourcesWatermark = watermarks.find((w) => w.adapterId === 'sources-adapter');
    const askWatermark = watermarks.find((w) => w.adapterId === 'ask-adapter');
    expect(sourcesWatermark?.adapterStatus).toBe('UNAVAILABLE');
    expect(sourcesWatermark?.snapshotRevision).toBe(1);
    expect(sourcesWatermark?.sourceUpdatedAt).toBeUndefined();
    expect(sourcesWatermark?.cursor).toBeUndefined();
    expect(sourcesWatermark?.lagMilliseconds).toBeUndefined();
    expect(askWatermark?.adapterStatus).toBe('AVAILABLE');
    expect(askWatermark?.snapshotRevision).toBe(1);
  });

  it('uses monotonic snapshot revisions across builds', async () => {
    const readModel = store();
    const sources = makeAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: [
        {
          activityId: 's1',
          domainResourceId: 'submission-1',
          state: 'QUEUED',
          updatedAt: '2026-08-06T00:00:01.000Z',
        },
      ],
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);

    const first = await builder.buildProjectProjection(SCOPE);
    const second = await builder.buildProjectProjection(SCOPE);
    expect(first.snapshotRevision).toBe(1);
    expect(second.snapshotRevision).toBe(2);

    const page = await readModel.index.queryProject({ resourceProjectId: 'project-1', limit: 10 });
    expect(page.records[0]?.snapshotRevision).toBe(2);
    const watermarks = await readModel.watermarks.readByProject('project-1');
    expect(watermarks[0]?.snapshotRevision).toBe(2);
  });

  it('rejects a stale rebuild (lower revision) from the store guard', async () => {
    const readModel = store();
    const sources = makeAdapter({
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      items: [
        {
          activityId: 's1',
          domainResourceId: 'submission-1',
          state: 'QUEUED',
          updatedAt: '2026-08-06T00:00:01.000Z',
        },
      ],
    });
    const builder = new ActivityProjectionBuilder(makeRegistry([sources]), readModel);
    await builder.buildProjectProjection(SCOPE); // revision 1
    // Simulate a concurrent newer build (revision 2) via a direct upsert.
    await readModel.index.upsert({
      resourceProjectId: 'project-1',
      activityId: 's1',
      domainKind: 'SOURCES',
      rootKind: 'JOB',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-1',
      resourceHref: '/activity/s1',
      jobId: 'job-s1',
      runId: 'run-s1',
      summary: 'summary-s1',
      state: 'QUEUED',
      attention: 'NONE',
      retryability: 'UNKNOWN',
      freshness: 'CURRENT',
      adapterStatus: 'AVAILABLE',
      snapshotRevision: 3,
      snapshot: {},
      projectedAt: '2026-08-06T00:00:02.000Z',
      updatedAt: '2026-08-06T00:00:02.000Z',
    });
    // A new build computes revision 2 from watermarks — but the index already
    // has revision 3, so the full-project rebuild must fail closed.
    await expect(builder.buildProjectProjection(SCOPE)).rejects.toThrow(
      /ACTIVITY_INDEX_STALE_REBUILD|ACTIVITY_INDEX_STALE_UPSERT/,
    );
  });
});
