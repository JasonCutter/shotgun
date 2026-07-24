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
import { SettingsPage } from '../routes/settings-page.js';
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
    return await runtime.queryClient.fetchQuery({
      ...sessionBoundaryQueryOptions(runtime.apiClient),
      queryFn: () => ensureSessionBoundary(runtime.apiClient, request.signal),
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
          element: <PlaceholderPage heading="Sources" nextSection="Frontend Section 2" />,
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
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
  ]);
