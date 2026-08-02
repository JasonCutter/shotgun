import { QueryClient } from '@tanstack/react-query';

import {
  ShotgunApiError,
  createShotgunApiClient,
  type GlobalShellView,
  type KnowledgeSearchRequest,
  type ShotgunApiClient,
} from '@shotgun/api-client';

import { knowledgeQueryRetry, knowledgeSearchQueryOptions } from './knowledge-queries.js';

import {
  knowledgeSearchQueryKey,
  knowledgeScopeFromShell,
  purgeProtectedSessionCaches,
  purgeProjectScopedCaches,
} from '../app/query-keys.js';

// Test-only browser harness. It is imported by Playwright through Vite and is
// not imported by the production application entrypoint.

const browserSearchRequest = {
  schemaVersion: '1.0.0',
  query: 'browser-knowledge',
  pageSize: 20,
} as KnowledgeSearchRequest;

const browserShell = (
  projectId: string,
  accessRevision: string,
  policyContextRevision: string,
): GlobalShellView =>
  ({
    principalId: 'browser-principal',
    sessionId: 'browser-session',
    activeProject: { id: projectId, sensitivityClearance: 'private' },
    accessRevision,
    policyContextRevision,
  }) as unknown as GlobalShellView;

const failure = (input: {
  readonly status: number;
  readonly code: 'RETRYABLE_DEPENDENCY' | 'PROJECT_ACCESS_DENIED';
  readonly retryability: 'SAFE' | 'NEVER';
  readonly recovery: 'RETRY' | 'REQUEST_ACCESS';
}) =>
  new ShotgunApiError({
    status: input.status,
    code: input.code,
    category: input.retryability === 'SAFE' ? 'DEPENDENCY' : 'AUTHORIZATION',
    retryability: input.retryability,
    recovery: input.recovery,
    message: `Browser harness ${input.code}`,
    ...(input.retryability === 'SAFE'
      ? {
          failure: {
            schemaVersion: '1.0.0' as const,
            code: input.code,
            category: 'DEPENDENCY' as const,
            retryability: 'SAFE' as const,
            recovery: 'RETRY' as const,
            message: `Browser harness ${input.code}`,
          },
        }
      : {}),
  });

export const runKnowledgeBrowserCacheHarness = async () => {
  const projectAShell = browserShell('browser-project-a', 'access-a', 'policy-a');
  const projectBShell = browserShell('browser-project-b', 'access-a', 'policy-a');
  const revisedShell = browserShell('browser-project-a', 'access-b', 'policy-b');
  const apiClient = {} as ShotgunApiClient;
  const projectAOptions = knowledgeSearchQueryOptions(
    apiClient,
    projectAShell,
    browserSearchRequest,
  );
  const projectBOptions = knowledgeSearchQueryOptions(
    apiClient,
    projectBShell,
    browserSearchRequest,
  );
  const revisedOptions = knowledgeSearchQueryOptions(apiClient, revisedShell, browserSearchRequest);
  const zeroProjectOptions = knowledgeSearchQueryOptions(apiClient, null, browserSearchRequest);
  const projectAScope = knowledgeScopeFromShell(projectAShell);
  if (!projectAScope) throw new Error('Project A shell did not produce a scope.');
  const projectAKey = knowledgeSearchQueryKey(projectAScope, browserSearchRequest);
  const queryClient = new QueryClient();
  queryClient.setQueryData(projectAKey, {
    projection: { status: 'STALE' },
    value: 'project-a',
  });

  const projectBDataBeforePurge = queryClient.getQueryData(projectBOptions.queryKey);
  const revisedDataBeforePurge = queryClient.getQueryData(revisedOptions.queryKey);
  const projectADataBeforePurge = queryClient.getQueryData(projectAKey);
  await purgeProjectScopedCaches(queryClient);
  const projectADataAfterProjectPurge = queryClient.getQueryData(projectAKey);

  queryClient.setQueryData(projectAKey, { value: 'session-scoped-project-data' });
  await purgeProtectedSessionCaches(queryClient);
  const projectADataAfterSessionPurge = queryClient.getQueryData(projectAKey);

  const safeFailure = failure({
    status: 503,
    code: 'RETRYABLE_DEPENDENCY',
    retryability: 'SAFE',
    recovery: 'RETRY',
  });
  const neverFailure = failure({
    status: 403,
    code: 'PROJECT_ACCESS_DENIED',
    retryability: 'NEVER',
    recovery: 'REQUEST_ACCESS',
  });
  const projection = (projectADataBeforePurge as { projection?: { status?: string } } | undefined)
    ?.projection;

  return {
    projectSwitchIsolation:
      projectBDataBeforePurge === undefined &&
      JSON.stringify(projectAOptions.queryKey) !== JSON.stringify(projectBOptions.queryKey),
    authorityRevisionIsolation:
      revisedDataBeforePurge === undefined &&
      JSON.stringify(projectAOptions.queryKey) !== JSON.stringify(revisedOptions.queryKey),
    projectPurgeRemovesKnowledge: projectADataAfterProjectPurge === undefined,
    logoutPurgeRemovesKnowledge: projectADataAfterSessionPurge === undefined,
    zeroProjectDisabled:
      zeroProjectOptions.enabled === false &&
      JSON.stringify(zeroProjectOptions.queryKey) ===
        JSON.stringify(['knowledge', 'disabled', 'search']),
    domainProjectionStalePreserved: projection?.status === 'STALE',
    typedFailure: {
      instanceofShotgunApiError: safeFailure instanceof ShotgunApiError,
      code: safeFailure.code,
      retryability: safeFailure.retryability,
      recovery: safeFailure.recovery,
      envelopeCode: safeFailure.failure?.code,
    },
    retryPolicy: {
      safeAtZero: knowledgeQueryRetry(0, safeFailure),
      safeAtOne: knowledgeQueryRetry(1, safeFailure),
      safeAtTwo: knowledgeQueryRetry(2, safeFailure),
      never: knowledgeQueryRetry(0, neverFailure),
      raw: knowledgeQueryRetry(0, new Error('untyped browser failure')),
    },
  };
};

export const readKnowledgeBrowserApiFailure = async () => {
  try {
    await createShotgunApiClient().searchKnowledge(browserSearchRequest);
    return { kind: 'NO_FAILURE' as const };
  } catch (error) {
    if (!(error instanceof ShotgunApiError)) {
      return {
        kind: 'UN_TYPED_FAILURE' as const,
        errorName: error instanceof Error ? error.name : 'unknown',
      };
    }
    return {
      kind: 'TYPED_FAILURE' as const,
      instanceofShotgunApiError: true,
      code: error.code,
      retryability: error.retryability,
      recovery: error.recovery,
      envelopeCode: error.failure?.code,
    };
  }
};
