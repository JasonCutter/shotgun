import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendHistoryClient,
  createFrontendReviewClient,
  type GlobalShellView,
  type HistoryEntryV1,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import {
  TechnicalDetails,
  type TechnicalInspectionDetailItem,
} from '../components/technical-details.js';
import { historyScopeFromShell } from '../app/query-keys.js';
import {
  HISTORY_LIST_LIMIT,
  historyEntryQueryOptions,
  historyListQueryOptions,
} from '../history/history-queries.js';
import {
  HISTORY_ANNOUNCEMENTS,
  HISTORY_DOMAIN_KIND_OPTIONS,
  createInitialHistoryWorkspaceState,
  historyAvailabilityLabel,
  historyDomainKindLabel,
  reduceHistoryWorkspaceState,
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
 * list with Domain filters + frozen-cursor pagination, and a Detail panel that
 * re-resolves the authoritative source (payload availability display). Audit
 * lineage links EXTERNAL_ACTION rows to the owning-Domain External Action
 * workspace; the Reversal entry point and Compensation link go to the
 * owning-Domain routes (WP3 change-set-review / external action) — History
 * owns no command endpoint. Payload availability is display-only (the frozen
 * list request has no availability filter; GPT WP5 Round 1 A). Deleted-project
 * access is non-disclosing (same NOT_FOUND as any missing resource). The
 * browser owns only selection, domain filters and pagination.
 */

const payloadAvailabilityClass = (availability: HistoryEntryV1['payloadAvailability']): string =>
  `history-payload-badge history-payload-${availability.toLowerCase()}`;

const formatOccurredAt = (occurredAt: string): string => {
  const date = new Date(occurredAt);
  return Number.isNaN(date.getTime()) ? occurredAt : date.toLocaleString();
};

const historyEventLabel = (kind: string): string => {
  const labels: Readonly<Record<string, string>> = {
    CANONICAL_CLAIM_ADDED: 'Knowledge claim added',
    DECISION: 'Review decision recorded',
    APPROVAL: 'Approval recorded',
    RESULT: 'External action result recorded',
    AUDIT_EVENT: 'External action audit updated',
    SETTINGS_AUDIT_EVENT: 'Project settings changed',
    CLAIM: 'Knowledge claim changed',
  };
  return labels[kind] ?? 'Project history updated';
};

const payloadInspectionItems = (
  entry: HistoryEntryV1,
): readonly TechnicalInspectionDetailItem[] => {
  const availability: TechnicalInspectionDetailItem = {
    label: 'Payload availability',
    value: entry.payloadAvailability,
  };
  if (entry.payloadAvailability === 'AVAILABLE' && entry.payloadSnapshot !== undefined) {
    return [
      availability,
      { label: 'Audit payload', value: JSON.stringify(entry.payloadSnapshot, null, 2) },
    ];
  }
  if (entry.payloadAvailability === 'PURGED_BY_POLICY' && entry.payloadSnapshot !== undefined) {
    return [
      availability,
      { label: 'Payload tombstone', value: JSON.stringify(entry.payloadSnapshot) },
    ];
  }
  return [availability];
};

const PayloadAvailabilityBadge = ({ entry }: { readonly entry: HistoryEntryV1 }) => (
  <span className={payloadAvailabilityClass(entry.payloadAvailability)}>
    {historyAvailabilityLabel[entry.payloadAvailability]}
  </span>
);

const HistoryFilters = ({
  domainKinds,
  onToggleDomainKind,
}: {
  readonly domainKinds: readonly HistoryEntryV1['domainKind'][];
  readonly onToggleDomainKind: (kind: HistoryEntryV1['domainKind']) => void;
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
  </section>
);

/** Audit lineage / owning-Domain links + Reversal initiation for an entry. */
const OwningDomainLinks = ({
  entry,
  onStartReversal,
  reversalPending,
  reversalError,
}: {
  readonly entry: HistoryEntryV1;
  readonly onStartReversal?: () => void;
  readonly reversalPending: boolean;
  readonly reversalError: string | null;
}) => {
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
    links.push({ label: 'Review workspace', href: HISTORY_REVIEW_HREF });
  }
  return (
    <ul className="history-owning-links" aria-label="소유 도메인 링크">
      {links.map((link) => (
        <li key={link.label}>
          <Link to={link.href}>{link.label}</Link>
        </li>
      ))}
      {entry.domainKind === 'CANONICAL' && onStartReversal ? (
        <li>
          <button
            type="button"
            onClick={onStartReversal}
            disabled={reversalPending}
            className="history-reversal-button"
          >
            {reversalPending ? 'Reversal draft 생성 중…' : 'Reversal draft 생성'}
          </button>
          {reversalError ? (
            <p className="history-reversal-error" role="alert">
              {reversalError}
            </p>
          ) : null}
        </li>
      ) : null}
    </ul>
  );
};

const HistoryDetail = ({
  entry,
  entryError,
  onClear,
  onStartReversal,
  reversalPending,
  reversalError,
}: {
  readonly entry: HistoryEntryV1 | undefined;
  readonly entryError: unknown;
  readonly onClear: () => void;
  readonly onStartReversal?: () => void;
  readonly reversalPending: boolean;
  readonly reversalError: string | null;
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
        <h2>{historyEventLabel(entry.sourceEventKind)}</h2>
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
      <TechnicalDetails
        items={[
          { label: 'Source event kind', value: entry.sourceEventKind },
          { label: 'Source event ID', value: entry.sourceEventId },
          { label: 'Resource kind', value: entry.domainResourceKind },
          { label: 'Resource ID', value: entry.domainResourceId },
        ]}
        inspectionItems={payloadInspectionItems(entry)}
      />
      <OwningDomainLinks
        entry={entry}
        onStartReversal={entry.domainKind === 'CANONICAL' ? onStartReversal : undefined}
        reversalPending={reversalPending}
        reversalError={reversalError}
      />
    </article>
  );
};

export const HistoryWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const historyClient = useMemo(() => createFrontendHistoryClient(), []);
  const reviewClient = useMemo(() => createFrontendReviewClient(), []);
  const navigate = useNavigate();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceHistoryWorkspaceState,
    undefined,
    createInitialHistoryWorkspaceState,
  );
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);
  const [reversalError, setReversalError] = useState<string | null>(null);

  const deepLink = useMemo(() => parseHistoryDeepLink(searchParameters), [searchParameters]);
  // Round 2 C: an explicit deleted-project audit target (`resourceProjectId`)
  // overrides the resource project for the History read while the ACTIVE
  // project stays the live control project; the server revalidates tombstone +
  // audit scope + current capability for any non-active resourceProjectId.
  const scope = historyScopeFromShell(shell, deepLink.resourceProjectId ?? undefined);

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

  // Payload availability is display-only (no server filter field); the list
  // renders exactly the server page (GPT WP5 Round 1 A — no page-local filter).
  const visibleEntries = list.data?.entries ?? [];

  // Selected entry restored from the deep link (server revalidates on read).
  const selectedEntryId = state.selectedEntryId ?? deepLink.entryId;
  const detail = useQuery(historyEntryQueryOptions(historyClient, scope, selectedEntryId ?? null));
  const detailEntry = detail.data?.entry;

  // Reversal initiation (GPT WP5 Round 1 B / Round 2 B1): the selected Canonical
  // History entry resolves its authoritative Canonical revision identity
  // (`payloadSnapshot.revisionId`, resolved server-side from
  // HistoryEvent → commitId → CanonicalCommitResult.revisionId). The browser
  // NEVER infers a revision identity from the numeric beforeVersion/afterVersion.
  // The change-set-review owning route (WP3) creates the persisted CANDIDATE
  // draft with server-derived current capability + principal, then the current
  // Review Workspace takes over.
  const reversalMutation = useMutation({
    mutationFn: async () => {
      if (!scope || !detailEntry) throw new Error('Reversal requires a selected History entry.');
      const snapshot = detailEntry.payloadSnapshot as
        { revisionId?: string; afterVersion?: unknown } | undefined;
      const sourceRevisionId =
        typeof snapshot?.revisionId === 'string' && snapshot.revisionId.length > 0
          ? snapshot.revisionId
          : undefined;
      if (!sourceRevisionId) {
        throw new Error('이 항목에는 Reversal 대상 revision이 없습니다.');
      }
      return reviewClient.createReversalDraftChangeSet({
        schemaVersion: '1.0.0',
        resourceProjectId: scope.resourceProjectId,
        sourceRevisionId,
        reason: 'Reversal initiated from the History Workspace.',
      });
    },
    onSuccess: () => {
      announce('Reversal draft가 생성되었습니다.');
      navigate(HISTORY_REVIEW_HREF);
    },
    onError: (error) => {
      setReversalError(
        error instanceof Error ? error.message : 'Reversal draft 생성에 실패했습니다.',
      );
    },
  });

  // Reset the reversal error whenever the selected entry changes.
  useEffect(() => {
    setReversalError(null);
  }, [selectedEntryId]);

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
      // Round 3 Blocker 3: preserve an explicit deleted-project audit target
      // (`resourceProjectId`) when selecting an entry — the audit scope must
      // not be dropped from the URL on selection.
      const params = new URLSearchParams(searchParameters);
      params.set('entry', historyEntryId);
      setSearchParameters(params);
      dispatch({ type: 'SELECT_ENTRY', historyEntryId });
      announce(HISTORY_ANNOUNCEMENTS.SELECTED);
    },
    [announce, setSearchParameters, searchParameters],
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
    // Round 3 Blocker 3: clear only the selection; keep an explicit
    // deleted-project audit target (`resourceProjectId`) in the URL.
    const params = new URLSearchParams(searchParameters);
    params.delete('entry');
    setSearchParameters(params);
    dispatch({ type: 'CLEAR_SELECTION' });
  }, [setSearchParameters, searchParameters]);

  return (
    <div className="workspace-layout history-layout">
      <p className="visually-hidden" role="status" aria-live="polite" ref={liveRegionRef} />
      <aside className="history-list-pane" aria-label="히스토리 목록">
        <header className="history-list-header">
          <h1>History</h1>
        </header>

        <HistoryFilters
          domainKinds={state.domainKinds}
          onToggleDomainKind={(kind) => {
            dispatch({ type: 'TOGGLE_DOMAIN_KIND', domainKind: kind });
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
                    {historyEventLabel(entry.sourceEventKind)}
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
          <HistoryDetail
            entry={undefined}
            entryError={detail.error}
            onClear={clearSelection}
            reversalPending={reversalMutation.isPending}
            reversalError={reversalError}
          />
        ) : (
          <HistoryDetail
            entry={detail.data?.entry}
            entryError={undefined}
            onClear={clearSelection}
            onStartReversal={() => reversalMutation.mutate()}
            reversalPending={reversalMutation.isPending}
            reversalError={reversalError}
          />
        )}
      </main>
    </div>
  );
};
