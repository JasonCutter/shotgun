import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';

import {
  decodeCitationReturnTarget,
  type CitationReturnTarget,
  type GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import {
  sourceDetailQueryOptions,
  sourceEvidenceQueryOptions,
  sourcePreviewQueryOptions,
  sourceVersionHistoryQueryOptions,
} from '../sources/sources-queries.js';

export const SourceDetailWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { sourceId = '' } = useParams();
  const location = useLocation();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const detail = useQuery(sourceDetailQueryOptions(apiClient, shell, sourceId));
  const selectedVersionId =
    searchParameters.get('version') ?? detail.data?.currentSourceVersionId ?? '';
  const history = useQuery(
    sourceVersionHistoryQueryOptions(apiClient, shell, sourceId, selectedVersionId),
  );
  const preview = useQuery(
    sourcePreviewQueryOptions(apiClient, shell, sourceId, selectedVersionId, 'ORIGINAL'),
  );
  const evidence = useQuery(
    sourceEvidenceQueryOptions(apiClient, shell, sourceId, selectedVersionId),
  );
  const citationReturnTarget = useMemo<CitationReturnTarget | undefined>(() => {
    const candidate =
      typeof location.state === 'object' && location.state !== null
        ? (location.state as { readonly citationReturnTarget?: unknown }).citationReturnTarget
        : undefined;
    if (candidate === undefined) return undefined;
    try {
      const decoded = decodeCitationReturnTarget(candidate);
      return decoded.sourceId === sourceId && decoded.sourceVersionId === selectedVersionId
        ? decoded
        : undefined;
    } catch {
      return undefined;
    }
  }, [location.state, selectedVersionId, sourceId]);

  useEffect(() => {
    if (!citationReturnTarget || !evidence.data) return;
    const target = document.getElementById(`evidence-${citationReturnTarget.evidenceId}`);
    target?.scrollIntoView?.({ block: 'center' });
    target?.focus();
  }, [citationReturnTarget, evidence.data]);

  if (detail.isPending) return <LoadingState message="Loading Source…" />;
  if (detail.error) return <ErrorState error={detail.error} />;
  if (!detail.data) return null;

  return (
    <section className="route-page source-detail-workspace">
      <p className="eyebrow">Source detail</p>
      <h1 tabIndex={-1}>{detail.data.label}</h1>
      <p>
        <Link to="/sources">Back to Source Library</Link>
      </p>
      {citationReturnTarget ? (
        <p>
          <Link
            to={citationReturnTarget.originRoute}
            state={{
              citationReturn: {
                resourceKind: citationReturnTarget.resourceKind,
                resourceId: citationReturnTarget.resourceId,
                resourceRevision: citationReturnTarget.resourceRevision,
                citationId: citationReturnTarget.citationId,
                scrollAnchor: citationReturnTarget.scrollAnchor,
                focusTarget: citationReturnTarget.focusTarget,
                panelId: citationReturnTarget.panelId,
              },
            }}
          >
            Return to cited resource
          </Link>
        </p>
      ) : null}
      <dl className="identity-summary">
        <div>
          <dt>Source</dt>
          <dd>{detail.data.sourceId}</dd>
        </div>
        <div>
          <dt>Pinned SourceVersion</dt>
          <dd>{selectedVersionId}</dd>
        </div>
        <div>
          <dt>Preview readiness</dt>
          <dd>{detail.data.previewReadiness}</dd>
        </div>
        <div>
          <dt>Ask usage</dt>
          <dd>{detail.data.askUsageState}</dd>
        </div>
      </dl>

      <section className="action-card" aria-labelledby="source-version-heading">
        <h2 id="source-version-heading">Version history</h2>
        {history.isPending ? <LoadingState message="Loading Version history…" /> : null}
        {history.error ? <ErrorState error={history.error} /> : null}
        {history.data ? (
          <ol className="source-version-list">
            {history.data.versions.map((version) => (
              <li key={version.sourceVersionId}>
                <button
                  type="button"
                  className={
                    version.sourceVersionId === selectedVersionId ? 'selected-version' : undefined
                  }
                  aria-pressed={version.sourceVersionId === selectedVersionId}
                  onClick={() => {
                    setSearchParameters({ version: version.sourceVersionId });
                  }}
                >
                  Version {version.versionNumber} · {version.mediaType} ·{' '}
                  {version.transformationState}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <section className="action-card" aria-labelledby="source-preview-heading">
        <h2 id="source-preview-heading">Original Preview</h2>
        {preview.isPending ? <LoadingState message="Loading Preview…" /> : null}
        {preview.error ? <ErrorState error={preview.error} /> : null}
        {preview.data ? (
          preview.data.text ? (
            <pre className="source-preview" tabIndex={0}>
              {preview.data.text}
            </pre>
          ) : (
            <p role="status">
              Original bytes are available, but inline Preview is not supported for{' '}
              {preview.data.mediaType}.
            </p>
          )
        ) : null}
      </section>

      <section className="action-card" aria-labelledby="source-evidence-heading">
        <h2 id="source-evidence-heading">Evidence</h2>
        {evidence.isPending ? <LoadingState message="Loading Evidence…" /> : null}
        {evidence.error ? <ErrorState error={evidence.error} /> : null}
        {evidence.data?.items.length === 0 ? <p>No Evidence is indexed yet.</p> : null}
        {evidence.data && evidence.data.items.length > 0 ? (
          <ul className="source-evidence-list">
            {evidence.data.items.map((item) => (
              <li key={item.evidenceId} id={`evidence-${item.evidenceId}`} tabIndex={-1}>
                <strong>{item.label}</strong>
                <p>{item.exactText}</p>
                <small>
                  {item.origin} · {item.evidenceId}
                </small>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
};
