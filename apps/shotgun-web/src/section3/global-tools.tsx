import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { safeErrorMessage } from '../components/error-state.js';
import {
  productSessionQueryKey,
  projectAdminQueryKey,
  purgeProjectScopedCaches,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import { AICommandSurface } from '../commands/ai-command-surface.js';
import { PrivacyCommandSurface } from '../commands/privacy-command-surface.js';
import { PreferencesCommandSurface } from '../commands/preferences-command-surface.js';
import { TechnicalCommandSurface } from '../commands/technical-command-surface.js';
import {
  createOwnerCommandRegistry,
  type AICommandId,
  type OwnerCommandDefinition,
  type PreferenceCommandId,
  type PrivacyCommandId,
  type ProjectCommandId,
} from '../commands/owner-command-registry.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { useOptionalTechnicalInspection } from '../components/technical-inspection-context.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';
import { ProjectCommandSurface } from '../commands/project-command-surface.js';
import { GlobalSearchDialog } from './global-search-dialog.js';

export const GlobalTools = ({ shell }: { readonly shell: GlobalShellView }) => {
  const { apiClient, queryClient } = useAppRuntime();
  const navigate = useNavigate();
  const connectivity = useConnectivityState();
  const { getLeaveState } = useLeaveGuard();
  const technicalInspection = useOptionalTechnicalInspection();
  const technicalBlocks = technicalInspection?.blocks ?? [];
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInvoker, setSearchInvoker] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInvoker, setPaletteInvoker] = useState<HTMLElement | null>(null);
  const [paletteResetSignal, setPaletteResetSignal] = useState(0);
  const [projectCommand, setProjectCommand] = useState<ProjectCommandId | null>(null);
  const [projectCommandInvoker, setProjectCommandInvoker] = useState<HTMLElement | null>(null);
  const [preferenceCommand, setPreferenceCommand] = useState<PreferenceCommandId | null>(null);
  const [preferenceCommandInvoker, setPreferenceCommandInvoker] = useState<HTMLElement | null>(
    null,
  );
  const [aiCommand, setAICommand] = useState<AICommandId | null>(null);
  const [aiCommandInvoker, setAICommandInvoker] = useState<HTMLElement | null>(null);
  const [privacyCommand, setPrivacyCommand] = useState<PrivacyCommandId | null>(null);
  const [privacyCommandInvoker, setPrivacyCommandInvoker] = useState<HTMLElement | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [technicalInvoker, setTechnicalInvoker] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const projectsQuery = useQuery({
    queryKey: projectAdminQueryKey(shell.principalId),
    queryFn: () => apiClient.getProjects(),
  });
  const commandRegistry = useMemo(
    () =>
      createOwnerCommandRegistry({
        shell,
        isOffline: connectivity.isOffline,
        includeProjectSwitch: true,
        includeSearch: true,
        hasTechnicalInspection: technicalBlocks.length > 0,
        projects: projectsQuery.data,
      }),
    [connectivity.isOffline, projectsQuery.data, shell, technicalBlocks.length],
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
    if (command.action.kind === 'OPEN_COMMANDS') {
      setPaletteResetSignal((current) => current + 1);
      setPaletteOpen(true);
      return;
    }
    if (command.action.kind === 'OPEN_PROJECT_FLOW') {
      setProjectCommandInvoker(paletteInvoker);
      setProjectCommand(command.action.commandId);
      setPaletteOpen(false);
      return;
    }
    if (command.action.kind === 'OPEN_PREFERENCE_FLOW') {
      setPreferenceCommandInvoker(paletteInvoker);
      setPreferenceCommand(command.action.commandId);
      setPaletteOpen(false);
      return;
    }
    if (command.action.kind === 'OPEN_AI_FLOW') {
      setAICommandInvoker(paletteInvoker);
      setAICommand(command.action.commandId);
      setPaletteOpen(false);
      return;
    }
    if (command.action.kind === 'OPEN_PRIVACY_FLOW') {
      setPrivacyCommandInvoker(paletteInvoker);
      setPrivacyCommand(command.action.commandId);
      setPaletteOpen(false);
      return;
    }
    if (command.action.kind === 'OPEN_TECHNICAL_FLOW') {
      setTechnicalInvoker(paletteInvoker);
      setTechnicalOpen(true);
      setPaletteOpen(false);
      return;
    }
    setPaletteOpen(false);
    if (command.action.kind === 'NAVIGATE') {
      navigate(command.action.targetRoute.href);
      return;
    }
    if (command.action.kind === 'NAVIGATE_PATH') {
      navigate(command.action.href);
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
      {projectSwitch.error ? <p role="alert">{safeErrorMessage(projectSwitch.error)}</p> : null}

      <GlobalSearchDialog
        shell={shell}
        open={searchOpen}
        invoker={searchInvoker}
        onClose={() => setSearchOpen(false)}
      />
      <OwnerCommandPalette
        open={paletteOpen}
        commands={commandRegistry}
        resetQuerySignal={paletteResetSignal}
        invoker={paletteInvoker}
        onClose={() => setPaletteOpen(false)}
        onSelect={handleCommand}
      />
      <ProjectCommandSurface
        open={projectCommand !== null}
        commandId={projectCommand}
        shell={shell}
        invoker={projectCommandInvoker}
        onClose={() => setProjectCommand(null)}
      />
      <PreferencesCommandSurface
        open={preferenceCommand !== null}
        commandId={preferenceCommand}
        shell={shell}
        invoker={preferenceCommandInvoker}
        onClose={() => setPreferenceCommand(null)}
      />
      <AICommandSurface
        open={aiCommand !== null}
        commandId={aiCommand}
        shell={shell}
        invoker={aiCommandInvoker}
        onClose={() => setAICommand(null)}
      />
      <PrivacyCommandSurface
        open={privacyCommand !== null}
        commandId={privacyCommand}
        shell={shell}
        invoker={privacyCommandInvoker}
        onClose={() => setPrivacyCommand(null)}
      />
      <TechnicalCommandSurface
        open={technicalOpen}
        blocks={technicalBlocks}
        invoker={technicalInvoker}
        onClose={() => setTechnicalOpen(false)}
      />
    </div>
  );
};
