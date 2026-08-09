import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendHistoryClient,
  type GlobalShellView,
  type HistoryEntryV1,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { historyScopeFromShell } from '../app/query-keys.js';
import {
  HISTORY_LIST_LIMIT,
  historyEntryQueryOptions,
  historyListQueryOptions,
} from '../history/history-queries.js';
import {
  HISTORY_ANNOUNCEMENTS,
  HISTORY_AVAILABILITY_FILTER_OPTIONS,
  HISTORY_DOMAIN_KIND_OPTIONS,
  createInitialHistoryWorkspaceState,
  historyAvailabilityLabel,
  historyDomainKindLabel,
  reduceHistoryWorkspaceState,
  type HistoryAvailabilityFilter,
} from '../history/history-workspace-state.js';
import {
  HISTORY_REVIEW_HREF,
  historyExternalActionHref,
  parseHistoryDeepLink,
} from '../history/history-route-contract.js';

/**
 * FE-P5-S2 WP5 — History Workspace (`/history`, guarded).
 *
 * Project-scoped federated History read (ADR-131 §2 / IR r1 §5 WP5): unified
 * list with Domain filters + payload-availability filter + frozen-cursor
 * pagination, and a Detail panel that re-resolves the authoritative source
 * (payload availability display). Audit lineage links EXTERNAL_ACTION rows to
 * the owning-Domain External Action workspace; the Reversal entry point and
 * Compensation link go to the owning-Domain routes (WP3 change-set-review /
 * external action) — History owns no command endpoint. Deleted-project access
 * is non-disclosing (same NOT_FOUND as any missing resource). The browser owns
 * only selection, filters and pagination.
 */

const payloadAvailabilityClass = (availability: HistoryEntryV1['payloadAvailability']): string =>
  `history-payload-badge history-payload-${availability.toLowerCase()}`;

const formatOccurredAt = (occurredAt: string): string => {
  const date = new Date(occurredAt);
  return Number.isNaN(date.getTime()) ? occurredAt : date.toLocaleString();
};

/** Permitted bounded payload renderer: raw JSON only when AVAILABLE. */
const PayloadSnapshotView = ({ entry }: { readonly entry: HistoryEntryV1 }) => {
  if (entry.payloadAvailability === 'AVAILABLE' && entry.payloadSnapshot !== undefined) {
    return (
      <pre className="history-payload-snapshot" data-testid="history-payload-snapshot">
        {JSON.stringify(entry.payloadSnapshot, null, 2)}
      </pre>
    );
  }
  return (
    <p className="history-payload-redacted">
      {entry.payloadAvailability === 'PURGED_BY_POLICY' && entry.payloadSnapshot !== undefined ? (
        <>
          Tombstone: <code>{JSON.stringify(entry.payloadSnapshot)}</code>
        </>
      ) : (
        '이 항목은 payload를 포함하지 않습니다 (redaction/retention 정책).'
      )}
    </p>
  );
};

const PayloadAvailabilityBadge = ({ entry }: { readonly entry: HistoryEntryV1 }) => (
  <span className={payloadAvailabilityClass(entry.payloadAvailability)}>
    {historyAvailabilityLabel[entry.payloadAvailability]}
  </span>
);

const HistoryFilters = ({
  domainKinds,
  availability,
  onToggleDomainKind,
  onSetAvailability,
}: {
  readonly domainKinds: readonly HistoryEntryV1['domainKind'][];
  readonly availability: HistoryAvailabilityFilter;
  readonly onToggleDomainKind: (kind: HistoryEntryV1['domainKind']) => void;
  readonly onSetAvailability: (availability: HistoryAvailabilityFilter) => void;
}) => (
  <section className="history-filters" aria-label="히스토리 필터">
    <fieldset>
      <legend>Domain</legend>
      <ul className="history-domain-filter">
        {HISTORY_DOMAIN_KIND_OPTIONS.map((kind) => (
          <li key={kind}>
            <label>
              <input
                type="checkbox"
                checked={domainKinds.includes(kind)}
                onChange={() => onToggleDomainKind(kind)}
              />
              {historyDomainKindLabel[kind]}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
    <label className="history-availability-filter">
      Payload availability
      <select
        value={availability}
        onChange={(event) => onSetAvailability(event.target.value as HistoryAvailabilityFilter)}
      >
        {HISTORY_AVAILABILITY_FILTER_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'ANY' ? 'Any' : historyAvailabilityLabel[option]}
          </option>
        ))}
      </select>
    </label>
  </section>
);

/** Audit lineage / owning-Domain links for an entry (WP5). */
const OwningDomainLinks = ({ entry }: { readonly entry: HistoryEntryV1 }) => {
  const links: { readonly label: string; readonly href: string }[] = [];
  if (entry.domainKind === 'EXTERNAL_ACTION') {
    links.push({
      label: 'Audit lineage (External action)',
      href: historyExternalActionHref(entry.domainResourceId),
    });
    links.push({
      label: 'Compensation (External action)',
      href: historyExternalActionHref(entry.domainResourceId),
    });
  }
  if (entry.domainKind === 'REVIEW') {
    links.push({ label: 'Reversal draft (Review)', href: HISTORY_REVIEW_HREF });
    links.push({ label: 'Review workspace', href: HISTORY_REVIEW_HREF });
  }
  if (entry.domainKind === 'CANONICAL') {
    links.push({ label: 'Reversal draft (Review)', href: HISTORY_REVIEW_HREF });
  }
  if (links.length === 0) return null;
  return (
    <ul className="history-owning-links" aria-label="소유 도메인 링크">
      {links.map((link) => (
        <li key={link.label}>
          <Link to={link.href}>{link.label}</Link>
        </li>
      ))}
    </ul>
  );
};

const HistoryDetail = ({
  entry,
  entryError,
  onClear,
}: {
  readonly entry: HistoryEntryV1 | undefined;
  readonly entryError: unknown;
  readonly onClear: () => void;
}) => {
  if (entryError) {
    // Deleted-project / missing / capability-denied all resolve to the same
    // non-disclosing presentation (no existence leak).
    return (
      <section className="state-card state-card--error" aria-labelledby="history-entry-error">
        <h1 id="history-entry-error" tabIndex={-1}>
          Request error
        </h1>
        <p role="alert">요청한 항목이 존재하지 않거나 접근 권한이 없습니다.</p>
        <button type="button" onClick={onClear}>
          선택 해제
        </button>
      </section>
    );
  }
  if (entry === undefined) {
    return <LoadingState message="히스토리 항목을 불러오는 중…" />;
  }
  return (
    <article className="history-entry-detail">
      <header className="history-detail-header">
        <h2>History entry</h2>
        <button type="button" onClick={onClear}>
          선택 해제
        </button>
      </header>
      <dl className="history-detail-fields">
        <div>
          <dt>Domain</dt>
          <dd>{historyDomainKindLabel[entry.domainKind]}</dd>
        </div>
        <div>
          <dt>Source event</dt>
          <dd>
            <code>{entry.sourceEventKind}</code> · <code>{entry.sourceEventId}</code>
          </dd>
        </div>
        <div>
          <dt>Domain resource</dt>
          <dd>
            <code>{entry.domainResourceKind}</code> · <code>{entry.domainResourceId}</code>
          </dd>
        </div>
        <div>
          <dt>Occurred at</dt>
          <dd>{formatOccurredAt(entry.occurredAt)}</dd>
        </div>
        <div>
          <dt>Payload availability</dt>
          <dd>
            <PayloadAvailabilityBadge entry={entry} />
          </dd>
        </div>
      </dl>
      <section className="history-payload-section" aria-label="payload">
        <h3>Payload</h3>
        <PayloadSnapshotView entry={entry} />
      </section>
      <OwningDomainLinks entry={entry} />
    </article>
  );
};

export const HistoryWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const historyClient = useMemo(() => createFrontendHistoryClient(), []);
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceHistoryWorkspaceState,
    undefined,
    createInitialHistoryWorkspaceState,
  );
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);

  const scope = historyScopeFromShell(shell);
  const deepLink = useMemo(() => parseHistoryDeepLink(searchParameters), [searchParameters]);

  const announce = useCallback((message: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  }, []);

  // List request derived from workspace filters (server-derived values).
  const listRequest = useMemo(
    () => ({
      ...(state.domainKinds.length > 0 ? { domainKinds: state.domainKinds } : {}),
      ...(state.pageCursor === null ? {} : { cursor: state.pageCursor }),
      limit: HISTORY_LIST_LIMIT,
    }),
    [state.domainKinds, state.pageCursor],
  );

  const list = useQuery(historyListQueryOptions(historyClient, scope, listRequest));

  // Payload availability filter: applied client-side on the returned page is
  // NOT safe for cursors, so the browser filters on the displayed page only
  // when needed; the authoritative list is always the server page.
  const visibleEntries = useMemo(() => {
    const entries = list.data?.entries ?? [];
    if (state.availability === 'ANY') return entries;
    return entries.filter((entry) => entry.payloadAvailability === state.availability);
  }, [list.data, state.availability]);

  // Selected entry restored from the deep link (server revalidates on read).
  const selectedEntryId = state.selectedEntryId ?? deepLink.entryId;
  const detail = useQuery(historyEntryQueryOptions(historyClient, scope, selectedEntryId ?? null));

  // Deep-link restore: the URL is the single source of truth for selection.
  useEffect(() => {
    if (deepLink.entryId === null) {
      dispatch({ type: 'CLEAR_SELECTION' });
      return;
    }
    dispatch({ type: 'SELECT_ENTRY', historyEntryId: deepLink.entryId });
  }, [deepLink]);

  const selectEntry = useCallback(
    (historyEntryId: string) => {
      const params = new URLSearchParams();
      params.set('entry', historyEntryId);
      setSearchParameters(params);
      dispatch({ type: 'SELECT_ENTRY', historyEntryId });
      announce(HISTORY_ANNOUNCEMENTS.SELECTED);
    },
    [announce, setSearchParameters],
  );

  const nextPage = useCallback(() => {
    if (list.data?.nextCursor === undefined) return;
    dispatch({ type: 'SET_PAGE_CURSOR', cursor: list.data.nextCursor });
    announce(HISTORY_ANNOUNCEMENTS.PAGE_CHANGED);
  }, [list.data, announce]);

  const previousPage = useCallback(() => {
    dispatch({ type: 'SET_PAGE_CURSOR', cursor: null });
    announce(HISTORY_ANNOUNCEMENTS.PAGE_CHANGED);
  }, [announce]);

  const clearSelection = useCallback(() => {
    setSearchParameters('');
    dispatch({ type: 'CLEAR_SELECTION' });
  }, [setSearchParameters]);

  return (
    <div className="workspace-layout history-layout">
      <p className="visually-hidden" role="status" aria-live="polite" ref={liveRegionRef} />
      <aside className="history-list-pane" aria-label="히스토리 목록">
        <header className="history-list-header">
          <h1>History</h1>
        </header>

        <HistoryFilters
          domainKinds={state.domainKinds}
          availability={state.availability}
          onToggleDomainKind={(kind) => {
            dispatch({ type: 'TOGGLE_DOMAIN_KIND', domainKind: kind });
            announce(HISTORY_ANNOUNCEMENTS.FILTER_CHANGED);
          }}
          onSetAvailability={(availability) => {
            dispatch({ type: 'SET_AVAILABILITY', availability });
            announce(HISTORY_ANNOUNCEMENTS.FILTER_CHANGED);
          }}
        />

        {list.isPending ? (
          <LoadingState message="히스토리를 불러오는 중…" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : visibleEntries.length === 0 ? (
          <EmptyState title="히스토리 없음" description="표시할 히스토리가 없습니다." />
        ) : (
          <ol className="history-list" aria-label="히스토리 항목">
            {visibleEntries.map((entry) => (
              <li key={entry.historyEntryId}>
                <button
                  type="button"
                  className="history-list-item"
                  aria-current={selectedEntryId === entry.historyEntryId ? 'true' : undefined}
                  onClick={() => selectEntry(entry.historyEntryId)}
                >
                  <span className="history-item-domain">
                    {historyDomainKindLabel[entry.domainKind]}
                  </span>
                  <span className="history-item-event">
                    <code>{entry.sourceEventKind}</code> · <code>{entry.sourceEventId}</code>
                  </span>
                  <span className="history-item-time">{formatOccurredAt(entry.occurredAt)}</span>
                  <PayloadAvailabilityBadge entry={entry} />
                </button>
              </li>
            ))}
          </ol>
        )}

        <nav className="history-pagination" aria-label="히스토리 페이지">
          <button type="button" onClick={previousPage} disabled={state.pageCursor === null}>
            처음
          </button>
          <button type="button" onClick={nextPage} disabled={list.data?.nextCursor === undefined}>
            다음
          </button>
        </nav>
      </aside>

      <main className="history-detail-pane" aria-label="히스토리 상세">
        {selectedEntryId === null ? (
          <EmptyState
            title="히스토리 항목을 선택하세요"
            description="목록에서 항목을 선택하면 authoritative 상세와 payload 상태를 표시합니다."
          />
        ) : detail.isPending ? (
          <LoadingState message="히스토리 항목을 불러오는 중…" />
        ) : detail.isError ? (
          <HistoryDetail entry={undefined} entryError={detail.error} onClear={clearSelection} />
        ) : (
          <HistoryDetail
            entry={detail.data?.entry}
            entryError={undefined}
            onClear={clearSelection}
          />
        )}
      </main>
    </div>
  );
};
