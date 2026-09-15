import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';

import {
  decodeCitationReturnTarget,
  decodeConversationCitationReturnTarget,
  ShotgunApiError,
  type CitationReturnTarget,
  type ConversationCitationReturnTarget,
  type EvidenceListView,
  type GlobalShellView,
  type RecompareCandidateResponse,
  type SemanticComparisonStatusView,
  type SourceCandidateView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { convergeOwnerState } from '../app/query-keys.js';
import { ErrorState, safeErrorMessage } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { hfmOwnerLabel, useProductLocalization } from '../localization/product-localization.js';
import { useOwnerCommandController } from '../section3/global-tools.js';
import {
  sourceDetailQueryOptions,
  sourceCandidatesQueryOptions,
  sourceEvidenceQueryOptions,
  sourcePreviewQueryOptions,
  sourceVersionHistoryQueryOptions,
} from '../sources/sources-queries.js';
import {
  decodeKnowledgeEvidenceReturnState,
  knowledgeEvidenceReturnState,
} from '../knowledge/knowledge-ui.js';
import {
  clearPendingSourceReextractCommandIdentity,
  getSourceReextractCommandStorage,
  readPendingSourceReextractCommandIdentity,
  writePendingSourceReextractCommandIdentity,
  type PendingSourceReextractCommandIdentityV1,
} from './source-reextract-command-storage.js';
import {
  clearPendingSourceRecompareCommandIdentity,
  getSourceRecompareCommandStorage,
  newSourceRecompareIdentity,
  readPendingSourceRecompareCommandIdentity,
  writePendingSourceRecompareCommandIdentity,
  type PendingSourceRecompareCommandIdentityV1,
} from './source-recompare-command-storage.js';

type SourceDetailViewName = 'preview' | 'evidence' | 'versions';

type SourceReextractRequest = PendingSourceReextractCommandIdentityV1;

const isOutcomeIndeterminateError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly recovery?: unknown };
  return (
    candidate.code === 'OUTCOME_INDETERMINATE' ||
    candidate.code === 'OUTCOME_UNKNOWN' ||
    candidate.recovery === 'RESOLVE_EXISTING_OUTCOME'
  );
};

const newSourceReextractIdentity = (
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
): SourceReextractRequest => ({
  schemaVersion: '1.0.0',
  projectId,
  sourceId,
  sourceVersionId,
  clientRequestId: globalThis.crypto.randomUUID(),
  idempotencyKey: globalThis.crypto.randomUUID(),
});

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

type CandidateComparisonFeedback = {
  readonly kind: 'success' | 'error' | 'info';
  readonly message: string;
};

const recompareSucceeded = (response: RecompareCandidateResponse): boolean => {
  const result = response.result;
  const v2 = result.v2;
  return (
    result.rollout === 'V2_ACTIVE' &&
    result.v1Executed === false &&
    v2?.status === 'COMPLETED' &&
    result.review?.status === 'DRAFT_CREATED' &&
    Boolean(
      response.reviewChangeSetId ??
      result.comparisonId ??
      (v2 && 'comparisonId' in v2 ? v2.comparisonId : undefined),
    )
  );
};

const semanticCredentialNeedsAttention = (response: RecompareCandidateResponse): boolean => {
  const detail = response.result.v2?.status === 'BLOCKED' ? response.result.v2.detail : undefined;
  return (
    typeof detail === 'string' &&
    detail.includes('CREDENTIAL_UNAVAILABLE') &&
    detail.includes('CONFIGURATION_REQUIRED')
  );
};

const recompareOutcomeMessage = (
  response: RecompareCandidateResponse,
  t: ReturnType<typeof useProductLocalization>['t'],
): string => {
  const result = response.result;
  if (result.rollout !== 'V2_ACTIVE') return t('source_detail.semantic_candidates_not_ready');
  if (result.v2?.status === 'BLOCKED') {
    return semanticCredentialNeedsAttention(response)
      ? t('source_detail.semantic_candidate_credential_recovery')
      : t('source_detail.semantic_candidate_blocked');
  }
  if (result.v2?.status === 'INCOMPLETE' || result.v2?.status === 'FAILED') {
    return t('source_detail.semantic_candidate_incomplete');
  }
  if (result.review?.status !== 'DRAFT_CREATED') {
    return t('source_detail.semantic_candidate_review_not_ready');
  }
  return t('source_detail.semantic_candidate_failed');
};

const SourceCandidateComparison = ({
  candidate,
  projectId,
  sourceId,
  sourceVersionId,
  sourceVersionReady,
  semanticStatus,
}: {
  readonly candidate: SourceCandidateView;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceVersionReady: boolean;
  readonly semanticStatus: SemanticComparisonStatusView | undefined;
}) => {
  const { apiClient, queryClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const commandController = useOwnerCommandController();
  const semanticEnableCommand = commandController?.commands.find(
    (command) => command.id === 'semantic.enable',
  );
  const [pendingIdentity, setPendingIdentity] = useState<
    PendingSourceRecompareCommandIdentityV1 | undefined
  >();
  const [feedback, setFeedback] = useState<CandidateComparisonFeedback>();
  const [reviewReady, setReviewReady] = useState(false);
  const [semanticRecoveryRequired, setSemanticRecoveryRequired] = useState(false);

  useEffect(() => {
    const storage = getSourceRecompareCommandStorage();
    const identity = storage
      ? readPendingSourceRecompareCommandIdentity(
          storage,
          projectId,
          sourceId,
          sourceVersionId,
          candidate.candidateId,
        )
      : null;
    setPendingIdentity(identity ?? undefined);
    setFeedback(undefined);
    setReviewReady(false);
    setSemanticRecoveryRequired(false);
  }, [candidate.candidateId, projectId, sourceId, sourceVersionId]);

  const mutation = useMutation({
    mutationFn: (identity: PendingSourceRecompareCommandIdentityV1) =>
      apiClient.recompareCandidate({
        candidateId: identity.candidateId,
        idempotencyKey: identity.idempotencyKey,
      }),
    onSuccess: async (response, identity) => {
      const storage = getSourceRecompareCommandStorage();
      if (storage) {
        clearPendingSourceRecompareCommandIdentity(
          storage,
          identity.projectId,
          identity.sourceId,
          identity.sourceVersionId,
          identity.candidateId,
        );
      }
      setPendingIdentity(undefined);
      if (recompareSucceeded(response)) {
        setSemanticRecoveryRequired(false);
        await convergeOwnerState(queryClient, projectId);
        setReviewReady(true);
        setFeedback({ kind: 'success', message: t('source_detail.semantic_candidate_success') });
      } else {
        setSemanticRecoveryRequired(semanticCredentialNeedsAttention(response));
        setFeedback({ kind: 'info', message: recompareOutcomeMessage(response, t) });
      }
    },
    onError: (error, identity) => {
      if (isOutcomeIndeterminateError(error)) {
        const storage = getSourceRecompareCommandStorage();
        if (storage) writePendingSourceRecompareCommandIdentity(storage, identity);
        setPendingIdentity(identity);
        setFeedback({
          kind: 'error',
          message: t('source_detail.semantic_candidate_outcome_indeterminate'),
        });
        return;
      }
      const storage = getSourceRecompareCommandStorage();
      if (storage) {
        clearPendingSourceRecompareCommandIdentity(
          storage,
          identity.projectId,
          identity.sourceId,
          identity.sourceVersionId,
          identity.candidateId,
        );
      }
      setPendingIdentity(undefined);
      setSemanticRecoveryRequired(false);
      setFeedback({
        kind: 'error',
        message: `${t('source_detail.semantic_candidate_failed')} ${safeErrorMessage(error)}`,
      });
    },
  });

  const eligible =
    candidate.status === 'READY' &&
    sourceVersionReady &&
    semanticStatus?.status === 'READY' &&
    semanticStatus.rollout === 'V2_ACTIVE';

  const handleCompare = () => {
    if (!eligible || mutation.isPending) return;
    const storage = getSourceRecompareCommandStorage();
    const persisted = storage
      ? readPendingSourceRecompareCommandIdentity(
          storage,
          projectId,
          sourceId,
          sourceVersionId,
          candidate.candidateId,
        )
      : null;
    const identity =
      pendingIdentity ??
      persisted ??
      newSourceRecompareIdentity(projectId, sourceId, sourceVersionId, candidate.candidateId);
    if (storage) writePendingSourceRecompareCommandIdentity(storage, identity);
    setPendingIdentity(identity);
    setFeedback(undefined);
    setReviewReady(false);
    setSemanticRecoveryRequired(false);
    mutation.mutate(identity);
  };

  return (
    <li data-candidate-id={candidate.candidateId}>
      <p>{candidate.claimText}</p>
      <small>
        {t('source_detail.semantic_candidate_noncanonical')} ·{' '}
        {t('source_detail.semantic_candidate_status')}: {candidate.status}
      </small>
      {eligible ? (
        <button type="button" onClick={handleCompare} disabled={mutation.isPending}>
          {mutation.isPending
            ? t('source_detail.semantic_candidate_compare_pending')
            : pendingIdentity
              ? t('source_detail.semantic_candidate_compare_resolve')
              : t('source_detail.semantic_candidate_compare')}
        </button>
      ) : candidate.status === 'READY' && semanticStatus?.rollout !== 'V2_ACTIVE' ? (
        <p role="status">
          {t('source_detail.semantic_candidates_not_ready')}{' '}
          <Link to="/settings/ai">{t('source_detail.semantic_candidates_configure')}</Link>
        </p>
      ) : null}
      {feedback ? (
        <p role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>
      ) : null}
      {semanticRecoveryRequired ? (
        semanticEnableCommand && commandController ? (
          <button
            type="button"
            onClick={(event) =>
              commandController.executeCommand(semanticEnableCommand, event.currentTarget)
            }
          >
            {t('source_detail.semantic_candidate_open_settings')}
          </button>
        ) : (
          <Link to="/settings/ai">{t('source_detail.semantic_candidate_open_settings')}</Link>
        )
      ) : null}
      {reviewReady ? (
        <Link to="/review">{t('source_detail.semantic_candidate_open_review')}</Link>
      ) : null}
    </li>
  );
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
  const activeProjectId = shell.activeProject?.id;
  const candidateReadAvailable = typeof apiClient.getSourceCandidates === 'function';
  const candidatesOptions = sourceCandidatesQueryOptions(
    apiClient,
    shell,
    sourceId,
    selectedVersionId,
  );
  const candidates = useQuery({
    ...candidatesOptions,
    enabled: candidateReadAvailable && candidatesOptions.enabled,
  });
  const semanticReadAvailable = typeof apiClient.getSemanticComparisonStatus === 'function';
  const semanticStatus = useQuery({
    queryKey: ['settings', 'ai', 'semantic-comparison', activeProjectId ?? 'no-project'],
    queryFn: ({ signal }) => apiClient.getSemanticComparisonStatus(activeProjectId!, { signal }),
    enabled: Boolean(activeProjectId) && semanticReadAvailable,
    retry: false,
    staleTime: 15_000,
  });
  const [pendingReextractIdentity, setPendingReextractIdentity] = useState<
    SourceReextractRequest | undefined
  >();
  const pendingReextractIdentityRef = useRef<SourceReextractRequest | undefined>(undefined);
  const reextractTarget = useMemo(
    () =>
      activeProjectId && sourceId && selectedVersionId
        ? { projectId: activeProjectId, sourceId, sourceVersionId: selectedVersionId }
        : undefined,
    [activeProjectId, selectedVersionId, sourceId],
  );
  useEffect(() => {
    const storage = getSourceReextractCommandStorage();
    const identity =
      storage && reextractTarget
        ? readPendingSourceReextractCommandIdentity(
            storage,
            reextractTarget.projectId,
            reextractTarget.sourceId,
            reextractTarget.sourceVersionId,
          )
        : null;
    pendingReextractIdentityRef.current = identity ?? undefined;
    setPendingReextractIdentity(identity ?? undefined);
  }, [reextractTarget]);
  const [reextractFeedback, setReextractFeedback] = useState<
    { readonly kind: 'success' | 'error'; readonly message: string } | undefined
  >();
  const reextractMutation = useMutation({
    mutationFn: (request: SourceReextractRequest) => {
      if (!activeProjectId) throw new Error('An active Project is required.');
      return apiClient.reextractSourceVersionCandidates({
        activeProjectId,
        targetProjectId: activeProjectId,
        resourceProjectId: activeProjectId,
        sourceId: request.sourceId,
        sourceVersionId: request.sourceVersionId,
        clientRequestId: request.clientRequestId,
        idempotencyKey: request.idempotencyKey,
      });
    },
    onSuccess: async (_response, request) => {
      const storage = getSourceReextractCommandStorage();
      if (storage) {
        clearPendingSourceReextractCommandIdentity(
          storage,
          request.projectId,
          request.sourceId,
          request.sourceVersionId,
        );
      }
      if (
        reextractTarget?.projectId === request.projectId &&
        reextractTarget.sourceId === request.sourceId &&
        reextractTarget.sourceVersionId === request.sourceVersionId
      ) {
        pendingReextractIdentityRef.current = undefined;
        setPendingReextractIdentity(undefined);
      }
      setReextractFeedback({
        kind: 'success',
        message: t('source_detail.reprocess_ai_success'),
      });
      await Promise.all([history.refetch(), evidence.refetch()]);
    },
    onError: (error, request) => {
      if (isOutcomeIndeterminateError(error)) {
        setReextractFeedback({
          kind: 'error',
          message: t('source_detail.reprocess_ai_outcome_indeterminate'),
        });
        return;
      }
      const storage = getSourceReextractCommandStorage();
      if (storage) {
        clearPendingSourceReextractCommandIdentity(
          storage,
          request.projectId,
          request.sourceId,
          request.sourceVersionId,
        );
      }
      if (
        reextractTarget?.projectId === request.projectId &&
        reextractTarget.sourceId === request.sourceId &&
        reextractTarget.sourceVersionId === request.sourceVersionId
      ) {
        pendingReextractIdentityRef.current = undefined;
        setPendingReextractIdentity(undefined);
      }
      setReextractFeedback({
        kind: 'error',
        message: `${t('source_detail.reprocess_ai_failed')} ${safeErrorMessage(error)}`,
      });
    },
  });
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
  const reextractEligible =
    selectedVersionState !== undefined &&
    selectedVersionState !== 'RUNNING' &&
    selectedVersionState !== 'RETRYING' &&
    evidence.data !== undefined &&
    evidence.data.items.length > 0;
  const reextractNeedsConfiguration =
    reextractMutation.error instanceof ShotgunApiError &&
    reextractMutation.error.code === 'CONFIGURATION_REQUIRED';
  const pendingReextractForTarget =
    pendingReextractIdentity &&
    reextractTarget &&
    pendingReextractIdentity.projectId === reextractTarget.projectId &&
    pendingReextractIdentity.sourceId === reextractTarget.sourceId &&
    pendingReextractIdentity.sourceVersionId === reextractTarget.sourceVersionId
      ? pendingReextractIdentity
      : undefined;
  const handleReextract = () => {
    if (!reextractTarget || reextractMutation.isPending) return;
    const storage = getSourceReextractCommandStorage();
    const persisted = storage
      ? readPendingSourceReextractCommandIdentity(
          storage,
          reextractTarget.projectId,
          reextractTarget.sourceId,
          reextractTarget.sourceVersionId,
        )
      : null;
    const current = pendingReextractIdentityRef.current;
    const request =
      current?.projectId === reextractTarget.projectId &&
      current.sourceId === reextractTarget.sourceId &&
      current.sourceVersionId === reextractTarget.sourceVersionId
        ? current
        : (persisted ??
          newSourceReextractIdentity(
            reextractTarget.projectId,
            reextractTarget.sourceId,
            reextractTarget.sourceVersionId,
          ));
    if (storage) writePendingSourceReextractCommandIdentity(storage, request);
    pendingReextractIdentityRef.current = request;
    setPendingReextractIdentity(request);
    setReextractFeedback(undefined);
    reextractMutation.mutate(request);
  };

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
      {reextractEligible ? (
        <section
          className="action-card source-detail-ai-action"
          aria-labelledby="source-ai-heading"
        >
          <h2 id="source-ai-heading">{t('source_detail.reprocess_ai_heading')}</h2>
          <p>{t('source_detail.reprocess_ai_explanation')}</p>
          <button type="button" onClick={handleReextract} disabled={reextractMutation.isPending}>
            {reextractMutation.isPending
              ? t('source_detail.reprocess_ai_pending')
              : pendingReextractForTarget
                ? t('source_detail.reprocess_ai_resolve')
                : t('source_detail.reprocess_ai')}
          </button>
          {reextractFeedback ? (
            <p role={reextractFeedback.kind === 'error' ? 'alert' : 'status'}>
              {reextractFeedback.message}
            </p>
          ) : null}
          {reextractNeedsConfiguration ? (
            <Link to="/settings/ai">{t('source_detail.reprocess_ai_configure')}</Link>
          ) : null}
        </section>
      ) : reextractFeedback ? (
        <p role={reextractFeedback.kind === 'error' ? 'alert' : 'status'}>
          {reextractFeedback.message}
        </p>
      ) : null}
      {candidateReadAvailable ? (
        <section
          className="action-card source-detail-candidates"
          aria-labelledby="source-candidates-heading"
        >
          <h2 id="source-candidates-heading">{t('source_detail.semantic_candidates_heading')}</h2>
          <p>{t('source_detail.semantic_candidates_explanation')}</p>
          {candidates.isPending ? (
            <LoadingState message={t('source_detail.semantic_candidates_loading')} />
          ) : null}
          {candidates.error ? <p role="alert">{safeErrorMessage(candidates.error)}</p> : null}
          {semanticStatus.isPending ? <p>{t('common.loading')}</p> : null}
          {semanticStatus.error ? (
            <p role="alert">{t('source_detail.semantic_candidates_not_ready')}</p>
          ) : null}
          {candidates.data?.items.length === 0 ? (
            <p>{t('source_detail.semantic_candidates_empty')}</p>
          ) : null}
          {candidates.data && candidates.data.items.length > 0 ? (
            <ul className="source-candidate-list">
              {candidates.data.items.map((candidate) => (
                <SourceCandidateComparison
                  key={`${candidate.candidateId}:${candidate.revisionNumber}`}
                  candidate={candidate}
                  projectId={candidates.data!.projectId}
                  sourceId={candidates.data!.sourceId}
                  sourceVersionId={candidates.data!.sourceVersionId}
                  sourceVersionReady={selectedVersionState === 'READY'}
                  semanticStatus={semanticStatus.data}
                />
              ))}
            </ul>
          ) : null}
        </section>
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
                    className={isCitationTarget ? 'cited-evidence' : undefined}
                    data-citation-target={isCitationTarget ? 'true' : undefined}
                    aria-current={isCitationTarget ? 'true' : undefined}
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
