import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';

import type { GlobalShellView, ProductSessionView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { productSessionQueryKey, sessionBoundaryQueryKey } from '../app/query-keys.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useProductLocalization } from '../localization/product-localization.js';
import {
  browserDraftStorageKey,
  decodeRestorableBrowserDrafts,
} from '../section3/browser-drafts.js';
import { homeActionCenterQueryOptions } from '../section3/section3-queries.js';
import { sessionQueryOptions } from '../session/session-query.js';

/** A fresh personal VP space uses the existing atomic Project bootstrap internally. */
const AutoBootstrapKnowledgeSpace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(sessionQueryOptions(apiClient));
  const session = sessionQuery.data;
  const bootstrapQuery = useQuery({
    queryKey: [
      'vp',
      'auto-knowledge-space',
      session?.principal.id,
      session?.apiVersion === '2.0.0' ? session.projectAccessRevision : '0',
    ],
    enabled: Boolean(session && !session.activeProject),
    retry: false,
    queryFn: async (): Promise<ProductSessionView> => {
      if (!session || session.activeProject)
        throw new Error('A new knowledge space is not needed.');
      try {
        await apiClient.createFirstProject({
          name: 'Shotgun',
          projectAccessRevision:
            session.apiVersion === '2.0.0' ? session.projectAccessRevision : '0',
          clientRequestId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        // A lost response can still mean the atomic bootstrap committed.
        const current = await apiClient.getSession();
        if (current.activeProject) return current;
        throw error;
      }
      const current = await apiClient.getSession();
      if (!current.activeProject) throw new Error('The knowledge space is not ready yet.');
      return current;
    },
  });

  useEffect(() => {
    if (!bootstrapQuery.data?.activeProject) return;
    queryClient.setQueryData(productSessionQueryKey, bootstrapQuery.data);
    queryClient.setQueryData(sessionBoundaryQueryKey, (current: unknown) =>
      typeof current === 'object' && current !== null
        ? { ...current, session: bootstrapQuery.data }
        : current,
    );
  }, [bootstrapQuery.data, queryClient]);

  if (sessionQuery.error || bootstrapQuery.error) {
    return (
      <ErrorState
        error={sessionQuery.error ?? bootstrapQuery.error}
        onRetry={() => {
          void (sessionQuery.error ? sessionQuery.refetch() : bootstrapQuery.refetch());
        }}
      />
    );
  }
  return <LoadingState message="지식 공간을 준비하고 있습니다…" />;
};

const readBrowserDrafts = (shell: GlobalShellView) => {
  if (!shell.activeProject) return [];
  try {
    const raw = window.sessionStorage.getItem(
      browserDraftStorageKey(shell.activeProject.id, shell.sessionId),
    );
    const decoded = raw ? JSON.parse(raw) : [];
    const availableRoutes = new Set(
      shell.navigation
        .filter((item) => item.availability === 'AVAILABLE')
        .flatMap((item) => (item.targetRoute ? [item.targetRoute.href] : [])),
    );
    return decodeRestorableBrowserDrafts(decoded, {
      projectId: shell.activeProject.id,
      sessionId: shell.sessionId,
      sourceRevision: shell.projectionRevision,
      sensitivityClearance: shell.activeProject.sensitivityClearance,
      now: Date.now(),
    }).filter((draft) => availableRoutes.has(draft.targetRoute.href));
  } catch {
    return [];
  }
};

export const HomePage = () => {
  const { apiClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const homeQuery = useQuery(homeActionCenterQueryOptions(apiClient, shell));

  if (!shell.activeProject) {
    return <AutoBootstrapKnowledgeSpace />;
  }
  if (homeQuery.isPending) return <LoadingState message={t('home.loading')} />;
  if (homeQuery.error) {
    return (
      <ErrorState
        error={homeQuery.error}
        onRetry={() => {
          void homeQuery.refetch();
        }}
      />
    );
  }
  const home = homeQuery.data;
  if (!home) return null;
  const browserDrafts = readBrowserDrafts(shell);

  return (
    <section className="route-page hfm-route-page home-action-center">
      <p className="eyebrow">{t('home.action_center')}</p>
      <h1 tabIndex={-1}>{t('nav.home')}</h1>
      {home.stale ? (
        <p className="stale-state" role="status">
          {t('home.stale')}
        </p>
      ) : null}

      <section
        aria-labelledby="primary-actions-heading"
        className="action-card home-primary-actions"
      >
        <h2 id="primary-actions-heading">{t('home.primary_actions')}</h2>
        <ul className="action-grid">
          {home.primaryActions.map((action) => (
            <li key={action.id}>
              {action.availability === 'AVAILABLE' && !home.stale ? (
                <Link to={action.targetRoute.href}>
                  {action.id === 'add-source'
                    ? t('nav.sources')
                    : action.id === 'ask'
                      ? t('nav.ask')
                      : action.label}
                </Link>
              ) : (
                <button type="button" disabled title={action.disabledReason}>
                  {action.label}
                </button>
              )}
              {action.disabledReason ? <small>{action.disabledReason}</small> : null}
            </li>
          ))}
        </ul>
      </section>

      {home.attention.length > 0 ? (
        <section aria-labelledby="attention-heading" className="action-card home-attention">
          <h2 id="attention-heading">{t('home.attention')}</h2>
          <ol>
            {home.attention.map((item) => (
              <li key={item.stableId}>
                <Link to={item.targetRoute.href}>{item.label}</Link>
                <p>{item.reason}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {home.continueWorking.length > 0 || browserDrafts.length > 0 ? (
        <section aria-labelledby="continue-heading" className="action-card home-continue">
          <h2 id="continue-heading">{t('home.continue_working')}</h2>
          {home.continueWorking.length > 0 ? (
            <>
              <h3>{t('home.server_resources')}</h3>
              <ResourceList items={home.continueWorking} />
            </>
          ) : null}
          {browserDrafts.length > 0 ? (
            <div className="home-browser-drafts">
              <h3>{t('home.browser_drafts')}</h3>
              <ul>
                {browserDrafts.map((draft) => (
                  <li key={`browser:${draft.draftId}`}>
                    <Link to={draft.targetRoute.href}>{draft.label}</Link>
                    <small>{t('home.browser_draft_never_ranked')}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {home.recent.length > 0 || home.pinned.length > 0 ? (
        <section aria-labelledby="recent-pinned-heading" className="action-card home-recent-pinned">
          <h2 id="recent-pinned-heading">{t('home.recent_and_pinned')}</h2>
          <div className="two-column-list">
            {home.recent.length > 0 ? (
              <div>
                <h3>{t('home.recent')}</h3>
                <ResourceList items={home.recent} />
              </div>
            ) : null}
            {home.pinned.length > 0 ? (
              <div>
                <h3>{t('home.pinned')}</h3>
                <ResourceList items={home.pinned} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
};

const ResourceList = ({
  items,
}: {
  readonly items: readonly {
    readonly stableId: string;
    readonly label: string;
    readonly targetRoute: { readonly href: string };
  }[];
}) => (
  <ul>
    {items.map((item) => (
      <li key={item.stableId}>
        <Link to={item.targetRoute.href}>{item.label}</Link>
      </li>
    ))}
  </ul>
);
