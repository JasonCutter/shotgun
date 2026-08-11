import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import {
  knowledgeCanManuallyRetry,
  knowledgeDetailQueryOptions,
} from '../knowledge/knowledge-queries.js';
import {
  decodeKnowledgeResourceReturnState,
  KnowledgeItemCard,
  LineageMetadata,
  ProjectionStatus,
} from '../knowledge/knowledge-ui.js';

export const KnowledgeDetailWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { resourceId = '' } = useParams();
  const location = useLocation();
  const [searchParameters] = useSearchParams();
  const requestedRevision = searchParameters.get('revision') ?? undefined;
  const requestedFocusId = searchParameters.get('focus') ?? undefined;
  const request = useMemo(
    () => ({
      schemaVersion: '1.0.0' as const,
      resourceId,
      ...(requestedRevision ? { requestedRevision } : {}),
      ...(requestedFocusId ? { focusId: requestedFocusId } : {}),
    }),
    [requestedFocusId, requestedRevision, resourceId],
  );
  const detail = useQuery({
    ...knowledgeDetailQueryOptions(apiClient, shell, request),
    enabled: Boolean(shell.activeProject && resourceId),
  });
  const returnState = useMemo(
    () =>
      detail.data
        ? decodeKnowledgeResourceReturnState(location.state, resourceId, detail.data.revision)
        : undefined,
    [detail.data, location.state, resourceId],
  );
  const focusId = returnState?.target.focusId ?? requestedFocusId ?? detail.data?.focusId;
  const originRoute = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!focusId || !detail.data) return;
    const target = Array.from(
      document.querySelectorAll<HTMLElement>('[data-knowledge-focus]'),
    ).find((node) => node.dataset.knowledgeFocus === focusId);
    if (!target) return;
    target.focus({ preventScroll: false });
  }, [detail.data, focusId]);

  if (!shell.activeProject) {
    return (
      <section className="route-page knowledge-detail-workspace">
        <p className="eyebrow">Knowledge detail</p>
        <h1 tabIndex={-1}>Knowledge</h1>
        <EmptyState
          title="Create a Project before opening Knowledge"
          description="The server did not authorize a Project-scoped Knowledge read."
        />
      </section>
    );
  }
  if (!resourceId) {
    return (
      <section className="route-page knowledge-detail-workspace">
        <p className="eyebrow">Knowledge detail</p>
        <h1 tabIndex={-1}>Knowledge resource not found</h1>
        <EmptyState title="A stable resource ID is required" />
        <Link to="/knowledge">Back to Knowledge Workspace</Link>
      </section>
    );
  }
  if (detail.isPending) return <LoadingState message="Loading Knowledge detail" />;
  if (detail.error) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={knowledgeCanManuallyRetry(detail.error) ? () => void detail.refetch() : undefined}
      />
    );
  }
  if (!detail.data) return null;

  const page = detail.data.page;
  return (
    <section className="route-page knowledge-detail-workspace">
      <p className="eyebrow">Read-only Knowledge detail</p>
      <h1 tabIndex={-1}>{page.title}</h1>
      <p>
        <Link to="/knowledge">Back to Knowledge Workspace</Link>
      </p>
      {returnState ? (
        <p className="status-message" role="status" aria-live="polite">
          Returned to the cited knowledge item.
        </p>
      ) : null}

      <dl className="identity-summary">
        <div>
          <dt>Project</dt>
          <dd>{shell.activeProject.label}</dd>
        </div>
      </dl>
      <TechnicalDetails
        items={[
          { label: 'Project ID', value: page.projectId },
          { label: 'Resource ID', value: page.resourceId },
          { label: 'Revision', value: page.revision },
          { label: 'Page ID', value: page.pageId },
        ]}
      />

      <ProjectionStatus projection={page.projection} />

      <section className="action-card" aria-labelledby="knowledge-detail-capabilities-heading">
        <h2 id="knowledge-detail-capabilities-heading">Read capabilities</h2>
        <p>
          This page exposes exploration capabilities only. Canonical write, Approval, Commit, and
          external Action controls are intentionally absent.
        </p>
        <p>Read and exploration tools are available for this page.</p>
      </section>

      <LineageMetadata lineage={page.lineage} />

      <section
        id="knowledge-items"
        className="knowledge-items"
        aria-labelledby="knowledge-items-heading"
      >
        <h2 id="knowledge-items-heading">Knowledge items</h2>
        {page.items.length === 0 ? (
          <EmptyState title="No items in this Knowledge Page" />
        ) : (
          <div className="knowledge-item-list">
            {page.items.map((item) => (
              <KnowledgeItemCard
                key={`${item.resourceId}:${item.revision}`}
                item={item}
                originRoute={originRoute}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
};
