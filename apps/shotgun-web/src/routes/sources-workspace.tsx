import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useOutletContext, useSearchParams } from 'react-router';

import {
  createSourcesWriteClient,
  type ExactDuplicateDecisionView,
  type GlobalShellView,
  type IntakeSubmissionSnapshot,
  type SourceLibraryPageView,
  type SourceLibraryQuery,
  type SourcesSensitivity,
  type StagedSourcesIntakeInput,
  type KnowledgeResetPreviewV1,
  type KnowledgeResetBlockerCodeV1,
} from '@shotgun/api-client';

import { purgeProjectScopedKnowledgeQueries } from '../app/query-keys.js';
import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import {
  hfmOwnerLabel,
  type ProductTranslator,
  useProductLocalization,
} from '../localization/product-localization.js';
import {
  sourceIntakeSubmissionQueryOptions,
  sourcesLibraryQueryOptions,
} from '../sources/sources-queries.js';
import {
  type SourceIntakeDraftMessageCode,
  useSourceIntakeDraftQueue,
} from '../sources/source-intake-drafts.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';

const DEFAULT_QUERY: SourceLibraryQuery = {
  schemaVersion: '1.0.0',
  filters: {},
  sort: 'UPDATED_DESC',
  limit: 50,
};

const identity = (prefix: string): string =>
  `${prefix}-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`;

const resetRequestStorageKey = (projectId: string): string =>
  `shotgun:source-knowledge-reset:${projectId}`;

const readResetRequestId = (projectId: string): string | undefined => {
  if (!projectId || typeof globalThis.sessionStorage === 'undefined') return undefined;
  try {
    return globalThis.sessionStorage.getItem(resetRequestStorageKey(projectId)) ?? undefined;
  } catch {
    return undefined;
  }
};

type SourceLibraryItem = SourceLibraryPageView['items'][number];

const sourceReadinessMessage = (
  t: ProductTranslator,
  source: SourceLibraryItem,
): string | undefined => {
  if (source.lifecycle === 'FAILED' || source.askUsageState === 'FAILED') {
    return t('sources.unavailable');
  }
  if (source.lifecycle === 'ACTION_REQUIRED' || source.askUsageState === 'ACTION_REQUIRED') {
    return t('sources.needs_attention');
  }
  if (source.askUsageState === 'ACCESS_RESTRICTED') {
    return t('sources.question_access_restricted');
  }
  if (source.askUsageState === 'NOT_READY') {
    return t('sources.questions_not_ready');
  }
  if (
    source.previewReadiness === 'FAILED' ||
    source.previewReadiness === 'ACCESS_RESTRICTED' ||
    (source.previewReadiness === 'NOT_READY' && !source.capabilities.includes('PREVIEW'))
  ) {
    return t('sources.preview_unavailable');
  }
  return undefined;
};

const sourceDraftMessage = (t: ProductTranslator, code: SourceIntakeDraftMessageCode): string => {
  switch (code) {
    case 'SEEDED_TEXT_REVIEW':
      return t('sources.draft_message.seeded_text_review');
    case 'SEEDED_TEXT_TOO_LARGE':
      return t('sources.draft_message.seeded_text_too_large');
    case 'SEEDED_URL_VALIDATION':
      return t('sources.draft_message.seeded_url_validation');
    case 'SEED_FILE_RESELECT':
      return t('sources.draft_message.seed_file_reselect');
    case 'DIRECT_TEXT_EMPTY':
      return t('sources.draft_message.direct_text_empty');
    case 'DIRECT_TEXT_TOO_LARGE':
      return t('sources.draft_message.direct_text_too_large');
    case 'CLIENT_PREFLIGHT':
      return t('sources.draft_message.client_preflight');
    case 'FILE_UNSUPPORTED':
      return t('sources.draft_message.file_unsupported');
    case 'FILE_SIZE_INVALID':
      return t('sources.draft_message.file_size');
    case 'FILE_PREFLIGHT':
      return t('sources.draft_message.file_preflight');
    case 'URL_ACCEPTED':
      return t('sources.draft_message.url_accepted');
    case 'URL_INVALID':
      return t('sources.draft_message.url_invalid');
  }
};

const resetBlockerMessage = (t: ProductTranslator, code: KnowledgeResetBlockerCodeV1): string => {
  switch (code) {
    case 'UNCLASSIFIED_CONTENT':
      return t('sources.reset_blocker_unclassified');
    case 'STALE_PREVIEW':
      return t('sources.reset_blocker_stale');
    case 'ACTIVE_JOB_OUTCOME_UNKNOWN':
      return t('sources.reset_blocker_job');
    case 'EXTERNAL_ACTION_DEPENDENCY':
      return t('sources.reset_blocker_external_action');
    case 'RESET_IN_PROGRESS':
      return t('sources.reset_blocker_in_progress');
    case 'ERASURE_EXECUTOR_UNAVAILABLE':
      return t('sources.reset_blocker_executor');
    case 'KNOWLEDGE_RESET_JOURNAL_UNAVAILABLE':
      return t('sources.reset_blocker_journal');
  }
};

type DraftCommandIdentity = {
  readonly fingerprint: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly draftId: string;
};

export const SourcesWorkspace = () => {
  const { apiClient, queryClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const location = useLocation();
  const [searchParameters] = useSearchParams();
  const connectivity = useConnectivityState();
  const { t } = useProductLocalization();
  const writeClient = useMemo(() => createSourcesWriteClient(), []);
  const projectId = shell.activeProject?.id ?? '';
  const isActiveProjectOwner = shell.accessibleProjects.some(
    (project) => project.id === projectId && project.isOwner,
  );
  const commandIdentity = useRef<DraftCommandIdentity | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [intakeKind, setIntakeKind] = useState<'DIRECT_TEXT' | 'FILE' | 'URL'>('DIRECT_TEXT');
  const [intakeLabel, setIntakeLabel] = useState('');
  const requestedClassification: SourcesSensitivity = 'private';
  const [directText, setDirectText] = useState('');
  const [requestedUrl, setRequestedUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File>();
  const [submission, setSubmission] = useState<IntakeSubmissionSnapshot>();
  const [decision, setDecision] = useState<ExactDuplicateDecisionView>();
  const [mutationState, setMutationState] = useState<'IDLE' | 'STAGING' | 'SUBMITTING'>('IDLE');
  const [mutationError, setMutationError] = useState<string>();
  const [resetPreview, setResetPreview] = useState<KnowledgeResetPreviewV1>();
  const [resetRequest, setResetRequest] = useState<
    { projectId: string; requestId: string } | undefined
  >(() => {
    const requestId = readResetRequestId(projectId);
    return requestId ? { projectId, requestId } : undefined;
  });
  const resetRequestId = resetRequest?.projectId === projectId ? resetRequest.requestId : undefined;
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string>();
  const resetIdempotency = useRef<{ previewId: string; key: string } | undefined>(undefined);
  const resetCachePurgedRequestId = useRef<string | undefined>(undefined);
  const linkedSubmissionId = searchParameters.get('submission')?.trim() || null;
  const query = useMemo<SourceLibraryQuery>(
    () => ({
      ...DEFAULT_QUERY,
      ...(appliedQuery.trim() ? { query: appliedQuery.trim() } : {}),
    }),
    [appliedQuery],
  );
  const library = useQuery(sourcesLibraryQueryOptions(apiClient, shell, query));
  const linkedSubmission = useQuery(
    sourceIntakeSubmissionQueryOptions(apiClient, shell, linkedSubmissionId),
  );
  const resetStatus = useQuery({
    queryKey: ['source-knowledge-reset-status', projectId, resetRequestId],
    queryFn: () => apiClient.getSourceKnowledgeResetStatus(projectId, resetRequestId!),
    enabled: Boolean(projectId && resetRequestId && !connectivity.isOffline),
    refetchInterval: (query) =>
      query.state.data &&
      ['COMPLETE', 'BLOCKED', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'].includes(
        query.state.data.state,
      )
        ? false
        : 2_000,
  });
  useEffect(() => {
    const request = resetStatus.data;
    if (
      !request ||
      request.projectId !== projectId ||
      resetCachePurgedRequestId.current === request.requestId
    ) {
      return;
    }
    resetCachePurgedRequestId.current = request.requestId;
    void purgeProjectScopedKnowledgeQueries(queryClient, projectId);
  }, [projectId, queryClient, resetStatus.data?.projectId, resetStatus.data?.requestId]);
  useEffect(() => {
    const requestId = readResetRequestId(projectId);
    setResetPreview(undefined);
    setResetConfirmed(false);
    setResetRequest(requestId ? { projectId, requestId } : undefined);
  }, [projectId]);
  const seed =
    typeof location.state === 'object' && location.state !== null
      ? (location.state as { readonly intakeDraftSeed?: unknown }).intakeDraftSeed
      : undefined;
  const draftQueue = useSourceIntakeDraftQueue(shell.activeProject?.id ?? '', seed);

  if (!shell.activeProject) {
    return (
      <EmptyState
        title={t('sources.create_project')}
        description={t('sources.create_project_help')}
      />
    );
  }

  const requestedView = searchParameters.get('view');
  const showAddSource = requestedView === 'add' || (requestedView === null && seed !== undefined);
  const displayedSubmission =
    submission?.submissionId === linkedSubmissionId
      ? submission
      : linkedSubmissionId === null
        ? submission
        : linkedSubmission.data;
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!connectivity.isOffline) setAppliedQuery(searchInput);
  };

  const previewReset = async () => {
    if (connectivity.isOffline || resetBusy || !isActiveProjectOwner) return;
    setResetBusy(true);
    setResetError(undefined);
    setResetPreview(undefined);
    setResetConfirmed(false);
    resetIdempotency.current = undefined;
    try {
      setResetPreview(await apiClient.previewSourceKnowledgeReset(projectId));
    } catch {
      setResetError(t('sources.reset_error'));
    } finally {
      setResetBusy(false);
    }
  };

  const confirmReset = async () => {
    const preview = resetPreview;
    if (
      !preview ||
      !preview.canConfirm ||
      !resetConfirmed ||
      preview.projectId !== projectId ||
      connectivity.isOffline ||
      resetBusy ||
      !isActiveProjectOwner
    ) {
      return;
    }
    if (resetIdempotency.current?.previewId !== preview.previewId) {
      resetIdempotency.current = { previewId: preview.previewId, key: identity('source-reset') };
    }
    setResetBusy(true);
    setResetError(undefined);
    try {
      const response = await apiClient.confirmSourceKnowledgeReset(projectId, {
        previewId: preview.previewId,
        manifestDigest: preview.manifestDigest,
        expectedProjectRevision: preview.projectRevision,
        expectedKnowledgeEpoch: preview.knowledgeEpoch,
        idempotencyKey: resetIdempotency.current.key,
        confirmIrreversibleReset: true,
      });
      try {
        globalThis.sessionStorage.setItem(
          resetRequestStorageKey(projectId),
          response.request.requestId,
        );
      } catch {
        // Durable status remains available from the request ID returned by the API response.
      }
      setResetRequest({ projectId, requestId: response.request.requestId });
      setResetPreview(undefined);
      setResetConfirmed(false);
    } catch {
      // Keep the preview and idempotency key so an uncertain request can be retried safely.
      setResetError(t('sources.reset_error'));
    } finally {
      setResetBusy(false);
    }
  };

  const onAddDraft = (event: FormEvent) => {
    event.preventDefault();
    if (intakeKind === 'DIRECT_TEXT') {
      draftQueue.addDirectText(
        intakeLabel || hfmOwnerLabel(t, 'intakeKind', 'DIRECT_TEXT'),
        directText,
        requestedClassification,
      );
      setDirectText('');
    } else if (intakeKind === 'URL') {
      draftQueue.addUrl(intakeLabel, requestedUrl, requestedClassification);
      setRequestedUrl('');
    } else if (selectedFile) {
      draftQueue.addFile(intakeLabel, selectedFile, requestedClassification);
      setSelectedFile(undefined);
    }
    setIntakeLabel('');
  };

  const commandFor = (fingerprint: string): DraftCommandIdentity => {
    if (commandIdentity.current?.fingerprint === fingerprint) return commandIdentity.current;
    const next: DraftCommandIdentity = {
      fingerprint,
      clientRequestId: identity('sources-request'),
      idempotencyKey: identity('sources-idempotency'),
      draftId: identity('sources-draft'),
    };
    commandIdentity.current = next;
    return next;
  };

  const submitDrafts = async () => {
    const ready = draftQueue.items.every((item) => item.validation === 'READY');
    if (
      !ready ||
      draftQueue.items.length === 0 ||
      draftQueue.activeProjectMismatch ||
      connectivity.isOffline ||
      mutationState !== 'IDLE'
    ) {
      return;
    }
    const fingerprint = draftQueue.items.map((item) => item.draftItemId).join('|');
    const command = commandFor(fingerprint);
    setMutationError(undefined);
    setMutationState('STAGING');
    try {
      const staged: StagedSourcesIntakeInput[] = [];
      for (const item of draftQueue.items) {
        if (item.kind === 'FILE_METADATA') {
          throw new Error(t('sources.choose_file_again'));
        }
        if (item.kind === 'DIRECT_TEXT') {
          const receipt = await writeClient.stageBytes({
            draftId: command.draftId,
            itemId: item.draftItemId,
            kind: 'DIRECT_TEXT',
            label: item.label,
            mediaType: 'text/plain',
            bytes: new TextEncoder().encode(item.text),
          });
          staged.push({
            itemId: item.draftItemId,
            kind: 'DIRECT_TEXT',
            label: item.label,
            stagingReference: receipt.stagingReference,
            requestedClassification: item.requestedClassification,
          });
        } else if (item.kind === 'FILE') {
          const receipt = await writeClient.stageBytes({
            draftId: command.draftId,
            itemId: item.draftItemId,
            kind: 'FILE',
            label: item.label,
            mediaType: item.file.type as 'text/plain' | 'text/markdown',
            fileName: item.file.name,
            bytes: new Uint8Array(await item.file.arrayBuffer()),
          });
          staged.push({
            itemId: item.draftItemId,
            kind: 'FILE',
            label: item.label,
            fileName: item.file.name,
            mediaType: item.file.type as 'text/plain' | 'text/markdown',
            stagingReference: receipt.stagingReference,
            requestedClassification: item.requestedClassification,
          });
        } else {
          const receipt = await writeClient.stageUrl({
            draftId: command.draftId,
            itemId: item.draftItemId,
            label: item.label,
            requestedUrl: item.requestedUrl,
          });
          staged.push({
            itemId: item.draftItemId,
            kind: 'URL',
            label: item.label,
            stagingReference: receipt.stagingReference,
            requestedClassification: item.requestedClassification,
          });
        }
      }
      setMutationState('SUBMITTING');
      const result = await writeClient.submit({
        activeProjectId: projectId,
        targetProjectId: projectId,
        clientRequestId: command.clientRequestId,
        idempotencyKey: command.idempotencyKey,
        draftId: command.draftId,
        inputs: staged,
      });
      setSubmission(result.resource);
      setDecision(undefined);
      draftQueue.discardAll();
      commandIdentity.current = undefined;
      await library.refetch();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : t('sources.submission_failed'));
    } finally {
      setMutationState('IDLE');
    }
  };

  const reviewDuplicate = async (decisionId: string) => {
    setMutationError(undefined);
    try {
      setDecision(await apiClient.getExactDuplicateDecision(decisionId));
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : t('sources.duplicate_decision_failed'),
      );
    }
  };

  const resolveDuplicate = async (
    disposition: ExactDuplicateDecisionView['allowedDispositions'][number],
  ) => {
    if (!decision || connectivity.isOffline) return;
    setMutationState('SUBMITTING');
    setMutationError(undefined);
    try {
      const result = await writeClient.resolveDuplicate({
        activeProjectId: projectId,
        targetProjectId: projectId,
        clientRequestId: identity('sources-duplicate-request'),
        idempotencyKey: identity('sources-duplicate-idempotency'),
        decisionId: decision.decisionId,
        disposition,
        ...(disposition === 'CREATE_VERSION_CANDIDATE'
          ? { targetSourceId: decision.existingSource.sourceId }
          : {}),
      });
      setSubmission(result.resource);
      setDecision(undefined);
      await library.refetch();
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : t('sources.duplicate_resolution_failed'),
      );
    } finally {
      setMutationState('IDLE');
    }
  };

  const cancelSubmission = async () => {
    if (!displayedSubmission || connectivity.isOffline) return;
    setMutationState('SUBMITTING');
    try {
      const result = await writeClient.cancel({
        activeProjectId: projectId,
        targetProjectId: projectId,
        clientRequestId: identity('sources-cancel-request'),
        idempotencyKey: identity('sources-cancel-idempotency'),
        submissionId: displayedSubmission.submissionId,
      });
      setSubmission(result.resource);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : t('sources.cancellation_failed'));
    } finally {
      setMutationState('IDLE');
    }
  };

  const retryItem = async (itemId: string, mode: 'SAME_CONTEXT' | 'CURRENT_POLICY') => {
    if (!displayedSubmission || connectivity.isOffline) return;
    setMutationState('SUBMITTING');
    try {
      const result = await writeClient.retry({
        activeProjectId: projectId,
        targetProjectId: projectId,
        clientRequestId: identity('sources-retry-request'),
        idempotencyKey: identity('sources-retry-idempotency'),
        submissionId: displayedSubmission.submissionId,
        itemIds: [itemId],
        mode,
      });
      setSubmission(result.resource);
      await library.refetch();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : t('sources.retry_failed'));
    } finally {
      setMutationState('IDLE');
    }
  };

  const readyToSubmit =
    draftQueue.items.length > 0 &&
    draftQueue.items.every((item) => item.validation === 'READY') &&
    !draftQueue.activeProjectMismatch &&
    !connectivity.isOffline &&
    mutationState === 'IDLE';

  return (
    <section className="route-page hfm-route-page sources-workspace">
      <p className="eyebrow">{t('sources.eyebrow')}</p>
      <h1 tabIndex={-1}>{t('sources.title')}</h1>

      {showAddSource ? (
        <section className="action-card sources-intake" aria-labelledby="source-intake-heading">
          <h2 id="source-intake-heading">{t('sources.draft_queue')}</h2>
          <p>{t('sources.draft_help')}</p>
          <p>
            <Link to="/sources">{t('sources.library')}</Link>
          </p>
          {draftQueue.activeProjectMismatch ? (
            <p className="warning-state hfm-status-attention" role="alert">
              {t('sources.project_mismatch')}
            </p>
          ) : null}
          {draftQueue.invalidSeed ? (
            <p className="warning-state hfm-status-attention" role="alert">
              {t('sources.invalid_draft')}
            </p>
          ) : null}
          {mutationState !== 'IDLE' ? (
            <p className="status-message hfm-status-info" role="status" aria-live="polite">
              {mutationState === 'STAGING'
                ? t('sources.adding_draft')
                : t('sources.submitting_drafts')}
            </p>
          ) : null}
          {mutationError ? (
            <p className="warning-state hfm-status-error" role="alert">
              {mutationError}
            </p>
          ) : null}
          {linkedSubmissionId && linkedSubmission.isPending ? (
            <LoadingState message="제출 상태를 불러오는 중…" />
          ) : linkedSubmissionId && linkedSubmission.isError ? (
            <ErrorState error={linkedSubmission.error} onRetry={() => linkedSubmission.refetch()} />
          ) : null}
          <form className="source-intake-form" onSubmit={onAddDraft}>
            <label htmlFor="source-intake-kind">{t('sources.input_type')}</label>
            <select
              id="source-intake-kind"
              value={intakeKind}
              onChange={(event) =>
                setIntakeKind(event.target.value as 'DIRECT_TEXT' | 'FILE' | 'URL')
              }
            >
              <option value="DIRECT_TEXT">{hfmOwnerLabel(t, 'intakeKind', 'DIRECT_TEXT')}</option>
              <option value="FILE">{hfmOwnerLabel(t, 'intakeKind', 'FILE')}</option>
              <option value="URL">{hfmOwnerLabel(t, 'intakeKind', 'URL')}</option>
            </select>
            <label htmlFor="source-intake-label">{t('sources.label')}</label>
            <input
              id="source-intake-label"
              value={intakeLabel}
              maxLength={200}
              onChange={(event) => setIntakeLabel(event.target.value)}
            />
            {intakeKind === 'DIRECT_TEXT' ? (
              <>
                <label htmlFor="source-intake-text">
                  {hfmOwnerLabel(t, 'intakeKind', 'DIRECT_TEXT')}
                </label>
                <textarea
                  id="source-intake-text"
                  value={directText}
                  maxLength={1_048_576}
                  onChange={(event) => setDirectText(event.target.value)}
                />
              </>
            ) : null}
            {intakeKind === 'FILE' ? (
              <>
                <label htmlFor="source-intake-file">{hfmOwnerLabel(t, 'intakeKind', 'FILE')}</label>
                <input
                  id="source-intake-file"
                  type="file"
                  accept="text/plain,text/markdown,.txt,.md"
                  onChange={(event) => setSelectedFile(event.target.files?.[0])}
                />
              </>
            ) : null}
            {intakeKind === 'URL' ? (
              <>
                <label htmlFor="source-intake-url">{hfmOwnerLabel(t, 'intakeKind', 'URL')}</label>
                <input
                  id="source-intake-url"
                  type="url"
                  value={requestedUrl}
                  maxLength={2048}
                  onChange={(event) => setRequestedUrl(event.target.value)}
                />
              </>
            ) : null}
            <button
              className="hfm-action-secondary"
              type="submit"
              disabled={intakeKind === 'FILE' && !selectedFile}
            >
              {t('sources.add_intake_draft')}
            </button>
          </form>
          {draftQueue.items.length === 0 ? <p>{t('sources.no_drafts')}</p> : null}
          {draftQueue.items.length > 0 ? (
            <>
              <ul className="source-intake-list" aria-label={t('sources.intake_drafts')}>
                {draftQueue.items.map((item) => (
                  <li key={item.draftItemId}>
                    <div>
                      <strong>{item.label}</strong>
                      <p>
                        {hfmOwnerLabel(t, 'intakeKind', item.kind)} ·{' '}
                        {hfmOwnerLabel(t, 'intakeValidation', item.validation)} ·{' '}
                        {t('sources.requested_classification')}{' '}
                        {hfmOwnerLabel(t, 'sensitivity', item.requestedClassification)}
                      </p>
                      <small>{sourceDraftMessage(t, item.messageCode)}</small>
                    </div>
                    <button
                      className="hfm-action-destructive"
                      type="button"
                      onClick={() => draftQueue.remove(item.draftItemId)}
                    >
                      {t('sources.remove')} {item.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="source-intake-actions">
                <button
                  className="hfm-action-destructive"
                  type="button"
                  onClick={draftQueue.discardAll}
                >
                  {t('sources.discard_all')}
                </button>
                <button
                  className="hfm-action-primary"
                  type="button"
                  disabled={!readyToSubmit}
                  onClick={() => void submitDrafts()}
                >
                  {t('sources.submit_drafts')}
                </button>
              </div>
            </>
          ) : null}

          {displayedSubmission ? (
            <section aria-labelledby="submission-status-heading">
              <h3 id="submission-status-heading">
                {t('sources.submission')}{' '}
                {hfmOwnerLabel(t, 'intakeState', displayedSubmission.state)}
              </h3>
              <TechnicalDetails
                items={[
                  { label: t('sources.submission_id'), value: displayedSubmission.submissionId },
                ]}
              />
              <ul className="source-intake-list" aria-label={t('sources.submission_items')}>
                {displayedSubmission.items.map((item) => (
                  <li key={item.itemId}>
                    <div>
                      <strong>{item.manifest.label}</strong>
                      <p>{hfmOwnerLabel(t, 'intakeState', item.state)}</p>
                      {item.attentionReason ? <small>{item.attentionReason}</small> : null}
                    </div>
                    <div className="source-intake-actions">
                      {item.duplicateDecisionId ? (
                        <button
                          className="hfm-action-secondary"
                          type="button"
                          onClick={() => void reviewDuplicate(item.duplicateDecisionId!)}
                        >
                          {t('sources.review_duplicate')}
                        </button>
                      ) : null}
                      {item.capabilities.includes('RETRY_SAME_CONTEXT') ? (
                        <button
                          className="hfm-action-selection"
                          type="button"
                          onClick={() => void retryItem(item.itemId, 'SAME_CONTEXT')}
                        >
                          {t('sources.retry_same')}
                        </button>
                      ) : null}
                      {item.capabilities.includes('RETRY_CURRENT_POLICY') ? (
                        <button
                          className="hfm-action-selection"
                          type="button"
                          onClick={() => void retryItem(item.itemId, 'CURRENT_POLICY')}
                        >
                          {t('sources.retry_policy')}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {displayedSubmission.capabilities.includes('CANCEL') ? (
                <button
                  className="hfm-action-secondary"
                  type="button"
                  onClick={() => void cancelSubmission()}
                >
                  {t('sources.cancel_submission')}
                </button>
              ) : null}
            </section>
          ) : null}

          {decision ? (
            <section role="dialog" aria-labelledby="duplicate-decision-heading" aria-modal="false">
              <h3 id="duplicate-decision-heading">{t('sources.exact_duplicate_decision')}</h3>
              <p>
                {t('sources.existing_source')} <strong>{decision.existingSource.label}</strong>,{' '}
                {t('sources.version')} {decision.existingSource.versionNumber}
              </p>
              <div className="source-intake-actions">
                {decision.allowedDispositions.map((disposition) => (
                  <button
                    key={disposition}
                    className="hfm-action-secondary"
                    type="button"
                    onClick={() => void resolveDuplicate(disposition)}
                    disabled={mutationState !== 'IDLE' || connectivity.isOffline}
                  >
                    {hfmOwnerLabel(t, 'duplicateDisposition', disposition)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {!showAddSource ? (
        <section className="action-card sources-library" aria-labelledby="source-library-heading">
          <div className="source-library-heading">
            <div>
              <h2 id="source-library-heading">{t('sources.library')}</h2>
              <Link to="/sources?view=add">{t('sources.add_source')}</Link>
            </div>
            <form className="source-search" role="search" onSubmit={onSearch}>
              <label htmlFor="source-search-query">{t('sources.search')}</label>
              <div>
                <input
                  id="source-search-query"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  disabled={connectivity.isOffline}
                  maxLength={500}
                />
                <button
                  className="hfm-action-secondary"
                  type="submit"
                  disabled={connectivity.isOffline}
                >
                  {t('sources.search_submit')}
                </button>
              </div>
            </form>
          </div>

          {isActiveProjectOwner ? (
            <section className="source-knowledge-reset" aria-labelledby="source-reset-heading">
              <h3 id="source-reset-heading">{t('sources.reset_title')}</h3>
              <p>{t('sources.reset_help')}</p>
              {connectivity.isOffline ? (
                <p className="stale-state" role="status">
                  {t('sources.reset_offline')}
                </p>
              ) : null}
              <button
                className="hfm-action-secondary"
                type="button"
                onClick={() => void previewReset()}
                disabled={connectivity.isOffline || resetBusy}
              >
                {resetBusy ? t('common.checking') : t('sources.reset_review')}
              </button>
              {resetError ? (
                <p className="warning-state hfm-status-error" role="alert">
                  {resetError}
                </p>
              ) : null}
              {resetPreview ? (
                <div className="source-knowledge-reset-preview">
                  <p>{t('sources.reset_preview_help')}</p>
                  <dl>
                    <div>
                      <dt>{t('sources.reset_count_sources')}</dt>
                      <dd>{resetPreview.counts.sourceCount}</dd>
                    </div>
                    <div>
                      <dt>{t('sources.reset_count_versions')}</dt>
                      <dd>{resetPreview.counts.sourceVersionCount}</dd>
                    </div>
                    <div>
                      <dt>{t('sources.reset_count_derived')}</dt>
                      <dd>{resetPreview.counts.sourceDerivedRecordCount}</dd>
                    </div>
                    <div>
                      <dt>{t('sources.reset_count_history')}</dt>
                      <dd>{resetPreview.counts.redactedHistoryRecordCount}</dd>
                    </div>
                    <div>
                      <dt>{t('sources.reset_count_projections')}</dt>
                      <dd>{resetPreview.counts.rebuildProjectionCount}</dd>
                    </div>
                    <div>
                      <dt>{t('sources.reset_count_shared_assets')}</dt>
                      <dd>{resetPreview.counts.sharedAssetCount}</dd>
                    </div>
                    <div>
                      <dt>{t('sources.reset_count_blocked')}</dt>
                      <dd>{resetPreview.counts.blockedRecordCount}</dd>
                    </div>
                  </dl>
                  <ul aria-label="Reset blockers">
                    {resetPreview.blockers.map((code) => (
                      <li key={code} className="warning-state hfm-status-attention">
                        {resetBlockerMessage(t, code)}
                      </li>
                    ))}
                  </ul>
                  <p>{new Date(resetPreview.expiresAt).toLocaleString()}</p>
                  {resetPreview.canConfirm ? (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={resetConfirmed}
                          onChange={(event) => setResetConfirmed(event.target.checked)}
                        />{' '}
                        {t('sources.reset_irreversible_ack')}
                      </label>
                      <button
                        className="hfm-action-destructive"
                        type="button"
                        disabled={!resetConfirmed || resetBusy || connectivity.isOffline}
                        onClick={() => void confirmReset()}
                      >
                        {resetBusy ? t('common.saving') : t('sources.reset_confirm')}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {resetRequestId ? (
                <div className="source-knowledge-reset-status" role="status" aria-live="polite">
                  {resetStatus.isPending ? <p>{t('common.loading')}</p> : null}
                  {resetStatus.error ? (
                    <p className="warning-state hfm-status-error">{t('sources.reset_error')}</p>
                  ) : null}
                  {resetStatus.data ? (
                    <>
                      <p>
                        {t('sources.reset_status')}: {resetStatus.data.state}
                      </p>
                      {resetStatus.data.state === 'APPROVED' ? (
                        <p>{t('sources.reset_restart_required')}</p>
                      ) : null}
                      <p>
                        {t('sources.reset_cas')}: {resetStatus.data.casStatus}
                      </p>
                      <p>
                        {t('sources.reset_backup')}: {resetStatus.data.backupStatus}
                      </p>
                      {resetStatus.data.blockerCodes.map((code) => (
                        <p key={code} className="warning-state hfm-status-attention">
                          {resetBlockerMessage(t, code)}
                        </p>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {connectivity.isOffline ? (
            <p className="stale-state" role="status">
              {t('sources.offline_cached')}
            </p>
          ) : null}
          {library.isPending ? <LoadingState message={t('sources.loading_library')} /> : null}
          {library.error ? (
            <ErrorState
              error={library.error}
              onRetry={() => {
                void library.refetch();
              }}
            />
          ) : null}
          {library.data?.stale ? (
            <p className="stale-state" role="status">
              {t('sources.library_stale')}
            </p>
          ) : null}
          {library.data && library.data.items.length === 0 ? (
            <EmptyState
              title={appliedQuery ? t('sources.no_matching') : t('sources.none_yet')}
              description={
                appliedQuery ? t('sources.change_search') : t('sources.submitted_appear')
              }
            />
          ) : null}
          {library.data && library.data.items.length > 0 ? (
            <ul className="source-library-list" aria-label={t('sources.list')}>
              {library.data.items.map((source) => {
                const readinessMessage = sourceReadinessMessage(t, source);
                return (
                  <li key={source.sourceId}>
                    <div>
                      <h3>{source.label}</h3>
                      <p className="source-library-metadata">
                        {hfmOwnerLabel(t, 'mediaType', source.mediaType)} ·{' '}
                        {t('sources.classification')}:{' '}
                        {hfmOwnerLabel(t, 'sensitivity', source.sensitivity)}
                      </p>
                      {readinessMessage ? (
                        <p className="source-library-readiness">{readinessMessage}</p>
                      ) : null}
                    </div>
                    <div className="source-library-status">
                      <Link
                        className="primary-link"
                        to={`/sources/${encodeURIComponent(source.sourceId)}?version=${encodeURIComponent(source.selectedSourceVersionId)}`}
                      >
                        {t('sources.open')}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
};
