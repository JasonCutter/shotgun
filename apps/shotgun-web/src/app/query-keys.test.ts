/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
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
      ['ask', 'provider-eligibility', 'project-1'],
      ['protected', 'global-shell'],
      ['project'],
    ]);
  });

  it('does not issue cache work without a Project identity', async () => {
    const invalidateQueries = vi.fn();
    await convergeOwnerState({ invalidateQueries } as never, '');
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('refetches only the mounted Project eligibility and preserves its full scope identity', async () => {
    type Eligibility = { readonly eligible: boolean; readonly reason: string };
    const eligibilityByProject: Record<string, Eligibility> = {
      'project-1': { eligible: false, reason: 'STANDING_POLICY_DISABLED' },
      'project-2': { eligible: false, reason: 'STANDING_POLICY_DISABLED' },
    };
    const getEligibility = vi.fn(async (projectId: string) => eligibilityByProject[projectId]!);
    const project1QueryKey = [
      'ask',
      'provider-eligibility',
      'project-1',
      'conversation-1',
      'HYBRID',
      [{ sourceId: 'source-1', sourceVersionId: 'version-1', evidenceIds: [] }],
    ] as const;
    const project2QueryKey = [
      'ask',
      'provider-eligibility',
      'project-2',
      'conversation-2',
      'HYBRID',
      [{ sourceId: 'source-2', sourceVersionId: 'version-2', evidenceIds: [] }],
    ] as const;
    const EligibilityProbe = ({
      projectId,
      queryKey,
    }: {
      readonly projectId: string;
      readonly queryKey: readonly unknown[];
    }) => {
      const query = useQuery({
        queryKey,
        queryFn: () => getEligibility(projectId),
      });
      return createElement(
        'output',
        { 'data-testid': `eligibility-${projectId}` },
        query.data?.reason ?? 'LOADING',
      );
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(EligibilityProbe, { projectId: 'project-1', queryKey: project1QueryKey }),
        createElement(EligibilityProbe, { projectId: 'project-2', queryKey: project2QueryKey }),
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId('eligibility-project-1').textContent).toBe(
        'STANDING_POLICY_DISABLED',
      );
      expect(screen.getByTestId('eligibility-project-2').textContent).toBe(
        'STANDING_POLICY_DISABLED',
      );
    });
    expect(getEligibility).toHaveBeenCalledTimes(2);

    eligibilityByProject['project-1'] = { eligible: true, reason: 'ELIGIBLE' };
    await convergeOwnerState(queryClient, 'project-1');
    await waitFor(() =>
      expect(screen.getByTestId('eligibility-project-1').textContent).toBe('ELIGIBLE'),
    );
    expect(screen.getByTestId('eligibility-project-2').textContent).toBe(
      'STANDING_POLICY_DISABLED',
    );
    expect(getEligibility).toHaveBeenCalledTimes(3);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map(({ queryKey }) => queryKey),
    ).toContainEqual(project1QueryKey);

    eligibilityByProject['project-1'] = { eligible: false, reason: 'STANDING_POLICY_DISABLED' };
    await convergeOwnerState(queryClient, 'project-1');
    await waitFor(() =>
      expect(screen.getByTestId('eligibility-project-1').textContent).toBe(
        'STANDING_POLICY_DISABLED',
      ),
    );
    expect(getEligibility).toHaveBeenCalledTimes(4);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map(({ queryKey }) => queryKey),
    ).toContainEqual(project2QueryKey);
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
