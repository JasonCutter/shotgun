/**
 * FE-P5-S2 WP5 — History Workspace route/deep-link contract.
 *
 * The browser owns only the selected History entry id (`entry`) and, for an
 * authorized deleted-project audit read, the audit target (`resourceProjectId`).
 * Every binding (Principal, Project, access, policy, capability, sensitivity)
 * stays server-derived; the server revalidates tombstone + audit scope +
 * current capability for a non-active resourceProjectId (Round 2 C). The
 * owning-Domain routes (External Action, Review) revalidate access on arrival.
 */

export type HistoryDeepLink = {
  readonly entryId: string | null;
  /** Explicit deleted-project audit target; null → active project. */
  readonly resourceProjectId: string | null;
};

export const parseHistoryDeepLink = (searchParameters: URLSearchParams): HistoryDeepLink => {
  const entryId = searchParameters.get('entry');
  const resourceProjectId = searchParameters.get('resourceProjectId');
  return {
    entryId: entryId === null || entryId.trim().length === 0 ? null : entryId,
    resourceProjectId:
      resourceProjectId === null || resourceProjectId.trim().length === 0
        ? null
        : resourceProjectId,
  };
};

/** History deep-link href for a selected entry / audit target (or the bare workspace). */
export const historyDeepLinkHref = (
  entryId: string | null,
  resourceProjectId: string | null = null,
): string => {
  const params = new URLSearchParams();
  if (entryId !== null) params.set('entry', entryId);
  if (resourceProjectId !== null) params.set('resourceProjectId', resourceProjectId);
  const query = params.toString();
  return query.length === 0 ? '/history' : `/history?${query}`;
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
