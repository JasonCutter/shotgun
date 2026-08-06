import type { ActivityDomainKindV1 } from '@shotgun/api-client';

import type { ActivityIdentity } from './activity-queries.js';

/**
 * FE-P5-S1 WP4 — Activity Workspace route and deep-link contract.
 *
 * The URL carries ONLY the server-owned Activity identity (domain kind,
 * projection activity id, exact Domain resource kind/id). The server
 * revalidates Project Scope, Capability, sensitivity and Resource access on
 * every Detail read (AC-12), so a denied deep link resolves to the same
 * non-disclosing NOT_FOUND. The browser never places authority, payloads or
 * projection revisions into the URL.
 */

export const ACTIVITY_ROUTE = '/activity' as const;

export type ActivityDeepLink = {
  readonly domainKind: ActivityDomainKindV1 | null;
  readonly activityId: string | null;
  readonly resourceKind: string | null;
  readonly resourceId: string | null;
};

export const EMPTY_ACTIVITY_DEEP_LINK: ActivityDeepLink = {
  domainKind: null,
  activityId: null,
  resourceKind: null,
  resourceId: null,
};

const DOMAIN_KINDS: readonly string[] = ['SOURCES', 'ASK', 'EXTERNAL_ACTION'];

/** Strict parse — only the registered query keys are read; anything else is ignored. */
export const parseActivityDeepLink = (
  searchParams: Readonly<URLSearchParams>,
): ActivityDeepLink => {
  const read = (key: 'domain' | 'activity' | 'resource' | 'resourceId'): string | null => {
    const value = searchParams.get(key);
    return value === null || value.trim() === '' ? null : value;
  };
  const domainKind = read('domain');
  return {
    domainKind:
      domainKind && DOMAIN_KINDS.includes(domainKind) ? (domainKind as ActivityDomainKindV1) : null,
    activityId: read('activity'),
    resourceKind: read('resource'),
    resourceId: read('resourceId'),
  };
};

/** Build a deep link to a concrete Activity identity. */
export const activityDeepLinkHref = (identity: ActivityIdentity): string => {
  const params = new URLSearchParams();
  params.set('domain', identity.domainKind);
  params.set('activity', identity.activityId);
  params.set('resource', identity.domainResourceKind);
  params.set('resourceId', identity.domainResourceId);
  return `${ACTIVITY_ROUTE}?${params.toString()}`;
};
