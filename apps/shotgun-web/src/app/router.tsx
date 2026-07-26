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
import type { AppRuntime } from './providers.js';
import { ensureSessionBoundary, sessionBoundaryQueryOptions } from '../session/session-query.js';

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
          element: <PlaceholderPage heading="Sources" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'ask',
          element: <PlaceholderPage heading="Ask" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'knowledge',
          element: <PlaceholderPage heading="Knowledge" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'review',
          element: <PlaceholderPage heading="Review" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'activity',
          element: <PlaceholderPage heading="Activity" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'history',
          element: <PlaceholderPage heading="History" nextSection="후속 Frontend Section" />,
        },
        {
          path: 'settings',
          element: <SettingsLayout />,
          children: [
            { index: true, element: <CategoryIndexView /> },
            { path: 'preferences', element: <PreferencesWorkspace /> },
            { path: 'projects', element: <ProjectsWorkspace /> },
            { path: 'projects/:projectId', element: <ProjectDetailsWorkspace /> },
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
