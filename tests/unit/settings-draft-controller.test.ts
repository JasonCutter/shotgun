/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  FrontendCommandOutcomeView,
  SettingsSnapshot,
} from '../../packages/shotgun-api-client/src/index.js';
import {
  LeaveGuardProvider,
  useLeaveGuard,
} from '../../apps/shotgun-web/src/session/leave-guard-context.js';
import { useSettingsDraft } from '../../apps/shotgun-web/src/session/settings-draft-controller.js';
import { outcomeIndeterminateApiError } from '../../packages/shotgun-api-client/src/index.js';

const wrapper = ({ children }: { readonly children: ReactNode }) =>
  createElement(LeaveGuardProvider, null, children);

const makeSnapshot = (
  targetProjectId: string,
  settingsRevision: number,
  policyContextRevision: number,
): SettingsSnapshot => ({
  schemaVersion: '1.0.0',
  targetProjectId,
  settingsRevision,
  policyContextRevision,
  categories: [],
  settings: [],
  fetchedAt: '2026-07-26T00:00:00.000Z',
});

const makeOutcome = (clientRequestId: string, commandId: string): FrontendCommandOutcomeView => ({
  commandId,
  commandRevision: '1',
  clientRequestId,
  idempotencyKey: 'idem-pinned',
  commandType: 'settings.project-policy.apply.v1',
  commandSchemaVersion: '1.0.0',
  commandSemanticDigest: 'sha256:test',
  outcomeState: 'COMPLETED',
  completionDisposition: 'SUCCEEDED',
  acceptedPrincipalContext: {
    principalId: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
  },
  acceptedProjectContext: { targetProjectId: 'project-a' },
  acceptedPolicyContext: {
    policyContextId: 'policy-project-a-7',
    policyContextRevision: '7',
    acceptedAt: '2026-07-26T00:00:00.000Z',
  },
  correlationId: 'correlation-a',
  producedResources: [],
  receivedAt: '2026-07-26T00:00:00.000Z',
  acceptedAt: '2026-07-26T00:00:00.000Z',
  completedAt: '2026-07-26T00:00:01.000Z',
  lastUpdatedAt: '2026-07-26T00:00:01.000Z',
});

type HookProps = {
  readonly snapshot: SettingsSnapshot;
  readonly activeProjectId: string;
};

const renderSettingsDraft = (initialProps: HookProps) =>
  renderHook(
    ({ snapshot, activeProjectId }: HookProps) => ({
      controller: useSettingsDraft(snapshot, activeProjectId),
      leaveGuard: useLeaveGuard(),
    }),
    { initialProps, wrapper },
  );

describe('useSettingsDraft', () => {
  it('pins Project, Settings, and Policy context on the first edit', () => {
    const { result } = renderSettingsDraft({
      snapshot: makeSnapshot('project-a', 3, 7),
      activeProjectId: 'active-a',
    });

    act(() => {
      result.current.controller.setDraftValue('models.defaultAnswerProfile', 'model-b');
    });

    expect(result.current.controller.state).toBe('DIRTY');
    expect(result.current.controller.activeProjectId).toBe('active-a');
    expect(result.current.controller.targetProjectId).toBe('project-a');
    expect(result.current.controller.resourceProjectId).toBe('project-a');
    expect(result.current.controller.expectedSettingsRevision).toBe(3);
    expect(result.current.controller.observedPolicyContextRevision).toBe(7);
  });

  it('keeps the draft and marks it STALE when a dirty Snapshot context changes', async () => {
    const { result, rerender } = renderSettingsDraft({
      snapshot: makeSnapshot('project-a', 3, 7),
      activeProjectId: 'active-a',
    });

    act(() => {
      result.current.controller.setDraftValue('models.defaultAnswerProfile', 'model-b');
    });

    rerender({
      snapshot: makeSnapshot('project-b', 4, 8),
      activeProjectId: 'active-b',
    });

    await waitFor(() => expect(result.current.controller.state).toBe('STALE'));
    expect(result.current.controller.draft).toEqual({
      'models.defaultAnswerProfile': 'model-b',
    });
    expect(result.current.controller.activeProjectId).toBe('active-a');
    expect(result.current.controller.targetProjectId).toBe('project-a');
    expect(result.current.controller.resourceProjectId).toBe('project-a');
    expect(result.current.controller.expectedSettingsRevision).toBe(3);
    expect(result.current.controller.observedPolicyContextRevision).toBe(7);
  });

  it('recovers OUTCOME_UNKNOWN by clientRequestId without resubmitting', async () => {
    const { result } = renderSettingsDraft({
      snapshot: makeSnapshot('project-a', 3, 7),
      activeProjectId: 'active-a',
    });
    const applySettingsCommand = vi
      .fn()
      .mockRejectedValue(outcomeIndeterminateApiError('request-from-api-error'));

    act(() => {
      result.current.controller.setDraftValue('models.defaultAnswerProfile', 'model-b');
    });
    await act(async () => {
      await result.current.controller
        .applyCommand({
          applySettingsCommand,
          getSettingsCommandStatus: vi.fn(),
        })
        .catch(() => undefined);
    });

    const clientRequestId = result.current.controller.clientRequestId;
    expect(clientRequestId).not.toBeNull();
    expect(result.current.controller.state).toBe('OUTCOME_UNKNOWN');
    expect(result.current.controller.failure).toMatchObject({
      code: 'OUTCOME_INDETERMINATE',
      state: 'OUTCOME_UNKNOWN',
    });
    expect(applySettingsCommand).toHaveBeenCalledTimes(1);

    const commandId = 'command-existing';
    const getFrontendCommandOutcomeByClientRequestId = vi
      .fn()
      .mockResolvedValue(makeOutcome(clientRequestId!, commandId));
    const getSettingsCommandStatus = vi.fn().mockResolvedValue({
      commandId,
      clientRequestId,
      idempotencyKey: result.current.controller.idempotencyKey!,
      projectId: 'project-a',
      status: 'APPLIED' as const,
      appliedRevision: 4,
      completedAt: '2026-07-26T00:00:01.000Z',
    });

    await act(async () => {
      await result.current.controller.recoverOutcomeUnknown({
        getFrontendCommandOutcomeByClientRequestId,
        getSettingsCommandStatus,
      });
    });

    expect(getFrontendCommandOutcomeByClientRequestId).toHaveBeenCalledWith(clientRequestId);
    expect(getSettingsCommandStatus).toHaveBeenCalledWith(commandId);
    expect(applySettingsCommand).toHaveBeenCalledTimes(1);
    expect(result.current.controller.state).toBe('APPLIED');
    expect(result.current.controller.draft).toEqual({});
  });

  it('reset returns CLEAN, releases the pin, and unregisters the dirty leave state', async () => {
    const { result, rerender } = renderSettingsDraft({
      snapshot: makeSnapshot('project-a', 3, 7),
      activeProjectId: 'active-a',
    });

    act(() => {
      result.current.controller.setDraftValue('models.defaultAnswerProfile', 'model-b');
    });
    await waitFor(() =>
      expect(result.current.leaveGuard.getLeaveState().hasUnsavedDraft).toBe(true),
    );

    act(() => {
      result.current.controller.resetDraft();
    });
    await waitFor(() => {
      expect(result.current.controller.state).toBe('CLEAN');
      expect(result.current.leaveGuard.getLeaveState().canLeaveCurrentContext).toBe(true);
    });

    rerender({
      snapshot: makeSnapshot('project-b', 9, 11),
      activeProjectId: 'active-b',
    });

    expect(result.current.controller.targetProjectId).toBe('project-b');
    expect(result.current.controller.resourceProjectId).toBe('project-b');
    expect(result.current.controller.expectedSettingsRevision).toBe(9);
    expect(result.current.controller.observedPolicyContextRevision).toBe(11);
    expect(result.current.controller.draft).toEqual({});
  });
});
