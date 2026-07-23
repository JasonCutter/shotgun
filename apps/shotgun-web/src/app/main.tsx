import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { createShotgunApiClient } from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from './providers.js';
import { createFrontendQueryClient } from './query-client.js';
import { createAppRouter } from './router.js';
import '../styles/tokens.css';
import '../styles/application.css';

const runtime: AppRuntime = {
  apiClient: createShotgunApiClient(),
  queryClient: createFrontendQueryClient(),
};
const router = createAppRouter(runtime);
const root = document.getElementById('root');
if (!root) throw new Error('Application root was not found.');

createRoot(root).render(
  <StrictMode>
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
