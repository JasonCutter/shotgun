import { describe, expect, it } from 'vitest';

import { InMemoryPolicyHistoryReadAdapter } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import {
  comparePolicyHistoryEntries,
  isPolicyHistoryAfter,
  paginatePolicyHistory,
  type PolicyHistoryEntry,
} from '../../modules/settings-policy/src/index.js';

const entry = (
  overrides: Partial<PolicyHistoryEntry> & { eventId: string },
): PolicyHistoryEntry => ({
  projectId: 'p1',
  actorId: 'actor-1',
  actionName: 'SETTINGS_COMMAND_APPLIED',
  riskLevel: 'LOW',
  details: {},
  timestamp: '2026-08-08T00:00:00.000Z',
  ...overrides,
});

describe('settings-policy WP2-A Policy History read capability', () => {
  describe('stable ordering and keyset cursor', () => {
    it('orders by timestamp then eventId (deterministic tie-break)', () => {
      const a = entry({ eventId: 'e-2', timestamp: '2026-08-08T00:00:00.000Z' });
      const b = entry({ eventId: 'e-1', timestamp: '2026-08-08T00:00:00.000Z' });
      const c = entry({ eventId: 'e-0', timestamp: '2026-08-07T00:00:00.000Z' });
      const sorted = [a, b, c].sort(comparePolicyHistoryEntries);
      expect(sorted.map((e) => e.eventId)).toEqual(['e-0', 'e-1', 'e-2']);
    });

    it('keyset predicate is strictly after the cursor tuple', () => {
      const at = entry({ eventId: 'e-1', timestamp: '2026-08-08T00:00:00.000Z' });
      const before = entry({ eventId: 'e-0', timestamp: '2026-08-08T00:00:00.000Z' });
      const after = entry({ eventId: 'e-2', timestamp: '2026-08-08T00:00:00.000Z' });
      const cursor = { timestamp: '2026-08-08T00:00:00.000Z', eventId: 'e-1' };
      expect(isPolicyHistoryAfter(before, cursor)).toBe(false);
      expect(isPolicyHistoryAfter(at, cursor)).toBe(false);
      expect(isPolicyHistoryAfter(after, cursor)).toBe(true);
    });

    it('paginates with a next cursor and resumes on later timestamps', () => {
      const entries = [
        entry({ eventId: 'e-1', timestamp: '2026-08-08T00:00:00.000Z' }),
        entry({ eventId: 'e-2', timestamp: '2026-08-09T00:00:00.000Z' }),
        entry({ eventId: 'e-3', timestamp: '2026-08-10T00:00:00.000Z' }),
      ].sort(comparePolicyHistoryEntries);

      const page1 = paginatePolicyHistory(entries, { projectId: 'p1', limit: 2 });
      expect(page1.entries.map((e) => e.eventId)).toEqual(['e-1', 'e-2']);
      expect(page1.nextCursor).toEqual({ timestamp: '2026-08-09T00:00:00.000Z', eventId: 'e-2' });

      const page2 = paginatePolicyHistory(entries, {
        projectId: 'p1',
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.entries.map((e) => e.eventId)).toEqual(['e-3']);
      expect(page2.nextCursor).toBeUndefined();
    });
  });

  describe('InMemoryPolicyHistoryReadAdapter', () => {
    it('filters by project and preserves append-only semantics', async () => {
      const adapter = new InMemoryPolicyHistoryReadAdapter();
      adapter.appendEntry(entry({ eventId: 'e-1', projectId: 'p1' }));
      adapter.appendEntry(entry({ eventId: 'e-2', projectId: 'p1', actionName: 'POLICY_CHANGED' }));
      adapter.appendEntry(entry({ eventId: 'e-3', projectId: 'p2' }));

      const result = await adapter.listPolicyHistory({ projectId: 'p1', limit: 10 });
      expect(result.entries.map((e) => e.eventId)).toEqual(['e-1', 'e-2']);
      expect(result.nextCursor).toBeUndefined();

      // Append-only: duplicate eventId rejected
      expect(() => adapter.appendEntry(entry({ eventId: 'e-1', projectId: 'p1' }))).toThrow();
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
