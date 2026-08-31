import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ShotgunApiError,
  type AnyFrontendCommandOutcomeView,
  type DiscoveryFeedbackProductCommandRequestV1,
  type DiscoveryFeedbackProductStateV1,
  type FrontendDiscoveryClient,
  type GlobalShellView,
  type WorkspaceLeaveState,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import {
  DiscoveryQuickFeedbackActions,
  useDiscoveryFeedbackActions,
} from './discovery-feedback.js';

const shell = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: { id: 'project-1', sensitivityClearance: 'private' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
} as unknown as GlobalShellView;

const target = {
  projectId: 'project-1',
  findingId: 'finding-1',
  findingRevision: 1,
} as const;

const feedbackState = (): DiscoveryFeedbackProductStateV1 =>
  ({
    schemaVersion: '1.0.0',
    projectId: target.projectId,
    findingId: target.findingId,
    findingRevision: target.findingRevision,
    feedbackHistory: [],
    suppressionHistory: [],
  }) as DiscoveryFeedbackProductStateV1;

const outcome = (
  outcomeState: 'COMPLETED' | 'OUTCOME_UNKNOWN',
  clientRequestId: string,
): AnyFrontendCommandOutcomeView =>
  ({ outcomeState, clientRequestId }) as AnyFrontendCommandOutcomeView;

const runtime = (): AppRuntime =>
  ({
    apiClient: {},
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  }) as AppRuntime;

const wrapperFor =
  (appRuntime: AppRuntime) =>
  ({ children }: { readonly children: ReactNode }) => (
    <AppProviders runtime={appRuntime}>{children}</AppProviders>
  );

const GuardProbe = ({ onState }: { readonly onState: (state: WorkspaceLeaveState) => void }) => {
  const { getLeaveState } = useLeaveGuard();
  useEffect(() => {
    onState(getLeaveState());
  }, [getLeaveState, onState]);
  return null;
};

describe('discovery feedback uncertainty handling', () => {
  it('locks the unresolved request identity, resolves it without a new submit, then permits a later action', async () => {
    const state = feedbackState();
    const resolveResults: ('OUTCOME_UNKNOWN' | 'COMPLETED')[] = ['OUTCOME_UNKNOWN', 'COMPLETED'];
    const submit = vi.fn(async (request: DiscoveryFeedbackProductCommandRequestV1) => {
      if (submit.mock.calls.length === 1) {
        throw new ShotgunApiError({
          status: 504,
          code: 'OUTCOME_INDETERMINATE',
          message: 'The feedback result is uncertain.',
          clientRequestId: request.clientRequestId,
        });
      }
      return { state, outcome: outcome('COMPLETED', request.clientRequestId) };
    });
    const resolve = vi.fn(async (clientRequestId: string) =>
      outcome(resolveResults.shift() ?? 'COMPLETED', clientRequestId),
    );
    const readState = vi.fn(async () => state);
    const client = {
      submitDiscoveryFeedback: submit,
      resolveDiscoveryFeedbackCommand: resolve,
      readDiscoveryFeedbackState: readState,
    } as unknown as FrontendDiscoveryClient;
    const { result } = renderHook(() => useDiscoveryFeedbackActions(shell, target, client), {
      wrapper: wrapperFor(runtime()),
    });

    await act(async () => {
      const first = await result.current.submit({
        feedbackClass: 'UTILITY',
        feedbackKind: 'USEFUL',
      });
      expect(first.status).toBe('OUTCOME_UNKNOWN');
    });
    const firstRequestId = submit.mock.calls[0]?.[0].clientRequestId;
    expect(firstRequestId).toBeTruthy();
    expect(resolve).toHaveBeenNthCalledWith(1, firstRequestId);

    await act(async () => {
      const duplicate = await result.current.submit({
        feedbackClass: 'UTILITY',
        feedbackKind: 'NOT_RELEVANT',
      });
      expect(duplicate.status).toBe('OUTCOME_UNKNOWN');
    });
    expect(submit).toHaveBeenCalledOnce();

    await act(async () => {
      const resolved = await result.current.resolveLast();
      expect(resolved.status).toBe('COMPLETED');
    });
    expect(resolve).toHaveBeenLastCalledWith(firstRequestId);
    expect(readState).toHaveBeenCalledOnce();

    await waitFor(() => expect(result.current.lastResult?.status).toBe('COMPLETED'));
    await act(async () => {
      const later = await result.current.submit({
        feedbackClass: 'UTILITY',
        feedbackKind: 'NOT_RELEVANT',
      });
      expect(later.status).toBe('COMPLETED');
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0].clientRequestId).not.toBe(firstRequestId);
  });

  it('blocks Inbox Project switching while feedback is pending or unknown and clears the guard after resolution', async () => {
    const state = feedbackState();
    let release!: () => void;
    const submit = vi.fn(async (request: DiscoveryFeedbackProductCommandRequestV1) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { state, outcome: outcome('COMPLETED', request.clientRequestId) };
    });
    const resolve = vi.fn(async (clientRequestId: string) => outcome('COMPLETED', clientRequestId));
    const client = {
      submitDiscoveryFeedback: submit,
      resolveDiscoveryFeedbackCommand: resolve,
      readDiscoveryFeedbackState: vi.fn(async () => state),
    } as unknown as FrontendDiscoveryClient;
    const user = userEvent.setup();
    const guardStates: WorkspaceLeaveState[] = [];
    const onState = (stateValue: WorkspaceLeaveState) => guardStates.push(stateValue);

    render(
      <AppProviders runtime={runtime()}>
        <GuardProbe onState={onState} />
        <DiscoveryQuickFeedbackActions finding={target} shell={shell} client={client} />
      </AppProviders>,
    );

    await user.click(screen.getByRole('button', { name: 'Useful' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(guardStates.at(-1)).toMatchObject({
        canLeaveCurrentContext: false,
        hasOutcomeUnknownCommand: false,
      }),
    );
    expect((screen.getByRole('button', { name: 'Useful' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    release();
    await waitFor(() => expect(screen.getByText('Feedback recorded.')).toBeTruthy());
    await waitFor(() =>
      expect(guardStates.at(-1)).toMatchObject({
        canLeaveCurrentContext: true,
        hasOutcomeUnknownCommand: false,
      }),
    );
  });

  it('shows a resolver and keeps Inbox feedback locked after an unknown outcome', async () => {
    const state = feedbackState();
    const submit = vi.fn(async (request: DiscoveryFeedbackProductCommandRequestV1) =>
      (() => {
        throw new ShotgunApiError({
          status: 504,
          code: 'OUTCOME_INDETERMINATE',
          message: 'The feedback result is uncertain.',
          clientRequestId: request.clientRequestId,
        });
      })(),
    );
    const resolveResults: ('OUTCOME_UNKNOWN' | 'COMPLETED')[] = ['OUTCOME_UNKNOWN', 'COMPLETED'];
    const resolve = vi.fn(async (clientRequestId: string) =>
      outcome(resolveResults.shift() ?? 'COMPLETED', clientRequestId),
    );
    const client = {
      submitDiscoveryFeedback: submit,
      resolveDiscoveryFeedbackCommand: resolve,
      readDiscoveryFeedbackState: vi.fn(async () => state),
    } as unknown as FrontendDiscoveryClient;
    const user = userEvent.setup();
    const guardStates: WorkspaceLeaveState[] = [];

    render(
      <AppProviders runtime={runtime()}>
        <GuardProbe onState={(stateValue) => guardStates.push(stateValue)} />
        <DiscoveryQuickFeedbackActions finding={target} shell={shell} client={client} />
      </AppProviders>,
    );

    await user.click(screen.getByRole('button', { name: 'Useful' }));
    const checkResult = await screen.findByRole('button', { name: 'Check result' });
    expect((screen.getByRole('button', { name: 'Useful' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() =>
      expect(guardStates.at(-1)).toMatchObject({
        canLeaveCurrentContext: false,
        hasOutcomeUnknownCommand: true,
      }),
    );

    await user.click(checkResult);
    await waitFor(() => expect(screen.getByText('Feedback recorded.')).toBeTruthy());
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[0]?.[0]).toBe(resolve.mock.calls[1]?.[0]);
    await waitFor(() =>
      expect(guardStates.at(-1)).toMatchObject({
        canLeaveCurrentContext: true,
        hasOutcomeUnknownCommand: false,
      }),
    );
  });
});
