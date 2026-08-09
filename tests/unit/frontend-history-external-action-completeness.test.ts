import { describe, expect, it } from 'vitest';

import { ExternalActionHistoryAdapter } from '../../adapters/frontend-history-external-action/src/index.js';
import { InMemoryPayloadStateStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import type { ExternalActionRepositoryBoundaryPort } from '../../modules/frontend-external-action/src/index.js';
import type {
  ActionAuditEventV1,
  ExternalActionV1,
  ResultV1,
} from '../../packages/contracts/src/index.js';

/**
 * FE-P5-S2 WP4 — External Action History adapter completeness (GPT Round 1 B).
 * The mandatory RESULT + AUDIT_EVENT families must BOTH be projected, and the
 * audit must be paginated until exhausted (no arbitrary total cap).
 */

const action = (actionId: string): ExternalActionV1 =>
  ({
    schemaVersion: '1.0.0',
    actionId,
    resourceProjectId: 'p1',
    effectiveProjectId: 'p1',
    actionKind: 'EXTERNAL_ACTION',
    status: 'SUCCEEDED',
    version: 1,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  }) as unknown as ExternalActionV1;

const auditEvent = (index: number): ActionAuditEventV1 =>
  ({
    schemaVersion: '1.0.0',
    auditEventId: `audit:${index}`,
    actionId: 'action-1',
    resourceProjectId: 'p1',
    effectiveProjectId: 'p1',
    sequence: index + 1,
    category: 'EXECUTION',
    eventData: { message: `event ${index}`, refs: [] },
    occurredAt: `2026-08-09T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
  }) as unknown as ActionAuditEventV1;

const result = (index: number): ResultV1 =>
  ({
    schemaVersion: '1.0.0',
    resultId: `result:${index}`,
    actionId: 'action-1',
    resourceProjectId: 'p1',
    effectiveProjectId: 'p1',
    executionId: `execution-${index}`,
    externalId: `external-${index}`,
    observedDigest: `digest-${index}`,
    completedAt: `2026-08-09T01:00:${String(index % 60).padStart(2, '0')}.000Z`,
    outputRefs: [],
  }) as unknown as ResultV1;

/** Deterministic paging helper shared by the mock boundary. */
const page = <T>(items: readonly T[], limit: number, offset: number): readonly T[] =>
  items.slice(offset, offset + limit);

/** Mock External Action boundary: 1 action, 1200 audit events, 3 results. */
const makeBoundary = (): ExternalActionRepositoryBoundaryPort => {
  const audits = Array.from({ length: 1200 }, (_, i) => auditEvent(i));
  const results = [result(1), result(2), result(3)];
  const repositories = {
    aggregates: {
      listByProject: async (_projectId: string, limit: number, offset: number) =>
        offset === 0 ? [action('action-1')] : [],
    },
    audit: {
      listByAction: async (_actionId: string, limit: number, offset: number) =>
        page(audits, limit, offset),
    },
    results: {
      listByAction: async (_actionId: string, limit: number, offset: number) =>
        page(results, limit, offset),
      findById: async () => undefined,
    },
  };
  const boundary = {
    transaction: async <T>(run: (repositories: unknown) => Promise<T>): Promise<T> =>
      run(repositories),
    transactionWithHandle: async <T>(run: (handle: unknown) => Promise<T>): Promise<T> =>
      run({ repositories }),
  };
  return boundary as unknown as ExternalActionRepositoryBoundaryPort;
};

describe('FE-P5-S2 WP4 External Action History adapter completeness (GPT Round 1 B)', () => {
  it('projects BOTH RESULT and AUDIT_EVENT families', async () => {
    const payloadState = new InMemoryPayloadStateStore('EXTERNAL_ACTION');
    const adapter = new ExternalActionHistoryAdapter(makeBoundary(), payloadState);
    const entries = await adapter.readHistory('p1');
    const kinds = new Set(entries.map((entry) => entry.sourceEventKind));
    expect(kinds).toContain('AUDIT_EVENT');
    expect(kinds).toContain('RESULT');
  });

  it('paginates audit until exhausted (1200 events → all projected, no cap)', async () => {
    const payloadState = new InMemoryPayloadStateStore('EXTERNAL_ACTION');
    const adapter = new ExternalActionHistoryAdapter(makeBoundary(), payloadState);
    const entries = await adapter.readHistory('p1');
    const auditEntries = entries.filter((entry) => entry.sourceEventKind === 'AUDIT_EVENT');
    // 1200 > any previous hard cap (1000); ALL must be projected.
    expect(auditEntries).toHaveLength(1200);
    expect(new Set(auditEntries.map((entry) => entry.sourceEventId)).size).toBe(1200);
  });

  it('projects every Result row with sourceEventKind=RESULT and sourceEventId=resultId', async () => {
    const payloadState = new InMemoryPayloadStateStore('EXTERNAL_ACTION');
    const adapter = new ExternalActionHistoryAdapter(makeBoundary(), payloadState);
    const entries = await adapter.readHistory('p1');
    const resultEntries = entries.filter((entry) => entry.sourceEventKind === 'RESULT');
    expect(resultEntries).toHaveLength(3);
    expect(resultEntries.map((entry) => entry.sourceEventId).sort()).toEqual([
      'result:1',
      'result:2',
      'result:3',
    ]);
  });

  it('resolveHistoryEntry resolves an audit identity authoritatively', async () => {
    const payloadState = new InMemoryPayloadStateStore('EXTERNAL_ACTION');
    const adapter = new ExternalActionHistoryAdapter(makeBoundary(), payloadState);
    const entry = await adapter.resolveHistoryEntry('p1', 'AUDIT_EVENT', 'audit:50');
    expect(entry).toBeDefined();
    expect(entry!.sourceEventId).toBe('audit:50');
    expect(entry!.sourceSequence).toBe(51);
    // Unresolved identity fails closed.
    const missing = await adapter.resolveHistoryEntry('p1', 'AUDIT_EVENT', 'audit:999999');
    expect(missing).toBeUndefined();
  });
});
