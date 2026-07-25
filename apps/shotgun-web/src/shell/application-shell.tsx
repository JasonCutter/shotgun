import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router';

import { useAppRuntime } from '../app/providers.js';
import { RouteFocus } from '../app/route-focus.js';
import { SkipLink } from '../components/skip-link.js';

import { SessionBoundaryScreen } from '../session/session-boundary-screen.js';
import { reconnectSessionBoundary, sessionBoundaryQueryOptions } from '../session/session-query.js';
import { PrimaryNavigation } from './primary-navigation.js';
import { TopBar } from './top-bar.js';
import { useConnectivityState } from './use-connectivity-state.js';

export const ApplicationShell = () => {
  const { apiClient, queryClient, sessionCycleState } = useAppRuntime();
  const connectivity = useConnectivityState();
  const boundaryQuery = useQuery(
    sessionBoundaryQueryOptions(apiClient, queryClient, sessionCycleState),
  );

  const connState =
    connectivity.connectivityState === 'OFFLINE' ? ('OFFLINE' as const) : ('ONLINE' as const);

  if (boundaryQuery.isPending) {
    return (
      <SessionBoundaryScreen
        boundary={{
          schemaVersion: '1.0.0',
          authenticationAdapter: 'local_owner',
          connectivityState: connState,
          authenticationState: 'authentication_unavailable',
          sessionState: 'ESTABLISHING',
          backendReadiness: 'UNKNOWN',
          reasonCode: 'LOCAL_SESSION_ESTABLISHING',
          recoveryActions: [],
          session: null,
        }}
      />
    );
  }

  const boundary = boundaryQuery.data;

  if (!boundary || boundary.sessionState !== 'READY' || !boundary.session) {
    const activeBoundary = boundary
      ? connectivity.isOffline
        ? { ...boundary, connectivityState: 'OFFLINE' as const }
        : boundary
      : {
          schemaVersion: '1.0.0' as const,
          authenticationAdapter: 'local_owner' as const,
          connectivityState: connState,
          authenticationState: 'authentication_unavailable' as const,
          sessionState: 'UNAVAILABLE' as const,
          backendReadiness: 'UNAVAILABLE' as const,
          reasonCode: 'LOCAL_SERVER_UNAVAILABLE' as const,
          recoveryActions: [
            { id: 'RECONNECT' as const, label: '다시 연결', enabled: true },
            { id: 'CHECK_LOCAL_SERVER' as const, label: '로컬 서버 상태 확인', enabled: true },
          ],
          session: null,
        };

    return (
      <SessionBoundaryScreen
        boundary={activeBoundary}
        onReconnect={() => {
          void reconnectSessionBoundary(apiClient, queryClient, sessionCycleState);
        }}
      />
    );
  }

  return (
    <div className="application-shell">
      <SkipLink />
      <TopBar session={boundary.session} />
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
