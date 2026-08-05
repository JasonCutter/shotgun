import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_ACTION_ANNOUNCEMENTS,
  createInitialExternalActionWorkspaceState,
  externalActionCommandSurfaces,
  reduceExternalActionWorkspaceState,
} from './external-action-workspace-state.js';

describe('External Action workspace state machine (FE-P4-S2 WP5, ADR-119)', () => {
  it('tracks the bounded queue phases', () => {
    const initial = createInitialExternalActionWorkspaceState();
    expect(initial.phase).toEqual({ kind: 'IDLE' });
    expect(reduceExternalActionWorkspaceState(initial, { type: 'QUEUE_STARTED' }).phase).toEqual({
      kind: 'QUEUE_LOADING',
    });
    const ready = reduceExternalActionWorkspaceState(
      { ...initial, phase: { kind: 'QUEUE_LOADING' } },
      { type: 'QUEUE_RESOLVED' },
    );
    expect(ready.phase).toEqual({ kind: 'QUEUE_READY' });
  });

  it('selecting an action resets resource selection, draft, submitting and recovery', () => {
    const initial = createInitialExternalActionWorkspaceState();
    const selected = reduceExternalActionWorkspaceState(initial, {
      type: 'SELECT_ACTION',
      actionId: 'action-1',
      actionRevision: 4,
      externalRevision: '',
    });
    expect(selected.selectedActionId).toBe('action-1');
    expect(selected.actionRevision).toBe(4);
    expect(selected.selectedManifestId).toBeNull();
    expect(selected.phase).toEqual({ kind: 'DETAIL_LOADING' });
    expect(selected.draft).toBeNull();
    expect(selected.submitting).toBeNull();
    expect(selected.recovery).toEqual({ kind: 'NONE' });
  });

  it('tracks the manifest selection and the in-flight submitting lock', () => {
    const selected = reduceExternalActionWorkspaceState(
      createInitialExternalActionWorkspaceState(),
      { type: 'SELECT_ACTION', actionId: 'action-1', actionRevision: 4, externalRevision: '' },
    );
    const withManifest = reduceExternalActionWorkspaceState(selected, {
      type: 'SELECT_MANIFEST',
      manifestId: 'manifest-1',
    });
    expect(withManifest.selectedManifestId).toBe('manifest-1');
    const submitting = reduceExternalActionWorkspaceState(withManifest, {
      type: 'SUBMITTING_STARTED',
      command: 'CANCEL',
    });
    expect(submitting.submitting).toBe('CANCEL');
    expect(submitting.draft).toBeNull();
    expect(
      reduceExternalActionWorkspaceState(submitting, { type: 'SUBMITTING_FINISHED' }).submitting,
    ).toBeNull();
  });

  it('keeps an unsent command draft route-scoped until COMMAND_STARTED clears it', () => {
    const selected = reduceExternalActionWorkspaceState(
      createInitialExternalActionWorkspaceState(),
      {
        type: 'SELECT_ACTION',
        actionId: 'action-1',
        actionRevision: 4,
        externalRevision: '',
      },
    );
    const withDraft = reduceExternalActionWorkspaceState(selected, {
      type: 'SET_COMMAND_DRAFT',
      command: 'CANCEL',
      reason: 'Abort requested.',
    });
    expect(withDraft.draft).toEqual({ command: 'CANCEL', reason: 'Abort requested.' });
    const started = reduceExternalActionWorkspaceState(withDraft, { type: 'COMMAND_STARTED' });
    expect(started.draft).toBeNull();
  });

  it('enters OUTCOME_UNKNOWN and recovers by the original command identity', () => {
    const selected = reduceExternalActionWorkspaceState(
      createInitialExternalActionWorkspaceState(),
      {
        type: 'SELECT_ACTION',
        actionId: 'action-1',
        actionRevision: 4,
        externalRevision: '',
      },
    );
    const unknown = reduceExternalActionWorkspaceState(selected, {
      type: 'OUTCOME_UNKNOWN',
      clientRequestId: 'client-r-1',
      idempotencyKey: 'idem-r-1',
      semanticDigest: 'sha256:digest',
    });
    expect(unknown.phase).toEqual({
      kind: 'OUTCOME_UNKNOWN',
      clientRequestId: 'client-r-1',
      idempotencyKey: 'idem-r-1',
      semanticDigest: 'sha256:digest',
    });
    const restoring = reduceExternalActionWorkspaceState(unknown, { type: 'RECOVERY_STARTED' });
    expect(restoring.recovery).toEqual({ kind: 'RESTORING' });
    const resolved = reduceExternalActionWorkspaceState(restoring, { type: 'RECOVERY_FINISHED' });
    expect(resolved.recovery).toEqual({ kind: 'NONE' });
  });

  it('surfaces a typed failure with retryability', () => {
    const failed = reduceExternalActionWorkspaceState(createInitialExternalActionWorkspaceState(), {
      type: 'FAILED',
      reason: 'EXTERNAL_ACTION_STALE',
      message: 'The External Action changed.',
      retryable: true,
    });
    expect(failed.phase).toEqual({
      kind: 'FAILED',
      reason: 'EXTERNAL_ACTION_STALE',
      message: 'The External Action changed.',
      retryable: true,
    });
  });

  it('exposes non-automatic governed surfaces only for valid states', () => {
    // Cancel is an abort request, never rollback (contract §9).
    expect(externalActionCommandSurfaces('READY_TO_EXECUTE')).toMatchObject({
      canCancel: true,
      canRollback: false,
    });
    // Rollback is a separate governed state-reversal, never assumed available.
    expect(externalActionCommandSurfaces('VERIFIED')).toMatchObject({
      canCancel: false,
      canRollback: true,
      canPrepareCompensation: true,
    });
    expect(externalActionCommandSurfaces('EXECUTING')).toMatchObject({
      canCancel: true,
      canRollback: false,
      canExecute: false,
    });
  });

  it('freezes the OUTCOME_UNKNOWN announcement to the original-identity recovery wording', () => {
    expect(EXTERNAL_ACTION_ANNOUNCEMENTS.OUTCOME_UNKNOWN).toBe(
      '외부 액션 결과를 확인할 수 없습니다. 원래 요청으로 복구합니다.',
    );
  });
});
