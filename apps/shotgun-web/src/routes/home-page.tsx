import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useProductLocalization } from '../localization/product-localization.js';
import {
  browserDraftStorageKey,
  decodeRestorableBrowserDrafts,
} from '../section3/browser-drafts.js';
import { homeActionCenterQueryOptions } from '../section3/section3-queries.js';

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
    return (
      <section className="route-page hfm-route-page first-run">
        <p className="eyebrow">{t('home.first_run')}</p>
        <h1 tabIndex={-1}>{t('home.create_first_project')}</h1>
        <p>{t('home.create_first_project_help')}</p>
        <Link className="primary-link" to="/settings/projects">
          {t('home.open_onboarding')}
        </Link>
      </section>
    );
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
