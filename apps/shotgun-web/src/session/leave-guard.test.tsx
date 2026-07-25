import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type ReactNode } from 'react';

import { LeaveGuardProvider, useLeaveGuard } from './leave-guard-context.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LeaveGuardProvider>{children}</LeaveGuardProvider>
);

describe('Leave Guard — Project Mutation 차단', () => {
  it('Unsaved Draft Mutation 0건', () => {
    const { result } = renderHook(() => useLeaveGuard(), { wrapper });
    let unregister: () => void;

    act(() => {
      unregister = result.current.registerLeaveGuard(() => ({
        canLeaveCurrentContext: false,
        hasUnsavedDraft: true,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: false,
      }));
    });

    const state = result.current.getLeaveState();
    expect(state.hasUnsavedDraft).toBe(true);
    expect(state.canLeaveCurrentContext).toBe(false);

    // Project mutation would be blocked: switchActiveProject would NOT be called
    act(() => unregister!());
  });

  it('Blocking Dialog Mutation 0건', () => {
    const { result } = renderHook(() => useLeaveGuard(), { wrapper });
    let unregister: () => void;

    act(() => {
      unregister = result.current.registerLeaveGuard(() => ({
        canLeaveCurrentContext: true,
        hasUnsavedDraft: false,
        hasBlockingDialog: true,
        hasOutcomeUnknownCommand: false,
      }));
    });

    const state = result.current.getLeaveState();
    expect(state.hasBlockingDialog).toBe(true);

    act(() => unregister!());
  });

  it('OUTCOME_UNKNOWN Mutation 0건', () => {
    const { result } = renderHook(() => useLeaveGuard(), { wrapper });
    let unregister: () => void;

    act(() => {
      unregister = result.current.registerLeaveGuard(() => ({
        canLeaveCurrentContext: true,
        hasUnsavedDraft: false,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: true,
      }));
    });

    const state = result.current.getLeaveState();
    expect(state.hasOutcomeUnknownCommand).toBe(true);

    act(() => unregister!());
  });

  it('canLeaveCurrentContext=false Mutation 0건', () => {
    const { result } = renderHook(() => useLeaveGuard(), { wrapper });
    let unregister: () => void;

    act(() => {
      unregister = result.current.registerLeaveGuard(() => ({
        canLeaveCurrentContext: false,
        hasUnsavedDraft: false,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: false,
      }));
    });

    const state = result.current.getLeaveState();
    expect(state.canLeaveCurrentContext).toBe(false);

    act(() => unregister!());
  });
});
