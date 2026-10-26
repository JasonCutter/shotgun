import { useQuery } from '@tanstack/react-query';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { AnswerCommandContextProvider } from '../commands/answer-command-context.js';
import { DiscoveryCommandContextProvider } from '../commands/discovery-command-context.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { SkipLink } from '../components/skip-link.js';
import { TechnicalInspectionProvider } from '../components/technical-inspection-context.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { GlobalTools, OwnerCommandControllerProvider } from '../section3/global-tools.js';
import { globalShellQueryOptions } from '../section3/section3-queries.js';
import { AskShellProvider } from '../routes/ask-workspace.js';
import { SessionBoundaryScreen } from '../session/session-boundary-screen.js';
import { reconnectSessionBoundary, sessionBoundaryQueryOptions } from '../session/session-query.js';
import { ConversationShell } from './conversation-shell.js';
import { useConnectivityState } from './use-connectivity-state.js';

export const ApplicationShell = () => {
  const { apiClient, queryClient, sessionCycleState } = useAppRuntime();
  const connectivity = useConnectivityState();
  const boundaryQuery = useQuery(
    sessionBoundaryQueryOptions(apiClient, queryClient, sessionCycleState),
  );
  const readySession =
    boundaryQuery.data?.sessionState === 'READY' ? boundaryQuery.data.session : null;
  const shellQuery = useQuery(globalShellQueryOptions(apiClient, readySession));

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
            { id: 'RECONNECT' as const, label: 'Reconnect', enabled: true },
            {
              id: 'CHECK_LOCAL_SERVER' as const,
              label: 'Check local server status',
              enabled: true,
            },
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

  if (shellQuery.error) {
    return (
      <ErrorState
        error={shellQuery.error}
        onRetry={() => {
          void shellQuery.refetch();
        }}
      />
    );
  }
  if (shellQuery.isPending || !shellQuery.data) {
    return <LoadingState message="Loading Global Shell…" />;
  }
  const shell = shellQuery.data;

  return (
    <ProductLocalizationProvider principalId={shell.principalId}>
      <LocalizedApplicationShell shell={shell} offline={connectivity.isOffline} />
    </ProductLocalizationProvider>
  );
};

const LocalizedApplicationShell = ({
  shell,
  offline,
}: {
  readonly shell: GlobalShellView;
  readonly offline: boolean;
}) => {
  return (
    <AnswerCommandContextProvider>
      <DiscoveryCommandContextProvider>
        <TechnicalInspectionProvider>
          <GlobalTools shell={shell}>
            {(controller) => (
              <OwnerCommandControllerProvider controller={controller}>
                <AskShellProvider
                  key={`${shell.principalId}:${shell.sessionId}:${shell.activeProject?.id}:${shell.accessRevision}`}
                  shell={shell}
                >
                  <div className="application-shell">
                    <SkipLink />
                    <ConversationShell shell={shell} controller={controller} offline={offline} />
                  </div>
                </AskShellProvider>
              </OwnerCommandControllerProvider>
            )}
          </GlobalTools>
        </TechnicalInspectionProvider>
      </DiscoveryCommandContextProvider>
    </AnswerCommandContextProvider>
  );
};
