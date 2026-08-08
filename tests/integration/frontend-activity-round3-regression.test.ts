import { describe, expect, it } from 'vitest';

import {
  SOURCES_SCHEMA_VERSION,
  type IntakeSubmissionSnapshot,
} from '../../packages/contracts/src/index.js';
import {
  SourcesActivityAdapter,
  InMemorySourcesActivityRead,
} from '../../adapters/frontend-activity-sources/src/index.js';
import { InMemoryExternalActionStore } from '../../adapters/frontend-external-action-in-memory/src/index.js';
import { ExternalActionActivityAdapter } from '../../adapters/frontend-activity-external-action/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProductCoordinator,
  ActivityProjectionBuilder,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityProductScopeV1,
  type SourcesActivityAttemptRow,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Round 3 regression suite (CHANGES_REQUIRED round 3).
 * Covers: project/audience isolation (A/B), deep-link Domain authorization
 * (External Action capabilities + required sensitivity), Sources flattened
 * event continuation beyond 100/200, and in-memory tie ordering parity.
 */

const PROJECT_ID = 'project-1';

const scopeOf = (overrides: Partial<ActivityProductScopeV1> = {}): ActivityProductScopeV1 => ({
  principalId: 'principal-a',
  activeProjectId: PROJECT_ID,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
  sensitivityClearance: 'private',
  ...overrides,
});

const adapterScopeOf = (
  overrides: Partial<ActivityAdapterScopeV1> = {},
): ActivityAdapterScopeV1 => ({
  principalId: 'principal-a',
  activeProjectId: PROJECT_ID,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'private',
  accessScope: ['owner'],
  ...overrides,
});

const submissionOf = (input: {
  submissionId: string;
  principalId: string;
  updatedAt: string;
  items?: IntakeSubmissionSnapshot['items'];
}): IntakeSubmissionSnapshot => ({
  schemaVersion: SOURCES_SCHEMA_VERSION,
  submissionId: input.submissionId,
  principalId: input.principalId,
  sessionId: 'session-1',
  projectId: PROJECT_ID,
  state: 'RUNNING',
  items: input.items ?? [],
  capabilities: [],
  acceptedPolicyContextId: 'policy-1',
  submissionRevision: '1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: input.updatedAt,
  updatedAt: input.updatedAt,
  stale: false,
});

// ---------------------------------------------------------------------------
// R3-1: project/audience isolation
// ---------------------------------------------------------------------------

describe('R3-1 project/audience isolation', () => {
  const makeCoordinator = (): {
    coordinator: ActivityProductCoordinator;
    read: InMemorySourcesActivityRead;
  } => {
    const read = new InMemorySourcesActivityRead();
    // Two submissions in the same Project: one owned by A, one owned by B.
    read.seedSubmission(
      submissionOf({
        submissionId: 'submission-a',
        principalId: 'principal-a',
        updatedAt: '2026-08-06T00:00:02.000Z',
      }),
    );
    read.seedSubmission(
      submissionOf({
        submissionId: 'submission-b',
        principalId: 'principal-b',
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
    );
    const adapter = new SourcesActivityAdapter(read);
    const registry: ActivityAdapterRegistryPort = {
      adapters: [adapter],
      adapterFor(domainKind) {
        return adapter.domainKind === domainKind ? adapter : undefined;
      },
      healthSummaries() {
        return { [adapter.adapterId]: adapter.health() };
      },
    };
    const readModel = createInMemoryActivityReadModelStore();
    const builder = new ActivityProjectionBuilder(registry, readModel);
    return { coordinator: new ActivityProductCoordinator(registry, readModel, builder), read };
  };

  it('A refresh stores a Project-shared projection; B never sees A-private rows', async () => {
    const { coordinator } = makeCoordinator();
    // A refreshes: the Projection stores BOTH submissions (Project-shared).
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
    });
    // B reads the queue: A-private submission is NOT disclosed.
    const bPage = await coordinator.listActivityQueue(
      scopeOf({ principalId: 'principal-b', accessScope: ['owner'] }),
      { schemaVersion: '1.0.0', limit: 10 },
    );
    expect(bPage.items.map((item) => item.root.activityId)).toEqual(['submission-b']);
    // A still sees its own row.
    const aPage = await coordinator.listActivityQueue(
      scopeOf({ principalId: 'principal-a', accessScope: ['owner'] }),
      { schemaVersion: '1.0.0', limit: 10 },
    );
    expect(aPage.items.map((item) => item.root.activityId)).toContain('submission-a');
  });

  it("B refresh does not erase A's legitimate shared rows", async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
    });
    // B refreshes too — the Project-shared projection keeps every row.
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-b' }), {
      schemaVersion: '1.0.0',
    });
    const aPage = await coordinator.listActivityQueue(
      scopeOf({ principalId: 'principal-a', accessScope: ['owner'] }),
      { schemaVersion: '1.0.0', limit: 10 },
    );
    expect(aPage.items.map((item) => item.root.activityId)).toContain('submission-a');
  });
});

// ---------------------------------------------------------------------------
// R3-2: deep-link Domain authorization + required sensitivity
// ---------------------------------------------------------------------------

describe('R3-2 deep-link Domain authorization', () => {
  const makeActionAdapter = async (): Promise<ExternalActionActivityAdapter> => {
    const store = new InMemoryExternalActionStore();
    const action = {
      schemaVersion: '1.0.0' as const,
      actionId: 'action-1',
      actionRevision: 1,
      operation: 'UPDATE_REVERSIBLE' as const,
      resourceProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      status: 'EXECUTING' as const,
      aggregateState: 'AVAILABLE' as const,
      accessMasking: 'VISIBLE' as const,
      maskedFields: [],
      capabilities: ['READ_EXTERNAL_ACTION' as const],
      updatedAt: '2026-08-06T00:00:02.000Z',
      createdAt: '2026-08-06T00:00:00.000Z',
    };
    const audit = {
      schemaVersion: '1.0.0' as const,
      auditEventId: 'audit-1',
      actionId: 'action-1',
      resourceProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      sequence: 1,
      category: 'ACTION_EXECUTED' as const,
      eventData: { schemaVersion: '1.0.0' as const, message: 'executed', refs: [] },
      occurredAt: '2026-08-06T00:00:01.500Z',
    };
    await store.transaction(async (repos) => {
      await repos.aggregates.insert(action);
      await repos.audit.append(audit);
    });
    return new ExternalActionActivityAdapter(store);
  };

  it('denies External Action detail without READ_EXTERNAL_ACTION', async () => {
    const adapter = await makeActionAdapter();
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    // activity:read only (no action:read) → owning-Domain deny → NOT_FOUND.
    const deniedScope = adapterScopeOf({ accessScope: ['activity:read'] });
    await expect(adapter.readDetail(deniedScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(adapter.readStages(deniedScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('denies audit events without READ_AUDIT but allows detail with READ_EXTERNAL_ACTION', async () => {
    const adapter = await makeActionAdapter();
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const readScope = adapterScopeOf({ accessScope: ['action:read'] });
    const detail = await adapter.readDetail(readScope, root);
    expect(detail.root.activityId).toBe('action-1');
    // Events need READ_AUDIT.
    await expect(adapter.readEvents(readScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const auditScope = adapterScopeOf({ accessScope: ['action:read', 'action:audit:read'] });
    const events = await adapter.readEvents(auditScope, root);
    expect(events.events).toHaveLength(1);
  });

  it('denies with a stale access revision (same project, wrong binding)', async () => {
    const adapter = await makeActionAdapter();
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const staleScope = adapterScopeOf({ accessScope: ['action:read'], accessRevision: 'access-2' });
    await expect(adapter.readDetail(staleScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a scope without a valid sensitivity clearance (deny-by-default)', async () => {
    const adapter = new ExternalActionActivityAdapter(new InMemoryExternalActionStore());
    const registry: ActivityAdapterRegistryPort = {
      adapters: [adapter],
      adapterFor(domainKind) {
        return adapter.domainKind === domainKind ? adapter : undefined;
      },
      healthSummaries() {
        return { [adapter.adapterId]: adapter.health() };
      },
    };
    const readModel = createInMemoryActivityReadModelStore();
    const builder = new ActivityProjectionBuilder(registry, readModel);
    const coordinator = new ActivityProductCoordinator(registry, readModel, builder);
    await expect(
      coordinator.listActivityQueue(
        {
          principalId: 'principal-a',
          activeProjectId: PROJECT_ID,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
          accessScope: ['owner'],
          sensitivityClearance: '' as never,
        },
        { schemaVersion: '1.0.0', limit: 10 },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
  });
});

// ---------------------------------------------------------------------------
// R3-3: Sources flattened event continuation beyond 100/200
// ---------------------------------------------------------------------------

describe('R3-3 Sources event continuation completeness', () => {
  const makeAdapter = (attemptCount: number): SourcesActivityAdapter => {
    const read = new InMemorySourcesActivityRead();
    const items = [
      {
        itemId: 'item-1',
        manifest: {
          kind: 'DIRECT_TEXT' as const,
          itemId: 'item-1',
          label: 'Item 1',
          mediaType: 'text/plain' as const,
          sizeBytes: 10,
        },
        state: 'RUNNING' as const,
        validation: [],
        capabilities: [],
      },
    ];
    read.seedSubmission(
      submissionOf({
        submissionId: 'submission-1',
        principalId: 'principal-a',
        updatedAt: '2026-08-06T00:00:01.000Z',
        items,
      }),
    );
    for (let number = 1; number <= attemptCount; number += 1) {
      const attempt: SourcesActivityAttemptRow = {
        intakeAttemptId: `attempt-${String(number).padStart(3, '0')}`,
        projectId: PROJECT_ID,
        submissionId: 'submission-1',
        submissionItemId: 'item-1',
        attemptNumber: number,
        attemptKind: 'SUBMIT',
        state: number === attemptCount ? 'FAILED' : 'SUCCEEDED',
        correlationId: `corr-${number}`,
        createdAt: `2026-08-06T00:00:0${number % 10}.000Z`,
        updatedAt: `2026-08-06T00:00:0${number % 10}.000Z`,
      };
      read.seedAttempt(attempt);
    }
    return new SourcesActivityAdapter(read);
  };

  it('pages 150 attempts on a single item with no permanent drop', async () => {
    const adapter = makeAdapter(150);
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const eventIds: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readEvents(adapterScopeOf(), root, cursor, 50);
      eventIds.push(...page.events.map((event) => event.eventId));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(eventIds).toHaveLength(150);
    expect(new Set(eventIds).size).toBe(150);
  });

  it('pages 250 attempts across the submission with no permanent drop', async () => {
    const adapter = makeAdapter(250);
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const eventIds: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readEvents(adapterScopeOf(), root, cursor, 50);
      eventIds.push(...page.events.map((event) => event.eventId));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(eventIds).toHaveLength(250);
    expect(new Set(eventIds).size).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// R3-5: in-memory tie ordering (updatedAt DESC, id ASC)
// ---------------------------------------------------------------------------

describe('R3-5 in-memory tie ordering parity', () => {
  it('pages equal-timestamp Sources rows with id tie-break and no gaps', async () => {
    const read = new InMemorySourcesActivityRead();
    const sameTime = '2026-08-06T00:00:00.000Z';
    // Insert in reverse id order to prove ordering is not insertion order.
    for (const id of [
      'submission-005',
      'submission-004',
      'submission-003',
      'submission-002',
      'submission-001',
    ]) {
      read.seedSubmission(
        submissionOf({ submissionId: id, principalId: `principal-${id}`, updatedAt: sameTime }),
      );
    }
    const adapter = new SourcesActivityAdapter(read);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readQueue(adapterScopeOf(), {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((item) => item.root.activityId));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    // Same timestamp → id ASC tie-break (PostgreSQL parity), no gap/duplicate.
    expect(seen).toEqual([
      'submission-001',
      'submission-002',
      'submission-003',
      'submission-004',
      'submission-005',
    ]);
  });
});
