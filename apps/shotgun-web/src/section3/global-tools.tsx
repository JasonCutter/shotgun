import { useMutation, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import {
  productSessionQueryKey,
  projectAdminQueryKey,
  purgeProjectScopedCaches,
  sessionBoundaryQueryKey,
} from '../app/query-keys.js';
import {
  type AnswerCommandContext,
  useOptionalAnswerCommandContext,
} from '../commands/answer-command-context.js';
import { AICommandSurface } from '../commands/ai-command-surface.js';
import {
  createOwnerCommandRegistry,
  type AICommandId,
  type OwnerCommandDefinition,
  type PreferenceCommandId,
  type PrivacyCommandId,
  type ProjectCommandId,
} from '../commands/owner-command-registry.js';
import { useOptionalDiscoveryCommandContext } from '../commands/discovery-command-context.js';
import { PreferencesCommandSurface } from '../commands/preferences-command-surface.js';
import { PrivacyCommandSurface } from '../commands/privacy-command-surface.js';
import { ProjectCommandSurface } from '../commands/project-command-surface.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useOptionalTechnicalInspection } from '../components/technical-inspection-context.js';
import { useProductLocalization } from '../localization/product-localization.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';
import { TechnicalCommandSurface } from '../commands/technical-command-surface.js';
import { GlobalSearchDialog } from './global-search-dialog.js';

export type OwnerCommandController = {
  readonly commands: readonly OwnerCommandDefinition[];
  readonly executeCommand: (command: OwnerCommandDefinition, invoker?: HTMLElement | null) => void;
  readonly commandMode?: {
    readonly open: boolean;
    readonly initialQuery: string;
    readonly resetQuerySignal: number;
    readonly invoker: HTMLElement | null;
  };
  readonly openCommandMode?: (
    initialQuery?: string,
    invoker?: HTMLElement | null,
    answerContext?: AnswerCommandContext,
  ) => void;
  readonly closeCommandMode?: () => void;
};

const OwnerCommandControllerContext = createContext<OwnerCommandController | null>(null);

export const OwnerCommandControllerProvider = ({
  controller,
  children,
}: {
  readonly controller: OwnerCommandController;
  readonly children: ReactNode;
}) => (
  <OwnerCommandControllerContext.Provider value={controller}>
    {children}
  </OwnerCommandControllerContext.Provider>
);

export const useOwnerCommandController = (): OwnerCommandController | null =>
  useContext(OwnerCommandControllerContext);

type GlobalToolsProps = {
  readonly shell: GlobalShellView;
  readonly children?: (controller: OwnerCommandController) => ReactNode;
};

export const GlobalTools = ({ shell, children }: GlobalToolsProps) => {
  const { apiClient, queryClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const navigate = useNavigate();
  const connectivity = useConnectivityState();
  const { getLeaveState } = useLeaveGuard();
  const technicalInspection = useOptionalTechnicalInspection();
  const answerCommands = useOptionalAnswerCommandContext();
  const discoveryCommands = useOptionalDiscoveryCommandContext();
  const answerRegistration = answerCommands?.registration;
  const technicalBlocks = technicalInspection?.blocks ?? [];
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInvoker, setSearchInvoker] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInvoker, setPaletteInvoker] = useState<HTMLElement | null>(null);
  const [paletteResetSignal, setPaletteResetSignal] = useState(0);
  const [paletteInitialQuery, setPaletteInitialQuery] = useState('');
  const [paletteAnswerContext, setPaletteAnswerContext] = useState<AnswerCommandContext>();
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
        answerContext: paletteAnswerContext ?? answerRegistration?.context,
        answerCommandPending: answerRegistration?.commandPending,
        discoveryContext: discoveryCommands?.registration?.context,
        discoveryCommandPending: discoveryCommands?.registration?.commandPending,
        projects: projectsQuery.data,
      }),
    [
      answerRegistration,
      connectivity.isOffline,
      discoveryCommands,
      paletteAnswerContext,
      projectsQuery.data,
      shell,
      technicalBlocks.length,
    ],
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
        setPaletteInitialQuery('');
        setPaletteAnswerContext(undefined);
        setPaletteResetSignal((current) => current + 1);
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      await queryClient.invalidateQueries({ queryKey: ['protected'] });
      await queryClient.invalidateQueries({ queryKey: ['project'] });
      setPaletteOpen(false);
      setPaletteAnswerContext(undefined);
      navigate('/');
    },
  });

  const openSearch = (invoker: HTMLElement | null) => {
    setSearchInvoker(invoker);
    setSearchOpen(true);
  };

  const closeCommandMode = () => {
    setPaletteOpen(false);
    setPaletteAnswerContext(undefined);
  };

  const openCommandMode = (
    initialQuery = '',
    invoker: HTMLElement | null = null,
    answerContext?: AnswerCommandContext,
  ) => {
    setPaletteInvoker(invoker);
    setPaletteInitialQuery(initialQuery);
    setPaletteAnswerContext(answerContext);
    setPaletteResetSignal((current) => current + 1);
    setPaletteOpen(true);
  };

  const handleCommand = (command: OwnerCommandDefinition, invoker: HTMLElement | null = null) => {
    const commandInvoker = invoker ?? paletteInvoker;
    if (command.action.kind === 'OPEN_COMMANDS') {
      openCommandMode('', commandInvoker);
      return;
    }
    if (command.action.kind === 'OPEN_PROJECT_FLOW') {
      setProjectCommandInvoker(commandInvoker);
      setProjectCommand(command.action.commandId);
      closeCommandMode();
      return;
    }
    if (command.action.kind === 'OPEN_PREFERENCE_FLOW') {
      setPreferenceCommandInvoker(commandInvoker);
      setPreferenceCommand(command.action.commandId);
      closeCommandMode();
      return;
    }
    if (command.action.kind === 'OPEN_AI_FLOW') {
      setAICommandInvoker(commandInvoker);
      setAICommand(command.action.commandId);
      closeCommandMode();
      return;
    }
    if (command.action.kind === 'OPEN_PRIVACY_FLOW') {
      setPrivacyCommandInvoker(commandInvoker);
      setPrivacyCommand(command.action.commandId);
      closeCommandMode();
      return;
    }
    if (command.action.kind === 'OPEN_TECHNICAL_FLOW') {
      setTechnicalInvoker(commandInvoker);
      setTechnicalOpen(true);
      closeCommandMode();
      return;
    }
    if (command.action.kind === 'OPEN_ANSWER_FLOW') {
      if (paletteAnswerContext && answerRegistration?.openCommandForContext) {
        answerRegistration.openCommandForContext(
          paletteAnswerContext,
          command.action.commandId,
          commandInvoker,
        );
      } else {
        answerRegistration?.openCommand(command.action.commandId, commandInvoker);
      }
      closeCommandMode();
      return;
    }
    if (command.action.kind === 'OPEN_DISCOVERY_FLOW') {
      closeCommandMode();
      discoveryCommands?.registration?.openCommand(command.action.commandId, commandInvoker);
      return;
    }
    if (command.action.kind === 'DISMISS_DISCOVERY') {
      closeCommandMode();
      discoveryCommands?.registration?.dismiss(commandInvoker);
      return;
    }
    if (command.action.kind === 'NAVIGATE') {
      closeCommandMode();
      navigate(command.action.targetRoute.href);
      return;
    }
    if (command.action.kind === 'NAVIGATE_PATH') {
      closeCommandMode();
      navigate(command.action.href);
      return;
    }
    if (command.action.kind === 'OPEN_SEARCH') {
      closeCommandMode();
      openSearch(commandInvoker);
      return;
    }

    const leaveState = getLeaveState();
    if (
      !leaveState.canLeaveCurrentContext ||
      leaveState.hasBlockingDialog ||
      leaveState.hasUnsavedDraft
    ) {
      setAnnouncement(t('global.switch.resolve_workspace'));
      return;
    }
    if (leaveState.hasOutcomeUnknownCommand) {
      setAnnouncement(t('global.switch.unknown_not_retried'));
    }
    projectSwitch.mutate(command.action.projectId);
  };

  const controller: OwnerCommandController = {
    commands: commandRegistry,
    executeCommand: handleCommand,
    commandMode: {
      open: paletteOpen,
      initialQuery: paletteInitialQuery,
      resetQuerySignal: paletteResetSignal,
      invoker: paletteInvoker,
    },
    openCommandMode,
    closeCommandMode,
  };

  return (
    <>
      {children?.(controller)}
      <div className="global-tools">
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
    </>
  );
};
