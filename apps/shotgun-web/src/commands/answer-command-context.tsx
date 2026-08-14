import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { AskAnswerRunSnapshot } from '@shotgun/api-client';

import type { AnswerCommandId } from './owner-command-registry.js';

export type AnswerCommandContext = {
  readonly projectId: string;
  readonly conversationId: string;
  readonly branchId: string;
  readonly turnId: string;
  readonly answerRunId: string;
  readonly answerRevision: string;
  readonly state: AskAnswerRunSnapshot['state'];
  readonly capabilities: AskAnswerRunSnapshot['capabilities'];
};

export type RegisteredAnswerCommandContext = {
  readonly context: AnswerCommandContext;
  readonly commandPending: boolean;
  readonly openCommand: (commandId: AnswerCommandId, invoker: HTMLElement | null) => void;
};

type AnswerCommandContextValue = {
  readonly registration?: RegisteredAnswerCommandContext;
  readonly register: (registration: RegisteredAnswerCommandContext) => () => void;
};

const AnswerCommandContextBridge = createContext<AnswerCommandContextValue | null>(null);

export const AnswerCommandContextProvider = ({ children }: { readonly children: ReactNode }) => {
  const [registration, setRegistration] = useState<RegisteredAnswerCommandContext>();

  const register = useCallback((next: RegisteredAnswerCommandContext) => {
    setRegistration(next);
    return () => {
      setRegistration((current) => (current === next ? undefined : current));
    };
  }, []);

  const value = useMemo(() => ({ registration, register }), [register, registration]);

  return (
    <AnswerCommandContextBridge.Provider value={value}>
      {children}
    </AnswerCommandContextBridge.Provider>
  );
};

export const useOptionalAnswerCommandContext = (): AnswerCommandContextValue | null =>
  useContext(AnswerCommandContextBridge);
