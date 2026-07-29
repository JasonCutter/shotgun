import { useQuery } from '@tanstack/react-query';

import { useAppRuntime } from '../app/providers.js';
import { ProjectSelector } from '../session/project-selector.js';
import { sessionQueryOptions } from '../session/session-query.js';

export const SettingsPage = () => {
  const { apiClient } = useAppRuntime();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  if (!session) return null;
  return (
    <section className="route-page settings-page">
      <p className="eyebrow">Session settings</p>
      <h1 tabIndex={-1}>Settings</h1>
      <dl className="identity-summary">
        <div>
          <dt>Principal</dt>
          <dd>{session.principal.id}</dd>
        </div>
        <div>
          <dt>Active Project</dt>
          <dd>{session.activeProject?.id ?? 'Not created'}</dd>
        </div>
      </dl>
      <section aria-labelledby="project-settings-heading">
        <h2 id="project-settings-heading">Project</h2>
        <ProjectSelector session={session} />
      </section>
    </section>
  );
};
