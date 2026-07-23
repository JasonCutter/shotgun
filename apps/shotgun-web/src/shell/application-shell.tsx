import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router';

import { useAppRuntime } from '../app/providers.js';
import { RouteFocus } from '../app/route-focus.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { SkipLink } from '../components/skip-link.js';
import { sessionQueryOptions } from '../session/session-query.js';
import { PrimaryNavigation } from './primary-navigation.js';
import { TopBar } from './top-bar.js';

export const ApplicationShell = () => {
  const { apiClient } = useAppRuntime();
  const session = useQuery(sessionQueryOptions(apiClient));
  if (session.isPending) return <LoadingState message="Session 확인 중" />;
  if (session.error) return <ErrorState error={session.error} />;

  return (
    <div className="application-shell">
      <SkipLink />
      <TopBar session={session.data} />
      <div className="workspace-layout">
        <PrimaryNavigation />
        <main id="main-content" tabIndex={-1}>
          <RouteFocus />
          <Outlet />
        </main>
      </div>
    </div>
  );
};
