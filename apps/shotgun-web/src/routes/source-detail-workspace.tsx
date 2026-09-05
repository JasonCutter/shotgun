import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';

import {
  decodeCitationReturnTarget,
  decodeConversationCitationReturnTarget,
  type CitationReturnTarget,
  type ConversationCitationReturnTarget,
  type EvidenceListView,
  type GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { hfmOwnerLabel, useProductLocalization } from '../localization/product-localization.js';
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

type SourceDetailViewName = 'preview' | 'evidence' | 'versions';

const isSourceDetailViewName = (value: string | null): value is SourceDetailViewName =>
  value === 'preview' || value === 'evidence' || value === 'versions';

type EvidenceItem = EvidenceListView['items'][number];

const findTextPosition = (
  locators: EvidenceItem['locators'],
): { start: number; end: number } | undefined => {
  for (const locator of locators) {
    if (
      typeof locator === 'object' &&
      locator !== null &&
      'type' in locator &&
      locator.type === 'TextPositionSelector' &&
      'start' in locator &&
      typeof locator.start === 'number' &&
      'end' in locator &&
      typeof locator.end === 'number'
    ) {
      return { start: locator.start, end: locator.end };
    }
  }
  return undefined;
};

export const isDerivedLabel = (item: EvidenceItem): boolean => {
  if (item.exactText === undefined) return false;
  const derivedPrefix = item.exactText.slice(0, 120);
  return item.label === derivedPrefix || item.label === item.exactText;
};

export type GroupedEvidenceCard = {
  readonly primaryItem: EvidenceItem;
  readonly memberEvidenceIds: readonly string[];
};

export const groupEvidenceCards = (
  items: readonly EvidenceItem[],
): readonly GroupedEvidenceCard[] => {
  const groups: {
    primaryItem: EvidenceItem;
    memberEvidenceIds: string[];
  }[] = [];
  const groupMap = new Map<string, (typeof groups)[number]>();

  for (const item of items) {
    const position = findTextPosition(item.locators);
    if (!position || item.exactText === undefined) {
      groups.push({
        primaryItem: item,
        memberEvidenceIds: [item.evidenceId],
      });
      continue;
    }

    const distinctLabel = isDerivedLabel(item) ? null : item.label;
    const key = JSON.stringify([
      position.start,
      position.end,
      item.origin,
      distinctLabel,
      item.exactText,
    ]);
    const existing = groupMap.get(key);
    if (existing) {
      if (!existing.memberEvidenceIds.includes(item.evidenceId)) {
        existing.memberEvidenceIds.push(item.evidenceId);
      }
    } else {
      const newGroup = {
        primaryItem: item,
        memberEvidenceIds: [item.evidenceId],
      };
      groupMap.set(key, newGroup);
      groups.push(newGroup);
    }
  }

  return groups;
};

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
  const selectedVersionState = history.data?.versions.find(
    (version) => version.sourceVersionId === selectedVersionId,
  )?.transformationState;
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
  const requestedDetailView = searchParameters.get('view');
  const selectedDetailView: SourceDetailViewName = isSourceDetailViewName(requestedDetailView)
    ? requestedDetailView
    : citationReturnTarget || knowledgeReturnTarget
      ? 'evidence'
      : 'preview';
  const selectDetailView = (view: SourceDetailViewName) => {
    const next = new URLSearchParams(searchParameters);
    next.set('view', view);
    setSearchParameters(next, { state: location.state });
  };

  const focusCitationEvidence = useCallback((node: HTMLLIElement | null) => {
    if (!node) return;
    node.scrollIntoView?.({ block: 'center' });
    node.focus();
  }, []);

  const groupedEvidence = useMemo(
    () => (evidence.data ? groupEvidenceCards(evidence.data.items) : []),
    [evidence.data],
  );

  if (detail.isPending) return <LoadingState message={t('source_detail.loading')} />;
  if (detail.error) return <ErrorState error={detail.error} />;
  if (!detail.data) return null;

  return (
    <section className="route-page hfm-route-page source-detail-workspace">
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
      <nav className="source-detail-navigation" aria-label={t('source_detail.views')}>
        {(['preview', 'evidence', 'versions'] as const).map((view) => (
          <button
            key={view}
            className="hfm-action-selection"
            type="button"
            aria-current={selectedDetailView === view ? 'page' : undefined}
            aria-pressed={selectedDetailView === view}
            onClick={() => selectDetailView(view)}
          >
            {view === 'preview'
              ? t('source_detail.original_preview')
              : view === 'evidence'
                ? t('source_detail.evidence')
                : t('source_detail.version_history')}
          </button>
        ))}
      </nav>
      {selectedDetailView === 'preview' ? (
        <section
          className="action-card source-detail-preview"
          aria-labelledby="source-preview-heading"
        >
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
      ) : null}

      {selectedDetailView === 'evidence' ? (
        <section
          className="action-card source-detail-evidence"
          aria-labelledby="source-evidence-heading"
        >
          <h2 id="source-evidence-heading">{t('source_detail.evidence')}</h2>
          {evidence.isPending ? (
            <LoadingState message={t('source_detail.loading_evidence')} />
          ) : null}
          {evidence.error ? <ErrorState error={evidence.error} /> : null}
          {evidence.data?.items.length === 0 ? (
            <p>
              {selectedVersionState === 'RUNNING' || selectedVersionState === 'NOT_STARTED'
                ? t('source_detail.processing')
                : selectedVersionState === 'RETRYING'
                  ? t('source_detail.retry_wait')
                  : selectedVersionState === 'BLOCKED'
                    ? t('source_detail.blocked')
                    : t('source_detail.no_evidence')}
            </p>
          ) : null}
          {evidence.data && groupedEvidence.length > 0 ? (
            <ul className="source-evidence-list">
              {groupedEvidence.map((group) => {
                const item = group.primaryItem;
                const isCitationTarget = group.memberEvidenceIds.some(
                  (id) =>
                    id === citationReturnTarget?.evidenceId ||
                    id === knowledgeReturnTarget?.target.evidenceId,
                );
                const targetMemberId =
                  group.memberEvidenceIds.find(
                    (id) =>
                      id === citationReturnTarget?.evidenceId ||
                      id === knowledgeReturnTarget?.target.evidenceId,
                  ) ?? item.evidenceId;

                const showDistinctLabel = !isDerivedLabel(item);

                return (
                  <li
                    key={item.evidenceId}
                    id={`evidence-${targetMemberId}`}
                    tabIndex={-1}
                    ref={isCitationTarget ? focusCitationEvidence : undefined}
                  >
                    {showDistinctLabel ? <strong>{item.label}</strong> : null}
                    {item.exactText !== undefined ? (
                      <p>{item.exactText}</p>
                    ) : (
                      <strong>{item.label}</strong>
                    )}
                    <small>{hfmOwnerLabel(t, 'evidenceOrigin', item.origin)}</small>
                    <TechnicalDetails
                      items={[
                        { label: t('source_detail.evidence_id'), value: item.evidenceId },
                        { label: t('source_detail.evidence_revision'), value: item.revisionId },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {selectedDetailView === 'versions' ? (
        <section
          className="action-card source-detail-versions"
          aria-labelledby="source-version-heading"
        >
          <h2 id="source-version-heading">{t('source_detail.version_history')}</h2>
          {history.isPending ? <LoadingState message={t('source_detail.loading_history')} /> : null}
          {history.error ? <ErrorState error={history.error} /> : null}
          {history.data ? (
            <ol className="source-version-list">
              {history.data.versions.map((version) => (
                <li key={version.sourceVersionId}>
                  <button
                    type="button"
                    className={`hfm-action-selection${
                      version.sourceVersionId === selectedVersionId ? ' selected-version' : ''
                    }`}
                    aria-pressed={version.sourceVersionId === selectedVersionId}
                    onClick={() => {
                      setSearchParameters(
                        { version: version.sourceVersionId, view: 'versions' },
                        { state: location.state },
                      );
                    }}
                  >
                    {t('source_detail.version')} {version.versionNumber} ·{' '}
                    {hfmOwnerLabel(t, 'mediaType', version.mediaType)} ·{' '}
                    {hfmOwnerLabel(t, 'transformationState', version.transformationState)}
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
      {detail.data.previewReadiness === 'READY' ? null : (
        <p className="source-detail-readiness" role="status">
          {t('source_detail.preview')}:{' '}
          {hfmOwnerLabel(t, 'sourcePreview', detail.data.previewReadiness)}
        </p>
      )}
      {detail.data.askUsageState === 'SOURCE_VERSION_READY' ||
      detail.data.askUsageState === 'EVIDENCE_READY' ? null : (
        <p className="source-detail-readiness" role="status">
          {t('source_detail.questions')}:{' '}
          {hfmOwnerLabel(t, 'sourceAskUsage', detail.data.askUsageState)}.{' '}
          {detail.data.askUsageExplanation}
        </p>
      )}
      <TechnicalDetails
        items={[
          { label: t('source_detail.source_id'), value: detail.data.sourceId },
          { label: t('source_detail.source_version_id'), value: selectedVersionId },
        ]}
      />
    </section>
  );
};
