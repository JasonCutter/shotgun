import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router';

import type { GlobalShellView, SourceLibraryQuery } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { sourcesLibraryQueryOptions } from '../sources/sources-queries.js';
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
  const connectivity = useConnectivityState();
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const query = useMemo<SourceLibraryQuery>(
    () => ({
      ...DEFAULT_QUERY,
      ...(appliedQuery.trim() ? { query: appliedQuery.trim() } : {}),
    }),
    [appliedQuery],
  );
  const library = useQuery(sourcesLibraryQueryOptions(apiClient, shell, query));

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
        <p className="status-message" role="status">
          Server submission is unavailable until the approved Intake Snapshot and URL provenance
          persistence boundary is activated.
        </p>
        <button type="button" disabled aria-describedby="source-intake-heading">
          Add intake draft
        </button>
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
