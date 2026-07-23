import { QueryClient } from '@tanstack/react-query';

export const createFrontendQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
