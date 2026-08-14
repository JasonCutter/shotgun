import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import {
  productSessionQueryKey,
  purgeProjectScopedCaches,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import {
  createOwnerCommandRegistry,
  type OwnerCommandDefinition,
} from '../commands/owner-command-registry.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';
import { GlobalSearchDialog } from './global-search-dialog.js';

export const GlobalTools = ({ shell }: { readonly shell: GlobalShellView }) => {
  const { apiClient, queryClient } = useAppRuntime();
  const navigate = useNavigate();
  const connectivity = useConnectivityState();
  const { getLeaveState } = useLeaveGuard();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInvoker, setSearchInvoker] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInvoker, setPaletteInvoker] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const commandRegistry = useMemo(
    () =>
      createOwnerCommandRegistry({
        shell,
        isOffline: connectivity.isOffline,
        includeProjectSwitch: true,
        includeSearch: true,
      }),
    [connectivity.isOffline, shell],
  );

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
        setPaletteInvoker(active);
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchAvailable =
    shell.features.find((feature) => feature.id === 'global-search')?.availability ===
      'AVAILABLE' && !connectivity.isOffline;

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

  const openSearch = (invoker: HTMLElement | null) => {
    setSearchInvoker(invoker);
    setSearchOpen(true);
  };

  const handleCommand = (command: OwnerCommandDefinition) => {
    setPaletteOpen(false);
    if (command.action.kind === 'NAVIGATE') {
      navigate(command.action.targetRoute.href);
      return;
    }
    if (command.action.kind === 'OPEN_SEARCH') {
      openSearch(paletteInvoker);
      return;
    }

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
      setAnnouncement('The unknown command will not be retried during the Project switch.');
    }
    projectSwitch.mutate(command.action.projectId);
  };

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
        onClick={(event) => {
          setPaletteInvoker(event.currentTarget);
          setPaletteOpen(true);
        }}
        aria-keyshortcuts="Control+K Meta+K"
      >
        Commands
      </button>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <GlobalSearchDialog
        shell={shell}
        open={searchOpen}
        invoker={searchInvoker}
        onClose={() => setSearchOpen(false)}
      />
      <OwnerCommandPalette
        open={paletteOpen}
        commands={commandRegistry}
        invoker={paletteInvoker}
        onClose={() => setPaletteOpen(false)}
        onSelect={handleCommand}
      />
    </div>
  );
};
