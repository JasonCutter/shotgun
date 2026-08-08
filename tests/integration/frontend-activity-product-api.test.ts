import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  type ActivityRootReferenceV1,
} from '../../packages/contracts/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProductCoordinator,
  ActivityProjectionBuilder,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityDetailV1,
  type ActivityProductScopeV1,
  type ActivityQueuePageV1,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Activity Product API.
 * Verifies the project-scoped, typed, cursor-bounded Queue/Detail/continuation
 * reads and explicit refresh, least-privilege capability enforcement, and
 * non-disclosing security (missing and cross-project resources produce the
 * same NOT_FOUND).
 */

const PROJECT_ID = 'project-1';

const scope = (overrides: Partial<ActivityProductScopeV1> = {}): ActivityProductScopeV1 => ({
  principalId: 'principal-1',
  activeProjectId: PROJECT_ID,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
  sensitivityClearance: 'private',
  ...overrides,
});

const root = (input: {
  activityId: string;
  domainKind: ActivityRootReferenceV1['domainKind'];
  domainResourceId: string;
  projectId?: string;
}): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: input.domainKind === 'ASK' ? 'RUN' : 'JOB',
  activityId: input.activityId,
  domainKind: input.domainKind,
  domainResourceKind: 'Resource',
  domainResourceId: input.domainResourceId,
  resourceProjectId: input.projectId ?? PROJECT_ID,
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

const makeDetail = (r: ActivityRootReferenceV1): ActivityDetailV1 => {
  return {
    root: r,
    run: {
      schemaVersion: '1.0.0',
      runId: r.runId,
      jobId: r.jobId,
      sequence: 1,
      state: 'RUNNING',
      startedAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:01.000Z',
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
      snapshotRevision: 1,
      generatedAt: '2026-08-06T00:00:01.000Z',
      sourceUpdatedAt: '2026-08-06T00:00:01.000Z',
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
    availableActions: [],
  };
};

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
    if (input.fail) throw new Error('raw adapter failure');
    return queuePage(input.items.map((item) => ({ ...item, domainKind: input.domainKind })));
  },
  async readDetail(_adapterScope, detailRoot) {
    if (input.fail) throw new Error('raw adapter failure');
    return makeDetail(detailRoot);
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

const makeCoordinator = (input: {
  adapters: readonly ActivityAdapterPort[];
  failSources?: boolean;
}): ActivityProductCoordinator => {
  const readModel = createInMemoryActivityReadModelStore();
  const registry = makeRegistry(input.adapters);
  const builder = new ActivityProjectionBuilder(registry, readModel);
  return new ActivityProductCoordinator(registry, readModel, builder);
};

const builtCoordinator = async (): Promise<ActivityProductCoordinator> => {
  const coordinator = makeCoordinator({
    adapters: [
      makeAdapter({
        adapterId: 'sources-adapter',
        domainKind: 'SOURCES',
        items: [
          {
            activityId: 's1',
            domainResourceId: 'submission-1',
            state: 'RUNNING',
            updatedAt: '2026-08-06T00:00:02.000Z',
          },
          {
            activityId: 's2',
            domainResourceId: 'submission-2',
            state: 'QUEUED',
            updatedAt: '2026-08-06T00:00:01.000Z',
          },
        ],
      }),
      makeAdapter({
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
      }),
    ],
  });
  await coordinator.refreshActivityProjection(scope(), { schemaVersion: '1.0.0' });
  return coordinator;
};

describe('FE-P5-S1 ActivityProductCoordinator queue reads', () => {
  it('lists the project-scoped queue with stable ordering and metadata', async () => {
    const coordinator = await builtCoordinator();
    const page = await coordinator.listActivityQueue(scope(), {
      schemaVersion: '1.0.0',
      limit: 10,
    });
    expect(page.items.map((item) => item.root.activityId)).toEqual(['a1', 's1', 's2']);
    expect(page.metadata.adapterStatus).toBe('AVAILABLE');
    expect(page.metadata.partial).toBe(false);
    expect(page.metadata.snapshotRevision).toBeGreaterThan(0);
  });

  it('applies filters and returns a cursor-bounded continuation', async () => {
    const coordinator = await builtCoordinator();
    const first = await coordinator.listActivityQueue(scope(), {
      schemaVersion: '1.0.0',
      states: ['QUEUED', 'RUNNING'],
      limit: 1,
    });
    expect(first.items.map((item) => item.root.activityId)).toEqual(['s1']);
    expect(first.nextCursor).toBeDefined();
    const second = await coordinator.listActivityQueue(scope(), {
      schemaVersion: '1.0.0',
      states: ['QUEUED', 'RUNNING'],
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.root.activityId)).toEqual(['s2']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('is project-bound (cross-project records never appear)', async () => {
    const coordinator = await builtCoordinator();
    const otherScope = scope({ activeProjectId: 'project-2' });
    const page = await coordinator.listActivityQueue(otherScope, {
      schemaVersion: '1.0.0',
      limit: 10,
    });
    expect(page.items).toHaveLength(0);
  });
});

describe('FE-P5-S1 ActivityProductCoordinator detail and continuation', () => {
  it('reads detail by projection identity plus concrete Domain reference', async () => {
    const coordinator = await builtCoordinator();
    const detail = await coordinator.getActivityDetail(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: 's1',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-1',
    });
    expect(detail.root.activityId).toBe('s1');
    expect(detail.root.domainResourceId).toBe('submission-1');
  });

  it('reads bounded stage/event continuation', async () => {
    const coordinator = await builtCoordinator();
    const stages = await coordinator.listActivityStages(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: 's1',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-1',
    });
    expect(stages.stages).toEqual([]);
    const events = await coordinator.listActivityEvents(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: 's1',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-1',
    });
    expect(events.events).toEqual([]);
  });

  it('is non-disclosing for a missing or cross-project resource', async () => {
    const coordinator = await builtCoordinator();
    const missing = () =>
      coordinator.getActivityDetail(scope(), {
        schemaVersion: '1.0.0',
        domainKind: 'SOURCES',
        activityId: 'missing',
        domainResourceKind: 'Resource',
        domainResourceId: 'missing-resource',
      });
    await expect(missing()).rejects.toBeInstanceOf(FrontendContractError);
    await expect(missing()).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // The same NOT_FOUND is returned for a resource that exists but only in
    // another project (no existence disclosure).
    const otherScope = scope({ activeProjectId: 'project-2' });
    await expect(
      coordinator.getActivityDetail(otherScope, {
        schemaVersion: '1.0.0',
        domainKind: 'SOURCES',
        activityId: 's1',
        domainResourceKind: 'Resource',
        domainResourceId: 'submission-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FE-P5-S1 ActivityProductCoordinator capabilities', () => {
  it('denies reads without activity:read and refresh without activity:refresh', async () => {
    const coordinator = await builtCoordinator();
    const noRead = scope({ accessScope: [] });
    await expect(
      coordinator.listActivityQueue(noRead, { schemaVersion: '1.0.0', limit: 10 }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await expect(
      coordinator.getActivityDetail(noRead, {
        schemaVersion: '1.0.0',
        domainKind: 'SOURCES',
        activityId: 's1',
        domainResourceKind: 'Resource',
        domainResourceId: 'submission-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });

    const readOnly = scope({ accessScope: ['activity:read'] });
    await expect(
      coordinator.refreshActivityProjection(readOnly, { schemaVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
  });

  it('grants reads from fine-grained activity:read and refresh from activity:refresh', async () => {
    const readOnly = scope({ accessScope: ['activity:read'] });
    const coordinator = await builtCoordinator();
    const page = await coordinator.listActivityQueue(readOnly, {
      schemaVersion: '1.0.0',
      limit: 10,
    });
    expect(page.items.length).toBeGreaterThan(0);

    const refreshOnly = scope({ accessScope: ['activity:refresh'] });
    const result = await coordinator.refreshActivityProjection(refreshOnly, {
      schemaVersion: '1.0.0',
    });
    expect(result.snapshotRevision).toBeGreaterThan(0);
    await expect(
      coordinator.listActivityQueue(refreshOnly, { schemaVersion: '1.0.0', limit: 10 }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
  });

  it('explicit refresh rebuilds the projection through the builder', async () => {
    const coordinator = await builtCoordinator();
    const first = await coordinator.refreshActivityProjection(scope(), {
      schemaVersion: '1.0.0',
    });
    const second = await coordinator.refreshActivityProjection(scope(), {
      schemaVersion: '1.0.0',
    });
    expect(second.snapshotRevision).toBe(first.snapshotRevision + 1);
  });
});
