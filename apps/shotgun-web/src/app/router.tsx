import {
  createBrowserRouter,
  useRouteError,
  useRevalidator,
  type LoaderFunctionArgs,
} from 'react-router';

import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { ApplicationShell } from '../shell/application-shell.js';
import { HomePage } from '../routes/home-page.js';
import { SettingsLayout } from '../routes/settings/settings-layout.js';
import { CategoryIndexView } from '../routes/settings/category-index-view.js';
import { AIWorkspace } from '../routes/settings/ai-workspace.js';
import { PrivacyWorkspace } from '../routes/settings/privacy-workspace.js';
import { PreferencesWorkspace } from '../routes/settings/preferences-workspace.js';
import { ProjectsWorkspace } from '../routes/settings/projects-workspace.js';
import { SourcesWorkspace } from '../routes/sources-workspace.js';
import { SourceDetailWorkspace } from '../routes/source-detail-workspace.js';
import { AskWorkspace } from '../routes/ask-workspace.js';
import { KnowledgeWorkspace } from '../routes/knowledge-workspace.js';
import { KnowledgeDetailWorkspace } from '../routes/knowledge-detail-workspace.js';
import { KnowledgeCompareWorkspace } from '../routes/knowledge-compare-workspace.js';
import {
  DiscoveryDetailWorkspace,
  DiscoveryInboxWorkspace,
} from '../routes/discovery-workspace.js';
import { GraphWorkspace } from '../routes/graph-workspace.js';
import { ReviewWorkspace } from '../routes/review-workspace.js';
import { ExternalActionWorkspace } from '../routes/external-action-workspace.js';
import { ActivityWorkspace } from '../routes/activity-workspace.js';
import { HistoryWorkspace } from '../routes/history-workspace.js';
import type { AppRuntime } from './providers.js';
import { ensureSessionBoundary, sessionBoundaryQueryOptions } from '../session/session-query.js';
import type { TargetRouteView } from '@shotgun/api-client';

const RouteError = () => {
  const error = useRouteError();
  const revalidator = useRevalidator();
  return <ErrorState error={error} onRetry={() => revalidator.revalidate()} />;
};

const sessionLoader =
  (runtime: AppRuntime) =>
  async ({ request }: LoaderFunctionArgs) => {
    const opts = sessionBoundaryQueryOptions(
      runtime.apiClient,
      runtime.queryClient,
      runtime.sessionCycleState,
    );
    return await runtime.queryClient.fetchQuery({
      ...opts,
      queryFn: ({ signal }) =>
        ensureSessionBoundary(
          runtime.apiClient,
          request.signal ?? signal,
          runtime.queryClient,
          runtime.sessionCycleState,
        ),
    });
  };

const guardedRouteLoader =
  (runtime: AppRuntime, targetRoute: TargetRouteView) =>
  async ({ params, request }: LoaderFunctionArgs) => {
    const sessionOptions = sessionBoundaryQueryOptions(
      runtime.apiClient,
      runtime.queryClient,
      runtime.sessionCycleState,
    );
    const boundary = await runtime.queryClient.fetchQuery({
      ...sessionOptions,
      queryFn: ({ signal }) =>
        ensureSessionBoundary(
          runtime.apiClient,
          request.signal ?? signal,
          runtime.queryClient,
          runtime.sessionCycleState,
        ),
    });
    if (boundary.sessionState !== 'READY' || !boundary.session) {
      throw new Error('A ready Session is required before route authorization.');
    }
    const url = new URL(request.url);
    const resourceProjectId =
      params.projectId ?? url.searchParams.get('resourceProjectId') ?? undefined;
    const decision = await runtime.apiClient.getRouteGuardDecision(targetRoute, resourceProjectId, {
      signal: request.signal,
    });
    if (decision.decision !== 'ALLOW') {
      throw new Error(decision.message);
    }
    return decision;
  };

export const createAppRouteObjects = (runtime: AppRuntime) => [
  {
    path: '/',
    loader: sessionLoader(runtime),
    element: <ApplicationShell />,
    hydrateFallbackElement: <LoadingState message="Session 확인 중" />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'sources',
        loader: guardedRouteLoader(runtime, { routeId: 'sources', href: '/sources' }),
        element: <SourcesWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'sources/:sourceId',
        loader: guardedRouteLoader(runtime, { routeId: 'sources', href: '/sources' }),
        element: <SourceDetailWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'ask',
        loader: guardedRouteLoader(runtime, { routeId: 'ask', href: '/ask' }),
        element: <AskWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'ask/conversations/:conversationId',
        loader: guardedRouteLoader(runtime, { routeId: 'ask', href: '/ask' }),
        element: <AskWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'knowledge',
        loader: guardedRouteLoader(runtime, {
          routeId: 'knowledge',
          href: '/knowledge',
        }),
        element: <KnowledgeWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'knowledge/compare',
        loader: guardedRouteLoader(runtime, {
          routeId: 'knowledge',
          href: '/knowledge',
        }),
        element: <KnowledgeCompareWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'knowledge/graph',
        loader: guardedRouteLoader(runtime, {
          routeId: 'knowledge',
          href: '/knowledge',
        }),
        element: <GraphWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'knowledge/discoveries',
        loader: guardedRouteLoader(runtime, {
          routeId: 'knowledge',
          href: '/knowledge',
        }),
        element: <DiscoveryInboxWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'knowledge/discoveries/:findingId',
        loader: guardedRouteLoader(runtime, {
          routeId: 'knowledge',
          href: '/knowledge',
        }),
        element: <DiscoveryDetailWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'knowledge/:resourceId',
        loader: guardedRouteLoader(runtime, {
          routeId: 'knowledge',
          href: '/knowledge',
        }),
        element: <KnowledgeDetailWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'review',
        loader: guardedRouteLoader(runtime, { routeId: 'review', href: '/review' }),
        element: <ReviewWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'external-action',
        loader: guardedRouteLoader(runtime, {
          routeId: 'external-action',
          href: '/external-action',
        }),
        element: <ExternalActionWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'activity',
        loader: guardedRouteLoader(runtime, { routeId: 'activity', href: '/activity' }),
        element: <ActivityWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'history',
        loader: guardedRouteLoader(runtime, { routeId: 'history', href: '/history' }),
        element: <HistoryWorkspace />,
        errorElement: <RouteError />,
      },
      {
        path: 'settings',
        loader: guardedRouteLoader(runtime, {
          routeId: 'settings',
          href: '/settings',
        }),
        element: <SettingsLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <CategoryIndexView /> },
          { path: 'ai', element: <AIWorkspace /> },
          { path: 'privacy', element: <PrivacyWorkspace /> },
          { path: 'preferences', element: <PreferencesWorkspace /> },
          {
            path: 'projects',
            loader: guardedRouteLoader(runtime, {
              routeId: 'settings-projects',
              href: '/settings/projects',
            }),
            element: <ProjectsWorkspace />,
            errorElement: <RouteError />,
          },
        ],
      },
    ],
  },
];

export const createAppRouter = (runtime: AppRuntime) =>
  createBrowserRouter(createAppRouteObjects(runtime));
