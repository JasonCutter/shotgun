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
  // Default: no-op redaction (test adapter has no payload state).
  async redactEntry(record) {
    return record;
  },
});

/**
 * Registry helper: always includes the four mandatory adapter families
 * (GPT Round 2 A — exact-set validation). Callers pass only the adapters they
 * want to vary; an empty array or omitted argument falls back to an empty
 * default adapter for that family.
 */
const mandatoryAdapters = (
  canonical: HistoryAdapterPort[] = [],
  review: HistoryAdapterPort[] = [],
  externalAction: HistoryAdapterPort[] = [],
  policy: HistoryAdapterPort[] = [],
): HistoryAdapterPort[] => [
  ...(canonical.length > 0 ? canonical : [makeAdapter('history-canonical', 'CANONICAL', [])]),
  ...(review.length > 0 ? review : [makeAdapter('history-review', 'REVIEW', [])]),
  ...(externalAction.length > 0
    ? externalAction
    : [makeAdapter('history-external-action', 'EXTERNAL_ACTION', [])]),
  ...(policy.length > 0 ? policy : [makeAdapter('history-policy', 'POLICY', [])]),
];

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
      const healthy = mandatoryAdapters([
        makeAdapter('history-canonical', 'CANONICAL', [
          { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
        ]),
      ]);
      // First build: complete revision 1 committed.
      const builder1 = new HistoryProjectionBuilder(createHistoryAdapterRegistry(healthy), store);
      const first = await builder1.buildProjectProjection('p1');
      expect(first.snapshotRevision).toBe(1);
      expect(first.indexCount).toBe(1);

      // Second build with one failing adapter: MUST throw and commit nothing.
      const failing = mandatoryAdapters(
        [
          makeAdapter('history-canonical', 'CANONICAL', [
            { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
          ]),
        ],
        [],
        [],
        [makeAdapter('history-policy', 'POLICY', [], true)],
      );
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

    it('registry requires the exact mandatory adapter set (GPT Round 2 A)', () => {
      // Missing mandatory family → fail closed at wiring time.
      expect(() =>
        createHistoryAdapterRegistry([makeAdapter('history-canonical', 'CANONICAL', [])]),
      ).toThrow(/HISTORY_ADAPTER_REGISTRY_MISSING/);
      // Duplicate mandatory family → fail closed.
      expect(() =>
        createHistoryAdapterRegistry([
          makeAdapter('history-canonical', 'CANONICAL', []),
          makeAdapter('history-canonical', 'CANONICAL', []),
          makeAdapter('history-review', 'REVIEW', []),
          makeAdapter('history-external-action', 'EXTERNAL_ACTION', []),
          makeAdapter('history-policy', 'POLICY', []),
        ]),
      ).toThrow(/HISTORY_ADAPTER_REGISTRY_DUPLICATE/);
      // Exactly one of each mandatory family → accepted.
      expect(() => createHistoryAdapterRegistry(mandatoryAdapters())).not.toThrow();
    });
  });

  describe('HistoryProductCoordinator', () => {
    const canonicalAdapter = (ids: readonly { id: string; occurredAt: string }[]) =>
      makeAdapter('history-canonical', 'CANONICAL', ids);

    it('denies when the principal lacks history:read', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const registry = createHistoryAdapterRegistry(mandatoryAdapters([canonicalAdapter([])]));
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
      const registry = createHistoryAdapterRegistry(mandatoryAdapters([canonicalAdapter([])]));
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
      const registry = createHistoryAdapterRegistry(mandatoryAdapters(adapters));
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
      const registry = createHistoryAdapterRegistry(mandatoryAdapters([canonicalAdapter([])]));
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
      const registry = createHistoryAdapterRegistry(mandatoryAdapters(adapters));
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
          redactEntry: async (record) => record,
        },
      ];
      const registry = createHistoryAdapterRegistry(mandatoryAdapters(adapters));
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

    it('audit capability is separate from history:read (GPT Round 2 G)', () => {
      expect(historyCapabilitiesForScope(scope({ accessScope: ['history:read'] }))).not.toContain(
        'READ_HISTORY_AUDIT',
      );
      expect(
        historyCapabilitiesForScope(scope({ accessScope: ['history:read', 'history:audit:read'] })),
      ).toContain('READ_HISTORY_AUDIT');
      expect(
        historyCapabilitiesForScope(scope({ accessScope: ['history:read', 'action:audit:read'] })),
      ).toContain('READ_HISTORY_AUDIT');
      expect(historyCapabilitiesForScope(scope({ accessScope: ['owner'] }))).toContain(
        'READ_HISTORY_AUDIT',
      );
    });

    it('List hides EXTERNAL_ACTION AUDIT_EVENT rows without the audit capability (G)', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const externalAction = makeAdapter('history-external-action', 'EXTERNAL_ACTION', [
        { id: 'audit:1', occurredAt: '2026-08-09T03:00:00.000Z', sourceEventKind: 'AUDIT_EVENT' },
        { id: 'result:1', occurredAt: '2026-08-09T02:00:00.000Z', sourceEventKind: 'RESULT' },
      ]);
      const registry = createHistoryAdapterRegistry(
        mandatoryAdapters(
          [
            makeAdapter('history-canonical', 'CANONICAL', [
              { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
            ]),
          ],
          [],
          [externalAction],
          [],
        ),
      );
      const builder = new HistoryProjectionBuilder(registry, store);
      await builder.buildProjectProjection('p1');
      const coordinator = new HistoryProductCoordinator(store.index, registry);

      // history:read only → RESULT visible, AUDIT_EVENT hidden non-disclosingly.
      const withoutAudit = await coordinator.listHistoryWorkspace(
        scope({ accessScope: ['history:read'] }),
        { schemaVersion: '1.0.0', resourceProjectId: 'p1', limit: 20 },
      );
      const kinds = withoutAudit.entries.map((e) => `${e.domainKind}:${e.sourceEventKind}`);
      expect(kinds).toContain('EXTERNAL_ACTION:RESULT');
      expect(kinds).not.toContain('EXTERNAL_ACTION:AUDIT_EVENT');
      expect(kinds).toContain('CANONICAL:CANONICAL_CLAIM_ADDED');

      // history:read + audit capability → AUDIT_EVENT visible.
      const withAudit = await coordinator.listHistoryWorkspace(
        scope({ accessScope: ['history:read', 'history:audit:read'] }),
        { schemaVersion: '1.0.0', resourceProjectId: 'p1', limit: 20 },
      );
      expect(
        withAudit.entries.some(
          (e) => e.domainKind === 'EXTERNAL_ACTION' && e.sourceEventKind === 'AUDIT_EVENT',
        ),
      ).toBe(true);
    });

    it('getHistoryEntry denies AUDIT_EVENT detail without the audit capability (G)', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const externalAction = makeAdapter('history-external-action', 'EXTERNAL_ACTION', [
        { id: 'audit:1', occurredAt: '2026-08-09T03:00:00.000Z', sourceEventKind: 'AUDIT_EVENT' },
      ]);
      const registry = createHistoryAdapterRegistry(
        mandatoryAdapters([], [], [externalAction], []),
      );
      const builder = new HistoryProjectionBuilder(registry, store);
      await builder.buildProjectProjection('p1');
      const coordinator = new HistoryProductCoordinator(store.index, registry);

      // history:read only → same non-disclosing NOT_FOUND.
      await expect(
        coordinator.getHistoryEntry(scope({ accessScope: ['history:read'] }), {
          schemaVersion: '1.0.0',
          resourceProjectId: 'p1',
          historyEntryId: 'history:p1:audit:1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // With the audit capability the authoritative entry resolves.
      const ok = await coordinator.getHistoryEntry(
        scope({ accessScope: ['history:read', 'action:audit:read'] }),
        { schemaVersion: '1.0.0', resourceProjectId: 'p1', historyEntryId: 'history:p1:audit:1' },
      );
      expect(ok.entry.sourceEventId).toBe('audit:1');
    });

    it('List applies read-time payload redaction through the owning adapter (F)', async () => {
      const store = createInMemoryHistoryReadModelStore();
      const redactingCanonical: HistoryAdapterPort = {
        ...makeAdapter('history-canonical', 'CANONICAL', [
          { id: 'c1', occurredAt: '2026-08-09T01:00:00.000Z' },
        ]),
        // Simulate a purge that happened after the projection was cached.
        async redactEntry(record) {
          return {
            ...record,
            payloadAvailability: 'PURGED_BY_POLICY',
            payloadSnapshot: { digest: 'sha256:redacted' },
          };
        },
      };
      const registry = createHistoryAdapterRegistry(mandatoryAdapters([redactingCanonical]));
      const builder = new HistoryProjectionBuilder(registry, store);
      await builder.buildProjectProjection('p1');
      const coordinator = new HistoryProductCoordinator(store.index, registry);
      const page = await coordinator.listHistoryWorkspace(scope(), {
        schemaVersion: '1.0.0',
        resourceProjectId: 'p1',
        limit: 20,
      });
      expect(page.entries[0]!.payloadAvailability).toBe('PURGED_BY_POLICY');
      expect(page.entries[0]!.payloadSnapshot).toEqual({ digest: 'sha256:redacted' });
    });
  });
});
