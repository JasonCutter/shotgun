/**
 * FE-P5-S2 WP4 — In-memory Federated History projection stores.
 *
 * In-memory counterparts of `PostgresHistoryIndexStore` /
 * `PostgresHistoryWatermarkStore` / `createPostgresHistoryReadModelStore`
 * (IR r1 §4): deterministic frozen-tuple ordering, snapshot-revision CAS (a
 * lower revision never replaces a newer one), and an atomic
 * `commitProjectProjection` that swaps the project index and replaces every
 * watermark together so the index and watermarks never diverge.
 */

import {
  compareHistoryRecords,
  isHistoryRecordAfter,
  validateHistoryRebuildBatch,
  assertHistoryRebuildRevisionNotLower,
  type HistoryIndexPageV1,
  type HistoryIndexQueryV1,
  type HistoryIndexRecordV1,
  type HistoryIndexStorePort,
  type HistoryReadModelStorePort,
  type HistorySourceDomainKindV1,
  type HistoryWatermarkRecordV1,
  type HistoryWatermarkStorePort,
} from '../../../modules/frontend-history/src/index.js';
import type { HistoryCursorV1 } from '../../../packages/contracts/src/index.js';

const cursorFromRecord = (record: HistoryIndexRecordV1): HistoryCursorV1 => ({
  schemaVersion: '1.0.0',
  occurredAt: record.occurredAt,
  domainKind: record.domainKind,
  sourceEventKind: record.sourceEventKind,
  sourceEventId: record.sourceEventId,
  ...(record.sourceSequence === undefined ? {} : { sourceSequence: record.sourceSequence }),
});

export class InMemoryHistoryIndexStore implements HistoryIndexStorePort {
  private readonly rows = new Map<string, HistoryIndexRecordV1>();

  private key(resourceProjectId: string, historyEntryId: string): string {
    return `${resourceProjectId}:${historyEntryId}`;
  }

  async upsert(record: HistoryIndexRecordV1): Promise<void> {
    this.rows.set(this.key(record.resourceProjectId, record.historyEntryId), record);
  }

  async findByIdentity(input: {
    readonly resourceProjectId: string;
    readonly historyEntryId: string;
  }): Promise<HistoryIndexRecordV1 | undefined> {
    return this.rows.get(this.key(input.resourceProjectId, input.historyEntryId));
  }

  async queryProject(input: HistoryIndexQueryV1): Promise<HistoryIndexPageV1> {
    let rows = [...this.rows.values()].filter(
      (record) => record.resourceProjectId === input.resourceProjectId,
    );
    if (input.domainKinds && input.domainKinds.length > 0) {
      const kinds = new Set(input.domainKinds);
      rows = rows.filter((record) => kinds.has(record.domainKind));
    }
    if (input.cursor !== undefined) {
      rows = rows.filter((record) => isHistoryRecordAfter(record, input.cursor!));
    }
    rows.sort(compareHistoryRecords);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last !== undefined ? cursorFromRecord(last) : undefined;
    return {
      records: Object.freeze([...page]),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async deleteProject(resourceProjectId: string): Promise<void> {
    for (const [key, record] of this.rows) {
      if (record.resourceProjectId === resourceProjectId) this.rows.delete(key);
    }
  }

  async deleteByProjectAndDomain(
    resourceProjectId: string,
    domainKind: HistorySourceDomainKindV1,
  ): Promise<void> {
    for (const [key, record] of this.rows) {
      if (record.resourceProjectId === resourceProjectId && record.domainKind === domainKind) {
        this.rows.delete(key);
      }
    }
  }

  async rebuildProject(input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly domainKind?: HistorySourceDomainKindV1;
    readonly records: readonly HistoryIndexRecordV1[];
  }): Promise<void> {
    // Revision CAS is owned by commitProjectProjection via the watermarks
    // (migration 030 design); a bare index rebuild is a deterministic replace.
    validateHistoryRebuildBatch(input);
    await this.deleteProject(input.resourceProjectId);
    for (const record of input.records) {
      await this.upsert(record);
    }
  }

  /** Test helper: current rows for a project. */
  rowsFor(projectId: string): readonly HistoryIndexRecordV1[] {
    return Object.freeze(
      [...this.rows.values()].filter((record) => record.resourceProjectId === projectId),
    );
  }
}

export class InMemoryHistoryWatermarkStore implements HistoryWatermarkStorePort {
  private readonly watermarks = new Map<string, HistoryWatermarkRecordV1>();

  private key(resourceProjectId: string, adapterId: string): string {
    return `${resourceProjectId}:${adapterId}`;
  }

  async upsert(record: HistoryWatermarkRecordV1): Promise<void> {
    const existing = this.watermarks.get(this.key(record.resourceProjectId, record.adapterId));
    if (existing !== undefined && existing.snapshotRevision > record.snapshotRevision) {
      throw new Error(
        `HISTORY_WATERMARK_STALE_UPSERT: ${record.resourceProjectId}/${record.adapterId} has a newer snapshot revision than ${record.snapshotRevision}`,
      );
    }
    this.watermarks.set(this.key(record.resourceProjectId, record.adapterId), record);
  }

  async readByProject(resourceProjectId: string): Promise<readonly HistoryWatermarkRecordV1[]> {
    return Object.freeze(
      [...this.watermarks.values()]
        .filter((record) => record.resourceProjectId === resourceProjectId)
        .sort((a, b) => a.adapterId.localeCompare(b.adapterId)),
    );
  }

  async readByProjectAndAdapter(
    resourceProjectId: string,
    adapterId: string,
  ): Promise<HistoryWatermarkRecordV1 | undefined> {
    return this.watermarks.get(this.key(resourceProjectId, adapterId));
  }

  async deleteByProject(resourceProjectId: string): Promise<void> {
    for (const [key, record] of this.watermarks) {
      if (record.resourceProjectId === resourceProjectId) this.watermarks.delete(key);
    }
  }
}

export const createInMemoryHistoryReadModelStore = (): HistoryReadModelStorePort => {
  const index = new InMemoryHistoryIndexStore();
  const watermarks = new InMemoryHistoryWatermarkStore();
  return {
    index,
    watermarks,
    async commitProjectProjection(input) {
      validateHistoryRebuildBatch(input);
      for (const watermark of input.watermarks) {
        if (watermark.resourceProjectId !== input.resourceProjectId) {
          throw new Error(
            `HISTORY_WATERMARK_SCOPE: watermark ${watermark.adapterId} is bound to another project`,
          );
        }
        if (watermark.snapshotRevision !== input.snapshotRevision) {
          throw new Error(
            `HISTORY_WATERMARK_REVISION: watermark ${watermark.adapterId} snapshotRevision ${watermark.snapshotRevision} must equal commit revision ${input.snapshotRevision}`,
          );
        }
      }
      const existingRevisions = (await watermarks.readByProject(input.resourceProjectId)).map(
        (r) => r.snapshotRevision,
      );
      const committedMax = Math.max(0, ...existingRevisions);
      if (committedMax >= input.snapshotRevision) {
        throw new Error(
          `HISTORY_INDEX_STALE_REBUILD: ${input.resourceProjectId}/ALL already has snapshot revision >= ${input.snapshotRevision}`,
        );
      }
      assertHistoryRebuildRevisionNotLower(
        existingRevisions.map((snapshotRevision) => ({ snapshotRevision })),
        input.snapshotRevision,
        `${input.resourceProjectId}/ALL`,
      );
      await index.deleteProject(input.resourceProjectId);
      for (const record of input.records) {
        await index.upsert(record);
      }
      await watermarks.deleteByProject(input.resourceProjectId);
      for (const watermark of input.watermarks) {
        await watermarks.upsert(watermark);
      }
    },
  };
};
