import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
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
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const homeQuery = useQuery(homeActionCenterQueryOptions(apiClient, shell));

  if (!shell.activeProject) {
    return (
      <section className="route-page first-run">
        <p className="eyebrow">First run</p>
        <h1 tabIndex={-1}>Create your first Project</h1>
        <p>Create your first Project to get started.</p>
        <Link className="primary-link" to="/settings/projects">
          Open Project onboarding
        </Link>
      </section>
    );
  }
  if (homeQuery.isPending) return <LoadingState message="Loading Home Action Center…" />;
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
    <section className="route-page home-action-center">
      <p className="eyebrow">Action Center</p>
      <h1 tabIndex={-1}>Home</h1>
      {home.stale ? (
        <p className="stale-state" role="status">
          This server snapshot is stale. Actions are unavailable until refresh.
        </p>
      ) : null}

      <section aria-labelledby="primary-actions-heading" className="action-card">
        <h2 id="primary-actions-heading">Primary Actions</h2>
        <ul className="action-grid">
          {home.primaryActions.map((action) => (
            <li key={action.id}>
              {action.availability === 'AVAILABLE' && !home.stale ? (
                <Link to={action.targetRoute.href}>{action.label}</Link>
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
        <section aria-labelledby="attention-heading" className="action-card">
          <h2 id="attention-heading">Attention</h2>
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
        <section aria-labelledby="continue-heading" className="action-card">
          <h2 id="continue-heading">Continue Working</h2>
          {home.continueWorking.length > 0 ? (
            <>
              <h3>Server resources</h3>
              <ResourceList items={home.continueWorking} />
            </>
          ) : null}
          {browserDrafts.length > 0 ? (
            <>
              <h3>Browser drafts</h3>
              <ul>
                {browserDrafts.map((draft) => (
                  <li key={`browser:${draft.draftId}`}>
                    <Link to={draft.targetRoute.href}>{draft.label}</Link>
                    <small>Browser draft · never server-ranked</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {home.recent.length > 0 || home.pinned.length > 0 ? (
        <section aria-labelledby="recent-pinned-heading" className="action-card">
          <h2 id="recent-pinned-heading">Recent and Pinned</h2>
          <div className="two-column-list">
            {home.recent.length > 0 ? (
              <div>
                <h3>Recent</h3>
                <ResourceList items={home.recent} />
              </div>
            ) : null}
            {home.pinned.length > 0 ? (
              <div>
                <h3>Pinned</h3>
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
