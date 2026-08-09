import type {
  HistoryCursorV1,
  HistorySourceDomainKindV1,
  PayloadAvailabilityV1,
} from '@shotgun/api-client';

/**
 * FE-P5-S2 WP5 — History Workspace UI state.
 *
 * The browser owns ONLY selection, domain filters and pagination (ADR-131 §2 /
 * IR r1 §5 WP5). Everything else — Principal, Project, access, policy,
 * capability, sensitivity and the audit read capability — is server-derived
 * and never authored here. Payload availability is a DISPLAY concern only:
 * the frozen `ListHistoryWorkspaceRequestV1` has no availability filter field
 * (GPT WP5 Round 1 A), so there is no client-side availability filter — a
 * page-local filter would produce false-empty pages and skip rows.
 */

export const HISTORY_DOMAIN_KIND_OPTIONS: readonly HistorySourceDomainKindV1[] = [
  'CANONICAL',
  'REVIEW',
  'EXTERNAL_ACTION',
  'POLICY',
];

/** Text labels independent of color (accessibility). */
export const historyDomainKindLabel: Record<HistorySourceDomainKindV1, string> = {
  CANONICAL: 'Canonical',
  REVIEW: 'Review',
  EXTERNAL_ACTION: 'External actions',
  POLICY: 'Policy',
};

export const historyAvailabilityLabel: Record<PayloadAvailabilityV1, string> = {
  AVAILABLE: 'Available',
  REDACTED: 'Redacted',
  PURGED_BY_POLICY: 'Purged by policy',
  UNAVAILABLE: 'Unavailable',
};

export type HistoryWorkspaceState = {
  readonly domainKinds: readonly HistorySourceDomainKindV1[];
  readonly selectedEntryId: string | null;
  /** Frozen-tuple keyset cursor (object) or null on the first page. */
  readonly pageCursor: HistoryCursorV1 | null;
};

export type HistoryWorkspaceAction =
  | { readonly type: 'TOGGLE_DOMAIN_KIND'; readonly domainKind: HistorySourceDomainKindV1 }
  | { readonly type: 'SELECT_ENTRY'; readonly historyEntryId: string }
  | { readonly type: 'CLEAR_SELECTION' }
  | { readonly type: 'SET_PAGE_CURSOR'; readonly cursor: HistoryCursorV1 | null };

export const createInitialHistoryWorkspaceState = (): HistoryWorkspaceState => ({
  domainKinds: [],
  selectedEntryId: null,
  pageCursor: null,
});

const toggle = <T>(list: readonly T[], value: T): readonly T[] =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

export const reduceHistoryWorkspaceState = (
  state: HistoryWorkspaceState,
  action: HistoryWorkspaceAction,
): HistoryWorkspaceState => {
  switch (action.type) {
    case 'TOGGLE_DOMAIN_KIND':
      // A domain filter change MUST reset the keyset cursor: continuing from
      // the previous page would skip the first page of the new filter
      // (GPT WP5 Round 1 A).
      return {
        ...state,
        domainKinds: toggle(state.domainKinds, action.domainKind),
        pageCursor: null,
      };
    case 'SELECT_ENTRY':
      return { ...state, selectedEntryId: action.historyEntryId };
    case 'CLEAR_SELECTION':
      return { ...state, selectedEntryId: null };
    case 'SET_PAGE_CURSOR':
      return { ...state, pageCursor: action.cursor };
  }
};

/** Live announcements for meaningful changes only. */
export const HISTORY_ANNOUNCEMENTS = {
  FILTER_CHANGED: '히스토리 필터를 변경했습니다.',
  SELECTED: '히스토리 항목을 선택했습니다.',
  PAGE_CHANGED: '히스토리 페이지를 이동했습니다.',
} as const;
