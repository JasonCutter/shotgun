import { describe, expect, it, vi } from 'vitest';

import { convergeOwnerState, ownerStateQueryKeys } from './query-keys.js';

describe('owner state convergence', () => {
  it('invalidates only the server-authoritative consumers for the target Project', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await convergeOwnerState({ invalidateQueries } as never, 'project-1');

    expect(invalidateQueries).toHaveBeenCalledTimes(ownerStateQueryKeys('project-1').length);
    expect(invalidateQueries.mock.calls.map(([input]) => input.queryKey)).toEqual([
      ['settings', 'ai', 'project-1'],
      ['settings', 'ai', 'semantic-comparison', 'project-1'],
      ['settings', 'snapshot', 'project-1'],
      ['settings', 'privacy', 'project-1'],
      ['protected', 'global-shell'],
      ['project'],
    ]);
  });

  it('does not issue cache work without a Project identity', async () => {
    const invalidateQueries = vi.fn();
    await convergeOwnerState({ invalidateQueries } as never, '');
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
