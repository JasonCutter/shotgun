import { describe, expect, it, vi } from 'vitest';

import {
  convergeOwnerState,
  ownerStateQueryKeys,
  sourceIntakeSubmissionQueryKey,
  type SourcesQueryScope,
} from './query-keys.js';

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

describe('Sources IntakeSubmission query identity', () => {
  it('isolates exact submission identities even when one is a prefix of another', () => {
    const scope: SourcesQueryScope = {
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProjectId: 'project-1',
      resourceProjectId: 'project-1',
      projectionRevision: 'projection-1',
      sensitivity: 'private',
      policyContextRevision: 'policy-1',
    };

    expect(sourceIntakeSubmissionQueryKey(scope, 'submission-1')).not.toEqual(
      sourceIntakeSubmissionQueryKey(scope, 'submission-10'),
    );
  });
});
