import { describe, expect, it } from 'vitest';

import {
  SOURCES_SCHEMA_VERSION,
  type IntakeSubmissionSnapshot,
  type SourcesSensitivity,
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
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Round 4 regression suite (CHANGES_REQUIRED round 4).
 * Covers: audience-safe Queue pagination (no empty-page cursor, accessible
 * rows fill the page, cursor only when a further accessible row is confirmed),
 * Sources authoritative access revalidation (sensitivity clearance + stale
 * access/policy revisions deny on Queue/Detail/Stage/Event alike), and
 * External Action Detail audit-event gating (READ_AUDIT required for events).
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
  accessRevision?: string;
  policyContextRevision?: string;
}): IntakeSubmissionSnapshot => ({
  schemaVersion: SOURCES_SCHEMA_VERSION,
  submissionId: input.submissionId,
  principalId: input.principalId,
  sessionId: 'session-1',
  projectId: PROJECT_ID,
  state: 'RUNNING',
  items: [],
  capabilities: [],
  acceptedPolicyContextId: 'policy-1',
  submissionRevision: '1',
  accessRevision: input.accessRevision ?? 'access-1',
  policyContextRevision: input.policyContextRevision ?? 'policy-1',
  createdAt: input.updatedAt,
  updatedAt: input.updatedAt,
  stale: false,
});

// ---------------------------------------------------------------------------
// R4-1: audience-safe Queue pagination
// ---------------------------------------------------------------------------

describe('R4-1 audience-safe Queue pagination', () => {
  const makeCoordinator = (
    seedings: ReadonlyArray<{
      readonly id: string;
      readonly principalId: string;
      readonly updatedAt: string;
    }>,
  ): { coordinator: ActivityProductCoordinator; read: InMemorySourcesActivityRead } => {
    const read = new InMemorySourcesActivityRead();
    for (const seed of seedings) {
      read.seedSubmission(
        submissionOf({
          submissionId: seed.id,
          principalId: seed.principalId,
          updatedAt: seed.updatedAt,
        }),
      );
    }
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

  it('never returns an empty page with a cursor (only inaccessible rows remain)', async () => {
    const { coordinator } = makeCoordinator(
      [1, 2, 3, 4, 5].map((index) => ({
        id: `b-${index}`,
        principalId: 'principal-b',
        updatedAt: `2026-08-06T00:00:0${index}.000Z`,
      })),
    );
    // Project-shared refresh stores every row; A owns none of them.
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
    });
    const page = await coordinator.listActivityQueue(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
      limit: 10,
    });
    expect(page.items).toEqual([]);
    // The empty page must never carry a cursor — the existence/count of
    // inaccessible rows is not inferable from cursor presence.
    expect(page.nextCursor).toBeUndefined();
  });

  it('surfaces one accessible row behind 50 leading inaccessible rows without leaking', async () => {
    const seedings: Array<{ id: string; principalId: string; updatedAt: string }> = [];
    for (let index = 1; index <= 50; index += 1) {
      seedings.push({
        id: `b-${String(index).padStart(3, '0')}`,
        principalId: 'principal-b',
        updatedAt: `2026-08-06T00:00:${String(60 - index).padStart(2, '0')}.000Z`,
      });
    }
    // A's row is the OLDEST, so it sits behind all 50 inaccessible rows.
    seedings.push({
      id: 'a-1',
      principalId: 'principal-a',
      updatedAt: '2026-08-06T00:00:01.000Z',
    });
    const { coordinator } = makeCoordinator(seedings);
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
    });
    const page = await coordinator.listActivityQueue(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
      limit: 10,
    });
    expect(page.items.map((item) => item.root.activityId)).toEqual(['a-1']);
    // Nothing accessible remains behind → no cursor.
    expect(page.nextCursor).toBeUndefined();
  });

  it('fills pages with accessible rows across interleaved multi-page data with no gap/duplicate', async () => {
    // Interleave A-owned and B-owned rows: a-i at 00:00:50, b-i at 00:00:49, ...
    const seedings: Array<{ id: string; principalId: string; updatedAt: string }> = [];
    for (let index = 1; index <= 25; index += 1) {
      const base = 51 - index * 2; // 49, 47, 45, ...
      seedings.push({
        id: `a-${String(index).padStart(3, '0')}`,
        principalId: 'principal-a',
        updatedAt: `2026-08-06T00:00:${String(base + 1).padStart(2, '0')}.000Z`,
      });
      seedings.push({
        id: `b-${String(index).padStart(3, '0')}`,
        principalId: 'principal-b',
        updatedAt: `2026-08-06T00:00:${String(base).padStart(2, '0')}.000Z`,
      });
    }
    const { coordinator } = makeCoordinator(seedings);
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await coordinator.listActivityQueue(scopeOf({ principalId: 'principal-a' }), {
        schemaVersion: '1.0.0',
        limit: 5,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages += 1;
      seen.push(...page.items.map((item) => item.root.activityId));
      // A cursor is only present when the page is full AND a further accessible
      // row exists behind — never for a page whose tail is only inaccessible.
      if (page.nextCursor !== undefined) {
        expect(page.items).toHaveLength(5);
        cursor = page.nextCursor;
        continue;
      }
      break;
    }
    // Exactly the 25 A-owned rows, in raw index order, no missing, no duplicate.
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual(
      Array.from({ length: 25 }, (_, index) => `a-${String(index + 1).padStart(3, '0')}`),
    );
    expect(pages).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// R4-2: Sources authoritative access revalidation
// ---------------------------------------------------------------------------

describe('R4-2 Sources authoritative access revalidation', () => {
  const makeAdapter = (
    options: {
      readonly sensitivity?: SourcesSensitivity;
      readonly accessRevision?: string;
      readonly policyContextRevision?: string;
    } = {},
  ): { adapter: SourcesActivityAdapter; read: InMemorySourcesActivityRead } => {
    const read = new InMemorySourcesActivityRead();
    read.seedSubmission(
      submissionOf({
        submissionId: 'submission-1',
        principalId: 'principal-a',
        updatedAt: '2026-08-06T00:00:01.000Z',
        accessRevision: options.accessRevision,
        policyContextRevision: options.policyContextRevision,
      }),
      options.sensitivity ?? 'public',
    );
    return { adapter: new SourcesActivityAdapter(read), read };
  };

  it('denies a same-Principal submission when the clearance is too low (Queue/Detail/Stage/Event)', async () => {
    const { adapter } = makeAdapter({ sensitivity: 'restricted' });
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const lowScope = adapterScopeOf({ sensitivityClearance: 'public' });
    expect(await adapter.canAccess(lowScope, root)).toBe(false);
    await expect(adapter.readDetail(lowScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.readStages(lowScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.readEvents(lowScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies a same-Principal submission on a stale access revision', async () => {
    const { adapter } = makeAdapter({ accessRevision: 'access-1' });
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const staleScope = adapterScopeOf({ accessRevision: 'access-2' });
    expect(await adapter.canAccess(staleScope, root)).toBe(false);
    await expect(adapter.readDetail(staleScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.readStages(staleScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(adapter.readEvents(staleScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies a same-Principal submission on a stale policy revision', async () => {
    const { adapter } = makeAdapter({ policyContextRevision: 'policy-1' });
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const staleScope = adapterScopeOf({ policyContextRevision: 'policy-2' });
    expect(await adapter.canAccess(staleScope, root)).toBe(false);
    await expect(adapter.readDetail(staleScope, root)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('allows a same-Principal submission with a sufficient clearance and current revisions', async () => {
    const { adapter } = makeAdapter({ sensitivity: 'private' });
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const okScope = adapterScopeOf({ sensitivityClearance: 'private' });
    expect(await adapter.canAccess(okScope, root)).toBe(true);
    const detail = await adapter.readDetail(okScope, root);
    expect(detail.root.activityId).toBe('submission-1');
  });

  it('excludes a low-clearance submission from the coordinator Queue and denies Detail', async () => {
    const read = new InMemorySourcesActivityRead();
    read.seedSubmission(
      submissionOf({
        submissionId: 'submission-a',
        principalId: 'principal-a',
        updatedAt: '2026-08-06T00:00:02.000Z',
      }),
      'restricted',
    );
    read.seedSubmission(
      submissionOf({
        submissionId: 'submission-b',
        principalId: 'principal-a',
        updatedAt: '2026-08-06T00:00:01.000Z',
      }),
      'public',
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
    const coordinator = new ActivityProductCoordinator(registry, readModel, builder);
    await coordinator.refreshActivityProjection(scopeOf({ principalId: 'principal-a' }), {
      schemaVersion: '1.0.0',
    });
    // Same Principal, but a 'public' clearance cannot see the 'restricted' row.
    const lowScope = scopeOf({ sensitivityClearance: 'public' });
    const page = await coordinator.listActivityQueue(lowScope, {
      schemaVersion: '1.0.0',
      limit: 10,
    });
    expect(page.items.map((item) => item.root.activityId)).toEqual(['submission-b']);
    expect(page.nextCursor).toBeUndefined();
    await expect(
      coordinator.getActivityDetail(lowScope, {
        schemaVersion: '1.0.0',
        domainKind: 'SOURCES',
        activityId: 'submission-a',
        domainResourceKind: 'IntakeSubmission',
        domainResourceId: 'submission-a',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// R4-3: External Action Detail audit authorization
// ---------------------------------------------------------------------------

describe('R4-3 External Action Detail audit authorization', () => {
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

  it('omits audit events from Detail when the scope lacks READ_AUDIT', async () => {
    const adapter = await makeActionAdapter();
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const readScope = adapterScopeOf({ accessScope: ['action:read'] });
    const detail = await adapter.readDetail(readScope, root);
    expect(detail.root.activityId).toBe('action-1');
    // READ_AUDIT gates the events everywhere: no bypass through Detail.
    expect(detail.events).toEqual([]);
    await expect(adapter.readEvents(readScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('includes audit events in Detail only when READ_AUDIT is granted', async () => {
    const adapter = await makeActionAdapter();
    const queue = await adapter.readQueue(adapterScopeOf(), { limit: 10 });
    const root = queue.items[0]!.root;
    const auditScope = adapterScopeOf({ accessScope: ['action:read', 'action:audit:read'] });
    const detail = await adapter.readDetail(auditScope, root);
    expect(detail.root.activityId).toBe('action-1');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]!.eventId).toBe('audit-1');
  });
});
