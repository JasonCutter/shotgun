import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { WorkspaceLeaveGuard, WorkspaceLeaveState } from '@shotgun/api-client';

const DEFAULT_LEAVE_STATE: WorkspaceLeaveState = {
  canLeaveCurrentContext: true,
  hasUnsavedDraft: false,
  hasBlockingDialog: false,
  hasOutcomeUnknownCommand: false,
};

type LeaveGuardContextValue = {
  getLeaveState: () => WorkspaceLeaveState;
  registerLeaveGuard: (guard: WorkspaceLeaveGuard) => () => void;
};

const LeaveGuardContext = createContext<LeaveGuardContextValue>({
  getLeaveState: () => DEFAULT_LEAVE_STATE,
  registerLeaveGuard: () => () => {},
});

export const LeaveGuardProvider = ({ children }: { readonly children: ReactNode }) => {
  const [guards, setGuards] = useState<readonly WorkspaceLeaveGuard[]>([]);

  const registerLeaveGuard = useCallback((guard: WorkspaceLeaveGuard) => {
    setGuards((prev) => [...prev, guard]);
    return () => {
      setGuards((prev) => prev.filter((g) => g !== guard));
    };
  }, []);

  const getLeaveState = useCallback((): WorkspaceLeaveState => {
    if (guards.length === 0) return DEFAULT_LEAVE_STATE;

    let canLeaveCurrentContext = true;
    let hasUnsavedDraft = false;
    let hasBlockingDialog = false;
    let hasOutcomeUnknownCommand = false;

    for (const guard of guards) {
      const state = guard();
      if (!state.canLeaveCurrentContext) canLeaveCurrentContext = false;
      if (state.hasUnsavedDraft) hasUnsavedDraft = true;
      if (state.hasBlockingDialog) hasBlockingDialog = true;
      if (state.hasOutcomeUnknownCommand) hasOutcomeUnknownCommand = true;
    }

    return {
      canLeaveCurrentContext,
      hasUnsavedDraft,
      hasBlockingDialog,
      hasOutcomeUnknownCommand,
    };
  }, [guards]);

  const value = useMemo(
    () => ({ getLeaveState, registerLeaveGuard }),
    [getLeaveState, registerLeaveGuard],
  );

  return <LeaveGuardContext.Provider value={value}>{children}</LeaveGuardContext.Provider>;
};

export const useLeaveGuard = (): LeaveGuardContextValue => useContext(LeaveGuardContext);
