import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type DiscoveryDismissCommandContext = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly canDismiss: boolean;
};

export type RegisteredDiscoveryCommandContext = {
  readonly context: DiscoveryDismissCommandContext;
  readonly commandPending: boolean;
  readonly dismiss: (invoker: HTMLElement | null) => void;
};

type DiscoveryCommandContextValue = {
  readonly registration?: RegisteredDiscoveryCommandContext;
  readonly register: (registration: RegisteredDiscoveryCommandContext) => () => void;
};

const DiscoveryCommandContextBridge = createContext<DiscoveryCommandContextValue | null>(null);

export const DiscoveryCommandContextProvider = ({ children }: { readonly children: ReactNode }) => {
  const [registration, setRegistration] = useState<RegisteredDiscoveryCommandContext>();

  const register = useCallback((next: RegisteredDiscoveryCommandContext) => {
    setRegistration(next);
    return () => {
      setRegistration((current) => (current === next ? undefined : current));
    };
  }, []);

  const value = useMemo(() => ({ registration, register }), [register, registration]);
  return (
    <DiscoveryCommandContextBridge.Provider value={value}>
      {children}
    </DiscoveryCommandContextBridge.Provider>
  );
};

export const useOptionalDiscoveryCommandContext = (): DiscoveryCommandContextValue | null =>
  useContext(DiscoveryCommandContextBridge);
