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

export type HistoryCapabilityV1 =
  'LIST_HISTORY_WORKSPACE' | 'READ_HISTORY_ENTRY' | 'READ_HISTORY_AUDIT';

const HISTORY_READ_SCOPES: ReadonlySet<string> = new Set(['owner', 'admin', 'history:read']);

/**
 * Audit read scopes (Contract Snapshot §7 — separate fine-grained capability,
 * AC-13 read-time revalidation): `history:audit:read` (new) and the owning
 * Domain's existing `action:audit:read`. `owner`/`admin` always imply it.
 */
const HISTORY_AUDIT_READ_SCOPES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'history:audit:read',
  'action:audit:read',
]);

/** Least-privilege Scope → Capability matrix for History reads. */
export const historyCapabilitiesForScope = (
  scope: HistoryProductScopeV1,
): readonly HistoryCapabilityV1[] => {
  const granted = scope.accessScope ?? [];
  const has = (set: ReadonlySet<string>): boolean => granted.some((entry) => set.has(entry));
  const capabilities: HistoryCapabilityV1[] = [];
  if (has(HISTORY_READ_SCOPES)) {
    capabilities.push('LIST_HISTORY_WORKSPACE', 'READ_HISTORY_ENTRY');
  }
  if (has(HISTORY_AUDIT_READ_SCOPES)) {
    capabilities.push('READ_HISTORY_AUDIT');
  }
  return capabilities;
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

/**
 * EXTERNAL_ACTION audit rows are gated behind the separate
 * `READ_HISTORY_AUDIT` capability (GPT Round 2 G / AC-13). Result rows of the
 * same Domain stay under `history:read` (as the owning Domain permits).
 */
const isAuditRecord = (record: HistoryIndexRecordV1): boolean =>
  record.domainKind === 'EXTERNAL_ACTION' && record.sourceEventKind === 'AUDIT_EVENT';

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
   *
   * Fine-grained audit revalidation (GPT Round 2 G / AC-13): EXTERNAL_ACTION
   * AUDIT_EVENT rows require the separate `READ_HISTORY_AUDIT` capability.
   * Without it those rows are hidden non-disclosingly, and the page is filled
   * by continuing the keyset walk so pagination never leaks how many rows
   * were inaccessible nor skips rows the principal IS allowed to see.
   *
   * Read-time payload redaction (GPT Round 2 F): each returned row is
   * re-checked against the owning Domain's current availability so a purge
   * that happened after the projection was cached cannot leak raw payload.
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
    const canReadAudit = this.capabilities(scope).includes('READ_HISTORY_AUDIT');
    const target = limit + 1;

    // Keyset over-fetch: read until the visible page is full (or the source
    // is exhausted) so hidden AUDIT_EVENT rows never shrink or leak pages.
    const visible: HistoryIndexRecordV1[] = [];
    let cursor = decoded.cursor;
    while (visible.length < target) {
      const page = await this.index.queryProject({
        resourceProjectId: scope.activeProjectId,
        domainKinds: decoded.domainKinds,
        cursor,
        limit: Math.max(target, (target - visible.length) * 3),
      });
      if (page.records.length === 0) break;
      const candidates = canReadAudit
        ? page.records
        : page.records.filter((record) => !isAuditRecord(record));
      visible.push(...candidates.slice(0, target - visible.length));
      if (visible.length >= target) break;
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }

    const hasMore = visible.length > limit;
    const records = hasMore ? visible.slice(0, limit) : visible;
    const lastDisplayed = records[records.length - 1];
    let nextCursor: HistoryCursorV1 | undefined;
    if (hasMore && lastDisplayed !== undefined) {
      nextCursor = cursorFromRecord(lastDisplayed);
    }
    // Read-time payload redaction for every returned row (GPT Round 2 F).
    const entries = await Promise.all(
      records.map(async (record) => this.redactForRead(scope, record)),
    );
    return {
      schemaVersion: '1.0.0',
      entries,
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
   * server-derived active project (non-disclosing on mismatch). EXTERNAL_ACTION
   * AUDIT_EVENT rows additionally require `READ_HISTORY_AUDIT` (GPT Round 2 G).
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
    // Audit rows are only visible to principals holding the separate audit
    // read capability; otherwise the same non-disclosing NOT_FOUND (G).
    if (isAuditRecord(projection) && !this.capabilities(scope).includes('READ_HISTORY_AUDIT')) {
      historyNotFound();
    }
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
    // Read-time redaction of the authoritative entry (purge-after-cache safety).
    return { schemaVersion: '1.0.0', entry: await this.redactForRead(scope, authoritative!) };
  }

  /** Capabilities for a scope (server-derived; never from the browser). */
  private capabilities(scope: HistoryProductScopeV1): readonly HistoryCapabilityV1[] {
    return historyCapabilitiesForScope(scope);
  }

  /** Read-time payload redaction via the owning adapter (GPT Round 2 F). */
  private async redactForRead(
    scope: HistoryProductScopeV1,
    record: HistoryIndexRecordV1,
  ): Promise<HistoryIndexRecordV1> {
    const adapter = this.registry.adapterFor(record.domainKind);
    if (adapter === undefined) return record;
    return adapter.redactEntry(record);
  }
}

// Re-exported for tests that need the frozen cursor predicate.
export { isHistoryRecordAfter };
