import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router';

import type { GlobalShellView, SourceLibraryQuery } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { sourcesLibraryQueryOptions } from '../sources/sources-queries.js';
import { useSourceIntakeDraftQueue } from '../sources/source-intake-drafts.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';

const DEFAULT_QUERY: SourceLibraryQuery = {
  schemaVersion: '1.0.0',
  filters: {},
  sort: 'UPDATED_DESC',
  limit: 50,
};

export const SourcesWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const location = useLocation();
  const connectivity = useConnectivityState();
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [intakeKind, setIntakeKind] = useState<'DIRECT_TEXT' | 'FILE' | 'URL'>('DIRECT_TEXT');
  const [intakeLabel, setIntakeLabel] = useState('');
  const [directText, setDirectText] = useState('');
  const [requestedUrl, setRequestedUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File>();
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

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!connectivity.isOffline) setAppliedQuery(searchInput);
  };

  const onAddDraft = (event: FormEvent) => {
    event.preventDefault();
    if (intakeKind === 'DIRECT_TEXT') {
      draftQueue.addDirectText(intakeLabel, directText);
      setDirectText('');
    } else if (intakeKind === 'URL') {
      draftQueue.addUrl(intakeLabel, requestedUrl);
      setRequestedUrl('');
    } else if (selectedFile) {
      draftQueue.addFile(intakeLabel, selectedFile);
      setSelectedFile(undefined);
    }
    setIntakeLabel('');
  };

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
        <p>
          Draft Project: <strong>{draftQueue.draftProjectId}</strong>
        </p>
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
        <p className="status-message" role="status">
          Server submission is unavailable until the approved Intake Snapshot and URL provenance
          persistence boundary is activated.
        </p>
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
          {intakeKind === 'DIRECT_TEXT' ? (
            <>
              <label htmlFor="source-intake-text">Direct Text</label>
              <textarea
                id="source-intake-text"
                value={directText}
                maxLength={10 * 1024 * 1024}
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
                      {item.kind} · {item.validation}
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
              <button
                type="button"
                disabled
                title="Requires the separately approved durable Intake persistence boundary."
              >
                Submit drafts
              </button>
            </div>
          </>
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
                    {source.mediaType} · {source.lifecycle}
                  </p>
                  <p>{source.askUsageExplanation}</p>
                </div>
                <div className="source-library-status">
                  <span>{source.previewReadiness}</span>
                  <span>{source.askUsageState}</span>
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
