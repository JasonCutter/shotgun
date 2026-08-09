import { describe, expect, it } from 'vitest';

import {
  createInMemoryHistoryReadModelStore,
  InMemoryHistoryIndexStore,
} from '../../adapters/frontend-history-in-memory/src/index.js';
import {
  HistoryProductCoordinator,
  HistoryProjectionBuilder,
  compareHistoryRecords,
  createHistoryAdapterRegistry,
  historyCapabilitiesForScope,
  isHistoryRecordAfter,
  type HistoryAdapterPort,
  type HistoryIndexRecordV1,
  type HistoryProductScopeV1,
} from '../../modules/frontend-history/src/index.js';
import type { HistoryCursorV1, HistoryEntryV1 } from '../../packages/contracts/src/index.js';

const entry = (
  overrides: Partial<HistoryEntryV1> & { sourceEventId: string; occurredAt: string },
): HistoryEntryV1 => ({
  schemaVersion: '1.0.0',
  historyEntryId: `history:p1:${overrides.sourceEventId}`,
  resourceProjectId: 'p1',
  domainKind: 'CANONICAL',
  domainResourceKind: 'CANONICAL_CLAIM',
  domainResourceId: `claim:${overrides.sourceEventId}`,
  sourceEventKind: 'CANONICAL_CLAIM_ADDED',
  payloadAvailability: 'AVAILABLE',
  projectedAt: '2026-08-09T00:00:00.000Z',
  ...overrides,
});

const record = (input: HistoryEntryV1): HistoryIndexRecordV1 => input;

const scope = (overrides: Partial<HistoryProductScopeV1> = {}): HistoryProductScopeV1 => ({
  principalId: 'actor-1',
  activeProjectId: 'p1',
  accessRevision: 'access:p1',
  policyContextRevision: 'policy:p1',
  accessScope: ['owner'],
  sensitivityClearance: 'private',
  ...overrides,
});

/**
 * Test adapter helper: `readHistory` returns `sourceEventIds` mapped through
 * `entry`, and `resolveHistoryEntry` matches authoritatively within that same
 * set (mirrors the real adapter contract — fail-closed when unresolved).
 */
const makeAdapter = (
  adapterId: string,
  domainKind: HistoryAdapterPort['domainKind'],
  sourceEventIds: readonly { id: string; occurredAt: string; sourceEventKind?: string }[],
  failRead = false,
): HistoryAdapterPort => ({
  adapterId,
  domainKind,
  async readHistory() {
    if (failRead) throw new Error(`${adapterId} source unavailable`);
    return sourceEventIds.map((item) =>
      entry({
        sourceEventId: item.id,
        occurredAt: item.occurredAt,
        ...(item.sourceEventKind === undefined ? {} : { sourceEventKind: item.sourceEventKind }),
        ...(domainKind === 'CANONICAL' ? {} : { domainKind }),
      }),
    );
  },
  async resolveHistoryEntry(_projectId, sourceEventKind, sourceEventId) {
    const item = sourceEventIds.find(
      (candidate) =>
        candidate.id === sourceEventId &&
        (candidate.sourceEventKind ?? 'CANONICAL_CLAIM_ADDED') === sourceEventKind,
    );
    return item === undefined
      ? undefined
      : entry({
          sourceEventId: item.id,
          occurredAt: item.occurredAt,
          ...(item.sourceEventKind === undefined ? {} : { sourceEventKind: item.sourceEventKind }),
          ...(domainKind === 'CANONICAL' ? {} : { domainKind }),
        });
  },
});

describe('FE-P5-S2 WP4 Federated History projection', () => {
  describe('frozen tuple ordering + cursor', () => {
    it('orders by occurredAt DESC with domain/event/id/sequence tie-break', () => {
      const a = entry({ sourceEventId: 'a', occurredAt: '2026-08-09T01:00:00.000Z' });
      const b = entry({ sourceEventId: 'b', occurredAt: '2026-08-09T00:00:00.000Z' });
      const c = entry({
        sourceEventId: 'c',
        occurredAt: '2026-08-09T01:00:00.000Z',
        sourceEventKind: 'DECISION',
      });
      // a and c share occurredAt; tie-break on sourceEventKind: CANONICAL < DECISION
      const sorted = [b, record(a), record(c)].sort(compareHistoryRecords);
      expect(sorted.map((r) => r.sourceEventId)).toEqual(['a', 'c', 'b']);
    });

    it('keyset predicate: same timestamp later row detected by tie-break', () => {
      const cursor: HistoryCursorV1 = {
        schemaVersion: '1.0.0',
        occurredAt: '2026-08-09T01:00:00.000Z',
        domainKind: 'CANONICAL',
        sourceEventKind: 'CANONICAL_CLAIM_ADDED',
        sourceEventId: 'a',
      };
      const after = entry({
        sourceEventId: 'b',
        occurredAt: '2026-08-09T01:00:00.000Z',
        sourceSequence: 2,
      });
      expect(isHistoryRecordAfter(after, cursor)).toBe(true);
    });
  });

  describe('in-memory index store', () => {
    it('upserts by projection identity and returns rows for the project', async () => {
      const store = new InMemoryHistoryIndexStore();
      await store.upsert(entry({ sourceEventId: 'a', occurredAt: '2026-08-09T01:00:00.000Z' }));
      const found = await store.findByIdentity({
        resourceProjectId: 'p1',
        historyEntryId: 'history:p1:a',
      });
      expect(found?.sourceEventId).toBe('a');
    });

    it('queryProject filters by domainKinds', async () => {
      const store = new InMemoryHistoryIndexStore();
      await store.upsert(entry({ sourceEventId: 'a', occurredAt: '2026-08-09T01:00:00.000Z' }));
      await store.upsert(
        entry({
          sourceEventId: 'b',
          occurredAt: '2026-08-09T00:00:00.000Z',
          domainKind: 'POLICY',
          sourceEventKind: 'SETTINGS_AUDIT_EVENT',
        }),
      );
      const page = await store.queryProject({
        resourceProjectId: 'p1',
        domainKinds: ['CANONICAL'],
        limit: 10,
      });
      expect(page.records).toHaveLength(1);
      expect(page.records[0]!.sourceEventId).toBe('a');
    });
  });

  describe('projection builder + commitProjectProjection', () => {
    it('builds a deterministic project projection with all-adapter watermarks', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const adapters: HistoryAdapterPort[] = [
        makeAdapter('history-canonical', 'CANONICAL', [
          { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
        ]),
        makeAdapter('history-review', 'REVIEW', [
          { id: 'r1', occurredAt: '2026-08-09T00:30:00.000Z', sourceEventKind: 'DECISION' },
        ]),
        makeAdapter('history-external-action', 'EXTERNAL_ACTION', []),
        makeAdapter('history-policy', 'POLICY', []),
      ];
      const registry = createHistoryAdapterRegistry(adapters);
      const builder = new HistoryProjectionBuilder(registry, store);
      const result = await builder.buildProjectProjection('p1');
      expect(result.snapshotRevision).toBe(1);
      expect(result.indexCount).toBe(2);
      expect(result.adapterStatus).toBe('AVAILABLE');
      expect(result.partial).toBe(false);
      expect(result.watermarks).toHaveLength(4);
      // Second build is revision 2 (monotonic) with same rows.
      const second = await builder.buildProjectProjection('p1');
      expect(second.snapshotRevision).toBe(2);
      expect(second.indexCount).toBe(2);
    });

    it('ANY adapter failure aborts the whole rebuild (no commit, previous projection stays)', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const healthy = [
        makeAdapter('history-canonical', 'CANONICAL', [
          { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
        ]),
        makeAdapter('history-policy', 'POLICY', []),
      ];
      // First build: complete revision 1 committed.
      const builder1 = new HistoryProjectionBuilder(createHistoryAdapterRegistry(healthy), store);
      const first = await builder1.buildProjectProjection('p1');
      expect(first.snapshotRevision).toBe(1);
      expect(first.indexCount).toBe(1);

      // Second build with one failing adapter: MUST throw and commit nothing.
      const failing = [
        makeAdapter('history-canonical', 'CANONICAL', [
          { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
        ]),
        makeAdapter('history-policy', 'POLICY', [], true),
      ];
      const builder2 = new HistoryProjectionBuilder(createHistoryAdapterRegistry(failing), store);
      await expect(builder2.buildProjectProjection('p1')).rejects.toThrow(
        /history-policy source unavailable/,
      );
      // Previous committed projection is untouched (still revision 1).
      const watermarks = await store.watermarks.readByProject('p1');
      expect(watermarks.every((w) => w.snapshotRevision === 1)).toBe(true);
      const rows = await store.index.queryProject({ resourceProjectId: 'p1', limit: 10 });
      expect(rows.records).toHaveLength(1);
      expect(rows.records[0]!.sourceEventId).toBe('c1');
    });
  });

  describe('HistoryProductCoordinator', () => {
    const canonicalAdapter = (ids: readonly { id: string; occurredAt: string }[]) =>
      makeAdapter('history-canonical', 'CANONICAL', ids);

    it('denies when the principal lacks history:read', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const registry = createHistoryAdapterRegistry([canonicalAdapter([])]);
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      await expect(
        coordinator.listHistoryWorkspace(scope({ accessScope: ['project:read'] }), {
          schemaVersion: '1.0.0',
          resourceProjectId: 'p1',
          limit: 20,
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    });

    it('rejects a request whose resourceProjectId does not match the active project', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const registry = createHistoryAdapterRegistry([canonicalAdapter([])]);
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      await expect(
        coordinator.listHistoryWorkspace(scope(), {
          schemaVersion: '1.0.0',
          resourceProjectId: 'other-project',
          limit: 20,
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
      await expect(
        coordinator.getHistoryEntry(scope(), {
          schemaVersion: '1.0.0',
          resourceProjectId: 'other-project',
          historyEntryId: 'history:p1:c1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lists projection entries with cursor pagination', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const adapters = [
        canonicalAdapter([
          { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
          { id: 'c2', occurredAt: '2026-08-09T00:00:00.000Z' },
          { id: 'c3', occurredAt: '2026-08-09T02:00:00.000Z' },
        ]),
      ];
      const registry = createHistoryAdapterRegistry(adapters);
      const builder = new HistoryProjectionBuilder(registry, store);
      await builder.buildProjectProjection('p1');
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      const page1 = await coordinator.listHistoryWorkspace(scope(), {
        schemaVersion: '1.0.0',
        resourceProjectId: 'p1',
        limit: 2,
      });
      expect(page1.entries).toHaveLength(2);
      expect(page1.entries[0]!.sourceEventId).toBe('c3');
      expect(page1.entries[1]!.sourceEventId).toBe('c1');
      expect(page1.nextCursor).toBeDefined();
      const page2 = await coordinator.listHistoryWorkspace(scope(), {
        schemaVersion: '1.0.0',
        resourceProjectId: 'p1',
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.entries).toHaveLength(1);
      expect(page2.entries[0]!.sourceEventId).toBe('c2');
      expect(page2.nextCursor).toBeUndefined();
    });

    it('getHistoryEntry is non-disclosing for a missing/cross-project id', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const registry = createHistoryAdapterRegistry([canonicalAdapter([])]);
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      await expect(
        coordinator.getHistoryEntry(scope(), {
          schemaVersion: '1.0.0',
          resourceProjectId: 'p1',
          historyEntryId: 'missing',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('getHistoryEntry re-resolves the authoritative Domain source (C)', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const adapters = [canonicalAdapter([{ id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' }])];
      const registry = createHistoryAdapterRegistry(adapters);
      const builder = new HistoryProjectionBuilder(registry, store);
      await builder.buildProjectProjection('p1');
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      const result = await coordinator.getHistoryEntry(scope(), {
        schemaVersion: '1.0.0',
        resourceProjectId: 'p1',
        historyEntryId: 'history:p1:c1',
      });
      // The entry comes from the authoritative adapter resolution, not a stale
      // projection snapshot: it carries the current projectedAt of the adapter.
      expect(result.entry.sourceEventId).toBe('c1');
      expect(result.entry.schemaVersion).toBe('1.0.0');
    });

    it('getHistoryEntry fails closed when the authoritative source is unresolved (C)', async () => {
      const store = createInMemoryHistoryReadModelStore();
      // readHistory projects c1, but resolveHistoryEntry never matches it.
      const adapters: HistoryAdapterPort[] = [
        {
          adapterId: 'history-canonical',
          domainKind: 'CANONICAL',
          readHistory: async () => [
            entry({ sourceEventId: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' }),
          ],
          resolveHistoryEntry: async () => undefined,
        },
      ];
      const registry = createHistoryAdapterRegistry(adapters);
      const builder = new HistoryProjectionBuilder(registry, store);
      await builder.buildProjectProjection('p1');
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      await expect(
        coordinator.getHistoryEntry(scope(), {
          schemaVersion: '1.0.0',
          resourceProjectId: 'p1',
          historyEntryId: 'history:p1:c1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('historyCapabilitiesForScope grants reads only with history:read scope', () => {
      expect(historyCapabilitiesForScope(scope({ accessScope: ['history:read'] }))).toContain(
        'LIST_HISTORY_WORKSPACE',
      );
      expect(historyCapabilitiesForScope(scope({ accessScope: ['owner'] }))).toContain(
        'READ_HISTORY_ENTRY',
      );
      expect(historyCapabilitiesForScope(scope({ accessScope: ['project:read'] }))).not.toContain(
        'LIST_HISTORY_WORKSPACE',
      );
      // No public refresh capability (GPT Round 1 E).
      expect(historyCapabilitiesForScope(scope({ accessScope: ['history:refresh'] }))).toEqual([]);
    });
  });
});
