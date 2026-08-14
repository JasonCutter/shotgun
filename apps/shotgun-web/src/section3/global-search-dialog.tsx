import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import type { GlobalSearchResultView, GlobalShellView } from '@shotgun/api-client';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { useAppRuntime } from '../app/providers.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';

export type GlobalSearchDialogProps = {
  readonly shell: GlobalShellView;
  readonly open: boolean;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

export const GlobalSearchDialog = ({ shell, open, invoker, onClose }: GlobalSearchDialogProps) => {
  const { apiClient } = useAppRuntime();
  const connectivity = useConnectivityState();
  const [query, setQuery] = useState('');
  const [crossProject, setCrossProject] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<readonly string[]>([]);
  const [searchResult, setSearchResult] = useState<GlobalSearchResultView | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const search = useMutation({
    mutationFn: () =>
      apiClient.searchGlobal({
        schemaVersion: '1.0.0',
        query,
        scope: crossProject
          ? { kind: 'CROSS_PROJECT', projectIds: selectedProjectIds }
          : { kind: 'ACTIVE_PROJECT' },
        limit: 20,
      }),
    onSuccess: (result) => {
      setSearchResult(result);
      setAnnouncement(`${result.results.length} search results.`);
    },
  });

  const close = () => {
    setQuery('');
    setCrossProject(false);
    setSelectedProjectIds([]);
    setSearchResult(null);
    setAnnouncement('');
    search.reset();
    onClose();
  };
  const dialog = useAccessibleDialog({ open, onClose: close });

  useEffect(() => {
    if (open) dialog.captureInvoker(invoker);
  }, [invoker, open]);

  const crossProjectAvailable =
    shell.features.find((feature) => feature.id === 'cross-project-search')?.availability ===
    'AVAILABLE';
  const validSearchScope =
    !crossProject || (crossProjectAvailable && selectedProjectIds.length > 0);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-search-title"
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={dialog.onDialogKeyDown}
    >
      <div className="modal-card">
        <h2 id="global-search-title">Search</h2>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!query.trim() || !validSearchScope || connectivity.isOffline) return;
            search.mutate();
          }}
        >
          <label htmlFor="global-search-query">Search query</label>
          <input
            id="global-search-query"
            value={query}
            maxLength={500}
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {crossProjectAvailable ? (
            <fieldset>
              <legend>Search scope</legend>
              <label>
                <input
                  type="radio"
                  name="search-scope"
                  checked={!crossProject}
                  onChange={() => {
                    setCrossProject(false);
                    setSelectedProjectIds([]);
                  }}
                />
                Active Project
              </label>
              <label>
                <input
                  type="radio"
                  name="search-scope"
                  checked={crossProject}
                  onChange={() => setCrossProject(true)}
                />
                Selected Projects
              </label>
              {crossProject ? (
                <div>
                  {shell.accessibleProjects.map((project) => (
                    <label key={project.id}>
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelectedProjectIds((current) =>
                            checked
                              ? [...current, project.id]
                              : current.filter((id) => id !== project.id),
                          );
                        }}
                      />
                      {project.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ) : null}
          <div className="dialog-actions">
            <button
              type="submit"
              disabled={
                search.isPending || connectivity.isOffline || !query.trim() || !validSearchScope
              }
            >
              {search.isPending ? 'Searching…' : 'Search'}
            </button>
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
        </form>
        {search.error ? <p role="alert">{safeErrorMessage(search.error)}</p> : null}
        {searchResult ? (
          <ul className="search-results">
            {searchResult.results.map((result) => (
              <li key={result.stableId}>
                <Link to={result.targetRoute.href} onClick={close}>
                  {result.label} · {result.projectLabel}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};
