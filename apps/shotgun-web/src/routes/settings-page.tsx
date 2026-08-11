import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ProjectSelector } from '../session/project-selector.js';
import { sessionQueryOptions } from '../session/session-query.js';

export const SettingsPage = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  if (!session) return null;
  return (
    <section className="route-page settings-page">
      <p className="eyebrow">Session settings</p>
      <h1 tabIndex={-1}>Settings</h1>
      <p>Current project: {shell.activeProject?.label ?? 'Not created'}</p>
      <section aria-labelledby="project-settings-heading">
        <h2 id="project-settings-heading">Project</h2>
        <ProjectSelector session={session} shell={shell} />
      </section>
    </section>
  );
};
