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
import { useProductLocalization } from '../localization/product-localization.js';
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
  const { t } = useProductLocalization();
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

  if (detail.isPending) return <LoadingState message={t('source_detail.loading')} />;
  if (detail.error) return <ErrorState error={detail.error} />;
  if (!detail.data) return null;

  return (
    <section className="route-page source-detail-workspace">
      <p className="eyebrow">{t('source_detail.eyebrow')}</p>
      <h1 tabIndex={-1}>{detail.data.label}</h1>
      <p>
        <Link to="/sources">{t('source_detail.back')}</Link>
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
            {t('source_detail.return_citation')}
          </Link>
        </p>
      ) : null}
      {knowledgeReturnTarget ? (
        <p>
          <Link
            to={knowledgeReturnTarget.originRoute}
            state={knowledgeEvidenceReturnState(knowledgeReturnTarget)}
          >
            {t('source_detail.return_knowledge')}
          </Link>
        </p>
      ) : null}
      <dl className="identity-summary">
        <div>
          <dt>{t('source_detail.version')}</dt>
          <dd>
            {history.data?.versions.find((version) => version.sourceVersionId === selectedVersionId)
              ?.versionNumber ?? t('source_detail.selected')}
          </dd>
        </div>
      </dl>
      <section className="action-card" aria-labelledby="source-preview-heading">
        <h2 id="source-preview-heading">{t('source_detail.original_preview')}</h2>
        {preview.isPending ? <LoadingState message={t('source_detail.loading_preview')} /> : null}
        {preview.error ? <ErrorState error={preview.error} /> : null}
        {preview.data ? (
          preview.data.text ? (
            <pre className="source-preview" tabIndex={0}>
              {preview.data.text}
            </pre>
          ) : (
            <p role="status">
              {t('source_detail.preview_unsupported')} ({preview.data.mediaType})
            </p>
          )
        ) : null}
      </section>

      <section className="action-card" aria-labelledby="source-evidence-heading">
        <h2 id="source-evidence-heading">{t('source_detail.evidence')}</h2>
        {evidence.isPending ? <LoadingState message={t('source_detail.loading_evidence')} /> : null}
        {evidence.error ? <ErrorState error={evidence.error} /> : null}
        {evidence.data?.items.length === 0 ? <p>{t('source_detail.no_evidence')}</p> : null}
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

      <section className="action-card" aria-labelledby="source-version-heading">
        <h2 id="source-version-heading">{t('source_detail.version_history')}</h2>
        {history.isPending ? <LoadingState message={t('source_detail.loading_history')} /> : null}
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
                  {t('source_detail.version')} {version.versionNumber} ·{' '}
                  {mediaTypeLabel(version.mediaType)} ·{' '}
                  {transformationStateLabel(version.transformationState)}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      {detail.data.previewReadiness === 'READY' ? null : (
        <p role="status">
          {t('source_detail.preview')}: {sourcePreviewLabel(detail.data.previewReadiness)}
        </p>
      )}
      {detail.data.askUsageState === 'SOURCE_VERSION_READY' ||
      detail.data.askUsageState === 'EVIDENCE_READY' ? null : (
        <p role="status">
          {t('source_detail.questions')}: {sourceAskUsageLabel(detail.data.askUsageState)}.{' '}
          {detail.data.askUsageExplanation}
        </p>
      )}
      <TechnicalDetails
        items={[
          { label: 'Source ID', value: detail.data.sourceId },
          { label: 'SourceVersion ID', value: selectedVersionId },
        ]}
      />
    </section>
  );
};
