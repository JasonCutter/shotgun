/**
 * FE-P4-S2 WP5 External Action Governance Workspace — route and deep-link
 * contract (IR WP5 item 2).
 *
 * The URL carries ONLY selection of server-owned resource identities
 * (`actionId`, `manifestId`, `executionId`, `attemptId`, `verificationId`) and
 * an optional focus hint. The workspace never places command payloads,
 * capabilities, credential/budget views or drafts into the URL. Deep-link
 * restore, refresh, cancel and verification preserve focus (contract §10.5).
 */

export const EXTERNAL_ACTION_ROUTE = '/external-action' as const;

export type ExternalActionDeepLink = {
  readonly actionId: string | null;
  readonly manifestId: string | null;
  readonly executionId: string | null;
  readonly attemptId: string | null;
  readonly verificationId: string | null;
  readonly focus: string | null;
};

export const EMPTY_EXTERNAL_ACTION_DEEP_LINK: ExternalActionDeepLink = {
  actionId: null,
  manifestId: null,
  executionId: null,
  attemptId: null,
  verificationId: null,
  focus: null,
};

/** Strict parse — only the registered query keys are read; anything else is ignored. */
export const parseExternalActionDeepLink = (
  searchParams: Readonly<URLSearchParams>,
): ExternalActionDeepLink => {
  const read = (
    key: 'action' | 'manifest' | 'execution' | 'attempt' | 'verification' | 'focus',
  ): string | null => {
    const value = searchParams.get(key);
    return value === null || value.trim() === '' ? null : value;
  };
  return {
    actionId: read('action'),
    manifestId: read('manifest'),
    executionId: read('execution'),
    attemptId: read('attempt'),
    verificationId: read('verification'),
    focus: read('focus'),
  };
};

export const externalActionDeepLinkHref = (link: Partial<ExternalActionDeepLink>): string => {
  const params = new URLSearchParams();
  if (link.actionId) params.set('action', link.actionId);
  if (link.manifestId) params.set('manifest', link.manifestId);
  if (link.executionId) params.set('execution', link.executionId);
  if (link.attemptId) params.set('attempt', link.attemptId);
  if (link.verificationId) params.set('verification', link.verificationId);
  if (link.focus) params.set('focus', link.focus);
  const query = params.toString();
  return query ? `${EXTERNAL_ACTION_ROUTE}?${query}` : EXTERNAL_ACTION_ROUTE;
};
