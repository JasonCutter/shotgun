import {
  FrontendContractError,
  decodeGetHistoryEntryRequestV1,
  decodeHistoryCursorV1,
  decodeListHistoryWorkspaceRequestV1,
  type GetHistoryEntryRequestV1,
  type GetHistoryEntryResultV1,
  type HistoryCursorV1,
  type ListHistoryWorkspaceRequestV1,
  type ListHistoryWorkspaceResultV1,
} from '../../../packages/contracts/src/index.js';
import type { HistoryAdapterRegistryPort } from './history-adapter-port.js';
import type { HistoryIndexRecordV1, HistoryIndexStorePort } from './history-index-store-port.js';
import { isHistoryRecordAfter } from './history-index-store-port.js';
import type {
  HistoryAdapterStatusV1,
  HistoryWatermarkRecordV1,
} from './history-watermark-store-port.js';

// The History Product API request types are owned by Contracts (single source
// of truth); this module re-exports them so the coordinator surface stays
// stable for adapters and the assembly boundary.
export type {
  GetHistoryEntryRequestV1,
  ListHistoryWorkspaceRequestV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S2 WP4 — History Workspace Product API.
 *
 * Project-scoped, typed, cursor-bounded read surface over the federated
 * NON-AUTHORITATIVE History projection (ADR-131 §2 / IR r1 §5 WP4). Reads are
 * non-disclosing: a missing or cross-project resource produces the same
 * NOT_FOUND and never leaks existence. Reversal is NOT a History command; the
 * History Workspace only reads and delegates Reversal creation to the
 * change-set-review owning route (WP3).
 *
 * The coordinator derives the server-side capability set from the product
 * scope (`history:read`) and revalidates Project access at execution time.
 */

export type HistoryProductScopeV1 = {
  readonly principalId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope: readonly string[];
  /**
   * Required, allow-listed sensitivity clearance (server-derived). A missing,
   * empty or unknown value is rejected deny-by-default (Contract Snapshot §9).
   */
  readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
};

export type HistoryCapabilityV1 = 'LIST_HISTORY_WORKSPACE' | 'READ_HISTORY_ENTRY';

const HISTORY_READ_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'history:read']);

/** Least-privilege Scope → Capability matrix for History reads. */
export const historyCapabilitiesForScope = (
  scope: HistoryProductScopeV1,
): readonly HistoryCapabilityV1[] => {
  const granted = scope.accessScope ?? [];
  const has = (set: ReadonlySet<string>): boolean => granted.some((entry) => set.has(entry));
  if (has(HISTORY_READ_SCOPES)) {
    return ['LIST_HISTORY_WORKSPACE', 'READ_HISTORY_ENTRY'];
  }
  return [];
};

export const HISTORY_PAGE_SIZE_CAP = 50;

// --- errors (non-disclosing) ------------------------------------------------

export class HistoryProductError extends FrontendContractError {}

const historyDenied = (): never => {
  throw new HistoryProductError('PROJECT_ACCESS_DENIED', 'History access denied.');
};

const historyNotFound = (): never => {
  throw new HistoryProductError('NOT_FOUND', 'History entry not found.');
};

// --- projection metadata ----------------------------------------------------

export type HistoryProjectionMetadataV1 = {
  readonly schemaVersion: '1.0.0';
  readonly snapshotRevision: number;
  readonly generatedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly adapterStatus: HistoryAdapterStatusV1;
  readonly partial: boolean;
};

export const historyProjectionMetadataFrom = (input: {
  readonly records: readonly HistoryIndexRecordV1[];
  readonly watermarks: readonly HistoryWatermarkRecordV1[];
  readonly now: string;
  readonly expectedAdapterCount: number;
}): HistoryProjectionMetadataV1 => {
  const snapshotRevision = input.watermarks.reduce(
    (max, record) => Math.max(max, record.snapshotRevision),
    0,
  );
  const sourceUpdatedAt = input.records.reduce<string | undefined>(
    (newest, record) =>
      newest === undefined || record.occurredAt > newest ? record.occurredAt : newest,
    undefined,
  );
  const statuses: HistoryAdapterStatusV1[] =
    input.watermarks.length > 0
      ? input.watermarks.map((record) => record.adapterStatus)
      : ['UNAVAILABLE'];
  const adapterStatus: HistoryAdapterStatusV1 = statuses.some((s) => s === 'UNAVAILABLE')
    ? 'UNAVAILABLE'
    : statuses.some((s) => s === 'DEGRADED')
      ? 'DEGRADED'
      : 'AVAILABLE';
  const observedAdapterCount =
    input.watermarks.length > 0
      ? input.watermarks.length
      : new Set(input.records.map((record) => record.domainKind)).size;
  const partial =
    adapterStatus !== 'AVAILABLE' || observedAdapterCount < input.expectedAdapterCount;
  return {
    schemaVersion: '1.0.0',
    snapshotRevision: Math.max(1, snapshotRevision),
    generatedAt: input.now,
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
    adapterStatus,
    partial,
  };
};

/** Cursor for the last displayed record (frozen tuple). */
const cursorFromRecord = (record: HistoryIndexRecordV1): HistoryCursorV1 => ({
  schemaVersion: '1.0.0',
  occurredAt: record.occurredAt,
  domainKind: record.domainKind,
  sourceEventKind: record.sourceEventKind,
  sourceEventId: record.sourceEventId,
  ...(record.sourceSequence === undefined ? {} : { sourceSequence: record.sourceSequence }),
});

/** Decode a strict HistoryCursorV1 from browser input. */
export const decodeHistoryWorkspaceCursorV1 = (value: unknown, path: string): HistoryCursorV1 =>
  decodeHistoryCursorV1(value, path);

// --- coordinator ------------------------------------------------------------

export class HistoryProductCoordinator {
  constructor(
    private readonly index: HistoryIndexStorePort,
    private readonly registry: HistoryAdapterRegistryPort,
    private readonly now?: () => Date,
  ) {}

  private nowIso(): string {
    return (this.now ? this.now() : new Date()).toISOString();
  }

  private requireCapability(scope: HistoryProductScopeV1, capability: HistoryCapabilityV1): void {
    this.assertValidProductScope(scope);
    if (!historyCapabilitiesForScope(scope).includes(capability)) {
      historyDenied();
    }
  }

  /**
   * Deny-by-default scope validation: a server-derived Product scope must
   * carry a Principal, an active Project, both revision bindings and an
   * allow-listed sensitivity clearance. The browser never authors these.
   */
  private assertValidProductScope(scope: HistoryProductScopeV1): void {
    if (
      typeof scope.principalId !== 'string' ||
      scope.principalId.trim().length === 0 ||
      typeof scope.activeProjectId !== 'string' ||
      scope.activeProjectId.trim().length === 0 ||
      typeof scope.accessRevision !== 'string' ||
      scope.accessRevision.trim().length === 0 ||
      typeof scope.policyContextRevision !== 'string' ||
      scope.policyContextRevision.trim().length === 0 ||
      !Array.isArray(scope.accessScope) ||
      !['public', 'internal', 'private', 'restricted'].includes(scope.sensitivityClearance)
    ) {
      historyDenied();
    }
  }

  /**
   * Project-scoped unified History Workspace read with domain filter and
   * frozen-tuple keyset cursor. Non-disclosing: only the requested project's
   * projection rows are ever returned. The request `resourceProjectId` MUST
   * equal the server-derived active project (GPT Round 1 D): a mismatch is a
   * denial, never a silent cross-project read.
   */
  async listHistoryWorkspace(
    scope: HistoryProductScopeV1,
    request: ListHistoryWorkspaceRequestV1,
  ): Promise<ListHistoryWorkspaceResultV1> {
    this.requireCapability(scope, 'LIST_HISTORY_WORKSPACE');
    const decoded = decodeListHistoryWorkspaceRequestV1(request, 'listHistoryWorkspace');
    if (decoded.resourceProjectId !== scope.activeProjectId) {
      historyDenied();
    }
    const limit = Math.min(HISTORY_PAGE_SIZE_CAP, Math.max(1, decoded.limit));
    const page = await this.index.queryProject({
      resourceProjectId: scope.activeProjectId,
      domainKinds: decoded.domainKinds,
      cursor: decoded.cursor,
      limit: limit + 1,
    });
    const hasMore = page.records.length > limit;
    const records = hasMore ? page.records.slice(0, limit) : page.records;
    // Projection rows are Project-scoped and non-authoritative; no per-row
    // access gate is needed beyond the History read capability. The ordering
    // is the frozen tuple, and a nextCursor is emitted only when more rows
    // exist after the last displayed record.
    const lastDisplayed = records[records.length - 1];
    let nextCursor: HistoryCursorV1 | undefined;
    if (hasMore && lastDisplayed !== undefined) {
      nextCursor = cursorFromRecord(lastDisplayed);
    }
    return {
      schemaVersion: '1.0.0',
      entries: records.map((record) => record),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  /**
   * Single History entry by projection identity. The projection row resolves
   * the authoritative source identity (domainKind + sourceEventKind +
   * sourceEventId); the owning Domain is then re-queried for the CURRENT
   * authoritative payload + availability (GPT Round 1 C). A source that can
   * no longer be resolved fails closed (NOT_FOUND) — the stale projection
   * payload is never trusted. The request `resourceProjectId` MUST equal the
   * server-derived active project (non-disclosing on mismatch).
   */
  async getHistoryEntry(
    scope: HistoryProductScopeV1,
    request: GetHistoryEntryRequestV1,
  ): Promise<GetHistoryEntryResultV1> {
    this.requireCapability(scope, 'READ_HISTORY_ENTRY');
    const decoded = decodeGetHistoryEntryRequestV1(request, 'getHistoryEntry');
    if (decoded.resourceProjectId !== scope.activeProjectId) {
      historyNotFound();
    }
    const record = await this.index.findByIdentity({
      resourceProjectId: scope.activeProjectId,
      historyEntryId: decoded.historyEntryId,
    });
    if (record === undefined) {
      historyNotFound();
    }
    const projection = record!;
    const adapter = this.registry.adapterFor(projection.domainKind);
    if (adapter === undefined) {
      historyNotFound();
    }
    // Authoritative re-resolution: the owning Domain is the source of truth;
    // the projection only locates it. Fail-closed when unresolved.
    const authoritative = await adapter!.resolveHistoryEntry(
      scope.activeProjectId,
      projection.sourceEventKind,
      projection.sourceEventId,
    );
    if (authoritative === undefined) {
      historyNotFound();
    }
    return { schemaVersion: '1.0.0', entry: authoritative! };
  }
}

// Re-exported for tests that need the frozen cursor predicate.
export { isHistoryRecordAfter };
