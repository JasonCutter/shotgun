import type { BrowserDraftPresentationView } from '@shotgun/api-client';

type DraftScope = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly sourceRevision: string;
  readonly sensitivityClearance: BrowserDraftPresentationView['sensitivity'];
  readonly now: number;
};

const sensitivityRank: Record<BrowserDraftPresentationView['sensitivity'], number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

export const browserDraftStorageKey = (projectId: string, sessionId: string): string =>
  `shotgun:drafts:v1:${projectId}:${sessionId}`;

export const decodeRestorableBrowserDrafts = (
  value: unknown,
  scope: DraftScope,
): readonly BrowserDraftPresentationView[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return [];
    }
    const draft = candidate as Record<string, unknown>;
    if (
      draft.origin !== 'BROWSER_DRAFT' ||
      typeof draft.draftId !== 'string' ||
      draft.draftId.length === 0 ||
      typeof draft.label !== 'string' ||
      draft.projectId !== scope.projectId ||
      draft.sessionId !== scope.sessionId ||
      draft.sourceRevision !== scope.sourceRevision ||
      typeof draft.expiresAt !== 'string' ||
      Date.parse(draft.expiresAt) <= scope.now ||
      !['public', 'internal', 'private', 'restricted'].includes(String(draft.sensitivity)) ||
      sensitivityRank[draft.sensitivity as BrowserDraftPresentationView['sensitivity']] >
        sensitivityRank[scope.sensitivityClearance] ||
      typeof draft.targetRoute !== 'object' ||
      draft.targetRoute === null
    ) {
      return [];
    }
    const route = draft.targetRoute as Record<string, unknown>;
    const routes = {
      sources: '/sources',
      ask: '/ask',
      knowledge: '/knowledge',
      review: '/review',
      settings: '/settings',
      'settings-projects': '/settings/projects',
      home: '/',
    } as const;
    if (
      typeof route.routeId !== 'string' ||
      !(route.routeId in routes) ||
      route.href !== routes[route.routeId as keyof typeof routes]
    ) {
      return [];
    }
    return [draft as unknown as BrowserDraftPresentationView];
  });
};
