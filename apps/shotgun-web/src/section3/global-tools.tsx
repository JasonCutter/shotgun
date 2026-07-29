import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type { GlobalSearchResultView, GlobalShellView } from '@shotgun/api-client';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { useAppRuntime } from '../app/providers.js';
import {
  productSessionQueryKey,
  purgeProjectScopedCaches,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';

export const GlobalTools = ({ shell }: { readonly shell: GlobalShellView }) => {
  const { apiClient, queryClient } = useAppRuntime();
  const navigate = useNavigate();
  const connectivity = useConnectivityState();
  const { getLeaveState } = useLeaveGuard();
  const [searchOpen, setSearchOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [crossProject, setCrossProject] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<readonly string[]>([]);
  const [searchResult, setSearchResult] = useState<GlobalSearchResultView | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setCrossProject(false);
    setSelectedProjectIds([]);
    setSearchResult(null);
  };
  const searchDialog = useAccessibleDialog({
    open: searchOpen,
    onClose: closeSearch,
  });
  const paletteDialog = useAccessibleDialog({
    open: paletteOpen,
    onClose: () => setPaletteOpen(false),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.isComposing &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        const active =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        paletteDialog.captureInvoker(active);
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteDialog]);

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

  const projectSwitch = useMutation({
    mutationFn: (projectId: string) => apiClient.switchActiveProject(projectId),
    onSuccess: async (nextSession) => {
      await purgeProjectScopedCaches(queryClient);
      queryClient.setQueryData(productSessionQueryKey, nextSession);
      queryClient.setQueryData(sessionBoundaryQueryKey, (current: unknown) =>
        typeof current === 'object' && current !== null
          ? { ...current, session: nextSession }
          : current,
      );
      setPaletteOpen(false);
      navigate('/');
    },
  });

  const openSearch = (invoker: HTMLButtonElement) => {
    searchDialog.captureInvoker(invoker);
    setSearchResult(null);
    setSearchOpen(true);
  };
  const openPalette = (invoker: HTMLButtonElement) => {
    paletteDialog.captureInvoker(invoker);
    setPaletteOpen(true);
  };
  const searchAvailable =
    shell.features.find((feature) => feature.id === 'global-search')?.availability ===
      'AVAILABLE' && !connectivity.isOffline;
  const crossProjectAvailable =
    shell.features.find((feature) => feature.id === 'cross-project-search')?.availability ===
    'AVAILABLE';
  const validSearchScope =
    !crossProject || (crossProjectAvailable && selectedProjectIds.length > 0);

  return (
    <div className="global-tools">
      <button
        type="button"
        disabled={!searchAvailable}
        onClick={(event) => openSearch(event.currentTarget)}
      >
        Search
      </button>
      <button
        type="button"
        onClick={(event) => openPalette(event.currentTarget)}
        aria-keyshortcuts="Control+K Meta+K"
      >
        Commands
      </button>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {searchOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="global-search-title"
          ref={searchDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={searchDialog.onDialogKeyDown}
        >
          <div className="modal-card">
            <h2 id="global-search-title">Search</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim() && validSearchScope) search.mutate();
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
                  disabled={search.isPending || !query.trim() || !validSearchScope}
                >
                  {search.isPending ? 'Searching…' : 'Search'}
                </button>
                <button type="button" onClick={closeSearch}>
                  Close
                </button>
              </div>
            </form>
            {search.error ? <p role="alert">{safeErrorMessage(search.error)}</p> : null}
            {searchResult ? (
              <ul className="search-results">
                {searchResult.results.map((result) => (
                  <li key={result.stableId}>
                    <Link to={result.targetRoute.href} onClick={closeSearch}>
                      {result.label} · {result.projectLabel}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {paletteOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-palette-title"
          ref={paletteDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={paletteDialog.onDialogKeyDown}
        >
          <div className="modal-card">
            <h2 id="command-palette-title">Command palette</h2>
            <p>Navigation and server-confirmed Project switching only.</p>
            <ul className="command-list">
              {shell.navigation
                .filter((item) => item.availability === 'AVAILABLE')
                .map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        navigate(item.targetRoute!.href);
                      }}
                    >
                      Go to {item.label}
                    </button>
                  </li>
                ))}
              {shell.accessibleProjects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    disabled={
                      project.id === shell.activeProject?.id ||
                      connectivity.isOffline ||
                      projectSwitch.isPending
                    }
                    onClick={() => {
                      const leaveState = getLeaveState();
                      if (
                        !leaveState.canLeaveCurrentContext ||
                        leaveState.hasBlockingDialog ||
                        leaveState.hasUnsavedDraft
                      ) {
                        setAnnouncement('Resolve the current Workspace before switching Projects.');
                        return;
                      }
                      if (leaveState.hasOutcomeUnknownCommand) {
                        setAnnouncement(
                          'The unknown command will not be retried during the Project switch.',
                        );
                      }
                      projectSwitch.mutate(project.id);
                    }}
                  >
                    Switch to {project.label}
                  </button>
                </li>
              ))}
            </ul>
            {projectSwitch.error ? (
              <p role="alert">{safeErrorMessage(projectSwitch.error)}</p>
            ) : null}
            <button type="button" onClick={() => setPaletteOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
