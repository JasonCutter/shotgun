import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router';

import {
  createSourcesWriteClient,
  type ExactDuplicateDecisionView,
  type GlobalShellView,
  type IntakeSubmissionSnapshot,
  type SourceLibraryQuery,
  type SourcesSensitivity,
  type StagedSourcesIntakeInput,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import {
  duplicateDispositionLabel,
  intakeKindLabel,
  intakeStateLabel,
  intakeValidationLabel,
  mediaTypeLabel,
  sourceAskUsageLabel,
  sourceLifecycleLabel,
  sourcePreviewLabel,
} from '../presentation/product-labels.js';
import { sourcesLibraryQueryOptions } from '../sources/sources-queries.js';
import { useSourceIntakeDraftQueue } from '../sources/source-intake-drafts.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';

const DEFAULT_QUERY: SourceLibraryQuery = {
  schemaVersion: '1.0.0',
  filters: {},
  sort: 'UPDATED_DESC',
  limit: 50,
};

const identity = (prefix: string): string =>
  `${prefix}-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`;

type DraftCommandIdentity = {
  readonly fingerprint: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly draftId: string;
};

export const SourcesWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const location = useLocation();
  const connectivity = useConnectivityState();
  const writeClient = useMemo(() => createSourcesWriteClient(), []);
  const commandIdentity = useRef<DraftCommandIdentity | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [intakeKind, setIntakeKind] = useState<'DIRECT_TEXT' | 'FILE' | 'URL'>('DIRECT_TEXT');
  const [intakeLabel, setIntakeLabel] = useState('');
  const [requestedClassification, setRequestedClassification] =
    useState<SourcesSensitivity>('private');
  const [directText, setDirectText] = useState('');
  const [requestedUrl, setRequestedUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File>();
  const [submission, setSubmission] = useState<IntakeSubmissionSnapshot>();
  const [decision, setDecision] = useState<ExactDuplicateDecisionView>();
  const [mutationState, setMutationState] = useState<'IDLE' | 'STAGING' | 'SUBMITTING'>('IDLE');
  const [mutationError, setMutationError] = useState<string>();
  const query = useMemo<SourceLibraryQuery>(
    () => ({
      ...DEFAULT_QUERY,
      ...(appliedQuery.trim() ? { query: appliedQuery.trim() } : {}),
    }),
    [appliedQuery],
  );
  const library = useQuery(sourcesLibraryQueryOptions(apiClient, shell, query));
  const seed =
    typeof location.state === 'object' && location.state !== null
      ? (location.state as { readonly intakeDraftSeed?: unknown }).intakeDraftSeed
      : undefined;
  const draftQueue = useSourceIntakeDraftQueue(shell.activeProject?.id ?? '', seed);

  if (!shell.activeProject) {
    return (
      <EmptyState
        title="Create a Project before adding Sources"
        description="Sources are always bound to a server-authoritative Project."
      />
    );
  }

  const projectId = shell.activeProject.id;
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!connectivity.isOffline) setAppliedQuery(searchInput);
  };

  const onAddDraft = (event: FormEvent) => {
    event.preventDefault();
    if (intakeKind === 'DIRECT_TEXT') {
      draftQueue.addDirectText(intakeLabel, directText, requestedClassification);
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
          throw new Error('Choose the file again before submission.');
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
      setMutationError(error instanceof Error ? error.message : 'Sources submission failed.');
    } finally {
      setMutationState('IDLE');
    }
  };

  const reviewDuplicate = async (decisionId: string) => {
    setMutationError(undefined);
    try {
      setDecision(await apiClient.getExactDuplicateDecision(decisionId));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Duplicate decision failed.');
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
      setMutationError(error instanceof Error ? error.message : 'Duplicate resolution failed.');
    } finally {
      setMutationState('IDLE');
    }
  };

  const cancelSubmission = async () => {
    if (!submission || connectivity.isOffline) return;
    setMutationState('SUBMITTING');
    try {
      const result = await writeClient.cancel({
        activeProjectId: projectId,
        targetProjectId: projectId,
        clientRequestId: identity('sources-cancel-request'),
        idempotencyKey: identity('sources-cancel-idempotency'),
        submissionId: submission.submissionId,
      });
      setSubmission(result.resource);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Cancellation failed.');
    } finally {
      setMutationState('IDLE');
    }
  };

  const retryItem = async (itemId: string, mode: 'SAME_CONTEXT' | 'CURRENT_POLICY') => {
    if (!submission || connectivity.isOffline) return;
    setMutationState('SUBMITTING');
    try {
      const result = await writeClient.retry({
        activeProjectId: projectId,
        targetProjectId: projectId,
        clientRequestId: identity('sources-retry-request'),
        idempotencyKey: identity('sources-retry-idempotency'),
        submissionId: submission.submissionId,
        itemIds: [itemId],
        mode,
      });
      setSubmission(result.resource);
      await library.refetch();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Retry failed.');
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
    <section className="route-page sources-workspace">
      <p className="eyebrow">Knowledge input</p>
      <h1 tabIndex={-1}>Sources</h1>
      <p>
        Project: <strong>{shell.activeProject.label}</strong>
      </p>

      <section className="action-card" aria-labelledby="source-intake-heading">
        <h2 id="source-intake-heading">Draft Queue</h2>
        <p>
          Direct Text, File and URL drafts remain fixed to this Project until you explicitly submit
          or discard them.
        </p>
        <p>Drafts stay with the project where they were created until submitted or discarded.</p>
        {draftQueue.activeProjectMismatch ? (
          <p className="warning-state" role="alert">
            The active Project changed. These drafts remain isolated to their original Project and
            cannot be submitted from the current context.
          </p>
        ) : null}
        {draftQueue.invalidSeed ? (
          <p className="warning-state" role="alert">
            The incoming Draft Seed failed its typed contract and was rejected.
          </p>
        ) : null}
        <p className="status-message" role="status" aria-live="polite">
          {mutationState === 'STAGING'
            ? 'Staging immutable Source bytes…'
            : mutationState === 'SUBMITTING'
              ? 'Submitting the server-authoritative Intake command…'
              : 'Server submission is active. Raw input is staged before the Command Ledger is accepted.'}
        </p>
        {mutationError ? (
          <p className="warning-state" role="alert">
            {mutationError}
          </p>
        ) : null}
        <form className="source-intake-form" onSubmit={onAddDraft}>
          <label htmlFor="source-intake-kind">Input type</label>
          <select
            id="source-intake-kind"
            value={intakeKind}
            onChange={(event) =>
              setIntakeKind(event.target.value as 'DIRECT_TEXT' | 'FILE' | 'URL')
            }
          >
            <option value="DIRECT_TEXT">Direct Text</option>
            <option value="FILE">File</option>
            <option value="URL">URL</option>
          </select>
          <label htmlFor="source-intake-label">Label</label>
          <input
            id="source-intake-label"
            value={intakeLabel}
            maxLength={200}
            onChange={(event) => setIntakeLabel(event.target.value)}
          />
          <label htmlFor="source-intake-classification">Source classification</label>
          <select
            id="source-intake-classification"
            value={requestedClassification}
            onChange={(event) =>
              setRequestedClassification(event.target.value as SourcesSensitivity)
            }
          >
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="private">Private</option>
          </select>
          <p>
            This is a classification request for this new Source. The Server validates and stores
            the final classification; it does not change your access clearance.
          </p>
          {intakeKind === 'DIRECT_TEXT' ? (
            <>
              <label htmlFor="source-intake-text">Direct Text</label>
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
              <label htmlFor="source-intake-file">File</label>
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
              <label htmlFor="source-intake-url">URL</label>
              <input
                id="source-intake-url"
                type="url"
                value={requestedUrl}
                maxLength={2048}
                onChange={(event) => setRequestedUrl(event.target.value)}
              />
            </>
          ) : null}
          <button type="submit" disabled={intakeKind === 'FILE' && !selectedFile}>
            Add intake draft
          </button>
        </form>
        {draftQueue.items.length === 0 ? <p>No route-scoped drafts.</p> : null}
        {draftQueue.items.length > 0 ? (
          <>
            <ul className="source-intake-list" aria-label="Intake drafts">
              {draftQueue.items.map((item) => (
                <li key={item.draftItemId}>
                  <div>
                    <strong>{item.label}</strong>
                    <p>
                      {intakeKindLabel(item.kind)} · {intakeValidationLabel(item.validation)} ·
                      Requested classification: {item.requestedClassification}
                    </p>
                    <small>{item.message}</small>
                  </div>
                  <button type="button" onClick={() => draftQueue.remove(item.draftItemId)}>
                    Remove {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="source-intake-actions">
              <button type="button" onClick={draftQueue.discardAll}>
                Discard all drafts
              </button>
              <button type="button" disabled={!readyToSubmit} onClick={() => void submitDrafts()}>
                Submit drafts
              </button>
            </div>
          </>
        ) : null}

        {submission ? (
          <section aria-labelledby="submission-status-heading">
            <h3 id="submission-status-heading">Submission {intakeStateLabel(submission.state)}</h3>
            <TechnicalDetails
              items={[{ label: 'Submission ID', value: submission.submissionId }]}
            />
            <ul className="source-intake-list" aria-label="Submission items">
              {submission.items.map((item) => (
                <li key={item.itemId}>
                  <div>
                    <strong>{item.manifest.label}</strong>
                    <p>{intakeStateLabel(item.state)}</p>
                    {item.attentionReason ? <small>{item.attentionReason}</small> : null}
                  </div>
                  <div className="source-intake-actions">
                    {item.duplicateDecisionId ? (
                      <button
                        type="button"
                        onClick={() => void reviewDuplicate(item.duplicateDecisionId!)}
                      >
                        Review duplicate
                      </button>
                    ) : null}
                    {item.capabilities.includes('RETRY_SAME_CONTEXT') ? (
                      <button
                        type="button"
                        onClick={() => void retryItem(item.itemId, 'SAME_CONTEXT')}
                      >
                        Retry same context
                      </button>
                    ) : null}
                    {item.capabilities.includes('RETRY_CURRENT_POLICY') ? (
                      <button
                        type="button"
                        onClick={() => void retryItem(item.itemId, 'CURRENT_POLICY')}
                      >
                        Retry current policy
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {submission.capabilities.includes('CANCEL') ? (
              <button type="button" onClick={() => void cancelSubmission()}>
                Cancel submission
              </button>
            ) : null}
          </section>
        ) : null}

        {decision ? (
          <section role="dialog" aria-labelledby="duplicate-decision-heading" aria-modal="false">
            <h3 id="duplicate-decision-heading">Exact duplicate decision</h3>
            <p>
              Existing Source: <strong>{decision.existingSource.label}</strong>, Version{' '}
              {decision.existingSource.versionNumber}
            </p>
            <div className="source-intake-actions">
              {decision.allowedDispositions.map((disposition) => (
                <button
                  key={disposition}
                  type="button"
                  onClick={() => void resolveDuplicate(disposition)}
                  disabled={mutationState !== 'IDLE' || connectivity.isOffline}
                >
                  {duplicateDispositionLabel(disposition)}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <section className="action-card" aria-labelledby="source-library-heading">
        <div className="source-library-heading">
          <div>
            <h2 id="source-library-heading">Source Library</h2>
            <p>Server-authoritative, bounded and scoped to the active Project.</p>
          </div>
          <form className="source-search" role="search" onSubmit={onSearch}>
            <label htmlFor="source-search-query">Search Sources</label>
            <div>
              <input
                id="source-search-query"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                disabled={connectivity.isOffline}
                maxLength={500}
              />
              <button type="submit" disabled={connectivity.isOffline}>
                Search
              </button>
            </div>
          </form>
        </div>

        {connectivity.isOffline ? (
          <p className="stale-state" role="status">
            Offline. A previously authorized cached Library may be shown, but Server search and
            intake actions are blocked.
          </p>
        ) : null}
        {library.isPending ? <LoadingState message="Loading Source Library…" /> : null}
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
            This Library snapshot is stale.
          </p>
        ) : null}
        {library.data && library.data.items.length === 0 ? (
          <EmptyState
            title={appliedQuery ? 'No matching Sources' : 'No Sources yet'}
            description={
              appliedQuery
                ? 'Change the Server search query or clear it.'
                : 'Submitted Sources will appear here after Server processing.'
            }
          />
        ) : null}
        {library.data && library.data.items.length > 0 ? (
          <ul className="source-library-list" aria-label="Sources">
            {library.data.items.map((source) => (
              <li key={source.sourceId}>
                <div>
                  <h3>{source.label}</h3>
                  <p>
                    {mediaTypeLabel(source.mediaType)} · {sourceLifecycleLabel(source.lifecycle)} ·
                    Source classification: {source.sensitivity}
                  </p>
                  <p>{source.askUsageExplanation}</p>
                </div>
                <div className="source-library-status">
                  <span>{sourcePreviewLabel(source.previewReadiness)}</span>
                  <span>{sourceAskUsageLabel(source.askUsageState)}</span>
                  <Link
                    className="primary-link"
                    to={`/sources/${encodeURIComponent(source.sourceId)}?version=${encodeURIComponent(source.selectedSourceVersionId)}`}
                  >
                    Open pinned Version
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
};
