/**
 * FE-P5-S2 WP5 — History Workspace route/deep-link contract.
 *
 * The browser owns only the selected History entry id (`entry`) in the URL;
 * every binding (Principal, Project, access, policy, capability, sensitivity)
 * stays server-derived. The owning-Domain routes (External Action, Review)
 * revalidate access on arrival.
 */

export type HistoryDeepLink = {
  readonly entryId: string | null;
};

export const parseHistoryDeepLink = (searchParameters: URLSearchParams): HistoryDeepLink => {
  const entryId = searchParameters.get('entry');
  return {
    entryId: entryId === null || entryId.trim().length === 0 ? null : entryId,
  };
};

/** History deep-link href for a selected entry (or the bare workspace). */
export const historyDeepLinkHref = (entryId: string | null): string => {
  if (entryId === null) return '/history';
  const params = new URLSearchParams();
  params.set('entry', entryId);
  return `/history?${params.toString()}`;
};

/** Owning-Domain External Action deep link for audit lineage / compensation. */
export const historyExternalActionHref = (actionId: string): string => {
  const params = new URLSearchParams();
  params.set('actionId', actionId);
  return `/external-action?${params.toString()}`;
};

/** Reversal entry point: the change-set-review owning route (WP3). */
export const HISTORY_REVERSAL_HREF = '/review';

/** Owning-Domain Review workspace (Reversal drafts live there, WP3). */
export const HISTORY_REVIEW_HREF = '/review';
