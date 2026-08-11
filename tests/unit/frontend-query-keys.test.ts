import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  globalShellQueryKey,
  homeActionCenterQueryKey,
  projectQueryKey,
  purgeProjectScopedCaches,
  askConversationSourceContextQueryKey,
  sourceDetailQueryKey,
  sourceEvidenceQueryKey,
  sourcePreviewQueryKey,
  sourcesLibraryQueryKey,
} from '../../apps/shotgun-web/src/app/query-keys.js';

describe('Frontend project query keys', () => {
  it('isolates the same resource by project', () => {
    expect(projectQueryKey('principal-a', 'project-a', 'sources')).not.toEqual(
      projectQueryKey('principal-a', 'project-b', 'sources'),
    );
  });

  it('isolates the same project by principal', () => {
    expect(projectQueryKey('principal-a', 'project-a', 'sources')).not.toEqual(
      projectQueryKey('principal-b', 'project-a', 'sources'),
    );
  });

  it('binds Home caches to Session, Project, access, policy, and projection revisions', () => {
    const base = {
      principalId: 'principal-a',
      sessionId: 'session-a',
      activeProjectId: 'project-a',
      accessRevision: '1',
      policyContextRevision: '2',
      projectionRevision: '3',
    };
    const key = homeActionCenterQueryKey(base);
    expect(key).toEqual([
      'project',
      'principal-a',
      'project-a',
      'home-action-center',
      'session-a',
      '1',
      '2',
      '3',
    ]);
    expect(homeActionCenterQueryKey({ ...base, sessionId: 'session-b' })).not.toEqual(key);
    expect(homeActionCenterQueryKey({ ...base, policyContextRevision: '4' })).not.toEqual(key);
  });

  it('separates global Shell by Principal, active Project, and access revision', () => {
    expect(globalShellQueryKey('principal-a', 'project-a', '1')).not.toEqual(
      globalShellQueryKey('principal-a', 'project-b', '1'),
    );
    expect(globalShellQueryKey('principal-a', null, '0')).not.toEqual(
      globalShellQueryKey('principal-b', null, '0'),
    );
  });

  it('binds Sources caches to Principal, Session, Projects, revision, sensitivity and policy', () => {
    const base = {
      principalId: 'principal-a',
      sessionId: 'session-a',
      activeProjectId: 'project-a',
      resourceProjectId: 'project-a',
      projectionRevision: 'projection-1',
      sensitivity: 'private',
      policyContextRevision: 'policy-1',
    };
    const library = sourcesLibraryQueryKey(base, 'query-digest');
    expect(sourcesLibraryQueryKey({ ...base, sessionId: 'session-b' }, 'query-digest')).not.toEqual(
      library,
    );
    expect(
      sourcesLibraryQueryKey({ ...base, resourceProjectId: 'project-b' }, 'query-digest'),
    ).not.toEqual(library);
    expect(
      sourcesLibraryQueryKey({ ...base, sensitivity: 'restricted' }, 'query-digest'),
    ).not.toEqual(library);
    expect(
      sourcesLibraryQueryKey({ ...base, policyContextRevision: 'policy-2' }, 'query-digest'),
    ).not.toEqual(library);
    expect(sourceDetailQueryKey(base, 'source-a')).not.toEqual(
      sourceDetailQueryKey(base, 'source-b'),
    );
    expect(sourcePreviewQueryKey(base, 'source-a', 'version-a', 'ORIGINAL')).not.toEqual(
      sourcePreviewQueryKey(base, 'source-a', 'version-b', 'ORIGINAL'),
    );
    expect(sourceEvidenceQueryKey(base, 'source-a', 'version-a')).not.toEqual(
      sourceEvidenceQueryKey(base, 'source-a', 'version-b'),
    );
  });

  it('binds Ask Source Context caches to Active and Resource Projects plus Conversation authority', () => {
    const scope = {
      principalId: 'principal-a',
      sessionId: 'session-a',
      activeProjectId: 'project-b',
      resourceProjectId: 'project-a',
      projectionRevision: 'shell-projection-1',
      sensitivity: 'private',
      policyContextRevision: 'active-policy-1',
    };
    const key = askConversationSourceContextQueryKey(
      scope,
      'conversation-a',
      'resource-access-1',
      'resource-policy-1',
      'query-digest',
    );
    expect(
      askConversationSourceContextQueryKey(
        { ...scope, activeProjectId: 'project-c' },
        'conversation-a',
        'resource-access-1',
        'resource-policy-1',
        'query-digest',
      ),
    ).not.toEqual(key);
    expect(
      askConversationSourceContextQueryKey(
        { ...scope, resourceProjectId: 'project-b' },
        'conversation-a',
        'resource-access-1',
        'resource-policy-1',
        'query-digest',
      ),
    ).not.toEqual(key);
    expect(
      askConversationSourceContextQueryKey(
        scope,
        'conversation-b',
        'resource-access-1',
        'resource-policy-1',
        'query-digest',
      ),
    ).not.toEqual(key);
    expect(
      askConversationSourceContextQueryKey(
        scope,
        'conversation-a',
        'resource-access-2',
        'resource-policy-1',
        'query-digest',
      ),
    ).not.toEqual(key);
    expect(
      askConversationSourceContextQueryKey(
        scope,
        'conversation-a',
        'resource-access-1',
        'resource-policy-2',
        'query-digest',
      ),
    ).not.toEqual(key);
  });

  it('purges Project, Settings, and Project-bound Shell caches on switch', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['project', 'principal-a', 'project-a'], 'project');
    queryClient.setQueryData(['settings', 'principal-a', 'project-a'], 'settings');
    queryClient.setQueryData(globalShellQueryKey('principal-a', 'project-a', '1'), 'shell');
    queryClient.setQueryData(['global', 'public-registry'], 'global');

    await purgeProjectScopedCaches(queryClient);

    expect(queryClient.getQueryData(['project', 'principal-a', 'project-a'])).toBeUndefined();
    expect(queryClient.getQueryData(['settings', 'principal-a', 'project-a'])).toBeUndefined();
    expect(
      queryClient.getQueryData(globalShellQueryKey('principal-a', 'project-a', '1')),
    ).toBeUndefined();
    expect(queryClient.getQueryData(['global', 'public-registry'])).toBe('global');
  });
});
