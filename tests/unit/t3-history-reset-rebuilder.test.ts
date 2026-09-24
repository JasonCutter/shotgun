import { describe, expect, it } from 'vitest';

import { createInMemoryHistoryReadModelStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import { createProjectHistoryResetRebuilder } from '../../adapters/source-knowledge-reset-postgres/src/history-reset-rebuilder.js';
import {
  createHistoryAdapterRegistry,
  type HistoryAdapterPort,
} from '../../modules/frontend-history/src/index.js';
import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../packages/contracts/src/index.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';

const projectId = 't3-history-rebuilder-project';

const makeEntry = (domainKind: HistorySourceDomainKindV1, index: number): HistoryEntryV1 => ({
  schemaVersion: '1.0.0',
  historyEntryId: `history:${domainKind}:${index}`,
  resourceProjectId: projectId,
  domainKind,
  domainResourceKind: 'TEST_RESOURCE',
  domainResourceId: `${domainKind}:${index}`,
  sourceEventKind: 'TEST_EVENT',
  sourceEventId: `${domainKind}:${index}`,
  occurredAt: new Date(Date.UTC(2026, 8, 24, 0, 0, index)).toISOString(),
  payloadAvailability: 'AVAILABLE',
  payloadSnapshot: { index },
  projectedAt: '2026-09-24T01:00:00.000Z',
});

const makeAdapter = (
  domainKind: HistorySourceDomainKindV1,
  entries: readonly HistoryEntryV1[],
): HistoryAdapterPort => ({
  adapterId: `history-${domainKind.toLowerCase()}`,
  domainKind,
  async readHistory(targetProjectId) {
    return entries.filter((entry) => entry.resourceProjectId === targetProjectId);
  },
  async resolveHistoryEntry(targetProjectId, sourceEventKind, sourceEventId) {
    return entries.find(
      (entry) =>
        entry.resourceProjectId === targetProjectId &&
        entry.sourceEventKind === sourceEventKind &&
        entry.sourceEventId === sourceEventId,
    );
  },
  async redactEntry(entry) {
    return entry;
  },
});

describe('T3 History reset rebuilder', () => {
  it('reuses the federated History builder and captures every page and required watermark', async () => {
    const canonicalEntries = Array.from({ length: 225 }, (_, index) =>
      makeEntry('CANONICAL', index),
    );
    const independentEntries = [
      makeEntry('REVIEW', 1),
      makeEntry('EXTERNAL_ACTION', 2),
      makeEntry('POLICY', 3),
    ];
    const registry = createHistoryAdapterRegistry([
      makeAdapter('CANONICAL', canonicalEntries),
      makeAdapter('REVIEW', [independentEntries[0]!]),
      makeAdapter('EXTERNAL_ACTION', [independentEntries[1]!]),
      makeAdapter('POLICY', [independentEntries[2]!]),
    ]);
    const context: KnowledgeResetOwnerContext = {
      projectId,
      requestId: 'reset-request-1',
      knowledgeEpoch: 4,
      manifestDigest: `sha256:${'a'.repeat(64)}`,
    };
    const rebuilder = createProjectHistoryResetRebuilder({
      registry,
      createCaptureStore: createInMemoryHistoryReadModelStore,
      now: () => new Date('2026-09-24T01:00:00.000Z'),
    });

    const projection = await rebuilder.rebuildProjectHistory(context);

    expect(projection.partial).toBe(false);
    expect(projection.failures).toEqual([]);
    expect(projection.entries).toHaveLength(228);
    expect(projection.entries.filter((entry) => entry.domainKind === 'CANONICAL')).toHaveLength(
      225,
    );
    expect(projection.watermarks.map((watermark) => watermark.domainKind).sort()).toEqual([
      'CANONICAL',
      'EXTERNAL_ACTION',
      'POLICY',
      'REVIEW',
    ]);
    expect(projection.watermarks.every((watermark) => watermark.snapshotRevision === 1)).toBe(true);
  });
});
