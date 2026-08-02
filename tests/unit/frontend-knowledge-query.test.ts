import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type GlobalShellView,
  type ShotgunApiClient,
} from '../../packages/shotgun-api-client/src/index.js';
import {
  knowledgeCompareQueryKey,
  knowledgeDetailQueryKey,
  knowledgePageListQueryKey,
  knowledgeSearchQueryKey,
  knowledgeScopeFromShell,
  knowledgeWorkspaceQueryKey,
  purgeProjectScopedCaches,
} from '../../apps/shotgun-web/src/app/query-keys.js';
import {
  knowledgeCanManuallyRetry,
  knowledgeQueryRetry,
  knowledgeSearchQueryOptions,
  knowledgeWorkspaceQueryOptions,
} from '../../apps/shotgun-web/src/knowledge/knowledge-queries.js';

const shell = {
  principalId: 'principal-a',
  sessionId: 'session-a',
  activeProject: {
    id: 'project-a',
    label: 'Project A',
    sensitivityClearance: 'private',
  },
  accessRevision: 'access-a',
  policyContextRevision: 'policy-a',
} as GlobalShellView;

const workspaceRequest = { schemaVersion: '1.0.0', resourceId: 'resource-a' } as const;
const searchRequest = { schemaVersion: '1.0.0', query: 'canonical' } as const;
const scope = knowledgeScopeFromShell(shell);

if (!scope) throw new Error('Knowledge query fixture requires an active Project.');

describe('Frontend Knowledge Query ownership', () => {
  it('binds every Knowledge key to authority scope and full request identity', () => {
    const workspaceKey = knowledgeWorkspaceQueryKey(scope, workspaceRequest);
    expect(
      knowledgeWorkspaceQueryKey({ ...scope, sessionId: 'session-b' }, workspaceRequest),
    ).not.toEqual(workspaceKey);
    expect(
      knowledgeWorkspaceQueryKey({ ...scope, policyContextRevision: 'policy-b' }, workspaceRequest),
    ).not.toEqual(workspaceKey);
    expect(
      knowledgeWorkspaceQueryKey(scope, { ...workspaceRequest, resourceId: 'resource-b' }),
    ).not.toEqual(workspaceKey);
    expect(knowledgeSearchQueryKey(scope, searchRequest)).not.toEqual(workspaceKey);
    expect(
      knowledgePageListQueryKey(scope, { schemaVersion: '1.0.0', cursor: 'cursor-a' }),
    ).not.toEqual(workspaceKey);
    expect(
      knowledgeDetailQueryKey(scope, { schemaVersion: '1.0.0', resourceId: 'resource-a' }),
    ).not.toEqual(workspaceKey);
    expect(
      knowledgeCompareQueryKey(scope, { schemaVersion: '1.0.0', pageIds: ['page-a', 'page-b'] }),
    ).not.toEqual(workspaceKey);
    expect(knowledgeScopeFromShell({ ...shell, activeProject: null })).toBeNull();
  });

  it('keeps zero-project queries disabled and purges Knowledge with Project caches', async () => {
    const apiClient = {} as ShotgunApiClient;
    const disabled = knowledgeWorkspaceQueryOptions(apiClient, null, workspaceRequest);
    expect(disabled.enabled).toBe(false);
    expect(disabled.queryKey).toEqual(['knowledge', 'disabled', 'workspace']);

    const queryClient = new QueryClient();
    queryClient.setQueryData(knowledgeWorkspaceQueryKey(scope, workspaceRequest), 'knowledge');
    await purgeProjectScopedCaches(queryClient);
    expect(
      queryClient.getQueryData(knowledgeWorkspaceQueryKey(scope, workspaceRequest)),
    ).toBeUndefined();
  });

  it('derives retry only from typed SAFE failures and keeps Knowledge query identity', () => {
    const apiClient = {} as ShotgunApiClient;
    const safe = new ShotgunApiError({
      status: 503,
      code: 'RETRYABLE_DEPENDENCY',
      message: 'retry',
    });
    const never = new ShotgunApiError({ status: 400, code: 'INVALID_REQUEST', message: 'stop' });
    expect(knowledgeQueryRetry(0, safe)).toBe(true);
    expect(knowledgeQueryRetry(2, safe)).toBe(false);
    expect(knowledgeQueryRetry(0, never)).toBe(false);
    expect(knowledgeQueryRetry(0, new Error('unknown'))).toBe(false);
    expect(knowledgeCanManuallyRetry(safe)).toBe(true);
    expect(knowledgeCanManuallyRetry(never)).toBe(false);
    expect(knowledgeCanManuallyRetry(new Error('unknown'))).toBe(false);

    const options = knowledgeSearchQueryOptions(apiClient, shell, searchRequest);
    expect(options.enabled).toBe(true);
    expect(options.queryKey).toEqual(knowledgeSearchQueryKey(scope, searchRequest));
  });
});
