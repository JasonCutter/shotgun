import { describe, expect, it } from 'vitest';

import type { ActivityRootReferenceV1 } from '../../packages/contracts/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProductCoordinator,
  ActivityProjectionBuilder,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityProductScopeV1,
  type ActivityQueuePageV1,
  type ActivityStageContinuationV1,
  type ActivityEventContinuationV1,
  type ActivityReadModelStorePort,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Activity Product API boundaries (CHANGES_REQUIRED round 1).
 * Covers Queue→Detail completeness beyond a page cap (51+ items), the same
 * activityId in two Domains (identity collision), Stage/Event cap enforcement,
 * and strict runtime request validation (schemaVersion, empty identity,
 * browser-authored authority, deny-by-default scope).
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
}): ActivityRootReferenceV1 => ({
  schemaVersion: '1.0.0',
  rootKind: input.domainKind === 'ASK' ? 'RUN' : 'JOB',
  activityId: input.activityId,
  domainKind: input.domainKind,
  domainResourceKind: 'Resource',
  domainResourceId: input.domainResourceId,
  resourceProjectId: PROJECT_ID,
  resourceHref: `/activity/${input.activityId}`,
  ...(input.domainKind === 'ASK' ? {} : { jobId: `job-${input.activityId}` }),
  runId: `run-${input.activityId}`,
});

const queuePage = (
  items: Array<{
    activityId: string;
    domainKind: ActivityRootReferenceV1['domainKind'];
    domainResourceId: string;
    updatedAt: string;
  }>,
): ActivityQueuePageV1 => ({
  items: items.map((item) => ({
    root: root(item),
    summary: `summary-${item.activityId}`,
    state: 'RUNNING',
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
    updatedAt: string;
  }>;
  stageCount?: number;
  eventCount?: number;
}): ActivityAdapterPort => {
  const stageCount = input.stageCount ?? 0;
  const eventCount = input.eventCount ?? 0;
  return {
    adapterId: input.adapterId,
    domainKind: input.domainKind,
    domainKinds: [input.domainKind],
    async readQueue() {
      return queuePage(input.items.map((item) => ({ ...item, domainKind: input.domainKind })));
    },
    async readDetail(_scope, detailRoot) {
      return {
        root: detailRoot,
        run: {
          schemaVersion: '1.0.0',
          runId: detailRoot.runId,
          jobId: detailRoot.jobId,
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
        metadata: queuePage([]).metadata,
        dimensions: {
          schemaVersion: '1.0.0',
          attention: 'NONE',
          retryability: 'UNKNOWN',
          freshness: 'CURRENT',
          adapterStatus: 'AVAILABLE',
        },
        availableActions: [],
      };
    },
    async readStages(): Promise<ActivityStageContinuationV1> {
      return {
        stages: Array.from({ length: stageCount }, (_, index) => ({
          schemaVersion: '1.0.0',
          stageId: `stage-${index + 1}`,
          stageKey: `stage-${index + 1}`,
          label: `Stage ${index + 1}`,
          sequence: index + 1,
          state: 'RUNNING',
          startedAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:01.000Z',
        })),
        metadata: queuePage([]).metadata,
      };
    },
    async readEvents(): Promise<ActivityEventContinuationV1> {
      return {
        events: Array.from({ length: eventCount }, (_, index) => ({
          schemaVersion: '1.0.0',
          eventId: `event-${index + 1}`,
          relatedRef: { schemaVersion: '1.0.0', resourceKind: 'Resource', resourceId: 'r' },
          category: 'PROGRESS' as const,
          sequence: index + 1,
          occurredAt: '2026-08-06T00:00:00.000Z',
          summary: `event-${index + 1}`,
        })),
        metadata: queuePage([]).metadata,
      };
    },
    async canAccess() {
      return true;
    },
    health() {
      return { status: 'AVAILABLE' };
    },
  };
};

const makeRegistry = (adapters: readonly ActivityAdapterPort[]): ActivityAdapterRegistryPort => ({
  adapters,
  adapterFor(domainKind) {
    return adapters.find((adapter) => adapter.domainKind === domainKind);
  },
  healthSummaries() {
    return Object.fromEntries(adapters.map((adapter) => [adapter.adapterId, adapter.health()]));
  },
});

const makeCoordinator = async (input: {
  adapters: readonly ActivityAdapterPort[];
  readModel?: ActivityReadModelStorePort;
}): Promise<ActivityProductCoordinator> => {
  const readModel = input.readModel ?? createInMemoryActivityReadModelStore();
  const registry = makeRegistry(input.adapters);
  const builder = new ActivityProjectionBuilder(registry, readModel);
  const coordinator = new ActivityProductCoordinator(registry, readModel, builder);
  await coordinator.refreshActivityProjection(scope(), { schemaVersion: '1.0.0' });
  return coordinator;
};

describe('FE-P5-S1 Queue→Detail completeness (AC-05)', () => {
  it('resolves a 51st+ queue item to Detail (beyond the queue page cap)', async () => {
    // 55 Sources items so the 51st+ rows are beyond the first queue page cap.
    const items = Array.from({ length: 55 }, (_, index) => ({
      activityId: `s${String(index + 1).padStart(3, '0')}`,
      domainResourceId: `submission-${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 7, 6, 0, 0, 55 - index)).toISOString(),
    }));
    const coordinator = await makeCoordinator({
      adapters: [makeAdapter({ adapterId: 'sources-adapter', domainKind: 'SOURCES', items })],
    });
    // Walk the queue pages to the second page and pick a 51st+ item.
    const first = await coordinator.listActivityQueue(scope(), {
      schemaVersion: '1.0.0',
      limit: 50,
    });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeDefined();
    const second = await coordinator.listActivityQueue(scope(), {
      schemaVersion: '1.0.0',
      limit: 50,
      cursor: first.nextCursor,
    });
    expect(second.items.length).toBeGreaterThan(0);
    const deepItem = second.items[second.items.length - 1]!;
    expect(deepItem).toBeDefined();

    // The queue-visible Activity MUST resolve to Detail (no page-cap NOT_FOUND).
    const detail = await coordinator.getActivityDetail(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: deepItem.root.activityId,
      domainResourceKind: deepItem.root.domainResourceKind,
      domainResourceId: deepItem.root.domainResourceId,
    });
    expect(detail.root.activityId).toBe(deepItem.root.activityId);
  });

  it('keeps the same activityId in two Domains distinct (identity collision)', async () => {
    const coordinator = await makeCoordinator({
      adapters: [
        makeAdapter({
          adapterId: 'sources-adapter',
          domainKind: 'SOURCES',
          items: [
            {
              activityId: 'shared',
              domainResourceId: 'submission-shared',
              updatedAt: '2026-08-06T00:00:02.000Z',
            },
          ],
        }),
        makeAdapter({
          adapterId: 'ask-adapter',
          domainKind: 'ASK',
          items: [
            {
              activityId: 'shared',
              domainResourceId: 'answer-run-shared',
              updatedAt: '2026-08-06T00:00:01.000Z',
            },
          ],
        }),
      ],
    });
    // Both Domains projected an identical activityId but with different
    // concrete Domain references.
    const sourcesDetail = await coordinator.getActivityDetail(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: 'shared',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-shared',
    });
    expect(sourcesDetail.root.domainKind).toBe('SOURCES');
    expect(sourcesDetail.root.domainResourceId).toBe('submission-shared');

    const askDetail = await coordinator.getActivityDetail(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'ASK',
      activityId: 'shared',
      domainResourceKind: 'Resource',
      domainResourceId: 'answer-run-shared',
    });
    expect(askDetail.root.domainKind).toBe('ASK');
    expect(askDetail.root.domainResourceId).toBe('answer-run-shared');

    // A mismatched concrete reference for an existing projection identity is
    // non-disclosing NOT_FOUND.
    await expect(
      coordinator.getActivityDetail(scope(), {
        schemaVersion: '1.0.0',
        domainKind: 'SOURCES',
        activityId: 'shared',
        domainResourceKind: 'Resource',
        domainResourceId: 'wrong-resource',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FE-P5-S1 Stage/Event caps', () => {
  it('caps an adapter that returns more than the frozen bound', async () => {
    const coordinator = await makeCoordinator({
      adapters: [
        makeAdapter({
          adapterId: 'sources-adapter',
          domainKind: 'SOURCES',
          items: [
            {
              activityId: 's1',
              domainResourceId: 'submission-1',
              updatedAt: '2026-08-06T00:00:01.000Z',
            },
          ],
          stageCount: 200,
          eventCount: 500,
        }),
      ],
    });
    const stages = await coordinator.listActivityStages(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: 's1',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-1',
    });
    expect(stages.stages.length).toBeLessThanOrEqual(50);
    const events = await coordinator.listActivityEvents(scope(), {
      schemaVersion: '1.0.0',
      domainKind: 'SOURCES',
      activityId: 's1',
      domainResourceKind: 'Resource',
      domainResourceId: 'submission-1',
    });
    expect(events.events.length).toBeLessThanOrEqual(50);
  });
});

describe('FE-P5-S1 runtime request validation', () => {
  it('rejects an unsupported schemaVersion on every request', async () => {
    const coordinator = await makeCoordinator({
      adapters: [
        makeAdapter({
          adapterId: 'sources-adapter',
          domainKind: 'SOURCES',
          items: [
            {
              activityId: 's1',
              domainResourceId: 'submission-1',
              updatedAt: '2026-08-06T00:00:01.000Z',
            },
          ],
        }),
      ],
    });
    await expect(
      coordinator.listActivityQueue(scope(), {
        schemaVersion: '2.0.0' as never,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      coordinator.getActivityDetail(scope(), {
        schemaVersion: '2.0.0' as never,
        domainKind: 'SOURCES',
        activityId: 's1',
        domainResourceKind: 'Resource',
        domainResourceId: 'submission-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      coordinator.refreshActivityProjection(scope(), {
        schemaVersion: '2.0.0' as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects empty identity fields (deny-by-default)', async () => {
    const coordinator = await makeCoordinator({ adapters: [] });
    await expect(
      coordinator.getActivityDetail(scope(), {
        schemaVersion: '1.0.0',
        domainKind: 'SOURCES',
        activityId: '   ',
        domainResourceKind: 'Resource',
        domainResourceId: 'submission-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects browser-authored authority fields', async () => {
    const coordinator = await makeCoordinator({ adapters: [] });
    await expect(
      coordinator.listActivityQueue(scope(), {
        schemaVersion: '1.0.0',
        limit: 10,
        principalId: 'browser-injected',
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('denies a scope with missing Principal or Project binding', async () => {
    const coordinator = await makeCoordinator({ adapters: [] });
    await expect(
      coordinator.listActivityQueue(scope({ principalId: '' }), {
        schemaVersion: '1.0.0',
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await expect(
      coordinator.listActivityQueue(scope({ activeProjectId: '' }), {
        schemaVersion: '1.0.0',
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
  });

  it('rejects an unsupported domainKind in a detail request', async () => {
    const coordinator = await makeCoordinator({ adapters: [] });
    await expect(
      coordinator.getActivityDetail(scope(), {
        schemaVersion: '1.0.0',
        domainKind: 'CONNECTOR_DIAGNOSTICS',
        activityId: 's1',
        domainResourceKind: 'Resource',
        domainResourceId: 'submission-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
