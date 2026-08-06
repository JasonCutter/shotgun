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
  /** Project-scoped rows keyed by (project, domain, activityId). */
  readonly rows = new Map<string, ActivityIndexRecordV1>();

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
    let matching = [...this.rows.values()].filter(
      (record) =>
        record.resourceProjectId === input.resourceProjectId &&
        (domainSet === undefined || domainSet.has(record.domainKind)) &&
        (stateSet === undefined || stateSet.has(record.state)) &&
        (input.attention === undefined || record.attention === input.attention),
    );
    matching.sort(compareForOrdering);

    if (input.cursor !== undefined) {
      const cursor = decodeActivityIndexCursor(input.cursor);
      // True keyset predicate matching ORDER BY updated_at DESC, domain_kind
      // ASC, activity_id ASC. Unlike a positional slice, this stays correct
      // when the cursor row is deleted or its updatedAt changes after the
      // cursor was issued.
      matching = matching.filter(
        (record) =>
          record.updatedAt < cursor.updatedAt ||
          (record.updatedAt === cursor.updatedAt &&
            (record.domainKind > cursor.domainKind ||
              (record.domainKind === cursor.domainKind && record.activityId > cursor.activityId))),
      );
    }

    const page = matching.slice(0, Math.max(0, input.limit));
    const last = page[page.length - 1];
    const nextCursor =
      matching.length > page.length && last !== undefined
        ? encodeActivityIndexCursor({
            updatedAt: last.updatedAt,
            domainKind: last.domainKind,
            activityId: last.activityId,
          })
        : undefined;
    return { records: page, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  async findByIdentity(input: {
    readonly resourceProjectId: string;
    readonly domainKind: ActivityDomainKindV1;
    readonly activityId: string;
  }): Promise<ActivityIndexRecordV1 | undefined> {
    return this.rows.get(projectKey(input.resourceProjectId, input.domainKind, input.activityId));
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
  /** Project-scoped watermark rows keyed by (project, adapterId). */
  readonly rows = new Map<string, ActivityWatermarkRecordV1>();

  private readonly key = (resourceProjectId: string, adapterId: string): string =>
    `${resourceProjectId}\u0000${adapterId}`;

  async upsert(record: ActivityWatermarkRecordV1): Promise<void> {
    const key = this.key(record.resourceProjectId, record.adapterId);
    const existing = this.rows.get(key);
    // A lower snapshot revision never replaces a newer watermark observation.
    if (existing !== undefined && existing.snapshotRevision > record.snapshotRevision) {
      throw new Error(
        `ACTIVITY_WATERMARK_STALE_UPSERT: ${key} has snapshot revision ${existing.snapshotRevision} which is newer than ${record.snapshotRevision}`,
      );
    }
    this.rows.set(key, record);
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

export const createInMemoryActivityReadModelStore = (): ActivityReadModelStorePort => {
  const index = new InMemoryActivityIndexStore();
  const watermarks = new InMemoryActivityWatermarkStore();
  return {
    index,
    watermarks,
    async commitProjectProjection(input) {
      // Atomic, CAS-bounded full-project commit. In-memory execution builds
      // the complete next index and watermark state FIRST (validating every
      // revision guard) and only swaps it into the stores after everything
      // succeeded — so a mid-commit failure (e.g. a watermark write error)
      // leaves the store untouched: index and watermarks never diverge.
      validateRebuildBatch({
        resourceProjectId: input.resourceProjectId,
        snapshotRevision: input.snapshotRevision,
        records: input.records,
      });
      for (const watermark of input.watermarks) {
        if (watermark.resourceProjectId !== input.resourceProjectId) {
          throw new Error(
            `ACTIVITY_WATERMARK_SCOPE: watermark ${watermark.adapterId} is bound to another project`,
          );
        }
        if (watermark.snapshotRevision !== input.snapshotRevision) {
          throw new Error(
            `ACTIVITY_WATERMARK_REVISION: watermark ${watermark.adapterId} snapshotRevision ${watermark.snapshotRevision} must equal commit revision ${input.snapshotRevision}`,
          );
        }
      }
      const existing = [...index.rows.values()].filter(
        (record) => record.resourceProjectId === input.resourceProjectId,
      );
      assertRebuildRevisionNotLower(
        existing,
        input.snapshotRevision,
        `${input.resourceProjectId}/ALL`,
      );
      // Reject a concurrent build that already committed the same revision.
      if (existing.some((record) => record.snapshotRevision >= input.snapshotRevision)) {
        throw new Error(
          `ACTIVITY_INDEX_STALE_REBUILD: ${input.resourceProjectId}/ALL already has snapshot revision >= ${input.snapshotRevision}`,
        );
      }
      // Build the next index state without touching the live store.
      const nextIndex = new Map(index.rows);
      const projectPrefix = `${input.resourceProjectId}\u0000`;
      for (const key of [...nextIndex.keys()]) {
        if (key.startsWith(projectPrefix)) nextIndex.delete(key);
      }
      for (const record of input.records) {
        validateActivityIndexRecord(record);
        const key = projectKey(record.resourceProjectId, record.domainKind, record.activityId);
        const current = nextIndex.get(key);
        if (current !== undefined && current.snapshotRevision > record.snapshotRevision) {
          throw new Error(
            `ACTIVITY_INDEX_STALE_UPSERT: ${key} has snapshot revision ${current.snapshotRevision} which is newer than ${record.snapshotRevision}`,
          );
        }
        nextIndex.set(key, record);
      }
      // Build the next watermark state without touching the live store.
      const nextWatermarks = new Map(watermarks.rows);
      for (const key of [...nextWatermarks.keys()]) {
        if (key.startsWith(projectPrefix)) nextWatermarks.delete(key);
      }
      for (const watermark of input.watermarks) {
        const key = `${watermark.resourceProjectId}\u0000${watermark.adapterId}`;
        const current = nextWatermarks.get(key);
        if (current !== undefined && current.snapshotRevision > watermark.snapshotRevision) {
          throw new Error(
            `ACTIVITY_WATERMARK_STALE_UPSERT: ${key} has snapshot revision ${current.snapshotRevision} which is newer than ${watermark.snapshotRevision}`,
          );
        }
        nextWatermarks.set(key, watermark);
      }
      // All-or-nothing swap (single-threaded, no await between check and swap).
      index.rows.clear();
      for (const [key, record] of nextIndex) index.rows.set(key, record);
      watermarks.rows.clear();
      for (const [key, record] of nextWatermarks) watermarks.rows.set(key, record);
    },
  };
};
