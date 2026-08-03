/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FrontendKnowledgeDraftChangeSetV1 } from '../../packages/shotgun-api-client/src/index.js';
import {
  outcomeIndeterminateApiError,
  productFailureApiError,
} from '../../packages/shotgun-api-client/src/index.js';
import { createProductFailureEnvelope } from '../../packages/contracts/src/index.js';
import { pBase, pDraft, pOperation } from '../helpers/frontend-knowledge-draft-parity.js';
import {
  LeaveGuardProvider,
  useLeaveGuard,
} from '../../apps/shotgun-web/src/session/leave-guard-context.js';
import { useKnowledgeDraft } from '../../apps/shotgun-web/src/knowledge/knowledge-draft-controller.js';
import {
  pendingKnowledgeDraftCommandStorageKey,
  readPendingKnowledgeDraftCommandIdentity,
  writePendingKnowledgeDraftCommandIdentity,
} from '../../apps/shotgun-web/src/knowledge/pending-draft-command-storage.js';

const wrapper = ({ children }: { readonly children: ReactNode }) =>
  createElement(LeaveGuardProvider, null, children);

const draftV1 = (): FrontendKnowledgeDraftChangeSetV1 => pDraft('seed-1');
const savedDraft = (): FrontendKnowledgeDraftChangeSetV1 => ({
  ...draftV1(),
  revision: 2,
  operations: [pOperation(2)],
  contentDigest: 'sha256:saved-v2',
});

type HookProps = {
  readonly draft: FrontendKnowledgeDraftChangeSetV1;
  readonly activeProjectId: string;
  readonly sessionId?: string;
};

const renderDraft = (initialProps: HookProps) =>
  renderHook(
    ({ draft, activeProjectId, sessionId }: HookProps) => ({
      controller: useKnowledgeDraft(draft, activeProjectId, sessionId),
      leaveGuard: useLeaveGuard(),
    }),
    { initialProps, wrapper },
  );

describe('useKnowledgeDraft (browser Draft State Machine controller)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('pins the context on the first edit, registers the leave guard, and protects a dirty Draft from refetch', async () => {
    const { result, rerender } = renderDraft({
      draft: draftV1(),
      activeProjectId: 'project-1',
    });

    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });
    expect(result.current.controller.draftState.state).toBe('DIRTY');
    expect(result.current.controller.draftState.pinnedContext?.activeProjectId).toBe('project-1');
    await waitFor(() =>
      expect(result.current.leaveGuard.getLeaveState().hasUnsavedDraft).toBe(true),
    );
    expect(result.current.leaveGuard.getLeaveState().canLeaveCurrentContext).toBe(false);

    // A background refetch with a drifted base never overwrites the edits.
    const drifted = {
      ...draftV1(),
      base: { ...pBase, canonicalVersion: 8 },
    } as FrontendKnowledgeDraftChangeSetV1;
    rerender({ draft: drifted, activeProjectId: 'project-1' });
    await waitFor(() => expect(result.current.controller.draftState.state).toBe('STALE'));
    expect(result.current.controller.draftState.localOperations).toHaveLength(1);
    expect(result.current.controller.draftState.draft?.revision).toBe(1);
  });

  it('marks STALE when the Project binding drifts, preserving the pinned Draft', async () => {
    const { result, rerender } = renderDraft({
      draft: draftV1(),
      activeProjectId: 'project-1',
    });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });

    const otherProject = {
      ...draftV1(),
      activeProjectId: 'project-2',
      resourceProjectId: 'project-2',
      draftProjectId: 'project-2',
      effectiveProjectId: 'project-2',
      base: { ...pBase, resourceProjectId: 'project-2' },
    } as FrontendKnowledgeDraftChangeSetV1;
    rerender({ draft: otherProject, activeProjectId: 'project-2' });

    await waitFor(() => expect(result.current.controller.draftState.state).toBe('STALE'));
    expect(result.current.controller.draftState.localOperations).toHaveLength(1);
    expect(result.current.controller.draftState.pinnedContext?.resourceProjectId).toBe('project-1');
  });

  it('saves the Draft with a server-authoritative result and returns to CLEAN', async () => {
    const { result } = renderDraft({ draft: draftV1(), activeProjectId: 'project-1' });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });

    const saveDraft = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'req-1',
      idempotencyKey: 'idem-1',
      draft: savedDraft(),
    });

    await act(async () => {
      await result.current.controller.save({ saveDraft });
    });

    expect(result.current.controller.draftState.state).toBe('CLEAN');
    expect(result.current.controller.draftState.draft?.revision).toBe(2);
    expect(result.current.controller.draftState.localOperations).toHaveLength(0);
    expect(result.current.controller.draftState.pinnedContext).toBeNull();
    await waitFor(() =>
      expect(result.current.leaveGuard.getLeaveState().canLeaveCurrentContext).toBe(true),
    );

    expect(saveDraft).toHaveBeenCalledTimes(1);
    const request = saveDraft.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      draftId: 'draft-seed-1',
      expectedDraftRevision: 1,
      expectedBaseRevision: 7,
      operationRevision: 2,
    });
  });

  it('records a deterministic Save failure as SAVE_FAILED and preserves the edits', async () => {
    const { result } = renderDraft({ draft: draftV1(), activeProjectId: 'project-1' });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });

    const saveDraft = vi.fn().mockRejectedValue(
      productFailureApiError(
        400,
        createProductFailureEnvelope({
          code: 'VALIDATION_FAILED',
          message: 'Invalid operation.',
        }),
      ),
    );

    await act(async () => {
      await result.current.controller.save({ saveDraft }).catch(() => undefined);
    });

    expect(result.current.controller.draftState.state).toBe('SAVE_FAILED');
    expect(result.current.controller.draftState.localOperations).toHaveLength(1);
    expect(result.current.controller.draftState.commandIdentity).toBeNull();
    expect(result.current.controller.draftState.failure?.code).toBe('VALIDATION_FAILED');
  });

  it('refuses to save while OUTCOME_UNKNOWN, then recovers by the original command identity without resubmitting', async () => {
    const { result } = renderDraft({ draft: draftV1(), activeProjectId: 'project-1' });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });

    const saveDraft = vi.fn().mockRejectedValue(outcomeIndeterminateApiError('req-from-error'));
    await act(async () => {
      await result.current.controller.save({ saveDraft }).catch(() => undefined);
    });
    expect(result.current.controller.draftState.state).toBe('OUTCOME_UNKNOWN');
    const identity = result.current.controller.draftState.commandIdentity;
    expect(identity).not.toBeNull();
    expect(saveDraft).toHaveBeenCalledTimes(1);

    // A direct Save is refused while the command outcome is unresolved.
    let refused = true;
    await act(async () => {
      refused = (await result.current.controller.save({ saveDraft })) === null;
    });
    expect(refused).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(1);

    const resolveCommandOutcome = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      originalClientRequestId: identity?.clientRequestId,
      originalIdempotencyKey: identity?.idempotencyKey,
      draft: savedDraft(),
    });

    await act(async () => {
      await result.current.controller.recoverOutcomeUnknown({ resolveCommandOutcome });
    });

    expect(resolveCommandOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: identity?.clientRequestId,
        idempotencyKey: identity?.idempotencyKey,
        semanticDigest: identity?.semanticDigest,
      }),
    );
    expect(saveDraft).toHaveBeenCalledTimes(1); // the action is never resubmitted
    expect(result.current.controller.draftState.state).toBe('CLEAN');
    expect(result.current.controller.draftState.commandIdentity).toBeNull();
  });

  it('reset releases the pin and re-syncs the server Draft as CLEAN', async () => {
    const { result, rerender } = renderDraft({
      draft: draftV1(),
      activeProjectId: 'project-1',
    });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });
    await waitFor(() =>
      expect(result.current.leaveGuard.getLeaveState().hasUnsavedDraft).toBe(true),
    );

    act(() => {
      result.current.controller.reset();
    });
    await waitFor(() => {
      expect(result.current.controller.draftState.state).toBe('CLEAN');
      expect(result.current.leaveGuard.getLeaveState().canLeaveCurrentContext).toBe(true);
    });
    expect(result.current.controller.draftState.pinnedContext).toBeNull();

    rerender({
      draft: { ...draftV1(), revision: 2, contentDigest: 'sha256:v2' },
      activeProjectId: 'project-1',
    });
    await waitFor(() => expect(result.current.controller.draftState.draft?.revision).toBe(2));
    expect(result.current.controller.draftState.state).toBe('CLEAN');
  });

  it('blocks leaving while a SAVE_FAILED Draft still holds unsaved edits', async () => {
    const { result } = renderDraft({ draft: draftV1(), activeProjectId: 'project-1' });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });
    await waitFor(() =>
      expect(result.current.leaveGuard.getLeaveState().hasUnsavedDraft).toBe(true),
    );

    const saveDraft = vi.fn().mockRejectedValue(
      productFailureApiError(
        400,
        createProductFailureEnvelope({
          code: 'VALIDATION_FAILED',
          message: 'Invalid operation.',
        }),
      ),
    );
    await act(async () => {
      await result.current.controller.save({ saveDraft }).catch(() => undefined);
    });

    expect(result.current.controller.draftState.state).toBe('SAVE_FAILED');
    expect(result.current.controller.draftState.isDirty).toBe(true);
    // isDirty is the base criterion: SAVE_FAILED with unsaved edits blocks.
    const leave = result.current.leaveGuard.getLeaveState();
    expect(leave.hasUnsavedDraft).toBe(true);
    expect(leave.canLeaveCurrentContext).toBe(false);
  });

  it('persists the pending identity only while OUTCOME_UNKNOWN and clears it after recovery', async () => {
    const { result } = renderDraft({
      draft: draftV1(),
      activeProjectId: 'project-1',
      sessionId: 'session-1',
    });
    act(() => {
      result.current.controller.editOperations([pOperation(2)]);
    });

    const saveDraft = vi.fn().mockRejectedValue(outcomeIndeterminateApiError('req-from-error'));
    await act(async () => {
      await result.current.controller.save({ saveDraft }).catch(() => undefined);
    });
    expect(result.current.controller.draftState.state).toBe('OUTCOME_UNKNOWN');

    const key = pendingKnowledgeDraftCommandStorageKey('session-1', 'project-1', 'draft-seed-1');
    const persisted = readPendingKnowledgeDraftCommandIdentity(
      window.sessionStorage,
      'session-1',
      'project-1',
      'draft-seed-1',
    );
    expect(persisted).not.toBeNull();
    expect(persisted?.clientRequestId).toBe(
      result.current.controller.draftState.commandIdentity?.clientRequestId,
    );
    expect(persisted?.idempotencyKey).toBe(
      result.current.controller.draftState.commandIdentity?.idempotencyKey,
    );
    expect(persisted?.semanticDigest).toBe(
      result.current.controller.draftState.commandIdentity?.semanticDigest,
    );
    // Only the identity is stored — never the Draft contents or operations.
    expect(persisted).not.toHaveProperty('draft');
    expect(persisted).not.toHaveProperty('operations');

    const resolveCommandOutcome = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      originalClientRequestId: persisted?.clientRequestId,
      originalIdempotencyKey: persisted?.idempotencyKey,
      draft: savedDraft(),
    });
    await act(async () => {
      await result.current.controller.recoverOutcomeUnknown({ resolveCommandOutcome });
    });

    expect(result.current.controller.draftState.state).toBe('CLEAN');
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it('restores a persisted pending identity on reload and resolves without resubmitting', async () => {
    // A previous page left an unresolved command for this Session/Project/Draft.
    const storedIdentity = {
      clientRequestId: 'req-restored',
      idempotencyKey: 'idem-restored',
      semanticDigest: 'sha256:restored',
      sessionId: 'session-1',
      projectId: 'project-1',
      draftId: 'draft-seed-1',
    };
    writePendingKnowledgeDraftCommandIdentity(window.sessionStorage, storedIdentity);

    const { result } = renderDraft({
      draft: draftV1(),
      activeProjectId: 'project-1',
      sessionId: 'session-1',
    });

    await waitFor(() => expect(result.current.controller.draftState.state).toBe('OUTCOME_UNKNOWN'));
    expect(result.current.controller.draftState.commandIdentity).toMatchObject({
      clientRequestId: 'req-restored',
      idempotencyKey: 'idem-restored',
      semanticDigest: 'sha256:restored',
    });
    await waitFor(() =>
      expect(result.current.leaveGuard.getLeaveState().hasOutcomeUnknownCommand).toBe(true),
    );

    const saveDraft = vi.fn();
    const resolveCommandOutcome = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      originalClientRequestId: 'req-restored',
      originalIdempotencyKey: 'idem-restored',
      draft: savedDraft(),
    });
    await act(async () => {
      await result.current.controller.recoverOutcomeUnknown({ resolveCommandOutcome });
    });

    expect(resolveCommandOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'req-restored',
        idempotencyKey: 'idem-restored',
        semanticDigest: 'sha256:restored',
      }),
    );
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.current.controller.draftState.state).toBe('CLEAN');
    expect(
      window.sessionStorage.getItem(
        pendingKnowledgeDraftCommandStorageKey('session-1', 'project-1', 'draft-seed-1'),
      ),
    ).toBeNull();
  });

  it('never restores a pending identity scoped to another Session / Project / Draft', async () => {
    writePendingKnowledgeDraftCommandIdentity(window.sessionStorage, {
      clientRequestId: 'req-other',
      idempotencyKey: 'idem-other',
      semanticDigest: 'sha256:other',
      sessionId: 'session-other',
      projectId: 'project-other',
      draftId: 'draft-other',
    });

    const { result } = renderDraft({
      draft: draftV1(),
      activeProjectId: 'project-1',
      sessionId: 'session-1',
    });

    // The mismatched identity is never applied to this Session/Project/Draft.
    expect(result.current.controller.draftState.state).toBe('CLEAN');
    expect(result.current.controller.draftState.commandIdentity).toBeNull();
  });
});
