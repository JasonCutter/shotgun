import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';

import {
  decodeCitationReturnTarget,
  decodeConversationCitationReturnTarget,
  type CitationReturnTarget,
  type ConversationCitationReturnTarget,
  type GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import {
  evidenceOriginLabel,
  mediaTypeLabel,
  sourceAskUsageLabel,
  sourcePreviewLabel,
  transformationStateLabel,
} from '../presentation/product-labels.js';
import {
  sourceDetailQueryOptions,
  sourceEvidenceQueryOptions,
  sourcePreviewQueryOptions,
  sourceVersionHistoryQueryOptions,
} from '../sources/sources-queries.js';
import {
  decodeKnowledgeEvidenceReturnState,
  knowledgeEvidenceReturnState,
} from '../knowledge/knowledge-ui.js';

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
  const conversationReturnTarget = useMemo<ConversationCitationReturnTarget | undefined>(() => {
    if (!citationReturnTarget || citationReturnTarget.resourceKind !== 'conversation') {
      return undefined;
    }
    try {
      return decodeConversationCitationReturnTarget(citationReturnTarget);
    } catch {
      return undefined;
    }
  }, [citationReturnTarget]);
  const knowledgeReturnTarget = useMemo(
    () => decodeKnowledgeEvidenceReturnState(location.state, sourceId, selectedVersionId),
    [location.state, selectedVersionId, sourceId],
  );

  const focusCitationEvidence = useCallback((node: HTMLLIElement | null) => {
    if (!node) return;
    node.scrollIntoView?.({ block: 'center' });
    node.focus();
  }, []);

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
      {conversationReturnTarget ? (
        <p>
          <Link
            to={conversationReturnTarget.originRoute}
            state={{
              citationReturn: {
                schemaVersion: conversationReturnTarget.schemaVersion,
                resourceKind: conversationReturnTarget.resourceKind,
                resourceId: conversationReturnTarget.resourceId,
                conversationId: conversationReturnTarget.conversationId,
                branchId: conversationReturnTarget.branchId,
                turnId: conversationReturnTarget.turnId,
                answerRunId: conversationReturnTarget.answerRunId,
                answerRevision: conversationReturnTarget.answerRevision,
                resourceRevision: conversationReturnTarget.resourceRevision,
                citationId: conversationReturnTarget.citationId,
                scrollAnchor: conversationReturnTarget.scrollAnchor,
                focusTarget: conversationReturnTarget.focusTarget,
                panelId: conversationReturnTarget.panelId,
              },
            }}
          >
            Return to cited resource
          </Link>
        </p>
      ) : null}
      {knowledgeReturnTarget ? (
        <p>
          <Link
            to={knowledgeReturnTarget.originRoute}
            state={knowledgeEvidenceReturnState(knowledgeReturnTarget)}
          >
            Return to Knowledge resource
          </Link>
        </p>
      ) : null}
      <dl className="identity-summary">
        <div>
          <dt>Version</dt>
          <dd>
            {history.data?.versions.find((version) => version.sourceVersionId === selectedVersionId)
              ?.versionNumber ?? 'Selected'}
          </dd>
        </div>
        <div>
          <dt>Preview</dt>
          <dd>{sourcePreviewLabel(detail.data.previewReadiness)}</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{sourceAskUsageLabel(detail.data.askUsageState)}</dd>
        </div>
      </dl>
      <TechnicalDetails
        items={[
          { label: 'Source ID', value: detail.data.sourceId },
          { label: 'SourceVersion ID', value: selectedVersionId },
        ]}
      />

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
                  Version {version.versionNumber} · {mediaTypeLabel(version.mediaType)} ·{' '}
                  {transformationStateLabel(version.transformationState)}
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
            {evidence.data.items.map((item) => {
              const isCitationTarget =
                item.evidenceId === citationReturnTarget?.evidenceId ||
                item.evidenceId === knowledgeReturnTarget?.target.evidenceId;
              return (
                <li
                  key={item.evidenceId}
                  id={`evidence-${item.evidenceId}`}
                  tabIndex={-1}
                  ref={isCitationTarget ? focusCitationEvidence : undefined}
                >
                  <strong>{item.label}</strong>
                  <p>{item.exactText}</p>
                  <small>{evidenceOriginLabel(item.origin)}</small>
                  <TechnicalDetails
                    items={[
                      { label: 'Evidence ID', value: item.evidenceId },
                      { label: 'Evidence revision', value: item.revisionId },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </section>
  );
};
