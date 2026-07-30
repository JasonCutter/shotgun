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
import { PlaceholderPage } from '../routes/placeholder-page.js';
import { SettingsLayout } from '../routes/settings/settings-layout.js';
import { CategoryIndexView } from '../routes/settings/category-index-view.js';
import { PreferencesWorkspace } from '../routes/settings/preferences-workspace.js';
import { ProjectsWorkspace } from '../routes/settings/projects-workspace.js';
import { ProjectDetailsWorkspace } from '../routes/settings/project-details-workspace.js';
import { ModelsWorkspace } from '../routes/settings/models-workspace.js';
import { CostsWorkspace } from '../routes/settings/costs-workspace.js';
import { PrivacyWorkspace } from '../routes/settings/privacy-workspace.js';
import { ConnectorsWorkspace } from '../routes/settings/connectors-workspace.js';
import { DirectivesWorkspace } from '../routes/settings/directives-workspace.js';
import { SchemaWorkspace } from '../routes/settings/schema-workspace.js';
import { DiagnosticsWorkspace } from '../routes/settings/diagnostics-workspace.js';
import { AdvancedWorkspace } from '../routes/settings/advanced-workspace.js';
import { SourcesWorkspace } from '../routes/sources-workspace.js';
import { SourceDetailWorkspace } from '../routes/source-detail-workspace.js';
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

export const createAppRouter = (runtime: AppRuntime) =>
  createBrowserRouter([
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
        },
        {
          path: 'sources/:sourceId',
          loader: guardedRouteLoader(runtime, { routeId: 'sources', href: '/sources' }),
          element: <SourceDetailWorkspace />,
        },
        {
          path: 'ask',
          loader: guardedRouteLoader(runtime, { routeId: 'ask', href: '/ask' }),
          element: <PlaceholderPage heading="Ask" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'knowledge',
          loader: guardedRouteLoader(runtime, {
            routeId: 'knowledge',
            href: '/knowledge',
          }),
          element: <PlaceholderPage heading="Knowledge" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'review',
          loader: guardedRouteLoader(runtime, { routeId: 'review', href: '/review' }),
          element: <PlaceholderPage heading="Review" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'activity',
          loader: () => {
            throw new Error('Activity is not a registered Section 3 route.');
          },
          element: <PlaceholderPage heading="Activity" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'history',
          loader: () => {
            throw new Error('History is not a registered Section 3 route.');
          },
          element: <PlaceholderPage heading="History" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'settings',
          loader: guardedRouteLoader(runtime, { routeId: 'settings', href: '/settings' }),
          element: <SettingsLayout />,
          children: [
            { index: true, element: <CategoryIndexView /> },
            { path: 'preferences', element: <PreferencesWorkspace /> },
            {
              path: 'projects',
              loader: guardedRouteLoader(runtime, {
                routeId: 'settings-projects',
                href: '/settings/projects',
              }),
              element: <ProjectsWorkspace />,
            },
            {
              path: 'projects/:projectId',
              loader: guardedRouteLoader(runtime, {
                routeId: 'settings-projects',
                href: '/settings/projects',
              }),
              element: <ProjectDetailsWorkspace />,
            },
            { path: 'models', element: <ModelsWorkspace /> },
            { path: 'costs', element: <CostsWorkspace /> },
            { path: 'privacy', element: <PrivacyWorkspace /> },
            { path: 'connectors', element: <ConnectorsWorkspace /> },
            { path: 'directives', element: <DirectivesWorkspace /> },
            { path: 'schema', element: <SchemaWorkspace /> },
            { path: 'diagnostics', element: <DiagnosticsWorkspace /> },
            { path: 'advanced', element: <AdvancedWorkspace /> },
          ],
        },
      ],
    },
  ]);
