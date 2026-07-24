import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';

import type { ShotgunApiClient } from '@shotgun/api-client';

export type AppRuntime = {
  readonly apiClient: ShotgunApiClient;
  readonly queryClient: QueryClient;
};

const RuntimeContext = createContext<AppRuntime | undefined>(undefined);

import { LeaveGuardProvider } from '../session/leave-guard-context.js';

export const AppProviders = ({
  children,
  runtime,
}: {
  readonly children: ReactNode;
  readonly runtime: AppRuntime;
}) => (
  <RuntimeContext.Provider value={runtime}>
    <QueryClientProvider client={runtime.queryClient}>
      <LeaveGuardProvider>{children}</LeaveGuardProvider>
    </QueryClientProvider>
  </RuntimeContext.Provider>
);

export const useAppRuntime = (): AppRuntime => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('Application runtime is unavailable.');
  return runtime;
};
