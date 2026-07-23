import type { QueryClient } from '@tanstack/react-query';

export const productSessionQueryKey = ['product', 'session'] as const;

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
