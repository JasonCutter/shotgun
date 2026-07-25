import type { QueryClient } from '@tanstack/react-query';

export const productSessionQueryKey = ['product', 'session'] as const;
export const sessionBoundaryQueryKey = ['session', 'boundary'] as const;
export const protectedQueryKey = ['protected'] as const;
export const globalQueryKey = ['global'] as const;
export const unprotectedQueryKey = ['unprotected'] as const;

export const projectQueryKey = (
  principalId: string,
  projectId: string,
  resource: string,
  ...parts: readonly unknown[]
) => ['project', principalId, projectId, resource, ...parts] as const;

export const clearProjectQueries = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
};

export const purgeProjectScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await clearProjectQueries(queryClient);
};

export const purgeProtectedSessionCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['protected'] });
  queryClient.removeQueries({ queryKey: ['protected'] });
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
  await queryClient.cancelQueries({ queryKey: productSessionQueryKey });
  queryClient.removeQueries({ queryKey: productSessionQueryKey });
};
