import type { ActivityDomainKindV1 } from '../../../packages/contracts/src/index.js';
import {
  assertRebuildRevisionNotLower,
  decodeActivityIndexCursor,
  encodeActivityIndexCursor,
  validateActivityIndexRecord,
  validateRebuildBatch,
  type ActivityIndexPageV1,
  type ActivityIndexQueryV1,
  type ActivityIndexRecordV1,
  type ActivityIndexStorePort,
  type ActivityReadModelStorePort,
  type ActivityWatermarkRecordV1,
  type ActivityWatermarkStorePort,
} from '../../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 in-memory Activity read-model stores (migration 029 mirror).
 * Mirrors the PostgreSQL adapter's observable semantics exactly: upsert by
 * identity, project-scoped stable total ordering (updatedAt DESC, domainKind,
 * activityId), keyset cursor pagination, and deterministic rebuild that never
 * lets a lower snapshot revision replace a newer one.
 */

const projectKey = (resourceProjectId: string, domainKind: string, activityId: string): string =>
  `${resourceProjectId}\u0000${domainKind}\u0000${activityId}`;

const compareForOrdering = (
  a: { readonly updatedAt: string; readonly domainKind: string; readonly activityId: string },
  b: { readonly updatedAt: string; readonly domainKind: string; readonly activityId: string },
): number => {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.domainKind !== b.domainKind) return a.domainKind < b.domainKind ? -1 : 1;
  if (a.activityId !== b.activityId) return a.activityId < b.activityId ? -1 : 1;
  return 0;
};

export class InMemoryActivityIndexStore implements ActivityIndexStorePort {
  private readonly rows = new Map<string, ActivityIndexRecordV1>();

  async upsert(record: ActivityIndexRecordV1): Promise<void> {
    validateActivityIndexRecord(record);
    const key = projectKey(record.resourceProjectId, record.domainKind, record.activityId);
    const existing = this.rows.get(key);
    // A lower snapshot revision never replaces a newer one (Contract Snapshot §9).
    if (existing !== undefined && existing.snapshotRevision > record.snapshotRevision) {
      throw new Error(
        `ACTIVITY_INDEX_STALE_UPSERT: ${key} has snapshot revision ${existing.snapshotRevision} which is newer than ${record.snapshotRevision}`,
      );
    }
    this.rows.set(key, record);
  }

  async queryProject(input: ActivityIndexQueryV1): Promise<ActivityIndexPageV1> {
    const domainSet = input.domainKinds ? new Set(input.domainKinds) : undefined;
    const stateSet = input.states ? new Set(input.states) : undefined;
    const matching = [...this.rows.values()].filter(
      (record) =>
        record.resourceProjectId === input.resourceProjectId &&
        (domainSet === undefined || domainSet.has(record.domainKind)) &&
        (stateSet === undefined || stateSet.has(record.state)) &&
        (input.attention === undefined || record.attention === input.attention),
    );
    matching.sort(compareForOrdering);

    let startIndex = 0;
    if (input.cursor !== undefined) {
      const cursor = decodeActivityIndexCursor(input.cursor);
      const found = matching.findIndex(
        (record) =>
          record.updatedAt === cursor.updatedAt &&
          record.domainKind === cursor.domainKind &&
          record.activityId === cursor.activityId,
      );
      startIndex = found === -1 ? matching.length : found + 1;
    }

    const page = matching.slice(startIndex, startIndex + Math.max(0, input.limit));
    const last = page[page.length - 1];
    const nextCursor =
      startIndex + page.length < matching.length && last !== undefined
        ? encodeActivityIndexCursor({
            updatedAt: last.updatedAt,
            domainKind: last.domainKind,
            activityId: last.activityId,
          })
        : undefined;
    return { records: page, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  async deleteProject(resourceProjectId: string): Promise<void> {
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(`${resourceProjectId}\u0000`)) this.rows.delete(key);
    }
  }

  async deleteByProjectAndDomain(
    resourceProjectId: string,
    domainKind: ActivityDomainKindV1,
  ): Promise<void> {
    const prefix = `${resourceProjectId}\u0000${domainKind}\u0000`;
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(prefix)) this.rows.delete(key);
    }
  }

  async rebuildProject(input: {
    readonly resourceProjectId: string;
    readonly snapshotRevision: number;
    readonly domainKind?: ActivityDomainKindV1;
    readonly records: readonly ActivityIndexRecordV1[];
  }): Promise<void> {
    // Validate the whole batch BEFORE any delete or write.
    validateRebuildBatch(input);
    const scope = input.domainKind ?? 'ALL';
    const existing = [...this.rows.values()].filter(
      (record) =>
        record.resourceProjectId === input.resourceProjectId &&
        (input.domainKind === undefined || record.domainKind === input.domainKind),
    );
    assertRebuildRevisionNotLower(
      existing,
      input.snapshotRevision,
      `${input.resourceProjectId}/${scope}`,
    );
    if (input.domainKind === undefined) {
      await this.deleteProject(input.resourceProjectId);
    } else {
      await this.deleteByProjectAndDomain(input.resourceProjectId, input.domainKind);
    }
    for (const record of input.records) {
      await this.upsert(record);
    }
  }
}

export class InMemoryActivityWatermarkStore implements ActivityWatermarkStorePort {
  private readonly rows = new Map<string, ActivityWatermarkRecordV1>();

  private readonly key = (resourceProjectId: string, adapterId: string): string =>
    `${resourceProjectId}\u0000${adapterId}`;

  async upsert(record: ActivityWatermarkRecordV1): Promise<void> {
    this.rows.set(this.key(record.resourceProjectId, record.adapterId), record);
  }

  async readByProject(resourceProjectId: string): Promise<readonly ActivityWatermarkRecordV1[]> {
    const prefix = `${resourceProjectId}\u0000`;
    return [...this.rows.values()]
      .filter((record) => record.resourceProjectId === resourceProjectId)
      .sort((a, b) => {
        const aKey = this.key(a.resourceProjectId, a.adapterId);
        const bKey = this.key(b.resourceProjectId, b.adapterId);
        return aKey.slice(prefix.length).localeCompare(bKey.slice(prefix.length));
      });
  }

  async readByProjectAndAdapter(
    resourceProjectId: string,
    adapterId: string,
  ): Promise<ActivityWatermarkRecordV1 | undefined> {
    return this.rows.get(this.key(resourceProjectId, adapterId));
  }

  async deleteByProject(resourceProjectId: string): Promise<void> {
    const prefix = `${resourceProjectId}\u0000`;
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(prefix)) this.rows.delete(key);
    }
  }
}

export const createInMemoryActivityReadModelStore = (): ActivityReadModelStorePort => ({
  index: new InMemoryActivityIndexStore(),
  watermarks: new InMemoryActivityWatermarkStore(),
});
