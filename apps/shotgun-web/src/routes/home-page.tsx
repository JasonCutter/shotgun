import { useQuery } from '@tanstack/react-query';

import { useAppRuntime } from '../app/providers.js';
import { sessionQueryOptions } from '../session/session-query.js';

export const HomePage = () => {
  const { apiClient } = useAppRuntime();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  if (!session) return null;
  return (
    <section className="route-page">
      <p className="eyebrow">Application foundation</p>
      <h1 tabIndex={-1}>Home</h1>
      <dl className="identity-summary">
        <div>
          <dt>Principal</dt>
          <dd>{session.principal.id}</dd>
        </div>
        <div>
          <dt>Active Project</dt>
          <dd>{session.activeProject.id}</dd>
        </div>
      </dl>
      <p>Session, Project Context와 Routing 기반이 서버 권위 계약에 연결되었습니다.</p>
    </section>
  );
};
