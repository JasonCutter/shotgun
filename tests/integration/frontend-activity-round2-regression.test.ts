import { describe, expect, it } from 'vitest';

import {
  ASK_SCHEMA_VERSION,
  SOURCES_SCHEMA_VERSION,
  type AskAnswerRunSnapshot,
  type IntakeSubmissionSnapshot,
} from '../../packages/contracts/src/index.js';
import { InMemoryExternalActionStore } from '../../adapters/frontend-external-action-in-memory/src/index.js';
import {
  SourcesActivityAdapter,
  InMemorySourcesActivityRead,
} from '../../adapters/frontend-activity-sources/src/index.js';
import {
  AskActivityAdapter,
  InMemoryAskActivityRead,
} from '../../adapters/frontend-activity-ask/src/index.js';
import { ExternalActionActivityAdapter } from '../../adapters/frontend-activity-external-action/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import {
  ActivityProjectionBuilder,
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityQueuePageV1,
  type AskActivityReadPort,
} from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — Round 2 regression suite (CHANGES_REQUIRED round 2).
 * Covers: concrete Sources/Ask queue pagination (101+, no skip), empty-
 * projection atomic CAS, Stage/Event continuation cursors, Ask real attempt
 * identity (no fabricated fallback), sensitivity/access revalidation through
 * the adapter (NOT_FOUND), and multi-page watermark aggregation.
 */

const ADAPTER_SCOPE: ActivityAdapterScopeV1 = {
  principalId: 'principal-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'private',
  accessScope: ['owner', 'activity:read', 'action:read', 'action:audit:read'],
};

// ---------------------------------------------------------------------------
// R2-1: concrete Sources/Ask queue pagination never skips a row
// ---------------------------------------------------------------------------

const submissionOf = (index: number): IntakeSubmissionSnapshot => ({
  schemaVersion: SOURCES_SCHEMA_VERSION,
  submissionId: `submission-${String(index).padStart(3, '0')}`,
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  state: index % 3 === 0 ? 'SUCCEEDED' : index % 3 === 1 ? 'RUNNING' : 'QUEUED',
  items: [],
  capabilities: [],
  acceptedPolicyContextId: 'policy-1',
  submissionRevision: '1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: new Date(Date.UTC(2026, 7, 6, 0, 0, index)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 7, 6, 0, 0, index)).toISOString(),
  stale: false,
});

describe('R2-1 concrete Sources queue pagination (101+ rows, no skip)', () => {
  it('pages through 105 submissions with no missing or duplicate activity ids', async () => {
    const read = new InMemorySourcesActivityRead();
    for (let index = 1; index <= 105; index += 1) {
      read.seedSubmission(submissionOf(index));
    }
    const adapter = new SourcesActivityAdapter(read);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await adapter.readQueue(ADAPTER_SCOPE, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of page.items) seen.add(item.root.activityId);
      pages += 1;
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(105);
    expect(pages).toBeGreaterThan(1);
    // Every submission appears exactly once (no skip, no duplicate).
    for (let index = 1; index <= 105; index += 1) {
      expect(seen.has(`submission-${String(index).padStart(3, '0')}`)).toBe(true);
    }
  });
});

const answerRunOf = (index: number): AskAnswerRunSnapshot => ({
  schemaVersion: ASK_SCHEMA_VERSION,
  answerRunId: `run-${String(index).padStart(3, '0')}`,
  conversationId: 'conv-1',
  branchId: 'branch-1',
  turnId: `turn-${index}`,
  projectId: 'project-1',
  mode: 'CANONICAL_ONLY',
  state: 'RUNNING',
  question: 'q',
  statements: [],
  sourceSelections: [],
  capabilities: [],
  answerRevision: '1',
  conversationRevision: '1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: new Date(Date.UTC(2026, 7, 6, 0, 0, index)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 7, 6, 0, 0, index)).toISOString(),
  stale: false,
  attemptNumber: index,
  attemptId: `attempt-${index}`,
});

describe('R2-1 concrete Ask queue pagination (101+ rows, no skip)', () => {
  it('pages through 105 answer runs with no missing or duplicate ids', async () => {
    const read = new InMemoryAskActivityRead();
    for (let index = 1; index <= 105; index += 1) {
      read.seedRun(answerRunOf(index));
    }
    const adapter = new AskActivityAdapter(read);
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readQueue(ADAPTER_SCOPE, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of page.items) seen.add(item.root.activityId);
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(105);
    for (let index = 1; index <= 105; index += 1) {
      expect(seen.has(`run-${String(index).padStart(3, '0')}`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// R2-2: empty-projection atomic CAS (all adapters failed → index empty)
// ---------------------------------------------------------------------------

describe('R2-2 empty-projection atomic CAS', () => {
  it('rejects a same-revision commit even when the index is empty', async () => {
    const readModel = createInMemoryActivityReadModelStore();
    // Seed watermarks at revision 5 with an EMPTY index (all adapters failed
    // scenario) via a direct watermark upsert.
    await readModel.watermarks.upsert({
      resourceProjectId: 'project-1',
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      projectedAt: '2026-08-06T00:00:05.000Z',
      adapterStatus: 'UNAVAILABLE',
      snapshotRevision: 5,
      updatedAt: '2026-08-06T00:00:05.000Z',
    });
    // Refresh A and B both compute revision 6; A commits first.
    await readModel.commitProjectProjection({
      resourceProjectId: 'project-1',
      snapshotRevision: 6,
      records: [],
      watermarks: [
        {
          resourceProjectId: 'project-1',
          adapterId: 'sources-adapter',
          domainKind: 'SOURCES',
          projectedAt: '2026-08-06T00:00:06.000Z',
          adapterStatus: 'UNAVAILABLE',
          snapshotRevision: 6,
          updatedAt: '2026-08-06T00:00:06.000Z',
        },
      ],
    });
    // B must fail closed even though the index is empty: the watermark CAS
    // shows revision 6 is already committed.
    await expect(
      readModel.commitProjectProjection({
        resourceProjectId: 'project-1',
        snapshotRevision: 6,
        records: [],
        watermarks: [
          {
            resourceProjectId: 'project-1',
            adapterId: 'sources-adapter',
            domainKind: 'SOURCES',
            projectedAt: '2026-08-06T00:00:06.500Z',
            adapterStatus: 'UNAVAILABLE',
            snapshotRevision: 6,
            updatedAt: '2026-08-06T00:00:06.500Z',
          },
        ],
      }),
    ).rejects.toThrow(/ACTIVITY_INDEX_STALE_REBUILD/);
  });
});

// ---------------------------------------------------------------------------
// R2-3: Stage/Event continuation cursors
// ---------------------------------------------------------------------------

describe('R2-3 continuation cursors', () => {
  const pagedSources = (): {
    adapter: SourcesActivityAdapter;
    read: InMemorySourcesActivityRead;
  } => {
    const read = new InMemorySourcesActivityRead();
    const items = Array.from({ length: 8 }, (_, index) => ({
      itemId: `item-${index + 1}`,
      manifest: {
        kind: 'DIRECT_TEXT' as const,
        itemId: `item-${index + 1}`,
        label: `Item ${index + 1}`,
        mediaType: 'text/plain' as const,
        sizeBytes: 10,
      },
      state: 'SUCCEEDED' as const,
      validation: [],
      capabilities: [],
    }));
    read.seedSubmission({
      schemaVersion: SOURCES_SCHEMA_VERSION,
      submissionId: 'submission-1',
      principalId: 'principal-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      state: 'RUNNING',
      items,
      capabilities: [],
      acceptedPolicyContextId: 'policy-1',
      submissionRevision: '1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:01.000Z',
      stale: false,
    });
    return { adapter: new SourcesActivityAdapter(read), read };
  };

  it('pages Sources stages with the typed continuation cursor', async () => {
    const { adapter } = pagedSources();
    const queue = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const root = queue.items[0]!.root;
    const stageIds: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readStages(ADAPTER_SCOPE, root, cursor, 3);
      stageIds.push(...page.stages.map((stage) => stage.stageId));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(stageIds).toHaveLength(8);
    expect(new Set(stageIds).size).toBe(8);
    expect(stageIds).toEqual(Array.from({ length: 8 }, (_, index) => `item-${index + 1}`));
  });

  it('pages Ask events by ordinal cursor', async () => {
    const read = new InMemoryAskActivityRead();
    read.seedRun(answerRunOf(1));
    for (let ordinal = 1; ordinal <= 7; ordinal += 1) {
      read.seedEvent({
        schemaVersion: ASK_SCHEMA_VERSION,
        eventId: `event-${ordinal}`,
        answerRunId: 'run-001',
        projectId: 'project-1',
        ordinal,
        kind: 'STATE',
        state: 'RUNNING',
        answerRevision: '1',
        createdAt: `2026-08-06T00:00:0${ordinal}.000Z`,
      });
    }
    const adapter = new AskActivityAdapter(read);
    const queue = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const root = queue.items[0]!.root;
    const sequences: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readEvents(ADAPTER_SCOPE, root, cursor, 3);
      sequences.push(...page.events.map((event) => event.sequence));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('pages External Action stages by offset cursor', async () => {
    const store = new InMemoryExternalActionStore();
    const action = {
      schemaVersion: '1.0.0' as const,
      actionId: 'action-1',
      actionRevision: 1,
      operation: 'UPDATE_REVERSIBLE' as const,
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
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
    const execution = {
      schemaVersion: '1.0.0' as const,
      executionId: 'execution-1',
      concreteKind: 'EXECUTION' as const,
      actionId: 'action-1',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      manifestRevision: 1,
      status: 'IN_PROGRESS' as const,
      attemptCount: 5,
      startedAt: '2026-08-06T00:00:01.000Z',
    };
    await store.transaction(async (repos) => {
      await repos.aggregates.insert(action);
      await repos.executions.insert(execution);
      for (let number = 1; number <= 5; number += 1) {
        await repos.attempts.insert({
          schemaVersion: '1.0.0' as const,
          attemptId: `attempt-${number}`,
          attemptNumber: number,
          executionId: 'execution-1',
          actionId: 'action-1',
          resourceProjectId: 'project-1',
          effectiveProjectId: 'project-1',
          idempotencyKey: `idem-${number}`,
          status: 'SUCCEEDED' as const,
          policyContextRevision: 'policy-1',
          externalRevision: 'ext-1',
          correlationId: `corr-${number}`,
          startedAt: `2026-08-06T00:00:0${number}.000Z`,
        });
      }
    });
    const adapter = new ExternalActionActivityAdapter(store);
    const queue = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const root = queue.items[0]!.root;
    const stageIds: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await adapter.readStages(ADAPTER_SCOPE, root, cursor, 2);
      stageIds.push(...page.stages.map((stage) => stage.stageId));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(stageIds).toEqual(['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4', 'attempt-5']);
  });
});

// ---------------------------------------------------------------------------
// R2-4: Ask real attempt identity (no fabricated fallback)
// ---------------------------------------------------------------------------

describe('R2-4 Ask attempt identity', () => {
  it('exposes the authoritative AnswerRunAttempt id and no fallback when absent', async () => {
    const read = new InMemoryAskActivityRead();
    read.seedRun({ ...answerRunOf(1), attemptId: 'attempt-1' });
    const adapter = new AskActivityAdapter(read);
    const queue = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const root = queue.items[0]!.root;
    const detail = await adapter.readDetail(ADAPTER_SCOPE, root);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.attemptId).toBe('attempt-1');
    // The authoritative id is used verbatim — never a synthesized fallback
    // like `attempt-${answerRunId}`.
    expect(detail.attempts[0]?.attemptId).not.toContain(root.activityId);
    expect(detail.attempts[0]?.attemptId).not.toBe(`attempt-${root.activityId}`);
  });

  it('does not fabricate an attempt when the Domain has none', async () => {
    const read = new InMemoryAskActivityRead();
    // No attemptId on the run (no AnswerRunAttempt row exists).
    read.seedRun({ ...answerRunOf(1), attemptId: undefined, attemptNumber: 0 });
    const adapter = new AskActivityAdapter(read);
    const queue = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const detail = await adapter.readDetail(ADAPTER_SCOPE, queue.items[0]!.root);
    expect(detail.attempts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R2-5: sensitivity/access revalidation → same NOT_FOUND
// ---------------------------------------------------------------------------

describe('R2-5 sensitivity/access revalidation (adapter deny)', () => {
  it('returns NOT_FOUND when the owning-Domain read denies access', async () => {
    // A fake Ask read that mimics the PostgreSQL access predicate: a run with
    // sensitivity 'restricted' is only readable by a 'restricted' clearance.
    const read: AskActivityReadPort = {
      async listAnswerRuns() {
        return { runs: [] };
      },
      async getAnswerRun(input) {
        if (input.sensitivityClearance !== 'restricted') return undefined;
        return {
          answerRunId: 'run-1',
          projectId: input.projectId,
          state: 'RUNNING',
          attemptId: 'attempt-1',
          attemptNumber: 1,
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:01.000Z',
        };
      },
      async listAnswerRunEvents() {
        return [];
      },
    };
    const adapter = new AskActivityAdapter(read);
    const queue = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const root = queue.items[0]?.root ?? {
      schemaVersion: '1.0.0',
      rootKind: 'RUN',
      activityId: 'run-1',
      domainKind: 'ASK',
      domainResourceKind: 'AnswerRun',
      domainResourceId: 'run-1',
      resourceProjectId: 'project-1',
      resourceHref: '/run-1',
      runId: 'run-1',
    };
    // Inadequate sensitivity clearance → the read denies → NOT_FOUND.
    const deniedScope: ActivityAdapterScopeV1 = {
      ...ADAPTER_SCOPE,
      sensitivityClearance: 'public',
    };
    await expect(adapter.readDetail(deniedScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(adapter.readStages(deniedScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(adapter.readEvents(deniedScope, root)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Adequate clearance → found.
    const grantedScope: ActivityAdapterScopeV1 = {
      ...ADAPTER_SCOPE,
      sensitivityClearance: 'restricted',
    };
    const detail = await adapter.readDetail(grantedScope, root);
    expect(detail.root.activityId).toBe('run-1');
  });
});

// ---------------------------------------------------------------------------
// R2-6: multi-page watermark aggregation
// ---------------------------------------------------------------------------

describe('R2-6 multi-page watermark aggregation', () => {
  it('aggregates the newest source time and worst lag/status across pages', async () => {
    const readModel = createInMemoryActivityReadModelStore();
    const firstPage: ActivityQueuePageV1 = {
      items: [],
      metadata: {
        schemaVersion: '1.0.0',
        snapshotRevision: 1,
        generatedAt: '2026-08-06T00:00:01.000Z',
        sourceUpdatedAt: '2026-08-06T00:00:01.000Z',
        freshness: 'CURRENT',
        adapterStatus: 'AVAILABLE',
        partial: false,
        lagMilliseconds: 10,
      },
      nextCursor: 'cursor-1',
    };
    const secondPage: ActivityQueuePageV1 = {
      items: [],
      metadata: {
        schemaVersion: '1.0.0',
        snapshotRevision: 1,
        generatedAt: '2026-08-06T00:00:02.000Z',
        sourceUpdatedAt: '2026-08-06T00:00:02.000Z', // NEWER than page 1
        freshness: 'LAGGING',
        adapterStatus: 'DEGRADED',
        partial: true,
        lagMilliseconds: 500, // WORSE than page 1
      },
    };
    let call = 0;
    const adapter: ActivityAdapterPort = {
      adapterId: 'sources-adapter',
      domainKind: 'SOURCES',
      domainKinds: ['SOURCES'],
      async readQueue() {
        call += 1;
        return call === 1 ? firstPage : secondPage;
      },
      async readDetail() {
        throw new Error('not used');
      },
      async readStages() {
        return { stages: [], metadata: firstPage.metadata };
      },
      async readEvents() {
        return { events: [], metadata: firstPage.metadata };
      },
      async canAccess() {
        return true;
      },
      health() {
        return { status: 'AVAILABLE' };
      },
    };
    const registry: ActivityAdapterRegistryPort = {
      adapters: [adapter],
      adapterFor(domainKind) {
        return adapter.domainKind === domainKind ? adapter : undefined;
      },
      healthSummaries() {
        return { [adapter.adapterId]: adapter.health() };
      },
    };
    const builder = new ActivityProjectionBuilder(registry, readModel);
    const result = await builder.buildProjectProjection(ADAPTER_SCOPE);
    const watermark = result.watermarks.find((w) => w.adapterId === 'sources-adapter');
    // Newest source time and worst lag are aggregated, not overwritten by the
    // last page.
    expect(watermark?.sourceUpdatedAt).toBe('2026-08-06T00:00:02.000Z');
    expect(watermark?.lagMilliseconds).toBe(500);
    expect(watermark?.adapterStatus).toBe('DEGRADED');
    // Degraded without a thrown failure is still a partial build.
    expect(result.partial).toBe(true);
    expect(result.adapterStatus).toBe('DEGRADED');
  });
});
