import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useLocation } from 'react-router';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import type { OwnerCommandController } from '../section3/global-tools.js';

const aiSettingsQueryKey = (projectId: string) => ['settings', 'ai', projectId] as const;

const breadcrumbForPath = (pathname: string): string => {
  if (pathname === '/') return 'Home';
  if (pathname === '/sources') return 'Sources / Library';
  if (pathname.startsWith('/sources/')) return 'Sources / Source';
  if (pathname === '/ask' || pathname.startsWith('/ask/')) return 'Ask / Conversations';
  if (pathname === '/knowledge' || pathname.startsWith('/knowledge/')) return 'Knowledge';
  if (pathname === '/review') return 'Operations / Review';
  if (pathname === '/external-action') return 'Operations / External Actions';
  if (pathname === '/activity') return 'Operations / Activity';
  if (pathname === '/history') return 'Operations / History';
  if (pathname === '/settings') return 'Settings';
  if (pathname === '/settings/ai' || pathname.startsWith('/settings/ai/')) return 'Settings / AI';
  if (pathname === '/settings/privacy' || pathname.startsWith('/settings/privacy/'))
    return 'Settings / Privacy';
  if (pathname === '/settings/preferences' || pathname.startsWith('/settings/preferences/'))
    return 'Settings / Preferences';
  if (pathname === '/settings/projects' || pathname.startsWith('/settings/projects/'))
    return 'Settings / Project';
  if (pathname.startsWith('/settings/')) return 'Settings';
  return 'Home';
};

const effectiveAIConfiguration = (
  settings:
    Awaited<ReturnType<ReturnType<typeof useAppRuntime>['apiClient']['getAISettings']>> | undefined,
) => {
  if (!settings || settings.mode !== 'PROJECT_MANAGED' || !settings.currentConfiguration) {
    return null;
  }

  const provider = settings.providers?.find(
    (candidate) => candidate.providerId === settings.currentConfiguration?.activeProviderId,
  );
  const model = provider?.models?.find(
    (candidate) => candidate.modelId === settings.currentConfiguration?.activeModelId,
  );
  return provider && model ? `${provider.displayName} / ${model.displayName}` : null;
};

export const InstrumentPanel = ({
  shell,
  controller,
}: {
  readonly shell: GlobalShellView;
  readonly controller: OwnerCommandController;
}) => {
  const { apiClient } = useAppRuntime();
  const location = useLocation();
  const projectId = shell.activeProject?.id ?? '';
  const settingsQuery = useQuery({
    queryKey: aiSettingsQueryKey(projectId),
    queryFn: ({ signal }) => apiClient.getAISettings(projectId, { signal }),
    enabled: Boolean(projectId),
  });
  const projectSwitchCommands = useMemo(
    () =>
      controller.commands.filter(
        (command) => command.id === 'project.switch' && command.action.kind === 'SWITCH_PROJECT',
      ),
    [controller.commands],
  );
  const aiConfiguration = effectiveAIConfiguration(settingsQuery.data);
  const breadcrumb = breadcrumbForPath(location.pathname);

  return (
    <header className="instrument-panel">
      <p className="instrument-panel__identity" aria-label="Shotgun">
        Shotgun
      </p>
      <label className="instrument-panel__project">
        <span className="visually-hidden">Current project</span>
        <select
          aria-label="Current project"
          className="instrument-panel__project-selector"
          value={shell.activeProject?.id ?? ''}
          disabled={!shell.activeProject || projectSwitchCommands.length === 0}
          onChange={(event) => {
            const command = projectSwitchCommands.find(
              (candidate) =>
                candidate.action.kind === 'SWITCH_PROJECT' &&
                candidate.action.projectId === event.currentTarget.value,
            );
            if (command) controller.executeCommand(command, event.currentTarget);
          }}
        >
          {shell.activeProject ? (
            <option value={shell.activeProject.id}>{shell.activeProject.label}</option>
          ) : (
            <option value="">No Project</option>
          )}
          {projectSwitchCommands.map((command) =>
            command.action.kind === 'SWITCH_PROJECT' ? (
              <option
                key={command.action.projectId}
                value={command.action.projectId}
                disabled={command.availability !== 'AVAILABLE'}
              >
                {command.label.replace(/^Switch to /, '')}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <p className="project-summary visually-hidden">
        {shell.activeProject?.label ?? 'No Project'}
      </p>
      <p className="instrument-panel__breadcrumb" aria-label="Workspace breadcrumb">
        {breadcrumb}
      </p>
      {aiConfiguration ? (
        <p className="instrument-panel__ai" aria-label="Configured AI provider and model">
          {aiConfiguration} <span>Configured</span>
        </p>
      ) : null}
    </header>
  );
};
