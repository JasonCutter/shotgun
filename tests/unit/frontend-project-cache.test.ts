import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  clearProjectQueries,
  productSessionQueryKey,
  projectQueryKey,
} from '../../apps/shotgun-web/src/app/query-keys.js';

describe('Frontend project cache isolation', () => {
  it('removes every project-scoped cache entry while retaining the Product session', async () => {
    const queryClient = new QueryClient();
    const projectA = projectQueryKey('principal-a', 'project-a', 'sources');
    const projectB = projectQueryKey('principal-a', 'project-b', 'sources');
    queryClient.setQueryData(projectA, ['source-a']);
    queryClient.setQueryData(projectB, ['source-b']);
    queryClient.setQueryData(productSessionQueryKey, { activeProject: { id: 'project-a' } });

    await clearProjectQueries(queryClient);

    expect(queryClient.getQueryData(projectA)).toBeUndefined();
    expect(queryClient.getQueryData(projectB)).toBeUndefined();
    expect(queryClient.getQueryData(productSessionQueryKey)).toEqual({
      activeProject: { id: 'project-a' },
    });
  });
});
