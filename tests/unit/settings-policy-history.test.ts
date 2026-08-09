import { describe, expect, it } from 'vitest';

import { InMemoryPolicyHistoryReadAdapter } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import {
  comparePolicyHistoryEntries,
  isPolicyHistoryAfter,
  paginatePolicyHistory,
  type PolicyHistoryEntry,
  type PolicyHistorySourceKind,
} from '../../modules/settings-policy/src/index.js';

const entry = (
  overrides: Partial<PolicyHistoryEntry> & {
    sourceKind: PolicyHistorySourceKind;
    sourceId: string;
  },
): PolicyHistoryEntry => ({
  projectId: 'p1',
  details: {},
  timestamp: '2026-08-08T00:00:00.000Z',
  ...overrides,
});

describe('settings-policy WP2-A Policy History read capability', () => {
  describe('stable ordering and keyset cursor over the three authoritative sources', () => {
    it('orders by timestamp, then sourceKind, then sourceId (deterministic tie-break)', () => {
      const a = entry({
        sourceKind: 'SETTINGS_AUDIT_EVENT',
        sourceId: 'audit-2',
        timestamp: '2026-08-08T00:00:00.000Z',
      });
      const b = entry({
        sourceKind: 'SETTINGS_AUDIT_EVENT',
        sourceId: 'audit-1',
        timestamp: '2026-08-08T00:00:00.000Z',
      });
      const c = entry({
        sourceKind: 'SETTINGS_REVISION',
        sourceId: '2',
        timestamp: '2026-08-08T00:00:00.000Z',
      });
      const d = entry({
        sourceKind: 'SETTINGS_REVISION',
        sourceId: '1',
        timestamp: '2026-08-07T00:00:00.000Z',
      });
      const sorted = [a, b, c, d].sort(comparePolicyHistoryEntries);
      expect(sorted.map((e) => `${e.sourceKind}:${e.sourceId}`)).toEqual([
        'SETTINGS_REVISION:1',
        'SETTINGS_AUDIT_EVENT:audit-1',
        'SETTINGS_AUDIT_EVENT:audit-2',
        'SETTINGS_REVISION:2',
      ]);
    });

    it('keyset predicate is strictly after the cursor tuple', () => {
      const at = entry({
        sourceKind: 'SETTINGS_AUDIT_EVENT',
        sourceId: 'e-1',
        timestamp: '2026-08-08T00:00:00.000Z',
      });
      const before = entry({
        sourceKind: 'SETTINGS_AUDIT_EVENT',
        sourceId: 'e-0',
        timestamp: '2026-08-08T00:00:00.000Z',
      });
      const after = entry({
        sourceKind: 'SETTINGS_AUDIT_EVENT',
        sourceId: 'e-2',
        timestamp: '2026-08-08T00:00:00.000Z',
      });
      const cursor = {
        timestamp: '2026-08-08T00:00:00.000Z',
        sourceKind: 'SETTINGS_AUDIT_EVENT' as const,
        sourceId: 'e-1',
      };
      expect(isPolicyHistoryAfter(before, cursor)).toBe(false);
      expect(isPolicyHistoryAfter(at, cursor)).toBe(false);
      expect(isPolicyHistoryAfter(after, cursor)).toBe(true);
    });

    it('paginates with a next cursor and resumes on later timestamps across sources', () => {
      const entries = [
        entry({
          sourceKind: 'SETTINGS_REVISION',
          sourceId: '1',
          timestamp: '2026-08-08T00:00:00.000Z',
        }),
        entry({
          sourceKind: 'SETTINGS_AUDIT_EVENT',
          sourceId: 'e-2',
          timestamp: '2026-08-09T00:00:00.000Z',
        }),
        entry({
          sourceKind: 'POLICY_CONTEXT_REVISION',
          sourceId: '1',
          timestamp: '2026-08-10T00:00:00.000Z',
        }),
      ].sort(comparePolicyHistoryEntries);

      const page1 = paginatePolicyHistory(entries, { projectId: 'p1', limit: 2 });
      expect(page1.entries.map((e) => `${e.sourceKind}:${e.sourceId}`)).toEqual([
        'SETTINGS_REVISION:1',
        'SETTINGS_AUDIT_EVENT:e-2',
      ]);
      expect(page1.nextCursor).toEqual({
        timestamp: '2026-08-09T00:00:00.000Z',
        sourceKind: 'SETTINGS_AUDIT_EVENT',
        sourceId: 'e-2',
      });

      const page2 = paginatePolicyHistory(entries, {
        projectId: 'p1',
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.entries.map((e) => `${e.sourceKind}:${e.sourceId}`)).toEqual([
        'POLICY_CONTEXT_REVISION:1',
      ]);
      expect(page2.nextCursor).toBeUndefined();
    });
  });

  describe('InMemoryPolicyHistoryReadAdapter', () => {
    it('filters by project and preserves append-only semantics across sources', async () => {
      const adapter = new InMemoryPolicyHistoryReadAdapter();
      adapter.appendEntry(
        entry({
          sourceKind: 'SETTINGS_REVISION',
          sourceId: '1',
          projectId: 'p1',
          details: { snapshot: true },
        }),
      );
      adapter.appendEntry(
        entry({
          sourceKind: 'SETTINGS_AUDIT_EVENT',
          sourceId: 'audit-1',
          projectId: 'p1',
          actorId: 'actor-1',
          actionName: 'POLICY_CHANGED',
          riskLevel: 'LOW',
        }),
      );
      adapter.appendEntry(
        entry({ sourceKind: 'SETTINGS_REVISION', sourceId: '1', projectId: 'p2' }),
      );

      const result = await adapter.listPolicyHistory({ projectId: 'p1', limit: 10 });
      expect(result.entries.map((e) => `${e.sourceKind}:${e.sourceId}`)).toEqual([
        'SETTINGS_AUDIT_EVENT:audit-1',
        'SETTINGS_REVISION:1',
      ]);
      expect(result.entries[0]!.actionName).toBe('POLICY_CHANGED');
      expect(result.nextCursor).toBeUndefined();

      // Append-only: duplicate sourceId rejected
      expect(() =>
        adapter.appendEntry(
          entry({ sourceKind: 'SETTINGS_REVISION', sourceId: '1', projectId: 'p1' }),
        ),
      ).toThrow();
    });

    it('rejects invalid limit and missing projectId', async () => {
      const adapter = new InMemoryPolicyHistoryReadAdapter();
      await expect(adapter.listPolicyHistory({ projectId: '', limit: 10 })).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
      expect(() => paginatePolicyHistory([], { projectId: 'p1', limit: 0 })).toThrow(
        /positive integer/,
      );
    });
  });
});
