import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';

import type { GlobalShellView, KnowledgeCompareRequest } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { knowledgeCompareQueryOptions } from '../knowledge/knowledge-queries.js';
import { LineageMetadata, ProjectionStatus } from '../knowledge/knowledge-ui.js';

export const KnowledgeCompareWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const [searchParameters] = useSearchParams();
  const leftId = searchParameters.get('left') ?? '';
  const rightId = searchParameters.get('right') ?? '';
  const requestedRevision = searchParameters.get('revision') ?? undefined;
  const focusId = searchParameters.get('focus') ?? undefined;
  const validSelection = Boolean(leftId && rightId && leftId !== rightId);
  const request = useMemo<KnowledgeCompareRequest>(
    () => ({
      schemaVersion: '1.0.0',
      pageIds: [leftId, rightId],
      ...(requestedRevision ? { requestedRevision } : {}),
      ...(focusId ? { focusId } : {}),
    }),
    [focusId, leftId, requestedRevision, rightId],
  );
  const comparison = useQuery({
    ...knowledgeCompareQueryOptions(apiClient, shell, request),
    enabled: Boolean(shell.activeProject && validSelection),
  });

  if (!shell.activeProject) {
    return (
      <section className="route-page knowledge-compare-workspace">
        <p className="eyebrow">Knowledge compare</p>
        <h1 tabIndex={-1}>Knowledge Compare</h1>
        <EmptyState
          title="Create a Project before comparing Knowledge"
          description="Comparisons are authorized against the active server Project."
        />
      </section>
    );
  }
  if (!validSelection) {
    return (
      <section className="route-page knowledge-compare-workspace">
        <p className="eyebrow">Read-only typed compare</p>
        <h1 tabIndex={-1}>Knowledge Compare</h1>
        <EmptyState
          title="Select two different Knowledge Pages"
          description="Return to the Workspace and select exactly two server-provided Pages."
        />
        <Link to="/knowledge">Back to Knowledge Workspace</Link>
      </section>
    );
  }
  if (comparison.isPending) return <LoadingState message="Loading typed Knowledge comparison" />;
  if (comparison.error) {
    return <ErrorState error={comparison.error} onRetry={() => void comparison.refetch()} />;
  }
  if (!comparison.data) return null;

  const result = comparison.data;
  const comparedPages = [
    { heading: 'Left Page', page: result.left },
    { heading: 'Right Page', page: result.right },
  ] as const;
  return (
    <section className="route-page knowledge-compare-workspace">
      <p className="eyebrow">Read-only typed compare</p>
      <h1 tabIndex={-1}>Knowledge Compare</h1>
      <p>
        <Link to="/knowledge">Back to Knowledge Workspace</Link>
      </p>
      <p className="status-message" role="status" aria-live="polite">
        Left and right order is supplied by the server compare response. This view does not compute,
        merge, or write differences.
      </p>
      <ProjectionStatus projection={result.projection} />

      <div className="knowledge-compare-columns">
        {comparedPages.map(({ heading, page }) => (
          <section className="action-card" aria-labelledby={`${heading}-heading`} key={heading}>
            <h2 id={`${heading}-heading`}>{heading}</h2>
            <h3>{page.title}</h3>
            <p>
              <Link
                to={`/knowledge/${encodeURIComponent(page.resourceId)}?revision=${encodeURIComponent(page.revision)}`}
              >
                Open stable detail
              </Link>
            </p>
            <dl className="identity-summary">
              <div>
                <dt>Resource</dt>
                <dd>{page.resourceId}</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{page.revision}</dd>
              </div>
            </dl>
            <LineageMetadata lineage={page.lineage} />
            <ul className="knowledge-compare-item-list" aria-label={`${heading} items`}>
              {page.items.map((item) => (
                <li key={`${item.resourceId}:${item.revision}`}>
                  <strong>{item.label}</strong>
                  <span>{item.authority}</span>
                  <span>{item.kind}</span>
                  <span>{item.temporalState}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="action-card" aria-labelledby="knowledge-differences-heading">
        <h2 id="knowledge-differences-heading">Server differences</h2>
        {result.differences.length === 0 ? (
          <EmptyState
            title="No differences reported"
            description="The server returned an empty difference list."
          />
        ) : (
          <ol className="knowledge-difference-list">
            {result.differences.map((difference) => (
              <li key={difference.differenceId}>
                <strong>{difference.kind}</strong>
                <code>{difference.path}</code>
                <dl>
                  <div>
                    <dt>Left</dt>
                    <dd>{difference.leftValue ?? 'Not supplied'}</dd>
                  </div>
                  <div>
                    <dt>Right</dt>
                    <dd>{difference.rightValue ?? 'Not supplied'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
};
