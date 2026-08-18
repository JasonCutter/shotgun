import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import {
  computeCommandSemanticDigestAsync,
  createFrontendExternalActionClient,
  createShotgunApiClient,
  webCryptoDigestProvider,
} from '@shotgun/api-client';

const isE2EBridgeEnabled =
  (import.meta as unknown as { env?: { VITE_E2E_TEST_BRIDGE?: string } }).env
    ?.VITE_E2E_TEST_BRIDGE === 'true';

if (typeof window !== 'undefined' && isE2EBridgeEnabled) {
  (
    window as unknown as { __SHOTGUN_TEST_DIGEST_ADAPTER__?: unknown }
  ).__SHOTGUN_TEST_DIGEST_ADAPTER__ = {
    webCryptoDigestProvider,
    computeCommandSemanticDigestAsync,
  };
  // FE-P4-S2 WP6 browser lifecycle E2E (Review 4869347580): the External Action
  // workspace exposes only the post-execution governed surfaces (Verify/Cancel/
  // Rollback/Compensation/Recovery), so the frozen browser lifecycle's
  // Approval → Preflight → Execute segment is exercised through the REAL
  // frontend client running in the browser page. The bridge is gated behind the
  // E2E test flag only and never active in production builds.
  (
    window as unknown as {
      __SHOTGUN_EXTERNAL_ACTION_BRIDGE__?: {
        createClient(): ReturnType<typeof createFrontendExternalActionClient>;
      };
    }
  ).__SHOTGUN_EXTERNAL_ACTION_BRIDGE__ = {
    createClient: createFrontendExternalActionClient,
  };
}

import { AppProviders, type AppRuntime } from './providers.js';
import { createFrontendQueryClient } from './query-client.js';
import { purgeProjectScopedCaches, purgeProtectedSessionCaches } from './query-keys.js';
import { createAppRouter } from './router.js';
import '../styles/tokens.css';
import '../styles/application.css';

import { createSessionCycleState } from '../session/session-query.js';

const runtime: AppRuntime = {
  apiClient: createShotgunApiClient(),
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
};
if (typeof window !== 'undefined' && isE2EBridgeEnabled) {
  (
    window as unknown as {
      __SHOTGUN_PERFORMANCE_BRIDGE__?: {
        cacheSnapshot(): {
          readonly queryCount: number;
          readonly activeQueryCount: number;
          readonly serializedBytes: number;
        };
        refetchGlobalShell(): Promise<void>;
        refetchHome(): Promise<void>;
        purgeProjectScoped(): Promise<void>;
        purgeProtectedSession(): Promise<void>;
        guardMaskedResource(): Promise<void>;
        activeContext(): {
          readonly projectId: string;
          readonly sessionId: string;
          readonly projectionRevision: string;
          readonly sensitivityClearance: string;
        } | null;
      };
    }
  ).__SHOTGUN_PERFORMANCE_BRIDGE__ = {
    cacheSnapshot: () => {
      const queries = runtime.queryClient.getQueryCache().getAll();
      let serializedBytes = 0;
      for (const query of queries) {
        try {
          serializedBytes += new TextEncoder().encode(JSON.stringify(query.state.data)).byteLength;
        } catch {
          // A non-serializable presentation value contributes no publishable bytes.
        }
      }
      return {
        queryCount: queries.length,
        activeQueryCount: queries.filter((query) => query.getObserversCount() > 0).length,
        serializedBytes,
      };
    },
    refetchGlobalShell: async () => {
      await runtime.queryClient.refetchQueries({ queryKey: ['protected', 'global-shell'] });
    },
    refetchHome: async () => {
      await runtime.queryClient.refetchQueries({ queryKey: ['project'] });
    },
    purgeProjectScoped: async () => {
      await purgeProjectScopedCaches(runtime.queryClient);
    },
    purgeProtectedSession: async () => {
      await purgeProtectedSessionCaches(runtime.queryClient);
    },
    guardMaskedResource: async () => {
      await runtime.apiClient.getRouteGuardDecision(
        { routeId: 'sources', href: '/sources' },
        'performance-masked-resource-project',
      );
    },
    activeContext: () => {
      const shell = runtime.queryClient
        .getQueryCache()
        .findAll({ queryKey: ['protected', 'global-shell'] })
        .map((query) => query.state.data)
        .find(
          (
            value,
          ): value is {
            activeProject: { id: string; sensitivityClearance: string };
            sessionId: string;
            projectionRevision: string;
          } =>
            typeof value === 'object' &&
            value !== null &&
            'activeProject' in value &&
            value.activeProject !== null &&
            typeof value.activeProject === 'object' &&
            'id' in value.activeProject &&
            'sensitivityClearance' in value.activeProject &&
            'sessionId' in value &&
            'projectionRevision' in value,
        );
      return shell
        ? {
            projectId: shell.activeProject.id,
            sessionId: shell.sessionId,
            projectionRevision: shell.projectionRevision,
            sensitivityClearance: shell.activeProject.sensitivityClearance,
          }
        : null;
    },
  };
}
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
